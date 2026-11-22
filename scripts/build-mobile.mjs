import { cp, mkdir, rm, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'www');

// Require all guided-evaluation routes so an APK cannot silently omit them.
const requiredItems = [
  'index.html',
  'login.html',
  'register.html',
  'admin',
  'teacher',
  'student',
  'assets',
  'manifest.webmanifest',
  'service-worker.js',
  'app.html',
  'evaluation.html',
  'evaluation-workspace.html'
];

for (const item of requiredItems) {
  try {
    await access(resolve(root, item));
  } catch {
    throw new Error(`Mobile build is missing required EqualLearn file/folder: ${item}. Apply the Evaluation Mode patch before building the APK.`);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of requiredItems) {
  await cp(resolve(root, item), resolve(out, item), { recursive: true });
}

console.log('EqualLearn web files copied to www/ for Capacitor, including app.html and Evaluation Mode pages.');
console.log('Next: npx cap sync android');
