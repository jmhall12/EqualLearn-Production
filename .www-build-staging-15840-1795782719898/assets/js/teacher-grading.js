import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";
import { TEACHER_GRADING_AI_URL, isTeacherGradingAIConfigured } from "./teacher-grading-ai-config.js";

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
let assignedSections = [];
let teacherQuizzes = [];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function questionType(question) {
  return normalize(question?.type).replaceAll("-", "_").replaceAll(" ", "_");
}

function isManualQuestion(question) {
  return ["essay", "short_answer", "long_answer", "file_upload"].includes(questionType(question));
}

function isAiEligibleQuestion(question) {
  return ["essay", "short_answer", "long_answer"].includes(questionType(question));
}

function getQuestionId(question, index) {
  return String(question?.id || `question_${index}`);
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map(item => normalize(item)).sort().join(" | ");
  if (value && typeof value === "object") {
    if (value.text !== undefined) return normalize(value.text);
    if (value.value !== undefined) return normalize(value.value);
    return normalize(JSON.stringify(value));
  }
  return normalize(value);
}

function isCorrectAnswer(question, studentAnswer) {
  const accepted = [
    question?.answer,
    question?.correctAnswer,
    ...(Array.isArray(question?.acceptedAnswers) ? question.acceptedAnswers : [])
  ]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== "")
    .map(normalizeAnswer);
  if (!accepted.length) return null;
  return accepted.includes(normalizeAnswer(studentAnswer));
}

// Objective auto-check is only a suggestion. This function never writes to Firestore.
function calculateObjectiveSuggestions(quiz, attempt) {
  const questions = Array.isArray(quiz?.activityData?.questions) ? quiz.activityData.questions : [];
  const answers = attempt.answers && typeof attempt.answers === "object" ? attempt.answers : {};
  const suggestions = {};
  let suggestedScore = 0;
  let suggestedTotal = 0;

  questions.forEach((question, index) => {
    if (isManualQuestion(question)) return;
    const questionId = getQuestionId(question, index);
    const correct = isCorrectAnswer(question, answers[questionId]);
    if (correct === null) return;
    const points = Math.max(0, Number(question.points) || 1);
    const score = correct ? points : 0;
    suggestions[questionId] = { score, points, correct };
    suggestedScore += score;
    suggestedTotal += points;
  });

  return { suggestions, suggestedScore, suggestedTotal };
}

function getStudentDisplayName(profile = {}) {
  const direct = [profile.fullname, profile.fullName, profile.displayName, profile.studentName, profile.name]
    .find(value => typeof value === "string" && value.trim() && !value.includes("@"));
  if (direct) return direct.trim();

  const nameParts = [profile.firstName, profile.middleName, profile.lastName, profile.suffix]
    .filter(value => typeof value === "string" && value.trim());
  if (nameParts.length) return nameParts.join(" ").replace(/\s+/g, " ").trim();

  const studentNumber = profile.studentNumber || profile.studentId;
  return studentNumber ? `Student ${studentNumber}` : "Student";
}

function yearLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d+)(?:st|nd|rd|th)?(?:\s*year)?$/i);
  if (!match) return raw;
  const n = Number(match[1]);
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix} Year`;
}

function getSectionDisplayName(section = {}) {
  const course = section.courseName || section.course || section.program || section.programName || "";
  const year = yearLabel(section.yearLevel || section.year || section.gradeLevel || "");
  const group = section.sectionName || section.section || section.name || section.label || "";
  const parts = [course, year, group].map(v => String(v || "").trim()).filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(" · ") : "Assigned section";
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function getTimestamp(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function stringifyAnswer(value) {
  if (value === null || value === undefined || value === "") return "No answer submitted";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyAnswer).join("\n");
  if (typeof value === "object") {
    const label = value.name || value.fileName || value.filename || "Attached response";
    const url = value.url || value.downloadURL || value.fileUrl;
    const text = value.text || value.answer || value.value;
    return [label, text, url].filter(Boolean).join("\n");
  }
  return String(value);
}

function showNotice(message, type = "success") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = type;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateStats() {
  $("totalSubmissions").textContent = submissions.length.toLocaleString("en-PH");
  $("pendingSubmissions").textContent = submissions.filter(item => item.status !== "graded").length.toLocaleString("en-PH");
  $("gradedSubmissions").textContent = submissions.filter(item => item.status === "graded").length.toLocaleString("en-PH");
}

function fillFilter(select, rows, selectedValue, allLabel) {
  const current = selectedValue || select.value || "all";
  const options = [`<option value="all">${escapeHTML(allLabel)}</option>`];
  rows.forEach(item => options.push(`<option value="${escapeHTML(item.value)}">${escapeHTML(item.label)}</option>`));
  select.innerHTML = options.join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function populateFilters() {
  const currentSection = $("sectionFilter").value || "all";
  const currentQuiz = $("quizFilter").value || "all";
  fillFilter(
    $("sectionFilter"),
    assignedSections.map(section => ({ value: section.id, label: section.name })),
    currentSection,
    "All assigned sections"
  );
  fillFilter(
    $("quizFilter"),
    teacherQuizzes.map(quiz => ({ value: quiz.id, label: quiz.title || "Untitled quiz" })),
    currentQuiz,
    "All quizzes"
  );
}

/* -----------------------------------------------------
   LOAD ONLY THIS TEACHER'S QUIZZES AND ASSIGNED LEARNERS
----------------------------------------------------- */
async function loadSubmissions() {
  const refresh = $("refreshSubmissions");
  refresh.disabled = true;
  refresh.textContent = "Loading...";
  list.innerHTML = `<div class="loading">Loading student submissions...</div>`;

  try {
    const quizQuery = query(
      collection(db, "teacherActivitiesV2"),
      where("createdBy", "==", currentTeacher.uid),
      where("type", "==", "quiz")
    );
    const quizSnapshot = await getDocs(quizQuery);
    const quizDocuments = quizSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    teacherQuizzes = quizDocuments.map(quiz => ({ id: quiz.id, title: quiz.title || "Untitled quiz" }));

    const sectionsRef = collection(db, "sections");
    const [primarySections, multipleSections] = await Promise.all([
      getDocs(query(sectionsRef, where("teacherId", "==", currentTeacher.uid))),
      getDocs(query(sectionsRef, where("teacherIds", "array-contains", currentTeacher.uid)))
    ]);

    const sectionDocs = new Map();
    [...primarySections.docs, ...multipleSections.docs].forEach(item => {
      sectionDocs.set(item.id, { id: item.id, ...item.data() });
    });
    assignedSections = [...sectionDocs.values()]
      .map(section => ({ id: section.id, name: getSectionDisplayName(section) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const sectionNames = new Map(assignedSections.map(section => [section.id, section.name]));
    populateFilters();

    const sectionIds = [...sectionDocs.keys()];
    const studentSnapshots = await Promise.all(sectionIds.map(sectionId => getDocs(query(
      collection(db, "users"),
      where("role", "==", "student"),
      where("sectionId", "==", sectionId)
    ))));

    const students = new Map();
    studentSnapshots.forEach(snapshot => {
      snapshot.docs.forEach(item => {
        const profile = item.data();
        students.set(item.id, {
          uid: item.id,
          ...profile,
          studentName: getStudentDisplayName(profile),
          sectionName: sectionNames.get(profile.sectionId) || getSectionDisplayName(profile)
        });
      });
    });

    const studentAttempts = await Promise.all([...students.values()].map(async student => {
      const attemptsQuery = query(collection(db, "quizAttempts"), where("userId", "==", student.uid));
      const snapshot = await getDocs(attemptsQuery);
      return snapshot.docs.map(attemptDoc => ({
        id: attemptDoc.id,
        ...attemptDoc.data(),
        studentName: student.studentName,
        studentNumber: student.studentNumber || student.studentId || "",
        studentEmail: student.email || "",
        sectionId: student.sectionId || "",
        sectionName: student.sectionName || "Assigned section"
      }));
    }));

    const quizMap = new Map(quizDocuments.map(quiz => [quiz.id, quiz]));
    submissions = studentAttempts.flat()
      .filter(attempt => quizMap.has(attempt.quizId))
      .map(attempt => {
        const quizDocument = quizMap.get(attempt.quizId);
        const objective = calculateObjectiveSuggestions(quizDocument, attempt);
        return {
          ...attempt,
          quizDocument,
          quizTitle: attempt.quizTitle || quizDocument?.title || "Quiz",
          objectiveSuggestions: objective.suggestions,
          objectiveSuggestedScore: objective.suggestedScore,
          objectiveSuggestedTotal: objective.suggestedTotal
        };
      })
      .sort((a, b) => getTimestamp(b.submittedAt) - getTimestamp(a.submittedAt));

    updateStats();
    renderSubmissions();
    console.info("[EqualLearn] Teacher grading data loaded:", {
      quizzes: quizDocuments.length,
      assignedSections: sectionIds.length,
      students: students.size,
      submissions: submissions.length
    });
  } catch (error) {
    console.error("[EqualLearn] Submission loading error:", { code: error.code, message: error.message, error });
    list.innerHTML = `<div class="error"><strong>Unable to load submissions.</strong><br>${escapeHTML(error.message)}<br><small>${escapeHTML(error.code || "")}</small></div>`;
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Refresh";
  }
}

/* -----------------------------------------------------
   COMPACT SUBMISSION LIST AND FILTERS
----------------------------------------------------- */
function renderSubmissions() {
  const search = normalize($("searchSubmission").value);
  const sectionFilter = $("sectionFilter").value;
  const quizFilter = $("quizFilter").value;
  const statusFilter = $("statusFilter").value;

  const rows = submissions.filter(item => {
    const graded = item.status === "graded";
    if (statusFilter === "pending" && graded) return false;
    if (statusFilter === "graded" && !graded) return false;
    if (statusFilter === "auto" && !(item.gradingMode === "automatic" || Object.keys(item.objectiveSuggestions || {}).length)) return false;
    if (statusFilter === "ai" && !(item.gradingMode === "teacher_ai_assisted" || item.aiAssisted === true)) return false;
    if (sectionFilter !== "all" && item.sectionId !== sectionFilter) return false;
    if (quizFilter !== "all" && item.quizId !== quizFilter) return false;

    const searchable = normalize([
      item.studentName,
      item.studentNumber,
      item.studentEmail,
      item.quizTitle,
      item.sectionName
    ].join(" "));
    return searchable.includes(search);
  });

  $("resultsCount").textContent = `${rows.length} of ${submissions.length} submissions`;
  if (!rows.length) {
    list.innerHTML = `<div class="empty"><strong>No submissions found</strong><br>Try another section, quiz, or grading filter.</div>`;
    return;
  }

  list.innerHTML = rows.map(item => {
    const graded = item.status === "graded";
    const hasObjectiveSuggestions = Object.keys(item.objectiveSuggestions || {}).length > 0;
    const autoSaved = item.gradingMode === "automatic";
    const aiSaved = item.gradingMode === "teacher_ai_assisted" || item.aiAssisted === true;
    let statusText = "NEEDS TEACHER REVIEW";
    let statusClass = "";
    if (aiSaved) { statusText = "TEACHER REVIEWED · AI ASSIST"; statusClass = "ai"; }
    else if (autoSaved) { statusText = "AUTO-GRADED · EDITABLE"; statusClass = "auto"; }
    else if (graded) { statusText = "TEACHER REVIEWED"; statusClass = "graded"; }
    else if (hasObjectiveSuggestions) { statusText = "AUTO-CHECK READY · REVIEW"; statusClass = "auto"; }

    const score = item.score !== null && item.score !== undefined && item.total !== null && item.total !== undefined
      ? `${item.score} / ${item.total}`
      : (hasObjectiveSuggestions && item.objectiveSuggestedTotal ? `${item.objectiveSuggestedScore} / ${item.objectiveSuggestedTotal} suggested` : "Awaiting grade");

    return `
      <article class="submission">
        <div class="submission-main">
          <h3 class="submission-name">${escapeHTML(item.studentName || "Student")}</h3>
          <p class="submission-quiz">${escapeHTML(item.quizTitle || "Quiz")}</p>
          <div class="submission-meta">
            <span>${escapeHTML(item.sectionName || "Assigned section")}</span>
            <span>${escapeHTML(item.studentNumber || "Student ID unavailable")}</span>
            <span>${escapeHTML(formatDate(item.submittedAt))}</span>
            <span class="status ${statusClass}">${escapeHTML(statusText)}</span>
          </div>
        </div>
        <div class="submission-score">${escapeHTML(score)}</div>
        <div class="submission-actions">
          <button class="primary" type="button" data-grade="${escapeHTML(item.id)}">${graded ? "Review / Edit" : "Review Answers"}</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-grade]").forEach(button => {
    button.addEventListener("click", () => {
      const submission = submissions.find(item => item.id === button.dataset.grade);
      if (submission) openGrading(submission);
    });
  });
}

