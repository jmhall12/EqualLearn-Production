import { auth, db, storage } from "./firebase-config.js";

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

/* =====================================================
   DOM ELEMENTS
===================================================== */

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


const sectionSelect = $("sectionSelect");
const assignmentSummary = $("assignmentSummary");

const availableAt = $("availableAt");
const dueDate = $("dueDate");
const videoUrl = $("videoUrl");

const resourceLinksList = $("resourceLinksList");
const resourceToolbar = $("resourceToolbar");

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

/* =====================================================
   CONSTANTS AND STATE
===================================================== */

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const MODULE_CACHE_PREFIX =
  "equallearn:teacher:modules:v3:";

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
  docs: "Google Docs"
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

/* =====================================================
   UPLOAD CANCEL CONTROL
===================================================== */

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

/* =====================================================
   AUTHENTICATION AND ROLE VERIFICATION
===================================================== */

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

    if (!["teacher", "admin"].includes(role)) {

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

    moduleCacheKey =
      `${MODULE_CACHE_PREFIX}${user.uid}`;

    await loadAvailableSections();

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

/* =====================================================
   OPEN EDITOR
===================================================== */

openModal?.addEventListener("click", () => {

  if (editorSaving) return;

  resetForm();

  editingId = null;

  modalTitle.textContent = "Create Module";

  modal.classList.add("show");

  editorInitialSnapshot = getEditorSnapshot();

  requestAnimationFrame(() => {
    title.focus();
  });

});

/* =====================================================
   SEARCH, FILTERS AND SORTING
===================================================== */

[moduleSearch, statusFilter, sortFilter].forEach((control) => {

  control?.addEventListener("input", applyModuleView);
  control?.addEventListener("change", applyModuleView);

});

/* =====================================================
   ASSIGNMENT LISTENERS
===================================================== */

sectionSelect?.addEventListener(
  "change",
  updateAssignmentSummary
);



/* =====================================================
   EDITOR CLOSE EVENTS
===================================================== */

closeModal?.addEventListener("click", () => {
  closeEditor("close");
});

cancelEdit?.addEventListener("click", () => {
  closeEditor("back");
});

modal?.addEventListener("click", (event) => {

  if (event.target === modal) {
    closeEditor("outside");
  }

});

document.addEventListener("keydown", (event) => {

  if (
    event.key === "Escape" &&
    modal?.classList.contains("show")
  ) {
    event.preventDefault();
    closeEditor("escape");
  }

});

/* =====================================================
   DASHBOARD NAVIGATION
===================================================== */

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

    alert(
      "Unable to save your draft. Please try again before leaving."
    );

  }

});

/* =====================================================
   FILE SELECTION
===================================================== */

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

/* =====================================================
   RESOURCE WORKFLOW
===================================================== */

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
    `${RESOURCE_LABELS[type]} opened. Create or select your resource, copy its share link, then return here and click the same resource again.`,
    "info"
  );

}

function confirmAndAttachResource(type, url) {

  try {

    const parsed = new URL(
      String(url || "").trim()
    );

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Invalid URL.");
    }

    const label =
      RESOURCE_LABELS[type] || "Resource";

    const confirmed = confirm(
      `Confirm this ${label} resource?\n\n${parsed.href}\n\nAttach it to this module?`
    );

    if (!confirmed) return;

    resourceLinks.push({
      type,
      label,
      url: parsed.href
    });

    renderResourceLinks();

    showMessage(
      `${label} attached successfully.`,
      "success"
    );

  } catch (error) {

    showMessage(
      error.message || "Please enter a valid URL.",
      "error"
    );

  }

}

function requestResourceLink(type) {

  const label =
    RESOURCE_LABELS[type] || "Resource";

  const url = prompt(
    `Paste the ${label} share link here:`
  );

  if (url === null || !url.trim()) return;

  confirmAndAttachResource(type, url);

}

/* =====================================================
   RESOURCE TOOLBAR EVENTS

   YouTube and external-link toolbar actions are removed.
   YouTube is entered in the dedicated bottom field.
===================================================== */

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

  if (type === "pdf") {

    moduleFile.accept = ".pdf,application/pdf";

    moduleFile.dataset.resourceMode = "pdf";

    moduleFile.click();

    return;
  }

  if (type === "upload") {

    moduleFile.accept =
      ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov";

    moduleFile.dataset.resourceMode = "upload";

    moduleFile.click();

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

/* =====================================================
   CAMERA / PHOTO / VIDEO FILE ATTACHMENT
===================================================== */

function attachChosenFile(file) {

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

  } catch (error) {

    showMessage(error.message, "error");

  }

}

