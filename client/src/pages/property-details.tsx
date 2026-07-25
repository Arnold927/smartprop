import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LayoutGrid, Users, PieChart, Mail, Phone, Home,
  Building2, CalendarDays, Shield,
  Search, X, ChevronLeft, ChevronRight, Filter, ExternalLink,
} from "lucide-react";
import { usePropertyDetails } from "@/hooks/modules/usePropertyDetails";
import { useAuth } from "@/hooks/useAuth";
import { PropertyHeader } from "@/components/property/PropertyHeader";
import { PropertyUnitCard } from "@/components/property/PropertyUnitCard";
import { ViewTenantDialog } from "@/components/property/ViewTenantDialog";
import AddTenantDialog, { type TenantFormValues } from "@/components/add-tenant-dialog";
import AddUnitDialog from "@/components/add-unit-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Tenant } from "@/types/tenant";
import { Unit } from "@/types/unit";
import {
  PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { RegulatoryCompliancePanel } from "@/components/regulatory-compliance-panel";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

const STATUS_COLORS: Record<string, string> = {
  active:   "#22c55e",
  inactive: "#94a3b8",
  pending:  "#f59e0b",
};

const PAGE_SIZES = [8, 16, 32];

/** Reusable toolbar: search + page-size selector + result count */
function TabToolbar({
  search, onSearch,
  pageSize, onPageSize,
  total, filtered,
  placeholder,
}: {
  search: string; onSearch: (v: string) => void;
  pageSize: number; onPageSize: (v: number) => void;
  total: number; filtered: number;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap mb-4">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="pl-8 h-9 text-sm border-border dark:border-gray-700"
        />
        {search && (
          <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => onSearch("")}>
            <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Show</span>
        <Select value={String(pageSize)} onValueChange={v => onPageSize(Number(v))}>
          <SelectTrigger className="w-20 h-9 border-border dark:border-gray-700 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map(n => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>per page</span>
      </div>

      <span className="text-sm text-muted-foreground ml-auto">
        {filtered} of {total} result{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

/** Reusable pagination row */
function Pagination({
  page, totalPages, onPage, pageSize, filtered,
}: {
  page: number; totalPages: number; onPage: (p: number) => void;
  pageSize: number; filtered: number;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, filtered);
  return (
    <div className="flex items-center justify-between mt-5">
      <p className="text-sm text-muted-foreground">Showing {start}–{end} of {filtered}</p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page === 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
          .reduce<(number | "…")[]>((acc, n, idx, arr) => {
            if (idx > 0 && n - (arr[idx - 1] as number) > 1) acc.push("…");
            acc.push(n);
            return acc;
          }, [])
          .map((n, i) => n === "…"
            ? <span key={`e${i}`} className="px-1 text-muted-foreground text-sm">…</span>
            : <Button key={n} variant={n === page ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-sm" onClick={() => onPage(n as number)}>{n}</Button>
          )}
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function PropertyDetailsPage() {
  const [, params] = useRoute("/properties/:id");
  const propertyId = params?.id;

  const { property, isLoading, updateUnitStatusMutation } = usePropertyDetails(propertyId);
  const { user } = useAuth();
  // Previously admin/manager only, on the assumption a PM always handles this.
  // Landlords self-manage in many cases, and /api/tenants already allows the
  // landlord role server-side (see STAFF_AND_ABOVE in requireRole.ts) — this
  // was purely a frontend restriction with no matching backend enforcement.
  const isManager = user?.role === "admin" || user?.role === "manager" || user?.role === "landlord";
  const queryClient = useQueryClient();
  const organizationId = user?.organizationId ?? 0;

  const [, navigate] = useLocation();

  const [isAddUnitOpen,   setIsAddUnitOpen]   = useState(false);
  const [isAddTenantOpen, setIsAddTenantOpen] = useState(false);
  const [selectedTenant,  setSelectedTenant]  = useState<Tenant | null>(null);
  const [isViewTenantOpen, setIsViewTenantOpen] = useState(false);

  // Units tab state
  const [unitSearch,   setUnitSearch]   = useState("");
  const [unitPageSize, setUnitPageSize] = useState(8);
  const [unitPage,     setUnitPage]     = useState(1);

  // Tenants tab state
  const [tenantSearch,   setTenantSearch]   = useState("");
  const [tenantFilter,   setTenantFilter]   = useState<"all" | "active" | "pending" | "inactive">("all");
  const [tenantPageSize, setTenantPageSize] = useState(8);
  const [tenantPage,     setTenantPage]     = useState(1);

  const handleTenantSubmit = async (data: TenantFormValues): Promise<boolean> => {
    try {
      const res = await apiRequest("/api/tenants", {
        method: "POST",
        data: {
          ...data,
          unitId:          data.unitId ? Number(data.unitId) : undefined,
          monthlyRent:     String(Number(data.monthlyRent)),
          securityDeposit: data.securityDeposit ? String(Number(data.securityDeposit)) : undefined,
        },
      });
      if (!res.ok) return false;
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/full`] });
      setIsAddTenantOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!property) return <div className="p-8 text-center text-muted-foreground">Property not found</div>;

  const units:   Unit[]   = property.units   ?? [];
  const tenants: Tenant[] = property.tenants ?? [];
  const stats             = property.stats   ?? {};

  // ── Units filtering & pagination ──
  const filteredUnits = units.filter(u =>
    String(u.unitNumber).toLowerCase().includes(unitSearch.toLowerCase()) ||
    (u.bedrooms != null && String(u.bedrooms).includes(unitSearch)) ||
    (u.isOccupied ? "occupied" : "vacant").includes(unitSearch.toLowerCase())
  );
  const unitTotalPages = Math.max(1, Math.ceil(filteredUnits.length / unitPageSize));
  const unitSafePage   = Math.min(unitPage, unitTotalPages);
  const pagedUnits     = filteredUnits.slice((unitSafePage - 1) * unitPageSize, unitSafePage * unitPageSize);

  // ── Tenants filtering & pagination ──
  const filteredTenants = tenants.filter(t => {
    const matchesSearch =
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      (t.email ?? "").toLowerCase().includes(tenantSearch.toLowerCase()) ||
      (t.phone ?? "").includes(tenantSearch);
    const matchesFilter = tenantFilter === "all" || t.status === tenantFilter;
    return matchesSearch && matchesFilter;
  });
  const tenantTotalPages = Math.max(1, Math.ceil(filteredTenants.length / tenantPageSize));
  const tenantSafePage   = Math.min(tenantPage, tenantTotalPages);
  const pagedTenants     = filteredTenants.slice((tenantSafePage - 1) * tenantPageSize, tenantSafePage * tenantPageSize);

  // ── Analytics ──
  // Use real payment data from the server where available; fall back to rent schedule for potential/loss figures
  const paymentStats        = property.stats ?? {};
  const collectedThisMonth  = Number(paymentStats.collectedThisMonth ?? 0);
  const pendingThisMonth    = Number(paymentStats.pendingThisMonth   ?? 0);
  const collectionRate      = Number(paymentStats.collectionRate     ?? 0);
  const totalInvoicedMonth  = Number(paymentStats.totalInvoicedThisMonth ?? 0);
  const totalMonthlyRent    = units.reduce((s, u) => s + Number(u.monthlyRent ?? 0), 0);
  const occupiedRent        = units.filter(u => u.isOccupied).reduce((s, u) => s + Number(u.monthlyRent ?? 0), 0);
  const vacantLoss          = totalMonthlyRent - occupiedRent;

  // Rent distribution by unit type
  const rentByType: Record<string, { total: number; count: number; min: number; max: number }> = {};
  units.forEach(u => {
    const key = u.bedrooms != null ? (u.bedrooms === 0 ? "Studio" : `${u.bedrooms} Bed`) : "Other";
    if (!rentByType[key]) rentByType[key] = { total: 0, count: 0, min: Infinity, max: -Infinity };
    const r = Number(u.monthlyRent ?? 0);
    rentByType[key].total += r;
    rentByType[key].count++;
    rentByType[key].min = Math.min(rentByType[key].min, r);
    rentByType[key].max = Math.max(rentByType[key].max, r);
  });
  const rentBreakdown = Object.entries(rentByType)
    .map(([name, v]) => ({
      name,
      avgRent: v.count > 0 ? Math.round(v.total / v.count) : 0,
      minRent: v.min === Infinity ? 0 : v.min,
      maxRent: v.max === -Infinity ? 0 : v.max,
      units: v.count,
    }))
    .sort((a, b) => a.avgRent - b.avgRent);

  // Tenant status breakdown
  const tenantStatusData = [
    { name: "Active",   value: tenants.filter(t => t.status === "active").length,   fill: "#22c55e" },
    { name: "Pending",  value: tenants.filter(t => t.status === "pending").length,  fill: "#f59e0b" },
    { name: "Inactive", value: tenants.filter(t => t.status === "inactive").length, fill: "#94a3b8" },
  ].filter(d => d.value > 0);

  // Upcoming / recent lease expirations
  const now = Date.now();
  const expiringLeases = tenants
    .filter(t => t.leaseEndDate)
    .map(t => {
      const daysLeft = Math.ceil((new Date(t.leaseEndDate).getTime() - now) / (1000 * 60 * 60 * 24));
      const unit = units.find(u => u.id === t.unitId);
      return { tenant: t, daysLeft, unit };
    })
    .filter(e => e.daysLeft <= 90 && e.daysLeft > -30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-background">
      <PropertyHeader
        property={property}
        onAddUnit={() => setIsAddUnitOpen(true)}
        onAddTenant={() => setIsAddTenantOpen(true)}
        isManager={isManager}
      />

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <Tabs defaultValue="units" className="space-y-6">
          <TabsList className="bg-card dark:bg-gray-900 border border-border dark:border-gray-800 p-1 rounded-xl inline-flex">
            <TabsTrigger value="units" className="rounded-lg px-6">
              <LayoutGrid className="h-4 w-4 mr-2" /> Units
              <span className="ml-2 text-xs bg-muted dark:bg-gray-800 text-muted-foreground px-1.5 py-0.5 rounded-full">{units.length}</span>
            </TabsTrigger>
            <TabsTrigger value="tenants" className="rounded-lg px-6">
              <Users className="h-4 w-4 mr-2" /> Tenants
              <span className="ml-2 text-xs bg-muted dark:bg-gray-800 text-muted-foreground px-1.5 py-0.5 rounded-full">{tenants.length}</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="rounded-lg px-6">
              <PieChart className="h-4 w-4 mr-2" /> Analytics
            </TabsTrigger>
            <TabsTrigger value="compliance" className="rounded-lg px-6">
              <Shield className="h-4 w-4 mr-2" /> Compliance
            </TabsTrigger>
          </TabsList>

          {/* ── Units tab ── */}
          <TabsContent value="units" className="m-0">
            {units.length === 0 ? (
              <div className="bg-card dark:bg-gray-900 rounded-2xl border border-border dark:border-gray-800 p-12 text-center">
                <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                <h3 className="text-lg font-semibold">No units yet</h3>
                <p className="text-muted-foreground mt-2">Add the first unit to this property.</p>
                {isManager && <Button className="mt-4" onClick={() => setIsAddUnitOpen(true)}>Add Unit</Button>}
              </div>
            ) : (
              <>
                <TabToolbar
                  search={unitSearch} onSearch={v => { setUnitSearch(v); setUnitPage(1); }}
                  pageSize={unitPageSize} onPageSize={v => { setUnitPageSize(v); setUnitPage(1); }}
                  total={units.length} filtered={filteredUnits.length}
                  placeholder="Search by unit number, beds, status…"
                />

                {filteredUnits.length === 0 ? (
                  <div className="bg-card dark:bg-gray-900 rounded-2xl border border-border dark:border-gray-800 py-12 text-center">
                    <p className="text-sm text-muted-foreground">No units match "<span className="font-medium">{unitSearch}</span>"</p>
                    <button className="text-xs text-blue-600 mt-2 hover:underline" onClick={() => setUnitSearch("")}>Clear search</button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                      {pagedUnits.map((unit: Unit) => (
                        <PropertyUnitCard
                          key={unit.id}
                          unit={unit}
                          propertyName={property.name}
                          tenant={tenants.find((t: Tenant) => t.unitId === unit.id) ?? null}
                          onClick={() => {
                            const tenant = tenants.find((t: Tenant) => t.unitId === unit.id);
                            if (tenant) { setSelectedTenant(tenant); setIsViewTenantOpen(true); }
                          }}
                          onToggleVacancy={(unitId, isOccupied) =>
                            updateUnitStatusMutation.mutate({ unitId, isOccupied })
                          }
                          isTogglingVacancy={updateUnitStatusMutation.isPending}
                        />
                      ))}
                    </div>
                    <Pagination page={unitSafePage} totalPages={unitTotalPages} onPage={setUnitPage} pageSize={unitPageSize} filtered={filteredUnits.length} />
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Tenants tab ── */}
          <TabsContent value="tenants">
            {tenants.length === 0 ? (
              <div className="bg-card dark:bg-gray-900 rounded-2xl border border-border dark:border-gray-800 p-12 text-center">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                <h3 className="text-lg font-semibold">No tenants yet</h3>
                <p className="text-muted-foreground mt-2">Add the first tenant to this property.</p>
                {isManager && <Button className="mt-4" onClick={() => setIsAddTenantOpen(true)}>Add Tenant</Button>}
              </div>
            ) : (
              <>
                {/* Toolbar + status filter */}
                <div className="flex items-center gap-3 flex-wrap mb-4">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={tenantSearch}
                      onChange={e => { setTenantSearch(e.target.value); setTenantPage(1); }}
                      placeholder="Search by name, email, phone…"
                      className="pl-8 h-9 text-sm border-border dark:border-gray-700"
                    />
                    {tenantSearch && (
                      <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => { setTenantSearch(""); setTenantPage(1); }}>
                        <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                      </button>
                    )}
                  </div>

                  {/* Status filter */}
                  <Select value={tenantFilter} onValueChange={v => { setTenantFilter(v as any); setTenantPage(1); }}>
                    <SelectTrigger className="w-32 h-9 border-border dark:border-gray-700 text-sm">
                      <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span>Show</span>
                    <Select value={String(tenantPageSize)} onValueChange={v => { setTenantPageSize(Number(v)); setTenantPage(1); }}>
                      <SelectTrigger className="w-20 h-9 border-border dark:border-gray-700 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span>per page</span>
                  </div>

                  <span className="text-sm text-muted-foreground ml-auto">
                    {filteredTenants.length} of {tenants.length} result{tenants.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {filteredTenants.length === 0 ? (
                  <div className="bg-card dark:bg-gray-900 rounded-2xl border border-border dark:border-gray-800 py-12 text-center">
                    <p className="text-sm text-muted-foreground">No tenants match your filters.</p>
                    <button className="text-xs text-blue-600 mt-2 hover:underline" onClick={() => { setTenantSearch(""); setTenantFilter("all"); }}>Clear filters</button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {pagedTenants.map((tenant: Tenant) => {
                        const unit = units.find(u => u.id === tenant.unitId);
                        return (
                          <div
                            key={tenant.id}
                            className="flex items-center gap-4 bg-card dark:bg-gray-900 border border-border dark:border-gray-800 rounded-2xl px-5 py-4 hover:shadow-sm transition-shadow cursor-pointer"
                            onClick={() => { setSelectedTenant(tenant); setIsViewTenantOpen(true); }}
                          >
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-sm font-semibold text-primary">{tenant.firstName?.[0]}{tenant.lastName?.[0]}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-foreground truncate">{tenant.firstName} {tenant.lastName}</p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Home className="h-3 w-3" />{unit ? `Unit ${unit.unitNumber}` : "Unassigned"}
                              </p>
                            </div>
                            <div className="hidden md:flex flex-col gap-1 text-xs text-muted-foreground">
                              {tenant.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{tenant.email}</span>}
                              {tenant.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{tenant.phone}</span>}
                            </div>
                            <div className="hidden sm:block text-right">
                              <p className="text-sm font-semibold text-foreground">KES {Number(tenant.monthlyRent ?? 0).toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">/ month</p>
                            </div>
                            <div className="hidden lg:flex flex-col gap-1 text-xs text-muted-foreground text-right">
                              {tenant.leaseStartDate && <span className="flex items-center gap-1 justify-end"><CalendarDays className="h-3 w-3" />{new Date(tenant.leaseStartDate).toLocaleDateString()}</span>}
                              {tenant.leaseEndDate && <span className="text-orange-500">Ends {new Date(tenant.leaseEndDate).toLocaleDateString()}</span>}
                            </div>
                            <Badge
                              className="capitalize shrink-0"
                              style={{
                                backgroundColor: `${STATUS_COLORS[tenant.status ?? "active"]}20`,
                                color: STATUS_COLORS[tenant.status ?? "active"],
                                borderColor: `${STATUS_COLORS[tenant.status ?? "active"]}40`,
                              }}
                              variant="outline"
                            >
                              {tenant.status ?? "active"}
                            </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-blue-600"
                            title="View full profile"
                            onClick={e => { e.stopPropagation(); navigate(`/tenants/${tenant.id}`); }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          </div>
                        );
                      })}
                    </div>
                    <Pagination page={tenantSafePage} totalPages={tenantTotalPages} onPage={setTenantPage} pageSize={tenantPageSize} filtered={filteredTenants.length} />
                  </>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Analytics tab ── */}
          <TabsContent value="analytics" className="m-0 space-y-6">

            {/* ── Row 1: Revenue summary banner ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Collected income — from actual paid payments this month */}
              <Card className="rounded-2xl shadow-none border-border dark:border-gray-800 md:col-span-1">
                <CardContent className="p-5">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">Collected This Month</p>
                  <p className="text-3xl font-black text-green-600 dark:text-green-400">
                    KES {collectedThisMonth.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {collectedThisMonth === 0 ? "No payments recorded yet this month" : "from confirmed payments this month"}
                  </p>

                  {/* Collection rate bar — paid vs invoiced over last 12 months */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Collection rate (12 mo)</span>
                      <span className={`font-semibold ${collectionRate >= 80 ? "text-green-600" : collectionRate >= 60 ? "text-amber-600" : "text-red-500"}`}>
                        {collectionRate}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${collectionRate >= 80 ? "bg-green-500" : collectionRate >= 60 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{ width: `${collectionRate}%` }}
                      />
                    </div>
                  </div>

                  {/* Pending this month */}
                  {pendingThisMonth > 0 && (
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-amber-600 dark:text-amber-400 font-medium">Pending / overdue</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">KES {pendingThisMonth.toLocaleString()}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Potential vs loss */}
              <Card className="rounded-2xl shadow-none border-border dark:border-gray-800 md:col-span-2">
                <CardContent className="p-5 h-full flex flex-col justify-between">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Revenue breakdown</p>
                  <div className="grid grid-cols-2 gap-6 flex-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Potential (full occupancy)</p>
                      <p className="text-2xl font-semibold text-foreground mt-0.5">KES {totalMonthlyRent.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Lost to vacancy</p>
                      <p className={`text-2xl font-bold mt-0.5 ${vacantLoss > 0 ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                        {vacantLoss > 0 ? `- KES ${vacantLoss.toLocaleString()}` : "KES 0"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Invoiced this month</p>
                      <p className="text-2xl font-semibold text-foreground mt-0.5">KES {totalInvoicedMonth.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Collected this month</p>
                      <p className={`text-2xl font-bold mt-0.5 ${collectedThisMonth > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                        KES {collectedThisMonth.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {/* Stacked bar: collected vs pending vs vacant */}
                  {totalMonthlyRent > 0 && (
                    <div className="mt-4">
                      <div className="h-3 rounded-full overflow-hidden flex">
                        <div className="bg-green-500 h-3" style={{ width: `${Math.round((collectedThisMonth / totalMonthlyRent) * 100)}%` }} />
                        <div className="bg-amber-400 h-3" style={{ width: `${Math.round((pendingThisMonth / totalMonthlyRent) * 100)}%` }} />
                        <div className="bg-red-300 dark:bg-red-800 h-3 flex-1" />
                      </div>
                      <div className="flex gap-4 text-[11px] text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Collected</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Pending</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-300 dark:bg-red-800 inline-block" /> Vacant</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 2: Rent by unit type (bar) + Tenant status (donut) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Rent by unit type */}
              <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
                <CardHeader className="pb-0 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold">Rent by Unit Type</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Average monthly rent per bedroom configuration</p>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {rentBreakdown.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No unit data</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={rentBreakdown} margin={{ top: 10, right: 10, left: 0, bottom: 5 }} barSize={36}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={36} />
                          <Tooltip
                            formatter={v => [`KES ${Number(v ?? 0).toLocaleString()}`, "Avg Rent"]}
                            contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                          />
                          <Bar dataKey="avgRent" name="Avg Rent" fill="#6366f1" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      {/* Summary rows */}
                      <div className="mt-2 space-y-1.5">
                        {rentBreakdown.map(row => (
                          <div key={row.name} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{row.name} <span className="text-foreground font-medium">({row.units} unit{row.units !== 1 ? "s" : ""})</span></span>
                            <span className="font-semibold text-foreground">KES {row.avgRent.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Tenant status */}
              <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
                <CardHeader className="pb-0 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold">Tenant Status</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""} across this property</p>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {tenantStatusData.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No tenant data yet</div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={180}>
                        <RechartsPie>
                          <Pie
                            data={tenantStatusData}
                            cx="50%" cy="50%"
                            innerRadius={55} outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                          >
                            {tenantStatusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                          </Pie>
                          <Tooltip
                            formatter={(v, name) => [v, name]}
                            contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                          />
                        </RechartsPie>
                      </ResponsiveContainer>
                      {/* Legend rows */}
                      <div className="mt-1 space-y-2">
                        {tenantStatusData.map(d => (
                          <div key={d.name} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                              <span className="text-muted-foreground">{d.name}</span>
                            </span>
                            <span className="font-semibold text-foreground">{d.value} <span className="text-muted-foreground font-normal">({tenants.length > 0 ? Math.round((d.value / tenants.length) * 100) : 0}%)</span></span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 3: Upcoming lease expirations ── */}
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-0 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Lease Expirations</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Leases expiring within the next 90 days</p>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {expiringLeases.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">No leases expiring in the next 90 days</p>
                    <p className="text-xs text-muted-foreground mt-1">All leases are in good standing</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {expiringLeases.map(({ tenant, daysLeft, unit }) => {
                      const isExpired  = daysLeft <= 0;
                      const isUrgent   = daysLeft <= 14 && daysLeft > 0;
                      const isWarning  = daysLeft <= 30 && daysLeft > 14;
                      const urgencyColor = isExpired ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                        : isUrgent  ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                        : isWarning ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800"
                                    : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800" ;
                      return (
                        <div
                          key={tenant.id}
                          className="flex items-center gap-4 rounded-xl border px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => navigate(`/tenants/${tenant.id}`)}
                        >
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-primary">{tenant.firstName?.[0]}{tenant.lastName?.[0]}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{tenant.firstName} {tenant.lastName}</p>
                            <p className="text-xs text-muted-foreground">{unit ? `Unit ${unit.unitNumber}` : "Unassigned"} · ends {new Date(tenant.leaseEndDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${urgencyColor}`}>
                            {isExpired ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

          </TabsContent>

          {/* ── Compliance tab ── */}
          <TabsContent value="compliance" className="m-0">
            <RegulatoryCompliancePanel
              propertyId={Number(propertyId)}
              propertyName={property?.name ?? ""}
            />
          </TabsContent>

        </Tabs>
      </div>

      <AddUnitDialog
        open={isAddUnitOpen}
        onClose={() => setIsAddUnitOpen(false)}
        propertyId={Number(propertyId)}
        organizationId={organizationId}
      />

      {isManager && <AddTenantDialog
        open={isAddTenantOpen}
        onClose={() => setIsAddTenantOpen(false)}
        units={units}
        onSubmit={handleTenantSubmit}
      />}

      <ViewTenantDialog
        tenant={selectedTenant}
        open={isViewTenantOpen}
        onOpenChange={setIsViewTenantOpen}
        unitsData={property.units}
        property={property}
      />
    </div>
  );
}