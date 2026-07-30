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
import { encryptSecret, maskSecret, encryptionConfigured } from "../utils/credentialEncryption";
import { createMPesaServiceForOverrides } from "../services/mpesa";

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

/** Never return raw secrets — just enough for the UI to show "configured,
 *  ending in ****1234" without ever re-exposing the actual passkey/secret. */
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

async function upsert(orgId: number, ownerId: string, rentPayment: any, utilityPayment: any, mpesaCreds?: {
  consumerKey?: string; consumerSecret?: string; passkey?: string; environment?: string;
}) {
  const [existing] = await db
    .select({ id: landlordPaymentSettings.id })
    .from(landlordPaymentSettings)
    .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)))
    .limit(1);

  // Only touch credential fields if the caller actually sent new ones —
  // never overwrite a saved passkey/secret with blank just because a
  // display-info-only save didn't include them.
  const credFields: Record<string, any> = {};
  if (mpesaCreds?.consumerKey?.trim())    credFields.mpesaConsumerKey = mpesaCreds.consumerKey.trim();
  if (mpesaCreds?.consumerSecret?.trim()) credFields.mpesaConsumerSecretEncrypted = encryptSecret(mpesaCreds.consumerSecret.trim());
  if (mpesaCreds?.passkey?.trim())        credFields.mpesaPasskeyEncrypted = encryptSecret(mpesaCreds.passkey.trim());
  if (mpesaCreds?.environment)            credFields.mpesaEnvironment = mpesaCreds.environment;
  // Any credential change invalidates the previous verification — re-test required.
  if (Object.keys(credFields).length > 0) credFields.stkPushVerifiedAt = null;

  if (existing) {
    const [updated] = await db
      .update(landlordPaymentSettings)
      .set({ rentPayment, utilityPayment, ...credFields, updatedAt: new Date() })
      .where(eq(landlordPaymentSettings.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(landlordPaymentSettings)
    .values({ organizationId: orgId, ownerId, rentPayment, utilityPayment, ...credFields })
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
      return res.json({ configured: false, ...emptyShape(), mpesaCredentials: credentialsStatus(undefined) });
    }
    return res.json({
      configured: true,
      rentPayment: row.rentPayment,
      utilityPayment: row.utilityPayment,
      mpesaCredentials: credentialsStatus(row),
    });
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

    // Daraja credentials (consumer key/secret/passkey) are deliberately NOT
    // settable here — most landlords aren't going to know what those terms
    // even mean. That's handled entirely by admin/manager/platform_admin
    // on the landlord's behalf via PUT /:ownerId below. Ignored even if a
    // request somehow includes it, rather than trusting the frontend alone
    // to keep this hidden.
    const updated = await upsert(req.user.organizationId, req.user.id, rentPayment, utilityPayment ?? null);
    return res.json({
      success: true,
      rentPayment: updated.rentPayment,
      utilityPayment: updated.utilityPayment,
      mpesaCredentials: credentialsStatus(updated),
    });
  } catch (err) {
    console.error("[landlord-payment-config] PUT /mine:", err);
    res.status(500).json({ message: "Failed to update payment settings" });
  }
});

// ── GET / — admin/manager: roster of landlords + configured status ───────────
router.get("/", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
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
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
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

    if (!row) return res.json({ configured: false, ...emptyShape(), mpesaCredentials: credentialsStatus(undefined) });
    return res.json({
      configured: true,
      rentPayment: row.rentPayment,
      utilityPayment: row.utilityPayment,
      mpesaCredentials: credentialsStatus(row),
    });
  } catch (err) {
    console.error("[landlord-payment-config] GET /:ownerId:", err);
    res.status(500).json({ message: "Failed to fetch payment settings" });
  }
});

