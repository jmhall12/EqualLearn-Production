
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ==========================================
// DOM ELEMENTS
// ==========================================

const $ = (id) => document.getElementById(id);

const lessonList = $("lessonList");
const modal = $("lessonModal");
const openModal = $("openModal");
const closeModal = $("closeModal");
const cancelBtn = $("cancelBtn");
const saveLesson = $("saveLesson");
const modalTitle = $("modalTitle");

const moduleSelect = $("moduleSelect");
const lessonTitle = $("lessonTitle");
const lessonDescription = $("lessonDescription");
const lessonFile = $("lessonFile");
const videoUrl = $("videoUrl");

const uploadStatus = $("uploadStatus");
const currentFile = $("currentFile");


// ==========================================
// CONFIGURATION
// ==========================================

// Firestore maximum document size is 1 MiB.
// Base64 increases file size by approximately 33%.
// Keep attachment size limited to leave room for
// lesson title, description, and other document data.

const MAX_FILE_SIZE = 500 * 1024;

const ALLOWED_EXTENSIONS = new Set([
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
  "webp"
]);


// ==========================================
// STATE
// ==========================================

let currentUser = null;
let editingLessonId = null;

let existingFileUrl = "";
let existingFileName = "";
let existingFilePath = "";

let existingFileData = "";
let existingFileMime = "";
let existingFileSize = 0;

let modules = [];
let lessons = [];

let activeReader = null;
let uploadCancelled = false;
let isBusy = false;


// ==========================================
// UPLOAD PANEL
// ==========================================

const uploadPanel = document.createElement("div");

uploadPanel.className = "el-upload-panel";
uploadPanel.hidden = true;

uploadPanel.innerHTML = `
  <div class="el-upload-head">
    <strong id="lessonUploadTitle">Preparing attachment</strong>
    <span id="lessonUploadPercent">0%</span>
  </div>

  <div class="el-upload-track">
    <span id="lessonUploadBar"></span>
  </div>

  <div class="el-upload-meta" id="lessonUploadMeta">
    Waiting for file...
  </div>

  <button
    type="button"
    class="el-upload-cancel"
    id="lessonCancelUpload"
  >
    Cancel upload
  </button>
`;

uploadStatus?.insertAdjacentElement("afterend", uploadPanel);

const lessonUploadTitle = $("lessonUploadTitle");
const lessonUploadPercent = $("lessonUploadPercent");
const lessonUploadBar = $("lessonUploadBar");
const lessonUploadMeta = $("lessonUploadMeta");
const lessonCancelUpload = $("lessonCancelUpload");


// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  await loadModules();
  await loadLessons();
});


// ==========================================
// MODULE LOADING
// ==========================================

async function loadModules() {
  moduleSelect.innerHTML = `
    <option value="">Select Module</option>
  `;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "modules"),
        where("createdBy", "==", currentUser.uid),
        orderBy("order", "asc")
      )
    );

    modules = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    const fragment = document.createDocumentFragment();

    modules.forEach((module) => {
      const option = document.createElement("option");

      option.value = module.id;

      option.textContent =
        module.title ||
        module.name ||
        "Untitled Module";

      fragment.appendChild(option);
    });

    moduleSelect.appendChild(fragment);

  } catch (error) {
    console.error("Module loading error:", error);

    moduleSelect.innerHTML = `
      <option value="">Unable to load modules</option>
    `;

    if (error.code === "failed-precondition") {
      console.error(
        "A Firestore composite index may be required:",
        error.message
      );
    }
  }
}


// ==========================================
// LESSON LOADING
// ==========================================

async function loadLessons() {
  lessonList.innerHTML = `
    <div class="message-box">
      <span class="el-inline-spinner"></span>
      <strong>Loading lessons…</strong>
      <small>Syncing the latest content</small>
    </div>
  `;

  try {
    const snapshot = await getDocs(
      collection(db, "lessons")
    );

    lessons = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    lessons.sort(
      (a, b) =>
        (b.createdAt?.seconds || 0) -
        (a.createdAt?.seconds || 0)
    );

    renderLessons();

  } catch (error) {
    console.error("Lesson loading error:", error);

    lessonList.innerHTML = `
      <div class="message-box">
        Unable to load lessons.
        <br>
        <small>${escapeHTML(error.message)}</small>
      </div>
    `;
  }
}


