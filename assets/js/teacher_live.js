
import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
    Room,
    RoomEvent
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm";

const TOKEN_URL =
    "https://equallearn-live-token.jommelhallig655.workers.dev/token";

// ======================================================
// ELEMENTS
// ======================================================

const titleInput = document.getElementById("liveTitle");
const modeInput = document.getElementById("liveMode");
const descriptionInput = document.getElementById("liveDescription");

const createBtn = document.getElementById("createLiveBtn");
const startBtn = document.getElementById("startLiveBtn");
const micBtn = document.getElementById("micBtn");
const cameraBtn = document.getElementById("cameraBtn");
const endBtn = document.getElementById("endLiveBtn");

const createMessage = document.getElementById("createMessage");
const connectionMessage = document.getElementById("connectionMessage");

const teacherDisplay = document.getElementById("sessionTeacher");
const sessionTitle = document.getElementById("sessionTitle");
const sessionIdDisplay = document.getElementById("sessionId");
const sessionModeDisplay = document.getElementById("sessionMode");
const sessionState = document.getElementById("sessionState");

const liveStatus = document.getElementById("liveStatus");
const previewMessage = document.getElementById("previewMessage");
const previewContainer = document.querySelector(".live-preview");

// ======================================================
// STATE
// ======================================================

let currentUser = null;
let currentSessionId = null;
let currentRoom = null;
let localCameraEnabled = false;
let localMicEnabled = false;
let busy = false;

// ======================================================
// HELPERS
// ======================================================

function message(element, text, isError = false) {
    if (!element) return;

    element.textContent = text;
    element.style.color = isError ? "#dc2626" : "#64748b";
}

function setStatus(text, color = "#4f46e5") {
    if (!liveStatus) return;

    liveStatus.textContent = text;
    liveStatus.style.color = color;
}

function setButtons({
    create = false,
    start = false,
    controls = false,
    end = false
} = {}) {
    if (createBtn) createBtn.disabled = !create;
    if (startBtn) startBtn.disabled = !start;
    if (micBtn) micBtn.disabled = !controls;
    if (cameraBtn) cameraBtn.disabled = !controls;
    if (endBtn) endBtn.disabled = !end;
}

function showPreviewMessage(text) {
    if (!previewContainer) return;

    previewContainer.innerHTML = "";

    const content = document.createElement("div");
    content.style.color = "#fff";
    content.style.textAlign = "center";
    content.style.padding = "24px";

    const heading = document.createElement("h3");
    heading.textContent = "EqualLearn Live Room";

    const description = document.createElement("p");
    description.textContent = text;

    content.append(heading, description);
    previewContainer.appendChild(content);
}

function displayLocalTrack(track) {
    if (!track || !previewContainer || track.kind !== "video") return;

    previewContainer.innerHTML = "";

    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    element.muted = true;

    element.style.width = "100%";
    element.style.height = "100%";
    element.style.objectFit = "cover";

    previewContainer.appendChild(element);
}

function displayRemoteTrack(track) {
    if (!track || !previewContainer) return;

    const element = track.attach();

    element.style.width = "100%";
    element.style.maxHeight = "340px";
    element.style.objectFit = "contain";

    previewContainer.appendChild(element);
}

function makeSessionId() {
    if (typeof crypto.randomUUID !== "function") {
        throw new Error("This browser does not support secure session IDs.");
    }

    return crypto.randomUUID();
}

// ======================================================
// GET STUDENTS FROM TEACHER'S ASSIGNED SECTION
// ======================================================


async function getAssignedStudents(user) {
    let sectionsSnapshot;

    // First: check sections using teacherIds array.
    const multipleTeacherQuery = query(
        collection(db, "sections"),
        where("teacherIds", "array-contains", user.uid)
    );

    sectionsSnapshot = await getDocs(multipleTeacherQuery);

    // Fallback: check sections using teacherId field.
    if (sectionsSnapshot.empty) {
        const singleTeacherQuery = query(
            collection(db, "sections"),
            where("teacherId", "==", user.uid)
        );

        sectionsSnapshot = await getDocs(singleTeacherQuery);
    }

    if (sectionsSnapshot.empty) {
        throw new Error(
            "Walang assigned section para sa teacher account na ito. " +
            "Pakitingnan ang teacher assignment sa Firestore sections collection."
        );
    }

    const sectionDoc = sectionsSnapshot.docs[0];

    const studentsQuery = query(
        collection(db, "users"),
        where("role", "==", "student"),
        where("sectionId", "==", sectionDoc.id)
    );

    const studentsSnapshot = await getDocs(studentsQuery);

    const studentUids = studentsSnapshot.docs
        .filter(student => student.data().status === "active")
        .map(student => student.id);

    return {
        sectionId: sectionDoc.id,
        studentUids
    };
}

