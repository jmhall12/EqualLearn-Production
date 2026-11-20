import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const formatDate = value => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || String(snap.data().role || "").toLowerCase() !== "student") {
      location.replace("../login.html");
      return;
    }
    const profile = snap.data();
    const providers = [...new Set((user.providerData || []).map(item => {
      if (item.providerId === "password") return "Email & password";
      if (item.providerId === "google.com") return "Google";
      return item.providerId.replace(/\.com$/i, "");
    }))];

    $("privacyEmail").textContent = user.email || profile.email || "Not available";
    $("privacyEmailVerified").textContent = user.emailVerified ? "Verified" : "Not verified";
    $("privacyAccountStatus").textContent = profile.status || "Not specified";
    $("privacyProvider").textContent = providers.join(", ") || "Not available";
    $("privacyCreated").textContent = formatDate(user.metadata?.creationTime);
    $("privacyLastSignIn").textContent = formatDate(user.metadata?.lastSignInTime);
    $("privacyDeviceInfo").textContent = `Signed in as ${user.email || "your EqualLearn account"} in this browser. Signing out here ends this browser session only.`;
    $("privacyMessage").textContent = "Security information loaded from your authenticated Firebase account.";
  } catch (error) {
    console.error("Privacy/security page failed to load:", error);
    $("privacyMessage").textContent = error.message || "Unable to load account security information.";
    $("privacyMessage").classList.add("error");
  }
});

$("signOutDevice")?.addEventListener("click", async () => {
  const button = $("signOutDevice");
  const message = $("sessionMessage");
  if (!confirm("Sign out of EqualLearn on this device?")) return;
  if (button) button.disabled = true;
  if (message) message.textContent = "Signing out…";
  try {
    await signOut(auth);
    location.replace("../login.html");
  } catch (error) {
    console.error("Sign out failed:", error);
    if (message) {
      message.textContent = error.message || "Unable to sign out this device.";
      message.classList.add("error");
    }
    if (button) button.disabled = false;
  }
});
