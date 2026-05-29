/**
 * SmartProp Service Worker — v3
 *
 * KEY BEHAVIOURS FOR FIELD STAFF (guards, caretakers) on Nairobi 3G/4G:
 *
 *  1. App-shell cache-first — the React app loads instantly even with no signal.
 *  2. POST/PATCH/PUT/DELETE requests are queued in IndexedDB when offline
 *     and replayed automatically when connectivity returns (Background Sync).
 *  3. GET /api/* requests fall back to a cached response when offline so
 *     caretakers can still view their work-order list during a signal drop.
 *  4. Navigation requests (HTML) fall back to the cached shell → the SPA
 *     renders from its cached JS/CSS → no blank screen.
 *
 * Queue replay order:
 *   Background Sync fires first (browser-managed).
 *   If the browser doesn't support Background Sync, the SW also replays on
 *   every `fetch` event when the SW detects it can reach the origin.
 *
 * IndexedDB schema:
 *   DB:  smartprop-offline   version: 1
 *   Store: sync-queue        keyPath: id (autoIncrement)
 *     Fields: method, url, headers, body, timestamp, retries, tag
 */

const CACHE_SHELL   = 'smartprop-shell-v3';
const CACHE_API     = 'smartprop-api-v3';
const OFFLINE_URL   = '/offline.html';
const SYNC_TAG      = 'smartprop-sync';
const DB_NAME       = 'smartprop-offline';
const DB_VERSION    = 1;
const STORE_NAME    = 'sync-queue';
const MAX_RETRIES   = 5;
const API_CACHE_MAX = 50; // max cached GET /api responses

// Endpoints queued when offline — guards & caretakers critical paths
const QUEUE_PATTERNS = [
  /^\/api\/guest-checkin\//,
  /^\/api\/maintenance-requests/,
  /^\/api\/maintenance-actions/,
  /^\/api\/gate-pins/,
  /^\/api\/visitor-access/,
  /^\/api\/guard-features/,
  /^\/api\/inspections/,
  /^\/api\/time-tracking/,
];

// Static app-shell assets pre-cached on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('tag', 'tag');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.index('timestamp').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbAdd(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbUpdate(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function dbCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Notify all open tabs of queue state ───────────────────────────────────

async function notifyClients(type, payload = {}) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type, ...payload }));
}

// ── Install ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_SHELL && k !== CACHE_API)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!request.url.startsWith('http')) return;

  const url    = new URL(request.url);
  const isAPI  = url.pathname.startsWith('/api/');
  const isGet  = request.method === 'GET';

  // ── Mutating requests (POST / PATCH / PUT / DELETE) ─────────────────────
  if (!isGet && isAPI) {
    // Check if this endpoint is in the queue-worthy set
    const shouldQueue = QUEUE_PATTERNS.some(p => p.test(url.pathname));
    if (!shouldQueue) return; // let it pass through normally

    event.respondWith(
      fetch(request.clone()).catch(async () => {
        // Network failed → queue the request
        try {
          const body    = await request.text();
          const headers = {};
          request.headers.forEach((val, key) => { headers[key] = val; });

          await dbAdd({
            method:    request.method,
            url:       request.url,
            headers,
            body,
            timestamp: Date.now(),
            retries:   0,
            tag:       SYNC_TAG,
          });

          // Register background sync (if supported)
          if (self.registration.sync) {
            await self.registration.sync.register(SYNC_TAG);
          }

          const count = await dbCount();
          await notifyClients('QUEUE_UPDATED', { pending: count });

          // Return an optimistic 202 so the app doesn't error
          return new Response(
            JSON.stringify({ queued: true, offline: true, message: 'Saved offline — will sync when connected' }),
            { status: 202, headers: { 'Content-Type': 'application/json', 'X-Offline-Queued': '1' } }
          );
        } catch (err) {
          console.error('[SW] Failed to queue request:', err);
          return new Response(
            JSON.stringify({ error: 'Offline and failed to queue', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
      })
    );
    return;
  }

  // ── GET /api/* — network-first, cache fallback ──────────────────────────
  if (isGet && isAPI) {
    event.respondWith(
      fetch(request.clone())
        .then(async response => {
          if (response.ok) {
            // Cache successful GET responses for offline viewing
            const cache = await caches.open(CACHE_API);
            await trimCache(cache, API_CACHE_MAX);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: 'Offline', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // ── Static assets (JS, CSS, images, fonts) — cache-first ────────────────
  if (
    request.destination === 'script'  ||
    request.destination === 'style'   ||
    request.destination === 'image'   ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_SHELL).then(c => c.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Navigation (HTML) — network-first, cached shell fallback ────────────
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_SHELL).then(c => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() =>
        caches.match(request)
          .then(cached => cached || caches.match('/index.html') || caches.match(OFFLINE_URL))
      )
  );
});

// ── Background Sync ────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueue());
  }
});

// ── Message from app (manual flush trigger) ────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'FLUSH_QUEUE') {
    replayQueue();
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Queue replay ───────────────────────────────────────────────────────────

async function replayQueue() {
  let items;
  try { items = await dbGetAll(); } catch { return; }
  if (!items.length) return;

  console.log(`[SW] Replaying ${items.length} queued request(s)`);

  let successCount = 0;
  let failCount    = 0;

  for (const item of items) {
    try {
      const headers = { ...item.headers };
      // Strip headers the browser will re-add; avoid CORS issues
      delete headers['content-length'];

      const response = await fetch(item.url, {
        method:  item.method,
        headers,
        body:    item.body || undefined,
        credentials: 'include',
      });

      if (response.ok || (response.status >= 200 && response.status < 300)) {
        await dbDelete(item.id);
        successCount++;
      } else if (response.status >= 400 && response.status < 500) {
        // Client error (bad data etc.) — discard, will never succeed
        console.warn(`[SW] Discarding queued request (${response.status}):`, item.url);
        await dbDelete(item.id);
        failCount++;
      } else {
        // Server error — increment retry counter
        item.retries = (item.retries || 0) + 1;
        if (item.retries >= MAX_RETRIES) {
          console.error(`[SW] Giving up on queued request after ${MAX_RETRIES} retries:`, item.url);
          await dbDelete(item.id);
          failCount++;
        } else {
          await dbUpdate(item);
        }
      }
    } catch (err) {
      // Network still down — stop processing, leave items in queue
      console.log('[SW] Still offline during replay, stopping');
      break;
    }
  }

  const remaining = await dbCount();
  await notifyClients('QUEUE_UPDATED', { pending: remaining, synced: successCount, failed: failCount });

  if (successCount > 0) {
    await notifyClients('SYNC_COMPLETE', { synced: successCount });
  }
}

// ── Cache size trimmer ─────────────────────────────────────────────────────

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length >= maxEntries) {
    await cache.delete(keys[0]);
  }
}
