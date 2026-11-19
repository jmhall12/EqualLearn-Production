import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const PUSH_WORKER_URL = "https://equallearn-web-push.jmhallig-a48.workers.dev";
const VAPID_PUBLIC_KEY = "BHDWCl52z3KypptauLy3msuE3KWXkaD9-Bv3WQGAp9S17MiZhC0RbuQTzMmXQYrEpGAmCZsNLI10FpuUAc9PW3I";
const ALLOWED_ORIGIN = "https://equallearn.pages.dev";

let serviceWorkerRegistration = null;
let currentUser = null;
let authReady = false;
let authUnsubscribe = null;
let nativePushPlugin = null;
let nativeListenersBound = false;
let pendingNativeToken = "";
let webSyncInProgress = false;
let nativeSyncInProgress = false;

const isCapacitorNative = () => Boolean(
  window.Capacitor?.isNativePlatform?.() ||
  ["android", "ios"].includes(window.Capacitor?.getPlatform?.())
);
const isProductionDomain = () => location.origin === ALLOWED_ORIGIN;
const isLocalDevelopment = () => ["localhost", "127.0.0.1"].includes(location.hostname);

function urlBase64ToUint8Array(value) {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function callPushWorker(path, options = {}) {
  const response = await fetch(`${PUSH_WORKER_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Push Worker error: ${response.status}`);
  return result;
}

async function idToken() {
  if (!currentUser) throw new Error("Please sign in to EqualLearn first.");
  return currentUser.getIdToken();
}

async function registerEqualLearnServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (isLocalDevelopment()) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith("equallearn-shell-")).map(key => caches.delete(key)));
    } catch (error) { console.warn("Local service-worker cleanup:", error); }
    return null;
  }
  if (!isProductionDomain()) return null;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return serviceWorkerRegistration;
  } catch (error) {
    console.error("EqualLearn service-worker registration failed:", error);
    return null;
  }
}

async function registerWebPush() {
  if (!currentUser) throw new Error("Please log in first.");
  if (!isProductionDomain()) throw new Error("Device notifications are available on the production EqualLearn domain.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("This browser does not support Web Push. Use the EqualLearn Android app or a supported browser.");
  }
  if (Notification.permission !== "granted") throw new Error("Allow notifications in your browser settings first.");
  const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
  if (!registration) throw new Error("EqualLearn service worker is unavailable.");
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  return callPushWorker("/subscribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ subscription: subscription.toJSON() })
  });
}

async function unregisterWebPush() {
  if (!currentUser || !serviceWorkerRegistration) return { success: true };
  const subscription = await serviceWorkerRegistration.pushManager.getSubscription();
  if (!subscription) return { success: true };
  await callPushWorker("/unsubscribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
  await subscription.unsubscribe();
  return { success: true };
}

async function loadNativePlugin() {
  if (nativePushPlugin) return nativePushPlugin;
  if (!isCapacitorNative()) throw new Error("This is not a native Capacitor app.");
  // The APK has the native plugin installed by Capacitor. esm.sh serves its ESM bridge
  // for this static (non-bundled) web frontend.
  const module = await import("https://esm.sh/@capacitor/push-notifications@8.1.3?bundle");
  nativePushPlugin = module.PushNotifications;
  if (!nativePushPlugin) throw new Error("Capacitor Push Notifications plugin is unavailable. Rebuild and sync the Android app.");
  return nativePushPlugin;
}

function safeDeviceTarget(value) {
  try {
    const url = new URL(String(value || "/student/dashboard.html"), ALLOWED_ORIGIN);
    return url.origin === ALLOWED_ORIGIN ? url.href : `${ALLOWED_ORIGIN}/student/dashboard.html`;
  } catch {
    return `${ALLOWED_ORIGIN}/student/dashboard.html`;
  }
}

async function syncNativeToken(token) {
  if (!currentUser || !token || nativeSyncInProgress) return;
  nativeSyncInProgress = true;
  try {
    await callPushWorker("/native/subscribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ token, platform: window.Capacitor?.getPlatform?.() || "android" })
    });
    setPushStatus("This phone is registered for EqualLearn push notifications.", true);
  } catch (error) {
    console.error("EqualLearn native push token registration failed:", error);
    setPushStatus(error.message || "Unable to register this phone.", false);
  } finally {
    nativeSyncInProgress = false;
  }
}

