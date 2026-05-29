/**
 * MarketingKPIGrid
 *
 * Changes vs. original:
 *  - Removed ALL hardcoded change.value deltas (20, 8, 12, 25, 15, 10)
 *    which were invented numbers.
 *  - Trend direction is now derived from the live metric values:
 *    open rate ≥ 20% is good, click rate ≥ 3% is good, etc. — industry
 *    benchmarks used as threshold rather than fake percentage changes.
 *  - Zero-value metrics now show a neutral trend instead of a misleading
 *    "increase" arrow.
 *  - safeNumber / formatNumber helpers unchanged; component interface
 *    unchanged so no call-site changes needed.
 */
import React from "react";
import { KPIWidget } from "./KPIWidget";
import { Send, Eye, MousePointer, Users, Target, Mail } from "lucide-react";

interface MarketingMetrics {
  campaigns_sent:  number;
  avg_open_rate:   number;
  avg_click_rate:  number;
  new_subscribers: number;
  total_audience:  number;
  conversion_rate: number;
}

interface MarketingKPIGridProps {
  metrics?: MarketingMetrics;
  loading?: boolean;
}

const safeNumber = (value: any, defaultValue = 0): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || defaultValue;
  return defaultValue;
};

const formatNumber = (value: any, defaultValue = 0): string =>
  safeNumber(value, defaultValue).toLocaleString();

export function MarketingKPIGrid({ metrics, loading }: MarketingKPIGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  const campaignsSent    = safeNumber(metrics?.campaigns_sent);
  const avgOpenRate      = safeNumber(metrics?.avg_open_rate);
  const avgClickRate     = safeNumber(metrics?.avg_click_rate);
  const newSubscribers   = safeNumber(metrics?.new_subscribers);
  const totalAudience    = safeNumber(metrics?.total_audience);
  const conversionRate   = safeNumber(metrics?.conversion_rate);

  // Industry benchmark thresholds used for trend direction
  const openRateGood      = avgOpenRate  >= 20;   // 20 % open rate is solid
  const clickRateGood     = avgClickRate >= 3;    // 3 % CTR is solid
  const conversionGood    = conversionRate >= 2;  // 2 % conversion is solid

  return (
    <div className="space-y-6">
      {/* Main Marketing KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIWidget
          title="Campaigns Sent"
          value={campaignsSent}
          variant="primary"
          icon={<Send className="h-5 w-5" />}
          trend={campaignsSent > 0 ? "up" : "neutral"}
          subtitle="Active campaigns"
        />

        <KPIWidget
          title="Average Open Rate"
          value={`${avgOpenRate}%`}
          variant={openRateGood ? "success" : "warning"}
          icon={<Eye className="h-5 w-5" />}
          trend={openRateGood ? "up" : "down"}
          subtitle="Email performance"
        />

        <KPIWidget
          title="Average Click Rate"
          value={`${avgClickRate}%`}
          variant={clickRateGood ? "success" : "secondary"}
          icon={<MousePointer className="h-5 w-5" />}
          trend={clickRateGood ? "up" : "neutral"}
          subtitle="Click-through rate"
        />

        <KPIWidget
          title="New Subscribers"
          value={`+${newSubscribers}`}
          variant={newSubscribers > 0 ? "success" : "secondary"}
          icon={<Users className="h-5 w-5" />}
          trend={newSubscribers > 0 ? "up" : "neutral"}
          subtitle="Audience expansion"
        />
      </div>

      {/* Secondary Marketing KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <KPIWidget
          title="Total Audience"
          value={formatNumber(totalAudience)}
          variant="secondary"
          icon={<Mail className="h-5 w-5" />}
          trend={totalAudience > 0 ? "up" : "neutral"}
          subtitle="Subscriber base"
        />

        <KPIWidget
          title="Conversion Rate"
          value={`${conversionRate}%`}
          variant={conversionGood ? "success" : "secondary"}
          icon={<Target className="h-5 w-5" />}
          trend={conversionGood ? "up" : "neutral"}
          subtitle="Lead to customer"
        />
      </div>
    </div>
  );
}
