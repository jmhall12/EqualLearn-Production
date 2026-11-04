
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// =====================================================
// ELEMENTS
// =====================================================

const lessonSelect = document.getElementById("lessonSelect");
const questionList = document.getElementById("questionList");
const modal = document.getElementById("quizModal");
const openModal = document.getElementById("openModal");
const saveQuestion = document.getElementById("saveQuestion");

const quizMode = document.getElementById("quizMode");
const externalFields = document.getElementById("externalFields");
const nativeFields = document.getElementById("nativeFields");

const closeModal = document.getElementById("closeModal");
const cancelModal = document.getElementById("cancelModal");

let currentUser = null;
let currentRole = "";

// =====================================================
// AUTHENTICATION AND ROLE CHECK
// =====================================================

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {

    const profileSnapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnapshot.exists()) {
      throw new Error("User profile not found.");
    }

    const profile = profileSnapshot.data();

    currentRole = String(profile.role || "")
      .trim()
      .toLowerCase();

    if (
      currentRole !== "teacher" &&
      currentRole !== "admin"
    ) {
      alert("Only teachers and administrators can access Quiz Builder.");

      window.location.href =
        currentRole === "student"
          ? "../student/dashboard.html"
          : "../login.html";

      return;
    }

    currentUser = user;

    await loadLessons();
    await loadQuestions();

  } catch (error) {

    console.error("Quiz Builder access error:", error);

    showError(
      "Unable to verify your account. " + error.message
    );

  }

});

// =====================================================
// MODAL
// =====================================================

openModal?.addEventListener("click", async () => {

  resetForm();

  await loadLessons();

  if (modal) {
    modal.style.display = "flex";
  }

});

function hideModal() {

  if (modal) {
    modal.style.display = "none";
  }

}

closeModal?.addEventListener("click", hideModal);
cancelModal?.addEventListener("click", hideModal);

window.addEventListener("click", (event) => {

  if (event.target === modal) {
    hideModal();
  }

});

document.addEventListener("keydown", (event) => {

  if (event.key === "Escape") {
    hideModal();
  }

});

// =====================================================
// QUIZ MODE
// =====================================================

quizMode?.addEventListener("change", () => {

  const mode = quizMode.value;

  if (externalFields) {
    externalFields.style.display =
      mode === "external" ? "block" : "none";
  }

  if (nativeFields) {
    nativeFields.style.display =
      mode === "native" ? "block" : "none";
  }

});

// =====================================================
// LOAD LESSONS
// =====================================================

async function loadLessons() {

  if (!lessonSelect) return;

  lessonSelect.innerHTML =
    `<option value="">Loading lessons...</option>`;

  try {

    const snapshot = await getDocs(
      collection(db, "lessons")
    );

    const lessons = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    lessons.sort((a, b) =>
      String(a.title || "").localeCompare(
        String(b.title || "")
      )
    );

    lessonSelect.innerHTML =
      `<option value="">Select a lesson</option>`;

    lessons.forEach(lesson => {

      const option = document.createElement("option");

      option.value = lesson.id;
      option.textContent =
        lesson.title || "Untitled Lesson";

      lessonSelect.appendChild(option);

    });

  } catch (error) {

    console.error("Lessons loading error:", error);

    lessonSelect.innerHTML =
      `<option value="">Unable to load lessons</option>`;

  }

}

// =====================================================
// LOAD NATIVE QUESTIONS
// =====================================================

async function loadQuestions() {

  if (!questionList) return;

  questionList.innerHTML =
    `<p>Loading questions...</p>`;

  try {

    const lessonSnapshot = await getDocs(
      collection(db, "lessons")
    );

    const lessonMap = {};

    lessonSnapshot.forEach(item => {
      lessonMap[item.id] =
        item.data().title || "Untitled Lesson";
    });

    const snapshot = await getDocs(
      collection(db, "questions")
    );

    questionList.innerHTML = "";

    if (snapshot.empty) {
      questionList.innerHTML =
        `<p>No questions found.</p>`;
      return;
    }

    snapshot.forEach(item => {

      const question = item.data();

      const card = document.createElement("div");

      card.className = "card";

      const title = document.createElement("h3");
      title.textContent =
        question.question || "Untitled Question";

      const lesson = document.createElement("p");
      lesson.textContent =
        "Lesson: " +
        (lessonMap[question.lessonId] || "Unknown Lesson");

      const choices = document.createElement("div");
      choices.className = "choices";

      ["A", "B", "C", "D"].forEach(letter => {

        const paragraph = document.createElement("p");

        paragraph.textContent =
          `${letter}. ${question["choice" + letter] || ""}`;

        choices.appendChild(paragraph);

      });

      const answer = document.createElement("p");

      answer.textContent =
        "Correct Answer: " +
        (question.correctAnswer || "Not specified");

      const deleteButton = document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className = "delete";
      deleteButton.textContent = "Delete";

      deleteButton.addEventListener("click", () => {
        deleteQuestion(item.id, question.createdBy);
      });

      card.append(
        title,
        lesson,
        choices,
        answer,
        deleteButton
      );

      questionList.appendChild(card);

    });

  } catch (error) {

    console.error("Question loading error:", error);

    showError(
      "Unable to load questions. Check your Firestore permissions."
    );

    questionList.innerHTML =
      `<p>Unable to load questions.</p>`;

  }

}