async function bindNativeListeners(plugin) {
  if (nativeListenersBound) return;
  nativeListenersBound = true;
  await plugin.addListener("registration", token => {
    pendingNativeToken = token?.value || "";
    if (currentUser) syncNativeToken(pendingNativeToken);
  });
  await plugin.addListener("registrationError", error => {
    console.error("EqualLearn FCM registration error:", error);
    setPushStatus(error?.error || "Phone notification registration failed.", false);
  });
  // Native foreground system banner and sound are handled by capacitor.config.json
  // presentationOptions. Do not add a second custom HTML banner here.
  await plugin.addListener("pushNotificationActionPerformed", action => {
    const data = action?.notification?.data || {};
    location.assign(safeDeviceTarget(data.url || data.targetUrl));
  });
}

async function registerNativePush({ requestPermission = false } = {}) {
  if (!currentUser) throw new Error("Please log in first.");
  const plugin = await loadNativePlugin();
  await bindNativeListeners(plugin);

  try {
    await plugin.createChannel({
      id: "equallearn_class_v2",
      name: "EqualLearn Class Notifications",
      description: "Audible alerts for lessons, assignments, quizzes, and live classes",
      importance: 5,
      visibility: 1,
      sound: "equallearn_notification",
      vibration: true
    });
  } catch (error) {
    console.info("EqualLearn notification channel already exists or is not supported:", error?.message || error);
  }

  let permission = await plugin.checkPermissions();
  if (permission.receive !== "granted" && requestPermission) permission = await plugin.requestPermissions();
  if (permission.receive !== "granted") throw new Error("Allow EqualLearn notifications in Android when the permission prompt appears.");
  await plugin.register();
  if (pendingNativeToken) await syncNativeToken(pendingNativeToken);
  return { success: true };
}

function setPushStatus(message, success = false) {
  const status = document.getElementById("equalLearnPushStatus");
  if (status) {
    status.textContent = message;
    status.style.color = success ? "#16875d" : "";
  }
  const button = document.getElementById("equalLearnEnablePush");
  if (button && success) {
    button.textContent = "Notifications Enabled";
    button.style.background = "#16875d";
  }
}

function createNotificationButton() {
  const list = document.getElementById("notificationList");
  if (!list || document.getElementById("equalLearnEnablePush")) return;
  const header = list.closest(".el-card")?.querySelector(".el-card-title");
  if (!header) return;
  const container = document.createElement("div");
  container.id = "equalLearnPushControls";
  container.style.cssText = "display:flex;flex-direction:column;gap:8px;margin:12px 0;";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "equalLearnEnablePush";
  button.textContent = isCapacitorNative() ? "Enable Phone Notifications" : "Enable Device Notifications";
  button.style.cssText = "border:0;border-radius:10px;padding:11px 16px;background:var(--student-purple,#7865dc);color:white;font-weight:700;cursor:pointer;width:fit-content;max-width:100%;";
  const status = document.createElement("small");
  status.id = "equalLearnPushStatus";
  status.style.cssText = "color:var(--student-muted,#858ba6);font-size:12px;line-height:1.5;";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Enabling notifications…";
    status.textContent = "";
    try {
      if (!authReady || !currentUser) throw new Error("Please log in to your student account first.");
      if (isCapacitorNative()) {
        await registerNativePush({ requestPermission: true });
      } else {
        if (!isProductionDomain()) throw new Error("Device notifications require the production EqualLearn domain.");
        if (!("Notification" in window)) throw new Error("This browser does not support notifications.");
        if (Notification.permission === "denied") throw new Error("Notifications are blocked. Allow them in your browser or phone settings.");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("You did not allow notifications.");
        await registerWebPush();
        setPushStatus("This device is registered for EqualLearn notifications.", true);
      }
    } catch (error) {
      console.error("EQUALLEARN PUSH REGISTRATION ERROR:", error);
      button.textContent = "Try Again";
      status.textContent = error.message || "Unable to enable device notifications.";
    } finally {
      button.disabled = false;
    }
  });
  container.append(button, status);
  header.appendChild(container);
}

