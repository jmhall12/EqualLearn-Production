
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

// Explicit meeting DOM references
const meetingScreen = document.getElementById("meetingScreen");
const meetingTitle = document.getElementById("meetingTitle");
const participantGrid = document.getElementById("participantGrid");
const meetingNotice = document.getElementById("meetingNotice");
const meetingSidebar = document.getElementById("meetingSidebar");
const sidebarTitle = document.getElementById("sidebarTitle");
const meetingParticipants = document.getElementById("meetingParticipants");
const meetingChatMessages = document.getElementById("meetingChatMessages");
const meetingChatForm = document.getElementById("meetingChatForm");
const meetingChatInput = document.getElementById("meetingChatInput");
const meetingMicBtn = document.getElementById("meetingMicBtn");
const meetingCameraBtn = document.getElementById("meetingCameraBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const meetingLeaveBtn = document.getElementById("meetingLeaveBtn");
const meetingEndBtn = document.getElementById("meetingEndBtn");

// Meeting elements
// ========================================
// LEAVE MEETING CHOICES
// ========================================

const leaveChoiceModal = document.getElementById("leaveChoiceModal");
const leaveOnlyChoice = document.getElementById("leaveOnlyChoice");
const endEveryoneChoice = document.getElementById("endEveryoneChoice");
const cancelLeaveChoice = document.getElementById("cancelLeaveChoice");

function openLeaveChoices() {
  if (!currentRoom || busy) return;

  leaveChoiceModal?.classList.add("open");
}

function closeLeaveChoices() {
  leaveChoiceModal?.classList.remove("open");
}

// Open the choices when teacher clicks Leave
meetingLeaveBtn?.addEventListener("click", openLeaveChoices);

// Teacher leaves without ending the session
leaveOnlyChoice?.addEventListener("click", async () => {
  closeLeaveChoices();

  if (busy) return;

  await leaveMeeting();
});

// Teacher ends the meeting for everyone
endEveryoneChoice?.addEventListener("click", async () => {
  closeLeaveChoices();

  if (busy) return;

  await endLiveClass(true);
});

// Cancel popup
cancelLeaveChoice?.addEventListener("click", closeLeaveChoices);

// Close when clicking outside the dialog
leaveChoiceModal?.addEventListener("click", event => {
  if (event.target === leaveChoiceModal) {
    closeLeaveChoices();
  }
});

// Close popup using Escape
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeLeaveChoices();
  }
});



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

let cameraFacingMode = "user";
let currentBackgroundProcessor = null;
let backgroundModulePromise = null;
let currentBackgroundMode = "disabled";
let backgroundImageUrl = null;
let floatingCallCard = null;
let floatingVideoTrack = null;
let floatingVideoElement = null;
let raisedHands = new Set();
let handRaised = false;



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
    profile?.fullname || profile?.fullName || profile?.displayName || profile?.name || profile?.email || fallback
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
  meetingScreen?.classList.remove("is-minimized");
  meetingScreen?.classList.add("active");
  document.body.style.overflow = "hidden";
  ensureReactionControls();
  restoreLiveCall();
  void enterMeetingFullscreenAndLandscape();
}

function hideMeeting() {
  disposeFloatingCall();
  meetingScreen?.classList.remove("active", "has-screen-share", "is-minimized");
  participantGrid?.classList.remove("has-screen-share");
  try { screen.orientation?.unlock?.(); } catch (_) {}
  if (document.fullscreenElement === meetingScreen) {
    document.exitFullscreen?.().catch(() => {});
  }
  document.body.style.overflow = "";
}

const LIVE_REACTIONS = ["👍", "❤️", "😂", "👏", "😮", "🎉"];

function currentTeacherDisplayName() {
  return safeName(currentUser, "Teacher");
}

