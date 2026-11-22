import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const pageFrame = document.getElementById("equallearn-page-frame");
const lumiCompanionFrame = document.getElementById("equallearn-lumi-frame");
const ROLE_NAMES = { admin: "Administrator", teacher: "Teacher", student: "Student" };
const ROLE_HOME = { admin: "/admin/dashboard.html", teacher: "/teacher/dashboard.html", student: "/student/dashboard.html" };
const GUIDE = {
  admin: {
    "dashboard": "This is the Administrator Dashboard. It gives the administrator an overview of the EqualLearn platform, including registered users, teaching resources, learning activities, and platform activity. Use the navigation menu to explore user management, content workflow, assignments, reports, and system settings.",
    "students": "This is Student Management. The administrator can review student accounts, registration details, verification status, and class or section information. In Evaluation Mode, records are visible for inspection only. Account creation, editing, verification, and deletion are disabled.",
    "manage-teachers": "This is Teacher Management. It allows administrators to review teacher accounts, assigned sections, and account status. The evaluator can inspect the real interface and available information, but cannot add, edit, deactivate, or remove teacher accounts.",
    "register-teacher": "This is the Register Teacher page. It is normally used by an administrator to create a teacher account. In Evaluation Mode, the form is locked and cannot create an account. This page is shown so the evaluator can inspect the feature and its fields.",
    "class-assignments": "This is Class Assignments. Administrators can review the relationship between classes, sections, teachers, and learning content. Assignment controls are disabled during this evaluation so existing class configurations cannot be changed.",
    "check-content": "This is the content review area. Administrators can inspect lessons and modules submitted to the platform and review their workflow status. The evaluator can browse the actual records allowed to this account, but cannot change approval or publication states.",
    "create-content": "This is the Create Content area. Administrators prepare gender equality lessons and learning modules here. The page demonstrates the actual content editor and its organization fields; all create, upload, edit, and publish actions are blocked for demo accounts.",
    "lessons": "This is the Administrator Lessons area. It is used to prepare and organize gender equality learning resources. Admin-originated content is intended for teacher review before teachers select the sections where approved materials will be published.",
    "reports": "This is Reports and Analytics. Administrators use this area to review platform activity and learning information. The values shown come from the system data that this demo account is permitted to read. Report generation or export actions that write data are disabled.",
    "live": "This is the Live Sessions area for administrators. It allows the administrator to inspect classroom session information. Demo accounts cannot create, join, start, stop, or modify live sessions.",
    "settings": "This is System Settings. It shows the administrative configuration and preferences available in EqualLearn. Settings can be inspected, but saving or changing configuration is disabled in Evaluation Mode.",
    "account-settings": "This is Account Settings. It presents the administrator account information and account-level preferences. The evaluation account can view this page, but cannot change account details or security settings.",
    "change-password": "This is the Change Password page. It normally lets the account owner update their password. For safety, password changes are disabled in Evaluation Mode.",
    "privacy-security": "This is Privacy and Security. It describes account protection and privacy options for administrators. Controls that would change security settings are locked for the evaluation account.",
    "recent-activity": "This is Recent Activity. It displays the activity history that the administrator is permitted to review. Use it to understand how platform actions and changes are monitored. The evaluation account cannot create or edit activity records."
  },
  teacher: {
    "dashboard": "This is the Teacher Dashboard. It brings together assigned classes, student information, learning materials, activities, and classroom tools. Use the menu to explore each teaching feature. This is the real EqualLearn interface operating under a read-only demo account.",
    "classes": "This is My Classes. Teachers use this page to review their assigned sections and class details. Section information and linked learner data are displayed according to the demo account's assigned permissions. Changes to class assignments are blocked.",
    "modules": "This is Learning Modules. Teachers can inspect available learning modules and resources. Administrator-provided content should be reviewed before a teacher assigns or publishes it to selected sections. Module creation and editing are disabled in Evaluation Mode.",
    "module-details": "This is the Module Details page. It displays the contents and organization of a selected learning module. The evaluator can inspect its information, but cannot edit, upload, or publish module content.",
    "lessons": "This is Teacher Lessons. Teachers review lesson materials and prepare them for their classes. The content workflow requires teachers to review administrator-provided resources and choose the sections that should receive approved materials. All write actions are disabled in this evaluation.",
    "students": "This is the Teacher Students page. It allows teachers to review learners in the sections assigned to them. The data shown is limited by the teacher account's section permissions. Profile edits, grading changes, and account actions are blocked.",
    "admin-content": "This is Admin Content Review. It shows learning resources provided by the administrator for teacher review. The teacher checks the resource and decides whether it is appropriate for the assigned sections. Only after teacher publication should the resource become visible to students. Approval and assignment actions are disabled in Evaluation Mode.",
    "grading": "This is Activity Grading. Teachers use this area to review student submissions, scores, and feedback. The evaluator can inspect the grading interface and permitted records, but cannot enter scores, provide feedback, or change submissions.",
    "quiz_builder": "This is the Quiz Builder. Teachers use it to prepare quizzes and assessment questions for their classes. The evaluator can inspect the builder layout, but cannot create, edit, publish, or assign quizzes.",
    "resources": "This is Learning Resources. It organizes supporting materials such as documents, videos, and links for teaching. Resource upload and editing controls are locked during this read-only demonstration.",
    "live": "This is Teacher Live Class. It is used to manage section-based classroom sessions and interact with students during a live meeting. In Evaluation Mode, starting, joining, or ending real calls is disabled to avoid disrupting an actual class."
  },
  student: {
    "dashboard": "This is the Student Dashboard. It provides the student with an overview of available modules, classwork, quizzes, progress, and announcements. The information shown is limited to what the student demo account is permitted to access.",
    "modules": "This is Learning Modules. Students browse the learning materials published by their teacher for the selected section. Administrator content is not automatically visible; teachers review and publish resources to their sections first.",
    "classwork": "This is Classwork. It presents activities assigned by the teacher to the student's section, including instructions and relevant due dates. The evaluator can inspect the actual classwork view, but cannot submit or change work.",
    "assignment": "This is the Assignment page. It displays the instructions and details for a selected assignment. Submission and attachment upload are disabled for demo accounts so no student work is changed.",
    "quizzes": "This is Quizzes. Students can review assessments made available to their class. The evaluator can inspect the quiz list, but starting an attempt or submitting answers is disabled.",
    "quiz": "This is the Quiz page. It shows the assessment interface that students use to answer quiz questions. In Evaluation Mode, answer submission and attempt recording are blocked.",
    "quiz-result": "This is Quiz Results. Students can review results and feedback for completed quizzes that their account is allowed to see. The evaluator cannot change saved scores or attempts.",
    "progress": "This is My Progress. It summarizes the student's learning progress across modules, classwork, and quizzes. It helps students understand completed and pending activities. Progress records cannot be changed by a demo account.",
    "announcement": "This is Announcements. Students can view important notices shared by their teachers or administrators. The page is for reading information; demo accounts cannot post or modify announcements.",
    "profile": "This is My Profile. It displays the student's profile information and account details. The evaluation account can inspect the page but cannot edit personal or academic information.",
    "settings": "This is Student Settings. It contains the preferences available to a student account. Any setting that would save a change is disabled for Evaluation Mode.",
    "change-password": "This is Change Password. It normally allows a student to update their password. Password changes are disabled for the evaluation account.",
    "privacy-security": "This is Privacy and Security. It explains the student's account privacy and security information. The evaluator may inspect the page, but cannot update security settings.",
    "recent-activity": "This is Recent Activity. It lets a student review recent actions and learning activity associated with the account. The information is read-only during this demonstration.",
    "live": "This is Student Live. It is the area used to access classroom live sessions. During Evaluation Mode, the demo account cannot join or interact with a real live meeting.",
    "lesson": "This is the Lesson page. Students open the lesson materials made available by their teacher and review the learning content. Lesson viewing is available, while any submission or completion changes are disabled for the demo account."
  }
};

