
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
const courseFilter = $("studentCourseFilter");
const yearFilter = $("studentYearFilter");
const academicYearFilter = $("studentAcademicYearFilter");
const studentOptionsList = $("studentOptionsList");
const selectedStudentsList = $("selectedStudentsList");
const eligibleStudentCount = $("eligibleStudentCount");
const checkedStudentCount = $("checkedStudentCount");
const addSelectedButton = $("addSelectedStudents");
const selectVisibleButton = $("selectVisibleStudents");
const clearCurrentSelectionButton = $("clearCurrentSelection");

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
let stagedStudentIds = new Set();
let checkedStudentIds = new Set();
let visibleStudentIds = [];
let pendingDraftTeacherId = "";


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
        "4TH YEAR": "4",
        "FIFTH YEAR": "5",
        "5TH YEAR": "5"
    };

    if (words[year]) return words[year];

    const match = year.match(/[1-5]/);

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
    return [...stagedStudentIds];
}

function studentName(student) {
    return String(student.fullname || student.displayName || student.email || "Unnamed Student");
}

// Read the photo fields used by Google sign-in and EqualLearn profile uploads.
function getStudentPhotoURL(student) {
    if (!student) return "";

    const candidates = [
        student.photoURL,
        student.googlePhotoURL,
        student.googleProfilePhoto,
        student.authPhotoURL,
        student.profileImage
    ];

    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
            return value;
        }
    }

    const legacyBase64 = String(student.profileImageBase64 || "").trim();
    if (/^data:image\//i.test(legacyBase64)) return legacyBase64;
    if (legacyBase64 && /^[A-Za-z0-9+/=\s]+$/.test(legacyBase64)) {
        return `data:${student.profileImageMime || "image/jpeg"};base64,${legacyBase64}`;
    }

    return "";
}

function studentInitials(student) {
    return studentName(student)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "S";
}

function createStudentAvatar(student, sizeClass = "student-option-avatar") {
    const avatar = document.createElement("span");
    avatar.className = sizeClass;
    avatar.setAttribute("aria-label", `${studentName(student)} profile picture`);

    const fallback = document.createElement("span");
    fallback.className = "student-avatar-fallback";
    fallback.textContent = studentInitials(student);
    avatar.appendChild(fallback);

    const photoURL = getStudentPhotoURL(student);
    if (photoURL) {
        const image = document.createElement("img");
        image.src = photoURL;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove(), { once: true });
        avatar.appendChild(image);
    }

    return avatar;
}

function studentCourseValue(student) {
    return String(student.course || student.program || "").trim();
}

function studentYearValue(student) {
    return String(student.yearLevel || student.year || "").trim();
}

function studentAcademicYearValue(student) {
    return String(student.academicYear || student.cohort || student.cohortId || "").trim();
}

