
import { auth, db } from "./firebase-config.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
    Room,
    RoomEvent
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm";

// ======================================================
// CONFIGURATION
// ======================================================

const TOKEN_URL =
    "https://equallearn-live-token.jommelhallig655.workers.dev/token";

// ======================================================
// DOM ELEMENTS
// ======================================================

const studentName = document.getElementById("studentName");
const studentSection = document.getElementById("studentSection");
const studentTeacher = document.getElementById("studentTeacher");
const studentCohort = document.getElementById("studentCohort");

const notificationList = document.getElementById("notificationList");
const notificationCount = document.getElementById("notificationCount");

const liveSessionList = document.getElementById("liveSessionList");
const liveSessionCount = document.getElementById("liveSessionCount");
const refreshLiveBtn = document.getElementById("refreshLiveBtn");

const studentLiveRoom = document.getElementById("studentLiveRoom");
const studentLiveTitle = document.getElementById("studentLiveTitle");
const studentLiveStatus = document.getElementById("studentLiveStatus");
const studentLiveVideo = document.getElementById("studentLiveVideo");
const studentLiveMessage = document.getElementById("studentLiveMessage");

const studentMicBtn = document.getElementById("studentMicBtn");
const studentCameraBtn = document.getElementById("studentCameraBtn");
const studentLeaveBtn = document.getElementById("studentLeaveBtn");

// ======================================================
// APPLICATION STATE
// ======================================================

let currentStudent = null;
let currentStudentProfile = null;

let currentRoom = null;
let currentSession = null;

let studentCanPublish = false;
let studentMicEnabled = false;
let studentCameraEnabled = false;

let isJoining = false;
let isLeaving = false;

// ======================================================
// GENERAL HELPERS
// ======================================================

function display(element, value, fallback = "Not assigned") {
    if (element) {
        element.textContent = value || fallback;
    }
}

function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
}

function showMessage(element, message, isError = false) {
    if (!element) return;

    element.textContent = message;
    element.style.color = isError ? "#dc2626" : "";
}

function formatDate(timestamp) {
    if (!timestamp) return "Recently";

    try {
        const date =
            typeof timestamp.toDate === "function"
                ? timestamp.toDate()
                : new Date(timestamp);

        if (Number.isNaN(date.getTime())) {
            return "Recently";
        }

        return date.toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    } catch {
        return "Recently";
    }
}

function setLiveStatus(message) {
    display(studentLiveStatus, message, "");
}

function setMediaControls(enabled) {
    if (studentMicBtn) {
        studentMicBtn.disabled = !enabled;
        studentMicBtn.textContent = studentMicEnabled
            ? "Mute Microphone"
            : "Unmute Microphone";
    }

    if (studentCameraBtn) {
        studentCameraBtn.disabled = !enabled;
        studentCameraBtn.textContent = studentCameraEnabled
            ? "Turn Camera Off"
            : "Turn Camera On";
    }
}

function resetMediaState() {
    studentMicEnabled = false;
    studentCameraEnabled = false;
    studentCanPublish = false;

    setMediaControls(false);
}

function clearLiveVideo() {
    if (studentLiveVideo) {
        studentLiveVideo.replaceChildren();
    }
}

// ======================================================
// AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../login.html";
        return;
    }

    currentStudent = user;

    try {
        await loadStudent(user.uid);

        await Promise.all([
            loadNotifications(user.uid),
            loadLiveSessions(user.uid)
        ]);

    } catch (error) {
        console.error("Student dashboard error:", error);

        showMessage(
            studentLiveMessage,
            error.message || "Unable to load student dashboard.",
            true
        );
    }
});

// ======================================================
// LOAD STUDENT PROFILE
// ======================================================

async function loadStudent(uid) {
    display(studentName, "Student");
    display(studentSection, "Loading...");
    display(studentTeacher, "Loading...");
    display(studentCohort, "Loading...");

    const userSnapshot = await getDoc(doc(db, "users", uid));

    if (!userSnapshot.exists()) {
        throw new Error("Student profile not found.");
    }

    const student = userSnapshot.data();

    if (
        normalize(student.role) !== "student" ||
        normalize(student.status) !== "active"
    ) {
        throw new Error("Your student account is not active.");
    }

    currentStudentProfile = student;

    display(studentName, student.fullname, "Student");

    const cohort =
        student.cohort ||
        student.cohortId ||
        student.academicYear ||
        "";

    display(studentCohort, cohort);

    await loadStudentSection(student);
}

