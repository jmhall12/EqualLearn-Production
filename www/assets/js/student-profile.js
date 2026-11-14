
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";


// ==========================================
// DOM ELEMENTS
// ==========================================

const form = document.getElementById("studentProfileForm");
const message = document.getElementById("profileMessage");
const saveButton = document.getElementById("saveProfile");

const photo = document.getElementById("profilePhoto");
const photoInput = document.getElementById("profilePhotoInput");
const choosePhotoButton = document.getElementById("chooseProfilePhoto");
const removePhotoButton = document.getElementById("removeProfilePhoto");
const photoStatus = document.getElementById("profilePhotoStatus");

const DEFAULT_PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23eeedff'/%3E%3Ccircle cx='60' cy='43' r='22' fill='%239b95e8'/%3E%3Cpath d='M20 112c3-25 19-38 40-38s37 13 40 38' fill='%239b95e8'/%3E%3C/svg%3E";

const MAX_INPUT_SIZE = 5 * 1024 * 1024;
const MAX_COMPRESSED_SIZE = 350 * 1024;
const MAX_IMAGE_DIMENSION = 512;

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

let currentPhotoBase64 = "";
let currentPhotoMime = "image/jpeg";

let selectedPhotoFile = null;
let previewURL = null;
let photoBusy = false;


// ==========================================
// HELPERS
// ==========================================

function showMessage(text, type = "") {
  if (!message) return;

  message.textContent = text;
  message.className = `profile-message ${type}`.trim();
}


function showPhotoStatus(text, type = "") {
  if (!photoStatus) return;

  photoStatus.textContent = text;

  photoStatus.style.color =
    type === "error" ? "#be123c" :
    type === "success" ? "#15803d" : "";
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
  saveButton.textContent = saving ? "Saving..." : "Save Profile";
}


function setPhotoBusy(busy) {
  photoBusy = busy;

  if (choosePhotoButton) {
    choosePhotoButton.disabled = busy || !profileLoaded;

    choosePhotoButton.textContent = busy
      ? "Saving Photo..."
      : selectedPhotoFile
        ? "Save Photo"
        : "Upload Photo";
  }

  if (removePhotoButton) {
    removePhotoButton.disabled =
      busy || !profileLoaded ||
      (!currentPhotoBase64 && !selectedPhotoFile);

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

  photo.onerror = () => {
    photo.onerror = null;
    photo.src = DEFAULT_PHOTO;
  };

  photo.src = url || DEFAULT_PHOTO;
}


function cleanupPreview() {
  if (previewURL) {
    URL.revokeObjectURL(previewURL);
    previewURL = null;
  }
}


// ==========================================
// PHOTO VALIDATION
// ==========================================

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

  if (file.size > MAX_INPUT_SIZE) {
    throw new Error("Original image must not exceed 5 MB.");
  }

  if (file.size === 0) {
    throw new Error("The selected image is empty.");
  }
}


// ==========================================
// IMAGE COMPRESSION
// ==========================================

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectURL);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error("Unable to read the selected image."));
    };

    image.src = objectURL;
  });
}


function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error("Image compression failed."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}


function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1];

      if (!base64) {
        reject(new Error("Unable to convert image."));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => {
      reject(new Error("Unable to read compressed image."));
    };

    reader.readAsDataURL(blob);
  });
}


async function compressPhoto(file) {
  const image = await loadImage(file);

  let width = image.naturalWidth;
  let height = image.naturalHeight;

  if (!width || !height) {
    throw new Error("Invalid image dimensions.");
  }

  // Resize while preserving aspect ratio.
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(width, height)
  );

  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser cannot process this image.");
  }

  canvas.width = width;
  canvas.height = height;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.82;
  let blob = null;

  // Reduce quality until the image fits the target size.
  for (let attempt = 0; attempt < 8; attempt++) {
    blob = await canvasToBlob(canvas, quality);

    if (blob.size <= MAX_COMPRESSED_SIZE) {
      break;
    }

    quality -= 0.08;
  }

  // If still too large, reduce dimensions.
  while (blob && blob.size > MAX_COMPRESSED_SIZE) {
    width = Math.max(128, Math.round(width * 0.8));
    height = Math.max(128, Math.round(height * 0.8));

    canvas.width = width;
    canvas.height = height;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    blob = await canvasToBlob(canvas, 0.55);

    if (width === 128 && height === 128) {
      break;
    }
  }

  if (!blob || blob.size > MAX_COMPRESSED_SIZE) {
    throw new Error(
      "Unable to compress the image enough. Please choose a smaller picture."
    );
  }

  const base64 = await blobToBase64(blob);

  return {
    base64,
    mime: "image/jpeg",
    size: blob.size
  };
}


