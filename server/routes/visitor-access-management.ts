/**
 * Visitor Access Management router
 * Handles: /api/visitor-access-management
 *
 * Wraps the existing `visitors` table but exposes the richer field set
 * expected by the visitor-management frontend page (visitor_code, qr_code_data,
 * access_method, gate_integration_status, etc.) while mapping to/from the
 * actual DB columns.
 */
import { Router } from "express";
import { db } from "../db";
import { visitors, visitorLog, tenants, units, properties } from "@shared/schema";
import { eq, and, desc, inArray, notLike, isNull, or } from "drizzle-orm";
import { checkInVisitor, checkOutVisitor, normalizePlate, isValidPlate } from "../services/gate-access";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import crypto from "crypto";


function safeUuid(id: string | undefined | null): string | null {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) ? id : null;
}

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

/** Property ids this caller may touch: every property in the org, or — for
 *  a landlord — only the ones they own. Mirrors the same helper already
 *  built for caretakers.ts/gate-pins.ts. */
async function accessiblePropertyIds(orgId: number, role: string, userId: string): Promise<number[]> {
  const condition = role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(condition);
  return rows.map(r => r.id);
}

/** Generate a short unique visitor code like VAC-A1B2C3 */
function generateVisitorCode(): string {
  return "VAC-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/** Map a DB visitors row + joined data → the shape expected by the frontend */
function mapToFrontend(row: any): any {
  return {
    id: row.id,
    // Synthesised fields the frontend needs but aren't DB columns
    visitor_code: row.accessCode ?? generateVisitorCode(),
    qr_code_data: row.accessCode ?? row.id?.toString(),
    access_method: row.notes?.startsWith("access_method:") 
      ? row.notes.split(":")[1].split("\n")[0].trim()
      : "qr_code",
    gate_integration_status: "connected",
    access_granted: ["approved", "checked_in"].includes(row.status),
    access_revoked: row.status === "denied",
    // Direct column mappings (snake_case for frontend)
    visitor_name: row.visitorName,
    visitor_phone: row.visitorPhone ?? null,
    visitor_id_number: row.idNumber ?? null,
    host_tenant_id: row.tenantId ?? null,
    host_unit_id: row.unitId ?? null,
    property_id: row.propertyId,
    visit_purpose: row.purposeOfVisit ?? null,
    expected_arrival: row.expectedArrival,
    expected_departure: row.expectedDeparture ?? null,
    actual_arrival: row.actualArrival ?? null,
    actual_departure: row.actualDeparture ?? null,
    visitor_photo_url: row.photoUrl ?? null,
    vehicle_plate: row.vehiclePlate ?? null,
    parking_spot: row.parkingSpot ?? null,
    security_notes: row.notes ?? null,
    check_in_location: null,
    check_out_location: null,
    status: row.status ?? "pending",
    created_by: row.createdBy,
    created_at: row.createdAt,
    // Joined fields
    first_name: row.tenantFirstName ?? null,
    last_name: row.tenantLastName ?? null,
    unit_number: row.unitNumber ?? null,
    property_name: row.propertyName ?? null,
  };
}

// ── GET /api/visitor-access-management ─────────────────────────────────────────
router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId:  number = req.user.organizationId;
    const role:   string = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // Caretakers are scoped to their assigned property only.
    let caretakerPropertyId: number | null = null;
    if (role === "caretaker") {
      const caretaker = await storage.getCaretakerByUserId(userId);
      if (!caretaker?.propertyId) return res.json([]); // unassigned caretaker
      caretakerPropertyId = caretaker.propertyId;
    }

    // Landlords are scoped to properties they own — previously they saw
    // every visitor across the whole org, same as admin/manager.
    let landlordPropertyIds: number[] | null = null;
    if (role === "landlord") {
      landlordPropertyIds = await accessiblePropertyIds(orgId, role, userId);
      if (landlordPropertyIds.length === 0) return res.json([]);
    }

    // Gate passes (see security.ts) live in this same table, marked with a "pass_type:" prefix
    // in notes — excluded here so a gate pass doesn't also show up as an ordinary Visitor Access
    // entry with its internal marker string leaking into the visible notes field.
    // NOT LIKE against a NULL notes column evaluates to NULL, not TRUE, so it would silently
    // exclude every ordinary visitor whose notes were never set — treat NULL as "not a gate pass".
    const notAGatePass = or(isNull(visitors.notes), notLike(visitors.notes, "pass_type:%"));

    const whereClause = caretakerPropertyId !== null
      ? and(eq(properties.organizationId, orgId), eq(visitors.propertyId, caretakerPropertyId), notAGatePass)
      : landlordPropertyIds !== null
        ? and(eq(properties.organizationId, orgId), inArray(visitors.propertyId, landlordPropertyIds), notAGatePass)
        : and(eq(properties.organizationId, orgId), notAGatePass);

    const rows = await db
      .select({
        id: visitors.id,
        propertyId: visitors.propertyId,
        unitId: visitors.unitId,
        tenantId: visitors.tenantId,
        visitorName: visitors.visitorName,
        visitorPhone: visitors.visitorPhone,
        idNumber: visitors.idNumber,
        purposeOfVisit: visitors.purposeOfVisit,
        expectedArrival: visitors.expectedArrival,
        expectedDeparture: visitors.expectedDeparture,
        actualArrival: visitors.actualArrival,
        actualDeparture: visitors.actualDeparture,
        status: visitors.status,
        accessCode: visitors.accessCode,
        notes: visitors.notes,
        photoUrl: visitors.photoUrl,
        vehiclePlate: visitors.vehiclePlate,
        parkingSpot: visitors.parkingSpot,
        createdBy: visitors.createdBy,
        createdAt: visitors.createdAt,
        // Joined
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        unitNumber: units.unitNumber,
        propertyName: properties.name,
      })
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .leftJoin(units, eq(visitors.unitId, units.id))
      .leftJoin(tenants, eq(visitors.tenantId, tenants.id))
      .where(whereClause)
      .orderBy(desc(visitors.expectedArrival));

    res.json(rows.map(mapToFrontend));
  } catch (err) {
    console.error("GET /api/visitor-access-management error:", err);
    res.status(500).json({ message: "Failed to fetch visitor access records" });
  }
});

