
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =====================================================
   EQUALLEARN — STUDENT LEARNING MODULES V2
   Firebase: modulesV2
   Existing users and sections collections are preserved.
===================================================== */

const $ = id => document.getElementById(id);

let currentUser = null;
let studentProfile = null;
let modules = [];
let activeFilter = "all";
let unsubscribeModules = null;
let unsubscribeModulesLegacySection = null;
let unsubscribeAdminModules = null;
let unsubscribeAdminModulesLegacySection = null;
let unsubscribeAdminLessons = null;
let unsubscribeAdminLessonsLegacySection = null;
let v2Modules = [];
let v2ModulesLegacySection = [];
let adminModules = [];
let adminModulesLegacySection = [];
let adminLessons = [];
let adminLessonsLegacySection = [];
let authReady = false;
let pendingDeepLinkHandled = false;

/* =====================================================
   INITIALIZATION
===================================================== */

document.addEventListener("DOMContentLoaded", initializePage);

function initializePage() {
  if (!$("moduleGrid")) {
    console.error("[EqualLearn Modules] moduleGrid not found.");
    return;
  }

  if ($("year")) {
    $("year").textContent = new Date().getFullYear();
  }

  initializeSearch();
  initializeFilters();
  initializeAuthentication();

  console.log("[EqualLearn Modules] Page initialized.");
}

/* =====================================================
   SEARCH
===================================================== */

function initializeSearch() {
  const searchInput = $("searchInput");

  if (!searchInput) return;

  searchInput.addEventListener("input", renderModules);
}

/* =====================================================
   FILTERS
===================================================== */

function initializeFilters() {
  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";

      document.querySelectorAll("[data-filter]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      renderModules();
    });
  });
}

/* =====================================================
   AUTHENTICATION
===================================================== */


function stopModuleListeners() {
  [
    unsubscribeModules,
    unsubscribeModulesLegacySection,
    unsubscribeAdminModules,
    unsubscribeAdminModulesLegacySection,
    unsubscribeAdminLessons,
    unsubscribeAdminLessonsLegacySection
  ].forEach(unsubscribe => {
    if (typeof unsubscribe === "function") unsubscribe();
  });

  unsubscribeModules = null;
  unsubscribeModulesLegacySection = null;
  unsubscribeAdminModules = null;
  unsubscribeAdminModulesLegacySection = null;
  unsubscribeAdminLessons = null;
  unsubscribeAdminLessonsLegacySection = null;
}

function initializeAuthentication() {
  onAuthStateChanged(auth, async user => {
    stopModuleListeners();
    v2Modules = [];
    v2ModulesLegacySection = [];
    adminModules = [];
    adminModulesLegacySection = [];
    adminLessons = [];
    adminLessonsLegacySection = [];
    modules = [];
    pendingDeepLinkHandled = false;
    updateStatistics();

    if (!user) {
      location.replace("../login.html");
      return;
    }

    currentUser = user;

    try {
      const profileRef = doc(db, "users", user.uid);
      const profileSnapshot = await getDoc(profileRef);

      if (!profileSnapshot.exists()) {
        throw new Error("Student profile was not found.");
      }

      studentProfile = profileSnapshot.data();

      const role = String(studentProfile.role || "").toLowerCase();
      const status = String(studentProfile.status || "").toLowerCase();

      if (role !== "student") {
        location.replace("../login.html");
        return;
      }

      if (status !== "active") {
        throw new Error("Your student account is not active.");
      }

      const sectionId = String(studentProfile.sectionId || "").trim();

      if (!sectionId) {
        throw new Error(
          "No section has been assigned to your student account. Please contact your teacher or administrator."
        );
      }

      // ========================================
      // NORMAL INITIALIZATION
      // ========================================

      updateStudentInformation(user, studentProfile);

      listenToModules(sectionId);

      authReady = true;

    } catch (error) {
      console.error(
        "[EqualLearn Modules] Authentication error:",
        error
      );

      showState(
        "⚠️",
        "Unable to load your account",
        error.message ||
          "Something went wrong while loading your student profile.",
        true
      );
    }
  });
}


/* =====================================================
   STUDENT INFORMATION
===================================================== */

