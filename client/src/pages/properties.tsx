import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Home, MapPin, Users, MoreVertical,
  Eye, Edit, Trash2, Download, Building2, TrendingUp,
  Filter, X, ChevronRight, ChevronLeft, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import AddPropertyModal from "@/components/modals/add-property-modal";
import { getPropertyGradient } from "@/lib/propertyGradient";
// import { TitleVerificationBadge } from "@/components/ui/title-verification-badge"; // Ardhisasa pending
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


interface Property {
  id: number;
  name: string;
  address: string;
  totalUnits: number;
  description?: string;
  imageUrl?: string;
  createdAt: string;
  organizationId?: number;
  siteSettings?: any;
}

function OccupancyBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

/** Generates a consistent gradient + initials placeholder for a property */
function PropertyPlaceholder({ name }: { name: string }) {
  const gradient = getPropertyGradient(name);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("");

  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-2`}>
      <span className="text-3xl font-bold text-white/90 tracking-wide drop-shadow-sm">
        {initials}
      </span>
      <span className="text-xs text-white/70 font-medium px-3 text-center leading-tight line-clamp-2">
        {name}
      </span>
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

export default function Properties() {
  const guard = useRoleGuard(ROLES.STAFF_AND_ABOVE);
  if (guard.gate) return guard.gate;
  const canEdit   = guard.canManage;
  const canDelete = guard.isAdmin;

  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [pageSize, setPageSize] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const orgIdParam = getOrgIdFromSearch(search); // only meaningful for platform_admin
  const queryClient = useQueryClient();

  const { data: raw = [], isLoading } = useQuery<any>({
    queryKey: ["/api/properties", orgIdParam],
    queryFn: async () => { const r = await apiRequest(withOrgParam("/api/properties", orgIdParam)); return ensureArray(await r.json()); },
    staleTime: 5 * 60 * 1000,
  });
  const properties: Property[] = Array.isArray(raw) ? raw : (raw?.results ?? []);

  const { data: unitsRaw } = useQuery<any>({
    queryKey: ["/api/units"],
    queryFn: async () => { const r = await apiRequest("/api/units"); return ensureArray(await r.json()); },
    staleTime: 5 * 60 * 1000,
  });
  const allUnits: any[] = Array.isArray(unitsRaw) ? unitsRaw : (unitsRaw?.results ?? []);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(`/api/properties/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property deleted" });
    },
    onError: () => toast({ title: "Failed to delete property", variant: "destructive" }),
  });

  function getUnitStats(propertyId: number) {
    const units = allUnits.filter(u => u.propertyId === propertyId);
    const occupied = units.filter(u => u.isOccupied).length;
    return { total: units.length, occupied, pct: units.length ? Math.round((occupied / units.length) * 100) : 0 };
  }

  const filtered = properties.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.address.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "units") return b.totalUnits - a.totalUnits;
    if (sortBy === "created") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return 0;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleSearch(v: string) { setSearchTerm(v); setCurrentPage(1); }
  function handleSort(v: string) { setSortBy(v); setCurrentPage(1); }
  function handlePageSize(v: string) { setPageSize(Number(v)); setCurrentPage(1); }

  const totalUnits = properties.reduce((s, p) => s + p.totalUnits, 0);
  const occupiedUnits = allUnits.filter(u => u.isOccupied).length;
  const overallOcc = allUnits.length > 0 ? Math.round((occupiedUnits / allUnits.length) * 100) : 0;

  const handleExport = () => {
    const csv = [
      "Name,Address,Total Units,Created",
      ...filtered.map(p => `"${p.name}","${p.address}",${p.totalUnits},"${new Date(p.createdAt).toLocaleDateString()}"`)
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `properties-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    toast({ title: "Exported", description: `${filtered.length} properties exported` });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-8 bg-muted dark:bg-gray-700 rounded w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted dark:bg-gray-700 rounded-2xl" />)}
        </div>
        <div className="h-64 bg-muted dark:bg-gray-700 rounded-2xl" />
      </div>
    );
  }

  return (
    <PageShell>
      {/* ── Page header ── */}
      <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-8 py-6">
        <div className="max-w-7xl mx-auto">
          {/* Only shown when we arrived here via platform_admin selecting an
              org — previously there was no way back to Organisations at all. */}
          {orgIdParam && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-2 text-muted-foreground hover:text-foreground h-8 text-xs"
              onClick={() => navigate("/organisations")}
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to Organisations
            </Button>
          )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Properties</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {properties.length} {properties.length === 1 ? "property" : "properties"}&ensp;·&ensp;{allUnits.length || totalUnits} units
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Button variant="outline" size="sm" onClick={handleExport} className="h-9">
              <Download className="w-4 h-4 mr-1.5" /> Export
            </Button>
            <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white px-4"
              onClick={() => { setEditingProperty(null); setIsAddModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Add property
            </Button>
          </div>
        </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-7">

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            { icon: Building2, label: "Properties",  value: properties.length,          bg: "bg-emerald-50 dark:bg-emerald-950/40", fg: "text-emerald-600" },
            { icon: Home,      label: "Total units",  value: allUnits.length || totalUnits, bg: "bg-sky-50 dark:bg-sky-950/40",     fg: "text-sky-600" },
            { icon: TrendingUp,label: "Occupancy",    value: `${overallOcc}%`,           bg: overallOcc >= 80 ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-amber-50 dark:bg-amber-950/40", fg: overallOcc >= 80 ? "text-emerald-600" : "text-amber-600" },
          ].map(({ icon: Icon, label, value, bg, fg }) => (
            <Card key={label} className="rounded-2xl border border-border/60 shadow-none hover:shadow-sm transition-shadow">
              <CardContent className="p-6 flex items-center gap-5">
                <div className={`w-12 h-12 ${bg} rounded-2xl flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${fg}`} />
                </div>
                <div>
                  <p className="text-3xl font-bold text-foreground tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search properties…"
              className="pl-9 h-9 border-border dark:border-gray-700 bg-background"
              value={searchTerm}
              onChange={e => handleSearch(e.target.value)}
            />
            {searchTerm && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => handleSearch("")}>
                <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          <Select value={sortBy} onValueChange={handleSort}>
            <SelectTrigger className="w-38 h-9 border-border dark:border-gray-700 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="units">Most units</SelectItem>
              <SelectItem value="created">Newest</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Show</span>
            <Select value={String(pageSize)} onValueChange={handlePageSize}>
              <SelectTrigger className="w-20 h-9 border-border dark:border-gray-700 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>per page</span>
          </div>

          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Grid ── */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card py-20 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm font-semibold text-foreground">
              {searchTerm ? "No properties match your search" : "No properties yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 mb-5">
              {searchTerm ? "Try a different search term" : "Add your first property to get started"}
            </p>
            {!searchTerm && (
              <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add property
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {paginated.map(p => {
                const stats = getUnitStats(p.id);
                return (
                  <Card
                    key={p.id}
                    className="card-lift rounded-2xl border border-border/60 shadow-none hover:border-emerald-200 dark:hover:border-emerald-800 transition-all duration-200 group overflow-hidden"
                  >
                    {/* Thumbnail */}
                    <div
                      className="h-44 relative overflow-hidden cursor-pointer"
                      onClick={() => navigate(withOrgParam(`/properties/${p.id}`, orgIdParam))}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <PropertyPlaceholder name={p.name} />
                      )}
                      {/* Gradient scrim for legibility */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                      {/* Occupancy pill */}
                      <div className="absolute top-3 right-3">
                        <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold backdrop-blur-sm ${
                          stats.pct >= 90 ? "bg-emerald-500/90 text-white"
                          : stats.pct >= 70 ? "bg-amber-400/90 text-white"
                          : "bg-red-500/90 text-white"
                        }`}>
                          {stats.pct}% occupied
                        </span>
                      </div>
                    </div>

                    <CardContent className="p-5">
                      {/* Title row */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => navigate(withOrgParam(`/properties/${p.id}`, orgIdParam))}
                        >
                          <h3 className="font-bold text-base text-foreground truncate leading-snug">{p.name}</h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 flex-shrink-0" />{p.address}
                          </p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0 text-muted-foreground">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => navigate(withOrgParam(`/properties/${p.id}`, orgIdParam))}>
                              <Eye className="w-4 h-4 mr-2" /> View details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setEditingProperty(p); setIsAddModalOpen(true); }}>
                              <Edit className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => {
                                if (confirm(`Delete "${p.name}"? This cannot be undone.`)) {
                                  deleteMutation.mutate(p.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Divider */}
                      <div className="my-3 border-t border-border/50" />

                      {/* Stats row */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          <span className="font-medium text-foreground">{stats.occupied}</span>
                          <span>/ {stats.total || p.totalUnits} units occupied</span>
                        </div>
                        {/* TitleVerificationBadge hidden — Ardhisasa API pending.
                            RESTORE: <TitleVerificationBadge
                              status={(p.siteSettings as any)?.titleVerification?.status ?? "unverified"}
                              isSandbox={(p.siteSettings as any)?.titleVerification?.isSandbox}
                              encumbrances={(p.siteSettings as any)?.titleVerification?.encumbrances}
                            /> */}
                      </div>
                      <OccupancyBar pct={stats.pct} />

                      {/* CTA */}
                      <button
                        className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors"
                        onClick={() => navigate(withOrgParam(`/properties/${p.id}`, orgIdParam))}
                      >
                        View full details <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline" size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safePage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(n => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | "…")[]>((acc, n, idx, arr) => {
                      if (idx > 0 && n - (arr[idx - 1] as number) > 1) acc.push("…");
                      acc.push(n);
                      return acc;
                    }, [])
                    .map((n, i) =>
                      n === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-sm">…</span>
                      ) : (
                        <Button
                          key={n}
                          variant={n === safePage ? "default" : "outline"}
                          size="sm"
                          className="h-8 w-8 p-0 text-sm"
                          onClick={() => setCurrentPage(n as number)}
                        >
                          {n}
                        </Button>
                      )
                    )}

                  <Button
                    variant="outline" size="sm"
                    className="h-8 w-8 p-0"
                    disabled={safePage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AddPropertyModal
        isOpen={isAddModalOpen}
        onClose={() => { setIsAddModalOpen(false); setEditingProperty(null); }}
        property={editingProperty}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          setIsAddModalOpen(false);
          setEditingProperty(null);
        }}
      />
    </PageShell>
  );
}