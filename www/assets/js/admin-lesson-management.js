import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — ADMIN LESSON MANAGEMENT
   Monitors lessons published by teachers and lets an admin
   remove or restore them from the student view.
   Uses the same "lessons" records and moderation fields that
   admin-check-content.js already reads and writes.
========================================================= */

const $ = id => document.getElementById(id);

const lessonList = $("lessonList");
const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const refreshBtn = $("refreshBtn");
const lastUpdated = $("lastUpdated");

const totalCount = $("totalCount");
const activeCount = $("activeCount");
const removedCount = $("removedCount");
const teacherCount = $("teacherCount");

const previewModal = $("previewModal");
const previewTitle = $("previewTitle");
const previewContent = $("previewContent");
const removeModal = $("removeModal");
const removeReason = $("removeReason");
const confirmRemove = $("confirmRemove");

let lessons = [];
let currentUser = null;
let unsubscribe = null;
let pendingRemoval = null;

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "Not recorded";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function safeURL(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    if (!["https:", "http:", "data:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function moderationOf(lesson) {
  return normalize(lesson.moderationStatus);
}

function isRemoved(lesson) {
  return moderationOf(lesson) === "removed";
}

function teacherOf(lesson) {
  return lesson.teacherName || lesson.teacher || "Unknown teacher";
}

function lessonFiles(lesson) {
  return [
    ["Lesson file", lesson.fileUrl || lesson.fileURL || lesson.pdfUrl],
    ["Video", lesson.videoUrl],
    ["Resource", lesson.resourceUrl]
  ].filter(([, url]) => safeURL(url));
}

function openModal(modal) {
  if (modal) modal.classList.add("open");
}

function closeModal(modal) {
  if (modal) modal.classList.remove("open");
}

/* ---------------------------------------------------------
   RENDER
--------------------------------------------------------- */

function renderStats() {
  const teachers = new Set(
    lessons.map(lesson => String(lesson.teacherUid || teacherOf(lesson)))
  );

  if (totalCount) totalCount.textContent = lessons.length;
  if (activeCount) {
    activeCount.textContent = lessons.filter(lesson => !isRemoved(lesson)).length;
  }
  if (removedCount) {
    removedCount.textContent = lessons.filter(isRemoved).length;
  }
  if (teacherCount) teacherCount.textContent = teachers.size;
  if (lastUpdated) lastUpdated.textContent = `Updated ${formatDate(new Date())}`;
}

function lessonCard(lesson) {
  const removed = isRemoved(lesson);
  const files = lessonFiles(lesson);

  return `
    <article class="lesson-card">
      <div>
        <div class="meta">
          <span class="pill ${removed ? "removed" : ""}">${
            removed ? "Removed by admin" : "Published"
          }</span>
          <span>${escapeHTML(lesson.moduleName || lesson.moduleTitle || "No module")}</span>
          <span>${escapeHTML(teacherOf(lesson))}</span>
          <span>${escapeHTML(formatDate(lesson.createdAt || lesson.updatedAt))}</span>
        </div>
        <h2>${escapeHTML(lesson.title || "Untitled lesson")}</h2>
        <p class="desc">${escapeHTML(
          lesson.description || "No description provided."
        )}</p>
        ${files.length ? `<p class="muted">${files.length} attachment${files.length === 1 ? "" : "s"}</p>` : ""}
        ${removed && lesson.moderationReason
          ? `<p class="muted">Reason: ${escapeHTML(lesson.moderationReason)}</p>`
          : ""}
      </div>
      <div class="actions">
        <button class="btn view" type="button" data-view="${escapeHTML(lesson.id)}">View</button>
        ${
          removed
            ? `<button class="btn restore" type="button" data-restore="${escapeHTML(lesson.id)}">Restore</button>`
            : `<button class="btn remove" type="button" data-remove="${escapeHTML(lesson.id)}">Remove</button>`
        }
      </div>
    </article>
  `;
}

function render() {
  if (!lessonList) return;

  const term = normalize(searchInput?.value);
  const filter = statusFilter?.value || "all";

  const rows = lessons
    .filter(lesson => {
      if (filter === "active" && isRemoved(lesson)) return false;
      if (filter === "removed" && !isRemoved(lesson)) return false;
      if (!term) return true;
      return normalize(
        `${lesson.title} ${lesson.description} ${teacherOf(lesson)} ${
          lesson.moduleName || lesson.moduleTitle
        }`
      ).includes(term);
    })
    .sort(
      (a, b) =>
        (toDate(b.createdAt || b.updatedAt)?.getTime() || 0) -
        (toDate(a.createdAt || a.updatedAt)?.getTime() || 0)
    );

  if (!rows.length) {
    lessonList.innerHTML = `<div class="empty">${
      lessons.length
        ? "No lessons match this search or filter."
        : "No lessons have been published yet."
    }</div>`;
    return;
  }

  lessonList.innerHTML = rows.map(lessonCard).join("");
}

/* ---------------------------------------------------------
   ACTIONS
--------------------------------------------------------- */

function findLesson(id) {
  return lessons.find(lesson => lesson.id === id);
}

function previewLesson(lesson) {
  if (!lesson || !previewContent) return;

  const files = lessonFiles(lesson)
    .map(
      ([label, url]) =>
        `<a class="file-link" href="${escapeHTML(safeURL(url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(
          label
        )}</a>`
    )
    .join("");

  if (previewTitle) {
    previewTitle.textContent = lesson.title || "Lesson preview";
  }

  previewContent.innerHTML = `
    <p class="muted">${escapeHTML(teacherOf(lesson))} · ${escapeHTML(
      lesson.moduleName || lesson.moduleTitle || "No module"
    )} · ${escapeHTML(formatDate(lesson.createdAt || lesson.updatedAt))}</p>
    <p>${escapeHTML(lesson.description || "No description provided.")}</p>
    ${files}
    ${lesson.videoUrl && !safeURL(lesson.videoUrl) ? "" : ""}
  `;

  openModal(previewModal);
}

function askRemove(lesson) {
  if (!lesson) return;

  pendingRemoval = lesson;

  if (removeReason) {
    removeReason.value = "";
  }

  openModal(removeModal);
}

async function removeLesson() {
  if (!pendingRemoval) return;

  const reason = String(removeReason?.value || "").trim();

  if (!reason) {
    alert("A reason is required before a lesson can be removed.");
    return;
  }

  if (confirmRemove) confirmRemove.disabled = true;

  try {
    await updateDoc(doc(db, "lessons", pendingRemoval.id), {
      moderationStatus: "removed",
      moderationReason: reason,
      moderatedBy: currentUser.uid,
      moderatedAt: serverTimestamp()
    });

    closeModal(removeModal);
    pendingRemoval = null;
  } catch (error) {
    console.error("[EqualLearn] Remove lesson failed:", error);
    alert(error.message || "Unable to remove this lesson.");
  } finally {
    if (confirmRemove) confirmRemove.disabled = false;
  }
}

async function restoreLesson(lesson) {
  if (!lesson) return;

  try {
    await updateDoc(doc(db, "lessons", lesson.id), {
      moderationStatus: "kept",
      moderationReason: "",
      moderatedBy: currentUser.uid,
      moderatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("[EqualLearn] Restore lesson failed:", error);
    alert(error.message || "Unable to restore this lesson.");
  }
}

/* ---------------------------------------------------------
   EVENTS
--------------------------------------------------------- */

lessonList?.addEventListener("click", event => {
  const view = event.target.closest("[data-view]");
  const remove = event.target.closest("[data-remove]");
  const restore = event.target.closest("[data-restore]");

  if (view) previewLesson(findLesson(view.dataset.view));
  if (remove) askRemove(findLesson(remove.dataset.remove));
  if (restore) restoreLesson(findLesson(restore.dataset.restore));
});

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    closeModal(document.getElementById(button.dataset.close));
  });
});

