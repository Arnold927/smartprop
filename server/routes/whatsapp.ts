/**
 * WhatsApp routes — mounted at /api/whatsapp
 *
 * Endpoints:
 *   GET  /webhook                     Meta webhook verification
 *   POST /webhook                     Inbound messages from Meta
 *   GET  /metrics                     Dashboard stats for the WhatsApp page
 *   GET  /messages                    Message log (org-scoped, newest first)
 *   POST /send                        Ad-hoc send (staff-triggered)
 *   POST /bulk                        Broadcast to a list of numbers
 *   GET  /templates                   List saved templates
 *   POST /templates                   Create a template
 *   POST /automated                   Trigger batch automated sends (rent reminders etc.)
 *   PATCH /threads/:phone/read        Mark a thread as read for the current user
 *   GET  /threads/reads               Fetch all thread read timestamps for the current user
 */
import { Router } from 'express';
import { desc, eq, and, gte, lt, count, sql } from 'drizzle-orm';
import { db } from '../db';
import { whatsappMessages, whatsappTemplates, whatsappThreadReads, tenants, units, rentPayments, maintenanceRequests } from '@shared/schema';
import { authenticateJWT } from '../middleware/auth';
import { whatsappService } from '../whatsapp';
import { notifyWhatsappInbound, notifyWhatsappStatus, emitToOrg } from '../ws';
import { handleInboundMessage } from '../services/whatsappBot';
import { z } from 'zod';
import { logger } from "../lib/logger";

const router = Router();

// ─── Meta webhook verification ──────────────────────────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'smartprop_verify';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    logger.info('[WhatsApp] Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ─── Inbound messages from Meta ─────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    try {
      const entry   = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      // ── Delivery / read status updates for outbound messages ─────────────
      // Meta sends: { id: "wamid.xxx", status: "delivered"|"read"|"failed",
      //               recipient_id: "254712...", timestamp: "1234567890" }
      const statuses = value?.statuses ?? [];
      for (const s of statuses) {
        if (!s.id || !s.status) continue;

        // 1. Update the DB row and get back the internal id + orgId in one query
        const updated = await db
          .update(whatsappMessages)
          .set({ status: s.status })
          .where(eq(whatsappMessages.metaMessageId, s.id))
          .returning({
            id:             whatsappMessages.id,
            organizationId: whatsappMessages.organizationId,
            to:             whatsappMessages.to,
          })
          .catch((err) => {
            logger.error('[WhatsApp] status DB update error:', err);
            return [];
          });

        if (!updated[0]) {
          // metaMessageId not found — could be a very old message; skip silently
          logger.warn(`[WhatsApp] Status callback for unknown metaId ${s.id} (status: ${s.status})`);
          continue;
        }

        const { id: messageId, organizationId: orgId, to: phone } = updated[0];

        logger.info(`[WhatsApp] Status update: msg #${messageId} → ${s.status}`);

        // 2. Push real-time event so operator console and tenant chat update
        //    their tick marks without a full refetch
        if (orgId) {
          const tsMs   = s.timestamp ? Number(s.timestamp) * 1000 : Date.now();
          const isoTs  = new Date(tsMs).toISOString();
          notifyWhatsappStatus(orgId, {
            messageId,
            metaId:    s.id,
            status:    s.status,
            phone:     phone ?? '',
            timestamp: isoTs,
          });
        }
      }

      // Template approval / rejection updates from Meta
      // Meta sends field: "message_template_status_update" on the changes array
      if (changes?.field === 'message_template_status_update') {
        const tmpl = value as {
          message_template_id: number;
          message_template_name: string;
          event: 'APPROVED' | 'REJECTED' | 'PENDING_DELETION';
          reason?: string;
        };

        if (tmpl.message_template_id) {
          const newStatus =
            tmpl.event === 'APPROVED' ? 'active' :
            tmpl.event === 'REJECTED' ? 'rejected' :
            'pending';

          await db
            .update(whatsappTemplates)
            .set({
              status: newStatus,
              rejectionReason: tmpl.event === 'REJECTED' ? (tmpl.reason ?? 'Rejected by Meta') : null,
              updatedAt: new Date(),
            })
            .where(eq(whatsappTemplates.metaTemplateId, String(tmpl.message_template_id)));

          logger.info(`[WhatsApp] Template "${tmpl.message_template_name}" → ${newStatus}`);
        }
      }

      // Inbound messages
      const messages = value?.messages ?? [];
      for (const message of messages) {
        const from = message.from; // e.g. "254724406054" (no leading +)
        const text = message.text?.body ?? '[non-text message]';
        logger.info(`[WhatsApp] Inbound from ${from}: ${text}`);

        // Resolve the organization that owns this sender's phone number.
        // Meta strips the leading '+', so we match against both formats.
        const normalised = from.startsWith('+') ? from : `+${from}`;
        let resolvedOrgId: number | null = null;
        try {
          const hit = await db
            .select({ organizationId: tenants.organizationId })
            .from(tenants)
            .where(
              sql`REPLACE(${tenants.phone}, '+', '') = REPLACE(${normalised}, '+', '')
                  OR ${tenants.phone} = ${normalised}
                  OR ${tenants.phone} = ${from}`
            )
            .limit(1);
          resolvedOrgId = hit[0]?.organizationId ?? null;
        } catch (lookupErr) {
          logger.warn('[WhatsApp] Could not resolve org for inbound sender:', lookupErr);
        }

        const inserted = await db.insert(whatsappMessages).values({
          organizationId: resolvedOrgId,
          to: normalised,
          type: 'text',
          content: text,
          status: 'delivered',
          direction: 'inbound',
        }).returning().catch((err) => {
          logger.error('[WhatsApp] Failed to store inbound message:', err);
          return [];
        });

        // Push real-time event so the Inbox tab updates without a manual refresh
        if (resolvedOrgId && inserted[0]) {
          notifyWhatsappInbound(resolvedOrgId, {
            id:        inserted[0].id,
            from:      normalised,
            content:   text,
            timestamp: inserted[0].sentAt?.toISOString() ?? new Date().toISOString(),
          });
        }

        // ── Auto-reply bot — fire and forget, never blocks the webhook ────
        handleInboundMessage(normalised, text, resolvedOrgId).catch((err) =>
          logger.error('[WhatsApp] Bot handler error:', err)
        );
      }
    } catch (err) {
      logger.error('[WhatsApp] Webhook parse error:', err);
    }

    // Always 200 so Meta doesn't retry
    return res.sendStatus(200);
  }

  res.sendStatus(404);
});

