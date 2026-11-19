
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
    onSnapshot,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// ======================================================
// ELEMENTS
// ======================================================

const studentName = document.getElementById("studentName");
const studentSection = document.getElementById("studentSection");
const studentTeacher = document.getElementById("studentTeacher");
const studentCohort = document.getElementById("studentCohort");

const notificationList = document.getElementById("notificationList");
const notificationCount = document.getElementById("notificationCount");

// ======================================================
// STATE
// ======================================================

let unsubscribeNotifications = null;
let notificationListenerStarted = false;

// ======================================================
// EQUALLEARN NOTIFICATION SOUND
// ======================================================

const SOUND_ENABLED_KEY = "equalLearn_notification_sound_enabled";
const SOUND_VOLUME_KEY = "equalLearn_notification_sound_volume";

let notificationSoundEnabled =
    localStorage.getItem(SOUND_ENABLED_KEY) !== "false";

let notificationSoundVolume = Number(
    localStorage.getItem(SOUND_VOLUME_KEY) ?? "0.35"
);

notificationSoundVolume = Math.max(
    0,
    Math.min(1, notificationSoundVolume)
);

let notificationAudioContext = null;
let notificationAudioUnlocked = false;

function unlockNotificationAudio() {
    try {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) return;

        if (!notificationAudioContext) {
            notificationAudioContext = new AudioContextClass();
        }

        if (notificationAudioContext.state === "suspended") {
            notificationAudioContext.resume();
        }

        notificationAudioUnlocked = true;

    } catch (error) {
        console.warn("Notification audio unlock failed:", error);
    }
}

// Browsers require a user interaction before playing audio.
document.addEventListener(
    "pointerdown",
    unlockNotificationAudio,
    { once: true }
);

document.addEventListener(
    "keydown",
    unlockNotificationAudio,
    { once: true }
);

// Original EqualLearn three-tone chime.
function playEqualLearnChime() {
    if (!notificationSoundEnabled) return;
    if (!notificationAudioUnlocked) return;
    if (!notificationAudioContext) return;

    if (notificationAudioContext.state !== "running") {
        return;
    }

    const audio = notificationAudioContext;
    const startTime = audio.currentTime + 0.02;

    const notes = [
        { frequency: 659.25, start: 0, duration: 0.16 },
        { frequency: 783.99, start: 0.13, duration: 0.18 },
        { frequency: 987.77, start: 0.28, duration: 0.30 }
    ];

    notes.forEach(note => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = note.frequency;

        const noteStart = startTime + note.start;
        const noteEnd = noteStart + note.duration;

        const volume = notificationSoundVolume * 0.22;

        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(
            volume,
            noteStart + 0.025
        );

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            noteEnd
        );

        oscillator.connect(gain);
        gain.connect(audio.destination);

        oscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.02);
    });
}

// ======================================================
// SAFE DISPLAY
// ======================================================

function setText(element, value) {
    if (element) {
        element.textContent = value;
    }
}

// ======================================================
// NOTIFICATION SOUND SETTINGS UI
// ======================================================