// ==========================================
// DISPLAY FIRESTORE PHOTO
// ==========================================

function displaySavedPhoto(data) {
  const base64 = normalize(data.profileImageBase64);
  const mime = normalize(data.profileImageMime) || "image/jpeg";

  if (base64) {
    currentPhotoBase64 = base64;
    currentPhotoMime = mime;

    setPhotoPreview(`data:${mime};base64,${base64}`);
    return;
  }

  // Legacy URL fallback for old profiles.
  const legacyURL = normalize(data.photoURL);

  currentPhotoBase64 = "";
  currentPhotoMime = "image/jpeg";

  setPhotoPreview(legacyURL);
}


// ==========================================
// PHOTO SELECTION
// ==========================================

// First click opens the file picker.
// After selecting a file, the button becomes Save Photo.

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
    showPhotoStatus("Compressing your profile picture...");

    const compressed = await compressPhoto(file);

    showPhotoStatus("Saving your profile picture to Firestore...");

    const userRef = doc(db, "users", currentUser.uid);

    await updateDoc(userRef, {
      profileImageBase64: compressed.base64,
      profileImageMime: compressed.mime,
      photoUpdatedAt: serverTimestamp(),
      profileUpdatedAt: serverTimestamp()
    });

    currentPhotoBase64 = compressed.base64;
    currentPhotoMime = compressed.mime;

    selectedPhotoFile = null;

    if (photoInput) {
      photoInput.value = "";
    }

    cleanupPreview();

    setPhotoPreview(
      `data:${compressed.mime};base64,${compressed.base64}`
    );

    showPhotoStatus(
      `Profile picture saved successfully (${Math.round(compressed.size / 1024)} KB).`,
      "success"
    );

  } catch (error) {
    console.error("Profile photo save error:", error);

    showPhotoStatus(
      error.code === "permission-denied"
        ? "Firestore denied the photo update. Check your Firestore Rules."
        : error.message || "Unable to save your profile picture.",
      "error"
    );

  } finally {
    setPhotoBusy(false);
  }
});


// ==========================================
// PHOTO PREVIEW
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
      `${file.name} selected. Click Save Photo to save it.`
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

  // Cancel selected but unsaved image.
  if (selectedPhotoFile) {
    selectedPhotoFile = null;

    if (photoInput) {
      photoInput.value = "";
    }

    cleanupPreview();

    const savedURL = currentPhotoBase64
      ? `data:${currentPhotoMime};base64,${currentPhotoBase64}`
      : "";

    setPhotoPreview(savedURL);

    showPhotoStatus("Selected photo cancelled.");

    setPhotoBusy(false);
    return;
  }

  if (!currentPhotoBase64) return;

  const confirmed = window.confirm(
    "Are you sure you want to remove your profile picture?"
  );

  if (!confirmed) return;

  setPhotoBusy(true);
  showPhotoStatus("Removing profile picture...");

  try {
    const userRef = doc(db, "users", currentUser.uid);

    await updateDoc(userRef, {
      profileImageBase64: deleteField(),
      profileImageMime: deleteField(),
      photoURL: deleteField(),
      photoPath: deleteField(),
      photoUpdatedAt: serverTimestamp(),
      profileUpdatedAt: serverTimestamp()
    });

    currentPhotoBase64 = "";
    currentPhotoMime = "image/jpeg";

    setPhotoPreview("");

    showPhotoStatus(
      "Profile picture removed successfully.",
      "success"
    );

  } catch (error) {
    console.error("Profile photo removal error:", error);

    showPhotoStatus(
      error.code === "permission-denied"
        ? "Firestore denied the photo removal. Check your Firestore Rules."
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

  currentPhotoBase64 = "";
  currentPhotoMime = "image/jpeg";

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

    displaySavedPhoto(data);

    showPhotoStatus(
      currentPhotoBase64 || normalize(data.photoURL)
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
