/**
 * Arrears router — mounted at /api/arrears
 *
 * Security: every route is gated by requireOrg and all storage calls
 * are scoped to req.user.organizationId, preventing cross-org data leaks.
 *
 *  1. requireOrg guard on every route.
 *  2. GET / supports server-side pagination (?page=&limit=).
 *  3. All reads/writes pass orgId to the storage layer.
 *  4. PUT /:id returns 404 when the record belongs to a different org.
 */
import { Router } from "express";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { insertArrearsSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// ── GET /api/arrears ─────────────────────────────────────────────────────────
// ?status=active  &page=1  &limit=20
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const { status } = req.query;

    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    // DB-level pagination — never loads the full table into memory.
    const { rows, total } = await storage.getArrears(
      orgId,
      status as string | undefined,
      { limit, offset }
    );

    res.json({
      count:    total,
      page,
      limit,
      next:     page * limit < total ? `?page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?page=${page - 1}&limit=${limit}` : null,
      results:  rows,
    });
  } catch (err) {
    console.error("Get arrears error:", err);
    res.status(500).json({ message: "Failed to fetch arrears" });
  }
});

// ── POST /api/arrears ────────────────────────────────────────────────────────
router.post("/", authenticateJWT, requireOrg, auditLog("arrears", "CREATE"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    // Stamp organizationId onto the payload so it is always set to the
    // caller's org — regardless of whatever the request body contains.
    const validated = insertArrearsSchema.parse({ ...req.body, organizationId: orgId });
    const arrears = await storage.createArrears(validated);
    res.status(201).json(arrears);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid arrears data", errors: err.errors });
    }
    console.error("Create arrears error:", err);
    res.status(500).json({ message: "Failed to create arrears record" });
  }
});

// ── PUT /api/arrears/:id ─────────────────────────────────────────────────────
router.put("/:id", authenticateJWT, requireOrg, auditLog("arrears", "UPDATE"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const validated = insertArrearsSchema.partial().parse(req.body);

    // updateArrears appends AND organization_id = orgId to the WHERE clause,
    // so it returns undefined when the record belongs to a different org.
    const arrears = await storage.updateArrears(id, orgId, validated);

    if (!arrears) {
      return res.status(404).json({ message: "Arrears record not found" });
    }

    res.json(arrears);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid arrears data", errors: err.errors });
    }
    console.error("Update arrears error:", err);
    res.status(500).json({ message: "Failed to update arrears" });
  }
});

// ── POST /api/arrears/detect ──────────────────────────────────────────────────
router.post("/detect", authenticateJWT, requireOrg, auditLog("arrears", "ACTION"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const detected = await storage.detectArrears(orgId);
    res.json(detected);
  } catch (err) {
    console.error("Detect arrears error:", err);
    res.status(500).json({ message: "Failed to detect arrears" });
  }
});

export default router;