function createNotificationSoundSettings() {
    if (!notificationList) return;

    if (document.getElementById("equalLearnSoundSettings")) {
        return;
    }

    const container = document.createElement("div");
    container.id = "equalLearnSoundSettings";

    container.innerHTML = `
        <div class="el-sound-settings-header">
            <div>
                <strong>Notification Sound</strong>
                <small>Customize your EqualLearn alerts</small>
            </div>

            <button
                type="button"
                id="elSoundToggle"
                aria-pressed="${notificationSoundEnabled}"
            >
                ${notificationSoundEnabled ? "Sound On" : "Sound Off"}
            </button>
        </div>

        <div class="el-sound-volume">
            <label for="elSoundVolume">
                Volume
                <span id="elSoundVolumeValue">
                    ${Math.round(notificationSoundVolume * 100)}%
                </span>
            </label>

            <input
                type="range"
                id="elSoundVolume"
                min="0"
                max="100"
                value="${Math.round(notificationSoundVolume * 100)}"
            >
        </div>

        <button
            type="button"
            id="elSoundTest"
        >
            <span>♫</span> Test Sound
        </button>
    `;

    const style = document.createElement("style");
    style.id = "equalLearnSoundSettingsStyles";

    style.textContent = `
        #equalLearnSoundSettings {
            padding: 14px;
            margin: 10px 0 14px;
            border: 1px solid rgba(120,101,220,.18);
            border-radius: 14px;
            background: var(--el-card-bg, rgba(120,101,220,.045));
        }

        .el-sound-settings-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .el-sound-settings-header strong {
            display: block;
            font-size: 13px;
        }

        .el-sound-settings-header small {
            display: block;
            margin-top: 3px;
            font-size: 11px;
            opacity: .65;
        }

        #elSoundToggle,
        #elSoundTest {
            border: 0;
            border-radius: 9px;
            padding: 8px 12px;
            cursor: pointer;
            font: inherit;
            font-size: 11px;
            font-weight: 600;
        }

        #elSoundToggle {
            background: rgba(120,101,220,.14);
            color: var(--student-purple, #7865dc);
        }

        #elSoundTest {
            margin-top: 10px;
            background: var(--student-purple, #7865dc);
            color: white;
        }

        .el-sound-volume {
            margin-top: 14px;
        }

        .el-sound-volume label {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin-bottom: 8px;
        }

        #elSoundVolume {
            width: 100%;
            accent-color: var(--student-purple, #7865dc);
            cursor: pointer;
        }
    `;

    document.head.appendChild(style);

    notificationList.parentNode.insertBefore(
        container,
        notificationList
    );

    const toggle = container.querySelector("#elSoundToggle");
    const volume = container.querySelector("#elSoundVolume");
    const volumeValue = container.querySelector("#elSoundVolumeValue");
    const testButton = container.querySelector("#elSoundTest");

    toggle.addEventListener("click", () => {
        unlockNotificationAudio();

        notificationSoundEnabled = !notificationSoundEnabled;

        localStorage.setItem(
            SOUND_ENABLED_KEY,
            String(notificationSoundEnabled)
        );

        toggle.textContent = notificationSoundEnabled
            ? "Sound On"
            : "Sound Off";

        toggle.setAttribute(
            "aria-pressed",
            String(notificationSoundEnabled)
        );

        if (notificationSoundEnabled) {
            playEqualLearnChime();
        }
    });

    volume.addEventListener("input", () => {
        notificationSoundVolume = Number(volume.value) / 100;

        volumeValue.textContent = `${volume.value}%`;

        localStorage.setItem(
            SOUND_VOLUME_KEY,
            String(notificationSoundVolume)
        );
    });

    testButton.addEventListener("click", () => {
        unlockNotificationAudio();

        if (!notificationSoundEnabled) {
            notificationSoundEnabled = true;

            localStorage.setItem(
                SOUND_ENABLED_KEY,
                "true"
            );

            toggle.textContent = "Sound On";
            toggle.setAttribute("aria-pressed", "true");
        }

        playEqualLearnChime();
    });
}

createNotificationSoundSettings();

// ======================================================
// AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async user => {

    if (typeof unsubscribeNotifications === "function") {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }

    notificationListenerStarted = false;

    if (!user) {
        window.location.href = "../login.html";
        return;
    }

    try {
        await loadStudent(user.uid);
        listenToNotifications(user.uid);

    } catch (error) {
        console.error("STUDENT DASHBOARD ERROR:", error);

        setText(
            studentName,
            "Unable to load student profile."
        );
    }

});

// ======================================================
// LOAD STUDENT PROFILE
// ======================================================

async function loadStudent(uid) {

    setText(studentName, "Loading...");
    setText(studentSection, "Loading...");
    setText(studentTeacher, "Loading...");
    setText(studentCohort, "Loading...");

    const userSnapshot = await getDoc(
        doc(db, "users", uid)
    );

    if (!userSnapshot.exists()) {
        setText(studentName, "Student");
        setText(studentSection, "Not assigned");
        setText(studentTeacher, "Not yet assigned");
        setText(studentCohort, "Not assigned");

        throw new Error("Student profile not found.");
    }

    const student = userSnapshot.data();

    if (student.role && student.role !== "student") {
        throw new Error(
            "This account is not registered as a student."
        );
    }

    setText(
        studentName,
        student.fullname ||
        student.name ||
        auth.currentUser?.displayName ||
        "Student"
    );

    const cohort =
        student.cohort ||
        student.cohortId ||
        getCohortFromStudentNumber(student.studentNumber);

    setText(studentCohort, cohort || "Not assigned");

    await findTeacherAssignment(student);
}

