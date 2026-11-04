
const CACHE = "equallearn-shell-v7";

const CORE = [
    "./",
    "./index.html",
    "./login.html",
    "./register.html",
    "./manifest.webmanifest",

    "./assets/css/equallearn.css",
    "./assets/css/loading-screen.css",

    "./assets/js/icons.js",
    "./assets/js/theme.js",
    "./assets/js/password-toggle.js",
    "./assets/js/loading-screen.js",

    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png"
];

const OFFLINE_PAGE = "./index.html";


// ============================================
// INSTALL
// ============================================

self.addEventListener("install", event => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);

            // Cache files individually.
            // A missing optional file will not cancel installation.
            await Promise.all(
                CORE.map(async path => {
                    try {
                        await cache.add(path);
                    } catch (error) {
                        console.warn(
                            "Cache skipped:",
                            path
                        );
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

    // Only handle same-origin requests.
    if (url.origin !== self.location.origin) return;


    // ========================================
    // PAGE NAVIGATION
    // ========================================

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

                    const offline = await caches.match(OFFLINE_PAGE);

                    if (offline) return offline;

                    return new Response(
                        "EqualLearn is currently offline.",
                        {
                            status: 503,
                            headers: {
                                "Content-Type": "text/plain"
                            }
                        }
                    );
                }
            })()
        );

        return;
    }


    // ========================================
    // STATIC ASSETS AND MANIFEST
    // ========================================

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

        const networkRequest = fetch(request)
            .then(async response => {

                if (response.ok) {
                    const cache = await caches.open(CACHE);

                    await cache.put(
                        request,
                        response.clone()
                    );
                }

                return response;
            });

        // Background refresh.
        // Network failure is expected when offline or server is unavailable.
        event.waitUntil(
            networkRequest.catch(() => undefined)
        );

        event.respondWith(
            (async () => {

                const cached = await caches.match(request);

                // Return cached asset immediately.
                if (cached) return cached;

                // No cached copy: try network.
                try {
                    return await networkRequest;

                } catch (error) {

                    return new Response(
                        "Asset unavailable.",
                        {
                            status: 503,
                            headers: {
                                "Content-Type": "text/plain"
                            }
                        }
                    );
                }
            })()
        );

        return;
    }


    // ========================================
    // OTHER SAME-ORIGIN REQUESTS
    // ========================================

    event.respondWith(
        (async () => {

            try {
                return await fetch(request);

            } catch (error) {

                const cached = await caches.match(request);

                if (cached) return cached;

                return new Response(
                    "Resource unavailable.",
                    {
                        status: 503,
                        statusText: "Service Unavailable",
                        headers: {
                            "Content-Type": "text/plain"
                        }
                    }
                );
            }
        })()
    );
});
