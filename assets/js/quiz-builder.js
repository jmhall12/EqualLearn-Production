
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
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// =====================================================
// DOM ELEMENTS
// =====================================================

const $ = (id) => document.getElementById(id);

const quizTitle = $("quizTitle");
const quizDescription = $("quizDescription");
const lessonSelect = $("lessonSelect");
const quizMode = $("quizMode");

const externalFields = $("externalFields");
const externalQuizUrl = $("externalQuizUrl");

const sectionList = $("sectionList");
const selectedSectionCount = $("selectedSectionCount");

const passingScore = $("passingScore");
const timeLimit = $("timeLimit");
const attemptLimit = $("attemptLimit");
const availableAt = $("availableAt");
const dueDate = $("dueDate");

const shuffleQuestions = $("shuffleQuestions");
const shuffleChoices = $("shuffleChoices");

const questionEditor = $("questionEditor");
const questionType = $("questionType");
const multipleChoiceFields = $("multipleChoiceFields");

const questionInput = $("question");
const choiceA = $("choiceA");
const choiceB = $("choiceB");
const choiceC = $("choiceC");
const choiceD = $("choiceD");
const correctAnswer = $("correctAnswer");
const questionPoints = $("questionPoints");

const addQuestionButton = $("addQuestion");
const questionCount = $("questionCount");
const questionList = $("questionList");

const previewQuizButton = $("previewQuiz");
const saveDraftButton = $("saveDraft");
const publishQuizButton = $("publishQuiz");

const builderMessage = $("builderMessage");
const myQuizzes = $("myQuizzes");

const backBtn = $("backBtn");

// =====================================================
// APPLICATION STATE
// =====================================================

let currentUser = null;
let currentProfile = null;
let currentRole = "";

let lessons = [];
let sections = [];
let stagedQuestions = [];

let isSaving = false;

// =====================================================
// AUTHENTICATION
// =====================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  try {
    currentUser = user;

    const profileSnapshot = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!profileSnapshot.exists()) {
      throw new Error("User profile not found.");
    }

    currentProfile = profileSnapshot.data();

    currentRole = String(currentProfile.role || "")
      .trim()
      .toLowerCase();

    if (!["teacher", "admin"].includes(currentRole)) {
      alert("Only teachers and administrators can access Quiz Builder.");

      window.location.href =
        currentRole === "student"
          ? "../student/dashboard.html"
          : "../login.html";

      return;
    }

    await Promise.all([
      loadLessons(),
      loadSections()
    ]);

    await loadMyQuizzes();

    updateQuizMode();
    updateQuestionType();

  } catch (error) {
    console.error("Quiz Builder initialization error:", error);
    showMessage(error.message, "error");
  }
});

// =====================================================
// NAVIGATION
// =====================================================