[previewModal, removeModal].forEach(modal => {
  modal?.addEventListener("click", event => {
    if (event.target === modal) closeModal(modal);
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeModal(previewModal);
    closeModal(removeModal);
  }
});

confirmRemove?.addEventListener("click", removeLesson);
searchInput?.addEventListener("input", render);
statusFilter?.addEventListener("change", render);
refreshBtn?.addEventListener("click", () => {
  if (lastUpdated) lastUpdated.textContent = "Refreshing…";
  render();
});

/* ---------------------------------------------------------
   BOOT
--------------------------------------------------------- */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  currentUser = user;

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));

    if (!profileSnap.exists()) {
      throw new Error("Administrator profile not found.");
    }

    const profile = profileSnap.data();
    const role = normalize(profile.role);

    if (role !== "admin" && role !== "gad_coordinator") {
      throw new Error("An administrator account is required.");
    }

    if (unsubscribe) unsubscribe();

    unsubscribe = onSnapshot(
      collection(db, "lessons"),
      snapshot => {
        lessons = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        renderStats();
        render();
      },
      error => {
        console.error("[EqualLearn] Lesson monitor failed:", error);

        if (lessonList) {
          lessonList.innerHTML = `<div class="error"><strong>Lessons could not be loaded.</strong><p>${escapeHTML(
            error.message || "Please try again."
          )}</p></div>`;
        }
      }
    );
  } catch (error) {
    console.error("[EqualLearn] Lesson management error:", error);

    if (lessonList) {
      lessonList.innerHTML = `<div class="error"><strong>Access denied.</strong><p>${escapeHTML(
        error.message || "An administrator account is required."
      )}</p></div>`;
    }
  }
});
