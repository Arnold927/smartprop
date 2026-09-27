import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, Download, DollarSign, Users, Wrench, Home, Loader2, Calendar, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useAuth } from "@/hooks/useAuth";
import { AlertCircle } from "lucide-react";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number | string) => {
  const num = typeof n === "string" ? parseFloat(n) || 0 : n;
  return `KES ${Math.round(num).toLocaleString("en-KE")}`;
};

const todayStr = () => new Date().toISOString().split("T")[0];

const firstOfMonthStr = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
};

/** Derive the [since, until] window from the current period/custom settings,
 *  matching the server's parseSince / parseUntil logic exactly. */
function resolveSinceUntil(
  period: string,
  customStart: string,
  customEnd: string
): { since: Date; until: Date } {
  const now = new Date();

  let since: Date;
  if (period === "custom") {
    since = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
    since.setHours(0, 0, 0, 0);
  } else {
    switch (period) {
      case "week":
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case "quarter":
        since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      case "year":
        since = new Date(now.getFullYear(), 0, 1);
        break;
      case "month":
      default:
        since = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }
    since.setHours(0, 0, 0, 0);
  }

  let until: Date;
  if (period === "custom" && customEnd) {
    until = new Date(customEnd);
  } else {
    until = new Date();
  }
  until.setHours(23, 59, 59, 999);

  return { since, until };
}

