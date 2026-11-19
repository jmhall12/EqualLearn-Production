import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc, getDoc, collection, query, where, getDocs,
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
const refreshLiveBtn = document.getElementById("refreshLiveBtn");

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
  meetingScreen.classList.remove("is-minimized");
  meetingScreen.classList.add("active");
  ensureReactionControls();
  restoreLiveCall();

  document.body.style.overflow = "hidden";
  ensureReactionControls();
  void enterMeetingFullscreenAndLandscape();
}

function hideMeeting() {
  disposeFloatingCall();
  if (meetingScreen) {
    meetingScreen.classList.remove("active", "has-screen-share", "is-minimized");
    meetingScreen.hidden = true;
  }

  participantGrid?.classList.remove("has-screen-share");
  try { screen.orientation?.unlock?.(); } catch (_) {}
  if (document.fullscreenElement === meetingScreen) {
    document.exitFullscreen?.().catch(() => {});
  }
  document.body.style.overflow = "";
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
    try {
      if (document.fullscreenElement === meetingScreen && screen.orientation?.lock) {
        await screen.orientation.lock("landscape");
      } else {
        throw new Error("Fullscreen orientation lock is unavailable.");
      }
    } catch (_) {
      message(meetingNotice, "Screen sharing is active. Tap Fullscreen or rotate your phone to landscape for a wider view.");
    }
  } else {
    try { screen.orientation?.unlock?.(); } catch (_) {}
  }
}

function createTile(identity, name, isLocal = false) {
  const tile = document.createElement("div");

  tile.className = "sm-tile";
  if (isLocal) tile.classList.add("is-local");
  tile.dataset.identity = identity;

  const placeholder = document.createElement("div");

  placeholder.className = "sm-placeholder";
  placeholder.textContent = `${name} camera is off`;

  const label = document.createElement("div");

  label.className = "sm-name";
  label.textContent = name;

  tile.append(placeholder, label);

  participantGrid?.appendChild(tile);

  return tile;
}

function getTile(participant) {
  if (!participantGrid || !participant) return null;

  const identity = participant.identity;

  let tile = participantGrid.querySelector(
    `[data-identity="${CSS.escape(identity)}"]`
  );

  if (!tile) {
    tile = createTile(
      identity,
      participant.name || identity,
      participant === currentRoom?.localParticipant
    );
  }

  return tile;
}

function attachTrack(track, participant, source = null) {
  if (!track || !participant || !participantGrid) {
    return;
  }

  const tile = getTile(participant);

  if (!tile) return;

  if (track.kind === Track.Kind.Video) {
    if (isScreenShareSource(source)) tile.classList.add("screen-share-tile");
    tile.querySelector(".sm-placeholder")?.remove();

    // Prevent duplicate video elements.
    tile.querySelectorAll("video").forEach(video => {
      video.remove();
    });

    const video = track.attach();

    video.autoplay = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = isScreenShareSource(source) ? "contain" : "cover";
    if (!isScreenShareSource(source) && participant === currentRoom?.localParticipant) {
      video.classList.add("is-local-camera");
      video.classList.toggle("is-selfie", cameraFacingMode === "user");
      tile.classList.add("is-local");
    }

    tile.insertBefore(
      video,
      tile.querySelector(".sm-name")
    );
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
    const tile = element.closest(".sm-tile");
    element.remove();
    if (isShare) tile?.classList.remove("screen-share-tile");
  });
  if (isShare) updateScreenShareLayout();
  refreshFloatingCallVideo();
}