/* -----------------------------------------------------
   REVIEW ANSWERS - EVERY QUESTION SCORE IS EDITABLE
----------------------------------------------------- */
function renderAnswer(value) {
  // Only treat explicit file URL fields or absolute HTTP(S) strings as links.
  // A short answer such as "A" must remain text, not become /teacher/A.
  const isObjectAnswer = value !== null && typeof value === "object" && !Array.isArray(value);
  const candidateUrl = isObjectAnswer
    ? (value.url || value.downloadURL || value.downloadUrl || value.fileUrl || value.href || value.storageUrl || "")
    : (typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : "");

  if (candidateUrl) {
    try {
      // No base URL: relative strings are deliberately rejected.
      const safeUrl = new URL(String(candidateUrl).trim());
      if (["http:", "https:"].includes(safeUrl.protocol)) {
        const label = isObjectAnswer
          ? (value.name || value.fileName || value.filename || "Open submitted file")
          : "Open submitted response";
        return `<a href="${escapeHTML(safeUrl.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`;
      }
    } catch (_) {
      // Invalid or relative URLs are displayed as ordinary answer text below.
    }
  }

  return escapeHTML(stringifyAnswer(value));
}

function openGrading(submission) {
  selectedSubmission = submission;
  const quiz = submission.quizDocument;
  const questions = Array.isArray(quiz?.activityData?.questions) ? quiz.activityData.questions : [];
  const answers = submission.answers && typeof submission.answers === "object" ? submission.answers : {};
  if (!questions.length) {
    showNotice("This quiz has no available question records.", "error");
    return;
  }

  $("modalStudent").textContent = submission.studentName || "Student";
  $("modalMeta").textContent = [submission.studentNumber, submission.sectionName, formatDate(submission.submittedAt)].filter(Boolean).join(" · ");
  $("modalQuiz").textContent = submission.quizTitle || quiz.title || "Quiz";
  $("teacherFeedback").value = submission.feedback || "";
  $("gradingAssistNotice").hidden = true;
  $("gradingAssistNotice").textContent = "";

  questionReview.innerHTML = questions.map((question, index) => {
    const questionId = getQuestionId(question, index);
    const studentAnswer = answers[questionId] ?? "";
    const points = Math.max(0, Number(question.points) || 1);
    const manual = isManualQuestion(question);
    const objective = submission.objectiveSuggestions?.[questionId];
    const existingScore = submission.questionScores && Object.prototype.hasOwnProperty.call(submission.questionScores, questionId)
      ? submission.questionScores[questionId]
      : null;
    const initialScore = existingScore !== null && existingScore !== undefined
      ? existingScore
      : objective ? objective.score : "";
    const objectiveNote = objective
      ? `Auto-check suggestion: ${objective.correct ? "Correct" : "Incorrect"} · ${objective.score}/${objective.points}`
      : (!manual ? "No reliable answer key detected. Teacher review is required." : "Written response - teacher review required.");
    const aiEligible = isAiEligibleQuestion(question) && Boolean(stringifyAnswer(studentAnswer).trim()) && stringifyAnswer(studentAnswer) !== "No answer submitted";
    const unavailableFile = questionType(question) === "file_upload";

    return `
      <article class="question-card" data-question-card data-question-id="${escapeHTML(questionId)}" data-max="${points}" data-ai-used="false">
        <div class="question-meta">Question ${index + 1} · ${escapeHTML(question.type || "Question")} · ${points} point${points === 1 ? "" : "s"}</div>
        <h4>${escapeHTML(question.text || question.question || "Question")}</h4>
        <span class="answer-label">Student answer</span>
        <div class="answer-box">${renderAnswer(studentAnswer)}</div>
        <p class="objective-check">${escapeHTML(objectiveNote)}</p>
        <div class="question-score-row">
          <label class="score-label">Teacher's final score (0-${points})
            <input class="teacher-score-input" type="number" min="0" max="${points}" step="0.5" value="${escapeHTML(initialScore)}" placeholder="Enter score" inputmode="decimal">
          </label>
          ${aiEligible ? `<button class="ai-assist-button" type="button" data-ai-assist="${escapeHTML(questionId)}">AI suggest</button>` : unavailableFile ? `<span class="caption">Review file manually</span>` : `<span class="caption">Teacher sets score</span>`}
        </div>
        <div class="ai-suggestion" data-ai-suggestion hidden></div>
      </article>
    `;
  }).join("");

  questionReview.querySelectorAll("[data-ai-assist]").forEach(button => {
    button.addEventListener("click", () => requestAiSuggestion(button.dataset.aiAssist, button));
  });
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeGrading() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  selectedSubmission = null;
}

