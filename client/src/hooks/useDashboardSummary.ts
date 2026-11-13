import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/** Shape of GET /api/dashboard/summary (all figures are summed in the database). */
export interface DashboardSummary {
  generatedAt: string;
  tenants: {
    total: number; active: number; pending: number; byStatus: Record<string, number>;
    expiringLeases: { count: number; items: { id: number; firstName: string; lastName: string; leaseEndDate: string | null }[] };
    sample: { id: number; firstName: string; lastName: string; status: string }[];
  };
  payments: {
    revenueThisMonth: number; collectedCount: number;
    overdueAmount: number; overdueCount: number;
    pendingAmount: number; pendingCount: number;
    recentPaid: { id: number; amount: string; paidDate: string | null; createdAt: string | null; invoiceNumber: string | null;
      tenant: { firstName: string; lastName: string } }[];
  };
  expensesThisMonth: number;
  /** six calendar months ending this month: "YYYY-MM", income received, approved/paid expenses */
  monthly: { month: string; income: number; expense: number }[];
  /** rent by due month (last 6 months that have payments): collected / pending / overdue */
  dueTrend: { month: string; collected: number; pending: number; overdue: number }[];
}

/**
 * Shared by the Overview, Finance and Property Manager dashboards (admin/manager only).
 * Replaces downloading every tenant/payment/expense row just to add them up.
 */
export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
    queryFn: async () => {
      const r = await apiRequest("/api/dashboard/summary");
      if (!r.ok) throw new Error("summary failed");
      return r.json();
    },
    staleTime: 30_000,
    retry: false,
  });
}
