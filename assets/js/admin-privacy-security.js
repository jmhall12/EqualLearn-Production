import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const emailNode = $("privacyEmail");
const verifiedNode = $("privacyEmailVerified");
const statusNode = $("privacyAccountStatus");
const providerNode = $("privacyProvider");
const createdNode = $("privacyCreated");
const lastSignInNode = $("privacyLastSignIn");
const browserNode = $("privacyBrowser");
const signOutButton = $("signOutDevice");
const sessionMessage = $("sessionMessage");
let currentUser = null;

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
function setSessionMessage(text, type = "") {
  sessionMessage.textContent = text;
  sessionMessage.className = `admin-settings-message ${type}`.trim();
}
function getBrowserLabel() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Mozilla Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Current browser";
}

browserNode.textContent = getBrowserLabel();

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
    emailNode.textContent = user.email || profile.email || "No email on account";
    verifiedNode.textContent = user.emailVerified ? "Verified" : "Not verified";
    verifiedNode.style.color = user.emailVerified ? "#5ed0a7" : "#f2bd68";
    statusNode.textContent = String(profile.status || "active");
    statusNode.style.textTransform = "capitalize";
    providerNode.textContent = (user.providerData || []).map(item => item.providerId === "password" ? "Email & password" : item.providerId).join(", ") || "Not available";
    createdNode.textContent = formatDate(user.metadata?.creationTime);
    lastSignInNode.textContent = formatDate(user.metadata?.lastSignInTime);
  } catch (error) {
    console.error("Privacy/security details error:", error);
    setSessionMessage(error.message || "Unable to load account security details.", "error");
  }
});

signOutButton?.addEventListener("click", async () => {
  if (!currentUser) return;
  if (!confirm("Sign out of EqualLearn on this browser?")) return;
  signOutButton.disabled = true;
  try {
    await signOut(auth);
    window.location.href = "../login.html";
  } catch (error) {
    console.error("Sign out failed:", error);
    setSessionMessage(error.message || "Unable to sign out this device.", "error");
    signOutButton.disabled = false;
  }
});
