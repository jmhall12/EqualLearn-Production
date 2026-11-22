import { evaluationAuth, evaluationDb, isReadOnlyDemoProfile } from "./evaluation-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const app = document.getElementById("evalApp");
const boot = document.getElementById("evalBoot");
const params = new URLSearchParams(location.search);
const requestedRole = String(params.get("role") || "").toLowerCase();
const requestedPage = String(params.get("page") || "overview").toLowerCase();
const ROLE_NAMES = { admin: "Administrator", teacher: "Teacher", student: "Student" };
const ICONS = { overview: "◫", students: "♙", teachers: "♟", lessons: "▤", content: "◈", assignments: "▦", live: "◉", reports: "▥", settings: "⚙", classes: "▣", modules: "▤", "admin-content": "◇", quizzes: "☷", grading: "✓", classwork: "▧", progress: "▥", announcements: "◉", profile: "◉" };

const MENUS = {
  admin: [ ["overview","Overview"],["students","Students"],["teachers","Teachers"],["lessons","Lessons"],["content","Content Review"],["assignments","Class Assignments"],["live","Live Sessions"],["reports","Reports"],["settings","Settings"] ],
  teacher: [ ["overview","Overview"],["classes","My Classes"],["students","Students"],["modules","Learning Modules"],["admin-content","Admin Content Review"],["lessons","Lessons"],["quizzes","Quiz Builder"],["grading","Grading"],["live","Live Class"] ],
  student: [ ["overview","Overview"],["modules","Learning Modules"],["classwork","Classwork"],["quizzes","Quizzes"],["progress","My Progress"],["announcements","Announcements"],["profile","My Profile"] ]
};

