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
        // Fetch all payments for this org
        const pays = await db
          .select()
          .from(rentPayments)
          .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .where(eq(tenants.organizationId, orgId));

        const allPays = pays.map(r => r.rent_payments);

        // FIX: inPeriod applied to ALL period-specific stats
        const inPeriod = allPays.filter(p => inRange(p.createdAt, since, until));

        const totalRevenue = inPeriod
          .filter(p => ["paid", "completed"].includes(p.status ?? ""))
          .reduce((s, p) => s + Number(p.amount ?? 0), 0);

        // FIX: pending/overdue also scoped to the selected period
        const totalPending = inPeriod
          .filter(p => ["pending", "processing"].includes(p.status ?? ""))
          .reduce((s, p) => s + Number(p.amount ?? 0), 0);

        const totalOverdue = inPeriod
          .filter(p => p.status === "overdue")
          .reduce((s, p) => s + Number(p.amount ?? 0), 0);

        // FIX: expenses use both gte(since) AND lte(until) for correct bounds
        const [expResult] = await db
          .select({ total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
          .from(propertyExpenses)
          .leftJoin(properties, eq(propertyExpenses.propertyId, properties.id))
          .where(and(
            eq(properties.organizationId, orgId),
            gte(propertyExpenses.createdAt, since),
            lte(propertyExpenses.createdAt, until),
          ));

        const [svcResult] = await db
          .select({ total: sql<string>`COALESCE(SUM(${serviceCharges.amount}), 0)` })
          .from(serviceCharges)
          .leftJoin(properties, eq(serviceCharges.propertyId, properties.id))
          .where(and(
            eq(properties.organizationId, orgId),
            gte(serviceCharges.createdAt, since),
            lte(serviceCharges.createdAt, until),
          ));

        const totalExpenses = Number(expResult?.total ?? 0) + Number(svcResult?.total ?? 0);

        return res.json({
          data: {
            title: "Financial Report",
            totalRevenue,
            totalExpenses,
            netIncome: totalRevenue - totalExpenses,
            totalPending,
            totalOverdue,
            paymentCount: inPeriod.filter(p => ["paid", "completed"].includes(p.status ?? "")).length,
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
        const pays = await db
          .select()
          .from(rentPayments)
          .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .where(eq(tenants.organizationId, orgId));

        const allPays  = pays.map(r => r.rent_payments);
        const inPeriod = allPays.filter(p => inRange(p.createdAt, since, until));

        const paidPays       = inPeriod.filter(p => ["paid", "completed"].includes(p.status ?? ""));
        const totalCollected = paidPays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const overduePays    = inPeriod.filter(p => p.status === "overdue");
        const totalOverdue   = overduePays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const totalExpected  = totalCollected + totalOverdue;
        const collectionRate = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 100;

        const methodMap: Record<string, { count: number; amount: number }> = {};
        for (const p of paidPays) {
          const m = (p.paymentMethod ?? "unknown").toLowerCase();
          if (!methodMap[m]) methodMap[m] = { count: 0, amount: 0 };
          methodMap[m].count++;
          methodMap[m].amount += Number(p.amount ?? 0);
        }
        const byMethod = Object.entries(methodMap).map(([method, v]) => ({ method, ...v }));

        return res.json({
          data: {
            title: "Rent Collection Report",
            totalCollected,
            totalOverdue,
            collectionRate,
            paymentCount:  paidPays.length,
            overdueCount:  overduePays.length,
            byMethod,
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
            gte(rentPayments.createdAt, since),
            lte(rentPayments.createdAt, until),
          ))
          .orderBy(rentPayments.createdAt);

        csv = [
          "ID,Tenant,Amount,Status,Due Date,Method,Invoice,Created",
          ...rows.map(r =>
            `"${r.id}","${r.tenantFirstName ?? ""} ${r.tenantLastName ?? ""}","${r.amount}","${r.status}","${r.dueDate ?? ""}","${r.paymentMethod ?? ""}","${r.invoiceNumber ?? ""}","${r.createdAt ?? ""}"`
          ),
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

        const payRows = await db
          .select()
          .from(rentPayments)
          .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .where(eq(tenants.organizationId, orgId));

        // Reuse date-string comparison for lease date fields
        const sinceStr = since.toISOString().split("T")[0];
        const untilStr = until.toISOString().split("T")[0];

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
            const collected     = payRows
              .map(r => r.rent_payments)
              .filter(pay => {
                const tenantRow = tenantRows.find(t => t.id === pay.tenantId);
                return tenantRow && tenantRow.unitId !== null && unitIds.has(tenantRow.unitId!) &&
                  ["paid", "completed"].includes(pay.status ?? "") &&
                  inRange(pay.createdAt, since, until);
              })
              .reduce((s, pay) => s + Number(pay.amount ?? 0), 0);
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