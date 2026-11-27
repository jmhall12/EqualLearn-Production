import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  Room,
  RoomEvent,
  Track
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm";

/* =========================================
   CONFIGURATION
========================================= */

const TOKEN_URL =
  "https://equallearn-live-token.jommelhallig655.workers.dev/token";

/* =========================================
   ELEMENTS
========================================= */

const sessionList = document.getElementById("adminLiveList");
const searchInput = document.getElementById("adminLiveSearch");
const statusFilter = document.getElementById("adminLiveStatusFilter");
const modeFilter = document.getElementById("adminLiveModeFilter");
const pageMessage = document.getElementById("adminLiveMessage");

const meetingScreen = document.getElementById("adminMeetingScreen");
const meetingTitle = document.getElementById("adminMeetingTitle");
const meetingStatus = document.getElementById("adminMeetingStatus");
const meetingNotice = document.getElementById("adminMeetingNotice");
const meetingGrid = document.getElementById("adminMeetingGrid");
const meetingPeople = document.getElementById("adminMeetingPeople");
const meetingChat = document.getElementById("adminMeetingChat");
const meetingChatForm = document.getElementById("adminMeetingChatForm");
const meetingChatInput = document.getElementById("adminMeetingChatInput");

const micButton = document.getElementById("adminMeetingMic");
const cameraButton = document.getElementById("adminMeetingCamera");
const shareButton = document.getElementById("adminMeetingShare");
const leaveButton = document.getElementById("adminMeetingLeave");

/* =========================================
   STATE
========================================= */

let currentUser = null;
let currentProfile = null;

let sessions = [];
let unsubscribeSessions = null;
let currentRoom = null;
let currentSession = null;

let micEnabled = false;
let cameraEnabled = false;
let screenShareEnabled = false;
let joining = false;

/* =========================================
   HELPERS
========================================= */

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(message, isError = false) {
  if (!pageMessage) return;

  pageMessage.textContent = message;
  pageMessage.style.color = isError ? "#dc2626" : "#858ba0";
}

function formatDate(value) {
  if (!value) return "Date not available";

  try {
    const date = typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Date not available";
    }

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "Date not available";
  }
}

function sessionStatus(session) {
  return normalize(session.status || "scheduled");
}

function sessionMode(session) {
  return normalize(session.mode || "meeting");
}

function getTeacherName(session) {
  return session.teacherName || "Teacher";
}

function getSectionName(session) {
  return session.sectionName ||
    session.sectionId ||
    "Section not specified";
}

/* =========================================
   AUTHENTICATION AND ADMIN CHECK
========================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const profileSnapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnapshot.exists()) {
      throw new Error("Your account profile was not found.");
    }

    const profile = profileSnapshot.data();

    const role = normalize(profile.role);
    const accountStatus = normalize(profile.status);

    if (role !== "admin" || accountStatus === "inactive") {
      alert("Access denied. Administrator access is required.");
      window.location.href = "../login.html";
      return;
    }

    currentUser = user;
    currentProfile = profile;

    startSessionsListener();

  } catch (error) {
    console.error("ADMIN LIVE AUTH ERROR:", error);
    showMessage(error.message || "Unable to verify administrator.", true);

    if (sessionList) {
      sessionList.innerHTML = `
        <div class="admin-live-empty">
          Unable to verify administrator access.
        </div>
      `;
    }
  }
});

/* =========================================
   LIVE SESSION LISTENER
   Firestore pushes changes; no timer or page reload.
========================================= */

function startSessionsListener() {
  if (!currentUser || unsubscribeSessions) return;

  showMessage("Connecting to live classroom updates...");

  unsubscribeSessions = onSnapshot(
    collection(db, "liveSessions"),
    snapshot => {
      sessions = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      sessions.sort((a, b) => {
        const aDate = a.createdAt?.toMillis?.() || 0;
        const bDate = b.createdAt?.toMillis?.() || 0;
        return bDate - aDate;
      });

      // Re-render only the session list. Search/filter values stay intact.
      renderSessions();
      showMessage(`${sessions.length} classroom session(s) · Live updates enabled.`);
    },
    error => {
      console.error("ADMIN LIVE SESSION LISTENER ERROR:", error);
      showMessage(
        error.message || "Live updates are temporarily unavailable. Check Firestore permissions.",
        true
      );

      if (sessionList && sessions.length === 0) {
        sessionList.innerHTML = `
          <div class="admin-live-empty">
            Unable to load classroom sessions. Check Firestore permissions and connection.
          </div>
        `;
      }
    }
  );
}

