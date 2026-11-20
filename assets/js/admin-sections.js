
import { auth, db } from "./firebase-config.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ======================================================
// ELEMENTS
// ======================================================

const $ = id => document.getElementById(id);

const form = $("sectionForm");
const sectionName = $("sectionName");
const course = $("course");
const yearLevel = $("sectionYearLevel");
const academicYear = $("academicYear");

const teacherSelect = $("teacherId");
const studentSearch = $("studentSearch");
const studentPickerList = $("studentPickerList");
const selectVisibleStudentsButton = $("selectVisibleStudents");
const studentVisibleSummary = $("studentVisibleSummary");

const table = $("sectionsTable");
const saveButton = $("saveSection");
const cancelButton = $("cancelEdit");

const selectionSummary = $("selectionSummary");
const formMessage = $("formMessage");


// ======================================================
// STATE
// ======================================================

let currentAdmin = null;
let sections = [];
let teachers = [];
let students = [];
let editingId = null;
// Keep selection in memory, independently from the currently visible search results.
const selectedStudentIds = new Set();


// ======================================================
// HELPERS
// ======================================================

function normalizeYearLevel(value) {
    const year = String(value || "").trim().toUpperCase();

    const words = {
        "FIRST YEAR": "1",
        "1ST YEAR": "1",
        "SECOND YEAR": "2",
        "2ND YEAR": "2",
        "THIRD YEAR": "3",
        "3RD YEAR": "3",
        "FOURTH YEAR": "4",
        "4TH YEAR": "4"
    };

    if (words[year]) return words[year];

    const match = year.match(/[1-4]/);

    return match ? match[0] : year;
}


function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}


function showMessage(message, type = "error") {
    formMessage.textContent = message;
    formMessage.className = `message ${type}`;
}


function clearMessage() {
    formMessage.textContent = "";
    formMessage.className = "message";
}


function getSelectedStudentIds() {
    return [...selectedStudentIds];
}

function getVisibleStudentRecords() {
    const term = String(studentSearch?.value || "").trim().toLowerCase();

    return [...students]
        .filter(student => {
            if (!term) return true;

            const assignedSection = sections.find(
                section => section.id === student.sectionId
            );

            const searchable = [
                student.fullname,
                student.name,
                student.email,
                student.studentNumber,
                student.course,
                student.yearLevel,
                student.section,
                student.sectionName,
                student.academicYear,
                student.cohort,
                assignedSection?.sectionName
            ].join(" ").toLowerCase();

            return searchable.includes(term);
        })
        .sort((a, b) =>
            String(a.fullname || a.name || a.email || "").localeCompare(
                String(b.fullname || b.name || b.email || "")
            )
        );
}

function studentIsAssignedElsewhere(student) {
    return Boolean(student.sectionId && student.sectionId !== editingId);
}

function updateSelectionSummary() {
    const visibleEligible = getVisibleStudentRecords().filter(
        student => !studentIsAssignedElsewhere(student)
    );

    const selectedCount = selectedStudentIds.size;
    const allVisibleSelected = visibleEligible.length > 0 &&
        visibleEligible.every(student => selectedStudentIds.has(student.id));

    selectionSummary.textContent =
        `${selectedCount.toLocaleString("en-PH")} student${selectedCount === 1 ? "" : "s"} selected`;

    studentVisibleSummary.textContent =
        `${visibleEligible.length.toLocaleString("en-PH")} available / ${getVisibleStudentRecords().length.toLocaleString("en-PH")} shown`;

    selectVisibleStudentsButton.textContent =
        allVisibleSelected ? "Unselect All" : "Select All";
    selectVisibleStudentsButton.setAttribute(
        "aria-pressed",
        String(allVisibleSelected)
    );
    selectVisibleStudentsButton.disabled = visibleEligible.length === 0;
}


// ======================================================
// AUTHENTICATION
// ======================================================

onAuthStateChanged(auth, async user => {

    if (!user) {
        location.href = "../login.html";
        return;
    }

    try {

        const adminSnap = await getDoc(
            doc(db, "users", user.uid)
        );

        if (
            !adminSnap.exists() ||
            adminSnap.data().role !== "admin"
        ) {
            alert("Access denied. Admins only.");
            location.href = "../login.html";
            return;
        }

        currentAdmin = user;

        await loadAll();

    } catch (error) {

        console.error("Admin authentication error:", error);

        table.innerHTML = `
            <tr>
                <td colspan="7" class="empty">
                    Unable to load section management.
                </td>
            </tr>
        `;
    }
});