function renderExistingParticipants() {
  if (!currentRoom) return;

  const local = currentRoom.localParticipant;

  getTile(local);

  for (const publication of local.trackPublications.values()) {
    if (publication.track) {
      attachTrack(publication.track, local, publication.source);
    }
  }

  for (const participant of currentRoom.remoteParticipants.values()) {
    getTile(participant);

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

    status.textContent =
      participant === currentRoom.localParticipant
        ? "You"
        : "Connected";

    if (raisedHands.has(participant.identity)) status.textContent += " · ✋ Raised hand";
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

async function loadLiveSessions(uid) {
  if (!liveSessionList) return;

  liveSessionList.replaceChildren();

  const loading = document.createElement("p");

  loading.textContent = "Loading live classes...";

  liveSessionList.appendChild(loading);

  try {
    const q = query(
      collection(db, "liveSessions"),
      where("participantUids", "array-contains", uid)
    );

    const snapshot = await getDocs(q);

    const sessions = snapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .filter(session => ["scheduled", "live", "ended"].includes(session.status))
      .filter(session => {
        if (
          session.meetingType === "one_on_one" &&
          session.targetStudentUid !== uid
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (
          a.status === "live" &&
          b.status !== "live"
        ) {
          return -1;
        }

        if (
          a.status !== "live" &&
          b.status === "live"
        ) {
          return 1;
        }

        return (
          timestamp(b.createdAt) -
          timestamp(a.createdAt)
        );
      });

    liveSessionList.replaceChildren();

    if (liveSessionCount) {
      liveSessionCount.textContent =
        String(sessions.length);
    }

    if (!sessions.length) {
      const empty = document.createElement("p");

      empty.textContent =
        "No scheduled or ongoing live classes for your account.";

      liveSessionList.appendChild(empty);

      return;
    }

    sessions.forEach(session => {
      liveSessionList.appendChild(
        createSessionCard(session)
      );
    });

  } catch (error) {
    console.error("Load live sessions error:", error);

    liveSessionList.replaceChildren();

    const errorMessage = document.createElement("p");

    errorMessage.textContent =
      "Unable to load live classes. Check your connection and permissions.";

    liveSessionList.appendChild(errorMessage);
  }
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

  title.textContent =
    session.title || "Untitled Live Class";

  const badge = document.createElement("span");

 badge.className =
  "student-live-badge " +
  (
    session.status === "live"
      ? "is-live"
      : session.status === "ended"
        ? "is-ended"
        : "is-scheduled"
  );

badge.textContent =
  session.status === "live"
    ? "LIVE NOW"
    : session.status === "ended"
      ? "ENDED"
      : "SCHEDULED";

  header.append(title, badge);

  const type = document.createElement("p");

  type.className = "student-live-meta";
  type.textContent = meetingTypeLabel(session);

  const teacher = document.createElement("p");

  teacher.className = "student-live-meta";

  teacher.textContent =
    "Teacher: " + (session.teacherName || "Teacher");

  const section = document.createElement("p");

  section.className = "student-live-meta";

  section.textContent =
    "Section: " +
    (
      session.sectionName ||
      session.sectionId ||
      "Not specified"
    );

  const description = document.createElement("p");

  description.className = "student-live-meta";

  description.textContent =
    session.description ||
    "No description provided.";

  const button = document.createElement("button");

  button.type = "button";
  button.className =
    "el-btn el-btn-primary student-join-btn";

 if (session.status === "live") {
  button.textContent = "Join Meeting";

  button.addEventListener("click", () => {
    openMeetingPage(session.id);
  });

} else if (session.status === "ended") {
  button.textContent = "Waiting for Teacher to Restart";
  button.disabled = true;

} else {
  button.textContent = "Waiting for Teacher";
  button.disabled = true;
}

  card.append(
    header,
    type,
    teacher,
    section,
    description,
    button
  );

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
        participantGrid?.querySelector(
          `[data-identity="${CSS.escape(participant.identity)}"]`
        )?.remove();

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
              renderParticipants();
            }
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
      reason => {
        if (currentRoom !== room) return;
        currentRoom = null;
        micEnabled = false;
        cameraEnabled = false;
        shareEnabled = false;
        canPublish = false;
        hideMeeting();
        if (participantGrid) participantGrid.replaceChildren();
        if (peopleContainer) peopleContainer.replaceChildren();
        if (chatContainer) chatContainer.replaceChildren();
        const wasRoomDeleted = String(reason) === "ROOM_DELETED" || String(reason?.toString?.()) === "ROOM_DELETED";
        message(
          meetingNotice,
          wasRoomDeleted
            ? "The teacher ended this meeting for everyone. You have been disconnected."
            : "You were disconnected from the meeting. You can rejoin while the session is live.",
          !wasRoomDeleted
        );
        if (currentStudent) {
          // The teacher updates the Firestore status immediately after deleting the LiveKit room.
          // Refresh once now and once shortly after to avoid showing a stale LIVE badge.
          void loadLiveSessions(currentStudent.uid);
          setTimeout(() => loadLiveSessions(currentStudent.uid), 900);
        }
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

    renderExistingParticipants();

    if (micBtn) {
      micBtn.disabled = !canPublish;

      micBtn.textContent =
        micEnabled ? "Mute mic" : "Unmute mic";
    }

    if (cameraBtn) {
      cameraBtn.disabled = !canPublish;

      cameraBtn.textContent =
        cameraEnabled
          ? "Turn camera off"
          : "Turn camera on";
    }

    if (shareBtn) {
      shareBtn.disabled = !canPublish;
      shareBtn.textContent = "Share screen";
    }

    message(
      meetingNotice,
      canPublish
        ? "Connected. Your microphone and camera are enabled."
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
  if (!currentRoom || !canPublish || !micBtn) {
    return;
  }

  const nextState = !micEnabled;

  try {
    await currentRoom.localParticipant.setMicrophoneEnabled(
      nextState
    );

    micEnabled = nextState;

    micBtn.textContent =
      micEnabled ? "Mute mic" : "Unmute mic";

  } catch (error) {
    message(
      meetingNotice,
      error.message || "Unable to change microphone.",
      true
    );
  }
}

// ======================================================
// CAMERA
// ======================================================

async function toggleCamera() {
  if (!currentRoom || !canPublish || !cameraBtn) {
    return;
  }

  const nextState = !cameraEnabled;

  try {
    await currentRoom.localParticipant.setCameraEnabled(
      nextState
    );

    cameraEnabled = nextState;

    cameraBtn.textContent =
      cameraEnabled
        ? "Turn camera off"
        : "Turn camera on";

    if (!cameraEnabled) {
      const tile = participantGrid?.querySelector(
        `[data-identity="${CSS.escape(currentRoom.localParticipant.identity)}"]`
      );

      tile?.querySelectorAll("video").forEach(video => {
        video.remove();
      });

      if (
        tile &&
        !tile.querySelector(".sm-placeholder")
      ) {
        const placeholder = document.createElement("div");

        placeholder.className = "sm-placeholder";
        placeholder.textContent = "Your camera is off";

        tile.prepend(placeholder);
      }
    }

  } catch (error) {
    message(
      meetingNotice,
      error.message || "Unable to change camera.",
      true
    );
  }
}

// ======================================================
// SCREEN SHARING
// ======================================================


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

    shareBtn.textContent =
      shareEnabled
        ? "Stop sharing"
        : "Share screen";

  } catch (error) {
    shareEnabled = false;

    shareBtn.textContent = "Share screen";

    message(
      meetingNotice,
      error.message ||
      "Screen sharing is unavailable on this device.",
      true
    );
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
  if (!sidebar) return;

  sidebar.classList.add("open");

  if (mode === "chat") {
    if (sidebarTitle) {
      sidebarTitle.textContent = "Meeting Chat";
    }

    peopleContainer?.classList.add("sm-hidden");
    chatContainer?.classList.remove("sm-hidden");
    chatForm?.classList.remove("sm-hidden");

  } else {
    if (sidebarTitle) {
      sidebarTitle.textContent = "Participants";
    }

    peopleContainer?.classList.remove("sm-hidden");
    chatContainer?.classList.add("sm-hidden");
    chatForm?.classList.add("sm-hidden");

    renderParticipants();
  }
}

function closeSidebar() {
  sidebar?.classList.remove("open");
}

// ======================================================
// LEAVE MEETING
// ======================================================

async function leaveMeeting() {
  const roomToLeave = currentRoom;
  currentRoom = null;
  try {
    if (roomToLeave) {
      await roomToLeave.disconnect();
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

  hideMeeting();

  participantGrid?.replaceChildren();
  peopleContainer?.replaceChildren();
  chatContainer?.replaceChildren();

  if (micBtn) {
    micBtn.disabled = true;
    micBtn.textContent = "Unmute mic";
  }

  if (cameraBtn) {
    cameraBtn.disabled = true;
    cameraBtn.textContent = "Turn camera on";
  }

  if (shareBtn) {
    shareBtn.disabled = true;
    shareBtn.textContent = "Share screen";
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

refreshLiveBtn?.addEventListener("click", () => {
  if (currentStudent) {
    loadLiveSessions(currentStudent.uid);
  }
});

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
leaveBtn?.addEventListener("click", leaveMeeting);

chatForm?.addEventListener("submit", sendChat);

document.getElementById("studentPeopleTopBtn")
  ?.addEventListener(
    "click",
    () => openSidebar("people")
  );

document.getElementById("studentMeetingPeople")
  ?.addEventListener(
    "click",
    () => openSidebar("people")
  );

document.getElementById("studentChatTopBtn")
  ?.addEventListener(
    "click",
    () => openSidebar("chat")
  );

document.getElementById("studentMeetingChatBtn")
  ?.addEventListener(
    "click",
    () => openSidebar("chat")
  );

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
  if (currentRoom) {
    currentRoom.disconnect();
  }
});