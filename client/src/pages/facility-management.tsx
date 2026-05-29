import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { CreateWorkOrderDialog } from "@/components/create-work-order-dialog";
import { EditWorkOrderDialog } from "@/components/edit-work-order-dialog";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  Building2, FileText, Wrench, BarChart3,
  Download, Plus, Eye, Edit, AlertTriangle,
  CheckCircle, Clock, DollarSign, Users, Home,
  TrendingUp, TrendingDown, RefreshCw, Calendar,
  ArrowUpRight, ArrowDownRight, Search, X,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtKES = (n: number | string | null | undefined) =>
  `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return "—"; }
};

const daysUntil = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
};

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  // Lease / tenant
  active:           { label: "Active",        cls: "bg-emerald-50 text-emerald-700 border border-emerald-200"  },
  inactive:         { label: "Inactive",       cls: "bg-gray-100   text-gray-700   dark:bg-gray-800   "   },
  // Work order
  draft:            { label: "Draft",          cls: "bg-gray-100   text-gray-700   dark:bg-gray-800   "   },
  pending_approval: { label: "Pending Appr.",  cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  approved:         { label: "Approved",       cls: "bg-blue-100   text-blue-800   dark:bg-blue-900   dark:text-blue-200"   },
  assigned:         { label: "Assigned",       cls: "bg-blue-100   text-blue-800   dark:bg-blue-900   dark:text-blue-200"   },
  in_progress:      { label: "In Progress",    cls: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  on_hold:          { label: "On Hold",        cls: "bg-gray-100   text-gray-700   dark:bg-gray-800   "   },
  completed:        { label: "Completed",      cls: "bg-emerald-50 text-emerald-700 border border-emerald-200"  },
  cancelled:        { label: "Cancelled",      cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  rejected:         { label: "Rejected",       cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  // Priority
  low:              { label: "Low",            cls: "bg-gray-100   text-gray-700   dark:bg-gray-800   "   },
  medium:           { label: "Medium",         cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  high:             { label: "High",           cls: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  critical:         { label: "Critical",       cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  urgent:           { label: "Urgent",         cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  // Expiry
  expiring:         { label: "Expiring Soon",  cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  expired:          { label: "Expired",        cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: "bg-gray-100 text-gray-700" };
  return <Badge className={`text-xs px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>;
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
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

