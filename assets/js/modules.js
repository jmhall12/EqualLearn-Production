
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ======================================================
// ELEMENTS AND STATE
// ======================================================

const container = document.getElementById("classContent");

let currentUser = null;
let currentTab = "all";
let classItems = [];
let studentProfile = null;
let studentSectionId = null;
let isLoading = false;

const tabButtons = document.querySelectorAll("[data-tab]");


// ======================================================
// FIRESTORE DIAGNOSTICS
// ======================================================

async function debugFirestoreRead(label, operation) {
  try {
    console.log(`[CLASSWORK] Loading ${label}...`);

    const result = await operation();

    console.log(
      `[CLASSWORK] ${label} loaded successfully.`,
      result?.size !== undefined
        ? `Documents: ${result.size}`
        : ""
    );

    return result;

  } catch (error) {
    console.error(`[CLASSWORK] ${label} FAILED:`, {
      code: error.code,
      message: error.message
    });

    throw error;
  }
}


// ======================================================
// AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    currentUser = null;
    window.location.replace("../login.html");
    return;
  }

  currentUser = user;

  console.log("[CLASSWORK] Authenticated user:", user.uid);

  await loadClasswork();

});


// ======================================================
// TAB NAVIGATION
// ======================================================

tabButtons.forEach(button => {

  button.addEventListener("click", () => {

    const selectedTab = button.dataset.tab;

    if (!selectedTab) return;

    tabButtons.forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    currentTab = selectedTab;

    renderClasswork();

  });

});


// ======================================================
// LOAD STUDENT CLASSWORK
// ======================================================

async function loadClasswork() {

  if (!container || !currentUser || isLoading) return;

  isLoading = true;

  container.innerHTML = `
    <div class="empty">
      <strong>Loading your classwork...</strong>
      <p>Syncing your classroom activities.</p>
    </div>
  `;

  classItems = [];

  try {

    // -----------------------------------------------
    // 1. LOAD STUDENT PROFILE
    // -----------------------------------------------

    const profileSnap = await debugFirestoreRead(
      "student profile",
      () => getDoc(doc(db, "users", currentUser.uid))
    );

    if (!profileSnap.exists()) {
      throw new Error("Student profile not found.");
    }

    studentProfile = profileSnap.data();

    const role = String(
      studentProfile.role || ""
    ).trim().toLowerCase();

    const status = String(
      studentProfile.status || ""
    ).trim().toLowerCase();

    if (role !== "student") {
      throw new Error(
        "This page is available to student accounts only."
      );
    }

    if (status !== "active") {
      throw new Error(
        "Your student account is not active."
      );
    }

    studentSectionId = String(
      studentProfile.sectionId || ""
    ).trim();

    console.log("[CLASSWORK] Student profile loaded.");
    console.log("[CLASSWORK] Student section:", studentSectionId);

    // -----------------------------------------------
    // 2. TEST QUIZ DOCUMENT AFTER AUTHENTICATION
    // -----------------------------------------------

    await testQuizPermission();

    // -----------------------------------------------
    // 3. LOAD CATEGORIES INDEPENDENTLY
    // -----------------------------------------------

    const results = await Promise.allSettled([

      loadMaterials(),

      loadAnnouncements(),

      loadAssignments(),

      loadQuizzes()

    ]);

    const categoryNames = [
      "Materials",
      "Announcements",
      "Assignments",
      "Quizzes"
    ];

    results.forEach((result, index) => {

      if (result.status === "rejected") {

        console.error(
          `[CLASSWORK] ${categoryNames[index]} could not be loaded:`,
          result.reason
        );

      }

    });

    console.log(
      "[CLASSWORK] Total classwork items:",
      classItems.length
    );

    renderClasswork();

  } catch (error) {

    console.error(
      "[CLASSWORK] Classwork initialization failed:",
      error
    );

    container.innerHTML = `
      <div class="empty error-state">
        <h3>Unable to load classwork</h3>
        <p>${escapeHTML(error.message)}</p>

        <button
          type="button"
          class="retry-button"
          id="retryClasswork">
          Try Again
        </button>
      </div>
    `;

    document
      .getElementById("retryClasswork")
      ?.addEventListener("click", loadClasswork);

  } finally {

    isLoading = false;

  }

}


