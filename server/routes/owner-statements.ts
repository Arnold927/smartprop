/**
 * owner-statements.ts — mounted at /api/owner-statements
 *
 * Implements the full PM remittance workflow:
 *
 *   PM Agreements (fee structure per property):
 *     GET    /api/owner-statements/agreements
 *     GET    /api/owner-statements/agreements/:propertyId
 *     POST   /api/owner-statements/agreements
 *     PATCH  /api/owner-statements/agreements/:id
 *
 *   Owner Statements (monthly remittance documents):
 *     GET    /api/owner-statements                          list (filterable by property/year)
 *     GET    /api/owner-statements/:id                      single statement
 *     POST   /api/owner-statements/generate                 compute & create for a property+month
 *     PATCH  /api/owner-statements/:id/approve
 *     PATCH  /api/owner-statements/:id/mark-disbursed       record actual payment to owner
 *
 *   Rent Roll (portfolio-wide snapshot):
 *     GET    /api/owner-statements/rent-roll               all properties × units × tenants
 *
 *   Management Pack (all-in-one monthly PDF data):
 *     GET    /api/owner-statements/management-pack/:propertyId/:year/:month
 */

import { Router }    from "express";
import { db }        from "../db";
import {
  pmAgreements, ownerStatements,
  properties, units, tenants, rentPayments, propertyExpenses,
  users, organizations,
} from "@shared/schema";
import {
  eq, and, gte, lte, desc, asc, sql, inArray, sum,
} from "drizzle-orm";
import { format, startOfMonth, endOfMonth, getDaysInMonth } from "date-fns";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad   = (n: number) => String(n).padStart(2, "0");
const money = (n: any)    => Number(n ?? 0);

/** Generate next sequential statement number */
async function nextStatementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ max: sql<string>`MAX(statement_number)` })
    .from(ownerStatements);
  const last = parseInt((row?.max ?? "OWS-0000-000").split("-").pop() ?? "0") || 0;
  return `OWS-${year}-${String(last + 1).padStart(3, "0")}`;
}

async function nextAgreementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ max: sql<string>`MAX(agreement_number)` })
    .from(pmAgreements);
  const last = parseInt((row?.max ?? "PMA-0000-000").split("-").pop() ?? "0") || 0;
  return `PMA-${year}-${String(last + 1).padStart(3, "0")}`;
}

