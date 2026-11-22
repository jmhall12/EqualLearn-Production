import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'www');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html','login.html','register.html','admin','teacher','student','assets','manifest.webmanifest','service-worker.js']) {
  await cp(resolve(root,item), resolve(out,item), { recursive: true });
}
// APK-only startup fallback: Capacitor opens the bundled appStartPath above.
 // If a WebView/plugin falls back to the default index.html, send it straight
 // to the bundled login page. This file is generated inside www only; the
 // public website's root index.html remains unchanged.
await writeFile(
  resolve(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=login.html">
  <title>Opening EqualLearn…</title>
</head>
<body>
  <p>Opening EqualLearn…</p>
  <script>window.location.replace('login.html');</script>
</body>
</html>
`,
  'utf8'
);

console.log('EqualLearn web files copied to www/ for Capacitor.');
console.log('APK startup configured for bundled login.html; www/index.html is a local fallback redirect.');
