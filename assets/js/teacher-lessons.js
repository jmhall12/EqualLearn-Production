
<<<<<<< HEAD
import { auth, db, storage } from "./firebase-config.js";
=======
import { auth, db } from "./firebase-config.js";
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
<<<<<<< HEAD
  getDoc,
=======
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

<<<<<<< HEAD
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";
=======

// ==========================================
// DOM ELEMENTS
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

<<<<<<< HEAD
const MAX_FILE_SIZE = 20 * 1024 * 1024;
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

let currentUser = null;
let currentRole = "";

let editingLessonId = null;

let existingFileUrl = "";
let existingFileName = "";
let existingFilePath = "";

<<<<<<< HEAD
let modules = [];
let lessons = [];

let activeUploadTask = null;
let uploadStartedAt = 0;
let lastProgressBytes = 0;
let lastProgressTime = 0;
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

let isSaving = false;

// ========================================
// UPLOAD PANEL
// ========================================

const uploadPanel = document.createElement("div");

uploadPanel.className = "el-upload-panel";
uploadPanel.hidden = true;

uploadPanel.innerHTML = `
  <div class="el-upload-head">
<<<<<<< HEAD
    <strong>Uploading attachment</strong>
=======
    <strong id="lessonUploadTitle">Preparing attachment</strong>
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
    <span id="lessonUploadPercent">0%</span>
  </div>

  <div class="el-upload-track">
    <span id="lessonUploadBar"></span>
  </div>

  <div class="el-upload-meta" id="lessonUploadMeta">
<<<<<<< HEAD
    Preparing upload…
=======
    Waiting for file...
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
  </div>

  <button
    type="button"
    class="el-upload-cancel"
<<<<<<< HEAD
    id="lessonCancelUpload">
=======
    id="lessonCancelUpload"
  >
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
    Cancel upload
  </button>
`;

uploadStatus?.insertAdjacentElement("afterend", uploadPanel);

<<<<<<< HEAD
=======
const lessonUploadTitle = $("lessonUploadTitle");
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
const lessonUploadPercent = $("lessonUploadPercent");
const lessonUploadBar = $("lessonUploadBar");
const lessonUploadMeta = $("lessonUploadMeta");
const lessonCancelUpload = $("lessonCancelUpload");

<<<<<<< HEAD
lessonCancelUpload?.addEventListener("click", () => {
  if (!activeUploadTask) return;

  activeUploadTask.cancel();
});

// ========================================
// AUTHENTICATION AND ROLE VERIFICATION
// ========================================
=======

// ==========================================
// AUTHENTICATION
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
<<<<<<< HEAD

  currentUser = user;
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

    moduleSelect.innerHTML = `
      <option value="">Unable to load modules</option>
    `;

<<<<<<< HEAD
    throw error;
  }
}

// ========================================
// LOAD LESSONS
// ========================================
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

async function loadLessons() {
  lessonList.innerHTML = `
    <div class="message-box">
      <span class="el-inline-spinner"></span>
      <strong>Loading lessons…</strong>
      <small>Syncing the latest content</small>
    </div>
  `;

  try {
<<<<<<< HEAD
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
=======
    const snapshot = await getDocs(
      collection(db, "lessons")
    );
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

    lessons = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

<<<<<<< HEAD
=======
    lessons.sort(
      (a, b) =>
        (b.createdAt?.seconds || 0) -
        (a.createdAt?.seconds || 0)
    );

>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
    renderLessons();

  } catch (error) {
    console.error("Lesson loading error:", error);

    lessonList.innerHTML = `
      <div class="message-box">
<<<<<<< HEAD
        <strong>Unable to load lessons.</strong>
=======
        Unable to load lessons.
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
        <br>
        <small>${escapeHTML(error.message)}</small>
      </div>
    `;
  }
}

<<<<<<< HEAD
// ========================================
// RENDER LESSONS
// ========================================
=======

