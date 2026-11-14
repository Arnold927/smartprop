import { Router } from "express";
import { db } from "../db";
import { maintenanceRequests, workOrders, units, tenants, insertMaintenanceRequestSchema } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import {
  loadRequestCtx, callerCanAccess as callerCanAccessImpl, resolveScopedRequest as resolveScopedRequestImpl,
  exceedsApprovalThreshold as exceedsApprovalThresholdImpl, transition, actionForStatusChange,
  filterGenericFields, normalizeMoney, isAssigneeOfRequest, actorFromReq, WorkflowError, notifyOversight,
  type RequestStatus, type WorkflowAction,
} from "../services/maintenance-workflow";
import { notifyTenant } from "../services/notifyTenant";

// Kept as re-exports: other route files import these from here. The logic lives in the workflow service.
export const resolveScopedRequest = resolveScopedRequestImpl;
export const callerCanAccess = callerCanAccessImpl;
export const exceedsApprovalThreshold = exceedsApprovalThresholdImpl;

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

router.get("/:id", async (req: any, res: any, next: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next(); // "/approvals" etc. are handled further down
    const row = await resolveScopedRequest(id, req.user.organizationId);
    if (!row || !(await callerCanAccess(row, req))) {
      return res.status(404).json({ message: "Not found" });
    }
    const [full] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
    // Internal working notes never go to the tenant.
    if (req.user.role === "tenant") { delete (full as any).technicianNotes; delete (full as any).internalNotes; }
    res.json(full);
  } catch (err) {
    console.error("[maintenance-item-guard] GET /:id:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

const DATE_FIELDS = ["scheduledDate", "followUpDate"];

/**
 * Generic edit. Descriptive fields (title, description, category, priority, costs, notes, schedule…) are
 * edited here; the things that MOVE a request through its life (status, assignee, approval, timestamps,
 * rating) are not plain fields — a status in the body is turned into the matching workflow action, so
 * every screen gets the same rules, timestamps, notifications and live updates.
 */
async function handleUpdate(req: any, res: any) {
  try {
    const role: string = req.user.role ?? "";
    // Tenants submit (POST /), withdraw/reopen (workflow routes) and rate — they never edit a request.
    if (role === "tenant") return res.status(403).json({ message: "Not permitted." });

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
    const ctx = await loadRequestCtx(id, req.user.organizationId);
    if (!ctx || !(await callerCanAccess(ctx, req))) return res.status(404).json({ message: "Not found" });

    const actor = actorFromReq(req);
    const mine = await isAssigneeOfRequest(actor, ctx);
    const body = req.body ?? {};

    // A technician may only touch their own job.
    if ((role === "staff" || role === "caretaker") && !mine) {
      return res.status(403).json({ message: "This job isn't assigned to you." });
    }

    const editable = normalizeMoney(filterGenericFields(role, mine, body));
    const validated: Record<string, any> = insertMaintenanceRequestSchema.partial().parse(editable);
    for (const f of DATE_FIELDS) if (validated[f]) validated[f] = new Date(validated[f]);

    // A mis-filed request can be moved to another unit/tenant — but only inside this organisation.
    if (validated.unitId !== undefined || validated.tenantId !== undefined) {
      const orgId = req.user.organizationId;
      if (validated.unitId !== undefined) {
        const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, validated.unitId), eq(units.organizationId, orgId))).limit(1);
        if (!u) return res.status(400).json({ message: "That unit isn't in your organisation." });
      }
      if (validated.tenantId !== undefined) {
        const [t] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, validated.tenantId), eq(tenants.organizationId, orgId))).limit(1);
        if (!t) return res.status(400).json({ message: "That tenant isn't in your organisation." });
      }
    }

    // 1. Status change → workflow action (validated before anything is written).
    const wanted = body.status as RequestStatus | undefined;
    let current: any = null;
    if (wanted && wanted !== ctx.status) {
      const action = actionForStatusChange(ctx.status, wanted);
      if (!action) return res.status(400).json({ message: `A request can't go from ${ctx.status.replace("_", " ")} to ${String(wanted).replace("_", " ")}.` });
      if (action === "assign-needs-target") {
        return res.status(400).json({ message: "Choose who should do the work — use Assign technician." });
      }
      current = await transition(id, action as WorkflowAction, actor, {
        reason: body.reason ?? body.rejectionReason,
        comments: body.comments,
        technicianNotes: validated.technicianNotes,
        actualCost: validated.actualCost,
        totalTimeSpent: validated.totalTimeSpent,
      });
    }

    // 2. Plain field edits.
    let updated = current;
    if (Object.keys(validated).length > 0) {
      // A cost raised above the PM-agreement threshold on a request nobody has started yet needs sign-off first.
      const status = (current?.status ?? ctx.status) as RequestStatus;
      if (validated.estimatedCost !== undefined && status === "pending"
          && await exceedsApprovalThreshold(ctx.unitId, validated.estimatedCost)) {
        validated.status = "pending_approval";
        validated.approvalRequired = true;
        validated.approvedBy = null; validated.approvedDate = null; validated.rejectionReason = null;
        notifyOversight(req.user.organizationId, ctx, "Request needs your approval", `${ctx.title ?? ctx.ticketNumber} (#${ctx.ticketNumber}) — the estimated cost is above the approval limit.`, [actor.id]).catch(() => {});
      }
      [updated] = await db
        .update(maintenanceRequests)
        .set({ ...validated, updatedAt: new Date() } as any)
        .where(eq(maintenanceRequests.id, id))
        .returning();
    }
    if (!updated) [updated] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
    // A visit was (re)scheduled → tell the tenant.
    if (validated.scheduledDate && ctx.tenantId && ["pending", "assigned", "in_progress"].includes(updated.status)) {
      notifyTenant(ctx.tenantId, { type: "maintenance_scheduled", ticketNumber: ctx.ticketNumber, scheduledDate: new Date(validated.scheduledDate).toISOString() }).catch(() => {});
    }
    res.json(updated);
  } catch (err: any) {
    if (err instanceof WorkflowError) return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[maintenance-item-guard] update:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

router.put("/:id", handleUpdate);
router.patch("/:id", handleUpdate);

// Deleting erases the request's history. Only the people who run the organisation may do it;
// everyone else cancels instead (which keeps the record).
router.delete("/:id", async (req: any, res: any) => {
  try {
    const role: string = req.user.role ?? "";
    if (!["platform_admin", "admin", "manager"].includes(role)) {
      return res.status(403).json({ message: "Only an admin or manager can delete a request. Cancel it instead to keep the record." });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
    const row = await resolveScopedRequest(id, req.user.organizationId);
    if (!row || !(await callerCanAccess(row, req))) return res.status(404).json({ message: "Not found" });

    const live = await db.select({ id: workOrders.id }).from(workOrders)
      .where(and(eq(workOrders.maintenanceRequestId, id), inArray(workOrders.status as any, ["assigned", "in_progress", "on_hold"]))).limit(1);
    if (live.length) return res.status(409).json({ message: "A contractor is working on this request. Cancel it first." });

    try {
      await db.delete(maintenanceRequests).where(eq(maintenanceRequests.id, id));
    } catch (e: any) {
      if (e?.code === "23503") return res.status(409).json({ message: "This request has linked records (work orders, comments or documents) and can't be deleted. Cancel it instead." });
      throw e;
    }
    res.status(204).send();
  } catch (err) {
    console.error("[maintenance-item-guard] DELETE /:id:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
