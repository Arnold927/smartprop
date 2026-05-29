/**
 * maintenance-dashboard.tsx — Maintenance Manager view
 * Redesigned: operational clarity. 4 KPI tiles, category breakdown,
 * clean request list. No fake hardcoded data.
 */

import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Wrench, Clock, CheckCircle2, AlertTriangle, Play, User, X as XIcon, HardHat,
} from "lucide-react";
import { ActivityTracker, PageViewTracker } from "@/components/ui/activity-tracker";
import { FeatureAnnouncementCenter } from "@/components/ui/feature-announcement";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-500/10"   },
  assigned:    { label: "Assigned",    color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
  in_progress: { label: "In Progress", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10"  },
  completed:   { label: "Completed",   color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  cancelled:   { label: "Cancelled",   color: "text-muted-foreground",              bg: "bg-muted"         },
  on_hold:     { label: "On Hold",     color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10" },
};
const PRIORITY_DOT: Record<string, string> = { urgent: "bg-red-500", critical: "bg-red-600", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-muted-foreground" };
const CAT_COLORS = ["#10b981","#3b82f6","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16"];

function Tile({ label, value, sub, icon: Icon, accent, alert = false }: {
  label: string; value: string; sub: string; icon: any; accent: string; alert?: boolean;
}) {
  return (
    <div className={`bg-card border rounded-2xl p-6 relative overflow-hidden ${alert ? "border-red-300 dark:border-red-800 ring-1 ring-red-200 dark:ring-red-900" : "border-border"}`}>
      <div className={`absolute top-0 left-0 w-1 h-full ${accent} rounded-l-2xl`} />
      <div className="ml-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{label}</p>
        <p className="text-3xl font-bold text-foreground tracking-tight tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-2">{sub}</p>
        <div className={`absolute right-5 top-5 w-9 h-9 ${accent.replace("bg-",  "bg-").replace("-500","-500/10")} rounded-xl flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${accent.replace("bg-", "text-")}`} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function BarTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border shadow-xl rounded-xl px-4 py-3 text-xs">
      <p className="font-semibold text-foreground mb-1 capitalize">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-foreground font-medium">{p.value} requests</span>
        </div>
      ))}
    </div>
  );
}

export default function MaintenanceDashboard() {
  const { user } = useAuth();

  const { data: rawReqs, isLoading } = useQuery({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    retry: false,
  });

  const reqArr = Array.isArray(rawReqs) ? rawReqs : [];
  const todayStr = new Date().toDateString();

  // Real computed metrics
  const pendingCount  = reqArr.filter((r: any) => r.status === "pending").length;
  const inProgCount   = reqArr.filter((r: any) => r.status === "in_progress").length;
  const completedToday = reqArr.filter((r: any) => r.status === "completed" && new Date(r.updatedAt ?? r.createdAt ?? 0).toDateString() === todayStr).length;
  const emergencyCount = reqArr.filter((r: any) => ["urgent","critical"].includes(r.priority ?? "") && !["completed","cancelled"].includes(r.status)).length;
  const scheduledCount = reqArr.filter((r: any) => r.status === "assigned").length;
  const openCount = reqArr.filter((r: any) => !["completed","cancelled"].includes(r.status)).length;
  const completionRate = reqArr.length > 0 ? Math.round((reqArr.filter((r: any) => r.status === "completed").length / reqArr.length) * 100) : 0;

  const respondedReqs = reqArr.filter((r: any) => r.status !== "pending" && r.createdAt && r.updatedAt);
  const avgResponseTime = respondedReqs.length > 0
    ? Math.round(respondedReqs.reduce((s: number, r: any) => s + Math.min((new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 3600000, 72), 0) / respondedReqs.length * 10) / 10
    : null;

  // Category breakdown
  const catMap: Record<string, number> = {};
  reqArr.forEach((r: any) => { const c = (r.category ?? r.type ?? "Other").replace(/_/g, " "); catMap[c] = (catMap[c] ?? 0) + 1; });
  const catData = Object.entries(catMap).sort(([,a],[,b]) => b-a).slice(0, 8).map(([name, count]) => ({ name, count }));

  // Open requests by priority
  const openRequests = reqArr.filter((r: any) => !["completed","cancelled"].includes(r.status))
    .sort((a: any, b: any) => { const ord: Record<string,number> = { urgent: 0, critical: 0, high: 1, medium: 2, low: 3 }; return (ord[a.priority??""]) - (ord[b.priority??""]);})
    .slice(0, 8);

  if (isLoading) return (
    <div className="min-h-screen bg-background p-8 space-y-6">
      {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-2xl animate-pulse" />)}
    </div>
  );

  return (
    <ActivityTracker>
      <PageViewTracker page="maintenance-dashboard" data={{ role: "maintenance_manager" }} />
      <FeatureAnnouncementCenter position="banner" userRole="manager" />

      <div className="min-h-screen bg-background">

        {/* Header */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-sm">
                <Wrench className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">Maintenance Dashboard</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {user?.firstName || "Maintenance Manager"} · {format(new Date(), "EEEE, d MMMM yyyy")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {emergencyCount > 0 ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5" />{emergencyCount} Emergency
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />No Emergencies
                </span>
              )}
              {avgResponseTime !== null && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400">
                  <Clock className="w-3.5 h-3.5" />{avgResponseTime}h Avg Response
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* 4 KPI tiles */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
            <Tile label="Open Requests"  value={String(openCount)}      sub={`${pendingCount} pending · ${inProgCount} in progress`}       icon={Wrench}       accent="bg-orange-500" alert={emergencyCount > 0} />
            <Tile label="Response Time"  value={avgResponseTime !== null ? `${avgResponseTime}h` : "—"} sub="Avg. time to first action"   icon={Clock}        accent="bg-blue-500" />
            <Tile label="Completed Today" value={String(completedToday)} sub={`${completionRate}% overall completion rate`}                  icon={CheckCircle2} accent="bg-emerald-500" />
            <Tile label="Active Workers"  value={String(inProgCount)}   sub={`${scheduledCount} scheduled · ${emergencyCount} emergency`}  icon={HardHat}      accent="bg-violet-500" />
          </div>

          {/* Chart + request list */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Category breakdown */}
            <Section title="Requests by Category" sub={`${reqArr.length} total`}>
              {catData.length === 0 ? (
                <div className="flex flex-col items-center py-10 space-y-2">
                  <Wrench className="w-8 h-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No requests yet</p>
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={catData} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
                      <Tooltip content={<BarTip />} cursor={{ fill: "hsl(var(--muted))" }} />
                      <Bar dataKey="count" radius={[0,3,3,0]}>
                        {catData.map((_: any, i: number) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            {/* Status summary */}
            <Section title="Status Breakdown">
              <div className="space-y-2">
                {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
                  const count = reqArr.filter((r: any) => r.status === status).length;
                  if (count === 0) return null;
                  const pct = reqArr.length > 0 ? Math.round(count / reqArr.length * 100) : 0;
                  return (
                    <div key={status}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${cfg.bg.replace("/10", "/50")}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>

          {/* Open request list */}
          {openRequests.length > 0 && (
            <Section title="Open Requests" sub="Sorted by priority">
              <div className="divide-y divide-border">
                {openRequests.map((req: any) => {
                  const statusCfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG["pending"];
                  return (
                    <div key={req.id} className="flex items-start gap-4 py-3.5 first:pt-0 last:pb-0">
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[req.priority] ?? "bg-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{req.title ?? `Request #${req.id}`}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {req.property?.name ?? "—"} · {req.category?.replace(/_/g, " ") ?? "General"}
                          {req.createdAt ? ` · ${format(new Date(req.createdAt), "dd MMM")}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${
                          ["urgent","critical"].includes(req.priority ?? "") ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : req.priority === "high" ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                          : "bg-muted text-muted-foreground"
                        }`}>{req.priority ?? "medium"}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusCfg.bg} ${statusCfg.color}`}>{statusCfg.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

        </div>
      </div>
    </ActivityTracker>
  );
}
