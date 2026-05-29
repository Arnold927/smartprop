import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Search, Users, Mail, Phone, Building, Calendar,
  DollarSign, Eye, Edit, Trash2, MoreVertical, Download,
  CheckCircle, Clock, XCircle, Filter, X, UserPlus, ChevronRight,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import ComprehensiveTenantModal from "@/components/modals/comprehensive-tenant-modal";
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

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    pending: "bg-amber-100 text-amber-700",
    inactive: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${m[status] ?? m.inactive}`}>
      {status}
    </span>
  );
}

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
  onEmail,
  onCall,
  onDelete,
}: {
  t: Tenant;
  onView: () => void;
  onEmail: () => void;
  onCall: () => void;
  onDelete: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(0);
  const THRESHOLD = 60;

  const days = daysUntil(t.leaseEndDate);

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    const dx = startX.current - e.touches[0].clientX;
    if (dx > 0) setSwipeX(Math.min(dx, 180));
  };
  const onTouchEnd = () => {
    if (swipeX >= THRESHOLD) { setSwiped(true); setSwipeX(180); }
    else { setSwiped(false); setSwipeX(0); }
  };
  const closeSwipe = () => { setSwiped(false); setSwipeX(0); };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute right-0 top-0 bottom-0 flex items-stretch" style={{ width: 180 }}>
        <button className="flex-1 bg-blue-500 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium"
          onClick={() => { closeSwipe(); onView(); }}>
          <Eye className="w-4 h-4" />View
        </button>
        <button className="flex-1 bg-amber-500 text-white flex flex-col items-center justify-center gap-1 text-xs font-medium"
          onClick={() => { closeSwipe(); onEmail(); }}>
          <Mail className="w-4 h-4" />Email
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
        onClick={swipeX > 10 ? closeSwipe : undefined}
      >
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 flex-shrink-0">
            <AvatarFallback className="bg-blue-100 text-blue-600 text-sm font-semibold">
              {t.firstName[0]}{t.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-foreground text-sm truncate">{t.firstName} {t.lastName}</p>
              <StatusBadge status={t.status} />
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
  const guard = useRoleGuard(ROLES.STAFF_AND_ABOVE);
  if (guard.gate) return guard.gate;

  // ── ALL hooks at the top — never after a conditional return ─────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Derive once — used to scope cache keys and conditionally hide UI affordances
  const isLandlord = guard.isLandlord;

  // Include role in the query key so a landlord's scoped results never collide
  // with a manager's full-org results in the shared React Query cache.
  const tenantQueryKey = ["/api/tenants", user?.role ?? "unknown"];
  const propertyQueryKey = ["/api/properties", user?.role ?? "unknown"];

  // BUG FIX: do NOT use `= []` as the default value.
  // When the API returns { results: [...] } the default is overwritten with the
  // object, and anything calling .map() on it throws immediately.
  // Use `undefined` as default and call toArray() after.
  const { data: tenantsRaw, isLoading } = useQuery<any>({
    queryKey: tenantQueryKey,
    queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); },
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
      await apiRequest(`/api/tenants/${id}`, { method: "DELETE" });
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

  const handleExport = () => {
    const csv = [
      "Name,Email,Phone,Status,Monthly Rent,Unit,Property,Lease End",
      ...filtered.map(t =>
        `"${t.firstName} ${t.lastName}","${t.email}","${t.phone ?? ""}","${t.status}","${t.monthlyRent ?? ""}","${t.unit?.unitNumber ?? ""}","${t.property?.name ?? ""}","${t.leaseEndDate ?? ""}"`
      ),
    ].join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `tenants-${new Date().toISOString().split("T")[0]}.csv`,
    });
    a.click();
    toast({ title: "Exported", description: `${filtered.length} tenants exported` });
  };

  // ── Loading state — safe to return here because ALL hooks are above ─────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-2xl" />)}
        </div>
        <div className="h-96 bg-muted rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-4 md:py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Tenants</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tenants.length} tenants · {stats.active} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isMobile && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-4 h-4 mr-1.5" /> Export
              </Button>
            )}
            {/* Landlords may not add tenants directly — they don't control all units */}
            {!isLandlord && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setIsAddModalOpen(true)}
              >
                <UserPlus className="w-4 h-4 mr-1.5" />
                <span className="hidden sm:inline">Add tenant</span>
                <span className="sm:hidden">Add</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Landlord scope notice — shown only to landlords so they know the list is filtered */}
      {isLandlord && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 md:px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-blue-700">
            <Shield className="w-4 h-4 flex-shrink-0" />
            <span>Showing only tenants in your properties. Contact a manager to add new tenants.</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {[
            { label: "Active",       value: stats.active,   icon: CheckCircle, color: "green" },
            { label: "Pending",      value: stats.pending,  icon: Clock,       color: "amber" },
            { label: "Inactive",     value: stats.inactive, icon: XCircle,     color: "gray"  },
            { label: "Expiring 30d", value: stats.expiring, icon: Calendar,    color: stats.expiring > 0 ? "red" : "gray" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="rounded-2xl border-border shadow-none">
              <CardContent className="p-4 md:p-5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-${color}-50`}>
                  <Icon className={`w-4 h-4 text-${color}-600`} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tenants..."
              className="pl-9 h-9 border-border"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
            />
            {search && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => handleSearchChange("")}>
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>

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

          {!isMobile && (
            <Select value={propertyFilter} onValueChange={handlePropertyChange}>
              <SelectTrigger className="w-44 h-9 border-border text-sm">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name || `Property #${p.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {(search || statusFilter !== "all" || propertyFilter !== "all") && (
            <Button
              variant="ghost" size="sm" className="h-9 text-muted-foreground"
              onClick={() => handleClearFilters()}
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} results</span>
        </div>

        {/* MOBILE: card list */}
        {isMobile ? (
          <Card className="rounded-2xl border-border shadow-none overflow-hidden">
            {filtered.length === 0 ? (
              <CardContent className="py-16 text-center">
                <Users className="w-12 h-12 text-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {search ? "No tenants match" : "No tenants yet"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  {search ? "Try adjusting filters" : isLandlord ? "No tenants are assigned to your properties yet" : "Add your first tenant"}
                </p>
                {!search && !isLandlord && (
                  <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add tenant
                  </Button>
                )}
              </CardContent>
            ) : (
              <>
                <div className="px-4 py-2 bg-muted border-b border-border">
                  <p className="text-xs text-muted-foreground">Swipe left for quick actions</p>
                </div>
                {paginated.map(t => (
                  <SwipeTenantCard
                    key={t.id}
                    t={t}
                    onView={() => navigate(`/tenants/${t.id}`)}
                    onEmail={() => window.open(`mailto:${t.email}`, "_blank")}
                    onCall={() => t.phone && window.open(`tel:${t.phone}`, "_self")}
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
          <Card className="rounded-2xl border-border shadow-none overflow-hidden">
            {filtered.length === 0 ? (
              <CardContent className="py-16 text-center">
                <Users className="w-12 h-12 text-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {search ? "No tenants match your search" : "No tenants yet"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  {search ? "Try adjusting your filters" : isLandlord ? "No tenants are assigned to your properties yet" : "Add your first tenant to get started"}
                </p>
                {!search && !isLandlord && (
                  <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add tenant
                  </Button>
                )}
              </CardContent>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Tenant</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Unit / Property</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Lease</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Rent</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paginated.map(t => {
                        const days = daysUntil(t.leaseEndDate);
                        return (
                          <tr key={t.id} className="hover:bg-muted/50 transition-colors group">
                            <td className="px-4 py-3">
                              <div
                                className="flex items-center gap-3 cursor-pointer"
                                onClick={() => navigate(`/tenants/${t.id}`)}
                              >
                                <Avatar className="w-8 h-8 flex-shrink-0">
                                  <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-medium">
                                    {t.firstName[0]}{t.lastName[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate">
                                    {t.firstName} {t.lastName}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                    <Mail className="w-3 h-3" />{t.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
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
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {t.leaseEndDate ? (
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
                              )}
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="font-medium text-foreground">
                                {t.monthlyRent
                                  ? `KES ${Number(t.monthlyRent).toLocaleString()}`
                                  : <span className="text-muted-foreground">—</span>
                                }
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={t.status} />
                            </td>
                            <td className="px-4 py-3">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                                  >
                                    <MoreVertical className="w-3.5 h-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => navigate(`/tenants/${t.id}`)}>
                                    <Eye className="w-4 h-4 mr-2" /> View
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => window.open(`mailto:${t.email}`, "_blank")}>
                                    <Mail className="w-4 h-4 mr-2" /> Email
                                  </DropdownMenuItem>
                                  {t.phone && (
                                    <DropdownMenuItem onClick={() => window.open(`tel:${t.phone}`, "_self")}>
                                      <Phone className="w-4 h-4 mr-2" /> Call
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => {
                                      if (confirm(`Remove ${t.firstName} ${t.lastName}?`)) {
                                        deleteMutation.mutate(t.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
            )}
          </Card>
        )}
      </div>

      {!isLandlord && (
        <ComprehensiveTenantModal
          isOpen={isAddModalOpen}
          onClose={() => {
            setIsAddModalOpen(false);
            queryClient.invalidateQueries({ queryKey: tenantQueryKey });
          }}
          properties={Array.isArray(properties) ? properties : []}
        />
      )}
    </div>
  );
}