function ensureFloatingCallCard() {
  if (floatingCallCard?.isConnected) return floatingCallCard;

  floatingCallCard = document.createElement("section");
  floatingCallCard.id = "equallearnFloatingCall";
  floatingCallCard.className = "equallearn-floating-call";
  floatingCallCard.hidden = true;
  floatingCallCard.setAttribute("aria-label", "Minimized EqualLearn call");

  const preview = document.createElement("div");
  preview.className = "equallearn-floating-preview";
  preview.id = "equallearnFloatingPreview";
  const fallback = document.createElement("div");
  fallback.className = "equallearn-floating-fallback";
  fallback.textContent = "EL";
  preview.appendChild(fallback);

  const details = document.createElement("div");
  details.className = "equallearn-floating-details";
  const title = document.createElement("strong");
  title.id = "equallearnFloatingTitle";
  title.textContent = "EqualLearn Live";
  const status = document.createElement("span");
  status.id = "equallearnFloatingStatus";
  status.textContent = "Connected · Minimized";
  details.append(title, status);

  const actions = document.createElement("div");
  actions.className = "equallearn-floating-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.textContent = "Return to call";
  restore.addEventListener("click", restoreLiveCall);
  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "is-danger";
  leave.textContent = "Leave";
  leave.addEventListener("click", () => leaveMeeting());
  actions.append(restore, leave);

  floatingCallCard.append(preview, details, actions);
  document.body.appendChild(floatingCallCard);
  return floatingCallCard;
}

function refreshFloatingCallVideo() {
  if (!floatingCallCard || floatingCallCard.hidden || !currentRoom) return;
  const preview = floatingCallCard.querySelector("#equallearnFloatingPreview");
  if (!preview) return;

  const participants = [
    currentRoom.localParticipant,
    ...Array.from(currentRoom.remoteParticipants.values())
  ];
  const tracks = [];
  for (const participant of participants) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track?.kind === Track.Kind.Video) {
        tracks.push({ track: publication.track, source: publication.source, local: participant === currentRoom.localParticipant });
      }
    }
  }
  tracks.sort((a, b) => {
    const rank = item => item.source === Track.Source.ScreenShare ? 0 : (item.local ? 1 : 2);
    return rank(a) - rank(b);
  });
  const chosen = tracks[0]?.track || null;
  if (chosen === floatingVideoTrack && floatingVideoElement?.isConnected) return;

  if (floatingVideoTrack && floatingVideoElement) {
    try { floatingVideoTrack.detach(floatingVideoElement); } catch (_) { floatingVideoElement.remove(); }
  }
  floatingVideoTrack = chosen;
  floatingVideoElement = null;
  preview.replaceChildren();

  if (chosen) {
    const video = chosen.attach();
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = "equallearn-floating-video";
    preview.appendChild(video);
    floatingVideoElement = video;
  } else {
    const fallback = document.createElement("div");
    fallback.className = "equallearn-floating-fallback";
    fallback.textContent = "EL";
    preview.appendChild(fallback);
  }
}

function minimizeLiveCall() {
  if (!currentRoom) return;
  ensureFloatingCallCard();
  const title = floatingCallCard.querySelector("#equallearnFloatingTitle");
  const status = floatingCallCard.querySelector("#equallearnFloatingStatus");
  if (title) title.textContent = currentSession?.title || "EqualLearn Live";
  if (status) status.textContent = "Connected · Minimized";
  floatingCallCard.hidden = false;
  meetingScreen?.classList.add("is-minimized");
  document.body.style.overflow = "";
  try { screen.orientation?.unlock?.(); } catch (_) {}
  if (document.fullscreenElement === meetingScreen) {
    document.exitFullscreen?.().catch(() => {});
  }
  refreshFloatingCallVideo();
}

function restoreLiveCall() {
  meetingScreen?.classList.remove("is-minimized");
  if (currentRoom) document.body.style.overflow = "hidden";
  if (floatingVideoTrack && floatingVideoElement) {
    try { floatingVideoTrack.detach(floatingVideoElement); } catch (_) { floatingVideoElement.remove(); }
  }
  floatingVideoTrack = null;
  floatingVideoElement = null;
  if (floatingCallCard) floatingCallCard.hidden = true;
}

function disposeFloatingCall() {
  if (floatingVideoTrack && floatingVideoElement) {
    try { floatingVideoTrack.detach(floatingVideoElement); } catch (_) { floatingVideoElement.remove(); }
  }
  floatingVideoTrack = null;
  floatingVideoElement = null;
  if (floatingCallCard) floatingCallCard.hidden = true;
  meetingScreen?.classList.remove("is-minimized");
  currentBackgroundProcessor = null;
  currentBackgroundMode = "disabled";
  if (backgroundImageUrl) {
    try { URL.revokeObjectURL(backgroundImageUrl); } catch (_) {}
    backgroundImageUrl = null;
  }
}

