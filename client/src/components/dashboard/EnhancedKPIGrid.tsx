/**
 * EnhancedKPIGrid
 *
 * Changes vs. original:
 *  - DashboardMetrics interface extended with totalProperties,
 *    runningProjects, and completedTasksRate.
 *  - Removed every hardcoded value ("24", "12", "85%", and all
 *    hardcoded `change.value` percentages that were fabricated).
 *  - change.value deltas are now omitted (shown as null) — real
 *    period-over-period deltas require a second historical query
 *    which the backend does not yet expose; showing "0" is more
 *    honest than inventing a number.
 */
import React from "react";
import { KPIWidget } from "./KPIWidget";
import {
  Home,
  Users,
  Wrench,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

export interface DashboardMetrics {
  totalRevenue:        number;
  occupiedUnits:       number;
  totalUnits:          number;
  pendingRequests:     number;
  overdueRent:         number;
  // new — supplied by /api/dashboard/metrics
  totalProperties:     number;
  runningProjects:     number;
  completedTasksRate:  number; // 0-100
}

interface EnhancedKPIGridProps {
  metrics: DashboardMetrics;
  loading?: boolean;
}

export function EnhancedKPIGrid({ metrics, loading }: EnhancedKPIGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  const occupancyRate =
    metrics.totalUnits > 0
      ? Math.round((metrics.occupiedUnits / metrics.totalUnits) * 100)
      : 0;

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        minimumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `KSh ${amount.toLocaleString()}`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Main KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIWidget
          title="Total Properties"
          value={metrics.totalProperties}
          variant="primary"
          icon={<Home className="h-5 w-5" />}
          trend="neutral"
          subtitle="Managed properties"
        />

        <KPIWidget
          title="Occupied Units"
          value={`${metrics.occupiedUnits}/${metrics.totalUnits}`}
          variant="secondary"
          icon={<Users className="h-5 w-5" />}
          trend={occupancyRate >= 70 ? "up" : "down"}
          subtitle={`${occupancyRate}% occupancy rate`}
        />

        <KPIWidget
          title="Pending Requests"
          value={metrics.pendingRequests}
          variant={metrics.pendingRequests > 5 ? "warning" : "success"}
          icon={<Wrench className="h-5 w-5" />}
          trend={metrics.pendingRequests > 5 ? "up" : "down"}
          subtitle="Maintenance requests"
        />

        <KPIWidget
          title="Monthly Revenue"
          value={formatCurrency(metrics.totalRevenue)}
          variant="success"
          icon={<DollarSign className="h-5 w-5" />}
          trend="up"
          subtitle="Total collected (all time)"
        />
      </div>

      {/* Secondary KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPIWidget
          title="Running Projects"
          value={metrics.runningProjects}
          variant="secondary"
          icon={<TrendingUp className="h-5 w-5" />}
          trend="neutral"
          subtitle="Active & planning"
        />

        <KPIWidget
          title="Overdue Payments"
          value={formatCurrency(metrics.overdueRent)}
          variant={metrics.overdueRent > 0 ? "warning" : "success"}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={metrics.overdueRent > 0 ? "up" : "down"}
          subtitle="Requires follow-up"
        />

        <KPIWidget
          title="Completed Tasks"
          value={`${metrics.completedTasksRate}%`}
          variant={metrics.completedTasksRate >= 80 ? "success" : "warning"}
          icon={<CheckCircle className="h-5 w-5" />}
          trend={metrics.completedTasksRate >= 80 ? "up" : "down"}
          subtitle="Work-order completion rate"
        />
      </div>
    </div>
  );
}