/* =========================================
   RENDER SESSION LIST
========================================= */

function renderSessions() {
  if (!sessionList) return;

  const search = normalize(searchInput?.value);
  const status = normalize(statusFilter?.value || "all");
  const mode = normalize(modeFilter?.value || "all");

  const filtered = sessions.filter(session => {
    const currentStatus = sessionStatus(session);
    const currentMode = sessionMode(session);

    const searchable = normalize([
      session.title,
      session.description,
      session.teacherName,
      session.sectionName,
      session.sectionId,
      session.roomId,
      session.id
    ].join(" "));

    return (
      (!search || searchable.includes(search)) &&
      (status === "all" || currentStatus === status) &&
      (mode === "all" || currentMode === mode)
    );
  });

  if (!filtered.length) {
    sessionList.innerHTML = `
      <div class="admin-live-empty">
        No classroom sessions match your filters.
      </div>
    `;
    return;
  }

  sessionList.innerHTML = filtered.map(session => {
    const statusValue = sessionStatus(session);
    const modeValue = sessionMode(session);

    const isLive = statusValue === "live";
    const isJoinable = isLive &&
      ["meeting", "livestream"].includes(modeValue);

    const modeLabel = modeValue === "livestream"
      ? "Livestream"
      : "Interactive Meeting";

    return `
      <article class="admin-session-card">
        <div class="admin-session-top">
          <span class="admin-session-status ${isLive ? "live" : ""}">
            ${escapeHTML(statusValue)}
          </span>
          <span class="admin-session-mode">${escapeHTML(modeLabel)}</span>
        </div>

        <h3>${escapeHTML(session.title || "Untitled classroom")}</h3>

        <div class="admin-session-meta">
          <span><strong>Teacher</strong> · ${escapeHTML(getTeacherName(session))}</span>
          <span><strong>Section</strong> · ${escapeHTML(getSectionName(session))}</span>
          <span><strong>Created</strong> · ${escapeHTML(formatDate(session.createdAt))}</span>
        </div>

        <button
          type="button"
          class="admin-join-button"
          data-join-session="${escapeHTML(session.id)}"
          ${isJoinable ? "" : "disabled"}>
          ${isJoinable ? "Join classroom" :
            statusValue === "scheduled" ? "Waiting for teacher" :
            "Not joinable"}
        </button>
      </article>
    `;
  }).join("");
}

/* =========================================
   REQUEST LIVEKIT TOKEN
========================================= */

async function requestLiveKitToken(roomId) {
  if (!currentUser) {
    throw new Error("Please sign in again.");
  }

  const idToken = await currentUser.getIdToken();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ roomId })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success) {
    throw new Error(
      data.error || "Unable to obtain LiveKit access token."
    );
  }

  if (!data.serverUrl || !data.token) {
    throw new Error("The LiveKit Worker returned incomplete credentials.");
  }

  if (normalize(data.role) !== "admin") {
    throw new Error("The LiveKit Worker did not authorize this admin account.");
  }

  return data;
}

/* =========================================
   PARTICIPANT TILES
========================================= */

function participantName(participant) {
  return participant.name ||
    participant.identity ||
    "Participant";
}

function createParticipantTile(participant, isLocal = false) {
  const tile = document.createElement("div");
  tile.className = "admin-meeting-tile";
  tile.dataset.participant = participant.identity;

  const name = document.createElement("span");
  name.className = "admin-meeting-name";
  name.textContent = isLocal
    ? `${participantName(participant)} (You - Admin)`
    : participantName(participant);

  tile.appendChild(name);
  meetingGrid.appendChild(tile);

  return tile;
}

function findParticipantTile(identity) {
  return [...meetingGrid.children].find(
    tile => tile.dataset.participant === identity
  );
}

function attachTrack(track, participant) {
  let tile = findParticipantTile(participant.identity);

  if (!tile) {
    tile = createParticipantTile(participant);
  }

  const element = track.attach();

  if (track.kind === Track.Kind.Video) {
    element.autoplay = true;
    element.playsInline = true;
    element.style.width = "100%";
    element.style.height = "100%";
    element.style.objectFit = "contain";
  }

  if (track.kind === Track.Kind.Audio) {
    element.autoplay = true;
  }

  tile.insertBefore(element, tile.firstChild);
}

function detachTrack(track) {
  track.detach().forEach(element => element.remove());
}

function removeParticipantTile(participant) {
  const tile = findParticipantTile(participant.identity);
  tile?.remove();
}

/* =========================================
   PARTICIPANT LIST
========================================= */

