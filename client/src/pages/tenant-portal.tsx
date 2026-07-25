/**
 * Tenant Portal — the view tenants see when they log in.
 *
 * The tenantId is resolved by TenantPortalWrapper in App.tsx, which matches
 * the logged-in user's email against the tenants table and passes the ID here.
 *
 * All data comes from real, existing API endpoints:
 *   GET  /api/tenants/:id              — profile, unit, lease dates, rent
 *   GET  /api/tenants/:id/payments     — payment history
 *   GET  /api/maintenance-requests     — org-scoped; filtered client-side by tenantId
 *   GET  /api/documents?tenantId=X     — documents shared with this tenant
 *   GET  /api/messages?box=inbox       — messages from property manager
 *   POST /api/maintenance-requests     — submit repair request (tenantId + unitId)
 *   POST /api/messages                 — contact property manager
 *   PATCH /api/maintenance-requests/:id/feedback — rate resolved request
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { buildRentAccountReference, buildUtilityAccountReference } from "@shared/paymentReference";
import { useWsEvent } from "@/hooks/useWebSocket";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  User, CreditCard, FileText, Bell, Download, Eye, Calendar,
  DollarSign, Home, Mail, MessageSquare, Clock, CheckCircle,
  AlertTriangle, Wrench, Star, Send, Loader2, RefreshCw,
  ChevronDown, ChevronUp, Phone, X, Wifi, WifiOff, TrendingUp,
  Shield, Key, Info, Building, MapPin, Hash, Smartphone, Copy,
  ThumbsUp, ArrowRight, Zap, CheckSquare, Circle, Upload, Search, UserPlus,
  Droplets, Flame, Wifi as WifiIcon, BellRing, ExternalLink, RefreshCcw, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, ensureArray, uploadWithAuth } from "@/lib/queryClient";
import { format, differenceInDays, addDays, isAfter, isBefore } from "date-fns";
import TenantWhatsAppChat from "./tenant-whatsapp-chat";
import TenantVisitorPanel from "@/components/tenant-visitor-panel";
import LeaseAgreementGenerator from "@/components/lease-agreement-generator";
import PaymentMethodsPanel from "@/components/payment-methods-panel";
import { useTranslation } from "react-i18next";
import { TenantOnboardingFlow, hasCompletedOnboarding, markOnboardingDone } from "@/components/tenant-onboarding-flow";
import { TenantHelpTip } from "@/components/tenant-help-tip";
import { LanguageToggle } from "@/components/LanguageToggle";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { openPrintWindow, spHeader, spFooter, fmtDocDate, fmtDocKES } from "@/lib/document-theme";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtKES = (n: number | string | null | undefined) =>
  `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};

const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy, h:mm a"); } catch { return "—"; }
};


// ─── Status / priority configs (static, no translation needed for display) ───

const MAINT_STATUS_CONFIG: Record<string, { label: string; cls: string; icon: any }> = {
  pending:     { label: "Pending",     cls: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",   icon: Clock },
  assigned:    { label: "Assigned",    cls: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: User },
  in_progress: { label: "In Progress", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: Wrench },
  completed:   { label: "Completed",   cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: CheckCircle },
  cancelled:   { label: "Cancelled",   cls: "bg-gray-100 text-gray-700 dark:bg-gray-800", icon: X },
};

const PRIORITY_CONFIG_STATIC: Record<string, { label: string; cls: string }> = {
  low:    { label: "Low",    cls: "text-slate-500" },
  medium: { label: "Medium", cls: "text-yellow-600" },
  high:   { label: "High",   cls: "text-orange-600" },
  urgent: { label: "Urgent", cls: "text-red-600 font-semibold" },
};

const daysUntil = (d: string | null | undefined): number | null => {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
};

const leaseProgress = (start: string | null | undefined, end: string | null | undefined): number => {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const now = Date.now();
  if (now <= s) return 0;
  if (now >= e) return 100;
  return Math.round(((now - s) / (e - s)) * 100);
};

// ─── Status / priority configs ────────────────────────────────────────────────

function getMaintStatus(t: (k: string) => string): Record<string, { label: string; cls: string; icon: any }> {
  return {
    pending:     { label: t("tenantPortal.statusPending"),   cls: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",   icon: Clock },
    assigned:    { label: t("tenantPortal.statusAssigned"),   cls: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: User },
    in_progress: { label: t("tenantPortal.statusInProgress"), cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: Wrench },
    completed:   { label: t("tenantPortal.statusCompleted"),  cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: CheckCircle },
    cancelled:   { label: t("tenantPortal.statusCancelled"),  cls: "bg-gray-100 text-gray-700 dark:bg-gray-800", icon: X },
  };
}

const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  paid:       { label: "Paid", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200"  },
  completed:  { label: "Paid", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200"  },
  pending:    { label: "Pending",    cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  overdue:    { label: "Overdue",    cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  processing: { label: "Processing", cls: "bg-blue-100   text-blue-800   dark:bg-blue-900   dark:text-blue-200"   },
};

function getPriorityConfig(t: (k: string) => string): Record<string, { label: string; cls: string }> {
  return {
    low:    { label: t("tenantPortal.priorityLow"),    cls: "text-slate-500" },
    medium: { label: t("tenantPortal.priorityMedium"), cls: "text-yellow-600" },
    high:   { label: t("tenantPortal.priorityHigh"),   cls: "text-orange-600" },
    urgent: { label: t("tenantPortal.priorityUrgent"), cls: "text-red-600 font-semibold" },
  };
}

// ─── Quick action card ────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, description, onClick, color = "blue", badge }: {
  icon: any; label: string; description: string; onClick: () => void; color?: string; badge?: string | number;
}) {
  const colorMap: Record<string, string> = {
    blue:   "bg-blue-50   dark:bg-blue-950/60  text-blue-600",
    green:  "bg-green-50  dark:bg-green-950/60 text-green-600",
    purple: "bg-purple-50 dark:bg-purple-950/60 text-purple-600",
    amber:  "bg-amber-50  dark:bg-amber-950/60 text-amber-600",
  };
  return (
    <button onClick={onClick}
      className="group relative w-full text-left p-4 rounded-2xl border border-border bg-card hover:shadow-md hover:border-primary/30 transition-all duration-200 active:scale-[0.98]">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color] || colorMap.blue}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1 flex-shrink-0" />
      </div>
      {badge !== undefined && (
        <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5">
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Notice / announcement card ───────────────────────────────────────────────

function NoticeCard({ notice }: { notice: { title: string; content: string; type: "info" | "warning" | "success"; date?: string } }) {
  const cfg = {
    info:    { cls: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800", icon: Info,          iconCls: "text-blue-500" },
    warning: { cls: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800", icon: AlertTriangle, iconCls: "text-amber-500" },
    success: { cls: "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800", icon: CheckCircle,   iconCls: "text-green-500" },
  }[notice.type];
  const Icon = cfg.icon;
  return (
    <div className={`p-4 rounded-xl border ${cfg.cls} flex gap-3`}>
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.iconCls}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{notice.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notice.content}</p>
        {notice.date && <p className="text-[11px] text-muted-foreground/60 mt-1">{notice.date}</p>}
      </div>
    </div>
  );
}

// ─── STK Push payment states ──────────────────────────────────────────────────

type StkState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "waiting"; checkoutRequestId: string; transactionId: number; startedAt: number }
  | { phase: "success"; receipt: string; amount: number }
  | { phase: "failed"; reason: string };

// ─── M-Pesa STK Push component ────────────────────────────────────────────────
//
// Flow:
//   1. Tenant enters their phone number (pre-filled from profile)
//   2. POST /api/mpesa/initiate  → Safaricom sends STK prompt to their phone
//   3. Poll GET /api/mpesa/status/:checkoutRequestId every 3 s (up to 90 s)
//   4. On resultCode 0  → success screen with M-Pesa receipt number
//      On cancel/timeout → failed screen with retry option

function MpesaSTKPush({
  amount,
  rentPaymentId,
  tenantId,
  accountReference,
  defaultPhone,
  onSuccess,
}: {
  amount: number;
  rentPaymentId?: number;
  tenantId?: number;
  accountReference: string;
  defaultPhone?: string;
  onSuccess?: (receipt: string) => void;
}) {
  const { toast } = useToast();
  const [stkState, setStkState] = useState<StkState>({ phase: "idle" });
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [showManual, setShowManual] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("07") || digits.startsWith("01")) return "254" + digits.slice(1);
    if (digits.startsWith("254")) return digits;
    if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits;
    return digits;
  };

  const startPolling = (checkoutRequestId: string, transactionId: number) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // 30 × 3 s = 90 s timeout

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await apiRequest(`/api/mpesa/status/${checkoutRequestId}`);
        const data = await res.json();

        if (data.status === "completed") {
          clearInterval(pollRef.current!);
          setStkState({ phase: "success", receipt: data.mpesaReceiptNumber ?? checkoutRequestId, amount });
          onSuccess?.(data.mpesaReceiptNumber ?? checkoutRequestId);
          return;
        }

        if (data.status === "failed") {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: data.resultDesc ?? "Payment was declined or cancelled." });
          return;
        }

        // Still pending — check timeout
        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: "Timed out waiting for M-Pesa confirmation. If you approved the payment, it will still be recorded." });
        }
      } catch {
        // Network hiccup — keep polling unless we hit max
        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: "Could not confirm payment status. Contact your manager if money was deducted." });
        }
      }
    }, 3000);
  };

  const initiate = async () => {
    const formatted = formatPhone(phone);
    if (formatted.length < 12) {
      toast({ title: "Enter a valid Safaricom number", variant: "destructive" });
      return;
    }

    setStkState({ phase: "sending" });
    try {
      const res = await apiRequest("/api/mpesa/initiate", {
        method: "POST",
        data: {
          phoneNumber: formatted,
          amount: Math.round(amount),
          accountReference: accountReference.slice(0, 12),
          description: "Rent Payment",
          ...(rentPaymentId ? { rentPaymentId } : {}),
          ...(tenantId ? { tenantId } : {}),
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Failed to send STK push");
      }

      const data = await res.json();
      const state: StkState = {
        phase: "waiting",
        checkoutRequestId: data.checkoutRequestId,
        transactionId: data.transactionId,
        startedAt: Date.now(),
      };
      setStkState(state);
      startPolling(data.checkoutRequestId, data.transactionId);
      toast({ title: "Check your phone", description: data.customerMessage ?? "Enter your M-Pesa PIN to complete payment." });
    } catch (err: any) {
      setStkState({ phase: "failed", reason: err.message ?? "Could not initiate payment." });
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStkState({ phase: "idle" });
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (stkState.phase === "success") {
    return (
      <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-6 text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto">
          <CheckCircle className="w-7 h-7 text-green-600" />
        </div>
        <div>
          <p className="font-bold text-green-800 dark:text-green-200 text-base">Payment Confirmed!</p>
          <p className="text-sm text-green-700 dark:text-green-300 mt-1">{fmtKES(stkState.amount)} received successfully</p>
        </div>
        <div className="bg-white dark:bg-green-900/40 rounded-xl border border-green-200 dark:border-green-700 p-3 text-left">
          <p className="text-[11px] text-muted-foreground">M-Pesa Receipt No.</p>
          <p className="text-sm font-mono font-bold text-foreground">{stkState.receipt}</p>
        </div>
        <p className="text-xs text-green-700 dark:text-green-400">Keep this receipt number for your records.</p>
      </div>
    );
  }

  // ── Failed screen ───────────────────────────────────────────────────────────
  if (stkState.phase === "failed") {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-6 text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto">
          <X className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <p className="font-bold text-red-800 dark:text-red-200 text-base">Payment Not Completed</p>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1">{stkState.reason}</p>
        </div>
        <div className="flex gap-2 justify-center">
          <Button size="sm" onClick={reset} className="bg-red-600 hover:bg-red-700 text-white">
            Try Again
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowManual(v => !v)}>
            Pay Manually
          </Button>
        </div>
        {showManual && <MpesaManualSteps reference={accountReference} amount={amount} />}
      </div>
    );
  }

  // ── Waiting / polling screen ────────────────────────────────────────────────
  if (stkState.phase === "waiting") {
    const elapsedSec = Math.floor((Date.now() - stkState.startedAt) / 1000);
    return (
      <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-6 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mx-auto">
          <Smartphone className="w-7 h-7 text-blue-600 animate-pulse" />
        </div>
        <div>
          <p className="font-bold text-blue-800 dark:text-blue-200 text-base">Waiting for your PIN…</p>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            A prompt has been sent to <span className="font-mono font-semibold">{phone}</span>.
            Enter your M-Pesa PIN to confirm.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Checking status…
        </div>
        <p className="text-[11px] text-muted-foreground">
          Don't close this page. This screen will update automatically once confirmed.
        </p>
        <Button size="sm" variant="outline" className="text-xs" onClick={reset}>
          Cancel
        </Button>
      </div>
    );
  }

  // ── Idle / sending — main form ──────────────────────────────────────────────
  const isSending = stkState.phase === "sending";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-green-600 flex-shrink-0" />
          <h3 className="font-semibold text-green-800 dark:text-green-200 text-sm">Pay via M-Pesa STK Push</h3>
        </div>

        <p className="text-xs text-green-700 dark:text-green-300 leading-relaxed">
          Enter your Safaricom number and tap <strong>Send Payment Request</strong>. 
          You'll receive a PIN prompt on your phone — enter your M-Pesa PIN to complete the payment instantly.
        </p>

        {/* Amount display */}
        <div className="bg-white dark:bg-green-900/40 rounded-xl border border-green-200 dark:border-green-700 p-3">
          <p className="text-[11px] text-muted-foreground">Amount to pay</p>
          <p className="text-2xl font-semibold text-foreground">{fmtKES(amount)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Ref: <span className="font-mono">{accountReference}</span></p>
        </div>

        {/* Phone input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-green-800 dark:text-green-200">
            Safaricom Number
          </label>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 bg-white dark:bg-green-900/40 border border-green-200 dark:border-green-700 rounded-lg px-3 text-sm font-medium text-muted-foreground flex-shrink-0">
              🇰🇪 +254
            </div>
            <Input
              type="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="bg-white dark:bg-green-900/40 border-green-200 dark:border-green-700 h-9"
              disabled={isSending}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">Must be the number registered with M-Pesa</p>
        </div>

        <Button
          className="w-full bg-green-600 hover:bg-green-700 text-white h-10 text-sm font-semibold"
          onClick={initiate}
          disabled={isSending || !phone.trim()}
        >
          {isSending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending request…</>
            : <><Smartphone className="w-4 h-4 mr-2" /> Send Payment Request</>}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          Secured by Safaricom M-Pesa Daraja API. Your PIN is never shared with SmartProp.
        </p>
      </div>

      {/* Fallback manual steps */}
      <button
        onClick={() => setShowManual(v => !v)}
        className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showManual ? "rotate-180" : ""}`} />
        {showManual ? "Hide" : "Prefer to pay manually instead?"}
      </button>
      {showManual && <MpesaManualSteps reference={accountReference} amount={amount} />}
    </div>
  );
}

// ─── Manual fallback steps (collapsed by default) ─────────────────────────────

function MpesaManualSteps({ amount, reference }: { amount: number; reference: string }) {
  const { toast } = useToast();
  const steps = [
    "Open M-PESA on your phone",
    "Select Lipa na M-PESA → Pay Bill",
    "Business No: 174379",
    `Account No: ${reference}`,
    `Amount: KES ${amount.toLocaleString("en-KE")}`,
    "Enter your M-PESA PIN and send",
  ];
  const copyRef = () =>
    navigator.clipboard.writeText(reference).then(() =>
      toast({ title: "Reference copied!", description: reference })
    );

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">Manual Pay Bill steps:</p>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="w-4 h-4 rounded-full bg-muted-foreground/20 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-xs text-foreground">{step}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 p-2.5 bg-card rounded-xl border border-slate-100 shadow-sm">
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground">Payment reference</p>
          <p className="text-xs font-mono font-bold">{reference}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={copyRef}>
          <Copy className="w-3 h-3" /> Copy
        </Button>
      </div>
    </div>
  );
}

// ─── Star rating component ────────────────────────────────────────────────────

function StarRating({ value, onChange, readonly }: {
  value: number; onChange?: (n: number) => void; readonly?: boolean;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => !readonly && setHovered(n)}
          onMouseLeave={() => !readonly && setHovered(0)}
          onClick={() => !readonly && onChange?.(n)}
          className={readonly ? "cursor-default" : "focus:outline-none"}>
          <Star className={`w-5 h-5 transition-colors ${
            n <= (hovered || value) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
          }`} />
        </button>
      ))}
    </div>
  );
}

// ─── Maintenance request card with inline feedback ────────────────────────────

function MaintenanceCard({ req }: { req: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState(req.satisfactionRating ?? 0);
  const [ratingComment, setRatingComment] = useState(req.satisfactionComments ?? "");
  const [showRating, setShowRating] = useState(false);

  const statusCfg = MAINT_STATUS_CONFIG[req.status] ?? MAINT_STATUS_CONFIG.pending;
  const priorityCfg = PRIORITY_CONFIG_STATIC[req.priority] ?? PRIORITY_CONFIG_STATIC.medium;
  const StatusIcon = statusCfg.icon;
  const isResolved = req.status === "completed";
  const isUrgent = req.priority === "urgent" && !isResolved;

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/maintenance-requests/${req.id}/feedback`, {
        method: "PATCH",
        data: { rating, comments: ratingComment },
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      setShowRating(false);
      toast({ title: "Thank you for your feedback!" });
    },
    onError: () => toast({ title: "Could not submit rating", variant: "destructive" }),
  });

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${
      isUrgent ? "border-red-300 dark:border-red-700 shadow-sm shadow-red-100 dark:shadow-red-900/30" :
      isResolved ? "border-green-200 dark:border-green-800" :
      req.status === "in_progress" ? "border-yellow-200 dark:border-yellow-800" :
      "border-border"
    }`}>
      {/* Priority stripe */}
      {isUrgent && <div className="h-1 bg-gradient-to-r from-red-500 to-orange-500" />}
      {isResolved && <div className="h-1 bg-gradient-to-r from-green-400 to-emerald-500" />}
      {req.status === "in_progress" && <div className="h-1 bg-gradient-to-r from-yellow-400 to-amber-500" />}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${
                isResolved ? "text-green-500" :
                req.status === "in_progress" ? "text-yellow-500 animate-pulse" :
                "text-muted-foreground"
              }`} />
              <p className="font-semibold text-sm">{req.title}</p>
              <Badge className={`text-[11px] px-2 py-0 ${statusCfg.cls}`}>{statusCfg.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{req.description}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <span className="capitalize bg-muted px-1.5 py-0.5 rounded text-[11px]">{req.category || "General"}</span>
              <span className={`text-[11px] font-medium ${priorityCfg.cls}`}>{priorityCfg.label} priority</span>
              <span className="font-mono">#{req.ticketNumber || req.id}</span>
              <span>{fmtDate(req.createdAt)}</span>
            </div>
          </div>
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Rate resolved request */}
        {isResolved && !req.satisfactionRating && !showRating && (
          <button onClick={() => setShowRating(true)}
            className="mt-3 flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 hover:underline px-2 py-1 rounded-lg hover:bg-green-50 dark:hover:bg-green-950/40 transition-colors">
            <ThumbsUp className="w-3.5 h-3.5" /> Rate this resolution
          </button>
        )}
        {req.satisfactionRating > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <StarRating value={req.satisfactionRating} readonly />
            <span className="text-xs text-muted-foreground">Your rating</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { label: "Category",     value: req.category || "General", className: "capitalize" },
              { label: "Priority",     value: req.priority, className: `capitalize font-medium ${priorityCfg.cls}` },
              { label: "Submitted",    value: fmtDate(req.createdAt) },
              { label: "Last updated", value: fmtDate(req.updatedAt) },
              req.assignedTo ? { label: "Assigned to", value: req.assignedTo } : null,
              req.estimatedCompletion ? { label: "Est. completion", value: fmtDate(req.estimatedCompletion) } : null,
            ].filter(Boolean).map((row: any) => (
              <div key={row.label}>
                <span className="text-muted-foreground">{row.label}</span>
                <p className={`font-medium mt-0.5 ${row.className || ""}`}>{row.value}</p>
              </div>
            ))}
          </div>

          {req.notes && (
            <div className="p-3 bg-card rounded-xl border border-slate-100 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground mb-1">Manager notes</p>
              <p className="text-xs">{req.notes}</p>
            </div>
          )}

          {showRating && isResolved && (
            <div className="p-4 bg-green-50 dark:bg-green-950/40 rounded-xl border border-green-200 dark:border-green-800 space-y-3">
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                How satisfied are you with the resolution?
              </p>
              <StarRating value={rating} onChange={setRating} />
              <Textarea
                placeholder="Optional: tell us how we did…" rows={2} value={ratingComment}
                onChange={e => setRatingComment(e.target.value)} className="text-sm bg-white dark:bg-card" />
              <div className="flex gap-2">
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={rating === 0 || feedbackMutation.isPending}
                  onClick={() => feedbackMutation.mutate()}>
                  {feedbackMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Submit Feedback"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowRating(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const repairSchema = z.object({
  title:       z.string().min(3, "At least 3 characters"),
  description: z.string().min(10, "At least 10 characters"),
  priority:    z.enum(["low", "medium", "high", "urgent"]),
  category:    z.string().min(1, "Required"),
});

const messageSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  content: z.string().min(5, "Message must be at least 5 characters"),
});

