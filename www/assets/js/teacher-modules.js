import { auth, db, storage } from "./firebase-config.js";
import { notifySectionStudents } from "./notification-service.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";

const $ = (id) => document.getElementById(id);

const moduleList = $("moduleList");
const modal = $("moduleModal");
const openModal = $("openModal");
const closeModal = $("closeModal");
const cancelEdit = $("cancelEdit");
const saveModule = $("saveModule");
const backToDashboard = $("backToDashboard");

const title = $("title");
const description = $("description");
const moduleOrder = $("moduleOrder");
const moduleStatus = $("moduleStatus");

const moduleFile = $("moduleFile");
const existingFile = $("existingFile");
const selectedFile = $("selectedFile");

const modalTitle = $("modalTitle");
const message = $("message");

const uploadProgress = $("uploadProgress");
const progressBar = $("progressBar");
const progressText = $("progressText");

const learningObjectives = $("learningObjectives");
const estimatedDuration = $("estimatedDuration");
const academicYearSelect = $("academicYearSelect");
const programSelect = $("programSelect");
const yearLevelSelect = $("yearLevelSelect");
const classSource = $("classSource");
const sectionSelect = $("sectionSelect");
const assignmentSummary = $("assignmentSummary");

const availableAt = $("availableAt");
const dueDate = $("dueDate");
const videoUrl = $("videoUrl");
const resourceUrl = $("resourceUrl");
const resourceUrlInput = $("resourceUrlInput") || resourceUrl;

const resourceLinksList = $("resourceLinksList");
const resourceToolbar = $("resourceToolbar");
const resourceNameInput = $("resourceNameInput");
const addResourceLinkBtn = $("addResourceLinkBtn");

const cameraPhotoInput = $("cameraPhotoInput");
const pickPhotoInput = $("pickPhotoInput");
const recordVideoInput = $("recordVideoInput");

const moduleSearch = $("moduleSearch");
const statusFilter = $("statusFilter");
const sortFilter = $("sortFilter");

const statTotal = $("totalModules");
const statActive = $("activeModules");
const statDraft = $("draftModules");
const statArchived = $("archivedModules");

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MODULE_CACHE_PREFIX = "equallearn:teacher:modules:v3:";

const RESOURCE_DESTINATIONS = {
  drive: "https://drive.google.com/",
  forms: "https://forms.google.com/",
  drawings: "https://docs.google.com/drawings/",
  sheets: "https://sheets.google.com/",
  slides: "https://slides.google.com/",
  docs: "https://docs.google.com/"
};

const RESOURCE_LABELS = {
  drive: "Google Drive",
  forms: "Google Forms",
  drawings: "Google Drawings",
  sheets: "Google Sheets",
  slides: "Google Slides",
  docs: "Google Docs",
  youtube: "YouTube",
  link: "External Link"
};

let currentUser = null;
let currentRole = "";
let moduleCacheKey = "";
const moduleCache = new Map();
let availableSections = [];
let resourceLinks = [];
let editingId = null;
let currentFileURL = "";
let currentFilePath = "";
let currentFileName = "";
let activeUploadTask = null;
let uploadStartedAt = 0;
let lastProgressBytes = 0;
let lastProgressTime = 0;
let openedResourceType = null;
let editorInitialSnapshot = "";
let editorSaving = false;
let navigationPending = false;

const cancelUpload = document.createElement("button");
cancelUpload.type = "button";
cancelUpload.className = "el-upload-cancel";
cancelUpload.textContent = "Cancel upload";
cancelUpload.hidden = true;
uploadProgress?.appendChild(cancelUpload);

cancelUpload.addEventListener("click", () => {
  if (!activeUploadTask) return;
  if (confirm("Cancel the current upload?")) {
    activeUploadTask.cancel();
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists()) {
      throw new Error("User profile not found.");
    }

    const role = String(profileSnap.data().role || "").trim().toLowerCase();
    if (!["teacher", "admin"].includes(role)) {
      alert("Access denied. This page is for teachers and administrators only.");
      window.location.href = role === "student" ? "../student/dashboard.html" : "../login.html";
      return;
    }

    currentUser = user;
    currentRole = role;
    moduleCacheKey = `${MODULE_CACHE_PREFIX}${user.uid}`;

    await loadAvailableSections();
    renderCachedModules();
    await loadModules();
  } catch (error) {
    console.error("Module page access error:", error);
    if (moduleList) {
      moduleList.innerHTML = `
        <div class="empty">
          Unable to verify your account permissions.
          <br>
          <small>${escapeHTML(error.message || "Unknown error")}</small>
        </div>
      `;
    }
  }
});

openModal?.addEventListener("click", () => {
  if (editorSaving) return;
  resetForm();
  editingId = null;
  modalTitle.textContent = "Create Module";
  modal?.classList.add("show");
  editorInitialSnapshot = getEditorSnapshot();
  requestAnimationFrame(() => title?.focus());
});

[moduleSearch, statusFilter, sortFilter].forEach((control) => {
  control?.addEventListener("input", applyModuleView);
  control?.addEventListener("change", applyModuleView);
});

sectionSelect?.addEventListener("change", updateAssignmentSummary);
academicYearSelect?.addEventListener("change", updateAssignmentSummary);
programSelect?.addEventListener("change", updateAssignmentSummary);
yearLevelSelect?.addEventListener("change", updateAssignmentSummary);

