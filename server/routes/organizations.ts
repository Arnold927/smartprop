/**
 * organizations.ts — mounted at /api/organizations
 *
 * Allows an org admin to read and update their own organisation's settings
 * (name, currency, timezone, branding colours). This is what the
 * post-signup onboarding wizard and the org-management branding tab call.
 *
 * All writes are scoped to req.user.organizationId — admins can only
 * touch their own org, never another org's data.
 *
 * Endpoints:
 *   GET  /api/organizations/current      — return this org + its settings row
 *   POST /api/organizations              — create/update org settings (onboarding wizard)
 *   PATCH /api/organizations/branding    — update colours and white-label flag
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { organizations, organizationSettings } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Validation schemas ────────────────────────────────────────────────────────

const orgSettingsSchema = z.object({
  organizationName: z.string().min(2).max(255).optional(),
  defaultCurrency:  z.enum(["KES","USD","EUR","GBP","ZAR","NGN","GHS","UGX","TZS"]).optional(),
  timezone:         z.string().max(50).optional(),
  dateFormat:       z.string().max(20).optional(),
  language:         z.enum(["en","sw"]).optional(),
});

const brandingSchema = z.object({
  primaryColor:   z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a hex colour e.g. #3B82F6").optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a hex colour e.g. #EF4444").optional(),
  logo:           z.string().url().nullable().optional(),
  hideBranding:   z.boolean().optional(),
});

// ── GET /api/organizations/current ───────────────────────────────────────────

router.get("/current", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const [settings] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1);

    res.json({ ...org, settings: settings ?? null });
  } catch (err) {
    console.error("[orgs] GET /current error:", err);
    res.status(500).json({ message: "Failed to fetch organisation" });
  }
});

// ── POST /api/organizations — called by the onboarding wizard ─────────────────
// Updates the org name + creates/updates the settings row (currency, timezone…)

router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const parsed = orgSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    }

    const { organizationName, defaultCurrency, timezone, dateFormat, language } = parsed.data;

    // Update org name if provided
    if (organizationName) {
      await db
        .update(organizations)
        .set({ name: organizationName, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }

    // Upsert the settings row
    const settingsPayload: Record<string, any> = { organizationId: orgId };
    if (defaultCurrency) settingsPayload.defaultCurrency = defaultCurrency;
    if (timezone)        settingsPayload.timezone        = timezone;
    if (dateFormat)      settingsPayload.dateFormat       = dateFormat;
    if (language)        settingsPayload.language         = language;
    settingsPayload.updatedAt = new Date();

    const [existingSettings] = await db
      .select({ id: organizationSettings.id })
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1);

    if (existingSettings) {
      await db
        .update(organizationSettings)
        .set(settingsPayload)
        .where(eq(organizationSettings.organizationId, orgId));
    } else {
      await db.insert(organizationSettings).values(settingsPayload as any);
    }

    const [updatedOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const [updatedSettings] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1);

    res.json({ ...updatedOrg, settings: updatedSettings ?? null });
  } catch (err) {
    console.error("[orgs] POST / error:", err);
    res.status(500).json({ message: "Failed to update organisation settings" });
  }
});

// ── PATCH /api/organizations/branding ────────────────────────────────────────
// Called by the branding tab in org-management.tsx

router.patch("/branding", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const parsed = brandingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
    }

    const { primaryColor, secondaryColor, logo, hideBranding } = parsed.data;

    const orgUpdate: Record<string, any> = { updatedAt: new Date() };
    if (primaryColor   !== undefined) orgUpdate.primaryColor   = primaryColor;
    if (secondaryColor !== undefined) orgUpdate.secondaryColor = secondaryColor;
    if (logo           !== undefined) orgUpdate.logo           = logo;
    if (hideBranding   !== undefined) {
      // Store the white-label flag inside the existing whiteLabel jsonb column
      const [current] = await db
        .select({ whiteLabel: organizations.whiteLabel })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      orgUpdate.whiteLabel = { ...(current?.whiteLabel as object ?? {}), hideBranding };
    }

    await db.update(organizations).set(orgUpdate).where(eq(organizations.id, orgId));

    const [updated] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    res.json(updated);
  } catch (err) {
    console.error("[orgs] PATCH /branding error:", err);
    res.status(500).json({ message: "Failed to update branding" });
  }
});


export default router;