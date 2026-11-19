import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const panel = $("integratedQuizPanel");
const normalPanel = document.querySelector("main.wrap > .panel");
const editor = $("eqQuizEditor");
const list = $("eqQuizList");
const form = $("eqQuizForm");

let user = null, profile = {}, role = "teacher";
let sections = [], lessons = [], quizzes = [], staged = [], editingQuizId = null;
let currentTab = "modules";

onAuthStateChanged(auth, async signedInUser => {
  if (!signedInUser) return;
  user = signedInUser;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) throw new Error("User profile was not found.");

    profile = snap.data();
    role = String(profile.role || "").toLowerCase();

    if (!["teacher", "admin"].includes(role)) return;

    await Promise.all([loadSections(), loadLessons(), loadQuizzes()]);
    renderQuizList();

  } catch (error) {
    console.error("[EQUALLEARN QUIZ] Initialization failed", error);
    list.innerHTML = `<div class="empty">Unable to load quiz builder: ${escapeHTML(error.message)}</div>`;
  }
});

// The original content manager remains responsible for all non-quiz tabs.
document.querySelectorAll("[data-type]").forEach(tab => {
  tab.addEventListener("click", () => {
    currentTab = tab.dataset.type;
    const isQuiz = currentTab === "quizzes";

    if (normalPanel) normalPanel.hidden = isQuiz;
    panel.hidden = !isQuiz;

    if (isQuiz) {
      $("createBtn").hidden = true;
      renderQuizList();
    } else {
      $("createBtn").hidden = false;
      closeQuizEditor();
    }
  });
});

$("eqNewQuiz").addEventListener("click", () => openQuizEditor());
$("eqCancel").addEventListener("click", closeQuizEditor);
$("eqAddQuestion").addEventListener("click", () => addQuestion());
$("eqMode").addEventListener("change", updateMode);
$("eqSaveDraft").addEventListener("click", () => saveQuiz("draft"));

form.addEventListener("submit", event => {
  event.preventDefault();
  saveQuiz("active");
});

async function loadSections() {
  const ref = collection(db, "sections");
  let docs = [];

  if (role === "admin") {
    const s = await getDocs(ref);
    docs = s.docs;
  } else {
    const results = await Promise.allSettled([
      getDocs(query(ref, where("teacherIds", "array-contains", user.uid))),
      getDocs(query(ref, where("teacherId", "==", user.uid)))
    ]);

    const unique = new Map();

    results.forEach(r => {
      if (r.status === "fulfilled") {
        r.value.docs.forEach(d => unique.set(d.id, d));
      }
    });

    docs = [...unique.values()];
  }

  sections = docs.map(d => ({ id: d.id, ...d.data() }));
  renderSectionChoices([]);
}

async function loadLessons() {
  const ref = collection(db, "lessons");
  let docs = [];

  if (role === "admin") {
    const s = await getDocs(ref);
    docs = s.docs;
  } else {
    const results = await Promise.allSettled([
      getDocs(query(ref, where("createdBy", "==", user.uid))),
      getDocs(query(ref, where("teacherId", "==", user.uid)))
    ]);

    const unique = new Map();

    results.forEach(r => {
      if (r.status === "fulfilled") {
        r.value.docs.forEach(d => unique.set(d.id, d));
      }
    });

    docs = [...unique.values()];
  }

  lessons = docs.map(d => ({ id: d.id, ...d.data() }));

  const select = $("eqLesson");
  select.replaceChildren(new Option("No linked lesson", ""));

  lessons
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    .forEach(item => {
      select.add(new Option(item.title || "Untitled lesson", item.id));
    });
}

