const DOMAIN = "paterostechnologicalcollege.edu.ph";
const DELETE_AFTER_DAYS = 7;
let tokenCache = { token: "", expiresAt: 0 };

function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pemToBytes(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function firestoreString(value) { return { stringValue: String(value ?? "") }; }
function firestoreBool(value) { return { booleanValue: Boolean(value) }; }
function firestoreTimestamp(value) { return { timestampValue: new Date(value).toISOString() }; }
function decodeFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if ("stringValue" in value) out[key] = value.stringValue;
    else if ("booleanValue" in value) out[key] = value.booleanValue;
    else if ("timestampValue" in value) out[key] = value.timestampValue;
    else if ("integerValue" in value) out[key] = Number(value.integerValue);
    else if ("nullValue" in value) out[key] = null;
    else out[key] = value;
  }
  return out;
}

async function serviceAccessToken(env) {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (!account.client_email || !account.private_key) throw new Error("Worker service account secrets are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Unable to obtain Google service access token.");
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  return tokenCache.token;
}

async function googleFetch(env, url, options = {}) {
  const token = await serviceAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Google API request failed (${response.status}).`);
  return body;
}

function firestoreBase(env) {
  const project = env.FIREBASE_PROJECT_ID || "equallearn-eb389";
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
}
async function getProfile(env, uid) {
  try {
    const doc = await googleFetch(env, `${firestoreBase(env)}/users/${encodeURIComponent(uid)}`);
    return decodeFields(doc.fields || {});
  } catch (error) {
    if (/NOT_FOUND|not found/i.test(error.message)) return null;
    throw error;
  }
}
async function patchProfile(env, uid, fields) {
  const names = Object.keys(fields);
  const query = names.map(name => `updateMask.fieldPaths=${encodeURIComponent(name)}`).join("&");
  await googleFetch(env, `${firestoreBase(env)}/users/${encodeURIComponent(uid)}?${query}`, {
    method: "PATCH", body: JSON.stringify({ fields })
  });
}
async function deleteProfile(env, uid) {
  await googleFetch(env, `${firestoreBase(env)}/users/${encodeURIComponent(uid)}`, { method: "DELETE" });
}
async function lookupFirebaseUser(env, idToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken })
  });
  const data = await response.json();
  if (!response.ok || !data.users?.[0]?.localId) throw new Error("Invalid or expired Firebase session.");
  return data.users[0];
}
async function authorizeRequest(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Authentication required.");
  const firebaseUser = await lookupFirebaseUser(env, match[1]);
  const profile = await getProfile(env, firebaseUser.localId);
  if (profile?.demoReadOnly === true) {
    throw new Error("Verification actions are disabled for read-only evaluation accounts.");
  }
  if (!profile || profile.status === "inactive" || !["admin", "gad_coordinator"].includes(String(profile.role || "").toLowerCase())) {
    throw new Error("Only active Admins and authorized GAD Coordinators can perform verification.");
  }
  return { uid: firebaseUser.localId, role: profile.role, email: firebaseUser.email || profile.email || "" };
}
async function writeAudit(env, actor, targetUid, action, reason = "") {
  const docId = crypto.randomUUID();
  const fields = {
    userId: firestoreString(actor.uid),
    actorId: firestoreString(actor.uid),
    actorRole: firestoreString(actor.role),
    targetUserId: firestoreString(targetUid),
    action: firestoreString(action),
    reason: firestoreString(reason),
    createdAt: firestoreTimestamp(new Date())
  };
  await googleFetch(env, `${firestoreBase(env)}/activityLogs?documentId=${docId}`, {
    method: "POST", body: JSON.stringify({ fields })
  });
}
async function deleteAuthUser(env, uid) {
  const project = env.FIREBASE_PROJECT_ID || "equallearn-eb389";
  const token = await serviceAccessToken(env);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:delete`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !/USER_NOT_FOUND|user not found/i.test(body.error?.message || "")) {
    throw new Error(body.error?.message || `Firebase Authentication deletion failed (${response.status}).`);
  }
}

