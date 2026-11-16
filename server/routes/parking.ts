/**
 * Parking router
 * Handles: /api/parking-spaces, /api/registered-vehicles, /api/parking-assignments
 *
 * Security: every route is org-scoped via properties.organizationId so vehicles and spaces from other organisations
 * never leak into a different org's view. A landlord only sees properties they own; a guard (gate PIN session) only
 * the one property in their token, and may register a vehicle but not edit, approve, blacklist or delete one.
 *
 * Occupancy: a space is occupied exactly when it has an ACTIVE parking assignment. `is_available` is kept as a mirror
 * (see syncSpaceFlag) and is never taken from a request, so editing a space's notes can no longer mark a space that
 * has a car in it as free. Everything that creates or ends an assignment locks the space row first, so two people
 * assigning the same bay at the same moment can't both succeed.
 */
import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { guardSessionActive } from "./gate-pins";
import { db } from "../db";
import {
  parkingSpaces, registeredVehicles, parkingAssignments,
  properties, tenants, visitors, units,
} from "@shared/schema";
import { eq, and, inArray, desc, sql, ne } from "drizzle-orm";
import { normalizePlate, isValidPlate, plateKey, syncSpaceFlag } from "../services/gate-access";

const parkingSpacesRouter      = Router();
const registeredVehiclesRouter = Router();
const parkingAssignmentsRouter = Router();

const auth = [authenticateJWT as any, requireOrg as any, guardSessionActive as any];

const SPACE_TYPES = ["standard", "compact", "disabled", "electric", "visitor", "reserved"];
const ASSIGNMENT_TYPES = ["permanent", "temporary", "visitor", "daily"];
const VEHICLE_OWNER_TYPES = ["tenant", "visitor", "staff", "contractor", "guest"];

const bad = (res: any, message: string, status = 400) => res.status(status).json({ message });
const str = (v: any) => (v === undefined || v === null ? undefined : String(v).trim());
const isMoney = (v: any) => v === null || v === undefined || v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);
const parseDate = (v: any): Date | null | "bad" => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? "bad" : d;
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Properties this caller may touch: the org's, a landlord's own, or a guard's single property. */
async function accessiblePropertyIds(user: any): Promise<number[]> {
  const orgId: number = user.organizationId;
  if (user.role === "guard") {
    if (!user.propertyId) return [];
    const [p] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, user.propertyId), eq(properties.organizationId, orgId))).limit(1);
    return p ? [p.id] : [];
  }
  const condition = user.role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, user.id))
    : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(condition);
  return rows.map(r => r.id);
}

async function activeAssignmentCountForSpace(spaceId: number): Promise<number> {
  const rows = await db.select({ id: parkingAssignments.id }).from(parkingAssignments)
    .where(and(eq(parkingAssignments.parkingSpaceId, spaceId), eq(parkingAssignments.status, "active" as any)));
  return rows.length;
}

// ════════════════════════════════════════════════════════════════════════════
// PARKING SPACES
// ════════════════════════════════════════════════════════════════════════════

/** A space plus who is in it right now. */
async function spacesWithOccupancy(propIds: number[], onlyId?: number) {
  const rows = await db
    .select({
      space: parkingSpaces,
      assignmentId: parkingAssignments.id,
      assignmentType: parkingAssignments.assignmentType,
      assignmentEnd: parkingAssignments.endDate,
      plateNumber: registeredVehicles.plateNumber,
      tenantFirstName: tenants.firstName,
      tenantLastName: tenants.lastName,
    })
    .from(parkingSpaces)
    .leftJoin(parkingAssignments, and(eq(parkingAssignments.parkingSpaceId, parkingSpaces.id), eq(parkingAssignments.status, "active" as any)))
    .leftJoin(registeredVehicles, eq(parkingAssignments.vehicleId, registeredVehicles.id))
    .leftJoin(tenants, eq(parkingAssignments.tenantId, tenants.id))
    .where(and(inArray(parkingSpaces.propertyId, propIds.length ? propIds : [-1]), onlyId ? eq(parkingSpaces.id, onlyId) : undefined))
    .orderBy(parkingSpaces.spaceNumber);
  const seen = new Set<number>();
  const out: any[] = [];
  for (const r of rows) {
    if (seen.has(r.space.id)) continue;       // a space can only have one active assignment, but never double-list one
    seen.add(r.space.id);
    out.push({
      ...r.space,
      isAvailable: !r.assignmentId,           // derived — see the header comment
      occupied: !!r.assignmentId,
      currentAssignmentId: r.assignmentId ?? null,
      currentAssignmentType: r.assignmentType ?? null,
      currentPlate: r.plateNumber ?? null,
      currentTenantName: r.tenantFirstName ? `${r.tenantFirstName} ${r.tenantLastName ?? ""}`.trim() : null,
    });
  }
  return out;
}

parkingSpacesRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    if (propIds.length === 0) return res.json([]);
    res.json(await spacesWithOccupancy(propIds));
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking spaces", error: e.message });
  }
});

parkingSpacesRouter.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const [space] = await spacesWithOccupancy(propIds, parseInt(req.params.id));
    if (!space) return res.status(404).json({ message: "Parking space not found" });
    res.json(space);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking space", error: e.message });
  }
});

/** Validates the editable fields of a space; returns the cleaned partial or an error message. */
function cleanSpaceFields(b: any, partial: boolean): { ok: true; v: any } | { ok: false; message: string } {
  const v: any = {};
  if (b.spaceNumber !== undefined || !partial) {
    const n = str(b.spaceNumber);
    if (!n) return { ok: false, message: "Space number is required" };
    if (n.length > 30) return { ok: false, message: "Space number is too long" };
    v.spaceNumber = n;
  }
  if (b.spaceType !== undefined || !partial) {
    const t = b.spaceType ?? "standard";
    if (!SPACE_TYPES.includes(t)) return { ok: false, message: `Space type must be one of: ${SPACE_TYPES.join(", ")}` };
    v.spaceType = t;
  }
  if (b.monthlyRate !== undefined) {
    if (!isMoney(b.monthlyRate)) return { ok: false, message: "Monthly rate must be a number that is not negative" };
    v.monthlyRate = b.monthlyRate === null || b.monthlyRate === "" ? null : String(Number(b.monthlyRate));
  }
  for (const k of ["floor", "section", "notes", "reservedFor"] as const) if (b[k] !== undefined) v[k] = str(b[k]) || null;
  if (b.currency !== undefined) v.currency = b.currency || "KES";
  if (b.hasElectricCharging !== undefined) v.hasElectricCharging = b.hasElectricCharging === true || b.hasElectricCharging === "on" || b.hasElectricCharging === "true";
  if (b.isReserved !== undefined) v.isReserved = b.isReserved === true || b.isReserved === "true";
  for (const k of ["length", "width"] as const) {
    if (b[k] !== undefined) {
      if (b[k] !== null && b[k] !== "" && !(Number.isFinite(Number(b[k])) && Number(b[k]) > 0)) return { ok: false, message: `${k} must be a positive number` };
      v[k] = b[k] === null || b[k] === "" ? null : String(Number(b[k]));
    }
  }
  return { ok: true, v };
}

async function spaceNumberTaken(propertyId: number, spaceNumber: string, exceptId?: number) {
  const rows = await db.select({ id: parkingSpaces.id }).from(parkingSpaces)
    .where(and(eq(parkingSpaces.propertyId, propertyId), sql`LOWER(${parkingSpaces.spaceNumber}) = LOWER(${spaceNumber})`, exceptId ? ne(parkingSpaces.id, exceptId) : undefined)).limit(1);
  return rows.length > 0;
}

parkingSpacesRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const propertyId = parseInt(req.body.propertyId);
    if (!propIds.includes(propertyId)) return bad(res, "Property does not belong to your organisation", 403);
    const c = cleanSpaceFields(req.body, false);
    if (!c.ok) return bad(res, c.message);
    if (await spaceNumberTaken(propertyId, c.v.spaceNumber)) return bad(res, `Space ${c.v.spaceNumber} already exists at this property`, 409);
    const [space] = await db.insert(parkingSpaces).values({
      currency: "KES", hasElectricCharging: false, isReserved: false, ...c.v, propertyId, isAvailable: true,
    } as any).returning();
    res.status(201).json({ ...space, occupied: false, isAvailable: true });
  } catch (e: any) {
    res.status(500).json({ message: "Failed to create parking space", error: e.message });
  }
});

parkingSpacesRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(parkingSpaces).where(eq(parkingSpaces.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    const c = cleanSpaceFields(req.body, true);
    if (!c.ok) return bad(res, c.message);
    if (c.v.spaceNumber && await spaceNumberTaken(existing.propertyId, c.v.spaceNumber, id)) return bad(res, `Space ${c.v.spaceNumber} already exists at this property`, 409);
    // Only what was sent changes. propertyId and availability are never taken from the request.
    const [space] = await db.update(parkingSpaces).set({ ...c.v, updatedAt: new Date() as any }).where(eq(parkingSpaces.id, id)).returning();
    const [withOcc] = await spacesWithOccupancy(propIds, id);
    res.json(withOcc ?? space);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update parking space", error: e.message });
  }
});

parkingSpacesRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const [existing] = await db.select({ propertyId: parkingSpaces.propertyId, spaceNumber: parkingSpaces.spaceNumber }).from(parkingSpaces).where(eq(parkingSpaces.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    if (await activeAssignmentCountForSpace(id) > 0) {
      return bad(res, `Space ${existing.spaceNumber} has a vehicle assigned. End the assignment first, then delete the space.`, 409);
    }
    await db.transaction(async (tx) => {
      await tx.delete(parkingAssignments).where(eq(parkingAssignments.parkingSpaceId, id));   // history of ended assignments
      await tx.delete(parkingSpaces).where(eq(parkingSpaces.id, id));
    });
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete parking space", error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REGISTERED VEHICLES  (scoped via propertyId → properties.organizationId)
// ════════════════════════════════════════════════════════════════════════════

/** Fields a caller may set on a vehicle, cleaned. Plate is normalised; nothing else comes from the request body. */
function cleanVehicleFields(b: any, partial: boolean): { ok: true; v: any } | { ok: false; message: string } {
  const v: any = {};
  if (b.plateNumber !== undefined || !partial) {
    const p = normalizePlate(b.plateNumber);
    if (!p) return { ok: false, message: "Plate number is required" };
    if (!isValidPlate(p)) return { ok: false, message: "Plate number can only contain letters and numbers (2–15 characters)" };
    v.plateNumber = p;
  }
  if (b.ownerType !== undefined || !partial) {
    if (!VEHICLE_OWNER_TYPES.includes(b.ownerType)) return { ok: false, message: `Owner type must be one of: ${VEHICLE_OWNER_TYPES.join(", ")}` };
    v.ownerType = b.ownerType;
  }
  if (b.vehicleType !== undefined || !partial) {
    const t = String(b.vehicleType ?? "car").trim().toLowerCase();
    if (!t) return { ok: false, message: "Vehicle type is required" };
    if (t.length > 30) return { ok: false, message: "Vehicle type is too long" };
    v.vehicleType = t;
  }
  for (const k of ["make", "model", "color"] as const) {
    if (b[k] !== undefined || !partial) {
      const x = str(b[k]);
      if (!x) return { ok: false, message: `${k[0].toUpperCase() + k.slice(1)} is required` };
      v[k] = x;
    }
  }
  if (b.year !== undefined) {
    if (b.year === null || b.year === "") v.year = null;
    else {
      const y = parseInt(b.year);
      if (!(y >= 1950 && y <= new Date().getFullYear() + 1)) return { ok: false, message: "Year is not valid" };
      v.year = y;
    }
  }
  if (b.notes !== undefined) v.notes = str(b.notes) || null;
  if (b.ownerId !== undefined) v.ownerId = str(b.ownerId) || null;
  if (b.expiresAt !== undefined) {
    const d = parseDate(b.expiresAt);
    if (d === "bad") return { ok: false, message: "Expiry date is not valid" };
    v.expiresAt = d;
  }
  if (b.isResident !== undefined) v.isResident = b.isResident === true || b.isResident === "true";
  return { ok: true, v };
}

async function plateTaken(propertyId: number, plate: string, exceptId?: number) {
  const rows = await db.select({ id: registeredVehicles.id }).from(registeredVehicles)
    .where(and(eq(registeredVehicles.propertyId, propertyId), sql`${plateKey(registeredVehicles.plateNumber)} = ${plate}`, exceptId ? ne(registeredVehicles.id, exceptId) : undefined)).limit(1);
  return rows.length > 0;
}

/** Ends every active assignment of a vehicle and frees the spaces. Returns how many were ended. */
async function endAssignmentsForVehicle(vehicleId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const active = await tx.select({ id: parkingAssignments.id, spaceId: parkingAssignments.parkingSpaceId }).from(parkingAssignments)
      .where(and(eq(parkingAssignments.vehicleId, vehicleId), eq(parkingAssignments.status, "active" as any)));
    for (const a of active) {
      await tx.update(parkingAssignments).set({ status: "terminated" as any, endDate: new Date() as any, updatedAt: new Date() as any }).where(eq(parkingAssignments.id, a.id));
      await syncSpaceFlag(tx, a.spaceId);
    }
    return active.length;
  });
}

