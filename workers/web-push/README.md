# EqualLearn Device Push Worker

This Worker is the trusted sender for both:
- Browser/PWA Web Push (VAPID)
- Capacitor Android push (Firebase Cloud Messaging HTTP v1)

## Deploy to the existing Worker

Deploy this file as the entry point of the existing Worker named `equallearn-web-push` (the URL remains `https://equallearn-web-push.jmhallig-a48.workers.dev`). Do **not** create a new KV namespace. Keep the existing binding:

- Binding name: `PUSH_SUBSCRIPTIONS`
- Namespace: the existing `EQUALLEARN_PUSH_SUBSCRIPTIONS`

Keep the existing VAPID private key secret already configured in that Worker. It must be the same 32-byte base64url private scalar corresponding to the public key in `assets/js/pwa.js`.

Worker variables/secrets:

- `VAPID_PRIVATE_KEY` — existing secret; keep it.
- `VAPID_PUBLIC_KEY` — optional text variable; the current project public key is used as fallback.
- `VAPID_SUBJECT` — optional text variable, e.g. `mailto:admin@equallearn.app`.
- `FCM_CLIENT_EMAIL` — **secret** from a Firebase service-account JSON file.
- `FCM_PRIVATE_KEY` — **secret** from the same service-account JSON file (`private_key`, including PEM header/footer and newlines).

The Worker verifies Firebase ID tokens and checks section teacher assignments before accepting `/dispatch`. It stores Web Push endpoint subscriptions and native FCM tokens under hashed KV keys, not raw long endpoint keys.

CORS permits the production website (`https://equallearn.pages.dev`) plus the Capacitor WebView origins (`https://localhost`, `capacitor://localhost`, and `http://localhost`). This is required because native Android token-registration requests may originate from the WebView rather than the public website domain.

## Firebase Android setup (required for APK push)

1. In Firebase Console, open project `equallearn-eb389`.
2. Add an Android app with package name `com.equallearn.app` (must match `capacitor.config.json`).
3. Download `google-services.json`.
4. Base64 encode it locally and store the result as the GitHub Actions repository secret `GOOGLE_SERVICES_JSON_BASE64`.
   - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('google-services.json')) | Set-Clipboard`
   - macOS/Linux: `base64 -i google-services.json | tr -d '\n'`
5. Create a Firebase service account key with permission to send Firebase Cloud Messaging messages. Copy its `client_email` to Cloudflare secret `FCM_CLIENT_EMAIL` and its `private_key` to Cloudflare secret `FCM_PRIVATE_KEY`. Never commit the service-account JSON or PEM key to Git.
6. Deploy the Worker and rebuild the APK through GitHub Actions.

The Android plugin creates the notification channel `equallearn_class_v2` with high importance, the bundled EqualLearn chime (`resources/android/res/raw/equallearn_notification.wav`), and vibration. The APK build workflow copies that WAV into `android/app/src/main/res/raw/` before `npx cap sync`. If building locally, copy it to the same Android `res/raw` path before syncing and rebuilding. FCM messages target this exact channel ID. Foreground presentation is configured in `capacitor.config.json` (`sound`, `alert`, `banner`, and `list`). Users can still mute the app/channel in Android Settings. Android preserves notification-channel choices, so this patch uses a new `equallearn_class_v2` channel rather than reusing the old `equallearn_default` channel. After installing the new APK and enabling notifications once, verify that the new EqualLearn Class Notifications channel is set to Alerting with sound in Android Settings.

## Web/PWA setup

The existing VAPID key is kept. On a supported HTTPS browser, students press **Enable Device Notifications** once and grant browser permission. If permission is already granted, EqualLearn automatically re-associates the existing subscription with the currently signed-in account on later visits. Notification sound and banners are still subject to browser and operating-system notification settings.

## Endpoints

- `GET /health`
- `POST /subscribe`
- `POST /unsubscribe`
- `POST /native/subscribe`
- `POST /native/unsubscribe`
- `POST /dispatch` (teacher/admin only; checks assigned sections)

## Important

The Firestore `notifications` document is created independently first. Device delivery is best-effort and its result appears in the browser console / teacher log. No push provider can override a user's disabled notification permission, Android channel mute, Do Not Disturb, power restrictions, or manufacturer battery restrictions.