async function verifyAction(env, actor, uid, action, reason) {
  const profile = await getProfile(env, uid);
  if (!profile || profile.role !== "student") return { uid, success: false, message: "Student profile not found." };
  const email = String(profile.email || "").trim().toLowerCase();
  const allowed = email.endsWith(`@${DOMAIN}`);
  const now = new Date();
  if (action === "approve") {
    if (!allowed) return { uid, success: false, message: "Unauthorized email domain; cannot approve." };
    if (profile.verificationStatus === "verified" || profile.academicProfileVerified === true) return { uid, success: false, message: "Already verified." };
    const missing = [];
    if (!profile.studentNumber) missing.push("Student ID");
    if (!profile.course) missing.push("course");
    if (!profile.yearLevel) missing.push("year level");
    if (!(profile.section || profile.sectionName || profile.className)) missing.push("section");
    if (!(profile.academicYear || profile.cohort || profile.cohortId)) missing.push("academic year");
    if (missing.length) return { uid, success: false, message: `Incomplete academic profile: ${missing.join(", ")}.` };
    await patchProfile(env, uid, {
      verificationStatus: firestoreString("verified"),
      academicProfileStatus: firestoreString("verified"),
      academicProfileVerified: firestoreBool(true),
      status: firestoreString("active"),
      verifiedBy: firestoreString(actor.uid),
      verifiedByRole: firestoreString(actor.role),
      verifiedAt: firestoreTimestamp(now),
      rejectionReason: { nullValue: null },
      rejectedBy: { nullValue: null },
      rejectedAt: { nullValue: null },
      deletionScheduledAt: { nullValue: null }
    });
    await writeAudit(env, actor, uid, "student_verified");
    return { uid, success: true, message: "Verified." };
  }
  if (action === "reject") {
    if (profile.verificationStatus === "verified" || profile.academicProfileVerified === true) return { uid, success: false, message: "Verified accounts cannot be rejected through this queue." };
    if (!reason || reason.length > 500) return { uid, success: false, message: "A rejection reason (1–500 characters) is required." };
    const deletionAt = new Date(now.getTime() + DELETE_AFTER_DAYS * 86400000);
    await patchProfile(env, uid, {
      verificationStatus: firestoreString("rejected"),
      academicProfileStatus: firestoreString("rejected"),
      academicProfileVerified: firestoreBool(false),
      status: firestoreString("inactive"),
      rejectionReason: firestoreString(reason),
      rejectedBy: firestoreString(actor.uid),
      rejectedByRole: firestoreString(actor.role),
      rejectedAt: firestoreTimestamp(now),
      deletionScheduledAt: firestoreTimestamp(deletionAt)
    });
    await writeAudit(env, actor, uid, "student_rejected", reason);
    return { uid, success: true, message: `Rejected. Account deletion scheduled for ${deletionAt.toISOString()}.` };
  }
  if (action === "restore") {
    if (profile.verificationStatus !== "rejected") return { uid, success: false, message: "Only rejected accounts can be restored." };
    const scheduled = Date.parse(profile.deletionScheduledAt || "");
    if (!Number.isFinite(scheduled) || scheduled <= now.getTime()) return { uid, success: false, message: "Deletion deadline has passed; account cannot be restored here." };
    await patchProfile(env, uid, {
      verificationStatus: firestoreString("pending"),
      academicProfileStatus: firestoreString("pending_verification"),
      academicProfileVerified: firestoreBool(false),
      status: firestoreString("active"),
      rejectionReason: { nullValue: null },
      rejectedBy: { nullValue: null },
      rejectedAt: { nullValue: null },
      deletionScheduledAt: { nullValue: null }
    });
    await writeAudit(env, actor, uid, "student_restored");
    return { uid, success: true, message: "Restored to pending verification." };
  }
  return { uid, success: false, message: "Unsupported action." };
}

async function runScheduledDeletion(env) {
  const now = new Date().toISOString();
  const query = {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: firestoreString("student") } },
        { fieldFilter: { field: { fieldPath: "verificationStatus" }, op: "EQUAL", value: firestoreString("rejected") } },
        { fieldFilter: { field: { fieldPath: "deletionScheduledAt" }, op: "LESS_THAN_OR_EQUAL", value: firestoreTimestamp(now) } }
      ] } },
      limit: 100
    }
  };
  const docs = await googleFetch(env, `${firestoreBase(env)}:runQuery`, { method: "POST", body: JSON.stringify(query) });
  const results = [];
  for (const item of docs) {
    if (!item.document?.name) continue;
    const uid = item.document.name.split("/").pop();
    try {
      await deleteAuthUser(env, uid);
      await deleteProfile(env, uid);
      try { await writeAudit(env, { uid: "system", role: "system" }, uid, "rejected_student_account_deleted"); }
      catch (auditError) { console.error("Deletion audit log failed", uid, auditError); }
      results.push({ uid, deleted: true });
    } catch (error) {
      console.error("Scheduled student deletion failed", uid, error);
      results.push({ uid, deleted: false, error: error.message });
    }
  }
  return results;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "http://127.0.0.1:5500,http://localhost:5500")
    .split(",").map(x => x.trim()).filter(Boolean);
  const headers = { "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname !== "/api/verification" || request.method !== "POST") return json({ error: "Not found." }, 404, headers);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "http://127.0.0.1:5500,http://localhost:5500").split(",").map(x => x.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ error: "Origin not allowed." }, 403, headers);
    try {
      const actor = await authorizeRequest(request, env);
      const body = await request.json();
      const action = String(body.action || "");
      const uids = [...new Set((Array.isArray(body.uids) ? body.uids : []).map(x => String(x).trim()).filter(Boolean))];
      const reason = String(body.reason || "").trim();
      if (!["approve", "reject", "restore"].includes(action)) return json({ error: "Invalid action." }, 400, headers);
      if (!uids.length || uids.length > 100) return json({ error: "Select between 1 and 100 students per request." }, 400, headers);
      if (action === "reject" && !reason) return json({ error: "A rejection reason is required." }, 400, headers);
      const results = [];
      for (const uid of uids) {
        try { results.push(await verifyAction(env, actor, uid, action, reason)); }
        catch (error) { results.push({ uid, success: false, message: error.message }); }
      }
      return json({ success: results.every(x => x.success), results }, 200, headers);
    } catch (error) {
      console.error("Verification API error:", error);
      const status = /Authentication required|Invalid or expired|Only active/i.test(error.message) ? 403 : 500;
      return json({ error: error.message || "Internal server error." }, status, headers);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledDeletion(env).then(results => console.log("Scheduled deletion run:", results.length, results.filter(x => x.deleted).length, "deleted")));
  }
};
