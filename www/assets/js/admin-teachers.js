import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  getDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   ELEMENTS
   These IDs connect JavaScript to elements in manage-teachers.html.
========================================================= */
const teacherList = document.getElementById("teacherList");
const modal = document.getElementById("teacherModal");
const departmentInput = document.getElementById("department");
const teacherEditIdentity = document.getElementById("teacherEditIdentity");
const saveTeacherButton = document.getElementById("saveTeacher");
const cancelButton = document.getElementById("cancel");
const closeModalButton = document.getElementById("closeTeacherModal");

let editingId = null;
let editingTeacherName = "";

/* =========================================================
   ADMIN AUTHENTICATION
   Only authenticated administrator profiles can load this page.
========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  try {
    const adminSnapshot = await getDoc(doc(db, "users", user.uid));

    if (!adminSnapshot.exists()) {
      alert("Admin profile not found.");
      await signOut(auth);
      window.location.replace("../login.html");
      return;
    }

    const adminData = adminSnapshot.data();
    if (String(adminData.role || "").toLowerCase() !== "admin") {
      alert("Access denied. Admins only.");
      window.location.replace("../login.html");
      return;
    }

    await loadTeachers();
  } catch (error) {
    console.error("Admin authentication error:", error);
    showTeacherState("Unable to verify administrator. Please refresh the page.", true);
  }
});

/* =========================================================
   LOAD TEACHERS
   Reads teacher profiles from the existing users collection.
========================================================= */
async function loadTeachers() {
  showTeacherState("Loading teacher accounts...");

  try {
    const teacherQuery = query(
      collection(db, "users"),
      where("role", "==", "teacher")
    );

    const snapshot = await getDocs(teacherQuery);
    teacherList.replaceChildren();

    if (snapshot.empty) {
      showTeacherState("No teachers have been registered yet.");
      return;
    }

    const teachers = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    teachers.sort((a, b) => getTeacherName(a).localeCompare(getTeacherName(b)));

    const fragment = document.createDocumentFragment();
    teachers.forEach((teacher) => fragment.appendChild(createTeacherRow(teacher)));
    teacherList.appendChild(fragment);
  } catch (error) {
    console.error("Load teachers error:", error);
    showTeacherState("Failed to load teachers. Check the console for details.", true);
  }
}

/* =========================================================
   CREATE ONE HORIZONTAL TEACHER ROW
   Uses textContent so user-provided profile data is rendered as text.
========================================================= */
function createTeacherRow(teacher) {
  const name = getTeacherName(teacher);
  const email = String(teacher.email || "No email address");
  const department = String(teacher.department || "Department not set");
  const status = String(teacher.status || "inactive").toLowerCase();

  const row = document.createElement("article");
  row.className = "teacher-row";

  const avatar = document.createElement("div");
  avatar.className = "teacher-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = getInitials(name);

  const main = document.createElement("div");
  main.className = "teacher-main";

  const heading = document.createElement("h3");
  heading.textContent = name;

  const emailText = document.createElement("p");
  emailText.textContent = email;
  emailText.title = email;

  main.append(heading, emailText);

  const departmentBlock = document.createElement("div");
  departmentBlock.className = "teacher-department";

  const departmentLabel = document.createElement("span");
  departmentLabel.className = "teacher-department-label";
  departmentLabel.textContent = "Department";

  const departmentText = document.createElement("span");
  departmentText.className = "teacher-department-value";
  departmentText.textContent = department;
  departmentText.title = department;

  departmentBlock.append(departmentLabel, departmentText);

  const statusBadge = document.createElement("span");
  statusBadge.className = `teacher-status ${status === "active" ? "is-active" : "is-inactive"}`;
  statusBadge.textContent = status;

  const actions = document.createElement("div");
  actions.className = "teacher-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "edit-btn";
  editButton.dataset.action = "edit";
  editButton.dataset.id = teacher.id;
  editButton.textContent = "Edit";
  editButton.setAttribute("aria-label", `Edit ${name}`);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-btn";
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.id = teacher.id;
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", `Delete ${name}`);

  actions.append(editButton, deleteButton);
  row.append(avatar, main, departmentBlock, statusBadge, actions);
  return row;
}

function getTeacherName(teacher) {
  const candidates = [teacher.fullname, teacher.fullName, teacher.name];
  const name = candidates.find((value) => typeof value === "string" && value.trim());
  return String(name || "Unnamed Teacher").trim();
}

function getInitials(name) {
  const parts = String(name || "Teacher").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "T";
}

function showTeacherState(message, isError = false) {
  if (!teacherList) return;
  const state = document.createElement("div");
  state.className = `teacher-state${isError ? " is-error" : ""}`;
  state.textContent = message;
  teacherList.replaceChildren(state);
}

/* =========================================================
   TEACHER LIST ACTIONS
   Event delegation lets dynamically created rows use one listener.
========================================================= */
teacherList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action][data-id]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === "edit") openTeacherEditor(id);
  if (action === "delete") removeTeacher(id);
});

/* =========================================================
   EDIT TEACHER
   The current management form updates the department only.
========================================================= */
async function openTeacherEditor(id) {
  try {
    const teacherSnapshot = await getDoc(doc(db, "users", id));

    if (!teacherSnapshot.exists()) {
      alert("Teacher not found.");
      await loadTeachers();
      return;
    }

    const teacher = teacherSnapshot.data();
    editingId = id;
    editingTeacherName = getTeacherName(teacher);
    teacherEditIdentity.textContent = `${editingTeacherName} · ${teacher.email || "No email address"}`;
    departmentInput.value = teacher.department || "";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    departmentInput.focus();
  } catch (error) {
    console.error("Edit teacher error:", error);
    alert("Failed to load teacher information: " + (error.message || "Unknown error"));
  }
}

function closeTeacherEditor() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  editingId = null;
  editingTeacherName = "";
  departmentInput.value = "";
}

cancelButton.addEventListener("click", closeTeacherEditor);
closeModalButton.addEventListener("click", closeTeacherEditor);
modal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closeTeacherEditor();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("show")) closeTeacherEditor();
});

saveTeacherButton.addEventListener("click", async () => {
  if (!editingId) return;

  const departmentValue = departmentInput.value.trim();
  if (!departmentValue) {
    alert("Department is required.");
    departmentInput.focus();
    return;
  }

  saveTeacherButton.disabled = true;
  saveTeacherButton.textContent = "Saving...";

  try {
    await updateDoc(doc(db, "users", editingId), {
      department: departmentValue,
      updatedAt: serverTimestamp()
    });

    closeTeacherEditor();
    await loadTeachers();
  } catch (error) {
    console.error("Update teacher error:", error);
    alert("Failed to update teacher: " + (error.message || "Unknown error"));
  } finally {
    saveTeacherButton.disabled = false;
    saveTeacherButton.textContent = "Save changes";
  }
});

/* =========================================================
   DELETE TEACHER PROFILE
   This retains the existing behavior: removes the Firestore user profile.
========================================================= */
async function removeTeacher(id) {
  const confirmed = confirm(
    "Remove this teacher's EqualLearn profile?\n\nThis action deletes the Firestore profile record."
  );
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "users", id));
    await loadTeachers();
  } catch (error) {
    console.error("Delete teacher error:", error);
    alert("Failed to remove teacher: " + (error.message || "Unknown error"));
  }
}