function getLocalCameraTrack() {
  if (!currentRoom) return null;
  for (const publication of currentRoom.localParticipant.trackPublications.values()) {
    if (publication.source === Track.Source.Camera && publication.track) return publication.track;
  }
  return null;
}

async function flipCameraFacing() {
  if (!currentRoom || !cameraEnabled) throw new Error("Turn on your camera first.");
  const track = getLocalCameraTrack();
  if (!track || typeof track.restartTrack !== "function") {
    throw new Error("Camera switching is not supported by this device/browser.");
  }
  const nextFacing = cameraFacingMode === "user" ? "environment" : "user";
  await track.restartTrack({ facingMode: nextFacing });
  cameraFacingMode = nextFacing;
  participantGrid?.querySelectorAll("video.is-local-camera").forEach(video => {
    video.classList.toggle("is-selfie", cameraFacingMode === "user");
  });
}

async function loadBackgroundProcessorModule() {
  if (!backgroundModulePromise) {
    backgroundModulePromise = import("https://cdn.jsdelivr.net/npm/@livekit/track-processors@0.8.3/+esm");
  }
  return backgroundModulePromise;
}

async function applyCameraBackground(mode, imagePath = null) {
  if (!currentRoom || !cameraEnabled) throw new Error("Turn on your camera before changing the background.");
  const track = getLocalCameraTrack();
  if (!track || typeof track.setProcessor !== "function") {
    throw new Error("Background effects are not supported by this browser/device.");
  }
  const toolkit = await loadBackgroundProcessorModule();
  if (toolkit.supportsBackgroundProcessors && !toolkit.supportsBackgroundProcessors()) {
    throw new Error("This browser does not support background effects. Try an updated Chrome browser.");
  }
  if (!currentBackgroundProcessor) {
    currentBackgroundProcessor = toolkit.BackgroundProcessor({ mode: "disabled" });
    await track.setProcessor(currentBackgroundProcessor);
  }
  if (mode === "virtual-background") {
    await currentBackgroundProcessor.switchTo({ mode, imagePath });
  } else if (mode === "background-blur") {
    await currentBackgroundProcessor.switchTo({ mode, blurRadius: 12 });
  } else {
    await currentBackgroundProcessor.switchTo({ mode: "disabled" });
  }
  currentBackgroundMode = mode;
}

async function toggleBackgroundBlur() {
  try {
    const next = currentBackgroundMode === "background-blur" ? "disabled" : "background-blur";
    await applyCameraBackground(next);
    const button = meetingScreen?.querySelector("[data-live-action='blur']");
    if (button) button.textContent = next === "background-blur" ? "Blur: On" : "Blur: Off";
  } catch (error) {
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = error.message || "Unable to apply background effect.";
  }
}

async function chooseVirtualBackground(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const nextUrl = URL.createObjectURL(file);
  try {
    await applyCameraBackground("virtual-background", nextUrl);
    if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
    backgroundImageUrl = nextUrl;
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = "Your custom background is active for other participants.";
  } catch (error) {
    URL.revokeObjectURL(nextUrl);
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = error.message || "Unable to apply this background.";
  }
}

async function toggleRaiseHand() {
  if (!currentRoom) return;
  handRaised = !handRaised;
  const payload = encoder.encode(JSON.stringify({
    type: "hand",
    raised: handRaised,
    senderName: currentRoom.localParticipant.name || "Participant",
    sentAt: new Date().toISOString()
  }));
  try {
    await currentRoom.localParticipant.publishData(payload, { reliable: true });
    const button = meetingScreen?.querySelector("[data-live-action='hand']");
    if (button) button.textContent = handRaised ? "✋ Lower hand" : "✋ Raise hand";
    const identity = currentRoom.localParticipant.identity;
    if (handRaised) raisedHands.add(identity); else raisedHands.delete(identity);
    if (typeof updateParticipantList === "function") updateParticipantList();
    if (typeof renderParticipants === "function") renderParticipants();
  } catch (error) {
    handRaised = !handRaised;
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = error.message || "Unable to update raised hand.";
  }
}

