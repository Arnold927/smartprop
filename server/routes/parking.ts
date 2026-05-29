/**
 * Parking router
 * Handles: /api/parking-spaces, /api/registered-vehicles, /api/parking-assignments
 *
 * Security: every GET is org-scoped via properties.organizationId so vehicles
 * and spaces from other organisations never leak into a different org's view.
 */
import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { db } from "../db";
import {
  parkingSpaces, registeredVehicles, parkingAssignments,
  properties, tenants, visitors, units,
} from "@shared/schema";
import { eq, and, inArray, desc, notExists } from "drizzle-orm";

const parkingSpacesRouter      = Router();
const registeredVehiclesRouter = Router();
const parkingAssignmentsRouter = Router();

const auth = [authenticateJWT as any, requireOrg as any];

// ── helpers ───────────────────────────────────────────────────────────────────

/** Property IDs that belong to the calling org */
async function orgPropertyIds(orgId: number): Promise<number[]> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.organizationId, orgId));
  return rows.map(r => r.id);
}

// ════════════════════════════════════════════════════════════════════════════
// PARKING SPACES
// ════════════════════════════════════════════════════════════════════════════

parkingSpacesRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    if (propIds.length === 0) return res.json([]);

    const spaces = await db
      .select()
      .from(parkingSpaces)
      .where(inArray(parkingSpaces.propertyId, propIds))
      .orderBy(parkingSpaces.spaceNumber);

    res.json(spaces);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking spaces", error: e.message });
  }
});

parkingSpacesRouter.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const [space] = await db
      .select()
      .from(parkingSpaces)
      .where(
        and(
          eq(parkingSpaces.id, parseInt(req.params.id)),
          inArray(parkingSpaces.propertyId, propIds.length ? propIds : [-1]),
        )
      )
      .limit(1);
    if (!space) return res.status(404).json({ message: "Parking space not found" });
    res.json(space);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking space", error: e.message });
  }
});

parkingSpacesRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    // Verify the property belongs to this org before creating
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const propertyId = parseInt(req.body.propertyId);
    if (!propIds.includes(propertyId)) {
      return res.status(403).json({ message: "Property does not belong to your organisation" });
    }
    const space = await storage.createParkingSpace({
      ...req.body,
      propertyId,
      monthlyRate: req.body.monthlyRate ? parseFloat(req.body.monthlyRate) : null,
      hasElectricCharging: req.body.hasElectricCharging === true || req.body.hasElectricCharging === "on",
      isAvailable: true,
      isReserved: false,
      currency: req.body.currency || "KES",
    });
    res.status(201).json(space);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to create parking space", error: e.message });
  }
});

parkingSpacesRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    // Ownership check
    const [existing] = await db.select({ propertyId: parkingSpaces.propertyId }).from(parkingSpaces).where(eq(parkingSpaces.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const space = await storage.updateParkingSpace(id, {
      ...req.body,
      monthlyRate: req.body.monthlyRate ? parseFloat(req.body.monthlyRate) : null,
      hasElectricCharging: req.body.hasElectricCharging === true || req.body.hasElectricCharging === "on",
      isAvailable: req.body.isAvailable ?? true,
      isReserved: req.body.isReserved ?? false,
      currency: req.body.currency || "KES",
    });
    if (!space) return res.status(404).json({ message: "Parking space not found" });
    res.json(space);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update parking space", error: e.message });
  }
});

parkingSpacesRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const [existing] = await db.select({ propertyId: parkingSpaces.propertyId }).from(parkingSpaces).where(eq(parkingSpaces.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteParkingSpace(id);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete parking space", error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REGISTERED VEHICLES  (scoped via propertyId → properties.organizationId)
// ════════════════════════════════════════════════════════════════════════════

registeredVehiclesRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    if (propIds.length === 0) return res.json([]);

    const vehicles = await db
      .select()
      .from(registeredVehicles)
      .where(inArray(registeredVehicles.propertyId, propIds))
      .orderBy(desc(registeredVehicles.createdAt));

    res.json(vehicles);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch registered vehicles", error: e.message });
  }
});

registeredVehiclesRouter.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const [vehicle] = await db
      .select()
      .from(registeredVehicles)
      .where(
        and(
          eq(registeredVehicles.id, parseInt(req.params.id)),
          inArray(registeredVehicles.propertyId, propIds.length ? propIds : [-1]),
        )
      )
      .limit(1);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch vehicle", error: e.message });
  }
});

registeredVehiclesRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const propertyId = parseInt(req.body.propertyId);
    if (!propIds.includes(propertyId)) {
      return res.status(403).json({ message: "Property does not belong to your organisation" });
    }
    // Always enforce pending_approval for guards; managers can approve immediately.
    const role = req.user?.role ?? "guard";
    const autoApprove = ["admin","manager"].includes(role);
    const vehicle = await storage.createRegisteredVehicle({
      ...req.body,
      propertyId,
      year: req.body.year ? parseInt(req.body.year) : null,
      isResident: req.body.isResident === true || req.body.ownerType === "tenant",
      status: autoApprove ? (req.body.status ?? "pending_approval") : "pending_approval",
    });
    res.status(201).json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to register vehicle", error: e.message });
  }
});

registeredVehiclesRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const [existing] = await db.select({ propertyId: registeredVehicles.propertyId }).from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const vehicle = await storage.updateRegisteredVehicle(id, {
      ...req.body,
      year: req.body.year ? parseInt(req.body.year) : null,
      isResident: req.body.isResident === true || req.body.ownerType === "tenant",
    });
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update vehicle", error: e.message });
  }
});

registeredVehiclesRouter.patch("/:id/status", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const allowed = ["active", "inactive", "pending_approval", "blacklisted"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(", ")}` });
    }
    const [existing] = await db.select({ propertyId: registeredVehicles.propertyId }).from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const vehicle = await storage.updateRegisteredVehicleStatus(id, status);
    if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update vehicle status", error: e.message });
  }
});

registeredVehiclesRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const [existing] = await db.select({ propertyId: registeredVehicles.propertyId }).from(registeredVehicles).where(eq(registeredVehicles.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteRegisteredVehicle(id);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete vehicle", error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PARKING ASSIGNMENTS  (scoped via space → property → org)
// ════════════════════════════════════════════════════════════════════════════

parkingAssignmentsRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
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
        // Tenant being visited + their unit number
        tenantFirstName: tenants.firstName,
        tenantLastName:  tenants.lastName,
        unitNumber:      units.unitNumber,
        // Visitor context
        visitorName:    visitors.visitorName,
        visitorPurpose: visitors.purposeOfVisit,
      })
      .from(parkingAssignments)
      .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
      .leftJoin(tenants,            eq(parkingAssignments.tenantId, tenants.id))
      .leftJoin(units,              eq(tenants.unitId, units.id))
      .leftJoin(registeredVehicles, eq(parkingAssignments.vehicleId, registeredVehicles.id))
      .leftJoin(visitors,           eq(registeredVehicles.plateNumber, visitors.vehiclePlate))
      .where(inArray(parkingSpaces.propertyId, propIds))
      .orderBy(desc(parkingAssignments.createdAt));

    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to fetch parking assignments", error: e.message });
  }
});

parkingAssignmentsRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    // Verify the space belongs to this org
    const spaceId = parseInt(req.body.parkingSpaceId);
    const [space] = await db.select({ propertyId: parkingSpaces.propertyId }).from(parkingSpaces).where(eq(parkingSpaces.id, spaceId)).limit(1);
    if (!space || !propIds.includes(space.propertyId)) {
      return res.status(403).json({ message: "Parking space does not belong to your organisation" });
    }
    const assignment = await storage.createParkingAssignment({
      ...req.body,
      parkingSpaceId: spaceId,
      vehicleId: parseInt(req.body.vehicleId),
      tenantId: req.body.tenantId ? parseInt(req.body.tenantId) : null,
      monthlyFee: req.body.monthlyFee ? parseFloat(req.body.monthlyFee) : null,
      assignedBy: req.user?.id ?? "00000000-0000-0000-0000-000000000000",
    });
    res.status(201).json(assignment);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to create parking assignment", error: e.message });
  }
});

parkingAssignmentsRouter.put("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    // Ownership check via space → property
    const [existing] = await db
      .select({ propertyId: parkingSpaces.propertyId })
      .from(parkingAssignments)
      .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
      .where(eq(parkingAssignments.id, id))
      .limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const assignment = await storage.updateParkingAssignment(id, {
      ...req.body,
      monthlyFee: req.body.monthlyFee ? parseFloat(req.body.monthlyFee) : null,
    });
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json(assignment);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update parking assignment", error: e.message });
  }
});

parkingAssignmentsRouter.patch("/:id/status", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const allowed = ["active", "expired", "suspended", "terminated"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${allowed.join(", ")}` });
    }
    const [existing] = await db
      .select({ propertyId: parkingSpaces.propertyId })
      .from(parkingAssignments)
      .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
      .where(eq(parkingAssignments.id, id))
      .limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const assignment = await storage.updateParkingAssignmentStatus(id, status);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json(assignment);
  } catch (e: any) {
    res.status(500).json({ message: "Failed to update assignment status", error: e.message });
  }
});

parkingAssignmentsRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await orgPropertyIds(orgId);
    const id = parseInt(req.params.id);
    const [existing] = await db
      .select({ propertyId: parkingSpaces.propertyId })
      .from(parkingAssignments)
      .innerJoin(parkingSpaces, eq(parkingAssignments.parkingSpaceId, parkingSpaces.id))
      .where(eq(parkingAssignments.id, id))
      .limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(403).json({ message: "Access denied" });
    }
    await storage.deleteParkingAssignment(id);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ message: "Failed to delete parking assignment", error: e.message });
  }
});

export { parkingSpacesRouter, registeredVehiclesRouter, parkingAssignmentsRouter };
