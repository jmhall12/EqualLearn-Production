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

   Resources:
   - Reads record.resources (teacher activity attachments)
   - Also supports activityData.resources as fallback
   - Supports Base64 files and external/hosted URLs

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

  if (value instanceof Date) return value;

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
   RESOURCE HELPERS
--------------------------------------------------------- */

function getResources(record) {
  const activityData = record.activityData || {};

  const source = Array.isArray(record.resources)
    ? record.resources
    : Array.isArray(activityData.resources)
      ? activityData.resources
      : [];

  return source
    .filter(resource => resource && typeof resource === "object")
    .map((resource, index) => ({
      ...resource,
      label:
        resource.label ||
        resource.fileName ||
        resource.name ||
        resource.title ||
        `Attachment ${index + 1}`,
      type: normalize(resource.type || resource.kind || "file"),
      url:
        resource.url ||
        resource.href ||
        resource.fileURL ||
        resource.fileUrl ||
        "",
      base64: typeof resource.base64 === "string"
        ? resource.base64
        : "",
      mimeType: resource.mimeType || "application/octet-stream",
      fileName:
        resource.fileName ||
        resource.name ||
        resource.label ||
        `equallearn-attachment-${index + 1}`
    }))
    .filter(resource => resource.base64 || resource.url);
}

function safeExternalURL(value) {
  if (!value) return "";

  try {
    const parsed = new URL(String(value));

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}

function resourceHref(resource) {
  if (resource.base64) {
    return `data:${resource.mimeType || "application/octet-stream"};base64,${resource.base64}`;
  }

  return safeExternalURL(resource.url);
}

function isLinkResource(resource) {
  return resource.type === "link" && !resource.base64;
}

function resourceMarkup(record) {
  const resources = getResources(record);

  if (!resources.length) return "";

  const items = resources.map((resource, index) => {
    const href = resourceHref(resource);

    if (!href) return "";

    const label = escapeHTML(resource.label);
    const fileName = escapeHTML(resource.fileName || resource.label);

    if (isLinkResource(resource)) {
      return `
        <a
          class="quiz-resource-link"
          href="${escapeHTML(href)}"
          target="_blank"
          rel="noopener noreferrer"
          title="${label}"
        >
          <span class="quiz-resource-icon" aria-hidden="true">↗</span>
          <span class="quiz-resource-text">
            <strong>${label}</strong>
            <small>Open link</small>
          </span>
        </a>
      `;
    }

    const mime = normalize(resource.mimeType);
    const isPDF =
      mime.includes("pdf") ||
      /\.pdf$/i.test(resource.fileName || resource.label || "");

    const actionLabel = isPDF ? "View / Download PDF" : "View / Download file";

    return `
      <a
        class="quiz-resource-link"
        href="${escapeHTML(href)}"
        ${resource.base64 ? `download="${fileName}"` : `target="_blank" rel="noopener noreferrer"`}
        title="${label}"
      >
        <span class="quiz-resource-icon" aria-hidden="true">📎</span>
        <span class="quiz-resource-text">
          <strong>${label}</strong>
          <small>${actionLabel}</small>
        </span>
      </a>
    `;
  }).filter(Boolean).join("");

  if (!items) return "";

  return `
    <div class="quiz-resources">
      <div class="quiz-resources-heading">
        <span aria-hidden="true">📁</span>
        Teacher's attached resources
        <span class="quiz-resource-count">${resources.length}</span>
      </div>
      <div class="quiz-resources-list">
        ${items}
      </div>
    </div>
  `;
}

function ensureResourceStyles() {
  if (document.getElementById("equallearn-quiz-resource-styles")) return;

  const style = document.createElement("style");
  style.id = "equallearn-quiz-resource-styles";
  style.textContent = `
    .quiz-resources {
      margin-top: 16px;
      padding: 13px;
      border: 1px solid rgba(99, 102, 241, .18);
      border-radius: 13px;
      background: rgba(99, 102, 241, .045);
    }

    .quiz-resources-heading {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 10px;
      color: var(--text-primary, #27324a);
      font-size: .83rem;
      font-weight: 700;
    }

    .quiz-resource-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 20px;
      background: rgba(99, 102, 241, .12);
      color: #5558c9;
      font-size: .72rem;
    }

    .quiz-resources-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
      gap: 8px;
    }

    .quiz-resource-link {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid rgba(100, 116, 139, .18);
      border-radius: 10px;
      background: var(--surface, #fff);
      color: inherit;
      text-decoration: none;
      transition: border-color .18s ease, transform .18s ease, background .18s ease;
    }

    .quiz-resource-link:hover {
      border-color: #7779e8;
      background: rgba(99, 102, 241, .055);
      transform: translateY(-1px);
    }

    .quiz-resource-icon {
      display: grid;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 9px;
      background: rgba(99, 102, 241, .11);
      font-size: 1rem;
    }

    .quiz-resource-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      gap: 3px;
    }

    .quiz-resource-text strong {
      overflow: hidden;
      color: var(--text-primary, #27324a);
      font-size: .8rem;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .quiz-resource-text small {
      color: var(--text-muted, #718096);
      font-size: .72rem;
    }

    @media (max-width: 520px) {
      .quiz-resources-list {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
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
   * Uses sectionIds array to match section-based access.
   *
   * Firestore document example:
   *
   * {
   *   type: "quiz",
   *   status: "published",
   *   sectionIds: ["SECTION_ID"],
   *   title: "Sample Quiz",
   *   resources: [...]
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
          : [],

        resources: getResources(record)
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
        questions: item.questions.length,
        resources: item.resources.length
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
                : "Learning resource"
            }
          </span>

          <span>
            ${escapeHTML(status.label)}
          </span>

        </div>

        ${resourceMarkup(record)}

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
      } ${
        getResources(record).map(resource => resource.label).join(" ")
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

ensureResourceStyles();

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
