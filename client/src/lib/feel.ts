/**
 * feel.ts — small helpers for how the app responds to people.
 *
 * Haptics use the Vibration API (Android Chrome and most Android browsers). iPhones don't expose it,
 * so there the call quietly does nothing and the visual feedback carries the moment on its own.
 */

export function prefersReducedMotion(): boolean {
  try { return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

type HapticKind = "tap" | "select" | "success" | "warn";
const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,                 // a light tick for navigation
  select: 12,             // choosing something
  success: [14, 50, 22],  // short double pulse: "done"
  warn: [30, 40, 30],
};

/** Light vibration on supported phones. Never throws, never fires for people who asked for reduced motion. */
export function haptic(kind: HapticKind = "tap") {
  try {
    if (prefersReducedMotion()) return;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(PATTERNS[kind]);
  } catch { /* not supported: fine */ }
}

/** Splits "KES 1,250,000" or "94%" or "12" into prefix / number / suffix so the number alone can animate. Returns null when there is no number to animate. */
export function parseAnimatable(value: string | number): { prefix: string; n: number; decimals: number; suffix: string } | null {
  if (typeof value === "number") return Number.isFinite(value) ? { prefix: "", n: value, decimals: Number.isInteger(value) ? 0 : 1, suffix: "" } : null;
  const m = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/.exec(value.trim());
  if (!m) return null;
  const raw = m[2].replace(/,/g, "");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  return { prefix: m[1], n, decimals, suffix: m[3] };
}

export function formatAnimated(n: number, decimals: number, grouped: boolean): string {
  const fixed = n.toFixed(decimals);
  if (!grouped) return fixed;
  const [i, d] = fixed.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "");
}

/** "Good morning" / "Good afternoon" / "Good evening" for the viewer's local time. */
export function timeGreeting(date: Date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