closeModal?.addEventListener("click", () => closeEditor("close"));
cancelEdit?.addEventListener("click", () => closeEditor("back"));
modal?.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeEditor("outside");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal?.classList.contains("show")) {
    event.preventDefault();
    closeEditor("escape");
  }
});

backToDashboard?.addEventListener("click", async () => {
  if (navigationPending) return;
  navigationPending = true;

  try {
    if (modal?.classList.contains("show")) {
      const saved = await saveDraftBeforeLeaving();
      if (!saved) {
        navigationPending = false;
        return;
      }
    }
    window.location.href = "dashboard.html";
  } catch (error) {
    console.error(error);
    navigationPending = false;
    alert("Unable to save your draft. Please try again before leaving.");
  }
});

moduleFile?.addEventListener("change", () => {
  const file = moduleFile.files?.[0];
  if (!file) {
    if (selectedFile) {
      selectedFile.style.display = "none";
      selectedFile.innerHTML = "";
    }
    return;
  }

  try {
    validateFile(file);
    if (selectedFile) {
      selectedFile.style.display = "block";
      selectedFile.innerHTML = `
        <strong>${escapeHTML(file.name)}</strong>
        <br>
        <small>${formatFileSize(file.size)} • ready to upload</small>
      `;
    }
    showMessage("File ready. It will upload when you save the module.", "info");
  } catch (error) {
    moduleFile.value = "";
    if (selectedFile) {
      selectedFile.style.display = "none";
      selectedFile.innerHTML = "";
    }
    showMessage(error.message || "Invalid file.", "error");
  }
});

resourceToolbar?.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-resource]");
  if (!tile) return;

  const type = tile.dataset.resource;

  if (RESOURCE_DESTINATIONS[type]) {
    if (openedResourceType === type) {
      requestResourceLink(type);
      openedResourceType = null;
    } else {
      openResourceWebsite(type);
    }
    return;
  }

  if (type === "youtube") {
    const url = prompt("Paste the YouTube video link:");
    if (url === null || !url.trim()) return;
    confirmAndAttachResource("youtube", url);
    return;
  }

  if (type === "link") {
    const url = prompt("Enter the website or resource URL:");
    if (url === null || !url.trim()) return;
    confirmAndAttachResource("link", url);
    return;
  }

  if (type === "pdf") {
    if (moduleFile) {
      moduleFile.accept = ".pdf,application/pdf";
      moduleFile.dataset.resourceMode = "pdf";
      moduleFile.click();
    }
    return;
  }

  if (type === "upload") {
    if (moduleFile) {
      moduleFile.accept = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov";
      moduleFile.dataset.resourceMode = "upload";
      moduleFile.click();
    }
    return;
  }

  if (type === "camera") {
    cameraPhotoInput?.click();
    return;
  }

  if (type === "photo") {
    pickPhotoInput?.click();
    return;
  }

  if (type === "record") {
    recordVideoInput?.click();
  }
});

addResourceLinkBtn?.addEventListener("click", () => {
  const name = resourceNameInput?.value.trim() || "";
  const url = (resourceUrlInput?.value || resourceUrl?.value || "").trim();

  if (!name) {
    showMessage("Please enter a resource name.", "error");
    resourceNameInput?.focus();
    return;
  }

  if (!url) {
    showMessage("Please paste the resource URL.", "error");
    (resourceUrlInput || resourceUrl)?.focus();
    return;
  }

  confirmAndAttachResource("link", url, name);
});

cameraPhotoInput?.addEventListener("change", () => {
  const file = cameraPhotoInput.files?.[0];
  attachChosenFile(file, "camera");
  cameraPhotoInput.value = "";
});

pickPhotoInput?.addEventListener("change", () => {
  const file = pickPhotoInput.files?.[0];
  attachChosenFile(file, "photo");
  pickPhotoInput.value = "";
});

recordVideoInput?.addEventListener("change", () => {
  const file = recordVideoInput.files?.[0];
  attachChosenFile(file, "record");
  recordVideoInput.value = "";
});

saveModule?.addEventListener("click", async () => {
  if (editorSaving) return;
  await saveModuleRecord("active");
});

function openResourceWebsite(type) {
  const destination = RESOURCE_DESTINATIONS[type];
  if (!destination) return;

  const opened = window.open(destination, "_blank", "noopener,noreferrer");
  if (!opened) {
    showMessage("Popup blocked. Please allow popups for EqualLearn.", "error");
    return;
  }

  openedResourceType = type;
  showMessage(
    `${RESOURCE_LABELS[type]} opened in a new tab. Copy your resource link and add it to this module.`,
    "info"
  );
}

function confirmAndAttachResource(type, url, customLabel = "") {
  try {
    const parsed = new URL(String(url || "").trim());

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Only valid HTTP or HTTPS links are allowed.");
    }

    if (type === "youtube" && !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("Please enter a valid YouTube URL.");
    }

    const label = String(customLabel || "").trim() || RESOURCE_LABELS[type] || "External Link";
    if (resourceLinks.some((item) => item.url === parsed.href)) {
      throw new Error("This resource link has already been added.");
    }

    const confirmed = confirm(`Confirm this ${label} resource?\n\n${parsed.href}\n\nAttach it to this module?`);
    if (!confirmed) return;

    if (type === "youtube") {
      if (videoUrl) videoUrl.value = parsed.href;
    } else if (type === "link") {
      if (resourceUrlInput) resourceUrlInput.value = parsed.href;
      if (resourceUrl) resourceUrl.value = parsed.href;
    } else {
      resourceLinks.push({ type, label, url: parsed.href });
      renderResourceLinks();
    }

    showMessage(`${label} attached successfully.`, "success");
  } catch (error) {
    showMessage(error.message || "Please enter a valid URL.", "error");
  }
}

