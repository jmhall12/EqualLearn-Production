
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
   EQUALLEARN — STUDENT CLASSWORK HUB
   Collections:
   announcements
   modulesV2
   assignments
   quizzesV2
========================================================= */

const $ = id => document.getElementById(id);

const feed = $("classworkFeed");
const searchInput = $("classworkSearch");
const sortSelect = $("classworkSort");

let currentUser = null;
let studentProfile = null;
let studentSectionId = "";

let allActivities = [];
let activeCategory = "all";

const categoryInfo = {
  announcement: {
    label: "Announcement",
    icon: "📢",
    destination: null
  },
  module: {
    label: "Learning Module",
    icon: "📚",
    destination: "modules.html"
  },
  assignment: {
    label: "Assignment",
    icon: "📝",
    destination: "assignment.html"
  },
  quiz: {
    label: "Quiz",
    icon: "✍️",
    destination: "quiz.html"
  }
};

/* =========================================================
   AUTHENTICATION
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  currentUser = user;

  try {
    await loadStudentProfile();
    await loadAllClasswork();
  } catch (error) {
    console.error("[CLASSWORK HUB]", error);

    showState(
      "Unable to load classwork",
      error.message || "Please refresh the page and try again.",
      "⚠️"
    );
  }
});

/* =========================================================
   STUDENT PROFILE
========================================================= */

async function loadStudentProfile() {
  const profileSnap = await getDoc(
    doc(db, "users", currentUser.uid)
  );

  if (!profileSnap.exists()) {
    throw new Error("Student profile not found.");
  }

  studentProfile = profileSnap.data();

  if (
    String(studentProfile.role || "").toLowerCase() !== "student"
  ) {
    throw new Error("This page is for student accounts only.");
  }

  if (
    studentProfile.status &&
    String(studentProfile.status).toLowerCase() !== "active"
  ) {
    throw new Error("Your student account is not active.");
  }

  studentSectionId = String(studentProfile.sectionId || "");

  if (!studentSectionId) {
    throw new Error(
      "Your account has no assigned section. Please contact your teacher."
    );
  }
}

/* =========================================================
   LOAD ALL CATEGORIES
========================================================= */

async function loadAllClasswork() {
  showState(
    "Loading your classwork",
    "Retrieving announcements, modules, assignments, and quizzes.",
    "⏳"
  );

  const results = await Promise.allSettled([
    loadAnnouncements(),
    loadModules(),
    loadAssignments(),
    loadQuizzes()
  ]);

  const categoryNames = [
    "Announcements",
    "Modules",
    "Assignments",
    "Quizzes"
  ];

  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `[CLASSWORK] ${categoryNames[index]} could not load:`,
        result.reason
      );

      failures.push(categoryNames[index]);
    }
  });

  updateStatistics();
  renderActivities();

  if (failures.length) {
    console.warn(
      "[CLASSWORK] Some categories could not be loaded:",
      failures
    );
  }
}

/* =========================================================
   SAFE COLLECTION QUERY HELPERS
========================================================= */

async function fetchSectionDocuments(collectionName) {
  const collectionRef = collection(db, collectionName);

  const attempts = [
    query(
      collectionRef,
      where("sectionIds", "array-contains", studentSectionId)
    ),
    query(
      collectionRef,
      where("sectionId", "==", studentSectionId)
    )
  ];

  const snapshots = await Promise.allSettled(
    attempts.map(item => getDocs(item))
  );

  const documents = new Map();

  snapshots.forEach(result => {
    if (result.status !== "fulfilled") return;

    result.value.forEach(snapshot => {
      documents.set(snapshot.id, {
        id: snapshot.id,
        ...snapshot.data()
      });
    });
  });

  if (!documents.size && snapshots.every(
    result => result.status === "rejected"
  )) {
    throw snapshots[0].reason;
  }

  return [...documents.values()];
}

/* =========================================================
   ANNOUNCEMENTS
========================================================= */

