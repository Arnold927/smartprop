/**
 * Tenant Visitor Invitation Routes
 * POST /api/tenant/invite-visitor  — tenant creates an invitation, email sent to visitor
 * GET  /api/tenant/my-visitors     — tenant sees their own visitors
 *
 * Parking auto-allocation logic:
 *  1. If vehiclePlate provided → find first available visitor/standard space
 *  2. If found → create parkingAssignment + update space availability
 *  3. If not found → record intent; guard will assign manually at check-in
 *
 * Check-in QR scan / code entry:
 * POST /api/guest-checkin/scan     — validates code, does check-in, allocates parking
 * GET  /api/guest-checkin/spaces   — available spaces for guard manual override
 * POST /api/guest-checkin/assign-space — guard manually assigns a space
 */

import { Router } from "express";
import { db } from "../db";
import {
  visitors,
  visitorLog,
  tenants,
  units,
  properties,
  parkingSpaces,
  parkingAssignments,
  registeredVehicles,
} from "@shared/schema";
import { eq, and, desc, or, notExists, sql, count, inArray } from "drizzle-orm";
import { checkInVisitor, checkOutVisitor, allocateVisitorParking, findVehicle, normalizePlate, isValidPlate, isBlacklisted, syncSpaceFlag } from "../services/gate-access";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { authenticateGuard } from "./gate-pins";
import { whatsappService } from "../whatsapp";
import crypto from "crypto";
import { sendVisitorInviteEmail } from "../lib/visitor-email";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateVisitorCode(): string {
  return "VAC-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// ─── Routers ──────────────────────────────────────────────────────────────────


/** Returns the user ID if it's a real UUID, otherwise null.
 *  Guard sessions use synthetic IDs like "guard-pin-1" which are not valid UUIDs. */
function safeUuid(id: string | undefined | null): string | null {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) ? id : null;
}

const tenantVisitorRouter = Router();
const guestCheckinRouter = Router();
const auth = [authenticateJWT as any, requireOrg as any];
const guardAuth = [authenticateGuard];