// ======================================================
// LOAD ASSIGNED SECTION
// ======================================================

async function loadStudentSection(student) {
    display(studentSection, "Not assigned");
    display(studentTeacher, "Not yet assigned");

    const sectionId = String(student.sectionId || "").trim();

    if (!sectionId) {
        console.warn("Student has no sectionId.");

        return;
    }

    try {
        const sectionSnapshot = await getDoc(
            doc(db, "sections", sectionId)
        );

        if (!sectionSnapshot.exists()) {
            display(studentSection, "Section not found");
            return;
        }

        const section = sectionSnapshot.data();

        const courseMatches =
            !student.course ||
            normalize(section.course) === normalize(student.course);

        const sectionMatches =
            !student.section ||
            normalize(section.sectionName || section.section) ===
                normalize(student.section);

        const academicYearMatches =
            !student.academicYear ||
            normalize(section.academicYear) ===
                normalize(student.academicYear);

        if (
            !courseMatches ||
            !sectionMatches ||
            !academicYearMatches
        ) {
            console.error("Student and section information do not match.");

            display(studentSection, "Assignment needs verification");
            return;
        }

        display(
            studentSection,
            section.sectionName || section.section || sectionId
        );

        const teacherIds = Array.isArray(section.teacherIds)
            ? section.teacherIds
            : [];

        const hasTeacher =
            Boolean(section.teacherId) ||
            teacherIds.length > 0;

        display(
            studentTeacher,
            section.teacherName ||
            section.assignedTeacherName ||
            (hasTeacher ? "Teacher assigned" : "Not yet assigned")
        );

        console.log("Student section loaded:", sectionId);

    } catch (error) {
        console.error("Student section loading error:", error);

        display(studentSection, "Unable to load section");
        display(studentTeacher, "Not yet assigned");
    }
}

// ======================================================
// LOAD NOTIFICATIONS
// ======================================================

async function loadNotifications(uid) {
    if (!notificationList || !notificationCount) return;

    try {
        const notificationQuery = query(
            collection(db, "notifications"),
            where("userId", "==", uid),
            orderBy("createdAt", "desc"),
            limit(5)
        );

        const snapshot = await getDocs(notificationQuery);

        notificationList.replaceChildren();

        if (snapshot.empty) {
            const empty = document.createElement("p");

            empty.className = "empty-notification";
            empty.textContent = "No notifications yet.";

            notificationList.appendChild(empty);
            notificationCount.textContent = "0";

            return;
        }

        let unreadCount = 0;

        snapshot.forEach((item) => {
            const data = item.data();

            if (data.read === false) {
                unreadCount++;
            }

            const notification = document.createElement("div");

            notification.className =
                data.read === false
                    ? "notification unread"
                    : "notification";

            const title = document.createElement("div");
            title.className = "notification-title";
            title.textContent = data.title || "Notification";

            const message = document.createElement("div");
            message.className = "notification-message";
            message.textContent = data.message || "";

            const time = document.createElement("div");
            time.className = "notification-time";
            time.textContent = formatDate(data.createdAt);

            notification.append(title, message, time);

            notificationList.appendChild(notification);
        });

        notificationCount.textContent = String(unreadCount);

    } catch (error) {
        console.error("Notification loading error:", error);

        notificationList.replaceChildren();

        const message = document.createElement("p");

        message.className = "empty-notification";
        message.textContent = "Unable to load notifications.";

        notificationList.appendChild(message);
    }
}

// ======================================================
// LOAD STUDENT LIVE SESSIONS
// ======================================================

