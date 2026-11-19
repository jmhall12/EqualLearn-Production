
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
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";

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
const lessonCategory = $("lessonCategory");

const uploadStatus = $("uploadStatus");
const currentFile = $("currentFile");

// ==========================================
// CONFIGURATION
// ==========================================

// Store small file binaries directly in Firestore as Base64.
// Firestore documents are limited to 1 MiB, so use share links for larger files.
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
  "webp",
  "csv",
  "mp4",
  "webm",
  "mov",
  "zip"
]);

// ==========================================
// STATE
// ==========================================

let currentUser = null;
let currentRole = "";

let modules = [];
let lessons = [];

let editingLessonId = null;

let existingFileUrl = "";
let existingFileName = "";
let existingFilePath = "";
let existingFileData = "";
let existingFileMime = "";
let existingFileSize = 0;

let activeUploadTask = null;
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
// AUTHENTICATION AND ROLE VERIFICATION
// ==========================================

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
      alert(
        "Access denied. Teacher or administrator account required."
      );

      window.location.href =
        currentRole === "student"
          ? "../student/dashboard.html"
          : "../login.html";

      return;
    }

    await loadModules();
    await loadLessons();

  } catch (error) {
    console.error(
      "Lesson page authentication error:",
      error
    );

    showPageError(
      "Unable to verify your account or load lesson permissions.",
      error
    );
  }
});

// ==========================================
// PAGE ERROR
// ==========================================

function showPageError(message, error) {
  if (!lessonList) return;

  lessonList.textContent =
    `${message} ${error?.message || ""}`;
}

// ==========================================
// LOAD MODULES
// ==========================================


async function loadModules() {
  if (!moduleSelect || !currentUser) return;

  moduleSelect.innerHTML =
    `<option value="">Loading modules...</option>`;

  try {
    const modulesRef = collection(db, "modules");
    let snapshots = [];

    if (currentRole === "admin") {
      snapshots = [await getDocs(modulesRef)];
    } else {
      const [assignedSnap, ownedSnap] = await Promise.all([
        // Admin modules approved and assigned to this teacher
        getDocs(query(
          modulesRef,
          where("createdByRole", "==", "admin"),
          where("reviewStatus", "==", "approved"),
          where("assignedTeacherId", "==", currentUser.uid),
          where("status", "==", "active")
        )),

        // Modules created by this teacher
        getDocs(query(
          modulesRef,
          where("createdBy", "==", currentUser.uid)
        ))
      ]);

      snapshots = [assignedSnap, ownedSnap];
    }

    const unique = new Map();

    snapshots.forEach(snapshot => {
      snapshot.docs.forEach(item => {
        const data = item.data();

        const isOwn =
          data.createdBy === currentUser.uid;

        const isAssigned =
          data.createdByRole === "admin" &&
          data.reviewStatus === "approved" &&
          data.assignedTeacherId === currentUser.uid &&
          data.status === "active";

        if (
          currentRole === "admin" ||
          isOwn ||
          isAssigned
        ) {
          unique.set(item.id, {
            id: item.id,
            ...data
          });
        }
      });
    });

    modules = [...unique.values()].sort((a, b) =>
      Number(a.order || 9999) -
      Number(b.order || 9999)
    );

    moduleSelect.replaceChildren(
      new Option(
        modules.length
          ? "Select Module"
          : "No approved modules assigned to you",
        ""
      )
    );

    modules.forEach(module => {
      moduleSelect.appendChild(
        new Option(
          module.title || module.name || "Untitled Module",
          module.id
        )
      );
    });

  } catch (error) {
    console.error("Module loading error:", error);

    moduleSelect.innerHTML =
      `<option value="">Unable to load modules</option>`;

    throw error;
  }
}


// LOAD LESSONS
// ==========================================

