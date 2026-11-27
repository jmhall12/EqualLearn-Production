import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const ROLE_NAMES = { admin: "Administrator", teacher: "Teacher", student: "Student" };
const ROLE_HOME = { admin: "/admin/dashboard.html", teacher: "/teacher/dashboard.html", student: "/student/dashboard.html" };
const GUIDE = {
  admin: {
    dashboard: "This is the Administrator Dashboard. It gives the administrator an overview of EqualLearn, including registered learners, teachers, learning resources, and platform activity. Use the navigation menu to inspect user management, content workflow, class assignments, reports, and settings.",
    students: "This is Student Management. Administrators can review student accounts, registration details, verification status, and section information. In this evaluation, the actual records are visible only to the extent allowed by the demo account. Creating, editing, verifying, and deleting accounts are disabled.",
    "manage-teachers": "This is Teacher Management. It displays teacher accounts, assigned sections, and account status. You can inspect the actual teacher management interface, but account creation, editing, deactivation, and deletion are disabled.",
    "register-teacher": "This is Register Teacher. Administrators normally use this page to register a teacher and provide account details. The form is visible for evaluation, but registration and submission are blocked for this read-only account.",
    "class-assignments": "This is Class Assignments. It shows how teachers, sections, and learning resources are organized. You can review the actual assignment interface, but cannot create or change assignments.",
    "check-content": "This is Check Lessons and Modules. Administrators review learning materials submitted for the platform and inspect their workflow status. Approval, rejection, editing, and publishing actions are disabled for this evaluator.",
    "create-content": "This is Create Content. Administrators use this area to prepare gender equality lessons and modules. The real editor is displayed for inspection, but creating, uploading, editing, and publishing are disabled.",
    lessons: "This is Administrator Lessons. It is used to organize gender equality learning resources. Admin-originated content is intended for teacher review before teachers select sections and publish approved resources to students.",
    reports: "This is Reports and Analytics. Administrators review platform activity and learning information here. You can inspect the available reports, while generating or exporting changes is disabled where it would modify data.",
    live: "This is the Administrator Live Sessions area. It provides oversight of classroom session information. Demo accounts cannot create, join, start, stop, or modify real live sessions.",
    settings: "This is System Settings. Administrators inspect platform configuration and preferences here. Settings can be viewed, but saving or changing configuration is disabled.",
    "account-settings": "This is Account Settings. It displays administrator account information and preferences. The evaluation account can inspect the page, but cannot change account or security details.",
    "change-password": "This is Change Password. It normally allows an account owner to update credentials. Password changes are disabled for evaluation accounts.",
    "privacy-security": "This is Privacy and Security. It explains account protection and privacy controls. You can inspect the information, but cannot change security settings.",
    "recent-activity": "This is Recent Activity. It displays the activity history available to the administrator, helping explain how platform actions are monitored. Demo accounts cannot create or edit activity records."
  },
  teacher: {
    dashboard: "This is the Teacher Dashboard. It brings together assigned classes, student information, learning materials, activities, and classroom tools. Use the menu to explore the teaching features available to this teacher demo account.",
    classes: "This is My Classes. Teachers review assigned sections and class details here. Section information and linked learner data are limited to the demo account's permitted assignments. Changes to classes are disabled.",
    modules: "This is Learning Modules. Teachers can inspect available modules and resources. Administrator-provided content is reviewed before a teacher assigns or publishes it to selected sections. Module creation and editing are disabled.",
    "module-details": "This is Module Details. It displays the selected module and its learning content. You can inspect its structure, but cannot edit, upload, or publish module content.",
    lessons: "This is Teacher Lessons. Teachers review lesson materials and prepare them for their classes. The workflow requires teachers to review administrator resources and select sections before publication. All write actions are disabled for this evaluator.",
    students: "This is Teacher Students. It allows teachers to review learners in assigned sections. Profile edits, grading changes, and account actions are disabled.",
    "admin-content": "This is Admin Content Review. It shows learning resources provided by administrators for teacher review. Teachers review the materials before deciding which sections should receive them. Approval, assignment, and publication actions are disabled.",
    grading: "This is Activity Grading. Teachers review student submissions, scores, and feedback here. You can inspect the grading interface and permitted records, but cannot enter scores or change submissions.",
    quiz_builder: "This is the Quiz Builder. Teachers prepare quiz questions and assessments for their classes here. You can inspect the builder, but cannot create, edit, publish, or assign quizzes.",
    resources: "This is Learning Resources. It organizes supporting documents, videos, and links for teaching. Uploading and editing resources are disabled during this read-only evaluation.",
    live: "This is Teacher Live Class. It is used to manage classroom sessions and interact with students. Starting, joining, or ending real calls is disabled for demo accounts."
  },
  student: {
    dashboard: "This is the Student Dashboard. It provides an overview of available modules, classwork, quizzes, progress, and announcements. The information displayed is limited to what the student demo account is permitted to access.",
    modules: "This is Learning Modules. Students browse materials that their teacher has published to the selected section. Administrator content is not automatically visible; teachers review and publish resources first.",
    classwork: "This is Classwork. It presents activities assigned by the teacher to the student's section, including instructions and due dates. You can inspect the actual classwork view, but cannot submit or change work.",
    assignment: "This is Assignment Details. It displays instructions and details for a selected task. Submission and attachment uploads are disabled for demo accounts.",
    quizzes: "This is Quizzes. Students review assessments made available to their class here. You can inspect quiz information, but starting attempts and submitting answers are blocked.",
    quiz: "This is the Quiz page. It displays the assessment interface students use to answer questions. Answer submission and attempt recording are disabled in Evaluation Mode.",
    "quiz-result": "This is Quiz Results. Students can review results and feedback for completed quizzes they are permitted to see. Saved scores and attempts cannot be changed.",
    progress: "This is My Progress. It summarizes learning progress across modules, classwork, and quizzes so students can understand completed and pending activities. Progress records cannot be changed by a demo account.",
    announcement: "This is Announcements. Students can read important notices shared by teachers or administrators. Demo accounts cannot post or modify announcements.",
    profile: "This is My Profile. It displays student profile information and account details. The evaluator can inspect the page, but cannot edit personal or academic information.",
    settings: "This is Student Settings. It contains the preferences available to a student account. Any setting that would save a change is disabled for this evaluation.",
    "change-password": "This is Change Password. It normally allows a student to update their password. Password changes are disabled for evaluation accounts.",
    "privacy-security": "This is Privacy and Security. It explains student account privacy and security. You can inspect the information, but cannot update security settings.",
    "recent-activity": "This is Recent Activity. It lets a student review recent actions and learning activity associated with the account. The information is read-only during this demonstration.",
    live: "This is Student Live. It is the area used to access classroom live sessions. During Evaluation Mode, demo accounts cannot join or interact with real live meetings.",
    lesson: "This is the Lesson page. Students open learning materials made available by their teacher and review the content. Viewing is available, while any submission or completion changes are disabled."
  }
};

