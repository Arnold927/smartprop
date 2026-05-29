import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  FileText,
  Plus,
  UserCheck,
  Shield,
  Clock,
  CheckCircle,
  AlertTriangle,
  Download,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { formatCurrency } from "@shared/currency";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  unitId?: number;
  leaseStartDate?: string;
  leaseEndDate?: string;
  monthlyRent?: string | number;
  securityDeposit?: string | number;
  currency: string;
  status: string;
}

interface Unit {
  id: number;
  unitNumber: string;
  propertyId: number;
  monthlyRent: string | number;
  currency: string;
}

interface Property {
  id: number;
  name: string;
}

// A "DigitalLease" is derived from a Tenant record enriched with unit/property info
interface DigitalLease {
  tenantId: number;
  firstName: string;
  lastName: string;
  email: string;
  leaseStartDate: string;
  leaseEndDate: string;
  monthlyRent: number;
  securityDeposit: number;
  currency: string;
  unitId?: number;
  unitNumber?: string;
  propertyId?: number;
  propertyName?: string;
  leaseStatus: "active" | "expired" | "pending" | "draft";
  kycStatus: "pending" | "verified" | "rejected" | "incomplete";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const deriveLeaseStatus = (startDate?: string, endDate?: string, tenantStatus?: string): DigitalLease["leaseStatus"] => {
  if (!startDate || !endDate) return "draft";
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (tenantStatus === "inactive") return "expired";
  if (now < start) return "pending";
  if (now > end) return "expired";
  return "active";
};

const statusColors: Record<string, string> = {
  draft: "bg-muted text-foreground",
  pending: "bg-yellow-100 text-yellow-800",
  active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  expired: "bg-red-100 text-red-800",
};

const kycStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  verified: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  rejected: "bg-red-100 text-red-800",
  incomplete: "bg-muted text-foreground",
};

// Persist KYC statuses locally (no dedicated endpoint exists)
const getKycStatus = (tenantId: number): DigitalLease["kycStatus"] => {
  try {
    const stored = localStorage.getItem(`kyc_status_${tenantId}`);
    return (stored as DigitalLease["kycStatus"]) || "pending";
  } catch {
    return "pending";
  }
};

const setKycStatus = (tenantId: number, status: DigitalLease["kycStatus"]) => {
  try {
    localStorage.setItem(`kyc_status_${tenantId}`, status);
  } catch {}
};

// ─── Empty form state ─────────────────────────────────────────────────────────

