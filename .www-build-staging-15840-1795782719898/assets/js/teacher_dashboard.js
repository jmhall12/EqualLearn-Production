import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — TEACHER DASHBOARD ANALYTICS
   Live sources:
   - modulesV2: modules created by the signed-in teacher
   - lessons: lessons created by the signed-in teacher
   - teacherActivitiesV2: quizzes created by the teacher
   - sections/users: students in sections assigned to the teacher
   - progress/quizAttempts: learning activity for those students
========================================================= */

const $ = id => document.getElementById(id);

const metricElements = {
  modules: $("moduleCount"),
  lessons: $("lessonCount"),
  quizzes: $("quizCount"),
  students: $("studentCount")
};

const chartContainer = $("teacherEngagementChart");
const chartUpdated = $("engagementUpdated");
const chartSummary = $("engagementSummary");
const logoutButton = $("logout");

const metricValues = {
  modules: null,
  lessons: null,
  quizzes: null,
  students: null
};

const metricUnsubscribers = [];
const sectionUnsubscribers = [];
const sectionStudentUnsubscribers = new Map();
const studentActivityUnsubscribers = new Map();

const sectionStudentRecords = new Map();
const progressRecordsByStudent = new Map();
const quizAttemptsByStudent = new Map();

let allAssignedStudents = new Map();
let allSections = new Map();

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function toDate(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value.seconds === "number") {
      const date = new Date(value.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch (_) {
    return null;
  }
}

function setMetric(name, value) {
  const safeValue = value === null || value === undefined || value === ""
    ? null
    : (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null);
  metricValues[name] = safeValue;
  setText(metricElements[name], safeValue === null ? "—" : safeValue.toLocaleString("en-PH"));
  updateMetricRings();
}

function updateMetricRings() {
  const loadedValues = Object.values(metricValues).filter(value => Number.isFinite(value));
  const maxValue = Math.max(0, ...loadedValues);
  const circumference = 2 * Math.PI * 25;

  document.querySelectorAll("[data-metric-ring]").forEach(ring => {
    const key = ring.dataset.metricRing;
    const value = metricValues[key];
    const ratio = value === null || maxValue <= 0 ? 0 : Math.min(1, value / maxValue);

    ring.style.strokeDasharray = `${circumference} ${circumference}`;
    ring.style.strokeDashoffset = String(circumference * (1 - ratio));
    ring.style.opacity = value === null ? ".35" : "1";
  });
}

function logListenerError(label, error) {
  console.error(`[TEACHER DASHBOARD] ${label} listener failed:`, {
    code: error?.code || "unknown",
    message: error?.message || String(error),
    projectId: db.app?.options?.projectId || "unknown"
  });
}

function listenToTeacherResources(uid) {
  const moduleQuery = query(
    collection(db, "modulesV2"),
    where("createdBy", "==", uid)
  );

  const lessonQuery = query(
    collection(db, "lessons"),
    where("createdBy", "==", uid)
  );

  const activityQuery = query(
    collection(db, "teacherActivitiesV2"),
    where("createdBy", "==", uid)
  );

  metricUnsubscribers.push(
    onSnapshot(moduleQuery, snapshot => {
      setMetric("modules", snapshot.size);
    }, error => {
      setMetric("modules", null);
      logListenerError("Teacher modules (modulesV2)", error);
    }),

    onSnapshot(lessonQuery, snapshot => {
      setMetric("lessons", snapshot.size);
    }, error => {
      setMetric("lessons", null);
      logListenerError("Teacher lessons", error);
    }),

    onSnapshot(activityQuery, snapshot => {
      const quizzes = snapshot.docs.filter(item => {
        const data = item.data();
        return String(data.type || data.activityType || "").toLowerCase() === "quiz";
      });
      setMetric("quizzes", quizzes.length);
    }, error => {
      setMetric("quizzes", null);
      logListenerError("Teacher quizzes (teacherActivitiesV2)", error);
    })
  );
}

function listenToAssignedSections(uid) {
  const sectionSources = {
    primary: new Map(),
    multiple: new Map()
  };

  const refreshSections = () => {
    const combined = new Map([
      ...sectionSources.primary,
      ...sectionSources.multiple
    ]);

    allSections = combined;
    syncSectionStudentListeners([...combined.keys()]);
  };

  const primaryQuery = query(
    collection(db, "sections"),
    where("teacherId", "==", uid)
  );

  const multipleQuery = query(
    collection(db, "sections"),
    where("teacherIds", "array-contains", uid)
  );

  sectionUnsubscribers.push(
    onSnapshot(primaryQuery, snapshot => {
      sectionSources.primary = new Map(snapshot.docs.map(item => [item.id, {
        id: item.id,
        ...item.data()
      }]));
      refreshSections();
    }, error => logListenerError("Primary teacher sections", error)),

    onSnapshot(multipleQuery, snapshot => {
      sectionSources.multiple = new Map(snapshot.docs.map(item => [item.id, {
        id: item.id,
        ...item.data()
      }]));
      refreshSections();
    }, error => logListenerError("Assigned teacher sections", error))
  );
}

function syncSectionStudentListeners(sectionIds) {
  const activeSectionIds = new Set(sectionIds);

  for (const [sectionId, unsubscribe] of sectionStudentUnsubscribers.entries()) {
    if (!activeSectionIds.has(sectionId)) {
      unsubscribe();
      sectionStudentUnsubscribers.delete(sectionId);
      sectionStudentRecords.delete(sectionId);
    }
  }

  for (const sectionId of activeSectionIds) {
    if (sectionStudentUnsubscribers.has(sectionId)) continue;

    const studentsQuery = query(
      collection(db, "users"),
      where("role", "==", "student"),
      where("sectionId", "==", sectionId)
    );

    const unsubscribe = onSnapshot(studentsQuery, snapshot => {
      const records = new Map(snapshot.docs.map(item => [item.id, {
        uid: item.id,
        ...item.data()
      }]));

      sectionStudentRecords.set(sectionId, records);
      rebuildAssignedStudents();
    }, error => {
      logListenerError(`Students in assigned section ${sectionId}`, error);
      sectionStudentRecords.set(sectionId, new Map());
      rebuildAssignedStudents();
    });

    sectionStudentUnsubscribers.set(sectionId, unsubscribe);
  }
}

function rebuildAssignedStudents() {
  const combined = new Map();

  for (const records of sectionStudentRecords.values()) {
    for (const [uid, student] of records.entries()) {
      combined.set(uid, student);
    }
  }

  allAssignedStudents = combined;
  setMetric("students", combined.size);
  syncStudentActivityListeners([...combined.keys()]);
}

function syncStudentActivityListeners(studentUids) {
  const activeUids = new Set(studentUids);

  for (const [uid, unsubscribers] of studentActivityUnsubscribers.entries()) {
    if (!activeUids.has(uid)) {
      unsubscribers.forEach(unsubscribe => unsubscribe());
      studentActivityUnsubscribers.delete(uid);
      progressRecordsByStudent.delete(uid);
      quizAttemptsByStudent.delete(uid);
    }
  }

  for (const uid of activeUids) {
    if (studentActivityUnsubscribers.has(uid)) continue;

    const progressQuery = query(
      collection(db, "progress"),
      where("userId", "==", uid)
    );

    const attemptsQuery = query(
      collection(db, "quizAttempts"),
      where("userId", "==", uid)
    );

    const unsubscribeProgress = onSnapshot(progressQuery, snapshot => {
      progressRecordsByStudent.set(uid, snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      })));
      renderEngagementChart();
    }, error => {
      progressRecordsByStudent.set(uid, []);
      logListenerError("Assigned student progress", error);
      renderEngagementChart();
    });

    const unsubscribeAttempts = onSnapshot(attemptsQuery, snapshot => {
      quizAttemptsByStudent.set(uid, snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      })));
      renderEngagementChart();
    }, error => {
      quizAttemptsByStudent.set(uid, []);
      logListenerError("Assigned student quiz attempts", error);
      renderEngagementChart();
    });

    studentActivityUnsubscribers.set(uid, [unsubscribeProgress, unsubscribeAttempts]);
  }

  renderEngagementChart();
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLastSevenDays() {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    days.push(date);
  }

  return days;
}