function requestResourceLink(type) {
  const label = RESOURCE_LABELS[type] || "Resource";
  const url = prompt(`Paste the ${label} share link here:`);
  if (url === null || !url.trim()) return;
  confirmAndAttachResource(type, url);
}

function attachChosenFile(file) {
  if (!file) return;

  try {
    validateFile(file);
    const confirmed = confirm(`Selected file:\n\n${file.name}\n${formatFileSize(file.size)}\n\nAttach this file to your module?`);
    if (!confirmed) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);

    if (moduleFile) {
      moduleFile.files = transfer.files;
      moduleFile.dispatchEvent(new Event("change", { bubbles: true }));
    }

    showMessage(`${file.name} confirmed. It will upload when you save the module.`, "success");
  } catch (error) {
    showMessage(error.message || "Invalid file.", "error");
  }
}

function showMessage(text, type = "info") {
  if (!message) return;
  message.textContent = text;
  message.className = `message ${type}`;
}

function validateOptionalURL(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();

    if (label === "YouTube video" && !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname.toLowerCase())) {
      showMessage("Please enter a valid YouTube URL.", "error");
      return false;
    }

    return parsed.href;
  } catch (_) {
    showMessage(`${label} URL must be a valid http:// or https:// link.`, "error");
    return false;
  }
}

function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File is too large. Maximum size is 20 MB.");
  }

  const allowed = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime"
  ]);

  const ext = file.name.split(".").pop()?.toLowerCase();
  const allowedExt = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "jpg", "jpeg", "png", "webp", "mp4", "webm", "mov"]);

  if (file.type && !allowed.has(file.type) && !file.type.startsWith("video/") && !allowedExt.has(ext)) {
    throw new Error("This file type is not supported.");
  }
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatRate(bytesPerSecond) {
  return bytesPerSecond > 0 ? `${formatFileSize(bytesPerSecond)}/s` : "starting…";
}

function formatEta(seconds) {
  const s = Math.max(1, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function sortModules(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0);
}

async function loadAvailableSections() {
  if (!sectionSelect || !currentUser) return;

  try {
    const sectionsRef = collection(db, "sections");
    const sectionsQuery = currentRole === "admin"
      ? sectionsRef
      : query(sectionsRef, where("teacherIds", "array-contains", currentUser.uid));

    const snap = await getDocs(sectionsQuery);
    availableSections = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

    const currentValue = sectionSelect.value;
    sectionSelect.replaceChildren();

    availableSections.forEach((section) => {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = getSectionLabel(section);
      option.dataset.course = section.program || section.course || section.programName || section.courseName || "";
      option.dataset.year = String(section.yearLevel || section.year || section.level || "");
      option.dataset.academicYear = section.academicYear || section.schoolYear || "";
      sectionSelect.appendChild(option);
    });

    if (currentValue) sectionSelect.value = currentValue;
    populateAcademicYears();
    updateAssignmentSummary();
  } catch (error) {
    console.warn("Section list unavailable:", error);
    if (assignmentSummary) {
      assignmentSummary.textContent = "Section list could not be loaded. Check the sections Firestore rules and teacher assignment.";
    }
  }
}

function populateAcademicYears() {
  if (!academicYearSelect) return;
  const existing = academicYearSelect.value;
  const values = [...new Set(availableSections.map((section) => String(section.academicYear || section.schoolYear || "").trim()).filter(Boolean))].sort();

  academicYearSelect.replaceChildren(new Option("Select academic year", ""));
  values.forEach((value) => academicYearSelect.add(new Option(value, value)));
  if (values.includes(existing)) academicYearSelect.value = existing;
}

function getSectionLabel(section) {
  const course = section.program || section.course || section.programName || section.courseName || "";
  const year = section.yearLevel || section.year || section.level || "";
  const sectionName = section.sectionName || section.name || section.code || section.section || "";
  const parts = [];

  if (course) parts.push(String(course));
  if (year) parts.push(String(year).toLowerCase().includes("year") ? String(year) : `Year ${year}`);
  if (sectionName) parts.push(String(sectionName));

  return parts.length ? parts.join(" • ") : `Section ${section.id?.slice(0, 6) || ""}`;
}

function getSelectedSectionRecords() {
  const selectedIds = new Set([...(sectionSelect?.selectedOptions || [])].map((option) => option.value));
  return availableSections.filter((section) => selectedIds.has(section.id));
}

function updateAssignmentSummary() {
  if (!assignmentSummary) return;
  const selected = getSelectedSectionRecords();

  if (!selected.length) {
    assignmentSummary.textContent = "No class sections selected yet.";
    return;
  }

  const labels = selected.map((section) => {
    const course = section.program || section.course || section.programName || section.courseName || "";
    const year = section.yearLevel || section.year || section.level || "";
    const sectionName = section.sectionName || section.name || section.code || section.section || "";
    return [course, year ? `Year ${year}` : "", sectionName].filter(Boolean).join(" ");
  });

  assignmentSummary.textContent = `${selected.length} section(s): ${[...new Set(labels)].join(" | ")}`;
}

function getSelectedSectionIds() {
  return [...(sectionSelect?.selectedOptions || [])].map((option) => option.value).filter(Boolean);
}

function getFilteredModules(items) {
  const term = (moduleSearch?.value || "").trim().toLowerCase();
  const status = statusFilter?.value || "all";
  const sort = sortFilter?.value || "order";

  const filtered = items.filter((item) => {
    const itemStatus = item.status || "draft";
    const matchesStatus = status === "all" || itemStatus === status;
    const sectionText = getModuleSectionText(item);
    const haystack = [item.title, item.description, item.academicYear, sectionText].join(" ").toLowerCase();
    return matchesStatus && (!term || haystack.includes(term));
  });

  filtered.sort((a, b) => {
    if (sort === "newest") return timestampValue(b.createdAt) - timestampValue(a.createdAt);
    if (sort === "oldest") return timestampValue(a.createdAt) - timestampValue(b.createdAt);
    if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""));
    return sortModules(a, b);
  });

  return filtered;
}

