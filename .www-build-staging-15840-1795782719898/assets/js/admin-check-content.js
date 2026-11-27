
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// =====================================================
// DOM ELEMENTS
// =====================================================

const $ = (id) => document.getElementById(id);

const contentList = $("contentList");
const contentSearch = $("contentSearch");
const contentStatusFilter = $("contentStatusFilter");
const contentSort = $("contentSort");

const totalLessons = $("totalLessons");
const totalModules = $("totalModules");
const totalActivities = $("totalActivities");
const totalFlagged = $("totalFlagged");
const contentLastUpdated = $("contentLastUpdated");
const lessonTrend = $("lessonTrend");
const moduleTrend = $("moduleTrend");
const activityTrend = $("activityTrend");
const flaggedTrend = $("flaggedTrend");

// =====================================================
// STATE
// =====================================================

let currentUser = null;
let allContent = [];
let teacherNames = {};
let teacherUids = new Set();
let teacherActivityItems = [];

let activeTab = "all";
let isProcessing = false;
let isAuthenticated = false;

let unsubscribeLessons = null;
let unsubscribeModulesV2 = null;
let unsubscribeLegacyModules = null;
let unsubscribeTeacherActivities = null;

const firstSnapshotByCollection = new Set();
const previousPublicationStates = new Map();

// Prevent duplicate notifications during the same session.
const notifiedPosts = new Set();

// =====================================================
// HELPERS
// =====================================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) return value;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function timestamp(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function formatDate(value) {
  const date = toDate(value);

  if (!date) return "Date unavailable";

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getTeacherName(uid) {
  return teacherNames[uid] || "Unknown Teacher";
}

function isTeacherCreated(data = {}) {
  const explicitRole = String(
    data.createdByRole || data.creatorRole || ""
  ).trim().toLowerCase();

  if (explicitRole) return explicitRole === "teacher";

  const creatorUid = data.createdBy || data.teacherId || data.ownerId || "";
  return Boolean(creatorUid && teacherUids.has(creatorUid));
}

// Return the administrator's moderation decision for a content item.
// Values are written by the Keep and Flag actions (and may exist on older
// records as "removed" when removal was recorded instead of deleting).
function getModerationStatus(item = {}) {
  return String(item.moderationStatus || "").trim().toLowerCase();
}

function normalizePublishedStatus(value) {
  const status = String(value || "draft").trim().toLowerCase();
  if (["active", "published", "approved", "kept", "flagged"].includes(status)) {
    return "published";
  }
  if (["archived", "inactive"].includes(status)) return "archived";
  if (["removed", "deleted"].includes(status)) return "removed";
  return "draft";
}

function getDisplayStatus(item) {
  const moderation = getModerationStatus(item);
  if (moderation === "removed") return "removed";
  if (moderation === "flagged") return "flagged";
  if (moderation === "kept") return "kept";
  return normalizePublishedStatus(item.status || item.reviewStatus || "draft");
}

function isPublished(item) {
  return ["published", "kept", "flagged"].includes(getDisplayStatus(item));
}

function setMetricValue(element, value) {
  if (element) element.textContent = Number(value || 0).toLocaleString("en-PH");
}

function lastSevenDayCounts(items, dateSelector = item => item.createdAt) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    return day;
  });
  const counts = Array(7).fill(0);

  items.forEach(item => {
    const date = toDate(dateSelector(item));
    if (!date) return;
    date.setHours(0, 0, 0, 0);
    const index = days.findIndex(day => day.getTime() === date.getTime());
    if (index >= 0) counts[index] += 1;
  });

  return counts;
}

function updateMiniBars(container, values) {
  if (!container) return;
  const bars = [...container.querySelectorAll(".mini-bar")];
  const max = Math.max(1, ...values);

  bars.forEach((bar, index) => {
    const value = values[index] || 0;
    const height = value === 0 ? 5 : Math.max(12, (value / max) * 100);
    bar.style.height = `${height}%`;
    bar.dataset.value = String(value);
  });

  container.setAttribute("aria-label", `Seven day activity: ${values.join(", ")}`);
}

