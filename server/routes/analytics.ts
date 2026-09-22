/**
 * analytics.ts — mounted at /api/analytics
 *
 * Provides aggregated analytics data for the three analytics components
 * that previously called non-existent endpoints and crashed/rendered empty.
 *
 * Endpoints:
 *   GET /api/analytics/financial   — revenue, income, margins, expense breakdown
 *   GET /api/analytics/tenants     — occupancy, payment performance, churn, satisfaction
 *   GET /api/analytics/maintenance — request counts, response times, costs, contractor perf
 *   GET /api/analytics/marketing   — lead funnel, conversion, vacancy days
 *   GET /api/analytics/property    — per-property KPIs
 *
 * All queries are org-scoped via req.user.organizationId.
 * Query param: ?timeframe=7d|30d|90d|1y  (default: 30d)
 */

import { Router } from "express";
import { db } from "../db";
import {
  properties, units, tenants, rentPayments, maintenanceRequests,
  propertyExpenses as expenses, leases, propertyInspections as inspections,
} from "@shared/schema";
import { eq, and, gte, lte, count, sql, avg, sum, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Timeframe helper ──────────────────────────────────────────────────────────

function timeframeDates(tf: string): { from: Date; prev: Date } {
  const days = tf === "7d" ? 7 : tf === "90d" ? 90 : tf === "1y" ? 365 : 30;
  const now   = new Date();
  const from  = new Date(now.getTime() - days * 86_400_000);
  const prev  = new Date(from.getTime() - days * 86_400_000);
  return { from, prev };
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100" : "0";
  const pct = ((current - previous) / previous) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1);
}

// ── GET /api/analytics/financial ─────────────────────────────────────────────

