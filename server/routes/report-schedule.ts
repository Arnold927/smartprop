/**
 * report-schedule.ts — mounted at /api/report-schedule
 *
 * Lets org admins/managers enable/disable automated monthly statement emails
 * and trigger a manual send-now for a given property+month.
 *
 * GET  /api/report-schedule         — fetch current toggle state for this org
 * PUT  /api/report-schedule         — enable/disable + configure delivery day
 * POST /api/report-schedule/send-now — trigger an immediate report for a property+month
 */

import { Router }   from "express";
import { db }       from "../db";
import { organizationSettings } from "@shared/schema";
import { eq }       from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { runMonthlyReportJob } from "../services/reportScheduler";

export const reportScheduleRouter = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Helper: get-or-create org settings row ─────────────────────────────────

async function getOrCreateSettings(orgId: number) {
  let [s] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  if (!s) {
    [s] = await db
      .insert(organizationSettings)
      .values({ organizationId: orgId })
      .returning();
  }
  return s;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/report-schedule
// ══════════════════════════════════════════════════════════════════════════════
reportScheduleRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const settings = await getOrCreateSettings(orgId);
    const es = (settings.emailSettings as any) ?? {};
    const reportSchedule = es.reportSchedule ?? { enabled: false, dayOfMonth: 5 };
    res.json({ reportSchedule });
  } catch (err: any) {
    console.error("report-schedule GET error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/report-schedule
// Body: { enabled: boolean, dayOfMonth?: number (1-28) }
// ══════════════════════════════════════════════════════════════════════════════
reportScheduleRouter.put("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { enabled, dayOfMonth } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "'enabled' must be a boolean" });
    }
    const day = Math.min(28, Math.max(1, parseInt(dayOfMonth ?? "5") || 5));

    const settings = await getOrCreateSettings(orgId);
    const es: any  = (settings.emailSettings as any) ?? {};

    const updatedEs = {
      ...es,
      reportSchedule: { enabled, dayOfMonth: day },
    };

    await db
      .update(organizationSettings)
      .set({ emailSettings: updatedEs, updatedAt: new Date() })
      .where(eq(organizationSettings.organizationId, orgId));

    res.json({ reportSchedule: { enabled, dayOfMonth: day } });
  } catch (err: any) {
    console.error("report-schedule PUT error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/report-schedule/send-now
// Triggers the full monthly job for the previous month immediately.
// Optional body: { year, month } to override the period (for testing).
// ══════════════════════════════════════════════════════════════════════════════
reportScheduleRouter.post("/send-now", ...auth, async (req: any, res: any) => {
  try {
    // Kick off in background — don't hold the HTTP connection
    res.json({ message: "Report job started. Statements will be emailed shortly." });

    runMonthlyReportJob().catch(err => {
      console.error("[ReportScheduler] send-now error:", err);
    });
  } catch (err: any) {
    console.error("report-schedule send-now error:", err);
    res.status(500).json({ message: err.message });
  }
});