function getModuleSectionText(data) {
  const ids = data.sectionIds || [];
  return ids.map((id) => {
    const section = availableSections.find((item) => item.id === id);
    return section ? getSectionLabel(section) : id;
  }).join(" ");
}

function applyModuleView() {
  renderModules([...moduleCache.values()]);
}

function updateModuleStats(items) {
  if (statTotal) statTotal.textContent = items.length;
  if (statActive) statActive.textContent = items.filter((item) => item.status === "active").length;
  if (statDraft) statDraft.textContent = items.filter((item) => item.status === "draft" || !item.status).length;
  if (statArchived) statArchived.textContent = items.filter((item) => item.status === "archived").length;
}

async function loadModules({ quiet = false } = {}) {
  if (!currentUser || !currentRole) return;

  if (!quiet && moduleCache.size === 0 && moduleList) {
    moduleList.innerHTML = `
      <div class="loading">
        <span class="el-inline-spinner"></span>
        <strong>Loading modules…</strong>
        <small>Syncing the latest content</small>
      </div>
    `;
  }

  try {
    const modulesQuery = currentRole === "admin"
      ? query(collection(db, "modules"), orderBy("order", "asc"))
      : query(collection(db, "modules"), where("createdBy", "==", currentUser.uid), orderBy("order", "asc"));

    const snapshot = await getDocs(modulesQuery);
    moduleCache.clear();

    snapshot.forEach((item) => {
      moduleCache.set(item.id, { id: item.id, ...item.data() });
    });

    saveModuleCache();
    renderModules([...moduleCache.values()]);
  } catch (error) {
    console.error("Load modules error:", error);
    if (moduleCache.size === 0 && moduleList) {
      moduleList.innerHTML = `
        <div class="empty">
          Unable to load modules.
          <br>
          <small>${escapeHTML(error.message || "Unknown error")}</small>
        </div>
      `;
    }
  }
}

function renderCachedModules() {
  if (!moduleCacheKey) return;

  try {
    const cached = JSON.parse(localStorage.getItem(moduleCacheKey) || "[]");
    if (!Array.isArray(cached) || !cached.length) return;

    cached.forEach((item) => {
      if (item?.id) moduleCache.set(item.id, item);
    });

    renderModules([...moduleCache.values()].sort(sortModules), true);
  } catch (_) {}
}

function saveModuleCache() {
  if (!moduleCacheKey) return;

  try {
    const safe = [...moduleCache.values()].map((item) => ({
      id: item.id,
      title: item.title || "",
      description: item.description || "",
      order: item.order || 1,
      status: item.status || "draft",
      fileURL: item.fileURL || "",
      filePath: item.filePath || "",
      fileName: item.fileName || "",
      createdBy: item.createdBy || "",
      learningObjectives: item.learningObjectives || "",
      estimatedDuration: item.estimatedDuration || "",
      academicYear: item.academicYear || "",
      program: item.program || "",
      yearLevel: item.yearLevel || "",
      sectionIds: Array.isArray(item.sectionIds) ? item.sectionIds : [],
      classSource: item.classSource || "all",
      availableAt: item.availableAt || "",
      dueDate: item.dueDate || "",
      videoUrl: item.videoUrl || "",
      resourceUrl: item.resourceUrl || "",
      resourceLinks: Array.isArray(item.resourceLinks) ? item.resourceLinks : []
    }));

    localStorage.setItem(moduleCacheKey, JSON.stringify(safe));
  } catch (_) {}
}

