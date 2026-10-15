// Офлайн-режим: все файлы приложения кешируются при первой загрузке.
// Список файлов и версия обновляются командой `npm run build:sw`.
/* BUILD:START */
const VERSION = '2893083971';
const FILES = [
  "./",
  "./css/fonts.css",
  "./css/style.css",
  "./fonts/inter-cyrillic-400-normal.woff2",
  "./fonts/inter-cyrillic-500-normal.woff2",
  "./fonts/inter-cyrillic-600-normal.woff2",
  "./fonts/inter-cyrillic-700-normal.woff2",
  "./fonts/inter-latin-400-normal.woff2",
  "./fonts/inter-latin-500-normal.woff2",
  "./fonts/inter-latin-600-normal.woff2",
  "./fonts/inter-latin-700-normal.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./index.html",
  "./js/api.js",
  "./js/app.js",
  "./js/lib/clip.js",
  "./js/lib/enrich.js",
  "./js/lib/fuzzy.js",
  "./js/lib/idb.js",
  "./js/lib/leitner.js",
  "./js/lib/parse.js",
  "./js/lib/speech.js",
  "./js/lib/stock.js",
  "./js/lib/study-ui.js",
  "./js/modes/cards.js",
  "./js/modes/match.js",
  "./js/modes/test.js",
  "./js/modes/type.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/views/home.js",
  "./js/views/importer.js",
  "./js/views/launcher.js",
  "./js/views/module.js",
  "./js/views/search.js",
  "./js/views/settings.js",
  "./js/views/stats.js",
  "./js/views/study.js",
  "./js/views/topic.js",
  "./manifest.webmanifest"
];
/* BUILD:END */
const CACHE = `kartochki-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kartochki-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Сначала из кеша (быстро и без интернета), параллельно обновляем кеш из сети.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => undefined);
    return hit || (await net) || new Response('Нет сети, а этого файла нет в кеше', { status: 503 });
  })());
});
