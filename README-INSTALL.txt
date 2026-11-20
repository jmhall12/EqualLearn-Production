EQUALLEARN — ADMIN → TEACHER → STUDENT CONTENT WORKFLOW FIX
Build date: 2026-11-20
Baseline inspected: EqualLearn-Production-main (3).zip (uploaded 2026-11-19)

WHAT THIS FIX CONNECTS
1. Admin-created modules and lessons remain in the existing `modules` / `lessons` collections.
2. Admin-created records remain pending until a teacher approves them.
3. Teacher then assigns the approved item to one of the sections assigned to that teacher.
4. Publishing writes `status: "active"`, `reviewStatus: "approved"`, `sectionIds: [selectedSectionId]`, `assignedTeacherId`, `assignedTeacherName`, `publishedBy`, and `publishedAt`.
5. Browser Student Modules, Lesson view, and Student Classwork query the same legacy collections and publication fields.
6. Student mobile reads are scoped by the student's Firestore `profile.sectionId`; Admin/Teacher no-argument data helpers remain available.
7. Student quiz questions are limited to quiz-enabled lessons that are active, approved, and assigned to the student's section.
8. A different teacher can see the Admin item as already published but cannot reassign it.
9. On successful publish, the existing notification service creates per-student Firestore notifications; device push remains best effort.

IMPORTANT SECTION ID REQUIREMENT
The `sectionIds` value and student profile `sectionId` must contain the Firestore document ID from the `sections` collection, not just a display label such as "A" or "BSIT 1A". The Teacher page obtains the section document ID from assigned sections. Do not hand-edit this value to a section name.

FILES INCLUDED
- assets/js/teacher-admin-content.js
- assets/js/student.modules.js
- assets/js/classwork.js
- assets/js/lesson.js
- assets/js/notification-service.js
- assets/js/dashboard.js
- www/assets/js/ (mirrors of the updated browser files)
- mobile/src/lib/data.js
- mobile/src/screens/StudentScreens.jsx
- service-worker.js and www/service-worker.js (cache version bumped to v10 so clients activate the updated shell)
- firestore.rules (full-file revision based on the Firestore rules you uploaded on 2026-11-20; includes the content workflow and fixes the rules issues identified in that file)
- FIRESTORE-RULES-REVIEW.txt (exact summary of rule changes and limitations)
- firestore.indexes.content-workflow.json (merge into your existing index configuration)

APPLYING THE PATCH
1. Back up your working EqualLearn folder and commit/stash existing edits first.
2. Copy the included `assets/`, `www/`, and `mobile/` files into the matching locations in your project. Replace only the files listed above; do not replace the whole project folder.
3. Back up your currently deployed Firestore rules. The included `firestore.rules` is based on the full rules file you uploaded on 2026-11-20 and preserves its other collections and permissions while applying the documented fixes. Still compare it with Firebase Console before deploying in case the live rules have changes not present in your upload. Read `FIRESTORE-RULES-REVIEW.txt`.
4. Your uploaded `firebase.json` currently has only the `functions` configuration. Add a sibling `firestore` configuration while preserving the existing `functions` array: `"firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" }`.
5. Merge `firestore.indexes.content-workflow.json` entries into your current `firestore.indexes.json`. Do not overwrite your current index file or remove existing production indexes. This workflow needs the legacy modules/lessons, V2 modules/teacherActivitiesV2, and users (sectionId + role) indexes listed in the file. Deploy the merged indexes.
6. From the project root, run `npm run mobile:build-web` to regenerate `www/` after copying root assets. This command is present in the inspected source ZIP package.json.
7. Test the browser/PWA and the Expo mobile app with separate Admin, Teacher, and Student accounts.

MANUAL TEST FLOW
A. Admin creates a module in `modules` and a lesson in `lessons`. Confirm both show `reviewStatus: pending` and `status: pending_review` (or the existing pending status used by the Admin screen).
B. Teacher opens `teacher/admin-content.html`. The items should appear for review.
C. Teacher clicks Approve Content. Confirm `reviewStatus: approved` and `status: approved`; students must not see the item yet.
D. Teacher chooses one assigned section and clicks Publish to Students. Confirm `status: active`, `reviewStatus: approved`, and `sectionIds` contains only that section's Firestore document ID.
E. Student from that exact section should see the module in Student Modules and Student Classwork, and lessons in the module's lesson view.
F. Student from another section must not see the item or its quiz questions.
G. A second teacher should see the record as Already published and must not have a publish control.
H. Confirm the student notification record is written. Device push is best-effort and depends on the user's device notification setup and Worker availability.

VALIDATION / LIMITATIONS
- Updated browser JavaScript is checked with `node --check`.
- Mobile JSX is parsed when a compatible Babel parser is available in the source project.
- JSON syntax and ZIP integrity are checked.
- This patch has not been deployed to Firebase and has not been tested against the live project. Firebase rules and indexes must be deployed and the manual role/section tests above must pass before production use.