// ─── Config status ──────────────────────────────────────────────────────────
router.get('/status', authenticateJWT, (_req, res) => {
  res.json({
    configured: whatsappService.isConfigured,
    missing: [
      !process.env.WHATSAPP_API_KEY && 'WHATSAPP_API_KEY',
      !process.env.WHATSAPP_PHONE_NUMBER_ID && 'WHATSAPP_PHONE_NUMBER_ID',
      !process.env.WHATSAPP_VERIFY_TOKEN && 'WHATSAPP_VERIFY_TOKEN',
    ].filter(Boolean),
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────
router.get('/metrics', authenticateJWT, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [sentToday] = await db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, orgId),
          gte(whatsappMessages.sentAt, todayStart)
        )
      );

    const [delivered] = await db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, orgId),
          sql`${whatsappMessages.status} IN ('delivered','read')`
        )
      );

    const [totalSent] = await db
      .select({ value: count() })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, orgId),
          sql`${whatsappMessages.status} != 'failed'`
        )
      );

    const [activeTemplates] = await db
      .select({ value: count() })
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.organizationId, orgId),
          eq(whatsappTemplates.status, 'active')
        )
      );

    const [totalContacts] = await db
      .select({ value: count() })
      .from(tenants)
      .where(
        and(
          eq(tenants.organizationId, orgId),
          sql`${tenants.phone} IS NOT NULL`
        )
      );

    const total = Number(totalSent.value);
    const dlvd  = Number(delivered.value);
    const responseRate = total > 0 ? Math.round((dlvd / total) * 100) : 0;

    res.json({
      messages_sent_today:  Number(sentToday.value),
      messages_delivered:   dlvd,
      response_rate:        responseRate,
      active_templates:     Number(activeTemplates.value),
      total_contacts:       Number(totalContacts.value),
      // avg_response_time omitted: requires inbound message timestamps (no respondedAt column yet)
    });
  } catch (err) {
    logger.error('[WhatsApp] metrics error:', err);
    res.status(500).json({ message: 'Failed to fetch metrics' });
  }
});

