# EqualLearn Evaluation Mode — Isolation and Login Fix

This patch fixes the failed `demoReadOnly` check and prevents a demo role from opening the production Admin, Teacher, or Student dashboards.

## What changed

- Evaluation Mode uses a separate named Firebase app (`EqualLearnEvaluationMode`) with its own session persistence. It does not sign the demo identity into the normal EqualLearn Auth instance.
- Before demo sign-in, the normal EqualLearn Auth session is signed out in that browser tab. This prevents a previously remembered production Admin/Teacher/Student session from being used inside the evaluation host.
- Demo login routes to `evaluation-workspace.html`, not `/admin/dashboard.html`, `/teacher/dashboard.html`, or `/student/dashboard.html`.
- The evaluation workspace contains only fictional demonstration data. It does not query production user, lesson, class, quiz, announcement, or report collections.
- The host runtime prevents a signed-in demo session from navigating to production role routes. It returns the evaluator to the isolated workspace.
- Lumi receives the demo role/page context, uses evaluation-safe navigation, and uses the separate evaluation Auth token when calling the existing Lumi AI Worker.
- Firestore role helpers (`isAdmin`, `isTeacher`, `isStudent`) exclude demo users. Broad signed-in reads are also blocked for demo users, leaving only the demo account's own `users/{uid}` profile readable. Create/update/delete rules remain blocked.
- `demoReadOnly` accepts Boolean `true` and the legacy string `"true"`. Boolean `true` is the recommended Firestore type.

## Files to copy

Extract this patch at the EqualLearn repository root and replace/add these files while preserving the folders:

- `evaluation.html` (replace)
- `evaluation-workspace.html` (new)
- `assets/css/evaluation-mode.css` (replace)
- `assets/css/evaluation-workspace.css` (new)
- `assets/js/evaluation-config.js` (new)
- `assets/js/evaluation-mode.js` (replace)
- `assets/js/evaluation-runtime.js` (replace)
- `assets/js/evaluation-workspace.js` (new)
- `assets/widgets/lumi.html` (replace)
- `firestore.rules` (replace with the patched complete rules file)

The existing `app.html` must load the persistent Lumi frame and include this module near the end of `<body>`:

```html
<script type="module" src="assets/js/evaluation-runtime.js"></script>
```

If that script is already there from the previous Evaluation Mode patch, do not add it a second time.

## Check the demo account profile

For each demo account, create a Firebase Authentication email/password account. Then create `users/{AUTH_UID}` where the document ID is exactly that account's Firebase Authentication UID.

Example Admin profile:

```js
{
  fullname: "EqualLearn Evaluation Administrator",
  role: "admin",
  status: "active",
  demoReadOnly: true
}
```

Use the Boolean value `true`, not the string `"true"`. The current patch accepts the old string value too, so the account in the screenshot will pass the flag check. It is still recommended to change it to Boolean `true` in Firestore Console by choosing the `boolean` field type.

Teacher example: use `role: "teacher"` and `fullname: "EqualLearn Evaluation Teacher"`.

Student example: use `role: "student"` and `fullname: "EqualLearn Evaluation Student"`.

Every profile must have `status: "active"` and `demoReadOnly: true`.

## Deployment

1. Back up the current project and current Firestore Rules.
2. Copy the files listed above.
3. Publish the included `firestore.rules` in Firebase Console → Firestore Database → Rules.
4. Deploy the website to Cloudflare Pages.
5. No Lumi, LiveKit, verification, or Web Push Worker replacement is needed for this isolation fix. Keep the current Worker bindings and secrets.

## Verification checklist

1. Open `evaluation.html` and choose Admin Demo. Enter the demo email/password.
2. Confirm the destination is `/evaluation-workspace.html?role=admin&page=overview` and the page displays the `ISOLATED DEMO` / `READ-ONLY DEMO` markers.
3. Click Students, Teachers, Lessons, Content Review, Reports, and Settings. Each page must remain inside Evaluation Workspace.
4. Click Lumi navigation suggestions. They must keep opening `/evaluation-workspace.html?...`, never `/admin/...`, `/teacher/...`, or `/student/...`.
5. While the demo is signed in, manually attempt to open `/admin/dashboard.html` inside the app host. The host must return to Evaluation Workspace.
6. In Firestore Rules testing using the demo account, reads of production collections such as `students`, `courses`, `sections`, `lessons`, `modulesV2`, `announcements`, and `activityLogs` must be denied. A `get` of the demo's own `users/{AUTH_UID}` document must be allowed. Create/update/delete must be denied.
7. Exit Evaluation Mode. The page should return to the normal EqualLearn login screen. Sign in there with a real account only when you intentionally want the production workspace.

## Important

The Evaluation Workspace intentionally uses invented sample data instead of production database records. This prevents demo accounts from viewing real student information or admin-only data. The normal EqualLearn dashboards and their functionality are not modified by this patch.
