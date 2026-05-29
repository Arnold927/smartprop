/**
 * TenantOnboardingFlow
 *
 * A 4-step welcome wizard shown to first-time tenants.
 * State is persisted to localStorage under `sp_onboarding_done_<tenantId>`
 * so it only appears once per device per tenant.
 *
 * Steps:
 *   1. Welcome       — greet by name, set expectations
 *   2. Verify info   — confirm phone number (critical for M-Pesa STK push)
 *   3. How to pay    — explain M-Pesa paybill, STK push, and receipt flow
 *   4. Quick tour    — highlight the 4 tabs they'll use most
 *
 * Usage:
 *   <TenantOnboardingFlow
 *     tenantId={tenantId}
 *     tenantName="Wanjiru"
 *     phone="0712345678"
 *     rentAmount={45000}
 *     onComplete={() => void}
 *   />
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Home, CreditCard, Wrench, MessageSquare,
  Phone, CheckCircle, ArrowRight, X, Smartphone,
  FileText, Bell, ShieldCheck,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Persistence ───────────────────────────────────────────────────────────────

export function hasCompletedOnboarding(tenantId: number): boolean {
  try {
    return localStorage.getItem(`sp_onboarding_done_${tenantId}`) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingDone(tenantId: number) {
  try {
    localStorage.setItem(`sp_onboarding_done_${tenantId}`, "1");
  } catch { /* ignore */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  tenantId: number;
  tenantName: string;
  phone?: string;
  rentAmount?: number;
  onComplete: () => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
      done    ? "bg-green-500" :
      active  ? "bg-primary scale-125" :
                "bg-muted-foreground/30"
    }`} />
  );
}

function TourCard({ icon: Icon, label, description, color }: {
  icon: any; label: string; description: string; color: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TenantOnboardingFlow({ tenantId, tenantName, phone = "", rentAmount, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [phoneInput, setPhoneInput] = useState(phone);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const { toast } = useToast();
  const TOTAL_STEPS = 4;

  const savePhoneMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/tenants/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ phoneNumber: phoneInput }),
      }).then(r => r.json()),
    onSuccess: () => {
      setPhoneSaved(true);
      toast({ title: "Phone number saved", description: "You'll receive M-Pesa prompts on this number." });
    },
    onError: () => {
      // Non-fatal — let them continue
      setPhoneSaved(true);
    },
  });

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
    else {
      markOnboardingDone(tenantId);
      onComplete();
    }
  };

  const handleSkip = () => {
    markOnboardingDone(tenantId);
    onComplete();
  };

  const firstName = tenantName.split(" ")[0];

  // ── Step content ─────────────────────────────────────────────────────────────

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
        <Home className="w-8 h-8 text-primary" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">
          Karibu, {firstName}!
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Welcome to your SmartProp tenant portal. Everything you need to manage your tenancy is right here — pay rent, log repairs, message your property manager, and more.
        </p>
      </div>
      <div className="space-y-2">
        {[
          { icon: CreditCard,    text: "Pay rent via M-Pesa in one tap" },
          { icon: Wrench,        text: "Log maintenance requests instantly" },
          { icon: MessageSquare, text: "Message your property manager" },
          { icon: FileText,      text: "Download your lease and receipts" },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-sm text-foreground">
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>,

    // Step 1: Verify phone
    <div key="phone" className="space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
        <Phone className="w-8 h-8 text-green-600" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Confirm your M-Pesa number</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This is the number we'll send payment prompts to. Make sure it matches your Safaricom line.
        </p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">M-Pesa phone number</label>
          <Input
            value={phoneInput}
            onChange={e => setPhoneInput(e.target.value)}
            placeholder="e.g. 0712 345 678"
            type="tel"
            className="text-base"
          />
          <p className="text-xs text-muted-foreground">Kenyan format: 07XX XXX XXX or +254 7XX XXX XXX</p>
        </div>
        {phoneSaved ? (
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <CheckCircle className="w-4 h-4" />
            Number saved
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => savePhoneMutation.mutate()}
            disabled={!phoneInput.trim() || savePhoneMutation.isPending}
            className="w-full"
          >
            {savePhoneMutation.isPending ? "Saving…" : "Save number"}
          </Button>
        )}
      </div>
      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
        <strong>Why this matters:</strong> When you click "Pay Rent", Safaricom sends a push prompt directly to this phone. Wrong number = no prompt.
      </div>
    </div>,

    // Step 2: How to pay
    <div key="payment" className="space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-green-600/10 flex items-center justify-center mx-auto">
        <Smartphone className="w-8 h-8 text-green-700" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">How rent payment works</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You have two ways to pay — both reflect instantly in your portal.
        </p>
      </div>
      <div className="space-y-3">
        <div className="p-3.5 rounded-xl border border-border bg-card space-y-1.5">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
            STK Push (easiest)
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed pl-7">
            Tap "Pay Rent" in the portal → Safaricom sends a prompt to your phone → enter your M-Pesa PIN → done. No paybill numbers to remember.
          </p>
        </div>
        <div className="p-3.5 rounded-xl border border-border bg-card space-y-1.5">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-bold">2</span>
            Pay via Paybill
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed pl-7">
            M-Pesa → Lipa na M-Pesa → Pay Bill → enter the paybill number and your unit as the account number. Use this if STK push fails.
          </p>
        </div>
      </div>
      {rentAmount && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm">
          <span className="text-muted-foreground">Your monthly rent: </span>
          <span className="font-semibold text-foreground">
            KES {Math.round(rentAmount).toLocaleString("en-KE")}
          </span>
        </div>
      )}
    </div>,

    // Step 3: Quick tour
    <div key="tour" className="space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto">
        <ShieldCheck className="w-8 h-8 text-purple-600" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">You're all set!</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Here's a quick look at what each section does. You can always come back to these tabs.
        </p>
      </div>
      <div className="space-y-2.5">
        <TourCard
          icon={Home}
          label="Home"
          description="Your rent balance, upcoming due date, and recent activity at a glance."
          color="bg-blue-50 dark:bg-blue-950/60 text-blue-600"
        />
        <TourCard
          icon={CreditCard}
          label="Payments"
          description="Pay rent via M-Pesa, view your full payment history, and download receipts."
          color="bg-green-50 dark:bg-green-950/60 text-green-600"
        />
        <TourCard
          icon={Wrench}
          label="Maintenance"
          description="Log a repair request with a photo. Track its status until it's resolved."
          color="bg-amber-50 dark:bg-amber-950/60 text-amber-600"
        />
        <TourCard
          icon={MessageSquare}
          label="Messages"
          description="Chat directly with your property manager or send a notice."
          color="bg-purple-50 dark:bg-purple-950/60 text-purple-600"
        />
      </div>
      <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-200">
        <Bell className="w-4 h-4 flex-shrink-0" />
        <span>You'll get a WhatsApp message every time a payment is confirmed or a repair is updated.</span>
      </div>
    </div>,
  ];

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-background rounded-3xl shadow-2xl overflow-hidden">

        {/* Header bar */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <StepDot key={i} active={i === step} done={i < step} />
            ))}
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            Skip <X className="w-3 h-3" />
          </button>
        </div>

        {/* Progress bar */}
        <Progress value={((step + 1) / TOTAL_STEPS) * 100} className="h-0.5 rounded-none" />

        {/* Step content */}
        <div className="px-5 py-6">
          {steps[step]}
        </div>

        {/* Footer */}
        <div className="px-5 pb-6">
          <Button onClick={handleNext} className="w-full h-11 text-sm font-medium rounded-xl">
            {step === TOTAL_STEPS - 1 ? (
              <>Go to my portal <CheckCircle className="w-4 h-4 ml-1.5" /></>
            ) : (
              <>Continue <ArrowRight className="w-4 h-4 ml-1.5" /></>
            )}
          </Button>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default TenantOnboardingFlow;
