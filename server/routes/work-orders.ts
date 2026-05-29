/**
 * Work-orders router — mounted at /api/work-orders
 *
 * Changes vs. original:
 *  1. requireOrg guard on every route.
 *  2. GET / is org-scoped and supports server-side pagination (?page=&limit=).
 *  3. GET /:id verifies the work-order belongs to the caller's org.
 *  4. PUT /:id and DELETE /:id are org-scoped to prevent cross-org mutations.
 *  5. Sub-resource routes (comments, tasks, etc.) also verify org ownership.
 */
import { Router } from "express";
import { db } from "../db";
import { workOrders, maintenanceRequests, tenants, units, properties, contractors, propertyExpenses } from "@shared/schema";
import { eq, and, or, sql, count } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { insertWorkOrderSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function parsePage(q: any) {
  const page  = Math.max(1, parseInt(q.page  as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit as string) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

/** Returns true if the work-order belongs to the calling org.
 *
 * Work orders may be linked to a maintenance request (the normal path) or may
 * be standalone (e.g. project-type with no tenant request).  We check both:
 *  1. Via maintenanceRequest → tenant → organizationId  (maintenance-linked WOs)
 *  2. Via contractor → organizationId                   (standalone WOs)
 */
async function workOrderBelongsToOrg(id: number, orgId: number): Promise<boolean> {
  // Path 1: maintenance-linked work order
  const [viaRequest] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .innerJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
    .innerJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
    .where(and(eq(workOrders.id, id), eq(tenants.organizationId, orgId)))
    .limit(1);
  if (viaRequest) return true;

  // Path 2: standalone work order — scope via the assigned contractor's org
  const [viaContractor] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .innerJoin(contractors, eq(workOrders.contractorId, contractors.id))
    .where(and(eq(workOrders.id, id), eq(contractors.organizationId, orgId)))
    .limit(1);
  return !!viaContractor;
}

/** Resolves property/contractor context needed for expense creation */
async function resolveWorkOrderContext(workOrderId: number) {
  const [row] = await db
    .select({
      workOrderId: workOrders.id,
      title: workOrders.title,
      actualCost: workOrders.actualCost,
      estimatedCost: workOrders.estimatedCost,
      currency: workOrders.currency,
      contractorId: workOrders.contractorId,
      contractorName: contractors.companyName,
      category: maintenanceRequests.category,
      propertyId: units.propertyId,
      propertyName: properties.name,
      ticketNumber: workOrders.ticketNumber,
    })
    .from(workOrders)
    .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
    .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .leftJoin(contractors, eq(workOrders.contractorId, contractors.id))
    .where(eq(workOrders.id, workOrderId))
    .limit(1);
  return row ?? null;
}

/** Build org-scoped conditions for work orders */
function buildOrgConditions(orgId: number, maintenanceRequestId?: number, projectId?: number) {
  const conditions = [eq(tenants.organizationId, orgId)];
  
  if (maintenanceRequestId) {
    conditions.push(eq(workOrders.maintenanceRequestId, maintenanceRequestId) as any);
  }
  if (projectId) {
    conditions.push(eq(workOrders.projectId, projectId) as any);
  }
  return conditions;
}

// ── GET /api/work-orders ──────────────────────────────────────────────────────
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const { page, limit, offset } = parsePage(req.query);

    const maintenanceRequestId = req.query.maintenanceRequestId
      ? parseInt(req.query.maintenanceRequestId as string)
      : undefined;
    const projectId = req.query.projectId
      ? parseInt(req.query.projectId as string)
      : undefined;

    // When filtering by a specific maintenanceRequestId, skip the tenant org-scope
    // join — the request may have no tenant and the join would silently exclude those work orders.
    let rows: { workOrder: any }[];
    let total: number;

    if (maintenanceRequestId) {
      // Still scope by org: verify the maintenance request belongs to this org
      // via its unit → organizationId, then return the work order if it matches.
      const directConditions = [
        eq(workOrders.maintenanceRequestId, maintenanceRequestId),
        // Org scope: join through maintenanceRequests → units → organizationId
        eq(units.organizationId, orgId),
      ];
      [rows, [{ total }]] = await Promise.all([
        db
          .select({ workOrder: workOrders })
          .from(workOrders)
          .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
          .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
          .where(and(...directConditions))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(workOrders)
          .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
          .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
          .where(and(...directConditions)),
      ]);
    } else {
      const conditions = buildOrgConditions(orgId, undefined, projectId);
      [rows, [{ total }]] = await Promise.all([
        db
          .select({ workOrder: workOrders })
          .from(workOrders)
          .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
          .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
          .where(and(...conditions))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(workOrders)
          .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
          .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
          .where(and(...conditions)),
      ]);
    }

    res.json({
      count: total,
      page,
      limit,
      next:     page * limit < total ? `?page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?page=${page - 1}&limit=${limit}` : null,
      results:  rows.map(r => r.workOrder),
    });
  } catch (error) {
    console.error("Get work orders error:", error);
    res.status(500).json({ message: "Failed to fetch work orders" });
  }
});

