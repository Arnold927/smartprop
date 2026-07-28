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
import { visitors, visitorLog, tenants, units, properties,
  parkingAssignments,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
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

    const whereClause = caretakerPropertyId !== null
      ? and(eq(properties.organizationId, orgId), eq(visitors.propertyId, caretakerPropertyId))
      : landlordPropertyIds !== null
        ? and(eq(properties.organizationId, orgId), inArray(visitors.propertyId, landlordPropertyIds))
        : eq(properties.organizationId, orgId);

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

    const visitorCode = generateVisitorCode();

    const [created] = await db
      .insert(visitors)
      .values({
        propertyId: parseInt(propertyId),
        unitId: hostUnitId ? parseInt(hostUnitId) : null,
        tenantId: hostTenantId ? parseInt(hostTenantId) : null,
        visitorName,
        visitorPhone: visitorPhone || null,
        idNumber: visitorIdNumber || null,
        purposeOfVisit: visitPurpose,
        expectedArrival: new Date(expectedArrival),
        expectedDeparture: expectedDeparture ? new Date(expectedDeparture) : null,
        status: "pending",
        accessCode: visitorCode,
        // Store access method in notes until schema is extended
        notes: `access_method:${accessMethod || "qr_code"}`,
        createdBy: userId,
      } as any)
      .returning();

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
    .select({ id: visitors.id, propertyId: visitors.propertyId })
    .from(visitors)
    .innerJoin(properties, eq(visitors.propertyId, properties.id))
    .where(and(eq(visitors.accessCode, code), eq(properties.organizationId, orgId)))
    .limit(1);
  if (!row) return null;

  if (role === "caretaker") {
    const caretaker = await storage.getCaretakerByUserId(userId);
    if (!caretaker?.propertyId || caretaker.propertyId !== row.propertyId) return null;
  } else if (role === "landlord") {
    const [prop] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, row.propertyId), eq(properties.ownerId, userId)))
      .limit(1);
    if (!prop) return null;
  }

  return row;
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

    const [updated] = await db
      .update(visitors)
      .set({
        status: "checked_in",
        actualArrival: new Date() as any,
        checkedInBy: safeUuid(req.user.id),
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.accessCode, code))
      .returning();

    // Log the check-in
    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "check_in",
      location: location || "Main Gate",
      notes: `Checked in at ${location || "Main Gate"}`,
    } as any);

    res.json(mapToFrontend(updated));
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

    const [updated] = await db
      .update(visitors)
      .set({
        status: "checked_out",
        actualDeparture: new Date() as any,
        checkedOutBy: safeUuid(req.user.id),
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.accessCode, code))
      .returning();

    // Log the check-out
    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "check_out",
      location: location || "Main Gate",
      notes: `Checked out at ${location || "Main Gate"}`,
    } as any);

    // Free the parking space — same as guest-checkin/checkout does
    // Non-blocking: if the visitor had no parking assignment this is a no-op
    if (visitor.id) {
      db.update(parkingAssignments)
        .set({ status: "terminated" as any, updatedAt: new Date() as any })
        .where(
          and(
            eq(parkingAssignments.vehicleId, visitor.id as any),
            eq(parkingAssignments.status, "active" as any),
          )
        )
        .catch((e: any) => console.warn("[checkout] parking termination failed:", e));
    }

    res.json(mapToFrontend(updated));
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

    const [updated] = await db
      .update(visitors)
      .set({
        status: "approved",
        approvedBy: safeUuid(req.user.id),
        approvedAt: new Date() as any,
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.accessCode, code))
      .returning();

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

    const [updated] = await db
      .update(visitors)
      .set({
        status: "denied", // mapToFrontend() treats "denied" as access_revoked: true
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.accessCode, code))
      .returning();

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