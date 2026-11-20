import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc, getDoc, collection, query, where, getDocs, onSnapshot,
  orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  Room, RoomEvent, Track
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm";

const TOKEN_URL =
  "https://equallearn-live-token.jommelhallig655.workers.dev/token";

// Dashboard elements
const studentName = document.getElementById("studentName");
const studentSection = document.getElementById("studentSection");
const studentTeacher = document.getElementById("studentTeacher");
const studentCohort = document.getElementById("studentCohort");

const notificationList = document.getElementById("notificationList");
const notificationCount = document.getElementById("notificationCount");

const liveSessionList = document.getElementById("liveSessionList");
const liveSessionCount = document.getElementById("liveSessionCount");

const sessionIdInput =
  document.getElementById("studentSessionIdInput");

const joinBySessionIdBtn =
  document.getElementById("joinBySessionIdBtn");

const sessionIdMessage =
  document.getElementById("sessionIdMessage");

// Full-screen meeting elements
const meetingScreen =
  document.getElementById("studentMeetingScreen");

const meetingTitle =
  document.getElementById("studentMeetingTitle");

const participantGrid =
  document.getElementById("studentParticipantGrid");

const meetingNotice =
  document.getElementById("studentMeetingNotice");

const sidebar =
  document.getElementById("studentMeetingSidebar");

const sidebarTitle =
  document.getElementById("studentSidebarTitle");

const peopleContainer =
  document.getElementById("studentMeetingPeople");

const chatContainer =
  document.getElementById("studentMeetingChat");

const chatForm =
  document.getElementById("studentMeetingChatForm");

const chatInput =
  document.getElementById("studentMeetingChatInput");

const micBtn =
  document.getElementById("studentMeetingMic");

const cameraBtn =
  document.getElementById("studentMeetingCamera");

const shareBtn =
  document.getElementById("studentMeetingShare");

const raiseHandBtn =
  document.getElementById("studentMeetingRaiseHand");

const meetingLayout =
  document.getElementById("studentMeetingLayout");

const meetingToastHost =
  document.getElementById("studentMeetingToastHost");

const leaveBtn =
  document.getElementById("studentMeetingLeave");

let currentStudent = null;
let currentProfile = null;
let currentRoom = null;
let currentSession = null;

let micEnabled = false;
let cameraEnabled = false;
let shareEnabled = false;
let canPublish = false;
let joining = false;
let handRaised = false;
let liveSessionsUnsubscribe = null;
const raisedHands = new Set();

const encoder = new TextEncoder();

