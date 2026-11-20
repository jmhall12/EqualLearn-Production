import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
  Timestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const DOMAIN = "paterostechnologicalcollege.edu.ph";

const tableContainer = document.getElementById("tableContainer");
const notice = document.getElementById("pageNotice");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const selectAll = document.getElementById("selectAll");
const batchApprove = document.getElementById("batchApprove");
const batchReject = document.getElementById("batchReject");
const refreshButton = document.getElementById("refreshStudents");

let students = [];
let canAssignStudentIds = false;
let studentsUnsubscribe = null;
let assigningMissingStudentIds = false;

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));



function getStudentPhoto(student) {
  if (!student) return "";

  // Priority 1: EqualLearn uploaded profile picture.
  const equalLearnPhoto = String(
    student.photoURL || ""
  ).trim();

  if (/^https?:\/\//i.test(equalLearnPhoto)) {
    return equalLearnPhoto;
  }

  // Priority 2: Google profile photo saved in Firestore.
  const googlePhoto = String(
    student.googlePhotoURL ||
    student.googleProfilePhoto ||
    student.profileImage ||
    student.authPhotoURL ||
    ""
  ).trim();

  if (
    /^https?:\/\//i.test(googlePhoto) ||
    /^data:image\//i.test(googlePhoto)
  ) {
    return googlePhoto;
  }

  // Priority 3: Legacy Base64 image.
  const base64 = String(
    student.profileImageBase64 || ""
  ).trim();

  if (/^data:image\//i.test(base64)) {
    return base64;
  }

  if (base64 && /^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    const mime = student.profileImageMime || "image/jpeg";
    return `data:${mime};base64,${base64}`;
  }

  return "";
}



function renderStudentPhoto(student) {
  const name = student.fullname || "Student";
  const photo = getStudentPhoto(student);

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join("");

  return `
    <div class="admin-student-identity">
      <div class="admin-student-photo">
        ${
          photo
            ? `
              <img
                src="${esc(photo)}"
                alt="${esc(name)}"
                loading="lazy"
                referrerpolicy="no-referrer"
                onerror="
                  this.style.display='none';
                  this.nextElementSibling.style.display='grid';
                "
              >
            `
            : ""
        }

        <span
          class="admin-student-photo-fallback"
          ${photo ? 'style="display:none"' : ""}
        >
          ${esc(initials || "S")}
        </span>
      </div>

      <div class="admin-student-details">
        <strong>${esc(name)}</strong>
      </div>
    </div>
  `;
}

function injectStudentPhotoStyles() {
  if (document.getElementById("admin-student-photo-styles")) return;

  const style = document.createElement("style");
  style.id = "admin-student-photo-styles";

  style.textContent = `
    .admin-student-identity {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      max-width: 100%;
    }

    .admin-student-photo {
      width: 34px;
      height: 34px;
      min-width: 34px;
      border-radius: 50%;
      overflow: hidden;
      position: relative;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #635bff, #9a80ff);
      color: white;
      font-size: 11px;
      font-weight: 800;
      border: 2px solid rgba(99,91,255,.15);
    }

    .admin-student-photo img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
    }

    .admin-student-photo-fallback {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }

    .admin-student-name {
      font-weight: 750;
      color: var(--text, inherit);
    }

    .admin-student-details { min-width: 0; overflow-wrap: anywhere; }
    .admin-student-details strong { display: block; font-size: 10px; line-height: 1.3; }
    .admin-student-identity .muted {
      font-size: 8px;
      line-height: 1.25;
      margin-top: 2px;
      overflow-wrap: anywhere;
    }
  `;

  document.head.appendChild(style);
}

const emailDomainAllowed = email =>
  String(email || "")
    .trim()
    .toLowerCase()
    .endsWith(`@${DOMAIN}`);

const verificationOf = student =>
  student.verificationStatus ||
  (student.academicProfileVerified === true ? "verified" : "pending");


function setNotice(message, type = "info") {
  notice.textContent = message;

  notice.className =
    `notice${
      type === "error"
        ? " error"
        : type === "success"
          ? " success-note"
          : ""
    }`;
}

