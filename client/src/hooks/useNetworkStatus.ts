import { useState, useEffect, useCallback } from 'react';
import { offlineQueue } from '@/utils/offlineQueue';
import { useToast } from '@/hooks/use-toast';

export function useNetworkStatus() {
  const [isOnline,       setIsOnline]       = useState(navigator.onLine);
  const [connectionType, setConnectionType] = useState<string>('unknown');
  const [pendingCount,   setPendingCount]   = useState(0);
  const { toast } = useToast();

  // Flush queue and show toast when we come back online
  const handleOnline = useCallback(async () => {
    setIsOnline(true);

    const count = await offlineQueue.count();
    if (count === 0) return;

    // Try SW Background Sync first; fall back to manual flush
    const swReady =
      'serviceWorker' in navigator &&
      navigator.serviceWorker.controller;

    if (swReady) {
      // SW will handle it via the sync event — just nudge it
      navigator.serviceWorker.controller!.postMessage({ type: 'FLUSH_QUEUE' });
    } else {
      // Manual flush for browsers without Background Sync (Firefox, old Safari)
      const { synced, failed } = await offlineQueue.flush();
      if (synced > 0) {
        toast({
          title: `${synced} action${synced > 1 ? 's' : ''} synced`,
          description: 'Your offline work has been submitted.',
        });
      }
      if (failed > 0) {
        toast({
          title: `${failed} item${failed > 1 ? 's' : ''} could not sync`,
          description: 'Some offline actions failed — please check and retry.',
          variant: 'destructive',
        });
      }
    }
  }, [toast]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
  }, []);

  useEffect(() => {
    const updateConnectionType = () => {
      const connection =
        (navigator as any).connection ||
        (navigator as any).mozConnection ||
        (navigator as any).webkitConnection;
      if (connection) {
        setConnectionType(connection.effectiveType || connection.type || 'unknown');
      }
    };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    if ((navigator as any).connection) {
      (navigator as any).connection.addEventListener('change', updateConnectionType);
    }

    updateConnectionType();

    // Subscribe to queue-count changes from SW messages or direct enqueues
    const unsub = offlineQueue.subscribe(setPendingCount);

    // Listen for SW SYNC_COMPLETE to show a success toast
    const handleSWMessage = (event: MessageEvent) => {
      const { type, synced } = event.data ?? {};
      if (type === 'SYNC_COMPLETE' && synced > 0) {
        toast({
          title: `${synced} action${synced > 1 ? 's' : ''} synced`,
          description: 'Your offline work has been submitted.',
        });
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      if ((navigator as any).connection) {
        (navigator as any).connection.removeEventListener('change', updateConnectionType);
      }
      unsub();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, [handleOnline, handleOffline, toast]);

  return {
    isOnline,
    connectionType,
    pendingCount,
    isSlowConnection: connectionType === 'slow-2g' || connectionType === '2g',
  };
}
