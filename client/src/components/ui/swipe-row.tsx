/**
 * swipe-row.tsx — one list row that reveals quick actions when you swipe it sideways on a phone.
 *
 *   <SwipeRow trailing={[{ key: "call", label: "Call", icon: Phone, tone: "emerald", onAction: call }]}>…row…</SwipeRow>
 *
 *   - swipe LEFT reveals `trailing` actions on the right edge, swipe RIGHT reveals `leading` actions on the left;
 *   - touch screens only (mouse users keep the buttons/menus they already have), and swiping never replaces a button:
 *     every action here must also exist somewhere else on the row/page, a swipe is the shortcut;
 *   - vertical scrolling is left to the browser (`touch-action: pan-y`), so a list still scrolls normally;
 *   - the row snaps open or shut, only one row is open at a time, tapping anywhere else (or scrolling) closes it;
 *   - a light tick as it passes the point where it will stay open, a tap on an action closes the row and runs it;
 *   - `peek` nudges the row once per device so people discover the gesture (skipped for reduced motion).
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { haptic, prefersReducedMotion } from "@/lib/feel";
import { cn } from "@/lib/utils";

export type SwipeTone = "emerald" | "green" | "blue" | "amber" | "red" | "violet" | "slate";

export interface SwipeAction {
  key: string;
  label: string;
  icon: LucideIcon;
  tone?: SwipeTone;
  onAction: () => void;
  disabled?: boolean;
  /** Set true to leave the action out (handy for role/status checks inline). */
  hidden?: boolean;
}

const TONE: Record<SwipeTone, string> = {
  emerald: "bg-emerald-700 text-white",
  green: "bg-green-700 text-white",
  blue: "bg-blue-600 text-white",
  amber: "bg-amber-700 text-white",
  red: "bg-red-600 text-white",
  violet: "bg-violet-600 text-white",
  slate: "bg-slate-600 text-white",
};

const ACTION_W = 68;           // px per revealed button
const LOCK_DIST = 8;           // px of movement before we decide horizontal vs vertical
const OPEN_EVENT = "sp-swipe-open";
const PEEK_KEY = "sp_swipe_hint_seen";

const isTouchDevice = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

interface Props {
  children: React.ReactNode;
  trailing?: SwipeAction[];
  leading?: SwipeAction[];
  /** Runs when the row itself is tapped (not when an action is). */
  onTap?: () => void;
  className?: string;
  /** Give this to ONE row per list (the first) to nudge it once, so the gesture is discoverable. */
  peek?: boolean;
  disabled?: boolean;
  /** Background of the sliding row (defaults to the card colour). Must be opaque so the actions underneath stay hidden. */
  contentClassName?: string;
}

