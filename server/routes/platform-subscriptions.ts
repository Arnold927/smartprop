/**
 * server/routes/platform-subscriptions.ts
 *
 * Platform-admin control of plans and subscriptions. Mounted inside routes/platform-admin.ts, which
 * already requires a signed-in platform_admin for everything under /api/platform — nobody else
 * (not even an organisation's own admin) can read or change any of this.
 *
 *   GET    /plans                          the catalogue (with how many organisations are on each plan)
 *   POST   /plans                          create a plan
 *   PUT    /plans/:id                      edit a plan — reaches every organisation on it that has no override
 *   DELETE /plans/:id                      remove an unused plan (otherwise deactivate it)
 *   GET    /organizations/:id/subscription one organisation's terms, effective limits and usage
 *   PATCH  /organizations/:id/subscription change one organisation only
 *   POST   /subscriptions/bulk             change many (or all) organisations at once; supports dryRun
 *
 * Limits: a number, or null for unlimited. An organisation's own limit ("custom") wins over its plan's;
 * "plan" removes the override so it follows the plan again.
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { organizations, subscriptionPlans } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog } from "../middleware/auditLog";
import {
  getEntitlements, getPlan, getUsage, listPlans, resolveLimits, syncOrgLimitColumns,
  LIMIT_KEYS, type LimitKey,
} from "../services/plans";

const router = Router();

const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "cancelled", "inactive"] as const;

const limitValue = z.number().int().min(0).max(1_000_000).nullable();
const planFields = {
  name: z.string().trim().min(2, "Give the plan a name").max(100),
  description: z.string().trim().max(500).nullable().optional(),
  priceKes: z.number().min(0).max(100_000_000),
  maxProperties: limitValue,
  maxUnits: limitValue,
  maxUsers: limitValue,
  features: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  featureFlags: z.record(z.boolean()).default({}),
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
};
const createPlanSchema = z.object({ id: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/, "Use letters, numbers, - or _ for the plan id").optional(), ...planFields });
const updatePlanSchema = z.object(planFields).partial();

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

function planRow(input: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of ["name", "description", "maxProperties", "maxUnits", "maxUsers", "features", "featureFlags", "trialDays", "isActive", "isPublic", "sortOrder"]) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  if (input.priceKes !== undefined) out.priceKes = String(input.priceKes);
  return out;
}

// ── Plans ─────────────────────────────────────────────────────────────────────

router.get("/plans", async (_req: any, res: any) => {
  try {
    const plans = await listPlans({ includeInactive: true });
    const counts = await db
      .select({ plan: organizations.subscriptionPlan, n: sql<number>`count(*)::int` })
      .from(organizations)
      .where(sql`${organizations.isActive} IS DISTINCT FROM false`)
      .groupBy(organizations.subscriptionPlan);
    const byPlan = new Map(counts.map((c) => [c.plan, Number(c.n)]));
    const known = new Set(plans.map((p) => p.id));
    res.json({
      plans: plans.map((p) => ({ ...p, organizationCount: byPlan.get(p.id) ?? 0 })),
      // plan ids organisations are still on that are not in the catalogue (e.g. the old "basic")
      legacyPlans: counts.filter((c) => c.plan && !known.has(c.plan)).map((c) => ({ id: c.plan, organizationCount: Number(c.n) })),
    });
  } catch (err: any) {
    console.error("[platform] list plans:", err);
    res.status(500).json({ message: "Failed to load plans" });
  }
});

router.post("/plans", auditLog("subscription_plan", "CREATE") as any, async (req: any, res: any) => {
  const parsed = createPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid plan", errors: parsed.error.flatten().fieldErrors });
  const id = parsed.data.id ?? slugify(parsed.data.name);
  if (!id) return res.status(400).json({ message: "Give the plan a name" });
  try {
    if (await getPlan(id)) return res.status(409).json({ message: `A plan with the id "${id}" already exists.` });
    const [row] = await db.insert(subscriptionPlans).values({ id, ...planRow(parsed.data) } as any).returning();
    res.locals.auditEntityId = id;
    res.status(201).json(row);
  } catch (err: any) {
    console.error("[platform] create plan:", err);
    res.status(500).json({ message: "Failed to create the plan" });
  }
});

router.put("/plans/:id", auditLog("subscription_plan", "UPDATE") as any, async (req: any, res: any) => {
  const parsed = updatePlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid plan", errors: parsed.error.flatten().fieldErrors });
  const id = String(req.params.id);
  try {
    const existing = await getPlan(id);
    if (!existing) return res.status(404).json({ message: "Plan not found" });
    const [row] = await db.update(subscriptionPlans).set({ ...planRow(parsed.data), updatedAt: new Date() } as any).where(eq(subscriptionPlans.id, id)).returning();
    // keep the stored limits of every organisation on this plan in step with the new numbers
    const affected = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.subscriptionPlan, id));
    if (affected.length) await syncOrgLimitColumns(affected.map((o) => o.id));
    res.locals.auditOldValues = existing;
    res.locals.auditNewValues = row;
    res.locals.auditEntityId = id;
    res.json({ ...row, organizationsUpdated: affected.length });
  } catch (err: any) {
    console.error("[platform] update plan:", err);
    res.status(500).json({ message: "Failed to update the plan" });
  }
});

router.delete("/plans/:id", auditLog("subscription_plan", "DELETE") as any, async (req: any, res: any) => {
  const id = String(req.params.id);
  try {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(organizations).where(eq(organizations.subscriptionPlan, id));
    if (Number(n) > 0) {
      return res.status(409).json({
        message: `${n} organisation${Number(n) === 1 ? " is" : "s are"} on this plan. Move them to another plan first, or switch the plan off instead of deleting it.`,
        code: "PLAN_IN_USE",
      });
    }
    const gone = await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, id)).returning({ id: subscriptionPlans.id });
    if (!gone.length) return res.status(404).json({ message: "Plan not found" });
    res.locals.auditEntityId = id;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[platform] delete plan:", err);
    res.status(500).json({ message: "Failed to delete the plan" });
  }
});

// ── One organisation ──────────────────────────────────────────────────────────

const limitSetting = z.union([
  z.object({ mode: z.literal("plan") }),
  z.object({ mode: z.literal("unlimited") }),
  z.object({ mode: z.literal("custom"), value: z.number().int().min(0).max(1_000_000) }),
]);
const limitsSchema = z.object({
  maxProperties: limitSetting.optional(),
  maxUnits: limitSetting.optional(),
  maxUsers: limitSetting.optional(),
});
const dateOrNull = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]);

const terms = {
  plan: z.string().trim().min(1).max(50).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  trialEndsAt: dateOrNull.optional(),
  currentPeriodEnd: dateOrNull.optional(),
  extendTrialDays: z.number().int().min(1).max(730).optional(),
  limits: limitsSchema.optional(),
  customPriceKes: z.number().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
};
const orgTermsSchema = z.object(terms);

const toDate = (v: string | null | undefined) => (v === null ? null : v === undefined ? undefined : new Date(v.length === 10 ? `${v}T23:59:59+03:00` : v));

/** Turn the request into org column changes; `current` is the org's present overrides. */
async function buildOrgUpdate(input: z.infer<typeof orgTermsSchema>, org: { limitOverrides: any; trialEndsAt: Date | null }): Promise<{ set: Record<string, any>; error?: string }> {
  const set: Record<string, any> = {};
  if (input.plan !== undefined) {
    const plan = await getPlan(input.plan);
    if (!plan) return { set, error: `There is no plan called "${input.plan}".` };
    set.subscriptionPlan = plan.id;
  }
  if (input.status !== undefined) set.subscriptionStatus = input.status;
  if (input.trialEndsAt !== undefined) set.trialEndsAt = toDate(input.trialEndsAt);
  if (input.extendTrialDays !== undefined) {
    const base = org.trialEndsAt && new Date(org.trialEndsAt).getTime() > Date.now() ? new Date(org.trialEndsAt) : new Date();
    set.trialEndsAt = new Date(base.getTime() + input.extendTrialDays * 86_400_000);
    if (input.status === undefined) set.subscriptionStatus = "trial";
  }
  if (input.currentPeriodEnd !== undefined) set.currentPeriodEnd = toDate(input.currentPeriodEnd);
  if (input.customPriceKes !== undefined) set.customPriceKes = input.customPriceKes === null ? null : String(input.customPriceKes);
  if (input.notes !== undefined) set.subscriptionNotes = input.notes;
  if (input.limits) {
    const next: Record<string, number | null> = { ...((org.limitOverrides as Record<string, number | null>) ?? {}) };
    for (const key of LIMIT_KEYS) {
      const s = input.limits[key];
      if (!s) continue;
      if (s.mode === "plan") delete next[key];
      else if (s.mode === "unlimited") next[key] = null;
      else next[key] = s.value;
    }
    set.limitOverrides = Object.keys(next).length ? next : null;
  }
  return { set };
}