// ======================================================
// CREATE LIVE CLASS
// ======================================================

async function createLiveClass() {
    if (busy || !currentUser) return;

    const title = titleInput?.value.trim();
    const description = descriptionInput?.value.trim() || "";
    const mode = modeInput?.value;

    if (!title) {
        message(createMessage, "Please enter a class title.", true);
        titleInput?.focus();
        return;
    }

    if (!["livestream", "meeting"].includes(mode)) {
        message(createMessage, "Invalid session type.", true);
        return;
    }

    busy = true;
    setButtons();

    message(createMessage, "Preparing your classroom...");

    try {
        const { sectionId, studentUids } =
            await getAssignedStudents(currentUser);

        const roomId = makeSessionId();

        const participantUids = [
            currentUser.uid,
            ...studentUids
        ];

        const sessionData = {
            roomId,
            title,
            description,
            teacherUid: currentUser.uid,
            teacherName:
                currentUser.fullname ||
                currentUser.displayName ||
                currentUser.email ||
                "Teacher",

            // Required by the Firestore security rules.
            sectionId,

            status: "scheduled",
            mode,
            participantUids,
            publishUids: [currentUser.uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(
            doc(db, "liveSessions", roomId),
            sessionData
        );

        currentSessionId = roomId;

        if (sessionTitle) sessionTitle.textContent = title;
        if (sessionIdDisplay) sessionIdDisplay.textContent = roomId;

        if (sessionModeDisplay) {
            sessionModeDisplay.textContent =
                mode === "livestream"
                    ? "Livestream"
                    : "Interactive Meeting";
        }

        if (sessionState) sessionState.textContent = "Scheduled";

        if (teacherDisplay) {
            teacherDisplay.textContent = sessionData.teacherName;
        }

        message(
            createMessage,
            `Class created. ${studentUids.length} assigned student(s) included.`
        );

        if (previewMessage) {
            previewMessage.textContent =
                "Your classroom is ready. Start when you are prepared.";
        }

        setStatus("Ready");

        setButtons({
            create: false,
            start: true,
            controls: false,
            end: false
        });

    } catch (error) {
        console.error("CREATE LIVE CLASS ERROR:", error);

        message(
            createMessage,
            error.message || "Unable to create live class.",
            true
        );

        setButtons({ create: true });

    } finally {
        busy = false;
    }
}

// ======================================================
// REQUEST LIVEKIT TOKEN
// ======================================================

async function requestLiveKitToken(roomId) {
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
        body: JSON.stringify({ roomId })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.error || "Unable to obtain LiveKit access token."
        );
    }

    return data;
}

// ======================================================
// START LIVE CLASS
// ======================================================

async function startLiveClass() {
    if (busy || !currentSessionId || !currentUser) return;

    busy = true;
    setButtons();

    message(connectionMessage, "Connecting to LiveKit...");
    setStatus("Connecting", "#d97706");

    try {
        // The token worker requires the session status to be live.
        await updateDoc(
            doc(db, "liveSessions", currentSessionId),
            {
                status: "live",
                startedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }
        );

        const access = await requestLiveKitToken(currentSessionId);

        const room = new Room({
            adaptiveStream: true,
            dynacast: true
        });

        currentRoom = room;

        room.on(
            RoomEvent.TrackSubscribed,
            (track, publication, participant) => {
                console.log(
                    "Remote track subscribed:",
                    participant.identity
                );

                displayRemoteTrack(track);
            }
        );

        room.on(
            RoomEvent.TrackUnsubscribed,
            track => {
                track.detach().forEach(element => element.remove());
            }
        );

        room.on(RoomEvent.Disconnected, () => {
            console.log("LiveKit disconnected.");
        });

        await room.connect(access.serverUrl, access.token);

        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);

        for (const publication of room.localParticipant.trackPublications.values()) {
            if (publication.track?.kind === "video") {
                displayLocalTrack(publication.track);
            }
        }

        localCameraEnabled = true;
        localMicEnabled = true;

        if (sessionState) sessionState.textContent = "LIVE";

        setStatus("LIVE", "#dc2626");

        message(
            connectionMessage,
            "You are connected. Your classroom is live."
        );

        if (previewMessage) {
            previewMessage.textContent = "Live connection established.";
        }

        if (micBtn) micBtn.textContent = "Mute Microphone";
        if (cameraBtn) cameraBtn.textContent = "Turn Camera Off";

        setButtons({
            create: false,
            start: false,
            controls: true,
            end: true
        });

    } catch (error) {
        console.error("START LIVE ERROR:", error);

        if (currentRoom) {
            try {
                await currentRoom.disconnect();
            } catch (_) {}

            currentRoom = null;
        }

        // Try to restore the session to scheduled status.
        try {
            await updateDoc(
                doc(db, "liveSessions", currentSessionId),
                {
                    status: "scheduled",
                    updatedAt: serverTimestamp()
                }
            );
        } catch (updateError) {
            console.error("SESSION STATUS UPDATE ERROR:", updateError);
        }

        setStatus("Connection failed", "#dc2626");

        message(
            connectionMessage,
            error.message || "Unable to start live session.",
            true
        );

        if (sessionState) sessionState.textContent = "Scheduled";

        setButtons({
            create: false,
            start: true,
            controls: false,
            end: false
        });

    } finally {
        busy = false;
    }
}