let demoProfile = null;
let voiceEnabled = true;
let lastNarration = "";
let lastPageKey = "";
let welcomePrimed = false;
let voiceQueue = Promise.resolve();
let nativeTtsPromise = null;
let routeGuardBusy = false;
let demoCompanionSuppressed = false;
let browserSpeechQueue = [];
let browserSpeechCurrent = "";
let browserSpeechActive = false;
let browserSpeechSession = 0;
let browserSpeechStartedAt = 0;
let browserSpeechRetryCount = 0;
const TTS_URL = "https://esm.sh/@capacitor-community/text-to-speech@8.0.2?bundle";

function isDemo(profile) {
  const value = profile?.demoReadOnly;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

// Remove the obsolete separate Evaluation Mode entry button wherever older
// landing-page markup or cached content still renders it. Demo detection now
// happens automatically after the ordinary login form authenticates users.
function removeEvaluationEntryCTA(root = pageFrame?.contentDocument) {
  if (!root) return;
  const selector = "a,button,[role=button],[onclick],[data-href],[data-evaluation-entry]";
  const candidates = [];
  if (root?.nodeType === 1 && root.matches(selector)) candidates.push(root);
  root.querySelectorAll?.(selector).forEach(el => candidates.push(el));
  for (const el of candidates) {
    const label = String(el.innerText || el.textContent || "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    let href = "";
    try { href = new URL(el.getAttribute("href") || "", root.location?.href || window.location.href).pathname.toLowerCase(); } catch (_) {}
    if (label === "explore evaluation mode" || el.hasAttribute("data-evaluation-entry") ||
        (label.includes("explore evaluation mode") && href.endsWith("/evaluation.html"))) {
      el.remove();
    }
  }
}
let evaluationEntryObserver = null;
function observeEvaluationEntryCTA() {
  const childDoc = pageFrame?.contentDocument;
  if (!childDoc?.body) return;
  removeEvaluationEntryCTA(childDoc);
  if (evaluationEntryObserver) evaluationEntryObserver.disconnect();
  evaluationEntryObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node?.nodeType === 1) removeEvaluationEntryCTA(node);
      }
    }
  });
  evaluationEntryObserver.observe(childDoc.body, { childList: true, subtree: true });
}
function isNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.() || ["android", "ios"].includes(window.Capacitor?.getPlatform?.()));
}
function loadNativeTts() {
  if (!isNative()) return Promise.resolve(null);
  if (!nativeTtsPromise) {
    nativeTtsPromise = import(TTS_URL).then(mod => {
      if (!mod?.TextToSpeech) throw new Error("Text-to-Speech plugin is not registered.");
      return mod.TextToSpeech;
    }).catch(error => {
      console.warn("[EqualLearn Evaluation] Native TTS unavailable; using browser speech fallback.", error);
      nativeTtsPromise = null;
      return null;
    });
  }
  return nativeTtsPromise;
}
function splitSpeechText(value, maxLength = 175) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
  const chunks = [];
  let current = "";
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if ((current + " " + sentence).trim().length <= maxLength) {
      current = (current + " " + sentence).trim();
      continue;
    }
    if (current) chunks.push(current);
    current = "";
    if (sentence.length <= maxLength) {
      current = sentence;
      continue;
    }
    const words = sentence.split(/\s+/);
    for (const word of words) {
      if (!current) current = word;
      else if ((current + " " + word).length <= maxLength) current += " " + word;
      else { chunks.push(current); current = word; }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
function pumpBrowserSpeech(session = browserSpeechSession) {
  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance || session !== browserSpeechSession || browserSpeechActive || !voiceEnabled) return;
  const text = browserSpeechQueue.shift();
  if (!text) { browserSpeechCurrent = ""; return; }
  browserSpeechCurrent = text;
  browserSpeechActive = true;
  browserSpeechStartedAt = Date.now();
  let settled = false;
  const finish = (retry = false) => {
    if (settled || session !== browserSpeechSession) return;
    settled = true;
    browserSpeechActive = false;
    if (retry && browserSpeechRetryCount < 3) {
      browserSpeechQueue.unshift(text);
      browserSpeechRetryCount += 1;
    } else {
      browserSpeechCurrent = "";
      browserSpeechRetryCount = 0;
    }
    window.setTimeout(() => pumpBrowserSpeech(session), retry ? 380 : 120);
  };
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => finish(false);
    utterance.onerror = event => {
      const retryable = ["interrupted", "canceled", "audio-busy", "network"].includes(event?.error);
      finish(retryable);
    };
    synth.speak(utterance);
  } catch (error) {
    console.warn("[EqualLearn Evaluation] Browser TTS error:", error);
    finish(false);
  }
}
function browserSpeak(text, interrupt = false) {
  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) return false;
  try {
    if (interrupt) {
      browserSpeechSession += 1;
      browserSpeechQueue = [];
      browserSpeechCurrent = "";
      browserSpeechActive = false;
      browserSpeechRetryCount = 0;
      synth.cancel();
    }
    const chunks = splitSpeechText(text);
    if (!chunks.length) return false;
    browserSpeechQueue.push(...chunks);
    // Start the first segment synchronously when called from the Sign in tap.
    pumpBrowserSpeech(browserSpeechSession);
    return true;
  } catch (error) {
    console.warn("[EqualLearn Evaluation] Browser TTS error:", error);
    return false;
  }
}
function recoverBrowserSpeech() {
  if (!voiceEnabled || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  try {
    if (synth.paused) {
      synth.resume();
      return;
    }
    // Some mobile browsers interrupt Web Speech when the on-screen keyboard
    // opens. Re-queue only the active short segment if playback truly vanished.
    if (browserSpeechActive && browserSpeechCurrent && !synth.speaking &&
        Date.now() - browserSpeechStartedAt > 1400) {
      const current = browserSpeechCurrent;
      browserSpeechSession += 1; // invalidate a late onend/onerror from the lost utterance
      browserSpeechActive = false;
      browserSpeechCurrent = "";
      browserSpeechQueue.unshift(current);
      try { synth.cancel(); } catch (_) {}
      pumpBrowserSpeech(browserSpeechSession);
      return;
    }
    if (!browserSpeechActive && browserSpeechQueue.length) pumpBrowserSpeech(browserSpeechSession);
  } catch (error) {
    console.debug("[EqualLearn Evaluation] Mobile speech recovery deferred:", error);
  }
}
function installSpeechRecovery(targetDocument) {
  if (!targetDocument || targetDocument.__equalLearnSpeechRecovery) return;
  targetDocument.__equalLearnSpeechRecovery = true;
  targetDocument.addEventListener("focusin", () => window.setTimeout(recoverBrowserSpeech, 250), true);
  targetDocument.addEventListener("pointerup", () => window.setTimeout(recoverBrowserSpeech, 180), { capture: true, passive: true });
}
function setDemoCompanionSuppressed(active) {
  const frame = lumiCompanionFrame;
  const next = Boolean(active);
  const wasSuppressed = demoCompanionSuppressed || frame?.dataset.equallearnDemoSuppressed === "true";
  demoCompanionSuppressed = next;
  if (!frame) return;
  if (next) {
    frame.dataset.equallearnDemoSuppressed = "true";
    frame.style.setProperty("display", "none", "important");
    frame.style.setProperty("visibility", "hidden", "important");
    frame.style.setProperty("pointer-events", "none", "important");
    document.getElementById("lumi-reopen")?.remove();
  } else if (wasSuppressed) {
    delete frame.dataset.equallearnDemoSuppressed;
    frame.style.removeProperty("display");
    frame.style.removeProperty("visibility");
    frame.style.removeProperty("pointer-events");
    document.getElementById("lumi-reopen")?.remove();
  }
  if (next || wasSuppressed) {
    try {
      frame.contentWindow?.postMessage({ type: "EQUALLEARN_DEMO_MODE", active: next }, window.location.origin);
    } catch (_) {}
  }
  if (pageFrame?.contentDocument?.documentElement) {
    pageFrame.contentDocument.documentElement.dataset.equallearnDemoReadOnly = String(next);
    if (next) pageFrame.contentDocument.getElementById("equallearn-lumi-frame")?.remove();
  }
}
async function stopVoice() {
  voiceQueue = Promise.resolve();
  browserSpeechSession += 1;
  browserSpeechQueue = [];
  browserSpeechCurrent = "";
  browserSpeechActive = false;
  browserSpeechRetryCount = 0;
  try { window.speechSynthesis?.cancel?.(); } catch (_) {}
  try {
    const tts = await loadNativeTts();
    await tts?.stop?.();
  } catch (error) { console.warn("[EqualLearn Evaluation] Native TTS stop failed:", error); }
}
function speak(text, { interrupt = false, fromGesture = false } = {}) {
  const clean = String(text || "").trim();
  if (!clean || !voiceEnabled) return Promise.resolve(false);
  if (!isNative()) return Promise.resolve(browserSpeak(clean, interrupt));
  const task = voiceQueue.then(async () => {
    const tts = await loadNativeTts();
    if (!tts) return browserSpeak(clean, interrupt);
    if (interrupt) await tts.stop().catch(() => {});
    try {
      await tts.speak({ text: clean, lang: "en-US", rate: 0.96, pitch: 1.02, volume: 1, queueStrategy: interrupt ? 0 : 1 });
      return true;
    } catch (error) {
      console.warn("[EqualLearn Evaluation] Native TTS failed:", error);
      return browserSpeak(clean, interrupt);
    }
  });
  voiceQueue = task.catch(error => { console.warn("[EqualLearn Evaluation] TTS queue error:", error); return false; });
  return voiceQueue;
}

function ensureToolbar() {
  if (document.getElementById("equallearn-eval-toolbar")) return;
  const style = document.createElement("style");
  style.id = "equallearn-eval-toolbar-style";
  style.textContent = `
    #equallearn-eval-toolbar{position:fixed;z-index:2147483000;right:14px;bottom:14px;top:auto;left:auto;width:min(410px,calc(100vw - 28px));max-height:min(42vh,290px);overflow:auto;padding:11px 12px;border:1px solid rgba(157,134,255,.36);border-radius:14px;background:rgba(10,15,30,.97);box-shadow:0 14px 34px rgba(0,0,0,.38);backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif;color:#eef3ff}
    #equallearn-eval-toolbar .evalr-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
    #equallearn-eval-toolbar .evalr-brand{font-size:11px;font-weight:900;letter-spacing:.04em;color:#c8baff;white-space:nowrap}
    #equallearn-eval-toolbar .evalr-top-actions{display:flex;align-items:center;gap:6px}
    #equallearn-eval-toolbar .evalr-status{font-size:9px;font-weight:850;letter-spacing:.04em;color:#a7e8c9;border:1px solid rgba(102,213,164,.28);background:rgba(102,213,164,.09);padding:4px 7px;border-radius:99px;white-space:nowrap}
    #equallearn-eval-toolbar .evalr-title{font-weight:850;font-size:13px;color:#fff;margin:0 0 4px}
    #equallearn-eval-toolbar .evalr-text{margin:0;color:#cbd5e8;font-size:11px;line-height:1.5;max-height:86px;overflow:auto}
    #equallearn-eval-toolbar .evalr-actions{display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap}
    #equallearn-eval-toolbar button{appearance:none;border:1px solid rgba(167,184,225,.23);background:rgba(255,255,255,.075);color:#eaf0ff;padding:7px 10px;border-radius:9px;font:750 10px system-ui;cursor:pointer;white-space:nowrap}
    #equallearn-eval-toolbar button:hover{background:rgba(156,140,255,.18)}
    #equallearn-eval-toolbar #equallearn-eval-stop{border-color:rgba(255,112,125,.6);background:rgba(178,48,67,.3);color:#ffd6da;font-weight:950}
    #equallearn-eval-toolbar #equallearn-eval-exit{border-color:rgba(255,135,149,.3);color:#ffc0c8}
    #equallearn-eval-toolbar.is-collapsed{width:auto;max-width:calc(100vw - 20px);max-height:none;overflow:visible;padding:7px 9px;border-radius:999px}
    #equallearn-eval-toolbar.is-collapsed .evalr-status,#equallearn-eval-toolbar.is-collapsed .evalr-title,#equallearn-eval-toolbar.is-collapsed .evalr-text,#equallearn-eval-toolbar.is-collapsed .evalr-actions{display:none!important}
    #equallearn-eval-toolbar.is-collapsed .evalr-top{margin:0;gap:8px}
    #equallearn-eval-toolbar #equallearn-eval-stop{padding:7px 10px}
    #equallearn-eval-toolbar #equallearn-eval-collapse{padding:7px 9px;min-width:34px}
    @media(max-width:600px){#equallearn-eval-toolbar{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:36vh;padding:9px 10px}#equallearn-eval-toolbar .evalr-text{font-size:10px;max-height:65px}#equallearn-eval-toolbar button{padding:7px 9px;font-size:10px}#equallearn-eval-toolbar.is-collapsed{width:auto;max-width:calc(100vw - 16px)}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.id = "equallearn-eval-toolbar";
  panel.setAttribute("aria-label", "Lumi guided read-only evaluation controls");
  panel.innerHTML = `<div class="evalr-top"><span class="evalr-brand">✦ Lumi · Guided Evaluation</span><div class="evalr-top-actions"><button type="button" id="equallearn-eval-stop" aria-label="Stop Lumi narration">■ Stop Audio</button><button type="button" id="equallearn-eval-collapse" aria-label="Collapse Lumi guide" aria-expanded="true">−</button></div></div><span class="evalr-status">READ-ONLY · REAL SYSTEM</span><p class="evalr-title" id="equallearn-eval-title">Welcome to EqualLearn</p><p class="evalr-text" id="equallearn-eval-text">Lumi is ready to guide the evaluator through the actual EqualLearn application.</p><div class="evalr-actions"><button type="button" id="equallearn-eval-replay">▶ Replay</button><button type="button" id="equallearn-eval-voice">Voice: On</button><button type="button" id="equallearn-eval-exit">Exit Evaluation</button></div>`;
  document.body.appendChild(panel);
  panel.querySelector("#equallearn-eval-stop").addEventListener("click", () => { void stopVoice(); });
  panel.querySelector("#equallearn-eval-collapse").addEventListener("click", event => {
    const collapsed = panel.classList.toggle("is-collapsed");
    event.currentTarget.textContent = collapsed ? "+" : "−";
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    event.currentTarget.setAttribute("aria-label", collapsed ? "Expand Lumi guide" : "Collapse Lumi guide");
  });
  panel.querySelector("#equallearn-eval-replay").addEventListener("click", () => { void speak(lastNarration, { interrupt: true }); });
  panel.querySelector("#equallearn-eval-voice").addEventListener("click", event => {
    voiceEnabled = !voiceEnabled;
    event.currentTarget.textContent = `Voice: ${voiceEnabled ? "On" : "Off"}`;
    if (!voiceEnabled) void stopVoice(); else if (lastNarration) void speak(lastNarration, { interrupt: true });
  });
  panel.querySelector("#equallearn-eval-exit").addEventListener("click", exitEvaluation);
}
function setToolbarText(title, text) {
  ensureToolbar();
  const titleEl = document.getElementById("equallearn-eval-title");
  const textEl = document.getElementById("equallearn-eval-text");
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
}
function primeFromGesture(role, customGreeting = "") {
  voiceEnabled = true;
  welcomePrimed = true;
  const greeting = customGreeting || `Hello! Welcome to the EqualLearn ${ROLE_NAMES[role] || "Evaluation"}. I am Lumi, your virtual system guide. You are opening the actual EqualLearn application in read-only mode. I will explain the pages as you explore. Let's begin.`;
  lastNarration = greeting;
  // Do not display the evaluation toolbar for ordinary accounts. The toolbar
  // appears only after Firebase confirms demoReadOnly on users/{uid}.
  if (demoProfile || document.getElementById("equallearn-eval-toolbar")) {
    setToolbarText("Welcome to EqualLearn", greeting);
  }
  // Called synchronously from the ordinary Sign in click to unlock web TTS.
  return speak(greeting, { interrupt: true, fromGesture: true });
}
function getCurrentUrl() {
  try { return new URL(pageFrame.contentWindow.location.href); } catch (_) { return null; }
}
function getPageInfo() {
  const url = getCurrentUrl();
  if (!url) return null;
  const match = url.pathname.toLowerCase().match(/^\/(admin|teacher|student)\/([^/]+)\.html$/);
  if (!match) return { role: null, page: "", url, title: "EqualLearn" };
  const role = match[1];
  const page = match[2];
  let title = "";
  try { title = String(pageFrame.contentDocument?.title || "").replace(/\s*[|–—-]\s*EqualLearn/ig, "").trim(); } catch (_) {}
  if (!title) title = page.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { role, page, url, title };
}
function guideFor(info) {
  if (!info?.role || !info?.page) return "You are viewing the EqualLearn application. Use the navigation menu to explore the available pages. Lumi will describe each page and its purpose. The demo account is read-only.";
  return GUIDE[info.role]?.[info.page] || `This is ${info.title}. This area is part of the ${ROLE_NAMES[info.role]} workspace in EqualLearn. The evaluator can inspect the page and the information permitted to this account. All operations that would create, edit, delete, submit, upload, publish, or change records are disabled in Evaluation Mode.`;
}
function routeToRoleHome(role) {
  const destination = ROLE_HOME[role];
  if (destination && pageFrame) pageFrame.src = `${destination}?evaluation=1`;
}
function updateCurrentPageNarration() {
  if (!demoProfile) return;
  const info = getPageInfo();
  if (!info?.role) return;
  if (info.role !== demoProfile.role) {
    if (!routeGuardBusy) {
      routeGuardBusy = true;
      routeToRoleHome(demoProfile.role);
      setTimeout(() => { routeGuardBusy = false; }, 450);
    }
    return;
  }
  const guide = guideFor(info);
  const key = `${info.role}/${info.page}`;
  if (key === lastPageKey) return;
  lastPageKey = key;
  lastNarration = `${info.title}. ${guide}`;
  setToolbarText(`${ROLE_NAMES[info.role]} · ${info.title}`, guide);
  const shouldQueueAfterWelcome = welcomePrimed;
  welcomePrimed = false;
  // Keep the initial system explanation after the login greeting. On later
  // page navigation, interrupt the old page explanation and narrate the new one.
  void speak(lastNarration, { interrupt: !shouldQueueAfterWelcome });
}
function enforceLiveRoleRoute() {
  if (!demoProfile || routeGuardBusy) return;
  const info = getPageInfo();
  if (!info) return;
  if (info.role === null) {
    const path = info.url.pathname.toLowerCase();
    if (path === "/evaluation.html") {
      routeToRoleHome(demoProfile.role);
      return;
    }
    if (path === "/login.html" || path === "/index.html" || path === "/") return;
    routeToRoleHome(demoProfile.role);
    return;
  }
  if (info.role !== demoProfile.role) {
    routeToRoleHome(demoProfile.role);
    return;
  }
  updateCurrentPageNarration();
}
async function exitEvaluation() {
  await stopVoice();
  setDemoCompanionSuppressed(false);
  try { await signOut(auth); } catch (error) { console.warn("[EqualLearn Evaluation] Sign out warning:", error); }
  sessionStorage.removeItem("equallearn.evaluationMode");
  demoProfile = null;
  lastPageKey = "";
  welcomePrimed = false;
  document.getElementById("equallearn-eval-toolbar")?.remove();
  document.getElementById("equallearn-eval-toolbar-style")?.remove();
  if (pageFrame) pageFrame.src = "/login.html";
}

window.EqualLearnEvaluationVoice = {
  primeFromGesture,
  setDemoProfile(role, profile = {}) {
    if (ROLE_HOME[role]) {
      setDemoCompanionSuppressed(true);
      demoProfile = { role, name: profile.fullname || profile.fullName || "Evaluator" };
      lastPageKey = "";
      ensureToolbar();
      const info = getPageInfo();
      if (info?.role === role) updateCurrentPageNarration();
    }
  },
  clearDemoProfile() {
    setDemoCompanionSuppressed(false);
    demoProfile = null;
    lastPageKey = "";
    welcomePrimed = false;
    document.getElementById("equallearn-eval-toolbar")?.remove();
    document.getElementById("equallearn-eval-toolbar-style")?.remove();
  },
  speak: (text, options) => speak(text, options || {}),
  stop: stopVoice,
  setEnabled(enabled) {
    voiceEnabled = Boolean(enabled);
    if (!voiceEnabled) void stopVoice(); else if (lastNarration) void speak(lastNarration, { interrupt: true });
    return voiceEnabled;
  },
  isEnabled: () => voiceEnabled,
  isNative
};

function attachPageRouteObservers() {
  try {
    const childWindow = pageFrame?.contentWindow;
    const childDocument = pageFrame?.contentDocument;
    if (!childWindow || !childDocument) return;
    const notifyRoute = () => {
      if (!demoProfile) return;
      // Let the page's own router finish updating its URL/title before narrating.
      requestAnimationFrame(() => enforceLiveRoleRoute());
    };
    if (!childWindow.__equalLearnEvalRouteHooks) {
      childWindow.__equalLearnEvalRouteHooks = true;
      for (const method of ["pushState", "replaceState"]) {
        const original = childWindow.history[method].bind(childWindow.history);
        childWindow.history[method] = (...args) => {
          const result = original(...args);
          notifyRoute();
          return result;
        };
      }
      childWindow.addEventListener("popstate", notifyRoute);
      childWindow.addEventListener("hashchange", notifyRoute);
    }
    if (childDocument.documentElement && !childDocument.documentElement.__equalLearnEvalTitleObserver) {
      const titleObserver = new MutationObserver(notifyRoute);
      const titleNode = childDocument.querySelector("title");
      if (titleNode) titleObserver.observe(titleNode, { childList: true, subtree: true, characterData: true });
      childDocument.documentElement.__equalLearnEvalTitleObserver = titleObserver;
    }
    notifyRoute();
  } catch (error) {
    console.debug("[EqualLearn Evaluation] Route observer attach deferred:", error);
  }
}

pageFrame?.addEventListener("load", () => {
  installSpeechRecovery(pageFrame.contentDocument);
  if (demoProfile && pageFrame.contentDocument?.documentElement) {
    pageFrame.contentDocument.documentElement.dataset.equallearnDemoReadOnly = "true";
    pageFrame.contentDocument.getElementById("equallearn-lumi-frame")?.remove();
  }
  // The obsolete CTA is removed on every app page, including the public/login
  // screens before a demo user authenticates.
  observeEvaluationEntryCTA();
  if (demoProfile) {
    attachPageRouteObservers();
    setTimeout(enforceLiveRoleRoute, 80);
  }
});
// Also handle the case where the inner page finished loading before this
// module was evaluated by the persistent app shell.
observeEvaluationEntryCTA();
installSpeechRecovery(document);
window.addEventListener("focus", () => window.setTimeout(recoverBrowserSpeech, 220));
window.addEventListener("pageshow", () => window.setTimeout(recoverBrowserSpeech, 220));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.setTimeout(recoverBrowserSpeech, 180);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => window.setTimeout(recoverBrowserSpeech, 280), { passive: true });
}

