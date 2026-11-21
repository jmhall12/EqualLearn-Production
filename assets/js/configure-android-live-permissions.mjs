import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error(`Android manifest not found: ${manifestPath}`);
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, 'utf8');
if (!/<manifest\b/i.test(xml) || !/<application\b/i.test(xml)) {
  console.error('Generated AndroidManifest.xml is missing the manifest or application element.');
  process.exit(1);
}

const permissions = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS'
];

const optionalFeatures = [
  ['android.hardware.camera', '    <uses-feature android:name="android.hardware.camera" android:required="false" />'],
  ['android.hardware.microphone', '    <uses-feature android:name="android.hardware.microphone" android:required="false" />']
];

function hasElement(tag, androidName) {
  const escaped = androidName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${tag}\\b(?=[^>]*\\bandroid:name=["']${escaped}["'])[^>]*/?>`, 'i');
  return pattern.test(xml);
}

function insertBeforeApplication(element) {
  const index = xml.search(/<application\b/i);
  if (index < 0) throw new Error('AndroidManifest.xml has no <application> element.');
  xml = `${xml.slice(0, index)}${element}\n    ${xml.slice(index)}`;
}

for (const permission of permissions) {
  if (!hasElement('uses-permission', permission)) {
    insertBeforeApplication(`<uses-permission android:name="${permission}" />`);
  }
}

for (const [featureName, element] of optionalFeatures) {
  if (!hasElement('uses-feature', featureName)) insertBeforeApplication(element);
}

fs.writeFileSync(manifestPath, xml, 'utf8');

const missing = permissions.filter(permission => !hasElement('uses-permission', permission));
if (missing.length) {
  console.error(`Failed to add Android media permissions: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Android media permissions present in generated manifest:');
for (const permission of permissions) console.log(` - ${permission}`);
console.log('Camera and microphone hardware features are marked optional.');
