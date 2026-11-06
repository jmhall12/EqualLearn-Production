
import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
  collection, query, where, getDocs, doc, setDoc,
updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  Room, RoomEvent, Track
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm";

const TOKEN_URL =
  "https://equallearn-live-token.jommelhallig655.workers.dev/token";

// Form elements
const titleInput = document.getElementById("liveTitle");
const descriptionInput = document.getElementById("liveDescription");
const meetingTypeInput = document.getElementById("meetingType");
const sectionSelect = document.getElementById("sectionSelect");
const studentSelect = document.getElementById("studentSelect");
const studentSelectWrap = document.getElementById("studentSelectWrap");

const createBtn = document.getElementById("createLiveBtn");
const startBtn = document.getElementById("startLiveBtn");
const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const endBtn = document.getElementById("endLiveBtn");

const createMessage = document.getElementById("createMessage");
const connectionMessage = document.getElementById("connectionMessage");
const liveStatus = document.getElementById("liveStatus");
const preview = document.getElementById("teacherPreview");
const previewMessage = document.getElementById("previewMessage");

const sessionTitle = document.getElementById("sessionTitle");
const sessionIdDisplay = document.getElementById("sessionId");
const sessionModeDisplay = document.getElementById("sessionMode");
const sessionSectionDisplay = document.getElementById("sessionSection");
const sessionParticipantsDisplay = document.getElementById("sessionParticipants");
const sessionTeacher = document.getElementById("sessionTeacher");
const sessionState = document.getElementById("sessionState");

// Meeting elements
const meetingScreen = document.getElementById("meetingScreen");
const meetingTitle = document.getElementById("meetingTitle");
const participantGrid = document.getElementById("participantGrid");
const meetingNotice = document.getElementById("meetingNotice");
const meetingParticipants = document.getElementById("meetingParticipants");
const meetingSidebar = document.getElementById("meetingSidebar");
const sidebarTitle = document.getElementById("sidebarTitle");
const meetingChatMessages = document.getElementById("meetingChatMessages");
const meetingChatForm = document.getElementById("meetingChatForm");
const meetingChatInput = document.getElementById("meetingChatInput");

