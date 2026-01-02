// Minimal service worker for PWA "installable" feel
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // Optional: cache strategy (can be empty for now)
});
