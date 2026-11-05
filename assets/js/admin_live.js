import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// ======================================================
// ADMIN LIVE MONITOR ELEMENTS
// ======================================================

const refreshLiveBtn = document.getElementById("refreshLiveSessions");

const liveSessionsContainer = document.getElementById("adminLiveSessions");
const liveSessionsMessage = document.getElementById("liveSessionsMessage");

const liveOngoingCount = document.getElementById("liveOngoingCount");
const liveScheduledCount = document.getElementById("liveScheduledCount");
const liveEndedCount = document.getElementById("liveEndedCount");

const liveLastUpdated = document.getElementById("liveLastUpdated");

let currentAdmin = null;
let isLoading = false;

// ======================================================
// ADMIN AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const userSnapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!userSnapshot.exists()) {
      alert("User profile not found.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    const userData = userSnapshot.data();

    if (userData.role !== "admin") {
      alert("Access denied. Admin account required.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    currentAdmin = user;

    await loadLiveSessions();

  } catch (error) {
    console.error("ADMIN LIVE AUTH ERROR:", error);

    showMessage(
      "Unable to verify administrator access.",
      true
    );
  }
});

// ======================================================
// LOAD LIVE SESSIONS
// ======================================================

async function loadLiveSessions() {
  if (!currentAdmin || isLoading || !liveSessionsContainer) {
    return;
  }

  isLoading = true;

  if (refreshLiveBtn) {
    refreshLiveBtn.disabled = true;
  }

  liveSessionsContainer.replaceChildren();

  showMessage("Loading live classroom sessions...");

  try {
    const snapshot = await getDocs(
      collection(db, "liveSessions")
    );

    const sessions = snapshot.docs.map((sessionDoc) => ({
      id: sessionDoc.id,
      ...sessionDoc.data()
    }));

    sessions.sort((a, b) => {
      return getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
    });

    const ongoing = sessions.filter(
      session => session.status === "live"
    );

    const scheduled = sessions.filter(
      session => session.status === "scheduled"
    );

    const ended = sessions.filter(
      session => session.status === "ended"
    );

    updateCount(liveOngoingCount, ongoing.length);
    updateCount(liveScheduledCount, scheduled.length);
    updateCount(liveEndedCount, ended.length);

    if (liveLastUpdated) {
      liveLastUpdated.textContent =
        `Last refreshed: ${new Date().toLocaleString()}`;
    }

    if (sessions.length === 0) {
      showMessage("No live classroom sessions found.");
      return;
    }

    showMessage(`${sessions.length} session(s) found.`);

    sessions.forEach((session) => {
      liveSessionsContainer.appendChild(
        createSessionCard(session)
      );
    });

  } catch (error) {
    console.error("ADMIN LIVE MONITOR ERROR:", error);

    updateCount(liveOngoingCount, "—");
    updateCount(liveScheduledCount, "—");
    updateCount(liveEndedCount, "—");

    showMessage(
      "Unable to load live sessions. Check Firestore permissions.",
      true
    );

  } finally {
    isLoading = false;

    if (refreshLiveBtn) {
      refreshLiveBtn.disabled = false;
    }
  }
}

// ======================================================
// CREATE SESSION CARD
// ======================================================

function createSessionCard(session) {
  const card = document.createElement("article");
  card.className = "live-session-item";

  const top = document.createElement("div");
  top.className = "live-session-top";

  const title = document.createElement("div");
  title.className = "live-session-title";
  title.textContent = session.title || "Untitled Live Class";

  const status = document.createElement("span");

  const normalizedStatus = String(
    session.status || "unknown"
  ).toLowerCase();

  status.className = "live-status";

  if (["live", "scheduled", "ended"].includes(normalizedStatus)) {
    status.classList.add(normalizedStatus);
  }

  status.textContent = normalizedStatus.toUpperCase();

  top.append(title, status);

  const meta = document.createElement("div");
  meta.className = "live-session-meta";

  const details = [
    ["Teacher", session.teacherName || "Not specified"],
    ["Section", session.sectionName || session.sectionId || "Not specified"],
    ["Mode", session.mode || "Not specified"],
    ["Participants", getParticipantCount(session)],
    ["Created", formatTimestamp(session.createdAt)],
    ["Started", formatTimestamp(session.startedAt)],
    ["Ended", formatTimestamp(session.endedAt)]
  ];

  details.forEach(([label, value]) => {
    const item = document.createElement("span");
    item.textContent = `${label}: ${value}`;
    meta.appendChild(item);
  });

  card.append(top, meta);

  return card;
}

// ======================================================
// HELPERS
// ======================================================

function updateCount(element, value) {
  if (element) {
    element.textContent = String(value);
  }
}

function showMessage(message, isError = false) {
  if (!liveSessionsMessage) return;

  liveSessionsMessage.textContent = message;
  liveSessionsMessage.classList.toggle("live-error", isError);
}

function getParticipantCount(session) {
  if (Array.isArray(session.participantUids)) {
    return session.participantUids.length;
  }

  return "Not available";
}

function getTimestamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

function formatTimestamp(value) {
  const timestamp = getTimestamp(value);

  if (!timestamp) {
    return "Not available";
  }

  return new Date(timestamp).toLocaleString();
}

// ======================================================
// REFRESH BUTTON
// ======================================================

if (refreshLiveBtn) {
  refreshLiveBtn.addEventListener("click", () => {
    loadLiveSessions();
  });
}