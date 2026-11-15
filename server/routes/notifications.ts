/**
 * Notifications router — mounted at /api/notifications
 *
 * Routes:
 *   GET  /                    → fetch notifications for the logged-in user
 *   POST /:id/read            → mark a single notification as read
 *   POST /read-all            → mark all as read for this user
 *   DELETE /                  → clear all notifications for this user
 *   GET  /preferences         → fetch notification preferences
 *   PATCH /preferences        → update notification preferences
 *
 * Staff notifications are stored in-process (notifications map keyed by userId)
 * and seeded from relevant domain data on first fetch — maintenance requests
 * assigned to them, recent messages, and system events.
 *
 * In a production system these would be persisted to a notifications table;
 * the in-process store here survives server restarts gracefully via the
 * domain-data seed on GET /.
 */

import { Router } from "express";
import { db } from "../db";
import {
  maintenanceRequests, staffMembers, messages, users,
  userNotificationPreferences,
} from "@shared/schema";
import { eq, and, or, desc, gte } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { z } from "zod";

const router = Router();
router.use(authenticateJWT as any);
router.use(requireOrg as any);

// ─── In-process store ─────────────────────────────────────────────────────────
// { userId → Notification[] }  — newest first

export interface StaffNotification {
  id: string;
  type: "work_order" | "message" | "assignment" | "payment" | "visitor" | "system";
  title: string;
  message: string;
  ts: string;
  read: boolean;
  link?: string;
  meta?: Record<string, unknown>;
}

const store = new Map<string, StaffNotification[]>();

// ─── Preference-aware delivery ────────────────────────────────────────────────
// A user's own switches decide which in-app notifications they actually get:
//   inAppNotifications  – master switch (off = no in-app notifications at all)
//   maintenanceUpdates  – work_order / assignment
//   paymentReminders    – payment
//   securityAlerts      – visitor
// Messages and system notices are governed by the master switch only. The
// preferences row is cached for a minute so a burst of notifications is one query.

type PrefRow = {
  inAppNotifications: boolean | null; maintenanceUpdates: boolean | null;
  paymentReminders: boolean | null; securityAlerts: boolean | null;
};
const prefCache = new Map<string, { at: number; row: PrefRow | null }>();
const PREF_TTL_MS = 60_000;

export function clearPrefCache(userId: string) { prefCache.delete(userId); }

async function loadPrefs(userId: string): Promise<PrefRow | null> {
  const hit = prefCache.get(userId);
  if (hit && Date.now() - hit.at < PREF_TTL_MS) return hit.row;
  let row: PrefRow | null = null;
  try {
    const [r] = await db
      .select({
        inAppNotifications: userNotificationPreferences.inAppNotifications,
        maintenanceUpdates: userNotificationPreferences.maintenanceUpdates,
        paymentReminders:   userNotificationPreferences.paymentReminders,
        securityAlerts:     userNotificationPreferences.securityAlerts,
      })
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId))
      .limit(1);
    row = r ?? null;
  } catch { row = null; /* if prefs can't be read, deliver rather than drop */ }
  prefCache.set(userId, { at: Date.now(), row });
  return row;
}

/** Whether a notification of this type should be delivered given a user's switches (no row = everything on). */
export function allowsType(prefs: PrefRow | null, type: StaffNotification["type"]): boolean {
  if (!prefs) return true;
  if (prefs.inAppNotifications === false) return false;
  if ((type === "work_order" || type === "assignment") && prefs.maintenanceUpdates === false) return false;
  if (type === "payment" && prefs.paymentReminders === false) return false;
  if (type === "visitor" && prefs.securityAlerts === false) return false;
  return true;
}

function insertNotification(userId: string, newNotif: StaffNotification) {
  const list = store.get(userId) ?? [];
  store.set(userId, [newNotif, ...list].slice(0, 100)); // cap at 100
}

/**
 * Queue an in-app notification. Returns the notification immediately; delivery
 * is skipped (asynchronously) if the user has switched that category off.
 */
export function pushNotification(userId: string, notif: Omit<StaffNotification, "id" | "read">) {
  const newNotif: StaffNotification = {
    ...notif,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
  };
  loadPrefs(userId)
    .then(prefs => { if (allowsType(prefs, notif.type)) insertNotification(userId, newNotif); })
    .catch(() => insertNotification(userId, newNotif));
  return newNotif;
}

/** Same as pushNotification but awaitable, and returns whether it was delivered (used by the digest). */
export async function pushNotificationChecked(userId: string, notif: Omit<StaffNotification, "id" | "read">): Promise<boolean> {
  const prefs = await loadPrefs(userId);
  if (!allowsType(prefs, notif.type)) return false;
  if (!store.has(userId)) store.set(userId, []);
  insertNotification(userId, { ...notif, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, read: false });
  return true;
}

