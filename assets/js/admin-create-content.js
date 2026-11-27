
import { auth, db, storage } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  ref,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";

const $ = id => document.getElementById(id);

const moduleForm = $("moduleForm");
const lessonForm = $("lessonForm");

const modulePanel = $("modulePanel");
const lessonPanel = $("lessonPanel");
const contentPanel = $("contentPanel");

const pageMessage = $("pageMessage");
const contentList = $("contentList");
const lessonModule = $("lessonModule");

const saveModuleBtn = $("saveModuleBtn");
const saveLessonBtn = $("saveLessonBtn");

const moduleFilesInput = $("moduleFiles");
const lessonFilesInput = $("lessonFiles");

const moduleResourceLinksInput =
  $("moduleResourceLinks");

const lessonResourceLinksInput =
  $("lessonResourceLinks");

let currentUser = null;
let currentProfile = null;
let modules = [];

// ========================================
// CONFIGURATION
// ========================================

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
  "mp4",
  "webm",
  "mov"
]);

// ========================================
// MESSAGE
// ========================================

function showMessage(message, type = "success") {

  if (!pageMessage) return;

  pageMessage.textContent = message;
  pageMessage.className = `message show ${type}`;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

function clearMessage() {

  if (!pageMessage) return;

  pageMessage.textContent = "";
  pageMessage.className = "message";

}

function escapeHTML(value = "") {

  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);

}

function setBusy(button, busy, text) {

  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText =
      button.textContent.trim();
  }

  button.disabled = busy;

  button.textContent = busy
    ? text
    : button.dataset.originalText;

}

// ========================================
// URL VALIDATION
// ========================================

function validateURL(value, label = "URL") {

  if (!value) return "";

  try {

    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error();
    }

    return url.href;

  } catch {

    throw new Error(`Please enter a valid ${label}.`);

  }

}

function validateVideoURL(value) {

  return validateURL(value, "video URL");

}

// ========================================
// RESOURCE LINKS
// ONE URL PER LINE
// ========================================

function parseResourceLinks(value) {

  const lines = String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const unique = new Set();

  return lines.map(line => {

    const safeURL = validateURL(
      line,
      "resource URL"
    );

    if (unique.has(safeURL)) {
      return null;
    }

    unique.add(safeURL);

    const url = new URL(safeURL);

    return {
      label: url.hostname.replace(/^www\./, ""),
      url: safeURL,
      type: "link"
    };

  }).filter(Boolean);

}

// ========================================
// FILE VALIDATION
// ========================================

function validateAttachment(file) {

  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {

    throw new Error(
      `${file.name} exceeds the 20 MB per-file limit.`
    );

  }

  const extension = file.name
    .split(".")
    .pop()
    .toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {

    throw new Error(
      `Unsupported file type: ${file.name}`
    );

  }

}

// ========================================
// UPLOAD MULTIPLE FILES
// FIREBASE STORAGE
// ========================================

async function uploadContentFiles(files, contentType) {

  const selectedFiles = Array.from(files || []);

  selectedFiles.forEach(validateAttachment);

  const uploaded = [];

  for (const file of selectedFiles) {

    const safeName = file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    const uniqueName =
      `${Date.now()}_${crypto.randomUUID()}_${safeName}`;

    const filePath =
      `${contentType}-files/${currentUser.uid}/${uniqueName}`;

    const fileRef = ref(storage, filePath);

    const uploadTask = uploadBytesResumable(
      fileRef,
      file,
      {
        contentType:
          file.type || "application/octet-stream"
      }
    );

    await new Promise((resolve, reject) => {

      uploadTask.on(
        "state_changed",

        snapshot => {

          const percent = Math.round(
            (
              snapshot.bytesTransferred /
              snapshot.totalBytes
            ) * 100
          );

          showMessage(
            `Uploading ${file.name}: ${percent}%`,
            "success"
          );

        },

        reject,

        resolve
      );

    });

    const downloadURL =
      await getDownloadURL(fileRef);

    uploaded.push({

      fileUrl: downloadURL,

      filePath,

      fileName: file.name,

      fileSize: file.size,

      fileMimeType:
        file.type || "application/octet-stream"

    });

  }

  return uploaded;

}

// ========================================
// TAB NAVIGATION
// ========================================