function renderModules(items, fromCache = false) {
  const allItems = [...items];
  updateModuleStats(allItems);
  const sorted = getFilteredModules(allItems);

  if (!sorted.length) {
    if (moduleList) {
      moduleList.innerHTML = `
        <div class="empty">
          <strong>No modules yet.</strong>
          <br>
          <small>${allItems.length ? "No modules match your current search or filters." : "Click + Create Module to add learning content."}</small>
        </div>
      `;
    }
    return;
  }

  const fragment = document.createDocumentFragment();

  sorted.forEach((data) => {
    const card = document.createElement("article");
    card.className = "module-card";
    card.dataset.id = data.id;

    const status = data.status || "draft";
    const sectionText = getModuleSectionText(data);
    const fileLabel = data.fileName ? escapeHTML(data.fileName) : "No attachment";

    const fileHTML = data.fileURL ? `
      <a class="file-link" href="${escapeAttribute(data.fileURL)}" target="_blank" rel="noopener noreferrer">
        <span class="file-icon">↗</span>
        <span>
          <strong>${escapeHTML(data.fileName || "Open Module File")}</strong>
          <br>
          <small>Open attachment</small>
        </span>
      </a>
    ` : "";

    const resourceHTML = Array.isArray(data.resourceLinks) && data.resourceLinks.length ? data.resourceLinks.map((item) => `
      <a class="file-link" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">
        ${resourceIcon(item.type)} ${escapeHTML(item.label || "Open resource")}
      </a>
    `).join("") : "";

    card.innerHTML = `
      <div class="module-top">
        <h3 class="module-title">${escapeHTML(data.title || "Untitled Module")}</h3>
        <span class="status ${escapeAttribute(status)}">${escapeHTML(status)}</span>
      </div>

      <p class="module-description">${escapeHTML(data.description || "No description.")}</p>

      <div class="module-meta-chips">
        ${data.program ? `<span>${escapeHTML(data.program)}</span>` : ""}
        ${data.yearLevel ? `<span>Year ${escapeHTML(data.yearLevel)}</span>` : ""}
        ${Array.isArray(data.sectionIds) && data.sectionIds.length ? `<span>${data.sectionIds.length} section(s)</span>` : ""}
        ${data.estimatedDuration ? `<span>${escapeHTML(data.estimatedDuration)} min</span>` : ""}
      </div>

      ${data.dueDate ? `<p class="module-deadline">Due: ${escapeHTML(formatDateTime(data.dueDate))}</p>` : ""}

      <div class="module-card-meta">
        <span><strong>Sections:</strong> ${escapeHTML(sectionText || "Not assigned")}</span>
        <span><strong>Attachment:</strong> ${fileLabel}</span>
      </div>

      ${fileHTML}
      ${resourceHTML}
      ${data.videoUrl ? `<a class="file-link" href="${escapeAttribute(data.videoUrl)}" target="_blank" rel="noopener noreferrer">▶ Open YouTube video</a>` : ""}
      ${data.resourceUrl ? `<a class="file-link" href="${escapeAttribute(data.resourceUrl)}" target="_blank" rel="noopener noreferrer">↗ Open external resource</a>` : ""}

      <div class="module-info">
        Display order
        <strong>${Number(data.order) || "-"}</strong>
        ${fromCache ? '<span class="el-cache-label">cached</span>' : ""}
      </div>

      <div class="module-actions">
        <button type="button" class="edit-btn" data-action="edit" data-id="${escapeAttribute(data.id)}">Edit</button>
        <button type="button" class="delete-btn" data-action="delete" data-id="${escapeAttribute(data.id)}">Delete</button>
      </div>
    `;

    fragment.appendChild(card);
  });

  moduleList.replaceChildren(fragment);
}

function resourceIcon(type) {
  const icons = {
    drive: "🔺",
    youtube: "▶",
    link: "↗",
    forms: "▤",
    drawings: "✎",
    sheets: "▦",
    slides: "▣",
    docs: "▤",
    pdf: "PDF"
  };
  return icons[type] || "↗";
}

moduleList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest(".module-card");
  const id = card?.dataset.id || button.dataset.id;
  if (!id) return;

  if (button.dataset.action === "edit") {
    editModule(id);
  }

  if (button.dataset.action === "delete") {
    deleteModule(id);
  }
});

