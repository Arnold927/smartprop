/**
 * client/src/components/payment-methods-panel.tsx
 *
 * Reusable payment panel that shows all configured payment methods:
 *   - M-Pesa STK Push (if MPESA_BUSINESS_SHORTCODE is configured)
 *   - M-Pesa Paybill (manual) — from payment config
 *   - M-Pesa Till (Buy Goods) — from payment config
 *   - Bank Transfer — from payment config
 *
 * Used for both rent and utility bill payments.
 *
 * Props:
 *   amount          — amount to pay
 *   tenantId        — for STK push
 *   rentPaymentId   — for STK push (optional)
 *   accountReference — for STK push
 *   defaultPhone    — pre-fill phone number
 *   paymentConfig   — { mpesaPaybill, mpesaTill, bankAccountNumber, ... }
 *   onSuccess       — callback after STK push success
 *   label           — "Rent" | "Water Bill" etc.
 *   compact         — condensed mode for inline use
 */

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  Smartphone, Banknote, CreditCard, ChevronDown, ChevronUp,
  CheckCircle, X, Loader2, Copy,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentConfig {
  mpesaPaybill?: string;
  mpesaTill?: string;
  mpesaAccountName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankBranch?: string;
  instructions?: string;
}

interface Props {
  amount: number;
  tenantId?: number;
  rentPaymentId?: number;
  utilityBillId?: number;
  accountReference: string;
  defaultPhone?: string;
  paymentConfig: PaymentConfig | null;
  onSuccess?: (receipt?: string) => void;
  label?: string;
  compact?: boolean;
}

type StkPhase = "idle" | "sending" | "waiting" | "success" | "failed";

interface StkState {
  phase: StkPhase;
  checkoutRequestId?: string;
  transactionId?: number;
  startedAt?: number;
  receipt?: string;
  amount?: number;
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtKES = (n: number, currency = "KES") =>
  `${currency} ${Math.round(n).toLocaleString("en-KE")}`;

const formatPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("07") || digits.startsWith("01")) return "254" + digits.slice(1);
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits;
  return digits;
};

// ── STK Push sub-component ────────────────────────────────────────────────────

function StkPushPanel({
  amount, tenantId, rentPaymentId, utilityBillId, accountReference, defaultPhone, onSuccess, currency = "KES",
}: {
  amount: number; tenantId?: number; rentPaymentId?: number; utilityBillId?: number;
  accountReference: string; defaultPhone?: string;
  onSuccess?: (receipt?: string) => void; currency?: string;
}) {
  const { toast } = useToast();
  const [stkState, setStkState] = useState<StkState>({ phase: "idle" });
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = (checkoutRequestId: string) => {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await apiRequest(`/api/mpesa/status/${checkoutRequestId}`);
        const data = await res.json();
        if (data.status === "completed") {
          clearInterval(pollRef.current!);
          setStkState({ phase: "success", receipt: data.mpesaReceiptNumber ?? checkoutRequestId, amount });
          onSuccess?.(data.mpesaReceiptNumber);
        } else if (data.status === "failed") {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: data.resultDesc ?? "Payment was declined." });
        } else if (attempts >= 30) {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: "Timed out. If you approved the payment it will still be recorded." });
        }
      } catch {
        if (attempts >= 30) {
          clearInterval(pollRef.current!);
          setStkState({ phase: "failed", reason: "Could not confirm status. Contact your manager if money was deducted." });
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
          description: utilityBillId ? "Utility Payment" : "Payment",
          ...(rentPaymentId ? { rentPaymentId } : {}),
          ...(utilityBillId ? { utilityBillId } : {}),
          ...(tenantId ? { tenantId } : {}),
        },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
      const data = await res.json();
      setStkState({ phase: "waiting", checkoutRequestId: data.checkoutRequestId, startedAt: Date.now() });
      startPolling(data.checkoutRequestId);
      toast({ title: "Check your phone", description: "Enter your M-Pesa PIN to confirm." });
    } catch (err: any) {
      setStkState({ phase: "failed", reason: err.message ?? "Could not initiate payment." });
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStkState({ phase: "idle" });
  };

  if (stkState.phase === "success") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/40 p-4 text-center space-y-2">
        <CheckCircle className="w-8 h-8 text-green-600 mx-auto" />
        <p className="font-bold text-green-800 dark:text-green-200 text-sm">Payment Confirmed!</p>
        <p className="text-xs text-green-700 dark:text-green-300">{fmtKES(stkState.amount!, currency)} received</p>
        {stkState.receipt && (
          <p className="text-xs font-mono bg-white dark:bg-green-900/40 border border-green-200 rounded-lg px-3 py-1.5">Receipt: {stkState.receipt}</p>
        )}
      </div>
    );
  }

  if (stkState.phase === "waiting") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 p-4 text-center space-y-2">
        <Smartphone className="w-6 h-6 text-blue-600 mx-auto animate-pulse" />
        <p className="font-semibold text-blue-800 dark:text-blue-200 text-sm">Waiting for your PIN…</p>
        <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking status…</p>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={reset}>Cancel</Button>
      </div>
    );
  }

  if (stkState.phase === "failed") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 p-4 text-center space-y-2">
        <X className="w-6 h-6 text-red-500 mx-auto" />
        <p className="font-semibold text-red-800 dark:text-red-200 text-sm">Payment not completed</p>
        <p className="text-xs text-red-600">{stkState.reason}</p>
        <Button size="sm" onClick={reset} className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs">Try Again</Button>
      </div>
    );
  }

  const isSending = stkState.phase === "sending";
  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-900/40 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm">
        <p className="text-[11px] text-muted-foreground">Amount</p>
        <p className="text-xl font-bold">{fmtKES(amount, currency)}</p>
      </div>
      <div className="flex gap-2">
        <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 text-sm font-medium text-gray-600 shrink-0">
          🇰🇪 +254
        </div>
        <Input
          type="tel"
          placeholder="07XX XXX XXX"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          disabled={isSending}
          className="h-9"
        />
      </div>
      <Button
        className="w-full bg-green-600 hover:bg-green-700 text-white h-9 text-sm"
        onClick={initiate}
        disabled={isSending || !phone.trim()}
      >
        {isSending
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
          : <><Smartphone className="w-4 h-4 mr-2" />Send M-Pesa Request</>}
      </Button>
      <p className="text-[10px] text-center text-muted-foreground">PIN prompt sent to your phone. Your PIN is never shared.</p>
    </div>
  );
}