cameraPhotoInput?.addEventListener("change", () => {

  attachChosenFile(cameraPhotoInput.files?.[0]);

  cameraPhotoInput.value = "";

});

pickPhotoInput?.addEventListener("change", () => {

  attachChosenFile(pickPhotoInput.files?.[0]);

  pickPhotoInput.value = "";

});

recordVideoInput?.addEventListener("change", () => {

  attachChosenFile(recordVideoInput.files?.[0]);

  recordVideoInput.value = "";

});

/* =====================================================
   SAVE / PUBLISH MODULE
===================================================== */

saveModule?.addEventListener("click", async () => {

  await saveModuleRecord("active");

});

/* =====================================================
   SAVE MODULE RECORD
   active = Published
   draft  = Unpublished
===================================================== */

async function saveModuleRecord(status) {

  if (!currentUser) {

    showMessage(
      "Please sign in first.",
      "error"
    );

    return false;
  }

  if (editorSaving) return false;

  const moduleTitle = title.value.trim();

  const moduleDescription = description.value.trim();

  const order = Number(moduleOrder.value);

  const file = moduleFile.files?.[0] || null;

  if (!moduleTitle) {

    showMessage(
      "Please enter a module title.",
      "error"
    );

    title.focus();

    return false;
  }

  if (!moduleDescription) {

    showMessage(
      "Please enter a description.",
      "error"
    );

    description.focus();

    return false;
  }

  if (!Number.isFinite(order) || order < 1) {

    showMessage(
      "Please enter a valid display order.",
      "error"
    );

    moduleOrder.focus();

    return false;
  }

  if (file) {

    try {

      validateFile(file);

    } catch (error) {

      showMessage(error.message, "error");

      return false;

    }

  }

  const safeVideoUrl = validateOptionalURL(
    videoUrl?.value,
    "YouTube video"
  );

  if (safeVideoUrl === false) return false;

  const availableValue =
    availableAt?.value || "";

  const dueValue =
    dueDate?.value || "";

  if (
    availableValue &&
    dueValue &&
    new Date(dueValue) < new Date(availableValue)
  ) {

    showMessage(
      "Due date must be later than the availability date.",
      "error"
    );

    return false;
  }

  editorSaving = true;

  setEditorBusy(
    true,
    file ? "Preparing upload…" : (
      status === "active"
        ? "Publishing…"
        : "Saving draft…"
    )
  );

  const oldFilePath = currentFilePath;

  try {

    let fileURL = currentFileURL;
    let filePath = currentFilePath;
    let fileName = currentFileName;

    /* UPLOAD NEW ATTACHMENT */

    if (file) {

      const result = await uploadModuleFile(file);

      fileURL = result.url;
      filePath = result.path;
      fileName = file.name;

    }

    /* SECTION ASSIGNMENT */

    const selectedSectionIds = [
      ...(sectionSelect?.selectedOptions || [])
    ]
      .map(option => option.value)
      .filter(Boolean);

    

    /* MODULE PAYLOAD */

    const payload = {

      title: moduleTitle,

      description: moduleDescription,

      order,

      /*
       * Keep "active" as the published database value.
       * Existing student-side pages may depend on it.
       */
      status,

      fileURL: fileURL || "",

      filePath: filePath || "",

      fileName: fileName || "",

      learningObjectives:
        (learningObjectives?.value || "").trim(),

      estimatedDuration:
        estimatedDuration?.value || "",


      sectionIds:
        selectedSectionIds,

      availableAt:
        availableValue,

      dueDate:
        dueValue,

      videoUrl:
        safeVideoUrl || "",

      resourceLinks:
        resourceLinks.map(item => ({ ...item })),

      updatedAt:
        serverTimestamp()

    };

    let savedId = editingId;

    /* UPDATE EXISTING MODULE */

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

      await updateDoc(
        moduleRef,
        payload
      );

    }

    /* CREATE NEW MODULE */

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

    /* UPDATE LOCAL CACHE */

    const previousData =
      moduleCache.get(savedId) || {};

    const savedData = {

      ...previousData,

      id: savedId,

      ...payload,

      createdBy:
        previousData.createdBy || currentUser.uid,

      updatedAt: Date.now()

    };

    moduleCache.set(
      savedId,
      savedData
    );

    saveModuleCache();

    renderModules(
      [...moduleCache.values()]
    );

    /* DELETE REPLACED FILE AFTER SUCCESSFUL SAVE */

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
      status === "active"
        ? "Module published successfully."
        : "Draft saved successfully.",
      "success"
    );

    modal.classList.remove("show");

    resetForm();

    await loadModules({ quiet: true });

    return true;

  } catch (error) {

    console.error(
      "Module save error:",
      error
    );

    showMessage(
      readableUploadError(error),
      "error"
    );

    return false;

  } finally {

    activeUploadTask = null;

    editorSaving = false;

    setEditorBusy(false);

  }

}

