/**
 * server/routes/external-landlords.ts
 *
 * Manages landlords who don't (and may never) have a user account in the
 * system — a genuinely common real-world case, not an edge case: management
 * companies frequently handle owners who never log into anything
 * themselves. Properties link to one of these via
 * properties.externalLandlordId instead of properties.ownerId.
 *
 * Mirrors landlord-payment-config.ts closely: same rentPayment/utilityPayment
 * display-info shape, same encrypted Daraja credential fields, same
 * restriction (credentials specifically require admin/platform_admin, not
 * manager — display info and basic contact details remain manager-editable).
 */

import { Router } from "express";
import { db } from "../db";
import { externalLandlords, properties } from "@shared/schema";
import { eq, and, count } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { encryptSecret, decryptSecret, maskSecret, encryptionConfigured } from "../utils/credentialEncryption";
import { createMPesaServiceForOverrides } from "../services/mpesa";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

const DEFAULT_ACCOUNT_SHAPE = {
  mpesaPaybill: "", mpesaTill: "", mpesaAccountName: "",
  bankName: "", bankAccountNumber: "", bankAccountName: "", bankBranch: "",
  instructions: "",
};

function credentialsStatus(row: {
  mpesaConsumerKey: string | null;
  mpesaConsumerSecretEncrypted: string | null;
  mpesaPasskeyEncrypted: string | null;
  mpesaEnvironment: string | null;
  stkPushVerifiedAt: Date | null;
} | undefined) {
  if (!row || !row.mpesaConsumerKey || !row.mpesaConsumerSecretEncrypted || !row.mpesaPasskeyEncrypted) {
    return { configured: false, environment: "production", verified: false, consumerKeyMasked: null };
  }
  return {
    configured: true,
    environment: row.mpesaEnvironment ?? "production",
    verified: !!row.stkPushVerifiedAt,
    verifiedAt: row.stkPushVerifiedAt,
    consumerKeyMasked: maskSecret(row.mpesaConsumerKey),
  };
}

// ── GET / — list every external landlord in the org, with property counts ────
router.get("/", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select({
        id: externalLandlords.id,
        name: externalLandlords.name,
        phone: externalLandlords.phone,
        email: externalLandlords.email,
        mpesaConsumerKey: externalLandlords.mpesaConsumerKey,
        mpesaConsumerSecretEncrypted: externalLandlords.mpesaConsumerSecretEncrypted,
        mpesaPasskeyEncrypted: externalLandlords.mpesaPasskeyEncrypted,
        mpesaEnvironment: externalLandlords.mpesaEnvironment,
        stkPushVerifiedAt: externalLandlords.stkPushVerifiedAt,
        propertyCount: count(properties.id),
      })
      .from(externalLandlords)
      .leftJoin(properties, eq(properties.externalLandlordId, externalLandlords.id))
      .where(eq(externalLandlords.organizationId, orgId))
      .groupBy(externalLandlords.id);

    res.json(rows.map(r => ({
      id: r.id, name: r.name, phone: r.phone, email: r.email,
      propertyCount: Number(r.propertyCount),
      mpesaCredentials: credentialsStatus(r),
    })));
  } catch (err) {
    console.error("[external-landlords] GET /:", err);
    res.status(500).json({ message: "Failed to fetch external landlords" });
  }
});

// ── GET /:id — full settings for one external landlord ────────────────────────
router.get("/:id", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const [row] = await db.select().from(externalLandlords)
      .where(and(eq(externalLandlords.id, parseInt(req.params.id)), eq(externalLandlords.organizationId, orgId)))
      .limit(1);
    if (!row) return res.status(404).json({ message: "External landlord not found in your organisation" });

    res.json({
      id: row.id, name: row.name, phone: row.phone, email: row.email, notes: row.notes,
      rentPayment: row.rentPayment ?? { useSingleAccount: true, ...DEFAULT_ACCOUNT_SHAPE },
      utilityPayment: row.utilityPayment ?? { sameAsRent: true, ...DEFAULT_ACCOUNT_SHAPE },
      mpesaCredentials: credentialsStatus(row),
    });
  } catch (err) {
    console.error("[external-landlords] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch external landlord" });
  }
});

// ── POST / — create a new external landlord (contact details only) ───────────
router.post("/", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const { name, phone, email, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "name is required" });

    const [created] = await db.insert(externalLandlords).values({
      organizationId: req.user.organizationId,
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      notes: notes?.trim() || null,
    }).returning();

    res.status(201).json({ id: created.id, name: created.name, phone: created.phone, email: created.email });
  } catch (err) {
    console.error("[external-landlords] POST /:", err);
    res.status(500).json({ message: "Failed to create external landlord" });
  }
});