// ── Manual steps section ──────────────────────────────────────────────────────

function ManualPaybillSteps({ paybill, accountHint, amount, currency = "KES" }: {
  paybill: string; accountHint?: string; amount: number; currency?: string;
}) {
  const { toast } = useToast();
  const steps = [
    "Open M-Pesa on your phone",
    "Select Lipa na M-Pesa → Pay Bill",
    `Business No: ${paybill}`,
    `Account No: ${accountHint || "Your unit number"}`,
    `Amount: ${fmtKES(amount, currency)}`,
    "Enter your M-Pesa PIN and confirm",
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
      <p className="text-xs font-semibold">Paybill steps:</p>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <p className="text-xs">{s}</p>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => {
        navigator.clipboard.writeText(paybill);
        toast({ title: "Business number copied!", description: paybill });
      }}>
        <Copy className="w-3 h-3" /> Copy Business No.
      </Button>
    </div>
  );
}

function TillSteps({ till, amount, currency = "KES" }: { till: string; amount: number; currency?: string; }) {
  const { toast } = useToast();
  const steps = [
    "Open M-Pesa on your phone",
    "Select Lipa na M-Pesa → Buy Goods & Services",
    `Till No: ${till}`,
    `Amount: ${fmtKES(amount, currency)}`,
    "Enter your M-Pesa PIN and confirm",
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
      <p className="text-xs font-semibold">Till / Buy Goods steps:</p>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <p className="text-xs">{s}</p>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => {
        navigator.clipboard.writeText(till);
        toast({ title: "Till number copied!", description: till });
      }}>
        <Copy className="w-3 h-3" /> Copy Till No.
      </Button>
    </div>
  );
}

