/**
 * server/services/plans.ts
 *
 * One place that answers "what is this organisation allowed to do?".
 *
 * The platform admin owns the plan catalogue (subscription_plans) and each organisation's
 * subscription terms. An organisation's limits resolve in this order:
 *
 *   1. organizations.limit_overrides[key]   – set by the platform admin for that organisation only
 *   2. subscription_plans[key]              – the plan's limit (changes here reach every organisation on the plan)
 *   3. organizations.max_properties / max_users – only for a legacy plan id that is not in the catalogue
 *
 * A null limit means unlimited. Units are only limited when a plan or override says so.
 */

import { db } from "../db.js";
import { organizations, subscriptionPlans, properties, units, users } from "@shared/schema";
import { and, count, eq, notInArray, sql } from "drizzle-orm";

export type LimitKey = "maxProperties" | "maxUnits" | "maxUsers";
export const LIMIT_KEYS: LimitKey[] = ["maxProperties", "maxUnits", "maxUsers"];
export type Limits = Record<LimitKey, number | null>;
export type LimitSource = "override" | "plan" | "legacy";

/** Value written to the legacy max_* columns when a limit is unlimited. */
export const UNLIMITED_COLUMN_VALUE = 9999;

/** Used only when the subscription_plans table does not exist yet (migration not run). */
export const DEFAULT_PLANS = [
  { id: "basic", name: "Basic", priceKes: 0, maxProperties: 5, maxUnits: null, maxUsers: 10, features: ["Up to 5 properties", "Up to 10 users"], sortOrder: 0 },
  { id: "starter", name: "Starter", priceKes: 2500, maxProperties: 5, maxUnits: null, maxUsers: 5, features: ["Up to 5 properties", "Up to 5 users", "M-Pesa rent collection", "Basic reports"], sortOrder: 1 },
  { id: "growth", name: "Growth", priceKes: 6500, maxProperties: 25, maxUnits: null, maxUsers: 20, features: ["Up to 25 properties", "Up to 20 users", "M-Pesa rent collection", "Advanced analytics", "WhatsApp notifications", "Work orders"], sortOrder: 2 },
  { id: "enterprise", name: "Enterprise", priceKes: 15000, maxProperties: null, maxUnits: null, maxUsers: null, features: ["Unlimited properties & users", "All Growth features", "Dedicated support", "Custom integrations", "SLA guarantee"], sortOrder: 3 },
].map((p) => ({
  ...p, description: null as string | null,
  featureFlags: (p.id === "enterprise" ? { whiteLabel: true, customDomain: true } : p.id === "growth" ? { whiteLabel: true } : {}) as Record<string, boolean>,
  trialDays: null as number | null,
  isActive: true, isPublic: p.id !== "basic",
}));

export type PlanView = {
  id: string; name: string; description: string | null; priceKes: number;
  maxProperties: number | null; maxUnits: number | null; maxUsers: number | null;
  features: string[]; featureFlags: Record<string, boolean>; trialDays: number | null;
  isActive: boolean; isPublic: boolean; sortOrder: number;
};

function toPlanView(r: any): PlanView {
  return {
    id: r.id, name: r.name, description: r.description ?? null, priceKes: Number(r.priceKes ?? 0),
    maxProperties: r.maxProperties ?? null, maxUnits: r.maxUnits ?? null, maxUsers: r.maxUsers ?? null,
    features: Array.isArray(r.features) ? r.features : [], featureFlags: r.featureFlags ?? {},
    trialDays: r.trialDays ?? null, isActive: r.isActive !== false, isPublic: r.isPublic !== false,
    sortOrder: r.sortOrder ?? 0,
  };
}

const isMissingTable = (e: any) => e?.code === "42P01" || /subscription_plans/.test(String(e?.message ?? ""));

export async function listPlans(opts: { includeInactive?: boolean; publicOnly?: boolean } = {}): Promise<PlanView[]> {
  try {
    const rows = await db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder, subscriptionPlans.name);
    return rows.map(toPlanView).filter((p) => (opts.includeInactive || p.isActive) && (!opts.publicOnly || p.isPublic));
  } catch (e) {
    if (isMissingTable(e)) return DEFAULT_PLANS.filter((p) => !opts.publicOnly || p.isPublic);
    throw e;
  }
}

export async function getPlan(planId: string | null | undefined): Promise<PlanView | null> {
  if (!planId) return null;
  try {
    const [row] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1);
    return row ? toPlanView(row) : null;
  } catch (e) {
    if (isMissingTable(e)) return (DEFAULT_PLANS.find((p) => p.id === planId) as PlanView | undefined) ?? null;
    throw e;
  }
}

export type Entitlements = {
  organizationId: number;
  planId: string | null;
  plan: PlanView | null;
  planName: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** true once the trial / paid period end date has passed */
  expired: boolean;
  /** may create new billable things (properties, units, team members) */
  usable: boolean;
  limits: Limits;
  sources: Record<LimitKey, LimitSource>;
  /** price this organisation pays: its own negotiated price, else the plan's */
  priceKes: number | null;
  customPriceKes: number | null;
  featureFlags: Record<string, boolean>;
};

export function resolveLimits(
  org: { limitOverrides?: any; maxProperties?: number | null; maxUsers?: number | null },
  plan: PlanView | null,
): { limits: Limits; sources: Record<LimitKey, LimitSource> } {
  const overrides = (org.limitOverrides ?? {}) as Partial<Record<LimitKey, number | null>>;
  const limits = {} as Limits;
  const sources = {} as Record<LimitKey, LimitSource>;
  for (const k of LIMIT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, k) && overrides[k] !== undefined) {
      limits[k] = overrides[k] ?? null; sources[k] = "override";
    } else if (plan) {
      limits[k] = plan[k]; sources[k] = "plan";
    } else {
      const legacy = k === "maxProperties" ? org.maxProperties : k === "maxUsers" ? org.maxUsers : null;
      limits[k] = legacy != null && legacy < UNLIMITED_COLUMN_VALUE ? legacy : null;
      sources[k] = "legacy";
    }
  }
  return { limits, sources };
}

