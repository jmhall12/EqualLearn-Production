
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {

        const isLocalDevelopment =
            location.hostname === "localhost" ||
            location.hostname === "127.0.0.1";

        // ====================================
        // LOCAL DEVELOPMENT
        // ====================================

        if (isLocalDevelopment) {
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

            return;
        }


        // ====================================
        // PRODUCTION
        // ====================================

        try {
            const swUrl = new URL(
                "/service-worker.js",
                location.origin
            );

            const registration =
                await navigator.serviceWorker.register(swUrl, {
                    scope: "/"
                });

            console.info(
                "EqualLearn Service Worker registered:",
                registration.scope
            );

        } catch (error) {
            console.error(
                "EqualLearn Service Worker registration failed:",
                error
            );
        }
    });
}
