
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const PUSH_WORKER_URL =
    "https://equallearn-web-push.jmhallig-a48.workers.dev";

const VAPID_PUBLIC_KEY =
    "BHDWCl52z3KypptauLy3msuE3KWXkaD9-Bv3WQGAp9S17MiZhC0RbuQTzMmXQYrEpGAmCZsNLI10FpuUAc9PW3I";

const ALLOWED_ORIGIN = "https://equallearn.pages.dev";

let serviceWorkerRegistration = null;
let currentUser = null;
let authReady = false;
let authUnsubscribe = null;

// ============================================
// ENVIRONMENT
// ============================================

function isLocalDevelopment() {
    return (
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1"
    );
}

function isProductionDomain() {
    return location.origin === ALLOWED_ORIGIN;
}

// ============================================
// BASE64 URL CONVERSION
// ============================================

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat(
        (4 - base64String.length % 4) % 4
    );

    const base64 = (
        base64String + padding
    )
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const rawData = atob(base64);

    return Uint8Array.from(
        [...rawData].map(character =>
            character.charCodeAt(0)
        )
    );
}

// ============================================
// AUTH STATE
// ============================================

function initializeAuth() {
    if (authUnsubscribe) return;

    authUnsubscribe = onAuthStateChanged(
        auth,
        user => {
            currentUser = user;
            authReady = true;

            updateNotificationButton();
        }
    );
}

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================

async function registerEqualLearnServiceWorker() {

    if (!("serviceWorker" in navigator)) {
        console.warn(
            "EqualLearn: Service Workers are not supported."
        );

        return null;
    }

    if (isLocalDevelopment()) {

        try {
            const registrations =
                await navigator.serviceWorker.getRegistrations();

            for (const registration of registrations) {
                await registration.unregister();
            }

            const cacheKeys = await caches.keys();

            await Promise.all(
                cacheKeys
                    .filter(key =>
                        key.startsWith("equallearn-shell-")
                    )
                    .map(key => caches.delete(key))
            );

            console.info(
                "EqualLearn: Service Worker disabled for local development."
            );

        } catch (error) {
            console.error(
                "Local Service Worker cleanup failed:",
                error
            );
        }

        return null;
    }

    if (!isProductionDomain()) {
        console.warn(
            "EqualLearn: Push registration skipped on an unapproved domain."
        );

        return null;
    }

    try {

        const swUrl = new URL(
            "/service-worker.js",
            ALLOWED_ORIGIN
        );

        serviceWorkerRegistration =
            await navigator.serviceWorker.register(
                swUrl,
                { scope: "/" }
            );

        await navigator.serviceWorker.ready;

        console.info(
            "EqualLearn Service Worker registered:",
            serviceWorkerRegistration.scope
        );

        return serviceWorkerRegistration;

    } catch (error) {

        console.error(
            "EqualLearn Service Worker registration failed:",
            error
        );

        return null;
    }
}

// ============================================
// PUSH SUPPORT CHECK
// ============================================

function supportsPushNotifications() {

    return (
        "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator
    );
}

// ============================================
// WORKER API
// ============================================

async function callPushWorker(path, options = {}) {

    const response = await fetch(
        `${PUSH_WORKER_URL}${path}`,
        {
            ...options,

            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        }
    );

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error(
            "Invalid response from EqualLearn Push Worker."
        );
    }

    if (!response.ok) {
        throw new Error(
            result.error ||
            `Push Worker error: ${response.status}`
        );
    }

    return result;
}

// ============================================
// REGISTER DEVICE
// ============================================

async function registerPushSubscription() {

    if (!currentUser) {
        throw new Error(
            "Please log in to your student account first."
        );
    }

    if (!supportsPushNotifications()) {
        throw new Error(
            "Push notifications are not supported by this browser."
        );
    }

    if (!isProductionDomain()) {
        throw new Error(
            "Push notifications are available on the production EqualLearn domain."
        );
    }

    if (!VAPID_PUBLIC_KEY ||
        VAPID_PUBLIC_KEY.includes("ILAGAY_DITO")) {

        throw new Error(
            "The VAPID public key has not been configured."
        );
    }

    const registration =
        serviceWorkerRegistration ||
        await navigator.serviceWorker.ready;

    if (!registration) {
        throw new Error(
            "EqualLearn service worker is unavailable."
        );
    }

    let subscription =
        await registration.pushManager.getSubscription();

    if (!subscription) {

        subscription =
            await registration.pushManager.subscribe({
                userVisibleOnly: true,

                applicationServerKey:
                    urlBase64ToUint8Array(
                        VAPID_PUBLIC_KEY
                    )
            });
    }

    const idToken =
        await currentUser.getIdToken();

    const result = await callPushWorker(
        "/subscribe",
        {
            method: "POST",

            headers: {
                Authorization: `Bearer ${idToken}`
            },

            body: JSON.stringify({
                subscription:
                    subscription.toJSON()
            })
        }
    );

    console.info(
        "EqualLearn: Device successfully registered for push notifications."
    );

    return result;
}

// ============================================
// UNREGISTER DEVICE
// ============================================