async function loadLiveSessions(uid) {
    if (!liveSessionList) return;

    liveSessionList.replaceChildren();

    const loading = document.createElement("p");

    loading.className = "empty-notification";
    loading.textContent = "Loading live classes...";

    liveSessionList.appendChild(loading);

    try {
        const sessionsQuery = query(
            collection(db, "liveSessions"),
            where("participantUids", "array-contains", uid)
        );

        const snapshot = await getDocs(sessionsQuery);

        const sessions = snapshot.docs
            .map(item => ({
                id: item.id,
                ...item.data()
            }))
            .filter(session =>
                ["scheduled", "live"].includes(
                    normalize(session.status)
                )
            )
            .sort((a, b) => {
                const aLive = normalize(a.status) === "live";
                const bLive = normalize(b.status) === "live";

                if (aLive && !bLive) return -1;
                if (!aLive && bLive) return 1;

                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;

                return bTime - aTime;
            });

        liveSessionList.replaceChildren();

        if (liveSessionCount) {
            liveSessionCount.textContent = String(sessions.length);
        }

        if (!sessions.length) {
            const empty = document.createElement("p");

            empty.className = "empty-notification";
            empty.textContent =
                "No scheduled or ongoing live classes for your account.";

            liveSessionList.appendChild(empty);
            return;
        }

        sessions.forEach(session => {
            liveSessionList.appendChild(
                createLiveSessionCard(session, uid)
            );
        });

    } catch (error) {
        console.error("Load live sessions error:", error);

        liveSessionList.replaceChildren();

        const errorMessage = document.createElement("p");

        errorMessage.className = "empty-notification";
        errorMessage.textContent =
            "Unable to load live classes. " + error.message;

        liveSessionList.appendChild(errorMessage);

        if (liveSessionCount) {
            liveSessionCount.textContent = "0";
        }
    }
}

// ======================================================
// CREATE LIVE SESSION CARD
// ======================================================

function createLiveSessionCard(session, uid) {
    const card = document.createElement("article");
    card.className = "student-live-card";

    const header = document.createElement("div");
    header.className = "student-live-card-header";

    const title = document.createElement("h4");
    title.textContent = session.title || "Untitled Live Class";

    const status = document.createElement("span");

    const isLive = normalize(session.status) === "live";

    status.className = isLive
        ? "student-live-badge is-live"
        : "student-live-badge is-scheduled";

    status.textContent = isLive ? "LIVE NOW" : "SCHEDULED";

    header.append(title, status);

    const teacher = document.createElement("p");
    teacher.className = "student-live-meta";
    teacher.textContent =
        "Teacher: " + (session.teacherName || "Teacher");

    const mode = document.createElement("p");
    mode.className = "student-live-meta";

    mode.textContent =
        normalize(session.mode) === "meeting"
            ? "Interactive Meeting"
            : "Livestream";

    const description = document.createElement("p");
    description.className = "student-live-description";
    description.textContent =
        session.description || "No description provided.";

    const button = document.createElement("button");

    button.type = "button";
    button.className = "el-btn el-btn-primary student-join-btn";

    if (isLive) {
        button.textContent = "Join Live Class";

        button.addEventListener("click", async () => {
            button.disabled = true;
            button.textContent = "Connecting...";

            await joinLiveClass(session, uid);

            if (!currentRoom) {
                button.disabled = false;
                button.textContent = "Join Live Class";
            }
        });

    } else {
        button.textContent = "Waiting for Teacher";
        button.disabled = true;
    }

    card.append(
        header,
        teacher,
        mode,
        description,
        button
    );

    return card;
}

// ======================================================
// REQUEST LIVEKIT ACCESS TOKEN
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

        body: JSON.stringify({
            roomId
        })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
        throw new Error(
            data.error || "Unable to obtain LiveKit access token."
        );
    }

    if (!data.serverUrl || !data.token) {
        throw new Error(
            "LiveKit Worker returned an incomplete response."
        );
    }

    return data;
}

// ======================================================
// DISPLAY REMOTE TRACK
// ======================================================

function displayRemoteTrack(track, participant) {
    if (!studentLiveVideo || !track) return;

    // Prevent duplicate display of the same track.
    const trackId = track.sid || track.mediaStreamTrack?.id;

    if (
        trackId &&
        studentLiveVideo.querySelector(
            `[data-live-track="${CSS.escape(trackId)}"]`
        )
    ) {
        return;
    }

    const element = track.attach();

    element.autoplay = true;
    element.playsInline = true;

    element.dataset.liveTrack = trackId || "";

    element.style.maxWidth = "100%";

    if (track.kind === "video") {
        element.style.width = "100%";
        element.style.maxHeight = "480px";
        element.style.objectFit = "contain";
        element.style.background = "#000";
    }

    if (track.kind === "audio") {
        element.style.display = "none";
    }

    studentLiveVideo.appendChild(element);

    console.log(
        "Remote track displayed:",
        participant?.identity || "Unknown participant",
        track.kind
    );

    if (track.kind === "video") {
        element.play?.().catch(error => {
            console.warn("Video autoplay may require user interaction:", error);
        });
    }
}