async function describe(orgId: number) {
  const ent = await getEntitlements(orgId);
  if (!ent) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const usage = await getUsage(orgId);
  return {
    organizationId: orgId,
    name: org.name,
    plan: ent.planId,
    planName: ent.plan?.name ?? ent.planId,
    planInCatalogue: !!ent.plan,
    status: org.subscriptionStatus,
    expired: ent.expired,
    trialEndsAt: org.trialEndsAt,
    currentPeriodEnd: org.currentPeriodEnd,
    limits: ent.limits,
    limitSources: ent.sources,
    planLimits: ent.plan ? { maxProperties: ent.plan.maxProperties, maxUnits: ent.plan.maxUnits, maxUsers: ent.plan.maxUsers } : null,
    priceKes: ent.priceKes,
    planPriceKes: ent.plan?.priceKes ?? null,
    customPriceKes: ent.customPriceKes,
    notes: org.subscriptionNotes,
    usage,
  };
}

router.get("/organizations/:id/subscription", async (req: any, res: any) => {
  const orgId = parseInt(req.params.id, 10);
  if (!Number.isFinite(orgId)) return res.status(400).json({ message: "Invalid organisation" });
  try {
    const d = await describe(orgId);
    if (!d) return res.status(404).json({ message: "Organisation not found" });
    res.json(d);
  } catch (err) {
    console.error("[platform] get subscription:", err);
    res.status(500).json({ message: "Failed to load the subscription" });
  }
});

