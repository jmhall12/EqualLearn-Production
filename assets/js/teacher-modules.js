
import { auth, db } from "../firebase-config.js";

import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";

// ======================================================
// EQUALLEARN TEACHER ACTIVITY BUILDER
// Compatible with the uploaded modules.html
// ======================================================

const $ = id => document.getElementById(id);

const storage = getStorage();

const COLLECTIONS = {
  users: "users",
  sections: "sections",
  modules: "modulesV2",
  activities: "teacherActivitiesV2"
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

let currentUser = null;
let profile = null;
let sections = [];
let items = [];
let editing = null;

let unsubscribeModules = null;
let unsubscribeActivities = null;

let saving = false;
let activityTypeControl = null;
let typeFields = null;

// ======================================================
// INITIALIZATION
// ======================================================

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  listenAuth();
}

// ======================================================
// EVENTS
// ======================================================

function bindEvents() {
  $("createBtn")?.addEventListener("click", () => openEditor());

  $("closeEditor")?.addEventListener("click", closeEditor);
  $("cancelEditor")?.addEventListener("click", closeEditor);

  $("activityForm")?.addEventListener("submit", event => {
    event.preventDefault();
    saveActivity("published");
  });

  $("saveDraftBtn")?.addEventListener("click", () => {
    saveActivity("draft");
  });

  $("addResource")?.addEventListener("click", () => {
    addResource();
  });

  $("publishBtn")?.addEventListener("click", event => {
  event.preventDefault();
  saveActivity("published");
});

  $("searchInput")?.addEventListener("input", renderItems);
  $("statusFilter")?.addEventListener("change", renderItems);
  $("typeFilter")?.addEventListener("change", renderItems);
  $("sectionFilter")?.addEventListener("change", renderItems);

  $("editorModal")?.addEventListener("click", event => {
    if (event.target === $("editorModal")) {
      closeEditor();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeEditor();
      closePreview();
    }
  });
}

// ======================================================
// AUTHENTICATION
// ======================================================

function listenAuth() {
  onAuthStateChanged(auth, async user => {
    stopListeners();

    if (!user) {
      location.replace("../login.html");
      return;
    }

    currentUser = user;

    try {
      const snap = await getDoc(
        doc(db, COLLECTIONS.users, user.uid)
      );

      if (!snap.exists()) {
        throw new Error("Teacher profile not found.");
      }

      profile = snap.data();

      const role = String(profile.role || "").toLowerCase();
      const status = String(profile.status || "").toLowerCase();

      if (!["teacher", "admin"].includes(role)) {
        location.replace("../login.html");
        return;
      }

      if (role === "teacher" && status !== "active") {
        throw new Error("Your teacher account is not active.");
      }

      updateTeacherInformation();

      await loadSections();

      listenItems();

    } catch (error) {
      console.error("Teacher Activity Builder:", error);

      showNotice(errorMessage(error), "error");

      showEmpty(
        "Unable to load workspace",
        errorMessage(error)
      );
    }
  });
}

function stopListeners() {
  if (unsubscribeModules) {
    unsubscribeModules();
    unsubscribeModules = null;
  }

  if (unsubscribeActivities) {
    unsubscribeActivities();
    unsubscribeActivities = null;
  }
}

function updateTeacherInformation() {
  const name =
    profile.fullName ||
    profile.name ||
    currentUser.displayName ||
    currentUser.email ||
    "Teacher";

  if ($("teacherName")) {
    $("teacherName").textContent = name;
  }

  if ($("avatar")) {
    $("avatar").textContent = name.charAt(0).toUpperCase();
  }

  if ($("teacherRole")) {
    $("teacherRole").textContent =
      String(profile.role || "teacher").toUpperCase();
  }
}

