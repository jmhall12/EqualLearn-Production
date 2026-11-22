
const CACHE = "equallearn-shell-v13-single-lumi-evaluation";

const CORE = [
    "./",
    "./index.html",
    "./login.html",
    "./register.html",
    "./manifest.webmanifest",
    "./app.html",
    "./evaluation.html",

    "./assets/css/equallearn.css",
    "./assets/css/loading-screen.css",

    "./assets/js/icons.js",
    "./assets/js/theme.js",
    "./assets/js/password-toggle.js",
    "./assets/js/loading-screen.js",
    "./assets/js/auth.js",
    "./assets/js/firebase-config.js",
    "./assets/js/login.js",
    "./assets/js/evaluation-runtime.js",
    "./assets/js/evaluation-readonly.js",
    "./assets/widgets/lumi.html"
];

const OFFLINE_MESSAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>EqualLearn - Offline</title>
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f5f7fb;
            color: #243047;
            font-family: Arial, sans-serif;
            text-align: center;
        }
        main { padding: 30px; }
        button {
            padding: 12px 22px;
            border: 0;
            border-radius: 8px;
            background: #3157d5;
            color: white;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <main>
        <h2>You're currently offline</h2>
        <p>EqualLearn needs an internet connection to load this page.</p>
        <button onclick="location.reload()">Try again</button>
    </main>
</body>
</html>
`;

// ============================================
// INSTALL
// ============================================

self.addEventListener("install", event => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);

            await Promise.all(
                CORE.map(async path => {
                    try {
                        const response = await fetch(path);

                        if (response.ok) {
                            await cache.put(path, response);
                        }
                    } catch (error) {
                        console.warn("Cache skipped:", path);
                    }
                })
            );

            await self.skipWaiting();
        })()
    );
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener("activate", event => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();

            await Promise.all(
                keys
                    .filter(key =>
                        key.startsWith("equallearn-shell-") &&
                        key !== CACHE
                    )
                    .map(key => caches.delete(key))
            );

            await self.clients.claim();
        })()
    );
});

// ============================================
// FETCH
// ============================================

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    // PAGE NAVIGATION - NETWORK FIRST

    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(request);

                    if (response.ok) {
                        const cache = await caches.open(CACHE);

                        await cache.put(
                            request,
                            response.clone()
                        );
                    }

                    return response;

                } catch (error) {
                    const cached = await caches.match(request);

                    if (cached) return cached;

                    return new Response(OFFLINE_MESSAGE, {
                        status: 503,
                        headers: {
                            "Content-Type": "text/html; charset=utf-8"
                        }
                    });
                }
            })()
        );

        return;
    }

    // STATIC ASSETS - NETWORK FIRST

    const isStaticAsset = [
        "style",
        "script",
        "image",
        "font",
        "manifest"
    ].includes(request.destination);

    const isManifest =
        url.pathname.endsWith("/manifest.webmanifest");

    if (isStaticAsset || isManifest) {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(request);

                    if (response.ok) {
                        const cache = await caches.open(CACHE);

                        await cache.put(
                            request,
                            response.clone()
                        );
                    }

                    return response;

                } catch (error) {
                    const cached = await caches.match(request);

                    if (cached) return cached;

                    return new Response("Asset unavailable.", {
                        status: 503,
                        headers: {
                            "Content-Type": "text/plain"
                        }
                    });
                }
            })()
        );

        return;
    }

    // OTHER SAME-ORIGIN REQUESTS

    event.respondWith(
        (async () => {
            try {
                return await fetch(request);

            } catch (error) {
                const cached = await caches.match(request);

                if (cached) return cached;

                return new Response("Resource unavailable.", {
                    status: 503,
                    headers: {
                        "Content-Type": "text/plain"
                    }
                });
            }
        })()
    );
});

// ============================================
// BACKGROUND PUSH NOTIFICATIONS
// ============================================

self.addEventListener("push", event => {
    event.waitUntil(
        (async () => {
            let payload = {};

            try {
                if (event.data) {
                    payload = event.data.json();
                }
            } catch (error) {
                console.warn(
                    "EqualLearn: Push payload parsing failed.",
                    error
                );

                payload = {
                    title: "EqualLearn",
                    body: event.data?.text() ||
                        "You have a new classroom update."
                };
            }

            const title =
                String(payload.title || "EqualLearn")
                    .slice(0, 100);

            const body =
                String(
                    payload.body ||
                    "You have a new classroom update."
                ).slice(0, 250);

            const targetUrl = getSafeNotificationUrl(
                payload.url
            );

            const options = {
                body,

                tag: String(
                    payload.tag ||
                    payload.notificationId ||
                    "equallearn-update"
                ).slice(0, 100),

                data: {
                    url: targetUrl,
                    notificationId:
                        payload.notificationId || null,
                    contentType:
                        payload.contentType || null,
                    contentId:
                        payload.contentId || null
                },

                timestamp: Date.now(),

                vibrate: [200, 100, 200],

                renotify: true,

                requireInteraction: false
            };

            await self.registration.showNotification(
                title,
                options
            );

            console.info(
                "EqualLearn: Background notification displayed."
            );
        })()
    );
});

// ============================================
// SAFE NOTIFICATION URL
// ============================================

function getSafeNotificationUrl(value) {
    const fallback =
        new URL(
            "/student/dashboard.html",
            self.location.origin
        ).href;

    if (typeof value !== "string" || !value.trim()) {
        return fallback;
    }

    try {
        const parsed = new URL(
            value,
            self.location.origin
        );

        if (parsed.origin !== self.location.origin) {
            return fallback;
        }

        return parsed.href;

    } catch (error) {
        return fallback;
    }
}

// ============================================
// NOTIFICATION CLICK
// ============================================

self.addEventListener("notificationclick", event => {
    event.notification.close();

    event.waitUntil(
        (async () => {
            const targetUrl = getSafeNotificationUrl(
                event.notification.data?.url
            );

            const target = new URL(targetUrl);

            const windowClients =
                await self.clients.matchAll({
                    type: "window",
                    includeUncontrolled: true
                });

            // Reuse an existing EqualLearn window.

            for (const client of windowClients) {
                if (
                    new URL(client.url).origin ===
                    self.location.origin
                ) {
                    try {
                        await client.navigate(target.href);
                        await client.focus();

                        return;
                    } catch (error) {
                        console.warn(
                            "EqualLearn: Existing window navigation failed.",
                            error
                        );
                    }
                }
            }

            // Open a new EqualLearn window if none exists.

            await self.clients.openWindow(target.href);
        })()
    );
});

// ============================================
// NOTIFICATION CLOSED
// ============================================

self.addEventListener("notificationclose", event => {
    console.info(
        "EqualLearn notification dismissed:",
        event.notification.tag
    );
});

console.info(
    "EqualLearn: Offline cache and background push handlers initialized."
);