export async function getEntitlements(organizationId: number): Promise<Entitlements | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return null;
  const plan = await getPlan(org.subscriptionPlan);
  const { limits, sources } = resolveLimits(org as any, plan);
  const now = Date.now();
  const status = org.subscriptionStatus ?? "";
  const endsAt = status === "trial" ? org.trialEndsAt : org.currentPeriodEnd;
  const expired = !!endsAt && new Date(endsAt).getTime() < now && (status === "trial" || status === "active");
  const custom = org.customPriceKes != null ? Number(org.customPriceKes) : null;
  return {
    organizationId,
    planId: org.subscriptionPlan ?? null,
    plan,
    planName: plan?.name ?? org.subscriptionPlan ?? "your",
    status,
    trialEndsAt: org.trialEndsAt ?? null,
    currentPeriodEnd: org.currentPeriodEnd ?? null,
    expired,
    usable: (status === "active" || status === "trial") && !expired,
    limits, sources,
    priceKes: custom ?? (plan ? plan.priceKes : null),
    customPriceKes: custom,
    featureFlags: plan?.featureFlags ?? {},
  };
}

// Plan limits only count what an organisation's team is: tenants, contractors and caretakers are
// portal logins that come in through their own flows (see middleware/billing.ts).
const NON_SEAT_ROLES = ["tenant", "contractor", "caretaker"];
export const countsTowardUserLimit = and(
  notInArray(users.role, NON_SEAT_ROLES),
  sql`${users.isActive} IS DISTINCT FROM false`,
);

export async function getUsage(organizationId: number) {
  const [p] = await db.select({ n: count() }).from(properties).where(eq(properties.organizationId, organizationId));
  const [u] = await db.select({ n: count() }).from(units).where(eq(units.organizationId, organizationId));
  const [m] = await db.select({ n: count() }).from(users).where(and(eq(users.organizationId, organizationId), countsTowardUserLimit));
  return { properties: Number(p?.n ?? 0), units: Number(u?.n ?? 0), users: Number(m?.n ?? 0) };
}

const NOUN: Record<LimitKey, [string, string]> = {
  maxProperties: ["property", "properties"],
  maxUnits: ["unit", "units"],
  maxUsers: ["user", "users"],
};
const CODE: Record<LimitKey, string> = {
  maxProperties: "PROPERTY_LIMIT_REACHED", maxUnits: "UNIT_LIMIT_REACHED", maxUsers: "USER_LIMIT_REACHED",
};

export type LimitCheck =
  | { ok: true }
  | { ok: false; status: number; body: { message: string; code: string; current?: number; max?: number | null; adding?: number; subscriptionStatus?: string } };

/**
 * Can this organisation add `adding` more of something? Checks the subscription is usable first,
 * then the limit. Returns the response to send when it cannot.
 */
export async function checkCanAdd(organizationId: number, key: LimitKey, adding = 1): Promise<LimitCheck> {
  const ent = await getEntitlements(organizationId);
  if (!ent) return { ok: false, status: 403, body: { message: "Organization not found", code: "ORG_NOT_FOUND" } };
  if (!ent.usable) {
    const why = ent.expired
      ? (ent.status === "trial" ? "Your free trial has ended." : "Your subscription period has ended.")
      : "Your subscription is inactive.";
    return {
      ok: false, status: 402,
      body: { message: `${why} Please update your billing details to continue.`, code: "SUBSCRIPTION_INACTIVE", subscriptionStatus: ent.expired ? "expired" : ent.status },
    };
  }
  const max = ent.limits[key];
  if (max == null) return { ok: true };
  const usage = await getUsage(organizationId);
  const current = key === "maxProperties" ? usage.properties : key === "maxUnits" ? usage.units : usage.users;
  if (current + adding > max) {
    const [one, many] = NOUN[key];
    const noun = max === 1 ? one : many;
    const room = Math.max(0, max - current);
    const extra = adding > 1 ? ` You tried to add ${adding} and have room for ${room}.` : "";
    return {
      ok: false, status: 403,
      body: {
        message: `Your ${ent.planName} plan allows a maximum of ${max} ${noun}.${extra} Upgrade your plan to add more.`,
        code: CODE[key], current, max, adding,
      },
    };
  }
  return { ok: true };
}

/**
 * Keep the legacy max_properties / max_users columns equal to what the organisation is actually
 * limited to, so nothing reading them directly (reports, database tools) sees stale numbers.
 * Unlimited is stored as 9999. Pass `organizationIds` to sync a set, otherwise every organisation.
 */
export async function syncOrgLimitColumns(organizationIds?: number[]) {
  const rows = organizationIds?.length
    ? await db.select().from(organizations).where(sql`${organizations.id} IN (${sql.join(organizationIds.map((i) => sql`${i}`), sql`, `)})`)
    : await db.select().from(organizations);
  const plans = new Map((await listPlans({ includeInactive: true })).map((p) => [p.id, p]));
  for (const o of rows) {
    const { limits } = resolveLimits(o as any, plans.get(o.subscriptionPlan ?? "") ?? null);
    const mp = limits.maxProperties ?? UNLIMITED_COLUMN_VALUE;
    const mu = limits.maxUsers ?? UNLIMITED_COLUMN_VALUE;
    if (o.maxProperties !== mp || o.maxUsers !== mu) {
      await db.update(organizations).set({ maxProperties: mp, maxUsers: mu }).where(eq(organizations.id, o.id));
    }
  }
}
