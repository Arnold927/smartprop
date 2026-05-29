/**
 * SyncStatusBar.tsx
 *
 * A persistent, animated status strip that communicates the full sync
 * lifecycle to the user:
 *
 *   ● OFFLINE    — amber, "No internet connection. X actions will sync when you reconnect."
 *   ● SYNCING    — blue pulsing, "Syncing X pending items…"
 *   ● SYNC_ERROR — red, "Sync failed. Tap to retry."
 *   ● QUEUED     — indigo, "X unsent items saved on device"
 *   ● ONLINE     — (hidden — no banner when everything is fine)
 *
 * Slides in from top when state changes; auto-hides after 4s for
 * non-persistent states (SYNCING, success).
 *
 * Also exports:
 *   useSyncStatus() — hook that screens call to report sync-specific state
 */

import React, { useEffect, useRef, useState, createContext, useContext, ReactNode } from 'react';
import {
  View, Text, Animated, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useSync } from '../services/sync';
import { C, R } from './DesignSystem';

// ── Sync UI state ─────────────────────────────────────────────────────────────

type SyncUIState = 'hidden' | 'offline' | 'syncing' | 'queued' | 'error' | 'justSynced';

interface SyncBarConfig {
  bg:      string;
  icon:    string;
  color:   string;
  text:    string;
  canTap:  boolean;
  spin:    boolean;
}

// ── Context for screens to push sync state ────────────────────────────────────

interface SyncStatusContextType {
  reportSyncing: () => void;
  reportError:   (msg?: string) => void;
  reportSuccess: () => void;
  clearOverride: () => void;
}

const SyncStatusContext = createContext<SyncStatusContextType | null>(null);

export const useSyncStatus = () => {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) throw new Error('useSyncStatus must be inside SyncStatusProvider');
  return ctx;
};

// ── Provider ──────────────────────────────────────────────────────────────────

export const SyncStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isOnline, pendingCount, lastSyncTime, syncNow } = useSync();
  const [override, setOverride] = useState<SyncUIState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(-44)).current;
  const spinAnim   = useRef(new Animated.Value(0)).current;
  const spinLoop   = useRef<ReturnType<typeof Animated.loop> | null>(null);
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine display state
  const uiState: SyncUIState = override ?? (
    !isOnline         ? 'offline' :
    pendingCount > 0  ? 'queued'  :
    'hidden'
  );

  const CONFIG: Record<SyncUIState, SyncBarConfig | null> = {
    hidden:     null,
    offline:    { bg: '#FEF3C7', icon: 'wifi-off',       color: '#B45309', text: pendingCount > 0 ? `No internet — ${pendingCount} item${pendingCount !== 1 ? 's' : ''} will sync when you reconnect` : 'No internet connection', canTap: false, spin: false },
    syncing:    { bg: C.blueLight, icon: 'sync',          color: C.blueDark, text: pendingCount > 0 ? `Uploading ${pendingCount} queued item${pendingCount !== 1 ? 's' : ''}…` : 'Syncing data…', canTap: false, spin: true },
    queued:     { bg: C.indigoLight, icon: 'cloud-upload', color: '#3730A3', text: `${pendingCount} item${pendingCount !== 1 ? 's' : ''} saved locally — tap to upload now`, canTap: true, spin: false },
    error:      { bg: '#FEF2F2', icon: 'cloud-off',       color: '#991B1B', text: errorMsg ?? 'Sync failed — tap to retry', canTap: true, spin: false },
    justSynced: { bg: C.greenLight, icon: 'cloud-done',   color: C.greenDark, text: `Synced ${lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : 'just now'}`, canTap: false, spin: false },
  };

  const conf = CONFIG[uiState];
  const shouldShow = conf !== null;

  // Animate in/out
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);

    if (shouldShow) {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
      if (uiState === 'justSynced') {
        hideTimer.current = setTimeout(() => {
          Animated.timing(translateY, { toValue: -44, duration: 300, useNativeDriver: true }).start(() => setOverride(null));
        }, 3000);
      }
    } else {
      Animated.timing(translateY, { toValue: -44, duration: 250, useNativeDriver: true }).start();
    }
  }, [uiState, shouldShow]);

  // Spin animation for syncing
  useEffect(() => {
    if (uiState === 'syncing') {
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 800, useNativeDriver: true })
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
    return () => { spinLoop.current?.stop(); };
  }, [uiState]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const handleTap = () => {
    if (uiState === 'queued' || uiState === 'error') {
      setOverride('syncing');
      syncNow().then(() => {
        setOverride('justSynced');
      }).catch(() => {
        setOverride('error');
      });
    }
  };

  const ctx: SyncStatusContextType = {
    reportSyncing: () => setOverride('syncing'),
    reportError:   (msg) => { setErrorMsg(msg ?? null); setOverride('error'); },
    reportSuccess: () => setOverride('justSynced'),
    clearOverride: () => setOverride(null),
  };

  return (
    <SyncStatusContext.Provider value={ctx}>
      {children}
      {conf && (
        <Animated.View
          style={[
            styles.bar,
            { backgroundColor: conf.bg, transform: [{ translateY }] },
          ]}
          pointerEvents={conf.canTap ? 'auto' : 'none'}
        >
          <TouchableOpacity
            style={styles.inner}
            onPress={conf.canTap ? handleTap : undefined}
            activeOpacity={conf.canTap ? 0.7 : 1}
          >
            <Animated.View style={conf.spin ? { transform: [{ rotate: spin }] } : undefined}>
              <Icon name={conf.icon} size={14} color={conf.color} />
            </Animated.View>
            <Text style={[styles.text, { color: conf.color }]} numberOfLines={1}>
              {conf.text}
            </Text>
            {conf.canTap && (
              <Icon name="chevron-right" size={14} color={conf.color} style={{ opacity: 0.6 }} />
            )}
          </TouchableOpacity>
        </Animated.View>
      )}
    </SyncStatusContext.Provider>
  );
};