// ======================================================
// LOAD FIRESTORE DATA
// ======================================================

async function loadAll() {

    table.innerHTML = `
        <tr>
            <td colspan="7" class="empty">
                Loading sections...
            </td>
        </tr>
    `;

    const [
        sectionSnap,
        teacherSnap,
        studentSnap
    ] = await Promise.all([

        getDocs(collection(db, "sections")),

        getDocs(
            query(
                collection(db, "users"),
                where("role", "==", "teacher")
            )
        ),

        getDocs(
            query(
                collection(db, "users"),
                where("role", "==", "student")
            )
        )
    ]);

    sections = sectionSnap.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));

    teachers = teacherSnap.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));

    students = studentSnap.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));

    $("totalSections").textContent = sections.length;
    $("totalTeachers").textContent = teachers.length;
    $("totalStudents").textContent = students.length;

    renderTeacherOptions();
    renderStudentOptions();
    renderSections();
}


// ======================================================
// TEACHER OPTIONS - SINGLE TEACHER
// ======================================================

function renderTeacherOptions(selectedId = "") {

    teacherSelect.innerHTML = `
        <option value="">Select a teacher</option>
    `;

    teachers
        .sort((a, b) =>
            String(a.fullname || "").localeCompare(
                String(b.fullname || "")
            )
        )
        .forEach(teacher => {

            const option = document.createElement("option");

            option.value = teacher.id;

            option.textContent =
                `${teacher.fullname || teacher.email || teacher.id}`;

            option.selected = teacher.id === selectedId;

            teacherSelect.appendChild(option);
        });
}


// ======================================================
// STUDENT OPTIONS - MULTIPLE STUDENTS
// ======================================================

function renderStudentOptions(selectedIds = null) {

    // A provided list (first entry or editing an existing section) resets selection.
    // A plain rerender after search/filter changes leaves the Set untouched.
    if (Array.isArray(selectedIds)) {
        selectedStudentIds.clear();
        selectedIds.forEach(id => selectedStudentIds.add(id));
    }

    const validIds = new Set(students.map(student => student.id));
    [...selectedStudentIds].forEach(id => {
        if (!validIds.has(id)) selectedStudentIds.delete(id);
    });

    const visibleStudents = getVisibleStudentRecords();

    if (!visibleStudents.length) {
        studentPickerList.innerHTML = `
            <div class="student-picker-empty">
                No students match your search.
            </div>
        `;
        updateSelectionSummary();
        return;
    }

    studentPickerList.innerHTML = visibleStudents.map(student => {
        const assignedSection = sections.find(
            section => section.id === student.sectionId
        );
        const assignedElsewhere = studentIsAssignedElsewhere(student);
        const isSelected = selectedStudentIds.has(student.id);
        const displayName = student.fullname || student.name || student.email || "Unnamed Student";
        const studentId = student.studentNumber || "No Student ID";
        const courseYear = [student.course, student.yearLevel]
            .filter(Boolean).join(" · ") || "Course/year not set";
        const sectionLabel = assignedElsewhere
            ? `Already assigned: ${assignedSection?.sectionName || student.section || "another section"}`
            : student.sectionId && student.sectionId === editingId
                ? "Currently in this section"
                : "Available";

        return `
            <label class="student-option ${isSelected ? "is-selected" : ""} ${assignedElsewhere ? "is-locked" : ""}">
                <input
                    type="checkbox"
                    data-student-id="${escapeHTML(student.id)}"
                    ${isSelected ? "checked" : ""}
                    ${assignedElsewhere ? "disabled" : ""}
                    aria-label="Select ${escapeHTML(displayName)}">
                <span class="student-option-main">
                    <strong class="student-option-name">${escapeHTML(displayName)}</strong>
                    <span class="student-option-detail">${escapeHTML(studentId)} · ${escapeHTML(student.email || "No email")} · ${escapeHTML(courseYear)}</span>
                </span>
                <span class="student-option-status">${escapeHTML(sectionLabel)}</span>
            </label>
        `;
    }).join("");

    updateSelectionSummary();
}


