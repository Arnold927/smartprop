/**
 * client/src/pages/payment-setup.tsx
 *
 * Dedicated page for Payment Setup, reachable at /payment-setup.
 *
 * Why this exists rather than sending landlords into organization-management.tsx:
 * PaymentConfigPanel already works standalone (its own doc comment says
 * "embed anywhere in the admin UI") and /api/payment-config already permits
 * the landlord role server-side — but organization-management.tsx itself is
 * gated ADMIN_MANAGER only, and its other tabs (Users & Roles, Billing, org
 * details) aren't appropriate for a landlord to see. This page exposes just
 * the one panel landlords actually need.
 *
 * Three views depending on who's looking:
 *   - Landlord: their own settings (scope="mine").
 *   - Admin/manager: a picker between the org-wide default and any specific
 *     landlord's settings (scope="org" or scope="landlord"), for orgs with
 *     multiple landlords sharing one account.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import PaymentConfigPanel from "@/components/payment-config-panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CreditCard } from "lucide-react";

interface LandlordRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  configured: boolean;
}

export default function PaymentSetupPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  const { user } = useAuth();
  const isLandlord = user?.role === "landlord";

  // Radix's Select reserves the empty string for "clear selection" — it
  // throws if a SelectItem uses value="". Use a sentinel for the default
  // option instead, and treat it as "no owner selected" everywhere else.
  const ORG_DEFAULT = "__org_default__";
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>(ORG_DEFAULT);

  const { data: landlords = [] } = useQuery<LandlordRow[]>({
    queryKey: ["/api/payment-config/landlord"],
    queryFn: async () => {
      const r = await apiRequest("/api/payment-config/landlord");
      return r.json();
    },
    enabled: !isLandlord,
  });

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
              : "Set the organisation's default payment details, or a specific landlord's own — for orgs where multiple landlords share this account."}
          </p>
        </div>
      </div>

      {!isLandlord && (
        <div className="mb-5 max-w-sm">
          <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
            <SelectTrigger>
              <SelectValue placeholder="Organisation default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORG_DEFAULT}>Organisation default</SelectItem>
              {landlords.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  <span className="flex items-center gap-2">
                    {l.firstName} {l.lastName}
                    {l.configured && <Badge variant="outline" className="text-[10px] px-1.5 py-0">configured</Badge>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {landlords.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              No landlord accounts in this organisation yet — showing the organisation default.
            </p>
          )}
        </div>
      )}

      {isLandlord ? (
        <PaymentConfigPanel scope="mine" />
      ) : selectedOwnerId !== ORG_DEFAULT ? (
        <PaymentConfigPanel key={selectedOwnerId} scope="landlord" landlordOwnerId={selectedOwnerId} />
      ) : (
        <PaymentConfigPanel key="org" scope="org" />
      )}
    </div>
  );
}