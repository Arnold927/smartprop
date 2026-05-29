import { useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User, Mail, Phone, MapPin, Calendar, BedDouble,
  Bath, Square, DollarSign, FileText, Grid, CheckCircle2, Clock, ExternalLink,
} from "lucide-react";
import { getPropertyGradient } from "@/lib/propertyGradient";
import { Tenant } from "@/types/tenant";
import { Unit } from "@/types/unit";

interface ViewTenantDialogProps {
  tenant: Tenant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitsData?: Unit[];
  property?: any;
  onEditTenant?: (tenant: Tenant) => void;
  onViewUnit?: (unit: Unit) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  active:   { bg: "bg-green-50 dark:bg-green-950",  text: "text-green-700 dark:text-green-400",  dot: "bg-green-500" },
  inactive: { bg: "bg-gray-100 dark:bg-gray-800",   text: "text-gray-600 ",    dot: "bg-gray-400" },
  pending:  { bg: "bg-amber-50 dark:bg-amber-950",  text: "text-amber-700 dark:text-amber-400",  dot: "bg-amber-500" },
};

function fmt(amount: number | string | undefined | null) {
  return `Ksh ${Number(amount ?? 0).toLocaleString()}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      {icon && <span className="mt-0.5 text-muted-foreground flex-shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-xl p-3 ${accent}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">{label}</p>
      <p className="text-base font-bold text-foreground leading-tight">{value}</p>
    </div>
  );
}

export function ViewTenantDialog({
  tenant,
  open,
  onOpenChange,
  unitsData,
  property,
  onEditTenant,
  onViewUnit,
}: ViewTenantDialogProps) {
  const [activeTab, setActiveTab] = useState("profile");

  const [, navigate] = useLocation();

  if (!tenant) return null;

  const unitDetails = unitsData?.find(u => u.id === tenant.unitId);
  const status = tenant.status ?? "active";
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.active;

  // Lease duration in months
  let leaseDurationMonths: number | null = null;
  if (tenant.leaseStartDate && tenant.leaseEndDate) {
    const start = new Date(tenant.leaseStartDate);
    const end   = new Date(tenant.leaseEndDate);
    leaseDurationMonths = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  }
  const totalLeaseValue = leaseDurationMonths != null
    ? Number(tenant.monthlyRent ?? 0) * leaseDurationMonths
    : null;

  // Days until lease ends
  let daysUntilEnd: number | null = null;
  if (tenant.leaseEndDate) {
    daysUntilEnd = Math.ceil((new Date(tenant.leaseEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  const initials = `${tenant.firstName?.[0] ?? ""}${tenant.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] bg-card dark:bg-gray-900 border border-border dark:border-gray-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden p-0 rounded-2xl">

        {/* Hero header */}
        <div className={`relative bg-gradient-to-br ${getPropertyGradient(property?.name ?? "")} px-6 pt-6 pb-5 flex-shrink-0`}>
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0 border border-white/30">
              <span className="text-2xl font-black text-white">{initials || <User className="h-7 w-7" />}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white truncate">{tenant.firstName} {tenant.lastName}</h2>
              <p className="text-sm text-purple-200 mt-0.5">
                {unitDetails ? `Unit ${unitDetails.unitNumber}` : "No unit assigned"}
                {property?.name ? ` · ${property.name}` : ""}
              </p>
              <div className="mt-2">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 text-white border border-white/25`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-3 bg-muted/40 dark:bg-gray-800/60 border-b border-border rounded-none h-11">
            <TabsTrigger value="profile" className="text-xs font-medium rounded-none data-[state=active]:border-b-2 data-[state=active]:border-violet-600" >
              <User className="h-3.5 w-3.5 mr-1.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="lease" className="text-xs font-medium rounded-none data-[state=active]:border-b-2 data-[state=active]:border-violet-600" >
              <FileText className="h-3.5 w-3.5 mr-1.5" /> Lease
            </TabsTrigger>
            <TabsTrigger value="unit" className="text-xs font-medium rounded-none data-[state=active]:border-b-2 data-[state=active]:border-violet-600" >
              <Grid className="h-3.5 w-3.5 mr-1.5" /> Unit
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">

            {/* ── Profile tab ── */}
            <TabsContent value="profile" className="m-0 p-5 space-y-4">
              <Card className="rounded-xl shadow-none border-border dark:border-gray-800" >
                <CardContent className="p-4 divide-y divide-border/60">
                  <InfoRow label="Full Name"  value={`${tenant.firstName} ${tenant.lastName}`}  icon={<User className="h-4 w-4" />} />
                  <InfoRow label="Email"       value={tenant.email}                               icon={<Mail className="h-4 w-4" />} />
                  <InfoRow label="Phone"       value={tenant.phone}                               icon={<Phone className="h-4 w-4" />} />
                  {(tenant as any).nationalId && (
                    <InfoRow label="National ID" value={(tenant as any).nationalId} icon={<FileText className="h-4 w-4" />} />
                  )}
                  {(tenant as any).address && (
                    <InfoRow label="Address" value={(tenant as any).address} icon={<MapPin className="h-4 w-4" />} />
                  )}
                </CardContent>
              </Card>

              {/* Rent stat */}
              <div className="grid grid-cols-2 gap-3">
                <StatPill label="Monthly Rent"   value={fmt(tenant.monthlyRent)}    accent="bg-blue-50 dark:bg-blue-950/40" />
                <StatPill label="Security Deposit" value={fmt((tenant as any).securityDeposit)} accent="bg-purple-50 dark:bg-purple-950/40" />
              </div>
            </TabsContent>

            {/* ── Lease tab ── */}
            <TabsContent value="lease" className="m-0 p-5 space-y-4">
              <Card className="rounded-xl shadow-none border-border dark:border-gray-800" >
                <CardContent className="p-4 divide-y divide-border/60">
                  <InfoRow label="Lease Start" value={fmtDate(tenant.leaseStartDate)} icon={<Calendar className="h-4 w-4" />} />
                  <InfoRow label="Lease End"   value={fmtDate(tenant.leaseEndDate)}   icon={<Calendar className="h-4 w-4" />} />
                  <InfoRow label="Duration"
                    value={leaseDurationMonths != null ? `${leaseDurationMonths} month${leaseDurationMonths !== 1 ? "s" : ""}` : "—"}
                    icon={<Clock className="h-4 w-4" />}
                  />
                  <InfoRow label="Monthly Rent" value={fmt(tenant.monthlyRent)} icon={<DollarSign className="h-4 w-4" />} />
                  {totalLeaseValue != null && (
                    <InfoRow label="Total Lease Value" value={fmt(totalLeaseValue)} icon={<DollarSign className="h-4 w-4" />} />
                  )}
                  {(tenant as any).securityDeposit != null && (
                    <InfoRow label="Security Deposit" value={fmt((tenant as any).securityDeposit)} icon={<DollarSign className="h-4 w-4" />} />
                  )}
                </CardContent>
              </Card>

              {/* Lease countdown pill */}
              {daysUntilEnd != null && (
                <div className={`rounded-xl p-4 flex items-center gap-3 ${daysUntilEnd <= 30 ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800" : daysUntilEnd <= 90 ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800" : "bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800"}`}>
                  <CheckCircle2 className={`h-5 w-5 flex-shrink-0 ${daysUntilEnd <= 30 ? "text-red-500" : daysUntilEnd <= 90 ? "text-amber-500" : "text-green-500"}`} />
                  <div>
                    <p className={`text-sm font-semibold ${daysUntilEnd <= 30 ? "text-red-700 dark:text-red-400" : daysUntilEnd <= 90 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
                      {daysUntilEnd > 0 ? `${daysUntilEnd} days until lease ends` : "Lease has ended"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(tenant.leaseEndDate)}</p>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Unit tab ── */}
            <TabsContent value="unit" className="m-0 p-5">
              {unitDetails ? (
                <div className="space-y-4">
                  {/* Unit image / placeholder */}
                  <div className="aspect-video rounded-xl overflow-hidden bg-muted">
                    {unitDetails.unitImages?.[0] ? (
                      <img src={unitDetails.unitImages[0]} alt={`Unit ${unitDetails.unitNumber}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${getPropertyGradient(property?.name ?? "")} flex items-center justify-center`}>
                        <span className="text-5xl font-black text-white/80">{unitDetails.unitNumber}</span>
                      </div>
                    )}
                  </div>

                  <Card className="rounded-xl shadow-none border-border dark:border-gray-800" >
                    <CardContent className="p-4 divide-y divide-border/60">
                      <InfoRow label="Unit Number"   value={`Unit ${unitDetails.unitNumber}`}                                 icon={<Grid className="h-4 w-4" />} />
                      <InfoRow label="Bedrooms"      value={`${unitDetails.bedrooms ?? "—"} Bedroom${unitDetails.bedrooms !== 1 ? "s" : ""}`} icon={<BedDouble className="h-4 w-4" />} />
                      <InfoRow label="Bathrooms"     value={`${unitDetails.bathrooms ?? "—"} Bathroom${unitDetails.bathrooms !== 1 ? "s" : ""}`} icon={<Bath className="h-4 w-4" />} />
                      {unitDetails.sqft && (
                        <InfoRow label="Size"        value={`${Number(unitDetails.sqft).toLocaleString()} sqft`}              icon={<Square className="h-4 w-4" />} />
                      )}
                      <InfoRow label="Monthly Rent"  value={fmt(unitDetails.monthlyRent)}                                     icon={<DollarSign className="h-4 w-4" />} />
                      <InfoRow label="Status"
                        value={
                          <span className={`inline-flex items-center gap-1.5 ${unitDetails.isOccupied ? "text-green-700 dark:text-green-400" : "text-slate-500"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${unitDetails.isOccupied ? "bg-green-500" : "bg-slate-400"}`} />
                            {unitDetails.isOccupied ? "Occupied" : "Vacant"}
                          </span>
                        }
                      />
                    </CardContent>
                  </Card>

                  {onViewUnit && (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => onViewUnit(unitDetails)}>
                      Open Unit Details
                    </Button>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground text-sm">No unit assigned to this tenant.</div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20 flex-shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          {onEditTenant && (
            <Button variant="outline" size="sm" onClick={() => onEditTenant(tenant)}>Edit Tenant</Button>
          )}
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => { onOpenChange(false); navigate(`/tenants/${tenant.id}`); }}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            View Full Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}