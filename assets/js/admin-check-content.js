
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
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

const totalPublished = $("totalPublished");
const totalLessons = $("totalLessons");
const totalModules = $("totalModules");
const totalFlagged = $("totalFlagged");
const contentLastUpdated = $("contentLastUpdated");

// =====================================================
// STATE
// =====================================================

let currentUser = null;
let allContent = [];
let teacherNames = {};

let activeTab = "all";
let isProcessing = false;
let isAuthenticated = false;

let unsubscribeLessons = null;
let unsubscribeModules = null;

let firstLessonsSnapshot = true;
let firstModulesSnapshot = true;

// Remember previous module publication status.
// This prevents notifications on ordinary edits.
const previousModuleStates = new Map();

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

function getModerationStatus(item) {
  return String(item.moderationStatus || "").toLowerCase();
}

function getDisplayStatus(item) {
  const moderation = getModerationStatus(item);

  if (moderation === "removed") return "removed";
  if (moderation === "flagged") return "flagged";
  if (moderation === "kept") return "kept";

  if (item.type === "module") {
    return String(item.status || "draft").toLowerCase();
  }

  // Teacher lesson records currently have no status field.
  return "active";
}

function isPublished(item) {
  return [
    "active",
    "kept",
    "flagged"
  ].includes(getDisplayStatus(item));
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
// Creates the modal if it is not already in HTML.
// =====================================================

function ensurePreviewModal() {
  if ($("contentPreviewModal")) return;

  const style = document.createElement("style");

  style.textContent = `
    .preview-modal {
      display:none;
      position:fixed;
      inset:0;
      z-index:100000;
      padding:18px;
      background:rgba(10,11,20,.75);
      overflow-y:auto;
      align-items:center;
      justify-content:center;
    }

    .preview-modal.show {
      display:flex;
    }

    .preview-dialog {
      width:100%;
      max-width:850px;
      max-height:92vh;
      overflow-y:auto;
      border:1px solid var(--border);
      border-radius:20px;
      background:var(--surface);
      color:var(--text);
      box-shadow:0 20px 70px rgba(0,0,0,.3);
    }

    .preview-header {
      display:flex;
      justify-content:space-between;
      align-items:flex-start;
      gap:15px;
      padding:20px;
      border-bottom:1px solid var(--border);
      position:sticky;
      top:0;
      z-index:2;
      background:var(--surface);
    }

    .preview-header h2 {
      margin:8px 0 0;
      font-size:21px;
      overflow-wrap:anywhere;
    }

    .preview-label {
      font-size:10px;
      font-weight:800;
      letter-spacing:1px;
      color:var(--purple);
    }

    .preview-close {
      width:38px;
      height:38px;
      border:1px solid var(--border);
      border-radius:50%;
      background:var(--surface-soft);
      color:var(--text);
      font-size:23px;
      cursor:pointer;
    }

    .preview-body {
      padding:22px;
    }

    .preview-section {
      margin-bottom:22px;
    }

    .preview-section h3 {
      margin:0 0 10px;
      font-size:13px;
      color:var(--purple);
    }

    .preview-section p {
      color:var(--muted);
      font-size:13px;
      line-height:1.8;
      white-space:pre-wrap;
      overflow-wrap:anywhere;
    }

    .preview-meta {
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      margin-bottom:20px;
    }

    .preview-chip {
      padding:8px 11px;
      border:1px solid var(--border);
      border-radius:9px;
      background:var(--surface-soft);
      color:var(--muted);
      font-size:11px;
    }

    .preview-file {
      display:block;
      padding:13px;
      margin-top:10px;
      border:1px solid var(--border);
      border-radius:11px;
      color:var(--purple);
      overflow-wrap:anywhere;
      font-size:12px;
    }

    .preview-media {
      width:100%;
      max-height:450px;
      margin-top:12px;
      border:1px solid var(--border);
      border-radius:12px;
      background:#111;
      object-fit:contain;
    }

    .preview-video {
      width:100%;
      aspect-ratio:16/9;
      border:0;
      border-radius:12px;
      margin-top:12px;
    }

    .preview-footer {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      padding:16px 20px;
      border-top:1px solid var(--border);
      color:var(--muted);
      font-size:11px;
    }

    .preview-footer button {
      padding:10px 16px;
      border:0;
      border-radius:9px;
      background:var(--purple);
      color:white;
      font-weight:700;
      cursor:pointer;
    }

    @media(max-width:600px) {
      .preview-modal { padding:8px; }
      .preview-dialog { max-height:95vh; }
      .preview-body { padding:15px; }
    }

    @keyframes adminToastIn {
      from {
        opacity:0;
        transform:translateY(-12px);
      }
      to {
        opacity:1;
        transform:translateY(0);
      }
    }
  `;

  document.head.appendChild(style);

  const modal = document.createElement("div");

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
          class="preview-close">
          &times;
        </button>
      </div>

      <div class="preview-body" id="previewBody">
        Loading...
      </div>

      <div class="preview-footer">
        <span id="previewTeacher"></span>
        <button type="button" id="closePreviewBottom">
          Close Preview
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  $("closePreview").addEventListener(
    "click",
    closeContentPreview
  );

  $("closePreviewBottom").addEventListener(
    "click",
    closeContentPreview
  );

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeContentPreview();
    }
  });
}