function text(element, value, fallback = "Not assigned") {
  if (element) {
    element.textContent = value || fallback;
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function message(element, value, error = false) {
  if (!element) return;

  element.textContent = value;
  element.style.color = error ? "#dc2626" : "";
}

function setControlLabel(button, label, isOff = false, isActive = false) {
  if (!button) return;
  const span = button.querySelector("span");
  if (span) span.textContent = label;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.classList.toggle("is-off", isOff);
  button.classList.toggle("is-active", isActive);
}

function handIconMarkup() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12V5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v4-2a2 2 0 0 1 4 0v4c0 5-3 8-8 8h-1c-3.5 0-5.6-1.8-6.6-4.8L3 14.5a2 2 0 0 1 3.3-2.1L8 14"/></svg>';
}

function showHandRaiseToast(name, raised) {
  if (!meetingToastHost) return;
  meetingToastHost.querySelectorAll(".hand-raise-toast").forEach(node => node.remove());
  if (!raised) return;
  const toast = document.createElement("div");
  toast.className = "hand-raise-toast";
  toast.innerHTML = handIconMarkup();
  const label = document.createElement("span");
  label.textContent = `${name} raised their hand`;
  toast.appendChild(label);
  meetingToastHost.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function setParticipantHand(participant, raised, displayName = "Participant") {
  const identity = participant?.identity;
  if (!identity) return;
  if (raised) raisedHands.add(identity);
  else raisedHands.delete(identity);

  const tile = participantGrid?.querySelector(
    `.sm-tile[data-identity="${CSS.escape(identity)}"]:not([data-tile-type="screen-share"])`
  );
  if (tile) {
    let indicator = tile.querySelector(".sm-hand-indicator");
    if (raised && !indicator) {
      indicator = document.createElement("div");
      indicator.className = "sm-hand-indicator";
      indicator.innerHTML = handIconMarkup();
      const label = document.createElement("span");
      label.textContent = "Hand raised";
      indicator.appendChild(label);
      tile.appendChild(indicator);
    } else if (!raised) {
      indicator?.remove();
    }
  }
  if (raised && participant !== currentRoom?.localParticipant) {
    showHandRaiseToast(displayName, true);
  }
  renderParticipants();
}

function addCameraPlaceholder(tile, name, isLocal = false) {
  if (!tile || tile.querySelector("video")) return;
  if (tile.querySelector(".sm-placeholder")) return;
  const placeholder = document.createElement("div");
  placeholder.className = "sm-placeholder";
  placeholder.textContent = isLocal ? "Your camera is off" : `${name} camera is off`;
  tile.prepend(placeholder);
}

function timestamp(value) {
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

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

function formatDate(value) {
  const time = timestamp(value);

  return time
    ? new Date(time).toLocaleString()
    : "Recently";
}

// ======================================================
// MEETING SCREEN
// ======================================================

function showMeeting() {
  if (!meetingScreen) {
    throw new Error(
      "Meeting screen is not available on this page."
    );
  }

  meetingScreen.hidden = false;
  meetingScreen.classList.add("active");

  document.body.style.overflow = "hidden";
  const lumiFrame = document.getElementById("equallearn-lumi-frame");
  if (lumiFrame) lumiFrame.style.display = "none";
  ensureReactionControls();
  void enterMeetingFullscreenAndLandscape();
}

function hideMeeting() {
  if (meetingScreen) {
    meetingScreen.classList.remove("active", "has-screen-share");
    meetingScreen.hidden = true;
  }

  participantGrid?.classList.remove("has-screen-share");
  try { screen.orientation?.unlock?.(); } catch (_) {}
  if (document.fullscreenElement === meetingScreen) {
    document.exitFullscreen?.().catch(() => {});
  }
  document.body.style.overflow = "";
  const lumiFrame = document.getElementById("equallearn-lumi-frame");
  if (lumiFrame) lumiFrame.style.display = "block";
}

// ======================================================
// PARTICIPANT VIDEO TILES
// ======================================================

const LIVE_REACTIONS = ["👍", "❤️", "😂", "👏", "😮", "🎉"];

function studentDisplayName() {
  return String(
    currentProfile?.fullname ||
    currentProfile?.fullName ||
    currentProfile?.displayName ||
    currentStudent?.displayName ||
    currentStudent?.email ||
    "Student"
  ).trim();
}

function ensureReactionControls() {
  const controls = meetingScreen?.querySelector(".meeting-controls");
  if (!controls || controls.querySelector(".live-reaction-bar")) return;

  const bar = document.createElement("div");
  bar.className = "live-reaction-bar";
  bar.setAttribute("aria-label", "Send a live reaction");

  LIVE_REACTIONS.forEach(reaction => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "live-reaction-button";
    button.textContent = reaction;
    button.title = `Send ${reaction}`;
    button.setAttribute("aria-label", `Send ${reaction} reaction`);
    button.addEventListener("click", () => sendLiveReaction(reaction));
    bar.appendChild(button);
  });

  controls.prepend(bar);

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.className = "live-fullscreen-button";
  fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
  fullscreenButton.setAttribute("aria-label", "Fullscreen");
  fullscreenButton.title = "Fullscreen";
  fullscreenButton.addEventListener("click", () =>
    enterMeetingFullscreenAndLandscape(Boolean(meetingScreen?.classList.contains("has-screen-share")))
  );
  controls.appendChild(fullscreenButton);
}

function showLiveReaction(reaction, participant, fallbackName = "Participant") {
  if (!participantGrid || !LIVE_REACTIONS.includes(reaction)) return;
  const identity = participant?.identity || currentRoom?.localParticipant?.identity;
  const name = participant?.name || fallbackName;
  let tile = identity
    ? participantGrid.querySelector(`[data-identity="${CSS.escape(identity)}"]`)
    : null;

  if (!tile && participant) tile = getTile(participant);
  if (!tile) return;

  const bubble = document.createElement("div");
  bubble.className = "live-reaction-pop";
  const emoji = document.createElement("span");
  emoji.className = "live-reaction-emoji";
  emoji.textContent = reaction;
  const label = document.createElement("small");
  label.textContent = name;
  bubble.append(emoji, label);
  tile.appendChild(bubble);
  window.setTimeout(() => bubble.remove(), 2400);
}

async function sendLiveReaction(reaction) {
  if (!currentRoom || !LIVE_REACTIONS.includes(reaction)) return;
  try {
    const payload = encoder.encode(JSON.stringify({
      type: "reaction",
      reaction,
      senderName: studentDisplayName(),
      sentAt: new Date().toISOString()
    }));
    await currentRoom.localParticipant.publishData(payload, { reliable: true });
    showLiveReaction(reaction, currentRoom.localParticipant, studentDisplayName());
  } catch (error) {
    message(meetingNotice, `Unable to send reaction: ${error.message}`, true);
  }
}

function isScreenShareSource(source) {
  return source === Track.Source.ScreenShare || source === "screen_share";
}

async function enterMeetingFullscreenAndLandscape(lockLandscape = false) {
  const target = meetingScreen;
  if (!target) return false;

  try {
    if (!document.fullscreenElement && typeof target.requestFullscreen === "function") {
      // Invoke this from a real user action (Join, Start, Share or Fullscreen button).
      await target.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (error) {
    console.info("Meeting fullscreen was not granted by this browser.", error);
  }

  if (!lockLandscape) return true;

  try {
    if (document.fullscreenElement === target && screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
      return true;
    }
  } catch (error) {
    console.info("Landscape orientation lock was not granted by this browser.", error);
  }

  const messageText = "For a wider screen-share view, rotate your phone to landscape. Some browsers only allow automatic rotation in fullscreen mode.";
  message(meetingNotice, messageText);
  return false;
}

async function updateScreenShareLayout() {
  const active = Boolean(participantGrid?.querySelector(".screen-share-tile video"));
  meetingScreen?.classList.toggle("has-screen-share", active);
  participantGrid?.classList.toggle("has-screen-share", active);
  if (active) {
    // A screen share takes over the meeting canvas; close panels so the content is unobstructed.
    closeSidebar();
    message(meetingNotice, "Screen sharing is pinned for everyone in this room.");
  } else {
    try { screen.orientation?.unlock?.(); } catch (_) {}
  }
}

function createTile(identity, name, isLocal = false, isScreenShare = false) {
  const tile = document.createElement("div");
  tile.className = "sm-tile";
  tile.dataset.identity = identity;
  tile.dataset.tileType = isScreenShare ? "screen-share" : "camera";
  if (isLocal && !isScreenShare) tile.classList.add("is-local-tile");
  if (isScreenShare) tile.classList.add("screen-share-tile");

  const placeholder = document.createElement("div");
  placeholder.className = "sm-placeholder";
  placeholder.textContent = isScreenShare ? `${name} is sharing their screen` : (isLocal ? "Your camera is off" : `${name} camera is off`);

  const label = document.createElement("div");
  label.className = "sm-name";
  label.textContent = isScreenShare ? `${name} · Presenting` : (isLocal ? `${name} (You)` : name);

  tile.append(placeholder, label);
  participantGrid?.appendChild(tile);
  return tile;
}

function getTile(participant, source = null) {
  if (!participantGrid || !participant) return null;
  const identity = participant.identity;
  const isShare = isScreenShareSource(source);
  const type = isShare ? "screen-share" : "camera";
  let tile = participantGrid.querySelector(
    `.sm-tile[data-identity="${CSS.escape(identity)}"][data-tile-type="${type}"]`
  );
  if (!tile) {
    tile = createTile(
      identity,
      participant.name || identity,
      participant === currentRoom?.localParticipant,
      isShare
    );
  }
  return tile;
}

function attachTrack(track, participant, source = null) {
  if (!track || !participant || !participantGrid) return;
  const isLocal = participant === currentRoom?.localParticipant;
  const isShare = isScreenShareSource(source);
  const tile = getTile(participant, source);
  if (!tile) return;

  if (track.kind === Track.Kind.Video) {
    tile.querySelector(".sm-placeholder")?.remove();
    // Keep camera and screen-share surfaces separate for the same participant.
    tile.querySelectorAll("video").forEach(video => video.remove());
    const video = track.attach();
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.classList.toggle("sm-local-video", isLocal && !isShare);
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = isShare ? "contain" : "cover";
    tile.insertBefore(video, tile.querySelector(".sm-name"));
    if (isShare) updateScreenShareLayout();
  } else if (track.kind === Track.Kind.Audio) {
    // Never attach the local microphone to the local page; that causes feedback.
    if (isLocal) return;
    const audio = track.attach();
    audio.autoplay = true;
    audio.style.display = "none";
    tile.appendChild(audio);
  }
}

function detachTrack(track, source = null) {
  if (!track) return;
  const isShare = isScreenShareSource(source || track.source);
  const isVideo = track.kind === Track.Kind.Video;
  const attached = track.detach();
  attached.forEach(element => {
    const tile = element.closest(".sm-tile");
    element.remove();
    if (isShare) tile?.remove();
    else if (isVideo && tile) {
      const name = tile.querySelector(".sm-name")?.textContent || "Participant";
      addCameraPlaceholder(tile, name, tile.classList.contains("is-local-tile"));
    }
  });
  if (isShare) updateScreenShareLayout();
}

function renderExistingParticipants() {
  if (!currentRoom) return;

  const local = currentRoom.localParticipant;

  getTile(local, null);

  for (const publication of local.trackPublications.values()) {
    if (publication.track) {
      attachTrack(publication.track, local, publication.source);
    }
  }

  for (const participant of currentRoom.remoteParticipants.values()) {
    getTile(participant, null);

    for (const publication of participant.trackPublications.values()) {
      if (publication.track) {
        attachTrack(publication.track, participant, publication.source);
      }
    }
  }

  renderParticipants();
}

function renderParticipants() {
  if (!peopleContainer || !currentRoom) return;

  peopleContainer.replaceChildren();

  const all = [
    currentRoom.localParticipant,
    ...currentRoom.remoteParticipants.values()
  ];

  const peopleButton = document.getElementById("studentPeopleTopBtn");
  if (peopleButton) {
    const count = peopleButton.querySelector("[data-participant-count]");
    if (count) count.textContent = String(all.length);
  }

  all.forEach(participant => {
    const row = document.createElement("div");

    row.className = "sm-person";

    const name = document.createElement("strong");

    name.textContent =
      participant.name ||
      participant.identity ||
      "Participant";

    const status = document.createElement("div");

    status.style.color = "#cbd5e1";

    status.textContent = raisedHands.has(participant.identity)
      ? "Hand raised"
      : participant === currentRoom.localParticipant
        ? "You"
        : "Connected";

    row.append(name, status);

    peopleContainer.appendChild(row);
  });
}

// ======================================================
// STUDENT PROFILE
// ======================================================

async function loadStudent(uid) {
  text(studentName, "Student");
  text(studentSection, "Loading...");
  text(studentTeacher, "Loading...");
  text(studentCohort, "Loading...");

  const snapshot = await getDoc(
    doc(db, "users", uid)
  );

  if (!snapshot.exists()) {
    throw new Error("Student profile not found.");
  }

  const profile = snapshot.data();

  if (
    profile.role !== "student" ||
    profile.status !== "active"
  ) {
    throw new Error("Your student account is not active.");
  }

  currentProfile = profile;

  text(studentName, profile.fullname, "Student");

  text(
    studentCohort,
    profile.cohort ||
    profile.cohortId ||
    profile.academicYear
  );

  await loadStudentSection(profile);
}

async function loadStudentSection(profile) {
  const sectionId = String(
    profile.sectionId || ""
  ).trim();

  text(studentSection, "Not assigned");
  text(studentTeacher, "Not yet assigned");

  if (!sectionId) return;

  const snapshot = await getDoc(
    doc(db, "sections", sectionId)
  );

  if (!snapshot.exists()) {
    text(studentSection, "Section not found");
    return;
  }

  const section = snapshot.data();

  const valid =
    (!profile.course ||
      normalize(section.course) === normalize(profile.course)) &&

    (!profile.section ||
      normalize(
        section.sectionName || section.section
      ) === normalize(profile.section)) &&

    (!profile.academicYear ||
      normalize(section.academicYear) ===
      normalize(profile.academicYear));

  if (!valid) {
    text(
      studentSection,
      "Assignment needs verification"
    );

    return;
  }

  text(
    studentSection,
    section.sectionName ||
    section.section ||
    sectionId
  );

  const hasTeacher =
    Boolean(section.teacherId) ||
    (
      Array.isArray(section.teacherIds) &&
      section.teacherIds.length > 0
    );

  text(
    studentTeacher,
    section.teacherName ||
    section.assignedTeacherName ||
    (hasTeacher ? "Teacher assigned" : "Not yet assigned")
  );
}

// ======================================================
// NOTIFICATIONS
// ======================================================

async function loadNotifications(uid) {
  if (!notificationList || !notificationCount) {
    return;
  }

  try {
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(5)
    );

    const snapshot = await getDocs(q);

    notificationList.replaceChildren();

    if (snapshot.empty) {
      const empty = document.createElement("p");

      empty.textContent = "No notifications yet.";

      notificationList.appendChild(empty);
      notificationCount.textContent = "0";

      return;
    }

    let unread = 0;

    snapshot.forEach(item => {
      const data = item.data();

      if (data.read === false) unread++;

      const box = document.createElement("div");

      box.className =
        data.read === false
          ? "notification unread"
          : "notification";

      const title = document.createElement("div");

      title.className = "notification-title";
      title.textContent = data.title || "Notification";

      const body = document.createElement("div");

      body.className = "notification-message";
      body.textContent = data.message || "";

      const time = document.createElement("div");

      time.className = "notification-time";
      time.textContent = formatDate(data.createdAt);

      box.append(title, body, time);

      notificationList.appendChild(box);
    });

    notificationCount.textContent = String(unread);

  } catch (error) {
    console.error("Notification loading error:", error);

    notificationList.textContent =
      "Unable to load notifications.";
  }
}

// ======================================================
// LIVE SESSION LIST
// ======================================================

function loadLiveSessions(uid) {
  if (!liveSessionList) return;
  if (liveSessionsUnsubscribe) {
    liveSessionsUnsubscribe();
    liveSessionsUnsubscribe = null;
  }

  liveSessionList.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "live-empty";
  loading.textContent = "Loading your live classrooms…";
  liveSessionList.appendChild(loading);

  const sessionsQuery = query(
    collection(db, "liveSessions"),
    where("participantUids", "array-contains", uid)
  );

  liveSessionsUnsubscribe = onSnapshot(
    sessionsQuery,
    snapshot => {
      const sessions = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(session => ["scheduled", "live", "ended"].includes(session.status))
        .filter(session => session.status !== "ended" || ["batch", "livestream"].includes(session.meetingType))
        .filter(session => session.meetingType !== "one_on_one" || session.targetStudentUid === uid)
        .sort((a, b) => {
          if (a.status === "live" && b.status !== "live") return -1;
          if (a.status !== "live" && b.status === "live") return 1;
          return timestamp(b.createdAt) - timestamp(a.createdAt);
        });

      liveSessionList.replaceChildren();
      if (liveSessionCount) liveSessionCount.textContent = String(sessions.length);

      if (!sessions.length) {
        const empty = document.createElement("div");
        empty.className = "live-empty";
        empty.textContent = "No scheduled or ongoing live classes for your account.";
        liveSessionList.appendChild(empty);
        return;
      }

      sessions.forEach(session => liveSessionList.appendChild(createSessionCard(session)));
    },
    error => {
      console.error("Live session listener error:", error);
      liveSessionList.replaceChildren();
      const errorMessage = document.createElement("div");
      errorMessage.className = "live-empty";
      errorMessage.textContent = "Unable to load live classes. Check your connection and permissions.";
      liveSessionList.appendChild(errorMessage);
    }
  );
}

function meetingTypeLabel(session) {
  if (session.meetingType === "one_on_one") {
    return "Private One-on-One";
  }

  if (session.meetingType === "batch") {
    return "Batch Meeting";
  }

  if (session.meetingType === "livestream") {
    return "Livestream";
  }

  return session.mode === "meeting"
    ? "Interactive Meeting"
    : "Livestream";
}

function openMeetingPage(sessionId) {
  if (!sessionId) return;

  const meetingUrl = new URL(
    "live.html",
    window.location.href
  );

  meetingUrl.searchParams.set(
    "sessionId",
    sessionId
  );

  window.location.assign(meetingUrl.href);
}

function createSessionCard(session) {
  const card = document.createElement("article");
  card.className = "student-live-card";

  const header = document.createElement("div");
  header.className = "student-live-card-header";

  const title = document.createElement("h4");
  title.textContent = session.title || "Untitled Live Class";

  const badge = document.createElement("span");
  badge.className = "student-live-status" + (session.status === "live" ? " is-live" : session.status === "ended" ? " is-ended" : "");
  badge.textContent = session.status === "live" ? "LIVE NOW" : session.status === "ended" ? "ENDED" : "SCHEDULED";
  header.append(title, badge);

  const teacher = document.createElement("p");
  teacher.className = "student-live-meta";
  teacher.textContent = `Teacher: ${session.teacherName || "Teacher"}`;

  const section = document.createElement("p");
  section.className = "student-live-meta";
  section.textContent = `Section: ${session.sectionName || session.sectionId || "Not specified"}`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "student-join-btn";

  if (session.status === "live") {
    button.textContent = "Join meeting";
    button.addEventListener("click", () => joinMeeting(session));
  } else if (session.status === "ended") {
    button.textContent = "Waiting to restart";
    button.disabled = true;
  } else {
    button.textContent = "Waiting for teacher";
    button.disabled = true;
  }

  card.append(header, teacher, section, button);
  return card;
}

// ======================================================
// SESSION ID JOINING FROM DASHBOARD
// ======================================================

async function joinUsingSessionId() {
  if (!currentStudent || !currentProfile) {
    message(
      sessionIdMessage,
      "Your account is still loading. Please try again.",
      true
    );

    return;
  }

  const sessionId = sessionIdInput?.value.trim();

  if (!sessionId) {
    message(
      sessionIdMessage,
      "Please enter the Session ID.",
      true
    );

    sessionIdInput?.focus();

    return;
  }

  if (joinBySessionIdBtn) {
    joinBySessionIdBtn.disabled = true;
    joinBySessionIdBtn.textContent = "Checking...";
  }

  message(
    sessionIdMessage,
    "Verifying your meeting access..."
  );

  try {
    const snapshot = await getDoc(
      doc(db, "liveSessions", sessionId)
    );

    if (!snapshot.exists()) {
      throw new Error(
        "The requested live session does not exist."
      );
    }

    const session = {
      ...snapshot.data(),
      id: snapshot.id
    };

    // Keep the same authorization checks used by the meeting page.
    verifyStudentCanJoin(
      session,
      currentStudent.uid
    );

    message(
      sessionIdMessage,
      "Access verified. Opening classroom..."
    );

    openMeetingPage(session.id);

  } catch (error) {
    console.error("Session ID join error:", error);

    message(
      sessionIdMessage,
      error.message || "Unable to join this session.",
      true
    );

  } finally {
    if (joinBySessionIdBtn) {
      joinBySessionIdBtn.disabled = false;
      joinBySessionIdBtn.textContent = "Join Class";
    }
  }
}

// ======================================================
// LIVEKIT TOKEN
// ======================================================

async function requestToken(roomId) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in again.");
  }

  const idToken = await user.getIdToken();

  const response = await fetch(TOKEN_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },

    body: JSON.stringify({
      roomId
    })
  });

  const data = await response.json().catch(() => ({}));

  if (
    !response.ok ||
    !data.success ||
    !data.serverUrl ||
    !data.token
  ) {
    throw new Error(
      data.error || "Unable to obtain LiveKit token."
    );
  }

  return data;
}

