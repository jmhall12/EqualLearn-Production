
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — STUDENT QUIZ LIST

   Collection:
   teacherActivitiesV2

   Access:
   - Active student only
   - Published quizzes only
   - Quizzes assigned to the student's section

   Section field:
   sectionIds: ["SECTION_ID"]

   No data model or configuration changes.
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

  if (value instanceof Date) {
    return value;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

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

function isPublished(record) {
  return ["active", "published"].includes(
    normalize(record.status)
  );
}

function availability(record) {
  const now = Date.now();

  const available = toDate(record.availableAt);
  const due = toDate(record.dueDate);

  if (available && now < available.getTime()) {
    return {
      state: "upcoming",
      label: `Opens ${formatDate(available)}`
    };
  }

  if (due && now > due.getTime()) {
    return {
      state: "closed",
      label: `Closed ${formatDate(due)}`
    };
  }

  return {
    state: "open",
    label: due ? `Due ${formatDate(due)}` : "No deadline"
  };
}

/* ---------------------------------------------------------
   LOAD QUIZZES
--------------------------------------------------------- */

async function loadQuizzes() {
  const studentSection = String(
    profile?.sectionId || ""
  ).trim();

  if (!studentSection) {
    throw new Error(
      "Your account has no assigned section. Please contact your teacher or administrator."
    );
  }

  /*
   * IMPORTANT:
   * Uses sectionIds array to match section-based access.
   *
   * Firestore document example:
   *
   * {
   *   type: "quiz",
   *   status: "published",
   *   sectionIds: ["SECTION_ID"],
   *   title: "Sample Quiz"
   * }
   */

  const quizzesQuery = query(
    collection(db, "teacherActivitiesV2"),
    where("status", "==", "published"),
    where("sectionIds", "array-contains", studentSection)
  );

  console.log(
    "[EqualLearn] Loading student quizzes:",
    {
      collection: "teacherActivitiesV2",
      sectionIds: studentSection
    }
  );

  const snapshot = await getDocs(quizzesQuery);

  quizzes = snapshot.docs
    .map(item => ({
      id: item.id,
      ...item.data()
    }))
    .filter(record =>
      normalize(record.type) === "quiz"
    )
    .filter(isPublished)
    .map(record => {
      const activityData = record.activityData || {};

      return {
        ...record,

        description:
          record.description ||
          activityData.instructions ||
          "",

        questions: Array.isArray(activityData.questions)
          ? activityData.questions
          : []
      };
    });

  questionCounts = new Map();

  quizzes.forEach(record => {
    questionCounts.set(
      record.id,
      record.questions.length
    );
  });

  console.log(
    "[EqualLearn] Student quizzes loaded:",
    {
      count: quizzes.length,
      quizzes: quizzes.map(item => ({
        id: item.id,
        title: item.title,
        questions: item.questions.length
      }))
    }
  );
}

/* ---------------------------------------------------------
   QUIZ CARD
--------------------------------------------------------- */

function card(record) {
  const status = availability(record);

  const count = questionCounts.get(record.id) || 0;

  const teacher = record.teacherName || "Your teacher";

  const action = status.state === "open"
    ? `
      <a
        class="quiz-open"
        href="quiz.html?id=${encodeURIComponent(record.id)}"
      >
        Open quiz →
      </a>
    `
    : `
      <span class="quiz-open is-disabled">
        ${escapeHTML(status.label)}
      </span>
    `;

  return `
    <article class="quiz-item">

      <div class="quiz-item-main">

        <div class="quiz-item-top">

          <span class="quiz-eyebrow">
            ${escapeHTML(teacher)}
          </span>

          <span class="quiz-status ${status.state}">
            ${
              status.state === "open"
                ? "Available"
                : status.state === "upcoming"
                  ? "Upcoming"
                  : "Closed"
            }
          </span>

        </div>

        <h3>
          ${escapeHTML(record.title || "Untitled quiz")}
        </h3>

        <p>
          ${escapeHTML(
            record.description ||
            "Open this quiz to see its instructions."
          )}
        </p>

        <div class="quiz-meta">

          <span>
            ${
              count
                ? `${count} question${count === 1 ? "" : "s"}`
                : "Questions available inside"
            }
          </span>

          <span>
            ${escapeHTML(status.label)}
          </span>

        </div>

      </div>

      ${action}

    </article>
  `;
}

/* ---------------------------------------------------------
   RENDER
--------------------------------------------------------- */

function render() {
  if (!quizList) return;

  const term = normalize(quizSearch?.value);

  const lessonFilter =
    new URLSearchParams(location.search).get("lesson") || "";

  const rows = quizzes.filter(record => {

    if (
      lessonFilter &&
      String(record.lessonId || "") !== lessonFilter
    ) {
      return false;
    }

    if (!term) {
      return true;
    }

    return normalize(
      `${record.title || ""} ${
        record.description || ""
      } ${
        record.teacherName || ""
      }`
    ).includes(term);
  });

  if (quizCount) {
    quizCount.textContent =
      `${rows.length} quiz${rows.length === 1 ? "" : "zes"}`;
  }

  if (!rows.length) {
    quizList.innerHTML = "";

    if (quizEmpty) {
      quizEmpty.style.display = "block";
    }

    return;
  }

  if (quizEmpty) {
    quizEmpty.style.display = "none";
  }

  quizList.innerHTML = rows.map(card).join("");
}

/* ---------------------------------------------------------
   ERROR DISPLAY
--------------------------------------------------------- */

function showError(error) {
  console.error(
    "[EqualLearn] Quiz list error:",
    error
  );

  if (!quizList) return;

  let message = error?.message || "Please try again.";

  if (
    error?.code === "permission-denied" ||
    message.includes("Missing or insufficient permissions")
  ) {
    message =
      "You do not currently have permission to access these quizzes. Please check your section assignment or contact your administrator.";
  }

  quizList.innerHTML = `
    <div class="quiz-message">
      <strong>Quizzes could not be loaded.</strong>
      <p>${escapeHTML(message)}</p>
    </div>
  `;

  if (quizEmpty) {
    quizEmpty.style.display = "none";
  }
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

    /* Load student profile */

    const snapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!snapshot.exists()) {
      throw new Error("Student profile not found.");
    }

    profile = snapshot.data();

    /* Validate role */

    if (normalize(profile.role) !== "student") {
      throw new Error(
        "An active student account is required."
      );
    }

    /* Validate account status */

    if (
      normalize(profile.status || "active") !== "active"
    ) {
      throw new Error(
        "This student account is not active."
      );
    }

    /* Load assigned quizzes */

    await loadQuizzes();

    /* Display quizzes */

    render();

  } catch (error) {

    showError(error);

  }

});