const meetingMicBtn = document.getElementById("meetingMicBtn");
const meetingCameraBtn = document.getElementById("meetingCameraBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const meetingEndBtn = document.getElementById("meetingEndBtn");
const meetingLeaveBtn = document.getElementById("meetingLeaveBtn");

let currentUser = null;
let currentSessionId = null;
let currentSession = null;
let currentRoom = null;

let assignedSections = [];
let sectionStudents = [];

let micEnabled = false;
let cameraEnabled = false;
let screenShareEnabled = false;
let busy = false;
let sidebarMode = "participants";

const encoder = new TextEncoder();

function showMessage(element, text, error = false) {
  if (!element) return;
  element.textContent = text;
  element.style.color = error ? "#dc2626" : "";
}

function setStatus(text, color = "#4f46e5") {
  if (!liveStatus) return;
  liveStatus.textContent = text;
  liveStatus.style.color = color;
}

function setFormEnabled(enabled) {
  if (createBtn) createBtn.disabled = !enabled;
  if (startBtn) startBtn.disabled = enabled || !currentSessionId;
  if (endBtn) endBtn.disabled = enabled || !currentRoom;
}

function safeName(profile, fallback = "Student") {
  return String(
    profile?.fullname || profile?.displayName || profile?.email || fallback
  );
}

function makeSessionId() {
  if (!crypto.randomUUID) {
    throw new Error("Your browser does not support secure session IDs.");
  }
  return crypto.randomUUID();
}

function escapeText(value) {
  return String(value ?? "");
}

function clearPreview(text) {
  if (!preview) return;
  preview.replaceChildren();
  const content = document.createElement("div");
  content.style.padding = "20px";
  const heading = document.createElement("h3");
  heading.textContent = "EqualLearn Live Room";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  content.append(heading, paragraph);
  preview.appendChild(content);
}

function showMeeting() {
  meetingScreen?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function hideMeeting() {
  meetingScreen?.classList.remove("active");
  document.body.style.overflow = "";
}

function createTile(identity, name, isLocal = false) {
  const tile = document.createElement("div");
  tile.className = "participant-tile";
  tile.dataset.identity = identity;

  const placeholder = document.createElement("div");
  placeholder.className = "participant-placeholder";
  placeholder.textContent = isLocal ? "Your camera is off" : `${name} camera is off`;

  const label = document.createElement("div");
  label.className = "participant-name";
  label.textContent = isLocal ? `${name} (You)` : name;

  tile.append(placeholder, label);
  participantGrid?.appendChild(tile);
  return tile;
}

function getTile(identity, name, isLocal = false) {
  let tile = participantGrid?.querySelector(
    `[data-identity="${CSS.escape(identity)}"]`
  );
  if (!tile) tile = createTile(identity, name, isLocal);
  return tile;
}

function attachTrack(track, participant, isLocal = false) {
  if (!track || !participant || !participantGrid) return;

  const identity = participant.identity;
  const name = participant.name || identity;
  const tile = getTile(identity, name, isLocal);

  if (track.kind === Track.Kind.Video) {
    tile.querySelector(".participant-placeholder")?.remove();
    const video = track.attach();
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    tile.insertBefore(video, tile.querySelector(".participant-name"));
  } else if (track.kind === Track.Kind.Audio) {
    const audio = track.attach();
    audio.autoplay = true;
    audio.style.display = "none";
    tile.appendChild(audio);
  }
}

function detachTrack(track) {
  if (!track) return;
  track.detach().forEach(element => element.remove());
}

function updateParticipantList() {
  if (!meetingParticipants) return;
  meetingParticipants.replaceChildren();

  if (!currentRoom) return;

  const participants = [
    currentRoom.localParticipant,
    ...Array.from(currentRoom.remoteParticipants.values())
  ];

  participants.forEach(participant => {
    const row = document.createElement("div");
    row.className = "meeting-person";
    const name = document.createElement("strong");
    name.textContent =
      participant.name || participant.identity || "Participant";

    const role = document.createElement("div");
    role.style.color = "#cbd5e1";
    role.textContent = participant === currentRoom.localParticipant
      ? "You · Teacher"
      : "Connected participant";

    row.append(name, role);
    meetingParticipants.appendChild(row);
  });
}

function renderExistingTracks() {
  if (!currentRoom) return;

  const local = currentRoom.localParticipant;
  createTile(local.identity, local.name || "Teacher", true);

  for (const publication of local.trackPublications.values()) {
    if (publication.track) attachTrack(publication.track, local, true);
  }

  for (const participant of currentRoom.remoteParticipants.values()) {
    createTile(
      participant.identity,
      participant.name || participant.identity
    );

    for (const publication of participant.trackPublications.values()) {
      if (publication.track) attachTrack(publication.track, participant);
    }
  }

  updateParticipantList();
}

async function loadAssignedSections(user) {
  const results = new Map();

  const [multipleTeacher, singleTeacher] = await Promise.all([
    getDocs(query(
      collection(db, "sections"),
      where("teacherIds", "array-contains", user.uid)
    )),
    getDocs(query(
      collection(db, "sections"),
      where("teacherId", "==", user.uid)
    ))
  ]);

  [...multipleTeacher.docs, ...singleTeacher.docs].forEach(sectionDoc => {
    results.set(sectionDoc.id, {
      id: sectionDoc.id,
      ...sectionDoc.data()
    });
  });

  assignedSections = [...results.values()];

  if (!sectionSelect) return;

  sectionSelect.replaceChildren();

  if (!assignedSections.length) {
    sectionSelect.add(new Option("No assigned sections found", ""));
    sectionSelect.disabled = true;
    throw new Error("Walang assigned section ang teacher account na ito.");
  }

  sectionSelect.disabled = false;
  sectionSelect.add(new Option("Select your assigned section", ""));

  assignedSections.forEach(section => {
    const label = section.sectionName || section.section || section.name || section.id;
    sectionSelect.add(new Option(label, section.id));
  });
}

async function loadStudentsForSection(sectionId) {
  sectionStudents = [];
  studentSelect?.replaceChildren();

  if (!sectionId) {
    studentSelect?.add(new Option("Select a section first", ""));
    return;
  }

  const snapshot = await getDocs(query(
    collection(db, "users"),
    where("role", "==", "student"),
    where("sectionId", "==", sectionId)
  ));

  sectionStudents = snapshot.docs
    .filter(item => item.data().status === "active")
    .map(item => ({
      uid: item.id,
      ...item.data()
    }));

  if (!studentSelect) return;

  studentSelect.add(new Option("Select one student", ""));

  sectionStudents.sort((a, b) =>
    safeName(a).localeCompare(safeName(b))
  );

  sectionStudents.forEach(student => {
    studentSelect.add(new Option(safeName(student), student.uid));
  });

  if (!sectionStudents.length) {
    studentSelect.replaceChildren(
      new Option("No active students in this section", "")
    );
  }
}

function selectedSection() {
  return assignedSections.find(section => section.id === sectionSelect?.value);
}

function selectedSectionName(section) {
  return section?.sectionName || section?.section || section?.name || section?.id || "";
}

async function createLiveClass() {
  if (busy || !currentUser) return;

  const title = titleInput?.value.trim();
  const description = descriptionInput?.value.trim() || "";
  const meetingType = meetingTypeInput?.value;
  const section = selectedSection();

  if (!title) {
    showMessage(createMessage, "Please enter a session title.", true);
    titleInput?.focus();
    return;
  }

  if (!section) {
    showMessage(createMessage, "Please select one of your assigned sections.", true);
    return;
  }

  if (!["batch", "one_on_one", "livestream"].includes(meetingType)) {
    showMessage(createMessage, "Invalid meeting type.", true);
    return;
  }

  const sectionStudentsList = sectionStudents;

  let selectedStudents = [];

  if (meetingType === "one_on_one") {
    const targetUid = studentSelect?.value;
    const target = sectionStudentsList.find(student => student.uid === targetUid);

    if (!target) {
      showMessage(createMessage, "Select one active student from this section.", true);
      return;
    }

    selectedStudents = [target];
  } else if (meetingType === "batch") {
    selectedStudents = sectionStudentsList;
  }

  if (meetingType === "livestream" && !sectionStudentsList.length) {
    showMessage(createMessage, "No active students found in this section.", true);
    return;
  }

  busy = true;
  setFormEnabled(false);
  showMessage(createMessage, "Creating your session...");

  try {
    const roomId = makeSessionId();
    const mode = meetingType === "livestream" ? "livestream" : "meeting";

    const studentUids = selectedStudents.map(student => student.uid);
    const participantUids = [...new Set([currentUser.uid, ...studentUids])];

    const teacherName = safeName(currentUser, "Teacher");
    const sectionName = selectedSectionName(section);

    const sessionData = {
      roomId,
      title,
      description,
      teacherUid: currentUser.uid,
      teacherName,
      sectionId: section.id,
      sectionName,
      meetingType,
      targetStudentUid: meetingType === "one_on_one" ? studentUids[0] : null,
      status: "scheduled",
      mode,
      participantUids,
      publishUids: meetingType === "livestream"
        ? [currentUser.uid]
        : participantUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "liveSessions", roomId), sessionData);

    currentSessionId = roomId;
    currentSession = { ...sessionData, id: roomId };

    if (sessionTitle) sessionTitle.textContent = title;
    if (sessionIdDisplay) sessionIdDisplay.textContent = roomId;
    if (sessionModeDisplay) {
      sessionModeDisplay.textContent = meetingType === "batch"
        ? "Batch Meeting"
        : meetingType === "one_on_one"
          ? "One-on-One Meeting"
          : "Livestream";
    }
    if (sessionSectionDisplay) sessionSectionDisplay.textContent = sectionName;
    if (sessionParticipantsDisplay) {
      sessionParticipantsDisplay.textContent =
        `${participantUids.length} authorized participant(s)`;
    }
    if (sessionTeacher) sessionTeacher.textContent = teacherName;
    if (sessionState) sessionState.textContent = "Scheduled";

    showMessage(
      createMessage,
      meetingType === "one_on_one"
        ? "Private session created for the selected student."
        : meetingType === "batch"
          ? `Batch session created. ${studentUids.length} active student(s) included.`
          : "Livestream session created."
    );

    clearPreview("Your classroom is ready. Start when you are prepared.");
    setStatus("Ready");
    startBtn.disabled = false;
    createBtn.disabled = true;

  } catch (error) {
    console.error("CREATE SESSION ERROR:", error);
    showMessage(createMessage, error.message || "Unable to create session.", true);
    createBtn.disabled = false;
  } finally {
    busy = false;
  }
}

async function requestLiveKitToken(roomId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");

  const idToken = await user.getIdToken();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ roomId })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success || !data.serverUrl || !data.token) {
    throw new Error(data.error || "Unable to obtain LiveKit token.");
  }

  return data;
}

