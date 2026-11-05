# EqualLearn Verification Worker

This is the missing Cloudflare Worker backend used by `admin-students.js`.
It supports individual and batch approve/reject/restore requests and a scheduled
cleanup for rejected student accounts after the 7-day grace period. It does not
use Firebase Cloud Functions.

## 1. Before deployment

- Confirm the Firebase project ID is `equallearn-eb389`.
- In Cloudflare, create a Worker named `equallearn-verification` (or deploy this
  folder with Wrangler; the name is set in `wrangler.toml`).
- Use a dedicated Google service account for this backend. Enable the Firestore
  API and Identity Toolkit API for the Firebase project.
- Grant only the IAM permissions needed to read/write Firestore user profiles,
  create audit logs, and delete Firebase Authentication users. Test in a
  non-production project first.

## 2. Install and deploy

Run these commands in a terminal from this folder:

```bash
npm install --save-dev wrangler
npx wrangler login
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler deploy
```

When prompted, paste the Firebase Web API key and the complete service-account
JSON file contents respectively. Never commit the service-account JSON or put it
in browser code.

## 3. Connect the Admin page

After deployment, Cloudflare will show a URL similar to:

`https://equallearn-verification.<your-account-subdomain>.workers.dev`

In `admin/students.html`, set the existing meta tag to that exact base URL:

```html
<meta name="equallearn-verification-api" content="https://equallearn-verification.<your-account-subdomain>.workers.dev">
```

Do not use `https://equallearn.pages.dev` as the API URL. That is the Pages
website, not this Worker. The browser code appends `/api/verification` itself.

`ALLOWED_ORIGINS` already includes:
- `http://127.0.0.1:5500`
- `http://localhost:5500`
- `https://equallearn.pages.dev`

If you use a different local port or custom domain, add its exact origin to
`ALLOWED_ORIGINS` in `wrangler.toml`, then redeploy.

## 4. Policy implemented

- Only active `admin` and `gad_coordinator` accounts can operate the API.
- Only student accounts with `@paterostechnologicalcollege.edu.ph` email can
  be approved.
- Any pending student account can be rejected, including non-institutional
  email addresses. A reason is required.
- Rejection immediately sets the profile status to `inactive` and schedules
  account deletion 7 days later.
- A rejected account can be restored to pending review before its deadline;
  restoring clears the deletion schedule.
- A Cron trigger runs every 15 minutes and deletes due Firebase Auth accounts,
  then deletes the corresponding `users/{uid}` profile.
- `activityLogs` audit records are retained. Other user-owned collections are
  not automatically deleted by this Worker.

## 5. Important deployment checks

1. Verify the service account has the required IAM permissions.
2. Verify the Firebase project's Identity Toolkit API is enabled.
3. Confirm the Worker URL is in the Admin page meta tag.
4. Confirm the deployed Worker has the three allowed origins listed above.
5. Test approve/reject/restore using test student accounts before production.
6. Confirm Cron execution and deletion behavior in Cloudflare Worker logs.

Do not deploy any replacement Firestore Rules blindly. This Worker uses a
service account for backend operations; client Firestore rules remain a separate
part of the app's security model.
