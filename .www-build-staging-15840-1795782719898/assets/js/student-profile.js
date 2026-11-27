import { auth, db, storage } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";


// ==========================================
// DOM ELEMENTS
// ==========================================

const form = document.getElementById("studentProfileForm");
const message = document.getElementById("profileMessage");
const saveButton = document.getElementById("saveProfile");

const photo = document.getElementById("profilePhoto");
const photoCard = document.getElementById("profilePhotoCard");
const photoInput = document.getElementById("profilePhotoInput");
const choosePhotoButton = document.getElementById("chooseProfilePhoto");
const removePhotoButton = document.getElementById("removeProfilePhoto");
const photoStatus = document.getElementById("profilePhotoStatus");

const DEFAULT_PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23eeedff'/%3E%3Ccircle cx='60' cy='43' r='22' fill='%239b95e8'/%3E%3Cpath d='M20 112c3-25 19-38 40-38s37 13 40 38' fill='%239b95e8'/%3E%3C/svg%3E";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

const fields = {
  name: document.getElementById("profileName"),
  email: document.getElementById("profileEmail"),
  studentNumber: document.getElementById("profileStudentNumber"),
  course: document.getElementById("profileCourse"),
  yearLevel: document.getElementById("profileYear"),
  section: document.getElementById("profileSection"),
  cohort: document.getElementById("profileCohort")
};


// ==========================================
// STATE
// ==========================================

let currentUser = null;
let profileLoaded = false;
let originalProfile = null;

let currentPhotoURL = "";
let currentPhotoPath = "";
let selectedPhotoFile = null;
let previewURL = null;
let photoBusy = false;


// ==========================================
// HELPERS
// ==========================================

function showMessage(text, type = "") {
  if (!message) return;

  message.textContent = text;
  message.className = `sp-message ${type}`.trim();
}


function showPhotoStatus(text, type = "") {
  if (!photoStatus) return;

  photoStatus.textContent = text;

  photoStatus.style.color =
    type === "error" ? "#be123c" :
    type === "success" ? "#15803d" : "";
}


// Best-effort, owner-scoped audit event. Never blocks a profile action.
async function recordActivity(action, details = {}) {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "activityLogs"), {
      userId: currentUser.uid,
      actorId: currentUser.uid,
      actorRole: "student",
      action,
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Student activity log could not be saved:", error);
  }
}

function updateProfileSummary(data, user) {
  const name = data.fullname || user?.displayName || "Student";
  const email = data.email || user?.email || "—";
  const studentId = data.studentNumber || "Not added";
  const section = getSection(data) || data.sectionId || "Not assigned";
  const course = data.course || "Not added";
  const verification = getVerificationStatus(data);
  const put = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  put("profileHeroName", name);
  put("profileHeroEmail", email);
  put("profileHeroStudentId", `Student ID · ${studentId}`);
  put("profileHeroSection", `Section · ${section}`);
  put("profileSummaryEmail", email);
  put("profileSummaryStudentId", studentId);
  put("profileSummaryCourse", course);
  put("profileSummarySection", section);
  const badge = document.getElementById("profileVerificationBadge");
  if (badge) {
    badge.textContent = verification === "verified" ? "Verified" : verification === "rejected" ? "Needs attention" : "Pending review";
    badge.classList.toggle("is-verified", verification === "verified");
  }
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
    if (element) {
      element.disabled = !enabled;
    }
  });
}


function setSaving(saving) {
  if (!saveButton) return;

  saveButton.disabled = saving || !profileLoaded;
  saveButton.textContent = saving ? "Saving..." : "Save changes";
}