async function unregisterPushSubscription() {

    if (!currentUser) {
        throw new Error(
            "Please log in first."
        );
    }

    const registration =
        serviceWorkerRegistration ||
        await navigator.serviceWorker.ready;

    const subscription =
        await registration.pushManager.getSubscription();

    if (!subscription) {
        return {
            success: true,
            message: "No active subscription."
        };
    }

    const idToken =
        await currentUser.getIdToken();

    await callPushWorker(
        "/unsubscribe",
        {
            method: "POST",

            headers: {
                Authorization: `Bearer ${idToken}`
            },

            body: JSON.stringify({
                endpoint: subscription.endpoint
            })
        }
    );

    await subscription.unsubscribe();

    console.info(
        "EqualLearn: Device unsubscribed from push notifications."
    );

    return { success: true };
}

// ============================================
// UI: NOTIFICATION BUTTON
// ============================================

function createNotificationButton() {

    const notificationList =
        document.getElementById("notificationList");

    if (!notificationList) return;

    if (
        document.getElementById(
            "equalLearnEnablePush"
        )
    ) {
        return;
    }

    const card =
        notificationList.closest(".el-card");

    const header =
        card?.querySelector(".el-card-title");

    if (!header) return;

    const container =
        document.createElement("div");

    container.id = "equalLearnPushControls";

    container.style.cssText = `
        display:flex;
        flex-direction:column;
        gap:8px;
        margin-top:12px;
        margin-bottom:12px;
    `;

    const button =
        document.createElement("button");

    button.type = "button";
    button.id = "equalLearnEnablePush";

    button.textContent =
        "Enable Device Notifications";

    button.style.cssText = `
        border:0;
        border-radius:10px;
        padding:11px 16px;
        background:var(--student-purple,#7865dc);
        color:white;
        font-weight:600;
        cursor:pointer;
        width:fit-content;
        max-width:100%;
    `;

    const status =
        document.createElement("small");

    status.id = "equalLearnPushStatus";

    status.style.cssText = `
        color:var(--student-muted,#858ba6);
        font-size:12px;
        line-height:1.5;
    `;

    button.addEventListener(
        "click",
        async () => {

            button.disabled = true;

            button.textContent =
                "Enabling notifications...";

            status.textContent = "";

            try {

                if (!authReady) {
                    throw new Error(
                        "Authentication is still loading. Please try again."
                    );
                }

                if (!currentUser) {
                    throw new Error(
                        "Please log in to your student account."
                    );
                }

                if (!supportsPushNotifications()) {
                    throw new Error(
                        "Your browser does not support push notifications."
                    );
                }

                if (Notification.permission === "denied") {
                    throw new Error(
                        "Notifications are blocked. Enable them in your browser site settings."
                    );
                }

                const permission =
                    await Notification.requestPermission();

                if (permission !== "granted") {
                    throw new Error(
                        "You did not allow notifications."
                    );
                }

                await registerPushSubscription();

                button.textContent =
                    "Notifications Enabled";

                button.style.background =
                    "#16875d";

                status.textContent =
                    "This device is registered for EqualLearn notifications.";

            } catch (error) {

                console.error(
                    "EQUALLEARN PUSH REGISTRATION ERROR:",
                    error
                );

                button.textContent =
                    "Try Again";

                status.textContent =
                    error.message ||
                    "Unable to enable notifications.";

            } finally {

                button.disabled = false;
            }
        }
    );

    container.append(button, status);

    header.appendChild(container);
}

// ============================================
// UPDATE BUTTON STATE
// ============================================

async function updateNotificationButton() {

    const button =
        document.getElementById(
            "equalLearnEnablePush"
        );

    const status =
        document.getElementById(
            "equalLearnPushStatus"
        );

    if (!button || !status) return;

    if (!authReady) {
        button.disabled = true;
        status.textContent =
            "Checking your account...";
        return;
    }

    if (!currentUser) {
        button.disabled = true;
        button.textContent =
            "Log in to Enable Notifications";

        status.textContent =
            "Sign in to your student account first.";

        return;
    }

    button.disabled = false;

    if (
        "Notification" in window &&
        Notification.permission === "denied"
    ) {
        button.textContent =
            "Notifications Blocked";

        status.textContent =
            "Allow notifications in your browser settings.";

        return;
    }

    if (!supportsPushNotifications()) {
        button.disabled = true;

        button.textContent =
            "Notifications Unsupported";

        status.textContent =
            "Try a supported browser or installed PWA.";

        return;
    }

    try {

        const registration =
            serviceWorkerRegistration ||
            await navigator.serviceWorker.ready;

        const subscription =
            await registration.pushManager.getSubscription();

        if (subscription) {

            button.textContent =
                "Refresh Notification Registration";

            status.textContent =
                "This browser already has a push subscription.";

        } else {

            button.textContent =
                "Enable Device Notifications";

            status.textContent =
                "Allow this device to receive EqualLearn updates.";

        }

    } catch (error) {

        console.warn(
            "Push state check failed:",
            error
        );
    }
}

// ============================================
// INITIALIZE
// ============================================

window.addEventListener(
    "load",
    async () => {

        initializeAuth();

        await registerEqualLearnServiceWorker();

        createNotificationButton();

        await updateNotificationButton();
    }
);

// ============================================
// OPTIONAL PUBLIC API
// ============================================

window.EqualLearnPush = {
    register: registerPushSubscription,
    unregister: unregisterPushSubscription
};
