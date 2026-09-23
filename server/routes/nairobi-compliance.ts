/**
 * nairobi-compliance.ts — mounted at /api/compliance
 *
 * Five modules for the Nairobi mid-to-high-end rental market:
 *
 *  1. Service Charge Accounting (ARMA)
 *     GET  /api/compliance/service-charges/budget/:propertyId/:year
 *     POST /api/compliance/service-charges/budget
 *     POST /api/compliance/service-charges/budget/:id/approve
 *     GET  /api/compliance/service-charges/demands/:propertyId
 *     POST /api/compliance/service-charges/demands/generate   ← bulk generate for a period
 *     PATCH /api/compliance/service-charges/demands/:id
 *     GET  /api/compliance/sinking-fund/:propertyId
 *     POST /api/compliance/sinking-fund
 *
 *  2. KRA Compliance
 *     GET  /api/compliance/kra/profile/:userId
 *     PUT  /api/compliance/kra/profile/:userId
 *     GET  /api/compliance/kra/returns/:userId?year=&month=
 *     POST /api/compliance/kra/returns/generate   ← auto-compute from rent payments
 *     PATCH /api/compliance/kra/returns/:id       ← mark as filed, add ack ref
 *
 *  3. Stamp Duty (on the leases table)
 *     GET  /api/compliance/stamp-duty              ← leases needing stamp duty
 *     PATCH /api/compliance/stamp-duty/:leaseId    ← update stamp duty status
 *
 *  4. Property Valuation History
 *     GET  /api/compliance/valuations/:propertyId
 *     POST /api/compliance/valuations
 *     GET  /api/compliance/valuations/:propertyId/cgt  ← CGT calculation
 *
 *  5. Security Deposit Interest
 *     GET  /api/compliance/deposit-interest/:leaseId
 *     POST /api/compliance/deposit-interest/accrue     ← compute for a lease up to today
 *     PATCH /api/compliance/deposit-interest/:id/settle
 *     GET  /api/compliance/cbk-rates
 *     POST /api/compliance/cbk-rates
 */

import { Router } from "express";
import { db } from "../db";
import {
  serviceChargeBudgets, sinkingFundTransactions, serviceChargeDemands,
  landlordKraProfiles, kraRentalReturns,
  propertyValuations,
  cbkRateHistory, depositInterestAccruals, depositTransactions,
  leases, tenants, units, rentPayments, properties,
  insertServiceChargeBudgetSchema, insertSinkingFundTxSchema,
  insertServiceChargeDemandSchema, insertLandlordKraProfileSchema,
  insertKraRentalReturnSchema, insertPropertyValuationSchema,
  insertCbkRateSchema, insertDepositInterestAccrualSchema,
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, sql, sum } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Get the CBK rate in effect on a given date */
async function getCbkRateOnDate(date: Date): Promise<number> {
  const dateStr = date.toISOString().slice(0, 10);
  const [row] = await db
    .select({ rate: cbkRateHistory.rate })
    .from(cbkRateHistory)
    .where(lte(cbkRateHistory.effectiveDate, dateStr))
    .orderBy(desc(cbkRateHistory.effectiveDate))
    .limit(1);
  return row ? Number(row.rate) : 13.0; // fallback: CBK rate as of May 2025 is 13%.
  // Always add the actual CBK MPC rate in the CBK Rates section to ensure accuracy.
  // Check current rate at: https://www.centralbank.go.ke/monetary-policy/
}

