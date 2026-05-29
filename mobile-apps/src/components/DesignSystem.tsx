/**
 * DesignSystem.tsx
 *
 * Centralised design tokens and primitive UI components for the SmartProp
 * mobile app. Imported by screens and components throughout the app.
 *
 * Exports:
 *   C      — colour palette
 *   R      — radius / spacing tokens
 *   shadow — platform-aware shadow style
 *   haptic — haptic feedback helper
 *   SkeletonCard, StatusPill, EmptyState, ErrorState, PressableCard
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Vibration,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';

// ─── Colour Palette ──────────────────────────────────────────────────────────

export const C = {
  // Brand
  primary:      '#059669',  // emerald-600
  primaryDark:  '#065f46',  // emerald-800
  primaryLight: '#d1fae5',  // emerald-100
  accent:       '#0ea5e9',  // sky-500

  // Backgrounds
  bg:           '#f8fafc',  // slate-50
  surface:      '#ffffff',
  surfaceAlt:   '#f1f5f9',  // slate-100
  card:         '#ffffff',

  // Text
  text:         '#0f172a',  // slate-900
  textSub:      '#475569',  // slate-600
  textMuted:    '#94a3b8',  // slate-400
  textInverse:  '#ffffff',
  ink:          '#0f172a',  // alias for text — dark readable text

  // Borders
  border:       '#e2e8f0',  // slate-200
  borderLight:  '#f1f5f9',  // slate-100 — subtle divider
  borderFocus:  '#059669',

  // Semantic — greens
  green:        '#059669',
  greenLight:   '#d1fae5',

  // Semantic — yellows/ambers
  yellow:       '#d97706',
  yellowLight:  '#fef3c7',
  amber:        '#d97706',  // same as yellow — used by some screens
  amberLight:   '#fef3c7',  // amber-100
  amberDark:    '#92400e',  // amber-800

  // Semantic — reds
  red:          '#dc2626',
  redLight:     '#fee2e2',

  // Semantic — blues
  blue:         '#2563eb',
  blueLight:    '#dbeafe',

  // Semantic — purples / indigo
  purple:       '#7c3aed',
  purpleLight:  '#ede9fe',
  indigo:       '#4f46e5',  // indigo-600
  indigoLight:  '#e0e7ff',

  // Semantic — orange
  orange:       '#ea580c',
  orangeLight:  '#ffedd5',

  // Dark mode (used selectively)
  dark:         '#1e293b',
  darkSurface:  '#0f172a',
} as const;

// ─── Radius / Spacing Tokens ─────────────────────────────────────────────────

export const R = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  full: 999,
  pill: 999,  // alias for full — used by some screens for pill-shaped elements
} as const;

// ─── Shadow ───────────────────────────────────────────────────────────────────
// Used as shadow(elevation?) — returns a platform-aware shadow style.
// elevation defaults to 2 on Android; ignored on iOS.

export function shadow(elevation = 2): ViewStyle {
  return Platform.select({
    ios: {
      shadowColor:   '#000',
      shadowOffset:  { width: 0, height: elevation },
      shadowOpacity: 0.06 + elevation * 0.01,
      shadowRadius:  elevation * 2.5,
    },
    android: {
      elevation,
    },
    default: {},
  }) ?? {};
}

// ─── Haptic Feedback ──────────────────────────────────────────────────────────
// Used as haptic.light() / haptic.medium() / haptic.heavy() or haptic()

function _haptic(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  try {
    const duration = type === 'light' ? 10 : type === 'medium' ? 25 : 50;
    Vibration.vibrate(duration);
  } catch {
    // Silent fail — vibration not available
  }
}

_haptic.light  = () => _haptic('light');
_haptic.medium = () => _haptic('medium');
_haptic.heavy  = () => _haptic('heavy');

export const haptic = _haptic;

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

interface SkeletonCardProps {
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonCard({ height = 80, style }: SkeletonCardProps) {
  return (
    <View style={[styles.skeleton, { height }, style]} />
  );
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

interface StatusPillProps {
  status: string;
  style?: StyleProp<ViewStyle>;
}

const STATUS_COLOURS: Record<string, { bg: string; text: string }> = {
  active:     { bg: C.greenLight,  text: C.primaryDark },
  completed:  { bg: C.greenLight,  text: C.primaryDark },
  paid:       { bg: C.greenLight,  text: C.primaryDark },
  approved:   { bg: C.greenLight,  text: C.primaryDark },
  pending:    { bg: C.yellowLight, text: C.yellow },
  open:       { bg: C.yellowLight, text: C.yellow },
  in_progress:{ bg: C.blueLight,   text: C.blue },
  inactive:   { bg: C.surfaceAlt,  text: C.textMuted },
  cancelled:  { bg: C.redLight,    text: C.red },
  overdue:    { bg: C.redLight,    text: C.red },
  rejected:   { bg: C.redLight,    text: C.red },
  expired:    { bg: C.redLight,    text: C.red },
};

export function StatusPill({ status, style }: StatusPillProps) {
  const key    = status?.toLowerCase().replace(/[^a-z_]/g, '_') ?? '';
  const colours = STATUS_COLOURS[key] ?? { bg: C.surfaceAlt, text: C.textMuted };
  const label  = status?.replace(/_/g, ' ') ?? 'Unknown';

  return (
    <View style={[styles.pill, { backgroundColor: colours.bg }, style]}>
      <Text style={[styles.pillText, { color: colours.text }]}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </Text>
    </View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string;
  title?: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title    = 'Nothing here yet',
  subtitle,
  action,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, style]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {action ? (
        <TouchableOpacity style={styles.emptyAction} onPress={action.onPress}>
          <Text style={styles.emptyActionText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── ErrorState ───────────────────────────────────────────────────────────────

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  message = 'Something went wrong',
  onRetry,
  style,
}: ErrorStateProps) {
  return (
    <View style={[styles.emptyState, style]}>
      <Text style={[styles.emptyTitle, { color: C.red }]}>Error</Text>
      <Text style={styles.emptySub}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={[styles.emptyAction, { backgroundColor: C.redLight }]} onPress={onRetry}>
          <Text style={[styles.emptyActionText, { color: C.red }]}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── PressableCard ────────────────────────────────────────────────────────────

interface PressableCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function PressableCard({ children, onPress, style, disabled }: PressableCardProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, shadow(), style]}
    >
      {children}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: C.border,
    borderRadius: R.md,
    marginBottom: 8,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: R.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: 8,
    backgroundColor: C.primaryLight,
    borderRadius: R.lg,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptyActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primaryDark,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
});