// ======================================================
// SECTIONS
// ======================================================


 
async function loadSections() {
  const sectionList = $("sectionList");

  sections = [];

  if (sectionList) {
    sectionList.textContent = "Loading sections...";
  }

  try {
    if (!currentUser?.uid) {
      throw new Error("Teacher is not authenticated.");
    }

    console.log("Loading sections for UID:", currentUser.uid);

    const sectionRef = collection(db, "sections");
    const role = String(profile?.role || "").toLowerCase();

    const found = new Map();

    if (role === "admin") {
      const snapshot = await getDocs(sectionRef);

      snapshot.forEach(d => {
        found.set(d.id, {
          id: d.id,
          ...d.data()
        });
      });
    } else {
      // Query using teacherId
      const teacherQuery = await getDocs(
        query(
          sectionRef,
          where("teacherId", "==", currentUser.uid)
        )
      );

      teacherQuery.forEach(d => {
        found.set(d.id, {
          id: d.id,
          ...d.data()
        });
      });

      // Query using teacherIds
      const teacherArrayQuery = await getDocs(
        query(
          sectionRef,
          where("teacherIds", "array-contains", currentUser.uid)
        )
      );

      teacherArrayQuery.forEach(d => {
        found.set(d.id, {
          id: d.id,
          ...d.data()
        });
      });

      // Known BSIT-4L section: verify directly if not found
      const knownSectionId = "6VwLg5Brx8Biw5Qmeb4F";

      if (!found.has(knownSectionId)) {
        const knownSection = await getDoc(
          doc(db, "sections", knownSectionId)
        );

        if (knownSection.exists()) {
          const data = knownSection.data();

          const assigned =
            data.teacherId === currentUser.uid ||
            (
              Array.isArray(data.teacherIds) &&
              data.teacherIds.includes(currentUser.uid)
            );

          if (assigned) {
            found.set(knownSection.id, {
              id: knownSection.id,
              ...data
            });
          }
        }
      }
    }

    sections = [...found.values()];

    sections.sort((a, b) =>
      sectionName(a).localeCompare(sectionName(b))
    );

    renderSections();

    console.log("Sections successfully loaded:", sections);

    if ($("sectionCount")) {
      $("sectionCount").textContent = sections.length;
    }

    if (!sections.length) {
      sectionList.textContent =
        "No assigned sections found. Check your teacher assignment and Firestore permissions.";
    }

  } catch (error) {
    console.error("LOAD SECTIONS ERROR:", error);

    if (sectionList) {
      sectionList.textContent =
        "Section loading failed: " + error.message;
    }

    showNotice(
      "Unable to load sections: " + error.message,
      "error"
    );
  }
}



function sectionName(section) {
  const course =
    section.program ||
    section.course ||
    section.programName ||
    section.courseName ||
    "";

  const year =
    section.yearLevel ||
    section.year ||
    "";

  const name =
    section.sectionName ||
    section.name ||
    section.code ||
    section.section ||
    "";

  return [
    course,
    year ? `Year ${year}` : "",
    name
  ].filter(Boolean).join(" • ") || section.id;
}

function renderSections(selected = []) {
  const list = $("sectionList");
  const filter = $("sectionFilter");

  if (!list) return;

  list.replaceChildren();

  if (!sections.length) {
    const message = document.createElement("span");
    message.textContent = "No assigned sections found.";
    list.appendChild(message);

  } else {
    sections.forEach(section => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.name = "sectionIds";
      checkbox.value = section.id;
      checkbox.checked = selected.includes(section.id);

      const text = document.createElement("span");
      text.textContent = sectionName(section);

      label.append(checkbox, text);
      list.appendChild(label);
    });
  }

  if (filter) {
    const oldValue = filter.value || "all";

    filter.replaceChildren();
    filter.add(new Option("All sections", "all"));

    sections.forEach(section => {
      filter.add(
        new Option(sectionName(section), section.id)
      );
    });

    filter.value = sections.some(s => s.id === oldValue)
      ? oldValue
      : "all";
  }

  if ($("sectionCount")) {
    $("sectionCount").textContent = sections.length;
  }
}

function selectedSections() {
  return [
    ...document.querySelectorAll(
      '#sectionList input[name="sectionIds"]:checked'
    )
  ].map(input => input.value);
}

// ======================================================
// FIRESTORE LISTENERS
// ======================================================