// ─── Message log ─────────────────────────────────────────────────────────────
router.get('/messages', authenticateJWT, async (req: any, res) => {
  try {
    const orgId  = req.user.organizationId;
    const limit  = Math.min(parseInt(String(req.query.limit  ?? '50')), 200);
    const phone  = req.query.phone  ? String(req.query.phone)  : null;
    const before = req.query.before ? parseInt(String(req.query.before)) : null;

    const conditions = [eq(whatsappMessages.organizationId, orgId)];
    if (phone) {
      // Normalise both sides so +254… and 254… match equally
      const norm = phone.replace(/^\+/, '');
      conditions.push(
        sql`REPLACE(${whatsappMessages.to}, '+', '') = ${norm}`
      );
    }
    if (before && !isNaN(before)) {
      conditions.push(lt(whatsappMessages.id, before));
    }

    const msgs = await db
      .select()
      .from(whatsappMessages)
      .where(and(...conditions))
      .orderBy(desc(whatsappMessages.sentAt))
      .limit(limit);

    const mapped = msgs.map((m) => ({
      id:            m.id,
      to:            m.to,
      type:          m.type,
      content:       m.content,
      status:        m.status,
      direction:     m.direction ?? 'outbound',
      timestamp:     m.sentAt,
      template_name: m.templateName ?? undefined,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error('[WhatsApp] messages error:', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});


// ─── Inbox (inbound messages only) ──────────────────────────────────────────
router.get('/inbox', authenticateJWT, async (req: any, res) => {
  try {
    const orgId  = req.user.organizationId;
    const limit  = Math.min(parseInt(String(req.query.limit  ?? '50')), 200);
    const phone  = req.query.phone  ? String(req.query.phone)  : null;
    const before = req.query.before ? parseInt(String(req.query.before)) : null;

    const conditions = [
      eq(whatsappMessages.organizationId, orgId),
      eq(whatsappMessages.direction, 'inbound'),
    ];
    if (phone) {
      const norm = phone.replace(/^\+/, '');
      conditions.push(
        sql`REPLACE(${whatsappMessages.to}, '+', '') = ${norm}`
      );
    }
    if (before && !isNaN(before)) {
      conditions.push(lt(whatsappMessages.id, before));
    }

    const msgs = await db
      .select()
      .from(whatsappMessages)
      .where(and(...conditions))
      .orderBy(desc(whatsappMessages.sentAt))
      .limit(limit);

    const mapped = msgs.map((m) => ({
      id:        m.id,
      from:      m.to,           // 'to' stores the sender number for inbound
      content:   m.content,
      status:    m.status,
      direction: 'inbound',
      timestamp: m.sentAt,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error('[WhatsApp] inbox error:', err);
    res.status(500).json({ message: 'Failed to fetch inbox' });
  }
});

// ─── Update message status ────────────────────────────────────────────────────
router.patch('/messages/:id/status', authenticateJWT, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid message ID' });

  const { status } = req.body;
  const allowed = ['sent', 'delivered', 'read', 'failed', 'attended'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ message: `Status must be one of: ${allowed.join(', ')}` });
  }

  try {
    await db
      .update(whatsappMessages)
      .set({ status })
      .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.organizationId, req.user.organizationId)));
    res.json({ success: true, status });
  } catch (err) {
    logger.error('[WhatsApp] status update error:', err);
    res.status(500).json({ message: 'Failed to update message status' });
  }
});

// ─── Delete a message from the log ───────────────────────────────────────────
router.delete('/messages/:id', authenticateJWT, async (req: any, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid message ID' });

  try {
    const orgId = req.user.organizationId;
    await db
      .delete(whatsappMessages)
      .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.organizationId, orgId)));
    res.json({ success: true });
  } catch (err) {
    logger.error('[WhatsApp] delete message error:', err);
    res.status(500).json({ message: 'Failed to delete message' });
  }
});

// ─── Ad-hoc send ─────────────────────────────────────────────────────────────
router.post('/send', authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    to:           z.string().min(1),
    message:      z.string().min(1),
    type:         z.enum(['text', 'template', 'media']).optional().default('text'),
    templateName: z.string().optional(),
    variables:    z.record(z.string()).optional(),
    mediaUrl:     z.string().optional(),
    mediaCaption: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  const { to, message, type, templateName, variables } = parsed.data;
  const ok = await whatsappService.sendMessage(
    { to, type, content: message, templateName, variables },
    req.user.organizationId
  );

  if (!ok) {
    return res.status(502).json({ success: false, message: 'WhatsApp API call failed' });
  }

  // Fetch the record that sendMessage just inserted so the client can optimistically render it
  try {
    const [saved] = await db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, req.user.organizationId),
          sql`REPLACE(${whatsappMessages.to}, '+', '') = REPLACE(${to}, '+', '')`
        )
      )
      .orderBy(desc(whatsappMessages.id))
      .limit(1);

    if (saved) {
      return res.json({
        success: true,
        id:        saved.id,
        content:   saved.content,
        status:    saved.status,
        direction: 'outbound',
        timestamp: saved.sentAt,
      });
    }
  } catch {
    // Non-fatal — client will sync via query invalidation
  }

  res.json({ success: true });
});

