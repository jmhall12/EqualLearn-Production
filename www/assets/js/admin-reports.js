import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const table = $("reportsTable");
const totalStudents = $("totalStudents");
const passingStudents = $("passingStudents");
const failingStudents = $("failingStudents");
const activeStudents = $("activeStudents");
const studentsWithProgress = $("studentsWithProgress");
const completedLessons = $("completedLessons");
const searchStudent = $("searchStudent");
const courseFilter = $("courseFilter");
const yearFilter = $("yearFilter");
const resultFilter = $("resultFilter");
const statusFilter = $("statusFilter");
const reportsUpdated = $("reportsUpdated");
const reportCount = $("reportCount");

let reports = [];
let users = [];
let progressRecords = [];
let usersReady = false;
let progressReady = false;
let unsubscribeUsers = null;
let unsubscribeProgress = null;
let authChecked = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!userSnapshot.exists() || userSnapshot.data().role !== "admin") {
      alert("Access denied. Admins only.");
      window.location.href = "../login.html";
      return;
    }

    if (authChecked) return;
    authChecked = true;
    startLiveReports();
  } catch (error) {
    console.error("Admin reports auth error:", error);
    showTableMessage("Unable to verify administrator access. Please refresh and try again.", "empty");
    if (reportsUpdated) reportsUpdated.textContent = "Connection error";
  }
});

function startLiveReports() {
  showTableMessage("Loading live student reports…", "loading");

  unsubscribeUsers = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      users = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      usersReady = true;
      rebuildReports();
    },
    (error) => handleLiveError("users", error)
  );

  unsubscribeProgress = onSnapshot(
    collection(db, "progress"),
    (snapshot) => {
      progressRecords = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      progressReady = true;
      rebuildReports();
    },
    (error) => handleLiveError("progress", error)
  );
}

function handleLiveError(source, error) {
  console.error(`Live ${source} listener error:`, error);
  if (reportsUpdated) reportsUpdated.textContent = "Live connection interrupted";
  if (!usersReady || !progressReady) {
    showTableMessage("Unable to load reports. Check your Firebase connection and Firestore permissions.", "empty");
  }
}

function rebuildReports() {
  if (!usersReady || !progressReady) return;

  const progressByUser = new Map();
  for (const item of progressRecords) {
    if (!item.userId) continue;
    if (!progressByUser.has(item.userId)) progressByUser.set(item.userId, []);
    progressByUser.get(item.userId).push(item);
  }

  reports = users
    .filter((user) => user.role === "student")
    .map((user) => {
      const progress = progressByUser.get(user.id) || [];
      const percentages = progress.map((record) => Number(record.percentage || 0));
      const grade = percentages.length
        ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length)
        : 0;

      const completed = progress.filter((record) => record.completed === true);
      const lastActivity = progress.reduce((latest, record) => {
        const date = toDate(record.completedAt || record.updatedAt || record.createdAt);
        return date && (!latest || date > latest) ? date : latest;
      }, null);

      return {
        id: user.id,
        fullname: user.fullname || "Unknown Student",
        studentNumber: user.studentNumber || "—",
        email: user.email || "",
        course: user.course || "—",
        yearLevel: String(user.yearLevel ?? "—"),
        grade,
        result: grade >= 75 ? "passing" : "failing",
        schoolStatus: String(user.schoolStatus || "active").toLowerCase(),
        lessonsCompleted: completed.length,
        progressRecords: progress.length,
        lastActivity
      };
    });

  updateFilters();
  renderReports();
  if (reportsUpdated) {
    reportsUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
}

