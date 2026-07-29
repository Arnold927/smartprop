/**
 * client/src/components/payment-config-panel.tsx
 *
 * Admin panel for configuring how tenants should pay rent and utility bills.
 * Supports: M-Pesa Paybill, M-Pesa Till, Bank Transfer — separately for
 * rent and utilities, or a single shared account.
 *
 * Embed anywhere in the admin UI:
 *   import PaymentConfigPanel from "@/components/payment-config-panel";
 *   <PaymentConfigPanel />
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { withOrgParam } from "@/lib/platformOrgContext";
import {
  Smartphone, Building2, CreditCard, Save, CheckCircle2,
  Loader2, Info, Banknote, Copy, AlertTriangle, KeyRound,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentAccount {
  useSingleAccount?: boolean; // only on rentPayment
  sameAsRent?: boolean;       // only on utilityPayment
  mpesaPaybill: string;
  mpesaTill: string;
  mpesaAccountName: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankBranch: string;
  instructions: string;
}

interface PaymentConfig {
  orgName?: string;
  serverShortcode?: string; // MPESA_BUSINESS_SHORTCODE from server .env — only present for scope="org"
  configured?: boolean;     // only present for scope="mine" — false if this landlord hasn't set their own override yet
  rentPayment: PaymentAccount;
  utilityPayment: PaymentAccount;
}

interface PaymentConfigPanelProps {
  /** "org" (default) edits the org-wide default via /api/payment-config.
   *  "mine" edits the calling landlord's own override via
   *  /api/payment-config/landlord/mine.
   *  "landlord" (admin/manager/platform_admin only) edits a SPECIFIC
   *  landlord's override on their behalf via
   *  /api/payment-config/landlord/:landlordOwnerId — requires
   *  landlordOwnerId to be set. */
  scope?: "org" | "mine" | "landlord";
  landlordOwnerId?: string;
  /** Required when the caller is platform_admin (not scoped to a single
   *  org) — carried as ?organizationId=X on every request this component
   *  makes. Ignored (and unnecessary) for every other role, whose org
   *  already comes from their own JWT. */
  organizationId?: string | null;
}

const emptyAccount = (): PaymentAccount => ({
  mpesaPaybill: "",
  mpesaTill: "",
  mpesaAccountName: "",
  bankName: "",
  bankAccountNumber: "",
  bankAccountName: "",
  bankBranch: "",
  instructions: "",
});

// ── Sub-component: one payment method section ─────────────────────────────────

