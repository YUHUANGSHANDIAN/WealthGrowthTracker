/* Wealth Growth Tracker service worker. It owns only versioned app-shell caches. */
const CACHE_PREFIX = 'wealth-growth-tracker-shell-';
const CACHE = `${CACHE_PREFIX}v1.8.0`;
const OWNED = (name) => name.startsWith(CACHE_PREFIX);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/','/index.html','/manifest.webmanifest'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => OWNED(key) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html'))));
    return;
  }
  if (!['script','style','image','font','manifest'].includes(req.destination)) return;
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req).then((res) => {
    if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
    return res;
  })));
});
