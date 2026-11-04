import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

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

// Advanced module metadata fields already present in teacher-modules.html
const learningObjectives = $("learningObjectives");
const estimatedDuration = $("estimatedDuration");
const academicYearSelect = $("academicYearSelect");
const programSelect = $("programSelect");
const yearLevelSelect = $("yearLevelSelect");
const sectionSelect = $("sectionSelect");
const classSource = $("classSource");
const assignmentSummary = $("assignmentSummary");
const availableAt = $("availableAt");
const dueDate = $("dueDate");
const videoUrl = $("videoUrl");
const resourceUrl = $("resourceUrl");
const resourceLinksList = $("resourceLinksList");
const cameraPhotoInput = $("cameraPhotoInput");
const pickPhotoInput = $("pickPhotoInput");
const recordVideoInput = $("recordVideoInput");
let resourceLinks = [];
const moduleSearch = $("moduleSearch");
const statusFilter = $("statusFilter");
const sortFilter = $("sortFilter");
const statTotal = $("totalModules");
const statActive = $("activeModules");
const statDraft = $("draftModules");
const statArchived = $("archivedModules");
let availableSections = [];

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MODULE_CACHE_PREFIX = "equallearn:teacher:modules:v3:";

let currentUser = null;
let currentRole = "";
let moduleCacheKey = "";

const moduleCache = new Map();

let editingId = null;
let currentFileURL = "";
let currentFilePath = "";
let currentFileName = "";
let activeUploadTask = null;
let uploadStartedAt = 0;
let lastProgressBytes = 0;
let lastProgressTime = 0;

// CANCEL UPLOAD BUTTON
const cancelUpload = document.createElement("button");

cancelUpload.type = "button";
cancelUpload.className = "el-upload-cancel";
cancelUpload.textContent = "Cancel upload";
cancelUpload.hidden = true;

uploadProgress?.appendChild(cancelUpload);

cancelUpload.addEventListener("click", () => {
  activeUploadTask?.cancel();
});

// AUTHENTICATION AND ROLE VERIFICATION
onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {

    const profileSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnap.exists()) {
      throw new Error("User profile not found.");
    }

    const role = String(
      profileSnap.data().role || ""
    ).trim().toLowerCase();

    if (role !== "teacher" && role !== "admin") {

      alert(
        "Access denied. This page is for teachers and administrators only."
      );

      window.location.href =
        role === "student"
          ? "../student/dashboard.html"
          : "../login.html";

      return;
    }

    currentUser = user;
    currentRole = role;

    // Teachers can only query sections assigned to them; admins can view all.
    await loadAvailableSections();

    moduleCacheKey =
      `${MODULE_CACHE_PREFIX}${user.uid}`;

    renderCachedModules();

    await loadModules();

  } catch (error) {

    console.error(
      "Module page access error:",
      error
    );

    moduleList.innerHTML = `
      <div class="empty">
        Unable to verify your account permissions.
        <br>
        <small>${escapeHTML(error.message)}</small>
      </div>
    `;

  }

});

// OPEN MODAL
openModal?.addEventListener("click", () => {

  resetForm();

  modalTitle.textContent = "Add Module";

  modal.classList.add("show");

  requestAnimationFrame(() => title.focus());

});

// SEARCH, FILTERS AND SORTING
[moduleSearch, statusFilter, sortFilter].forEach((control) => {
  control?.addEventListener("input", applyModuleView);
  control?.addEventListener("change", applyModuleView);
});

sectionSelect?.addEventListener("change", updateAssignmentSummary);
academicYearSelect?.addEventListener("change", updateAssignmentSummary);
programSelect?.addEventListener("change", updateAssignmentSummary);
yearLevelSelect?.addEventListener("change", updateAssignmentSummary);

// CLOSE MODAL
closeModal?.addEventListener("click", closeEditor);

cancelEdit?.addEventListener("click", closeEditor);

modal?.addEventListener("click", (event) => {

  if (event.target === modal) {
    closeEditor();
  }

});

document.addEventListener("keydown", (event) => {

  if (
    event.key === "Escape" &&
    modal?.classList.contains("show")
  ) {
    closeEditor();
  }

});

// FILE SELECTION
moduleFile?.addEventListener("change", () => {

  const file = moduleFile.files?.[0];

  if (!file) {

    selectedFile.style.display = "none";

    return;
  }

  try {

    validateFile(file);

    selectedFile.style.display = "block";

    selectedFile.innerHTML = `
      <strong>${escapeHTML(file.name)}</strong>
      <br>
      <small>
        ${formatFileSize(file.size)} • ready to upload
      </small>
    `;

    showMessage(
      "File ready. It will upload when you save the module.",
      "info"
    );

  } catch (error) {

    moduleFile.value = "";

    selectedFile.style.display = "none";

    showMessage(error.message, "error");

  }

});