function activityDate(record, kind) {
  if (kind === "quiz") {
    return toDate(record.submittedAt || record.createdAt || record.updatedAt);
  }

  return toDate(record.completedAt || record.updatedAt || record.createdAt);
}

function countActivityByDay(records, kind, keys) {
  const counts = Object.fromEntries(keys.map(key => [key, 0]));

  records.forEach(record => {
    const date = activityDate(record, kind);
    if (!date) return;

    const key = dateKey(date);
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] += 1;
    }
  });

  return counts;
}

function smoothLinePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = (previous.x + current.x) / 2;
    path += ` C ${middleX} ${previous.y}, ${middleX} ${current.y}, ${current.x} ${current.y}`;
  }

  return path;
}

function ensureEngagementSvg() {
  if (!chartContainer) return null;
  const existing = chartContainer.querySelector("svg.teacher-chart-svg");
  if (existing) return existing;

  const width = 820;
  const height = 226;
  const left = 34;
  const right = 18;
  const top = 16;
  const bottom = 42;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;

  chartContainer.innerHTML = `
    <svg class="teacher-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Seven-day student learning activity line chart">
      <defs>
        <linearGradient id="teacherProgressFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#A995FF" stop-opacity=".22"></stop>
          <stop offset="100%" stop-color="#A995FF" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <g id="teacher-chart-grid">
        <line x1="${left}" y1="${top}" x2="${width-right}" y2="${top}" class="teacher-chart-gridline"></line>
        <line x1="${left}" y1="${top + plotHeight/2}" x2="${width-right}" y2="${top + plotHeight/2}" class="teacher-chart-gridline"></line>
        <line x1="${left}" y1="${baseline}" x2="${width-right}" y2="${baseline}" class="teacher-chart-gridline"></line>
        <text id="teacher-chart-y-top" x="${left-10}" y="${top+4}" text-anchor="end" class="teacher-chart-y-label">0</text>
        <text id="teacher-chart-y-mid" x="${left-10}" y="${top+plotHeight/2+4}" text-anchor="end" class="teacher-chart-y-label">0</text>
        <text id="teacher-chart-y-bottom" x="${left-10}" y="${baseline+4}" text-anchor="end" class="teacher-chart-y-label">0</text>
      </g>
      <path id="teacher-chart-area" class="teacher-chart-area" d=""></path>
      <path id="teacher-progress-path" class="teacher-chart-line teacher-chart-line-progress" d=""></path>
      <path id="teacher-quiz-path" class="teacher-chart-line teacher-chart-line-quiz" d=""></path>
      <g id="teacher-progress-points"></g>
      <g id="teacher-quiz-points"></g>
      <g id="teacher-chart-x-labels"></g>
    </svg>
  `;

  return chartContainer.querySelector("svg.teacher-chart-svg");
}

