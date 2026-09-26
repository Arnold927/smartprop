/**
 * server/routes/maintenance-item-guard.ts
 *
 * Intercepts GET/PUT/PATCH/DELETE /api/maintenance-requests/:id — mounted
 * BEFORE maintenanceRouter (the generic createCRUDRouter instance) in
 * index.ts, so Express reaches this handler first.
 *
 * maintenance_requests has no organizationId column of its own. The generic
 * factory's org-scoping only applies `if (options.table.organizationId)`,
 * which is always false here — so its GET /:id, PUT /:id, PATCH /:id, and
 * DELETE /:id have had ZERO org-scoping the whole time: any authenticated
 * user, from any organization, could view/edit/delete any maintenance
 * request on the entire platform by guessing an id.
 *
 * This mirrors the scoping already correctly implemented for GET / (list) in
 * maintenance.ts's maintenanceListRouter — same org-via-units-join strategy,
 * same per-role narrowing (tenant/landlord/caretaker), applied here to the
 * single-record operations that were missing it.
 *
 * GET / and POST / are untouched (already handled by maintenanceListRouter).
 * /:id/feedback, /:id/approve, etc. are untouched (different, more specific
 * path patterns on maintenanceActionsRouter — no collision with plain /:id).
 */

import { Router } from "express";
import { db } from "../db";
import { maintenanceRequests, tenants, units, properties, pmAgreements, insertMaintenanceRequestSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

/** Resolve the maintenance request's org (via its unit) plus enough context
 *  to apply role-aware narrowing. Returns null if the request doesn't exist
 *  or doesn't belong to the caller's org.
 *  Exported for reuse by maintenance-actions.ts's action endpoints, which
 *  had the identical gap (zero org scoping) until this same check was
 *  applied there too. */
export async function resolveScopedRequest(id: number, orgId: number) {
  const [row] = await db
    .select({
      id: maintenanceRequests.id,
      tenantId: maintenanceRequests.tenantId,
      unitId: maintenanceRequests.unitId,
      unitOrgId: units.organizationId,
      propertyId: units.propertyId,
    })
    .from(maintenanceRequests)
    .innerJoin(units, eq(maintenanceRequests.unitId, units.id))
    .where(eq(maintenanceRequests.id, id))
    .limit(1);

  if (!row || row.unitOrgId !== orgId) return null;
  return row;
}

/** Returns true if this caller (given their role) is allowed to see/act on
 *  this specific request, beyond the basic org match already checked above. */
export async function callerCanAccess(row: NonNullable<Awaited<ReturnType<typeof resolveScopedRequest>>>, req: any): Promise<boolean> {
  const role: string = req.user.role ?? "";
  const userId: string = String(req.user.id ?? req.user.userId ?? "");

  if (role === "tenant") {
    const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, userId)).limit(1);
    return !!own && own.id === row.tenantId;
  }
  if (role === "landlord") {
    if (!row.propertyId) return false;
    const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, row.propertyId)).limit(1);
    return !!prop && prop.ownerId === userId;
  }
  if (role === "caretaker") {
    const caretaker = await storage.getCaretakerByUserId(userId);
    return !!caretaker?.propertyId && caretaker.propertyId === row.propertyId;
  }
  // admin, manager, staff — org match already confirmed, nothing further to check
  return true;
}

/** If this unit's property has a PM agreement with a maintenance approval
 *  threshold, and the given cost exceeds it, this request needs manager
 *  sign-off before work proceeds. Returns false (no gate) if there's no
 *  PM agreement at all — only properties with one actually have a
 *  threshold to check against.
 *  Exported for reuse by maintenance.ts's POST / (creation) path, which
 *  has the identical need to gate a request at the same threshold. */
export async function exceedsApprovalThreshold(unitId: number | null | undefined, estimatedCost: string | number | null | undefined): Promise<boolean> {
  if (unitId == null || estimatedCost == null || estimatedCost === "") return false;
  const cost = typeof estimatedCost === "string" ? parseFloat(estimatedCost) : estimatedCost;
  if (!Number.isFinite(cost)) return false;

  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId)).limit(1);
  if (!unit?.propertyId) return false;

  const [agreement] = await db
    .select({ threshold: pmAgreements.maintenanceApprovalThreshold })
    .from(pmAgreements)
    .where(and(eq(pmAgreements.propertyId, unit.propertyId), eq(pmAgreements.status, "active")))
    .limit(1);
  if (!agreement) return false;

  return cost > parseFloat(agreement.threshold ?? "0");
}

router.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const row = await resolveScopedRequest(id, req.user.organizationId);
    if (!row || !(await callerCanAccess(row, req))) {
      return res.status(404).json({ message: "Not found" });
    }
    const [full] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
    res.json(full);
  } catch (err) {
    console.error("[maintenance-item-guard] GET /:id:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function handleUpdate(req: any, res: any) {
  try {
    const role: string = req.user.role ?? "";
    // No legitimate tenant-facing use case for the generic update — tenants
    // submit (POST /) and leave feedback (PATCH /:id/feedback) only.
    if (role === "tenant") {
      return res.status(403).json({ message: "Not permitted." });
    }

    const id = parseInt(req.params.id);
    const row = await resolveScopedRequest(id, req.user.organizationId);
    if (!row || !(await callerCanAccess(row, req))) {
      return res.status(404).json({ message: "Not found" });
    }

    const validated = insertMaintenanceRequestSchema.partial().parse(req.body);

    // If this update sets/changes the estimated cost past the property's PM
    // agreement threshold, gate it for approval — but only if the request
    // is still in its initial "pending" state (don't yank something already
    // assigned/in-progress back into approval limbo) and the caller isn't
    // already explicitly setting some other status themselves.
    const currentRow = await db.select({ status: maintenanceRequests.status, unitId: maintenanceRequests.unitId }).from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
    const wasPending = currentRow[0]?.status === "pending";
    if (wasPending && validated.estimatedCost !== undefined && validated.status === undefined) {
      const needsApproval = await exceedsApprovalThreshold(validated.unitId ?? currentRow[0]?.unitId, validated.estimatedCost);
      if (needsApproval) {
        (validated as any).status = "pending_approval";
      }
    }

    const [updated] = await db
      .update(maintenanceRequests)
      .set(validated as any)
      .where(eq(maintenanceRequests.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[maintenance-item-guard] update:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

router.put("/:id", handleUpdate);
router.patch("/:id", handleUpdate);

router.delete("/:id", async (req: any, res: any) => {
  try {
    const role: string = req.user.role ?? "";
    if (role === "tenant") {
      return res.status(403).json({ message: "Not permitted." });
    }

    const id = parseInt(req.params.id);
    const row = await resolveScopedRequest(id, req.user.organizationId);
    if (!row || !(await callerCanAccess(row, req))) {
      return res.status(404).json({ message: "Not found" });
    }

    await db.delete(maintenanceRequests).where(eq(maintenanceRequests.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("[maintenance-item-guard] DELETE /:id:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;