// ─── Bulk send ───────────────────────────────────────────────────────────────
router.post('/bulk', authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    phones:  z.array(z.string()).min(1).max(500),
    message: z.string().min(1),
    type:    z.enum(['text', 'template', 'media']).optional().default('text'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  const { phones, message, type } = parsed.data;
  const orgId: number = req.user.organizationId;

  // Send in batches of 10 with a 1-second pause between batches to stay
  // within Meta's per-number rate limits and avoid quality-rating flags.
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 1000;
  let successful = 0;
  let failed = 0;

  try {
    for (let i = 0; i < phones.length; i += BATCH_SIZE) {
      const batch = phones.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (to) => {
          const ok = await whatsappService.sendMessage(
            { to, type, content: message },
            orgId
          );
          ok ? successful++ : failed++;
        })
      );

      // Pause between batches (skip delay after the final batch)
      if (i + BATCH_SIZE < phones.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    res.json({ successful, failed });
  } catch (err) {
    logger.error('[WhatsApp] bulk send error:', err);
    res.status(500).json({ message: 'Bulk send failed', successful, failed });
  }
});

// ─── Templates — list ────────────────────────────────────────────────────────
router.get('/templates', authenticateJWT, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId;
    const templates = await db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.organizationId, orgId))
      .orderBy(desc(whatsappTemplates.createdAt));

    res.json(templates);
  } catch (err) {
    logger.error('[WhatsApp] templates list error:', err);
    res.status(500).json({ message: 'Failed to fetch templates' });
  }
});

// ─── Templates — create ──────────────────────────────────────────────────────
// Category map from our internal names to Meta's required enum values
const META_CATEGORY_MAP: Record<string, string> = {
  rent_reminder:        'UTILITY',
  maintenance_update:   'UTILITY',
  payment_confirmation: 'UTILITY',
  emergency_alert:      'UTILITY',
  custom:               'UTILITY',
  marketing:            'MARKETING',
  authentication:       'AUTHENTICATION',
};

// Convert {{variable_name}} placeholders to Meta's indexed format {{1}}, {{2}} ...
function toMetaBody(content: string, variables: string[]): string {
  let indexed = content;
  variables.forEach((v, i) => {
    indexed = indexed.replaceAll(`{{${v}}}`, `{{${i + 1}}}`);
  });
  return indexed;
}