const emptyForm = {
  tenantId: "",
  unitId: "",
  propertyId: "",
  leaseType: "standard",
  startDate: "",
  endDate: "",
  monthlyRent: "",
  securityDeposit: "",
  currency: "KES",
  autoRenewal: false,
  petsAllowed: false,
  smokingAllowed: false,
  sublettingAllowed: false,
  utilitiesIncluded: false,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TenantCRM() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isKYCDialogOpen, setIsKYCDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [kycForm, setKycForm] = useState({ status: "pending", documentUrl: "" });
  const [kycRefresh, setKycRefresh] = useState(0); // force re-render after KYC save

  // Search & pagination state
  const [overviewSearch, setOverviewSearch] = useState("");
  const [kycSearch, setKycSearch] = useState("");
  const [overviewPage, setOverviewPage] = useState(1);
  const [kycPage, setKycPage] = useState(1);
  const [overviewPageSize, setOverviewPageSize] = useState(8);
  const [kycPageSize, setKycPageSize] = useState(8);
  const PAGE_SIZE_OPTIONS = [5, 8, 10, 20, 50];

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: tenantsRaw = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ["/api/tenants"],
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/tenants");
        const d = await r.json();
        return ensureArray(d);
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const { data: unitsRaw = [], isLoading: unitsLoading } = useQuery({
    queryKey: ["/api/units"],
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/units");
        const d = await r.json();
        return ensureArray(d);
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const { data: propertiesRaw = [], isLoading: propertiesLoading } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/properties");
        const d = await r.json();
        return ensureArray(d);
      } catch {
        return [];
      }
    },
    retry: false,
  });

  const tenants: Tenant[] = ensureArray(tenantsRaw);
  const units: Unit[] = ensureArray(unitsRaw);
  const properties: Property[] = ensureArray(propertiesRaw);

  // Build digital leases from tenant data
  const digitalLeases: DigitalLease[] = tenants
    .filter((t) => t.leaseStartDate || t.leaseEndDate || t.monthlyRent)
    .map((t) => {
      const unit = units.find((u) => u.id === t.unitId);
      const property = unit ? properties.find((p) => p.id === unit.propertyId) : undefined;
      return {
        tenantId: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        leaseStartDate: t.leaseStartDate || "",
        leaseEndDate: t.leaseEndDate || "",
        monthlyRent: parseFloat(String(t.monthlyRent || 0)),
        securityDeposit: parseFloat(String(t.securityDeposit || 0)),
        currency: t.currency || "KES",
        unitId: t.unitId,
        unitNumber: unit?.unitNumber,
        propertyId: unit?.propertyId,
        propertyName: property?.name,
        leaseStatus: deriveLeaseStatus(t.leaseStartDate, t.leaseEndDate, t.status),
        kycStatus: getKycStatus(t.id),
      };
    });

  // Tenants without a lease (can create one)
  const tenantsWithoutLease = tenants.filter(
    (t) => !digitalLeases.find((l) => l.tenantId === t.id)
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createLeaseMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest(`/api/tenants/${data.tenantId}`, {
        method: "PUT",
        data: {
          unitId: data.unitId ? parseInt(data.unitId) : undefined,
          leaseStartDate: data.startDate || null,
          leaseEndDate: data.endDate || null,
          monthlyRent: data.monthlyRent ? String(parseFloat(data.monthlyRent)) : undefined,
          securityDeposit: data.securityDeposit ? String(parseFloat(data.securityDeposit)) : undefined,
          currency: data.currency,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setIsCreateDialogOpen(false);
      setForm({ ...emptyForm });
      toast({ title: "Success", description: "Digital lease created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to create digital lease", variant: "destructive" });
    },
  });

  const updateLeaseMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest(`/api/tenants/${data.tenantId}`, {
        method: "PUT",
        data: {
          unitId: data.unitId ? parseInt(data.unitId) : undefined,
          leaseStartDate: data.startDate || null,
          leaseEndDate: data.endDate || null,
          monthlyRent: data.monthlyRent ? String(parseFloat(data.monthlyRent)) : undefined,
          securityDeposit: data.securityDeposit ? String(parseFloat(data.securityDeposit)) : undefined,
          currency: data.currency,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setIsEditDialogOpen(false);
      setSelectedTenantId(null);
      toast({ title: "Success", description: "Digital lease updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update digital lease", variant: "destructive" });
    },
  });

  const deleteLeaseMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      // "Delete" the lease by clearing lease fields on the tenant
      const res = await apiRequest(`/api/tenants/${tenantId}`, {
        method: "PUT",
        data: {
          leaseStartDate: null,
          leaseEndDate: null,
          monthlyRent: null,
          securityDeposit: null,
          unitId: null,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setIsDeleteDialogOpen(false);
      setSelectedTenantId(null);
      toast({ title: "Deleted", description: "Digital lease removed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to delete lease", variant: "destructive" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setForm({ ...emptyForm });
    setIsCreateDialogOpen(true);
  };

  const handleOpenEdit = (lease: DigitalLease) => {
    setSelectedTenantId(lease.tenantId);
    setForm({
      ...emptyForm,
      tenantId: String(lease.tenantId),
      unitId: String(lease.unitId || ""),
      propertyId: String(lease.propertyId || ""),
      startDate: lease.leaseStartDate || "",
      endDate: lease.leaseEndDate || "",
      monthlyRent: String(lease.monthlyRent || ""),
      securityDeposit: String(lease.securityDeposit || ""),
      currency: lease.currency || "KES",
    });
    setIsEditDialogOpen(true);
  };

  const handleOpenDelete = (tenantId: number) => {
    setSelectedTenantId(tenantId);
    setIsDeleteDialogOpen(true);
  };

  const handleOpenKYC = (lease: DigitalLease) => {
    setSelectedTenantId(lease.tenantId);
    setKycForm({ status: lease.kycStatus, documentUrl: "" });
    setIsKYCDialogOpen(true);
  };

  const handleCreateSubmit = () => {
    if (!form.tenantId || !form.startDate || !form.endDate || !form.monthlyRent) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createLeaseMutation.mutate(form);
  };

  const handleEditSubmit = () => {
    if (!selectedTenantId || !form.startDate || !form.endDate || !form.monthlyRent) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    updateLeaseMutation.mutate({ ...form, tenantId: selectedTenantId });
  };

  const handleKYCSubmit = () => {
    if (!selectedTenantId) return;
    setKycStatus(selectedTenantId, kycForm.status as DigitalLease["kycStatus"]);
    setKycRefresh((n) => n + 1);
    setIsKYCDialogOpen(false);
    toast({ title: "Success", description: "KYC verification status updated" });
  };

  const handleDownloadLease = (lease: DigitalLease) => {
    const startDate = lease.leaseStartDate ? new Date(lease.leaseStartDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "N/A";
    const endDate = lease.leaseEndDate ? new Date(lease.leaseEndDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "N/A";
    const rent = `${lease.currency} ${Number(lease.monthlyRent).toLocaleString()}`;
    const deposit = lease.securityDeposit > 0 ? `${lease.currency} ${Number(lease.securityDeposit).toLocaleString()}` : "N/A";
    const generatedOn = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    const kycBadgeColor = lease.kycStatus === "verified" ? "#059669" : lease.kycStatus === "rejected" ? "#dc2626" : "#d97706";
    const statusBadgeColor = lease.leaseStatus === "active" ? "#059669" : lease.leaseStatus === "expired" ? "#dc2626" : "#d97706";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Lease Agreement — ${lease.firstName} ${lease.lastName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; color: #1a1a1a; background: #fff; padding: 48px; font-size: 14px; line-height: 1.6; }
    @media print { body { padding: 24px; } @page { margin: 1.5cm; } }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 2px solid #1a1a1a; margin-bottom: 32px; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .brand span { color: #059669; }
    .doc-meta { text-align: right; font-size: 12px; color: #6b7280; }
    .doc-meta strong { display: block; font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }

    /* Status badges */
    .badges { display: flex; gap: 8px; margin-bottom: 32px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    /* Sections */
    .section { margin-bottom: 28px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .field label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; display: block; margin-bottom: 2px; }
    .field value { font-size: 14px; font-weight: 500; color: #111827; display: block; }
    .field value.large { font-size: 18px; font-weight: 700; }

    /* Divider */
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }

    /* Terms box */
    .terms-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
    .terms-box p { font-size: 12px; color: #6b7280; line-height: 1.7; }

    /* Footer */
    .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }

    /* Signature area */
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; }
    .sig-block { border-top: 1px solid #1a1a1a; padding-top: 8px; font-size: 12px; color: #6b7280; }
    .sig-block strong { display: block; color: #1a1a1a; font-weight: 600; }
  </style>
</head>
<body>

  <div class="header">
    <div class="brand">Smart<span>Prop</span></div>
    <div class="doc-meta">
      <strong>Digital Lease Agreement</strong>
      Document ref: SP-${lease.tenantId}-${Date.now().toString().slice(-6)}<br/>
      Generated: ${generatedOn}
    </div>
  </div>

  <div class="badges">
    <span class="badge" style="background:${statusBadgeColor}18; color:${statusBadgeColor};">Lease: ${lease.leaseStatus}</span>
    <span class="badge" style="background:${kycBadgeColor}18; color:${kycBadgeColor};">KYC: ${lease.kycStatus}</span>
  </div>

  <div class="section">
    <div class="section-title">Tenant Information</div>
    <div class="grid-2">
      <div class="field"><label>Full Name</label><value>${lease.firstName} ${lease.lastName}</value></div>
      <div class="field"><label>Email Address</label><value>${lease.email}</value></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Property Details</div>
    <div class="grid-2">
      <div class="field"><label>Property</label><value>${lease.propertyName || "—"}</value></div>
      <div class="field"><label>Unit</label><value>${lease.unitNumber ? `Unit ${lease.unitNumber}` : "—"}</value></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Lease Terms</div>
    <div class="grid-3">
      <div class="field"><label>Start Date</label><value>${startDate}</value></div>
      <div class="field"><label>End Date</label><value>${endDate}</value></div>
      <div class="field"><label>Monthly Rent</label><value class="large">${rent}</value></div>
    </div>
    <div style="margin-top:16px;" class="grid-2">
      <div class="field"><label>Security Deposit</label><value>${deposit}</value></div>
      <div class="field"><label>Currency</label><value>${lease.currency}</value></div>
    </div>
  </div>

  <div class="section">
    <div class="terms-box">
      <div class="section-title" style="border:none;padding:0;margin-bottom:8px;">Terms &amp; Conditions</div>
      <p>This lease agreement is entered into between the landlord and the tenant named above. The tenant agrees to pay the monthly rent on the agreed due date. The security deposit will be held against damages beyond normal wear and tear. This agreement is governed by applicable local tenancy laws. Any modifications to this agreement must be made in writing and signed by both parties.</p>
    </div>
  </div>

  <div class="sig-grid">
    <div class="sig-block">
      <strong>Tenant Signature</strong>
      ${lease.firstName} ${lease.lastName}<br/>Date: _______________
    </div>
    <div class="sig-block">
      <strong>Landlord / Agent Signature</strong>
      Authorised Representative<br/>Date: _______________
    </div>
  </div>

  <div class="footer">
    <span>SmartProp Property Management Platform</span>
    <span>Ref: SP-${lease.tenantId} · ${generatedOn}</span>
  </div>

  <script>
    window.onload = () => { window.print(); };
  </script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      toast({ title: "Popup blocked", description: "Please allow popups for this site to download leases.", variant: "destructive" });
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast({ title: "Lease ready", description: `Use your browser's print dialog to save as PDF.` });
  };

  // ── Stats ──────────────────────────────────────────────────────────────────

  // Re-compute with kycRefresh so KYC badges update immediately
  const leasesWithFreshKyc = digitalLeases.map((l) => ({
    ...l,
    kycStatus: getKycStatus(l.tenantId),
  }));

  const stats = {
    total: leasesWithFreshKyc.length,
    active: leasesWithFreshKyc.filter((l) => l.leaseStatus === "active").length,
    pending: leasesWithFreshKyc.filter((l) => l.leaseStatus === "pending").length,
    expired: leasesWithFreshKyc.filter((l) => l.leaseStatus === "expired").length,
    kycPending: leasesWithFreshKyc.filter((l) => l.kycStatus === "pending").length,
    kycVerified: leasesWithFreshKyc.filter((l) => l.kycStatus === "verified").length,
  };

  // ── Filtered & paginated data ──────────────────────────────────────────────

  const overviewFiltered = leasesWithFreshKyc.filter((l) => {
    const q = overviewSearch.toLowerCase();
    return (
      !q ||
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      (l.propertyName || "").toLowerCase().includes(q) ||
      (l.unitNumber || "").toLowerCase().includes(q) ||
      l.leaseStatus.includes(q) ||
      l.kycStatus.includes(q)
    );
  });

  const overviewTotalPages = Math.max(1, Math.ceil(overviewFiltered.length / overviewPageSize));
  const overviewPageSafe = Math.min(overviewPage, overviewTotalPages);
  const overviewPaged = overviewFiltered.slice((overviewPageSafe - 1) * overviewPageSize, overviewPageSafe * overviewPageSize);

  const kycFiltered = leasesWithFreshKyc.filter((l) => {
    const q = kycSearch.toLowerCase();
    return (
      !q ||
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      (l.unitNumber || "").toLowerCase().includes(q) ||
      l.kycStatus.includes(q)
    );
  });

  const kycTotalPages = Math.max(1, Math.ceil(kycFiltered.length / kycPageSize));
  const kycPageSafe = Math.min(kycPage, kycTotalPages);
  const kycPaged = kycFiltered.slice((kycPageSafe - 1) * kycPageSize, kycPageSafe * kycPageSize);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (tenantsLoading || unitsLoading || propertiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading tenant CRM...</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Tenant CRM & Digital Lease Management</h1>
          <p className="text-muted-foreground">
            Manage digital leases, KYC verification, and tenant relationships
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Digital Lease
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: "Total Leases", value: stats.total, icon: <FileText className="h-4 w-4 text-muted-foreground" /> },
          { label: "Active", value: stats.active, icon: <CheckCircle className="h-4 w-4 text-green-600" /> },
          { label: "Pending", value: stats.pending, icon: <Clock className="h-4 w-4 text-yellow-600" /> },
          { label: "Expired", value: stats.expired, icon: <AlertTriangle className="h-4 w-4 text-red-600" /> },
          { label: "KYC Pending", value: stats.kycPending, icon: <UserCheck className="h-4 w-4 text-yellow-600" /> },
          { label: "KYC Verified", value: stats.kycVerified, icon: <Shield className="h-4 w-4 text-green-600" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Digital Leases</TabsTrigger>
          <TabsTrigger value="kyc">KYC Management</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle>Digital Lease Agreements</CardTitle>
                  <CardDescription>
                    Manage all digital lease agreements and tenant relationships
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-56">
                    <Input
                      placeholder="Search tenants, property, status…"
                      value={overviewSearch}
                      onChange={(e) => { setOverviewSearch(e.target.value); setOverviewPage(1); }}
                      className="pl-9"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    </span>
                  </div>
                  <Select
                    value={String(overviewPageSize)}
                    onValueChange={(v) => { setOverviewPageSize(Number(v)); setOverviewPage(1); }}
                  >
                    <SelectTrigger className="w-[90px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Tenant</TableHead>
                      <TableHead>Property / Unit</TableHead>
                      <TableHead>Rent</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>KYC</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overviewPaged.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                          {overviewSearch ? `No leases matching "${overviewSearch}"` : "No digital leases found. Create one to get started."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      overviewPaged.map((lease) => (
                        <TableRow key={lease.tenantId} className="hover:bg-muted/40 transition-colors">
                          <TableCell className="pl-6">
                            <div className="font-medium">
                              {lease.firstName} {lease.lastName}
                            </div>
                            <div className="text-sm text-muted-foreground truncate max-w-[180px]">{lease.email}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{lease.propertyName || "—"}</div>
                            {lease.unitNumber && (
                              <div className="text-sm text-muted-foreground">
                                Unit {lease.unitNumber}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium whitespace-nowrap">
                              {formatCurrency(lease.monthlyRent, lease.currency as any)}/mo
                            </div>
                            {lease.securityDeposit > 0 && (
                              <div className="text-sm text-muted-foreground whitespace-nowrap">
                                Dep: {formatCurrency(lease.securityDeposit, lease.currency as any)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm whitespace-nowrap">
                              {lease.leaseStartDate
                                ? new Date(lease.leaseStartDate).toLocaleDateString()
                                : "—"}
                            </div>
                            <div className="text-sm text-muted-foreground whitespace-nowrap">
                              → {lease.leaseEndDate
                                ? new Date(lease.leaseEndDate).toLocaleDateString()
                                : "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColors[lease.leaseStatus]}>
                              {lease.leaseStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={kycStatusColors[lease.kycStatus]}>
                              {lease.kycStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6">
                            <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Open actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onClick={() => handleOpenKYC(lease)}>
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    Update KYC
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleOpenEdit(lease)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit Lease
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDownloadLease(lease)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => handleOpenDelete(lease.tenantId)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Lease
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination */}
              {overviewFiltered.length > overviewPageSize && (
                <div className="flex items-center justify-between px-6 py-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {(overviewPageSafe - 1) * overviewPageSize + 1}–{Math.min(overviewPageSafe * overviewPageSize, overviewFiltered.length)} of {overviewFiltered.length} leases
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={overviewPageSafe <= 1}
                      onClick={() => setOverviewPage(overviewPageSafe - 1)}
                    >
                      ‹ Prev
                    </Button>
                    {Array.from({ length: overviewTotalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === overviewTotalPages || Math.abs(p - overviewPageSafe) <= 1)
                      .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, i) =>
                        p === "…" ? (
                          <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
                        ) : (
                          <Button
                            key={p}
                            variant={p === overviewPageSafe ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setOverviewPage(p as number)}
                          >
                            {p}
                          </Button>
                        )
                      )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={overviewPageSafe >= overviewTotalPages}
                      onClick={() => setOverviewPage(overviewPageSafe + 1)}
                    >
                      Next ›
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── KYC tab ── */}
        <TabsContent value="kyc" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle>KYC Verification Management</CardTitle>
                  <CardDescription>
                    Manage tenant identity verification and document validation
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-56">
                    <Input
                      placeholder="Search by name, email, status…"
                      value={kycSearch}
                      onChange={(e) => { setKycSearch(e.target.value); setKycPage(1); }}
                      className="pl-9"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    </span>
                  </div>
                  <Select
                    value={String(kycPageSize)}
                    onValueChange={(v) => { setKycPageSize(Number(v)); setKycPage(1); }}
                  >
                    <SelectTrigger className="w-[90px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {kycFiltered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {kycSearch ? `No tenants matching "${kycSearch}"` : "No tenants found"}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Tenant</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Lease Status</TableHead>
                          <TableHead>KYC Status</TableHead>
                          <TableHead className="pr-6 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kycPaged.map((lease) => (
                          <TableRow key={lease.tenantId} className="hover:bg-muted/40 transition-colors">
                            <TableCell className="pl-6">
                              <div className="font-medium">{lease.firstName} {lease.lastName}</div>
                              <div className="text-sm text-muted-foreground truncate max-w-[200px]">{lease.email}</div>
                            </TableCell>
                            <TableCell>
                              {lease.unitNumber ? (
                                <>
                                  <div className="font-medium">Unit {lease.unitNumber}</div>
                                  {lease.propertyName && (
                                    <div className="text-sm text-muted-foreground">{lease.propertyName}</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[lease.leaseStatus]}>
                                {lease.leaseStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={kycStatusColors[lease.kycStatus]}>
                                {lease.kycStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Open actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onClick={() => handleOpenKYC(lease)}>
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    {lease.kycStatus === "pending" ? "Process KYC" : "Update KYC"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleOpenEdit(lease)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit Lease
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDownloadLease(lease)}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination */}
                  {kycFiltered.length > kycPageSize && (
                    <div className="flex items-center justify-between px-6 py-4 border-t">
                      <p className="text-sm text-muted-foreground">
                        Showing {(kycPageSafe - 1) * kycPageSize + 1}–{Math.min(kycPageSafe * kycPageSize, kycFiltered.length)} of {kycFiltered.length} tenants
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={kycPageSafe <= 1}
                          onClick={() => setKycPage(kycPageSafe - 1)}
                        >
                          ‹ Prev
                        </Button>
                        {Array.from({ length: kycTotalPages }, (_, i) => i + 1)
                          .filter((p) => p === 1 || p === kycTotalPages || Math.abs(p - kycPageSafe) <= 1)
                          .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                            if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                            acc.push(p);
                            return acc;
                          }, [])
                          .map((p, i) =>
                            p === "…" ? (
                              <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
                            ) : (
                              <Button
                                key={p}
                                variant={p === kycPageSafe ? "default" : "outline"}
                                size="sm"
                                className="w-8 h-8 p-0"
                                onClick={() => setKycPage(p as number)}
                              >
                                {p}
                              </Button>
                            )
                          )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={kycPageSafe >= kycTotalPages}
                          onClick={() => setKycPage(kycPageSafe + 1)}
                        >
                          Next ›
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Analytics tab ── */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Lease Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(["active", "pending", "expired", "draft"] as const).map((status) => {
                    const count = leasesWithFreshKyc.filter((l) => l.leaseStatus === status).length;
                    return (
                      <div key={status} className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Badge className={statusColors[status]}>{status}</Badge>
                        </div>
                        <span className="font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>KYC Verification Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(["pending", "verified", "rejected", "incomplete"] as const).map((status) => {
                    const count = leasesWithFreshKyc.filter((l) => l.kycStatus === status).length;
                    return (
                      <div key={status} className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Badge className={kycStatusColors[status]}>{status}</Badge>
                        </div>
                        <span className="font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {["KES", "USD", "EUR"].map((currency) => {
                    const total = leasesWithFreshKyc
                      .filter((l) => l.currency === currency && l.leaseStatus === "active")
                      .reduce((sum, l) => sum + l.monthlyRent, 0);
                    if (total === 0) return null;
                    return (
                      <div key={currency} className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Active monthly ({currency})
                        </span>
                        <span className="font-medium">
                          {formatCurrency(total, currency as any)}
                        </span>
                      </div>
                    );
                  })}
                  {leasesWithFreshKyc.filter((l) => l.leaseStatus === "active").length === 0 && (
                    <p className="text-muted-foreground text-sm">No active leases</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Create Lease Dialog ── */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Digital Lease</DialogTitle>
            <DialogDescription>
              Create a new digital lease agreement for a tenant
            </DialogDescription>
          </DialogHeader>
          <LeaseForm
            form={form}
            setForm={setForm}
            tenants={tenants.filter((t) => tenantsWithoutLease.some((tw) => tw.id === t.id))}
            units={units}
            properties={properties}
            onSubmit={handleCreateSubmit}
            isPending={createLeaseMutation.isPending}
            submitLabel="Create Digital Lease"
            lockTenant={false}
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit Lease Dialog ── */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Digital Lease</DialogTitle>
            <DialogDescription>
              Update lease terms for{" "}
              {selectedTenantId
                ? (() => {
                    const t = tenants.find((x) => x.id === selectedTenantId);
                    return t ? `${t.firstName} ${t.lastName}` : "";
                  })()
                : ""}
            </DialogDescription>
          </DialogHeader>
          <LeaseForm
            form={form}
            setForm={setForm}
            tenants={tenants}
            units={units}
            properties={properties}
            onSubmit={handleEditSubmit}
            isPending={updateLeaseMutation.isPending}
            submitLabel="Update Digital Lease"
            lockTenant={true}
          />
        </DialogContent>
      </Dialog>

      {/* ── KYC Dialog ── */}
      <Dialog open={isKYCDialogOpen} onOpenChange={setIsKYCDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>KYC Verification</DialogTitle>
            <DialogDescription>
              Update KYC verification status for{" "}
              {selectedTenantId
                ? (() => {
                    const t = tenants.find((x) => x.id === selectedTenantId);
                    return t ? `${t.firstName} ${t.lastName}` : "";
                  })()
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Verification Status</Label>
              <Select
                value={kycForm.status}
                onValueChange={(v) => setKycForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ID Document URL (optional)</Label>
              <Input
                type="url"
                placeholder="https://example.com/document.pdf"
                value={kycForm.documentUrl}
                onChange={(e) => setKycForm((f) => ({ ...f, documentUrl: e.target.value }))}
              />
            </div>
            <Button className="w-full" onClick={handleKYCSubmit}>
              Update KYC Status
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Digital Lease</DialogTitle>
            <DialogDescription>
              This will remove all lease information (dates, rent, unit) from the tenant record.
              The tenant profile itself will remain. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedTenantId && deleteLeaseMutation.mutate(selectedTenantId)}
              disabled={deleteLeaseMutation.isPending}
            >
              {deleteLeaseMutation.isPending ? "Deleting..." : "Delete Lease"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Shared Lease Form ────────────────────────────────────────────────────────

interface LeaseFormProps {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  tenants: Tenant[];
  units: Unit[];
  properties: Property[];
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
  lockTenant: boolean;
}

function LeaseForm({
  form,
  setForm,
  tenants,
  units,
  properties,
  onSubmit,
  isPending,
  submitLabel,
  lockTenant,
}: LeaseFormProps) {
  const set = (key: keyof typeof emptyForm) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleTenantChange = (tenantId: string) => {
    const tenant = tenants.find((t) => String(t.id) === tenantId);
    if (!tenant) { setForm((f) => ({ ...f, tenantId })); return; }

    const unit = units.find((u) => u.id === tenant.unitId);
    const property = unit ? properties.find((p) => p.id === unit.propertyId) : undefined;

    setForm((f) => ({
      ...f,
      tenantId,
      unitId: unit ? String(unit.id) : "",
      propertyId: property ? String(property.id) : "",
      monthlyRent: tenant.monthlyRent
        ? String(tenant.monthlyRent)
        : unit?.monthlyRent ? String(unit.monthlyRent) : f.monthlyRent,
      securityDeposit: tenant.securityDeposit ? String(tenant.securityDeposit) : f.securityDeposit,
      currency: tenant.currency || unit?.currency || f.currency,
      startDate: tenant.leaseStartDate ? tenant.leaseStartDate.slice(0, 10) : f.startDate,
      endDate: tenant.leaseEndDate ? tenant.leaseEndDate.slice(0, 10) : f.endDate,
    }));
  };

  // Filter units to selected property
  const filteredUnits = form.propertyId
    ? units.filter((u) => u.propertyId === parseInt(form.propertyId))
    : units;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Tenant */}
        <div className="space-y-2">
          <Label>Tenant *</Label>
          <Select
            value={form.tenantId}
            onValueChange={handleTenantChange}
            disabled={lockTenant}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No tenants available
                </SelectItem>
              ) : (
                tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.firstName} {t.lastName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Lease Type */}
        <div className="space-y-2">
          <Label>Lease Type</Label>
          <Select value={form.leaseType} onValueChange={set("leaseType")}>
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard Lease</SelectItem>
              <SelectItem value="short_term">Short Term</SelectItem>
              <SelectItem value="rent_to_own">Rent-to-Own</SelectItem>
              <SelectItem value="commercial">Commercial</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Property */}
        <div className="space-y-2">
          <Label>Property</Label>
          <Select
            value={form.propertyId}
            onValueChange={(v) => {
              setForm((f) => ({ ...f, propertyId: v, unitId: "" }));
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select property" />
            </SelectTrigger>
            <SelectContent>
              {properties.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No properties available
                </SelectItem>
              ) : (
                properties.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Unit */}
        <div className="space-y-2">
          <Label>Unit</Label>
          <Select value={form.unitId} onValueChange={set("unitId")}>
            <SelectTrigger>
              <SelectValue placeholder="Select unit" />
            </SelectTrigger>
            <SelectContent>
              {filteredUnits.length === 0 ? (
                <SelectItem value="__none" disabled>
                  {form.propertyId ? "No units in property" : "Select a property first"}
                </SelectItem>
              ) : (
                filteredUnits.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    Unit {u.unitNumber} — {formatCurrency(u.monthlyRent as any, u.currency as any)}
                    /mo
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Monthly Rent */}
        <div className="space-y-2">
          <Label>Monthly Rent *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form.monthlyRent}
            onChange={(e) => set("monthlyRent")(e.target.value)}
          />
        </div>

        {/* Security Deposit */}
        <div className="space-y-2">
          <Label>Security Deposit</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form.securityDeposit}
            onChange={(e) => set("securityDeposit")(e.target.value)}
          />
        </div>

        {/* Currency */}
        <div className="space-y-2">
          <Label>Currency</Label>
          <Select value={form.currency} onValueChange={set("currency")}>
            <SelectTrigger>
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="KES">KES — Kenyan Shilling</SelectItem>
              <SelectItem value="USD">USD — US Dollar</SelectItem>
              <SelectItem value="EUR">EUR — Euro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Start Date */}
        <div className="space-y-2">
          <Label>Start Date *</Label>
          <Input
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate")(e.target.value)}
          />
        </div>

        {/* End Date */}
        <div className="space-y-2">
          <Label>End Date *</Label>
          <Input
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate")(e.target.value)}
          />
        </div>
      </div>

      {/* Lease Terms */}
      <div className="space-y-2">
        <Label>Lease Terms & Conditions</Label>
        <div className="grid grid-cols-2 gap-3 border rounded-lg p-4">
          {(
            [
              ["petsAllowed", "Pets Allowed"],
              ["smokingAllowed", "Smoking Allowed"],
              ["sublettingAllowed", "Subletting Allowed"],
              ["utilitiesIncluded", "Utilities Included"],
              ["autoRenewal", "Auto Renewal"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={key}
                checked={!!form[key]}
                onChange={(e) => set(key)(e.target.checked)}
                className="rounded"
              />
              <label htmlFor={key} className="text-sm cursor-pointer">
                {label}
              </label>
            </div>
          ))}
        </div>
      </div>

      <Button className="w-full" disabled={isPending} onClick={onSubmit}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </div>
  );
}