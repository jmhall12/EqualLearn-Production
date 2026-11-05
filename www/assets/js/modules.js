
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

const container = document.getElementById("classContent");

let currentUser = null;
let currentTab = "all";
let classItems = [];

// ======================================================
// FIRESTORE DIAGNOSTICS
// ======================================================

async function debugFirestoreRead(label, operation) {
  try {
    console.log(`[CLASSWORK] Loading ${label}...`);

    const result = await operation();

    console.log(
      `[CLASSWORK] ${label} loaded successfully.`,
      result.size !== undefined ? `Documents: ${result.size}` : ""
    );

    return result;

  } catch (error) {
    console.error(`[CLASSWORK] ${label} FAILED:`, {
      code: error.code,
      message: error.message,
      error
    });

    throw error;
  }
}

// ======================================================
// AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    location.href = "../login.html";
    return;
  }

  currentUser = user;
  await loadClasswork();

});

// ======================================================
// TAB NAVIGATION
// ======================================================

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach(tab =>
      tab.classList.remove("active")
    );

    button.classList.add("active");
    currentTab = button.dataset.tab;

    renderClasswork();
  });
});

// ======================================================
// LOAD CLASSWORK
// ======================================================

async function loadClasswork() {
  container.innerHTML = `
    <div class="empty">Loading classwork...</div>
  `;

  try {

    // --------------------------------------------------
    // 1. LOAD STUDENT PROFILE
    // --------------------------------------------------

    const profileSnap = await debugFirestoreRead(
      "student profile",
      () => getDoc(doc(db, "users", currentUser.uid))
    );

    if (!profileSnap.exists()) {
      throw new Error("Student profile not found.");
    }

    const profile = profileSnap.data();

    if (
      profile.role !== "student" ||
      profile.status !== "active"
    ) {
      throw new Error("Your student account is not active.");
    }

    const sectionId = profile.sectionId;

    console.log("[CLASSWORK] Student section ID:", sectionId || "Not assigned");

    // --------------------------------------------------
    // 2. LOAD PUBLISHED MODULES
    // --------------------------------------------------

    const moduleConstraints = [
      where("status", "==", "active")
    ];

    if (sectionId) {
      moduleConstraints.push(
        where("sectionIds", "array-contains", sectionId)
      );
    }

    const moduleSnapshot = await debugFirestoreRead(
      "modules",
      () => getDocs(
        query(
          collection(db, "modules"),
          ...moduleConstraints
        )
      )
    );

    classItems = [];

    moduleSnapshot.forEach(item => {
      const data = item.data();

      const availableAt = toDate(data.availableAt);
      const dueDate = toDate(data.dueDate);
      const now = new Date();

      if (availableAt && availableAt > now) return;
      if (dueDate && dueDate < now) return;

      classItems.push({
        id: item.id,
        type: "materials",
        title: data.title || "Untitled Module",
        description: data.description || "",
        fileURL: data.fileURL || "",
        videoUrl: data.videoUrl || "",
        resourceUrl: data.resourceUrl || "",
        dueDate,
        createdAt: data.createdAt
      });
    });

    // --------------------------------------------------
    // 3. LOAD ANNOUNCEMENTS
    // --------------------------------------------------

    const announcementSnapshot = await debugFirestoreRead(
      "announcements",
      () => getDocs(
        query(
          collection(db, "announcements"),
          orderBy("createdAt", "desc")
        )
      )
    );

    announcementSnapshot.forEach(item => {
      const data = item.data();

      if (!isAssignedToStudent(data, sectionId)) return;

      classItems.push({
        id: item.id,
        type: "announcements",
        title: data.title || "Class Announcement",
        description: data.content || data.message || "",
        createdAt: data.createdAt
      });
    });

   
    // --------------------------------------------------
    // 4. LOAD ASSIGNMENTS
    // --------------------------------------------------

    if (!sectionId) {
      console.warn("[CLASSWORK] No section assigned. Skipping assignments.");
    } else {
      const assignmentSnapshot = await debugFirestoreRead(
        "assignments",
        () => getDocs(
          query(
            collection(db, "assignments"),
            where("status", "==", "active"),
            where("sectionIds", "array-contains", sectionId),
            orderBy("createdAt", "desc")
          )
        )
      );

           assignmentSnapshot.forEach(item => {
        const data = item.data();

        classItems.push({
          id: item.id,
          type: "assignments",
          title: data.title || "Untitled Assignment",
          description: data.instructions || data.description || "",
          points: data.points,
          dueDate: toDate(data.dueDate),
          createdAt: data.createdAt
        });
      });
    }

    
    // --------------------------------------------------
    // 5. RENDER LOADED CLASSWORK
    // --------------------------------------------------

    console.log(
      "[CLASSWORK] Total loaded items:",
      classItems.length
    );

    renderClasswork();

  } catch (error) {
    console.error("Classwork loading error:", error);

    container.innerHTML = `
      <div class="empty">
        <strong>Unable to load classwork.</strong>
        <p>${escapeHTML(error.message)}</p>
      </div>
    `;
  }
}