router.post('/templates', authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    name:      z.string().min(1).regex(/^[a-z0-9_]+$/, {
      message: 'Template name must be lowercase letters, numbers, and underscores only',
    }),
    category:  z.string().default('custom'),
    content:   z.string().min(1),
    variables: z.array(z.string()).default([]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid template data', errors: parsed.error.errors });
  }

  const { name, category, content, variables } = parsed.data;

  // 1. Insert locally as pending — template is not usable until Meta approves it
  let created: typeof whatsappTemplates.$inferSelect;
  try {
    [created] = await db
      .insert(whatsappTemplates)
      .values({
        organizationId: req.user.organizationId,
        name,
        category,
        content,
        variables,
        status: 'pending',
      })
      .returning();
  } catch (err) {
    logger.error('[WhatsApp] template DB insert error:', err);
    return res.status(500).json({ message: 'Failed to save template' });
  }

  // 2. Submit to Meta for approval (skip gracefully if token not configured)
  const token       = process.env.WHATSAPP_SYSTEM_USER_TOKEN || process.env.WHATSAPP_API_KEY;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (token && phoneNumberId) {
    try {
      const metaCategory = META_CATEGORY_MAP[category] ?? 'UTILITY';
      const metaBody     = toMetaBody(content, variables);

      // Build components — always a BODY; include indexed examples when variables present
      const components: object[] = [{
        type: 'BODY',
        text: metaBody,
        ...(variables.length > 0 && {
          example: { body_text: [variables.map((_, i) => `example_${i + 1}`)] },
        }),
      }];

      const metaRes = await fetch(
        `https://graph.facebook.com/v20.0/${phoneNumberId}/message_templates`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, language: 'en_US', category: metaCategory, components }),
        }
      );

      const metaData = await metaRes.json() as { id?: string; error?: { message: string } };

      if (metaRes.ok && metaData.id) {
        // Store Meta's template ID so the webhook can match approval/rejection events
        await db
          .update(whatsappTemplates)
          .set({ metaTemplateId: metaData.id, updatedAt: new Date() })
          .where(eq(whatsappTemplates.id, created.id));

        created = { ...created, metaTemplateId: metaData.id };
        logger.info(`[WhatsApp] Template "${name}" submitted to Meta (id: ${metaData.id}) — awaiting approval`);
      } else {
        // Meta rejected the submission immediately (name conflict, bad format, etc.)
        const reason = metaData.error?.message ?? 'Meta rejected the template submission';
        logger.error(`[WhatsApp] Meta template submission failed for "${name}":`, reason);

        await db
          .update(whatsappTemplates)
          .set({ status: 'rejected', rejectionReason: reason, updatedAt: new Date() })
          .where(eq(whatsappTemplates.id, created.id));

        created = { ...created, status: 'rejected', rejectionReason: reason };
      }
    } catch (metaErr) {
      // Network error — template stays pending, submission can be retried manually
      logger.error('[WhatsApp] Meta submission network error:', metaErr);
    }
  } else {
    logger.warn('[WhatsApp] No token configured — template saved locally only, not submitted to Meta');
  }

  res.status(201).json(created);
});
// ─── Automated batch sends ───────────────────────────────────────────────────
router.post('/automated', authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    type: z.enum(['rent_reminder', 'maintenance_update', 'payment_confirmation', 'emergency_alert']),
    recipients: z.array(z.string()).default([]),
    customMessage: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  const { type, customMessage } = parsed.data;
  const orgId: number = req.user.organizationId;
  let sent = 0;
  let failed = 0;

  try {
    if (type === 'rent_reminder') {
      // Fetch all overdue/pending payments for this org with a tenant phone
      const payments = await db
        .select({
          id:        rentPayments.id,
          amount:    rentPayments.amount,
          dueDate:   rentPayments.dueDate,
          currency:  tenants.currency,
          phone:     tenants.phone,
          firstName: tenants.firstName,
          lastName:  tenants.lastName,
        })
        .from(rentPayments)
        .innerJoin(tenants, eq(tenants.id, rentPayments.tenantId))
        .where(
          and(
            eq(tenants.organizationId, orgId),
            sql`${rentPayments.status} IN ('pending','overdue')`,
            sql`${tenants.phone} IS NOT NULL`
          )
        );

      for (const p of payments) {
        if (!p.phone) continue;
        const name    = `${p.firstName} ${p.lastName}`.trim();
        const dueDate = p.dueDate ? new Date(p.dueDate).toLocaleDateString('en-KE') : 'soon';
        const ok = await whatsappService.sendRentReminder(
          p.phone, name,
          Number(p.amount ?? 0).toLocaleString(),
          dueDate, p.currency ?? 'KES', orgId
        );
        ok ? sent++ : failed++;
      }

    } else if (type === 'maintenance_update') {
      const requests = await db
        .select({
          id:           maintenanceRequests.id,
          ticketNumber: maintenanceRequests.ticketNumber,
          status:       maintenanceRequests.status,
          phone:        tenants.phone,
          firstName:    tenants.firstName,
          lastName:     tenants.lastName,
        })
        .from(maintenanceRequests)
        .innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId))
        .where(
          and(
            eq(tenants.organizationId, orgId),
            sql`${maintenanceRequests.status} IN ('pending','assigned','in_progress')`,
            sql`${tenants.phone} IS NOT NULL`
          )
        );

      for (const r of requests) {
        if (!r.phone) continue;
        const name = `${r.firstName} ${r.lastName}`.trim();
        const ok = await whatsappService.sendMaintenanceUpdate(
          r.phone, name, r.ticketNumber,
          r.status ?? 'In Progress', undefined, orgId
        );
        ok ? sent++ : failed++;
      }

    } else if (type === 'emergency_alert') {
      const allTenants = await db
        .select({ phone: tenants.phone })
        .from(tenants)
        .where(
          and(
            eq(tenants.organizationId, orgId),
            sql`${tenants.phone} IS NOT NULL`,
            eq(tenants.status, 'active')
          )
        );

      const phones = allTenants.map((t) => t.phone!).filter(Boolean);
      if (phones.length > 0) {
        const msg = customMessage || 'Urgent notice from your property manager. Please check your email for details.';
        await whatsappService.sendEmergencyAlert(phones, msg, orgId);
        sent = phones.length;
      }

    } else if (type === 'payment_confirmation') {
      // Send confirmations for payments marked paid in the last 24 hours
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const payments = await db
        .select({
          amount:    rentPayments.amount,
          paymentMethod: rentPayments.paymentMethod,
          currency:  tenants.currency,
          phone:     tenants.phone,
          firstName: tenants.firstName,
          lastName:  tenants.lastName,
        })
        .from(rentPayments)
        .innerJoin(tenants, eq(tenants.id, rentPayments.tenantId))
        .where(
          and(
            eq(tenants.organizationId, orgId),
            eq(rentPayments.status, 'paid'),
            gte(rentPayments.paidDate, since.toISOString().split('T')[0]),
            sql`${tenants.phone} IS NOT NULL`
          )
        );

      for (const p of payments) {
        if (!p.phone) continue;
        const name = `${p.firstName} ${p.lastName}`.trim();
        const ok = await whatsappService.sendPaymentConfirmation(
          p.phone, name,
          Number(p.amount ?? 0).toLocaleString(),
          p.paymentMethod ?? 'unknown',
          p.currency ?? 'KES', orgId
        );
        ok ? sent++ : failed++;
      }
    }

    res.json({ success: true, type, sent, failed });
  } catch (err) {
    logger.error('[WhatsApp] automated send error:', err);
    res.status(500).json({ message: 'Automated send failed' });
  }
});