function updateParticipants() {
  if (!currentRoom || !meetingPeople) return;

  const participants = [
    currentRoom.localParticipant,
    ...currentRoom.remoteParticipants.values()
  ];

  meetingPeople.replaceChildren();

  participants.forEach(participant => {
    const item = document.createElement("div");

    item.style.padding = "7px 0";
    item.style.borderBottom = "1px solid #30364a";
    item.textContent =
      `${participantName(participant)}${participant === currentRoom.localParticipant ? " (You)" : ""}`;

    meetingPeople.appendChild(item);
  });
}

/* =========================================
   CHAT
========================================= */

function appendChatMessage(sender, message) {
  if (!meetingChat) return;

  const item = document.createElement("div");
  item.style.marginBottom = "12px";

  const name = document.createElement("strong");
  name.textContent = sender;

  const content = document.createElement("div");
  content.textContent = message;
  content.style.marginTop = "4px";
  content.style.whiteSpace = "pre-wrap";
  content.style.overflowWrap = "anywhere";

  item.append(name, content);
  meetingChat.appendChild(item);
  meetingChat.scrollTop = meetingChat.scrollHeight;
}

async function sendChatMessage(message) {
  if (!currentRoom || !message.trim()) return;

  const encoder = new TextEncoder();

  const payload = encoder.encode(JSON.stringify({
    type: "chat",
    sender: currentUser.displayName || currentProfile?.name || "Admin",
    message: message.trim(),
    sentAt: new Date().toISOString()
  }));

  await currentRoom.localParticipant.publishData(payload, {
    reliable: true,
    topic: "equallearn-chat"
  });

  appendChatMessage(
    currentUser.displayName || currentProfile?.name || "Admin",
    message.trim()
  );
}

function handleIncomingData(payload, participant, kind, topic) {
  try {
    const data = JSON.parse(new TextDecoder().decode(payload));

    if (data.type !== "chat" || typeof data.message !== "string") {
      return;
    }

    appendChatMessage(
      data.sender || participant?.name || participant?.identity || "Participant",
      data.message
    );
  } catch (error) {
    console.warn("Unable to read meeting message:", error);
  }
}

/* =========================================
   MEETING CONTROLS
========================================= */

function updateControlButtons() {
  if (micButton) {
    micButton.textContent = micEnabled
      ? "ðŸ”‡ Mute Microphone"
      : "ðŸŽ™ Microphone Off";
  }

  if (cameraButton) {
    cameraButton.textContent = cameraEnabled
      ? "ðŸ“· Camera On"
      : "Camera Off";
  }

  if (shareButton) {
    shareButton.textContent = screenShareEnabled
      ? "Stop Sharing"
      : "â–£ Share Screen";
  }

  if (micButton) micButton.disabled = !currentRoom;
  if (cameraButton) cameraButton.disabled = !currentRoom;
  if (shareButton) shareButton.disabled = !currentRoom;
}

async function toggleMicrophone() {
  if (!currentRoom) return;

  try {
    micEnabled = !micEnabled;

    await currentRoom.localParticipant.setMicrophoneEnabled(
      micEnabled
    );

    updateControlButtons();

  } catch (error) {
    micEnabled = !micEnabled;
    updateControlButtons();
    showMeetingError(error);
  }
}

async function toggleCamera() {
  if (!currentRoom) return;

  try {
    cameraEnabled = !cameraEnabled;

    await currentRoom.localParticipant.setCameraEnabled(
      cameraEnabled
    );

    updateControlButtons();

  } catch (error) {
    cameraEnabled = !cameraEnabled;
    updateControlButtons();
    showMeetingError(error);
  }
}

async function toggleScreenShare() {
  if (!currentRoom) return;

  try {
    screenShareEnabled = !screenShareEnabled;

    await currentRoom.localParticipant.setScreenShareEnabled(
      screenShareEnabled
    );

    updateControlButtons();

  } catch (error) {
    screenShareEnabled = !screenShareEnabled;
    updateControlButtons();
    showMeetingError(error);
  }
}

function showMeetingError(error) {
  console.error("ADMIN MEETING CONTROL ERROR:", error);

  if (meetingNotice) {
    meetingNotice.textContent =
      error.message || "Unable to update meeting control.";
  }
}

/* =========================================
   JOIN LIVE CLASSROOM
========================================= */

