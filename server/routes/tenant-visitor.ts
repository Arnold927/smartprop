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
import { eq, and, desc, or, notExists } from "drizzle-orm";
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

/** Find first available visitor or standard parking space for a property.
 *
 * Uses a NOT EXISTS subquery against parking_assignments to derive real
 * occupancy from live assignment data — not the isAvailable flag, which can
 * drift out of sync when assignments are manually terminated or created
 * outside the check-in/checkout flow.
 */
async function findAvailableSpace(propertyId: number): Promise<{ id: number; spaceNumber: string; floor?: string | null; section?: string | null } | null> {
  const spaces = await db
    .select({
      id: parkingSpaces.id,
      spaceNumber: parkingSpaces.spaceNumber,
      floor: parkingSpaces.floor,
      section: parkingSpaces.section,
      spaceType: parkingSpaces.spaceType,
    })
    .from(parkingSpaces)
    .where(
      and(
        eq(parkingSpaces.propertyId, propertyId),
        eq(parkingSpaces.isReserved, false),
        // A space is truly available only if it has no active assignment —
        // regardless of what the isAvailable flag says.
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
    .limit(10);

  // Prefer visitor-type spaces, then standard, then any available
  const preferred = spaces.find((s) => s.spaceType === "visitor") ??
                    spaces.find((s) => s.spaceType === "standard") ??
                    spaces[0] ?? null;

  return preferred ?? null;
}

/** Mark a parking space as occupied */
async function markSpaceOccupied(spaceId: number): Promise<void> {
  await db
    .update(parkingSpaces)
    .set({ isAvailable: false, updatedAt: new Date() as any })
    .where(eq(parkingSpaces.id, spaceId));
}

/** Release a parking space */
async function markSpaceAvailable(spaceId: number): Promise<void> {
  await db
    .update(parkingSpaces)
    .set({ isAvailable: true, updatedAt: new Date() as any })
    .where(eq(parkingSpaces.id, spaceId));
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
    if (!visitorEmail?.trim()) return res.status(400).json({ message: "visitorEmail is required" });
    if (!visitPurpose?.trim()) return res.status(400).json({ message: "visitPurpose is required" });
    if (!expectedArrival)      return res.status(400).json({ message: "expectedArrival is required" });

    // ── Resolve tenant → unit → property ─────────────────────────────────────
    const [tenantRow] = await db
      .select({
        id: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        unitId: tenants.unitId,
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

    const propertyId = tenantRow.propertyId;
    const hostTenantName = `${tenantRow.firstName} ${tenantRow.lastName}`.trim();

    const hasVehicle = !!vehiclePlate?.trim();

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
            visitorEmail: visitorEmail.trim().toLowerCase(),
            idNumber: visitorIdNumber?.trim() || null,
            purposeOfVisit: visitPurpose.trim(),
            expectedArrival: new Date(expectedArrival),
            expectedDeparture: expectedDeparture ? new Date(expectedDeparture) : null,
            status: "pending" as any,
            accessCode,
            vehiclePlate: vehiclePlate?.trim().toUpperCase() || null,
            notes: `access_method:qr_code\nvehicle:${hasVehicle ? vehiclePlate.trim().toUpperCase() : "none"}`,
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
          ownerId: visitorEmail.trim().toLowerCase(),
          ownerType: "visitor" as any,
          plateNumber: vehiclePlate.trim().toUpperCase(),
          vehicleType: vehicleType || "car",
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
      await sendVisitorInviteEmail({
        to: visitorEmail.trim().toLowerCase(),
        visitorName: visitorName.trim(),
        accessCode,
        propertyName: tenantRow.propertyName ?? "the property",
        propertyAddress: tenantRow.propertyAddress ?? null,
        hostTenantName,
        hostUnitNumber: tenantRow.unitNumber ?? null,
        expectedArrival: new Date(expectedArrival),
        expectedDeparture: expectedDeparture ? new Date(expectedDeparture) : null,
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

    // ── Status guards ─────────────────────────────────────────────────────────
    if (visitor.status === "checked_in") {
      return res.status(409).json({
        success: false,
        message: "This visitor is already checked in.",
        visitor,
      });
    }
    if (visitor.status === "denied" || visitor.status === "expired") {
      return res.status(403).json({
        success: false,
        message: `Access denied — visitor status is "${visitor.status}".`,
        visitor,
      });
    }
    if (visitor.status === "checked_out") {
      return res.status(409).json({
        success: false,
        message: "This visitor has already checked out.",
        visitor,
      });
    }

    // ── QR expiry check ───────────────────────────────────────────────────────
    // Reject if visitor had an expected departure that has already passed
    if (visitor.expectedDeparture && new Date(visitor.expectedDeparture) < new Date()) {
      // Mark as expired in DB
      await db
        .update(visitors)
        .set({ status: "expired" as any, updatedAt: new Date() as any })
        .where(eq(visitors.id, visitor.id));
      return res.status(403).json({
        success: false,
        message: `This access code expired on ${new Date(visitor.expectedDeparture).toLocaleString("en-KE")}. Ask the tenant to send a new invitation.`,
        visitor: { ...visitor, status: "expired" },
      });
    }

    // Reject if the expected arrival date was more than 24 hours ago and visitor is still pending
    if (visitor.status === "pending" && visitor.expectedArrival) {
      const cutoff = new Date(visitor.expectedArrival);
      cutoff.setHours(cutoff.getHours() + 24);
      if (cutoff < new Date()) {
        await db
          .update(visitors)
          .set({ status: "expired" as any, updatedAt: new Date() as any })
          .where(eq(visitors.id, visitor.id));
        return res.status(403).json({
          success: false,
          message: "This access code has expired (visit window passed). Ask the tenant to send a new invitation.",
          visitor: { ...visitor, status: "expired" },
        });
      }
    }

    // ── Do check-in ───────────────────────────────────────────────────────────
    await db
      .update(visitors)
      .set({
        status: "checked_in" as any,
        actualArrival: new Date() as any,
        checkedInBy: safeUuid(req.user.id),
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.id, visitor.id));

    // ── Log the check-in ──────────────────────────────────────────────────────
    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "check_in",
      location,
      notes: `Checked in via ${code.startsWith("VAC") ? "access code" : "QR scan"} at ${location}`,
    } as any);

    // ── Auto-allocate parking ─────────────────────────────────────────────────
    let parkingResult: {
      allocated: boolean;
      requiresManual: boolean;
      spaceNumber?: string;
      floor?: string | null;
      section?: string | null;
      spaceId?: number;
      assignmentId?: number;
    } = { allocated: false, requiresManual: false };

    const hasVehicle = !!visitor.vehiclePlate;

    if (hasVehicle) {
      const space = await findAvailableSpace(visitor.propertyId);

      if (space) {
        // Auto-assign
        await markSpaceOccupied(space.id);

        // Update visitor record with parking spot
        await db
          .update(visitors)
          .set({ parkingSpot: space.spaceNumber, updatedAt: new Date() as any })
          .where(eq(visitors.id, visitor.id));

        // Find or create vehicle record
        let vehicleId: number | null = null;
        const [existingVehicle] = await db
          .select({ id: registeredVehicles.id })
          .from(registeredVehicles)
          .where(eq(registeredVehicles.plateNumber, visitor.vehiclePlate!))
          .limit(1);

        if (existingVehicle) {
          vehicleId = existingVehicle.id;
          // Activate vehicle on entry
          await db
            .update(registeredVehicles)
            .set({ status: "active" as any, updatedAt: new Date() as any })
            .where(eq(registeredVehicles.id, vehicleId));
        } else {
          // Create minimal vehicle record on the fly
          const [newVehicle] = await db
            .insert(registeredVehicles)
            .values({
              propertyId: visitor.propertyId,
              ownerType: "visitor" as any,
              plateNumber: visitor.vehiclePlate!,
              vehicleType: "car",
              make: "Unknown",
              model: "Unknown",
              color: "Unknown",
              isResident: false,
              status: "active" as any,
              notes: `Auto-created at check-in. Visitor code: ${code}`,
            } as any)
            .returning({ id: registeredVehicles.id });
          vehicleId = newVehicle?.id ?? null;
        }

        // Create parking assignment
        let assignmentId: number | undefined;
        if (vehicleId) {
          const [assignment] = await db
            .insert(parkingAssignments)
            .values({
              parkingSpaceId: space.id,
              vehicleId,
              tenantId: visitor.tenantId ?? null,
              assignmentType: "visitor" as any,
              startDate: new Date(),
              endDate: visitor.expectedDeparture ?? null,
              status: "active" as any,
              assignedBy: safeUuid(req.user.id) ?? "00000000-0000-0000-0000-000000000000",
              notes: `Auto-allocated at visitor check-in. Code: ${code}`,
            } as any)
            .returning({ id: parkingAssignments.id });
          assignmentId = assignment?.id;
        }

        parkingResult = {
          allocated: true,
          requiresManual: false,
          spaceNumber: space.spaceNumber,
          floor: space.floor,
          section: space.section,
          spaceId: space.id,
          assignmentId,
        };
      } else {
        // No space found — guard must manually assign
        parkingResult = { allocated: false, requiresManual: true };
      }
    }

    return res.json({
      success: true,
      message: "Visitor checked in successfully",
      visitor: {
        ...visitor,
        status: "checked_in",
        actualArrival: new Date().toISOString(),
        parkingSpot: parkingResult.allocated ? parkingResult.spaceNumber : visitor.parkingSpot,
      },
      hasVehicle,
      parking: parkingResult,
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
// GUARD: POST /api/guest-checkin/assign-space
// Manual parking space assignment after auto-allocation failed
// Body: { visitorCode, spaceId }
// ══════════════════════════════════════════════════════════════════════════════
guestCheckinRouter.post("/assign-space", ...guardAuth, async (req: any, res: any) => {
  try {
    const { visitorCode, spaceId } = req.body;

    if (!visitorCode || !spaceId) {
      return res.status(400).json({ message: "visitorCode and spaceId are required" });
    }

    const [visitor] = await db
      .select()
      .from(visitors)
      .where(eq(visitors.accessCode, visitorCode.trim().toUpperCase()))
      .limit(1);

    if (!visitor) return res.status(404).json({ message: "Visitor not found" });

    // Same scoping rule as /scan — previously unchecked, so a guard (or an
    // admin/manager token) could assign parking for a visitor invited to a
    // completely different property.
    if (req.user.role === "guard") {
      if (!req.user.propertyId || visitor.propertyId !== req.user.propertyId) {
        return res.status(404).json({ message: "Visitor not found" });
      }
    } else {
      const [prop] = await db.select({ organizationId: properties.organizationId }).from(properties).where(eq(properties.id, visitor.propertyId)).limit(1);
      if (!prop || prop.organizationId !== req.user.organizationId) {
        return res.status(404).json({ message: "Visitor not found" });
      }
    }

    // Check the space exists, belongs to the SAME property as the visitor,
    // and has no active assignment (not just the flag) — previously the
    // space's property was never checked at all, so a space from a totally
    // different property could be assigned to this visitor.
    const [space] = await db
      .select()
      .from(parkingSpaces)
      .where(
        and(
          eq(parkingSpaces.id, parseInt(spaceId)),
          eq(parkingSpaces.propertyId, visitor.propertyId),
          eq(parkingSpaces.isReserved, false),
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
      .limit(1);

    if (!space) return res.status(409).json({ message: "Space is not available — it may already be occupied" });

    await markSpaceOccupied(space.id);

    await db
      .update(visitors)
      .set({ parkingSpot: space.spaceNumber, updatedAt: new Date() as any })
      .where(eq(visitors.id, visitor.id));

    // Find vehicle
    let vehicleId: number | null = null;
    if (visitor.vehiclePlate) {
      const [v] = await db
        .select({ id: registeredVehicles.id })
        .from(registeredVehicles)
        .where(eq(registeredVehicles.plateNumber, visitor.vehiclePlate))
        .limit(1);
      vehicleId = v?.id ?? null;
    }

    let assignmentId: number | null = null;
    if (vehicleId) {
      const [a] = await db
        .insert(parkingAssignments)
        .values({
          parkingSpaceId: space.id,
          vehicleId,
          tenantId: visitor.tenantId ?? null,
          assignmentType: "visitor" as any,
          startDate: new Date(),
          endDate: visitor.expectedDeparture ?? null,
          status: "active" as any,
          assignedBy: safeUuid(req.user.id) ?? "00000000-0000-0000-0000-000000000000",
          notes: `Manually assigned by guard. Visitor code: ${visitorCode}`,
        } as any)
        .returning({ id: parkingAssignments.id });
      assignmentId = a?.id ?? null;
    }

    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "status_change",
      location: space.spaceNumber,
      notes: `Parking manually assigned to space ${space.spaceNumber} by guard`,
    } as any);

    return res.json({
      success: true,
      spaceNumber: space.spaceNumber,
      floor: space.floor,
      section: space.section,
      assignmentId,
    });
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
    const { code, location = "Main Gate" } = req.body;

    if (!code?.trim()) return res.status(400).json({ message: "Access code is required" });

    const [visitor] = await db
      .select()
      .from(visitors)
      .where(eq(visitors.accessCode, code.trim().toUpperCase()))
      .limit(1);

    if (!visitor) return res.status(404).json({ message: "Visitor not found" });

    // Same scoping rule as /scan and /assign-space.
    if (req.user.role === "guard") {
      if (!req.user.propertyId || visitor.propertyId !== req.user.propertyId) {
        return res.status(404).json({ message: "Visitor not found" });
      }
    } else {
      const [prop] = await db.select({ organizationId: properties.organizationId }).from(properties).where(eq(properties.id, visitor.propertyId)).limit(1);
      if (!prop || prop.organizationId !== req.user.organizationId) {
        return res.status(404).json({ message: "Visitor not found" });
      }
    }

    if (visitor.status !== "checked_in") {
      return res.status(409).json({ message: `Visitor status is "${visitor.status}", not checked_in` });
    }

    await db
      .update(visitors)
      .set({
        status: "checked_out" as any,
        actualDeparture: new Date() as any,
        checkedOutBy: safeUuid(req.user.id),
        updatedAt: new Date() as any,
      })
      .where(eq(visitors.id, visitor.id));

    // Release parking space
    if (visitor.vehiclePlate) {
      const [vehicle] = await db
        .select({ id: registeredVehicles.id })
        .from(registeredVehicles)
        .where(eq(registeredVehicles.plateNumber, visitor.vehiclePlate))
        .limit(1);

      if (vehicle) {
        // Terminate parking assignment
        const activeAssignments = await db
          .select({ id: parkingAssignments.id, spaceId: parkingAssignments.parkingSpaceId })
          .from(parkingAssignments)
          .where(
            and(
              eq(parkingAssignments.vehicleId, vehicle.id),
              eq(parkingAssignments.status, "active" as any),
            )
          );

        for (const assignment of activeAssignments) {
          await db
            .update(parkingAssignments)
            .set({ status: "terminated" as any, endDate: new Date() as any, updatedAt: new Date() as any })
            .where(eq(parkingAssignments.id, assignment.id));

          await markSpaceAvailable(assignment.spaceId);
        }
      }
    }

    await db.insert(visitorLog).values({
      visitorId: visitor.id,
      logType: "check_out",
      location,
      notes: `Checked out at ${location}`,
    } as any);

    return res.json({ success: true, message: "Visitor checked out successfully" });
  } catch (err) {
    console.error("POST /api/guest-checkin/checkout error:", err);
    return res.status(500).json({ message: "Checkout failed" });
  }
});

export { tenantVisitorRouter, guestCheckinRouter };