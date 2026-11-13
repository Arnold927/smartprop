import { downloadExcel } from "@/lib/excel";
import { exportTablePdf, money, todayStamp } from "@/lib/pdf";
import { ExportMenu } from "@/components/export-menu";
import { BulkBar } from "@/components/bulk-bar";
import { BulkMessageDialog } from "@/components/bulk-message-dialog";
import { SavedViewsMenu, ActiveFilters, type FilterChip } from "@/components/saved-views";
import { useRowSelection } from "@/hooks/useRowSelection";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactActions, toWhatsAppNumber } from "@/components/contact-actions";
import { TenantQuickView } from "@/components/tenant-quick-view";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { propertyOptions } from "@/lib/pickerOptions";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Search, Users, Mail, Phone, Building, Calendar,
  Eye, Trash2,
  CheckCircle, Clock, XCircle, X, UserPlus, ChevronRight,
  Shield, MessageCircle, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ComprehensiveTenantModal from "@/components/modals/comprehensive-tenant-modal";
import QueryError from "@/components/query-error";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  status: "active" | "inactive" | "pending";
  monthlyRent?: string | number;
  leaseStartDate?: string;
  leaseEndDate?: string;
  unit?: { id: number; unitNumber: string; propertyId: number };
  property?: { id: number; name: string; address?: string };
}
interface Property { id: number; name: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(date?: string) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

/**
 * Safely coerce any API response to a plain array.
 * The paginated API returns { results: T[], count: N }.
 * Using `= []` as the useQuery default doesn't help — when real data
 * arrives it overwrites the default with the object, and .map() crashes.
 */
function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.results)) return d.results as T[];
    if (Array.isArray(d.data))    return d.data    as T[];
    if (Array.isArray(d.items))   return d.items   as T[];
  }
  return [];
}

// ─── Swipeable mobile row ────────────────────────────────────────────────────

