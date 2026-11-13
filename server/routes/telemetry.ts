/**
 * server/routes/telemetry.ts
 *
 * Backs three client features that were calling endpoints which did not exist
 * (every dashboard load logged 404s):
 *   POST /api/user-activity          — activity-tracker.tsx (fire and forget)
 *   GET  /api/feature-announcements  — feature-announcement.tsx banner
 *   POST /api/feature-interactions   — viewed / dismissed / clicked on a banner
 *
 * All three are open to every authenticated role and only ever read or write
 * the caller's own organisation's rows.
 */

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { userActivity, featureAnnouncements, userFeatureInteractions } from "@shared/schema";
import { logger } from "../lib/logger";

const ACTIVITY_TYPES = [
  "login", "logout", "property_view", "tenant_action", "payment_made",
  "maintenance_request", "document_upload", "search", "report_generated",
] as const;

export const userActivityRouter = Router();

userActivityRouter.post("/", async (req: any, res) => {
  const body = req.body ?? {};
  // The activity_type column is a closed enum; anything else is accepted and
  // dropped so that a tracking call can never surface an error to the user.
  if (!ACTIVITY_TYPES.includes(body.activityType)) return res.status(202).json({ stored: false });

  try {
    const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : null);
    await db.insert(userActivity).values({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? null,
      sessionId: str(body.sessionId, 100),
      activityType: body.activityType,
      activityData: body.activityData && typeof body.activityData === "object" ? body.activityData : null,
      pageUrl: str(body.pageUrl),
      pagePath: str(body.pagePath),
      referrerUrl: str(body.referrerUrl),
      userAgent: str(req.get("user-agent"), 400),
      deviceType: str(body.deviceType, 20),
      duration: Number.isFinite(body.duration) ? Math.max(0, Math.trunc(body.duration)) : null,
      success: body.success !== false,
      errorMessage: str(body.errorMessage, 500),
    });
    return res.status(201).json({ stored: true });
  } catch (err) {
    logger.error("[telemetry] POST /user-activity:", err);
    return res.status(202).json({ stored: false });
  }
});

export const featureAnnouncementsRouter = Router();

featureAnnouncementsRouter.get("/", async (req: any, res) => {
  try {
    const orgId = req.user.organizationId ?? null;
    const role = req.user.role ?? "tenant";
    const rows = await db
      .select()
      .from(featureAnnouncements)
      .where(and(
        eq(featureAnnouncements.isActive, true),
        orgId == null ? isNull(featureAnnouncements.organizationId)
                      : or(isNull(featureAnnouncements.organizationId), eq(featureAnnouncements.organizationId, orgId)),
        or(isNull(featureAnnouncements.releaseDate), lte(featureAnnouncements.releaseDate, new Date())),
        or(
          isNull(featureAnnouncements.targetAudience),
          sql`${featureAnnouncements.targetAudience} @> ARRAY['all']::varchar[]`,
          sql`${featureAnnouncements.targetAudience} @> ARRAY[${role}]::varchar[]`,
        ),
      ))
      .orderBy(desc(featureAnnouncements.createdAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    logger.error("[telemetry] GET /feature-announcements:", err);
    res.status(500).json({ message: "Failed to load announcements" });
  }
});

export const featureInteractionsRouter = Router();

const interactionSchema = z.object({
  featureAnnouncementId: z.number().int().positive(),
  interactionType: z.enum(["viewed", "clicked", "dismissed", "liked", "shared", "feedback"]),
  interactionData: z.any().optional(),
  deviceType: z.string().max(20).optional(),
  sessionId: z.string().max(100).optional(),
});

featureInteractionsRouter.post("/", async (req: any, res) => {
  const parsed = interactionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  try {
    const orgId = req.user.organizationId ?? null;
    const [ann] = await db.select({ id: featureAnnouncements.id, organizationId: featureAnnouncements.organizationId })
      .from(featureAnnouncements).where(eq(featureAnnouncements.id, parsed.data.featureAnnouncementId)).limit(1);
    if (!ann || (ann.organizationId != null && ann.organizationId !== orgId)) {
      return res.status(404).json({ message: "Announcement not found" });
    }
    await db.insert(userFeatureInteractions).values({
      userId: req.user.id,
      featureAnnouncementId: ann.id,
      interactionType: parsed.data.interactionType,
      interactionData: parsed.data.interactionData ?? null,
      deviceType: parsed.data.deviceType ?? null,
      sessionId: parsed.data.sessionId ?? null,
    });
    res.status(201).json({ stored: true });
  } catch (err) {
    logger.error("[telemetry] POST /feature-interactions:", err);
    res.status(500).json({ message: "Failed to record interaction" });
  }
});