async function loadLessons() {
  if (!lessonList) return;

  lessonList.innerHTML = `
    <div class="message-box">
      <span class="el-inline-spinner"></span>
      <strong>Loading lessons…</strong>
      <small>Syncing the latest content</small>
    </div>
  `;

  try {
    const lessonsRef = collection(db, "lessons");

    // Teacher: only lessons created by this teacher.
    // Admin: all lessons.
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

// ==========================================
// RENDER LESSONS
// ==========================================

function renderLessons() {
  if (!lessonList) return;

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

    const hasStorageFile =
      Boolean(lesson.fileUrl);

    let fileHTML = "";

    if (hasFirestoreFile || hasStorageFile) {
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
          <br>
          <small>
            ${hasFirestoreFile ? "Legacy attachment" : "Firebase Storage"}
          </small>
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
      ${lesson.category ? `<span class="module-badge lesson-category">${escapeHTML(lesson.category)}</span>` : ""}

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
// ATTACHMENT URL
// ==========================================

function getLessonFileURL(lesson) {
  if (lesson.fileDataBase64) {
    const mime =
      lesson.fileMimeType ||
      "application/octet-stream";

    return `data:${mime};base64,${lesson.fileDataBase64}`;
  }

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
    if (uploadStatus) {
      uploadStatus.textContent = "";
    }
    return;
  }

  try {
    validateFile(file);

    showLessonStatus(
      `${file.name} • ${formatFileSize(file.size)} • ready to save`
    );

  } catch (error) {
    lessonFile.value = "";

    showLessonStatus(error.message, true);
  }
});

// ==========================================
// EDIT LESSON
// ==========================================

function editLesson(id) {
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

    resetForm();

    editingLessonId = id;

    modalTitle.textContent = "Edit Lesson";

    moduleSelect.value = lesson.moduleId || "";
    if (lessonCategory) lessonCategory.value = lesson.category || "Lesson";
    lessonTitle.value = lesson.title || "";
    lessonDescription.value = lesson.description || "";
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
                href="${escapeAttribute(getLessonFileURL(lesson))}"
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
    } else {
      currentFile.style.display = "none";
    }

    modal.classList.add("show");

    requestAnimationFrame(() => {
      lessonTitle.focus();
    });

  } catch (error) {
    console.error("Edit lesson error:", error);

    alert(error.message || "Unable to edit lesson.");
  }
}

// ==========================================
// SAVE LESSON
// ==========================================

