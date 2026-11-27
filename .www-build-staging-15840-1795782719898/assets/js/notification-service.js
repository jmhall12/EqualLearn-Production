import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const PUSH_WORKER_URL = "https://equallearn-web-push.jmhallig-a48.workers.dev";
const SITE_ORIGIN = "https://equallearn.pages.dev";

function safePath(contentType, contentId, explicitTargetUrl = "") {
  const id = encodeURIComponent(String(contentId || ""));
  let path = "student/classwork.html";

  if (explicitTargetUrl) {
    const candidate = new URL(explicitTargetUrl, SITE_ORIGIN);
    if (candidate.origin === SITE_ORIGIN) {
      return candidate.href;
    }
  }

  switch (String(contentType || "").toLowerCase()) {
    case "live":
      path = `student/live.html?sessionId=${id}`;
      break;
    case "module":
      path = `student/modules.html?openModule=${id}`;
      break;
    case "lesson":
      path = `student/modules.html?openLesson=${id}`;
      break;
    case "assignment":
      path = `student/assignment.html?id=${id}`;
      break;
    case "quiz":
      path = `student/quiz.html?id=${id}`;
      break;
    case "announcement":
      path = `student/announcement.html?id=${id}`;
      break;
    case "discussion":
    default:
      path = `student/classwork.html?id=${id}`;
      break;
  }

  return new URL(path, `${SITE_ORIGIN}/`).href;
}

async function dispatchDevicePush({ auth, sectionIds, title, body, contentType, contentId, url }) {
  const user = auth?.currentUser;
  if (!user) throw new Error("No authenticated teacher/admin available for push dispatch.");

  const idToken = await user.getIdToken();
  const response = await fetch(`${PUSH_WORKER_URL}/dispatch`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sectionIds, title, body, contentType, contentId, url })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Push dispatch failed (${response.status}).`);
  }
  return result;
}

/**
 * Creates per-student Firestore notifications, then dispatches device push.
 * Firestore remains the in-app source of truth; push delivery is best-effort.
 */
export async function notifySectionStudents({
  db,
  auth,
  sectionIds = [],
  contentType = "announcement",
  contentId = "",
  contentTitle = "New classroom activity",
  teacherName = "Your Teacher",
  targetUrl = ""
} = {}) {
  if (!db) throw new Error("Firestore database instance is required.");
  if (!auth?.currentUser) throw new Error("An authenticated teacher is required.");
  if (!Array.isArray(sectionIds) || !sectionIds.length) throw new Error("At least one target section is required.");
  if (!contentId) throw new Error("Notification content ID is required.");

  const teacherUid = auth.currentUser.uid;
  const uniqueSectionIds = [...new Set(sectionIds.map(id => String(id || "").trim()).filter(Boolean))];
  if (!uniqueSectionIds.length) throw new Error("No valid section IDs were provided.");

  const safeTitle = String(contentTitle || "New classroom activity").trim().slice(0, 180);
  const safeTeacherName = String(teacherName || "Your Teacher").trim().slice(0, 100);
  const safeContentType = String(contentType || "announcement").trim().toLowerCase();
  const notificationTitle = safeContentType === "live"
    ? "New Live Class"
    : safeTitle;

  const messageTemplates = {
    live: `${safeTeacherName} invited your class to a live session: ${safeTitle}`,
    module: `${safeTeacherName} published a new learning module: ${safeTitle}`,
    lesson: `${safeTeacherName} added a new lesson: ${safeTitle}`,
    assignment: `${safeTeacherName} posted a new assignment: ${safeTitle}`,
    quiz: `${safeTeacherName} published a new quiz: ${safeTitle}`,
    discussion: `${safeTeacherName} started a new discussion: ${safeTitle}`,
    announcement: `${safeTeacherName} posted a new announcement: ${safeTitle}`
  };
  const notificationMessage = messageTemplates[safeContentType]
    || `${safeTeacherName} shared a new classroom activity: ${safeTitle}`;
  const url = safePath(safeContentType, contentId, targetUrl);

  const studentsByUid = new Map();
  for (const sectionId of uniqueSectionIds) {
    const q = query(
      collection(db, "users"),
      where("sectionId", "==", sectionId),
      where("role", "in", ["student", "Student", "STUDENT"])
    );
    const snapshot = await getDocs(q);
    snapshot.forEach(studentDoc => {
      const student = studentDoc.data();
      if (String(student.role || "").toLowerCase() !== "student") return;
      if (String(student.status || "").toLowerCase() !== "active") return;
      studentsByUid.set(studentDoc.id, { uid: studentDoc.id, sectionId, ...student });
    });
  }

  const students = [...studentsByUid.values()];
  if (!students.length) {
    return { success: true, created: 0, webPushSent: 0, fcmSent: 0, message: "No active students were found." };
  }

  const notificationsRef = collection(db, "notifications");
  const notificationDocuments = students.map(student => {
    const notificationRef = doc(notificationsRef);
    return {
      ref: notificationRef,
      data: {
        userId: student.uid,
        title: notificationTitle,
        message: notificationMessage,
        type: safeContentType,
        contentType: safeContentType,
        contentId: String(contentId),
        contentTitle: safeTitle,
        teacherId: teacherUid,
        teacherName: safeTeacherName,
        sectionId: student.sectionId,
        read: false,
        publishedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdBy: teacherUid
      }
    };
  });

  const CHUNK_SIZE = 450;
  for (let i = 0; i < notificationDocuments.length; i += CHUNK_SIZE) {
    const chunk = notificationDocuments.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(item => batch.set(item.ref, item.data));
    await batch.commit();
  }

  let push = null;
  let pushError = "";
  try {
    push = await dispatchDevicePush({
      auth,
      sectionIds: uniqueSectionIds,
      title: notificationTitle,
      body: notificationMessage,
      contentType: safeContentType,
      contentId: String(contentId),
      url
    });
  } catch (error) {
    pushError = error.message || "Device push could not be dispatched.";
    console.error("[EQUALLEARN DEVICE PUSH]", error);
  }

  const result = {
    success: true,
    created: notificationDocuments.length,
    sections: uniqueSectionIds.length,
    contentType: safeContentType,
    contentId: String(contentId),
    push,
    pushError
  };
  console.info("[EQUALLEARN NOTIFICATIONS]", result);
  return result;
}