// Some EqualLearn screens switch content without a full document navigation.
// This lightweight route check catches those transitions as well.
setInterval(() => {
  if (demoProfile) enforceLiveRoleRoute();
}, 650);

onAuthStateChanged(auth, async user => {
  if (!user) {
    setDemoCompanionSuppressed(false);
    demoProfile = null;
    lastPageKey = "";
    welcomePrimed = false;
    document.getElementById("equallearn-eval-toolbar")?.remove();
    document.getElementById("equallearn-eval-toolbar-style")?.remove();
    sessionStorage.removeItem("equallearn.evaluationMode");
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) throw new Error("Signed-in user profile not found.");
    const profile = snapshot.data();
    const role = String(profile.role || "").trim().toLowerCase();
    if (isDemo(profile) && String(profile.status || "").trim().toLowerCase() === "active" && ROLE_HOME[role]) {
      setDemoCompanionSuppressed(true);
      demoProfile = { role, name: profile.fullname || profile.fullName || "Evaluator" };
      sessionStorage.setItem("equallearn.evaluationMode", JSON.stringify({ role, startedAt: Date.now() }));
      ensureToolbar();
      const info = getPageInfo();
      if (!info || !info.role) {
        if (info?.url?.pathname?.toLowerCase() === "/evaluation.html") routeToRoleHome(role);
      } else enforceLiveRoleRoute();
      return;
    }
    // A normal user session must never inherit a stale evaluation overlay.
    setDemoCompanionSuppressed(false);
    demoProfile = null;
    lastPageKey = "";
    welcomePrimed = false;
    sessionStorage.removeItem("equallearn.evaluationMode");
    document.getElementById("equallearn-eval-toolbar")?.remove();
    document.getElementById("equallearn-eval-toolbar-style")?.remove();
  } catch (error) {
    console.error("[EqualLearn Evaluation] Could not validate demo mode:", error);
  }
});

window.addEventListener("storage", event => {
  if (event.key === "equallearn.evaluationMode" && !event.newValue) void stopVoice();
});
