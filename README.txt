EQUALLEARN STUDENT ACCESS FULL FIX

Files:
- firestore.rules
- assets/js/student-module-view.js
- www/assets/js/student-module-view.js

IMPORTANT FINDING
The provided source loads the modulesV2 document, fills its title/teacher/section/status,
then calls countPublishedLessons() against the separate lessons collection. If that optional
lessons query is denied, the old outer catch incorrectly marks the already-loaded module as
unavailable and clears its resources. The updated student-module-view.js catches that optional
query separately so a lessons permission issue does not hide the parent module.

The Firestore Rules file preserves role-scoped access and section-based reads:
- modulesV2: published resources assigned to student's section
- modules/lessons: active + approved resources assigned to student's section
- Admin/Teacher workflows, quiz answer-key privacy, Live sessions, assignments,
  notifications, progress, demo read-only restrictions and default deny remain in place.

APPLY
1. Extract this ZIP into D:\\EqualLearn-Production-Git (overwrite the included paths only).
2. In Firebase Console, select project equallearn-eb389, Firestore Database > Rules.
3. Back up the currently published Rules before replacing them.
4. Paste the full contents of firestore.rules and Publish only if the Firebase editor accepts it.
5. Restart Live Server from D:\\EqualLearn-Production-Git and hard-refresh the student page.

LOCAL VALIDATION
- student-module-view.js passes Node syntax check.
- source and www student-module-view.js files are byte-identical.
- This package has not been deployed to Firebase or live-tested.

If the lesson count query is still denied, the module remains open and the console will report
that the secondary lessons query is unavailable. The lesson collection permissions can then be
fixed independently; do not broaden student access to all documents.
