import { cp, mkdir, rm, access, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'www');
const token = `${process.pid}-${Date.now()}`;
const staging = resolve(root, `.www-build-staging-${token}`);
const previous = resolve(root, `.www-build-previous-${token}`);

// Keep the same required routes as the production mobile build.
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
];

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeWithRetry(path, attempts = 10) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY', 'EMFILE', 'ENFILE'].includes(error?.code)) {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function renameWithRetry(from, to, attempts = 10) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

// Check the source before touching the existing www folder.
for (const item of requiredItems) {
  const source = resolve(root, item);
  if (!(await exists(source))) {
    throw new Error(`Mobile build is missing required source: ${item}`);
  }
}

let previousMoved = false;
let outputInstalled = false;

try {
  // Build a complete copy in a staging folder. The current www remains intact.
  await removeWithRetry(staging);
  await mkdir(staging, { recursive: true });

  for (const item of requiredItems) {
    const source = resolve(root, item);
    const destination = resolve(staging, item);
    await cp(source, destination, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    console.log(`Staged: ${item}`);
  }

  // Verify every required item exists in staging before replacing www.
  for (const item of requiredItems) {
    if (!(await exists(resolve(staging, item)))) {
      throw new Error(`Staging verification failed for: ${item}`);
    }
  }

  // Move the old output aside instead of recursively deleting it in place.
  if (await exists(out)) {
    await renameWithRetry(out, previous);
    previousMoved = true;
  }

  try {
    await renameWithRetry(staging, out);
    outputInstalled = true;
  } catch (error) {
    // Restore the old www if the new staged output cannot be installed.
    if (previousMoved && !(await exists(out)) && (await exists(previous))) {
      await renameWithRetry(previous, out);
      previousMoved = false;
    }
    throw error;
  }

  console.log('\nEqualLearn mobile web build completed successfully.');
  console.log(`Output: ${out}`);

  // Clean up the old output only after the new www is safely installed.
  if (previousMoved) {
    try {
      await removeWithRetry(previous);
      console.log('Previous www backup cleaned up.');
    } catch (error) {
      console.warn('New www is ready; previous output was retained at:');
      console.warn(previous);
      console.warn(`Cleanup warning: ${error.message}`);
    }
  }
} catch (error) {
  // Never remove a successfully installed output. Only remove staging debris.
  if (!outputInstalled) {
    try {
      await removeWithRetry(staging);
    } catch {
      console.warn(`Temporary staging folder retained: ${staging}`);
    }
  }
  console.error('\nMobile build failed without intentionally deleting the previous www output.');
  throw error;
}