let currentProfile = null;
let voiceOn = true;
let currentKey = "";
let currentText = "";
let generation = 0;
let toolbar;
let nativeTts = null;
let nativeTtsPromise = null;
let activeBrowserUtterance = null;
let routeObserver = null;
const native = () => Boolean(window.Capacitor?.isNativePlatform?.() || ["android", "ios"].includes(window.Capacitor?.getPlatform?.()));
const TTS_URL = "https://esm.sh/@capacitor-community/text-to-speech@8.0.2?bundle";

function currentPage() {
  const match = location.pathname.toLowerCase().match(/^\/(admin|teacher|student)\/([^/]+)\.html$/);
  if (!match) return null;
  const role = match[1], page = match[2];
  const heading = document.querySelector("main h1, .el-page-header h1, h1");
  const title = (heading?.textContent || document.title || page.replace(/[-_]/g, " "))
    .replace(/\s*[|–—-]\s*EqualLearn/ig, "").trim();
  return { role, page, title };
}
function explanation(info) {
  return GUIDE[info.role]?.[info.page] || `This is ${info.title}. This page is part of the ${ROLE_NAMES[info.role]} workspace in EqualLearn. You can inspect the actual page and available information. All actions that create, edit, delete, submit, upload, publish, or change records are disabled for this read-only demo account.`;
}
function ensureToolbar() {
  if (toolbar?.isConnected) return;
  if (document.getElementById("equallearn-eval-toolbar")) {
    toolbar = document.getElementById("equallearn-eval-toolbar");
    return;
  }
  const style = document.createElement("style");
  style.id = "equallearn-direct-guide-style";
  style.textContent = `
  #equallearn-eval-toolbar{position:fixed;z-index:2147483000;right:14px;bottom:14px;width:min(410px,calc(100vw - 28px));max-height:38vh;overflow:auto;padding:11px 12px;border:1px solid rgba(157,134,255,.38);border-radius:14px;background:rgba(10,15,30,.97);box-shadow:0 14px 34px rgba(0,0,0,.4);backdrop-filter:blur(16px);font:12px Inter,system-ui,sans-serif;color:#eef3ff}
  #equallearn-eval-toolbar .eg-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
  #equallearn-eval-toolbar .eg-brand{font-size:11px;font-weight:900;color:#c8baff;letter-spacing:.04em}
  #equallearn-eval-toolbar .eg-pill{font-size:9px;font-weight:850;color:#a7e8c9;border:1px solid rgba(102,213,164,.3);background:rgba(102,213,164,.09);padding:4px 7px;border-radius:99px}
  #equallearn-eval-toolbar .eg-title{font-weight:850;font-size:13px;color:#fff;margin:8px 0 4px}
  #equallearn-eval-toolbar .eg-text{margin:0;color:#cbd5e8;font-size:11px;line-height:1.5;max-height:76px;overflow:auto}
  #equallearn-eval-toolbar .eg-actions{display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap}
  #equallearn-eval-toolbar button{appearance:none;border:1px solid rgba(167,184,225,.23);background:rgba(255,255,255,.075);color:#eaf0ff;padding:7px 10px;border-radius:9px;font:750 10px system-ui;cursor:pointer;white-space:nowrap}
  #equallearn-eval-toolbar #eg-stop{border-color:rgba(255,112,125,.6);background:rgba(178,48,67,.3);color:#ffd6da;font-weight:950}
  #equallearn-eval-toolbar .eg-error{display:none;margin-top:7px;color:#ffd49b;font-size:10px;line-height:1.4}
  #equallearn-eval-toolbar.is-collapsed{width:auto;max-width:calc(100vw - 20px);max-height:none;overflow:visible;padding:7px 9px;border-radius:999px}
  #equallearn-eval-toolbar.is-collapsed .eg-pill,#equallearn-eval-toolbar.is-collapsed .eg-title,#equallearn-eval-toolbar.is-collapsed .eg-text,#equallearn-eval-toolbar.is-collapsed .eg-actions,#equallearn-eval-toolbar.is-collapsed .eg-error{display:none!important}
  #equallearn-eval-toolbar.is-collapsed .eg-head{gap:8px}
  @media(max-width:600px){#equallearn-eval-toolbar{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:34vh;padding:9px 10px}#equallearn-eval-toolbar .eg-text{font-size:10px;max-height:58px}#equallearn-eval-toolbar button{padding:7px 9px;font-size:10px}#equallearn-eval-toolbar.is-collapsed{width:auto;max-width:calc(100vw - 16px)}}`;
  document.head.appendChild(style);
  toolbar = document.createElement("section");
  toolbar.id = "equallearn-eval-toolbar";
  toolbar.setAttribute("aria-label", "Lumi read-only evaluation guide");
  toolbar.innerHTML = `<div class="eg-head"><span class="eg-brand">✦ Lumi · Guided Evaluation</span><span class="eg-pill">READ-ONLY · REAL SYSTEM</span></div><p class="eg-title" id="eg-title">Welcome to EqualLearn</p><p class="eg-text" id="eg-text">Lumi is preparing this page explanation.</p><p class="eg-error" id="eg-error"></p><div class="eg-actions"><button type="button" id="eg-stop">■ Stop Audio</button><button type="button" id="eg-replay">▶ Replay</button><button type="button" id="eg-voice">Voice: On</button><button type="button" id="eg-collapse" aria-expanded="true">− Collapse</button><button type="button" id="eg-exit">Exit Evaluation</button></div>`;
  document.body.appendChild(toolbar);
  toolbar.querySelector("#eg-stop").addEventListener("click", stopSpeech);
  toolbar.querySelector("#eg-replay").addEventListener("click", () => speak(currentText, true));
  toolbar.querySelector("#eg-voice").addEventListener("click", event => {
    voiceOn = !voiceOn;
    event.currentTarget.textContent = `Voice: ${voiceOn ? "On" : "Off"}`;
    if (voiceOn) speak(currentText, true); else stopSpeech();
  });
  toolbar.querySelector("#eg-collapse").addEventListener("click", event => {
    const collapsed = toolbar.classList.toggle("is-collapsed");
    event.currentTarget.textContent = collapsed ? "+ Lumi" : "− Collapse";
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  });
  toolbar.querySelector("#eg-exit").addEventListener("click", exitDemo);
}
function setCopy(title, body) {
  ensureToolbar();
  toolbar.querySelector("#eg-title").textContent = title;
  toolbar.querySelector("#eg-text").textContent = body;
}
function setVoiceError(text) {
  ensureToolbar();
  const el = toolbar.querySelector("#eg-error");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}
