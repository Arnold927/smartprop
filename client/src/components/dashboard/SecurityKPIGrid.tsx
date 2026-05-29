/**
 * SecurityKPIGrid
 *
 * Changes vs. original:
 *  - Removed ALL hardcoded change.value deltas (15, 8, 0, 12, 3, 5, 15)
 *    which were invented numbers. The API response already provides real
 *    counts for every metric shown — no fabricated trend values needed.
 *  - Trend direction is now derived from the live metric values themselves
 *    (e.g. alerts > 0 is bad/up, pendingApprovals > 5 is warning, etc.).
 *  - Component shape (props / interface) is unchanged so no call-site
 *    changes are needed.
 */
import React from "react";
import { KPIWidget } from "./KPIWidget";
import {
  Shield,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Timer,
  TrendingUp,
} from "lucide-react";

interface SecurityMetrics {
  passesProcessedToday: number;
  currentlyOnSite:      number;
  averageVisitDuration: number;
  securityAlerts:       number;
  todayCheckIns:        number;
  pendingApprovals:     number;
  totalVisitors:        number;
  averageApprovalTime:  number;
}

interface SecurityKPIGridProps {
  metrics: SecurityMetrics;
  loading?: boolean;
  onTabChange?: (tab: string) => void;
}

export function SecurityKPIGrid({ metrics, loading, onTabChange }: SecurityKPIGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Security KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIWidget
          title="Passes Processed Today"
          value={metrics.passesProcessedToday}
          variant="primary"
          icon={<Shield className="h-5 w-5" />}
          trend="neutral"
          subtitle="Gate passes issued"
          onClick={onTabChange ? () => onTabChange("gate-pass") : undefined}
        />

        <KPIWidget
          title="Currently On-Site"
          value={metrics.currentlyOnSite}
          variant="secondary"
          icon={<Users className="h-5 w-5" />}
          trend="neutral"
          subtitle="Live visitor count"
          onClick={onTabChange ? () => onTabChange("visitor-management") : undefined}
        />

        <KPIWidget
          title="Security Alerts"
          value={metrics.securityAlerts}
          variant={metrics.securityAlerts > 0 ? "warning" : "success"}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={metrics.securityAlerts > 0 ? "up" : "neutral"}
          subtitle={
            metrics.securityAlerts > 0
              ? "Active incidents — action required"
              : "No active alerts"
          }
          onClick={onTabChange ? () => onTabChange("vehicle-registration") : undefined}
        />

        <KPIWidget
          title="Today's Check-ins"
          value={metrics.todayCheckIns}
          variant="success"
          icon={<CheckCircle className="h-5 w-5" />}
          trend="neutral"
          subtitle="Successful entries"
          onClick={onTabChange ? () => onTabChange("qr-scanner") : undefined}
        />
      </div>

      {/* Secondary Security KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPIWidget
          title="Pending Approvals"
          value={metrics.pendingApprovals}
          variant={metrics.pendingApprovals > 5 ? "warning" : "secondary"}
          icon={<Clock className="h-5 w-5" />}
          trend={metrics.pendingApprovals > 5 ? "up" : "neutral"}
          subtitle="Awaiting authorisation"
          onClick={onTabChange ? () => onTabChange("visitor-management") : undefined}
        />

        <KPIWidget
          title="Avg Visit Duration"
          value={
            metrics.averageVisitDuration > 0
              ? `${metrics.averageVisitDuration}h`
              : "N/A"
          }
          variant="secondary"
          icon={<Timer className="h-5 w-5" />}
          trend="neutral"
          subtitle="Per visitor session"
          onClick={onTabChange ? () => onTabChange("visitor-management") : undefined}
        />

        <KPIWidget
          title="Avg Approval Time"
          value={
            metrics.averageApprovalTime > 0
              ? `${metrics.averageApprovalTime}min`
              : "N/A"
          }
          variant={metrics.averageApprovalTime <= 10 ? "success" : "warning"}
          icon={<TrendingUp className="h-5 w-5" />}
          trend={metrics.averageApprovalTime <= 10 ? "down" : "up"}
          subtitle="Processing efficiency"
          onClick={onTabChange ? () => onTabChange("visitor-management") : undefined}
        />
      </div>
    </div>
  );
}
