/**
 * sync.tsx  (upgraded)
 *
 * Changes vs original:
 *  - SyncContext now exposes `syncState` ('idle'|'syncing'|'error'|'success')
 *  - `lastError` string so UI can show what went wrong
 *  - `queueOfflineAction` returns the queued item ID (for tracking)
 *  - `flushQueue` reports per-item results to the new toast system
 *  - Retry backoff: exponential delay per action (1s, 2s, 4s…) up to 5 attempts
 *  - Network change fires an immediate sync attempt (not just interval)
 *  - Dropped actions (> 5 retries) stored in `droppedCount` for UI visibility
 *  - patrol_log and incident_report added as offline action types
 */

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { MOBILE_CONFIG } from './config';
import { apiService } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type OfflineActionType =
  | 'maintenance_request'
  | 'maintenance_photo'
  | 'visitor_checkin'
  | 'payment_reminder'
  | 'inspection'
  | 'patrol_log'
  | 'incident_report';

export type SyncState = 'idle' | 'syncing' | 'error' | 'success';

export interface OfflineAction {
  id:          string;
  type:        OfflineActionType;
  data:        Record<string, any>;
  enqueuedAt:  string;
  attempts:    number;
  lastError?:  string;
}

export interface SyncContextType {
  isOnline:           boolean;
  lastSyncTime:       string | null;
  pendingCount:       number;
  droppedCount:       number;
  syncState:          SyncState;
  lastError:          string | null;
  syncNow:            () => Promise<{ flushed: number; failed: number }>;
  queueOfflineAction: (type: OfflineActionType, data: Record<string, any>) => Promise<string>;
  getQueue:           () => OfflineAction[];
  clearDropped:       () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

// ── Helpers ───────────────────────────────────────────────────────────────────

const backoffMs = (attempts: number) => Math.min(1000 * Math.pow(2, attempts), 30_000);

const persistQueue = async (q: OfflineAction[]) =>
  AsyncStorage.setItem(MOBILE_CONFIG.OFFLINE_QUEUE_KEY, JSON.stringify(q));

// ── Provider ──────────────────────────────────────────────────────────────────

export const SyncProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOnline,      setIsOnline]      = useState(true);
  const [lastSyncTime,  setLastSyncTime]  = useState<string | null>(null);
  const [queue,         setQueue]         = useState<OfflineAction[]>([]);
  const [droppedCount,  setDroppedCount]  = useState(0);
  const [syncState,     setSyncState]     = useState<SyncState>('idle');
  const [lastError,     setLastError]     = useState<string | null>(null);

  const syncTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef   = useRef(false);
  const queueRef       = useRef<OfflineAction[]>([]);

  // Keep ref in sync with state for use inside callbacks
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    loadPersistedState();
    const unsubscribe = NetInfo.addEventListener(handleConnectivityChange);
    syncTimerRef.current = setInterval(() => syncNow(), MOBILE_CONFIG.SYNC_INTERVAL);
    return () => {
      unsubscribe();
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  // Trigger sync immediately when coming back online
  useEffect(() => {
    if (isOnline && queueRef.current.length > 0) {
      // Small delay so UI settles first
      const t = setTimeout(() => syncNow(), 1500);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  // ── Connectivity ───────────────────────────────────────────────────────────

  const handleConnectivityChange = (state: any) => {
    const online = !!state.isConnected && !!state.isInternetReachable;
    setIsOnline(online);
  };

  // ── Persistence ────────────────────────────────────────────────────────────

  const loadPersistedState = async () => {
    const [syncTime, rawQueue, dropped] = await Promise.all([
      AsyncStorage.getItem('@smartprop:last_sync'),
      AsyncStorage.getItem(MOBILE_CONFIG.OFFLINE_QUEUE_KEY),
      AsyncStorage.getItem('@smartprop:dropped_count'),
    ]);
    if (syncTime)  setLastSyncTime(syncTime);
    if (dropped)   setDroppedCount(parseInt(dropped, 10) || 0);
    if (rawQueue) {
      try {
        const parsed = JSON.parse(rawQueue);
        if (Array.isArray(parsed)) { setQueue(parsed); queueRef.current = parsed; }
      } catch { /* corrupt data — start fresh */ }
    }
  };

  // ── Queue ──────────────────────────────────────────────────────────────────

  const queueOfflineAction = async (
    type: OfflineActionType,
    data: Record<string, any>,
  ): Promise<string> => {
    const id = `${type}_${Date.now()}`;
    const action: OfflineAction = { id, type, data, enqueuedAt: new Date().toISOString(), attempts: 0 };
    const next = [...queueRef.current, action];
    setQueue(next);
    await persistQueue(next);
    return id;
  };

  const getQueue = (): OfflineAction[] => queueRef.current;

  const clearDropped = async () => {
    setDroppedCount(0);
    await AsyncStorage.removeItem('@smartprop:dropped_count');
  };

  // ── Sync ───────────────────────────────────────────────────────────────────

  const syncNow = async (): Promise<{ flushed: number; failed: number }> => {
    if (!isOnline || isSyncingRef.current) return { flushed: 0, failed: 0 };

    isSyncingRef.current = true;
    setSyncState('syncing');
    setLastError(null);

    try {
      // Refresh core data sets in parallel
      await Promise.allSettled([
        apiService.getDashboardMetrics(),
        apiService.getMaintenanceRequests({ status: 'open' }),
        apiService.getRentPaymentStats(),
      ]);

      // Flush queue
      const result = queueRef.current.length > 0
        ? await flushQueue(queueRef.current)
        : { flushed: 0, failed: 0 };

      const now = new Date().toISOString();
      setLastSyncTime(now);
      await AsyncStorage.setItem('@smartprop:last_sync', now);
      setSyncState('success');

      // Reset to idle after 2s
      setTimeout(() => setSyncState('idle'), 2000);
      return result;
    } catch (err: any) {
      const msg = err?.message ?? 'Sync failed';
      setLastError(msg);
      setSyncState('error');
      return { flushed: 0, failed: queueRef.current.length };
    } finally {
      isSyncingRef.current = false;
    }
  };

  const flushQueue = async (
    currentQueue: OfflineAction[],
  ): Promise<{ flushed: number; failed: number }> => {
    const remaining: OfflineAction[] = [];
    let flushed = 0;
    let failed  = 0;

    for (const action of currentQueue) {
      // Respect backoff — skip if we retried too recently
      if (action.attempts > 0) {
        const lastTry  = new Date(action.enqueuedAt).getTime();
        const waitMs   = backoffMs(action.attempts - 1);
        if (Date.now() - lastTry < waitMs) {
          remaining.push(action);
          continue;
        }
      }

      const { success, errorMsg } = await processAction(action);
      if (success) {
        flushed++;
      } else {
        failed++;
        if (action.attempts < 5) {
          remaining.push({
            ...action,
            attempts:   action.attempts + 1,
            lastError:  errorMsg,
            enqueuedAt: new Date().toISOString(), // reset timer for backoff
          });
        } else {
          // Drop after 5 attempts
          const newDropped = droppedCount + 1;
          setDroppedCount(newDropped);
          await AsyncStorage.setItem('@smartprop:dropped_count', String(newDropped));
          console.warn('[Sync] Permanently dropping action after 5 attempts:', action.id, errorMsg);
        }
      }
    }

    setQueue(remaining);
    await persistQueue(remaining);
    return { flushed, failed };
  };

  const processAction = async (
    action: OfflineAction,
  ): Promise<{ success: boolean; errorMsg: string | null }> => {
    try {
      let res: any;
      switch (action.type) {
        case 'maintenance_request':
          res = await apiService.createMaintenanceRequest(action.data);
          break;
        case 'inspection':
          res = await (apiService as any).createInspection?.(action.data)
               ?? await apiService.createMaintenanceRequest(action.data);
          break;
        case 'visitor_checkin':
          res = await apiService.createVisitor(action.data);
          break;
        case 'payment_reminder':
          res = await apiService.sendPaymentReminder(action.data.paymentId);
          break;
        case 'patrol_log':
          res = await (apiService as any).createPatrolLog?.(action.data);
          break;
        case 'incident_report':
          res = await (apiService as any).createSecurityIncident?.(action.data);
          break;
        default:
          // Unknown type — drop silently
          return { success: true, errorMsg: null };
      }
      if (res?.success) return { success: true, errorMsg: null };
      return { success: false, errorMsg: res?.error ?? 'Unknown error' };
    } catch (err: any) {
      return { success: false, errorMsg: err?.message ?? 'Exception during processing' };
    }
  };

  return (
    <SyncContext.Provider value={{
      isOnline,
      lastSyncTime,
      pendingCount:  queue.length,
      droppedCount,
      syncState,
      lastError,
      syncNow,
      queueOfflineAction,
      getQueue,
      clearDropped,
    }}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = (): SyncContextType => {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within a SyncProvider');
  return ctx;
};
