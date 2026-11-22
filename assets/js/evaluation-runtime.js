import { evaluationAuth, evaluationDb, isReadOnlyDemoProfile } from "./evaluation-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const pageFrame = document.getElementById("equallearn-page-frame");
const lumiFrame = document.getElementById("equallearn-lumi-frame");
const ROLE_NAMES = { admin:"Administrator", teacher:"Teacher", student:"Student" };
const GUIDES = {
  admin: {
    overview:"Welcome to the Administrator Dashboard. This page summarizes the main administration areas of EqualLearn, including user oversight, learning content, class assignments, reports, and system settings. All information in this workspace is fictional demonstration data.",
    students:"This is the Student Management page. It demonstrates how administrators review student account information, student identifiers, section placement, and account status. These are fictional sample records, not real student accounts.",
    teachers:"This is the Teacher Management page. Administrators can review teacher account status, department information, and section assignments. The entries shown here are fabricated for evaluation.",
    lessons:"This is the Lessons Library. Administrators can prepare and organize gender equality learning materials. Admin-posted materials are intended for teacher review before teachers select the sections where approved content will be published.",
    content:"This is the Content Review overview. It explains the content workflow: administrators provide learning resources, teachers review them, and teachers select the class sections that should receive approved materials. Students do not automatically see admin posts.",
    assignments:"This is the Class Assignments page. It illustrates how approved learning materials and activities are connected to specific sections. The displayed assignments are sample data only.",
    live:"This is the Live Sessions monitor. It demonstrates how administrators can review classroom session information. This evaluation screen is not connected to live rooms, cameras, microphones, or participants.",
    reports:"This is the Reports page. It presents sample platform summaries that illustrate how administrative reporting can help monitor learning operations. All values are fictional.",
    settings:"This is the System Settings page. It describes the configuration areas available to administrators. Settings cannot be changed in the evaluation workspace."
  },
  teacher: {
    overview:"Welcome to the Teacher Dashboard. This workspace brings together assigned classes, students, learning modules, lessons, quizzes, grading, and classroom tools. The displayed totals are sample information.",
    classes:"This is the My Classes page. Teachers use this area to review assigned sections, class information, and learner counts. The section names and records are fictional.",
    students:"This is the Students page for teachers. It illustrates a class roster view for the teacher's assigned sections. The names and student IDs shown are sample records only.",
    modules:"This is the Learning Modules page. Teachers review available modules and learning resources here. Administrator-provided content should be reviewed before teachers assign or publish it to selected sections.",
    "admin-content":"This is the Administrator Shared Content page. It contains sample resources submitted by the administrator for teacher review. A teacher reviews the resource and chooses the sections for publication. Only after that step should students see the material.",
    lessons:"This is the Teacher Lessons page. Teachers review lesson details and organize approved materials for their classes. Section selection controls which students can see published learning content.",
    quizzes:"This is the Quiz Builder page. It demonstrates the workflow for preparing quiz questions and settings before publication to selected sections. No quiz can be created or published in this demo.",
    grading:"This is the Grading page. Teachers use this area to review student submissions, scores, and feedback. The values shown are fictional summaries and cannot be edited.",
    live:"This is the Teacher Live Class page. It explains the classroom meeting area and section-based live sessions. This demo is disconnected from real meetings, so no participant can join or start a call."
  },
  student: {
    overview:"Welcome to the Student Dashboard. This page gives students an overview of modules, classwork, quizzes, progress, announcements, and profile information. All values are sample data.",
    modules:"This is the Learning Modules page. Students can browse the modules made available to their section after a teacher reviews and publishes the resources.",
    classwork:"This is the Classwork page. It shows sample activities assigned to the student's section, with example instructions and due dates. Submissions are not connected or saved in this evaluation workspace.",
    quizzes:"This is the Quizzes page. Students can review the example assessments available to them. No live quiz attempt is started, and no answers are recorded in this demo.",
    progress:"This is the My Progress page. It illustrates how a student can review completion summaries for learning modules, classwork, and quizzes. The displayed progress is fictional.",
    announcements:"This is the Announcements page. It displays example notices from the teacher and platform administrator. The messages are prepared sample content.",
    profile:"This is the Student Profile page. It shows example profile fields such as name, student ID, section, and account role. The profile details are fictional and cannot be edited."
  }
};

