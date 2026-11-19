
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — STUDENT ASSIGNMENT
   Collection: teacherActivitiesV2
   Profile: users
   Activity type: assignment
========================================================= */

const $ = id => document.getElementById(id);

const statusBox = $("assignmentStatus");
const contentBox = $("assignmentContent");

let currentUser = null;
let currentAssignmentId = null;

/* =========================================================
   AUTHENTICATION
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  currentUser = user;
  await loadAssignment();
});

/* =========================================================
   LOAD ASSIGNMENT
========================================================= */

async function loadAssignment() {
  try {
    showStatus("Loading assignment...", "loading");

    const params = new URLSearchParams(location.search);

    currentAssignmentId =
      params.get("id") ||
      params.get("assignmentId") ||
      params.get("assignmentID");

    if (!currentAssignmentId) {
      throw new Error(
        "Missing assignment ID. Please return to Classwork and open the assignment again."
      );
    }

    /* -----------------------------------------
       1. LOAD STUDENT PROFILE
    ----------------------------------------- */

    console.log(
      "[ASSIGNMENT] Loading student profile:",
      currentUser.uid
    );

    const profileSnap = await getDoc(
      doc(db, "users", currentUser.uid)
    );

    if (!profileSnap.exists()) {
      throw new Error("Student profile not found.");
    }

    const student = profileSnap.data();

    console.log("[ASSIGNMENT] Student profile:", {
      role: student.role,
      status: student.status,
      sectionId: student.sectionId
    });

    if (
      String(student.role || "").toLowerCase() !== "student"
    ) {
      throw new Error("Student account required.");
    }

    if (
      student.status &&
      String(student.status).toLowerCase() !== "active"
    ) {
      throw new Error("Your student account is not active.");
    }

    if (!student.sectionId) {
      throw new Error(
        "Your student account has no assigned section. Please contact your teacher."
      );
    }

    /* -----------------------------------------
       2. LOAD FROM TEACHER ACTIVITIES V2
    ----------------------------------------- */

    console.log(
      "[ASSIGNMENT] Loading teacher activity:",
      currentAssignmentId
    );

    console.log("[ASSIGNMENT] Firebase project:", {
      projectId: db.app.options.projectId,
      collection: "teacherActivitiesV2",
      authUid: currentUser.uid,
      assignmentId: currentAssignmentId
    });

    const activityRef = doc(
      db,
      "teacherActivitiesV2",
      currentAssignmentId
    );

    const activitySnap = await getDoc(activityRef);

    console.log(
      "[ASSIGNMENT] Activity read successful:",
      activitySnap.exists()
    );

    if (!activitySnap.exists()) {
      throw new Error(
        "This assignment does not exist or may have been deleted."
      );
    }

    const activity = activitySnap.data();

    console.log("[ASSIGNMENT] Activity data:", activity);

    /* -----------------------------------------
       3. VALIDATE ACTIVITY TYPE AND STATUS
    ----------------------------------------- */

    if (
      String(activity.type || "").toLowerCase() !== "assignment"
    ) {
      throw new Error(
        "This activity is not an assignment."
      );
    }

    if (
      String(activity.status || "").toLowerCase() !== "published"
    ) {
      throw new Error(
        "This assignment is not currently published."
      );
    }

    /* -----------------------------------------
       4. VALIDATE SECTION ACCESS
    ----------------------------------------- */

    const studentSectionId = String(student.sectionId);

    const sectionIds = Array.isArray(activity.sectionIds)
      ? activity.sectionIds.map(String)
      : activity.sectionId
        ? [String(activity.sectionId)]
        : [];

    const assignedToStudent =
      sectionIds.includes(studentSectionId);

    if (!assignedToStudent) {
      throw new Error(
        "This assignment is not assigned to your section."
      );
    }

    /* -----------------------------------------
       5. READ NESTED ACTIVITY DATA
    ----------------------------------------- */

    const activityData =
      activity.activityData &&
      typeof activity.activityData === "object"
        ? activity.activityData
        : {};

    const dueDate = toDate(
      activityData.dueDate ||
      activity.dueDate
    );

    const now = new Date();

    /* -----------------------------------------
       6. PREPARE ASSIGNMENT DATA
    ----------------------------------------- */

    const assignment = {
      title:
        activity.title ||
        "Untitled Assignment",

      instructions:
        activityData.instructions ||
        activityData.description ||
        activity.description ||
        "No instructions provided by your teacher.",

      points:
        activityData.totalPoints ??
        activity.points ??
        0,

      submissionType:
        activityData.submissionType ||
        "Not specified",

      resources: Array.isArray(activity.resources)
        ? activity.resources
        : [],

      activityData
    };

    /* -----------------------------------------
       7. CHECK DUE DATE
    ----------------------------------------- */

    if (dueDate && dueDate < now) {
      console.info(
        "[ASSIGNMENT] Assignment is past due."
      );
    }

    /* -----------------------------------------
       8. RENDER
    ----------------------------------------- */

    renderAssignment(assignment, dueDate);

    console.info(
      "[ASSIGNMENT] Assignment loaded successfully:",
      currentAssignmentId
    );

  } catch (error) {
    console.error(
      "[STUDENT ASSIGNMENT]",
      error
    );

    showStatus(
      error.message || "Unable to load assignment.",
      "error"
    );
  }
}

