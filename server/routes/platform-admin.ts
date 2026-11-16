/**
 * server/routes/platform-admin.ts
 *
 * Routes for the platform_admin role — the one role in this app that is
 * deliberately NOT scoped to a single organisation (see requireOrg.ts and
 * requireRole.ts's roleGuard, which both special-case this role). Everyone
 * else's "admin" is still scoped to their own organisation, unchanged.
 *
 * Mounted at /api/platform — no ROUTE_POLICY entry exists for this prefix,
 * which means every role except platform_admin gets the fail-closed 403
 * automatically. platform_admin bypasses that check in roleGuard, so this
 * file only needs its own internal check as a second layer of defense.
 *
 * GET /organizations             — every organisation, with property/user
 *                                   counts and revenue figures
 * GET /organizations/:id/properties — properties within one specific org
 *
 * Revenue definition: rent CASH RECEIVED (receipts by payment date, so part
 * payments count when they are paid — see services/rent-ledger.ts) plus utility
 * bills with status = 'paid', by amount. Settled payments are counted however
 * they were collected (M-Pesa, bank transfer, cash).
 */

import { Router } from "express";
import { db } from "../db";
import { organizations, organizationSettings, properties, users, rentPayments, utilityBills, tenants, units } from "@shared/schema";
import { revokeAllUserTokens } from "./auth";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { countsTowardUserLimit } from "../middleware/billing";
import { z } from "zod";
import { getPlan, listPlans, resolveLimits, syncOrgLimitColumns, getEntitlements } from "../services/plans";
import subscriptionsRouter from "./platform-subscriptions";
import { rentReceivedByOrg } from "../services/rent-ledger";
import { issueInvite, deliverInvite, InviteConflictError } from "../utils/invites";

const router = Router();
router.use(authenticateJWT as any);

function requirePlatformAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "platform_admin") {
    return res.status(403).json({ message: "Platform admin access required." });
  }
  next();
}
router.use(requirePlatformAdmin);
router.use(subscriptionsRouter);

/** First day of the current calendar month, as a YYYY-MM-DD string. */
/** Returns the [start, end) bounds for a given month, defaulting to the
 *  current month if no param is given. Accepts "YYYY-MM" (e.g. "2026-06").
 *  Bounded on both ends (not just gte) so this works correctly for past
 *  months too, not just "from the 1st of this month to now". */
