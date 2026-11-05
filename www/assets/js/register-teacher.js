
import { auth, db, firebaseConfig } from "./firebase-config.js";

import {
    initializeApp,
    getApps
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    updateProfile,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ======================================================
// HTML ELEMENTS
// ======================================================

const form = document.getElementById("teacherForm");
const message = document.getElementById("message");
const button = document.getElementById("createButton");

const surnameInput = document.getElementById("surname");
const firstNameInput = document.getElementById("firstName");
const middleInitialInput = document.getElementById("middleInitial");
const departmentInput = document.getElementById("department");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

if (
    !form ||
    !message ||
    !button ||
    !surnameInput ||
    !firstNameInput ||
    !middleInitialInput ||
    !departmentInput ||
    !emailInput ||
    !passwordInput
) {
    throw new Error("One or more teacher form elements are missing.");
}


// ======================================================
// SECONDARY FIREBASE AUTH
// Keeps the admin signed in.
// ======================================================

const secondaryAppName = "EqualLearnTeacherCreation";

const existingSecondaryApp = getApps().find(
    app => app.name === secondaryAppName
);

const secondaryApp = existingSecondaryApp ||
    initializeApp(firebaseConfig, secondaryAppName);

const secondaryAuth = getAuth(secondaryApp);


// ======================================================
// STATE
// ======================================================

let adminVerified = false;
let checkingAdmin = true;
let submitting = false;

const originalButtonText = "Create Teacher Account";


// ======================================================
// MESSAGE HANDLER
// ======================================================

function showMessage(text, type = "error") {
    message.textContent = text;
    message.className = text ? type : "";
    message.style.display = text ? "block" : "none";
}


// ======================================================
// BUTTON HANDLER
// ======================================================

function setLoading(loading) {
    button.disabled = loading || !adminVerified;

    button.textContent = loading
        ? "Creating Teacher Account..."
        : originalButtonText;
}


// ======================================================
// ADMIN VERIFICATION
// ======================================================

const unsubscribeAdmin = (() => {

    return import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js")
        .then(({ onAuthStateChanged }) => {

            return onAuthStateChanged(auth, async (user) => {

                adminVerified = false;
                checkingAdmin = true;
                button.disabled = true;

                if (!user) {
                    checkingAdmin = false;
                    window.location.replace("../login.html");
                    return;
                }

                try {

                    const adminSnapshot = await getDoc(
                        doc(db, "users", user.uid)
                    );

                    if (!adminSnapshot.exists()) {
                        showMessage("Administrator profile not found.");
                        window.location.replace("../login.html");
                        return;
                    }

                    const adminData = adminSnapshot.data();

                    if (
                        adminData.role !== "admin" ||
                        adminData.status === "inactive"
                    ) {
                        showMessage("Access denied. Active administrator account required.");
                        window.location.replace("../login.html");
                        return;
                    }

                    adminVerified = true;

                    showMessage(
                        "Administrator verified. You can create teacher accounts.",
                        "success"
                    );

                } catch (error) {

                    console.error("ADMIN VERIFICATION ERROR:", error);

                    showMessage(
                        "Unable to verify administrator. Check your Firestore Rules."
                    );

                } finally {

                    checkingAdmin = false;
                    button.disabled = !adminVerified;

                }

            });

        });

})();


// ======================================================
// CREATE TEACHER ACCOUNT
// ======================================================

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    if (submitting) return;

    if (
        checkingAdmin ||
        !adminVerified ||
        !auth.currentUser
    ) {
        showMessage("Please wait for administrator verification.");
        return;
    }

    const teacherData = {

        surname: surnameInput.value.trim(),

        firstName: firstNameInput.value.trim(),

        middleInitial: middleInitialInput.value.trim(),

        department: departmentInput.value.trim(),

        email: emailInput.value.trim().toLowerCase(),

        password: passwordInput.value

    };

    // Validate required information.
    if (
        !teacherData.surname ||
        !teacherData.firstName ||
        !teacherData.department ||
        !teacherData.email ||
        !teacherData.password
    ) {
        showMessage("Please complete all required fields.");
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(teacherData.email)) {
        showMessage("Please enter a valid email address.");
        return;
    }

    if (
        teacherData.password.length < 8 ||
        teacherData.password.length > 128
    ) {
        showMessage("Password must contain 8 to 128 characters.");
        return;
    }

    submitting = true;
    setLoading(true);

    showMessage("Creating teacher account...", "success");

    let createdUser = null;

    try {

        // Recheck admin session and profile before creation.
        const admin = auth.currentUser;

        if (!admin) {
            throw new Error("Administrator session expired.");
        }

        const adminSnapshot = await getDoc(
            doc(db, "users", admin.uid)
        );

        if (
            !adminSnapshot.exists() ||
            adminSnapshot.data().role !== "admin" ||
            adminSnapshot.data().status === "inactive"
        ) {
            throw new Error("Administrator permission denied.");
        }

        // Create account using secondary Firebase Auth.
        // This does not replace the administrator's session.

        const credential = await createUserWithEmailAndPassword(
            secondaryAuth,
            teacherData.email,
            teacherData.password
        );

        createdUser = credential.user;

        const fullname =
            `${teacherData.firstName} ` +
            (teacherData.middleInitial
                ? `${teacherData.middleInitial} `
                : "") +
            teacherData.surname;

        await updateProfile(createdUser, {
            displayName: fullname
        });

        // Create teacher profile in Firestore using
        // the original admin-authenticated Firestore instance.

        await setDoc(
            doc(db, "users", createdUser.uid),
            {
                uid: createdUser.uid,
                fullname: fullname,
                surname: teacherData.surname,
                firstName: teacherData.firstName,
                middleInitial: teacherData.middleInitial,
                email: teacherData.email,
                department: teacherData.department,
                role: "teacher",
                status: "active",
                createdAt: serverTimestamp(),
                createdBy: admin.uid,
                updatedAt: serverTimestamp()
            }
        );

        showMessage(
            "TEACHER ACCOUNT CREATED SUCCESSFULLY!\n\n" +
            `Name: ${fullname}\n` +
            `Email: ${teacherData.email}\n` +
            `UID: ${createdUser.uid}\n\n` +
            "The teacher can now sign in using the registered email and password.",
            "success"
        );

        console.log("TEACHER ACCOUNT CREATED:", {
            uid: createdUser.uid,
            fullname: fullname,
            email: teacherData.email,
            department: teacherData.department
        });

        form.reset();

    } catch (error) {

        console.error("TEACHER CREATION ERROR:", error);

        // If Auth creation succeeded but Firestore failed,
        // remove the newly created Auth account to avoid an orphan.
        if (createdUser) {

            try {
                await createdUser.delete();
            } catch (rollbackError) {
                console.error(
                    "TEACHER AUTH ROLLBACK ERROR:",
                    rollbackError
                );
            }

        }

        let errorMessage = error.message ||
            "Unable to create teacher account.";

        if (error.code === "auth/email-already-in-use") {
            errorMessage = "This email is already registered.";

        } else if (error.code === "auth/invalid-email") {
            errorMessage = "Please enter a valid email address.";

        } else if (error.code === "auth/weak-password") {
            errorMessage = "Password is too weak.";

        } else if (
            error.code === "permission-denied" ||
            error.code === "firestore/permission-denied"
        ) {
            errorMessage =
                "Firestore denied teacher profile creation. Check the users collection rules.";

        } else if (error.code === "auth/network-request-failed") {
            errorMessage = "Network error. Check your internet connection.";

        }

        showMessage(errorMessage, "error");

    } finally {

        // Sign out only the secondary Auth instance.
        // The administrator remains signed in.

        try {
            if (secondaryAuth.currentUser) {
                await signOut(secondaryAuth);
            }
        } catch (signOutError) {
            console.error("SECONDARY SIGNOUT ERROR:", signOutError);
        }

        submitting = false;
        setLoading(false);

    }

});


// ======================================================
// INITIAL STATE
// ======================================================

button.disabled = true;
