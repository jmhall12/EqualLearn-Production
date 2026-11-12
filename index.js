
const admin = require("firebase-admin");

const {
  onDocumentCreated,
  onDocumentUpdated
} = require("firebase-functions/v2/firestore");

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

admin.initializeApp();

const db = admin.firestore();

setGlobalOptions({
  region: "asia-southeast1",
  maxInstances: 10
});

// ======================================================
// HELPERS
// ======================================================

function cleanSectionIds(value) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map(id => String(id || "").trim())
        .filter(Boolean)
    )
  ];
}

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function getOriginalPublishedDate(data) {
  return data?.publishedAt ||
    data?.updatedAt ||
    data?.createdAt ||
    admin.firestore.Timestamp.now();
}

async function getTeacherName(teacherId) {
  if (!teacherId) return "Your teacher";

  try {
    const snap = await db
      .collection("users")
      .doc(teacherId)
      .get();

    if (!snap.exists) return "Your teacher";

    const user = snap.data() || {};

    return (
      user.fullname ||
      user.name ||
      user.displayName ||
      "Your teacher"
    );

  } catch (error) {
    logger.warn("Teacher name lookup failed", {
      teacherId,
      message: error.message
    });

    return "Your teacher";
  }
}

async function getStudentsInSections(sectionIds) {
  const sectionList = cleanSectionIds(sectionIds);
  const students = new Map();

  if (!sectionList.length) return [];

  // Firestore "in" supports up to 30 values.
  for (let i = 0; i < sectionList.length; i += 30) {
    const chunk = sectionList.slice(i, i + 30);

    const snapshot = await db
      .collection("users")
      .where("sectionId", "in", chunk)
      .get();

    snapshot.forEach(studentDoc => {
      const student = studentDoc.data() || {};

      if (
        student.role !== "student" ||
        student.status !== "active"
      ) {
        return;
      }

      students.set(studentDoc.id, {
        uid: studentDoc.id,
        sectionId: String(student.sectionId || "")
      });
    });
  }

  return [...students.values()];
}

// ======================================================
// CREATE ONE PERSISTENT NOTIFICATION PER STUDENT
// ======================================================

