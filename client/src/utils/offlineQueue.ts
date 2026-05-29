/**
 * offlineQueue — IndexedDB-backed offline mutation queue
 *
 * This module is the app-side counterpart to the service worker queue.
 * It stores pending mutations in IndexedDB (not localStorage) so they
 * survive tab closes, low-memory kills, and page refreshes on mobile.
 *
 * The SW is the primary replay engine (Background Sync).
 * This module adds:
 *   - App-side visibility of the queue (count, items)
 *   - Manual flush via postMessage to SW (for browsers without Background Sync)
 *   - Hook-friendly reactive interface via callbacks
 */

const DB_NAME    = 'smartprop-offline';
const DB_VERSION = 1;
const STORE_NAME = 'sync-queue';
const SYNC_TAG   = 'smartprop-sync';

export interface QueuedRequest {
  id?:       number;
  method:    string;
  url:       string;
  headers:   Record<string, string>;
  body:      string;
  timestamp: number;
  retries:   number;
  tag:       string;
  /** Human-readable label for display in the offline banner */
  label?:    string;
}

// ── DB helpers ─────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('tag', 'tag');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<QueuedRequest[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.index('timestamp').getAll() as IDBRequest<QueuedRequest[]>;
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbAdd(record: Omit<QueuedRequest, 'id'>): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(record) as IDBRequest<number>;
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Change listeners (for UI reactivity without React state) ───────────────

type ChangeListener = (count: number) => void;
const listeners: Set<ChangeListener> = new Set();

function notifyListeners(count: number) {
  listeners.forEach(fn => fn(count));
}

// ── Public API ─────────────────────────────────────────────────────────────

class OfflineQueue {
  /** Subscribe to queue-count changes. Returns unsubscribe fn. */
  subscribe(fn: ChangeListener): () => void {
    listeners.add(fn);
    // Immediately emit current count
    idbCount().then(count => fn(count)).catch(() => fn(0));
    return () => listeners.delete(fn);
  }

  /** Add a request to the queue and register Background Sync. */
  async enqueue(opts: {
    url:     string;
    method:  string;
    headers: Record<string, string>;
    body:    unknown;
    label?:  string;
  }): Promise<number> {
    const id = await idbAdd({
      method:    opts.method,
      url:       opts.url,
      headers:   opts.headers,
      body:      typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
      timestamp: Date.now(),
      retries:   0,
      tag:       SYNC_TAG,
      label:     opts.label,
    });

    const count = await idbCount();
    notifyListeners(count);

    // Hint SW to register Background Sync
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FLUSH_QUEUE' });
    }

    return id;
  }

  /** Remove a specific item (e.g. after a successful manual retry). */
  async remove(id: number): Promise<void> {
    await idbDelete(id);
    const count = await idbCount();
    notifyListeners(count);
  }

  /** Get all pending items for display. */
  async getAll(): Promise<QueuedRequest[]> {
    return idbGetAll();
  }

  /** Get the current queue size. */
  async count(): Promise<number> {
    return idbCount();
  }

  /**
   * Flush the queue manually (for browsers that don't support Background Sync,
   * e.g. Firefox, Safari < 16).  Call on `window online` event.
   */
  async flush(): Promise<{ synced: number; failed: number }> {
    const items = await idbGetAll();
    if (!items.length) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const headers = { ...item.headers };
        delete (headers as any)['content-length'];

        const res = await fetch(item.url, {
          method:  item.method,
          headers,
          body:    item.body || undefined,
          credentials: 'include',
        });

        if (res.ok || (res.status >= 200 && res.status < 300)) {
          if (item.id != null) await idbDelete(item.id);
          synced++;
        } else if (res.status >= 400 && res.status < 500) {
          if (item.id != null) await idbDelete(item.id);
          failed++;
        }
        // Server errors: leave in queue for next attempt
      } catch {
        // Network still unavailable — stop
        break;
      }
    }

    const count = await idbCount();
    notifyListeners(count);
    return { synced, failed };
  }

  // ── Legacy localStorage API (backward compat with existing code) ─────────

  /**
   * @deprecated Use enqueue() instead. Kept for backward compat with
   * existing useOfflineMutation calls that call offlineQueue.addRequest().
   */
  addRequest(url: string, method = 'GET', data?: unknown, label?: string): string {
    const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const token  = localStorage.getItem('access_token') ?? '';

    this.enqueue({
      url,
      method:  method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body:  data ?? '',
      label: label ?? `${method.toUpperCase()} ${url}`,
    }).catch(err => console.error('[offlineQueue] enqueue failed:', err));

    return tempId;
  }

  /** @deprecated Use flush() instead. */
  async processQueue(): Promise<void> {
    await this.flush();
  }

  /** @deprecated Use count() instead. */
  getQueueInfo() {
    return {
      pendingRequests: 0,   // async — callers should use count()
      isProcessing:   false,
      requests:       [],
    };
  }
}

export const offlineQueue = new OfflineQueue();

// ── Wire SW messages back to listeners ────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const { type, pending } = event.data ?? {};
    if (type === 'QUEUE_UPDATED' && typeof pending === 'number') {
      notifyListeners(pending);
    }
  });
}
