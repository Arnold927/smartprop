import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Check, ChevronRight, X, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { SuccessBurst } from "@/components/ui/motion";

export interface SetupStep {
  key: string;
  title: string;
  hint: string;
  done: boolean;
  href: string;
  cta: string;
}

const storageKey = (userId: string | number) => `sp_getting_started_dismissed_${userId}`;

/**
 * First-run "Getting started" checklist for the admin/manager dashboard.
 * Shows only while something is still to do, and can be dismissed (per user, per browser).
 */
export function GettingStarted({ userId, steps }: { userId: string | number; steps: SetupStep[] }) {
  const [, navigate] = useLocation();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(storageKey(userId)) === "1"; } catch { return false; } });

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;
  const flag = (k: string) => { try { return localStorage.getItem(`${k}_${userId}`) === "1"; } catch { return true; } };
  // Remember that this person has seen setup unfinished, so finishing it later earns a moment (people who were already
  // fully set up before this existed are not congratulated out of the blue).
  useEffect(() => { if (!allDone) { try { localStorage.setItem(`sp_setup_seen_incomplete_${userId}`, "1"); } catch { /* ignore */ } } }, [allDone, userId]);
  // Finishing setup deserves a moment, once: show it, and it leaves for good when dismissed.
  if (allDone && !hidden && flag("sp_setup_seen_incomplete") && !flag("sp_setup_celebrated")) {
    const finish = () => { try { localStorage.setItem(`sp_setup_celebrated_${userId}`, "1"); localStorage.setItem(storageKey(userId), "1"); } catch { /* ignore */ } setHidden(true); };
    return (
      <section aria-label="Setup complete" role="status" className="sp-pop rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-gradient-to-b from-emerald-500/10 to-transparent p-6 text-center">
        <SuccessBurst size={60} />
        <p className="mt-3 font-semibold text-foreground">You're all set up</p>
        <p className="text-sm text-muted-foreground mt-1">Your properties, tenants and payments are ready to go.</p>
        <button onClick={finish} className="sp-press mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Start managing</button>
      </section>
    );
  }
  if (hidden || allDone) return null;
  const next = steps.find(s => !s.done);
  const pct = Math.round((doneCount / steps.length) * 100);

  const dismiss = () => { try { localStorage.setItem(storageKey(userId), "1"); } catch { /* ignore */ } setHidden(true); };

  return (
    <section aria-label="Getting started" className="sp-rise rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-500/5 p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm"><Rocket className="w-5 h-5 text-white" /></div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">Get SmartProp ready — {doneCount} of {steps.length} done</p>
          <div className="mt-2 h-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss getting started" className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <ul className="sp-stagger mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map(s => (
          <li key={s.key}>
            <button
              onClick={() => navigate(s.href)}
              disabled={s.done}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                s.done ? "border-transparent bg-transparent cursor-default" : "border-border bg-card hover:border-emerald-400",
                next?.key === s.key && !s.done && "ring-1 ring-emerald-500",
              )}
            >
              <span className={cn("w-5 h-5 rounded-full flex items-center justify-center shrink-0 border", s.done ? "bg-emerald-600 border-emerald-600 text-white sp-pop-spring" : "border-muted-foreground/40")}>
                {s.done && <Check className="w-3 h-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", s.done && "line-through text-muted-foreground")}>{s.title}</span>
                {!s.done && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
              </span>
              {!s.done && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center shrink-0">{s.cta}<ChevronRight className="w-3.5 h-3.5" /></span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