function monthRange(monthParam?: string): { start: string; end: string } {
  let year: number, month: number; // month is 0-indexed for Date, but we take 1-indexed input
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y; month = m - 1;
  } else {
    const now = new Date();
    year = now.getFullYear(); month = now.getMonth();
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

router.get("/organizations", async (req: any, res: any) => {
  try {
    // ?month=YYYY-MM lets the caller view revenue for any specific month,
    // not just the current one. Defaults to the current month if omitted.
    const { start: monthStart, end: monthEnd } = monthRange(req.query.month as string | undefined);

    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        subscriptionPlan: organizations.subscriptionPlan,
        subscriptionStatus: organizations.subscriptionStatus,
        maxProperties: organizations.maxProperties,
        maxUsers: organizations.maxUsers,
        limitOverrides: organizations.limitOverrides,
        trialEndsAt: organizations.trialEndsAt,
        currentPeriodEnd: organizations.currentPeriodEnd,
        isActive: organizations.isActive,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .orderBy(organizations.name);
    const planById = new Map((await listPlans({ includeInactive: true })).map((p) => [p.id, p]));
    const unitCounts = await db
      .select({ organizationId: units.organizationId, count: sql<number>`count(*)::int` })
      .from(units)
      .groupBy(units.organizationId);
    const unitCountMap = new Map(unitCounts.map((r) => [r.organizationId, Number(r.count)]));

    // Counts and revenue as separate grouped queries, merged in JS — avoids
    // raw sql template correlated subqueries (a fragile pattern that's hard
    // to verify without a live database to test against) and explicitly
    // casts numeric results, since Postgres COUNT(*)/DECIMAL both commonly
    // come back as strings from node-postgres rather than JS numbers.
    const propertyCounts = await db
      .select({ organizationId: properties.organizationId, count: sql<number>`count(*)::int` })
      .from(properties)
      .groupBy(properties.organizationId);

    const userCounts = await db
      .select({ organizationId: users.organizationId, count: sql<number>`count(*)::int` })
      .from(users)
      .where(countsTowardUserLimit)   // same rule the plan limit enforces: team seats, not tenant/contractor logins
      .groupBy(users.organizationId);

    // Rent revenue = cash received (receipts by payment date), all-time and for the selected month, by org.
    // Part payments count as they are paid; legacy invoices settled before receipts existed count at paid date.
    const monthFrom = String(monthStart).slice(0, 10);
    const monthTo   = new Date(new Date(monthEnd).getTime() - 86_400_000).toISOString().slice(0, 10); // monthEnd is exclusive
    const rentAllTimeMap = await rentReceivedByOrg("1900-01-01", "2999-12-31");
    const rentMonthMap   = await rentReceivedByOrg(monthFrom, monthTo);

    // Utility revenue — same shape. utilityBills.amount is a varchar column
    // (not numeric), so the ::numeric cast here isn't just defensive, it's
    // required for SUM() to work on it at all.
    const utilAllTime = await db
      .select({ organizationId: tenants.organizationId, total: sql<number>`COALESCE(SUM(${utilityBills.amount}::numeric), 0)` })
      .from(utilityBills)
      .innerJoin(tenants, eq(utilityBills.tenantId, tenants.id))
      .where(eq(utilityBills.status, "paid"))
      .groupBy(tenants.organizationId);

    const utilThisMonth = await db
      .select({ organizationId: tenants.organizationId, total: sql<number>`COALESCE(SUM(${utilityBills.amount}::numeric), 0)` })
      .from(utilityBills)
      .innerJoin(tenants, eq(utilityBills.tenantId, tenants.id))
      .where(and(eq(utilityBills.status, "paid"), gte(utilityBills.paidDate, new Date(monthStart)), lt(utilityBills.paidDate, new Date(monthEnd))))
      .groupBy(tenants.organizationId);

    const propCountMap = new Map(propertyCounts.map(r => [r.organizationId, Number(r.count)]));
    const userCountMap = new Map(userCounts.map(r => [r.organizationId, Number(r.count)]));
    const utilAllTimeMap = new Map(utilAllTime.map(r => [r.organizationId, Number(r.total)]));
    const utilMonthMap = new Map(utilThisMonth.map(r => [r.organizationId, Number(r.total)]));

    const result = orgs.map(({ limitOverrides, ...o }) => {
      // the limits the organisation is actually held to (plan, or the admin's override), null = unlimited
      const { limits, sources } = resolveLimits({ limitOverrides, maxProperties: o.maxProperties, maxUsers: o.maxUsers }, planById.get(o.subscriptionPlan ?? "") ?? null);
      return {
      ...o,
      maxProperties: limits.maxProperties,
      maxUsers: limits.maxUsers,
      maxUnits: limits.maxUnits,
      hasCustomTerms: Object.values(sources).includes("override"),
      unitCount: unitCountMap.get(o.id) ?? 0,
      propertyCount: propCountMap.get(o.id) ?? 0,
      userCount: userCountMap.get(o.id) ?? 0,
      revenueThisMonth: (rentMonthMap.get(o.id) ?? 0) + (utilMonthMap.get(o.id) ?? 0),
      revenueTotal: (rentAllTimeMap.get(o.id) ?? 0) + (utilAllTimeMap.get(o.id) ?? 0),
    };});

    res.json(result);
  } catch (err: any) {
    console.error("[platform-admin] GET /organizations:", err);
    res.status(500).json({ message: "Failed to fetch organisations", detail: err?.message ?? String(err) });
  }
});

router.get("/organizations/:id/properties", async (req: any, res: any) => {
  try {
    const orgId = parseInt(req.params.id);
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const propertyRows = await db
      .select()
      .from(properties)
      .where(eq(properties.organizationId, orgId))
      .orderBy(properties.name);

    res.json({ organization: org, properties: propertyRows });
  } catch (err: any) {
    console.error("[platform-admin] GET /organizations/:id/properties:", err);
    res.status(500).json({ message: "Failed to fetch properties", detail: err?.message ?? String(err) });
  }
});

// ── GET /search — find anything across every organisation ────────────────────
// The actual point of this feature: a platform_admin fielding a support
// request ("tenant X can't log in", "property Y's payments look wrong")
// previously had no way to find them without opening every org one at a
// time. Every result includes which org it belongs to, since that's the
// one piece of context platform_admin doesn't already have.
router.get("/search", async (req: any, res: any) => {
  try {
    const q = (req.query.q as string ?? "").trim();
    if (q.length < 2) return res.json({ properties: [], tenants: [], users: [], organizations: [] });

    const like = `%${q}%`;
    const orgRows = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
    const orgNameMap = new Map(orgRows.map(o => [o.id, o.name]));

    const [propertyRows, tenantRows, userRows, matchedOrgs] = await Promise.all([
      db.select({ id: properties.id, name: properties.name, address: properties.address, organizationId: properties.organizationId })
        .from(properties)
        .where(sql`${properties.name} ILIKE ${like} OR ${properties.address} ILIKE ${like}`)
        .limit(10),

      db.select({ id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email, phone: tenants.phone, organizationId: tenants.organizationId, propertyId: units.propertyId })
        .from(tenants)
        .leftJoin(units, eq(tenants.unitId, units.id))
        .where(sql`${tenants.firstName} ILIKE ${like} OR ${tenants.lastName} ILIKE ${like} OR ${tenants.email} ILIKE ${like} OR ${tenants.phone} ILIKE ${like}`)
        .limit(10),

      db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role, organizationId: users.organizationId })
        .from(users)
        .where(sql`${users.firstName} ILIKE ${like} OR ${users.lastName} ILIKE ${like} OR ${users.email} ILIKE ${like}`)
        .limit(10),

      db.select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(sql`${organizations.name} ILIKE ${like}`)
        .limit(5),
    ]);

    res.json({
      properties: propertyRows.map(p => ({ ...p, organizationName: orgNameMap.get(p.organizationId) ?? "Unknown org" })),
      tenants: tenantRows.map(t => ({ ...t, organizationName: orgNameMap.get(t.organizationId) ?? "Unknown org" })),
      users: userRows.map(u => ({ ...u, organizationName: u.organizationId ? (orgNameMap.get(u.organizationId) ?? "Unknown org") : "Platform-wide" })),
      organizations: matchedOrgs,
    });
  } catch (err: any) {
    console.error("[platform-admin] GET /search:", err);
    res.status(500).json({ message: "Search failed", detail: err?.message ?? String(err) });
  }
});

