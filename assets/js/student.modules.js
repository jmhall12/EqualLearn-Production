
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
let authReady = false;

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
  initializeModal();
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

function initializeAuthentication() {
  onAuthStateChanged(auth, async user => {
    if (unsubscribeModules) {
      unsubscribeModules();
      unsubscribeModules = null;
    }

    modules = [];
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

      updateStudentInformation(user, studentProfile);
      listenToModules(sectionId);

      authReady = true;

    } catch (error) {
      console.error("[EqualLearn Modules] Authentication error:", error);

      showState(
        "⚠️",
        "Unable to load your account",
        error.message || "Something went wrong while loading your student profile.",
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
  if (unsubscribeModules) {
    unsubscribeModules();
    unsubscribeModules = null;
  }

  showLoading();

  const modulesRef = collection(db, "modulesV2");

  const modulesQuery = query(
    modulesRef,
    where("status", "==", "published"),
    where("sectionIds", "array-contains", sectionId)
  );

  console.log("[EqualLearn Modules] Starting listener:", {
    collection: "modulesV2",
    sectionId,
    status: "published"
  });

  unsubscribeModules = onSnapshot(
    modulesQuery,

    snapshot => {
      modules = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      modules.sort((a, b) => {
        return getDate(b.publishedAt || b.createdAt) -
          getDate(a.publishedAt || a.createdAt);
      });

      updateStatistics();
      renderModules();

      console.log(
        `[EqualLearn Modules] Successfully loaded ${modules.length} module(s).`
      );
    },

    error => {
      console.error("[EqualLearn Modules] Firestore listener error:", error);

      showState(
        "🔒",
        "Unable to access modules",
        getFirestoreErrorMessage(error),
        true
      );
    }
  );
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
      resource.fileUrl;

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
        "link"
    });
  });

  return [...unique.values()];
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
   RENDER MODULES
===================================================== */

function renderModules() {
  const grid = $("moduleGrid");

  if (!grid) return;

  const search = ($("searchInput")?.value || "")
    .trim()
    .toLowerCase();

  let filtered = modules.filter(module => {
    const searchableText = [
      module.title,
      module.description,
      module.category,
      module.subject,
      module.teacherName
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(search);
  });

  if (activeFilter === "recent") {
    filtered.sort((a, b) => {
      return getDate(b.publishedAt || b.createdAt) -
        getDate(a.publishedAt || a.createdAt);
    });
  }

  grid.replaceChildren();

  if (filtered.length === 0) {
    showState(
      search ? "🔎" : "📚",

      search
        ? "No matching modules"
        : "No modules available yet",

      search
        ? "Try another keyword to find your learning materials."
        : "Your teacher has not published any modules for your section yet."
    );

    return;
  }

  filtered.forEach((module, index) => {
    grid.appendChild(createModuleCard(module, index));
  });
}

/* =====================================================
   CREATE MODULE CARD
===================================================== */

function createModuleCard(module, index) {
  const card = document.createElement("article");

  card.className = "module-card";
  card.style.animationDelay = `${Math.min(index * 60, 300)}ms`;

  /* COVER */

  const cover = document.createElement("div");
  cover.className = "module-cover";

  const circle = document.createElement("div");
  circle.className = "cover-circle";

  const label = document.createElement("div");
  label.className = "cover-label";
  label.textContent =
    module.category ||
    module.subject ||
    "LEARNING MODULE";

  const icon = document.createElement("div");
  icon.className = "cover-icon";
  icon.textContent = module.icon || "📘";

  cover.append(label, icon, circle);

  /* BODY */

  const body = document.createElement("div");
  body.className = "module-body";

  /* META */

  const meta = document.createElement("div");
  meta.className = "module-meta";

  const category = document.createElement("span");
  category.className = "category";
  category.textContent =
    module.category ||
    module.subject ||
    "GENERAL";

  const published = document.createElement("span");
  published.className = "published";
  published.textContent = "● Published";

  meta.append(category, published);

  /* TITLE */

  const title = document.createElement("h3");
  title.textContent = module.title || "Untitled Module";

  /* DESCRIPTION */

  const description = document.createElement("p");
  description.className = "module-description";
  description.textContent =
    module.description ||
    "Explore this learning module and its learning resources.";

  /* RESOURCES */

  const resources = getResources(module);

  const resourceList = document.createElement("div");
  resourceList.className = "resource-list";

  resources.slice(0, 3).forEach(resource => {
    const tag = document.createElement("span");

    tag.className = "resource-tag";
    tag.textContent = resource.label;
    tag.title = resource.label;

    resourceList.appendChild(tag);
  });

  if (resources.length > 3) {
    const more = document.createElement("span");

    more.className = "resource-tag";
    more.textContent = `+${resources.length - 3} more`;

    resourceList.appendChild(more);
  }

  /* FOOTER */

  const footer = document.createElement("div");
  footer.className = "module-footer";

  const teacher = document.createElement("span");
  teacher.className = "teacher-name";
  teacher.textContent =
    `👤 ${module.teacherName || "Your Teacher"}`;

  const openButton = document.createElement("button");
  openButton.className = "open-btn";
  openButton.type = "button";
  openButton.textContent = "View Module →";

  openButton.addEventListener("click", () => {
    openModule(module);
  });

  footer.append(teacher, openButton);

  body.append(meta, title, description);

  if (resources.length > 0) {
    body.appendChild(resourceList);
  }

  body.appendChild(footer);

  card.append(cover, body);

  return card;
}

/* =====================================================
   MODULE PREVIEW MODAL
===================================================== */

function initializeModal() {
  const closeButton = $("closeModal");
  const modal = $("moduleModal");

  if (closeButton) {
    closeButton.addEventListener("click", closeModal);
  }

  if (modal) {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

function openModule(module) {
  const modal = $("moduleModal");

  if (!modal) return;

  if ($("modalTitle")) {
    $("modalTitle").textContent =
      module.title || "Module Details";
  }

  if ($("modalDescription")) {
    $("modalDescription").textContent =
      module.description || "No description available.";
  }

  const resourceContainer = $("modalResources");

  if (resourceContainer) {
    resourceContainer.replaceChildren();

    const resources = getResources(module);

    resources.forEach(resource => {
      const url = validURL(resource.url);

      if (!url) return;

      const link = document.createElement("a");

      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const label = document.createElement("span");
      label.textContent = resource.label;

      const arrow = document.createElement("span");
      arrow.textContent = "↗";

      link.append(label, arrow);
      resourceContainer.appendChild(link);
    });

    if (resources.length === 0) {
      const note = document.createElement("p");

      note.className = "no-resources";
      note.textContent = "No additional resources attached.";

      resourceContainer.appendChild(note);
    }
  }

  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = $("moduleModal");

  if (modal) {
    modal.classList.remove("show");
  }

  document.body.style.overflow = "";
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
  stateIcon.textContent = icon;

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

window.addEventListener("beforeunload", () => {
  if (unsubscribeModules) {
    unsubscribeModules();
    unsubscribeModules = null;
  }
});
