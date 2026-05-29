/**
 * Landlord Portal Router — mounted at /api/landlord-portal
 *
 * GET  /dashboard              — KPIs, 6-month trends, expense breakdown,
 *                                occupancy insight, recent reports, documents
 * GET  /properties/stats       — per-property occupancy, active leases,
 *                                monthly revenue (for property cards)
 * GET  /maintenance            — server-filtered maintenance for this owner's
 *                                properties; supports ?status=&priority=&search=
 *                                &page=&pageSize=
 * GET  /reports                — paginated report archive with search, sort,
 *                                and date-range filter
 * POST /reports/generate       — create a new portfolio report
 * GET  /reports/:id/download   — serve a print-ready HTML report
 * POST /reports/:id/email      — email the report to the logged-in owner
 */

import { Router } from "express";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }   from "../middleware/requireOrg";
import { requireOwner } from "../middleware/requireOwner";
import { storage } from "../storage";
import {
  properties,
  units,
  tenants,
  rentPayments,
  maintenanceRequests,
  propertyExpenses,
  portfolioReports,
  documents,
  users,
} from "@shared/schema";
import {
  eq,
  and,
  inArray,
  gte,
  lte,
  sql,
  desc,
  or,
  ilike,
  count,
  isNull,
  type SQL,
} from "drizzle-orm";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { fmtDate, fmtDateShort, fmtKES } from "@shared/reportFormatters";

const router = Router();

// ─── Shared helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${s[i]}`;
}

/** Fetch all properties for the given owner. Always call after requireOwner.
 *
 * Matching strategy (in priority order):
 *  1. properties.ownerId = ownerId  (correctly linked)
 *  2. If no rows found: properties in the same org that have ownerId IS NULL
 *     — these exist when a manager created a property without assigning an owner.
 *     The landlord sees them so they can claim them via the Edit button.
 */
