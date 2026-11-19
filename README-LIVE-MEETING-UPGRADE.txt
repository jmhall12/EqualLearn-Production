EQUALLEARN LIVE — MEETING UPGRADE PATCH

This is a replacement patch for the six files below. Copy each file to the exact project path shown.

1) workers/livekit-worker/worker.js
   - LiveKit participant token now carries the actual Firestore profile name.
   - Existing /end route uses LiveKit DeleteRoom; that disconnects all participants.

2) assets/js/teacher_live.js and teacher/live.html
   - End for Everyone disconnects all participants but keeps the Firestore session reusable.
   - Added Delete Session Permanently, separate from End for Everyone.
   - Added minimize/floating call dock, flip camera, blur/custom background, raise hand, reactions.

3) assets/js/student_live.js and student/live.html
   - ROOM_DELETED disconnection automatically closes the meeting UI and refreshes the session list.
   - Added minimize/floating call dock, flip camera, blur/custom background, raise hand, reactions.
   - Ended one-on-one sessions remain visible as waiting until teacher restarts them or deletes them.

INSTALL
1. Back up the current six files.
2. Extract this ZIP into the project root, preserving folders, and overwrite the listed files.
3. Deploy workers/livekit-worker/worker.js to the existing equallearn-live-token Worker. Keep the same LiveKit/Firebase secrets and bindings.
4. Deploy the site to Cloudflare Pages.
5. Test with one teacher and at least two students in one assigned section.

FEATURE NOTES / LIMITATIONS
- The floating call dock keeps the user connected while they minimize the meeting overlay and continue using the current page. It does not guarantee a native Android system Picture-in-Picture window or survival after navigating to a different HTML page / closing the app. That requires native Capacitor Android PiP integration.
- Camera flip uses the browser's camera track restart with facingMode user/environment. Device/browser camera APIs decide whether a rear camera is available.
- Background blur/custom image uses @livekit/track-processors 0.8.3 from jsDelivr. This requires a supported modern browser and network access to the CDN. If unsupported, the UI displays an explanatory message instead of pretending the effect applied. Custom background image is processed locally on the publisher device before sending video to LiveKit.
- End for Everyone uses the Worker /end endpoint and LiveKit DeleteRoom. LiveKit documents that DeleteRoom forcibly disconnects everyone currently in the room and sends a ROOM_DELETED disconnect reason to clients.
- Static syntax checks do not replace a live Firebase/LiveKit deployment test. Test on actual Android devices before production release.
