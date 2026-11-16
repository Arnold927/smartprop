/**
 * Security routes
 * Handles: /api/security/gate-passes
 *
 * Gate passes are stored in the existing `visitors` table.
 * The `passType` is encoded in the `notes` field as "pass_type:<type>"
 * so no schema migration is required.
 */
import { Router } from "express";
import { db } from "../db";
import { visitors, properties } from "@shared/schema";
import { eq, and, desc, like, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { guardSessionActive } from "./gate-pins";
import { displayPassStatus } from "../services/gate-access";
import { units } from "@shared/schema";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any, guardSessionActive as any];

/** Properties this caller may use: the org's, a landlord's own, or the single property of a gate PIN session. */
async function accessiblePropertyIds(user: any): Promise<number[]> {
  const orgId: number = user.organizationId;
  const condition = user.role === "guard"
    ? and(eq(properties.organizationId, orgId), eq(properties.id, Number(user.propertyId) || -1))
    : user.role === "landlord"
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, user.id))
      : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(condition);
  return rows.map((r) => r.id);
}

const PASS_STATUSES = ["pending", "approved", "denied", "revoked", "expired"] as const;   // "revoked" is what the screen sends for "denied"

/** True gate passes are marked with this notes prefix — see the header comment. Regular Visitor
 *  Access entries never have it, so this is what tells the two apart in one shared table. */
const GATE_PASS_MARKER = "pass_type:%";

/** Map a DB visitors row → GatePass shape expected by security.tsx */
function mapToGatePass(row: any): object {
  // Extract passType from notes field
  let passType = "visitor";
  let notes: string | null = row.notes ?? null;
  if (notes?.startsWith("pass_type:")) {
    const firstLine = notes.split("\n")[0];
    passType = firstLine.replace("pass_type:", "").trim();
    // Strip the pass_type line from notes
    const rest = notes.split("\n").slice(1).join("\n").trim();
    notes = rest || null;
  }

  return {
    id: row.id,
    passType,
    fullName: row.visitorName,
    company: row.company ?? null,
    validFrom: row.expectedArrival?.toISOString() ?? new Date().toISOString(),
    validTo: row.expectedDeparture?.toISOString() ?? null,
    purpose: row.purposeOfVisit,
    status: displayPassStatus(row.status, row.expectedDeparture),
    requestedBy: null,
    approvedBy: row.approvedBy ?? null,
    propertyId: row.propertyId ?? null,
    unitId: row.unitId ?? null,
    notes,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ── GET /api/security/gate-passes ─────────────────────────────────────────────
router.get("/gate-passes", ...auth, async (req: any, res: any) => {
  try {
    // Landlords see passes for their own properties only, a guard for theirs only (this used to return the whole org).
    const propIds = await accessiblePropertyIds(req.user);
    if (propIds.length === 0) return res.json([]);

    // Previously unfiltered, so this returned every visitor in the org — including ordinary
    // Visitor Access entries with no gate pass ever created, mislabelled here as "visitor" type
    // gate passes just because that's mapToGatePass()'s fallback when the marker is absent.
    const rows = await db
      .select()
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(and(inArray(visitors.propertyId, propIds), like(visitors.notes, GATE_PASS_MARKER)))
      .orderBy(desc(visitors.createdAt));

    const passes = rows.map((r) => mapToGatePass(r.visitors));
    res.json(passes);
  } catch (err) {
    console.error("GET /api/security/gate-passes error:", err);
    res.status(500).json({ message: "Failed to fetch gate passes" });
  }
});

// ── POST /api/security/gate-passes ────────────────────────────────────────────
router.post("/gate-passes", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = req.user.id;
    const propIds = await accessiblePropertyIds(req.user);
    const {
      passType = "visitor",
      fullName,
      company,
      validFrom,
      validTo,
      purpose,
      propertyId,
      unitId,
      notes,
    } = req.body;

    if (!fullName?.trim()) {
      return res.status(400).json({ message: "fullName is required" });
    }
    if (!purpose?.trim()) {
      return res.status(400).json({ message: "purpose is required" });
    }
    if (!validTo) {
      return res.status(400).json({ message: "validTo is required" });
    }

    if (!["visitor", "contractor", "delivery", "service", "emergency", "vip"].includes(String(passType))) {
      return res.status(400).json({ message: "passType is not valid" });
    }
    const from = validFrom ? new Date(validFrom) : new Date();
    const to = new Date(validTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return res.status(400).json({ message: "validFrom / validTo are not valid dates" });
    if (to.getTime() <= from.getTime()) return res.status(400).json({ message: "A pass must end after it starts" });

    // Which property: the one asked for (must be one the caller may use), else their only/first one.
    let resolvedPropertyId: number | null = propertyId ? parseInt(propertyId) : null;
    if (resolvedPropertyId) {
      if (!propIds.includes(resolvedPropertyId)) return res.status(403).json({ message: "Property not found" });
    } else {
      if (req.user.role !== "guard" && propIds.length > 1) {
        return res.status(400).json({ message: "Choose which property this pass is for." });
      }
      resolvedPropertyId = propIds[0] ?? null;
      if (!resolvedPropertyId) return res.status(400).json({ message: "No property found for this organisation" });
    }
    let resolvedUnitId: number | null = null;
    if (unitId) {
      const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, parseInt(unitId)), eq(units.propertyId, resolvedPropertyId))).limit(1);
      if (!u) return res.status(404).json({ message: "That unit is not at this property" });
      resolvedUnitId = u.id;
    }

    // Encode passType in notes (first line) followed by any user notes
    const encodedNotes = notes?.trim()
      ? `pass_type:${passType}\n${notes.trim()}`
      : `pass_type:${passType}`;

    const [created] = await db
      .insert(visitors)
      .values({
        visitorName: fullName.trim(),
        company: company?.trim() || null,
        purposeOfVisit: purpose.trim(),
        expectedArrival: from,
        expectedDeparture: to,
        // A pass a manager (or landlord) writes themselves is approved; one raised by a guard waits for a manager.
        status: ["admin", "manager", "landlord"].includes(req.user.role) ? "approved" : "pending",
        approvedBy: ["admin", "manager", "landlord"].includes(req.user.role) && /^[0-9a-f-]{36}$/i.test(String(userId)) ? userId : null,
        approvedAt: ["admin", "manager", "landlord"].includes(req.user.role) ? new Date() : null,
        propertyId: resolvedPropertyId,
        unitId: resolvedUnitId,
        notes: encodedNotes,
        createdBy: userId ?? "00000000-0000-0000-0000-000000000000",
      } as any)
      .returning();

    res.status(201).json(mapToGatePass(created));
  } catch (err) {
    console.error("POST /api/security/gate-passes error:", err);
    res.status(500).json({ message: "Failed to create gate pass" });
  }
});

