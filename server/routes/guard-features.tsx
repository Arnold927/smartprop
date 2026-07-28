/**
 * Guard Portal Feature Routes
 *
 * Ad-hoc gate pass (unannounced visitor):
 *   GET  /api/guard/tenants          — list tenants for the guard's property (unit picker)
 *   GET  /api/guard/expected-today   — visitors expected today + currently inside
 *   POST /api/guard/adhoc-pass       — create instant gate pass for walk-in visitor
 *
 * Vehicle logbook:
 *   POST /api/guard/vehicle-log      — log a vehicle movement (in/out)
 *   GET  /api/guard/vehicle-log      — today's movements for this property
 */

import { Router } from "express";
import { db } from "../db";
import {
  visitors,
  visitorLog,
  tenants,
  units,
  properties,
  vehicleMovementLog,
  guardShifts,
  registeredVehicles,
} from "@shared/schema";
import { eq, and, desc, gte, lte, or, ilike, sql } from "drizzle-orm";
import { authenticateGuard } from "./gate-pins";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router = Router();
const guard = [authenticateGuard];

// ── Helpers ────────────────────────────────────────────────────────────────

function generateVisitorCode(): string {
  return "VAC-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/guard/tenants
// Returns tenant list for the guard's property — used in ad-hoc pass unit picker
// ══════════════════════════════════════════════════════════════════════════════
router.get("/tenants", ...guard, async (req: any, res: any) => {
  try {
    const propertyId: number = req.user.propertyId;

    const rows = await db
      .select({
        id:         tenants.id,
        firstName:  tenants.firstName,
        lastName:   tenants.lastName,
        phone:      tenants.phone,
        unitId:     tenants.unitId,
        unitNumber: units.unitNumber,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(
        and(
          eq(units.propertyId, propertyId),
          eq(tenants.status, "active"),
        )
      )
      .orderBy(units.unitNumber);

    return res.json(rows);
  } catch (err) {
    logger.error("GET /api/guard/tenants error:", err);
    return res.status(500).json({ message: "Failed to fetch tenants" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/guard/expected-today
// Returns:
//   - expected: visitors expected today (status pending/approved)
//   - inside:   visitors currently checked in
// ══════════════════════════════════════════════════════════════════════════════
router.get("/expected-today", ...guard, async (req: any, res: any) => {
  try {
    const propertyId: number = req.user.propertyId;
    const { start, end } = todayRange();

    const rows = await db
      .select({
        id:               visitors.id,
        visitorName:      visitors.visitorName,
        visitorPhone:     visitors.visitorPhone,
        purposeOfVisit:   visitors.purposeOfVisit,
        expectedArrival:  visitors.expectedArrival,
        expectedDeparture:visitors.expectedDeparture,
        actualArrival:    visitors.actualArrival,
        status:           visitors.status,
        accessCode:       visitors.accessCode,
        vehiclePlate:     visitors.vehiclePlate,
        parkingSpot:      visitors.parkingSpot,
        tenantFirstName:  tenants.firstName,
        tenantLastName:   tenants.lastName,
        unitNumber:       units.unitNumber,
      })
      .from(visitors)
      .leftJoin(tenants, eq(visitors.tenantId, tenants.id))
      .leftJoin(units,   eq(visitors.unitId, units.id))
      .where(
        and(
          eq(visitors.propertyId, propertyId),
          or(
            // Expected today
            and(
              gte(visitors.expectedArrival, start),
              lte(visitors.expectedArrival, end),
            ),
            // Currently inside (checked in regardless of expected date)
            eq(visitors.status, "checked_in" as any),
          )
        )
      )
      .orderBy(visitors.expectedArrival);

    const expected = rows.filter(r =>
      ["pending", "approved"].includes(r.status ?? "") &&
      r.expectedArrival &&
      new Date(r.expectedArrival) >= start &&
      new Date(r.expectedArrival) <= end
    );

    const inside = rows.filter(r => r.status === "checked_in");

    return res.json({ expected, inside });
  } catch (err) {
    logger.error("GET /api/guard/expected-today error:", err);
    return res.status(500).json({ message: "Failed to fetch today's visitors" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/guard/adhoc-pass
// Guard creates an instant pass for a walk-in visitor.
// Body: { visitorName, visitorPhone?, purpose, tenantId?, unitNumber? }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/adhoc-pass", ...guard, async (req: any, res: any) => {
  try {
    const propertyId: number = req.user.propertyId;
    const guardLabel: string = req.user.label ?? "Guard";

    const {
      visitorName,
      visitorPhone,
      purpose,
      tenantId,
      unitId,
      vehiclePlate,
    } = req.body;

    if (!visitorName?.trim()) {
      return res.status(400).json({ message: "visitorName is required" });
    }
    if (!purpose?.trim()) {
      return res.status(400).json({ message: "purpose is required" });
    }

    // Verify tenantId/unitId actually belong to this guard's own property —
    // previously trusted blindly from the request body, letting a guard
    // attribute an adhoc pass to any arbitrary tenant/unit on the platform.
    if (unitId) {
      const [unitRow] = await db.select({ id: units.id }).from(units)
        .where(and(eq(units.id, parseInt(unitId)), eq(units.propertyId, propertyId)))
        .limit(1);
      if (!unitRow) return res.status(404).json({ message: "Unit not found at your property" });
    }
    if (tenantId) {
      const [tenantRow] = await db.select({ id: tenants.id }).from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .where(and(eq(tenants.id, parseInt(tenantId)), eq(units.propertyId, propertyId)))
        .limit(1);
      if (!tenantRow) return res.status(404).json({ message: "Tenant not found at your property" });
    }

    const accessCode = generateVisitorCode();
    const now = new Date();

    const [created] = await db
      .insert(visitors)
      .values({
        propertyId,
        unitId:        unitId   ? parseInt(unitId)   : null,
        tenantId:      tenantId ? parseInt(tenantId) : null,
        visitorName:   visitorName.trim(),
        visitorPhone:  visitorPhone?.trim() || null,
        purposeOfVisit: purpose.trim(),
        expectedArrival:   now,
        status:            "checked_in" as any,
        actualArrival:     now as any,
        accessCode,
        vehiclePlate:  vehiclePlate?.trim().toUpperCase() || null,
        notes:         `adhoc_pass:true\ncreated_by_guard:${guardLabel}`,
        createdBy:     "00000000-0000-0000-0000-000000000000", // guard has no user UUID
      } as any)
      .returning();

    // Log the check-in
    await db.insert(visitorLog).values({
      visitorId: created.id,
      logType:   "check_in",
      location:  "Main Gate",
      securityGuard: guardLabel,
      notes:     `Ad-hoc pass issued by ${guardLabel}`,
    } as any);

    return res.status(201).json({
      id:          created.id,
      accessCode,
      visitorName: visitorName.trim(),
      status:      "checked_in",
      createdAt:   now.toISOString(),
    });
  } catch (err) {
    logger.error("POST /api/guard/adhoc-pass error:", err);
    return res.status(500).json({ message: "Failed to create gate pass" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/guard/vehicle-log
// Log a vehicle movement (entering or exiting the property)
// Body: { plateNumber, vehicleType, direction, purpose?, unitNumber?, driverName?, notes? }
// ══════════════════════════════════════════════════════════════════════════════
router.post("/vehicle-log", ...guard, async (req: any, res: any) => {
  try {
    const propertyId: number = req.user.propertyId;
    const guardLabel: string = req.user.label ?? "Guard";

    const {
      plateNumber,
      vehicleType,
      direction,
      purpose,
      unitNumber,
      driverName,
      notes,
      shiftId,
    } = req.body;

    if (!plateNumber?.trim()) {
      return res.status(400).json({ message: "plateNumber is required" });
    }
    if (!["in", "out"].includes(direction)) {
      return res.status(400).json({ message: "direction must be 'in' or 'out'" });
    }

    const [entry] = await db
      .insert(vehicleMovementLog)
      .values({
        propertyId,
        shiftId:     shiftId ? parseInt(shiftId) : null,
        plateNumber: plateNumber.trim().toUpperCase(),
        vehicleType: vehicleType || "car",
        direction:   direction as "in" | "out",
        purpose:     purpose?.trim() || null,
        unitNumber:  unitNumber?.trim() || null,
        driverName:  driverName?.trim() || null,
        notes:       notes?.trim() || null,
        loggedAt:    new Date(),
        loggedBy:    guardLabel,
      } as any)
      .returning();

    return res.status(201).json(entry);
  } catch (err) {
    logger.error("POST /api/guard/vehicle-log error:", err);
    return res.status(500).json({ message: "Failed to log vehicle movement" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/guard/vehicle-log
// Returns today's vehicle movements for this property
// ══════════════════════════════════════════════════════════════════════════════
router.get("/vehicle-log", ...guard, async (req: any, res: any) => {
  try {
    const propertyId: number = req.user.propertyId;
    const { start, end } = todayRange();

    const rows = await db
      .select()
      .from(vehicleMovementLog)
      .where(
        and(
          eq(vehicleMovementLog.propertyId, propertyId),
          gte(vehicleMovementLog.loggedAt, start),
          lte(vehicleMovementLog.loggedAt, end),
        )
      )
      .orderBy(desc(vehicleMovementLog.loggedAt));

    return res.json(rows);
  } catch (err) {
    logger.error("GET /api/guard/vehicle-log error:", err);
    return res.status(500).json({ message: "Failed to fetch vehicle log" });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: GET /api/guard/admin/vehicle-log?propertyId=X&date=YYYY-MM-DD
// Requires full JWT — for admin/manager dashboard view
// ══════════════════════════════════════════════════════════════════════════════
router.get("/admin/vehicle-log", authenticateJWT as any, requireOrg as any, async (req: any, res: any) => {
  try {
    const propertyId = parseInt(req.query.propertyId as string);
    const dateStr    = req.query.date as string; // YYYY-MM-DD, defaults to today

    if (!propertyId) return res.status(400).json({ message: "propertyId is required" });

    // Third instance of the same gap found in gate-passes/blacklist above —
    // propertyId taken from the query with zero verification it belonged to
    // the caller's own org.
    const [prop] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, req.user.organizationId)))
      .limit(1);
    if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });

    const base = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(base); start.setHours(0, 0, 0, 0);
    const end   = new Date(base); end.setHours(23, 59, 59, 999);

    const rows = await db
      .select()
      .from(vehicleMovementLog)
      .where(
        and(
          eq(vehicleMovementLog.propertyId, propertyId),
          gte(vehicleMovementLog.loggedAt, start),
          lte(vehicleMovementLog.loggedAt, end),
        )
      )
      .orderBy(desc(vehicleMovementLog.loggedAt));

    return res.json(rows);
  } catch (err) {
    logger.error("GET /api/guard/admin/vehicle-log error:", err);
    return res.status(500).json({ message: "Failed to fetch vehicle log" });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/guard/gate-passes?search=<name|company>
// Guard-scoped: only returns passes for the guard's own property.
// Allows the guard to verify a contractor/visitor who arrives with a pass.
// ══════════════════════════════════════════════════════════════════════════════
router.get("/gate-passes", ...guard, async (req: any, res: any) => {
  try {
    // Guard tokens have propertyId in the token; admin/manager pass it as a
    // query param — but that path had no org check at all, letting any
    // admin/manager token view gate passes for any property on the
    // platform. Verified against their own org now.
    const propertyId: number = req.user.propertyId
      ?? (req.query.propertyId ? parseInt(req.query.propertyId as string) : null);
    if (!propertyId) return res.status(400).json({ message: "propertyId is required" });

    if (!req.user.propertyId) {
      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, req.user.organizationId)))
        .limit(1);
      if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });
    }

    const search = ((req.query.search as string) ?? "").trim();

    const rows = await db
      .select({
        id:               visitors.id,
        visitorName:      visitors.visitorName,
        company:          visitors.company,
        purposeOfVisit:   visitors.purposeOfVisit,
        expectedArrival:  visitors.expectedArrival,
        expectedDeparture:visitors.expectedDeparture,
        status:           visitors.status,
        notes:            visitors.notes,
      })
      .from(visitors)
      .where(
        and(
          eq(visitors.propertyId, propertyId),
          search
            ? or(
                ilike(visitors.visitorName, `%${search}%`),
                ilike(visitors.company,     `%${search}%`),
              )
            : undefined,
        )
      )
      .orderBy(desc(visitors.expectedArrival))
      .limit(20);

    // Derive passType from notes encoding (pass_type:<type> on first line)
    const passes = rows.map((r) => {
      let passType = "visitor";
      let notes: string | null = r.notes ?? null;
      if (notes?.startsWith("pass_type:")) {
        passType = notes.split("\n")[0].replace("pass_type:", "").trim();
        const rest = notes.split("\n").slice(1).join("\n").trim();
        notes = rest || null;
      }
      return { ...r, passType, notes };
    });

    return res.json(passes);
  } catch (err) {
    logger.error("GET /api/guard/gate-passes error:", err);
    return res.status(500).json({ message: "Failed to fetch gate passes" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/guard/blacklist?plate=<plateNumber>
// Guard-scoped: checks a plate against blacklisted registered vehicles for
// this property. Returns the matched vehicle if blacklisted, null otherwise.
// Also returns all blacklisted vehicles for this property when no plate given
// so the guard can see the full watchlist.
// ══════════════════════════════════════════════════════════════════════════════
router.get("/blacklist", ...guard, async (req: any, res: any) => {
  try {
    // Same gap as gate-passes above — the admin/manager fallback had no
    // org check at all.
    const propertyId: number = req.user.propertyId
      ?? (req.query.propertyId ? parseInt(req.query.propertyId as string) : null);
    if (!propertyId) return res.status(400).json({ message: "propertyId is required" });

    if (!req.user.propertyId) {
      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, req.user.organizationId)))
        .limit(1);
      if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });
    }

    const plate = ((req.query.plate as string) ?? "").trim().toUpperCase().replace(/\s+/g, "");

    const rows = await db
      .select({
        id:          registeredVehicles.id,
        plateNumber: registeredVehicles.plateNumber,
        make:        registeredVehicles.make,
        model:       registeredVehicles.model,
        color:       registeredVehicles.color,
        vehicleType: registeredVehicles.vehicleType,
        ownerType:   registeredVehicles.ownerType,
        notes:       registeredVehicles.notes,
        status:      registeredVehicles.status,
      })
      .from(registeredVehicles)
      .where(
        and(
          eq(registeredVehicles.propertyId, propertyId),
          eq(registeredVehicles.status, "blacklisted"),
          plate
            ? sql`REPLACE(UPPER(${registeredVehicles.plateNumber}), ' ', '') = ${plate}`
            : undefined,
        )
      )
      .orderBy(registeredVehicles.plateNumber);

    if (plate) {
      // Single plate check — return match or null
      return res.json({ blacklisted: rows.length > 0, vehicle: rows[0] ?? null });
    }

    // Full watchlist
    return res.json(rows);
  } catch (err) {
    logger.error("GET /api/guard/blacklist error:", err);
    return res.status(500).json({ message: "Failed to fetch blacklist" });
  }
});

export default router;