async function startLiveClass() {
  if (busy || !currentSessionId || !currentUser) return;

  busy = true;
  startBtn.disabled = true;
  showMessage(connectionMessage, "Connecting to LiveKit...");
  setStatus("Connecting", "#d97706");

    const previousStatus = currentSession?.status || "scheduled";

  try {
    await updateDoc(doc(db, "liveSessions", currentSessionId), {
      status: "live",
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentSession = {
      ...currentSession,
      status: "live"
    };

    const access = await requestLiveKitToken(currentSessionId);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    currentRoom = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachTrack(track, participant);
      updateParticipantList();
    });

    room.on(RoomEvent.TrackUnsubscribed, track => {
      detachTrack(track);
    });

    room.on(RoomEvent.ParticipantConnected, () => updateParticipantList());
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      participantGrid?.querySelector(
        `[data-identity="${CSS.escape(participant.identity)}"]`
      )?.remove();
      updateParticipantList();
    });

    room.on(RoomEvent.LocalTrackPublished, publication => {
      if (publication.track) {
        attachTrack(publication.track, room.localParticipant, true);
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, publication => {
      if (publication.track) detachTrack(publication.track);
    });

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === "chat") {
          addChatMessage(
  data.sender || participant?.name || participant?.identity || "Participant",
  data.message
);
        }
      } catch (error) {
        console.warn("Unable to parse meeting message.", error);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      showMessage(connectionMessage, "Disconnected from LiveKit.", true);
      setStatus("Disconnected", "#dc2626");
    });

    await room.connect(access.serverUrl, access.token);

    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);

    micEnabled = true;
    cameraEnabled = true;

    participantGrid?.replaceChildren();
    showMeeting();
    meetingTitle.textContent =
      `${currentSession.title} · ${currentSession.sectionName}`;

    renderExistingTracks();

    meetingMicBtn.textContent = "Mute mic";
    meetingCameraBtn.textContent = "Turn camera off";
    meetingEndBtn.disabled = false;

    if (currentSession.meetingType === "livestream") {
      meetingNotice.textContent = "Livestream is active.";
    } else {
      meetingNotice.textContent = "Meeting is active. Participants may join.";
    }

    if (sessionState) sessionState.textContent = "LIVE";
    setStatus("LIVE", "#dc2626");
    showMessage(connectionMessage, "You are connected. Your session is live.");

    micBtn.disabled = false;
    cameraBtn.disabled = false;
    endBtn.disabled = false;

  } catch (error) {
    console.error("START LIVE ERROR:", error);

    if (currentRoom) {
      try { await currentRoom.disconnect(); } catch {}
      currentRoom = null;
    }

    try {
      await updateDoc(doc(db, "liveSessions", currentSessionId), {
        status: "scheduled",
        updatedAt: serverTimestamp()
      });
    } catch (updateError) {
      console.error("Unable to restore scheduled state:", updateError);
    }

    showMessage(connectionMessage, error.message || "Unable to start session.", true);
    setStatus("Connection failed", "#dc2626");
    if (sessionState) sessionState.textContent = "Scheduled";
    startBtn.disabled = false;

  } finally {
    busy = false;
  }
}