// ==========================================
// RENDER LESSONS
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

<<<<<<< HEAD
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
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

    const videoHTML = lesson.videoUrl
      ? `
        <div class="video-info">
          <a
            href="${escapeAttribute(lesson.videoUrl)}"
            target="_blank"
<<<<<<< HEAD
            rel="noopener noreferrer">
=======
            rel="noopener noreferrer"
          >
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
            Watch video →
          </a>
        </div>
      `
      : "";

    card.innerHTML = `
      <span class="module-badge">
        ${escapeHTML(moduleName)}
      </span>

<<<<<<< HEAD
      <h2>${escapeHTML(lesson.title || "Untitled Lesson")}</h2>
=======
      <h2>
        ${escapeHTML(lesson.title || "Untitled Lesson")}
      </h2>
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

<<<<<<< HEAD
// ========================================
// LESSON ACTIONS
// ========================================

lessonList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

<<<<<<< HEAD
// ========================================
// OPEN AND CLOSE MODAL
// ========================================
=======

// ==========================================
// MODAL EVENTS
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

openModal?.addEventListener("click", () => {
  resetForm();

  modalTitle.textContent = "Add Lesson";

  modal.classList.add("show");

<<<<<<< HEAD
  requestAnimationFrame(() => lessonTitle.focus());
});

closeModal?.addEventListener("click", closeLessonModal);

cancelBtn?.addEventListener("click", closeLessonModal);
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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

<<<<<<< HEAD
// ========================================
// FILE SELECTION
// ========================================
=======

// ==========================================
// FILE SELECTION
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

lessonFile?.addEventListener("change", () => {
  const file = lessonFile.files?.[0];

  if (!file) {
    uploadStatus.textContent = "";
    return;
  }

  try {
    validateFile(file);

<<<<<<< HEAD
    showLessonStatus(
      `${file.name} • ${formatFileSize(file.size)} • ready to upload`
    );
=======
    uploadStatus.classList.remove("error");

    uploadStatus.textContent =
      `${file.name} • ${formatFileSize(file.size)} • ready to save`;
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

  } catch (error) {
    lessonFile.value = "";

    showLessonStatus(error.message, true);
  }
});

<<<<<<< HEAD
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
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

  const moduleId = moduleSelect.value;

  const titleValue = lessonTitle.value.trim();

  const descriptionValue =
    lessonDescription.value.trim();

  const youtube = videoUrl.value.trim();

  const file = lessonFile.files?.[0] || null;

  if (!moduleId) {
<<<<<<< HEAD
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
=======
    return showLessonStatus(
      "Please select a module.",
      true
    );
  }

  if (!titleValue) {
    return showLessonStatus(
      "Please enter the lesson title.",
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
      true
    );
  }

  if (file) {
    try {
      validateFile(file);
    } catch (error) {
<<<<<<< HEAD
      return showLessonStatus(error.message, true);
    }
  }

  if (youtube && !isValidYouTubeURL(youtube)) {
    return showLessonStatus("Please enter a valid YouTube URL.", true);
  }

  isSaving = true;

  setBusy(true, file ? "Preparing upload…" : "Saving lesson…");

  const oldPath = existingFilePath;
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

  try {
    let fileDataBase64 = existingFileData;
    let fileMimeType = existingFileMime;
    let fileName = existingFileName;
    let fileSize = existingFileSize;

    let fileUrl = existingFileUrl;
    let filePath = existingFilePath;

    if (file) {
<<<<<<< HEAD
      const upload = await uploadLessonFile(file);

      fileUrl = upload.url;
=======
      const attachment = await readFileAsBase64(file);

      if (uploadCancelled) {
        throw new Error("Upload cancelled.");
      }

      fileDataBase64 = attachment.base64;
      fileMimeType = attachment.mime;
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
      fileName = file.name;
      fileSize = file.size;

      // New Firestore attachments no longer use Storage URLs.
      fileUrl = "";
      filePath = "";
    }

<<<<<<< HEAD
    const moduleName =
      selectedModule.title ||
      selectedModule.name ||
=======
    if (uploadCancelled) {
      throw new Error("Upload cancelled.");
    }

    const selectedModule = modules.find(
      (item) => item.id === moduleId
    );

    const moduleName =
      selectedModule?.title ||
      selectedModule?.name ||
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
      "";

    const payload = {
      moduleId,
      moduleName,
<<<<<<< HEAD
      title: titleValue,
      description: descriptionValue,
      fileUrl,
      fileName,
      filePath,
=======

      title: titleValue,
      description: descriptionValue,

      fileUrl,
      filePath,
      fileName,

      fileDataBase64,
      fileMimeType,
      fileSize,

>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
      videoUrl: youtube,

      updatedAt: serverTimestamp()
    };

    setUploadProgress(
      95,
      "Saving lesson to Firestore..."
    );

    if (editingLessonId) {
<<<<<<< HEAD
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

=======
      await updateDoc(
        doc(db, "lessons", editingLessonId),
        payload
      );

>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
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
<<<<<<< HEAD
        createdBy: currentUser.uid,
=======
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
        createdAt: {
          seconds: Math.floor(Date.now() / 1000)
        }
      });
    }

<<<<<<< HEAD
    if (file && oldPath && oldPath !== filePath) {
      deleteObject(
        ref(storage, oldPath)
      ).catch((error) => {
        console.warn("Old lesson file cleanup skipped:", error);
      });
    }
=======
    setUploadProgress(
      100,
      "Lesson saved successfully."
    );
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

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
<<<<<<< HEAD
    activeUploadTask = null;

    isSaving = false;
=======
    activeReader = null;

    uploadCancelled = false;
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

    setBusy(false);
  }
});

<<<<<<< HEAD
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
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

// ========================================
// DELETE LESSON
// ========================================

async function deleteLesson(id) {
  const lesson = lessons.find(
    (item) => item.id === id
  );

  if (!lesson) return;

<<<<<<< HEAD
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
=======
  const confirmed = confirm(
    `Delete "${lesson.title || "this lesson"}"?`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(
      doc(db, "lessons", id)
    );
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

    lessons = lessons.filter(
      (item) => item.id !== id
    );

    renderLessons();

<<<<<<< HEAD
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
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

  resetForm();
}

<<<<<<< HEAD
// ========================================
// RESET FORM
// ========================================
=======

// ==========================================
// RESET FORM
// ==========================================
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

function resetForm() {
  editingLessonId = null;

  existingFileUrl = "";
  existingFileName = "";
  existingFilePath = "";

<<<<<<< HEAD
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
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

  setBusy(false);
}

<<<<<<< HEAD
// ========================================
// BUSY STATE
// ========================================

function setBusy(busy, label = "Saving…") {
=======

// ==========================================
// BUSY STATE
// ==========================================

function setBusy(busy, label = "Saving...") {
  isBusy = busy;

>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
  [
    moduleSelect,
    lessonTitle,
    lessonDescription,
    lessonFile,
    videoUrl,
<<<<<<< HEAD
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
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

function showLessonStatus(text, error = false) {
  if (!uploadStatus) return;

  uploadStatus.textContent = text;

  uploadStatus.classList.toggle(
    "error",
    error
  );
}

<<<<<<< HEAD
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
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
    .split(".")
    .pop()
    ?.toLowerCase();

<<<<<<< HEAD
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
=======
  if (!ALLOWED_EXTENSIONS.has(extension)) {
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
    throw new Error(
      "This file type is not supported."
    );
  }
}

<<<<<<< HEAD
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
=======

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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f

function formatFileSize(bytes) {
  if (!bytes) return "0 B";

<<<<<<< HEAD
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
=======
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
>>>>>>> faae2a94bfd09f90b79508f5fcef52694676c81f