async function editModule(id) {
  try {
    if (!currentUser || !["teacher", "admin"].includes(currentRole)) {
      throw new Error("You are not authorized to edit modules.");
    }

    let selectedData = moduleCache.get(id);
    if (!selectedData) {
      const snap = await getDoc(doc(db, "modules", id));
      if (!snap.exists()) throw new Error("Module not found.");
      selectedData = { id: snap.id, ...snap.data() };
      moduleCache.set(id, selectedData);
    }

    if (currentRole !== "admin" && selectedData.createdBy !== currentUser.uid) {
      throw new Error("You can edit only modules you created.");
    }

    editingId = id;

    title.value = selectedData.title || "";
    description.value = selectedData.description || "";
    moduleOrder.value = selectedData.order || "";
    moduleStatus.value = selectedData.status || "draft";

    if (learningObjectives) learningObjectives.value = selectedData.learningObjectives || "";
    if (estimatedDuration) estimatedDuration.value = selectedData.estimatedDuration || "";
    if (academicYearSelect) academicYearSelect.value = selectedData.academicYear || "";
    if (programSelect) programSelect.value = selectedData.program || "";
    if (yearLevelSelect) yearLevelSelect.value = selectedData.yearLevel || "";
    if (classSource) classSource.value = selectedData.classSource || "all";
    if (availableAt) availableAt.value = selectedData.availableAt ? toDateTimeLocalValue(selectedData.availableAt) : "";
    if (dueDate) dueDate.value = selectedData.dueDate ? toDateTimeLocalValue(selectedData.dueDate) : "";
    if (videoUrl) videoUrl.value = selectedData.videoUrl || "";
    if (resourceUrlInput) resourceUrlInput.value = selectedData.resourceUrl || "";
    if (resourceUrl) resourceUrl.value = selectedData.resourceUrl || "";

    resourceLinks = Array.isArray(selectedData.resourceLinks)
      ? selectedData.resourceLinks.filter((item) => item && typeof item.url === "string").map((item) => {
          try {
            const parsed = new URL(item.url);
            if (!["https:", "http:"].includes(parsed.protocol)) return null;
            return {
              type: String(item.type || "link"),
              label: String(item.label || "Resource link"),
              url: parsed.href
            };
          } catch (_) {
            return null;
          }
        }).filter(Boolean)
      : [];

    renderResourceLinks();

    if (sectionSelect) {
      const selectedIds = new Set(selectedData.sectionIds || []);
      [...sectionSelect.options].forEach((option) => {
        option.selected = selectedIds.has(option.value);
      });
    }

    updateAssignmentSummary();
    currentFileURL = selectedData.fileURL || "";
    currentFilePath = selectedData.filePath || "";
    currentFileName = selectedData.fileName || "";

    if (selectedFile) {
      selectedFile.style.display = "none";
      selectedFile.innerHTML = "";
    }

    if (existingFile) {
      existingFile.style.display = currentFileURL ? "block" : "none";
      existingFile.innerHTML = currentFileURL ? `
        <strong>Current attachment</strong>
        <br>
        ${escapeHTML(currentFileName || "Attached file")}
        <br>
        <a href="${escapeAttribute(currentFileURL)}" target="_blank" rel="noopener noreferrer">Open file →</a>
        <br>
        <small>Select a new file only if you want to replace it.</small>
      ` : "";
    }

    modalTitle.textContent = "Edit Module";
    modal?.classList.add("show");
    editorInitialSnapshot = getEditorSnapshot();
    requestAnimationFrame(() => title?.focus());
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to load module.");
  }
}

window.editModule = editModule;

async function deleteModule(id) {
  if (!currentUser || !["teacher", "admin"].includes(currentRole)) {
    alert("You are not authorized to delete modules.");
    return;
  }

  const data = moduleCache.get(id);
  if (!confirm(`Delete "${data?.title || "this module"}"?`)) return;

  try {
    let target = data;
    if (!target) {
      const snap = await getDoc(doc(db, "modules", id));
      target = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }

    if (!target) throw new Error("Module not found.");
    if (currentRole !== "admin" && target.createdBy !== currentUser.uid) {
      throw new Error("You can delete only modules you created.");
    }

    await deleteDoc(doc(db, "modules", id));
    moduleCache.delete(id);
    saveModuleCache();
    renderModules([...moduleCache.values()]);

    if (target?.filePath) {
      deleteObject(ref(storage, target.filePath)).catch((error) => {
        console.warn("Storage cleanup skipped:", error);
      });
    }
  } catch (error) {
    console.error("Delete module error:", error);
    alert(error.message || "Unable to delete module.");
  }
}

window.deleteModule = deleteModule;

