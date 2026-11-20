import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN ADMIN ANALYTICS
   - Students: registration line chart (last 7 days)
   - Teachers / Modules / Lessons: bar chart
   - Platform activity: live line chart from Firestore snapshots
========================================================= */

const $ = id => document.getElementById(id);

const adminName = $("adminName");
const logoutBtn = $("logout");
const dashboardDataStatus = $("dashboardDataStatus");
const activityLiveStatus = $("activityLiveStatus");

const studentTotal = $("studentTotal");
const resourceTotal = $("resourceTotal");
const studentGrowthCaption = $("studentGrowthCaption");
const platformActivityCaption = $("platformActivityCaption");

const state = {
  users: [],
  modules: [],
  modulesV2: [],
  lessons: [],
  teacherActivitiesV2: [],
  announcements: [],
  quizzesV2: []
};

const collectionNames = Object.keys(state);
const readyCollections = new Set();
const failedCollections = new Set();
const unsubscribeAnalytics = [];
let isShuttingDown = false;

const CHART_COLORS = {
  students: "#a18aff",
  teachers: "#a18aff",
  modules: "#7da7f2",
  lessons: "#5fc6b0",
  people: "#a18aff",
  learning: "#7da7f2",
  classwork: "#5fc6b0"
};

/* =========================================================
   AUTHENTICATION AND ADMIN ACCESS
========================================================= */

onAuthStateChanged(auth, async user => {
  stopAnalyticsListeners();

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));

    if (!profileSnapshot.exists()) {
      alert("User profile not found.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    const profile = profileSnapshot.data();
    const role = String(profile.role || "").trim().toLowerCase();
    const status = String(profile.status || "active").trim().toLowerCase();

    if (role !== "admin" || status === "inactive") {
      alert("Access denied. Admin account required.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    if (adminName) {
      adminName.textContent = profile.fullname || user.email || "Administrator";
    }

    startAnalyticsListeners();
  } catch (error) {
    console.error("ADMIN DASHBOARD AUTH ERROR:", error);
    setDashboardStatus("Unable to connect to dashboard data. Check your connection and permissions.", true);
  }
});

/* =========================================================
   REAL-TIME FIRESTORE DATA
   Each collection listener refreshes chart values when a
   record is added, edited, or removed.
========================================================= */

function startAnalyticsListeners() {
  isShuttingDown = false;
  readyCollections.clear();
  failedCollections.clear();

  collectionNames.forEach(collectionName => {
    const unsubscribe = onSnapshot(
      collection(db, collectionName),
      snapshot => {
        state[collectionName] = snapshot.docs.map(document => ({
          id: document.id,
          ...document.data()
        }));

        readyCollections.add(collectionName);
        failedCollections.delete(collectionName);
        renderDashboardAnalytics();
      },
      error => {
        console.error(`[ADMIN ANALYTICS] ${collectionName} listener failed:`, error);
        state[collectionName] = [];
        readyCollections.add(collectionName);
        failedCollections.add(collectionName);
        renderDashboardAnalytics();
      }
    );

    unsubscribeAnalytics.push(unsubscribe);
  });
}

function stopAnalyticsListeners() {
  while (unsubscribeAnalytics.length) {
    const unsubscribe = unsubscribeAnalytics.pop();
    try { unsubscribe(); } catch (error) {
      console.warn("Unable to stop analytics listener:", error);
    }
  }
  isShuttingDown = true;
}

/* =========================================================
   DATE HELPERS
========================================================= */

function toDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLastSevenDays() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return date;
  });
}

function getChartLabels(days) {
  return days.map(date => date.toLocaleDateString("en-PH", {
    weekday: "short"
  }));
}

function countDocumentsByDay(documents, days, dateSelector) {
  const counts = new Map(days.map(date => [dayKey(date), 0]));

  documents.forEach(document => {
    const date = dateSelector(document);
    if (!date) return;

    const key = dayKey(date);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });

  return days.map(date => counts.get(dayKey(date)) || 0);
}

/* =========================================================
   CHART RENDERING — LINE CHART
   SVG is generated from real Firestore values. No fake data.
========================================================= */

