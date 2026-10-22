/*
 * Retires the service worker that the previous app (Color Zone XR) installed
 * at this address. Browsers check this file for updates when the site is
 * visited; this version deletes the old offline caches and unregisters
 * itself, so the site is served straight from the network again.
 * Sea Train does not use a service worker.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
  })());
});
