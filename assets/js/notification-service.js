
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

export async function notifySectionStudents({
    db,
    auth,
    sectionIds = [],
    contentType,
    contentId,
    contentTitle,
    teacherName = "Your teacher"
}) {
    const teacher = auth.currentUser;

    if (!teacher) {
        throw new Error("You must be signed in to send notifications.");
    }

    if (!["module", "lesson"].includes(contentType)) {
        throw new Error("Invalid notification content type.");
    }

    if (!contentId || !contentTitle) {
        throw new Error("Missing content information.");
    }

    const uniqueSections = [...new Set(
        sectionIds.filter(id => typeof id === "string" && id.trim())
    )];

    if (!uniqueSections.length) {
        console.warn("No assigned sections. No notifications were sent.");
        return { created: 0, duplicatesOrDenied: 0, students: 0 };
    }

    let created = 0;
    let duplicatesOrDenied = 0;
    let studentsMatched = 0;

    for (const sectionId of uniqueSections) {
        const studentsQuery = query(
            collection(db, "users"),
            where("sectionId", "==", sectionId),
            where("role", "==", "student"),
            where("status", "==", "active")
        );

        const studentsSnapshot = await getDocs(studentsQuery);

        for (const studentDoc of studentsSnapshot.docs) {
            const student = studentDoc.data();

            if (
                student.role !== "student" ||
                student.status !== "active" ||
                student.sectionId !== sectionId
            ) {
                continue;
            }

            studentsMatched++;

            const notificationId =
                `${contentType}_${contentId}_${studentDoc.id}`;

            const notificationRef = doc(
                db,
                "notifications",
                notificationId
            );

            try {
                // Deterministic ID + create-only rules prevent overwriting
                // an existing notification or resetting its read status.
                await setDoc(notificationRef, {
                    userId: studentDoc.id,

                    title: contentType === "module"
                        ? "New Learning Module"
                        : "New Lesson Available",

                    message: contentType === "module"
                        ? `${teacherName} published a new module: ${contentTitle}`
                        : `${teacherName} added a new lesson: ${contentTitle}`,

                    type: "content",
                    contentType,
                    contentId,
                    contentTitle,

                    teacherId: teacher.uid,
                    teacherName,
                    sectionId,

                    read: false,
                    publishedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    createdBy: teacher.uid
                });

                created++;

            } catch (error) {
                // A duplicate deterministic ID is rejected by create-only
                // rules. Other permission errors are also reported here.
                duplicatesOrDenied++;

                console.warn(
                    "Notification was not created:",
                    studentDoc.id,
                    error.code,
                    error.message
                );
            }
        }
    }

    const result = {
        created,
        duplicatesOrDenied,
        students: studentsMatched
    };

    console.info("EQUALLEARN NOTIFICATION RESULT:", result);

    return result;
}
