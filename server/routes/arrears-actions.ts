/**
 * Arrears sub-resource routes
 * Mounted at:
 *   /api/arrears-actions        — ArrearsAction CRUD
 *   /api/payment-reminders      — PaymentReminder CRUD + schedule
 *   /api/risk-assessments       — RiskAssessment CRUD + calculate/:tenantId
 *   /api/tenant-behavior-logs   — TenantBehaviorLog CRUD
 *
 * NOTE: index.ts mounts this file under four separate prefixes.
 * Each router is exported individually so index.ts can mount them separately.
 */
import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { storage } from "../storage";
import { db } from "../db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { arrears, arrearsActions, paymentReminders, tenants, organizations } from "@shared/schema";
import { composeReminderMessage, dispatchReminder, scheduleAutomaticReminders } from "../services/payment-reminders";
import {
  insertArrearsActionSchema,
  insertPaymentReminderSchema,
  insertRiskAssessmentSchema,
  insertTenantBehaviorLogSchema,
} from "@shared/schema";
import { z } from "zod";

// ── /api/arrears-actions ──────────────────────────────────────────────────────
export const arrearsActionsRouter = Router();

/** An arrears record is only usable by the organisation that owns it. */
async function ownArrears(arrearsId: number, orgId: number) {
  const [a] = await db.select().from(arrears).where(and(eq(arrears.id, arrearsId), eq(arrears.organizationId, orgId))).limit(1);
  return a ?? null;
}

arrearsActionsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const arrearsId = req.query.arrearsId ? parseInt(req.query.arrearsId as string) : undefined;
    if (req.query.arrearsId && (!Number.isInteger(arrearsId) || !(await ownArrears(arrearsId!, orgId)))) {
      return res.status(404).json({ message: "Arrears record not found" });
    }
    // Without the join this returned every organisation's actions.
    const rows = await db.select({ a: arrearsActions }).from(arrearsActions)
      .innerJoin(arrears, eq(arrears.id, arrearsActions.arrearsId))
      .where(and(eq(arrears.organizationId, orgId), arrearsId ? eq(arrearsActions.arrearsId, arrearsId) : sql`true`))
      .orderBy(desc(arrearsActions.actionDate));
    res.json(rows.map(r => r.a));
  } catch (err) {
    console.error("Get arrears actions error:", err);
    res.status(500).json({ message: "Failed to fetch arrears actions" });
  }
});

arrearsActionsRouter.post("/", authenticateJWT, requireOrg, auditLog("arrears_action", "CREATE"), async (req: any, res) => {
  try {
    // Dates arrive as ISO strings; the schema wants Date objects (without this every create failed validation and came back as a 500).
    const toDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : v);
    const parsed = insertArrearsActionSchema.safeParse({
      ...req.body, actionDate: toDate(req.body?.actionDate) ?? new Date(), followUpDate: toDate(req.body?.followUpDate),
    });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    const validated = parsed.data;
    if (!(await ownArrears(validated.arrearsId as number, req.user.organizationId))) {
      return res.status(404).json({ message: "Arrears record not found" });
    }
    const action = await storage.createArrearsAction(validated);
    res.status(201).json(action);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create arrears action error:", err);
    res.status(500).json({ message: "Failed to create arrears action" });
  }
});

// ── /api/payment-reminders ────────────────────────────────────────────────────
export const paymentRemindersRouter = Router();

paymentRemindersRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const status = req.query.status as string | undefined;
    const reminders = await storage.getPaymentReminders(status, req.user.organizationId);
    res.json(reminders);
  } catch (err) {
    console.error("Get payment reminders error:", err);
    res.status(500).json({ message: "Failed to fetch payment reminders" });
  }
});

const createReminderSchema = z.object({
  tenantId: z.number().int().positive(),
  arrearsId: z.number().int().positive().nullish(),
  reminderType: z.enum(["pre_due", "overdue", "final_notice"]).default("overdue"),
  channel: z.enum(["auto", "email", "sms", "whatsapp", "app"]).default("auto"),
  message: z.string().trim().min(1).max(1000).optional(),
  scheduledFor: z.string().optional(),
});

// POST /api/payment-reminders — send now, or queue for a later time.
// Responds with how delivery actually went; "sent" means the provider accepted it, not that a row exists.
paymentRemindersRouter.post("/", authenticateJWT, requireOrg, auditLog("payment_reminder", "CREATE"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const parsed = createReminderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const d = parsed.data;

    let when = new Date();
    if (d.scheduledFor) {
      when = new Date(d.scheduledFor);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ message: "scheduledFor is not a valid date" });
    }
    const sendNow = when.getTime() <= Date.now() + 60_000;

    // The tenant (and arrears record) must belong to the caller's organisation.
    const [tenant] = await db.select({ id: tenants.id, firstName: tenants.firstName }).from(tenants)
      .where(and(eq(tenants.id, d.tenantId), eq(tenants.organizationId, orgId))).limit(1);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    let arr: typeof arrears.$inferSelect | null = null;
    if (d.arrearsId) {
      arr = await ownArrears(d.arrearsId, orgId);
      if (!arr || arr.tenantId !== d.tenantId) return res.status(404).json({ message: "Arrears record not found for this tenant" });
    }

    // A double click must not text the tenant twice.
    const [dup] = await db.select({ id: paymentReminders.id }).from(paymentReminders).where(and(
      eq(paymentReminders.tenantId, d.tenantId), eq(paymentReminders.reminderType, d.reminderType),
      inArray(paymentReminders.status, ["pending", "sending", "sent"]),
      sql`${paymentReminders.createdAt} >= NOW() - INTERVAL '2 minutes'`,
    )).limit(1);
    if (dup && sendNow) return res.status(409).json({ message: "A reminder was sent to this tenant a moment ago", code: "RECENT_REMINDER" });

    let message = d.message;
    if (!message) {
      if (!arr) return res.status(400).json({ message: "Provide a message, or an arrearsId to build one from" });
      const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      message = composeReminderMessage({
        name: tenant.firstName, orgName: org?.name, type: d.reminderType,
        amount: parseFloat(String(arr.outstandingAmount)), currency: arr.currency, daysOverdue: arr.daysOverdue,
      });
    }

    const [row] = await db.insert(paymentReminders).values({
      tenantId: d.tenantId, arrearsId: d.arrearsId ?? null, reminderType: d.reminderType,
      channel: d.channel, message, scheduledFor: when, recipientInfo: { source: "manual", by: String(req.user.userId || req.user.id) },
    }).returning();

    if (!sendNow) return res.status(201).json({ ...row, delivery: { status: "scheduled", channel: d.channel } });

    const outcome = await dispatchReminder(row, { requested: d.channel });
    const [fresh] = await db.select().from(paymentReminders).where(eq(paymentReminders.id, row.id)).limit(1);
    res.status(201).json({ ...fresh, delivery: outcome });
  } catch (err) {
    console.error("Create payment reminder error:", err);
    res.status(500).json({ message: "Failed to create payment reminder" });
  }
});