// ==========================================
// RENDER LESSONS
// ==========================================

function renderLessons() {
  if (!lessons.length) {
    lessonList.innerHTML = `
      <div class="message-box">
        <strong>No lessons yet.</strong>
        <br>
        <small>Click + Add Lesson to create one.</small>
      </div>
    `;

    return;
  }

  const fragment = document.createDocumentFragment();

  lessons.forEach((lesson) => {
    const module = modules.find(
      (item) => item.id === lesson.moduleId
    );

    const moduleName =
      module?.title ||
      lesson.moduleName ||
      "No module";

    const card = document.createElement("article");

    card.className = "lesson-card";
    card.dataset.id = lesson.id;

    const hasFirestoreFile =
      Boolean(lesson.fileDataBase64);

    const hasLegacyFile =
      Boolean(lesson.fileUrl);

    let fileHTML = "";

    if (hasFirestoreFile || hasLegacyFile) {
      fileHTML = `
        <div class="file-info">
          <strong>
            ${escapeHTML(lesson.fileName || "Lesson File")}
          </strong>

          <br>

          <a
            href="${escapeAttribute(getLessonFileURL(lesson))}"
            download="${escapeAttribute(lesson.fileName || "lesson-file")}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open / Download attachment →
          </a>

          ${
            hasFirestoreFile
              ? `<small>Stored in Firestore</small>`
              : `<small>Legacy attachment</small>`
          }
        </div>
      `;
    }

    const videoHTML = lesson.videoUrl
      ? `
        <div class="video-info">
          <a
            href="${escapeAttribute(lesson.videoUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch video →
          </a>
        </div>
      `
      : "";

    card.innerHTML = `
      <span class="module-badge">
        ${escapeHTML(moduleName)}
      </span>

      <h2>
        ${escapeHTML(lesson.title || "Untitled Lesson")}
      </h2>

      <p class="lesson-description">
        ${escapeHTML(lesson.description || "No description.")}
      </p>

      ${fileHTML}
      ${videoHTML}

      <div class="actions">
        <button class="edit-btn" data-action="edit">
          Edit
        </button>

        <button class="delete-btn" data-action="delete">
          Delete
        </button>
      </div>
    `;

    fragment.appendChild(card);
  });

  lessonList.replaceChildren(fragment);
}


// ==========================================
// ATTACHMENT DATA URL
// ==========================================

function getLessonFileURL(lesson) {
  if (lesson.fileDataBase64) {
    const mime =
      lesson.fileMimeType ||
      "application/octet-stream";

    return `data:${mime};base64,${lesson.fileDataBase64}`;
  }

  // Support old Storage-based lesson records.
  return lesson.fileUrl || "";
}


// ==========================================
// LESSON CARD ACTIONS
// ==========================================

lessonList?.addEventListener("click", (event) => {
  const button = event.target.closest(
    "button[data-action]"
  );

  if (!button) return;

  const id = button.closest(".lesson-card")?.dataset.id;

  if (!id) return;

  if (button.dataset.action === "edit") {
    editLesson(id);
  }

  if (button.dataset.action === "delete") {
    deleteLesson(id);
  }
});


// ==========================================
// MODAL EVENTS
// ==========================================

openModal?.addEventListener("click", () => {
  resetForm();

  modalTitle.textContent = "Add Lesson";

  modal.classList.add("show");

  requestAnimationFrame(() => {
    lessonTitle.focus();
  });
});

closeModal?.addEventListener(
  "click",
  closeLessonModal
);

cancelBtn?.addEventListener(
  "click",
  closeLessonModal
);