// =====================================================
// RESOURCE WORKFLOW - EQUALLEARN
// =====================================================

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

let openedResourceType = null;

// Opens the selected Google service.
function openResourceWebsite(type) {
  const destination = RESOURCE_DESTINATIONS[type];

  if (!destination) return;

  const opened = window.open(
    destination,
    "_blank",
    "noopener,noreferrer"
  );

  if (!opened) {
    showMessage(
      "Popup blocked. Please allow popups for EqualLearn.",
      "error"
    );
    return;
  }

  openedResourceType = type;

  showMessage(
    `${RESOURCE_LABELS[type]} opened in a new tab. Create or select your resource, copy its share link, then return here and click ${RESOURCE_LABELS[type]} again.`,
    "info"
  );
}

// Validates and attaches a resource URL.
function confirmAndAttachResource(type, url) {
  try {
    const parsed = new URL(String(url || "").trim());

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Invalid URL.");
    }

    if (
      type === "youtube" &&
      ![
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be"
      ].includes(parsed.hostname.toLowerCase())
    ) {
      throw new Error("Please enter a valid YouTube URL.");
    }

    const label = RESOURCE_LABELS[type] || "External Link";

    const confirmed = confirm(
      `Confirm this ${label} resource?\n\n${parsed.href}\n\nAttach it to this module?`
    );

    if (!confirmed) return;

    if (type === "youtube") {
      if (videoUrl) videoUrl.value = parsed.href;
    } else if (type === "link") {
      if (resourceUrl) resourceUrl.value = parsed.href;
    } else {
      resourceLinks.push({
        type,
        label,
        url: parsed.href
      });

      renderResourceLinks();
    }

    showMessage(
      `${label} attached. You can continue editing your module.`,
      "success"
    );

  } catch (error) {
    showMessage(
      error.message || "Please enter a valid URL.",
      "error"
    );
  }
}

// Ask the teacher for the share link after returning from Google.
function requestResourceLink(type) {
  const label = RESOURCE_LABELS[type] || "Resource";

  const url = prompt(
    `Paste the ${label} share link here:`
  );

  if (url === null || !url.trim()) return;

  confirmAndAttachResource(type, url);
}

// Main resource toolbar click handler.
$("resourceToolbar")?.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-resource]");
  if (!tile) return;

  const type = tile.dataset.resource;

  // Google services:
  // First click opens the website.
  // Second click asks for the created resource's share link.
  if (RESOURCE_DESTINATIONS[type]) {
    if (openedResourceType === type) {
      requestResourceLink(type);
      openedResourceType = null;
    } else {
      openResourceWebsite(type);
    }

    return;
  }

  // YouTube URL.
  if (type === "youtube") {
    const url = prompt("Paste the YouTube video link:");

    if (url === null || !url.trim()) return;

    confirmAndAttachResource("youtube", url);
    return;
  }

  // External link.
  if (type === "link") {
    const url = prompt("Enter the website or resource URL:");

    if (url === null || !url.trim()) return;

    confirmAndAttachResource("link", url);
    return;
  }

  // PDF selection.
  if (type === "pdf") {
    if (moduleFile) {
      moduleFile.accept = ".pdf,application/pdf";
      moduleFile.dataset.resourceMode = "pdf";
      moduleFile.click();
    }
    return;
  }

  // Normal file upload.
  if (type === "upload") {
    if (moduleFile) {
      moduleFile.accept =
        ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov";

      moduleFile.dataset.resourceMode = "upload";
      moduleFile.click();
    }
    return;
  }

  // Camera and photo selection.
  if (type === "camera") {
    cameraPhotoInput?.click();
    return;
  }

  if (type === "photo") {
    pickPhotoInput?.click();
    return;
  }

  else if (type === "record") {
  recordVideoInput?.click();
}
});

// =====================================================
// FILE SELECTION AND CONFIRMATION
// =====================================================

function attachChosenFile(file, sourceType = "upload") {
  if (!file) return;

  try {
    validateFile(file);

    const confirmed = confirm(
      `Selected file:\n\n${file.name}\n${formatFileSize(file.size)}\n\nAttach this file to your module?`
    );

    if (!confirmed) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);

    moduleFile.files = transfer.files;

    moduleFile.dispatchEvent(
      new Event("change", { bubbles: true })
    );

    showMessage(
      `${file.name} confirmed. It will upload when you save the module.`,
      "success"
    );

  } catch (error) {
    showMessage(error.message, "error");
  }
}

