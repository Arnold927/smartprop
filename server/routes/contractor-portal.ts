/**
 * Contractor Portal API — mounted at /api/contractor-portal
 *
 * Self-service endpoints for contractors:
 *   GET  /me                          — contractor profile
 *   PATCH /me/availability            — toggle availability
 *   GET  /work-orders                 — all assigned work orders
 *   GET  /work-orders/:id             — single work order detail
 *   PATCH /work-orders/:id/accept     — accept (→ in_progress)
 *   PATCH /work-orders/:id/reject     — reject (+ reason)
 *   PATCH /work-orders/:id/complete   — complete (+ notes + actual cost)
 *   POST  /work-orders/:id/invoice    — submit invoice
 *   GET  /earnings                    — earnings summary + monthly breakdown
 *   GET  /calendar                    — upcoming jobs for calendar view
 *   GET  /ratings                     — reviews & quality rating breakdown
 *   GET  /stats                       — performance statistics
 *   GET  /messages                    — messages with property managers
 *   POST /messages                    — send a message
 */

import { Router } from "express";
import { db } from "../db";
import {
  contractors,
  workOrders,
  maintenanceRequests,
  units,
  properties,
  messages,
  users,
  contractorReviews,
  propertyExpenses,
} from "@shared/schema";
import { eq, and, desc, isNotNull, ne, or, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { notifyNewMessage } from "../ws";
import { pushNotification } from "./notifications";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

async function resolveContractor(userEmail: string, orgId: number) {
  if (!userEmail) return null;
  const [contractor] = await db
    .select()
    .from(contractors)
    .where(and(eq(contractors.email, userEmail.toLowerCase()), eq(contractors.organizationId, orgId)))
    .limit(1);
  return contractor ?? null;
}

async function resolveWorkOrderForContractor(workOrderId: number, contractorId: number) {
  const [row] = await db
    .select({
      workOrder: workOrders,
      property: { id: properties.id, name: properties.name, address: properties.address },
      unit: { id: units.id, unitNumber: units.unitNumber },
      maintenanceRequest: {
        id: maintenanceRequests.id,
        title: maintenanceRequests.title,
        category: maintenanceRequests.category,
        priority: maintenanceRequests.priority,
        description: maintenanceRequests.description,
      },
    })
    .from(workOrders)
    .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
    .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.contractorId, contractorId)))
    .limit(1);
  return row ?? null;
}

// GET /me
router.get("/me", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "No contractor profile found for this account. Please contact your property manager." });
    res.json(contractor);
  } catch (err) {
    console.error("contractor-portal /me error:", err);
    res.status(500).json({ message: "Failed to fetch contractor profile" });
  }
});

// PATCH /me/availability
router.patch("/me/availability", ...auth, async (req: any, res: any) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== "boolean") return res.status(400).json({ message: "isAvailable must be a boolean" });
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const [updated] = await db.update(contractors).set({ isAvailable, updatedAt: new Date() }).where(eq(contractors.id, contractor.id)).returning();
    res.json({ message: "Availability updated", contractor: updated });
  } catch (err) {
    console.error("contractor-portal availability error:", err);
    res.status(500).json({ message: "Failed to update availability" });
  }
});

// GET /work-orders
router.get("/work-orders", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const rows = await db
      .select({
        workOrder: workOrders,
        property: { id: properties.id, name: properties.name, address: properties.address },
        unit: { id: units.id, unitNumber: units.unitNumber },
        maintenanceRequest: { id: maintenanceRequests.id, title: maintenanceRequests.title, category: maintenanceRequests.category, priority: maintenanceRequests.priority, description: maintenanceRequests.description },
      })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(workOrders.contractorId, contractor.id))
      .orderBy(desc(workOrders.createdAt));
    res.json({ contractor, workOrders: rows });
  } catch (err) {
    console.error("contractor-portal /work-orders error:", err);
    res.status(500).json({ message: "Failed to fetch work orders" });
  }
});

// GET /work-orders/:id
router.get("/work-orders/:id", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const row = await resolveWorkOrderForContractor(parseInt(req.params.id), contractor.id);
    if (!row) return res.status(404).json({ message: "Work order not found or not assigned to you" });
    res.json(row);
  } catch (err) {
    console.error("contractor-portal /work-orders/:id error:", err);
    res.status(500).json({ message: "Failed to fetch work order" });
  }
});


