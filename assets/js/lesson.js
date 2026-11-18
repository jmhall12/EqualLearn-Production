
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
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
let studentProfile = null;
let studentSectionId = "";
let attachmentURLs = [];

// ==========================================
// CLEANUP BLOB URLS
// ==========================================

function clearAttachmentURLs() {
  attachmentURLs.forEach(url => URL.revokeObjectURL(url));
  attachmentURLs = [];
}

// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async user => {
  clearAttachmentURLs();

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentUser = user;

  if (!container) {
    console.error("[LESSON] lessonContainer element not found.");
    return;
  }

  try {
    const profileSnapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnapshot.exists()) {
      throw new Error("Student profile was not found.");
    }

    studentProfile = profileSnapshot.data();

    const role = String(studentProfile.role || "")
      .trim()
      .toLowerCase();

    const accountStatus = String(studentProfile.status || "")
      .trim()
      .toLowerCase();

    if (role !== "student") {
      window.location.href = "../login.html";
      return;
    }

    if (accountStatus !== "active") {
      throw new Error("Your student account is not active.");
    }

    studentSectionId = String(
      studentProfile.sectionId || ""
    ).trim();

    if (!studentSectionId) {
      throw new Error(
        "No section has been assigned to your account. Please contact your teacher or administrator."
      );
    }

    if (!moduleId) {
      showMessage(
        "Module ID is missing.",
        "Please return to the modules page.",
        "error"
      );
      return;
    }

    await loadLessons();

  } catch (error) {
    console.error("[LESSON] Authentication error:", error);

    showMessage(
      "Unable to load your lessons.",
      error.message || "Please try again later.",
      "error"
    );
  }
});

// ==========================================
// LOAD PUBLISHED LESSONS
// ==========================================

