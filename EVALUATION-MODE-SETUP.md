# EqualLearn Evaluation Mode — Setup Guide

This add-on provides three Firebase-authenticated demo roles, an Evaluation Mode entry page, a persistent read-only guide panel, Lumi page-context updates, automatic browser voice narration, and Lumi AI chat context.

## 1. Prerequisites

- The EqualLearn repository must already include the **Lumi Persistent Across Pages** host patch (`app.html`, updated `assets/js/ui-shell.js`, updated `assets/js/login.js`, and the page replacements from that patch). This add-on replaces `app.html` again to connect the evaluation runtime.
- The existing Firebase project, Lumi Worker URL, and Lumi widget must remain configured.
- Do not publish the demo accounts until the data-access warning in section 3 has been addressed.

## 2. Create the three demo accounts

In Firebase Console → Authentication → Users, create three Email/Password users. Use strong passwords and give the credentials only to the evaluators. Do not put passwords in HTML, JavaScript, GitHub, or Firestore.

For each Authentication user, copy its UID. In Firestore, create `users/{UID}` with these fields:

### Administrator demo

```json
{
  "fullname": "EqualLearn Evaluation Administrator",
  "role": "admin",
  "status": "active",
  "demoReadOnly": true
}
```

### Teacher demo

```json
{
  "fullname": "EqualLearn Evaluation Teacher",
  "role": "teacher",
  "status": "active",
  "demoReadOnly": true,
  "sectionId": "YOUR_DEMO_SECTION_ID",
  "section": "Evaluation Section"
}
```

### Student demo

```json
{
  "fullname": "EqualLearn Evaluation Student",
  "role": "student",
  "status": "active",
  "demoReadOnly": true,
  "sectionId": "YOUR_DEMO_SECTION_ID",
  "section": "Evaluation Section"
}
```

Replace `YOUR_DEMO_SECTION_ID` with the ID of a section populated with fabricated evaluation records. In `sections/{YOUR_DEMO_SECTION_ID}`, set `teacherId` to the Teacher demo UID or include that UID in `teacherIds`. Set the demo student's `sectionId` to the same section ID. Use only fabricated names, addresses, student numbers, grades, submissions, and other sample data.

The `demoReadOnly` field must be the Boolean `true`, not the text string `"true"`. The page checks that the authenticated user has the selected role, active status, and this exact flag before opening the role dashboard.

## 3. Important privacy warning

**The Admin demo account inherits the existing Admin read permissions.** Firestore Rules deny its writes, but the existing Admin role can still read the records that the regular Admin pages are allowed to display. Therefore, do not use this account on a production database containing real student information unless that information has been removed or anonymized.

The safest arrangement is a separate Firebase evaluation project populated with a sanitized copy of the EqualLearn structure and fabricated records. Configure the evaluation deployment's `assets/js/firebase-config.js` and the Worker Firebase project variables for that evaluation project. A Teacher demo account should also be assigned only to a fabricated evaluation section, not a real class.

## 4. Publish the Firestore Rules

Open Firebase Console → Firestore Database → Rules. Replace the currently deployed rules with the updated `firestore.rules` included in this package, then Publish.

The updated file adds `isDemoUser()` and appends `&& !isDemoUser()` to all 68 existing Firestore write permission statements. Existing read rules are retained. This is the server-side safeguard; the browser controls are only a usability layer and must not be treated as the security boundary.

After publishing, test both sides:

- A demo account can read pages allowed by its role.
- A demo account receives `PERMISSION_DENIED` for Firestore create/update/delete operations.
- A normal non-demo account can still perform its usual authorized actions.

## 5. Update the existing Lumi Worker

The package includes the latest available EqualLearn Lumi Worker source with a small evaluation-mode extension at:

`workers/lumi-worker/worker.js`

In Cloudflare Dashboard → Workers & Pages → `equallearn-lumi` → Edit Code, replace the Worker source with this file and Save and Deploy. Keep the existing Worker bindings, variables, D1 binding, AI binding, and allowed origins. Do not delete existing secrets.

The new build identifier is:

`2026-11-22-evaluation-readonly-v8`

Open the Worker `/health` endpoint and confirm that `workerBuild` shows the new identifier. Lumi chat continues to use the authenticated EqualLearn profile and now receives the `demoReadOnly` flag. Support-ticket creation and ticket administration are denied for demo accounts. Lumi owner-only configuration endpoints also verify the account's Firestore demo flag before allowing changes.

## 5A. Protect the LiveKit and Verification Workers

This package also includes hardened replacements for:

- `workers/livekit-worker/worker.js` — denies LiveKit token creation and room termination for any account where `demoReadOnly === true`.
- `workers/verification-worker/worker.js` — denies student verification actions for demo accounts, including direct Worker API requests.
- `workers/web-push/worker.js` — denies push subscription changes and notification dispatch for demo accounts.

Deploy each replacement to its existing Cloudflare Worker (`livekit-worker`, `verification-worker`, and `web-push`, or the exact existing Worker names used by your deployment). Retain the current bindings, variables, allowed origins, and secrets. These protections are required for strict read-only evaluation accounts.

## 6. Deploy the website and APK

Copy the package files into the repository, preserving their folder paths. Commit and push to the same GitHub repository/branch used by EqualLearn. Deploy the website through the existing Cloudflare Pages workflow.

For the APK, run the existing mobile web build and APK workflow so `evaluation.html`, its assets, `app.html`, and the updated Lumi widget are included in the app bundle. Firebase, Firestore, Lumi AI, and live network services still require an internet connection.

## 7. Test checklist

1. Open the EqualLearn Login page.
2. Select **Explore Evaluation Mode**.
3. Choose Admin, Teacher, or Student and sign in with the matching demo credentials.
4. Confirm that the correct dashboard opens and Lumi remains present while navigating between pages.
5. Confirm that the guide panel updates on each supported page and the Lumi speech bubble displays the same explanation.
6. Confirm that voice narration plays. Some browsers restrict automatic speech until the first user interaction; use **Replay voice** if needed.
7. Confirm that Lumi chat can answer questions about the current page.
8. Try a save, create, edit, upload, approve, grade, submit, or delete action. It must be disabled in the interface and denied by Firestore Rules if invoked directly.
9. Select **Exit evaluation**. The demo Firebase session should sign out and return to the role chooser.
10. Sign in with a normal account and verify that its normal permissions and workflows are unchanged.

## 8. Scope and limitations

- Voice narration uses the browser's built-in Speech Synthesis API. Available voices and autoplay behavior depend on the browser/device; no paid voice service is required.
- Lumi chat uses the already configured EqualLearn Worker and Workers AI binding. It still depends on the Worker, Firebase authentication, network access, and the AI allocation being available.
- The page guide text is bundled locally for the known Admin, Teacher, and Student routes. Unknown future routes receive a safe generic explanation until a route-specific guide is added.
- UI action detection is a convenience safeguard. Firestore Rules are the authoritative protection for Firestore writes. Any additional external service with its own write API must be separately protected before it is exposed to demo accounts.
- Read-only mode does not make private production data safe to show. Use fabricated/anonymized demo data or a separate evaluation Firebase project.