// ======================================================
// MICROPHONE CONTROL
// ======================================================

async function toggleMicrophone() {
    if (!currentRoom) return;

    try {
        const nextState = !localMicEnabled;

        await currentRoom.localParticipant.setMicrophoneEnabled(nextState);

        localMicEnabled = nextState;

        if (micBtn) {
            micBtn.textContent = localMicEnabled
                ? "Mute Microphone"
                : "Unmute Microphone";
        }

    } catch (error) {
        console.error("MICROPHONE ERROR:", error);
        message(connectionMessage, error.message, true);
    }
}

// ======================================================
// CAMERA CONTROL
// ======================================================

async function toggleCamera() {
    if (!currentRoom) return;

    try {
        const nextState = !localCameraEnabled;

        await currentRoom.localParticipant.setCameraEnabled(nextState);

        localCameraEnabled = nextState;

        if (cameraBtn) {
            cameraBtn.textContent = localCameraEnabled
                ? "Turn Camera Off"
                : "Turn Camera On";
        }

        if (!localCameraEnabled) {
            showPreviewMessage("Your camera is turned off.");
        }

    } catch (error) {
        console.error("CAMERA ERROR:", error);
        message(connectionMessage, error.message, true);
    }
}

// ======================================================
// END LIVE CLASS
// ======================================================

async function endLiveClass() {
    if (busy || !currentSessionId) return;

    if (!confirm("Are you sure you want to end this live class?")) {
        return;
    }

    busy = true;
    setButtons();

    message(connectionMessage, "Ending live session...");

    try {
        if (currentRoom) {
            await currentRoom.disconnect();
            currentRoom = null;
        }

        await updateDoc(
            doc(db, "liveSessions", currentSessionId),
            {
                status: "ended",
                endedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }
        );

        localCameraEnabled = false;
        localMicEnabled = false;

        if (sessionState) sessionState.textContent = "Ended";

        setStatus("Ended");
        showPreviewMessage("This live classroom has ended.");

        message(connectionMessage, "Live class successfully ended.");

        setButtons({
            create: true,
            start: false,
            controls: false,
            end: false
        });

        currentSessionId = null;

    } catch (error) {
        console.error("END LIVE ERROR:", error);

        message(
            connectionMessage,
            error.message || "Unable to end live session.",
            true
        );

        setButtons({
            create: false,
            start: false,
            controls: Boolean(currentRoom),
            end: true
        });

    } finally {
        busy = false;
    }
}

// ======================================================
// EVENT LISTENERS
// ======================================================

createBtn?.addEventListener("click", createLiveClass);
startBtn?.addEventListener("click", startLiveClass);
micBtn?.addEventListener("click", toggleMicrophone);
cameraBtn?.addEventListener("click", toggleCamera);
endBtn?.addEventListener("click", endLiveClass);

// ======================================================
// AUTHENTICATION
// ======================================================

setButtons({ create: false });

requireRole("teacher", async user => {
    currentUser = user;

    const name =
        user.fullname ||
        user.displayName ||
        user.email ||
        "Teacher";

    if (teacherDisplay) teacherDisplay.textContent = name;

    setButtons({ create: true });

    message(
        createMessage,
        "You are ready to create a live classroom."
    );
});

// ======================================================
// CLEANUP
// ======================================================

window.addEventListener("beforeunload", () => {
    if (currentRoom) {
        currentRoom.disconnect();
    }
});