router.patch("/organizations/:id/subscription", auditLog("subscription", "UPDATE") as any, async (req: any, res: any) => {
  const orgId = parseInt(req.params.id, 10);
  if (!Number.isFinite(orgId)) return res.status(400).json({ message: "Invalid organisation" });
  const parsed = orgTermsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid details", errors: parsed.error.flatten().fieldErrors });
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Organisation not found" });
    const before = await describe(orgId);
    const { set, error } = await buildOrgUpdate(parsed.data, org as any);
    if (error) return res.status(400).json({ message: error });
    // moving to another plan: unless the admin says otherwise, the organisation follows the new plan's limits
    if (set.subscriptionPlan && set.subscriptionPlan !== org.subscriptionPlan && !parsed.data.limits) set.limitOverrides = null;
    if (Object.keys(set).length) {
      await db.update(organizations).set({ ...set, updatedAt: new Date() } as any).where(eq(organizations.id, orgId));
      await syncOrgLimitColumns([orgId]);
    }
    const after = await describe(orgId);
    res.locals.auditEntityId = orgId;
    res.locals.auditOldValues = before;
    res.locals.auditNewValues = after;
    res.json(after);
  } catch (err) {
    console.error("[platform] update subscription:", err);
    res.status(500).json({ message: "Failed to update the subscription" });
  }
});

// ── Many organisations ────────────────────────────────────────────────────────

const bulkSchema = z.object({
  // which organisations: everyone active, everyone on a plan, or a chosen list
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("plan"), planId: z.string().trim().min(1) }),
    z.object({ type: z.literal("organizations"), ids: z.array(z.number().int().positive()).min(1).max(1000) }),
  ]),
  apply: orgTermsSchema,
  dryRun: z.boolean().optional(),
});

router.post("/subscriptions/bulk", auditLog("subscription", "UPDATE") as any, async (req: any, res: any) => {
  const parsed = bulkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request", errors: parsed.error.flatten().fieldErrors });
  const { scope, apply, dryRun } = parsed.data;
  if (!Object.values(apply).some((v) => v !== undefined)) return res.status(400).json({ message: "Choose at least one thing to change." });
  if (apply.notes !== undefined) return res.status(400).json({ message: "Notes belong to one organisation — set them from that organisation." });
  if (apply.customPriceKes !== undefined && apply.customPriceKes !== null && scope.type === "all") {
    return res.status(400).json({ message: "A negotiated price applies to one organisation. To change a price for everyone, edit the plan." });
  }
  try {
    const active = sql`${organizations.isActive} IS DISTINCT FROM false`;
    const where = scope.type === "all" ? active
      : scope.type === "plan" ? and(active, eq(organizations.subscriptionPlan, scope.planId))
      : inArray(organizations.id, scope.ids);
    const orgs = await db.select().from(organizations).where(where);

    // Validate the plan once so a typo doesn't half-apply
    if (apply.plan !== undefined && !(await getPlan(apply.plan))) return res.status(400).json({ message: `There is no plan called "${apply.plan}".` });

    if (dryRun) return res.json({ dryRun: true, matched: orgs.length, organizations: orgs.slice(0, 50).map((o) => ({ id: o.id, name: o.name, plan: o.subscriptionPlan, status: o.subscriptionStatus })) });

    let updated = 0;
    for (const org of orgs) {
      const { set } = await buildOrgUpdate(apply, org as any);
      if (set.subscriptionPlan && set.subscriptionPlan !== org.subscriptionPlan && !apply.limits) set.limitOverrides = null;
      if (!Object.keys(set).length) continue;
      await db.update(organizations).set({ ...set, updatedAt: new Date() } as any).where(eq(organizations.id, org.id));
      updated++;
    }
    await syncOrgLimitColumns(orgs.map((o) => o.id));
    res.locals.auditEntityId = `bulk:${scope.type}`;
    res.locals.auditMeta = { scope, apply, matched: orgs.length, updated };
    res.json({ matched: orgs.length, updated });
  } catch (err) {
    console.error("[platform] bulk subscription:", err);
    res.status(500).json({ message: "Failed to update the organisations" });
  }
});

export default router;
