/**
 * server/routes/payment-config.ts
 *
 * Payment configuration routes — lets admins configure which accounts
 * tenants should use to pay rent vs utility bills.
 *
 * Payment details are stored inside organizationSettings.paymentSettings JSON,
 * so no new DB migration is needed.
 *
 * GET  /api/payment-config        → fetch org payment config
 * PUT  /api/payment-config        → update org payment config
 * GET  /api/payment-config/public → tenant-accessible version (no auth token required beyond JWT)
 */

import { Router } from "express";
import { db } from "../db.js";
import { organizationSettings, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth.js";
import { requireOrg } from "../middleware/requireOrg.js";
import { resolvePaymentConfigForTenantUser } from "../utils/resolvePaymentConfig";
import { encryptSecret, decryptSecret, maskSecret, encryptionConfigured } from "../utils/credentialEncryption";
import { createMPesaServiceForOverrides } from "../services/mpesa";

export const paymentConfigRouter = Router();

// All routes require login
paymentConfigRouter.use(authenticateJWT as any);

/** Never return raw secrets — mirrors the same helper in
 *  landlord-payment-config.ts for the per-landlord case. */
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateOrgSettings(orgId: number) {
  let [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  if (!settings) {
    [settings] = await db
      .insert(organizationSettings)
      .values({ organizationId: orgId })
      .returning();
  }
  return settings;
}

// ── GET /api/payment-config ───────────────────────────────────────────────────
paymentConfigRouter.get("/", requireOrg as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const settings = await getOrCreateOrgSettings(orgId);

    // Get org name too
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const paymentSettings = (settings.paymentSettings as any) ?? {};

    // Expose the server-configured shortcode so the admin UI can prefill
    // the Paybill/Till fields with the value the server is actually using.
    // This makes it immediately obvious if the UI and server are out of sync.
    const serverShortcode = process.env.MPESA_BUSINESS_SHORTCODE ?? "";

    return res.json({
      orgName: org?.name ?? "",
      serverShortcode,
      rentPayment: paymentSettings.rentPayment ?? {
        useSingleAccount: true,
        mpesaPaybill: serverShortcode, // prefill from .env on first setup
        mpesaTill: "",
        mpesaAccountName: "",
        bankName: "",
        bankAccountNumber: "",
        bankAccountName: "",
        bankBranch: "",
        instructions: "",
      },
      utilityPayment: paymentSettings.utilityPayment ?? {
        sameAsRent: true,
        mpesaPaybill: serverShortcode, // prefill from .env on first setup
        mpesaTill: "",
        mpesaAccountName: "",
        bankName: "",
        bankAccountNumber: "",
        bankAccountName: "",
        bankBranch: "",
        instructions: "",
      },
      mpesaCredentials: credentialsStatus(settings),
    });
  } catch (err) {
    console.error("[payment-config] GET /:", err);
    return res.status(500).json({ message: "Failed to fetch payment config" });
  }
});