// ── Adding an organisation (a property manager OR a landlord who runs their own properties) ──────
//
// Public sign-up closes once the first organisation exists, so this is how every new customer
// comes onto the platform. The first person is the organisation's ADMIN: for a self-managing
// landlord that is what makes the full toolset available (tenants, leases, caretakers, staff,
// contractors, work orders, rent collection) — the "landlord" role is the owner's read-mostly view
// inside somebody else's organisation. They get a set-password invite link (emailed when email
// is configured, always returned so it can be shared on WhatsApp).

const newOrgSchema = z
  .object({
    organizationName: z.string().trim().max(255).optional().default(""),
    accountType: z.enum(["landlord", "property_manager"]).default("landlord"),
    email: z.string().trim().toLowerCase().email("A valid email is required"),
    firstName: z.string().trim().max(100).optional().default(""),
    lastName: z.string().trim().max(100).optional().default(""),
    plan: z.string().trim().min(1).max(50).default("starter"),
    /** Put the new landlord under an existing property-management organisation instead of giving them a workspace of their own. */
    linkToOrganizationId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.linkToOrganizationId || v.organizationName.length >= 2, {
    message: "Organisation or landlord name is required",
    path: ["organizationName"],
  });

async function uniqueSlug(base: string, ex: any): Promise<string> {
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "org";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await ex.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate)).limit(1);
    if (!hit) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function inviteIntro(orgName: string) {
  return `SmartProp has set up ${orgName} for you. Create your password to start adding your properties and tenants.`;
}