// ── PUT /:id — update contact/display/payment info; credentials gated separately ──
router.put("/:id", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const { name, phone, email, notes, rentPayment, utilityPayment, mpesaCredentials } = req.body;

    // Same restriction as landlord-payment-config.ts and payment-config.ts —
    // manager can edit contact info and the regular Paybill/Till display
    // fields, but Daraja API credentials specifically require admin/platform_admin.
    if (mpesaCredentials && !["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only an admin or platform admin can set Daraja API credentials." });
    }
    if (mpesaCredentials && (mpesaCredentials.consumerSecret || mpesaCredentials.passkey) && !encryptionConfigured()) {
      return res.status(503).json({ message: "Credential storage isn't configured on this server yet. Contact your platform administrator." });
    }

    const [existing] = await db.select({ id: externalLandlords.id }).from(externalLandlords)
      .where(and(eq(externalLandlords.id, id), eq(externalLandlords.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "External landlord not found in your organisation" });

    const credFields: Record<string, any> = {};
    if (mpesaCredentials?.consumerKey?.trim())    credFields.mpesaConsumerKey = mpesaCredentials.consumerKey.trim();
    if (mpesaCredentials?.consumerSecret?.trim()) credFields.mpesaConsumerSecretEncrypted = encryptSecret(mpesaCredentials.consumerSecret.trim());
    if (mpesaCredentials?.passkey?.trim())        credFields.mpesaPasskeyEncrypted = encryptSecret(mpesaCredentials.passkey.trim());
    if (mpesaCredentials?.environment)            credFields.mpesaEnvironment = mpesaCredentials.environment;
    if (Object.keys(credFields).length > 0)       credFields.stkPushVerifiedAt = null;

    const [updated] = await db.update(externalLandlords)
      .set({
        ...(name?.trim() ? { name: name.trim() } : {}),
        // Only touch phone/email/notes if explicitly included in this
        // request — previously this always overwrote them (to null if
        // omitted), which would silently wipe contact info on a
        // payment-info-only save from the payment settings panel.
        ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(rentPayment ? { rentPayment } : {}),
        ...(utilityPayment ? { utilityPayment } : {}),
        ...credFields,
        updatedAt: new Date(),
      })
      .where(eq(externalLandlords.id, id))
      .returning();

    res.json({
      id: updated.id, name: updated.name, phone: updated.phone, email: updated.email,
      rentPayment: updated.rentPayment, utilityPayment: updated.utilityPayment,
      mpesaCredentials: credentialsStatus(updated),
    });
  } catch (err) {
    console.error("[external-landlords] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update external landlord" });
  }
});

// ── DELETE /:id — only if no properties still reference it ───────────────────
router.delete("/:id", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [existing] = await db.select({ id: externalLandlords.id }).from(externalLandlords)
      .where(and(eq(externalLandlords.id, id), eq(externalLandlords.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "External landlord not found in your organisation" });

    const [{ value: linkedCount }] = await db.select({ value: count() }).from(properties).where(eq(properties.externalLandlordId, id));
    if (Number(linkedCount) > 0) {
      return res.status(409).json({ message: `${linkedCount} propert${Number(linkedCount) === 1 ? "y is" : "ies are"} still assigned to this landlord — reassign them first.` });
    }

    await db.delete(externalLandlords).where(eq(externalLandlords.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("[external-landlords] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete external landlord" });
  }
});

// ── POST /:id/test-stk — admin/platform_admin only, credentials-only endpoint ─
router.post("/:id/test-stk", async (req: any, res: any) => {
  try {
    if (!["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const { phoneNumber } = req.body;
    if (!phoneNumber?.trim()) return res.status(400).json({ message: "phoneNumber is required to send the test prompt" });

    const [row] = await db.select().from(externalLandlords)
      .where(and(eq(externalLandlords.id, id), eq(externalLandlords.organizationId, orgId))).limit(1);
    if (!row) return res.status(404).json({ message: "External landlord not found in your organisation" });
    if (!row.mpesaConsumerKey || !row.mpesaConsumerSecretEncrypted || !row.mpesaPasskeyEncrypted) {
      return res.status(400).json({ message: "Save consumer key, consumer secret, and passkey first." });
    }
    const shortCode = (row.rentPayment as any)?.mpesaPaybill || (row.rentPayment as any)?.mpesaTill;
    if (!shortCode) return res.status(400).json({ message: "Save a Paybill or Till number first — the passkey must match it." });

    const service = createMPesaServiceForOverrides({
      consumerKey: row.mpesaConsumerKey,
      consumerSecret: decryptSecret(row.mpesaConsumerSecretEncrypted),
      passkey: decryptSecret(row.mpesaPasskeyEncrypted),
      businessShortCode: shortCode,
      environment: (row.mpesaEnvironment as "sandbox" | "production") ?? "production",
    });
    if (!service) return res.status(500).json({ message: "Could not build a service instance from the saved credentials." });

    await service.initiateSTKPush({ phoneNumber, amount: 1, accountReference: "TEST", transactionDesc: "Setup test" });

    await db.update(externalLandlords).set({ stkPushVerifiedAt: new Date() }).where(eq(externalLandlords.id, id));
    res.json({ success: true, message: "Test prompt sent — check the phone number entered. Credentials are working." });
  } catch (err: any) {
    console.error("[external-landlords] POST /:id/test-stk:", err);
    res.status(400).json({
      message: "Safaricom rejected the test prompt — double check the consumer key, consumer secret, passkey, and shortcode are all for the same Paybill/Till.",
      detail: err?.message,
    });
  }
});

export default router;