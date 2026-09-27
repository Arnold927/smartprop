import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertTriangle, DollarSign, Calendar, MessageSquare, Send,
  Calculator, Clock, Shield, Target, Activity,
  ChevronLeft, ChevronRight, Building, Home, Lock,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import type { Arrears, PaymentReminder, RiskAssessment, TenantBehaviorLog, ArrearsAction, Tenant } from "@shared/schema";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// ── Role helpers ───────────────────────────────────────────────────────────────
type Role = "admin" | "manager" | "staff" | "landlord" | "tenant" | string;

function roleCapabilities(role: Role) {
  return {
    canManage:    role === "admin" || role === "manager",   // detect, schedule, send reminders
    canView:      role !== "tenant",                        // full list
    canSendReminder: role === "admin" || role === "manager" || role === "staff",
    isLandlord:   role === "landlord",
    isStaff:      role === "staff",
  };
}

// ── Date / number helpers ──────────────────────────────────────────────────────
const safeFormatDate = (date: string | Date | null | undefined, fmt = "MMM dd, yyyy"): string => {
  if (!date) return "—";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "—";
    return format(d, fmt);
  } catch { return "—"; }
};

const safeFormatTime = (date: string | Date | null | undefined): string => {
  if (!date) return "Not sent";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "—";
    return format(d, "MMM dd, HH:mm");
  } catch { return "—"; }
};

/** Recalculate days overdue from nextDueDate rather than trusting stale stored value. */
function calcDaysOverdue(nextDueDate: string | Date | null | undefined, storedDays: number): number {
  if (!nextDueDate) return storedDays ?? 0;
  try {
    const due = typeof nextDueDate === "string" ? new Date(nextDueDate) : nextDueDate;
    if (isNaN(due.getTime())) return storedDays ?? 0;
    const diff = differenceInDays(new Date(), due);
    return diff > 0 ? diff : (storedDays ?? 0);
  } catch { return storedDays ?? 0; }
}

const safeAmount = (v: unknown): number => {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
};

