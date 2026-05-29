/**
 * inspections.ts — mounted at /api/inspections
 *
 * Property condition inspections for move-in, move-out, periodic, and pre-letting.
 *
 *   GET    /api/inspections                    list (filterable by unitId, leaseId, type)
 *   GET    /api/inspections/:id                single
 *   POST   /api/inspections                    create (draft)
 *   PATCH  /api/inspections/:id                update rooms/issues/notes
 *   POST   /api/inspections/:id/sign-manager   manager signs
 *   POST   /api/inspections/:id/sign-tenant    tenant signs (can be called from tenant portal)
 *   POST   /api/inspections/:id/complete       mark complete
 *   GET    /api/inspections/:id/diff           diff against previous inspection (for move-out)
 */

import { Router }    from "express";
import { db }        from "../db";
import {
  propertyInspections, properties, units, tenants, leases, users,
} from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function nextInspectionNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ max: (propertyInspections as any).inspectionNumber })
    .from(propertyInspections)
    .orderBy(desc(propertyInspections.inspectionNumber))
    .limit(1);
  // Extract numeric suffix from last number like INS-2025-042
  const last = parseInt((row?.max ?? "INS-0000-000").split("-").pop() ?? "0") || 0;
  return `INS-${year}-${String(last + 1).padStart(3, "0")}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════════

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId          = req.user.organizationId;
    const unitId         = req.query.unitId   ? parseInt(req.query.unitId   as string) : null;
    const leaseId        = req.query.leaseId  ? parseInt(req.query.leaseId  as string) : null;
    const propertyId     = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const type           = req.query.type     as string | null;

    const conditions: any[] = [eq(propertyInspections.organizationId, orgId)];
    if (unitId)     conditions.push(eq(propertyInspections.unitId,     unitId));
    if (leaseId)    conditions.push(eq(propertyInspections.leaseId,    leaseId));
    if (propertyId) conditions.push(eq(propertyInspections.propertyId, propertyId));
    if (type)       conditions.push(eq(propertyInspections.inspectionType, type));

    const rows = await db
      .select({
        id:               propertyInspections.id,
        inspectionNumber: propertyInspections.inspectionNumber,
        inspectionType:   propertyInspections.inspectionType,
        propertyId:       propertyInspections.propertyId,
        unitId:           propertyInspections.unitId,
        leaseId:          propertyInspections.leaseId,
        tenantId:         propertyInspections.tenantId,
        scheduledDate:    propertyInspections.scheduledDate,
        conductedDate:    propertyInspections.conductedDate,
        overallCondition: propertyInspections.overallCondition,
        totalIssuesCost:  propertyInspections.totalIssuesCost,
        recommendedDeduction: propertyInspections.recommendedDeduction,
        status:           propertyInspections.status,
        tenantSignedAt:   propertyInspections.tenantSignedAt,
        managerSignedAt:  propertyInspections.managerSignedAt,
        createdAt:        propertyInspections.createdAt,
        // Joins
        propertyName:     properties.name,
        unitNumber:       units.unitNumber,
        tenantFirstName:  tenants.firstName,
        tenantLastName:   tenants.lastName,
      })
      .from(propertyInspections)
      .leftJoin(properties, eq(propertyInspections.propertyId, properties.id))
      .leftJoin(units,      eq(propertyInspections.unitId,     units.id))
      .leftJoin(tenants,    eq(propertyInspections.tenantId,   tenants.id))
      .where(and(...conditions))
      .orderBy(desc(propertyInspections.conductedDate), desc(propertyInspections.createdAt));

    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET SINGLE
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const [row] = await db
      .select()
      .from(propertyInspections)
      .where(and(
        eq(propertyInspections.id,             parseInt(req.params.id)),
        eq(propertyInspections.organizationId, req.user.organizationId),
      ))
      .limit(1);
    if (!row) return res.status(404).json({ message: "Inspection not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════════════

router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const {
      propertyId, unitId, leaseId, tenantId,
      inspectionType, scheduledDate, rooms, notes,
    } = req.body;

    if (!propertyId || !inspectionType) {
      return res.status(400).json({ message: "propertyId and inspectionType are required" });
    }

    // Verify property belongs to org
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);
    if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });

    // If move-out, find the most recent move-in inspection for this unit to link
    let previousInspectionId: number | null = null;
    if (inspectionType === "move_out" && unitId) {
      const [prev] = await db
        .select({ id: propertyInspections.id })
        .from(propertyInspections)
        .where(and(
          eq(propertyInspections.unitId, unitId),
          eq(propertyInspections.inspectionType, "move_in"),
          eq(propertyInspections.status, "completed"),
        ))
        .orderBy(desc(propertyInspections.conductedDate))
        .limit(1);
      previousInspectionId = prev?.id ?? null;
    }

    const inspectionNumber = await nextInspectionNumber();

    const [created] = await db.insert(propertyInspections).values({
      organizationId:      orgId,
      propertyId,
      unitId:              unitId      ?? null,
      leaseId:             leaseId     ?? null,
      tenantId:            tenantId    ?? null,
      inspectionNumber,
      inspectionType,
      scheduledDate:       scheduledDate ?? null,
      conductedBy:         req.user.id,
      rooms:               rooms ?? [],
      issuesFound:         [],
      previousInspectionId,
      status:              "draft",
      notes:               notes ?? null,
    } as any).returning();

    res.status(201).json(created);
  } catch (err: any) {
    console.error("create inspection error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE (rooms, issues, overall condition, meter readings, notes)
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const allowed = [
      "rooms", "issuesFound", "overallCondition", "totalIssuesCost",
      "electricityReading", "waterReading", "conductedDate",
      "recommendedDeduction", "deductionNotes", "notes", "status",
    ];
    const patch: any = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const [updated] = await db
      .update(propertyInspections)
      .set(patch)
      .where(and(
        eq(propertyInspections.id, parseInt(req.params.id)),
        eq(propertyInspections.organizationId, orgId),
      ))
      .returning();

    if (!updated) return res.status(404).json({ message: "Inspection not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SIGN — MANAGER
// ══════════════════════════════════════════════════════════════════════════════

router.post("/:id/sign-manager", ...auth, async (req: any, res: any) => {
  try {
    const ip   = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
    const name = req.body.signatoryName ?? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim();

    const [insp] = await db
      .select({ id: propertyInspections.id, status: propertyInspections.status, tenantSignedAt: propertyInspections.tenantSignedAt })
      .from(propertyInspections)
      .where(and(
        eq(propertyInspections.id, parseInt(req.params.id)),
        eq(propertyInspections.organizationId, req.user.organizationId),
      ))
      .limit(1);

    if (!insp) return res.status(404).json({ message: "Inspection not found" });
    if (insp.managerSignedAt) return res.status(409).json({ message: "Already signed by manager" });

    // If tenant already signed, mark complete
    const newStatus = insp.tenantSignedAt ? "completed" : "pending_signature";

    const [updated] = await db
      .update(propertyInspections)
      .set({
        managerSignedAt:     new Date(),
        managerSignatureIp:  ip,
        managerSignatureName: name,
        status:              newStatus,
        updatedAt:           new Date(),
      })
      .where(eq(propertyInspections.id, insp.id))
      .returning();

    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SIGN — TENANT (also callable from tenant portal — auth allows tenant role)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/:id/sign-tenant", authenticateJWT as any, requireOrg as any, async (req: any, res: any) => {
  try {
    const ip   = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
    const name = req.body.signatoryName ?? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim();

    const [insp] = await db
      .select({ id: propertyInspections.id, managerSignedAt: propertyInspections.managerSignedAt, tenantSignedAt: propertyInspections.tenantSignedAt })
      .from(propertyInspections)
      .where(and(
        eq(propertyInspections.id, parseInt(req.params.id)),
        eq(propertyInspections.organizationId, req.user.organizationId),
      ))
      .limit(1);

    if (!insp) return res.status(404).json({ message: "Inspection not found" });
    if (insp.tenantSignedAt) return res.status(409).json({ message: "Already signed by tenant" });

    const newStatus = insp.managerSignedAt ? "completed" : "tenant_signed";

    const [updated] = await db
      .update(propertyInspections)
      .set({
        tenantSignedAt:     new Date(),
        tenantSignatureIp:  ip,
        tenantSignatureName: name,
        status:             newStatus,
        updatedAt:          new Date(),
      })
      .where(eq(propertyInspections.id, insp.id))
      .returning();

    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// DIFF — compare move-out inspection against the linked move-in inspection
// Returns per-room condition changes and new issues for deposit deduction.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id/diff", ...auth, async (req: any, res: any) => {
  try {
    const [moveOut] = await db
      .select()
      .from(propertyInspections)
      .where(and(
        eq(propertyInspections.id, parseInt(req.params.id)),
        eq(propertyInspections.organizationId, req.user.organizationId),
      ))
      .limit(1);

    if (!moveOut) return res.status(404).json({ message: "Inspection not found" });

    if (!moveOut.previousInspectionId) {
      return res.json({
        hasPrevious:     false,
        message:         "No linked move-in inspection. Diff cannot be computed.",
        moveOutId:       moveOut.id,
      });
    }

    const [moveIn] = await db
      .select()
      .from(propertyInspections)
      .where(eq(propertyInspections.id, moveOut.previousInspectionId))
      .limit(1);

    if (!moveIn) return res.status(404).json({ message: "Linked move-in inspection not found" });

    type Room = { room: string; condition: string; notes?: string; photoUrls?: string[] };
    const inRooms  = (moveIn.rooms  as Room[] ?? []);
    const outRooms = (moveOut.rooms as Room[] ?? []);

    const CONDITION_RANK: Record<string, number> = { excellent: 4, good: 3, fair: 2, poor: 1 };

    const roomDiffs = outRooms.map(outRoom => {
      const inRoom = inRooms.find(r => r.room === outRoom.room);
      const inRank  = CONDITION_RANK[inRoom?.condition ?? "good"]  ?? 3;
      const outRank = CONDITION_RANK[outRoom.condition ?? "good"]  ?? 3;
      return {
        room:          outRoom.room,
        moveInCondition:  inRoom?.condition  ?? "not inspected",
        moveOutCondition: outRoom.condition,
        degraded:      outRank < inRank,
        severity:      Math.max(0, inRank - outRank),  // 0=none, 1=slight, 2=moderate, 3=severe
        moveInNotes:   inRoom?.notes  ?? null,
        moveOutNotes:  outRoom.notes  ?? null,
      };
    });

    // Rooms that existed at move-in but weren't inspected at move-out
    const missedRooms = inRooms
      .filter(inR => !outRooms.find(r => r.room === inR.room))
      .map(inR => ({
        room:             inR.room,
        moveInCondition:  inR.condition,
        moveOutCondition: "not inspected",
        degraded:         false,
        severity:         0,
        moveInNotes:      inR.notes ?? null,
        moveOutNotes:     null,
      }));

    res.json({
      hasPrevious:       true,
      moveInDate:        moveIn.conductedDate,
      moveOutDate:       moveOut.conductedDate,
      moveInId:          moveIn.id,
      moveOutId:         moveOut.id,
      roomDiffs:         [...roomDiffs, ...missedRooms],
      degradedRooms:     roomDiffs.filter(r => r.degraded).length,
      newIssues:         moveOut.issuesFound ?? [],
      totalIssuesCost:   Number(moveOut.totalIssuesCost ?? 0),
      recommendedDeduction: Number(moveOut.recommendedDeduction ?? 0),
      depositHeld:       null,  // caller should join with tenant.securityDeposit
    });
  } catch (err: any) {
    console.error("inspection diff error:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