// Existing main file input.
moduleFile?.addEventListener("change", () => {
  const file = moduleFile.files?.[0];

  if (!file) {
    selectedFile.style.display = "none";
    return;
  }

  try {
    validateFile(file);

    selectedFile.style.display = "block";

    selectedFile.textContent =
      `${file.name} • ${formatFileSize(file.size)} • Ready to upload`;

    showMessage(
      "File ready. It will upload when you save the module.",
      "info"
    );

  } catch (error) {
    moduleFile.value = "";
    selectedFile.style.display = "none";
    showMessage(error.message, "error");
  }
});

// Camera, photo gallery and video capture.
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

// SAVE MODULE
saveModule?.addEventListener("click", async () => {

  if (!currentUser) {
    return showMessage(
      "Please sign in first.",
      "error"
    );
  }

  const moduleTitle = title.value.trim();
  const moduleDescription = description.value.trim();

  const order = Number(moduleOrder.value);
  const status = moduleStatus.value;

  const file = moduleFile.files?.[0] || null;

  if (!moduleTitle) {
    return showMessage(
      "Please enter a module title.",
      "error"
    );
  }

  if (!moduleDescription) {
    return showMessage(
      "Please enter a description.",
      "error"
    );
  }

  if (!Number.isFinite(order) || order < 1) {
    return showMessage(
      "Please enter a valid display order.",
      "error"
    );
  }

  if (!["active", "draft", "archived"].includes(status)) {
    return showMessage(
      "Invalid module status.",
      "error"
    );
  }

  if (file) {

    try {
      validateFile(file);
    } catch (error) {
      return showMessage(error.message, "error");
    }

  }

  const safeVideoUrl = validateOptionalURL(videoUrl?.value, "YouTube video");
  if (safeVideoUrl === false) return;
  const safeResourceUrl = validateOptionalURL(resourceUrl?.value, "Resource");
  if (safeResourceUrl === false) return;
  const availableValue = availableAt?.value || "";
  const dueValue = dueDate?.value || "";
  if (availableValue && dueValue && new Date(dueValue) < new Date(availableValue)) {
    return showMessage("Due date must be later than the availability date.", "error");
  }

  setEditorBusy(
    true,
    file ? "Preparing upload…" : "Saving module…"
  );

  const oldFilePath = currentFilePath;

  try {

    let fileURL = currentFileURL;
    let filePath = currentFilePath;
    let fileName = currentFileName;

    // UPLOAD FILE
    if (file) {

      const result = await uploadModuleFile(file);

      fileURL = result.url;
      filePath = result.path;
      fileName = file.name;

    }

    // MODULE DATA
    const payload = {

      resourceLinks: resourceLinks.map(item => ({ ...item })),

      title: moduleTitle,

      description: moduleDescription,

      order,

      status,

      fileURL: fileURL || "",

      filePath: filePath || "",

      fileName: fileName || "",

      // Optional fields are backward-compatible with existing module documents.
      learningObjectives: (learningObjectives?.value || "").trim(),
      estimatedDuration: estimatedDuration?.value || "",
      academicYear: academicYearSelect?.value || "",
      program: programSelect?.value || "",
      yearLevel: yearLevelSelect?.value || "",
      sectionIds: [...(sectionSelect?.selectedOptions || [])].map(option => option.value).filter(Boolean),
      classSource: classSource?.value || "all",
      availableAt: availableValue || "",
      dueDate: dueValue || "",
      videoUrl: safeVideoUrl || "",
      resourceUrl: safeResourceUrl || "",

      updatedAt: serverTimestamp()

    };

    let savedId = editingId;

    // UPDATE EXISTING MODULE
    if (editingId) {

      const moduleRef = doc(
        db,
        "modules",
        editingId
      );

      const existingSnap = await getDoc(moduleRef);

      if (!existingSnap.exists()) {
        throw new Error("Module not found.");
      }

      const existingData = existingSnap.data();

      if (
        currentRole !== "admin" &&
        existingData.createdBy !== currentUser.uid
      ) {
        throw new Error(
          "You can edit only modules you created."
        );
      }

      await updateDoc(moduleRef, payload);

    }

    // CREATE NEW MODULE
    else {

      const created = await addDoc(
        collection(db, "modules"),
        {
          ...payload,

          createdBy: currentUser.uid,

          createdAt: serverTimestamp()
        }
      );

      savedId = created.id;

    }

    // UPDATE CACHE
    const savedData = {

      id: savedId,

      ...payload,

      createdBy: currentRole === "admin"
        ? (
            moduleCache.get(savedId)?.createdBy ||
            currentUser.uid
          )
        : currentUser.uid,

      updatedAt: Date.now()

    };

    moduleCache.set(savedId, savedData);

    saveModuleCache();

    renderModules(
      [...moduleCache.values()].sort(sortModules)
    );

    // DELETE OLD FILE AFTER SUCCESSFUL REPLACEMENT
    if (
      file &&
      oldFilePath &&
      oldFilePath !== filePath
    ) {

      deleteObject(
        ref(storage, oldFilePath)
      ).catch((error) => {

        console.warn(
          "Old module file cleanup skipped:",
          error
        );

      });

    }

    showMessage(
      editingId
        ? "Module updated successfully."
        : "Module added successfully.",
      "success"
    );

    modal.classList.remove("show");

    resetForm();

    await loadModules({ quiet: true });

  } catch (error) {

    console.error(
      "Module save error:",
      error
    );

    showMessage(
      readableUploadError(error),
      "error"
    );

  } finally {

  
    activeUploadTask = null;

    setEditorBusy(false);

  }

});

