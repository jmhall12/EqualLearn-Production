import { loginUser, resetPassword } from "./auth.js";
import { showLoadingScreen } from "./loading-screen.js";
import { auth, db } from "./firebase-config.js";
import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberDeviceInput = document.getElementById("rememberDevice");

let autoRedirectStarted = false;
let loginInProgress = false;
let redirectStarted = false;

const ROUTES = {
  admin: "admin/dashboard.html",
  teacher: "teacher/dashboard.html",
  instructor: "teacher/dashboard.html",
  student: "student/dashboard.html"
};

function showMessage(text, type = "error") {
  if (!message) return;
  message.className = type;
  message.textContent = text;
}

function normalizedRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === "instructor" ? "teacher" : role;
}

function isReadOnlyDemo(profile) {
  const value = profile?.demoReadOnly;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function getAppHost() {
  try {
    return window.parent && window.parent !== window ? window.parent : window;
  } catch (_) {
    return window;
  }
}

// Prime TTS synchronously from the Sign in tap. The greeting is generic, so
// regular users also receive a brief welcome; only demo profiles get the
// persistent read-only guide and page-by-page narration.
function primeLumiFromLoginGesture() {
  const host = getAppHost();
  const greeting = "Welcome to EqualLearn. I am Lumi. Please wait while I securely open your workspace.";
  try {
    const voice = host.EqualLearnEvaluationVoice;
    if (voice?.primeFromGesture) {
      voice.primeFromGesture(null, greeting);
      return;
    }
  } catch (error) {
    console.debug("[LOGIN] Parent Lumi voice is not ready yet:", error);
  }

  // Fallback for a direct /login.html visit outside app.html.
  try {
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      const utterance = new SpeechSynthesisUtterance(greeting);
      utterance.lang = "en-US";
      utterance.rate = 0.96;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  } catch (error) {
    console.warn("[LOGIN] Lumi welcome voice could not start:", error);
  }
}

function setDemoSession(profile, uid) {
  const role = normalizedRole(profile?.role);
  if (!isReadOnlyDemo(profile) || !["admin", "teacher", "student"].includes(role)) {
    clearDemoSession();
    return false;
  }

  const session = {
    role,
    uid: String(uid || ""),
    demoReadOnly: true,
    startedAt: Date.now()
  };
  try {
    sessionStorage.setItem("equallearn.evaluationMode", JSON.stringify(session));
  } catch (_) {}

  try {
    getAppHost().EqualLearnEvaluationVoice?.setDemoProfile?.(role, profile);
  } catch (error) {
    console.warn("[LOGIN] Could not activate Lumi evaluation guide:", error);
  }
  return true;
}

function clearDemoSession() {
  try { sessionStorage.removeItem("equallearn.evaluationMode"); } catch (_) {}
  try { getAppHost().EqualLearnEvaluationVoice?.clearDemoProfile?.(); } catch (_) {}
}

function redirectByRole(role) {
  const normalized = normalizedRole(role);
  const destination = ROUTES[normalized];
  if (!destination) {
    redirectStarted = false;
    showMessage("Invalid account role: " + role);
    return;
  }
  if (redirectStarted) return;
  redirectStarted = true;

  showLoadingScreen(
    "Welcome to EqualLearn!",
    "Opening your dashboard..."
  );

  // The app.html host and its Lumi frame stay mounted when this inner page
  // navigates to the real role dashboard.
  setTimeout(() => {
    window.location.replace(destination);
  }, 120);
}

async function routeAuthenticatedProfile(profile, uid) {
  const role = normalizedRole(profile?.role);
  if (profile?.status !== "active" || !ROUTES[role]) {
    await signOut(auth).catch(() => {});
    clearDemoSession();
    throw new Error("Your account is inactive or has an invalid role. Please contact the administrator.");
  }

  if (isReadOnlyDemo(profile)) {
    // A shared evaluator device should not retain a persistent demo login.
    try { await setPersistence(auth, browserSessionPersistence); }
    catch (error) { console.warn("[LOGIN] Could not switch demo account to session-only persistence:", error); }
    setDemoSession(profile, uid);
  } else {
    clearDemoSession();
  }

  redirectByRole(role);
}

// Restore an existing Firebase session. Demo accounts are detected from
// users/{uid}; no separate Evaluation Mode button or role picker is needed.
onAuthStateChanged(auth, async user => {
  if (!user || loginInProgress || autoRedirectStarted || redirectStarted) return;
  autoRedirectStarted = true;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) throw new Error("Account profile not found.");
    await routeAuthenticatedProfile(snapshot.data(), user.uid);
  } catch (error) {
    console.warn("[LOGIN] Could not restore role route:", error);
    autoRedirectStarted = false;
    if (auth.currentUser && /profile not found|invalid role|inactive/i.test(error.message || "")) {
      await signOut(auth).catch(() => {});
    }
  }
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if (loginInProgress || redirectStarted) return;
  loginInProgress = true;

  const button = form.querySelector('button[type="submit"]');
  const originalButtonText = button?.textContent || "Sign in";
  if (button) {
    button.disabled = true;
    button.textContent = "Logging in...";
  }
  showMessage("", "");

  // Must run directly in the user gesture, before Firebase network requests.
  primeLumiFromLoginGesture();

  try {
    const result = await loginUser(
      emailInput?.value?.trim() || "",
      passwordInput?.value || "",
      rememberDeviceInput ? rememberDeviceInput.checked : true
    );

    if (!result.success) {
      showMessage(result.message || "Unable to log in.");
      try { getAppHost().EqualLearnEvaluationVoice?.stop?.(); } catch (_) {}
      loginInProgress = false;
      return;
    }

    const profile = result.user || {};
    await routeAuthenticatedProfile(profile, result.uid);
  } catch (error) {
    console.error("[LOGIN ERROR]", error);
    showMessage(error.message || "Unable to log in.");
    try { getAppHost().EqualLearnEvaluationVoice?.stop?.(); } catch (_) {}
    loginInProgress = false;
    redirectStarted = false;
  } finally {
    if (button && !redirectStarted) {
      button.disabled = false;
      button.textContent = originalButtonText;
    }
  }
});

// Forgot password remains unchanged for ordinary and demo users.
forgotPasswordLink?.addEventListener("click", async event => {
  event.preventDefault();
  const email = String(emailInput?.value || "").trim();
  if (!email) {
    showMessage("Enter your registered email address first.");
    emailInput?.focus();
    return;
  }

  const originalText = forgotPasswordLink.textContent;
  forgotPasswordLink.textContent = "Sending...";
  forgotPasswordLink.style.pointerEvents = "none";
  showMessage("", "");

  try {
    const result = await resetPassword(email);
    if (result.success) {
      showMessage(
        "If an account exists for this email, a password reset email will be sent. Check your inbox and spam folder.",
        "success"
      );
    } else {
      showMessage(result.message || "Unable to send the password reset email.");
    }
  } catch (error) {
    console.error("PASSWORD RESET ERROR:", error);
    showMessage(error.message || "Unable to reset password.");
  } finally {
    forgotPasswordLink.textContent = originalText;
    forgotPasswordLink.style.pointerEvents = "auto";
  }
});
