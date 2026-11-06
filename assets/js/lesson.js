
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ==========================================
// DOM ELEMENTS
// ==========================================

const container = document.getElementById("lessonContainer");


// ==========================================
// URL PARAMETERS
// ==========================================

const params = new URLSearchParams(window.location.search);
const moduleId = params.get("module");


// ==========================================
// STATE
// ==========================================

let currentUser = null;
let attachmentURLs = [];


// ==========================================
// CLEANUP BLOB URLS
// ==========================================

function clearAttachmentURLs() {
  attachmentURLs.forEach((url) => {
    URL.revokeObjectURL(url);
  });

  attachmentURLs = [];
}


// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  if (!moduleId) {
    container.innerHTML = `
      <div class="lesson-error">
        <h3>Module ID is missing.</h3>
        <p>Please return to the modules page.</p>
      </div>
    `;
    return;
  }

  await loadLessons();
});


// ==========================================
// LOAD LESSONS
// ==========================================

async function loadLessons() {
  container.innerHTML = `
    <div class="lesson-loading">
      Loading lessons...
    </div>
  `;

  clearAttachmentURLs();

  try {
    console.log(
      "[LESSON] Loading lessons for module:",
      moduleId
    );

    // Do not filter by status == active here.
    // The current Add Lesson code does not create
    // a status field for newly added lessons.

    const q = query(
      collection(db, "lessons"),
      where("moduleId", "==", moduleId)
    );

    const snapshot = await getDocs(q);

    console.log(
      "[LESSON] Lessons loaded:",
      snapshot.size
    );

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="lesson-empty">
          <h3>No Lessons Available</h3>
          <p>Your instructor has not added lessons to this module yet.</p>
        </div>
      `;
      return;
    }

    const lessonItems = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    lessonItems.sort((a, b) => {
      return (
        (a.createdAt?.seconds || 0) -
        (b.createdAt?.seconds || 0)
      );
    });

    const fragment = document.createDocumentFragment();

    lessonItems.forEach((lesson) => {
      const card = createLessonCard(lesson);

      fragment.appendChild(card);
    });

    container.replaceChildren(fragment);

  } catch (error) {
    console.error(
      "[LESSON] Loading failed:",
      error
    );

    container.innerHTML = `
      <div class="lesson-error">
        <h3>Unable to load lessons</h3>
        <p>${escapeHTML(error.message)}</p>
        <button type="button" id="retryLessons">
          Try Again
        </button>
      </div>
    `;

    document
      .getElementById("retryLessons")
      ?.addEventListener("click", loadLessons);
  }
}


// ==========================================
// CREATE LESSON CARD
// ==========================================

function createLessonCard(lesson) {
  const card = document.createElement("article");

  card.className = "lesson-card";

  const title = document.createElement("h3");

  title.textContent =
    lesson.title || "Untitled Lesson";

  const description = document.createElement("p");

  description.className = "lesson-description";

  description.textContent =
    lesson.description || "No description available.";

  card.append(title, description);


  // ========================================
  // ATTACHMENT
  // ========================================

  const attachment = createAttachmentLink(lesson);

  if (attachment) {
    card.appendChild(attachment);
  }


  // ========================================
  // VIDEO
  // ========================================

  if (lesson.videoUrl) {
    const videoLink = document.createElement("a");

    videoLink.className = "btn secondary";

    videoLink.href = lesson.videoUrl;

    videoLink.target = "_blank";

    videoLink.rel = "noopener noreferrer";

    videoLink.textContent = "🎥 Watch Video";

    card.appendChild(videoLink);
  }


  // ========================================
  // QUIZ
  // ========================================

  const quizLink = document.createElement("a");

  quizLink.className = "btn quiz";

  quizLink.href =
    `quiz.html?lesson=${encodeURIComponent(lesson.id)}`;

  quizLink.textContent = "📝 Take Quiz";

  card.appendChild(quizLink);

  return card;
}


// ==========================================
// CREATE ATTACHMENT LINK
// ==========================================

function createAttachmentLink(lesson) {
  const base64 = lesson.fileDataBase64 || "";

  const legacyURL =
    lesson.fileUrl ||
    lesson.pdfUrl ||
    "";

  const fileName =
    lesson.fileName ||
    "Lesson Attachment";

  const mimeType =
    lesson.fileMimeType ||
    "application/octet-stream";

  let fileURL = "";


  // ========================================
  // NEW FIRESTORE BASE64 ATTACHMENT
  // ========================================

  if (base64) {
    try {
      const blob = base64ToBlob(base64, mimeType);

      fileURL = URL.createObjectURL(blob);

      attachmentURLs.push(fileURL);

    } catch (error) {
      console.error(
        "[LESSON] Attachment conversion failed:",
        error
      );

      const errorElement = document.createElement("p");

      errorElement.className = "lesson-error";

      errorElement.textContent =
        "Unable to open this lesson attachment.";

      return errorElement;
    }
  }

  // ========================================
  // LEGACY URL ATTACHMENT
  // ========================================

  else if (legacyURL) {
    fileURL = legacyURL;
  }

  // No attachment.
  else {
    return null;
  }


  // ========================================
  // ATTACHMENT ELEMENT
  // ========================================

  const wrapper = document.createElement("div");

  wrapper.className = "file-info";

  const name = document.createElement("strong");

  name.textContent = fileName;

  const link = document.createElement("a");

  link.className = "btn";

  link.href = fileURL;

  link.target = "_blank";

  link.rel = "noopener noreferrer";

  link.textContent = "📄 Open Attachment";

  // Download filename for Firestore Blob files.
  if (base64) {
    link.download = fileName;
  }

  wrapper.append(name, link);

  return wrapper;
}


// ==========================================
// BASE64 TO BLOB
// ==========================================

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob(
    [bytes],
    { type: mimeType }
  );
}


// ==========================================
// HTML ESCAPING
// ==========================================

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );
}


// ==========================================
// CLEANUP
// ==========================================

window.addEventListener(
  "beforeunload",
  clearAttachmentURLs
);
