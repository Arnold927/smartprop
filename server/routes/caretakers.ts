/**
 * Caretakers router — /api/caretakers
 *
 * Provides CRUD for caretaker records, which link a user (role=caretaker)
 * to a specific property.  The propertyId stored here is what drives
 * property-scoped access enforcement in:
 *   - GET /api/maintenance-requests   (maintenance.ts)
 *   - GET /api/visitors               (properties.ts)
 *   - GET /api/visitor-access-management (visitor-access-management.ts)
 *
 * Accessible by: admin, manager only (ADMIN_MANAGER in requireRole.ts).
 * Caretakers themselves read their own assignment implicitly via the scoping
 * logic — they do not call this endpoint.
 */

import { Router } from "express";
import { db } from "../db";
import { caretakers, users, properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── GET /api/caretakers ────────────────────────────────────────────────────────
// Returns all active caretaker assignments for the caller's org.
// Joins users and properties so the frontend can display names.
router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const rows = await db
      .select({
        id:                  caretakers.id,
        userId:              caretakers.userId,
        propertyId:          caretakers.propertyId,
        caretakerType:       caretakers.caretakerType,
        shift:               caretakers.shift,
        status:              caretakers.status,
        contactNumber:       caretakers.contactNumber,
        accommodationProvided: caretakers.accommodationProvided,
        startDate:           caretakers.startDate,
        endDate:             caretakers.endDate,
        performanceRating:   caretakers.performanceRating,
        notes:               caretakers.notes,
        createdAt:           caretakers.createdAt,
        updatedAt:           caretakers.updatedAt,
        // User fields
        userFirstName:       users.firstName,
        userLastName:        users.lastName,
        userEmail:           users.email,
        // Property fields
        propertyName:        properties.name,
      })
      .from(caretakers)
      .leftJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      // Scope to org via the properties table; caretakers without a property
      // assignment are included via a separate pass below.
      .where(
        eq(properties.organizationId, orgId)
      );

    // Also fetch caretakers with no property assigned yet (propertyId IS NULL)
    // so admins can see and assign them.
    const unassigned = await db
      .select({
        id:                  caretakers.id,
        userId:              caretakers.userId,
        propertyId:          caretakers.propertyId,
        caretakerType:       caretakers.caretakerType,
        shift:               caretakers.shift,
        status:              caretakers.status,
        contactNumber:       caretakers.contactNumber,
        accommodationProvided: caretakers.accommodationProvided,
        startDate:           caretakers.startDate,
        endDate:             caretakers.endDate,
        performanceRating:   caretakers.performanceRating,
        notes:               caretakers.notes,
        createdAt:           caretakers.createdAt,
        updatedAt:           caretakers.updatedAt,
        userFirstName:       users.firstName,
        userLastName:        users.lastName,
        userEmail:           users.email,
        propertyName:        properties.name,
      })
      .from(caretakers)
      .leftJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(
        and(
          eq(users.organizationId, orgId),
          // propertyId IS NULL
          eq(caretakers.propertyId, null as any)
        )
      );

    const all = [...rows, ...unassigned].map(r => ({
      id:                  r.id,
      userId:              r.userId,
      propertyId:          r.propertyId,
      caretakerType:       r.caretakerType,
      shift:               r.shift,
      status:              r.status,
      contactNumber:       r.contactNumber,
      accommodationProvided: r.accommodationProvided,
      startDate:           r.startDate,
      endDate:             r.endDate,
      performanceRating:   r.performanceRating,
      notes:               r.notes,
      createdAt:           r.createdAt,
      updatedAt:           r.updatedAt,
      userName:            [r.userFirstName, r.userLastName].filter(Boolean).join(" ") || "Unknown",
      userEmail:           r.userEmail,
      propertyName:        r.propertyName ?? "Unassigned",
    }));

    res.json(all);
  } catch (err) {
    console.error("GET /api/caretakers error:", err);
    res.status(500).json({ message: "Failed to fetch caretakers" });
  }
});

// ── GET /api/caretakers/:id ────────────────────────────────────────────────────
router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const [caretaker] = await db
      .select()
      .from(caretakers)
      .where(eq(caretakers.id, id))
      .limit(1);

    if (!caretaker) return res.status(404).json({ message: "Caretaker not found" });
    res.json(caretaker);
  } catch (err) {
    console.error("GET /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to fetch caretaker" });
  }
});

// ── POST /api/caretakers ───────────────────────────────────────────────────────
// Creates a caretaker record, linking a user to a property.
// The linked user must already have role='caretaker'.
router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number  = req.user.organizationId;
    const { userId, propertyId, caretakerType, shift, contactNumber,
            accommodationProvided, startDate, salary, notes } = req.body;

    if (!userId || !caretakerType) {
      return res.status(400).json({ message: "userId and caretakerType are required" });
    }

    // Verify the user belongs to this org and has the caretaker role.
    const [targetUser] = await db
      .select({ id: users.id, role: users.role, organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.organizationId !== orgId) {
      return res.status(403).json({ message: "User does not belong to your organisation" });
    }
    if (targetUser.role !== "caretaker") {
      return res.status(400).json({
        message: `User role is '${targetUser.role}'. Set the user's role to 'caretaker' before creating a caretaker record.`,
      });
    }

    // If a propertyId is supplied, verify it belongs to this org.
    if (propertyId) {
      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1);

      if (!prop) {
        return res.status(404).json({ message: "Property not found in your organisation" });
      }
    }

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
// Allows updating the propertyId (re-assigning a caretaker to a different property),
// as well as other mutable fields.
router.patch("/:id", ...auth, async (req: any, res: any) => {
  try {
    const id     = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const { propertyId, shift, contactNumber, accommodationProvided,
            status, performanceRating, notes, endDate } = req.body;

    // If changing propertyId, verify it belongs to this org.
    if (propertyId !== undefined && propertyId !== null) {
      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1);

      if (!prop) {
        return res.status(404).json({ message: "Property not found in your organisation" });
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
// Soft-deletes (sets status='inactive') rather than hard delete.
router.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    await storage.deleteCaretaker(id);
    res.json({ message: "Caretaker deactivated" });
  } catch (err) {
    console.error("DELETE /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to deactivate caretaker" });
  }
});

export default router;