function listenItems() {
  const role = String(profile.role || "").toLowerCase();

  const moduleQuery = role === "admin"
    ? query(collection(db, COLLECTIONS.modules))
    : query(
        collection(db, COLLECTIONS.modules),
        where("createdBy", "==", currentUser.uid)
      );

  const activityQuery = role === "admin"
    ? query(collection(db, COLLECTIONS.activities))
    : query(
        collection(db, COLLECTIONS.activities),
        where("createdBy", "==", currentUser.uid)
      );

  let moduleItems = [];
  let activityItems = [];

  const refresh = () => {
    items = [...moduleItems, ...activityItems];

    items.sort((a, b) =>
      dateValue(b.updatedAt || b.createdAt) -
      dateValue(a.updatedAt || a.createdAt)
    );

    updateStatistics();
    renderItems();
  };

  unsubscribeModules = onSnapshot(
    moduleQuery,
    snapshot => {
      moduleItems = snapshot.docs.map(d => ({
        id: d.id,
        collectionName: COLLECTIONS.modules,
        type: "module",
        ...d.data()
      }));

      refresh();
    },
    error => {
      console.error("Module listener:", error);
      showNotice(errorMessage(error), "error");
    }
  );

  unsubscribeActivities = onSnapshot(
    activityQuery,
    snapshot => {
      activityItems = snapshot.docs.map(d => ({
        id: d.id,
        collectionName: COLLECTIONS.activities,
        ...d.data()
      }));

      refresh();
    },
    error => {
      console.error("Activity listener:", error);
      showNotice(errorMessage(error), "error");
    }
  );
}

// ======================================================
// ACTIVITY FORM CONTROLS
// ======================================================

function prepareActivityControls() {
  activityTypeControl = $("activityType");
  typeFields = $("typeFields");

  if (!activityTypeControl || !typeFields) {
    throw new Error(
      "Missing activityType or typeFields in modules.html."
    );
  }

  if (!activityTypeControl.dataset.bound) {
    activityTypeControl.addEventListener("change", () => {
      renderTypeFields();
      updateEditorLabels();
    });

    activityTypeControl.dataset.bound = "true";
  }

  return true;
}

// ======================================================
// OPEN EDITOR
// ======================================================

function openEditor(item = null) {
  try {
    prepareActivityControls();

    editing = item;

    $("activityForm")?.reset();

    $("editorTitle").textContent = item
      ? "Edit Activity"
      : "Create Activity";

    activityTypeControl.value = item?.type || "module";

    $("activityTitle").value = item?.title || "";
    $("activityCategory").value = item?.category || "Lesson";
    $("activityDescription").value = item?.description || "";

    renderSections(
      item?.sectionIds ||
      (sections.length === 1 ? [sections[0].id] : [])
    );

    renderTypeFields(item?.activityData || {});
    updateEditorLabels();

    $("resourceEditor")?.replaceChildren();

    (item?.resources || []).forEach(resource => {
      addResource(resource);
    });

    const noticeBox = $("formNotice");

    if (noticeBox) {
      noticeBox.className = "tm-notice";
      noticeBox.textContent = "";
    }

    // Modal opens even when no section is assigned.
    $("editorModal").classList.add("show");

    document.body.style.overflow = "hidden";

    if (!sections.length) {
      showFormNotice(
        "No assigned sections are available yet. Check your teacher section assignment before publishing.",
        "error"
      );
    }

  } catch (error) {
    console.error("Open editor:", error);

    showNotice(
      error.message || "Unable to open activity form.",
      "error"
    );
  }
}

function closeEditor() {
  if (saving) return;

  $("editorModal")?.classList.remove("show");

  document.body.style.overflow = "";

  editing = null;
}

function updateEditorLabels() {
  const type = activityTypeControl?.value || "module";

  const title = $("editorTitle");
  const publish = $("publishBtn");
  const draft = $("saveDraftBtn");

  if (title) {
    title.textContent = editing
      ? `Edit ${typeLabel(type)}`
      : `Create ${typeLabel(type)}`;
  }

  if (publish) {
    publish.textContent = `Publish ${typeLabel(type)}`;
  }

  if (draft) {
    draft.textContent = "Save as Draft";
  }

  const categoryLabel =
    document.querySelector('label[for="activityCategory"]');

  if (categoryLabel) {
    categoryLabel.textContent =
      type === "module" ? "Category *" : "Category";
  }
}

// ======================================================
// ACTIVITY TYPE FIELDS
// ======================================================