async function resolveOwnerProperties(ownerId: string, orgId?: number) {
  const ownerProperties = await db
    .select()
    .from(properties)
    .where(eq(properties.ownerId, ownerId));

  if (ownerProperties.length > 0 || !orgId) {
    const propertyIds = ownerProperties.map((p) => p.id);
    return { ownerProperties, propertyIds };
  }

  // Fall back: show org properties with no owner assigned
  const unassigned = await db
    .select()
    .from(properties)
    .where(and(
      eq(properties.organizationId, orgId),
      isNull(properties.ownerId),
    ));
  const propertyIds = unassigned.map((p) => p.id);
  return { ownerProperties: unassigned, propertyIds };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const orgId = req.user.organizationId as number;
    const { ownerProperties, propertyIds } = await resolveOwnerProperties(ownerId, orgId);

    const emptyResponse = {
      properties: [],
      summary: { totalRevenue: "0.00", netIncome: "0.00", occupancyRate: "0.0", totalProperties: 0 },
      monthlyReport: { totalRevenue: "0.00", totalExpenses: "0.00", netIncome: "0.00" },
      reports: [],
      trends: [],
      expenseCategories: [],
      upcomingVacancies: [],
      leasesExpiringSoon: 0,
      currentVacancies: 0,
      recentDocuments: [],
    };

    if (propertyIds.length === 0) return res.json(emptyResponse);

    const now = new Date();
    const som = startOfMonth(now);
    const eom = endOfMonth(now);

    // Current-month revenue & expenses
    const [revenueResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(
        inArray(units.propertyId, propertyIds),
        inArray(rentPayments.status, ["paid", "completed"]),
        gte(rentPayments.createdAt, som),
        lte(rentPayments.createdAt, eom),
      ));

    const [expenseResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
      .from(propertyExpenses)
      .where(and(
        inArray(propertyExpenses.propertyId, propertyIds),
        gte(propertyExpenses.expenseDate, som),
        lte(propertyExpenses.expenseDate, eom),
      ));

    // Occupancy
    const allUnits = await db
      .select({ id: units.id, isOccupied: units.isOccupied, unitNumber: units.unitNumber, propertyId: units.propertyId })
      .from(units)
      .where(inArray(units.propertyId, propertyIds));

    const totalUnitsCount    = allUnits.length;
    const occupiedUnitsCount = allUnits.filter((u) => u.isOccupied).length;
    const vacantUnits        = allUnits.filter((u) => !u.isOccupied);
    const occupancyRate      = totalUnitsCount > 0 ? (occupiedUnitsCount / totalUnitsCount) * 100 : 0;
    const totalRev           = Number(revenueResult?.total ?? 0);
    const totalExp           = Number(expenseResult?.total ?? 0);

    // 6-month rolling trend — two DATE_TRUNC GROUP BY queries (one for revenue,
    // one for expenses) instead of 12 round-trips (6 months × 2 tables).
    const trendStart = startOfMonth(subMonths(now, 5));
    const trendEnd   = endOfMonth(now);

    const [trendRevRows, trendExpRows] = await Promise.all([
      db.select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${rentPayments.createdAt}), 'Mon')`,
          yr:    sql<number>`EXTRACT(YEAR  FROM DATE_TRUNC('month', ${rentPayments.createdAt}))::int`,
          mo:    sql<number>`EXTRACT(MONTH FROM DATE_TRUNC('month', ${rentPayments.createdAt}))::int`,
          total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)`,
        })
        .from(rentPayments)
        .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
        .leftJoin(units,   eq(tenants.unitId, units.id))
        .where(and(
          inArray(units.propertyId, propertyIds),
          inArray(rentPayments.status, ["paid", "completed"]),
          gte(rentPayments.createdAt, trendStart),
          lte(rentPayments.createdAt, trendEnd),
        ))
        .groupBy(sql`DATE_TRUNC('month', ${rentPayments.createdAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${rentPayments.createdAt})`),

      db.select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${propertyExpenses.expenseDate}), 'Mon')`,
          yr:    sql<number>`EXTRACT(YEAR  FROM DATE_TRUNC('month', ${propertyExpenses.expenseDate}))::int`,
          mo:    sql<number>`EXTRACT(MONTH FROM DATE_TRUNC('month', ${propertyExpenses.expenseDate}))::int`,
          total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)`,
        })
        .from(propertyExpenses)
        .where(and(
          inArray(propertyExpenses.propertyId, propertyIds),
          gte(propertyExpenses.expenseDate, trendStart),
          lte(propertyExpenses.expenseDate, trendEnd),
        ))
        .groupBy(sql`DATE_TRUNC('month', ${propertyExpenses.expenseDate})`)
        .orderBy(sql`DATE_TRUNC('month', ${propertyExpenses.expenseDate})`),
    ]);

    // Index by "YYYY-MM" so the zip is O(1) per month and order-independent.
    const revByMonth = Object.fromEntries(
      trendRevRows.map((r) => [`${r.yr}-${String(r.mo).padStart(2, "0")}`, Number(r.total)])
    );
    const expByMonth = Object.fromEntries(
      trendExpRows.map((r) => [`${r.yr}-${String(r.mo).padStart(2, "0")}`, Number(r.total)])
    );

    const trendData = Array.from({ length: 6 }, (_, i) => {
      const d       = subMonths(now, 5 - i);
      const key     = format(d, "yyyy-MM");
      const revenue  = revByMonth[key] ?? 0;
      const expenses = expByMonth[key] ?? 0;
      return { month: format(d, "MMM"), revenue, expenses, net: revenue - expenses };
    });

    // Expense breakdown by category
    const categoryRows = await db
      .select({ category: propertyExpenses.category, total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
      .from(propertyExpenses)
      .where(and(inArray(propertyExpenses.propertyId, propertyIds), gte(propertyExpenses.expenseDate, som), lte(propertyExpenses.expenseDate, eom)))
      .groupBy(propertyExpenses.category);

    const expenseCategories = categoryRows
      .map((r) => ({ name: r.category ?? "other", value: Number(r.total) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);

    // Upcoming vacancies — leases ending within 30 days
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    // leaseEndDate is PgDateString — Drizzle requires ISO date strings, not Date objects
    const nowIso  = now.toISOString().split("T")[0];
    const in30Iso = in30.toISOString().split("T")[0];
    const expiringTenants = await db
      .select({ unitId: tenants.unitId, leaseEnd: tenants.leaseEndDate })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(inArray(units.propertyId, propertyIds), gte(tenants.leaseEndDate, nowIso), lte(tenants.leaseEndDate, in30Iso)));

    const unitMap = Object.fromEntries(allUnits.map((u) => [u.id, u]));
    const propMap = Object.fromEntries(ownerProperties.map((p) => [p.id, p.name]));
    const upcomingVacancies = expiringTenants.map((t) => {
      const unit = unitMap[t.unitId!];
      return { unitNumber: unit?.unitNumber ?? "—", propertyName: propMap[unit?.propertyId ?? 0] ?? "—", leaseEnd: t.leaseEnd ? new Date(t.leaseEnd).toISOString() : null };
    }).slice(0, 5);

    // Recent documents
    let recentDocuments: any[] = [];
    try {
      const docRows = await db
        .select({ id: documents.id, name: documents.name, url: documents.url, type: documents.type, size: documents.size })
        .from(documents)
        .where(inArray(documents.propertyId, propertyIds))
        .orderBy(desc(documents.createdAt))
        .limit(4);
      recentDocuments = docRows.map((d) => ({
        id: d.id, name: d.name, url: d.url ?? undefined, type: d.type ?? "Document", size: d.size ? formatBytes(Number(d.size)) : "—",
      }));
    } catch { /* documents.propertyId may not exist in all schema versions */ }

    const recentReports = await storage.getPortfolioReports(ownerId);

    // Arrears: sum of overdue/pending rent payments for these properties
    const [arrearsResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(
        inArray(units.propertyId, propertyIds),
        inArray(rentPayments.status, ["overdue", "pending"]),
      ));
    const totalArrears = Number(arrearsResult?.total ?? 0);

    // YTD revenue (Jan 1 to today)
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    const [ytdResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(
        inArray(units.propertyId, propertyIds),
        inArray(rentPayments.status, ["paid", "completed"]),
        gte(rentPayments.createdAt, ytdStart),
        lte(rentPayments.createdAt, now),
      ));

    // YTD expenses
    const [ytdExpResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
      .from(propertyExpenses)
      .where(and(
        inArray(propertyExpenses.propertyId, propertyIds),
        gte(propertyExpenses.expenseDate, ytdStart),
        lte(propertyExpenses.expenseDate, now),
      ));

    const ytdRevenue  = Number(ytdResult?.total ?? 0);
    const ytdExpenses = Number(ytdExpResult?.total ?? 0);

    // ── Deposit summary ─────────────────────────────────────────────────────
    const depositAgg = await db
      .select({ total: sql<string>`coalesce(sum(cast(${tenants.securityDeposit} as numeric)), 0)` })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(inArray(units.propertyId, propertyIds), eq(tenants.status, "active")));
    const totalDeposits = Number(depositAgg[0]?.total ?? 0);

    // ── Portfolio valuation ──────────────────────────────────────────────────
    const valAgg = await db
      .select({ total: sql<string>`coalesce(sum(cast(${properties.estimatedValue} as numeric)), 0)` })
      .from(properties)
      .where(inArray(properties.id, propertyIds));
    const portfolioValue = Number(valAgg[0]?.total ?? 0);
    const annualRent  = totalRev * 12;
    const grossYield  = portfolioValue > 0 ? (annualRent / portfolioValue) * 100 : null;

    // ── This-month cash flow ─────────────────────────────────────────────────
    const thisMonthStart = startOfMonth(now);
    const thisMonthEnd   = endOfMonth(now);
    const activeTenants = await db
      .select({ id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName,
                monthlyRent: tenants.monthlyRent, unitNumber: units.unitNumber, propertyName: properties.name })
      .from(tenants)
      .leftJoin(units,      eq(tenants.unitId,    units.id))
      .leftJoin(properties, eq(units.propertyId,  properties.id))
      .where(and(inArray(units.propertyId, propertyIds), eq(tenants.status, "active")));

    const thisMonthPmts = await db
      .select({ tenantId: rentPayments.tenantId, status: rentPayments.status, amount: rentPayments.amount })
      .from(rentPayments)
      .where(and(
        inArray(rentPayments.tenantId, activeTenants.map(t => t.id)),
        gte(rentPayments.createdAt, thisMonthStart),
        lte(rentPayments.createdAt, thisMonthEnd),
      ));
    const paidSet = new Set(
      thisMonthPmts.filter(p => p.status === "paid" || p.status === "completed").map(p => p.tenantId)
    );
    const cashFlowSchedule = activeTenants.map(t => ({
      tenantId: t.id,
      name: `${t.firstName} ${t.lastName}`,
      property: t.propertyName,
      unit: t.unitNumber,
      monthlyRent: Number(t.monthlyRent ?? 0),
      paid: paidSet.has(t.id),
    }));
    const expectedThisMonth  = activeTenants.reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);
    const collectedThisMonth = thisMonthPmts
      .filter(p => p.status === "paid" || p.status === "completed")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0);

    res.json({
      properties: ownerProperties,
      summary: {
        totalRevenue: totalRev.toFixed(2),
        netIncome: (totalRev - totalExp).toFixed(2),
        occupancyRate: occupancyRate.toFixed(1),
        totalProperties: ownerProperties.length,
        totalArrears: totalArrears.toFixed(2),
        ytdRevenue: ytdRevenue.toFixed(2),
        ytdExpenses: ytdExpenses.toFixed(2),
        ytdNetIncome: (ytdRevenue - ytdExpenses).toFixed(2),
        totalDeposits:       totalDeposits.toFixed(2),
        portfolioValue:      portfolioValue > 0 ? portfolioValue.toFixed(2) : null,
        grossYield:          grossYield ? grossYield.toFixed(2) : null,
        expectedThisMonth:   expectedThisMonth.toFixed(2),
        collectedThisMonth:  collectedThisMonth.toFixed(2),
      },
      monthlyReport: { totalRevenue: totalRev.toFixed(2), totalExpenses: totalExp.toFixed(2), netIncome: (totalRev - totalExp).toFixed(2) },
      reports: recentReports.slice(0, 5),
      trends: trendData,
      expenseCategories,
      upcomingVacancies,
      cashFlowSchedule,
      leasesExpiringSoon: expiringTenants.length,
      currentVacancies: vacantUnits.length,
      recentDocuments,
    });
  } catch (error) {
    console.error("Landlord dashboard error:", error);
    res.status(500).json({ message: "Failed to fetch landlord dashboard data" });
  }
});

