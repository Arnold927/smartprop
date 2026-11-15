/**
 * Lease Lifecycle Management page — /leases
 *
 * Tabs:
 *   Active    — live leases, days-remaining countdown, escalation date
 *   Expiring  — leases ending within 90 days, grouped by urgency
 *   Drafts    — unsigned / pending-signature leases
 *   All       — searchable full history with status filters
 *
 * Detail drawer (click any lease row):
 *   Overview | Audit Trail | Deposit Ledger
 *   Actions: Send for Signing · Sign · Activate · Renew · Terminate (now or scheduled) · Settle deposit
 *   Deposit: record received / refund / partial / forfeited; move-out settlement (deposit − rent − bills − damages → refund)
 */

import { AlertTriangle as AlertTriangleIc, Check as CheckIc } from "lucide-react";
import { tenantOptions, unitOptions, propertyOptions, userOptions, byId } from "@/lib/pickerOptions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RESIDENTIAL_UNIT_TYPES } from "@/components/add-unit-dialog";
import { format, differenceInDays, parseISO, isValid } from "date-fns";
import {
  FileText, Plus, Search, ChevronRight, Clock, CheckCircle2,
  AlertTriangle, XCircle, RotateCcw, Send, PenLine, ShieldCheck,
  Banknote, History, ArrowDownRight, ArrowUpRight, RefreshCw,
  TrendingUp, Calendar, Home, User, Filter, X, Loader2, Scale,
} from "lucide-react";
import RRTNoticeGenerator from "@/components/rrt-notice-generator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiErrorMessage } from "@/lib/maintenance-flow";
import { Separator } from "@/components/ui/separator";
import { ExportMenu } from "@/components/export-menu";
import { downloadExcel } from "@/lib/excel";
import { exportTablePdf, todayStamp, money } from "@/lib/pdf";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


// ─── Types ───────────────────────────────────────────────────────────────────

interface Lease {
  id: number;
  leaseNumber: string;
  tenantId: number;
  tenantName: string;
  tenantEmail: string;
  unitNumber: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  leaseDurationMonths: number;
  monthlyRent: string;
  currency: string;
  securityDeposit: string;
  escalationRate: string;
  status: "draft" | "pending_signature" | "active" | "renewed" | "expired" | "terminated";
  signedByTenantAt?: string;
  signedByManagerAt?: string;
  specialConditions?: string;
  notes?: string;
  documentUrl?: string;
  depositBalance?: number;
  /** from GET /api/leases/:id */
  renewal?: { id: number; leaseNumber: string; status: string } | null;
  scheduledTermination?: { date: string; reason: string | null } | null;
  createdAt: string;
}

