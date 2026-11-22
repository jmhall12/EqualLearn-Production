
const FIREBASE_PROJECT_ID = "equallearn-eb389";

const ALLOWED_ORIGINS = new Set([
  "https://equallearn.pages.dev",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const encoder = new TextEncoder();

let cachedFirebaseKeys = null;
let cachedFirebaseKeysUntil = 0;

/* =========================================
   RESPONSE AND CORS
========================================= */

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

/* =========================================
   JWT HELPERS
========================================= */

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
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    normalized + "=".repeat((4 - normalized.length % 4) % 4)
  );

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(
    new TextDecoder().decode(decodeBase64url(value))
  );
}

/* =========================================
   FIREBASE TOKEN VERIFICATION
========================================= */

async function getFirebaseKeys() {
  if (
    cachedFirebaseKeys &&
    Date.now() < cachedFirebaseKeysUntil
  ) {
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

    throw new Error(
      "Firebase signing key not found. Please sign in again."
    );
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

/* =========================================
   FIRESTORE REST DECODER
========================================= */

function decodeFirestoreValue(value) {
  if (!value) return null;

  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(
      decodeFirestoreValue
    );
  }

  if ("mapValue" in value) {
    return decodeFirestoreFields(
      value.mapValue.fields || {}
    );
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

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      result.error?.message ||
      "Unable to read Firestore document."
    );
  }

  return decodeFirestoreFields(result.fields || {});
}

/* =========================================
   VALIDATION HELPERS
========================================= */

function isUUIDv4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getParticipantDisplayName(user, firebaseUser, role) {
  const candidates = [
    user?.fullname,
    user?.fullName,
    user?.displayName,
    user?.name,
    firebaseUser?.name,
    user?.email,
    firebaseUser?.email
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (value) return value.slice(0, 80);
  }

  return role === "teacher"
    ? "EqualLearn Teacher"
    : role === "student"
      ? "EqualLearn Student"
      : "EqualLearn Admin";
}

/* =========================================
   LIVEKIT TOKEN GENERATOR
========================================= */

