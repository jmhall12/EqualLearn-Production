
import { db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

let allStudents = [];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function isProfileComplete(student) {
  return Boolean(
    student.profileCompleted &&
    student.studentNumber &&
    student.course &&
    student.yearLevel
  );
}

function updateStatistics(students) {
  const totalElement = document.getElementById("totalStudents");
  const completedElement = document.getElementById("completedProfiles");
  const pendingElement = document.getElementById("pendingProfiles");

  const total = students.length;
  const completed = students.filter(isProfileComplete).length;
  const pending = students.filter(
    student => student.academicProfileVerified !== true
  ).length;

  if (totalElement) totalElement.textContent = total.toLocaleString("en-PH");
  if (completedElement) completedElement.textContent = completed.toLocaleString("en-PH");
  if (pendingElement) pendingElement.textContent = pending.toLocaleString("en-PH");
}

function getInitials(name) {
  return String(name || "Student")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");
}

function renderStudents() {
  const container = document.getElementById("teacherStudentCards");
  const searchInput = document.getElementById("studentSearch");
  const verificationFilter = document.getElementById("verificationFilter");

  if (!container) return;

  const searchTerm = (searchInput?.value || "").trim().toLowerCase();
  const filter = verificationFilter?.value || "all";

  let filteredStudents = allStudents.filter(student => {
    const complete = isProfileComplete(student);
    const verified = student.academicProfileVerified === true;

    if (filter === "verified" && !verified) return false;
    if (filter === "pending" && verified) return false;
    if (filter === "incomplete" && complete) return false;

    const searchableText = [
      student.fullname,
      student.email,
      student.studentNumber,
      student.course,
      student.section,
      student.sectionName,
      student.className,
      student.yearLevel,
      student.cohort,
      student.academicYear
    ].join(" ").toLowerCase();

    return searchableText.includes(searchTerm);
  });

  filteredStudents.sort((a, b) =>
    String(a.fullname || "").localeCompare(String(b.fullname || ""))
  );

  container.replaceChildren();

  if (!filteredStudents.length) {
    const empty = document.createElement("div");
    empty.className = "directory-empty";
    empty.textContent = allStudents.length
      ? "No students match your search or selected filter."
      : "No students are enrolled in your assigned sections yet.";

    container.appendChild(empty);
    return;
  }

  filteredStudents.forEach(student => {
    const name = escapeHTML(student.fullname || "Student");
    const email = escapeHTML(student.email || "No email provided");
    const course = escapeHTML(student.course || "Not provided");

    const year = escapeHTML(
      student.yearLevel
        ? `${student.yearLevel}${
            String(student.yearLevel).match(/\D/) ? "" : " Year"
          }`
        : "Not provided"
    );

    const studentID = escapeHTML(student.studentNumber || "Not provided");

    const section = escapeHTML(
      student.section ||
      student.sectionName ||
      student.className ||
      "Not provided"
    );

    const academicYear = escapeHTML(
      student.cohort ||
      student.academicYear ||
      student.cohortId ||
      "Not provided"
    );

    const complete = isProfileComplete(student);
    const verified = student.academicProfileVerified === true;

    const card = document.createElement("article");
    card.className = "el-card";

    card.innerHTML = `
      <div class="student-avatar">
        ${escapeHTML(getInitials(student.fullname))}
      </div>

      <div style="
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:10px;
        flex-wrap:wrap;
      ">
        <h3 class="student-card-name">${name}</h3>

        <span class="student-verification ${verified ? "verified" : "pending"}">
          ${verified ? "✓ Verified" : "◷ Pending verification"}
        </span>
      </div>

      <div class="student-card-email">${email}</div>

      <div class="student-card-details">
        <div>
          <span class="student-detail-label">Course</span>
          <strong class="student-detail-value">${course}</strong>
        </div>

        <div>
          <span class="student-detail-label">Year Level</span>
          <strong class="student-detail-value">${year}</strong>
        </div>

        <div>
          <span class="student-detail-label">Student ID</span>
          <strong class="student-detail-value">${studentID}</strong>
        </div>

        <div>
          <span class="student-detail-label">Section</span>
          <strong class="student-detail-value">${section}</strong>
        </div>

        <div style="grid-column:1/-1">
          <span class="student-detail-label">Academic Year</span>
          <strong class="student-detail-value">${academicYear}</strong>
        </div>
      </div>

      <div class="student-card-footer">
        <span class="student-profile-state">
          ${complete ? "✓ Profile completed" : "⚠ Profile incomplete"}
        </span>
      </div>
    `;

    container.appendChild(card);
  });
}

requireRole("teacher", async (teacherProfile) => {
  const container = document.getElementById("teacherStudentCards");

  if (!container) return;

  container.innerHTML = `
    <div class="directory-empty">Loading student records...</div>
  `;

  // Reset counters while loading.
  updateStatistics([]);

  try {
    const teacherUid = teacherProfile.uid;

    if (!teacherUid) {
      throw new Error("Teacher account UID is missing.");
    }

    // Find sections assigned to this teacher.
    const sectionsRef = collection(db, "sections");

    const [primarySections, multipleSections] = await Promise.all([
      getDocs(query(
        sectionsRef,
        where("teacherId", "==", teacherUid)
      )),

      getDocs(query(
        sectionsRef,
        where("teacherIds", "array-contains", teacherUid)
      ))
    ]);

    const sectionMap = new Map();

    [...primarySections.docs, ...multipleSections.docs].forEach(section => {
      sectionMap.set(section.id, section.data());
    });

    const sectionIds = [...sectionMap.keys()];

    if (!sectionIds.length) {
      allStudents = [];
      updateStatistics([]);
      renderStudents();
      return;
    }

    // Load students only from the teacher's assigned sections.
    const studentResults = await Promise.all(
      sectionIds.map(sectionId =>
        getDocs(query(
          collection(db, "users"),
          where("role", "==", "student"),
          where("sectionId", "==", sectionId)
        ))
      )
    );

    const studentMap = new Map();

    studentResults.forEach(snapshot => {
      snapshot.docs.forEach(item => {
        studentMap.set(item.id, {
          ...item.data(),
          uid: item.id
        });
      });
    });

    allStudents = [...studentMap.values()];

    // Update the three dashboard statistics.
    updateStatistics(allStudents);

    // Render the directory.
    renderStudents();

    // Connect search and filter controls.
    const searchInput = document.getElementById("studentSearch");
    const verificationFilter = document.getElementById("verificationFilter");

    if (searchInput) {
      searchInput.addEventListener("input", renderStudents);
    }

    if (verificationFilter) {
      verificationFilter.addEventListener("change", renderStudents);
    }

  } catch (error) {
    console.error("Teacher student loading error:", error);

    container.innerHTML = `
      <div class="directory-empty">
        <strong>Unable to load student records.</strong>
        <p>${escapeHTML(error.message)}</p>
        <small>${escapeHTML(error.code || "")}</small>
      </div>
    `;
  }
});