function renderReports() {
  if (!table) return;

  const search = (searchStudent?.value || "").trim().toLowerCase();
  const course = courseFilter?.value || "";
  const year = yearFilter?.value || "";
  const result = resultFilter?.value || "";
  const schoolStatus = statusFilter?.value || "";

  const filtered = reports.filter((student) => {
    const matchesSearch = !search ||
      student.fullname.toLowerCase().includes(search) ||
      student.studentNumber.toLowerCase().includes(search) ||
      student.email.toLowerCase().includes(search);
    return matchesSearch &&
      (!course || student.course === course) &&
      (!year || student.yearLevel === year) &&
      (!result || student.result === result) &&
      (!schoolStatus || student.schoolStatus === schoolStatus);
  });

  updateSummary();
  if (reportCount) reportCount.textContent = `${filtered.length} of ${reports.length} students`;

  if (!filtered.length) {
    showTableMessage("No students match the selected filters.", "empty");
    return;
  }

  table.replaceChildren();
  for (const student of filtered) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="student-name">${escapeHTML(student.fullname)}</div>
        <div class="student-email">${escapeHTML(student.email)}</div>
      </td>
      <td>${escapeHTML(student.studentNumber)}</td>
      <td>${escapeHTML(student.course)}</td>
      <td>${escapeHTML(student.yearLevel)}</td>
      <td><span class="grade">${student.grade}%</span></td>
      <td><span class="lesson-count">${student.lessonsCompleted}</span></td>
      <td><span class="last-activity">${student.lastActivity ? formatDate(student.lastActivity) : "No activity yet"}</span></td>
      <td><span class="badge ${student.result === "passing" ? "badge-passing" : "badge-failing"}">${student.result === "passing" ? "PASSING" : "FAILING"}</span></td>
      <td><span class="badge ${student.schoolStatus === "active" ? "badge-active" : "badge-inactive"}">${student.schoolStatus === "active" ? "ACTIVE" : "INACTIVE"}</span></td>
    `;
    table.appendChild(row);
  }
}

function updateSummary() {
  const total = reports.length;
  const passing = reports.filter((student) => student.result === "passing").length;
  const failing = reports.filter((student) => student.result === "failing").length;
  const active = reports.filter((student) => student.schoolStatus === "active").length;
  const withQuizActivity = reports.filter((student) => student.progressRecords > 0).length;
  const completed = reports.reduce((sum, student) => sum + student.lessonsCompleted, 0);
  const totalProgressRecords = progressRecords.length;

  setDonutMetric("totalStudents", total, total > 0 ? 100 : 0);
  setDonutMetric("passingStudents", passing, total ? (passing / total) * 100 : 0);
  setDonutMetric("failingStudents", failing, total ? (failing / total) * 100 : 0);
  setDonutMetric("activeStudents", active, total ? (active / total) * 100 : 0);
  setDonutMetric("studentsWithProgress", withQuizActivity, total ? (withQuizActivity / total) * 100 : 0);
  setDonutMetric("completedLessons", completed, totalProgressRecords ? (completed / totalProgressRecords) * 100 : 0);
}

function setDonutMetric(metricId, value, percentage) {
  const valueNode = document.getElementById(metricId);
  const ring = document.getElementById(`${metricId}Ring`);
  const circumference = 2 * Math.PI * 16;
  const safePercent = Math.max(0, Math.min(100, Number(percentage) || 0));

  if (valueNode) {
    valueNode.textContent = Number(value || 0).toLocaleString("en-PH");
  }

  if (ring) {
    ring.style.strokeDasharray = `${circumference} ${circumference}`;
    ring.style.strokeDashoffset = String(circumference * (1 - safePercent / 100));
    ring.setAttribute("aria-label", `${safePercent.toFixed(1)} percent`);
  }
}

function updateFilters() {
  populateSelect(courseFilter, "All Courses", reports.map((student) => student.course));
  populateSelect(yearFilter, "All Year Levels", reports.map((student) => student.yearLevel));
}

function populateSelect(select, defaultLabel, values) {
  if (!select) return;
  const selected = select.value;
  const unique = [...new Set(values.filter((value) => value && value !== "—"))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  select.innerHTML = `<option value="">${defaultLabel}</option>`;
  for (const value of unique) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  if (unique.includes(selected)) select.value = selected;
}

function showTableMessage(message, className) {
  if (!table) return;
  table.innerHTML = `<tr><td colspan="9" class="${className}">${escapeHTML(message)}</td></tr>`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date) {
  return date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

searchStudent?.addEventListener("input", renderReports);
courseFilter?.addEventListener("change", renderReports);
yearFilter?.addEventListener("change", renderReports);
resultFilter?.addEventListener("change", renderReports);
statusFilter?.addEventListener("change", renderReports);

window.addEventListener("beforeunload", () => {
  unsubscribeUsers?.();
  unsubscribeProgress?.();
});