function setPhotoBusy(busy) {
  photoBusy = busy;

  if (choosePhotoButton) {
    choosePhotoButton.disabled = busy || !profileLoaded;

    choosePhotoButton.textContent = busy
      ? "Uploading..."
      : selectedPhotoFile
        ? "Save Photo"
        : "Upload Photo";
  }

  if (removePhotoButton) {
    removePhotoButton.disabled =
      busy || !profileLoaded || (!currentPhotoURL && !selectedPhotoFile);

    removePhotoButton.textContent = selectedPhotoFile
      ? "Cancel Selection"
      : "Remove Photo";
  }

  if (photoInput) {
    photoInput.disabled = busy || !profileLoaded;
  }
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


function setPhotoPreview(url) {
  if (!photo) return;

  // Use the built-in placeholder if a saved image URL is unavailable.
  photo.onerror = () => {
    photo.onerror = null;
    photo.src = DEFAULT_PHOTO;
  };

  photo.src = url || DEFAULT_PHOTO;
  if (photoCard) {
    photoCard.onerror = () => { photoCard.onerror = null; photoCard.src = DEFAULT_PHOTO; };
    photoCard.src = url || DEFAULT_PHOTO;
  }
}


function cleanupPreview() {
  if (previewURL) {
    URL.revokeObjectURL(previewURL);
    previewURL = null;
  }
}


function validatePhoto(file) {
  if (!file) {
    throw new Error("Please select an image.");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Only JPG, PNG, and WebP images are allowed.");
  }

  if (file.size > MAX_PHOTO_SIZE) {
    throw new Error("Image must not exceed 5 MB.");
  }

  if (file.size === 0) {
    throw new Error("The selected image is empty.");
  }
}


function safeStoragePath(path) {
  return typeof path === "string"
    && currentUser
    && path.startsWith(
      `student-profile-photos/${currentUser.uid}/`
    );
}


// ==========================================
// PROFILE PHOTO SELECTION AND UPLOAD
// ==========================================

// First click: open the file picker.
// After selection: the same button becomes Save Photo.

choosePhotoButton?.addEventListener("click", async () => {
  if (!profileLoaded || !currentUser || photoBusy) {
    return;
  }

  if (!selectedPhotoFile) {
    photoInput?.click();
    return;
  }

  const file = selectedPhotoFile;

  try {
    validatePhoto(file);

    setPhotoBusy(true);
    showPhotoStatus("Uploading your profile picture...");

    const extensionMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };

    const extension = extensionMap[file.type];

    const storagePath =
      `student-profile-photos/${currentUser.uid}/profile.${extension}`;

    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        ownerUid: currentUser.uid,
        purpose: "student-profile-picture"
      }
    });

    const downloadURL = await getDownloadURL(storageRef);

    const userRef = doc(db, "users", currentUser.uid);

    // Save the new reference before deleting the old image.
    const oldPath = currentPhotoPath;

    await updateDoc(userRef, {
      photoURL: downloadURL,
      photoPath: storagePath,
      photoUpdatedAt: serverTimestamp()
    });

    currentPhotoURL = downloadURL;
    currentPhotoPath = storagePath;
    selectedPhotoFile = null;
    await recordActivity("profile_photo_uploaded", { fileName: file.name });

    if (photoInput) {
      photoInput.value = "";
    }

    cleanupPreview();
    setPhotoPreview(downloadURL);

    // Remove the old file only after Firestore was updated.
    if (
      oldPath &&
      oldPath !== storagePath &&
      safeStoragePath(oldPath)
    ) {
      try {
        await deleteObject(ref(storage, oldPath));
      } catch (deleteError) {
        console.warn(
          "Previous photo cleanup failed:",
          deleteError
        );
      }
    }

    showPhotoStatus(
      "Profile picture uploaded successfully.",
      "success"
    );

  } catch (error) {
    console.error("Profile photo upload error:", error);

    showPhotoStatus(
      error.code === "storage/unauthorized"
        ? "Upload denied. Check your Firebase Storage Rules."
        : error.code === "permission-denied" ||
          error.code === "firestore/permission-denied"
          ? "Photo reference could not be saved. Check your Firestore Rules."
          : error.message || "Unable to upload your profile picture.",
      "error"
    );

  } finally {
    setPhotoBusy(false);
  }
});


// ==========================================
// PROFILE PHOTO PREVIEW
// ==========================================

photoInput?.addEventListener("change", () => {
  const file = photoInput.files?.[0];

  if (!file) return;

  try {
    validatePhoto(file);

    cleanupPreview();

    selectedPhotoFile = file;
    previewURL = URL.createObjectURL(file);

    setPhotoPreview(previewURL);

    showPhotoStatus(
      `${file.name} selected. Click Save Photo to upload it.`
    );

    setPhotoBusy(false);

  } catch (error) {
    selectedPhotoFile = null;
    photoInput.value = "";

    showPhotoStatus(error.message, "error");
    setPhotoBusy(false);
  }
});


// ==========================================
// REMOVE PROFILE PHOTO
// ==========================================

removePhotoButton?.addEventListener("click", async () => {
  if (!currentUser || !profileLoaded || photoBusy) {
    return;
  }

  // If a new photo is selected but not uploaded,
  // cancel the selection instead of deleting the saved photo.
  if (selectedPhotoFile) {
    selectedPhotoFile = null;

    if (photoInput) {
      photoInput.value = "";
    }

    cleanupPreview();
    setPhotoPreview(currentPhotoURL);

    showPhotoStatus("Selected photo cancelled.");

    setPhotoBusy(false);
    return;
  }

  if (!currentPhotoURL) return;

  const confirmed = window.confirm(
    "Are you sure you want to remove your profile picture?"
  );

  if (!confirmed) return;

  setPhotoBusy(true);
  showPhotoStatus("Removing profile picture...");

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const oldPath = currentPhotoPath;

    // Remove the Firestore reference first.
    await updateDoc(userRef, {
      photoURL: null,
      photoPath: null,
      photoUpdatedAt: serverTimestamp()
    });

    currentPhotoURL = "";
    currentPhotoPath = "";

    await recordActivity("profile_photo_removed");
    setPhotoPreview("");

    // Delete the old Storage object.
    if (oldPath && safeStoragePath(oldPath)) {
      try {
        await deleteObject(ref(storage, oldPath));
      } catch (deleteError) {
        console.warn(
          "Storage cleanup failed:",
          deleteError
        );
      }
    }

    showPhotoStatus(
      "Profile picture removed.",
      "success"
    );

  } catch (error) {
    console.error("Profile photo removal error:", error);

    showPhotoStatus(
      error.code === "storage/unauthorized"
        ? "Removal denied. Check your Firebase Storage Rules."
        : error.code === "permission-denied" ||
          error.code === "firestore/permission-denied"
          ? "Photo reference could not be updated. Check your Firestore Rules."
          : error.message || "Unable to remove your profile picture.",
      "error"
    );

  } finally {
    setPhotoBusy(false);
  }
});