async function joinClassroom(sessionId) {
  if (joining || currentRoom) return;

  joining = true;

  try {
    const session = sessions.find(item => item.id === sessionId);

    if (!session) {
      throw new Error("Classroom session was not found.");
    }

    if (sessionStatus(session) !== "live") {
      throw new Error("This classroom is not currently live.");
    }

    if (!["meeting", "livestream"].includes(sessionMode(session))) {
      throw new Error("Unsupported classroom session type.");
    }

    currentSession = session;

    meetingScreen.hidden = false;
    document.body.style.overflow = "hidden";

    meetingTitle.textContent =
      session.title || "EqualLearn Live";

    meetingStatus.textContent = "Requesting secure access...";
    meetingNotice.textContent = "Connecting to classroom...";

    meetingGrid.replaceChildren();
    meetingPeople.textContent = "Connecting...";
    meetingChat.replaceChildren();

    const access = await requestLiveKitToken(
      session.roomId || session.id
    );

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    currentRoom = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachTrack(track, participant);
      updateParticipants();
    });

    room.on(RoomEvent.TrackUnsubscribed, track => {
      detachTrack(track);
    });

    room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      if (publication.track) {
        detachTrack(publication.track);
      }
    });

    room.on(RoomEvent.ParticipantConnected, updateParticipants);

    room.on(RoomEvent.ParticipantDisconnected, participant => {
      removeParticipantTile(participant);
      updateParticipants();
    });

    room.on(RoomEvent.DataReceived, handleIncomingData);

    room.on(RoomEvent.Disconnected, () => {
      if (currentRoom === room) {
        currentRoom = null;
        resetMeetingUI();
      }
    });

    await room.connect(access.serverUrl, access.token);

    /*
      Admin is an observer/participant, not the meeting owner.
      Do not update Firestore session status or teacher ownership.
    */

    createParticipantTile(room.localParticipant, true);

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) {
          attachTrack(publication.track, participant);
        }
      }
    }

    updateParticipants();

    micEnabled = false;
    cameraEnabled = false;
    screenShareEnabled = false;

    updateControlButtons();

    meetingStatus.textContent =
      `Connected Â· ${sessionMode(session) === "livestream" ? "Livestream" : "Interactive meeting"}`;

    meetingNotice.textContent =
      "You joined as an administrator. Leaving will not end this classroom.";

  } catch (error) {
    console.error("ADMIN JOIN CLASSROOM ERROR:", error);

    showMessage(error.message || "Unable to join classroom.", true);

    if (currentRoom) {
      try {
        await currentRoom.disconnect();
      } catch (_) {}
    }

    currentRoom = null;
    currentSession = null;
    resetMeetingUI();

  } finally {
    joining = false;
  }
}

/* =========================================
   LEAVE CLASSROOM
========================================= */

async function leaveClassroom() {
  const room = currentRoom;

  currentRoom = null;
  currentSession = null;

  try {
    if (room) {
      await room.disconnect();
    }
  } catch (error) {
    console.warn("ADMIN LEAVE WARNING:", error);
  }

  /*
    Intentionally:
    - Do not update liveSessions.status.
    - Do not delete the session.
    - Do not change teacherUid.
    - Do not end the teacher's meeting.
  */

  resetMeetingUI();
  showMessage("You left the classroom. The teacher's session remains unchanged.");
}

function resetMeetingUI() {
  meetingScreen.hidden = true;
  document.body.style.overflow = "";

  meetingGrid.replaceChildren();
  meetingPeople.textContent = "";
  meetingChat.replaceChildren();

  meetingStatus.textContent = "Disconnected";
  meetingNotice.textContent = "";

  micEnabled = false;
  cameraEnabled = false;
  screenShareEnabled = false;

  updateControlButtons();
}

/* =========================================
   EVENT LISTENERS
========================================= */

searchInput?.addEventListener("input", renderSessions);
statusFilter?.addEventListener("change", renderSessions);
modeFilter?.addEventListener("change", renderSessions);

sessionList?.addEventListener("click", event => {
  const button = event.target.closest("[data-join-session]");

  if (!button || button.disabled) return;

  joinClassroom(button.dataset.joinSession);
});

micButton?.addEventListener("click", toggleMicrophone);
cameraButton?.addEventListener("click", toggleCamera);
shareButton?.addEventListener("click", toggleScreenShare);
leaveButton?.addEventListener("click", leaveClassroom);

meetingChatForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const message = meetingChatInput.value.trim();

  if (!message) return;

  try {
    await sendChatMessage(message);
    meetingChatInput.value = "";
  } catch (error) {
    showMeetingError(error);
  }
});

window.addEventListener("beforeunload", () => {
  // Stop the Firestore listener and disconnect the admin's local LiveKit room.
  if (unsubscribeSessions) unsubscribeSessions();
  currentRoom?.disconnect();
});