// ── GET /api/work-orders/:id ──────────────────────────────────────────────────
router.get("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const workOrder = await storage.getWorkOrder(id);
    if (!workOrder) return res.status(404).json({ message: "Work order not found" });

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(workOrder);
  } catch (error) {
    console.error("Get work order error:", error);
    res.status(500).json({ message: "Failed to fetch work order" });
  }
});

// ── POST /api/work-orders ─────────────────────────────────────────────────────
router.post("/", authenticateJWT, requireOrg, auditLog("work_order", "CREATE"), async (req: any, res) => {
  try {
    const validated = insertWorkOrderSchema.parse({
      ...req.body,
      createdBy: req.user.userId || req.user.id,
      estimatedStartDate: req.body.estimatedStartDate
        ? new Date(req.body.estimatedStartDate)
        : undefined,
      estimatedEndDate: req.body.estimatedEndDate
        ? new Date(req.body.estimatedEndDate)
        : undefined,
    });
    const workOrder = await storage.createWorkOrder(validated);
    res.status(201).json(workOrder);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid work order data", errors: error.errors });
    }
    console.error("Create work order error:", error);
    res.status(500).json({ message: "Failed to create work order" });
  }
});

// ── PUT /api/work-orders/:id ──────────────────────────────────────────────────
router.put("/:id", authenticateJWT, requireOrg, auditLog("work_order", "UPDATE"), async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const validated = insertWorkOrderSchema.partial().parse({
      ...req.body,
      estimatedStartDate: req.body.estimatedStartDate
        ? new Date(req.body.estimatedStartDate)
        : undefined,
      estimatedEndDate: req.body.estimatedEndDate
        ? new Date(req.body.estimatedEndDate)
        : undefined,
    });
    const previousWorkOrder = await storage.getWorkOrder(id);
    const workOrder = await storage.updateWorkOrder(id, validated);

    // ── Auto-create expense record when work order is completed with a cost ──
    const isNowComplete = validated.status === "completed" && previousWorkOrder?.status !== "completed";
    const cost = validated.actualCost ?? previousWorkOrder?.actualCost;
    if (isNowComplete && cost && parseFloat(String(cost)) > 0) {
      try {
        const ctx = await resolveWorkOrderContext(id);
        if (ctx?.propertyId) {
          const categoryMap: Record<string, string> = {
            plumbing: "maintenance", electrical: "maintenance", hvac: "maintenance",
            carpentry: "maintenance", painting: "maintenance", cleaning: "maintenance",
            landscaping: "maintenance", appliance: "maintenance", security: "maintenance",
          };
          const expCategory = categoryMap[ctx.category ?? ""] ?? "maintenance";
          const expNumber = `EXP-WO-${id}-${Date.now()}`;
          await storage.createPropertyExpense({
            expenseNumber: expNumber,
            propertyId: ctx.propertyId,
            contractorId: ctx.contractorId ?? null,
            vendorName: ctx.contractorName ?? "Contractor",
            description: `Work Order #${ctx.ticketNumber}: ${ctx.title}`,
            amount: String(cost),
            currency: ctx.currency ?? "KES",
            category: expCategory,
            expenseDate: new Date(),
            isRecurring: false,
            notes: `Auto-posted from work order completion. WO ID: ${id}`,
            createdBy: req.user.userId ?? req.user.id,
          });
        }
      } catch (expErr) {
        // Non-fatal: log but don't fail the work order update
        console.error("[finance] Auto-expense creation failed (non-fatal):", expErr);
      }
    }

    res.json(workOrder);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid work order data", errors: error.errors });
    }
    console.error("Update work order error:", error);
    res.status(500).json({ message: "Failed to update work order" });
  }
});

// ── DELETE /api/work-orders/:id ───────────────────────────────────────────────
router.delete("/:id", authenticateJWT, requireOrg, auditLog("work_order", "DELETE"), async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    await storage.deleteWorkOrder(id);
    res.status(204).send();
  } catch (error) {
    console.error("Delete work order error:", error);
    res.status(500).json({ message: "Failed to delete work order" });
  }
});

// ── GET /api/work-orders/:id/comments ────────────────────────────────────────
router.get("/:id/comments", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const comments = await storage.getWorkOrderComments(id);
    res.json(comments);
  } catch (error) {
    console.error("Get work order comments error:", error);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
});

