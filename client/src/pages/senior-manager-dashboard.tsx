/**
 * senior-manager-dashboard.tsx
 * Redesigned: executive command centre — sparse, authoritative, data-first.
 * Four metric tiles · one portfolio bar chart · two summary panels.
 */

import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Building, Users, DollarSign, TrendingUp, Shield, AlertTriangle,
  CheckCircle, ChevronRight, Crown,
} from "lucide-react";
import { ActivityTracker, PageViewTracker } from "@/components/ui/activity-tracker";
import { FeatureAnnouncementCenter } from "@/components/ui/feature-announcement";

const fmtM = (n: number) => `KES ${(n / 1_000_000).toFixed(1)}M`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function Tile({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub: string; icon: any; color: string }) {
  return (
    <div className={`bg-card border border-border rounded-2xl p-6 relative overflow-hidden`}>
      <div className={`absolute top-0 left-0 w-1 h-full ${color} rounded-l-2xl`} />
      <div className="ml-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{label}</p>
        <p className="text-3xl font-bold text-foreground tracking-tight tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-2">{sub}</p>
        <div className={`absolute right-5 top-5 w-9 h-9 ${color.replace("bg-", "bg-").replace("-500", "-500/10")} rounded-xl flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${color.replace("bg-", "text-")}`} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border shadow-xl rounded-xl px-4 py-3 text-xs">
      <p className="font-semibold text-foreground mb-1.5 truncate max-w-32">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-medium text-foreground">{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

export default function SeniorManagerDashboard() {
  const { user } = useAuth();

  const { data: rawMetrics = {} } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
    queryFn: async () => { const r = await apiRequest("/api/dashboard/metrics"); const d = await r.json(); return (d && !Array.isArray(d)) ? d : {}; },
    retry: false,
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()),
    retry: false,
  });

  const md: any = rawMetrics;
  const props = Array.isArray(properties) ? properties : [];
  // Portfolio value: use estimatedValue if the property record carries it,
  // otherwise we genuinely don't know — don't fabricate a number.
  const portValKnown = props.reduce((s: number, p: any) => s + Number(p.estimatedValue ?? 0), 0);
  const portValKnownCount = props.filter((p: any) => Number(p.estimatedValue ?? 0) > 0).length;

  // Net ROI: only meaningful if we have both revenue AND actual valuations.
  // annualRev here is the all-time total (a rough proxy); only show if we have valuations.
  const annualRevProxy = Number(md.totalRevenue ?? 0);
  const netROI = portValKnown > 0 && annualRevProxy > 0
    ? Math.round((annualRevProxy / portValKnown) * 1000) / 10
    : null;
  const monthlyRev = Number(md.monthlyRevenue ?? 0);
  const complianceScore = Math.max(0, 100 - Math.round((Number(md.overdueRent ?? 0) / Math.max(Number(md.totalUnits ?? 1), 1)) * 20));
  const riskLevel = md.overdueRent > 3 ? "High" : md.overdueRent > 0 ? "Medium" : "Low";
  const riskColor = riskLevel === "High" ? "text-red-600" : riskLevel === "Medium" ? "text-amber-600" : "text-emerald-600";

  const portfolioChart = props.slice(0, 8).map((p: any) => ({
    name: (p.name ?? "Property").slice(0, 14),
    occupancy: p.totalUnits > 0 ? Math.round((Number(p.occupiedUnits ?? 0) / Number(p.totalUnits)) * 100) : 0,
  }));

  const occupancyRate = md.totalUnits > 0 ? Math.round((md.occupiedUnits / md.totalUnits) * 1000) / 10 : 0;

  const TILES = [
    {
      label: "Portfolio Value",
      value: portValKnown > 0 ? fmtM(portValKnown) : "—",
      sub: portValKnown > 0
        ? `${portValKnownCount} of ${props.length} properties have valuations`
        : "Add estimated values to properties",
      icon: Building, color: "bg-blue-500",
    },
    {
      label: "Monthly Revenue",
      value: fmtM(monthlyRev),
      sub: "Current month — paid payments only",
      icon: DollarSign, color: "bg-emerald-500",
    },
    {
      label: "Net ROI",
      value: netROI !== null ? fmtPct(netROI) : "—",
      sub: netROI !== null
        ? "Rental yield vs property valuations"
        : "Requires property valuations",
      icon: TrendingUp, color: "bg-violet-500",
    },
    {
      label: "Occupancy",
      value: fmtPct(occupancyRate),
      sub: `${md.occupiedUnits ?? 0} of ${md.totalUnits ?? 0} units occupied`,
      icon: Users, color: "bg-orange-500",
    },
  ];

  return (
    <ActivityTracker>
      <PageViewTracker page="senior-manager-dashboard" data={{ role: "senior_manager" }} />
      <FeatureAnnouncementCenter position="banner" userRole="admin" />

      <div className="min-h-screen bg-background">

        {/* Header */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-sm">
                <Crown className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground leading-tight">Senior Manager</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Welcome back, {user?.firstName || "Executive"} · {format(new Date(), "EEEE, d MMMM yyyy")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                riskLevel === "Low" ? "bg-emerald-500/10 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
                : riskLevel === "Medium" ? "bg-amber-500/10 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400"
                : "bg-red-500/10 border-red-200 dark:border-red-900 text-red-700 dark:text-red-400"
              }`}>
                <Shield className="w-3.5 h-3.5" />{riskLevel} Risk
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400">
                <CheckCircle className="w-3.5 h-3.5" />{complianceScore}% Compliance
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* 4 tiles */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
            {TILES.map(t => <Tile key={t.label} {...t} />)}
          </div>

          {/* Portfolio bar chart */}
          {portfolioChart.length > 0 && (
            <Section title="Occupancy by Property">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={portfolioChart} margin={{ top: 4, right: 4, left: -24, bottom: 4 }} barSize={24}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: "hsl(var(--muted))" }} />
                    <Bar dataKey="occupancy" radius={[4, 4, 0, 0]}>
                      {portfolioChart.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.occupancy >= 90 ? "#10b981" : entry.occupancy >= 70 ? "#f59e0b" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-5 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />≥ 90% Excellent</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />70–89% Good</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />&lt; 70% Needs attention</span>
              </div>
            </Section>
          )}

          {/* 2-col summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Portfolio breakdown */}
            <Section title="Portfolio Snapshot">
              <div className="space-y-3">
                {[
                  { label: "Total Properties",  value: String(props.length),                   sub: "Active portfolio" },
                  { label: "Total Units",        value: String(md.totalUnits ?? 0),             sub: `${md.occupiedUnits ?? 0} occupied` },
                  { label: "Pending Approvals", value: String(md.pendingRequests ?? 0),         sub: "Maintenance requests" },
                  { label: "Overdue Rent",       value: String(md.overdueRent ?? 0),            sub: "Tenants overdue" },
                  { label: "Portfolio Value",    value: portValKnown > 0 ? fmtM(portValKnown) : "—",  sub: portValKnown > 0 ? `${portValKnownCount}/${props.length} properties valued` : "Add valuations in property settings" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{row.label}</p>
                      <p className="text-xs text-muted-foreground">{row.sub}</p>
                    </div>
                    <p className="text-sm font-bold text-foreground tabular-nums">{row.value}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Risk & Compliance */}
            <Section title="Risk & Compliance">
              <div className="space-y-4">
                {/* Compliance bar */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-medium text-foreground">Compliance Score</p>
                    <p className="text-xs font-bold text-foreground">{complianceScore}%</p>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${complianceScore}%` }} />
                  </div>
                </div>
                {/* Occupancy bar */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-medium text-foreground">Occupancy Rate</p>
                    <p className="text-xs font-bold text-foreground">{occupancyRate}%</p>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${occupancyRate >= 90 ? "bg-emerald-500" : occupancyRate >= 70 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${occupancyRate}%` }} />
                  </div>
                </div>

                <div className="pt-2 space-y-2">
                  {[
                    { label: "Overall Risk Level", value: riskLevel, valueClass: riskColor },
                    { label: "Net ROI",             value: `${netROI}%`, valueClass: "text-foreground" },
                    { label: "Overdue Rent Cases",  value: String(md.overdueRent ?? 0), valueClass: md.overdueRent > 0 ? "text-red-600 dark:text-red-400" : "text-foreground" },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className={`text-xs font-semibold ${row.valueClass}`}>{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          </div>

        </div>
      </div>
    </ActivityTracker>
  );
}