async function loadAnnouncements() {
  const documents = await fetchSectionDocuments("announcements");

  documents.forEach(data => {
    const status = String(data.status || "").toLowerCase();

    if (
      status &&
      !["active", "published", "public"].includes(status)
    ) {
      return;
    }

    allActivities.push({
      id: data.id,
      category: "announcement",
      title: data.title || data.announcementTitle || "Announcement",
      description:
        data.content ||
        data.message ||
        data.description ||
        "Your teacher shared an announcement.",
      teacherName:
        data.teacherName ||
        data.createdByName ||
        "Your Teacher",
      date: toDate(
        data.createdAt ||
        data.publishedAt ||
        data.timestamp
      ),
      status: "Announcement",
      original: data
    });
  });
}

/* =========================================================
   LEARNING MODULES V2
========================================================= */

async function loadModules() {
  const documents = await fetchSectionDocuments("modulesV2");

  documents.forEach(data => {
    if (String(data.status || "").toLowerCase() !== "published") {
      return;
    }

    allActivities.push({
      id: data.id,
      category: "module",
      title: data.title || "Untitled Learning Module",
      description:
        data.description ||
        data.content ||
        "Open this learning module to view its resources.",
      teacherName: data.teacherName || "Your Teacher",
      date: toDate(data.publishedAt || data.createdAt || data.updatedAt),
      status: "Published",
      original: data
    });
  });
}

/* =========================================================
   ASSIGNMENTS
========================================================= */

async function loadAssignments() {
  const documents = await fetchSectionDocuments("assignments");

  documents.forEach(data => {
    if (String(data.status || "").toLowerCase() !== "active") {
      return;
    }

    const dueDate = toDate(data.dueDate);

    const isOverdue = dueDate && dueDate < new Date();

    allActivities.push({
      id: data.id,
      category: "assignment",
      title: data.title || "Untitled Assignment",
      description:
        data.instructions ||
        data.description ||
        "Open this assignment to view the instructions.",
      teacherName: data.teacherName || "Your Teacher",
      date: toDate(data.createdAt || data.publishedAt),
      dueDate,
      status: isOverdue ? "Past Due" : "Pending",
      original: data
    });
  });
}

/* =========================================================
   QUIZZES V2
========================================================= */

async function loadQuizzes() {
  const documents = await fetchSectionDocuments("quizzesV2");

  documents.forEach(data => {
    if (String(data.status || "").toLowerCase() !== "published") {
      return;
    }

    allActivities.push({
      id: data.id,
      category: "quiz",
      title: data.title || "Untitled Quiz",
      description:
        data.description ||
        data.instructions ||
        "Open this quiz to view its instructions.",
      teacherName: data.teacherName || "Your Teacher",
      date: toDate(data.publishedAt || data.createdAt || data.updatedAt),
      dueDate: toDate(data.dueDate),
      status: "Available",
      original: data
    });
  });
}

/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {
  const count = category => allActivities.filter(
    item => item.category === category
  ).length;

  $("announcementCount").textContent = count("announcement");
  $("moduleCount").textContent = count("module");
  $("assignmentCount").textContent = count("assignment");
  $("quizCount").textContent = count("quiz");

  $("allCategoryCount").textContent =
    `${allActivities.length} activities`;
}

/* =========================================================
   CATEGORY FILTERS
========================================================= */

document.querySelectorAll(".cw-category").forEach(button => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category || "all";

    document.querySelectorAll(".cw-category").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    const titles = {
      all: ["All Classwork", "Your latest classroom activities."],
      announcement: ["Announcements", "Updates shared by your teachers."],
      module: ["Learning Modules", "Lessons and learning resources."],
      assignment: ["Assignments", "Activities and tasks assigned to you."],
      quiz: ["Quizzes", "Available assessments and quizzes."]
    };

    $("feedTitle").textContent = titles[activeCategory][0];
    $("feedSubtitle").textContent = titles[activeCategory][1];

    renderActivities();
  });
});

/* =========================================================
   SEARCH AND SORT
========================================================= */

searchInput.addEventListener("input", renderActivities);
sortSelect.addEventListener("change", renderActivities);

/* =========================================================
   RENDER ACTIVITIES
========================================================= */

