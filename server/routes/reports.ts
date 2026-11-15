/**
 * Reports router — mounted at /api/reports
 *
 * POST /api/reports/generate        — generate a named report for a period
 * GET  /api/reports/export/:type    — stream a CSV download (accepts ?startDate=&endDate= query params)
 */
import { Router } from "express";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import {
  properties, units, tenants, rentPayments,
  maintenanceRequests, propertyExpenses, serviceCharges,
} from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { rentCollectionSummary, rentReceivedBetween, rentBalances, todayEAT, round2 } from "../services/rent-ledger";

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

function periodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case "week":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "quarter":
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    case "month":
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

/**
 * Parse a YYYY-MM-DD string into a Date.
 * The start date is the very beginning of that day (00:00:00.000).
 * The end date is the very end of that day (23:59:59.999) so records
 * created anywhere on that day are included.
 */
function parseSince(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseUntil(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Derive since/until from the request body, honouring custom dates over period keywords. */
function resolveDateRange(body: any): { since: Date; until: Date } {
  const { period = "month", startDate, endDate } = body;
  const since = startDate ? parseSince(startDate) : periodStart(period);
  // For preset periods, `until` is end-of-today so records from today are included
  const until = endDate ? parseUntil(endDate) : parseUntil(new Date().toISOString().split("T")[0]);
  return { since, until };
}

/**
 * Money reports work in EAT calendar days (YYYY-MM-DD), not server-local Dates, so a period
 * never shifts with the server's timezone. Custom dates win over the period keyword.
 */
function resolveDayRange(body: any): { from: string; to: string } {
  const { period = "month", startDate, endDate } = body ?? {};
  const today = todayEAT();
  const [y, m, d] = today.split("-").map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  let from: string;
  switch (period) {
    case "week":    from = iso(new Date(Date.UTC(y, m - 1, d - 7))); break;
    case "quarter": from = iso(new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1))); break;
    case "year":    from = iso(new Date(Date.UTC(y, 0, 1))); break;
    default:        from = iso(new Date(Date.UTC(y, m - 1, 1)));
  }
  const day = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return { from: day(startDate) ?? from, to: day(endDate) ?? today };
}

/** CSV cell: doubles quotes and defuses spreadsheet formulas (=, +, -, @ at the start). */
function cell(v: unknown): string {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}

/** JS-side filter: is this record's createdAt within [since, until]? */
function inRange(createdAt: Date | string | null | undefined, since: Date, until: Date): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return t >= since.getTime() && t <= until.getTime();
}

// ─── POST /api/reports/generate ──────────────────────────────────────────────

