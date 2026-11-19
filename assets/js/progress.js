
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — LIVE STUDENT PROGRESS
   Sources:
   - progress
   - quizAttempts

   Automatically updates when Firestore records change.
========================================================= */

const container = document.getElementById("progressContainer");

let unsubscribeProgress = null;
let unsubscribeAttempts = null;

let lessonProgress = [];
let quizAttempts = [];

let currentUser = null;

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function stopListeners() {
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }

  if (unsubscribeAttempts) {
    unsubscribeAttempts();
    unsubscribeAttempts = null;
  }
}

/* =========================================================
   RENDER
========================================================= */

function renderProgress() {
  if (!container) return;

  const records = [
    ...lessonProgress.map(item => ({
      ...item,
      recordType: "lesson"
    })),

    ...quizAttempts.map(item => ({
      ...item,
      recordType: "quiz"
    }))
  ];

  records.sort((a, b) => {
    const dateA = a.submittedAt?.toDate?.()?.getTime()
      || a.completedAt?.toDate?.()?.getTime()
      || a.updatedAt?.toDate?.()?.getTime()
      || 0;

    const dateB = b.submittedAt?.toDate?.()?.getTime()
      || b.completedAt?.toDate?.()?.getTime()
      || b.updatedAt?.toDate?.()?.getTime()
      || 0;

    return dateB - dateA;
  });

  if (!records.length) {
    container.innerHTML = `
      <div class="progress-empty">
        <h3>No progress yet</h3>
        <p>
          Your completed lessons and submitted quizzes
          will appear here automatically.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = records.map(record => {
    const isQuiz = record.recordType === "quiz";

    const title = isQuiz
      ? record.quizTitle || "Quiz Assessment"
      : record.lessonId || record.lessonTitle || "Learning Lesson";

    const hasScore =
      record.score !== null &&
      record.score !== undefined &&
      record.total !== null &&
      record.total !== undefined &&
      number(record.total) > 0;

    const percentage = hasScore
      ? Math.round((number(record.score) / number(record.total)) * 100)
      : null;

    const result = hasScore
      ? (
          percentage >= number(record.passingScore || 60)
            ? "PASSING"
            : "FAILING"
        )
      : "PENDING GRADING";

    const resultClass = hasScore
      ? (result === "PASSING" ? "passing" : "failing")
      : "pending";

    const date = isQuiz
      ? record.submittedAt
      : record.completedAt || record.updatedAt || record.createdAt;

    const scoreText = hasScore
      ? `${number(record.score)} / ${number(record.total)}`
      : "Not graded yet";

    const gradeText = hasScore
      ? `${percentage}%`
      : "Pending";

    return `
      <article class="progress-card">
        <div class="progress-card-header">
          <span class="progress-type">
            ${isQuiz ? "QUIZ ASSESSMENT" : "LESSON PROGRESS"}
          </span>

          <span class="progress-status ${resultClass}">
            ${result}
          </span>
        </div>

        <h3>${escapeHTML(title)}</h3>

        <p>
          Score:
          <strong>${escapeHTML(scoreText)}</strong>
        </p>

        <p>
          Grade:
          <strong>${escapeHTML(gradeText)}</strong>
        </p>

        <p>
          Status:
          <strong>
            ${escapeHTML(record.status || "Recorded")}
          </strong>
        </p>

        <p class="progress-date">
          ${escapeHTML(formatDate(date))}
        </p>
      </article>
    `;
  }).join("");
}

/* =========================================================
   REAL-TIME FIRESTORE LISTENERS
========================================================= */

function listenToProgress(user) {
  const progressQuery = query(
    collection(db, "progress"),
    where("userId", "==", user.uid)
  );

  unsubscribeProgress = onSnapshot(
    progressQuery,

    snapshot => {
      lessonProgress = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderProgress();

      console.log("[EqualLearn] Live lesson progress:", {
        count: lessonProgress.length
      });
    },

    error => {
      console.error(
        "[EqualLearn] Progress listener error:",
        error
      );

      container.innerHTML = `
        <div class="progress-error">
          <h3>Unable to load lesson progress</h3>
          <p>${escapeHTML(error.message)}</p>
        </div>
      `;
    }
  );
}

function listenToQuizAttempts(user) {
  const attemptsQuery = query(
    collection(db, "quizAttempts"),
    where("userId", "==", user.uid)
  );

  unsubscribeAttempts = onSnapshot(
    attemptsQuery,

    snapshot => {
      quizAttempts = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderProgress();

      console.log("[EqualLearn] Live quiz attempts:", {
        count: quizAttempts.length
      });
    },

    error => {
      console.error(
        "[EqualLearn] Quiz attempts listener error:",
        error
      );
    }
  );
}

/* =========================================================
   AUTHENTICATION
========================================================= */

onAuthStateChanged(auth, user => {
  stopListeners();

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  lessonProgress = [];
  quizAttempts = [];

  if (container) {
    container.innerHTML = `
      <div class="progress-loading">
        Loading your learning progress...
      </div>
    `;
  }

  listenToProgress(currentUser);
  listenToQuizAttempts(currentUser);
});

/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener("pagehide", stopListeners);