saveLesson?.addEventListener("click", async () => {
  if (isBusy) return;

  if (!currentUser || !currentRole) {
    return showLessonStatus(
      "Please sign in first.",
      true
    );
  }

  const moduleId = moduleSelect.value;
  const titleValue = lessonTitle.value.trim();
  const descriptionValue = lessonDescription.value.trim();
  const categoryValue = lessonCategory?.value || "Lesson";
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

  if (!categoryValue) {
    return showLessonStatus("Please select a lesson category.", true);
  }

  const selectedModule = modules.find(
    (item) => item.id === moduleId
  );

  if (!selectedModule) {
    return showLessonStatus(
      "Selected module is unavailable.",
      true
    );
  }

  if (
    currentRole !== "admin" &&
    selectedModule.createdBy !== currentUser.uid &&
    selectedModule.assignedTeacherId !== currentUser.uid
  ) {
    return showLessonStatus(
      "This module is not assigned to your teacher account.",
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
    return showLessonStatus(
      "Please enter a valid YouTube URL.",
      true
    );
  }

  setBusy(true, file
    ? "Preparing attachment..."
    : "Saving lesson..."
  );

  uploadCancelled = false;

  try {
    // Keep existing attachments unless the teacher selects a replacement.
    let fileDataBase64 = existingFileData;
    let fileMimeType = existingFileMime;
    let fileName = existingFileName;
    let fileSize = existingFileSize;
    let fileUrl = existingFileUrl;
    let filePath = existingFilePath;

    if (file) {
      setUploadProgress(0, "Uploading file to Firebase Storage...");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      filePath = `lessons/${currentUser.uid}/${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, filePath);
      activeUploadTask = uploadBytesResumable(fileRef, file, {
        contentType: file.type || "application/octet-stream"
      });

      await new Promise((resolve, reject) => {
        activeUploadTask.on("state_changed",
          snapshot => {
            const percent = snapshot.totalBytes
              ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
              : 0;
            setUploadProgress(percent, `Uploading ${file.name}...`);
          },
          reject,
          resolve
        );
      });

      if (uploadCancelled) throw new Error("Upload cancelled.");

      fileUrl = await getDownloadURL(fileRef);
      fileDataBase64 = "";
      fileMimeType = file.type || "application/octet-stream";
      fileName = file.name;
      fileSize = file.size;
    }

    if (uploadCancelled) {
      throw new Error("Upload cancelled.");
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
      category: categoryValue,

      fileUrl,
      filePath,
      fileName,

      fileDataBase64,
      fileMimeType,
      fileSize,

      videoUrl: youtube,
      status: "active",
      reviewStatus: "approved",

      sectionIds: Array.isArray(selectedModule.sectionIds)
        ? selectedModule.sectionIds
        : [],

      createdBy: currentUser.uid,
      createdByRole: currentRole,

      createdByName:
        currentUser.displayName ||
        currentUser.email ||
        "Teacher",

      updatedAt: serverTimestamp()
    };

    setUploadProgress(
      95,
      "Saving lesson to Firestore..."
    );

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
          createdAt: serverTimestamp()
        }
      );

      const targetSectionIds =
        Array.isArray(selectedModule.sectionIds)
          ? selectedModule.sectionIds
          : [];

      if (targetSectionIds.length > 0) {
        try {
          const notificationResult =
            await notifySectionStudents({
              db,
              auth,
              sectionIds: targetSectionIds,
              contentType: "lesson",
              contentId: created.id,
              contentTitle: titleValue,

              teacherName:
                currentUser.displayName ||
                currentUser.email ||
                "Your teacher",

              targetUrl: selectedModule?.id
                ? `lesson.html?module=${encodeURIComponent(selectedModule.id)}`
                : "modules.html"
            });

          console.info(
            "LESSON NOTIFICATIONS:",
            notificationResult
          );

        } catch (notificationError) {
          console.error(
            "LESSON NOTIFICATION ERROR:",
            notificationError
          );
        }
      }

      lessons.unshift({
        id: created.id,
        ...payload,

        createdBy: currentUser.uid,

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
    activeUploadTask = null;
    uploadCancelled = false;

    setBusy(false);
  }
});

// ==========================================
// CANCEL UPLOAD
// ==========================================

lessonCancelUpload?.addEventListener("click", () => {
  if (!isBusy) return;

  uploadCancelled = true;

  if (activeUploadTask) {
    activeUploadTask.cancel();
  } else {
    showLessonStatus(
      "The lesson is being saved. Please wait for the operation to finish.",
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

  if (
    currentRole !== "admin" &&
    lesson.createdBy !== currentUser.uid
  ) {
    alert("You can only delete lessons you created.");
    return;
  }

  const confirmed = confirm(
    `Delete "${lesson.title || "this lesson"}"?`
  );

  if (!confirmed) return;

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
      throw new Error(
        "You are not authorized to delete this lesson."
      );
    }

    await deleteDoc(lessonRef);

    if (data.filePath) {
      try {
        await deleteObject(storageRef(storage, data.filePath));
      } catch (storageError) {
        console.warn("Lesson file cleanup skipped:", storageError);
      }
    }

    lessons = lessons.filter(
      (item) => item.id !== id
    );

    renderLessons();

    // Legacy Base64 attachments disappear with their Firestore lesson record.

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
      "An upload or save is still running. Cancel the upload and close?"
    );

    if (!confirmed) return;

    uploadCancelled = true;

    if (activeUploadTask) {
      activeUploadTask.cancel();
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
  if (lessonCategory) lessonCategory.value = "Lesson";
  if (lessonTitle) lessonTitle.value = "";
  if (lessonDescription) lessonDescription.value = "";
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

  activeUploadTask = null;
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
    lessonCategory,
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
// VALIDATE YOUTUBE URL
// ==========================================

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

// ==========================================
// ERROR HANDLING
// ==========================================

function readableUploadError(error) {
  if (
    uploadCancelled ||
    error?.message === "Upload cancelled."
  ) {
    return "Attachment upload cancelled. The lesson was not saved.";
  }

  if (
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return "Firestore permission denied. Check your Firestore Rules.";
  }

  if (error?.code === "resource-exhausted") {
    return "Firestore quota limit reached while saving lesson details.";
  }

  if (error?.code === "invalid-argument") {
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
