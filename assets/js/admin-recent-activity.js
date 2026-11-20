import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, orderBy, query, limit } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const listNode = document.getElementById("activityList");
const statusNode = document.getElementById("activityStatus");
const searchInput = document.getElementById("activitySearch");
const typeFilter = document.getElementById("activityTypeFilter");
let activityItems = [];
let activeUser = null;
let unsubscribe = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable";
}
function describeAction(item) {
  const action = String(item.action || item.type || item.event || "admin_activity").toLowerCase();
  const labels = {
    student_verified: "Student account verified",
    student_rejected: "Student account rejected",
    student_restored: "Student account restored",
    student_deleted: "Student account deleted",
    student_verification_approved: "Student verification approved",
    student_verification_rejected: "Student verification rejected",
    content_kept: "Teacher content marked as kept",
    content_flagged: "Teacher content flagged",
    content_removed: "Teacher content removed"
  };
  if (labels[action]) return labels[action];
  return action.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}
function render() {
  if (!listNode) return;
  const search = String(searchInput?.value || "").trim().toLowerCase();
  const type = typeFilter?.value || "all";
  const filtered = activityItems.filter(item => {
    const action = String(item.action || item.type || item.event || "").toLowerCase();
    const studentAction = action.includes("student") || Boolean(item.targetUserId);
    const contentAction = action.startsWith("content_") || Boolean(item.contentId) || Boolean(item.contentTitle);
    const searchable = [describeAction(item), item.actorRole, item.reason, item.description, item.targetName, item.contentTitle, item.contentType].join(" ").toLowerCase();
    const matchesType = type === "all" || (type === "student" && studentAction) || (type === "content" && contentAction);
    return (!search || searchable.includes(search)) && matchesType;
  });

  if (!filtered.length) {
    listNode.innerHTML = `<div class="admin-activity-empty">${activityItems.length ? "No activity matches your search or filter." : "No audit events have been recorded yet."}<br><span style="color:#7f8ba4">Only actions written to activityLogs can appear in this history.</span></div>`;
    return;
  }

  listNode.innerHTML = filtered.map(item => {
    const action = describeAction(item);
    const actorId = String(item.actorId || item.userId || "");
    const actor = actorId && activeUser && actorId === activeUser.uid ? "You" : String(item.actorRole || "Administrator").replace(/^\w/, c => c.toUpperCase());
    const target = item.contentTitle ? `${item.contentType || "Content"}: ${item.contentTitle}` : (item.targetUserId ? "Student account record" : (item.targetType || "Workspace"));
    const reason = item.reason || item.description || "";
    const date = formatDate(item.createdAt || item.timestamp);
    return `<article class="admin-activity-item">
      <span class="admin-activity-icon" aria-hidden="true">◷</span>
      <div class="admin-activity-copy"><strong>${escapeHTML(action)}</strong><p>${escapeHTML(actor)} · ${escapeHTML(target)}${reason ? ` · ${escapeHTML(reason)}` : ""}</p></div>
      <time class="admin-activity-meta">${escapeHTML(date)}</time>
    </article>`;
  }).join("");
}

searchInput?.addEventListener("input", render);
typeFilter?.addEventListener("change", render);

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  activeUser = user;
  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists() || String(profileSnap.data().role || "").toLowerCase() !== "admin" || String(profileSnap.data().status || "active").toLowerCase() === "inactive") {
      alert("Access denied. Active administrator access is required.");
      window.location.href = "../login.html";
      return;
    }

    const activityQuery = query(collection(db, "activityLogs"), orderBy("createdAt", "desc"), limit(100));
    unsubscribe = onSnapshot(activityQuery, snapshot => {
      activityItems = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
      statusNode.textContent = `${activityItems.length} recent audit event(s) · Live updates enabled`;
      render();
    }, error => {
      console.error("Activity history listener error:", error);
      statusNode.textContent = "Activity history is unavailable.";
      listNode.innerHTML = `<div class="admin-activity-empty">Unable to read activityLogs. Check the deployed Firestore rules and confirm that the admin role is active.<br><span style="color:#ff9ca9">${escapeHTML(error.message || "Permission or connection error")}</span></div>`;
    });
  } catch (error) {
    console.error("Recent activity admin check failed:", error);
    statusNode.textContent = error.message || "Unable to verify administrator access.";
  }
});

window.addEventListener("beforeunload", () => unsubscribe?.());