function StatRow({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export default function Reports() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;

  const { user, isLoading: authLoading } = useAuth();
  const isManager = guard.canManage;
  const { toast } = useToast();

  const [period,      setPeriod]      = useState<string>("month");
  const [customStart, setCustomStart] = useState<string>(firstOfMonthStr());
  const [customEnd,   setCustomEnd]   = useState<string>(todayStr());

  // Each entry stores { data, periodLabel } so we can detect when the period
  // has changed since a report was last generated.
  const [reportResults, setReportResults] = useState<Record<string, { data: any; forPeriod: string } | null>>({});
  const [loadingType,   setLoadingType]   = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<string | null>(null);

  // ── Live summary queries ──────────────────────────────────────────────────

  const { data: paysRaw } = useQuery<any>({
    queryKey: ["/api/rent-payments"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/rent-payments")).json()),
    staleTime: 5 * 60 * 1000,
    enabled: isManager,
  });
  const { data: tenantsRaw } = useQuery<any>({
    queryKey: ["/api/tenants"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/tenants")).json()),
    staleTime: 5 * 60 * 1000,
    enabled: isManager,
  });
  const { data: propsRaw } = useQuery<any>({
    queryKey: ["/api/properties"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()),
    staleTime: 5 * 60 * 1000,
    enabled: isManager,
  });
  const { data: maintRaw } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    staleTime: 5 * 60 * 1000,
    enabled: isManager,
  });
  const { data: unitsRaw } = useQuery<any>({
    queryKey: ["/api/units"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/units")).json()),
    staleTime: 5 * 60 * 1000,
    enabled: isManager,
  });

  const allPayments:   any[] = Array.isArray(paysRaw)    ? paysRaw    : (paysRaw?.results    ?? []);
  const allTenants:    any[] = Array.isArray(tenantsRaw)  ? tenantsRaw  : (tenantsRaw?.results  ?? []);
  const allProperties: any[] = Array.isArray(propsRaw)    ? propsRaw    : (propsRaw?.results    ?? []);
  const allMaint:      any[] = Array.isArray(maintRaw)    ? maintRaw    : (maintRaw?.results    ?? []);
  const allUnits:      any[] = Array.isArray(unitsRaw)    ? unitsRaw    : (unitsRaw?.results    ?? []);

  // ── Period state ──────────────────────────────────────────────────────────

  const isCustom = period === "custom";

  const customRangeValid =
    !isCustom ||
    (!!customStart && !!customEnd && customStart <= customEnd);

  const { since, until } = useMemo(
    () => resolveSinceUntil(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  const periodLabel = isCustom
    ? customStart && customEnd
      ? `${customStart} → ${customEnd}`
      : "Custom range"
    : ({
        week:    "This week",
        month:   "This month",
        quarter: "This quarter",
        year:    "This year",
      }[period] ?? period);

  // ── Overview strip stats — filtered by the selected period ────────────────

  const collected = useMemo(() =>
    allPayments
      .filter(p => {
        if (!["paid", "completed"].includes(p.status)) return false;
        const t = p.createdAt ? new Date(p.createdAt).getTime() : null;
        return t !== null && t >= since.getTime() && t <= until.getTime();
      })
      .reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [allPayments, since, until]
  );

  const openMaint = useMemo(() =>
    allMaint.filter(r => {
      if (!["pending", "assigned", "in_progress"].includes(r.status)) return false;
      const t = r.createdAt ? new Date(r.createdAt).getTime() : null;
      return t !== null && t >= since.getTime() && t <= until.getTime();
    }).length,
    [allMaint, since, until]
  );

  // Occupancy is always current (point-in-time) — it doesn't make sense to
  // filter units by period since isOccupied is their current state.
  const occupied      = allUnits.filter(u => u.isOccupied).length;
  const occPct        = allUnits.length ? Math.round((occupied / allUnits.length) * 100) : 0;
  // Active tenants created/registered within the selected period
  const activeTenants = useMemo(() =>
    allTenants.filter(t => {
      if (t.status !== "active") return false;
      const t2 = t.createdAt ? new Date(t.createdAt).getTime() : null;
      return t2 !== null && t2 >= since.getTime() && t2 <= until.getTime();
    }).length,
    [allTenants, since, until]
  );

  // Filtered counts for export labels — reflects what will actually be in the CSV
  const filteredPaymentsCount = useMemo(() =>
    allPayments.filter(p => {
      const t = p.createdAt ? new Date(p.createdAt).getTime() : null;
      return t !== null && t >= since.getTime() && t <= until.getTime();
    }).length,
    [allPayments, since, until]
  );

  const filteredTenantsCount = useMemo(() =>
    allTenants.filter(t => {
      const t2 = t.createdAt ? new Date(t.createdAt).getTime() : null;
      return t2 !== null && t2 >= since.getTime() && t2 <= until.getTime();
    }).length,
    [allTenants, since, until]
  );

  // ── Period change handlers ────────────────────────────────────────────────

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    // Don't wipe results — let stale detection show "Refresh" prompts instead
  };

  const handleCustomDateChange = (field: "start" | "end", value: string) => {
    if (field === "start") setCustomStart(value);
    else setCustomEnd(value);
    // Same: keep existing results visible; the stale badge will prompt refresh
  };

  // ── Report generation ─────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async ({
      type,
      period,
      startDate,
      endDate,
    }: {
      type: string;
      period: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const r = await apiRequest("/api/reports/generate", {
        method: "POST",
        data: { reportType: type, period, startDate, endDate },
      });
      const json = await r.json();
      return { type, data: (json?.data ?? json) as Record<string, any> };
    },
    onSuccess: ({ type, data }) => {
      setReportResults(prev => ({ ...prev, [type]: { data, forPeriod: periodLabel } }));
      setLoadingType(null);
      toast({ title: "Report generated", description: `${data?.title ?? type} — ${periodLabel}` });
    },
    onError: (_err, { type }) => {
      // Restore the previous result (if any) so the card isn't left blank
      setReportResults(prev => {
        const existing = prev[type];
        if (existing) return prev; // keep what was there
        const next = { ...prev };
        delete next[type];
        return next;
      });
      setLoadingType(null);
      toast({ title: "Generation failed", variant: "destructive" });
    },
  });

  const handleGenerate = (type: string) => {
    if (!customRangeValid) {
      toast({
        title: "Invalid date range",
        description: "Start date must be on or before end date.",
        variant: "destructive",
      });
      return;
    }
    setLoadingType(type);
    // Don't null out the result — keep the old data visible while refreshing
    generateMutation.mutate({
      type,
      period,
      ...(isCustom ? { startDate: customStart, endDate: customEnd } : {}),
    });
  };

  // ── CSV export — passes the current period/date range as query params ─────

  const handleExport = async (type: "payments" | "tenants" | "properties") => {
    if (!customRangeValid) {
      toast({
        title: "Invalid date range",
        description: "Start date must be on or before end date.",
        variant: "destructive",
      });
      return;
    }
    setExportingType(type);
    try {
      // Build query string so the server filters the CSV to the selected period
      const params = new URLSearchParams({ period });
      if (isCustom) {
        if (customStart) params.set("startDate", customStart);
        if (customEnd)   params.set("endDate",   customEnd);
      }
      const r = await apiRequest(`/api/reports/export/${type}?${params.toString()}`);
      if (!r.ok) throw new Error(`Export failed: ${r.statusText}`);
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      // Filename includes the period so the user knows what it covers
      a.download = `${type}-${periodLabel.replace(/\s+/g, "-").replace(/→/g, "to")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Downloaded", description: `${type} — ${periodLabel}` });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message ?? "Could not download the file",
        variant: "destructive",
      });
    } finally {
      setExportingType(null);
    }
  };

  // ── Report card definitions ───────────────────────────────────────────────

  const reportCards = useMemo(() => [
    {
      type: "financial",
      title: "Financial report",
      description: `Revenue, expenses & net income · ${periodLabel}`,
      icon: DollarSign,
      color: "bg-green-50 dark:bg-green-950",
      iconColor: "text-green-600",
      renderResult: (d: any) => (
        <div className="space-y-1">
          <StatRow label="Total revenue"    value={fmt(d.totalRevenue  ?? 0)} color="text-green-700" />
          <StatRow label="Total expenses"   value={fmt(d.totalExpenses ?? 0)} color="text-red-600" />
          <StatRow label="Net income"       value={fmt(d.netIncome     ?? 0)} color={(d.netIncome ?? 0) >= 0 ? "text-green-700" : "text-red-600"} />
          <StatRow label="Pending payments" value={fmt(d.totalPending  ?? 0)} color="text-amber-600" />
          <StatRow label="Overdue amount"   value={fmt(d.totalOverdue  ?? 0)} color="text-red-500" />
          <StatRow label="Paid count"       value={d.paymentCount      ?? 0} />
        </div>
      ),
    },
    {
      type: "occupancy",
      title: "Occupancy report",
      description: `Occupancy snapshot · move-ins/outs for ${periodLabel}`,
      icon: Home,
      color: "bg-blue-50 dark:bg-blue-950",
      iconColor: "text-blue-600",
      renderResult: (d: any) => (
        <div className="space-y-1">
          <StatRow label="Total units"    value={d.totalUnits    ?? 0} />
          <StatRow label="Occupied units" value={d.occupiedUnits ?? 0} color="text-green-700" />
          <StatRow label="Vacant units"   value={d.vacantUnits   ?? 0} color="text-amber-600" />
          <StatRow label="Occupancy rate" value={`${d.occupancyRate ?? 0}%`} color={(d.occupancyRate ?? 0) >= 80 ? "text-green-700" : "text-amber-600"} />
          <StatRow label={`Move-ins · ${periodLabel}`}  value={d.moveIns  ?? 0} color="text-green-700" />
          <StatRow label={`Move-outs · ${periodLabel}`} value={d.moveOuts ?? 0} color="text-amber-600" />
          {d.byProperty?.slice(0, 3).map((p: any) => (
            <StatRow key={p.property} label={p.property} value={`${p.rate}% (${p.occupied}/${p.total})`} />
          ))}
        </div>
      ),
    },
    {
      type: "maintenance",
      title: "Maintenance report",
      description: `Request volumes & resolution times · ${periodLabel}`,
      icon: Wrench,
      color: "bg-amber-50 dark:bg-amber-950",
      iconColor: "text-amber-600",
      renderResult: (d: any) => (
        <div className="space-y-1">
          <StatRow label="Total requests" value={d.totalRequests       ?? 0} />
          <StatRow label="Completed"      value={d.completedRequests   ?? 0} color="text-green-700" />
          <StatRow label="Pending"        value={d.pendingRequests     ?? 0} color="text-amber-600" />
          <StatRow label="Avg resolution" value={`${d.averageResolutionHours ?? 0}h`} />
          {d.byPriority?.filter((p: any) => p.count > 0).map((p: any) => (
            <StatRow
              key={p.priority}
              label={`${p.priority.charAt(0).toUpperCase() + p.priority.slice(1)} priority`}
              value={p.count}
            />
          ))}
        </div>
      ),
    },
    {
      type: "rent-collection",
      title: "Rent collection report",
      description: `Collection rates & overdue analysis · ${periodLabel}`,
      icon: BarChart3,
      color: "bg-purple-50 dark:bg-purple-950",
      iconColor: "text-purple-600",
      renderResult: (d: any) => (
        <div className="space-y-1">
          <StatRow label="Total collected" value={fmt(d.totalCollected ?? 0)} color="text-green-700" />
          <StatRow label="Overdue amount"  value={fmt(d.totalOverdue   ?? 0)} color="text-red-600" />
          <StatRow label="Collection rate" value={`${d.collectionRate  ?? 0}%`} color={(d.collectionRate ?? 0) >= 90 ? "text-green-700" : "text-amber-600"} />
          <StatRow label="Paid payments"   value={d.paymentCount       ?? 0} />
          <StatRow label="Overdue count"   value={d.overdueCount       ?? 0} color={(d.overdueCount ?? 0) > 0 ? "text-red-500" : "text-foreground"} />
          {d.byMethod?.filter((m: any) => m.count > 0).map((m: any) => (
            <StatRow key={m.method} label={m.method.toUpperCase()} value={`${m.count} · ${fmt(m.amount)}`} />
          ))}
        </div>
      ),
    },
  ], [periodLabel]);

  // ── render ────────────────────────────────────────────────────────────────

  // ── Auth loading ─────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  // ── Role guard — reports are admin/manager only ───────────────────────────
  if (!isManager) return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center max-w-sm space-y-3">
        <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
        <p className="text-sm text-muted-foreground">
          Reports & Analytics are available to property managers and admins only.
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );

  // ── Org guard ─────────────────────────────────────────────────────────────
  if (!user?.organizationId) return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="text-center max-w-sm space-y-3">
        <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">No organisation found</h2>
        <p className="text-sm text-muted-foreground">
          Your account is not linked to an organisation. Contact your administrator.
        </p>
      </div>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Reports & Analytics"
        subtitle={<>Showing data for <span className="font-medium text-foreground">{periodLabel}</span></>}
        icon={<BarChart3 className="w-5 h-5" />}
        actions={
          <div className="flex flex-col gap-2 sm:items-end">
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-44 h-9 border-border dark:border-gray-700 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="quarter">This quarter</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="custom">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Custom range…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Custom date pickers */}
            {isCustom && (
              <div className="flex items-end gap-2 flex-wrap sm:flex-nowrap">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground px-0.5">From</Label>
                  <Input
                    type="date"
                    value={customStart}
                    max={customEnd || todayStr()}
                    onChange={e => handleCustomDateChange("start", e.target.value)}
                    className="h-9 w-38 text-sm border-border dark:border-gray-700"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground px-0.5">To</Label>
                  <Input
                    type="date"
                    value={customEnd}
                    min={customStart || undefined}
                    max={todayStr()}
                    onChange={e => handleCustomDateChange("end", e.target.value)}
                    className="h-9 w-38 text-sm border-border dark:border-gray-700"
                  />
                </div>
              </div>
            )}

            {/* Stale-data hint: shown when any generated report was for a different period */}
            {Object.values(reportResults).some(
              v => v !== null && v.forPeriod !== periodLabel
            ) && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />
                Date range changed — re-generate reports to update
              </p>
            )}
          </div>
        }
      />

        {/* Live overview strip — filtered by selected period */}
        <StatsGrid cols={4}>
          <StatTile label="Collected" value={fmt(collected)} sub={periodLabel} icon={<DollarSign className="w-4 h-4" />} accent="emerald" />
          <StatTile label="Occupancy" value={`${occPct}%`} sub="current" icon={<Home className="w-4 h-4" />} accent="blue" />
          <StatTile label="Active tenants" value={activeTenants} sub={periodLabel} icon={<Users className="w-4 h-4" />} accent="violet" />
          <StatTile label="Open requests" value={openMaint} sub={periodLabel} icon={<Wrench className="w-4 h-4" />} accent={openMaint > 0 ? "amber" : "blue"} />
        </StatsGrid>

        {/* Report cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {reportCards.map(({ type, title, description, icon: Icon, color, iconColor, renderResult }) => {
            const isLoading   = loadingType === type;
            const resultEntry = reportResults[type] ?? null;
            const result      = resultEntry?.data ?? null;
            // Stale: a result exists but was generated for a different period
            const isStale     = resultEntry !== null && resultEntry !== undefined && resultEntry.forPeriod !== periodLabel;
            // The label shown on the result came from when the report was generated
            const resultPeriodLabel = resultEntry?.forPeriod ?? periodLabel;
            return (
              <Card key={type} className="rounded-xl border border-slate-100 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                      <Icon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base font-semibold">{title}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {result && (
                    <>
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {resultPeriodLabel}
                      </p>
                      {renderResult(result)}
                    </>
                  )}
                  {isStale && (
                    <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      Showing <span className="font-medium">{resultPeriodLabel}</span> — click Refresh for <span className="font-medium">{periodLabel}</span>
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1"
                      onClick={() => handleGenerate(type)}
                      disabled={isLoading || !customRangeValid}
                      title={!customRangeValid ? "Please select a valid date range first" : undefined}
                    >
                      {isLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</>
                      ) : (
                        <><BarChart3 className="w-3.5 h-3.5 mr-1.5" />{result ? "Refresh" : "Generate"}</>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* CSV exports */}
        <SectionCard
          title="Data exports"
          subtitle={<>Download CSV filtered to <span className="font-medium text-foreground">{periodLabel}</span></>}
        >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {([
                { type: "payments"   as const, label: "Rent payments",    desc: `${filteredPaymentsCount} records in period`, icon: DollarSign },
                { type: "tenants"    as const, label: "Tenant directory", desc: `${filteredTenantsCount} tenants in period`, icon: Users      },
                { type: "properties" as const, label: "Properties",       desc: `${allProperties.length} total`, icon: Home       },
              ]).map(({ type, label, desc, icon: Icon }) => {
                const isExporting = exportingType === type;
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between p-3 rounded-xl border border-border dark:border-gray-800 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-muted dark:bg-gray-800 rounded-lg flex items-center justify-center">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 flex-shrink-0"
                      onClick={() => handleExport(type)}
                      disabled={isExporting || !customRangeValid}
                      title={`Download ${label} as CSV`}
                    >
                      {isExporting ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Download className="w-4 h-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
        </SectionCard>

    </PageShell>
  );
}