
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
   EQUALLEARN — STUDENT CLASSWORK
   Collections:
   announcements
   modulesV2
   teacherActivitiesV2
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
  announcement: { label: "Announcement", icon: "📢" },
  module: { label: "Learning Module", icon: "📚" },
  assignment: { label: "Assignment", icon: "📝" },
  quiz: { label: "Quiz", icon: "✍️" },
  discussion: { label: "Discussion", icon: "💬" }
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
  allActivities = [];

  try {
  await loadStudentProfile();

  // Run Firestore permission diagnostics first.
  await testClassworkPermissions();

  // Load the actual classwork after the test.
  await loadAllClasswork();

} catch (error) {
    console.error("[CLASSWORK HUB]", error);

    showState(
      "Unable to load classwork",
      getErrorMessage(error),
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

  const role = String(studentProfile.role || "").toLowerCase();
  const status = String(studentProfile.status || "").toLowerCase();

  if (role !== "student") {
    throw new Error("This page is for student accounts only.");
  }

  if (status !== "active") {
    throw new Error("Your student account is not active.");
  }

  studentSectionId = String(
    studentProfile.sectionId || ""
  ).trim();

  if (!studentSectionId) {
    throw new Error(
      "Your account has no assigned section. Please contact your teacher."
    );
  }

  console.log("[CLASSWORK] Student profile loaded:", {
    uid: currentUser.uid,
    role,
    status,
    sectionId: studentSectionId,
    projectId: db.app.options.projectId
  });
}

async function testClassworkPermissions() {
  const collections = ["modulesV2", "teacherActivitiesV2"];

  for (const name of collections) {
    try {
      const q = query(
        collection(db, name),
        where("status", "==", "published"),
        where("sectionIds", "array-contains", studentSectionId)
      );

      const result = await getDocs(q);

      console.log(`[PERMISSION TEST] ${name}: SUCCESS`, {
        count: result.size,
        ids: result.docs.map(item => item.id)
      });
    } catch (error) {
      console.error(`[PERMISSION TEST] ${name}: FAILED`, {
        code: error.code,
        message: error.message,
        projectId: db.app.options.projectId
      });
    }
  }
}

/* =========================================================
   LOAD ALL CLASSWORK
========================================================= */

async function loadAllClasswork() {
  allActivities = [];

  showState(
    "Loading your classwork",
    "Retrieving your teacher's posts and learning activities.",
    "⏳"
  );

  const tasks = [
    {
      name: "Announcements",
      run: loadAnnouncements
    },
    {
      name: "Modules",
      run: loadModules
    },
    {
      name: "Teacher Activities",
      run: loadTeacherActivities
    }
  ];

  const results = await Promise.allSettled(
    tasks.map(task => task.run())
  );

  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push(tasks[index].name);

      console.error(
        `[CLASSWORK] ${tasks[index].name} failed:`,
        {
          code: result.reason?.code,
          message: result.reason?.message,
          error: result.reason
        }
      );
    }
  });

  updateStatistics();
  renderActivities();

  console.log("[CLASSWORK] Loaded activities:", {
    total: allActivities.length,
    announcements: countCategory("announcement"),
    modules: countCategory("module"),
    assignments: countCategory("assignment"),
    quizzes: countCategory("quiz"),
    discussions: countCategory("discussion"),
    failedCategories: failures
  });

  if (failures.length) {
    console.warn(
      "[CLASSWORK] Failed categories:",
      failures
    );
  }
}

/* =========================================================
   V2 SECTION QUERY
   Must match Firestore student read rules.
========================================================= */




async function fetchPublishedSectionDocuments(collectionName) {
  if (!studentSectionId) {
    throw new Error("Student section ID is missing.");
  }

  const q = query(
    collection(db, collectionName),
    where("status", "==", "published"),
    where("sectionId", "==", studentSectionId)
  );

  const snapshot = await getDocs(q);

  const documents = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  console.log("[CLASSWORK] Section documents loaded:", {
    collection: collectionName,
    sectionId: studentSectionId,
    count: documents.length
  });

  return documents;
}




/* =========================================================
   ANNOUNCEMENTS
========================================================= */