const DONUT_CIRCUMFERENCE = 125.66;

function setStatNumber(elementId, value) {
  const element = $(elementId);
  if (!element) return;

  const nextValue = Number(value || 0).toLocaleString("en-PH");
  if (element.textContent === nextValue) return;

  element.textContent = nextValue;
}

function setDonutProgress(elementId, value, total) {
  const ring = $(elementId);
  if (!ring) return;

  const percentage = total > 0
    ? Math.max(0, Math.min(100, (value / total) * 100))
    : 0;
  const offset = DONUT_CIRCUMFERENCE * (1 - percentage / 100);

  // Update only the SVG stroke offset. CSS animates the arc smoothly;
  // the SVG is never recreated for each Firestore event.
  ring.style.strokeDashoffset = offset.toFixed(2);
  ring.setAttribute("aria-valuenow", percentage.toFixed(1));
}

function updateStats() {
  const total = students.length;
  const pending = students.filter(s => verificationOf(s) === "pending").length;
  const verified = students.filter(s => verificationOf(s) === "verified").length;
  const rejected = students.filter(s => verificationOf(s) === "rejected").length;

  setStatNumber("totalStudents", total);
  setStatNumber("pendingStudents", pending);
  setStatNumber("verifiedStudents", verified);
  setStatNumber("rejectedStudents", rejected);

  // Total is represented by a complete ring; status rings show their share
  // of the total student population.
  setDonutProgress("totalStudentsRing", total, total);
  setDonutProgress("pendingStudentsRing", pending, total);
  setDonutProgress("verifiedStudentsRing", verified, total);
  setDonutProgress("rejectedStudentsRing", rejected, total);
}

function studentTableSignature(records) {
  return JSON.stringify(records.map(student => {
    const deletion = student.deletionScheduledAt?.toDate
      ? student.deletionScheduledAt.toDate().toISOString()
      : String(student.deletionScheduledAt || "");

    return [
      student.id,
      student.fullname,
      student.studentNumber,
      student.email,
      student.course,
      student.yearLevel,
      student.section,
      student.sectionName,
      student.academicYear,
      student.cohort,
      student.verificationStatus,
      student.academicProfileVerified,
      deletion,
      student.photoURL,
      student.googlePhotoURL,
      student.profileImage,
      student.profileImageBase64
    ];
  }));
}

function sortStudents(records) {
  return records.sort((a, b) =>
    String(a.fullname || "").localeCompare(String(b.fullname || ""))
  );
}

function applyStudentSnapshot(nextStudents) {
  const previousSignature = studentTableSignature(students);
  students = sortStudents(nextStudents);

  // Summary values and doughnut arcs update on every snapshot, but are
  // changed in place. The table is only rebuilt when visible row data changes.
  updateStats();

  const nextSignature = studentTableSignature(students);
  if (previousSignature !== nextSignature) {
    render();
  }
}

function subscribeToStudentUpdates() {
  if (studentsUnsubscribe) studentsUnsubscribe();

  const studentsQuery = query(
    collection(db, "users"),
    where("role", "==", "student")
  );

  studentsUnsubscribe = onSnapshot(
    studentsQuery,
    snapshot => {
      const nextStudents = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      applyStudentSnapshot(nextStudents);

      // Newly created student profiles may arrive without a human-readable ID.
      // Assign it once for Admin accounts; the subsequent snapshot contains it.
      if (
        canAssignStudentIds &&
        !assigningMissingStudentIds &&
        students.some(student => !String(student.studentNumber || "").trim())
      ) {
        assigningMissingStudentIds = true;
        assignMissingStudentNumbers(students)
          .catch(error => {
            console.error("Automatic Student ID assignment failed:", error);
          })
          .finally(() => {
            assigningMissingStudentIds = false;
          });
      }
    },
    error => {
      console.error("Live student updates unavailable:", error);
      setNotice(
        "Live updates were interrupted. Use Refresh to check the latest records.",
        "error"
      );
    }
  );
}

