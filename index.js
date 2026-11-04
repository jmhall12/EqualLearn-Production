const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const adminAuth = getAuth();
const adminDb = getFirestore();

exports.createTeacherAccount = onCall(
    {
        region: "asia-southeast1",
        cors: [
            "http://127.0.0.1:5500",
            "http://localhost:5500"
        ]
    },
    async (request) => {

        // Verify signed-in administrator
        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "You must be signed in."
            );
        }

        const adminUid = request.auth.uid;

        const adminSnapshot = await adminDb
            .collection("users")
            .doc(adminUid)
            .get();

        if (!adminSnapshot.exists) {
            throw new HttpsError(
                "permission-denied",
                "Administrator profile not found."
            );
        }

        const adminData = adminSnapshot.data();

        if (
            adminData.role !== "admin" ||
            adminData.status === "inactive"
        ) {
            throw new HttpsError(
                "permission-denied",
                "Only active administrators can create teacher accounts."
            );
        }

        // Get teacher information
        const {
            surname,
            firstName,
            middleInitial,
            email,
            department,
            password
        } = request.data || {};

        const cleanSurname = String(surname || "").trim();
        const cleanFirstName = String(firstName || "").trim();
        const cleanMiddleInitial = String(middleInitial || "").trim();
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanDepartment = String(department || "").trim();
        const cleanPassword = String(password || "");

        if (
            !cleanSurname ||
            !cleanFirstName ||
            !cleanEmail ||
            !cleanDepartment ||
            !cleanPassword
        ) {
            throw new HttpsError(
                "invalid-argument",
                "Please complete all required teacher information."
            );
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            throw new HttpsError(
                "invalid-argument",
                "Invalid email address."
            );
        }

        if (
            cleanPassword.length < 8 ||
            cleanPassword.length > 128
        ) {
            throw new HttpsError(
                "invalid-argument",
                "Password must contain 8 to 128 characters."
            );
        }

        const fullname = cleanMiddleInitial
            ? `${cleanSurname}, ${cleanFirstName} ${cleanMiddleInitial}`
            : `${cleanSurname}, ${cleanFirstName}`;

        let teacherUser = null;

        try {

            // Create Firebase Authentication account
            teacherUser = await adminAuth.createUser({
                email: cleanEmail,
                password: cleanPassword,
                displayName: fullname,
                emailVerified: false,
                disabled: false
            });

            // Create Firestore teacher profile
            await adminDb
                .collection("users")
                .doc(teacherUser.uid)
                .create({
                    uid: teacherUser.uid,
                    fullname,
                    surname: cleanSurname,
                    firstName: cleanFirstName,
                    middleInitial: cleanMiddleInitial,
                    email: cleanEmail,
                    department: cleanDepartment,

                    role: "teacher",
                    status: "active",
                    authProvider: "password",

                    profileImage: "",
                    course: "",
                    yearLevel: "",
                    studentNumber: "",

                    createdBy: adminUid,
                    createdAt: FieldValue.serverTimestamp(),
                    lastLogin: null
                });

            return {
                success: true,
                uid: teacherUser.uid,
                email: cleanEmail,
                fullname,
                role: "teacher",
                message: "Teacher account created successfully."
            };

        } catch (error) {

            // Roll back Auth account if Firestore creation fails
            if (teacherUser) {
                try {
                    await adminAuth.deleteUser(teacherUser.uid);
                } catch (rollbackError) {
                    console.error(
                        "TEACHER ROLLBACK ERROR:",
                        rollbackError
                    );
                }
            }

            console.error(
                "CREATE TEACHER BACKEND ERROR:",
                error
            );

            if (error.code === "auth/email-already-exists") {
                throw new HttpsError(
                    "already-exists",
                    "This email is already registered."
                );
            }

            if (error instanceof HttpsError) {
                throw error;
            }

            throw new HttpsError(
                "internal",
                "Unable to create teacher account."
            );
        }
    }
);