function renderTypeFields(data = {}) {
  const type = activityTypeControl?.value || "module";

  if (!typeFields) return;

  typeFields.replaceChildren();

  const resourceArea = $("resourceArea");

  if (resourceArea) {
    resourceArea.style.display =
      type === "module" ? "block" : "none";
  }

  if (type === "module") {
    typeFields.innerHTML = `
      <div class="tm-field">
        <strong>Learning Module</strong>
        <p style="color:#aaa;font-size:12px;margin-top:8px">
          Upload PDFs, documents, videos, or add external resource links.
        </p>
      </div>
    `;
    return;
  }

  if (type === "quiz") {
    typeFields.innerHTML = `
      <div class="tm-field">
        <label>Time Limit (minutes, 0 = no limit)</label>
        <input id="quizTime" type="number" min="0"
          value="${Number(data.timeLimit || 0)}">
      </div>

      <div class="tm-field">
        <label>Passing Score (%)</label>
        <input id="passingScore" type="number"
          min="0" max="100"
          value="${Number(data.passingScore ?? 60)}">
      </div>

      <div class="tm-field">
        <label>Quiz Questions</label>
        <div id="quizQuestions"></div>

        <button class="tm-secondary" id="addQuestion"
          type="button" style="margin-top:10px">
          ＋ Add Question
        </button>
      </div>
    `;

    (data.questions || []).forEach(question => {
      addQuestion(question);
    });

    $("addQuestion")?.addEventListener("click", () => {
      addQuestion();
    });

    if (!data.questions?.length) {
      addQuestion();
    }

    return;
  }

  if (type === "assignment") {
    typeFields.innerHTML = `
      <div class="tm-field">
        <label>Due Date *</label>
        <input id="dueDate" type="datetime-local"
          value="${escapeAttr(data.dueDate || "")}" required>
      </div>

      <div class="tm-field">
        <label>Total Points *</label>
        <input id="totalPoints" type="number" min="1"
          value="${Number(data.totalPoints || 100)}">
      </div>

      <div class="tm-field">
        <label>Submission Type</label>
        <select id="submissionType">
          <option value="file">File Upload</option>
          <option value="text">Text Response</option>
          <option value="both">File or Text</option>
        </select>
      </div>
    `;

    $("submissionType").value =
      data.submissionType || "file";

    return;
  }

  if (type === "discussion") {
    typeFields.innerHTML = `
      <div class="tm-field">
        <label>Discussion Question / Prompt *</label>
        <textarea id="discussionPrompt"
          placeholder="What would you like students to discuss?">${escapeHTML(data.prompt || "")}</textarea>
      </div>

      <div class="tm-field">
        <label>Response Instructions</label>
        <textarea id="discussionInstructions"
          placeholder="Example: Reply in at least 100 words and respond to one classmate.">${escapeHTML(data.instructions || "")}</textarea>
      </div>
    `;
  }
}

// ======================================================
// QUIZ QUESTIONS
// ======================================================

function addQuestion(question = {}) {
  const container = $("quizQuestions");
  if (!container) return;

  const card = document.createElement("div");

  card.className = "tm-question";

  card.style.cssText = `
    padding:14px;
    margin-bottom:12px;
    background:#191a25;
    border:1px solid rgba(255,255,255,.1);
    border-radius:10px;
  `;

  card.innerHTML = `
    <div class="tm-field">
      <label>Question</label>
      <textarea class="q-text"
        placeholder="Enter your question">${escapeHTML(question.text || "")}</textarea>
    </div>

    <div class="tm-field">
      <label>Question Type</label>
      <select class="q-type">
        <option value="multiple_choice">Multiple Choice</option>
        <option value="true_false">True or False</option>
        <option value="identification">Identification</option>
        <option value="essay">Essay</option>
      </select>
    </div>

    <div class="tm-field q-options-wrap">
      <label>Choices (one per line)</label>
      <textarea class="q-options"
        placeholder="Choice A&#10;Choice B&#10;Choice C&#10;Choice D">${escapeHTML((question.options || []).join("\n"))}</textarea>
    </div>

    <div class="tm-field q-answer-wrap">
      <label>Correct Answer</label>
      <input class="q-answer"
        value="${escapeAttr(question.answer || "")}"
        placeholder="Enter correct answer">
    </div>

    <div class="tm-field">
      <label>Points</label>
      <input class="q-points" type="number" min="1"
        value="${Number(question.points || 1)}">
    </div>

    <button type="button" class="tm-secondary remove-question">
      Remove Question
    </button>
  `;

  card.querySelector(".q-type").value =
    question.type || "multiple_choice";

  card.querySelector(".q-type").addEventListener("change", () => {
    updateQuestionVisibility(card);
  });

  card.querySelector(".remove-question").addEventListener("click", () => {
    card.remove();
  });

  container.appendChild(card);

  updateQuestionVisibility(card);
}

