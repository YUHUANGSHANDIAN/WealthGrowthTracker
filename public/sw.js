/* 财富成长记 Service Worker —— 仅缓存应用外壳（静态资源），不缓存任何用户资产数据。
 * 用户业务数据存放于 localStorage / IndexedDB，不经过 HTTP，因此不会进入 Cache Storage。 */
const CACHE = 'wealth-growth-tracker-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 导航请求：缓存优先，回退网络（离线 shell）
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // 静态资源：缓存优先，网络回填
  const STATIC = ['script', 'style', 'image', 'font', 'manifest'];
  if (STATIC.includes(req.destination)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
