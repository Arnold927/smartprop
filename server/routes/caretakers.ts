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
 * GET/POST/PATCH/DELETE accessible by: admin, manager only.
 * GET /me is for the caretaker themselves, to power their own portal.
 *
 * Fixed in this pass:
 *   - GET / used eq(caretakers.propertyId, null) to find unassigned
 *     caretakers — NULL comparisons in SQL never match via equality
 *     (NULL = NULL evaluates to NULL, not true), so that half of the list
 *     silently never returned anything. Fixed with isNull().
 *   - GET /:id, PATCH /:id, DELETE /:id had no org scoping at all — any
 *     admin/manager, from any organisation, could view/edit/deactivate any
 *     caretaker record on the platform by guessing an id.
 *   - POST / required a user with role="caretaker" to already exist,
 *     which — since there was no frontend page to invite someone with
 *     that role in a purpose-built way — meant caretaker onboarding
 *     depended on a confusing two-step, cross-page dance. Now accepts
 *     email/firstName/lastName directly and creates the login account as
 *     part of the same request, matching the pattern already used for
 *     tenants/staff/contractors.
 */

import { Router } from "express";
import { db } from "../db";
import { caretakers, users, properties } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { resolveOrInviteCaretakerUser } from "../utils/resolveOrInviteCaretakerUser";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

function requireAdminManager(req: any, res: any, next: any) {
  if (!["admin", "manager"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Admin or manager privileges required" });
  }
  next();
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
router.get("/", ...auth, requireAdminManager, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const assigned = await db
      .select(SELECT_SHAPE)
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(and(eq(users.organizationId, orgId), eq(properties.organizationId, orgId)));

    // Caretakers with no property assigned yet — org-scoped via the user,
    // since there's no property to join through. Previously used
    // eq(caretakers.propertyId, null), which can never match in SQL.
    const unassigned = await db
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
router.get("/:id", ...auth, requireAdminManager, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId: number = req.user.organizationId;

    const [row] = await db
      .select(SELECT_SHAPE)
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .leftJoin(properties, eq(caretakers.propertyId, properties.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Caretaker not found" });
    res.json(shapeRow(row));
  } catch (err) {
    console.error("GET /api/caretakers/:id error:", err);
    res.status(500).json({ message: "Failed to fetch caretaker" });
  }
});

// ── POST /api/caretakers ───────────────────────────────────────────────────────
router.post("/", ...auth, requireAdminManager, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const {
      email, firstName, lastName,
      propertyId, caretakerType, shift, contactNumber,
      accommodationProvided, startDate, salary, notes,
    } = req.body;

    if (!email || !firstName || !lastName || !caretakerType) {
      return res.status(400).json({ message: "email, firstName, lastName, and caretakerType are required" });
    }

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
router.patch("/:id", ...auth, requireAdminManager, async (req: any, res: any) => {
  try {
    const id     = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const [existing] = await db
      .select({ id: caretakers.id })
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId)))
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Caretaker not found" });

    const { propertyId, shift, contactNumber, accommodationProvided,
            status, performanceRating, notes, endDate } = req.body;

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
router.delete("/:id", ...auth, requireAdminManager, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId: number = req.user.organizationId;

    const [existing] = await db
      .select({ id: caretakers.id })
      .from(caretakers)
      .innerJoin(users, eq(caretakers.userId, users.id))
      .where(and(eq(caretakers.id, id), eq(users.organizationId, orgId)))
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