function normalized(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Prefer the official sectionId. For older records, detect a legacy
// section name that exactly matches an existing section's metadata.
function getStudentSectionId(student) {
    if (student.sectionId) return String(student.sectionId);

    const legacyName = normalized(
        student.section || student.sectionName || student.className || ""
    );
    if (!legacyName) return "";

    const match = sections.find(section => {
        const sameName = normalized(section.sectionName || section.section || section.name) === legacyName;
        const sameCourse = !student.course || !section.course || normalized(student.course) === normalized(section.course);
        const sameYear = !student.yearLevel || !section.yearLevel || normalizeYearLevel(student.yearLevel) === normalizeYearLevel(section.yearLevel);
        const studentAY = studentAcademicYearValue(student);
        const sameAY = !studentAY || !section.academicYear || normalized(studentAY) === normalized(section.academicYear);
        return sameName && sameCourse && sameYear && sameAY;
    });

    return match?.id || "";
}

function isSelectableStudent(student) {
    const status = normalized(student.status);
    if (status && status !== "active") return false;

    const assignedSectionId = getStudentSectionId(student);
    return !assignedSectionId || assignedSectionId === editingId || stagedStudentIds.has(student.id);
}

function getEligibleStudents() {
    return students.filter(isSelectableStudent);
}

function draftStorageKey() {
    const adminId = currentAdmin?.uid || "unknown-admin";
    return `equallearn-section-draft:${adminId}:${editingId || "new"}`;
}

function persistDraftSelection() {
    if (!currentAdmin) return;
    try {
        const draft = {
            studentIds: [...stagedStudentIds],
            sectionName: sectionName?.value || "",
            course: course?.value || "",
            yearLevel: yearLevel?.value || "",
            academicYear: academicYear?.value || "",
            teacherId: teacherSelect?.value || "",
            search: studentSearch?.value || ""
        };
        sessionStorage.setItem(draftStorageKey(), JSON.stringify(draft));
    } catch (error) {
        console.warn("Unable to persist section draft selection:", error);
    }
}

function restoreDraftSelection() {
    if (!currentAdmin) return;
    try {
        const saved = JSON.parse(sessionStorage.getItem(draftStorageKey()) || "null");
        if (!saved) return;

        // Older draft versions stored only an array of selected student UIDs.
        const savedIds = Array.isArray(saved) ? saved : saved.studentIds;
        if (!Array.isArray(savedIds)) return;

        if (!editingId && !Array.isArray(saved)) {
            if (sectionName && saved.sectionName) sectionName.value = saved.sectionName;
            if (course && saved.course) course.value = saved.course;
            if (yearLevel && saved.yearLevel) yearLevel.value = saved.yearLevel;
            if (academicYear && saved.academicYear) academicYear.value = saved.academicYear;
            if (studentSearch && typeof saved.search === "string") studentSearch.value = saved.search;
        }

        const eligibleIds = new Set(getEligibleStudents().map(student => student.id));
        stagedStudentIds = new Set(savedIds.filter(id => eligibleIds.has(id)));
        if (!editingId && !Array.isArray(saved) && teacherSelect && saved.teacherId) {
            // Teacher options are rendered after draft restoration; the value
            // is applied after the options exist in loadAll().
            pendingDraftTeacherId = saved.teacherId;
        }
    } catch (error) {
        console.warn("Unable to restore section draft selection:", error);
        stagedStudentIds = new Set();
    }
}

function setFilterOptions(select, values, allLabel) {
    if (!select) return;
    const current = select.value || "all";
    const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const hasEmpty = values.some(value => !String(value || "").trim());

    select.replaceChildren(new Option(allLabel, "all"));
    if (hasEmpty) select.add(new Option("Not specified", "__empty__"));
    unique.forEach(value => select.add(new Option(value, value)));

    const exists = [...select.options].some(option => option.value === current);
    select.value = exists ? current : "all";
}

function matchesFilter(value, filterValue) {
    const actual = String(value || "").trim();
    if (filterValue === "all") return true;
    if (filterValue === "__empty__") return !actual;
    return normalized(actual) === normalized(filterValue);
}

function getFilteredStudents() {
    const queryText = normalized(studentSearch?.value || "");
    return getEligibleStudents().filter(student => {
        const searchable = [
            studentName(student), student.email, student.studentNumber,
            studentCourseValue(student), studentYearValue(student),
            studentAcademicYearValue(student), student.section
        ].map(normalized).join(" ");

        return (!queryText || searchable.includes(queryText)) &&
            matchesFilter(studentCourseValue(student), courseFilter?.value || "all") &&
            matchesFilter(studentYearValue(student), yearFilter?.value || "all") &&
            matchesFilter(studentAcademicYearValue(student), academicYearFilter?.value || "all");
    });
}

function updateSelectionSummary() {
    const stagedCount = stagedStudentIds.size;
    const checkedCount = checkedStudentIds.size;

    if (selectionSummary) {
        selectionSummary.textContent = `${stagedCount} student${stagedCount === 1 ? "" : "s"} saved`;
    }
    if (checkedStudentCount) {
        checkedStudentCount.textContent = `${checkedCount} checked`;
    }
    if (addSelectedButton) {
        addSelectedButton.disabled = checkedCount === 0;
        addSelectedButton.textContent = checkedCount
            ? `Save ${checkedCount} Selected Student${checkedCount === 1 ? "" : "s"}`
            : "Save Selected Students";
    }
}

function renderStudentBasket() {
    if (!selectedStudentsList) return;
    const staged = [...stagedStudentIds]
        .map(id => students.find(student => student.id === id))
        .filter(Boolean);

    selectedStudentsList.replaceChildren();
    if (!staged.length) {
        const empty = document.createElement("div");
        empty.className = "student-basket-empty";
        empty.textContent = "No students added yet. Use the filters above to choose students.";
        selectedStudentsList.appendChild(empty);
        return;
    }

    staged.sort((a, b) => studentName(a).localeCompare(studentName(b)));
    staged.forEach(student => {
        const row = document.createElement("div");
        row.className = "student-basket-row";

        const identity = document.createElement("div");
        identity.className = "student-basket-identity";
        identity.appendChild(createStudentAvatar(student, "student-basket-avatar"));

        const label = document.createElement("span");
        label.className = "student-basket-name";
        label.textContent = `${studentName(student)}${student.studentNumber ? ` · ${student.studentNumber}` : ""}`;
        identity.appendChild(label);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${studentName(student)} from this section draft`);
        remove.addEventListener("click", () => {
            stagedStudentIds.delete(student.id);
            checkedStudentIds.delete(student.id);
            persistDraftSelection();
            renderStudentOptions();
        });

        row.append(identity, remove);
        selectedStudentsList.appendChild(row);
    });
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

    if (editingId) {
        stagedStudentIds = new Set(students
            .filter(student => getStudentSectionId(student) === editingId)
            .map(student => student.id));
    } else {
        restoreDraftSelection();
    }

    renderTeacherOptions(editingId ? (sections.find(item => item.id === editingId)?.teacherId || "") : pendingDraftTeacherId);
    pendingDraftTeacherId = "";
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
// FILTERABLE STUDENT PICKER + STAGED SELECTION
// ======================================================

function renderStudentOptions() {
    const eligible = getEligibleStudents();

    setFilterOptions(courseFilter, eligible.map(studentCourseValue), "All courses");
    setFilterOptions(yearFilter, eligible.map(studentYearValue), "All year levels");
    setFilterOptions(academicYearFilter, eligible.map(studentAcademicYearValue), "All academic years");

    const filtered = getFilteredStudents();
    visibleStudentIds = filtered.map(student => student.id);

    if (eligibleStudentCount) {
        eligibleStudentCount.textContent = `${filtered.length} shown · ${eligible.length} available`;
    }

    if (studentOptionsList) {
        studentOptionsList.replaceChildren();

        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "student-option-empty";
            empty.textContent = eligible.length
                ? "No students match these filters. Try clearing a filter or changing your search."
                : "No unassigned active students are available. Students already assigned to a section are hidden here.";
            studentOptionsList.appendChild(empty);
        } else {
            filtered.sort((a, b) => studentName(a).localeCompare(studentName(b)));

            filtered.forEach(student => {
                const isAdded = stagedStudentIds.has(student.id);
                const row = document.createElement("label");
                row.className = `student-option${isAdded ? " is-added" : ""}`;

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = student.id;
                checkbox.checked = checkedStudentIds.has(student.id) || isAdded;
                checkbox.disabled = isAdded;
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) checkedStudentIds.add(student.id);
                    else checkedStudentIds.delete(student.id);
                    updateSelectionSummary();
                });

                const main = document.createElement("span");
                main.className = "student-option-main";
                main.appendChild(createStudentAvatar(student));

                const info = document.createElement("span");
                info.className = "student-option-info";
                const name = document.createElement("span");
                name.className = "student-option-name";
                name.textContent = studentName(student);
                const subtitle = document.createElement("span");
                subtitle.className = "student-option-sub";
                subtitle.textContent = [student.email, student.studentNumber, isAdded ? "Added to this section draft" : ""].filter(Boolean).join(" · ") || `Account ID: ${student.id}`;
                info.append(name, subtitle);
                main.appendChild(info);

                const tags = document.createElement("span");
                tags.className = "student-option-tags";
                [
                    studentCourseValue(student) || "No course",
                    studentYearValue(student) || "No year",
                    studentAcademicYearValue(student) || "No A.Y."
                ].forEach((value, index) => {
                    const tag = document.createElement("span");
                    tag.className = `student-tag${value.startsWith("No ") ? " muted-tag" : ""}`;
                    tag.textContent = value;
                    tags.appendChild(tag);
                });

                row.append(checkbox, main, tags);
                studentOptionsList.appendChild(row);
            });
        }
    }

    renderStudentBasket();
    updateSelectionSummary();
}

function addCheckedStudentsToDraft() {
    if (!checkedStudentIds.size) {
        showMessage("Select one or more available students first.");
        return;
    }

    const eligibleIds = new Set(getEligibleStudents().map(student => student.id));
    let added = 0;

    checkedStudentIds.forEach(id => {
        if (eligibleIds.has(id) && !stagedStudentIds.has(id)) {
            stagedStudentIds.add(id);
            added++;
        }
    });

    checkedStudentIds.clear();
    persistDraftSelection();
    renderStudentOptions();
    showMessage(`${added} student${added === 1 ? "" : "s"} saved to this section draft. You can change the filters and add more before creating the section.`, "success");
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
            student => getStudentSectionId(student) === section.id
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
        const assignedSectionId = getStudentSectionId(student);
        if (assignedSectionId && assignedSectionId !== sectionId) {

            const otherSection = sections.find(
                section => section.id === assignedSectionId
            );

            throw new Error(
                `${student.fullname || student.email} is already assigned to ${otherSection?.sectionName || "another section"}. Remove the student from that section first.`
            );
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

            // Safe display fields are stored on the section itself so
            // assigned students do not need permission to read teacher profiles.
            teacherName:
                selectedTeacher.fullname ||
                selectedTeacher.displayName ||
                selectedTeacher.name ||
                selectedTeacher.email ||
                "Teacher",

            assignedTeacherName:
                selectedTeacher.fullname ||
                selectedTeacher.displayName ||
                selectedTeacher.name ||
                selectedTeacher.email ||
                "Teacher",

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
            student => getStudentSectionId(student) === sectionId
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

    // Reset to the students currently belonging to this section,
    // including older records that still use a legacy section name.
    checkedStudentIds.clear();
    stagedStudentIds = new Set(students
        .filter(student => getStudentSectionId(student) === id)
        .map(student => student.id));
    persistDraftSelection();

    renderTeacherOptions(teacherId);

    renderStudentOptions();

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
        student => getStudentSectionId(student) === id
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
// STUDENT PICKER EVENTS
// ======================================================

[studentSearch, courseFilter, yearFilter, academicYearFilter].forEach(element => {
    element?.addEventListener("input", renderStudentOptions);
    element?.addEventListener("change", renderStudentOptions);
});

addSelectedButton?.addEventListener("click", addCheckedStudentsToDraft);

[sectionName, course, yearLevel, academicYear, teacherSelect].forEach(element => {
    element?.addEventListener("input", persistDraftSelection);
    element?.addEventListener("change", persistDraftSelection);
});
studentSearch?.addEventListener("input", persistDraftSelection);

selectVisibleButton?.addEventListener("click", () => {
    visibleStudentIds.forEach(id => {
        if (!stagedStudentIds.has(id)) checkedStudentIds.add(id);
    });
    renderStudentOptions();
});

clearCurrentSelectionButton?.addEventListener("click", () => {
    checkedStudentIds.clear();
    renderStudentOptions();
});


// ======================================================
// RESET FORM
// ======================================================

function resetForm() {

    const previousKey = currentAdmin ? draftStorageKey() : "";
    if (previousKey) {
        try { sessionStorage.removeItem(previousKey); } catch {}
    }

    editingId = null;
    stagedStudentIds = new Set();
    checkedStudentIds = new Set();

    form.reset();

    // Restore an unfinished new-section selection draft when cancelling an edit.
    restoreDraftSelection();
    renderTeacherOptions(pendingDraftTeacherId);
    pendingDraftTeacherId = "";
    renderStudentOptions();

    $("formTitle").textContent = "Create New Section";
    saveButton.textContent = "Create Section & Assign Students";
    cancelButton.hidden = true;

    clearMessage();
}


cancelButton.addEventListener("click", resetForm);


// ======================================================
// STUDENT SELECTION COUNT
// ======================================================


