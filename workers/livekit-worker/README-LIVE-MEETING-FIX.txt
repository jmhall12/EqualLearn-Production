EQUALLEARN LIVE MEETING FIX
============================

This bundle contains complete replacement files for the uploaded EqualLearn-Production-main project.

FILES TO REPLACE
----------------
1. workers/livekit-worker/worker.js
2. assets/js/teacher_live.js
3. assets/js/student_live.js
4. teacher/live.html
5. student/live.html

DEPLOY ORDER
------------
1. Deploy workers/livekit-worker/worker.js to the existing Cloudflare Worker named
   equallearn-live-token. Keep the current LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
   LIVEKIT_URL and other existing environment bindings/secrets. No new secret is needed.
2. Replace the four frontend files at the exact paths above in the EqualLearn project.
3. Deploy the project to Cloudflare Pages.
4. For the Capacitor Android copy, run `npm run mobile:build-web`, then rebuild the APK/AAB.

WHAT CHANGED
------------
- The LiveKit token `name` claim now uses the user's Firestore profile name (fullname,
  fullName, displayName, or name), with email as a last fallback. This removes the
  generic "EqualLearn teacher/student" participant name.
- Teacher and student meeting views create a tile for each participant, including
  participants who have not published video yet.
- Student generated tile classes now have matching CSS (`.sm-tile`, `.sm-name`, etc.).
- Teacher and student chat now prefer the authenticated LiveKit participant name.
- Added broadcast live reactions: 👍 ❤️ 😂 👏 😮 🎉. The sender's name appears with the
  reaction on that participant's tile.
- Screen-share tracks are distinguished using LiveKit `Track.Source.ScreenShare` and
  receive a large stage tile while camera tiles remain visible.
- Added a fullscreen control and an automatic landscape-lock attempt while screen
  sharing is active.

ORIENTATION NOTE
----------------
The page attempts to enter fullscreen when the meeting opens and locks to landscape
when a screen-share track appears. Browser/device support varies. If automatic lock is
rejected, tap the Fullscreen button while screen sharing or rotate the phone manually.

TEST PLAN
---------
1. Sign in as a teacher and start a section meeting.
2. Join from at least two active student accounts in that same section.
3. Confirm every account sees a tile with the participant's actual profile name.
4. Send a chat message from each account and confirm the sender name is shown.
5. Tap each reaction from a different account and confirm all other accounts see it.
6. Start screen sharing and confirm every connected account sees the large shared-screen
   tile plus the participant tiles. Confirm landscape behavior on the target Android device.

VALIDATION PERFORMED
--------------------
- `node --check` passed for worker.js, teacher_live.js, and student_live.js.
- HTML parser check found no duplicate IDs in teacher/live.html or student/live.html.
- A live Firebase/LiveKit room test and Cloudflare deployment were not performed here.