// ── PUT /api/payment-config ───────────────────────────────────────────────────
paymentConfigRouter.put("/", requireOrg as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { rentPayment, utilityPayment, mpesaCredentials } = req.body;

    if (!rentPayment) {
      return res.status(400).json({ message: "rentPayment is required" });
    }

    // Daraja credentials (consumer key/secret/passkey) are restricted to
    // admin/manager/platform_admin even though staff can edit the regular
    // Paybill/Till display fields via this same route — same reasoning as
    // the per-landlord case: these are API secrets, not display data.
    if (mpesaCredentials && !["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only an admin, manager, or platform admin can set Daraja API credentials." });
    }
    if (mpesaCredentials && (mpesaCredentials.consumerSecret || mpesaCredentials.passkey) && !encryptionConfigured()) {
      return res.status(503).json({ message: "Credential storage isn't configured on this server yet. Contact your platform administrator." });
    }

    const existing = await getOrCreateOrgSettings(orgId);
    const existingSettings = (existing.paymentSettings as any) ?? {};

    const updated = {
      ...existingSettings,
      rentPayment,
      utilityPayment: utilityPayment ?? existingSettings.utilityPayment,
    };

    // Only touch credential columns if new ones were actually sent — never
    // overwrite a saved passkey/secret just because a display-info-only
    // save didn't include them.
    const credFields: Record<string, any> = {};
    if (mpesaCredentials?.consumerKey?.trim())    credFields.mpesaConsumerKey = mpesaCredentials.consumerKey.trim();
    if (mpesaCredentials?.consumerSecret?.trim()) credFields.mpesaConsumerSecretEncrypted = encryptSecret(mpesaCredentials.consumerSecret.trim());
    if (mpesaCredentials?.passkey?.trim())        credFields.mpesaPasskeyEncrypted = encryptSecret(mpesaCredentials.passkey.trim());
    if (mpesaCredentials?.environment)            credFields.mpesaEnvironment = mpesaCredentials.environment;
    if (Object.keys(credFields).length > 0)       credFields.stkPushVerifiedAt = null; // credential change invalidates prior verification

    const [saved] = await db
      .update(organizationSettings)
      .set({ paymentSettings: updated, ...credFields, updatedAt: new Date() })
      .where(eq(organizationSettings.organizationId, orgId))
      .returning();

    return res.json({
      success: true,
      paymentSettings: updated,
      mpesaCredentials: credentialsStatus(saved),
    });
  } catch (err) {
    console.error("[payment-config] PUT /:", err);
    return res.status(500).json({ message: "Failed to update payment config" });
  }
});

// ── POST /api/payment-config/test-stk — verify org-level credentials ─────────
paymentConfigRouter.post("/test-stk", requireOrg as any, async (req: any, res: any) => {
  try {
    if (!["admin", "platform_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not permitted." });
    }
    const orgId: number = req.user.organizationId;
    const { phoneNumber } = req.body;
    if (!phoneNumber?.trim()) return res.status(400).json({ message: "phoneNumber is required to send the test prompt" });

    const settings = await getOrCreateOrgSettings(orgId);
    if (!settings.mpesaConsumerKey || !settings.mpesaConsumerSecretEncrypted || !settings.mpesaPasskeyEncrypted) {
      return res.status(400).json({ message: "Save consumer key, consumer secret, and passkey first." });
    }
    const paymentSettings = (settings.paymentSettings as any) ?? {};
    const shortCode = paymentSettings.rentPayment?.mpesaPaybill || paymentSettings.rentPayment?.mpesaTill;
    if (!shortCode) {
      return res.status(400).json({ message: "Save a Paybill or Till number first — the passkey must match it." });
    }

    const service = createMPesaServiceForOverrides({
      consumerKey: settings.mpesaConsumerKey,
      consumerSecret: decryptSecret(settings.mpesaConsumerSecretEncrypted),
      passkey: decryptSecret(settings.mpesaPasskeyEncrypted),
      businessShortCode: shortCode,
      environment: (settings.mpesaEnvironment as "sandbox" | "production") ?? "production",
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

    await db.update(organizationSettings)
      .set({ stkPushVerifiedAt: new Date() })
      .where(eq(organizationSettings.organizationId, orgId));

    res.json({ success: true, message: "Test prompt sent — check the phone number entered. Credentials are working." });
  } catch (err: any) {
    console.error("[payment-config] POST /test-stk:", err);
    res.status(400).json({
      message: "Safaricom rejected the test prompt — double check the consumer key, consumer secret, passkey, and shortcode are all for the same Paybill/Till.",
      detail: err?.message,
    });
  }
});

// ── GET /api/payment-config/public ───────────────────────────────────────────
// Tenant-accessible — resolves the CALLING tenant's own payment destination:
// their property's landlord override if one exists, else the org default.
// Previously this always returned the plain org-wide blob regardless of
// which landlord a tenant's property actually belongs to — fine for a
// single-landlord org, wrong for a multi-landlord one.
paymentConfigRouter.get("/public", async (req: any, res: any) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ message: "Unauthorized" });

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const resolved = await resolvePaymentConfigForTenantUser(req.user.id, orgId);

    return res.json({
      orgName: org?.name ?? "",
      rentPayment: resolved.rentPayment ?? null,
      utilityPayment: resolved.utilityPayment ?? null,
    });
  } catch (err) {
    console.error("[payment-config] GET /public:", err);
    return res.status(500).json({ message: "Failed to fetch payment config" });
  }
});