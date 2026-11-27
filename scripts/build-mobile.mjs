import { cp, mkdir, access, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const token = `${process.pid}-${Date.now()}`;
const stagingName = `.mobile-web-build-staging-${token}`;
const staging = resolve(root, stagingName);
const primaryOutputName = 'mobile-web-build';
let outputName = primaryOutputName;
let output = resolve(root, outputName);
const previous = resolve(root, `.mobile-web-build-previous-${token}`);
const configPath = resolve(root, 'capacitor.config.json');

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

const blockedCodes = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
const exists = async path => {
  try { await access(path); return true; } catch { return false; }
};
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

async function renameWithRetry(from, to, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!blockedCodes.has(error?.code)) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function verify(folder) {
  for (const item of requiredItems) {
    if (!(await exists(resolve(folder, item)))) {
      throw new Error(`Mobile build verification failed; missing ${item}`);
    }
  }
}

for (const item of requiredItems) {
  if (!(await exists(resolve(root, item)))) {
    throw new Error(`Mobile build is missing required source: ${item}`);
  }
}
if (!(await exists(configPath))) {
  throw new Error('capacitor.config.json is missing from the project root.');
}

try {
  await mkdir(staging, { recursive: true });
  for (const item of requiredItems) {
    await cp(resolve(root, item), resolve(staging, item), { recursive: true, force: true });
    console.log(`Staged: ${item}`);
  }
  await verify(staging);

  // Never touch the old www directory: Windows may have it locked by VS Code,
  // a browser, antivirus, or a local server. Capacitor reads the webDir from
  // capacitor.config.json, so install into a fresh, separate output directory.
  if (await exists(output)) {
    try {
      await renameWithRetry(output, previous);
    } catch (error) {
      if (!blockedCodes.has(error?.code)) throw error;
      outputName = `mobile-web-build-${token}`;
      output = resolve(root, outputName);
      console.warn(`Existing ${primaryOutputName} is locked; using fresh output ${outputName}.`);
    }
  }

  await renameWithRetry(staging, output);
  await verify(output);

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.webDir = outputName;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log('\nEqualLearn mobile web build completed successfully.');
  console.log(`Capacitor webDir: ${outputName}`);
  console.log('The existing www folder was left untouched.');

  if (await exists(previous)) {
    try {
      await rm(previous, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch (error) {
      console.warn(`Previous mobile web output retained at ${previous}: ${error.message}`);
    }
  }
} catch (error) {
  console.error('\nMobile build failed. Existing www output was not modified.');
  if (await exists(staging)) console.error(`Complete staging files retained at: ${staging}`);
  throw error;
}