function safeExternalURL(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "data:"
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function showError(message, error) {
  console.error(message, error);

  if (!contentList) return;

  contentList.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">⚠️</span>
      <strong>${escapeHTML(message)}</strong>
      <p>${escapeHTML(error?.message || "Unknown error.")}</p>
    </div>
  `;
}


// =====================================================
// PREVIEW MODAL
// FIXED: Works with both existing HTML modal and
// dynamically-created modal.
// =====================================================

function ensurePreviewModal() {
  let modal = $("contentPreviewModal");

  // Create modal only if it does not exist in HTML.
  if (!modal) {
    const style = document.createElement("style");

    style.id = "adminPreviewModalStyles";

    style.textContent = `
      .preview-modal {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 100000;
        padding: 18px;
        background: rgba(10, 11, 20, .75);
        overflow-y: auto;
        align-items: center;
        justify-content: center;
      }

      .preview-modal.show {
        display: flex;
      }

      .preview-dialog {
        width: 100%;
        max-width: 850px;
        max-height: 92vh;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--surface);
        color: var(--text);
        box-shadow: 0 20px 70px rgba(0, 0, 0, .3);
      }

      .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 15px;
        padding: 20px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--surface);
      }

      .preview-header h2 {
        margin: 8px 0 0;
        font-size: 21px;
        overflow-wrap: anywhere;
      }

      .preview-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 1px;
        color: var(--purple);
      }

      .preview-close {
        width: 38px;
        height: 38px;
        border: 1px solid var(--border);
        border-radius: 50%;
        background: var(--surface-soft);
        color: var(--text);
        font-size: 23px;
        cursor: pointer;
      }

      .preview-body {
        padding: 22px;
      }

      .preview-section {
        margin-bottom: 22px;
      }

      .preview-section h3 {
        margin: 0 0 10px;
        font-size: 13px;
        color: var(--purple);
      }

      .preview-section p {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.8;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .preview-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 20px;
      }

      .preview-chip {
        padding: 8px 11px;
        border: 1px solid var(--border);
        border-radius: 9px;
        background: var(--surface-soft);
        color: var(--muted);
        font-size: 11px;
      }

      .preview-file {
        display: block;
        padding: 13px;
        margin-top: 10px;
        border: 1px solid var(--border);
        border-radius: 11px;
        color: var(--purple);
        overflow-wrap: anywhere;
        font-size: 12px;
      }

      .preview-media {
        width: 100%;
        max-height: 450px;
        margin-top: 12px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #111;
        object-fit: contain;
      }

      .preview-video {
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 0;
        border-radius: 12px;
        margin-top: 12px;
      }

      .preview-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        border-top: 1px solid var(--border);
        color: var(--muted);
        font-size: 11px;
      }

      .preview-footer button {
        padding: 10px 16px;
        border: 0;
        border-radius: 9px;
        background: var(--purple);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      @media (max-width: 600px) {
        .preview-modal {
          padding: 8px;
        }

        .preview-dialog {
          max-height: 95vh;
        }

        .preview-body {
          padding: 15px;
        }
      }
    `;

    if (!document.getElementById("adminPreviewModalStyles")) {
      document.head.appendChild(style);
    }

    modal = document.createElement("div");

    modal.id = "contentPreviewModal";
    modal.className = "preview-modal";

    modal.innerHTML = `
      <div class="preview-dialog">

        <div class="preview-header">
          <div>
            <span class="preview-label" id="previewType">
              CONTENT PREVIEW
            </span>

            <h2 id="previewTitle">Content Title</h2>
          </div>

          <button
            type="button"
            id="closePreview"
            class="preview-close"
            aria-label="Close preview">
            &times;
          </button>
        </div>

        <div class="preview-body" id="previewBody">
          Loading...
        </div>

        <div class="preview-footer">
          <span id="previewTeacher"></span>

          <button
            type="button"
            id="closePreviewBottom">
            Close Preview
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
  }

  // IMPORTANT:
  // Do not return early when the modal already exists.
  // Always make sure its close events are attached.

  if (modal.dataset.closeEventsAttached === "true") {
    return modal;
  }

  // Close when clicking the X or Close Preview button.
  modal.addEventListener("click", (event) => {
    const closeButton = event.target.closest(
      "#closePreview, #closePreviewBottom"
    );

    if (closeButton) {
      event.preventDefault();
      event.stopPropagation();

      closeContentPreview();
      return;
    }

    // Close when clicking the dark overlay.
    if (event.target === modal) {
      closeContentPreview();
    }
  });

  modal.dataset.closeEventsAttached = "true";

  return modal;
}


// =====================================================
// CLOSE CONTENT PREVIEW
// =====================================================

