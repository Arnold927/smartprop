/**
 * Caretakers router — /api/caretakers
 *
 * Provides CRUD for caretaker records, which link a user (role=caretaker)
 * to a specific property. The propertyId stored here is what drives
 * property-scoped access enforcement in:
 *   - GET /api/maintenance-requests   (maintenance.ts)
 *   - GET /api/visitors               (properties.ts)
 *   - GET /api/visitor-access-management (visitor-access-management.ts)
 *
 * GET/POST/PATCH/DELETE accessible by: admin, manager, landlord.
 * Landlords are scoped to caretakers at properties they own — matching
 * the ownership pattern used everywhere else this session (expenses,
 * leases, documents, RRT notices, rent payments, utility bills, etc).
 * A landlord's caretakers must be assigned a property at creation time
 * (unlike admin/manager, who may leave it unassigned for later) — there's
 * no createdBy field on caretakers, so an unassigned caretaker can't be
 * attributed back to a specific landlord for later filtering.
 *
 * GET /me is for the caretaker themselves, to power their own portal.
 */

import { Router } from "express";
import { db } from "../db";
import { caretakers, users, properties } from "@shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { resolveOrInviteCaretakerUser } from "../utils/resolveOrInviteCaretakerUser";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

function requireAdminManagerLandlord(req: any, res: any, next: any) {
  if (!["admin", "manager", "landlord"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Admin, manager, or landlord privileges required" });
  }
  next();
}

/** Property ids this caller may touch: every property in the org, or —
 *  for a landlord — only the ones they own. */
async function accessiblePropertyIds(orgId: number, role: string, userId: string): Promise<number[]> {
  const condition = role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(condition);
  return rows.map(r => r.id);
}

const SELECT_SHAPE = {
  id:                    caretakers.id,
  userId:                caretakers.userId,
  propertyId:            caretakers.propertyId,
  caretakerType:         caretakers.caretakerType,
  shift:                 caretakers.shift,
  status:                caretakers.status,
  contactNumber:         caretakers.contactNumber,
  accommodationProvided: caretakers.accommodationProvided,
  startDate:             caretakers.startDate,
  endDate:               caretakers.endDate,
  performanceRating:     caretakers.performanceRating,
  notes:                 caretakers.notes,
  createdAt:             caretakers.createdAt,
  updatedAt:             caretakers.updatedAt,
  userFirstName:         users.firstName,
  userLastName:          users.lastName,
  userEmail:             users.email,
  propertyName:          properties.name,
};

function shapeRow(r: any) {
  return {
    id:                    r.id,
    userId:                r.userId,
    propertyId:            r.propertyId,
    caretakerType:         r.caretakerType,
    shift:                 r.shift,
    status:                r.status,
    contactNumber:         r.contactNumber,
    accommodationProvided: r.accommodationProvided,
    startDate:             r.startDate,
    endDate:               r.endDate,
    performanceRating:     r.performanceRating,
    notes:                 r.notes,
    createdAt:             r.createdAt,
    updatedAt:             r.updatedAt,
    userName:              [r.userFirstName, r.userLastName].filter(Boolean).join(" ") || "Unknown",
    userEmail:             r.userEmail,
    propertyName:          r.propertyName ?? "Unassigned",
  };
}

// ── GET /api/caretakers ────────────────────────────────────────────────────────
router.get("/", ...auth, requireAdminManagerLandlord, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;
    const propIds = await accessiblePropertyIds(orgId, role, req.user.id);

    const assigned = propIds.length > 0
      ? await db
          .select(SELECT_SHAPE)
          .from(caretakers)
          .innerJoin(users, eq(caretakers.userId, users.id))
          .innerJoin(properties, eq(caretakers.propertyId, properties.id))
          .where(and(eq(users.organizationId, orgId), inArray(caretakers.propertyId, propIds)))
      : [];

    // Caretakers with no property assigned yet — not shown to landlords at
    // all, since there's no way to attribute an unassigned caretaker to a
    // specific landlord (no createdBy field on this table). Admin/manager
    // still see these, so they can complete the assignment.
    const unassigned = role === "landlord" ? [] : await db
      .select(SELECT_SHAPE)
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(and(eq(users.organizationId, orgId), isNull(caretakers.propertyId)));

    res.json([...assigned, ...unassigned].map(shapeRow));
  } catch (err) {
    console.error("GET /api/caretakers error:", err);
    res.status(500).json({ message: "Failed to fetch caretakers" });
  }
});

// ── GET /api/caretakers/me — the caretaker's own assignment, for their portal ──
router.get("/me", ...auth, async (req: any, res: any) => {
  try {
    if (req.user.role !== "caretaker") {
      return res.status(403).json({ message: "This endpoint is for caretakers." });
    }

    const [row] = await db
      .select(SELECT_SHAPE)
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(eq(caretakers.userId, req.user.id))
      .limit(1);

    if (!row) return res.status(404).json({ message: "No caretaker record found for your account yet. Ask your admin or manager." });
    res.json(shapeRow(row));
  } catch (err) {
    console.error("GET /api/caretakers/me error:", err);
    res.status(500).json({ message: "Failed to fetch your caretaker record" });
  }
});