// ======================================================
// DISPLAY ALREADY SUBSCRIBED TRACKS
// ======================================================

function displayExistingRemoteTracks(room) {
    room.remoteParticipants.forEach(participant => {
        participant.trackPublications.forEach(publication => {
            if (
                publication.isSubscribed &&
                publication.track
            ) {
                displayRemoteTrack(
                    publication.track,
                    participant
                );
            }
        });
    });
}

// ======================================================
// JOIN LIVE CLASS
// ======================================================

async function joinLiveClass(session, uid) {
    if (isJoining || currentRoom) {
        showMessage(
            studentLiveMessage,
            "You are already connecting to or attending a live class.",
            true
        );

        return;
    }

    isJoining = true;

    try {
        if (normalize(session.status) !== "live") {
            throw new Error("This class is not live yet.");
        }

        if (
            !Array.isArray(session.participantUids) ||
            !session.participantUids.includes(uid)
        ) {
            throw new Error(
                "You are not authorized to join this class."
            );
        }

        if (!currentStudentProfile?.sectionId) {
            throw new Error(
                "Your student account has no assigned section."
            );
        }

        if (
            String(session.sectionId || "") !==
            String(currentStudentProfile.sectionId)
        ) {
            throw new Error(
                "This live class does not belong to your assigned section."
            );
        }

        if (!studentLiveRoom) {
            throw new Error(
                "The live classroom interface is missing."
            );
        }

        studentLiveRoom.hidden = false;

        display(
            studentLiveTitle,
            session.title,
            "EqualLearn Live"
        );

        setLiveStatus("CONNECTING");

        clearLiveVideo();
        resetMediaState();

        showMessage(
            studentLiveMessage,
            "Connecting to your classroom..."
        );

        // The Worker independently verifies the student's account,
        // section membership, participant permission, and session status.
        const access = await requestLiveKitToken(session.id);

        if (
            access.mode &&
            normalize(access.mode) !== normalize(session.mode)
        ) {
            throw new Error(
                "The live session mode does not match the server response."
            );
        }

        const room = new Room({
            adaptiveStream: true,
            dynacast: true
        });

        currentRoom = room;
        currentSession = session;

        // ----------------------------------------------
        // REMOTE TRACK EVENTS
        // ----------------------------------------------

        room.on(
            RoomEvent.TrackSubscribed,
            (track, publication, participant) => {
                displayRemoteTrack(track, participant);
            }
        );

        room.on(
            RoomEvent.TrackUnsubscribed,
            (track) => {
                track.detach().forEach(element => {
                    element.remove();
                });
            }
        );

        room.on(
            RoomEvent.ParticipantConnected,
            participant => {
                console.log(
                    "Participant connected:",
                    participant.identity
                );
            }
        );

        room.on(
            RoomEvent.ParticipantDisconnected,
            participant => {
                console.log(
                    "Participant disconnected:",
                    participant.identity
                );
            }
        );

        room.on(
            RoomEvent.Disconnected,
            () => {
                console.log("Student disconnected from LiveKit.");

                if (!isLeaving) {
                    currentRoom = null;
                    currentSession = null;

                    resetMediaState();
                    clearLiveVideo();

                    setLiveStatus("DISCONNECTED");

                    showMessage(
                        studentLiveMessage,
                        "You have been disconnected from the live classroom."
                    );
                }
            }
        );

        // ----------------------------------------------
        // CONNECT TO LIVEKIT
        // ----------------------------------------------

        await room.connect(
            access.serverUrl,
            access.token
        );

        // Display tracks that may have been subscribed during connection.
        displayExistingRemoteTracks(room);

        // ----------------------------------------------
        // STUDENT PERMISSIONS
        // ----------------------------------------------

        const mode = normalize(session.mode);

        // Livestream: student is a viewer.
        // Meeting: an authorized student can publish.
        // This must match the permissions issued by the Worker.
        studentCanPublish = mode === "meeting";

        // Privacy: do not automatically activate the student's
        // microphone or camera upon entering the meeting.
        studentMicEnabled = false;
        studentCameraEnabled = false;

        if (studentCanPublish) {
            setMediaControls(true);

            showMessage(
                studentLiveMessage,
                "Connected to the meeting. Your microphone and camera are off. Turn them on when you are ready."
            );

        } else {
            setMediaControls(false);

            showMessage(
                studentLiveMessage,
                "Connected to the livestream. You can watch and listen to your teacher."
            );
        }

        setLiveStatus("CONNECTED");

        studentLiveRoom.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        console.log("Student successfully joined:", session.id);

    } catch (error) {
        console.error("JOIN LIVE CLASS ERROR:", error);

        if (currentRoom) {
            try {
                await currentRoom.disconnect();
            } catch (disconnectError) {
                console.warn(
                    "LiveKit disconnect cleanup error:",
                    disconnectError
                );
            }
        }

        currentRoom = null;
        currentSession = null;

        resetMediaState();
        clearLiveVideo();

        setLiveStatus("CONNECTION FAILED");

        showMessage(
            studentLiveMessage,
            error.message || "Unable to join live class.",
            true
        );

    } finally {
        isJoining = false;
    }
}