function updateQuestionVisibility(card) {
  const type = card.querySelector(".q-type").value;

  const options = card.querySelector(".q-options-wrap");
  const answer = card.querySelector(".q-answer-wrap");

  options.style.display =
    ["multiple_choice", "true_false"].includes(type)
      ? "block"
      : "none";

  answer.style.display =
    type === "essay" ? "none" : "block";

  if (type === "true_false") {
    card.querySelector(".q-options").value = "True\nFalse";
  }
}

// ======================================================
// RESOURCES
// ======================================================

function addResource(resource = {}) {
  const container = $("resourceEditor");
  if (!container) return;

  const card = document.createElement("div");

  card.className = "tm-resource";

  card.dataset.storagePath = resource.storagePath || "";
  card.dataset.existingUrl = resource.url || "";
  card.dataset.existingType = resource.type || "";

  const label = document.createElement("input");

  label.className = "resource-label";
  label.placeholder = "Resource name";
  label.value = resource.label || "";

  const url = document.createElement("input");

  url.className = "resource-url";
  url.type = "url";
  url.placeholder = "External link (optional)";

  url.value = resource.type === "link"
    ? resource.url || ""
    : "";

  const file = document.createElement("input");

  file.className = "resource-file";
  file.type = "file";

  file.accept =
    ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.zip";

  const remove = document.createElement("button");

  remove.type = "button";
  remove.className = "tm-danger";
  remove.textContent = "Remove";
  remove.title = "Remove resource";

  remove.addEventListener("click", () => {
    card.remove();
  });

  card.append(label, url, remove, file);

  container.appendChild(card);
}

async function collectResources(documentId) {
  const resources = [];

  const cards = [
    ...document.querySelectorAll("#resourceEditor .tm-resource")
  ];

  for (const card of cards) {
    const label =
      card.querySelector(".resource-label").value.trim();

    const urlValue =
      card.querySelector(".resource-url").value.trim();

    const file =
      card.querySelector(".resource-file").files[0];

    if (!label && !urlValue && !file) continue;

    if (!label) {
      throw new Error("Enter a name for each resource.");
    }

    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("Maximum file size is 100 MB.");
      }

      const path =
        `modulesV2/${currentUser.uid}/${documentId}/${Date.now()}_${safeName(file.name)}`;

      const fileRef = ref(storage, path);

      await uploadBytes(fileRef, file, {
        contentType: file.type || "application/octet-stream"
      });

      resources.push({
        label,
        fileName: file.name,
        type: file.type || "file",
        url: await getDownloadURL(fileRef),
        storagePath: path,
        size: file.size
      });

    } else if (urlValue) {
      let parsed;

      try {
        parsed = new URL(urlValue);

        if (!["https:", "http:"].includes(parsed.protocol)) {
          throw new Error();
        }

      } catch {
        throw new Error(`Invalid resource URL for "${label}".`);
      }

      resources.push({
        label,
        type: "link",
        url: parsed.href,
        storagePath: card.dataset.storagePath || ""
      });

    } else if (
      card.dataset.storagePath ||
      card.dataset.existingUrl
    ) {
      resources.push({
        label,
        type: card.dataset.existingType || "file",
        url: card.dataset.existingUrl || "",
        storagePath: card.dataset.storagePath || ""
      });
    }
  }

  return resources;
}

// ======================================================
// COLLECT ACTIVITY DATA
// ======================================================