function visibleStudents() {
  const term = searchInput.value.trim().toLowerCase();
  const filter = statusFilter.value;

  return students.filter(student => {
    const status = verificationOf(student);

    if (
      filter !== "all" &&
      filter !== "unauthorized" &&
      status !== filter
    ) {
      return false;
    }

    if (
      filter === "unauthorized" &&
      emailDomainAllowed(student.email)
    ) {
      return false;
    }

    const searchable = [
      student.fullname,
      student.email,
      student.studentNumber,
      student.course,
      student.yearLevel,
      student.section,
      student.sectionName,
      student.academicYear,
      student.cohort
    ].join(" ").toLowerCase();

    return searchable.includes(term);
  });
}

function selectedUids() {
  return [
    ...document.querySelectorAll("[data-select-uid]:checked")
  ].map(element => element.dataset.selectUid);
}

function updateBatchButtons() {
  const count = selectedUids().length;

  batchApprove.disabled = count === 0;
  batchReject.disabled = count === 0;
}

function render() {
  injectStudentPhotoStyles();

  const rows = visibleStudents();

  selectAll.checked = false;
  selectAll.indeterminate = false;

  batchApprove.disabled = true;
  batchReject.disabled = true;

  if (!rows.length) {
    tableContainer.innerHTML =
      '<div class="empty">No students match the selected filter.</div>';
    return;
  }

  tableContainer.innerHTML = `
    <table class="verification-table">
      <colgroup>
        <col class="col-select">
        <col class="col-student">
        <col class="col-student-id">
        <col class="col-email">
        <col class="col-course">
        <col class="col-section">
        <col class="col-verification">
        <col class="col-actions">
      </colgroup>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              aria-label="Select eligible students"
              id="tableSelectAll"
            >
          </th>
          <th>Student</th>
          <th>Student ID</th>
          <th>Email</th>
          <th>Course / Year</th>
          <th>Section / Academic Year</th>
          <th>Verification</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody>
        ${rows.map(student => {
          const status = verificationOf(student);
          const allowed = emailDomainAllowed(student.email);
          const pending = status === "pending";

          const badge =
            status === "verified"
              ? "verified"
              : status === "rejected"
                ? "rejected"
                : "pending";

          const statusText =
            status === "verified"
              ? "Verified"
              : status === "rejected"
                ? "Rejected"
                : "Pending";

          const date = student.deletionScheduledAt?.toDate
            ? student.deletionScheduledAt.toDate().toLocaleString("en-PH")
            : student.deletionScheduledAt || "";

          return `
            <tr>
              <td data-label="Select">
                ${
                  pending
                    ? `
                      <input
                        type="checkbox"
                        data-select-uid="${esc(student.id)}"
                        aria-label="Select ${esc(student.fullname || student.email)}"
                      >
                    `
                    : "—"
                }
              </td>

              <td data-label="Student">
                ${renderStudentPhoto(student)}
              </td>

              <td data-label="Student ID">${esc(student.studentNumber || "—")}</td>

              <td data-label="Email">
                ${esc(student.email || "—")}
                <div class="muted">
                  ${allowed ? "PTC domain" : "Unauthorized domain"}
                </div>
              </td>

              <td data-label="Course / Year">
                ${esc(student.course || "—")} ·
                ${esc(student.yearLevel || "—")}
              </td>

              <td data-label="Section / Academic Year">
                ${esc(student.section || student.sectionName || "—")}
                <div class="muted">
                  ${esc(student.academicYear || student.cohort || "—")}
                </div>
              </td>


              <td data-label="Verification">
                <span class="pill ${badge}">${statusText}</span>

                ${
                  status === "rejected" && date
                    ? `<div class="muted">Delete after: ${esc(date)}</div>`
                    : ""
                }

              </td>

              <td data-label="Actions">
                <div class="row-actions">
                  ${
                    pending
                      ? `
                        <button
                          class="btn success"
                          data-action="approve"
                          data-uid="${esc(student.id)}"
                        >
                          Verify
                        </button>

                        <button
                          class="btn danger"
                          data-action="reject"
                          data-uid="${esc(student.id)}"
                        >
                          Reject
                        </button>
                      `
                      : status === "rejected"
                        ? `
                          <button
                            class="btn ghost"
                            data-action="restore"
                            data-uid="${esc(student.id)}"
                          >
                            Restore for review
                          </button>
                        `
                        : "—"
                  }
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  const tableSelectAll =
    document.getElementById("tableSelectAll");

  tableSelectAll?.addEventListener("change", () => {
    document.querySelectorAll("[data-select-uid]")
      .forEach(element => {
        element.checked = tableSelectAll.checked;
      });

    updateBatchButtons();
  });

  document.querySelectorAll("[data-select-uid]")
    .forEach(element => {
      element.addEventListener("change", updateBatchButtons);
    });

  document.querySelectorAll("[data-action]")
    .forEach(button => {
      button.addEventListener("click", () => {
        handleSingle(
          button.dataset.action,
          button.dataset.uid
        );
      });
    });

  updateBatchButtons();
}

