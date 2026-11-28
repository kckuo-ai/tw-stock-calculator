// Service Worker：提供離線 App Shell 與最近收盤資料快取
const CACHE_NAME = 'tw-stock-calc-v33';
const APP_SHELL = [
  './',
  './index.html',
  './calc.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 版本檢查請求不經由快取，確保能偵測到伺服器新版
  if (url.searchParams.has('_v')) return;

  // 靜態資源與收盤資料採 Network-First，離線時自動回退到快取
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          const cacheKey = url.pathname.endsWith('/data/quotes.json') ? './data/quotes.json' : req;
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        if (url.pathname.endsWith('/data/quotes.json')) {
          return (await cache.match('./data/quotes.json')) || Response.error();
        }
        if (req.mode === 'navigate') {
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      })
  );
});