// ======================================================
// QUIZ PERMISSION TEST
// Runs only after the student is authenticated.
// ======================================================

async function testQuizPermission() {

  const testQuizId = "rbOLDMAz6Y8URn4H8sCf";

  try {

    const snap = await getDoc(
      doc(db, "quizzes", testQuizId)
    );

    if (!snap.exists()) {

      console.warn(
        "[QUIZ TEST] Test quiz document does not exist."
      );

      return;

    }

    const data = snap.data();

    console.log("[QUIZ TEST] Direct document read SUCCESS:", {
      id: snap.id,
      status: data.status,
      sectionIds: data.sectionIds,
      studentSectionId,
      matchesSection: Array.isArray(data.sectionIds)
        && data.sectionIds.includes(studentSectionId)
    });

  } catch (error) {

    console.error("[QUIZ TEST] Direct document read FAILED:", {
      code: error.code,
      message: error.message
    });

  }

}


// ======================================================
// 3. LOAD MATERIALS / MODULES
// ======================================================

async function loadMaterials() {

  if (!studentSectionId) {
    console.warn(
      "[CLASSWORK] Cannot load assigned modules without a section."
    );
    return;
  }

  const snapshot = await debugFirestoreRead(
    "published modules",
    () => getDocs(
      query(
        collection(db, "modules"),
        where("status", "==", "active"),
        where(
          "sectionIds",
          "array-contains",
          studentSectionId
        )
      )
    )
  );

  const now = new Date();

  snapshot.forEach(item => {

    const data = item.data();

    const availableAt = toDate(data.availableAt);
    const dueDate = toDate(data.dueDate);

    if (availableAt && availableAt > now) return;
    if (dueDate && dueDate < now) return;

    addClassItem({
      id: item.id,
      type: "materials",
      title: data.title || "Untitled Module",
      description: data.description || "",
      fileURL: data.fileURL || "",
      fileName: data.fileName || "",
      videoUrl: data.videoUrl || "",
      resourceUrl: data.resourceUrl || "",
      resourceLinks: Array.isArray(data.resourceLinks)
        ? data.resourceLinks
        : [],
      dueDate,
      createdAt: data.createdAt
    });

  });

}


// ======================================================
// 4. LOAD ANNOUNCEMENTS
// ======================================================

async function loadAnnouncements() {

  const snapshot = await debugFirestoreRead(
    "announcements",
    () => getDocs(
      query(
        collection(db, "announcements"),
        orderBy("createdAt", "desc")
      )
    )
  );

  snapshot.forEach(item => {

    const data = item.data();

    if (!isAssignedToStudent(data, studentSectionId)) {
      return;
    }

    addClassItem({
      id: item.id,
      type: "announcements",
      title: data.title || "Class Announcement",
      description: data.content || data.message || "",
      createdAt: data.createdAt,
      fileURL: data.fileURL || "",
      videoUrl: data.videoUrl || "",
      resourceUrl: data.resourceUrl || ""
    });

  });

}


// ======================================================
// 5. LOAD ASSIGNMENTS
// ======================================================

async function loadAssignments() {

  if (!studentSectionId) {
    console.warn(
      "[CLASSWORK] No section assigned. Assignments skipped."
    );
    return;
  }

  const snapshot = await debugFirestoreRead(
    "published assignments",
    () => getDocs(
      query(
        collection(db, "assignments"),
        where("status", "==", "active"),
        where(
          "sectionIds",
          "array-contains",
          studentSectionId
        ),
        orderBy("createdAt", "desc")
      )
    )
  );

  const now = new Date();

  snapshot.forEach(item => {

    const data = item.data();

    const availableAt = toDate(data.availableAt);
    const dueDate = toDate(data.dueDate);

    if (availableAt && availableAt > now) return;

    addClassItem({
      id: item.id,
      type: "assignments",
      title: data.title || "Untitled Assignment",
      description:
        data.instructions ||
        data.description ||
        "",
      points: data.points,
      dueDate,
      createdAt: data.createdAt,
      fileURL: data.fileURL || "",
      resourceUrl: data.resourceUrl || ""
    });

  });

}


// ======================================================
// 6. LOAD PUBLISHED QUIZZES
// ======================================================