// ==========================================
// LOAD AUTHENTICATED STUDENT
// ==========================================

onAuthStateChanged(auth, async user => {
  currentUser = user;
  profileLoaded = false;
  originalProfile = null;

  currentPhotoURL = "";
  currentPhotoPath = "";
  selectedPhotoFile = null;

  cleanupPreview();

  setFormEnabled(false);
  setPhotoBusy(true);

  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  showMessage("Loading your academic profile...");
  showPhotoStatus("Loading profile picture...");

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

    updateProfileSummary(data, user);

    // ======================================
    // IDENTITY INFORMATION
    // ======================================

    if (fields.name) {
      fields.name.value = data.fullname || user.displayName || "";
      fields.name.readOnly = true;
    }

    if (fields.email) {
      fields.email.value = data.email || user.email || "";
    }

    // ======================================
    // ACADEMIC INFORMATION
    // ======================================

    if (fields.studentNumber) {
      fields.studentNumber.value = data.studentNumber || "";
    }

    if (fields.course) {
      fields.course.value = data.course || "";
    }

    const year = normalizeYear(data.yearLevel);

    if (fields.yearLevel) {
      fields.yearLevel.value =
        ["1", "2", "3", "4", "5"].includes(year)
          ? year
          : "";
    }

    if (fields.section) {
      fields.section.value = getSection(data);
    }

    if (fields.cohort) {
      fields.cohort.value = getCohort(data);
    }

    // ======================================
    // PROFILE PICTURE
    // ======================================

    currentPhotoURL = normalize(data.photoURL);
    currentPhotoPath = normalize(data.photoPath);

    setPhotoPreview(currentPhotoURL);

    showPhotoStatus(
      currentPhotoURL
        ? "Your current profile picture is loaded."
        : "You haven't uploaded a profile picture yet."
    );

    // ======================================
    // ORIGINAL PROFILE SNAPSHOT
    // ======================================

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

    if (
      data.status === "inactive" ||
      verificationStatus === "rejected"
    ) {
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
    setPhotoBusy(false);

  } catch (error) {
    console.error("Profile loading error:", error);

    showMessage(
      "Unable to load your profile. Please refresh the page.",
      "error"
    );

    showPhotoStatus(
      "Unable to load profile picture.",
      "error"
    );

    setFormEnabled(false);
    setPhotoBusy(false);
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

  if (photoBusy) {
    showMessage(
      "Please wait until the profile picture operation finishes.",
      "error"
    );
    return;
  }

  const studentNumber = fieldValue(fields.studentNumber).toUpperCase();
  const course = fieldValue(fields.course);
  const yearLevel = fieldValue(fields.yearLevel);
  const section = fieldValue(fields.section);
  const cohort = fieldValue(fields.cohort);

  // ======================================
  // VALIDATION
  // ======================================

  if (!studentNumber || !course || !yearLevel) {
    showMessage(
      "Student ID, Course, and Year Level are required.",
      "error"
    );
    return;
  }

  if (!["1", "2", "3", "4", "5"].includes(yearLevel)) {
    showMessage(
      "Please select a valid year level.",
      "error"
    );
    return;
  }

  setSaving(true);
  showMessage("Saving your academic information...");

  try {
    const userRef = doc(db, "users", currentUser.uid);

    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      throw new Error("Student account not found.");
    }

    const existing = snapshot.data();

    if (String(existing.role || "").toLowerCase() !== "student") {
      throw new Error(
        "Only student accounts can update this profile."
      );
    }

    if (existing.status !== "active") {
      throw new Error(
        "Your account is not active. Please contact the administrator."
      );
    }

    // ======================================
    // DETECT ACADEMIC CHANGES
    // ======================================

    const academicChanged =
      normalize(existing.studentNumber).toUpperCase() !== studentNumber ||
      normalize(existing.course) !== course ||
      normalizeYear(existing.yearLevel) !== yearLevel ||
      getSection(existing) !== section ||
      getCohort(existing) !== cohort;

    const updates = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort,
      profileCompleted: true,
      profileUpdatedAt: serverTimestamp()
    };

    // Academic changes require administrator verification.
    if (academicChanged) {
      updates.verificationStatus = "pending";
      updates.academicProfileVerified = false;
    }

    await updateDoc(userRef, updates);

    await recordActivity("profile_updated", {
      academicDetailsChanged: academicChanged,
      updatedFields: ["studentNumber", "course", "yearLevel"]
    });
    updateProfileSummary({ ...existing, ...updates }, currentUser);

    originalProfile = {
      studentNumber,
      course,
      yearLevel,
      section,
      cohort
    };

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
        "Firestore denied the update. Please check your Firestore Rules.",
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


// ==========================================
// CLEANUP
// ==========================================

window.addEventListener("beforeunload", cleanupPreview);