function SwipeTenantCard({
  t,
  onView,
  onOpen,
  onEmail,
  onCall,
  onWhatsApp,
  onDelete,
  selected,
  onToggleSelect,
}: {
  t: Tenant;
  onView: () => void;
  onOpen: () => void;
  onEmail: () => void;
  onCall: () => void;
  onWhatsApp?: () => void;
  onDelete: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(0);
  const THRESHOLD = 60;
  const PANEL_W = 240;

  const days = daysUntil(t.leaseEndDate);

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = startX.current - e.touches[0].clientX;
    if (dx > 0) setSwipeX(Math.min(dx, PANEL_W));
  };
  const onTouchEnd = () => {
    if (swipeX >= THRESHOLD) { setSwiped(true); setSwipeX(PANEL_W); }
    else { setSwiped(false); setSwipeX(0); }
  };
  const closeSwipe = () => { setSwiped(false); setSwipeX(0); };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute right-0 top-0 bottom-0 flex items-stretch" style={{ width: PANEL_W }}>
        <button className="flex-1 bg-emerald-600 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium disabled:opacity-40"
          disabled={!t.phone} onClick={() => { closeSwipe(); onCall(); }}>
          <Phone className="w-4 h-4" />Call
        </button>
        <button className="flex-1 bg-green-600 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium disabled:opacity-40"
          disabled={!onWhatsApp} onClick={() => { closeSwipe(); onWhatsApp?.(); }}>
          <MessageCircle className="w-4 h-4" />WhatsApp
        </button>
        <button className="flex-1 bg-blue-500 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium"
          onClick={() => { closeSwipe(); onView(); }}>
          <Eye className="w-4 h-4" />Profile
        </button>
        <button className="flex-1 bg-red-500 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium"
          onClick={() => { closeSwipe(); onDelete(); }}>
          <Trash2 className="w-4 h-4" />Delete
        </button>
      </div>

      <div
        className="relative bg-card border-b border-border px-4 py-3 transition-transform will-change-transform"
        style={{ transform: `translateX(-${swipeX}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={swipeX > 10 ? closeSwipe : onOpen}
      >
        <div className="flex items-center gap-3">
          {onToggleSelect && (
            <div onClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
              <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} aria-label={`Select ${t.firstName} ${t.lastName}`} />
            </div>
          )}
          <SPAvatar name={`${t.firstName} ${t.lastName}`} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-foreground text-sm truncate">{t.firstName} {t.lastName}</p>
              <SPBadge status={t.status} />
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {t.unit ? `Unit ${t.unit.unitNumber}` : "No unit"} · {t.property?.name ?? "No property"}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {t.monthlyRent && (
                <span className="text-xs font-medium text-foreground">
                  KES {Number(t.monthlyRent).toLocaleString()}
                </span>
              )}
              {days !== null && days > 0 && days <= 60 && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${days <= 14 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                  {days}d left
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Tenants() {
  const guard = useRoleGuard([...ROLES.STAFF_AND_ABOVE, "platform_admin"]);
  if (guard.gate) return guard.gate;

  // ── ALL hooks at the top — never after a conditional return ─────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [quickViewId, setQuickViewId] = useState<number | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const orgIdParam = getOrgIdFromSearch(location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Derive once — used to scope cache keys and conditionally hide UI affordances
  const isLandlord = guard.isLandlord;

  // Include role in the query key so a landlord's scoped results never collide
  // with a manager's full-org results in the shared React Query cache.
  // Also include orgIdParam so a platform_admin switching between orgs gets
  // a fresh cache entry per org, not stale results from whichever org they
  // looked at last.
  const tenantQueryKey = [withOrgParam("/api/tenants", orgIdParam), user?.role ?? "unknown"];
  const propertyQueryKey = [withOrgParam("/api/properties", orgIdParam), user?.role ?? "unknown"];

  // BUG FIX: do NOT use `= []` as the default value.
  // When the API returns { results: [...] } the default is overwritten with the
  // object, and anything calling .map() on it throws immediately.
  // Use `undefined` as default and call toArray() after.
  const { data: tenantsRaw, isLoading, isError: tenantsError, refetch: refetchTenants } = useQuery<any>({
    queryKey: tenantQueryKey,
    queryFn: async () => { const r = await apiRequest(tenantQueryKey[0] as string); return ensureArray(await r.json()); },
    staleTime: 5 * 60 * 1000,
  });

  // No custom queryFn — use the global default so this observer and the modal
  // observer write/read the same shape from the shared cache entry.
  const { data: propsRaw } = useQuery<any>({
    queryKey: propertyQueryKey,
    staleTime: 5 * 60 * 1000,
    select: (d: unknown) => ensureArray(d),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(withOrgParam(`/api/tenants/${id}`, orgIdParam), { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantQueryKey });
      toast({ title: "Tenant removed" });
    },
    onError: () => toast({ title: "Failed to remove tenant", variant: "destructive" }),
  });

  // ── Derive arrays AFTER all hooks — safe to do here ────────────────────────
  const tenants: Tenant[] = toArray<Tenant>(tenantsRaw);

  // BUG FIX for SelectItem: filter out any property whose id is null/undefined/""
  // before rendering — Radix throws if value="" is passed to a SelectItem.
  const properties: Property[] = toArray<Property>(propsRaw).filter(
    (p) => p.id != null && String(p.id).trim() !== ""
  );

  const stats = {
    active:   tenants.filter(t => t.status === "active").length,
    pending:  tenants.filter(t => t.status === "pending").length,
    inactive: tenants.filter(t => t.status === "inactive").length,
    expiring: tenants.filter(t => { const d = daysUntil(t.leaseEndDate); return d !== null && d > 0 && d <= 30; }).length,
  };

  const filtered = tenants.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q) ||
      t.phone?.includes(q) ||
      t.unit?.unitNumber?.toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    const matchProp = propertyFilter === "all" || String(t.property?.id) === propertyFilter;
    return matchSearch && matchStatus && matchProp;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const resetPage = () => setCurrentPage(1);

  const handleSearchChange = (val: string) => { setSearch(val); resetPage(); };
  const handleStatusChange = (val: string) => { setStatusFilter(val); resetPage(); };
  const handlePropertyChange = (val: string) => { setPropertyFilter(val); resetPage(); };
  const handleClearFilters = () => { setSearch(""); setStatusFilter("all"); setPropertyFilter("all"); resetPage(); };

  // ── Selection, saved views, exports ───────────────────────────────────────
  const selection = useRowSelection(filtered, (t: Tenant) => t.id);
  const canMessage = ["admin", "manager", "platform_admin"].includes(String(user?.role ?? ""));

  const filterState = { search, status: statusFilter, property: propertyFilter };
  const applyFilters = (f: typeof filterState) => {
    setSearch(f.search ?? ""); setStatusFilter(f.status ?? "all"); setPropertyFilter(f.property ?? "all"); resetPage();
  };
  const filterChips: FilterChip[] = [
    search && { key: "q", label: `"${search}"`, onClear: () => handleSearchChange("") },
    statusFilter !== "all" && { key: "st", label: `Status: ${statusFilter}`, onClear: () => handleStatusChange("all") },
    propertyFilter !== "all" && { key: "pp", label: properties.find(p => String(p.id) === propertyFilter)?.name ?? "Property", onClear: () => handlePropertyChange("all") },
  ].filter(Boolean) as FilterChip[];

  const exportExcel = (list: Tenant[]) => {
    downloadExcel(
      `tenants-${todayStamp()}`,
      ["Name", "Email", "Phone", "Status", "Monthly Rent", "Unit", "Property", "Lease End"],
      list.map(t => [
        `${t.firstName} ${t.lastName}`, t.email, t.phone ?? "", t.status,
        t.monthlyRent != null && t.monthlyRent !== "" ? Number(t.monthlyRent) : "",
        t.unit?.unitNumber ?? "", t.property?.name ?? "", t.leaseEndDate ?? "",
      ]),
      "Tenants",
    );
  };

  const exportPdf = async (list: Tenant[]) => {
    const rent = list.reduce((s, t) => s + (Number(t.monthlyRent) || 0), 0);
    await exportTablePdf({
      title: "Tenant register",
      docLabel: "Tenants",
      caption: "Tenants with unit, contact details and lease dates",
      filters: filterChips.map(c => c.label),
      kpis: [
        { label: "Tenants", value: list.length, tone: "green" },
        { label: "Active", value: list.filter(t => t.status === "active").length },
        { label: "Monthly rent roll", value: money(rent), tone: "blue" },
        { label: "Leases ending in 30 days", value: list.filter(t => { const d = daysUntil(t.leaseEndDate); return d !== null && d > 0 && d <= 30; }).length, tone: "amber" },
      ],
      columns: [
        { header: "Tenant", width: 20 }, { header: "Unit", width: 7 }, { header: "Property", width: 17 },
        { header: "Phone", width: 14 }, { header: "Email", width: 24 }, { header: "Status", width: 9 },
        { header: "Rent (KES)", align: "right", width: 11 }, { header: "Lease ends", width: 13 },
      ],
      rows: list.map(t => [
        `${t.firstName} ${t.lastName}`, t.unit?.unitNumber ?? "-", t.property?.name ?? "-", t.phone ?? "-", t.email, t.status,
        t.monthlyRent ? Math.round(Number(t.monthlyRent)).toLocaleString("en-KE") : "-",
        t.leaseEndDate ? new Date(t.leaseEndDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-",
      ]),
      totals: ["Total", "", "", "", "", "", Math.round(rent).toLocaleString("en-KE"), ""],
      filename: `tenant-register-${todayStamp()}`,
    });
  };

  // ── Loading state — safe to return here because ALL hooks are above ─────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-2xl" />)}
        </div>
        <div className="h-96 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (tenantsError && !tenantsRaw) {
    return (
      <PageShell>
        <PageHeader title="Tenants" subtitle="" />
        <QueryError what="tenants" onRetry={() => refetchTenants()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Tenants"
        subtitle={`${tenants.length} tenants · ${stats.active} active`}
        icon={<Users className="w-5 h-5" />}
        actions={
          <>
            <ExportMenu
              disabled={filtered.length === 0}
              onPdf={() => exportPdf(filtered)}
              onExcel={() => exportExcel(filtered)}
            />
            {/* Landlords can add tenants to their own properties directly —
                many self-manage without a separate PM. /api/tenant-onboarding
                now allows the landlord role (see requireRole.ts). */}
            <PrimaryButton icon={<UserPlus className="w-4 h-4" />} onClick={() => setIsAddModalOpen(true)}>
              <span className="hidden sm:inline">Add tenant</span>
              <span className="sm:hidden">Add</span>
            </PrimaryButton>
          </>
        }
      />

      {/* Landlord scope notice — shown only to landlords so they know the list is filtered */}
      {isLandlord && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Shield className="w-4 h-4 flex-shrink-0" />
            <span>Showing only tenants in your properties.</span>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <StatsGrid cols={4}>
        <StatTile label="Active" value={stats.active} icon={<CheckCircle className="w-4 h-4" />} accent="emerald" />
        <StatTile label="Pending" value={stats.pending} icon={<Clock className="w-4 h-4" />} accent="amber" />
        <StatTile label="Inactive" value={stats.inactive} icon={<XCircle className="w-4 h-4" />} accent="blue" />
        <StatTile label="Expiring 30d" value={stats.expiring} icon={<Calendar className="w-4 h-4" />} accent={stats.expiring > 0 ? "red" : "blue"} />
      </StatsGrid>

      {/* Toolbar */}
      <FilterBar
        search={search}
        onSearch={handleSearchChange}
        placeholder="Search tenants..."
        filters={
          <>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-32 h-9 border-border text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            <div className="w-full sm:w-52">
              <SearchableSelect
                value={propertyFilter === "all" ? "" : propertyFilter}
                onValueChange={(v) => handlePropertyChange(v || "all")}
                options={propertyOptions(properties)}
                placeholder="All properties"
                searchPlaceholder="Search property…"
                clearable
                className="h-9 text-sm"
              />
            </div>
          </>
        }
        actions={
          <>
            <SavedViewsMenu<typeof filterState> pageKey="tenants" current={filterState} onApply={applyFilters} isEmpty={filterChips.length === 0} />
            <span className="text-sm text-muted-foreground whitespace-nowrap">{filtered.length} results</span>
          </>
        }
      />
      <ActiveFilters chips={filterChips} onClearAll={handleClearFilters} />
      {filtered.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
          <Checkbox
            checked={selection.allSelected ? true : selection.someSelected ? "indeterminate" : false}
            onCheckedChange={() => selection.toggleAll()}
            aria-label="Select all tenants"
          />
          Select all {filtered.length} {filterChips.length ? "matching" : ""} tenants
        </label>
      )}

        {/* MOBILE: card list */}
        {isMobile ? (
          <Card className="rounded-2xl border-border shadow-none overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title={search ? "No tenants match" : "No tenants yet"}
                description={search ? "Try adjusting filters" : isLandlord ? "No tenants are assigned to your properties yet" : "Add your first tenant"}
                action={!search && !isLandlord ? { label: "Add tenant", onClick: () => setIsAddModalOpen(true) } : undefined}
                size="lg"
              />
            ) : (
              <>
                <div className="px-4 py-2 bg-muted border-b border-border">
                  <p className="text-xs text-muted-foreground">Tap a tenant for a summary · swipe left to call, WhatsApp or open the profile</p>
                </div>
                {paginated.map(t => (
                  <SwipeTenantCard
                    key={t.id}
                    t={t}
                    onView={() => navigate(withOrgParam(`/tenants/${t.id}`, orgIdParam))}
                    onOpen={() => setQuickViewId(t.id)}
                    onEmail={() => window.open(`mailto:${t.email}`, "_blank")}
                    onCall={() => t.phone && window.open(`tel:${t.phone}`, "_self")}
                    onWhatsApp={toWhatsAppNumber(t.phone) ? () => window.open(`https://wa.me/${toWhatsAppNumber(t.phone)}?text=${encodeURIComponent(`Hello ${t.firstName}, `)}`, "_blank") : undefined}
                    selected={selection.isSelected(t.id)}
                    onToggleSelect={() => selection.toggle(t.id)}
                    onDelete={() => {
                      if (confirm(`Remove ${t.firstName} ${t.lastName}?`)) {
                        deleteMutation.mutate(t.id);
                      }
                    }}
                  />
                ))}
                {/* Mobile pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card">
                  <span className="text-xs text-muted-foreground">
                    {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</Button>
                    <span className="text-xs px-2">{safePage} / {totalPages}</span>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        ) : (
          /* DESKTOP: table */
          filtered.length === 0 ? (
            <Card className="rounded-xl border-border shadow-sm overflow-hidden">
              <EmptyState
                icon={<Users />}
                title={search ? "No tenants match your search" : "No tenants yet"}
                description={search ? "Try adjusting your filters" : isLandlord ? "No tenants are assigned to your properties yet" : "Add your first tenant to get started"}
                action={!search && !isLandlord ? { label: "Add tenant", onClick: () => setIsAddModalOpen(true) } : undefined}
                size="lg"
              />
            </Card>
          ) : (
              <>
                <SPTable<Tenant>
                  data={paginated}
                  columns={[
                    {
                      header: "",
                      width: "40px",
                      cell: (t) => (
                        <Checkbox checked={selection.isSelected(t.id)} onCheckedChange={() => selection.toggle(t.id)} aria-label={`Select ${t.firstName} ${t.lastName}`} />
                      ),
                    },
                    {
                      header: "Tenant",
                      cell: (t) => (
                        <div
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={() => setQuickViewId(t.id)}
                        >
                          <SPAvatar name={`${t.firstName} ${t.lastName}`} size="sm" />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {t.firstName} {t.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <Mail className="w-3 h-3" />{t.email}
                            </p>
                          </div>
                        </div>
                      ),
                    },
                    {
                      header: "Unit / Property",
                      hideOnMobile: true,
                      cell: (t) => (
                        <>
                          <p className="text-foreground font-medium text-sm">
                            {t.unit
                              ? `Unit ${t.unit.unitNumber}`
                              : <span className="text-muted-foreground">No unit</span>
                            }
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building className="w-3 h-3" />
                            {t.property?.name ?? <span className="italic">No property</span>}
                          </p>
                        </>
                      ),
                    },
                    {
                      header: "Lease",
                      hideOnMobile: true,
                      cell: (t) => {
                        const days = daysUntil(t.leaseEndDate);
                        return t.leaseEndDate ? (
                          <div>
                            <p className="text-sm text-foreground">
                              Ends {new Date(t.leaseEndDate).toLocaleDateString("en-KE", {
                                day: "numeric", month: "short", year: "numeric",
                              })}
                            </p>
                            {days !== null && days <= 60 && days > 0 && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${days <= 14 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                                {days}d left
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No lease</span>
                        );
                      },
                    },
                    {
                      header: "Rent",
                      hideOnMobile: true,
                      cell: (t) => t.monthlyRent
                        ? <KESAmount amount={t.monthlyRent} />
                        : <span className="text-muted-foreground">—</span>,
                    },
                    {
                      header: "Status",
                      cell: (t) => <SPBadge status={t.status} />,
                    },
                    {
                      header: "",
                      align: "right",
                      cell: (t) => (
                        <div className="flex items-center justify-end gap-1.5">
                        <ContactActions phone={t.phone} email={undefined} name={`${t.firstName} ${t.lastName}`} />
                        <ActionMenu
                          items={[
                            { label: "View profile", icon: <Eye className="w-4 h-4" />, onClick: () => navigate(withOrgParam(`/tenants/${t.id}`, orgIdParam)) },
                            { label: "Email", icon: <Mail className="w-4 h-4" />, onClick: () => window.open(`mailto:${t.email}`, "_blank") },
                            ...(t.phone ? [{ label: "Call", icon: <Phone className="w-4 h-4" />, onClick: () => window.open(`tel:${t.phone}`, "_self") }] : []),
                            {
                              label: "Remove", icon: <Trash2 className="w-4 h-4" />, destructive: true,
                              onClick: () => {
                                if (confirm(`Remove ${t.firstName} ${t.lastName}?`)) {
                                  deleteMutation.mutate(t.id);
                                }
                              },
                            },
                          ]}
                        />
                        </div>
                      ),
                    },
                  ]}
                />

                {/* Desktop pagination */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page:</span>
                    <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); resetPage(); }}>
                      <SelectTrigger className="h-8 w-16 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span>
                      {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
                      {(search || statusFilter !== "all" || propertyFilter !== "all") ? ` (filtered from ${tenants.length})` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage(1)} disabled={safePage === 1}>«</Button>
                    <Button variant="outline" size="sm" className="h-8 px-3" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</Button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                      .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((item, idx) =>
                        item === "…" ? (
                          <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground select-none text-sm">…</span>
                        ) : (
                          <Button
                            key={item}
                            variant={item === safePage ? "default" : "outline"}
                            size="sm"
                            className="h-8 w-8 p-0 text-xs"
                            onClick={() => setCurrentPage(item as number)}
                          >
                            {item}
                          </Button>
                        )
                      )}
                    <Button variant="outline" size="sm" className="h-8 px-3" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</Button>
                    <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setCurrentPage(totalPages)} disabled={safePage === totalPages}>»</Button>
                  </div>
                </div>
              </>
            )
        )}

      <BulkBar count={selection.count} noun="tenant" onClear={selection.clear}>
        {canMessage && (
          <Button size="sm" onClick={() => setMessageOpen(true)}><Send className="w-3.5 h-3.5 mr-1.5" />Message</Button>
        )}
        <ExportMenu label="Export selected"
          onPdf={() => exportPdf(selection.selectedItems)}
          onExcel={() => exportExcel(selection.selectedItems)} />
      </BulkBar>

      <BulkMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        tenantIds={selection.selectedItems.map(t => t.id)}
        onSent={selection.clear}
      />

      <TenantQuickView
        tenantId={quickViewId}
        open={quickViewId !== null}
        onOpenChange={(o) => { if (!o) setQuickViewId(null); }}
        profileHref={(id) => withOrgParam(`/tenants/${id}`, orgIdParam)}
      />

      <ComprehensiveTenantModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          queryClient.invalidateQueries({ queryKey: tenantQueryKey });
        }}
        properties={Array.isArray(properties) ? properties : []}
        organizationId={orgIdParam}
      />
    </PageShell>
  );
}