function renderEngagementChart() {
  if (!chartContainer) return;

  const days = getLastSevenDays();
  const keys = days.map(dateKey);
  const labels = days.map(date => date.toLocaleDateString("en-PH", { weekday: "short" }));

  const progressRecords = [...progressRecordsByStudent.values()].flat();
  const quizRecords = [...quizAttemptsByStudent.values()].flat();
  const progressCounts = countActivityByDay(progressRecords, "progress", keys);
  const quizCounts = countActivityByDay(quizRecords, "quiz", keys);
  const progressValues = keys.map(key => progressCounts[key]);
  const quizValues = keys.map(key => quizCounts[key]);
  const totalEvents = progressValues.reduce((sum, value) => sum + value, 0)
    + quizValues.reduce((sum, value) => sum + value, 0);

  const svg = ensureEngagementSvg();
  if (!svg) return;

  const width = 820;
  const height = 226;
  const left = 34;
  const right = 18;
  const top = 16;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...progressValues, ...quizValues);
  const maxAxis = Math.max(2, Math.ceil(maxValue / 2) * 2);
  const baseline = top + plotHeight;

  const makePoints = values => values.map((value, index) => ({
    x: left + (plotWidth / 6) * index,
    y: top + plotHeight - (value / maxAxis) * plotHeight,
    value
  }));

  const progressPoints = makePoints(progressValues);
  const quizPoints = makePoints(quizValues);
  const progressPath = smoothLinePath(progressPoints);
  const quizPath = smoothLinePath(quizPoints);
  const progressArea = `${progressPath} L ${progressPoints[6].x} ${baseline} L ${progressPoints[0].x} ${baseline} Z`;

  svg.querySelector("#teacher-chart-area")?.setAttribute("d", progressArea);
  svg.querySelector("#teacher-progress-path")?.setAttribute("d", progressPath);
  svg.querySelector("#teacher-quiz-path")?.setAttribute("d", quizPath);

  setText(svg.querySelector("#teacher-chart-y-top"), maxAxis);
  setText(svg.querySelector("#teacher-chart-y-mid"), Math.round(maxAxis / 2));
  setText(svg.querySelector("#teacher-chart-y-bottom"), 0);

  const makeMarkers = (points, className) => points.map(point => `
    <circle cx="${point.x}" cy="${point.y}" r="3.8" class="${className}"></circle>
  `).join("");

  const progressMarkers = svg.querySelector("#teacher-progress-points");
  const quizMarkers = svg.querySelector("#teacher-quiz-points");
  const xLabels = svg.querySelector("#teacher-chart-x-labels");

  if (progressMarkers) progressMarkers.innerHTML = makeMarkers(progressPoints, "teacher-chart-point teacher-chart-point-progress");
  if (quizMarkers) quizMarkers.innerHTML = makeMarkers(quizPoints, "teacher-chart-point teacher-chart-point-quiz");
  if (xLabels) {
    xLabels.innerHTML = labels.map((label, index) => `
      <text x="${progressPoints[index].x}" y="${height-12}" text-anchor="middle" class="teacher-chart-x-label">${label}</text>
    `).join("");
  }

  if (chartSummary) {
    chartSummary.textContent = totalEvents
      ? `${totalEvents.toLocaleString("en-PH")} recorded learning activities in the last 7 days · ${allAssignedStudents.size.toLocaleString("en-PH")} assigned students monitored.`
      : allAssignedStudents.size
        ? "No learning activity has been recorded in the last 7 days yet. The graph is listening for new progress and quiz submissions."
        : "Assign students to your sections to start monitoring their learning activity here.";
  }

  setText(chartUpdated, `Updated ${new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`);
}