/* =====================================================
   AUTOMATIC DRAFT ON BACK / CLOSE
===================================================== */

async function saveDraftBeforeLeaving() {

  if (!modal?.classList.contains("show")) {
    return true;
  }

  if (editorSaving) {
    return false;
  }

  const currentSnapshot = getEditorSnapshot();

  const hasChanges =
    currentSnapshot !== editorInitialSnapshot;

  if (!hasChanges) {

    modal.classList.remove("show");

    resetForm();

    return true;

  }

  /*
   * If the editor has changes, save them as a draft.
   * Do not require a complete module title/description/order
   * when the teacher is simply leaving an unfinished form.
   */

  return await saveDraftRecord();

}

async function saveDraftRecord() {

  if (!currentUser) {

    showMessage(
      "Please sign in before saving your draft.",
      "error"
    );

    return false;
  }

  if (editorSaving) return false;

  const file = moduleFile.files?.[0] || null;

  if (file) {

    try {

      validateFile(file);

    } catch (error) {

      showMessage(error.message, "error");

      return false;

    }

  }

  editorSaving = true;

  setEditorBusy(
    true,
    file ? "Uploading draft…" : "Saving draft…"
  );

  const oldFilePath = currentFilePath;

  try {

    let fileURL = currentFileURL;
    let filePath = currentFilePath;
    let fileName = currentFileName;

    if (file) {

      const result = await uploadModuleFile(file);

      fileURL = result.url;
      filePath = result.path;
      fileName = file.name;

    }

    const rawVideo = String(
      videoUrl?.value || ""
    ).trim();

    let safeVideo = "";

    if (rawVideo) {

      const validated = validateOptionalURL(
        rawVideo,
        "YouTube video"
      );

      if (validated === false) {
        throw new Error(
          "Please correct the YouTube link before leaving."
        );
      }

      safeVideo = validated;

    }

    const availableValue =
      availableAt?.value || "";

    const dueValue =
      dueDate?.value || "";

    const selectedSectionIds = [
      ...(sectionSelect?.selectedOptions || [])
    ]
      .map(option => option.value)
      .filter(Boolean);

    const payload = {

      title: title.value.trim(),

      description: description.value.trim(),

      order: Number(moduleOrder.value) || 1,

      status: "draft",

      fileURL: fileURL || "",

      filePath: filePath || "",

      fileName: fileName || "",

      learningObjectives:
        (learningObjectives?.value || "").trim(),

      estimatedDuration:
        estimatedDuration?.value || "",

      academicYear:
        academicYearSelect?.value || "",

      sectionIds:
        selectedSectionIds,

      availableAt:
        availableValue,

      dueDate:
        dueValue,

      videoUrl:
        safeVideo,

      resourceLinks:
        resourceLinks.map(item => ({ ...item })),

      updatedAt:
        serverTimestamp()

    };

    let savedId = editingId;

    if (editingId) {

      const moduleRef = doc(
        db,
        "modules",
        editingId
      );

      const snap = await getDoc(moduleRef);

      if (!snap.exists()) {
        throw new Error("Module not found.");
      }

      const existingData = snap.data();

      if (
        currentRole !== "admin" &&
        existingData.createdBy !== currentUser.uid
      ) {

        throw new Error(
          "You can only save your own modules."
        );

      }

      await updateDoc(
        moduleRef,
        payload
      );

    } else {

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

    const previousData =
      moduleCache.get(savedId) || {};

    moduleCache.set(savedId, {

      ...previousData,

      id: savedId,

      ...payload,

      createdBy:
        previousData.createdBy || currentUser.uid,

      updatedAt: Date.now()

    });

    saveModuleCache();

    renderModules(
      [...moduleCache.values()]
    );

    if (
      file &&
      oldFilePath &&
      oldFilePath !== filePath
    ) {

      deleteObject(
        ref(storage, oldFilePath)
      ).catch(error => {
        console.warn(
          "Old file cleanup skipped:",
          error
        );
      });

    }

    modal.classList.remove("show");

    resetForm();

    await loadModules({ quiet: true });

    return true;

  } catch (error) {

    console.error(
      "Automatic draft save error:",
      error
    );

    showMessage(
      `Draft was not saved: ${readableUploadError(error)}`,
      "error"
    );

    return false;

  } finally {

    activeUploadTask = null;

    editorSaving = false;

    setEditorBusy(false);

  }

}

async function closeEditor(reason = "close") {

  if (
    !modal?.classList.contains("show") ||
    editorSaving
  ) {
    return;
  }

  const saved = await saveDraftBeforeLeaving();

  if (!saved) return;

}

/* =====================================================
   EDITOR CHANGE SNAPSHOT
===================================================== */

function getEditorSnapshot() {

  const selectedSections = [
    ...(sectionSelect?.selectedOptions || [])
  ].map(option => option.value);

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

    resources: resourceLinks,

    selectedFile:
      moduleFile?.files?.[0]?.name || "",

    selectedFileSize:
      moduleFile?.files?.[0]?.size || 0,

    currentFileURL,

    currentFilePath

  });

}

