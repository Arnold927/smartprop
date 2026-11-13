import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Banknote, CalendarClock, FileText, History, Mail, MessageSquare, Pencil,
  UserCheck, Wrench, Bell, ScrollText,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TimelineEvent {
  id: string;
  type: "payment" | "rent_due" | "invoice" | "maintenance" | "lease" | "reminder" | "visitor" | "message" | "change";
  at: string;
  title: string;
  detail?: string;
  amount?: number;
  currency?: string;
  status?: string;
  who?: string;
  href?: string;
}

export interface TimelineResponse<S = any> { summary: S; events: TimelineEvent[] }

/** Shared fetch so the quick-view panel and the full timeline use one cache entry. */
export function useTimeline<S = any>(kind: "tenant" | "unit", id: number | null | undefined, limit = 60) {
  return useQuery<TimelineResponse<S>>({
    queryKey: ["/api/timeline", kind, id, limit],
    queryFn: async () => (await apiRequest(`/api/timeline/${kind}/${id}?limit=${limit}`)).json(),
    enabled: !!id,
    staleTime: 60_000,
  });
}

const META: Record<TimelineEvent["type"], { icon: any; tone: string; label: string }> = {
  payment:     { icon: Banknote,      tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", label: "Payments" },
  rent_due:    { icon: CalendarClock, tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",       label: "Rent due" },
  invoice:     { icon: FileText,      tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",           label: "Invoices" },
  maintenance: { icon: Wrench,        tone: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",   label: "Maintenance" },
  lease:       { icon: ScrollText,    tone: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",   label: "Leases" },
  reminder:    { icon: Bell,          tone: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",               label: "Reminders" },
  visitor:     { icon: UserCheck,     tone: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",           label: "Visitors" },
  message:     { icon: MessageSquare, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",   label: "Messages" },
  change:      { icon: Pencil,        tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",       label: "Changes" },
};

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const fmtMonth = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
const fmtAmt = (n?: number, c = "KES") => (n === undefined ? "" : `${c} ${Math.round(n).toLocaleString("en-KE")}`);

const statusTone = (s?: string) =>
  s === "paid" || s === "completed" || s === "sent" || s === "checked_out" ? "text-emerald-700 dark:text-emerald-300"
  : s === "overdue" || s === "failed" || s === "cancelled" ? "text-red-700 dark:text-red-300"
  : "text-muted-foreground";

interface ActivityTimelineProps {
  kind: "tenant" | "unit";
  id: number | null | undefined;
  /** How many events to fetch (and, when `compact`, to show). */
  limit?: number;
  compact?: boolean;
  /** Let the user filter by event type (hidden in compact mode). */
  filterable?: boolean;
}

/** Chronological activity feed for a tenant or a unit. */
export function ActivityTimeline({ kind, id, limit = 60, compact = false, filterable = true }: ActivityTimelineProps) {
  const { data, isLoading, isError } = useTimeline(kind, id, limit);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const present = useMemo(() => Array.from(new Set((data?.events ?? []).map(e => e.type))), [data]);
  const events = useMemo(() => {
    const list = (data?.events ?? []).filter(e => !hidden.has(e.type));
    return compact ? list.slice(0, limit) : list;
  }, [data, hidden, compact, limit]);

  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (isError) return <p className="text-sm text-muted-foreground">Could not load the activity timeline.</p>;
  if (!data?.events.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <History className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="text-xs text-muted-foreground">Payments, maintenance, messages and lease changes will appear here.</p>
      </div>
    );
  }

  let lastMonth = "";
  return (
    <div className="space-y-3">
      {filterable && !compact && present.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
          {present.map(t => {
            const off = hidden.has(t);
            return (
              <button
                key={t} type="button" aria-pressed={!off}
                onClick={() => setHidden(prev => { const n = new Set(prev); off ? n.delete(t) : n.add(t); return n; })}
                className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", off ? "text-muted-foreground bg-background" : "bg-primary/10 text-primary border-primary/30")}
              >
                {META[t].label}
              </button>
            );
          })}
        </div>
      )}

      <ol className="relative space-y-0">
        {events.map(e => {
          const m = META[e.type];
          const Icon = m.icon;
          const month = fmtMonth(e.at);
          const header = !compact && month !== lastMonth ? month : null;
          lastMonth = month;
          const body = (
            <div className="flex-1 min-w-0 pb-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug">{e.title}</p>
                {e.amount !== undefined && <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtAmt(e.amount, e.currency)}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>{fmtDay(e.at)}</span>
                {e.who && <span>· {e.who}</span>}
                {e.status && <span className={cn("capitalize", statusTone(e.status))}>· {e.status.replace(/_/g, " ")}</span>}
              </div>
              {e.detail && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{e.detail}</p>}
            </div>
          );
          return (
            <li key={e.id}>
              {header && <p className="pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</p>}
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.tone)}><Icon className="h-4 w-4" /></span>
                  <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                </div>
                {e.href && !compact ? <Link href={e.href} className="flex-1 min-w-0 hover:opacity-80">{body}</Link> : body}
              </div>
            </li>
          );
        })}
      </ol>
      {compact && data.events.length > events.length && (
        <Badge variant="secondary" className="font-normal">+{data.events.length - events.length} more in the full timeline</Badge>
      )}
    </div>
  );
}