router.post("/organizations", async (req: any, res: any) => {
  const parsed = newOrgSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid details", errors: parsed.error.flatten().fieldErrors });
  }
  const { organizationName, accountType, email, firstName, lastName, plan: planId, linkToOrganizationId } = parsed.data;
  const plan = (await getPlan(planId)) ?? (await listPlans())[0] ?? null;
  if (!plan) return res.status(400).json({ message: "There are no plans set up yet. Create one under Plans first." });

  try {
    // Sign-in looks accounts up by email alone, so one email can only belong to one organisation.
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken) {
      return res.status(409).json({
        message: `${email} already has an account on the platform. To put an existing landlord under a property manager, use "Link existing landlord" on that organisation.`,
      });
    }

    // A landlord who works under a property-management company: no new organisation — they join
    // that company's as a landlord (read-mostly owner view); the company links their properties.
    if (linkToOrganizationId) {
      const [target] = await db
        .select({ id: organizations.id, name: organizations.name, isActive: organizations.isActive })
        .from(organizations)
        .where(eq(organizations.id, linkToOrganizationId))
        .limit(1);
      if (!target || target.isActive === false) return res.status(404).json({ message: "That organisation was not found." });
      const invite = await issueInvite({
        organizationId: target.id,
        invitedByUserId: req.user.id,
        email,
        role: "landlord",
        firstName: firstName || null,
        lastName: lastName || null,
      });
      const emailSent = invite.link
        ? await deliverInvite({
            to: email,
            link: invite.link,
            intro: `${target.name} manages your properties on SmartProp. Create your password to see your properties, tenants and rent.`,
          })
        : false;
      return res.status(201).json({
        organization: target,
        linkedTo: target.name,
        invite: { status: invite.status, link: invite.link, emailSent },
      });
    }

    const created = await db.transaction(async (tx) => {
      const slug = await uniqueSlug(organizationName, tx);
      const [org] = await tx
        .insert(organizations)
        .values({
          name: organizationName,
          slug,
          subscriptionPlan: plan.id,
          subscriptionStatus: "trial",
          // a plan with trial days gives a fixed trial; otherwise the trial has no end date until the admin sets one
          trialEndsAt: plan.trialDays ? new Date(Date.now() + plan.trialDays * 86_400_000) : null,
          maxProperties: plan.maxProperties ?? 9999,
          maxUsers: plan.maxUsers ?? 9999,
          features: { accountType },
        } as any)
        .returning();
      await tx.insert(organizationSettings).values({ organizationId: org.id } as any);
      const invite = await issueInvite({
        organizationId: org.id,
        invitedByUserId: req.user.id,
        email,
        role: "admin",
        firstName: firstName || null,
        lastName: lastName || null,
        executor: tx as any,
      });
      await tx.update(users).set({ isOrgAdmin: true } as any).where(eq(users.id, invite.userId));
      return { org, invite };
    });

    const emailSent = created.invite.link
      ? await deliverInvite({ to: email, link: created.invite.link, intro: inviteIntro(created.org.name) })
      : false;

    res.status(201).json({
      organization: created.org,
      invite: { status: created.invite.status, link: created.invite.link, emailSent },
    });
  } catch (err: any) {
    if (err instanceof InviteConflictError) return res.status(409).json({ message: err.message });
    console.error("[platform] create organisation failed:", err);
    res.status(500).json({ message: "Failed to create the organisation" });
  }
});

// (Re)issue the set-password link for an organisation's admin — lost link, expired link, or an
// additional admin for the organisation. A person who already has a working account is left alone.
router.post("/organizations/:id/admin-invite", async (req: any, res: any) => {
  const orgId = parseInt(req.params.id, 10);
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("A valid email is required"),
      firstName: z.string().trim().max(100).optional().default(""),
      lastName: z.string().trim().max(100).optional().default(""),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid details" });
  const { email, firstName, lastName } = parsed.data;

  try {
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const [elsewhere] = await db.select({ id: users.id, organizationId: users.organizationId }).from(users).where(eq(users.email, email)).limit(1);
    if (elsewhere && elsewhere.organizationId !== orgId) {
      return res.status(409).json({ message: `${email} already has an account in a different organisation.` });
    }

    const invite = await issueInvite({
      organizationId: orgId,
      invitedByUserId: req.user.id,
      email,
      role: "admin",
      firstName: firstName || null,
      lastName: lastName || null,
    });
    if (invite.status !== "active") {
      await db.update(users).set({ isOrgAdmin: true } as any).where(eq(users.id, invite.userId));
    }
    const emailSent = invite.link ? await deliverInvite({ to: email, link: invite.link, intro: inviteIntro(org.name) }) : false;
    res.json({ invite: { status: invite.status, link: invite.link, emailSent } });
  } catch (err: any) {
    if (err instanceof InviteConflictError) return res.status(409).json({ message: err.message });
    console.error("[platform] admin invite failed:", err);
    res.status(500).json({ message: "Failed to create the invite" });
  }
});

