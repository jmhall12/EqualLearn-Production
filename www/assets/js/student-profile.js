
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

// ==========================================
// DOM ELEMENTS
// ==========================================

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
let originalProfile = null;

// ==========================================
// HELPERS
// ==========================================

function showMessage(text, type = "") {
  if (!message) return;

  message.textContent = text;
  message.className = `profile-message ${type}`.trim();
}

function fieldValue(field) {
  return String(field?.value || "").trim();
}

function normalize(value) {
  return String(value ?? "").trim();
}

function normalizeYear(value) {
  return String(value ?? "").replace(/\D/g, "");
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

function getSection(data) {
  return normalize(
    data.section ||
    data.sectionName ||
    data.className ||
    ""
  );
}

function getCohort(data) {
  return normalize(
    data.cohort ||
    data.academicYear ||
    data.cohortId ||
    ""
  );
}

function getVerificationStatus(data) {
  if (data.academicProfileVerified === true) {
    return "verified";
  }

  return normalize(data.verificationStatus).toLowerCase() || "pending";
}

// ==========================================
// LOAD AUTHENTICATED STUDENT
// ==========================================

onAuthStateChanged(auth, async user => {
  currentUser = user;
  profileLoaded = false;
  originalProfile = null;

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

    // Read-only identity information
    if (fields.name) {
      fields.name.value = data.fullname || user.displayName || "";
    }

    if (fields.email) {
      fields.email.value = data.email || user.email || "";
    }

    // Academic information
    if (fields.studentNumber) {
      fields.studentNumber.value = data.studentNumber || "";
    }

    if (fields.course) {
      fields.course.value = data.course || "";
    }

    const year = normalizeYear(data.yearLevel);

    if (fields.yearLevel) {
      fields.yearLevel.value =
        ["1", "2", "3", "4", "5"].includes(year) ? year : "";
    }

    if (fields.section) {
      fields.section.value = getSection(data);
    }

    if (fields.cohort) {
      fields.cohort.value = getCohort(data);
    }

    originalProfile = {
      studentNumber: normalize(data.studentNumber).toUpperCase(),
      course: normalize(data.course),
      yearLevel: normalizeYear(data.yearLevel),
      section: getSection(data),
      cohort: getCohort(data)
    };

    const complete = Boolean(
      originalProfile.studentNumber &&
      originalProfile.course &&
      originalProfile.yearLevel
    );

    const verificationStatus = getVerificationStatus(data);

    if (data.status === "inactive" || verificationStatus === "rejected") {
      showMessage(
        data.rejectionReason
          ? `Your academic profile was rejected: ${data.rejectionReason}`
          : "Your account is currently inactive. Please contact your administrator.",
        "error"
      );

      return;
    }

    if (verificationStatus === "verified") {
      showMessage(
        "Your academic profile is verified. If you change your academic information, it will be submitted for verification again."
      );
    } else if (verificationStatus === "pending") {
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

  if (!currentUser || !profileLoaded || !originalProfile) {
    showMessage(
      "Your profile is not ready. Please refresh the page.",
      "error"
    );
    return;
  }

  const studentNumber = fieldValue(fields.studentNumber).toUpperCase();
  const course = fieldValue(fields.course);
  const yearLevel = fieldValue(fields.yearLevel);
  const section = fieldValue(fields.section);
  const cohort = fieldValue(fields.cohort);

  // ========================================
  // VALIDATION
  // ========================================

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

    // Re-check the latest Firestore profile.
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      throw new Error("Student account not found.");
    }

    const existing = snapshot.data();

    if (String(existing.role || "").toLowerCase() !== "student") {
      throw new Error("Only student accounts can update this profile.");
    }

    if (existing.status !== "active") {
      throw new Error(
        "Your account is not active. Please contact the administrator."
      );
    }

    // ========================================
    // DETECT ACADEMIC CHANGES
    // ========================================

    const academicChanged =
      normalize(existing.studentNumber).toUpperCase() !== studentNumber ||
      normalize(existing.course) !== course ||
      normalizeYear(existing.yearLevel) !== yearLevel ||
      getSection(existing) !== section ||
      getCohort(existing) !== cohort;

    // ========================================
    // PREPARE UPDATE
    // ========================================

    const updates = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort,
      profileCompleted: true,
      profileUpdatedAt: serverTimestamp()
    };

    // Any academic change requires administrator review.
    // Students cannot mark their own profile as verified.
    if (academicChanged) {
      updates.verificationStatus = "pending";
      updates.academicProfileVerified = false;
    }

    await updateDoc(userRef, updates);

    // Update local baseline after successful save.
    originalProfile = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort
    };

    // ========================================
    // SUCCESS MESSAGE
    // ========================================

    if (academicChanged) {
      showMessage(
        "Your academic information has been saved. Your changes are now pending administrator verification.",
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
        "Firestore denied the update. Please check that the latest Firestore Rules have been published.",
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
