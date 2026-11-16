/** Shared types and helpers for the plan / subscription screens (platform admin and billing). */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/** null = unlimited */
export type LimitValue = number | null;

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceKes: number;
  maxProperties: LimitValue;
  maxUnits: LimitValue;
  maxUsers: LimitValue;
  features: string[];
  featureFlags: Record<string, boolean>;
  trialDays: number | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  organizationCount?: number;
}

export type LimitKey = "maxProperties" | "maxUnits" | "maxUsers";
export const LIMIT_LABELS: Record<LimitKey, { label: string; noun: string }> = {
  maxProperties: { label: "Properties", noun: "properties" },
  maxUnits: { label: "Units", noun: "units" },
  maxUsers: { label: "Team members", noun: "team members" },
};
export const LIMIT_KEYS: LimitKey[] = ["maxProperties", "maxUnits", "maxUsers"];

export const SUBSCRIPTION_STATUSES = [
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "cancelled", label: "Cancelled" },
  { value: "inactive", label: "Inactive" },
];

export const fmtLimit = (n: LimitValue | undefined) => (n == null ? "Unlimited" : n.toLocaleString("en-KE"));
export const fmtKes = (n: number | null | undefined) => (n == null ? "—" : `KES ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`);

/** "5 properties · 5 team members · unlimited units" */
export function limitSummary(p: { maxProperties: LimitValue; maxUnits: LimitValue; maxUsers: LimitValue }) {
  return LIMIT_KEYS.map((k) => `${p[k] == null ? "Unlimited" : p[k]!.toLocaleString("en-KE")} ${LIMIT_LABELS[k].noun}`).join(" · ");
}

export function usePlatformPlans() {
  return useQuery<{ plans: Plan[]; legacyPlans: { id: string; organizationCount: number }[] }>({
    queryKey: ["/api/platform/plans"],
    queryFn: async () => {
      const r = await apiRequest("/api/platform/plans");
      return r.json();
    },
  });
}

/** yyyy-mm-dd for an <input type="date">, in Nairobi time (the platform's home). */
export function toDateInput(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
