
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

let notificationList = null;
let notificationCount = null;
let resolvedStudentDisplayName = "Student";

// ======================================================
// STATE
// ======================================================

let unsubscribeNotifications = null;
let notificationListenerStarted = false;

// ======================================================
// DEVICE-LEVEL NOTIFICATIONS
// Browser/OS settings control notification sound and volume.
// No app-side volume slider or forced system-volume override.
// ======================================================

function showDeviceNotification(data) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return false;
    }

    const title = data.title || "EqualLearn notification";
    const options = {
        body: data.message || "You have a new update.",
        icon: new URL("../assets/icons/equallearn-logo.png", window.location.href).href,
        tag: `equallearn-${data.id || Date.now()}`,
        renotify: false,
        silent: false
    };

    const openTarget = () => {
        window.focus();
        redirectToNotification(data);
    };

    // Prefer Service Worker notifications (better support on mobile/PWA).
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistration()
            .then(registration => {
                if (registration && typeof registration.showNotification === "function") {
                    return registration.showNotification(title, options);
                }
                const notification = new Notification(title, options);
                notification.onclick = () => { notification.close(); openTarget(); };
                return undefined;
            })
            .catch(error => console.warn("Device notification could not be shown:", error));
        return true;
    }

    try {
        const notification = new Notification(title, options);
        notification.onclick = () => { notification.close(); openTarget(); };
        return true;
    } catch (error) {
        console.warn("Device notification could not be shown:", error);
        return false;
    }
}

function bindNotificationShell() {
    notificationList = document.getElementById("notificationList");
    notificationCount = document.getElementById("notificationCount");

    const nameTarget = document.querySelector("[data-el-user-name]");
    if (nameTarget && resolvedStudentDisplayName) {
        nameTarget.textContent = resolvedStudentDisplayName;
    }

    return Boolean(notificationList && notificationCount);
}

function waitForNotificationShell() {
    if (bindNotificationShell()) return Promise.resolve();

    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            if (!bindNotificationShell()) return;
            settled = true;
            observer?.disconnect();
            document.removeEventListener("equallearn:shell-ready", finish);
            resolve();
        };

        const observer = new MutationObserver(finish);
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("equallearn:shell-ready", finish);
        finish();
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
        await waitForNotificationShell();
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

    resolvedStudentDisplayName =
        student.fullname ||
        student.name ||
        auth.currentUser?.displayName ||
        "Student";

    setText(studentName, resolvedStudentDisplayName);
    const shellName = document.querySelector("[data-el-user-name]");
    if (shellName) shellName.textContent = resolvedStudentDisplayName;

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

            setText(notificationCount, unreadCount > 99 ? "99+" : String(unreadCount));
            notificationCount.hidden = unreadCount === 0;

            // Toast only for newly arriving records after
            // the first snapshot has finished loading.
            if (notificationListenerStarted) {

                snapshot.docChanges().forEach(change => {
                    if (change.type !== "added") return;

                    const data = {
                        id: change.doc.id,
                        ...change.doc.data()
                    };

                    if (data.read !== true) {
                        const shownAtDeviceLevel = showDeviceNotification(data);
                        if (!shownAtDeviceLevel) showNewNotificationToast(data);
                    }
                });

            }

            notificationListenerStarted = true;

            // Keep the real-time unread count based on the full snapshot, but
            // limit dropdown DOM nodes to the 30 most recent notifications.
            // This prevents large historical feeds from slowing mobile rendering.
            renderNotifications(notifications.slice(0, 30));

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
            if (notificationCount) notificationCount.hidden = true;
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
        background:#202638;
        color:#f2f0fa;
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
