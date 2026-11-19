// ======================================================
// FIREBASE IMPORTS
// ======================================================

import { app, auth, db } from "./firebase-config.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
    getFunctions,
    httpsCallable
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-functions.js";

// Must match functions/index.js
const functions = getFunctions(app, "asia-southeast1");


// ======================================================
// STUDENT REGISTRATION
// ======================================================

export async function registerUser(userData) {
    try {
        const email = String(userData.email || "").trim().toLowerCase();
        const studentNumber = String(userData.studentNumber || "")
            .trim()
            .toUpperCase();
        const fullname = String(userData.fullname || "").trim();
        const course = String(userData.course || "").trim().toUpperCase();
        const yearLevel = String(userData.yearLevel || "").trim().toUpperCase();
        const password = String(userData.password || "");

        if (!email || !studentNumber || !fullname || !course || !yearLevel || !password) {
            return {
                success: false,
                message: "Please complete all required fields."
            };
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
                success: false,
                message: "Please enter a valid email address."
            };
        }

        if (password.length < 6) {
            return {
                success: false,
                message: "Password must contain at least 6 characters."
            };
        }

        const cohort = studentNumber.substring(0, 2);

        // Check duplicate student number
        const usersRef = collection(db, "users");

        const studentQuery = query(
            usersRef,
            where("studentNumber", "==", studentNumber)
        );

        const studentSnapshot = await getDocs(studentQuery);

        if (!studentSnapshot.empty) {
            return {
                success: false,
                message: "Student ID is already registered."
            };
        }

        // Create Firebase Authentication account
        const credential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        const uid = credential.user.uid;

        // Find or create class group
        const classGroupsRef = collection(db, "classGroups");

        const classGroupQuery = query(
            classGroupsRef,
            where("cohort", "==", cohort),
            where("course", "==", course)
        );

        const classGroupSnapshot = await getDocs(classGroupQuery);

        let classGroupId;

        if (!classGroupSnapshot.empty) {
            classGroupId = classGroupSnapshot.docs[0].id;
        } else {
            classGroupId = `${cohort}_${course}_A`;

            await setDoc(
                doc(db, "classGroups", classGroupId),
                {
                    cohort,
                    course,
                    section: "A",
                    name: `${cohort}${course}-A`,
                    status: "active",
                    createdAt: serverTimestamp()
                }
            );
        }

        // Create student profile
        await setDoc(
            doc(db, "users", uid),
            {
                uid,
                fullname,
                studentNumber,
                email,
                yearLevel,
                course,
                cohort,
                classGroupId,

                role: "student",
                status: "active",

                profileImage: "",
                department: "",

                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp()
            }
        );

        return {
            success: true,
            uid,
            classGroupId
        };

    } catch (error) {
        console.error("REGISTER ERROR:", error);

        return {
            success: false,
            message: getFriendlyAuthError(error),
            code: error.code || null
        };
    }
}


// ======================================================
// LOGIN
// ======================================================



export async function loginUser(email, password, rememberDevice = true) {
    try {
        const normalizedEmail = String(email || "")
            .trim()
            .toLowerCase();

        if (!normalizedEmail || !password) {
            return {
                success: false,
                message: "Please enter your email and password."
            };
        }

        // Let Firebase manage the secure auth token. Never store raw passwords.
        await setPersistence(
            auth,
            rememberDevice ? browserLocalPersistence : browserSessionPersistence
        );

        console.log("[LOGIN] Authenticating...");

        const credential = await signInWithEmailAndPassword(
            auth,
            normalizedEmail,
            password
        );

        const uid = credential.user.uid;
        const userRef = doc(db, "users", uid);

        console.log("[LOGIN] Authentication successful:", uid);

        const snapshot = await getDoc(userRef);

        if (!snapshot.exists()) {
            await signOut(auth);

            return {
                success: false,
                message: "Account profile not found. Please contact the administrator."
            };
        }

        const userData = snapshot.data();
        const allowedRoles = ["admin", "teacher", "student"];

        if (!allowedRoles.includes(userData.role)) {
            await signOut(auth);

            return {
                success: false,
                message: "Invalid account role. Please contact the administrator."
            };
        }

        if (userData.status !== "active") {
            await signOut(auth);

            return {
                success: false,
                message: "Your account is inactive. Please contact the administrator."
            };
        }

        // Optional activity update: must not block login.
        try {
            await updateDoc(userRef, {
                lastLogin: serverTimestamp()
            });
        } catch (error) {
            console.warn(
                "[LOGIN] Could not update lastLogin:",
                error.code || error.message
            );
        }

        console.log("[LOGIN] Successful:", userData.role);

        return {
            success: true,
            uid,
            user: userData,
            role: userData.role
        };

    } catch (error) {
        console.error("[LOGIN ERROR]", error);

        return {
            success: false,
            message: getFriendlyAuthError(error),
            code: error.code || null
        };
    }
}




