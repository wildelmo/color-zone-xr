/* Color Zone XR service worker: cache the whole app so it launches offline
   (the Quest browser lets you install it like an app). Bump VERSION when
   shipping changes so old caches are dropped. */
const VERSION = 'czx-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './vendor/three/three.module.min.js',
  './vendor/three/three.core.min.js',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './src/main.js',
  './src/App.js',
  './src/config.js',
  './src/util/random.js',
  './src/util/noise.js',
  './src/util/math.js',
  './src/util/events.js',
  './src/util/PropMaterial.js',
  './src/world/World.js',
  './src/world/WorldMaterial.js',
  './src/world/Sky.js',
  './src/world/Terrain.js',
  './src/world/Flora.js',
  './src/world/Clouds.js',
  './src/world/Pond.js',
  './src/world/Rainbow.js',
  './src/paint/PaintMap.js',
  './src/paint/StampRenderer.js',
  './src/world/ShadowMap.js',
  './src/world/Props.js',
  './src/util/BlobShadow.js',
  './src/util/Warmup.js',
  './src/systems/Intro.js',
  './src/paint/Stroke.js',
  './src/paint/StrokeMaterial.js',
  './src/paint/StampLayer.js',
  './src/paint/Paint.js',
  './src/paint/Brush.js',
  './src/paint/Palette.js',
  './src/paint/Wand.js',
  './src/fx/Particles.js',
  './src/fx/FX.js',
  './src/fx/Bubbles.js',
  './src/fx/Splats.js',
  './src/audio/Audio.js',
  './src/input/HandState.js',
  './src/input/XRInput.js',
  './src/input/DesktopInput.js',
  './src/input/Controls.js',
  './src/input/Locomotion.js',
  './src/input/HandVisual.js',
  './src/creatures/Buddy.js',
  './src/creatures/Butterflies.js',
  './src/creatures/Riders.js',
  './src/audio/RiderSounds.js',
  './src/systems/Milestones.js',
  './src/systems/SaveGame.js',
  './src/ui/Text.js',
  './src/ui/Toast.js',
  './src/ui/Menu.js',
  './src/ui/HelpSign.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS).catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// network-first for the app shell so updates arrive quickly, cache fallback for offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html')))
  );
});