function PaymentMethodSection({
  title,
  icon: Icon,
  color,
  account,
  savedAccount,
  serverShortcode,
  onChange,
}: {
  title: string;
  icon: any;
  color: string;
  account: PaymentAccount;
  savedAccount: PaymentAccount;
  serverShortcode: string;
  onChange: (patch: Partial<PaymentAccount>) => void;
}) {
  const hasPaybill = !!account.mpesaPaybill;
  const hasTill = !!account.mpesaTill;
  const hasBank = !!account.bankAccountNumber;
  const filledCount = [hasPaybill, hasTill, hasBank].filter(Boolean).length;

  // Detect if Paybill or Till has changed from the saved server value
  const paybillChanged = savedAccount.mpesaPaybill &&
    account.mpesaPaybill !== savedAccount.mpesaPaybill;
  const tillChanged = savedAccount.mpesaTill &&
    account.mpesaTill !== savedAccount.mpesaTill;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + "20", color }}>
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {filledCount > 0 && (
          <Badge className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
            {filledCount} method{filledCount > 1 ? "s" : ""} configured
          </Badge>
        )}
      </div>

      {/* M-Pesa Paybill */}
      <div className={`rounded-xl border p-4 space-y-3 ${paybillChanged ? "border-red-300 bg-red-50/60" : "border-gray-100 bg-gray-50/50"}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Smartphone className="w-4 h-4 text-green-600" />
          M-Pesa Paybill
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Business No. (Paybill)</Label>
            <Input
              placeholder="e.g. 174379"
              value={account.mpesaPaybill}
              onChange={e => onChange({ mpesaPaybill: e.target.value })}
              className={paybillChanged ? "border-red-400 focus-visible:ring-red-400" : ""}
            />
            {/* Show the server .env value so the user can see if they match */}
            {serverShortcode && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-gray-400">Server shortcode (.env):</span>
                <span className={`font-mono font-semibold px-1.5 py-0.5 rounded text-[11px] ${
                  account.mpesaPaybill && account.mpesaPaybill !== serverShortcode
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {serverShortcode}
                </span>
                {account.mpesaPaybill === serverShortcode && (
                  <span className="text-emerald-600 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> matches server
                  </span>
                )}
                {account.mpesaPaybill && account.mpesaPaybill !== serverShortcode && (
                  <span className="text-red-600 font-semibold flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" /> mismatch!
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account Name shown to tenant</Label>
            <Input
              placeholder="e.g. RENT / UTILITY"
              value={account.mpesaAccountName}
              onChange={e => onChange({ mpesaAccountName: e.target.value })}
            />
          </div>
        </div>

        {/* Inline warning when Paybill is being changed */}
        {paybillChanged && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-400 bg-red-100 p-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 space-y-1">
              <p className="font-bold text-sm">⚠️ Critical: Paybill number is changing</p>
              <p>
                You are changing the Paybill from{" "}
                <span className="font-mono font-bold">{savedAccount.mpesaPaybill}</span>{" "}
                to{" "}
                <span className="font-mono font-bold">{account.mpesaPaybill || "—"}</span>.
              </p>
              <p>
                <strong>The system's M-Pesa API credentials are tied to the original Paybill number.</strong>{" "}
                If you save this change without updating the server configuration,
                all STK Push payments will fail and tenants will not be able to pay rent electronically.
              </p>
              <p className="font-semibold">
                You MUST contact your system administrator immediately to update the server
                before saving this change. Do not proceed unless your administrator has confirmed
                the new credentials are ready.
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500">Tenant will be told: Lipa na M-Pesa → Pay Bill → Business No → their unit number as account</p>
      </div>

      {/* M-Pesa Till */}
      <div className={`rounded-xl border p-4 space-y-3 ${tillChanged ? "border-red-300 bg-red-50/60" : "border-gray-100 bg-gray-50/50"}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <CreditCard className="w-4 h-4 text-green-600" />
          M-Pesa Till (Buy Goods)
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Till Number</Label>
          <Input
            placeholder="e.g. 5678901"
            value={account.mpesaTill}
            onChange={e => onChange({ mpesaTill: e.target.value })}
            className={`max-w-xs ${tillChanged ? "border-red-400 focus-visible:ring-red-400" : ""}`}
          />
        </div>

        {/* Inline warning when Till is being changed */}
        {tillChanged && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-400 bg-red-100 p-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 space-y-1">
              <p className="font-bold text-sm">⚠️ Critical: Till number is changing</p>
              <p>
                You are changing the Till number from{" "}
                <span className="font-mono font-bold">{savedAccount.mpesaTill}</span>{" "}
                to{" "}
                <span className="font-mono font-bold">{account.mpesaTill || "—"}</span>.
              </p>
              <p>
                <strong>The system's M-Pesa API credentials (passkey) are bound to the original Till number.</strong>{" "}
                Saving this change without updating the server will cause all STK Push
                payments to be rejected by Safaricom. Tenants will be unable to pay.
              </p>
              <p className="font-semibold">
                Contact your system administrator before saving. Do not proceed
                until your administrator confirms the server has been updated with
                the new credentials for this Till number.
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500">Tenant will use Lipa na M-Pesa → Buy Goods → Till No.</p>
      </div>

      {/* Bank Transfer */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Banknote className="w-4 h-4 text-blue-600" />
          Bank Transfer
        </div>

        {/* Advisory note about bank vs M-Pesa */}
        <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
          <div className="space-y-1.5">
            <p className="font-bold">Bank details are for display only — no STK Push</p>
            <p>
              Entering bank account details here shows them to tenants as an alternative
              payment option. However, <strong>bank transfers never trigger an M-Pesa STK Push</strong>.
              The tenant must go to their bank independently (EFT, RTGS, standing order,
              or cheque deposit) and send money directly — SmartProp has no involvement
              in the actual transfer.
            </p>
            <p>
              Because there is no electronic confirmation, bank payments must be
              reconciled manually in <strong>Bank Reconciliation</strong>. They will not
              appear as paid automatically.
            </p>
            <p className="font-semibold">
              Only use this for corporate tenants on standing orders or amounts exceeding
              the M-Pesa per-transaction limit (KES 150,000). For all other tenants,
              Paybill or Till is strongly preferred.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Bank Name</Label>
            <Input
              placeholder="e.g. Equity Bank"
              value={account.bankName}
              onChange={e => onChange({ bankName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account Number</Label>
            <Input
              placeholder="e.g. 0123456789"
              value={account.bankAccountNumber}
              onChange={e => onChange({ bankAccountNumber: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account Name</Label>
            <Input
              placeholder="e.g. ABC Properties Ltd"
              value={account.bankAccountName}
              onChange={e => onChange({ bankAccountName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Branch (optional)</Label>
            <Input
              placeholder="e.g. Westlands Branch"
              value={account.bankBranch}
              onChange={e => onChange({ bankBranch: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Custom instructions */}
      <div className="space-y-1.5">
        <Label className="text-xs">Additional Instructions (optional)</Label>
        <Textarea
          placeholder="Any extra payment instructions shown to tenants..."
          rows={2}
          value={account.instructions}
          onChange={e => onChange({ instructions: e.target.value })}
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Different landlords very likely have independently-registered Safaricom
 *  shortcodes — each needs its own passkey, since you can't authenticate an
 *  STK Push to one shortcode using another shortcode's passkey. This lets a
 *  landlord (or an admin on their behalf) provide their own full Daraja
 *  credentials, enabling genuine automatic STK Push prompts for their own
 *  tenants rather than falling back to manual Paybill/Till payment. */
function DarajaCredentialsSection({ endpoint, testEndpoint }: { endpoint: string; testEndpoint: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [passkey, setPasskey] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("production");
  const [testPhone, setTestPhone] = useState("");
  const [showTestDialog, setShowTestDialog] = useState(false);

  const { data: status } = useQuery<{
    configured: boolean; environment: string; verified: boolean; verifiedAt?: string; consumerKeyMasked: string | null;
  }>({
    queryKey: [endpoint, "credentials-status"],
    queryFn: async () => {
      const r = await apiRequest(endpoint);
      const data = await r.json();
      return data.mpesaCredentials;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      // Fetch current display-info config first — this endpoint requires
      // rentPayment on every save, and we don't want a credentials-only
      // save to accidentally wipe the Paybill/Till/bank fields.
      const current = await (await apiRequest(endpoint)).json();
      const r = await apiRequest(endpoint, {
        method: "PUT",
        data: {
          rentPayment: current.rentPayment,
          utilityPayment: current.utilityPayment,
          mpesaCredentials: { consumerKey, consumerSecret, passkey, environment },
        },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Daraja credentials saved", description: "Run a test push before relying on this in production." });
      setConsumerSecret(""); setPasskey(""); // never keep raw secrets in state after a successful save
      queryClient.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (err: any) => toast({ title: "Failed to save credentials", description: err.message, variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(testEndpoint, { method: "POST", data: { phoneNumber: testPhone } });
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Test prompt sent", description: data.message });
      setShowTestDialog(false);
      queryClient.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (err: any) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Card className="border-indigo-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="w-4 h-4 text-indigo-600" /> Daraja API Credentials
        </CardTitle>
        <CardDescription>
          Only needed for automatic M-Pesa prompts (STK Push). Without these, tenants can still pay manually
          using the Paybill/Till shown above — this just enables the one-tap "Pay Now" prompt for this
          specific landlord's own shortcode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.configured && (
          <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${status.verified ? "bg-green-50 border border-green-100 text-green-800" : "bg-amber-50 border border-amber-100 text-amber-800"}`}>
            {status.verified ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>
              Consumer key <span className="font-mono font-medium">{status.consumerKeyMasked}</span> saved
              {status.verified ? " and verified with a successful test push." : " but not yet tested — run a test push below."}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Consumer Key</Label>
            <Input value={consumerKey} onChange={e => setConsumerKey(e.target.value)} placeholder={status?.configured ? "Leave blank to keep current" : "From Daraja app"} />
          </div>
          <div>
            <Label className="text-xs">Environment</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={environment}
              onChange={e => setEnvironment(e.target.value as "sandbox" | "production")}
            >
              <option value="production">Production</option>
              <option value="sandbox">Sandbox (testing only)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Consumer Secret</Label>
            <Input type="password" value={consumerSecret} onChange={e => setConsumerSecret(e.target.value)} placeholder={status?.configured ? "Leave blank to keep current" : "From Daraja app"} />
          </div>
          <div>
            <Label className="text-xs">Passkey</Label>
            <Input type="password" value={passkey} onChange={e => setPasskey(e.target.value)} placeholder={status?.configured ? "Leave blank to keep current" : "Lipa Na M-Pesa Online passkey"} />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          The passkey must be issued by Safaricom specifically for the Paybill/Till number entered above —
          a passkey from a different shortcode will be rejected when tested.
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || (!consumerKey && !consumerSecret && !passkey)}
          >
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            Save Credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTestDialog(true)}
            disabled={!status?.configured}
          >
            <Smartphone className="w-3.5 h-3.5 mr-2" /> Send Test Push
          </Button>
        </div>
      </CardContent>

      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a KES 1 test prompt</DialogTitle>
            <DialogDescription>
              Confirms your consumer key, consumer secret, and passkey are all valid for the Paybill/Till entered above.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Your phone number</Label>
            <Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="07XXXXXXXX" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestDialog(false)}>Cancel</Button>
            <Button onClick={() => test.mutate()} disabled={test.isPending || !testPhone.trim()}>
              {test.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Send Test Push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function PaymentConfigPanel({ scope = "org", landlordOwnerId, organizationId }: PaymentConfigPanelProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const baseEndpoint =
    scope === "mine"     ? "/api/payment-config/landlord/mine" :
    scope === "landlord" ? `/api/payment-config/landlord/${landlordOwnerId}` :
    "/api/payment-config";
  const endpoint = withOrgParam(baseEndpoint, organizationId);

  const { data: config, isLoading } = useQuery<PaymentConfig>({
    queryKey: [endpoint],
    enabled: scope !== "landlord" || !!landlordOwnerId,
  });

  const [rent, setRent] = useState<PaymentAccount>(emptyAccount());
  const [utility, setUtility] = useState<PaymentAccount>(emptyAccount());
  const [sameAsRent, setSameAsRent] = useState(true);

  // Track the last values actually saved to the server so we can detect changes
  const [savedRent, setSavedRent] = useState<PaymentAccount>(emptyAccount());
  const [savedUtility, setSavedUtility] = useState<PaymentAccount>(emptyAccount());

  // Confirmation dialog state
  const [showConfirm, setShowConfirm] = useState(false);

  // Populate form once data loads
  useEffect(() => {
    if (config) {
      const r = config.rentPayment ?? emptyAccount();
      const u = config.utilityPayment ?? emptyAccount();

      // If Paybill is still blank (first-time setup), prefill from the server
      // shortcode so the admin sees what the server is configured with.
      // If a value was already saved, leave it as-is.
      if (!r.mpesaPaybill && config.serverShortcode) {
        r.mpesaPaybill = config.serverShortcode;
      }
      if (!u.mpesaPaybill && config.serverShortcode) {
        u.mpesaPaybill = config.serverShortcode;
      }

      setRent(r);
      setSavedRent(r);
      setSameAsRent(u.sameAsRent !== false);
      setUtility(u);
      setSavedUtility(u);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(endpoint, {
        method: "PUT",
        data: {
          rentPayment: rent,
          utilityPayment: sameAsRent ? { ...rent, sameAsRent: true } : { ...utility, sameAsRent: false },
        },
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Save failed");
      return r.json();
    },
    onSuccess: () => {
      // Update saved state so warnings clear after a successful save
      setSavedRent({ ...rent });
      setSavedUtility(sameAsRent ? { ...rent } : { ...utility });
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      toast({ title: "Payment config saved!", description: "Tenants will see these payment details in their portal." });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  // Detect whether any shortcode (Paybill or Till) is changing from a saved value
  const shortcodeChanging =
    (!!savedRent.mpesaPaybill && rent.mpesaPaybill !== savedRent.mpesaPaybill) ||
    (!!savedRent.mpesaTill    && rent.mpesaTill    !== savedRent.mpesaTill)    ||
    (!sameAsRent && (
      (!!savedUtility.mpesaPaybill && utility.mpesaPaybill !== savedUtility.mpesaPaybill) ||
      (!!savedUtility.mpesaTill    && utility.mpesaTill    !== savedUtility.mpesaTill)
    ));

  // When Save is clicked, intercept if shortcode is changing
  const handleSaveClick = () => {
    if (shortcodeChanging) {
      setShowConfirm(true);
    } else {
      save.mutate();
    }
  };

  if (scope === "landlord" && !landlordOwnerId) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Info className="w-4 h-4" /> Select a landlord above to view or edit their payment details.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading payment config...
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Blocking confirmation dialog when shortcode changes ────────────── */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-lg border-red-300">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Critical Warning — M-Pesa Shortcode Change
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm pt-1">
                <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 space-y-2">
                  <p className="font-bold text-base">
                    ⛔ Tenant payments will FAIL if you proceed without updating the server.
                  </p>
                  <p>
                    You are changing a Paybill or Till number. The M-Pesa API passkey stored
                    on this server is cryptographically tied to the <strong>original</strong> shortcode.
                    Saving a new number without updating the server credentials will cause every
                    STK Push payment to be rejected by Safaricom — tenants will not be able to
                    pay rent electronically until this is fixed.
                  </p>
                  <p className="font-semibold">
                    Before clicking confirm, ensure your system administrator has already
                    updated the server with the new M-Pesa credentials for the new
                    Paybill / Till number.
                  </p>
                  <p>
                    If you are not certain the server has been updated, click Cancel and
                    contact your system administrator first.
                  </p>
                </div>
                <p className="text-gray-600 text-xs">
                  Manual Paybill and Till payments shown to tenants will update immediately.
                  STK Push will only work correctly once the server credentials match.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowConfirm(false)}
              className="border-gray-300"
            >
              Cancel — Do Not Save
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={save.isPending}
              onClick={() => {
                setShowConfirm(false);
                save.mutate();
              }}
            >
              {save.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                : "I confirm the server has been updated — Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scope-specific status banner */}
      {(scope === "mine" || scope === "landlord") && (
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${
          config?.configured ? "border-emerald-100 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}>
          {config?.configured
            ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          }
          <div className="text-sm">
            {config?.configured ? (
              <>
                <p className="font-semibold text-emerald-800">
                  {scope === "mine" ? "Your own payment details are active" : "This landlord's own payment details are active"}
                </p>
                <p className="mt-1 text-emerald-700">
                  {scope === "mine"
                    ? "Your tenants see the Paybill/Till/bank details below — not the organisation's default."
                    : "Their tenants see the Paybill/Till/bank details below — not the organisation's default."}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-amber-800">
                  {scope === "mine" ? "You haven't set up your own payment details yet" : "This landlord hasn't set up their own payment details yet"}
                </p>
                <p className="mt-1 text-amber-700">
                  {scope === "mine"
                    ? "Your tenants are currently seeing the organisation's default payment details. Save the form below to use your own instead."
                    : "Their tenants are currently seeing the organisation's default payment details. Save the form below to set up their own instead."}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold">How this works</p>
          <p className="mt-1 text-blue-700">
            {scope === "mine"
              ? "Configure the payment details your tenants should use — set different accounts for rent and utility bills, or use one account for both. This only affects your own properties; other landlords in the same organisation (if any) set their own separately."
              : scope === "landlord"
              ? "Configure this landlord's payment details on their behalf — useful if they gave you their Till or bank details directly. This only affects their properties; the organisation default and other landlords' settings are unaffected."
              : "Configure the default payment details tenants should use. These appear in the tenant portal under each payment screen. If a specific landlord has set up their own payment details, tenants linked to that landlord's properties see theirs instead of this default."}
          </p>
        </div>
      </div>

      {/* Rent payment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-green-600" /> Rent Payment Details
          </CardTitle>
          <CardDescription>Where tenants should send their monthly rent</CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentMethodSection
            title="Rent"
            icon={Building2}
            color="#16a34a"
            account={rent}
            savedAccount={savedRent}
            serverShortcode={config?.serverShortcode ?? ""}
            onChange={patch => setRent(r => ({ ...r, ...patch }))}
          />
        </CardContent>
      </Card>

      {/* Utility payment */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-sky-600" /> Utility Bill Payment Details
              </CardTitle>
              <CardDescription>Where tenants should pay water, electricity, etc.</CardDescription>
            </div>
            <div className="flex items-center gap-2 ml-4 mt-1">
              <Switch checked={sameAsRent} onCheckedChange={setSameAsRent} id="same-as-rent" />
              <Label htmlFor="same-as-rent" className="text-xs cursor-pointer">Same as rent</Label>
            </div>
          </div>
        </CardHeader>
        {!sameAsRent && (
          <CardContent>
            <PaymentMethodSection
              title="Utility"
              icon={Smartphone}
              color="#0284c7"
              account={utility}
              savedAccount={savedUtility}
              serverShortcode={config?.serverShortcode ?? ""}
              onChange={patch => setUtility(u => ({ ...u, ...patch }))}
            />
          </CardContent>
        )}
        {sameAsRent && (
          <CardContent>
            <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-100 p-4 text-sm text-green-800">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              Utility bills will use the same payment details as rent.
            </div>
          </CardContent>
        )}
      </Card>

      {scope === "landlord" && (
        <DarajaCredentialsSection
          endpoint={endpoint}
          testEndpoint={withOrgParam(`/api/payment-config/landlord/${landlordOwnerId}/test-stk`, organizationId)}
        />
      )}

      <Button
        onClick={handleSaveClick}
        disabled={save.isPending}
        className={`w-full h-10 text-white ${shortcodeChanging ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
      >
        {save.isPending
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
          : shortcodeChanging
          ? <><AlertTriangle className="w-4 h-4 mr-2" /> Save — Read Warning Before Proceeding</>
          : <><Save className="w-4 h-4 mr-2" /> Save Payment Configuration</>}
      </Button>
    </div>
  );
}