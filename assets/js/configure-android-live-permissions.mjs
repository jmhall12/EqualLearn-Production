import fs from "node:fs";
import path from "node:path";

const manifestPath = path.resolve("android", "app", "src", "main", "AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) {
  console.error(`Android manifest not found: ${manifestPath}`);
  process.exit(1);
}

let xml = fs.readFileSync(manifestPath, "utf8");

const permissions = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
];

const features = [
  '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
  '    <uses-feature android:name="android.hardware.microphone" android:required="false" />'
];

function hasTag(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<${tag}\\b(?=[^>]*\\bandroid:name=["']${escaped}["'])[^>]*/?>`,
    "i"
  ).test(xml);
}

function insertBeforeApplication(line) {
  const index = xml.search(/<application\b/i);
  if (index < 0) throw new Error("AndroidManifest.xml has no <application> element.");
  xml = xml.slice(0, index) + line + "\n" + xml.slice(index);
}

for (const permission of permissions) {
  if (!hasTag("uses-permission", permission)) {
    insertBeforeApplication(`    <uses-permission android:name="${permission}" />`);
  }
}

for (const feature of features) {
  const name = feature.match(/android:name="([^"]+)"/)[1];
  if (!hasTag("uses-feature", name)) insertBeforeApplication(feature);
}

fs.writeFileSync(manifestPath, xml, "utf8");

const missing = permissions.filter(permission => !hasTag("uses-permission", permission));
if (missing.length) {
  console.error("Failed to add Android permissions:", missing.join(", "));
  process.exit(1);
}

console.log("Android Live permissions configured:");
for (const permission of permissions) console.log(` - ${permission}`);
console.log("Camera and microphone hardware features are optional.");