function BankTransferDetails({ config, hasPaybill }: { config: PaymentConfig; hasPaybill: boolean }) {
  const { toast } = useToast();
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied!`, description: text });
  };

  // If no Paybill is configured, bank transfers can't be initiated digitally —
  // explain this clearly rather than showing raw account details with no context.
  if (!hasPaybill) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
        <div className="flex items-start gap-2.5">
          <Banknote className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Bank transfers require a Paybill number
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              To pay via bank transfer you need to send money through M-Pesa using
              a Paybill number. Direct EFT or cash deposits to a bank account
              cannot be tracked or confirmed automatically in this system.
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Please use the <strong>Paybill</strong> or <strong>Buy Goods</strong> option above,
              or contact your property manager if you need to arrange a direct bank payment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
      <p className="text-xs font-semibold">Bank Transfer Details:</p>
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
        Use M-Pesa Paybill to send to this bank account. Direct cash or EFT
        deposits won't be automatically recorded — always pay via Paybill so
        your payment is confirmed instantly.
      </div>
      <div className="space-y-2">
        {[
          { label: "Bank", value: config.bankName },
          { label: "Account No.", value: config.bankAccountNumber },
          { label: "Account Name", value: config.bankAccountName },
          { label: "Branch", value: config.bankBranch },
        ].filter(r => r.value).map(row => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground">{row.label}</p>
              <p className="text-sm font-semibold font-mono">{row.value}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copy(row.value!, row.label)}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
      {config.instructions && (
        <p className="text-xs text-muted-foreground border-t border-gray-200 pt-2">{config.instructions}</p>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PaymentMethodsPanel({
  amount, tenantId, rentPaymentId, utilityBillId, accountReference, defaultPhone,
  paymentConfig, onSuccess, label = "Payment", compact = false,
}: Props) {
  type Method = "stk" | "paybill" | "till" | "bank";
  const [activeMethod, setActiveMethod] = useState<Method>("stk");
  const [expanded, setExpanded] = useState(!compact);

  // Landlords cannot initiate STK push — they do not send payments to tenant phones
  const { user: authUser } = useAuth();
  const isLandlord = (authUser as any)?.role === "landlord";

  const hasPaybill = !!paymentConfig?.mpesaPaybill;
  const hasTill = !!paymentConfig?.mpesaTill;
  const hasBank = !!paymentConfig?.bankAccountNumber;

  const methods = [
    // STK Push hidden for landlords — they cannot initiate payments to tenant phones
    ...(!isLandlord ? [{ id: "stk" as Method, label: "STK Push", icon: Smartphone, color: "#16a34a", desc: "Instant M-Pesa prompt" }] : []),
    ...(hasPaybill ? [{ id: "paybill" as Method, label: "Paybill", icon: CreditCard, color: "#059669", desc: `Business: ${paymentConfig!.mpesaPaybill}` }] : []),
    ...(hasTill ? [{ id: "till" as Method, label: "Buy Goods", icon: CreditCard, color: "#d97706", desc: `Till: ${paymentConfig!.mpesaTill}` }] : []),
    ...(hasBank ? [{ id: "bank" as Method, label: "Bank", icon: Banknote, color: "#2563eb", desc: paymentConfig!.bankName ?? "Bank Transfer" }] : []),
  ];

  // If the previously selected method is no longer available (e.g. landlord
  // can't see STK), reset to the first available method.
  const validMethod = methods.find(m => m.id === activeMethod) ? activeMethod : (methods[0]?.id ?? "paybill") as Method;

  if (compact) {
    return (
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-900/40 hover:bg-gray-100 transition-colors"
        >
          <span className="font-medium text-gray-700 flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-green-600" /> Pay {label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {expanded && (
          <div className="p-4 space-y-4">
            <MethodSelector methods={methods} active={validMethod} onChange={setActiveMethod} />
            <MethodContent method={validMethod} amount={amount} tenantId={tenantId} rentPaymentId={rentPaymentId}
              utilityBillId={utilityBillId} accountReference={accountReference} defaultPhone={defaultPhone} paymentConfig={paymentConfig}
              onSuccess={onSuccess} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border shadow-none bg-card overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">Pay {label}</h3>
          <span className="text-xl font-bold text-foreground">{fmtKES(amount)}</span>
        </div>
        <MethodSelector methods={methods} active={validMethod} onChange={setActiveMethod} />
        <MethodContent method={validMethod} amount={amount} tenantId={tenantId} rentPaymentId={rentPaymentId}
          utilityBillId={utilityBillId} accountReference={accountReference} defaultPhone={defaultPhone} paymentConfig={paymentConfig}
          onSuccess={onSuccess} />
      </div>
    </div>
  );
}

function MethodSelector({ methods, active, onChange }: {
  methods: Array<{ id: string; label: string; icon: any; color: string; desc: string }>;
  active: string;
  onChange: (id: any) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${methods.length}, 1fr)` }}>
      {methods.map(m => {
        const Icon = m.icon;
        const isActive = active === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all text-xs ${
              isActive
                ? "border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white "
                : "border-border bg-muted/40 text-muted-foreground hover:border-gray-400"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="font-semibold">{m.label}</span>
            <span className="text-[10px] opacity-70 truncate w-full">{m.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

function MethodContent({ method, amount, tenantId, rentPaymentId, utilityBillId, accountReference, defaultPhone, paymentConfig, onSuccess }: {
  method: string; amount: number; tenantId?: number; rentPaymentId?: number; utilityBillId?: number;
  accountReference: string; defaultPhone?: string; paymentConfig: PaymentConfig | null;
  onSuccess?: (receipt?: string) => void;
}) {
  const hasPaybill = !!paymentConfig?.mpesaPaybill;

  if (method === "stk") {
    return (
      <StkPushPanel
        amount={amount} tenantId={tenantId} rentPaymentId={rentPaymentId} utilityBillId={utilityBillId}
        accountReference={accountReference} defaultPhone={defaultPhone} onSuccess={onSuccess}
      />
    );
  }
  if (method === "paybill" && paymentConfig?.mpesaPaybill) {
    return (
      <ManualPaybillSteps
        paybill={paymentConfig.mpesaPaybill}
        accountHint={paymentConfig.mpesaAccountName || accountReference}
        amount={amount}
      />
    );
  }
  if (method === "till" && paymentConfig?.mpesaTill) {
    return <TillSteps till={paymentConfig.mpesaTill} amount={amount} />;
  }
  if (method === "bank" && paymentConfig?.bankAccountNumber) {
    return <BankTransferDetails config={paymentConfig} hasPaybill={hasPaybill} />;
  }
  return null;
}