async function createContentNotifications({
  contentType,
  contentId,
  title,
  description,
  teacherId,
  sectionIds,
  publishedAt
}) {
  const sections = cleanSectionIds(sectionIds);

  if (!contentId || !sections.length) {
    logger.info("No section assignment. Notification skipped.", {
      contentType,
      contentId
    });

    return {
      created: 0,
      existing: 0,
      students: 0
    };
  }

  const students = await getStudentsInSections(sections);

  if (!students.length) {
    return {
      created: 0,
      existing: 0,
      students: 0
    };
  }

  const teacherName = await getTeacherName(teacherId);

  const isModule = contentType === "module";

  const notificationTitle = isModule
    ? "New Learning Module"
    : "New Lesson Published";

  const contentTitle = safeText(
    title,
    isModule ? "Untitled Module" : "Untitled Lesson"
  );

  const contentDescription = safeText(description).slice(0, 180);

  let created = 0;
  let existing = 0;

  for (const student of students) {
    const notificationId =
      `${contentType}_${contentId}_${student.uid}`;

    const notificationRef = db
      .collection("notifications")
      .doc(notificationId);

    const wasCreated = await db.runTransaction(
      async transaction => {
        const previous = await transaction.get(notificationRef);

        // Never overwrite an existing notification.
        // This preserves its read/unread state.
        if (previous.exists) return false;

        const message =
          `${teacherName} published ${
            isModule ? "a new module" : "a new lesson"
          }: ${contentTitle}` +
          (contentDescription
            ? ` — ${contentDescription}`
            : "");

        transaction.create(notificationRef, {
          userId: student.uid,

          title: notificationTitle,
          message,

          type: contentType,
          contentType,

          contentId,
          contentTitle,

          teacherId: teacherId || null,
          teacherName,

          sectionId: student.sectionId,

          read: false,

          // Original post date is retained for old posts.
          publishedAt: publishedAt || null,

          // This records when the notification document was created.
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return true;
      }
    );

    if (wasCreated) {
      created++;
    } else {
      existing++;
    }
  }

  logger.info("Content notifications processed", {
    contentType,
    contentId,
    students: students.length,
    created,
    existing
  });

  return {
    created,
    existing,
    students: students.length
  };
}

// ======================================================
// MODULE: NEWLY CREATED AND ALREADY PUBLISHED
// ======================================================

exports.notifyStudentsWhenModulePublished = onDocumentCreated(
  "modules/{moduleId}",
  async event => {
    const moduleData = event.data?.data();

    if (!moduleData || moduleData.status !== "active") {
      return;
    }

    await createContentNotifications({
      contentType: "module",
      contentId: event.params.moduleId,

      title: moduleData.title || moduleData.name,
      description: moduleData.description,

      teacherId: moduleData.createdBy,
      sectionIds: moduleData.sectionIds,

      publishedAt: getOriginalPublishedDate(moduleData)
    });
  }
);

// ======================================================
// MODULE: DRAFT -> ACTIVE
// ======================================================

exports.notifyStudentsWhenModuleActivated = onDocumentUpdated(
  "modules/{moduleId}",
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    if (
      before.status === "active" ||
      after.status !== "active"
    ) {
      return;
    }

    await createContentNotifications({
      contentType: "module",
      contentId: event.params.moduleId,

      title: after.title || after.name,
      description: after.description,

      teacherId: after.createdBy,
      sectionIds: after.sectionIds,

      publishedAt: getOriginalPublishedDate(after)
    });
  }
);

// ======================================================
// LESSON: NEW LESSON UNDER AN ACTIVE MODULE
// ======================================================

exports.notifyStudentsWhenLessonPublished = onDocumentCreated(
  "lessons/{lessonId}",
  async event => {
    const lesson = event.data?.data();

    if (!lesson) return;

    const moduleId = safeText(lesson.moduleId);

    if (!moduleId) {
      logger.warn("Lesson has no moduleId", {
        lessonId: event.params.lessonId
      });

      return;
    }

    const moduleSnapshot = await db
      .collection("modules")
      .doc(moduleId)
      .get();

    if (!moduleSnapshot.exists) {
      logger.warn("Parent module does not exist", {
        lessonId: event.params.lessonId,
        moduleId
      });

      return;
    }

    const parentModule = moduleSnapshot.data() || {};

    // Only notify for lessons under published modules.
    if (parentModule.status !== "active") {
      return;
    }

    await createContentNotifications({
      contentType: "lesson",
      contentId: event.params.lessonId,

      title: lesson.title,
      description: lesson.description,

      teacherId:
        lesson.createdBy ||
        parentModule.createdBy,

      sectionIds: parentModule.sectionIds,

      publishedAt: getOriginalPublishedDate(lesson)
    });
  }
);

// ======================================================
// ADMIN-ONLY HISTORICAL NOTIFICATION BACKFILL
//
// Run this once after deploying.
// It creates notifications for existing active modules
// and all lessons inside those active modules.
// It does not overwrite existing notifications.
// ======================================================

exports.backfillStudentContentNotifications = onCall({
    region: "asia-southeast1",
    cors: [
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    timeoutSeconds: 540,
    memory: "1GiB"
}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must sign in."
      );
    }

    const adminSnapshot = await db
      .collection("users")
      .doc(request.auth.uid)
      .get();

    if (
      !adminSnapshot.exists ||
      adminSnapshot.data()?.role !== "admin" ||
      adminSnapshot.data()?.status === "inactive"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only an active administrator can run notification backfill."
      );
    }

    logger.info("Historical notification backfill started", {
      adminUid: request.auth.uid
    });

    const modulesSnapshot = await db
      .collection("modules")
      .where("status", "==", "active")
      .get();

    let modulesProcessed = 0;
    let lessonsProcessed = 0;
    let notificationsCreated = 0;
    let existingNotifications = 0;
    let studentsMatched = 0;

    for (const moduleDoc of modulesSnapshot.docs) {
      const moduleData = moduleDoc.data() || {};

      const moduleResult = await createContentNotifications({
        contentType: "module",
        contentId: moduleDoc.id,

        title: moduleData.title || moduleData.name,
        description: moduleData.description,

        teacherId: moduleData.createdBy,
        sectionIds: moduleData.sectionIds,

        publishedAt: getOriginalPublishedDate(moduleData)
      });

      modulesProcessed++;

      notificationsCreated += moduleResult.created;
      existingNotifications += moduleResult.existing;
      studentsMatched += moduleResult.students;

      // Fetch lessons belonging to this active module.
      const lessonsSnapshot = await db
        .collection("lessons")
        .where("moduleId", "==", moduleDoc.id)
        .get();

      for (const lessonDoc of lessonsSnapshot.docs) {
        const lesson = lessonDoc.data() || {};

        const lessonResult = await createContentNotifications({
          contentType: "lesson",
          contentId: lessonDoc.id,

          title: lesson.title,
          description: lesson.description,

          teacherId:
            lesson.createdBy ||
            moduleData.createdBy,

          sectionIds: moduleData.sectionIds,

          publishedAt: getOriginalPublishedDate(lesson)
        });

        lessonsProcessed++;

        notificationsCreated += lessonResult.created;
        existingNotifications += lessonResult.existing;
        studentsMatched += lessonResult.students;
      }
    }

    const result = {
      success: true,
      modulesProcessed,
      lessonsProcessed,
      notificationsCreated,
      existingNotifications,
      studentsMatched
    };

    logger.info("Historical notification backfill completed", result);

    return result;
  }
);