async function loadLessons() {
  container.innerHTML = `
    <div class="lesson-loading">
      Loading your lessons...
    </div>
  `;

  clearAttachmentURLs();

  try {
    console.log("[LESSON] Loading published lessons:", {
      moduleId,
      studentSectionId,
      uid: currentUser?.uid
    });

    /*
      Only retrieve active lessons assigned to this student's section.

      Teacher must approve the Admin lesson and publish it to
      selected section(s) before it becomes visible here.
    */

    const lessonsQuery = query(
      collection(db, "lessons"),
      where("status", "==", "active"),
      where("sectionIds", "array-contains", studentSectionId)
    );

    const snapshot = await getDocs(lessonsQuery);

    const lessonItems = snapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .filter(lesson => {
        const reviewStatus = String(
          lesson.reviewStatus || ""
        ).trim().toLowerCase();

        return (
          lesson.moduleId === moduleId &&
          reviewStatus === "approved" &&
          Array.isArray(lesson.sectionIds) &&
          lesson.sectionIds.includes(studentSectionId)
        );
      });

    lessonItems.sort((a, b) => {
      return getTimestamp(b.publishedAt || b.createdAt) -
        getTimestamp(a.publishedAt || a.createdAt);
    });

    console.log(
      `[LESSON] ${lessonItems.length} published lesson(s) available.`
    );

    if (!lessonItems.length) {
      container.innerHTML = `
        <div class="lesson-empty">
          <h3>No Lessons Available</h3>
          <p>
            Your instructor has not published any approved lessons
            for your section in this module yet.
          </p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    lessonItems.forEach(lesson => {
      fragment.appendChild(createLessonCard(lesson));
    });

    container.replaceChildren(fragment);

  } catch (error) {
    console.error("[LESSON] Loading failed:", error);

    showMessage(
      "Unable to load lessons.",
      getFirestoreErrorMessage(error),
      "error",
      true
    );
  }
}

// ==========================================
// CREATE LESSON CARD
// ==========================================

function createLessonCard(lesson) {
  const card = document.createElement("article");
  card.className = "lesson-card";
  card.dataset.lessonId = lesson.id;

  // Category
  if (lesson.category) {
    const category = document.createElement("span");
    category.className = "lesson-category";
    category.textContent = lesson.category;
    card.appendChild(category);
  }

  // Title
  const title = document.createElement("h3");
  title.textContent = lesson.title || "Untitled Lesson";

  // Description
  const description = document.createElement("p");
  description.className = "lesson-description";
  description.textContent =
    lesson.description || "No description available.";

  card.append(title, description);

  // ========================================
  // ADMIN / TEACHER ATTACHMENTS
  // ========================================

  const attachments = getLessonAttachments(lesson);

  if (attachments.length) {
    const attachmentSection = document.createElement("div");
    attachmentSection.className = "lesson-attachments";

    attachments.forEach((attachment, index) => {
      const link = createAttachmentLink(attachment, index);

      if (link) {
        attachmentSection.appendChild(link);
      }
    });

    if (attachmentSection.childElementCount) {
      card.appendChild(attachmentSection);
    }
  }

  // ========================================
  // RESOURCE LINKS
  // ========================================

  const resourceLinks = Array.isArray(lesson.resourceLinks)
    ? lesson.resourceLinks
    : [];

  if (resourceLinks.length) {
    const resourceSection = document.createElement("div");
    resourceSection.className = "lesson-resources";

    const heading = document.createElement("h4");
    heading.textContent = "Learning Resources";
    resourceSection.appendChild(heading);

    resourceLinks.forEach(resource => {
      const url = safeExternalURL(
        resource.url || resource.link || ""
      );

      if (!url) return;

      const link = document.createElement("a");
      link.className = "btn secondary";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent =
        `🔗 ${resource.label || resource.title || "Open Resource"}`;

      resourceSection.appendChild(link);
    });

    if (resourceSection.childElementCount > 1) {
      card.appendChild(resourceSection);
    }
  }

  // ========================================
  // VIDEO
  // ========================================

  const videoURL = safeExternalURL(lesson.videoUrl || "");

  if (videoURL) {
    const videoLink = document.createElement("a");

    videoLink.className = "btn secondary";
    videoLink.href = videoURL;
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
    `quizzes.html?lesson=${encodeURIComponent(lesson.id)}`;
  quizLink.textContent = "📝 Take Quiz";

  card.appendChild(quizLink);

  return card;
}

// ==========================================
// NORMALIZE ATTACHMENTS
// ==========================================

function getLessonAttachments(lesson) {
  const attachments = [];

  // Admin-created lessons support multiple attachments.
  if (Array.isArray(lesson.attachments)) {
    lesson.attachments.forEach(item => {
      if (!item) return;

      attachments.push({
        fileName: item.fileName || item.name || item.label || "Lesson Attachment",
        fileUrl: item.fileUrl || item.url || "",
        filePath: item.filePath || "",
        fileDataBase64: item.fileDataBase64 || "",
        fileMimeType: item.fileMimeType || item.mimeType || "",
        fileSize: item.fileSize || 0
      });
    });
  }

  // Legacy and Teacher-created single attachment fields.
  const hasLegacyAttachment =
    lesson.fileDataBase64 ||
    lesson.fileUrl ||
    lesson.pdfUrl;

  if (hasLegacyAttachment) {
    const legacyURL = lesson.fileUrl || lesson.pdfUrl || "";

    const alreadyIncluded = attachments.some(item =>
      item.fileUrl && item.fileUrl === legacyURL
    );

    if (!alreadyIncluded) {
      attachments.unshift({
        fileName: lesson.fileName || "Lesson Attachment",
        fileUrl: legacyURL,
        filePath: lesson.filePath || "",
        fileDataBase64: lesson.fileDataBase64 || "",
        fileMimeType:
          lesson.fileMimeType || "application/octet-stream",
        fileSize: lesson.fileSize || 0
      });
    }
  }

  return attachments;
}

// ==========================================
// CREATE ATTACHMENT LINK
// ==========================================

function createAttachmentLink(attachment, index = 0) {
  let fileURL = "";

  const base64 = attachment.fileDataBase64 || "";

  if (base64) {
    try {
      const blob = base64ToBlob(
        base64,
        attachment.fileMimeType || "application/octet-stream"
      );

      fileURL = URL.createObjectURL(blob);
      attachmentURLs.push(fileURL);

    } catch (error) {
      console.error(
        "[LESSON] Attachment conversion failed:",
        error
      );

      return createTextMessage(
        "Unable to open this attachment.",
        "lesson-error"
      );
    }

  } else {
    fileURL = safeExternalURL(attachment.fileUrl || "");
  }

  if (!fileURL) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "file-info";

  const name = document.createElement("strong");
  name.textContent =
    attachment.fileName || `Lesson Attachment ${index + 1}`;

  const link = document.createElement("a");
  link.className = "btn";
  link.href = fileURL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "📄 Open Attachment";

  if (base64) {
    link.download = attachment.fileName || "lesson-attachment";
  }

  wrapper.append(name, link);

  return wrapper;
}

// ==========================================
// BASE64 TO BLOB
// ==========================================

function base64ToBlob(base64, mimeType) {
  const cleanBase64 = String(base64)
    .replace(/^data:[^,]*;base64,/, "")
    .replace(/\s/g, "");

  const binary = atob(cleanBase64);
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
// SAFE EXTERNAL URL
// ==========================================

function safeExternalURL(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value));

    if (!["https:", "http:"].includes(url.protocol)) {
      return "";
    }

    return url.href;

  } catch {
    return "";
  }
}

// ==========================================
// MESSAGE DISPLAY
// ==========================================

function showMessage(
  heading,
  message,
  type = "info",
  showRetry = false
) {
  const wrapper = document.createElement("div");
  wrapper.className =
    type === "error" ? "lesson-error" : "lesson-empty";

  const title = document.createElement("h3");
  title.textContent = heading;

  const description = document.createElement("p");
  description.textContent = message;

  wrapper.append(title, description);

  if (showRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.id = "retryLessons";
    retry.textContent = "Try Again";

    retry.addEventListener("click", loadLessons);
    wrapper.appendChild(retry);
  }

  container.replaceChildren(wrapper);
}

function createTextMessage(message, className) {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = message;
  return element;
}

// ==========================================
// TIMESTAMP
// ==========================================

function getTimestamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

// ==========================================
// FIRESTORE ERROR MESSAGE
// ==========================================

function getFirestoreErrorMessage(error) {
  if (
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return "You do not have permission to access these lessons. Please check your section assignment or contact your administrator.";
  }

  if (error?.code === "failed-precondition") {
    return "A Firestore index may be required for this query. Check the browser console for the index creation link.";
  }

  return error?.message || "Something went wrong.";
}

// ==========================================
// CLEANUP
// ==========================================

window.addEventListener("beforeunload", clearAttachmentURLs);