function renderActivities() {
  let items = [...allActivities];

  if (activeCategory !== "all") {
    items = items.filter(
      item => item.category === activeCategory
    );
  }

  const keyword = searchInput.value.trim().toLowerCase();

  if (keyword) {
    items = items.filter(item => {
      return [
        item.title,
        item.description,
        item.teacherName,
        item.category
      ].some(value =>
        String(value || "").toLowerCase().includes(keyword)
      );
    });
  }

  const sort = sortSelect.value;

  if (sort === "recent") {
    items.sort((a, b) => dateValue(b.date) - dateValue(a.date));
  } else if (sort === "oldest") {
    items.sort((a, b) => dateValue(a.date) - dateValue(b.date));
  } else if (sort === "title") {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  feed.replaceChildren();

  if (!items.length) {
    showState(
      keyword ? "No matching activities" : "Nothing here yet",
      keyword
        ? "Try a different search term or category."
        : "Your teacher's published classwork will appear here.",
      "📭"
    );
    return;
  }

  items.forEach(item => {
    feed.appendChild(createActivityCard(item));
  });
}

/* =========================================================
   CREATE ACTIVITY CARD
========================================================= */

function createActivityCard(item) {
  const info = categoryInfo[item.category];

  const card = document.createElement("article");
  card.className = "cw-card";

  const top = document.createElement("div");
  top.className = "cw-card-top";

  const category = document.createElement("span");
  category.className = "cw-card-category";
  category.textContent = `${info.icon} ${info.label}`;

  top.appendChild(category);

  const title = document.createElement("h3");
  title.textContent = item.title;

  const description = document.createElement("p");
  description.className = "cw-card-description";
  description.textContent = item.description;

  const meta = document.createElement("div");
  meta.className = "cw-card-meta";

  const teacher = document.createElement("span");
  teacher.textContent = `👤 ${item.teacherName}`;

  const date = document.createElement("span");
  date.textContent = item.date
    ? `🕒 ${formatDate(item.date)}`
    : "🕒 Date not specified";

  meta.append(teacher, date);

  if (item.dueDate) {
    const due = document.createElement("span");
    due.textContent = `📅 Due ${formatDate(item.dueDate)}`;
    meta.appendChild(due);
  }

  const footer = document.createElement("div");
  footer.className = "cw-card-footer";

  const status = document.createElement("span");
  status.className = "cw-status";

  if (item.status === "Pending") {
    status.classList.add("pending");
  }

  if (item.status === "Past Due") {
    status.classList.add("overdue");
  }

  status.textContent = item.status;

  const open = document.createElement("a");
  open.className = "cw-open";
  open.textContent = getActionLabel(item.category);
  open.href = getDestination(item);

  footer.append(status, open);

  card.append(top, title, description, meta, footer);

  return card;
}

/* =========================================================
   DESTINATIONS
========================================================= */

function getActionLabel(category) {
  const labels = {
    announcement: "View Details",
    module: "Open Module",
    assignment: "Open Assignment",
    quiz: "Open Quiz"
  };

  return labels[category] || "Open";
}

function getDestination(item) {
  const id = encodeURIComponent(item.id);

  switch (item.category) {
    case "announcement":
      return `announcement.html?id=${id}`;

    case "module":
      return `modules.html?id=${id}`;

    case "assignment":
      return `assignment.html?id=${id}`;

    case "quiz":
      return `quiz.html?id=${id}`;

    default:
      return "classwork.html";
  }
}

/* =========================================================
   EMPTY / ERROR STATE
========================================================= */

function showState(title, message, icon = "📭") {
  feed.replaceChildren();

  const state = document.createElement("div");
  state.className = "cw-state";

  const stateIcon = document.createElement("div");
  stateIcon.className = "cw-state-icon";
  stateIcon.textContent = icon;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const description = document.createElement("p");
  description.textContent = message;

  state.append(stateIcon, heading, description);
  feed.appendChild(state);
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
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    return new Date(value.seconds * 1000);
  }

  const result = new Date(value);

  return Number.isNaN(result.getTime()) ? null : result;
}

function dateValue(date) {
  return date instanceof Date ? date.getTime() : 0;
}

function formatDate(date) {
  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