async function createLiveKitToken(env, options) {
  const {
    uid,
    role,
    room,
    mode,
    canPublish,
    displayName
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
    name: String(displayName || `EqualLearn ${role}`).slice(0, 80),

    video: {
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish,
      canPublishData: true,

      ...(canPublish
        ? {
            canPublishSources: [
              "camera",
              "microphone",
              "screen_share",
              "screen_share_audio"
            ]
          }
        : {})
    },

    metadata: JSON.stringify({
      role,
      mode,
      displayName: String(displayName || `EqualLearn ${role}`).slice(0, 80),
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
async function createLiveKitAdminToken(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  // DeleteRoom requires the roomCreate grant.
  const payload = {
    iss: env.LIVEKIT_API_KEY,
    sub: "equallearn-server",
    nbf: now,
    iat: now,
    exp: now + 300,
    video: {
      roomCreate: true
    }
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

async function deleteLiveKitRoom(env, roomId) {
  const roomName = `el-${roomId}`;
  const adminToken = await createLiveKitAdminToken(env);

  const serverUrl = String(env.LIVEKIT_URL || "")
    .trim()
    .replace(/^wss:/i, "https:")
    .replace(/^ws:/i, "http:")
    .replace(/\/+$/, "");

  if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) {
    throw new Error("Invalid LIVEKIT_URL configuration.");
  }

  const response = await fetch(
    `${serverUrl}/twirp/livekit.RoomService/DeleteRoom`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        room: roomName
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `LiveKit room termination failed (${response.status}): ${errorText.slice(0, 300)}`
    );
  }
}

/* =========================================
   MAIN WORKER
========================================= */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    /* CORS ORIGIN VALIDATION */
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(
        { success: false, error: "Origin not allowed." },
        403,
        headers
      );
    }

    /* PREFLIGHT */
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    /* HEALTH CHECK */
    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return json({
        success: true,
        service: "EqualLearn Live Token Service"
      }, 200, headers);
    }

    /* TOKEN ENDPOINT ONLY */
   if (
  request.method !== "POST" ||
  !["/token", "/end"].includes(url.pathname)
) {
  return json(
    { success: false, error: "Endpoint not found." },
    404,
    headers
  );
}

    try {
      /* =====================================
         1. CHECK ENVIRONMENT VARIABLES
      ===================================== */

      if (
        !env.LIVEKIT_API_KEY ||
        !env.LIVEKIT_API_SECRET ||
        !env.LIVEKIT_URL
      ) {
        return json({
          success: false,
          error: "LiveKit environment variables are incomplete."
        }, 500, headers);
      }

      /* =====================================
         2. VERIFY FIREBASE AUTHENTICATION
      ===================================== */

      const authorization =
        request.headers.get("Authorization") || "";

      const match = authorization.match(/^Bearer\s+(.+)$/i);

      if (!match) {
        return json({
          success: false,
          error: "Firebase authentication is required."
        }, 401, headers);
      }

      const idToken = match[1].trim();

      if (!idToken || idToken.length > 10000) {
        return json({
          success: false,
          error: "Invalid authentication token."
        }, 401, headers);
      }

      const firebaseUser = await verifyFirebaseToken(idToken);
      const uid = firebaseUser.sub;

      /* =====================================
         3. VERIFY EQUALLEARN USER PROFILE
      ===================================== */

      const user = await getFirestoreDocument(
        `users/${encodeURIComponent(uid)}`,
        idToken
      );

      if (!user) {
        return json({
          success: false,
          error: "User profile not found."
        }, 403, headers);
      }

      // Evaluation accounts are strictly view-only: deny LiveKit token issuance
      // and room termination even if a caller bypasses the browser controls.
      if (user.demoReadOnly === true) {
        return json({
          success: false,
          error: "Live sessions are disabled for read-only evaluation accounts."
        }, 403, headers);
      }

      const role = normalize(user.role);
      const status = normalize(user.status);

      if (
        (user.uid && user.uid !== uid) ||
        status !== "active" ||
        !["admin", "teacher", "student"].includes(role)
      ) {
        return json({
          success: false,
          error: "Your EqualLearn account is not authorized."
        }, 403, headers);
      }

      /* =====================================
         4. VALIDATE REQUESTED ROOM
      ===================================== */

      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          success: false,
          error: "Invalid JSON request body."
        }, 400, headers);
      }

      const roomId = String(body.roomId || "").trim();

      if (!isUUIDv4(roomId)) {
        return json({
          success: false,
          error: "A valid UUIDv4 roomId is required."
        }, 400, headers);
      }

      /* =====================================
         5. READ ACTUAL LIVE SESSION
      ===================================== */

      const session = await getFirestoreDocument(
        `liveSessions/${encodeURIComponent(roomId)}`,
        idToken
      );

      if (!session) {
        return json({
          success: false,
          error: "Live session does not exist."
        }, 404, headers);
      }

      if (String(session.roomId || "") !== roomId) {
        return json({
          success: false,
          error: "Live session ID does not match."
        }, 403, headers);
      }

     // Secure End for Everyone endpoint.