// ── GET /api/caretakers/:id ────────────────────────────────────────────────────
router.get("/:id", ...auth, requireAdminManagerLandlord, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;

    const propIds = await accessiblePropertyIds(orgId, role, req.user.id);
    if (propIds.length === 0) return res.status(404).json({ message: "Caretaker not found" });

    const [row] = await db
      .select(SELECT_SHAPE)
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .innerJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId), inArray(caretakers.propertyId, propIds)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Caretaker not found" });
    res.json(shapeRow(row));
  } catch (err) {
    console.error("GET /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to fetch caretaker" });
  }
});

// ── POST /api/caretakers ───────────────────────────────────────────────────────
router.post("/", ...auth, requireAdminManagerLandlord, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;
    const {
      email, firstName, lastName,
      propertyId, caretakerType, shift, contactNumber,
      accommodationProvided, startDate, salary, notes,
    } = req.body;

    if (!email || !firstName || !lastName || !caretakerType) {
      return res.status(400).json({ message: "email, firstName, lastName, and caretakerType are required" });
    }

    // Landlords must assign a property at creation time — there's no
    // createdBy field on caretakers, so an unassigned caretaker created by
    // a landlord could never be attributed back to them for later
    // filtering (they'd effectively vanish from their own view, or worse,
    // become visible to every landlord once assigned).
    if (role === "landlord" && !propertyId) {
      return res.status(400).json({ message: "Select a property — landlords must assign a caretaker to one of their own properties immediately." });
    }

    if (propertyId) {
      const propCondition = role === "landlord"
        ? and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
        : and(eq(properties.id, propertyId), eq(properties.organizationId, orgId));
      const [prop] = await db.select({ id: properties.id }).from(properties).where(propCondition).limit(1);

      if (!prop) {
        return res.status(404).json({ message: "Property not found in your organisation" });
      }
    }

    const userId = await resolveOrInviteCaretakerUser({
      organizationId: orgId,
      invitedByUserId: req.user.id,
      email,
      firstName,
      lastName,
    });

    const created = await storage.createCaretaker({
      userId,
      propertyId: propertyId ?? null,
      caretakerType,
      shift: shift ?? null,
      contactNumber: contactNumber ?? null,
      accommodationProvided: accommodationProvided ?? false,
      startDate: startDate ?? null,
      salary: salary ?? null,
      notes: notes ?? null,
      status: "active",
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("POST /api/caretakers error:", err);
    res.status(500).json({ message: "Failed to create caretaker" });
  }
});

// ── PATCH /api/caretakers/:id ──────────────────────────────────────────────────
router.patch("/:id", ...auth, requireAdminManagerLandlord, async (req: any, res: any) => {
  try {
    const id     = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const propIds = await accessiblePropertyIds(orgId, role, req.user.id);
    if (propIds.length === 0) return res.status(404).json({ message: "Caretaker not found" });

    const [existing] = await db
      .select({ id: caretakers.id })
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId), inArray(caretakers.propertyId, propIds)))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Caretaker not found" });

    const { propertyId, shift, contactNumber, accommodationProvided,
            status, performanceRating, notes, endDate } = req.body;

    // A landlord reassigning a caretaker may only move them to another
    // property they own — never to null (see the same reasoning in POST /)
    // and never to a property that isn't theirs.
    if (propertyId !== undefined) {
      if (propertyId === null) {
        if (role === "landlord") {
          return res.status(400).json({ message: "Landlords cannot unassign a caretaker's property — reassign to another of your properties instead." });
        }
      } else {
        const propCondition = role === "landlord"
          ? and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
          : and(eq(properties.id, propertyId), eq(properties.organizationId, orgId));
        const [prop] = await db.select({ id: properties.id }).from(properties).where(propCondition).limit(1);
        if (!prop) {
          return res.status(404).json({ message: "Property not found in your organisation" });
        }
      }
    }

    const updated = await storage.updateCaretaker(id, {
      ...(propertyId !== undefined        ? { propertyId }            : {}),
      ...(shift !== undefined             ? { shift }                 : {}),
      ...(contactNumber !== undefined     ? { contactNumber }         : {}),
      ...(accommodationProvided !== undefined ? { accommodationProvided } : {}),
      ...(status !== undefined            ? { status }                : {}),
      ...(performanceRating !== undefined ? { performanceRating }     : {}),
      ...(notes !== undefined             ? { notes }                 : {}),
      ...(endDate !== undefined           ? { endDate }               : {}),
    });

    if (!updated) return res.status(404).json({ message: "Caretaker not found" });
    res.json(updated);
  } catch (err) {
    console.error("PATCH /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to update caretaker" });
  }
});

// ── DELETE /api/caretakers/:id ─────────────────────────────────────────────────
router.delete("/:id", ...auth, requireAdminManagerLandlord, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;

    const propIds = await accessiblePropertyIds(orgId, role, req.user.id);
    if (propIds.length === 0) return res.status(404).json({ message: "Caretaker not found" });

    const [existing] = await db
      .select({ id: caretakers.id })
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId), inArray(caretakers.propertyId, propIds)))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Caretaker not found" });

    await storage.deleteCaretaker(id);
    res.json({ message: "Caretaker deactivated" });
  } catch (err) {
    console.error("DELETE /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to deactivate caretaker" });
  }
});

export default router;