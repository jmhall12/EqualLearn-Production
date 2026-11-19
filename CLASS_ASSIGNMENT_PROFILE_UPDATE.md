# EqualLearn — Student Profile & Admin Class Assignment Update

## What changed

### Student profile (web and mobile)
- Removed the student-editable Student ID, Course, Year Level, Section, and Academic Year fields from the student profile pages.
- Student profile pages now focus on personal details and profile-picture management.
- Added a clear note that official class placement is controlled by an authorized administrator through Admin Class Assignments.
- Existing Firestore academic fields are intentionally preserved; this update does not delete existing student data.

### Admin Class Assignments
- Replaced the Ctrl-click multi-select with a searchable student picker.
- Added Course / Program, Year Level, and Academic Year filters. Students whose older account records have missing values can be found with the “Not specified” filter.
- Added Select Visible, Clear Checks, and Save Selected Students controls.
- Saved selections appear in a draft basket. The admin can change filters and add more students to the same section before creating it.
- Draft selections and section details are preserved in the current browser tab session using sessionStorage.
- The final Firestore section and student assignments are written only after the admin presses Create Section & Assign Students.
- Students with an existing sectionId, or a matching legacy section assignment, are hidden from the available student picker. After assignment is created, the selected students no longer appear as available for another section.
- Existing sections remain in the Existing Sections table so admins can edit or delete them.

## Files changed

- `admin/class-assignments.html`
- `assets/js/admin-sections.js`
- `student/profile.html`
- `assets/js/student-profile.js`
- `mobile/src/screens/StudentScreens.jsx`
- `mobile/src/components/FunctionalUI.jsx`
- Matching web mirrors under `www/`

## Installation

1. Back up the current EqualLearn project.
2. Extract the patch ZIP into the project root, preserving the folder paths, and allow the changed files to replace the originals.
3. Deploy the web project to Cloudflare Pages.
4. For the Expo/React Native app, rebuild the mobile app from the updated `mobile/` source.

## Expected Admin workflow

1. Enter Section Name, Course / Program, Year Level, Academic Year, and Assign Teacher.
2. Search or filter the active students.
3. Check the students in the current view and press Save Selected Students.
4. Change filters and repeat to add more students to the same draft.
5. Review the Students saved for this section basket. Remove any student that should not be included.
6. Press Create Section & Assign Students once the list is complete.

## Important notes

- The selection basket is a browser-side draft (sessionStorage), not a separate Firestore draft section. Final assignment is committed to Firestore at the final Create action.
- On a different browser/device, the temporary basket will not be available until the admin selects those students again.
- The page still validates that students with existing Course or Year Level values match the section being created. Blank student metadata is filled from the section details when assignment is committed.
- Students already assigned to a section remain visible in the Existing Sections table but are excluded from the available-student picker.

## Validation performed

- `node --check` on the changed browser JavaScript files.
- JSX parser/transpile check on the changed mobile React Native files.
- HTML parser and duplicate-ID checks on changed pages.
- DOM selector checks to confirm the updated JavaScript IDs exist in the corresponding HTML.
- Web mirror checks for the updated JS files.

No live Firebase/Firestore deployment or authenticated end-to-end test was performed as part of this patch.