function renderLineChart(elementId, labels, series, options = {}) {
  const svg = $(elementId);
  if (!svg) return;

  const width = options.width || 760;
  const height = options.height || 290;
  const margin = { top: 20, right: 22, bottom: 43, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = series.flatMap(item => item.values).filter(Number.isFinite);
  const maxValue = Math.max(1, ...allValues);
  const scaleMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const xAt = index => margin.left + (labels.length <= 1 ? plotWidth / 2 : index * plotWidth / (labels.length - 1));
  const yAt = value => margin.top + plotHeight - (Math.max(0, value) / scaleMax) * plotHeight;

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = scaleMax - (scaleMax / 4) * index;
    const y = margin.top + (plotHeight / 4) * index;
    return `
      <line class="chart-gridline" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" />
      <text class="chart-axis-label" x="${margin.left - 12}" y="${y + 4}" text-anchor="end">${Math.round(value)}</text>
    `;
  }).join("");

  const xLabels = labels.map((label, index) => `
    <text class="chart-axis-label" x="${xAt(index)}" y="${height - 12}" text-anchor="middle">${escapeXML(label)}</text>
  `).join("");

  const paths = series.map((item, seriesIndex) => {
    const points = item.values.map((value, index) => ({ x: xAt(index), y: yAt(value), value }));
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const dots = points.map((point, index) => `
      <circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4.5" fill="${item.color}">
        <title>${escapeXML(item.name)} · ${escapeXML(labels[index])}: ${point.value}</title>
      </circle>
    `).join("");

    return `
      <path class="chart-line" d="${path}" stroke="${item.color}" />
      ${dots}
    `;
  }).join("");

  svg.innerHTML = `
    <title>${escapeXML(options.title || "Analytics line chart")}</title>
    ${grid}
    ${paths}
    ${xLabels}
  `;
}

/* =========================================================
   CHART RENDERING — BAR CHART
========================================================= */