// ─── Tenant lookup (JWT required — used by the tenant chat widget) ──────────
// GET /api/whatsapp/tenant-lookup?phone=+254...  OR  ?tenantId=42
// Was "no JWT" — but its only caller (tenant-whatsapp-chat.tsx) is only ever
// rendered inside the already-authenticated tenant portal and already sends
// a Bearer token on every request, so requiring auth here breaks nothing.
router.get('/tenant-lookup', authenticateJWT as any, async (req: any, res) => {
  const { phone, tenantId } = req.query as Record<string, string>;
  const role: string = req.user?.role ?? '';

  try {
    // Select tenant fields + unitNumber via left join on units
    const selectShape = {
      id:             tenants.id,
      firstName:      tenants.firstName,
      lastName:       tenants.lastName,
      phone:          tenants.phone,
      organizationId: tenants.organizationId,
      unitId:         tenants.unitId,
      unitNumber:     units.unitNumber,
    };

    let row: { id: number; firstName: string; lastName: string; phone: string | null; organizationId: number; unitId: number | null; unitNumber: string | null } | undefined;

    if (tenantId) {
      const rows = await db
        .select(selectShape)
        .from(tenants)
        .leftJoin(units, eq(units.id, tenants.unitId))
        .where(eq(tenants.id, parseInt(tenantId)))
        .limit(1);
      row = rows[0];
    } else if (phone) {
      const normalised = phone.startsWith('+') ? phone : `+${phone}`;
      const rows = await db
        .select(selectShape)
        .from(tenants)
        .leftJoin(units, eq(units.id, tenants.unitId))
        .where(
          sql`REPLACE(${tenants.phone}, '+', '') = REPLACE(${normalised}, '+', '')
              OR ${tenants.phone} = ${normalised}
              OR ${tenants.phone} = ${phone}`
        )
        .limit(1);
      row = rows[0];
    }

    if (!row) {
      return res.status(404).json({
        message: "We couldn't find this number in our system. Please contact your property manager.",
      });
    }

    // A tenant caller may only ever look up their own record — never
    // someone else's, by phone or by tenantId.
    if (role === 'tenant') {
      const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
      if (!own || own.id !== row.id) {
        return res.status(404).json({ message: "We couldn't find this number in our system. Please contact your property manager." });
      }
    }

    res.json({
      id:             row.id,
      firstName:      row.firstName,
      lastName:       row.lastName,
      phone:          row.phone,
      unitNumber:     row.unitNumber ?? undefined,
      propertyName:   undefined,
      // organizationId intentionally omitted from the response — this
      // endpoint's own original intent, now actually honored.
    });
  } catch (err) {
    logger.error('[WhatsApp] tenant-lookup error:', err);
    res.status(500).json({ message: 'Lookup failed' });
  }
});