function chunkText(text, max = 145) {
  const sentences = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const out = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > max) {
      let i = s.lastIndexOf(" ", max);
      if (i < 70) i = max;
      out.push(s.slice(0, i).trim());
      s = s.slice(i).trim();
    }
    if (s) out.push(s);
  }
  return out;
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function currentGeneration(token) {
  return token === generation && voiceOn;
}

async function waitForForeground(token, maxWait = 45000) {
  const started = Date.now();
  while (document.visibilityState === "hidden" && currentGeneration(token) && Date.now() - started < maxWait) {
    await delay(300);
  }
  return currentGeneration(token);
}

function browserChunk(text, token) {
  return new Promise(resolve => {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance || !currentGeneration(token)) {
      resolve("unavailable");
      return;
    }

    // Clear a stale paused state left by Chromium after opening the mobile keyboard.
    try { if (synth.paused) synth.resume(); } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;

    let settled = false;
    let watchdog = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      if (activeBrowserUtterance === utterance) activeBrowserUtterance = null;
      resolve(result);
    };

    utterance.onstart = () => {
      if (currentGeneration(token)) console.debug("[Lumi Guide] Browser narration segment started.");
    };
    utterance.onend = () => finish("ok");
    utterance.onerror = event => {
      const code = String(event?.error || "error").toLowerCase();
      // A user pressing Stop or changing page increments generation. Only
      // retry interruptions that happened while this same page is still active.
      finish(currentGeneration(token) ? code : "stale");
    };

    // Do not use the old short watchdog that could cancel a valid utterance.
    // If the engine genuinely hangs, cancel only this attempt and let the caller retry.
    const watchdogMs = Math.max(45000, Math.min(90000, text.length * 420));
    watchdog = setTimeout(() => {
      if (!currentGeneration(token)) return finish("stale");
      try { synth.cancel(); } catch (_) {}
      finish("timeout");
    }, watchdogMs);

    activeBrowserUtterance = utterance;
    try {
      synth.speak(utterance);
      if (synth.paused) setTimeout(() => {
        if (currentGeneration(token)) {
          try { synth.resume(); } catch (_) {}
        }
      }, 180);
    } catch (error) {
      console.warn("[Lumi Guide] Browser speech could not start:", error);
      finish("error");
    }
  });
}

