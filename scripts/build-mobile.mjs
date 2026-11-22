import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'www');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html','app.html','login.html','register.html','admin','teacher','student','assets','manifest.webmanifest','service-worker.js']) {
  await cp(resolve(root,item), resolve(out,item), { recursive: true });
}
// APK-only start page: the public website root remains unchanged.
// The local bundle opens app.html, whose child frame starts at login.html.
const mobileEntry = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0b1020">
  <title>EqualLearn</title>
  <script>
    location.replace(new URL("app.html?path=%2Flogin.html", location.href).href);
  </script>
</head>
<body style="margin:0;background:#0b1020;color:#f2f4ff;font:14px system-ui">
  <p><a href="app.html?path=%2Flogin.html" style="color:#b9a8ff">Open EqualLearn</a></p>
</body>
</html>`;

await writeFile(resolve(out, 'index.html'), mobileEntry, 'utf8');

if (!await (await import('node:fs/promises')).stat(resolve(out, 'app.html')).catch(() => null)) {
  throw new Error('app.html was not copied into the mobile bundle.');
}

console.log('EqualLearn mobile bundle prepared with persistent app host and direct login startup.');
