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
import { rentReceivedBetween, rentReceivedByMonth, rentOutstanding, rentCollectionSummary, todayEAT, round2 } from "../services/rent-ledger";

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

// Money is reported as CASH RECEIVED (receipts by payment date — see services/rent-ledger.ts),
// the same definition the dashboards and owner statements use. These helpers work in EAT
// calendar days so a period never straddles a UTC/EAT midnight.
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function periodDays(tf: string) {
  const days = tf === "7d" ? 7 : tf === "90d" ? 90 : tf === "1y" ? 365 : 30;
  const to = todayEAT();
  const from = addDays(to, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { days, from, to, prevFrom, prevTo };
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
    const P = periodDays(String(req.query.timeframe ?? "30d"));

    // Revenue = rent cash received in the period (a part payment counts when it is paid,
    // not when the invoice was created or fully settled) — current vs previous period.
    const [totalRevenue, prevRevenue] = await Promise.all([
      rentReceivedBetween({ orgId }, P.from, P.to),
      rentReceivedBetween({ orgId }, P.prevFrom, P.prevTo),
    ]);

    // Expenses: only approved / paid ones are real costs (pending and rejected are not),
    // bounded on both sides of the period.
    const [expResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
      .from(expenses)
      .leftJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(
        eq(properties.organizationId, orgId),
        sql`${expenses.status} IN ('approved', 'paid')`,
        sql`${expenses.expenseDate}::date BETWEEN ${P.from}::date AND ${P.to}::date`,
      )).catch(() => [{ total: "0" }]);

    const totalExpenses = round2(Number(expResult?.total ?? 0));
    const netIncome     = round2(totalRevenue - totalExpenses);
    const profitMargin  = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 100) : 0;

    // Overdue = invoices still owing money past due (counted by balance, not by full amount)
    const overdue = await rentOutstanding({ orgId }, ["overdue"]);

    // Collection rate = rent actually paid against invoices that fell due in the period ÷ rent billed,
    // capped at 100%. A part-paid invoice counts only for what was paid, never as "paid".
    const summary = await rentCollectionSummary({ orgId }, P.from, P.to);
    const collectionRate = summary.collectionRate;

    // Monthly cash trend (last 6 calendar months incl. this one), zero-filled so a quiet month shows as 0
    const today = todayEAT();
    const startMonth = (() => { const [y, m] = today.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - 5, 1)); return d.toISOString().slice(0, 10); })();
    const byMonth = await rentReceivedByMonth({ orgId }, startMonth, today);
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const [y, m] = startMonth.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      const key = d.toISOString().slice(0, 7);
      return { month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), revenue: byMonth[key] ?? 0 };
    });

    res.json({
      totalRevenue,
      prevRevenue,
      revenueTrend: pctChange(totalRevenue, prevRevenue),
      totalExpenses,
      netIncome,
      profitMargin,
      collectionRate,
      overdueCount: overdue.count,
      overdueAmount: overdue.total,
      monthlyTrend,
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
    const P = periodDays(String(req.query.timeframe ?? "30d"));

    const [[unitStats], [newTenants], [activeLeases], collection] = await Promise.all([
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

      // Payment performance = share of the rent billed in the period (invoices due in it) that has
      // actually been paid — the same collection rate the financial analytics and reports show.
      rentCollectionSummary({ orgId }, P.from, P.to),
    ]);

    const totalUnits   = Number(unitStats?.total ?? 0);
    const occupied     = Number(unitStats?.occupied ?? 0);
    const occupancyRate = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;

    const paymentPerformance = collection.collectionRate;

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

        // cash received this calendar month at this property
        rentReceivedBetween([p.id], `${todayEAT().slice(0, 7)}-01`, todayEAT()).then((t) => [{ total: String(t) }]),
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