function updateStudentInformation(user, profile) {
  const fullName =
    profile.fullName ||
    profile.fullname ||
    profile.name ||
    user.displayName ||
    "Student";

  const sectionName =
    profile.section ||
    profile.sectionName ||
    profile.course ||
    "My Section";

  const firstLetter = fullName.trim().charAt(0).toUpperCase() || "S";

  if ($("sidebarName")) {
    $("sidebarName").textContent = fullName;
  }

  if ($("sidebarRole")) {
    $("sidebarRole").textContent = "Student Account";
  }

  if ($("avatar")) {
    $("avatar").textContent = firstLetter;
  }

  if ($("sectionBadge")) {
    $("sectionBadge").textContent = sectionName;
  }

  if ($("sectionStat")) {
    $("sectionStat").textContent = sectionName;
  }
}

/* =====================================================
   FIRESTORE REAL-TIME MODULE LISTENER
===================================================== */




function listenToModules(sectionId) {
  stopModuleListeners();
  showLoading();

  // Current schema: sectionIds is an array of Firestore section document IDs.
  const v2Query = query(
    collection(db, "modulesV2"),
    where("status", "==", "published"),
    where("sectionIds", "array-contains", sectionId)
  );

  const adminModulesQuery = query(
    collection(db, "modules"),
    where("status", "==", "active"),
    where("reviewStatus", "==", "approved"),
    where("sectionIds", "array-contains", sectionId)
  );

  const adminLessonsQuery = query(
    collection(db, "lessons"),
    where("status", "==", "active"),
    where("reviewStatus", "==", "approved"),
    where("sectionIds", "array-contains", sectionId)
  );

  // Backward compatibility: read older records that stored one sectionId.
  const v2LegacySectionQuery = query(
    collection(db, "modulesV2"),
    where("status", "==", "published"),
    where("sectionId", "==", sectionId)
  );

  const adminModulesLegacySectionQuery = query(
    collection(db, "modules"),
    where("status", "==", "active"),
    where("reviewStatus", "==", "approved"),
    where("sectionId", "==", sectionId)
  );

  const adminLessonsLegacySectionQuery = query(
    collection(db, "lessons"),
    where("status", "==", "active"),
    where("reviewStatus", "==", "approved"),
    where("sectionId", "==", sectionId)
  );

  console.log("[EqualLearn Modules] Listening to section content:", {
    sectionId,
    uid: auth.currentUser?.uid,
    projectId: auth.app.options.projectId
  });

  const refresh = () => {
    const combined = new Map();

    [...v2Modules, ...v2ModulesLegacySection].forEach(item => {
      combined.set(item.id, { ...item, sourceCollection: "modulesV2" });
    });

    [...adminModules, ...adminModulesLegacySection].forEach(item => {
      const existing = combined.get(item.id) || {};
      combined.set(item.id, {
        ...existing,
        ...item,
        id: item.id,
        sourceCollection: "modules",
        isAdminContent: true,
        teacherName: item.assignedTeacherName || item.teacherName || item.createdByName || "Your Teacher",
        category: item.category || item.subject || "ADMIN MODULE"
      });
    });

    const lessonGroups = new Map();
    [...adminLessons, ...adminLessonsLegacySection].forEach(lesson => {
      const moduleId = String(lesson.moduleId || "").trim();
      if (!moduleId) return;
      if (!lessonGroups.has(moduleId)) lessonGroups.set(moduleId, []);
      lessonGroups.get(moduleId).push(lesson);
    });

    lessonGroups.forEach((items, moduleId) => {
      const existing = combined.get(moduleId);
      const lessonResources = items.flatMap(lesson => {
        const attachments = Array.isArray(lesson.attachments) ? lesson.attachments : [];
        const links = Array.isArray(lesson.resourceLinks) ? lesson.resourceLinks : [];
        return [...attachments, ...links];
      });

      if (existing) {
        existing.lessonCount = items.length;
        existing.hasPublishedLessons = true;
        existing.lessonResources = lessonResources;
        return;
      }

      const first = items[0];
      combined.set(moduleId, {
        id: moduleId,
        title: first.moduleName || "Shared Lessons",
        description: "Your teacher has published lessons for your section in this learning module.",
        category: "LESSONS",
        teacherName: first.assignedTeacherName || first.teacherName || first.createdByName || "Your Teacher",
        createdAt: first.createdAt,
        publishedAt: first.publishedAt,
        sectionIds: [sectionId],
        sourceCollection: "lessons",
        isAdminContent: true,
        isLessonGroup: true,
        lessonCount: items.length,
        hasPublishedLessons: true,
        attachments: lessonResources
      });
    });

    modules = [...combined.values()].sort((a, b) =>
      getDate(b.publishedAt || b.createdAt) - getDate(a.publishedAt || a.createdAt)
    );

    updateStatistics();
    renderModules();
    handlePendingContentDeepLink();
    console.info(`[EqualLearn Modules] ${modules.length} module(s)/lesson groups visible for section ${sectionId}.`);
  };

  unsubscribeModules = onSnapshot(v2Query, snapshot => {
    v2Modules = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Modules V2 / sectionIds] Listener error:", error.code, error.message);
    refresh();
  });

  unsubscribeModulesLegacySection = onSnapshot(v2LegacySectionQuery, snapshot => {
    v2ModulesLegacySection = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Modules V2 / sectionId] Listener error:", error.code, error.message);
    refresh();
  });

  unsubscribeAdminModules = onSnapshot(adminModulesQuery, snapshot => {
    adminModules = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Admin Modules / sectionIds] Listener error:", error.code, error.message);
    refresh();
  });

  unsubscribeAdminModulesLegacySection = onSnapshot(adminModulesLegacySectionQuery, snapshot => {
    adminModulesLegacySection = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Admin Modules / sectionId] Listener error:", error.code, error.message);
    refresh();
  });

  unsubscribeAdminLessons = onSnapshot(adminLessonsQuery, snapshot => {
    adminLessons = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Admin Lessons / sectionIds] Listener error:", error.code, error.message);
    refresh();
  });

  unsubscribeAdminLessonsLegacySection = onSnapshot(adminLessonsLegacySectionQuery, snapshot => {
    adminLessonsLegacySection = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    refresh();
  }, error => {
    console.error("[EqualLearn Admin Lessons / sectionId] Listener error:", error.code, error.message);
    refresh();
  });
}


