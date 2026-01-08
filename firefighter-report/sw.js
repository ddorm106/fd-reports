// sw.js - Service Worker for CFD Report PWA
const CACHE_NAME = 'cfd-report-v20260105.2'; // ← Match your latest app version

const ASSETS = [
  '/',                     // Root (for offline fallback)
  'page1.html',
  'page2.html',
  'page3.html',
  'page4.html',
  'page5.html',
  'page6.html',
  'page7.html',
  'manifest.json',
  'styles.css',            // Shared styles
  'script.js',             // Shared script
  'patch.png',
  'city-logo.png',
  // PWA Icons (add your actual icon filenames)
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/icon-maskable-192x192.png',
  'icons/icon-maskable-512x512.png'
  // Add any future assets here
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
  self.skipWaiting(); // Force new SW to activate immediately
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
  self.clients.claim(); // Take control of clients immediately
});

// Fetch event - serve from cache first, fallback to network
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Return cached version if available
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Cache new assets (except large/dynamic ones like EmailJS)
            if (event.request.url.includes(location.origin) &&
                !event.request.url.includes('emailjs') &&
                !event.request.url.includes('jspdf') &&
                !event.request.url.includes('signature_pad')) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
          })
          .catch(() => {
            // Optional: return offline fallback page
            // return caches.match('/offline.html');
          });
      })
  );
});
