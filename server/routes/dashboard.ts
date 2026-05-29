/**
 * Dashboard router — mounted at /api/dashboard
 *
 * Changes vs. original:
 *  1. requireOrg guard added.
 *  2. Extended /metrics to include totalProperties, runningProjects,
 *     and completedTasksRate — removing the need for hardcoded values
 *     in EnhancedKPIGrid and ManagementKPIGrid.
 */
import { Router } from "express";
import { isMpesaConfigured } from "../services/mpesa";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import {
  properties, units, tenants, rentPayments, maintenanceRequests, projects, workOrders,
  mpesaTransactions,
} from "@shared/schema";
import { eq, and, inArray, count, sql, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/metrics", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;

    // ── revenue: this month's paid rent + all-time total ────────────────────
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [revenueAllTime] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), eq(rentPayments.status, "paid")));

    const [revenueThisMonth] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(
        eq(tenants.organizationId, orgId),
        eq(rentPayments.status, "paid"),
        gte(rentPayments.paidDate, monthStart.toISOString().slice(0, 10)),
        lte(rentPayments.paidDate, monthEnd.toISOString().slice(0, 10)),
      ));

    // ── unit occupancy ────────────────────────────────────────────────────────
    const [unitStats] = await db
      .select({
        total:    count(),
        occupied: sql<string>`SUM(CASE WHEN ${units.isOccupied} = true THEN 1 ELSE 0 END)`,
      })
      .from(units)
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(properties.organizationId, orgId));

    // ── pending maintenance requests ──────────────────────────────────────────
    const [pendingResult] = await db
      .select({ count: count() })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .where(
        and(
          eq(tenants.organizationId, orgId),
          inArray(maintenanceRequests.status, ["pending", "assigned"]),
        ),
      );

    // ── overdue rent payments ─────────────────────────────────────────────────
    const [overdueResult] = await db
      .select({ count: count() })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), eq(rentPayments.status, "overdue")));

    // ── total properties ──────────────────────────────────────────────────────
    const [propResult] = await db
      .select({ count: count() })
      .from(properties)
      .where(eq(properties.organizationId, orgId));

    // ── running / active projects ─────────────────────────────────────────────
    // projects has no organizationId — scope via propertyId → properties.organizationId
    const [runningProjectsResult] = await db
      .select({ count: count() })
      .from(projects)
      .leftJoin(properties, eq(projects.propertyId, properties.id))
      .where(
        and(
          eq(properties.organizationId, orgId),
          inArray(projects.status, ["planning", "in_progress"]),
        ),
      );

    // ── completed work-order tasks rate (completed / total for this org) ──────
    // workOrders has no propertyId — scope via maintenanceRequestId → maintenanceRequests → units → properties
    const [woStats] = await db
      .select({
        total:     count(),
        completed: sql<string>`SUM(CASE WHEN ${workOrders.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(properties.organizationId, orgId));

    const woTotal     = Number(woStats?.total ?? 0);
    const woCompleted = Number(woStats?.completed ?? 0);
    const completedTasksRate =
      woTotal > 0 ? Math.round((woCompleted / woTotal) * 100) : 0;

    res.json({
      // original fields (unchanged shape — no breaking change)
      totalRevenue:     Number(revenueAllTime?.total ?? 0),     // all-time collected
      monthlyRevenue:   Number(revenueThisMonth?.total ?? 0),   // current month only
      occupiedUnits:    Number(unitStats?.occupied ?? 0),
      totalUnits:       Number(unitStats?.total ?? 0),
      pendingRequests:  Number(pendingResult?.count ?? 0),
      overdueRent:      Number(overdueResult?.count ?? 0),
      // new fields (replace hardcoded KPI values)
      totalProperties:     Number(propResult?.count ?? 0),
      runningProjects:     Number(runningProjectsResult?.count ?? 0),
      completedTasksRate,  // integer 0-100
    });
  } catch (error) {
    logger.error("Dashboard metrics error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard metrics" });
  }
});


/**
 * GET /api/dashboard/system-status
 *
 * Returns configuration health checks visible to org admins on the dashboard.
 * Currently surfaces:
 *   - mpesa.configured     — whether all required M-PESA env vars are set
 *   - mpesa.pendingCount   — STK transactions stuck in "pending" > 10 minutes
 *   - mpesa.expiredCount   — transactions that expired without reconciliation (last 24 h)
 *
 * Used by the admin dashboard to show actionable alerts, not to expose secrets.
 */
router.get("/system-status", authenticateJWT, requireOrg, async (req: any, res) => {
  // Only admins and managers see system health alerts
  const role = req.user?.role;
  if (role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const orgId: number = req.user.organizationId;
    const mpesaConfigured = isMpesaConfigured();

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const oneDayAgo     = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Scope mpesa transaction counts to this org via tenants join
    // (mpesaTransactions has no direct organizationId — it links via tenantId)
    const orgTenantIds = (await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.organizationId, orgId))
    ).map(r => r.id);

    // Transactions still "pending" after 10 minutes — should have been swept
    const [pendingRow] = await db
      .select({ count: count() })
      .from(mpesaTransactions)
      .where(
        and(
          eq(mpesaTransactions.status, "pending"),
          lte(mpesaTransactions.createdAt, tenMinutesAgo),
          orgTenantIds.length > 0
            ? sql`${mpesaTransactions.tenantId} = ANY(ARRAY[${sql.join(orgTenantIds.map(id => sql`${id}`), sql`, `)}]::int[])`
            : sql`FALSE`,
        )
      );

    // Transactions that expired in the last 24 hours (reconciliation failures)
    const [expiredRow] = await db
      .select({ count: count() })
      .from(mpesaTransactions)
      .where(
        and(
          eq(mpesaTransactions.status, "failed"),
          gte(mpesaTransactions.createdAt, oneDayAgo),
          eq(mpesaTransactions.resultDesc as any,
            "Expired — no Safaricom callback received within 30 minutes"),
          orgTenantIds.length > 0
            ? sql`${mpesaTransactions.tenantId} = ANY(ARRAY[${sql.join(orgTenantIds.map(id => sql`${id}`), sql`, `)}]::int[])`
            : sql`FALSE`,
        )
      );

    res.json({
      mpesa: {
        configured:   mpesaConfigured,
        pendingCount: Number(pendingRow?.count ?? 0),
        expiredCount: Number(expiredRow?.count ?? 0),
      },
    });
  } catch (error) {
    logger.error("System status error:", error);
    res.status(500).json({ message: "Failed to fetch system status" });
  }
});

export default router;