function handlePendingContentDeepLink() {
  if (pendingDeepLinkHandled || !modules.length) return;

  const params = new URLSearchParams(window.location.search);
  const moduleId = params.get("openModule");
  const lessonId = params.get("openLesson");

  if (moduleId) {
    const target = modules.find(item => item.id === moduleId);
    if (target) {
      pendingDeepLinkHandled = true;
      openModule(target);
      return;
    }
  }

  if (lessonId) {
    const lesson = adminLessons.find(item => item.id === lessonId);
    if (lesson?.moduleId) {
      pendingDeepLinkHandled = true;
      window.location.replace(`lesson.html?module=${encodeURIComponent(lesson.moduleId)}`);
    }
  }
}

/* =====================================================
   STATISTICS
===================================================== */

function updateStatistics() {
  if ($("moduleCount")) {
    $("moduleCount").textContent = modules.length;
  }

  const totalResources = modules.reduce((total, module) => {
    return total + getResources(module).length;
  }, 0);

  if ($("resourceCount")) {
    $("resourceCount").textContent = totalResources;
  }

  if ($("sectionStat") && studentProfile) {
    $("sectionStat").textContent =
      studentProfile.section ||
      studentProfile.sectionName ||
      studentProfile.course ||
      "My Section";
  }
}

/* =====================================================
   RESOURCE NORMALIZATION
===================================================== */

function getResources(module) {
  if (!module || typeof module !== "object") {
    return [];
  }

  const resources = [];

  if (Array.isArray(module.resources)) {
    resources.push(...module.resources);
  }

  if (Array.isArray(module.attachments)) {
    resources.push(...module.attachments.map(file => ({
      ...file,
      url: file.url || file.fileUrl || file.fileURL || file.downloadURL || file.downloadUrl,
      label: file.label || file.fileName || file.name || "Lesson attachment",
      fileName: file.fileName || file.name || "attachment",
      mimeType: file.mimeType || file.fileMimeType || "application/octet-stream",
      size: file.size || file.fileSize || 0,
      type: file.type || "file"
    })));
  }

  if (Array.isArray(module.lessonResources)) {
    resources.push(...module.lessonResources);
  }

  if (Array.isArray(module.resourceLinks)) {
    resources.push(...module.resourceLinks);
  }

  const directResources = [
    {
      url: module.fileURL || module.fileUrl,
      label: module.fileName || "Open File",
      type: "file"
    },
    {
      url: module.pdfUrl,
      label: "Open PDF",
      type: "pdf"
    },
    {
      url: module.videoUrl,
      label: "Watch Video",
      type: "video"
    },
    {
      url: module.resourceUrl,
      label: "Open Resource",
      type: "link"
    }
  ];

  resources.push(
    ...directResources.filter(resource => resource.url)
  );

  const unique = new Map();

  resources.forEach(resource => {
    if (!resource || typeof resource !== "object") return;

    const rawURL =
      resource.url ||
      resource.href ||
      resource.fileURL ||
      resource.fileUrl ||
      "";

    // New Teacher Activity Builder format: Base64 file stored in Firestore.
    const base64 = typeof resource.base64 === "string"
      ? resource.base64
      : "";

    const mimeType = resource.mimeType || "application/octet-stream";
    const fileName = resource.fileName || resource.name || "attachment";

    if (base64) {
      const key = `base64:${fileName}:${base64.slice(0, 48)}`;

      unique.set(key, {
        label:
          resource.label ||
          resource.name ||
          resource.title ||
          fileName ||
          "Open File",
        type: resource.type || "file",
        base64,
        mimeType,
        fileName,
        size: Number(resource.size || 0)
      });
      return;
    }

    const safeURL = validURL(rawURL);
    if (!safeURL) return;

    unique.set(safeURL, {
      label:
        resource.label ||
        resource.name ||
        resource.title ||
        "Open Resource",
      url: safeURL,
      type:
        resource.type ||
        resource.kind ||
        "link",
      fileName,
      mimeType,
      size: Number(resource.size || 0)
    });
  });

  return [...unique.values()];
}

