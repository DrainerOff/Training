// Service worker: the whole app shell is precached, so the app starts with no network
// (airplane mode, after a full close). Data never goes through here — it lives in
// IndexedDB and syncs to Google directly. BUILD is replaced with the commit hash on deploy,
// which makes every release a new cache.

const BUILD = '__BUILD__';
const CACHE = `trainer-${BUILD}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/vendor/preact-htm.js',
  './js/lib/util.js',
  './js/lib/program.js',
  './js/lib/planner.js',
  './js/lib/analytics.js',
  './js/lib/textimport.js',
  './js/data/db.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/ui/core.js',
  './js/ui/derive.js',
  './js/ui/describe.js',
  './js/ui/app.js',
  './js/ui/home.js',
  './js/ui/workout.js',
  './js/ui/progress.js',
  './js/ui/history.js',
  './js/ui/body.js',
  './js/ui/settings.js',
  './fonts/alumni-sans-cyrillic-wght-normal.woff2',
  './fonts/alumni-sans-latin-wght-normal.woff2',
  './fonts/golos-text-cyrillic-wght-normal.woff2',
  './fonts/golos-text-latin-wght-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' bypasses the HTTP cache so a release never mixes old and new files.
      await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('trainer-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Apps Script API: straight to the network
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        // App shell first: instant start, works offline.
        return (await cache.match('./index.html')) || fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })(),
  );
});