const guardCannot = (req: any, res: any) =>
  req.user?.role === "guard" ? (bad(res, "Guards can register a vehicle but not change, approve, blacklist or delete one. Ask your manager.", 403), true) : false;

registeredVehiclesRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    if (propIds.length === 0) return res.json([]);
    const vehicles = await db.select().from(registeredVehicles)
      .where(inArray(registeredVehicles.propertyId, propIds))
      .orderBy(desc(registeredVehicles.createdAt));
    res.json(vehicles);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch registered vehicles", error: e.message });
  }
});

registeredVehiclesRouter.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const [vehicle] = await db.select().from(registeredVehicles)
      .where(and(eq(registeredVehicles.id, parseInt(req.params.id)), inArray(registeredVehicles.propertyId, propIds.length ? propIds : [-1]))).limit(1);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch vehicle", error: e.message });
  }
});

registeredVehiclesRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const role = req.user?.role ?? "guard";
    const propIds = await accessiblePropertyIds(req.user);
    const propertyId = parseInt(req.body.propertyId);
    if (!propIds.includes(propertyId)) return bad(res, "Property does not belong to your organisation", 403);
    const c = cleanVehicleFields(req.body, false);
    if (!c.ok) return bad(res, c.message);
    if (await plateTaken(propertyId, c.v.plateNumber)) return bad(res, `Vehicle ${c.v.plateNumber} is already registered at this property`, 409);

    // Guards always create "pending approval"; admin/manager/landlord may set the status (default pending).
    const autoApprove = ["admin", "manager", "landlord"].includes(role);
    const wanted = req.body.status;
    const status = autoApprove && ["active", "inactive", "pending_approval"].includes(wanted) ? wanted : "pending_approval";
    const [vehicle] = await db.insert(registeredVehicles).values({
      isResident: c.v.ownerType === "tenant", ...c.v, propertyId, status,
      approvedBy: status === "active" ? (req.user.id ?? null) : null,
      approvedAt: status === "active" ? new Date() : null,
    } as any).returning();
    res.status(201).json(vehicle);
  } catch (e: any) {
    if (e?.code === "23505") return bad(res, "That vehicle is already registered at this property", 409);
    res.status(500).json({ message: "Failed to register vehicle", error: e.message });
  }
});

registeredVehiclesRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    if (guardCannot(req, res)) return;
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    const c = cleanVehicleFields(req.body, true);
    if (!c.ok) return bad(res, c.message);
    if (c.v.plateNumber && await plateTaken(existing.propertyId, c.v.plateNumber, id)) return bad(res, `Vehicle ${c.v.plateNumber} is already registered at this property`, 409);
    // Only what was sent changes; status has its own route and propertyId can't be moved.
    const [vehicle] = await db.update(registeredVehicles).set({ ...c.v, updatedAt: new Date() as any }).where(eq(registeredVehicles.id, id)).returning();
    res.json(vehicle);
  } catch (e: any) {
    if (e?.code === "23505") return bad(res, "That plate is already registered at this property", 409);
    res.status(500).json({ message: "Failed to update vehicle", error: e.message });
  }
});

