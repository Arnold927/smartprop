/**
 * client/src/pages/billing/BillingPage.tsx
 *
 * Shows the current subscription status and lets admins pick a plan
 * to upgrade/renew via Pesapal.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, AlertTriangle, CreditCard, Zap, Building2, Infinity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface Plan {
  id: string;
  name: string;
  priceKes: number;
  maxProperties: number;
  maxUsers: number;
  features: string[];
}

interface BillingStatus {
  subscriptionPlan: string;
  subscriptionStatus: string;
  maxProperties: number;
  maxUsers: number;
  planDetails: Plan | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  trial: "bg-blue-100 text-blue-800",
  past_due: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-red-100 text-red-800",
  inactive: "bg-gray-100 text-muted-foreground",
};

const PLAN_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap className="h-6 w-6 text-blue-500" />,
  growth: <Building2 className="h-6 w-6 text-purple-500" />,
  enterprise: <Infinity className="h-6 w-6 text-orange-500" />,
};

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const { toast } = useToast();

  // Handle redirect back from Pesapal
  useEffect(() => {
    if (searchParams.get("success") === "1") {
      toast({ title: "Payment successful!", description: "Your subscription has been activated." });
      // Remove query params
      window.history.replaceState({}, "", "/subscription");
    } else if (searchParams.get("error")) {
      toast({
        title: "Payment issue",
        description: "We couldn't verify your payment. Please try again or contact support.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/subscription");
    }
  }, [searchParams, toast]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    Promise.all([
      fetch("/api/billing/status", { headers }).then((r) => r.json()),
      fetch("/api/billing/plans", { headers }).then((r) => r.json()),
    ])
      .then(([statusData, plansData]) => {
        setStatus(statusData);
        setPlans(Array.isArray(plansData) ? plansData : []);
      })
      .catch(() =>
        toast({ title: "Failed to load billing info", variant: "destructive" })
      )
      .finally(() => setLoading(false));
  }, []);

  async function handleCheckout(planId: string) {
    setCheckingOut(planId);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Checkout failed");
      // Redirect user to Pesapal hosted payment page
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
      setCheckingOut(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-muted-foreground">Loading billing info…</div>
      </div>
    );
  }

  const statusLabel = status?.subscriptionStatus ?? "unknown";
  const isActive = statusLabel === "active" || statusLabel === "trial";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* ── Current status banner ── */}
      <div className="rounded-xl border bg-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CreditCard className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-xl font-semibold capitalize">
              {status?.subscriptionPlan ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <Badge className={STATUS_COLORS[statusLabel] ?? "bg-gray-100 text-muted-foreground"}>
            {statusLabel.replace("_", " ")}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {status?.maxProperties ?? 0} properties · {status?.maxUsers ?? 0} users
          </p>
        </div>
      </div>

      {/* ── Alert banners ── */}
      {statusLabel === "past_due" && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <p className="text-sm">
            Your last payment failed. Please select a plan below to reactivate your account.
            New properties and users cannot be added until payment is confirmed.
          </p>
        </div>
      )}
      {statusLabel === "trial" && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-300 bg-blue-50 p-4 text-blue-800">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <p className="text-sm">
            You're on a free trial. Upgrade to a paid plan to unlock higher limits and
            ensure uninterrupted access.
          </p>
        </div>
      )}

      {/* ── Plan cards ── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = status?.subscriptionPlan === plan.id && isActive;
            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${
                  isCurrent ? "ring-2 ring-primary" : ""
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-xs">
                      Current plan
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    {PLAN_ICONS[plan.id]}
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                  </div>
                  <CardDescription>
                    <span className="text-2xl font-semibold text-foreground">
                      KES {plan.priceKes.toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground"> / month</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || checkingOut === plan.id}
                    onClick={() => handleCheckout(plan.id)}
                  >
                    {checkingOut === plan.id
                      ? "Redirecting to Pesapal…"
                      : isCurrent
                      ? "Active"
                      : `Upgrade to ${plan.name}`}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Payments processed securely via Pesapal. M-Pesa, Visa, Mastercard and bank
        transfers accepted in KES.
      </p>
    </div>
  );
}