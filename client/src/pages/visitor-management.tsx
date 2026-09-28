import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QrCode, Plus, UserCheck, Clock, CheckCircle, XCircle, Shield, Download, Trash2, Ban } from "lucide-react";
import QRCode from "qrcode";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


interface VisitorAccess {
  id: number;
  visitor_code: string;
  qr_code_data: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_id_number: string | null;
  host_tenant_id: number | null;
  host_unit_id: number | null;
  property_id: number;
  visit_purpose: string | null;
  expected_arrival: string;
  expected_departure: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  access_method: string;
  gate_integration_status: string;
  access_granted: boolean;
  access_revoked: boolean;
  visitor_photo_url: string | null;
  security_notes: string | null;
  check_in_location: string | null;
  check_out_location: string | null;
  status: string;
  created_by: string;
  created_at: string;
  first_name?: string;
  last_name?: string;
  unit_number?: string;
  property_name?: string;
}

// Renders a real QR code SVG for a visitor access code
function VisitorQRCode({ value, size = 160 }: { value: string; size?: number }) {
  const [svgData, setSvgData] = React.useState<string>("");

  React.useEffect(() => {
    if (!value) return;
    QRCode.toString(value, { type: "svg", width: size, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then(setSvgData)
      .catch(console.error);
  }, [value, size]);

  if (!svgData) return <div style={{ width: size, height: size }} className="bg-muted animate-pulse rounded" />;
  return <div dangerouslySetInnerHTML={{ __html: svgData }} style={{ width: size, height: size }} />;
}

const accessMethods = [
  { value: "qr_code", label: "QR Code", icon: QrCode },
  { value: "smart_gate", label: "Smart Gate", icon: Shield },
  { value: "manual", label: "Manual Entry", icon: UserCheck },
  { value: "biometric", label: "Biometric", icon: Shield },
];

export default function VisitorManagement() {
  const guard = useRoleGuard(["admin", "manager", "caretaker", "landlord"]);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const [selectedVisitor, setSelectedVisitor] = useState<VisitorAccess | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCheckInDialogOpen, setIsCheckInDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Controlled state for shadcn <Select> fields (they don't write to native FormData)
  const [formHostTenantId, setFormHostTenantId] = useState("");
  const [formHostUnitId, setFormHostUnitId] = useState("");
  const [formPropertyId, setFormPropertyId] = useState("");
  const [formAccessMethod, setFormAccessMethod] = useState("qr_code");
  const [formCheckInLocation, setFormCheckInLocation] = useState("Main Gate");
  const [qrModalVisitor, setQrModalVisitor] = useState<VisitorAccess | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);
  const [detailsVisitor, setDetailsVisitor] = useState<VisitorAccess | null>(null);

  const downloadQR = async (visitor: VisitorAccess) => {
    const svg = await QRCode.toString(visitor.visitor_code, { type: "svg", width: 300, margin: 2 });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${visitor.visitor_code}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // When a tenant is selected, auto-populate their unit and property
  const handleTenantChange = (tenantId: string) => {
    setFormHostTenantId(tenantId);
    const tenant = (tenants as any[]).find((t: any) => t.id.toString() === tenantId);
    if (tenant?.unitId) {
      setFormHostUnitId(tenant.unitId.toString());
      const unit = (units as any[]).find((u: any) => u.id === tenant.unitId);
      if (unit?.propertyId) {
        setFormPropertyId(unit.propertyId.toString());
      }
    }
  };

  // Queries
  const { data: visitorAccessRaw = [], isLoading: visitorsLoading } = useQuery<VisitorAccess[]>({
    queryKey: ["/api/visitor-access-management"],
    refetchInterval: 30_000, // auto-refresh every 30s to show live check-ins
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/visitor-access-management");
        const d = await r.json();
        return ensureArray(d);
      } catch (error) {
        console.error("Error fetching visitor access:", error);
        return [];
      }
    },
    retry: false,
  });

  const { data: tenantsRaw = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ["/api/tenants"],
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/tenants");
        const d = await r.json();
        return ensureArray(d);
      } catch (error) { return []; }
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
      } catch (error) { return []; }
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
      } catch (error) { return []; }
    },
    retry: false,
  });

  const visitorAccess = ensureArray(visitorAccessRaw);
  const tenants = ensureArray(tenantsRaw);
  const units = ensureArray(unitsRaw);
  const properties = ensureArray(propertiesRaw);

  // Mutations
  const createVisitorAccessMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await apiRequest("/api/visitor-access-management", { method: "POST", data });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create visitor access");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      setIsCreateDialogOpen(false);
      setFormHostTenantId("");
      setFormHostUnitId("");
      setFormPropertyId("");
      setFormAccessMethod("qr_code");
      toast({ title: "Success", description: "Visitor access created with QR code" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create visitor access", variant: "destructive" });
    },
  });

  const checkInVisitorMutation = useMutation({
    mutationFn: async ({ code, data }: { code: string; data: any }) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}/check-in`, { method: "PATCH", data });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to check in visitor");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      setIsCheckInDialogOpen(false);
      toast({ title: "Success", description: "Visitor checked in successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to check in visitor", variant: "destructive" });
    },
  });

  const checkOutVisitorMutation = useMutation({
    mutationFn: async ({ code, data }: { code: string; data: any }) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}/check-out`, { method: "PATCH", data });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to check out visitor");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      toast({ title: "Success", description: "Visitor checked out successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to check out visitor", variant: "destructive" });
    },
  });

  const approveVisitorMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}/approve`, { method: "PATCH", data: {} });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to approve visitor");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      toast({ title: "Success", description: "Visitor approved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to approve visitor", variant: "destructive" });
    },
  });

  const revokeVisitorMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}/revoke`, { method: "PATCH", data: {} });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to revoke visitor access");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      toast({ title: "Access Revoked", description: "Visitor access has been revoked" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to revoke access", variant: "destructive" });
    },
  });

  const deleteVisitorMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to delete visitor record");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      setCurrentPage(1);
      toast({ title: "Deleted", description: "Visitor record deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete visitor record", variant: "destructive" });
    },
  });

  const handleCreateVisitorAccess = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createVisitorAccessMutation.mutate({
      visitorName: formData.get("visitorName") as string,
      visitorPhone: formData.get("visitorPhone") as string,
      visitorIdNumber: formData.get("visitorIdNumber") as string,
      hostTenantId: formHostTenantId || null,
      hostUnitId: formHostUnitId || null,
      propertyId: formPropertyId,
      visitPurpose: formData.get("visitPurpose") as string,
      expectedArrival: formData.get("expectedArrival") as string,
      expectedDeparture: formData.get("expectedDeparture") as string,
      accessMethod: formAccessMethod,
    });
  };

  const handleCheckIn = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedVisitor) return;
    checkInVisitorMutation.mutate({
      code: selectedVisitor.visitor_code,
      data: { location: formCheckInLocation },
    });
  };

  const handleCheckOut = (visitorCode: string, location = "Main Gate") => {
    checkOutVisitorMutation.mutate({ code: visitorCode, data: { location } });
  };

  const getVisitorStats = () => {
    const today = new Date().toISOString().split("T")[0];
    return {
      total: visitorAccess.length,
      pending: visitorAccess.filter((v) => v.status === "pending").length,
      checkedIn: visitorAccess.filter((v) => v.status === "checked_in").length,
      checkedOut: visitorAccess.filter((v) => v.status === "checked_out").length,
      todayVisitors: visitorAccess.filter((v) => v.expected_arrival?.startsWith(today)).length,
      activeVisitors: visitorAccess.filter((v) => v.status === "checked_in").length,
    };
  };

  const stats = getVisitorStats();

  const filteredVisitors = visitorAccess.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.visitor_name?.toLowerCase().includes(q) ||
      v.visitor_code?.toLowerCase().includes(q) ||
      v.visitor_phone?.toLowerCase().includes(q) ||
      v.visit_purpose?.toLowerCase().includes(q) ||
      v.property_name?.toLowerCase().includes(q) ||
      v.unit_number?.toLowerCase().includes(q) ||
      v.status?.toLowerCase().includes(q) ||
      (`${v.first_name ?? ""} ${v.last_name ?? ""}`).toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredVisitors.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedVisitors = filteredVisitors.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  };

  if (visitorsLoading || tenantsLoading || unitsLoading || propertiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading visitor management...</p>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Visitor Access Management"
        subtitle="QR-code based visitor access with smart gate integration and real-time tracking"
        icon={<Shield className="w-5 h-5" />}
        actions={
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              setFormHostTenantId("");
              setFormHostUnitId("");
              setFormPropertyId("");
              setFormAccessMethod("qr_code");
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Visitor Access
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Visitor Access</DialogTitle>
                <DialogDescription>
                  Generate QR code for visitor access with smart gate integration
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateVisitorAccess} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="visitorName">Visitor Name *</Label>
                    <Input name="visitorName" placeholder="Full name" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="visitorPhone">Phone Number</Label>
                    <Input name="visitorPhone" type="tel" placeholder="+254..." />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="visitorIdNumber">ID/Passport Number</Label>
                  <Input name="visitorIdNumber" placeholder="ID or Passport number" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Host Tenant</Label>
                    <Select value={formHostTenantId} onValueChange={handleTenantChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select host" />
                      </SelectTrigger>
                      <SelectContent>
                        {tenants.length === 0 ? (
                          <SelectItem value="__none" disabled>No tenants available</SelectItem>
                        ) : (
                          tenants.map((tenant: any) => (
                            <SelectItem key={tenant.id} value={tenant.id.toString()}>
                              {tenant.firstName} {tenant.lastName}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={formHostUnitId} onValueChange={setFormHostUnitId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.length === 0 ? (
                        <SelectItem value="__none" disabled>No units available</SelectItem>
                      ) : (
                        units.map((unit: any) => (
                          <SelectItem key={unit.id} value={unit.id.toString()}>
                            Unit {unit.unitNumber}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Property *</Label>
                <Select value={formPropertyId} onValueChange={setFormPropertyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.length === 0 ? (
                      <SelectItem value="__none" disabled>No properties available</SelectItem>
                    ) : (
                      properties.map((property: any) => (
                        <SelectItem key={property.id} value={property.id.toString()}>
                          {property.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="visitPurpose">Visit Purpose *</Label>
                <Input name="visitPurpose" placeholder="e.g., Social visit, Delivery, Maintenance" required />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expectedArrival">Expected Arrival *</Label>
                  <Input name="expectedArrival" type="datetime-local" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedDeparture">Expected Departure</Label>
                  <Input name="expectedDeparture" type="datetime-local" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Access Method</Label>
                <Select value={formAccessMethod} onValueChange={setFormAccessMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select access method" />
                  </SelectTrigger>
                  <SelectContent>
                    {accessMethods.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        <div className="flex items-center gap-2">
                          <method.icon className="h-4 w-4" />
                          {method.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                disabled={createVisitorAccessMutation.isPending || !formPropertyId}
                className="w-full"
              >
                {createVisitorAccessMutation.isPending ? "Creating..." : "Create Visitor Access & QR Code"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      {/* Stats Cards */}
      <StatsGrid cols={3}>
        <StatTile label="Total Visitors" value={stats.total} icon={<UserCheck className="w-4 h-4" />} accent="blue" />
        <StatTile label="Pending" value={stats.pending} icon={<Clock className="w-4 h-4" />} accent="amber" />
        <StatTile label="Checked In" value={stats.checkedIn} icon={<CheckCircle className="w-4 h-4" />} accent="emerald" />
        <StatTile label="Checked Out" value={stats.checkedOut} icon={<XCircle className="w-4 h-4" />} accent="blue" />
        <StatTile label="Today's Visitors" value={stats.todayVisitors} icon={<Clock className="w-4 h-4" />} accent="blue" />
        <StatTile label="Currently Inside" value={stats.activeVisitors} icon={<Shield className="w-4 h-4" />} accent="emerald" />
      </StatsGrid>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Visitor Access</TabsTrigger>
          <TabsTrigger value="qr-codes">QR Codes</TabsTrigger>
          <TabsTrigger value="gate-integration">Gate Integration</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <SectionCard
            title="Visitor Access Management"
            subtitle="Real-time visitor tracking with QR-code based access control"
            padding="none"
          >
            <div className="px-5 pb-4">
              <FilterBar
                search={searchQuery}
                onSearch={handleSearchChange}
                placeholder="Search visitors, codes, properties…"
                actions={searchQuery ? (
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {filteredVisitors.length} result{filteredVisitors.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
                  </span>
                ) : undefined}
              />
            </div>
            <SPTable
              data={paginatedVisitors}
              onRowClick={(visitor: any) => setDetailsVisitor(visitor)}
              emptyState={
                <EmptyState
                  icon={<UserCheck />}
                  title={searchQuery ? `No visitors match "${searchQuery}"` : "No visitor access records found"}
                  size="lg"
                />
              }
              columns={[
                {
                  header: "Visitor",
                  cell: (visitor: any) => (
                    <>
                      <div className="font-medium">{visitor.visitor_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{visitor.visitor_code}</div>
                    </>
                  ),
                },
                {
                  header: "Property / Unit",
                  hideOnMobile: true,
                  cell: (visitor: any) => (
                    <>
                      <div className="font-medium">{visitor.property_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {visitor.unit_number ? `Unit ${visitor.unit_number}` : "—"}
                      </div>
                    </>
                  ),
                },
                {
                  header: "Expected",
                  hideOnMobile: true,
                  cell: (visitor: any) => (
                    <span className="text-sm whitespace-nowrap">{new Date(visitor.expected_arrival).toLocaleString()}</span>
                  ),
                },
                {
                  header: "Actual Arrival",
                  hideOnMobile: true,
                  cell: (visitor: any) => visitor.actual_arrival ? (
                    <span className="text-sm whitespace-nowrap text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {new Date(visitor.actual_arrival).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic text-xs">Not yet</span>
                  ),
                },
                {
                  header: "Status",
                  cell: (visitor: any) => <SPBadge status={visitor.status || "pending"} />,
                },
                {
                  header: "",
                  align: "right",
                  cell: (visitor: any) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <ActionMenu items={[
                        { label: "View Details", icon: <UserCheck className="h-4 w-4" />, onClick: () => setDetailsVisitor(visitor) },
                        { label: "View QR Code", icon: <QrCode className="h-4 w-4" />, onClick: () => setQrModalVisitor(visitor) },
                        { label: "Download QR", icon: <Download className="h-4 w-4" />, onClick: () => downloadQR(visitor) },
                        ...(visitor.status === "pending" ? [{
                          label: "Approve", icon: <CheckCircle className="h-4 w-4 text-blue-600" />, separator: true,
                          onClick: () => approveVisitorMutation.mutate(visitor.visitor_code),
                          disabled: approveVisitorMutation.isPending,
                        }] : []),
                        ...(visitor.status === "approved" ? [{
                          label: "Check In", icon: <UserCheck className="h-4 w-4 text-green-600" />, separator: true,
                          onClick: () => {
                            setSelectedVisitor(visitor);
                            setFormCheckInLocation("Main Gate");
                            setIsCheckInDialogOpen(true);
                          },
                        }] : []),
                        ...(visitor.status === "checked_in" ? [{
                          label: "Check Out", icon: <XCircle className="h-4 w-4 text-red-600" />, separator: true,
                          onClick: () => handleCheckOut(visitor.visitor_code),
                          disabled: checkOutVisitorMutation.isPending,
                        }] : []),
                        ...((visitor.status === "approved" || visitor.status === "checked_in") ? [{
                          label: "Revoke Access", icon: <Ban className="h-4 w-4" />, destructive: true,
                          onClick: () => revokeVisitorMutation.mutate(visitor.visitor_code),
                          disabled: revokeVisitorMutation.isPending,
                        }] : []),
                        ...(visitor.status === "pending" ? [{
                          label: "Delete", icon: <Trash2 className="h-4 w-4" />, destructive: true, separator: true,
                          onClick: () => setConfirmDeleteCode(visitor.visitor_code),
                        }] : []),
                      ]} />
                    </div>
                  ),
                },
              ]}
            />
              {filteredVisitors.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page:</span>
                    <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                      <SelectTrigger className="h-8 w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="ml-1">
                      {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredVisitors.length)} of {filteredVisitors.length}
                      {searchQuery ? ` (filtered from ${visitorAccess.length})` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      onClick={() => setCurrentPage(1)}
                      disabled={safePage === 1}
                    >
                      «
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                    >
                      ‹ Prev
                    </Button>
                    {/* Page number pills */}
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                      .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((item, idx) =>
                        item === "…" ? (
                          <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground select-none">…</span>
                        ) : (
                          <Button
                            key={item}
                            variant={item === safePage ? "default" : "outline"}
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setCurrentPage(item as number)}
                          >
                            {item}
                          </Button>
                        )
                      )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                    >
                      Next ›
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={safePage === totalPages}
                    >
                      »
                    </Button>
                  </div>
                </div>
              )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="qr-codes" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {visitorAccess.filter((v) => v.status !== "expired").filter((v) => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return v.visitor_name?.toLowerCase().includes(q) || v.visitor_code?.toLowerCase().includes(q) || v.property_name?.toLowerCase().includes(q);
            }).map((visitor) => (
              <Card key={visitor.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{visitor.visitor_name}</CardTitle>
                  <CardDescription className="font-mono text-xs">{visitor.visitor_code}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="mx-auto w-fit p-2 bg-white border rounded-lg shadow-sm">
                      <VisitorQRCode value={visitor.visitor_code} size={140} />
                    </div>
                    <div className="text-center text-sm text-muted-foreground">
                      {visitor.property_name}{visitor.unit_number ? ` · Unit ${visitor.unit_number}` : ""}
                    </div>
                    <div className="flex items-center justify-between">
                      <SPBadge status={visitor.status || "pending"} />
                      <span className="text-xs text-muted-foreground">
                        {visitor.expected_departure
                          ? `Expires ${new Date(visitor.expected_departure).toLocaleDateString()}`
                          : "No expiry"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setQrModalVisitor(visitor)}>
                        <QrCode className="h-3 w-3 mr-1" /> View
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => downloadQR(visitor)}>
                        <Download className="h-3 w-3 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {visitorAccess.filter((v) => v.status !== "expired").length === 0 && (
              <div className="col-span-3 text-center py-12 text-muted-foreground">
                No active visitor QR codes
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="gate-integration" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Smart Gate Status</CardTitle>
                <CardDescription>Integration status with automated gate systems</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Main Gate Integration", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", status: "Connected" },
                  { label: "Pedestrian Gate", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", status: "Connected" },
                  { label: "Emergency Access", cls: "bg-yellow-100 text-yellow-800", status: "Manual Override" },
                  { label: "Biometric Scanner", cls: "bg-blue-100 text-blue-800", status: "Optional" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-sm">{item.label}</span>
                    <Badge variant="default" className={item.cls}>{item.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Access Method Distribution</CardTitle>
                <CardDescription>How visitors are accessing the property</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {accessMethods.map((method) => {
                    const count = visitorAccess.filter((v) => v.access_method === method.value).length;
                    return (
                      <div key={method.value} className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <method.icon className="h-4 w-4" />
                          <span className="text-sm">{method.label}</span>
                        </div>
                        <span className="font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* QR Code Modal */}
      <Dialog open={!!qrModalVisitor} onOpenChange={(open) => !open && setQrModalVisitor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Visitor QR Code</DialogTitle>
            <DialogDescription>
              {qrModalVisitor?.visitor_name} · {qrModalVisitor?.property_name}
            </DialogDescription>
          </DialogHeader>
          {qrModalVisitor && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="p-4 bg-white border rounded-xl shadow-sm">
                <VisitorQRCode value={qrModalVisitor.visitor_code} size={220} />
              </div>
              <div className="text-center space-y-1">
                <p className="font-mono font-semibold tracking-widest text-lg">{qrModalVisitor.visitor_code}</p>
                {qrModalVisitor.visit_purpose && (
                  <p className="text-sm text-muted-foreground">{qrModalVisitor.visit_purpose}</p>
                )}
                <div className="flex justify-center gap-2 pt-1">
                  <SPBadge status={qrModalVisitor.status || "pending"} />
                  {qrModalVisitor.unit_number && (
                    <Badge variant="outline">Unit {qrModalVisitor.unit_number}</Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full text-xs text-muted-foreground">
                <div className="bg-muted rounded p-2 text-center">
                  <div className="font-medium text-foreground">Arrival</div>
                  <div>{new Date(qrModalVisitor.expected_arrival).toLocaleString()}</div>
                </div>
                <div className="bg-muted rounded p-2 text-center">
                  <div className="font-medium text-foreground">Departure</div>
                  <div>{qrModalVisitor.expected_departure ? new Date(qrModalVisitor.expected_departure).toLocaleString() : "Open"}</div>
                </div>
              </div>
              <Button className="w-full" onClick={() => downloadQR(qrModalVisitor)}>
                <Download className="h-4 w-4 mr-2" /> Download QR Code
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Check-in Dialog */}
      <Dialog open={isCheckInDialogOpen} onOpenChange={setIsCheckInDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check In Visitor</DialogTitle>
            <DialogDescription>
              Check in {selectedVisitor?.visitor_name} at {selectedVisitor?.property_name}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCheckIn} className="space-y-4">
            <div className="space-y-2">
              <Label>Check-in Location</Label>
              <Select value={formCheckInLocation} onValueChange={setFormCheckInLocation}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Main Gate">Main Gate</SelectItem>
                  <SelectItem value="Reception">Reception</SelectItem>
                  <SelectItem value="Security Desk">Security Desk</SelectItem>
                  <SelectItem value="Parking">Parking Area</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={checkInVisitorMutation.isPending} className="w-full">
              {checkInVisitorMutation.isPending ? "Checking In..." : "Check In Visitor"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!confirmDeleteCode} onOpenChange={(open) => !open && setConfirmDeleteCode(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Delete Visitor Record
            </DialogTitle>
            <DialogDescription>
              This will permanently delete this pending visitor record. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmDeleteCode(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteVisitorMutation.isPending}
              onClick={() => {
                if (confirmDeleteCode) {
                  deleteVisitorMutation.mutate(confirmDeleteCode, {
                    onSettled: () => setConfirmDeleteCode(null),
                  });
                }
              }}
            >
              {deleteVisitorMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Visitor Details Modal */}
      <Dialog open={!!detailsVisitor} onOpenChange={(open) => !open && setDetailsVisitor(null)}>
        <DialogContent className="max-w-2xl">
          {detailsVisitor && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <DialogTitle className="text-xl">{detailsVisitor.visitor_name}</DialogTitle>
                    <DialogDescription className="font-mono text-xs mt-0.5">{detailsVisitor.visitor_code}</DialogDescription>
                  </div>
                  <SPBadge status={detailsVisitor.status || "pending"} className="mt-1 shrink-0" />
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-1">
                {/* Visitor info */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Visitor</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="text-muted-foreground">Phone</div>
                    <div>{detailsVisitor.visitor_phone || "—"}</div>
                    <div className="text-muted-foreground">ID / Passport</div>
                    <div>{detailsVisitor.visitor_id_number || "—"}</div>
                    <div className="text-muted-foreground">Purpose</div>
                    <div>{detailsVisitor.visit_purpose || "General visit"}</div>
                  </div>
                </div>

                <div className="border-t" />

                {/* Host & Property */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Host & Location</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="text-muted-foreground">Host</div>
                    <div>
                      {detailsVisitor.first_name || detailsVisitor.last_name
                        ? `${detailsVisitor.first_name ?? ""} ${detailsVisitor.last_name ?? ""}`.trim()
                        : "—"}
                    </div>
                    <div className="text-muted-foreground">Property</div>
                    <div>{detailsVisitor.property_name || "—"}</div>
                    <div className="text-muted-foreground">Unit</div>
                    <div>{detailsVisitor.unit_number ? `Unit ${detailsVisitor.unit_number}` : "—"}</div>
                    <div className="text-muted-foreground">Access Method</div>
                    <div className="capitalize">{detailsVisitor.access_method?.replace(/_/g, " ") || "—"}</div>
                  </div>
                </div>

                <div className="border-t" />

                {/* Schedule */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Schedule</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="text-muted-foreground">Expected arrival</div>
                    <div>{new Date(detailsVisitor.expected_arrival).toLocaleString()}</div>
                    <div className="text-muted-foreground">Expected departure</div>
                    <div>{detailsVisitor.expected_departure ? new Date(detailsVisitor.expected_departure).toLocaleString() : "Open"}</div>
                  </div>
                </div>

                <div className="border-t" />

                {/* Actual times */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Actual Check-in / Out</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="text-muted-foreground">Checked in</div>
                    <div className={detailsVisitor.actual_arrival ? "text-green-700 font-medium" : "text-muted-foreground italic"}>
                      {detailsVisitor.actual_arrival ? new Date(detailsVisitor.actual_arrival).toLocaleString() : "Not yet"}
                    </div>
                    <div className="text-muted-foreground">Check-in location</div>
                    <div>{detailsVisitor.check_in_location || "—"}</div>
                    <div className="text-muted-foreground">Checked out</div>
                    <div className={detailsVisitor.actual_departure ? "text-red-600 font-medium" : "text-muted-foreground italic"}>
                      {detailsVisitor.actual_departure
                        ? new Date(detailsVisitor.actual_departure).toLocaleString()
                        : detailsVisitor.actual_arrival ? "Still inside" : "Not yet"}
                    </div>
                    <div className="text-muted-foreground">Check-out location</div>
                    <div>{detailsVisitor.check_out_location || "—"}</div>
                  </div>
                </div>

                {detailsVisitor.security_notes && (
                  <>
                    <div className="border-t" />
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Security Notes</p>
                      <p className="text-sm">{detailsVisitor.security_notes}</p>
                    </div>
                  </>
                )}

                {/* Action buttons */}
                <div className="border-t pt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setQrModalVisitor(detailsVisitor); setDetailsVisitor(null); }}>
                    <QrCode className="h-4 w-4 mr-1.5" /> View QR
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadQR(detailsVisitor)}>
                    <Download className="h-4 w-4 mr-1.5" /> Download QR
                  </Button>
                  {detailsVisitor.status === "pending" && (
                    <Button size="sm" onClick={() => { approveVisitorMutation.mutate(detailsVisitor.visitor_code); setDetailsVisitor(null); }}>
                      <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                    </Button>
                  )}
                  {detailsVisitor.status === "approved" && (
                    <Button size="sm" onClick={() => { setSelectedVisitor(detailsVisitor); setFormCheckInLocation("Main Gate"); setDetailsVisitor(null); setIsCheckInDialogOpen(true); }}>
                      <UserCheck className="h-4 w-4 mr-1.5" /> Check In
                    </Button>
                  )}
                  {detailsVisitor.status === "checked_in" && (
                    <Button size="sm" variant="outline" onClick={() => { handleCheckOut(detailsVisitor.visitor_code); setDetailsVisitor(null); }}>
                      <XCircle className="h-4 w-4 mr-1.5" /> Check Out
                    </Button>
                  )}
                  {(detailsVisitor.status === "approved" || detailsVisitor.status === "checked_in") && (
                    <Button size="sm" variant="outline" className="text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => { revokeVisitorMutation.mutate(detailsVisitor.visitor_code); setDetailsVisitor(null); }}>
                      <Ban className="h-4 w-4 mr-1.5" /> Revoke
                    </Button>
                  )}
                  {detailsVisitor.status === "pending" && (
                    <Button size="sm" variant="destructive" onClick={() => { setConfirmDeleteCode(detailsVisitor.visitor_code); setDetailsVisitor(null); }}>
                      <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}