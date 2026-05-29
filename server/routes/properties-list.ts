/**
 * properties-list.ts
 * Overrides the CRUD router's GET /api/properties with an enriched version
 * that joins units to return live totalUnits, occupiedUnits, vacantUnits,
 * and occupancyRate on every property row.
 *
 * This router MUST be mounted before propertyRouter in index.ts so Express
 * reaches this GET / handler first.
 */

import { Router } from "express";
import { db } from "../db";
import { properties, units } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();

router.get("/", authenticateJWT as any, requireOrg as any, async (req: any, res: any) => {
  try {
    // const orgId:  number = req.user.organizationId;
    const orgId: number = req.user.organizationId ?? req.session?.organizationId;
    const role:   string = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // 1. Fetch properties — landlords see only their own, everyone else sees all org properties
    const propCondition = role === "landlord"
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
      : eq(properties.organizationId, orgId);

    const results = await db.select().from(properties).where(propCondition);

    if (results.length === 0) return res.json([]);

    // 2. Fetch all units for this org's properties in one query (no N+1).
    //    Use inArray() — not sql`= ANY(array)` — so Drizzle binds the values
    //    correctly as a typed parameter list rather than a raw JS array literal.
    const propIds = results.map(p => p.id);
    const allUnits = await db
      .select({ propertyId: units.propertyId, isOccupied: units.isOccupied })
      .from(units)
      .where(
        and(
          eq(units.organizationId, orgId),
          inArray(units.propertyId, propIds),
        )
      );

    // 3. Count per property
    const countMap = new Map<number, { total: number; occupied: number }>();
    for (const u of allUnits) {
      const pid = u.propertyId!;
      if (!countMap.has(pid)) countMap.set(pid, { total: 0, occupied: 0 });
      const c = countMap.get(pid)!;
      c.total++;
      if (u.isOccupied) c.occupied++;
    }

    // 4. Return enriched array (same shape clients already expect)
    const enriched = results.map(p => {
      const c = countMap.get(p.id) ?? { total: 0, occupied: 0 };
      return {
        ...p,
        totalUnits:    c.total,
        occupiedUnits: c.occupied,
        vacantUnits:   c.total - c.occupied,
        occupancyRate: c.total > 0
          ? Math.round((c.occupied / c.total) * 1000) / 10
          : 0,
      };
    });

    return res.json(enriched);
  } catch (err) {
    console.error("Properties list error:", err);
    return res.status(500).json({ message: "Failed to fetch properties" });
  }
});

export default router;