/**
 * Broadcast Messages router — mounted at /api/broadcast-messages  (admin and manager)
 *
 * GET    /                  — broadcasts for the org, newest first
 * GET    /templates         — communication templates
 * POST   /templates         — create a template
 * DELETE /templates/:id     — retire a template
 * GET    /:id               — one broadcast with per-recipient delivery
 * POST   /                  — send now, or schedule for later
 * PATCH  /:id/cancel        — call off a scheduled broadcast
 *
 * Recipient resolution and delivery live in services/broadcast-dispatch.ts so the scheduler uses the same code.
 */
import { Router } from "express";
import { db } from "../db";
import { broadcastMessages, broadcastRecipients, communicationTemplates } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { resolveRecipients, runBroadcast, MAX_RECIPIENTS } from "../services/broadcast-dispatch";
import { z } from "zod";

const router = Router();

/** Admins and managers send broadcasts. (This used to be admin-only, which contradicted the route policy and locked managers out.) */
const requireSender = (req: any, res: any, next: any) => {
  if (["admin", "manager", "platform_admin"].includes(req.user?.role)) return next();
  return res.status(403).json({ message: "Only admins and managers can send broadcasts" });
};

const createBroadcastSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(150),
  content: z.string().trim().min(1, "Content is required").max(2000),
  audienceType: z.enum(["all_tenants", "all_landlords", "all_users", "specific_properties", "specific_roles", "custom_filter"]),
  broadcastMedium: z.array(z.enum(["app_notification", "email", "sms", "whatsapp"])).min(1, "At least one channel is required").transform(a => [...new Set(a)]),
  scheduledFor: z.string().nullable().optional(),
  audienceFilter: z.object({
    roles: z.array(z.string()).optional(),
    propertyIds: z.array(z.number().int()).optional(),
    tenantIds: z.array(z.number().int()).optional(),
  }).passthrough().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(["rent_reminder", "maintenance_update", "announcement", "welcome", "marketing", "emergency", "custom"]),
  medium: z.array(z.string()).min(1),
  subject: z.string().max(150).optional(),
  content: z.string().trim().min(1).max(2000),
  variables: z.record(z.any()).optional(),
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const rows = await db.select().from(broadcastMessages)
      .where(eq(broadcastMessages.organizationId, req.user.organizationId))
      .orderBy(desc(broadcastMessages.createdAt)).limit(300);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/broadcast-messages error:", err);
    res.status(500).json({ message: "Failed to fetch broadcast messages" });
  }
});

// ── Templates (declared before /:id so "templates" is not read as an id — it used to 500) ──
router.get("/templates", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const rows = await db.select().from(communicationTemplates)
      .where(and(eq(communicationTemplates.organizationId, req.user.organizationId), eq(communicationTemplates.isActive, true)))
      .orderBy(communicationTemplates.createdAt);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/broadcast-messages/templates error:", err);
    res.status(500).json({ message: "Failed to fetch templates" });
  }
});

router.post("/templates", authenticateJWT, requireOrg, requireSender, auditLog("communication_template", "CREATE"), async (req: any, res) => {
  try {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
    const [template] = await db.insert(communicationTemplates).values({
      ...parsed.data, organizationId: req.user.organizationId, createdBy: String(req.user.userId || req.user.id), isActive: true,
    }).returning();
    res.status(201).json(template);
  } catch (err) {
    console.error("POST /api/broadcast-messages/templates error:", err);
    res.status(500).json({ message: "Failed to create template" });
  }
});

router.delete("/templates/:id(\\d+)", authenticateJWT, requireOrg, requireSender, auditLog("communication_template", "DELETE"), async (req: any, res) => {
  try {
    const done = await db.update(communicationTemplates).set({ isActive: false })
      .where(and(eq(communicationTemplates.id, parseInt(req.params.id)), eq(communicationTemplates.organizationId, req.user.organizationId))).returning({ id: communicationTemplates.id });
    if (!done.length) return res.status(404).json({ message: "Template not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE template error:", err);
    res.status(500).json({ message: "Failed to remove template" });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id(\\d+)", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [broadcast] = await db.select().from(broadcastMessages)
      .where(and(eq(broadcastMessages.id, id), eq(broadcastMessages.organizationId, req.user.organizationId))).limit(1);
    if (!broadcast) return res.status(404).json({ message: "Broadcast not found" });
    const recipients = await db.select().from(broadcastRecipients).where(eq(broadcastRecipients.broadcastId, id)).limit(2000);
    res.json({ ...broadcast, recipients });
  } catch (err) {
    console.error("GET /api/broadcast-messages/:id error:", err);
    res.status(500).json({ message: "Failed to fetch broadcast" });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", authenticateJWT, requireOrg, requireSender, auditLog("broadcast_message", "CREATE"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const userId = String(req.user.userId || req.user.id);

    const parsed = createBroadcastSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
    const { title, content, audienceType, broadcastMedium, scheduledFor, audienceFilter } = parsed.data;

    let when: Date | null = null;
    if (scheduledFor) {
      when = new Date(scheduledFor);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ message: "scheduledFor is not a valid date" });
      if (when.getTime() < Date.now() + 30_000) return res.status(400).json({ message: "Pick a time in the future to schedule a broadcast" });
    }

    const recipients = await resolveRecipients(audienceType, orgId, audienceFilter);
    if (recipients.length === 0) return res.status(400).json({ message: "No one matches this audience, so nothing would be sent", code: "NO_RECIPIENTS" });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ message: `This audience has ${recipients.length} people; the limit is ${MAX_RECIPIENTS} per broadcast`, code: "TOO_MANY_RECIPIENTS" });

    const [broadcast] = await db.insert(broadcastMessages).values({
      title, content, senderUserId: userId, organizationId: orgId, audienceType: audienceType as any,
      audienceFilter: audienceFilter ?? null, broadcastMedium: broadcastMedium as any,
      scheduledFor: when, status: (when ? "scheduled" : "sending") as any,
      totalRecipients: recipients.length, sentCount: 0, failedCount: 0,
    }).returning();

    if (when) return res.status(201).json(broadcast);

    const result = await runBroadcast(broadcast);
    const warnings = result.notConfigured.map(c => `${c.replace("_", " ")} is not set up for this organisation, so nobody received it that way`);
    res.status(201).json({ ...result.broadcast, skippedCount: result.skippedCount, warnings });
  } catch (err) {
    console.error("POST /api/broadcast-messages error:", err);
    res.status(500).json({ message: "Failed to create broadcast message" });
  }
});

// ── PATCH /:id/cancel ─────────────────────────────────────────────────────────
router.patch("/:id(\\d+)/cancel", authenticateJWT, requireOrg, requireSender, auditLog("broadcast_message", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [mine] = await db.select({ id: broadcastMessages.id }).from(broadcastMessages)
      .where(and(eq(broadcastMessages.id, id), eq(broadcastMessages.organizationId, req.user.organizationId))).limit(1);
    if (!mine) return res.status(404).json({ message: "Broadcast not found" });
    const done = await db.update(broadcastMessages).set({ status: "cancelled" as any, updatedAt: new Date() })
      .where(and(eq(broadcastMessages.id, id), eq(broadcastMessages.status, "scheduled" as any))).returning();
    if (!done.length) return res.status(409).json({ message: "Only a scheduled broadcast that has not gone out can be cancelled" });
    res.json(done[0]);
  } catch (err) {
    console.error("Cancel broadcast error:", err);
    res.status(500).json({ message: "Failed to cancel broadcast" });
  }
});

export default router;