// PATCH /api/payment-reminders/:id/cancel — a queued reminder can be called off before it goes out.
paymentRemindersRouter.patch("/:id(\\d+)/cancel", authenticateJWT, requireOrg, auditLog("payment_reminder", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const [mine] = await db.select({ id: paymentReminders.id }).from(paymentReminders)
      .where(and(eq(paymentReminders.id, id), sql`${paymentReminders.tenantId} in (select id from tenants where organization_id = ${req.user.organizationId})`)).limit(1);
    if (!mine) return res.status(404).json({ message: "Reminder not found" });
    const done = await db.update(paymentReminders).set({ status: "cancelled" })
      .where(and(eq(paymentReminders.id, id), eq(paymentReminders.status, "pending"))).returning();
    if (!done.length) return res.status(409).json({ message: "Only a reminder that has not gone out yet can be cancelled" });
    res.json(done[0]);
  } catch (err) {
    console.error("Cancel payment reminder error:", err);
    res.status(500).json({ message: "Failed to cancel reminder" });
  }
});

// POST /api/payment-reminders/schedule — queue and send reminders for active arrears not reminded in the last 7 days
paymentRemindersRouter.post("/schedule", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const r = await scheduleAutomaticReminders(orgId);
    res.json({ scheduled: r.created.length, sent: r.sent, failed: r.failed, skipped: r.skipped, reminders: r.created });
  } catch (err) {
    console.error("Schedule reminders error:", err);
    res.status(500).json({ message: "Failed to schedule reminders" });
  }
});

// ── /api/risk-assessments ─────────────────────────────────────────────────────
export const riskAssessmentsRouter = Router();

riskAssessmentsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const tenantId = req.query.tenantId ? parseInt(req.query.tenantId as string) : undefined;
    const assessments = await storage.getRiskAssessments(tenantId);
    res.json(assessments);
  } catch (err) {
    console.error("Get risk assessments error:", err);
    res.status(500).json({ message: "Failed to fetch risk assessments" });
  }
});

// POST /api/risk-assessments/calculate/:tenantId
riskAssessmentsRouter.post("/calculate/:tenantId", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const tenantId = parseInt(req.params.tenantId);
    if (isNaN(tenantId)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }
    // Resolve user UUID from JWT; fall back to nil UUID so the DB insert never fails.
    // req.user.id is set to decoded.userId || decoded.sub in auth middleware.
    const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
    const assessedBy: string =
      req.user?.id || req.user?.userId || (req.user as any)?.sub || SYSTEM_UUID;
    const assessment = await storage.calculateTenantRiskScore(tenantId, assessedBy);
    res.status(201).json(assessment);
  } catch (err) {
    console.error("Calculate risk score error:", err);
    res.status(500).json({ message: "Failed to calculate risk score" });
  }
});

riskAssessmentsRouter.post("/", authenticateJWT, requireOrg, auditLog("risk_assessment", "CREATE"), async (req: any, res) => {
  try {
    const validated = insertRiskAssessmentSchema.parse(req.body);
    const assessment = await storage.createRiskAssessment(validated);
    res.status(201).json(assessment);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create risk assessment error:", err);
    res.status(500).json({ message: "Failed to create risk assessment" });
  }
});

// ── /api/tenant-behavior-logs ─────────────────────────────────────────────────
export const tenantBehaviorLogsRouter = Router();

tenantBehaviorLogsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const tenantId = req.query.tenantId ? parseInt(req.query.tenantId as string) : undefined;
    const logs = await storage.getTenantBehaviorLogs(tenantId);
    res.json(logs);
  } catch (err) {
    console.error("Get behavior logs error:", err);
    res.status(500).json({ message: "Failed to fetch behavior logs" });
  }
});

tenantBehaviorLogsRouter.post("/", authenticateJWT, requireOrg, auditLog("behavior_log", "CREATE"), async (req: any, res) => {
  try {
    const validated = insertTenantBehaviorLogSchema.parse(req.body);
    const log = await storage.createTenantBehaviorLog(validated);
    res.status(201).json(log);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create behavior log error:", err);
    res.status(500).json({ message: "Failed to create behavior log" });
  }
});

// Default export for backward compat (arrearsActionsRouter)
export default arrearsActionsRouter;