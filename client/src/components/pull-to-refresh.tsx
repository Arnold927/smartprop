/**
 * pull-to-refresh.tsx — drag down from the top of any screen on a phone to refresh its data.
 *
 * Mounted once in App.tsx, so every portal (tenant, landlord, staff, contractor, caretaker, guard, manager…)
 * gets it. It works by watching touches anywhere on the page:
 *   - only on touch devices;
 *   - only when the thing being dragged is already scrolled to the very top (a chat or list that still has
 *     content above is left alone), and never inside dialogs, sheets, menus, inputs or maps;
 *   - only for a mostly vertical drag, so horizontal swipes (carousels, tab strips) are untouched.
 * Releasing past the threshold refetches every active query, shows a spinner until the data is back, then a tick.
 */
import * as React from "react";
import { ArrowDown, Check, Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { haptic, prefersReducedMotion } from "@/lib/feel";
import { cn } from "@/lib/utils";

const THRESHOLD = 64;   // px of (damped) pull needed to trigger
const MAX_PULL = 96;
const EXCLUDE = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-no-ptr], .leaflet-container, canvas, video, iframe';

/** True when something between the touch target and the page can still scroll up (so the drag belongs to it, not to us). */
function canScrollUp(start: EventTarget | null): boolean {
  let el = start as HTMLElement | null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollTop > 0) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "overlay") return true;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement?.scrollTop ?? 0) > 0;
}

type Phase = "idle" | "pulling" | "ready" | "refreshing" | "done";

export function PullToRefresh() {
  const [pull, setPull] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const phaseRef = React.useRef<Phase>("idle");
  const set = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;

    let startY = 0, startX = 0, tracking = false, active = false, crossed = false;

    const onStart = (e: TouchEvent) => {
      tracking = false; active = false; crossed = false;
      if (e.touches.length !== 1 || phaseRef.current === "refreshing" || phaseRef.current === "done") return;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest?.(EXCLUDE) || canScrollUp(t)) return;
      startY = e.touches[0].clientY; startX = e.touches[0].clientX; tracking = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
      if (!active) {
        if (dy < -6 || Math.abs(dx) > Math.abs(dy) * 0.7 && Math.abs(dx) > 8) { tracking = false; return; }   // up or sideways: not ours
        if (dy < 10) return;
        active = true;
      }
      if (dy <= 0) { setPull(0); set("idle"); return; }
      const damped = Math.min(MAX_PULL, dy * 0.5);
      setPull(damped);
      if (damped >= THRESHOLD) {
        if (!crossed) { crossed = true; haptic("select"); }
        if (phaseRef.current !== "ready") set("ready");
      } else {
        crossed = false;
        if (phaseRef.current !== "pulling") set("pulling");
      }
    };

    const onEnd = async () => {
      if (!active) { tracking = false; return; }
      tracking = false; active = false;
      if (phaseRef.current !== "ready") { setPull(0); set("idle"); return; }
      set("refreshing"); setPull(THRESHOLD * 0.8);
      const t0 = Date.now();
      try { await queryClient.invalidateQueries({ refetchType: "active" }); } catch { /* individual errors surface in their own screens */ }
      const wait = Math.max(0, 700 - (Date.now() - t0));
      window.setTimeout(() => {
        haptic("success"); set("done");
        window.setTimeout(() => { setPull(0); set("idle"); }, 650);
      }, wait);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (phase === "idle" && pull === 0) return null;
  const progress = Math.min(1, pull / THRESHOLD);
  const settling = phase === "refreshing" || phase === "done" || phase === "idle";
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className={cn(
          "mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-emerald-600 shadow-lg",
          phase === "done" && "text-white bg-emerald-500 border-emerald-500",
        )}
        style={{
          transform: `translateY(${pull - 44}px) scale(${0.6 + progress * 0.4})`,
          opacity: Math.min(1, progress * 1.4),
          transition: settling && !prefersReducedMotion() ? "transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease" : "none",
        }}
      >
        <span className="sr-only">{phase === "refreshing" ? "Refreshing" : phase === "done" ? "Updated" : phase === "ready" ? "Release to refresh" : "Pull to refresh"}</span>
        {phase === "refreshing" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          : phase === "done" ? <Check className="h-5 w-5" aria-hidden="true" />
          : <ArrowDown className="h-5 w-5 transition-transform" style={{ transform: `rotate(${phase === "ready" ? 180 : progress * 120}deg)` }} aria-hidden="true" />}
      </div>
    </div>
  );
}
