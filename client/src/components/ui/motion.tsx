/**
 * motion.tsx — the few animated building blocks the whole app shares.
 *
 *  AnimatedNumber  numbers count up to their value the first time they appear
 *  Stagger         children rise in one after another
 *  SuccessBurst    the "it worked" moment: a tick that draws itself, a soft ring and a little confetti
 *  Confetti        the confetti on its own, for moments that already have their own card
 *
 * All of it respects prefers-reduced-motion (see the "feel layer" in index.css).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatAnimated, haptic, parseAnimatable, prefersReducedMotion } from "@/lib/feel";

// ── AnimatedNumber ───────────────────────────────────────────────────────────

/** Counts from 0 to the number inside `value` ("KES 1,250,000", "94%", 12). Anything without a number renders as-is. */
export function AnimatedNumber({ value, duration = 900, className }: { value: string | number; duration?: number; className?: string }) {
  const parsed = React.useMemo(() => parseAnimatable(value), [value]);
  const grouped = typeof value === "string" ? value.includes(",") : (parsed?.n ?? 0) >= 10000;
  const [shown, setShown] = React.useState<number | null>(null);
  const prev = React.useRef<number>(0);
  const key = parsed ? `${parsed.n}` : "";

  React.useEffect(() => {
    if (!parsed) return;
    if (prefersReducedMotion() || duration <= 0) { setShown(parsed.n); prev.current = parsed.n; return; }
    const from = prev.current, to = parsed.n;
    if (from === to) { setShown(to); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 4);                 // fast start, soft landing
      setShown(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, duration]);

  if (!parsed) return <span className={className}>{value}</span>;
  // Once the count finishes (or if the number never moves) show the original text exactly as given.
  const settled = shown != null && Math.abs(shown - parsed.n) < Math.pow(10, -parsed.decimals) / 2;
  if (settled) return <span className={className}>{value}</span>;
  const text = formatAnimated(shown ?? 0, parsed.decimals, grouped);
  return <span className={className}>{parsed.prefix}{text}{parsed.suffix}</span>;
}

// ── Stagger ──────────────────────────────────────────────────────────────────

/** Gives each direct child a rise-in with a small delay between them. */
export function Stagger({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: React.ElementType }) {
  return (
    <Tag className={className}>
      {React.Children.toArray(children).map((child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              className: cn((child.props as any).className, "sp-rise"),
              style: { ...(child.props as any).style, "--i": i },
            })
          : child)}
    </Tag>
  );
}

// ── Confetti ─────────────────────────────────────────────────────────────────

const COLORS = ["#10b981", "#34d399", "#f59e0b", "#38bdf8", "#a78bfa", "#fb7185"];

/** A short burst of confetti from the centre of its (relatively positioned) parent. Pure CSS, ~1s, then it is gone. */
export function Confetti({ pieces = 22 }: { pieces?: number }) {
  const items = React.useMemo(() => Array.from({ length: pieces }, (_, i) => {
    const angle = (Math.PI * 2 * i) / pieces + (Math.random() - 0.5) * 0.6;
    const dist = 70 + Math.random() * 70;
    return {
      dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist - 20,
      rot: (Math.random() - 0.5) * 540, delay: Math.random() * 90,
      size: 5 + Math.random() * 4, color: COLORS[i % COLORS.length], round: i % 3 === 0,
    };
  }), [pieces]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
      {items.map((p, i) => (
        <span
          key={i}
          className="sp-confetti-piece absolute"
          style={{
            width: p.size, height: p.round ? p.size : p.size * 0.55, background: p.color,
            borderRadius: p.round ? "9999px" : "2px",
            ["--dx" as any]: `${p.dx}px`, ["--dy" as any]: `${p.dy}px`, ["--rot" as any]: `${p.rot}deg`,
            animation: `sp-confetti 900ms ${p.delay}ms cubic-bezier(0.22,1,0.36,1) both`,
          }}
        />
      ))}
    </div>
  );
}

// ── SuccessBurst ─────────────────────────────────────────────────────────────

/** The round "done" badge: pops in, draws its tick, sends out one ring and a little confetti, and gives a light haptic on phones. */
export function SuccessBurst({ size = 64, confetti = true, className }: { size?: number; confetti?: boolean; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    haptic("success");
    // The result of an action the person just took should be on screen: bring it into view if it landed below the fold.
    ref.current?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);
  return (
    <div ref={ref} className={cn("relative mx-auto flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <span className="sp-burst-ring absolute inset-0 rounded-full bg-emerald-500/40" style={{ animation: "sp-ring 900ms var(--ease-soft) 120ms both" }} aria-hidden="true" />
      <span className="sp-pop-spring relative flex h-full w-full items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
        <svg className="sp-check" width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      {confetti && <Confetti />}
    </div>
  );
}

// ── DeniedBurst ──────────────────────────────────────────────────────────────

/** The "no" moment (e.g. a gate pass that is not valid): a red cross that pops in with a short shake, and a firm double buzz. Never celebratory. */
export function DeniedBurst({ size = 64, className }: { size?: number; className?: string }) {
  React.useEffect(() => { haptic("warn"); }, []);
  return (
    <div className={cn("relative mx-auto flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <span className="sp-pop-spring sp-shake relative flex h-full w-full items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30">
        <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    </div>
  );
}
