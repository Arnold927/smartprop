/**
 * server/routes/unit-vacancy-guard.ts
 *
 * Intercepts PATCH /api/units/:id — mounted BEFORE unitRouter (the generic
 * createCRUDRouter instance) in index.ts, so Express reaches this handler
 * first. unitRouter's own PATCH /:id has no ownership check at all beyond
 * organizationId, meaning a landlord could previously mark ANY unit in the
 * org vacant/occupied, not just units in properties they own. It also had no
 * concept of an occupied unit still having an active tenant record — you
 * could mark a unit vacant while a fully active tenant remained linked to it,
 * with no warning.
 *
 * This router closes both gaps for the PATCH method specifically. GET, POST,
 * PUT, and DELETE on /api/units are untouched and continue to fall through to
 * unitRouter exactly as before (this router only registers .patch()).
 */

import { Router } from "express";
import { db } from "../db";
import { units, properties, tenants, insertUnitSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();

router.patch("/:id", authenticateJWT as any, requireOrg as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";
    const userId: string = req.user.id;
    const unitId = parseInt(req.params.id);

    const [row] = await db
      .select({ propertyOrgId: properties.organizationId, ownerId: properties.ownerId })
      .from(units)
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(units.id, unitId))
      .limit(1);

    if (!row || row.propertyOrgId !== orgId) {
      return res.status(404).json({ message: "Unit not found" });
    }

    // Landlords may only manage units in properties they own — same rule used
    // everywhere else a landlord touches property-scoped data (see
    // properties-list.ts, tenant-onboarding.ts, tenants.ts, leases.ts).
    if (role === "landlord" && row.ownerId !== userId) {
      return res.status(403).json({ message: "You can only manage units in properties you own." });
    }

    // Marking a unit vacant while it still has an active tenant would silently
    // orphan that tenant's record (their status, login, and unit link would
    // all stay untouched — see the /api/leases/:id/terminate cascade for what
    // ending a tenancy is actually supposed to do). Route people through that
    // flow instead of letting this shortcut skip it.
    if (req.body?.isOccupied === false) {
      const [activeTenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.unitId, unitId), eq(tenants.status, "active")))
        .limit(1);

      if (activeTenant) {
        return res.status(409).json({
          message: "This unit still has an active tenant. End their tenancy from the Leases page (Terminate) before marking the unit vacant.",
        });
      }
    }

    const validated = insertUnitSchema.partial().parse(req.body);

    const [updated] = await db
      .update(units)
      .set(validated as any)
      .where(eq(units.id, unitId))
      .returning();

    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ errors: err.errors });
    }
    console.error("[unit-vacancy-guard] PATCH /:id error:", err);
    res.status(500).json({ message: "Failed to update unit" });
  }
});

export default router;