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
 *   Actions: Send for Signing · Sign · Activate · Renew · Terminate
 *   Deposit: record received / refund / partial / forfeited
 */

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  draft:             { label: "Draft",           color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",    icon: <FileText className="w-3 h-3" /> },
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
  expired:           <Clock className="w-3.5 h-3.5 text-slate-500" />,
};

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

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent: string;
}) {
  return (
    <Card className="border-border">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Create lease dialog ──────────────────────────────────────────────────────

function CreateLeaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tenantId: "", startDate: "", endDate: "", monthlyRent: "",
    securityDeposit: "", depositPaidDate: "", escalationRate: "0.1",
    leaseDurationMonths: "12", specialConditions: "",
  });

  const { data: tenantsRaw } = useQuery<any>({
    queryKey: ["/api/tenants"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/tenants")).json()),
  });
  const tenants: any[] = Array.isArray(tenantsRaw) ? tenantsRaw : (tenantsRaw?.results ?? []);

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/leases", {
        method: "POST",
        data: {
          tenantId:           parseInt(form.tenantId),
          startDate:          form.startDate,
          endDate:            form.endDate,
          monthlyRent:        parseFloat(form.monthlyRent),
          securityDeposit:    parseFloat(form.securityDeposit || "0"),
          depositPaidDate:    form.depositPaidDate || undefined,
          escalationRate:     parseFloat(form.escalationRate),
          leaseDurationMonths: parseInt(form.leaseDurationMonths),
          specialConditions:  form.specialConditions || undefined,
        },
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Lease created", description: "Draft lease created successfully." });
      // Show compliance warnings returned by the server
      if (data?.complianceWarnings?.length) {
        data.complianceWarnings.forEach((w: string) =>
          toast({ title: "⚠️ Compliance Warning", description: w, variant: "destructive", duration: 12000 })
        );
      }
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to create lease", description: e.message, variant: "destructive" }),
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
            <Select value={form.tenantId} onValueChange={v => setForm(f => ({ ...f, tenantId: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select tenant…" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.firstName} {t.lastName} · {t.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field("startDate", "Start date", "date")}
            {field("endDate", "End date", "date")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("monthlyRent", "Monthly rent (KES)", "number", "e.g. 45000")}
            {field("leaseDurationMonths", "Term (months)", "number", "12")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("securityDeposit", "Security deposit (KES)", "number", "e.g. 90000")}
            {field("depositPaidDate", "Deposit paid date", "date")}
          </div>
          {/* ── Compliance: deposit cap warning ── */}
          {(() => {
            const rent    = parseFloat(form.monthlyRent  || "0");
            const deposit = parseFloat(form.securityDeposit || "0");
            if (rent > 0 && deposit > rent * 2) {
              return (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <span className="mt-0.5 shrink-0">⚠️</span>
                  <span>
                    <strong>Deposit exceeds legal cap.</strong> The Landlord and Tenant Act limits security deposits to
                    2 months' rent (<strong>KES {(rent * 2).toLocaleString()}</strong>). Entered amount may expose the landlord
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
            disabled={mut.isPending || !form.tenantId || !form.startDate || !form.endDate || !form.monthlyRent}
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
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      qc.invalidateQueries({ queryKey: [`/api/leases/${lease.id}/deposit`] });
      toast({ title: "Deposit recorded" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record Deposit Transaction</DialogTitle>
          <DialogDescription>Deposit balance: {fmtKES(lease.depositBalance ?? 0, lease.currency)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Transaction type</Label>
            <Select value={form.transactionType} onValueChange={v => setForm(f => ({ ...f, transactionType: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="refunded">Full refund</SelectItem>
                <SelectItem value="partial_refund">Partial refund</SelectItem>
                <SelectItem value="forfeited">Forfeited (damage/arrears)</SelectItem>
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
            <Input type="date" value={form.transactionDate} onChange={e => setForm(f => ({ ...f, transactionDate: e.target.value }))} className="h-9" />
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

// ─── Lease detail sheet ───────────────────────────────────────────────────────

function LeaseDetailSheet({ lease, open, onClose }: { lease: Lease | null; open: boolean; onClose: () => void }) {
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

  const { data: events = [] } = useQuery<LeaseEvent[]>({
    queryKey: [`/api/leases/${lease?.id}/events`],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/leases/${lease!.id}/events`)).json()),
    enabled: !!lease && open && tab === "events",
  });

  const { data: deposit } = useQuery<DepositLedger>({
    queryKey: [`/api/leases/${lease?.id}/deposit`],
    queryFn: async () => (await apiRequest(`/api/leases/${lease!.id}/deposit`)).json(),
    enabled: !!lease && open && tab === "deposit",
  });

  const action = (endpoint: string, body: Record<string, any> = {}, label = "") =>
    useMutation({
      mutationFn: async () => {
        const r = await apiRequest(`/api/leases/${lease!.id}/${endpoint}`, {
          method: "POST",
          data: body,
        });
        if (!r.ok) throw new Error((await r.json()).message);
        return r.json();
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/leases"] });
        toast({ title: label || "Done" });
        onClose();
      },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const sendMut     = action("send-for-signing", {}, "Sent for signing");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const signTenant  = action("sign", { signer: "tenant" }, "Tenant signature recorded");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const signManager = action("sign", { signer: "manager" }, "Manager signature recorded");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const activateMut = action("activate", {}, "Lease activated");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const renewMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/leases/${lease!.id}/renew`, {
        method: "POST",
        data: {},
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Renewal draft created" });
      if (data?.complianceWarnings?.length) {
        data.complianceWarnings.forEach((w: string) =>
          toast({ title: "⚠️ Compliance Warning", description: w, variant: "destructive", duration: 12000 })
        );
      }
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: (e as any).message, variant: "destructive" }),
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const terminateMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/leases/${lease!.id}/terminate`, {
        method: "POST",
        data: { reason: terminateReason, terminationDate: terminationDate || undefined },
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Lease terminated" });
      if (data?.complianceWarnings?.length) {
        data.complianceWarnings.forEach((w: string) =>
          toast({ title: "⚠️ Compliance Warning", description: w, variant: "destructive", duration: 12000 })
        );
      }
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: (e as any).message, variant: "destructive" }),
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
                    Tenant: {lease.signedByTenantAt ? <span className="text-emerald-600 font-medium">✓ {fmtDate(lease.signedByTenantAt)}</span> : <span className="text-muted-foreground">Pending</span>}
                  </p>
                  <p className="text-xs">
                    Manager: {lease.signedByManagerAt ? <span className="text-emerald-600 font-medium">✓ {fmtDate(lease.signedByManagerAt)}</span> : <span className="text-muted-foreground">Pending</span>}
                  </p>
                </div>
              </div>

              {lease.specialConditions && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Special conditions</p>
                  <p className="text-sm text-foreground bg-muted/40 rounded-lg p-3 leading-relaxed">{lease.specialConditions}</p>
                </div>
              )}

              {/* Renewal preview */}
              {lease.status === "active" && (
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
                  {canManageLeases && ["draft", "pending_signature"].includes(lease.status) && !lease.signedByTenantAt && (
                    <Button size="sm" variant="outline" onClick={() => signTenant.mutate()} disabled={signTenant.isPending}>
                      <PenLine className="w-3.5 h-3.5 mr-1.5 text-violet-500" />Tenant Signed
                    </Button>
                  )}
                  {canManageLeases && ["draft", "pending_signature"].includes(lease.status) && !lease.signedByManagerAt && (
                    <Button size="sm" variant="outline" onClick={() => signManager.mutate()} disabled={signManager.isPending}>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-violet-500" />Manager Signed
                    </Button>
                  )}
                  {canManageLeases && ["draft", "pending_signature"].includes(lease.status) && (
                    <Button size="sm" onClick={() => activateMut.mutate()} disabled={activateMut.isPending}>
                      {activateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                      Activate
                    </Button>
                  )}
                  {canManageLeases && lease.status === "active" && (
                    <Button size="sm" variant="outline" onClick={() => renewMut.mutate()} disabled={renewMut.isPending}>
                      {renewMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                      Renew (+{escPct}%)
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
                  {canManageLeases && lease.status === "active" && (
                    <Button size="sm" variant="destructive" onClick={() => setShowTerminate(true)}>
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />Terminate
                    </Button>
                  )}
                </div>
              </div>

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
                        onChange={e => setTerminationDate(e.target.value)}
                      />
                    </div>
                  </div>
                  {/* ── Compliance: 30-day notice warning ── */}
                  {(() => {
                    const tDate = terminationDate ? new Date(terminationDate) : new Date();
                    tDate.setHours(0, 0, 0, 0);
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const days = Math.round((tDate.getTime() - today.getTime()) / 86400000);
                    if (days < 30) {
                      return (
                        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                          <span className="shrink-0 mt-0.5">⚠️</span>
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
                                <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{tx.reason}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <Button size="sm" variant="outline" onClick={() => setShowDepositDialog(true)}>
                    <Banknote className="w-3.5 h-3.5 mr-1.5" />Record Transaction
                  </Button>
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
            placeholder="Search tenant, property, unit, lease no…"
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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Lease Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLandlord
              ? "Your properties' lease agreements, renewals, escalations and deposits"
              : "Manage lease agreements, renewals, escalations and deposits"}
          </p>
        </div>
        {canManageLeases && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />New Lease
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active leases"
          value={active.length}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          accent="bg-emerald-50 dark:bg-emerald-950/40"
        />
        <StatCard
          label="Monthly rent roll"
          value={fmtKES(totalActiveRent, currency)}
          icon={<Banknote className="w-5 h-5 text-blue-600" />}
          accent="bg-blue-50 dark:bg-blue-950/40"
        />
        <StatCard
          label="Expiring (90 days)"
          value={expiring.length}
          sub={expiring.filter(l => daysLeft(l.endDate) <= 30).length + " critical (≤30d)"}
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          accent="bg-amber-50 dark:bg-amber-950/40"
        />
        <StatCard
          label="Awaiting action"
          value={drafts.length}
          sub="drafts + pending signatures"
          icon={<PenLine className="w-5 h-5 text-violet-600" />}
          accent="bg-violet-50 dark:bg-violet-950/40"
        />
      </div>

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
          <Card className="border-border">
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
          </Card>
        </TabsContent>

        {/* Expiring */}
        <TabsContent value="expiring">
          <Card className="border-border">
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
          </Card>
        </TabsContent>

        {/* Drafts */}
        <TabsContent value="drafts">
          <Card className="border-border">
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
          </Card>
        </TabsContent>

        {/* All */}
        <TabsContent value="all">
          <Card className="border-border">
            <div className="px-5 pt-4 pb-3 border-b border-border space-y-2">
              <div className="flex gap-2 items-center flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tenant, property, unit, lease no…"
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
          </Card>
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
    </div>
  );
}