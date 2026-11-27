import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const container = document.getElementById("progressContainer");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  if (!container) {
    console.error("Progress container was not found.");
    return;
  }

  container.setAttribute("aria-busy", "true");
  container.replaceChildren(createState("Loading your results..."));

  try {
    // Keep the existing Firestore source and per-student filter unchanged.
    const progressQuery = query(
      collection(db, "progress"),
      where("userId", "==", user.uid)
    );

    const snapshot = await getDocs(progressQuery);
    container.replaceChildren();

    if (snapshot.empty) {
      container.appendChild(createState("No progress yet."));
      return;
    }

    snapshot.forEach((item, index) => {
      container.appendChild(createProgressCard(item.data(), index));
    });
  } catch (error) {
    console.error("Progress error:", error);
    container.replaceChildren(
      createState("Failed to load progress. Please refresh and try again.")
    );
  } finally {
    container.setAttribute("aria-busy", "false");
  }
});

function createProgressCard(data, index) {
  const score = Number(data.score ?? 0);
  const total = Number(data.total ?? 0);
  const percentage = Number(
    data.percentage ?? (total > 0 ? (score / total) * 100 : 0)
  );
  const safePercentage = Number.isFinite(percentage)
    ? Math.max(0, Math.min(100, percentage))
    : 0;

  const rawResult = String(data.result ?? "").trim().toLowerCase();
  const rawStatus = String(data.status ?? "graded").trim();
  const pending = ["pending", "submitted", "for checking", "pending grading"].includes(rawStatus.toLowerCase())
    && !["passing", "passed", "pass", "failing", "failed", "fail"].includes(rawResult);
  const passed = ["passing", "passed", "pass"].includes(rawResult);
  const resultLabel = pending ? "PENDING" : passed ? "PASSING" : "FAILING";
  const resultClass = pending ? "pending" : passed ? "passing" : "failing";
  const title = data.quizTitle || data.title || data.lessonId || data.activityTitle || "Quiz assessment";
  const date = formatDate(
    data.submittedAt || data.createdAt || data.completedAt || data.updatedAt || data.timestamp || data.date
  );

  const card = document.createElement("article");
  card.className = "progress-card";

  const revealButton = document.createElement("button");
  revealButton.type = "button";
  revealButton.className = "progress-reveal";
  revealButton.setAttribute("aria-expanded", "false");
  revealButton.setAttribute("aria-controls", `progress-details-${index}`);
  revealButton.setAttribute("aria-label", `Reveal result details for ${title}`);

  const copy = document.createElement("span");
  copy.className = "progress-reveal-copy";

  const kicker = document.createElement("span");
  kicker.className = "progress-kicker";
  kicker.textContent = String(data.type || data.category || "Quiz assessment").toUpperCase();

  const heading = document.createElement("span");
  heading.className = "progress-title";
  heading.textContent = String(title);

  copy.append(kicker, heading);

  const resultBadge = document.createElement("span");
  resultBadge.className = `progress-result ${resultClass}`;
  resultBadge.textContent = resultLabel;

  const chevron = document.createElement("span");
  chevron.className = "progress-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";

  revealButton.append(copy, resultBadge, chevron);

  const details = document.createElement("div");
  details.className = "progress-details";
  details.id = `progress-details-${index}`;
  details.hidden = true;

  details.append(
    createDetail("Score", `${formatNumber(score)} / ${formatNumber(total)}`),
    createDetail("Grade", `${formatNumber(safePercentage)}%`),
    createDetail("Status", rawStatus || "Graded"),
    createDetail("Date", date)
  );

  revealButton.addEventListener("click", () => {
    const isExpanded = revealButton.getAttribute("aria-expanded") === "true";
    revealButton.setAttribute("aria-expanded", String(!isExpanded));
    details.hidden = isExpanded;
  });

  card.append(revealButton, details);
  return card;
}

function createDetail(label, value) {
  const item = document.createElement("div");
  item.className = "progress-detail";

  const labelElement = document.createElement("span");
  labelElement.className = "progress-detail-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("strong");
  valueElement.className = "progress-detail-value";
  valueElement.textContent = value || "—";

  item.append(labelElement, valueElement);
  return item;
}

function createState(message) {
  const state = document.createElement("p");
  state.className = "progress-state";
  state.textContent = message;
  return state;
}

function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "0";
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  let dateValue = value;
  if (typeof value.toDate === "function") {
    dateValue = value.toDate();
  } else if (typeof value === "object" && typeof value.seconds === "number") {
    dateValue = new Date(value.seconds * 1000);
  } else if (!(value instanceof Date)) {
    dateValue = new Date(value);
  }

  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return "Date unavailable";
  }

  return dateValue.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