// ======================================================
// STUDENT SESSION AUTHORIZATION
// ======================================================

function verifyStudentCanJoin(session, uid) {
  if (session.status !== "live") {
    throw new Error("This meeting is not live yet.");
  }

  if (
    !Array.isArray(session.participantUids) ||
    !session.participantUids.includes(uid)
  ) {
    throw new Error(
      "You are not an authorized participant."
    );
  }

  if (
    session.meetingType === "one_on_one" &&
    session.targetStudentUid !== uid
  ) {
    throw new Error(
      "This private meeting is not assigned to your account."
    );
  }

  if (
    !currentProfile ||
    currentProfile.role !== "student" ||
    currentProfile.status !== "active"
  ) {
    throw new Error(
      "Your student account is not active."
    );
  }

  if (
    session.sectionId &&
    String(currentProfile.sectionId || "") !==
    String(session.sectionId)
  ) {
    throw new Error(
      "Your account does not belong to this meeting's section."
    );
  }
}

// ======================================================
// JOIN MEETING
// ======================================================

async function joinMeeting(session) {
  if (joining || currentRoom) return;

  if (!currentStudent) {
    throw new Error("Please sign in again.");
  }

  joining = true;

  try {
    verifyStudentCanJoin(
      session,
      currentStudent.uid
    );

    showMeeting();

    participantGrid?.replaceChildren();

    if (meetingTitle) {
      meetingTitle.textContent =
        `${session.title || "EqualLearn Live"} · ${meetingTypeLabel(session)}`;
    }

    message(
      meetingNotice,
      "Connecting to LiveKit..."
    );

    const access = await requestToken(session.id);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    currentRoom = room;
    currentSession = session;

    room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        attachTrack(track, participant, publication?.source);
        renderParticipants();
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track, publication) => {
        detachTrack(track, publication?.source);
      }
    );

    room.on(
      RoomEvent.ParticipantConnected,
      participant => {
        if (participant) getTile(participant);
        renderParticipants();
      }
    );

    room.on(
      RoomEvent.ParticipantDisconnected,
      participant => {
        participantGrid?.querySelectorAll(
          `.sm-tile[data-identity="${CSS.escape(participant.identity)}"]`
        ).forEach(tile => tile.remove());
        raisedHands.delete(participant.identity);
        renderParticipants();
      }
    );

    room.on(
      RoomEvent.LocalTrackPublished,
      publication => {
        if (publication.track) {
          attachTrack(
            publication.track,
            room.localParticipant,
            publication.source
          );
        }
      }
    );

    room.on(
      RoomEvent.LocalTrackUnpublished,
      publication => {
        if (publication.track) {
          detachTrack(publication.track, publication.source);
        }
      }
    );

    room.on(
      RoomEvent.DataReceived,
      (payload, participant) => {
        try {
          const data = JSON.parse(
            new TextDecoder().decode(payload)
          );

          if (
            data.type === "chat" &&
            typeof data.message === "string"
          ) {
            addChatMessage(
              participant?.name || data.sender || participant?.identity || "Participant",
              data.message
            );
          } else if (data.type === "reaction") {
            showLiveReaction(data.reaction, participant, data.senderName || "Participant");
          } else if (data.type === "raise_hand" || data.type === "raise-hand") {
            setParticipantHand(participant, Boolean(data.raised), data.senderName || participant?.name || "Participant");
          }

        } catch (error) {
          console.warn(
            "Invalid meeting data received.",
            error
          );
        }
      }
    );

    room.on(
      RoomEvent.Disconnected,
      () => {
        message(
          meetingNotice,
          "Disconnected from meeting.",
          true
        );
      }
    );

    await room.connect(
      access.serverUrl,
      access.token
    );

    canPublish =
      session.mode === "meeting" &&
      Array.isArray(session.publishUids) &&
      session.publishUids.includes(currentStudent.uid);

    if (canPublish) {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setCameraEnabled(true);

      micEnabled = true;
      cameraEnabled = true;

    } else {
      micEnabled = false;
      cameraEnabled = false;
    }

    handRaised = false;
    raisedHands.clear();
    closeSidebar();
    renderExistingParticipants();

    if (micBtn) {
      micBtn.disabled = !canPublish;

      setControlLabel(micBtn, micEnabled ? "Mute mic" : "Unmute mic", !micEnabled);
    }

    if (cameraBtn) {
      cameraBtn.disabled = !canPublish;

      setControlLabel(cameraBtn, cameraEnabled ? "Turn camera off" : "Turn camera on", !cameraEnabled);
    }

    if (shareBtn) {
      shareBtn.disabled = !canPublish;
      setControlLabel(shareBtn, "Share screen");
    }

    message(
      meetingNotice,
      canPublish
        ? "Connected. Your microphone and camera are on."
        : "Connected in viewer mode. Your microphone and camera are disabled."
    );

  } catch (error) {
    console.error("STUDENT JOIN ERROR:", error);

    if (currentRoom) {
      try {
        await currentRoom.disconnect();
      } catch (disconnectError) {
        console.warn(
          "LiveKit cleanup error:",
          disconnectError
        );
      }
    }

    currentRoom = null;
    currentSession = null;

    micEnabled = false;
    cameraEnabled = false;
    shareEnabled = false;
    canPublish = false;

    hideMeeting();

    message(
      meetingNotice,
      error.message || "Unable to join meeting.",
      true
    );

    alert(
      error.message || "Unable to join meeting."
    );

  } finally {
    joining = false;
  }
}

