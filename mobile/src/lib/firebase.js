import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyDs5tws2jGZAS2q-9op_lIgAdyqfIXW4Uw',
  authDomain: 'equallearn-eb389.firebaseapp.com',
  projectId: 'equallearn-eb389',
  storageBucket: 'equallearn-eb389.firebasestorage.app',
  messagingSenderId: '897069961442',
  appId: '1:897069961442:web:98dfabd5efefa1e79a4ebb',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let authInstance;
try { authInstance = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) }); }
catch { authInstance = getAuth(app); }
export const auth = authInstance;
export const db = getFirestore(app);
