import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One header for every role portal (tenant, landlord, contractor, staff,
 * caretaker, gate, diaspora). It uses the same surface tokens as the rest of
 * the app — card background, hairline border, emerald icon tile — so a portal
 * never looks like a different product from the main dashboard, in light or
 * dark mode.
 */

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "orange";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  amber: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  orange: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  orange: "bg-orange-500",
};

export function PortalChip({
  children, tone = "neutral", dot, pulse, icon: Icon, onClick, className,
}: {
  children: ReactNode; tone?: Tone; dot?: boolean; pulse?: boolean;
  icon?: ComponentType<{ className?: string }>; onClick?: () => void; className?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
    TONES[tone],
    onClick && "transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const inner = (
    <>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone], pulse && "animate-pulse")} />}
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cls}>{inner}</button>
    : <span className={cls}>{inner}</span>;
}

export function PortalMeta({ icon: Icon, children, className }: { icon?: ComponentType<{ className?: string }>; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function PortalHeader({
  icon: Icon, avatar, eyebrow, title, meta, actions, footer, maxWidth = "max-w-5xl", sticky, className,
}: {
  icon?: ComponentType<{ className?: string }>;
  /** Initials etc. shown in the tile instead of an icon. */
  avatar?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Small muted facts under the title (PortalMeta items). */
  meta?: ReactNode;
  /** Chips / buttons on the right. */
  actions?: ReactNode;
  /** Extra full-width row, e.g. lease progress. */
  footer?: ReactNode;
  maxWidth?: string;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-border bg-card px-4 py-4 sm:px-6 sm:py-5", sticky && "sticky top-0 z-10", className)}>
      <div className={cn("mx-auto w-full", maxWidth)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {(Icon || avatar) && (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 sm:h-12 sm:w-12">
                {avatar ? <span className="text-base font-semibold sm:text-lg">{avatar}</span> : Icon && <Icon className="h-5 w-5 sm:h-6 sm:w-6" />}
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>}
              <h1 className="break-words text-lg font-semibold leading-tight text-foreground sm:text-xl">{title}</h1>
              {meta && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</div>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {footer}
      </div>
    </header>
  );
}
