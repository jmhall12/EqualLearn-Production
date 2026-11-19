import {
    loginUser,
    resetPassword
} from "./auth.js";

import {
    showLoadingScreen
} from "./loading-screen.js";
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberDeviceInput = document.getElementById("rememberDevice");
let autoRedirectStarted = false;


// ==========================================
// MESSAGE
// ==========================================

function showMessage(text, type = "error") {
    message.className = type;
    message.textContent = text;
}


// ==========================================
// ROLE REDIRECT
// ==========================================

function redirectByRole(role) {

    const routes = {
        admin: "admin/dashboard.html",
        teacher: "teacher/dashboard.html",
        instructor: "teacher/dashboard.html",
        student: "student/dashboard.html"
    };

    const destination = routes[(role || "").toLowerCase()];

    if (!destination) {
        showMessage("Invalid account role: " + role);
        return;
    }

    showLoadingScreen(
        "Welcome to EqualLearn!",
        "Opening your dashboard..."
    );

    setTimeout(() => {
        window.location.href = destination;
    }, 140);

}



// Restore an existing Firebase session on this device and skip the login form.
// Firebase local persistence stores auth state, not the user's password.
onAuthStateChanged(auth, async user => {
    if (!user || autoRedirectStarted) return;
    autoRedirectStarted = true;
    try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        if (!snapshot.exists()) throw new Error("Account profile not found.");
        const profile = snapshot.data();
        if (profile.status !== "active" || !["admin", "teacher", "student"].includes(String(profile.role || "").toLowerCase())) {
            await signOut(auth);
            autoRedirectStarted = false;
            return;
        }
        redirectByRole(profile.role);
    } catch (error) {
        console.warn("[LOGIN] Could not restore role route; keeping the sign-in page available:", error);
        autoRedirectStarted = false;
    }
});

// ==========================================
// EMAIL AND PASSWORD LOGIN
// ==========================================

form?.addEventListener("submit", async event => {

    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');

    button.disabled = true;
    button.textContent = "Logging in...";

    showMessage("", "");

    try {

        const result = await loginUser(
            emailInput.value.trim(),
            passwordInput.value,
            rememberDeviceInput ? rememberDeviceInput.checked : true
        );

        if (!result.success) {
            showMessage(result.message);
            return;
        }

        redirectByRole(result.user.role);

    } catch (error) {

        console.error("LOGIN ERROR:", error);

        showMessage(error.message || "Unable to log in.");

    } finally {

        button.disabled = false;
        button.textContent = "Sign in";

    }

});


// ==========================================
// FORGOT PASSWORD
// ==========================================

forgotPasswordLink?.addEventListener("click", async event => {

    event.preventDefault();

    const email = emailInput.value.trim();

    if (!email) {
        showMessage("Enter your registered email address first.");
        emailInput.focus();
        return;
    }

    const originalText = forgotPasswordLink.textContent;

    forgotPasswordLink.textContent = "Sending...";
    forgotPasswordLink.style.pointerEvents = "none";

    showMessage("", "");

    try {

        const result = await resetPassword(email);

        if (result.success) {

            showMessage(
                "If an account exists for this email, a password reset email will be sent. Check your inbox and spam folder.",
                "success"
            );

        } else {

            showMessage(result.message);

        }

    } catch (error) {

        console.error("PASSWORD RESET ERROR:", error);

        showMessage(error.message);

    } finally {

        forgotPasswordLink.textContent = originalText;
        forgotPasswordLink.style.pointerEvents = "auto";

    }

});