// ======================================================
// MICROPHONE
// ======================================================

async function toggleMic() {
  if (!currentRoom || !canPublish || !micBtn) return;
  const nextState = !micEnabled;
  try {
    await currentRoom.localParticipant.setMicrophoneEnabled(nextState);
    micEnabled = nextState;
    setControlLabel(micBtn, micEnabled ? "Mute mic" : "Unmute mic", !micEnabled);
  } catch (error) {
    message(meetingNotice, error.message || "Unable to change microphone.", true);
  }
}

// ======================================================
// CAMERA
// ======================================================

async function toggleCamera() {
  if (!currentRoom || !canPublish || !cameraBtn) return;
  const nextState = !cameraEnabled;
  try {
    await currentRoom.localParticipant.setCameraEnabled(nextState);
    cameraEnabled = nextState;
    setControlLabel(cameraBtn, cameraEnabled ? "Turn camera off" : "Turn camera on", !cameraEnabled);
    if (cameraEnabled) {
      const cameraPublication = [...currentRoom.localParticipant.trackPublications.values()]
        .find(publication => publication.source === Track.Source.Camera && publication.track);
      if (cameraPublication) attachTrack(cameraPublication.track, currentRoom.localParticipant, cameraPublication.source);
    }
  } catch (error) {
    message(meetingNotice, error.message || "Unable to change camera.", true);
  }
}

