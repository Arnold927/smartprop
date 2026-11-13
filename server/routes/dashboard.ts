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
  mpesaTransactions, propertyExpenses,
} from "@shared/schema";
import { eq, and, inArray, count, sql, gte, lte, gt, desc, asc } from "drizzle-orm";
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
 * Returns configuration health checks. Platform admin only.
 * Currently surfaces:
 *   - mpesa.configured     — whether all required M-PESA env vars are set
 *   - mpesa.pendingCount   — STK transactions stuck in "pending" > 10 minutes
 *   - mpesa.expiredCount   — transactions that expired without reconciliation (last 24 h)
 *
 * Used by the admin dashboard to show actionable alerts, not to expose secrets.
 */
router.get("/system-status", authenticateJWT, async (req: any, res) => {
  // M-Pesa credentials live in the server environment, so this is a platform-level
  // concern: only the platform admin sees it (org admins and managers cannot fix it).
  if (req.user?.role !== "platform_admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const mpesaConfigured = isMpesaConfigured();

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const oneDayAgo     = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Platform-wide by default; narrowed to one organisation when ?organizationId= is given.
    // (mpesaTransactions has no organizationId — it links via tenantId.)
    const orgParam = parseInt(String(req.query.organizationId ?? ""), 10);
    let tenantFilter: any = undefined;
    if (orgParam > 0) {
      const ids = (await db.select({ id: tenants.id }).from(tenants)
        .where(eq(tenants.organizationId, orgParam))).map(r => r.id);
      tenantFilter = ids.length > 0 ? inArray(mpesaTransactions.tenantId, ids) : sql`FALSE`;
    }

    // Transactions still "pending" after 10 minutes — should have been swept
    const [pendingRow] = await db
      .select({ count: count() })
      .from(mpesaTransactions)
      .where(and(
        eq(mpesaTransactions.status, "pending"),
        lte(mpesaTransactions.createdAt, tenMinutesAgo),
        tenantFilter,
      ));

    // Transactions that expired in the last 24 hours (reconciliation failures)
    const [expiredRow] = await db
      .select({ count: count() })
      .from(mpesaTransactions)
      .where(and(
        eq(mpesaTransactions.status, "failed"),
        gte(mpesaTransactions.createdAt, oneDayAgo),
        eq(mpesaTransactions.resultDesc as any,
          "Expired — no Safaricom callback received within 30 minutes"),
        tenantFilter,
      ));

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

/**
 * GET /api/dashboard/summary
 *
 * One aggregated payload for the Overview, Finance and Property Manager dashboards.
 * Everything is summed in the database for the caller's organisation, so the browser
 * never has to download (and page through) every tenant / payment / expense row.
 *
 * Definitions (kept identical to what the dashboards showed before):
 *   paid      = status in (paid, completed)           — dated by paid_date, else due_date
 *   overdue   = status = overdue                       — all time (rent still owed from any month)
 *   pending   = every other unpaid status (pending, partial …), excluding cancelled
 *   expenses  = status in (approved, paid), dated by expense_date
 *   trend     = by due-date month, last 6 months that have payments
 *   expiring  = lease ends after today and within 30 days
 */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

router.get("/summary", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const sixAgo     = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const in30       = new Date(now.getTime() + 30 * 86400000);

    const PAID = ["paid", "completed"];
    const payOrg = and(eq(tenants.organizationId, orgId));
    const paidDay = sql`COALESCE(${rentPayments.paidDate}, ${rentPayments.dueDate})`;

    // ── tenants ───────────────────────────────────────────────────────────────
    const tenantRows = await db
      .select({ status: tenants.status, n: count() })
      .from(tenants).where(eq(tenants.organizationId, orgId)).groupBy(tenants.status);
    const tenantByStatus: Record<string, number> = {};
    let tenantTotal = 0;
    for (const r of tenantRows) { tenantByStatus[r.status ?? "unknown"] = Number(r.n); tenantTotal += Number(r.n); }

    const expiringWhere = and(
      eq(tenants.organizationId, orgId),
      gt(tenants.leaseEndDate, isoDay(now)),
      lte(tenants.leaseEndDate, isoDay(in30)),
    );
    const [expiringCount] = await db.select({ n: count() }).from(tenants).where(expiringWhere);
    const expiringItems = await db
      .select({ id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, leaseEndDate: tenants.leaseEndDate })
      .from(tenants).where(expiringWhere).orderBy(asc(tenants.leaseEndDate)).limit(3);
    const sampleTenants = await db
      .select({ id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, status: tenants.status })
      .from(tenants).where(eq(tenants.organizationId, orgId)).orderBy(desc(tenants.createdAt)).limit(3);

    // ── payments: totals by bucket ────────────────────────────────────────────
    const [paidMonth] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)`, n: count() })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(payOrg, inArray(rentPayments.status, PAID),
        gte(paidDay, isoDay(monthStart)), lte(paidDay, isoDay(monthEnd))));
    const [overdue] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)`, n: count() })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(payOrg, eq(rentPayments.status, "overdue")));
    const [pending] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)`, n: count() })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(payOrg, sql`${rentPayments.status} NOT IN ('paid','completed','overdue','cancelled')`));

    // ── payments: monthly income (calendar months, by paid date) ─────────────
    const incomeRows = await db
      .select({ m: sql<string>`to_char(${paidDay}, 'YYYY-MM')`, total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(payOrg, inArray(rentPayments.status, PAID), gte(paidDay, isoDay(sixAgo))))
      .groupBy(sql`to_char(${paidDay}, 'YYYY-MM')`);
    const incomeBy: Record<string, number> = {};
    incomeRows.forEach(r => { incomeBy[r.m] = Number(r.total); });

    // ── payments: due-month trend (collected / pending / overdue) ────────────
    const trendRows = await db
      .select({
        m: sql<string>`to_char(${rentPayments.dueDate}, 'YYYY-MM')`,
        collected: sql<string>`COALESCE(SUM(CASE WHEN ${rentPayments.status} IN ('paid','completed') THEN ${rentPayments.amount} ELSE 0 END), 0)`,
        pending:   sql<string>`COALESCE(SUM(CASE WHEN ${rentPayments.status} NOT IN ('paid','completed','overdue','cancelled') THEN ${rentPayments.amount} ELSE 0 END), 0)`,
        overdue:   sql<string>`COALESCE(SUM(CASE WHEN ${rentPayments.status} = 'overdue' THEN ${rentPayments.amount} ELSE 0 END), 0)`,
      })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(payOrg)
      .groupBy(sql`to_char(${rentPayments.dueDate}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${rentPayments.dueDate}, 'YYYY-MM')`)).limit(6);
    const dueTrend = trendRows.reverse().map(r => ({
      month: r.m, collected: Number(r.collected), pending: Number(r.pending), overdue: Number(r.overdue),
    }));

    // ── payments: latest 6 received ──────────────────────────────────────────
    const recentPaid = await db
      .select({
        id: rentPayments.id, amount: rentPayments.amount, paidDate: rentPayments.paidDate,
        createdAt: rentPayments.createdAt, invoiceNumber: rentPayments.invoiceNumber,
        firstName: tenants.firstName, lastName: tenants.lastName,
      })
      .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(payOrg, inArray(rentPayments.status, PAID)))
      .orderBy(sql`${rentPayments.paidDate} DESC NULLS LAST`, desc(rentPayments.createdAt)).limit(6);

    // ── expenses: monthly (approved + paid) ──────────────────────────────────
    const expRows = await db
      .select({ m: sql<string>`to_char(${propertyExpenses.expenseDate}, 'YYYY-MM')`, total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
      .from(propertyExpenses).innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
      .where(and(eq(properties.organizationId, orgId),
        inArray(propertyExpenses.status, ["approved", "paid"]),
        gte(propertyExpenses.expenseDate, sixAgo)))
      .groupBy(sql`to_char(${propertyExpenses.expenseDate}, 'YYYY-MM')`);
    const expenseBy: Record<string, number> = {};
    expRows.forEach(r => { expenseBy[r.m] = Number(r.total); });

    // six calendar months ending this month
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = ym(d);
      return { month: key, income: incomeBy[key] ?? 0, expense: expenseBy[key] ?? 0 };
    });

    res.json({
      generatedAt: now.toISOString(),
      tenants: {
        total: tenantTotal,
        active: tenantByStatus["active"] ?? 0,
        pending: tenantByStatus["pending"] ?? 0,
        byStatus: tenantByStatus,
        expiringLeases: { count: Number(expiringCount?.n ?? 0), items: expiringItems },
        sample: sampleTenants,
      },
      payments: {
        revenueThisMonth: Number(paidMonth?.total ?? 0), collectedCount: Number(paidMonth?.n ?? 0),
        overdueAmount: Number(overdue?.total ?? 0),      overdueCount: Number(overdue?.n ?? 0),
        pendingAmount: Number(pending?.total ?? 0),      pendingCount: Number(pending?.n ?? 0),
        recentPaid: recentPaid.map(p => ({
          id: p.id, amount: p.amount, paidDate: p.paidDate, createdAt: p.createdAt, invoiceNumber: p.invoiceNumber,
          tenant: { firstName: p.firstName, lastName: p.lastName },
        })),
      },
      expensesThisMonth: expenseBy[ym(now)] ?? 0,
      monthly,
      dueTrend,
    });
  } catch (error) {
    logger.error("Dashboard summary error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard summary" });
  }
});


export default router;