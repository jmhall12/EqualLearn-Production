
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
  orderBy,
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

let currentUser = null;
let currentProfile = null;
let modules = [];

// ========================================
// MESSAGE
// ========================================

function showMessage(message, type = "success") {
  pageMessage.textContent = message;
  pageMessage.className = `message show ${type}`;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearMessage() {
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
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent.trim();
  }

  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.originalText;
}

function validateVideoURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error();
    }

    return url.href;
  } catch {
    throw new Error("Please enter a valid video URL.");
  }
}

// ========================================
// TAB NAVIGATION
// ========================================

document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", async () => {
    clearMessage();

    document.querySelectorAll("[data-tab]").forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    const selected = button.dataset.tab;

    modulePanel.hidden = selected !== "module";
    lessonPanel.hidden = selected !== "lesson";
    contentPanel.hidden = selected !== "content";

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
// ========================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));

    if (!profileSnap.exists()) {
      throw new Error("User profile not found.");
    }

    const profile = profileSnap.data();
    const role = String(profile.role || "").trim().toLowerCase();

    if (role !== "admin") {
      alert("Access denied. Administrator account required.");

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
    console.error("Admin content authentication error:", error);
    showMessage(error.message || "Unable to verify administrator account.", "error");
  }
});

// ========================================
// LOAD MODULES
// ========================================

