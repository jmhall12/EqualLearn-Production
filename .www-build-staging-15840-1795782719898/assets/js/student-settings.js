import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const welcome = document.getElementById("settingsWelcome");
const summary = document.getElementById("settingsAccountSummary");

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists()) throw new Error("Student profile not found.");
    const profile = profileSnap.data();
    if (String(profile.role || "").toLowerCase() !== "student") {
      location.replace("../login.html");
      return;
    }
    if (welcome) welcome.textContent = `Hello, ${profile.fullname || user.displayName || "Student"}`;
    if (summary) summary.textContent = `${user.email || profile.email || "Signed-in account"} · Student account · ${profile.section || profile.sectionName || profile.sectionId || "Section not assigned"}`;
  } catch (error) {
    console.error("Student settings could not load:", error);
    if (summary) summary.textContent = "Your account is signed in, but profile details could not be loaded.";
  }
});
