// sw.js - Service Worker for CFD Report PWA
const CACHE_NAME = 'cfd-report-v20260207.1';

const ASSETS = [
  '/',
  'page1.html',
  'page2.html',
  'page3.html',
  'page4.html',
  'page5.html',
  'page6.html',
  'page7.html',
  'manifest.json',
  'styles.css',
  'script.js',
  'patch.png',
  'city-logo.png',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/icon-maskable-192x192.png',
  'icons/icon-maskable-512x512.png'
];

// Install event - cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching assets');
        return cache.addAll(ASSETS);
      })
      .catch(err => console.error('Cache addAll failed:', err))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first for API, cache first for assets
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) return cachedResponse;

        return fetch(event.request)
          .then(networkResponse => {
            if (event.request.url.includes(location.origin) &&
                !event.request.url.includes('jspdf') &&
                !event.request.url.includes('signature_pad')) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
          })
          .catch(() => {});
      })
  );
});
