const FIREBASE_PROJECT_ID = "equallearn-eb389";
const ALLOWED_ORIGINS = new Set([
  // Production PWA / remote Capacitor server.url
  "https://equallearn.pages.dev",
  // Capacitor Android WebView default origin (androidScheme: https)
  "https://localhost",
  // Capacitor iOS / legacy WebView origins
  "capacitor://localhost",
  "http://localhost",
  // Local web development
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);
const VAPID_PUBLIC_KEY_FALLBACK = "BHDWCl52z3KypptauLy3msuE3KWXkaD9-Bv3WQGAp9S17MiZhC0RbuQTzMmXQYrEpGAmCZsNLI10FpuUAc9PW3I";
const encoder = new TextEncoder();
let firebaseKeysCache = null;
let firebaseKeysExpiry = 0;
let fcmAccessTokenCache = "";
let fcmAccessTokenExpiry = 0;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function cors(origin) {
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function b64url(bytes) {
  const array = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  let binary = "";
  for (const b of array) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function concat(...arrays) {
  const size = arrays.reduce((n, a) => n + a.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  arrays.forEach(a => { result.set(a, offset); offset += a.length; });
  return result;
}
async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}
async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}
async function hkdfExpand(prk, info, length) {
  let output = new Uint8Array(0);
  let previous = new Uint8Array(0);
  let counter = 1;
  while (output.length < length) {
    previous = await hmac(prk, concat(previous, info, Uint8Array.of(counter++)));
    output = concat(output, previous);
  }
  return output.slice(0, length);
}
function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(fromB64url(part)));
}
async function getFirebaseKeys() {
  if (firebaseKeysCache && Date.now() < firebaseKeysExpiry) return firebaseKeysCache;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!response.ok) throw new Error("Unable to retrieve Firebase verification keys.");
  const result = await response.json();
  firebaseKeysCache = result.keys || [];
  firebaseKeysExpiry = Date.now() + 3600000;
  return firebaseKeysCache;
}
async function verifyFirebaseToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase ID token.");
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || !header.kid || payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` || !payload.sub || payload.exp <= now || payload.iat > now + 60) {
    throw new Error("Firebase authentication token is invalid or expired.");
  }
  const jwk = (await getFirebaseKeys()).find(key => key.kid === header.kid);
  if (!jwk) throw new Error("Firebase signing key not found.");
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, fromB64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("Firebase token signature is invalid.");
  return payload;
}
function decodeFirestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}
function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}
async function getFirestoreDocument(path, idToken) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || "Firestore profile lookup failed.");
  return decodeFirestoreFields(result.fields || {});
}
async function queryStudents(sectionId, idToken) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "sectionId" },
            op: "EQUAL",
            value: { stringValue: sectionId }
          }
        }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || "Unable to list students assigned to the section.");
  return (Array.isArray(result) ? result : []).filter(row => row.document).map(row => {
    const fields = decodeFirestoreFields(row.document.fields || {});
    const name = row.document.name || "";
    return { uid: name.split("/").pop(), ...fields };
  }).filter(user => String(user.role || "").toLowerCase() === "student" && String(user.status || "").toLowerCase() === "active");
}
async function authenticate(request) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Firebase authentication is required.");
  const firebaseToken = match[1].trim();
  const claims = await verifyFirebaseToken(firebaseToken);
  const user = await getFirestoreDocument(`users/${encodeURIComponent(claims.sub)}`, firebaseToken);
  if (!user || String(user.status || "").toLowerCase() !== "active") throw new Error("Your EqualLearn account is not active.");
  const role = String(user.role || "").toLowerCase();
  if (!["admin", "teacher", "student"].includes(role)) throw new Error("Your EqualLearn role is not authorized.");
  return { uid: claims.sub, role, profile: user, idToken: firebaseToken };
}
async function kvListAll(kv, prefix) {
  let cursor;
  const records = [];
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    records.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
}
async function deleteDuplicateValue(kv, prefix, valueField, value) {
  const keys = await kvListAll(kv, prefix);
  for (const key of keys) {
    const stored = await kv.get(key.name, "json");
    if (stored?.[valueField] === value) await kv.delete(key.name);
  }
}
async function storeWebSubscription(env, uid, subscription) {
  if (!env.PUSH_SUBSCRIPTIONS) throw new Error("Cloudflare KV binding PUSH_SUBSCRIPTIONS is missing.");
  const endpoint = String(subscription?.endpoint || "");
  if (!endpoint.startsWith("https://") || endpoint.length > 4000 || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error("Invalid Web Push subscription.");
  await deleteDuplicateValue(env.PUSH_SUBSCRIPTIONS, "sub:", "endpoint", endpoint);
  const key = `sub:${uid}:${b64url(await sha256(endpoint))}`;
  await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({ uid, endpoint, subscription, updatedAt: Date.now() }));
  return key;
}
async function removeWebSubscription(env, uid, endpoint) {
  if (!env.PUSH_SUBSCRIPTIONS) throw new Error("Cloudflare KV binding PUSH_SUBSCRIPTIONS is missing.");
  const key = `sub:${uid}:${b64url(await sha256(endpoint))}`;
  await env.PUSH_SUBSCRIPTIONS.delete(key);
}
async function storeFcmToken(env, uid, token, platform = "android") {
  if (!env.PUSH_SUBSCRIPTIONS) throw new Error("Cloudflare KV binding PUSH_SUBSCRIPTIONS is missing.");
  const clean = String(token || "").trim();
  if (clean.length < 40 || clean.length > 4096) throw new Error("Invalid FCM device token.");
  await deleteDuplicateValue(env.PUSH_SUBSCRIPTIONS, "fcm:", "token", clean);
  const key = `fcm:${uid}:${b64url(await sha256(clean))}`;
  await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({ uid, token: clean, platform, updatedAt: Date.now() }));
  return key;
}
async function removeFcmToken(env, uid, token) {
  if (!env.PUSH_SUBSCRIPTIONS) throw new Error("Cloudflare KV binding PUSH_SUBSCRIPTIONS is missing.");
  const key = `fcm:${uid}:${b64url(await sha256(String(token || "")))}`;
  await env.PUSH_SUBSCRIPTIONS.delete(key);
}

async function vapidJwt(endpoint, env) {
  const publicKey = env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY_FALLBACK;
  const privateKey = String(env.VAPID_PRIVATE_KEY || "").trim();
  if (!privateKey) throw new Error("VAPID_PRIVATE_KEY is not configured in Cloudflare.");
  const rawPublic = fromB64url(publicKey);
  if (rawPublic.length !== 65) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.");
  const d = fromB64url(privateKey);
  if (d.length !== 32) throw new Error("VAPID_PRIVATE_KEY must be the 32-byte base64url private scalar used by the current Push Worker.");
  const jwk = { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(rawPublic.slice(1, 33)), y: b64url(rawPublic.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({ aud: origin, exp: now + 12 * 60 * 60, sub: env.VAPID_SUBJECT || "mailto:admin@equallearn.app" }));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));
  return { token: `${unsigned}.${b64url(new Uint8Array(signature))}`, publicKey };
}
async function sendWebPush(subscription, payload, env) {
  const endpoint = subscription.endpoint;
  const userPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const clientPublic = await crypto.subtle.importKey("raw", userPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublic }, ephemeral.privateKey, 256));
  const authPrk = await hmac(authSecret, sharedSecret);
  const keyInfo = concat(encoder.encode("WebPush: info\0"), userPublic, serverPublic);
  const inputKeyMaterial = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recordPrk = await hmac(salt, inputKeyMaterial);
  const cek = await hkdfExpand(recordPrk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(recordPrk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const plain = concat(encoder.encode(JSON.stringify(payload)), Uint8Array.of(2));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plain));
  const rs = Uint8Array.of(0, 0, 16, 0);
  const body = concat(salt, rs, Uint8Array.of(serverPublic.length), serverPublic, encrypted);
  const vapid = await vapidJwt(endpoint, env);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${vapid.token}, k=${vapid.publicKey}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "60",
      "Urgency": "high"
    },
    body
  });
  if (response.status === 404 || response.status === 410) return { expired: true };
  if (!response.ok) throw new Error(`Web Push provider returned ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return { sent: true };
}

