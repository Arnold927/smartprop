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
import {
  insertArrearsActionSchema,
  insertPaymentReminderSchema,
  insertRiskAssessmentSchema,
  insertTenantBehaviorLogSchema,
} from "@shared/schema";
import { z } from "zod";

// ── /api/arrears-actions ──────────────────────────────────────────────────────
export const arrearsActionsRouter = Router();

arrearsActionsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const arrearsId = req.query.arrearsId ? parseInt(req.query.arrearsId as string) : undefined;
    const actions = await storage.getArrearsActions(arrearsId);
    res.json(actions);
  } catch (err) {
    console.error("Get arrears actions error:", err);
    res.status(500).json({ message: "Failed to fetch arrears actions" });
  }
});

arrearsActionsRouter.post("/", authenticateJWT, requireOrg, auditLog("arrears_action", "CREATE"), async (req: any, res) => {
  try {
    const validated = insertArrearsActionSchema.parse(req.body);
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
    const reminders = await storage.getPaymentReminders(status);
    res.json(reminders);
  } catch (err) {
    console.error("Get payment reminders error:", err);
    res.status(500).json({ message: "Failed to fetch payment reminders" });
  }
});

paymentRemindersRouter.post("/", authenticateJWT, requireOrg, auditLog("payment_reminder", "CREATE"), async (req: any, res) => {
  try {
    // Coerce scheduledFor from ISO string → Date before schema validation
    const body = {
      ...req.body,
      scheduledFor: req.body.scheduledFor ? new Date(req.body.scheduledFor) : new Date(),
    };
    const validated = insertPaymentReminderSchema.parse(body);
    const reminder = await storage.createPaymentReminder(validated);
    res.status(201).json(reminder);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create payment reminder error:", err);
    res.status(500).json({ message: "Failed to create payment reminder" });
  }
});

// POST /api/payment-reminders/schedule — auto-schedule reminders for active arrears
paymentRemindersRouter.post("/schedule", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const reminders = await storage.scheduleAutomaticReminders(orgId);
    res.json({ scheduled: reminders.length, reminders });
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