// ── PUT /:ownerId — admin/manager edit on a landlord's behalf ────────────────
router.put("/:ownerId", async (req: any, res: any) => {
  try {
    if (!["admin", "manager", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const { ownerId } = req.params;
    const { rentPayment, utilityPayment, mpesaCredentials } = req.body;
    if (!rentPayment) return res.status(400).json({ message: "rentPayment is required" });

    // Credentials specifically are narrower than the rest of this endpoint —
    // manager can still update a landlord's regular Paybill/Till/bank
    // display info, but Daraja API credentials are restricted to
    // admin/platform_admin, the same as the frontend now enforces.
    if (mpesaCredentials && !["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only an admin or platform admin can set Daraja API credentials." });
    }
    if (mpesaCredentials && (mpesaCredentials.consumerSecret || mpesaCredentials.passkey) && !encryptionConfigured()) {
      return res.status(503).json({ message: "Credential storage isn't configured on this server yet. Contact your platform administrator." });
    }

    const [landlord] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
    if (!landlord) return res.status(404).json({ message: "Landlord not found in your organisation" });

    const updated = await upsert(orgId, ownerId, rentPayment, utilityPayment ?? null, mpesaCredentials);
    return res.json({
      success: true,
      rentPayment: updated.rentPayment,
      utilityPayment: updated.utilityPayment,
      mpesaCredentials: credentialsStatus(updated),
    });
  } catch (err) {
    console.error("[landlord-payment-config] PUT /:ownerId:", err);
    res.status(500).json({ message: "Failed to update payment settings" });
  }
});

// ── POST /:ownerId/test-stk — admin/platform_admin test a specific landlord's credentials ──
// Restricted to admin/platform_admin only (not manager) — this endpoint is
// exclusively about credentials, unlike PUT /:ownerId above which also
// handles display info manager can still touch.
router.post("/:ownerId/test-stk", async (req: any, res: any) => {
  try {
    if (!["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const { ownerId } = req.params;
    const { phoneNumber } = req.body;
    if (!phoneNumber?.trim()) return res.status(400).json({ message: "phoneNumber is required to send the test prompt" });

    const [landlord] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
    if (!landlord) return res.status(404).json({ message: "Landlord not found in your organisation" });

    const [row] = await db
      .select({
        mpesaConsumerKey: landlordPaymentSettings.mpesaConsumerKey,
        mpesaConsumerSecretEncrypted: landlordPaymentSettings.mpesaConsumerSecretEncrypted,
        mpesaPasskeyEncrypted: landlordPaymentSettings.mpesaPasskeyEncrypted,
        mpesaEnvironment: landlordPaymentSettings.mpesaEnvironment,
        rentPayment: landlordPaymentSettings.rentPayment,
      })
      .from(landlordPaymentSettings)
      .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)))
      .limit(1);

    if (!row?.mpesaConsumerKey || !row.mpesaConsumerSecretEncrypted || !row.mpesaPasskeyEncrypted) {
      return res.status(400).json({ message: "This landlord hasn't saved consumer key, consumer secret, and passkey yet." });
    }
    const shortCode = (row.rentPayment as any)?.mpesaPaybill || (row.rentPayment as any)?.mpesaTill;
    if (!shortCode) {
      return res.status(400).json({ message: "Save a Paybill or Till number for this landlord first — the passkey must match it." });
    }

    const { decryptSecret } = await import("../utils/credentialEncryption");
    const service = createMPesaServiceForOverrides({
      consumerKey: row.mpesaConsumerKey,
      consumerSecret: decryptSecret(row.mpesaConsumerSecretEncrypted),
      passkey: decryptSecret(row.mpesaPasskeyEncrypted),
      businessShortCode: shortCode,
      environment: (row.mpesaEnvironment as "sandbox" | "production") ?? "production",
    });
    if (!service) {
      return res.status(500).json({ message: "Could not build a service instance from the saved credentials." });
    }

    await service.initiateSTKPush({
      phoneNumber,
      amount: 1,
      accountReference: "TEST",
      transactionDesc: "Setup test",
    });

    await db.update(landlordPaymentSettings)
      .set({ stkPushVerifiedAt: new Date() })
      .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)));

    res.json({ success: true, message: "Test prompt sent — check the phone number entered. Credentials are working." });
  } catch (err: any) {
    console.error("[landlord-payment-config] POST /:ownerId/test-stk:", err);
    res.status(400).json({
      message: "Safaricom rejected the test prompt — double check the consumer key, consumer secret, passkey, and shortcode are all for the same Paybill/Till.",
      detail: err?.message,
    });
  }
});

export default router;