async function loadQuizzes() {
  const ref = collection(db, "quizzes");
  let docs = [];

  if (role === "admin") {
    const s = await getDocs(ref);
    docs = s.docs;
  } else {
    const results = await Promise.allSettled([
      getDocs(query(ref, where("createdBy", "==", user.uid))),
      getDocs(query(ref, where("teacherId", "==", user.uid)))
    ]);

    const unique = new Map();

    results.forEach(r => {
      if (r.status === "fulfilled") {
        r.value.docs.forEach(d => unique.set(d.id, d));
      }
    });

    docs = [...unique.values()];
  }

  quizzes = docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
}

function renderSectionChoices(selected = []) {
  const wrap = $("eqSections");
  wrap.replaceChildren();

  if (!sections.length) {
    wrap.innerHTML = '<span class="hint">No assigned sections found. Ask an administrator to assign your section.</span>';
    return;
  }

  sections.forEach(section => {
    const label = document.createElement("label");
    label.className = "eq-section-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = section.id;
    input.checked = selected.includes(section.id);

    const text = document.createElement("span");
    text.textContent = sectionLabel(section);

    label.append(input, text);
    wrap.append(label);
  });
}

function renderQuizList() {
  if (!list) return;

  if (!quizzes.length) {
    list.innerHTML = '<div class="empty">No quizzes yet. Click “Create Quiz” to build your first quiz.</div>';
    return;
  }

  list.replaceChildren();

  quizzes.forEach(quiz => {
    const card = document.createElement("article");
    card.className = "item";

    const info = document.createElement("div");
    info.style.flex = "1";

    const title = document.createElement("h3");
    title.textContent = quiz.title || "Untitled quiz";

    const desc = document.createElement("p");
    desc.textContent = quiz.description ||
      (quiz.type === "external" ? quiz.quizUrl || "External quiz" : "Native quiz");

    const meta = document.createElement("div");
    meta.className = "meta";

    pill(meta, String(quiz.status || "draft").toUpperCase());
    pill(meta, quiz.type === "external"
      ? "EXTERNAL"
      : `${Number(quiz.totalQuestions) || 0} QUESTIONS`);
    pill(meta, `${(quiz.sectionIds || []).length} SECTION(S)`);

    info.append(title, desc, meta);

    const actions = document.createElement("div");
    actions.className = "eq-list-actions";

    actions.append(
      actionButton("Edit", () => editQuiz(quiz)),
      actionButton(
        quiz.status === "archived" ? "Restore" : "Archive",
        () => setQuizStatus(
          quiz,
          quiz.status === "archived" ? "draft" : "archived"
        )
      ),
      actionButton("Delete", () => deleteQuiz(quiz), "danger")
    );

    card.append(info, actions);
    list.append(card);
  });
}

