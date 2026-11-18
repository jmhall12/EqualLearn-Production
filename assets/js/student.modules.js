
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
let activePdfObjectUrls = [];

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
  if (unsubscribeModules) {
    unsubscribeModules();
    unsubscribeModules = null;
  }

  showLoading();

  const modulesRef = collection(db, "modulesV2");

  // Match the deployed Firestore Security Rules:
  // studentProfile.sectionId must exist in document.sectionIds.
  const modulesQuery = query(
    modulesRef,
    where("status", "==", "published"),
    where("sectionIds", "array-contains", sectionId)
  );

  console.log("[EqualLearn Modules] Starting listener:", {
    collection: "modulesV2",
    sectionIds: sectionId,
    status: "published",
    uid: auth.currentUser?.uid,
    projectId: auth.app.options.projectId
  });

  unsubscribeModules = onSnapshot(
    modulesQuery,

    snapshot => {
      modules = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      modules.sort((a, b) => {
        return (
          getDate(b.publishedAt || b.createdAt) -
          getDate(a.publishedAt || a.createdAt)
        );
      });

      updateStatistics();
      renderModules();

      console.log(
        `[EqualLearn Modules] Successfully loaded ${modules.length} module(s).`
      );
    },

    error => {
      console.error("[EqualLearn Modules] Listener error:", {
        code: error?.code,
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      });

      if (modules.length > 0) {
        console.warn(
          "[EqualLearn Modules] Keeping previously loaded modules."
        );
        return;
      }

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
    $("modalTitle").textContent = module.title || "Module Details";
  }

  if ($("modalDescription")) {
    $("modalDescription").textContent =
      module.description || "No description available.";
  }

  const resourceContainer = $("modalResources");
  if (resourceContainer) {
    resourceContainer.replaceChildren();
    revokePdfObjectUrls();

    const resources = getResources(module);

    resources.forEach(resource => {
      const dataURL = resourceDataURL(resource);
      const externalURL = validURL(resource.url);
      const mime = String(resource.mimeType || "").toLowerCase();
      const fileName = String(resource.fileName || resource.label || "").toLowerCase();
      const isPdf = mime === "application/pdf" ||
        fileName.endsWith(".pdf") ||
        String(resource.type || "").toLowerCase() === "pdf";

      const item = document.createElement("section");
      item.className = "el-resource-viewer-item";
      item.style.cssText = [
        "width:100%", "margin:14px 0", "padding:12px",
        "border:1px solid rgba(255,255,255,.14)",
        "border-radius:14px", "background:rgba(255,255,255,.035)",
        "box-sizing:border-box"
      ].join(";");

      const heading = document.createElement("div");
      heading.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;";

      const name = document.createElement("strong");
      name.textContent = resource.label || resource.fileName || "Learning resource";
      name.style.cssText = "font-size:14px;overflow-wrap:anywhere;";
      heading.appendChild(name);

      const detail = document.createElement("small");
      detail.textContent = resource.fileName || (externalURL ? "External resource" : "Attachment");
      detail.style.cssText = "display:block;opacity:.7;margin-top:3px;font-size:11px;";
      const nameWrap = document.createElement("div");
      nameWrap.append(name, detail);
      heading.replaceChildren(nameWrap);

      let viewerURL = null;
      if (dataURL) {
        viewerURL = createResourceObjectURL(resource);
      } else if (externalURL) {
        viewerURL = externalURL;
      }

      if (isPdf && viewerURL) {
        const frame = document.createElement("iframe");
        frame.title = `PDF viewer: ${resource.fileName || resource.label || "document"}`;
        frame.src = viewerURL;
        frame.setAttribute("loading", "lazy");
        frame.setAttribute("allow", "fullscreen");
        frame.style.cssText = [
          "display:block", "width:100%", "height:min(70vh,760px)",
          "min-height:420px", "border:0", "border-radius:10px",
          "background:#fff"
        ].join(";");
        item.append(heading, frame);

        const fallback = document.createElement("div");
        fallback.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;";
        const openLink = document.createElement("a");
        openLink.href = viewerURL;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.textContent = "Open PDF separately ↗";
        openLink.style.cssText = "color:inherit;text-decoration:underline;font-size:13px;";
        fallback.appendChild(openLink);

        if (dataURL) {
          const download = document.createElement("a");
          download.href = viewerURL;
          download.download = resource.fileName || "equallearn-document.pdf";
          download.textContent = "Download PDF ↓";
          download.style.cssText = openLink.style.cssText;
          fallback.appendChild(download);
        }
        item.appendChild(fallback);
      } else {
        item.appendChild(heading);
        if (viewerURL) {
          const link = document.createElement("a");
          link.href = viewerURL;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = dataURL ? "Open / Download attachment ↓" : "Open resource ↗";
          if (dataURL) link.download = resource.fileName || resource.label || "equallearn-attachment";
          link.style.cssText = "display:inline-block;margin-top:8px;color:inherit;text-decoration:underline;font-size:13px;";
          item.appendChild(link);
        } else {
          const unavailable = document.createElement("p");
          unavailable.textContent = "This attachment could not be opened. Please contact your teacher.";
          item.appendChild(unavailable);
        }
      }

      resourceContainer.appendChild(item);
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

function createResourceObjectURL(resource) {
  if (!resource?.base64) return null;
  try {
    const binary = atob(resource.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: resource.mimeType || "application/octet-stream"
    });
    const objectURL = URL.createObjectURL(blob);
    activePdfObjectUrls.push(objectURL);
    return objectURL;
  } catch (error) {
    console.error("[EqualLearn] Unable to prepare attachment preview:", error);
    return null;
  }
}

function revokePdfObjectUrls() {
  activePdfObjectUrls.forEach(url => URL.revokeObjectURL(url));
  activePdfObjectUrls = [];
}

function formatResourceSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function closeModal() {
  revokePdfObjectUrls();
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