function collectActivityData(type) {
  if (type === "module") return {};

  if (type === "quiz") {
    const questions = [
      ...document.querySelectorAll(".tm-question")
    ].map(card => ({
      text: card.querySelector(".q-text").value.trim(),
      type: card.querySelector(".q-type").value,

      options: card.querySelector(".q-options").value
        .split("\n")
        .map(value => value.trim())
        .filter(Boolean),

      answer: card.querySelector(".q-answer").value.trim(),

      points: Number(
        card.querySelector(".q-points").value || 1
      )
    }));

    if (!questions.length) {
      throw new Error("Add at least one quiz question.");
    }

    for (const question of questions) {
      if (!question.text) {
        throw new Error("Complete every quiz question.");
      }

      if (
        question.type !== "essay" &&
        !question.answer
      ) {
        throw new Error(
          "Add the correct answer for each objective question."
        );
      }

      if (
        question.type === "multiple_choice" &&
        question.options.length < 2
      ) {
        throw new Error(
          "Multiple-choice questions need at least two choices."
        );
      }
    }

    return {
      timeLimit: Number($("quizTime").value || 0),
      passingScore: Number($("passingScore").value || 60),
      questions
    };
  }

  if (type === "assignment") {
    const dueDate = $("dueDate").value;

    const totalPoints = Number(
      $("totalPoints").value || 0
    );

    if (!dueDate) {
      throw new Error("Set an assignment due date.");
    }

    if (totalPoints < 1) {
      throw new Error("Total points must be at least 1.");
    }

    return {
      dueDate,
      totalPoints,
      submissionType: $("submissionType").value
    };
  }

  if (type === "discussion") {
    const prompt =
      $("discussionPrompt").value.trim();

    if (!prompt) {
      throw new Error("Enter a discussion prompt.");
    }

    return {
      prompt,
      instructions:
        $("discussionInstructions").value.trim()
    };
  }

  return {};
}

// ======================================================
// SAVE ACTIVITY
// ======================================================

async function saveActivity(status) {
  if (saving) return;

  const type = activityTypeControl?.value || "module";

  const title = $("activityTitle").value.trim();
  const description = $("activityDescription").value.trim();
  const category = $("activityCategory").value;
  const icon = "📘";

  const sectionIds = selectedSections();

  if (!title || !description) {
    showFormNotice(
      "Complete the title and description.",
      "error"
    );
    return;
  }

  if (!sectionIds.length) {
    showFormNotice(
      "Select at least one class section.",
      "error"
    );
    return;
  }

  let activityData;

  try {
    activityData = collectActivityData(type);
  } catch (error) {
    showFormNotice(error.message, "error");
    return;
  }

  const isModule = type === "module";

  const collectionName = isModule
    ? COLLECTIONS.modules
    : COLLECTIONS.activities;

  const existing =
    editing && editing.collectionName === collectionName
      ? editing
      : null;

  const documentRef = existing
    ? doc(db, collectionName, existing.id)
    : doc(collection(db, collectionName));

  const selected = sections.filter(section =>
    sectionIds.includes(section.id)
  );

  const teacherName =
    profile.fullName ||
    profile.name ||
    currentUser.displayName ||
    currentUser.email ||
    "Teacher";

  saving = true;
  setSavingState(true);

  try {
    let resources = existing?.resources || [];

    if (isModule) {
      resources = await collectResources(documentRef.id);
    }

    const payload = {
      type,
      title,
      description,
      category,
      icon,
      status,

      sectionIds,

      sectionId:
        sectionIds.length === 1
          ? sectionIds[0]
          : null,

      sectionNames: selected.map(sectionName),

      activityData,
      resources,

      createdBy: existing?.createdBy || currentUser.uid,
      teacherId: currentUser.uid,
      teacherName,
      createdByRole: profile.role || "teacher",

      updatedAt: serverTimestamp()
    };

    if (!existing) {
      payload.createdAt = serverTimestamp();
    }

    if (status === "published") {
      payload.publishedAt = serverTimestamp();
    }

    if (existing) {
      await updateDoc(documentRef, payload);
    } else {
      await setDoc(documentRef, payload);
    }

    showNotice(
      `${typeLabel(type)} ${
        status === "published"
          ? "published"
          : "saved as draft"
      } successfully.`,
      "success"
    );

    closeEditor();

  } catch (error) {
    console.error("Save activity error:", error);

    showFormNotice(
      errorMessage(error),
      "error"
    );

  } finally {
    saving = false;
    setSavingState(false);
  }
}