modal?.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeLessonModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    modal?.classList.contains("show")
  ) {
    closeLessonModal();
  }
});


// ==========================================
// FILE SELECTION
// ==========================================

lessonFile?.addEventListener("change", () => {
  const file = lessonFile.files?.[0];

  if (!file) {
    uploadStatus.textContent = "";
    return;
  }

  try {
    validateFile(file);

    uploadStatus.classList.remove("error");

    uploadStatus.textContent =
      `${file.name} • ${formatFileSize(file.size)} • ready to save`;

  } catch (error) {
    lessonFile.value = "";

    showLessonStatus(error.message, true);
  }
});


// ==========================================
// EDIT LESSON
// ==========================================

function editLesson(id) {
  const lesson = lessons.find(
    (item) => item.id === id
  );

  if (!lesson) return;

  resetForm();

  editingLessonId = id;

  modalTitle.textContent = "Edit Lesson";

  moduleSelect.value = lesson.moduleId || "";

  lessonTitle.value = lesson.title || "";

  lessonDescription.value =
    lesson.description || "";

  videoUrl.value = lesson.videoUrl || "";

  existingFileUrl = lesson.fileUrl || "";
  existingFileName = lesson.fileName || "";
  existingFilePath = lesson.filePath || "";

  existingFileData =
    lesson.fileDataBase64 || "";

  existingFileMime =
    lesson.fileMimeType || "";

  existingFileSize =
    lesson.fileSize || 0;

  if (
    existingFileName ||
    existingFileUrl ||
    existingFileData
  ) {
    currentFile.style.display = "block";

    currentFile.innerHTML = `
      <strong>Current attachment</strong>
      <br>

      ${escapeHTML(existingFileName || "Lesson file")}

      ${
        existingFileData || existingFileUrl
          ? `
            <br>
            <a
              href="${escapeAttribute(
                getLessonFileURL(lesson)
              )}"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open file →
            </a>
          `
          : ""
      }

      <br>

      <small>
        Select a new file only to replace it.
      </small>
    `;
  }

  modal.classList.add("show");

  requestAnimationFrame(() => {
    lessonTitle.focus();
  });
}


// ==========================================
// SAVE LESSON
// ==========================================

saveLesson?.addEventListener("click", async () => {
  if (isBusy) return;

  const moduleId = moduleSelect.value;

  const titleValue = lessonTitle.value.trim();

  const descriptionValue =
    lessonDescription.value.trim();

  const youtube = videoUrl.value.trim();

  const file = lessonFile.files?.[0] || null;

  if (!moduleId) {
    return showLessonStatus(
      "Please select a module.",
      true
    );
  }

  if (!titleValue) {
    return showLessonStatus(
      "Please enter the lesson title.",
      true
    );
  }

  if (file) {
    try {
      validateFile(file);
    } catch (error) {
      return showLessonStatus(
        error.message,
        true
      );
    }
  }

  setBusy(true, file
    ? "Preparing attachment..."
    : "Saving lesson..."
  );

  uploadCancelled = false;

  try {
    let fileDataBase64 = existingFileData;
    let fileMimeType = existingFileMime;
    let fileName = existingFileName;
    let fileSize = existingFileSize;

    let fileUrl = existingFileUrl;
    let filePath = existingFilePath;

    if (file) {
      const attachment = await readFileAsBase64(file);

      if (uploadCancelled) {
        throw new Error("Upload cancelled.");
      }

      fileDataBase64 = attachment.base64;
      fileMimeType = attachment.mime;
      fileName = file.name;
      fileSize = file.size;

      // New Firestore attachments no longer use Storage URLs.
      fileUrl = "";
      filePath = "";
    }

    if (uploadCancelled) {
      throw new Error("Upload cancelled.");
    }

    const selectedModule = modules.find(
      (item) => item.id === moduleId
    );

    const moduleName =
      selectedModule?.title ||
      selectedModule?.name ||
      "";

    const payload = {
      moduleId,
      moduleName,

      title: titleValue,
      description: descriptionValue,

      fileUrl,
      filePath,
      fileName,

      fileDataBase64,
      fileMimeType,
      fileSize,

      videoUrl: youtube,

      updatedAt: serverTimestamp()
    };

    setUploadProgress(
      95,
      "Saving lesson to Firestore..."
    );

    if (editingLessonId) {
      await updateDoc(
        doc(db, "lessons", editingLessonId),
        payload
      );

      const index = lessons.findIndex(
        (item) => item.id === editingLessonId
      );

      if (index >= 0) {
        lessons[index] = {
          ...lessons[index],
          ...payload
        };
      }

    } else {
      const created = await addDoc(
        collection(db, "lessons"),
        {
          ...payload,
          createdBy: currentUser.uid,
          createdAt: serverTimestamp()
        }
      );

      lessons.unshift({
        id: created.id,
        ...payload,
        createdAt: {
          seconds: Math.floor(Date.now() / 1000)
        }
      });
    }

    setUploadProgress(
      100,
      "Lesson saved successfully."
    );

    renderLessons();

    closeLessonModal(true);

    await loadLessons();

  } catch (error) {
    console.error("Save lesson error:", error);

    showLessonStatus(
      readableUploadError(error),
      true
    );

  } finally {
    activeReader = null;

    uploadCancelled = false;

    setBusy(false);
  }
});