let demoProfile = null;
let voiceEnabled = true;
let lastNarration = "";
let lastViewKey = "";
let routeCheckBusy = false;

function currentFrameLocation() {
  try { return new URL(pageFrame.contentWindow.location.href); }
  catch (_) { return null; }
}
function isAllowedEvaluationPath(url) {
  return url && ["/evaluation.html", "/evaluation-workspace.html"].includes(url.pathname.toLowerCase());
}
function routeToWorkspace(role, page = "overview") {
  const destination = `/evaluation-workspace.html?role=${encodeURIComponent(role)}&page=${encodeURIComponent(page)}`;
  if (pageFrame) pageFrame.src = destination;
}
function speak(text) {
  if (!voiceEnabled || !text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("[EqualLearn Evaluation] Voice narration unavailable:", error);
  }
}
function pageContext() {
  const url = currentFrameLocation();
  if (!url || url.pathname.toLowerCase() !== "/evaluation-workspace.html") return null;
  const role = url.searchParams.get("role") || demoProfile?.role || "";
  const page = url.searchParams.get("page") || "overview";
  if (!Object.prototype.hasOwnProperty.call(ROLE_NAMES, role)) return null;
  const guide = GUIDES[role]?.[page] || GUIDES[role]?.overview || "Explore this EqualLearn demonstration page. It contains sample information only and does not connect to live school records.";
  const title = `${ROLE_NAMES[role]} · ${page.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())}`;
  return { role, page, guide, title, path: url.pathname + url.search };
}
function ensureToolbar() {
  if (document.getElementById("equallearn-eval-toolbar")) return;
  const style = document.createElement("style");
  style.id = "equallearn-eval-toolbar-style";
  style.textContent = `
    #equallearn-eval-toolbar{position:fixed;z-index:2147483000;top:12px;left:12px;max-width:min(420px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(157,134,255,.32);border-radius:13px;background:rgba(11,16,32,.94);box-shadow:0 12px 34px rgba(0,0,0,.25);backdrop-filter:blur(14px);font-family:Inter,system-ui,sans-serif;color:#eef3ff}
    #equallearn-eval-toolbar .evalr-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px}
    #equallearn-eval-toolbar .evalr-brand{font-size:10px;font-weight:900;letter-spacing:.07em;color:#c8baff}
    #equallearn-eval-toolbar .evalr-status{font-size:8px;font-weight:850;letter-spacing:.08em;color:#a7e8c9;border:1px solid rgba(102,213,164,.25);background:rgba(102,213,164,.08);padding:4px 7px;border-radius:99px;white-space:nowrap}
    #equallearn-eval-toolbar .evalr-title{font-weight:800;font-size:12px;color:#fff;margin:0 0 3px}
    #equallearn-eval-toolbar .evalr-text{margin:0;color:#c1cce2;font-size:10px;line-height:1.45;max-height:48px;overflow:auto}
    #equallearn-eval-toolbar .evalr-actions{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
    #equallearn-eval-toolbar button{appearance:none;border:1px solid rgba(167,184,225,.19);background:rgba(255,255,255,.065);color:#eaf0ff;padding:6px 9px;border-radius:9px;font:700 9px system-ui;cursor:pointer}
    #equallearn-eval-toolbar button:hover{background:rgba(156,140,255,.17)}
    #equallearn-eval-toolbar #equallearn-eval-exit{border-color:rgba(255,135,149,.25);color:#ffc0c8}
    @media(max-width:600px){#equallearn-eval-toolbar{top:7px;left:7px;padding:8px 9px}#equallearn-eval-toolbar .evalr-text{font-size:9px;max-height:42px}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.id = "equallearn-eval-toolbar";
  panel.setAttribute("aria-label", "EqualLearn evaluation guide");
  panel.innerHTML = `<div class="evalr-top"><span class="evalr-brand">Lumi · Guided Evaluation</span><span class="evalr-status">ISOLATED DEMO</span></div><p class="evalr-title" id="equallearn-eval-title">Preparing page guide…</p><p class="evalr-text" id="equallearn-eval-text">Lumi is preparing the explanation for this page.</p><div class="evalr-actions"><button type="button" id="equallearn-eval-replay">▶ Replay voice</button><button type="button" id="equallearn-eval-voice">Voice: On</button><button type="button" id="equallearn-eval-stop">Stop audio</button><button type="button" id="equallearn-eval-exit">Exit evaluation</button></div>`;
  document.body.appendChild(panel);
  panel.querySelector("#equallearn-eval-replay").addEventListener("click", () => speak(lastNarration));
  panel.querySelector("#equallearn-eval-voice").addEventListener("click", event => {
    voiceEnabled = !voiceEnabled;
    event.currentTarget.textContent = `Voice: ${voiceEnabled ? "On" : "Off"}`;
    if (!voiceEnabled) window.speechSynthesis?.cancel(); else speak(lastNarration);
  });
  panel.querySelector("#equallearn-eval-stop").addEventListener("click", () => window.speechSynthesis?.cancel());
  panel.querySelector("#equallearn-eval-exit").addEventListener("click", exitEvaluation);
}
function applyGuide() {
  const context = pageContext();
  if (!context || !demoProfile) return;
  ensureToolbar();
  const titleNode = document.getElementById("equallearn-eval-title");
  const textNode = document.getElementById("equallearn-eval-text");
  if (titleNode) titleNode.textContent = context.title;
  if (textNode) textNode.textContent = context.guide;
  lastNarration = `${context.title}. ${context.guide}`;
  const key = `${context.role}:${context.page}`;
  try {
    lumiFrame?.contentWindow?.postMessage({ type:"EQUALLEARN_EVALUATION_CONTEXT", role:context.role, page:context.page, title:context.title, path:context.path }, location.origin);
    lumiFrame?.contentWindow?.postMessage({ type:"EQUALLEARN_EVALUATION_NARRATION", text:context.guide }, location.origin);
  } catch (_) {}
  if (key !== lastViewKey) {
    lastViewKey = key;
    setTimeout(() => speak(lastNarration), 550);
  }
}
async function enforceRouteIsolation() {
  if (!demoProfile || routeCheckBusy) return;
  const url = currentFrameLocation();
  if (!url) return;
  if (!isAllowedEvaluationPath(url)) {
    routeCheckBusy = true;
    routeToWorkspace(demoProfile.role, "overview");
    setTimeout(() => { routeCheckBusy = false; }, 500);
    return;
  }
  applyGuide();
}
async function exitEvaluation() {
  window.speechSynthesis?.cancel();
  try { await signOut(evaluationAuth); }
  catch (error) { console.warn("[EqualLearn Evaluation] Sign-out warning:", error); }
  demoProfile = null;
  lastViewKey = "";
  document.getElementById("equallearn-eval-toolbar")?.remove();
  document.getElementById("equallearn-eval-toolbar-style")?.remove();
  if (pageFrame) pageFrame.src = "/login.html";
}

pageFrame?.addEventListener("load", () => {
  if (demoProfile) setTimeout(enforceRouteIsolation, 80);
});

onAuthStateChanged(evaluationAuth, async user => {
  demoProfile = null;
  if (!user) {
    document.getElementById("equallearn-eval-toolbar")?.remove();
    document.getElementById("equallearn-eval-toolbar-style")?.remove();
    return;
  }
  try {
    const snapshot = await getDoc(doc(evaluationDb, "users", user.uid));
    if (!snapshot.exists()) throw new Error("Demo account profile not found.");
    const profile = snapshot.data();
    const role = String(profile.role || "").trim().toLowerCase();
    const active = String(profile.status || "").trim().toLowerCase() === "active";
    if (!active || !["admin","teacher","student"].includes(role) || !isReadOnlyDemoProfile(profile)) {
      throw new Error("This account is not authorized for Evaluation Mode.");
    }
    demoProfile = { role, name: profile.fullname || profile.fullName || "Evaluator" };
    ensureToolbar();
    await enforceRouteIsolation();
  } catch (error) {
    console.error("[EqualLearn Evaluation] Session validation failed:", error);
    try { await signOut(evaluationAuth); } catch (_) {}
    if (pageFrame) pageFrame.src = "/evaluation.html";
  }
});