function setSavingState(value) {
  [
    "publishBtn",
    "saveDraftBtn",
    "cancelEditor",
    "closeEditor",
    "addResource"
  ].forEach(id => {
    if ($(id)) {
      $(id).disabled = value;
    }
  });

  if ($("publishBtn")) {
    $("publishBtn").textContent = value
      ? "Saving..."
      : `Publish ${typeLabel(activityTypeControl?.value || "module")}`;
  }
}

// ======================================================
// RENDER ACTIVITIES
// ======================================================

function renderItems() {
  const grid = $("moduleGrid");
  if (!grid) return;

  const search =
    $("searchInput")?.value.trim().toLowerCase() || "";

  const status =
    $("statusFilter")?.value || "all";

  const section =
    $("sectionFilter")?.value || "all";

  const type =
    $("typeFilter")?.value || "all";

  const filtered = items.filter(item => {
    const text =
      `${item.title || ""} ${item.description || ""}`.toLowerCase();

    return text.includes(search)
      && (status === "all" || item.status === status)
      && (type === "all" || (item.type || "module") === type)
      && (
        section === "all" ||
        (item.sectionIds || []).includes(section)
      );
  });

  grid.replaceChildren();

  if (!filtered.length) {
    showEmpty(
      "No activities found",
      "Create a new activity or change your filters."
    );
    return;
  }

  filtered.forEach(item => {
    grid.appendChild(createCard(item));
  });
}

function createCard(item) {
  const card = document.createElement("article");
  card.className = "tm-card";

  const icons = {
    module: item.icon || "📚",
    quiz: "📝",
    assignment: "📄",
    discussion: "💬"
  };

  const cover = document.createElement("div");
  cover.className = "tm-card-cover";

  cover.textContent = icons[item.type] || "📚";

  const body = document.createElement("div");
  body.className = "tm-card-body";

  const meta = document.createElement("div");
  meta.className = "tm-meta";

  const category = document.createElement("span");
  category.textContent =
    item.category || typeLabel(item.type);

  const status = document.createElement("span");
  status.textContent =
    (item.status || "draft").toUpperCase();

  meta.append(category, status);

  const title = document.createElement("h3");
  title.textContent = item.title || "Untitled";

  const description = document.createElement("p");
  description.textContent = item.description || "";

  const resourceCount = document.createElement("p");
  resourceCount.textContent =
    `${(item.sectionNames || []).length} section(s) • ${(item.resources || []).length} resource(s)`;

  const actions = document.createElement("div");
  actions.className = "tm-actions";

  actions.append(
    actionButton("Preview", () => previewItem(item)),
    actionButton("Edit", () => openEditor(item)),
    actionButton(
      item.status === "published" ? "Archive" : "Publish",
      () => changeStatus(item)
    )
  );

  if (item.status === "archived") {
    actions.append(
      actionButton(
        "Restore",
        () => changeStatus(item, "draft")
      )
    );
  } else {
    actions.append(
      actionButton(
        "Delete",
        () => deleteActivity(item),
        true
      )
    );
  }

  body.append(
    meta,
    title,
    description,
    resourceCount,
    actions
  );

  card.append(cover, body);

  return card;
}

function actionButton(label, callback, danger = false) {
  const button = document.createElement("button");

  button.type = "button";

  button.className = danger
    ? "tm-danger"
    : "tm-small";

  button.textContent = label;

  button.addEventListener("click", callback);

  return button;
}

// ======================================================
// PREVIEW
// ======================================================

function createPreviewModal() {
  const modal = document.createElement("div");

  modal.id = "previewModal";
  modal.className = "tm-modal";

  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  modal.innerHTML = `
    <div class="tm-panel">
      <div class="tm-modal-head">
        <h2 id="previewTitle">Activity Preview</h2>

        <button class="tm-close"
          id="closePreview"
          type="button"
          aria-label="Close">×</button>
      </div>

      <p id="previewDescription"></p>

      <div id="previewResources" class="tm-resources"></div>
    </div>
  `;

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closePreview();
    }
  });

  document.body.appendChild(modal);

  $("closePreview")?.addEventListener(
    "click",
    closePreview
  );
}