/* =========================================================
   RENDER ASSIGNMENT
========================================================= */

function renderAssignment(data, dueDate) {
  const title = $("assignmentTitle");
  const instructions = $("assignmentInstructions");
  const points = $("assignmentPoints");
  const due = $("assignmentDue");
  const badge = $("assignmentStatusBadge");

  if (
    !title ||
    !instructions ||
    !points ||
    !due ||
    !badge
  ) {
    throw new Error(
      "Assignment HTML is missing one or more required elements."
    );
  }

  title.textContent = data.title;

  instructions.textContent = data.instructions;

  points.textContent =
    `${Number(data.points)} Points`;

  due.textContent = dueDate
    ? `Due: ${formatDate(dueDate)}`
    : "No due date";

  const isOverdue =
    dueDate && dueDate < new Date();

  badge.textContent = isOverdue
    ? "Past Due"
    : "Available";

  badge.style.background = isOverdue
    ? "#47242e"
    : "rgba(117,92,240,.18)";

  badge.style.color = isOverdue
    ? "#ff9caa"
    : "#b9aaff";

  /* Optional HTML element for submission type. */
  const submissionType = $("assignmentSubmissionType");

  if (submissionType) {
    submissionType.textContent =
      `Submission: ${formatSubmissionType(data.submissionType)}`;
  }

  renderResources(data.resources, data.activityData);

  if (statusBox) {
    statusBox.hidden = true;
  }

  if (contentBox) {
    contentBox.hidden = false;
  }
}

/* =========================================================
   RENDER RESOURCES
========================================================= */

function renderResources(resources, activityData = {}) {
  const section = $("resourcesSection");
  const container = $("assignmentResources");

  if (!section || !container) return;

  container.replaceChildren();

  const items = [];

  /* Main resources array from teacherActivitiesV2. */
  if (Array.isArray(resources)) {
    resources.forEach(item => {
      if (typeof item === "string") {
        items.push({
          label: "Learning Resource",
          url: item
        });

        return;
      }

      if (item && typeof item === "object") {
        items.push({
          label:
            item.label ||
            item.title ||
            item.name ||
            item.fileName ||
            "Learning Resource",

          url:
            item.url ||
            item.href ||
            item.fileURL ||
            item.fileUrl ||
            item.downloadURL ||
            item.downloadUrl ||
            item.link
        });
      }
    });
  }

  /* Support older assignment resource fields. */
  const legacyResources = [
    {
      label: activityData.fileName || "Assignment Attachment",
      url: activityData.fileURL || activityData.fileUrl
    },
    {
      label: "Open Learning Resource",
      url: activityData.resourceUrl || activityData.resourceURL
    },
    {
      label: "Watch Assignment Video",
      url: activityData.videoUrl || activityData.videoURL
    }
  ];

  legacyResources.forEach(item => {
    if (item.url) {
      items.push(item);
    }
  });

  /* Support nested resourceLinks. */
  if (Array.isArray(activityData.resourceLinks)) {
    activityData.resourceLinks.forEach(item => {
      if (!item) return;

      if (typeof item === "string") {
        items.push({
          label: "Learning Resource",
          url: item
        });

        return;
      }

      if (typeof item === "object") {
        items.push({
          label:
            item.label ||
            item.title ||
            item.name ||
            "Learning Resource",

          url:
            item.url ||
            item.href ||
            item.link
        });
      }
    });
  }

  /* Validate and remove duplicates. */
  const unique = new Map();

  items.forEach(item => {
    const safeUrl = validateUrl(item.url);

    if (!safeUrl) return;

    unique.set(safeUrl, {
      label: item.label || "Learning Resource",
      url: safeUrl
    });
  });

  if (!unique.size) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  unique.forEach(item => {
    const link = document.createElement("a");

    link.className = "assignment-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    link.textContent = `🔗 ${item.label}`;

    container.appendChild(link);
  });
}

/* =========================================================
   SUBMISSION TYPE LABEL
========================================================= */

function formatSubmissionType(value) {
  const type = String(value || "").toLowerCase();

  const labels = {
    file: "File Upload",
    text: "Text Submission",
    link: "Link Submission",
    both: "File or Text Submission",
    none: "No Submission Required"
  };

  return labels[type] || value || "Not specified";
}

/* =========================================================
   STATUS MESSAGES
========================================================= */

function showStatus(message, type = "") {
  if (statusBox) {
    statusBox.hidden = false;
    statusBox.className = `assignment-status ${type}`;
    statusBox.textContent = message;
  }

  if (contentBox) {
    contentBox.hidden = true;
  }
}

/* =========================================================
   DATE HELPERS
========================================================= */

function toDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    return new Date(value.seconds * 1000);
  }

  /*
    Firestore currently stores dueDate as:
    "2026-11-17T09:38"

    This format is interpreted as local time by the browser.
  */
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function formatDate(date) {
  if (!date) return "Not specified";

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

/* =========================================================
   URL VALIDATION
========================================================= */

function validateUrl(value) {
  try {
    const url = new URL(
      String(value || "").trim()
    );

    if (
      !["http:", "https:"].includes(url.protocol)
    ) {
      return "";
    }

    return url.href;

  } catch {
    return "";
  }
}
