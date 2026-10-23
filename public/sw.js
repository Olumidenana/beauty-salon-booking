// Minimal Service Worker for PWA Installability
const CACHE_NAME = 'maison-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Let network requests pass through smoothly
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