// ══════════════════════════════════════════════════════════════════════════════
// TENANT: POST /api/tenant/invite-visitor
// ══════════════════════════════════════════════════════════════════════════════
tenantVisitorRouter.post("/invite-visitor", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const userId: string = req.user.id;

    const {
      visitorName,
      visitorEmail,
      visitorPhone,
      visitorIdNumber,
      visitPurpose,
      expectedArrival,
      expectedDeparture,
      vehiclePlate,      // optional
      vehicleMake,       // optional — to pre-register vehicle
      vehicleModel,
      vehicleColor,
      vehicleType,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!visitorName?.trim())  return res.status(400).json({ message: "visitorName is required" });
    // A guest needs a way to receive their pass — but that is often just a phone number (WhatsApp), not an email.
    if (!visitorEmail?.trim() && !visitorPhone?.trim()) {
      return res.status(400).json({ message: "Enter the guest's email or phone number so they can receive their access code." });
    }
    if (visitorEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail.trim())) {
      return res.status(400).json({ message: "That email address doesn't look right." });
    }
    if (!visitPurpose?.trim()) return res.status(400).json({ message: "visitPurpose is required" });
    if (!expectedArrival)      return res.status(400).json({ message: "expectedArrival is required" });
    const arrivalDate = new Date(expectedArrival);
    if (isNaN(arrivalDate.getTime())) return res.status(400).json({ message: "Expected arrival is not a valid date" });
    // Yesterday is allowed (a guest already on the way); further back is a typo, and the gate would reject the code anyway.
    if (arrivalDate.getTime() < Date.now() - 24 * 3600_000) return res.status(400).json({ message: "Expected arrival is in the past. Choose today or a later date." });
    let departureDate: Date | null = null;
    if (expectedDeparture) {
      departureDate = new Date(expectedDeparture);
      if (isNaN(departureDate.getTime())) return res.status(400).json({ message: "Expected departure is not a valid date" });
      if (departureDate.getTime() < arrivalDate.getTime()) return res.status(400).json({ message: "Expected departure can't be before the arrival." });
    }
    let plate: string | null = null;
    if (vehiclePlate?.trim()) {
      plate = normalizePlate(vehiclePlate);
      if (!isValidPlate(plate)) return res.status(400).json({ message: "Vehicle plate can only contain letters and numbers (2–15 characters)." });
    }

    // ── Resolve tenant → unit → property ─────────────────────────────────────
    const [tenantRow] = await db
      .select({
        id: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        unitId: tenants.unitId,
        status: tenants.status,
        unitNumber: units.unitNumber,
        propertyId: units.propertyId,
        propertyName: properties.name,
        propertyAddress: properties.address,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(tenants.userId, userId))
      .limit(1);

    if (!tenantRow || !tenantRow.propertyId) {
      return res.status(403).json({ message: "Tenant profile not found or not linked to a unit" });
    }
    // A tenant who has moved out (or whose tenancy ended) can no longer invite people to the building.
    if (tenantRow.status && tenantRow.status !== "active") {
      return res.status(403).json({ message: "Your tenancy is no longer active, so you can't invite visitors." });
    }
    // Stop one account from filling the gate list (and a lot of inboxes): cap invitations still waiting to be used.
    const [waiting] = await db.select({ n: count() }).from(visitors)
      .where(and(eq(visitors.tenantId, tenantRow.id), inArray(visitors.status, ["pending", "approved"] as any), sql`${visitors.expectedArrival} > NOW() - INTERVAL '1 day'`));
    if (Number(waiting?.n ?? 0) >= 30) {
      return res.status(429).json({ message: "You already have 30 visitor invitations waiting. Cancel some, or wait until they have been used." });
    }

    const propertyId = tenantRow.propertyId;
    const hostTenantName = `${tenantRow.firstName} ${tenantRow.lastName}`.trim();

    const hasVehicle = !!plate;

    // ── Create visitor record — retry on the rare accessCode collision ───────
    // accessCode now has a real unique constraint (previously none existed,
    // so two visitors could silently end up with the same code, and /scan's
    // lookup — with no ORDER BY — would just take whichever row came back
    // first). 24 bits of entropy makes a collision unlikely, not impossible,
    // so retry a few times rather than fail the whole invitation outright.
    let created: typeof visitors.$inferSelect | undefined;
    let accessCode = "";
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      accessCode = generateVisitorCode();
      try {
        [created] = await db
          .insert(visitors)
          .values({
            propertyId,
            unitId: tenantRow.unitId ?? null,
            tenantId: tenantRow.id,
            visitorName: visitorName.trim(),
            visitorPhone: visitorPhone?.trim() || null,
            visitorEmail: visitorEmail?.trim() ? visitorEmail.trim().toLowerCase() : null,
            idNumber: visitorIdNumber?.trim() || null,
            purposeOfVisit: visitPurpose.trim(),
            expectedArrival: arrivalDate,
            expectedDeparture: departureDate,
            status: "pending" as any,
            accessCode,
            vehiclePlate: plate,
            notes: `access_method:qr_code\nvehicle:${plate ?? "none"}`,
            createdBy: userId,
          } as any)
          .returning();
      } catch (insertErr: any) {
        // Postgres unique_violation — regenerate and retry; any other error
        // should propagate as normal.
        if (insertErr?.code !== "23505") throw insertErr;
      }
    }
    if (!created) {
      return res.status(500).json({ message: "Could not generate a unique access code. Please try again." });
    }

    // ── Pre-register vehicle if plate + details provided ──────────────────────
    if (hasVehicle && vehicleMake && vehicleModel && vehicleColor && vehicleType) {
      try {
        await db.insert(registeredVehicles).values({
          propertyId,
          ownerId: visitorEmail?.trim() ? visitorEmail.trim().toLowerCase() : (visitorPhone?.trim() || accessCode),
          ownerType: "visitor" as any,
          plateNumber: plate!,
          vehicleType: ["car", "motorcycle", "truck", "van", "bicycle"].includes(String(vehicleType).toLowerCase()) ? String(vehicleType).toLowerCase() : "car",
          make: vehicleMake.trim(),
          model: vehicleModel.trim(),
          color: vehicleColor.trim(),
          isResident: false,
          status: "pending_approval" as any,
          notes: `Pre-registered via visitor invite. Access code: ${accessCode}`,
        } as any).onConflictDoNothing();
      } catch (vehicleErr) {
        // Non-fatal — plate may already exist
        console.warn("[invite-visitor] Vehicle pre-registration skipped:", vehicleErr);
      }
    }

    // ── Send visitor invite email ─────────────────────────────────────────────
    let emailSent = false;
    try {
      if (!visitorEmail?.trim()) throw new Error("no email address — pass is shared by phone/WhatsApp");
      await sendVisitorInviteEmail({
        to: visitorEmail.trim().toLowerCase(),
        visitorName: visitorName.trim(),
        accessCode,
        propertyName: tenantRow.propertyName ?? "the property",
        propertyAddress: tenantRow.propertyAddress ?? null,
        hostTenantName,
        hostUnitNumber: tenantRow.unitNumber ?? null,
        expectedArrival: arrivalDate,
        expectedDeparture: departureDate,
        visitPurpose: visitPurpose.trim(),
        hasVehicle,
      });
      emailSent = true;
    } catch (emailErr) {
      console.error("[invite-visitor] Email failed (non-fatal):", emailErr);
      // Non-fatal — visitor record is still created; admin can resend
    }

    return res.status(201).json({
      message: "Visitor invited successfully",
      visitorId: created.id,
      accessCode,
      emailSent,
      visitorName: visitorName.trim(),
      propertyName: tenantRow.propertyName,
    });
  } catch (err) {
    console.error("POST /api/tenant/invite-visitor error:", err);
    return res.status(500).json({ message: "Failed to create visitor invitation" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENANT: GET /api/tenant/my-visitors  — tenant sees their invitations
// ══════════════════════════════════════════════════════════════════════════════
tenantVisitorRouter.get("/my-visitors", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = req.user.id;

    const [tenantRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.userId, userId))
      .limit(1);

    if (!tenantRow) return res.json([]);

    const rows = await db
      .select({
        id: visitors.id,
        visitorName: visitors.visitorName,
        visitorEmail: visitors.visitorEmail,
        visitorPhone: visitors.visitorPhone,
        purposeOfVisit: visitors.purposeOfVisit,
        expectedArrival: visitors.expectedArrival,
        expectedDeparture: visitors.expectedDeparture,
        actualArrival: visitors.actualArrival,
        actualDeparture: visitors.actualDeparture,
        status: visitors.status,
        accessCode: visitors.accessCode,
        vehiclePlate: visitors.vehiclePlate,
        parkingSpot: visitors.parkingSpot,
        createdAt: visitors.createdAt,
      })
      .from(visitors)
      .where(eq(visitors.tenantId, tenantRow.id))
      .orderBy(desc(visitors.expectedArrival));

    return res.json(rows);
  } catch (err) {
    console.error("GET /api/tenant/my-visitors error:", err);
    return res.status(500).json({ message: "Failed to fetch your visitors" });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// TENANT: DELETE /api/tenant/invite-visitor/:id
// Tenant cancels a pending invitation — only pending/approved can be cancelled
// ══════════════════════════════════════════════════════════════════════════════
tenantVisitorRouter.delete("/invite-visitor/:id", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = req.user.id;
    const visitorId = parseInt(req.params.id);

    // Resolve tenant
    const [tenantRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.userId, userId))
      .limit(1);

    if (!tenantRow) return res.status(403).json({ message: "Tenant profile not found" });

    // Find the visitor — must belong to this tenant
    const [visitor] = await db
      .select({ id: visitors.id, status: visitors.status, tenantId: visitors.tenantId })
      .from(visitors)
      .where(and(eq(visitors.id, visitorId), eq(visitors.tenantId, tenantRow.id)))
      .limit(1);

    if (!visitor) return res.status(404).json({ message: "Invitation not found" });

    if (["checked_in", "checked_out"].includes(visitor.status ?? "")) {
      return res.status(409).json({
        message: `Cannot cancel — visitor is already ${visitor.status?.replace("_", " ")}.`,
      });
    }

    // Mark as denied (soft cancel — preserves the record for audit)
    await db
      .update(visitors)
      .set({ status: "denied" as any, updatedAt: new Date() as any })
      .where(eq(visitors.id, visitorId));

    return res.json({ success: true, message: "Invitation cancelled." });
  } catch (err) {
    console.error("DELETE /api/tenant/invite-visitor/:id error:", err);
    return res.status(500).json({ message: "Failed to cancel invitation" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD: POST /api/guest-checkin/scan
// Body: { code: "VAC-XXXXXX" }
// Validates the code, checks in the visitor, auto-allocates parking if vehicle.
// ══════════════════════════════════════════════════════════════════════════════
guestCheckinRouter.post("/scan", ...guardAuth, async (req: any, res: any) => {
  try {
    const { code, location = "Main Gate" } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({ message: "Access code is required" });
    }

    // ── Find visitor ──────────────────────────────────────────────────────────
    const [visitor] = await db
      .select({
        id: visitors.id,
        visitorName: visitors.visitorName,
        visitorPhone: visitors.visitorPhone,
        visitorEmail: visitors.visitorEmail,
        purposeOfVisit: visitors.purposeOfVisit,
        expectedArrival: visitors.expectedArrival,
        expectedDeparture: visitors.expectedDeparture,
        status: visitors.status,
        accessCode: visitors.accessCode,
        vehiclePlate: visitors.vehiclePlate,
        parkingSpot: visitors.parkingSpot,
        propertyId: visitors.propertyId,
        tenantId: visitors.tenantId,
        unitId: visitors.unitId,
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        unitNumber: units.unitNumber,
        propertyName: properties.name,
        propertyOrgId: properties.organizationId,
      })
      .from(visitors)
      .leftJoin(tenants, eq(visitors.tenantId, tenants.id))
      .leftJoin(units, eq(visitors.unitId, units.id))
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(eq(visitors.accessCode, code.trim().toUpperCase()))
      .limit(1);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        message: "Invalid access code. No matching visitor found.",
      });
    }

    // ── Scoping ─────────────────────────────────────────────────────────────
    // A guard (a PIN token scoped to one property — see authenticateGuard)
    // may only check in visitors invited to THAT property. Property ids are
    // globally unique across the platform, so this comparison alone also
    // guarantees the organisation matches — no separate org check is needed
    // for this branch. The admin/manager fallback (a full user JWT, no
    // propertyId) has no property to compare, so it's scoped by org instead.
    // Previously neither check existed at all: any guard could check in any
    // property's visitor, and any admin/manager token could act cross-org.
    if (req.user.role === "guard") {
      if (!req.user.propertyId || visitor.propertyId !== req.user.propertyId) {
        return res.status(404).json({
          success: false,
          message: "Invalid access code. No matching visitor found.",
        });
      }
    } else if (visitor.propertyOrgId !== req.user.organizationId) {
      return res.status(404).json({
        success: false,
        message: "Invalid access code. No matching visitor found.",
      });
    }

    // ── Check in (status rules, expiry, blacklist, parking — see services/gate-access.ts) ─────────────
    const [full] = await db.select().from(visitors).where(eq(visitors.id, visitor.id)).limit(1);
    const result = await checkInVisitor(full, safeUuid(req.user.id), location, code.trim().toUpperCase().startsWith("VAC") ? "access code" : "QR scan");
    if (!result.ok) {
      return res.status(result.httpStatus).json({ success: false, message: result.message, visitor: result.visitor ?? visitor });
    }
    const parking = result.parking;
    const hasVehicle = !!result.visitor.vehiclePlate;

    return res.json({
      success: true,
      message: "Visitor checked in successfully",
      visitor: {
        ...visitor,
        status: "checked_in",
        actualArrival: new Date().toISOString(),
        parkingSpot: parking.allocated ? parking.spaceNumber : result.visitor.parkingSpot ?? visitor.parkingSpot,
      },
      hasVehicle,
      parking,
    });
  } catch (err) {
    console.error("POST /api/guest-checkin/scan error:", err);
    return res.status(500).json({ message: "Check-in failed. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD: GET /api/guest-checkin/spaces?propertyId=X
// Returns available parking spaces for manual selection
// ══════════════════════════════════════════════════════════════════════════════
guestCheckinRouter.get("/spaces", ...guardAuth, async (req: any, res: any) => {
  try {
    const propertyId = parseInt(req.query.propertyId as string);
    if (!propertyId) return res.status(400).json({ message: "propertyId is required" });

    // Same scoping rule as /scan — previously this endpoint accepted any
    // propertyId with zero verification, letting a guard (or an
    // admin/manager token) query available spaces for any property at all.
    if (req.user.role === "guard") {
      if (!req.user.propertyId || propertyId !== req.user.propertyId) {
        return res.status(403).json({ message: "You can only view spaces at your assigned property." });
      }
    } else {
      const [prop] = await db.select({ organizationId: properties.organizationId }).from(properties).where(eq(properties.id, propertyId)).limit(1);
      if (!prop || prop.organizationId !== req.user.organizationId) {
        return res.status(404).json({ message: "Property not found in your organisation." });
      }
    }

    const spaces = await db
      .select({
        id: parkingSpaces.id,
        spaceNumber: parkingSpaces.spaceNumber,
        floor: parkingSpaces.floor,
        section: parkingSpaces.section,
        spaceType: parkingSpaces.spaceType,
        isAvailable: parkingSpaces.isAvailable,
        hasElectricCharging: parkingSpaces.hasElectricCharging,
      })
      .from(parkingSpaces)
      .where(
        and(
          eq(parkingSpaces.propertyId, propertyId),
          eq(parkingSpaces.isReserved, false),
          // Derive availability from active assignments, not the flag
          notExists(
            db
              .select({ one: parkingAssignments.id })
              .from(parkingAssignments)
              .where(
                and(
                  eq(parkingAssignments.parkingSpaceId, parkingSpaces.id),
                  eq(parkingAssignments.status, "active" as any),
                )
              )
          ),
        )
      )
      .orderBy(parkingSpaces.spaceNumber);

    return res.json(spaces);
  } catch (err) {
    console.error("GET /api/guest-checkin/spaces error:", err);
    return res.status(500).json({ message: "Failed to fetch available spaces" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD: POST /api/guest-checkin/vehicle
// The guard writes down the plate of a visitor's car at the gate (walk-in, or different from the invitation).
// Body: { code, plate, vehicleType?, make?, model?, color? }
// Before this existed the portal saved the vehicle but never put the plate on the visit, so no parking assignment
// was ever created for it and the space it was given was never released.
// ══════════════════════════════════════════════════════════════════════════════
const VEHICLE_TYPES_OK = ["car", "motorcycle", "truck", "van", "bicycle"];

async function scopedVisitorForGuard(req: any, code: string) {
  const [visitor] = await db.select().from(visitors).where(eq(visitors.accessCode, String(code).trim().toUpperCase())).limit(1);
  if (!visitor) return null;
  if (req.user.role === "guard") {
    if (!req.user.propertyId || visitor.propertyId !== req.user.propertyId) return null;
  } else {
    const [prop] = await db.select({ organizationId: properties.organizationId }).from(properties).where(eq(properties.id, visitor.propertyId)).limit(1);
    if (!prop || prop.organizationId !== req.user.organizationId) return null;
  }
  return visitor;
}

guestCheckinRouter.post("/vehicle", ...guardAuth, async (req: any, res: any) => {
  try {
    const { code, plate: rawPlate, vehicleType, make, model, color } = req.body ?? {};
    if (!code) return res.status(400).json({ message: "Access code is required" });
    const plate = normalizePlate(rawPlate);
    if (!isValidPlate(plate)) return res.status(400).json({ message: "Enter the plate number (letters and numbers only)." });

    const visitor = await scopedVisitorForGuard(req, code);
    if (!visitor) return res.status(404).json({ message: "Visitor not found" });
    if (visitor.status !== "checked_in") return res.status(409).json({ message: "Check the visitor in before adding their vehicle." });

    if (await isBlacklisted(visitor.propertyId, plate)) {
      return res.status(403).json({ message: `Vehicle ${plate} is blacklisted at this property. Do not admit it.`, blacklisted: true });
    }

    // register / refresh the vehicle record for this property
    const type = VEHICLE_TYPES_OK.includes(String(vehicleType).toLowerCase()) ? String(vehicleType).toLowerCase() : "car";
    const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null);
    const existing = await findVehicle(visitor.propertyId, plate);
    if (!existing) {
      await db.insert(registeredVehicles).values({
        propertyId: visitor.propertyId, ownerType: "visitor" as any, plateNumber: plate, vehicleType: type,
        make: clean(make) ?? "Unknown", model: clean(model) ?? "Unknown", color: clean(color) ?? "Unknown",
        isResident: false, status: "active" as any, notes: `Captured at gate. Visitor code: ${visitor.accessCode}`,
      } as any).onConflictDoNothing();
    }

    const changedPlate = normalizePlate(visitor.vehiclePlate) !== plate;
    if (changedPlate) {
      // the plate on the visit changed — let go of any bay given to the old one
      const { releaseVisitorParking } = await import("../services/gate-access");
      await releaseVisitorParking(visitor);
      await db.update(visitors).set({ vehiclePlate: plate, parkingSpot: null, updatedAt: new Date() as any }).where(eq(visitors.id, visitor.id));
    }
    const fresh = { ...visitor, vehiclePlate: plate };
    const parking = await allocateVisitorParking(fresh as any, safeUuid(req.user.id), `Allocated after vehicle captured at gate. Code: ${visitor.accessCode}`)
      .catch(() => ({ allocated: false, requiresManual: true } as any));
    return res.json({ success: true, plate, parking });
  } catch (err) {
    console.error("POST /api/guest-checkin/vehicle error:", err);
    return res.status(500).json({ message: "Could not save the vehicle" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD: POST /api/guest-checkin/assign-space
// Manual parking space assignment after auto-allocation failed
// Body: { visitorCode, spaceId }
// ══════════════════════════════════════════════════════════════════════════════
guestCheckinRouter.post("/assign-space", ...guardAuth, async (req: any, res: any) => {
  try {
    const { visitorCode, spaceId } = req.body ?? {};
    if (!visitorCode || !spaceId) return res.status(400).json({ message: "visitorCode and spaceId are required" });

    const visitor = await scopedVisitorForGuard(req, visitorCode);
    if (!visitor) return res.status(404).json({ message: "Visitor not found" });
    if (visitor.status !== "checked_in") return res.status(409).json({ message: "Check the visitor in before giving them a parking space." });
    const plate = normalizePlate(visitor.vehiclePlate);
    if (!plate) return res.status(400).json({ message: "This visitor has no vehicle plate yet. Enter the plate first." });
    if (await isBlacklisted(visitor.propertyId, plate)) return res.status(403).json({ message: `Vehicle ${plate} is blacklisted at this property.` });

    const out = await db.transaction(async (tx) => {
      // lock the bay so two guards can't give it to two cars
      const [space] = await tx.select().from(parkingSpaces)
        .where(and(eq(parkingSpaces.id, parseInt(spaceId)), eq(parkingSpaces.propertyId, visitor.propertyId), eq(parkingSpaces.isReserved, false)))
        .for("update");
      if (!space) return { status: 409, message: "Space is not available — it may be reserved or at another property." };
      const [busy] = await tx.select({ id: parkingAssignments.id }).from(parkingAssignments)
        .where(and(eq(parkingAssignments.parkingSpaceId, space.id), eq(parkingAssignments.status, "active" as any))).limit(1);
      if (busy) return { status: 409, message: "Space is not available — it may already be occupied" };

      let vehicle = await findVehicle(visitor.propertyId, plate, tx);
      if (!vehicle) {
        await tx.insert(registeredVehicles).values({
          propertyId: visitor.propertyId, ownerType: "visitor" as any, plateNumber: plate, vehicleType: "car",
          make: "Unknown", model: "Unknown", color: "Unknown", isResident: false, status: "active" as any,
          notes: `Auto-created when parking was assigned. Visitor code: ${visitor.accessCode}`,
        } as any).onConflictDoNothing();
        vehicle = await findVehicle(visitor.propertyId, plate, tx);
      }
      if (!vehicle) return { status: 500, message: "Could not register the vehicle" };

      // this car already has a bay → move it: end the old assignment first
      const old = await tx.select({ id: parkingAssignments.id, spaceId: parkingAssignments.parkingSpaceId }).from(parkingAssignments)
        .where(and(eq(parkingAssignments.vehicleId, vehicle.id), eq(parkingAssignments.status, "active" as any), eq(parkingAssignments.assignmentType, "visitor" as any)));
      for (const o of old) {
        await tx.update(parkingAssignments).set({ status: "terminated" as any, endDate: new Date() as any, updatedAt: new Date() as any }).where(eq(parkingAssignments.id, o.id));
        await syncSpaceFlag(tx, o.spaceId);
      }

      const [a] = await tx.insert(parkingAssignments).values({
        parkingSpaceId: space.id, vehicleId: vehicle.id, tenantId: visitor.tenantId ?? null, assignmentType: "visitor" as any,
        startDate: new Date(), endDate: visitor.expectedDeparture ?? null, status: "active" as any,
        assignedBy: safeUuid(req.user.id) ?? "00000000-0000-0000-0000-000000000000",
        notes: `Manually assigned by guard. Visitor code: ${visitor.accessCode}`,
      } as any).returning({ id: parkingAssignments.id });
      await syncSpaceFlag(tx, space.id);
      await tx.update(visitors).set({ parkingSpot: space.spaceNumber, updatedAt: new Date() as any }).where(eq(visitors.id, visitor.id));
      await tx.insert(visitorLog).values({ visitorId: visitor.id, logType: "status_change", location: space.spaceNumber, notes: `Parking manually assigned to space ${space.spaceNumber} by guard` } as any);
      return { status: 200, body: { success: true, spaceNumber: space.spaceNumber, floor: space.floor, section: space.section, assignmentId: a?.id ?? null } };
    });
    if (out.status !== 200) return res.status(out.status).json({ message: (out as any).message });
    return res.json((out as any).body);
  } catch (err) {
    console.error("POST /api/guest-checkin/assign-space error:", err);
    return res.status(500).json({ message: "Failed to assign parking space" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD: POST /api/guest-checkin/checkout
// Checks out a visitor and releases their parking space
// ══════════════════════════════════════════════════════════════════════════════
guestCheckinRouter.post("/checkout", ...guardAuth, async (req: any, res: any) => {
  try {
    const { code, location = "Main Gate" } = req.body ?? {};
    if (!code?.trim()) return res.status(400).json({ message: "Access code is required" });
    const visitor = await scopedVisitorForGuard(req, code);
    if (!visitor) return res.status(404).json({ message: "Visitor not found" });
    const result = await checkOutVisitor(visitor, safeUuid(req.user.id), location);
    if (!result.ok) return res.status(result.httpStatus).json({ message: result.message });
    return res.json({ success: true, message: "Visitor checked out successfully" });
  } catch (err) {
    console.error("POST /api/guest-checkin/checkout error:", err);
    return res.status(500).json({ message: "Checkout failed" });
  }
});

export { tenantVisitorRouter, guestCheckinRouter };
