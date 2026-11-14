
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

/* =========================================================
   EQUALLEARN SHARED NOTIFICATION SERVICE

   Used by:
   - Teacher Live
   - Teacher Modules
   - Other teacher publishing features

   Sends notifications to active students in selected sections.
========================================================= */

/**
 * Send a notification to students assigned to selected sections.
 *
 * @param {Object} options
 * @param {Object} options.db Firebase Firestore instance
 * @param {Object} options.auth Firebase Auth instance
 * @param {string[]} options.sectionIds Target section IDs
 * @param {string} options.contentType Notification content type
 * @param {string} options.contentId Related document ID
 * @param {string} options.contentTitle Notification title
 * @param {string} options.teacherName Teacher display name
 *
 * @returns {Promise<Object>} Notification delivery summary
 */

export async function notifySectionStudents({
  db,
  auth,
  sectionIds = [],
  contentType = "announcement",
  contentId = "",
  contentTitle = "New classroom activity",
  teacherName = "Your Teacher"
} = {}) {

  /* -------------------------------------------------------
     VALIDATE INPUT
  ------------------------------------------------------- */

  if (!db) {
    throw new Error("Firestore database instance is required.");
  }

  if (!auth?.currentUser) {
    throw new Error("An authenticated teacher is required.");
  }

  if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
    throw new Error("At least one target section is required.");
  }

  if (!contentId) {
    throw new Error("Notification content ID is required.");
  }

  const teacherUid = auth.currentUser.uid;

  const uniqueSectionIds = [
    ...new Set(
      sectionIds
        .map(id => String(id || "").trim())
        .filter(Boolean)
    )
  ];

  if (!uniqueSectionIds.length) {
    throw new Error("No valid section IDs were provided.");
  }

  /* -------------------------------------------------------
     NOTIFICATION CONTENT
  ------------------------------------------------------- */

  const safeTitle = String(contentTitle || "New classroom activity")
    .trim()
    .slice(0, 180);

  const safeTeacherName = String(teacherName || "Your Teacher")
    .trim()
    .slice(0, 100);

  const safeContentType = String(contentType || "announcement")
    .trim()
    .toLowerCase();

  const contentMessages = {
    live: `${safeTeacherName} created a new live session: ${safeTitle}`,
    module: `${safeTeacherName} published a new learning module: ${safeTitle}`,
    assignment: `${safeTeacherName} posted a new assignment: ${safeTitle}`,
    quiz: `${safeTeacherName} published a new quiz: ${safeTitle}`,
    discussion: `${safeTeacherName} started a new discussion: ${safeTitle}`,
    announcement: `${safeTeacherName} posted a new announcement: ${safeTitle}`
  };

  const notificationMessage =
    contentMessages[safeContentType] ||
    `${safeTeacherName} shared a new classroom activity: ${safeTitle}`;

  /* -------------------------------------------------------
     FIND ACTIVE STUDENTS
  ------------------------------------------------------- */

  const studentsByUid = new Map();

  for (const sectionId of uniqueSectionIds) {

    const studentQuery = query(
      collection(db, "users"),
      where("sectionId", "==", sectionId)
    );

    const studentSnapshot = await getDocs(studentQuery);

    studentSnapshot.forEach(studentDoc => {

      const student = studentDoc.data();

      const role = String(student.role || "").toLowerCase();
      const status = String(student.status || "").toLowerCase();

      if (role !== "student" || status !== "active") {
        return;
      }

      studentsByUid.set(studentDoc.id, {
        uid: studentDoc.id,
        sectionId,
        ...student
      });
    });
  }

  const students = [...studentsByUid.values()];

  if (!students.length) {
    return {
      success: true,
      sent: 0,
      skipped: 0,
      sections: uniqueSectionIds.length,
      message: "No active students were found in the selected sections."
    };
  }

  /* -------------------------------------------------------
     BUILD STUDENT NOTIFICATIONS
  ------------------------------------------------------- */

  const notificationsRef = collection(db, "notifications");

  const notificationUrl = safeContentType === "live"
    ? `live.html?sessionId=${encodeURIComponent(contentId)}`
    : `classwork.html?id=${encodeURIComponent(contentId)}`;

  const notificationDocuments = students.map(student => {

    const notificationRef = doc(notificationsRef);

    return {
      ref: notificationRef,

      data: {
        userId: student.uid,

        title: safeContentType === "live"
          ? "New Live Class"
          : safeTitle,

        message: notificationMessage,

        type: safeContentType,
        contentType: safeContentType,
        contentId: String(contentId),

        teacherUid,
        teacherName: safeTeacherName,

        sectionId: student.sectionId,

        url: notificationUrl,

        read: false,

        createdAt: serverTimestamp(),
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    };
  });

  /* -------------------------------------------------------
     BATCH WRITE
     Firestore allows a maximum of 500 operations per batch.
     We use 450 to leave a safe margin.
  ------------------------------------------------------- */

  const CHUNK_SIZE = 450;

  let sent = 0;

  for (
    let index = 0;
    index < notificationDocuments.length;
    index += CHUNK_SIZE
  ) {

    const chunk = notificationDocuments.slice(
      index,
      index + CHUNK_SIZE
    );

    const batch = writeBatch(db);

    chunk.forEach(item => {
      batch.set(item.ref, item.data);
    });

    await batch.commit();

    sent += chunk.length;
  }

  /* -------------------------------------------------------
     RESULT
  ------------------------------------------------------- */

  const result = {
    success: true,
    sent,
    skipped: 0,
    sections: uniqueSectionIds.length,
    contentType: safeContentType,
    contentId: String(contentId),
    teacherUid
  };

  console.info("[EQUALLEARN NOTIFICATIONS] Delivery complete:", result);

  return result;
}
