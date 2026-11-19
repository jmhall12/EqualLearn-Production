
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

            // A temporary network/Firestore error must not erase a valid
            // locally-persisted Firebase session and force another login.
            activeRoleChecks.delete(normalizedRole);
            let notice = document.getElementById("equalLearnSessionRetryNotice");
            if (!notice) {
                notice = document.createElement("div");
                notice.id = "equalLearnSessionRetryNotice";
                notice.setAttribute("role", "status");
                notice.style.cssText = "position:fixed;z-index:99999;left:12px;right:12px;bottom:16px;padding:12px 15px;border-radius:12px;background:#29243f;color:#fff;box-shadow:0 8px 28px #0003;font:13px/1.5 system-ui;";
                document.body.appendChild(notice);
            }
            notice.textContent = "Unable to verify your account right now. Your saved sign-in was kept. Check your connection and reload this page.";
        }

    });
}