// ── POST /api/visitor-access-management ────────────────────────────────────────
router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const userId: string = req.user.id;

    const {
      visitorName,
      visitorPhone,
      visitorIdNumber,
      hostTenantId,
      hostUnitId,
      propertyId,
      visitPurpose,
      expectedArrival,
      expectedDeparture,
      accessMethod,
    } = req.body;

    if (!visitorName || !propertyId || !expectedArrival || !visitPurpose) {
      return res.status(400).json({
        message: "visitorName, propertyId, visitPurpose and expectedArrival are required",
      });
    }

    // Verify property belongs to caller's org — and, for a landlord, that
    // they specifically own it.
    const role: string = req.user.role ?? "manager";
    const propCondition = role === "landlord"
      ? and(eq(properties.id, parseInt(propertyId)), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
      : and(eq(properties.id, parseInt(propertyId)), eq(properties.organizationId, orgId));
    const [prop] = await db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(propCondition)
      .limit(1);

    if (!prop) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Dates: a bad string used to become "Invalid Date" and fail with a 500; a departure before the arrival made a pass
    // that was expired the moment it was issued.
    const arrival = new Date(expectedArrival);
    if (isNaN(arrival.getTime())) return res.status(400).json({ message: "Expected arrival is not a valid date" });
    let departure: Date | null = null;
    if (expectedDeparture) {
      departure = new Date(expectedDeparture);
      if (isNaN(departure.getTime())) return res.status(400).json({ message: "Expected departure is not a valid date" });
      if (departure.getTime() < arrival.getTime()) return res.status(400).json({ message: "Expected departure can't be before the arrival" });
    }

    // The host tenant / unit must really be at THIS property. They used to be taken from the request as-is, so a
    // manager could attach a visitor to another organisation's tenant, whose name then showed up in the visitor list.
    let tenantId: number | null = null;
    let unitId: number | null = null;
    if (hostTenantId) {
      const [t] = await db.select({ id: tenants.id, unitId: tenants.unitId }).from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .where(and(eq(tenants.id, parseInt(hostTenantId)), eq(units.propertyId, prop.id))).limit(1);
      if (!t) return res.status(404).json({ message: "That tenant does not live at this property" });
      tenantId = t.id;
      unitId = t.unitId;
    }
    if (hostUnitId) {
      const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, parseInt(hostUnitId)), eq(units.propertyId, prop.id))).limit(1);
      if (!u) return res.status(404).json({ message: "That unit is not at this property" });
      if (unitId && unitId !== u.id) return res.status(400).json({ message: "That tenant does not live in the unit you chose" });
      unitId = u.id;
    }
    let plate: string | null = null;
    if (req.body.vehiclePlate) {
      plate = normalizePlate(req.body.vehiclePlate);
      if (!isValidPlate(plate)) return res.status(400).json({ message: "Vehicle plate can only contain letters and numbers (2–15 characters)" });
    }

    let created: typeof visitors.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        [created] = await db
          .insert(visitors)
          .values({
            propertyId: parseInt(propertyId),
            unitId,
            tenantId,
            visitorName: String(visitorName).trim(),
            visitorPhone: visitorPhone || null,
            idNumber: visitorIdNumber || null,
            purposeOfVisit: visitPurpose,
            expectedArrival: arrival,
            expectedDeparture: departure,
            status: "pending",
            accessCode: generateVisitorCode(),   // unique column — retry on the rare collision
            vehiclePlate: plate,
            // Store access method in notes until schema is extended
            notes: `access_method:${accessMethod || "qr_code"}`,
            createdBy: userId,
          } as any)
          .returning();
      } catch (e: any) {
        if (e?.code !== "23505") throw e;
      }
    }
    if (!created) return res.status(500).json({ message: "Could not generate a unique visitor code. Please try again." });

    res.status(201).json(mapToFrontend({ ...created, propertyName: prop.name }));
  } catch (err) {
    console.error("POST /api/visitor-access-management error:", err);
    res.status(500).json({ message: "Failed to create visitor access" });
  }
});