// ── Per-property stats ────────────────────────────────────────────────────────
// Returns occupancy rate, active-lease count, and current-month revenue per
// property so the property cards can show real data instead of placeholders.
router.get("/properties/stats", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { ownerProperties, propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json([]);

    const now = new Date();
    const som = startOfMonth(now);
    const eom = endOfMonth(now);

    const allUnits = await db
      .select({ id: units.id, propertyId: units.propertyId, isOccupied: units.isOccupied })
      .from(units)
      .where(inArray(units.propertyId, propertyIds));

    // Active leases per property
    const activeLeaseRows = await db
      .select({ propertyId: units.propertyId, cnt: count() })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(inArray(units.propertyId, propertyIds), eq(tenants.status, "active")))
      .groupBy(units.propertyId);
    const activeLeasesByProp = Object.fromEntries(activeLeaseRows.map((r) => [r.propertyId, Number(r.cnt)]));

    // Monthly revenue per property
    const revRows = await db
      .select({ propertyId: units.propertyId, total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(inArray(units.propertyId, propertyIds), inArray(rentPayments.status, ["paid", "completed"]), gte(rentPayments.createdAt, som), lte(rentPayments.createdAt, eom)))
      .groupBy(units.propertyId);
    const revByProp = Object.fromEntries(revRows.map((r) => [r.propertyId, Number(r.total)]));

    const stats = ownerProperties.map((prop) => {
      const propUnits = allUnits.filter((u) => u.propertyId === prop.id);
      const total     = propUnits.length;
      const occupied  = propUnits.filter((u) => u.isOccupied).length;
      return {
        id:           prop.id,
        name:         prop.name,
        address:      prop.address,
        totalUnits:   total,
        occupiedUnits: occupied,
        occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : 0,
        activeLeases: activeLeasesByProp[prop.id] ?? 0,
        monthlyRevenue: (revByProp[prop.id] ?? 0).toFixed(2),
      };
    });

    res.json(stats);
  } catch (error) {
    console.error("Property stats error:", error);
    res.status(500).json({ message: "Failed to fetch property stats" });
  }
});

// ── Maintenance (server-side filtered + paginated) ────────────────────────────
// Query params:
//   status    = active | all | pending | assigned | in_progress | completed | cancelled
//   priority  = low | medium | high | urgent
//   search    = string  (title, ticket number, property name)
//   page      = number  (1-based, default 1)
//   pageSize  = number  (default 10, max 100)
router.get("/maintenance", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId    = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);

    if (propertyIds.length === 0) {
      return res.json({ data: [], total: 0, page: 1, pageSize: 10, totalPages: 0 });
    }

    const statusParam  = (req.query.status as string) ?? "active";
    const priorityParam = req.query.priority as string | undefined;
    const search       = (req.query.search as string | undefined)?.trim();
    const page         = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize     = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 10));

    const activeStatuses = ["pending", "assigned", "in_progress"];
    const statusFilter =
      statusParam === "all"       ? undefined :
      statusParam === "active"    ? activeStatuses :
                                    [statusParam];

    const conditions: SQL<unknown>[] = [inArray(units.propertyId, propertyIds)];
    if (statusFilter) conditions.push(inArray(maintenanceRequests.status, statusFilter as Array<typeof maintenanceRequests.status._.data>));
    if (priorityParam) conditions.push(eq(maintenanceRequests.priority, priorityParam as typeof maintenanceRequests.priority._.data));
    if (search) {
      conditions.push(or(
        ilike(maintenanceRequests.title, `%${search}%`),
        ilike(maintenanceRequests.ticketNumber, `%${search}%`),
        ilike(properties.name, `%${search}%`),
      )!);
    }

    const joined = db
      .select({
        id:          maintenanceRequests.id,
        ticketNumber: maintenanceRequests.ticketNumber,
        title:       maintenanceRequests.title,
        description: maintenanceRequests.description,
        category:    maintenanceRequests.category,
        priority:    maintenanceRequests.priority,
        status:      maintenanceRequests.status,
        assignedTo:  maintenanceRequests.assignedTo,
        estimatedCost: maintenanceRequests.estimatedCost,
        createdAt:   maintenanceRequests.createdAt,
        propertyId:  properties.id,
        propertyName: properties.name,
        unitNumber:  units.unitNumber,
      })
      .from(maintenanceRequests)
      .leftJoin(tenants,    eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(units,      eq(maintenanceRequests.unitId,   units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...conditions));

    const [{ total }] = await db
      .select({ total: count() })
      .from(maintenanceRequests)
      .leftJoin(tenants,    eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(units,      eq(maintenanceRequests.unitId,   units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...conditions));

    const rows = await joined
      .orderBy(desc(maintenanceRequests.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const data = rows.map((r) => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      assignedTo: r.assignedTo,
      estimatedCost: r.estimatedCost,
      createdAt: r.createdAt,
      property: r.propertyName ? { id: r.propertyId, name: r.propertyName } : null,
      unit:     r.unitNumber   ? { unitNumber: r.unitNumber }               : null,
    }));

    res.json({ data, total: Number(total), page, pageSize, totalPages: Math.ceil(Number(total) / pageSize) });
  } catch (error) {
    console.error("Landlord maintenance error:", error);
    res.status(500).json({ message: "Failed to fetch maintenance requests" });
  }
});