export function SwipeRow({ children, trailing = [], leading = [], onTap, className, peek, disabled, contentClassName }: Props) {
  const trail = trailing.filter(a => !a.hidden);
  const lead = leading.filter(a => !a.hidden);
  const trailW = trail.length * ACTION_W;
  const leadW = lead.length * ACTION_W;
  const enabled = !disabled && (trail.length > 0 || lead.length > 0);

  const id = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [x, setX] = React.useState(0);               // + = row moved right (leading shown), - = moved left (trailing shown)
  const [dragging, setDragging] = React.useState(false);
  const xRef = React.useRef(0);
  const g = React.useRef({ sx: 0, sy: 0, base: 0, lock: "none" as "none" | "h" | "v", t0: 0, moved: false, ticked: false, on: false });
  const suppressClick = React.useRef(false);

  const place = (v: number) => { xRef.current = v; setX(v); };
  const close = React.useCallback(() => { if (xRef.current !== 0) place(0); }, []);

  // Only one open row at a time; tap outside or scroll closes it.
  React.useEffect(() => {
    if (!enabled) return;
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== id) close(); };
    const onOutside = (e: Event) => { if (xRef.current !== 0 && !rootRef.current?.contains(e.target as Node)) close(); };
    const onScroll = () => { if (xRef.current !== 0) close(); };
    window.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener("touchstart", onOutside, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [enabled, id, close]);

  // One-time discoverability nudge.
  React.useEffect(() => {
    if (!enabled || !peek || !isTouchDevice() || prefersReducedMotion()) return;
    try { if (localStorage.getItem(PEEK_KEY)) return; } catch { return; }
    let nudged = false;
    const t1 = window.setTimeout(() => {
      // Only nudge a row the person can actually see; otherwise keep the hint for a list they scroll to / open later.
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 60 || r.top > window.innerHeight - 90) return;
      nudged = true;
      place(trailW ? -Math.min(trailW, 56) : Math.min(leadW, 56));
    }, 900);
    const t2 = window.setTimeout(() => { if (!nudged) return; place(0); try { localStorage.setItem(PEEK_KEY, "1"); } catch { /* ignore */ } }, 1500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, peek, trailW, leadW]);

  if (!enabled) {
    return <div className={className} onClick={onTap} role={onTap ? "button" : undefined}>{children}</div>;
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { g.current.on = false; return; }
    const t = e.touches[0];
    g.current = { sx: t.clientX, sy: t.clientY, base: xRef.current, lock: "none", t0: Date.now(), moved: false, ticked: false, on: true };
    suppressClick.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = g.current;
    if (!s.on) return;
    const t = e.touches[0];
    const dx = t.clientX - s.sx, dy = t.clientY - s.sy;
    if (s.lock === "none") {
      if (Math.abs(dx) < LOCK_DIST && Math.abs(dy) < LOCK_DIST) return;
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v";
      if (s.lock === "h") { setDragging(true); window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id })); }
    }
    if (s.lock !== "h") return;
    s.moved = true;
    let v = s.base + dx;
    // Resist (rubber-band) past the end of the panel, and don't reveal a side that has no actions.
    const max = leadW, min = -trailW;
    if (v > max) v = max + (v - max) * 0.25;
    if (v < min) v = min + (v - min) * 0.25;
    place(v);
    const open = v < 0 ? -v > trailW / 3 : v > leadW / 3;
    if (open && !s.ticked) { s.ticked = true; haptic("select"); }
    if (!open && s.ticked) s.ticked = false;
  };

  const onTouchEnd = () => {
    const s = g.current;
    if (!s.on) return;
    s.on = false;
    setDragging(false);
    if (s.lock !== "h") return;
    suppressClick.current = true;                       // the finger travelled: don't also count it as a tap
    window.setTimeout(() => { suppressClick.current = false; }, 60);
    const v = xRef.current;
    const velocity = (v - s.base) / Math.max(1, Date.now() - s.t0);   // px per ms, signed
    if (v < 0 && (-v > trailW / 3 || velocity < -0.45) && velocity <= 0.2) place(-trailW);
    else if (v > 0 && (v > leadW / 3 || velocity > 0.45) && velocity >= -0.2) place(leadW);
    else place(0);
  };

  const run = (a: SwipeAction) => {
    if (a.disabled) return;
    haptic("tap");
    place(0);
    window.setTimeout(a.onAction, 120);                 // let the row close first, then act
  };

  const open = x !== 0;

  const panel = (list: SwipeAction[], side: "left" | "right") => list.length === 0 ? null : (
    <div
      className={cn("absolute top-0 bottom-0 flex items-stretch", side === "right" ? "right-0" : "left-0")}
      style={{ width: list.length * ACTION_W }}
      aria-hidden={!open}
    >
      {list.map(a => (
        <button
          key={a.key}
          type="button"
          tabIndex={open ? 0 : -1}
          disabled={a.disabled}
          onClick={() => run(a)}
          className={cn("flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium disabled:opacity-40 active:brightness-90", TONE[a.tone ?? "slate"])}
        >
          <a.icon className="w-[18px] h-[18px]" aria-hidden="true" />
          <span className="leading-none">{a.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={cn("relative overflow-hidden", className)}>
      {panel(lead, "left")}
      {panel(trail, "right")}
      <div
        className={cn("relative will-change-transform", contentClassName ?? "bg-card", !dragging && "sp-swipe-settle")}
        style={{ transform: `translate3d(${x}px,0,0)`, touchAction: "pan-y" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        role={onTap ? "button" : undefined}
        tabIndex={onTap ? 0 : undefined}
        onKeyDown={onTap ? (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onTap(); } } : undefined}
        onClick={() => {
          if (suppressClick.current) return;
          if (xRef.current !== 0) { close(); return; }     // tapping an open row just closes it
          onTap?.();
        }}
      >
        {children}
      </div>
    </div>
  );
}
