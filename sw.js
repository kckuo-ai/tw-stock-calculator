// 離線快取：網路優先、失敗才用快取；報價 API 一律走網路
const CACHE = 'tw-stock-calc-v15';
const ASSETS = ['./', 'index.html', 'calc.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // 加上時間參數繞過 GitHub Pages CDN 約 10 分鐘的快取，部署後立即拿到新版
  const bust = new URL(url); bust.searchParams.set('_sw', Date.now());
  e.respondWith(
    fetch(bust.href, { cache: 'no-store' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
