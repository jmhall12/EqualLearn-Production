
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
let profileLoaded = false;

function showMessage(text, type = "") {
  if (!message) return;

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

function setSaving(saving) {
  if (!saveButton) return;

  saveButton.disabled = saving;
  saveButton.textContent = saving ? "Saving..." : "Save Profile";
}

// ==========================================
// LOAD AUTHENTICATED STUDENT
// ==========================================

onAuthStateChanged(auth, async user => {
  currentUser = user;
  profileLoaded = false;

  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  setFormEnabled(false);
  showMessage("Loading your academic profile...");

  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      showMessage(
        "Student profile not found. Please contact your administrator.",
        "error"
      );
      return;
    }

    const data = snapshot.data();

    if (String(data.role || "").toLowerCase() !== "student") {
      window.location.replace("../login.html");
      return;
    }

    // Authenticated identity: read-only
    if (fields.name) {
      fields.name.value = data.fullname || user.displayName || "";
    }

    if (fields.email) {
      fields.email.value = data.email || user.email || "";
    }

    // Academic information
    fields.studentNumber.value = data.studentNumber || "";
    fields.course.value = data.course || "";

    const year = String(data.yearLevel || "").replace(/\D/g, "");

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

    const verificationStatus =
      String(data.academicProfileStatus || "").toLowerCase();

    if (verificationStatus === "verified" ||
        data.academicProfileVerified === true) {
      showMessage(
        "Your academic profile is verified. Contact your administrator if you need to change your academic information."
      );
    } else if (verificationStatus === "pending_verification") {
      showMessage(
        "Your academic profile is awaiting administrator verification."
      );
    } else {
      showMessage(
        complete
          ? "Your academic profile is saved. Verification may still be required."
          : "Please complete your Student ID, Course, and Year Level."
      );
    }

    profileLoaded = true;
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

  if (!currentUser || !profileLoaded) {
    showMessage("Your profile is not ready. Please refresh the page.", "error");
    return;
  }

  const studentNumber = fieldValue(fields.studentNumber).toUpperCase();
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

  setSaving(true);
  showMessage("Saving your academic information...");

  try {
    const userRef = doc(db, "users", currentUser.uid);

    // Re-check the authenticated student's current profile.
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      throw new Error("Student account not found.");
    }

    const existing = snapshot.data();

    if (String(existing.role || "").toLowerCase() !== "student") {
      throw new Error("Only student accounts can update this profile.");
    }

    if (existing.status !== "active") {
      throw new Error("Your account is not active. Please contact the administrator.");
    }

    const academicChanged =
      String(existing.studentNumber || "") !== studentNumber ||
      String(existing.course || "") !== course ||
      String(existing.yearLevel || "") !== yearLevel;

    const sectionChanged =
      String(existing.section || "") !== section;

    const cohortChanged =
      String(existing.cohort || "") !== cohort;

    const updates = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort,
      profileCompleted: true,
      profileUpdatedAt: serverTimestamp()
    };

    // Only the pending state can be requested by the student.
    // The student cannot set their own profile to verified.
    if (academicChanged) {
      updates.academicProfileStatus = "pending_verification";
      updates.academicProfileVerified = false;
    }

    await updateDoc(userRef, updates);

    if (academicChanged) {
      showMessage(
        "Your academic information has been saved. Your changes are now pending administrator verification.",
        "success"
      );
    } else if (sectionChanged || cohortChanged) {
      showMessage(
        "Your profile has been saved successfully.",
        "success"
      );
    } else {
      showMessage(
        "Your profile has been saved successfully.",
        "success"
      );
    }

  } catch (error) {
    console.error("Profile save error:", error);

    if (
      error.code === "permission-denied" ||
      error.code === "firestore/permission-denied"
    ) {
      showMessage(
        "Firestore denied the update. Check that the published security rules match the student profile update policy.",
        "error"
      );
    } else {
      showMessage(
        error.message || "Unable to save your profile.",
        "error"
      );
    }

  } finally {
    setSaving(false);
  }
});
