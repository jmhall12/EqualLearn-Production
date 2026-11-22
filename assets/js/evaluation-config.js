// Separate Firebase app instance for Evaluation Mode.
// It uses the same Firebase project configuration but an independent Auth
// persistence namespace, so demo sign-in never becomes the production app session.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const APP_NAME = "EqualLearnEvaluationMode";
const existing = getApps().find(app => app.name === APP_NAME);
export const evaluationApp = existing || initializeApp(firebaseConfig, APP_NAME);
export const evaluationAuth = getAuth(evaluationApp);
export const evaluationDb = getFirestore(evaluationApp);

export function isReadOnlyDemoProfile(profile) {
  const value = profile?.demoReadOnly;
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}
