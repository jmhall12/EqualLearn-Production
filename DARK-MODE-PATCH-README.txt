EqualLearn Forced Dark Mode Patch
=================================

This patch is designed for the current EqualLearn project source.
It forces dark mode regardless of Android, Windows, browser, or OS appearance settings.

INSTALLATION
1. Extract the complete ZIP into the EqualLearn project root (for example D:\equallearn-main).
   Merge folders and replace the existing forced-dark CSS file if asked.
2. Open PowerShell in the project root.
3. Run:
     Set-ExecutionPolicy -Scope Process Bypass
     .\Apply-EqualLearn-Dark-Mode.ps1
4. Rebuild the Capacitor web copy:
     npm run mobile:build-web
5. Test the following pages locally in both light and dark OS settings:
     /index.html
     /login.html
     /admin/dashboard.html
     /teacher/dashboard.html
     /student/dashboard.html
     /teacher/live.html and /student/live.html
6. Review changes before committing:
     git diff --check
     git status --short

The installer saves backups beside the project folder in EqualLearn-Dark-Backup-<timestamp>.
It intentionally does not edit the generated www/ folder; mobile:build-web regenerates it.
It does not change Firebase, Firestore rules, LiveKit, routes, account roles, or business logic.

After local testing, commit and push the patch so Cloudflare Pages can deploy the static site.