/* =====================================================
   LOAD ASSIGNED SECTIONS
===================================================== */

async function loadAvailableSections() {

  if (!sectionSelect || !currentUser) return;

  try {

    const sectionsRef = collection(
      db,
      "sections"
    );

    const sectionsQuery =
      currentRole === "admin"
        ? sectionsRef
        : query(
            sectionsRef,
            where(
              "teacherIds",
              "array-contains",
              currentUser.uid
            )
          );

    const snap = await getDocs(sectionsQuery);

    availableSections = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    sectionSelect.replaceChildren();

    availableSections.forEach(section => {

      const option = document.createElement("option");

      option.value = section.id;

      option.textContent =
        getSectionLabel(section);

      option.dataset.course =
        section.program ||
        section.course ||
        section.programName ||
        section.courseName ||
        "";

      option.dataset.year =
        String(
          section.yearLevel ||
          section.year ||
          section.level ||
          ""
        );

      option.dataset.academicYear =
        section.academicYear ||
        section.schoolYear ||
        "";

      sectionSelect.appendChild(option);

    });



    updateAssignmentSummary();

  } catch (error) {

    console.warn(
      "Section list unavailable:",
      error
    );

    if (assignmentSummary) {

      assignmentSummary.textContent =
        "Section list could not be loaded. Check the sections Firestore rules and teacher assignment.";

    }

  }

}

/* =====================================================
   SECTION LABEL HELPERS
===================================================== */

function getSectionLabel(section) {

  const course =
    section.program ||
    section.course ||
    section.programName ||
    section.courseName ||
    "";

  const year =
    section.yearLevel ||
    section.year ||
    section.level ||
    "";

  const sectionName =
    section.sectionName ||
    section.name ||
    section.code ||
    section.section ||
    "";

  const parts = [];

  if (course) parts.push(String(course));

  if (year) {

    const normalizedYear =
      String(year).toLowerCase().includes("year")
        ? String(year)
        : `Year ${year}`;

    parts.push(normalizedYear);

  }

  if (sectionName) parts.push(String(sectionName));

  return parts.length
    ? parts.join(" • ")
    : `Section ${section.id?.slice(0, 6) || ""}`;

}

function getSelectedSectionRecords() {

  const selectedIds = new Set(
    [...(sectionSelect?.selectedOptions || [])]
      .map(option => option.value)
  );

  return availableSections.filter(section =>
    selectedIds.has(section.id)
  );

}

/* =====================================================
   ACADEMIC YEAR OPTIONS
===================================================== */

function populateAcademicYears() {

  if (!academicYearSelect) return;

  const existing = academicYearSelect.value;

  const values = [
    ...new Set(
      availableSections
        .map(section =>
          String(
            section.academicYear ||
            section.schoolYear ||
            ""
          ).trim()
        )
        .filter(Boolean)
    )
  ].sort();

  academicYearSelect.replaceChildren(
    new Option("Select academic year", "")
  );

  values.forEach(value => {
    academicYearSelect.add(
      new Option(value, value)
    );
  });

  if (values.includes(existing)) {
    academicYearSelect.value = existing;
  }

}

/* =====================================================
   ASSIGNMENT SUMMARY
===================================================== */

function updateAssignmentSummary() {
  if (!assignmentSummary) return;

  const selected = getSelectedSectionRecords();

  if (!selected.length) {
    assignmentSummary.textContent =
      "No class sections selected yet.";
    return;
  }

  const labels = selected.map(section => {
    const course =
      section.program ||
      section.course ||
      section.programName ||
      section.courseName ||
      "";

    const year =
      section.yearLevel ||
      section.year ||
      section.level ||
      "";

    const sectionName =
      section.sectionName ||
      section.name ||
      section.code ||
      section.section ||
      "";

    return [
      course,
      year ? `Year ${year}` : "",
      sectionName
    ].filter(Boolean).join(" ");
  });

  assignmentSummary.textContent =
    `${selected.length} section(s): ${[...new Set(labels)].join(" | ")}`;
}