/** Resolves a visitor by access code for this specific caller — org-scoped
 *  for everyone, further narrowed to their own assigned property for a
 *  caretaker, or their own owned property for a landlord. Returns null if
 *  the visitor doesn't exist, belongs to a different org, or (for
 *  caretaker/landlord) isn't at a property they're scoped to. */
async function resolveVisitorForCaller(code: string, orgId: number, role: string, userId: string) {
  const [row] = await db
    .select({ v: visitors })
    .from(visitors)
    .innerJoin(properties, eq(visitors.propertyId, properties.id))
    .where(and(eq(visitors.accessCode, code), eq(properties.organizationId, orgId)))
    .limit(1);
  if (!row) return null;
  const visitor = row.v;

  if (role === "caretaker") {
    const caretaker = await storage.getCaretakerByUserId(userId);
    if (!caretaker?.propertyId || caretaker.propertyId !== visitor.propertyId) return null;
  } else if (role === "landlord") {
    const [prop] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, visitor.propertyId), eq(properties.ownerId, userId)))
      .limit(1);
    if (!prop) return null;
  }

  return visitor;
}

// ── PATCH /api/visitor-access-management/:code/check-in ───────────────────────
router.patch("/:code/check-in", ...auth, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const { location } = req.body;
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // Previously zero scoping at all here — any authenticated user, from
    // any organisation, could check in any visitor on the platform just by
    // knowing (or guessing) an access code.
    const visitor = await resolveVisitorForCaller(code, orgId, role, userId);

    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    const result = await checkInVisitor(visitor, safeUuid(req.user.id), location || "Main Gate", "manager check-in");
    if (!result.ok) return res.status(result.httpStatus).json({ message: result.message });
    res.json({ ...mapToFrontend(result.visitor), parking: result.parking });
  } catch (err) {
    console.error("PATCH check-in error:", err);
    res.status(500).json({ message: "Failed to check in visitor" });
  }
});