async function toggleMicrophone() {
  if (!currentRoom) return;

  try {
    micEnabled = !micEnabled;
    await currentRoom.localParticipant.setMicrophoneEnabled(micEnabled);

    meetingMicBtn.textContent = micEnabled ? "Mute mic" : "Unmute mic";
    if (micBtn) micBtn.textContent = micEnabled ? "Mute Microphone" : "Unmute Microphone";
  } catch (error) {
    micEnabled = !micEnabled;
    showMessage(connectionMessage, error.message, true);
  }
}

async function toggleCamera() {
  if (!currentRoom) return;

  try {
    cameraEnabled = !cameraEnabled;
    await currentRoom.localParticipant.setCameraEnabled(cameraEnabled);

    meetingCameraBtn.textContent = cameraEnabled
      ? "Turn camera off"
      : "Turn camera on";

    if (cameraBtn) cameraBtn.textContent = cameraEnabled
      ? "Turn Camera Off"
      : "Turn Camera On";

    if (!cameraEnabled) {
      const localTile = participantGrid?.querySelector(
        `[data-identity="${CSS.escape(currentRoom.localParticipant.identity)}"]`
      );
      localTile?.querySelectorAll("video").forEach(video => video.remove());
      if (localTile && !localTile.querySelector(".participant-placeholder")) {
        const placeholder = document.createElement("div");
        placeholder.className = "participant-placeholder";
        placeholder.textContent = "Your camera is off";
        localTile.prepend(placeholder);
      }
    }
  } catch (error) {
    cameraEnabled = !cameraEnabled;
    showMessage(connectionMessage, error.message, true);
  }
}

