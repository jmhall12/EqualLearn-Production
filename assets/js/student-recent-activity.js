import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const list = document.getElementById("activityList");
const status = document.getElementById("activityStatus");
const search = document.getElementById("activitySearch");
const filter = document.getElementById("activityTypeFilter");
let activityItems = [];

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
function toMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function labelFor(action) {
  const labels = {
    profile_updated: "Profile information updated",
    profile_photo_uploaded: "Profile picture uploaded",
    profile_photo_removed: "Profile picture removed",
    password_changed: "Password changed",
    password_reset_email_sent: "Password reset email requested"
  };
  return labels[action] || String(action || "Account activity").replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}
function categoryFor(action) {
  return String(action || "").includes("password") ? "security" : "profile";
}
function iconFor(action) {
  if (String(action || "").includes("password")) return '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
  if (String(action || "").includes("photo")) return '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></svg>';
  return '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.8-3.3 3.2-5 7-5s6.2 1.7 7 5"/></svg>';
}
function detailsFor(item) {
  const details = item.details && typeof item.details === "object" ? item.details : {};
  if (item.action === "profile_updated") {
    return details.academicDetailsChanged ? "Academic details saved. Administrator verification may be required." : "Your student profile details were saved.";
  }
  if (item.action === "profile_photo_uploaded") return details.fileName ? `Uploaded image: ${details.fileName}` : "A new profile picture was saved.";
  if (item.action === "profile_photo_removed") return "Your profile picture was removed from your account.";
  if (item.action === "password_changed") return "Your sign-in password was updated through Firebase Authentication.";
  if (item.action === "password_reset_email_sent") return "A password reset email was requested for your account.";
  return typeof item.reason === "string" ? item.reason : "An account event was recorded by EqualLearn.";
}
function render() {
  if (!list) return;
  const term = String(search?.value || "").trim().toLowerCase();
  const selected = filter?.value || "all";
  const rows = activityItems.filter(item => {
    const category = categoryFor(item.action);
    if (selected !== "all" && category !== selected) return false;
    return `${labelFor(item.action)} ${detailsFor(item)}`.toLowerCase().includes(term);
  });

  if (!rows.length) {
    list.innerHTML = '<div class="sp-empty">No matching activity was found. Profile changes and security actions recorded by EqualLearn will appear here.</div>';
    return;
  }

  list.innerHTML = rows.map(item => {
    const timestamp = toMillis(item.createdAt);
    const date = timestamp ? new Date(timestamp).toLocaleString() : "Time not available";
    return `<article class="sp-activity-item"><span class="sp-activity-icon" aria-hidden="true">${iconFor(item.action)}</span><div class="sp-activity-copy"><strong>${esc(labelFor(item.action))}</strong><p>${esc(detailsFor(item))}</p><time datetime="${timestamp ? new Date(timestamp).toISOString() : ""}">${esc(date)}</time></div></article>`;
  }).join("");
}

search?.addEventListener("input", render);
filter?.addEventListener("change", render);

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }
  if (status) status.textContent = "Loading your recorded activity…";
  try {
    // Query only records owned by the signed-in student. Sort locally to avoid requiring a composite index.
    const activityQuery = query(
      collection(db, "activityLogs"),
      where("userId", "==", user.uid)
    );
    const snapshot = await getDocs(activityQuery);
    const allOwnedEvents = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    activityItems = allOwnedEvents.slice(0, 100);
    if (status) status.textContent = `${allOwnedEvents.length} recorded ${allOwnedEvents.length === 1 ? "event" : "events"} · Showing the latest ${activityItems.length}.`;
    render();
  } catch (error) {
    console.error("Student activity history could not load:", error);
    if (status) {
      status.textContent = error.code === "permission-denied"
        ? "Access to your activity history was denied by the deployed Firestore rules."
        : error.message || "Unable to load your activity history.";
      status.classList.add("error");
    }
    if (list) list.innerHTML = '<div class="sp-empty">Your activity history is temporarily unavailable. Please refresh or contact your administrator if the issue continues.</div>';
  }
});