document.querySelectorAll("[data-tab]").forEach(button => {

  button.addEventListener("click", async () => {

    clearMessage();

    document.querySelectorAll("[data-tab]").forEach(tab => {

      tab.classList.toggle(
        "active",
        tab === button
      );

    });

    const selected = button.dataset.tab;

    if (modulePanel) {
      modulePanel.hidden = selected !== "module";
    }

    if (lessonPanel) {
      lessonPanel.hidden = selected !== "lesson";
    }

    if (contentPanel) {
      contentPanel.hidden = selected !== "content";
    }

    if (selected === "lesson") {
      await loadModules();
    }

    if (selected === "content") {
      await loadMyContent();
    }

  });

});

// ========================================
// AUTHENTICATION
// ADMIN ONLY
// ========================================

onAuthStateChanged(auth, async user => {

  if (!user) {

    window.location.href = "../login.html";

    return;

  }

  try {

    const profileSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnap.exists()) {

      throw new Error(
        "User profile not found."
      );

    }

    const profile = profileSnap.data();

    const role = String(profile.role || "")
      .trim()
      .toLowerCase();

    if (role !== "admin") {

      alert(
        "Access denied. Administrator account required."
      );

      window.location.href =
        role === "teacher"
          ? "../teacher/dashboard.html"
          : role === "student"
            ? "../student/dashboard.html"
            : "../login.html";

      return;

    }

    currentUser = user;
    currentProfile = profile;

    await loadModules();

  } catch (error) {

    console.error(
      "Admin content authentication error:",
      error
    );

    showMessage(
      error.message ||
      "Unable to verify administrator account.",
      "error"
    );

  }

});

// ========================================
// LOAD MODULES
// ========================================