interface LeaseEvent {
  id: number;
  eventType: string;
  description: string;
  actorName: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface DepositLedger {
  originalDeposit: number;
  received?: number;
  outstanding?: number;
  currentBalance: number;
  currency: string;
  transactions: {
    id: number;
    transactionType: string;
    amount: string;
    balanceAfter: string;
    reason: string;
    reference?: string;
    transactionDate: string;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeDate(d?: string): Date | null {
  if (!d) return null;
  const p = parseISO(d.split("T")[0]);
  return isValid(p) ? p : null;
}

function fmtDate(d?: string): string {
  const p = safeDate(d);
  return p ? format(p, "d MMM yyyy") : "—";
}

function fmtKES(n: number | string, currency = "KES"): string {
  return `${currency} ${Number(n).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function daysLeft(endDate?: string): number {
  const p = safeDate(endDate);
  if (!p) return 0;
  return differenceInDays(p, new Date());
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:             { label: "Draft",           color: "bg-slate-100 text-muted-foreground dark:bg-slate-800 dark:text-slate-300",    icon: <FileText className="w-3 h-3" /> },
  pending_signature: { label: "Awaiting Sign",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: <PenLine className="w-3 h-3" /> },
  active:            { label: "Active",           color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: <CheckCircle2 className="w-3 h-3" /> },
  renewed:           { label: "Renewed",          color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",    icon: <RefreshCw className="w-3 h-3" /> },
  expired:           { label: "Expired",          color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",    icon: <Clock className="w-3 h-3" /> },
  terminated:        { label: "Terminated",       color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",        icon: <XCircle className="w-3 h-3" /> },
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  created:           <Plus className="w-3.5 h-3.5 text-blue-500" />,
  sent_for_signing:  <Send className="w-3.5 h-3.5 text-amber-500" />,
  signed_tenant:     <PenLine className="w-3.5 h-3.5 text-violet-500" />,
  signed_manager:    <ShieldCheck className="w-3.5 h-3.5 text-violet-500" />,
  activated:         <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  renewed:           <RefreshCw className="w-3.5 h-3.5 text-blue-500" />,
  escalation_applied:<TrendingUp className="w-3.5 h-3.5 text-orange-500" />,
  deposit_received:  <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" />,
  deposit_refunded:  <ArrowUpRight className="w-3.5 h-3.5 text-rose-500" />,
  terminated:        <XCircle className="w-3.5 h-3.5 text-red-500" />,
  notice_sent:       <Send className="w-3.5 h-3.5 text-sky-500" />,
  expired:           <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
  renewal_drafted:   <RefreshCw className="w-3.5 h-3.5 text-blue-500" />,
  signatures_reset:  <PenLine className="w-3.5 h-3.5 text-amber-500" />,
  termination_scheduled: <Clock className="w-3.5 h-3.5 text-amber-500" />,
  termination_cancelled: <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />,
  deposit_settled:   <Banknote className="w-3.5 h-3.5 text-emerald-500" />,
};

/** An api error ('{"message":…,"code":…}' text) as { message, code }. */
function parseErr(e: unknown): { message: string; code?: string; data: any } {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  let data: any = {};
  try { data = JSON.parse(raw); } catch { /* plain text */ }
  return { message: apiErrorMessage(e), code: data?.code, data };
}

// ─── Urgency tag for expiring leases ─────────────────────────────────────────

function urgencyTag(days: number) {
  if (days <= 0)  return <Badge className="bg-red-600 text-white text-[10px]">Expired</Badge>;
  if (days <= 14) return <Badge className="bg-red-100 text-red-700 text-[10px]">{days}d left</Badge>;
  if (days <= 30) return <Badge className="bg-orange-100 text-orange-700 text-[10px]">{days}d left</Badge>;
  if (days <= 60) return <Badge className="bg-amber-100 text-amber-700 text-[10px]">{days}d left</Badge>;
  return              <Badge className="bg-sky-100 text-sky-700 text-[10px]">{days}d left</Badge>;
}

// ─── Lease row card ───────────────────────────────────────────────────────────

function LeaseRow({ lease, onClick }: { lease: Lease; onClick: () => void }) {
  const meta  = STATUS_META[lease.status] ?? STATUS_META.draft;
  const days  = daysLeft(lease.endDate);
  const escPct = Math.round(Number(lease.escalationRate) * 100);

  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
    >
      {/* Left: tenant + property */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-foreground truncate">{lease.tenantName}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.color}`}>
            {meta.icon}{meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Home className="w-3 h-3" />
          <span>{lease.propertyName} · Unit {lease.unitNumber}</span>
          <span className="text-border">·</span>
          <span className="font-mono">{lease.leaseNumber}</span>
        </div>
      </div>

      {/* Centre: dates */}
      <div className="hidden sm:flex flex-col items-center text-xs text-muted-foreground w-36">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{fmtDate(lease.startDate)}</span>
        </div>
        <div className="text-[10px] text-border my-0.5">→</div>
        <div className="flex items-center gap-1">
          {lease.status === "active" && urgencyTag(days)}
          <span>{fmtDate(lease.endDate)}</span>
        </div>
      </div>

      {/* Right: rent + escalation */}
      <div className="hidden md:flex flex-col items-end text-xs w-36">
        <span className="font-semibold text-foreground text-sm">{fmtKES(lease.monthlyRent, lease.currency)}</span>
        <span className="text-muted-foreground">/month · +{escPct}% p.a.</span>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  );
}

// ─── Create lease dialog ──────────────────────────────────────────────────────

function CreateLeaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tenantId: "", startDate: "", endDate: "", monthlyRent: "",
    securityDeposit: "", depositPaidDate: "", escalationRate: "0.1",
    leaseDurationMonths: "", specialConditions: "",
    rentStructure: "fixed", percentageRentRate: "", unitId: "",
  });

  const { data: tenantsRaw } = useQuery<any>({
    queryKey: ["/api/tenants"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/tenants")).json()),
  });
  const tenants: any[] = Array.isArray(tenantsRaw) ? tenantsRaw : (tenantsRaw?.results ?? []);
  const pickedTenant = tenants.find((t: any) => String(t.id) === form.tenantId);
  // a tenant who is not in a unit yet (or has left) needs one chosen; a placed tenant's lease is for their own unit
  const needsUnit = !!pickedTenant && (!pickedTenant.unit?.id || pickedTenant.status === "inactive");
  const { data: vacant = [] } = useQuery<any[]>({
    queryKey: ["/api/units/vacant"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/units/vacant")).json()),
    enabled: open && needsUnit,
  });

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/leases", {
        method: "POST",
        data: {
          tenantId:           parseInt(form.tenantId),
          unitId:             needsUnit && form.unitId ? parseInt(form.unitId) : undefined,
          startDate:          form.startDate,
          endDate:            form.endDate,
          monthlyRent:        parseFloat(form.monthlyRent),
          securityDeposit:    parseFloat(form.securityDeposit || "0"),
          depositPaidDate:    form.depositPaidDate || undefined,
          escalationRate:     parseFloat(form.escalationRate),
          leaseDurationMonths: form.leaseDurationMonths ? parseInt(form.leaseDurationMonths) : undefined,   // blank = worked out from the dates
          specialConditions:  form.specialConditions || undefined,
          rentStructure:      form.rentStructure,
          percentageRentRate: form.rentStructure !== "fixed" ? parseFloat(form.percentageRentRate || "0") / 100 : undefined,
        },
      });
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Lease created", description: "Draft lease created successfully." });
      // Show compliance warnings returned by the server
      if (data?.complianceWarnings?.length) {
        data.complianceWarnings.forEach((w: string) =>
          toast({ title: "Compliance Warning", description: w, variant: "destructive", duration: 12000 })
        );
      }
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to create lease", description: parseErr(e).message, variant: "destructive" }),
  });

  const field = (key: keyof typeof form, label: string, type = "text", placeholder = "") => (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="h-9"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Lease</DialogTitle>
          <DialogDescription>Create a draft lease agreement. You can send it for signing once complete.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Tenant select */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Tenant</Label>
            <SearchableSelect
              className="h-9"
              value={form.tenantId}
              onValueChange={v => setForm(f => ({ ...f, tenantId: v }))}
              placeholder="Select tenant…"
              searchPlaceholder="Search by name, unit, email or phone…"
              options={tenantOptions(tenants)}
            />
          </div>
          {needsUnit && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Unit <span className="text-red-500">*</span></Label>
              <SearchableSelect
                className="h-9"
                value={form.unitId}
                onValueChange={v => setForm(f => ({ ...f, unitId: v }))}
                placeholder="Select a vacant unit…"
                searchPlaceholder="Search units…"
                options={unitOptions(vacant, undefined, { showOccupancy: false })}
              />
              <p className="text-[11px] text-muted-foreground">This tenant is not in a unit yet. Activating the lease moves them in.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {field("startDate", "Start date", "date")}
            {field("endDate", "End date", "date")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("monthlyRent", "Monthly rent (KES)", "number", "e.g. 45000")}
            {field("leaseDurationMonths", "Term (months)", "number", "Worked out from the dates")}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Rent structure</Label>
            <Select value={form.rentStructure} onValueChange={v => setForm(f => ({ ...f, rentStructure: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed — monthly rent above only</SelectItem>
                <SelectItem value="percentage_of_sales">Percentage of sales only (turnover rent)</SelectItem>
                <SelectItem value="base_plus_percentage">Base rent + percentage of sales</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Percentage options are for retail/mall tenants billed on reported sales — standard for anchor and specialty tenants.
            </p>
          </div>
          {form.rentStructure !== "fixed" && (
            field("percentageRentRate", "Percentage of sales (%)", "number", "e.g. 6")
          )}
          <div className="grid grid-cols-2 gap-3">
            {field("securityDeposit", "Security deposit (KES)", "number", "e.g. 90000")}
            {field("depositPaidDate", "Deposit paid date", "date")}
          </div>
          {/* ── Compliance: deposit cap warning (residential tenancies only) ── */}
          {(() => {
            const rent    = parseFloat(form.monthlyRent  || "0");
            const deposit = parseFloat(form.securityDeposit || "0");
            const selectedTenant = tenants.find((t: any) => String(t.id) === form.tenantId);
            // Default to showing the warning when the tenant's unit type isn't known yet
            // (no tenant picked) — safer to over-warn than silently skip it.
            const isResidentialTenancy = !selectedTenant?.unit?.unitType
              || RESIDENTIAL_UNIT_TYPES.includes(selectedTenant.unit.unitType);
            if (isResidentialTenancy && rent > 0 && deposit > rent * 2) {
              return (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangleIc className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>Deposit exceeds legal cap.</strong> The Landlord and Tenant Act limits security deposits to
                    2 months' rent for residential tenancies (<strong>KES {(rent * 2).toLocaleString()}</strong>). Entered amount may expose the landlord
                    to a legal dispute — please verify before proceeding.
                  </span>
                </div>
              );
            }
            return null;
          })()}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Annual escalation rate</Label>
            <Select value={form.escalationRate} onValueChange={v => setForm(f => ({ ...f, escalationRate: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0.05">5% (below market)</SelectItem>
                <SelectItem value="0.08">8%</SelectItem>
                <SelectItem value="0.10">10% (Nairobi standard)</SelectItem>
                <SelectItem value="0.12">12%</SelectItem>
                <SelectItem value="0.15">15%</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Applied automatically on each renewal.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Special conditions</Label>
            <Textarea
              placeholder="e.g. Tenant responsible for KPLC token top-ups…"
              rows={3}
              value={form.specialConditions}
              onChange={e => setForm(f => ({ ...f, specialConditions: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.tenantId || !form.startDate || !form.endDate || !form.monthlyRent || (needsUnit && !form.unitId) || form.endDate <= form.startDate}
          >
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deposit dialog ───────────────────────────────────────────────────────────

function DepositDialog({ lease, open, onClose }: { lease: Lease; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    transactionType: "received", amount: "",
    reason: "", reference: "", transactionDate: new Date().toISOString().split("T")[0],
  });

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/leases/${lease.id}/deposit`, {
        method: "POST",
        data: { ...form, amount: parseFloat(form.amount) },
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      qc.invalidateQueries({ queryKey: [`/api/leases/${lease.id}`] });
      qc.invalidateQueries({ queryKey: [`/api/leases/${lease.id}/deposit`] });
      qc.invalidateQueries({ queryKey: [`/api/leases/${lease.id}/events`] });
      toast({ title: "Deposit recorded" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't record that", description: parseErr(e).message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record Deposit Transaction</DialogTitle>
          <DialogDescription>
            Deposit balance: {fmtKES(lease.depositBalance ?? 0, lease.currency)}.
            {["active", "pending_signature", "draft"].includes(lease.status)
              ? " Refunds and forfeits become available once the lease has ended."
              : lease.status === "terminated" || lease.status === "expired" ? " To clear rent, bills and damages in one go, use Settle deposit." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Transaction type</Label>
            <Select value={form.transactionType} onValueChange={v => setForm(f => ({ ...f, transactionType: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">Received</SelectItem>
                {["terminated", "expired"].includes(lease.status) && <>
                  <SelectItem value="refunded">Full refund</SelectItem>
                  <SelectItem value="partial_refund">Partial refund</SelectItem>
                  <SelectItem value="forfeited">Forfeited (damage/arrears)</SelectItem>
                </>}
                <SelectItem value="adjustment">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Amount ({lease.currency})</Label>
            <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Date</Label>
            <Input type="date" max={new Date().toISOString().split("T")[0]} value={form.transactionDate} onChange={e => setForm(f => ({ ...f, transactionDate: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reason <span className="text-red-500">*</span></Label>
            <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Damage to bathroom tiles" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reference / receipt</Label>
            <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Optional" className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !form.amount || !form.reason}>
            {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Move-out settlement dialog ───────────────────────────────────────────────

interface Settlement {
  canSettle: boolean; alreadySettled: boolean; leaseStatus: string; currency: string;
  depositHeld: number;
  unpaidRent: { id: number; label: string; dueDate: string; balance: number }[];
  unpaidUtilities: { id: number; label: string; type: string | null; dueDate: string; balance: number }[];
  unpaidRentTotal: number; unpaidUtilitiesTotal: number;
  upcomingInvoices: { count: number; total: number };
  inspection: { id: number; number: string; status: string; signedByManager: boolean; recommendedDeduction: number; totalIssuesCost: number; issueCount: number } | null;
  suggested: { arrears: number; damages: number; refund: number; shortfall: number };
}

function SettleDepositDialog({ lease, open, onClose }: { lease: Lease; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery<Settlement>({
    queryKey: [`/api/leases/${lease.id}/settlement`],
    queryFn: async () => (await apiRequest(`/api/leases/${lease.id}/settlement`)).json(),
    enabled: open,
  });
  const [applyArrears, setApplyArrears] = useState(true);
  const [refund, setRefund] = useState(true);
  const [damage, setDamage] = useState<{ amount: string; reason: string }>({ amount: "", reason: "" });
  const [other, setOther] = useState<{ amount: string; reason: string }>({ amount: "", reason: "" });
  const [prefilled, setPrefilled] = useState(false);
  const [reference, setReference] = useState("");

  // start from what the move-out inspection recommended (the manager can change it)
  useEffect(() => {
    if (!s || prefilled) return;
    setPrefilled(true);
    if (s.inspection && s.inspection.recommendedDeduction > 0) {
      setDamage({ amount: String(s.inspection.recommendedDeduction), reason: `Damage found at move-out inspection ${s.inspection.number}` });
    }
  }, [s, prefilled]);

  const held = s?.depositHeld ?? 0;
  const dueTotal = (s?.unpaidRentTotal ?? 0) + (s?.unpaidUtilitiesTotal ?? 0);
  const arrears = applyArrears ? Math.min(held, dueTotal) : 0;
  const dmg = Math.max(0, Math.min(Number(damage.amount) || 0, held - arrears));
  const oth = Math.max(0, Math.min(Number(other.amount) || 0, held - arrears - dmg));
  const remainder = Math.max(0, held - arrears - dmg - oth);
  const shortfall = Math.max(0, dueTotal - arrears);
  const cur = s?.currency ?? lease.currency;
  const tooMuch = (Number(damage.amount) || 0) + (Number(other.amount) || 0) > held - arrears + 0.005;
  const missingReason = (Number(damage.amount) > 0 && !damage.reason.trim()) || (Number(other.amount) > 0 && !other.reason.trim());

  const mut = useMutation({
    mutationFn: async () => {
      const deductions = [
        ...(Number(damage.amount) > 0 ? [{ category: "damages", amount: Number(damage.amount), reason: damage.reason.trim() }] : []),
        ...(Number(other.amount) > 0 ? [{ category: "other", amount: Number(other.amount), reason: other.reason.trim() }] : []),
      ];
      const r = await apiRequest(`/api/leases/${lease.id}/settle-deposit`, {
        method: "POST", data: { applyToArrears: applyArrears, deductions, refund, reference: reference.trim() || undefined },
      });
      return r.json();
    },
    onSuccess: (r: any) => {
      for (const k of ["/api/leases", `/api/leases/${lease.id}`, `/api/leases/${lease.id}/deposit`, `/api/leases/${lease.id}/events`, `/api/leases/${lease.id}/settlement`, "/api/rent-payments", "/api/utility-bills"]) qc.invalidateQueries({ queryKey: [k] });
      toast({
        title: "Deposit settled",
        description: `Rent ${fmtKES(r.rentApplied, cur)} · bills ${fmtKES(r.utilitiesApplied, cur)} · deductions ${fmtKES((r.deductions ?? []).reduce((a: number, d: any) => a + d.amount, 0), cur)} · refunded ${fmtKES(r.refunded, cur)}.` +
          (r.shortfall > 0 ? ` Still owed by the tenant: ${fmtKES(r.shortfall, cur)}.` : ""),
        duration: 12000,
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't settle the deposit", description: parseErr(e).message, variant: "destructive" }),
  });

  const row = (label: string, value: string, tone = "") => (
    <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className={`font-semibold tabular-nums ${tone}`}>{value}</span></div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settle security deposit</DialogTitle>
          <DialogDescription>{lease.leaseNumber} · {lease.tenantName}. Deposit held, less rent and bills still owed, less damage deductions; the rest goes back to the tenant.</DialogDescription>
        </DialogHeader>

        {isLoading || !s ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : s.alreadySettled ? (
          <p className="text-sm text-muted-foreground py-6 text-center">This deposit has already been settled. See the Deposit Ledger and Audit Trail for the breakdown.</p>
        ) : !s.canSettle ? (
          <p className="text-sm text-muted-foreground py-6 text-center">End the tenancy first (Terminate), then settle the deposit.</p>
        ) : (
          <div className="space-y-4 py-1">
            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
              {row("Deposit held", fmtKES(held, cur), "text-emerald-700 dark:text-emerald-400")}
              {row(`Unpaid rent (${s.unpaidRent.length} invoice${s.unpaidRent.length === 1 ? "" : "s"})`, fmtKES(s.unpaidRentTotal, cur), s.unpaidRentTotal > 0 ? "text-rose-600" : "")}
              {row(`Unpaid utility bills (${s.unpaidUtilities.length})`, fmtKES(s.unpaidUtilitiesTotal, cur), s.unpaidUtilitiesTotal > 0 ? "text-rose-600" : "")}
              {s.upcomingInvoices.count > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">{s.upcomingInvoices.count} invoice(s) worth {fmtKES(s.upcomingInvoices.total, cur)} are not due yet and are left alone — cancel them if the tenant has gone.</p>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={applyArrears} onCheckedChange={v => setApplyArrears(v === true)} className="mt-0.5" disabled={dueTotal <= 0} />
              <span>Apply the deposit to unpaid rent and bills first (oldest first). Invoices are marked paid and the payment shows in the ledger and reports.</span>
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Damage deductions</Label>
                {s.inspection ? (
                  <span className="text-[11px] text-muted-foreground">
                    Inspection {s.inspection.number}: recommended {fmtKES(s.inspection.recommendedDeduction, cur)}
                    {!s.inspection.signedByManager && " · not yet signed"}
                  </span>
                ) : <span className="text-[11px] text-muted-foreground">No move-out inspection on file</span>}
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <Input type="number" min={0} placeholder="Amount" className="h-9" value={damage.amount} onChange={e => setDamage(d => ({ ...d, amount: e.target.value }))} />
                <Input placeholder="What for (e.g. broken tiles)" className="h-9" value={damage.reason} onChange={e => setDamage(d => ({ ...d, reason: e.target.value }))} />
              </div>
              <Label className="text-xs font-medium">Other deductions (cleaning, keys…)</Label>
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <Input type="number" min={0} placeholder="Amount" className="h-9" value={other.amount} onChange={e => setOther(d => ({ ...d, amount: e.target.value }))} />
                <Input placeholder="What for" className="h-9" value={other.reason} onChange={e => setOther(d => ({ ...d, reason: e.target.value }))} />
              </div>
              {tooMuch && <p className="text-[11px] text-amber-700 dark:text-amber-400">Deductions are capped at what is left of the deposit after rent and bills.</p>}
            </div>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={refund} onCheckedChange={v => setRefund(v === true)} className="mt-0.5" />
              <span>Refund the remainder to the tenant now (untick to keep it held).</span>
            </label>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Refund reference (M-Pesa / cheque no.)</Label>
              <Input className="h-9" placeholder="Optional" value={reference} onChange={e => setReference(e.target.value)} />
            </div>

            <div className="rounded-lg border p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Result</p>
              {row("Applied to rent and bills", fmtKES(arrears, cur))}
              {row("Deductions", fmtKES(dmg + oth, cur))}
              {row(refund ? "Refunded to tenant" : "Stays held", fmtKES(remainder, cur), "text-emerald-700 dark:text-emerald-400")}
              {shortfall > 0.005 && row("Still owed by the tenant", fmtKES(shortfall, cur), "text-rose-600")}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {s?.canSettle && !s.alreadySettled && (
            <Button onClick={() => mut.mutate()} disabled={mut.isPending || missingReason || held <= 0}>
              {mut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Settle deposit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Lease detail sheet ───────────────────────────────────────────────────────

function LeaseDetailSheet({ lease: listLease, open, onClose }: { lease: Lease | null; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const canManageLeases = ["admin", "manager", "landlord"].includes(user?.role ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "events" | "deposit">("overview");
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [terminateReason, setTerminateReason] = useState("");
  const [terminationDate, setTerminationDate] = useState("");
  const [showTerminate, setShowTerminate] = useState(false);
  const [showRRT, setShowRRT] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [confirmUnsigned, setConfirmUnsigned] = useState<string | null>(null);

  // the list row has no renewal / scheduled-termination info and goes stale after every action: read the lease itself
  const { data: detail } = useQuery<Lease>({
    queryKey: [`/api/leases/${listLease?.id}`],
    queryFn: async () => (await apiRequest(`/api/leases/${listLease!.id}`)).json(),
    enabled: !!listLease && open,
  });
  const lease: Lease | null = listLease ? { ...listLease, ...(detail ?? {}) } : null;
  const refresh = () => {
    for (const k of ["/api/leases", `/api/leases/${listLease?.id}`, `/api/leases/${listLease?.id}/events`, `/api/leases/${listLease?.id}/deposit`]) qc.invalidateQueries({ queryKey: [k] });
  };

  const { data: events = [] } = useQuery<LeaseEvent[]>({
    queryKey: [`/api/leases/${listLease?.id}/events`],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/leases/${listLease!.id}/events`)).json()),
    enabled: !!listLease && open && tab === "events",
  });

  const { data: deposit } = useQuery<DepositLedger>({
    queryKey: [`/api/leases/${listLease?.id}/deposit`],
    queryFn: async () => (await apiRequest(`/api/leases/${listLease!.id}/deposit`)).json(),
    enabled: !!listLease && open && tab === "deposit",
  });

  // Each step keeps the drawer open and refreshes it, so signing twice and activating is one visit, not three.
  const action = (endpoint: string, body: Record<string, any> = {}, label = "", then?: (r: any) => void) =>
    useMutation({
      mutationFn: async () => (await apiRequest(`/api/leases/${listLease!.id}/${endpoint}`, { method: "POST", data: body })).json(),
      onSuccess: (r: any) => { refresh(); toast({ title: label || "Done" }); then?.(r); },
      onError: (e: any) => {
        const { message, code } = parseErr(e);
        if (endpoint === "activate" && code === "UNSIGNED") { setConfirmUnsigned(message); return; }
        toast({ title: "Couldn't do that", description: message, variant: "destructive" });
      },
    });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const sendMut     = action("send-for-signing", {}, "Sent for signing");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const signTenant  = action("sign", { signer: "tenant" }, "Tenant signature recorded");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const signManager = action("sign", { signer: "manager" }, "Manager signature recorded");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const activateMut = action("activate", {}, "Lease activated", () => { setConfirmUnsigned(null); });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const activatePaperMut = action("activate", { confirmUnsigned: true }, "Lease activated on the paper copy", () => { setConfirmUnsigned(null); });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const cancelTermMut = action("cancel-termination", {}, "Scheduled termination cancelled");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const renewMut = useMutation({
    mutationFn: async () => (await apiRequest(`/api/leases/${listLease!.id}/renew`, { method: "POST", data: {} })).json(),
    onSuccess: (data: any) => {
      refresh();
      toast({
        title: "Renewal draft created",
        description: `${data?.newLease?.leaseNumber ?? "The renewal"} starts ${fmtDate(data?.newLease?.startDate)}. This lease stays active until the renewal is signed and activated.`,
        duration: 9000,
      });
      data?.complianceWarnings?.forEach((w: string) => toast({ title: "Compliance Warning", description: w, variant: "destructive", duration: 12000 }));
    },
    onError: (e: any) => toast({ title: "Couldn't renew", description: parseErr(e).message, variant: "destructive" }),
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const terminateMut = useMutation({
    mutationFn: async () => (await apiRequest(`/api/leases/${listLease!.id}/terminate`, {
      method: "POST", data: { reason: terminateReason, terminationDate: terminationDate || undefined },
    })).json(),
    onSuccess: (data: any) => {
      refresh();
      setShowTerminate(false); setTerminateReason(""); setTerminationDate("");
      if (data?.scheduled) {
        toast({ title: "Termination scheduled", description: `The tenancy ends automatically on ${fmtDate(data.terminationDate)}. Until then the tenant keeps access and rent keeps billing.`, duration: 9000 });
      } else {
        toast({ title: "Tenancy ended", description: "Lease terminated, unit vacated, tenant login switched off." });
        const st = data?.settlement;
        if (st && (st.depositHeld > 0 || st.unpaidRent > 0 || st.unpaidUtilities > 0)) setShowSettle(true);   // straight on to the move-out money
      }
      data?.complianceWarnings?.forEach((w: string) => toast({ title: "Compliance Warning", description: w, variant: "destructive", duration: 12000 }));
    },
    onError: (e: any) => toast({ title: "Couldn't terminate", description: parseErr(e).message, variant: "destructive" }),
  });

  if (!lease) return null;

  const meta = STATUS_META[lease.status] ?? STATUS_META.draft;
  const days = daysLeft(lease.endDate);
  const escPct = Math.round(Number(lease.escalationRate) * 100);

  return (
    <>
      <Sheet open={open} onOpenChange={v => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-primary" />
              {lease.leaseNumber}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.color}`}>
                {meta.icon}{meta.label}
              </span>
            </SheetTitle>
          </SheetHeader>

          {/* Tabs */}
          <Tabs value={tab} onValueChange={v => setTab(v as any)}>
            <TabsList className="w-full mb-4">
              <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
              <TabsTrigger value="events"   className="flex-1 text-xs">Audit Trail</TabsTrigger>
              <TabsTrigger value="deposit"  className="flex-1 text-xs">Deposit Ledger</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="space-y-5 mt-0">
              {/* Key info grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Tenant</p>
                  <p className="text-sm font-semibold">{lease.tenantName}</p>
                  <p className="text-xs text-muted-foreground">{lease.tenantEmail}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Property</p>
                  <p className="text-sm font-semibold">{lease.propertyName}</p>
                  <p className="text-xs text-muted-foreground">Unit {lease.unitNumber}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Lease term</p>
                  <p className="text-sm font-semibold">{fmtDate(lease.startDate)} → {fmtDate(lease.endDate)}</p>
                  {lease.status === "active" && (
                    <p className="text-xs mt-0.5">{urgencyTag(days)}</p>
                  )}
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Monthly rent</p>
                  <p className="text-sm font-semibold">{fmtKES(lease.monthlyRent, lease.currency)}</p>
                  <p className="text-xs text-muted-foreground">+{escPct}% annual escalation</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Security deposit</p>
                  <p className="text-sm font-semibold">{fmtKES(lease.securityDeposit, lease.currency)}</p>
                  <p className="text-xs text-muted-foreground">Balance: {fmtKES(lease.depositBalance ?? 0, lease.currency)}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Signatures</p>
                  <p className="text-xs">
                    Tenant: {lease.signedByTenantAt ? <span className="text-emerald-600 font-medium"><CheckIc className="inline h-3 w-3 mr-0.5" />{fmtDate(lease.signedByTenantAt)}</span> : <span className="text-muted-foreground">Pending</span>}
                  </p>
                  <p className="text-xs">
                    Manager: {lease.signedByManagerAt ? <span className="text-emerald-600 font-medium"><CheckIc className="inline h-3 w-3 mr-0.5" />{fmtDate(lease.signedByManagerAt)}</span> : <span className="text-muted-foreground">Pending</span>}
                  </p>
                </div>
              </div>

              {lease.specialConditions && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Special conditions</p>
                  <p className="text-sm text-foreground bg-muted/40 rounded-lg p-3 leading-relaxed">{lease.specialConditions}</p>
                </div>
              )}

              {lease.status === "active" && lease.scheduledTermination && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 flex items-start justify-between gap-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    <strong>Termination scheduled for {fmtDate(lease.scheduledTermination.date)}.</strong>{" "}
                    The tenant stays until then; the system ends the tenancy that day.
                    {lease.scheduledTermination.reason ? ` Reason: ${lease.scheduledTermination.reason}` : ""}
                  </p>
                  {canManageLeases && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => cancelTermMut.mutate()} disabled={cancelTermMut.isPending}>Cancel it</Button>
                  )}
                </div>
              )}
              {lease.status === "expired" && (
                <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-3 text-xs text-orange-800 dark:text-orange-300">
                  <strong>This lease has expired</strong> and the tenant is holding over. Renew it, or terminate it when they move out.
                </div>
              )}
              {lease.renewal && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-800 dark:text-blue-300">
                  <strong>Renewal {lease.renewal.leaseNumber}</strong> is {lease.renewal.status.replace("_", " ")}.
                  {lease.status !== "renewed" && " This lease stays active until the renewal is signed and activated."}
                </div>
              )}

              {/* Renewal preview */}
              {lease.status === "active" && !lease.renewal && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-100 dark:border-blue-900" >
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Renewal projection
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    On renewal, rent escalates from{" "}
                    <strong>{fmtKES(lease.monthlyRent, lease.currency)}</strong> to{" "}
                    <strong>{fmtKES(Number(lease.monthlyRent) * (1 + Number(lease.escalationRate)), lease.currency)}</strong>{" "}
                    ({escPct}% increase).
                  </p>
                </div>
              )}

              <Separator />

              {/* Actions */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Actions</p>
                <div className="flex flex-wrap gap-2">
                  {canManageLeases && lease.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => sendMut.mutate()} disabled={sendMut.isPending}>
                      {sendMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                      Send for Signing
                    </Button>
                  )}
                  {canManageLeases && lease.status === "pending_signature" && !lease.signedByTenantAt && (
                    <Button size="sm" variant="outline" onClick={() => signTenant.mutate()} disabled={signTenant.isPending}>
                      <PenLine className="w-3.5 h-3.5 mr-1.5 text-violet-500" />Record Tenant Signature
                    </Button>
                  )}
                  {canManageLeases && lease.status === "pending_signature" && !lease.signedByManagerAt && (
                    <Button size="sm" variant="outline" onClick={() => signManager.mutate()} disabled={signManager.isPending}>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-violet-500" />Record Manager Signature
                    </Button>
                  )}
                  {canManageLeases && ["draft", "pending_signature"].includes(lease.status) && (
                    <Button size="sm" onClick={() => activateMut.mutate()} disabled={activateMut.isPending}>
                      {activateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                      Activate
                    </Button>
                  )}
                  {canManageLeases && ["active", "expired"].includes(lease.status) && !lease.renewal && (
                    <Button size="sm" variant="outline" onClick={() => renewMut.mutate()} disabled={renewMut.isPending}>
                      {renewMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                      Draft Renewal (+{escPct}%)
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setShowDepositDialog(true)}>
                    <Banknote className="w-3.5 h-3.5 mr-1.5" />Deposit Transaction
                  </Button>
                  {["active", "renewed"].includes(lease.status) && (
                    <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300" onClick={() => setShowRRT(v => !v)}>
                      <Scale className="w-3.5 h-3.5 mr-1.5" />RRT Notice
                    </Button>
                  )}
                  {canManageLeases && ["active", "expired"].includes(lease.status) && !lease.scheduledTermination && (
                    <Button size="sm" variant="destructive" onClick={() => setShowTerminate(true)}>
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />Terminate
                    </Button>
                  )}
                  {canManageLeases && ["terminated", "expired"].includes(lease.status) && (
                    <Button size="sm" onClick={() => setShowSettle(true)}>
                      <Banknote className="w-3.5 h-3.5 mr-1.5" />Settle Deposit
                    </Button>
                  )}
                </div>
              </div>

              {/* Activating without both signatures: say what is missing, let staff confirm a paper copy */}
              {confirmUnsigned && (
                <div className="border border-amber-300 rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 space-y-2">
                  <p className="text-xs text-amber-800 dark:text-amber-300">{confirmUnsigned}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => activatePaperMut.mutate()} disabled={activatePaperMut.isPending}>
                      {activatePaperMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      I hold a signed paper copy — activate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmUnsigned(null)}>Back</Button>
                  </div>
                </div>
              )}

              {/* Terminate confirm */}
              {showTerminate && (
                <div className="border border-red-200 dark:border-red-900 rounded-lg p-3 bg-red-50 dark:bg-red-950/20 space-y-2">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">Confirm termination</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Termination date</Label>
                      <input
                        type="date"
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={terminationDate}
                        max={lease.status === "active" ? String(lease.endDate).split("T")[0] : new Date().toISOString().split("T")[0]}
                        onChange={e => setTerminationDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Today or earlier ends the tenancy now (lease, unit, tenant login). A later date only schedules it — the tenant keeps living and paying until that day, and you can cancel it.
                  </p>
                  {/* ── Compliance: 30-day notice warning ── */}
                  {(() => {
                    const tDate = terminationDate ? new Date(terminationDate) : new Date();
                    tDate.setHours(0, 0, 0, 0);
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const days = Math.round((tDate.getTime() - today.getTime()) / 86400000);
                    if (days < 30) {
                      return (
                        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                          <AlertTriangleIc className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>
                            <strong>Less than 30 days' notice.</strong> The Landlord and Tenant Act requires
                            30 days' notice for tenancy termination. Ensure you have a legal basis
                            (e.g. court order, mutual written agreement) before proceeding.
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <Textarea
                    placeholder="Reason for termination (required)…"
                    rows={2}
                    value={terminateReason}
                    onChange={e => setTerminateReason(e.target.value)}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={!terminateReason.trim() || terminateMut.isPending}
                      onClick={() => terminateMut.mutate()}>
                      {terminateMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      Confirm Termination
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowTerminate(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* RRT Notice Generator */}
              {showRRT && (
                <div className="mt-2">
                  <RRTNoticeGenerator
                    lease={{
                      id: lease.id,
                      leaseNumber: lease.leaseNumber,
                      tenantName: lease.tenantName,
                      unitNumber: lease.unitNumber,
                      propertyName: lease.propertyName,
                      propertyAddress: undefined,
                      monthlyRent: lease.monthlyRent,
                      currency: lease.currency,
                      status: lease.status,
                    }}
                  />
                </div>
              )}
            </TabsContent>

            {/* Audit trail */}
            <TabsContent value="events" className="mt-0">
              {events.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No events yet.</div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-1">
                    {events.map(ev => (
                      <div key={ev.id} className="flex gap-3 pl-8 relative">
                        <div className="absolute left-2.5 top-2 w-3 h-3 rounded-full bg-background border-2 border-border flex items-center justify-center">
                          {EVENT_ICON[ev.eventType] ?? <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />}
                        </div>
                        <div className="pb-4 min-w-0">
                          <p className="text-xs font-medium text-foreground leading-snug">{ev.description}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {ev.actorName} · {fmtDate(ev.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Deposit ledger */}
            <TabsContent value="deposit" className="mt-0 space-y-4">
              {deposit && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Original deposit</p>
                      <p className="text-lg font-bold">{fmtKES(deposit.originalDeposit, deposit.currency)}</p>
                      {(deposit.outstanding ?? 0) > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{fmtKES(deposit.outstanding!, deposit.currency)} not yet received</p>}
                    </div>
                    <div className={`rounded-lg p-3 ${deposit.currentBalance > 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-rose-50 dark:bg-rose-950/30"}`}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current balance</p>
                      <p className={`text-lg font-bold ${deposit.currentBalance > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700"}`}>
                        {fmtKES(deposit.currentBalance, deposit.currency)}
                      </p>
                    </div>
                  </div>

                  {deposit.transactions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No deposit transactions recorded.</p>
                  ) : (
                    <div className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            {["Date", "Type", "Amount", "Balance", "Reason"].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {deposit.transactions.map((tx, i) => {
                            const isCredit = ["received", "adjustment"].includes(tx.transactionType);
                            return (
                              <tr key={tx.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                                <td className="px-3 py-2 text-muted-foreground">{fmtDate(tx.transactionDate)}</td>
                                <td className="px-3 py-2 capitalize">{tx.transactionType.replace(/_/g, " ")}</td>
                                <td className={`px-3 py-2 font-semibold ${isCredit ? "text-emerald-600" : "text-rose-600"}`}>
                                  {isCredit ? "+" : "-"}{fmtKES(tx.amount, deposit.currency)}
                                </td>
                                <td className="px-3 py-2 font-mono">{fmtKES(tx.balanceAfter, deposit.currency)}</td>
                                <td className="px-3 py-2 text-muted-foreground break-words max-w-[120px]">{tx.reason}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setShowDepositDialog(true)}>
                      <Banknote className="w-3.5 h-3.5 mr-1.5" />Record Transaction
                    </Button>
                    {canManageLeases && ["terminated", "expired"].includes(lease.status) && (
                      <Button size="sm" onClick={() => setShowSettle(true)}>Settle Deposit</Button>
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {showDepositDialog && (
        <DepositDialog
          lease={lease}
          open={showDepositDialog}
          onClose={() => setShowDepositDialog(false)}
        />
      )}
      {showSettle && (
        <SettleDepositDialog
          lease={lease}
          open={showSettle}
          onClose={() => setShowSettle(false)}
        />
      )}
    </>
  );
}

// ─── Search + pagination toolbar (shared across tabs) ────────────────────────

function TabToolbar({
  search, onSearch,
  pageSize, onPageSize,
  page, totalPages, onPage,
  resultCount, totalCount,
}: {
  search: string; onSearch: (v: string) => void;
  pageSize: number; onPageSize: (v: number) => void;
  page: number; totalPages: number; onPage: (v: number) => void;
  resultCount: number; totalCount: number;
}) {
  return (
    <div className="px-5 pt-4 pb-3 border-b border-border space-y-2">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leases…"
            value={search}
            onChange={e => { onSearch(e.target.value); onPage(1); }}
            className="pl-9 h-9"
          />
          {search && (
            <button onClick={() => { onSearch(""); onPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <Select value={String(pageSize)} onValueChange={v => { onPageSize(Number(v)); onPage(1); }}>
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10 / page</SelectItem>
            <SelectItem value="25">25 / page</SelectItem>
            <SelectItem value="50">50 / page</SelectItem>
            <SelectItem value="100">100 / page</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {resultCount} of {totalCount}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onPage(page - 1)} disabled={page === 1}>‹ Prev</Button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onPage(page + 1)} disabled={page === totalPages}>Next ›</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Per-tab state hook ───────────────────────────────────────────────────────

function useTabState(defaultPageSize = 25) {
  const [search, setSearch]     = useState("");
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage]         = useState(1);
  return { search, setSearch, pageSize, setPageSize, page, setPage };
}

function applySearchAndPage<T extends Lease>(
  list: T[],
  search: string,
  page: number,
  pageSize: number,
) {
  let filtered = list;
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = list.filter(l =>
      l.tenantName.toLowerCase().includes(q) ||
      l.leaseNumber.toLowerCase().includes(q) ||
      l.propertyName?.toLowerCase().includes(q) ||
      l.unitNumber?.toLowerCase().includes(q)
    );
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paged      = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { paged, totalCount: filtered.length, totalPages, safePage };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LeasesPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  const { user } = useAuth();
  const role = user?.role ?? "";

  // ── Role guard ─────────────────────────────────────────────────────────────
  // Tenants and guards have no business on this page at all.
  const ALLOWED_ROLES = ["admin", "manager", "landlord", "staff"];
  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <XCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          You don't have permission to view lease agreements.
          Contact your property manager if you need a copy of your lease.
        </p>
      </div>
    );
  }

  // Staff are read-only (no create/mutate actions). Admin/manager/landlord can manage.
  const canManageLeases = ["admin", "manager", "landlord"].includes(role);
  // Landlords only see their own properties' leases (enforced server-side too).
  const isLandlord = role === "landlord";

  const [selectedLease, setSelectedLease] = useState<Lease | null>(null);
  const [showCreate, setShowCreate]       = useState(false);
  const [statusFilter, setStatusFilter]   = useState("all");

  // Per-tab search + pagination state
  const activeTab    = useTabState();
  const expiringTab  = useTabState();
  const draftsTab    = useTabState();
  const allTab       = useTabState();

  // Fetch all leases — server enforces landlord scope via ownerId filter
  const queryKey = isLandlord
    ? ["/api/leases", { landlordScoped: true }]
    : ["/api/leases"];

  const { data: raw, isLoading } = useQuery<any>({
    queryKey,
    queryFn: async () => {
      const url = "/api/leases?limit=200&page=1";
      return (await apiRequest(url)).json();
    },
    staleTime: 60_000,
  });
  const leases: Lease[] = Array.isArray(raw) ? raw : (raw?.results ?? []);

  // Slice into logical groups
  const active   = leases.filter(l => l.status === "active");
  const expiring = active
    .filter(l => daysLeft(l.endDate) <= 90)
    .sort((a, b) => daysLeft(a.endDate) - daysLeft(b.endDate));
  const drafts   = leases.filter(l => ["draft", "pending_signature"].includes(l.status));

  const allFiltered = useMemo(() => {
    return statusFilter === "all" ? leases : leases.filter(l => l.status === statusFilter);
  }, [leases, statusFilter]);

  const totalActiveRent = active.reduce((s, l) => s + Number(l.monthlyRent), 0);
  const currency = active[0]?.currency ?? "KES";

  // Per-tab paged slices
  const activeView   = applySearchAndPage(active,      activeTab.search,   activeTab.page,   activeTab.pageSize);
  const expiringView = applySearchAndPage(expiring,    expiringTab.search, expiringTab.page, expiringTab.pageSize);
  const draftsView   = applySearchAndPage(drafts,      draftsTab.search,   draftsTab.page,   draftsTab.pageSize);
  const allView      = applySearchAndPage(allFiltered, allTab.search,      allTab.page,      allTab.pageSize);

  const exportLeaseExcel = () => downloadExcel(
    `leases-${todayStamp()}`,
    ["Lease #", "Tenant", "Property", "Unit", "Start", "End", "Monthly rent", "Deposit", "Status"],
    leases.map(l => [l.leaseNumber, l.tenantName, l.propertyName, l.unitNumber, l.startDate?.slice(0, 10), l.endDate?.slice(0, 10), Number(l.monthlyRent), Number(l.securityDeposit || 0), l.status]),
    "Leases");
  const exportLeasePdf = async () => {
    const list = [...leases].sort((a, b) => daysLeft(a.endDate) - daysLeft(b.endDate));
    await exportTablePdf({
      title: "Lease schedule",
      caption: "All leases with rent, deposit and expiry",
      docLabel: "LEASES",
      kpis: [
        { label: "Leases", value: leases.length },
        { label: "Active", value: active.length, tone: "green" },
        { label: "Monthly rent roll", value: money(totalActiveRent, currency), tone: "blue" },
        { label: "Expiring in 90 days", value: expiring.length, tone: "amber" },
      ],
      columns: [{ header: "Lease #" }, { header: "Tenant" }, { header: "Property / Unit" }, { header: "Start" }, { header: "End" }, { header: "Status" }, { header: "Rent (KES)", align: "right" }, { header: "Deposit (KES)", align: "right" }],
      rows: list.map(l => [l.leaseNumber, l.tenantName, `${l.propertyName} / ${l.unitNumber}`, new Date(l.startDate).toLocaleDateString("en-KE"), new Date(l.endDate).toLocaleDateString("en-KE"), l.status.replace(/_/g, " "), Number(l.monthlyRent).toLocaleString("en-KE"), Number(l.securityDeposit || 0).toLocaleString("en-KE")]),
      totals: ["", "", "", "", "", "Active rent roll", totalActiveRent.toLocaleString("en-KE"), ""],
      filename: `lease-schedule-${todayStamp()}`,
    });
  };

  return (
    <PageShell>
      <PageHeader
        title="Lease Management"
        subtitle={isLandlord
          ? "Your properties' lease agreements, renewals, escalations and deposits"
          : "Manage lease agreements, renewals, escalations and deposits"}
        icon={<FileText className="w-5 h-5" />}
        actions={<>
          <ExportMenu disabled={leases.length === 0} onPdf={exportLeasePdf} onExcel={exportLeaseExcel} />
          {canManageLeases && (
            <PrimaryButton icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              New Lease
            </PrimaryButton>
          )}
        </>}
      />

      {/* Stats */}
      <StatsGrid cols={4}>
        <StatTile
          label="Active leases"
          value={active.length}
          icon={<CheckCircle2 className="w-4 h-4" />}
          accent="emerald"
        />
        <StatTile
          label="Monthly rent roll"
          value={fmtKES(totalActiveRent, currency)}
          icon={<Banknote className="w-4 h-4" />}
          accent="blue"
        />
        <StatTile
          label="Expiring (90 days)"
          value={expiring.length}
          sub={expiring.filter(l => daysLeft(l.endDate) <= 30).length + " critical (≤30d)"}
          icon={<AlertTriangle className="w-4 h-4" />}
          accent="amber"
        />
        <StatTile
          label="Awaiting action"
          value={drafts.length}
          sub="drafts + pending signatures"
          icon={<PenLine className="w-4 h-4" />}
          accent="violet"
        />
      </StatsGrid>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active <Badge variant="secondary" className="ml-1.5 text-[10px]">{active.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="expiring">
            Expiring Soon
            {expiring.length > 0 && (
              <Badge className="ml-1.5 text-[10px] bg-amber-500 text-white">{expiring.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Drafts
            {drafts.length > 0 && (
              <Badge className="ml-1.5 text-[10px] bg-violet-500 text-white">{drafts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Leases</TabsTrigger>
        </TabsList>

        {/* Active */}
        <TabsContent value="active">
          <SectionCard padding="none">
            <TabToolbar
              search={activeTab.search} onSearch={activeTab.setSearch}
              pageSize={activeTab.pageSize} onPageSize={activeTab.setPageSize}
              page={activeView.safePage} totalPages={activeView.totalPages} onPage={activeTab.setPage}
              resultCount={activeView.paged.length} totalCount={activeView.totalCount}
            />
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : activeView.paged.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {activeTab.search ? "No active leases match your search." : "No active leases."}
              </div>
            ) : (
              activeView.paged.map(l => <LeaseRow key={l.id} lease={l} onClick={() => setSelectedLease(l)} />)
            )}
          </SectionCard>
        </TabsContent>

        {/* Expiring */}
        <TabsContent value="expiring">
          <SectionCard padding="none">
            <TabToolbar
              search={expiringTab.search} onSearch={expiringTab.setSearch}
              pageSize={expiringTab.pageSize} onPageSize={expiringTab.setPageSize}
              page={expiringView.safePage} totalPages={expiringView.totalPages} onPage={expiringTab.setPage}
              resultCount={expiringView.paged.length} totalCount={expiringView.totalCount}
            />
            {expiringView.paged.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {expiringTab.search ? "No expiring leases match your search." : "No leases expiring within 90 days."}
              </div>
            ) : (
              expiringView.paged.map(l => <LeaseRow key={l.id} lease={l} onClick={() => setSelectedLease(l)} />)
            )}
          </SectionCard>
        </TabsContent>

        {/* Drafts */}
        <TabsContent value="drafts">
          <SectionCard padding="none">
            <TabToolbar
              search={draftsTab.search} onSearch={draftsTab.setSearch}
              pageSize={draftsTab.pageSize} onPageSize={draftsTab.setPageSize}
              page={draftsView.safePage} totalPages={draftsView.totalPages} onPage={draftsTab.setPage}
              resultCount={draftsView.paged.length} totalCount={draftsView.totalCount}
            />
            {draftsView.paged.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {draftsTab.search ? "No drafts match your search." : "No pending drafts."}
              </div>
            ) : (
              draftsView.paged.map(l => <LeaseRow key={l.id} lease={l} onClick={() => setSelectedLease(l)} />)
            )}
          </SectionCard>
        </TabsContent>

        {/* All */}
        <TabsContent value="all">
          <SectionCard padding="none">
            <div className="px-5 pt-4 pb-3 border-b border-border space-y-2">
              <div className="flex gap-2 items-center flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search leases…"
                    value={allTab.search}
                    onChange={e => { allTab.setSearch(e.target.value); allTab.setPage(1); }}
                    className="pl-9 h-9"
                  />
                  {allTab.search && (
                    <button onClick={() => { allTab.setSearch(""); allTab.setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); allTab.setPage(1); }}>
                  <SelectTrigger className="h-9 w-44">
                    <Filter className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending_signature">Pending signature</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="renewed">Renewed</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(allTab.pageSize)} onValueChange={v => { allTab.setPageSize(Number(v)); allTab.setPage(1); }}>
                  <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / page</SelectItem>
                    <SelectItem value="25">25 / page</SelectItem>
                    <SelectItem value="50">50 / page</SelectItem>
                    <SelectItem value="100">100 / page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {allView.totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Showing {allView.paged.length} of {allView.totalCount}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => allTab.setPage(allView.safePage - 1)} disabled={allView.safePage === 1}>‹ Prev</Button>
                    <span className="px-2">Page {allView.safePage} of {allView.totalPages}</span>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => allTab.setPage(allView.safePage + 1)} disabled={allView.safePage === allView.totalPages}>Next ›</Button>
                  </div>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allView.paged.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No leases found.</div>
            ) : (
              allView.paged.map(l => <LeaseRow key={l.id} lease={l} onClick={() => setSelectedLease(l)} />)
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {canManageLeases && (
        <CreateLeaseDialog open={showCreate} onClose={() => setShowCreate(false)} />
      )}
      <LeaseDetailSheet
        lease={selectedLease}
        open={!!selectedLease}
        onClose={() => setSelectedLease(null)}
      />
    </PageShell>
  );
}