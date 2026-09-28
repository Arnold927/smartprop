/**
 * tenant-inspections.ts — mounted at /api/tenant-inspections  (tenant role only)
 *
 * The tenant's side of a property condition inspection:
 *
 *   GET  /api/tenant-inspections            the signed-off inspections on the tenant's own tenancy
 *   POST /api/tenant-inspections/:id/sign   the tenant countersigns one of them
 *
 * Why this is a separate route file: /api/inspections is a staff-side prefix and tenants are
 * (correctly) refused there. Tenant signing previously lived under it and so could never be
 * reached, which meant no inspection could ever become "completed".
 *
 * A tenant only ever sees inspections that are linked to their own tenant record AND that the
 * manager has already signed — a draft or half-finished report is not something to countersign.
 */

import { Router } from "express";
import { db }     from "../db";
import { propertyInspections, properties, units, tenants } from "@shared/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

/** Resolve the calling user's tenant record (org-scoped). */
async function myTenantId(userId: string, orgId: number): Promise<number | null> {
  const [t] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, orgId)))
    .limit(1);
  return t?.id ?? null;
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role !== "tenant") return res.status(403).json({ message: "Tenants only" });

    const tenantId = await myTenantId(req.user.id, req.user.organizationId);
    if (!tenantId) return res.json([]);

    const rows = await db
      .select({
        id:                   propertyInspections.id,
        inspectionNumber:     propertyInspections.inspectionNumber,
        inspectionType:       propertyInspections.inspectionType,
        conductedDate:        propertyInspections.conductedDate,
        overallCondition:     propertyInspections.overallCondition,
        rooms:                propertyInspections.rooms,
        notes:                propertyInspections.notes,
        electricityReading:   propertyInspections.electricityReading,
        waterReading:         propertyInspections.waterReading,
        status:               propertyInspections.status,
        managerSignedAt:      propertyInspections.managerSignedAt,
        managerSignatureName: propertyInspections.managerSignatureName,
        tenantSignedAt:       propertyInspections.tenantSignedAt,
        tenantSignatureName:  propertyInspections.tenantSignatureName,
        propertyName:         properties.name,
        unitNumber:           units.unitNumber,
      })
      .from(propertyInspections)
      .leftJoin(properties, eq(propertyInspections.propertyId, properties.id))
      .leftJoin(units,      eq(propertyInspections.unitId,     units.id))
      .where(and(
        eq(propertyInspections.organizationId, req.user.organizationId),
        eq(propertyInspections.tenantId,       tenantId),
        isNotNull(propertyInspections.managerSignedAt),
      ))
      .orderBy(desc(propertyInspections.conductedDate), desc(propertyInspections.createdAt));

    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ─── SIGN ─────────────────────────────────────────────────────────────────────

router.post("/:id/sign", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role !== "tenant") return res.status(403).json({ message: "Only the tenant can countersign" });

    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid inspection id" });

    const name = String(req.body.signatoryName ?? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`).trim().slice(0, 100);
    if (!name) return res.status(400).json({ message: "Please type your full name to sign" });

    const tenantId = await myTenantId(req.user.id, req.user.organizationId);
    if (!tenantId) return res.status(404).json({ message: "Inspection not found" });

    const [insp] = await db
      .select({
        id: propertyInspections.id,
        tenantId: propertyInspections.tenantId,
        managerSignedAt: propertyInspections.managerSignedAt,
        tenantSignedAt: propertyInspections.tenantSignedAt,
      })
      .from(propertyInspections)
      .where(and(eq(propertyInspections.id, id), eq(propertyInspections.organizationId, req.user.organizationId)))
      .limit(1);

    // Someone else's inspection looks exactly like a missing one — no information leak.
    if (!insp || insp.tenantId !== tenantId) return res.status(404).json({ message: "Inspection not found" });

    if (!insp.managerSignedAt) return res.status(409).json({ message: "This inspection has not been signed off by the manager yet" });
    if (insp.tenantSignedAt)   return res.status(409).json({ message: "You have already signed this inspection" });

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";

    const [updated] = await db
      .update(propertyInspections)
      .set({
        tenantSignedAt:      new Date(),
        tenantSignatureIp:   ip,
        tenantSignatureName: name,
        status:              "completed",   // manager has signed (checked above) and now so has the tenant
        updatedAt:           new Date(),
      })
      .where(eq(propertyInspections.id, insp.id))
      .returning();

    res.json({ id: updated.id, status: updated.status, tenantSignedAt: updated.tenantSignedAt, tenantSignatureName: updated.tenantSignatureName });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

export default router;