// ─── Notification helpers ─────────────────────────────────────────────────────

/**
 * Notify the manager (createdBy) of a work order via in-app bell + optionally
 * notify the tenant via WhatsApp when the status changes meaningfully.
 */
async function notifyWorkOrderEvent(
  workOrderId: number,
  orgId: number,
  opts: {
    managerTitle:   string;
    managerMessage: string;
    managerLink?:   string;
    tenantEvent?:   import("../services/notifyTenant").NotificationEvent;
  }
) {
  try {
    // 1. Get work order context: createdBy + linked maintenance request tenantId
    const [ctx] = await db
      .select({
        createdBy:   workOrders.createdBy,
        ticketNumber: workOrders.ticketNumber,
        tenantId:    maintenanceRequests.tenantId,
      })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .where(eq(workOrders.id, workOrderId))
      .limit(1);

    if (!ctx) return;

    // 2. Push in-app bell to the manager who created the work order
    if (ctx.createdBy) {
      pushNotification(ctx.createdBy, {
        type:    "work_order",
        title:   opts.managerTitle,
        message: opts.managerMessage,
        ts:      new Date().toISOString(),
        link:    opts.managerLink ?? `/work-orders/${workOrderId}`,
      });
    }

    // 3. Notify all org managers/admins as well (in case a different manager
    //    handles this org, they should all see it)
    const managers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          eq(users.role as any, "manager"),
        )
      );
    for (const m of managers) {
      if (m.id !== ctx.createdBy) {
        pushNotification(m.id, {
          type:    "work_order",
          title:   opts.managerTitle,
          message: opts.managerMessage,
          ts:      new Date().toISOString(),
          link:    opts.managerLink ?? `/work-orders/${workOrderId}`,
        });
      }
    }

    // 4. WhatsApp / email the tenant if an event is provided and tenantId exists
    if (opts.tenantEvent && ctx.tenantId) {
      const { notifyTenant } = await import("../services/notifyTenant");
      notifyTenant(ctx.tenantId, opts.tenantEvent).catch((err: any) =>
        console.warn("[contractor-portal] tenant notify failed:", err)
      );
    }
  } catch (err) {
    console.warn("[contractor-portal] notifyWorkOrderEvent failed:", err);
  }
}

// PATCH /work-orders/:id/accept
router.patch("/work-orders/:id/accept", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const row = await resolveWorkOrderForContractor(parseInt(req.params.id), contractor.id);
    if (!row) return res.status(404).json({ message: "Work order not found" });
    if (!["assigned", "approved", "pending_approval"].includes(row.workOrder.status ?? ""))
      return res.status(400).json({ message: `Cannot accept a work order with status '${row.workOrder.status}'` });
    const [updated] = await db.update(workOrders).set({ status: "in_progress", actualStartDate: new Date(), updatedAt: new Date() }).where(eq(workOrders.id, row.workOrder.id)).returning();
    res.json({ message: "Work order accepted", workOrder: updated });

    // Notify manager + tenant (non-blocking)
    notifyWorkOrderEvent(row.workOrder.id, req.user.organizationId, {
      managerTitle:   "Work order accepted",
      managerMessage: `${contractor.name || contractor.companyName} has accepted work order ${row.workOrder.ticketNumber} and started work.`,
      tenantEvent: {
        type:         "maintenance_in_progress",
        ticketNumber: row.workOrder.ticketNumber ?? String(row.workOrder.id),
      },
    }).catch(() => {});
  } catch (err) {
    console.error("contractor-portal accept error:", err);
    res.status(500).json({ message: "Failed to accept work order" });
  }
});

