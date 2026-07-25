/**
 * server/routes/utility-meter-readings.ts
 *
 * Utility Meter Readings — mounted at /api/utility-meter-readings
 *
 * The "Readings" tab in utility-management.tsx has always called these
 * endpoints, but no backend router ever implemented them even though the
 * `utility_meter_readings` table has existed in shared/schema.ts. This file
 * fills that gap.
 *
 *   GET    /       — list all meter readings (org-scoped)
 *   GET    /:id    — get a single reading
 *   POST   /       — record a new reading
 *   PUT    /:id    — update a reading (also used by the client to mark verified)
 *   DELETE /:id    — delete a reading
 */

import { Router } from "express";
import { db } from "../db.js";
import { utilityMeterReadings, utilityAccounts, properties } from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth.js";
import { requireOrg } from "../middleware/requireOrg.js";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// utility_meter_readings has no organizationId column of its own — scope via
// accountId → utilityAccounts.propertyId → properties.organizationId, the same
// pattern already used for utility bills elsewhere in utility-management.ts.
// For a landlord, further restrict to properties they actually own.
async function getOrgAccountIds(orgId: number, role: string, userId: string): Promise<number[]> {
  const propConditions = role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : eq(properties.organizationId, orgId);
  const orgProps = await db
    .select({ id: properties.id })
    .from(properties)
    .where(propConditions);
  const propIds = orgProps.map((p: any) => p.id);
  if (propIds.length === 0) return [];

  const orgAccounts = await db
    .select({ id: utilityAccounts.id })
    .from(utilityAccounts)
    .where(inArray(utilityAccounts.propertyId, propIds));
  return orgAccounts.map((a: any) => a.id);
}

// readBy is a uuid column, but the current EditReadingDialog form collects a
// free-text name (e.g. "John") rather than a user id. Coerce anything that
// isn't a real UUID to null instead of letting the insert/update fail with a
// Postgres invalid-syntax error. (The notes field still carries the readable
// name, if the caller sends one — see POST below.)
function safeUuid(id: string | undefined | null): string | null {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id) ? id : null;
}

router.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const accountIds = await getOrgAccountIds(orgId, req.user.role ?? "", req.user.id);
    const readings = accountIds.length > 0
      ? await db
          .select()
          .from(utilityMeterReadings)
          .where(inArray(utilityMeterReadings.accountId, accountIds))
          .orderBy(utilityMeterReadings.readingDate)
      : [];
    res.json(readings);
  } catch (err) {
    console.error("[utility-meter-readings] GET /:", err);
    res.status(500).json({ message: "Failed to fetch meter readings" });
  }
});

router.get("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [reading] = await db
      .select()
      .from(utilityMeterReadings)
      .where(eq(utilityMeterReadings.id, id))
      .limit(1);

    if (!reading) return res.status(404).json({ message: "Reading not found" });

    const accountIds = await getOrgAccountIds(orgId, req.user.role ?? "", req.user.id);
    if (!accountIds.includes(reading.accountId)) {
      return res.status(404).json({ message: "Reading not found" });
    }

    res.json(reading);
  } catch (err) {
    console.error("[utility-meter-readings] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch meter reading" });
  }
});

router.post("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { accountId, readingDate, reading, readingType, consumption, readBy, imageUrl, notes } = req.body;

    if (!accountId || !readingDate || reading === undefined || reading === null || reading === "") {
      return res.status(400).json({ message: "accountId, readingDate, and reading are required" });
    }

    // Verify the account belongs to the caller's org before allowing the insert.
    const accountIds = await getOrgAccountIds(orgId, req.user.role ?? "", req.user.id);
    if (!accountIds.includes(parseInt(accountId))) {
      return res.status(404).json({ message: "Utility account not found" });
    }

    const readByUuid = safeUuid(readBy);
    // Keep the human-entered name (when it isn't a real uuid) so it isn't
    // silently lost — append it to notes rather than dropping it.
    const combinedNotes = !readByUuid && readBy
      ? [notes, `Read by: ${readBy}`].filter(Boolean).join(" | ")
      : (notes || null);

    const [created] = await db
      .insert(utilityMeterReadings)
      .values({
        accountId: parseInt(accountId),
        readingDate: new Date(readingDate),
        reading: String(reading),
        readingType: readingType || "manual",
        consumption: consumption != null && consumption !== "" ? String(consumption) : null,
        readBy: readByUuid,
        imageUrl: imageUrl || null,
        notes: combinedNotes,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    console.error("[utility-meter-readings] POST /:", err);
    res.status(500).json({ message: "Failed to record meter reading" });
  }
});

router.put("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [existing] = await db
      .select()
      .from(utilityMeterReadings)
      .where(eq(utilityMeterReadings.id, id))
      .limit(1);

    const accountIds = await getOrgAccountIds(orgId, req.user.role ?? "", req.user.id);
    if (!existing || !accountIds.includes(existing.accountId)) {
      return res.status(404).json({ message: "Reading not found" });
    }

    const { accountId, readingDate, reading, readingType, consumption, readBy, imageUrl, notes, verified } = req.body;

    const [updated] = await db
      .update(utilityMeterReadings)
      .set({
        accountId: accountId ? parseInt(accountId) : undefined,
        readingDate: readingDate ? new Date(readingDate) : undefined,
        reading: reading !== undefined && reading !== null ? String(reading) : undefined,
        readingType,
        consumption: consumption != null && consumption !== "" ? String(consumption) : undefined,
        readBy: readBy !== undefined ? safeUuid(readBy) : undefined,
        imageUrl,
        notes,
        verified: verified !== undefined ? Boolean(verified) : undefined,
        verifiedBy: verified === true ? safeUuid(req.user.id) : undefined,
        verifiedAt: verified === true ? (new Date() as any) : undefined,
      })
      .where(eq(utilityMeterReadings.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("[utility-meter-readings] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update meter reading" });
  }
});

router.delete("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [existing] = await db
      .select()
      .from(utilityMeterReadings)
      .where(eq(utilityMeterReadings.id, id))
      .limit(1);

    const accountIds = await getOrgAccountIds(orgId, req.user.role ?? "", req.user.id);
    if (!existing || !accountIds.includes(existing.accountId)) {
      return res.status(404).json({ message: "Reading not found" });
    }

    await db.delete(utilityMeterReadings).where(eq(utilityMeterReadings.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[utility-meter-readings] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete meter reading" });
  }
});

export default router;