// ======================================================
// SCREEN SHARING
// ======================================================

async function toggleShareScreen() {
  if (!currentRoom || !canPublish || !shareBtn) {
    return;
  }

  const nextState = !shareEnabled;

  try {
    if (nextState) void enterMeetingFullscreenAndLandscape(true);
    await currentRoom.localParticipant.setScreenShareEnabled(
      nextState
    );
    shareEnabled = nextState;

    setControlLabel(shareBtn, shareEnabled ? "Stop sharing" : "Share screen", false, shareEnabled);

  } catch (error) {
    shareEnabled = false;

    setControlLabel(shareBtn, "Share screen");

    message(
      meetingNotice,
      error.message ||
      "Screen sharing is unavailable on this device.",
      true
    );
  }
}

// ======================================================
// RAISE HAND
// ======================================================
async function toggleRaiseHand() {
  if (!currentRoom || !raiseHandBtn || !currentStudent) return;
  const nextState = !handRaised;
  try {
    const payload = encoder.encode(JSON.stringify({
      type: "raise_hand",
      raised: nextState,
      senderName: studentDisplayName(),
      sentAt: new Date().toISOString()
    }));
    await currentRoom.localParticipant.publishData(payload, { reliable: true });
    handRaised = nextState;
    setParticipantHand(currentRoom.localParticipant, handRaised, studentDisplayName());
    setControlLabel(raiseHandBtn, handRaised ? "Lower hand" : "Raise hand", false, handRaised);
    if (handRaised) showHandRaiseToast("You", true);
  } catch (error) {
    message(meetingNotice, error.message || "Unable to raise your hand.", true);
  }
}