const fmtKES = (n: number, currency = "KES") =>
  `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Pagination ─────────────────────────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

function usePagination<T>(items: T[], search: string, filterFn: (item: T, q: string) => boolean, pageSize: number) {
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter(item => filterFn(item, q)) : items;
  }, [items, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { paginated, filtered, page: safePage, totalPages, setPage };
}

function PaginationBar({ page, totalPages, total, setPage, pageSize, setPageSize }: {
  page: number; totalPages: number; total: number;
  setPage: (p: number) => void; pageSize: number; setPageSize: (n: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t text-sm text-muted-foreground flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="border rounded px-2 py-1 text-sm bg-background text-foreground">
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>· {total} results · Page {page} of {totalPages}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const start = Math.max(1, Math.min(page - 2, totalPages - 4));
          const p = start + i;
          return (
            <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="w-8" onClick={() => setPage(p)}>
              {p}
            </Button>
          );
        })}
        <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Badge helpers ──────────────────────────────────────────────────────────────
const PRIORITY_CLASS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high:     "bg-orange-500 text-white",
  medium:   "bg-yellow-500 text-white",
  low:      "bg-emerald-500 text-white",
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function ArrearsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const role = (user?.role ?? "") as Role;
  const caps = roleCapabilities(role);

  const [activeTab, setActiveTab] = useState("arrears");

  // Search state
  const [arrearsSearch,  setArrearsSearch]  = useState("");
  const [remindersSearch,setRemindersSearch] = useState("");
  const [riskSearch,     setRiskSearch]     = useState("");
  const [behaviorSearch, setBehaviorSearch] = useState("");
  const [actionsSearch,  setActionsSearch]  = useState("");

  // Page-size state
  const [arrearsPageSize,   setArrearsPageSize]   = useState(10);
  const [remindersPageSize, setRemindersPageSize] = useState(10);
  const [riskPageSize,      setRiskPageSize]      = useState(10);
  const [behaviorPageSize,  setBehaviorPageSize]  = useState(10);
  const [actionsPageSize,   setActionsPageSize]   = useState(10);

  // ── Data: properties (landlord uses this to filter arrears by their assets) ──
  const { data: propertiesRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/landlord-portal/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/landlord-portal/properties");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: caps.isLandlord,
    staleTime: 5 * 60_000,
  });
  const landlordPropertyIds = useMemo(
    () => new Set(propertiesRaw.map((p: any) => p.id as number)),
    [propertiesRaw]
  );

  // ── Data: units + properties for enrichment (name, unit number) ───────────
  const { data: allProperties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
    staleTime: 5 * 60_000,
  });

  const { data: allUnits = [] } = useQuery<any[]>({
    queryKey: ["/api/units"],
    queryFn: async () => {
      const r = await apiRequest("/api/units");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
    staleTime: 5 * 60_000,
  });

  const propertyById = useMemo(() => {
    const m: Record<number, any> = {};
    for (const p of allProperties) m[p.id] = p;
    return m;
  }, [allProperties]);

  const unitById = useMemo(() => {
    const m: Record<number, any> = {};
    for (const u of allUnits) m[u.id] = u;
    return m;
  }, [allUnits]);

  // ── Data: arrears ─────────────────────────────────────────────────────────
  const { data: arrearsResponse, isLoading: arrearsLoading } = useQuery<any>({
    queryKey: ["/api/arrears"],
    queryFn: async () => {
      const r = await apiRequest("/api/arrears?limit=200");
      return r.json();
    },
    enabled: caps.canView,
  });

  const arrearsRaw: Arrears[] = useMemo(
    () => ensureArray(arrearsResponse?.results ?? arrearsResponse),
    [arrearsResponse]
  );

  // Landlords only see arrears for their own properties
  const arrearsList: Arrears[] = useMemo(() => {
    if (!caps.isLandlord) return arrearsRaw;
    return arrearsRaw.filter(a => landlordPropertyIds.has(a.propertyId));
  }, [arrearsRaw, caps.isLandlord, landlordPropertyIds]);

  // ── Data: payment reminders ───────────────────────────────────────────────
  const { data: paymentReminders = [] } = useQuery<PaymentReminder[]>({
    queryKey: ["/api/payment-reminders"],
    queryFn: async () => {
      const r = await apiRequest("/api/payment-reminders");
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
  });

  // ── Data: risk assessments ────────────────────────────────────────────────
  const { data: riskAssessments = [] } = useQuery<RiskAssessment[]>({
    queryKey: ["/api/risk-assessments"],
    queryFn: async () => {
      const r = await apiRequest("/api/risk-assessments");
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
  });

  // ── Data: behavior logs ───────────────────────────────────────────────────
  const { data: behaviorLogs = [] } = useQuery<TenantBehaviorLog[]>({
    queryKey: ["/api/tenant-behavior-logs"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenant-behavior-logs");
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
  });

  // ── Data: arrears actions ─────────────────────────────────────────────────
  const { data: arrearsActions = [] } = useQuery<ArrearsAction[]>({
    queryKey: ["/api/arrears-actions"],
    queryFn: async () => {
      const r = await apiRequest("/api/arrears-actions");
      return ensureArray(await r.json());
    },
    enabled: caps.canView,
  });

  // ── Data: tenants (admin/manager/staff only) ──────────────────────────────
  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenants");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: !caps.isLandlord && caps.canView,
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getTenantName = (tenantId: number) => {
    const t = tenants.find(t => t.id === tenantId);
    return t ? `${t.firstName} ${t.lastName}` : `Tenant #${tenantId}`;
  };

  const getPropertyName = (propertyId: number) =>
    propertyById[propertyId]?.name ?? `Property #${propertyId}`;

  const getUnitLabel = (unitId: number) => {
    const u = unitById[unitId];
    return u ? `Unit ${u.unitNumber ?? u.unit_number ?? unitId}` : `Unit #${unitId}`;
  };

  // ── Mutations (manager/admin only) ────────────────────────────────────────
  const detectArrearsMutation = useMutation({
    mutationFn: () => apiRequest("/api/arrears/detect", { method: "POST", data: {} }),
    onSuccess: () => {
      toast({ title: "Arrears detection completed" });
      queryClient.invalidateQueries({ queryKey: ["/api/arrears"] });
    },
    onError: () => toast({ title: "Failed to detect arrears", variant: "destructive" }),
  });

  const scheduleRemindersMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/payment-reminders/schedule", { method: "POST", data: {} });
      return r.json();
    },
    onSuccess: (data: any) => {
      toast({ title: `${data?.scheduled ?? 0} reminders scheduled` });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-reminders"] });
    },
    onError: () => toast({ title: "Failed to schedule reminders", variant: "destructive" }),
  });

  const sendReminderMutation = useMutation({
    mutationFn: async ({ tenantId, arrearsId, arrear }: { tenantId: number; arrearsId: number; arrear: Arrears }) => {
      const tenantName   = getTenantName(tenantId);
      const amount       = safeAmount(arrear.outstandingAmount).toLocaleString("en-KE");
      const currency     = arrear.currency ?? "KES";
      const daysOverdue  = calcDaysOverdue(arrear.nextDueDate, arrear.daysOverdue);
      const message = [
        `Dear ${tenantName},`,
        ``,
        `This is a payment reminder from your property manager.`,
        ``,
        `Outstanding amount: ${currency} ${amount}`,
        `Days overdue: ${daysOverdue}`,
        ...(arrear.nextDueDate ? [`Next due date: ${safeFormatDate(arrear.nextDueDate)}`] : []),
        ``,
        `Please make payment as soon as possible to avoid further action.`,
        `If you have already paid, please share your payment reference.`,
      ].join("\n");
      const r = await apiRequest("/api/payment-reminders", {
        method: "POST",
        data: { tenantId, arrearsId, reminderType: "overdue", channel: "email", message,
                scheduledFor: new Date().toISOString(), recipientInfo: { tenantId } },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Reminder sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-reminders"] });
    },
    onError: () => toast({ title: "Failed to send reminder", variant: "destructive" }),
  });

  const calculateRiskMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      const r = await apiRequest(`/api/risk-assessments/calculate/${tenantId}`, { method: "POST", data: {} });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Risk assessment calculated" });
      queryClient.invalidateQueries({ queryKey: ["/api/risk-assessments"] });
    },
    onError: () => toast({ title: "Failed to calculate risk", variant: "destructive" }),
  });

  // ── Stats — calculated from real data ─────────────────────────────────────
  const stats = useMemo(() => {
    const totalOutstanding = arrearsList.reduce((s, a) => s + safeAmount(a.outstandingAmount), 0);
    const criticalCount    = arrearsList.filter(a => a.priority === "critical").length;
    const overdueCount     = arrearsList.length;
    const avgDaysOverdue   = overdueCount > 0
      ? Math.round(arrearsList.reduce((s, a) => s + calcDaysOverdue(a.nextDueDate, a.daysOverdue), 0) / overdueCount)
      : 0;
    const highRiskTenants  = riskAssessments.filter(r =>
      r.riskCategory === "high" || r.riskCategory === "critical"
    ).length;
    return { totalOutstanding, criticalCount, overdueCount, avgDaysOverdue, highRiskTenants };
  }, [arrearsList, riskAssessments]);

  // ── Paginated lists ───────────────────────────────────────────────────────
  const arrearsPag = usePagination(arrearsList, arrearsSearch,
    (a, q) => getTenantName(a.tenantId).toLowerCase().includes(q)
           || getPropertyName(a.propertyId).toLowerCase().includes(q)
           || getUnitLabel(a.unitId).toLowerCase().includes(q)
           || a.priority.toLowerCase().includes(q)
           || a.status.toLowerCase().includes(q),
    arrearsPageSize);

  const remindersPag = usePagination(paymentReminders as PaymentReminder[], remindersSearch,
    (r, q) => getTenantName(r.tenantId).toLowerCase().includes(q)
           || r.channel.toLowerCase().includes(q)
           || r.status.toLowerCase().includes(q),
    remindersPageSize);

  const riskPag = usePagination(riskAssessments as RiskAssessment[], riskSearch,
    (r, q) => getTenantName(r.tenantId).toLowerCase().includes(q)
           || r.riskCategory.toLowerCase().includes(q),
    riskPageSize);

  const behaviorPag = usePagination(behaviorLogs as TenantBehaviorLog[], behaviorSearch,
    (l, q) => getTenantName(l.tenantId).toLowerCase().includes(q)
           || l.eventType.toLowerCase().includes(q)
           || l.eventCategory.toLowerCase().includes(q),
    behaviorPageSize);

  const actionsPag = usePagination(arrearsActions as ArrearsAction[], actionsSearch,
    (a, q) => a.actionType.toLowerCase().includes(q)
           || String(a.outcome ?? "").toLowerCase().includes(q)
           || String(a.description ?? "").toLowerCase().includes(q),
    actionsPageSize);

  // ── Access gate ───────────────────────────────────────────────────────────
  if (!caps.canView) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
        <Lock className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Restricted</h2>
        <p className="text-muted-foreground max-w-sm">
          Arrears management is not available for your account. Please contact your property manager.
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageHeader
        title="Arrears & Risk Management"
        subtitle={caps.isLandlord
          ? "Overdue balances across your properties"
          : "Real-time arrears detection, automated reminders, and risk assessment"}
        icon={<AlertTriangle className="w-5 h-5" />}
        actions={
          <>
            {caps.canManage && (
              <>
                <SecondaryButton icon={<AlertTriangle className="h-4 w-4" />} onClick={() => detectArrearsMutation.mutate()} disabled={detectArrearsMutation.isPending}>
                  {detectArrearsMutation.isPending ? "Detecting…" : "Detect Arrears"}
                </SecondaryButton>
                <PrimaryButton icon={<Calendar className="h-4 w-4" />} onClick={() => scheduleRemindersMutation.mutate()} disabled={scheduleRemindersMutation.isPending}>
                  {scheduleRemindersMutation.isPending ? "Scheduling…" : "Schedule Reminders"}
                </PrimaryButton>
              </>
            )}
            {caps.isLandlord && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Viewing {landlordPropertyIds.size} {landlordPropertyIds.size === 1 ? "property" : "properties"}
              </Badge>
            )}
          </>
        }
      />

      {/* KPI strip */}
      <StatsGrid cols={4}>
        <StatTile label="Total Outstanding" value={fmtKES(stats.totalOutstanding)} icon={<DollarSign className="w-4 h-4" />} accent="red" />
        <StatTile label="Critical Cases" value={stats.criticalCount} icon={<AlertTriangle className="w-4 h-4" />} accent="amber" />
        <StatTile label="Avg Days Overdue" value={stats.avgDaysOverdue > 0 ? `${stats.avgDaysOverdue} days` : "—"} icon={<Clock className="w-4 h-4" />} accent="blue" />
        <StatTile label="High Risk Tenants" value={caps.isLandlord ? "—" : stats.highRiskTenants} icon={<Shield className="w-4 h-4" />} accent="violet" />
      </StatsGrid>

      {/* Tabs — landlords only see arrears + reminders */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap w-full h-auto gap-0.5 p-1">
          <TabsTrigger value="arrears">Active Arrears ({stats.overdueCount})</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          {!caps.isLandlord && <TabsTrigger value="risk">Risk Assessment</TabsTrigger>}
          {!caps.isLandlord && <TabsTrigger value="behavior">Tenant Behaviour</TabsTrigger>}
          {caps.canManage && <TabsTrigger value="actions">Actions History</TabsTrigger>}
        </TabsList>

        {/* ── Active Arrears ── */}
        <TabsContent value="arrears" className="space-y-4">
          <SectionCard
            title="Active Arrears"
            subtitle="Overdue payments sorted by urgency — days overdue recalculated in real time"
          >
            <div className="mb-4">
              <FilterBar
                search={arrearsSearch}
                onSearch={(v) => { setArrearsSearch(v); arrearsPag.setPage(1); }}
                placeholder="Search tenant, property, priority…"
              />
            </div>
            {arrearsLoading ? (
              <div className="py-10 text-center text-muted-foreground text-sm">Loading arrears…</div>
            ) : (
              <div className="space-y-3">
                {arrearsPag.paginated.map((arrear) => {
                  const daysOverdue = calcDaysOverdue(arrear.nextDueDate, arrear.daysOverdue);
                  const amount      = safeAmount(arrear.outstandingAmount);
                  const currency    = arrear.currency ?? "KES";
                  return (
                    <div key={arrear.id} className="border rounded-xl p-4 space-y-3">
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`${PRIORITY_CLASS[arrear.priority] ?? "bg-muted text-foreground"} capitalize`}>
                            {arrear.priority}
                          </Badge>
                          {!caps.isLandlord && (
                            <span className="font-semibold text-sm">{getTenantName(arrear.tenantId)}</span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-red-600">{fmtKES(amount, currency)}</p>
                          <p className="text-xs text-muted-foreground">{daysOverdue} days overdue</p>
                        </div>
                      </div>

                      {/* Location row */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building className="w-3 h-3" /> {getPropertyName(arrear.propertyId)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Home className="w-3 h-3" /> {getUnitLabel(arrear.unitId)}
                        </span>
                      </div>

                      {/* Detail grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Next Due</p>
                          <p className="font-medium">{safeFormatDate(arrear.nextDueDate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Last Payment</p>
                          <p className="font-medium">{safeFormatDate(arrear.lastPaymentDate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Status</p>
                          <SPBadge status={arrear.status} />
                        </div>
                        {caps.canSendReminder && (
                          <div className="flex items-end">
                            <Button size="sm" variant="outline" className="h-8 text-xs"
                              onClick={() => sendReminderMutation.mutate({ tenantId: arrear.tenantId, arrearsId: arrear.id, arrear })}
                              disabled={sendReminderMutation.isPending}>
                              <Send className="w-3 h-3 mr-1.5" /> Send Reminder
                            </Button>
                          </div>
                        )}
                      </div>

                      {arrear.notes && (
                        <p className="text-xs text-muted-foreground border-t pt-2">{arrear.notes}</p>
                      )}
                    </div>
                  );
                })}
                {arrearsPag.filtered.length === 0 && (
                  <EmptyState
                    icon={<AlertTriangle />}
                    title={arrearsSearch ? "No arrears match your search" : "No active arrears"}
                    description={arrearsSearch ? undefined : "All payments are up to date"}
                    size="lg"
                  />
                )}
              </div>
            )}
            <PaginationBar page={arrearsPag.page} totalPages={arrearsPag.totalPages}
              total={arrearsPag.filtered.length} setPage={arrearsPag.setPage}
              pageSize={arrearsPageSize} setPageSize={setArrearsPageSize} />
          </SectionCard>
        </TabsContent>

        {/* ── Payment Reminders ── */}
        <TabsContent value="reminders" className="space-y-4">
          <SectionCard title="Payment Reminders" subtitle="Automated and manual reminder history">
            <div className="mb-4">
              <FilterBar
                search={remindersSearch}
                onSearch={(v) => { setRemindersSearch(v); remindersPag.setPage(1); }}
                placeholder="Search tenant, channel…"
              />
            </div>
            <div className="space-y-3">
              {remindersPag.paginated.map((reminder) => (
                <div key={reminder.id} className="border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {reminder.channel === "sms" ? <MessageSquare className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                      <div>
                        <p className="font-semibold text-sm">{getTenantName(reminder.tenantId)}</p>
                        <p className="text-xs text-muted-foreground capitalize">{reminder.reminderType.replace("_", " ")}</p>
                      </div>
                    </div>
                    <SPBadge status={reminder.status} />
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{reminder.message}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
                    <div><p className="font-medium text-foreground">Channel</p><p className="capitalize">{reminder.channel}</p></div>
                    <div><p className="font-medium text-foreground">Scheduled</p><p>{safeFormatTime(reminder.scheduledFor)}</p></div>
                    <div><p className="font-medium text-foreground">Sent At</p><p>{safeFormatTime(reminder.sentAt)}</p></div>
                    <div><p className="font-medium text-foreground">Response</p><p>{reminder.responseReceived ? "Received" : "None"}</p></div>
                  </div>
                </div>
              ))}
              {remindersPag.filtered.length === 0 && (
                <EmptyState icon={<MessageSquare />} title={remindersSearch ? "No reminders match your search" : "No reminders found"} size="lg" />
              )}
            </div>
            <PaginationBar page={remindersPag.page} totalPages={remindersPag.totalPages}
              total={remindersPag.filtered.length} setPage={remindersPag.setPage}
              pageSize={remindersPageSize} setPageSize={setRemindersPageSize} />
          </SectionCard>
        </TabsContent>

        {/* ── Risk Assessment (admin/manager/staff only) ── */}
        {!caps.isLandlord && (
          <TabsContent value="risk" className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <h2 className="text-lg font-semibold">Risk Assessment</h2>
              {caps.canManage && (
                <PrimaryButton icon={<Calculator className="h-4 w-4" />} onClick={async () => {
                  for (const t of tenants) {
                    calculateRiskMutation.mutate(t.id);
                    await new Promise(r => setTimeout(r, 150));
                  }
                }} disabled={calculateRiskMutation.isPending}>
                  {calculateRiskMutation.isPending ? "Calculating…" : "Calculate All Risk Scores"}
                </PrimaryButton>
              )}
            </div>
            <FilterBar
              search={riskSearch}
              onSearch={(v) => { setRiskSearch(v); riskPag.setPage(1); }}
              placeholder="Search tenant, category…"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {riskPag.paginated.map((assessment) => (
                <Card key={assessment.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{getTenantName(assessment.tenantId)}</CardTitle>
                      <SPBadge status={assessment.riskCategory} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Risk Score</span>
                        <span className="font-semibold">{assessment.riskScore}/100</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-red-500 transition-all"
                          style={{ width: `${assessment.riskScore}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      {[
                        { label: "Payment", value: assessment.paymentHistoryScore },
                        { label: "Income",  value: assessment.incomeStabilityScore },
                        { label: "Behaviour", value: assessment.behaviorScore },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-muted/50 rounded-lg p-2 text-center">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="font-semibold">{value}/100</p>
                        </div>
                      ))}
                    </div>
                    {assessment.recommendations && (
                      <p className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">{assessment.recommendations}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Assessed {safeFormatDate(assessment.assessmentDate)} · Review {safeFormatDate(assessment.nextReviewDate)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            {riskPag.filtered.length === 0 && (
              <SectionCard>
                <EmptyState
                  icon={<Target />}
                  title={riskSearch ? "No assessments match your search" : "No risk assessments yet"}
                  description={riskSearch ? undefined : "Click Calculate to generate"}
                  size="lg"
                />
              </SectionCard>
            )}
            {riskPag.filtered.length > 0 && (
              <PaginationBar page={riskPag.page} totalPages={riskPag.totalPages}
                total={riskPag.filtered.length} setPage={riskPag.setPage}
                pageSize={riskPageSize} setPageSize={setRiskPageSize} />
            )}
          </TabsContent>
        )}

        {/* ── Tenant Behaviour (admin/manager/staff only) ── */}
        {!caps.isLandlord && (
          <TabsContent value="behavior" className="space-y-4">
            <SectionCard title="Tenant Behaviour Tracking" subtitle="Historical behaviour events and their impact on risk profiles">
              <div className="mb-4">
                <FilterBar
                  search={behaviorSearch}
                  onSearch={(v) => { setBehaviorSearch(v); behaviorPag.setPage(1); }}
                  placeholder="Search tenant, event type…"
                />
              </div>
              <div className="space-y-3">
                {behaviorPag.paginated.map((log) => (
                  <div key={log.id} className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold text-sm">{getTenantName(log.tenantId)}</span>
                        <Badge variant={log.eventCategory === "positive" ? "default" : log.eventCategory === "negative" ? "destructive" : "outline"} className="capitalize">
                          {log.eventCategory}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium capitalize">{log.eventType.replace("_", " ")}</p>
                        <p className="text-xs text-muted-foreground">Impact: {log.impact}</p>
                      </div>
                    </div>
                    <p className="text-sm text-foreground mb-2">{log.description}</p>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Recorded by: {log.recordedBy}</span>
                      <span>{safeFormatDate(log.eventDate, "MMM dd, yyyy HH:mm")}</span>
                    </div>
                  </div>
                ))}
                {behaviorPag.filtered.length === 0 && (
                  <EmptyState icon={<Activity />} title={behaviorSearch ? "No logs match your search" : "No behaviour logs recorded"} size="lg" />
                )}
              </div>
              <PaginationBar page={behaviorPag.page} totalPages={behaviorPag.totalPages}
                total={behaviorPag.filtered.length} setPage={behaviorPag.setPage}
                pageSize={behaviorPageSize} setPageSize={setBehaviorPageSize} />
            </SectionCard>
          </TabsContent>
        )}

        {/* ── Actions History (admin/manager only) ── */}
        {caps.canManage && (
          <TabsContent value="actions" className="space-y-4">
            <SectionCard title="Actions History" subtitle="All actions taken to resolve arrears situations">
              <div className="mb-4">
                <FilterBar
                  search={actionsSearch}
                  onSearch={(v) => { setActionsSearch(v); actionsPag.setPage(1); }}
                  placeholder="Search action type, outcome…"
                />
              </div>
              <div className="space-y-3">
                {actionsPag.paginated.map((action) => (
                  <div key={action.id} className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div>
                        <p className="font-semibold capitalize">{action.actionType.replace("_", " ")}</p>
                        <p className="text-xs text-muted-foreground">{action.description}</p>
                      </div>
                      <div className="text-right">
                        {action.amount && (
                          <p className="font-semibold text-emerald-600">{fmtKES(safeAmount(action.amount))}</p>
                        )}
                        <SPBadge status={action.outcome ?? "pending"} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                      <div><p className="font-medium text-foreground">Date</p><p>{safeFormatDate(action.actionDate)}</p></div>
                      <div><p className="font-medium text-foreground">Performed By</p><p>{action.performedBy}</p></div>
                      {action.followUpDate && (
                        <div><p className="font-medium text-foreground">Follow Up</p><p>{safeFormatDate(action.followUpDate)}</p></div>
                      )}
                    </div>
                    {action.notes && (
                      <p className="text-xs text-muted-foreground border-t pt-2 mt-2">{action.notes}</p>
                    )}
                  </div>
                ))}
                {actionsPag.filtered.length === 0 && (
                  <EmptyState icon={<Target />} title={actionsSearch ? "No actions match your search" : "No actions recorded yet"} size="lg" />
                )}
              </div>
              <PaginationBar page={actionsPag.page} totalPages={actionsPag.totalPages}
                total={actionsPag.filtered.length} setPage={actionsPag.setPage}
                pageSize={actionsPageSize} setPageSize={setActionsPageSize} />
            </SectionCard>
          </TabsContent>
        )}
      </Tabs>
    </PageShell>
  );
}