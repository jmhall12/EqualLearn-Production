import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


const form = document.getElementById("studentProfileForm");
const message = document.getElementById("profileMessage");
const saveButton = document.getElementById("saveProfile");

const fields = {
  name: document.getElementById("profileName"),
  email: document.getElementById("profileEmail"),
  studentNumber: document.getElementById("profileStudentNumber"),
  course: document.getElementById("profileCourse"),
  yearLevel: document.getElementById("profileYear"),
  section: document.getElementById("profileSection"),
  cohort: document.getElementById("profileCohort")
};

let currentUser = null;


function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `profile-message ${type}`.trim();
}


function fieldValue(field) {
  return String(field?.value || "").trim();
}


function setFormEnabled(enabled) {
  [
    fields.studentNumber,
    fields.course,
    fields.yearLevel,
    fields.section,
    fields.cohort,
    saveButton
  ].forEach(element => {
    if (element) element.disabled = !enabled;
  });
}


// ==========================================
// LOAD AUTHENTICATED STUDENT
// ==========================================

onAuthStateChanged(auth, async user => {

  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  currentUser = user;

  try {

    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      showMessage(
        "Student profile not found. Please contact your administrator.",
        "error"
      );

      setFormEnabled(false);
      return;
    }

    const data = snapshot.data();

    if (String(data.role || "").toLowerCase() !== "student") {
      window.location.replace("../login.html");
      return;
    }

    // Authenticated identity
    fields.name.value =
      data.fullname || user.displayName || "";

    fields.email.value =
      data.email || user.email || "";

    // Academic information
    fields.studentNumber.value =
      data.studentNumber || "";

    fields.course.value =
      data.course || "";

    const year = String(data.yearLevel || "")
      .replace(/\D/g, "");

    fields.yearLevel.value =
      ["1", "2", "3", "4", "5"].includes(year) ? year : "";

    fields.section.value =
      data.section ||
      data.sectionName ||
      data.className ||
      "";

    fields.cohort.value =
      data.cohort ||
      data.academicYear ||
      data.cohortId ||
      "";

    const complete = Boolean(
      fields.studentNumber.value &&
      fields.course.value &&
      fields.yearLevel.value
    );

    showMessage(
      complete
        ? "Your academic profile is saved. Verification may still be required."
        : "Please complete your Student ID, Course, and Year Level."
    );

    setFormEnabled(true);

  } catch (error) {

    console.error("Profile loading error:", error);

    showMessage(
      "Unable to load your profile. Please refresh the page.",
      "error"
    );

    setFormEnabled(false);
  }

});


// ==========================================
// SAVE STUDENT PROFILE
// ==========================================

form?.addEventListener("submit", async event => {

  event.preventDefault();

  if (!currentUser) return;

  const studentNumber = fieldValue(fields.studentNumber);
  const course = fieldValue(fields.course);
  const yearLevel = fieldValue(fields.yearLevel);
  const section = fieldValue(fields.section);
  const cohort = fieldValue(fields.cohort);

  if (!studentNumber || !course || !yearLevel) {
    showMessage(
      "Student ID, Course, and Year Level are required.",
      "error"
    );
    return;
  }

  if (!["1", "2", "3", "4", "5"].includes(yearLevel)) {
    showMessage("Please select a valid year level.", "error");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  showMessage("Saving your academic information...");

  try {

    const userRef = doc(db, "users", currentUser.uid);

    // Re-check the current account before writing.
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      throw new Error("Student account not found.");
    }

    const existing = snapshot.data();

    if (String(existing.role || "").toLowerCase() !== "student") {
      throw new Error("Only student accounts can update this profile.");
    }

    const academicChanged =
      String(existing.studentNumber || "") !== studentNumber ||
      String(existing.course || "") !== course ||
      String(existing.yearLevel || "") !== yearLevel;

    const updates = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort,

      profileCompleted: true,
      profileUpdatedAt: serverTimestamp()
    };

    // Changes require verification again.
    if (academicChanged) {
      updates.academicProfileStatus = "pending_verification";
      updates.academicProfileVerified = false;
    }

    // Does not change UID, role, or authenticated email.
    await updateDoc(userRef, updates);

    showMessage(
      academicChanged
        ? "Profile saved! Your academic details are pending verification."
        : "Your profile has been saved successfully.",
      "success"
    );

  } catch (error) {

    console.error("Profile save error:", error);

    if (error.code === "permission-denied") {
      showMessage(
        "Firestore denied this update. Your security rules must allow students to update only their own approved profile fields.",
        "error"
      );
    } else {
      showMessage(
        error.message || "Unable to save your profile.",
        "error"
      );
    }

  } finally {

    saveButton.disabled = false;
    saveButton.textContent = "Save Profile";

  }

});