// PATCH /work-orders/:id/reject
router.patch("/work-orders/:id/reject", ...auth, async (req: any, res: any) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: "A rejection reason is required" });
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const row = await resolveWorkOrderForContractor(parseInt(req.params.id), contractor.id);
    if (!row) return res.status(404).json({ message: "Work order not found" });
    if (!["assigned", "approved", "pending_approval"].includes(row.workOrder.status ?? ""))
      return res.status(400).json({ message: `Cannot reject a work order with status '${row.workOrder.status}'` });
    const [updated] = await db.update(workOrders).set({ status: "rejected", rejectionReason: reason.trim(), contractorId: null, updatedAt: new Date() }).where(eq(workOrders.id, row.workOrder.id)).returning();
    res.json({ message: "Work order rejected", workOrder: updated });

    // Notify manager + tenant (non-blocking)
    notifyWorkOrderEvent(row.workOrder.id, req.user.organizationId, {
      managerTitle:   "Work order rejected by contractor",
      managerMessage: `${contractor.name || contractor.companyName} cannot take work order ${row.workOrder.ticketNumber}. Reason: ${reason.trim().slice(0, 100)}`,
      tenantEvent: {
        type:         "maintenance_rejected",
        ticketNumber: row.workOrder.ticketNumber ?? String(row.workOrder.id),
        reason:       reason.trim(),
      },
    }).catch(() => {});
  } catch (err) {
    console.error("contractor-portal reject error:", err);
    res.status(500).json({ message: "Failed to reject work order" });
  }
});

// PATCH /work-orders/:id/complete
router.patch("/work-orders/:id/complete", ...auth, async (req: any, res: any) => {
  try {
    const { completionNotes, actualCost } = req.body;
    if (!completionNotes?.trim()) return res.status(400).json({ message: "Completion notes are required" });
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const row = await resolveWorkOrderForContractor(parseInt(req.params.id), contractor.id);
    if (!row) return res.status(404).json({ message: "Work order not found" });
    if (!["in_progress", "assigned"].includes(row.workOrder.status ?? ""))
      return res.status(400).json({ message: `Cannot complete a work order with status '${row.workOrder.status}'` });
    const updateData: any = { status: "completed", completionNotes: completionNotes.trim(), actualEndDate: new Date(), updatedAt: new Date() };
    if (actualCost !== undefined && !isNaN(Number(actualCost))) updateData.actualCost = String(actualCost);
    const [updated] = await db.update(workOrders).set(updateData).where(eq(workOrders.id, row.workOrder.id)).returning();
    await db.update(contractors).set({ completedJobs: (contractor.completedJobs ?? 0) + 1 }).where(eq(contractors.id, contractor.id));

    // Notify manager + tenant immediately (non-blocking, runs in background after response)
    const _notifyComplete = () => notifyWorkOrderEvent(row.workOrder.id, req.user.organizationId, {
      managerTitle:   "Work order completed",
      managerMessage: `${contractor.name || contractor.companyName} has completed work order ${row.workOrder.ticketNumber}.${actualCost ? ` Actual cost: ${row.workOrder.currency || "KES"} ${Number(actualCost).toLocaleString()}` : ""}`,
      tenantEvent: {
        type:         "maintenance_completed",
        ticketNumber: row.workOrder.ticketNumber ?? String(row.workOrder.id),
      },
    }).catch(() => {});

    // ── Auto-post to expense ledger (mirrors PUT /api/work-orders/:id completion path) ──
    const cost = updateData.actualCost ?? row.workOrder.estimatedCost;
    if (cost && parseFloat(String(cost)) > 0) {
      try {
        // Resolve property context via maintenance request → unit → property
        const [ctx] = await db
          .select({
            propertyId: units.propertyId,
            propertyName: properties.name,
            category: maintenanceRequests.category,
          })
          .from(workOrders)
          .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
          .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
          .leftJoin(properties, eq(units.propertyId, properties.id))
          .where(eq(workOrders.id, row.workOrder.id))
          .limit(1);

        if (ctx?.propertyId) {
          // Idempotency: skip if already posted
          const [existing] = await db
            .select({ id: propertyExpenses.id })
            .from(propertyExpenses)
            .where(sql`${propertyExpenses.notes} LIKE ${"%" + `WO ID: ${row.workOrder.id}`}`)
            .limit(1);

          if (!existing) {
            const categoryMap: Record<string, string> = {
              plumbing: "maintenance", electrical: "maintenance", hvac: "maintenance",
              carpentry: "maintenance", painting: "maintenance", cleaning: "maintenance",
              landscaping: "maintenance", appliance: "maintenance", security: "maintenance",
            };
            const expCategory = categoryMap[ctx.category ?? ""] ?? "maintenance";
            await storage.createPropertyExpense({
              expenseNumber: `EXP-WO-${row.workOrder.id}-${Date.now()}`,
              propertyId: ctx.propertyId,
              contractorId: contractor.id,
              vendorName: contractor.companyName ?? "Contractor",
              description: `Work Order #${row.workOrder.ticketNumber}: ${row.workOrder.title}`,
              amount: String(cost),
              currency: row.workOrder.currency ?? "KES",
              category: expCategory,
              expenseDate: new Date(),
              isRecurring: false,
              notes: `Auto-posted from contractor portal completion. WO ID: ${row.workOrder.id}`,
              createdBy: req.user.userId ?? req.user.id,
            });
          }
        }
      } catch (expErr) {
        // Non-fatal: log but don't fail the completion response
        console.error("[finance] Auto-expense creation failed in contractor portal (non-fatal):", expErr);
      }
    }

    res.json({ message: "Work order completed", workOrder: updated });
    _notifyComplete();
  } catch (err) {
    console.error("contractor-portal complete error:", err);
    res.status(500).json({ message: "Failed to complete work order" });
  }
});

