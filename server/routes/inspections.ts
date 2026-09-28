/**
 * inspections.ts — mounted at /api/inspections  (staff / manager / landlord side)
 *
 * Property condition inspections for move-in, move-out, periodic, and pre-letting.
 *
 *   GET    /api/inspections                    list (filterable by unitId, leaseId, propertyId, type)
 *   GET    /api/inspections/:id                single, full record incl. rooms, notes, readings, signatures
 *   POST   /api/inspections                    create (draft) — tenant/lease are resolved from the unit
 *   PATCH  /api/inspections/:id                update rooms/notes/readings — refused once signed
 *   POST   /api/inspections/:id/sign-manager   manager signs (needs at least one saved room)
 *   GET    /api/inspections/:id/diff           diff against the unit's move-in inspection (move-out)
 *
 * Tenant-side viewing and signing lives in tenant-inspections.ts, mounted at
 * /api/tenant-inspections. Tenants are (correctly) blocked from this whole prefix, so a
 * tenant-facing endpoint can never live here.
 */

import { Router }    from "express";
import { db }        from "../db";
import {
  propertyInspections, properties, units, tenants, leases,
} from "@shared/schema";
import { eq, and, desc, ne, isNotNull, sql, getTableColumns } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { notifyTenant }    from "../services/notifyTenant";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

const INSPECTION_TYPES      = ["move_in", "move_out", "periodic", "pre_letting", "emergency"];
const UNIT_REQUIRED_TYPES   = ["move_in", "move_out"];
const CONDITIONS            = ["excellent", "good", "fair", "poor"];
// The only statuses a client may set directly. Signature states (pending_signature,
// tenant_signed, completed) are reached ONLY through the signing endpoints.
const EDITABLE_STATUSES     = ["draft", "in_progress"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Postgres unique-violation, whether the driver throws it raw or wrapped. */
function isUniqueViolation(e: any): boolean {
  return (e?.code ?? e?.cause?.code) === "23505";
}

/**
 * Next number in this year's sequence, e.g. INS-2026-042.
 * Uses the numeric maximum — the previous string-ordered max stopped advancing after
 * INS-…-999 (because "1000" sorts before "999"), which then collided on the unique
 * constraint for every later inspection.
 */
async function nextInspectionNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({
      n: sql<number>`COALESCE(MAX(CAST(split_part(${propertyInspections.inspectionNumber}, '-', 3) AS integer)), 0)`,
    })
    .from(propertyInspections)
    .where(sql`${propertyInspections.inspectionNumber} ~ ${`^INS-${year}-[0-9]+$`}`);
  return `INS-${year}-${String(Number(row?.n ?? 0) + 1).padStart(3, "0")}`;
}

/** Keep only well-formed rooms; bound sizes so a bad client can't bloat the row. */
function sanitizeRooms(input: any): any[] | null {
  if (!Array.isArray(input) || input.length > 60) return null;
  const out: any[] = [];
  for (const r of input) {
    if (!r || typeof r.room !== "string" || !r.room.trim()) return null;
    out.push({
      room:      r.room.trim().slice(0, 80),
      condition: CONDITIONS.includes(r.condition) ? r.condition : "good",
      notes:     typeof r.notes === "string" ? r.notes.slice(0, 2000) : "",
      photoUrls: Array.isArray(r.photoUrls) ? r.photoUrls.filter((u: any) => typeof u === "string").slice(0, 20) : [],
    });
  }
  return out;
}

/** null = left blank; "invalid" = not a finite, non-negative number. */
function parseAmount(v: any): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

/** True when either party has signed — the record is then locked. */
const isSigned = (i: { managerSignedAt?: any; tenantSignedAt?: any }) => !!(i.managerSignedAt || i.tenantSignedAt);

/** Landlords only ever touch inspections on properties they own. */
async function landlordOwnsProperty(propertyId: number | null, userId: string): Promise<boolean> {
  if (!propertyId) return true;
  const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, propertyId)).limit(1);
  return !!prop && prop.ownerId === userId;
}

