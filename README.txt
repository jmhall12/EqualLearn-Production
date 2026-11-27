EQUALLEARN STUDENT DASHBOARD - MOBILE PERFORMANCE FIX

Files updated:
- student/dashboard.html
- assets/js/dashboard.js
- assets/js/ui-shell.js
- assets/js/pwa.js
- assets/css/student-dashboard-performance.css
- mobile/src/screens/StudentScreens.jsx
- mobile/src/lib/data.js
- www/ copies of the web dashboard files listed above

What changed:
1. Native StudentHome no longer queries the protected `questions` collection just to render the dashboard. Student rules currently reserve that collection for Admin/Teacher, so this query could reject the dashboard's Promise.all.
2. Mobile dashboard reads are shared/parallelized: the lessons request is reused by getModules instead of fetching lessons multiple times.
3. Dashboard progress history is bounded to 50 records for the home-screen summary; the full Progress page still uses the existing unbounded getProgress function.
4. Optional dashboard requests are timeout-bounded and fail independently. A failed teacher-assignment or progress request no longer removes every other dashboard section.
5. Module lesson grouping is done once with a Map rather than filtering the full lessons array for every module.
6. Web dashboard profile display does not wait for the section-teacher lookup. Notification shell binding uses the existing shell-ready event rather than a body-wide MutationObserver.
7. Mobile web dashboard limits the notification dropdown feed to 10 items, defers its aggregate unread-count request, removes unused render-blocking Google Font downloads, and disables expensive topbar/sidebar backdrop blur on small screens.
8. UI Shell observes only the student-name node on the Student Dashboard instead of observing the entire document body.
9. Capacitor's localhost WebView is no longer mistaken for local browser development by pwa.js. This prevents the PWA code from unregistering service workers and clearing EqualLearn caches every time the native app starts.

Merge target:
D:\EqualLearn-Production-Git

In VS Code PowerShell, from the existing Git-connected project, merge the ZIP (the archive paths are already relative to the project root):

Expand-Archive -LiteralPath "D:\EqualLearn-Student-Dashboard-Mobile-Fix.zip" -DestinationPath "D:\EqualLearn-Production-Git" -Force

Then validate:
node --check assets/js/dashboard.js
node --check assets/js/ui-shell.js
node --check assets/js/pwa.js

For the Capacitor APK workflow, from the project root run:
npm run mobile:build-web
npx cap sync android
npx cap open android

Then build the APK in Android Studio.

The separate Expo project is also updated. To run its Android app, use the existing mobile project workflow from `mobile/` (for example `npm run android` after its dependencies and Android toolchain are installed).

Validation performed here:
- JavaScript syntax checks passed for dashboard.js, ui-shell.js, and pwa.js.
- JSX parser check passed for StudentScreens.jsx.
- The CSS and HTML structure were checked for balanced syntax/markup.
- No live Firebase or physical Android device test was performed.