function stopDashboardListeners() {
  metricUnsubscribers.forEach(unsubscribe => unsubscribe());
  sectionUnsubscribers.forEach(unsubscribe => unsubscribe());

  for (const unsubscribe of sectionStudentUnsubscribers.values()) unsubscribe();
  for (const unsubscribers of studentActivityUnsubscribers.values()) {
    unsubscribers.forEach(unsubscribe => unsubscribe());
  }

  sectionStudentUnsubscribers.clear();
  studentActivityUnsubscribers.clear();
  sectionStudentRecords.clear();
  progressRecordsByStudent.clear();
  quizAttemptsByStudent.clear();
}

function initializeDashboard(teacher) {
  stopDashboardListeners();

  const displayName = teacher.fullname
    || teacher.fullName
    || teacher.name
    || teacher.displayName
    || teacher.email
    || "Teacher";

  setText($("teacherName"), displayName);
  Object.keys(metricValues).forEach(key => setMetric(key, null));
  renderEngagementChart();

  listenToTeacherResources(teacher.uid);
  listenToAssignedSections(teacher.uid);
  console.info("[TEACHER DASHBOARD] Live analytics initialized.");
}

requireRole("teacher", teacher => {
  initializeDashboard(teacher);
});

if (logoutButton) {
  logoutButton.addEventListener("click", async event => {
    event.preventDefault();
    logoutButton.style.pointerEvents = "none";

    try {
      await signOut(auth);
      window.location.replace("../login.html");
    } catch (error) {
      console.error("[TEACHER DASHBOARD] Logout error:", error);
      logoutButton.style.pointerEvents = "auto";
    }
  });
}

window.addEventListener("pagehide", stopDashboardListeners, { once: true });