function closeContentPreview() {
  const modal = $("contentPreviewModal");

  if (!modal) return;

  // Hide modal.
  modal.classList.remove("show");

  // Restore page scrolling.
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";

  // Stop embedded videos and PDF previews.
  modal.querySelectorAll("iframe").forEach((iframe) => {
    iframe.src = "about:blank";
  });

  modal.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
}


// =====================================================
// KEYBOARD SUPPORT
// =====================================================

document.addEventListener("keydown", (event) => {
  const modal = $("contentPreviewModal");

  if (
    event.key === "Escape" &&
    modal?.classList.contains("show")
  ) {
    closeContentPreview();
  }
});


// =====================================================
// YOUTUBE EMBED
// =====================================================

function getYouTubeEmbed(value) {
  if (!value) return "";

  try {
    const parsed = new URL(value);
    let videoId = "";

    if (parsed.hostname === "youtu.be") {
      videoId = parsed.pathname.slice(1);
    } else if (
      parsed.hostname === "youtube.com" ||
      parsed.hostname.endsWith(".youtube.com") ||
      parsed.hostname === "www.youtube-nocookie.com"
    ) {
      videoId =
        parsed.searchParams.get("v") ||
        parsed.pathname.split("/").filter(Boolean).pop();
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) {
      return "";
    }

    return `https://www.youtube-nocookie.com/embed/${videoId}`;

  } catch {
    return "";
  }
}

// =====================================================
// ATTACHMENT PREVIEW
// =====================================================

function renderPreviewFile(item) {
  if (item.collectionName === "modulesV2" && Array.isArray(item.resources) && item.resources.length) {
    const resources = item.resources.map(resource => {
      const label = escapeHTML(resource.label || resource.fileName || "Learning resource");
      let url = "";
      if (resource.type === "file" && resource.base64) {
        url = `data:${resource.mimeType || "application/octet-stream"};base64,${resource.base64}`;
      } else {
        url = safeExternalURL(resource.url || "");
      }
      if (!url) return `<div class="preview-file">${label} <small>Preview unavailable</small></div>`;
      return `<a class="preview-file" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label} · Open resource</a>`;
    }).join("");
    return `<div class="preview-resource-list">${resources}</div>`;
  }

  let fileURL = "";
  let fileName = item.fileName || "Attached file";
  let mimeType = item.fileMimeType || "";

  if (item.type === "lesson") {
    if (item.fileDataBase64) {
      fileURL =
        `data:${mimeType || "application/octet-stream"};base64,${item.fileDataBase64}`;
    } else {
      fileURL = item.fileUrl || "";
    }
  }

  if (item.type === "module") {
    fileURL = item.fileURL || "";
  }

  if (!fileURL) {
    return "<p>No attachment uploaded.</p>";
  }

  // Base64 data is allowed only for lesson previews.
  const safeURL = item.type === "lesson" &&
    item.fileDataBase64
      ? fileURL
      : safeExternalURL(fileURL);

  if (!safeURL) {
    return "<p>Attachment URL is unavailable or invalid.</p>";
  }

  const safeName = escapeHTML(fileName);

  const isImage =
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif)$/i.test(fileName);

  const isPDF =
    mimeType === "application/pdf" ||
    /\.pdf$/i.test(fileName);

  let preview = "";

  if (isImage) {
    preview = `
      <img
        class="preview-media"
        src="${escapeHTML(safeURL)}"
        alt="${safeName}">
    `;
  } else if (isPDF) {
    preview = `
      <iframe
        class="preview-media"
        src="${escapeHTML(safeURL)}"
        title="${safeName}"
        style="height:450px;">
      </iframe>
    `;
  }

  return `
    <div class="preview-file">
      <strong>📎 ${safeName}</strong>
      ${preview}

      <p style="margin-top:12px;">
        <a
          href="${escapeHTML(safeURL)}"
          target="_blank"
          rel="noopener noreferrer">
          Open / Download Attachment
        </a>
      </p>
    </div>
  `;
}

// =====================================================
// OPEN CONTENT PREVIEW
// =====================================================

