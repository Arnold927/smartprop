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
 * GET /organizations             — every organisation, with property/user counts
 * GET /organizations/:id/properties — properties within one specific org
 */

import { Router } from "express";
import { db } from "../db";
import { organizations, properties, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
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

router.get("/organizations", async (_req: any, res: any) => {
  try {
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

    // Counts as separate grouped queries, merged in JS — avoids raw sql
    // template correlated subqueries (a fragile pattern that's hard to
    // verify without a live database to test against) and explicitly casts
    // to int, since Postgres COUNT(*) returns bigint, which node-postgres
    // serializes as a string by default.
    const propertyCounts = await db
      .select({ organizationId: properties.organizationId, count: sql<number>`count(*)::int` })
      .from(properties)
      .groupBy(properties.organizationId);

    const userCounts = await db
      .select({ organizationId: users.organizationId, count: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.organizationId);

    const propCountMap = new Map(propertyCounts.map(r => [r.organizationId, Number(r.count)]));
    const userCountMap = new Map(userCounts.map(r => [r.organizationId, Number(r.count)]));

    const result = orgs.map(o => ({
      ...o,
      propertyCount: propCountMap.get(o.id) ?? 0,
      userCount: userCountMap.get(o.id) ?? 0,
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