// ======================================================
// STUDENT MICROPHONE
// ======================================================

async function toggleStudentMicrophone() {
    if (!currentRoom || !studentCanPublish) {
        return;
    }

    try {
        const nextState = !studentMicEnabled;

        await currentRoom.localParticipant.setMicrophoneEnabled(
            nextState
        );

        studentMicEnabled = nextState;

        if (studentMicBtn) {
            studentMicBtn.textContent = studentMicEnabled
                ? "Mute Microphone"
                : "Unmute Microphone";
        }

    } catch (error) {
        console.error("Student microphone error:", error);

        showMessage(
            studentLiveMessage,
            error.message || "Unable to change microphone state.",
            true
        );
    }
}

// ======================================================
// STUDENT CAMERA
// ======================================================

async function toggleStudentCamera() {
    if (!currentRoom || !studentCanPublish) {
        return;
    }

    try {
        const nextState = !studentCameraEnabled;

        await currentRoom.localParticipant.setCameraEnabled(
            nextState
        );

        studentCameraEnabled = nextState;

        if (studentCameraBtn) {
            studentCameraBtn.textContent = studentCameraEnabled
                ? "Turn Camera Off"
                : "Turn Camera On";
        }

    } catch (error) {
        console.error("Student camera error:", error);

        showMessage(
            studentLiveMessage,
            error.message || "Unable to change camera state.",
            true
        );
    }
}

// ======================================================
// LEAVE LIVE CLASS
// ======================================================

async function leaveLiveClass() {
    if (isLeaving) return;

    isLeaving = true;

    try {
        const room = currentRoom;

        // Clear state first to prevent duplicate leave actions.
        currentRoom = null;
        currentSession = null;

        resetMediaState();

        if (room) {
            await room.disconnect();
        }

        clearLiveVideo();

        if (studentLiveRoom) {
            studentLiveRoom.hidden = true;
        }

        setLiveStatus("DISCONNECTED");

        showMessage(
            studentLiveMessage,
            "You left the live classroom."
        );

    } catch (error) {
        console.error("Leave live class error:", error);

        showMessage(
            studentLiveMessage,
            error.message || "Unable to leave the live classroom.",
            true
        );

    } finally {
        isLeaving = false;
    }
}

// ======================================================
// REFRESH LIVE CLASSES
// ======================================================

refreshLiveBtn?.addEventListener("click", async () => {
    if (!currentStudent) return;

    refreshLiveBtn.disabled = true;

    try {
        await loadLiveSessions(currentStudent.uid);
    } finally {
        refreshLiveBtn.disabled = false;
    }
});

// ======================================================
// BUTTON EVENTS
// ======================================================

studentMicBtn?.addEventListener(
    "click",
    toggleStudentMicrophone
);

studentCameraBtn?.addEventListener(
    "click",
    toggleStudentCamera
);

studentLeaveBtn?.addEventListener(
    "click",
    leaveLiveClass
);

// ======================================================
// INITIAL CONTROL STATE
// ======================================================

resetMediaState();

if (studentLiveRoom) {
    studentLiveRoom.hidden = true;
}

// ======================================================
// PAGE CLEANUP
// ======================================================

window.addEventListener("beforeunload", () => {
    if (currentRoom) {
        currentRoom.disconnect();
    }
});