function ensureExtraMeetingControls() {
  const controls = meetingScreen?.querySelector(".meeting-controls");
  if (!controls) return;
  const add = (key, label, handler, title = label) => {
    if (controls.querySelector(`[data-live-action='${key}']`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "equallearn-extra-control";
    button.dataset.liveAction = key;
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", handler);
    controls.appendChild(button);
  };
  add("minimize", "▁ Minimize", minimizeLiveCall, "Minimize the call without disconnecting");
  add("flip", "↻ Flip camera", () => flipCameraFacing().catch(error => {
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = error.message;
  }));
  add("blur", "Blur: Off", toggleBackgroundBlur);
  add("background", "▧ Background", () => controls.querySelector("input[data-live-background-file]")?.click());
  add("hand", "✋ Raise hand", toggleRaiseHand);

  if (!controls.querySelector("input[data-live-background-file]")) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.dataset.liveBackgroundFile = "true";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) chooseVirtualBackground(file);
      input.value = "";
    });
    controls.appendChild(input);
  }
}

function ensureReactionControls() {
  const controls = meetingScreen?.querySelector(".meeting-controls");
  if (!controls) return;
  if (!controls.querySelector(".live-reaction-bar")) {
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
  }
  if (!controls.querySelector(".live-fullscreen-button")) {
    const fullscreenButton = document.createElement("button");
    fullscreenButton.type = "button";
    fullscreenButton.className = "live-fullscreen-button";
    fullscreenButton.textContent = "⛶ Fullscreen";
    fullscreenButton.addEventListener("click", () =>
      enterMeetingFullscreenAndLandscape(Boolean(meetingScreen?.classList.contains("has-screen-share")))
    );
    controls.appendChild(fullscreenButton);
  }
  ensureExtraMeetingControls();
  ensureFloatingCallCard();
}
function showLiveReaction(reaction, participant, fallbackName = "Participant") {
  if (!participantGrid || !LIVE_REACTIONS.includes(reaction)) return;
  const identity = participant?.identity || currentRoom?.localParticipant?.identity;
  const name = participant?.name || fallbackName;
  let tile = identity
    ? participantGrid.querySelector(`[data-identity="${CSS.escape(identity)}"]`)
    : null;

  if (!tile && identity) tile = getTile(identity, name, participant === currentRoom?.localParticipant);
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
      senderName: currentTeacherDisplayName(),
      sentAt: new Date().toISOString()
    }));
    await currentRoom.localParticipant.publishData(payload, { reliable: true });
    showLiveReaction(reaction, currentRoom.localParticipant, currentTeacherDisplayName());
  } catch (error) {
    if (meetingNotice) meetingNotice.textContent = `Unable to send reaction: ${error.message}`;
  }
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
  if (meetingNotice) meetingNotice.textContent = messageText;
  return false;
}

async function updateScreenShareLayout() {
  const active = Boolean(participantGrid?.querySelector(".screen-share-tile video"));
  meetingScreen?.classList.toggle("has-screen-share", active);
  participantGrid?.classList.toggle("has-screen-share", active);

  if (active) {
    try {
      if (document.fullscreenElement === meetingScreen && screen.orientation?.lock) {
        await screen.orientation.lock("landscape");
      } else {
        throw new Error("Fullscreen orientation lock is unavailable.");
      }
    } catch (_) {
      if (meetingNotice) meetingNotice.textContent = "Screen sharing is active. Tap Fullscreen or rotate your phone to landscape for a wider view.";
    }
  } else {
    try { screen.orientation?.unlock?.(); } catch (_) {}
  }
}