// ─── Tenant thread (JWT required — used by the tenant chat widget) ──────────
// GET /api/whatsapp/tenant-thread?phone=+254...
// Was "no JWT" — same reasoning as tenant-lookup above: its only caller
// already sends a Bearer token on every request, so this breaks nothing.
router.get('/tenant-thread', authenticateJWT as any, async (req: any, res) => {
  const role: string = req.user?.role ?? '';
  let phone = (req.query as Record<string, string>).phone;

  // A tenant may only ever view their OWN thread — resolve their phone from
  // the JWT-linked tenant record and ignore whatever was passed in the query.
  if (role === 'tenant') {
    const [own] = await db.select({ phone: tenants.phone }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
    if (!own?.phone) return res.status(403).json({ message: 'Tenant profile not found or has no phone on file.' });
    phone = own.phone;
  }

  if (!phone) return res.status(400).json({ message: 'phone is required' });

  try {
    const normalised = phone.startsWith('+') ? phone : `+${phone}`;

    const msgs = await db
      .select()
      .from(whatsappMessages)
      .where(
        sql`REPLACE(${whatsappMessages.to}, '+', '') = REPLACE(${normalised}, '+', '')
            OR ${whatsappMessages.to} = ${normalised}
            OR ${whatsappMessages.to} = ${phone}`
      )
      .orderBy(whatsappMessages.sentAt)
      .limit(200);

    const mapped = msgs.map((m) => ({
      id: m.id,
      content: m.content,
      // direction in DB is from the operator's POV:
      //   "inbound"  = came FROM tenant  → tenant sees it on the RIGHT (isMine)
      //   "outbound" = sent TO tenant    → tenant sees it on the LEFT
      direction: m.direction ?? 'outbound',
      status: m.status,
      timestamp: m.sentAt,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error('[WhatsApp] tenant-thread error:', err);
    res.status(500).json({ message: 'Failed to fetch thread' });
  }
});

// ─── Tenant send (JWT required — used by the tenant chat widget) ────────────
// POST /api/whatsapp/tenant-send  { to, message, type, mediaUrl? }
// Was "no JWT" — same reasoning as tenant-lookup/tenant-thread above.
router.post('/tenant-send', authenticateJWT as any, async (req: any, res) => {
  const role: string = req.user?.role ?? '';
  const schema = z.object({
    to:       z.string().min(1).optional(),
    message:  z.string().min(1),
    type:     z.enum(['text', 'media']).default('text'),
    mediaUrl: z.string().url().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  const { message, type } = parsed.data;
  let to = parsed.data.to;

  // A tenant may only ever send as themselves — resolve their own phone from
  // the JWT-linked tenant record and ignore whatever "to" was sent, rather
  // than letting a message appear to come from an arbitrary phone number.
  if (role === 'tenant') {
    const [own] = await db.select({ phone: tenants.phone }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
    if (!own?.phone) return res.status(403).json({ message: 'Tenant profile not found or has no phone on file.' });
    to = own.phone;
  }
  if (!to) return res.status(400).json({ message: '"to" is required' });

  const normalised = to.startsWith('+') ? to : `+${to}`;

  // Resolve org from phone so the operator console sees it correctly
  let orgId: number | null = null;
  try {
    const hit = await db
      .select({ organizationId: tenants.organizationId })
      .from(tenants)
      .where(
        sql`REPLACE(${tenants.phone}, '+', '') = REPLACE(${normalised}, '+', '')
            OR ${tenants.phone} = ${normalised}`
      )
      .limit(1);
    orgId = hit[0]?.organizationId ?? null;
  } catch {}

  let inserted: typeof whatsappMessages.$inferSelect | undefined;
  try {
    [inserted] = await db
      .insert(whatsappMessages)
      .values({
        organizationId: orgId,
        to: normalised,
        type,
        content: message,
        status: 'delivered',
        direction: 'inbound',
      })
      .returning();
  } catch (err) {
    logger.error('[WhatsApp] tenant-send DB insert error:', err);
    return res.status(500).json({ message: 'Failed to store message' });
  }

  // Push real-time event so the operator console thread updates instantly
  if (orgId && inserted) {
    notifyWhatsappInbound(orgId, {
      id:        inserted.id,
      from:      normalised,
      content:   message,
      timestamp: inserted.sentAt?.toISOString() ?? new Date().toISOString(),
    });
  }

  res.json({ success: true, id: inserted?.id });
});

// ─── Typing indicator (JWT required — operator side) ────────────────────────
// PATCH /api/whatsapp/typing  { phone }
// Broadcasts whatsapp:typing to all org WS clients so the tenant sees
// the bouncing-dots animation in TenantWhatsAppChat.
router.patch('/typing', authenticateJWT, async (req: any, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ message: 'phone is required' });

  const orgId: number = req.user.organizationId;

  emitToOrg(orgId, 'whatsapp:inbound' as any, { typing: true, phone });

  res.json({ ok: true });
});

// ─── Thread read receipts ─────────────────────────────────────────────────────

// GET /api/whatsapp/threads/reads
// Returns { [phone]: lastReadAt } for all threads the current user has read.
// Called once on mount; client uses this to initialise readPhones state.
router.get('/threads/reads', authenticateJWT, async (req: any, res) => {
  try {
    const userId: string = req.user.userId;
    const orgId: number  = req.user.organizationId;

    const rows = await db
      .select({ phone: whatsappThreadReads.phone, lastReadAt: whatsappThreadReads.lastReadAt })
      .from(whatsappThreadReads)
      .where(
        and(
          eq(whatsappThreadReads.userId, userId),
          eq(whatsappThreadReads.orgId, orgId)
        )
      );

    // Return as a plain object map: { "+254...": "2025-05-01T12:00:00Z", ... }
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.phone] = r.lastReadAt.toISOString();
    }
    res.json(map);
  } catch (err) {
    logger.error('[WhatsApp] thread reads error:', err);
    res.status(500).json({ message: 'Failed to fetch thread reads' });
  }
});

// PATCH /api/whatsapp/threads/:phone/read
// Upserts a read receipt for the current user + phone, then broadcasts
// a whatsapp:read event org-wide so other open tabs/devices sync immediately.
router.patch('/threads/:phone/read', authenticateJWT, async (req: any, res) => {
  try {
    const phone  = decodeURIComponent(req.params.phone);
    const userId: string = req.user.userId;
    const orgId: number  = req.user.organizationId;

    if (!phone) return res.status(400).json({ message: 'phone is required' });

    const now = new Date();

    await db
      .insert(whatsappThreadReads)
      .values({ userId, orgId, phone, lastReadAt: now })
      .onConflictDoUpdate({
        target: [whatsappThreadReads.userId, whatsappThreadReads.phone],
        set:    { lastReadAt: now },
      });

    // Broadcast to all org clients (other tabs, other devices of same or other operators)
    emitToOrg(orgId, 'whatsapp:read' as any, {
      userId,
      phone,
      lastReadAt: now.toISOString(),
    });

    res.json({ ok: true, phone, lastReadAt: now.toISOString() });
  } catch (err) {
    logger.error('[WhatsApp] mark-read error:', err);
    res.status(500).json({ message: 'Failed to mark thread as read' });
  }
});

// ─── Conversation list (one row per phone, for the sidebar) ──────────────────
// Returns one entry per distinct phone number with the last message content,
// timestamp, direction, and unread count — far cheaper than fetching all
// messages + inbox rows just to build the sidebar.
//
// GET /api/whatsapp/conversations
router.get('/conversations', authenticateJWT, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;

    // One query: for each phone, grab the latest message and count unread
    // inbound messages (direction = 'inbound', not yet in thread-reads).
    // We use a subquery to get the last message per phone, then join unread counts.
    const result = await db.execute(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (
          -- Normalise phone so +254… and 254… collapse into one thread
          REPLACE("to", '+', '')
        )
          REPLACE("to", '+', '')   AS phone_norm,
          "to"                      AS phone,
          "content"                 AS last_content,
          "direction"               AS last_direction,
          "sent_at"                 AS last_at,
          "status"                  AS last_status
        FROM whatsapp_messages
        WHERE organization_id = ${orgId}
        ORDER BY REPLACE("to", '+', ''), "sent_at" DESC
      ),
      unread_counts AS (
        SELECT
          REPLACE("to", '+', '') AS phone_norm,
          COUNT(*)::int            AS unread_count
        FROM whatsapp_messages
        WHERE
          organization_id = ${orgId}
          AND direction    = 'inbound'
          -- exclude phones the user has already opened (joined later client-side)
        GROUP BY REPLACE("to", '+', '')
      )
      SELECT
        lm.phone,
        lm.last_content,
        lm.last_direction,
        lm.last_at,
        lm.last_status,
        COALESCE(uc.unread_count, 0) AS unread_count
      FROM last_msg lm
      LEFT JOIN unread_counts uc ON uc.phone_norm = lm.phone_norm
      ORDER BY lm.last_at DESC NULLS LAST
    `);

    const rows = result.rows as Array<Record<string, unknown>>;

    res.json(
      rows.map((r) => ({
        phone:         r.phone         as string,
        lastContent:   r.last_content  as string,
        lastDirection: r.last_direction as string,
        lastAt:        r.last_at       as string | null,
        lastStatus:    r.last_status   as string,
        unreadCount:   Number(r.unread_count),
      }))
    );
  } catch (err) {
    logger.error('[WhatsApp] conversations error:', err);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

export default router;