// ── Link an EXISTING landlord (one who has an account but no properties yet) to a property manager ──
//
// A landlord set up on their own, or one who signed up before choosing a manager, can be moved under
// a property-management organisation. Only a landlord with nothing in their current workspace can be
// moved this way (no properties, units, tenants or other people) — moving real data between
// organisations is not something to do automatically. Their old, empty workspace is switched off,
// their sessions are ended so they sign in again into the new organisation, and the manager can then
// pick them as the owner when adding or editing a property.
router.post("/organizations/:id/link-landlord", async (req: any, res: any) => {
  const targetId = parseInt(req.params.id, 10);
  const parsed = z.object({ email: z.string().trim().toLowerCase().email("A valid email is required") }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid details" });
  const { email } = parsed.data;

  try {
    const [target] = await db
      .select({ id: organizations.id, name: organizations.name, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.id, targetId))
      .limit(1);
    if (!target || target.isActive === false) return res.status(404).json({ message: "Organisation not found" });

    const [person] = await db
      .select({ id: users.id, role: users.role, organizationId: users.organizationId, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!person) return res.status(404).json({ message: `There is no account for ${email}. Use "Add landlord / organisation" and choose the property manager instead.` });
    if (person.organizationId === targetId) return res.status(409).json({ message: "They are already part of this organisation." });
    if (!["landlord", "admin"].includes(person.role ?? "")) {
      return res.status(409).json({ message: `${email} is a ${person.role} account, not a landlord, so it can't be linked here.` });
    }
    const fromId = person.organizationId;
    if (!fromId) return res.status(409).json({ message: "That account has no organisation to move from." });

    const count = async (table: any, col: any) => {
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(table).where(eq(col, fromId));
      return Number(n ?? 0);
    };
    const [props, unitCount, tenantCount] = await Promise.all([
      count(properties, properties.organizationId),
      count(units, units.organizationId),
      count(tenants, tenants.organizationId),
    ]);
    const [{ others }] = await db
      .select({ others: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.organizationId, fromId), sql`${users.id} <> ${person.id}`));
    const blockers: string[] = [];
    if (props) blockers.push(`${props} propert${props === 1 ? "y" : "ies"}`);
    if (unitCount) blockers.push(`${unitCount} unit${unitCount === 1 ? "" : "s"}`);
    if (tenantCount) blockers.push(`${tenantCount} tenant${tenantCount === 1 ? "" : "s"}`);
    if (Number(others)) blockers.push(`${others} other user${Number(others) === 1 ? "" : "s"}`);
    if (blockers.length) {
      return res.status(409).json({
        message: `Their current workspace still has ${blockers.join(", ")}, so they can't be moved automatically. Only a landlord with no properties yet can be linked.`,
      });
    }

    const [from] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, fromId)).limit(1);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ organizationId: targetId, role: "landlord", isOrgAdmin: false, updatedAt: new Date() } as any)
        .where(eq(users.id, person.id));
      await tx.update(organizations).set({ isActive: false, updatedAt: new Date() } as any).where(eq(organizations.id, fromId));
    });
    await revokeAllUserTokens(person.id); // they sign in again, into the new organisation

    res.json({
      success: true,
      landlord: { id: person.id, email, name: `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || email },
      organization: { id: target.id, name: target.name },
      previousOrganization: from ?? null,
    });
  } catch (err) {
    console.error("[platform] link landlord failed:", err);
    res.status(500).json({ message: "Failed to link the landlord" });
  }
});

export default router;