function renderResourceLinks() {
  if (!resourceLinksList) return;
  resourceLinksList.replaceChildren();

  resourceLinks.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "resource-link-row";

    const info = document.createElement("span");
    info.textContent = `${item.label}: ${item.url}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      resourceLinks.splice(index, 1);
      renderResourceLinks();
    });

    row.append(info, remove);
    resourceLinksList.appendChild(row);
  });
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function getEditorSnapshot() {
  const selectedSections = [...(sectionSelect?.selectedOptions || [])].map((option) => option.value);
  return JSON.stringify({
    title: title?.value || "",
    description: description?.value || "",
    order: moduleOrder?.value || "",
    objectives: learningObjectives?.value || "",
    duration: estimatedDuration?.value || "",
    sections: selectedSections,
    availableAt: availableAt?.value || "",
    dueDate: dueDate?.value || "",
    videoUrl: videoUrl?.value || "",
    resourceUrl: (resourceUrlInput?.value || resourceUrl?.value || "").trim(),
    resources: resourceLinks,
    selectedFile: moduleFile?.files?.[0]?.name || "",
    selectedFileSize: moduleFile?.files?.[0]?.size || 0,
    currentFileURL,
    currentFilePath
  });
}

function hasEditorChanges() {
  return getEditorSnapshot() !== editorInitialSnapshot;
}

async function saveDraftBeforeLeaving() {
  if (!hasEditorChanges()) return true;

  const shouldSave = confirm("You have unsaved changes. Save them as a draft before leaving?");
  if (!shouldSave) {
    const discard = confirm("Discard your unsaved changes?");
    return discard;
  }

  try {
    await saveModuleRecord("draft");
    showMessage("Draft saved successfully.", "success");
    return true;
  } catch (error) {
    console.error(error);
    alert(error.message || "Unable to save draft.");
    return false;
  }
}

async function closeEditor(reason = "close") {
  if (!modal?.classList.contains("show")) return;
  if (editorSaving) return;

  if (reason !== "saved") {
    const saved = await saveDraftBeforeLeaving();
    if (!saved) return;
  }

  modal.classList.remove("show");
  resetForm();
  editingId = null;
  editorInitialSnapshot = "";
}

function resetForm() {
  editingId = null;
  currentFileURL = "";
  currentFilePath = "";
  currentFileName = "";

  if (title) title.value = "";
  if (description) description.value = "";
  if (moduleOrder) moduleOrder.value = "";
  if (moduleStatus) moduleStatus.value = "draft";

  if (learningObjectives) learningObjectives.value = "";
  if (estimatedDuration) estimatedDuration.value = "";
  if (academicYearSelect) academicYearSelect.value = "";
  if (programSelect) programSelect.value = "";
  if (yearLevelSelect) yearLevelSelect.value = "";
  if (classSource) classSource.value = "all";
  if (availableAt) availableAt.value = "";
  if (dueDate) dueDate.value = "";
  if (videoUrl) videoUrl.value = "";
  if (resourceUrl) resourceUrl.value = "";
  if (resourceUrlInput) resourceUrlInput.value = "";
  if (resourceNameInput) resourceNameInput.value = "";

  resourceLinks = [];
  renderResourceLinks();

  if (sectionSelect) {
    [...sectionSelect.options].forEach((option) => {
      option.selected = false;
    });
  }

  updateAssignmentSummary();

  if (moduleFile) {
    moduleFile.value = "";
    moduleFile.disabled = false;
    moduleFile.accept = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov";
  }

  if (existingFile) {
    existingFile.style.display = "none";
    existingFile.innerHTML = "";
  }

  if (selectedFile) {
    selectedFile.style.display = "none";
    selectedFile.innerHTML = "";
  }

  if (cameraPhotoInput) cameraPhotoInput.value = "";
  if (pickPhotoInput) pickPhotoInput.value = "";
  if (recordVideoInput) recordVideoInput.value = "";

  if (progressBar) progressBar.style.width = "0%";
  if (progressText) progressText.textContent = "Ready to upload";
  showUploadPanel(false);

  if (message) {
    message.textContent = "";
    message.className = "message";
  }

  activeUploadTask = null;
  editorInitialSnapshot = "";
  setEditorBusy(false);
}

function setEditorBusy(busy, label = "Saving…") {
  if (saveModule) {
    saveModule.disabled = busy;
    saveModule.textContent = busy ? label : "Publish Module";
  }

  if (moduleFile) moduleFile.disabled = busy;
  if (title) title.disabled = busy;
  if (description) description.disabled = busy;
  if (moduleOrder) moduleOrder.disabled = busy;
  if (moduleStatus) moduleStatus.disabled = busy;
  if (closeModal) closeModal.disabled = busy;
  if (cancelEdit) cancelEdit.disabled = busy;

  modal?.classList.toggle("is-busy", busy);
}

function showUploadPanel(show) {
  if (uploadProgress) uploadProgress.style.display = show ? "block" : "none";
  if (cancelUpload) cancelUpload.hidden = !show;
}

function updateUploadProgress(bytes, total) {
  const now = performance.now();
  const percent = total ? Math.min(100, (bytes / total) * 100) : 0;
  const totalSeconds = Math.max((now - uploadStartedAt) / 1000, 0.25);
  const averageRate = bytes / totalSeconds;
  const intervalSeconds = Math.max((now - lastProgressTime) / 1000, 0.05);
  const instantRate = (bytes - lastProgressBytes) / intervalSeconds;
  const rate = instantRate > 0 ? averageRate * 0.55 + instantRate * 0.45 : averageRate;
  const remaining = Math.max(total - bytes, 0);
  const eta = rate > 0 ? remaining / rate : 0;

  if (progressBar) progressBar.style.width = `${percent.toFixed(1)}%`;
  if (progressText) {
    progressText.textContent = `${Math.round(percent)}% • ${formatFileSize(bytes)} of ${formatFileSize(total)} • ${formatRate(rate)}${eta > 1 ? ` • ${formatEta(eta)} left` : ""}`;
  }
  if (saveModule) {
    saveModule.textContent = percent < 100 ? `Uploading ${Math.round(percent)}%` : "Saving module…";
  }

  lastProgressBytes = bytes;
  lastProgressTime = now;
}

async function uploadModuleFile(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `modules/${auth.currentUser.uid}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: { originalName: file.name }
  });

  activeUploadTask = task;
  uploadStartedAt = performance.now();
  lastProgressTime = uploadStartedAt;
  lastProgressBytes = 0;
  showUploadPanel(true);

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        updateUploadProgress(snapshot.bytesTransferred, snapshot.totalBytes);
      },
      reject,
      async () => {
        try {
          if (progressBar) progressBar.style.width = "100%";
          if (progressText) progressText.textContent = "Upload complete. Saving module…";
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, path });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