// ─── Notification preferences card ────────────────────────────────────────────
// Lets tenants control whether they receive WhatsApp notifications and
// how far in advance to get rent-due warnings.

function NotificationPrefsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery<any>({
    queryKey: ["/api/notifications/preferences"],
    queryFn:  async () => (await apiRequest("/api/notifications/preferences")).json(),
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const r = await apiRequest("/api/notifications/preferences", {
        method: "PATCH",
        data: patch,
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Preferences saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;

  const toggle = (key: string, val: boolean) => saveMut.mutate({ [key]: val });

  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BellRing className="w-4 h-4 text-green-500" /> Notification Preferences
        </CardTitle>
        <CardDescription>
          Control how we contact you about rent, maintenance and your lease.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* WhatsApp toggle */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-green-600" /> WhatsApp notifications
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rent reminders, maintenance updates, lease notices — directly to your WhatsApp
            </p>
          </div>
          <button
            onClick={() => toggle("whatsappNotifications", !(prefs?.whatsappNotifications ?? true))}
            disabled={saveMut.isPending}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors focus-visible:outline-none ${
              (prefs?.whatsappNotifications ?? true) ? "bg-green-500" : "bg-muted-foreground/30"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              (prefs?.whatsappNotifications ?? true) ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>

        {/* Email toggle */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <div>
            <p className="text-sm font-medium">Email notifications</p>
            <p className="text-xs text-muted-foreground mt-0.5">Formal rent statements and lease documents</p>
          </div>
          <button
            onClick={() => toggle("paymentReminders", !(prefs?.paymentReminders ?? true))}
            disabled={saveMut.isPending}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
              (prefs?.paymentReminders ?? true) ? "bg-blue-500" : "bg-muted-foreground/30"
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              (prefs?.paymentReminders ?? true) ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>

        {/* Rent due warning days */}
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium">Rent warning</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Days before due date to receive a WhatsApp reminder
            </p>
          </div>
          <select
            value={prefs?.rentDueWarningDays ?? 3}
            onChange={e => saveMut.mutate({ rentDueWarningDays: parseInt(e.target.value) })}
            disabled={saveMut.isPending}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {[1,2,3,5,7].map(d => (
              <option key={d} value={d}>{d} day{d > 1 ? "s" : ""} before</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          🌙 Quiet hours (21:00 – 07:00 EAT): non-urgent notifications are held until morning.
          Urgent alerts (overdue rent, lease termination) are always delivered immediately.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Profile tab ──────────────────────────────────────────────────────────────
//
// Tenant can view their full lease summary and update contact details.
// Saves optimistically — the UI updates instantly, server confirms in background.
//
// Data sources:
//   tenant.currency        — on the tenants table (default "KES")
//   tenant.securityDeposit — on the tenants table
//   tenant.monthlyRent     — on the tenants table
//   propertyData.name      — from tenant.property.name (joined by GET /api/tenants/me)
//   unitNumber             — from tenant.unit.unitNumber (joined by GET /api/tenants/me)

function ProfileTab({
  tenant,
  tenantId,
  unitData,
  unitNumber,
  propertyData,
  onUpdated,
}: {
  tenant: any;
  tenantId?: number;
  unitData: any;
  unitNumber: string | null;
  propertyData: any;
  onUpdated: (updates: Record<string, any>) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(tenant?.phone ?? "");
  const [email, setEmail] = useState(tenant?.email ?? "");
  const [saving, setSaving] = useState(false);

  // Keep form in sync when tenant data changes (e.g. after optimistic update)
  useEffect(() => {
    if (!editing) {
      setPhone(tenant?.phone ?? "");
      setEmail(tenant?.email ?? "");
    }
  }, [tenant?.phone, tenant?.email, editing]);

  const save = async () => {
    const updates = { phone: phone.trim(), email: email.trim() };
    setSaving(true);

    // 1. Optimistic update — UI reflects change immediately
    onUpdated(updates);
    setEditing(false);

    // 2. Persist to server in background
    try {
      const r = await apiRequest(`/api/tenants/${tenantId}`, {
        method: "PUT",
        data: updates,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Save failed");
      }
      toast({ title: "✓ Profile updated" });
    } catch (err: any) {
      // Rollback: put old values back
      onUpdated({ phone: tenant?.phone ?? "", email: tenant?.email ?? "" });
      setPhone(tenant?.phone ?? "");
      setEmail(tenant?.email ?? "");
      setEditing(true);
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setPhone(tenant?.phone ?? "");
    setEmail(tenant?.email ?? "");
  };

  const leasePct = leaseProgress(tenant?.leaseStartDate, tenant?.leaseEndDate);
  const leaseEndDays = daysUntil(tenant?.leaseEndDate);
  const totalLeaseMonths = tenant?.leaseStartDate && tenant?.leaseEndDate
    ? Math.round(Math.abs(
        new Date(tenant.leaseEndDate).getTime() - new Date(tenant.leaseStartDate).getTime()
      ) / (1000 * 60 * 60 * 24 * 30))
    : null;

  // Derived display values — all sourced correctly
  const propertyName   = propertyData?.name ?? "—";
  const currency       = tenant?.currency ?? "KES";
  const securityDeposit = tenant?.securityDeposit
    ? `KES ${Math.round(Number(tenant.securityDeposit)).toLocaleString("en-KE")}`
    : "—";
  const monthlyRent = fmtKES(tenant?.monthlyRent);

  return (
    <div className="space-y-4">
      {/* Personal details card */}
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Personal Details</CardTitle>
            <CardDescription>Your contact information on file</CardDescription>
          </div>
          {!editing ? (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEditing(true)}>
              <User className="w-3.5 h-3.5" /> Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-8 text-xs bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                onClick={save}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save changes"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={cancel}>
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Avatar + name */}
          <div className="flex items-center gap-4 p-4 bg-muted/40 rounded-xl">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-white flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-semibold text-white dark:text-slate-900">
                {tenant?.firstName?.[0]}{tenant?.lastName?.[0]}
              </span>
            </div>
            <div>
              <p className="font-bold text-foreground text-base">{tenant?.firstName} {tenant?.lastName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Tenant ID #{String(tenantId ?? "").padStart(4, "0")}</p>
              <Badge className={`mt-1 text-[11px] px-2 py-0 ${
                tenant?.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-muted text-muted-foreground"
              }`}>
                {tenant?.status ?? "active"}
              </Badge>
            </div>
          </div>

          {/* Read-only fields notice */}
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 rounded-lg border border-border">
            <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Name, unit, rent and lease details are managed by your property manager and cannot be changed here.
            </p>
          </div>

          {/* Read-only identity fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <User className="w-3 h-3" /> Full Name
                <Lock className="w-3 h-3 ml-auto text-muted-foreground/50" />
              </label>
              <p className="text-sm font-medium text-foreground/60 h-9 flex items-center bg-muted/30 rounded-md px-3 cursor-not-allowed">
                {tenant?.firstName} {tenant?.lastName}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Building className="w-3 h-3" /> Unit
                <Lock className="w-3 h-3 ml-auto text-muted-foreground/50" />
              </label>
              <p className="text-sm font-medium text-foreground/60 h-9 flex items-center bg-muted/30 rounded-md px-3 cursor-not-allowed">
                {unitNumber ? `Unit ${unitNumber}` : "—"}
              </p>
            </div>
          </div>

          {/* Editable contact fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Phone className="w-3 h-3" /> Phone Number
                <span className="ml-auto text-[10px] text-emerald-600 font-medium">Editable</span>
              </label>
              {editing ? (
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="h-9 text-sm"
                  placeholder="07XX XXX XXX"
                />
              ) : (
                <p className="text-sm font-medium text-foreground h-9 flex items-center">
                  {tenant?.phone || <span className="text-muted-foreground italic">Not set</span>}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Mail className="w-3 h-3" /> Email Address
                <span className="ml-auto text-[10px] text-emerald-600 font-medium">Editable</span>
              </label>
              {editing ? (
                <Input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-9 text-sm"
                  type="email"
                  placeholder="your@email.com"
                />
              ) : (
                <p className="text-sm font-medium text-foreground h-9 flex items-center">
                  {tenant?.email || <span className="text-muted-foreground italic">Not set</span>}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lease summary card */}
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lease Summary</CardTitle>
          <CardDescription>Your full tenancy at a glance</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Lease progress */}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{fmtDate(tenant?.leaseStartDate)}</span>
              <span className={leaseEndDays !== null && leaseEndDays <= 60 ? "text-red-500 font-medium" : ""}>
                {fmtDate(tenant?.leaseEndDate)}
              </span>
            </div>
            <Progress value={leasePct} className="h-2" />
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
              <span>{leasePct}% elapsed</span>
              <span>
                {leaseEndDays === null ? "—"
                  : leaseEndDays > 0 ? `${leaseEndDays} days remaining`
                  : leaseEndDays === 0 ? "Ends today"
                  : "Expired"}
              </span>
            </div>
          </div>

          {/* Key facts grid — all sourced correctly */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Unit",             value: unitNumber ? `Unit ${unitNumber}` : "—",  icon: Building  },
              { label: "Property",         value: propertyName,                              icon: MapPin    },
              { label: "Monthly Rent",     value: monthlyRent,                               icon: DollarSign},
              { label: "Security Deposit", value: securityDeposit,                           icon: Shield    },
              { label: "Lease Duration",   value: totalLeaseMonths ? `${totalLeaseMonths} months` : "—", icon: Calendar },
              { label: "Currency",         value: currency,                                  icon: CreditCard},
            ].map(row => (
              <div key={row.label} className="p-3 bg-muted/40 rounded-xl">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  <row.icon className="w-3 h-3" />
                  <p className="text-[11px]">{row.label}</p>
                </div>
                <p className="text-sm font-semibold text-foreground">{row.value}</p>
              </div>
            ))}
          </div>

          {/* Renewal alert */}
          {leaseEndDays !== null && leaseEndDays > 0 && leaseEndDays <= 90 && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-950/40 rounded-xl border border-yellow-200 dark:border-yellow-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200">Lease renewal coming up</p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-0.5">
                  Your lease expires in <strong>{leaseEndDays} days</strong>. Contact your property manager to discuss renewal terms.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


//
// Tenants can download manager-shared documents AND upload their own files
// (proof of payment, ID, etc.) using POST /api/documents with multipart/form-data.

const EXT_COLOR: Record<string, string> = {
  PDF:  "bg-red-50    dark:bg-red-950   text-red-600",
  DOC:  "bg-blue-50   dark:bg-blue-950  text-blue-600",
  DOCX: "bg-blue-50   dark:bg-blue-950  text-blue-600",
  JPG:  "bg-green-50  dark:bg-green-950 text-green-600",
  JPEG: "bg-green-50  dark:bg-green-950 text-green-600",
  PNG:  "bg-green-50  dark:bg-green-950 text-green-600",
  XLS:  "bg-emerald-50 dark:bg-emerald-950 text-emerald-600",
  XLSX: "bg-emerald-50 dark:bg-emerald-950 text-emerald-600",
};

// ─── Receipt PDF generator ─────────────────────────────────────────────────────
// Generates and downloads a rent receipt as a printable HTML page.
// No server dependency — pure client-side, works offline.

function downloadReceipt(p: any, tenant: any, unitNumber: string | null, propertyData: any) {
  const receiptNo = p.mpesaTransactionId || p.invoiceNumber || `RCP-${p.id}`;
  const isPaid    = p.status === "paid" || p.status === "completed";
  const currency  = tenant?.currency || "KES";

  const body = `
    ${spHeader("Rent Receipt", receiptNo, new Date().toISOString(), propertyData?.name)}
    <div class="sp-grid-2">
      <div class="sp-section">
        <div class="sp-section-title">Tenant Details</div>
        <div class="sp-row"><span class="sp-label">Name</span><span class="sp-value">${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}</span></div>
        <div class="sp-row"><span class="sp-label">Unit</span><span class="sp-value">${unitNumber ? `Unit ${unitNumber}` : "—"}</span></div>
        <div class="sp-row"><span class="sp-label">Email</span><span class="sp-value">${tenant?.email ?? "—"}</span></div>
        <div class="sp-row"><span class="sp-label">Phone</span><span class="sp-value">${tenant?.phone ?? "—"}</span></div>
      </div>
      <div class="sp-section">
        <div class="sp-section-title">Payment Details</div>
        <div class="sp-row"><span class="sp-label">Due Date</span><span class="sp-value">${fmtDocDate(p.dueDate)}</span></div>
        <div class="sp-row"><span class="sp-label">Paid Date</span><span class="sp-value">${fmtDocDate(p.paidDate)}</span></div>
        <div class="sp-row"><span class="sp-label">Method</span><span class="sp-value">${p.paymentMethod ? p.paymentMethod.toUpperCase() : "—"}</span></div>
        <div class="sp-row"><span class="sp-label">Reference</span><span class="sp-value">${p.mpesaTransactionId ?? p.invoiceNumber ?? "—"}</span></div>
      </div>
    </div>
    <div class="sp-amount-box">
      <div class="sp-amount">${fmtDocKES(p.amount, currency)}</div>
      <div class="sp-amount-label">Rent payment — ${propertyData?.name ?? ""}${unitNumber ? ` · Unit ${unitNumber}` : ""}</div>
      ${isPaid ? '<div class="sp-stamp">PAID</div>' : ""}
    </div>
    ${spFooter()}
  `;
  openPrintWindow(body, `Rent Receipt – ${receiptNo}`);
}

// ─── Payment history table with search + pagination + receipt download ─────────

function PaymentHistoryTable({ payments, isLoading, tenant, unitNumber, propertyData }: {
  payments: any[]; isLoading: boolean; tenant: any; unitNumber: string | null; propertyData: any;
}) {
  const [search, setSearch]     = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage]         = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payments.filter(p =>
      !q ||
      fmtDate(p.dueDate).toLowerCase().includes(q) ||
      (p.status ?? "").toLowerCase().includes(q) ||
      (p.paymentMethod ?? "").toLowerCase().includes(q) ||
      (p.mpesaTransactionId ?? "").toLowerCase().includes(q) ||
      (p.invoiceNumber ?? "").toLowerCase().includes(q) ||
      fmtKES(p.amount).toLowerCase().includes(q)
    );
  }, [payments, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Reset to page 1 when search/pageSize changes
  useEffect(() => { setPage(1); }, [search, pageSize]);

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
    </div>
  );
  if (payments.length === 0) return (
    <div className="text-center py-10">
      <CreditCard className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground">No payments on record.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search payments…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
        <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
          <SelectTrigger className="h-8 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 10, 20].map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">Show {n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      {search && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"
        </p>
      )}

      {/* Payment rows */}
      {paged.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No payments match your search.</p>
      ) : (
        <div className="space-y-2">
          {paged.map(p => {
            const cfg       = PAY_STATUS[p.status] ?? PAY_STATUS.pending;
            const isOverdue = p.status === "overdue";
            const isPaid    = p.status === "paid" || p.status === "completed";
            return (
              <div key={p.id} className={`p-4 rounded-2xl border ${
                isOverdue ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : "border-border"
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-base">{fmtKES(p.amount)}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-xs text-muted-foreground">Due {fmtDate(p.dueDate)}</p>
                      {p.paidDate && <span className="text-xs text-green-600 font-medium">· Paid {fmtDate(p.paidDate)}</span>}
                    </div>
                    {p.paymentMethod && <p className="text-xs text-muted-foreground mt-0.5 capitalize">{p.paymentMethod}</p>}
                    {(p.mpesaTransactionId || p.invoiceNumber) && (
                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                        {p.mpesaTransactionId ? `M-Pesa: ${p.mpesaTransactionId}` : `Inv: ${p.invoiceNumber}`}
                      </p>
                    )}
                    {/* ── Itemized breakdown ── */}
                    {Array.isArray((p as any).lineItems) && (p as any).lineItems.length > 1 && (
                      <div className="mt-2 pt-2 border-t border-border/60 space-y-0.5">
                        {((p as any).lineItems as Array<{ description: string; amount: number; type: string }>).map((li, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                            <span className="truncate mr-3">{li.description}</span>
                            <span className="font-medium shrink-0">{fmtKES(li.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge className={`text-[11px] px-2.5 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>
                    {isPaid && (
                      <button
                        onClick={() => downloadReceipt(p, tenant, unitNumber, propertyData)}
                        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-medium"
                        title="Download receipt"
                      >
                        <Download className="w-3 h-3" /> Receipt
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              ‹ Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Repairs list panel with search + pagination ───────────────────────────────

function RepairsListPanel({ requests, isLoading, onRefresh }: {
  requests: any[]; isLoading: boolean; onRefresh: () => void;
}) {
  const [search, setSearch]     = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage]         = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return requests
      .filter(r => statusFilter === "all" || r.status === statusFilter)
      .filter(r =>
        !q ||
        (r.title ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        (r.priority ?? "").toLowerCase().includes(q) ||
        String(r.ticketNumber ?? r.id).toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (a.priority === "urgent" && a.status !== "completed" && b.priority !== "urgent") return -1;
        if (b.priority === "urgent" && b.status !== "completed" && a.priority !== "urgent") return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [requests, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [search, pageSize, statusFilter]);

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
    </div>
  );

  if (requests.length === 0) return (
    <div className="text-center py-10 text-muted-foreground">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
        <CheckSquare className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-medium">No requests yet</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Use the form above to report an issue.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search requests…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All status</SelectItem>
            <SelectItem value="pending" className="text-xs">Submitted</SelectItem>
            <SelectItem value="assigned" className="text-xs">Assigned</SelectItem>
            <SelectItem value="in_progress" className="text-xs">In Progress</SelectItem>
            <SelectItem value="completed" className="text-xs">Resolved</SelectItem>
            <SelectItem value="cancelled" className="text-xs">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
          <SelectTrigger className="h-8 text-xs w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 10, 20].map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">Show {n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRefresh}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {(search || statusFilter !== "all") && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          {search ? ` for "${search}"` : ""}
          {statusFilter !== "all" ? ` · ${statusFilter.replace("_", " ")}` : ""}
        </p>
      )}

      {paged.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No requests match your filters.</p>
      ) : (
        <div className="space-y-3">
          {paged.map(r => <MaintenanceCard key={r.id} req={r} />)}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              ‹ Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsPanel({
  docs,
  isLoading,
  tenantId,
  onUploaded,
}: {
  docs: any[];
  isLoading: boolean;
  tenantId?: number;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const file of Array.from(files)) {
      // 10 MB limit
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: `${file.name} is too large`, description: "Maximum file size is 10 MB.", variant: "destructive" });
        failCount++;
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (tenantId) formData.append("tenantId", String(tenantId));
        formData.append("type", "tenant_upload");
        await uploadWithAuth("/api/documents", formData);
        successCount++;
      } catch (err: any) {
        toast({ title: `Failed to upload ${file.name}`, description: err.message, variant: "destructive" });
        failCount++;
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast({ title: `${successCount} file${successCount > 1 ? "s" : ""} uploaded successfully` });
      onUploaded();
    }
    // Reset input so the same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // Split docs: manager-shared vs tenant-uploaded
  const sharedDocs   = docs.filter(d => d.type !== "tenant_upload");
  const uploadedDocs = docs.filter(d => d.type === "tenant_upload");

  // Check if any lease agreement document exists (shared or uploaded)
  const hasLeaseDoc = docs.some(d =>
    /lease|tenancy|agreement|contract/i.test(d.name ?? "") ||
    /lease|tenancy|agreement/i.test(d.type ?? "")
  );

  const DocRow = ({ doc }: { doc: any }) => {
    const ext = doc.name?.split(".").pop()?.toUpperCase() || "FILE";
    const extCls = EXT_COLOR[ext] || "bg-muted text-muted-foreground";
    return (
      <div className="flex items-center justify-between p-4 rounded-2xl border border-border hover:border-primary/30 hover:shadow-sm transition-all gap-3 group">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-[11px] ${extCls}`}>
            {ext}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{doc.name}</p>
            <p className="text-xs text-muted-foreground capitalize mt-0.5">
              {doc.type !== "tenant_upload" ? doc.type : "Your upload"}
              {doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ""}
              {doc.createdAt ? ` · ${fmtDate(doc.createdAt)}` : ""}
            </p>
          </div>
        </div>
        <a
          href={`/api/documents/${doc.id}/download`}
          target="_blank" rel="noopener noreferrer"
          className="flex-shrink-0"
        >
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Download className="w-3.5 h-3.5" /> Download
          </Button>
        </a>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Lease agreement prompt — shown when no lease doc is found */}
      {!isLoading && !hasLeaseDoc && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <FileText className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">No lease agreement on file</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
              If you signed a hardcopy lease, scan or photograph it and upload it here so both you and your manager have a digital record. Accepted formats: PDF, JPG, PNG.
            </p>
            <Button
              size="sm"
              className="mt-3 h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-3.5 h-3.5" /> Upload Signed Lease
            </Button>
          </div>
        </div>
      )}

      {/* Upload drop-zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/40"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
            dragOver ? "bg-primary/10" : "bg-muted"
          }`}>
            {uploading
              ? <Loader2 className="w-6 h-6 text-primary animate-spin" />
              : <Upload className={`w-6 h-6 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {uploading ? "Uploading…" : "Upload a document"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lease agreement, proof of payment, ID, or any other file · Max 10 MB
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : "Choose files"}
          </Button>
          <p className="text-[11px] text-muted-foreground/60">
            PDF, Word, Excel, JPG, PNG — or drag and drop
          </p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      )}

      {/* Your uploaded documents */}
      {!isLoading && uploadedDocs.length > 0 && (
        <Card className="rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your Uploads</CardTitle>
            <CardDescription>Files you've submitted to your property manager</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {uploadedDocs.map(doc => <DocRow key={doc.id} doc={doc} />)}
          </CardContent>
        </Card>
      )}

      {/* Manager-shared documents */}
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Shared by Manager</CardTitle>
          <CardDescription>Lease agreements, notices, and invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoading && sharedDocs.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center mx-auto mb-3">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <p className="text-sm text-muted-foreground">No documents shared yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sharedDocs.map(doc => <DocRow key={doc.id} doc={doc} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Threaded messages panel ───────────────────────────────────────────────────
//
// Groups flat messages into conversations by normalised subject, then renders
// them as iMessage-style bubbles — tenant on the right, manager on the left.
// Tapping a conversation expands it and shows an inline reply box.

type Thread = {
  subject: string;
  messages: any[];
  lastAt: string;
  hasUnread: boolean;
  managerUserId: string | null; // fromUserId of received messages — the person to reply to
};

function MessagesPanel({
  messages,
  isLoading,
  onRefresh,
  onSend,
  isSending,
  onMarkRead,
  managerName,
}: {
  messages: any[];
  isLoading: boolean;
  onRefresh: () => void;
  onSend: (subject: string, content: string, toUserId: string | null) => Promise<void>;
  isSending: boolean;
  onMarkRead: (ids: number[]) => void;
  managerName: string | null;
}) {
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [showCompose, setShowCompose] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newContent, setNewContent] = useState("");
  const bottomRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Group messages into threads by normalised subject
  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, any[]>();
    const sorted = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    for (const m of sorted) {
      const key = (m.subject ?? "(no subject)").replace(/^re:\s*/i, "").trim().toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries())
      .map(([, msgs]) => ({
        subject: msgs[0].subject ?? "(no subject)",
        messages: msgs,
        lastAt: msgs[msgs.length - 1].createdAt,
        hasUnread: msgs.some(m => !m.isSentByMe && !m.isRead),
        // The manager's userId — taken from the fromUserId of any received message
        managerUserId: msgs.find(m => !m.isSentByMe)?.fromUserId ?? null,
      }))
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }, [messages]);

  // Auto-scroll to bottom when a thread opens or gets a new message
  useEffect(() => {
    if (openThread && bottomRefs.current[openThread]) {
      bottomRefs.current[openThread]!.scrollIntoView({ behavior: "smooth" });
    }
  }, [openThread, messages.length]);

  // When a thread is opened, mark all its unread received messages as read
  const handleOpenThread = (subject: string) => {
    const isOpening = openThread !== subject;
    setOpenThread(isOpening ? subject : null);

    if (isOpening) {
      const thread = threads.find(t => t.subject === subject);
      if (thread) {
        const unreadIds = thread.messages
          .filter(m => !m.isSentByMe && !m.isRead)
          .map(m => m.id);
        if (unreadIds.length > 0) onMarkRead(unreadIds);
      }
    }
  };

  // The manager's userId — taken from any received message across all threads.
  // Used when composing a brand-new message with no prior thread to reference.
  const anyManagerUserId = useMemo(
    () => messages.find(m => !m.isSentByMe)?.fromUserId ?? null,
    [messages]
  );
  const anyManagerName = useMemo(
    () => messages.find(m => !m.isSentByMe)?.fromName ?? null,
    [messages]
  );

  const handleReply = async (thread: Thread) => {
    const content = (replyText[thread.subject] ?? "").trim();
    if (!content) return;
    await onSend(`Re: ${thread.subject}`, content, thread.managerUserId);
    setReplyText(prev => ({ ...prev, [thread.subject]: "" }));
  };

  const handleNewMessage = async () => {
    if (!newSubject.trim() || !newContent.trim()) return;
    await onSend(newSubject, newContent, anyManagerUserId);
    setNewSubject("");
    setNewContent("");
    setShowCompose(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading messages…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {threads.length === 0 ? "No messages yet" : `${threads.length} conversation${threads.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRefresh}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white"
            onClick={() => setShowCompose(v => !v)}>
            <Send className="w-3.5 h-3.5" /> New Message
          </Button>
        </div>
      </div>

      {/* Compose new message */}
      {showCompose && (
        <Card className="rounded-2xl border-primary/30 shadow-sm">
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-slate-900">New Message to Property Manager</h3>
            {managerName ? (
              <CardDescription className="flex items-center gap-1.5">
                <User className="w-3 h-3" />
                Will be sent to <span className="font-medium text-foreground">{managerName}</span>
              </CardDescription>
            ) : (
              <CardDescription className="flex items-center gap-1.5">
                <User className="w-3 h-3" />
                Will be routed to your property manager
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Subject"
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              className="h-9 text-sm"
            />
            <Textarea
              placeholder="Type your message…"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={4}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white h-9 text-sm"
                onClick={handleNewMessage}
                disabled={isSending || !newSubject.trim() || !newContent.trim()}
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-1.5" />Send</>}
              </Button>
              <Button variant="outline" className="h-9 text-sm" onClick={() => setShowCompose(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {threads.length === 0 && (
        <Card className="rounded-2xl border-border shadow-none">
          <CardContent className="py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground">No conversations yet</p>
            <p className="text-xs text-muted-foreground mt-1">Tap "New Message" above to contact your property manager.</p>
          </CardContent>
        </Card>
      )}

      {/* Thread list */}
      {threads.map(thread => {
        const isOpen = openThread === thread.subject;
        const lastMsg = thread.messages[thread.messages.length - 1];

        return (
          <Card key={thread.subject} className={`rounded-2xl shadow-none transition-all ${
            thread.hasUnread ? "border-blue-200 dark:border-blue-800" : "border-border"
          }`}>
            {/* Thread header — always visible, click to expand */}
            <button
              className="w-full text-left p-4 flex items-start gap-3"
              onClick={() => handleOpenThread(thread.subject)}
            >
              {/* Avatar */}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                thread.hasUnread
                  ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                  : "bg-muted text-muted-foreground"
              }`}>
                PM
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm truncate ${thread.hasUnread ? "font-bold text-foreground" : "font-medium text-foreground"}`}>
                    {thread.subject}
                  </p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {thread.hasUnread && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                    <span className="text-[11px] text-muted-foreground">{fmtDate(thread.lastAt)}</span>
                    {isOpen
                      ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {lastMsg.isSentByMe ? "You: " : `${lastMsg.fromName ?? "Manager"}: `}
                  {lastMsg.content}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}
                </p>
              </div>
            </button>

            {/* Expanded thread: chat bubbles + reply box */}
            {isOpen && (
              <div className="border-t border-border">
                {/* Chat bubble area */}
                <div className="p-4 space-y-3 max-h-96 overflow-y-auto bg-muted/30">
                  {thread.messages.map((m, i) => {
                    const isMe = m.isSentByMe;
                    const showSender = i === 0 || thread.messages[i - 1].isSentByMe !== isMe;
                    return (
                      <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                        {showSender && (
                          <p className="text-[11px] text-muted-foreground mb-1 px-1">
                            {isMe ? "You" : (m.fromName ?? "Property Manager")}
                          </p>
                        )}
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          isMe
                            ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-br-sm"
                            : "bg-white dark:bg-card border border-border text-foreground rounded-bl-sm shadow-sm"
                        }`}>
                          {m.content}
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5 px-1">
                          {fmtDateTime(m.createdAt)}
                        </p>
                      </div>
                    );
                  })}
                  <div ref={el => { bottomRefs.current[thread.subject] = el; }} />
                </div>

                {/* Reply box */}
                <div className="p-3 border-t border-border bg-card flex gap-2 items-end">
                  <Textarea
                    placeholder={`Reply to "${thread.subject}"…`}
                    rows={2}
                    className="flex-1 text-sm resize-none"
                    value={replyText[thread.subject] ?? ""}
                    onChange={e => setReplyText(prev => ({ ...prev, [thread.subject]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleReply(thread);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-9 w-9 p-0 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white flex-shrink-0"
                    onClick={() => handleReply(thread)}
                    disabled={isSending || !(replyText[thread.subject] ?? "").trim()}
                    title="Send reply (Ctrl+Enter)"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Ratings Tab ──────────────────────────────────────────────────────────────

function RatingsTab({ tenantId }: { tenantId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: targets, isLoading } = useQuery<any>({
    queryKey: ["/api/ratings/targets"],
    queryFn: async () => (await apiRequest("/api/ratings/targets")).json(),
    enabled: !!tenantId,
  });

  // Rating state per category
  const [maintRatings, setMaintRatings] = useState<Record<number, { rating: number; comment: string; title: string }>>({});
  const [caretakerRating, setCaretakerRating] = useState({ rating: 0, comment: "", title: "" });
  const [landlordRating, setLandlordRating] = useState({ rating: 0, comment: "", title: "" });

  const submitMutation = useMutation({
    mutationFn: async ({ type, payload }: { type: string; payload: any }) => {
      const r = await apiRequest(`/api/ratings/${type}`, { method: "POST", data: payload });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Rating submitted!", description: "Thank you for your feedback." });
      queryClient.invalidateQueries({ queryKey: ["/api/ratings/targets"] });
    },
    onError: () => toast({ title: "Could not submit rating", variant: "destructive" }),
  });

  const ratingLabel = (n: number) => ["", "Poor", "Fair", "Good", "Very Good", "Excellent"][n] ?? "";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const maint: any[] = targets?.maintenanceRequests ?? [];
  const caretaker: any = targets?.caretaker ?? null;
  const landlord: any = targets?.landlord ?? null;

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-500" /> Rate Your Experience
          </CardTitle>
          <CardDescription>
            Help us improve by rating the people who serve you. Your feedback is private and sent to property management only.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ── Maintenance Requests ──────────────────────────────────────────── */}
      {maint.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wrench className="w-4 h-4 text-blue-500" /> Completed Maintenance Jobs
          </h3>
          {maint.map((mr: any) => {
            const local = maintRatings[mr.id] ?? { rating: mr.satisfactionRating ?? 0, comment: mr.satisfactionComments ?? "", title: "" };
            const alreadyRated = mr.satisfactionRating > 0;
            return (
              <Card key={mr.id} className="rounded-2xl border-border shadow-none">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{mr.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Completed {mr.completedAt ? format(new Date(mr.completedAt), "d MMM yyyy") : "recently"}
                      </p>
                    </div>
                    {alreadyRated && (
                      <Badge className="text-xs shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">Rated</Badge>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <StarRating
                        value={local.rating}
                        onChange={n => setMaintRatings(prev => ({ ...prev, [mr.id]: { ...local, rating: n } }))}
                      />
                      {local.rating > 0 && (
                        <span className="text-xs text-muted-foreground">{ratingLabel(local.rating)}</span>
                      )}
                    </div>
                    <Input
                      placeholder="Short title (optional)"
                      className="text-sm h-8"
                      value={local.title}
                      onChange={e => setMaintRatings(prev => ({ ...prev, [mr.id]: { ...local, title: e.target.value } }))}
                    />
                    <Textarea
                      placeholder="Tell us how the job was handled… (optional)"
                      rows={2}
                      className="text-sm resize-none"
                      value={local.comment}
                      onChange={e => setMaintRatings(prev => ({ ...prev, [mr.id]: { ...local, comment: e.target.value } }))}
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={local.rating === 0 || submitMutation.isPending}
                      onClick={() =>
                        submitMutation.mutate({
                          type: "maintenance",
                          payload: { maintenanceRequestId: mr.id, rating: local.rating, title: local.title, comment: local.comment },
                        })
                      }
                    >
                      {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                      {alreadyRated ? "Update Rating" : "Submit Rating"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Caretaker ────────────────────────────────────────────────────── */}
      {caretaker && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-500" /> Property Caretaker
          </h3>
          <Card className="rounded-2xl border-border shadow-none">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-center gap-3">
                <SPAvatar
                  name={`${caretaker.firstName ?? ""} ${caretaker.lastName ?? ""}`.trim() || "Caretaker"}
                  size="md"
                />
                <div>
                  <p className="text-sm font-medium">
                    {`${caretaker.firstName ?? ""} ${caretaker.lastName ?? ""}`.trim() || "Your Caretaker"}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">{caretaker.caretakerType?.replace(/_/g, " ")}</p>
                </div>
                {caretaker.existingReview && (
                  <Badge className="ml-auto text-xs shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">Rated</Badge>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <StarRating value={caretakerRating.rating} onChange={n => setCaretakerRating(p => ({ ...p, rating: n }))} />
                  {caretakerRating.rating > 0 && (
                    <span className="text-xs text-muted-foreground">{ratingLabel(caretakerRating.rating)}</span>
                  )}
                </div>
                <Input
                  placeholder="Short title (optional)"
                  className="text-sm h-8"
                  value={caretakerRating.title}
                  onChange={e => setCaretakerRating(p => ({ ...p, title: e.target.value }))}
                />
                <Textarea
                  placeholder="How responsive and helpful is your caretaker?… (optional)"
                  rows={2}
                  className="text-sm resize-none"
                  value={caretakerRating.comment}
                  onChange={e => setCaretakerRating(p => ({ ...p, comment: e.target.value }))}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={caretakerRating.rating === 0 || submitMutation.isPending}
                  onClick={() =>
                    submitMutation.mutate({
                      type: "caretaker",
                      payload: { caretakerId: caretaker.id, rating: caretakerRating.rating, title: caretakerRating.title, comment: caretakerRating.comment },
                    })
                  }
                >
                  {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                  {caretaker.existingReview ? "Update Rating" : "Submit Rating"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Landlord / Property ───────────────────────────────────────────── */}
      {landlord && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Building className="w-4 h-4 text-purple-500" /> Landlord / Property Management
          </h3>
          <Card className="rounded-2xl border-border shadow-none">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{landlord.name}</p>
                  <p className="text-xs text-muted-foreground">{landlord.address}</p>
                </div>
                {landlord.existingReview && (
                  <Badge className="text-xs shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">Rated</Badge>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <StarRating value={landlordRating.rating} onChange={n => setLandlordRating(p => ({ ...p, rating: n }))} />
                  {landlordRating.rating > 0 && (
                    <span className="text-xs text-muted-foreground">{ratingLabel(landlordRating.rating)}</span>
                  )}
                </div>
                <Input
                  placeholder="Short title (optional)"
                  className="text-sm h-8"
                  value={landlordRating.title}
                  onChange={e => setLandlordRating(p => ({ ...p, title: e.target.value }))}
                />
                <Textarea
                  placeholder="How has your overall experience been as a tenant?… (optional)"
                  rows={2}
                  className="text-sm resize-none"
                  value={landlordRating.comment}
                  onChange={e => setLandlordRating(p => ({ ...p, comment: e.target.value }))}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={landlordRating.rating === 0 || submitMutation.isPending}
                  onClick={() =>
                    submitMutation.mutate({
                      type: "landlord",
                      payload: { propertyId: landlord.id, rating: landlordRating.rating, title: landlordRating.title, comment: landlordRating.comment },
                    })
                  }
                >
                  {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                  {landlord.existingReview ? "Update Rating" : "Submit Rating"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {maint.length === 0 && !caretaker && !landlord && (
        <EmptyState
          icon={<Star className="w-8 h-8 text-muted-foreground" />}
          title="Nothing to rate yet"
          description="You can rate maintenance jobs once they're completed, and rate your caretaker or landlord once you're assigned to a unit."
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TenantPortalProps {
  tenantId?: number;
  /**
   * Pre-fetched tenant record from /api/tenants/me (passed by TenantPortalWrapper).
   * The /me response already joins unit + property, so the portal never has to
   * call /api/units/:id or /api/properties/:id (both are STAFF_AND_ABOVE).
   * Providing this avoids a redundant network round-trip and eliminates the 403s
   * those staff-only endpoints would return for a tenant-role JWT.
   */
  initialTenantData?: any;
}

export default function TenantPortal({ tenantId, initialTenantData }: TenantPortalProps) {
  const { t } = useTranslation();
  const MAINT_STATUS = getMaintStatus(t);
  const PRIORITY_CONFIG = getPriorityConfig(t);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // wouter's useLocation only tracks pathname, not query string.
  // We use a separate state that syncs with window.location.search.
  const getTabFromUrl = () => new URLSearchParams(window.location.search).get("tab") ?? "dashboard";
  const [activeTab, setActiveTabState] = useState(getTabFromUrl);
  useEffect(() => {
    const sync = () => setActiveTabState(getTabFromUrl());
    window.addEventListener("popstate", sync);
    // Also sync on any navigation via wouter (which uses history.pushState)
    const origPush = history.pushState.bind(history);
    history.pushState = (...args) => { origPush(...args); sync(); };
    return () => {
      window.removeEventListener("popstate", sync);
      history.pushState = origPush;
    };
  }, []);
  const setActiveTab = (tab: string) => {
    navigate(`/tenant-portal?tab=${tab}`);
    setActiveTabState(tab);
  };
  // Onboarding: show wizard if this tenant hasn\'t seen it on this device
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Online/offline detection
  useEffect(() => {
    const up   = () => { setIsOnline(true);  toast({ title: "Back online ✓" }); };
    const down = () => { setIsOnline(false); toast({ title: "No connection", description: "Some features may be limited.", variant: "destructive" }); };
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [toast]);

  // ── Real-time WebSocket listeners ─────────────────────────────────────────
  // These keep the portal live without manual refresh

  useWsEvent("maintenance:updated", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
  });

  useWsEvent("message:new", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    toast({ title: "New message", description: "You have a new message from your property manager." });
  });

  useWsEvent("payment:confirmed", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
    toast({ title: "Payment confirmed ✓", description: "Your payment has been received." });
  });

  useWsEvent("broadcast", (payload: any) => {
    toast({ title: payload?.title ?? "Notice from property", description: payload?.message ?? "" });
    // Invalidate the notifications query (not /api/broadcast-messages which is ADMIN_MANAGER only)
    queryClient.invalidateQueries({ queryKey: ["/api/notifications", "tenant-broadcasts"] });
  });

  // ── Auth guard ───────────────────────────────────────────────────────────
  // Read the logged-in user inside the component so we can enforce org isolation.
  // Even though TenantPortalWrapper already does the role check, this second check
  // ensures that if the component is ever rendered via another path the same rules
  // still apply.
  const { user: authUser } = useAuth();

  // ── Data fetching ─────────────────────────────────────────────────────────
  //
  // Primary source: initialTenantData from /api/tenants/me (already joins unit +
  // property on the server). We seed React Query's cache with it so subsequent
  // invalidations still work, but avoid a redundant GET /api/tenants/:id call.
  //
  // Fallback: if initialTenantData is absent (e.g. the component is mounted
  // directly without the wrapper) we fall back to GET /api/tenants/me which is
  // safe for tenant-role tokens, rather than GET /api/tenants/:id which
  // requires STAFF_AND_ABOVE.

  const { data: tenant, isLoading: tenantLoading } = useQuery<any>({
    queryKey: ["/api/tenants/me"],
    queryFn: async () => {
      // Use /me (tenant-accessible) instead of /api/tenants/:id (staff-only)
      const r = await apiRequest("/api/tenants/me");
      if (!r.ok) throw new Error("tenant_not_found");
      return r.json();
    },
    // Pre-populate the cache with the data TenantPortalWrapper already fetched.
    // This makes the query consider itself already resolved and skip the network
    // round-trip on first render, while still allowing future invalidations.
    initialData: initialTenantData,
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  // Org isolation check: after data arrives, verify the tenant belongs to the
  // same org as the logged-in user.  The server enforces this too, but an extra
  // client-side assertion prevents stale-cache cross-org leaks.
  const orgMismatch =
    tenant && authUser?.organizationId && tenant.organizationId !== authUser.organizationId;

  // Show onboarding wizard the first time a tenant logs in on this device
  useEffect(() => {
    if (tenant?.id && !hasCompletedOnboarding(tenant.id)) {
      // Small delay so the portal renders first (avoids a flash)
      const t = setTimeout(() => setShowOnboarding(true), 600);
      return () => clearTimeout(t);
    }
  }, [tenant?.id]);

  // Unit and property are now embedded in the /me response — no separate calls
  // to /api/units/:id or /api/properties/:id (both are STAFF_AND_ABOVE and would
  // 403 for tenant-role JWTs).
  const unitData    = tenant?.unit     ?? null;
  const propertyData = tenant?.property ?? null;

  // Unified unit number
  const unitNumber: string | null =
    unitData?.unitNumber ?? tenant?.unitNumber ?? null;

  const { data: paymentsRaw, isLoading: paymentsLoading } = useQuery<any>({
    queryKey: ["/api/tenants", tenantId, "payments"],
    queryFn: async () => {
      const r = await apiRequest(`/api/tenants/${tenantId}/payments`);
      return ensureArray(await r.json());
    },
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
  });
  const payments: any[] = Array.isArray(paymentsRaw) ? paymentsRaw : [];

  const { data: maintRaw, isLoading: maintLoading, refetch: refetchMaint } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000,
  });
  const allMaint: any[] = Array.isArray(maintRaw) ? maintRaw : [];
  const myRequests = useMemo(() =>
    allMaint.filter(r => r.tenantId === tenantId),
    [allMaint, tenantId]);

  const { data: docsRaw, isLoading: docsLoading } = useQuery<any>({
    queryKey: ["/api/documents", tenantId],
    queryFn: async () => {
      const r = await apiRequest(`/api/documents?tenantId=${tenantId}&limit=50`);
      const d = await r.json();
      return ensureArray(Array.isArray(d) ? d : d?.results ?? []);
    },
    enabled: !!tenantId && activeTab === "documents",
    staleTime: 5 * 60 * 1000,
  });
  const docs: any[] = Array.isArray(docsRaw) ? docsRaw : [];

  // Fetch ALL messages (sent + received) so we can build threads from both sides
  const { data: messagesRaw, isLoading: msgsLoading, refetch: refetchMessages } = useQuery<any>({
    queryKey: ["/api/messages", "all"],
    queryFn: async () => {
      const r = await apiRequest("/api/messages?box=all&limit=100");
      const d = await r.json();
      return ensureArray(Array.isArray(d) ? d : d?.results ?? []);
    },
    enabled: !!tenantId && (activeTab === "messages" || activeTab === "dashboard"),
    staleTime: 30 * 1000,
  });
  const messages: any[] = Array.isArray(messagesRaw) ? messagesRaw : [];

  // Broadcast announcements from property manager.
  // NOTE: /api/broadcast-messages is ADMIN_MANAGER only — tenants would 403.
  // Instead, use /api/notifications (ALL_AUTHENTICATED) which surfaces broadcast
  // notices that the server has already fanned out to the tenant's notification feed.
  const { data: broadcastsRaw } = useQuery<any>({
    queryKey: ["/api/notifications", "tenant-broadcasts"],
    queryFn: async () => {
      const r = await apiRequest("/api/notifications?limit=20&type=broadcast");
      const d = await r.json();
      return ensureArray(Array.isArray(d) ? d : d?.results ?? []);
    },
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });
  // Only show recent announcements (last 30 days)
  const announcements: any[] = useMemo(() => {
    const raw: any[] = Array.isArray(broadcastsRaw) ? broadcastsRaw : [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return raw
      .filter(b => new Date(b.createdAt ?? 0).getTime() > cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [broadcastsRaw]);

  // Utility bills for this tenant
  const { data: utilityBillsRaw, isLoading: utilityBillsLoading, refetch: refetchUtilityBills } = useQuery<any[]>({
    queryKey: ["/api/utility-bills/my-bills", tenantId],
    queryFn: async () => {
      const r = await apiRequest(`/api/utility-bills/my-bills?tenantId=${tenantId}`);
      return ensureArray(await r.json());
    },
    enabled: !!tenantId && activeTab === "utilities",
    staleTime: 2 * 60 * 1000,
  });
  const myUtilityBills: any[] = Array.isArray(utilityBillsRaw) ? utilityBillsRaw : [];

  // Payment config (paybill/till/bank details configured by admin)
  const { data: paymentConfig } = useQuery<any>({
    queryKey: ["/api/payment-config/public"],
    queryFn: async () => {
      const r = await apiRequest("/api/payment-config/public");
      return r.json();
    },
    enabled: !!tenantId,
    staleTime: 10 * 60 * 1000,
  });

  // ── Derived values ────────────────────────────────────────────────────────

  const paidPayments    = payments.filter(p => ["paid", "completed"].includes(p.status));
  const overduePayments = payments.filter(p => p.status === "overdue");
  const pendingPayments = payments.filter(p => p.status === "pending");

  const lastPayment = paidPayments.sort((a, b) =>
    new Date(b.paidDate ?? b.createdAt).getTime() - new Date(a.paidDate ?? a.createdAt).getTime()
  )[0] ?? null;

  const nextDue = pendingPayments.sort((a, b) =>
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  )[0] ?? null;

  const leaseEndDays    = daysUntil(tenant?.leaseEndDate);
  const leasePct        = leaseProgress(tenant?.leaseStartDate, tenant?.leaseEndDate);
  const openRequests    = myRequests.filter(r => !["completed", "cancelled"].includes(r.status));
  const urgentRequests  = openRequests.filter(r => r.priority === "urgent");
  const unreadMessages  = messages.filter(m => !m.isSentByMe && !m.isRead).length;
  const anyManagerName  = messages.find(m => !m.isSentByMe)?.fromName ?? null;

  // Payment reference — the exact invoice id, same format/helper the C2B
  // matcher expects (shared/paymentReference.ts). Previously this was
  // tenant-initials + unit number, which never encoded the actual invoice
  // id at all, so a manual Paybill payment could never be auto-matched by
  // reference — only ever by the less-reliable phone+amount fuzzy match.
  const nextRentPaymentId = nextDue?.id ?? overduePayments[0]?.id;
  const payRef = nextRentPaymentId != null ? buildRentAccountReference(nextRentPaymentId) : `TEN-${tenantId}`;

  // Notices derived from real data
  const notices = useMemo(() => {
    const n: Array<{ title: string; content: string; type: "info" | "warning" | "success"; date?: string }> = [];
    if (overduePayments.length > 0) {
      const total = overduePayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
      n.push({ type: "warning", title: `Overdue Payment — ${fmtKES(total)}`, content: "You have overdue rent payments. Please settle immediately to avoid penalties." });
    }
    if (leaseEndDays !== null && leaseEndDays > 0 && leaseEndDays <= 90) {
      n.push({ type: "warning", title: `Lease Expiring in ${leaseEndDays} days`, content: `Your lease ends on ${fmtDate(tenant?.leaseEndDate)}. Contact your property manager about renewal.` });
    }
    if (urgentRequests.length > 0) {
      n.push({ type: "warning", title: `${urgentRequests.length} Urgent Maintenance Request${urgentRequests.length > 1 ? "s" : ""}`, content: "You have urgent maintenance issues marked as immediate. Our team will be in touch shortly." });
    }
    if (lastPayment && paidPayments.length > 0) {
      n.push({ type: "success", title: "Last Payment Received", content: `${fmtKES(lastPayment.amount)} received on ${fmtDate(lastPayment.paidDate ?? lastPayment.createdAt)}. Thank you!` });
    }
    // Manager broadcast announcements — shown first so they're most visible
    for (const b of announcements.slice(0, 3)) {
      n.unshift({ type: "info", title: b.title, content: b.content, date: fmtDate(b.createdAt) });
    }
    return n;
  }, [overduePayments, leaseEndDays, urgentRequests, lastPayment, paidPayments, tenant, announcements]);

  // Lease renewal eligibility (within 90 days of end)
  const leaseRenewalDue = leaseEndDays !== null && leaseEndDays > 0 && leaseEndDays <= 90;

  // Unpaid utility bills count
  const unpaidUtilityBills = myUtilityBills.filter(b => b.status === "pending" || b.status === "overdue");

  // ── Forms ─────────────────────────────────────────────────────────────────

  const repairForm = useForm<z.infer<typeof repairSchema>>({
    resolver: zodResolver(repairSchema),
    defaultValues: { title: "", description: "", priority: "medium", category: "" },
  });

  const submitRepair = useMutation({
    mutationFn: async (data: z.infer<typeof repairSchema>) => {
      if (!tenant?.unitId) throw new Error("NO_UNIT");
      const r = await apiRequest("/api/maintenance-requests", {
        method: "POST",
        data: { ...data, tenantId, unitId: tenant.unitId, currency: "KES", status: "pending" },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Submission failed");
      }
      return r.json();
    },
    onSuccess: (created) => {
      toast({ title: "✓ Request submitted", description: `Ticket #${created.ticketNumber ?? created.id} logged. You'll be notified of updates.` });
      repairForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      setActiveTab("repairs");
    },
    onError: (err: any) => {
      if (err.message === "NO_UNIT") {
        toast({ title: "Cannot submit", description: "Your unit hasn't been set. Contact your property manager.", variant: "destructive" });
      } else {
        toast({ title: "Submission failed", description: err.message, variant: "destructive" });
      }
    },
  });


  const sendMessage = useMutation({
    mutationFn: async (data: { subject: string; content: string; toUserId: string | null }) => {
      const r = await apiRequest("/api/messages", {
        method: "POST",
        data: {
          subject:     data.subject,
          content:     data.content,
          toUserId:    data.toUserId,
          channel:     "app",
          type:        "chat",
          messageType: "direct",
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Failed to send");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "✓ Message sent", description: "Your property manager will respond shortly." });
      refetchMessages();
    },
    onError: () => toast({ title: "Could not send message", variant: "destructive" }),
  });

  // Mark a batch of message IDs as read — optimistic update so the badge
  // clears immediately; then re-fetches in the background to sync server state
  const markRead = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(
        ids.map(id =>
          apiRequest(`/api/messages/${id}/read`, { method: "PATCH" })
        )
      );
    },
    onMutate: async (ids: number[]) => {
      // Optimistically update the cached messages so the badge clears instantly
      const key = ["/api/messages", "all"];
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, (old: any[] | undefined) =>
        (old ?? []).map(m => ids.includes(m.id) ? { ...m, isRead: true } : m)
      );
    },
    onSettled: () => refetchMessages(),
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  // ── Org-isolation guard ──────────────────────────────────────────────────
  // After data loads, verify the tenant record belongs to the logged-in user's
  // organisation.  The server enforces this on every API call, but this client-
  // side check prevents stale React Query cache entries from leaking cross-org
  // data if a user somehow switches org context without a full page reload.
  if (orgMismatch) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm space-y-3">
          <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <p className="text-lg font-semibold text-foreground">Access denied</p>
          <p className="text-sm text-muted-foreground">
            This tenant profile does not belong to your organisation.
            Please log out and log back in with the correct account.
          </p>
        </div>
      </div>
    );
  }

  if (tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Home className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Loading your portal…</p>
            <p className="text-xs text-muted-foreground mt-1">Please wait a moment</p>
          </div>
        </div>
      </div>
    );
  }

  if (!tenant && !tenantLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-yellow-50 dark:bg-yellow-950 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Profile not found</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your tenant profile could not be loaded. Please contact your property manager for assistance.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">

      {/* Onboarding wizard — shown once per tenant per device */}
      {showOnboarding && tenant && (
        <TenantOnboardingFlow
          tenantId={tenant.id}
          tenantName={`${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim()}
          phone={tenant.phoneNumber ?? ""}
          rentAmount={Number(tenant.monthlyRent ?? 0)}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-orange-500 text-white text-xs text-center py-2 px-4 flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5" />
          You are offline — viewing cached data. Some features may be unavailable.
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-6 py-6 border-b border-white/10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <span className="text-xl font-semibold text-white">
                  {tenant?.firstName?.[0]}{tenant?.lastName?.[0]}
                </span>
              </div>
              <div>
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-0.5">{t("tenantPortal.title")}</p>
                <h1 className="text-xl font-semibold text-white">
                  {t("tenantPortal.welcome")}, {tenant?.firstName}
                </h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {unitNumber && (
                    <span className="flex items-center gap-1 text-white/70 text-xs">
                      <Building className="w-3 h-3" /> Unit {unitNumber}
                    </span>
                  )}
                  {tenant?.leaseEndDate && (
                    <span className="flex items-center gap-1 text-white/70 text-xs">
                      <Calendar className="w-3 h-3" /> Lease ends {fmtDate(tenant.leaseEndDate)}
                    </span>
                  )}
                  {tenant?.email && (
                    <span className="flex items-center gap-1 text-white/70 text-xs">
                      <Mail className="w-3 h-3" /> {tenant.email}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status chips + language toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <LanguageToggle variant="full" className="text-white/80 hover:text-white hover:bg-white/10 border border-white/20 rounded-full px-2 h-7 text-xs" />
              {unreadMessages > 0 && (
                <button onClick={() => setActiveTab("messages")}
                  className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-blue-500/30 transition-colors">
                  <Bell className="w-3 h-3" /> {unreadMessages} new message{unreadMessages > 1 ? "s" : ""}
                </button>
              )}
              {overduePayments.length > 0 && (
                <button onClick={() => setActiveTab("payments")}
                  className="flex items-center gap-1.5 bg-red-500/20 border border-red-400/30 text-red-200 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-red-500/30 transition-colors">
                  <AlertTriangle className="w-3 h-3" /> {overduePayments.length} overdue
                </button>
              )}
              {urgentRequests.length > 0 && (
                <button onClick={() => setActiveTab("repairs")}
                  className="flex items-center gap-1.5 bg-orange-500/20 border border-orange-400/30 text-orange-200 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-orange-500/30 transition-colors">
                  <Wrench className="w-3 h-3" /> {urgentRequests.length} urgent
                </button>
              )}
              <div className="flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Active tenant
              </div>
            </div>
          </div>

          {/* Lease progress bar */}
          {tenant?.leaseStartDate && tenant?.leaseEndDate && (
            <div className="mt-5 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                <span>Lease progress</span>
                <span>{leasePct}% elapsed · {leaseEndDays !== null && leaseEndDays > 0 ? `${leaseEndDays} days remaining` : leaseEndDays === 0 ? "Ends today" : "Expired"}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    leasePct > 85 ? "bg-red-400" : leasePct > 70 ? "bg-yellow-400" : "bg-green-400"
                  }`}
                  style={{ width: `${leasePct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-white/40 mt-1">
                <span>{fmtDate(tenant.leaseStartDate)}</span>
                <span>{fmtDate(tenant.leaseEndDate)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Hidden TabsList — navigation done by custom pill tabs + mobile bottom nav */}
          <TabsList className="hidden">
            <TabsTrigger value="dashboard" /><TabsTrigger value="payments" />
            <TabsTrigger value="repairs" /><TabsTrigger value="utilities" />
            <TabsTrigger value="documents" /><TabsTrigger value="messages" />
            <TabsTrigger value="ratings" /><TabsTrigger value="profile" />
            <TabsTrigger value="visitors" />
          </TabsList>
          {/* ── DASHBOARD ──────────────────────────────────────────────────── */}
          <TabsContent value="dashboard" className="space-y-6">

            {/* Notices */}
            {notices.length > 0 && (
              <div className="space-y-2">
                {notices.map((n, i) => <NoticeCard key={i} notice={n} />)}
              </div>
            )}

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="rounded-2xl border-border shadow-none cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
                onClick={() => setActiveTab("payments")}>
                <CardContent className="p-5">
                  <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-950 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <DollarSign className="w-4.5 h-4.5 text-green-600" />
                  </div>
                  <p className="text-lg font-bold text-foreground leading-tight">{fmtKES(tenant?.monthlyRent)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Monthly Rent</p>
                  {nextDue ? (
                    <p className={`text-[11px] mt-1 font-medium ${
                      daysUntil(nextDue.dueDate) !== null && (daysUntil(nextDue.dueDate) ?? 99) <= 7 ? "text-red-500" : "text-muted-foreground/70"
                    }`}>
                      Due {fmtDate(nextDue.dueDate)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-green-600 mt-1 font-medium">All paid ✓</p>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
                onClick={() => setActiveTab("payments")}>
                <CardContent className="p-5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <CreditCard className="w-4.5 h-4.5 text-blue-600" />
                  </div>
                  <p className="text-lg font-bold text-foreground leading-tight">
                    {lastPayment ? fmtKES(lastPayment.amount) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Last Payment</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    {lastPayment ? fmtDate(lastPayment.paidDate ?? lastPayment.createdAt) : "No payments yet"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none">
                <CardContent className="p-5">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950 flex items-center justify-center mb-3">
                    <Calendar className="w-4.5 h-4.5 text-purple-600" />
                  </div>
                  <p className={`text-lg font-bold leading-tight ${
                    leaseEndDays !== null && leaseEndDays <= 30 ? "text-red-600" :
                    leaseEndDays !== null && leaseEndDays <= 90 ? "text-yellow-600" :
                    "text-foreground"
                  }`}>
                    {leaseEndDays === null ? "—" :
                     leaseEndDays < 0 ? "Expired" :
                     leaseEndDays === 0 ? "Today" :
                     `${leaseEndDays}d`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Lease Remaining</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    {tenant?.leaseEndDate ? `Ends ${fmtDate(tenant.leaseEndDate)}` : "No end date"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border shadow-none cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
                onClick={() => setActiveTab("repairs")}>
                <CardContent className="p-5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform ${
                    urgentRequests.length > 0 ? "bg-red-50 dark:bg-red-950" :
                    openRequests.length > 0 ? "bg-amber-50 dark:bg-amber-950" : "bg-muted"
                  }`}>
                    <Wrench className={`w-4.5 h-4.5 ${
                      urgentRequests.length > 0 ? "text-red-600" :
                      openRequests.length > 0 ? "text-amber-600" : "text-muted-foreground"
                    }`} />
                  </div>
                  <p className="text-lg font-bold text-foreground leading-tight">{openRequests.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Open Requests</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    {myRequests.filter(r => r.status === "completed").length} resolved total
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Quick actions */}
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Quick Actions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <QuickAction
                  icon={DollarSign} color="green"
                  label={t("tenantPortal.payNow")}
                  description="Send M-Pesa payment directly from this screen — no USSD required"
                  onClick={() => setActiveTab("payments")}
                />
                <QuickAction
                  icon={Wrench} color="amber"
                  label="Report a Repair"
                  description="Submit a maintenance or repair request for your unit"
                  onClick={() => setActiveTab("repairs")}
                  badge={urgentRequests.length > 0 ? urgentRequests.length : undefined}
                />
                <QuickAction
                  icon={MessageSquare} color="blue"
                  label="Message Manager"
                  description="Send a message to your property manager"
                  onClick={() => setActiveTab("messages")}
                  badge={unreadMessages > 0 ? unreadMessages : undefined}
                />
                <QuickAction
                  icon={FileText} color="purple"
                  label="View Documents"
                  description="Access your lease agreement and shared documents"
                  onClick={() => setActiveTab("documents")}
                />
                <QuickAction
                  icon={Droplets} color="blue"
                  label="Utility Bills"
                  description="View your water, electricity and other utility bill history"
                  onClick={() => setActiveTab("utilities")}
                  badge={unpaidUtilityBills.length > 0 ? unpaidUtilityBills.length : undefined}
                />
              </div>
            </div>

            {/* In-app notification centre — only shown when there's something actionable */}
            {(unreadMessages > 0 || unpaidUtilityBills.length > 0 || leaseRenewalDue || urgentRequests.length > 0) && (
              <Card className="rounded-2xl border-amber-200 dark:border-amber-800 shadow-none bg-amber-50/50 dark:bg-amber-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BellRing className="w-4 h-4 text-amber-500" /> Action Required
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {unreadMessages > 0 && (
                    <button onClick={() => setActiveTab("messages")} className="w-full flex items-center justify-between text-sm p-3 rounded-xl bg-card border border-border hover:border-blue-300 transition-all group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                          <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                        </div>
                        <span className="font-medium">{unreadMessages} unread message{unreadMessages > 1 ? "s" : ""}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-500 transition-colors" />
                    </button>
                  )}
                  {unpaidUtilityBills.length > 0 && (
                    <button onClick={() => setActiveTab("utilities")} className="w-full flex items-center justify-between text-sm p-3 rounded-xl bg-card border border-border hover:border-sky-300 transition-all group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 flex items-center justify-center">
                          <Droplets className="w-3.5 h-3.5 text-sky-600" />
                        </div>
                        <span className="font-medium">{unpaidUtilityBills.length} unpaid utility bill{unpaidUtilityBills.length > 1 ? "s" : ""}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-sky-500 transition-colors" />
                    </button>
                  )}
                  {leaseRenewalDue && (
                    <button onClick={() => setActiveTab("profile")} className="w-full flex items-center justify-between text-sm p-3 rounded-xl bg-card border border-border hover:border-yellow-300 transition-all group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-yellow-100 dark:bg-yellow-950 flex items-center justify-center">
                          <FileText className="w-3.5 h-3.5 text-yellow-600" />
                        </div>
                        <span className="font-medium">Lease renewal in {leaseEndDays} days</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-yellow-500 transition-colors" />
                    </button>
                  )}
                  {urgentRequests.length > 0 && (
                    <button onClick={() => setActiveTab("repairs")} className="w-full flex items-center justify-between text-sm p-3 rounded-xl bg-card border border-border hover:border-red-300 transition-all group">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center">
                          <Wrench className="w-3.5 h-3.5 text-red-600" />
                        </div>
                        <span className="font-medium">{urgentRequests.length} urgent maintenance request{urgentRequests.length > 1 ? "s" : ""}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-red-500 transition-colors" />
                    </button>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Recent payments */}
              <Card className="rounded-2xl border-border shadow-none lg:col-span-2">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Recent Payments</CardTitle>
                    <CardDescription>Your latest rent payment activity</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setActiveTab("payments")}>
                    View all
                  </Button>
                </CardHeader>
                <CardContent>
                  {paymentsLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
                    </div>
                  ) : payments.length === 0 ? (
                    <div className="text-center py-8">
                      <CreditCard className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                      <p className="text-sm text-muted-foreground">No payments on record yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {payments.slice(0, 5).map(p => {
                        const cfg = PAY_STATUS[p.status] ?? PAY_STATUS.pending;
                        return (
                          <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                p.status === "paid" || p.status === "completed" ? "bg-green-500" :
                                p.status === "overdue" ? "bg-red-500" : "bg-yellow-500"
                              }`} />
                              <div>
                                <p className="text-sm font-semibold">{fmtKES(p.amount)}</p>
                                <p className="text-xs text-muted-foreground">
                                  Due {fmtDate(p.dueDate)}
                                  {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                                </p>
                              </div>
                            </div>
                            <Badge className={`text-[11px] px-2 py-0 ${cfg.cls}`}>{cfg.label}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Property details */}
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Your Unit</CardTitle>
                  <CardDescription>Tenancy details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5 text-sm">
                  {([
                    { label: "Unit",        value: unitNumber ? `Unit ${unitNumber}` : "—", icon: Building },
                    propertyData?.name ? { label: "Property",    value: propertyData.name, icon: MapPin } : null,
                    { label: "Monthly Rent", value: fmtKES(tenant?.monthlyRent), icon: DollarSign },
                    { label: "Lease Start", value: fmtDate(tenant?.leaseStartDate), icon: Calendar },
                    { label: "Lease End",   value: fmtDate(tenant?.leaseEndDate), icon: Calendar },
                    { label: "Phone",       value: tenant?.phone || "—", icon: Phone },
                  ].filter(Boolean) as Array<{label: string; value: string; icon: any}>).map(row => (
                    <div key={row.label} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs flex items-center gap-1.5">
                        <row.icon className="w-3 h-3" /> {row.label}
                      </span>
                      <span className="font-medium text-xs text-right max-w-[55%] truncate">{row.value}</span>
                    </div>
                  ))}

                  {leaseRenewalDue && (
                    <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/40 rounded-xl border border-yellow-200 dark:border-yellow-800 text-xs">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-yellow-800 dark:text-yellow-200 font-medium">Lease expires in {leaseEndDays} days</p>
                          <button
                            onClick={() => setActiveTab("profile")}
                            className="text-yellow-700 dark:text-yellow-300 underline mt-0.5 text-[11px]">
                            View lease details & request renewal →
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Open maintenance summary */}
            {openRequests.length > 0 && (
              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Open Maintenance Requests</CardTitle>
                    <CardDescription>
                      {openRequests.length} request{openRequests.length !== 1 ? "s" : ""} in progress
                      {urgentRequests.length > 0 && ` · ${urgentRequests.length} urgent`}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setActiveTab("repairs")}>
                    View all
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {openRequests.slice(0, 3).map(r => {
                      const cfg = MAINT_STATUS[r.status] ?? MAINT_STATUS.pending;
                      const Icon = cfg.icon;
                      return (
                        <div key={r.id} className={`flex items-center justify-between py-2.5 border-b border-border last:border-0 text-sm ${
                          r.priority === "urgent" ? "text-red-600" : ""
                        }`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{r.title}</p>
                              <p className="text-xs text-muted-foreground capitalize">
                                {r.category || "General"} · {fmtDate(r.createdAt)}
                              </p>
                            </div>
                          </div>
                          <Badge className={`text-[11px] px-2 py-0 flex-shrink-0 ${cfg.cls}`}>{cfg.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── PAYMENTS ───────────────────────────────────────────────────── */}
          <TabsContent value="payments" className="space-y-5">

            {/* Status banner */}
            {overduePayments.length > 0 ? (
              <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">{overduePayments.length} overdue payment(s) — please settle immediately</p>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">Total overdue: {fmtKES(overduePayments.reduce((s, p) => s + Number(p.amount ?? 0), 0))}</p>
                </div>
              </div>
            ) : !nextDue ? (
              <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">All payments up to date</p>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">No outstanding or overdue rent. Great work!</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-blue-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Next payment: {fmtKES(nextDue.amount)} due {fmtDate(nextDue.dueDate)}</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">Choose a payment method below</p>
                  </div>
                </div>
                {/* Itemized breakdown for the upcoming invoice */}
                {Array.isArray((nextDue as any).lineItems) && (nextDue as any).lineItems.length > 1 && (
                  <div className="mt-3 pt-2 border-t border-blue-200 dark:border-blue-700 space-y-1">
                    <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-1">Charge Breakdown</p>
                    {((nextDue as any).lineItems as Array<{ description: string; amount: number; type: string }>).map((li, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-blue-800 dark:text-blue-200">
                        <span>{li.description}</span>
                        <span className="font-medium">{fmtKES(li.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-bold text-blue-900 dark:text-blue-100 pt-1 border-t border-blue-200 dark:border-blue-700 mt-1">
                      <span>Total</span>
                      <span>{fmtKES(nextDue.amount)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Payment methods */}
            <PaymentMethodsPanel
              amount={Number(nextDue?.amount ?? overduePayments[0]?.amount ?? tenant?.monthlyRent ?? 0)}
              rentPaymentId={nextDue?.id ?? overduePayments[0]?.id}
              tenantId={tenantId}
              accountReference={payRef}
              defaultPhone={tenant?.phone ?? ""}
              paymentConfig={paymentConfig?.rentPayment ?? null}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenantId, "payments"] })}
              label="Rent"
            />

            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Paid",    count: paidPayments.length,    value: paidPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0),    cls: "text-green-600", bg: "bg-green-50  dark:bg-green-950/40",  border: "border-green-100 dark:border-green-900"  },
                { label: "Pending", count: pendingPayments.length,  value: pendingPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0),  cls: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/40", border: "border-yellow-100 dark:border-yellow-900" },
                { label: "Overdue", count: overduePayments.length,  value: overduePayments.reduce((s, p) => s + Number(p.amount ?? 0), 0),  cls: "text-red-600",    bg: "bg-red-50    dark:bg-red-950/40",    border: "border-red-100 dark:border-red-900"       },
              ].map(s => (
                <div key={s.label} className={`${s.bg} border ${s.border} rounded-2xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${s.cls}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 font-medium">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{fmtKES(s.value)}</p>
                </div>
              ))}
            </div>

            {/* Payment history */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("tenantPortal.paymentHistory")}</CardTitle>
                <CardDescription>All rent payments for your tenancy</CardDescription>
              </CardHeader>
              <CardContent>
                <PaymentHistoryTable payments={payments} isLoading={paymentsLoading} tenant={tenant} unitNumber={unitNumber} propertyData={propertyData} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── REPAIRS ────────────────────────────────────────────────────── */}
          <TabsContent value="repairs" className="space-y-5">

            {/* Submit form */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Submit a Repair Request</CardTitle>
                <CardDescription>
                  Report any maintenance issue in your unit. We aim to respond within 24 hours.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!tenant?.unitId && (
                  <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/40 rounded-xl border border-yellow-200 dark:border-yellow-800 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <p className="text-yellow-800 dark:text-yellow-200">
                      Your unit hasn't been assigned yet. Contact your property manager before submitting requests.
                    </p>
                  </div>
                )}
                <Form {...repairForm}>
                  <form onSubmit={repairForm.handleSubmit(d => submitRepair.mutate(d))} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={repairForm.control} name="category" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {[
                                { value: "plumbing",    label: "🔧 Plumbing" },
                                { value: "electrical",  label: "⚡ Electrical" },
                                { value: "hvac",        label: "❄️ HVAC / Air Conditioning" },
                                { value: "carpentry",   label: "🪚 Carpentry / Fixtures" },
                                { value: "painting",    label: "🎨 Painting / Walls" },
                                { value: "cleaning",    label: "🧹 Cleaning" },
                                { value: "landscaping", label: "🌿 Landscaping" },
                                { value: "appliance",   label: "🏠 Appliance" },
                                { value: "security",    label: "🔒 Security / Locks" },
                                { value: "other",       label: "📋 Other" },
                              ].map(c => (
                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={repairForm.control} name="priority" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Priority</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="low">🟢 Low — not urgent</SelectItem>
                              <SelectItem value="medium">🟡 Medium — needs attention soon</SelectItem>
                              <SelectItem value="high">🟠 High — significant impact</SelectItem>
                              <SelectItem value="urgent">🔴 Urgent — immediate danger or major leak</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={repairForm.control} name="title" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Issue Title</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Leaking pipe under kitchen sink" className="h-9" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={repairForm.control} name="description" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Description</FormLabel>
                        <FormControl>
                          <Textarea {...field}
                            placeholder="Describe the issue in detail — when it started, how bad it is, best time for access…"
                            rows={4} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit"
                      className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white h-10"
                      disabled={submitRepair.isPending || !tenant?.unitId}>
                      {submitRepair.isPending
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>
                        : <><Wrench className="w-4 h-4 mr-2" />Submit Repair Request</>}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* My requests */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">My Requests</CardTitle>
                <CardDescription>
                  {myRequests.length} submitted · {openRequests.length} open · {myRequests.filter(r => r.status === "completed").length} resolved
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RepairsListPanel requests={myRequests} isLoading={maintLoading} onRefresh={refetchMaint} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── UTILITIES ──────────────────────────────────────────────────── */}
          <TabsContent value="utilities" className="space-y-5">
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-sky-500" /> My Utility Bills
                  </CardTitle>
                  <CardDescription>Water, electricity, gas and other utility charges for your unit</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetchUtilityBills()}>
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {utilityBillsLoading ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground py-10">
                    <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading bills…</span>
                  </div>
                ) : myUtilityBills.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center mb-3">
                      <Droplets className="w-7 h-7 text-sky-400" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">No utility bills yet</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      Your utility bills will appear here once your property manager sends them. Bills are also emailed to you directly.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Summary strip */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: "Total Bills", value: myUtilityBills.length, cls: "text-foreground", bg: "bg-muted" },
                        { label: "Pending", value: myUtilityBills.filter(b => b.status === "pending").length, cls: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/40" },
                        { label: "Overdue", value: myUtilityBills.filter(b => b.status === "overdue").length, cls: "text-red-600", bg: "bg-red-50 dark:bg-red-950/40" },
                      ].map(s => (
                        <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center border border-border`}>
                          <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Bill list */}
                    {myUtilityBills.map(bill => {
                      const utilType = (bill.utilityType || "other").toLowerCase();
                      const iconMap: Record<string, any> = { water: Droplets, electricity: Zap, gas: Flame, internet: WifiIcon };
                      const BillIcon = iconMap[utilType] || Zap;
                      const colorMap: Record<string, string> = { water: "text-sky-500 bg-sky-50 dark:bg-sky-950/40", electricity: "text-yellow-500 bg-yellow-50 dark:bg-yellow-950/40", gas: "text-red-500 bg-red-50 dark:bg-red-950/40", internet: "text-purple-500 bg-purple-50 dark:bg-purple-950/40" };
                      const iconCls = colorMap[utilType] || "text-gray-500 bg-muted";
                      const statusCls: Record<string, string> = { pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", paid: "bg-emerald-50 text-emerald-700 border border-emerald-200", overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", disputed: "bg-gray-100 text-gray-700" };

                      return (
                        <div key={bill.id} className="flex items-start gap-3 p-4 rounded-xl border border-border hover:border-primary/20 hover:bg-muted/40 transition-all">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls}`}>
                            <BillIcon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div>
                                <p className="font-semibold text-sm capitalize">{utilType} Bill</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {bill.billingPeriodStart && bill.billingPeriodEnd
                                    ? `${fmtDate(bill.billingPeriodStart)} – ${fmtDate(bill.billingPeriodEnd)}`
                                    : "—"}
                                </p>
                              </div>
                              <Badge className={`text-[11px] px-2 py-0 shrink-0 ${statusCls[bill.status] ?? statusCls.pending}`}>
                                {(bill.status || "pending").charAt(0).toUpperCase() + (bill.status || "pending").slice(1)}
                              </Badge>
                            </div>
                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div>
                                <p className="text-muted-foreground">Amount</p>
                                <p className="font-semibold text-foreground">{bill.currency || "KES"} {Number(bill.amount || 0).toLocaleString()}</p>
                              </div>
                              {bill.unitsConsumed && (
                                <div>
                                  <p className="text-muted-foreground">Consumed</p>
                                  <p className="font-medium">{bill.unitsConsumed} units</p>
                                </div>
                              )}
                              {bill.unitRate && (
                                <div>
                                  <p className="text-muted-foreground">Rate / unit</p>
                                  <p className="font-medium">{bill.currency || "KES"} {Number(bill.unitRate).toFixed(2)}</p>
                                </div>
                              )}
                              <div>
                                <p className="text-muted-foreground">Due</p>
                                <p className={`font-medium ${bill.status === "overdue" ? "text-red-600" : ""}`}>{fmtDate(bill.dueDate)}</p>
                              </div>
                            </div>
                            {(bill.previousReading || bill.currentReading) && (
                              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
                                <span>Prev reading: <strong>{bill.previousReading}</strong></span>
                                <span>→</span>
                                <span>Current: <strong>{bill.currentReading}</strong></span>
                                {bill.meterNumber && <span className="ml-auto font-mono">Meter: {bill.meterNumber}</span>}
                              </div>
                            )}
                            {bill.billNumber && (
                              <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono">Ref: {bill.billNumber}</p>
                            )}
                            {(bill.status === "pending" || bill.status === "overdue") && (
                              <div className="mt-2">
                                <PaymentMethodsPanel
                                  amount={Number(bill.amount || 0)}
                                  tenantId={tenantId}
                                  utilityBillId={bill.id}
                                  accountReference={
                                    // Bill-specific reference so the manager can identify
                                    // which bill was paid from the M-Pesa statement.
                                    buildUtilityAccountReference(bill.id)
                                  }
                                  defaultPhone={tenant?.phone ?? ""}
                                  paymentConfig={
                                    paymentConfig?.utilityPayment?.sameAsRent !== false
                                      ? paymentConfig?.rentPayment ?? null
                                      : paymentConfig?.utilityPayment ?? null
                                  }
                                  onSuccess={() => {
                                    refetchUtilityBills();
                                    // Also refresh the utility bills badge on the dashboard
                                    queryClient.invalidateQueries({ queryKey: ["/api/utility-bills/my-bills", tenantId] });
                                  }}
                                  label={`${utilType.charAt(0).toUpperCase() + utilType.slice(1)} Bill`}
                                  compact
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DOCUMENTS ──────────────────────────────────────────────────── */}
          <TabsContent value="documents" className="space-y-4">
            <DocumentsPanel
              docs={docs}
              isLoading={docsLoading}
              tenantId={tenantId}
              onUploaded={() => queryClient.invalidateQueries({ queryKey: ["/api/documents", tenantId] })}
            />
          </TabsContent>

          {/* ── MESSAGES ───────────────────────────────────────────────────── */}
          <TabsContent value="messages" className="space-y-4">
            <MessagesPanel
              messages={messages}
              isLoading={msgsLoading}
              onRefresh={refetchMessages}
              onSend={async (subject, content, toUserId) => {
                await sendMessage.mutateAsync({ subject, content, toUserId });
              }}
              isSending={sendMessage.isPending}
              onMarkRead={(ids) => markRead.mutate(ids)}
              managerName={anyManagerName}
            />
            {/* WhatsApp / Live Chat — unified below messages */}
            <Card className="rounded-2xl border-border shadow-none overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-green-600" /> WhatsApp / Live Chat
                </CardTitle>
                <CardDescription>Chat directly with your property manager via WhatsApp</CardDescription>
              </CardHeader>
              <CardContent className="p-0" style={{ height: 560 }}>
                <TenantWhatsAppChat tenantId={tenantId} />
              </CardContent>
            </Card>
          </TabsContent>



          {/* ── PROFILE ────────────────────────────────────────────────────── */}
          {/* ── VISITORS ───────────────────────────────────────────────── */}
          <TabsContent value="visitors" className="space-y-6">
            <TenantVisitorPanel />
          </TabsContent>

          {/* ── PROFILE ────────────────────────────────────────────────────── */}
          <TabsContent value="ratings" className="space-y-5">
            <RatingsTab tenantId={tenantId!} />
          </TabsContent>

          <TabsContent value="profile" className="space-y-4">
            <ProfileTab tenant={tenant} tenantId={tenantId} unitData={unitData} unitNumber={unitNumber} propertyData={propertyData} onUpdated={(updates) => {
                queryClient.setQueryData(["/api/tenants", tenantId], (old: any) => old ? { ...old, ...updates } : old);
              }} />

            {/* Lease details & renewal card */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-500" /> Lease Details
                </CardTitle>
                <CardDescription>Your current tenancy agreement summary</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    { label: "Lease Start",    value: fmtDate(tenant?.leaseStartDate) },
                    { label: "Lease End",      value: fmtDate(tenant?.leaseEndDate) },
                    { label: "Monthly Rent",   value: fmtKES(tenant?.monthlyRent) },
                    { label: "Security Deposit", value: fmtKES(tenant?.securityDeposit) },
                    { label: "Unit",           value: unitNumber ? `Unit ${unitNumber}` : "—" },
                    { label: "Property",       value: propertyData?.name || "—" },
                  ].map(row => (
                    <div key={row.label} className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className="font-semibold text-foreground">{row.value}</p>
                    </div>
                  ))}
                </div>

                {/* Lease progress */}
                {tenant?.leaseStartDate && tenant?.leaseEndDate && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                      <span>Lease progress</span>
                      <span>{leasePct}% elapsed</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${leasePct > 85 ? "bg-red-400" : leasePct > 70 ? "bg-yellow-400" : "bg-green-400"}`}
                        style={{ width: `${leasePct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground/60 mt-1">
                      <span>{fmtDate(tenant.leaseStartDate)}</span>
                      <span>{fmtDate(tenant.leaseEndDate)}</span>
                    </div>
                  </div>
                )}

                {/* Renewal CTA */}
                {leaseRenewalDue && (
                  <div className="rounded-xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 p-4">
                    <div className="flex items-start gap-3">
                      <BellRing className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                          Lease renewal due in {leaseEndDays} days
                        </p>
                        <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                          Your lease expires on {fmtDate(tenant?.leaseEndDate)}. Send a renewal request to your property manager so they can prepare the paperwork in time.
                        </p>
                        <Button
                          size="sm"
                          className="mt-3 h-8 text-xs bg-yellow-600 hover:bg-yellow-700 text-white"
                          onClick={() => {
                            setActiveTab("messages");
                            toast({ title: "Go to Messages", description: "Send a lease renewal request to your property manager." });
                          }}
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" /> Request Renewal via Messages
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {!leaseRenewalDue && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {leaseEndDays !== null && leaseEndDays > 90
                      ? `Your lease is active for ${leaseEndDays} more days — no action needed yet.`
                      : "Contact your property manager to discuss your lease."}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Lease Agreement Generator */}
            <LeaseAgreementGenerator tenant={tenant} unitData={unitData} propertyData={propertyData} />

            {/* ── Notification Preferences ─────────────────────────────── */}
            <NotificationPrefsCard />

            {/* ── Help & Support ───────────────────────────────────────── */}
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-500" /> Help & Support
                </CardTitle>
                <CardDescription>Guides and contact options</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9 text-sm"
                  onClick={() => {
                    if (tenant?.id) markOnboardingDone(tenant.id);
                    setShowOnboarding(true);
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Relaunch setup guide
                </Button>
                <a
                  href="https://wa.me/254759657590?text=Hi%21%20I%20need%20help%20with%20my%20tenant%20portal."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 w-full px-3 h-9 rounded-md border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Contact support on WhatsApp
                </a>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}