function isScreenShareSource(source) {
  return source === Track.Source.ScreenShare || source === "screen_share";
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

function attachTrack(track, participant, isLocal = false, source = null) {
  if (!track || !participant || !participantGrid) return;

  const identity = participant.identity;
  const name = participant.name || identity;
  const tile = getTile(identity, name, isLocal);

  if (track.kind === Track.Kind.Video) {
    if (isScreenShareSource(source)) tile.classList.add("screen-share-tile");
    tile.querySelector(".participant-placeholder")?.remove();
    const video = track.attach();
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = isScreenShareSource(source) ? "contain" : "cover";
    if (!isScreenShareSource(source) && isLocal) {
      video.classList.add("is-local-camera");
      video.classList.toggle("is-selfie", cameraFacingMode === "user");
    }
    tile.classList.toggle("is-local", isLocal);
    tile.insertBefore(video, tile.querySelector(".participant-name"));
    if (isScreenShareSource(source)) updateScreenShareLayout();
    refreshFloatingCallVideo();
  } else if (track.kind === Track.Kind.Audio) {
    const audio = track.attach();
    audio.autoplay = true;
    audio.style.display = "none";
    tile.appendChild(audio);
  }
}

function detachTrack(track, source = null) {
  if (!track) return;
  const isShare = isScreenShareSource(source || track.source);
  track.detach().forEach(element => {
    const tile = element.closest(".participant-tile");
    element.remove();
    if (isShare) tile?.classList.remove("screen-share-tile");
  });
  if (isShare) updateScreenShareLayout();
  refreshFloatingCallVideo();
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

    if (raisedHands.has(participant.identity)) role.textContent += " · ✋ Raised hand";
    row.append(name, role);
    meetingParticipants.appendChild(row);
  });
}

function renderExistingTracks() {
  if (!currentRoom) return;

  const local = currentRoom.localParticipant;
  createTile(local.identity, local.name || "Teacher", true);

  for (const publication of local.trackPublications.values()) {
    if (publication.track) attachTrack(publication.track, local, true, publication.source);
  }

  for (const participant of currentRoom.remoteParticipants.values()) {
    createTile(
      participant.identity,
      participant.name || participant.identity
    );

    for (const publication of participant.trackPublications.values()) {
      if (publication.track) attachTrack(publication.track, participant, false, publication.source);
    }
  }

  updateParticipantList();
  refreshFloatingCallVideo();
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

    try {
      const targetSectionIds = [section.id];
      const notificationResult = await notifySectionStudents({
        db,
        auth,
        sectionIds: targetSectionIds,
        contentType: "live",
        contentId: roomId,
        contentTitle: title,
        teacherName: teacherName
      });

      console.info("LIVE SESSION NOTIFICATIONS:", notificationResult);
    } catch (notificationError) {
      console.warn("Live session notification failed:", notificationError);
    }

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
    startBtn.textContent = "Start Meeting";
    createBtn.disabled = true;
    refreshDeleteSessionButton();

  } catch (error) {
    console.error("CREATE SESSION ERROR:", error);
    showMessage(createMessage, error.message || "Unable to create session.", true);
    createBtn.disabled = false;
  } finally {
    busy = false;
    refreshDeleteSessionButton();
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
  showMeeting();
  if (meetingTitle) meetingTitle.textContent = `${currentSession?.title || "EqualLearn Live"} · Connecting...`;
  if (meetingNotice) meetingNotice.textContent = "Connecting to LiveKit...";

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
      attachTrack(track, participant, false, publication?.source);
      updateParticipantList();
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      detachTrack(track, publication?.source);
    });

    room.on(RoomEvent.ParticipantConnected, participant => {
      if (participant) getTile(participant.identity, participant.name || participant.identity);
      updateParticipantList();
    });
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      participantGrid?.querySelector(
        `[data-identity="${CSS.escape(participant.identity)}"]`
      )?.remove();
      updateParticipantList();
    });

    room.on(RoomEvent.LocalTrackPublished, publication => {
      if (publication.track) {
        attachTrack(publication.track, room.localParticipant, true, publication.source);
      }
    });

    room.on(RoomEvent.LocalTrackUnpublished, publication => {
      if (publication.track) detachTrack(publication.track, publication.source);
    });

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === "chat" && typeof data.message === "string") {
          addChatMessage(
            participant?.name || data.senderName || data.sender || participant?.identity || "Participant",
            data.message
          );
        } else if (data.type === "reaction") {
          showLiveReaction(data.reaction, participant, data.senderName || "Participant");
        } else if (data.type === "hand") {
          const identity = participant?.identity;
          if (identity) {
            if (data.raised) raisedHands.add(identity);
            else raisedHands.delete(identity);
            updateParticipantList();
          }
        }
      } catch (error) {
        console.warn("Unable to parse meeting message.", error);
      }
    });

    room.on(RoomEvent.Disconnected, reason => {
      if (currentRoom !== room) return;
      currentRoom = null;
      micEnabled = false;
      cameraEnabled = false;
      screenShareEnabled = false;
      hideMeeting();
      updateMeetingControls();
      if (String(reason) === "ROOM_DELETED" || String(reason?.toString?.()) === "ROOM_DELETED") {
        showMessage(connectionMessage, "The teacher ended this meeting for everyone. The session is still saved and reusable.");
        setStatus("Ended — Ready to restart");
      } else {
        showMessage(connectionMessage, "You were disconnected from the meeting. The session record is still available.", true);
        setStatus("Disconnected", "#dc2626");
      }
      if (sessionState) sessionState.textContent = "Ended · Reusable";
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Restart Meeting";
      }
      if (endBtn) endBtn.disabled = true;
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
      try {
        await currentRoom.disconnect();
      } catch (disconnectError) {
        console.warn("LiveKit disconnect error:", disconnectError);
      }

      currentRoom = null;
    }

    try {
      await updateDoc(doc(db, "liveSessions", currentSessionId), {
        status: previousStatus,
        updatedAt: serverTimestamp()
      });

      currentSession = {
        ...currentSession,
        status: previousStatus
      };
    } catch (updateError) {
      console.error("Unable to restore previous session state:", updateError);
    }

    hideMeeting();
    showMessage(
      connectionMessage,
      error.message || "Unable to start session.",
      true
    );

    setStatus(
      previousStatus === "ended" ? "Ended — Ready to restart" : "Connection failed",
      "#dc2626"
    );

    if (sessionState) {
      sessionState.textContent =
        previousStatus === "ended" ? "Ended — Ready to restart" : "Scheduled";
    }

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