async function updateNotificationButton() {
  const button = document.getElementById("equalLearnEnablePush");
  const status = document.getElementById("equalLearnPushStatus");
  if (!button || !status) return;
  if (!authReady) { button.disabled = true; status.textContent = "Checking your account…"; return; }
  if (!currentUser) { button.disabled = true; button.textContent = "Log in to Enable Notifications"; status.textContent = "Sign in first."; return; }

  button.disabled = false;
  if (isCapacitorNative()) {
    button.textContent = "Enable Phone Notifications";
    status.textContent = "Allow notifications once; this phone will reconnect automatically on later visits.";
    try {
      const plugin = await loadNativePlugin();
      const permission = await plugin.checkPermissions();
      if (permission.receive === "granted") {
        button.textContent = "Refresh Phone Registration";
        status.textContent = "Android notification permission is enabled.";
      }
    } catch (error) { status.textContent = "Tap to enable notifications on this phone."; }
    return;
  }

  if (!("Notification" in window) || !("PushManager" in window)) {
    button.disabled = true;
    button.textContent = "Notifications Unsupported";
    status.textContent = "Use the EqualLearn Android app or a supported browser.";
    return;
  }
  if (Notification.permission === "denied") {
    button.textContent = "Notifications Blocked";
    status.textContent = "Allow notifications in your browser/site settings.";
    return;
  }
  if (Notification.permission === "granted") {
    button.textContent = "Notifications Enabled";
    status.textContent = "This device has permission. EqualLearn will refresh its registration after sign-in.";
  } else {
    button.textContent = "Enable Device Notifications";
    status.textContent = "Allow this device to receive EqualLearn updates.";
  }
}

async function syncExistingDeviceRegistration() {
  if (!currentUser) return;
  if (isCapacitorNative()) {
    try {
      const plugin = await loadNativePlugin();
      const permission = await plugin.checkPermissions();
      if (permission.receive === "granted") {
        await registerNativePush({ requestPermission: false });
      }
    } catch (error) { console.warn("Native push auto-sync skipped:", error?.message || error); }
    return;
  }
  if (!isProductionDomain() || !serviceWorkerRegistration || !supportsWebPushGranted()) return;
  if (webSyncInProgress) return;
  webSyncInProgress = true;
  try { await registerWebPush(); }
  catch (error) { console.warn("Web Push auto-sync skipped:", error?.message || error); }
  finally { webSyncInProgress = false; }
}
function supportsWebPushGranted() {
  return "Notification" in window && "PushManager" in window && "serviceWorker" in navigator && Notification.permission === "granted";
}

function initializeAuth() {
  if (authUnsubscribe) return;
  authUnsubscribe = onAuthStateChanged(auth, user => {
    currentUser = user;
    authReady = true;
    updateNotificationButton();
    if (user) syncExistingDeviceRegistration();
  });
}

window.addEventListener("load", async () => {
  initializeAuth();
  await registerEqualLearnServiceWorker();
  createNotificationButton();
  await updateNotificationButton();
  if (authReady && currentUser) syncExistingDeviceRegistration();
});

window.EqualLearnPush = {
  register: () => isCapacitorNative() ? registerNativePush({ requestPermission: true }) : registerWebPush(),
  unregister: unregisterWebPush,
  isNative: isCapacitorNative
};
