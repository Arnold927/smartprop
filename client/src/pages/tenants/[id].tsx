import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Mail, Phone, Calendar, DollarSign, FileText,
  Home, User, Wrench, AlertCircle, CheckCircle, XCircle, Clock,
  Edit, Download, MoreVertical, Printer, History, Receipt,
  Lock, Upload, ExternalLink, Bed, Bath, Square, Building2,
  ChevronRight, Shield, Search, X, ChevronLeft,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, uploadWithAuth } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AddMaintenanceModal from "@/components/modals/add-maintenance-modal";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import AddTenantDialog from "@/components/add-tenant-dialog";
import TenantRentPayments from "@/components/tenant-rent-payments";
import { getPropertyGradient } from "@/lib/propertyGradient";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  unitId?: number;
  status: "active" | "inactive" | "pending";
  monthlyRent?: string;
  currency?: string;
  securityDeposit?: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
  avatarUrl?: string;
  unit?: { id: number; unitNumber: string; propertyId: number };
  property?: { id: number; name: string; address?: string; ownerId?: string };
  user?: { id: string; name?: string; avatarUrl?: string };
  createdAt: string;
  updatedAt: string;
  organizationId?: number;
}

interface RentPayment {
  id: number;
  amount: string;
  currency: string;
  dueDate: string;
  paidDate?: string;
  paymentMethod?: string;
  status: "pending" | "paid" | "overdue" | "partial";
  notes?: string;
}

interface MaintenanceRequest {
  id: number;
  ticketNumber: string;
  title: string;
  description: string;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "assigned" | "in_progress" | "completed" | "cancelled";
  assignedTo?: string;
  scheduledDate?: string;
  estimatedCost?: string;
  actualCost?: string;
  createdAt: string;
  currency?: string;
}

interface Unit {
  id: number;
  unitNumber: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  monthlyRent: number;
  isOccupied: boolean;
  propertyId: number;
  property?: { id: number; name: string; address?: string };
}

interface Document {
  id: number;
  name: string;
  type: string;
  url: string;
  size: number;
  uploadedBy: { id: string; firstName: string; lastName: string; createdAt: string };
  createdAt: string;
}