function openContentPreview(item) {
  if (!item) return;

  ensurePreviewModal();

  const modal = $("contentPreviewModal");
  const isLesson = item.type === "lesson";

  $("previewType").textContent = isLesson
    ? "LESSON PREVIEW"
    : "MODULE PREVIEW";

  $("previewTitle").textContent =
    item.title || "Untitled Content";

  $("previewTeacher").textContent =
    "Posted by: " + (
      item.teacherName ||
      item.createdByName ||
      getTeacherName(item.createdBy || item.teacherId)
    );

  const sections = [];

  sections.push(`
    <div class="preview-meta">
      <span class="preview-chip">
        ${isLesson ? "Lesson" : "Module"}
      </span>

      <span class="preview-chip">
        ${escapeHTML(getDisplayStatus(item))}
      </span>

      <span class="preview-chip">
        ${escapeHTML(formatDate(item.createdAt))}
      </span>
    </div>
  `);

  sections.push(`
    <section class="preview-section">
      <h3>Description</h3>
      <p>${escapeHTML(item.description || "No description provided.")}</p>
    </section>
  `);

  if (isLesson) {
    sections.push(`
      <section class="preview-section">
        <h3>Module</h3>
        <p>${escapeHTML(item.moduleName || "No module assigned")}</p>
      </section>
    `);
  } else {
    sections.push(`
      <section class="preview-section">
        <h3>Learning Objectives</h3>
        <p>${escapeHTML(item.learningObjectives || "Not provided")}</p>
      </section>

      <section class="preview-section">
        <h3>Estimated Duration</h3>
        <p>${escapeHTML(item.estimatedDuration || "Not specified")}</p>
      </section>

      <section class="preview-section">
        <h3>Assigned Sections</h3>
        <p>${escapeHTML(
          (item.sectionIds || []).join(", ") || "No sections assigned"
        )}</p>
      </section>

      <section class="preview-section">
        <h3>Availability</h3>
        <p>${escapeHTML(item.availableAt || "Not specified")}</p>
      </section>

      <section class="preview-section">
        <h3>Due Date</h3>
        <p>${escapeHTML(item.dueDate || "Not specified")}</p>
      </section>
    `);
  }

  sections.push(`
    <section class="preview-section">
      <h3>Learning Material / Attachment</h3>
      ${renderPreviewFile(item)}
    </section>
  `);

  if (item.videoUrl) {
    const embedURL = getYouTubeEmbed(item.videoUrl);

    sections.push(`
      <section class="preview-section">
        <h3>Video Material</h3>

        ${
          embedURL
            ? `
              <iframe
                class="preview-video"
                src="${escapeHTML(embedURL)}"
                title="Learning video"
                allowfullscreen>
              </iframe>
            `
            : `
              <a
                href="${escapeHTML(safeExternalURL(item.videoUrl))}"
                target="_blank"
                rel="noopener noreferrer">
                Open Video Link
              </a>
            `
        }
      </section>
    `);
  }

  if (
    item.type === "module" &&
    Array.isArray(item.resourceLinks) &&
    item.resourceLinks.length
  ) {
    const resources = item.resourceLinks.map((resource) => {
      const url = safeExternalURL(resource.url);

      if (!url) return "";

      return `
        <a
          class="preview-file"
          href="${escapeHTML(url)}"
          target="_blank"
          rel="noopener noreferrer">
          🔗 ${escapeHTML(
            resource.label || resource.type || "Resource"
          )}
        </a>
      `;
    }).join("");

    sections.push(`
      <section class="preview-section">
        <h3>Additional Resources</h3>
        ${resources || "<p>No valid resource links.</p>"}
      </section>
    `);
  }

  $("previewBody").innerHTML = sections.join("");

  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

// =====================================================
// NOTIFICATION POPUP
// =====================================================

function showNewPostNotification(item) {
  const notificationKey = `${item.type}_${item.id}`;

  if (notifiedPosts.has(notificationKey)) return;

  notifiedPosts.add(notificationKey);

  const type = item.type === "lesson" ? "Lesson" : "Module";

  const toast = document.createElement("div");

  toast.style.cssText = `
    position:fixed;
    top:20px;
    right:20px;
    z-index:200000;
    width:min(370px,calc(100% - 40px));
    padding:18px;
    border:1px solid var(--border);
    border-radius:15px;
    background:var(--surface);
    color:var(--text);
    box-shadow:0 12px 35px rgba(0,0,0,.22);
    animation:adminToastIn .3s ease;
  `;

  toast.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;">

      <div style="font-size:25px;">🔔</div>

      <div style="flex:1;min-width:0;">

        <strong style="font-size:14px;">
          New ${type} Published!
        </strong>

        <p style="
          font-size:13px;
          font-weight:700;
          color:var(--text);
          margin:8px 0;
          overflow-wrap:anywhere;">
          ${escapeHTML(item.title || "Untitled Content")}
        </p>

        <p style="
          font-size:11px;
          color:var(--muted);
          margin:0 0 12px;">
          Posted by ${escapeHTML(item.teacherName || item.createdByName || getTeacherName(item.createdBy || item.teacherId))}
        </p>

        <button
          type="button"
          class="admin-view-new-post"
          style="
            border:0;
            border-radius:8px;
            padding:9px 13px;
            background:var(--purple);
            color:white;
            font-weight:700;
            cursor:pointer;">
          View Post
        </button>

      </div>

      <button
        type="button"
        class="admin-close-toast"
        style="
          border:0;
          background:transparent;
          color:var(--muted);
          font-size:20px;
          cursor:pointer;">
        &times;
      </button>

    </div>
  `;

  document.body.appendChild(toast);

  toast.querySelector(".admin-view-new-post")
    .addEventListener("click", () => {
      openContentPreview(item);
      toast.remove();
    });

  toast.querySelector(".admin-close-toast")
    .addEventListener("click", () => toast.remove());

  setTimeout(() => toast.remove(), 12000);
}

// =====================================================
// AUTHENTICATION AND ADMIN VERIFICATION
// =====================================================

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

    const profile = profileSnap.data();

    if (
      String(profile.role || "").toLowerCase() !== "admin"
    ) {
      alert("Access denied. Administrator account required.");
      window.location.href = "../login.html";
      return;
    }

    isAuthenticated = true;

    ensurePreviewModal();

    await loadTeacherNames();

    startContentListeners();

  } catch (error) {
    console.error("Admin verification error:", error);

    showError(
      "Unable to verify administrator access.",
      error
    );
  }
});

// =====================================================
// LOAD TEACHER NAMES
// =====================================================

async function loadTeacherNames() {
  try {
    const snapshot = await getDocs(collection(db, "users"));
    teacherNames = {};
    teacherUids = new Set();

    snapshot.forEach(item => {
      const data = item.data();
      const role = String(data.role || "").trim().toLowerCase();
      if (role !== "teacher") return;

      teacherUids.add(item.id);
      teacherNames[item.id] =
        data.fullname || data.fullName || data.displayName ||
        data.name || data.email || "Unknown Teacher";
    });
  } catch (error) {
    console.warn("Unable to load teacher profiles:", error);
  }
}

// =====================================================
// TEACHER CONTENT LISTENERS
// =====================================================

function shouldNotifyPublishedChange(collectionName, change, data) {
  if (!isTeacherCreated(data)) return false;

  const key = `${collectionName}:${change.doc.id}`;
  const nextStatus = normalizePublishedStatus(data.status || data.reviewStatus);
  const previousStatus = previousPublicationStates.get(key);
  previousPublicationStates.set(key, nextStatus);

  if (!firstSnapshotByCollection.has(collectionName)) return false;

  return (
    (change.type === "added" && nextStatus === "published") ||
    (change.type === "modified" && previousStatus !== "published" && nextStatus === "published")
  );
}

function startTeacherContentListener(collectionName, type, onItems, options = {}) {
  return onSnapshot(
    collection(db, collectionName),
    snapshot => {
      if (options.notify) {
        snapshot.docChanges().forEach(change => {
          const data = change.doc.data();
          if (!shouldNotifyPublishedChange(collectionName, change, data)) return;
          showNewPostNotification({
            id: change.doc.id,
            type,
            collectionName,
            ...data
          });
        });

        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          previousPublicationStates.set(
            `${collectionName}:${docSnap.id}`,
            normalizePublishedStatus(data.status || data.reviewStatus)
          );
        });
      }

      const items = snapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          type,
          collectionName,
          ...docSnap.data()
        }))
        .filter(isTeacherCreated);

      firstSnapshotByCollection.add(collectionName);
      onItems(items);
    },
    error => {
      console.error(`[${collectionName}] teacher content listener error:`, error);
      if (options.critical) {
        showError(`Unable to load teacher ${type === "lesson" ? "lessons" : "modules"}.`, error);
      } else {
        console.warn(`Optional teacher collection unavailable: ${collectionName}`, error);
      }
    }
  );
}

function startContentListeners() {
  if (!contentList) {
    console.error("contentList element is missing.");
    return;
  }

  contentList.innerHTML = '<div class="loading-message">Loading teacher lessons and modules...</div>';

  // Teacher-created lessons.
  unsubscribeLessons = startTeacherContentListener(
    "lessons",
    "lesson",
    items => replaceContentSource("lessons", items),
    { notify: true, critical: true }
  );

  // Current teacher modules created in modulesV2.
  unsubscribeModulesV2 = startTeacherContentListener(
    "modulesV2",
    "module",
    items => replaceContentSource("modulesV2", items),
    { notify: true }
  );

  // Include older teacher modules from the legacy collection for compatibility.
  unsubscribeLegacyModules = startTeacherContentListener(
    "modules",
    "module",
    items => replaceContentSource("modules", items),
    { notify: true }
  );

  // Other teacher activities are summarized only. This page remains focused
  // on reviewing lesson and module posts.
  unsubscribeTeacherActivities = onSnapshot(
    collection(db, "teacherActivitiesV2"),
    snapshot => {
      teacherActivityItems = snapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(isTeacherCreated)
        .filter(item => String(item.type || "").toLowerCase() !== "module");
      updateStatistics();
      if (contentLastUpdated) {
        contentLastUpdated.textContent = `Live data • Updated ${new Date().toLocaleTimeString("en-PH")}`;
      }
    },
    error => {
      console.warn("Teacher activity summary unavailable:", error);
      teacherActivityItems = [];
      updateStatistics();
    }
  );
}

// =====================================================
// UPDATE LOCAL CONTENT BY SOURCE COLLECTION
// =====================================================

function replaceContentSource(collectionName, newItems) {
  allContent = allContent.filter(item => item.collectionName !== collectionName);
  allContent.push(...newItems);
  updateStatistics();
  renderContent();

  if (contentLastUpdated) {
    contentLastUpdated.textContent = `Live data • Updated ${new Date().toLocaleTimeString("en-PH")}`;
  }
}

// =====================================================
// COMBINED OVERVIEW + MICRO-CHARTS
// =====================================================

function updateStatistics() {
  const activeContent = allContent.filter(item => getDisplayStatus(item) !== "removed");
  const lessons = activeContent.filter(item => item.type === "lesson");
  const modules = activeContent.filter(item => item.type === "module");
  const flagged = allContent.filter(item => getModerationStatus(item) === "flagged");
  const activities = teacherActivityItems;

  setMetricValue(totalLessons, lessons.length);
  setMetricValue(totalModules, modules.length);
  setMetricValue(totalActivities, activities.length);
  setMetricValue(totalFlagged, flagged.length);

  updateMiniBars(lessonTrend, lastSevenDayCounts(lessons));
  updateMiniBars(moduleTrend, lastSevenDayCounts(modules));
  updateMiniBars(activityTrend, lastSevenDayCounts(activities));
  updateMiniBars(flaggedTrend, lastSevenDayCounts(
    flagged,
    item => item.flaggedAt || item.updatedAt || item.createdAt
  ));
}

// =====================================================
// FILTER EVENTS
// =====================================================

document.querySelectorAll("[data-content-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-content-tab]").forEach((tab) => {
      tab.classList.remove("active");
    });

    button.classList.add("active");

    activeTab = button.dataset.contentTab;

    renderContent();
  });
});

contentSearch?.addEventListener("input", renderContent);
contentStatusFilter?.addEventListener("change", renderContent);
contentSort?.addEventListener("change", renderContent);

// =====================================================
// FILTER CONTENT
// =====================================================

function getFilteredContent() {
  let items = [...allContent];

  const search = (
    contentSearch?.value || ""
  ).trim().toLowerCase();

  const selectedStatus =
    contentStatusFilter?.value || "all";

  if (activeTab !== "flagged") {
    items = items.filter(
      (item) => getDisplayStatus(item) !== "removed"
    );
  }

  if (activeTab === "lessons") {
    items = items.filter(
      (item) => item.type === "lesson"
    );
  }

  if (activeTab === "modules") {
    items = items.filter(
      (item) => item.type === "module"
    );
  }

  if (activeTab === "flagged") {
    items = items.filter(
      (item) => getModerationStatus(item) === "flagged"
    );
  }

  if (search) {
    items = items.filter((item) => {
      const title = String(item.title || "").toLowerCase();

      const description = String(
        item.description || ""
      ).toLowerCase();

      const teacher = String(
        item.teacherName ||
        item.createdByName ||
        getTeacherName(item.createdBy || item.teacherId)
      ).toLowerCase();

      return (
        title.includes(search) ||
        description.includes(search) ||
        teacher.includes(search)
      );
    });
  }

  if (selectedStatus !== "all") {
    items = items.filter(
      (item) => getDisplayStatus(item) === selectedStatus
    );
  }

  const sort = contentSort?.value || "newest";

  if (sort === "newest") {
    items.sort((a, b) =>
      timestamp(b.createdAt) - timestamp(a.createdAt)
    );
  }

  if (sort === "oldest") {
    items.sort((a, b) =>
      timestamp(a.createdAt) - timestamp(b.createdAt)
    );
  }

  if (sort === "title") {
    items.sort((a, b) =>
      String(a.title || "").localeCompare(
        String(b.title || "")
      )
    );
  }

  return items;
}

// =====================================================
// RENDER CONTENT
// =====================================================

function renderContent() {
  if (!contentList) return;

  const items = getFilteredContent();

  if (!items.length) {
    contentList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <strong>No content found</strong>
        <p>
          There are no lessons or modules matching your
          current filters.
        </p>
      </div>
    `;

    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    fragment.appendChild(createContentCard(item));
  });

  contentList.replaceChildren(fragment);
}