function closeContentPreview() {
  $("contentPreviewModal")?.classList.remove("show");
  document.body.style.overflow = "";
}

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
    "Posted by: " + getTeacherName(item.createdBy);

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
          Posted by ${escapeHTML(getTeacherName(item.createdBy))}
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
    const snapshot = await getDocs(
      collection(db, "users")
    );

    teacherNames = {};

    snapshot.forEach((item) => {
      const data = item.data();

      teacherNames[item.id] =
        data.fullName ||
        data.displayName ||
        data.name ||
        data.email ||
        "Unknown Teacher";
    });

  } catch (error) {
    console.warn("Unable to load teacher names:", error);
  }
}

// =====================================================
// REALTIME FIRESTORE LISTENERS
// =====================================================

function startContentListeners() {
  if (!contentList) {
    console.error("contentList element is missing.");
    return;
  }

  contentList.innerHTML = `
    <div class="loading-message">
      Loading lessons and modules...
    </div>
  `;

  // ---------------------------------------------------
  // LESSONS
  // New lesson document = new teacher lesson post.
  // Existing lesson edits do not trigger a notification.
  // ---------------------------------------------------

  unsubscribeLessons = onSnapshot(
    collection(db, "lessons"),

    (snapshot) => {
      if (!firstLessonsSnapshot) {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;

          const data = change.doc.data();

          if (
            !data.createdBy ||
            data.createdBy === currentUser.uid
          ) {
            return;
          }

          const item = {
            id: change.doc.id,
            type: "lesson",
            ...data
          };

          showNewPostNotification(item);
        });
      }

      firstLessonsSnapshot = false;

      const lessons = snapshot.docs.map((item) => ({
        id: item.id,
        type: "lesson",
        ...item.data()
      }));

      replaceContentType("lesson", lessons);
    },

    (error) => {
      console.error("Lessons listener error:", error);
      showError("Unable to load lessons.", error);
    }
  );

  // ---------------------------------------------------
  // MODULES
  // Notify when:
  // 1. A new module is created as active.
  // 2. An existing draft becomes active.
  //
  // Ordinary edits to an active module do not notify.
  // ---------------------------------------------------

  unsubscribeModules = onSnapshot(
    collection(db, "modules"),

    (snapshot) => {
      if (!firstModulesSnapshot) {
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const moduleId = change.doc.id;

          const newStatus = String(
            data.status || "draft"
          ).toLowerCase();

          const oldStatus = previousModuleStates.get(moduleId);

          const isNewPublishedModule =
            change.type === "added" &&
            newStatus === "active";

          const isDraftNowPublished =
            change.type === "modified" &&
            oldStatus !== "active" &&
            newStatus === "active";

          if (
            (isNewPublishedModule || isDraftNowPublished) &&
            data.createdBy &&
            data.createdBy !== currentUser.uid
          ) {
            showNewPostNotification({
              id: moduleId,
              type: "module",
              ...data
            });
          }
        });
      }

      // Refresh remembered module statuses.
      snapshot.docs.forEach((item) => {
        const data = item.data();

        previousModuleStates.set(
          item.id,
          String(data.status || "draft").toLowerCase()
        );
      });

      firstModulesSnapshot = false;

      const modules = snapshot.docs.map((item) => ({
        id: item.id,
        type: "module",
        ...item.data()
      }));

      replaceContentType("module", modules);
    },

    (error) => {
      console.error("Modules listener error:", error);
      showError("Unable to load modules.", error);
    }
  );
}