async function loadNativeTts() {
  if (!native()) return null;
  if (!nativeTtsPromise) {
    nativeTtsPromise = import(TTS_URL)
      .then(module => module.TextToSpeech)
      .catch(error => {
        console.warn("[Lumi Guide] Native TTS unavailable; using browser speech", error);
        nativeTtsPromise = null;
        return null;
      });
  }
  nativeTts = await nativeTtsPromise;
  return nativeTts;
}

async function stopSpeech() {
  generation += 1;
  try { window.speechSynthesis?.cancel(); } catch (_) {}
  activeBrowserUtterance = null;
  // Do not import the native plugin just to stop it. Stop it only if it was
  // already loaded; this keeps the Stop button immediate on browser devices.
  try { if (nativeTts?.stop) await nativeTts.stop(); } catch (error) {
    console.debug("[Lumi Guide] Native TTS stop warning:", error);
  }
}

async function browserSpeakPart(part, token) {
  const retryDelays = [250, 650, 1200];
  let lastResult = "error";
  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (!currentGeneration(token)) return "stale";
    if (!(await waitForForeground(token))) return "stale";
    if (attempt) {
      await delay(retryDelays[attempt - 1]);
      try { if (window.speechSynthesis?.paused) window.speechSynthesis.resume(); } catch (_) {}
    }
    lastResult = await browserChunk(part, token);
    if (lastResult === "ok" || lastResult === "stale") return lastResult;
    // Chromium may emit 'interrupted'/'canceled' on transient audio-focus loss.
    // Retry while the page generation is unchanged; manual Stop changes it.
    if (!currentGeneration(token)) return "stale";
  }
  return lastResult;
}