// POST /work-orders/:id/invoice
router.post("/work-orders/:id/invoice", ...auth, async (req: any, res: any) => {
  try {
    const { invoiceAmount, invoiceNotes, invoiceRef } = req.body;
    if (!invoiceAmount || isNaN(Number(invoiceAmount))) return res.status(400).json({ message: "A valid invoice amount is required" });
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });
    const row = await resolveWorkOrderForContractor(parseInt(req.params.id), contractor.id);
    if (!row) return res.status(404).json({ message: "Work order not found" });
    const invoiceMeta = [`\n\n--- INVOICE SUBMITTED ---`, `Amount: ${invoiceAmount}`, invoiceRef ? `Reference: ${invoiceRef}` : null, invoiceNotes ? `Notes: ${invoiceNotes}` : null, `Submitted: ${new Date().toISOString()}`].filter(Boolean).join("\n");
    const currentNotes = row.workOrder.completionNotes ?? "";
    const [updated] = await db.update(workOrders).set({ actualCost: String(invoiceAmount), completionNotes: currentNotes + invoiceMeta, updatedAt: new Date() }).where(eq(workOrders.id, row.workOrder.id)).returning();
    res.json({ message: "Invoice submitted", workOrder: updated });

    // Notify manager (non-blocking)
    notifyWorkOrderEvent(row.workOrder.id, req.user.organizationId, {
      managerTitle:   "Invoice submitted",
      managerMessage: `${contractor.name || contractor.companyName} has submitted an invoice of ${row.workOrder.currency || "KES"} ${Number(invoiceAmount).toLocaleString()} for work order ${row.workOrder.ticketNumber}.`,
    }).catch(() => {});
  } catch (err) {
    console.error("contractor-portal invoice error:", err);
    res.status(500).json({ message: "Failed to submit invoice" });
  }
});

