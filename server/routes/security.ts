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
import { eq, and, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

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
    status: row.status ?? "pending",
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
    const orgId: number = req.user.organizationId;

    const rows = await db
      .select()
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(eq(properties.organizationId, orgId))
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
    const orgId: number = req.user.organizationId;
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

    // Resolve which property to attach to. If none provided, use the first
    // property that belongs to this org (keeps the NOT NULL constraint happy).
    let resolvedPropertyId: number | null = propertyId ?? null;
    if (!resolvedPropertyId) {
      const [firstProp] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.organizationId, orgId))
        .limit(1);
      if (!firstProp) {
        return res.status(400).json({ message: "No property found for this organisation" });
      }
      resolvedPropertyId = firstProp.id;
    } else {
      // Verify the property belongs to this org
      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, resolvedPropertyId), eq(properties.organizationId, orgId)))
        .limit(1);
      if (!prop) {
        return res.status(403).json({ message: "Property not found" });
      }
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
        expectedArrival: new Date(validFrom || new Date()),
        expectedDeparture: new Date(validTo),
        status: "pending",
        propertyId: resolvedPropertyId,
        unitId: unitId ? parseInt(unitId) : null,
        notes: encodedNotes,
        createdBy: userId,
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
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: "status is required" });
    }

    // Verify the pass belongs to this org via the property join
    const [existing] = await db
      .select({ visitorId: visitors.id })
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(and(eq(visitors.id, id), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ message: "Gate pass not found" });
    }

    const [updated] = await db
      .update(visitors)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(visitors.id, id))
      .returning();

    res.json(mapToGatePass(updated));
  } catch (err) {
    console.error("PATCH /api/security/gate-passes/:id/status error:", err);
    res.status(500).json({ message: "Failed to update gate pass status" });
  }
});

export default router;