async function loadModules() {

  if (!currentUser || !lessonModule) return;

  lessonModule.innerHTML =
    `<option value="">Loading modules...</option>`;

  try {

    // Filter by creator in Firestore, then sort locally.
    // This avoids requiring a composite index for createdBy + order.
    const modulesQuery = query(
      collection(db, "modulesV2"),
      where("createdBy", "==", currentUser.uid)
    );

    const snapshot = await getDocs(modulesQuery);

    modules = snapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      // Firestore orderBy("order") previously excluded documents
      // without an order field, so keep the same behavior here.
      .filter(module => Object.prototype.hasOwnProperty.call(module, "order"))
      .sort((a, b) => {
        const left = Number(a.order);
        const right = Number(b.order);

        if (Number.isFinite(left) && Number.isFinite(right)) {
          return left - right;
        }

        return String(a.order ?? "").localeCompare(
          String(b.order ?? ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        );
      });

    lessonModule.replaceChildren(
      new Option("Select a module", "")
    );

    modules.forEach(module => {

      const option = new Option(
        module.title || module.name || "Untitled Module",
        module.id
      );

      lessonModule.appendChild(option);

    });

    if (!modules.length) {

      lessonModule.innerHTML =
        `<option value="">Create a module first</option>`;

    }

  } catch (error) {

    console.error(
      "Module loading error:",
      error
    );

    lessonModule.innerHTML =
      `<option value="">Unable to load modules</option>`;

    showMessage(
      "Unable to load modules. " + error.message,
      "error"
    );

  }

}

// ========================================
// CREATE MODULE
// ADMIN MODULES REQUIRE TEACHER REVIEW
// ========================================

if (moduleForm) {

  moduleForm.addEventListener("submit", async event => {

    event.preventDefault();

    clearMessage();

    if (!currentUser) {

      showMessage(
        "Please sign in again.",
        "error"
      );

      return;

    }

    const title =
      $("moduleTitle").value.trim();

    const description =
      $("moduleDescription").value.trim();

    const objectives =
      $("moduleObjectives").value.trim();

    const order =
      Number($("moduleOrder").value);

    const duration =
      $("moduleDuration").value;

    const videoUrl =
      $("moduleVideo").value.trim();

    const selectedFiles =
      moduleFilesInput?.files || [];

    let resourceLinks;

    try {

      resourceLinks = parseResourceLinks(
        moduleResourceLinksInput?.value
      );

      Array.from(selectedFiles).forEach(
        validateAttachment
      );

    } catch (error) {

      showMessage(
        error.message,
        "error"
      );

      return;

    }

    if (!title || !description) {

      showMessage(
        "Complete the required module fields.",
        "error"
      );

      return;

    }

    if (!Number.isInteger(order) || order < 1) {

      showMessage(
        "Module order must be at least 1.",
        "error"
      );

      return;

    }

    let safeVideoURL;

    try {

      safeVideoURL = validateVideoURL(videoUrl);

    } catch (error) {

      showMessage(
        error.message,
        "error"
      );

      return;

    }

    setBusy(
      saveModuleBtn,
      true,
      "Saving module..."
    );

    try {

      showMessage(
        selectedFiles.length
          ? "Uploading module attachments..."
          : "Saving module...",
        "success"
      );

      const attachments = await uploadContentFiles(
        selectedFiles,
        "admin-module"
      );

      await addDoc(
        collection(db, "modulesV2"),
        {

          title,

          description,

          order,

          learningObjectives: objectives,

          estimatedDuration: duration || "",

          videoUrl: safeVideoURL,

          attachments,

          resourceLinks,

          // ADMIN CONTENT REQUIRES TEACHER REVIEW
          status: "pending_review",

          reviewStatus: "pending",

          // Explicit null lets the Teacher review page safely query
          // approved Admin modules that have not been assigned yet.
          assignedTeacherId: null,

          createdBy: currentUser.uid,

          createdByRole: "admin",

          createdByName:
            currentProfile.displayName ||
            currentUser.displayName ||
            currentUser.email ||
            "Administrator",

          createdAt: serverTimestamp(),

          updatedAt: serverTimestamp()

        }
      );

      moduleForm.reset();

      if (moduleFilesInput) {
        moduleFilesInput.value = "";
      }

      if (moduleResourceLinksInput) {
        moduleResourceLinksInput.value = "";
      }

      if ($("moduleOrder")) {
        $("moduleOrder").value = 1;
      }

      await loadModules();

      showMessage(
        "Module submitted successfully for teacher review."
      );

    } catch (error) {

      console.error(
        "Create module error:",
        error
      );

      showMessage(
        "Unable to save module: " + error.message,
        "error"
      );

    } finally {

      setBusy(saveModuleBtn, false);

    }

  });

}

// ========================================
// CREATE LESSON
// ========================================

if (lessonForm) {

  lessonForm.addEventListener("submit", async event => {

    event.preventDefault();

    clearMessage();

    if (!currentUser) {

      showMessage(
        "Please sign in again.",
        "error"
      );

      return;

    }

    const moduleId =
      lessonModule.value;

    const title =
      $("lessonTitle").value.trim();

    const description =
      $("lessonDescription").value.trim();

    const content =
      $("lessonContent").value.trim();

    const objectives =
      $("lessonObjectives").value.trim();

    const duration =
      $("lessonDuration").value;

    const videoUrl =
      $("lessonVideo").value.trim();

    const selectedFiles =
      lessonFilesInput?.files || [];

    let resourceLinks;

    try {

      resourceLinks = parseResourceLinks(
        lessonResourceLinksInput?.value
      );

      Array.from(selectedFiles).forEach(
        validateAttachment
      );

    } catch (error) {

      showMessage(
        error.message,
        "error"
      );

      return;

    }

    if (
      !moduleId ||
      !title ||
      !description ||
      !content
    ) {

      showMessage(
        "Complete all required lesson fields.",
        "error"
      );

      return;

    }

    const selectedModule = modules.find(
      module => module.id === moduleId
    );

    if (!selectedModule) {

      showMessage(
        "Selected module was not found.",
        "error"
      );

      return;

    }

    let safeVideoURL;

    try {

      safeVideoURL = validateVideoURL(videoUrl);

    } catch (error) {

      showMessage(
        error.message,
        "error"
      );

      return;

    }

    setBusy(
      saveLessonBtn,
      true,
      "Saving lesson..."
    );

    try {

      showMessage(
        selectedFiles.length
          ? "Uploading lesson attachments..."
          : "Saving lesson...",
        "success"
      );

      const attachments = await uploadContentFiles(
        selectedFiles,
        "admin-lesson"
      );

      const primaryAttachment =
        attachments[0] || null;

      await addDoc(
        collection(db, "lessons"),
        {

          moduleId,

          moduleName:
            selectedModule.title ||
            selectedModule.name ||
            "",

          title,

          description,

          content,

          learningObjectives: objectives,

          estimatedDuration: duration || "",

          videoUrl: safeVideoURL,

          // LEGACY SINGLE FILE FIELDS
          // Keeps compatibility with older readers.
          fileUrl:
            primaryAttachment?.fileUrl || "",

          filePath:
            primaryAttachment?.filePath || "",

          fileName:
            primaryAttachment?.fileName || "",

          fileSize:
            primaryAttachment?.fileSize || 0,

          fileMimeType:
            primaryAttachment?.fileMimeType || "",

          // NEW MULTIPLE ATTACHMENTS
          attachments,

          // NEW RESOURCE LINKS
          resourceLinks,

          status: "pending_review",

          reviewStatus: "pending",

          // Explicit null keeps the Admin -> Teacher assignment schema consistent.
          assignedTeacherId: null,

          createdBy: currentUser.uid,

          createdByRole: "admin",

          createdByName:
            currentProfile.displayName ||
            currentUser.displayName ||
            currentUser.email ||
            "Administrator",

          createdAt: serverTimestamp(),

          updatedAt: serverTimestamp()

        }
      );

      lessonForm.reset();

      if (lessonFilesInput) {
        lessonFilesInput.value = "";
      }

      if (lessonResourceLinksInput) {
        lessonResourceLinksInput.value = "";
      }

      await loadModules();

      showMessage(
        "Lesson submitted successfully for teacher review."
      );

    } catch (error) {

      console.error(
        "Create lesson error:",
        error
      );

      showMessage(
        "Unable to save lesson: " + error.message,
        "error"
      );

    } finally {

      setBusy(saveLessonBtn, false);

    }

  });

}

// ========================================
// MY CONTENT
// ========================================

async function loadMyContent() {

  if (!currentUser || !contentList) return;

  contentList.innerHTML =
    `<div class="empty">Loading your content...</div>`;

  try {

    const [
      moduleV2Snapshot,
      legacyModuleSnapshot,
      lessonSnapshot
    ] = await Promise.all([

      getDocs(
        query(
          collection(db, "modulesV2"),
          where("createdBy", "==", currentUser.uid)
        )
      ),

      // Preserve visibility of Admin modules created before the V2 workflow.
      getDocs(
        query(
          collection(db, "modules"),
          where("createdBy", "==", currentUser.uid)
        )
      ),

      getDocs(
        query(
          collection(db, "lessons"),
          where("createdBy", "==", currentUser.uid)
        )
      )

    ]);

    const items = [

      ...moduleV2Snapshot.docs.map(item => ({

        id: item.id,

        type: "Module",

        ...item.data()

      })),

      ...legacyModuleSnapshot.docs.map(item => ({

        id: item.id,

        type: "Module",

        ...item.data()

      })),

      ...lessonSnapshot.docs.map(item => ({

        id: item.id,

        type: "Lesson",

        ...item.data()

      }))

    ];

    items.sort((a, b) => {

      const aTime =
        a.createdAt?.toMillis?.() || 0;

      const bTime =
        b.createdAt?.toMillis?.() || 0;

      return bTime - aTime;

    });

    if (!items.length) {

      contentList.innerHTML = `

        <div class="empty">

          <span class="empty-icon">▤</span>

          <strong>No content yet</strong>

          <p>
            Create your first module or lesson to get started.
          </p>

        </div>

      `;

      return;

    }

    contentList.innerHTML = items.map(item => {

      const status =
        item.reviewStatus ||
        item.status ||
        "pending";

      const statusLabel = String(status)
        .replaceAll("_", " ");

      const attachmentCount =
        item.attachments?.length ||
        (item.fileUrl ? 1 : 0);

      const linkCount =
        item.resourceLinks?.length || 0;

      return `

        <article class="content-item">

          <div>

            <h3>
              ${escapeHTML(
                item.title || "Untitled Content"
              )}
            </h3>

            <p>

              ${escapeHTML(item.type)}

              ·

              ${escapeHTML(
                item.moduleName ||
                item.description ||
                ""
              )}

            </p>

            <p>

              ${attachmentCount} file(s)

              ·

              ${linkCount} link(s)

            </p>

            <span class="status">

              ● ${escapeHTML(statusLabel)}

            </span>

          </div>

        </article>

      `;

    }).join("");

  } catch (error) {

    console.error(
      "Load admin content error:",
      error
    );

    contentList.innerHTML = `

      <div class="empty">

        Unable to load content:

        ${escapeHTML(error.message)}

      </div>

    `;

  }

}