// ── POST /api/work-orders/:id/comments ───────────────────────────────────────
router.post("/:id/comments", authenticateJWT, requireOrg, auditLog("work_order_comment", "CREATE"), async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const { comment } = req.body;

    if (!comment?.trim()) return res.status(400).json({ message: "Comment is required" });

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const newComment = await storage.addWorkOrderComment({
      workOrderId: id,
      userId: req.user.id,
      userName: `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Unknown",
      userAvatar: null,
      content: comment.trim(),
    });

    res.status(201).json(newComment);
  } catch (error) {
    console.error("Add work order comment error:", error);
    res.status(500).json({ message: "Failed to add comment" });
  }
});

// ── GET /api/work-orders/:workOrderId/tasks ───────────────────────────────────
router.get("/:workOrderId/tasks", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(workOrderId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const tasks = await storage.getWorkOrderTasks(workOrderId);
    res.json(tasks);
  } catch (error) {
    console.error("Get work order tasks error:", error);
    res.status(500).json({ message: "Failed to fetch tasks" });
  }
});

// ── GET /api/work-orders/:workOrderId/expenses ────────────────────────────────
router.get("/:workOrderId/expenses", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(workOrderId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const expenses = await storage.getWorkOrderExpenses(workOrderId);
    res.json(expenses);
  } catch (error) {
    console.error("Get work order expenses error:", error);
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
});

// ── GET /api/work-orders/:workOrderId/approvals ───────────────────────────────
router.get("/:workOrderId/approvals", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(workOrderId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const approvals = await storage.getWorkOrderApprovals(workOrderId);
    res.json(approvals);
  } catch (error) {
    console.error("Get work order approvals error:", error);
    res.status(500).json({ message: "Failed to fetch approvals" });
  }
});

// ── GET /api/work-orders/:workOrderId/progress ────────────────────────────────
router.get("/:workOrderId/progress", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(workOrderId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const progress = await storage.getWorkOrderProgress(workOrderId);
    res.json(progress);
  } catch (error) {
    console.error("Get work order progress error:", error);
    res.status(500).json({ message: "Failed to fetch progress" });
  }
});

// ── GET /api/work-orders/:id/cost-summary ────────────────────────────────────
router.get("/:id/cost-summary", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    if (!(await workOrderBelongsToOrg(id, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const workOrder = await storage.getWorkOrder(id);
    if (!workOrder) return res.status(404).json({ message: "Work order not found" });

    const materials = await storage.getWorkOrderMaterials?.(id) ?? [];
    const expenses  = await storage.getWorkOrderExpenses(id);

    const materialCost  = materials.reduce((s: number, m: any) => s + Number(m.totalCost ?? 0), 0);
    const expenseCost   = expenses.reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
    const estimatedCost = Number(workOrder.estimatedCost ?? 0);
    const total         = materialCost + expenseCost;

    res.json({ materialCost, expenseCost, estimatedCost, total, variance: total - estimatedCost });
  } catch (error) {
    console.error("Cost summary error:", error);
    res.status(500).json({ message: "Failed to fetch cost summary" });
  }
});

// ── POST /api/work-orders/:id/post-to-ledger ─────────────────────────────────
// Manually create a property_expenses record from a work order's actual (or estimated) cost.
// Idempotent guard: returns 409 if an expense with this WO reference already exists.
router.post(
  "/:id/post-to-ledger",
  authenticateJWT,
  requireOrg,
  auditLog("work_order", "POST_TO_LEDGER"),
  async (req: any, res) => {
    try {
      const id    = parseInt(req.params.id);
      const orgId: number = req.user.organizationId;

      if (!(await workOrderBelongsToOrg(id, orgId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const workOrder = await storage.getWorkOrder(id);
      if (!workOrder) return res.status(404).json({ message: "Work order not found" });

      const cost = workOrder.actualCost ?? workOrder.estimatedCost;
      if (!cost || parseFloat(String(cost)) <= 0) {
        return res.status(400).json({
          message: "Work order has no cost to post. Set actual cost before posting to ledger.",
        });
      }

      // Idempotency: check for an existing expense with the same WO reference
      const [existing] = await db
        .select({ id: propertyExpenses.id })
        .from(propertyExpenses)
        .where(sql`${propertyExpenses.notes} LIKE ${"%" + `WO ID: ${id}`}`)
        .limit(1);

      if (existing) {
        return res.status(409).json({
          message: "This work order has already been posted to the expense ledger.",
          expenseId: existing.id,
        });
      }

      const ctx = await resolveWorkOrderContext(id);
      if (!ctx?.propertyId) {
        return res.status(422).json({
          message: "Could not resolve the property for this work order. Ensure the linked maintenance request has a unit.",
        });
      }

      const categoryMap: Record<string, string> = {
        plumbing: "maintenance", electrical: "maintenance", hvac: "maintenance",
        carpentry: "maintenance", painting: "maintenance", cleaning: "maintenance",
        landscaping: "maintenance", appliance: "maintenance", security: "maintenance",
      };
      const expCategory = categoryMap[ctx.category ?? ""] ?? "maintenance";
      const expNumber = `EXP-WO-${id}-${Date.now()}`;

      const expense = await storage.createPropertyExpense({
        expenseNumber: expNumber,
        propertyId: ctx.propertyId,
        contractorId: ctx.contractorId ?? null,
        vendorName: ctx.contractorName ?? "Contractor",
        description: `Work Order #${ctx.ticketNumber}: ${ctx.title}`,
        amount: String(cost),
        currency: ctx.currency ?? "KES",
        category: expCategory,
        expenseDate: new Date(),
        isRecurring: false,
        notes: `Manually posted to ledger. WO ID: ${id}`,
        createdBy: req.user.userId ?? req.user.id,
      });

      res.status(201).json({
        message: "Successfully posted to expense ledger.",
        expense,
      });
    } catch (error) {
      console.error("Post-to-ledger error:", error);
      res.status(500).json({ message: "Failed to post work order to ledger" });
    }
  }
);

export default router;