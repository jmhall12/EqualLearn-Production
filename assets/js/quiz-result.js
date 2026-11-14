import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — QUIZ SUBMISSION RESULT
   Shows the saved record from quizAttempts/{attemptId}.
   Answer keys are never read here; grading stays server-side.
========================================================= */

const $ = id => document.getElementById(id);

const attemptId = new URLSearchParams(location.search).get("attempt") || "";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function show(title, text, detail = "") {
  const card = $("resultCard");
  if (!card) return;

  card.innerHTML = `
    <span class="mini-label">ASSESSMENT</span>
    <h2>${escapeHTML(title)}</h2>
    <p>${escapeHTML(text)}</p>
    ${detail}
    <div class="result-actions">
      <a class="btn primary" href="quizzes.html">Back to quizzes</a>
      <a class="btn ghost" href="classwork.html">Classwork</a>
    </div>
  `;
}

async function load() {
  if (!attemptId) {
    show("No attempt selected", "Open a quiz first, then submit it to see your result here.");
    return;
  }

  const attemptSnap = await getDoc(doc(db, "quizAttempts", attemptId));

  if (!attemptSnap.exists()) {
    show("Attempt not found", "This submission is no longer available.");
    return;
  }

  const attempt = attemptSnap.data();

  if (String(attempt.userId || "") !== auth.currentUser.uid) {
    show("Not available", "This submission belongs to another student account.");
    return;
  }

  let title = "Quiz submitted";

  if (attempt.quizId) {
    const quizSnap = await getDoc(doc(db, "quizzes", String(attempt.quizId)));
    if (quizSnap.exists()) title = quizSnap.data().title || title;
  }

  const total = Number(attempt.total || 0);
  const scored = attempt.score === null || attempt.score === undefined;
  const percentage = !scored && total
    ? Math.round((Number(attempt.score) / total) * 100)
    : null;

  const detail = scored
    ? `<p class="result-note">Your answers were saved. Your teacher's grading will appear in your progress page.</p>`
    : `<p class="result-score"><strong>${percentage}%</strong><span>${escapeHTML(
        String(attempt.score)
      )} of ${total} correct</span></p>`;

  show(title, `Status: ${String(attempt.status || "submitted")}`, detail);
}

onAuthStateChanged(auth, user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  load().catch(error => {
    console.error("[EqualLearn] Result error:", error);
    show("Result unavailable", error.message || "Please try again.");
  });
});
