
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const container = document.getElementById("lessonContainer");

const params = new URLSearchParams(window.location.search);
const moduleId = params.get("module");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  if (!moduleId) {
    container.innerHTML = "<h3>Module ID is missing.</h3>";
    return;
  }

  await loadLessons();
});

async function loadLessons() {
  container.innerHTML = "Loading lessons...";

  try {
    console.log("[LESSON] Loading lessons for module:", moduleId);

    const q = query(
  collection(db, "lessons"),
  where("moduleId", "==", moduleId),
  where("status", "==", "active")
);

    const snapshot = await getDocs(q);

    console.log("[LESSON] Lessons loaded:", snapshot.size);

    if (snapshot.empty) {
      container.innerHTML = "<h3>No Lessons Available</h3>";
      return;
    }

    container.innerHTML = "";

    snapshot.forEach((lessonDoc) => {
      const lesson = lessonDoc.data();

      const card = document.createElement("div");
      card.className = "lesson-card";

      const title = document.createElement("h3");
      title.textContent = lesson.title || "Untitled Lesson";

      const description = document.createElement("p");
      description.textContent = lesson.description || "";

      card.append(title, description);

      if (lesson.pdfUrl) {
        const pdfLink = document.createElement("a");
        pdfLink.className = "btn";
        pdfLink.href = lesson.pdfUrl;
        pdfLink.target = "_blank";
        pdfLink.rel = "noopener noreferrer";
        pdfLink.textContent = "📄 Open PDF";
        card.append(pdfLink);
      }

      if (lesson.videoUrl) {
        const videoLink = document.createElement("a");
        videoLink.className = "btn secondary";
        videoLink.href = lesson.videoUrl;
        videoLink.target = "_blank";
        videoLink.rel = "noopener noreferrer";
        videoLink.textContent = "🎥 Watch Video";
        card.append(videoLink);
      }

      const quizLink = document.createElement("a");
      quizLink.className = "btn quiz";
      quizLink.href = `quiz.html?lesson=${encodeURIComponent(lessonDoc.id)}`;
      quizLink.textContent = "📝 Take Quiz";

      card.append(quizLink);
      container.append(card);
    });

  } catch (error) {
    console.error("[LESSON] Loading failed:", error);

    container.innerHTML = `
      <div class="lesson-error">
        <h3>Unable to load lessons</h3>
        <p>${escapeHTML(error.message)}</p>
        <button onclick="location.reload()">Try Again</button>
      </div>
    `;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}
