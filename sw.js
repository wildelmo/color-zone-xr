/*
 * Retires the offline service worker that an earlier app (Color Zone XR)
 * installed at this address. Browsers re-check this file when the site is
 * visited; this version deletes the old caches and unregisters itself, so
 * the site is served straight from the network again.
 * The Curio Cabinet does not use a service worker.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
    })(),
  );
});
