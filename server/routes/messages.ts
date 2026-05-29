/**
 * Messages router — mounted at /api/messages
 *
 * Fixes applied vs. original:
 *  1. GET / JOINs sender & recipient names so the UI can display them.
 *  2. GET / accepts ?box=inbox|sent|all (default "all") for tab filtering.
 *  3. GET / orders newest-first (DESC).
 *  4. Mark-read accepts both PATCH and PUT (frontend sends PUT).
 *  5. POST / validates toUserId belongs to the same org; auto-routes to org admin when omitted.
 *  6. POST / WS preview uses msg.content (not msg.body — column is content).
 */

import { Router } from "express";
import { db } from "../db";
import { messages, users } from "@shared/schema";
import { eq, and, or, count, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { insertMessageSchema } from "@shared/schema";
import { notifyNewMessage } from "../ws";
import { pushNotification } from "./notifications";
import { z } from "zod";

const router = Router();

// ── GET /api/messages ─────────────────────────────────────────────────────────
// ?box=inbox|sent|all  (default: all)
// ?page=1  &limit=50
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number  = req.user.organizationId;
    const box    = (req.query.box  as string) || "all";
    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const directionCondition =
      box === "inbox" ? eq(messages.toUserId, userId) :
      box === "sent"  ? eq(messages.fromUserId, userId) :
      or(eq(messages.fromUserId, userId), eq(messages.toUserId, userId));

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(messages)
        .where(directionCondition)
        .orderBy(desc(messages.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(messages)
        .where(directionCondition),
    ]);

    if (rows.length === 0) {
      return res.json({ count: 0, page, limit, next: null, previous: null, results: [] });
    }

    // Batch-fetch all users referenced on this page
    const userRows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const userMap = new Map(userRows.map(u => [u.id, u]));

    function displayName(uid: string) {
      const u = userMap.get(uid);
      if (!u) return "Unknown";
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
    }

    const enriched = rows.map(m => ({
      ...m,
      fromName:   displayName(m.fromUserId),
      toName:     displayName(m.toUserId),
      fromEmail:  userMap.get(m.fromUserId)?.email ?? null,
      toEmail:    userMap.get(m.toUserId)?.email   ?? null,
      fromRole:   userMap.get(m.fromUserId)?.role  ?? null,
      toRole:     userMap.get(m.toUserId)?.role    ?? null,
      isSentByMe: m.fromUserId === userId,
    }));

    res.json({
      count: total, page, limit,
      next:     page * limit < total ? `?box=${box}&page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?box=${box}&page=${page - 1}&limit=${limit}` : null,
      results:  enriched,
    });
  } catch (err) {
    logger.error("Get messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// ── POST /api/messages ────────────────────────────────────────────────────────
router.post("/", authenticateJWT, requireOrg, auditLog("message", "CREATE"), async (req: any, res) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number  = req.user.organizationId;

    let toUserId: string | undefined = req.body.toUserId
      ? String(req.body.toUserId)
      : undefined;

    // If no recipient specified (e.g. tenant sending first-ever message),
    // auto-route to the org admin so the schema requirement is satisfied.
    if (!toUserId) {
      const [admin] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.role, "admin")))
        .limit(1);
      if (!admin) {
        return res.status(400).json({ message: "No administrator found for this organisation" });
      }
      toUserId = admin.id;
    } else {
      // Validate the supplied recipient belongs to the same org
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, toUserId), eq(users.organizationId, orgId)))
        .limit(1);
      if (!targetUser) {
        return res.status(400).json({ message: "Recipient not found in your organisation" });
      }
    }

    const validated = insertMessageSchema.parse({ ...req.body, fromUserId: userId, toUserId });
    const msg = await storage.createMessage(validated);

    // Real-time push to recipient
    if (msg.toUserId) {
      const fromName = `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Someone";
      notifyNewMessage(String(msg.toUserId), {
        id:       msg.id,
        fromName,
        subject:  msg.subject ?? undefined,
        preview:  msg.content?.slice(0, 100) ?? undefined,
      });
      // Also update the in-process bell store so the badge increments immediately
      pushNotification(String(msg.toUserId), {
        type:    "message",
        title:   `New message from ${fromName}`,
        message: msg.subject ?? msg.content?.slice(0, 80) ?? "",
        ts:      new Date().toISOString(),
        link:    "/messages",
      });
    }

    res.status(201).json(msg);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid message data", errors: err.errors });
    }
    logger.error("Send message error:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});


// ── GET /api/messages/contacts ────────────────────────────────────────────────
// Safe user list for the compose recipient picker.
// Returns id, firstName, lastName, role only — no email or sensitive data.
// Accessible to ALL authenticated org members (TENANT_AND_ABOVE).
// Must be declared before /:id routes so "contacts" isn't treated as an id.
router.get("/contacts", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const userId = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;

    const rows = await db
      .select({
        id:        users.id,
        firstName: users.firstName,
        lastName:  users.lastName,
        role:      users.role,
        // Include email only for managers/admins — tenants see names only
        email:     users.email,
      })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        // Exclude the requesting user from the list
      ));

    const isManager = ['admin', 'manager'].includes(req.user.role ?? '');

    const contacts = rows
      .filter(u => u.id !== userId)
      .map(u => ({
        id:        u.id,
        firstName: u.firstName,
        lastName:  u.lastName,
        role:      u.role,
        // Only expose email to managers — tenants see name + role only
        email:     isManager ? u.email : null,
      }));

    res.json(contacts);
  } catch (err) {
    logger.error("Get contacts error:", err);
    res.status(500).json({ message: "Failed to fetch contacts" });
  }
});

// ── Mark as read — supports both PATCH and PUT (frontend sends PUT) ───────────
const markRead = async (req: any, res: any) => {
  try {
    const id     = parseInt(req.params.id);
    const userId = String(req.user.userId || req.user.id);
    const [msg]  = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.toUserId, userId)))
      .limit(1);
    if (!msg) return res.status(404).json({ message: "Message not found" });
    await storage.markMessageAsRead(id);
    res.json({ success: true });
  } catch (err) {
    logger.error("Mark read error:", err);
    res.status(500).json({ message: "Failed to mark message as read" });
  }
};

router.patch("/:id/read", authenticateJWT, requireOrg, auditLog("message", "ACTION"), markRead);
router.put("/:id/read",   authenticateJWT, requireOrg, auditLog("message", "ACTION"), markRead);

// ── POST /api/messages/bulk ───────────────────────────────────────────────────
// Body: { toUserIds: string[], subject: string, content: string, attachments?: [...] }
// Sends one message per recipient, fires WS notification to each.
router.post("/bulk", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number  = req.user.organizationId;
    const { toUserIds, subject, content, attachments } = req.body;

    if (!Array.isArray(toUserIds) || toUserIds.length === 0) {
      return res.status(400).json({ message: "toUserIds must be a non-empty array" });
    }
    if (!content?.trim()) {
      return res.status(400).json({ message: "content is required" });
    }

    // Validate all recipients belong to same org
    const recipientRows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, orgId)));
    const validIds = new Set(recipientRows.map(u => u.id));
    const invalidIds = toUserIds.filter((id: string) => !validIds.has(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ message: `Recipients not in organisation: ${invalidIds.join(", ")}` });
    }

    const fromName = `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Management";
    const meta = attachments?.length ? { attachments } : undefined;

    const sent: number[] = [];
    const failed: string[] = [];

    for (const toUserId of toUserIds) {
      try {
        const validated = insertMessageSchema.parse({
          fromUserId: userId,
          toUserId,
          subject: subject ?? "Message from management",
          content: content.trim(),
          messageType: "broadcast",
          metadata: meta ?? null,
        });
        const msg = await storage.createMessage(validated);
        sent.push(msg.id);
        notifyNewMessage(String(toUserId), {
          id:       msg.id,
          fromName,
          subject:  subject ?? undefined,
          preview:  content.slice(0, 100),
        });
        pushNotification(String(toUserId), {
          type:    "message",
          title:   `New message from ${fromName}`,
          message: subject ?? content.slice(0, 80),
          ts:      new Date().toISOString(),
          link:    "/messages",
        });
      } catch {
        failed.push(toUserId);
      }
    }

    return res.status(201).json({ sent: sent.length, failed: failed.length, failedIds: failed });
  } catch (err) {
    logger.error("Bulk send error:", err);
    return res.status(500).json({ message: "Failed to send bulk messages" });
  }
});

// ── POST /api/messages/upload-attachment ──────────────────────────────────────
// Accepts a single file, stores it via the document pipeline, returns { url, name, size, type }
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
import { logger } from "../lib/logger";
const msgUpload = s3Upload;

router.post("/upload-attachment", authenticateJWT, requireOrg,
  msgUpload.single("file"),
  async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const url = resolveUploadUrl(req.file as any);
      return res.json({
        url,
        name: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });
    } catch (err) {
      logger.error("Message attachment upload error:", err);
      return res.status(500).json({ message: "Failed to upload attachment" });
    }
  }
);

export default router;