function openQuizEditor(quiz = null) {
  editingQuizId = quiz?.id || null;
  staged = [];

  form.reset();

  $("eqTitle").value = quiz?.title || "";
  $("eqDescription").value = quiz?.description || "";
  $("eqLesson").value = quiz?.lessonId || "";
  $("eqMode").value = quiz?.type === "external" ? "external" : "native";
  $("eqExternalUrl").value = quiz?.quizUrl || "";
  $("eqPassing").value = quiz?.passingScore ?? 60;
  $("eqTime").value = quiz?.timeLimit ?? 0;
  $("eqAttempts").value = quiz?.attemptLimit ?? 1;
  $("eqAvailable").value = dateInput(quiz?.availableAt);
  $("eqDue").value = dateInput(quiz?.dueDate);

  $("eqShuffleQ").checked = !!quiz?.shuffleQuestions;
  $("eqShuffleC").checked = !!quiz?.shuffleChoices;

  renderSectionChoices(quiz?.sectionIds || []);

  $("eqMessage").textContent = "";
  $("eqMessage").className = "";

  if (quiz?.id && quiz.type !== "external") {
    loadQuizQuestions(quiz.id);
  }

  renderQuestions();
  updateMode();

  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function editQuiz(quiz) {
  openQuizEditor(quiz);
}

async function loadQuizQuestions(quizId) {
  try {
    const qs = await getDocs(
      query(collection(db, "quizQuestions"), where("quizId", "==", quizId))
    );

    const keys = await getDocs(
      query(collection(db, "quizAnswerKeys"), where("quizId", "==", quizId))
    );

    const keyMap = new Map(
      keys.docs.map(d => [d.data().questionId, d.data().correctAnswer])
    );

    staged = qs.docs
      .map(d => ({
        id: d.id,
        ...d.data(),
        correctAnswer: keyMap.get(d.id) ?? "A"
      }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    renderQuestions();

  } catch (error) {
    console.error(error);
    message("Could not load quiz questions: " + error.message, "error");
  }
}

function addQuestion(data = {}) {
  if (staged.length >= 200) {
    return message("Maximum of 200 questions per quiz.", "error");
  }

  staged.push({
    type: data.type || "multiple-choice",
    question: data.question || "",
    choices: data.choices || ["", "", "", ""],
    correctAnswer: data.correctAnswer || "A",
    points: Number(data.points) || 1
  });

  renderQuestions();
}

function renderQuestions() {
  const wrap = $("eqQuestions");
  wrap.replaceChildren();

  staged.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "eq-q-card";

    const top = document.createElement("div");
    top.className = "eq-q-top";

    const label = document.createElement("span");
    label.textContent = `Question ${index + 1}`;

    const remove = actionButton(
      "Remove",
      () => {
        staged.splice(index, 1);
        renderQuestions();
      },
      "danger"
    );

    top.append(label, remove);

    const fields = document.createElement("div");
    fields.className = "eq-q-fields";

    const type = document.createElement("select");
    type.innerHTML = `
      <option value="multiple-choice">Multiple Choice</option>
      <option value="true-false">True / False</option>
    `;
    type.value = q.type;

    const points = document.createElement("input");
    points.type = "number";
    points.min = "1";
    points.max = "1000";
    points.value = q.points || 1;
    points.setAttribute("aria-label", "Question points");

    const question = document.createElement("textarea");
    question.rows = 2;
    question.placeholder = "Enter your question...";
    question.value = q.question || "";

    type.addEventListener("change", () => {
      q.type = type.value;

      if (q.type === "true-false") {
        q.choices = ["True", "False"];
        q.correctAnswer = ["True", "False"].includes(q.correctAnswer)
          ? q.correctAnswer
          : "True";
      } else {
        q.choices = q.choices?.length === 4
          ? q.choices
          : ["", "", "", ""];

        q.correctAnswer = ["A", "B", "C", "D"].includes(q.correctAnswer)
          ? q.correctAnswer
          : "A";
      }

      renderQuestions();
    });

    points.addEventListener("input", () => {
      q.points = Math.max(1, Number(points.value) || 1);
    });

    question.addEventListener("input", () => {
      q.question = question.value;
    });

    fields.append(type, points);
    card.append(top, fields, question);

    if (q.type === "true-false") {
      const correct = document.createElement("select");
      correct.setAttribute("aria-label", "Correct answer");

      correct.add(new Option("True is correct", "True"));
      correct.add(new Option("False is correct", "False"));

      correct.value = q.correctAnswer || "True";

      correct.addEventListener("change", () => {
        q.correctAnswer = correct.value;
      });

      card.append(correct);

    } else {
      const choices = document.createElement("div");
      choices.className = "eq-choice-grid";

      ["A", "B", "C", "D"].forEach((letter, i) => {
        const input = document.createElement("input");
        input.placeholder = `Choice ${letter}`;
        input.value = q.choices?.[i] || "";

        input.addEventListener("input", () => {
          q.choices[i] = input.value;
        });

        choices.append(input);
      });

      const correct = document.createElement("select");
      correct.setAttribute("aria-label", "Correct answer");

      ["A", "B", "C", "D"].forEach(v => {
        correct.add(new Option(`Correct answer: ${v}`, v));
      });

      correct.value = q.correctAnswer || "A";

      correct.addEventListener("change", () => {
        q.correctAnswer = correct.value;
      });

      card.append(choices, correct);
    }

    wrap.append(card);
  });
}

function updateMode() {
  const external = $("eqMode").value === "external";

  $("eqExternalWrap").hidden = !external;
  $("eqQuestionArea").hidden = external;
}

async function saveQuiz(status) {
  const title = $("eqTitle").value.trim();
  const description = $("eqDescription").value.trim();

  const sectionIds = [
    ...$("eqSections").querySelectorAll("input:checked")
  ].map(x => x.value);

  const type = $("eqMode").value;
  const quizUrl = type === "external"
    ? validUrl($("eqExternalUrl").value)
    : "";

  if (!title) return message("Quiz title is required.", "error");
  if (!sectionIds.length) return message("Select at least one section.", "error");

  if (type === "external" && !quizUrl) {
    return message("Enter a valid external quiz URL.", "error");
  }

  if (type === "native" && status === "active" && !staged.length) {
    return message("Add at least one question before publishing.", "error");
  }

  if (type === "native") {
    for (let i = 0; i < staged.length; i++) {
      const q = staged[i];

      if (!q.question?.trim()) {
        return message(`Question ${i + 1} is empty.`, "error");
      }

      if (
        q.type === "multiple-choice" &&
        (q.choices || []).some(c => !String(c).trim())
      ) {
        return message(
          `Complete all four choices in Question ${i + 1}.`,
          "error"
        );
      }
    }
  }

  const availableAt = parseDate($("eqAvailable").value);
  const dueDate = parseDate($("eqDue").value);

  if (availableAt && dueDate && dueDate < availableAt) {
    return message(
      "Due date cannot be earlier than the availability date.",
      "error"
    );
  }

  const lesson = lessons.find(l => l.id === $("eqLesson").value);

  const totalPoints = type === "native"
    ? staged.reduce((n, q) => n + (Number(q.points) || 1), 0)
    : 0;

  const selected = sections.filter(s => sectionIds.includes(s.id));

  const payload = {
    title,
    description,
    lessonId: lesson?.id || "",
    lessonName: lesson?.title || "",
    sectionIds,
    sectionId: sectionIds.length === 1 ? sectionIds[0] : null,
    sectionNames: selected.map(sectionLabel),
    type,
    status,
    quizUrl: type === "external" ? quizUrl : "",
    passingScore: clamp($("eqPassing").value, 0, 100, 60),
    timeLimit: clamp($("eqTime").value, 0, 600, 0),
    attemptLimit: clamp($("eqAttempts").value, 1, 20, 1),
    availableAt,
    dueDate,
    shuffleQuestions: $("eqShuffleQ").checked,
    shuffleChoices: $("eqShuffleC").checked,
    totalQuestions: type === "native" ? staged.length : 0,
    totalPoints,
    createdBy: user.uid,
    createdByRole: role,
    teacherId: user.uid,
    teacherName:
      profile.fullName ||
      profile.name ||
      user.displayName ||
      user.email ||
      "Teacher",
    updatedAt: serverTimestamp()
  };

  const buttons = [$("eqSaveDraft"), $("eqPublish")];
  buttons.forEach(b => b.disabled = true);

  message("Saving quiz…");

  try {
    let quizId = editingQuizId;

    if (quizId) {
      const old = quizzes.find(q => q.id === quizId);

      payload.createdBy = old?.createdBy || user.uid;
      payload.createdAt = old?.createdAt || serverTimestamp();

      await updateDoc(doc(db, "quizzes", quizId), payload);

    } else {
      payload.createdAt = serverTimestamp();

      const ref = await addDoc(collection(db, "quizzes"), payload);
      quizId = ref.id;
    }

    if (type === "native") {
      await replaceQuizQuestions(quizId, staged);
    } else {
      await replaceQuizQuestions(quizId, []);
    }

    await loadQuizzes();
    renderQuizList();

    message(
      status === "active"
        ? "Quiz published successfully."
        : "Quiz draft saved successfully.",
      "success"
    );

    setTimeout(closeQuizEditor, 500);

  } catch (error) {
    console.error("[EQUALLEARN QUIZ] Save failed", error);
    message(error.message || "Unable to save quiz.", "error");

  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

async function replaceQuizQuestions(quizId, questions) {
  const oldQ = await getDocs(
    query(collection(db, "quizQuestions"), where("quizId", "==", quizId))
  );

  const oldA = await getDocs(
    query(collection(db, "quizAnswerKeys"), where("quizId", "==", quizId))
  );

  const deletions = [
    ...oldQ.docs.map(d => d.ref),
    ...oldA.docs.map(d => d.ref)
  ];

  for (let i = 0; i < deletions.length; i += 450) {
    const batch = writeBatch(db);

    deletions
      .slice(i, i + 450)
      .forEach(ref => batch.delete(ref));

    await batch.commit();
  }

  for (let i = 0; i < questions.length; i += 200) {
    const batch = writeBatch(db);

    questions.slice(i, i + 200).forEach((q, offset) => {
      const order = i + offset + 1;
      const qRef = doc(collection(db, "quizQuestions"));

      const choices = q.type === "true-false"
        ? ["True", "False"]
        : q.choices.map(String);

      batch.set(qRef, {
        quizId,
        order,
        type: q.type,
        question: q.question.trim(),
        choices,
        points: Math.max(1, Number(q.points) || 1),
        createdAt: serverTimestamp()
      });

      batch.set(doc(collection(db, "quizAnswerKeys")), {
        quizId,
        questionId: qRef.id,
        correctAnswer: q.correctAnswer,
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
  }
}

async function setQuizStatus(quiz, status) {
  if (!confirm(`${status === "archived" ? "Archive" : "Restore"} “${quiz.title}”?`)) {
    return;
  }

  try {
    await updateDoc(doc(db, "quizzes", quiz.id), {
      status,
      updatedAt: serverTimestamp()
    });

    await loadQuizzes();
    renderQuizList();

  } catch (e) {
    alert(e.message || "Could not update quiz.");
  }
}

async function deleteQuiz(quiz) {
  if (!confirm(`Permanently delete “${quiz.title}” and its questions? This cannot be undone.`)) {
    return;
  }

  try {
    await replaceQuizQuestions(quiz.id, []);
    await deleteDoc(doc(db, "quizzes", quiz.id));

    await loadQuizzes();
    renderQuizList();

  } catch (e) {
    alert(e.message || "Could not delete quiz.");
  }
}

function closeQuizEditor() {
  editor.hidden = true;
  editingQuizId = null;
  staged = [];
  form.reset();
  $("eqQuestions").replaceChildren();
}

function message(text, type = "") {
  const el = $("eqMessage");
  el.textContent = text;
  el.className = type;
}

function sectionLabel(s) {
  const course = s.program || s.course || s.programName || s.courseName || "";
  const year = s.yearLevel || s.year || s.level || "";
  const name = s.sectionName || s.name || s.code || s.section || "";

  return [
    course,
    year ? `Year ${year}` : "",
    name
  ].filter(Boolean).join(" • ") || `Section ${s.id}`;
}

function pill(parent, text) {
  const span = document.createElement("span");
  span.className = "pill";
  span.textContent = text;
  parent.append(span);
}

function actionButton(text, handler, cls = "light") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.addEventListener("click", handler);
  return b;
}

function validUrl(value) {
  try {
    const u = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

function parseDate(value) {
  if (!value) return null;

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateInput(value) {
  if (!value) return "";

  const d = typeof value.toDate === "function"
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(d.getTime())) return "";

  return new Date(
    d.getTime() - d.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);
}

function dateValue(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function clamp(value, min, max, fallback) {
  const n = Number(value);

  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}