/* =====================================================
   OPTIONAL URL VALIDATION
===================================================== */

function validateOptionalURL(value, label) {

  const raw = String(value || "").trim();

  if (!raw) return "";

  try {

    const parsed = new URL(raw);

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error();
    }

    if (
      label === "YouTube video" &&
      ![
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "m.youtube.com"
      ].includes(parsed.hostname.toLowerCase())
    ) {

      showMessage(
        "Please enter a valid YouTube URL.",
        "error"
      );

      return false;

    }

    return parsed.href;

  } catch (_) {

    showMessage(
      `${label} URL must be a valid http:// or https:// link.`,
      "error"
    );

    return false;

  }

}

/* =====================================================
   FILTER MODULES
===================================================== */

function getFilteredModules(items) {

  const term =
    (moduleSearch?.value || "").trim().toLowerCase();

  const status =
    statusFilter?.value || "all";

  const sort =
    sortFilter?.value || "order";

  const filtered = items.filter(item => {

    const itemStatus =
      item.status || "draft";

    const matchesStatus =
      status === "all" || itemStatus === status;

    const sectionText = getModuleSectionText(item);

    const haystack = [

      item.title,
      item.description,
      item.academicYear,
      sectionText

    ].join(" ").toLowerCase();

    return (
      matchesStatus &&
      (!term || haystack.includes(term))
    );

  });

  filtered.sort((a, b) => {

    if (sort === "newest") {
      return timestampValue(b.createdAt) -
        timestampValue(a.createdAt);
    }

    if (sort === "oldest") {
      return timestampValue(a.createdAt) -
        timestampValue(b.createdAt);
    }

    if (sort === "title") {
      return String(a.title || "")
        .localeCompare(String(b.title || ""));
    }

    return sortModules(a, b);

  });

  return filtered;

}

function getModuleSectionText(data) {

  const ids = data.sectionIds || [];

  return ids.map(id => {

    const section = availableSections.find(
      item => item.id === id
    );

    return section
      ? getSectionLabel(section)
      : id;

  }).join(" ");

}

function applyModuleView() {

  renderModules(
    [...moduleCache.values()]
  );

}

/* =====================================================
   MODULE STATISTICS
===================================================== */

function updateModuleStats(items) {

  if (statTotal) {
    statTotal.textContent = items.length;
  }

  if (statActive) {
    statActive.textContent =
      items.filter(item => item.status === "active").length;
  }

  if (statDraft) {
    statDraft.textContent =
      items.filter(item =>
        item.status === "draft" || !item.status
      ).length;
  }

  if (statArchived) {
    statArchived.textContent =
      items.filter(item => item.status === "archived").length;
  }

}

/* =====================================================
   TIMESTAMP HELPERS
===================================================== */

function timestampValue(value) {

  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;

}

function formatDateTime(value) {

  if (!value) return "";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();

}

