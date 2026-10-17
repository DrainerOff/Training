// Service worker: the whole app shell is precached, so the app starts with no network
// (airplane mode, after a full close). Data never goes through here — it lives in
// IndexedDB and syncs to Google directly; this worker never opens IndexedDB. BUILD is
// replaced with the commit hash on deploy, which makes every release a new cache.

const BUILD = '__BUILD__';
const CACHE = `trainer-${BUILD}`;
const SHELL = [
  './',
  './index.html',
  './boot.js',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/vendor/preact-htm.js',
  './js/lib/util.js',
  './js/lib/program.js',
  './js/lib/planner.js',
  './js/lib/plateau.js',
  './js/lib/records.js',
  './js/lib/textimport.js',
  './js/data/db.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/data/gsheets-snapshot.js',
  './js/data/legacy-import.js',
  './js/ui/core.js',
  './js/ui/derive.js',
  './js/ui/describe.js',
  './js/ui/app.js',
  './js/ui/home.js',
  './js/ui/workout.js',
  './js/ui/progress.js',
  './js/ui/records.js',
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

// Downloads bypass the HTTP cache so a release never mixes old and new files.
const fresh = (u) => new Request(u, { cache: 'reload' });

// Copies are stored with `Cache-Control: no-cache`. GitHub Pages sends max-age=600, and with
// that header the browser's in-memory cache reuses a module for up to 10 minutes without
// asking this worker — so after an update or a repair the same tab could still run files of
// the previous release mixed with the new ones. With no-cache every load asks the worker.
function revalidating(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// All files or nothing: every download has to succeed before anything is stored.
async function downloadShell(cache) {
  const files = await Promise.all(
    SHELL.map(async (u) => {
      const res = await fetch(fresh(u));
      if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
      return [u, res];
    }),
  );
  await Promise.all(files.map(([u, res]) => cache.put(u, revalidating(res))));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await downloadShell(await caches.open(CACHE));
      // A page of this generation hands over (the 'skip-waiting' message) once all of its
      // code has loaded, so no page mixes files of two releases. Releases whose pages may
      // never finish loading can't send it, so they are replaced right away.
      if (await previousReleaseCantHandOver()) await self.skipWaiting();
    })(),
  );
});

// ea0febc: no boot.js, hangs on «Загрузка…» when IndexedDB stalls.
// 7705635: js/lib/analytics.js, which Safari content blockers refuse (EasyPrivacy).
async function previousReleaseCantHandOver() {
  for (const key of await caches.keys()) {
    if (key === CACHE || !key.startsWith('trainer-')) continue;
    const old = await caches.open(key);
    if (!(await old.match('./boot.js')) || (await old.match('./js/lib/analytics.js'))) return true;
  }
  return false;
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('trainer-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  const reply = (message) => event.ports?.[0]?.postMessage(message);
  if (type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting());
  } else if (type === 'version') {
    reply({ build: BUILD, cache: CACHE });
  } else if (type === 'refresh-cache') {
    // Boot recovery (boot.js): download every app file again. A failed download (offline)
    // leaves the current copy in place.
    event.waitUntil(
      caches
        .open(CACHE)
        .then(downloadShell)
        .then(
          () => reply({ ok: true, build: BUILD }),
          (err) => reply({ ok: false, build: BUILD, error: String(err?.message || err) }),
        ),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Apps Script API: straight to the network
  if (url.pathname.endsWith('/sw.js')) return; // update checks and boot.js network probes
  event.respondWith(respond(req));
});

async function respond(req) {
  let cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return fetch(req);
  }
  if (req.mode === 'navigate') {
    // App shell first: instant start, works offline.
    return (await cache.match('./index.html').catch(() => null)) || fetch(req);
  }
  const hit = await cache.match(req, { ignoreSearch: true }).catch(() => null);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, revalidating(res.clone())).catch(() => {});
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}