const STATUS_STYLES = {
  active:   { dot: "bg-green-500", badge: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800" },
  pending:  { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800" },
  inactive: { dot: "bg-gray-400",  badge: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800  dark:border-gray-700" },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export default function TenantDetails() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState("overview");
  const { user } = useAuth();
 const isManager = user?.role === "admin" || user?.role === "manager";
 const [isAddMaintenanceModalOpen, setIsAddMaintenanceModalOpen] = useState(false);
  const [isEditTenantDialogOpen, setIsEditTenantDialogOpen] = useState(false);

  // Maintenance tab filter/pagination state
  const [maintSearch,   setMaintSearch]   = useState("");
  const [maintFilter,   setMaintFilter]   = useState<"all"|"pending"|"in_progress"|"completed"|"cancelled">("all");
  const [maintPageSize, setMaintPageSize] = useState(10);
  const [maintPage,     setMaintPage]     = useState(1);

  // Documents tab filter/pagination state
  const [docSearch,   setDocSearch]   = useState("");
  const [docPageSize, setDocPageSize] = useState(10);
  const [docPage,     setDocPage]     = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Queries ──
  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: [`/api/tenants/${id}`],
    queryFn: async () => { const r = await apiRequest(`/api/tenants/${id}`); return r.json(); },
    enabled: !!id,
  });

  const { data: tenantUnit, isLoading: isLoadingUnit } = useQuery<Unit>({
    queryKey: [`/api/units/${tenant?.unitId}`],
    queryFn: async () => {
      if (!tenant?.unitId) return null;
      try { const r = await apiRequest(`/api/units/${tenant.unitId}`); return r.json(); }
      catch { return null; }
    },
    enabled: !!tenant?.unitId,
  });

  const { data: documents = [], isLoading: isLoadingDocuments } = useQuery<Document[]>({
    queryKey: [`/api/tenants/${id}/documents`],
    queryFn: async () => {
      const r = await apiRequest(`/api/documents?tenantId=${tenant?.id}`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!tenant?.id,
  });

  // Resolve propertyId from all available sources:
  // tenant.property.id (full nested object) → tenant.unit.propertyId (lightweight nested) → tenantUnit.propertyId (separate unit query)
  const resolvedPropertyId =
    tenant?.property?.id ??
    tenant?.unit?.propertyId ??
    tenantUnit?.propertyId ??
    null;

  const { data: units = [] } = useQuery<Unit[]>({
    queryKey: [`/api/properties/${resolvedPropertyId}/units`],
    queryFn: async () => {
      if (!resolvedPropertyId) return [];
      const r = await apiRequest(`/api/properties/${resolvedPropertyId}/units`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!resolvedPropertyId,
  });

  const { data: rentPayments = [] } = useQuery<RentPayment[]>({
    queryKey: [`/api/tenants/${id}/payments`],
    queryFn: async () => {
      const r = await apiRequest(`/api/tenants/${id}/payments`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!id,
  });

  const { data: maintenanceRequests = [], isLoading: isLoadingMaintenance } = useQuery<MaintenanceRequest[]>({
    queryKey: [`/api/maintenance-requests`, id],
    queryFn: async () => {
      const r = await apiRequest(`/api/maintenance-requests?tenantId=${id}`);
      const d = await r.json();
      return Array.isArray(d) ? d : (Array.isArray(d?.results) ? d.results : []);
    },
    enabled: !!id,
  });

  // ── Currency — declared here so mutationFn closure can reference it ──
  // Always normalise to "KES"; this corrects any stale "USD" stored in the DB
  const currency = "KES";

  // ── Mutations ──
  const updateTenantMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload: Record<string, any> = {
        ...data,
        monthlyRent:     data.monthlyRent     !== undefined ? String(Number(data.monthlyRent))     : undefined,
        securityDeposit: data.securityDeposit !== undefined && data.securityDeposit !== ""
          ? String(Number(data.securityDeposit))
          : undefined,
        // Always persist the resolved currency so stale "USD" values in the DB get corrected
        currency: currency,
      };
      if (!payload.unitId) delete payload.unitId;
      const r = await apiRequest(`/api/tenants/${id}`, { method: "PUT", data: payload });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/units/${tenant?.unitId}`] });
      toast({ title: "Tenant updated successfully" });
    },
    onError: () => toast({ title: "Failed to update tenant", variant: "destructive" }),
  });

  // ── Derived stats ──
  const today = new Date().toISOString().split("T")[0];
  const paymentStats = {
    paid:    rentPayments.filter(p => p.status === "paid").length,
    // Count both explicitly-overdue records and pending invoices past their due date
    overdue: rentPayments.filter(p =>
      p.status === "overdue" ||
      (p.status === "pending" && p.dueDate < today)
    ).length,
    total:   rentPayments.length,
  };
  const maintenanceStats = {
    total:      maintenanceRequests.length,
    pending:    maintenanceRequests.filter(m => m.status === "pending").length,
    inProgress: maintenanceRequests.filter(m => m.status === "in_progress").length,
    completed:  maintenanceRequests.filter(m => m.status === "completed").length,
    urgent:     maintenanceRequests.filter(m => m.priority === "urgent").length,
  };

  // currency is declared above the mutation so it can be used in the payload

  const formatCurrency = (amount?: string | number) => {
    if (amount == null || amount === "") return "—";
    const n = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(n)) return String(amount);
    // Use plain comma-formatting + currency prefix to match the rest of the app (e.g. "KES 25,000")
    const formatted = new Intl.NumberFormat("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
    return `${currency} ${formatted}`;
  };

  // ── Gradient (matches property card) ──
  // Use property name from any available source — same key the property card uses.
  // Checked in priority order: tenant.property.name (from API) → tenantUnit.property.name (from unit query)
  // → empty string (produces a deterministic index-0 gradient rather than crashing)
  // Fall back through all available sources; use tenant full name as last resort
  // so the avatar always gets a colour (getPropertyGradient("") would return undefined)
  const propertyName =
    tenant?.property?.name ||
    tenantUnit?.property?.name ||
    `${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`.trim() ||
    "A";
  const gradient = getPropertyGradient(propertyName);
  const initials = `${tenant?.firstName?.[0] ?? ""}${tenant?.lastName?.[0] ?? ""}`.toUpperCase();

  // ── Lease countdown ──
  const daysUntilLeaseEnd = tenant?.leaseEndDate
    ? Math.ceil((new Date(tenant.leaseEndDate).getTime() - Date.now()) / 86400000)
    : null;

  // ── Handlers ──
  const handleSendEmail = () => {
    if (tenant?.email) {
      window.open(`mailto:${tenant.email}`, "_blank");
      toast({ title: "Email composer opened" });
    }
  };

  const handleCallTenant = () => {
    if (tenant?.phone) {
      window.open(`tel:${tenant.phone}`, "_self");
    } else {
      toast({ title: "No phone number saved", variant: "destructive" });
    }
  };

  const handleExport = () => {
    if (!tenant) return;
    const rows = [
      ["Name", `${tenant.firstName} ${tenant.lastName}`],
      ["Email", tenant.email],
      ["Phone", tenant.phone || "N/A"],
      ["Status", tenant.status],
      ["Monthly Rent", formatCurrency(tenant.monthlyRent)],
      ["Security Deposit", formatCurrency(tenant.securityDeposit)],
      ["Unit", tenantUnit ? `Unit ${tenantUnit.unitNumber}` : "N/A"],
      ["Property", tenant.property?.name || "N/A"],
      ["Lease Start", fmtDate(tenant.leaseStartDate)],
      ["Lease End", fmtDate(tenant.leaseEndDate)],
    ];
    const csv = rows.map(([k, v]) => `"${k}","${v}"`).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tenant-${tenant.firstName}-${tenant.lastName}.csv`;
    a.click();
    toast({ title: "Exported successfully" });
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !tenant) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tenantId", String(tenant.id));
    try {
      await uploadWithAuth("/api/documents/upload", formData);
      queryClient.invalidateQueries({ queryKey: [`/api/tenants/${id}/documents`] });
      toast({ title: `${file.name} uploaded` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  const handleDownloadDocument = async (doc: Document) => {
    try {
      const r = await apiRequest(`/api/documents/${doc.id}/download`);
      if (!r.ok) throw new Error("Download failed");
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = doc.name;
      document.body.appendChild(a); a.click();
      a.remove(); window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const handleTenantSubmit = async (data: any) => {
    try { await updateTenantMutation.mutateAsync(data); return true; }
    catch { return false; }
  };

  const getPriorityColor = (p: string) => ({
    urgent: "bg-red-50 text-red-700",
    high:   "bg-orange-50 text-orange-700",
    medium: "bg-blue-50 text-blue-700",
    low:    "bg-muted text-foreground",
  }[p] ?? "bg-muted text-foreground");

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-40 bg-muted dark:bg-gray-800" />
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8 text-center">
        <User className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-semibold mb-1">Tenant not found</h3>
        <p className="text-sm text-muted-foreground mb-4">This tenant doesn't exist or has been removed.</p>
        <Button asChild variant="outline">
          <Link href="/tenants"><ArrowLeft className="mr-2 h-4 w-4" />Back to Tenants</Link>
        </Button>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[tenant.status] ?? STATUS_STYLES.inactive;
  const unitDisplay = tenantUnit ? `Unit ${tenantUnit.unitNumber}` : tenant.unit?.unitNumber ? `Unit ${tenant.unit.unitNumber}` : null;

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero header ── */}
      <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800" >
        <div className="max-w-4xl mx-auto px-4 md:px-6">

          {/* Back nav */}
          <div className="pt-4 pb-1">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground h-8 text-xs" asChild>
              <Link href="/tenants"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Tenants</Link>
            </Button>
          </div>

          {/* Identity + actions row */}
          <div className="py-5 flex items-start gap-4">
            {/* Avatar */}
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
              <span className="text-xl font-black text-white/90">{initials || <User className="h-7 w-7 text-white" />}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold text-slate-900 leading-tight">
                    {tenant.firstName} {tenant.lastName}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusStyle.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                    </span>
                    <span className="text-xs text-muted-foreground">#{tenant.id.toString().padStart(4, "0")}</span>
                    {unitDisplay && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Home className="h-3 w-3" />{unitDisplay}
                        {(tenant.property?.name || tenantUnit?.property?.name) && (
                          <span>· {tenant.property?.name || tenantUnit?.property?.name}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button variant="outline" size="sm" className="h-8 hidden sm:flex" onClick={handleSendEmail}>
                    <Mail className="h-3.5 w-3.5 mr-1.5" />Email
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 hidden sm:flex" onClick={handleCallTenant}>
                    <Phone className="h-3.5 w-3.5 mr-1.5" />Call
                  </Button>
                  {isManager && (
                    <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsEditTenantDialogOpen(true)}>
                      <Edit className="h-3.5 w-3.5 mr-1.5" />Edit
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 px-2">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem className="sm:hidden" onClick={handleSendEmail}><Mail className="mr-2 h-4 w-4" />Email</DropdownMenuItem>
                      <DropdownMenuItem className="sm:hidden" onClick={handleCallTenant}><Phone className="mr-2 h-4 w-4" />Call</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExport}><Download className="mr-2 h-4 w-4" />Export CSV</DropdownMenuItem>
                      {isManager && <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600"><Lock className="mr-2 h-4 w-4" />Deactivate</DropdownMenuItem>
                      </>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border dark:bg-gray-800 border-t border-border dark:border-gray-800 -mx-4 md:-mx-6">
            {[
              { label: "Monthly Rent",      value: formatCurrency(tenant.monthlyRent),      sub: "per month",                   icon: <DollarSign className="h-4 w-4 text-green-500" />, accent: "bg-green-50 dark:bg-green-950/40" },
              { label: "Security Deposit",  value: formatCurrency(tenant.securityDeposit),  sub: "held",                        icon: <Shield className="h-4 w-4 text-blue-500" />,     accent: "bg-blue-50 dark:bg-blue-950/40" },
              { label: "Payments",          value: `${paymentStats.paid}/${paymentStats.total}`, sub: paymentStats.overdue > 0 ? `${paymentStats.overdue} overdue` : "all clear", icon: <Receipt className="h-4 w-4 text-violet-500" />, accent: paymentStats.overdue > 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-violet-50 dark:bg-violet-950/40" },
              { label: "Maintenance",       value: maintenanceStats.total,                  sub: maintenanceStats.urgent > 0 ? `${maintenanceStats.urgent} urgent` : `${maintenanceStats.pending} pending`, icon: <Wrench className="h-4 w-4 text-amber-500" />, accent: "bg-amber-50 dark:bg-amber-950/40" },
            ].map((kpi, i) => (
              <div key={i} className="bg-card dark:bg-gray-900 px-4 md:px-6 py-3.5 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${kpi.accent} flex-shrink-0`}>{kpi.icon}</div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-base font-bold text-slate-900 leading-tight truncate">{kpi.value}</p>
                  <p className={`text-[11px] ${kpi.sub.includes("overdue") || kpi.sub.includes("urgent") ? "text-red-500" : "text-muted-foreground"}`}>{kpi.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="bg-card dark:bg-gray-900 border border-border dark:border-gray-800 p-1 rounded-xl inline-flex">
            {[
              { value: "overview",     label: "Overview" },
              { value: "lease",        label: "Lease" },
              { value: "payments",     label: "Payments" },
              { value: "maintenance",  label: "Maintenance" },
              { value: "documents",    label: "Documents" },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value} className="rounded-lg px-4 text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview: contact + unit only ── */}
          <TabsContent value="overview" className="m-0 space-y-4">
            {/* Contact */}
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {[
                  { label: "Email",       value: tenant.email,                      icon: <Mail className="h-4 w-4" />,     action: handleSendEmail },
                  { label: "Phone",       value: tenant.phone || "—",               icon: <Phone className="h-4 w-4" />,    action: tenant.phone ? handleCallTenant : undefined },
                  { label: "Tenant Since", value: fmtDate(tenant.leaseStartDate ?? tenant.createdAt), icon: <Calendar className="h-4 w-4" />, action: undefined },
                  { label: "Last Updated", value: fmtDate(tenant.updatedAt),        icon: <Clock className="h-4 w-4" />,    action: undefined },
                ].map(row => (
                  <div key={row.label} className="flex items-start gap-3">
                    <span className="mt-0.5 text-muted-foreground flex-shrink-0">{row.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{row.label}</p>
                      {row.action ? (
                        <button onClick={row.action} className="text-sm font-medium text-blue-600 hover:underline truncate block">
                          {row.value}
                        </button>
                      ) : (
                        <p className="text-sm font-medium text-foreground truncate">{row.value}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Unit */}
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Assigned Unit</CardTitle>
                {resolvedPropertyId && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
                    <Link href={`/properties/${resolvedPropertyId}`}>
                      View Property <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {isLoadingUnit ? (
                  <Skeleton className="h-16 w-full rounded-xl" />
                ) : tenantUnit ? (
                  <div className="flex items-start gap-4">
                    {/* Mini unit gradient */}
                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg font-black text-white/80">{tenantUnit.unitNumber}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">Unit {tenantUnit.unitNumber}</p>
                      {(tenant.property?.name || tenantUnit.property?.name) && (
                        <p className="text-xs text-muted-foreground">{tenant.property?.name || tenantUnit.property?.name}</p>
                      )}
                      {tenant.property?.address && (
                        <p className="text-xs text-muted-foreground truncate">{tenant.property.address}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{tenantUnit.bedrooms} Bed</span>
                        <span>·</span>
                        <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{tenantUnit.bathrooms} Bath</span>
                        {tenantUnit.sqft ? <><span>·</span><span className="flex items-center gap-1"><Square className="h-3 w-3" />{tenantUnit.sqft.toLocaleString()} sqft</span></> : null}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-foreground">{formatCurrency(tenantUnit.monthlyRent)}</p>
                      <p className="text-[11px] text-muted-foreground">/month</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">No unit assigned</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Lease tab ── */}
          <TabsContent value="lease" className="m-0 space-y-4">
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Lease Details</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
                {[
                  { label: "Lease Start",      value: fmtDate(tenant.leaseStartDate) },
                  { label: "Lease End",         value: fmtDate(tenant.leaseEndDate) },
                  { label: "Monthly Rent",      value: formatCurrency(tenant.monthlyRent) },
                  { label: "Security Deposit",  value: formatCurrency(tenant.securityDeposit) },
                ].map(row => (
                  <div key={row.label}>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">{row.label}</p>
                    <p className="text-base font-semibold text-foreground">{row.value}</p>
                  </div>
                ))}
                {(() => {
                  if (!tenant.leaseStartDate || !tenant.leaseEndDate) return null;
                  const months = Math.round(
                    (new Date(tenant.leaseEndDate).getTime() - new Date(tenant.leaseStartDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
                  );
                  const totalValue = months * parseFloat(tenant.monthlyRent || "0");
                  return (
                    <>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Duration</p>
                        <p className="text-base font-semibold text-foreground">{months} month{months !== 1 ? "s" : ""}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Total Lease Value</p>
                        <p className="text-base font-semibold text-foreground">{formatCurrency(totalValue)}</p>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Lease countdown */}
            {daysUntilLeaseEnd !== null && (
              <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 ${
                daysUntilLeaseEnd <= 0  ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" :
                daysUntilLeaseEnd <= 30 ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800" :
                daysUntilLeaseEnd <= 90 ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800" :
                                          "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800"
              }`}>
                <Calendar className={`h-5 w-5 flex-shrink-0 ${
                  daysUntilLeaseEnd <= 30 ? "text-red-500" : daysUntilLeaseEnd <= 90 ? "text-amber-500" : "text-green-500"
                }`} />
                <div>
                  <p className={`text-sm font-semibold ${
                    daysUntilLeaseEnd <= 30 ? "text-red-700 dark:text-red-400" :
                    daysUntilLeaseEnd <= 90 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"
                  }`}>
                    {daysUntilLeaseEnd <= 0
                      ? `Lease ended ${Math.abs(daysUntilLeaseEnd)} day${Math.abs(daysUntilLeaseEnd) !== 1 ? "s" : ""} ago`
                      : `${daysUntilLeaseEnd} day${daysUntilLeaseEnd !== 1 ? "s" : ""} until lease ends`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Lease end: {fmtDate(tenant.leaseEndDate)}</p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Payments tab ── */}
          <TabsContent value="payments" className="m-0">
            <div className="space-y-5">
            <TenantRentPayments
              tenantId={tenant.id.toString()}
              tenantName={`${tenant.firstName} ${tenant.lastName}`}
              tenantEmail={tenant.email}
              tenantPhone={tenant.phone}
              monthlyRent={tenant.monthlyRent ? Number(tenant.monthlyRent) : 0}
              currency={currency}
            />
            </div>
          </TabsContent>

          {/* ── Maintenance tab ── */}
          <TabsContent value="maintenance" className="m-0">
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Maintenance Requests</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{maintenanceStats.total} total</CardDescription>
                </div>
                {isManager && <Button size="sm" className="h-8" onClick={() => setIsAddMaintenanceModalOpen(true)}>
                  <Wrench className="mr-1.5 h-3.5 w-3.5" />New Request
                </Button>}
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {/* Stats strip */}
                {maintenanceStats.total > 0 && (
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[
                      { label: "Total",   value: maintenanceStats.total,      cls: "bg-muted dark:bg-gray-800 text-foreground" },
                      { label: "Pending", value: maintenanceStats.pending,    cls: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400" },
                      { label: "Active",  value: maintenanceStats.inProgress, cls: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" },
                      { label: "Done",    value: maintenanceStats.completed,  cls: "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400" },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl p-3 text-center ${s.cls}`}>
                        <p className="text-xs font-medium opacity-70">{s.label}</p>
                        <p className="text-lg font-bold">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {isLoadingMaintenance ? (
                  <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : maintenanceRequests.length === 0 ? (
                  <div className="text-center py-10">
                    <Wrench className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                    <p className="text-sm text-muted-foreground mb-3">No maintenance requests yet</p>
                    {isManager && <Button size="sm" onClick={() => setIsAddMaintenanceModalOpen(true)}>Create First Request</Button>}
                  </div>
                ) : (() => {
                  // Filter
                  const filteredMaint = maintenanceRequests.filter(r => {
                    const matchSearch = !maintSearch ||
                      r.title.toLowerCase().includes(maintSearch.toLowerCase()) ||
                      r.ticketNumber.toLowerCase().includes(maintSearch.toLowerCase()) ||
                      r.status.replace("_"," ").includes(maintSearch.toLowerCase()) ||
                      r.priority.includes(maintSearch.toLowerCase());
                    const matchFilter = maintFilter === "all" || r.status === maintFilter;
                    return matchSearch && matchFilter;
                  });
                  const maintTotalPages = Math.max(1, Math.ceil(filteredMaint.length / maintPageSize));
                  const maintSafePage   = Math.min(maintPage, maintTotalPages);
                  const pagedMaint      = filteredMaint.slice((maintSafePage - 1) * maintPageSize, maintSafePage * maintPageSize);
                  return (
                    <>
                      {/* Toolbar */}
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <div className="relative flex-1 min-w-0 max-w-xs">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            value={maintSearch}
                            onChange={e => { setMaintSearch(e.target.value); setMaintPage(1); }}
                            placeholder="Search title, ticket, status…"
                            className="pl-8 h-8 text-sm border-border dark:border-gray-700"
                          />
                          {maintSearch && (
                            <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => { setMaintSearch(""); setMaintPage(1); }}>
                              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                            </button>
                          )}
                        </div>
                        <Select value={maintFilter} onValueChange={v => { setMaintFilter(v as any); setMaintPage(1); }}>
                          <SelectTrigger className="w-32 h-8 text-sm border-border dark:border-gray-700" >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <span>Show</span>
                          <Select value={String(maintPageSize)} onValueChange={v => { setMaintPageSize(Number(v)); setMaintPage(1); }}>
                            <SelectTrigger className="w-16 h-8 text-sm border-border dark:border-gray-700" >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[5, 10, 25].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <span className="text-xs text-muted-foreground ml-auto">{filteredMaint.length} result{filteredMaint.length !== 1 ? "s" : ""}</span>
                      </div>

                      {filteredMaint.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-sm text-muted-foreground">No requests match your filters.</p>
                          <button className="text-xs text-blue-600 mt-1 hover:underline" onClick={() => { setMaintSearch(""); setMaintFilter("all"); }}>Clear filters</button>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {pagedMaint.map(req => (
                              <div key={req.id} className="flex items-center gap-3 rounded-xl border border-border dark:border-gray-800 px-4 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xs text-muted-foreground font-mono">{req.ticketNumber}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getPriorityColor(req.priority)}`}>{req.priority}</span>
                                  </div>
                                  <p className="text-sm font-medium text-foreground truncate">{req.title}</p>
                                  <p className="text-xs text-muted-foreground capitalize">{req.status.replace("_", " ")} · {fmtDate(req.createdAt)}</p>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" asChild>
                                  <Link href={`/maintenance-request/${req.id}`}><ExternalLink className="h-3.5 w-3.5" /></Link>
                                </Button>
                              </div>
                            ))}
                          </div>

                          {/* Pagination */}
                          {maintTotalPages > 1 && (
                            <div className="flex items-center justify-between mt-4">
                              <p className="text-xs text-muted-foreground">
                                {(maintSafePage - 1) * maintPageSize + 1}–{Math.min(maintSafePage * maintPageSize, filteredMaint.length)} of {filteredMaint.length}
                              </p>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={maintSafePage === 1} onClick={() => setMaintPage(p => p - 1)}>
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </Button>
                                {Array.from({ length: maintTotalPages }, (_, i) => i + 1).map(n => (
                                  <Button key={n} variant={n === maintSafePage ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => setMaintPage(n)}>{n}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={maintSafePage === maintTotalPages} onClick={() => setMaintPage(p => p + 1)}>
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents tab ── */}
          <TabsContent value="documents" className="m-0">
            <Card className="rounded-2xl shadow-none border-border dark:border-gray-800" >
              <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Documents</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{documents.length} file{documents.length !== 1 ? "s" : ""}</CardDescription>
                </div>
                <Button size="sm" variant="outline" className="h-8" onClick={handleUploadClick}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />Upload
                </Button>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {isLoadingDocuments ? (
                  <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-10">
                    <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                    <p className="text-sm text-muted-foreground mb-3">No documents uploaded yet</p>
                    <Button size="sm" variant="outline" onClick={handleUploadClick}>Upload First Document</Button>
                  </div>
                ) : (() => {
                  const filteredDocs = documents.filter(d =>
                    !docSearch || d.name.toLowerCase().includes(docSearch.toLowerCase())
                  );
                  const docTotalPages = Math.max(1, Math.ceil(filteredDocs.length / docPageSize));
                  const docSafePage   = Math.min(docPage, docTotalPages);
                  const pagedDocs     = filteredDocs.slice((docSafePage - 1) * docPageSize, docSafePage * docPageSize);
                  return (
                    <>
                      {/* Toolbar — only show when there are enough docs to warrant it */}
                      {documents.length > 5 && (
                        <div className="flex items-center gap-2 flex-wrap mb-3">
                          <div className="relative flex-1 min-w-0 max-w-xs">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              value={docSearch}
                              onChange={e => { setDocSearch(e.target.value); setDocPage(1); }}
                              placeholder="Search by filename…"
                              className="pl-8 h-8 text-sm border-border dark:border-gray-700"
                            />
                            {docSearch && (
                              <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => { setDocSearch(""); setDocPage(1); }}>
                                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <span>Show</span>
                            <Select value={String(docPageSize)} onValueChange={v => { setDocPageSize(Number(v)); setDocPage(1); }}>
                              <SelectTrigger className="w-16 h-8 text-sm border-border dark:border-gray-700" >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[5, 10, 25].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <span className="text-xs text-muted-foreground ml-auto">{filteredDocs.length} file{filteredDocs.length !== 1 ? "s" : ""}</span>
                        </div>
                      )}

                      {filteredDocs.length === 0 ? (
                        <div className="text-center py-6">
                          <p className="text-sm text-muted-foreground">No files match "<span className="font-medium">{docSearch}</span>"</p>
                          <button className="text-xs text-blue-600 mt-1 hover:underline" onClick={() => setDocSearch("")}>Clear</button>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {pagedDocs.map(doc => (
                              <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-border dark:border-gray-800 px-4 py-3">
                                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                                  <p className="text-xs text-muted-foreground">{Math.round(doc.size / 1024)} KB · {fmtDate(doc.createdAt)}</p>
                                </div>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => handleDownloadDocument(doc)}>
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>

                          {/* Pagination */}
                          {docTotalPages > 1 && (
                            <div className="flex items-center justify-between mt-4">
                              <p className="text-xs text-muted-foreground">
                                {(docSafePage - 1) * docPageSize + 1}–{Math.min(docSafePage * docPageSize, filteredDocs.length)} of {filteredDocs.length}
                              </p>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={docSafePage === 1} onClick={() => setDocPage(p => p - 1)}>
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </Button>
                                {Array.from({ length: docTotalPages }, (_, i) => i + 1).map(n => (
                                  <Button key={n} variant={n === docSafePage ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => setDocPage(n)}>{n}</Button>
                                ))}
                                <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={docSafePage === docTotalPages} onClick={() => setDocPage(p => p + 1)}>
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Modals ── */}
      {isManager && <AddMaintenanceModal
        isOpen={isAddMaintenanceModalOpen}
        onClose={() => setIsAddMaintenanceModalOpen(false)}
        preSelectedTenantId={parseInt(id || "0")}
      />}

      {tenant && isManager && (
        <AddTenantDialog
          open={isEditTenantDialogOpen}
          onClose={() => setIsEditTenantDialogOpen(false)}
          propertyName={tenant.property?.name || ""}
          units={
            // If the property units haven't loaded yet, still show the tenant's
            // current unit so the dropdown isn't empty when editing
            units.length > 0
              ? units
              : tenantUnit
              ? [tenantUnit]
              : []
          }
          tenant={{
            id: tenant.id,
            firstName: tenant.firstName,
            lastName: tenant.lastName,
            email: tenant.email,
            phone: tenant.phone || "",
            unitId: tenant.unitId,
            leaseStartDate: tenant.leaseStartDate || new Date().toISOString(),
            leaseEndDate:   tenant.leaseEndDate   || new Date().toISOString(),
            monthlyRent:    parseFloat(tenant.monthlyRent || "0"),
            securityDeposit: tenant.securityDeposit ? parseFloat(tenant.securityDeposit) : undefined,
            status: tenant.status,
          }}
          isSubmitting={updateTenantMutation.isPending}
          onSubmit={handleTenantSubmit}
        />
      )}
    </div>
  );
}