/* =====================================================
   FILE UPLOAD
===================================================== */

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

      snapshot => {

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

/* =====================================================
   UPLOAD PROGRESS
===================================================== */

function updateUploadProgress(bytes, total) {

  const now = performance.now();

  const percent = total
    ? Math.min(100, (bytes / total) * 100)
    : 0;

  const totalSeconds = Math.max(
    (now - uploadStartedAt) / 1000,
    0.25
  );

  const averageRate =
    bytes / totalSeconds;

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

/* =====================================================
   LOAD MODULES
===================================================== */

async function loadModules({ quiet = false } = {}) {

  if (!currentUser || !currentRole) return;

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

    const modulesQuery =
      currentRole === "admin"

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

    snapshot.forEach(item => {

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

/* =====================================================
   CACHE
===================================================== */

function renderCachedModules() {

  if (!moduleCacheKey) return;

  try {

    const cached = JSON.parse(
      localStorage.getItem(moduleCacheKey) || "[]"
    );

    if (!Array.isArray(cached) || !cached.length) {
      return;
    }

    cached.forEach(item => {

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

function saveModuleCache() {

  if (!moduleCacheKey) return;

  try {

    const safe = [...moduleCache.values()].map(item => ({

      id: item.id,

      title: item.title || "",

      description: item.description || "",

      order: item.order || 1,

      status: item.status || "draft",

      fileURL: item.fileURL || "",

      filePath: item.filePath || "",

      fileName: item.fileName || "",

      createdBy: item.createdBy || "",

      learningObjectives:
        item.learningObjectives || "",

      estimatedDuration:
        item.estimatedDuration || "",

      academicYear:
        item.academicYear || "",

      sectionIds:
        Array.isArray(item.sectionIds)
          ? item.sectionIds
          : [],

      availableAt:
        item.availableAt || "",

      dueDate:
        item.dueDate || "",

      videoUrl:
        item.videoUrl || "",

      resourceLinks:
        Array.isArray(item.resourceLinks)
          ? item.resourceLinks
          : []

    }));

    localStorage.setItem(
      moduleCacheKey,
      JSON.stringify(safe)
    );

  } catch (_) {}

}

/* =====================================================
   RENDER MODULES
===================================================== */

function renderModules(items, fromCache = false) {

  const allItems = [...items];

  updateModuleStats(allItems);

  const sorted = getFilteredModules(allItems);

  if (!sorted.length) {

    moduleList.innerHTML = `
      <div class="empty">
        <strong>No modules yet.</strong>
        <br>
        <small>
          ${
            allItems.length
              ? "No modules match your current search or filters."
              : "Click + Create Module to add learning content."
          }
        </small>
      </div>
    `;

    return;

  }

  const fragment =
    document.createDocumentFragment();

  sorted.forEach(data => {

    const card = document.createElement("article");

    card.className = "module-card";

    card.dataset.id = data.id;

    const status = data.status || "draft";

    const statusLabel =
      status === "active"
        ? "Published"
        : status === "archived"
          ? "Archived"
          : "Draft";

    const sectionLabels =
      (data.sectionIds || []).map(id => {

        const section = availableSections.find(
          item => item.id === id
        );

        return section
          ? getSectionLabel(section)
          : id;

      });

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
      Array.isArray(data.resourceLinks) &&
      data.resourceLinks.length

        ? data.resourceLinks.map(item => `

            <a
              class="file-link"
              href="${escapeAttribute(item.url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${resourceIcon(item.type)}
              ${escapeHTML(item.label || "Open resource")}
            </a>

          `).join("")

        : "";

    const sectionHTML =
      sectionLabels.length
        ? sectionLabels.map(label => `
            <span>${escapeHTML(label)}</span>
          `).join("")
        : "";

    card.innerHTML = `

      <div class="module-top">

        <h3 class="module-title">
          ${escapeHTML(data.title || "Untitled Module")}
        </h3>

        <span class="status ${escapeAttribute(status)}">
          ${statusLabel}
        </span>

      </div>

      <p class="module-description">
        ${escapeHTML(data.description || "No description.")}
      </p>

      <div class="module-meta-chips">

        ${sectionHTML}

        ${
          data.estimatedDuration
            ? `<span>${escapeHTML(data.estimatedDuration)} min</span>`
            : ""
        }

      </div>

      ${
        data.dueDate
          ? `<p class="module-deadline">Due: ${escapeHTML(formatDateTime(data.dueDate))}</p>`
          : ""
      }

      ${fileHTML}

      ${resourceHTML}

      ${
        data.videoUrl
          ? `
            <a
              class="file-link"
              href="${escapeAttribute(data.videoUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ▶ Open YouTube video
            </a>
          `
          : ""
      }

      <div class="module-info">
        Display order
        <strong>${Number(data.order) || "-"}</strong>

        ${
          fromCache
            ? '<span class="el-cache-label">cached</span>'
            : ""
        }
      </div>

      <div class="module-actions">

        <button
          class="edit-btn"
          data-action="edit"
          type="button"
        >
          Edit
        </button>

        ${
          status === "active"
            ? `
              <button
                class="archive-btn"
                data-action="archive"
                type="button"
              >
                Archive
              </button>
            `
            : ""
        }

        <button
          class="delete-btn"
          data-action="delete"
          type="button"
        >
          Delete
        </button>

      </div>

    `;

    fragment.appendChild(card);

  });

  moduleList.replaceChildren(fragment);

}

/* =====================================================
   RESOURCE ICONS
===================================================== */

function resourceIcon(type) {

  const icons = {
    drive: "🔺",
    forms: "▤",
    drawings: "✎",
    sheets: "▦",
    slides: "▣",
    docs: "▤",
    pdf: "PDF"
  };

  return icons[type] || "↗";

}

/* =====================================================
   MODULE ACTIONS
===================================================== */

moduleList?.addEventListener("click", event => {

  const button = event.target.closest(
    "button[data-action]"
  );

  if (!button) return;

  const card = button.closest(".module-card");

  if (!card?.dataset.id) return;

  const id = card.dataset.id;

  if (button.dataset.action === "edit") {
    editModule(id);
  }

  if (button.dataset.action === "archive") {
    archiveModule(id);
  }

  if (button.dataset.action === "delete") {
    deleteModule(id);
  }

});

/* =====================================================
   EDIT MODULE
===================================================== */

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

    resetForm();

    editingId = id;

    title.value =
      selectedData.title || "";

    description.value =
      selectedData.description || "";

    moduleOrder.value =
      selectedData.order || "";

    if (learningObjectives) {
      learningObjectives.value =
        selectedData.learningObjectives || "";
    }

    if (estimatedDuration) {
      estimatedDuration.value =
        selectedData.estimatedDuration || "";
    }

  

    if (availableAt) {
      availableAt.value =
        selectedData.availableAt || "";
    }

    if (dueDate) {
      dueDate.value =
        selectedData.dueDate || "";
    }

    if (videoUrl) {
      videoUrl.value =
        selectedData.videoUrl || "";
    }

    resourceLinks =
      Array.isArray(selectedData.resourceLinks)

        ? selectedData.resourceLinks
            .filter(item =>
              item &&
              typeof item.url === "string"
            )
            .map(item => {

              try {

                const parsed = new URL(item.url);

                if (
                  !["https:", "http:"].includes(parsed.protocol)
                ) {
                  return null;
                }

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

      const selectedIds = new Set(
        selectedData.sectionIds || []
      );

      [...sectionSelect.options].forEach(option => {

        option.selected =
          selectedIds.has(option.value);

      });

    }

    updateAssignmentSummary();

    currentFileURL =
      selectedData.fileURL || "";

    currentFilePath =
      selectedData.filePath || "";

    currentFileName =
      selectedData.fileName || "";

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

      existingFile.innerHTML = "";

    }

    modalTitle.textContent =
      statusLabelForEditor(selectedData.status);

    modal.classList.add("show");

    editorInitialSnapshot =
      getEditorSnapshot();

    requestAnimationFrame(() => {
      title.focus();
    });

  } catch (error) {

    console.error(
      "Edit module error:",
      error
    );

    alert(
      error.message || "Unable to load module."
    );

  }

}

function statusLabelForEditor(status) {

  if (status === "active") {
    return "Edit Published Module";
  }

  if (status === "archived") {
    return "Edit Archived Module";
  }

  return "Edit Draft";

}

window.editModule = editModule;

/* =====================================================
   ARCHIVE MODULE
===================================================== */

async function archiveModule(id) {

  if (!currentUser) return;

  const data = moduleCache.get(id);

  if (!data) {

    alert("Module not found.");

    return;

  }

  if (
    currentRole !== "admin" &&
    data.createdBy !== currentUser.uid
  ) {

    alert(
      "You can archive only modules you created."
    );

    return;

  }

  if (data.status !== "active") return;

  const confirmed = confirm(
    `Archive "${data.title || "this module"}"?\n\nArchived modules will no longer be treated as published.`
  );

  if (!confirmed) return;

  try {

    const moduleRef = doc(
      db,
      "modules",
      id
    );

    const snap = await getDoc(moduleRef);

    if (!snap.exists()) {
      throw new Error("Module not found.");
    }

    const existingData = snap.data();

    if (
      currentRole !== "admin" &&
      existingData.createdBy !== currentUser.uid
    ) {

      throw new Error(
        "You can archive only modules you created."
      );

    }

    await updateDoc(moduleRef, {

      status: "archived",

      archivedAt: serverTimestamp(),

      archivedBy: currentUser.uid,

      updatedAt: serverTimestamp()

    });

    moduleCache.set(id, {

      ...data,

      status: "archived",

      updatedAt: Date.now()

    });

    saveModuleCache();

    renderModules(
      [...moduleCache.values()]
    );

  } catch (error) {

    console.error(
      "Archive module error:",
      error
    );

    alert(
      error.message || "Unable to archive module."
    );

  }

}

window.archiveModule = archiveModule;

/* =====================================================
   DELETE MODULE
===================================================== */

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
      `Delete "${data?.title || "this module"}"? This action cannot be undone.`
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

    if (target.filePath) {

      deleteObject(
        ref(storage, target.filePath)
      ).catch(error => {

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

/* =====================================================
   RESOURCE LINKS LIST
===================================================== */

function renderResourceLinks() {

  if (!resourceLinksList) return;

  resourceLinksList.replaceChildren();

  resourceLinks.forEach((item, index) => {

    const row = document.createElement("div");

    row.className = "resource-link-row";

    const info = document.createElement("span");

    info.textContent =
      `${item.label}: ${item.url}`;

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

/* =====================================================
   RESET FORM
===================================================== */

function resetForm() {

  editingId = null;

  currentFileURL = "";
  currentFilePath = "";
  currentFileName = "";

  resourceLinks = [];

  openedResourceType = null;

  if (title) title.value = "";

  if (description) description.value = "";

  if (moduleOrder) moduleOrder.value = "";

  if (learningObjectives) {
    learningObjectives.value = "";
  }

  if (estimatedDuration) {
    estimatedDuration.value = "";
  }

  if (availableAt) {
    availableAt.value = "";
  }

  if (dueDate) {
    dueDate.value = "";
  }

  if (videoUrl) {
    videoUrl.value = "";
  }

  if (sectionSelect) {

    [...sectionSelect.options].forEach(option => {
      option.selected = false;
    });

  }

  if (cameraPhotoInput) {
    cameraPhotoInput.value = "";
  }

  if (pickPhotoInput) {
    pickPhotoInput.value = "";
  }

  if (recordVideoInput) {
    recordVideoInput.value = "";
  }

  if (moduleFile) {
    moduleFile.value = "";
    moduleFile.disabled = false;
    moduleFile.accept =
      ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov";
  }

  if (existingFile) {
    existingFile.style.display = "none";
    existingFile.innerHTML = "";
  }

  if (selectedFile) {
    selectedFile.style.display = "none";
    selectedFile.innerHTML = "";
  }

  renderResourceLinks();

  updateAssignmentSummary();

  showUploadPanel(false);

  if (progressBar) {
    progressBar.style.width = "0%";
  }

  if (progressText) {
    progressText.textContent = "Ready to upload";
  }

  if (message) {
    message.textContent = "";
    message.className = "message";
  }

  activeUploadTask = null;

  editorInitialSnapshot = "";

  setEditorBusy(false);

}

/* =====================================================
   EDITOR BUSY STATE
===================================================== */

function setEditorBusy(busy, label = "Saving…") {

  if (saveModule) {
    saveModule.disabled = busy;
  }

  if (moduleFile) {
    moduleFile.disabled = busy;
  }

  if (title) {
    title.disabled = busy;
  }

  if (description) {
    description.disabled = busy;
  }

  if (moduleOrder) {
    moduleOrder.disabled = busy;
  }

  if (closeModal) {
    closeModal.disabled = busy;
  }

  if (cancelEdit) {
    cancelEdit.disabled = busy;
  }

  if (saveModule) {

    saveModule.textContent =
      busy
        ? label
        : "Publish Module";

  }

  modal?.classList.toggle(
    "is-busy",
    busy
  );

}

/* =====================================================
   UPLOAD PANEL
===================================================== */

function showUploadPanel(show) {

  if (uploadProgress) {
    uploadProgress.style.display =
      show ? "block" : "none";
  }

  if (cancelUpload) {
    cancelUpload.hidden = !show;
  }

}

/* =====================================================
   FILE VALIDATION
===================================================== */

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

/* =====================================================
   MESSAGE
===================================================== */

function showMessage(text, type = "info") {

  if (!message) return;

  message.textContent = text;

  message.className =
    `message ${type}`;

}

/* =====================================================
   SORT MODULES
===================================================== */

function sortModules(a, b) {

  return (
    (Number(a.order) || 0) -
    (Number(b.order) || 0)
  );

}

/* =====================================================
   FORMAT UPLOAD SPEED
===================================================== */

function formatRate(bytesPerSecond) {

  return bytesPerSecond > 0
    ? `${formatFileSize(bytesPerSecond)}/s`
    : "starting…";

}

/* =====================================================
   FORMAT ETA
===================================================== */

function formatEta(seconds) {

  const s = Math.max(
    1,
    Math.round(seconds)
  );

  return s < 60
    ? `${s}s`
    : `${Math.ceil(s / 60)}m`;

}

/* =====================================================
   FORMAT FILE SIZE
===================================================== */

function formatFileSize(bytes) {

  if (!bytes) return "0 B";

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

/* =====================================================
   READABLE UPLOAD ERRORS
===================================================== */

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

  if (error?.code === "permission-denied") {

    return "Firestore permission denied. Check your Firestore Security Rules.";

  }

  return error?.message ||
    "Unable to save the module.";

}

/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHTML(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}

/* =====================================================
   ESCAPE HTML ATTRIBUTES
===================================================== */

function escapeAttribute(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

}