// ── Reports archive ───────────────────────────────────────────────────────────
// Query params:
//   search    = string  (reportType, status)
//   sortBy    = createdAt | totalRevenue | netIncome | reportPeriodStart
//   sortDir   = asc | desc  (default: desc)
//   startDate = ISO date  (reportPeriodStart ≥)
//   endDate   = ISO date  (reportPeriodEnd ≤)
//   page      = number  (1-based, default 1)
//   pageSize  = number  (default 10, max 100)
router.get("/reports", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId    = (req as any).ownerId as string;
    const search     = (req.query.search as string | undefined)?.trim().toLowerCase();
    const sortBy     = (req.query.sortBy as string) ?? "createdAt";
    const sortDir    = (req.query.sortDir as string) === "asc" ? 1 : -1;
    const startDate  = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate    = req.query.endDate   ? new Date(req.query.endDate   as string) : undefined;
    const page       = Math.max(1, parseInt(req.query.page     as string) || 1);
    const pageSize   = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 10));

    const conditions: SQL<unknown>[] = [eq(portfolioReports.ownerId, ownerId)];
    // reportPeriodStart/End are PgDateString columns — pass ISO date strings, not Date objects
    if (startDate) conditions.push(gte(portfolioReports.reportPeriodStart, startDate.toISOString().split("T")[0]));
    if (endDate)   conditions.push(lte(portfolioReports.reportPeriodEnd,   endDate.toISOString().split("T")[0]));

    let all = await db
      .select()
      .from(portfolioReports)
      .where(and(...conditions))
      .orderBy(desc(portfolioReports.createdAt));

    if (search) {
      all = all.filter((r) =>
        r.reportType.toLowerCase().includes(search) ||
        (r.status ?? "").toLowerCase().includes(search)
      );
    }

    const allowedSorts = ["totalRevenue", "netIncome", "reportPeriodStart", "createdAt"] as const;
    const key = allowedSorts.includes(sortBy as any)
      ? (sortBy as typeof allowedSorts[number])
      : "createdAt";

    all.sort((a, b) => {
      const av = String(a[key] ?? "");
      const bv = String(b[key] ?? "");
      const diff = isNaN(Number(av)) ? av.localeCompare(bv) : Number(av) - Number(bv);
      return sortDir * diff;
    });

    const total = all.length;
    const data  = all.slice((page - 1) * pageSize, page * pageSize);

    res.json({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (error) {
    console.error("Landlord reports error:", error);
    res.status(500).json({ message: "Failed to fetch portfolio reports" });
  }
});

// ── Generate report ───────────────────────────────────────────────────────────
router.post("/reports/generate", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const { ownerId, reportType, startDate, endDate } = req.body;
    const report = await storage.generatePortfolioReport(
      ownerId || req.user.id,
      reportType,
      new Date(startDate),
      new Date(endDate)
    );
    res.json(report);
  } catch (error) {
    console.error("Generate report error:", error);
    res.status(500).json({ message: "Failed to generate portfolio report" });
  }
});