// ======================================================
// MEETING CHAT
// ======================================================

function addChatMessage(sender, content) {
  if (!chatContainer) return;

  const item = document.createElement("div");

  item.className = "sm-chat-item";

  const name = document.createElement("strong");

  name.textContent = sender;

  const body = document.createElement("span");

  body.textContent = String(content).slice(0, 1000);

  item.append(name, body);

  chatContainer.appendChild(item);

  chatContainer.scrollTop =
    chatContainer.scrollHeight;
}

async function sendChat(event) {
  event.preventDefault();

  if (!currentRoom || !chatInput || !currentStudent) {
    return;
  }

  const content = chatInput.value.trim();

  if (!content) return;

  try {
    const payload = encoder.encode(
      JSON.stringify({
        type: "chat",

        sender:
          currentStudent.displayName ||
          currentStudent.email ||
          "Student",

        message: content.slice(0, 1000),

        sentAt: new Date().toISOString()
      })
    );

    // Send only once. The previous version sent the same
    // message twice.
    await currentRoom.localParticipant.publishData(
      payload,
      {
        reliable: true
      }
    );

    addChatMessage(`${studentDisplayName()} (You)`, content);

    chatInput.value = "";

  } catch (error) {
    message(
      meetingNotice,
      "Unable to send message: " + error.message,
      true
    );
  }
}

