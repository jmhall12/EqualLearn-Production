
import { db } from "./firebase-config.js";
import { requireRole } from "./session.js";

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const list = $("submissionList");
const modal = $("gradingModal");
const questionReview = $("questionReview");

let submissions = [];
let selectedSubmission = null;
let currentTeacher = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function questionType(question) {
  return normalize(question?.type).replaceAll("-", "_");
}

function isManualQuestion(question) {
  return ["essay", "short_answer", "long_answer", "file_upload"].includes(questionType(question));
}

function isCorrectAnswer(question, studentAnswer) {
  const accepted = [question.answer, ...(Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [])]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== "")
    .map(normalize);
  return accepted.includes(normalize(studentAnswer));
}

function calculateObjectiveGrade(quiz, attempt) {
  const questions = Array.isArray(quiz?.activityData?.questions) ? quiz.activityData.questions : [];
  if (!questions.length || questions.some(isManualQuestion)) return null;

  const answers = attempt.answers && typeof attempt.answers === "object" ? attempt.answers : {};
  const questionScores = {};
  let earned = 0;
  let total = 0;

  questions.forEach((question, index) => {
    const id = getQuestionId(question, index);
    const points = Math.max(0, Number(question.points) || 1);
    const correct = isCorrectAnswer(question, answers[id]);
    const score = correct ? points : 0;
    questionScores[id] = score;
    earned += score;
    total += points;
  });

  if (total <= 0) return null;
  const percentage = Math.round((earned / total) * 100);
  const passingScore = Number(quiz.activityData?.passingScore ?? attempt.passingScore ?? 60);
  return { score: earned, total, percentage, passingScore, questionScores,
    result: percentage >= passingScore ? "passing" : "failing" };
}

