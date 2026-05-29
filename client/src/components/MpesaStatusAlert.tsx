/**
 * MpesaStatusAlert
 *
 * Fetches GET /api/dashboard/system-status and renders an amber or red
 * banner when M-PESA is misconfigured or has stuck pending transactions.
 *
 * Renders nothing when:
 *   - Everything is healthy (mpesa configured, no stuck transactions)
 *   - The current user is not an admin or manager
 *
 * The banner disappears automatically once M-Pesa is configured — no manual
 * dismissal needed.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, XCircle } from "lucide-react";

interface SystemStatus {
  mpesa: {
    configured: boolean;
    pendingCount: number;
    expiredCount: number;
  };
}

export function MpesaStatusAlert() {
  const { user } = useAuth();

  // Only admins and managers should see this alert
  const isAdmin = user?.role === "admin";

  const { data, isLoading } = useQuery<SystemStatus>({
    queryKey: ["/api/dashboard/system-status"],
    queryFn: async () => (await apiRequest("/api/dashboard/system-status")).json(),
    // Poll every 5 minutes — picks up when M-Pesa is configured and auto-hides
    refetchInterval: 5 * 60 * 1000,
    // A 403 (non-admin) just returns nothing — don't retry
    retry: false,
    // Don't even fetch if the user isn't admin/manager
    enabled: isAdmin,
  });

  // Hide for non-admin/manager roles entirely
  if (!isAdmin) return null;
  if (isLoading || !data) return null;

  const { mpesa } = data;
  const alerts: { level: "error" | "warning"; message: string; detail: string }[] = [];

  if (!mpesa.configured) {
    alerts.push({
      level: "error",
      message: "M-Pesa not configured",
      detail:
        "Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_BUSINESS_SHORTCODE, " +
        "MPESA_PASSKEY, and MPESA_CALLBACK_URL in your environment variables. " +
        "Without these, rent payments initiated via STK Push will never be " +
        "automatically reconciled.",
    });
  }

  if (mpesa.pendingCount > 0) {
    alerts.push({
      level: "warning",
      message: `${mpesa.pendingCount} M-Pesa payment${mpesa.pendingCount === 1 ? "" : "s"} stuck pending`,
      detail:
        `${mpesa.pendingCount} STK Push transaction${mpesa.pendingCount === 1 ? " has" : "s have"} been ` +
        `pending for more than 10 minutes. Check that MPESA_* env vars are set and the server ` +
        `started cleanly.`,
    });
  }

  if (mpesa.expiredCount > 0 && mpesa.configured) {
    alerts.push({
      level: "warning",
      message: `${mpesa.expiredCount} M-Pesa payment${mpesa.expiredCount === 1 ? "" : "s"} expired today`,
      detail:
        `${mpesa.expiredCount} transaction${mpesa.expiredCount === 1 ? "" : "s"} timed out ` +
        `without a Safaricom callback in the last 24 hours. Review the M-Pesa transactions log ` +
        `and follow up with affected tenants.`,
    });
  }

  // Nothing to show — M-Pesa is healthy
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-4">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            alert.level === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-400/40 bg-amber-50/80 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          }`}
        >
          {alert.level === "error" ? (
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <span className="font-medium">{alert.message}. </span>
            <span className="opacity-80">{alert.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}