$("closeModal").addEventListener("click", closeGrading);
$("cancelGrade").addEventListener("click", closeGrading);
modal.addEventListener("click", event => { if (event.target === modal) closeGrading(); });

/* -----------------------------------------------------
   OPTIONAL AI ASSIST - TEACHER MUST APPLY AND CONFIRM
----------------------------------------------------- */
async function requestAiSuggestion(questionId, button) {
  const card = questionReview.querySelector(`[data-question-card][data-question-id="${CSS.escape(questionId)}"]`);
  const output = card?.querySelector("[data-ai-suggestion]");
  const notice = $("gradingAssistNotice");
  if (!card || !selectedSubmission) return;

  if (!isTeacherGradingAIConfigured()) {
    notice.hidden = false;
    notice.textContent = "AI assistance is not connected yet. Set TEACHER_GRADING_AI_URL in assets/js/teacher-grading-ai-config.js and deploy the updated Lumi Worker. Manual grading and objective auto-check remain available.";
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    notice.hidden = false;
    notice.textContent = "Your session has expired. Sign in again before requesting AI assistance.";
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Checking...";
  notice.hidden = true;
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(TEACHER_GRADING_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        quizId: selectedSubmission.quizId,
        attemptId: selectedSubmission.id,
        questionId
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `AI grading service returned ${response.status}.`);

    const score = Number(result.suggestedScore);
    const max = Number(card.dataset.max);
    if (!Number.isFinite(score) || score < 0 || score > max) throw new Error("AI response contained an invalid suggested score.");

    output.hidden = false;
    output.innerHTML = `
      <strong>AI suggestion: ${escapeHTML(score)} / ${escapeHTML(max)} · ${escapeHTML(result.confidence || "unrated")} confidence</strong>
      <p>${escapeHTML(result.rationale || "No rationale was returned.")}</p>
      ${result.feedback ? `<p><strong>Possible feedback:</strong> ${escapeHTML(result.feedback)}</p>` : ""}
      <button class="use-ai-suggestion" type="button" data-use-ai>Use suggestion (editable)</button>
    `;
    output.querySelector("[data-use-ai]").addEventListener("click", () => {
      const input = card.querySelector(".teacher-score-input");
      input.value = String(score);
      card.dataset.aiUsed = "true";
      output.querySelector("[data-use-ai]").textContent = "Suggestion applied - edit score if needed";
      output.querySelector("[data-use-ai]").disabled = true;
    });
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `AI suggestion unavailable: ${error.message}. You can still grade this answer manually.`;
    console.warn("[EqualLearn] AI grading assist failed:", error);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

/* -----------------------------------------------------
   SAVE TEACHER-CONFIRMED FINAL GRADE
----------------------------------------------------- */
async function saveGrade() {
  if (!selectedSubmission) return;
  const button = $("saveGrade");
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const cards = [...questionReview.querySelectorAll("[data-question-card]")];
    let earnedPoints = 0;
    let totalPoints = 0;
    let aiAssisted = false;
    const questionScores = {};
    const aiAssistedQuestionIds = [];

    for (const card of cards) {
      const questionId = card.dataset.questionId;
      const maxPoints = Number(card.dataset.max);
      const input = card.querySelector(".teacher-score-input");
      if (!input || input.value.trim() === "") {
        throw new Error(`Please enter a score for every question. Use 0 if no points were earned.`);
      }
      const score = Number(input.value);
      if (!Number.isFinite(score) || score < 0 || score > maxPoints) {
        throw new Error(`Invalid score for question ${questionId}. Maximum is ${maxPoints}.`);
      }
      earnedPoints += score;
      totalPoints += maxPoints;
      questionScores[questionId] = score;
      if (card.dataset.aiUsed === "true") {
        aiAssisted = true;
        aiAssistedQuestionIds.push(questionId);
      }
    }

    if (totalPoints <= 0) throw new Error("Invalid total points.");
    const percentage = Math.round((earnedPoints / totalPoints) * 100);
    const passingScore = Number(selectedSubmission.quizDocument?.activityData?.passingScore ?? selectedSubmission.passingScore ?? 60);

    await updateDoc(doc(db, "quizAttempts", selectedSubmission.id), {
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
      gradingMode: aiAssisted ? "teacher_ai_assisted" : "teacher_reviewed",
      aiAssisted,
      aiAssistedQuestionIds,
      teacherReviewed: true,
      updatedAt: serverTimestamp()
    });

    showNotice(`Final grade saved: ${earnedPoints}/${totalPoints} (${percentage}%).`, "success");
    closeGrading();
    await loadSubmissions();
  } catch (error) {
    console.error("[EqualLearn] Grade saving error:", error);
    showNotice(error.message || "Unable to save grade.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Confirm & Save Grade";
  }
}

$("saveGrade").addEventListener("click", saveGrade);

/* -----------------------------------------------------
   FILTERS AND REFRESH
----------------------------------------------------- */
["searchSubmission", "sectionFilter", "quizFilter", "statusFilter"].forEach(id => {
  $(id).addEventListener(id === "searchSubmission" ? "input" : "change", renderSubmissions);
});
$("refreshSubmissions").addEventListener("click", loadSubmissions);
document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("open")) closeGrading(); });

requireRole("teacher", async teacherProfile => {
  currentTeacher = teacherProfile;
  if (!currentTeacher.uid) {
    showNotice("Teacher account UID is missing.", "error");
    return;
  }
  await loadSubmissions();
});
