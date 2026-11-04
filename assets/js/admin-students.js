
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

const DOMAIN = "paterostechnologicalcollege.edu.ph";

const API_URL =
  document.querySelector('meta[name="equallearn-verification-api"]')
    ?.content?.trim() || "";

const tableContainer = document.getElementById("tableContainer");
const notice = document.getElementById("pageNotice");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const selectAll = document.getElementById("selectAll");
const batchApprove = document.getElementById("batchApprove");
const batchReject = document.getElementById("batchReject");
const refreshButton = document.getElementById("refreshStudents");

let students = [];

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const emailDomainAllowed = email =>
  String(email || "")
    .trim()
    .toLowerCase()
    .endsWith(`@${DOMAIN}`);

const verificationOf = student =>
  student.verificationStatus ||
  (student.academicProfileVerified === true ? "verified" : "pending");

const isComplete = student =>
  Boolean(
    student.studentNumber &&
    student.course &&
    student.yearLevel &&
    (student.section || student.sectionName) &&
    (student.academicYear || student.cohort)
  );

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

function updateStats() {
  $("totalStudents").textContent =
    students.length.toLocaleString("en-PH");

  $("pendingStudents").textContent =
    students.filter(s => verificationOf(s) === "pending")
      .length.toLocaleString("en-PH");

  $("verifiedStudents").textContent =
    students.filter(s => verificationOf(s) === "verified")
      .length.toLocaleString("en-PH");

  $("rejectedStudents").textContent =
    students.filter(s => verificationOf(s) === "rejected")
      .length.toLocaleString("en-PH");
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
    <table>
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
          <th>Profile</th>
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
              <td>
                ${
                  pending && allowed
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

              <td>
                <strong>${esc(student.fullname || "Student")}</strong>
                <div class="muted">${esc(student.uid || student.id)}</div>
              </td>

              <td>${esc(student.studentNumber || "—")}</td>

              <td>
                ${esc(student.email || "—")}
                <div class="muted">
                  ${allowed ? "PTC domain" : "Unauthorized domain"}
                </div>
              </td>

              <td>
                ${esc(student.course || "—")} ·
                ${esc(student.yearLevel || "—")}
              </td>

              <td>
                ${esc(student.section || student.sectionName || "—")}
                <div class="muted">
                  ${esc(student.academicYear || student.cohort || "—")}
                </div>
              </td>

              <td>
                <span class="pill ${isComplete(student) ? "verified" : "pending"}">
                  ${isComplete(student) ? "Complete" : "Incomplete"}
                </span>
              </td>

              <td>
                <span class="pill ${badge}">${statusText}</span>

                ${
                  status === "rejected" && date
                    ? `<div class="muted">Delete after: ${esc(date)}</div>`
                    : ""
                }

                ${
                  !allowed
                    ? '<div class="muted">Domain not allowed</div>'
                    : ""
                }
              </td>

              <td>
                <div class="row-actions">
                  ${
                    pending
                      ? `
                        <button
                          class="btn success"
                          data-action="approve"
                          data-uid="${esc(student.id)}"
                          ${allowed ? "" : "disabled"}
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
  if (!API_URL) {
    throw new Error(
      "Worker URL is not configured. Set the equallearn-verification-api meta tag in admin/students.html after deploying the Worker."
    );
  }

  const user = auth.currentUser;

  if (!user) {
    throw new Error("Your session expired. Please sign in again.");
  }

  const idToken = await user.getIdToken(true);

  const response = await fetch(
    `${API_URL.replace(/\/$/, "")}/api/verification`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        action,
        uids,
        reason
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error ||
      `Verification request failed (${response.status}).`
    );
  }

  return result;
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

    if (!student || !emailDomainAllowed(student.email)) {
      setNotice(
        "Only PTC institutional email addresses can be verified.",
        "error"
      );
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
    setNotice("Submitting secure verification request…");

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

    await loadStudents();

  } catch (error) {
    console.error("Verification action failed:", error);

    setNotice(
      error.message || "Unable to complete verification action.",
      "error"
    );
  }
}

async function loadStudents() {
  tableContainer.innerHTML =
    '<div class="loading">Loading student records…</div>';

  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      where("role", "==", "student")
    )
  );

  students = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  students.sort((a, b) =>
    String(a.fullname || "")
      .localeCompare(String(b.fullname || ""))
  );

  updateStats();
  render();
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

    await loadStudents();

    if (!API_URL) {
      setNotice(
        "Student records loaded. Verification actions are disabled until the Cloudflare Worker URL is configured.",
        "error"
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

refreshButton.addEventListener("click", () => {
  loadStudents().catch(error =>
    setNotice(error.message, "error")
  );
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