async function flipCamera() {
  try {
    await flipCameraFacing();
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = cameraFacingMode === "environment" ? "Back camera is active." : "Front camera is active.";
  } catch (error) {
    const notice = document.getElementById("meetingNotice") || document.getElementById("studentMeetingNotice");
    if (notice) notice.textContent = error.message || "Unable to switch camera.";
  }
}

async function toggleScreenShare() {
  if (!currentRoom) return;

  try {
    if (!screenShareEnabled) void enterMeetingFullscreenAndLandscape(true);
    screenShareEnabled = !screenShareEnabled;
    await currentRoom.localParticipant.setScreenShareEnabled(screenShareEnabled);
    if (screenShareEnabled) {
      try { if (screen.orientation?.lock) await screen.orientation.lock("landscape"); } catch (_) {}
    }
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

    addChatMessage(`${currentTeacherDisplayName()} (You)`, message);
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

  const roomToLeave = currentRoom;
  currentRoom = null;
  try {
    await roomToLeave.disconnect();
  } catch (error) {
    console.warn("Disconnect error:", error);
  }

  currentRoom = null;
  micEnabled = false;
  cameraEnabled = false;
  screenShareEnabled = false;

  hideMeeting();
  setStatus("Disconnected");
  showMessage(connectionMessage, "You left the meeting. Other participants remain connected; use Rejoin Meeting to return.");
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = "Rejoin Meeting";
  }
  if (endBtn) endBtn.disabled = true;
}

async function endLiveClass(skipConfirmation = false) {
  if (!currentSessionId || !currentSession || busy) return;

  const confirmMessage = "End this meeting for everyone? All participants will be disconnected, but this session will remain reusable until you delete it.";
  if (!skipConfirmation && !confirm(confirmMessage)) return;

  busy = true;
  if (meetingEndBtn) meetingEndBtn.disabled = true;
  if (endBtn) endBtn.disabled = true;

  const endingSessionId = currentSessionId;
  const endingSession = currentSession;
  const roomToClose = currentRoom;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in again.");
    const idToken = await user.getIdToken();
    const response = await fetch("https://equallearn-live-token.jommelhallig655.workers.dev/end", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ roomId: endingSessionId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to end the LiveKit room.");
    }

    // DeleteRoom on the Worker forcibly disconnects all remote participants.
    // Clear our reference before disconnecting locally so the Disconnected handler does not double-clean.
    currentRoom = null;
    if (roomToClose) {
      try { await roomToClose.disconnect(); } catch (disconnectError) {
        console.warn("Local LiveKit disconnect after End for Everyone:", disconnectError);
      }
    }

    await updateDoc(doc(db, "liveSessions", endingSessionId), {
      status: "ended",
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentSession = { ...endingSession, status: "ended" };
    if (sessionState) sessionState.textContent = "Ended · Reusable";
    setStatus("Ended — Ready to restart");
    showMessage(connectionMessage, "Everyone has been disconnected. This session is saved and can be restarted whenever you are ready.");
    clearPreview("This session is saved. Start it again or delete it when you no longer need it.");
    hideMeeting();
    micEnabled = false;
    cameraEnabled = false;
    screenShareEnabled = false;
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = "Restart Meeting";
    }
    if (createBtn) createBtn.disabled = true;
    refreshDeleteSessionButton();
    if (micBtn) micBtn.disabled = true;
    if (cameraBtn) cameraBtn.disabled = true;
    if (meetingEndBtn) meetingEndBtn.disabled = true;
    updateMeetingControls();
  } catch (error) {
    console.error("END SESSION ERROR:", error);
    showMessage(connectionMessage, error.message || "Unable to end the session.", true);
    if (meetingEndBtn) meetingEndBtn.disabled = false;
    if (endBtn) endBtn.disabled = false;
  } finally {
    busy = false;
    refreshDeleteSessionButton();
  }
}

