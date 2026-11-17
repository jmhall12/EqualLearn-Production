
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN — STUDENT QUIZ
   Source: teacherActivitiesV2
   Questions: activityData.questions
========================================================= */

const $ = id => document.getElementById(id);

const quizCard = $("quizCard");
const nextBtn = $("nextBtn");
const message = $("message");

const quizId = new URLSearchParams(location.search).get("id");

let currentUser = null;
let studentProfile = null;
let quiz = null;
let questions = [];
let currentIndex = 0;
let answers = {};
let submitting = false;
let timerInterval = null;
let remainingSeconds = 0;

$("exitBtn")?.addEventListener("click", () => {
  location.href = "classwork.html";
});

/* =========================================================
   HELPERS
========================================================= */

function showMessage(text) {
  message.textContent = text;
  message.style.display = "block";
}

function hideMessage() {
  message.style.display = "none";
}

function toDate(value) {
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getQuestionId(question, index) {
  return String(question.id || `question_${index}`);
}

function getQuestionText(question) {
  return question.text || question.question || "Untitled question";
}

function getQuestionOptions(question) {
  if (Array.isArray(question.options)) {
    return question.options.filter(value =>
      String(value ?? "").trim()
    );
  }

  // Compatibility with older A/B/C/D question records.
  return ["A", "B", "C", "D"]
    .map(letter => question[`choice${letter}`])
    .filter(Boolean);
}

function getQuestionType(question) {
  return String(question.type || "multiple_choice").toLowerCase();
}

function isAnswered(question, index) {
  const value = answers[getQuestionId(question, index)];

  return value !== undefined &&
    value !== null &&
    String(value).trim() !== "";
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

/* =========================================================
   AUTHENTICATION
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  currentUser = user;

  try {
    await loadQuiz();
  } catch (error) {
    console.error("[EqualLearn] Quiz loading error:", {
      code: error.code,
      message: error.message,
      quizId,
      error
    });

    showMessage(
      "Unable to load this quiz. " +
      (error.message || "Please try again.")
    );

    quizCard.textContent = "Quiz unavailable.";
    nextBtn.disabled = true;
  }
});

/* =========================================================
   LOAD QUIZ
   Reads the same document used by Student Classwork.
========================================================= */

async function loadQuiz() {
  if (!quizId) {
    throw new Error("Missing quiz ID.");
  }

  // Load student profile.
  const profileSnap = await getDoc(
    doc(db, "users", currentUser.uid)
  );

  if (!profileSnap.exists()) {
    throw new Error("Student profile not found.");
  }

  studentProfile = profileSnap.data();

  if (String(studentProfile.role || "").toLowerCase() !== "student") {
    throw new Error("This page is for student accounts only.");
  }

  if (String(studentProfile.status || "").toLowerCase() !== "active") {
    throw new Error("Your student account is not active.");
  }

  const studentSectionId = String(
    studentProfile.sectionId || ""
  ).trim();

  if (!studentSectionId) {
    throw new Error("Your account has no assigned section.");
  }

  // IMPORTANT:
  // Student Classwork reads quiz activities from teacherActivitiesV2.
  const quizRef = doc(
    db,
    "teacherActivitiesV2",
    quizId
  );

  const quizSnap = await getDoc(quizRef);

  if (!quizSnap.exists()) {
    throw new Error("This quiz no longer exists.");
  }

  const data = quizSnap.data();

  if (String(data.type || "").toLowerCase() !== "quiz") {
    throw new Error("This activity is not a quiz.");
  }

  if (String(data.status || "").toLowerCase() !== "published") {
    throw new Error("This quiz is not currently published.");
  }

  // Check section access.
  const assignedSections = Array.isArray(data.sectionIds)
    ? data.sectionIds.map(String)
    : data.sectionId
      ? [String(data.sectionId)]
      : [];

  if (!assignedSections.includes(studentSectionId)) {
    throw new Error("This quiz is not assigned to your section.");
  }

  quiz = {
    id: quizSnap.id,
    ...data
  };

  const activityData = quiz.activityData || {};

  // Questions are stored inside activityData.questions.
  questions = Array.isArray(activityData.questions)
    ? activityData.questions
    : [];

  if (!questions.length) {
    throw new Error("This quiz has no questions.");
  }

  // Normalize question IDs for answer storage.
  questions = questions.map((question, index) => ({
    ...question,
    id: getQuestionId(question, index)
  }));

  // Check availability and deadline.
  const now = Date.now();

  const availableAt = toDate(
    activityData.availableAt || quiz.availableAt
  );

  const dueDate = toDate(
    activityData.dueDate || quiz.dueDate
  );

  if (availableAt && now < availableAt.getTime()) {
    throw new Error("This quiz is not available yet.");
  }

  if (dueDate && now > dueDate.getTime()) {
    throw new Error("The deadline for this quiz has passed.");
  }

  $("quizTitle").textContent =
    quiz.title || "Untitled Quiz";

  $("quizDescription").textContent =
    quiz.description ||
    activityData.instructions ||
    "";

  console.log("[EqualLearn] Classwork quiz loaded:", {
    quizId: quiz.id,
    title: quiz.title,
    sectionId: studentSectionId,
    questionCount: questions.length
  });

  // Start timer if the teacher configured one.
  const timeLimit = Number(activityData.timeLimit || 0);

  if (timeLimit > 0) {
    startTimer(timeLimit * 60);
  }

  renderQuestion();
}

/* =========================================================
   TIMER
========================================================= */

function startTimer(seconds) {
  remainingSeconds = seconds;

  const timerDisplay = $("timer");

  function updateTimer() {
    if (timerDisplay) {
      timerDisplay.textContent =
        `Time remaining: ${formatTime(remainingSeconds)}`;
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;

      if (!submitting) {
        showMessage("Time is up. Submitting your quiz.");
        submitQuiz(true);
      }

      return;
    }

    remainingSeconds--;
  }

  updateTimer();

  timerInterval = setInterval(updateTimer, 1000);
}

/* =========================================================
   RENDER QUESTION
========================================================= */

function renderQuestion() {
  hideMessage();

  const question = questions[currentIndex];

  if (!question) {
    showMessage("Question not found.");
    return;
  }

  $("questionProgress").textContent =
    `Question ${currentIndex + 1} of ${questions.length}`;

  $("progressBar").style.width =
    `${((currentIndex + 1) / questions.length) * 100}%`;

  quizCard.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = getQuestionText(question);

  const type = getQuestionType(question);
  const questionId = question.id;

  const answerArea = document.createElement("div");
  answerArea.className = "quiz-answer-area";

  if (type === "essay") {
    const textarea = document.createElement("textarea");

    textarea.rows = 5;
    textarea.placeholder = "Write your answer here...";
    textarea.style.width = "100%";
    textarea.style.padding = "14px";
    textarea.style.borderRadius = "12px";
    textarea.style.border = "1px solid #e4e4f0";
    textarea.style.font = "inherit";
    textarea.value = answers[questionId] || "";

    textarea.addEventListener("input", () => {
      answers[questionId] = textarea.value;
      updateNextButton();
    });

    answerArea.appendChild(textarea);

  } else if (
    type === "short_answer" ||
    type === "short-answer"
  ) {
    const input = document.createElement("input");

    input.type = "text";
    input.placeholder = "Enter your answer...";
    input.style.width = "100%";
    input.style.padding = "14px";
    input.style.borderRadius = "12px";
    input.style.border = "1px solid #e4e4f0";
    input.style.font = "inherit";
    input.value = answers[questionId] || "";

    input.addEventListener("input", () => {
      answers[questionId] = input.value;
      updateNextButton();
    });

    answerArea.appendChild(input);

  } else {
    let options = getQuestionOptions(question);

    if (
      (type === "true_false" || type === "true-false") &&
      !options.length
    ) {
      options = ["True", "False"];
    }

    if (!options.length) {
      throw new Error(
        `No answer choices found for question ${currentIndex + 1}.`
      );
    }

    options.forEach((option, index) => {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "choice";
      button.textContent = `${String.fromCharCode(65 + index)}. ${option}`;

      if (answers[questionId] === option) {
        button.classList.add("selected");
      }

      button.addEventListener("click", () => {
        answers[questionId] = option;

        answerArea.querySelectorAll(".choice").forEach(item => {
          item.classList.remove("selected");
        });

        button.classList.add("selected");

        updateNextButton();
      });

      answerArea.appendChild(button);
    });
  }

  quizCard.append(heading, answerArea);

  nextBtn.textContent =
    currentIndex === questions.length - 1
      ? "Submit Quiz"
      : "Next Question";

  updateNextButton();
}

function updateNextButton() {
  const question = questions[currentIndex];

  nextBtn.disabled = !isAnswered(question, currentIndex);
}

/* =========================================================
   NEXT / SUBMIT
========================================================= */

nextBtn.addEventListener("click", async () => {
  if (submitting) return;

  const question = questions[currentIndex];

  if (!isAnswered(question, currentIndex)) {
    showMessage("Please answer this question before continuing.");
    return;
  }

  if (currentIndex < questions.length - 1) {
    currentIndex++;
    renderQuestion();
    return;
  }

  await submitQuiz(false);
});

/* =========================================================
   SUBMIT QUIZ
========================================================= */

async function submitQuiz(timeExpired = false) {
  if (submitting) return;

  submitting = true;
  nextBtn.disabled = true;
  nextBtn.textContent = "Submitting...";

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  try {
    const activityData = quiz.activityData || {};

    const attempt = await addDoc(
      collection(db, "quizAttempts"),
      {
        quizId: quiz.id,
        quizTitle: quiz.title || "Untitled Quiz",

        userId: currentUser.uid,
        studentName:
          studentProfile.fullName ||
          studentProfile.name ||
          currentUser.displayName ||
          "",

        sectionId: studentProfile.sectionId || "",

        answers,

        status: "submitted",
        score: null,

        total: questions.reduce(
          (sum, question) => sum + Number(question.points || 1),
          0
        ),

        questionCount: questions.length,
        passingScore: Number(activityData.passingScore || 60),

        timeExpired,
        submittedAt: serverTimestamp()
      }
    );

    location.href =
      `quiz-result.html?attempt=${encodeURIComponent(attempt.id)}`;

  } catch (error) {
    console.error("[EqualLearn] Quiz submission error:", error);

    showMessage(
      "Unable to submit your quiz. " +
      (error.message || "Please try again.")
    );

    submitting = false;
    nextBtn.disabled = false;
    nextBtn.textContent =
      currentIndex === questions.length - 1
        ? "Submit Quiz"
        : "Next Question";
  }
}
