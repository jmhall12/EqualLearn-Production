
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
  announcement: { label: "Announcement", icon: "megaphone" },
  module: { label: "Module / Lesson", icon: "book-open" },
  assignment: { label: "Assignment", icon: "clipboard-list" },
  quiz: { label: "Quiz", icon: "file-check" },
  discussion: { label: "Discussion", icon: "message-circle" }
};

/* =========================================================
   INLINE SVG ICONS — no emoji or external icon dependency
========================================================= */
const iconPaths = {
  megaphone: '<path d="m3 11 18-5v12L3 13v-2Z"/><path d="M11.6 14.2 14 21h-4l-2-7.6"/><path d="M3 11v2a2 2 0 0 0 2 2h1"/>',
  "book-open": '<path d="M12 7v14"/><path d="M3 18V5a2 2 0 0 1 2-2h3a4 4 0 0 1 4 4 4 4 0 0 1 4-4h3a2 2 0 0 1 2 2v13"/><path d="M3 18a3 3 0 0 1 3-3h2a4 4 0 0 1 4 4 4 4 0 0 1 4-4h2a3 3 0 0 1 3 3"/>',
  "clipboard-list": '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4.5h6a1 1 0 0 0 1-1v-1H8v1a1 1 0 0 0 1 1Z"/><path d="M9 11h6M9 15h6M9 19h3"/>',
  "file-check": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 14l2.5 2.5L16 11"/>',
  "message-circle": '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14ZM5 2l.8 2.2L8 5l-2.2.8L5 8l-.8-2.2L2 5l2.2-.8L5 2Z"/>',
  "user-round": '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  "calendar-clock": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M16.5 15v1.7l1 .6"/>',
  inbox: '<path d="M4 4h16l2 11v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4L4 4Z"/><path d="M2 15h5l2 3h6l2-3h5"/>',
  loader: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>',
  warning: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>'
};

function createIcon(name, className = "cw-inline-icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add(...className.split(" ").filter(Boolean));
  svg.innerHTML = iconPaths[name] || iconPaths["book-open"];
  return svg;
}

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

  // Diagnostics are opt-in because they repeat the same Firestore reads.
  // Add ?debugPermissions=1 to the URL only when troubleshooting access.
  if (new URLSearchParams(location.search).get("debugPermissions") === "1") {
    await testClassworkPermissions();
  }

  await loadAllClasswork();

} catch (error) {
    console.error("[CLASSWORK HUB]", error);

    showState(
      "Unable to load classwork",
      getErrorMessage(error),
      "warning"
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
    demoReadOnly: studentProfile.demoReadOnly === true || String(studentProfile.demoReadOnly || "").toLowerCase() === "true",
    sectionId: studentSectionId,
    projectId: db.app.options.projectId
  });
}