// ==========================================
// READ FILE AND CONVERT TO BASE64
// ==========================================

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    activeReader = reader;

    uploadPanel.hidden = false;

    lessonUploadTitle.textContent =
      "Reading attachment";

    setUploadProgress(
      0,
      `Preparing ${file.name}...`
    );

    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const percent = Math.round(
        (event.loaded / event.total) * 85
      );

      setUploadProgress(
        percent,
        `${formatFileSize(event.loaded)} of ${formatFileSize(event.total)}`
      );
    };

    reader.onload = () => {
      if (uploadCancelled) {
        reject(new Error("Upload cancelled."));
        return;
      }

      const result = String(reader.result || "");

      const parts = result.split(",");

      const base64 = parts[1];

      if (!base64) {
        reject(
          new Error("Unable to convert attachment.")
        );

        return;
      }

      resolve({
        base64,
        mime: file.type || "application/octet-stream"
      });
    };

    reader.onerror = () => {
      reject(
        new Error("Unable to read the selected file.")
      );
    };

    reader.onabort = () => {
      reject(
        new Error("Upload cancelled.")
      );
    };

    reader.readAsDataURL(file);
  });
}


// ==========================================
// CANCEL UPLOAD
// ==========================================

lessonCancelUpload?.addEventListener("click", () => {
  if (!isBusy) return;

  uploadCancelled = true;

  if (activeReader && activeReader.readyState === FileReader.LOADING) {
    activeReader.abort();
  } else {
    showLessonStatus(
      "The file is already being saved to Firestore. Please wait for the operation to finish.",
      true
    );
  }
});


// ==========================================
// UPLOAD PROGRESS DISPLAY
// ==========================================

function setUploadProgress(percent, text) {
  const safePercent = Math.max(
    0,
    Math.min(100, percent)
  );

  uploadPanel.hidden = false;

  lessonUploadBar.style.width =
    `${safePercent}%`;

  lessonUploadPercent.textContent =
    `${Math.round(safePercent)}%`;

  lessonUploadMeta.textContent = text;
}


// ==========================================
// DELETE LESSON
// ==========================================

async function deleteLesson(id) {
  const lesson = lessons.find(
    (item) => item.id === id
  );

  if (!lesson) return;

  const confirmed = confirm(
    `Delete "${lesson.title || "this lesson"}"?`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(
      doc(db, "lessons", id)
    );

    lessons = lessons.filter(
      (item) => item.id !== id
    );

    renderLessons();

  } catch (error) {
    console.error("Delete lesson error:", error);

    alert(
      error.message || "Unable to delete lesson."
    );
  }
}