// ─── Seed helpers — build notifications from real domain data ─────────────────

async function seedForUser(userId: string, orgId: number): Promise<StaffNotification[]> {
  const seeded: StaffNotification[] = [];
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

  // Resolve the user's email so we can match against staffMembers.email
  const [userRow] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userEmail = userRow?.email?.toLowerCase() ?? "";

  // Find this user's staff member record (matched by email)
  const [staffProfile] = await db
    .select()
    .from(staffMembers)
    .where(eq(staffMembers.organization_id, orgId))
    .then(rows => {
      const u = rows.find(r => (r.email ?? "").toLowerCase() === userEmail);
      return u ? [u] : [];
    });

  const staffId = staffProfile?.id;

  // Seed: maintenance requests assigned to this user
  if (staffId) {
    const myReqs = await db
      .select()
      .from(maintenanceRequests)
      .where(
        and(
          gte(maintenanceRequests.createdAt, cutoff),
          eq(maintenanceRequests.technicianId, staffId),
        )
      )
      .orderBy(desc(maintenanceRequests.createdAt))
      .limit(20);

    for (const req of myReqs) {
      seeded.push({
        id: `seed-maint-${req.id}`,
        type: req.status === "completed" ? "work_order" : "assignment",
        title: req.status === "assigned" || req.status === "pending"
          ? "Work order assigned to you"
          : `Work order ${req.status?.replace(/_/g, " ")}`,
        message: req.title ?? req.description?.slice(0, 80) ?? `Ticket #${req.id}`,
        ts: (req.assignedDate ?? req.createdAt ?? new Date()).toISOString(),
        read: req.status === "completed" || req.status === "cancelled",
        link: `/maintenance`,
        meta: { requestId: req.id, status: req.status, priority: req.priority },
      });
    }
  }

  // Seed: recent messages sent to this user (toUserId matches the user's UUID)
  const recentMsgs = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.toUserId, userId),
        gte(messages.createdAt, cutoff),
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(10);

  // Batch fetch sender names
  const senderIds = [...new Set(recentMsgs.map(m => m.fromUserId))];
  const senderRows = senderIds.length
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.organizationId, orgId))
    : [];
  const senderMap = new Map(senderRows.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || "Someone"]));

  for (const msg of recentMsgs) {
    seeded.push({
      id: `seed-msg-${msg.id}`,
      type: "message",
      title: "New message",
      message: `${senderMap.get(msg.fromUserId) ?? "Someone"}: ${msg.subject ?? msg.content?.slice(0, 60) ?? ""}`,
      ts: (msg.createdAt ?? new Date()).toISOString(),
      read: !!msg.isRead,
      link: undefined,
      meta: { messageId: msg.id },
    });
  }

  return seeded.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
}

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get("/", async (req: any, res) => {
  try {
    const userId = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;

    // If no in-process notifications yet for this user, seed from domain data
    if (!store.has(userId)) {
      const seeded = await seedForUser(userId, orgId);
      const prefs = await loadPrefs(userId);
      store.set(userId, seeded.filter(n => allowsType(prefs, n.type)));
    }

    const notifs = store.get(userId) ?? [];
    return res.json(notifs);
  } catch (err: any) {
    console.error("GET /api/notifications error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch notifications" });
  }
});

// ─── POST /api/notifications/read-all ────────────────────────────────────────