// GET /earnings
router.get("/earnings", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });

    const allWOs = await db
      .select({ id: workOrders.id, actualCost: workOrders.actualCost, estimatedCost: workOrders.estimatedCost, currency: workOrders.currency, actualEndDate: workOrders.actualEndDate, createdAt: workOrders.createdAt, status: workOrders.status, title: workOrders.title, ticketNumber: workOrders.ticketNumber })
      .from(workOrders)
      .where(and(eq(workOrders.contractorId, contractor.id), ne(workOrders.status, "rejected"), ne(workOrders.status, "cancelled")))
      .orderBy(desc(workOrders.actualEndDate));

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let totalEarned = 0, pendingPayment = 0, thisMonthEarned = 0;

    const monthlyMap: Record<string, { month: string; earned: number; jobs: number }> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyMap[key] = { month: d.toLocaleString("en-KE", { month: "short", year: "2-digit" }), earned: 0, jobs: 0 };
    }

    for (const wo of allWOs) {
      const cost = Number(wo.actualCost ?? wo.estimatedCost ?? 0);
      if (wo.status === "completed") {
        totalEarned += cost;
        const end = wo.actualEndDate ? new Date(wo.actualEndDate) : null;
        if (end && end.getMonth() === thisMonth && end.getFullYear() === thisYear) thisMonthEarned += cost;
        const endDate = end ?? new Date(wo.createdAt!);
        const key = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`;
        if (monthlyMap[key]) { monthlyMap[key].earned += cost; monthlyMap[key].jobs += 1; }
      } else if (["in_progress", "assigned"].includes(wo.status ?? "")) {
        pendingPayment += cost;
      }
    }

    const recentTransactions = allWOs.filter(wo => wo.status === "completed" && wo.actualCost).slice(0, 10).map(wo => ({ id: wo.id, ticketNumber: wo.ticketNumber, title: wo.title, amount: Number(wo.actualCost), currency: wo.currency ?? "KES", date: wo.actualEndDate }));

    res.json({ totalEarned, pendingPayment, thisMonthEarned, currency: contractor.currency ?? "KES", monthly: Object.values(monthlyMap), recentTransactions });
  } catch (err) {
    console.error("contractor-portal /earnings error:", err);
    res.status(500).json({ message: "Failed to fetch earnings" });
  }
});

// GET /calendar
router.get("/calendar", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });

    const rows = await db
      .select({ workOrder: workOrders, property: { id: properties.id, name: properties.name, address: properties.address }, unit: { id: units.id, unitNumber: units.unitNumber } })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(workOrders.contractorId, contractor.id))
      .orderBy(workOrders.estimatedStartDate);

    const events = rows.map(row => ({
      id: row.workOrder.id,
      ticketNumber: row.workOrder.ticketNumber,
      title: row.workOrder.title,
      status: row.workOrder.status,
      priority: row.workOrder.priority,
      start: row.workOrder.estimatedStartDate ?? row.workOrder.actualStartDate ?? row.workOrder.createdAt,
      end: row.workOrder.estimatedEndDate ?? row.workOrder.actualEndDate,
      propertyName: row.property?.name ?? null,
      unitNumber: row.unit?.unitNumber ?? null,
    }));

    res.json({ events });
  } catch (err) {
    console.error("contractor-portal /calendar error:", err);
    res.status(500).json({ message: "Failed to fetch calendar" });
  }
});

// GET /ratings
router.get("/ratings", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });

    const ratedWOs = await db
      .select({ id: workOrders.id, ticketNumber: workOrders.ticketNumber, title: workOrders.title, qualityRating: workOrders.qualityRating, actualEndDate: workOrders.actualEndDate, propertyName: properties.name })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(eq(workOrders.contractorId, contractor.id), isNotNull(workOrders.qualityRating)))
      .orderBy(desc(workOrders.actualEndDate));

    let reviews: any[] = [];
    try {
      reviews = await db.select().from(contractorReviews).where(eq(contractorReviews.contractorId, contractor.id)).orderBy(desc(contractorReviews.createdAt)).limit(20);
    } catch (_) {}

    const ratingDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRatingSum = 0, ratingCount = 0;
    for (const wo of ratedWOs) {
      const r = wo.qualityRating ?? 0;
      if (r >= 1 && r <= 5) { ratingDist[r] = (ratingDist[r] || 0) + 1; totalRatingSum += r; ratingCount++; }
    }

    res.json({ overallRating: Number(contractor.rating ?? (ratingCount > 0 ? totalRatingSum / ratingCount : 0)).toFixed(2), completedJobs: contractor.completedJobs ?? 0, ratingCount, ratingDistribution: ratingDist, ratedWorkOrders: ratedWOs.slice(0, 10), reviews: reviews.slice(0, 10) });
  } catch (err) {
    console.error("contractor-portal /ratings error:", err);
    res.status(500).json({ message: "Failed to fetch ratings" });
  }
});

// GET /stats
router.get("/stats", ...auth, async (req: any, res: any) => {
  try {
    const contractor = await resolveContractor(req.user.email ?? "", req.user.organizationId);
    if (!contractor) return res.status(404).json({ message: "Contractor profile not found" });

    const allWOs = await db
      .select({ status: workOrders.status, estimatedEndDate: workOrders.estimatedEndDate, actualEndDate: workOrders.actualEndDate, createdAt: workOrders.createdAt, actualCost: workOrders.actualCost, estimatedCost: workOrders.estimatedCost })
      .from(workOrders).where(eq(workOrders.contractorId, contractor.id));

    const total = allWOs.length;
    const completed = allWOs.filter(w => w.status === "completed").length;
    const rejected = allWOs.filter(w => w.status === "rejected").length;
    const inProgress = allWOs.filter(w => w.status === "in_progress").length;

    let onTimeCount = 0, lateCount = 0;
    for (const wo of allWOs) {
      if (wo.status === "completed" && wo.estimatedEndDate && wo.actualEndDate) {
        if (new Date(wo.actualEndDate).getTime() <= new Date(wo.estimatedEndDate).getTime()) onTimeCount++;
        else lateCount++;
      }
    }
    const completedWithDates = onTimeCount + lateCount;
    const onTimeRate = completedWithDates > 0 ? Math.round((onTimeCount / completedWithDates) * 100) : null;
    const actionable = allWOs.filter(w => !["draft", "pending_approval"].includes(w.status ?? "")).length;
    const acceptanceRate = actionable > 0 ? Math.round(((actionable - rejected) / actionable) * 100) : null;
    const completedWOs = allWOs.filter(w => w.status === "completed" && w.actualEndDate);
    let avgTurnaround: number | null = null;
    if (completedWOs.length > 0) {
      const sum = completedWOs.reduce((s, w) => s + (new Date(w.actualEndDate!).getTime() - new Date(w.createdAt!).getTime()) / 86_400_000, 0);
      avgTurnaround = Math.round(sum / completedWOs.length);
    }

    res.json({ totalJobs: total, completedJobs: completed, inProgressJobs: inProgress, rejectedJobs: rejected, completionRate: total > 0 ? Math.round((completed / total) * 100) : null, acceptanceRate, onTimeRate, avgTurnaroundDays: avgTurnaround, overallRating: Number(contractor.rating ?? 0).toFixed(2), isAvailable: contractor.isAvailable });
  } catch (err) {
    console.error("contractor-portal /stats error:", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// GET /messages
router.get("/messages", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;

    const msgs = await db.select().from(messages).where(or(eq(messages.fromUserId, userId), eq(messages.toUserId, userId))).orderBy(desc(messages.createdAt)).limit(100);
    if (msgs.length === 0) return res.json({ messages: [] });

    const userRows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.organizationId, orgId));
    const userMap = new Map(userRows.map(u => [u.id, u]));
    const getName = (uid: string) => { const u = userMap.get(uid); if (!u) return "Unknown"; return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown"; };

    res.json({ messages: msgs.map(m => ({ ...m, fromName: getName(m.fromUserId), toName: getName(m.toUserId), isOwn: m.fromUserId === userId })) });
  } catch (err) {
    console.error("contractor-portal /messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// POST /messages
router.post("/messages", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;
    const { subject, content, toUserId } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: "Message content is required" });

    let recipientId = toUserId;
    if (!recipientId) {
      const [admin] = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, orgId), eq(users.role as any, "admin"))).limit(1);
      recipientId = admin?.id ?? userId;
    }

    const [msg] = await db.insert(messages).values({ fromUserId: userId, toUserId: recipientId, subject: subject?.trim() || "Message from contractor", content: content.trim(), organizationId: orgId, isRead: false, createdAt: new Date() } as any).returning();

    // Push real-time notification to the recipient
    notifyNewMessage(recipientId, {
      id: msg.id,
      fromName: "Contractor",
      subject: subject?.trim() || "Message from contractor",
      preview: content.trim().slice(0, 80),
    });
    // Also push to the in-process notification store so their bell updates
    pushNotification(recipientId, {
      type: "message",
      title: "New message from contractor",
      message: content.trim().slice(0, 80),
      ts: new Date().toISOString(),
      link: "/messages",
    });

    res.status(201).json({ message: "Message sent", data: msg });
  } catch (err) {
    console.error("contractor-portal POST /messages error:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

export default router;
