
import { db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const announcementList = document.getElementById("announcementList");
const announcementCount = document.getElementById("announcementCount");
const searchInput = document.getElementById("searchAnnouncement");
const sortSelect = document.getElementById("sortAnnouncement");

let announcements = [];

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function getDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
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

function formatDate(value) {
  const date = getDate(value);

  if (!date) return "Date unavailable";

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getAnnouncementDate(item) {
  return getDate(
    item.createdAt ||
    item.publishedAt ||
    item.timestamp ||
    item.date
  ) || new Date(0);
}

function renderAnnouncements() {
  const search = searchInput.value.trim().toLowerCase();
  const sort = sortSelect.value;

  let filtered = announcements.filter(item => {
    const title = String(
      item.title || item.heading || ""
    ).toLowerCase();

    const message = String(
      item.content ||
      item.message ||
      item.description ||
      item.body ||
      ""
    ).toLowerCase();

    return title.includes(search) || message.includes(search);
  });

  filtered.sort((a, b) => {
    const difference =
      getAnnouncementDate(a) - getAnnouncementDate(b);

    return sort === "oldest" ? difference : -difference;
  });

  announcementCount.textContent = filtered.length;

  if (!filtered.length) {
    announcementList.innerHTML = `
      <div class="announcement-state">
        <strong>No announcements found</strong>
        ${
          search
            ? "Try another search keyword."
            : "There are currently no announcements available."
        }
      </div>
    `;
    return;
  }

  announcementList.innerHTML = filtered.map(item => {
    const title = escapeHTML(
      item.title || item.heading || "Untitled Announcement"
    );

    const message = escapeHTML(
      item.content ||
      item.message ||
      item.description ||
      item.body ||
      "No announcement details provided."
    );

    const category = escapeHTML(
      item.category || item.type || "General"
    );

    const author = escapeHTML(
      item.authorName ||
      item.teacherName ||
      item.createdByName ||
      "EqualLearn"
    );

    return `
      <article class="announcement-card">

        <div class="announcement-top">
          <span class="announcement-category">
            ${category}
          </span>

          <span class="announcement-date">
            ${formatDate(
              item.createdAt ||
              item.publishedAt ||
              item.timestamp ||
              item.date
            )}
          </span>
        </div>

        <h2>${title}</h2>

        <div class="announcement-message">${message}</div>

        <div class="announcement-author">
          Posted by ${author}
        </div>

      </article>
    `;
  }).join("");
}

async function loadAnnouncements(user) {
  announcementList.innerHTML = `
    <div class="announcement-state">
      <strong>Loading announcements...</strong>
      Please wait.
    </div>
  `;

  try {
    const snapshot = await getDocs(
      collection(db, "announcements")
    );

    announcements = snapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      }))
      .filter(item => {
        if (item.status === "draft") return false;
        if (item.published === false) return false;
        return true;
      });

    renderAnnouncements();

    console.log(
      "[STUDENT ANNOUNCEMENTS] Loaded:",
      announcements.length
    );

  } catch (error) {
    console.error(
      "[STUDENT ANNOUNCEMENTS] LOAD ERROR:",
      error
    );

    announcementList.innerHTML = `
      <div class="announcement-state announcement-error">
        <strong>Unable to load announcements</strong>
        ${escapeHTML(error.message || "Please try again later.")}
      </div>
    `;
  }
}

searchInput.addEventListener("input", renderAnnouncements);
sortSelect.addEventListener("change", renderAnnouncements);

requireRole("student", async user => {
  await loadAnnouncements(user);
});