async function deleteCurrentSession() {
  if (!currentSessionId || !currentSession || busy) return;
  if (!confirm("Permanently delete this session? Students will no longer see it. If it is currently live, everyone will be disconnected first.")) return;

  busy = true;
  const sessionId = currentSessionId;
  const session = currentSession;
  const roomToClose = currentRoom;
  try {
    if (session.status === "live") {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again.");
      const idToken = await user.getIdToken();
      const response = await fetch("https://equallearn-live-token.jommelhallig655.workers.dev/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomId: sessionId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to disconnect the active room.");
    }

    currentRoom = null;
    if (roomToClose) {
      try { await roomToClose.disconnect(); } catch (_) {}
    }
    await deleteDoc(doc(db, "liveSessions", sessionId));

    currentSessionId = null;
    currentSession = null;
    micEnabled = false;
    cameraEnabled = false;
    screenShareEnabled = false;
    hideMeeting();
    if (sessionTitle) sessionTitle.textContent = "Not created";
    if (sessionIdDisplay) sessionIdDisplay.textContent = "—";
    if (sessionModeDisplay) sessionModeDisplay.textContent = "—";
    if (sessionSectionDisplay) sessionSectionDisplay.textContent = "—";
    if (sessionParticipantsDisplay) sessionParticipantsDisplay.textContent = "—";
    if (sessionState) sessionState.textContent = "Deleted";
    clearPreview("Create a new session whenever you need another class meeting.");
    setStatus("Session deleted");
    showMessage(connectionMessage, "The session was deleted. Any active participants have been disconnected.");
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = "Start Meeting";
    }
    if (createBtn) createBtn.disabled = false;
    if (endBtn) endBtn.disabled = true;
    refreshDeleteSessionButton();
  } catch (error) {
    console.error("DELETE SESSION ERROR:", error);
    showMessage(connectionMessage, error.message || "Unable to delete this session.", true);
  } finally {
    busy = false;
    refreshDeleteSessionButton();
  }
}

function ensureDeleteSessionButton() {
  if (document.getElementById("deleteLiveSessionBtn")) return;
  const info = document.querySelector(".live-info");
  if (!info) return;
  const button = document.createElement("button");
  button.id = "deleteLiveSessionBtn";
  button.type = "button";
  button.className = "el-btn equallearn-delete-session";
  button.textContent = "Delete Session Permanently";
  button.disabled = true;
  button.addEventListener("click", deleteCurrentSession);
  info.appendChild(button);
}

function refreshDeleteSessionButton() {
  const button = document.getElementById("deleteLiveSessionBtn");
  if (button) button.disabled = !currentSessionId || busy;
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

ensureDeleteSessionButton();
createBtn?.addEventListener("click", createLiveClass);
startBtn?.addEventListener("click", startLiveClass);
micBtn?.addEventListener("click", toggleMicrophone);
cameraBtn?.addEventListener("click", toggleCamera);
endBtn?.addEventListener("click", endLiveClass);

meetingMicBtn?.addEventListener("click", toggleMicrophone);
meetingCameraBtn?.addEventListener("click", toggleCamera);
screenShareBtn?.addEventListener("click", toggleScreenShare);

// Leave button is already connected to openLeaveChoices().
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
  ensureDeleteSessionButton();

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
