
const FIREBASE_PROJECT_ID = "equallearn-eb389";

const ALLOWED_ORIGINS = new Set([
  "https://equallearn.pages.dev",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const encoder = new TextEncoder();

let cachedFirebaseKeys = null;
let cachedFirebaseKeysUntil = 0;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function corsHeaders(origin) {
  return {
    ...(ALLOWED_ORIGINS.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function base64url(input) {
  const bytes = typeof input === "string"
    ? encoder.encode(input)
    : input;

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized + "=".repeat((4 - normalized.length % 4) % 4)
  );

  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(
    new TextDecoder().decode(decodeBase64url(value))
  );
}

async function getFirebaseKeys() {
  if (cachedFirebaseKeys && Date.now() < cachedFirebaseKeysUntil) {
    return cachedFirebaseKeys;
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );

  if (!response.ok) {
    throw new Error("Unable to retrieve Firebase signing keys.");
  }

  const data = await response.json();

  cachedFirebaseKeys = data.keys || [];
  cachedFirebaseKeysUntil = Date.now() + 3600000;

  return cachedFirebaseKeys;
}

async function verifyFirebaseToken(idToken) {
  const parts = idToken.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid Firebase token.");
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Unsupported token algorithm.");
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    !Number.isFinite(payload.exp) ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.auth_time) ||
    payload.exp <= now ||
    payload.iat > now + 60 ||
    payload.auth_time > now + 60
  ) {
    throw new Error("Firebase token claims are invalid or expired.");
  }

  const keys = await getFirebaseKeys();
  const jwk = keys.find(key => key.kid === header.kid);

  if (!jwk) {
    cachedFirebaseKeys = null;
    cachedFirebaseKeysUntil = 0;
    throw new Error("Firebase signing key not found. Please sign in again.");
  }

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64url(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );

  if (!valid) {
    throw new Error("Firebase token signature is invalid.");
  }

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

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }

  if ("mapValue" in value) {
    return decodeFirestoreFields(value.mapValue.fields || {});
  }

  return null;
}

function decodeFirestoreFields(fields = {}) {
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    result[key] = decodeFirestoreValue(value);
  }

  return result;
}

async function getFirestoreDocument(path, idToken) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    }
  );

  const result = await response.json().catch(() => ({}));

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      result.error?.message || "Unable to read Firestore document."
    );
  }

  return decodeFirestoreFields(result.fields || {});
}

function isUUIDv4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createLiveKitToken(env, options) {
  const {
    uid,
    role,
    room,
    mode,
    canPublish
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const payload = {
    iss: env.LIVEKIT_API_KEY,
    sub: uid,
    nbf: now,
    iat: now,
    exp: now + 600,
    name: `EqualLearn ${role}`,
    video: {
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish,
      canPublishData: true,
      ...(canPublish ? {
        canPublishSources: [
          "camera",
          "microphone",
          "screen_share",
          "screen_share_audio"
        ]
      } : {}),
      ...(role === "teacher" || role === "admin"
        ? { roomAdmin: true }
        : {})
    },
    metadata: JSON.stringify({
      role,
      mode,
      platform: "equallearn"
    })
  };

  const unsigned =
    `${base64url(JSON.stringify(header))}.` +
    `${base64url(JSON.stringify(payload))}`;

  const signingKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.LIVEKIT_API_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    encoder.encode(unsigned)
  );

  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed." }, 403, headers);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        success: true,
        service: "EqualLearn Live Token Service"
      }, 200, headers);
    }

    if (request.method !== "POST" || url.pathname !== "/token") {
      return json({ error: "Endpoint not found." }, 404, headers);
    }

    try {
      if (
        !env.LIVEKIT_API_KEY ||
        !env.LIVEKIT_API_SECRET ||
        !env.LIVEKIT_URL
      ) {
        return json({
          error: "LiveKit environment variables are incomplete."
        }, 500, headers);
      }

      const authorization = request.headers.get("Authorization") || "";
      const match = authorization.match(/^Bearer\s+(.+)$/i);

      if (!match) {
        return json({
          error: "Firebase authentication is required."
        }, 401, headers);
      }

      const idToken = match[1].trim();

      if (!idToken || idToken.length > 10000) {
        return json({ error: "Invalid authentication token." }, 401, headers);
      }

      // 1. Verify Firebase authentication.
      const firebaseUser = await verifyFirebaseToken(idToken);
      const uid = firebaseUser.sub;

      // 2. Verify EqualLearn account.
      const user = await getFirestoreDocument(
        `users/${encodeURIComponent(uid)}`,
        idToken
      );

      if (!user) {
        return json({ error: "User profile not found." }, 403, headers);
      }

      const role = String(user.role || "").toLowerCase();
      const status = String(user.status || "").toLowerCase();

      if (
        user.uid && user.uid !== uid ||
        status !== "active" ||
        !["admin", "teacher", "student"].includes(role)
      ) {
        return json({
          error: "Your EqualLearn account is not authorized."
        }, 403, headers);
      }

      // 3. Validate requested room.
      const body = await request.json();
      const roomId = String(body.roomId || "").trim();

      if (!isUUIDv4(roomId)) {
        return json({
          error: "A valid UUIDv4 roomId is required."
        }, 400, headers);
      }

      // 4. Read the actual live session.
      const session = await getFirestoreDocument(
        `liveSessions/${encodeURIComponent(roomId)}`,
        idToken
      );

      if (!session) {
        return json({
          error: "Live session does not exist."
        }, 404, headers);
      }

      if (String(session.status || "").toLowerCase() !== "live") {
        return json({
          error: "This session is not currently live."
        }, 403, headers);
      }

      const mode = String(session.mode || "").toLowerCase();

      if (!["livestream", "meeting"].includes(mode)) {
        return json({
          error: "Invalid live session mode."
        }, 400, headers);
      }

      const teacherUid = String(session.teacherUid || "");

      const participantUids = Array.isArray(session.participantUids)
        ? session.participantUids.map(String)
        : [];

      const publishUids = Array.isArray(session.publishUids)
        ? session.publishUids.map(String)
        : [];

      const isAdmin = role === "admin";
      const isTeacher = role === "teacher" && teacherUid === uid;
      const isStudent = role === "student";

      // 5. Confirm permission to join.
      const isParticipant =
        isAdmin ||
        isTeacher ||
        participantUids.includes(uid);

      if (!isParticipant) {
        return json({
          error: "You are not authorized to join this classroom."
        }, 403, headers);
      }

      // 6. Determine camera and microphone publishing permission.
      let canPublish = false;

      if (isAdmin || isTeacher) {
        canPublish = true;
      } else if (isStudent && mode === "meeting") {
        canPublish = publishUids.includes(uid);
      }

      // 7. Create LiveKit access token.
      const room = `el-${roomId}`;

      const token = await createLiveKitToken(env, {
        uid,
        role,
        room,
        mode,
        canPublish
      });

      return json({
        success: true,
        serverUrl: env.LIVEKIT_URL,
        token,
        room,
        roomId,
        role,
        mode,
        canPublish,
        canSubscribe: true,
        expiresIn: 600
      }, 200, headers);

    } catch (error) {
      console.error("EqualLearn Live error:", error.message);

      const authError = /Firebase token|authentication is required|signing key/i.test(
        error.message
      );

      return json({
        success: false,
        error: error.message || "Unable to create LiveKit token."
      }, authError ? 401 : 500, headers);
    }
  }
};
