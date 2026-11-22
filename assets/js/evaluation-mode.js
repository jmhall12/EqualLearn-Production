import { auth, db } from "./firebase-config.js";
import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const ROLES = new Set(["admin", "teacher", "student"]);
const ROLE_LABELS = { admin: "Administrator", teacher: "Teacher", student: "Student" };
const ROLE_ROUTES = { admin: "/admin/dashboard.html", teacher: "/teacher/dashboard.html", student: "/student/dashboard.html" };
const panel = document.getElementById("evalLoginPanel");
const form = document.getElementById("evalLoginForm");
const emailInput = document.getElementById("evalEmail");
const passwordInput = document.getElementById("evalPassword");
const submitButton = document.getElementById("evalSubmit");
const message = document.getElementById("evalMessage");
const loading = document.getElementById("evalLoading");
const panelTitle = document.getElementById("evalPanelTitle");
let selectedRole = "";
let busy = false;

function isDemo(profile) {
  const value = profile?.demoReadOnly;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}
function active(profile) { return String(profile?.status || "").trim().toLowerCase() === "active"; }
function setMessage(text, type = "error") {
  message.textContent = text;
  message.className = `eval-message${type === "success" ? " success" : ""}`;
}
function setBusy(value) {
  busy = Boolean(value);
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Verifying demo account…" : "Open the real EqualLearn system";
  loading.classList.toggle("show", busy);
}
function openRolePanel(role) {
  if (!ROLES.has(role)) return;
  selectedRole = role;
  panelTitle.textContent = `Sign in as ${ROLE_LABELS[role]} Demo`;
  panel.hidden = false;
  setMessage("");
  emailInput.value = "";
  passwordInput.value = "";
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => emailInput.focus(), 180);
}
function primeLumiVoice(role) {
  const host = window.parent && window.parent !== window ? window.parent : window;
  const greeting = `Hello! Welcome to the EqualLearn ${ROLE_LABELS[role]} Evaluation. I am Lumi, your virtual system guide. You are now opening the real EqualLearn system in read-only mode. I will explain the current page and guide you as you explore. Let's begin.`;
  try {
    if (host.EqualLearnEvaluationVoice?.primeFromGesture) {
      host.EqualLearnEvaluationVoice.primeFromGesture(role, greeting);
      return;
    }
    host.__equalLearnEvaluationVoicePrimed = true;
    if (host.speechSynthesis && host.SpeechSynthesisUtterance) {
      const utterance = new host.SpeechSynthesisUtterance(greeting);
      utterance.lang = "en-US";
      utterance.rate = 0.96;
      utterance.pitch = 1.03;
      host.speechSynthesis.cancel();
      host.speechSynthesis.speak(utterance);
    }
  } catch (error) {
    console.warn("[Evaluation Mode] Lumi welcome voice could not start:", error);
  }
}
function openActualRoleDashboard(role) {
  const route = ROLE_ROUTES[role];
  if (!route) throw new Error("Unsupported demonstration role.");
  sessionStorage.setItem("equallearn.evaluationMode", JSON.stringify({ role, startedAt: Date.now() }));
  const host = window.parent && window.parent !== window ? window.parent : null;
  if (host?.EqualLearnEvaluationVoice?.setDemoProfile) {
    host.EqualLearnEvaluationVoice.setDemoProfile(role);
  }
  // Navigate the app's existing content frame to the real role dashboard.
  window.location.replace(`${route}?evaluation=1`);
}

for (const button of document.querySelectorAll("[data-select-role]")) {
  button.addEventListener("click", () => openRolePanel(String(button.dataset.selectRole || "").toLowerCase()));
}
document.getElementById("evalClosePanel")?.addEventListener("click", () => {
  if (!busy) panel.hidden = true;
});
document.getElementById("evalBackToLogin")?.addEventListener("click", event => {
  event.preventDefault();
  sessionStorage.removeItem("equallearn.evaluationMode");
  const destination = "/login.html";
  if (window.self !== window.top) window.location.replace(destination);
  else window.location.replace(`/app.html?path=${encodeURIComponent(destination)}`);
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !selectedRole) return;
  const email = String(emailInput.value || "").trim().toLowerCase();
  const password = String(passwordInput.value || "");
  if (!email || !password) { setMessage("Enter the demo account email and password."); return; }

  // Create the Lumi toolbar and start speech synchronously from the sign-in tap,
  // before awaiting Firebase. Stop Audio is visible immediately.
  primeLumiVoice(selectedRole);
  setBusy(true);
  setMessage("");
  try {
    // The actual dashboards use this same default Firebase Auth instance.
    // This is a separate dedicated UID, never the project's real staff account.
    if (auth.currentUser) await signOut(auth);
    await setPersistence(auth, browserSessionPersistence);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const snapshot = await getDoc(doc(db, "users", credential.user.uid));
    if (!snapshot.exists()) throw new Error("The demo account profile is missing. Create users/{UID} using the Firebase Authentication UID.");
    const profile = snapshot.data();
    const actualRole = String(profile.role || "").trim().toLowerCase();
    if (!active(profile) || actualRole !== selectedRole || !isDemo(profile)) {
      throw new Error("Access denied. This account must be an active, dedicated read-only demo account with the selected role and demoReadOnly: true.");
    }
    setMessage("Demo account verified. Opening the actual EqualLearn interface in read-only mode…", "success");
    openActualRoleDashboard(actualRole);
  } catch (error) {
    console.error("[EVALUATION MODE] Sign-in failed:", error);
    try { if (auth.currentUser) await signOut(auth); } catch (_) {}
    sessionStorage.removeItem("equallearn.evaluationMode");
    const host = window.parent && window.parent !== window ? window.parent : window;
    try { host.EqualLearnEvaluationVoice?.stop?.(); } catch (_) {}
    setMessage(error?.message || "Unable to open the demo account. Check the credentials and Firestore profile.");
  } finally {
    setBusy(false);
  }
});

// If the evaluator returns to this page while a valid demo session remains,
// reopen the real dashboard without asking them to sign in again.
onAuthStateChanged(auth, async user => {
  if (!user || busy) return;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) return;
    const profile = snapshot.data();
    const role = String(profile.role || "").trim().toLowerCase();
    if (active(profile) && ROLES.has(role) && isDemo(profile)) {
      sessionStorage.setItem("equallearn.evaluationMode", JSON.stringify({ role, startedAt: Date.now() }));
      openActualRoleDashboard(role);
    }
  } catch (error) {
    console.warn("[Evaluation Mode] Existing session check skipped:", error);
  }
});
