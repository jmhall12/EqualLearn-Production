
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// ======================================================
// ELEMENTS
// ======================================================

const teacherCount = document.getElementById("teacherCount");
const studentCount = document.getElementById("studentCount");
const moduleCount = document.getElementById("moduleCount");
const lessonCount = document.getElementById("lessonCount");
const adminName = document.getElementById("adminName");
const logoutBtn = document.getElementById("logout");

const refreshLiveBtn = document.getElementById("refreshLiveSessions");
const liveSessionsContainer = document.getElementById("adminLiveSessions");
const liveSessionsMessage = document.getElementById("liveSessionsMessage");

const liveOngoingCount = document.getElementById("liveOngoingCount");
const liveScheduledCount = document.getElementById("liveScheduledCount");
const liveEndedCount = document.getElementById("liveEndedCount");
const liveLastUpdated = document.getElementById("liveLastUpdated");

let currentAdmin = null;

// ======================================================
// AUTHENTICATION AND ADMIN ACCESS
// ======================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

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

    if (adminName) {
      adminName.textContent =
        userData.fullname || user.email || "Administrator";
    }

    await Promise.all([
      loadDashboardCounts(),
      loadLiveSessions()
    ]);

  } catch (error) {
    console.error("ADMIN DASHBOARD ERROR:", error);

    if (liveSessionsMessage) {
      liveSessionsMessage.textContent =
        "Unable to load dashboard data. Check your connection and permissions.";
    }

    alert("Unable to load dashboard data.");
  }
});

// ======================================================
// DASHBOARD COUNTS
// ======================================================

async function loadDashboardCounts() {
  const [
    teacherSnapshot,
    studentSnapshot,
    moduleSnapshot,
    lessonSnapshot
  ] = await Promise.all([
    getDocs(query(
      collection(db, "users"),
      where("role", "==", "teacher")
    )),
    getDocs(query(
      collection(db, "users"),
      where("role", "==", "student")
    )),
    getDocs(collection(db, "modules")),
    getDocs(collection(db, "lessons"))
  ]);

  if (teacherCount) teacherCount.textContent = teacherSnapshot.size;
  if (studentCount) studentCount.textContent = studentSnapshot.size;
  if (moduleCount) moduleCount.textContent = moduleSnapshot.size;
  if (lessonCount) lessonCount.textContent = lessonSnapshot.size;
}

// ======================================================
// LIVE SESSION MONITORING
// ======================================================

async function loadLiveSessions() {
  if (!currentAdmin || !liveSessionsContainer) return;

  if (refreshLiveBtn) refreshLiveBtn.disabled = true;

  liveSessionsContainer.replaceChildren();

  if (liveSessionsMessage) {
    liveSessionsMessage.textContent = "Loading live sessions...";
  }

  try {
    // Admin reads the liveSessions collection.
    // Firestore rules must explicitly authorize admin access.
    const snapshot = await getDocs(collection(db, "liveSessions"));

    const sessions = snapshot.docs.map((sessionDoc) => ({
      id: sessionDoc.id,
      ...sessionDoc.data()
    }));

    sessions.sort((a, b) => {
      const timeA = getTimestamp(a.createdAt);
      const timeB = getTimestamp(b.createdAt);
      return timeB - timeA;
    });

    const ongoing = sessions.filter(s => s.status === "live");
    const scheduled = sessions.filter(s => s.status === "scheduled");
    const ended = sessions.filter(s => s.status === "ended");

    if (liveOngoingCount) liveOngoingCount.textContent = ongoing.length;
    if (liveScheduledCount) liveScheduledCount.textContent = scheduled.length;
    if (liveEndedCount) liveEndedCount.textContent = ended.length;

    if (liveLastUpdated) {
      liveLastUpdated.textContent =
        `Last refreshed: ${new Date().toLocaleString()}`;
    }

    if (!sessions.length) {
      if (liveSessionsMessage) {
        liveSessionsMessage.textContent =
          "No live classroom sessions found.";
      }
      return;
    }

    if (liveSessionsMessage) {
      liveSessionsMessage.textContent =
        `${sessions.length} session(s) found.`;
    }

    sessions.forEach((session) => {
      liveSessionsContainer.appendChild(
        createSessionCard(session)
      );
    });

  } catch (error) {
    console.error("ADMIN LIVE MONITOR ERROR:", error);

    if (liveSessionsMessage) {
      liveSessionsMessage.textContent =
        "Unable to load live sessions. Check Firestore permissions.";
    }

    if (liveOngoingCount) liveOngoingCount.textContent = "—";
    if (liveScheduledCount) liveScheduledCount.textContent = "—";
    if (liveEndedCount) liveEndedCount.textContent = "—";

  } finally {
    if (refreshLiveBtn) refreshLiveBtn.disabled = false;
  }
}

// ======================================================
// SESSION CARD
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
  const normalizedStatus = String(session.status || "unknown").toLowerCase();

  status.className = `live-status ${
    ["live", "scheduled", "ended"].includes(normalizedStatus)
      ? normalizedStatus
      : ""
  }`;
  status.textContent = normalizedStatus.toUpperCase();

  top.append(title, status);

  const meta = document.createElement("div");
  meta.className = "live-session-meta";

  const details = [
    ["Teacher", session.teacherName || "Not specified"],
    ["Section", session.sectionName || "Not specified"],
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

  if (!timestamp) return "Not available";

  return new Date(timestamp).toLocaleString();
}

// ======================================================
// REFRESH
// ======================================================

if (refreshLiveBtn) {
  refreshLiveBtn.addEventListener("click", () => {
    loadLiveSessions();
  });
}

// ======================================================
// LOGOUT
// ======================================================

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();

    try {
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Logout error:", error);
      alert("Unable to logout.");
    }
  });
}
