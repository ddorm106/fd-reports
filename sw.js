// sw.js - Service Worker for Centerville FD Reports & Training
// Version: 1.14 (keep this line and CACHE_NAME below in step) — 1.14: boot drawings on the
// gear inspection (outside/front/heel/sole); tile detail moved to chips so iOS Safari stops
// opening pages in Reader. 1.13: Sgt. Talley removed
// from every roster and officer list; Truck 1 is a 75 ft aerial with a 1500 GPM pump. The
// bump matters: the report pages have no ?v= of their own, so only a new cache name makes
// an installed phone refetch them. 1.12: gear inspection v2
// (placed damage marks, helmet/hood/gloves), no automatic signatures, date boxes stop
// overlapping on iPhone/iPad, Equipment & Book Checkout, Repair Request, Training
// Request, Aerial Operator monthly evaluation. 1.8: one login; Career Portal on top.

// Cache name - change version number to force update
const CACHE_NAME = 'centerville-fd-v1.14';

// Files to cache for offline use
const FILES_TO_CACHE = [
    '/',                        // Main page
    '/index.html',
    '/patch.png',
    '/city-logo.png',
    '/firefighter-report/page1.html',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
    'https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js'
];

// Install event - cache all essential files
self.addEventListener('install', (event) => {
    console.log('[SW] Install', CACHE_NAME);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching app files');
                return cache.addAll(FILES_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate', CACHE_NAME);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
    // Only cache GET requests (ignore POST, etc.)
    if (event.request.method !== 'GET') return;

    // NEVER cache API calls — always go to network
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // Return cached version if available
                if (cachedResponse) {
                    return cachedResponse;
                }

                // Otherwise fetch from network
                return fetch(event.request)
                    .then((networkResponse) => {
                        // Cache new files for next time (except large files)
                        if (networkResponse && networkResponse.status === 200) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Optional: show offline fallback page
                        if (event.request.destination === 'document') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});
