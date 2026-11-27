import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const AuthContext = createContext(null);
const PROFILE_LOAD_TIMEOUT_MS = 10000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function readProfile(uid) {
  if (!uid) return null;
  const snap = await withTimeout(
    getDoc(doc(db, 'users', uid)),
    PROFILE_LOAD_TIMEOUT_MS,
    'EqualLearn could not load your account profile. Check your internet connection and retry.'
  );
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function profileErrorMessage(error) {
  if (error?.code === 'permission-denied') {
    return 'Your account profile could not be read. Please check the published Firestore permissions or contact your administrator.';
  }
  if (error?.code === 'unavailable' || /timed out|network|offline/i.test(error?.message || '')) {
    return 'EqualLearn could not reach the server. Check your internet connection, then tap Retry.';
  }
  return error?.message || 'Unable to load your EqualLearn account.';
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const authAttempt = useRef(0);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, user => {
      const attempt = ++authAttempt.current;
      setAuthError('');

      if (!user) {
        setFirebaseUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setFirebaseUser(user);
      setProfile(null);
      setLoading(true);

      void (async () => {
        try {
          const nextProfile = await readProfile(user.uid);
          if (!active || attempt !== authAttempt.current) return;

          if (!nextProfile || String(nextProfile.status || '').toLowerCase() === 'inactive') {
            setFirebaseUser(null);
            setProfile(null);
            if (auth.currentUser?.uid === user.uid) await signOut(auth);
            return;
          }

          setFirebaseUser(user);
          setProfile(nextProfile);
        } catch (error) {
          if (!active || attempt !== authAttempt.current) return;
          console.error('[EqualLearn Auth] Profile bootstrap failed:', error?.code || error?.message || error);
          // Keep the Firebase session so the user can retry instead of getting
          // trapped on an endless spinner or being silently signed out.
          setFirebaseUser(user);
          setProfile(null);
          setAuthError(profileErrorMessage(error));
        } finally {
          if (active && attempt === authAttempt.current) setLoading(false);
        }
      })();
    });

    return () => {
      active = false;
      authAttempt.current += 1;
      unsubscribe();
    };
  }, []);

  const retryProfile = useCallback(async () => {
    const user = auth.currentUser || firebaseUser;
    if (!user) return null;

    const attempt = ++authAttempt.current;
    setLoading(true);
    setAuthError('');

    try {
      const nextProfile = await readProfile(user.uid);
      if (attempt !== authAttempt.current) return null;
      if (!nextProfile || String(nextProfile.status || '').toLowerCase() === 'inactive') {
        setFirebaseUser(null);
        setProfile(null);
        if (auth.currentUser?.uid === user.uid) await signOut(auth);
        setAuthError('No active EqualLearn profile was found for this account.');
        return null;
      }
      setFirebaseUser(user);
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      if (attempt === authAttempt.current) {
        console.error('[EqualLearn Auth] Profile retry failed:', error?.code || error?.message || error);
        setAuthError(profileErrorMessage(error));
        setFirebaseUser(user);
        setProfile(null);
      }
      return null;
    } finally {
      if (attempt === authAttempt.current) setLoading(false);
    }
  }, [firebaseUser]);

  async function refreshProfile(uid = firebaseUser?.uid) {
    if (!uid) return null;
    const nextProfile = await readProfile(uid);
    if (auth.currentUser?.uid === uid || firebaseUser?.uid === uid) {
      setProfile(nextProfile);
      setAuthError('');
    }
    return nextProfile;
  }

  async function login(email, password) {
    const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    setFirebaseUser(credential.user);
    setProfile(null);
    setLoading(true);
    setAuthError('');

    try {
      const nextProfile = await readProfile(credential.user.uid);
      if (!nextProfile) {
        await signOut(auth);
        throw new Error('No matching EqualLearn user profile was found.');
      }
      if (!nextProfile.role) {
        await signOut(auth);
        throw new Error('This account has no assigned role.');
      }
      if (String(nextProfile.status || '').toLowerCase() === 'inactive') {
        await signOut(auth);
        throw new Error('This account is inactive.');
      }

      try {
        await updateDoc(doc(db, 'users', credential.user.uid), { lastLogin: serverTimestamp() });
      } catch (error) {
        console.warn('[EqualLearn Auth] Last-login timestamp was not updated:', error?.code || error?.message || error);
      }

      setFirebaseUser(credential.user);
      setProfile(nextProfile);
      setAuthError('');
      return nextProfile;
    } catch (error) {
      if (auth.currentUser?.uid === credential.user.uid) {
        setFirebaseUser(credential.user);
        setProfile(null);
        setAuthError(profileErrorMessage(error));
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function registerStudent(form) {
    const email = form.email.trim().toLowerCase();
    const studentNumber = form.studentNumber.trim().toUpperCase();
    const fullname = form.fullname.trim();
    const course = 'BSIT';
    const yearLevel = String(form.yearLevel || '').trim();
    const section = String(form.section || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

    if (!['1st', '2nd', '3rd', '4th'].includes(yearLevel)) throw new Error('Choose a valid year level.');
    if (!section) throw new Error('Enter a section using 1 to 3 letters or numbers.');

    const duplicate = await getDocs(query(collection(db, 'users'), where('studentNumber', '==', studentNumber)));
    if (!duplicate.empty) throw new Error('Student ID is already registered.');

    const credential = await createUserWithEmailAndPassword(auth, email, form.password);
    const uid = credential.user.uid;
    try {
      const classGroupId = `SECTION_${course}_${section}`;
      const groupRef = doc(db, 'classGroups', classGroupId);
      const groupSnap = await getDoc(groupRef);
      const years = groupSnap.exists() && Array.isArray(groupSnap.data().yearLevels)
        ? [...groupSnap.data().yearLevels]
        : [];
      if (!years.includes(yearLevel)) years.push(yearLevel);

      await setDoc(groupRef, {
        course,
        section,
        name: `Section ${section}`,
        yearLevels: years,
        status: 'active',
        updatedAt: serverTimestamp(),
        ...(groupSnap.exists() ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });

      await setDoc(doc(db, 'users', uid), {
        uid,
        fullname,
        studentNumber,
        email,
        yearLevel,
        course,
        section,
        classGroupId,
        role: 'student',
        status: 'active',
        profileImage: '',
        department: '',
        phone: '',
        bio: '',
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      });

      const nextProfile = await readProfile(uid);
      setFirebaseUser(credential.user);
      setProfile(nextProfile);
      setAuthError('');
      return nextProfile;
    } catch (error) {
      await signOut(auth);
      throw error;
    }
  }

  async function logout() {
    await signOut(auth);
    authAttempt.current += 1;
    setFirebaseUser(null);
    setProfile(null);
    setAuthError('');
    setLoading(false);
  }

  const resetPassword = email => sendPasswordResetEmail(auth, email.trim().toLowerCase());
  const value = useMemo(() => ({
    firebaseUser,
    profile,
    loading,
    authError,
    login,
    logout,
    refreshProfile,
    retryProfile,
    registerStudent,
    resetPassword,
    setProfile,
  }), [firebaseUser, profile, loading, authError, retryProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