// LOAD ASSIGNED SECTIONS
async function loadAvailableSections() {
  if (!sectionSelect || !currentUser) return;
  try {
    const sectionsRef = collection(db, "sections");
    const sectionsQuery = currentRole === "admin"
      ? sectionsRef
      : query(sectionsRef, where("teacherIds", "array-contains", currentUser.uid));
    const snap = await getDocs(sectionsQuery);
    availableSections = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const current = sectionSelect.value;
    sectionSelect.replaceChildren();
    availableSections.forEach(section => {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = section.name || section.sectionName || section.code || `Section ${section.id.slice(0, 6)}`;
      option.dataset.program = section.program || section.course || "";
      option.dataset.year = String(section.yearLevel || section.year || "");
      option.dataset.academicYear = section.academicYear || "";
      sectionSelect.appendChild(option);
    });
    if (current) sectionSelect.value = current;
    populateDistinctOptions(academicYearSelect, "academicYear", "Select academic year");
    populateDistinctOptions(programSelect, "program", "Select program");
    updateAssignmentSummary();
  } catch (error) {
    console.warn("Section list unavailable; module management remains usable:", error);
    if (assignmentSummary) assignmentSummary.textContent = "Section list could not be loaded. Check the sections Firestore rules and teacherIds assignment.";
  }
}

function populateDistinctOptions(select, key, placeholder) {
  if (!select) return;
  const existing = select.value;
  const values = [...new Set(availableSections.map(s => String(s[key] || (key === "program" ? s.course : "") || "").trim()).filter(Boolean))].sort();
  select.replaceChildren(new Option(placeholder, ""));
  values.forEach(value => select.add(new Option(value, value)));
  if (values.includes(existing)) select.value = existing;
}

function updateAssignmentSummary() {
  if (!assignmentSummary) return;
  const count = sectionSelect?.selectedOptions?.length || 0;
  const program = programSelect?.value || "any program";
  const year = yearLevelSelect?.selectedOptions?.[0]?.textContent || "any year level";
  const ay = academicYearSelect?.value || "any academic year";
  assignmentSummary.textContent = count
    ? `Assigned to ${count} selected section(s) • ${program} • ${year} • ${ay}`
    : "No specific sections selected. This module keeps the existing general visibility behavior.";
}

function validateOptionalURL(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!(["https:", "http:"].includes(parsed.protocol))) throw new Error();
    if (label === "YouTube video" && !["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"].includes(parsed.hostname.toLowerCase())) {
      showMessage("Please enter a valid YouTube URL.", "error");
      return false;
    }
    return parsed.href;
  } catch (_) {
    showMessage(`${label} URL must be a valid http:// or https:// link.`, "error");
    return false;
  }
}

