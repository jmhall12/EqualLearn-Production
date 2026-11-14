
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
   Existing collection: assignments
   Existing collection: users
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

    // Support different URL parameter names.
    currentAssignmentId =
      params.get("id") ||
      params.get("assignmentId") ||
      params.get("assignmentID");

    if (!currentAssignmentId) {
      throw new Error(
        "Missing assignment ID. Please return to Classwork and open the assignment again."
      );
    }

    // Load student profile.
    const profileSnap = await getDoc(
      doc(db, "users", currentUser.uid)
    );

    if (!profileSnap.exists()) {
      throw new Error("Student profile not found.");
    }

    const student = profileSnap.data();

    if (String(student.role || "").toLowerCase() !== "student") {
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

    // Load assignment document.
    const assignmentRef = doc(
      db,
      "assignments",
      currentAssignmentId
    );

    const assignmentSnap = await getDoc(assignmentRef);

    if (!assignmentSnap.exists()) {
      throw new Error(
        "This assignment does not exist or may have been deleted."
      );
    }

    const assignment = assignmentSnap.data();

    // Preserve the existing active-status requirement.
    if (
      String(assignment.status || "").toLowerCase() !== "active"
    ) {
      throw new Error(
        "This assignment is not currently published."
      );
    }

    // Check assignment section access.
    const studentSectionId = String(student.sectionId);

    const sectionIds = Array.isArray(assignment.sectionIds)
      ? assignment.sectionIds.map(String)
      : assignment.sectionId
        ? [String(assignment.sectionId)]
        : [];

    const assignedToStudent = sectionIds.length
      ? sectionIds.includes(studentSectionId)
      : assignment.audience === "all";

    if (!assignedToStudent) {
      throw new Error(
        "This assignment is not assigned to your section."
      );
    }

    // Availability and due date.
    const availableAt = toDate(assignment.availableAt);
    const dueDate = toDate(assignment.dueDate);
    const now = new Date();

    if (availableAt && availableAt > now) {
      throw new Error(
        `This assignment will be available on ${formatDate(availableAt)}.`
      );
    }

    renderAssignment(assignment, dueDate);

    console.info(
      "[STUDENT ASSIGNMENT] Assignment loaded:",
      currentAssignmentId
    );

  } catch (error) {
    console.error("[STUDENT ASSIGNMENT]", error);

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

  if (!title || !instructions || !points || !due || !badge) {
    throw new Error(
      "Assignment HTML is missing one or more required elements."
    );
  }

  title.textContent =
    data.title || "Untitled Assignment";

  instructions.textContent =
    data.instructions ||
    data.description ||
    "No instructions provided by your teacher.";

  points.textContent =
    `${Number(data.points ?? 0)} Points`;

  due.textContent = dueDate
    ? `Due: ${formatDate(dueDate)}`
    : "No due date";

  const isOverdue = dueDate && dueDate < new Date();

  badge.textContent = isOverdue
    ? "Past Due"
    : "Available";

  badge.style.background = isOverdue
    ? "#47242e"
    : "rgba(117,92,240,.18)";

  badge.style.color = isOverdue
    ? "#ff9caa"
    : "#b9aaff";

  renderResources(data);

  if (statusBox) {
    statusBox.hidden = true;
  }

  if (contentBox) {
    contentBox.hidden = false;
  }
}

/* =========================================================
   RENDER ATTACHMENTS AND RESOURCES
========================================================= */

function renderResources(data) {
  const section = $("resourcesSection");
  const container = $("assignmentResources");

  if (!section || !container) return;

  container.replaceChildren();

  const resources = [];

  if (data.fileURL || data.fileUrl) {
    resources.push({
      label: data.fileName || "Assignment Attachment",
      url: data.fileURL || data.fileUrl
    });
  }

  if (data.resourceUrl || data.resourceURL) {
    resources.push({
      label: "Open Learning Resource",
      url: data.resourceUrl || data.resourceURL
    });
  }

  if (Array.isArray(data.resourceLinks)) {
    data.resourceLinks.forEach(item => {
      if (!item || typeof item !== "object") return;

      const url = item.url || item.href;

      if (!url) return;

      resources.push({
        label:
          item.label ||
          item.title ||
          item.name ||
          "Learning Resource",
        url
      });
    });
  }

  if (data.videoUrl || data.videoURL) {
    resources.push({
      label: "Watch Assignment Video",
      url: data.videoUrl || data.videoURL
    });
  }

  const unique = new Map();

  resources.forEach(item => {
    const safeUrl = validateUrl(item.url);

    if (safeUrl) {
      unique.set(safeUrl, {
        label: item.label,
        url: safeUrl
      });
    }
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
    const url = new URL(String(value || "").trim());

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}
