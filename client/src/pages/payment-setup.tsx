/**
 * client/src/pages/payment-setup.tsx
 *
 * Dedicated page for Payment Setup, reachable at /payment-setup.
 *
 * Why this exists rather than sending landlords into organization-management.tsx:
 * PaymentConfigPanel already works standalone (its own doc comment says
 * "embed anywhere in the admin UI") and /api/payment-config already permits
 * the landlord role server-side (STAFF_AND_ABOVE in requireRole.ts) — but
 * organization-management.tsx itself is gated ADMIN_MANAGER only, and its
 * other tabs (Users & Roles, Billing/subscription, org details) aren't
 * appropriate for a landlord to see. This page exposes just the one panel
 * landlords actually need, so a self-managing landlord can set their own
 * Paybill/Till without needing a manager account to do it for them.
 *
 * Admin/manager can keep using either this page or the existing tab inside
 * Organization Management — both read/write the same /api/payment-config.
 */

import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";
import PaymentConfigPanel from "@/components/payment-config-panel";
import { CreditCard } from "lucide-react";

export default function PaymentSetupPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  const { user } = useAuth();
  const isLandlord = user?.role === "landlord";

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-xl bg-emerald-500/10 p-2.5">
          <CreditCard className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Payment Setup</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLandlord
              ? "Set the Paybill, Till, or bank details your tenants should pay rent and utilities to."
              : "Set the organisation's default Paybill, Till, or bank details for tenants to pay rent and utilities to."}
          </p>
        </div>
      </div>

      <PaymentConfigPanel scope={isLandlord ? "mine" : "org"} />
    </div>
  );
}