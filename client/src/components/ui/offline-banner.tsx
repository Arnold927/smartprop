/**
 * OfflineBanner — sticky status strip for field staff
 *
 * Shows when:
 *   - Device is offline (red — work is being queued)
 *   - Device is online but there are pending items (yellow — syncing)
 *
 * Pending count comes from IndexedDB via offlineQueue.subscribe(),
 * updated in real time by SW postMessage events.
 */

import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { offlineQueue } from '@/utils/offlineQueue';
import { WifiOff, RefreshCw, CloudOff, CloudUpload } from 'lucide-react';

export function OfflineBanner() {
  const { isOnline, connectionType, pendingCount } = useNetworkStatus();
  const [isFlushing, setIsFlushing] = useState(false);
  const [localCount, setLocalCount] = useState(pendingCount);

  // Keep localCount in sync with subscription
  useEffect(() => {
    const unsub = offlineQueue.subscribe(setLocalCount);
    return unsub;
  }, []);

  // Sync pendingCount prop changes too
  useEffect(() => { setLocalCount(pendingCount); }, [pendingCount]);

  const handleSyncNow = async () => {
    if (!isOnline || isFlushing) return;
    setIsFlushing(true);
    try {
      await offlineQueue.flush();
    } finally {
      setIsFlushing(false);
    }
  };

  // Nothing to show
  if (isOnline && localCount === 0) return null;

  const isOffline = !isOnline;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 lg:ml-64" role="status" aria-live="polite">
      <Alert className={`rounded-none border-x-0 border-t-0 py-2 ${
        isOffline
          ? 'bg-red-50 border-red-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center justify-between w-full px-1">
          <div className="flex items-center gap-2">
            {isOffline
              ? <CloudOff  className="w-4 h-4 text-red-600 shrink-0" />
              : <CloudUpload className="w-4 h-4 text-amber-600 shrink-0" />
            }

            <AlertDescription className="text-sm">
              {isOffline ? (
                <span className="text-red-800 font-medium">
                  Offline — your work is saved and will sync automatically.
                  {localCount > 0 && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      {localCount} queued
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="text-amber-800">
                  Back online — syncing {localCount} saved action{localCount !== 1 ? 's' : ''}…
                  {connectionType !== 'unknown' && connectionType && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {connectionType.toUpperCase()}
                    </Badge>
                  )}
                </span>
              )}
            </AlertDescription>
          </div>

          {isOnline && localCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncNow}
              disabled={isFlushing}
              className="h-7 text-xs ml-2 shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              {isFlushing
                ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Syncing…</>
                : <><RefreshCw className="w-3 h-3 mr-1" />Sync now</>
              }
            </Button>
          )}
        </div>
      </Alert>
    </div>
  );
}
