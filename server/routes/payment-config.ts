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

export const paymentConfigRouter = Router();

// All routes require login
paymentConfigRouter.use(authenticateJWT as any);

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
    const { rentPayment, utilityPayment } = req.body;

    if (!rentPayment) {
      return res.status(400).json({ message: "rentPayment is required" });
    }

    const existing = await getOrCreateOrgSettings(orgId);
    const existingSettings = (existing.paymentSettings as any) ?? {};

    const updated = {
      ...existingSettings,
      rentPayment,
      utilityPayment: utilityPayment ?? existingSettings.utilityPayment,
    };

    await db
      .update(organizationSettings)
      .set({ paymentSettings: updated })
      .where(eq(organizationSettings.organizationId, orgId));

    return res.json({ success: true, paymentSettings: updated });
  } catch (err) {
    console.error("[payment-config] PUT /:", err);
    return res.status(500).json({ message: "Failed to update payment config" });
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