// ── Download report as print-ready HTML ──────────────────────────────────────
router.get("/reports/:id/download", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const reportId = Number(req.params.id);
    const ownerId  = req.user.id;

    const [report] = await db
      .select()
      .from(portfolioReports)
      .where(and(eq(portfolioReports.id, reportId), eq(portfolioReports.ownerId, ownerId)))
      .limit(1);

    if (!report) return res.status(404).json({ message: "Report not found" });

    await db
      .update(portfolioReports)
      .set({ downloadedAt: new Date(), status: "downloaded" })
      .where(eq(portfolioReports.id, reportId));

    const html     = buildReportHtml(report, req.user);
    const filename = `smartprop-report-${report.reportType}-${String(report.id).padStart(4, "0")}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
  } catch (error) {
    console.error("Report download error:", error);
    res.status(500).json({ message: "Failed to download report" });
  }
});

// ── Email report ──────────────────────────────────────────────────────────────
router.post("/reports/:id/email", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const reportId   = Number(req.params.id);
    const ownerId    = req.user.id;
    const ownerEmail = req.user.email as string | undefined;
    const ownerName  = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || "Landlord";

    if (!ownerEmail) {
      return res.status(400).json({ message: "No email address found for your account." });
    }

    const [report] = await db
      .select()
      .from(portfolioReports)
      .where(and(eq(portfolioReports.id, reportId), eq(portfolioReports.ownerId, ownerId)))
      .limit(1);

    if (!report) return res.status(404).json({ message: "Report not found" });

    const { sendPortfolioReportEmail } = await import("../lib/email.js");
    await sendPortfolioReportEmail({ to: ownerEmail, ownerName, report });

    await db
      .update(portfolioReports)
      .set({ downloadedAt: new Date(), status: "emailed" })
      .where(eq(portfolioReports.id, reportId));

    res.json({ success: true, sentTo: ownerEmail });
  } catch (error: any) {
    console.error("Report email error:", error);
    if (error?.message?.includes("RESEND_API_KEY")) {
      return res.status(503).json({ message: "Email service is not configured. Set RESEND_API_KEY in your environment." });
    }
    res.status(500).json({ message: "Failed to email report" });
  }
});

// ── Report HTML builder ───────────────────────────────────────────────────────
function buildReportHtml(report: any, user: any): string {
  const appName   = process.env.APP_NAME ?? "SmartProp";
  const ownerName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Property Owner";
  const reportNum = `#RPT-${String(report.id).padStart(4, "0")}`;
  const typeLabel = String(report.reportType ?? "monthly").charAt(0).toUpperCase() + String(report.reportType ?? "monthly").slice(1);
  const summary   = (report.summary as Record<string, any>) ?? {};

  const css = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1e293b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { max-width: 800px; margin: 0 auto; padding: 40px; }
    .sp-header { background: linear-gradient(135deg, #065f46 0%, #059669 100%); padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; margin: -40px -40px 32px -40px; }
    .sp-brand { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
    .sp-brand-sub { color: #a7f3d0; font-size: 11px; font-weight: 400; margin-top: 3px; }
    .sp-doc-meta { text-align: right; color: #fff; }
    .sp-doc-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #a7f3d0; margin-bottom: 4px; }
    .sp-doc-number { font-size: 18px; font-weight: 700; }
    .sp-doc-date { font-size: 11px; color: #d1fae5; margin-top: 3px; }
    .sp-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; }
    .sp-panel h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 6px; }
    .sp-panel p { font-size: 14px; font-weight: 600; color: #0f172a; }
    .sp-section-title { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #059669; border-bottom: 1.5px solid #d1fae5; padding-bottom: 5px; margin-bottom: 14px; margin-top: 24px; }
    .sp-kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 24px; }
    .sp-kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #f8fafc; }
    .sp-kpi .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 6px; }
    .sp-kpi .val { font-size: 20px; font-weight: 700; color: #0f172a; }
    .sp-kpi.green { background: #f0fdf4; border-color: #d1fae5; } .sp-kpi.green .val { color: #065f46; }
    .sp-kpi.blue  { background: #eff6ff; border-color: #bfdbfe; } .sp-kpi.blue  .val { color: #1d4ed8; }
    .sp-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .sp-table th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; padding: 8px 12px; border-bottom: 2px solid #d1fae5; text-align: left; background: #f8fafc; }
    .sp-table th.r, .sp-table td.r { text-align: right; }
    .sp-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .sp-table tr.sp-total td { font-weight: 700; border-top: 2px solid #d1fae5; background: #f8fafc; }
    .sp-table tr.sp-net td { font-weight: 700; font-size: 14px; color: #065f46; border-top: 2px solid #d1fae5; background: #f0fdf4; }
    .sp-footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    .sp-print-btn { background: #059669; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; display: block; margin-bottom: 24px; }
    @media print { .sp-print-btn { display: none !important; } .page { padding: 0; } .sp-header { margin: 0 0 28px 0; } }
    @page { margin: 14mm; }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${appName} — ${typeLabel} Portfolio Report ${reportNum}</title>
<style>${css}</style>
</head>
<body>
<div class="page">
  <button class="sp-print-btn" onclick="window.print()">&#8595; Save as PDF &nbsp;(File &rarr; Print &rarr; Save as PDF)</button>

  <div class="sp-header">
    <div>
      <div class="sp-brand">${appName}</div>
      <div class="sp-brand-sub">Portfolio Financial Report</div>
    </div>
    <div class="sp-doc-meta">
      <div class="sp-doc-label">${typeLabel} Statement</div>
      <div class="sp-doc-number">${reportNum}</div>
      <div class="sp-doc-date">Generated: ${fmtDate(report.createdAt ?? new Date().toISOString())}</div>
    </div>
  </div>

  <div class="sp-panel">
    <div><h3>Prepared for</h3><p>${ownerName}</p></div>
    <div style="text-align:right"><h3>Reporting Period</h3><p>${fmtDate(report.reportPeriodStart)} – ${fmtDate(report.reportPeriodEnd)}</p></div>
  </div>

  <div class="sp-section-title">Financial Summary</div>
  <div class="sp-kpi-grid">
    <div class="sp-kpi blue"><div class="lbl">Gross Revenue</div><div class="val">${fmtKES(report.totalRevenue)}</div></div>
    <div class="sp-kpi"><div class="lbl">Total Expenses</div><div class="val">${fmtKES(report.totalExpenses)}</div></div>
    <div class="sp-kpi green"><div class="lbl">Net Income</div><div class="val">${fmtKES(report.netIncome)}</div></div>
  </div>

  <div class="sp-section-title">Portfolio Overview</div>
  <div class="sp-kpi-grid">
    <div class="sp-kpi"><div class="lbl">Properties</div><div class="val">${summary.totalProperties ?? "—"}</div></div>
    <div class="sp-kpi"><div class="lbl">Total Units</div><div class="val">${summary.totalUnits ?? "—"}</div></div>
    <div class="sp-kpi green"><div class="lbl">Occupancy Rate</div><div class="val">${report.occupancyRate ? Number(report.occupancyRate).toFixed(1) + "%" : "—"}</div></div>
  </div>

  <div class="sp-section-title">Income &amp; Expenditure</div>
  <table class="sp-table">
    <thead><tr><th>Description</th><th class="r">Amount (KES)</th></tr></thead>
    <tbody>
      <tr><td><strong>Revenue</strong></td><td class="r"></td></tr>
      <tr><td style="padding-left:24px">Rental Income</td><td class="r">${fmtKES(report.totalRevenue)}</td></tr>
      <tr class="sp-total"><td>Total Revenue</td><td class="r">${fmtKES(report.totalRevenue)}</td></tr>
      <tr><td><strong>Expenses</strong></td><td class="r"></td></tr>
      <tr><td style="padding-left:24px">Operating Expenses</td><td class="r">${fmtKES(report.totalExpenses)}</td></tr>
      <tr class="sp-total"><td>Total Expenses</td><td class="r">${fmtKES(report.totalExpenses)}</td></tr>
      <tr class="sp-net"><td>Net Operating Income</td><td class="r">${fmtKES(report.netIncome)}</td></tr>
    </tbody>
  </table>

  <div class="sp-footer">
    <span>${appName} — Confidential Portfolio Report</span>
    <span>${reportNum} · ${typeLabel} · ${fmtDate(report.reportPeriodStart)} – ${fmtDate(report.reportPeriodEnd)}</span>
  </div>
</div>
</body>
</html>`;
}

// ── PATCH /api/landlord-portal/expenses/:id (update status/receipt) ─────────────
router.patch("/expenses/:id", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    const id = parseInt(req.params.id);
    const { status, receiptUrl, paymentDate, notes } = req.body;

    const [expense] = await db.select().from(propertyExpenses).where(eq(propertyExpenses.id, id)).limit(1);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    if (!propertyIds.includes(expense.propertyId)) return res.status(403).json({ message: "Access denied" });

    const patch: any = {};
    if (status)      patch.status      = status;
    if (receiptUrl)  patch.receiptUrl  = receiptUrl;
    if (paymentDate) patch.paymentDate = new Date(paymentDate);
    if (notes !== undefined) patch.notes = notes;

    const [updated] = await db.update(propertyExpenses).set(patch)
      .where(eq(propertyExpenses.id, id)).returning();
    return res.json(updated);
  } catch (err) {
    console.error("Expense PATCH:", err);
    return res.status(500).json({ message: "Failed to update expense" });
  }
});

// ── POST /api/landlord-portal/expenses/upload-receipt ──────────────────────────
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
const expUpload = s3Upload;

router.post("/expenses/upload-receipt", authenticateJWT, requireOrg, requireOwner,
  expUpload.single("file"),
  async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const url = resolveUploadUrl(req.file as any);
      return res.json({ url, name: req.file.originalname, size: req.file.size });
    } catch (err) {
      console.error("Expense receipt upload:", err);
      return res.status(500).json({ message: "Failed to upload receipt" });
    }
  }
);

// ── PATCH /api/landlord-portal/properties/:id ─────────────────────────────────
router.patch("/properties/:id", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { ownerProperties } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    const id = parseInt(req.params.id);
    const prop = ownerProperties.find(p => p.id === id);
    if (!prop) return res.status(403).json({ message: "Property not found or access denied" });

    const { name, address, description } = req.body;
    const patch: any = {};
    if (name)        patch.name        = name.trim();
    if (address)     patch.address     = address.trim();
    if (description !== undefined) patch.description = description;

    const [updated] = await db.update(properties).set(patch)
      .where(eq(properties.id, id)).returning();
    return res.json(updated);
  } catch (err) {
    console.error("Property PATCH:", err);
    return res.status(500).json({ message: "Failed to update property" });
  }
});

// ── GET /api/landlord-portal/maintenance/:id/photos ───────────────────────────
router.get("/maintenance/:id/photos", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const photos = await db
      .select({ id: documents.id, name: documents.name, url: documents.url, size: documents.size, createdAt: documents.createdAt })
      .from(documents)
      .where(eq(documents.maintenanceRequestId, id))
      .orderBy(documents.createdAt);
    return res.json(photos);
  } catch (err) {
    console.error("Maintenance photos:", err);
    return res.status(500).json({ message: "Failed to fetch photos" });
  }
});

// ── Send approval notification to property manager ────────────────────────────
// Called internally after approve/reject — sends a message to org admins
async function sendApprovalNotification(orgId: number, fromUserId: string, fromName: string, ticketNumber: string, action: "approve" | "reject", reason?: string) {
  try {
    // Find org admin/manager users to notify
    const managers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.role as any, ["admin", "manager", "property_manager"])))
      .limit(5);

    for (const mgr of managers) {
      if (String(mgr.id) === fromUserId) continue; // don't message yourself
      await storage.createMessage({
        fromUserId,
        toUserId: String(mgr.id),
        subject: `Maintenance Request ${ticketNumber} — ${action === "approve" ? "Approved ✅" : "Rejected ❌"}`,
        content: action === "approve"
          ? `Maintenance request #${ticketNumber} has been approved. Please proceed with scheduling the work.`
          : `Maintenance request #${ticketNumber} has been rejected.

Reason: ${reason ?? "No reason provided."}`,
        messageType: "system",
      } as any);
    }
  } catch (e) {
    console.warn("Could not send approval notification:", e);
  }
}

// ── Unit Grid ─────────────────────────────────────────────────────────────────
// GET /api/landlord-portal/unit-grid?ownerId=&month=YYYY-MM
// Returns every property with its units, each unit tagged with occupancy status,
// tenant name, rent, lease end, and this-month payment status.
router.get("/unit-grid", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { ownerProperties, propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json([]);

    const monthParam = (req.query.month as string) || format(new Date(), "yyyy-MM");
    const [yr, mo] = monthParam.split("-").map(Number);
    const som = startOfMonth(new Date(yr, mo - 1, 1));
    const eom = endOfMonth(new Date(yr, mo - 1, 1));

    // All units across this owner's properties
    const allUnits = await db
      .select({
        id:          units.id,
        unitNumber:  units.unitNumber,
        isOccupied:  units.isOccupied,
        bedrooms:    units.bedrooms,
        bathrooms:   units.bathrooms,
        monthlyRent: units.monthlyRent,
        propertyId:  units.propertyId,
      })
      .from(units)
      .where(inArray(units.propertyId, propertyIds))
      .orderBy(units.unitNumber);

    // Active tenants for these units
    const activeTenants = await db
      .select({
        id:           tenants.id,
        unitId:       tenants.unitId,
        firstName:    tenants.firstName,
        lastName:     tenants.lastName,
        email:        tenants.email,
        leaseEndDate: tenants.leaseEndDate,
        monthlyRent:  tenants.monthlyRent,
      })
      .from(tenants)
      .where(and(
        inArray(tenants.unitId, allUnits.map(u => u.id)),
        eq(tenants.status, "active"),
      ));

    // This-month payments
    const tenantIds = activeTenants.map(t => t.id);
    const monthPayments = tenantIds.length > 0
      ? await db
          .select({
            tenantId:  rentPayments.tenantId,
            status:    rentPayments.status,
            paidDate:  rentPayments.paidDate,
            amount:    rentPayments.amount,
            dueDate:   rentPayments.dueDate,
          })
          .from(rentPayments)
          .where(and(
            inArray(rentPayments.tenantId, tenantIds),
            gte(rentPayments.createdAt, som),
            lte(rentPayments.createdAt, eom),
          ))
      : [];

    const tenantByUnit   = Object.fromEntries(activeTenants.map(t => [t.unitId, t]));
    const paymentByTenant = Object.fromEntries(monthPayments.map(p => [p.tenantId, p]));
    const now = new Date();

    // Build enriched unit objects
    const enrichUnit = (u: typeof allUnits[0]) => {
      const tenant  = tenantByUnit[u.id];
      const payment = tenant ? paymentByTenant[tenant.id] : undefined;

      let paymentStatus: "paid" | "unpaid" | "overdue" | null = null;
      let daysOverdue: number | null = null;

      if (tenant) {
        if (payment?.status === "paid" || payment?.status === "completed") {
          paymentStatus = "paid";
        } else if (payment?.dueDate && new Date(payment.dueDate) < now) {
          paymentStatus = "overdue";
          daysOverdue = Math.floor((now.getTime() - new Date(payment.dueDate).getTime()) / 86_400_000);
        } else {
          paymentStatus = "unpaid";
        }
      }

      return {
        id:              u.id,
        unitNumber:      u.unitNumber,
        isOccupied:      u.isOccupied,
        bedrooms:        u.bedrooms,
        bathrooms:       u.bathrooms,
        monthlyRent:     tenant?.monthlyRent ?? u.monthlyRent,
        tenantId:        tenant?.id ?? null,
        tenantName:      tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
        tenantEmail:     tenant?.email ?? null,
        leaseEndDate:    tenant?.leaseEndDate ?? null,
        paymentStatus,
        lastPaymentDate: payment?.paidDate ?? null,
        daysOverdue,
      };
    };

    const result = ownerProperties.map(prop => ({
      id:      prop.id,
      name:    prop.name,
      address: prop.address,
      units:   allUnits
                      .filter(u => u.propertyId === prop.id)
                      .map(enrichUnit),
    }));

    return res.json(result);
  } catch (err) {
    console.error("Landlord unit-grid GET:", err);
    return res.status(500).json({ message: "Failed to fetch unit grid" });
  }
});

export default router;

// ── Tenants list ──────────────────────────────────────────────────────────────
// GET /api/landlord-portal/tenants?ownerId=&search=&status=&page=&pageSize=
router.get("/tenants", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });

    const search   = (req.query.search as string | undefined)?.trim();
    const status   = (req.query.status as string | undefined) ?? "all";
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const conditions: SQL<unknown>[] = [inArray(units.propertyId, propertyIds)];
    if (status === "active")   conditions.push(eq(tenants.status, "active"));
    if (status === "inactive") conditions.push(eq(tenants.status, "inactive"));
    if (search) {
      conditions.push(or(
        ilike(tenants.firstName, `%${search}%`),
        ilike(tenants.lastName,  `%${search}%`),
        ilike(tenants.email,     `%${search}%`),
        ilike(units.unitNumber,  `%${search}%`),
        ilike(properties.name,   `%${search}%`),
      )!);
    }

    const baseQuery = db
      .select({
        id:             tenants.id,
        userId:         tenants.userId,
        firstName:      tenants.firstName,
        lastName:       tenants.lastName,
        email:          tenants.email,
        phone:          tenants.phone,
        status:         tenants.status,
        monthlyRent:    tenants.monthlyRent,
        leaseStartDate: tenants.leaseStartDate,
        leaseEndDate:   tenants.leaseEndDate,
        currency:       tenants.currency,
        unitNumber:     units.unitNumber,
        propertyName:   properties.name,
        propertyId:     properties.id,
      })
      .from(tenants)
      .leftJoin(units,      eq(tenants.unitId,     units.id))
      .leftJoin(properties, eq(units.propertyId,   properties.id))
      .where(and(...conditions));

    const [{ total }] = await db
      .select({ total: count() })
      .from(tenants)
      .leftJoin(units,      eq(tenants.unitId,   units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...conditions));

    const rows = await baseQuery
      .orderBy(tenants.firstName)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return res.json({ data: rows, total: Number(total), page, pageSize, totalPages: Math.ceil(Number(total) / pageSize) });
  } catch (err) {
    console.error("Landlord tenants error:", err);
    return res.status(500).json({ message: "Failed to fetch tenants" });
  }
});

// ── Rent collection ───────────────────────────────────────────────────────────
// GET /api/landlord-portal/rent-collection?ownerId=&month=YYYY-MM&status=
router.get("/rent-collection", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json({ summary: {}, payments: [] });

    const monthParam = (req.query.month as string) || format(new Date(), "yyyy-MM");
    const [yr, mo]   = monthParam.split("-").map(Number);
    const som = startOfMonth(new Date(yr, mo - 1, 1));
    const eom = endOfMonth(new Date(yr, mo - 1, 1));

    // All active tenants for these properties
    const allTenants = await db
      .select({
        id:          tenants.id,
        firstName:   tenants.firstName,
        lastName:    tenants.lastName,
        email:       tenants.email,
        phone:       tenants.phone,
        monthlyRent: tenants.monthlyRent,
        currency:    tenants.currency,
        unitNumber:  units.unitNumber,
        propertyName: properties.name,
        propertyId:  properties.id,
      })
      .from(tenants)
      .leftJoin(units,      eq(tenants.unitId,   units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(inArray(units.propertyId, propertyIds), eq(tenants.status, "active")));

    // Payments made this month
    const payments = await db
      .select({
        id:        rentPayments.id,
        tenantId:  rentPayments.tenantId,
        amount:    rentPayments.amount,
        status:    rentPayments.status,
        paidDate:    rentPayments.paidDate,
        mpesaTransactionId: rentPayments.mpesaTransactionId,
        paymentMethod: rentPayments.paymentMethod,
      })
      .from(rentPayments)
      .where(and(
        inArray(rentPayments.tenantId, allTenants.map(t => t.id)),
        gte(rentPayments.createdAt, som),
        lte(rentPayments.createdAt, eom),
      ));

    const paidSet = new Set(
      payments.filter(p => p.status === "paid" || p.status === "completed").map(p => p.tenantId)
    );
    const paymentByTenant = Object.fromEntries(payments.map(p => [p.tenantId, p]));

    const enriched = allTenants.map(t => ({
      ...t,
      paymentStatus: paidSet.has(t.id) ? "paid" : "unpaid",
      payment: paymentByTenant[t.id] ?? null,
    }));

    const totalExpected = allTenants.reduce((s, t) => s + Number(t.monthlyRent ?? 0), 0);
    const totalCollected = payments
      .filter(p => p.status === "paid" || p.status === "completed")
      .reduce((s, p) => s + Number(p.amount ?? 0), 0);

    return res.json({
      month: monthParam,
      summary: {
        totalTenants: allTenants.length,
        paid: paidSet.size,
        unpaid: allTenants.length - paidSet.size,
        totalExpected: totalExpected.toFixed(2),
        totalCollected: totalCollected.toFixed(2),
        collectionRate: allTenants.length > 0 ? ((paidSet.size / allTenants.length) * 100).toFixed(1) : "0.0",
      },
      payments: enriched,
    });
  } catch (err) {
    console.error("Landlord rent-collection error:", err);
    return res.status(500).json({ message: "Failed to fetch rent collection data" });
  }
});