async function loadQuizzes() {

  if (!studentSectionId) {
    console.warn(
      "[CLASSWORK] No section assigned. Quizzes skipped."
    );
    return;
  }

  console.log(
    "[CLASSWORK] Searching quizzes for section:",
    studentSectionId
  );

  // IMPORTANT:
  // The Firestore Rules must permit students to list
  // active quizzes assigned to their own section.
  //
  // This query intentionally matches the security rule:
  // status == active
  // sectionIds array-contains studentSectionId

  const quizQuery = query(
    collection(db, "quizzes"),
    where("status", "==", "active"),
    where(
      "sectionIds",
      "array-contains",
      studentSectionId
    )
  );

  const snapshot = await debugFirestoreRead(
    "published quizzes",
    () => getDocs(quizQuery)
  );

  console.log(
    "[CLASSWORK] Matching published quizzes:",
    snapshot.size
  );

  const now = new Date();

  snapshot.forEach(item => {

    const data = item.data();

    const availableAt = toDate(data.availableAt);
    const dueDate = toDate(data.dueDate);

    if (availableAt && availableAt > now) return;

    if (dueDate && dueDate < now) return;

    addClassItem({
      id: item.id,
      type: "quizzes",
      title: data.title || "Untitled Quiz",
      description: data.description || "",
      quizType: data.type || "native",
      quizUrl: data.quizUrl || "",
      lessonId: data.lessonId || "",
      lessonName: data.lessonName || "",
      totalQuestions: Number(data.totalQuestions || 0),
      totalPoints: Number(data.totalPoints || 0),
      passingScore: Number(data.passingScore || 0),
      timeLimit: Number(data.timeLimit || 0),
      attemptLimit: Number(data.attemptLimit || 1),
      shuffleQuestions: Boolean(data.shuffleQuestions),
      shuffleChoices: Boolean(data.shuffleChoices),
      dueDate,
      availableAt,
      createdAt: data.createdAt
    });

  });

}


// ======================================================
// ADD CLASSWORK ITEM
// ======================================================

function addClassItem(item) {

  const duplicate = classItems.some(
    existing =>
      existing.id === item.id &&
      existing.type === item.type
  );

  if (!duplicate) {
    classItems.push(item);
  }

}


// ======================================================
// STUDENT ASSIGNMENT FILTER
// ======================================================

function isAssignedToStudent(data, sectionId) {

  if (Array.isArray(data.sectionIds)) {

    return sectionId
      ? data.sectionIds.includes(sectionId)
      : data.sectionIds.length === 0;

  }

  if (data.sectionId) {
    return data.sectionId === sectionId;
  }

  return data.audience === "all";

}


// ======================================================
// RENDER CLASSWORK
// ======================================================