function getFilteredModules(items) {
  const term = (moduleSearch?.value || "").trim().toLowerCase();
  const status = statusFilter?.value || "all";
  const sort = sortFilter?.value || "order";
  const filtered = items.filter(item => {
    const matchesStatus = status === "all" || (item.status || "draft") === status;
    const haystack = [item.title, item.description, item.program, item.academicYear].join(" ").toLowerCase();
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

function applyModuleView() {
  renderModules([...moduleCache.values()]);
}

function updateModuleStats(items) {
  if (statTotal) statTotal.textContent = items.length;
  if (statActive) statActive.textContent = items.filter(x => x.status === "active").length;
  if (statDraft) statDraft.textContent = items.filter(x => x.status === "draft" || !x.status).length;
  if (statArchived) statArchived.textContent = items.filter(x => x.status === "archived").length;
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

// UPLOAD MODULE FILE
async function uploadModuleFile(file) {

  const safeName = file.name.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const path =
    `modules/${auth.currentUser.uid}/${Date.now()}_${safeName}`;

  const storageRef = ref(storage, path);

  const task = uploadBytesResumable(
    storageRef,
    file,
    {
      contentType:
        file.type || "application/octet-stream",

      customMetadata: {
        originalName: file.name
      }
    }
  );

  activeUploadTask = task;

  uploadStartedAt = performance.now();

  lastProgressTime = uploadStartedAt;

  lastProgressBytes = 0;

  showUploadPanel(true);

  return new Promise((resolve, reject) => {

    task.on(
      "state_changed",

      (snapshot) => {

        updateUploadProgress(
          snapshot.bytesTransferred,
          snapshot.totalBytes
        );

      },

      reject,

      async () => {

        try {

          progressBar.style.width = "100%";

          progressText.textContent =
            "Upload complete. Saving module…";

          const url = await getDownloadURL(
            task.snapshot.ref
          );

          resolve({
            url,
            path
          });

        } catch (error) {

          reject(error);

        }

      }

    );

  });

}

// UPLOAD PROGRESS
function updateUploadProgress(bytes, total) {

  const now = performance.now();

  const percent = total
    ? Math.min(100, (bytes / total) * 100)
    : 0;

  const totalSeconds = Math.max(
    (now - uploadStartedAt) / 1000,
    0.25
  );

  const averageRate = bytes / totalSeconds;

  const intervalSeconds = Math.max(
    (now - lastProgressTime) / 1000,
    0.05
  );

  const instantRate =
    (bytes - lastProgressBytes) / intervalSeconds;

  const rate = instantRate > 0
    ? averageRate * 0.55 + instantRate * 0.45
    : averageRate;

  const remaining = Math.max(
    total - bytes,
    0
  );

  const eta = rate > 0
    ? remaining / rate
    : 0;

  progressBar.style.width =
    `${percent.toFixed(1)}%`;

  progressText.textContent =
    `${Math.round(percent)}% • ` +
    `${formatFileSize(bytes)} of ${formatFileSize(total)} • ` +
    `${formatRate(rate)}` +
    `${eta > 1 ? ` • ${formatEta(eta)} left` : ""}`;

  saveModule.textContent =
    percent < 100
      ? `Uploading ${Math.round(percent)}%`
      : "Saving module…";

  lastProgressBytes = bytes;

  lastProgressTime = now;

}

// LOAD MODULES
async function loadModules({ quiet = false } = {}) {

  if (!currentUser || !currentRole) {
    return;
  }

  if (!quiet && moduleCache.size === 0) {

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

      ? query(
          collection(db, "modules"),
          orderBy("order", "asc")
        )

      : query(
          collection(db, "modules"),
          where(
            "createdBy",
            "==",
            currentUser.uid
          ),
          orderBy("order", "asc")
        );

    const snapshot = await getDocs(modulesQuery);

    moduleCache.clear();

    snapshot.forEach((item) => {

      moduleCache.set(
        item.id,
        {
          id: item.id,
          ...item.data()
        }
      );

    });

    saveModuleCache();

    renderModules(
      [...moduleCache.values()]
    );

  } catch (error) {

    console.error(
      "Load modules error:",
      error
    );

    if (moduleCache.size === 0) {

      moduleList.innerHTML = `
        <div class="empty">
          Unable to load modules.
          <br>
          <small>${escapeHTML(error.message)}</small>
        </div>
      `;

    }

  }

}

// RENDER CACHED MODULES
function renderCachedModules() {

  if (!moduleCacheKey) {
    return;
  }

  try {

    const cached = JSON.parse(
      localStorage.getItem(moduleCacheKey) || "[]"
    );

    if (!Array.isArray(cached) || !cached.length) {
      return;
    }

    cached.forEach((item) => {

      if (item?.id) {
        moduleCache.set(item.id, item);
      }

    });

    renderModules(
      [...moduleCache.values()].sort(sortModules),
      true
    );

  } catch (_) {}

}

// SAVE CACHE
function saveModuleCache() {

  if (!moduleCacheKey) {
    return;
  }

  try {

    const safe = [...moduleCache.values()].map(
      ({
        id,
        title,
        description,
        order,
        status,
        fileURL,
        filePath,
        fileName,
        createdBy,
        learningObjectives,
        estimatedDuration,
        academicYear,
        program,
        yearLevel,
        sectionIds,
        classSource,
        availableAt,
        dueDate,
        videoUrl,
        resourceUrl,
        resourceLinks
      }) => ({

        id,
        title,
        description,
        order,
        status,
        fileURL,
        filePath,
        fileName,
        createdBy,
        learningObjectives,
        estimatedDuration,
        academicYear,
        program,
        yearLevel,
        sectionIds,
        classSource,
        availableAt,
        dueDate,
        videoUrl,
        resourceUrl,
        resourceLinks

      })
    );

    localStorage.setItem(
      moduleCacheKey,
      JSON.stringify(safe)
    );

  } catch (_) {}

}

// RENDER MODULES
function renderModules(items, fromCache = false) {

  const allItems = [...items];
  updateModuleStats(allItems);
  const sorted = getFilteredModules(allItems);

  if (!sorted.length) {

    moduleList.innerHTML = `
      <div class="empty">
        <strong>No modules yet.</strong>
        <br>
        <small>${allItems.length ? "No modules match your current search or filters." : "Click + Create Module to add learning content."}</small>
      </div>
    `;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  sorted.forEach((data) => {

    const card = document.createElement("article");

    card.className = "module-card";

    card.dataset.id = data.id;

    const fileHTML = data.fileURL
      ? `
        <a
          class="file-link"
          href="${escapeAttribute(data.fileURL)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="file-icon">↗</span>
          <span>
            <strong>
              ${escapeHTML(data.fileName || "Open Module File")}
            </strong>
            <br>
            <small>Open attachment</small>
          </span>
        </a>
      `
      : "";

    const resourceHTML =
      Array.isArray(data.resourceLinks) && data.resourceLinks.length
        ? data.resourceLinks.map((item) => `
            <a
              class="file-link"
              href="${escapeAttribute(item.url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${resourceIcon(item.type)} ${escapeHTML(item.label || "Open resource")}
            </a>
          `).join("")
        : "";

    card.innerHTML = `

      <div class="module-top">

        <h3 class="module-title">
          ${escapeHTML(data.title || "Untitled Module")}
        </h3>

        <span class="status ${escapeAttribute(data.status || "draft")}">
          ${escapeHTML(data.status || "draft")}
        </span>

      </div>

      <p class="module-description">
        ${escapeHTML(data.description || "No description.")}
      </p>

      <div class="module-meta-chips">
        ${data.program ? `<span>${escapeHTML(data.program)}</span>` : ""}
        ${data.yearLevel ? `<span>Year ${escapeHTML(data.yearLevel)}</span>` : ""}
        ${Array.isArray(data.sectionIds) && data.sectionIds.length ? `<span>${data.sectionIds.length} section(s)</span>` : ""}
        ${data.estimatedDuration ? `<span>${escapeHTML(data.estimatedDuration)} min</span>` : ""}
      </div>

      ${data.dueDate ? `<p class="module-deadline">Due: ${escapeHTML(formatDateTime(data.dueDate))}</p>` : ""}
      ${fileHTML}
      ${resourceHTML}
      ${data.videoUrl ? `<a class="file-link" href="${escapeAttribute(data.videoUrl)}" target="_blank" rel="noopener noreferrer">▶ Open YouTube video</a>` : ""}
      ${data.resourceUrl ? `<a class="file-link" href="${escapeAttribute(data.resourceUrl)}" target="_blank" rel="noopener noreferrer">↗ Open external resource</a>` : ""}

      <div class="module-info">
        Display order
        <strong>${Number(data.order) || "-"}</strong>

        ${fromCache
          ? '<span class="el-cache-label">cached</span>'
          : ""
        }

      </div>

      <div class="module-actions">

        <button
          class="edit-btn"
          data-action="edit"
        >
          Edit
        </button>

        <button
          class="delete-btn"
          data-action="delete"
        >
          Delete
        </button>

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

// MODULE ACTIONS
moduleList?.addEventListener("click", (event) => {

  const button = event.target.closest(
    "button[data-action]"
  );

  if (!button) {
    return;
  }

  const card = button.closest(".module-card");

  if (!card?.dataset.id) {
    return;
  }

  if (button.dataset.action === "edit") {
    editModule(card.dataset.id);
  }

  if (button.dataset.action === "delete") {
    deleteModule(card.dataset.id);
  }

});

// EDIT MODULE
async function editModule(id) {

  try {

    if (
      !currentUser ||
      !["teacher", "admin"].includes(currentRole)
    ) {
      throw new Error(
        "You are not authorized to edit modules."
      );
    }

    let selectedData = moduleCache.get(id);

    if (!selectedData) {

      const snap = await getDoc(
        doc(db, "modules", id)
      );

      if (!snap.exists()) {
        throw new Error("Module not found.");
      }

      selectedData = {
        id: snap.id,
        ...snap.data()
      };

      moduleCache.set(id, selectedData);

    }

    if (
      currentRole !== "admin" &&
      selectedData.createdBy !== currentUser.uid
    ) {

      throw new Error(
        "You can edit only modules you created."
      );

    }

    editingId = id;

    title.value = selectedData.title || "";

    description.value =
      selectedData.description || "";

    moduleOrder.value =
      selectedData.order || "";

    moduleStatus.value =
      selectedData.status || "active";

    if (learningObjectives) learningObjectives.value = selectedData.learningObjectives || "";
    if (estimatedDuration) estimatedDuration.value = selectedData.estimatedDuration || "";
    if (academicYearSelect) academicYearSelect.value = selectedData.academicYear || "";
    if (programSelect) programSelect.value = selectedData.program || "";
    if (yearLevelSelect) yearLevelSelect.value = selectedData.yearLevel || "";
    if (classSource) classSource.value = selectedData.classSource || "all";
    if (availableAt) availableAt.value = selectedData.availableAt || "";
    if (dueDate) dueDate.value = selectedData.dueDate || "";
    if (videoUrl) videoUrl.value = selectedData.videoUrl || "";
    if (resourceUrl) resourceUrl.value = selectedData.resourceUrl || "";
    resourceLinks = Array.isArray(selectedData.resourceLinks)
      ? selectedData.resourceLinks
          .filter(item => item && typeof item.url === "string")
          .map(item => {
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
          })
          .filter(Boolean)
      : [];

    renderResourceLinks();

    if (sectionSelect) {
      const selectedIds = new Set(selectedData.sectionIds || []);
      [...sectionSelect.options].forEach(option => { option.selected = selectedIds.has(option.value); });
    }
    updateAssignmentSummary();

    currentFileURL =
      selectedData.fileURL || "";

    currentFilePath =
      selectedData.filePath || "";

    currentFileName =
      selectedData.fileName || "";

    selectedFile.style.display = "none";

    if (currentFileURL) {

      existingFile.style.display = "block";

      existingFile.innerHTML = `

        <strong>Current attachment</strong>
        <br>

        ${escapeHTML(currentFileName || "Attached file")}

        <br>

        <a
          href="${escapeAttribute(currentFileURL)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open file →
        </a>

        <br>

        <small>
          Select a new file only if you want to replace it.
        </small>

      `;

    } else {

      existingFile.style.display = "none";

    }

    modalTitle.textContent = "Edit Module";

    modal.classList.add("show");

    requestAnimationFrame(() => title.focus());

  } catch (error) {

    console.error(error);

    alert(
      error.message || "Unable to load module."
    );

  }

}

window.editModule = editModule;

// DELETE MODULE
async function deleteModule(id) {

  if (
    !currentUser ||
    !["teacher", "admin"].includes(currentRole)
  ) {

    alert(
      "You are not authorized to delete modules."
    );

    return;
  }

  const data = moduleCache.get(id);

  if (
    !confirm(
      `Delete "${data?.title || "this module"}"?`
    )
  ) {
    return;
  }

  try {

    let target = data;

    if (!target) {

      const snap = await getDoc(
        doc(db, "modules", id)
      );

      target = snap.exists()
        ? {
            id: snap.id,
            ...snap.data()
          }
        : null;

    }

    if (!target) {
      throw new Error("Module not found.");
    }

    if (
      currentRole !== "admin" &&
      target.createdBy !== currentUser.uid
    ) {

      throw new Error(
        "You can delete only modules you created."
      );

    }

    await deleteDoc(
      doc(db, "modules", id)
    );

    moduleCache.delete(id);

    saveModuleCache();

    renderModules(
      [...moduleCache.values()]
    );

    if (target?.filePath) {

      deleteObject(
        ref(storage, target.filePath)
      ).catch((error) => {

        console.warn(
          "Storage cleanup skipped:",
          error
        );

      });

    }

  } catch (error) {

    console.error(
      "Delete module error:",
      error
    );

    alert(
      error.message || "Unable to delete module."
    );

  }

}

window.deleteModule = deleteModule;

// CLOSE EDITOR
function closeEditor() {

  if (activeUploadTask) {

    if (
      !confirm(
        "An upload is still running. Cancel the upload and close?"
      )
    ) {
      return;
    }

    activeUploadTask.cancel();

  }

  modal.classList.remove("show");

  resetForm();

}

// RENDER RESOURCE LINKS
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

// RESET FORM
function resetForm() {

  editingId = null;

  currentFileURL = "";
  currentFilePath = "";
  currentFileName = "";

  title.value = "";

  description.value = "";

  moduleOrder.value = "";

  moduleStatus.value = "draft";

  resourceLinks = [];
  renderResourceLinks();

  if (cameraPhotoInput) cameraPhotoInput.value = "";
  if (pickPhotoInput) pickPhotoInput.value = "";
  if (recordVideoInput) recordVideoInput.value = "";

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

  if (sectionSelect) {
    [...sectionSelect.options].forEach(option => {
      option.selected = false;
    });
  }

  updateAssignmentSummary();

  moduleFile.value = "";

  existingFile.style.display = "none";
  existingFile.innerHTML = "";

  selectedFile.style.display = "none";
  selectedFile.innerHTML = "";

  showUploadPanel(false);

  progressBar.style.width = "0%";

  progressText.textContent =
    "Ready to upload";

  message.textContent = "";
  message.className = "message";

  activeUploadTask = null;

  setEditorBusy(false);

}

// EDITOR BUSY STATE
function setEditorBusy(
  busy,
  label = "Saving…"
) {

  saveModule.disabled = busy;
  moduleFile.disabled = busy;
  title.disabled = busy;
  description.disabled = busy;
  moduleOrder.disabled = busy;
  moduleStatus.disabled = busy;
  closeModal.disabled = busy;

  cancelEdit.disabled = false;

  saveModule.textContent =
    busy ? label : "Save Module";

  modal?.classList.toggle(
    "is-busy",
    busy
  );

}

// UPLOAD PANEL
function showUploadPanel(show) {

  uploadProgress.style.display =
    show ? "block" : "none";

  cancelUpload.hidden = !show;

}

// FILE VALIDATION
function validateFile(file) {

  if (file.size > MAX_FILE_SIZE) {

    throw new Error(
      "File is too large. Maximum size is 20 MB."
    );

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

  const ext = file.name
    .split(".")
    .pop()
    ?.toLowerCase();

  const allowedExt = new Set([

    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "txt",
    "jpg",
    "jpeg",
    "png",
    "webp",
    "mp4",
    "webm",
    "mov"

  ]);

  if (
    file.type &&
    !allowed.has(file.type) &&
    !file.type.startsWith("video/") &&
    !allowedExt.has(ext)
  ) {

    throw new Error(
      "This file type is not supported."
    );

  }

}

// MESSAGE
function showMessage(text, type = "info") {

  message.textContent = text;

  message.className =
    `message ${type}`;

}

// SORT MODULES
function sortModules(a, b) {

  return (
    (Number(a.order) || 0) -
    (Number(b.order) || 0)
  );

}

// FORMAT UPLOAD SPEED
function formatRate(bytesPerSecond) {

  return bytesPerSecond > 0
    ? `${formatFileSize(bytesPerSecond)}/s`
    : "starting…";

}

// FORMAT ETA
function formatEta(seconds) {

  const s = Math.max(
    1,
    Math.round(seconds)
  );

  return s < 60
    ? `${s}s`
    : `${Math.ceil(s / 60)}m`;

}

// FORMAT FILE SIZE
function formatFileSize(bytes) {

  if (!bytes) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  const i = Math.min(
    units.length - 1,
    Math.floor(
      Math.log(bytes) / Math.log(1024)
    )
  );

  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;

}

// READABLE UPLOAD ERRORS
function readableUploadError(error) {

  if (error?.code === "storage/canceled") {
    return "Upload canceled. Your module was not changed.";
  }

  if (error?.code === "storage/unauthorized") {
    return "Upload permission denied. Check Firebase Storage rules.";
  }

  if (error?.code === "storage/retry-limit-exceeded") {
    return "The connection timed out. Please try the upload again.";
  }

  return error?.message ||
    "Unable to save the module.";

}

// ESCAPE HTML
function escapeHTML(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}

// ESCAPE HTML ATTRIBUTES
function escapeAttribute(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

}