async function toggleScreenShare() {
  if (!currentRoom) return;

  try {
    screenShareEnabled = !screenShareEnabled;
    await currentRoom.localParticipant.setScreenShareEnabled(screenShareEnabled);
    screenShareBtn.textContent = screenShareEnabled
      ? "Stop sharing"
      : "Share screen";
  } catch (error) {
    screenShareEnabled = false;
    screenShareBtn.textContent = "Share screen";
    meetingNotice.textContent =
      error.message || "Screen sharing is not available in this browser.";
  }
}

function addChatMessage(sender, message) {
  if (!meetingChatMessages) return;

  const item = document.createElement("div");
  item.className = "chat-message";

  const name = document.createElement("strong");
  name.textContent = sender;

  const content = document.createElement("span");
  content.textContent = String(message).slice(0, 1000);

  item.append(name, content);
  meetingChatMessages.appendChild(item);
  meetingChatMessages.scrollTop = meetingChatMessages.scrollHeight;
}

async function sendChatMessage(event) {
  event.preventDefault();

  if (!currentRoom || !meetingChatInput) return;

  const message = meetingChatInput.value.trim();
  if (!message) return;

  const payload = encoder.encode(JSON.stringify({
  type: "chat",
  sender: safeName(currentUser, "Teacher"),
  message: message.slice(0, 1000),
  sentAt: new Date().toISOString()
}));

  try {
    await currentRoom.localParticipant.publishData(payload, {
      reliable: true
    });

    addChatMessage("You", message);
    meetingChatInput.value = "";
  } catch (error) {
    meetingNotice.textContent = "Unable to send message: " + error.message;
  }
}

function openSidebar(mode) {
  sidebarMode = mode;
  meetingSidebar?.classList.add("open");

  if (mode === "chat") {
    sidebarTitle.textContent = "Meeting Chat";
    meetingParticipants?.classList.add("live-hidden");
    meetingChatMessages?.classList.remove("live-hidden");
    meetingChatForm?.classList.remove("live-hidden");
  } else {
    sidebarTitle.textContent = "Participants";
    meetingParticipants?.classList.remove("live-hidden");
    meetingChatMessages?.classList.add("live-hidden");
    meetingChatForm?.classList.add("live-hidden");
    updateParticipantList();
  }
}

function closeSidebar() {
  meetingSidebar?.classList.remove("open");
}

async function leaveMeeting() {
  if (!currentRoom) {
    hideMeeting();
    return;
  }

  try {
    await currentRoom.disconnect();
  } catch (error) {
    console.warn("Disconnect error:", error);
  }

  currentRoom = null;
  micEnabled = false;
  cameraEnabled = false;
  screenShareEnabled = false;

  hideMeeting();
  setStatus("Disconnected");
  showMessage(connectionMessage, "You left the meeting. The session remains live.");
}