async function loadAnnouncements() {
  const collectionRef = collection(db, "announcements");

  const q = query(
    collectionRef,
    where("sectionIds", "array-contains", studentSectionId)
  );

  const snapshot = await getDocs(q);

  snapshot.forEach(document => {
    const data = document.data();

    const status = String(data.status || "").toLowerCase();

    if (
      status &&
      !["active", "published", "public"].includes(status)
    ) {
      return;
    }

    allActivities.push({
      id: document.id,
      collectionName: "announcements",
      category: "announcement",

      title:
        data.title ||
        data.announcementTitle ||
        "Announcement",

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

  console.log("[CLASSWORK] Announcements:", snapshot.size);
}

/* =========================================================
   LEARNING MODULES
========================================================= */

async function loadModules() {
  const documents = await fetchPublishedSectionDocuments(
    "modulesV2"
  );

  documents.forEach(data => {
    allActivities.push({
      id: data.id,
      collectionName: "modulesV2",
      category: "module",

      title:
        data.title ||
        "Untitled Learning Module",

      description:
        data.description ||
        data.content ||
        "Open this learning module to view its resources.",

      teacherName:
        data.teacherName ||
        "Your Teacher",

      date: toDate(
        data.publishedAt ||
        data.createdAt ||
        data.updatedAt
      ),

      status: "Published",
      original: data
    });
  });
}

/* =========================================================
   TEACHER ACTIVITIES
   Assignments, Quizzes, Discussions
========================================================= */

async function loadTeacherActivities() {
  const documents = await fetchPublishedSectionDocuments(
    "teacherActivitiesV2"
  );

  documents.forEach(data => {
    const type = String(data.type || "").toLowerCase();

    if (!["assignment", "quiz", "discussion"].includes(type)) {
      return;
    }

    const common = {
      id: data.id,
      collectionName: "teacherActivitiesV2",
      title: data.title || `Untitled ${type}`,
      teacherName: data.teacherName || "Your Teacher",
      date: toDate(
        data.publishedAt ||
        data.createdAt ||
        data.updatedAt
      ),
      original: data
    };

    if (type === "assignment") {
      const dueDate = toDate(data.activityData?.dueDate);
      const isOverdue = dueDate && dueDate < new Date();

      allActivities.push({
        ...common,
        category: "assignment",
        description:
          data.description ||
          data.activityData?.instructions ||
          "Open this assignment to view its instructions.",
        dueDate,
        status: isOverdue ? "Past Due" : "Pending"
      });

      return;
    }

    if (type === "quiz") {
      allActivities.push({
        ...common,
        category: "quiz",
        description:
          data.description ||
          "Open this quiz to view its instructions.",
        dueDate: toDate(data.activityData?.dueDate),
        status: "Available"
      });

      return;
    }

    if (type === "discussion") {
      allActivities.push({
        ...common,
        category: "discussion",
        description:
          data.activityData?.prompt ||
          data.description ||
          "Your teacher started a discussion.",
        status: "Published"
      });
    }
  });
}

/* =========================================================
   STATISTICS
========================================================= */

function countCategory(category) {
  return allActivities.filter(
    item => item.category === category
  ).length;
}

function updateStatistics() {
  $("announcementCount").textContent =
    countCategory("announcement");

  $("moduleCount").textContent =
    countCategory("module");

  $("assignmentCount").textContent =
    countCategory("assignment");

  $("quizCount").textContent =
    countCategory("quiz");

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
      all: [
        "All Classwork",
        "Your latest classroom activities."
      ],
      announcement: [
        "Announcements",
        "Updates shared by your teachers."
      ],
      module: [
        "Learning Modules",
        "Lessons and learning resources."
      ],
      assignment: [
        "Assignments",
        "Activities and tasks assigned to you."
      ],
      quiz: [
        "Quizzes",
        "Available assessments and quizzes."
      ],
      discussion: [
        "Discussions",
        "Topics shared by your teachers."
      ]
    };

    const selected = titles[activeCategory];

    if (selected) {
      $("feedTitle").textContent = selected[0];
      $("feedSubtitle").textContent = selected[1];
    }

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
    items.sort(
      (a, b) => dateValue(b.date) - dateValue(a.date)
    );
  } else if (sort === "oldest") {
    items.sort(
      (a, b) => dateValue(a.date) - dateValue(b.date)
    );
  } else if (sort === "title") {
    items.sort(
      (a, b) => a.title.localeCompare(b.title)
    );
  }

  feed.replaceChildren();

  if (!items.length) {
    showState(
      keyword
        ? "No matching activities"
        : "Nothing here yet",
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
  const info = categoryInfo[item.category] || {
    label: "Class Activity",
    icon: "📘"
  };

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

  card.append(
    top,
    title,
    description,
    meta,
    footer
  );

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
    quiz: "Open Quiz",
    discussion: "View Discussion"
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

    case "discussion":
      return `classwork.html?id=${id}`;

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

  state.append(
    stateIcon,
    heading,
    description
  );

  feed.appendChild(state);
}

/* =========================================================
   ERROR HELPERS
========================================================= */

function getErrorMessage(error) {
  if (
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return "Firestore denied access to some classwork collections. Check the deployed student read rules.";
  }

  if (error?.code === "failed-precondition") {
    return "A Firestore query index may be required. Check the error details in the browser console.";
  }

  return error?.message ||
    "Please refresh the page and try again.";
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




































