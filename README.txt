EQUALLEARN — STUDENT MOBILE HANG FIX

Target project folder:
D:\EqualLearn-Production-Git

This is an additive source patch for the existing EqualLearn Production project.
It does not replace the project or change Firebase configuration, Firestore Rules,
collection names, authentication providers, or teacher/admin feature logic.

WHAT THIS PATCH FIXES

1. Authentication startup no longer waits forever for users/{uid}. The profile
   read has a 10-second deadline. If Firebase is unavailable or access is denied,
   the app shows a retry screen instead of an endless startup spinner.
2. The signed-in Firebase session is retained after a transient profile-read
   failure, allowing the user to retry without signing in repeatedly.
3. Both the root route and role-protected routes show an account-recovery screen
   when a Firebase user exists but the profile could not be loaded.
4. Student Home no longer loads /questions just to render its dashboard. It
   loads lessons, modules, progress, and teacher information independently.
   Optional failures/timeouts do not hold the whole home screen indefinitely.
5. The dashboard reuses the same lesson request when building module cards.
   The dashboard-specific progress request is limited to 50 rows; the full
   Progress page continues to use the complete progress query.
6. Legacy modules and modulesV2 are queried independently. A denial or
   unavailable response from one collection will not automatically discard
   results from the other collection.
7. The mobile notification feed reads at most 30 recent records for the top bar,
   instead of downloading the student's entire notification history on every
   Home mount. The explicit Mark all read action still checks all of that
   student's notifications when tapped.
8. Other mobile data screens using useLoad now show a retryable error after
   15 seconds instead of remaining on an infinite spinner.
9. The Capacitor build no longer overwrites/renames the locked www directory.
   It creates a fresh mobile-web-build output directory, verifies it, and then
   updates capacitor.config.json so Capacitor syncs from that directory.
   The existing www folder is left untouched. Generated output folders are
   added to .gitignore.
10. This patch retains the previous Student Dashboard web/PWA performance fixes
   in student/dashboard.html and assets/js/ (notification throttling, lighter
   mobile rendering, corrected shell-ready listener, native Capacitor handling).

FILES INCLUDED

- mobile/src/context/AuthContext.jsx
- mobile/src/components/AuthRecovery.jsx (new)
- mobile/src/components/RoleGate.jsx
- mobile/app/index.jsx
- mobile/src/hooks/useLoad.js
- mobile/src/screens/StudentScreens.jsx
- mobile/src/lib/data.js
- student/dashboard.html
- assets/css/student-dashboard-performance.css
- assets/js/dashboard.js
- assets/js/pwa.js
- assets/js/ui-shell.js
- scripts/build-mobile.mjs
- capacitor.config.json
- .gitignore

APPLY

1. Close Android Studio, VS Code Live Server, browser tabs running localhost,
   and any local server that is serving the project. Do not delete www or any
   .www-build-staging-* directory.
2. Extract this ZIP directly into D:\EqualLearn-Production-Git and allow
   overwrite of the listed files.
3. Open PowerShell in the project root and run:

   node --check scripts/build-mobile.mjs
   node --check assets/js/dashboard.js
   node --check assets/js/ui-shell.js
   node --check assets/js/pwa.js
   npm run mobile:build-web

4. Check the build output. It should say "EqualLearn mobile web build completed
   successfully" and show a Capacitor webDir such as mobile-web-build.
5. Verify the selected output:

   Test-Path .\mobile-web-build\index.html
   Test-Path .\mobile-web-build\student\dashboard.html
   Test-Path .\mobile-web-build\assets\js\dashboard.js

   If the script selected a suffixed output folder, use the exact folder name
   printed as "Capacitor webDir" instead of mobile-web-build.
6. Only after the build succeeds, run the Capacitor commands if you are using
   the root Capacitor app and the Android platform has already been added:

   .\node_modules\.bin\cap.cmd sync android
   .\node_modules\.bin\cap.cmd open android

IMPORTANT

- The project contains a separate Expo app under mobile/ and a root Capacitor
  web app. This patch updates the Expo Student Home/auth startup and the root
  Capacitor student dashboard. Use the build path that matches the APK you are
  actually installing.
- This patch does not publish or change Firestore Rules and does not bypass
  permission checks. If published Rules deny /modulesV2 or /lessons, the
  dashboard will show available partial data and console warnings; Rules/data
  access still needs separate correction.
- Static validation does not prove runtime success on a physical Android phone.
  After rebuilding, test login, Student Home, Learning, and logout on-device.