// ======================================================
// FIND TEACHER ASSIGNMENT
// ======================================================

async function findTeacherAssignment(student) {
    const sectionId = String(student?.sectionId || "").trim();

    // Current Class Assignments flow stores the student's official placement
    // in users/{uid}.sectionId and the teacher assignment in sections/{id}.
    // Students are allowed to read only their own section document.
    if (sectionId) {
        try {
            const sectionSnapshot = await getDoc(
                doc(db, "sections", sectionId)
            );

            if (!sectionSnapshot.exists()) {
                setText(
                    studentSection,
                    student.section || "Section not found"
                );
                setText(
                    studentTeacher,
                    student.teacherName || "Not yet assigned"
                );
                return;
            }

            const section = sectionSnapshot.data();
            const sectionName =
                section.sectionName ||
                section.section ||
                section.name ||
                student.section ||
                sectionId;

            const hasAssignedTeacher = Boolean(
                section.teacherId ||
                (Array.isArray(section.teacherIds) && section.teacherIds.length)
            );

            const teacherName =
                section.teacherName ||
                section.assignedTeacherName ||
                student.teacherName ||
                (hasAssignedTeacher ? "Teacher assigned" : "Not yet assigned");

            setText(studentSection, sectionName);
            setText(studentTeacher, teacherName);
            setText(
                studentCohort,
                section.academicYear ||
                student.academicYear ||
                student.cohort ||
                student.cohortId ||
                getCohortFromStudentNumber(student.studentNumber) ||
                "Not assigned"
            );
            return;
        } catch (error) {
            console.error(
                "STUDENT SECTION LOOKUP ERROR:",
                error.code || error.message
            );

            // Keep usable assignment details from the student's own profile.
            setText(studentSection, student.section || "Not assigned");
            setText(
                studentTeacher,
                student.teacherName || "Unable to load teacher details"
            );
            return;
        }
    }

    // Older accounts without sectionId may still carry a verified legacy
    // section/teacher label on their own user profile. Do not probe arbitrary
    // teacherAssignments document IDs: current rules intentionally restrict
    // those records and the new section workflow no longer creates them.
    if (student.section || student.teacherName) {
        setText(studentSection, student.section || "Not assigned");
        setText(studentTeacher, student.teacherName || "Not yet assigned");
        return;
    }

    setText(studentSection, "Not assigned");
    setText(studentTeacher, "Not yet assigned");
}

// ======================================================
// COHORT FROM STUDENT NUMBER
// ======================================================

function getCohortFromStudentNumber(studentNumber) {

    if (!studentNumber) return "";

    const value = String(studentNumber)
        .trim()
        .toUpperCase();

    const match = value.match(/^(\d{2})([A-Z]+)/);

    if (!match) return "";

    return match[1] + match[2];
}

// ======================================================
// TIMESTAMP HELPERS
// ======================================================

function getTimestampMillis(timestamp) {

    if (!timestamp) return 0;

    try {
        if (typeof timestamp.toMillis === "function") {
            return timestamp.toMillis();
        }

        if (typeof timestamp.toDate === "function") {
            return timestamp.toDate().getTime();
        }

        if (typeof timestamp.seconds === "number") {
            return timestamp.seconds * 1000;
        }

        const date = new Date(timestamp);

        return Number.isNaN(date.getTime())
            ? 0
            : date.getTime();

    } catch (error) {
        console.warn("Timestamp conversion error:", error);
        return 0;
    }
}

