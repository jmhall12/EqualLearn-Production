import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// ======================================================
// ELEMENTS
// ======================================================

const teacherCount = document.getElementById("teacherCount");
const studentCount = document.getElementById("studentCount");
const moduleCount = document.getElementById("moduleCount");
const lessonCount = document.getElementById("lessonCount");

const adminName = document.getElementById("adminName");
const logoutBtn = document.getElementById("logout");

// ======================================================
// AUTHENTICATION AND ADMIN ACCESS
// ======================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
      alert("User profile not found.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    const userData = userSnapshot.data();

    if (userData.role !== "admin") {
      alert("Access denied. Admin account required.");
      await signOut(auth);
      window.location.href = "../login.html";
      return;
    }

    if (adminName) {
      adminName.textContent =
        userData.fullname || user.email || "Administrator";
    }

    await loadDashboardCounts();

  } catch (error) {
    console.error("ADMIN DASHBOARD ERROR:", error);
    alert("Unable to load dashboard data. Check your connection and permissions.");
  }
});

// ======================================================
// DASHBOARD COUNTS
// ======================================================

async function loadDashboardCounts() {
  const [
    teacherSnapshot,
    studentSnapshot,
    moduleSnapshot,
    lessonSnapshot
  ] = await Promise.all([
    getDocs(query(
      collection(db, "users"),
      where("role", "==", "teacher")
    )),

    getDocs(query(
      collection(db, "users"),
      where("role", "==", "student")
    )),

    getDocs(collection(db, "modules")),
    getDocs(collection(db, "lessons"))
  ]);

  if (teacherCount) {
    teacherCount.textContent = teacherSnapshot.size;
  }

  if (studentCount) {
    studentCount.textContent = studentSnapshot.size;
  }

  if (moduleCount) {
    moduleCount.textContent = moduleSnapshot.size;
  }

  if (lessonCount) {
    lessonCount.textContent = lessonSnapshot.size;
  }
}

// ======================================================
// LOGOUT
// ======================================================

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();

    try {
      await signOut(auth);
      window.location.href = "../login.html";
    } catch (error) {
      console.error("Logout error:", error);
      alert("Unable to logout.");
    }
  });
}