import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const nameNode = document.getElementById("settingsAdminName");
const emailNode = document.getElementById("settingsAdminEmail");
const avatarNode = document.getElementById("settingsAvatar");
let handledUser = null;

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  if (handledUser === user.uid) return;
  handledUser = user.uid;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists()) throw new Error("Administrator profile not found.");
    const profile = profileSnap.data();
    const role = String(profile.role || "").trim().toLowerCase();
    if (role !== "admin" || String(profile.status || "active").toLowerCase() === "inactive") {
      alert("Access denied. Active administrator access is required.");
      window.location.href = "../login.html";
      return;
    }

    const name = String(profile.fullname || profile.fullName || user.displayName || "Administrator").trim();
    if (nameNode) nameNode.textContent = name;
    if (emailNode) emailNode.textContent = user.email || profile.email || "No email available";
    if (avatarNode) avatarNode.textContent = (name[0] || "A").toUpperCase();
  } catch (error) {
    console.error("Admin settings hub load failed:", error);
    if (nameNode) nameNode.textContent = "Administrator";
    if (emailNode) emailNode.textContent = "Account details unavailable";
  }
});

// Keep the menu tidy: only one accordion group stays open at a time.
document.querySelectorAll(".admin-settings-group").forEach(group => {
  group.addEventListener("toggle", () => {
    if (!group.open) return;
    document.querySelectorAll(".admin-settings-group").forEach(other => {
      if (other !== group) other.open = false;
    });
  });
});