function renderBarChart(elementId, items) {
  const svg = $(elementId);
  if (!svg) return;

  const width = 760;
  const height = 290;
  const margin = { top: 24, right: 24, bottom: 48, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...items.map(item => Number(item.value) || 0));
  const scaleMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const slotWidth = plotWidth / Math.max(items.length, 1);
  const barWidth = Math.min(94, slotWidth * .48);

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = scaleMax - (scaleMax / 4) * index;
    const y = margin.top + (plotHeight / 4) * index;
    return `
      <line class="chart-gridline" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" />
      <text class="chart-axis-label" x="${margin.left - 12}" y="${y + 4}" text-anchor="end">${Math.round(value)}</text>
    `;
  }).join("");

  const bars = items.map((item, index) => {
    const value = Math.max(0, Number(item.value) || 0);
    const barHeight = (value / scaleMax) * plotHeight;
    const x = margin.left + slotWidth * index + (slotWidth - barWidth) / 2;
    const y = margin.top + plotHeight - barHeight;
    const labelY = Math.max(margin.top + 13, y - 10);
    const labelX = margin.left + slotWidth * index + slotWidth / 2;

    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="9" fill="${item.color}" opacity=".88">
        <title>${escapeXML(item.label)}: ${value}</title>
      </rect>
      <text class="chart-value-label" x="${labelX}" y="${labelY}" text-anchor="middle">${value}</text>
      <text class="chart-axis-label" x="${labelX}" y="${height - 13}" text-anchor="middle">${escapeXML(item.label)}</text>
    `;
  }).join("");

  svg.innerHTML = `<title>Current platform totals for teachers, modules, and lessons</title>${grid}${bars}`;
}

function escapeXML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
}

/* =========================================================
   LEGEND AND STATUS
========================================================= */

function renderLegend(elementId, series) {
  const container = $(elementId);
  if (!container) return;

  container.innerHTML = series.map(item => `
    <span class="admin-legend-item">
      <span class="admin-legend-swatch" style="background:${item.color}"></span>
      ${escapeXML(item.name)}
    </span>
  `).join("");
}

function setDashboardStatus(message, hasWarning = false) {
  if (!dashboardDataStatus) return;
  dashboardDataStatus.textContent = "";
  dashboardDataStatus.classList.toggle("has-warning", hasWarning);

  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  dashboardDataStatus.append(dot, document.createTextNode(message));
}

/* =========================================================
   BUILD CHART SERIES FROM FIRESTORE RECORDS
========================================================= */

function getStudentGrowthSeries(days) {
  const students = state.users.filter(user => normalizeRole(user.role) === "student");
  return countDocumentsByDay(students, days, student => toDate(student.createdAt));
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getLatestRecordDate(record, sourceName) {
  if (sourceName === "users") {
    return toDate(record.lastLogin || record.updatedAt || record.createdAt);
  }
  return toDate(record.updatedAt || record.publishedAt || record.createdAt || record.timestamp);
}

function buildPlatformActivity(days) {
  const people = state.users;
  const learning = [
    ...state.modules,
    ...state.modulesV2,
    ...state.lessons
  ];
  const classActivities = [
    ...state.teacherActivitiesV2,
    ...state.announcements,
    ...state.quizzesV2
  ];

  return [
    {
      name: "People",
      color: CHART_COLORS.people,
      values: countDocumentsByDay(people, days, record => getLatestRecordDate(record, "users"))
    },
    {
      name: "Learning resources",
      color: CHART_COLORS.learning,
      values: countDocumentsByDay(learning, days, record => getLatestRecordDate(record, "content"))
    },
    {
      name: "Class activities",
      color: CHART_COLORS.classwork,
      values: countDocumentsByDay(classActivities, days, record => getLatestRecordDate(record, "activities"))
    }
  ];
}

/* =========================================================
   UPDATE THE COMPLETE DASHBOARD
========================================================= */

function renderDashboardAnalytics() {
  if (isShuttingDown || readyCollections.size === 0) return;

  if (readyCollections.size < collectionNames.length) {
    setDashboardStatus(`Loading live data sources (${readyCollections.size}/${collectionNames.length})...`);
    return;
  }

  const userRecords = state.users;
  const students = userRecords.filter(user => normalizeRole(user.role) === "student");
  const teachers = userRecords.filter(user => normalizeRole(user.role) === "teacher");
  const modules = state.modules.length + state.modulesV2.length;
  const lessons = state.lessons.length;

  const days = getLastSevenDays();
  const labels = getChartLabels(days);

  if (studentTotal) studentTotal.textContent = failedCollections.has("users") ? "—" : students.length.toLocaleString("en-PH");
  if (resourceTotal) {
    const resourcesTotal = teachers.length + modules + lessons;
    resourceTotal.textContent = failedCollections.has("users") || failedCollections.has("modules") || failedCollections.has("modulesV2") || failedCollections.has("lessons")
      ? "—"
      : resourcesTotal.toLocaleString("en-PH");
  }

  const studentSeries = [{
    name: "Student registrations",
    color: CHART_COLORS.students,
    values: getStudentGrowthSeries(days)
  }];

  renderLineChart("studentGrowthChart", labels, studentSeries, {
    title: "Student account registrations over the last seven days"
  });
  renderLegend("studentGrowthLegend", studentSeries);

  renderBarChart("resourceBarChart", [
    { label: "Teachers", value: teachers.length, color: CHART_COLORS.teachers },
    { label: "Modules", value: modules, color: CHART_COLORS.modules },
    { label: "Lessons", value: lessons, color: CHART_COLORS.lessons }
  ]);

  const activitySeries = buildPlatformActivity(days);
  renderLineChart("platformActivityChart", labels, activitySeries, {
    width: 1100,
    height: 320,
    title: "Live platform record activity over the last seven days"
  });
  renderLegend("platformActivityLegend", activitySeries);

  const issueCount = failedCollections.size;
  if (issueCount) {
    const names = [...failedCollections].join(", ");
    setDashboardStatus(`Some data sources could not be read: ${names}. Charts may be incomplete.`, true);
    if (activityLiveStatus) {
      activityLiveStatus.textContent = "PARTIAL DATA";
      activityLiveStatus.classList.add("is-error");
    }
  } else if (readyCollections.size === collectionNames.length) {
    setDashboardStatus("Live Firestore data connected · charts update when platform records change.");
    if (activityLiveStatus) {
      activityLiveStatus.textContent = "LIVE";
      activityLiveStatus.classList.remove("is-error");
    }
  }

  if (studentGrowthCaption) {
    studentGrowthCaption.textContent = failedCollections.has("users")
      ? "Student profile data is currently unavailable."
      : "Based on the createdAt timestamp stored in student profiles.";
  }

  if (platformActivityCaption) {
    const refreshedAt = new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
    platformActivityCaption.textContent = `Live Firestore listeners · last refreshed ${refreshedAt}. Each record is counted once on its latest available timestamp (lastLogin, updatedAt, publishedAt, or createdAt).`;
  }
}

/* =========================================================
   LOGOUT — EXISTING APPLICATION HOOK
========================================================= */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async event => {
    event.preventDefault();
    try {
      stopAnalyticsListeners();
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Logout error:", error);
      alert("Unable to logout.");
    }
  });
}

window.addEventListener("beforeunload", stopAnalyticsListeners, { once: true });
