// Smart Prop Service Worker for PWA functionality
const CACHE_NAME = 'smart-prop-v1';
const urlsToCache = ['/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// CRITICAL: Skip ALL Vite dev server requests - never intercept these
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip Vite HMR, dev paths, and localhost entirely
  if (
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@fs') ||
    url.pathname.startsWith('/src') ||
    url.pathname.startsWith('/node_modules') ||
    url.hostname === 'localhost'
  ) {
    return; // Do NOT call event.respondWith() - let browser handle normally
  }

  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => name !== CACHE_NAME && caches.delete(name))
        )
      )
    ])
  );
});

self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: { dateOfArrival: Date.now(), primaryKey: 1 },
    actions: [
      { action: 'explore', title: 'View Details', icon: '/icon-192x192.png' },
      { action: 'close', title: 'Close', icon: '/icon-192x192.png' }
    ]
  };
  event.waitUntil(self.registration.showNotification('Smart Prop', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'explore') {
    event.waitUntil(clients.openWindow('/dashboard'));
  }
});