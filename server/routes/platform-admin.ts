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
 * Revenue definition: sum of rent payments + utility bills with
 * status = 'paid', by amount. This is the most complete measure available
 * across all payment methods (M-Pesa, bank transfer, cash) — every fully
 * settled payment gets marked 'paid' regardless of how it was collected.
 * 'partial' status rows are counted as $0 here, not estimated — the
 * paidAmount/balanceDue columns that would track partial amounts exist on
 * rent_payments but are never actually written by any code path (found
 * earlier this session), so there's nothing reliable to sum for those.
 * This means revenue is a slight undercount wherever partial payments
 * exist, never an overcount.
 */

import { Router } from "express";
import { db } from "../db";
import { organizations, properties, users, rentPayments, utilityBills, tenants } from "@shared/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";

const router = Router();
router.use(authenticateJWT as any);

function requirePlatformAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "platform_admin") {
    return res.status(403).json({ message: "Platform admin access required." });
  }
  next();
}
router.use(requirePlatformAdmin);

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
        isActive: organizations.isActive,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .orderBy(organizations.name);

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
      .groupBy(users.organizationId);

    // Rent revenue — all-time and for the selected month, by org (via tenantId -> tenants.organizationId)
    const rentAllTime = await db
      .select({ organizationId: tenants.organizationId, total: sql<number>`COALESCE(SUM(${rentPayments.amount}::numeric), 0)` })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(eq(rentPayments.status, "paid"))
      .groupBy(tenants.organizationId);

    const rentThisMonth = await db
      .select({ organizationId: tenants.organizationId, total: sql<number>`COALESCE(SUM(${rentPayments.amount}::numeric), 0)` })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(rentPayments.status, "paid"), gte(rentPayments.paidDate, monthStart), lt(rentPayments.paidDate, monthEnd)))
      .groupBy(tenants.organizationId);

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
    const rentAllTimeMap = new Map(rentAllTime.map(r => [r.organizationId, Number(r.total)]));
    const rentMonthMap = new Map(rentThisMonth.map(r => [r.organizationId, Number(r.total)]));
    const utilAllTimeMap = new Map(utilAllTime.map(r => [r.organizationId, Number(r.total)]));
    const utilMonthMap = new Map(utilThisMonth.map(r => [r.organizationId, Number(r.total)]));

    const result = orgs.map(o => ({
      ...o,
      propertyCount: propCountMap.get(o.id) ?? 0,
      userCount: userCountMap.get(o.id) ?? 0,
      revenueThisMonth: (rentMonthMap.get(o.id) ?? 0) + (utilMonthMap.get(o.id) ?? 0),
      revenueTotal: (rentAllTimeMap.get(o.id) ?? 0) + (utilAllTimeMap.get(o.id) ?? 0),
    }));

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

export default router;