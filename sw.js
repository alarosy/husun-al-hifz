// Service worker: cache-first لملفات التطبيق وخطوط Google ليعمل دون اتصال.
// غيّر VERSION عند كل نشر ليحصل المستخدمون على النسخة الجديدة.

const VERSION = 'v1.0.0';
const APP_CACHE = `husun-app-${VERSION}`;
const FONT_CACHE = 'husun-fonts-v1';
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/engine.js',
  './js/store.js',
  './js/ui.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

async function precacheFonts() {
  // ملف CSS والخطوط التي يشير إليها، حتى يعمل التطبيق دون اتصال من أول زيارة
  try {
    const cache = await caches.open(FONT_CACHE);
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    await Promise.all(
      urls.map(async (u) => {
        if (await cache.match(u)) return;
        const r = await fetch(u, { mode: 'cors' });
        if (r.ok) await cache.put(u, r);
      }),
    );
  } catch {
    // دون اتصال أثناء التثبيت: تُخزَّن الخطوط عند أول طلب لاحق
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
      await precacheFonts();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, FONT_CACHE]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function cacheFirst(request, cacheName, opts) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, opts);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isFont(url)) {
    event.respondWith(cacheFirst(request, FONT_CACHE, { ignoreVary: true }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match('./index.html')) || fetch(request);
      })(),
    );
    return;
  }
  event.respondWith(cacheFirst(request, APP_CACHE, { ignoreSearch: true }));
});