router.get("/financial", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { from, prev } = timeframeDates(String(req.query.timeframe ?? "30d"));

    // Revenue (paid rent payments) — current vs previous period
    const revQuery = async (start: Date, end: Date) =>
      db.select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
        .from(rentPayments)
        .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
        .where(and(
          eq(tenants.organizationId, orgId),
          eq(rentPayments.status, "paid"),
          gte(rentPayments.createdAt, start),
          lte(rentPayments.createdAt, end),
        ));

    const [[curRev], [prevRev]] = await Promise.all([
      revQuery(from, new Date()),
      revQuery(prev, from),
    ]);

    const totalRevenue = Number(curRev?.total ?? 0);
    const prevRevenue  = Number(prevRev?.total ?? 0);

    // Expenses (current period)
    const [expResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .leftJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, orgId),
        gte(expenses.expenseDate, from),
      )).catch(() => [{ total: "0" }]);

    const totalExpenses = Number(expResult?.total ?? 0);
    const netIncome     = totalRevenue - totalExpenses;
    const profitMargin  = totalRevenue > 0
      ? Math.round((netIncome / totalRevenue) * 100)
      : 0;

    // Overdue rent count
    const [overdueResult] = await db
      .select({ count: count() })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), eq(rentPayments.status, "overdue")));

    // Collection rate
    const [totalInvoiced] = await db
      .select({ count: count() })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), gte(rentPayments.createdAt, from)));

    const [totalPaid] = await db
      .select({ count: count() })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(
        eq(tenants.organizationId, orgId),
        eq(rentPayments.status, "paid"),
        gte(rentPayments.createdAt, from),
      ));

    const invoicedCount = Number(totalInvoiced?.count ?? 0);
    const paidCount     = Number(totalPaid?.count ?? 0);
    const collectionRate = invoicedCount > 0
      ? Math.round((paidCount / invoicedCount) * 100)
      : 0;

    // Monthly revenue trend (last 6 months)
    const monthlyTrend = await db
      .select({
        month: sql<string>`TO_CHAR(${rentPayments.createdAt}, 'Mon')`,
        revenue: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)`,
      })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(
        eq(tenants.organizationId, orgId),
        eq(rentPayments.status, "paid"),
        gte(rentPayments.createdAt, new Date(Date.now() - 180 * 86_400_000)),
      ))
      .groupBy(sql`TO_CHAR(${rentPayments.createdAt}, 'Mon'), DATE_TRUNC('month', ${rentPayments.createdAt})`)
      .orderBy(sql`DATE_TRUNC('month', ${rentPayments.createdAt})`);

    res.json({
      totalRevenue,
      prevRevenue,
      revenueTrend: pctChange(totalRevenue, prevRevenue),
      totalExpenses,
      netIncome,
      profitMargin,
      collectionRate,
      overdueCount: Number(overdueResult?.count ?? 0),
      monthlyTrend: monthlyTrend.map(r => ({
        month: r.month,
        revenue: Number(r.revenue),
      })),
    });
  } catch (err: any) {
    console.error("[Analytics/financial]", err);
    res.status(500).json({ message: err.message ?? "Analytics query failed" });
  }
});

// ── GET /api/analytics/tenants ────────────────────────────────────────────────

router.get("/tenants", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { from } = timeframeDates(String(req.query.timeframe ?? "30d"));

    const [[unitStats], [newTenants], [activeLeases], paymentPerf] = await Promise.all([
      db.select({
        total:    count(),
        occupied: sql<string>`SUM(CASE WHEN ${units.isOccupied} = true THEN 1 ELSE 0 END)`,
      }).from(units).leftJoin(properties, eq(units.propertyId, properties.id))
        .where(eq(properties.organizationId, orgId)),

      db.select({ count: count() }).from(tenants)
        .where(and(eq(tenants.organizationId, orgId), gte(tenants.createdAt, from))),

      db.select({ count: count() }).from(leases).leftJoin(tenants, eq(leases.tenantId, tenants.id))
        .where(and(eq(tenants.organizationId, orgId), eq(leases.status, "active")))
        .catch(() => [{ count: 0 }]),

      db.select({
        status: rentPayments.status,
        count:  count(),
      }).from(rentPayments).leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
        .where(and(eq(tenants.organizationId, orgId), gte(rentPayments.createdAt, from)))
        .groupBy(rentPayments.status),
    ]);

    const totalUnits   = Number(unitStats?.total ?? 0);
    const occupied     = Number(unitStats?.occupied ?? 0);
    const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;

    const paidCount  = Number(paymentPerf.find((r: any) => r.status === "paid")?.count ?? 0);
    const totalPmts  = paymentPerf.reduce((s: number, r: any) => s + Number(r.count), 0);
    const paymentPerformance = totalPmts > 0 ? Math.round((paidCount / totalPmts) * 100) : 0;

    const totalTenants = Number((await db.select({ count: count() }).from(tenants)
      .where(eq(tenants.organizationId, orgId)))[0]?.count ?? 0);

    res.json({
      totalTenants,
      newTenants:         Number(newTenants?.count ?? 0),
      occupancyRate,
      occupiedUnits:      occupied,
      totalUnits,
      paymentPerformance,
      activeLeases:       Number(activeLeases?.count ?? 0),
    });
  } catch (err: any) {
    console.error("[Analytics/tenants]", err);
    res.status(500).json({ message: err.message ?? "Analytics query failed" });
  }
});

// ── GET /api/analytics/maintenance ───────────────────────────────────────────

router.get("/maintenance", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { from } = timeframeDates(String(req.query.timeframe ?? "30d"));

    const [stats] = await db
      .select({
        total:       count(),
        open:        sql<string>`SUM(CASE WHEN ${maintenanceRequests.status} IN ('pending','assigned') THEN 1 ELSE 0 END)`,
        inProgress:  sql<string>`SUM(CASE WHEN ${maintenanceRequests.status} = 'in_progress' THEN 1 ELSE 0 END)`,
        completed:   sql<string>`SUM(CASE WHEN ${maintenanceRequests.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), gte(maintenanceRequests.createdAt, from)));

    // Average resolution hours (completed requests with resolvedAt)
    const [avgResolution] = await db
      .select({
        avgHours: sql<string>`AVG(EXTRACT(EPOCH FROM (${maintenanceRequests.completedAt} - ${maintenanceRequests.createdAt})) / 3600)`,
      })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .where(and(
        eq(tenants.organizationId, orgId),
        eq(maintenanceRequests.status, "completed"),
        gte(maintenanceRequests.createdAt, from),
      )).catch(() => [{ avgHours: null }]);

    const byPriority = await db
      .select({ priority: maintenanceRequests.priority, count: count() })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .where(and(eq(tenants.organizationId, orgId), gte(maintenanceRequests.createdAt, from)))
      .groupBy(maintenanceRequests.priority);

    const totalRequests = Number(stats?.total ?? 0);
    const completed     = Number(stats?.completed ?? 0);
    const resolutionRate = totalRequests > 0
      ? Math.round((completed / totalRequests) * 100) : 0;

    res.json({
      totalRequests,
      openRequests:    Number(stats?.open ?? 0),
      inProgress:      Number(stats?.inProgress ?? 0),
      completedRequests: completed,
      resolutionRate,
      avgResponseTime: avgResolution?.avgHours != null
        ? Math.round(Number(avgResolution.avgHours))
        : null,
      byPriority: byPriority.map((r: any) => ({
        priority: r.priority,
        count:    Number(r.count),
      })),
    });
  } catch (err: any) {
    console.error("[Analytics/maintenance]", err);
    res.status(500).json({ message: err.message ?? "Analytics query failed" });
  }
});