function formatDate(timestamp) {

    if (!timestamp) return "Date unavailable";

    const millis = getTimestampMillis(timestamp);

    if (!millis) return "Date unavailable";

    return new Date(millis).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

// Prefer original post date for historical notifications.
function getNotificationDate(data) {
    return data.publishedAt || data.createdAt || null;
}

// ======================================================
// REAL-TIME STUDENT NOTIFICATIONS
// ======================================================

function listenToNotifications(uid) {

    if (!notificationList || !notificationCount) {
        console.warn(
            "Notification elements not found in student dashboard."
        );
        return;
    }

    setText(notificationCount, "0");

    notificationList.replaceChildren();

    const loading = document.createElement("p");
    loading.className = "empty-notification";
    loading.textContent = "Loading notifications...";

    notificationList.appendChild(loading);

    // IMPORTANT:
    // No limit(50) and no orderBy.
    // All notification documents belonging to this student
    // are loaded, then sorted locally.

    const notificationQuery = query(
        collection(db, "notifications"),
        where("userId", "==", uid)
    );

    unsubscribeNotifications = onSnapshot(
        notificationQuery,

        snapshot => {

            const notifications = snapshot.docs.map(item => ({
                id: item.id,
                ...item.data()
            }));

            notifications.sort((a, b) => {
                return (
                    getTimestampMillis(getNotificationDate(b)) -
                    getTimestampMillis(getNotificationDate(a))
                );
            });

            const unreadCount = notifications.filter(
                item => item.read !== true
            ).length;

            setText(
                notificationCount,
                String(unreadCount)
            );

            // Toast only for newly arriving records after
            // the first snapshot has finished loading.
            if (notificationListenerStarted) {

                snapshot.docChanges().forEach(change => {

                    if (change.type === "added") {
    const data = {
        id: change.doc.id,
        ...change.doc.data()
    };

    if (data.read !== true) {
        playEqualLearnChime();
        showNewNotificationToast(data);
    }
}

                });

            }

            notificationListenerStarted = true;

            // Render every notification, not just the latest five.
            renderNotifications(notifications);

        },

        error => {

            console.error(
                "REAL-TIME NOTIFICATION ERROR:",
                error.code,
                error.message
            );

            notificationList.replaceChildren();

            const errorMessage = document.createElement("p");

            errorMessage.className = "empty-notification";

            errorMessage.textContent =
                error.code === "permission-denied"
                    ? "You do not have permission to view notifications."
                    : "Unable to receive notifications. Please refresh the page.";

            notificationList.appendChild(errorMessage);

            setText(notificationCount, "0");
        }
    );
}

// ======================================================
// RENDER ALL NOTIFICATIONS
// ======================================================

function renderNotifications(notifications) {

    if (!notificationList) return;

    notificationList.replaceChildren();

    if (!notifications.length) {

        const empty = document.createElement("p");

        empty.className = "empty-notification";
        empty.textContent = "No notifications yet.";

        notificationList.appendChild(empty);

        return;
    }

    const fragment = document.createDocumentFragment();

    notifications.forEach(data => {

        const notification = document.createElement("button");

        notification.type = "button";

        notification.className =
            data.read === true
                ? "notification"
                : "notification unread";

        notification.dataset.notificationId = data.id;

        notification.style.width = "100%";
        notification.style.display = "block";
        notification.style.textAlign = "left";
        notification.style.font = "inherit";
        notification.style.color = "inherit";
        notification.style.cursor =
            data.read === true ? "default" : "pointer";
        notification.style.background = "transparent";
        notification.style.border = "0";

        const title = document.createElement("div");

        title.className = "notification-title";
        title.textContent = data.title || "New Notification";

        const message = document.createElement("div");

        message.className = "notification-message";
        message.textContent =
            data.message || "You have a new update.";

        const time = document.createElement("div");

        time.className = "notification-time";
        time.textContent = formatDate(
            getNotificationDate(data)
        );

        notification.append(title, message, time);

        notification.addEventListener("click", async () => {
            if (data.read !== true) {
                notification.disabled = true;

                try {
                    await updateDoc(
                        doc(db, "notifications", data.id),
                        {
                            read: true,
                            readAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        }
                    );

                } catch (error) {
                    notification.disabled = false;

                    console.error(
                        "MARK NOTIFICATION READ ERROR:",
                        error
                    );
                    return;
                }
            }

            redirectToNotification(data);
        });

        fragment.appendChild(notification);
    });

    notificationList.appendChild(fragment);
}

function redirectToNotification(data) {
    const targetUrl =
        typeof data?.targetUrl === "string" && data.targetUrl.trim()
            ? data.targetUrl.trim()
            : buildNotificationTargetUrl(data);

    if (!targetUrl) return;

    try {
        const parsed = new URL(targetUrl, window.location.href);
        window.location.assign(parsed.href);
    } catch (error) {
        console.warn("Notification navigation failed:", error);
    }
}

function buildNotificationTargetUrl(data) {
    const contentType = data?.contentType;
    const contentId = data?.contentId;

    if (!contentType) return "";

    const safeId = String(contentId || "").trim();

    if (contentType === "module") {
        return safeId ? `modules.html?openModule=${encodeURIComponent(safeId)}` : "modules.html";
    }

    if (contentType === "lesson") {
        return safeId ? `modules.html?openLesson=${encodeURIComponent(safeId)}` : "modules.html";
    }

    if (contentType === "live") {
        return safeId ? `live.html?sessionId=${encodeURIComponent(safeId)}` : "live.html";
    }

    if (contentType === "assignment") {
        return safeId ? `assignment.html?id=${encodeURIComponent(safeId)}` : "classwork.html";
    }

    if (contentType === "quiz") {
        return safeId ? `quiz.html?id=${encodeURIComponent(safeId)}` : "quizzes.html";
    }

    if (contentType === "announcement") {
        return safeId ? `announcement.html?id=${encodeURIComponent(safeId)}` : "classwork.html";
    }

    if (contentType === "discussion") {
        return safeId ? `classwork.html?id=${encodeURIComponent(safeId)}` : "classwork.html";
    }

    return safeId ? `classwork.html?id=${encodeURIComponent(safeId)}` : "modules.html";
}

// ======================================================
// NEW NOTIFICATION TOAST
// ======================================================

function showNewNotificationToast(data) {

    const toastId = `notification-toast-${data.id}`;

    if (document.getElementById(toastId)) return;

    const toast = document.createElement("div");

    toast.id = toastId;

    toast.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        z-index:99999;
        width:min(360px,calc(100vw - 32px));
        padding:16px;
        border-radius:16px;
        background:var(--el-card-bg,#ffffff);
        color:var(--el-text,#252338);
        border:1px solid rgba(120,101,220,.25);
        box-shadow:0 12px 35px rgba(0,0,0,.16);
        animation:equalLearnToastIn .25s ease;
    `;

    const heading = document.createElement("strong");

    heading.textContent = data.title || "New Notification";
    heading.style.display = "block";
    heading.style.marginBottom = "6px";

    const message = document.createElement("div");

    message.textContent =
        data.message || "You have a new update.";

    message.style.fontSize = "13px";
    message.style.lineHeight = "1.5";

    const time = document.createElement("small");

    time.textContent = formatDate(
        getNotificationDate(data)
    );

    time.style.display = "block";
    time.style.marginTop = "8px";
    time.style.opacity = ".65";

    toast.append(heading, message, time);

    toast.addEventListener("click", () => {
        redirectToNotification(data);
    });

    document.body.appendChild(toast);

    window.setTimeout(() => {

        toast.style.opacity = "0";
        toast.style.transform = "translateY(-8px)";
        toast.style.transition =
            "opacity .25s, transform .25s";

        window.setTimeout(() => {
            toast.remove();
        }, 300);

    }, 5000);
}

// ======================================================
// TOAST AND NOTIFICATION STYLES
// ======================================================

if (!document.getElementById("equalLearnNotificationStyles")) {

    const style = document.createElement("style");

    style.id = "equalLearnNotificationStyles";

    style.textContent = `
        @keyframes equalLearnToastIn {
            from {
                opacity: 0;
                transform: translateY(-12px);
            }

            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .notification.unread {
            border-left: 3px solid var(--student-purple, #7865dc);
            padding-left: 12px;
        }

        .notification:focus-visible {
            outline: 2px solid var(--student-purple, #7865dc);
            outline-offset: 3px;
            border-radius: 8px;
        }

        .empty-notification {
            padding: 14px 0;
            color: var(--student-muted, #858ba6);
            font-size: 12px;
        }
    `;

    document.head.appendChild(style);
}

// ======================================================
// CLEANUP
// ======================================================

window.addEventListener("beforeunload", () => {

    if (typeof unsubscribeNotifications === "function") {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }

});
