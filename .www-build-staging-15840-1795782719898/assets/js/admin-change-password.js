import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const currentInput = document.getElementById("currentPassword");
const newInput = document.getElementById("newPassword");
const confirmInput = document.getElementById("confirmPassword");
const changeButton = document.getElementById("changePassword");
const resetButton = document.getElementById("resetPassword");
const messageNode = document.getElementById("securityMessage");
const providerNotice = document.getElementById("passwordProviderNotice");
let currentUser = null;
let canChangeWithPassword = false;

function setMessage(text, type = "") {
  messageNode.textContent = text;
  messageNode.className = `admin-settings-message ${type}`.trim();
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  currentUser = user;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (!profile || String(profile.role || "").toLowerCase() !== "admin" || String(profile.status || "active").toLowerCase() === "inactive") {
      window.location.href = "../login.html";
      return;
    }
    canChangeWithPassword = user.providerData?.some(provider => provider.providerId === "password") || false;
    if (!canChangeWithPassword) {
      providerNotice.hidden = false;
      providerNotice.textContent = "This account does not show an email/password sign-in provider. Use Email reset link to manage the password for a linked email account, or follow your sign-in provider's account recovery process.";
      [currentInput, newInput, confirmInput, changeButton].forEach(element => { if (element) element.disabled = true; });
    }
  } catch (error) {
    console.error("Change password auth check failed:", error);
    setMessage(error.message || "Unable to verify administrator account.", "error");
  }
});

changeButton?.addEventListener("click", async () => {
  if (!currentUser || !canChangeWithPassword) return;
  const current = currentInput.value;
  const next = newInput.value;
  const confirmNext = confirmInput.value;

  if (!current || !next || !confirmNext) return setMessage("Complete all password fields.", "error");
  if (next.length < 6) return setMessage("New password must contain at least 6 characters.", "error");
  if (next !== confirmNext) return setMessage("New passwords do not match.", "error");
  if (current === next) return setMessage("Choose a password different from your current password.", "error");

  changeButton.disabled = true;
  changeButton.textContent = "Updating…";
  setMessage("");
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, next);
    currentInput.value = "";
    newInput.value = "";
    confirmInput.value = "";
    setMessage("Password changed successfully.", "success");
  } catch (error) {
    console.error("Password update failed:", error);
    const friendly = {
      "auth/invalid-credential": "Current password is incorrect.",
      "auth/wrong-password": "Current password is incorrect.",
      "auth/weak-password": "Choose a stronger password.",
      "auth/requires-recent-login": "Please sign in again, then retry the password change."
    };
    setMessage(friendly[error.code] || error.message || "Unable to change password.", "error");
  } finally {
    changeButton.disabled = false;
    changeButton.textContent = "Update password";
  }
});

resetButton?.addEventListener("click", async () => {
  if (!currentUser?.email) return setMessage("No email address is linked to this account.", "error");
  resetButton.disabled = true;
  resetButton.textContent = "Sending…";
  setMessage("");
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    setMessage(`Password reset link sent to ${currentUser.email}. Check your inbox and spam folder.`, "success");
  } catch (error) {
    console.error("Password reset email failed:", error);
    setMessage(error.message || "Unable to send password reset email.", "error");
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Email reset link";
  }
});