// Only the active teacher assigned to this session can terminate the room.
if (url.pathname === "/end") {
  if (role !== "teacher" || String(session.teacherUid || "") !== uid) {
    return json({
      success: false,
      error: "Only the session's assigned teacher can end this classroom."
    }, 403, headers);
  }

  if (normalize(session.status) !== "live") {
    return json({
      success: false,
      error: "This classroom is not currently live."
    }, 409, headers);
  }

  const sectionId = String(session.sectionId || "");

  if (!sectionId) {
    return json({
      success: false,
      error: "The classroom has no valid section assignment."
    }, 403, headers);
  }

  const section = await getFirestoreDocument(
    `sections/${encodeURIComponent(sectionId)}`,
    idToken
  );

  const teacherIds = Array.isArray(section?.teacherIds)
    ? section.teacherIds.map(String)
    : [];

  const isAssignedTeacher =
    teacherIds.includes(uid) ||
    String(section?.teacherId || "") === uid;

  if (!section || !isAssignedTeacher) {
    return json({
      success: false,
      error: "You are no longer assigned to this classroom."
    }, 403, headers);
  }

  await deleteLiveKitRoom(env, roomId);

  return json({
    success: true,
    message: "Everyone has been disconnected from the classroom.",
    roomId
  }, 200, headers);
}

      if (normalize(session.status) !== "live") {
        return json({
          success: false,
          error: "This session is not currently live."
        }, 403, headers);
      }

      const mode = normalize(session.mode);

      if (!["livestream", "meeting"].includes(mode)) {
        return json({
          success: false,
          error: "Invalid live session mode."
        }, 400, headers);
      }

      /* =====================================
         6. READ SESSION IDENTITY AND PERMISSIONS
      ===================================== */

      const teacherUid = String(session.teacherUid || "");
      const sectionId = String(session.sectionId || "");

      const participantUids = Array.isArray(session.participantUids)
        ? session.participantUids.map(String)
        : [];

      const publishUids = Array.isArray(session.publishUids)
        ? session.publishUids.map(String)
        : [];

      const meetingType = normalize(
        session.meetingType ||
        (mode === "livestream" ? "livestream" : "batch")
      );

      const targetStudentUid = String(
        session.targetStudentUid || ""
      );

      const isAdmin = role === "admin";
      const isTeacher = role === "teacher";
      const isStudent = role === "student";

      /* =====================================
         7. VALIDATE REQUIRED SESSION FIELDS
      ===================================== */

      if (!teacherUid || !sectionId) {
        return json({
          success: false,
          error: "The live session is missing its teacher or section."
        }, 403, headers);
      }

      if (!participantUids.includes(teacherUid)) {
        return json({
          success: false,
          error: "The session owner is missing from the participant list."
        }, 403, headers);
      }

      if (!publishUids.includes(teacherUid)) {
        return json({
          success: false,
          error: "The teacher must be authorized to publish."
        }, 403, headers);
      }

      if (
        !["batch", "one_on_one", "livestream"].includes(meetingType)
      ) {
        return json({
          success: false,
          error: "Invalid meeting type."
        }, 400, headers);
      }

      /* =====================================
         8. ENSURE MODE MATCHES MEETING TYPE
      ===================================== */

      if (
        (meetingType === "livestream" && mode !== "livestream") ||
        (meetingType !== "livestream" && mode !== "meeting")
      ) {
        return json({
          success: false,
          error: "Session mode does not match meeting type."
        }, 403, headers);
      }

      /* =====================================
         9. VALIDATE PARTICIPANT AND PUBLISH LISTS
      ===================================== */

      const uniqueParticipants = [...new Set(participantUids)];
      const uniquePublishers = [...new Set(publishUids)];

      if (
        uniqueParticipants.length !== participantUids.length ||
        uniquePublishers.length !== publishUids.length ||
        publishUids.some(
          participantUid => !participantUids.includes(participantUid)
        )
      ) {
        return json({
          success: false,
          error: "Invalid participant or publishing permissions."
        }, 403, headers);
      }

      /* =====================================
         10. VALIDATE BATCH MEETING
      ===================================== */

      if (meetingType === "batch") {
        if (
          targetStudentUid ||
          mode !== "meeting" ||
          publishUids.length !== participantUids.length
        ) {
          return json({
            success: false,
            error: "Invalid Batch Meeting configuration."
          }, 403, headers);
        }
      }

      /* =====================================
         11. VALIDATE ONE-ON-ONE MEETING
      ===================================== */

      if (meetingType === "one_on_one") {
        if (
          !targetStudentUid ||
          targetStudentUid === teacherUid ||
          participantUids.length !== 2 ||
          !participantUids.includes(targetStudentUid) ||
          mode !== "meeting" ||
          publishUids.length !== participantUids.length
        ) {
          return json({
            success: false,
            error: "Invalid One-on-One configuration."
          }, 403, headers);
        }
      }

      /* =====================================
         12. VALIDATE LIVESTREAM
      ===================================== */

      if (meetingType === "livestream") {
        if (
          targetStudentUid ||
          mode !== "livestream" ||
          publishUids.length !== 1 ||
          publishUids[0] !== teacherUid
        ) {
          return json({
            success: false,
            error: "Invalid Livestream configuration."
          }, 403, headers);
        }
      }

      /* =====================================
         13. VERIFY TEACHER IDENTITY AND ASSIGNMENT
      ===================================== */

      if (isTeacher) {
        if (teacherUid !== uid) {
          return json({
            success: false,
            error: "Only the session owner teacher can join as teacher."
          }, 403, headers);
        }

        const section = await getFirestoreDocument(
          `sections/${encodeURIComponent(sectionId)}`,
          idToken
        );

        const teacherIds = Array.isArray(section?.teacherIds)
          ? section.teacherIds.map(String)
          : [];

        const teacherIsAssigned =
          teacherIds.includes(uid) ||
          String(section?.teacherId || "") === uid;

        if (!section || !teacherIsAssigned) {
          return json({
            success: false,
            error: "You are no longer assigned to this classroom."
          }, 403, headers);
        }
      }

      /* =====================================
         14. VERIFY STUDENT PARTICIPATION
      ===================================== */

      let isStudentParticipant = false;

      if (isStudent) {
        const studentSectionId = String(user.sectionId || "");

        const belongsToSection =
          studentSectionId === sectionId;

        const isListedParticipant =
          participantUids.includes(uid);

        const isValidTarget =
          meetingType !== "one_on_one" ||
          targetStudentUid === uid;

        isStudentParticipant =
          belongsToSection &&
          isListedParticipant &&
          isValidTarget;

        if (!isStudentParticipant) {
          return json({
            success: false,
            error: "You are not authorized to join this classroom."
          }, 403, headers);
        }
      }

      /* =====================================
         15. VERIFY ROLE AUTHORIZATION
      ===================================== */

      if (
        !isAdmin &&
        !isTeacher &&
        !isStudentParticipant
      ) {
        return json({
          success: false,
          error: "You are not authorized to join this classroom."
        }, 403, headers);
      }

      /* =====================================
         16. DETERMINE PUBLISHING PERMISSIONS

         ADMIN:
         - Can publish audio/video.
         - Can participate in the room.
         - Does not receive roomAdmin privilege.

         TEACHER:
         - Must own the session.
         - Must still be assigned to the section.

         STUDENT:
         - Must be an authorized participant.
         - Must be included in publishUids.
         - Can publish only in interactive meetings.
      ===================================== */

      const canPublish =
        isAdmin ||
        isTeacher ||
        (
          isStudentParticipant &&
          mode === "meeting" &&
          publishUids.includes(uid)
        );

      /* =====================================
         17. CREATE LIVEKIT ACCESS TOKEN
      ===================================== */

      const room = `el-${roomId}`;
      const displayName = getParticipantDisplayName(user, firebaseUser, role);

      const token = await createLiveKitToken(env, {
        uid,
        role,
        room,
        mode,
        canPublish,
        displayName
      });

      /* =====================================
         18. RETURN ACCESS DETAILS
      ===================================== */

      return json({
        success: true,
        serverUrl: env.LIVEKIT_URL,
        token,
        room,
        roomId,
        role,
        displayName,
        mode,
        meetingType,
        canPublish,
        canSubscribe: true,
        expiresIn: 600
      }, 200, headers);

    } catch (error) {
      console.error(
        "EqualLearn Live error:",
        error.message
      );

      const authError =
        /Firebase token|authentication is required|signing key/i.test(
          error.message
        );

      return json({
        success: false,
        error: error.message ||
          "Unable to create LiveKit token."
      }, authError ? 401 : 500, headers);
    }
  }
};