// =====================================================
// UPDATE LOCAL CONTENT
// =====================================================

function replaceContentType(type, newItems) {
  allContent = allContent.filter(
    (item) => item.type !== type
  );

  allContent.push(...newItems);

  updateStatistics();
  renderContent();

  if (contentLastUpdated) {
    contentLastUpdated.textContent =
      "Last synchronized: " +
      new Date().toLocaleTimeString("en-PH");
  }
}

// =====================================================
// STATISTICS
// =====================================================

function updateStatistics() {
  const visibleContent = allContent.filter(
    (item) => getDisplayStatus(item) !== "removed"
  );

  const lessons = visibleContent.filter(
    (item) => item.type === "lesson"
  );

  const modules = visibleContent.filter(
    (item) => item.type === "module"
  );

  const published = visibleContent.filter(isPublished);

  const flagged = visibleContent.filter(
    (item) => getModerationStatus(item) === "flagged"
  );

  if (totalPublished) totalPublished.textContent = published.length;
  if (totalLessons) totalLessons.textContent = lessons.length;
  if (totalModules) totalModules.textContent = modules.length;
  if (totalFlagged) totalFlagged.textContent = flagged.length;
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

      const teacher = getTeacherName(
        item.createdBy
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
    getTeacherName(item.createdBy)
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
        <span>👤 ${teacher}</span>
        <span>📅 ${createdAt}</span>
      </div>

      ${flagReason}

    </div>

    <div class="content-actions">

      <button
        type="button"
        class="action-button"
        data-action="view"
        data-id="${escapeHTML(item.id)}"
        data-type="${item.type}">
        👁 View Post
      </button>

      ${
        status !== "removed"
          ? `
            <button
              type="button"
              class="action-button keep"
              data-action="keep"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}">
              ✓ Keep
            </button>

            <button
              type="button"
              class="action-button flag"
              data-action="flag"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}">
              ⚑ Flag
            </button>

            <button
              type="button"
              class="action-button remove"
              data-action="remove"
              data-id="${escapeHTML(item.id)}"
              data-type="${item.type}">
              ✕ Remove
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

// =====================================================
// ADMIN ACTIONS
// =====================================================

contentList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");

  if (!button || isProcessing) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const type = button.dataset.type;

  if (!id || !type) return;

  const item = allContent.find(
    (content) =>
      content.id === id &&
      content.type === type
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

  const collectionName =
    type === "lesson" ? "lessons" : "modules";

  const contentTitle =
    item.title || "Untitled Content";

  let updatePayload = null;

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

    updatePayload = {
      moderationStatus: "flagged",
      flagReason: reason.trim(),
      flaggedBy: currentUser.uid,
      flaggedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  // REMOVE
  else if (action === "remove") {
    const reason = prompt(
      `Why are you removing "${contentTitle}"?\n\nEnter the reason:`
    );

    if (reason === null) return;

    if (!reason.trim()) {
      alert("Please enter a removal reason.");
      return;
    }

    const confirmed = confirm(
      `Remove "${contentTitle}"?\n\nThis records a removal status. It does not permanently delete the document.`
    );

    if (!confirmed) return;

    updatePayload = {
      moderationStatus: "removed",
      removalReason: reason.trim(),
      removedBy: currentUser.uid,
      removedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  } else {
    return;
  }

  try {
    isProcessing = true;
    button.disabled = true;

    await updateDoc(
      doc(db, collectionName, id),
      updatePayload
    );

    if (action === "keep") {
      alert("Content marked as kept.");
    } else if (action === "flag") {
      alert("Content successfully flagged.");
    } else {
      alert("Content marked as removed.");
    }

  } catch (error) {
    console.error("Content moderation error:", error);

    alert(
      "Unable to update content.\n\n" +
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
  unsubscribeModules?.();
});
