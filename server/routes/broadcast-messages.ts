/**
 * Broadcast Messages router — mounted at /api/broadcast-messages
 *
 * GET  /                 — list all broadcasts for the org
 * POST /                 — create + dispatch a new broadcast
 * GET  /:id              — single broadcast with recipient stats
 * GET  /templates        — list communication templates
 * POST /templates        — create a communication template
 *
 * Dispatch logic per channel:
 *   app_notification  → WebSocket push via emitToUser + store in broadcastRecipients
 *   email             → Resend via server/lib/email.ts
 *   sms               → Twilio via server/services/messaging.ts
 *   whatsapp          → WhatsApp Business API via server/whatsapp.ts
 */

import { Router } from "express";
import { db } from "../db";
import {
  broadcastMessages,
  broadcastRecipients,
  communicationTemplates,
  organizationSettings,
  users,
  units,
  tenants,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireAdmin } from "../middleware/authorization";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { emitToUser } from "../ws";
import { getMessagingService } from "../services/messaging";
import { whatsappService } from "../whatsapp";
import { z } from "zod";

const router = Router();

// ── Validation ────────────────────────────────────────────────────────────────

const createBroadcastSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  audienceType: z.enum([
    "all_tenants", "all_landlords", "all_users",
    "specific_properties", "specific_roles", "custom_filter",
  ]),
  broadcastMedium: z.array(z.enum([
    "app_notification", "email", "sms", "whatsapp",
  ])).min(1, "At least one channel is required"),
  scheduledFor: z.string().nullable().optional(),
  audienceFilter: z.record(z.any()).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  category: z.enum([
    "rent_reminder", "maintenance_update", "announcement",
    "welcome", "marketing", "emergency", "custom",
  ]),
  medium: z.array(z.string()).min(1),
  subject: z.string().optional(),
  content: z.string().min(1),
  variables: z.record(z.any()).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the list of recipient user rows for a given audienceType + org.
 * Returns { id, email, phone, firstName, lastName }[]
 */
async function resolveRecipients(
  audienceType: string,
  orgId: number,
  audienceFilter?: Record<string, any>
): Promise<{ id: string; email: string; phone: string | null; firstName: string | null; lastName: string | null; role: string | null }[]> {
  // Base: all active users in this org
  let rows = await db
    .select({
      id:        users.id,
      email:     users.email,
      phone:     users.phoneNumber,
      firstName: users.firstName,
      lastName:  users.lastName,
      role:      users.role,
    })
    .from(users)
    .where(eq(users.organizationId, orgId));

  switch (audienceType) {
    case "all_tenants":
      return rows.filter(u => u.role === "tenant");

    case "all_landlords":
      return rows.filter(u => u.role === "landlord");

    case "all_users":
      return rows;

    case "specific_roles": {
      const targetRoles: string[] = audienceFilter?.roles ?? [];
      return rows.filter(u => targetRoles.includes(u.role ?? ""));
    }

    case "specific_properties": {
      const propertyIds: number[] = audienceFilter?.propertyIds ?? [];
      if (propertyIds.length === 0) return [];
      // Find all unit IDs that belong to the specified properties, then
      // get the user IDs of tenants who are assigned to those units.
      const propertyUnits = await db
        .select({ id: units.id })
        .from(units)
        .where(inArray(units.propertyId, propertyIds));
      const unitIds = propertyUnits.map(u => u.id);
      if (unitIds.length === 0) return [];
      const propertyTenants = await db
        .select({ userId: tenants.userId })
        .from(tenants)
        .where(and(
          eq(tenants.organizationId, orgId),
          inArray(tenants.unitId, unitIds),
          eq(tenants.status, "active"),
        ));
      const tenantUserIds = new Set(propertyTenants.map(t => t.userId).filter(Boolean));
      return rows.filter(u => tenantUserIds.has(u.id));
    }

    case "custom_filter": {
      const roleFilter: string[] = audienceFilter?.roles ?? [];
      if (roleFilter.length > 0) {
        rows = rows.filter(u => roleFilter.includes(u.role ?? ""));
      }
      return rows;
    }

    default:
      return rows;
  }
}

/**
 * Dispatch a broadcast to a list of resolved recipients across all selected channels.
 * Returns { sentCount, failedCount, skippedCount }
 *
 * sentCount    — at least one channel delivered successfully
 * failedCount  — all channels were attempted but all threw errors
 * skippedCount — all selected channels were skipped because the recipient
 *                lacked the required contact info (no email, no phone, etc.)
 */
