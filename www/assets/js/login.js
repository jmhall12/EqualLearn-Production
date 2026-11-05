import {
    loginUser,
    resetPassword
} from "./auth.js";

import {
    showLoadingScreen
} from "./loading-screen.js";


const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");


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
            passwordInput.value
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