// ======================================================
// SIDEBAR
// ======================================================

function openSidebar(mode) {
  if (!sidebar || meetingScreen?.classList.contains("has-screen-share")) return;
  sidebar.classList.add("open");
  meetingLayout?.classList.add("with-sidebar");
  const showChat = mode === "chat";
  if (sidebarTitle) sidebarTitle.textContent = showChat ? "Meeting chat" : "Participants";
  peopleContainer?.classList.toggle("sm-hidden", showChat);
  chatContainer?.classList.toggle("sm-hidden", !showChat);
  chatForm?.classList.toggle("sm-hidden", !showChat);
  if (!showChat) renderParticipants();
  if (showChat) chatInput?.focus();
}

function closeSidebar() {
  sidebar?.classList.remove("open");
  meetingLayout?.classList.remove("with-sidebar");
}

// ======================================================
// LEAVE MEETING
// ======================================================

async function leaveMeeting() {
  try {
    if (currentRoom) {
      await currentRoom.disconnect();
    }

  } catch (error) {
    console.warn(
      "Leave meeting error:",
      error
    );
  }

  currentRoom = null;
  currentSession = null;

  micEnabled = false;
  cameraEnabled = false;
  shareEnabled = false;
  canPublish = false;
  handRaised = false;
  raisedHands.clear();
  setControlLabel(raiseHandBtn, "Raise hand", false, false);

  hideMeeting();
  closeSidebar();
  meetingScreen?.classList.remove("has-screen-share");

  participantGrid?.replaceChildren();
  peopleContainer?.replaceChildren();
  chatContainer?.replaceChildren();

  if (micBtn) {
    micBtn.disabled = true;
    setControlLabel(micBtn, "Unmute mic", true);
  }

  if (cameraBtn) {
    cameraBtn.disabled = true;
    setControlLabel(cameraBtn, "Turn camera on", true);
  }

  if (shareBtn) {
    shareBtn.disabled = true;
    setControlLabel(shareBtn, "Share screen");
  }

  message(
    meetingNotice,
    "You left the meeting. The session remains active."
  );

  if (currentStudent) {
    await loadLiveSessions(currentStudent.uid);
  }
}