/** The most recent manager-signed move-in for a unit — the baseline for a move-out diff. */
async function findMoveInBaseline(orgId: number, unitId: number, excludeId?: number): Promise<number | null> {
  const conds: any[] = [
    eq(propertyInspections.organizationId, orgId),
    eq(propertyInspections.unitId, unitId),
    eq(propertyInspections.inspectionType, "move_in"),
    isNotNull(propertyInspections.managerSignedAt),
  ];
  if (excludeId) conds.push(ne(propertyInspections.id, excludeId));
  const [prev] = await db
    .select({ id: propertyInspections.id })
    .from(propertyInspections)
    .where(and(...conds))
    .orderBy(desc(propertyInspections.managerSignedAt))
    .limit(1);
  return prev?.id ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════════

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId          = req.user.organizationId;
    const role: string   = req.user.role ?? "";
    const userId: string = req.user.id;
    const unitId         = req.query.unitId   ? parseInt(req.query.unitId   as string) : null;
    const leaseId        = req.query.leaseId  ? parseInt(req.query.leaseId  as string) : null;
    const propertyId     = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const type           = req.query.type     as string | null;

    const conditions: any[] = [eq(propertyInspections.organizationId, orgId)];
    if (unitId)     conditions.push(eq(propertyInspections.unitId,     unitId));
    if (leaseId)    conditions.push(eq(propertyInspections.leaseId,    leaseId));
    if (propertyId) conditions.push(eq(propertyInspections.propertyId, propertyId));
    if (type)       conditions.push(eq(propertyInspections.inspectionType, type));
    // Landlords only ever see inspections on properties they own — same rule
    // used everywhere else a landlord touches property-scoped data this session.
    if (role === "landlord") conditions.push(eq(properties.ownerId, userId));

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
// GET SINGLE — the full record (rooms, notes, readings, signatures) plus the same
// joined labels the list carries, so the detail screen never has to guess.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid inspection id" });

    const [row] = await db
      .select({
        ...getTableColumns(propertyInspections),
        propertyName:    properties.name,
        unitNumber:      units.unitNumber,
        tenantFirstName: tenants.firstName,
        tenantLastName:  tenants.lastName,
      })
      .from(propertyInspections)
      .leftJoin(properties, eq(propertyInspections.propertyId, properties.id))
      .leftJoin(units,      eq(propertyInspections.unitId,     units.id))
      .leftJoin(tenants,    eq(propertyInspections.tenantId,   tenants.id))
      .where(and(
        eq(propertyInspections.id,             id),
        eq(propertyInspections.organizationId, req.user.organizationId),
      ))
      .limit(1);
    if (!row) return res.status(404).json({ message: "Inspection not found" });

    if (req.user.role === "landlord" && !(await landlordOwnsProperty(row.propertyId, req.user.id))) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    res.json(row);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════════════

router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { propertyId, unitId, inspectionType, scheduledDate, rooms, notes } = req.body;

    if (!Number.isInteger(propertyId) || !inspectionType) {
      return res.status(400).json({ message: "propertyId and inspectionType are required" });
    }
    if (!INSPECTION_TYPES.includes(inspectionType)) {
      return res.status(400).json({ message: `inspectionType must be one of: ${INSPECTION_TYPES.join(", ")}` });
    }
    if (UNIT_REQUIRED_TYPES.includes(inspectionType) && !Number.isInteger(unitId)) {
      return res.status(400).json({ message: "A unit is required for move-in and move-out inspections" });
    }

    // Verify property belongs to org (and, for a landlord, that they own it)
    const propConditions = [eq(properties.id, propertyId), eq(properties.organizationId, orgId)];
    if (req.user.role === "landlord") propConditions.push(eq(properties.ownerId, req.user.id));
    const [prop] = await db.select({ id: properties.id }).from(properties).where(and(...propConditions)).limit(1);
    if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });

    // The unit must belong to THIS property and organisation. Without this check a caller
    // could pass another organisation's unit id and pull its details into the list join.
    let tenantId: number | null = null;
    let leaseId:  number | null = null;
    if (unitId !== undefined && unitId !== null) {
      const [unit] = await db
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.propertyId, propertyId), eq(units.organizationId, orgId)))
        .limit(1);
      if (!unit) return res.status(400).json({ message: "That unit does not belong to the selected property" });

      // Resolve who lives there: the unit's active lease first, then the tenant recorded on the unit.
      const [lease] = await db
        .select({ id: leases.id, tenantId: leases.tenantId })
        .from(leases)
        .where(and(eq(leases.organizationId, orgId), eq(leases.unitId, unitId), eq(leases.status, "active")))
        .orderBy(desc(leases.startDate))
        .limit(1);
      if (lease) {
        leaseId  = lease.id;
        tenantId = lease.tenantId;
      } else {
        const [t] = await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(and(eq(tenants.organizationId, orgId), eq(tenants.unitId, unitId), eq(tenants.status, "active")))
          .limit(1);
        tenantId = t?.id ?? null;
      }
    }

    let cleanRooms: any[] = [];
    if (rooms !== undefined) {
      const r = sanitizeRooms(rooms);
      if (!r) return res.status(400).json({ message: "rooms must be a list of { room, condition, notes }" });
      cleanRooms = r;
    }

    // A move-out is compared against the unit's manager-signed move-in
    const previousInspectionId =
      inspectionType === "move_out" && unitId ? await findMoveInBaseline(orgId, unitId) : null;

    // The number is derived from existing rows, so two simultaneous creates can pick the
    // same one. The unique constraint catches that — retry with a fresh number.
    let created: any = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const inspectionNumber = await nextInspectionNumber();
      try {
        [created] = await db.insert(propertyInspections).values({
          organizationId: orgId,
          propertyId,
          unitId:         unitId ?? null,
          leaseId,
          tenantId,
          inspectionNumber,
          inspectionType,
          scheduledDate:  scheduledDate || null,
          conductedBy:    req.user.id,
          rooms:          cleanRooms,
          issuesFound:    [],
          previousInspectionId,
          status:         "draft",
          notes:          typeof notes === "string" ? notes.slice(0, 5000) : null,
        } as any).returning();
      } catch (e: any) {
        if (!isUniqueViolation(e) || attempt === 4) throw e;
      }
    }

    res.status(201).json(created);
  } catch (err: any) {
    console.error("create inspection error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE (rooms, issues, overall condition, meter readings, notes)
// Refused once anyone has signed: a signed condition report is the evidence in a
// deposit dispute, so it must not be editable afterwards.
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const inspectionId = parseInt(req.params.id);
    if (!Number.isInteger(inspectionId)) return res.status(400).json({ message: "Invalid inspection id" });

    const [existing] = await db
      .select({
        propertyId: propertyInspections.propertyId,
        managerSignedAt: propertyInspections.managerSignedAt,
        tenantSignedAt:  propertyInspections.tenantSignedAt,
      })
      .from(propertyInspections)
      .where(and(eq(propertyInspections.id, inspectionId), eq(propertyInspections.organizationId, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Inspection not found" });

    if (req.user.role === "landlord" && !(await landlordOwnsProperty(existing.propertyId, req.user.id))) {
      return res.status(404).json({ message: "Inspection not found" });
    }
    if (isSigned(existing)) {
      return res.status(409).json({ message: "This inspection has been signed and can no longer be edited" });
    }

    const patch: any = { updatedAt: new Date() };

    if (req.body.rooms !== undefined) {
      const rooms = sanitizeRooms(req.body.rooms);
      if (!rooms) return res.status(400).json({ message: "rooms must be a list of { room, condition, notes }" });
      patch.rooms = rooms;
    }
    if (req.body.overallCondition !== undefined) {
      const oc = req.body.overallCondition;
      if (oc !== null && oc !== "" && !CONDITIONS.includes(oc)) {
        return res.status(400).json({ message: `overallCondition must be one of: ${CONDITIONS.join(", ")}` });
      }
      patch.overallCondition = oc || null;
    }
    for (const key of ["electricityReading", "waterReading", "recommendedDeduction", "totalIssuesCost"] as const) {
      if (req.body[key] === undefined) continue;
      const v = parseAmount(req.body[key]);
      if (v === "invalid") return res.status(400).json({ message: `${key} must be a non-negative number` });
      // recommendedDeduction / totalIssuesCost columns default to 0 rather than accept null
      patch[key] = v === null && (key === "recommendedDeduction" || key === "totalIssuesCost") ? "0" : v;
    }
    if (req.body.conductedDate !== undefined) patch.conductedDate = req.body.conductedDate || null;
    if (req.body.deductionNotes !== undefined) patch.deductionNotes = req.body.deductionNotes ? String(req.body.deductionNotes).slice(0, 5000) : null;
    if (req.body.notes !== undefined)          patch.notes          = req.body.notes ? String(req.body.notes).slice(0, 5000) : null;
    if (req.body.issuesFound !== undefined) {
      if (!Array.isArray(req.body.issuesFound) || req.body.issuesFound.length > 100) {
        return res.status(400).json({ message: "issuesFound must be a list" });
      }
      patch.issuesFound = req.body.issuesFound;
    }
    // Only the working states are settable here. pending_signature / tenant_signed / completed
    // are reached exclusively by signing.
    if (req.body.status !== undefined) {
      if (!EDITABLE_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ message: `status can only be set to: ${EDITABLE_STATUSES.join(", ")}. Use the signing endpoints for the rest.` });
      }
      patch.status = req.body.status;
    }

    const [updated] = await db
      .update(propertyInspections)
      .set(patch)
      .where(and(eq(propertyInspections.id, inspectionId), eq(propertyInspections.organizationId, orgId)))
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
    const name = String(req.body.signatoryName ?? `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`).trim().slice(0, 100);
    const id   = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid inspection id" });
    if (!name) return res.status(400).json({ message: "A signatory name is required" });

    const [insp] = await db
      .select({
        id: propertyInspections.id,
        propertyId: propertyInspections.propertyId,
        rooms: propertyInspections.rooms,
        conductedDate: propertyInspections.conductedDate,
        tenantSignedAt: propertyInspections.tenantSignedAt,
        managerSignedAt: propertyInspections.managerSignedAt,
        tenantId: propertyInspections.tenantId,
        inspectionNumber: propertyInspections.inspectionNumber,
        inspectionType: propertyInspections.inspectionType,
      })
      .from(propertyInspections)
      .where(and(eq(propertyInspections.id, id), eq(propertyInspections.organizationId, req.user.organizationId)))
      .limit(1);

    if (!insp) return res.status(404).json({ message: "Inspection not found" });

    if (req.user.role === "landlord" && !(await landlordOwnsProperty(insp.propertyId, req.user.id))) {
      return res.status(404).json({ message: "Inspection not found" });
    }
    if (insp.managerSignedAt) return res.status(409).json({ message: "Already signed by manager" });

    // Sign what is SAVED, not what happens to be on someone's screen: the record must
    // actually contain a condition report before it can be signed off.
    const savedRooms = Array.isArray(insp.rooms) ? insp.rooms : [];
    if (savedRooms.length === 0) {
      return res.status(400).json({ message: "Add and save at least one room before signing" });
    }

    // Tenant can only sign after the manager, so this is always the first signature here —
    // status moves to pending_signature and the tenant is then invited to countersign.
    const [updated] = await db
      .update(propertyInspections)
      .set({
        managerSignedAt:      new Date(),
        managerSignatureIp:   ip,
        managerSignatureName: name,
        conductedDate:        insp.conductedDate ?? new Date().toISOString().slice(0, 10),
        status:               insp.tenantSignedAt ? "completed" : "pending_signature",
        updatedAt:            new Date(),
      })
      .where(eq(propertyInspections.id, insp.id))
      .returning();

    // Tell the tenant there is something to countersign. Fire-and-forget: a failed
    // WhatsApp send must never undo or delay a signature that has already been recorded.
    if (insp.tenantId && !insp.tenantSignedAt) {
      const kind = insp.inspectionType.replace(/_/g, "-");
      notifyTenant(insp.tenantId, {
        type: "custom",
        message: `Your ${kind} inspection report (${insp.inspectionNumber}) has been signed off by management. `
               + `Please open your tenant portal, go to Documents, and review and countersign it.`,
      }, req.user.organizationId).catch(() => {});
    }

    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// (Tenant signing moved to tenant-inspections.ts — see the note in the header.)

// ══════════════════════════════════════════════════════════════════════════════
// DIFF — compare move-out inspection against the unit's move-in inspection
// Returns per-room condition changes and new issues for deposit deduction.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id/diff", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid inspection id" });

    const [moveOut] = await db
      .select()
      .from(propertyInspections)
      .where(and(eq(propertyInspections.id, id), eq(propertyInspections.organizationId, orgId)))
      .limit(1);

    if (!moveOut) return res.status(404).json({ message: "Inspection not found" });

    if (req.user.role === "landlord" && !(await landlordOwnsProperty(moveOut.propertyId, req.user.id))) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    // The move-in may have been signed AFTER this move-out was created (e.g. a tenant moved in,
    // the report sat in draft, and the move-out was raised later) — so look it up now rather
    // than relying only on the link stored at creation, and remember what we find.
    let previousId = moveOut.previousInspectionId;
    if (!previousId && moveOut.unitId) {
      previousId = await findMoveInBaseline(orgId, moveOut.unitId, moveOut.id);
      if (previousId) {
        await db.update(propertyInspections).set({ previousInspectionId: previousId }).where(eq(propertyInspections.id, moveOut.id));
      }
    }

    if (!previousId) {
      return res.json({
        hasPrevious: false,
        message:     "No signed move-in inspection found for this unit, so there is nothing to compare against.",
        moveOutId:   moveOut.id,
      });
    }

    const [moveIn] = await db
      .select()
      .from(propertyInspections)
      .where(and(eq(propertyInspections.id, previousId), eq(propertyInspections.organizationId, orgId)))
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