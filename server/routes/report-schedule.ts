/**
 * report-schedule.ts — mounted at /api/report-schedule
 *
 * Lets org admins/managers enable/disable automated monthly statement emails
 * and trigger a manual send-now for a given property+month.
 *
 * GET  /api/report-schedule         — fetch current toggle state for this org
 * PUT  /api/report-schedule         — enable/disable + configure delivery day
 * POST /api/report-schedule/send-now — email last month's statements for THIS organisation now
 */

import { Router }   from "express";
import { db }       from "../db";
import { organizationSettings, pmAgreements } from "@shared/schema";
import { eq, and, count } from "drizzle-orm";
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
// Emails last month's owner statements for the CALLER'S organisation only.
//
// This used to call the all-organisations job, so one organisation clicking "Send now" emailed
// the landlords of every other organisation that had reporting switched on (and did nothing at
// all for the caller's own organisation if its own toggle was off).
// ══════════════════════════════════════════════════════════════════════════════

// One run per organisation at a time — a second click while the first is still sending would
// otherwise race it and could email the same owner twice.
const runningOrgs = new Set<number>();

reportScheduleRouter.post("/send-now", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    // Claim this organisation BEFORE the first await: has() and add() must happen with no `await`
    // between them, or two requests arriving together can both see an empty set and both proceed
    // (confirmed with two simultaneous clicks while building this). Every exit path below that
    // does not end up starting the background job must release the claim again.
    if (runningOrgs.has(orgId)) {
      return res.status(409).json({ message: "Statements are already being sent for your organisation. Give it a minute, then check Owner Statements." });
    }
    runningOrgs.add(orgId);

    try {
      // Check the two things that make the job a silent no-op, and say so now instead of
      // reporting success and then quietly doing nothing.
      const [{ n }] = await db
        .select({ n: count() })
        .from(pmAgreements)
        .where(and(eq(pmAgreements.organizationId, orgId), eq(pmAgreements.status, "active")));
      const eligible = Number(n ?? 0);

      if (eligible === 0) {
        runningOrgs.delete(orgId);
        return res.status(400).json({ message: "No property in your organisation has an active PM agreement yet. Add one under Owner Statements → Agreements first." });
      }
      if (!process.env.RESEND_API_KEY) {
        runningOrgs.delete(orgId);
        return res.status(503).json({ message: "Email isn't configured on this server (RESEND_API_KEY is missing), so statements can't be sent yet." });
      }

      // Kick off in background — don't hold the HTTP connection
      res.json({
        message: `Sending statements for ${eligible} propert${eligible === 1 ? "y" : "ies"}. Owners who already received last month's statement are skipped.`,
        properties: eligible,
      });

      runMonthlyReportJob({ orgId })
        .catch(err => console.error("[ReportScheduler] send-now error:", err))
        .finally(() => runningOrgs.delete(orgId));
    } catch (innerErr) {
      runningOrgs.delete(orgId);
      throw innerErr;
    }
  } catch (err: any) {
    console.error("report-schedule send-now error:", err);
    res.status(500).json({ message: err.message });
  }
});