// =====================================================
// CONTENT CARD
// =====================================================

function createContentCard(item) {
  const card = document.createElement("article");

  card.className = "content-item";

  const status = getDisplayStatus(item);

  const typeLabel =
    item.type === "lesson" ? "LESSON" : "MODULE";

  let statusLabel = "Published";
  let statusClass = "active";

  if (status === "draft") {
    statusLabel = "Draft";
    statusClass = "draft";
  } else if (status === "archived") {
    statusLabel = "Archived";
    statusClass = "archived";
  } else if (status === "flagged") {
    statusLabel = "Flagged";
    statusClass = "draft";
  } else if (status === "removed") {
    statusLabel = "Removed";
    statusClass = "archived";
  } else if (status === "kept") {
    statusLabel = "Kept";
    statusClass = "active";
  }

  const title = escapeHTML(
    item.title || "Untitled Content"
  );

  const description = escapeHTML(
    item.description || "No description provided."
  );

  const teacher = escapeHTML(
    item.teacherName || item.createdByName || getTeacherName(item.createdBy || item.teacherId)
  );

  const createdAt = escapeHTML(
    formatDate(item.createdAt)
  );

  const flagReason = item.flagReason
    ? `
      <div style="margin-top:10px;color:var(--orange);font-size:11px;">
        <strong>Flag reason:</strong>
        ${escapeHTML(item.flagReason)}
      </div>
    `
    : "";

  card.innerHTML = `
    <div class="content-main">

      <div class="content-top">
        <span class="content-type">
          ${typeLabel}
        </span>

        <span class="content-status ${statusClass}">
          ${statusLabel}
        </span>
      </div>

      <h3 class="content-title">${title}</h3>

      <p class="content-description">${description}</p>

      <div class="content-meta">
        <span>${teacher}</span>
        <span>${createdAt}</span>
      </div>

      ${flagReason}

    </div>

    <div class="content-actions">

      <button
        type="button"
        class="action-button"
        data-action="view"
        data-id="${escapeHTML(item.id)}"
        data-type="${item.type}"
        data-collection="${escapeHTML(item.collectionName || (item.type === "lesson" ? "lessons" : "modules"))}">
        View
      </button>

      ${
        status !== "removed"
          ? `
            <button
              type="button"
              class="action-button keep"
              data-action="keep"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}"
              data-collection="${escapeHTML(item.collectionName || (item.type === "lesson" ? "lessons" : "modules"))}">
              Keep
            </button>

            <button
              type="button"
              class="action-button flag"
              data-action="flag"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}"
              data-collection="${escapeHTML(item.collectionName || (item.type === "lesson" ? "lessons" : "modules"))}">
              Flag
            </button>

            <button
              type="button"
              class="action-button remove"
              data-action="remove"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}"
              data-collection="${escapeHTML(item.collectionName || (item.type === "lesson" ? "lessons" : "modules"))}">
              Remove
            </button>
          `
          : `
            <span style="font-size:11px;color:var(--red);">
              Removed
            </span>
          `
      }

    </div>
  `;

  return card;
}