const CONTENT = {
  admin: {
    overview: { title:"Administrator Dashboard", description:"The administrator workspace provides a high-level view of EqualLearn. In the live system, administrators oversee accounts, learning resources, content workflow, activity, and reports.", stats:[["Registered students","128","Illustrative total"],["Active teachers","12","Illustrative total"],["Learning resources","34","Illustrative total"],["Sections","8","Illustrative total"]], highlights:[["User Management","Review student and teacher account information and account status."],["Learning Content","Organize gender equality learning materials and supporting resources."],["Content Workflow","Admin content is reviewed by teachers before section-level publication."]], columns:["Area","Purpose","Demo status"], rows:[["Students","Review student accounts","View only"],["Teachers","Review teacher accounts","View only"],["Lessons","Browse learning resources","View only"],["Reports","Review platform summaries","Sample data"]] },
    students: { title:"Student Management", description:"Administrators use this area to review student accounts and enrollment information. The entries below are fictional demonstration records.", stats:[["Sample students","4","Fictional records"],["Active","3","Illustrative status"],["Pending review","1","Illustrative status"],["Sections","2","Sample sections"]], columns:["Student","Student ID","Section","Status"], rows:[["Alex Rivera","STU-2026-001","BSIT 2A","Active"],["Jamie Santos","STU-2026-002","BSIT 2A","Active"],["Taylor Cruz","STU-2026-003","BSIT 2B","Pending"],["Morgan Reyes","STU-2026-004","BSIT 2B","Active"]] },
    teachers: { title:"Teacher Management", description:"This page demonstrates how administrators review teacher accounts and their assigned teaching sections. No actual faculty records are loaded.", stats:[["Sample teachers","3","Fictional records"],["Active","2","Illustrative status"],["Sections handled","4","Sample allocation"],["Pending","1","Illustrative status"]], columns:["Teacher","Department","Section","Status"], rows:[["Jordan Lee","General Education","BSIT 2A","Active"],["Casey Dela Cruz","Student Affairs","BSIT 2B","Active"],["Avery Garcia","GAD Office","—","Pending"]] },
    lessons: { title:"Lessons Library", description:"Administrators can prepare and organize gender equality learning materials. Admin-originated content is not shown to students automatically; teachers review it and choose the sections for publication.", stats:[["Sample lessons","8","Fictional records"],["For review","3","Illustrative status"],["Topics","5","Sample categories"],["Published by teachers","5","Illustrative total"]], columns:["Lesson","Topic","Prepared by","Workflow"], rows:[["Understanding Gender Equality","Gender Equality","Admin","Teacher review"],["Gender Roles and Stereotypes","Stereotypes","Admin","Teacher review"],["Respectful Communication","Inclusion","Admin","Teacher review"],["Safe and Inclusive Spaces","Inclusion","Teacher","Published to section"]] },
    content: { title:"Content Review Overview", description:"Administrators monitor the resource workflow. Teachers review admin-posted materials and select their sections before content becomes visible to students.", stats:[["Awaiting review","3","Sample queue"],["Teacher-reviewed","5","Illustrative total"],["Section assignments","6","Illustrative total"],["Student-visible","5","Illustrative total"]], columns:["Resource","Submitted by","Current stage","Next step"], rows:[["Gender Equality Basics","Admin","Teacher review","Teacher decision"],["Stereotypes and Society","Admin","Teacher review","Teacher decision"],["Inclusive Language","Admin","Teacher review","Teacher decision"],["Respectful Communication","Teacher","Published","Available to section"]] },
    assignments: { title:"Class Assignments", description:"This page illustrates how learning resources and activities are associated with specific sections. Assignment changes are unavailable in the demo.", stats:[["Sample sections","4","Fictional allocation"],["Assigned resources","9","Illustrative total"],["Draft items","2","Illustrative status"],["Active assignments","7","Illustrative status"]], columns:["Resource","Section","Assigned by","Status"], rows:[["Gender Equality Basics","BSIT 2A","Teacher Demo","Active"],["Respectful Communication","BSIT 2B","Teacher Demo","Active"],["Inclusive Language","BSIT 2A","Teacher Demo","Draft"]] },
    live: { title:"Live Sessions Monitor", description:"Administrators can review the status of classroom sessions. This demonstration does not connect to real meeting rooms, cameras, microphones, or participants.", stats:[["Sample sessions","2","Fictional sessions"],["Active","1","Illustrative status"],["Scheduled","1","Illustrative status"],["Participants","24","Illustrative count"]], columns:["Session","Section","Host","Status"], rows:[["GAD Discussion","BSIT 2A","Teacher Demo","Scheduled"],["Gender Equality Q&A","BSIT 2B","Teacher Demo","Sample active"]] },
    reports: { title:"Reports and Analytics", description:"This area presents example summaries that illustrate how administrators can monitor platform activity and learning operations. All values are fictional.", stats:[["Resource views","642","Sample metric"],["Completed activities","86","Sample metric"],["Active sections","8","Sample metric"],["Engagement","78%","Sample metric"]], columns:["Report","Description","Period","Data type"], rows:[["User Overview","Demo account distribution","This term","Sample"],["Learning Activity","Example module and lesson activity","This term","Sample"],["Section Summary","Illustrative section engagement","This term","Sample"]] },
    settings: { title:"System Settings", description:"This page describes the areas where authorized administrators can review platform configuration. Settings in this evaluation workspace are informational only.", stats:[["Platform","EqualLearn","Demo environment"],["Access","Read-only","Evaluation policy"],["Storage","Configured","Illustrative status"],["Notifications","Enabled","Illustrative status"]], columns:["Setting","Purpose","Evaluation access"], rows:[["Account Policies","Account and role settings","View description only"],["Notifications","Notification preferences","View description only"],["Privacy and Security","Security and privacy guidance","View description only"]] }
  },
  teacher: {
    overview: { title:"Teacher Dashboard", description:"The teacher workspace brings together assigned classes, learning resources, student lists, activities, grading views, and classroom tools.", stats:[["My sections","2","Illustrative assignment"],["Students","48","Fictional total"],["Learning resources","8","Sample materials"],["Pending reviews","3","Illustrative queue"]], highlights:[["My Classes","Review section information and assigned learners."],["Teacher Content Review","Review administrator resources and decide which sections should receive them."],["Classroom Activities","Review quizzes, submissions, and grading views." ]], columns:["Workspace area","Purpose","Demo status"], rows:[["My Classes","View assigned sections","View only"],["Admin Content","Review shared resources","View only"],["Grading","Review sample activity summaries","View only"]] },
    classes: { title:"My Classes", description:"Teachers use this area to review their assigned sections and classroom information. The displayed section names and counts are demonstration data.", stats:[["Assigned sections","2","Sample allocation"],["Students","48","Fictional total"],["Active modules","6","Sample count"],["Class activities","5","Sample count"]], columns:["Section","Subject","Students","Status"], rows:[["BSIT 2A","Gender and Development","25","Active"],["BSIT 2B","Gender and Development","23","Active"]] },
    students: { title:"My Students", description:"This page demonstrates a teacher's class roster view. Student names and identifiers are fictional and are not connected to real student records.", stats:[["Sample learners","4","Fictional records"],["Sections","2","Sample sections"],["Activities","5","Sample activities"],["Submissions","12","Illustrative count"]], columns:["Student","Student ID","Section","Learning status"], rows:[["Alex Rivera","STU-001","BSIT 2A","On track"],["Jamie Santos","STU-002","BSIT 2A","On track"],["Taylor Cruz","STU-003","BSIT 2B","Needs support"],["Morgan Reyes","STU-004","BSIT 2B","On track"]] },
    modules: { title:"Learning Modules", description:"Teachers review modules available for teaching. Administrator-provided material is reviewed first, then teachers choose the sections where approved content will be published.", stats:[["Available modules","8","Sample modules"],["For review","3","Sample queue"],["Assigned","5","Illustrative total"],["Sections","2","Sample sections"]], columns:["Module","Topic","Source","Workflow"], rows:[["Gender Equality Basics","Foundations","Admin","For review"],["Gender Roles","Stereotypes","Admin","For review"],["Inclusive Communication","Inclusion","Admin","For review"],["Respect in the Classroom","Respect","Teacher","Assigned"]] },
    "admin-content": { title:"Administrator Shared Content", description:"This area shows learning resources posted by the administrator for teacher review. Only after a teacher approves and assigns a resource to one or more sections should students see it.", stats:[["Awaiting review","3","Sample queue"],["Approved","2","Illustrative total"],["Assigned sections","4","Sample assignments"],["Student-visible","2","Illustrative total"]], columns:["Resource","Admin note","Review status","Section publication"], rows:[["Gender Equality Basics","Introductory module","Awaiting review","Not published"],["Gender Roles and Stereotypes","Discussion resource","Awaiting review","Not published"],["Inclusive Communication","Reading material","Approved","BSIT 2A"]] },
    lessons: { title:"Teacher Lessons", description:"Teachers review lesson details and organize approved learning materials for their students. In the live workflow, section selection controls when a resource becomes visible to students.", stats:[["Sample lessons","6","Fictional records"],["Reviewed","4","Illustrative total"],["Assigned","3","Illustrative total"],["Draft","2","Illustrative total"]], columns:["Lesson","Topic","Review","Assigned sections"], rows:[["Understanding Equality","Foundations","Reviewed","BSIT 2A"],["Stereotypes and Society","Stereotypes","Reviewed","BSIT 2B"],["Inclusive Language","Inclusion","Pending","None"]] },
    quizzes: { title:"Quiz Builder", description:"The quiz builder demonstrates the teacher assessment workflow: prepare questions, review quiz settings, and publish an assessment to selected sections. Creation and publication are disabled here.", stats:[["Sample quizzes","4","Fictional records"],["Drafts","1","Illustrative status"],["Published","3","Illustrative status"],["Questions","24","Sample count"]], columns:["Quiz","Topic","Questions","Status"], rows:[["Gender Equality Basics","Foundations","10","Published"],["Gender Roles","Stereotypes","8","Published"],["Inclusive Communication","Inclusion","6","Draft"]] },
    grading: { title:"Grading and Feedback", description:"Teachers use grading views to review student work, scores, and feedback. This page contains sample summaries only; there are no real submissions to grade.", stats:[["Sample submissions","12","Fictional count"],["For review","4","Illustrative queue"],["Graded","8","Illustrative count"],["Feedback notes","6","Illustrative count"]], columns:["Activity","Section","Submissions","Review status"], rows:[["Reflection Activity","BSIT 2A","7","Sample graded"],["Inclusive Language Quiz","BSIT 2B","5","Review pending"]] },
    live: { title:"Teacher Live Class", description:"This page explains the teacher live classroom area. The actual system supports classroom sessions, but this isolated evaluation screen does not join or create real video meetings.", stats:[["Sample sessions","2","Fictional sessions"],["Sections","2","Sample sections"],["Meeting status","Offline","No live connection"],["Controls","Disabled","Evaluation policy"]], columns:["Session","Section","Purpose","Demo status"], rows:[["GAD Classroom","BSIT 2A","Class discussion","Preview only"],["Student Q&A","BSIT 2B","Question session","Preview only"]] }
  },
  student: {
    overview: { title:"Student Dashboard", description:"The student workspace provides access to learning modules, classwork, quizzes, progress, announcements, and profile information.", stats:[["Assigned modules","5","Illustrative count"],["Class activities","4","Sample activities"],["Quiz results","3","Illustrative count"],["Learning progress","72%","Sample metric"]], highlights:[["Learning Modules","Open gender equality topics and their learning resources."],["Classwork and Quizzes","Review assigned activities and assessment instructions."],["My Progress","Understand the example progress summaries displayed in the learner workspace."]], columns:["Learning area","Purpose","Demo status"], rows:[["Modules","Browse assigned learning resources","Sample data"],["Classwork","Review activities and instructions","Sample data"],["Progress","Review learning summaries","Sample data"]] },
    modules: { title:"Learning Modules", description:"Students use this area to browse learning modules made available to their section after teacher review and publication.", stats:[["Assigned modules","5","Sample count"],["Completed","3","Illustrative count"],["In progress","1","Illustrative count"],["Not started","1","Illustrative count"]], columns:["Module","Topic","Resources","Status"], rows:[["Understanding Gender Equality","Foundations","3","Completed"],["Gender Roles and Stereotypes","Stereotypes","4","In progress"],["Respectful Communication","Inclusion","2","Not started"]] },
    classwork: { title:"Classwork", description:"The classwork area presents activities assigned by the teacher to the student's section. In this Evaluation Mode, students can inspect example instructions but cannot submit work.", stats:[["Sample activities","4","Fictional records"],["Completed","2","Illustrative count"],["Upcoming","1","Illustrative count"],["For review","1","Illustrative count"]], columns:["Activity","Type","Due date","Status"], rows:[["Equality Reflection","Written activity","Nov 28, 2026","Completed"],["Inclusive Language Exercise","Worksheet","Dec 02, 2026","Upcoming"],["Class Discussion","Participation","Dec 05, 2026","For review"]] },
    quizzes: { title:"Quizzes", description:"Students review available assessments and their instructions here. This evaluation workspace does not start a real quiz or record answers or attempts.", stats:[["Sample quizzes","3","Fictional records"],["Completed","2","Illustrative count"],["Available","1","Illustrative count"],["Attempts saved","0","Demo only"]], columns:["Quiz","Topic","Questions","Status"], rows:[["Gender Equality Basics","Foundations","10","Completed"],["Gender Roles","Stereotypes","8","Completed"],["Inclusive Communication","Inclusion","6","Available"]] },
    progress: { title:"My Learning Progress", description:"The progress page illustrates how learners can review completion summaries and their activity status. All numbers are fictional and are not linked to a real student account.", stats:[["Overall progress","72%","Sample metric"],["Modules completed","3 of 5","Illustrative count"],["Activities done","2 of 4","Illustrative count"],["Quizzes completed","2 of 3","Illustrative count"]], columns:["Learning item","Progress","Status"], rows:[["Gender Equality Basics","100%","Completed"],["Gender Roles and Stereotypes","60%","In progress"],["Respectful Communication","0%","Not started"]] },
    announcements: { title:"Announcements", description:"Students can review important class and platform notices here. The messages shown are prepared examples for the system demonstration.", stats:[["Sample notices","3","Fictional records"],["Class notices","2","Illustrative count"],["System notices","1","Illustrative count"],["Unread","1","Illustrative count"]], columns:["Announcement","From","Date","Category"], rows:[["Welcome to EqualLearn","Teacher Demo","Nov 20, 2026","Class"],["Gender Equality Learning Week","Admin Demo","Nov 18, 2026","Platform"],["Upcoming Reflection Activity","Teacher Demo","Nov 17, 2026","Class"]] },
    profile: { title:"Student Profile", description:"This page explains the student profile area, where a learner can review personal account information and relevant section details. The demo profile is fictional and cannot be edited.", stats:[["Role","Student","Demo profile"],["Section","BSIT 2A","Sample section"],["Account status","Active","Demo status"],["Access mode","Read-only","Evaluation policy"]], columns:["Profile field","Example value","Visibility"], rows:[["Name","EqualLearn Demo Student","Sample only"],["Student ID","DEMO-STU-001","Sample only"],["Section","BSIT 2A","Sample only"],["Role","Student","Sample only"]] }
  }
};

