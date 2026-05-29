import * as React from "react";
import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import {
  Plus,
  Home,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  DollarSign,
  Users,
  TrendingUp,
  ShieldCheck,
  Award,
  Building2,
  Key,
  CreditCard,
  Receipt,
  BarChart3,
  MapPin,
  AlertTriangle,
  ArrowUpRight,
  Percent,
  HandshakeIcon,
  ClipboardList,
  Banknote,
  UserCheck,
  CalendarClock,
  FileCheck,
  Scale,
  Eye,
  Download,
  RefreshCcw,
  ChevronRight,
  Info,
  ChevronsUpDown,
  Check,
  MoreVertical,
  Search,
} from "lucide-react";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import { cn } from "@/lib/utils";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { openPrintWindow, spHeader, spFooter, fmtDocDate, fmtDocKES } from "@/lib/document-theme";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RentToOwnAgreement {
  id: number;
  agreementNumber: string;
  propertyId: number;
  tenantId: number;
  status: "active" | "completed" | "defaulted" | "cancelled" | "pending";
  totalPropertyValue: string;
  purchasePrice: string;          // agreed purchase price (may differ from market value)
  optionFee: string;              // upfront option consideration fee
  optionFeeApplied: boolean;      // whether option fee credits toward purchase
  monthlyRent: string;
  rentCreditAmount: string;       // portion of rent that credits toward purchase
  rentCreditRate: string;         // e.g. "25.00" = 25% of rent goes to credit
  totalPaid: string;
  totalRentCredits: string;       // cumulative rent credits earned
  remainingBalance: string;
  optionExpiryDate: string;       // deadline to exercise the purchase option
  startDate: string;
  agreementDurationMonths: number;
  paymentsMade: number;
  paymentsTotal: number;
  currency: string;
  tenantName?: string;
  propertyAddress?: string;
  legalClause?: string;           // e.g. "right of first refusal" vs "lease-option"
  agreementType: "lease_option" | "lease_purchase" | "installment_sale";
  propertyConditionReport?: boolean;
  isNotarized?: boolean;
  escrowAccount?: string;
  interestRate?: string;
  nextPaymentDue?: string;
  terms?: string;
}

interface RentToOwnPayment {
  id: number;
  paymentNumber: string;
  agreementId: number;
  scheduledAmount: string;
  rentPortion: string;
  creditPortion: string;         // the credit portion of each payment
  paidAmount?: string;
  dueDate: string;
  paidDate?: string;
  status: "paid" | "pending" | "overdue" | "partial" | "waived";
  paymentMethod?: string;
  transactionId?: string;
  lateFee?: string;
  notes?: string;
}

interface OwnershipCertificate {
  id: number;
  certificateNumber: string;
  propertyId: number;
  tenantId: number;
  agreementId: number;
  ownershipPercentage: string;
  acquisitionDate: string;
  acquisitionType: string;
  ownershipType: string;
  status: "active" | "pending" | "revoked";
  isVerified: boolean;
  transferDate?: string;
  titleDeedNumber?: string;
  landRegistryRef?: string;
}

interface ManagementAgreement {
  id: number;
  agreementNumber: string;
  propertyId: number;
  ownerId: number;
  managementType: "full_service" | "tenant_placement" | "rent_collection" | "maintenance_only";
  managementFeeType: "percentage" | "flat_rate";
  managementFeeRate: string;
  managementFlatFee?: string;
  startDate: string;
  endDate?: string;
  status: "active" | "pending" | "terminated" | "suspended";
  ownerName?: string;
  propertyAddress?: string;
  maintenanceThreshold?: string; // repairs below this need no owner approval
  noticePeriodDays?: number;
  renewalTerms?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  active:      { label: "Active",      variant: "default",     color: "text-emerald-600" },
  completed:   { label: "Completed",   variant: "default",     color: "text-blue-600" },
  pending:     { label: "Pending",     variant: "secondary",   color: "text-amber-600" },
  overdue:     { label: "Overdue",     variant: "destructive", color: "text-red-600" },
  defaulted:   { label: "Defaulted",   variant: "destructive", color: "text-red-700" },
  cancelled:   { label: "Cancelled",   variant: "outline",     color: "text-gray-500" },
  terminated:  { label: "Terminated",  variant: "outline",     color: "text-gray-500" },
  suspended:   { label: "Suspended",   variant: "destructive", color: "text-orange-600" },
  paid:        { label: "Paid",        variant: "default",     color: "text-emerald-600" },
  partial:     { label: "Partial",     variant: "secondary",   color: "text-amber-600" },
  waived:      { label: "Waived",      variant: "outline",     color: "text-gray-500" },
  confirmed:   { label: "Confirmed",   variant: "default",     color: "text-blue-600" },
  checked_in:  { label: "Checked In",  variant: "default",     color: "text-emerald-600" },
  checked_out: { label: "Checked Out", variant: "secondary",   color: "text-gray-600" },
  no_show:     { label: "No Show",     variant: "destructive", color: "text-red-600" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, variant: "outline", color: "" };
  return <Badge variant={cfg.variant as any} className="capitalize">{cfg.label}</Badge>;
}

