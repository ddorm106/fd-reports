// sw.js - Service Worker for CFD Report
const CACHE_NAME = 'cfd-report-v20260105.1'; // Update this with same version
const ASSETS = [
  './',
  'page1.html',
  'page2.html',
  'page3.html',
  'page4.html',
  'page5.html',
  'page6.html',
  'page7.html',
  'manifest.json',
  'patch.png',
  'city-logo.png',
  'app-icon-192.png',
  'app-icon-512.png'
  // Add any new pages or assets here
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});