// =====================================================
// SAVE
// =====================================================

saveQuestion?.addEventListener("click", async () => {

  if (!currentUser) {
    alert("Please log in again.");
    return;
  }

  const mode = quizMode?.value || "native";

  const lessonId = lessonSelect?.value;

  if (!lessonId) {
    alert("Please select a lesson.");
    return;
  }

  saveQuestion.disabled = true;
  saveQuestion.textContent = "Saving...";

  try {

    const lessonSnapshot = await getDoc(
      doc(db, "lessons", lessonId)
    );

    if (!lessonSnapshot.exists()) {
      throw new Error("Selected lesson does not exist.");
    }

    const lessonName =
      lessonSnapshot.data().title || "Untitled Lesson";

    if (mode === "external") {

      const title = document
        .getElementById("externalQuizTitle")
        ?.value.trim();

      const url = document
        .getElementById("externalQuizUrl")
        ?.value.trim();

      const description = document
        .getElementById("externalQuizDescription")
        ?.value.trim() || "";

      if (!title || !url) {
        throw new Error("Enter the quiz title and link.");
      }

      let parsedURL;

      try {
        parsedURL = new URL(url);
      } catch {
        throw new Error("Enter a valid quiz URL.");
      }

      if (!["https:", "http:"].includes(parsedURL.protocol)) {
        throw new Error("Only HTTP or HTTPS links are allowed.");
      }

      await addDoc(
        collection(db, "quizzes"),
        {
          title,
          description,
          quizUrl: parsedURL.href,
          lessonId,
          lessonName,
          type: "external",
          status: "active",
          createdBy: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );

      alert("External quiz link saved successfully.");

    } else {

      const question = document
        .getElementById("question")
        ?.value.trim();

      const choiceA = document
        .getElementById("choiceA")
        ?.value.trim();

      const choiceB = document
        .getElementById("choiceB")
        ?.value.trim();

      const choiceC = document
        .getElementById("choiceC")
        ?.value.trim();

      const choiceD = document
        .getElementById("choiceD")
        ?.value.trim();

      const correctAnswer = document
        .getElementById("correctAnswer")
        ?.value;

      if (!question) {
        throw new Error("Enter a question.");
      }

      if (!choiceA || !choiceB || !choiceC || !choiceD) {
        throw new Error("Complete all four choices.");
      }

      if (!["A", "B", "C", "D"].includes(correctAnswer)) {
        throw new Error("Select the correct answer.");
      }

      await addDoc(
        collection(db, "questions"),
        {
          lessonId,
          question,
          choiceA,
          choiceB,
          choiceC,
          choiceD,
          correctAnswer,
          createdBy: currentUser.uid,
          createdAt: serverTimestamp()
        }
      );

      alert("Question added successfully.");

    }

    resetForm();
    hideModal();

    await loadQuestions();

  } catch (error) {

    console.error("Quiz save error:", error);

    alert(
      "Unable to save.\n\n" + error.message
    );

  } finally {

    saveQuestion.disabled = false;
    saveQuestion.textContent = "Save";

  }

});

// =====================================================
// DELETE QUESTION
// =====================================================

async function deleteQuestion(id, createdBy) {

  if (
    currentRole !== "admin" &&
    createdBy !== currentUser?.uid
  ) {
    alert("You can only delete questions you created.");
    return;
  }

  if (!confirm("Delete this question?")) return;

  try {

    await deleteDoc(
      doc(db, "questions", id)
    );

    alert("Question deleted.");

    await loadQuestions();

  } catch (error) {

    console.error("Question delete error:", error);

    alert(
      "Unable to delete question.\n\n" + error.message
    );

  }

}

// =====================================================
// RESET FORM
// =====================================================

function resetForm() {

  [
    "question",
    "choiceA",
    "choiceB",
    "choiceC",
    "choiceD",
    "externalQuizTitle",
    "externalQuizUrl",
    "externalQuizDescription"
  ].forEach(id => {

    const field = document.getElementById(id);

    if (field) field.value = "";

  });

  if (lessonSelect) lessonSelect.value = "";

  if (quizMode) {
    quizMode.value = "native";
    quizMode.dispatchEvent(new Event("change"));
  }

  const correctAnswer =
    document.getElementById("correctAnswer");

  if (correctAnswer) {
    correctAnswer.value = "";
  }

}

// =====================================================
// ERROR MESSAGE
// =====================================================

function showError(message) {

  console.error(message);

  const existing = document.getElementById("quizError");

  if (existing) {
    existing.textContent = message;
    return;
  }

  const error = document.createElement("p");

  error.id = "quizError";
  error.className = "message error";
  error.textContent = message;

  document.querySelector(".container, main, .page")
    ?.prepend(error);

}
