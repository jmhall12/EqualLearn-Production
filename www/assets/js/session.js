
import { auth, db } from "./firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

// Prevent duplicate role checks on the same page.
const activeRoleChecks = new Set();

export function requireRole(role, callback) {

    const normalizedRole = String(role || "")
        .trim()
        .toLowerCase();

    if (!normalizedRole || typeof callback !== "function") {
        throw new Error("Invalid role or callback.");
    }

    if (activeRoleChecks.has(normalizedRole)) {
        return;
    }

    activeRoleChecks.add(normalizedRole);

    return onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.replace("../login.html");
            return;
        }

        try {

            const userRef = doc(db, "users", user.uid);
            const snapshot = await getDoc(userRef);

            if (!snapshot.exists()) {
                await signOut(auth);
                window.location.replace("../login.html");
                return;
            }

            const profile = snapshot.data();

            const userRole = String(profile.role || "")
                .trim()
                .toLowerCase();

            if (userRole !== normalizedRole) {

                alert("Access denied. Authorized account required.");

                await signOut(auth);

                window.location.replace("../login.html");

                return;
            }

            // Pass Firestore profile and authenticated Firebase user.
            await callback({
                ...profile,
                uid: user.uid,
                authEmail: user.email || "",
                displayName: user.displayName || ""
            });

        } catch (error) {

            console.error("Role verification error:", error);

            alert("Unable to verify your account. Please try again.");

            await signOut(auth);

            window.location.replace("../login.html");
        }

    });
}