// ── PATCH /api/security/gate-passes/:id/status ────────────────────────────────
router.patch("/gate-passes/:id/status", ...auth, async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user);
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!status || !(PASS_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${PASS_STATUSES.join(", ")}` });
    }
    // A guard can turn a pass away or check one expired, but approving is the manager's call.
    if (req.user.role === "guard" && status === "approved") {
      return res.status(403).json({ message: "Only a manager can approve a gate pass." });
    }

    // Must be a real gate pass (not an ordinary visitor row) at a property this caller may use.
    const [existing] = await db
      .select({ id: visitors.id, status: visitors.status })
      .from(visitors)
      .where(and(eq(visitors.id, id), inArray(visitors.propertyId, propIds.length ? propIds : [-1]), like(visitors.notes, GATE_PASS_MARKER)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ message: "Gate pass not found" });
    }
    if (existing.status === "checked_in" || existing.status === "checked_out") {
      return res.status(409).json({ message: `This pass is already ${String(existing.status).replace("_", " ")} and can't be changed here.` });
    }

    const dbStatus = status === "revoked" ? "denied" : status;
    const [updated] = await db
      .update(visitors)
      .set({
        status: dbStatus as any, updatedAt: new Date(),
        ...(status === "approved" ? { approvedBy: /^[0-9a-f-]{36}$/i.test(String(req.user.id)) ? req.user.id : null, approvedAt: new Date() } : {}),
      } as any)
      .where(eq(visitors.id, id))
      .returning();

    res.json(mapToGatePass(updated));
  } catch (err) {
    console.error("PATCH /api/security/gate-passes/:id/status error:", err);
    res.status(500).json({ message: "Failed to update gate pass status" });
  }
});

export default router;