import { evaluationAuth, evaluationDb, isReadOnlyDemoProfile } from "./evaluation-config.js";
import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const ROLES = new Set(["admin", "teacher", "student"]);
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

function isActive(value) {
  return String(value || "").trim().toLowerCase() === "active";
}
function roleLabel(role) {
  return role === "admin" ? "Admin" : role === "teacher" ? "Teacher" : "Student";
}
function setMessage(text, type = "error") {
  message.textContent = text;
  message.className = `eval-message${type === "success" ? " success" : ""}`;
}
function setBusy(value) {
  busy = Boolean(value);
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "Verifying demo account…" : "Sign in to Evaluation Mode";
  loading.classList.toggle("show", busy);
}
function openRolePanel(role) {
  if (!ROLES.has(role)) return;
  selectedRole = role;
  panelTitle.textContent = `Sign in as ${roleLabel(role)} Demo`;
  panel.hidden = false;
  setMessage("");
  emailInput.value = "";
  passwordInput.value = "";
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => emailInput.focus(), 180);
}

for (const button of document.querySelectorAll("[data-select-role]")) {
  button.addEventListener("click", () => openRolePanel(button.dataset.selectRole));
}
document.getElementById("evalClosePanel")?.addEventListener("click", () => {
  if (!busy) panel.hidden = true;
});
document.getElementById("evalBackToLogin")?.addEventListener("click", event => {
  event.preventDefault();
  const destination = "/login.html";
  if (window.self !== window.top) window.location.replace(destination);
  else window.location.replace(`/app.html?path=${encodeURIComponent(destination)}`);
});

function primeLumiVoice(role) {
  const host = window.parent && window.parent !== window ? window.parent : window;
  const greeting = `Hello! Welcome to the EqualLearn ${roleLabel(role)} Evaluation Demo. I am Lumi, your virtual system guide. I will explain the pages and features as you explore. Let's begin.`;
  try {
    if (host.EqualLearnEvaluationVoice?.primeFromGesture) {
      host.EqualLearnEvaluationVoice.primeFromGesture(role);
      return;
    }
    // Fallback if the persistent host module is still initializing.
    host.__equalLearnEvaluationVoicePrimed = true;
    const native = Boolean(
      host.Capacitor?.isNativePlatform?.() ||
      ["android", "ios"].includes(host.Capacitor?.getPlatform?.())
    );
    if (native) {
      // Native TTS does not depend on browser autoplay permission. This fallback
      // also covers the rare case where the shell voice module has not loaded yet.
      import("https://esm.sh/@capacitor-community/text-to-speech@8.0.2?bundle")
        .then(module => module.TextToSpeech?.speak({
          text: greeting, lang: "en-US", rate: 0.96, pitch: 1.03, volume: 1, queueStrategy: 0
        }))
        .catch(error => console.warn("[EVALUATION MODE] Native welcome voice unavailable:", error));
    } else if (host.speechSynthesis && host.SpeechSynthesisUtterance) {
      const utterance = new host.SpeechSynthesisUtterance(greeting);
      utterance.lang = "en-US";
      utterance.rate = 0.96;
      utterance.pitch = 1.03;
      host.speechSynthesis.cancel();
      host.speechSynthesis.speak(utterance);
    }
  } catch (error) {
    console.warn("[EVALUATION MODE] Lumi voice could not start from the login gesture:", error);
  }
}

function stopLumiVoice() {
  const host = window.parent && window.parent !== window ? window.parent : window;
  try {
    if (host.EqualLearnEvaluationVoice?.stop) host.EqualLearnEvaluationVoice.stop();
    else host.speechSynthesis?.cancel?.();
  } catch (_) {}
}

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !selectedRole) return;
  const email = String(emailInput.value || "").trim().toLowerCase();
  const password = String(passwordInput.value || "");
  if (!email || !password) {
    setMessage("Enter the demo account email and password.");
    return;
  }

  // Start Lumi's welcome narration immediately in the real submit gesture.
  // Browsers commonly block speech that is first requested after async login.
  // The persistent app shell owns playback so navigation inside the page frame
  // does not stop the narration.
  primeLumiVoice(selectedRole);

  setBusy(true);
  setMessage("");
  try {
    // Evaluation Auth is a separate Firebase app. Do not sign out the evaluator's
    // regular production account; demo credentials never become the real role session.
    if (evaluationAuth.currentUser) await signOut(evaluationAuth);
    await setPersistence(evaluationAuth, browserSessionPersistence);

    const credential = await signInWithEmailAndPassword(evaluationAuth, email, password);
    const snapshot = await getDoc(doc(evaluationDb, "users", credential.user.uid));
    if (!snapshot.exists()) throw new Error("The demo account profile is missing. Check the Firebase users document whose ID matches this account's Authentication UID.");

    const profile = snapshot.data();
    const actualRole = String(profile.role || "").trim().toLowerCase();
    if (!isActive(profile.status) || actualRole !== selectedRole || !isReadOnlyDemoProfile(profile)) {
      throw new Error("This account is not marked as an active read-only demo for the selected role. Set demoReadOnly to Boolean true (or the text 'true' for compatibility), role to the selected role, and status to active in users/{UID}.");
    }

    const destination = `/evaluation-workspace.html?role=${encodeURIComponent(actualRole)}&page=overview`;
    setMessage("Demo account verified. Opening the isolated evaluation workspace…", "success");
    if (window.self !== window.top) {
      window.location.replace(destination);
    } else {
      window.location.replace(`/app.html?path=${encodeURIComponent(destination)}`);
    }
  } catch (error) {
    console.error("[EVALUATION MODE] Sign-in failed:", error);
    stopLumiVoice();
    if (evaluationAuth.currentUser) {
      try { await signOut(evaluationAuth); } catch (_) {}
    }
    setMessage(error?.message || "Unable to open the demo account. Check the demo credentials and profile.");
  } finally {
    setBusy(false);
  }
});

onAuthStateChanged(evaluationAuth, async user => {
  if (!user || busy) return;
  try {
    const snapshot = await getDoc(doc(evaluationDb, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    const role = String(profile?.role || "").trim().toLowerCase();
    if (profile && isActive(profile.status) && ROLES.has(role) && isReadOnlyDemoProfile(profile)) {
      setMessage(`An active read-only ${roleLabel(role)} demo session exists in this browser tab. Enter its credentials to continue.`, "success");
      openRolePanel(role);
    }
  } catch (error) {
    console.warn("[EVALUATION MODE] Could not inspect the existing demo session:", error);
  }
});
