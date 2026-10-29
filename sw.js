const CACHE_NAME = 'lfia-quant-cache-v15';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first: always load fresh code, fallback to cache offline
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