async function dispatchBroadcast(
  broadcastId: number,
  broadcast: { title: string; content: string; broadcastMedium: string[] },
  recipients: Awaited<ReturnType<typeof resolveRecipients>>,
  orgId: number,
  orgWhatsappSettings?: { phoneNumberId?: string; apiKey?: string }
): Promise<{ sentCount: number; failedCount: number; skippedCount: number }> {
  const messaging  = getMessagingService();
  let sentCount    = 0;
  let failedCount  = 0;
  let skippedCount = 0;
  const channels   = broadcast.broadcastMedium;

  for (const recipient of recipients) {
    // Per-channel outcome: "sent" | "failed" | "skipped_no_email" | "skipped_no_phone" | "skipped_not_configured"
    const channelStatus: Record<string, string> = {};
    let anySent   = false;
    let anyFailed = false;

    for (const channel of channels) {
      try {
        switch (channel) {
          case "app_notification":
            emitToUser(recipient.id, "broadcast", {
              id:      broadcastId,
              title:   broadcast.title,
              message: broadcast.content,
            });
            channelStatus[channel] = "sent";
            anySent = true;
            break;

          case "email":
            if (!recipient.email) {
              channelStatus[channel] = "skipped_no_email";
            } else {
              const ok = await messaging.sendEmail({
                to:      recipient.email,
                from:    process.env.FROM_EMAIL || process.env.DEFAULT_FROM_EMAIL || 'noreply@smartprop.co.ke',
                subject: broadcast.title,
                text:    broadcast.content,
                html:    `<p>${broadcast.content.replace(/\n/g, "<br>")}</p>`,
              });
              channelStatus[channel] = ok ? "sent" : "failed";
              if (ok) anySent = true; else anyFailed = true;
            }
            break;

          case "sms":
            if (!recipient.phone) {
              channelStatus[channel] = "skipped_no_phone";
            } else {
              const ok = await messaging.sendSMS({
                to:   recipient.phone,
                body: `${broadcast.title}: ${broadcast.content}`,
              });
              channelStatus[channel] = ok ? "sent" : "failed";
              if (ok) anySent = true; else anyFailed = true;
            }
            break;

          case "whatsapp":
            if (!recipient.phone) {
              channelStatus[channel] = "skipped_no_phone";
            } else if (!whatsappService.isConfiguredForOrg(orgWhatsappSettings)) {
              channelStatus[channel] = "skipped_not_configured";
            } else {
              const ok = await whatsappService.sendMessage(
                {
                  to:      recipient.phone,
                  type:    "text",
                  content: `*${broadcast.title}*\n\n${broadcast.content}`,
                },
                orgId,
                orgWhatsappSettings
              );
              channelStatus[channel] = ok ? "sent" : "failed";
              if (ok) anySent = true; else anyFailed = true;
            }
            break;
        }
      } catch (err) {
        console.error(`[broadcast] channel=${channel} recipient=${recipient.id}:`, err);
        channelStatus[channel] = "failed";
        anyFailed = true;
      }
    }

    // Determine overall recipient outcome:
    // "sent"    → at least one channel succeeded
    // "skipped" → every channel was skipped (no contact info / not wired), nothing attempted
    // "failed"  → at least one channel was attempted but all attempts errored
    const allSkipped = Object.values(channelStatus).every(s =>
      s.startsWith("skipped_")
    );
    const overallStatus = anySent ? "sent" : allSkipped ? "skipped" : "failed";

    const skippedChannels = Object.entries(channelStatus)
      .filter(([, s]) => s.startsWith("skipped_"))
      .map(([ch, s]) => s === "skipped_not_configured" ? `${ch} (not configured)` : ch);

    // Record per-recipient delivery row
    try {
      await db.insert(broadcastRecipients).values({
        broadcastId,
        recipientUserId: recipient.id,
        recipientType:   (recipient.role ?? "staff") as any,
        email:           recipient.email ?? null,
        phoneNumber:     recipient.phone ?? null,
        medium:          channels as any,
        deliveryStatus:  { ...channelStatus, overall: overallStatus },
        sentAt:          anySent ? new Date() : null,
        failureReason:   allSkipped && skippedChannels.length > 0
          ? `No contact info for channel(s): ${skippedChannels.join(", ")}`
          : anyFailed && !anySent
          ? "All attempted channels failed"
          : null,
      });
    } catch {
      // Non-fatal — stats are best-effort
    }

    if (anySent)         sentCount++;
    else if (allSkipped) skippedCount++;
    else                 failedCount++;
  }

  return { sentCount, failedCount, skippedCount };
}