// ─── Empty state ──────────────────────────────────────────────────────────────
function Empty({ message, icon: Icon = Building2 }: { message: string; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
      <Icon className="w-10 h-10 opacity-20" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const FacilityManagement = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab]               = useState("leases");
  const [woDialogOpen, setWoDialogOpen]         = useState(false);
  const [editWo, setEditWo]                     = useState<any | null>(null);
  const [leaseFilter, setLeaseFilter]           = useState<string>("all");
  const [woFilter, setWoFilter]                 = useState<string>("all");
  const [woTypeFilter, setWoTypeFilter]         = useState<string>("all");
  const [leaseSort, setLeaseSort]               = useState<"expiry" | "rent">("expiry");
  const [leaseSearch, setLeaseSearch]           = useState("");
  const [leasePageSize, setLeasePageSize]       = useState(10);
  const [leasePage, setLeasePage]               = useState(1);
  const [woSearch, setWoSearch]                 = useState("");
  const [woPageSize, setWoPageSize]             = useState(10);
  const [woPage, setWoPage]                     = useState(1);

  // ── Data fetching from real endpoints ─────────────────────────────────────

  // Tenants carry lease data (leaseStartDate, leaseEndDate, monthlyRent, status)
  const { data: tenantsRaw, isLoading: tenantsLoading, refetch: refetchTenants } = useQuery<any>({
    queryKey: ["/api/tenants", "limit200"],
    queryFn: async () => (await apiRequest("/api/tenants?limit=200")).json(),
    staleTime: 5 * 60 * 1000,
  });

  // Work orders
  const { data: workOrdersRaw, isLoading: woLoading, refetch: refetchWO } = useQuery<any>({
    queryKey: ["/api/work-orders", "limit200"],
    queryFn: async () => (await apiRequest("/api/work-orders?limit=200")).json(),
    staleTime: 5 * 60 * 1000,
  });

  // Maintenance requests (for cross-reference in work orders)
  const { data: maintRaw } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    staleTime: 5 * 60 * 1000,
  });

  // Properties + units for KPI strip
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

  const { data: dashMetrics } = useQuery<any>({
    queryKey: ["/api/dashboard/metrics"],
    queryFn: async () => (await apiRequest("/api/dashboard/metrics")).json(),
    staleTime: 5 * 60 * 1000,
  });

  // ── Normalise paginated responses ─────────────────────────────────────────

  const tenants: any[] = useMemo(() =>
    Array.isArray(tenantsRaw) ? tenantsRaw : (tenantsRaw?.results ?? []),
    [tenantsRaw]);

  const workOrders: any[] = useMemo(() =>
    Array.isArray(workOrdersRaw) ? workOrdersRaw : (workOrdersRaw?.results ?? []),
    [workOrdersRaw]);

  const maint: any[]  = Array.isArray(maintRaw) ? maintRaw : [];
  const props: any[]  = Array.isArray(propsRaw) ? propsRaw : [];
  const units_: any[] = Array.isArray(unitsRaw) ? unitsRaw : [];

  // ── Work order status mutation ────────────────────────────────────────────

  const updateWOMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest(`/api/work-orders/${id}`, {
        method: "PUT",
        data: { status },
      });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Work order updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  // ── Derived lease data (from tenants) ────────────────────────────────────

  const leasesEnriched = useMemo(() => tenants.map(t => {
    const days = daysUntil(t.leaseEndDate);
    const leaseStatus =
      days === null    ? "active" :
      days < 0         ? "expired" :
      days <= 60        ? "expiring" :
                          t.status === "active" ? "active" : t.status;
    return { ...t, leaseStatus, daysUntilExpiry: days };
  }), [tenants]);

  const filteredLeases = useMemo(() => {
    const q = leaseSearch.trim().toLowerCase();
    const f = leasesEnriched.filter(l => {
      const statusOk = leaseFilter === "all" || l.leaseStatus === leaseFilter;
      const searchOk = !q || [
        l.firstName, l.lastName, l.email, l.phone, l.unitNumber,
      ].some(v => (v ?? "").toLowerCase().includes(q));
      return statusOk && searchOk;
    });
    return [...f].sort((a, b) =>
      leaseSort === "expiry"
        ? (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)
        : Number(b.monthlyRent ?? 0) - Number(a.monthlyRent ?? 0)
    );
  }, [leasesEnriched, leaseFilter, leaseSort, leaseSearch]);

  const leaseTotalPages = Math.max(1, Math.ceil(filteredLeases.length / leasePageSize));
  const safeLeasePage   = Math.min(leasePage, leaseTotalPages);
  const leasePageSlice  = filteredLeases.slice(
    (safeLeasePage - 1) * leasePageSize, safeLeasePage * leasePageSize
  );

  // ── Work order filtering ──────────────────────────────────────────────────

  const filteredWO = useMemo(() => {
    const q = woSearch.trim().toLowerCase();
    return workOrders.filter(wo => {
      const statusOk = woFilter === "all" || wo.status === woFilter;
      const typeOk   = woTypeFilter === "all" || wo.workOrderType === woTypeFilter;
      const searchOk = !q || [
        wo.title, wo.description, wo.ticketNumber, wo.assignedTo, wo.workOrderType,
      ].some(v => (v ?? "").toLowerCase().includes(q));
      return statusOk && typeOk && searchOk;
    });
  }, [workOrders, woFilter, woTypeFilter, woSearch]);

  const woTotalPages = Math.max(1, Math.ceil(filteredWO.length / woPageSize));
  const safeWoPage   = Math.min(woPage, woTotalPages);
  const woPageSlice  = filteredWO.slice(
    (safeWoPage - 1) * woPageSize, safeWoPage * woPageSize
  );

  // ── Portfolio KPIs ────────────────────────────────────────────────────────

  const totalProperties  = dashMetrics?.totalProperties ?? props.length;
  const totalUnits       = dashMetrics?.totalUnits      ?? units_.length;
  const occupiedUnits    = dashMetrics?.occupiedUnits   ?? units_.filter((u: any) => u.isOccupied).length;
  const occupancyRate    = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  const activeLeasesCount   = leasesEnriched.filter(l => l.leaseStatus === "active").length;
  const expiringLeasesCount = leasesEnriched.filter(l => l.leaseStatus === "expiring").length;
  const expiredLeasesCount  = leasesEnriched.filter(l => l.leaseStatus === "expired").length;

  const totalMonthlyRent = tenants
    .filter(t => t.status === "active")
    .reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);

  const openWOCount    = workOrders.filter(w => !["completed", "cancelled", "rejected"].includes(w.status)).length;
  const woTotalCost    = workOrders.reduce((s, w) => s + Number(w.actualCost ?? w.estimatedCost ?? 0), 0);

  // ── Maintenance cross-reference for analytics tab ─────────────────────────

  const maintByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    maint.forEach(r => { map[r.status] = (map[r.status] || 0) + 1; });
    return map;
  }, [maint]);

  const maintByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    maint.forEach(r => { const c = r.category || "other"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [maint]);

  const propRevenue = useMemo(() => props.map(p => {
    const pUnits = units_.filter(u => u.propertyId === p.id);
    const rev = tenants
      .filter(t => pUnits.some(u => u.id === t.unitId) && t.status === "active")
      .reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);
    const occ = pUnits.filter(u => u.isOccupied).length;
    return { name: p.name, revenue: rev, units: pUnits.length, occupied: occ };
  }), [props, units_, tenants]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Facility Management
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Lease administration, work orders, and portfolio analytics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchTenants();
                refetchWO();
                toast({ title: "Data refreshed" });
              }}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setWoDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Work Order
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title="Total Properties" value={totalProperties} sub={`${totalUnits} units total`}
            icon={Building2} iconColor="text-blue-600" bgColor="bg-blue-50 dark:bg-blue-950"
          />
          <KPICard
            title="Occupancy Rate" value={`${occupancyRate}%`} sub={`${occupiedUnits}/${totalUnits} occupied`}
            icon={Home} iconColor="text-green-600" bgColor="bg-green-50 dark:bg-green-950"
            trend={occupancyRate >= 85
              ? { direction: "up",   label: "Healthy" }
              : { direction: "down", label: "Below target" }}
          />
          <KPICard
            title="Monthly Rent Roll" value={fmtKES(totalMonthlyRent)} sub={`${activeLeasesCount} active leases`}
            icon={DollarSign} iconColor="text-purple-600" bgColor="bg-purple-50 dark:bg-purple-950"
            trend={expiringLeasesCount > 0
              ? { direction: "down", label: `${expiringLeasesCount} expiring` }
              : { direction: "neutral", label: "All leases current" }}
          />
          <KPICard
            title="Open Work Orders" value={openWOCount} sub={`${fmtKES(woTotalCost)} YTD cost`}
            icon={Wrench} iconColor="text-orange-600" bgColor="bg-orange-50 dark:bg-orange-950"
            trend={openWOCount > 0
              ? { direction: "down", label: `${workOrders.filter(w => w.priority === "critical" || w.priority === "urgent").length} critical` }
              : { direction: "up", label: "All clear" }}
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 rounded-xl h-10">
            <TabsTrigger value="leases" className="flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> Lease Administration
            </TabsTrigger>
            <TabsTrigger value="workorders" className="flex items-center gap-1.5">
              <Wrench className="w-4 h-4" /> Work Orders
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" /> Portfolio Analytics
            </TabsTrigger>
          </TabsList>

          {/* ── LEASE ADMINISTRATION ────────────────────────────────────── */}
          <TabsContent value="leases" className="space-y-4">

            {/* Lease summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Active",        count: activeLeasesCount,   cls: "text-green-600",  bg: "bg-green-50 dark:bg-green-950"  },
                { label: "Expiring <60d", count: expiringLeasesCount, cls: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950" },
                { label: "Expired",       count: expiredLeasesCount,  cls: "text-red-600",    bg: "bg-red-50 dark:bg-red-950"      },
                { label: "Total Tenants", count: tenants.length,      cls: "text-blue-600",   bg: "bg-blue-50 dark:bg-blue-950"    },
              ].map(s => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base">Lease Administration</CardTitle>
                    <CardDescription>Track agreements, critical dates, and rent roll</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={leaseSearch}
                        onChange={e => { setLeaseSearch(e.target.value); setLeasePage(1); }}
                        placeholder="Search tenants…"
                        className="pl-8 pr-7 h-8 w-44 text-xs"
                      />
                      {leaseSearch && (
                        <button onClick={() => { setLeaseSearch(""); setLeasePage(1); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <Select value={leaseFilter} onValueChange={v => { setLeaseFilter(v); setLeasePage(1); }}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="expiring">Expiring soon</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={leaseSort} onValueChange={v => setLeaseSort(v as any)}>
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expiry">Sort by expiry</SelectItem>
                        <SelectItem value="rent">Sort by rent</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Page-size pills */}
                    <div className="flex items-center gap-1">
                      {[5, 10, 20, 50].map(n => (
                        <button key={n} onClick={() => { setLeasePageSize(n); setLeasePage(1); }}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${leasePageSize === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {tenantsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
                    ))}
                  </div>
                ) : filteredLeases.length === 0 ? (
                  <Empty message="No leases match the selected filter" icon={FileText} />
                ) : (
                  <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Showing {Math.min((safeLeasePage - 1) * leasePageSize + 1, filteredLeases.length)}–{Math.min(safeLeasePage * leasePageSize, filteredLeases.length)} of {filteredLeases.length} lease{filteredLeases.length !== 1 ? "s" : ""}
                    {leaseSearch && ` matching "${leaseSearch}"`}
                  </p>
                  <div className="space-y-3">
                    {leasePageSlice.map(lease => (
                      <div
                        key={lease.id}
                        className={`p-4 rounded-xl border-l-4 border border-border ${
                          lease.leaseStatus === "expired"   ? "border-l-red-500 bg-red-50/30 dark:bg-red-950/20" :
                          lease.leaseStatus === "expiring"  ? "border-l-yellow-500 bg-yellow-50/30 dark:bg-yellow-950/20" :
                          "border-l-green-500"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm text-foreground">
                                {lease.firstName} {lease.lastName}
                              </p>
                              <StatusBadge status={lease.leaseStatus} />
                              {lease.daysUntilExpiry !== null && lease.daysUntilExpiry <= 60 && (
                                <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                  {lease.daysUntilExpiry < 0
                                    ? `Expired ${Math.abs(lease.daysUntilExpiry)}d ago`
                                    : `${lease.daysUntilExpiry}d left`}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Unit {lease.unitNumber ?? "N/A"} · {lease.email}
                            </p>
                          </div>
                          <p className="font-bold text-sm text-foreground">{fmtKES(lease.monthlyRent)}/mo</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                          <div>
                            <span className="text-muted-foreground">Lease Start</span>
                            <p className="font-medium mt-0.5">{fmtDate(lease.leaseStartDate)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Lease End</span>
                            <p className="font-medium mt-0.5">{fmtDate(lease.leaseEndDate)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Annual Value</span>
                            <p className="font-medium mt-0.5">{fmtKES(Number(lease.monthlyRent ?? 0) * 12)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Phone</span>
                            <p className="font-medium mt-0.5">{lease.phone || "—"}</p>
                          </div>
                        </div>

                        {lease.leaseStatus === "expiring" && (
                          <div className="mt-3 p-2.5 bg-yellow-50 dark:bg-yellow-950/40 rounded-lg border border-yellow-200 dark:border-yellow-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                            <span className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
                              Lease expires in {lease.daysUntilExpiry} day(s) — contact tenant to discuss renewal
                            </span>
                          </div>
                        )}
                        {lease.leaseStatus === "expired" && (
                          <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-950/40 rounded-lg border border-red-200 dark:border-red-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <span className="text-xs font-medium text-red-800 dark:text-red-200">
                              Lease expired {Math.abs(lease.daysUntilExpiry!)}d ago — action required
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {leaseTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        Page {safeLeasePage} of {leaseTotalPages}
                      </p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setLeasePage(p => Math.max(1, p - 1))} disabled={safeLeasePage === 1}
                          className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          ‹ Prev
                        </button>
                        {Array.from({ length: Math.min(leaseTotalPages, 5) }, (_, i) => {
                          const start = Math.max(1, Math.min(safeLeasePage - 2, leaseTotalPages - 4));
                          const page  = start + i;
                          return page <= leaseTotalPages ? (
                            <button key={page} onClick={() => setLeasePage(page)}
                              className={`text-xs w-7 h-7 rounded-md border transition-colors ${page === safeLeasePage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                              {page}
                            </button>
                          ) : null;
                        })}
                        <button onClick={() => setLeasePage(p => Math.min(leaseTotalPages, p + 1))} disabled={safeLeasePage === leaseTotalPages}
                          className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          Next ›
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── WORK ORDERS ─────────────────────────────────────────────── */}
          <TabsContent value="workorders" className="space-y-4">

            {/* Work order summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Open",        count: workOrders.filter(w => ["draft","pending_approval","approved"].includes(w.status)).length, cls: "text-gray-600",   bg: "bg-gray-50 dark:bg-gray-900" },
                { label: "In Progress", count: workOrders.filter(w => w.status === "in_progress").length, cls: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-950" },
                { label: "Completed",   count: workOrders.filter(w => w.status === "completed").length,   cls: "text-green-600",  bg: "bg-green-50 dark:bg-green-950"   },
                { label: "Critical",    count: workOrders.filter(w => ["critical","urgent"].includes(w.priority)).length, cls: "text-red-600", bg: "bg-red-50 dark:bg-red-950" },
              ].map(s => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base">Work Orders</CardTitle>
                    <CardDescription>
                      {filteredWO.length} of {workOrders.length} work order{workOrders.length !== 1 ? "s" : ""} shown
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={woSearch}
                        onChange={e => { setWoSearch(e.target.value); setWoPage(1); }}
                        placeholder="Search work orders…"
                        className="pl-8 pr-7 h-8 w-48 text-xs"
                      />
                      {woSearch && (
                        <button onClick={() => { setWoSearch(""); setWoPage(1); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <Select value={woFilter} onValueChange={v => { setWoFilter(v); setWoPage(1); }}>
                      <SelectTrigger className="w-36 h-8 text-xs">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="pending_approval">Pending approval</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="assigned">Assigned</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="on_hold">On hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={woTypeFilter} onValueChange={v => { setWoTypeFilter(v); setWoPage(1); }}>
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue placeholder="All types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                        <SelectItem value="preventive">Preventive</SelectItem>
                        <SelectItem value="inspection">Inspection</SelectItem>
                        <SelectItem value="project">Project</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Page-size pills */}
                    <div className="flex items-center gap-1">
                      {[5, 10, 20, 50].map(n => (
                        <button key={n} onClick={() => { setWoPageSize(n); setWoPage(1); }}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${woPageSize === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {woLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
                    ))}
                  </div>
                ) : filteredWO.length === 0 ? (
                  <Empty message="No work orders match the selected filters" icon={Wrench} />
                ) : (
                  <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Showing {Math.min((safeWoPage - 1) * woPageSize + 1, filteredWO.length)}–{Math.min(safeWoPage * woPageSize, filteredWO.length)} of {filteredWO.length} work order{filteredWO.length !== 1 ? "s" : ""}
                    {woSearch && ` matching "${woSearch}"`}
                  </p>
                  <div className="space-y-3">
                    {woPageSlice.map(wo => {
                      const isCritical = ["critical", "urgent"].includes(wo.priority);
                      const isActive   = ["in_progress", "assigned"].includes(wo.status);
                      // Compute a progress % from dates if available
                      let progress = 0;
                      if (wo.estimatedStartDate && wo.estimatedEndDate) {
                        const start = new Date(wo.estimatedStartDate).getTime();
                        const end   = new Date(wo.estimatedEndDate).getTime();
                        const now   = Date.now();
                        if (end > start) progress = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
                      }
                      return (
                        <div
                          key={wo.id}
                          className={`p-4 rounded-xl border border-border ${isActive ? "bg-orange-50/30 dark:bg-orange-950/10" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isActive && <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse flex-shrink-0" />}
                                {wo.status === "completed" && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                                <p className="font-semibold text-sm text-foreground truncate">{wo.title}</p>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                #{wo.ticketNumber} · {wo.workOrderType}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <StatusBadge status={wo.priority} />
                              <StatusBadge status={wo.status} />
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs px-2"
                                onClick={() => setEditWo(wo)}
                              >
                                <Edit className="w-3 h-3 mr-1" /> Edit
                              </Button>
                            </div>
                          </div>

                          {wo.description && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{wo.description}</p>
                          )}

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                            <div>
                              <span className="text-muted-foreground">Assigned To</span>
                              <p className="font-medium mt-0.5">{wo.assignedTo || "Unassigned"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Est. Cost</span>
                              <p className="font-medium mt-0.5">{wo.estimatedCost ? fmtKES(wo.estimatedCost) : "—"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Actual Cost</span>
                              <p className="font-medium mt-0.5">{wo.actualCost ? fmtKES(wo.actualCost) : "Pending"}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Due Date</span>
                              <p className="font-medium mt-0.5">{fmtDate(wo.estimatedEndDate)}</p>
                            </div>
                          </div>

                          {wo.status === "in_progress" && wo.estimatedStartDate && wo.estimatedEndDate && (
                            <div className="mt-3">
                              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Time progress</span>
                                <span>{progress}%</span>
                              </div>
                              <Progress value={progress} className="h-1.5" />
                            </div>
                          )}

                          {/* Quick status actions */}
                          <div className="mt-3 flex gap-2 flex-wrap">
                            {wo.status === "draft" && (
                              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => updateWOMutation.mutate({ id: wo.id, status: "pending_approval" })}>
                                Submit for Approval
                              </Button>
                            )}
                            {wo.status === "approved" && (
                              <Button size="sm" className="h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                                onClick={() => updateWOMutation.mutate({ id: wo.id, status: "in_progress" })}>
                                Start Work
                              </Button>
                            )}
                            {wo.status === "in_progress" && (
                              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => updateWOMutation.mutate({ id: wo.id, status: "completed" })}>
                                <CheckCircle className="w-3 h-3 mr-1" /> Mark Complete
                              </Button>
                            )}
                            {["draft", "pending_approval", "approved", "assigned", "in_progress"].includes(wo.status) && (
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => updateWOMutation.mutate({ id: wo.id, status: "on_hold" })}>
                                Put On Hold
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {woTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground">
                        Page {safeWoPage} of {woTotalPages}
                      </p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setWoPage(p => Math.max(1, p - 1))} disabled={safeWoPage === 1}
                          className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          ‹ Prev
                        </button>
                        {Array.from({ length: Math.min(woTotalPages, 5) }, (_, i) => {
                          const start = Math.max(1, Math.min(safeWoPage - 2, woTotalPages - 4));
                          const page  = start + i;
                          return page <= woTotalPages ? (
                            <button key={page} onClick={() => setWoPage(page)}
                              className={`text-xs w-7 h-7 rounded-md border transition-colors ${page === safeWoPage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                              {page}
                            </button>
                          ) : null;
                        })}
                        <button onClick={() => setWoPage(p => Math.min(woTotalPages, p + 1))} disabled={safeWoPage === woTotalPages}
                          className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          Next ›
                        </button>
                      </div>
                    </div>
                  )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PORTFOLIO ANALYTICS ─────────────────────────────────────── */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Per-property revenue & occupancy */}
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Revenue by Property</CardTitle>
                  <CardDescription>Monthly rent collected per property</CardDescription>
                </CardHeader>
                <CardContent>
                  {propRevenue.length === 0 ? (
                    <Empty message="No property data available" />
                  ) : (
                    <div className="space-y-4">
                      {propRevenue.map((p, i) => {
                        const rate = p.units > 0 ? Math.round((p.occupied / p.units) * 100) : 0;
                        return (
                          <div key={i} className="space-y-1.5">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium truncate max-w-[55%]">{p.name}</span>
                              <span className="text-muted-foreground text-xs">
                                {p.occupied}/{p.units} units · {fmtKES(p.revenue)}/mo
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Progress value={rate} className="h-2 flex-1" />
                              <span className={`text-xs font-medium w-8 text-right ${
                                rate >= 85 ? "text-green-600" : rate >= 60 ? "text-amber-600" : "text-red-500"
                              }`}>{rate}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Maintenance by status */}
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Maintenance Request Status</CardTitle>
                  <CardDescription>Live breakdown of all maintenance requests</CardDescription>
                </CardHeader>
                <CardContent>
                  {maint.length === 0 ? (
                    <Empty message="No maintenance data available" icon={Wrench} />
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(maintByStatus).map(([status, count], i) => {
                        const total = maint.length;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={status} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={status} />
                              </div>
                              <span className="text-muted-foreground">{count} ({pct}%)</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Maintenance by category */}
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Maintenance by Category</CardTitle>
                  <CardDescription>Most common maintenance request types</CardDescription>
                </CardHeader>
                <CardContent>
                  {maintByCategory.length === 0 ? (
                    <Empty message="No maintenance data available" icon={Wrench} />
                  ) : (
                    <div className="space-y-3">
                      {maintByCategory.map(([cat, count], i) => {
                        const max = maintByCategory[0][1];
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="text-xs capitalize text-muted-foreground w-24 flex-shrink-0 truncate">{cat}</span>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all"
                                style={{ width: `${Math.round((count / max) * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium text-foreground w-6 text-right">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Lease health summary */}
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Lease Health Summary</CardTitle>
                  <CardDescription>Portfolio lease status overview</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-green-50 dark:bg-green-950 rounded-xl">
                      <p className="text-2xl font-semibold text-green-600">{activeLeasesCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Active</p>
                    </div>
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-xl">
                      <p className="text-2xl font-semibold text-yellow-600">{expiringLeasesCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Expiring &lt;60d</p>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-950 rounded-xl">
                      <p className="text-2xl font-semibold text-red-600">{expiredLeasesCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Expired</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total annual rent roll</span>
                      <span className="font-semibold">{fmtKES(totalMonthlyRent * 12)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">At-risk (expiring leases)</span>
                      <span className="font-semibold text-yellow-600">
                        {fmtKES(leasesEnriched.filter(l => l.leaseStatus === "expiring").reduce((s, l) => s + Number(l.monthlyRent ?? 0), 0) * 12)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Work order spend (est.)</span>
                      <span className="font-semibold">{fmtKES(woTotalCost)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Work Order Dialog — requires a contractorId; passing 0 lets the form select one */}
      <CreateWorkOrderDialog
        open={woDialogOpen}
        onOpenChange={setWoDialogOpen}
        contractorId={0}
      />

      {/* Edit Work Order Dialog */}
      {editWo && (
        <EditWorkOrderDialog
          open={!!editWo}
          onOpenChange={open => { if (!open) setEditWo(null); }}
          workOrder={editWo}
        />
      )}
    </div>
  );
};

export default FacilityManagement;