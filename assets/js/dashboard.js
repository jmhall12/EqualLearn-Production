
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
// ELEMENTS
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
// STATE
// ======================================================

let currentStudent = null;
let currentStudentProfile = null;
let currentRoom = null;
let currentSession = null;

let studentMicEnabled = false;
let studentCameraEnabled = false;
let studentCanPublish = false;

// ======================================================
// HELPERS
// ======================================================

function display(element, value, fallback = "Not assigned") {
    if (element) {
        element.textContent = value || fallback;
    }
}

function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
}

function showMessage(element, text, isError = false) {
    if (!element) return;

    element.textContent = text;
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
        await loadNotifications(user.uid);
        await loadLiveSessions(user.uid);

    } catch (error) {
        console.error("Student dashboard error:", error);
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

    const userRef = doc(db, "users", uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
        throw new Error("Student profile not found.");
    }

    const student = userSnapshot.data();

    if (
        student.role !== "student" ||
        student.status !== "active"
    ) {
        throw new Error("Student account is not active.");
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
        console.warn("Student has no sectionId.", {
            course: student.course,
            yearLevel: student.yearLevel,
            section: student.section,
            academicYear: student.academicYear
        });

        return;
    }

    try {
        const sectionRef = doc(db, "sections", sectionId);
        const sectionSnapshot = await getDoc(sectionRef);

        if (!sectionSnapshot.exists()) {
            console.warn("Assigned section document not found:", sectionId);
            display(studentSection, "Section not found");
            return;
        }

        const section = sectionSnapshot.data();

        const courseMatches =
            !student.course ||
            normalize(section.course) === normalize(student.course);

        const sectionMatches =
            !student.section ||
            normalize(section.sectionName) === normalize(student.section);

        const academicYearMatches =
            !student.academicYear ||
            normalize(section.academicYear) === normalize(student.academicYear);

        if (
            !courseMatches ||
            !sectionMatches ||
            !academicYearMatches
        ) {
            console.error("Student and section information do not match.", {
                sectionId,
                studentCourse: student.course,
                assignedCourse: section.course,
                studentSection: student.section,
                assignedSection: section.sectionName,
                studentAcademicYear: student.academicYear,
                assignedAcademicYear: section.academicYear
            });

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

        console.log("Student section loaded:", {
            sectionId,
            sectionName: section.sectionName,
            course: section.course,
            academicYear: section.academicYear
        });

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

        liveSessionList.replaceChildren();

        const sessions = snapshot.docs
            .map(item => ({
                id: item.id,
                ...item.data()
            }))
            .filter(session =>
                ["scheduled", "live"].includes(session.status)
            )
            .sort((a, b) => {
                if (a.status === "live" && b.status !== "live") return -1;
                if (a.status !== "live" && b.status === "live") return 1;

                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;

                return bTime - aTime;
            });

        if (liveSessionCount) {
            liveSessionCount.textContent = String(sessions.length);
        }

        if (!sessions.length) {
            const empty = document.createElement("p");
            empty.className = "empty-notification";
            empty.textContent = "No scheduled or ongoing live classes for your account.";

            liveSessionList.appendChild(empty);
            return;
        }

        sessions.forEach(session => {
            liveSessionList.appendChild(createLiveSessionCard(session, uid));
        });

    } catch (error) {
        console.error("Load live sessions error:", error);

        liveSessionList.replaceChildren();

        const errorMessage = document.createElement("p");
        errorMessage.className = "empty-notification";
        errorMessage.textContent =
            "Unable to load live classes: " + error.message;

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
    status.className =
        session.status === "live"
            ? "student-live-badge is-live"
            : "student-live-badge is-scheduled";

    status.textContent =
        session.status === "live"
            ? "LIVE NOW"
            : "SCHEDULED";

    header.append(title, status);

    const teacher = document.createElement("p");
    teacher.className = "student-live-meta";
    teacher.textContent =
        "Teacher: " + (session.teacherName || "Teacher");

    const mode = document.createElement("p");
    mode.className = "student-live-meta";
    mode.textContent =
        session.mode === "meeting"
            ? "Interactive Meeting"
            : "Livestream";

    const description = document.createElement("p");
    description.className = "student-live-description";
    description.textContent =
        session.description || "No description provided.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "el-btn el-btn-primary student-join-btn";

    if (session.status === "live") {
        button.textContent = "Join Live Class";
        button.disabled = false;

        button.addEventListener("click", () => {
            joinLiveClass(session, uid);
        });

    } else {
        button.textContent = "Waiting for Teacher";
        button.disabled = true;
    }

    card.append(header, teacher, mode, description, button);

    return card;
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

    if (!data.serverUrl || !data.token) {
        throw new Error("LiveKit Worker returned an incomplete response.");
    }

    return data;
}

// ======================================================
// JOIN LIVE CLASS
// ======================================================

async function joinLiveClass(session, uid) {
    if (currentRoom) {
        showMessage(studentLiveMessage, "You are already in a live class.", true);
        return;
    }

    if (session.status !== "live") {
        showMessage(studentLiveMessage, "This class is not live yet.", true);
        return;
    }

    if (!Array.isArray(session.participantUids) ||
        !session.participantUids.includes(uid)) {
        showMessage(studentLiveMessage, "You are not authorized to join this class.", true);
        return;
    }

    if (!studentLiveRoom) {
        console.error("Student live room element is missing.");
        return;
    }

    studentLiveRoom.hidden = false;

    if (studentLiveTitle) {
        studentLiveTitle.textContent = session.title || "EqualLearn Live";
    }

    if (studentLiveStatus) {
        studentLiveStatus.textContent = "Connecting...";
    }

    if (studentLiveVideo) {
        studentLiveVideo.replaceChildren();
    }

    showMessage(studentLiveMessage, "Connecting to your classroom...");

    try {
        const access = await requestLiveKitToken(session.id);

        const room = new Room({
            adaptiveStream: true,
            dynacast: true
        });

        currentRoom = room;
        currentSession = session;

        room.on(
            RoomEvent.TrackSubscribed,
            (track, publication, participant) => {
                console.log(
                    "Student subscribed to track:",
                    participant.identity,
                    track.kind
                );

                if (!studentLiveVideo) return;

                const element = track.attach();

                element.autoplay = true;
                element.playsInline = true;

                element.style.maxWidth = "100%";

                if (track.kind === "video") {
                    element.style.width = "100%";
                    element.style.maxHeight = "480px";
                    element.style.objectFit = "contain";
                }

                studentLiveVideo.appendChild(element);
            }
        );

        room.on(
            RoomEvent.TrackUnsubscribed,
            track => {
                track.detach().forEach(element => element.remove());
            }
        );

        room.on(RoomEvent.Disconnected, () => {
            console.log("Student disconnected from LiveKit.");
        });

        await room.connect(access.serverUrl, access.token);

        // Students can publish only when explicitly included in publishUids.
        studentCanPublish =
            Array.isArray(session.publishUids) &&
            session.publishUids.includes(uid);

        if (session.mode === "meeting" && studentCanPublish) {
            await room.localParticipant.setMicrophoneEnabled(true);
            await room.localParticipant.setCameraEnabled(true);

            studentMicEnabled = true;
            studentCameraEnabled = true;

            if (studentMicBtn) studentMicBtn.disabled = false;
            if (studentCameraBtn) studentCameraBtn.disabled = false;

        } else {
            studentMicEnabled = false;
            studentCameraEnabled = false;

            if (studentMicBtn) studentMicBtn.disabled = true;
            if (studentCameraBtn) studentCameraBtn.disabled = true;
        }

        if (studentLiveStatus) {
            studentLiveStatus.textContent = "CONNECTED";
        }

        if (session.mode === "meeting" && !studentCanPublish) {
            showMessage(
                studentLiveMessage,
                "Connected. Your microphone and camera are disabled until the teacher allows participation."
            );
        } else {
            showMessage(
                studentLiveMessage,
                "You are connected to EqualLearn Live."
            );
        }

        if (studentMicBtn) {
            studentMicBtn.textContent = "Mute Microphone";
        }

        if (studentCameraBtn) {
            studentCameraBtn.textContent = "Turn Camera Off";
        }

        studentLiveRoom.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    } catch (error) {
        console.error("JOIN LIVE CLASS ERROR:", error);

        if (currentRoom) {
            try {
                await currentRoom.disconnect();
            } catch (_) {}

            currentRoom = null;
        }

        currentSession = null;
        studentCanPublish = false;

        if (studentLiveStatus) {
            studentLiveStatus.textContent = "CONNECTION FAILED";
        }

        showMessage(
            studentLiveMessage,
            error.message || "Unable to join live class.",
            true
        );
    }
}

// ======================================================
// STUDENT MICROPHONE
// ======================================================

async function toggleStudentMicrophone() {
    if (!currentRoom || !studentCanPublish) return;

    try {
        const nextState = !studentMicEnabled;

        await currentRoom.localParticipant.setMicrophoneEnabled(nextState);

        studentMicEnabled = nextState;

        if (studentMicBtn) {
            studentMicBtn.textContent = studentMicEnabled
                ? "Mute Microphone"
                : "Unmute Microphone";
        }

    } catch (error) {
        console.error("Student microphone error:", error);
        showMessage(studentLiveMessage, error.message, true);
    }
}

// ======================================================
// STUDENT CAMERA
// ======================================================

async function toggleStudentCamera() {
    if (!currentRoom || !studentCanPublish) return;

    try {
        const nextState = !studentCameraEnabled;

        await currentRoom.localParticipant.setCameraEnabled(nextState);

        studentCameraEnabled = nextState;

        if (studentCameraBtn) {
            studentCameraBtn.textContent = studentCameraEnabled
                ? "Turn Camera Off"
                : "Turn Camera On";
        }

    } catch (error) {
        console.error("Student camera error:", error);
        showMessage(studentLiveMessage, error.message, true);
    }
}

// ======================================================
// LEAVE LIVE CLASS
// ======================================================

async function leaveLiveClass() {
    try {
        if (currentRoom) {
            await currentRoom.disconnect();
        }

        currentRoom = null;
        currentSession = null;

        studentMicEnabled = false;
        studentCameraEnabled = false;
        studentCanPublish = false;

        if (studentLiveRoom) {
            studentLiveRoom.hidden = true;
        }

        if (studentLiveVideo) {
            studentLiveVideo.replaceChildren();
        }

        if (studentMicBtn) {
            studentMicBtn.disabled = true;
        }

        if (studentCameraBtn) {
            studentCameraBtn.disabled = true;
        }

        showMessage(studentLiveMessage, "You left the live classroom.");

    } catch (error) {
        console.error("Leave live class error:", error);
        showMessage(studentLiveMessage, error.message, true);
    }
}

// ======================================================
// LIVE CLASS EVENT LISTENERS
// ======================================================

refreshLiveBtn?.addEventListener("click", () => {
    if (currentStudent) {
        loadLiveSessions(currentStudent.uid);
    }
});

studentMicBtn?.addEventListener("click", toggleStudentMicrophone);
studentCameraBtn?.addEventListener("click", toggleStudentCamera);
studentLeaveBtn?.addEventListener("click", leaveLiveClass);

// ======================================================
// CLEANUP
// ======================================================

window.addEventListener("beforeunload", () => {
    if (currentRoom) {
        currentRoom.disconnect();
    }
});