async function endLiveClass() {
  if (!currentSessionId || !currentRoom || busy) return;

  const isOneOnOne =
    currentSession?.meetingType === "one_on_one";

  const confirmMessage = isOneOnOne
    ? "End this private meeting? The session record will be deleted."
    : "End this meeting for everyone? The session will remain available so you can restart it.";

  if (!confirm(confirmMessage)) return;

  busy = true;
  meetingEndBtn.disabled = true;

  const endingSessionId = currentSessionId;
  const endingSession = currentSession;

  try {
    // First, ask the authenticated Worker to terminate the LiveKit room.
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in again.");

    const idToken = await user.getIdToken();

    const response = await fetch(
      "https://equallearn-live-token.jommelhallig655.workers.dev/end",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ roomId: endingSessionId })
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to end the LiveKit room.");
    }

    // Disconnect the teacher's local LiveKit connection.
    await currentRoom.disconnect();
    currentRoom = null;

   if (isOneOnOne) {
  const sessionRef = doc(db, "liveSessions", endingSessionId);

  await updateDoc(sessionRef, {
    status: "ended",
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await deleteDoc(sessionRef);

      currentSessionId = null;
      currentSession = null;

      if (sessionState) sessionState.textContent = "Deleted";
      setStatus("Private session deleted");
      showMessage(
        connectionMessage,
        "The one-on-one meeting has ended and its session record was deleted."
      );

      startBtn.disabled = true;
      createBtn.disabled = false;
    } else {
      // Batch and livestream sessions remain available for restart.
      await updateDoc(doc(db, "liveSessions", endingSessionId), {
        status: "ended",
        endedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      currentSession = {
        ...endingSession,
        status: "ended"
      };

      if (sessionState) sessionState.textContent = "Ended — Ready to restart";
      setStatus("Ended — Ready to restart");
      showMessage(
        connectionMessage,
        "The meeting ended for everyone. You can restart this same session."
      );

      // Keep currentSessionId and currentSession.
      // Do not create another liveSessions document.
      startBtn.disabled = false;
      createBtn.disabled = true;
    }

    hideMeeting();
    clearPreview(
      isOneOnOne
        ? "The private classroom has ended."
        : "The classroom has ended. You can restart this session."
    );

    endBtn.disabled = true;
    micBtn.disabled = true;
    cameraBtn.disabled = true;

  } catch (error) {
    console.error("END SESSION ERROR:", error);
    showMessage(
      connectionMessage,
      error.message || "Unable to end the session.",
      true
    );
    meetingEndBtn.disabled = false;
  } finally {
    busy = false;
  }
}

function updateMeetingControls() {
  meetingMicBtn.disabled = !currentRoom;
  meetingCameraBtn.disabled = !currentRoom;
  screenShareBtn.disabled = !currentRoom;
  meetingLeaveBtn.disabled = !currentRoom;
}

meetingTypeInput?.addEventListener("change", async () => {
  const type = meetingTypeInput.value;
  studentSelectWrap?.classList.toggle("live-hidden", type !== "one_on_one");

  if (sectionSelect?.value) {
    await loadStudentsForSection(sectionSelect.value);
  }
});

sectionSelect?.addEventListener("change", async () => {
  try {
    await loadStudentsForSection(sectionSelect.value);
  } catch (error) {
    showMessage(createMessage, error.message, true);
  }
});

createBtn?.addEventListener("click", createLiveClass);
startBtn?.addEventListener("click", startLiveClass);
micBtn?.addEventListener("click", toggleMicrophone);
cameraBtn?.addEventListener("click", toggleCamera);
endBtn?.addEventListener("click", endLiveClass);

meetingMicBtn?.addEventListener("click", toggleMicrophone);
meetingCameraBtn?.addEventListener("click", toggleCamera);
screenShareBtn?.addEventListener("click", toggleScreenShare);
meetingLeaveBtn?.addEventListener("click", leaveMeeting);
meetingEndBtn?.addEventListener("click", endLiveClass);

document.getElementById("participantsToggle")
  ?.addEventListener("click", () => openSidebar("participants"));
document.getElementById("meetingPeopleBtn")
  ?.addEventListener("click", () => openSidebar("participants"));
document.getElementById("chatToggle")
  ?.addEventListener("click", () => openSidebar("chat"));
document.getElementById("meetingChatBtn")
  ?.addEventListener("click", () => openSidebar("chat"));
document.getElementById("closeSidebar")
  ?.addEventListener("click", closeSidebar);

meetingChatForm?.addEventListener("submit", sendChatMessage);

setFormEnabled(false);

requireRole("teacher", async user => {
  currentUser = user;

  if (sessionTeacher) {
    sessionTeacher.textContent = safeName(user, "Teacher");
  }

  try {
    await loadAssignedSections(user);
    createBtn.disabled = false;
    showMessage(createMessage, "Your assigned sections are ready.");
  } catch (error) {
    console.error("TEACHER SECTION LOAD ERROR:", error);
    showMessage(createMessage, error.message, true);
    createBtn.disabled = true;
  }
});

window.addEventListener("beforeunload", () => {
  if (currentRoom) currentRoom.disconnect();
});