// ── GET /api/broadcast-messages ───────────────────────────────────────────────
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(broadcastMessages)
      .where(eq(broadcastMessages.organizationId, orgId))
      .orderBy(broadcastMessages.createdAt);

    // Return newest first
    res.json(rows.reverse());
  } catch (err) {
    console.error("GET /api/broadcast-messages error:", err);
    res.status(500).json({ message: "Failed to fetch broadcast messages" });
  }
});

// ── GET /api/broadcast-messages/:id ──────────────────────────────────────────
router.get("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [broadcast] = await db
      .select()
      .from(broadcastMessages)
      .where(and(eq(broadcastMessages.id, id), eq(broadcastMessages.organizationId, orgId)))
      .limit(1);

    if (!broadcast) return res.status(404).json({ message: "Broadcast not found" });

    const recipients = await db
      .select()
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, id));

    res.json({ ...broadcast, recipients });
  } catch (err) {
    console.error("GET /api/broadcast-messages/:id error:", err);
    res.status(500).json({ message: "Failed to fetch broadcast" });
  }
});

// ── POST /api/broadcast-messages ─────────────────────────────────────────────
router.post(
  "/",
  authenticateJWT,
  requireOrg,
  requireAdmin,
  auditLog("broadcast_message", "CREATE"),
  async (req: any, res) => {
    try {
      const orgId: number  = req.user.organizationId;
      const userId: string = String(req.user.userId || req.user.id);

      const parsed = createBroadcastSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
      }

      const { title, content, audienceType, broadcastMedium, scheduledFor, audienceFilter } = parsed.data;

      // If scheduled, save as draft and return — a scheduler job would pick this up
      const isScheduled = !!scheduledFor;
      const status = isScheduled ? "scheduled" : "sending";

      // Resolve recipients first so we know totalRecipients
      const recipients = await resolveRecipients(audienceType, orgId, audienceFilter);

      // Insert broadcast row
      const [broadcast] = await db
        .insert(broadcastMessages)
        .values({
          title,
          content,
          senderUserId:    userId,
          organizationId:  orgId,
          audienceType:    audienceType as any,
          audienceFilter:  audienceFilter ?? null,
          broadcastMedium: broadcastMedium as any,
          scheduledFor:    scheduledFor ? new Date(scheduledFor) : null,
          status:          status as any,
          totalRecipients: recipients.length,
          sentCount:       0,
          failedCount:     0,
        })
        .returning();

      if (isScheduled) {
        return res.status(201).json(broadcast);
      }

      // Load per-org WhatsApp credentials (falls back to env vars inside dispatchBroadcast)
      const [orgSettings] = await db
        .select({ whatsappSettings: organizationSettings.whatsappSettings })
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, orgId))
        .limit(1);
      const orgWhatsappSettings = (orgSettings?.whatsappSettings as { phoneNumberId?: string; apiKey?: string } | undefined) ?? undefined;

      // Dispatch immediately
      const { sentCount, failedCount, skippedCount } = await dispatchBroadcast(
        broadcast.id,
        { title, content, broadcastMedium },
        recipients,
        orgId,
        orgWhatsappSettings
      );

      // Update stats + mark as sent
      const [updated] = await db
        .update(broadcastMessages)
        .set({
          status:      "sent" as any,
          sentCount,
          failedCount,
          sentAt:      new Date(),
          updatedAt:   new Date(),
        })
        .where(eq(broadcastMessages.id, broadcast.id))
        .returning();

      res.status(201).json({ ...updated, skippedCount });
    } catch (err) {
      console.error("POST /api/broadcast-messages error:", err);
      res.status(500).json({ message: "Failed to create broadcast message" });
    }
  }
);

// ── GET /api/broadcast-messages/templates ─────────────────────────────────────
router.get("/templates", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(communicationTemplates)
      .where(and(eq(communicationTemplates.organizationId, orgId), eq(communicationTemplates.isActive, true)))
      .orderBy(communicationTemplates.createdAt);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/broadcast-messages/templates error:", err);
    res.status(500).json({ message: "Failed to fetch templates" });
  }
});

// ── POST /api/broadcast-messages/templates ────────────────────────────────────
router.post(
  "/templates",
  authenticateJWT,
  requireOrg,
  requireAdmin,
  auditLog("communication_template", "CREATE"),
  async (req: any, res) => {
    try {
      const orgId: number  = req.user.organizationId;
      const userId: string = String(req.user.userId || req.user.id);

      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
      }

      const [template] = await db
        .insert(communicationTemplates)
        .values({
          ...parsed.data,
          organizationId: orgId,
          createdBy:      userId,
          isActive:       true,
        })
        .returning();

      res.status(201).json(template);
    } catch (err) {
      console.error("POST /api/broadcast-messages/templates error:", err);
      res.status(500).json({ message: "Failed to create template" });
    }
  }
);

export default router;