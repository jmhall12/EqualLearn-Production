
import { auth, db, storage } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";

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

const MAX_FILE_SIZE = 20 * 1024 * 1024;

let currentUser = null;
let currentRole = "";

let editingLessonId = null;

let existingFileUrl = "";
let existingFileName = "";
let existingFilePath = "";

let modules = [];
let lessons = [];

let activeUploadTask = null;
let uploadStartedAt = 0;
let lastProgressBytes = 0;
let lastProgressTime = 0;

let isSaving = false;

// ========================================
// UPLOAD PANEL
// ========================================

const uploadPanel = document.createElement("div");

uploadPanel.className = "el-upload-panel";
uploadPanel.hidden = true;

uploadPanel.innerHTML = `
  <div class="el-upload-head">
    <strong>Uploading attachment</strong>
    <span id="lessonUploadPercent">0%</span>
  </div>

  <div class="el-upload-track">
    <span id="lessonUploadBar"></span>
  </div>

  <div class="el-upload-meta" id="lessonUploadMeta">
    Preparing upload…
  </div>

  <button
    type="button"
    class="el-upload-cancel"
    id="lessonCancelUpload">
    Cancel upload
  </button>
`;

uploadStatus?.insertAdjacentElement("afterend", uploadPanel);

const lessonUploadPercent = $("lessonUploadPercent");
const lessonUploadBar = $("lessonUploadBar");
const lessonUploadMeta = $("lessonUploadMeta");
const lessonCancelUpload = $("lessonCancelUpload");

lessonCancelUpload?.addEventListener("click", () => {
  if (!activeUploadTask) return;

  activeUploadTask.cancel();
});

// ========================================
// AUTHENTICATION AND ROLE VERIFICATION
// ========================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  try {
    const profileSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnap.exists()) {
      throw new Error("User profile not found.");
    }

    currentRole = String(
      profileSnap.data().role || ""
    ).trim().toLowerCase();

    if (!["teacher", "admin"].includes(currentRole)) {
      alert("Access denied. Teacher or administrator account required.");

      window.location.href =
        currentRole === "student"
          ? "../student/dashboard.html"
          : "../login.html";

      return;
    }

    await loadModules();
    await loadLessons();

  } catch (error) {
    console.error("Lesson page authentication error:", error);

    showPageError(
      "Unable to verify your account or load lesson permissions.",
      error
    );
  }
});

// ========================================
// PAGE ERROR
// ========================================

function showPageError(message, error) {
  if (lessonList) {
    lessonList.textContent =
      `${message} ${error?.message || ""}`;
  }
}

// ========================================
// LOAD MODULES
// ========================================

async function loadModules() {
  moduleSelect.innerHTML =
    `<option value="">Loading modules...</option>`;

  try {
    const modulesRef = collection(db, "modules");

    const modulesQuery =
      currentRole === "admin"
        ? query(
            modulesRef,
            orderBy("order", "asc")
          )
        : query(
            modulesRef,
            where("createdBy", "==", currentUser.uid),
            orderBy("order", "asc")
          );

    const snapshot = await getDocs(modulesQuery);

    modules = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    moduleSelect.replaceChildren(
      new Option("Select Module", "")
    );

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

    moduleSelect.innerHTML =
      `<option value="">Unable to load modules</option>`;

    throw error;
  }
}

// ========================================
// LOAD LESSONS
// ========================================

async function loadLessons() {
  lessonList.innerHTML = `
    <div class="message-box">
      <span class="el-inline-spinner"></span>
      <strong>Loading lessons…</strong>
      <small>Syncing the latest content</small>
    </div>
  `;

  try {
    const lessonsRef = collection(db, "lessons");

    const lessonsQuery =
      currentRole === "admin"
        ? query(
            lessonsRef,
            orderBy("createdAt", "desc")
          )
        : query(
            lessonsRef,
            where("createdBy", "==", currentUser.uid),
            orderBy("createdAt", "desc")
          );

    const snapshot = await getDocs(lessonsQuery);

    lessons = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    renderLessons();

  } catch (error) {
    console.error("Lesson loading error:", error);

    lessonList.innerHTML = `
      <div class="message-box">
        <strong>Unable to load lessons.</strong>
        <br>
        <small>${escapeHTML(error.message)}</small>
      </div>
    `;
  }
}

