/**
 * ManagementKPIGrid
 *
 * Changes vs. original:
 *  - ManagementMetrics now derives from the same /api/dashboard/metrics
 *    response — no separate endpoint needed.
 *  - Removed hardcoded change.value deltas (8, 3, 2, 5, 15, 4) —
 *    all were fabricated; replaced with data-driven variants.
 *  - revenueGrowth, customerSatisfaction, leadConversion,
 *    maintenanceResponseTime, operationalEfficiency are optional;
 *    when absent (not yet tracked) the widget shows "N/A".
 */
import React from "react";
import { KPIWidget } from "./KPIWidget";
import {
  DollarSign,
  Home,
  Users,
  Star,
  Target,
  Clock,
  Zap,
  Wrench,
} from "lucide-react";

export interface ManagementMetrics {
  // from /api/dashboard/metrics
  totalRevenue:        number;
  totalProperties:     number;
  totalUnits:          number;
  occupiedUnits:       number;
  pendingRequests:     number;
  completedTasksRate:  number;
  // optional — require separate analytics endpoints when available
  revenueGrowth?:             number;
  averageRent?:               number;
  customerSatisfaction?:      number;
  maintenanceResponseTime?:   number;
  leadConversion?:            number;
  operationalEfficiency?:     number;
}

interface ManagementKPIGridProps {
  metrics: ManagementMetrics;
  loading?: boolean;
}

const fmt = (n: number) => {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 0,
    }).format(n);
  } catch {
    return `KSh ${n.toLocaleString()}`;
  }
};

const na = (v: number | undefined, suffix = "") =>
  v !== undefined ? `${v}${suffix}` : "N/A";

export function ManagementKPIGrid({ metrics, loading }: ManagementKPIGridProps) {
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

  return (
    <div className="space-y-6">
      {/* Executive KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIWidget
          title="Total Revenue"
          value={fmt(metrics.totalRevenue)}
          variant="primary"
          icon={<DollarSign className="h-5 w-5" />}
          trend={metrics.revenueGrowth !== undefined ? (metrics.revenueGrowth >= 0 ? "up" : "down") : "neutral"}
          subtitle={
            metrics.revenueGrowth !== undefined
              ? `${metrics.revenueGrowth > 0 ? "+" : ""}${metrics.revenueGrowth}% growth`
              : "Portfolio performance"
          }
        />

        <KPIWidget
          title="Properties Managed"
          value={metrics.totalProperties}
          variant="secondary"
          icon={<Home className="h-5 w-5" />}
          trend="neutral"
          subtitle={`${metrics.totalUnits} total units`}
        />

        <KPIWidget
          title="Occupancy Rate"
          value={`${occupancyRate}%`}
          variant={occupancyRate >= 70 ? "success" : "warning"}
          icon={<Users className="h-5 w-5" />}
          trend={occupancyRate >= 70 ? "up" : "down"}
          subtitle={`${metrics.occupiedUnits} of ${metrics.totalUnits} occupied`}
        />

        <KPIWidget
          title="Customer Satisfaction"
          value={na(metrics.customerSatisfaction, "/5.0")}
          variant="success"
          icon={<Star className="h-5 w-5" />}
          trend="neutral"
          subtitle="Tenant satisfaction score"
        />
      </div>

      {/* Operational KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPIWidget
          title="Lead Conversion"
          value={na(metrics.leadConversion, "%")}
          variant="secondary"
          icon={<Target className="h-5 w-5" />}
          trend="neutral"
          subtitle="Sales efficiency"
        />

        <KPIWidget
          title="Maintenance Backlog"
          value={metrics.pendingRequests}
          variant={metrics.pendingRequests > 10 ? "warning" : "success"}
          icon={<Wrench className="h-5 w-5" />}
          trend={metrics.pendingRequests > 10 ? "up" : "down"}
          subtitle="Pending requests"
        />

        <KPIWidget
          title="Task Completion"
          value={`${metrics.completedTasksRate}%`}
          variant={metrics.completedTasksRate >= 80 ? "success" : "warning"}
          icon={<Zap className="h-5 w-5" />}
          trend={metrics.completedTasksRate >= 80 ? "up" : "down"}
          subtitle="Work-order completion rate"
        />
      </div>
    </div>
  );
}
