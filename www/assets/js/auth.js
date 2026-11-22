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
        const password = String(userData.password || "");

        if (!email || !password) {
            return { success: false, message: "Please provide your email address and password." };
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return { success: false, message: "Please enter a valid email address." };
        }
        if (password.length < 6) {
            return { success: false, message: "Password must contain at least 6 characters." };
        }

        // Student self-registration creates an identity shell only.
        // Student ID, course, year level, and section are assigned by an administrator.
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = credential.user.uid;

        await setDoc(doc(db, "users", uid), {
            uid,
            email,
            fullname: "",
            role: "student",
            status: "active",
            provider: "email",
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        });

        return { success: true, uid };
    } catch (error) {
        console.error("REGISTER ERROR:", error);
        return {
            success: false,
            message: getFriendlyAuthError(error),
            code: error.code || null
        };
    }
}


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

        // Keep authentication role handling consistent with login.js.
        // Older teacher profiles may use "Teacher" or "instructor".
        const storedRole = String(userData.role || "").trim().toLowerCase();
        const normalizedRole = storedRole === "instructor" ? "teacher" : storedRole;
        const normalizedStatus = String(userData.status || "").trim().toLowerCase();
        const allowedRoles = new Set(["admin", "teacher", "student"]);

        console.info("[LOGIN] Account profile resolved:", {
            role: normalizedRole || "missing",
            status: normalizedStatus || "missing",
            demoReadOnly: userData.demoReadOnly === true || String(userData.demoReadOnly).toLowerCase() === "true"
        });

        if (!allowedRoles.has(normalizedRole)) {
            await signOut(auth);
            return {
                success: false,
                message: `Invalid account role (${userData.role || "not set"}). Please ask an administrator to set the account role to Admin, Teacher, or Student.`,
                code: "profile/invalid-role"
            };
        }

        if (normalizedStatus !== "active") {
            await signOut(auth);
            return {
                success: false,
                message: `This account is not active (status: ${userData.status || "not set"}). Please ask an administrator to activate it.`,
                code: "profile/inactive"
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
            user: { ...userData, role: normalizedRole, status: normalizedStatus },
            role: normalizedRole
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