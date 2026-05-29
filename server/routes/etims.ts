/**
 * etims.ts — mounted at /api/etims
 *
 * All eTIMS endpoints require authentication + org membership.
 * The sandbox flag is read from the ETIMS_SANDBOX env var (default: true).
 *
 * Endpoints:
 *   GET  /status              — device status + sandbox flag
 *   POST /device              — save TIN/BHF credentials
 *   POST /initialise          — register device with KRA
 *   POST /codes               — fetch/refresh KRA code lookups
 *   POST /submit              — submit a single invoice or rent payment
 *   POST /submit-batch        — submit multiple invoices in one call
 *   GET  /submissions         — paginated list of all submissions
 *   GET  /submissions/:id     — single submission detail
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { auditLog }        from "../middleware/auditLog";
import * as etims          from "../services/etims";
import { db }              from "../db";
import { etimsInvoices }   from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// ── GET /api/etims/status ─────────────────────────────────────────────────────

router.get("/status", ...auth, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const device = await etims.getDeviceStatus(orgId);

    // Summary stats
    const [stats] = await db.select({
      total:    sql<number>`COUNT(*)`,
      accepted: sql<number>`SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END)`,
      pending:  sql<number>`SUM(CASE WHEN status IN ('pending','submitted') THEN 1 ELSE 0 END)`,
      rejected: sql<number>`SUM(CASE WHEN status IN ('rejected','error') THEN 1 ELSE 0 END)`,
    }).from(etimsInvoices).where(eq(etimsInvoices.organizationId, orgId));

    res.json({
      device,
      sandbox: process.env.ETIMS_SANDBOX !== "false",
      stats:   {
        total:    Number(stats?.total    ?? 0),
        accepted: Number(stats?.accepted ?? 0),
        pending:  Number(stats?.pending  ?? 0),
        rejected: Number(stats?.rejected ?? 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/etims/device ────────────────────────────────────────────────────

const deviceSchema = z.object({
  tin:          z.string().min(3).max(20),
  bhfId:        z.string().min(1).max(10).default("00"),
  deviceSerial: z.string().optional(),
  sandbox:      z.boolean().optional(),
});

router.post("/device", ...auth, auditLog("etims_device", "UPDATE") as any, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const parsed = deviceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.flatten() });
    const device = await etims.upsertDeviceInfo(orgId, parsed.data);
    res.json(device);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/etims/initialise ────────────────────────────────────────────────

router.post("/initialise", ...auth, auditLog("etims_device", "ACTION") as any, async (req: any, res: any) => {
  try {
    const result = await etims.initialiseDevice(req.user.organizationId);
    res.json(result);
  } catch (err: any) {
    const status = err.message?.includes("not configured") ? 400 : 502;
    res.status(status).json({ message: err.message });
  }
});

// ── POST /api/etims/codes ─────────────────────────────────────────────────────

router.post("/codes", ...auth, async (req: any, res: any) => {
  try {
    await etims.fetchCodeLookup(req.user.organizationId);
    res.json({ message: "Code lists refreshed" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/etims/submit ────────────────────────────────────────────────────

const submitSchema = z.object({
  sourceType:      z.enum(["invoice", "rent_payment"]),
  sourceId:        z.number().int().positive(),
  isVatRegistered: z.boolean().optional().default(false),
});

router.post("/submit", ...auth, auditLog("etims_invoice", "CREATE") as any, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.flatten() });
    const result = await etims.submitInvoice(orgId, parsed.data.sourceType, parsed.data.sourceId, parsed.data.isVatRegistered);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.message?.includes("not active") ? 400 : err.message?.includes("rejected") ? 422 : 500;
    res.status(status).json({ message: err.message });
  }
});

// ── POST /api/etims/submit-batch ──────────────────────────────────────────────

const batchSchema = z.object({
  items: z.array(z.object({
    sourceType:      z.enum(["invoice", "rent_payment"]),
    sourceId:        z.number().int().positive(),
    isVatRegistered: z.boolean().optional().default(false),
  })).min(1).max(100),
});

router.post("/submit-batch", ...auth, auditLog("etims_invoice", "CREATE") as any, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.flatten() });

    const results = await Promise.allSettled(
      parsed.data.items.map(item =>
        etims.submitInvoice(orgId, item.sourceType, item.sourceId, item.isVatRegistered)
      )
    );

    const summary = results.map((r, i) => ({
      ...parsed.data.items[i],
      status:  r.status === "fulfilled" ? "submitted" : "error",
      result:  r.status === "fulfilled" ? r.value : undefined,
      error:   r.status === "rejected"  ? (r.reason as Error).message : undefined,
    }));

    const succeeded = summary.filter(s => s.status === "submitted").length;
    const failed    = summary.filter(s => s.status === "error").length;

    res.status(207).json({ succeeded, failed, results: summary });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/etims/submissions ────────────────────────────────────────────────

router.get("/submissions", ...auth, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const limit  = Math.min(200, parseInt(String(req.query.limit  ?? 50), 10));
    const offset = Math.max(0,   parseInt(String(req.query.offset ?? 0),  10));
    const rows   = await etims.getSubmissions(orgId, limit, offset);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/etims/submissions/:id ────────────────────────────────────────────

router.get("/submissions/:id(\\d+)", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const id    = parseInt(req.params.id, 10);
    const [row] = await db.select().from(etimsInvoices)
      .where(and(eq(etimsInvoices.id, id), eq(etimsInvoices.organizationId, orgId)));
    if (!row) return res.status(404).json({ message: "Submission not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