// ── Inline sync indicator (used within individual screens) ────────────────────

interface InlineSyncProps {
  isLoading:    boolean;
  lastSyncTime: string | null;
  pendingCount: number;
  isOnline:     boolean;
  onSync:       () => void;
}

export const InlineSyncIndicator: React.FC<InlineSyncProps> = ({
  isLoading, lastSyncTime, pendingCount, isOnline, onSync,
}) => {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const loop = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true })
      );
      loop.start();
      return () => loop.stop();
    } else {
      spinAnim.setValue(0);
    }
  }, [isLoading]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const label = isLoading
    ? 'Syncing…'
    : !isOnline
      ? 'Offline'
      : lastSyncTime
        ? `Updated ${new Date(lastSyncTime).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`
        : 'Not synced';

  const dotColor = isLoading ? C.blue : !isOnline ? C.amber : C.green;

  return (
    <TouchableOpacity style={styles.inline} onPress={isOnline ? onSync : undefined} activeOpacity={0.7}>
      <Animated.View style={isLoading ? { transform: [{ rotate: spin }] } : undefined}>
        <Icon name={isLoading ? 'sync' : !isOnline ? 'wifi-off' : 'cloud-done'} size={13} color={dotColor} />
      </Animated.View>
      <Text style={[styles.inlineText, { color: dotColor }]}>{label}</Text>
      {pendingCount > 0 && (
        <View style={[styles.pendingDot, { backgroundColor: C.amber }]}>
          <Text style={styles.pendingDotText}>{pendingCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    position:   'absolute',
    top:        Platform.OS === 'ios' ? 44 : 0,
    left:       0,
    right:      0,
    zIndex:     1000,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  inner: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingHorizontal: 14,
    paddingVertical:   8,
    gap: 6,
  },
  text: {
    flex:       1,
    fontSize:   12,
    fontWeight: '600',
  },
  inline: {
    flexDirection: 'row',
    alignItems:    'center',
    gap: 4,
  },
  inlineText: {
    fontSize:   11,
    fontWeight: '500',
  },
  pendingDot: {
    borderRadius:   8,
    paddingHorizontal: 5,
    paddingVertical:   1,
    marginLeft: 2,
  },
  pendingDotText: {
    fontSize:   9,
    fontWeight: '800',
    color:      'white',
  },
});