router.post("/generate", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const { reportType } = req.body;
    const { since, until } = resolveDateRange(req.body);

    switch (reportType) {

      // ── financial ──────────────────────────────────────────────────────────
      case "financial": {
        // Revenue is CASH RECEIVED in the period (receipts by payment date), the same definition as the
        // dashboards and owner statements. Pending / overdue are the balances still owed on invoices that
        // fell due in the period — a part-paid invoice contributes only what is left on it.
        const { from, to } = resolveDayRange(req.body);
        const sum = await rentCollectionSummary({ orgId }, from, to);

        // Only approved / paid expenses are real costs; bounded by the expense date.
        const [expResult] = await db
          .select({ total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
          .from(propertyExpenses)
          .leftJoin(properties, eq(propertyExpenses.propertyId, properties.id))
          .where(and(
            eq(properties.organizationId, orgId),
            sql`${propertyExpenses.status} IN ('approved', 'paid')`,
            sql`${propertyExpenses.expenseDate}::date BETWEEN ${from}::date AND ${to}::date`,
          ));

        const [svcResult] = await db
          .select({ total: sql<string>`COALESCE(SUM(${serviceCharges.amount}), 0)` })
          .from(serviceCharges)
          .leftJoin(properties, eq(serviceCharges.propertyId, properties.id))
          .where(and(
            eq(properties.organizationId, orgId),
            sql`${serviceCharges.createdAt}::date BETWEEN ${from}::date AND ${to}::date`,
          ));

        const totalRevenue  = sum.received;
        const totalExpenses = round2(Number(expResult?.total ?? 0) + Number(svcResult?.total ?? 0));

        return res.json({
          data: {
            title: "Financial Report",
            totalRevenue,
            totalExpenses,
            netIncome: round2(totalRevenue - totalExpenses),
            totalPending: sum.pending.total,
            totalOverdue: sum.overdue.total,
            paymentCount: sum.paymentCount,
            periodStart: from,
            periodEnd: to,
          },
        });
      }

      // ── occupancy ──────────────────────────────────────────────────────────
      // Current isOccupied is the live snapshot.
      // Move-ins/outs and per-property "active during period" counts use lease dates.
      case "occupancy": {
        const allUnits = await db
          .select({ id: units.id, isOccupied: units.isOccupied, propertyId: units.propertyId })
          .from(units)
          .leftJoin(properties, eq(units.propertyId, properties.id))
          .where(eq(properties.organizationId, orgId));

        const props = await db
          .select({ id: properties.id, name: properties.name })
          .from(properties)
          .where(eq(properties.organizationId, orgId));

        const allTenantRows = await db
          .select({
            id:             tenants.id,
            unitId:         tenants.unitId,
            leaseStartDate: tenants.leaseStartDate,
            leaseEndDate:   tenants.leaseEndDate,
            status:         tenants.status,
          })
          .from(tenants)
          .where(eq(tenants.organizationId, orgId));

        // leaseStartDate / leaseEndDate are date-only columns ("YYYY-MM-DD").
        // Parsing them as full Date objects shifts them by the UTC offset, so
        // boundary dates fall outside the window. Compare at the string level.
        const sinceStr = since.toISOString().split("T")[0];
        const untilStr = until.toISOString().split("T")[0];

        const inDateRange = (dateStr: string | null | undefined): boolean => {
          if (!dateStr) return false;
          const d = dateStr.slice(0, 10);
          return d >= sinceStr && d <= untilStr;
        };

        // A tenant was active during the period if their lease overlapped [since, until].
        const activeDuringPeriod = (t: { leaseStartDate?: string | null; leaseEndDate?: string | null }): boolean => {
          const start = t.leaseStartDate?.slice(0, 10) ?? null;
          const end   = t.leaseEndDate?.slice(0, 10)   ?? null;
          if (!start || start > untilStr) return false;
          if (end && end < sinceStr) return false;
          return true;
        };

        const moveIns  = allTenantRows.filter(t => inDateRange(t.leaseStartDate)).length;
        const moveOuts = allTenantRows.filter(t => inDateRange(t.leaseEndDate)).length;

        // Current snapshot totals
        const totalUnits    = allUnits.length;
        const occupiedUnits = allUnits.filter(u => u.isOccupied).length;
        const vacantUnits   = totalUnits - occupiedUnits;
        const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

        // Per-property: units that had an active tenant during the selected period
        const byProperty = props.map(p => {
          const pUnits  = allUnits.filter(u => u.propertyId === p.id);
          const unitIds = new Set(pUnits.map(u => u.id));
          const occupied = new Set(
            allTenantRows
              .filter(t => t.unitId !== null && unitIds.has(t.unitId!) && activeDuringPeriod(t))
              .map(t => t.unitId)
          ).size;
          return {
            property: p.name,
            total:    pUnits.length,
            occupied,
            rate: pUnits.length > 0 ? Math.round((occupied / pUnits.length) * 100) : 0,
          };
        });

        return res.json({
          data: {
            title: "Occupancy Report",
            totalUnits,
            occupiedUnits,
            vacantUnits,
            occupancyRate,
            moveIns,
            moveOuts,
            byProperty,
          },
        });
      }

      // ── maintenance ────────────────────────────────────────────────────────
      case "maintenance": {
        const requests = await db
          .select()
          .from(maintenanceRequests)
          .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
          .where(eq(tenants.organizationId, orgId));

        const allReqs  = requests.map(r => r.maintenance_requests);
        const inPeriod = allReqs.filter(r => inRange(r.createdAt, since, until));

        const completedRequests = inPeriod.filter(r => r.status === "completed").length;
        const pendingRequests   = inPeriod.filter(r =>
          ["pending", "assigned", "in_progress"].includes(r.status ?? "")
        ).length;

        const resolved = inPeriod.filter(r => r.status === "completed" && r.createdAt && r.updatedAt);
        const avgHours = resolved.length > 0
          ? Math.round(
              resolved.reduce((s, r) => {
                const diff = new Date(r.updatedAt!).getTime() - new Date(r.createdAt!).getTime();
                return s + diff / 3_600_000;
              }, 0) / resolved.length
            )
          : 0;

        const priorities = ["low", "medium", "high", "urgent", "emergency"];
        const byPriority = priorities.map(priority => ({
          priority,
          count: inPeriod.filter(r => r.priority === priority).length,
        }));

        return res.json({
          data: {
            title: "Maintenance Report",
            totalRequests: inPeriod.length,
            completedRequests,
            pendingRequests,
            averageResolutionHours: avgHours,
            byPriority,
          },
        });
      }

      // ── rent-collection ────────────────────────────────────────────────────
      case "rent-collection": {
        const { from, to } = resolveDayRange(req.body);
        const sum = await rentCollectionSummary({ orgId }, from, to);

        return res.json({
          data: {
            title: "Rent Collection Report",
            totalCollected: sum.received,           // cash received in the period
            totalOverdue:   sum.overdue.total,      // still owed on overdue invoices due in the period
            totalBilled:    sum.billed,             // invoices falling due in the period
            collectionRate: sum.billed > 0 ? sum.collectionRate : 100,
            paymentCount:   sum.paymentCount,
            overdueCount:   sum.overdue.count,
            byMethod:       sum.byMethod,
            periodStart: from,
            periodEnd: to,
          },
        });
      }

      // ── accounting reports (delegate to storage layer) ────────────────────
      case "trial_balance": {
        const asOfDate     = (req.body.endDate || req.body.asOfDate || new Date().toISOString().split("T")[0]) as string;
        const costCenterId = req.body.costCenterId as string | undefined;
        const report       = await storage.generateTrialBalance(asOfDate, costCenterId, orgId);
        return res.json({ data: { title: "Trial Balance", ...report } });
      }

      case "income_statement": {
        const startDate    = (req.body.startDate || since.toISOString().split("T")[0]) as string;
        const endDate      = (req.body.endDate   || new Date().toISOString().split("T")[0]) as string;
        const costCenterId = req.body.costCenterId as string | undefined;
        const report       = await storage.generateIncomeStatement(startDate, endDate, costCenterId, orgId);
        return res.json({ data: { title: "Income Statement (Profit & Loss)", ...report } });
      }

      case "balance_sheet": {
        const asOfDate     = (req.body.endDate || req.body.asOfDate || new Date().toISOString().split("T")[0]) as string;
        const costCenterId = req.body.costCenterId as string | undefined;
        const report       = await storage.generateBalanceSheet(asOfDate, costCenterId, orgId);
        return res.json({ data: { title: "Balance Sheet", ...report } });
      }

      case "cash_flow": {
        const startDate    = (req.body.startDate || since.toISOString().split("T")[0]) as string;
        const endDate      = (req.body.endDate   || new Date().toISOString().split("T")[0]) as string;
        const costCenterId = req.body.costCenterId as string | undefined;
        const report       = await storage.generateCashFlowStatement(startDate, endDate, costCenterId, orgId);
        return res.json({ data: { title: "Cash Flow Statement", ...report } });
      }

      default:
        return res.status(400).json({ message: `Unknown report type: ${reportType}` });
    }
  } catch (err) {
    console.error("Generate report error:", err);
    res.status(500).json({ message: "Failed to generate report" });
  }
});

