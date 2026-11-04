
import { auth, db } from "./firebase-config.js";

import {
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// ======================================================
// ELEMENTS
// ======================================================

const form = document.getElementById("registerForm");
const message = document.getElementById("message");
const googleButton = document.getElementById("googleSignIn");

// Prevent duplicate requests
let registrationInProgress = false;

// ======================================================
// MESSAGE
// ======================================================

function showMessage(type, text) {
    if (!message) return;

    message.className = type;
    message.textContent = text;
}

// ======================================================
// DASHBOARD ROUTING
// ======================================================

function redirectToDashboard(role) {
    const normalizedRole = String(role || "")
        .trim()
        .toLowerCase();

    const routes = {
        student: "student/dashboard.html",
        teacher: "teacher/dashboard.html",
        instructor: "teacher/dashboard.html",
        admin: "admin/dashboard.html"
    };

    const destination = routes[normalizedRole];

    if (!destination) {
        showMessage(
            "error",
            "Your account has no valid role. Please contact the administrator."
        );
        return;
    }

    // Resolve relative to the current root registration page.
    const targetURL = new URL(
        destination,
        window.location.href
    );

    console.log("EqualLearn role:", normalizedRole);
    console.log("EqualLearn destination:", targetURL.href);

    window.location.replace(targetURL.href);
}

// ======================================================
// CREATE STUDENT PROFILE
// ======================================================

async function createStudentProfile(user, provider) {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    // Preserve existing teacher/admin/student accounts.
    if (snapshot.exists()) {
        return snapshot.data();
    }

    // Public registration always creates a student.
    const profile = {
        uid: user.uid,
        email: user.email || "",
        fullname: user.displayName || "",
        profileImage: user.photoURL || "",

        role: "student",
        status: "active",
        provider: provider,

        studentNumber: "",
        course: "",
        yearLevel: "",
        cohort: "",
        classGroupId: "",
        department: "",

        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
    };

    await setDoc(userRef, profile);

    return {
        ...profile,
        role: "student",
        status: "active"
    };
}

// ======================================================
// EMAIL REGISTRATION
// NEW ACCOUNTS = STUDENT
// ======================================================

form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (registrationInProgress) return;

    const button = form.querySelector(
        'button[type="submit"]'
    );

    const email = document
        .getElementById("email")
        ?.value.trim().toLowerCase();

    const password = document
        .getElementById("password")
        ?.value;

    if (!email || !password) {
        showMessage("error", "Please enter your email and password.");
        return;
    }

    if (password.length < 6) {
        showMessage("error", "Password must contain at least 6 characters.");
        return;
    }

    registrationInProgress = true;

    if (button) {
        button.disabled = true;
        button.textContent = "Creating account...";
    }

    try {
        const credential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        const profile = await createStudentProfile(
            credential.user,
            "email"
        );

        showMessage(
            "success",
            "Student account created successfully! Opening your dashboard..."
        );

        redirectToDashboard(profile.role);

    } catch (error) {
        console.error("Email registration error:", error);

        let errorMessage = "Unable to create your account. Please try again.";

        if (error.code === "auth/email-already-in-use") {
            errorMessage = "This email is already registered. Please sign in.";
        } else if (error.code === "auth/invalid-email") {
            errorMessage = "Please enter a valid email address.";
        } else if (error.code === "auth/weak-password") {
            errorMessage = "Your password is too weak.";
        } else if (
            error.code === "permission-denied" ||
            error.code === "firestore/permission-denied"
        ) {
            errorMessage = "Unable to save your student profile. Check Firestore permissions.";
        }

        showMessage("error", errorMessage);

        registrationInProgress = false;

        if (button) {
            button.disabled = false;
            button.textContent = "Create account";
        }
    }
});

// ======================================================
// GOOGLE REGISTRATION / SIGN-IN
// ======================================================

googleButton?.addEventListener("click", async () => {
    if (registrationInProgress) return;

    registrationInProgress = true;

    googleButton.disabled = true;
    googleButton.textContent = "Connecting to Google...";

    try {
        const provider = new GoogleAuthProvider();

        provider.setCustomParameters({
            prompt: "select_account"
        });

        const credential = await signInWithPopup(
            auth,
            provider
        );

        const user = credential.user;

        const profile = await createStudentProfile(
            user,
            "google"
        );

        showMessage(
            "success",
            "Google sign-in successful! Opening your dashboard..."
        );

        redirectToDashboard(profile.role);

    } catch (error) {
        console.error("Google authentication error:", error);

        let errorMessage = error.message || "Google sign-in failed.";

        if (error.code === "auth/popup-closed-by-user") {
            errorMessage = "Google sign-in was cancelled.";
        } else if (error.code === "auth/unauthorized-domain") {
            errorMessage = "This website domain is not authorized in Firebase.";
        } else if (error.code === "auth/popup-blocked") {
            errorMessage = "Your browser blocked the Google sign-in popup.";
        } else if (
            error.code === "permission-denied" ||
            error.code === "firestore/permission-denied"
        ) {
            errorMessage = "Unable to save your profile. Check Firestore permissions.";
        }

        showMessage("error", errorMessage);

        registrationInProgress = false;

        googleButton.disabled = false;
        googleButton.textContent = "Continue with Google";
    }
});