function pemToArrayBuffer(pem) {
  const body = String(pem || "").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function getFcmAccessToken(env) {
  if (fcmAccessTokenCache && Date.now() < fcmAccessTokenExpiry - 60000) return fcmAccessTokenCache;
  if (!env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY) throw new Error("FCM service account secrets are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: env.FCM_CLIENT_EMAIL,
    sub: env.FCM_CLIENT_EMAIL,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging"
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(env.FCM_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || "Unable to authorize Firebase Cloud Messaging.");
  fcmAccessTokenCache = result.access_token;
  fcmAccessTokenExpiry = Date.now() + (Number(result.expires_in || 3600) * 1000);
  return fcmAccessTokenCache;
}
async function sendFcm(token, payload, env) {
  const accessToken = await getFcmAccessToken(env);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: {
          url: String(payload.url || "https://equallearn.pages.dev/student/dashboard.html"),
          notificationId: String(payload.notificationId || ""),
          contentType: String(payload.contentType || ""),
          contentId: String(payload.contentId || "")
        },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: "equallearn_class_v2",
            sound: "default",
            default_sound: true,
            default_vibrate_timings: true
          }
        }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = result.error?.details?.find(x => x.errorCode)?.errorCode || result.error?.status || "FCM_ERROR";
    if (code === "UNREGISTERED" || code === "NOT_FOUND") return { expired: true };
    throw new Error(result.error?.message || `FCM send failed (${response.status}).`);
  }
  return { sent: true };
}
async function sectionAuthorized(sectionId, actor) {
  if (actor.role === "admin") return true;
  if (actor.role !== "teacher") return false;
  const section = await getFirestoreDocument(`sections/${encodeURIComponent(sectionId)}`, actor.idToken);
  const assigned = Array.isArray(section?.teacherIds) ? section.teacherIds.map(String) : [];
  return Boolean(section && (String(section.teacherId || "") === actor.uid || assigned.includes(actor.uid)));
}
function safeNotificationUrl(value) {
  try {
    const url = new URL(String(value || "/student/dashboard.html"), "https://equallearn.pages.dev");
    if (url.origin !== "https://equallearn.pages.dev") return "https://equallearn.pages.dev/student/dashboard.html";
    return url.href;
  } catch {
    return "https://equallearn.pages.dev/student/dashboard.html";
  }
}
async function dispatchToUser(env, uid, payload, counts) {
  if (!env.PUSH_SUBSCRIPTIONS) throw new Error("Cloudflare KV binding PUSH_SUBSCRIPTIONS is missing.");
  for (const entry of await kvListAll(env.PUSH_SUBSCRIPTIONS, `sub:${uid}:`)) {
    const stored = await env.PUSH_SUBSCRIPTIONS.get(entry.name, "json");
    if (!stored?.subscription) continue;
    try {
      const result = await sendWebPush(stored.subscription, payload, env);
      if (result.expired) await env.PUSH_SUBSCRIPTIONS.delete(entry.name);
      else counts.webPushSent++;
    } catch (error) {
      counts.failed++;
      counts.errors.push(`web:${uid}:${error.message}`);
    }
  }
  for (const entry of await kvListAll(env.PUSH_SUBSCRIPTIONS, `fcm:${uid}:`)) {
    const stored = await env.PUSH_SUBSCRIPTIONS.get(entry.name, "json");
    if (!stored?.token) continue;
    try {
      const result = await sendFcm(stored.token, payload, env);
      if (result.expired) await env.PUSH_SUBSCRIPTIONS.delete(entry.name);
      else counts.fcmSent++;
    } catch (error) {
      counts.failed++;
      counts.errors.push(`fcm:${uid}:${error.message}`);
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin);
    const url = new URL(request.url);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ success: false, error: "Origin not allowed." }, 403, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ success: true, service: "EqualLearn Device Push", status: "online", webPushConfigured: Boolean(env.VAPID_PRIVATE_KEY), fcmConfigured: Boolean(env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) }, 200, headers);
    }
    if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405, headers);

    try {
      const actor = await authenticate(request);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ success: false, error: "Invalid JSON body." }, 400, headers);

      if (url.pathname === "/subscribe") {
        const key = await storeWebSubscription(env, actor.uid, body.subscription);
        return json({ success: true, registered: true, key }, 200, headers);
      }
      if (url.pathname === "/unsubscribe") {
        await removeWebSubscription(env, actor.uid, body.endpoint);
        return json({ success: true, unsubscribed: true }, 200, headers);
      }
      if (url.pathname === "/native/subscribe") {
        const key = await storeFcmToken(env, actor.uid, body.token, body.platform || "android");
        return json({ success: true, registered: true, platform: body.platform || "android", key }, 200, headers);
      }
      if (url.pathname === "/native/unsubscribe") {
        await removeFcmToken(env, actor.uid, body.token);
        return json({ success: true, unsubscribed: true }, 200, headers);
      }
      if (url.pathname === "/dispatch") {
        if (!["teacher", "admin"].includes(actor.role)) return json({ success: false, error: "Only teachers or administrators can send class notifications." }, 403, headers);
        const sectionIds = [...new Set((Array.isArray(body.sectionIds) ? body.sectionIds : []).map(String).map(x => x.trim()).filter(Boolean))];
        if (!sectionIds.length || sectionIds.length > 25) return json({ success: false, error: "Provide 1 to 25 valid section IDs." }, 400, headers);
        for (const sectionId of sectionIds) {
          if (!await sectionAuthorized(sectionId, actor)) return json({ success: false, error: `You are not assigned to section ${sectionId}.` }, 403, headers);
        }
        const title = String(body.title || "EqualLearn update").slice(0, 100);
        const notificationBody = String(body.body || "You have a new classroom update.").slice(0, 240);
        const contentType = String(body.contentType || "announcement").slice(0, 40);
        const contentId = String(body.contentId || "").slice(0, 200);
        const payload = {
          title,
          body: notificationBody,
          url: safeNotificationUrl(body.url),
          notificationId: `${contentType}-${contentId}`,
          contentType,
          contentId,
          tag: `equallearn-${contentType}-${contentId}`
        };
        const recipientUids = new Set();
        for (const sectionId of sectionIds) {
          for (const student of await queryStudents(sectionId, actor.idToken)) recipientUids.add(student.uid);
        }
        const counts = { recipients: recipientUids.size, webPushSent: 0, fcmSent: 0, failed: 0, errors: [] };
        for (const uid of recipientUids) await dispatchToUser(env, uid, payload, counts);
        return json({ success: true, ...counts, configured: { webPush: Boolean(env.VAPID_PRIVATE_KEY), fcm: Boolean(env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) }, errors: counts.errors.slice(0, 10) }, 200, headers);
      }
      return json({ success: false, error: "Endpoint not found." }, 404, headers);
    } catch (error) {
      console.error("EqualLearn Device Push error:", error?.message || error);
      const authError = /Firebase authentication|ID token|token is invalid|expired|not active|signing key/i.test(error?.message || "");
      return json({ success: false, error: error?.message || "Device push request failed." }, authError ? 401 : 500, headers);
    }
  }
};