// ======================================================
// ADMIN: DIRECT TEACHER ACCOUNT CREATION
// ======================================================

export async function createTeacher(teacherData) {
    try {
        if (!auth.currentUser) {
            return {
                success: false,
                message: "You must be logged in as an administrator.",
                code: "functions/unauthenticated"
            };
        }

        const surname = String(teacherData.surname || "").trim();
        const firstName = String(teacherData.firstName || "").trim();
        const middleInitial = String(teacherData.middleInitial || "").trim();
        const email = String(teacherData.email || "")
            .trim()
            .toLowerCase();
        const department = String(teacherData.department || "").trim();
        const password = String(teacherData.password || "");

        if (!surname || !firstName || !email || !department || !password) {
            return {
                success: false,
                message: "Please complete all required teacher fields."
            };
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return {
                success: false,
                message: "Please enter a valid teacher email address."
            };
        }

        if (password.length < 8 || password.length > 128) {
            return {
                success: false,
                message: "Teacher password must contain 8 to 128 characters."
            };
        }

        // Secure backend call.
        // No teacherInvitations read or write.
        // Cloud Function must independently verify admin permissions.
        const createTeacherAccount = httpsCallable(
            functions,
            "createTeacherAccount"
        );

        const response = await createTeacherAccount({
            surname,
            firstName,
            middleInitial,
            email,
            department,
            password
        });

        const result = response.data;

        if (!result || result.success !== true) {
            return {
                success: false,
                message: result?.message ||
                    "The server did not confirm teacher account creation."
            };
        }

        return result;

    } catch (error) {
        console.error("CREATE TEACHER ERROR:", error);

        return {
            success: false,
            message: getFriendlyFunctionError(error),
            code: error.code || null
        };
    }
}


// ======================================================
// LOGOUT
// ======================================================

export async function logoutUser() {
    try {
        await signOut(auth);

        return {
            success: true
        };

    } catch (error) {
        console.error("LOGOUT ERROR:", error);

        return {
            success: false,
            message: getFriendlyAuthError(error),
            code: error.code || null
        };
    }
}


// ======================================================
// RESET PASSWORD
// ======================================================

export async function resetPassword(email) {
    try {
        const normalizedEmail = String(email || "")
            .trim()
            .toLowerCase();

        if (!normalizedEmail) {
            return {
                success: false,
                message: "Please enter your email address."
            };
        }

        await sendPasswordResetEmail(
            auth,
            normalizedEmail
        );

        return {
            success: true,
            message: "Password reset email sent. Please check your inbox."
        };

    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);

        return {
            success: false,
            message: getFriendlyAuthError(error),
            code: error.code || null
        };
    }
}


// ======================================================
// AUTH STATE LISTENER
// ======================================================

export function checkAuth(callback) {
    return onAuthStateChanged(
        auth,
        callback
    );
}


// ======================================================
// CLOUD FUNCTION ERROR HANDLER
// ======================================================

function getFriendlyFunctionError(error) {
    const code = error?.code || "";

    if (code === "functions/already-exists") {
        return "This email already has a Firebase Authentication account.";
    }

    if (code === "functions/permission-denied") {
        return "Access denied. Only an active administrator can create teacher accounts.";
    }

    if (code === "functions/unauthenticated") {
        return "Your admin session has expired. Please sign in again.";
    }

    if (code === "functions/invalid-argument") {
        return error.message ||
            "Some teacher information is invalid. Please check the form.";
    }

    if (code === "functions/unavailable") {
        return "The teacher account service is temporarily unavailable. Please try again.";
    }

    if (code === "functions/not-found") {
        return "The createTeacherAccount Cloud Function was not found. Check that it is deployed in asia-southeast1.";
    }

    return error?.message ||
        "Unable to create teacher account.";
}


// ======================================================
// FIREBASE AUTH ERROR HANDLER
// ======================================================

function getFriendlyAuthError(error) {
    const code = error?.code || "";

    const messages = {
        "auth/email-already-in-use":
            "This email address is already registered.",

        "auth/invalid-email":
            "Please enter a valid email address.",

        "auth/invalid-credential":
            "Incorrect email or password, or the account does not exist.",

        "auth/user-not-found":
            "No account was found for this email address.",

        "auth/wrong-password":
            "Incorrect email or password.",

        "auth/weak-password":
            "Your password is too weak.",

        "auth/too-many-requests":
            "Too many attempts. Please wait and try again.",

        "auth/network-request-failed":
            "Network error. Check your internet connection.",

        "permission-denied":
            "Firestore denied this operation. Check the Firestore Rules for the collection being accessed."
    };

    return messages[code] ||
        error?.message ||
        "Something went wrong. Please try again.";
}