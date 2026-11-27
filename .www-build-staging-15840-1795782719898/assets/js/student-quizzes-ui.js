/* EqualLearn student quizzes — compact accordion and filters.
   Deliberately leaves Firebase loading and quiz availability decisions
   in the existing student-quizzes.js file. */

const list = document.getElementById("quizList");
const searchInput = document.getElementById("quizSearch");
const countLabel = document.getElementById("quizCount");
const filterEmpty = document.getElementById("quizFilterEmpty");
const emptyState = document.getElementById("quizEmpty");
const filterButtons = [...document.querySelectorAll("[data-quiz-filter]")];

let activeFilter = "all";
let observer = null;

const ICON_CHEVRON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6"></path>
  </svg>`;

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function enhanceQuizItem(item) {
  if (!(item instanceof HTMLElement) || item.dataset.compactReady === "true") return;

  const main = item.querySelector(".quiz-item-main");
  const title = main?.querySelector("h3");
  if (!main || !title) return;

  const titleText = title.textContent.trim();
  if (!titleText || /^(loading|retrieving)/i.test(titleText)) return;

  const status = main.querySelector(".quiz-status") || item.querySelector(".quiz-status");
  const teacher = main.querySelector(".quiz-eyebrow");
  const teacherText = teacher?.textContent.trim() || "TEACHER ASSIGNED";

  const toggle = makeElement("button", "quiz-row-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", `Reveal details for ${titleText}`);

  const copy = makeElement("span", "quiz-row-copy");
  const top = makeElement("span", "quiz-row-top");
  top.appendChild(makeElement("span", "quiz-row-teacher", teacherText));

  if (status) {
    status.remove();
    top.appendChild(status);
  }

  copy.append(top, makeElement("span", "quiz-row-title", titleText));
  const chevron = makeElement("span", "quiz-row-chevron");
  chevron.innerHTML = ICON_CHEVRON;
  toggle.append(copy, chevron);

  title.remove();
  teacher?.remove();

  // Retain the full existing quiz description, deadline, attached resources,
  // and action link, but put them inside the collapsed detail panel.
  const detail = makeElement("div", "quiz-item-details");
  detail.hidden = true;
  detail.id = `quiz-details-${Math.random().toString(36).slice(2, 10)}`;
  toggle.setAttribute("aria-controls", detail.id);

  const remaining = [...main.childNodes];
  const detailMain = makeElement("div", "quiz-item-main");
  remaining.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(".quiz-item-top")) {
      if (!node.textContent.trim() && !node.children.length) node.remove();
      else if (node.querySelector(".quiz-status, .quiz-eyebrow")) node.remove();
      else detailMain.appendChild(node);
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
      node.remove();
    } else {
      detailMain.appendChild(node);
    }
  });

  if (detailMain.childNodes.length) detail.appendChild(detailMain);

  const openLink = item.querySelector(".quiz-open");
  if (openLink) detail.appendChild(openLink);

  // Preserve any non-title content that the renderer placed beside the main block.
  [...item.children].forEach(child => {
    if (child !== main && child !== toggle && child !== detail) {
      detail.appendChild(child);
    }
  });

  item.replaceChildren(toggle, detail);
  item.dataset.compactReady = "true";
  item.classList.add("is-collapsed");

  toggle.addEventListener("click", () => {
    const willOpen = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(willOpen));
    detail.hidden = !willOpen;
    item.classList.toggle("is-expanded", willOpen);
    item.classList.toggle("is-collapsed", !willOpen);
  });
}

function itemStatus(item) {
  const status = item.querySelector(".quiz-status");
  if (!status) return "unknown";
  for (const key of ["open", "upcoming", "closed"]) {
    if (status.classList.contains(key)) return key;
  }
  const text = status.textContent.toLowerCase();
  if (/available|open|active/.test(text)) return "open";
  if (/upcoming|scheduled|not yet/.test(text)) return "upcoming";
  if (/closed|expired|ended|unavailable/.test(text)) return "closed";
  return "unknown";
}

function applyFilters() {
  if (!list) return;

  const keyword = (searchInput?.value || "").trim().toLowerCase();
  const items = [...list.querySelectorAll(".quiz-item[data-compact-ready='true']")];
  let visible = 0;

  items.forEach(item => {
    const status = itemStatus(item);
    const statusMatch = activeFilter === "all" || status === activeFilter;
    const searchMatch = !keyword || item.textContent.toLowerCase().includes(keyword);
    const show = statusMatch && searchMatch;
    item.classList.toggle("is-filter-hidden", !show);
    if (show) visible += 1;
  });

  if (countLabel) countLabel.textContent = `${visible} of ${items.length} ${items.length === 1 ? "quiz" : "quizzes"}`;
  if (filterEmpty) filterEmpty.hidden = items.length === 0 || visible > 0;

  // Keep the existing no-quizzes state in control when Firestore returned zero records.
  if (emptyState && items.length > 0) emptyState.style.display = "none";
}

function enhanceAndFilter() {
  if (!list) return;
  list.querySelectorAll(".quiz-item").forEach(enhanceQuizItem);
  applyFilters();
}

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.quizFilter || "all";
    filterButtons.forEach(candidate => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    applyFilters();
  });
});

searchInput?.addEventListener("input", applyFilters);

if (list) {
  enhanceAndFilter();
  observer = new MutationObserver(() => enhanceAndFilter());
  observer.observe(list, { childList: true, subtree: true });
}

window.addEventListener("pagehide", () => observer?.disconnect(), { once: true });