// ========================================
// RENDER LESSONS
// ========================================

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

    const fileHTML = lesson.fileUrl
      ? `
        <div class="file-info">
          <strong>${escapeHTML(lesson.fileName || "Lesson File")}</strong>
          <br>
          <a
            href="${escapeAttribute(lesson.fileUrl)}"
            target="_blank"
            rel="noopener noreferrer">
            Open attachment →
          </a>
        </div>
      `
      : "";

    const videoHTML = lesson.videoUrl
      ? `
        <div class="video-info">
          <a
            href="${escapeAttribute(lesson.videoUrl)}"
            target="_blank"
            rel="noopener noreferrer">
            Watch video →
          </a>
        </div>
      `
      : "";

    card.innerHTML = `
      <span class="module-badge">
        ${escapeHTML(moduleName)}
      </span>

      <h2>${escapeHTML(lesson.title || "Untitled Lesson")}</h2>

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

// ========================================
// LESSON ACTIONS
// ========================================

lessonList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

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

// ========================================
// OPEN AND CLOSE MODAL
// ========================================

openModal?.addEventListener("click", () => {
  resetForm();

  modalTitle.textContent = "Add Lesson";

  modal.classList.add("show");

  requestAnimationFrame(() => lessonTitle.focus());
});

closeModal?.addEventListener("click", closeLessonModal);

cancelBtn?.addEventListener("click", closeLessonModal);

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

// ========================================
// FILE SELECTION
// ========================================

lessonFile?.addEventListener("change", () => {
  const file = lessonFile.files?.[0];

  if (!file) {
    uploadStatus.textContent = "";
    return;
  }

  try {
    validateFile(file);

    showLessonStatus(
      `${file.name} • ${formatFileSize(file.size)} • ready to upload`
    );

  } catch (error) {
    lessonFile.value = "";

    showLessonStatus(error.message, true);
  }
});

// ========================================
// EDIT LESSON
// ========================================

async function editLesson(id) {
  try {
    const lesson = lessons.find(
      (item) => item.id === id
    );

    if (!lesson) {
      throw new Error("Lesson not found.");
    }

    if (
      currentRole !== "admin" &&
      lesson.createdBy !== currentUser.uid
    ) {
      throw new Error(
        "You can only edit lessons you created."
      );
    }

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

    if (existingFileName || existingFileUrl) {
      currentFile.style.display = "block";

      currentFile.innerHTML = `
        <strong>Current attachment</strong>
        <br>
        ${escapeHTML(existingFileName || "Lesson file")}
        ${
          existingFileUrl
            ? `
              <br>
              <a
                href="${escapeAttribute(existingFileUrl)}"
                target="_blank"
                rel="noopener noreferrer">
                Open file →
              </a>
            `
            : ""
        }
        <br>
        <small>Select a new file only to replace it.</small>
      `;
    } else {
      currentFile.style.display = "none";
    }

    modal.classList.add("show");

    requestAnimationFrame(() => lessonTitle.focus());

  } catch (error) {
    console.error("Edit lesson error:", error);

    alert(error.message || "Unable to edit lesson.");
  }
}

// ========================================
// SAVE LESSON
// ========================================

saveLesson?.addEventListener("click", async () => {
  if (isSaving) return;

  if (!currentUser || !currentRole) {
    return showLessonStatus(
      "Please sign in first.",
      true
    );
  }

  const moduleId = moduleSelect.value;
  const titleValue = lessonTitle.value.trim();
  const descriptionValue = lessonDescription.value.trim();
  const youtube = videoUrl.value.trim();
  const file = lessonFile.files?.[0] || null;

  if (!moduleId) {
    return showLessonStatus("Please select a module.", true);
  }

  if (!titleValue) {
    return showLessonStatus("Please enter the lesson title.", true);
  }

  const selectedModule = modules.find(
    (item) => item.id === moduleId
  );

  if (!selectedModule) {
    return showLessonStatus("Selected module is unavailable.", true);
  }

  if (
    currentRole !== "admin" &&
    selectedModule.createdBy !== currentUser.uid
  ) {
    return showLessonStatus(
      "You are not authorized to add lessons to this module.",
      true
    );
  }

  if (file) {
    try {
      validateFile(file);
    } catch (error) {
      return showLessonStatus(error.message, true);
    }
  }

  if (youtube && !isValidYouTubeURL(youtube)) {
    return showLessonStatus("Please enter a valid YouTube URL.", true);
  }

  isSaving = true;

  setBusy(true, file ? "Preparing upload…" : "Saving lesson…");

  const oldPath = existingFilePath;

  try {
    let fileUrl = existingFileUrl;
    let fileName = existingFileName;
    let filePath = existingFilePath;

    if (file) {
      const upload = await uploadLessonFile(file);

      fileUrl = upload.url;
      fileName = file.name;
      filePath = upload.path;
    }

    const moduleName =
      selectedModule.title ||
      selectedModule.name ||
      "";

    const payload = {
      moduleId,
      moduleName,
      title: titleValue,
      description: descriptionValue,
      fileUrl,
      fileName,
      filePath,
      videoUrl: youtube,
      updatedAt: serverTimestamp()
    };

    if (editingLessonId) {
      const lessonRef = doc(
        db,
        "lessons",
        editingLessonId
      );

      const existingSnap = await getDoc(lessonRef);

      if (!existingSnap.exists()) {
        throw new Error("Lesson not found.");
      }

      const existingData = existingSnap.data();

      if (
        currentRole !== "admin" &&
        existingData.createdBy !== currentUser.uid
      ) {
        throw new Error(
          "You can only edit lessons you created."
        );
      }

      await updateDoc(lessonRef, payload);

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
        createdBy: currentUser.uid,
        createdAt: {
          seconds: Math.floor(Date.now() / 1000)
        }
      });
    }

    if (file && oldPath && oldPath !== filePath) {
      deleteObject(
        ref(storage, oldPath)
      ).catch((error) => {
        console.warn("Old lesson file cleanup skipped:", error);
      });
    }

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
    activeUploadTask = null;

    isSaving = false;

    setBusy(false);
  }
});

// ========================================
// UPLOAD LESSON FILE
// ========================================

async function uploadLessonFile(file) {
  const safeName = file.name.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );

  const path =
    `lessons/${currentUser.uid}/${Date.now()}_${safeName}`;

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
  lastProgressBytes = 0;
  lastProgressTime = uploadStartedAt;

  uploadPanel.hidden = false;

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",

      (snapshot) => {
        updateLessonProgress(
          snapshot.bytesTransferred,
          snapshot.totalBytes
        );
      },

      reject,

      async () => {
        try {
          lessonUploadBar.style.width = "100%";
          lessonUploadPercent.textContent = "100%";

          lessonUploadMeta.textContent =
            "Upload complete. Saving lesson…";

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

// ========================================
// UPLOAD PROGRESS
// ========================================

function updateLessonProgress(bytes, total) {
  const now = performance.now();

  const percent = total
    ? Math.min(100, (bytes / total) * 100)
    : 0;

  const elapsed = Math.max(
    (now - uploadStartedAt) / 1000,
    0.25
  );

  const averageRate = bytes / elapsed;

  const interval = Math.max(
    (now - lastProgressTime) / 1000,
    0.05
  );

  const instantRate =
    (bytes - lastProgressBytes) / interval;

  const rate = instantRate > 0
    ? averageRate * 0.55 + instantRate * 0.45
    : averageRate;

  const eta = rate > 0
    ? Math.max(total - bytes, 0) / rate
    : 0;

  lessonUploadBar.style.width =
    `${percent.toFixed(1)}%`;

  lessonUploadPercent.textContent =
    `${Math.round(percent)}%`;

  lessonUploadMeta.textContent =
    `${formatFileSize(bytes)} of ${formatFileSize(total)} • ` +
    `${formatFileSize(rate)}/s` +
    `${eta > 1 ? ` • ${formatEta(eta)} left` : ""}`;

  saveLesson.textContent =
    percent < 100
      ? `Uploading ${Math.round(percent)}%`
      : "Saving lesson…";

  lastProgressBytes = bytes;
  lastProgressTime = now;
}

// ========================================
// DELETE LESSON
// ========================================

async function deleteLesson(id) {
  const lesson = lessons.find(
    (item) => item.id === id
  );

  if (!lesson) return;

  if (
    currentRole !== "admin" &&
    lesson.createdBy !== currentUser.uid
  ) {
    alert("You can only delete lessons you created.");
    return;
  }

  if (!confirm(`Delete "${lesson.title || "this lesson"}"?`)) {
    return;
  }

  try {
    const lessonRef = doc(db, "lessons", id);

    const snapshot = await getDoc(lessonRef);

    if (!snapshot.exists()) {
      throw new Error("Lesson not found.");
    }

    const data = snapshot.data();

    if (
      currentRole !== "admin" &&
      data.createdBy !== currentUser.uid
    ) {
      throw new Error("You are not authorized to delete this lesson.");
    }

    await deleteDoc(lessonRef);

    lessons = lessons.filter(
      (item) => item.id !== id
    );

    renderLessons();

    if (data.filePath) {
      deleteObject(
        ref(storage, data.filePath)
      ).catch((error) => {
        console.warn("Storage cleanup skipped:", error);
      });
    }

  } catch (error) {
    console.error("Delete lesson error:", error);

    alert(error.message || "Unable to delete lesson.");
  }
}

// ========================================
// CLOSE MODAL
// ========================================

function closeLessonModal(force = false) {
  if (isSaving && !force) {
    return;
  }

  if (!force && activeUploadTask) {
    if (!confirm("An upload is still running. Cancel the upload and close?")) {
      return;
    }

    activeUploadTask.cancel();

    return;
  }

  modal.classList.remove("show");

  resetForm();
}

// ========================================
// RESET FORM
// ========================================

function resetForm() {
  editingLessonId = null;

  existingFileUrl = "";
  existingFileName = "";
  existingFilePath = "";

  moduleSelect.value = "";
  lessonTitle.value = "";
  lessonDescription.value = "";
  lessonFile.value = "";
  videoUrl.value = "";

  currentFile.style.display = "none";
  currentFile.innerHTML = "";

  uploadStatus.textContent = "";
  uploadStatus.classList.remove("error");

  uploadPanel.hidden = true;

  lessonUploadBar.style.width = "0%";
  lessonUploadPercent.textContent = "0%";

  lessonUploadMeta.textContent =
    "Preparing upload…";

  activeUploadTask = null;

  setBusy(false);
}

// ========================================
// BUSY STATE
// ========================================

function setBusy(busy, label = "Saving…") {
  [
    moduleSelect,
    lessonTitle,
    lessonDescription,
    lessonFile,
    videoUrl,
    closeModal,
    cancelBtn
  ].forEach((element) => {
    if (element) element.disabled = busy;
  });

  saveLesson.disabled = busy;

  saveLesson.textContent =
    busy ? label : "Save Lesson";

  modal?.classList.toggle("is-busy", busy);
}

// ========================================
// STATUS MESSAGE
// ========================================

function showLessonStatus(text, error = false) {
  uploadStatus.textContent = text;

  uploadStatus.classList.toggle(
    "error",
    error
  );
}

// ========================================
// VALIDATE FILE
// ========================================

function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      "File is too large. Maximum size is 20 MB."
    );
  }

  const ext = file.name
    .split(".")
    .pop()
    ?.toLowerCase();

  const allowed = new Set([
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

  if (!allowed.has(ext)) {
    throw new Error(
      "This file type is not supported."
    );
  }
}

// ========================================
// VALIDATE YOUTUBE URL
// ========================================

function isValidYouTubeURL(value) {
  try {
    const parsed = new URL(value);

    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be"
      ].includes(parsed.hostname.toLowerCase())
    );

  } catch (_) {
    return false;
  }
}

// ========================================
// READABLE ERRORS
// ========================================

function readableUploadError(error) {
  if (error?.code === "storage/canceled") {
    return "Upload canceled. The lesson was not changed.";
  }

  if (error?.code === "storage/unauthorized") {
    return "Upload permission denied. Check Firebase Storage rules.";
  }

  if (error?.code === "storage/retry-limit-exceeded") {
    return "The upload timed out. Please try again.";
  }

  if (error?.code === "permission-denied") {
    return "Firestore permission denied. Check your Firestore Security Rules and teacher ownership.";
  }

  return error?.message ||
    "Unable to save the lesson.";
}

// ========================================
// FORMAT ETA
// ========================================

function formatEta(seconds) {
  const s = Math.max(
    1,
    Math.round(seconds)
  );

  return s < 60
    ? `${s}s`
    : `${Math.ceil(s / 60)}m`;
}

// ========================================
// FORMAT FILE SIZE
// ========================================

function formatFileSize(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];

  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );

  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

// ========================================
// ESCAPE HTML
// ========================================

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ========================================
// ESCAPE HTML ATTRIBUTES
// ========================================

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