// Record successful moderation actions in the existing admin audit collection.
// This is best-effort: an audit-write issue must never roll back a completed review action.
async function recordContentAudit(action, item, reason = "") {
  if (!currentUser?.uid) return;

  try {
    await addDoc(collection(db, "activityLogs"), {
      userId: currentUser.uid,
      actorId: currentUser.uid,
      actorRole: "admin",
      action,
      contentId: String(item.id || ""),
      contentTitle: String(item.title || "Untitled Content"),
      contentType: String(item.type || "content"),
      collectionName: String(item.collectionName || ""),
      reason: String(reason || ""),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Content moderation audit log could not be saved:", error);
  }
}

// =====================================================
// ADMIN ACTIONS
// =====================================================

contentList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");

  if (!button || isProcessing) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const type = button.dataset.type;
  const collectionName = button.dataset.collection || (type === "lesson" ? "lessons" : "modules");

  if (!id || !type || !collectionName) return;

  const item = allContent.find(content =>
    content.id === id &&
    content.type === type &&
    content.collectionName === collectionName
  );

  if (!item) {
    alert("Content not found. Please refresh the page.");
    return;
  }

  // VIEW POST
  if (action === "view") {
    openContentPreview(item);
    return;
  }

  const contentTitle =
    item.title || "Untitled Content";

  let updatePayload = null;
  let actionReason = "";

  // KEEP
  if (action === "keep") {
    const confirmed = confirm(
      `Keep "${contentTitle}"?\n\nThis marks the content as reviewed and retained.`
    );

    if (!confirmed) return;

    updatePayload = {
      moderationStatus: "kept",
      reviewedBy: currentUser.uid,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  // FLAG
  else if (action === "flag") {
    const reason = prompt(
      `Why are you flagging "${contentTitle}"?\n\nEnter the reason:`
    );

    if (reason === null) return;

    if (!reason.trim()) {
      alert("Please enter a reason for flagging.");
      return;
    }

    actionReason = reason.trim();
    updatePayload = {
      moderationStatus: "flagged",
      flagReason: actionReason,
      flaggedBy: currentUser.uid,
      flaggedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  // PERMANENT REMOVE
  else if (action === "remove") {
    const reason = prompt(
      `Why are you permanently deleting "${contentTitle}"?\n\nEnter the reason:`
    );

    if (reason === null) return;

    if (!reason.trim()) {
      alert("Please enter a removal reason.");
      return;
    }

    actionReason = reason.trim();
    const confirmed = confirm(
      `PERMANENT DELETE\n\n"${contentTitle}" will be permanently deleted from Firestore.\n\nIt will no longer appear in the teacher and student content lists.\n\nThis action cannot be undone.\n\nContinue?`
    );

    if (!confirmed) return;
  } else {
    return;
  }

  try {
    isProcessing = true;
    button.disabled = true;

    const contentRef = doc(
      db,
      collectionName,
      id
    );

    if (action === "remove") {
      // Permanently delete the Firestore document.
      await deleteDoc(contentRef);
      await recordContentAudit("content_removed", item, actionReason);

      // Immediately remove from the local admin list.
      allContent = allContent.filter(
        (content) =>
          !(
            content.id === id &&
            content.type === type &&
            content.collectionName === collectionName
          )
      );

      updateStatistics();
      renderContent();

      // Close preview if the deleted item is currently open.
      closeContentPreview();

      alert(
        `"${contentTitle}" has been permanently deleted from Firestore.`
      );

    } else {
      // Keep and Flag remain moderation updates.
      await updateDoc(
        contentRef,
        updatePayload
      );
      await recordContentAudit(action === "keep" ? "content_kept" : "content_flagged", item, actionReason);

      if (action === "keep") {
        alert("Content marked as kept.");
      } else if (action === "flag") {
        alert("Content successfully flagged.");
      }
    }

  } catch (error) {
    console.error("Content moderation error:", error);

    alert(
      action === "remove"
        ? "Unable to permanently delete content.\n\n" +
          (error.message || "Check Firestore delete permissions.")
        : "Unable to update content.\n\n" +
          (error.message || "Check Firestore permissions.")
    );

  } finally {
    isProcessing = false;
    button.disabled = false;
  }
});


// =====================================================
// KEYBOARD SUPPORT
// =====================================================

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    $("contentPreviewModal")?.classList.contains("show")
  ) {
    closeContentPreview();
  }
});

// =====================================================
// CLEANUP
// =====================================================

window.addEventListener("beforeunload", () => {
  unsubscribeLessons?.();
  unsubscribeModulesV2?.();
  unsubscribeLegacyModules?.();
  unsubscribeTeacherActivities?.();
});