registeredVehiclesRouter.patch("/:id/status", ...auth, async (req: any, res: any) => {
  try {
    if (guardCannot(req, res)) return;
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const allowed = ["active", "inactive", "pending_approval", "blacklisted"];
    if (!status || !allowed.includes(status)) return bad(res, `status must be one of: ${allowed.join(", ")}`);
    const [existing] = await db.select({ propertyId: registeredVehicles.propertyId }).from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    const [vehicle] = await db.update(registeredVehicles).set({
      status: status as any, updatedAt: new Date() as any,
      ...(status === "active" ? { approvedBy: req.user.id ?? null, approvedAt: new Date() as any } : {}),
    }).where(eq(registeredVehicles.id, id)).returning();
    // A blacklisted or switched-off vehicle must not keep a bay.
    if (status === "blacklisted" || status === "inactive") await endAssignmentsForVehicle(id);
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update vehicle status", error: e.message });
  }
});

registeredVehiclesRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    if (guardCannot(req, res)) return;
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const [existing] = await db.select({ propertyId: registeredVehicles.propertyId, plateNumber: registeredVehicles.plateNumber }).from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    const [active] = await db.select({ id: parkingAssignments.id }).from(parkingAssignments)
      .where(and(eq(parkingAssignments.vehicleId, id), eq(parkingAssignments.status, "active" as any))).limit(1);
    if (active) return bad(res, `${existing.plateNumber} has an active parking assignment. End it first, then delete the vehicle.`, 409);
    await db.transaction(async (tx) => {
      await tx.delete(parkingAssignments).where(eq(parkingAssignments.vehicleId, id));   // ended assignments (history)
      await tx.delete(registeredVehicles).where(eq(registeredVehicles.id, id));
    });
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete vehicle", error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PARKING ASSIGNMENTS  (scoped via space → property → org)
// ════════════════════════════════════════════════════════════════════════════

const assignmentOwnerProperty = async (id: number) => {
  const [r] = await db.select({ propertyId: parkingSpaces.propertyId, spaceId: parkingSpaces.id, status: parkingAssignments.status, vehicleId: parkingAssignments.vehicleId })
    .from(parkingAssignments)
    .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
    .where(eq(parkingAssignments.id, id)).limit(1);
  return r;
};

parkingAssignmentsRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    if (propIds.length === 0) return res.json([]);

    const rows = await db
      .select({
        id:             parkingAssignments.id,
        parkingSpaceId: parkingAssignments.parkingSpaceId,
        vehicleId:      parkingAssignments.vehicleId,
        tenantId:       parkingAssignments.tenantId,
        assignmentType: parkingAssignments.assignmentType,
        startDate:      parkingAssignments.startDate,
        endDate:        parkingAssignments.endDate,
        monthlyFee:     parkingAssignments.monthlyFee,
        currency:       parkingAssignments.currency,
        status:         parkingAssignments.status,
        notes:          parkingAssignments.notes,
        assignedBy:     parkingAssignments.assignedBy,
        createdAt:      parkingAssignments.createdAt,
        updatedAt:      parkingAssignments.updatedAt,
        spaceNumber:    parkingSpaces.spaceNumber,
        plateNumber:    registeredVehicles.plateNumber,
        // Tenant being visited + their unit number
        tenantFirstName: tenants.firstName,
        tenantLastName:  tenants.lastName,
        unitNumber:      units.unitNumber,
        // Visitor context — the MOST RECENT visitor at this property with this plate (a repeat visitor used to
        // produce one duplicate row per past visit, and the join ignored which property the visit was at)
        visitorName:    visitors.visitorName,
        visitorPurpose: visitors.purposeOfVisit,
      })
      .from(parkingAssignments)
      .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
      .leftJoin(tenants,            eq(parkingAssignments.tenantId, tenants.id))
      .leftJoin(units,              eq(tenants.unitId, units.id))
      .leftJoin(registeredVehicles, eq(parkingAssignments.vehicleId, registeredVehicles.id))
      .leftJoin(visitors, and(
        eq(parkingAssignments.assignmentType, "visitor" as any),
        sql`${visitors.id} = (SELECT v2.id FROM visitors v2
                               WHERE v2.property_id = ${parkingSpaces.propertyId}
                                 AND REPLACE(REPLACE(UPPER(v2.vehicle_plate), ' ', ''), '-', '') = REPLACE(REPLACE(UPPER(${registeredVehicles.plateNumber}), ' ', ''), '-', '')
                               ORDER BY v2.created_at DESC LIMIT 1)`,
      ))
      .where(inArray(parkingSpaces.propertyId, propIds))
      .orderBy(desc(parkingAssignments.createdAt));

    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking assignments", error: e.message });
  }
});

parkingAssignmentsRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role === "guard") return bad(res, "Guards assign visitor parking from the check-in screen.", 403);
    const propIds = await accessiblePropertyIds(req.user);
    const b = req.body ?? {};
    const spaceId = parseInt(b.parkingSpaceId);
    const vehicleId = parseInt(b.vehicleId);
    const [space] = await db.select().from(parkingSpaces).where(eq(parkingSpaces.id, spaceId)).limit(1);
    if (!space || !propIds.includes(space.propertyId)) return bad(res, "Parking space does not belong to your organisation", 403);
    const [vehicle] = await db.select().from(registeredVehicles).where(eq(registeredVehicles.id, vehicleId)).limit(1);
    if (!vehicle || !propIds.includes(vehicle.propertyId)) return bad(res, "Vehicle does not belong to your organisation", 403);
    if (vehicle.propertyId !== space.propertyId) return bad(res, "That vehicle is registered at a different property from the space.");
    if (vehicle.status === "blacklisted") return bad(res, `Vehicle ${vehicle.plateNumber} is blacklisted and cannot be given parking.`, 409);
    if (vehicle.status === "inactive") return bad(res, `Vehicle ${vehicle.plateNumber} is inactive. Reactivate it first.`, 409);
    if (!ASSIGNMENT_TYPES.includes(b.assignmentType)) return bad(res, `Assignment type must be one of: ${ASSIGNMENT_TYPES.join(", ")}`);

    const start = b.startDate ? parseDate(b.startDate) : new Date();
    const end = parseDate(b.endDate);
    if (start === "bad" || end === "bad") return bad(res, "Start or end date is not valid");
    if (end && start && end.getTime() < start.getTime()) return bad(res, "End date can't be before the start date");
    if (!isMoney(b.monthlyFee)) return bad(res, "Monthly fee must be a number that is not negative");

    let tenantId: number | null = null;
    if (b.tenantId) {
      tenantId = parseInt(b.tenantId);
      const [t] = await db.select({ id: tenants.id }).from(tenants).innerJoin(units, eq(tenants.unitId, units.id)).where(and(eq(tenants.id, tenantId), eq(units.propertyId, space.propertyId))).limit(1);
      if (!t) return bad(res, "That tenant does not live at this property", 404);
    }

    const created = await db.transaction(async (tx) => {
      await tx.select({ id: parkingSpaces.id }).from(parkingSpaces).where(eq(parkingSpaces.id, spaceId)).for("update");   // one at a time per bay
      const [busy] = await tx.select({ id: parkingAssignments.id }).from(parkingAssignments)
        .where(and(eq(parkingAssignments.parkingSpaceId, spaceId), eq(parkingAssignments.status, "active" as any))).limit(1);
      if (busy) return { error: `Space ${space.spaceNumber} is already occupied.` };
      const [parked] = await tx.select({ id: parkingAssignments.id }).from(parkingAssignments)
        .where(and(eq(parkingAssignments.vehicleId, vehicleId), eq(parkingAssignments.status, "active" as any))).limit(1);
      if (parked) return { error: `Vehicle ${vehicle.plateNumber} already has a parking space. End that assignment first.` };
      const [row] = await tx.insert(parkingAssignments).values({
        parkingSpaceId: spaceId, vehicleId, tenantId, assignmentType: b.assignmentType,
        startDate: start ?? new Date(), endDate: end,
        monthlyFee: b.monthlyFee === undefined || b.monthlyFee === null || b.monthlyFee === "" ? null : String(Number(b.monthlyFee)),
        currency: b.currency || "KES", status: "active" as any, notes: str(b.notes) || null,
        assignedBy: req.user?.id ?? "00000000-0000-0000-0000-000000000000",
      } as any).returning();
      await syncSpaceFlag(tx, spaceId);
      return { row };
    });
    if ("error" in created) return bad(res, created.error as string, 409);
    res.status(201).json(created.row);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to create parking assignment", error: e.message });
  }
});

parkingAssignmentsRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role === "guard") return bad(res, "Access denied", 403);
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const existing = await assignmentOwnerProperty(id);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    const b = req.body ?? {};
    const patch: any = { updatedAt: new Date() };
    if (b.assignmentType !== undefined) {
      if (!ASSIGNMENT_TYPES.includes(b.assignmentType)) return bad(res, `Assignment type must be one of: ${ASSIGNMENT_TYPES.join(", ")}`);
      patch.assignmentType = b.assignmentType;
    }
    if (b.endDate !== undefined) {
      const d = parseDate(b.endDate);
      if (d === "bad") return bad(res, "End date is not valid");
      patch.endDate = d;
    }
    if (b.monthlyFee !== undefined) {
      if (!isMoney(b.monthlyFee)) return bad(res, "Monthly fee must be a number that is not negative");
      patch.monthlyFee = b.monthlyFee === null || b.monthlyFee === "" ? null : String(Number(b.monthlyFee));
    }
    if (b.currency !== undefined) patch.currency = b.currency || "KES";
    if (b.notes !== undefined) patch.notes = str(b.notes) || null;
    const [assignment] = await db.update(parkingAssignments).set(patch).where(eq(parkingAssignments.id, id)).returning();
    res.json(assignment);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update parking assignment", error: e.message });
  }
});

parkingAssignmentsRouter.patch("/:id/status", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role === "guard") return bad(res, "Access denied", 403);
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const allowed = ["active", "expired", "suspended", "terminated"];
    if (!status || !allowed.includes(status)) return bad(res, `status must be one of: ${allowed.join(", ")}`);
    const existing = await assignmentOwnerProperty(id);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);

    const result = await db.transaction(async (tx) => {
      await tx.select({ id: parkingSpaces.id }).from(parkingSpaces).where(eq(parkingSpaces.id, existing.spaceId)).for("update");
      if (status === "active" && existing.status !== "active") {
        const [busy] = await tx.select({ id: parkingAssignments.id }).from(parkingAssignments)
          .where(and(eq(parkingAssignments.parkingSpaceId, existing.spaceId), eq(parkingAssignments.status, "active" as any), ne(parkingAssignments.id, id))).limit(1);
        if (busy) return { error: "Someone else has been given this space since. Choose another space." };
        const [veh] = await tx.select({ status: registeredVehicles.status }).from(registeredVehicles).where(eq(registeredVehicles.id, existing.vehicleId)).limit(1);
        if (veh?.status === "blacklisted") return { error: "This vehicle is blacklisted." };
      }
      const [row] = await tx.update(parkingAssignments).set({
        status: status as any, updatedAt: new Date() as any,
        ...((status === "terminated" || status === "expired") && existing.status === "active" ? { endDate: new Date() as any } : {}),
      }).where(eq(parkingAssignments.id, id)).returning();
      await syncSpaceFlag(tx, existing.spaceId);
      return { row };
    });
    if ("error" in result) return bad(res, result.error as string, 409);
    res.json(result.row);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update assignment status", error: e.message });
  }
});

parkingAssignmentsRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role === "guard") return bad(res, "Access denied", 403);
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const existing = await assignmentOwnerProperty(id);
    if (!existing || !propIds.includes(existing.propertyId)) return bad(res, "Access denied", 403);
    await db.transaction(async (tx) => {
      await tx.delete(parkingAssignments).where(eq(parkingAssignments.id, id));
      await syncSpaceFlag(tx, existing.spaceId);
    });
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete parking assignment", error: e.message });
  }
});

export { parkingSpacesRouter, registeredVehiclesRouter, parkingAssignmentsRouter };