// ─── GET /api/reports/export/:type ───────────────────────────────────────────
// FIX: now reads ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD query params
// and filters all three export types accordingly.

router.get("/export/:type", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const { type }      = req.params;

    // Derive date range from query params (same logic as /generate)
    const { since, until } = resolveDateRange({
      period:    req.query.period    as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate:   req.query.endDate   as string | undefined,
    });

    // Build a filename suffix that reflects the actual range
    const rangeTag = `${since.toISOString().split("T")[0]}_to_${until.toISOString().split("T")[0]}`;
    const filename = `${type}-${rangeTag}.csv`;

    let csv = "";

    switch (type) {
      case "payments": {
        // Rent invoices falling due in the range, with what has been paid and what is left on each.
        const { from, to } = resolveDayRange({
          period: req.query.period, startDate: req.query.startDate, endDate: req.query.endDate,
        });
        const rows = await db
          .select({
            id:              rentPayments.id,
            amount:          rentPayments.amount,
            status:          rentPayments.status,
            dueDate:         rentPayments.dueDate,
            paymentMethod:   rentPayments.paymentMethod,
            invoiceNumber:   rentPayments.invoiceNumber,
            createdAt:       rentPayments.createdAt,
            tenantFirstName: tenants.firstName,
            tenantLastName:  tenants.lastName,
          })
          .from(rentPayments)
          .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .where(and(
            eq(tenants.organizationId, orgId),
            sql`${rentPayments.dueDate}::date BETWEEN ${from}::date AND ${to}::date`,
          ))
          .orderBy(rentPayments.dueDate);

        const bal = await rentBalances(rows.map(r => ({ id: r.id, amount: r.amount, status: r.status })));

        csv = [
          "ID,Tenant,Amount,Paid,Balance,Status,Due Date,Method,Invoice,Created",
          ...rows.map(r => {
            const b = bal.get(r.id);
            return [
              r.id, `${r.tenantFirstName ?? ""} ${r.tenantLastName ?? ""}`.trim(), r.amount,
              b?.paidAmount ?? 0, b?.balance ?? Number(r.amount),
              r.status, r.dueDate ?? "", r.paymentMethod ?? "", r.invoiceNumber ?? "", r.createdAt ?? "",
            ].map(cell).join(",");
          }),
        ].join("\n");
        break;
      }

      case "tenants": {
        // FIX: join units to get unitNumber; filter by move-in date within range
        const rows = await db
          .select({
            id:         tenants.id,
            firstName:  tenants.firstName,
            lastName:   tenants.lastName,
            email:      tenants.email,
            phone:      tenants.phone,
            status:     tenants.status,
            leaseStartDate: tenants.leaseStartDate,
            createdAt:  tenants.createdAt,
            unitNumber: units.unitNumber,
          })
          .from(tenants)
          .leftJoin(units, eq(tenants.unitId, units.id))
          .where(and(
            eq(tenants.organizationId, orgId),
            gte(tenants.createdAt, since),
            lte(tenants.createdAt, until),
          ));

        csv = [
          "ID,First Name,Last Name,Email,Phone,Status,Move-in Date,Unit,Created",
          ...rows.map(r =>
            `"${r.id}","${r.firstName ?? ""}","${r.lastName ?? ""}","${r.email ?? ""}","${r.phone ?? ""}","${r.status ?? ""}","${r.leaseStartDate ?? ""}","${r.unitNumber ?? ""}","${r.createdAt ?? ""}"`
          ),
        ].join("\n");
        break;
      }

      case "properties": {
        // Export all properties enriched with period-specific metrics:
        // active tenants, rent collected, and occupancy rate for the selected window.
        const propRows = await db
          .select()
          .from(properties)
          .where(eq(properties.organizationId, orgId));

        const unitRows = await db
          .select({ id: units.id, propertyId: units.propertyId, isOccupied: units.isOccupied })
          .from(units)
          .leftJoin(properties, eq(units.propertyId, properties.id))
          .where(eq(properties.organizationId, orgId));

        const tenantRows = await db
          .select({ id: tenants.id, unitId: tenants.unitId, leaseStartDate: tenants.leaseStartDate, leaseEndDate: tenants.leaseEndDate, status: tenants.status })
          .from(tenants)
          .where(eq(tenants.organizationId, orgId));

        // Cash received per property over the selected window (receipts by payment date)
        const { from: cashFrom, to: cashTo } = resolveDayRange({
          period: req.query.period, startDate: req.query.startDate, endDate: req.query.endDate,
        });
        const collectedBy = new Map<number, number>();
        await Promise.all(propRows.map(async p => {
          collectedBy.set(p.id, await rentReceivedBetween([p.id], cashFrom, cashTo));
        }));

        // Reuse date-string comparison for lease date fields
        const sinceStr = cashFrom;
        const untilStr = cashTo;

        const activeDuringPeriod = (t: { leaseStartDate?: string | null; leaseEndDate?: string | null }): boolean => {
          const start = t.leaseStartDate?.slice(0, 10) ?? null;
          const end   = t.leaseEndDate?.slice(0, 10)   ?? null;
          if (!start || start > untilStr) return false;
          if (end && end < sinceStr) return false;
          return true;
        };

        // Format a Date or string into YYYY-MM-DD for clean CSV output
        const fmtDate = (d: Date | string | null | undefined): string =>
          d ? new Date(d).toISOString().split("T")[0] : "";

        csv = [
          `"ID","Name","Address","Total Units","Occupied Units (now)","Occupancy % (now)","Active Tenants (${sinceStr} to ${untilStr})","KES Collected (${sinceStr} to ${untilStr})","Property Created"`,
          ...propRows.map(p => {
            const pUnits        = unitRows.filter(u => u.propertyId === p.id);
            const unitIds       = new Set(pUnits.map(u => u.id));
            const activeTenants = tenantRows.filter(t => t.unitId !== null && unitIds.has(t.unitId!) && activeDuringPeriod(t)).length;
            const occupiedNow   = pUnits.filter(u => u.isOccupied).length;
            const occPct        = pUnits.length > 0 ? Math.round((occupiedNow / pUnits.length) * 100) : 0;
            const collected     = collectedBy.get(p.id) ?? 0;
            return `"${p.id}","${p.name ?? ""}","${p.address ?? ""}","${pUnits.length}","${occupiedNow}","${occPct}%","${activeTenants}","${Math.round(collected)}","${fmtDate(p.createdAt)}"`;
          }),
        ].join("\n");
        break;
      }

      default:
        return res.status(400).json({ message: `Unknown export type: ${type}` });
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("Export report error:", err);
    res.status(500).json({ message: "Failed to export report" });
  }
});

export default router;