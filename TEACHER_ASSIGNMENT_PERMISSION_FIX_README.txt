EQUALLEARN - STUDENT TEACHER-ASSIGNMENT PERMISSION FIX

WHAT CAUSED THE ERROR
The student dashboard tried to read teacherAssignments/{legacy-id} using a
cohort/course/year-derived document ID. The new Admin Class Assignments flow
stores placement in users/{studentUid}.sectionId and teacher information in
sections/{sectionId}. The old read can be denied by Firestore rules.

FILES UPDATED
- assets/js/dashboard.js
- www/assets/js/dashboard.js
- assets/js/admin-sections.js
- www/assets/js/admin-sections.js

WHAT CHANGED
1. Student dashboard now loads the student's own sections/{sectionId} document.
2. It no longer probes arbitrary teacherAssignments IDs for students without
   an explicit sectionId/legacy assignment relationship.
3. Admin section creation/update now stores teacherName and
   assignedTeacherName on the section document.
4. The student's actual section name and academic year come from the section
   document, with safe fallbacks to their own profile.

FIRESTORE RULES CHECK
The previously supplied EqualLearn Firestore rules package already contains:
  match /sections/{sectionId} {
    allow get: if isAdmin()
      || assignedTeacher(sectionId)
      || studentInSection(sectionId);
  }

and studentInSection(sectionId) checks:
  isStudent() && myProfile().sectionId == sectionId

Therefore, that rules version does NOT need a broader permission grant for
this dashboard lookup. Do NOT open all teacherAssignments to every student.
If the deployed rules differ, verify that the sections get rule above is
present and deployed.

INSTALLATION
1. Back up the current project.
2. Replace the four files using the paths above.
3. Deploy the updated site.
4. If using Capacitor, rebuild the www bundle and Android app after replacement.

IMPORTANT
- Existing section documents may not yet contain teacherName. For those, the
  student dashboard will show "Teacher assigned" when teacherId/teacherIds
  exists. Open and save that section once in Admin Class Assignments to write
  the teacher display name. Newly created/updated sections save it automatically.
- Syntax validation is performed on the updated JavaScript. This patch is not
  a live Firebase deployment or a live-device test.