async function callWorker(action, uids, reason = "") {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Your session expired. Please sign in again.");
  }

  if (!["approve", "reject", "restore"].includes(action)) {
    throw new Error("Invalid verification action.");
  }

  if (action === "reject" && !reason.trim()) {
    throw new Error("A rejection reason is required.");
  }

  const results = [];

  for (const uid of uids) {
    try {
      const student = students.find(s => s.id === uid);

      if (!student) {
        throw new Error("Student record not found.");
      }

      const studentRef = doc(db, "users", uid);

      if (action === "approve") {
        const institutional = emailDomainAllowed(student.email);

        await updateDoc(studentRef, {
          status: "active",
          verificationStatus: "verified",
          academicProfileVerified: true,
          verifiedAt: serverTimestamp(),
          verifiedBy: user.uid,
          verificationMethod: institutional ? "institutional" : "manual",
          deletionScheduledAt: deleteField(),
          rejectionReason: deleteField(),
          rejectedAt: deleteField(),
          rejectedBy: deleteField(),
          updatedAt: serverTimestamp()
        });

      } else if (action === "reject") {
        const deletionDate = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        );

        await updateDoc(studentRef, {
          status: "inactive",
          verificationStatus: "rejected",
          academicProfileVerified: false,
          rejectionReason: reason.trim(),
          rejectedAt: serverTimestamp(),
          rejectedBy: user.uid,
          deletionScheduledAt: Timestamp.fromDate(deletionDate),
          updatedAt: serverTimestamp()
        });

      } else if (action === "restore") {
        if (verificationOf(student) !== "rejected") {
          throw new Error("Only rejected students can be restored.");
        }

        await updateDoc(studentRef, {
          status: "active",
          verificationStatus: "pending",
          academicProfileVerified: false,
          deletionScheduledAt: deleteField(),
          rejectionReason: deleteField(),
          rejectedAt: deleteField(),
          rejectedBy: deleteField(),
          updatedAt: serverTimestamp()
        });
      }

      results.push({
        uid,
        success: true,
        message: "Successfully processed."
      });

    } catch (error) {
      console.error(`Verification failed for ${uid}:`, error);

      results.push({
        uid,
        success: false,
        message: error.message || "Unable to process student."
      });
    }
  }

  return { results };
}

async function handleSingle(action, uid) {
  let reason = "";

  if (action === "reject") {
    reason = window.prompt(
      "Enter the reason for rejecting this academic profile:"
    )?.trim() || "";

    if (!reason) return;

    if (!window.confirm(
      "Reject this student? Their account will be disabled now and scheduled for deletion after 7 days."
    )) return;
  }

  else if (action === "approve") {
    const student = students.find(s => s.id === uid);

    if (!student) {
      setNotice("Student record not found.", "error");
      return;
    }

    if (!window.confirm(
      "Verify this student's academic profile?"
    )) return;
  }

  else if (action === "restore") {
    if (!window.confirm(
      "Restore this rejected student to pending review? This cancels the scheduled deletion."
    )) return;
  }

  await perform(action, [uid], reason);
}

