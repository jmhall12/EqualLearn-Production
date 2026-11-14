import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — STUDENT QUIZ LIST
   Reads the existing "quizzes" and "quizQuestions" collections
   (the same records used by quiz.js and quiz-builder.js).
   No data model or configuration changes are made here.
========================================================= */

const $ = id => document.getElementById(id);

const quizList = $("quizList");
const quizSearch = $("quizSearch");
const quizCount = $("quizCount");
const quizEmpty = $("quizEmpty");

let profile = null;
let quizzes = [];
let questionCounts = new Map();

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sectionsOf(record) {
  if (Array.isArray(record.sectionIds)) {
    return record.sectionIds.map(String);
  }
  if (record.sectionId) return [String(record.sectionId)];
  return [];
}

function isPublished(record) {
  return ["active", "published"].includes(normalize(record.status));
}

function availability(record) {
  const now = Date.now();
  const available = toDate(record.availableAt);
  const due = toDate(record.dueDate);

  if (available && now < available.getTime()) {
    return { state: "upcoming", label: `Opens ${formatDate(available)}` };
  }

  if (due && now > due.getTime()) {
    return { state: "closed", label: `Closed ${formatDate(due)}` };
  }

  return {
    state: "open",
    label: due ? `Due ${formatDate(due)}` : "No deadline"
  };
}

/* ---------------------------------------------------------
   DATA
--------------------------------------------------------- */

async function loadQuizzes() {
  const studentSection = String(profile.sectionId || "");

  const snapshot = await getDocs(collection(db, "quizzes"));

  quizzes = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(isPublished)
    .map(record => {
      const sections = sectionsOf(record);
      return { ...record, sections };
    })
    .filter(record => {
      if (!record.sections.length) return true;
      if (!studentSection) return false;
      return record.sections.includes(studentSection);
    });

  try {
    const questions = await getDocs(collection(db, "quizQuestions"));
    questionCounts = new Map();
    questions.docs.forEach(item => {
      const quizId = String(item.data().quizId || "");
      if (!quizId) return;
      questionCounts.set(quizId, (questionCounts.get(quizId) || 0) + 1);
    });
  } catch (error) {
    console.warn("[EqualLearn] Question counts unavailable:", error);
  }
}

/* ---------------------------------------------------------
   RENDER
--------------------------------------------------------- */

function card(record) {
  const status = availability(record);
  const count = questionCounts.get(record.id) || 0;
  const teacher = record.teacherName || "Your teacher";

  const action = status.state === "open"
    ? `<a class="quiz-open" href="quiz.html?id=${encodeURIComponent(record.id)}">Open quiz →</a>`
    : `<span class="quiz-open is-disabled">${escapeHTML(status.label)}</span>`;

  return `
    <article class="quiz-item">
      <div class="quiz-item-main">
        <div class="quiz-item-top">
          <span class="quiz-eyebrow">${escapeHTML(teacher)}</span>
          <span class="quiz-status ${status.state}">${escapeHTML(
            status.state === "open" ? "Available" : status.state === "upcoming" ? "Upcoming" : "Closed"
          )}</span>
        </div>
        <h3>${escapeHTML(record.title || "Untitled quiz")}</h3>
        <p>${escapeHTML(record.description || "Open this quiz to see its instructions.")}</p>
        <div class="quiz-meta">
          <span>${count ? `${count} question${count === 1 ? "" : "s"}` : "Questions available inside"}</span>
          <span>${escapeHTML(status.label)}</span>
        </div>
      </div>
      ${action}
    </article>
  `;
}

function render() {
  if (!quizList) return;

  const term = normalize(quizSearch?.value);
  const lessonFilter = new URLSearchParams(location.search).get("lesson") || "";

  const rows = quizzes.filter(record => {
    if (lessonFilter && String(record.lessonId || "") !== lessonFilter) return false;
    if (!term) return true;
    return normalize(`${record.title} ${record.description} ${record.teacherName}`).includes(term);
  });

  if (quizCount) {
    quizCount.textContent = `${rows.length} quiz${rows.length === 1 ? "" : "zes"}`;
  }

  if (!rows.length) {
    quizList.innerHTML = "";
    if (quizEmpty) quizEmpty.style.display = "block";
    return;
  }

  if (quizEmpty) quizEmpty.style.display = "none";
  quizList.innerHTML = rows.map(card).join("");
}

/* ---------------------------------------------------------
   BOOT
--------------------------------------------------------- */

quizSearch?.addEventListener("input", render);

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));

    if (!snapshot.exists()) {
      throw new Error("Student profile not found.");
    }

    profile = snapshot.data();

    if (normalize(profile.role) !== "student") {
      throw new Error("An active student account is required.");
    }

    if (normalize(profile.status || "active") !== "active") {
      throw new Error("This student account is not active.");
    }

    await loadQuizzes();
    render();
  } catch (error) {
    console.error("[EqualLearn] Quiz list error:", error);

    if (quizList) {
      quizList.innerHTML = `
        <div class="quiz-message">
          <strong>Quizzes could not be loaded.</strong>
          <p>${escapeHTML(error.message || "Please try again.")}</p>
        </div>
      `;
    }

    if (quizEmpty) quizEmpty.style.display = "none";
  }
});