// ── PATCH /api/visitor-access-management/:code/check-out ──────────────────────
router.patch("/:code/check-out", ...auth, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const { location } = req.body;
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // Same gap as check-in above — previously zero scoping at all.
    const visitor = await resolveVisitorForCaller(code, orgId, role, userId);

    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    const result = await checkOutVisitor(visitor, safeUuid(req.user.id), location || "Main Gate");
    if (!result.ok) return res.status(result.httpStatus).json({ message: result.message });
    res.json(mapToFrontend(result.visitor));
  } catch (err) {
    console.error("PATCH check-out error:", err);
    res.status(500).json({ message: "Failed to check out visitor" });
  }
});

// ── PATCH /api/visitor-access-management/:code/approve ────────────────────────
router.patch("/:code/approve", ...auth, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // Same gap as check-in/check-out above — previously zero scoping at all.
    const visitor = await resolveVisitorForCaller(code, orgId, role, userId);

    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    if (visitor.status === "approved") return res.json(mapToFrontend(visitor));   // already approved — nothing to do
    if (visitor.status !== "pending") {
      return res.status(409).json({ message: `This visit is ${String(visitor.status).replace("_", " ")} and can't be approved.` });
    }
    const [updated] = await db
      .update(visitors)
      .set({
        status: "approved",
        approvedBy: safeUuid(req.user.id),
        approvedAt: new Date() as any,
        updatedAt: new Date() as any,
      })
      .where(and(eq(visitors.id, visitor.id), eq(visitors.status, "pending" as any)))
      .returning();
    if (!updated) return res.status(409).json({ message: "This visit was just changed by someone else — refresh and try again." });
    await db.insert(visitorLog).values({ visitorId: visitor.id, logType: "approval", notes: "Approved" } as any);

    res.json(mapToFrontend(updated));
  } catch (err) {
    console.error("PATCH approve error:", err);
    res.status(500).json({ message: "Failed to approve visitor" });
  }
});

// ── PATCH /api/visitor-access-management/:code/revoke ──────────────────────────
router.patch("/:code/revoke", ...auth, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");
    const reason: string | undefined = req.body?.reason;

    // Upgraded to the shared resolver — previously org-only, now also
    // narrowed to a caretaker's own property or a landlord's own properties.
    const visitor = await resolveVisitorForCaller(code, orgId, role, userId);

    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    if (visitor.status === "checked_in") {
      return res.status(409).json({ message: "This visitor is inside right now. Check them out first." });
    }
    if (visitor.status === "checked_out") {
      return res.status(409).json({ message: "This visit is already over." });
    }
    const [updated] = await db
      .update(visitors)
      .set({
        status: "denied", // mapToFrontend() treats "denied" as access_revoked: true
        updatedAt: new Date() as any,
      })
      .where(and(eq(visitors.id, visitor.id), inArray(visitors.status, ["pending", "approved", "expired", "denied"] as any)))
      .returning();
    if (!updated) return res.status(409).json({ message: "This visitor was just checked in by someone else — refresh and try again." });

    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "status_change",
      notes: reason ? `Access revoked: ${reason}` : "Access revoked",
    } as any);

    res.json(mapToFrontend(updated));
  } catch (err) {
    console.error("PATCH revoke error:", err);
    res.status(500).json({ message: "Failed to revoke visitor access" });
  }
});

// ── DELETE /api/visitor-access-management/:code ─────────────────────────────────
router.delete("/:code", ...auth, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    const visitor = await resolveVisitorForCaller(code, orgId, role, userId);

    if (!visitor) {
      return res.status(404).json({ message: "Visitor not found" });
    }

    // visitor_log.visitor_id is NOT NULL with no ON DELETE CASCADE, so any
    // logged check-in/check-out/approval history must be cleared first or the
    // delete below fails on a foreign-key violation.
    await db.delete(visitorLog).where(eq(visitorLog.visitorId, visitor.id));

    await db.delete(visitors).where(eq(visitors.accessCode, code));

    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/visitor-access-management error:", err);
    res.status(500).json({ message: "Failed to delete visitor access record" });
  }
});

export default router;