// ======================================================
// STUDENT ASSIGNMENT FILTER
// ======================================================

function isAssignedToStudent(data, sectionId) {

  // Explicit section assignment.
  if (Array.isArray(data.sectionIds)) {
    return sectionId
      ? data.sectionIds.includes(sectionId)
      : data.sectionIds.length === 0;
  }

  // Legacy single-section field.
  if (data.sectionId) {
    return data.sectionId === sectionId;
  }

  // All students only when explicitly configured.
  return data.audience === "all";
}

// ======================================================
// RENDER CLASSWORK
// ======================================================

function renderClasswork() {

  let filtered = classItems;

  if (currentTab !== "all") {
    filtered = classItems.filter(
      item => item.type === currentTab
    );
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty">
        <h3>Nothing here yet</h3>
        <p>Your teacher hasn't posted anything in this category.</p>
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

    const typeOrder = order[a.type] - order[b.type];

    if (typeOrder !== 0) return typeOrder;

    return dateValue(b.createdAt) - dateValue(a.createdAt);

  });

  container.replaceChildren();

  filtered.forEach(item => {

    const card = document.createElement("article");
    card.className = "content-card";

    const icons = {
      announcements: "📢",
      assignments: "📝",
      materials: "📚",
      quizzes: "❓"
    };

    const icon = document.createElement("div");
    icon.className = "content-icon";
    icon.textContent = icons[item.type];

    const info = document.createElement("div");
    info.style.flex = "1";

    const heading = document.createElement("h3");
    heading.textContent = item.title;

    const description = document.createElement("p");
    description.textContent = item.description;

    info.append(heading, description);

    const top = document.createElement("div");
    top.className = "content-top";
    top.append(icon, info);

    card.append(top);

    const meta = document.createElement("div");
    meta.className = "content-meta";

    const typeMeta = document.createElement("span");
    typeMeta.className = "meta";
    typeMeta.textContent = item.type.toUpperCase();

    meta.append(typeMeta);

    if (item.points !== undefined) {
      const points = document.createElement("span");
      points.className = "meta";
      points.textContent = `${item.points} points`;

      meta.append(points);
    }

    if (item.dueDate) {
      const due = document.createElement("span");
      due.className = "meta";
      due.textContent = `Due: ${item.dueDate.toLocaleString()}`;

      meta.append(due);
    }

    card.append(meta);

    
// ======================================================
// SEPARATE CONTENT ACTIONS
// ======================================================

const actions = document.createElement("div");

actions.className = "content-actions";

actions.style.display = "flex";
actions.style.flexDirection = "column";
actions.style.alignItems = "flex-start";
actions.style.gap = "12px";
actions.style.marginTop = "18px";
actions.style.width = "100%";

// Uploaded attachment
if (item.fileURL) {
  addLink(actions, item.fileURL, "📎 Open Attachment");
}

// Video - opens directly in a new tab
if (item.videoUrl) {
  addLink(actions, item.videoUrl, "🎥 Watch Video");
}

// External resource
if (item.resourceUrl) {
  addLink(actions, item.resourceUrl, "🔗 Open Resource");
}

// Module - opens lesson page only
if (item.type === "materials") {
  addLink(
    actions,
    `lesson.html?module=${encodeURIComponent(item.id)}`,
    "📚 Open Module →",
    false
  );
}

// Assignment
if (item.type === "assignments") {
  addLink(
    actions,
    `assignment.html?id=${encodeURIComponent(item.id)}`,
    "📝 View Assignment →",
    false
  );
}

// Quiz
if (item.type === "quizzes") {
  addLink(
    actions,
    `quiz.html?id=${encodeURIComponent(item.id)}`,
    "❓ Open Quiz →",
    false
  );
}

if (actions.children.length > 0) {
  card.append(actions);
}


    container.append(card);

  });
}

// ======================================================
// LINKS
// ======================================================

function addLink(card, url, label, external = true) {

  if (!url) return;

  const link = document.createElement("a");

  link.className = "content-action";
  link.textContent = label;
  link.href = url;

  if (external) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  card.append(link);
}

// ======================================================
// DATE HELPERS
// ======================================================

function toDate(value) {

  if (!value) return null;

  if (value.toDate) return value.toDate();

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value) {

  const date = toDate(value);

  return date ? date.getTime() : 0;
}

// ======================================================
// HTML ESCAPING
// ======================================================

function escapeHTML(value) {

  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);

}