function previewItem(item) {
  if (!$("previewModal")) {
    createPreviewModal();
  }

  $("previewTitle").textContent =
    item.title || "Preview";

  $("previewDescription").textContent =
    item.description || "";

  const resources = $("previewResources");

  resources.replaceChildren();

  (item.resources || []).forEach(resource => {
    if (!resource.url) return;

    const link = document.createElement("a");

    link.href = resource.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    link.textContent =
      `${resource.label || "Open Resource"} ↗`;

    resources.appendChild(link);
  });

  if (item.type !== "module") {
    const info = document.createElement("p");

    info.textContent =
      `${typeLabel(item.type)} activity. Student activity details are stored in the activity record.`;

    resources.prepend(info);
  }

  $("previewModal").classList.add("show");

  document.body.style.overflow = "hidden";
}

function closePreview() {
  $("previewModal")?.classList.remove("show");

  if (!$("editorModal")?.classList.contains("show")) {
    document.body.style.overflow = "";
  }
}

// ======================================================
// STATUS / DELETE
// ======================================================

async function changeStatus(item, forcedStatus) {
  const status = forcedStatus ||
    (item.status === "published" ? "archived" : "published");

  if (!confirm(`Change "${item.title}" to ${status}?`)) {
    return;
  }

  try {
    await updateDoc(
      doc(db, item.collectionName, item.id),
      {
        status,
        updatedAt: serverTimestamp()
      }
    );

    showNotice(`Activity ${status}.`, "success");

  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

async function deleteActivity(item) {
  if (!confirm(`Permanently delete "${item.title}"?`)) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, item.collectionName, item.id)
    );

    for (const resource of item.resources || []) {
      if (!resource.storagePath) continue;

      try {
        await deleteObject(
          ref(storage, resource.storagePath)
        );
      } catch (error) {
        console.warn("Storage cleanup:", error);
      }
    }

    showNotice("Activity deleted.", "success");

  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

// ======================================================
// STATISTICS
// ======================================================

function updateStatistics() {
  if ($("totalCount")) {
    $("totalCount").textContent = items.length;
  }

  if ($("publishedCount")) {
    $("publishedCount").textContent =
      items.filter(item => item.status === "published").length;
  }

  if ($("draftCount")) {
    $("draftCount").textContent =
      items.filter(item => item.status === "draft").length;
  }
}

// ======================================================
// EMPTY STATE
// ======================================================

function showEmpty(title, message) {
  const grid = $("moduleGrid");
  if (!grid) return;

  grid.replaceChildren();

  const box = document.createElement("div");
  box.className = "tm-state";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const text = document.createElement("p");
  text.textContent = message;

  box.append(heading, text);

  grid.appendChild(box);
}

// ======================================================
// NOTIFICATIONS
// ======================================================

function showNotice(message, type = "success") {
  const box = $("notice");

  if (!box) {
    console[type === "error" ? "error" : "log"](message);
    return;
  }

  box.className = `tm-notice show ${type}`;
  box.textContent = message;

  if (type === "success") {
    setTimeout(() => {
      box.className = "tm-notice";
      box.textContent = "";
    }, 4500);
  }
}

function showFormNotice(message, type = "error") {
  const box = $("formNotice");

  if (!box) {
    showNotice(message, type);
    return;
  }

  box.className = `tm-notice show ${type}`;
  box.textContent = message;
}

// ======================================================
// HELPERS
// ======================================================

function typeLabel(type) {
  return ({
    module: "Learning Module",
    quiz: "Quiz",
    assignment: "Assignment",
    discussion: "Discussion"
  })[type] || "Activity";
}

function dateValue(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

function safeName(name) {
  return name
    .replace(/[^\w.-]/g, "_")
    .slice(-140);
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function errorMessage(error) {
  if (error?.code === "permission-denied") {
    return "Permission denied. Check your Firestore rules.";
  }

  if (error?.code === "storage/unauthorized") {
    return "Storage upload denied. Check Firebase Storage rules.";
  }

  return error?.message ||
    "An unexpected error occurred.";
}

// ======================================================
// CLEANUP
// ======================================================

window.addEventListener("beforeunload", stopListeners);
