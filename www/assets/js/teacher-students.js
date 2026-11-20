
import { db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — TEACHER STUDENT DIRECTORY
   Live student progress monitoring
   Sources:
   - users
   - sections
   - progress
   - quizAttempts
========================================================= */

let allStudents = [];

const studentProgress = new Map();
const studentAttempts = new Map();
const listeners = new Map();

// Keep expanded student cards open when live progress snapshots re-render the grid.
const expandedStudentIds = new Set();

let currentTeacher = null;

function $(id) {
  return document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function isProfileComplete(student) {
  return Boolean(
    student.profileCompleted &&
    student.studentNumber &&
    student.course &&
    student.yearLevel
  );
}

function getInitials(name) {
  return String(name || "Student")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

/* =========================================================
   STUDENT PROFILE PHOTO
========================================================= */

function getStudentPhotoURL(student) {
  const photoURL = String(
    student.photoURL ||
    student.profileImage ||
    ""
  ).trim();

  if (photoURL) return photoURL;

  const base64 = String(
    student.profileImageBase64 || ""
  ).trim();

  if (!base64) return "";

  // Supports existing data URLs and raw Base64.
  if (base64.startsWith("data:image/")) {
    return base64;
  }

  const mime = String(
    student.profileImageMime || "image/jpeg"
  ).trim();

  return `data:${mime};base64,${base64}`;
}

function renderStudentAvatar(student) {
  const initials = escapeHTML(
    getInitials(student.fullname)
  );

  const photoURL = getStudentPhotoURL(student);

  if (!photoURL) {
    return `
      <div class="student-avatar" aria-label="${initials}">
        ${initials}
      </div>
    `;
  }

  return `
    <div class="student-avatar has-photo" aria-label="${initials}">
      <img
        src="${escapeHTML(photoURL)}"
        alt="${escapeHTML(student.fullname || "Student")} profile picture"
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror="this.hidden=true; this.nextElementSibling.hidden=false"
      >

      <span class="student-avatar-fallback" hidden>
        ${initials}
      </span>
    </div>
  `;
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function getAttemptScore(attempt) {
  if (
    attempt.score === null ||
    attempt.score === undefined ||
    attempt.total === null ||
    attempt.total === undefined
  ) {
    return null;
  }

  const score = Number(attempt.score);
  const total = Number(attempt.total);

  if (
    !Number.isFinite(score) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }

  return {
    score,
    total,
    percentage: Math.round((score / total) * 100)
  };
}

/* =========================================================
   DYNAMIC PROGRESS DESIGN
========================================================= */

function injectProgressStyles() {
  if ($("teacher-progress-styles")) return;

  const style = document.createElement("style");
  style.id = "teacher-progress-styles";

  style.textContent = `
    .live-progress-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 15px;
      margin: 0 0 23px;
    }

    .live-progress-stat {
      background: var(--el-surface);
      border: 1px solid var(--directory-border);
      border-radius: 18px;
      padding: 19px;
      box-shadow: 0 8px 28px rgba(30,35,65,.035);
    }

    .live-progress-stat small {
      color: var(--el-muted);
      font-size: 12px;
      font-weight: 650;
    }

    .live-progress-stat strong {
      display: block;
      font-size: 27px;
      font-weight: 850;
      margin-top: 10px;
    }

    .live-progress-stat span {
      display: block;
      color: var(--el-muted);
      font-size: 11px;
      margin-top: 4px;
    }

    .student-live-progress {
      margin-top: 17px;
      padding: 15px;
      border-radius: 14px;
      background: rgba(99,91,255,.055);
      border: 1px solid rgba(99,91,255,.12);
    }

    .student-live-progress h4 {
      margin: 0 0 13px;
      font-size: 13px;
    }

    .student-progress-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 9px;
    }

    .student-progress-metric {
      min-width: 0;
    }

    .student-progress-metric span {
      display: block;
      font-size: 10px;
      color: var(--el-muted);
      margin-bottom: 5px;
    }

    .student-progress-metric strong {
      font-size: 16px;
      font-weight: 850;
      overflow-wrap: anywhere;
    }

    .student-progress-track {
      height: 7px;
      border-radius: 20px;
      overflow: hidden;
      background: rgba(120,120,150,.15);
      margin-top: 13px;
    }

    .student-progress-track span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg,#635bff,#9a80ff);
      border-radius: inherit;
      transition: width .3s ease;
    }

    .student-attempt-list {
      margin-top: 13px;
      border-top: 1px solid rgba(120,120,150,.18);
      padding-top: 11px;
    }

    .student-attempt-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-size: 11px;
    }

    .student-attempt-row strong {
      display: block;
      font-size: 11px;
    }

    .student-attempt-row small {
      color: var(--el-muted);
    }

    .attempt-status {
      padding: 5px 8px;
      border-radius: 20px;
      font-size: 9px;
      font-weight: 800;
      white-space: nowrap;
    }

    .attempt-status.pending {
      color: #9a6500;
      background: #fff2ce;
    }

    .attempt-status.graded {
      color: #16834c;
      background: #e6f8ed;
    }

    .attempt-status.submitted {
      color: #6255cb;
      background: #efedff;
    }

    .student-progress-loading {
      color: var(--el-muted);
      font-size: 11px;
    }

    .live-progress-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #16834c;
      font-size: 11px;
      font-weight: 750;
    }

    .live-progress-indicator::before {
      content: "";
      width: 7px;
      height: 7px;
      background: #20b66a;
      border-radius: 50%;
      box-shadow: 0 0 0 4px rgba(32,182,106,.12);
    }

    /* Student profile photos */

    .student-avatar.has-photo {
      position: relative;
      overflow: hidden;
      padding: 0;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }

    .student-avatar.has-photo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
    }

    .student-avatar-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font: inherit;
    }

    .student-avatar-fallback[hidden] {
      display: none;
    }

    @media(max-width:760px) {
      .live-progress-stats {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media(max-width:420px) {
      .student-progress-metrics {
        grid-template-columns: 1fr 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}

function createProgressStats() {
  const directoryStats = document.querySelector(".directory-stats");

  if (!directoryStats || $("liveProgressStats")) return;

  const wrapper = document.createElement("section");
  wrapper.id = "liveProgressStats";
  wrapper.className = "live-progress-stats";

  wrapper.innerHTML = `
    <article class="live-progress-stat">
      <small>Quiz Submissions</small>
      <strong id="totalQuizSubmissions">—</strong>
      <span>Submitted by your students</span>
    </article>

    <article class="live-progress-stat">
      <small>Pending Grading</small>
      <strong id="pendingQuizGrading">—</strong>
      <span>Awaiting teacher evaluation</span>
    </article>

    <article class="live-progress-stat">
      <small>Graded Quizzes</small>
      <strong id="gradedQuizCount">—</strong>
      <span>Quiz attempts with scores</span>
    </article>

    <article class="live-progress-stat">
      <small>Average Quiz Score</small>
      <strong id="averageQuizScore">—</strong>
      <span>Based on graded submissions</span>
    </article>
  `;

  directoryStats.insertAdjacentElement("afterend", wrapper);
}

/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {
  const totalElement = $("totalStudents");
  const completedElement = $("completedProfiles");
  const pendingElement = $("pendingProfiles");

  const total = allStudents.length;

  const completed = allStudents.filter(
    isProfileComplete
  ).length;

  const pending = allStudents.filter(
    student => student.academicProfileVerified !== true
  ).length;

  if (totalElement) {
    totalElement.textContent = total.toLocaleString("en-PH");
  }

  if (completedElement) {
    completedElement.textContent = completed.toLocaleString("en-PH");
  }

  if (pendingElement) {
    pendingElement.textContent = pending.toLocaleString("en-PH");
  }

  let submissions = 0;
  let pendingGrading = 0;
  let graded = 0;
  let scoreTotal = 0;

  allStudents.forEach(student => {
    const attempts = studentAttempts.get(student.uid) || [];

    attempts.forEach(attempt => {
      submissions++;

      const result = getAttemptScore(attempt);

      if (result) {
        graded++;
        scoreTotal += result.percentage;
      } else {
        pendingGrading++;
      }
    });
  });

  if ($("totalQuizSubmissions")) {
    $("totalQuizSubmissions").textContent =
      submissions.toLocaleString("en-PH");
  }

  if ($("pendingQuizGrading")) {
    $("pendingQuizGrading").textContent =
      pendingGrading.toLocaleString("en-PH");
  }

  if ($("gradedQuizCount")) {
    $("gradedQuizCount").textContent =
      graded.toLocaleString("en-PH");
  }

  if ($("averageQuizScore")) {
    $("averageQuizScore").textContent = graded
      ? `${Math.round(scoreTotal / graded)}%`
      : "—";
  }
}

/* =========================================================
   STUDENT PROGRESS DATA
========================================================= */

function getStudentProgressSummary(studentId) {
  const progressRecords = studentProgress.get(studentId) || [];
  const attempts = studentAttempts.get(studentId) || [];

  const lessonCount = progressRecords.length;

  const completedLessons = progressRecords.filter(record => {
    const status = String(record.status || "").toLowerCase();

    return (
      status === "completed" ||
      status === "complete" ||
      record.completed === true ||
      record.isCompleted === true
    );
  }).length;

  const gradedAttempts = attempts.filter(
    attempt => getAttemptScore(attempt) !== null
  );

  const average = gradedAttempts.length
    ? Math.round(
        gradedAttempts.reduce(
          (sum, attempt) =>
            sum + getAttemptScore(attempt).percentage,
          0
        ) / gradedAttempts.length
      )
    : null;

  const completionPercentage = lessonCount
    ? Math.round((completedLessons / lessonCount) * 100)
    : 0;

  return {
    lessonCount,
    completedLessons,
    attempts: attempts.length,
    graded: gradedAttempts.length,
    average,
    completionPercentage
  };
}

function renderStudentProgress(studentId) {
  const progress = getStudentProgressSummary(studentId);
  const attempts = studentAttempts.get(studentId) || [];

  const attemptRows = [...attempts]
    .sort((a, b) => {
      const aTime = a.submittedAt?.toMillis?.() || 0;
      const bTime = b.submittedAt?.toMillis?.() || 0;
      return bTime - aTime;
    })
    .slice(0, 3)
    .map(attempt => {
      const result = getAttemptScore(attempt);

      const status = result
        ? "Graded"
        : String(attempt.status || "submitted").toLowerCase() === "submitted"
          ? "Pending grading"
          : escapeHTML(attempt.status || "Submitted");

      const statusClass = result
        ? "graded"
        : status === "Pending grading"
          ? "pending"
          : "submitted";

      const scoreLabel = result
        ? `${result.score}/${result.total} (${result.percentage}%)`
        : "Not graded yet";

      return `
        <div class="student-attempt-row">
          <div>
            <strong>${escapeHTML(attempt.quizTitle || "Quiz assessment")}</strong>
            <small>${escapeHTML(formatDate(attempt.submittedAt))}</small>
            <small style="display:block">${escapeHTML(scoreLabel)}</small>
          </div>

          <span class="attempt-status ${statusClass}">
            ${escapeHTML(status)}
          </span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="student-live-progress">

      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:8px;
        margin-bottom:13px;
      ">
        <h4>Learning Progress</h4>
        <span class="live-progress-indicator">Live</span>
      </div>

      <div class="student-progress-metrics">

        <div class="student-progress-metric">
          <span>Lessons completed</span>
          <strong>${progress.completedLessons}/${progress.lessonCount}</strong>
        </div>

        <div class="student-progress-metric">
          <span>Quiz attempts</span>
          <strong>${progress.attempts}</strong>
        </div>

        <div class="student-progress-metric">
          <span>Average score</span>
          <strong>${progress.average === null ? "—" : `${progress.average}%`}</strong>
        </div>

      </div>

      <div class="student-progress-track">
        <span style="width:${progress.completionPercentage}%"></span>
      </div>

      ${
        attemptRows
          ? `<div class="student-attempt-list">
              ${attemptRows}
            </div>`
          : `<p class="student-progress-loading">
              No quiz submissions yet.
            </p>`
      }

    </div>
  `;
}

/* =========================================================
   RENDER STUDENTS
========================================================= */

function bindStudentCardInteractions(container) {
  if (!container || container.dataset.studentRevealBound === "true") return;

  container.addEventListener("click", event => {
    const toggle = event.target.closest("[data-action='toggle-student-details']");
    if (!toggle || !container.contains(toggle)) return;

    const studentId = toggle.dataset.studentId;
    const panelId = toggle.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    const card = toggle.closest(".student-directory-card");
    const isExpanded = toggle.getAttribute("aria-expanded") === "true";
    const nextExpanded = !isExpanded;

    if (studentId) {
      if (nextExpanded) expandedStudentIds.add(studentId);
      else expandedStudentIds.delete(studentId);
    }

    toggle.setAttribute("aria-expanded", String(nextExpanded));
    toggle.setAttribute(
      "aria-label",
      `${nextExpanded ? "Hide" : "View"} details for ${toggle.dataset.studentName || "student"}`
    );

    if (panel) panel.hidden = !nextExpanded;
    if (card) card.classList.toggle("is-expanded", nextExpanded);

    const label = toggle.querySelector(".student-card-open-label");
    if (label) label.textContent = nextExpanded ? "Hide details" : "View details";
  });

  container.dataset.studentRevealBound = "true";
}

function renderStudents() {
  const container = $("teacherStudentCards");
  const searchInput = $("studentSearch");
  const verificationFilter = $("verificationFilter");

  if (!container) return;

  const searchTerm = (searchInput?.value || "").trim().toLowerCase();
  const filter = verificationFilter?.value || "all";

  let filteredStudents = allStudents.filter(student => {
    const complete = isProfileComplete(student);
    const verified = student.academicProfileVerified === true;

    if (filter === "verified" && !verified) return false;
    if (filter === "pending" && verified) return false;
    if (filter === "incomplete" && complete) return false;

    const searchableText = [
      student.fullname,
      student.email,
      student.studentNumber,
      student.course,
      student.section,
      student.sectionName,
      student.className,
      student.yearLevel,
      student.cohort,
      student.academicYear
    ].join(" ").toLowerCase();

    return searchableText.includes(searchTerm);
  });

  filteredStudents.sort((a, b) =>
    String(a.fullname || "").localeCompare(String(b.fullname || ""))
  );

  container.replaceChildren();

  if (!filteredStudents.length) {
    const empty = document.createElement("div");
    empty.className = "directory-empty";
    empty.textContent = allStudents.length
      ? "No students match your search or selected filter."
      : "No students are enrolled in your assigned sections yet.";

    container.appendChild(empty);
    return;
  }

  filteredStudents.forEach(student => {
    const studentKey = String(student.uid || "");
    const name = escapeHTML(student.fullname || "Student");
    const email = escapeHTML(student.email || "No email provided");
    const course = escapeHTML(student.course || "Not provided");

    const year = escapeHTML(
      student.yearLevel
        ? `${student.yearLevel}${
            String(student.yearLevel).match(/\D/) ? "" : " Year"
          }`
        : "Not provided"
    );

    const studentID = escapeHTML(student.studentNumber || "Not provided");
    const section = escapeHTML(
      student.section || student.sectionName || student.className || "Not provided"
    );
    const academicYear = escapeHTML(
      student.cohort || student.academicYear || student.cohortId || "Not provided"
    );

    const complete = isProfileComplete(student);
    const verified = student.academicProfileVerified === true;
    const expanded = expandedStudentIds.has(studentKey);
    const safeDomId = studentKey.replace(/[^a-zA-Z0-9_-]/g, "-") || `student-${Math.random().toString(36).slice(2)}`;
    const detailsId = `student-details-${safeDomId}`;

    const card = document.createElement("article");
    card.className = `el-card student-directory-card${expanded ? " is-expanded" : ""}`;
    card.dataset.studentCard = "true";

    card.innerHTML = `
      <button
        type="button"
        class="student-card-reveal"
        data-action="toggle-student-details"
        data-student-id="${escapeHTML(studentKey)}"
        data-student-name="${name}"
        aria-expanded="${expanded}"
        aria-controls="${escapeHTML(detailsId)}"
        aria-label="${expanded ? "Hide" : "View"} details for ${name}"
      >
        <span class="student-card-summary-main">
          ${renderStudentAvatar(student)}
          <span class="student-card-summary-copy">
            <span class="student-card-name-row">
              <span class="student-card-name">${name}</span>
              <span class="student-verification ${verified ? "verified" : "pending"}">
                ${verified ? "✓ Verified" : "◷ Pending verification"}
              </span>
            </span>
            <span class="student-card-email">${email}</span>
            <span class="student-card-summary-meta">
              <span>${complete ? "✓ Profile completed" : "⚠ Profile incomplete"}</span>
              <span class="student-card-open-label">${expanded ? "Hide details" : "View details"}</span>
            </span>
          </span>
        </span>
        <span class="student-card-chevron" aria-hidden="true">⌄</span>
      </button>

      <section
        class="student-card-expanded"
        id="${escapeHTML(detailsId)}"
        ${expanded ? "" : "hidden"}
        aria-label="${name} student details"
      >
        <div class="student-card-details">
          <div>
            <span class="student-detail-label">Course</span>
            <strong class="student-detail-value">${course}</strong>
          </div>

          <div>
            <span class="student-detail-label">Year Level</span>
            <strong class="student-detail-value">${year}</strong>
          </div>

          <div>
            <span class="student-detail-label">Student ID</span>
            <strong class="student-detail-value">${studentID}</strong>
          </div>

          <div>
            <span class="student-detail-label">Section</span>
            <strong class="student-detail-value">${section}</strong>
          </div>

          <div style="grid-column:1/-1">
            <span class="student-detail-label">Academic Year</span>
            <strong class="student-detail-value">${academicYear}</strong>
          </div>
        </div>

        ${renderStudentProgress(student.uid)}

        <div class="student-card-footer">
          <span class="student-profile-state">
            ${complete ? "✓ Profile completed" : "⚠ Profile incomplete"}
          </span>
          <span class="student-profile-state">${verified ? "Academic profile verified" : "Awaiting verification"}</span>
        </div>
      </section>
    `;

    container.appendChild(card);
  });
}
/* =========================================================
   LIVE LISTENERS
========================================================= */

function stopStudentListeners() {
  listeners.forEach(unsubscribe => unsubscribe());
  listeners.clear();

  studentProgress.clear();
  studentAttempts.clear();
}

function watchStudentRecords(student) {
  const uid = student.uid;

  if (!uid || listeners.has(uid)) return;

  // Live lesson progress.
  const progressQuery = query(
    collection(db, "progress"),
    where("userId", "==", uid)
  );

  const stopProgress = onSnapshot(
    progressQuery,
    snapshot => {
      studentProgress.set(
        uid,
        snapshot.docs.map(item => ({
          id: item.id,
          ...item.data()
        }))
      );

      updateStatistics();
      renderStudents();
    },
    error => {
      console.error(
        `[EqualLearn] Progress listener failed for ${uid}:`,
        error
      );

      studentProgress.set(uid, []);
      renderStudents();
    }
  );

  // Live quiz submissions.
  const attemptsQuery = query(
    collection(db, "quizAttempts"),
    where("userId", "==", uid)
  );

  const stopAttempts = onSnapshot(
    attemptsQuery,
    snapshot => {
      studentAttempts.set(
        uid,
        snapshot.docs.map(item => ({
          id: item.id,
          ...item.data()
        }))
      );

      updateStatistics();
      renderStudents();
    },
    error => {
      console.error(
        `[EqualLearn] Quiz attempts listener failed for ${uid}:`,
        error
      );

      studentAttempts.set(uid, []);
      renderStudents();
    }
  );

  listeners.set(uid, () => {
    stopProgress();
    stopAttempts();
  });
}

/* =========================================================
   INITIALIZE DIRECTORY
========================================================= */

requireRole("teacher", async teacherProfile => {
  const container = $("teacherStudentCards");

  if (!container) return;

  currentTeacher = teacherProfile;

  bindStudentCardInteractions(container);
  injectProgressStyles();
  createProgressStats();

  container.innerHTML = `
    <div class="directory-empty">
      Loading student records...
    </div>
  `;

  updateStatistics();
  stopStudentListeners();

  try {
    const teacherUid = teacherProfile.uid;

    if (!teacherUid) {
      throw new Error("Teacher account UID is missing.");
    }

    // Find the sections assigned to this teacher.
    const sectionsRef = collection(db, "sections");

    const [primarySections, multipleSections] = await Promise.all([
      getDocs(query(
        sectionsRef,
        where("teacherId", "==", teacherUid)
      )),

      getDocs(query(
        sectionsRef,
        where("teacherIds", "array-contains", teacherUid)
      ))
    ]);

    const sectionMap = new Map();

    [...primarySections.docs, ...multipleSections.docs].forEach(section => {
      sectionMap.set(section.id, section.data());
    });

    const sectionIds = [...sectionMap.keys()];

    if (!sectionIds.length) {
      allStudents = [];
      updateStatistics();
      renderStudents();
      return;
    }

    // Fetch students from assigned sections only.
    const studentResults = await Promise.all(
      sectionIds.map(sectionId =>
        getDocs(query(
          collection(db, "users"),
          where("role", "==", "student"),
          where("sectionId", "==", sectionId)
        ))
      )
    );

    const studentMap = new Map();

    studentResults.forEach(snapshot => {
      snapshot.docs.forEach(item => {
        studentMap.set(item.id, {
          ...item.data(),
          uid: item.id
        });
      });
    });

    allStudents = [...studentMap.values()];

    updateStatistics();
    renderStudents();

    // Start live progress and quiz listeners for each student.
    allStudents.forEach(watchStudentRecords);

    // Search and filter.
    const searchInput = $("studentSearch");
    const verificationFilter = $("verificationFilter");

    if (searchInput && !searchInput.dataset.progressBound) {
      searchInput.addEventListener("input", renderStudents);
      searchInput.dataset.progressBound = "true";
    }

    if (verificationFilter && !verificationFilter.dataset.progressBound) {
      verificationFilter.addEventListener("change", renderStudents);
      verificationFilter.dataset.progressBound = "true";
    }

    console.log(
      "[EqualLearn] Live teacher progress monitoring initialized.",
      {
        students: allStudents.length,
        sections: sectionIds.length
      }
    );

  } catch (error) {
    console.error("[EqualLearn] Teacher directory error:", error);

    container.innerHTML = `
      <div class="directory-empty">
        <strong>Unable to load student records.</strong>
        <p>${escapeHTML(error.message)}</p>
        <small>${escapeHTML(error.code || "")}</small>
      </div>
    `;
  }
});