function renderClasswork() {

  if (!container) return;

  let filtered = [...classItems];

  if (currentTab !== "all") {

    filtered = filtered.filter(
      item => item.type === currentTab
    );

  }

  if (!filtered.length) {

    const labels = {
      all: "classwork",
      announcements: "announcements",
      assignments: "assignments",
      materials: "learning materials",
      quizzes: "quizzes"
    };

    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📚</div>
        <h3>Nothing here yet</h3>
        <p>
          No ${escapeHTML(labels[currentTab] || "classwork")}
          are currently available for your section.
        </p>
      </div>
    `;

    return;

  }

  const order = {
    announcements: 1,
    assignments: 2,
    quizzes: 3,
    materials: 4
  };

  filtered.sort((a, b) => {

    const typeOrder =
      (order[a.type] || 99) -
      (order[b.type] || 99);

    if (typeOrder !== 0) {
      return typeOrder;
    }

    return dateValue(b.createdAt) -
      dateValue(a.createdAt);

  });

  container.replaceChildren();

  filtered.forEach(item => {

    const card = document.createElement("article");
    card.className = "content-card";

    // -----------------------------------------------
    // CARD HEADER
    // -----------------------------------------------

    const icons = {
      announcements: "📢",
      assignments: "📝",
      materials: "📚",
      quizzes: "❓"
    };

    const icon = document.createElement("div");
    icon.className = "content-icon";
    icon.textContent = icons[item.type] || "📘";

    const info = document.createElement("div");
    info.className = "content-info";

    const heading = document.createElement("h3");
    heading.textContent = item.title;

    const description = document.createElement("p");
    description.textContent =
      item.description || "No description provided.";

    info.append(heading, description);

    const top = document.createElement("div");
    top.className = "content-top";

    top.append(icon, info);

    card.append(top);

    // -----------------------------------------------
    // METADATA
    // -----------------------------------------------

    const meta = document.createElement("div");
    meta.className = "content-meta";

    addMeta(meta, item.type.toUpperCase());

    if (item.points !== undefined && item.points !== null) {
      addMeta(meta, `${item.points} points`);
    }

    if (item.totalQuestions > 0) {
      addMeta(meta, `${item.totalQuestions} questions`);
    }

    if (item.totalPoints > 0) {
      addMeta(meta, `${item.totalPoints} total points`);
    }

    if (item.timeLimit > 0) {
      addMeta(meta, `${item.timeLimit} minutes`);
    }

    if (item.attemptLimit > 0 && item.type === "quizzes") {
      addMeta(meta, `${item.attemptLimit} attempt(s)`);
    }

    if (item.dueDate) {
      addMeta(
        meta,
        `Due: ${item.dueDate.toLocaleString()}`
      );
    }

    if (item.lessonName) {
      addMeta(meta, item.lessonName);
    }

    card.append(meta);

    // -----------------------------------------------
    // CONTENT ACTIONS
    // -----------------------------------------------

    const actions = document.createElement("div");
    actions.className = "content-actions";

    // Attachment
    if (item.fileURL) {
      addLink(
        actions,
        item.fileURL,
        "📎 Open Attachment"
      );
    }

    // Video
    if (item.videoUrl) {
      addLink(
        actions,
        item.videoUrl,
        "🎥 Watch Video"
      );
    }

    // External resource
    if (item.resourceUrl) {
      addLink(
        actions,
        item.resourceUrl,
        "🔗 Open Resource"
      );
    }

    // Additional learning resources
    if (Array.isArray(item.resourceLinks)) {

      item.resourceLinks.forEach(resource => {

        if (!resource || typeof resource !== "object") {
          return;
        }

        const url = resource.url || resource.href;

        const label =
          resource.title ||
          resource.name ||
          "Open Learning Resource";

        if (url) {
          addLink(actions, url, `🔗 ${label}`);
        }

      });

    }

    // -----------------------------------------------
    // OPEN MODULE
    // -----------------------------------------------

    if (item.type === "materials") {

      addLink(
        actions,
        `lesson.html?module=${encodeURIComponent(item.id)}`,
        "📚 Open Module →",
        false
      );

    }

    // -----------------------------------------------
    // OPEN ASSIGNMENT
    // -----------------------------------------------

    if (item.type === "assignments") {

      addLink(
        actions,
        `assignment.html?id=${encodeURIComponent(item.id)}`,
        "📝 View Assignment →",
        false
      );

    }

    // -----------------------------------------------
    // OPEN QUIZ
    // -----------------------------------------------

    if (item.type === "quizzes") {

      if (
        item.quizType === "external" &&
        item.quizUrl
      ) {

        addLink(
          actions,
          item.quizUrl,
          "🔗 Open External Quiz →"
        );

      } else {

        addLink(
          actions,
          `quiz.html?id=${encodeURIComponent(item.id)}`,
          "❓ Start Quiz →",
          false
        );

      }

    }

    if (actions.children.length > 0) {
      card.append(actions);
    }

    container.append(card);

  });

}


// ======================================================
// METADATA HELPER
// ======================================================

function addMeta(container, value) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return;
  }

  const badge = document.createElement("span");

  badge.className = "meta";
  badge.textContent = String(value);

  container.append(badge);

}


// ======================================================
// LINK HELPER
// ======================================================

function addLink(container, url, label, external = true) {

  if (!url) return;

  let parsed;

  try {

    parsed = new URL(
      url,
      window.location.href
    );

  } catch {
    return;
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    return;
  }

  const link = document.createElement("a");

  link.className = "content-action";
  link.textContent = label;
  link.href = parsed.href;

  if (external) {

    link.target = "_blank";
    link.rel = "noopener noreferrer";

  }

  container.append(link);

}


// ======================================================
// DATE HELPERS
// ======================================================

function toDate(value) {

  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value === "number") {

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date;

  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;

}


function dateValue(value) {

  const date = toDate(value);

  return date ? date.getTime() : 0;

}


// ======================================================
// HTML ESCAPING
// ======================================================

function escapeHTML(value) {

  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );

}
