/**
 * dashboard-clean.tsx — SmartProp main dashboard
 * Redesigned: clean command-centre aesthetic, generous whitespace,
 * disciplined 3-column grid, no clutter.
 */

import { useState, useMemo, useEffect } from "react";
import { MpesaStatusAlert } from "@/components/MpesaStatusAlert";
import { FirstRunOverlay, needsFirstRun, markFirstRunDone } from "@/components/first-run-overlay";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Home, Users, DollarSign, Wrench, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, Clock, Building2,
  BarChart3, ChevronRight, Calendar, Activity, Bell, Plus,
  ArrowUpRight, ArrowRight,
} from "lucide-react";
import { formatDistanceToNow, format, addDays, isAfter, isBefore } from "date-fns";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtKES = (n: number) =>
  n >= 1_000_000 ? `KES ${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `KES ${(n / 1_000).toFixed(0)}K`
  :                `KES ${Math.round(n).toLocaleString("en-KE")}`;

function timeAgo(d?: string) {
  if (!d) return "—";
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return "—"; }
}

function greet(name?: string) {
  const h = new Date().getHours();
  const t = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return name ? `${t}, ${name.split(" ")[0]}` : t;
}

// ── Skeleton exports ──────────────────────────────────────────────────────────

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} style={style} />;
}

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-6 py-4 bg-card">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Skeleton className="w-52 h-6 rounded" />
          <Skeleton className="w-32 h-8 rounded-lg" />
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}

export function KpiCardSkeleton() {
  return <Skeleton className="h-28 rounded-2xl" />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex justify-between">
        <Skeleton className="w-32 h-4 rounded" />
        <Skeleton className="w-20 h-7 rounded-lg" />
      </div>
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="px-5 py-3.5 border-b border-border last:border-0 flex gap-4">
          <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
          <Skeleton className="w-16 h-5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function PropertyCardSkeleton() {
  return <Skeleton className="h-48 rounded-2xl" />;
}

export function ListItemSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-3">
          <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
          <Skeleton className="w-16 h-5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, detail, icon: Icon, accent, trend, onClick, sparkData, sparkColor,
}: {
  label: string; value: string; detail: string;
  icon: any; accent: string;
  trend?: { label: string; positive: boolean } | null;
  onClick?: () => void;
  sparkData?: number[];
  sparkColor?: string;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`group relative bg-card border border-border rounded-2xl p-5 text-left w-full overflow-hidden transition-all duration-200 ${onClick ? "hover:border-emerald-300 hover:shadow-md cursor-pointer" : ""}`}
    >
      {/* accent strip */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accent} rounded-t-2xl`} />

      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent.replace("-500", "-500/10")} dark:bg-opacity-20`}>
          <Icon className={`w-4.5 h-4.5 ${accent.replace("bg-", "text-")}`} />
        </div>
        {trend && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
            trend.positive ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}>
            {trend.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend.label}
          </span>
        )}
      </div>

      <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums leading-none">{value}</p>
      <p className="text-xs text-muted-foreground mt-1.5">{detail}</p>

      <div className="flex items-end justify-between mt-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
        <div className="flex items-end gap-2">
          {sparkData && sparkData.length > 1 && (
            <Sparkline data={sparkData} color={sparkColor ?? "#10b981"} />
          )}
          {onClick && (
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mb-0.5" />
          )}
        </div>
      </div>
    </Wrapper>
  );
}

// ── Occupancy ring ────────────────────────────────────────────────────────────

function OccupancyRing({ pct }: { pct: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const color = pct >= 90 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="96" height="96" className="mx-auto -mt-1">
      <circle cx="48" cy="48" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x="48" y="52" textAnchor="middle" fontSize="18" fontWeight="800" fill={color} fontFamily="system-ui">
        {pct}%
      </text>
    </svg>
  );
}

// ── Panel card ────────────────────────────────────────────────────────────────

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#10b981", height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={height} className="opacity-60">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Panel({
  title, subtitle, linkLabel, onLink, children, className = "",
}: {
  title: string; subtitle?: string; linkLabel?: string; onLink?: () => void;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card border border-border rounded-2xl flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {linkLabel && onLink && (
          <button onClick={onLink} className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors">
            {linkLabel} <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AV_COLORS = [
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
];
function Av({ name }: { name: string }) {
  const cls = AV_COLORS[name.charCodeAt(0) % AV_COLORS.length];
  const parts = name.trim().split(" ");
  const init = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return (
    <div className={`w-8 h-8 ${cls} rounded-full flex items-center justify-center font-semibold text-xs flex-shrink-0`}>
      {init || "?"}
    </div>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border shadow-xl rounded-xl px-4 py-3 text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-medium text-foreground ml-auto pl-3">{fmtKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function Empty({ icon: Icon, title, desc, cta }: { icon: any; title: string; desc: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-2 space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
        <Icon className="w-5 h-5 text-muted-foreground opacity-50" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-40 leading-relaxed">{desc}</p>
      </div>
      {cta && (
        <button onClick={cta.onClick} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" /> {cta.label}
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main dashboard
// ══════════════════════════════════════════════════════════════════════════════

export default function DashboardClean() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;

  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showFirstRun, setShowFirstRun] = useState(false);

  useEffect(() => {
    if (user?.id && needsFirstRun(user.id)) {
      const t = setTimeout(() => setShowFirstRun(true), 800);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  const fetchArr = (url: string) => apiRequest(url).then(r => r.json()).then(d => ensureArray(d));

  const { data: properties = [], isLoading: propLoad } = useQuery({ queryKey: ["/api/properties"], queryFn: () => fetchArr("/api/properties") });
  const { data: tenants    = [], isLoading: tenLoad  } = useQuery({ queryKey: ["/api/tenants"],    queryFn: () => fetchArr("/api/tenants") });
  const { data: payments   = [], isLoading: pmtLoad  } = useQuery({ queryKey: ["/api/rent-payments"],     queryFn: () => fetchArr("/api/rent-payments") });
  const { data: maintenance = [], isLoading: maintLoad } = useQuery({ queryKey: ["/api/maintenance"],      queryFn: () => fetchArr("/api/maintenance-requests") });
  const { data: expenses   = [] } = useQuery({ queryKey: ["/api/property-expenses"], queryFn: () => fetchArr("/api/property-expenses") });

  const isLoading = propLoad || tenLoad || pmtLoad || maintLoad;

  const m = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30 = addDays(now, 30);

    const totalUnits    = properties.reduce((s, p: any) => s + Number(p.totalUnits    ?? 0), 0);
    const occupiedUnits = properties.reduce((s, p: any) => s + Number(p.occupiedUnits ?? 0), 0);
    const occupancyPct  = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
    const activeTenants  = tenants.filter((t: any) => t.status === "active").length;
    const pendingTenants = tenants.filter((t: any) => t.status === "pending").length;
    const expiringLeases = tenants.filter((t: any) => {
      if (!t.leaseEndDate) return false;
      const end = new Date(t.leaseEndDate);
      return isAfter(end, now) && isBefore(end, in30);
    });

    const paidThisMonth   = payments.filter((p: any) => (p.status === "paid" || p.status === "completed") && new Date(p.paidDate ?? p.dueDate ?? p.createdAt ?? 0) >= monthStart);
    const overduePayments = payments.filter((p: any) => p.status === "overdue");
    const pendingPayments = payments.filter((p: any) => p.status === "pending");
    const revenueThisMonth = paidThisMonth.reduce((s, p: any) => s + Number(p.amount ?? 0), 0);
    const overdueAmount    = overduePayments.reduce((s, p: any) => s + Number(p.amount ?? 0), 0);
    const pendingAmount    = pendingPayments.reduce((s, p: any) => s + Number(p.amount ?? 0), 0);
    const monthExpenses    = expenses.filter((e: any) => new Date(e.date ?? e.createdAt ?? 0) >= monthStart).reduce((s, e: any) => s + Number(e.amount ?? 0), 0);
    const netIncome        = revenueThisMonth - monthExpenses;

    const openMaint   = maintenance.filter((m: any) => !["completed","cancelled"].includes(m.status));
    const urgentMaint = openMaint.filter((m: any) => ["urgent","critical"].includes(m.priority ?? ""));

    const chartMonths = Array.from({ length: 6 }, (_, i) => {
      const d   = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const income  = payments.filter((p: any) => (p.status === "paid" || p.status === "completed") && new Date(p.paidDate ?? p.dueDate ?? p.createdAt ?? 0) >= d && new Date(p.paidDate ?? p.dueDate ?? p.createdAt ?? 0) <= end).reduce((s, p: any) => s + Number(p.amount ?? 0), 0);
      const expense = expenses.filter((e: any) => { const ed = new Date(e.date ?? e.createdAt ?? 0); return ed >= d && ed <= end; }).reduce((s, e: any) => s + Number(e.amount ?? 0), 0);
      return { month: d.toLocaleString("default", { month: "short" }), income, expense };
    });

    const recentPayments = [...payments].filter((p: any) => p.status === "paid" || p.status === "completed").sort((a: any, b: any) => new Date(b.paidDate ?? b.createdAt ?? 0).getTime() - new Date(a.paidDate ?? a.createdAt ?? 0).getTime()).slice(0, 5);
    const recentMaint    = [...openMaint].sort((a: any, b: any) => { const ord: Record<string,number> = { urgent: 0, critical: 0, high: 1, medium: 2, low: 3 }; return (ord[a.priority] ?? 4) - (ord[b.priority] ?? 4); }).slice(0, 4);
    const topProperties  = [...properties].sort((a: any, b: any) => (b.totalUnits ?? 0) - (a.totalUnits ?? 0)).slice(0, 4);

    return {
      totalProperties: properties.length, totalUnits, occupiedUnits, occupancyPct,
      activeTenants, pendingTenants, expiringLeases,
      revenueThisMonth, overdueAmount, pendingAmount, netIncome,
      overdueCount: overduePayments.length,
      openMaint: openMaint.length, urgentMaint: urgentMaint.length,
      completedMTD: maintenance.filter((m: any) => m.status === "completed" && new Date(m.updatedAt ?? m.createdAt ?? 0) >= monthStart).length,
      chartMonths, recentPayments, recentMaint, topProperties,
    };
  }, [properties, tenants, payments, maintenance, expenses]);

  if (isLoading) return <DashboardSkeleton />;

  const PRIORITY_DOT: Record<string, string> = { urgent: "bg-red-500", critical: "bg-red-600", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-muted-foreground" };

  return (
    <div className="min-h-screen bg-background">

      {showFirstRun && (
        <FirstRunOverlay
          userId={user?.id ?? "unknown"}
          role={user?.role === "admin" ? "admin" : "manager"}
          firstName={user?.firstName ?? ""}
          hasProperties={m.totalProperties > 0}
          onDismiss={() => { markFirstRunDone(user?.id ?? "unknown"); setShowFirstRun(false); }}
        />
      )}

      {/* ── Header ── */}
      <header className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground leading-none">{greet(user?.firstName ?? undefined)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />{format(new Date(), "EEEE, d MMMM yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {m.urgentMaint > 0 && (
              <button onClick={() => navigate("/maintenance")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors">
                <AlertTriangle className="w-3.5 h-3.5" />{m.urgentMaint} urgent
              </button>
            )}
            {m.expiringLeases.length > 0 && (
              <button onClick={() => navigate("/tenants")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-900 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors">
                <Bell className="w-3.5 h-3.5" />{m.expiringLeases.length} expiring
              </button>
            )}
            <button onClick={() => navigate("/reports")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium hover:opacity-90 transition-opacity">
              <BarChart3 className="w-3.5 h-3.5" />Reports
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Setup banner */}
        {m.totalProperties === 0 && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-500/5 px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">Finish setting up your account</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add a property, import tenants, and send your first rent reminder — takes about 5 minutes.</p>
              </div>
            </div>
            <button onClick={() => navigate("/quick-setup")} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors flex-shrink-0 shadow-sm">
              Continue setup <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <MpesaStatusAlert />

        {/* ── 4 metric cards ── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            label="Properties"
            value={String(m.totalProperties)}
            detail={`${m.totalUnits} units · ${m.occupancyPct}% occupied`}
            icon={Building2} accent="bg-blue-500"
            trend={m.totalProperties > 0 ? { label: `${m.occupancyPct}% occ.`, positive: m.occupancyPct >= 70 } : null}
            onClick={() => navigate("/properties")}
            sparkData={m.chartMonths.map(d => d.income / Math.max(m.totalProperties, 1))}
            sparkColor="#3b82f6"
          />
          <MetricCard
            label="Active Tenants"
            value={String(m.activeTenants)}
            detail={`${m.pendingTenants} pending · ${m.expiringLeases.length} expiring soon`}
            icon={Users} accent="bg-emerald-500"
            trend={null}
            onClick={() => navigate("/tenants")}
            sparkData={m.chartMonths.map((_, i) => m.activeTenants - i * 0.3)}
            sparkColor="#10b981"
          />
          <MetricCard
            label="Revenue MTD"
            value={fmtKES(m.revenueThisMonth)}
            detail={`Net ${fmtKES(m.netIncome)} · ${m.overdueCount} overdue`}
            icon={DollarSign}
            accent={m.overdueCount > 0 ? "bg-red-500" : "bg-emerald-500"}
            trend={m.revenueThisMonth > 0 ? { label: `${m.overdueCount} overdue`, positive: m.overdueCount === 0 } : null}
            onClick={() => navigate("/finances")}
            sparkData={m.chartMonths.map(d => d.income)}
            sparkColor={m.overdueCount > 0 ? "#ef4444" : "#10b981"}
          />
          <MetricCard
            label="Maintenance"
            value={String(m.openMaint)}
            detail={`${m.urgentMaint} urgent · ${m.completedMTD} done MTD`}
            icon={Wrench}
            accent={m.urgentMaint > 0 ? "bg-red-500" : "bg-orange-500"}
            trend={m.urgentMaint > 0 ? { label: `${m.urgentMaint} urgent`, positive: false } : null}
            onClick={() => navigate("/maintenance")}
            sparkData={m.chartMonths.map(d => d.expense * 0.3)}
            sparkColor={m.urgentMaint > 0 ? "#ef4444" : "#f97316"}
          />
        </div>

        {/* ── Chart + Occupancy ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <Panel title="Revenue vs Expenses" subtitle="Last 6 months" linkLabel="Finances" onLink={() => navigate("/finances")} className="lg:col-span-2">
            {m.chartMonths.every(d => d.income === 0 && d.expense === 0) ? (
              <Empty icon={BarChart3} title="No financial data yet" desc="Revenue and expense charts appear once you record payments." />
            ) : (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={m.chartMonths} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#10b981" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gExpense" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                      <Tooltip content={<ChartTip />} />
                      <Area type="monotone" dataKey="income"  stroke="#10b981" strokeWidth={2} fill="url(#gIncome)"  dot={false} name="Revenue"  />
                      <Area type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} fill="url(#gExpense)" dot={false} name="Expenses" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded-full" />Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-400 inline-block rounded-full" />Expenses</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-5">
                  {[
                    { label: "Collected", val: m.revenueThisMonth, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/8 dark:bg-emerald-500/15" },
                    { label: "Overdue",   val: m.overdueAmount,    color: "text-red-600 dark:text-red-400",       bg: "bg-red-500/8 dark:bg-red-500/15"         },
                    { label: "Pending",   val: m.pendingAmount,    color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-500/8 dark:bg-amber-500/15"     },
                  ].map(({ label, val, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl px-3 py-3 text-center`}>
                      <p className={`text-sm font-bold ${color} leading-tight`}>{fmtKES(val)}</p>
                      <p className={`text-xs mt-1 ${color} opacity-70`}>{label}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel title="Occupancy" subtitle={`${m.totalUnits} units across ${m.totalProperties} properties`}>
            {m.totalUnits === 0 ? (
              <Empty icon={Home} title="No units yet" desc="Add properties and units to see occupancy." cta={{ label: "Add property", onClick: () => navigate("/properties") }} />
            ) : (
              <div className="space-y-5">
                <OccupancyRing pct={m.occupancyPct} />
                <div className="space-y-1.5">
                  {m.topProperties.map((prop: any) => {
                    const occ   = Number(prop.occupiedUnits ?? 0);
                    const tot   = Number(prop.totalUnits ?? 0);
                    const pct   = tot > 0 ? Math.round((occ / tot) * 100) : 0;
                    return (
                      <button key={prop.id} onClick={() => navigate(`/properties/${prop.id}`)} className="w-full flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors text-left">
                        <span className="text-xs text-muted-foreground flex-1 truncate">{prop.name}</span>
                        <div className="w-16 bg-muted rounded-full h-1.5 flex-shrink-0">
                          <div className={`h-1.5 rounded-full transition-all duration-700 ${pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground w-8 text-right tabular-nums">{pct}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Panel>
        </div>

        {/* ── Bottom 3-col row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent payments */}
          <Panel title="Recent Payments" linkLabel="All payments" onLink={() => navigate("/rent-collection")}>
            {m.recentPayments.length === 0 ? (
              <Empty icon={DollarSign} title="No payments yet" desc="Confirmed payments will appear here." />
            ) : (
              <div className="space-y-1">
                {m.recentPayments.map((p: any) => {
                  const name = p.tenant ? `${p.tenant.firstName ?? ""} ${p.tenant.lastName ?? ""}`.trim() : "Tenant";
                  return (
                    <button key={p.id} onClick={() => navigate("/rent-collection")} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-muted transition-colors text-left">
                      <Av name={name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(p.paidDate ?? p.createdAt)}</p>
                      </div>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">+{fmtKES(Number(p.amount ?? 0))}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Open maintenance */}
          <Panel title="Open Requests" subtitle={`${m.openMaint} open · ${m.urgentMaint} urgent`} linkLabel="All requests" onLink={() => navigate("/maintenance")}>
            {m.recentMaint.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center space-y-2">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-foreground">All clear!</p>
                <p className="text-xs text-muted-foreground">No open requests right now</p>
              </div>
            ) : (
              <div className="space-y-1">
                {m.recentMaint.map((req: any) => (
                  <button key={req.id} onClick={() => navigate("/maintenance")} className="w-full flex items-start gap-3 p-2 rounded-xl hover:bg-muted transition-colors text-left">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[req.priority] ?? "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{req.title}</p>
                      <p className="text-xs text-muted-foreground">{req.property?.name ?? "—"} · {timeAgo(req.createdAt)}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize flex-shrink-0 ${
                      req.priority === "urgent" || req.priority === "critical" ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : req.priority === "high" ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                      : "bg-muted text-muted-foreground"
                    }`}>{req.priority}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* Tenants snapshot */}
          <Panel title="Tenants" linkLabel="All tenants" onLink={() => navigate("/tenants")}>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { label: "Active",   value: m.activeTenants,        color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/8 dark:bg-emerald-500/15" },
                { label: "Pending",  value: m.pendingTenants,       color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/8 dark:bg-amber-500/15"     },
                { label: "Expiring", value: m.expiringLeases.length, color: "text-red-600 dark:text-red-400",        bg: "bg-red-500/8 dark:bg-red-500/15"         },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`${bg} rounded-xl py-3 text-center`}>
                  <p className={`text-xl font-bold ${color} leading-none`}>{value}</p>
                  <p className={`text-[11px] mt-1 ${color} opacity-70`}>{label}</p>
                </div>
              ))}
            </div>

            {m.expiringLeases.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Expiring in 30 days</p>
                {m.expiringLeases.slice(0, 3).map((t: any) => (
                  <button key={t.id} onClick={() => navigate(`/tenants/${t.id}`)} className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted transition-colors text-left">
                    <Av name={`${t.firstName ?? ""} ${t.lastName ?? ""}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{t.firstName} {t.lastName}</p>
                      <p className="text-xs text-muted-foreground">Expires {t.leaseEndDate ? format(new Date(t.leaseEndDate), "dd MMM") : "—"}</p>
                    </div>
                    <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  </button>
                ))}
                {m.expiringLeases.length > 3 && <p className="text-xs text-muted-foreground px-2">+{m.expiringLeases.length - 3} more</p>}
              </div>
            ) : tenants.length > 0 ? (
              <div className="space-y-1">
                {(tenants as any[]).slice(0, 3).map(t => (
                  <button key={t.id} onClick={() => navigate(`/tenants/${t.id}`)} className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted transition-colors text-left">
                    <Av name={`${t.firstName ?? ""} ${t.lastName ?? ""}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{t.firstName} {t.lastName}</p>
                      <p className="text-xs text-muted-foreground capitalize">{t.status}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${t.status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{t.status}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty icon={Users} title="No tenants yet" desc="Add tenants or import from a spreadsheet." cta={{ label: "Add tenant", onClick: () => navigate("/tenants") }} />
            )}
          </Panel>
        </div>

        {/* ── Alerts footer ── */}
        {(m.urgentMaint > 0 || m.overdueCount > 0 || m.expiringLeases.length > 0) && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-500/5 px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Attention required</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {m.urgentMaint > 0 && (
                <button onClick={() => navigate("/maintenance")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors">
                  <AlertTriangle className="w-3.5 h-3.5" />{m.urgentMaint} urgent maintenance {m.urgentMaint === 1 ? "request" : "requests"}
                </button>
              )}
              {m.overdueCount > 0 && (
                <button onClick={() => navigate("/arrears")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-400 text-xs font-medium hover:bg-orange-500/20 transition-colors">
                  <DollarSign className="w-3.5 h-3.5" />{m.overdueCount} overdue · {fmtKES(m.overdueAmount)}
                </button>
              )}
              {m.expiringLeases.length > 0 && (
                <button onClick={() => navigate("/tenants")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors">
                  <Clock className="w-3.5 h-3.5" />{m.expiringLeases.length} lease{m.expiringLeases.length > 1 ? "s" : ""} expiring in 30 days
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}