function Fmt({ amount, currency: _currency = "KES" }: { amount: string | number; currency?: string }) {
  const num = parseFloat(amount?.toString() ?? "0") || 0;
  return <span>Ksh {num.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>;
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

function AgreementTypeLabel({ type }: { type: string }) {
  const labels: Record<string, { label: string; tip: string }> = {
    lease_option:      { label: "Lease-Option",      tip: "Tenant has the right but not the obligation to buy" },
    lease_purchase:    { label: "Lease-Purchase",    tip: "Tenant is contractually obligated to purchase" },
    installment_sale:  { label: "Installment Sale",  tip: "Title transfers via installment payments" },
  };
  const info = labels[type] ?? { label: type, tip: "" };
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      {info.label}
      {info.tip && <span title={info.tip}><Info className="h-3 w-3 text-muted-foreground" /></span>}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, icon: Icon, alert }: {
  title: string; value: React.ReactNode; sub?: string; icon: any; alert?: boolean;
}) {
  return (
    <Card className={`${alert ? "border-destructive/50" : ""} overflow-hidden`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4">
        <CardTitle className="text-xs font-medium leading-tight pr-2 line-clamp-2">{title}</CardTitle>
        <Icon className={`h-4 w-4 shrink-0 ${alert ? "text-destructive" : "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-lg font-bold truncate min-w-0">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Searchable Select ────────────────────────────────────────────────────────

interface SearchableOption { value: string; label: string; sub?: string; }

function SearchableSelect({ options, value, onChange, placeholder, emptyText = "No results found.", disabled = false }: {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  const filtered = search.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        (o.sub && o.sub.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative w-full">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setSearch(""); }}
        className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-2 border-b">
            <input
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-center text-muted-foreground">{emptyText}</p>
            ) : filtered.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  value === opt.value && "bg-accent/50"
                )}
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(""); }}
              >
                <Check className={cn("h-4 w-4 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
                <div>
                  <p>{opt.label}</p>
                  {opt.sub && <p className="text-xs text-muted-foreground">{opt.sub}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agreement Detail Panel ───────────────────────────────────────────────────

function AgreementDetailPanel({ agreement, onClose }: { agreement: RentToOwnAgreement; onClose: () => void }) {
  const paid = parseFloat(agreement.totalPaid || "0");
  const total = parseFloat(agreement.purchasePrice || agreement.totalPropertyValue || "1");
  const progress = Math.min((paid / total) * 100, 100);

  const field = (label: string, value: React.ReactNode) => (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || <span className="text-muted-foreground italic">—</span>}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" />
      {/* Panel */}
      <div
        className="w-full max-w-md bg-background border-l shadow-xl flex flex-col overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b sticky top-0 bg-background z-10">
          <div>
            <p className="font-mono text-xs text-muted-foreground">{agreement.agreementNumber}</p>
            <h2 className="text-lg font-bold mt-0.5">{agreement.propertyAddress || `Property #${agreement.propertyId}`}</h2>
            <p className="text-sm text-muted-foreground">{agreement.tenantName || `Tenant #${agreement.tenantId}`}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 mt-1" onClick={onClose}>✕</Button>
        </div>

        <div className="p-5 space-y-6 flex-1">
          {/* Status + Type */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={agreement.status} />
            <AgreementTypeLabel type={agreement.agreementType || "lease_option"} />
            {agreement.isNotarized && <Badge variant="outline" className="text-xs gap-1"><Scale className="h-3 w-3" /> Notarized</Badge>}
            {agreement.escrowAccount && <Badge variant="outline" className="text-xs gap-1"><ShieldCheck className="h-3 w-3" /> Escrow</Badge>}
            {agreement.propertyConditionReport && <Badge variant="outline" className="text-xs gap-1"><FileCheck className="h-3 w-3" /> Condition Report</Badge>}
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Payment Progress</span>
              <span className="text-muted-foreground">{progress.toFixed(1)}%</span>
            </div>
            <ProgressBar value={progress} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Paid: <span className="font-medium text-foreground"><Fmt amount={agreement.totalPaid || "0"} /></span></span>
              <span>Remaining: <span className="font-medium text-foreground"><Fmt amount={agreement.remainingBalance || "0"} /></span></span>
            </div>
          </div>

          {/* Financial Details */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Financial Terms</p>
            <div className="grid grid-cols-2 gap-4">
              {field("Purchase Price", <Fmt amount={agreement.purchasePrice || agreement.totalPropertyValue} />)}
              {field("Monthly Rent", <Fmt amount={agreement.monthlyRent || "0"} />)}
              {field("Rent Credit Rate", agreement.rentCreditRate ? `${agreement.rentCreditRate}%` : null)}
              {field("Rent Credit / Month", <Fmt amount={agreement.rentCreditAmount || "0"} />)}
              {field("Total Rent Credits", <Fmt amount={agreement.totalRentCredits || "0"} />)}
              {field("Initial Deposit / Option Fee", <Fmt amount={agreement.optionFee || "0"} />)}
              {field("Option Fee Applied to Price", agreement.optionFeeApplied ? "Yes" : "No")}
              {field("Interest Rate", agreement.interestRate ? `${agreement.interestRate}% p.a.` : null)}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Schedule</p>
            <div className="grid grid-cols-2 gap-4">
              {field("Start Date", agreement.startDate ? new Date(agreement.startDate).toLocaleDateString() : null)}
              {field("Duration", agreement.agreementDurationMonths ? `${agreement.agreementDurationMonths} months` : null)}
              {field("Next Payment Due", agreement.nextPaymentDue ? new Date(agreement.nextPaymentDue).toLocaleDateString() : null)}
              {field("Payments Made", `${agreement.paymentsMade ?? 0} / ${agreement.paymentsTotal ?? agreement.agreementDurationMonths ?? "?"}`)}
            </div>
          </div>

          {/* Legal */}
          {(agreement.legalClause || agreement.terms) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Legal</p>
              <div className="space-y-3">
                {field("Legal Clause", agreement.legalClause)}
                {agreement.terms && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Terms & Conditions</p>
                    <p className="text-sm bg-muted rounded p-3 whitespace-pre-wrap">{agreement.terms}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Certificate Modal ─────────────────────────────────────────────────────────

function CertificateModal({ cert, agreements, properties, tenants, units, onClose }: {
  cert: OwnershipCertificate;
  agreements: any[];
  properties: any[];
  tenants: any[];
  units: any[];
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const ownerId = (cert as any).ownerId ?? (cert as any).tenantId;
  const property = properties.find(p => p.id === cert.propertyId);
  const tenant = tenants.find(t => t.id === ownerId);
  const agreement = agreements.find(a => a.propertyId === cert.propertyId && a.tenantId === ownerId);
  const unit = tenant?.unitId ? units.find(u => u.id === tenant.unitId) : null;

  const issueDate = cert.acquisitionDate
    ? new Date(cert.acquisitionDate).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" });

  const propertyLabel = property ? (property.name || property.address || `Property #${cert.propertyId}`) : `Property #${cert.propertyId}`;
  const unitLabel = unit ? `Unit ${unit.unitNumber}` : null;
  const subjectLine = unitLabel ? `${unitLabel}, ${propertyLabel}` : propertyLabel;
  const ownerName = tenant
    ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() || tenant.name || `Owner #${ownerId}`
    : `Owner #${ownerId}`;

  const handleDownload = () => {
    const body = `
      ${spHeader("Ownership Certificate", cert.certificateNumber, cert.acquisitionDate ?? new Date().toISOString())}
      <div class="sp-section">
        <div class="sp-section-title">Certificate Details</div>
        <div class="sp-row"><span class="sp-label">Certificate No.</span><span class="sp-value">${cert.certificateNumber}</span></div>
        <div class="sp-row"><span class="sp-label">Acquisition Date</span><span class="sp-value">${fmtDocDate(cert.acquisitionDate)}</span></div>
        <div class="sp-row"><span class="sp-label">Ownership</span><span class="sp-value">${cert.ownershipPercentage ? cert.ownershipPercentage + "%" : "100%"}</span></div>
        <div class="sp-row"><span class="sp-label">Acquisition Type</span><span class="sp-value">${cert.acquisitionType ?? "—"}</span></div>
        <div class="sp-row"><span class="sp-label">Ownership Type</span><span class="sp-value">${cert.ownershipType ?? "—"}</span></div>
        ${cert.titleDeedNumber ? `<div class="sp-row"><span class="sp-label">Title Deed</span><span class="sp-value">${cert.titleDeedNumber}</span></div>` : ""}
        ${cert.landRegistryRef ? `<div class="sp-row"><span class="sp-label">Land Registry Ref</span><span class="sp-value">${cert.landRegistryRef}</span></div>` : ""}
      </div>
      <div class="sp-amount-box">
        <div class="sp-amount" style="font-size:28px">${cert.certificateNumber}</div>
        <div class="sp-amount-label">Rent-to-Own Ownership Certificate</div>
        <div class="sp-stamp">OWNERSHIP CONFIRMED</div>
      </div>
      <div class="sp-section" style="margin-top:40px">
        <div class="sp-section-title">Verification</div>
        <p style="font-size:12px;color:#374151;line-height:1.7">
          This certificate confirms ownership upon completion of the rent-to-own contract.
          Verify authenticity at smartprop.co.ke using the certificate number above.
        </p>
      </div>
      ${spFooter("This certificate is computer-generated and verifiable via smartprop.co.ke")}
    `;
    openPrintWindow(body, `Certificate-${cert.certificateNumber}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl flex flex-col" style={{ maxHeight: "95vh" }} onClick={e => e.stopPropagation()}>
        {/* Controls */}
        <div className="flex justify-end gap-2 mb-3">
          <Button size="sm" variant="secondary" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" /> Download PDF
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>✕ Close</Button>
        </div>

        {/* Certificate — scrollable wrapper so it never clips on small screens */}
        <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1, borderRadius: "12px" }}>
        <div id="cert-printable" ref={printRef} style={{
          background: "linear-gradient(135deg, #0f1b2d 0%, #162236 50%, #0f1b2d 100%)",
          borderRadius: "12px",
          padding: "0",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(212,175,55,0.3)",
          fontFamily: "'Georgia', serif",
          position: "relative",
        }}>
          {/* Gold border frame */}
          <div style={{
            position: "absolute", inset: "8px",
            border: "2px solid rgba(212,175,55,0.5)",
            borderRadius: "8px",
            pointerEvents: "none",
            zIndex: 1,
          }} />
          <div style={{
            position: "absolute", inset: "12px",
            border: "1px solid rgba(212,175,55,0.2)",
            borderRadius: "6px",
            pointerEvents: "none",
            zIndex: 1,
          }} />

          {/* Corner ornaments */}
          {["top-4 left-4", "top-4 right-4", "bottom-4 left-4", "bottom-4 right-4"].map((pos, i) => (
            <div key={i} style={{
              position: "absolute",
              ...(pos.includes("top") ? { top: "16px" } : { bottom: "16px" }),
              ...(pos.includes("left") ? { left: "16px" } : { right: "16px" }),
              width: "24px", height: "24px",
              borderTop: pos.includes("top") ? "3px solid #D4AF37" : "none",
              borderBottom: pos.includes("bottom") ? "3px solid #D4AF37" : "none",
              borderLeft: pos.includes("left") ? "3px solid #D4AF37" : "none",
              borderRight: pos.includes("right") ? "3px solid #D4AF37" : "none",
              zIndex: 2,
            }} />
          ))}

          {/* Background watermark pattern */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `radial-gradient(circle at 20% 50%, rgba(212,175,55,0.04) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(212,175,55,0.04) 0%, transparent 50%)`,
            pointerEvents: "none",
          }} />

          <div style={{ padding: "40px 56px", position: "relative", zIndex: 2 }}>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginBottom: "12px" }}>
                <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, #D4AF37)" }} />
                <div style={{
                  width: "52px", height: "52px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #D4AF37, #F5D768, #D4AF37)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 20px rgba(212,175,55,0.4)",
                  fontSize: "24px",
                }}>🏛️</div>
                <div style={{ height: "1px", flex: 1, background: "linear-gradient(to left, transparent, #D4AF37)" }} />
              </div>
              <p style={{ color: "#D4AF37", fontSize: "11px", letterSpacing: "6px", textTransform: "uppercase", marginBottom: "6px", fontFamily: "Georgia, serif" }}>
                SmartProp Registry
              </p>
              <h1 style={{ color: "#F5F0E8", fontSize: "28px", fontWeight: "700", letterSpacing: "2px", margin: "0 0 4px", fontFamily: "Georgia, serif" }}>
                Certificate of Ownership
              </h1>
              <p style={{ color: "rgba(212,175,55,0.7)", fontSize: "11px", letterSpacing: "4px", textTransform: "uppercase" }}>
                Official Property Title Document
              </p>
            </div>

            {/* Certificate number badge */}
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <span style={{
                display: "inline-block",
                background: "rgba(212,175,55,0.1)",
                border: "1px solid rgba(212,175,55,0.4)",
                borderRadius: "4px",
                padding: "4px 20px",
                color: "#D4AF37",
                fontSize: "12px",
                letterSpacing: "3px",
                fontFamily: "monospace",
              }}>
                {cert.certificateNumber}
              </span>
            </div>

            {/* Body text */}
            <div style={{ textAlign: "center", marginBottom: "28px" }}>
              <p style={{ color: "rgba(245,240,232,0.7)", fontSize: "13px", lineHeight: 1.7, fontStyle: "italic" }}>
                This is to certify that
              </p>
              <p style={{ color: "#F5F0E8", fontSize: "22px", fontWeight: "600", margin: "6px 0", letterSpacing: "1px" }}>
                {ownerName}
              </p>
              <p style={{ color: "rgba(245,240,232,0.7)", fontSize: "13px", lineHeight: 1.7, fontStyle: "italic" }}>
                has acquired ownership of
              </p>
              <p style={{ color: "#D4AF37", fontSize: "18px", fontWeight: "600", margin: "6px 0" }}>
                {subjectLine}
              </p>
              {property?.address && (
                <p style={{ color: "rgba(245,240,232,0.5)", fontSize: "12px" }}>{property.address}</p>
              )}
            </div>

            {/* Details grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: "1px", background: "rgba(212,175,55,0.2)",
              border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: "6px", overflow: "hidden",
              marginBottom: "24px",
            }}>
              {[
                { label: "Ownership Type", value: cert.ownershipType?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "Full" },
                { label: "Ownership Share", value: `${cert.ownershipPercentage ?? "100"}%` },
                { label: "Acquisition", value: cert.acquisitionType?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "Rent to Own" },
                { label: "Issue Date", value: issueDate },
                { label: "Status", value: cert.isVerified ? "Verified ✓" : cert.status ?? "Active" },
                { label: "Agreement Ref", value: agreement ? `#${agreement.agreementNumber}` : cert.certificateNumber.split("-").pop() ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: "14px 18px", background: "rgba(15,27,45,0.8)", textAlign: "center" }}>
                  <p style={{ color: "rgba(212,175,55,0.6)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "4px" }}>{label}</p>
                  <p style={{ color: "#F5F0E8", fontSize: "13px", fontWeight: "600" }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Seal + Signatures */}
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              {/* Left sig */}
              <div style={{ textAlign: "center", minWidth: "140px" }}>
                <div style={{ height: "1px", background: "rgba(212,175,55,0.4)", marginBottom: "6px" }} />
                <p style={{ color: "#F5F0E8", fontSize: "12px", fontWeight: "600" }}>Property Registrar</p>
                <p style={{ color: "rgba(212,175,55,0.6)", fontSize: "10px", letterSpacing: "1px" }}>SmartProp Registry</p>
              </div>

              {/* Center seal */}
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "80px", height: "80px", borderRadius: "50%", margin: "0 auto",
                  background: "linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))",
                  border: "2px solid rgba(212,175,55,0.5)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 24px rgba(212,175,55,0.2), inset 0 0 24px rgba(212,175,55,0.05)",
                }}>
                  <div style={{ fontSize: "24px" }}>⚖️</div>
                  <p style={{ color: "#D4AF37", fontSize: "7px", letterSpacing: "1px", textTransform: "uppercase", marginTop: "2px" }}>Official Seal</p>
                </div>
                {cert.isVerified && (
                  <div style={{ marginTop: "6px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} />
                    <p style={{ color: "#22c55e", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase" }}>Verified & Registered</p>
                  </div>
                )}
              </div>

              {/* Right sig */}
              <div style={{ textAlign: "center", minWidth: "140px" }}>
                <div style={{ height: "1px", background: "rgba(212,175,55,0.4)", marginBottom: "6px" }} />
                <p style={{ color: "#F5F0E8", fontSize: "12px", fontWeight: "600" }}>Legal Authority</p>
                <p style={{ color: "rgba(212,175,55,0.6)", fontSize: "10px", letterSpacing: "1px" }}>Authorized Signatory</p>
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: "20px", textAlign: "center", borderTop: "1px solid rgba(212,175,55,0.15)", paddingTop: "12px" }}>
              <p style={{ color: "rgba(245,240,232,0.3)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase" }}>
                This document is legally binding and constitutes proof of ownership · SmartProp Property Management System · {new Date().getFullYear()}
              </p>
            </div>
          </div>
        </div>
        </div>{/* end scrollable wrapper */}
      </div>
    </div>
  );
}

// ─── Payment Receipt Modal ────────────────────────────────────────────────────

function PaymentReceiptModal({ payment, agreement, onClose }: {
  payment: RentToOwnPayment;
  agreement?: RentToOwnAgreement;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const currency   = agreement?.currency ?? "KES";
    const paidAmount = payment.paidAmount ?? payment.scheduledAmount;
    // Completion percentage derived from payments made vs total
    const completion = agreement && agreement.paymentsTotal > 0
      ? ((agreement.paymentsMade / agreement.paymentsTotal) * 100).toFixed(1)
      : null;

    const body = `
      ${spHeader("Payment Receipt", payment.paymentNumber, payment.paidDate ?? new Date().toISOString())}
      <div class="sp-grid-2">
        <div class="sp-section">
          <div class="sp-section-title">Payment Details</div>
          <div class="sp-row"><span class="sp-label">Receipt No.</span><span class="sp-value">${payment.paymentNumber}</span></div>
          <div class="sp-row"><span class="sp-label">Payment Date</span><span class="sp-value">${fmtDocDate(payment.paidDate)}</span></div>
          <div class="sp-row"><span class="sp-label">Method</span><span class="sp-value">${payment.paymentMethod ? payment.paymentMethod.toUpperCase() : "—"}</span></div>
          ${payment.transactionId ? `<div class="sp-row"><span class="sp-label">M-Pesa Ref</span><span class="sp-value">${payment.transactionId}</span></div>` : ""}
        </div>
        <div class="sp-section">
          <div class="sp-section-title">Contract Details</div>
          <div class="sp-row"><span class="sp-label">Agreement No.</span><span class="sp-value">${agreement?.agreementNumber ?? "—"}</span></div>
          <div class="sp-row"><span class="sp-label">Property</span><span class="sp-value">${agreement?.propertyAddress ?? "—"}</span></div>
          <div class="sp-row"><span class="sp-label">Payment</span><span class="sp-value">${agreement ? `${agreement.paymentsMade} of ${agreement.paymentsTotal}` : "—"}</span></div>
          <div class="sp-row"><span class="sp-label">Due Date</span><span class="sp-value">${fmtDocDate(payment.dueDate)}</span></div>
        </div>
      </div>
      <div class="sp-amount-box">
        <div class="sp-amount">${fmtDocKES(paidAmount, currency)}</div>
        <div class="sp-amount-label">Rent-to-Own Instalment Payment</div>
        <div class="sp-stamp">PAID</div>
      </div>
      ${agreement ? `
      <div class="sp-section">
        <div class="sp-section-title">Contract Progress</div>
        <div class="sp-row"><span class="sp-label">Purchase Price</span><span class="sp-value">${fmtDocKES(agreement.purchasePrice, currency)}</span></div>
        <div class="sp-row"><span class="sp-label">Total Paid to Date</span><span class="sp-value">${fmtDocKES(agreement.totalPaid, currency)}</span></div>
        <div class="sp-row"><span class="sp-label">Remaining Balance</span><span class="sp-value">${fmtDocKES(agreement.remainingBalance, currency)}</span></div>
        <div class="sp-row"><span class="sp-label">Completion</span><span class="sp-value">${completion ? completion + "%" : "—"}</span></div>
      </div>` : ""}
      ${spFooter()}
    `;
    openPrintWindow(body, `Receipt-${payment.paymentNumber}`);
  };

  const fmt = (v: string | number | undefined) => {
    const n = parseFloat((v ?? "0").toString()) || 0;
    return `Ksh ${n.toLocaleString("en-KE", { minimumFractionDigits: 0 })}`;
  };

  const paidDate = payment.paidDate ? new Date(payment.paidDate).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" }) : "—";
  const dueDate = payment.dueDate ? new Date(payment.dueDate).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" }) : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md flex flex-col gap-3" style={{ maxHeight: "95vh" }} onClick={e => e.stopPropagation()}>
        {/* Controls */}
        <div className="flex justify-end gap-2 flex-shrink-0">
          <Button size="sm" variant="secondary" onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>✕ Close</Button>
        </div>

        {/* Scrollable receipt wrapper */}
        <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1, borderRadius: "12px" }}>
        {/* Receipt — certificate-style, theme-safe inline styles */}
        <div id="receipt-printable" ref={printRef} style={{
          background: "linear-gradient(160deg, #0f1b2d 0%, #162236 60%, #0f1b2d 100%)",
          borderRadius: "12px",
          padding: "0",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(212,175,55,0.3)",
          fontFamily: "'Georgia', serif",
          position: "relative",
          maxWidth: "480px",
          margin: "0 auto",
        }}>
          {/* Gold border frame */}
          <div style={{ position: "absolute", inset: "8px", border: "2px solid rgba(212,175,55,0.5)", borderRadius: "8px", pointerEvents: "none", zIndex: 1 }} />
          <div style={{ position: "absolute", inset: "12px", border: "1px solid rgba(212,175,55,0.2)", borderRadius: "6px", pointerEvents: "none", zIndex: 1 }} />

          {/* Corner ornaments */}
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
            <div key={pos} style={{
              position: "absolute",
              ...(pos.includes("top") ? { top: "16px" } : { bottom: "16px" }),
              ...(pos.includes("left") ? { left: "16px" } : { right: "16px" }),
              width: "20px", height: "20px",
              borderTop: pos.includes("top") ? "2px solid #D4AF37" : "none",
              borderBottom: pos.includes("bottom") ? "2px solid #D4AF37" : "none",
              borderLeft: pos.includes("left") ? "2px solid #D4AF37" : "none",
              borderRight: pos.includes("right") ? "2px solid #D4AF37" : "none",
              zIndex: 2,
            }} />
          ))}

          {/* Background radial glow */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "radial-gradient(circle at 50% 0%, rgba(212,175,55,0.06) 0%, transparent 60%)",
            pointerEvents: "none",
          }} />

          <div style={{ padding: "36px 44px", position: "relative", zIndex: 2 }}>
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "10px" }}>
                <div style={{ height: "1px", flex: 1, background: "linear-gradient(to right, transparent, #D4AF37)" }} />
                <div style={{
                  width: "44px", height: "44px", borderRadius: "50%",
                  background: "linear-gradient(135deg, #D4AF37, #F5D768, #D4AF37)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 16px rgba(212,175,55,0.4)",
                  fontSize: "20px",
                }}>🧾</div>
                <div style={{ height: "1px", flex: 1, background: "linear-gradient(to left, transparent, #D4AF37)" }} />
              </div>
              <p style={{ color: "#D4AF37", fontSize: "10px", letterSpacing: "5px", textTransform: "uppercase", marginBottom: "4px" }}>SmartProp Registry</p>
              <h1 style={{ color: "#F5F0E8", fontSize: "22px", fontWeight: "700", letterSpacing: "2px", margin: "0 0 2px", fontFamily: "Georgia, serif" }}>Payment Receipt</h1>
              <p style={{ color: "rgba(212,175,55,0.7)", fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase" }}>Official Payment Record</p>
            </div>

            {/* Receipt number badge + PAID status */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
              <span style={{
                display: "inline-block",
                background: "rgba(212,175,55,0.1)",
                border: "1px solid rgba(212,175,55,0.4)",
                borderRadius: "4px",
                padding: "3px 14px",
                color: "#D4AF37",
                fontSize: "11px",
                letterSpacing: "2px",
                fontFamily: "monospace",
              }}>{payment.paymentNumber}</span>
              <span style={{
                display: "inline-block",
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                borderRadius: "9999px",
                padding: "3px 14px",
                color: "#4ade80",
                fontSize: "10px",
                fontWeight: "700",
                letterSpacing: "2px",
                textTransform: "uppercase",
              }}>✓ Paid</span>
            </div>

            {/* Info grid block */}
            <div style={{
              background: "rgba(15,27,45,0.7)",
              border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: "6px",
              padding: "14px 18px",
              marginBottom: "16px",
            }}>
              {[
                { label: "Payment Date", value: paidDate },
                { label: "Due Date", value: dueDate },
                ...(payment.transactionId ? [{ label: "Transaction ID", value: payment.transactionId, mono: true }] : []),
              ].map(({ label, value, mono }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(212,175,55,0.08)" }}>
                  <span style={{ color: "rgba(212,175,55,0.65)", fontSize: "11px", letterSpacing: "1px" }}>{label}</span>
                  <span style={{ color: "#F5F0E8", fontSize: "12px", fontWeight: "600", fontFamily: mono ? "monospace" : "Georgia, serif" }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Agreement details */}
            {agreement && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ color: "rgba(212,175,55,0.5)", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "8px" }}>Agreement Details</p>
                <div style={{ background: "rgba(15,27,45,0.7)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: "6px", padding: "14px 18px" }}>
                  {[
                    { label: "Agreement", value: agreement.agreementNumber, mono: true },
                    ...(agreement.propertyAddress ? [{ label: "Property", value: agreement.propertyAddress }] : []),
                    ...(agreement.tenantName ? [{ label: "Tenant", value: agreement.tenantName }] : []),
                  ].map(({ label, value, mono }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(212,175,55,0.08)" }}>
                      <span style={{ color: "rgba(212,175,55,0.65)", fontSize: "11px", letterSpacing: "1px" }}>{label}</span>
                      <span style={{ color: "#F5F0E8", fontSize: "12px", fontWeight: "600", fontFamily: mono ? "monospace" : "Georgia, serif", maxWidth: "55%", textAlign: "right" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment breakdown */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ color: "rgba(212,175,55,0.5)", fontSize: "9px", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "8px" }}>Payment Breakdown</p>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "1px", background: "rgba(212,175,55,0.2)",
                border: "1px solid rgba(212,175,55,0.2)",
                borderRadius: "6px", overflow: "hidden",
              }}>
                {[
                  { label: "Scheduled", value: fmt(payment.scheduledAmount), color: "#F5F0E8" },
                  { label: "Rent Portion", value: fmt(payment.rentPortion), color: "#F5F0E8" },
                  { label: "Credit Portion", value: fmt(payment.creditPortion), color: "#4ade80" },
                  ...(payment.lateFee && parseFloat(payment.lateFee) > 0
                    ? [{ label: "Late Fee", value: fmt(payment.lateFee), color: "#f87171" }]
                    : []),
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: "12px 16px", background: "rgba(15,27,45,0.8)", textAlign: "center" }}>
                    <p style={{ color: "rgba(212,175,55,0.6)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "4px" }}>{label}</p>
                    <p style={{ color, fontSize: "13px", fontWeight: "600" }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Total amount */}
            <div style={{
              borderTop: "1px solid rgba(212,175,55,0.3)",
              paddingTop: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: payment.paymentMethod ? "12px" : "0",
            }}>
              <span style={{ color: "#F5F0E8", fontSize: "14px", fontWeight: "700", letterSpacing: "1px" }}>Amount Paid</span>
              <span style={{ color: "#4ade80", fontSize: "24px", fontWeight: "700", fontFamily: "Georgia, serif" }}>{fmt(payment.paidAmount ?? payment.scheduledAmount)}</span>
            </div>

            {payment.paymentMethod && (
              <p style={{ color: "rgba(212,175,55,0.5)", fontSize: "10px", textAlign: "center", letterSpacing: "2px", textTransform: "uppercase" }}>
                Paid via {payment.paymentMethod.replace(/_/g, " ")}
              </p>
            )}

            {/* Footer */}
            <div style={{ marginTop: "18px", textAlign: "center", borderTop: "1px solid rgba(212,175,55,0.15)", paddingTop: "10px" }}>
              <p style={{ color: "rgba(245,240,232,0.25)", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase" }}>
                This receipt is an official record of payment · SmartProp Property Management · {new Date().getFullYear()}
              </p>
            </div>
          </div>
        </div>
        </div>{/* end scrollable wrapper */}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RentToOwn() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("agreements");
  const [createAgreementOpen, setCreateAgreementOpen] = useState(false);
  const [rtoForm, setRtoForm] = useState({
    propertyId: "", tenantId: "", agreementType: "lease_option",
    totalPropertyValue: "", initialDeposit: "", monthlyPayment: "",
    agreementDuration: "36", interestRate: "",
    rentCreditRate: "25", optionFee: "", optionFeeApplied: "true",
    legalClause: "lease_option",
    nextPaymentDue: new Date().toISOString().split("T")[0],
    terms: "",
  });
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    agreementId: "", scheduledAmount: "", principalAmount: "",
    interestAmount: "0", dueDate: new Date().toISOString().split("T")[0],
    paymentMethod: "bank_transfer", transactionId: "", notes: "",
  });
  const [issueCertOpen, setIssueCertOpen] = useState(false);
  const [certForm, setCertForm] = useState({ agreementId: "", ownershipPercentage: "100", ownershipType: "full", titleDeedNumber: "" });
  const [selectedCert, setSelectedCert] = useState<OwnershipCertificate | null>(null);
  const [selectedAgreement, setSelectedAgreement] = useState<RentToOwnAgreement | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<RentToOwnPayment | null>(null);
  const [agreementsPage, setAgreementsPage] = useState(1);
  const [agreementsPageSize, setAgreementsPageSize] = useState(10);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(10);
  const [certsPage, setCertsPage] = useState(1);
  const [certsPageSize, setCertsPageSize] = useState(9);
  const [agreementsSearch, setAgreementsSearch] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [certificatesSearch, setCertificatesSearch] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); },
    retry: false,
  });

  const { data: tenants = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants"],
    queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); },
    retry: false,
  });

  const { data: units = [] } = useQuery<any[]>({
    queryKey: ["/api/units"],
    queryFn: async () => { const r = await apiRequest("/api/units"); return ensureArray(await r.json()); },
    retry: false,
  });

  const propertyOptions = useMemo(() =>
    properties.map((p: any) => ({ value: String(p.id), label: p.name, sub: p.address })),
    [properties]
  );

  const tenantOptions = useMemo(() =>
    tenants.map((t: any) => ({ value: String(t.id), label: `${t.firstName} ${t.lastName}`, sub: t.email })),
    [tenants]
  );

  const { data: agreements = [], isLoading: agreementsLoading } = useQuery<RentToOwnAgreement[]>({
    queryKey: ["/api/rent-to-own-agreements"],
    queryFn: async () => { const r = await apiRequest("/api/rent-to-own-agreements"); return ensureArray(await r.json()); },
    retry: false,
  });

  const agreementOptions = useMemo(() =>
    agreements.map((a) => ({
      value: String(a.id),
      label: a.agreementNumber,
      sub: `${a.propertyAddress || `Property #${a.propertyId}`} · ${a.tenantName || `Tenant #${a.tenantId}`}`,
    })),
    [agreements]
  );

  // ── Name resolvers ────────────────────────────────────────────────────────
  const getPropertyName = (id: number): string => {
    const p = properties.find((p: any) => p.id === id);
    return p ? (p.name || p.address || `Property #${id}`) : `Property #${id}`;
  };

  const getTenantName = (id: number): string => {
    const t = tenants.find((t: any) => t.id === id);
    if (!t) return `Tenant #${id}`;
    return `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || t.name || `Tenant #${id}`;
  };

  const getAgreementLabel = (id: number): string => {
    const a = agreements.find((a) => a.id === id);
    return a ? a.agreementNumber : `Agreement #${id}`;
  };

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<RentToOwnPayment[]>({
    queryKey: ["/api/rent-to-own-payments"],
    queryFn: async () => { const r = await apiRequest("/api/rent-to-own-payments"); return ensureArray(await r.json()); },
    retry: false,
  });

  const { data: certificates = [], isLoading: certificatesLoading } = useQuery<OwnershipCertificate[]>({
    queryKey: ["/api/ownership-certificates"],
    queryFn: async () => { const r = await apiRequest("/api/ownership-certificates"); return ensureArray(await r.json()); },
    retry: false,
  });

  // ── Filtered data ─────────────────────────────────────────────────────────
  const filteredAgreements = useMemo(() => {
    const q = agreementsSearch.toLowerCase().trim();
    if (!q) return agreements;
    return agreements.filter(a => {
      const propName = getPropertyName(a.propertyId).toLowerCase();
      const tenantName = getTenantName(a.tenantId).toLowerCase();
      return (
        a.agreementNumber.toLowerCase().includes(q) ||
        propName.includes(q) ||
        tenantName.includes(q) ||
        (a.status || "").toLowerCase().includes(q) ||
        (a.agreementType || "").toLowerCase().includes(q)
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreements, agreementsSearch, properties, tenants]);

  const filteredPayments = useMemo(() => {
    const q = paymentsSearch.toLowerCase().trim();
    if (!q) return payments;
    return payments.filter(p => {
      const agreementLabel = getAgreementLabel(p.agreementId).toLowerCase();
      return (
        String(p.paymentNumber).toLowerCase().includes(q) ||
        agreementLabel.includes(q) ||
        (p.status || "").toLowerCase().includes(q) ||
        (p.paymentMethod || "").toLowerCase().includes(q) ||
        (p.transactionId || "").toLowerCase().includes(q)
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, paymentsSearch, agreements]);

  const filteredCertificates = useMemo(() => {
    const q = certificatesSearch.toLowerCase().trim();
    if (!q) return certificates;
    return certificates.filter(c => {
      const propName = getPropertyName(c.propertyId).toLowerCase();
      const ownerId = (c as any).ownerId ?? (c as any).tenantId;
      const ownerName = getTenantName(ownerId).toLowerCase();
      return (
        (c.certificateNumber || "").toLowerCase().includes(q) ||
        propName.includes(q) ||
        ownerName.includes(q) ||
        (c.status || "").toLowerCase().includes(q) ||
        (c.ownershipType || "").toLowerCase().includes(q)
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificates, certificatesSearch, properties, tenants]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createRtoAgreementMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await apiRequest("/api/rent-to-own-agreements", { method: "POST", data });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Agreement Created", description: "Rent-to-own agreement has been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-to-own-agreements"] });
      setCreateAgreementOpen(false);
      setRtoForm({ propertyId: "", tenantId: "", agreementType: "lease_option",
        totalPropertyValue: "", initialDeposit: "", monthlyPayment: "",
        agreementDuration: "36", interestRate: "",
        rentCreditRate: "25", optionFee: "", optionFeeApplied: "true",
        legalClause: "lease_option",
        nextPaymentDue: new Date().toISOString().split("T")[0], terms: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create agreement", variant: "destructive" });
    },
  });

  const createRtoPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await apiRequest("/api/rent-to-own-payments", { method: "POST", data });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Payment Recorded", description: "Payment entry has been added to the schedule." });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-to-own-payments"] });
      setRecordPaymentOpen(false);
      setPaymentForm({ agreementId: "", scheduledAmount: "", principalAmount: "",
        interestAmount: "0", dueDate: new Date().toISOString().split("T")[0],
        paymentMethod: "bank_transfer", transactionId: "", notes: "" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to record payment", variant: "destructive" });
    },
  });

  const processPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest(`/api/rent-to-own-payments/${data.paymentId}/process`, { method: "POST", data });
    },
    onSuccess: () => {
      toast({ title: "Payment Processed", description: "Payment recorded and rent credit updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-to-own-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-to-own-agreements"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to process payment", variant: "destructive" });
    },
  });

  const generateCertificateMutation = useMutation({
    mutationFn: async (agreementId: number) => {
      await apiRequest(`/api/ownership-certificates/generate/${agreementId}`, { method: "POST", data: {} });
    },
    onSuccess: () => {
      toast({ title: "Certificate Issued", description: "Ownership certificate generated and ready for download." });
      queryClient.invalidateQueries({ queryKey: ["/api/ownership-certificates"] });
      setIssueCertOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to generate certificate", variant: "destructive" });
    },
  });

  // ── Derived Stats ─────────────────────────────────────────────────────────

  const activeAgreements = agreements.filter(a => a.status === "active");
  const overduePayments = payments.filter(p => p.status === "overdue");
  const totalPortfolioValue = agreements.reduce((s, a) => s + parseFloat(a.totalPropertyValue || "0"), 0);
  const totalCreditsAccumulated = agreements.reduce((s, a) => s + parseFloat(a.totalRentCredits || "0"), 0);
  const optionsExpiringThisMonth = agreements.filter(a => {
    if (!a.optionExpiryDate) return false;
    const exp = new Date(a.optionExpiryDate);
    const now = new Date();
    return exp.getFullYear() === now.getFullYear() && exp.getMonth() === now.getMonth();
  });

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 min-w-0 w-full">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rent-to-Own</h1>
          <p className="text-muted-foreground mt-1">
            Manage lease-option agreements, payment schedules, and ownership certificates
          </p>
        </div>
        {overduePayments.length > 0 && (
          <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 shrink-0">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">
              {overduePayments.length} overdue payment{overduePayments.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="agreements" className="text-xs sm:text-sm">
            <HandshakeIcon className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
            Rent-to-Own
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs sm:text-sm">
            <Banknote className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="certificates" className="text-xs sm:text-sm">
            <Award className="h-3.5 w-3.5 mr-1 hidden sm:inline" />
            Certificates
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1 — Rent-to-Own Agreements
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="agreements" className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Rent-to-Own Agreements</h2>
              <p className="text-sm text-muted-foreground">Lease-option, lease-purchase and installment sale contracts</p>
            </div>
            <Dialog open={createAgreementOpen} onOpenChange={setCreateAgreementOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Agreement
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Rent-to-Own Agreement</DialogTitle>
                  <DialogDescription>
                    Define the agreement type, option fee, rent credits, and purchase option terms.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 grid-cols-2">
                  <div className="space-y-2 col-span-2">
                    <Label>Agreement Type</Label>
                    <Select value={rtoForm.agreementType} onValueChange={v => setRtoForm(f => ({ ...f, agreementType: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lease_option">Lease-Option (right, not obligation to buy)</SelectItem>
                        <SelectItem value="lease_purchase">Lease-Purchase (obligated to buy)</SelectItem>
                        <SelectItem value="installment_sale">Installment Sale (title via payments)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Property <span className="text-destructive">*</span></Label>
                    <SearchableSelect
                      options={propertyOptions}
                      value={rtoForm.propertyId}
                      onChange={v => setRtoForm(f => ({ ...f, propertyId: v }))}
                      placeholder="Search properties…"
                      emptyText="No properties found."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tenant <span className="text-destructive">*</span></Label>
                    <SearchableSelect
                      options={tenantOptions}
                      value={rtoForm.tenantId}
                      onChange={v => setRtoForm(f => ({ ...f, tenantId: v }))}
                      placeholder="Search tenants…"
                      emptyText="No tenants found."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Property Value (KES)</Label>
                    <Input
                      placeholder="e.g. 5000000"
                      value={rtoForm.totalPropertyValue}
                      onChange={e => setRtoForm(f => ({ ...f, totalPropertyValue: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Initial Deposit (KES)</Label>
                    <Input
                      placeholder="e.g. 250000"
                      value={rtoForm.initialDeposit}
                      onChange={e => setRtoForm(f => ({ ...f, initialDeposit: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Payment (KES)</Label>
                    <Input
                      placeholder="e.g. 45000"
                      value={rtoForm.monthlyPayment}
                      onChange={e => setRtoForm(f => ({ ...f, monthlyPayment: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Interest Rate (% p.a.)</Label>
                    <Input
                      placeholder="e.g. 12 (leave blank for 0%)"
                      value={rtoForm.interestRate}
                      onChange={e => setRtoForm(f => ({ ...f, interestRate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Rent Credit Rate (%)</Label>
                    <Input
                      type="number" min="0" max="100" placeholder="e.g. 25"
                      value={rtoForm.rentCreditRate}
                      onChange={e => setRtoForm(f => ({ ...f, rentCreditRate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Option Fee (Ksh)</Label>
                    <Input
                      type="number" min="0" placeholder="e.g. 50000"
                      value={rtoForm.optionFee}
                      onChange={e => setRtoForm(f => ({ ...f, optionFee: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Option Fee Applied to Price?</Label>
                    <Select value={rtoForm.optionFeeApplied} onValueChange={v => setRtoForm(f => ({ ...f, optionFeeApplied: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes — credits toward purchase price</SelectItem>
                        <SelectItem value="false">No — non-refundable consideration</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Legal Clause Type</Label>
                    <Select value={rtoForm.legalClause} onValueChange={v => setRtoForm(f => ({ ...f, legalClause: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lease_option">Lease-Option (right to buy)</SelectItem>
                        <SelectItem value="lease_purchase">Lease-Purchase (obligation to buy)</SelectItem>
                        <SelectItem value="right_of_first_refusal">Right of First Refusal</SelectItem>
                        <SelectItem value="installment_sale">Installment Sale</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>First Payment Due</Label>
                    <Input
                      type="date"
                      value={rtoForm.nextPaymentDue}
                      onChange={e => setRtoForm(f => ({ ...f, nextPaymentDue: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Agreement Duration (months)</Label>
                    <Input
                      placeholder="e.g. 36"
                      value={rtoForm.agreementDuration}
                      onChange={e => setRtoForm(f => ({ ...f, agreementDuration: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Terms &amp; Conditions</Label>
                    <Textarea
                      placeholder="e.g. Right of first refusal, maintenance responsibilities, default cure period..."
                      value={rtoForm.terms}
                      onChange={e => setRtoForm(f => ({ ...f, terms: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCreateAgreementOpen(false)}>Cancel</Button>
                  <Button
                    disabled={createRtoAgreementMutation.isPending}
                    onClick={() => {
                      if (!rtoForm.propertyId || !rtoForm.tenantId || !rtoForm.totalPropertyValue || !rtoForm.monthlyPayment) {
                        toast({ title: "Required fields missing", description: "Please select a Property, Tenant, and fill in Property Value and Monthly Payment.", variant: "destructive" });
                        return;
                      }
                      const value = rtoForm.totalPropertyValue;
                      const deposit = rtoForm.initialDeposit || "0";
                      createRtoAgreementMutation.mutate({
                        agreementNumber: `RTO-${Date.now()}`,
                        propertyId: Number(rtoForm.propertyId),
                        tenantId: Number(rtoForm.tenantId),
                        agreementType: rtoForm.agreementType,
                        totalPropertyValue: value,
                        initialDeposit: deposit,
                        monthlyPayment: rtoForm.monthlyPayment,
                        agreementDuration: Number(rtoForm.agreementDuration) || 36,
                        interestRate: rtoForm.interestRate || "0",
                        rentCreditRate: rtoForm.rentCreditRate || "25",
                        optionFee: rtoForm.optionFee || "0",
                        optionFeeApplied: rtoForm.optionFeeApplied === "true",
                        legalClause: rtoForm.legalClause,
                        remainingBalance: (parseFloat(value) - parseFloat(deposit)).toString(),
                        nextPaymentDue: new Date(rtoForm.nextPaymentDue).toISOString(),
                        terms: rtoForm.terms,
                        currency: "KES",
                      });
                    }}
                  >
                    {createRtoAgreementMutation.isPending ? "Saving..." : "Create Agreement"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Key Metrics */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 items-stretch">
            <StatCard
              title="Active Agreements"
              value={activeAgreements.length}
              sub="In progress"
              icon={FileText}
            />
            <StatCard
              title="Completed"
              value={agreements.filter(a => a.status === "completed").length}
              sub="Ownership transferred"
              icon={CheckCircle2}
            />
            <StatCard
              title="Overdue Payments"
              value={overduePayments.length}
              sub="Require immediate action"
              icon={AlertCircle}
              alert={overduePayments.length > 0}
            />
            <StatCard
              title="Portfolio Value"
              value={<Fmt amount={totalPortfolioValue} />}
              sub="Total RTO properties"
              icon={Building2}
            />
            <StatCard
              title="Total Rent Credits"
              value={<Fmt amount={totalCreditsAccumulated} />}
              sub="Accumulated by tenants"
              icon={TrendingUp}
            />
          </div>

          {/* Expiring Options Alert */}
          {optionsExpiringThisMonth.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800" >
              <CalendarClock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-400">
                  {optionsExpiringThisMonth.length} option{optionsExpiringThisMonth.length !== 1 ? "s" : ""} expiring this month
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-500 mt-0.5">
                  Contact tenants to confirm whether they intend to exercise their purchase option before the deadline.
                </p>
              </div>
            </div>
          )}

          {/* Agreements Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">All Agreements</CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    className="pl-8 pr-3 py-1.5 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring w-48"
                    placeholder="Search agreements…"
                    value={agreementsSearch}
                    onChange={e => { setAgreementsSearch(e.target.value); setAgreementsPage(1); }}
                  />
                </div>
                <span className="text-xs text-muted-foreground hidden sm:inline">{filteredAgreements.length} total</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Show</span>
                  <select
                    className="text-xs border rounded px-1.5 py-1 bg-background"
                    value={agreementsPageSize}
                    onChange={e => { setAgreementsPageSize(Number(e.target.value)); setAgreementsPage(1); }}
                  >
                    {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Agreement</th>
                      <th className="text-left px-4 py-3 font-medium">Property / Tenant</th>
                      <th className="text-left px-4 py-3 font-medium">Purchase Price</th>
                      <th className="text-left px-4 py-3 font-medium">Progress</th>
                      <th className="text-left px-4 py-3 font-medium">Next Payment</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {agreementsLoading ? (
                      <tr>
                        <td colSpan={7} className="text-center p-8">
                          <div className="flex items-center justify-center gap-2 text-muted-foreground">
                            <RefreshCcw className="h-4 w-4 animate-spin" />
                            Loading agreements...
                          </div>
                        </td>
                      </tr>
                    ) : filteredAgreements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-12 text-muted-foreground">
                          <HandshakeIcon className="h-8 w-8 mx-auto mb-3 opacity-30" />
                          <p>{agreementsSearch ? "No agreements match your search." : "No rent-to-own agreements found."}</p>
                          {!agreementsSearch && <p className="text-xs mt-1">Create your first agreement to get started.</p>}
                        </td>
                      </tr>
                    ) : (
                      filteredAgreements.slice((agreementsPage-1)*agreementsPageSize, agreementsPage*agreementsPageSize).map((agreement) => {
                        const paid = parseFloat(agreement.totalPaid || "0");
                        const total = parseFloat(agreement.purchasePrice || agreement.totalPropertyValue || "1");
                        const progress = (paid / total) * 100;
                        const propName = agreement.propertyAddress || getPropertyName(agreement.propertyId);
                        const tenantName = agreement.tenantName || getTenantName(agreement.tenantId);
                        return (
                          <tr key={agreement.id} className="border-b hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedAgreement(agreement)}>
                            <td className="px-4 py-3">
                              <div>
                                <p className="font-mono text-xs font-medium">{agreement.agreementNumber}</p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  {agreement.isNotarized && <span title="Notarized"><Scale className="h-3 w-3 text-blue-500" /></span>}
                                  {agreement.propertyConditionReport && <span title="Condition report"><FileCheck className="h-3 w-3 text-green-500" /></span>}
                                  {agreement.escrowAccount && <span title="Escrow set up"><ShieldCheck className="h-3 w-3 text-purple-500" /></span>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              <p className="font-medium truncate">{propName}</p>
                              <p className="text-xs text-muted-foreground truncate">{tenantName}</p>
                            </td>
                            <td className="px-4 py-3 font-medium whitespace-nowrap">
                              <Fmt amount={agreement.purchasePrice || agreement.totalPropertyValue} currency={agreement.currency} />
                            </td>
                            <td className="px-4 py-3 min-w-[160px]">
                              <ProgressBar value={progress} />
                              <p className="text-xs text-muted-foreground mt-1">
                                {agreement.paymentsMade ?? 0}/{agreement.paymentsTotal ?? agreement.agreementDurationMonths ?? "?"} payments
                              </p>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                              {agreement.nextPaymentDue
                                ? new Date(agreement.nextPaymentDue).toLocaleDateString()
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={agreement.status} />
                            </td>
                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setSelectedAgreement(agreement)}>
                                    <Eye className="h-3.5 w-3.5 mr-2" /> View Details
                                  </DropdownMenuItem>
                                  {agreement.status === "completed" && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => generateCertificateMutation.mutate(agreement.id)} disabled={generateCertificateMutation.isPending}>
                                        <Award className="h-3.5 w-3.5 mr-2" /> Issue Certificate
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {filteredAgreements.length > agreementsPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                  <span>Showing {Math.min((agreementsPage-1)*agreementsPageSize+1, filteredAgreements.length)}–{Math.min(agreementsPage*agreementsPageSize, filteredAgreements.length)} of {filteredAgreements.length}</span>
                  <div className="flex gap-1">
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={agreementsPage===1} onClick={()=>setAgreementsPage(p=>p-1)}>‹</button>
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={agreementsPage*agreementsPageSize>=filteredAgreements.length} onClick={()=>setAgreementsPage(p=>p+1)}>›</button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2 — Payment Tracking
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="payments" className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Payment Tracking</h2>
              <p className="text-sm text-muted-foreground">Monitor rent payments, credit allocations, and overdue accounts</p>
            </div>
            <Dialog open={recordPaymentOpen} onOpenChange={setRecordPaymentOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Record Payment</DialogTitle>
                  <DialogDescription>
                    Add a payment entry to the schedule for a rent-to-own agreement.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Agreement <span className="text-destructive">*</span></Label>
                    <SearchableSelect
                      options={agreementOptions}
                      value={paymentForm.agreementId}
                      onChange={v => setPaymentForm(f => ({ ...f, agreementId: v }))}
                      placeholder="Search agreements…"
                      emptyText="No agreements found."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Scheduled Amount (KES) <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="e.g. 45000"
                        value={paymentForm.scheduledAmount}
                        onChange={e => setPaymentForm(f => ({ ...f, scheduledAmount: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Principal Amount (KES) <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="e.g. 40000"
                        value={paymentForm.principalAmount}
                        onChange={e => setPaymentForm(f => ({ ...f, principalAmount: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Interest Amount (KES)</Label>
                      <Input
                        placeholder="e.g. 5000"
                        value={paymentForm.interestAmount}
                        onChange={e => setPaymentForm(f => ({ ...f, interestAmount: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Due Date <span className="text-destructive">*</span></Label>
                      <Input
                        type="date"
                        value={paymentForm.dueDate}
                        onChange={e => setPaymentForm(f => ({ ...f, dueDate: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Payment Method</Label>
                      <Select value={paymentForm.paymentMethod} onValueChange={v => setPaymentForm(f => ({ ...f, paymentMethod: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                          <SelectItem value="mpesa">M-Pesa</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="cheque">Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Transaction ID</Label>
                      <Input
                        placeholder="e.g. MPesa code"
                        value={paymentForm.transactionId}
                        onChange={e => setPaymentForm(f => ({ ...f, transactionId: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      placeholder="Optional notes..."
                      value={paymentForm.notes}
                      onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRecordPaymentOpen(false)}>Cancel</Button>
                  <Button
                    disabled={createRtoPaymentMutation.isPending}
                    onClick={() => {
                      if (!paymentForm.agreementId || !paymentForm.scheduledAmount || !paymentForm.principalAmount) {
                        toast({ title: "Required fields missing", description: "Please select an Agreement and fill in Scheduled Amount and Principal Amount.", variant: "destructive" });
                        return;
                      }
                      createRtoPaymentMutation.mutate({
                        agreementId: Number(paymentForm.agreementId),
                        paymentNumber: payments.filter(p => p.agreementId === Number(paymentForm.agreementId)).length + 1,
                        scheduledAmount: paymentForm.scheduledAmount,
                        principalAmount: paymentForm.principalAmount,
                        interestAmount: paymentForm.interestAmount || "0",
                        dueDate: new Date(paymentForm.dueDate).toISOString(),
                        paymentMethod: paymentForm.paymentMethod,
                        transactionId: paymentForm.transactionId || undefined,
                        notes: paymentForm.notes || undefined,
                        status: "pending",
                      });
                    }}
                  >
                    {createRtoPaymentMutation.isPending ? "Saving..." : "Add Payment"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Payment Summary */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Pending Payments"
              value={payments.filter(p => p.status === "pending").length}
              sub="Due soon"
              icon={Clock}
            />
            <StatCard
              title="Overdue Payments"
              value={overduePayments.length}
              sub="Immediate follow-up needed"
              icon={AlertTriangle}
              alert={overduePayments.length > 0}
            />
            <StatCard
              title="Total Collected"
              value={<Fmt amount={payments.filter(p => p.status === "paid").reduce((s, p) => s + parseFloat(p.paidAmount || p.scheduledAmount || "0"), 0)} />}
              sub="All time"
              icon={DollarSign}
            />
            <StatCard
              title="Credits Allocated"
              value={<Fmt amount={payments.filter(p => p.status === "paid").reduce((s, p) => s + parseFloat(p.creditPortion || "0"), 0)} />}
              sub="Toward purchase prices"
              icon={TrendingUp}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base">Payment Schedule</CardTitle>
                  <CardDescription className="mt-0.5">Split into rent and credit portions toward purchase price.</CardDescription>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    className="pl-8 pr-3 py-1.5 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring w-48"
                    placeholder="Search payments…"
                    value={paymentsSearch}
                    onChange={e => { setPaymentsSearch(e.target.value); setPaymentsPage(1); }}
                  />
                </div>
                <span className="text-xs text-muted-foreground hidden sm:inline">{filteredPayments.length} total</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Show</span>
                  <select
                    className="text-xs border rounded px-1.5 py-1 bg-background"
                    value={paymentsPageSize}
                    onChange={e => { setPaymentsPageSize(Number(e.target.value)); setPaymentsPage(1); }}
                  >
                    {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Payment #</th>
                      <th className="text-left px-4 py-3 font-medium">Agreement</th>
                      <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Total Due</th>
                      <th className="text-left px-4 py-3 font-medium">Rent Portion</th>
                      <th className="text-left px-4 py-3 font-medium">Credit Portion</th>
                      <th className="text-left px-4 py-3 font-medium">Late Fee</th>
                      <th className="text-left px-4 py-3 font-medium">Due Date</th>
                      <th className="text-left px-4 py-3 font-medium">Paid Date</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsLoading ? (
                      <tr>
                        <td colSpan={7} className="text-center p-8">
                          <div className="flex items-center justify-center gap-2 text-muted-foreground">
                            <RefreshCcw className="h-4 w-4 animate-spin" />
                            Loading payments...
                          </div>
                        </td>
                      </tr>
                    ) : filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-12 text-muted-foreground">
                          <Banknote className="h-8 w-8 mx-auto mb-3 opacity-30" />
                          <p>{paymentsSearch ? "No payments match your search." : "No payment records found."}</p>
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.slice((paymentsPage-1)*paymentsPageSize, paymentsPage*paymentsPageSize).map((payment) => (
                        <tr
                          key={payment.id}
                          className={`border-b hover:bg-muted/30 transition-colors ${payment.status === "overdue" ? "bg-destructive/5" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs">{payment.paymentNumber}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{getAgreementLabel(payment.agreementId)}</td>
                          <td className="px-4 py-3 font-medium">
                            <Fmt amount={payment.scheduledAmount} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <Fmt amount={payment.rentPortion || "0"} />
                          </td>
                          <td className="px-4 py-3 text-emerald-600 font-medium">
                            <Fmt amount={payment.creditPortion || "0"} />
                          </td>
                          <td className="px-4 py-3">
                            {payment.lateFee && parseFloat(payment.lateFee) > 0 ? (
                              <span className="text-destructive"><Fmt amount={payment.lateFee} /></span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {new Date(payment.dueDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            {payment.paidDate ? new Date(payment.paidDate).toLocaleDateString() : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={payment.status} />
                          </td>
                          <td className="px-4 py-3">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {(payment.status === "pending" || payment.status === "overdue") && (
                                  <DropdownMenuItem
                                    onClick={() => processPaymentMutation.mutate({ paymentId: payment.id, paidAmount: payment.scheduledAmount, paymentMethod: "bank_transfer", transactionId: `TXN-${Date.now()}` })}
                                    disabled={processPaymentMutation.isPending}
                                    className={payment.status === "overdue" ? "text-destructive" : ""}
                                  >
                                    <CreditCard className="h-3.5 w-3.5 mr-2" /> Process Payment
                                  </DropdownMenuItem>
                                )}
                                {payment.status === "paid" && (
                                  <DropdownMenuItem onClick={() => setSelectedPayment(payment)}>
                                    <Receipt className="h-3.5 w-3.5 mr-2" /> View Receipt
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredPayments.length > paymentsPageSize && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                  <span>Showing {Math.min((paymentsPage-1)*paymentsPageSize+1, filteredPayments.length)}–{Math.min(paymentsPage*paymentsPageSize, filteredPayments.length)} of {filteredPayments.length}</span>
                  <div className="flex gap-1">
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={paymentsPage===1} onClick={()=>setPaymentsPage(p=>p-1)}>‹</button>
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={paymentsPage*paymentsPageSize>=filteredPayments.length} onClick={()=>setPaymentsPage(p=>p+1)}>›</button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 3 — Ownership Certificates
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="certificates" className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Ownership Certificates</h2>
              <p className="text-sm text-muted-foreground">
                Issued upon full payment or completed ownership transfer. Link to title deeds and land registry records.
              </p>
            </div>
            <Dialog open={issueCertOpen} onOpenChange={setIssueCertOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Issue Certificate
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Issue Ownership Certificate</DialogTitle>
                  <DialogDescription>
                    Generate an ownership certificate from a completed rent-to-own agreement.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Agreement <span className="text-destructive">*</span></Label>
                    <SearchableSelect
                      options={agreements
                        .filter(a => a.status === "completed")
                        .map(a => ({
                          value: String(a.id),
                          label: a.agreementNumber,
                          sub: `${a.propertyAddress || `Property #${a.propertyId}`} · ${a.tenantName || `Tenant #${a.tenantId}`}`,
                        }))}
                      value={certForm.agreementId}
                      onChange={v => setCertForm(f => ({ ...f, agreementId: v }))}
                      placeholder="Select completed agreement…"
                      emptyText="No completed agreements found."
                    />
                    <p className="text-xs text-muted-foreground">Only completed agreements are eligible for a certificate.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Ownership Percentage (%)</Label>
                    <Input
                      type="number" min="1" max="100"
                      value={certForm.ownershipPercentage}
                      onChange={e => setCertForm(f => ({ ...f, ownershipPercentage: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ownership Type</Label>
                    <Select value={certForm.ownershipType} onValueChange={v => setCertForm(f => ({ ...f, ownershipType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full Ownership</SelectItem>
                        <SelectItem value="partial">Partial Ownership</SelectItem>
                        <SelectItem value="shared">Shared Ownership</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Title Deed Number (optional)</Label>
                    <Input
                      placeholder="e.g. TD-2024-00123"
                      value={certForm.titleDeedNumber}
                      onChange={e => setCertForm(f => ({ ...f, titleDeedNumber: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIssueCertOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      if (!certForm.agreementId) {
                        toast({ title: "Required", description: "Please enter an agreement ID.", variant: "destructive" });
                        return;
                      }
                      generateCertificateMutation.mutate(Number(certForm.agreementId));
                    }}
                    disabled={generateCertificateMutation.isPending}
                  >
                    <Award className="h-4 w-4 mr-2" />
                    {generateCertificateMutation.isPending ? "Generating..." : "Issue Certificate"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            <StatCard title="Total Issued" value={certificates.length} sub="All time" icon={Award} />
            <StatCard title="Verified" value={certificates.filter(c => c.isVerified).length} sub="Registry confirmed" icon={ShieldCheck} />
            <StatCard title="Pending Transfer" value={certificates.filter(c => c.status === "pending").length} sub="Awaiting completion" icon={Clock} />
          </div>

          {certificates.length === 0 && !certificatesLoading ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Award className="h-12 w-12 mb-4 opacity-25" />
                <p className="font-medium">No certificates issued yet</p>
                <p className="text-sm mt-1">Certificates are generated when rent-to-own agreements are completed.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">Issued Certificates</CardTitle>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        className="pl-8 pr-3 py-1.5 text-xs border rounded bg-background outline-none focus:ring-1 focus:ring-ring w-48"
                        placeholder="Search certificates…"
                        value={certificatesSearch}
                        onChange={e => { setCertificatesSearch(e.target.value); setCertsPage(1); }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{filteredCertificates.length} total</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Show</span>
                      <select className="text-xs border rounded px-1.5 py-1 bg-background" value={certsPageSize} onChange={e => { setCertsPageSize(Number(e.target.value)); setCertsPage(1); }}>
                        {[6, 9, 12, 24].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {certificatesLoading ? (
                <div className="col-span-full flex items-center justify-center p-8 text-muted-foreground">
                  <RefreshCcw className="h-4 w-4 animate-spin mr-2" /> Loading...
                </div>
              ) : filteredCertificates.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Award className="h-8 w-8 mb-3 opacity-30" />
                  <p>{certificatesSearch ? "No certificates match your search." : "No certificates issued yet."}</p>
                </div>
              ) : (
                filteredCertificates.slice((certsPage-1)*certsPageSize, certsPage*certsPageSize).map((cert) => {
                  const ownerId = (cert as any).ownerId ?? (cert as any).tenantId;
                  return (
                  <Card key={cert.id} className="relative flex flex-col">
                    {cert.isVerified && (
                      <div className="absolute top-2 right-2 bg-emerald-500 rounded-full p-0.5" title="Verified">
                        <ShieldCheck className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                          <Award className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Certificate #{cert.certificateNumber?.split("-")[2] ?? cert.id}</CardTitle>
                          <CardDescription>{getPropertyName(cert.propertyId)}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 flex-1 flex flex-col justify-between">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Owner</p>
                          <p className="text-sm font-medium truncate">{getTenantName(ownerId)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Ownership</p>
                          <p className="font-semibold text-lg">{cert.ownershipPercentage}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Type</p>
                          <Badge variant="outline" className="capitalize text-xs">
                            {cert.ownershipType}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Acquired</p>
                          <p className="text-sm">{new Date(cert.acquisitionDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Acquisition</p>
                          <p className="text-sm capitalize">{cert.acquisitionType?.replace("_", " ")}</p>
                        </div>
                      </div>
                      {cert.titleDeedNumber && (
                        <div className="text-xs bg-muted rounded p-2">
                          <span className="text-muted-foreground">Title Deed: </span>
                          <span className="font-mono">{cert.titleDeedNumber}</span>
                        </div>
                      )}
                      {cert.landRegistryRef && (
                        <div className="text-xs bg-muted rounded p-2">
                          <span className="text-muted-foreground">Land Registry: </span>
                          <span className="font-mono">{cert.landRegistryRef}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 mt-auto">
                        <StatusBadge status={cert.status} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedCert(cert)}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> View Certificate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setSelectedCert(cert)}>
                              <Download className="h-3.5 w-3.5 mr-2" /> Download
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })
              )}
            </div>
          {filteredCertificates.length > certsPageSize && (
                <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
                  <span>Showing {Math.min((certsPage-1)*certsPageSize+1, filteredCertificates.length)}–{Math.min(certsPage*certsPageSize, filteredCertificates.length)} of {filteredCertificates.length}</span>
                  <div className="flex gap-1">
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={certsPage===1} onClick={()=>setCertsPage(p=>p-1)}>‹</button>
                    <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={certsPage*certsPageSize>=filteredCertificates.length} onClick={()=>setCertsPage(p=>p+1)}>›</button>
                  </div>
                </div>
              )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>

      {selectedCert && (
        <CertificateModal
          cert={selectedCert}
          agreements={agreements}
          properties={properties}
          tenants={tenants}
          units={units}
          onClose={() => setSelectedCert(null)}
        />
      )}
      {selectedAgreement && (
        <AgreementDetailPanel
          agreement={selectedAgreement}
          onClose={() => setSelectedAgreement(null)}
        />
      )}
      {selectedPayment && (
        <PaymentReceiptModal
          payment={selectedPayment}
          agreement={agreements.find(a => a.id === selectedPayment.agreementId)}
          onClose={() => setSelectedPayment(null)}
        />
      )}
    </div>
  );
}