/** Generate next sequential code for a table */
async function nextCode(prefix: string, table: any, col: any): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ max: sql<string>`MAX(${col})` })
    .from(table);
  const maxStr = row?.max ?? "";
  const lastNum = parseInt(maxStr.split("-").pop() ?? "0") || 0;
  return `${prefix}-${year}-${String(lastNum + 1).padStart(3, "0")}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. SERVICE CHARGE ACCOUNTING (ARMA)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/compliance/service-charges/budget/:propertyId/:year
router.get("/service-charges/budget/:propertyId/:year", ...auth, async (req: any, res: any) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    const year       = parseInt(req.params.year);
    const [budget]   = await db
      .select()
      .from(serviceChargeBudgets)
      .where(and(eq(serviceChargeBudgets.propertyId, propertyId), eq(serviceChargeBudgets.financialYear, year)))
      .limit(1);
    res.json(budget ?? null);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/compliance/service-charges/budget
router.post("/service-charges/budget", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const data  = insertServiceChargeBudgetSchema.parse({ ...req.body, organizationId: orgId });
    const [created] = await db.insert(serviceChargeBudgets).values(data as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// POST /api/compliance/service-charges/budget/:id/approve
router.post("/service-charges/budget/:id/approve", ...auth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(serviceChargeBudgets)
      .set({ status: "approved", approvedBy: req.user.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(serviceChargeBudgets.id, parseInt(req.params.id)))
      .returning();
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// GET /api/compliance/service-charges/demands/:propertyId
router.get("/service-charges/demands/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const rows = await db
      .select()
      .from(serviceChargeDemands)
      .where(eq(serviceChargeDemands.propertyId, parseInt(req.params.propertyId)))
      .orderBy(desc(serviceChargeDemands.periodStart));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

/**
 * POST /api/compliance/service-charges/demands/generate
 * Body: { propertyId, periodStart, periodEnd, fixedAmount, variableAmount,
 *         sinkingFundAmount, dueDate }
 * Generates one demand notice per occupied unit.
 */
router.post("/service-charges/demands/generate", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { propertyId, periodStart, periodEnd, fixedAmount, variableAmount,
            sinkingFundAmount, dueDate } = req.body;

    // Allocation method: explicit override in the request body wins; otherwise
    // look up the budget covering this period's financial year (defaults to
    // "equal_split" if there's no matching budget, preserving old behaviour).
    let allocationMethod: "equal_split" | "pro_rata_sqft" = req.body.allocationMethod;
    if (!allocationMethod) {
      const year = new Date(periodStart).getFullYear();
      const [budget] = await db
        .select({ allocationMethod: serviceChargeBudgets.allocationMethod })
        .from(serviceChargeBudgets)
        .where(and(eq(serviceChargeBudgets.propertyId, propertyId), eq(serviceChargeBudgets.financialYear, year)))
        .limit(1);
      allocationMethod = (budget?.allocationMethod as any) ?? "equal_split";
    }

    // Get all occupied units with their current tenants (and sqft, for pro-rata)
    const occupiedUnits = await db
      .select({ unitId: units.id, tenantId: tenants.id, sqft: units.sqft })
      .from(units)
      .leftJoin(tenants, and(eq(tenants.unitId, units.id), eq(tenants.status, "active")))
      .where(and(eq(units.propertyId, propertyId), eq(units.isOccupied, true)));

    // pro_rata_sqft needs every occupied unit's sqft set — fall back to
    // equal_split for this run (rather than silently mis-billing) if any are missing.
    const totalSqft = occupiedUnits.reduce((sum, u) => sum + (u.sqft ?? 0), 0);
    const usePropRata = allocationMethod === "pro_rata_sqft" &&
      totalSqft > 0 && occupiedUnits.every(u => (u.sqft ?? 0) > 0);
    if (allocationMethod === "pro_rata_sqft" && !usePropRata) {
      return res.status(400).json({
        message: "Cannot generate pro-rata-by-sqft demands: one or more occupied units on this property has no sqft set. Set sqft on every occupied unit, or generate with allocationMethod \"equal_split\" instead.",
      });
    }

    const created: any[] = [];
    for (const ou of occupiedUnits) {
      const demandNumber = await nextCode("SCN", serviceChargeDemands, serviceChargeDemands.demandNumber);

      // equal_split (default/legacy, unchanged from before): fixedAmount/
      // variableAmount/sinkingFundAmount are PER-UNIT amounts — every occupied
      // unit is billed exactly what was entered, same as the original behaviour.
      // pro_rata_sqft: the entered amounts are the TOTAL pool for the property
      // for this period, and each unit's share is its sqft ÷ total occupied sqft.
      const shareOfPool = usePropRata ? (ou.sqft as number) / totalSqft : null;
      const unitFixed       = usePropRata ? Number(fixedAmount ?? 0)       * (shareOfPool as number) : Number(fixedAmount ?? 0);
      const unitVariable    = usePropRata ? Number(variableAmount ?? 0)    * (shareOfPool as number) : Number(variableAmount ?? 0);
      const unitSinkingFund = usePropRata ? Number(sinkingFundAmount ?? 0) * (shareOfPool as number) : Number(sinkingFundAmount ?? 0);
      const unitTotal       = unitFixed + unitVariable + unitSinkingFund;

      const [demand] = await db.insert(serviceChargeDemands).values({
        organizationId:    orgId,
        propertyId,
        unitId:            ou.unitId,
        tenantId:          ou.tenantId,
        demandNumber,
        periodStart,
        periodEnd,
        allocationMethod:  usePropRata ? "pro_rata_sqft" : "equal_split",
        allocatedSqft:      usePropRata ? (ou.sqft as number) : null,
        totalSqft:          usePropRata ? totalSqft : null,
        fixedAmount:       unitFixed.toFixed(2),
        variableAmount:    unitVariable.toFixed(2),
        sinkingFundAmount: unitSinkingFund.toFixed(2),
        totalAmount:       unitTotal.toFixed(2),
        dueDate,
        status:            "pending",
      } as any).returning();
      created.push(demand);
    }

    res.status(201).json({ generated: created.length, allocationMethod: usePropRata ? "pro_rata_sqft" : "equal_split", demands: created });
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// PATCH /api/compliance/service-charges/demands/:id
router.patch("/service-charges/demands/:id", ...auth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(serviceChargeDemands)
      .set(req.body)
      .where(eq(serviceChargeDemands.id, parseInt(req.params.id)))
      .returning();
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// GET /api/compliance/sinking-fund/:propertyId
router.get("/sinking-fund/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const rows = await db
      .select()
      .from(sinkingFundTransactions)
      .where(eq(sinkingFundTransactions.propertyId, parseInt(req.params.propertyId)))
      .orderBy(desc(sinkingFundTransactions.transactionDate));
    const balance = rows[0] ? Number(rows[0].balanceAfter) : 0;
    res.json({ balance, transactions: rows });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/compliance/sinking-fund
router.post("/sinking-fund", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { propertyId, transactionDate, transactionType, amount, description, reference } = req.body;

    // Get current balance
    const [last] = await db
      .select({ bal: sinkingFundTransactions.balanceAfter })
      .from(sinkingFundTransactions)
      .where(eq(sinkingFundTransactions.propertyId, propertyId))
      .orderBy(desc(sinkingFundTransactions.transactionDate))
      .limit(1);

    const currentBalance = last ? Number(last.bal) : 0;
    const delta = transactionType === "expenditure" ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
    const balanceAfter = currentBalance + delta;

    const [created] = await db.insert(sinkingFundTransactions).values({
      organizationId: orgId,
      propertyId,
      transactionDate,
      transactionType,
      amount: String(Math.abs(Number(amount))),
      balanceAfter:   String(balanceAfter),
      description,
      reference: reference ?? null,
      approvedBy: req.user.id,
    } as any).returning();

    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. KRA COMPLIANCE
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/compliance/kra/profile/:userId
router.get("/kra/profile/:userId", ...auth, async (req: any, res: any) => {
  try {
    const [profile] = await db
      .select()
      .from(landlordKraProfiles)
      .where(eq(landlordKraProfiles.userId, req.params.userId))
      .limit(1);
    res.json(profile ?? null);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// PUT /api/compliance/kra/profile/:userId  (upsert)
router.put("/kra/profile/:userId", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const userId = req.params.userId;
    const data   = { ...req.body, organizationId: orgId, userId, updatedAt: new Date() };

    const [existing] = await db
      .select({ id: landlordKraProfiles.id })
      .from(landlordKraProfiles)
      .where(eq(landlordKraProfiles.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db.update(landlordKraProfiles).set(data).where(eq(landlordKraProfiles.userId, userId)).returning();
      res.json(updated);
    } else {
      const parsed = insertLandlordKraProfileSchema.parse(data);
      const [created] = await db.insert(landlordKraProfiles).values(parsed as any).returning();
      res.status(201).json(created);
    }
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// GET /api/compliance/kra/returns/:userId?year=&month=
router.get("/kra/returns/:userId", ...auth, async (req: any, res: any) => {
  try {
    const userId = req.params.userId;
    let query = db.select().from(kraRentalReturns).where(eq(kraRentalReturns.landlordUserId, userId)) as any;
    const rows = await query.orderBy(desc(kraRentalReturns.returnYear), desc(kraRentalReturns.returnMonth));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

/**
 * POST /api/compliance/kra/returns/generate
 * Body: { landlordUserId, propertyId, year, month }
 *
 * Auto-computes gross rent from rent_payments for the period,
 * looks up KRA profile for WHT rate, calculates WHT and VAT.
 */
router.post("/kra/returns/generate", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { landlordUserId, propertyId, year, month } = req.body;

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 0, 23, 59, 59);

    // Sum paid rent payments for this property in the period.
    // rentPayments has no organizationId/propertyId/paymentDate columns — join
    // through tenants → units to filter by property and organisation, and use
    // paidDate (the actual column name in the schema).
    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr   = periodEnd.toISOString().slice(0, 10);

    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .innerJoin(units,   eq(tenants.unitId, units.id))
      .where(and(
        eq(tenants.organizationId, orgId),
        eq(units.propertyId, propertyId),
        eq(rentPayments.status, "paid"),
        gte(rentPayments.paidDate, periodStartStr),
        lte(rentPayments.paidDate, periodEndStr),
      ));

    const grossRent = Number(result?.total ?? 0);

    // Get KRA profile for rates
    const [kra] = await db
      .select()
      .from(landlordKraProfiles)
      .where(eq(landlordKraProfiles.userId, landlordUserId))
      .limit(1);

    const whtRate      = Number(kra?.whtRate ?? 10);
    const vatApplicable = kra?.isVatRegistered ?? false;
    const vatAmount    = vatApplicable ? grossRent * 0.16 : 0;
    const whtAmount    = grossRent * (whtRate / 100);

    // Income Tax Act Cap 470 s.15:
    // WHT is deducted AT SOURCE by the tenant/payer before remitting rent.
    // The landlord therefore receives (grossRent - WHT) as net rent.
    // Allowable deductions (mortgage interest, repairs, commissions, insurance)
    // are then claimed against gross rent to reduce the taxable rental income.
    //
    // Net taxable income = Gross Rent - Allowable Deductions
    // WHT is shown as a separate credit (already withheld by payer, not deducted again).
    // Tax payable = (netIncome × applicable rate) - WHT credit
    //
    // We store netIncome = grossRent - deductions (the taxable base).
    // The WHT amount is stored separately as the credit already withheld.
    const deductions   = Number(req.body.allowableDeductions ?? 0);
    const netIncome    = Math.max(0, grossRent - deductions);

    // Upsert the return
    const existing = await db
      .select({ id: kraRentalReturns.id })
      .from(kraRentalReturns)
      .where(and(
        eq(kraRentalReturns.landlordUserId, landlordUserId),
        eq(kraRentalReturns.propertyId, propertyId),
        eq(kraRentalReturns.returnYear, year),
        eq(kraRentalReturns.returnMonth, month),
      ))
      .limit(1);

    // Warn if gross rent is below the KES 24,000/month monthly filing threshold
    const belowThreshold = grossRent < 24_000;

    const payload = {
      organizationId:     orgId,
      landlordUserId,
      propertyId:         propertyId ?? null,
      returnYear:         year,
      returnMonth:        month,
      grossRent:          String(grossRent),
      vatApplicable,
      vatAmount:          String(vatAmount),
      whtRate:            String(whtRate),
      whtAmount:          String(whtAmount),
      allowableDeductions:String(deductions),
      netIncome:          String(netIncome),
      status:             "draft",
      updatedAt:          new Date(),
    };

    let ret;
    if (existing.length > 0) {
      const [updated] = await db.update(kraRentalReturns).set(payload).where(eq(kraRentalReturns.id, existing[0].id)).returning();
      ret = updated;
    } else {
      const [created] = await db.insert(kraRentalReturns).values(payload as any).returning();
      ret = created;
    }

    res.json({ ...ret, belowThreshold, ...(belowThreshold ? { warning: "Gross rent KES " + grossRent.toLocaleString("en-KE") + " is below the KES 24,000/month threshold for mandatory monthly KRA rental income returns (Income Tax Act Cap 470). Filing is still possible but may not be required." } : {}) });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// PATCH /api/compliance/kra/returns/:id  (mark filed, add ack ref)
router.patch("/kra/returns/:id", ...auth, async (req: any, res: any) => {
  try {
    const patch: any = { ...req.body, updatedAt: new Date() };
    if (req.body.status === "filed" && !req.body.filedAt) patch.filedAt = new Date();
    const [updated] = await db.update(kraRentalReturns).set(patch).where(eq(kraRentalReturns.id, parseInt(req.params.id))).returning();
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. STAMP DUTY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/compliance/stamp-duty
 * Returns leases that are > 3 years and therefore require stamp duty,
 * with their current stamp duty status.
 */
router.get("/stamp-duty", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;

    // Stamp Duty Act Cap 480, Schedule:
    //   Residential leases > 36 months (3 years): 1% of total rent payable
    //   Commercial leases  > 24 months (2 years): 1% of total rent payable
    // A lease is treated as commercial if isCommercial = true on the lease record.
    const rows = await db
      .select()
      .from(leases)
      .where(and(
        eq(leases.organizationId, orgId),
        // isCommercial added via ALTER TABLE — not in Drizzle schema, use raw SQL
        sql`(
          (leases.is_commercial IS NOT TRUE AND ${leases.leaseDurationMonths} > 36)
          OR
          (leases.is_commercial = TRUE AND ${leases.leaseDurationMonths} > 24)
        )`,
      ))
      .orderBy(desc(leases.createdAt));

    // Annotate with computed stamp duty — 1% of total rent payable (Cap 480)
    const enriched = rows.map(l => {
      const totalRent = Number(l.monthlyRent) * Number(l.leaseDurationMonths);
      const computedStampDuty = totalRent * 0.01;
      const threshold = (l as any).isCommercial ? 24 : 36;
      return {
        ...l,
        stampDutyRequired: true,
        computedStampDuty,
        stampDutyThresholdMonths: threshold,
        stampDutyStatus: (l as any).stampDutyPaid ? "paid" : "pending",
      };
    });

    res.json(enriched);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// PATCH /api/compliance/stamp-duty/:leaseId
router.patch("/stamp-duty/:leaseId", ...auth, async (req: any, res: any) => {
  try {
    const allowed = ["stampDutyAmount", "stampDutyPaid", "stampDutyPaidDate",
                     "stampDutyKraRef", "stampDutyAssessmentUrl", "stampDutyReceiptUrl",
                     "stampDutyRequired"];
    const patch: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    patch.updatedAt = new Date();

    const [updated] = await db
      .update(leases)
      .set(patch)
      .where(eq(leases.id, parseInt(req.params.leaseId)))
      .returning();
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PROPERTY VALUATION HISTORY
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/compliance/valuations/:propertyId
router.get("/valuations/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const rows = await db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, parseInt(req.params.propertyId)))
      .orderBy(desc(propertyValuations.valuationDate));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/compliance/valuations
router.post("/valuations", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const data  = insertPropertyValuationSchema.parse({
      ...req.body,
      organizationId: orgId,
      createdBy: req.user.id,
    });
    const [created] = await db.insert(propertyValuations).values(data as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// GET /api/compliance/valuations/:propertyId/cgt
// Computes capital gains tax between acquisition and latest disposal
router.get("/valuations/:propertyId/cgt", ...auth, async (req: any, res: any) => {
  try {
    const propertyId = parseInt(req.params.propertyId);
    const rows = await db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, propertyId))
      .orderBy(asc(propertyValuations.valuationDate));

    const acquisitions = rows.filter((r: any) => r.isAcquisition);
    const disposals    = rows.filter((r: any) => r.isDisposal);

    if (!acquisitions.length) {
      return res.json({ message: "No acquisition valuation recorded", cgt: null });
    }

    const acquisition  = acquisitions[acquisitions.length - 1]; // most recent acquisition
    const disposal     = disposals[disposals.length - 1] ?? null;
    const improvements = rows.reduce((s, r) => s + Number((r as any).improvementCosts ?? 0), 0);
    const costBase     = Number(acquisition.marketValue) + improvements;

    if (!disposal) {
      return res.json({
        costBase,
        acquisitionDate: acquisition.valuationDate,
        improvements,
        disposal: null,
        cgt: null,
        note: "No disposal recorded yet. CGT will be computed when a disposal valuation is added.",
      });
    }

    const proceedsValue = Number(disposal.marketValue);
    const gain          = proceedsValue - costBase;
    // Finance Act 2023: CGT raised from 5% → 15% effective 1 January 2023.
    // Any disposal on or after 1 January 2023 uses 15%.
    // Pre-2023 (i.e., disposal date in 2022 or earlier) uses 5%.
    const disposalYear   = new Date(disposal.valuationDate).getFullYear();
    const isPost2023     = disposalYear >= 2023;
    const defaultCgtRate = isPost2023 ? 15 : 5;
    const cgtRate       = Number(disposal.cgtRate ?? defaultCgtRate) / 100;
    const cgtLiability  = gain > 0 ? gain * cgtRate : 0;

    res.json({
      propertyId,
      costBase,
      acquisitionDate: acquisition.valuationDate,
      acquisitionValue: Number(acquisition.marketValue),
      improvements,
      disposalDate: disposal.valuationDate,
      disposalValue: proceedsValue,
      gain,
      cgtRate: Number(disposal.cgtRate ?? defaultCgtRate),
      cgtLiability,
      note: gain <= 0 ? "No CGT liability — no capital gain." : `KES ${cgtLiability.toLocaleString("en-KE")} CGT payable to KRA.`,
    });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. SECURITY DEPOSIT INTEREST
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/compliance/cbk-rates
router.get("/cbk-rates", ...auth, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(cbkRateHistory).orderBy(desc(cbkRateHistory.effectiveDate));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/compliance/cbk-rates  (add new MPC decision)
router.post("/cbk-rates", ...auth, async (req: any, res: any) => {
  try {
    const data = insertCbkRateSchema.parse(req.body);
    const [created] = await db.insert(cbkRateHistory).values(data as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// GET /api/compliance/deposit-interest/:leaseId
router.get("/deposit-interest/:leaseId", ...auth, async (req: any, res: any) => {
  try {
    const leaseId = parseInt(req.params.leaseId);
    const rows    = await db
      .select()
      .from(depositInterestAccruals)
      .where(eq(depositInterestAccruals.leaseId, leaseId))
      .orderBy(desc(depositInterestAccruals.accrualDate));

    const totalAccrued    = rows.reduce((s, r) => s + Number(r.interestAmount), 0);
    const totalSettled    = rows.filter(r => r.isSettled).reduce((s, r) => s + Number(r.settledAmount ?? 0), 0);
    const totalOutstanding = totalAccrued - totalSettled;

    res.json({ totalAccrued, totalSettled, totalOutstanding, accruals: rows });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

/**
 * POST /api/compliance/deposit-interest/accrue
 * Body: { leaseId }
 *
 * Computes monthly interest accruals from the deposit_paid_date (or last
 * accrual) up to today, using the CBK rate in effect each period.
 * Simple interest: I = P × r × t (where t = days/365).
 */
router.post("/deposit-interest/accrue", ...auth, async (req: any, res: any) => {
  try {
    const orgId   = req.user.organizationId;
    const { leaseId } = req.body;

    const [lease] = await db
      .select()
      .from(leases)
      .where(eq(leases.id, leaseId))
      .limit(1);

    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const depositAmount = Number(lease.securityDeposit ?? 0);
    if (depositAmount <= 0) {
      return res.json({ message: "No security deposit on this lease.", created: 0 });
    }

    // Find the last accrual to continue from where we left off
    const [lastAccrual] = await db
      .select({ accrualDate: depositInterestAccruals.accrualDate, cumulative: depositInterestAccruals.cumulativeInterest })
      .from(depositInterestAccruals)
      .where(eq(depositInterestAccruals.leaseId, leaseId))
      .orderBy(desc(depositInterestAccruals.accrualDate))
      .limit(1);

    const startDate = lastAccrual
      ? new Date(lastAccrual.accrualDate)
      : (lease.depositPaidDate ? new Date(lease.depositPaidDate) : new Date(lease.startDate));

    startDate.setDate(startDate.getDate() + 1); // start from day after last accrual

    const today   = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate >= today) {
      return res.json({ message: "Interest is up to date.", created: 0 });
    }

    let cumulative = lastAccrual ? Number(lastAccrual.cumulative) : 0;
    const created: any[] = [];
    let cursor = new Date(startDate);

    while (cursor < today) {
      // Monthly accrual: last day of current month
      const periodStart = new Date(cursor);
      const periodEnd   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      if (periodEnd >= today) periodEnd.setTime(today.getTime() - 1);

      const days        = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
      const cbkRate     = await getCbkRateOnDate(periodStart);
      const interest    = depositAmount * (cbkRate / 100) * (days / 365);
      cumulative        += interest;

      const accrualDateStr = periodEnd.toISOString().slice(0, 10);

      const [row] = await db.insert(depositInterestAccruals).values({
        organizationId:    orgId,
        leaseId,
        tenantId:          lease.tenantId,
        accrualDate:       accrualDateStr,
        periodStart:       periodStart.toISOString().slice(0, 10),
        periodEnd:         accrualDateStr,
        depositBalance:    String(depositAmount),
        cbkRate:           String(cbkRate),
        daysInPeriod:      days,
        interestAmount:    String(Math.round(interest * 100) / 100),
        cumulativeInterest:String(Math.round(cumulative * 100) / 100),
        isSettled:         false,
      } as any).onConflictDoNothing().returning();

      if (row) created.push(row);

      // Advance to next month
      cursor = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 1);
    }

    res.json({ created: created.length, totalAccrued: Math.round(cumulative * 100) / 100, accruals: created });

    // Notify the tenant that their deposit interest has been updated (non-fatal, fire-and-forget)
    if (created.length > 0 && lease.tenantId) {
      const { notifyTenant } = await import("../services/notifyTenant");
      const periodStart = created[0]?.periodStart ?? "";
      const periodEnd   = created[created.length - 1]?.periodEnd ?? "";
      const periodLabel = periodStart && periodEnd ? `${periodStart} – ${periodEnd}` : "latest period";
      const interestThisBatch = created.reduce((s: number, r: any) => s + Number(r.interestAmount ?? 0), 0);

      notifyTenant(lease.tenantId, {
        type:       "deposit_interest_accrued",
        amount:     Math.round(interestThisBatch * 100) / 100,
        currency:   "KES",
        period:     periodLabel,
        cumulative: Math.round(cumulative * 100) / 100,
      }).catch(() => {});
    }
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// PATCH /api/compliance/deposit-interest/:id/settle
router.patch("/deposit-interest/:id/settle", ...auth, async (req: any, res: any) => {
  try {
    const { settledAmount, settlementRef, notes } = req.body;
    const [updated] = await db
      .update(depositInterestAccruals)
      .set({
        isSettled:    true,
        settledAt:    new Date().toISOString().slice(0, 10),
        settledAmount: String(settledAmount),
        settlementRef: settlementRef ?? null,
        notes:         notes ?? null,
      })
      .where(eq(depositInterestAccruals.id, parseInt(req.params.id)))
      .returning();
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ─── 6. Rent Restriction Tribunal (RRT) Notice Templates ─────────────────────
//   POST /api/compliance/rrt/rent-increase    — generate rent increase notice
//   POST /api/compliance/rrt/eviction-notice  — generate notice to vacate
//   GET  /api/compliance/rrt/notices/:leaseId — list RRT notices for a lease
import rrtRouter from "./rrt-notices";
router.use("/rrt", rrtRouter);

export default router;