// ==========================================
// CLOSE MODAL
// ==========================================

function closeLessonModal(force = false) {
  if (!force && isBusy) {
    const confirmed = confirm(
      "An operation is still running. Cancel the file reading and close?"
    );

    if (!confirmed) return;

    uploadCancelled = true;

    if (
      activeReader &&
      activeReader.readyState === FileReader.LOADING
    ) {
      activeReader.abort();
    }

    return;
  }

  modal?.classList.remove("show");

  resetForm();
}


// ==========================================
// RESET FORM
// ==========================================

function resetForm() {
  editingLessonId = null;

  existingFileUrl = "";
  existingFileName = "";
  existingFilePath = "";

  existingFileData = "";
  existingFileMime = "";
  existingFileSize = 0;

  if (moduleSelect) moduleSelect.value = "";

  if (lessonTitle) lessonTitle.value = "";

  if (lessonDescription) {
    lessonDescription.value = "";
  }

  if (lessonFile) lessonFile.value = "";

  if (videoUrl) videoUrl.value = "";

  if (currentFile) {
    currentFile.style.display = "none";
    currentFile.innerHTML = "";
  }

  if (uploadStatus) {
    uploadStatus.textContent = "";
    uploadStatus.classList.remove("error");
  }

  uploadPanel.hidden = true;

  setUploadProgress(
    0,
    "Waiting for file..."
  );

  activeReader = null;
  uploadCancelled = false;

  setBusy(false);
}


// ==========================================
// BUSY STATE
// ==========================================

function setBusy(busy, label = "Saving...") {
  isBusy = busy;

  [
    moduleSelect,
    lessonTitle,
    lessonDescription,
    lessonFile,
    videoUrl,
    closeModal
  ].forEach((element) => {
    if (element) {
      element.disabled = busy;
    }
  });

  if (cancelBtn) {
    cancelBtn.disabled = busy;
  }

  if (saveLesson) {
    saveLesson.disabled = busy;

    saveLesson.textContent = busy
      ? label
      : "Save Lesson";
  }

  modal?.classList.toggle(
    "is-busy",
    busy
  );

  if (lessonCancelUpload) {
    lessonCancelUpload.disabled = !busy;
  }
}


// ==========================================
// STATUS MESSAGE
// ==========================================

function showLessonStatus(text, error = false) {
  if (!uploadStatus) return;

  uploadStatus.textContent = text;

  uploadStatus.classList.toggle(
    "error",
    error
  );
}


// ==========================================
// FILE VALIDATION
// ==========================================

function validateFile(file) {
  if (!file) {
    throw new Error("Please select a file.");
  }

  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is too large. Maximum allowed size is ${formatFileSize(MAX_FILE_SIZE)}.`
    );
  }

  const extension = file.name
    .split(".")
    .pop()
    ?.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      "This file type is not supported."
    );
  }
}


// ==========================================
// ERROR HANDLING
// ==========================================

function readableUploadError(error) {
  if (
    uploadCancelled ||
    error?.message === "Upload cancelled."
  ) {
    return "Attachment reading cancelled. The lesson was not saved.";
  }

  if (
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return "Firestore permission denied. Check your Firestore Rules.";
  }

  if (
    error?.code === "resource-exhausted"
  ) {
    return "Firestore document or quota limit reached. Try a smaller attachment.";
  }

  if (
    error?.code === "invalid-argument"
  ) {
    return "The attachment or lesson data is too large or invalid.";
  }

  return (
    error?.message ||
    "Unable to save the lesson."
  );
}


// ==========================================
// FILE SIZE FORMAT
// ==========================================

function formatFileSize(bytes) {
  if (!bytes) return "0 B";

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  const index = Math.min(
    units.length - 1,
    Math.floor(
      Math.log(bytes) / Math.log(1024)
    )
  );

  return `${(
    bytes / 1024 ** index
  ).toFixed(index ? 1 : 0)} ${units[index]}`;
}


// ==========================================
// HTML ESCAPING
// ==========================================

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
