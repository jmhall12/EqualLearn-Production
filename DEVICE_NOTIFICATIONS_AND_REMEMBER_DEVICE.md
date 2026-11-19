# EqualLearn real device notifications and remembered sign-in

## What this update does

- Firestore notification records remain the in-app notification source of truth.
- Publishing to a section now calls the trusted `equallearn-web-push` Worker `/dispatch` endpoint. The teacher live-session creation flow is also wired to this notification service.
- The Worker validates the Firebase ID token and verifies that the caller is a teacher assigned to the selected sections (or admin).
- Web/PWA devices receive Web Push. Capacitor Android devices receive FCM push.
- Notification title and body describe the new module, lesson, assignment, quiz, discussion, announcement, or live class.
- Tapping the device notification opens the relevant EqualLearn page/content.
- A browser device whose permission is already granted automatically resyncs its subscription after sign-in.
- Login has a checked-by-default “Remember this device” option; Firebase stores its own auth state, never the password.
- On a transient Firestore/connection error during role checking, the app no longer signs the user out automatically.

## Required Cloudflare deployment

Deploy `workers/web-push/worker.js` to your existing Worker `equallearn-web-push` and preserve its existing KV binding and VAPID private key. Full instructions are in `workers/web-push/README.md`.

The existing Worker URL is referenced in `assets/js/pwa.js` and `assets/js/notification-service.js`. The existing KV namespace must remain bound as `PUSH_SUBSCRIPTIONS`.

For native Android FCM, configure `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` as Cloudflare Worker secrets. Those come from a Firebase service account that has permission to send FCM messages. Do not put these secrets in the source project.

## Required Android setup

Register Android app package `com.equallearn.app` in Firebase project `equallearn-eb389`, download `google-services.json`, base64-encode it, and add the output to GitHub Actions secret `GOOGLE_SERVICES_JSON_BASE64`. The APK workflow copies it into the generated `android/app` folder. Rebuild the APK after configuring the secret.

## Test checklist

1. Deploy the Worker and verify `GET /health` reports `webPushConfigured: true` and (for APK) `fcmConfigured: true`.
2. Open EqualLearn on Android Chrome/PWA or install the latest APK.
3. Sign in and tap Enable Device/Phone Notifications once; grant Android/browser permission.
4. Close or background EqualLearn.
5. As a teacher, publish a module, assignment, quiz, discussion, or create a live session for that student's section.
6. Confirm the phone shows a system notification with the correct title/body and default notification sound (subject to Android notification/channel settings).
7. Tap the notification and confirm it opens the correct content.
8. Close and reopen EqualLearn. With Remember this device checked, it should restore the signed-in Firebase account without asking for the password, unless the user signed out, cleared app/site data, removed the app, or Firebase invalidated the session.

## Sound and permission notes

The Android FCM channel uses Android's system default notification sound and vibration. The OS or user can mute/alter the app notification channel or enable Do Not Disturb. Web Push sound is controlled by the browser/OS notification settings; the Web Notification API respects the device defaults. The in-dashboard Web Audio chime is separate and only runs while the dashboard is open.

Do not store passwords in localStorage or custom app storage. “Remember this device” uses Firebase Auth's supported local/session persistence.


## Phone-specific notes

- For the Capacitor APK, deploy the updated Worker after adding the Capacitor WebView origins to CORS. Without this, a native `https://localhost` registration request can be rejected even though browser/PWA registration works.
- For Android system banners and sound, FCM must be configured with `GOOGLE_SERVICES_JSON_BASE64`, and Cloudflare must have `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY`.
- The first Android notification permission must be granted by the student. The app cannot silently enable system notifications.
- If Android notification permission or the `EqualLearn Class Notifications` channel is muted in system settings, EqualLearn cannot override that choice.
- Remember this device uses Firebase Auth local persistence. It never stores the password. Signing out, clearing app/site data, uninstalling the app, or invalidating the Firebase session requires the student to sign in again.
