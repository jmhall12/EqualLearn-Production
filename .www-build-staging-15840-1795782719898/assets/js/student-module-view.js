import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const moduleId = String(params.get("id") || "").trim();
const sourceCollection = String(params.get("source") || "modulesV2").trim();

const ALLOWED_COLLECTIONS = new Set(["modulesV2", "modules"]);
const objectUrls = [];

function setError(message) {
  $("moduleTitle").textContent = "Module unavailable";
  $("moduleDescription").textContent = "";
  $("moduleResources").replaceChildren();

  const state = document.createElement("div");
  state.className = "module-error";
  state.textContent = message;
  $("moduleResources").appendChild(state);
  $("resourceCountLabel").textContent = "Unavailable";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function getModuleResources(module) {
  const list = [];

  if (Array.isArray(module.resources)) list.push(...module.resources);

  if (Array.isArray(module.attachments)) {
    list.push(...module.attachments.map(file => ({
      ...file,
      url: file.url || file.fileUrl || file.fileURL || file.downloadURL || file.downloadUrl || "",
      label: file.label || file.fileName || file.name || "Lesson attachment",
      fileName: file.fileName || file.name || "Attachment",
      mimeType: file.mimeType || file.fileMimeType || "application/octet-stream",
      type: file.type || "file"
    })));
  }

  if (Array.isArray(module.resourceLinks)) list.push(...module.resourceLinks);
  if (Array.isArray(module.lessonResources)) list.push(...module.lessonResources);

  const direct = [
    { url: module.fileURL || module.fileUrl, label: module.fileName || "Open file", type: "file" },
    { url: module.pdfUrl, label: "Open PDF", type: "pdf" },
    { url: module.videoUrl, label: "Watch video", type: "video" },
    { url: module.resourceUrl, label: "Open resource", type: "link" }
  ].filter(item => item.url);

  list.push(...direct);

  const unique = new Map();

  list.forEach(resource => {
    if (!resource || typeof resource !== "object") return;

    const base64 = typeof resource.base64 === "string" ? resource.base64 : "";
    const rawUrl = resource.url || resource.href || resource.fileURL || resource.fileUrl || "";
    const label = String(resource.label || resource.name || resource.title || resource.fileName || "Learning resource");
    const fileName = String(resource.fileName || resource.name || label || "attachment");
    const mimeType = String(resource.mimeType || resource.fileMimeType || "application/octet-stream");
    const type = String(resource.type || resource.kind || "file");

    if (base64) {
      const key = `base64:${fileName}:${base64.slice(0, 48)}`;
      unique.set(key, { base64, label, fileName, mimeType, type });
      return;
    }

    const url = safeUrl(rawUrl);
    if (!url) return;
    unique.set(url, { url, label, fileName, mimeType, type });
  });

  return [...unique.values()];
}

function base64ObjectUrl(base64, mimeType) {
  const clean = String(base64 || "")
    .replace(/^data:[^,]*;base64,/i, "")
    .replace(/\s/g, "");

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function renderResources(resources) {
  const container = $("moduleResources");
  container.replaceChildren();

  $("resourceCountLabel").textContent =
    `${resources.length} resource${resources.length === 1 ? "" : "s"}`;

  if (!resources.length) {
    const empty = document.createElement("div");
    empty.className = "module-empty";
    empty.textContent = "No direct files or links are attached to this module. Check its published lessons below.";
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  resources.forEach(resource => {
    let href = "";
    try {
      href = resource.base64
        ? base64ObjectUrl(resource.base64, resource.mimeType)
        : safeUrl(resource.url);
    } catch (error) {
      console.warn("[EqualLearn Module View] Resource could not be prepared:", error);
      return;
    }

    if (!href) return;

    const row = document.createElement("div");
    row.className = "resource-row";

    const icon = document.createElement("span");
    icon.className = "resource-row-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3.5h8l4 4V20H6z"></path>
        <path d="M14 3.5V8h4M9 12h6M9 15.5h6"></path>
      </svg>
    `;

    const info = document.createElement("span");
    info.className = "resource-row-info";

    const title = document.createElement("strong");
    title.textContent = resource.label;

    const detail = document.createElement("small");
    detail.textContent = resource.fileName || resource.type || "Learning resource";
    info.append(title, detail);

    const open = document.createElement("a");
    open.className = "resource-open";
    open.href = href;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = resource.base64 ? "Open / Download" : "Open";
    if (resource.base64) open.download = resource.fileName || resource.label || "equallearn-resource";

    row.append(icon, info, open);
    fragment.appendChild(row);
  });

  if (!fragment.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "module-empty";
    empty.textContent = "The attached resources could not be opened. Please contact your teacher.";
    container.appendChild(empty);
  } else {
    container.appendChild(fragment);
  }
}

async function countPublishedLessons(sectionId) {
  const lessonQuery = query(
    collection(db, "lessons"),
    where("status", "==", "active"),
    where("reviewStatus", "==", "approved"),
    where("sectionIds", "array-contains", sectionId)
  );

  const snapshot = await getDocs(lessonQuery);
  return snapshot.docs.filter(item => {
    const data = item.data();
    return String(data.moduleId || "") === moduleId;
  }).length;
}

async function loadModule(user) {
  if (!moduleId) throw new Error("The module ID is missing.");
  if (!ALLOWED_COLLECTIONS.has(sourceCollection)) {
    throw new Error("The module source is invalid.");
  }

  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) throw new Error("Student profile was not found.");

  const profile = profileSnapshot.data();
  const role = String(profile.role || "").toLowerCase();
  const status = String(profile.status || "").toLowerCase();
  const sectionId = String(profile.sectionId || "").trim();

  if (role !== "student") throw new Error("This page is available to student accounts only.");
  if (status !== "active") throw new Error("Your student account is not active.");
  if (!sectionId) throw new Error("No section has been assigned to your account.");

  const moduleSnapshot = await getDoc(doc(db, sourceCollection, moduleId));
  if (!moduleSnapshot.exists()) throw new Error("This published module could not be found.");

  const module = { id: moduleSnapshot.id, ...moduleSnapshot.data() };
  const assignedSections = Array.isArray(module.sectionIds) ? module.sectionIds.map(String) : [];

  // Client-side visibility checks mirror the active Firestore student rules.
  // The rules remain authoritative; this is an additional UI check.
  if (!assignedSections.includes(sectionId)) {
    throw new Error("This module is not published for your assigned section.");
  }

  if (sourceCollection === "modulesV2") {
    if (String(module.status || "").toLowerCase() !== "published") {
      throw new Error("This module is not currently published.");
    }
  } else {
    if (
      String(module.status || "").toLowerCase() !== "active" ||
      String(module.reviewStatus || "").toLowerCase() !== "approved"
    ) {
      throw new Error("This module has not been approved and published for students.");
    }
  }

  $("moduleTitle").textContent = module.title || module.name || "Untitled Module";
  $("moduleDescription").textContent =
    module.description || module.content || module.moduleDescription ||
    "Your teacher has shared this learning material with your section.";

  $("moduleCategory").textContent =
    module.category || module.subject || "Published learning module";

  $("moduleTeacher").textContent =
    `Teacher: ${module.assignedTeacherName || module.teacherName || module.createdByName || "Your Teacher"}`;

  $("moduleSection").textContent = `Your section: ${profile.section || profile.sectionName || profile.course || "Assigned section"}`;
  $("moduleStatus").textContent = "Published for your section";

  const resources = getModuleResources(module);
  renderResources(resources);

  // Related lesson count is optional. A permission error in the secondary
  // lessons query must never invalidate a module that has already loaded.
  // Declare it outside the try block because it is also used by the success log.
  let lessonCount = null;
  try {
    lessonCount = await countPublishedLessons(sectionId);

    if (lessonCount > 0) {
      $("publishedLessonsSection").hidden = false;
      $("lessonCountLabel").textContent =
        `${lessonCount} published lesson${lessonCount === 1 ? "" : "s"}`;

      const link = $("openLessonsLink");
      link.href = `lesson.html?module=${encodeURIComponent(moduleId)}`;
    } else {
      $("publishedLessonsSection").hidden = true;
    }
  } catch (lessonError) {
    // Keep the successfully loaded module and its resources visible.
    // The lesson query has its own security requirements and can be fixed
    // independently without blocking access to the parent module.
    $("publishedLessonsSection").hidden = true;
    console.warn(
      "[EqualLearn Module View] Module loaded, but related lesson count is unavailable:",
      {
        code: lessonError?.code || "unknown",
        message: lessonError?.message || String(lessonError),
        moduleId,
        lessonsCollection: "lessons",
        sectionId,
        projectId: db.app?.options?.projectId || "unknown"
      }
    );
  }

  console.info("[EqualLearn Module View] Module opened:", {
    moduleId,
    sourceCollection,
    sectionId,
    resourceCount: resources.length,
    lessonCount,
    lessonCountAvailable: lessonCount !== null
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  try {
    await loadModule(user);
  } catch (error) {
    console.error("[EqualLearn Module View] Unable to load module details:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
      moduleId,
      sourceCollection,
      uid: user.uid,
      projectId: db.app?.options?.projectId || "unknown"
    });
    setError(error.message || "Unable to open this learning module.");
  }
});

window.addEventListener("beforeunload", () => {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
});