async function loadModules() {
  if (!currentUser) return;

  lessonModule.innerHTML = `<option value="">Loading modules...</option>`;

  try {
    const modulesQuery = query(
      collection(db, "modules"),
      where("createdBy", "==", currentUser.uid),
      orderBy("order", "asc")
    );

    const snapshot = await getDocs(modulesQuery);

    modules = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

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
    console.error("Module loading error:", error);

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
// ========================================

moduleForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();

  if (!currentUser) {
    showMessage("Please sign in again.", "error");
    return;
  }

  const title = $("moduleTitle").value.trim();
  const description = $("moduleDescription").value.trim();
  const objectives = $("moduleObjectives").value.trim();
  const order = Number($("moduleOrder").value);
  const duration = $("moduleDuration").value;
  const videoUrl = $("moduleVideo").value.trim();

  if (!title || !description) {
    showMessage("Complete the required module fields.", "error");
    return;
  }

  if (!Number.isInteger(order) || order < 1) {
    showMessage("Module order must be at least 1.", "error");
    return;
  }

  let safeVideoURL;

  try {
    safeVideoURL = validateVideoURL(videoUrl);
  } catch (error) {
    showMessage(error.message, "error");
    return;
  }

  setBusy(saveModuleBtn, true, "Saving module...");

  try {
    await addDoc(collection(db, "modules"), {
      title,
      description,
      order,

      learningObjectives: objectives,
      estimatedDuration: duration || "",
      videoUrl: safeVideoURL,

      status: "pending_review",
      reviewStatus: "pending",

      createdBy: currentUser.uid,
      createdByRole: "admin",
      createdByName:
        currentProfile.displayName ||
        currentUser.displayName ||
        currentUser.email ||
        "Administrator",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    moduleForm.reset();
    $("moduleOrder").value = 1;

    await loadModules();

    showMessage("Module submitted successfully for teacher review.");

  } catch (error) {
    console.error("Create module error:", error);
    showMessage("Unable to save module: " + error.message, "error");

  } finally {
    setBusy(saveModuleBtn, false);
  }
});

// ========================================
// UPLOAD ATTACHMENT
// ========================================

async function uploadLessonFile(file) {
  if (!file) {
    return {
      fileUrl: "",
      filePath: "",
      fileName: "",
      fileSize: 0,
      fileMimeType: ""
    };
  }

  const maxSize = 20 * 1024 * 1024;

  if (file.size > maxSize) {
    throw new Error("File size must not exceed 20 MB.");
  }

  const allowed = [
    "pdf", "doc", "docx",
    "ppt", "pptx",
    "xls", "xlsx",
    "txt", "jpg", "jpeg", "png", "webp"
  ];

  const extension = file.name.split(".").pop().toLowerCase();

  if (!allowed.includes(extension)) {
    throw new Error("Unsupported attachment file type.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  const filePath =
    `admin-lesson-files/${currentUser.uid}/${Date.now()}_${safeName}`;

  const fileRef = ref(storage, filePath);

  const uploadTask = uploadBytesResumable(fileRef, file, {
    contentType: file.type || "application/octet-stream"
  });

  await new Promise((resolve, reject) => {
    uploadTask.on("state_changed", null, reject, resolve);
  });

  return {
    fileUrl: await getDownloadURL(fileRef),
    filePath,
    fileName: file.name,
    fileSize: file.size,
    fileMimeType: file.type || "application/octet-stream"
  };
}

// ========================================
// CREATE LESSON
// ========================================

lessonForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();

  if (!currentUser) {
    showMessage("Please sign in again.", "error");
    return;
  }

  const moduleId = lessonModule.value;
  const title = $("lessonTitle").value.trim();
  const description = $("lessonDescription").value.trim();
  const content = $("lessonContent").value.trim();
  const objectives = $("lessonObjectives").value.trim();
  const duration = $("lessonDuration").value;
  const videoUrl = $("lessonVideo").value.trim();
  const file = $("lessonFile").files[0] || null;

  if (!moduleId || !title || !description || !content) {
    showMessage("Complete all required lesson fields.", "error");
    return;
  }

  const selectedModule = modules.find(module => module.id === moduleId);

  if (!selectedModule) {
    showMessage("Selected module was not found.", "error");
    return;
  }

  let safeVideoURL;

  try {
    safeVideoURL = validateVideoURL(videoUrl);
  } catch (error) {
    showMessage(error.message, "error");
    return;
  }

  setBusy(saveLessonBtn, true, "Saving lesson...");

  try {
    showMessage(
      file ? "Uploading attachment..." : "Saving lesson...",
      "success"
    );

    const fileData = await uploadLessonFile(file);

    await addDoc(collection(db, "lessons"), {
      moduleId,
      moduleName: selectedModule.title || selectedModule.name || "",

      title,
      description,
      content,

      learningObjectives: objectives,
      estimatedDuration: duration || "",
      videoUrl: safeVideoURL,

      ...fileData,

      status: "pending_review",
      reviewStatus: "pending",

      createdBy: currentUser.uid,
      createdByRole: "admin",
      createdByName:
        currentProfile.displayName ||
        currentUser.displayName ||
        currentUser.email ||
        "Administrator",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    lessonForm.reset();

    await loadModules();

    showMessage("Lesson submitted successfully for teacher review.");

  } catch (error) {
    console.error("Create lesson error:", error);
    showMessage("Unable to save lesson: " + error.message, "error");

  } finally {
    setBusy(saveLessonBtn, false);
  }
});

// ========================================
// MY CONTENT
// ========================================

async function loadMyContent() {
  if (!currentUser) return;

  contentList.innerHTML =
    `<div class="empty">Loading your content...</div>`;

  try {
    const [moduleSnapshot, lessonSnapshot] = await Promise.all([
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
      ...moduleSnapshot.docs.map(item => ({
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
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    if (!items.length) {
      contentList.innerHTML = `
        <div class="empty">
          <span class="empty-icon">▤</span>
          <strong>No content yet</strong>
          <p>Create your first module or lesson to get started.</p>
        </div>
      `;
      return;
    }

    contentList.innerHTML = items.map(item => {
      const status = item.reviewStatus || item.status || "pending";

      return `
        <article class="content-item">
          <div>
            <h3>${escapeHTML(item.title || "Untitled Content")}</h3>
            <p>${escapeHTML(item.type)} · ${escapeHTML(item.moduleName || item.description || "")}</p>
            <span class="status">● ${escapeHTML(status.replaceAll("_", " "))}</span>
          </div>
        </article>
      `;
    }).join("");

  } catch (error) {
    console.error("Load admin content error:", error);

    contentList.innerHTML = `
      <div class="empty">
        Unable to load content: ${escapeHTML(error.message)}
      </div>
    `;
  }
}
