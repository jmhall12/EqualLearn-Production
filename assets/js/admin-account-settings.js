import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const fullnameInput = document.getElementById("fullname");
const emailInput = document.getElementById("email");
const roleInput = document.getElementById("role");
const saveButton = document.getElementById("saveBtn");
const messageNode = document.getElementById("accountMessage");
let currentUser = null;
let originalName = "";

function setMessage(text, type = "") {
  if (!messageNode) return;
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
    if (!snapshot.exists()) throw new Error("Administrator profile not found.");
    const profile = snapshot.data();
    if (String(profile.role || "").toLowerCase() !== "admin" || String(profile.status || "active").toLowerCase() === "inactive") {
      window.location.href = "../login.html";
      return;
    }
    originalName = String(profile.fullname || profile.fullName || "");
    fullnameInput.value = originalName;
    emailInput.value = user.email || profile.email || "";
    roleInput.value = profile.role || "admin";
  } catch (error) {
    console.error("Account settings load error:", error);
    setMessage(error.message || "Unable to load administrator profile.", "error");
  }
});

saveButton?.addEventListener("click", async () => {
  if (!currentUser) return;
  const nextName = String(fullnameInput.value || "").trim();
  if (!nextName) {
    setMessage("Please enter your full name.", "error");
    fullnameInput.focus();
    return;
  }
  if (nextName.length > 100) {
    setMessage("Name must be 100 characters or fewer.", "error");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  setMessage("");
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { fullname: nextName });
    originalName = nextName;
    setMessage("Account information saved successfully.", "success");
  } catch (error) {
    console.error("Account settings save error:", error);
    setMessage(error.code === "permission-denied" ? "Permission denied. Check the users/{uid} update rule." : (error.message || "Unable to save account information."), "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
  }
});