// ======================================================
// RENDER SECTIONS TABLE
// ======================================================

function renderSections() {

    if (!sections.length) {

        table.innerHTML = `
            <tr>
                <td colspan="7" class="empty">
                    No sections created yet.
                </td>
            </tr>
        `;

        return;
    }

    table.innerHTML = sections.map(section => {

        const teacherId =
            section.teacherId ||
            (section.teacherIds || [])[0] ||
            "";

        const teacher = teachers.find(
            item => item.id === teacherId
        );

        const teacherName = teacher
            ? teacher.fullname || teacher.email
            : "No teacher assigned";

        const studentCount = students.filter(
            student => student.sectionId === section.id
        ).length;

        return `
            <tr>

                <td>
                    <strong>
                        ${escapeHTML(section.sectionName || "")}
                    </strong>
                </td>

                <td>
                    ${escapeHTML(section.course || "")}
                </td>

                <td>
                    ${escapeHTML(section.yearLevel || "")}
                </td>

                <td>
                    ${escapeHTML(section.academicYear || "")}
                </td>

                <td>
                    ${escapeHTML(teacherName)}
                </td>

                <td>
                    <span class="pill">
                        ${studentCount} Students
                    </span>
                </td>

                <td>

                    <button
                        type="button"
                        class="btn edit"
                        data-edit="${escapeHTML(section.id)}">
                        Edit
                    </button>

                    <button
                        type="button"
                        class="btn danger"
                        data-delete="${escapeHTML(section.id)}">
                        Delete
                    </button>

                </td>

            </tr>
        `;

    }).join("");


    table.querySelectorAll("[data-edit]").forEach(button => {

        button.addEventListener("click", () => {
            editSection(button.dataset.edit);
        });

    });


    table.querySelectorAll("[data-delete]").forEach(button => {

        button.addEventListener("click", () => {
            removeSection(button.dataset.delete);
        });

    });
}


// ======================================================
// VALIDATE STUDENTS BEFORE SAVING
// ======================================================

function validateStudents(studentIds, courseValue, yearValue, sectionId) {

    for (const studentId of studentIds) {

        const student = students.find(
            item => item.id === studentId
        );

        if (!student) {
            throw new Error(
                "A selected student could not be found. Refresh and try again."
            );
        }

        // Validate course.
        if (
            student.course &&
            String(student.course).trim().toLowerCase() !==
            courseValue.toLowerCase()
        ) {
            throw new Error(
                `${student.fullname || student.email} belongs to ${student.course}, not ${courseValue}.`
            );
        }

        // Validate year level.
        if (
            student.yearLevel &&
            normalizeYearLevel(student.yearLevel) !==
            normalizeYearLevel(yearValue)
        ) {
            throw new Error(
                `${student.fullname || student.email} belongs to year ${student.yearLevel}, not year ${yearValue}.`
            );
        }

        // Prevent accidental transfer from another section.
        if (
            student.sectionId &&
            student.sectionId !== sectionId
        ) {

            const otherSection = sections.find(
                section => section.id === student.sectionId
            );

            if (otherSection) {
                throw new Error(
                    `${student.fullname || student.email} is already assigned to ${otherSection.sectionName}. Remove the student from that section first.`
                );
            }
        }
    }
}


// ======================================================
// FIRESTORE BATCH HELPER
// Maximum 450 operations per batch
// ======================================================

async function commitOperations(operations) {

    const CHUNK_SIZE = 450;

    for (
        let start = 0;
        start < operations.length;
        start += CHUNK_SIZE
    ) {

        const chunk = operations.slice(
            start,
            start + CHUNK_SIZE
        );

        const batch = writeBatch(db);

        chunk.forEach(operation => {
            operation(batch);
        });

        await batch.commit();
    }
}


// ======================================================
// CREATE / UPDATE SECTION + BATCH STUDENT ASSIGNMENT
// ======================================================

