/**
 * finance-dashboard.tsx — Finance Manager view
 * Redesigned: clean financial command centre.
 * 4 KPI tiles · collection donut · monthly bar trend · transaction list.
 */

import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { DollarSign, TrendingUp, CreditCard, Target, AlertTriangle, CheckCircle, Wallet } from "lucide-react";
import { ActivityTracker, PageViewTracker } from "@/components/ui/activity-tracker";
import { FeatureAnnouncementCenter } from "@/components/ui/feature-announcement";

const fmtKES = (n: number) =>
  n >= 1_000_000 ? `KES ${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `KES ${(n / 1_000).toFixed(0)}K`
  :                `KES ${Math.round(n).toLocaleString("en-KE")}`;

function Tile({ label, value, sub, icon: Icon, accent, positive = true }: {
  label: string; value: string; sub: string; icon: any; accent: string; positive?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${accent} rounded-l-2xl`} />
      <div className="ml-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{label}</p>
        <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-2">{sub}</p>
        <div className={`absolute right-5 top-5 w-9 h-9 ${accent.replace("bg-", "bg-").replace("-500","-500/10")} rounded-xl flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${accent.replace("bg-", "text-")}`} />
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

function BarTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border shadow-xl rounded-xl px-4 py-3 text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-muted-foreground capitalize">{p.name}:</span>
          <span className="font-medium text-foreground ml-auto pl-3">{fmtKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function FinanceDashboard() {
  const { user } = useAuth();

  const now_month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const { data: rentPayments, isLoading } = useQuery({
    queryKey: ["/api/rent-payments"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/rent-payments")).json()),
    retry: false,
  });
  const { data: liveStats = {} } = useQuery({
    queryKey: ["/api/rent-payments/stats", now_month],
    queryFn: async () => (await apiRequest(`/api/rent-payments/stats?month=${now_month}`)).json(),
    staleTime: 30_000,
  });
  const { data: expensesRaw = [] } = useQuery({
    queryKey: ["/api/property-expenses"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/property-expenses")).json()),
    staleTime: 5 * 60_000,
  });

  const ls: any = liveStats;
  const paysArr = Array.isArray(rentPayments) ? rentPayments : [];
  const expArr  = Array.isArray(expensesRaw)  ? expensesRaw  : [];

  const totalRevenue     = Number(ls.collected ?? 0);
  const pendingAmount    = Number(ls.pending   ?? 0);
  const overdueAmount    = Number(ls.overdue   ?? 0);
  const collectionRate   = Number(ls.collectionRate ?? 0);
  const pendingCount     = Number(ls.pendingCount   ?? 0);
  const overdueCount     = Number(ls.overdueCount   ?? 0);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const expensesThisMonth = expArr.filter((e: any) => {
    const d = new Date(e.expenseDate ?? e.createdAt ?? 0);
    return d >= monthStart;
  }).reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);

  const netIncome    = totalRevenue - expensesThisMonth;
  const profitMargin = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 1000) / 10 : 0;

  // Monthly trend from raw payments
  const monthlyMap: Record<string, { collected: number; pending: number; overdue: number }> = {};
  paysArr.forEach((p: any) => {
    const d = p.dueDate ? new Date(p.dueDate) : new Date();
    const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
    if (!monthlyMap[key]) monthlyMap[key] = { collected: 0, pending: 0, overdue: 0 };
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid" || p.status === "completed") monthlyMap[key].collected += amt;
    else if (p.status === "pending") monthlyMap[key].pending += amt;
    else if (p.status === "overdue") monthlyMap[key].overdue += amt;
  });
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => new Date("1 " + a).getTime() - new Date("1 " + b).getTime())
    .slice(-6)
    .map(([month, v]) => ({ month, ...v }));

  const donutData = [
    { name: "Collected", value: totalRevenue,  fill: "#10b981" },
    { name: "Pending",   value: pendingAmount, fill: "#f59e0b" },
    { name: "Overdue",   value: overdueAmount, fill: "#ef4444" },
  ].filter(d => d.value > 0);

  const recentPaid = paysArr.filter((p: any) => p.status === "paid" || p.status === "completed").sort((a: any, b: any) => new Date(b.paidDate ?? b.createdAt ?? 0).getTime() - new Date(a.paidDate ?? a.createdAt ?? 0).getTime()).slice(0, 6);

  if (isLoading) return (
    <div className="min-h-screen bg-background p-8 space-y-6">
      {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-2xl animate-pulse" />)}
    </div>
  );

  return (
    <ActivityTracker>
      <PageViewTracker page="finance-dashboard" data={{ role: "finance_manager" }} />
      <FeatureAnnouncementCenter position="banner" userRole="manager" />

      <div className="min-h-screen bg-background">

        {/* Header */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">Finance Dashboard</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {user?.firstName || "Finance Manager"} · {format(new Date(), "MMMM yyyy")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${collectionRate >= 95 ? "bg-emerald-500/10 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400"}`}>
                <Target className="w-3.5 h-3.5" />{collectionRate}% Collection
              </span>
              {overdueCount > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5" />{overdueCount} Overdue
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* 4 KPI tiles */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
            <Tile label="Revenue MTD"       value={fmtKES(totalRevenue)}  sub={`${ls.collectedCount ?? 0} payments collected`} icon={DollarSign}  accent="bg-emerald-500" />
            <Tile label="Collection Rate"   value={`${collectionRate}%`}  sub="Value-based, current month"                    icon={Target}       accent="bg-blue-500"    />
            <Tile label="Outstanding"       value={fmtKES(pendingAmount + overdueAmount)} sub={`${pendingCount + overdueCount} invoices pending/overdue`} icon={CreditCard} accent="bg-amber-500" positive={false} />
            <Tile label="Net Income MTD"    value={fmtKES(netIncome)}     sub={expensesThisMonth > 0 ? `${profitMargin}% margin` : "No expenses recorded"} icon={TrendingUp} accent={netIncome >= 0 ? "bg-violet-500" : "bg-red-500"} />
          </div>

          {/* Chart row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Monthly bar */}
            <Section title="Monthly Trend — Last 6 Months">
              {monthlyData.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center space-y-2">
                  <DollarSign className="w-8 h-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No payment data yet</p>
                </div>
              ) : (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }} barSize={8} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                      <Tooltip content={<BarTip />} cursor={{ fill: "hsl(var(--muted))" }} />
                      <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[3,3,0,0]} />
                      <Bar dataKey="pending"   name="Pending"   fill="#f59e0b" radius={[3,3,0,0]} />
                      <Bar dataKey="overdue"   name="Overdue"   fill="#ef4444" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            {/* Donut */}
            <Section title="Payment Status — MTD">
              {donutData.length === 0 ? (
                <div className="flex flex-col items-center py-10 space-y-2">
                  <CheckCircle className="w-8 h-8 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No data for this period</p>
                </div>
              ) : (
                <div>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value">
                          {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmtKES(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 mt-2">
                    {donutData.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                          <span className="text-muted-foreground">{d.name}</span>
                        </span>
                        <span className="font-semibold text-foreground tabular-nums">{fmtKES(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* Summary stats */}
            <Section title="Key Metrics">
              <div className="space-y-3">
                {[
                  { label: "Gross Revenue MTD",    value: fmtKES(totalRevenue),             sub: `${ls.collectedCount ?? 0} payments` },
                  { label: "Expenses MTD",          value: fmtKES(expensesThisMonth),        sub: "Approved & paid expenses" },
                  { label: "Net Income MTD",        value: fmtKES(netIncome),                sub: `${profitMargin}% profit margin` },
                  { label: "Overdue Amount",        value: fmtKES(overdueAmount),            sub: `${overdueCount} tenants overdue` },
                  { label: "Pending Payments",      value: fmtKES(pendingAmount),            sub: `${pendingCount} invoices pending` },
                ].map(row => (
                  <div key={row.label} className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{row.label}</p>
                      <p className="text-[11px] text-muted-foreground">{row.sub}</p>
                    </div>
                    <p className="text-xs font-bold text-foreground tabular-nums shrink-0">{row.value}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* Recent transactions */}
          {recentPaid.length > 0 && (
            <Section title="Recent Payments">
              <div className="divide-y divide-border">
                {recentPaid.map((p: any) => {
                  const name = p.tenant ? `${p.tenant.firstName ?? ""} ${p.tenant.lastName ?? ""}`.trim() : `Payment #${p.id}`;
                  return (
                    <div key={p.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                        <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{name}</p>
                        <p className="text-xs text-muted-foreground">{p.invoiceNumber ?? `#${p.id}`} · {p.paidDate ? format(new Date(p.paidDate), "dd MMM yyyy") : "—"}</p>
                      </div>
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">+{fmtKES(Number(p.amount ?? 0))}</p>
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