// ── Update maintenance request status ─────────────────────────────────────────
// PATCH /api/landlord-portal/maintenance/:id
router.patch("/maintenance/:id", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, assignedTo, notes } = req.body;
    if (!id) return res.status(400).json({ message: "Invalid request ID" });

    const patch: any = {};
    if (status)     patch.status     = status;
    if (assignedTo !== undefined) patch.assignedTo = assignedTo;
    if (notes !== undefined)      patch.notes      = notes;

    const [updated] = await db
      .update(maintenanceRequests)
      .set(patch)
      .where(eq(maintenanceRequests.id, id))
      .returning();

    return res.json(updated);
  } catch (err) {
    console.error("Landlord maintenance PATCH error:", err);
    return res.status(500).json({ message: "Failed to update maintenance request" });
  }
});

// ── Tenant payment history ─────────────────────────────────────────────────────
// GET /api/landlord-portal/tenants/:id/payments?page=&pageSize=
router.get("/tenants/:id/payments", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const tenantId = parseInt(req.params.id);
    const ownerId  = (req as any).ownerId as string;
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 12));

    if (!tenantId) return res.status(400).json({ message: "Invalid tenant ID" });

    // ── Ownership check ──────────────────────────────────────────────────────
    // Verify the tenant belongs to a property owned by the requesting landlord.
    // Without this check any landlord can read any tenant's payment history
    // by guessing tenant IDs — the requireOwner middleware alone is not enough
    // because it only secures the ownerId resolution, not the tenantId param.
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) {
      return res.status(403).json({ message: "No properties found for this owner" });
    }

    const [tenantRow] = await db
      .select({ unitId: tenants.unitId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenantRow) return res.status(404).json({ message: "Tenant not found" });

    if (tenantRow.unitId) {
      const [unit] = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(eq(units.id, tenantRow.unitId))
        .limit(1);

      if (!unit || !propertyIds.includes(unit.propertyId)) {
        return res.status(403).json({ message: "Access denied: tenant is not in your portfolio" });
      }
    }
    // ── End ownership check ──────────────────────────────────────────────────

    const [{ total }] = await db
      .select({ total: count() })
      .from(rentPayments)
      .where(eq(rentPayments.tenantId, tenantId));

    const rows = await db
      .select({
        id:                 rentPayments.id,
        invoiceNumber:      rentPayments.invoiceNumber,
        amount:             rentPayments.amount,
        currency:           rentPayments.currency,
        dueDate:            rentPayments.dueDate,
        paidDate:           rentPayments.paidDate,
        paymentMethod:      rentPayments.paymentMethod,
        mpesaTransactionId: rentPayments.mpesaTransactionId,
        bankReference:      rentPayments.bankReference,
        status:             rentPayments.status,
        notes:              rentPayments.notes,
        createdAt:          rentPayments.createdAt,
      })
      .from(rentPayments)
      .where(eq(rentPayments.tenantId, tenantId))
      .orderBy(desc(rentPayments.dueDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return res.json({
      data: rows,
      total: Number(total),
      page,
      pageSize,
      totalPages: Math.ceil(Number(total) / pageSize),
    });
  } catch (err) {
    console.error("Tenant payment history error:", err);
    return res.status(500).json({ message: "Failed to fetch payment history" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/landlord-portal/expenses?ownerId=&propertyId=&page=&pageSize=
router.get("/expenses", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });

    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const conditions: SQL<unknown>[] = [inArray(propertyExpenses.propertyId, propertyIds)];
    if (propertyId) conditions.push(eq(propertyExpenses.propertyId, propertyId));

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(propertyExpenses)
        .where(and(...conditions))
        .orderBy(desc(propertyExpenses.expenseDate))
        .limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(propertyExpenses).where(and(...conditions)),
    ]);

    return res.json({ data: rows, total: Number(total), page, pageSize, totalPages: Math.ceil(Number(total) / pageSize) });
  } catch (err) {
    console.error("Landlord expenses GET:", err);
    return res.status(500).json({ message: "Failed to fetch expenses" });
  }
});