backBtn?.addEventListener("click", () => {
  window.history.back();
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

    lessons = snapshot.docs.map((item) => ({
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

    lessons.forEach((lesson) => {
      const option = document.createElement("option");

      option.value = lesson.id;
      option.textContent = lesson.title || "Untitled Lesson";

      lessonSelect.appendChild(option);
    });

  } catch (error) {
    console.error("Lesson loading error:", error);

    lessonSelect.innerHTML =
      `<option value="">Unable to load lessons</option>`;

    throw error;
  }
}

// =====================================================
// LOAD SECTIONS
// =====================================================


async function loadSections() {
  if (!sectionList || !currentUser) return;

  sectionList.innerHTML = "<p>Loading assigned sections...</p>";

  try {
    const sectionsRef = collection(db, "sections");
    let sectionDocuments = [];

    if (currentRole === "admin") {
      // Admin can load all sections.
      const snapshot = await getDocs(sectionsRef);
      sectionDocuments = snapshot.docs;

    } else {
      // Teachers can only load sections assigned to them.
      const [multipleTeacher, singleTeacher] = await Promise.all([
        getDocs(
          query(
            sectionsRef,
            where("teacherIds", "array-contains", currentUser.uid)
          )
        ),

        getDocs(
          query(
            sectionsRef,
            where("teacherId", "==", currentUser.uid)
          )
        )
      ]);

      // Merge results and remove duplicate sections.
      const uniqueSections = new Map();

      [...multipleTeacher.docs, ...singleTeacher.docs].forEach((item) => {
        uniqueSections.set(item.id, item);
      });

      sectionDocuments = [...uniqueSections.values()];
    }

    sections = sectionDocuments.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    sections.sort((a, b) =>
      getSectionName(a).localeCompare(getSectionName(b))
    );

    renderSections();

    if (!sections.length) {
      sectionList.innerHTML =
        "<p>No sections are currently assigned to your account.</p>";
    }

  } catch (error) {
    console.error("Section loading error:", error);

    sectionList.innerHTML =
      `<p>Unable to load sections: ${error.message}</p>`;

    throw error;
  }
}


function getSectionName(section) {
  return (
    section.sectionName ||
    section.name ||
    section.title ||
    section.section ||
    "Unnamed Section"
  );
}

function renderSections() {
  if (!sectionList) return;

  sectionList.innerHTML = "";

  if (!sections.length) {
    sectionList.innerHTML =
      "<p>No available sections assigned to your account.</p>";

    updateSelectedSectionCount();
    return;
  }

  sections.forEach((section) => {
    const wrapper = document.createElement("label");

    wrapper.className = "section-option";

    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = section.id;
    checkbox.name = "quizSections";

    checkbox.addEventListener("change", updateSelectedSectionCount);

    const name = document.createElement("span");

    name.textContent = getSectionName(section);

    wrapper.append(checkbox, name);
    sectionList.appendChild(wrapper);
  });

  updateSelectedSectionCount();
}

function getSelectedSectionIds() {
  return Array.from(
    sectionList?.querySelectorAll(
      'input[name="quizSections"]:checked'
    ) || []
  ).map((checkbox) => checkbox.value);
}

function updateSelectedSectionCount() {
  if (!selectedSectionCount) return;

  selectedSectionCount.textContent =
    `${getSelectedSectionIds().length} section(s) selected`;
}

// =====================================================
// QUIZ MODE
// =====================================================

quizMode?.addEventListener("change", updateQuizMode);

function updateQuizMode() {
  const mode = quizMode?.value || "native";

  if (externalFields) {
    externalFields.style.display =
      mode === "external" ? "block" : "none";
  }

  if (questionEditor) {
    questionEditor.style.display =
      mode === "native" ? "block" : "none";
  }
}

// =====================================================
// QUESTION TYPE
// =====================================================

questionType?.addEventListener("change", updateQuestionType);

function updateQuestionType() {
  const type = questionType?.value || "multiple_choice";

  if (multipleChoiceFields) {
    multipleChoiceFields.style.display =
      type === "multiple_choice" ? "block" : "none";
  }

  if (correctAnswer) {
    if (type === "true_false") {
      correctAnswer.innerHTML = `
        <option value="">Select correct answer</option>
        <option value="A">True</option>
        <option value="B">False</option>
      `;
    } else {
      correctAnswer.innerHTML = `
        <option value="">Select correct answer</option>
        <option value="A">Choice A</option>
        <option value="B">Choice B</option>
        <option value="C">Choice C</option>
        <option value="D">Choice D</option>
      `;
    }
  }
}

// =====================================================
// ADD QUESTION TO QUIZ
// =====================================================

addQuestionButton?.addEventListener("click", addQuestion);

function addQuestion() {
  const type = questionType?.value || "multiple_choice";

  const question = questionInput?.value.trim() || "";

  if (!question) {
    showMessage("Enter a question first.", "error");
    return;
  }

  const points = Number(questionPoints?.value || 1);

  if (!Number.isFinite(points) || points <= 0) {
    showMessage("Question points must be greater than zero.", "error");
    return;
  }

  let choices = {};
  let answer = correctAnswer?.value || "";

  if (type === "multiple_choice") {
    choices = {
      A: choiceA?.value.trim() || "",
      B: choiceB?.value.trim() || "",
      C: choiceC?.value.trim() || "",
      D: choiceD?.value.trim() || ""
    };

    if (Object.values(choices).some((value) => !value)) {
      showMessage("Complete all four choices.", "error");
      return;
    }

  } else {
    choices = {
      A: "True",
      B: "False"
    };
  }

  const validAnswers = type === "true_false"
    ? ["A", "B"]
    : ["A", "B", "C", "D"];

  if (!validAnswers.includes(answer)) {
    showMessage("Select the correct answer.", "error");
    return;
  }

  stagedQuestions.push({
    order: stagedQuestions.length + 1,
    type,
    question,
    choices,
    correctAnswer: answer,
    points
  });

  resetQuestionFields();
  renderStagedQuestions();

  showMessage("Question added to your quiz.", "success");
}

function resetQuestionFields() {
  if (questionInput) questionInput.value = "";

  if (choiceA) choiceA.value = "";
  if (choiceB) choiceB.value = "";
  if (choiceC) choiceC.value = "";
  if (choiceD) choiceD.value = "";

  if (correctAnswer) correctAnswer.value = "";

  if (questionPoints) questionPoints.value = "1";
}

// =====================================================
// RENDER STAGED QUESTIONS
// =====================================================

function renderStagedQuestions() {
  if (!questionList) return;

  questionList.innerHTML = "";

  if (questionCount) {
    questionCount.textContent = stagedQuestions.length;
  }

  if (!stagedQuestions.length) {
    questionList.innerHTML =
      "<p>No questions added yet.</p>";

    return;
  }

  stagedQuestions.forEach((item, index) => {
    const card = document.createElement("div");

    card.className = "question-card";

    const heading = document.createElement("h4");

    heading.textContent =
      `${index + 1}. ${item.question}`;

    const type = document.createElement("p");

    type.textContent =
      `${item.type === "true_false" ? "True or False" : "Multiple Choice"} · ${item.points} point(s)`;

    const choices = document.createElement("div");

    Object.entries(item.choices).forEach(([letter, value]) => {
      const line = document.createElement("p");

      line.textContent = `${letter}. ${value}`;

      choices.appendChild(line);
    });

    const answer = document.createElement("p");

    answer.textContent =
      `Correct answer: ${item.correctAnswer}`;

    const remove = document.createElement("button");

    remove.type = "button";
    remove.textContent = "Remove";
    remove.className = "delete-question";

    remove.addEventListener("click", () => {
      stagedQuestions.splice(index, 1);

      stagedQuestions.forEach((question, i) => {
        question.order = i + 1;
      });

      renderStagedQuestions();
    });

    card.append(heading, type, choices, answer, remove);

    questionList.appendChild(card);
  });
}

// =====================================================
// PREVIEW QUIZ
// =====================================================

previewQuizButton?.addEventListener("click", () => {
  const title = quizTitle?.value.trim() || "Untitled Quiz";

  if (quizMode?.value === "external") {
    showMessage(
      "External quiz preview: " + title,
      "info"
    );
    return;
  }

  if (!stagedQuestions.length) {
    showMessage("Add at least one question to preview.", "error");
    return;
  }

  const preview = stagedQuestions
    .map((item, index) => {
      const choices = Object.entries(item.choices)
        .map(([letter, value]) => `${letter}. ${value}`)
        .join("\n");

      return `${index + 1}. ${item.question}\n${choices}`;
    })
    .join("\n\n");

  alert(`${title}\n\n${preview}`);
});

// =====================================================
// SAVE DRAFT / PUBLISH
// =====================================================

saveDraftButton?.addEventListener("click", () => {
  saveQuiz("draft");
});

publishQuizButton?.addEventListener("click", () => {
  saveQuiz("active");
});

async function saveQuiz(status) {
  if (isSaving) return;

  if (!currentUser) {
    showMessage("Your session has expired. Please log in again.", "error");
    return;
  }

  const title = quizTitle?.value.trim() || "";
  const description = quizDescription?.value.trim() || "";
  const lessonId = lessonSelect?.value || "";
  const mode = quizMode?.value || "native";

  const sectionIds = getSelectedSectionIds();

  if (!title) {
    showMessage("Enter a quiz title.", "error");
    return;
  }

  if (!lessonId) {
    showMessage("Select a lesson.", "error");
    return;
  }

  if (!sectionIds.length) {
    showMessage("Select at least one section.", "error");
    return;
  }

  if (mode === "native" && !stagedQuestions.length) {
    showMessage("Add at least one question.", "error");
    return;
  }

  const lesson = lessons.find((item) => item.id === lessonId);

  if (!lesson) {
    showMessage("The selected lesson could not be found.", "error");
    return;
  }

  let externalUrl = "";

  if (mode === "external") {
    externalUrl = externalQuizUrl?.value.trim() || "";

    if (!externalUrl) {
      showMessage("Enter the external quiz URL.", "error");
      return;
    }

    try {
      const parsed = new URL(externalUrl);

      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error();
      }

      externalUrl = parsed.href;

    } catch {
      showMessage("Enter a valid HTTP or HTTPS quiz URL.", "error");
      return;
    }
  }

  const passing = Number(passingScore?.value || 60);
  const time = Number(timeLimit?.value || 0);
  const attempts = Number(attemptLimit?.value || 1);

  if (!Number.isFinite(passing) || passing < 0 || passing > 100) {
    showMessage("Passing score must be between 0 and 100.", "error");
    return;
  }

  if (!Number.isFinite(time) || time < 0) {
    showMessage("Time limit cannot be negative.", "error");
    return;
  }

  if (!Number.isInteger(attempts) || attempts < 1) {
    showMessage("Attempt limit must be at least 1.", "error");
    return;
  }

  const available = availableAt?.value || "";
  const due = dueDate?.value || "";

  if (available && due && new Date(due) <= new Date(available)) {
    showMessage("The due date must be later than the availability date.", "error");
    return;
  }

  const totalPoints = mode === "native"
    ? stagedQuestions.reduce((sum, item) => sum + item.points, 0)
    : 0;

  isSaving = true;

  const saveButton = status === "draft"
    ? saveDraftButton
    : publishQuizButton;

  const originalText = saveButton?.textContent;

  if (saveDraftButton) saveDraftButton.disabled = true;
  if (publishQuizButton) publishQuizButton.disabled = true;

  if (saveButton) {
    saveButton.textContent = "Saving...";
  }

  try {
    const batch = writeBatch(db);

    const quizRef = doc(collection(db, "quizzes"));

    const quizData = {
      title,
      description,
      lessonId,
      lessonName: lesson.title || "Untitled Lesson",

      sectionIds,

      type: mode,
      status,

      quizUrl: mode === "external" ? externalUrl : "",

      passingScore: passing,
      timeLimit: time,
      attemptLimit: attempts,

      availableAt: available || null,
      dueDate: due || null,

      shuffleQuestions: Boolean(shuffleQuestions?.checked),
      shuffleChoices: Boolean(shuffleChoices?.checked),

      totalQuestions: mode === "native" ? stagedQuestions.length : 0,
      totalPoints,

      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    batch.set(quizRef, quizData);

    // Save native questions and answer keys separately.
    if (mode === "native") {
      stagedQuestions.forEach((item, index) => {
        const questionRef = doc(
          collection(db, "quizQuestions")
        );

        const answerKeyRef = doc(
          collection(db, "quizAnswerKeys")
        );

        batch.set(questionRef, {
          quizId: quizRef.id,
          order: index + 1,
          type: item.type,
          question: item.question,
          choices: item.choices,
          points: item.points,
          createdAt: serverTimestamp()
        });

        batch.set(answerKeyRef, {
          quizId: quizRef.id,
          questionId: questionRef.id,
          correctAnswer: item.correctAnswer,
          createdAt: serverTimestamp()
        });
      });
    }

    await batch.commit();

    showMessage(
      status === "active"
        ? "Quiz published successfully."
        : "Quiz saved as draft.",
      "success"
    );

    resetBuilder();

    await loadMyQuizzes();

  } catch (error) {
    console.error("Quiz save error:", error);

    showMessage(
      "Unable to save quiz: " + error.message,
      "error"
    );

  } finally {
    isSaving = false;

    if (saveDraftButton) saveDraftButton.disabled = false;
    if (publishQuizButton) publishQuizButton.disabled = false;

    if (saveButton) {
      saveButton.textContent = originalText || "Save";
    }
  }
}

// =====================================================
// LOAD CREATED QUIZZES
// =====================================================

async function loadMyQuizzes() {
  if (!myQuizzes || !currentUser) return;

  myQuizzes.innerHTML = "<p>Loading quizzes...</p>";

  try {
    let snapshot;

    if (currentRole === "admin") {
      // Admin can list all quizzes.
      snapshot = await getDocs(
        collection(db, "quizzes")
      );
    } else {
      // Teachers can only list quizzes they created.
      snapshot = await getDocs(
        query(
          collection(db, "quizzes"),
          where("createdBy", "==", currentUser.uid)
        )
      );
    }

    const quizDocuments = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    quizDocuments.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;

      return dateB - dateA;
    });

    myQuizzes.innerHTML = "";

    if (!quizDocuments.length) {
      myQuizzes.innerHTML = "<p>No quizzes created yet.</p>";
      return;
    }

    quizDocuments.forEach((quiz) => {
      const card = document.createElement("div");
      card.className = "quiz-card";

      const heading = document.createElement("h3");
      heading.textContent = quiz.title || "Untitled Quiz";

      const lesson = document.createElement("p");
      lesson.textContent =
        "Lesson: " + (quiz.lessonName || "Unknown Lesson");

      const type = document.createElement("p");
      type.textContent =
        "Type: " + (quiz.type || "native").toUpperCase();

      const status = document.createElement("p");
      status.textContent =
        "Status: " + (quiz.status || "draft").toUpperCase();

      const sectionsText = document.createElement("p");

      const assignedNames = (quiz.sectionIds || []).map((id) => {
        const section = sections.find((item) => item.id === id);
        return section ? getSectionName(section) : id;
      });

      sectionsText.textContent =
        "Sections: " + (assignedNames.join(", ") || "None");

      const count = document.createElement("p");
      count.textContent =
        "Questions: " + (quiz.totalQuestions || 0);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete Quiz";
      remove.className = "delete-quiz";

      remove.addEventListener("click", () => {
        deleteQuiz(quiz.id, quiz.createdBy);
      });

      card.append(
        heading,
        lesson,
        type,
        status,
        sectionsText,
        count,
        remove
      );

      myQuizzes.appendChild(card);
    });

  } catch (error) {
    console.error("Quiz listing error:", error);

    myQuizzes.innerHTML =
      "<p>Unable to load quizzes. Check Firestore permissions.</p>";
  }
}

// =====================================================
// DELETE QUIZ
// =====================================================

async function deleteQuiz(quizId, createdBy) {
  if (
    currentRole !== "admin" &&
    createdBy !== currentUser?.uid
  ) {
    showMessage("You can only delete quizzes you created.", "error");
    return;
  }

  if (!confirm("Delete this quiz and its questions?")) {
    return;
  }

  try {
    const [questionsSnapshot, keysSnapshot] = await Promise.all([
      getDocs(
        query(
          collection(db, "quizQuestions"),
          where("quizId", "==", quizId)
        )
      ),
      getDocs(
        query(
          collection(db, "quizAnswerKeys"),
          where("quizId", "==", quizId)
        )
      )
    ]);

    const documents = [
      ...questionsSnapshot.docs,
      ...keysSnapshot.docs
    ];

    // Firestore batches support up to 500 operations.
    for (let i = 0; i < documents.length; i += 450) {
      const batch = writeBatch(db);

      documents.slice(i, i + 450).forEach((item) => {
        batch.delete(item.ref);
      });

      await batch.commit();
    }

    const quizBatch = writeBatch(db);

    quizBatch.delete(doc(db, "quizzes", quizId));

    await quizBatch.commit();

    showMessage("Quiz deleted successfully.", "success");

    await loadMyQuizzes();

  } catch (error) {
    console.error("Quiz deletion error:", error);

    showMessage(
      "Unable to delete quiz: " + error.message,
      "error"
    );
  }
}

// =====================================================
// RESET BUILDER
// =====================================================

function resetBuilder() {
  const fields = [
    "quizTitle",
    "quizDescription",
    "externalQuizUrl",
    "availableAt",
    "dueDate"
  ];

  fields.forEach((id) => {
    const field = $(id);
    if (field) field.value = "";
  });

  if (lessonSelect) lessonSelect.value = "";

  if (passingScore) passingScore.value = "60";
  if (timeLimit) timeLimit.value = "0";
  if (attemptLimit) attemptLimit.value = "1";

  if (shuffleQuestions) shuffleQuestions.checked = false;
  if (shuffleChoices) shuffleChoices.checked = false;

  if (sectionList) {
    sectionList
      .querySelectorAll('input[name="quizSections"]')
      .forEach((checkbox) => {
        checkbox.checked = false;
      });
  }

  stagedQuestions = [];

  resetQuestionFields();
  renderStagedQuestions();
  updateSelectedSectionCount();

  if (quizMode) {
    quizMode.value = "native";
    updateQuizMode();
  }

  if (questionType) {
    questionType.value = "multiple_choice";
    updateQuestionType();
  }
}

// =====================================================
// MESSAGES
// =====================================================

function showMessage(message, type = "info") {
  console.log(`[Quiz Builder] ${message}`);

  if (!builderMessage) {
    if (type === "error") {
      alert(message);
    }
    return;
  }

  builderMessage.textContent = message;
  builderMessage.className = `builder-message ${type}`;
  builderMessage.style.display = "block";

  builderMessage.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

// =====================================================
// INITIAL UI
// =====================================================

renderStagedQuestions();
updateQuestionType();
updateQuizMode();
