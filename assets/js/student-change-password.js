import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const form = document.getElementById("changePasswordForm");
const currentInput = document.getElementById("currentPassword");
const nextInput = document.getElementById("newPassword");
const confirmInput = document.getElementById("confirmPassword");
const changeButton = document.getElementById("changePasswordButton");
const resetButton = document.getElementById("resetPasswordButton");
const notice = document.getElementById("passwordProviderNotice");
const message = document.getElementById("passwordMessage");

let currentUser = null;
let hasPasswordProvider = false;

function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.className = `sp-settings-message ${type}`.trim();
}

async function recordActivity(action, details = {}) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "activityLogs"), {
      userId: currentUser.uid,
      actorId: currentUser.uid,
      actorRole: "student",
      action,
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Password activity log could not be saved:", error);
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }
  currentUser = user;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists() || String(profileSnap.data().role || "").toLowerCase() !== "student") {
      location.replace("../login.html");
      return;
    }
  } catch (error) {
    console.error("Password settings profile check failed:", error);
    showMessage("Unable to verify your account. Refresh the page and try again.", "error");
    if (changeButton) changeButton.disabled = true;
    if (resetButton) resetButton.disabled = true;
    return;
  }

  hasPasswordProvider = (user.providerData || []).some(provider => provider.providerId === "password");
  if (!hasPasswordProvider) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "This account is currently connected through Google or another external sign-in provider. EqualLearn does not have a separate password to update here. Manage your password with that provider instead.";
    }
    if (form) form.hidden = true;
    if (resetButton) resetButton.disabled = true;
    showMessage("Password changes are not available for this sign-in provider.");
  }
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !hasPasswordProvider) return;

  const current = String(currentInput?.value || "");
  const next = String(nextInput?.value || "");
  const confirm = String(confirmInput?.value || "");

  if (!current || !next || !confirm) {
    showMessage("Complete all password fields before continuing.", "error");
    return;
  }
  if (next.length < 6) {
    showMessage("Your new password must contain at least 6 characters.", "error");
    return;
  }
  if (next !== confirm) {
    showMessage("The new password and confirmation do not match.", "error");
    return;
  }
  if (current === next) {
    showMessage("Choose a new password different from your current password.", "error");
    return;
  }

  if (changeButton) {
    changeButton.disabled = true;
    changeButton.textContent = "Updating…";
  }
  showMessage("Verifying your current password…");

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, next);
    await recordActivity("password_changed");
    form.reset();
    showMessage("Your password has been updated successfully.", "success");
  } catch (error) {
    console.error("Student password update failed:", error);
    const messages = {
      "auth/wrong-password": "The current password is incorrect.",
      "auth/invalid-credential": "The current password is incorrect or has expired.",
      "auth/weak-password": "Choose a stronger password with at least 6 characters.",
      "auth/requires-recent-login": "For your security, sign out and sign in again before changing your password.",
      "auth/too-many-requests": "Too many attempts. Please try again later."
    };
    showMessage(messages[error.code] || error.message || "Unable to update your password.", "error");
  } finally {
    if (changeButton) {
      changeButton.disabled = false;
      changeButton.textContent = "Update password";
    }
  }
});

resetButton?.addEventListener("click", async () => {
  if (!currentUser || !hasPasswordProvider || !currentUser.email) return;
  resetButton.disabled = true;
  resetButton.textContent = "Sending…";
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    await recordActivity("password_reset_email_sent");
    showMessage(`A password reset link has been sent to ${currentUser.email}.`, "success");
  } catch (error) {
    console.error("Password reset email failed:", error);
    showMessage(error.message || "Unable to send the password reset email.", "error");
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Send password reset email";
  }
});