function getQuestionId(question, index) {
  return String(question.id || `question_${index}`);
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  const date = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function showNotice(message, type = "success") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = type;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateStats() {
  $("totalSubmissions").textContent = submissions.length;

  $("pendingSubmissions").textContent =
    submissions.filter(item => item.status !== "graded").length;

  $("gradedSubmissions").textContent =
    submissions.filter(item => item.status === "graded").length;
}

/* =====================================================
   LOAD TEACHER QUIZZES AND STUDENT SUBMISSIONS
===================================================== */


async function autoGradeEligibleSubmissions(items) {
  const eligible = items.filter(item => item.status !== "graded");
  for (const item of eligible) {
    const grade = calculateObjectiveGrade(item.quizDocument, item);
    if (!grade) continue;
    try {
      await updateDoc(doc(db, "quizAttempts", item.id), {
        ...grade,
        status: "graded",
        gradingMode: "automatic",
        gradedBy: currentTeacher.uid,
        gradedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      Object.assign(item, grade, { status: "graded", gradingMode: "automatic" });
    } catch (error) {
      // Keep the attempt pending if Firestore rules do not allow the update.
      console.warn("[EqualLearn] Automatic grading skipped for", item.id, error.code || error.message);
    }
  }
}

async function loadSubmissions() {
  list.innerHTML = `
    <div class="loading">Loading student submissions...</div>
  `;

  try {
    // 1. Get quizzes created by this teacher.
    const quizQuery = query(
      collection(db, "teacherActivitiesV2"),
      where("createdBy", "==", currentTeacher.uid),
      where("type", "==", "quiz")
    );

    const quizSnapshot = await getDocs(quizQuery);

    const quizDocuments = quizSnapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    // 2. Find teacher's assigned sections.
    const sectionsRef = collection(db, "sections");

    const [primarySections, multipleSections] = await Promise.all([
      getDocs(query(
        sectionsRef,
        where("teacherId", "==", currentTeacher.uid)
      )),

      getDocs(query(
        sectionsRef,
        where("teacherIds", "array-contains", currentTeacher.uid)
      ))
    ]);

    const sectionIds = [
      ...new Set([
        ...primarySections.docs.map(item => item.id),
        ...multipleSections.docs.map(item => item.id)
      ])
    ];

    // 3. Get students from assigned sections only.
    const studentSnapshots = await Promise.all(
      sectionIds.map(sectionId =>
        getDocs(query(
          collection(db, "users"),
          where("role", "==", "student"),
          where("sectionId", "==", sectionId)
        ))
      )
    );

    const students = new Map();

    studentSnapshots.forEach(snapshot => {
      snapshot.docs.forEach(item => {
        students.set(item.id, {
          uid: item.id,
          ...item.data()
        });
      });
    });

    // 4. Query attempts per student.
    // This matches the assigned-teacher Firestore rule.
    const studentAttempts = await Promise.all(
      [...students.values()].map(async student => {
        const attemptsQuery = query(
          collection(db, "quizAttempts"),
          where("userId", "==", student.uid)
        );

        const snapshot = await getDocs(attemptsQuery);

        return snapshot.docs.map(attemptDoc => ({
          id: attemptDoc.id,
          ...attemptDoc.data(),
          studentName:
            student.fullname ||
            student.displayName ||
            student.email ||
            "Student",
          studentEmail: student.email || "",
          sectionId: student.sectionId || ""
        }));
      })
    );

    // 5. Keep only attempts belonging to quizzes owned by teacher.
    const quizMap = new Map(
      quizDocuments.map(quiz => [quiz.id, quiz])
    );

    submissions = studentAttempts
      .flat()
      .filter(attempt => quizMap.has(attempt.quizId))
      .map(attempt => ({
        ...attempt,
        quizDocument: quizMap.get(attempt.quizId),
        quizTitle:
          attempt.quizTitle ||
          quizMap.get(attempt.quizId)?.title ||
          "Quiz"
      }));

    // Automatically score objective-only quizzes; essays/short answers remain for teacher review.
    await autoGradeEligibleSubmissions(submissions);

    // 6. Sort newest submissions first.
    submissions.sort((a, b) => {
      const dateA = a.submittedAt?.toMillis?.() || 0;
      const dateB = b.submittedAt?.toMillis?.() || 0;
      return dateB - dateA;
    });

    updateStats();
    renderSubmissions();

    console.log("[EqualLearn] Teacher submissions loaded:", {
      quizzes: quizDocuments.length,
      assignedSections: sectionIds.length,
      students: students.size,
      submissions: submissions.length
    });

  } catch (error) {
    console.error("[EqualLearn] Submission loading error:", {
      code: error.code,
      message: error.message,
      error
    });

    list.innerHTML = `
      <div class="error">
        <strong>Unable to load submissions.</strong>
        <p>${escapeHTML(error.message)}</p>
        <small>${escapeHTML(error.code || "")}</small>
      </div>
    `;
  }
}


/* =====================================================
   RENDER SUBMISSIONS
===================================================== */

function renderSubmissions() {
  const search = normalize($("searchSubmission").value);
  const filter = $("statusFilter").value;

  const rows = submissions.filter(item => {
    const graded = item.status === "graded";

    if (filter === "pending" && graded) return false;
    if (filter === "graded" && !graded) return false;

    const searchable = normalize([
      item.studentName,
      item.quizTitle,
      item.quizDocument?.title,
      item.sectionId
    ].join(" "));

    return searchable.includes(search);
  });

  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        <h3>No submissions found</h3>
        <p>Student quiz submissions will appear here.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = rows.map(item => {
    const graded = item.status === "graded";

    const score = item.score !== null && item.score !== undefined
      ? `${item.score} / ${item.total}`
      : "Not graded yet";

    return `
      <article class="submission">
        <div>
          <h3>${escapeHTML(item.studentName || "Student")}</h3>

          <div class="submission-meta">
            <strong>${escapeHTML(
              item.quizTitle ||
              item.quizDocument?.title ||
              "Quiz"
            )}</strong><br>

            Section: ${escapeHTML(item.sectionId || "Not specified")}<br>
            Submitted: ${escapeHTML(formatDate(item.submittedAt))}<br>
            Score: ${escapeHTML(score)}
          </div>

          <br>

          <span class="status ${graded ? "graded" : ""}">
            ${graded ? (item.gradingMode === "automatic" ? "AUTO-GRADED" : "GRADED") : "NEEDS TEACHER REVIEW"}
          </span>
        </div>

        <button
          class="primary"
          type="button"
          data-grade="${escapeHTML(item.id)}"
        >
          ${graded ? "Review Grade" : "Check Answers"}
        </button>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-grade]").forEach(button => {
    button.addEventListener("click", () => {
      const submission = submissions.find(
        item => item.id === button.dataset.grade
      );

      if (submission) openGrading(submission);
    });
  });
}

/* =====================================================
   OPEN GRADING MODAL
===================================================== */

function openGrading(submission) {
  selectedSubmission = submission;

  const quiz = submission.quizDocument;
  const activityData = quiz?.activityData || {};

  const questions = Array.isArray(activityData.questions)
    ? activityData.questions
    : [];

  const answers = submission.answers || {};

  if (!questions.length) {
    showNotice("This quiz has no available question records.", "error");
    return;
  }

  $("modalStudent").textContent =
    submission.studentName || "Student";

  $("modalQuiz").textContent =
    submission.quizTitle || quiz.title || "Quiz";

  $("teacherFeedback").value = submission.feedback || "";

  questionReview.innerHTML = questions.map((question, index) => {
    const questionId = getQuestionId(question, index);
    const studentAnswer = answers[questionId] ?? "";
    const points = Math.max(0, Number(question.points) || 1);
    const manual = isManualQuestion(question);

    const correct = !manual && isCorrectAnswer(question, studentAnswer);

    const automaticScore = correct ? points : 0;

    const existingScore = submission.questionScores?.[questionId];

    const initialScore = manual
      ? (existingScore ?? "")
      : automaticScore;

    return `
      <article class="question-card"
        data-question-id="${escapeHTML(questionId)}"
        data-manual="${manual}"
        data-max="${points}"
        data-auto-score="${automaticScore}">

        <div class="question-meta">
          QUESTION ${index + 1} · ${escapeHTML(question.type || "Question")}
          · ${points} point${points === 1 ? "" : "s"}
        </div>

        <h4>${escapeHTML(question.text || question.question || "Question")}</h4>

        <strong>Student's Answer</strong>

        <div class="answer-box">${
          escapeHTML(studentAnswer || "No answer submitted")
        }</div>

        ${
          manual
            ? `
              <label>
                Teacher Score (0–${points})
                <input
                  class="score-input manual-score"
                  type="number"
                  min="0"
                  max="${points}"
                  step="0.5"
                  value="${escapeHTML(initialScore)}"
                  placeholder="Enter score"
                >
              </label>
            `
            : `
              <p>
                Automatic result:
                <strong>${correct ? "Correct" : "Incorrect"}</strong>
              </p>

              <p>
                Score:
                <strong>${automaticScore} / ${points}</strong>
              </p>
            `
        }
      </article>
    `;
  }).join("");

  modal.classList.add("open");
}

function closeGrading() {
  modal.classList.remove("open");
  selectedSubmission = null;
}

$("closeModal").addEventListener("click", closeGrading);
$("cancelGrade").addEventListener("click", closeGrading);

/* =====================================================
   SAVE FINAL GRADE
===================================================== */

async function saveGrade() {
  if (!selectedSubmission) return;

  const button = $("saveGrade");
  button.disabled = true;
  button.textContent = "Saving grade...";

  try {
    const questionCards = [
      ...questionReview.querySelectorAll(".question-card")
    ];

    let earnedPoints = 0;
    let totalPoints = 0;

    const questionScores = {};

    for (const card of questionCards) {
      const questionId = card.dataset.questionId;
      const maxPoints = Number(card.dataset.max);
      const manual = card.dataset.manual === "true";

      let score = Number(card.dataset.autoScore);

      if (manual) {
        const input = card.querySelector(".manual-score");

        if (input.value.trim() === "") {
          throw new Error("Please grade every essay and short-answer question.");
        }

        score = Number(input.value);

        if (
          !Number.isFinite(score) ||
          score < 0 ||
          score > maxPoints
        ) {
          throw new Error(`Invalid score for question ${questionId}.`);
        }
      }

      earnedPoints += score;
      totalPoints += maxPoints;
      questionScores[questionId] = score;
    }

    if (totalPoints <= 0) {
      throw new Error("Invalid total points.");
    }

    const percentage = Math.round(
      (earnedPoints / totalPoints) * 100
    );

    const passingScore = Number(
      selectedSubmission.quizDocument?.activityData?.passingScore ??
      selectedSubmission.passingScore ?? 60
    );

    await updateDoc(
      doc(db, "quizAttempts", selectedSubmission.id),
      {
        score: earnedPoints,
        total: totalPoints,
        percentage,
        passingScore,
        result: percentage >= passingScore ? "passing" : "failing",
        status: "graded",
        questionScores,
        feedback: $("teacherFeedback").value.trim(),
        gradedBy: currentTeacher.uid,
        gradedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    showNotice(
      `Grade saved successfully: ${earnedPoints}/${totalPoints} (${percentage}%).`,
      "success"
    );

    closeGrading();
    await loadSubmissions();

  } catch (error) {
    console.error("[EqualLearn] Grade saving error:", error);
    showNotice(error.message || "Unable to save grade.", "error");

  } finally {
    button.disabled = false;
    button.textContent = "Save Final Grade";
  }
}

$("saveGrade").addEventListener("click", saveGrade);

/* =====================================================
   SEARCH AND FILTER
===================================================== */

$("searchSubmission").addEventListener("input", renderSubmissions);
$("statusFilter").addEventListener("change", renderSubmissions);

/* =====================================================
   TEACHER AUTHENTICATION
===================================================== */

requireRole("teacher", async teacherProfile => {
  currentTeacher = teacherProfile;

  if (!currentTeacher.uid) {
    showNotice("Teacher UID is missing.", "error");
    return;
  }

  await loadSubmissions();
});
