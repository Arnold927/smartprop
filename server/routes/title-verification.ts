/**
 * title-verification.ts — mounted at /api/title-verification
 *
 * POST /api/title-verification/lookup
 *   Body: { titleNumber: string, county?: string, propertyId?: number }
 *   → Calls Ardhisasa, returns a TitleVerificationResult.
 *   → If propertyId is supplied, persists the result into properties.siteSettings
 *     so it survives page refreshes and powers the badge on the listing page.
 *
 * GET  /api/title-verification/:propertyId
 *   → Returns the cached verification result for a property (from siteSettings).
 *
 * Auth: authenticateJWT + requireOrg on both routes.
 * Rate-limit: 10 requests per minute per org (protects the upstream API).
 */

import { Router } from "express";
import { db }     from "../db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { verifyTitleDeed, isArdhisasaConfigured } from "../services/ardhisasaService";

export const titleVerificationRouter = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Naive per-org rate limiter (10 req / 60 s) ───────────────────────────────
const rateBuckets = new Map<number, { count: number; resetAt: number }>();

function checkRateLimit(orgId: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(orgId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(orgId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 10) return false;
  bucket.count++;
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/title-verification/lookup
// ══════════════════════════════════════════════════════════════════════════════
titleVerificationRouter.post("/lookup", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    if (!checkRateLimit(orgId)) {
      return res.status(429).json({
        message: "Too many verification requests. Please wait a minute and try again.",
      });
    }

    const { titleNumber, county, propertyId } = req.body;

    if (!titleNumber?.trim()) {
      return res.status(400).json({ message: "titleNumber is required" });
    }

    // Call Ardhisasa (or sandbox)
    const result = await verifyTitleDeed(titleNumber.trim(), county?.trim());

    // Optionally persist result to the property's siteSettings so the badge
    // is visible everywhere without another API call.
    if (propertyId) {
      const pid = parseInt(propertyId);
      if (!isNaN(pid)) {
        // Fetch the property first to make sure it belongs to this org
        const [prop] = await db
          .select({ id: properties.id, siteSettings: properties.siteSettings })
          .from(properties)
          .where(and(eq(properties.id, pid), eq(properties.organizationId, orgId)))
          .limit(1);

        if (prop) {
          const currentSettings = (prop.siteSettings as any) ?? {};
          await db
            .update(properties)
            .set({
              siteSettings: {
                ...currentSettings,
                titleVerification: {
                  titleNumber:       result.titleNumber,
                  status:            result.status,
                  verifiedAt:        result.verifiedAt,
                  registeredOwner:   result.registeredOwner,
                  parcelNumber:      result.parcelNumber,
                  registrationDate:  result.registrationDate,
                  landUse:           result.landUse,
                  area:              result.area,
                  county:            result.county,
                  locality:          result.locality,
                  encumbrances:      result.encumbrances,
                  message:           result.message,
                  isSandbox:         result.isSandbox,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(properties.id, pid));
        }
      }
    }

    res.json({
      result,
      isLive: isArdhisasaConfigured(),
    });
  } catch (err: any) {
    console.error("[TitleVerification] lookup error:", err);
    res.status(500).json({ message: err.message ?? "Verification failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/title-verification/:propertyId
// Returns cached result from siteSettings — no fresh API call.
// ══════════════════════════════════════════════════════════════════════════════
titleVerificationRouter.get("/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const orgId:      number = req.user.organizationId;
    const propertyId: number = parseInt(req.params.propertyId);

    if (isNaN(propertyId)) {
      return res.status(400).json({ message: "Invalid propertyId" });
    }

    const [prop] = await db
      .select({ siteSettings: properties.siteSettings })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) {
      return res.status(404).json({ message: "Property not found" });
    }

    const tv = (prop.siteSettings as any)?.titleVerification ?? null;
    res.json({
      titleVerification: tv,
      isLive: isArdhisasaConfigured(),
    });
  } catch (err: any) {
    console.error("[TitleVerification] GET error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/title-verification/status   (quick config check, no auth needed)
// Used by the frontend to show "Live" vs "Sandbox" badge next to the button.
// ══════════════════════════════════════════════════════════════════════════════
titleVerificationRouter.get("/status", (req: any, res: any) => {
  res.json({ isLive: isArdhisasaConfigured() });
});
