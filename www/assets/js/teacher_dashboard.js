
import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ======================================================
// DASHBOARD ELEMENTS
// ======================================================

const teacherName = document.getElementById("teacherName");
const moduleCount = document.getElementById("moduleCount");
const lessonCount = document.getElementById("lessonCount");
const quizCount = document.getElementById("quizCount");
const studentCount = document.getElementById("studentCount");
const logoutBtn = document.getElementById("logout");


// ======================================================
// SAFE DISPLAY
// ======================================================

function setText(element, value) {
    if (element) {
        element.textContent = value;
    }
}


// ======================================================
// LOAD INDIVIDUAL COLLECTION COUNT
// ======================================================

async function loadCount(collectionName, element) {

    try {

        const snapshot = await getDocs(
            collection(db, collectionName)
        );

        setText(element, snapshot.size);

        return snapshot.size;

    } catch (error) {

        console.error(
            `${collectionName} COUNT ERROR:`,
            error.code,
            error.message
        );

        setText(element, "—");

        return null;
    }
}


async function loadTeacherModuleCount(user) {
    try {
        const snapshot = await getDocs(
            query(
                collection(db, "modules"),
                where("createdBy", "==", user.uid)
            )
        );

        setText(moduleCount, snapshot.size);
        console.log("[TEACHER DASHBOARD] Own modules:", snapshot.size);

        return snapshot.size;

    } catch (error) {
        console.error(
            "MODULE COUNT ERROR:",
            error.code,
            error.message
        );

        setText(moduleCount, "—");
        return null;
    }
}


// ======================================================
// LOAD ASSIGNED STUDENTS
// ======================================================

async function loadStudentCount(user) {

    try {

        // Find only sections assigned to this teacher.
        const sectionsSnapshot = await getDocs(
            query(
                collection(db, "sections"),
                where("teacherIds", "array-contains", user.uid)
            )
        );

        if (sectionsSnapshot.empty) {
            setText(studentCount, "0");
            return 0;
        }

        let totalStudents = 0;

        // Count students in each assigned section.
        for (const sectionDoc of sectionsSnapshot.docs) {

            const sectionId = sectionDoc.id;

            const studentsSnapshot = await getDocs(
                query(
                    collection(db, "users"),
                    where("role", "==", "student"),
                    where("sectionId", "==", sectionId)
                )
            );

            totalStudents += studentsSnapshot.size;
        }

        setText(studentCount, totalStudents);
        return totalStudents;

    } catch (error) {

        console.error(
            "ASSIGNED STUDENT COUNT ERROR:",
            error.code,
            error.message
        );

        setText(studentCount, "—");
        return null;
    }
}


// ======================================================
// LOAD DASHBOARD COUNTS
// ======================================================


async function loadDashboardCounts(user) {

    setText(moduleCount, "...");
    setText(lessonCount, "...");
    setText(quizCount, "...");
    setText(studentCount, "...");

    await Promise.all([
        loadTeacherModuleCount(user),
        loadCount("lessons", lessonCount),
        loadCount("questions", quizCount),
        loadStudentCount(user)
    ]);
}



// ======================================================
// TEACHER AUTHENTICATION
// ======================================================

requireRole("teacher", async (user) => {

    try {

        const displayName =
            user.fullname ||
            user.displayName ||
            user.email ||
            "Teacher";

        setText(teacherName, displayName);

        await loadDashboardCounts(user);

    } catch (error) {

        console.error(
            "TEACHER DASHBOARD INITIALIZATION ERROR:",
            error
        );

        setText(
            teacherName,
            "Unable to load teacher profile."
        );
    }

});


// ======================================================
// LOGOUT
// ======================================================

if (logoutBtn) {

    logoutBtn.addEventListener("click", async (event) => {

        event.preventDefault();

        logoutBtn.style.pointerEvents = "none";

        try {

            await signOut(auth);

            window.location.replace("../login.html");

        } catch (error) {

            console.error("LOGOUT ERROR:", error);

            alert("Unable to logout. Please try again.");

            logoutBtn.style.pointerEvents = "";
        }

    });

}
