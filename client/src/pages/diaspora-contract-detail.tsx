/**
 * diaspora-contract-detail.tsx
 *
 * Standalone page for a single diaspora rent-to-own contract.
 * Route: /diaspora-rent-to-own/:id
 *
 * Replaces the dialog-within-dialog pattern. Each tab section
 * loads its own data independently on mount — no race conditions,
 * no waiting for other tabs to become active.
 */

import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ChevronLeft, Globe, MapPin, FileText, Users, Camera, Video,
  CreditCard, Award, Plus, Play, Upload, X, RefreshCw,
  DollarSign, Calendar, Clock, CheckCircle, AlertCircle,
  Building, QrCode, ArrowRight, Image as ImageIcon, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@shared/currency";
import {
  PageShell, PageHeader, SectionCard, EmptyState, PrimaryButton,
} from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (d: any) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};
const fmtMoney = (n: any, currency = "KES") =>
  `${currency} ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

const STAGE_COLORS: Record<string, string> = {
  planning:   "bg-slate-100 text-muted-foreground border-slate-200",
  foundation: "bg-amber-50 text-amber-700 border-amber-200",
  structure:  "bg-blue-50 text-blue-700 border-blue-200",
  roofing:    "bg-sky-50 text-sky-700 border-sky-200",
  finishing:  "bg-violet-50 text-violet-700 border-violet-200",
  completed:  "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STAGE_STRIP: Record<string, string> = {
  planning: "bg-emerald-50", foundation: "bg-emerald-100", structure: "bg-emerald-200",
  roofing: "bg-emerald-300", finishing: "bg-emerald-400", completed: "bg-emerald-500",
};

const CONSTRUCTION_STAGES = [
  { key: "planning", label: "Planning", icon: "📐" },
  { key: "foundation", label: "Foundation", icon: "🏗️" },
  { key: "structure", label: "Structure", icon: "🧱" },
  { key: "roofing", label: "Roofing", icon: "🏠" },
  { key: "finishing", label: "Finishing", icon: "🪟" },
  { key: "completed", label: "Completed", icon: "✅" },
];


// ── Invoice PDF download (print-to-PDF via browser) ─────────────────────────
function downloadInvoice(inv: any, contract: any) {
  const notes = (() => { try { return JSON.parse(inv.notes ?? "{}"); } catch { return {}; } })();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Invoice ${inv.invoiceNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a1a; padding: 48px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .brand { font-size: 22px; font-weight: 800; color: #059669; letter-spacing: -0.5px; }
    .brand span { color: #1a1a1a; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { font-size: 28px; font-weight: 800; color: #059669; letter-spacing: -0.5px; }
    .invoice-title p { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .divider { border: none; border-top: 2px solid #d1fae5; margin: 24px 0; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin-bottom: 8px; }
    .field { margin-bottom: 6px; }
    .field-label { font-size: 11px; color: #6b7280; }
    .field-value { font-size: 13px; font-weight: 600; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #f0fdf4; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #059669; border-bottom: 2px solid #d1fae5; }
    td { padding: 12px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    .amount-row td { font-weight: 700; font-size: 15px; background: #f0fdf4; color: #059669; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: capitalize;
      background: ${inv.status === "paid" ? "#d1fae5" : inv.status === "overdue" ? "#fee2e2" : "#fef3c7"};
      color: ${inv.status === "paid" ? "#065f46" : inv.status === "overdue" ? "#991b1b" : "#92400e"}; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print {
      body { padding: 24px; }
      @page { margin: 16mm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">Smart<span>Prop</span></div>
    <div class="invoice-title">
      <h1>INVOICE</h1>
      <p class="font-mono">${inv.invoiceNumber}</p>
    </div>
  </div>
  <hr class="divider"/>
  <div class="grid-2">
    <div>
      <p class="section-label">Bill To</p>
      <div class="field"><p class="field-value">${contract?.clientName ?? "—"}</p></div>
      <div class="field"><p class="field-label">Email</p><p class="field-value">${contract?.clientEmail ?? "—"}</p></div>
      <div class="field"><p class="field-label">Country</p><p class="field-value">${contract?.clientCountry ?? "—"}</p></div>
    </div>
    <div>
      <p class="section-label">Invoice Details</p>
      <div class="field"><p class="field-label">Contract</p><p class="field-value">DSP-${String(contract?.id ?? "").padStart(4,"0")}</p></div>
      <div class="field"><p class="field-label">Due Date</p><p class="field-value">${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-KE",{day:"2-digit",month:"short",year:"numeric"}) : "—"}</p></div>
      <div class="field"><p class="field-label">Status</p><span class="status-badge">${inv.status}</span></div>
      <div class="field"><p class="field-label">Payment Method</p><p class="field-value">${contract?.internationalProvider ?? "—"}</p></div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:55%">Description</th>
        <th>Period</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${inv.description ?? `${notes.periodLabel ?? "Monthly"} Installment`}</td>
        <td>${notes.periodLabel ?? "Monthly"}</td>
        <td style="text-align:right;font-family:monospace">${inv.currency ?? "KES"} ${Number(inv.totalAmount ?? 0).toLocaleString("en-KE",{minimumFractionDigits:2})}</td>
      </tr>
      <tr class="amount-row">
        <td colspan="2">Total Due</td>
        <td style="text-align:right;font-family:monospace">${inv.currency ?? "KES"} ${Number(inv.totalAmount ?? 0).toLocaleString("en-KE",{minimumFractionDigits:2})}</td>
      </tr>
    </tbody>
  </table>
  ${(() => {
    // Use live contract balance, not the stale snapshot in notes.
    // For pending invoices: show what the balance will be after payment.
    // For paid/other invoices: show the current remaining balance.
    const currentRemaining = Number(contract?.remainingBalance ?? 0);
    const invoiceAmount    = Number(inv.totalAmount ?? 0);
    const balanceAfter     = inv.status === "pending"
      ? Math.max(0, currentRemaining - invoiceAmount)
      : currentRemaining;
    const label = inv.status === "pending"
      ? "Balance after this payment"
      : "Current remaining balance";
    return `<p style="font-size:12px;color:#6b7280;margin-bottom:24px">${label}: <strong style="color:#111827">KES ${balanceAfter.toLocaleString("en-KE",{minimumFractionDigits:2})}</strong></p>`;
  })()}
  <div class="footer">
    <p>SmartProp · Diaspora Rent-to-Own Programme · Generated ${new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"})}</p>
    <p style="margin-top:4px">This is a computer-generated invoice and does not require a signature.</p>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DiasporaContractDetail() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  const [, params] = useRoute("/diaspora-rent-to-own/:id");
  const [, navigate] = useLocation();
  const contractId = Number(params?.id);
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── state ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("details");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [stagedPhotos, setStagedPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [stagedVideos, setStagedVideos] = useState<{ file: File; name: string }[]>([]);
  const [viewingCert, setViewingCert] = useState<any>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  // ── queries ───────────────────────────────────────────────────────────────
  const { data: contract, isLoading: loadingContract, refetch: refetchContract } = useQuery<any>({
    queryKey: ["/api/diaspora-contracts", contractId],
    queryFn: async () => {
      // Trigger a server-side balance recalc before fetching so stale contracts are fixed
      await apiRequest(`/api/diaspora-contracts/${contractId}/recalc-balance`, { method: "POST", data: {} }).catch(() => {});
      const r = await apiRequest(`/api/diaspora-contracts/${contractId}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!contractId && !guard.gate,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const { data: payments = [], refetch: refetchPayments } = useQuery<any[]>({
    queryKey: ["/api/diaspora-payments", { contractId }],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-payments?contractId=${contractId}`);
      if (!r.ok) return [];
      const d = await r.json();
      return (Array.isArray(d) ? d : d.results ?? []).filter((p: any) => p.diasporaContractId === contractId);
    },
    enabled: !!contractId && !guard.gate,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: invoices = [], isLoading: loadingInvoices, refetch: refetchInvoices } = useQuery<any[]>({
    queryKey: ["/api/diaspora-contracts", contractId, "invoices"],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-contracts/${contractId}/invoices`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!contractId && !guard.gate,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: updates = [], isLoading: loadingUpdates, refetch: refetchUpdates } = useQuery<any[]>({
    queryKey: ["/api/construction-updates", contractId],
    queryFn: async () => {
      const r = await apiRequest(`/api/construction-updates?diasporaContractId=${contractId}`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!contractId && !guard.gate,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  // ── mutations ─────────────────────────────────────────────────────────────
  const paymentMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/diaspora-payments", { method: "POST", data }),
    onSuccess: async () => {
      await refetchPayments();
      await refetchContract();
      setIsPaymentOpen(false);
      setActiveTab("payments");
      toast({ title: "Payment recorded", description: "The payment has been logged and posted to the general ledger." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/diaspora-contracts/${contractId}`, { method: "PATCH", data }),
    onSuccess: async () => {
      await refetchContract();
      setActiveTab("details");
      toast({ title: "Contract updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const uploadFiles = (files: File[]): Promise<string[]> =>
    Promise.all(files.map(f => new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f);
    })));

  const constructionMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/construction-updates", { method: "POST", data }),
    onSuccess: async () => {
      await refetchUpdates();
      await refetchContract();
      setIsUploadOpen(false);
      setStagedPhotos([]);
      setStagedVideos([]);
      toast({ title: "Update posted", description: "Construction progress shared with the client." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleGenerateInvoice = async () => {
    setGeneratingInvoice(true);
    try {
      const r = await apiRequest(`/api/diaspora-contracts/${contractId}/generate-invoice`, { method: "POST", data: {} });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
      await refetchInvoices();
      setActiveTab("invoices");
      toast({ title: "Invoice generated" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingInvoice(false);
    }
  };

  // ── guard ─────────────────────────────────────────────────────────────────
  if (guard.gate) return guard.gate;

  if (loadingContract) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (!contract) {
    return (
      <PageShell>
        <EmptyState
          icon={<Globe className="h-8 w-8 text-muted-foreground" />}
          title="Contract not found"
          description="This contract does not exist or you do not have access to it."
          action={{ label: "Back to contracts", onClick: () => navigate("/diaspora-rent-to-own") }}
        />
      </PageShell>
    );
  }

  const paymentPct = contract.totalPropertyValue > 0
    ? Math.min(100, (Number(contract.totalPaid) / Number(contract.totalPropertyValue)) * 100)
    : 0;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      {/* ── Header ── */}
      <PageHeader
        icon={<Globe className="h-5 w-5" />}
        title={contract.clientName}
        subtitle={`${contract.clientCountry} · Contract DSP-${String(contractId).padStart(4, "0")}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/diaspora-rent-to-own")}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" /> All Contracts
            </Button>
          </div>
        }
      />

      {/* ── Quick KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {[
          { label: "Total Value",    value: fmtMoney(contract.totalPropertyValue, contract.currency), color: "" },
          { label: "Down Payment",   value: fmtMoney(contract.downPayment, contract.currency),        color: "blue" },
          { label: "Paid to Date",   value: fmtMoney(contract.totalPaid, contract.currency),          color: "emerald" },
          { label: "Balance",        value: fmtMoney(contract.remainingBalance, contract.currency),   color: "" },
          { label: "Next Payment",   value: fmt(contract.nextPaymentDue),                             color: "amber" },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-xl border p-4 bg-card ${
            color === "emerald" ? "border-emerald-100 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20" :
            color === "amber"   ? "border-amber-100 dark:border-amber-900" :
            color === "blue"    ? "border-blue-100 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20" : "border-border"
          }`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
              color === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
              color === "amber"   ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            }`}>{label}</p>
            <p className={`text-base font-bold ${
              color === "emerald" ? "text-emerald-700 dark:text-emerald-300" :
              color === "amber"   ? "text-amber-700 dark:text-amber-300" : "text-foreground"
            }`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="mb-6 space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Payment progress</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{paymentPct.toFixed(1)}%</span>
        </div>
        <Progress value={paymentPct} className="h-2 [&>div]:bg-emerald-500" />
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 bg-muted/50">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
            Payments ({payments.length})
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices {loadingInvoices ? "" : `(${invoices.length})`}
          </TabsTrigger>
          <TabsTrigger value="construction">
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            Construction {loadingUpdates ? "" : `(${updates.length})`}
          </TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
        </TabsList>

        {/* ── DETAILS ── */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contact */}
            <SectionCard>
              <h3 className="font-semibold text-sm mb-4">Contact Information</h3>
              <div className="space-y-3 text-sm">
                {[
                  { icon: Users,    label: "Full Name",  value: contract.clientName },
                  { icon: FileText, label: "Email",      value: contract.clientEmail },
                  { icon: Users,    label: "Phone",      value: contract.clientPhone },
                  { icon: Users,    label: "WhatsApp",   value: contract.clientWhatsapp },
                  { icon: MapPin,   label: "Country",    value: contract.clientCountry },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">{label}</p>
                      <p className="font-medium truncate">{value || "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Contract terms */}
            <SectionCard>
              <h3 className="font-semibold text-sm mb-4">Contract Terms</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Payment Method",      value: contract.paymentMethod?.replace(/_/g, " ") },
                  { label: "Provider",            value: contract.internationalProvider },
                  { label: "Frequency",           value: contract.paymentFrequency?.replace(/_/g, "-") },
                  { label: "Duration",            value: `${contract.contractDurationMonths} months` },
                  { label: "Payments Made",       value: contract.paymentsMade ?? 0 },
                  { label: "Construction Status", value: contract.constructionStatus },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">{label}</p>
                    <p className="font-medium capitalize text-foreground">{String(value ?? "—")}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Next payment + generate invoice */}
          <SectionCard>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Next Installment</h3>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {fmtMoney(contract.monthlyInstallment, contract.currency)}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Due: {fmt(contract.nextPaymentDue)}
                  <span className="capitalize ml-2 text-xs">({contract.paymentFrequency?.replace(/_/g, " ")})</span>
                </p>
              </div>
              <Button
                onClick={handleGenerateInvoice}
                disabled={generatingInvoice}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {generatingInvoice ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {generatingInvoice ? "Generating..." : "Generate Invoice"}
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── INVOICES ── */}
        {/* ── PAYMENTS TAB ── */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Payment History</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                All recorded payments for this contract
              </p>
            </div>
            <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" size="sm">
                  <Plus className="h-3.5 w-3.5" /> Record Payment
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-emerald-600" /> Record Payment
                  </DialogTitle>
                  <DialogDescription>
                    Log a payment received for this contract. The amount will be posted to the General Ledger automatically.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4 mt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const data: any = Object.fromEntries(fd.entries());
                    paymentMutation.mutate({
                      diasporaContractId: contractId,
                      amount:            parseFloat(data.amount) || 0,
                      originalAmount:    parseFloat(data.originalAmount) || 0,
                      originalCurrency:  data.originalCurrency || "KES",
                      exchangeRate:      parseFloat(data.exchangeRate) || null,
                      processingFee:     parseFloat(data.processingFee) || 0,
                      exchangeFee:       parseFloat(data.exchangeFee) || 0,
                      paymentMethod:     data.paymentMethod,
                      internationalProvider: data.internationalProvider,
                      providerTransactionId: data.providerTransactionId,
                      confirmationCode:  data.confirmationCode,
                      paymentDate:       data.paymentDate,
                      dueDate:           data.dueDate,
                      paymentNumber:     parseInt(data.paymentNumber) || (payments.length + 1),
                      status:            data.status,
                      notes:             data.notes,
                      currency:          "KES",
                    });
                  }}
                >
                  <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    This payment will be automatically posted to the General Ledger as:<br />
                    <span className="font-semibold">Dr Cash & Bank → Cr Diaspora Income</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Amount Received (KES) *</Label>
                      <Input type="number" name="amount" step="0.01" placeholder="150000" required />
                    </div>
                    <div className="space-y-1">
                      <Label>Status *</Label>
                      <Select name="status" required>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><Label>Payment Date *</Label><Input type="date" name="paymentDate" required /></div>
                    <div className="space-y-1"><Label>Payment #</Label><Input type="number" name="paymentNumber" defaultValue={payments.length + 1} /></div>
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">International Transfer (optional)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Sender Currency</Label>
                        <Select name="originalCurrency">
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="KES" /></SelectTrigger>
                          <SelectContent>
                            {["KES","USD","GBP","EUR","CAD","AUD","AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Amount Sent</Label><Input type="number" name="originalAmount" step="0.01" placeholder="1200" className="h-8 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-xs">Exchange Rate</Label><Input type="number" name="exchangeRate" step="0.0001" placeholder="130.25" className="h-8 text-xs font-mono" /></div>
                      <div className="space-y-1"><Label className="text-xs">Transfer Fees (KES)</Label><Input type="number" name="processingFee" step="0.01" placeholder="0" className="h-8 text-xs" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Provider</Label>
                        <Select name="internationalProvider">
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {["Wise","Sendwave","Remitly","WorldRemit","Western Union","MoneyGram","Direct Bank Wire"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Transaction ID</Label><Input name="providerTransactionId" placeholder="RMT-123456" className="h-8 text-xs font-mono" /></div>
                    </div>
                  </div>
                  <div className="space-y-1"><Label>Notes</Label><Input name="notes" placeholder="Any additional notes…" /></div>
                  <div className="flex gap-3 pt-1">
                    <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={paymentMutation.isPending}>
                      {paymentMutation.isPending ? <><RefreshCw className="h-4 w-4 animate-spin mr-2" />Recording...</> : "Record Payment"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setIsPaymentOpen(false)}>Cancel</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {payments.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
              title="No payments recorded"
              description="Record the first payment for this contract using the button above."
            />
          ) : (
            <div className="space-y-3">
              {payments.map((p: any) => {
                const sc =
                  p.status === "completed" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200" :
                  p.status === "pending"   ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200" :
                  "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200";
                return (
                  <div key={p.id} className="border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-foreground">KES {Math.round(Number(p.amount)).toLocaleString("en-KE")}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${sc}`}>{p.status}</span>
                          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">#{p.paymentNumber}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.paymentDate ? format(new Date(p.paymentDate), "dd MMM yyyy") : "—"}
                          {p.internationalProvider && ` · ${p.internationalProvider}`}
                          {p.providerTransactionId && ` · ${p.providerTransactionId}`}
                        </p>
                      </div>
                      {p.kesDisbursed && (
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground uppercase font-bold">Disbursed</p>
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm">KES {Math.round(Number(p.kesDisbursed)).toLocaleString("en-KE")}</p>
                        </div>
                      )}
                    </div>
                    {p.originalAmount && p.originalCurrency && p.originalCurrency !== "KES" && (
                      <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>Sent: <strong className="text-foreground">{p.originalAmount} {p.originalCurrency}</strong></span>
                        {p.exchangeRate && <span>Rate: <strong className="text-foreground font-mono">1 {p.originalCurrency} = {parseFloat(p.exchangeRate).toFixed(4)} KES</strong></span>}
                        {p.spreadPct && <span className={`font-medium ${parseFloat(p.spreadPct) > 3 ? "text-rose-600" : parseFloat(p.spreadPct) > 1.5 ? "text-amber-600" : "text-emerald-600"}`}>Spread: {parseFloat(p.spreadPct) >= 0 ? "+" : ""}{parseFloat(p.spreadPct).toFixed(2)}%</span>}
                      </div>
                    )}
                    {p.notes && <p className="text-xs text-muted-foreground italic">{p.notes}</p>}
                  </div>
                );
              })}
              <div className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20 p-4">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-2">Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Down Payment</p>
                    <p className="font-bold text-blue-600 dark:text-blue-400">KES {Math.round(Number(contract?.downPayment ?? 0)).toLocaleString("en-KE")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Installments Received</p>
                    <p className="font-bold text-foreground">KES {Math.round(payments.filter((p:any)=>p.status==="completed").reduce((s:number,p:any)=>s+Number(p.amount),0)).toLocaleString("en-KE")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payments Made</p>
                    <p className="font-bold text-foreground">{payments.filter((p:any)=>p.status==="completed").length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining Balance</p>
                    <p className="font-bold text-foreground">KES {Math.round(Number(contract?.remainingBalance ?? 0)).toLocaleString("en-KE")}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          {loadingInvoices ? (
            <div className="flex justify-center py-16"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8 text-muted-foreground" />}
              title="No invoices yet"
              description="Generate an invoice from the Details tab."
              action={{ label: "Go to Details", onClick: () => setActiveTab("details") }}
            />
          ) : (
            <div className="space-y-3">
              {invoices.map((inv: any) => {
                const statusColor =
                  inv.status === "paid"    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200" :
                  inv.status === "overdue" ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200" :
                  "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200";
                return (
                  <div key={inv.id} className="border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-muted-foreground">{inv.invoiceNumber}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${statusColor}`}>
                          {inv.status}
                        </span>
                      </div>
                      <p className="font-bold text-foreground">{fmtMoney(Number(inv.totalAmount), inv.currency ?? "KES")}</p>
                      <p className="text-xs text-muted-foreground">Due: {inv.dueDate ? format(new Date(inv.dueDate), "dd MMM yyyy") : "—"}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex-shrink-0"
                      onClick={() => downloadInvoice(inv, contract)}
                    >
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── CONSTRUCTION ── */}
        <TabsContent value="construction" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Construction Progress Updates</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Photo and video milestone updates</p>
            </div>

            {/* Upload dialog */}
            <Dialog open={isUploadOpen} onOpenChange={(open) => {
              setIsUploadOpen(open);
              if (!open) { setStagedPhotos([]); setStagedVideos([]); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsUploadOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Post Update
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Post Construction Update</DialogTitle>
                  <DialogDescription>Share the latest progress for {contract.clientName}'s property.</DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4 mt-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const data = Object.fromEntries(fd.entries());
                    const photoUrls = stagedPhotos.length > 0 ? await uploadFiles(stagedPhotos.map(p => p.file)) : [];
                    const videoUrls = stagedVideos.length > 0 ? await uploadFiles(stagedVideos.map(v => v.file)) : [];
                    constructionMutation.mutate({
                      diasporaContractId: contractId,
                      updateTitle: data.updateTitle,
                      updateDescription: data.updateDescription,
                      constructionPhase: data.constructionPhase,
                      progressPercentage: parseFloat(data.progressPercentage as string),
                      milestoneAchieved: data.milestoneAchieved,
                      nextMilestone: data.nextMilestone,
                      estimatedCompletionDate: data.estimatedCompletionDate
                        ? new Date(data.estimatedCompletionDate as string).toISOString() : null,
                      clientNotified: true,
                      photoUrls,
                      videoUrls,
                      documentUrls: [],
                    });
                  }}
                >
                  <div className="space-y-2"><Label>Title *</Label><Input name="updateTitle" placeholder="e.g. Foundation Completed" required /></div>
                  <div className="space-y-2"><Label>Description *</Label><Textarea name="updateDescription" placeholder="Describe the work done..." required className="min-h-[80px]" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phase *</Label>
                      <Select name="constructionPhase" required>
                        <SelectTrigger><SelectValue placeholder="Select phase" /></SelectTrigger>
                        <SelectContent>
                          {CONSTRUCTION_STAGES.map(s => (
                            <SelectItem key={s.key} value={s.key}>{s.icon} {s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Progress % *</Label><Input type="number" name="progressPercentage" min="0" max="100" step="0.1" required /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Milestone Achieved</Label><Input name="milestoneAchieved" placeholder="e.g. Slab poured" /></div>
                    <div className="space-y-2"><Label>Next Milestone</Label><Input name="nextMilestone" placeholder="e.g. Wall construction" /></div>
                  </div>
                  <div className="space-y-2"><Label>Est. Completion Date</Label><Input type="date" name="estimatedCompletionDate" /></div>

                  {/* Photos */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5"><Camera className="h-3.5 w-3.5 text-emerald-600" /> Photos</Label>
                    <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => {
                      setStagedPhotos(prev => [...prev, ...Array.from(e.target.files || []).map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
                      e.target.value = "";
                    }} />
                    <div className="border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center cursor-pointer hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10 transition-colors"
                      onClick={() => photoRef.current?.click()}>
                      <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to upload photos</p>
                    </div>
                    {stagedPhotos.length > 0 && (
                      <div className="grid grid-cols-4 gap-2">
                        {stagedPhotos.map((p, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                            <img src={p.preview} className="w-full h-full object-cover" alt="" />
                            <button type="button" onClick={() => setStagedPhotos(prev => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_,j) => j !== i); })}
                              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Videos */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 text-emerald-600" /> Videos</Label>
                    <input ref={videoRef} type="file" accept="video/*" multiple className="hidden" onChange={e => {
                      setStagedVideos(prev => [...prev, ...Array.from(e.target.files || []).map(f => ({ file: f, name: f.name }))]);
                      e.target.value = "";
                    }} />
                    <div className="border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center cursor-pointer hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10 transition-colors"
                      onClick={() => videoRef.current?.click()}>
                      <Play className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Click to upload videos</p>
                    </div>
                    {stagedVideos.length > 0 && (
                      <div className="space-y-2">
                        {stagedVideos.map((v, i) => (
                          <div key={i} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2 bg-muted/30">
                            <Play className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <span className="text-sm flex-1 truncate">{v.name}</span>
                            <button type="button" onClick={() => setStagedVideos(prev => prev.filter((_,j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={constructionMutation.isPending}>
                      {constructionMutation.isPending ? "Posting..." : "Post Update"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setIsUploadOpen(false)}>Cancel</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {loadingUpdates ? (
            <div className="flex justify-center py-16"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : updates.length === 0 ? (
            <EmptyState
              icon={<Camera className="h-8 w-8 text-muted-foreground" />}
              title="No updates yet"
              description="Post the first construction milestone update for this contract."
            />
          ) : (
            <div className="space-y-4">
              {updates.map((u: any) => {
                const photos: string[] = Array.isArray(u.photoUrls) ? u.photoUrls : [];
                const videos: string[] = Array.isArray(u.videoUrls) ? u.videoUrls : [];
                const stageColor = STAGE_COLORS[u.constructionPhase] ?? STAGE_COLORS.planning;
                return (
                  <div key={u.id} className="border border-border rounded-2xl overflow-hidden hover:shadow-sm transition-shadow">
                    <div className={`h-1 w-full ${STAGE_STRIP[u.constructionPhase] ?? "bg-emerald-50"}`} />
                    <div className="p-5 space-y-4">
                      {/* Update header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-semibold text-foreground">{u.updateTitle}</p>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${stageColor}`}>
                              {CONSTRUCTION_STAGES.find(s => s.key === u.constructionPhase)?.icon}{" "}
                              {CONSTRUCTION_STAGES.find(s => s.key === u.constructionPhase)?.label ?? u.constructionPhase}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{u.createdAt ? format(new Date(u.createdAt), "dd MMM yyyy, h:mm a") : "—"}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{u.progressPercentage}%</span>
                        </div>
                      </div>

                      <Progress value={u.progressPercentage} className="h-1.5 [&>div]:bg-emerald-500" />

                      {u.updateDescription && (
                        <p className="text-sm text-muted-foreground leading-relaxed">{u.updateDescription}</p>
                      )}

                      {(u.milestoneAchieved || u.nextMilestone) && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {u.milestoneAchieved && (
                            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg p-2.5">
                              <p className="font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider text-[10px] mb-1">Achieved</p>
                              <p className="text-foreground">{u.milestoneAchieved}</p>
                            </div>
                          )}
                          {u.nextMilestone && (
                            <div className="bg-muted/40 border border-border rounded-lg p-2.5">
                              <p className="font-bold text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Next</p>
                              <p className="text-foreground">{u.nextMilestone}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Photos */}
                      {photos.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> Photos ({photos.length})
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {photos.map((url, idx) => (
                              <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                                className="relative aspect-video rounded-xl overflow-hidden border border-border hover:border-emerald-400 group block transition-all">
                                <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Videos */}
                      {videos.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                            <Play className="h-3 w-3" /> Videos ({videos.length})
                          </p>
                          <div className="space-y-3">
                            {videos.map((url, idx) => (
                              <div key={idx} className="rounded-xl overflow-hidden border border-border bg-black">
                                <video src={url} controls preload="metadata" className="w-full max-h-72 object-contain" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border">
                        {u.clientNotified
                          ? <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Client notified</>
                          : <><AlertCircle className="h-3.5 w-3.5 text-amber-500" /> Client not yet notified</>}
                        {u.estimatedCompletionDate && (
                          <span className="ml-auto">Est. completion: {fmt(u.estimatedCompletionDate)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── EDIT ── */}
        <TabsContent value="edit" className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data = Object.fromEntries(fd.entries());
              editMutation.mutate({
                clientName:            data.clientName,
                clientEmail:           data.clientEmail,
                clientPhone:           data.clientPhone,
                clientWhatsapp:        data.clientWhatsapp,
                clientCountry:         data.clientCountry,
                constructionStatus:    data.constructionStatus,
                paymentMethod:         data.paymentMethod,
                internationalProvider: data.internationalProvider,
                totalPropertyValue:    String(data.totalPropertyValue),
                downPayment:           String(data.downPayment),
                totalPaid:             String(data.totalPaid),
                remainingBalance:      String(data.remainingBalance),
                paymentsMade:          Number(data.paymentsMade),
                contractSignedAt:      data.contractSignedAt       || null,
                constructionStartDate: data.constructionStartDate  || null,
                expectedCompletionDate:data.expectedCompletionDate || null,
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Full Name</Label><Input name="clientName" defaultValue={contract.clientName} /></div>
              <div className="space-y-1"><Label>Email</Label><Input name="clientEmail" defaultValue={contract.clientEmail} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input name="clientPhone" defaultValue={contract.clientPhone} /></div>
              <div className="space-y-1"><Label>WhatsApp</Label><Input name="clientWhatsapp" defaultValue={contract.clientWhatsapp} /></div>
              <div className="space-y-1">
                <Label>Construction Status</Label>
                <Select name="constructionStatus" defaultValue={contract.constructionStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONSTRUCTION_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.icon} {s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Payments Made (#)</Label><Input type="number" name="paymentsMade" defaultValue={contract.paymentsMade} /></div>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">Financial (Manual Correction)</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Total Property Value</Label><Input type="number" name="totalPropertyValue" defaultValue={contract.totalPropertyValue} /></div>
                <div className="space-y-1"><Label>Down Payment</Label><Input type="number" name="downPayment" defaultValue={contract.downPayment} /></div>
                <div className="space-y-1"><Label>Total Paid to Date</Label><Input type="number" name="totalPaid" defaultValue={contract.totalPaid} /></div>
                <div className="space-y-1"><Label>Remaining Balance</Label><Input type="number" name="remainingBalance" defaultValue={contract.remainingBalance} /></div>
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">Key Dates</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Contract Signed</Label>
                  <Input type="date" name="contractSignedAt" defaultValue={contract.contractSignedAt ? new Date(contract.contractSignedAt).toISOString().slice(0,10) : ""} />
                </div>
                <div className="space-y-1">
                  <Label>Construction Start</Label>
                  <Input type="date" name="constructionStartDate" defaultValue={contract.constructionStartDate ? new Date(contract.constructionStartDate).toISOString().slice(0,10) : ""} />
                </div>
                <div className="space-y-1">
                  <Label>Expected Completion</Label>
                  <Input type="date" name="expectedCompletionDate" defaultValue={contract.expectedCompletionDate ? new Date(contract.expectedCompletionDate).toISOString().slice(0,10) : ""} />
                </div>
              </div>
            </div>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" disabled={editMutation.isPending}>
              {editMutation.isPending ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}