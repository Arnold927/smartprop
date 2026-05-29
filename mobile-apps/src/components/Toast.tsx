/**
 * Toast.tsx
 *
 * Non-blocking, auto-dismissing notification banners that slide in from the
 * top. Replaces Alert.alert for success and non-critical error feedback so
 * the user can keep working without dismissing a modal.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved', 'Maintenance request submitted.');
 *   toast.error('Upload failed', 'Check your connection and try again.');
 *   toast.offline('Saved locally', 'Will sync when online.');
 *   toast.info('Syncing…');
 *
 * Wrap your root component with <ToastProvider> (already done in App.tsx update).
 */

import React, {
  createContext, useContext, useState, useRef,
  useCallback, useEffect, ReactNode,
} from 'react';
import {
  View, Text, Animated, TouchableOpacity,
  StyleSheet, Platform, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { C, R, shadow } from './DesignSystem';

const { width: W } = Dimensions.get('window');

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'offline' | 'sync';

interface ToastItem {
  id:       string;
  variant:  ToastVariant;
  title:    string;
  message?: string;
  duration: number;
  action?:  { label: string; onPress: () => void };
}

interface ToastContextType {
  success: (title: string, message?: string, action?: ToastItem['action']) => void;
  error:   (title: string, message?: string, action?: ToastItem['action']) => void;
  warning: (title: string, message?: string) => void;
  info:    (title: string, message?: string) => void;
  offline: (title: string, message?: string) => void;
  sync:    (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// ── Config ────────────────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<ToastVariant, { icon: string; iconColor: string; bg: string; border: string; titleColor: string }> = {
  success: { icon: 'check-circle',   iconColor: C.green,   bg: C.greenLight,   border: '#A7F3D0', titleColor: C.greenDark },
  error:   { icon: 'error',          iconColor: C.red,     bg: '#FEF2F2',      border: '#FECACA', titleColor: '#991B1B' },
  warning: { icon: 'warning',        iconColor: C.amber,   bg: C.amberLight,   border: '#FDE68A', titleColor: C.amberDark },
  info:    { icon: 'info',           iconColor: C.blue,    bg: C.blueLight,    border: '#BFDBFE', titleColor: C.blueDark },
  offline: { icon: 'cloud-upload',   iconColor: C.indigo,  bg: C.indigoLight,  border: '#C7D2FE', titleColor: '#3730A3' },
  sync:    { icon: 'sync',           iconColor: C.blue,    bg: C.blueLight,    border: '#BFDBFE', titleColor: C.blueDark },
};

// ── Single Toast ──────────────────────────────────────────────────────────────

const Toast: React.FC<{
  item:      ToastItem;
  onDismiss: (id: string) => void;
  index:     number;
}> = ({ item, onDismiss, index }) => {
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const conf = VARIANT_CONFIG[item.variant];
  const isSyncVariant = item.variant === 'sync';
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 8 }),
      Animated.timing(opacity,    { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Spin icon for sync variant
    if (isSyncVariant) {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 1000, useNativeDriver: true })
      ).start();
    }

    // Auto-dismiss
    const t = setTimeout(() => dismiss(), item.duration);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -80, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,   duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss(item.id));
  };

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: conf.bg,
          borderColor:     conf.border,
          opacity,
          transform: [{ translateY }],
          top: 12 + index * 72,
        },
        shadow(3) as any,
      ]}
    >
      <Animated.View style={isSyncVariant ? { transform: [{ rotate: spin }] } : undefined}>
        <Icon name={conf.icon} size={20} color={conf.iconColor} />
      </Animated.View>

      <View style={styles.toastBody}>
        <Text style={[styles.toastTitle, { color: conf.titleColor }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.message && (
          <Text style={styles.toastMessage} numberOfLines={2}>{item.message}</Text>
        )}
        {item.action && (
          <TouchableOpacity onPress={() => { item.action!.onPress(); dismiss(); }}>
            <Text style={[styles.toastAction, { color: conf.iconColor }]}>{item.action.label}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Icon name="close" size={16} color={conf.iconColor} style={{ opacity: 0.6 }} />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Provider ──────────────────────────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((
    variant: ToastVariant,
    title: string,
    message?: string,
    duration = 3500,
    action?: ToastItem['action'],
  ) => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => {
      // Cap at 3 visible toasts
      const next = [...prev.slice(-2), { id, variant, title, message, duration, action }];
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const ctx: ToastContextType = {
    success: (t, m, a) => show('success', t, m, 3500, a),
    error:   (t, m, a) => show('error',   t, m, 5000, a),
    warning: (t, m)    => show('warning', t, m, 4000),
    info:    (t, m)    => show('info',    t, m, 3000),
    offline: (t, m)    => show('offline', t, m, 5000),
    sync:    (t, m)    => show('sync',    t, m, 2500),
    dismiss,
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map((item, i) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} index={i} />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useToast = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position:  'absolute',
    top:       Platform.OS === 'ios' ? 52 : 12,
    left:      12,
    right:     12,
    zIndex:    9999,
    pointerEvents: 'box-none',
  } as any,
  toast: {
    position:     'absolute',
    left:         0,
    right:        0,
    flexDirection: 'row',
    alignItems:   'flex-start',
    padding:      14,
    borderRadius: R.xl,
    borderWidth:  1,
    gap:          10,
  },
  toastBody: {
    flex: 1,
  },
  toastTitle: {
    fontSize:   14,
    fontWeight: '700',
    marginBottom: 2,
  },
  toastMessage: {
    fontSize:   12,
    color:      C.text,
    lineHeight: 16,
  },
  toastAction: {
    fontSize:   12,
    fontWeight: '700',
    marginTop:  4,
  },
});
