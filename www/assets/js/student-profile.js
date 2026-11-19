
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

const message = document.getElementById("profileMessage");

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
  email: document.getElementById("profileEmail")
};


// ==========================================
// STATE
// ==========================================

let currentUser = null;
let profileLoaded = false;

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


function normalize(value) {
  return String(value ?? "").trim();
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

  currentPhotoBase64 = "";
  currentPhotoMime = "image/jpeg";
  selectedPhotoFile = null;

  cleanupPreview();
  setPhotoBusy(true);

  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  showMessage("Loading your personal profile...");
  showPhotoStatus("Loading profile picture...");

  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));

    if (!snapshot.exists()) {
      throw new Error("Student profile not found. Please contact your administrator.");
    }

    const data = snapshot.data();
    if (String(data.role || "").toLowerCase() !== "student") {
      window.location.replace("../login.html");
      return;
    }

    if (data.status === "inactive") {
      throw new Error("Your account is inactive. Please contact the administrator.");
    }

    if (fields.name) {
      fields.name.value = data.fullname || user.displayName || "";
      fields.name.readOnly = true;
    }
    if (fields.email) {
      fields.email.value = data.email || user.email || "";
      fields.email.readOnly = true;
    }

    displaySavedPhoto(data);
    showPhotoStatus(
      currentPhotoBase64 || normalize(data.photoURL)
        ? "Your current profile picture is loaded."
        : "You haven't uploaded a profile picture yet."
    );

    profileLoaded = true;
    showMessage("Your personal profile is ready. Class placement is managed by your administrator.");
    setPhotoBusy(false);
  } catch (error) {
    console.error("Profile loading error:", error);
    showMessage(error.message || "Unable to load your profile. Please refresh the page.", "error");
    showPhotoStatus("Unable to load profile picture.", "error");
    setPhotoBusy(false);
  }
});

// Student academic placement is intentionally not editable from this page.
// Admin Class Assignments is the single source of truth for section placement.

// ==========================================
// CLEANUP
// ==========================================

window.addEventListener("beforeunload", cleanupPreview);
