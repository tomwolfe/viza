const CACHE_NAME = 'viza-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  if (url.origin !== location.origin) return;
  
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        
        const responseToCache = networkResponse.clone();
        const contentType = networkResponse.headers.get('content-type') || '';
        
        if (contentType.includes('text/html') || 
            contentType.includes('application/javascript') ||
            contentType.includes('text/css') ||
            contentType.includes('image/')) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        
        return networkResponse;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => {
    return cachedResponse || new Response('Offline', { status: 503 });
  });
  
  return cachedResponse || fetchPromise;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_OFFLINE_READY') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return Promise.all([
          cache.match('/'),
          cache.match('/index.html'),
          cache.match('/manifest.json'),
        ]).then((results) => {
          const allReady = results.every((response) => response !== undefined);
          event.source.postMessage({
            type: 'OFFLINE_READY_STATUS',
            ready: allReady,
            cacheName: CACHE_NAME,
          });
        });
      })
    );
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});