async function nativeSpeakPart(part, token, tts) {
  if (!tts?.speak || !currentGeneration(token)) return "unavailable";
  const timeoutMs = Math.max(45000, Math.min(90000, part.length * 420));
  let timer;
  try {
    const result = await Promise.race([
      tts.speak({ text: part, lang: "en-US", rate: 0.96, pitch: 1.02, volume: 1, queueStrategy: 0 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native-tts-timeout")), timeoutMs); })
    ]);
    clearTimeout(timer);
    return currentGeneration(token) ? "ok" : "stale";
  } catch (error) {
    clearTimeout(timer);
    console.warn("[Lumi Guide] Native TTS segment failed:", error);
    try { await tts.stop?.(); } catch (_) {}
    return currentGeneration(token) ? "fallback" : "stale";
  }
}

async function speak(text, interrupt = false) {
  const fullText = String(text || "").trim();
  if (!voiceOn || !fullText) return;

  if (interrupt) await stopSpeech();
  const token = generation;
  const parts = chunkText(fullText, 125);
  setVoiceError("");

  // Get the native engine once, but retain the Web Speech fallback for desktop
  // browsers and Android browsers where the Capacitor bridge is unavailable.
  let tts = null;
  if (native()) tts = await loadNativeTts();
  if (!currentGeneration(token)) return;

  for (let index = 0; index < parts.length; index++) {
    if (!currentGeneration(token)) return;
    if (!(await waitForForeground(token))) return;

    let result = "unavailable";
    if (tts) result = await nativeSpeakPart(parts[index], token, tts);
    if (result === "stale" || !currentGeneration(token)) return;

    if (result !== "ok") {
      result = await browserSpeakPart(parts[index], token);
      if (result === "stale" || !currentGeneration(token)) return;
    }

    if (result !== "ok") {
      setVoiceError("Audio was interrupted by the device. Lumi will continue with the next part; tap Replay to hear this page again.");
      console.warn(`[Lumi Guide] Segment ${index + 1}/${parts.length} could not be spoken after retries:`, result);
    } else if (index === 0) {
      setVoiceError("");
    }
    await delay(120);
  }
}

// Recover from browser audio-focus changes without interrupting speech merely
// because an evaluator tapped a search box, form field, or the page controls.
function resumeEvaluationSpeech() {
  if (!voiceOn || !currentProfile) return;
  try {
    const synth = window.speechSynthesis;
    if (synth?.paused) synth.resume();
  } catch (error) {
    console.debug("[Lumi Guide] Speech resume deferred:", error);
  }
}
window.addEventListener("focus", resumeEvaluationSpeech);
window.addEventListener("pageshow", resumeEvaluationSpeech);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeEvaluationSpeech();
});
function updateCurrentPage(force = false) {
  if (!currentProfile) return;
  const info = currentPage();
  if (!info) return;
  if (info.role !== currentProfile.role) {
    const home = ROLE_HOME[currentProfile.role];
    if (home && location.pathname.toLowerCase() !== home) location.replace(home + "?evaluation=1");
    return;
  }
  const key = `${info.role}/${info.page}`;
  if (!force && key === currentKey) return;
  currentKey = key;
  currentText = `${info.title}. ${explanation(info)}`;
  setCopy(`${ROLE_NAMES[info.role]} · ${info.title}`, explanation(info));
  void speak(currentText, true);
}
async function exitDemo() {
  await stopSpeech();
  try { await signOut(auth); } catch (error) { console.warn("[Lumi Guide] Sign out:", error); }
  sessionStorage.removeItem("equallearn.evaluationMode");
  location.replace("/login.html");
}

export function startDirectEvaluationGuide(profile) {
  const role = String(profile?.role || "").trim().toLowerCase();
  const flag = profile?.demoReadOnly === true || String(profile?.demoReadOnly).trim().toLowerCase() === "true";
  if (!flag || !ROLE_HOME[role]) return;
  currentProfile = { role, name: profile.fullname || profile.fullName || "Evaluator" };
  try { sessionStorage.setItem("equallearn.evaluationMode", JSON.stringify({ role, demoReadOnly: true, startedAt: Date.now() })); } catch (_) {}
  ensureToolbar();
  updateCurrentPage(true);
  const notify = () => setTimeout(() => updateCurrentPage(false), 80);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method].bind(history);
    history[method] = (...args) => { const result = original(...args); notify(); return result; };
  }
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  if (routeObserver) routeObserver.disconnect();
  routeObserver = new MutationObserver(() => {
    // A few EqualLearn screens update their main heading/title after data loads.
    if (currentProfile) notify();
  });
  const heading = document.querySelector("main h1, .el-page-header h1, h1");
  if (heading) routeObserver.observe(heading, { childList: true, subtree: true, characterData: true });
  console.info(`[Lumi Guide] Direct-page evaluation guide ready for ${role}: ${location.pathname}`);
}