/** Compute PM fee based on agreement fee type */
function computePmFee(
  agreement: { feeType: string; feeRate: string | number },
  grossRent: number,
  occupiedUnits: number,
): number {
  const rate = Number(agreement.feeRate ?? 10);
  switch (agreement.feeType) {
    case "percentage":    return (grossRent * rate) / 100;
    case "fixed_monthly": return rate;
    case "per_unit":      return rate * occupiedUnits;
    default:              return (grossRent * rate) / 100;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PM AGREEMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/owner-statements/agreements
router.get("/agreements", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const isLandlord = req.user.role === "landlord";
    const userId     = req.user.id as string;

    const rows  = await db
      .select({
        id:              pmAgreements.id,
        propertyId:      pmAgreements.propertyId,
        agreementNumber: pmAgreements.agreementNumber,
        feeType:         pmAgreements.feeType,
        feeRate:         pmAgreements.feeRate,
        disbursementMethod: pmAgreements.disbursementMethod,
        disbursementAccount: pmAgreements.disbursementAccount,
        status:          pmAgreements.status,
        startDate:       pmAgreements.startDate,
        endDate:         pmAgreements.endDate,
        deductMaintenanceCosts: pmAgreements.deductMaintenanceCosts,
        createdAt:       pmAgreements.createdAt,
        propertyName:    properties.name,
        propertyAddress: properties.address,
        ownerFirstName:  users.firstName,
        ownerLastName:   users.lastName,
        ownerEmail:      users.email,
      })
      .from(pmAgreements)
      .leftJoin(properties, eq(pmAgreements.propertyId, properties.id))
      .leftJoin(users,      eq(pmAgreements.ownerUserId, users.id))
      .where(and(
        eq(pmAgreements.organizationId, orgId),
        ...(isLandlord ? [eq(pmAgreements.ownerUserId, userId)] : []),
      ))
      .orderBy(asc(properties.name));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// GET /api/owner-statements/agreements/:propertyId
router.get("/agreements/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const [row] = await db
      .select()
      .from(pmAgreements)
      .where(and(
        eq(pmAgreements.propertyId, parseInt(req.params.propertyId)),
        eq(pmAgreements.organizationId, req.user.organizationId),
      ))
      .limit(1);
    res.json(row ?? null);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/owner-statements/agreements
router.post("/agreements", ...auth, async (req: any, res: any) => {
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only admins and managers can create PM agreements." });
  }
  try {
    const orgId = req.user.organizationId;
    const agreementNumber = await nextAgreementNumber();

    // Auto-resolve ownerUserId from the property's ownerId if not supplied in body
    let ownerUserId = req.body.ownerUserId ?? null;
    if (!ownerUserId && req.body.propertyId) {
      const [prop] = await db
        .select({ ownerId: properties.ownerId })
        .from(properties)
        .where(and(eq(properties.id, parseInt(req.body.propertyId)), eq(properties.organizationId, orgId)))
        .limit(1);
      if (prop?.ownerId) ownerUserId = prop.ownerId;
    }

    const [created] = await db.insert(pmAgreements).values({
      ...req.body,
      organizationId: orgId,
      agreementNumber,
      ownerUserId,
      createdBy: req.user.id,
    } as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// PATCH /api/owner-statements/agreements/:id
router.patch("/agreements/:id", ...auth, async (req: any, res: any) => {
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only admins and managers can update PM agreements." });
  }
  try {
    const [updated] = await db
      .update(pmAgreements)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(
        eq(pmAgreements.id, parseInt(req.params.id)),
        eq(pmAgreements.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Agreement not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// OWNER STATEMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/owner-statements?propertyId=&year=
router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const year       = req.query.year       ? parseInt(req.query.year as string)       : null;

    // Landlords only see statements for their own properties
    const isLandlord = req.user.role === "landlord";
    const userId     = req.user.id as string;

    let q = db
      .select({
        id:              ownerStatements.id,
        statementNumber: ownerStatements.statementNumber,
        propertyId:      ownerStatements.propertyId,
        periodMonth:     ownerStatements.periodMonth,
        periodYear:      ownerStatements.periodYear,
        grossRent:       ownerStatements.grossRent,
        pmFee:           ownerStatements.pmFee,
        maintenanceCosts:ownerStatements.maintenanceCosts,
        totalDeductions: ownerStatements.totalDeductions,
        netPayable:      ownerStatements.netPayable,
        currency:        ownerStatements.currency,
        status:          ownerStatements.status,
        disbursedAt:     ownerStatements.disbursedAt,
        disbursementRef: ownerStatements.disbursementRef,
        createdAt:       ownerStatements.createdAt,
        propertyName:    properties.name,
        propertyOwnerId: properties.ownerId,
      })
      .from(ownerStatements)
      .leftJoin(properties, eq(ownerStatements.propertyId, properties.id))
      .where(and(
        eq(ownerStatements.organizationId, orgId),
        ...(propertyId   ? [eq(ownerStatements.propertyId, propertyId)] : []),
        ...(year         ? [eq(ownerStatements.periodYear,  year)]       : []),
        // Landlord scope: only their own properties
        ...(isLandlord   ? [eq(properties.ownerId, userId)]              : []),
      )) as any;

    const rows = await q.orderBy(desc(ownerStatements.periodYear), desc(ownerStatements.periodMonth));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// GET /api/owner-statements/:id
router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const isLandlord = req.user.role === "landlord";
    const userId     = req.user.id as string;

    // For landlords, additionally verify the statement belongs to their property
    const [row] = await db
      .select({
        statement: ownerStatements,
        ownerId:   properties.ownerId,
      })
      .from(ownerStatements)
      .leftJoin(properties, eq(ownerStatements.propertyId, properties.id))
      .where(and(
        eq(ownerStatements.id, parseInt(req.params.id)),
        eq(ownerStatements.organizationId, req.user.organizationId),
        ...(isLandlord ? [eq(properties.ownerId, userId)] : []),
      ))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Statement not found" });
    res.json(row.statement);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

/**
 * POST /api/owner-statements/generate
 * Body: { propertyId, year, month }
 *
 * Algorithm:
 *  1. Load PM agreement for the property
 *  2. Load all active tenants (via units.propertyId)
 *  3. Sum all confirmed rent payments for the period
 *  4. Sum approved property expenses for the period (filtered by agreement deduction rules)
 *  5. Compute PM fee
 *  6. Upsert the statement (idempotent — re-generating overwrites draft/approved but not sent/paid)
 */
router.post("/generate", ...auth, async (req: any, res: any) => {
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only admins and managers can generate owner statements." });
  }
  try {
    const orgId           = req.user.organizationId;
    const { propertyId, year, month } = req.body;

    if (!propertyId || !year || !month) {
      return res.status(400).json({ message: "propertyId, year, and month are required" });
    }

    // 1. PM agreement
    const [agreement] = await db
      .select()
      .from(pmAgreements)
      .where(and(
        eq(pmAgreements.propertyId, propertyId),
        eq(pmAgreements.organizationId, orgId),
      ))
      .limit(1);

    if (!agreement) {
      return res.status(404).json({
        message: "No PM agreement found for this property. Create one first at /api/owner-statements/agreements.",
      });
    }

    // 2. Period boundaries
    const periodStart = startOfMonth(new Date(year, month - 1, 1));
    const periodEnd   = endOfMonth(new Date(year, month - 1, 1));

    // 3. Active tenants for this property
    const propTenants = await db
      .select({
        id:          tenants.id,
        firstName:   tenants.firstName,
        lastName:    tenants.lastName,
        monthlyRent: tenants.monthlyRent,
        currency:    tenants.currency,
        unitNumber:  units.unitNumber,
        unitId:      units.id,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(
        eq(units.propertyId, propertyId),
        eq(tenants.status, "active"),
      ));

    const tenantIds     = propTenants.map(t => t.id);
    const occupiedUnits = propTenants.length;

    // 4. Confirmed rent payments this month
    const payments = tenantIds.length > 0
      ? await db
          .select({
            id:            rentPayments.id,
            tenantId:      rentPayments.tenantId,
            amount:        rentPayments.amount,
            paidDate:      rentPayments.paidDate,
            paymentMethod: rentPayments.paymentMethod,
            status:        rentPayments.status,
          })
          .from(rentPayments)
          .where(and(
            inArray(rentPayments.tenantId, tenantIds),
            inArray(rentPayments.status, ["paid", "completed"]),
            gte(rentPayments.paidDate, format(periodStart, "yyyy-MM-dd")),
            lte(rentPayments.paidDate, format(periodEnd,   "yyyy-MM-dd")),
          ))
      : [];

    const grossRent = payments.reduce((s, p) => s + money(p.amount), 0);

    // 5. Expenses (deductible based on agreement rules)
    const expenseCategories: string[] = [];
    if (agreement.deductMaintenanceCosts) expenseCategories.push("maintenance", "services", "supplies");
    if (agreement.deductUtilities)        expenseCategories.push("utilities");
    if (agreement.deductInsurance)        expenseCategories.push("insurance");

    const expenses = expenseCategories.length > 0
      ? await db
          .select({
            id:          propertyExpenses.id,
            description: propertyExpenses.description,
            amount:      propertyExpenses.amount,
            category:    propertyExpenses.category,
            vendorName:  propertyExpenses.vendorName,
            expenseDate: propertyExpenses.expenseDate,
          })
          .from(propertyExpenses)
          .where(and(
            eq(propertyExpenses.propertyId, propertyId),
            inArray(propertyExpenses.category, expenseCategories as any),
            inArray(propertyExpenses.status, ["approved", "paid"]),
            gte(propertyExpenses.expenseDate, periodStart),
            lte(propertyExpenses.expenseDate, periodEnd),
          ))
      : [];

    const maintenanceCosts = expenses
      .filter(e => ["maintenance", "services", "supplies"].includes(e.category ?? ""))
      .reduce((s, e) => s + money(e.amount), 0);
    const utilityCosts  = expenses
      .filter(e => e.category === "utilities")
      .reduce((s, e) => s + money(e.amount), 0);
    const insuranceCosts = expenses
      .filter(e => e.category === "insurance")
      .reduce((s, e) => s + money(e.amount), 0);

    // 6. PM fee
    const pmFee = computePmFee(agreement, grossRent, occupiedUnits);

    // 7. Totals
    const totalIncome      = grossRent;
    const totalDeductions  = pmFee + maintenanceCosts + utilityCosts + insuranceCosts;
    const netPayable       = Math.max(0, totalIncome - totalDeductions);

    // Build snapshot JSON
    const paymentDetails = payments.map(p => {
      const t = propTenants.find(t => t.id === p.tenantId);
      return {
        tenantName:    t ? `${t.firstName} ${t.lastName}` : `Tenant #${p.tenantId}`,
        unitNumber:    t?.unitNumber ?? "—",
        amount:        Number(p.amount),
        method:        p.paymentMethod ?? "—",
        date:          p.paidDate,
        monthlyRent:   Number(t?.monthlyRent ?? 0),
      };
    });

    const expenseDetails = expenses.map(e => ({
      vendor:      e.vendorName,
      description: e.description,
      amount:      Number(e.amount),
      category:    e.category,
      date:        e.expenseDate,
    }));

    const lineItems = [
      { type: "income",    description: "Gross rent collected",   amount: grossRent },
      { type: "deduction", description: `PM fee (${agreement.feeType === "percentage" ? Number(agreement.feeRate)+"%" : "KES "+Number(agreement.feeRate)})`, amount: -pmFee },
      ...(maintenanceCosts > 0 ? [{ type: "deduction", description: "Maintenance & repairs", amount: -maintenanceCosts }] : []),
      ...(utilityCosts > 0     ? [{ type: "deduction", description: "Utilities",             amount: -utilityCosts     }] : []),
      ...(insuranceCosts > 0   ? [{ type: "deduction", description: "Insurance",             amount: -insuranceCosts   }] : []),
      { type: "net",       description: "Net payable to owner",   amount: netPayable },
    ];

    // 8. Upsert (idempotent)
    const [existing] = await db
      .select({ id: ownerStatements.id, status: ownerStatements.status })
      .from(ownerStatements)
      .where(and(
        eq(ownerStatements.propertyId, propertyId),
        eq(ownerStatements.periodYear,  year),
        eq(ownerStatements.periodMonth, month),
      ))
      .limit(1);

    if (existing) {
      if (["sent", "paid"].includes(existing.status ?? "")) {
        return res.status(409).json({
          message: `Statement ${existing.status} — cannot re-generate. Create a correction note instead.`,
        });
      }
      const [updated] = await db
        .update(ownerStatements)
        .set({
          grossRent:        String(grossRent),
          totalIncome:      String(totalIncome),
          pmFee:            String(pmFee),
          maintenanceCosts: String(maintenanceCosts),
          utilityCosts:     String(utilityCosts),
          insuranceCosts:   String(insuranceCosts),
          otherDeductions:  "0",
          totalDeductions:  String(totalDeductions),
          netPayable:       String(netPayable),
          lineItems,
          paymentDetails,
          expenseDetails,
          status:           "draft",
          updatedAt:        new Date(),
          generatedBy:      req.user.id,
        })
        .where(eq(ownerStatements.id, existing.id))
        .returning();
      return res.json(updated);
    }

    const statementNumber = await nextStatementNumber();
    const [created] = await db.insert(ownerStatements).values({
      organizationId:   orgId,
      pmAgreementId:    agreement.id,
      propertyId,
      ownerUserId:      agreement.ownerUserId,
      statementNumber,
      periodMonth:      month,
      periodYear:       year,
      grossRent:        String(grossRent),
      otherIncome:      "0",
      totalIncome:      String(totalIncome),
      pmFee:            String(pmFee),
      maintenanceCosts: String(maintenanceCosts),
      utilityCosts:     String(utilityCosts),
      insuranceCosts:   String(insuranceCosts),
      otherDeductions:  "0",
      totalDeductions:  String(totalDeductions),
      netPayable:       String(netPayable),
      currency:         "KES",
      status:           "draft",
      lineItems,
      paymentDetails,
      expenseDetails,
      generatedBy:      req.user.id,
    } as any).returning();

    res.status(201).json(created);
  } catch (err: any) {
    console.error("owner-statement generate error:", err);
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/owner-statements/:id/approve
router.patch("/:id/approve", ...auth, async (req: any, res: any) => {
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only admins and managers can approve statements." });
  }
  try {
    const [updated] = await db
      .update(ownerStatements)
      .set({ status: "approved", approvedBy: req.user.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(ownerStatements.id, parseInt(req.params.id)),
        eq(ownerStatements.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Statement not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// PATCH /api/owner-statements/:id/mark-disbursed
router.patch("/:id/mark-disbursed", ...auth, async (req: any, res: any) => {
  if (!["admin", "manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Only admins and managers can mark statements as disbursed." });
  }
  try {
    const { disbursementRef } = req.body;
    const [updated] = await db
      .update(ownerStatements)
      .set({
        status:          "paid",
        disbursedAt:     new Date(),
        disbursementRef: disbursementRef ?? null,
        updatedAt:       new Date(),
      })
      .where(and(
        eq(ownerStatements.id, parseInt(req.params.id)),
        eq(ownerStatements.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Statement not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RENT ROLL
// GET /api/owner-statements/rent-roll
// Returns every unit across all org properties with tenant, lease, and payment data.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/rent-roll", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const asOfMonth  = (req.query.month as string) || format(new Date(), "yyyy-MM");
    const [yr, mo]   = asOfMonth.split("-").map(Number);
    const periodStart = startOfMonth(new Date(yr, mo - 1, 1));
    const periodEnd   = endOfMonth(new Date(yr, mo - 1, 1));

    // All units in org (optionally filtered by property)
    const allUnits = await db
      .select({
        unitId:       units.id,
        unitNumber:   units.unitNumber,
        monthlyRent:  units.monthlyRent,
        currency:     units.currency,
        isOccupied:   units.isOccupied,
        propertyId:   properties.id,
        propertyName: properties.name,
        ownerId:      properties.ownerId,
      })
      .from(units)
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(units.organizationId, orgId),
        ...(propertyId ? [eq(units.propertyId, propertyId)] : []),
        // Landlords only see their own properties
        ...(req.user.role === "landlord" ? [eq(properties.ownerId, req.user.id as string)] : []),
      ))
      .orderBy(asc(properties.name), asc(units.unitNumber));

    const unitIds = allUnits.map(u => u.unitId);

    // Active tenants
    const activeTenants = unitIds.length > 0
      ? await db
          .select({
            id:             tenants.id,
            firstName:      tenants.firstName,
            lastName:       tenants.lastName,
            email:          tenants.email,
            phone:          tenants.phone,
            unitId:         tenants.unitId,
            monthlyRent:    tenants.monthlyRent,
            leaseStartDate: tenants.leaseStartDate,
            leaseEndDate:   tenants.leaseEndDate,
            securityDeposit:tenants.securityDeposit,
            status:         tenants.status,
          })
          .from(tenants)
          .where(and(
            inArray(tenants.unitId, unitIds),
            eq(tenants.status, "active"),
          ))
      : [];

    // Payments this month
    const tenantIds = activeTenants.map(t => t.id);
    const monthPayments = tenantIds.length > 0
      ? await db
          .select({
            tenantId:      rentPayments.tenantId,
            amount:        rentPayments.amount,
            status:        rentPayments.status,
            paidDate:      rentPayments.paidDate,
            paymentMethod: rentPayments.paymentMethod,
          })
          .from(rentPayments)
          .where(and(
            inArray(rentPayments.tenantId, tenantIds),
            gte(rentPayments.dueDate, format(periodStart, "yyyy-MM-dd")),
            lte(rentPayments.dueDate, format(periodEnd,   "yyyy-MM-dd")),
          ))
      : [];

    const tenantMap  = Object.fromEntries(activeTenants.map(t => [t.unitId, t]));
    const paymentMap = Object.fromEntries(monthPayments.map(p => [p.tenantId, p]));

    const rentRoll = allUnits.map(u => {
      const tenant  = tenantMap[u.unitId]  ?? null;
      const payment = tenant ? (paymentMap[tenant.id] ?? null) : null;
      const rent    = Number(tenant?.monthlyRent ?? u.monthlyRent ?? 0);
      const paid    = payment && ["paid", "completed"].includes(payment.status ?? "");

      return {
        propertyId:     u.propertyId,
        propertyName:   u.propertyName,
        unitId:         u.unitId,
        unitNumber:     u.unitNumber,
        isOccupied:     u.isOccupied,
        monthlyRent:    rent,
        currency:       u.currency,
        // Tenant
        tenantId:       tenant?.id ?? null,
        tenantName:     tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
        tenantEmail:    tenant?.email ?? null,
        tenantPhone:    tenant?.phone ?? null,
        leaseStart:     tenant?.leaseStartDate ?? null,
        leaseEnd:       tenant?.leaseEndDate   ?? null,
        depositHeld:    Number(tenant?.securityDeposit ?? 0),
        // Payment this month
        paymentStatus:  paid ? "paid" : u.isOccupied ? "unpaid" : "vacant",
        amountPaid:     paid ? Number(payment?.amount ?? 0) : 0,
        paidDate:       payment?.paidDate ?? null,
        paymentMethod:  payment?.paymentMethod ?? null,
        arrearsAmount:  paid ? 0 : u.isOccupied ? rent : 0,
      };
    });

    const summary = {
      totalUnits:      rentRoll.length,
      occupiedUnits:   rentRoll.filter(r => r.isOccupied).length,
      vacantUnits:     rentRoll.filter(r => !r.isOccupied).length,
      totalExpected:   rentRoll.filter(r => r.isOccupied).reduce((s, r) => s + r.monthlyRent, 0),
      totalCollected:  rentRoll.reduce((s, r) => s + r.amountPaid, 0),
      totalArrears:    rentRoll.reduce((s, r) => s + r.arrearsAmount, 0),
      paidCount:       rentRoll.filter(r => r.paymentStatus === "paid").length,
      unpaidCount:     rentRoll.filter(r => r.paymentStatus === "unpaid").length,
    };

    res.json({ month: asOfMonth, summary, rentRoll });
  } catch (err: any) {
    console.error("rent-roll error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MANAGEMENT PACK
// GET /api/owner-statements/management-pack/:propertyId/:year/:month
// Returns all data needed to render a printable management pack for a landlord.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/management-pack/:propertyId/:year/:month", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = parseInt(req.params.propertyId);
    const year       = parseInt(req.params.year);
    const month      = parseInt(req.params.month);

    const periodStart = startOfMonth(new Date(year, month - 1, 1));
    const periodEnd   = endOfMonth(new Date(year, month - 1, 1));
    const monthLabel  = format(periodStart, "MMMM yyyy");

    // Property
    const [prop] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);
    if (!prop) return res.status(404).json({ message: "Property not found" });

    // Owner statement (if generated)
    const [statement] = await db
      .select()
      .from(ownerStatements)
      .where(and(
        eq(ownerStatements.propertyId, propertyId),
        eq(ownerStatements.periodYear,  year),
        eq(ownerStatements.periodMonth, month),
      ))
      .limit(1);

    // Rent roll for this property this month
    const rentRollReq = await fetch(
      `http://localhost:${process.env.PORT || 5000}/api/owner-statements/rent-roll?propertyId=${propertyId}&month=${year}-${String(month).padStart(2,"0")}`,
      { headers: { Authorization: `Bearer ${req.headers.authorization?.split(" ")[1]}` } }
    );
    const rentRollData = rentRollReq.ok ? await rentRollReq.json() : { summary: {}, rentRoll: [] };

    // Maintenance summary
    const { maintenanceRequests } = await import("@shared/schema");
    const { lte: lteF, gte: gteF } = await import("drizzle-orm");
    // Get unit IDs for this property
    const propUnits = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.propertyId, propertyId));
    const propUnitIds = propUnits.map(u => u.id);

    const maintenanceSummary = propUnitIds.length > 0
      ? await db
          .select({
            id:       maintenanceRequests.id,
            title:    maintenanceRequests.title,
            status:   maintenanceRequests.status,
            priority: maintenanceRequests.priority,
            actualCost: maintenanceRequests.actualCost,
            createdAt: maintenanceRequests.createdAt,
            completedAt: maintenanceRequests.completedAt,
          })
          .from(maintenanceRequests)
          .where(and(
            inArray(maintenanceRequests.unitId, propUnitIds),
            gte(maintenanceRequests.createdAt, periodStart),
            lte(maintenanceRequests.createdAt, periodEnd),
          ))
      : [];

    // Expenses
    const expenses = await db
      .select()
      .from(propertyExpenses)
      .where(and(
        eq(propertyExpenses.propertyId, propertyId),
        gte(propertyExpenses.expenseDate, periodStart),
        lte(propertyExpenses.expenseDate, periodEnd),
      ));

    res.json({
      property:    prop,
      period:      { year, month, label: monthLabel },
      statement:   statement ?? null,
      rentRoll:    rentRollData,
      maintenance: {
        total:     maintenanceSummary.length,
        completed: maintenanceSummary.filter(m => m.status === "completed").length,
        open:      maintenanceSummary.filter(m => !["completed", "cancelled"].includes(m.status ?? "")).length,
        totalCost: maintenanceSummary.reduce((s, m) => s + Number(m.actualCost ?? 0), 0),
        requests:  maintenanceSummary,
      },
      expenses: {
        total:    expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0),
        items:    expenses,
      },
    });
  } catch (err: any) {
    console.error("management-pack error:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;