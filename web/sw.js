// 离线缓存：先给出缓存里的外壳，再后台更新。

const CACHE = 'dusk-v49';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/editor.js',
  './js/list.js',
  './js/model.js',
  './js/review.js',
  './js/read.js',
  './js/crypto.js',
  './js/lock.js',
  './js/auth.js',
  './js/sync.js',
  './js/zip.js',
  './js/longimage.js',
  './js/exif.js',
  './js/auth.js',
  './js/sync.js',
  './js/exif.js',
  './js/settings.js',
  './js/util.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 先联网拿最新的，断网时退回缓存（这样改代码不用手动清缓存）
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
