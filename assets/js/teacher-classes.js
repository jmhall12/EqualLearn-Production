
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

let currentTeacher = null;
let assignedSections = [];
let currentStudents = [];

const classesView = $("classesView");
const studentsView = $("studentsView");
const sectionsGrid = $("sectionsGrid");
const studentsTable = $("studentsTable");
const studentSearch = $("studentSearch");

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));

    if (
      !profileSnap.exists() ||
      !["teacher", "admin"].includes(profileSnap.data().role)
    ) {
      alert("Access denied. Teacher account required.");
      location.href = "../login.html";
      return;
    }

    currentTeacher = {
      uid: user.uid,
      role: profileSnap.data().role
    };

    await loadAssignedSections();
  } catch (error) {
    console.error("Teacher authentication error:", error);
    sectionsGrid.innerHTML = `<div class="empty">Unable to load your classes.</div>`;
  }
});

async function loadAssignedSections() {
  sectionsGrid.innerHTML = `<div class="empty">Loading sections...</div>`;

  let sectionQuery;

  if (currentTeacher.role === "admin") {
    // Admin preview: all sections.
    sectionQuery = collection(db, "sections");
  } else {
    sectionQuery = query(
      collection(db, "sections"),
      where("teacherIds", "array-contains", currentTeacher.uid)
    );
  }

  const snapshot = await getDocs(sectionQuery);

  assignedSections = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  assignedSections.sort((a, b) =>
    String(a.sectionName || "").localeCompare(String(b.sectionName || ""))
  );

  if (!assignedSections.length) {
    sectionsGrid.innerHTML = `
      <div class="empty">
        No sections assigned to your account yet.<br><br>
        Please contact the administrator.
      </div>
    `;
    return;
  }

  // Load student counts for each section.
  const countResults = await Promise.all(
    assignedSections.map(async section => {
      const studentQuery = query(
        collection(db, "users"),
        where("role", "==", "student"),
        where("sectionId", "==", section.id)
      );

      const studentSnapshot = await getDocs(studentQuery);
      return { id: section.id, count: studentSnapshot.size };
    })
  );

  const counts = Object.fromEntries(
    countResults.map(item => [item.id, item.count])
  );

  sectionsGrid.innerHTML = assignedSections.map(section => `
    <article class="section-card" data-section-id="${escapeHTML(section.id)}">
      <span class="pill">${escapeHTML(section.course || "Course")}</span>
      <h2>${escapeHTML(section.sectionName || "Unnamed Section")}</h2>
      <div class="muted">${escapeHTML(formatYear(section.yearLevel))} Year</div>
      <div class="muted">Academic Year: ${escapeHTML(section.academicYear || "—")}</div>
      <div class="count">${counts[section.id] ?? 0}</div>
      <div class="muted">Students</div>
    </article>
  `).join("");

  sectionsGrid.querySelectorAll("[data-section-id]").forEach(card => {
    card.addEventListener("click", () => {
      openSection(card.dataset.sectionId);
    });
  });
}

async function openSection(sectionId) {
  const section = assignedSections.find(item => item.id === sectionId);
  if (!section) return;

  classesView.hidden = true;
  studentsView.hidden = false;

  $("selectedSectionName").textContent = section.sectionName || "Section";
  $("selectedSectionInfo").textContent =
    `${section.course || ""} • ${formatYear(section.yearLevel)} Year • Academic Year ${section.academicYear || "—"}`;

  $("sectionStudentCount").textContent = "Loading...";
  studentsTable.innerHTML = `<tr><td colspan="7" class="empty">Loading students...</td></tr>`;
  studentSearch.value = "";

  try {
    const studentQuery = query(
      collection(db, "users"),
      where("role", "==", "student"),
      where("sectionId", "==", section.id)
    );

    const snapshot = await getDocs(studentQuery);

    currentStudents = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    currentStudents.sort((a, b) =>
      String(a.fullname || "").localeCompare(String(b.fullname || ""))
    );

    $("sectionStudentCount").textContent = currentStudents.length;
    renderStudents(currentStudents);
  } catch (error) {
    console.error("Load section students error:", error);
    $("sectionStudentCount").textContent = "—";
    studentsTable.innerHTML = `
      <tr><td colspan="7" class="empty">
        Unable to load students. Check your Firestore rules and indexes.
      </td></tr>
    `;
  }
}

function renderStudents(list) {
  if (!list.length) {
    studentsTable.innerHTML = `
      <tr><td colspan="7" class="empty">
        No students assigned to this section yet.
      </td></tr>
    `;
    return;
  }

  studentsTable.innerHTML = list.map(student => `
    <tr>
      <td>${escapeHTML(student.studentNumber || "—")}</td>
      <td><strong>${escapeHTML(student.fullname || "Unnamed Student")}</strong></td>
      <td>${escapeHTML(student.email || "—")}</td>
      <td>${escapeHTML(student.course || "—")}</td>
      <td>${escapeHTML(formatYear(student.yearLevel))}</td>
      <td>${escapeHTML(student.section || "—")}</td>
      <td>
        <span class="pill">
          ${escapeHTML(student.schoolStatus || student.status || "active")}
        </span>
      </td>
    </tr>
  `).join("");
}

studentSearch.addEventListener("input", () => {
  const term = studentSearch.value.trim().toLowerCase();

  const filtered = currentStudents.filter(student => {
    const searchable = [
      student.fullname,
      student.studentNumber,
      student.email,
      student.course,
      student.yearLevel,
      student.section
    ].join(" ").toLowerCase();

    return searchable.includes(term);
  });

  renderStudents(filtered);
});

$("backToClasses").addEventListener("click", () => {
  studentsView.hidden = true;
  classesView.hidden = false;
  currentStudents = [];
});

function formatYear(value) {
  const labels = {
    "1": "1st",
    "2": "2nd",
    "3": "3rd",
    "4": "4th",
    "5": "5th"
  };

  return labels[String(value)] || String(value || "—");
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
