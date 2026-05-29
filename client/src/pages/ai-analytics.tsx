import { apiRequest, ensureArray } from "@/lib/queryClient";
import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";

import {
  Brain, AlertTriangle, Target, Lightbulb,
  DollarSign, Users, Wrench, Home, Zap,
  ArrowUpRight, ArrowDownRight, CheckCircle,
  TrendingUp, TrendingDown, Calendar, Clock,
  ShieldAlert, BarChart2, RefreshCw,
} from "lucide-react";

// ─── Colour palette ───────────────────────────────────────────────────────────
const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

const priorityColors: Record<string, string> = {
  low:      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  medium:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high:     "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

function groupCount<T>(arr: T[], key: (item: T) => string): { name: string; count: number }[] {
  const map: Record<string, number> = {};
  arr.forEach(item => {
    const k = key(item) || "Other";
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function paymentsByMonth(pays: any[]): { month: string; collected: number; overdue: number }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    const inMonth = pays.filter(p => {
      if (!p.createdAt) return false;
      const pd = new Date(p.createdAt);
      return pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth();
    });
    return {
      month: label,
      collected: inMonth.filter(p => ["paid", "completed"].includes(p.status)).reduce((s, p) => s + Number(p.amount ?? 0), 0),
      overdue:   inMonth.filter(p => p.status === "overdue").reduce((s, p) => s + Number(p.amount ?? 0), 0),
    };
  });
}

function maintByMonth(maint: any[]): { month: string; total: number; completed: number }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    const inMonth = maint.filter(r => {
      if (!r.createdAt) return false;
      const rd = new Date(r.createdAt);
      return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth();
    });
    return {
      month: label,
      total: inMonth.length,
      completed: inMonth.filter(r => r.status === "completed").length,
    };
  });
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({
  title, value, sub, icon: Icon, iconColor, bgColor, trend,
}: {
  title: string; value: string | number; sub: string;
  icon: React.ElementType; iconColor: string; bgColor: string;
  trend?: { direction: "up" | "down" | "neutral"; label: string };
}) {
  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bgColor}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${
              trend.direction === "up" ? "text-green-600" :
              trend.direction === "down" ? "text-red-500" : "text-muted-foreground"
            }`}>
              {trend.direction === "up"   && <ArrowUpRight   className="w-3.5 h-3.5" />}
              {trend.direction === "down" && <ArrowDownRight className="w-3.5 h-3.5" />}
              {trend.label}
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <Brain className="w-8 h-8 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIAnalytics() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState("insights");

  // Open Maintenance Requests pagination
  const [maintPage,     setMaintPage]     = useState(1);
  const [maintPageSize, setMaintPageSize] = useState(5);

  // ── Fetch from real endpoints ─────────────────────────────────────────────

  const { data: dashMetrics } = useQuery<any>({
    queryKey: ["/api/dashboard/metrics"],
    queryFn: async () => (await apiRequest("/api/dashboard/metrics")).json(),
    staleTime: 5 * 60 * 1000,
  });

  // Tenants API returns paginated { results, count } — request up to 200 to cover most portfolios
  const { data: tenantsRaw } = useQuery<any>({
    queryKey: ["/api/tenants", "limit200"],
    queryFn: async () => (await apiRequest("/api/tenants?limit=200")).json(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: paysRaw } = useQuery<any>({
    queryKey: ["/api/rent-payments"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/rent-payments")).json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: maintRaw } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: propsRaw } = useQuery<any>({
    queryKey: ["/api/properties"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: unitsRaw } = useQuery<any>({
    queryKey: ["/api/units"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/units")).json()),
    staleTime: 5 * 60 * 1000,
  });

  // ── Normalise: tenants come back as { results: [], count } ────────────────
  const tenants: any[] = useMemo(() =>
    Array.isArray(tenantsRaw) ? tenantsRaw : (tenantsRaw?.results ?? []),
    [tenantsRaw]);

  const pays:   any[] = Array.isArray(paysRaw)  ? paysRaw  : [];
  const maint:  any[] = Array.isArray(maintRaw) ? maintRaw : [];
  const props:  any[] = Array.isArray(propsRaw) ? propsRaw : [];
  const units_: any[] = Array.isArray(unitsRaw) ? unitsRaw : [];

  // ── Core metrics ──────────────────────────────────────────────────────────

  const totalUnits    = dashMetrics?.totalUnits    ?? units_.length;
  const occupiedUnits = dashMetrics?.occupiedUnits ?? units_.filter((u: any) => u.isOccupied).length;
  const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
  const activeTenants = tenants.filter(t => t.status === "active").length;

  const paidPays    = pays.filter(p => ["paid", "completed"].includes(p.status));
  const overduePays = pays.filter(p => p.status === "overdue");
  const pendingPays = pays.filter(p => p.status === "pending");

  const totalCollected = paidPays.reduce((s, p)    => s + Number(p.amount ?? 0), 0);
  const totalOverdue   = overduePays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const totalPending   = pendingPays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const latePaymentRate = pays.length > 0 ? Math.round((overduePays.length / pays.length) * 100) : 0;

  // Monthly rent roll from active tenants (using flat unitNumber returned by /api/tenants)
  const totalMonthlyRent = tenants
    .filter(t => t.status === "active")
    .reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);

  // Maintenance
  const openMaint      = maint.filter(r => !["completed", "cancelled"].includes(r.status));
  const completedMaint = maint.filter(r => r.status === "completed");
  const urgentMaint    = openMaint.filter(r => ["urgent", "emergency"].includes(r.priority));

  const avgResolutionDays = useMemo(() => {
    const resolved = maint.filter(r => r.status === "completed" && r.createdAt && r.updatedAt);
    if (!resolved.length) return 0;
    const totalMs = resolved.reduce((s, r) =>
      s + (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()), 0);
    return Math.round(totalMs / resolved.length / 86_400_000);
  }, [maint]);

  // Leases expiring within 60 days
  const expiringLeases = useMemo(() => {
    const cutoff = Date.now() + 60 * 86_400_000;
    return tenants.filter(t =>
      t.leaseEndDate &&
      new Date(t.leaseEndDate).getTime() <= cutoff &&
      new Date(t.leaseEndDate).getTime() >= Date.now()
    );
  }, [tenants]);

  // ── AI Insights ───────────────────────────────────────────────────────────

  const insights = useMemo(() => {
    const list: {
      id: string; type: string; title: string; description: string;
      confidence: number; impact: string; priority: string;
      category: string; dataPoints: number; recommendations: string[];
    }[] = [];

    if (totalUnits > 0) {
      list.push({
        id: "occ-1", type: "market_opportunity",
        title: `Occupancy at ${occupancyRate}%`,
        description: `${occupiedUnits} of ${totalUnits} units occupied. ${totalUnits - occupiedUnits} unit(s) currently vacant.`,
        confidence: 100,
        impact: occupancyRate < 80
          ? `${totalUnits - occupiedUnits} vacant unit(s) — ~${fmtKES((totalUnits - occupiedUnits) * (totalMonthlyRent / Math.max(activeTenants, 1)))} /mo potential`
          : "Strong occupancy",
        priority: occupancyRate < 70 ? "critical" : occupancyRate < 85 ? "high" : "low",
        category: "Occupancy",
        dataPoints: totalUnits,
        recommendations: occupancyRate < 80
          ? ["Review vacant unit pricing vs market rates", "Inspect vacant units for outstanding maintenance issues", "Consider short-term move-in incentives"]
          : ["Maintain current pricing strategy", "Monitor market rates quarterly"],
      });
    }

    if (pays.length > 0 && latePaymentRate > 0) {
      list.push({
        id: "pay-1", type: "tenant_retention",
        title: `${latePaymentRate}% late payment rate`,
        description: `${overduePays.length} of ${pays.length} payments overdue — ${fmtKES(totalOverdue)} at risk.`,
        confidence: 100,
        impact: `${fmtKES(totalOverdue)} outstanding`,
        priority: latePaymentRate > 25 ? "critical" : latePaymentRate > 15 ? "high" : "medium",
        category: "Payment Health",
        dataPoints: pays.length,
        recommendations: [
          "Send automated reminders 5 days before due date",
          "Follow up calls on accounts overdue >14 days",
          "Offer structured payment plans for long-overdue accounts",
        ],
      });
    }

    if (expiringLeases.length > 0) {
      list.push({
        id: "lease-1", type: "tenant_retention",
        title: `${expiringLeases.length} lease(s) expiring within 60 days`,
        description: expiringLeases.slice(0, 3)
          .map(t => `${t.firstName} ${t.lastName} (Unit ${t.unitNumber ?? "N/A"})`)
          .join(", ") + (expiringLeases.length > 3 ? ` +${expiringLeases.length - 3} more` : ""),
        confidence: 100,
        impact: `${fmtKES(expiringLeases.reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0))} /mo at risk`,
        priority: expiringLeases.length > 3 ? "high" : "medium",
        category: "Lease Management",
        dataPoints: expiringLeases.length,
        recommendations: [
          "Contact each expiring tenant now to discuss renewal",
          "Offer early-renewal incentive (e.g. 1 month free or waived deposit top-up)",
          "Prepare vacancy marketing for units unlikely to renew",
        ],
      });
    }

    if (urgentMaint.length > 0) {
      list.push({
        id: "urg-1", type: "maintenance_prediction",
        title: `${urgentMaint.length} urgent/emergency request(s) open`,
        description: urgentMaint.slice(0, 3)
          .map(r => r.title || r.description || `Request #${r.id}`)
          .join("; "),
        confidence: 100,
        impact: "Tenant satisfaction & liability risk",
        priority: "critical",
        category: "Urgent Maintenance",
        dataPoints: urgentMaint.length,
        recommendations: urgentMaint.slice(0, 3)
          .map(r => `Assign contractor for: ${r.title || r.description || "Request #" + r.id}`),
      });
    }

    if (avgResolutionDays > 0) {
      list.push({
        id: "maint-2", type: "maintenance_prediction",
        title: `Avg resolution time: ${avgResolutionDays} day(s)`,
        description: `Based on ${completedMaint.length} completed request(s). ${avgResolutionDays > 7 ? "Above the recommended 7-day SLA." : "Within SLA target."}`,
        confidence: 90,
        impact: avgResolutionDays > 7 ? "SLA breach risk" : "On track",
        priority: avgResolutionDays > 14 ? "high" : avgResolutionDays > 7 ? "medium" : "low",
        category: "Maintenance Efficiency",
        dataPoints: completedMaint.length,
        recommendations: avgResolutionDays > 7
          ? ["Pre-assign preferred contractors per category", "Auto-escalate requests pending >5 days"]
          : ["Keep current workflow"],
      });
    }

    return list;
  }, [
    occupancyRate, occupiedUnits, totalUnits, totalMonthlyRent, activeTenants,
    latePaymentRate, overduePays, totalOverdue, pays,
    expiringLeases, urgentMaint, avgResolutionDays, completedMaint,
  ]);

  // ── Chart data ────────────────────────────────────────────────────────────

  const paymentTrend    = useMemo(() => paymentsByMonth(pays), [pays]);
  const maintTrend      = useMemo(() => maintByMonth(maint), [maint]);
  const maintCategories = useMemo(() => groupCount(maint, r => r.category || "General").slice(0, 6), [maint]);
  const tenantStatus    = useMemo(() => groupCount(tenants, t => t.status || "unknown"), [tenants]);

  const paymentStatusData = useMemo(() => [
    { name: "Collected", value: totalCollected, fill: "#22c55e" },
    { name: "Pending",   value: totalPending,   fill: "#f59e0b" },
    { name: "Overdue",   value: totalOverdue,   fill: "#ef4444" },
  ].filter(d => d.value > 0), [totalCollected, totalPending, totalOverdue]);

  const propertyOccupancy = useMemo(() => props.map(p => {
    const pUnits = units_.filter(u => u.propertyId === p.id);
    const occ    = pUnits.filter(u => u.isOccupied).length;
    const rate   = pUnits.length > 0 ? Math.round((occ / pUnits.length) * 100) : 0;
    const activeTenantList = tenants.filter(t =>
      pUnits.some(u => u.id === t.unitId) && t.status === "active"
    );
    const monthlyRevenue = activeTenantList.reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);
    return {
      name: p.name,
      total: pUnits.length, occupied: occ,
      vacant: pUnits.length - occ, rate, monthlyRevenue,
    };
  }), [props, units_, tenants]);

  const rentBuckets = useMemo(() => {
    const b: Record<string, number> = { "< 10k": 0, "10–20k": 0, "20–35k": 0, "35–50k": 0, "> 50k": 0 };
    tenants.filter(t => t.status === "active").forEach(t => {
      const r = Number(t.monthlyRent ?? 0);
      if      (r < 10000) b["< 10k"]++;
      else if (r < 20000) b["10–20k"]++;
      else if (r < 35000) b["20–35k"]++;
      else if (r < 50000) b["35–50k"]++;
      else                b["> 50k"]++;
    });
    return Object.entries(b).map(([name, count]) => ({ name, count }));
  }, [tenants]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              AI Analytics Hub
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Intelligent insights derived from your live property data
            </p>
          </div>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400">
            <Zap className="h-3 w-3 mr-1" /> AI Active
          </Badge>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title="Monthly Rent Roll" value={fmtKES(totalMonthlyRent)} sub="Active tenants only"
            icon={DollarSign} iconColor="text-green-600" bgColor="bg-green-50 dark:bg-green-950"
            trend={{ direction: "neutral", label: `${activeTenants} tenants` }}
          />
          <KPICard
            title="Occupancy Rate" value={`${occupancyRate}%`} sub={`${occupiedUnits}/${totalUnits} units`}
            icon={Home} iconColor="text-blue-600" bgColor="bg-blue-50 dark:bg-blue-950"
            trend={occupancyRate >= 85
              ? { direction: "up",   label: "Healthy" }
              : { direction: "down", label: "Below target" }}
          />
          <KPICard
            title="Overdue Payments" value={overduePays.length} sub={fmtKES(totalOverdue) + " at risk"}
            icon={AlertTriangle} iconColor="text-orange-600" bgColor="bg-orange-50 dark:bg-orange-950"
            trend={overduePays.length > 0
              ? { direction: "down", label: `${latePaymentRate}% rate` }
              : { direction: "up",   label: "All clear" }}
          />
          <KPICard
            title="Active Insights" value={insights.length} sub={`${urgentMaint.length} urgent maintenance`}
            icon={Lightbulb} iconColor="text-purple-600" bgColor="bg-purple-50 dark:bg-purple-950"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 rounded-xl h-10">
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="predictions">Predictions</TabsTrigger>
            <TabsTrigger value="optimization">Optimization</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
          </TabsList>

          {/* ── AI INSIGHTS ──────────────────────────────────────────────── */}
          <TabsContent value="insights" className="space-y-4">
            {insights.length === 0 ? (
              <Card className="rounded-2xl border-border shadow-none">
                <CardContent className="py-8">
                  <Empty message="No insights yet — add properties, tenants and payments to get started" />
                </CardContent>
              </Card>
            ) : insights.map(ins => (
              <Card key={ins.id} className="rounded-2xl border-border shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        ins.type === "maintenance_prediction" ? "bg-amber-50 dark:bg-amber-950" :
                        ins.type === "tenant_retention"       ? "bg-purple-50 dark:bg-purple-950" :
                        "bg-blue-50 dark:bg-blue-950"
                      }`}>
                        {ins.type === "maintenance_prediction" ? <Wrench className="w-4 h-4 text-amber-600" /> :
                         ins.type === "tenant_retention"       ? <Users  className="w-4 h-4 text-purple-600" /> :
                                                                 <Target className="w-4 h-4 text-blue-600" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-sm text-foreground">{ins.title}</h4>
                          <Badge className={`text-[10px] px-1.5 py-0 ${priorityColors[ins.priority]}`}>
                            {ins.priority.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{ins.category}</p>
                        <p className="text-sm text-foreground/80 mt-1.5">{ins.description}</p>

                        {ins.recommendations.length > 0 && (
                          <div className="mt-3 space-y-1">
                            <p className="text-xs font-medium text-foreground">Recommendations:</p>
                            {ins.recommendations.map((rec, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <span className="w-1 h-1 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                                {rec}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Confidence</span><span>{ins.confidence}%</span>
                          </div>
                          <Progress value={ins.confidence} className="h-1.5" />
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-green-600">{ins.impact}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{ins.dataPoints} data pts</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ── PREDICTIONS ──────────────────────────────────────────────── */}
          {/* All predictions are rule-based computations on live data — no stubs */}
          <TabsContent value="predictions" className="space-y-6">

            {/* ── Method note ── */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800" >
              <BarChart2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                <strong>Rule-based predictions</strong> — derived entirely from your live portfolio data using statistical thresholds (industry benchmarks + patterns in your own history). No black-box models; every prediction links back to a specific data rule below.
              </p>
            </div>

            {/* ── 1. Maintenance Overdue Risk ── */}
            {(() => {
              // Rule: units with active tenants but ZERO maintenance requests in the last 12 months
              // are statistically overdue for something going wrong — HVAC, plumbing, paint.
              const twelveMonthsAgo = new Date(Date.now() - 365 * 86_400_000);
              const recentMaintUnitIds = new Set(
                maint
                  .filter(r => r.unitId && r.createdAt && new Date(r.createdAt) >= twelveMonthsAgo)
                  .map(r => r.unitId)
              );
              const dormantUnits = units_
                .filter(u => u.isOccupied && u.id && !recentMaintUnitIds.has(u.id))
                .map(u => {
                  const tenant = tenants.find(t => t.unitId === u.id && t.status === "active");
                  return { unit: u, tenant };
                })
                .filter(x => x.tenant);

              // confidence: 65% for 12+ months no maintenance (industry: avg 1.4 issues/unit/year)
              const confidence = Math.min(95, 65 + Math.floor(dormantUnits.length / 2) * 3);

              return (
                <Card className="rounded-2xl border-border shadow-none">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Wrench className="w-4 h-4 text-amber-600" />
                          Maintenance Overdue Risk
                        </CardTitle>
                        <CardDescription className="mt-0.5">
                          Units occupied {">"}12 months with no maintenance history — statistically overdue
                        </CardDescription>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className={`text-xs ${dormantUnits.length > 5 ? "bg-red-50 text-red-700 border-red-200" : dormantUnits.length > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                          {dormantUnits.length} units flagged
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Prediction confidence <span className="italic">(industry avg: 1.4 issues/unit/year)</span></span>
                      <span className="font-medium">{confidence}%</span>
                    </div>
                    <Progress value={confidence} className="h-1.5 mb-3" />

                    {dormantUnits.length === 0 ? (
                      <div className="flex items-center gap-2 text-green-600 py-3">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm">All occupied units have recent maintenance records</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground font-medium mb-2">
                          Units with no maintenance logged in the past 12 months:
                        </p>
                        {dormantUnits.slice(0, 6).map(({ unit, tenant }, i) => (
                          <div key={i} className="flex items-center justify-between py-2 px-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
                            <div>
                              <p className="text-sm font-medium">Unit {unit.unitNumber ?? unit.id} — {tenant!.firstName} {tenant!.lastName}</p>
                              <p className="text-xs text-muted-foreground">{fmtKES(Number(tenant!.monthlyRent ?? 0))}/mo</p>
                            </div>
                            <Badge variant="outline" className="text-xs bg-amber-100 text-amber-800 border-amber-300" >No maint. logged</Badge>
                          </div>
                        ))}
                        {dormantUnits.length > 6 && (
                          <p className="text-xs text-muted-foreground text-center pt-1">+{dormantUnits.length - 6} more units</p>
                        )}
                        <div className="pt-3 border-t space-y-1">
                          <p className="text-xs font-medium text-foreground">Recommended actions:</p>
                          <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0"/><span>Schedule routine inspections for all {dormantUnits.length} flagged units</span></div>
                          <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0"/><span>Check plumbing, HVAC filters, and paintwork as minimum</span></div>
                          <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0"/><span>Log findings to start building a maintenance history per unit</span></div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── 2. Vacancy Risk ── */}
              {(() => {
                const vacant = totalUnits - occupiedUnits;
                // Rule: units vacant >30 days have a higher cost than a short-term incentive
                // Monthly opportunity cost = avg rent per occupied unit × vacant count
                const avgRent = activeTenants > 0 ? totalMonthlyRent / activeTenants : 0;
                const opportunityCost = avgRent * vacant;
                const vacancyRiskLevel = expiringLeases.length + vacant;

                return (
                  <Card className="rounded-2xl border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Home className="w-4 h-4 text-orange-600" />
                        Vacancy Risk Forecast
                      </CardTitle>
                      <CardDescription>Leases expiring + currently vacant units</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/40 rounded-xl">
                          <p className="text-xl font-semibold text-orange-600">{expiringLeases.length}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Leases expiring &lt;60d</p>
                        </div>
                        <div className="text-center p-3 bg-red-50 dark:bg-red-950/40 rounded-xl">
                          <p className="text-xl font-semibold text-red-600">{vacant}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Currently vacant</p>
                        </div>
                        <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl">
                          <p className="text-xl font-semibold text-amber-600">{vacancyRiskLevel}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Total at-risk units</p>
                        </div>
                      </div>

                      {opportunityCost > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border">
                          <span className="text-xs text-muted-foreground">Monthly opportunity cost (vacant)</span>
                          <span className="text-sm font-bold text-red-600">{fmtKES(opportunityCost)}</span>
                        </div>
                      )}

                      {expiringLeases.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <p className="text-xs font-medium text-foreground">Expiring leases (next 60 days):</p>
                          {expiringLeases.slice(0, 4).map((t, i) => {
                            const daysLeft = Math.ceil((new Date(t.leaseEndDate).getTime() - Date.now()) / 86_400_000);
                            const urgentCls = daysLeft <= 14 ? "bg-red-50 dark:bg-red-950/40 border-red-200" : "bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200";
                            return (
                              <div key={i} className={`flex items-center justify-between py-2 px-3 rounded-lg border ${urgentCls}`}>
                                <div>
                                  <p className="text-sm font-medium">{t.firstName} {t.lastName}</p>
                                  <p className="text-xs text-muted-foreground">Unit {t.unitNumber ?? "N/A"} · {fmtKES(Number(t.monthlyRent ?? 0))}/mo</p>
                                </div>
                                <Badge variant="outline" className={`text-xs ${daysLeft <= 14 ? "bg-red-100 text-red-800 border-red-300" : "bg-yellow-100 text-yellow-800 border-yellow-300"}`}>
                                  {daysLeft}d left
                                </Badge>
                              </div>
                            );
                          })}
                          {expiringLeases.length > 4 && <p className="text-xs text-muted-foreground text-center">+{expiringLeases.length - 4} more</p>}
                        </div>
                      )}

                      {vacancyRiskLevel === 0 && (
                        <div className="flex items-center gap-2 text-green-600 py-2">
                          <CheckCircle className="w-4 h-4" /> <span className="text-sm">No vacancy risk in next 60 days</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {/* ── 3. Revenue Forecast ── */}
              {(() => {
                const collectionRate = pays.length > 0 ? (paidPays.length / pays.length) : 1;
                // Realistic next-month forecast = rent roll × historical collection rate
                const realisticNextMonth = totalMonthlyRent * collectionRate;
                // Risk-adjusted annual = losing expiring leases
                const atRiskMonthly = expiringLeases.reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);
                const conservativeQuarter = (realisticNextMonth * 3) - atRiskMonthly;

                return (
                  <Card className="rounded-2xl border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-green-600" />
                        Revenue Forecast
                      </CardTitle>
                      <CardDescription>Rate-adjusted projections from live payment history</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center p-3 bg-green-50 dark:bg-green-950/40 rounded-xl">
                          <div>
                            <span className="text-sm font-medium">Next month</span>
                            <p className="text-[10px] text-muted-foreground">Rent roll × {Math.round(collectionRate * 100)}% collection rate</p>
                          </div>
                          <span className="font-bold text-green-600">{fmtKES(realisticNextMonth)}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl">
                          <div>
                            <span className="text-sm font-medium">Next quarter (risk-adjusted)</span>
                            <p className="text-[10px] text-muted-foreground">Minus {fmtKES(atRiskMonthly)}/mo expiring leases</p>
                          </div>
                          <span className="font-bold text-blue-600">{fmtKES(Math.max(0, conservativeQuarter))}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-950/40 rounded-xl">
                          <div>
                            <span className="text-sm font-medium">Overdue (at risk)</span>
                            <p className="text-[10px] text-muted-foreground">{overduePays.length} overdue payment(s)</p>
                          </div>
                          <span className="font-bold text-red-500">{fmtKES(totalOverdue)}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground">Historical collection rate</span>
                          <span className="font-medium">{Math.round(collectionRate * 100)}%</span>
                        </div>
                        <Progress value={collectionRate * 100} className="h-2" />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Based on {pays.length} payment records · {paidPays.length} paid, {overduePays.length} overdue
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* ── 4. Chronic Late Payers ── */}
              {(() => {
                // Rule: tenants with ≥2 overdue payments in the last 6 months
                // are at high risk of arrears. Flag them for proactive contact.
                const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
                const recentPays   = pays.filter(p => p.createdAt && new Date(p.createdAt) >= sixMonthsAgo);
                const overdueCounts: Record<number, number> = {};
                recentPays.filter(p => p.status === "overdue").forEach(p => {
                  if (p.tenantId) overdueCounts[p.tenantId] = (overdueCounts[p.tenantId] || 0) + 1;
                });
                const chronicRisk = Object.entries(overdueCounts)
                  .filter(([, count]) => count >= 2)
                  .map(([tenantId, count]) => ({
                    tenant: tenants.find(t => t.id === parseInt(tenantId)),
                    overdueCount: count,
                  }))
                  .filter(x => x.tenant)
                  .sort((a, b) => b.overdueCount - a.overdueCount);

                return (
                  <Card className="rounded-2xl border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-red-600" />
                        Chronic Late Payer Risk
                      </CardTitle>
                      <CardDescription>Tenants with ≥2 overdue payments in the last 6 months</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {chronicRisk.length === 0 ? (
                        <div className="flex items-center gap-2 text-green-600 py-4">
                          <CheckCircle className="w-4 h-4" />
                          <span className="text-sm">No chronic late-payer patterns detected</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {chronicRisk.slice(0, 5).map(({ tenant, overdueCount }, i) => (
                            <div key={i} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800" >
                              <div>
                                <p className="text-sm font-medium">{tenant!.firstName} {tenant!.lastName}</p>
                                <p className="text-xs text-muted-foreground">Unit {tenant!.unitNumber ?? "N/A"} · {fmtKES(Number(tenant!.monthlyRent ?? 0))}/mo</p>
                              </div>
                              <Badge className="text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                {overdueCount}× overdue
                              </Badge>
                            </div>
                          ))}
                          <div className="pt-3 border-t space-y-1">
                            <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0"/><span>Issue formal payment-plan agreements to reduce default risk</span></div>
                            <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0"/><span>Review for M-Pesa standing order setup on next lease renewal</span></div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

              {/* ── 5. Maintenance Resolution SLA ── */}
              {(() => {
                // Rule: Kenya PM industry benchmark is 7-day resolution for routine, 24h for emergency.
                // Compute per-category averages to find systemic bottlenecks.
                const resolvedWithTimes = maint.filter(r =>
                  r.status === "completed" && r.createdAt && r.updatedAt
                );
                const catTimes: Record<string, number[]> = {};
                resolvedWithTimes.forEach(r => {
                  const cat  = r.category || "General";
                  const days = (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000;
                  if (!catTimes[cat]) catTimes[cat] = [];
                  catTimes[cat].push(days);
                });
                const catAvgs = Object.entries(catTimes)
                  .map(([cat, times]) => ({ cat, avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                  .sort((a, b) => b.avg - a.avg)
                  .slice(0, 5);

                const overallSlaBreaches = resolvedWithTimes.filter(r => {
                  const days = (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000;
                  return r.priority === "emergency" ? days > 1 : days > 7;
                }).length;

                const slaBreachRate = resolvedWithTimes.length > 0
                  ? Math.round((overallSlaBreaches / resolvedWithTimes.length) * 100)
                  : 0;

                return (
                  <Card className="rounded-2xl border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="w-4 h-4 text-purple-600" />
                        Maintenance SLA Analysis
                      </CardTitle>
                      <CardDescription>
                        Resolution time by category · Benchmark: 7d routine, 24h emergency
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {resolvedWithTimes.length < 3 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Need at least 3 resolved requests to compute SLA patterns</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div className={`text-center p-3 rounded-xl ${slaBreachRate > 30 ? "bg-red-50 dark:bg-red-950/30" : "bg-green-50 dark:bg-green-950/30"}`}>
                              <p className={`text-2xl font-bold ${slaBreachRate > 30 ? "text-red-600" : "text-green-600"}`}>{slaBreachRate}%</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">SLA breach rate</p>
                            </div>
                            <div className="text-center p-3 bg-muted/50 rounded-xl">
                              <p className="text-2xl font-semibold text-foreground">{avgResolutionDays}d</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Portfolio avg resolution</p>
                            </div>
                          </div>

                          {catAvgs.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-foreground">Slowest categories (avg days to resolve):</p>
                              {catAvgs.map(({ cat, avg, count }) => (
                                <div key={cat} className="flex items-center gap-3">
                                  <span className="text-xs text-muted-foreground w-28 truncate">{cat}</span>
                                  <div className="flex-1">
                                    <Progress value={Math.min(100, (avg / 14) * 100)} className={`h-1.5 ${avg > 7 ? "[&>div]:bg-red-500" : "[&>div]:bg-green-500"}`} />
                                  </div>
                                  <span className={`text-xs font-medium w-10 text-right ${avg > 7 ? "text-red-600" : "text-green-600"}`}>{avg}d</span>
                                  <span className="text-[10px] text-muted-foreground w-10">({count})</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}
            </div>

            {/* ── 6. Portfolio Health Score ── */}
            {(() => {
              // Composite score from 5 dimensions, each 0-100, weighted
              const scores = {
                occupancy:   occupancyRate,                                                                   // 25%
                payment:     pays.length > 0 ? Math.round((paidPays.length / pays.length) * 100) : 100,     // 25%
                maintenance: openMaint.length === 0 ? 100 : Math.max(0, 100 - (urgentMaint.length * 20) - (openMaint.length * 3)), // 25%
                retention:   expiringLeases.length === 0 ? 100 : Math.max(0, 100 - (expiringLeases.length * 10)),                  // 15%
                growth:      totalUnits > 0 ? Math.min(100, (activeTenants / totalUnits) * 100) : 0,         // 10%
              };
              const weights = { occupancy: 0.25, payment: 0.25, maintenance: 0.25, retention: 0.15, growth: 0.10 };
              const overall = Math.round(
                scores.occupancy   * weights.occupancy   +
                scores.payment     * weights.payment     +
                scores.maintenance * weights.maintenance +
                scores.retention   * weights.retention   +
                scores.growth      * weights.growth
              );
              const grade  = overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : "D";
              const gradeColor = overall >= 85 ? "text-green-600" : overall >= 70 ? "text-blue-600" : overall >= 55 ? "text-amber-600" : "text-red-600";
              const gradeBg    = overall >= 85 ? "bg-green-50 dark:bg-green-950/30" : overall >= 70 ? "bg-blue-50 dark:bg-blue-950/30" : overall >= 55 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-red-50 dark:bg-red-950/30";

              const dimensionLabels = [
                { key: "occupancy",   label: "Occupancy",          desc: `${occupiedUnits}/${totalUnits} units filled` },
                { key: "payment",     label: "Payment Health",      desc: `${pays.length > 0 ? Math.round((paidPays.length / pays.length) * 100) : 100}% collection rate` },
                { key: "maintenance", label: "Maintenance Status",  desc: `${openMaint.length} open, ${urgentMaint.length} urgent` },
                { key: "retention",   label: "Lease Retention",     desc: `${expiringLeases.length} expiring <60d` },
                { key: "growth",      label: "Portfolio Utilisation",desc: `${activeTenants} active tenants` },
              ] as const;

              return (
                <Card className="rounded-2xl border-border shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="w-4 h-4 text-indigo-600" />
                      Portfolio Health Score
                    </CardTitle>
                    <CardDescription>Weighted composite across 5 operational dimensions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 mb-5">
                      <div className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center shrink-0 ${gradeBg}`}>
                        <span className={`text-3xl font-black ${gradeColor}`}>{grade}</span>
                        <span className="text-[10px] text-muted-foreground">{overall}/100</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground">Overall score</span>
                          <span className={`font-bold ${gradeColor}`}>{overall}%</span>
                        </div>
                        <Progress value={overall} className={`h-2.5 ${overall >= 85 ? "[&>div]:bg-green-500" : overall >= 70 ? "[&>div]:bg-blue-500" : overall >= 55 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500"}`} />
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          {overall >= 85 ? "Excellent — top-quartile portfolio performance" :
                           overall >= 70 ? "Good — above average, some areas to improve" :
                           overall >= 55 ? "Fair — meaningful improvements available" :
                                          "Needs attention — multiple operational issues"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {dimensionLabels.map(({ key, label, desc }) => {
                        const score = scores[key];
                        const scoreCls = score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-red-600";
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                            <div className="flex-1">
                              <Progress value={score} className={`h-1.5 ${score >= 80 ? "[&>div]:bg-green-500" : score >= 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500"}`} />
                            </div>
                            <span className={`text-xs font-medium w-8 text-right ${scoreCls}`}>{score}</span>
                            <span className="text-[10px] text-muted-foreground w-40 hidden lg:block">{desc}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

          </TabsContent>

          {/* ── OPTIMIZATION ─────────────────────────────────────────────── */}
          <TabsContent value="optimization" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Property Performance</CardTitle>
                  <CardDescription>Occupancy and revenue per property</CardDescription>
                </CardHeader>
                <CardContent>
                  {propertyOccupancy.length === 0 ? (
                    <Empty message="No properties found" />
                  ) : (
                    <div className="space-y-4">
                      {propertyOccupancy.map((p, i) => (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium truncate max-w-[55%]">{p.name}</span>
                            <span className="text-muted-foreground text-xs">
                              {p.occupied}/{p.total} units · {fmtKES(p.monthlyRevenue)}/mo
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress value={p.rate} className="h-2 flex-1" />
                            <span className={`text-xs font-medium w-8 text-right ${
                              p.rate >= 85 ? "text-green-600" :
                              p.rate >= 60 ? "text-amber-600" : "text-red-500"
                            }`}>{p.rate}%</span>
                          </div>
                          {p.vacant > 0 && (
                            <p className="text-xs text-amber-600">{p.vacant} vacant unit(s)</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Rent Distribution</CardTitle>
                  <CardDescription>Monthly rent bands across active tenants</CardDescription>
                </CardHeader>
                <CardContent>
                  {tenants.length === 0 ? (
                    <Empty message="No tenant data available" />
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={rentBuckets} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: any) => [`${v} tenants`, "Count"]} />
                        <Bar dataKey="count" name="Tenants" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Churn risk list */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tenant Churn Risk</CardTitle>
                <CardDescription>Tenants with overdue payments or expiring leases</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const overduetenants = tenants.filter(t =>
                    pays.some(p => p.tenantId === t.id && p.status === "overdue")
                  );
                  const allAtRisk = [
                    ...expiringLeases.map(t => ({ ...t, risk: "Expiring lease" })),
                    ...overduetenants
                      .filter(t => !expiringLeases.some(e => e.id === t.id))
                      .map(t => ({ ...t, risk: "Overdue payment" })),
                  ];
                  return allAtRisk.length === 0 ? (
                    <div className="flex items-center gap-2 text-green-600 py-4">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">No high-risk tenants identified</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allAtRisk.slice(0, 8).map((t, i) => (
                        <div key={i} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium">{t.firstName} {t.lastName}</p>
                            <p className="text-xs text-muted-foreground">
                              Unit {t.unitNumber ?? "N/A"} · {fmtKES(Number(t.monthlyRent ?? 0))}/mo
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300">
                            {t.risk}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TRENDS ───────────────────────────────────────────────────── */}
          <TabsContent value="trends" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Payment Trend (6 months)</CardTitle>
                  <CardDescription>Collected vs overdue per month</CardDescription>
                </CardHeader>
                <CardContent>
                  {pays.length === 0 ? <Empty message="No payment data yet" /> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={paymentTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="cGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="oGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: any) => [fmtKES(v), ""]} />
                        <Legend />
                        <Area type="monotone" dataKey="collected" name="Collected" stroke="#22c55e" fill="url(#cGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="overdue"   name="Overdue"   stroke="#ef4444" fill="url(#oGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Maintenance Trend (6 months)</CardTitle>
                  <CardDescription>Requests raised vs completed per month</CardDescription>
                </CardHeader>
                <CardContent>
                  {maint.length === 0 ? <Empty message="No maintenance data yet" /> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={maintTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="total"     name="Raised"    stroke="#f59e0b" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Maintenance by Category</CardTitle>
                  <CardDescription>All-time volume breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  {maintCategories.length === 0 ? <Empty message="No maintenance data yet" /> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={maintCategories} layout="vertical" margin={{ top: 5, right: 20, left: 50, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip />
                        <Bar dataKey="count" name="Requests" fill="#6366f1" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Payment Status Breakdown</CardTitle>
                  <CardDescription>Collected · Pending · Overdue (KES)</CardDescription>
                </CardHeader>
                <CardContent>
                  {paymentStatusData.length === 0 ? <Empty message="No payment data yet" /> : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="50%" height={180}>
                        <PieChart>
                          <Pie data={paymentStatusData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                            {paymentStatusData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: any) => [fmtKES(v), ""]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-3 flex-1">
                        {paymentStatusData.map((d, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.fill }} />
                              <span className="text-sm">{d.name}</span>
                            </div>
                            <span className="text-sm font-medium">{fmtKES(d.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Tenant status summary */}
            {tenantStatus.length > 0 && (
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Tenant Status Summary</CardTitle>
                  <CardDescription>All tenants grouped by status</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {tenantStatus.map((s, i) => (
                      <div key={i} className="text-center p-3 bg-muted/50 rounded-xl">
                        <p className="text-2xl font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                          {s.count}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize mt-0.5">{s.name}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}