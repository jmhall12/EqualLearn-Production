import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const quizCard = $("quizCard");
const nextBtn = $("nextBtn");
const message = $("message");

const quizId = new URLSearchParams(location.search).get("id");

let currentUser = null;
let quiz = null;
let questions = [];
let currentIndex = 0;
let answers = {};
let submitting = false;

$("exitBtn").addEventListener("click", () => {
  location.href = "dashboard.html";
});

function showMessage(text) {
  message.textContent = text;
  message.style.display = "block";
}

function hideMessage() {
  message.style.display = "none";
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  currentUser = user;

  try {
    await loadQuiz();
  } catch (error) {
    console.error("Quiz loading error:", error);
    showMessage("Unable to load this quiz. " + error.message);
    quizCard.textContent = "Quiz unavailable.";
    nextBtn.disabled = true;
  }
});

async function loadQuiz() {
  if (!quizId) throw new Error("Missing quiz ID.");

  const profileSnap = await getDoc(doc(db, "users", currentUser.uid));

  if (!profileSnap.exists()) throw new Error("Student profile not found.");

  const profile = profileSnap.data();

  if (
    String(profile.role).toLowerCase() !== "student" ||
    profile.status !== "active"
  ) {
    throw new Error("An active student account is required.");
  }

  const quizSnap = await getDoc(doc(db, "quizzes", quizId));

  if (!quizSnap.exists()) throw new Error("Quiz not found.");

  quiz = { id: quizSnap.id, ...quizSnap.data() };

  if (quiz.status !== "active") {
    throw new Error("This quiz is not currently published.");
  }

  if (
    !Array.isArray(quiz.sectionIds) ||
    !quiz.sectionIds.includes(profile.sectionId)
  ) {
    throw new Error("This quiz is not assigned to your section.");
  }

  const now = Date.now();
  const availableAt = quiz.availableAt?.toDate?.()?.getTime();
  const dueDate = quiz.dueDate?.toDate?.()?.getTime();

  if (availableAt && now < availableAt) {
    throw new Error("This quiz is not available yet.");
  }

  if (dueDate && now > dueDate) {
    throw new Error("The deadline for this quiz has passed.");
  }

  $("quizTitle").textContent = quiz.title || "Untitled Quiz";
  $("quizDescription").textContent = quiz.description || "";

  const questionQuery = query(
    collection(db, "quizQuestions"),
    where("quizId", "==", quizId)
  );

  const snapshot = await getDocs(questionQuery);

  questions = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  questions.sort((a, b) => (a.order || 0) - (b.order || 0));

  if (!questions.length) {
    throw new Error("This quiz has no questions.");
  }

  renderQuestion();
}

function renderQuestion() {
  hideMessage();

  const question = questions[currentIndex];

  $("questionProgress").textContent =
    `Question ${currentIndex + 1} of ${questions.length}`;

  $("progressBar").style.width =
    `${((currentIndex + 1) / questions.length) * 100}%`;

  quizCard.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = question.question || "Untitled question";

  const choices = document.createElement("div");

  ["A", "B", "C", "D"].forEach(letter => {
    const value = question["choice" + letter];

    if (!value) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = `${letter}. ${value}`;

    if (answers[question.id] === letter) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      answers[question.id] = letter;

      choices.querySelectorAll(".choice").forEach(item =>
        item.classList.remove("selected")
      );

      button.classList.add("selected");
      nextBtn.disabled = false;
    });

    choices.appendChild(button);
  });

  quizCard.append(heading, choices);

  nextBtn.textContent =
    currentIndex === questions.length - 1
      ? "Submit Quiz"
      : "Next Question";

  nextBtn.disabled = !answers[question.id];
}

nextBtn.addEventListener("click", async () => {
  if (submitting) return;

  const question = questions[currentIndex];

  if (!answers[question.id]) {
    showMessage("Please select an answer before continuing.");
    return;
  }

  if (currentIndex < questions.length - 1) {
    currentIndex++;
    renderQuestion();
    return;
  }

  await submitQuiz();
});

async function submitQuiz() {
  submitting = true;
  nextBtn.disabled = true;
  nextBtn.textContent = "Submitting...";

  try {
    // This stores submitted answers without exposing answer keys.
    // Secure automatic grading will be handled by a trusted backend.
    const attempt = await addDoc(collection(db, "quizAttempts"), {
      quizId,
      userId: currentUser.uid,
      answers,
      status: "submitted",
      score: null,
      total: questions.length,
      submittedAt: serverTimestamp()
    });

    location.href =
      `quiz-result.html?attempt=${encodeURIComponent(attempt.id)}`;

  } catch (error) {
    console.error("Quiz submission error:", error);
    showMessage("Unable to submit your quiz. " + error.message);
    submitting = false;
    nextBtn.disabled = false;
    nextBtn.textContent = "Submit Quiz";
  }
}