form.addEventListener("submit", async event => {

    event.preventDefault();

    if (!currentAdmin) return;

    clearMessage();

    const name = sectionName.value.trim();
    const courseValue = course.value.trim();

    const yearValue = normalizeYearLevel(
        yearLevel.value
    );

    if (!["1", "2", "3", "4"].includes(yearValue)) {
        showMessage("Please select a year level from 1st Year to 4th Year.");
        return;
    }

    const academicValue = academicYear.value.trim();

    const teacherId = teacherSelect.value;

    const studentIds = getSelectedStudentIds();

    if (
        !name ||
        !courseValue ||
        !yearValue ||
        !academicValue ||
        !teacherId
    ) {
        showMessage("Complete all section details and select one teacher.");
        return;
    }

    const selectedTeacher = teachers.find(
        teacher => teacher.id === teacherId
    );

    if (!selectedTeacher) {
        showMessage("Selected teacher was not found. Refresh the page.");
        return;
    }

    if (!studentIds.length) {
        showMessage("Select at least one student for this section.");
        return;
    }

    // Prevent duplicate section names for the same course/year/AY.
    const duplicateSection = sections.find(section => {

        return (
            section.id !== editingId &&
            String(section.sectionName || "").trim().toLowerCase() === name.toLowerCase() &&
            String(section.course || "").trim().toLowerCase() === courseValue.toLowerCase() &&
            normalizeYearLevel(section.yearLevel) === yearValue &&
            String(section.academicYear || "").trim() === academicValue
        );

    });

    if (duplicateSection) {
        showMessage(
            "This section already exists for the selected course, year, and academic year."
        );
        return;
    }

    try {

        // Validate every student before changing Firestore.
        validateStudents(
            studentIds,
            courseValue,
            yearValue,
            editingId
        );

    } catch (error) {

        showMessage(error.message);
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Processing batch...";

    try {

        // ==============================================
        // SAVE SECTION
        // ==============================================

        const sectionData = {

            sectionName: name,

            course: courseValue,

            yearLevel: yearValue,

            academicYear: academicValue,

            // Store both fields for compatibility.
            teacherId: teacherId,

            teacherIds: [teacherId],

            updatedAt: serverTimestamp()

        };

        let sectionId = editingId;

        if (editingId) {

            await updateDoc(
                doc(db, "sections", editingId),
                sectionData
            );

        } else {

            const created = await addDoc(
                collection(db, "sections"),
                {
                    ...sectionData,
                    createdAt: serverTimestamp(),
                    createdBy: currentAdmin.uid
                }
            );

            sectionId = created.id;
        }


        // ==============================================
        // PREPARE STUDENT UPDATES
        // ==============================================

        const operations = [];

        const selectedSet = new Set(studentIds);

        // Unassign students removed during editing.
        const previouslyAssigned = students.filter(
            student => student.sectionId === sectionId
        );

        previouslyAssigned.forEach(student => {

            if (!selectedSet.has(student.id)) {

                operations.push(batch => {

                    batch.update(
                        doc(db, "users", student.id),
                        {
                            sectionId: "",
                            section: "",
                            academicYear: "",
                            cohort: "",
                            academicProfileStatus: "pending_verification",
                            academicProfileVerified: false,
                            profileUpdatedAt: serverTimestamp()
                        }
                    );

                });

            }
        });


        // Batch assign selected students.
        studentIds.forEach(studentId => {

            const student = students.find(
                item => item.id === studentId
            );

            if (!student) return;

            operations.push(batch => {

                batch.update(
                    doc(db, "users", studentId),
                    {

                        sectionId: sectionId,

                        section: name,

                        course: student.course || courseValue,

                        // Preserve the student's original format (e.g. 4L).
                        yearLevel: student.yearLevel || yearValue,

                        cohort: academicValue,

                        academicYear: academicValue,

                        academicProfileStatus: "pending_verification",

                        academicProfileVerified: false,

                        profileUpdatedAt: serverTimestamp()

                    }
                );

            });

        });


        // ==============================================
        // COMMIT IN SAFE BATCHES
        // ==============================================

        await commitOperations(operations);


        showMessage(
            `Successfully ${editingId ? "updated" : "created"} ${name} and assigned ${studentIds.length} student(s) to ${selectedTeacher.fullname || selectedTeacher.email}.`,
            "success"
        );

        resetForm();

        await loadAll();

    } catch (error) {

        console.error("Section batch assignment error:", error);

        showMessage(
            "Unable to complete assignment: " +
            (error.message || "Unknown error")
        );

        // Reload to reflect any successful earlier writes.
        try {
            await loadAll();
        } catch (refreshError) {
            console.error("Refresh error:", refreshError);
        }

    } finally {

        saveButton.disabled = false;

        saveButton.textContent = editingId
            ? "Update Section & Students"
            : "Create Section & Assign Students";

    }

});


// ======================================================
// EDIT SECTION
// ======================================================

function editSection(id) {

    const section = sections.find(
        item => item.id === id
    );

    if (!section) return;

    editingId = id;

    sectionName.value = section.sectionName || "";

    course.value = section.course || "";

    yearLevel.value = normalizeYearLevel(
        section.yearLevel
    );

    academicYear.value = section.academicYear || "";

    const teacherId =
        section.teacherId ||
        (section.teacherIds || [])[0] ||
        "";

    const assignedStudentIds = students
        .filter(student => student.sectionId === id)
        .map(student => student.id);

    renderTeacherOptions(teacherId);

    studentSearch.value = "";
    renderStudentOptions(assignedStudentIds);

    $("formTitle").textContent = "Edit Section";

    saveButton.textContent = "Update Section & Students";

    cancelButton.hidden = false;

    clearMessage();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


// ======================================================
// DELETE SECTION
// ======================================================

async function removeSection(id) {

    const section = sections.find(
        item => item.id === id
    );

    if (!section) return;

    const assignedStudents = students.filter(
        student => student.sectionId === id
    );

    const confirmed = confirm(
        `Delete ${section.sectionName}?\n\n` +
        `${assignedStudents.length} student(s) will be unassigned.\n\n` +
        "This action cannot be undone."
    );

    if (!confirmed) return;

    try {

        const operations = assignedStudents.map(student => {

            return batch => {

                batch.update(
                    doc(db, "users", student.id),
                    {
                        sectionId: "",
                        section: "",
                        academicYear: "",
                        cohort: "",
                        academicProfileStatus: "pending_verification",
                        academicProfileVerified: false,
                        profileUpdatedAt: serverTimestamp()
                    }
                );

            };

        });

        // Commit student unassignments first.
        await commitOperations(operations);

        // Delete section after successful unassignment.
        await deleteDoc(
            doc(db, "sections", id)
        );

        alert("Section deleted successfully.");

        resetForm();

        await loadAll();

    } catch (error) {

        console.error("Delete section error:", error);

        alert(
            "Unable to delete section: " +
            (error.message || "Unknown error")
        );

        try {
            await loadAll();
        } catch (refreshError) {
            console.error(refreshError);
        }
    }
}


// ======================================================
// RESET FORM
// ======================================================

function resetForm() {

    editingId = null;

    form.reset();

    renderTeacherOptions();

    studentSearch.value = "";
    renderStudentOptions([]);

    $("formTitle").textContent = "Create New Section";

    saveButton.textContent = "Create Section & Assign Students";

    cancelButton.hidden = true;

    clearMessage();
}


cancelButton.addEventListener("click", resetForm);


// ======================================================
// STUDENT SEARCH + SELECT-ALL TOGGLE
// ======================================================

studentSearch.addEventListener("input", () => {
    // Rerender only the visible rows; selectedStudentIds remains unchanged.
    renderStudentOptions();
});

studentPickerList.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-student-id]");
    if (!checkbox || checkbox.disabled) return;

    const studentId = checkbox.dataset.studentId;

    if (checkbox.checked) {
        selectedStudentIds.add(studentId);
    } else {
        selectedStudentIds.delete(studentId);
    }

    checkbox.closest(".student-option")?.classList.toggle(
        "is-selected",
        checkbox.checked
    );

    updateSelectionSummary();
});

selectVisibleStudentsButton.addEventListener("click", () => {
    const eligibleVisible = getVisibleStudentRecords().filter(
        student => !studentIsAssignedElsewhere(student)
    );
    if (!eligibleVisible.length) return;

    const allVisibleSelected = eligibleVisible.every(
        student => selectedStudentIds.has(student.id)
    );

    if (allVisibleSelected) {
        eligibleVisible.forEach(student => selectedStudentIds.delete(student.id));
    } else {
        eligibleVisible.forEach(student => selectedStudentIds.add(student.id));
    }

    renderStudentOptions();
});
