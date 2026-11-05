
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

// ======================================================
// STUDENT DASHBOARD ELEMENTS
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

let currentStudent = null;
let currentStudentProfile = null;

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
            console.warn(
                "Assigned section document not found:",
                sectionId
            );

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
            console.error(
                "Student and section information do not match.",
                {
                    sectionId,
                    studentCourse: student.course,
                    assignedCourse: section.course,
                    studentSection: student.section,
                    assignedSection: section.sectionName,
                    studentAcademicYear: student.academicYear,
                    assignedAcademicYear: section.academicYear
                }
            );

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