async function saveModuleRecord(status) {
  if (!currentUser) {
    showMessage("Please sign in first.", "error");
    return false;
  }

  if (editorSaving) return false;

  const moduleTitle = title?.value.trim() || "";
  const moduleDescription = description?.value.trim() || "";
  const order = Number(moduleOrder?.value);
  const file = moduleFile?.files?.[0] || null;

  if (moduleTitle.length < 3) {
    showMessage("Please enter a module title with at least 3 characters.", "error");
    title?.focus();
    return false;
  }

  if (!moduleDescription) {
    showMessage("Please enter a description.", "error");
    description?.focus();
    return false;
  }

  if (!Number.isFinite(order) || order < 1) {
    showMessage("Please enter a valid display order.", "error");
    moduleOrder?.focus();
    return false;
  }

  if (file) {
    try {
      validateFile(file);
    } catch (error) {
      showMessage(error.message || "Invalid file.", "error");
      return false;
    }
  }

  const safeVideoUrl = validateOptionalURL(videoUrl?.value, "YouTube video");
  if (safeVideoUrl === false) return false;

  const safeResourceUrl = validateOptionalURL((resourceUrlInput?.value || resourceUrl?.value || ""), "Resource");
  if (safeResourceUrl === false) return false;

  const availableValue = availableAt?.value || "";
  const dueValue = dueDate?.value || "";
  if (availableValue && dueValue && new Date(dueValue) < new Date(availableValue)) {
    showMessage("Due date must be later than the availability date.", "error");
    return false;
  }

  const selectedSectionIds = getSelectedSectionIds();
  if (!selectedSectionIds.length) {
    showMessage("Please assign this module to at least one section.", "error");
    sectionSelect?.focus();
    return false;
  }

  editorSaving = true;
  setEditorBusy(true, file ? "Preparing upload…" : status === "active" ? "Publishing…" : "Saving draft…");

  const oldFilePath = currentFilePath;

  try {
    let fileURL = currentFileURL;
    let filePath = currentFilePath;
    let fileName = currentFileName;

    if (file) {
      const uploaded = await uploadModuleFile(file);
      fileURL = uploaded.url;
      filePath = uploaded.path;
      fileName = file.name;
    }

    const payload = {
      title: moduleTitle,
      description: moduleDescription,
      order,
      status,
      fileURL: fileURL || "",
      filePath: filePath || "",
      fileName: fileName || "",
      learningObjectives: learningObjectives?.value.trim() || "",
      estimatedDuration: estimatedDuration?.value || "",
      academicYear: academicYearSelect?.value || "",
      program: programSelect?.value || "",
      yearLevel: yearLevelSelect?.value || "",
      sectionIds: selectedSectionIds,
      classSource: classSource?.value || "all",
      availableAt: availableValue ? new Date(availableValue) : null,
      dueDate: dueValue ? new Date(dueValue) : null,
      videoUrl: safeVideoUrl || "",
      resourceUrl: safeResourceUrl || "",
      resourceLinks: Array.isArray(resourceLinks) ? resourceLinks.map((item) => ({ ...item })) : [],
      updatedAt: serverTimestamp()
    };

    let savedId = editingId;
    let previousData = {};

    if (editingId) {
      const moduleRef = doc(db, "modules", editingId);
      const existingSnap = await getDoc(moduleRef);
      if (!existingSnap.exists()) throw new Error("Module not found.");

      previousData = existingSnap.data();
      if (currentRole !== "admin" && previousData.createdBy !== currentUser.uid) {
        throw new Error("You can edit only your own modules.");
      }

      await updateDoc(moduleRef, payload);
    } else {
      const created = await addDoc(collection(db, "modules"), {
        ...payload,
        createdBy: currentUser.uid,
        createdByRole: currentRole,
        status,
        createdAt: serverTimestamp()
      });
      savedId = created.id;
    }

    const cachePrevious = moduleCache.get(savedId) || previousData || {};
    moduleCache.set(savedId, {
      ...cachePrevious,
      id: savedId,
      ...payload,
      createdBy: cachePrevious.createdBy || currentUser.uid,
      createdByRole: cachePrevious.createdByRole || currentRole,
      updatedAt: Date.now()
    });

    saveModuleCache();

    if (file && oldFilePath && oldFilePath !== filePath) {
      deleteObject(ref(storage, oldFilePath)).catch((error) => {
        console.warn("Old file cleanup skipped:", error);
      });
    }

    if (status === "active") {
      try {
        const notificationResult = await notifySectionStudents({
          db,
          auth,
          sectionIds: selectedSectionIds,
          contentType: "module",
          contentId: savedId,
          contentTitle: moduleTitle,
          teacherName: currentUser.displayName || currentUser.email || "Your teacher"
        });

        console.info("MODULE NOTIFICATIONS:", notificationResult);
      } catch (error) {
        console.warn("Module notification failed:", error);
      }
    }

    showMessage(status === "active" ? "Module published successfully." : "Draft saved successfully.", "success");
    modal?.classList.remove("show");
    resetForm();
    await loadModules({ quiet: true });
    return true;
  } catch (error) {
    console.error("Save module error:", error);
    showMessage(readableUploadError(error), "error");
    return false;
  } finally {
    activeUploadTask = null;
    editorSaving = false;
    setEditorBusy(false);
  }
}

function readableUploadError(error) {
  if (error?.code === "storage/canceled") return "Upload canceled. Your module was not changed.";
  if (error?.code === "storage/unauthorized") return "Upload permission denied. Check Firebase Storage rules.";
  if (error?.code === "storage/retry-limit-exceeded") return "The connection timed out. Please try the upload again.";
  if (error?.code === "permission-denied") return "Firestore permission denied. Check your Firestore Security Rules.";
  return error?.message || "Unable to save the module.";
}

window.saveModule = saveModuleRecord;
window.moduleCache = moduleCache;
window.renderModules = renderModules;
window.editModule = editModule;
window.deleteModule = deleteModule;
window.loadModules = loadModules;
