import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const DEMO_FLAG = profile => {
  const value = profile?.demoReadOnly;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
};
const WRITE_WORDS = /\b(create|add new|new record|edit|save|update|delete|remove|publish|approve|reject|submit|send|upload|invite|register|verify|grade|assign|announce|post|join live|start live|end live|change password|reset password|archive|restore|duplicate|import)\b/i;
let locked = false;
let observer = null;

function describe(el) {
  return [
    el.getAttribute?.("aria-label"), el.getAttribute?.("title"), el.getAttribute?.("data-action"),
    el.getAttribute?.("name"), el.id, typeof el.className === "string" ? el.className : "",
    (el.innerText || el.textContent || "").slice(0, 160), el.getAttribute?.("href"), el.getAttribute?.("onclick")
  ].filter(Boolean).join(" ").replace(/[-_]+/g, " ");
}
function isMutationControl(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("#equallearn-eval-toolbar, #equallearn-lumi-frame")) return false;
  if (el.matches("button[type=submit], input[type=submit], input[type=file]")) return true;
  if (el.matches("[data-submit], [data-delete], [data-edit], [data-create]")) return true;
  const action = String(el.getAttribute?.("data-action") || "");
  if (action && WRITE_WORDS.test(action.replace(/[-_]+/g, " "))) return true;
  return WRITE_WORDS.test(describe(el));
}
function setLockedControl(el) {
  if (!(el instanceof HTMLElement) || el.dataset.evalReadonlyLocked === "1") return;
  if (!isMutationControl(el)) return;
  el.dataset.evalReadonlyLocked = "1";
  el.setAttribute("aria-disabled", "true");
  el.setAttribute("title", "Unavailable in read-only Evaluation Mode");
  if ("disabled" in el) el.disabled = true;
  el.classList.add("eval-readonly-disabled");
}
function scan(root = document) {
  root.querySelectorAll?.("button, input, textarea, select, a[href], [role=button], [data-action], [data-submit], [data-delete], [data-edit], [data-create]").forEach(setLockedControl);
  root.querySelectorAll?.("input[type=file]").forEach(el => { el.disabled = true; });
  root.querySelectorAll?.("form").forEach(form => {
    if (form.dataset.evalReadonlyForm === "1") return;
    form.dataset.evalReadonlyForm = "1";
    form.setAttribute("aria-disabled", "true");
  });
}
function showNotice() {
  if (document.getElementById("equallearn-readonly-notice")) return;
  const style = document.createElement("style");
  style.id = "equallearn-readonly-style";
  style.textContent = `
    #equallearn-readonly-notice{position:fixed;z-index:2147482000;right:12px;top:12px;display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;border:1px solid rgba(100,210,160,.28);background:rgba(8,26,26,.92);color:#baf3d6;font:800 10px system-ui;letter-spacing:.04em;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.18)}
    .eval-readonly-disabled{opacity:.48!important;cursor:not-allowed!important;filter:saturate(.45)}
    #equallearn-readonly-toast{position:fixed;z-index:2147482500;bottom:18px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:10px;background:#24243a;color:#f4efff;border:1px solid rgba(161,139,255,.3);font:700 12px system-ui;box-shadow:0 8px 22px rgba(0,0,0,.25);display:none}
  `;
  document.head.appendChild(style);
  const badge = document.createElement("div");
  badge.id = "equallearn-readonly-notice";
  badge.textContent = "● READ-ONLY EVALUATION";
  document.body.appendChild(badge);
  const toast = document.createElement("div");
  toast.id = "equallearn-readonly-toast";
  toast.textContent = "This action is disabled for the evaluation account.";
  document.body.appendChild(toast);
}
function notifyBlocked() {
  const toast = document.getElementById("equallearn-readonly-toast");
  if (!toast) return;
  toast.style.display = "block";
  clearTimeout(notifyBlocked.timer);
  notifyBlocked.timer = setTimeout(() => { toast.style.display = "none"; }, 2200);
}
function lockPage() {
  if (locked) return;
  locked = true;
  document.documentElement.dataset.equallearnReadonlyDemo = "true";
  showNotice();
  scan(document);
  observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof HTMLElement) {
          setLockedControl(node);
          scan(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target.closest("button, input, [role=button], [data-action], [data-submit], [data-delete], [data-edit], [data-create]") : null;
    if (target && isMutationControl(target)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      notifyBlocked();
    }
  }, true);
  document.addEventListener("submit", event => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    const formHints = form ? [form.id, form.className, form.getAttribute("action"), ...[...form.querySelectorAll("input")].map(input => [input.type, input.name, input.placeholder, input.getAttribute("aria-label")].join(" "))].join(" ") : "";
    // Preserve read-only search/filter forms so evaluators can find records.
    if (form && /search|filter|lookup/i.test(formHints) && !form.querySelector("input[type=file], button[data-action*=create], button[data-action*=delete], button[data-action*=save]")) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    notifyBlocked();
  }, true);
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter" && locked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notifyBlocked();
    }
  }, true);
}

onAuthStateChanged(auth, async user => {
  if (!user || locked) return;
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (profile && DEMO_FLAG(profile) && String(profile.status || "").toLowerCase() === "active") lockPage();
  } catch (error) {
    console.warn("[EqualLearn Read-only] Could not inspect demo profile:", error);
  }
});
