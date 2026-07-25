/**
 * server/routes/landlord-payment-config.ts
 *
 * Per-landlord payment settings — mounted at /api/payment-config/landlord.
 * Separate from the org-wide default in payment-config.ts: that stays the
 * fallback (and the only thing that matters for a single-landlord org, or
 * for properties with no specific owner). This file is for the
 * multi-landlord case, where each owner needs their own Paybill/Till.
 *
 * GET  /mine        — landlord fetches their own settings (or the empty
 *                      shape, if they haven't set anything up yet — in
 *                      which case their tenants are using the org default)
 * PUT  /mine         — landlord saves their own settings
 * GET  /             — admin/manager: list every landlord in the org and
 *                       whether each has configured their own settings
 * GET  /:ownerId      — admin/manager: view a specific landlord's settings
 * PUT  /:ownerId      — admin/manager: edit a specific landlord's settings
 *                        on their behalf (e.g. they gave the till number
 *                        over the phone)
 */

import { Router } from "express";
import { db } from "../db";
import { landlordPaymentSettings, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

const DEFAULT_ACCOUNT_SHAPE = {
  mpesaPaybill: "",
  mpesaTill: "",
  mpesaAccountName: "",
  bankName: "",
  bankAccountNumber: "",
  bankAccountName: "",
  bankBranch: "",
  instructions: "",
};

function emptyShape() {
  return {
    rentPayment: { useSingleAccount: true, ...DEFAULT_ACCOUNT_SHAPE },
    utilityPayment: { sameAsRent: true, ...DEFAULT_ACCOUNT_SHAPE },
  };
}

async function upsert(orgId: number, ownerId: string, rentPayment: any, utilityPayment: any) {
  const [existing] = await db
    .select({ id: landlordPaymentSettings.id })
    .from(landlordPaymentSettings)
    .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(landlordPaymentSettings)
      .set({ rentPayment, utilityPayment, updatedAt: new Date() })
      .where(eq(landlordPaymentSettings.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(landlordPaymentSettings)
    .values({ organizationId: orgId, ownerId, rentPayment, utilityPayment })
    .returning();
  return created;
}

// ── GET /mine — landlord's own settings ───────────────────────────────────────
router.get("/mine", async (req: any, res: any) => {
  try {
    if (req.user.role !== "landlord") {
      return res.status(403).json({ message: "This endpoint is for landlords. Use /api/payment-config for the org default." });
    }
    const orgId: number = req.user.organizationId;
    const [row] = await db
      .select()
      .from(landlordPaymentSettings)
      .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, req.user.id)))
      .limit(1);

    if (!row) {
      return res.json({ configured: false, ...emptyShape() });
    }
    return res.json({ configured: true, rentPayment: row.rentPayment, utilityPayment: row.utilityPayment });
  } catch (err) {
    console.error("[landlord-payment-config] GET /mine:", err);
    res.status(500).json({ message: "Failed to fetch payment settings" });
  }
});

// ── PUT /mine — landlord saves their own settings ─────────────────────────────
router.put("/mine", async (req: any, res: any) => {
  try {
    if (req.user.role !== "landlord") {
      return res.status(403).json({ message: "This endpoint is for landlords. Use /api/payment-config for the org default." });
    }
    const { rentPayment, utilityPayment } = req.body;
    if (!rentPayment) return res.status(400).json({ message: "rentPayment is required" });

    const updated = await upsert(req.user.organizationId, req.user.id, rentPayment, utilityPayment ?? null);
    return res.json({ success: true, rentPayment: updated.rentPayment, utilityPayment: updated.utilityPayment });
  } catch (err) {
    console.error("[landlord-payment-config] PUT /mine:", err);
    res.status(500).json({ message: "Failed to update payment settings" });
  }
});

// ── GET / — admin/manager: roster of landlords + configured status ───────────
router.get("/", async (req: any, res: any) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;

    const landlords = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.role, "landlord")));

    const configuredRows = await db
      .select({ ownerId: landlordPaymentSettings.ownerId })
      .from(landlordPaymentSettings)
      .where(eq(landlordPaymentSettings.organizationId, orgId));
    const configuredSet = new Set(configuredRows.map(r => r.ownerId));

    return res.json(
      landlords.map(l => ({ ...l, configured: configuredSet.has(l.id) }))
    );
  } catch (err) {
    console.error("[landlord-payment-config] GET /:", err);
    res.status(500).json({ message: "Failed to fetch landlords" });
  }
});

// ── GET /:ownerId — admin/manager view a specific landlord's settings ────────
router.get("/:ownerId", async (req: any, res: any) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const { ownerId } = req.params;

    const [landlord] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
    if (!landlord) return res.status(404).json({ message: "Landlord not found in your organisation" });

    const [row] = await db
      .select()
      .from(landlordPaymentSettings)
      .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)))
      .limit(1);

    if (!row) return res.json({ configured: false, ...emptyShape() });
    return res.json({ configured: true, rentPayment: row.rentPayment, utilityPayment: row.utilityPayment });
  } catch (err) {
    console.error("[landlord-payment-config] GET /:ownerId:", err);
    res.status(500).json({ message: "Failed to fetch payment settings" });
  }
});

// ── PUT /:ownerId — admin/manager edit on a landlord's behalf ────────────────
router.put("/:ownerId", async (req: any, res: any) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const { ownerId } = req.params;
    const { rentPayment, utilityPayment } = req.body;
    if (!rentPayment) return res.status(400).json({ message: "rentPayment is required" });

    const [landlord] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
    if (!landlord) return res.status(404).json({ message: "Landlord not found in your organisation" });

    const updated = await upsert(orgId, ownerId, rentPayment, utilityPayment ?? null);
    return res.json({ success: true, rentPayment: updated.rentPayment, utilityPayment: updated.utilityPayment });
  } catch (err) {
    console.error("[landlord-payment-config] PUT /:ownerId:", err);
    res.status(500).json({ message: "Failed to update payment settings" });
  }
});

export default router;