async function perform(action, uids, reason = "") {
  try {
    setNotice("Updating student verification record…");

    const result = await callWorker(action, uids, reason);

    const succeeded = (result.results || [])
      .filter(item => item.success).length;

    const failed = (result.results || [])
      .filter(item => !item.success);

    setNotice(
      `${succeeded} record(s) processed${
        failed.length
          ? `; ${failed.length} failed. ${failed.map(item => item.message).join("; ")}`
          : "."
      }`,
      failed.length ? "error" : "success"
    );

    // Firestore onSnapshot updates the table and summary as writes land.

  } catch (error) {
    console.error("Verification action failed:", error);

    setNotice(
      error.message || "Unable to complete verification action.",
      "error"
    );
  }
}

// =====================================================
// HUMAN-READABLE STUDENT ID GENERATION
// Format: YY + COURSE + - + RANDOM FOUR DIGITS
// Example: 25BSIT-0597
// Existing studentNumber values are never overwritten.
// =====================================================

function getStudentYearCode(student) {
  const values = [student.cohort, student.academicYear];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;

    // Prefer a full academic year such as 2025-2026.
    const fullYear = text.match(/20(\d{2})/);
    if (fullYear) return fullYear[1];

    // Also accept a short cohort such as 25 or 25BSIT.
    const shortYear = text.match(/^(\d{2})/);
    if (shortYear) return shortYear[1];
  }

  const createdAt = student.createdAt?.toDate
    ? student.createdAt.toDate()
    : student.createdAt
      ? new Date(student.createdAt)
      : null;

  const year = createdAt && !Number.isNaN(createdAt.getTime())
    ? createdAt.getFullYear()
    : new Date().getFullYear();

  return String(year).slice(-2);
}

function getStudentCourseCode(student) {
  const raw = String(student.course || "BSIT")
    .trim()
    .toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, "");

  if (!compact) return "BSIT";
  if (compact.includes("INFORMATIONTECH") || compact === "BSIT") return "BSIT";
  if (compact.includes("COMPUTERSCIENCE") || compact === "BSCS") return "BSCS";
  if (compact.includes("BUSINESSADMIN") || compact === "BSBA") return "BSBA";
  if (compact.includes("SECONDARYEDUC") || compact === "BSED") return "BSED";
  if (compact.includes("ELEMENTARYEDUC") || compact === "BEED") return "BEED";

  // Preserve short course codes already stored in the profile.
  if (/^[A-Z0-9]{2,8}$/.test(compact)) return compact;

  // For longer unrecognized course names, use an acronym of its words.
  const words = raw.match(/[A-Z0-9]+/g) || [];
  const acronym = words
    .filter(word => !["BACHELOR", "OF", "SCIENCE", "IN", "THE"].includes(word))
    .map(word => word[0])
    .join("")
    .slice(0, 8);

  return /^[A-Z0-9]{2,8}$/.test(acronym) ? acronym : "BSIT";
}

function randomFourDigitSuffix() {
  const value = new Uint32Array(1);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(value);
  } else {
    value[0] = Math.floor(Math.random() * 0xFFFFFFFF);
  }

  return String(value[0] % 10000).padStart(4, "0");
}