function safeText(value) { return String(value ?? ""); }
function escapeHtml(value) { return safeText(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])); }
function statusMarkup(value) {
  const lower = safeText(value).toLowerCase();
  const className = /pending|review|upcoming|in progress|not started|draft/.test(lower) ? "review" : /published|completed|active|on track|sample graded|view only|preview/.test(lower) ? "" : "info";
  return `<span class="status ${className}">${escapeHtml(value)}</span>`;
}
function renderTable(view) {
  const head = document.getElementById("evalTableHead");
  const body = document.getElementById("evalTableBody");
  if (!view.columns?.length || !view.rows?.length) {
    head.innerHTML = ""; body.innerHTML = "";
    document.getElementById("evalEmptyNote").hidden = false;
    return;
  }
  document.getElementById("evalEmptyNote").hidden = true;
  head.innerHTML = `<tr>${view.columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
  body.innerHTML = view.rows.map(row => `<tr>${row.map((cell, index) => `<td>${index === row.length - 1 ? statusMarkup(cell) : escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
}
function renderView(role, page) {
  const view = CONTENT[role]?.[page] || CONTENT[role]?.overview;
  if (!view) return;
  const pageName = MENUS[role].find(item => item[0] === page)?.[1] || view.title;
  document.title = `${view.title} | EqualLearn Evaluation`;
  document.getElementById("evalCrumb").textContent = pageName;
  document.getElementById("evalPageTitle").textContent = view.title;
  document.getElementById("evalWelcomeTitle").textContent = `${view.title}`;
  document.getElementById("evalPageDescription").textContent = view.description;
  document.getElementById("evalPanelTitle").textContent = view.title;
  document.getElementById("evalStats").innerHTML = (view.stats || []).map(stat => `<article class="stat-card"><div class="stat-label">${escapeHtml(stat[0])}</div><div class="stat-value">${escapeHtml(stat[1])}</div><div class="stat-note">${escapeHtml(stat[2])}</div></article>`).join("");
  document.getElementById("evalHighlights").innerHTML = (view.highlights || []).map(item => `<article class="highlight"><b>${escapeHtml(item[0])}</b><p>${escapeHtml(item[1])}</p></article>`).join("");
  renderTable(view);
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.page === page));
  const path = `/evaluation-workspace.html?role=${encodeURIComponent(role)}&page=${encodeURIComponent(page)}`;
  try {
    window.parent.postMessage({ type: "EQUALLEARN_EVALUATION_CONTEXT", role, page, title: view.title, path }, location.origin);
  } catch (_) {}
}
function renderNavigation(role) {
  const nav = document.getElementById("evalNavigation");
  nav.innerHTML = MENUS[role].map(([page, label]) => `<a class="nav-link" data-page="${page}" href="?role=${encodeURIComponent(role)}&page=${encodeURIComponent(page)}"><span class="nav-icon">${ICONS[page] || "•"}</span><span>${escapeHtml(label)}</span></a>`).join("");
}
function showWorkspace(role, profile, user) {
  const page = MENUS[role].some(item => item[0] === requestedPage) ? requestedPage : "overview";
  document.getElementById("evalRoleLabel").textContent = `${ROLE_NAMES[role]} · Demo account`;
  document.getElementById("evalUserRole").textContent = `${ROLE_NAMES[role]} · Read-only`;
  const displayName = String(profile.fullname || profile.fullName || profile.name || `EqualLearn ${ROLE_NAMES[role]} Demo`).trim();
  document.getElementById("evalUserName").textContent = displayName;
  document.getElementById("evalAvatar").textContent = displayName.slice(0, 1).toUpperCase() || "E";
  document.getElementById("evalBrand").href = `?role=${role}&page=overview`;
  renderNavigation(role);
  app.hidden = false;
  boot.hidden = true;
  renderView(role, page);
}

let handling = false;
onAuthStateChanged(evaluationAuth, async user => {
  if (handling) return;
  handling = true;
  if (!user) {
    location.replace("/evaluation.html");
    return;
  }
  try {
    const snapshot = await getDoc(doc(evaluationDb, "users", user.uid));
    if (!snapshot.exists()) throw new Error("Demo account profile not found.");
    const profile = snapshot.data();
    const role = String(profile.role || "").trim().toLowerCase();
    const active = String(profile.status || "").trim().toLowerCase() === "active";
    if (!active || !isReadOnlyDemoProfile(profile) || !["admin","teacher","student"].includes(role)) {
      throw new Error("This account is not authorized for the isolated Evaluation Workspace.");
    }
    // Role is taken from the authenticated Firestore profile, not a URL parameter.
    if (requestedRole !== role) {
      location.replace(`/evaluation-workspace.html?role=${encodeURIComponent(role)}&page=overview`);
      return;
    }
    showWorkspace(role, profile, user);
  } catch (error) {
    console.error("[EVALUATION WORKSPACE] Access check failed:", error);
    try { await signOut(evaluationAuth); } catch (_) {}
    location.replace("/evaluation.html");
  } finally {
    handling = false;
  }
});