// Convert the Firestore Base64 attachment into a browser-readable data URL.
function resourceDataURL(resource) {
  if (!resource?.base64) return null;

  const mimeType = String(
    resource.mimeType || "application/octet-stream"
  ).replace(/[^\w.+/-]/g, "");

  return `data:${mimeType};base64,${resource.base64}`;
}

/* =====================================================
   URL VALIDATION
===================================================== */

function validURL(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);

    if (!["https:", "http:"].includes(url.protocol)) {
      return null;
    }

    return url.href;

  } catch {
    return null;
  }
}

/* =====================================================
   RENDER MODULES AS A COMPACT LIST
===================================================== */

function renderModules() {
  const grid = $("moduleGrid");
  if (!grid) return;

  const search = ($("searchInput")?.value || "").trim().toLowerCase();

  let filtered = modules.filter(module => {
    const searchableText = [
      module.title,
      module.description,
      module.category,
      module.subject,
      module.teacherName
    ].filter(Boolean).join(" ").toLowerCase();

    return searchableText.includes(search);
  });

  // Newest published content first.
  filtered.sort((a, b) =>
    getDate(b.publishedAt || b.createdAt) -
    getDate(a.publishedAt || a.createdAt)
  );

  if (activeFilter === "recent") {
    filtered = filtered.slice(0, 8);
  }

  grid.replaceChildren();

  const listHeading = document.querySelector(".modules-list-heading span");
  if (listHeading) {
    listHeading.textContent = filtered.length
      ? `${filtered.length} item${filtered.length === 1 ? "" : "s"} · Open an item to view`
      : "No items to display";
  }

  if (filtered.length === 0) {
    showState(
      search ? "search" : "book",
      search ? "No matching modules" : "No modules available yet",
      search
        ? "Try another keyword to find your learning materials."
        : "Your teacher has not published learning materials for your section yet."
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((module, index) => {
    fragment.appendChild(createModuleCard(module, index));
  });
  grid.appendChild(fragment);
}

/* =====================================================
   CREATE CLICK-TO-OPEN MODULE ROW
===================================================== */

function createModuleCard(module, index) {
  const row = document.createElement("a");
  row.className = "module-row";
  row.href = getModuleDestination(module);
  row.style.animationDelay = `${Math.min(index * 35, 210)}ms`;

  const icon = document.createElement("span");
  icon.className = "module-row-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 4.8A2.8 2.8 0 0 1 7.8 2H20v17H7.8A2.8 2.8 0 0 0 5 21z"/>
      <path d="M5 4.8V21M9 7h7M9 11h7"/>
    </svg>
  `;

  const content = document.createElement("span");
  content.className = "module-row-content";

  const heading = document.createElement("span");
  heading.className = "module-row-heading";

  const title = document.createElement("h3");
  title.textContent = module.title || "Untitled Module";

  const category = document.createElement("span");
  category.className = "module-category";
  category.textContent = module.category || module.subject ||
    (module.isLessonGroup ? "LESSONS" : "LEARNING MODULE");

  heading.append(title, category);

  const description = document.createElement("span");
  description.className = "module-row-description";
  description.textContent = module.description ||
    "Open this learning material to view its content and resources.";

  const meta = document.createElement("span");
  meta.className = "module-row-meta";

  const teacher = document.createElement("span");
  teacher.className = "module-row-meta-item";
  teacher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2"></circle>
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path>
    </svg>
  `;
  const teacherText = document.createElement("span");
  teacherText.textContent = module.teacherName || "Your Teacher";
  teacher.appendChild(teacherText);

  const resourceCount = getResources(module).length;
  const resources = document.createElement("span");
  resources.className = "module-row-meta-item";
  resources.textContent = `${resourceCount} resource${resourceCount === 1 ? "" : "s"}`;

  const status = document.createElement("span");
  status.className = "module-row-status";
  status.textContent = "Published";

  meta.append(teacher, resources, status);
  content.append(heading, description, meta);

  const arrow = document.createElement("span");
  arrow.className = "module-row-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6"></path>
    </svg>
  `;

  row.setAttribute(
    "aria-label",
    `Open ${module.title || "learning module"}`
  );
  row.append(icon, content, arrow);
  return row;
}

/* =====================================================
   PAGE DESTINATIONS
===================================================== */

function getModuleDestination(module) {
  const moduleId = encodeURIComponent(module.id);

  // Grouped legacy lessons already have a dedicated lesson page.
  if (module.isLessonGroup || module.sourceCollection === "lessons") {
    return `lesson.html?module=${moduleId}`;
  }

  const sourceCollection = module.sourceCollection === "modules"
    ? "modules"
    : "modulesV2";

  return `module-view.html?id=${moduleId}&source=${sourceCollection}`;
}

// Kept for existing deep-link handling. Opening a module now navigates to a page,
// rather than displaying the old modal preview.
function openModule(module) {
  if (!module?.id) return;
  window.location.assign(getModuleDestination(module));
}

/* =====================================================
   LOADING STATE
===================================================== */

function showLoading() {
  const grid = $("moduleGrid");

  if (!grid) return;

  grid.replaceChildren();

  for (let index = 0; index < 3; index++) {
    const skeleton = document.createElement("div");

    skeleton.className = "skeleton";
    skeleton.setAttribute("aria-label", "Loading module");

    grid.appendChild(skeleton);
  }

  if ($("moduleCount")) {
    $("moduleCount").textContent = "…";
  }

  if ($("resourceCount")) {
    $("resourceCount").textContent = "…";
  }
}

/* =====================================================
   EMPTY / ERROR STATE
===================================================== */

function showState(icon, title, message, showRetry = false) {
  const grid = $("moduleGrid");

  if (!grid) return;

  grid.replaceChildren();

  const state = document.createElement("div");
  state.className = "state-box";

  const stateIcon = document.createElement("div");
  stateIcon.className = "state-icon";
  stateIcon.setAttribute("aria-hidden", "true");

  const stateIcons = {
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.3 4.3"></path></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.8A2.8 2.8 0 0 1 7.8 2H20v17H7.8A2.8 2.8 0 0 0 5 21z"></path><path d="M5 4.8V21M9 7h7M9 11h7"></path></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 16.5h.01"></path></svg>`
  };
  stateIcon.innerHTML = stateIcons[icon] || stateIcons.book;

  const heading = document.createElement("h3");
  heading.textContent = title;

  const description = document.createElement("p");
  description.textContent = message;

  state.append(stateIcon, heading, description);

  if (showRetry) {
    const retry = document.createElement("button");

    retry.className = "retry-btn";
    retry.type = "button";
    retry.textContent = "Reload Page";

    retry.addEventListener("click", () => {
      location.reload();
    });

    state.appendChild(retry);
  }

  grid.appendChild(state);
}

/* =====================================================
   FIRESTORE ERROR MESSAGES
===================================================== */

function getFirestoreErrorMessage(error) {
  if (error.code === "permission-denied") {
    return "Your account does not have permission to access these modules. Check the Firestore V2 rules, student section assignment, and published module status.";
  }

  if (error.code === "unavailable") {
    return "The learning service is temporarily unavailable. Please check your internet connection and try again.";
  }

  if (error.code === "failed-precondition") {
    return "The Firestore query requires an index or has an invalid condition. Check the browser console for the Firebase error details.";
  }

  if (error.code === "unauthenticated") {
    return "Your login session has expired. Please sign in again.";
  }

  return error.message ||
    "An unexpected error occurred while retrieving your modules.";
}

/* =====================================================
   DATE HANDLING
===================================================== */

function getDate(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

/* =====================================================
   CLEANUP
===================================================== */

window.addEventListener("beforeunload", stopModuleListeners);