router.post("/read-all", async (req: any, res) => {
  const userId = String(req.user.userId || req.user.id);
  const current = store.get(userId) ?? [];
  store.set(userId, current.map(n => ({ ...n, read: true })));
  res.json({ ok: true });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

router.post("/:id/read", async (req: any, res) => {
  const userId = String(req.user.userId || req.user.id);
  const { id } = req.params;
  const current = store.get(userId) ?? [];
  store.set(userId, current.map(n => n.id === id ? { ...n, read: true } : n));
  res.json({ ok: true });
});

// ─── POST /api/notifications/:id/reply ───────────────────────────────────────
// Sends a reply message to the sender of a message-type notification.
// Requires the notification to have meta.messageId or meta.fromUserId.

router.post("/:id/reply", async (req: any, res) => {
  try {
    const userId = String(req.user.userId || req.user.id);
    const { id }     = req.params;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ message: "Reply content is required" });
    }

    const notifs = store.get(userId) ?? [];
    const notif  = notifs.find(n => n.id === id);
    if (!notif) return res.status(404).json({ message: "Notification not found" });

    // Extract the original message ID from meta so we can find the sender
    const messageId  = (notif.meta?.messageId as number | undefined);
    let   toUserId: string | null = (notif.meta?.fromUserId as string | undefined) ?? null;

    if (!toUserId && messageId) {
      const [orig] = await db
        .select({ fromUserId: messages.fromUserId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      toUserId = orig?.fromUserId ?? null;
    }

    if (!toUserId) {
      return res.status(422).json({ message: "Cannot determine reply recipient — no sender info on this notification" });
    }

    // Send the reply message
    const originalSubject = notif.title?.startsWith("Re:") ? notif.title : `Re: ${notif.title}`;
    const [sent] = await db
      .insert(messages)
      .values({
        fromUserId: userId,
        toUserId,
        subject:    originalSubject,
        content:    content.trim(),
        channel:    "app",
        type:       "chat",
        messageType:"direct",
        sentAt:     new Date(),
      } as any)
      .returning();

    // Mark the original notification as read
    store.set(userId, notifs.map(n => n.id === id ? { ...n, read: true } : n));

    // Push a reply-sent notification back to the sender
    pushNotification(toUserId, {
      type:    "message",
      title:   "New message",
      message: `${req.user.firstName ?? "Someone"}: ${content.trim().slice(0, 80)}`,
      ts:      new Date().toISOString(),
      link:    "/messages",
      meta:    { messageId: sent.id, fromUserId: userId },
    });

    res.status(201).json({ ok: true, messageId: sent.id });
  } catch (err: any) {
    console.error("POST /api/notifications/:id/reply error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/notifications ────────────────────────────────────────────────

router.delete("/", async (req: any, res) => {
  const userId = String(req.user.userId || req.user.id);
  store.set(userId, []);
  res.json({ ok: true });
});

// ─── POST /api/notifications/digest-now ──────────────────────────────────────
// Sends the portfolio summary to the caller right now (admins and managers),
// so they can see exactly what the scheduled digest contains.

router.post("/digest-now", async (req: any, res) => {
  try {
    const role = req.user.role;
    if (!["admin", "manager"].includes(role)) return res.status(403).json({ message: "Only admins and managers receive the portfolio summary" });
    const userId = String(req.user.userId || req.user.id);
    const { orgDigestFigures, digestMessage } = await import("../services/digestScheduler");
    const { title, message } = digestMessage(await orgDigestFigures(req.user.organizationId));
    const delivered = await pushNotificationChecked(userId, { type: "system", title, message, ts: new Date().toISOString(), link: "/dashboard" });
    res.json({ ok: true, delivered, title, message });
  } catch (err: any) {
    console.error("POST /api/notifications/digest-now error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/notifications/preferences ──────────────────────────────────────

router.get("/preferences", async (req: any, res) => {
  try {
    const userId = String(req.user.userId || req.user.id);
    const [prefs] = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId))
      .limit(1);

    if (!prefs) {
      // Return sensible defaults — WhatsApp on by default for Kenyan market
      return res.json({
        userId,
        inAppNotifications:   true,
        maintenanceUpdates:   true,
        securityAlerts:       true,
        paymentReminders:     true,
        whatsappNotifications:true,    // primary channel in Kenya
        emailNotifications:   true,
        rentDueWarningDays:   3,
        marketingEmails:      false,
        weeklyDigest:         false,
        featureAnnouncements: true,
        frequency:            "immediate",
        quietHours: { enabled: true, start: "21:00", end: "07:00" },
      });
    }
    res.json(prefs);
  } catch (err: any) {
    console.error("GET /api/notifications/preferences error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ─── PATCH /api/notifications/preferences ────────────────────────────────────

const prefsSchema = z.object({
  inAppNotifications:    z.boolean().optional(),
  maintenanceUpdates:    z.boolean().optional(),
  securityAlerts:        z.boolean().optional(),
  paymentReminders:      z.boolean().optional(),
  whatsappNotifications: z.boolean().optional(),
  emailNotifications:    z.boolean().optional(),
  smsNotifications:      z.boolean().optional(),
  rentDueWarningDays:    z.number().int().min(1).max(14).optional(),
  marketingEmails:       z.boolean().optional(),
  weeklyDigest:          z.boolean().optional(),
  featureAnnouncements:  z.boolean().optional(),
  frequency:             z.enum(["immediate","daily","weekly","monthly"]).optional(),
  quietHours:            z.object({
    enabled: z.boolean(),
    start:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    end:     z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  }).optional(),
});

router.patch("/preferences", async (req: any, res) => {
  try {
    const userId = String(req.user.userId || req.user.id);
    const data = prefsSchema.parse(req.body);
    clearPrefCache(userId);

    const [existing] = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(userNotificationPreferences)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(userNotificationPreferences.userId, userId))
        .returning();
      return res.json(updated);
    } else {
      const [created] = await db
        .insert(userNotificationPreferences)
        .values({ weeklyDigest: false, ...data, userId } as any)
        .returning();
      return res.json(created);
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
    console.error("PATCH /api/notifications/preferences error:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;