function createUniqueStudentNumber(student, usedNumbers) {
  const prefix = `${getStudentYearCode(student)}${getStudentCourseCode(student)}`;

  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const candidate = `${prefix}-${randomFourDigitSuffix()}`;

    if (!usedNumbers.has(candidate)) {
      usedNumbers.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Unable to generate a unique Student ID for ${student.fullname || student.id}.`);
}

async function assignMissingStudentNumbers(records) {
  const usedNumbers = new Set(
    records
      .map(student => String(student.studentNumber || "").trim().toUpperCase())
      .filter(Boolean)
  );

  const missing = records.filter(
    student => !String(student.studentNumber || "").trim()
  );

  let generated = 0;
  let failed = 0;

  // Small batches avoid firing too many Firestore writes at once.
  for (let index = 0; index < missing.length; index += 10) {
    const batch = missing.slice(index, index + 10);

    const results = await Promise.allSettled(
      batch.map(async student => {
        const studentNumber = createUniqueStudentNumber(student, usedNumbers);

        await updateDoc(doc(db, "users", student.id), {
          studentNumber,
          updatedAt: serverTimestamp()
        });

        student.studentNumber = studentNumber;
        return studentNumber;
      })
    );

    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        generated += 1;
      } else {
        failed += 1;
        const student = batch[resultIndex];
        console.error(
          `Unable to save Student ID for ${student.fullname || student.id}:`,
          result.reason
        );
      }
    });
  }

  return { generated, failed };
}

async function loadStudents() {
  if (!students.length) {
    tableContainer.innerHTML =
      '<div class="loading">Loading student records…</div>';
  }

  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      where("role", "==", "student")
    )
  );

  const nextStudents = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  // Only admins may assign IDs. GAD coordinators can review records,
  // but they should not write the protected studentNumber field.
  const idSummary = canAssignStudentIds
    ? await assignMissingStudentNumbers(nextStudents)
    : { generated: 0, failed: 0 };

  applyStudentSnapshot(nextStudents);
  return idSummary;
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("../login.html");
    return;
  }

  try {
    const profileSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    const profile = profileSnap.exists()
      ? profileSnap.data()
      : null;

    if (
      !profile ||
      !["admin", "gad_coordinator"].includes(
        String(profile.role || "").toLowerCase()
      ) ||
      profile.status === "inactive"
    ) {
      alert(
        "Access denied. Admin or authorized GAD Coordinator account required."
      );

      window.location.replace("../login.html");
      return;
    }

    canAssignStudentIds =
      String(profile.role || "").toLowerCase() === "admin";

    const idSummary = await loadStudents();
    subscribeToStudentUpdates();

    if (idSummary.failed > 0) {
      setNotice(
        `${idSummary.failed} Student ID(s) could not be saved. Check Firestore Rules and console errors.`,
        "error"
      );
    } else if (idSummary.generated > 0) {
      setNotice(
        `${idSummary.generated} missing Student ID(s) were generated and saved. Existing IDs were kept.`,
        "success"
      );
    } else {
      setNotice(
        "Student records loaded. Existing Student IDs were preserved.",
        "success"
      );
    }

  } catch (error) {
    console.error("Student verification page error:", error);

    setNotice(
      error.message || "Unable to load student records. Check Firestore Rules.",
      "error"
    );

    tableContainer.innerHTML =
      '<div class="empty">Unable to load student records.</div>';
  }

  
});

searchInput.addEventListener("input", render);
statusFilter.addEventListener("change", render);

selectAll.addEventListener("change", () => {
  document.querySelectorAll("[data-select-uid]")
    .forEach(element => {
      element.checked = selectAll.checked;
    });

  updateBatchButtons();
});

refreshButton.addEventListener("click", async () => {
  try {
    const idSummary = await loadStudents();

    if (idSummary.failed > 0) {
      setNotice(
        `${idSummary.failed} Student ID(s) could not be saved. Check Firestore Rules.`,
        "error"
      );
    } else if (idSummary.generated > 0) {
      setNotice(
        `${idSummary.generated} missing Student ID(s) generated and saved.`,
        "success"
      );
    } else {
      setNotice("Student records synced. Live updates remain enabled.", "success");
    }
  } catch (error) {
    setNotice(error.message, "error");
  }
});

batchApprove.addEventListener("click", async () => {
  const uids = selectedUids();

  if (!uids.length) return;

  if (!confirm(
    `Verify ${uids.length} selected student(s)?`
  )) return;

  await perform("approve", uids);
});

batchReject.addEventListener("click", async () => {
  const uids = selectedUids();

  if (!uids.length) return;

  const reason = prompt(
    `Reason for rejecting ${uids.length} selected student(s):`
  )?.trim() || "";

  if (!reason) return;

  if (!confirm(
    `Reject ${uids.length} student(s)? Accounts will be disabled now and deleted after 7 days.`
  )) return;

  await perform("reject", uids, reason);
});

window.addEventListener("beforeunload", () => {
  if (studentsUnsubscribe) {
    studentsUnsubscribe();
    studentsUnsubscribe = null;
  }
}, { once: true });