// ======================================================
// EVENT LISTENERS
// ======================================================

joinBySessionIdBtn?.addEventListener(
  "click",
  joinUsingSessionId
);

sessionIdInput?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinUsingSessionId();
  }
});

micBtn?.addEventListener("click", toggleMic);
cameraBtn?.addEventListener("click", toggleCamera);
shareBtn?.addEventListener("click", toggleShareScreen);
raiseHandBtn?.addEventListener("click", toggleRaiseHand);
leaveBtn?.addEventListener("click", leaveMeeting);

chatForm?.addEventListener("submit", sendChat);

document.getElementById("studentPeopleTopBtn")?.addEventListener("click", () => openSidebar("people"));
document.getElementById("studentMeetingPeopleBtn")?.addEventListener("click", () => openSidebar("people"));

document.getElementById("studentChatTopBtn")?.addEventListener("click", () => openSidebar("chat"));
document.getElementById("studentMeetingChatBtn")?.addEventListener("click", () => openSidebar("chat"));

document.getElementById("studentCloseSidebar")
  ?.addEventListener(
    "click",
    closeSidebar
  );

// ======================================================
// AUTHENTICATION AND AUTO-JOIN
// ======================================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  currentStudent = user;

  try {
    await loadStudent(user.uid);

    await loadNotifications(user.uid);

    await loadLiveSessions(user.uid);

    // Auto-join only on the dedicated meeting page.
    const requestedSessionId =
      new URLSearchParams(
        window.location.search
      ).get("sessionId");

    if (requestedSessionId && meetingScreen) {
      const sessionSnapshot = await getDoc(
        doc(
          db,
          "liveSessions",
          requestedSessionId
        )
      );

      if (!sessionSnapshot.exists()) {
        throw new Error(
          "The requested live session does not exist."
        );
      }

      const session = {
        ...sessionSnapshot.data(),
        id: sessionSnapshot.id
      };

      // Recheck authorization on the destination page.
      verifyStudentCanJoin(
        session,
        user.uid
      );

      await joinMeeting(session);
    }

  } catch (error) {
    console.error(
      "Student live initialization error:",
      error
    );

    message(
      meetingNotice || sessionIdMessage,
      error.message ||
      "Unable to open the live classroom.",
      true
    );

    alert(
      error.message ||
      "Unable to open the live classroom."
    );
  }
});

// ======================================================
// CLEANUP
// ======================================================

window.addEventListener("beforeunload", () => {
  if (liveSessionsUnsubscribe) liveSessionsUnsubscribe();
  if (currentRoom) currentRoom.disconnect();
});