// POST /api/landlord-portal/expenses
router.post("/expenses", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);

    const { propertyId, vendorName, description, amount, currency, category, expenseDate, dueDate, paymentMethod, notes } = req.body;

    if (!propertyId || !vendorName || !description || !amount || !category || !expenseDate) {
      return res.status(400).json({ message: "propertyId, vendorName, description, amount, category, and expenseDate are required" });
    }
    if (!propertyIds.includes(Number(propertyId))) {
      return res.status(403).json({ message: "Property does not belong to this owner" });
    }

    const expenseNumber = `EXP-${Date.now().toString(36).toUpperCase()}`;
    const [expense] = await db.insert(propertyExpenses).values({
      expenseNumber,
      propertyId: Number(propertyId),
      vendorName: vendorName.trim(),
      description: description.trim(),
      amount: String(amount),
      currency: currency || "KES",
      category,
      expenseDate: new Date(expenseDate),
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentMethod: paymentMethod || null,
      notes: notes || null,
      status: "pending",
    } as any).returning();

    return res.status(201).json(expense);
  } catch (err) {
    console.error("Landlord expenses POST:", err);
    return res.status(500).json({ message: "Failed to create expense" });
  }
});

// DELETE /api/landlord-portal/expenses/:id
router.delete("/expenses/:id", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    const id = parseInt(req.params.id);

    const [expense] = await db.select().from(propertyExpenses).where(eq(propertyExpenses.id, id)).limit(1);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    if (!propertyIds.includes(expense.propertyId)) return res.status(403).json({ message: "Access denied" });

    await db.delete(propertyExpenses).where(eq(propertyExpenses.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("Landlord expenses DELETE:", err);
    return res.status(500).json({ message: "Failed to delete expense" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/landlord-portal/documents?ownerId=&propertyId=
router.get("/documents", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json([]);

    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
    const ids = propertyId ? [propertyId] : propertyIds;

    const rows = await db.select().from(documents)
      .where(inArray(documents.propertyId, ids))
      .orderBy(desc(documents.createdAt))
      .limit(100);

    return res.json(rows);
  } catch (err) {
    console.error("Landlord documents GET:", err);
    return res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// DELETE /api/landlord-portal/documents/:id
router.delete("/documents/:id", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    const id = parseInt(req.params.id);

    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) return res.status(404).json({ message: "Document not found" });
    if (doc.propertyId && !propertyIds.includes(doc.propertyId)) return res.status(403).json({ message: "Access denied" });

    await db.delete(documents).where(eq(documents.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("Landlord documents DELETE:", err);
    return res.status(500).json({ message: "Failed to delete document" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE APPROVALS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/landlord-portal/maintenance/pending-approval?ownerId=
router.get("/maintenance/pending-approval", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const ownerId = (req as any).ownerId as string;
    const { propertyIds } = await resolveOwnerProperties(ownerId, req.user.organizationId as number);
    if (propertyIds.length === 0) return res.json([]);

    const rows = await db
      .select({
        id:            maintenanceRequests.id,
        ticketNumber:  maintenanceRequests.ticketNumber,
        title:         maintenanceRequests.title,
        description:   maintenanceRequests.description,
        category:      maintenanceRequests.category,
        priority:      maintenanceRequests.priority,
        status:        maintenanceRequests.status,
        estimatedCost: maintenanceRequests.estimatedCost,
        approvalRequired: maintenanceRequests.approvalRequired,
        approvedBy:    maintenanceRequests.approvedBy,
        approvedDate:  maintenanceRequests.approvedDate,
        rejectionReason: maintenanceRequests.rejectionReason,
        internalNotes: maintenanceRequests.internalNotes,
        createdAt:     maintenanceRequests.createdAt,
        propertyName:  properties.name,
        unitNumber:    units.unitNumber,
      })
      .from(maintenanceRequests)
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        inArray(units.propertyId, propertyIds),
        eq(maintenanceRequests.approvalRequired, true),
      ))
      .orderBy(desc(maintenanceRequests.createdAt));

    return res.json(rows);
  } catch (err) {
    console.error("Landlord pending-approval GET:", err);
    return res.status(500).json({ message: "Failed to fetch pending approvals" });
  }
});

// PATCH /api/landlord-portal/maintenance/:id/approve
router.patch("/maintenance/:id/approve", authenticateJWT, requireOrg, requireOwner, async (req: any, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const id = parseInt(req.params.id);
    const { action, rejectionReason, notes } = req.body; // action: "approve" | "reject"

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }
    if (action === "reject" && !rejectionReason?.trim()) {
      return res.status(400).json({ message: "rejectionReason is required when rejecting" });
    }

    const patch: any = {
      approvedBy:   userId,
      approvedDate: new Date(),
      internalNotes: notes || null,
    };

    if (action === "approve") {
      patch.status = "assigned";
      patch.rejectionReason = null;
    } else {
      patch.status = "cancelled";
      patch.rejectionReason = rejectionReason.trim();
    }

    const [updated] = await db
      .update(maintenanceRequests)
      .set(patch)
      .where(eq(maintenanceRequests.id, id))
      .returning();

    // Send notification to property manager
    try {
      const userId = String(req.user.userId || req.user.id);
      const fromName = `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Landlord";
      const [reqRow] = await db.select({ ticketNumber: maintenanceRequests.ticketNumber }).from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).limit(1);
      if (reqRow) await sendApprovalNotification(req.user.organizationId, userId, fromName, reqRow.ticketNumber, action, rejectionReason);
    } catch { /* non-fatal */ }

    return res.json(updated);
  } catch (err) {
    console.error("Landlord maintenance approve PATCH:", err);
    return res.status(500).json({ message: "Failed to update approval" });
  }
});