async function testClassworkPermissions() {
  const tests = [
    {
      name: "modulesV2",
      run: () => fetchPublishedSectionDocuments("modulesV2")
    },
    {
      name: "legacy lessons (active + approved for this section)",
      run: () => fetchApprovedActiveSectionContent("lessons")
    },
    {
      name: "teacherActivitiesV2",
      run: () => fetchPublishedSectionDocuments("teacherActivitiesV2")
    }
  ];

  for (const test of tests) {
    try {
      const documents = await test.run();

      console.log(`[PERMISSION TEST] ${test.name}: SUCCESS`, {
        count: documents.length,
        ids: documents.map(item => item.id)
      });
    } catch (error) {
      console.error(`[PERMISSION TEST] ${test.name}: FAILED`, {
        code: error.code,
        message: error.message,
        error: error,
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
    "loader"
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
    },
    {
  name: "Lessons",
  run: loadLessons
},

  ];

  const results = await Promise.allSettled(
    tasks.map(task => task.run())
  );

  const failures = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push(tasks[index].name);

      console.error(
        `[CLASSWORK] ${tasks[index].name} failed: ${result.reason?.code || "unknown"} - ${result.reason?.message || String(result.reason)}`,
        {
          code: result.reason?.code || "unknown",
          message: result.reason?.message || String(result.reason),
          uid: currentUser?.uid,
          sectionId: studentSectionId,
          projectId: db.app.options.projectId,
          queryFailures: result.reason?.queryFailures || [],
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

async function fetchSectionDocumentsWithLegacyFallback(collectionName, statusFilters, label) {
  if (!studentSectionId) {
    throw new Error("Student section ID is missing.");
  }

  const base = collection(db, collectionName);
  const filters = statusFilters.map(([field, value]) => where(field, "==", value));
  const variants = [
    { name: "sectionIds", sectionFilter: where("sectionIds", "array-contains", studentSectionId) },
    { name: "sectionId", sectionFilter: where("sectionId", "==", studentSectionId) }
  ];

  const settled = await Promise.allSettled(variants.map(variant =>
    getDocs(query(base, ...filters, variant.sectionFilter))
  ));

  const merged = new Map();
  const failures = [];

  settled.forEach((result, index) => {
    const variant = variants[index];
    if (result.status === "fulfilled") {
      result.value.docs.forEach(item => {
        merged.set(item.id, { id: item.id, ...item.data() });
      });
    } else {
      const error = result.reason || {};
      failures.push({
        query: variant.name,
        code: error.code || "unknown",
        message: error.message || String(error)
      });
    }
  });

  // One schema variant succeeding is enough; keep the other failure visible
  // because it may indicate that the deployed Firestore Rules are out of date.
  if (merged.size === 0 && failures.length === variants.length) {
    const details = failures.map(item => `${item.query}: ${item.code} - ${item.message}`).join(" | ");
    const error = new Error(`${label} could not be read. ${details}`);
    error.code = failures[0]?.code || "permission-denied";
    error.queryFailures = failures;
    throw error;
  }

  if (failures.length) {
    console.warn(`[CLASSWORK] Some ${label} compatibility queries failed:`, failures);
  }

  const documents = [...merged.values()];
  console.info(`[CLASSWORK] ${label} loaded:`, {
    collection: collectionName,
    sectionId: studentSectionId,
    count: documents.length,
    ids: documents.map(item => item.id),
    queryFailures: failures
  });
  return documents;
}

async function fetchPublishedSectionDocuments(collectionName) {
  return fetchSectionDocumentsWithLegacyFallback(
    collectionName,
    [["status", "published"]],
    `Published ${collectionName}`
  );
}

async function fetchApprovedActiveSectionContent(collectionName) {
  return fetchSectionDocumentsWithLegacyFallback(
    collectionName,
    [["status", "active"], ["reviewStatus", "approved"]],
    `Approved active ${collectionName}`
  );
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
  // Read both the current V2 workflow and legacy Admin modules. Both queries
  // are restricted to approved/published content assigned to this section.
  const results = await Promise.allSettled([
    fetchPublishedSectionDocuments("modulesV2"),
    fetchApprovedActiveSectionContent("modules")
  ]);

  const combined = new Map();
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      result.value.forEach(item => combined.set(`${index ? "modules" : "modulesV2"}/${item.id}`, item));
    } else {
      errors.push(result.reason);
      console.error(`[CLASSWORK] ${index ? "Legacy modules" : "Modules V2"} read failed:`, {
        code: result.reason?.code || "unknown",
        message: result.reason?.message || String(result.reason),
        uid: currentUser?.uid,
        sectionId: studentSectionId,
        projectId: db.app.options.projectId
      });
    }
  });

  if (!combined.size && errors.length === results.length) {
    const error = new Error(errors.map(item => item.message || String(item)).join("; "));
    error.code = errors[0]?.code || "permission-denied";
    throw error;
  }

  combined.forEach((data, key) => {
    allActivities.push({
      id: data.id,
      collectionName: key.startsWith("modules/") ? "modules" : "modulesV2",
      category: "module",
      title: data.title || data.moduleName || "Untitled Learning Module",
      description: data.description || data.content || data.moduleDescription || "Open this learning module to view its resources.",
      teacherName: data.teacherName || data.assignedTeacherName || data.createdByName || "Your Teacher",
      date: toDate(data.publishedAt || data.createdAt || data.updatedAt),
      status: "Published",
      original: data
    });
  });
}

async function loadLessons() {
  const documents = await fetchApprovedActiveSectionContent("lessons");

  documents.forEach(data => {
    allActivities.push({
      id: data.id,
      collectionName: "lessons",
      category: "module",

      title: data.title || "Untitled Lesson",

      description:
        data.description ||
        data.content ||
        "Open this lesson to view its learning materials.",

      teacherName:
        data.assignedTeacherName ||
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

  $("allCategoryCount").textContent = allActivities.length;
}

/* =========================================================
   CATEGORY FILTERS
========================================================= */

document.querySelectorAll(".cw-category").forEach(button => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category || "all";

    document.querySelectorAll(".cw-category").forEach(item => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
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
      "inbox"
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
    icon: "book-open"
  };

  const card = document.createElement("article");
  card.className = "cw-card";

  const top = document.createElement("div");
  top.className = "cw-card-top";

  const category = document.createElement("span");
  category.className = "cw-card-category";
  category.append(
    createIcon(info.icon),
    document.createTextNode(info.label)
  );

  top.appendChild(category);

  const title = document.createElement("h3");
  title.textContent = item.title;

  const description = document.createElement("p");
  description.className = "cw-card-description";
  description.textContent = item.description;

  const meta = document.createElement("div");
  meta.className = "cw-card-meta";

  const teacher = document.createElement("span");
  teacher.append(
    createIcon("user-round"),
    document.createTextNode(item.teacherName || "Your Teacher")
  );

  const date = document.createElement("span");
  date.append(
    createIcon("calendar"),
    document.createTextNode(item.date ? formatDate(item.date) : "Date not specified")
  );

  meta.append(teacher, date);

  if (item.dueDate) {
    const due = document.createElement("span");
    due.append(
      createIcon("calendar-clock"),
      document.createTextNode(`Due ${formatDate(item.dueDate)}`)
    );
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

  if (item.collectionName === "lessons") {
    return `modules.html?id=${id}&type=lesson`;
  }

  if (
    item.collectionName === "modules" ||
    item.collectionName === "modulesV2"
  ) {
    return `modules.html?id=${id}&type=module`;
  }

  switch (item.category) {
    case "announcement":
      return `announcement.html?id=${id}`;
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

function showState(title, message, icon = "inbox") {
  feed.replaceChildren();

  const state = document.createElement("div");
  state.className = "cw-state";

  const stateIcon = document.createElement("div");
  stateIcon.className = "cw-state-icon";
  stateIcon.appendChild(createIcon(icon, "cw-state-svg"));

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




