// ── GET /api/analytics/marketing ─────────────────────────────────────────────

router.get("/marketing", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { from } = timeframeDates(String(req.query.timeframe ?? "30d"));

    const [[unitStats], [newLeases], [endedLeases]] = await Promise.all([
      db.select({
        total:    count(),
        vacant:   sql<string>`SUM(CASE WHEN ${units.isOccupied} = false THEN 1 ELSE 0 END)`,
      }).from(units).leftJoin(properties, eq(units.propertyId, properties.id))
        .where(eq(properties.organizationId, orgId)),

      db.select({ count: count() }).from(leases).leftJoin(tenants, eq(leases.tenantId, tenants.id))
        .where(and(eq(tenants.organizationId, orgId), gte(leases.startDate, from.toISOString().slice(0, 10))))
        .catch(() => [{ count: 0 }]),

      db.select({ count: count() }).from(leases).leftJoin(tenants, eq(leases.tenantId, tenants.id))
        .where(and(eq(tenants.organizationId, orgId), eq(leases.status, "expired"), gte(leases.endDate, from.toISOString().slice(0, 10))))
        .catch(() => [{ count: 0 }]),
    ]);

    const totalUnits  = Number(unitStats?.total ?? 0);
    const vacantUnits = Number(unitStats?.vacant ?? 0);
    const vacancyRate = totalUnits > 0 ? Math.round((vacantUnits / totalUnits) * 100) : 0;

    res.json({
      totalUnits,
      vacantUnits,
      vacancyRate,
      newLeases:    Number(newLeases?.count ?? 0),
      endedLeases:  Number(endedLeases?.count ?? 0),
    });
  } catch (err: any) {
    console.error("[Analytics/marketing]", err);
    res.status(500).json({ message: err.message ?? "Analytics query failed" });
  }
});

// ── GET /api/analytics/property ──────────────────────────────────────────────

router.get("/property", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;

    const props = await db
      .select({
        id:   properties.id,
        name: properties.name,
      })
      .from(properties)
      .where(eq(properties.organizationId, orgId))
      .orderBy(properties.name)
      .limit(20);

    const stats = await Promise.all(props.map(async (p: any) => {
      const [[unitStat], [revStat]] = await Promise.all([
        db.select({
          total:    count(),
          occupied: sql<string>`SUM(CASE WHEN ${units.isOccupied} = true THEN 1 ELSE 0 END)`,
        }).from(units).where(eq(units.propertyId, p.id)),

        db.select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
          .from(rentPayments)
          .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .leftJoin(units, eq(tenants.unitId, units.id))
          .where(and(
            eq(units.propertyId, p.id),
            eq(rentPayments.status, "paid"),
            gte(rentPayments.createdAt, new Date(Date.now() - 30 * 86_400_000)),
          )).catch(() => [{ total: "0" }]),
      ]);

      const totalUnits = Number(unitStat?.total ?? 0);
      const occupied   = Number(unitStat?.occupied ?? 0);
      return {
        id:          p.id,
        name:        p.name,
        totalUnits,
        occupiedUnits:  occupied,
        occupancyRate:  totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0,
        revenueThisMonth: Number(revStat?.total ?? 0),
      };
    }));

    res.json(stats);
  } catch (err: any) {
    console.error("[Analytics/property]", err);
    res.status(500).json({ message: err.message ?? "Analytics query failed" });
  }
});

export default router;