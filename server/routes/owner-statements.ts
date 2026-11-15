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
 *     PATCH  /api/owner-statements/:id/send                 email the owner (approved → sent)
 *     PATCH  /api/owner-statements/:id/mark-disbursed       record actual payment to owner (approved/sent → paid)
 *     PATCH  /api/owner-statements/:id/undo-disbursed       admin: a payout recorded by mistake (paid → approved)
 *     DELETE /api/owner-statements/:id                      a draft that should not exist
 *
 *   Rent Roll (portfolio-wide snapshot):
 *     GET    /api/owner-statements/rent-roll               all properties × units × tenants
 *
 *   Management Pack (all-in-one monthly PDF data):
 *     GET    /api/owner-statements/management-pack/:propertyId/:year/:month
 */

import { Router }    from "express";
import { z }         from "zod";
import { db }        from "../db";
import {
  pmAgreements, ownerStatements,
  properties, units, tenants, rentPayments, propertyExpenses, maintenanceRequests,
  users, organizations,
} from "@shared/schema";
import {
  eq, and, gte, lte, desc, asc, sql, inArray,
} from "drizzle-orm";
import { maxSequenceSuffix, withNumberRetry, isUniqueViolation } from "../utils/sequenceNumber";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { auditLog }        from "../middleware/auditLog";
import { rentBalances, rentCashRows, todayEAT } from "../services/rent-ledger";
import { sendOwnerStatementEmail } from "../lib/email";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad   = (n: number) => String(n).padStart(2, "0");
const money = (n: any)    => Number(n ?? 0);
const r2    = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

/** What an owner (landlord login) may see: statements that staff have approved. Drafts are working papers. */
const OWNER_VISIBLE = ["approved", "sent", "paid"];

class StmtError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
function fail(res: any, err: any, fallback = "Something went wrong") {
  if (err instanceof StmtError) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err?.name === "ZodError") return res.status(400).json({ message: err.errors?.[0]?.message ?? "Invalid request", errors: err.errors });
  console.error("[owner-statements]", err);
  return res.status(500).json({ message: fallback });
}
const posInt = (v: any) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/**
 * Calendar month in Nairobi time. Expenses carry a timestamp: an expense dated the 1st at 00:30 EAT is 21:30 UTC the day
 * before, and the old server-local boundaries put it in the PREVIOUS month's statement.
 */
function eatMonth(year: number, month: number) {
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const start = new Date(`${year}-${pad(month)}-01T00:00:00+03:00`);
  const end   = new Date(new Date(`${next[0]}-${pad(next[1])}-01T00:00:00+03:00`).getTime() - 1);
  const last  = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end, from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** Next sequential statement number, e.g. OWS-2026-017 (numeric comparison — see utils/sequenceNumber.ts). */
async function nextStatementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await maxSequenceSuffix(ownerStatements, ownerStatements.statementNumber, `OWS-${year}`);
  return `OWS-${year}-${String(last + 1).padStart(3, "0")}`;
}

async function nextAgreementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await maxSequenceSuffix(pmAgreements, pmAgreements.agreementNumber, `PMA-${year}`);
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

const isStaff = (req: any) => ["admin", "manager"].includes(req.user.role);

// ══════════════════════════════════════════════════════════════════════════════
// PM AGREEMENTS
// ══════════════════════════════════════════════════════════════════════════════

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const ymd = z.preprocess(blank, z.string({ required_error: "Enter a date", invalid_type_error: "Enter a date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD").refine(d => {
  const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}, "That is not a real date"));
const optStr = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullish());

const agreementShape = {
  ownerUserId:         z.preprocess(blank, z.string().uuid("Owner is not valid").nullish()),
  feeType:             z.enum(["percentage", "fixed_monthly", "per_unit"]),
  feeRate:             z.coerce.number({ invalid_type_error: "Fee must be a number" }).min(0, "Fee cannot be negative").max(10_000_000),
  disbursementMethod:  z.preprocess(blank, z.enum(["mpesa", "bank", "cheque"]).nullish()),
  disbursementAccount: optStr(100),
  disbursementName:    optStr(100),
  startDate:           ymd,
  endDate:             z.preprocess(blank, ymd.nullish()),
  autoRenew:           z.boolean().optional(),
  noticePeriodDays:    z.coerce.number().int().min(0).max(365).optional(),
  deductMaintenanceCosts: z.boolean().optional(),
  deductUtilities:     z.boolean().optional(),
  deductInsurance:     z.boolean().optional(),
  maintenanceApprovalThreshold: z.coerce.number().min(0).optional(),
  status:              z.enum(["active", "suspended", "terminated"]).optional(),
  notes:               optStr(2000),
};

function checkAgreement(v: any, ctx: z.RefinementCtx) {
  if (v.feeType === "percentage" && v.feeRate != null && v.feeRate > 100) ctx.addIssue({ code: "custom", path: ["feeRate"], message: "A percentage fee cannot be more than 100%" });
  if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date is before the start date" });
  if (v.disbursementMethod === "mpesa" && v.disbursementAccount && !/^\+?\d{9,15}$/.test(String(v.disbursementAccount).replace(/[\s-]/g, ""))) {
    ctx.addIssue({ code: "custom", path: ["disbursementAccount"], message: "An M-Pesa account must be a phone number" });
  }
  if (v.disbursementMethod === "bank" && v.disbursementAccount && String(v.disbursementAccount).trim().length < 5) {
    ctx.addIssue({ code: "custom", path: ["disbursementAccount"], message: "That bank account number looks too short" });
  }
}
const createAgreementSchema = z.object({ propertyId: z.coerce.number().int().positive("Pick a property"), ...agreementShape }).superRefine(checkAgreement);
const patchAgreementSchema  = z.object(agreementShape).partial().superRefine(checkAgreement);

/** The owner of an agreement must be a landlord of THIS organization (a user id from another org must never be attached). */
async function assertOwner(orgId: number, ownerUserId: string) {
  const [u] = await db.select({ id: users.id, role: users.role }).from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.organizationId, orgId))).limit(1);
  if (!u) throw new StmtError(400, "That owner is not a user of this organization.");
  if (u.role !== "landlord") throw new StmtError(400, "The owner must be a landlord account.");
}

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
        ownerUserId:     pmAgreements.ownerUserId,
        agreementNumber: pmAgreements.agreementNumber,
        feeType:         pmAgreements.feeType,
        feeRate:         pmAgreements.feeRate,
        disbursementMethod: pmAgreements.disbursementMethod,
        disbursementAccount: pmAgreements.disbursementAccount,
        disbursementName: pmAgreements.disbursementName,
        status:          pmAgreements.status,
        startDate:       pmAgreements.startDate,
        endDate:         pmAgreements.endDate,
        deductMaintenanceCosts: pmAgreements.deductMaintenanceCosts,
        deductUtilities: pmAgreements.deductUtilities,
        deductInsurance: pmAgreements.deductInsurance,
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
  } catch (err) { fail(res, err); }
});

// GET /api/owner-statements/agreements/:propertyId
router.get("/agreements/:propertyId(\\d+)", ...auth, async (req: any, res: any) => {
  try {
    const isLandlord = req.user.role === "landlord";
    const [row] = await db
      .select()
      .from(pmAgreements)
      .where(and(
        eq(pmAgreements.propertyId, parseInt(req.params.propertyId)),
        eq(pmAgreements.organizationId, req.user.organizationId),
        // an owner sees only their own agreement (it holds their bank details and the fee terms)
        ...(isLandlord ? [eq(pmAgreements.ownerUserId, req.user.id as string)] : []),
      ))
      .limit(1);
    res.json(row ?? null);
  } catch (err) { fail(res, err); }
});

// POST /api/owner-statements/agreements
router.post("/agreements", ...auth, auditLog("pm_agreement", "CREATE") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can create PM agreements." });
  try {
    const orgId = req.user.organizationId;
    const body = createAgreementSchema.parse(req.body);

    const [prop] = await db.select({ id: properties.id, ownerId: properties.ownerId, name: properties.name }).from(properties)
      .where(and(eq(properties.id, body.propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!prop) throw new StmtError(404, "Property not found");

    const [dup] = await db.select({ n: pmAgreements.agreementNumber }).from(pmAgreements).where(eq(pmAgreements.propertyId, body.propertyId)).limit(1);
    if (dup) throw new StmtError(409, `${prop.name} already has an agreement (${dup.n}). Edit that one instead.`);

    const ownerUserId = body.ownerUserId ?? prop.ownerId ?? null;
    if (ownerUserId) await assertOwner(orgId, ownerUserId);

    let created;
    try {
      [created] = await withNumberRetry(async () => db.insert(pmAgreements).values({
        organizationId: orgId,
        propertyId: body.propertyId,
        agreementNumber: await nextAgreementNumber(),
        ownerUserId,
        feeType: body.feeType,
        feeRate: String(body.feeRate),
        disbursementMethod: body.disbursementMethod ?? null,
        disbursementAccount: body.disbursementAccount ?? null,
        disbursementName: body.disbursementName ?? null,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        autoRenew: body.autoRenew ?? true,
        noticePeriodDays: body.noticePeriodDays ?? 30,
        deductMaintenanceCosts: body.deductMaintenanceCosts ?? true,
        deductUtilities: body.deductUtilities ?? false,
        deductInsurance: body.deductInsurance ?? false,
        ...(body.maintenanceApprovalThreshold != null ? { maintenanceApprovalThreshold: String(body.maintenanceApprovalThreshold) } : {}),
        status: body.status ?? "active",
        notes: body.notes ?? null,
        createdBy: req.user.id,
      } as any).returning());
    } catch (e: any) {
      if (isUniqueViolation(e) && /property_id/.test(String(e?.constraint ?? e?.detail ?? e?.message))) throw new StmtError(409, `${prop.name} already has an agreement. Edit that one instead.`);
      throw e;
    }
    res.status(201).json(created);
  } catch (err) { fail(res, err, "Could not create the agreement"); }
});

// PATCH /api/owner-statements/agreements/:id
router.patch("/agreements/:id(\\d+)", ...auth, auditLog("pm_agreement", "UPDATE") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can update PM agreements." });
  try {
    const orgId = req.user.organizationId;
    const id = parseInt(req.params.id);
    const body = patchAgreementSchema.parse(req.body);

    const [current] = await db.select().from(pmAgreements).where(and(eq(pmAgreements.id, id), eq(pmAgreements.organizationId, orgId))).limit(1);
    if (!current) throw new StmtError(404, "Agreement not found");

    // the rules must also hold for the merged result (e.g. lowering the end date below the start date)
    const merged = { feeType: body.feeType ?? current.feeType, feeRate: body.feeRate ?? Number(current.feeRate), startDate: body.startDate ?? current.startDate, endDate: body.endDate === undefined ? current.endDate : body.endDate, disbursementMethod: body.disbursementMethod === undefined ? current.disbursementMethod : body.disbursementMethod, disbursementAccount: body.disbursementAccount === undefined ? current.disbursementAccount : body.disbursementAccount };
    const mergedIssues = z.object({}).passthrough().superRefine(checkAgreement).safeParse(merged);
    if (!mergedIssues.success) throw new StmtError(400, mergedIssues.error.errors[0].message);

    if (body.ownerUserId) await assertOwner(orgId, body.ownerUserId);

    const set: Record<string, any> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      set[k] = (k === "feeRate" || k === "maintenanceApprovalThreshold") ? String(v) : v;
    }
    const [updated] = await db.update(pmAgreements).set(set).where(and(eq(pmAgreements.id, id), eq(pmAgreements.organizationId, orgId))).returning();
    res.json(updated);
  } catch (err) { fail(res, err, "Could not update the agreement"); }
});

// ══════════════════════════════════════════════════════════════════════════════
// OWNER STATEMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/owner-statements?propertyId=&year=
router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = req.query.propertyId ? posInt(req.query.propertyId) : null;
    const year       = req.query.year       ? posInt(req.query.year)       : null;
    if ((req.query.propertyId && !propertyId) || (req.query.year && !year)) return res.status(400).json({ message: "propertyId and year must be numbers" });

    // Landlords only see approved statements for their own properties
    const isLandlord = req.user.role === "landlord";
    const userId     = req.user.id as string;

    const rows = await db
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
        ...(isLandlord   ? [eq(properties.ownerId, userId), inArray(ownerStatements.status, OWNER_VISIBLE)] : []),
      ))
      .orderBy(desc(ownerStatements.periodYear), desc(ownerStatements.periodMonth), desc(ownerStatements.id));
    res.json(rows);
  } catch (err) { fail(res, err); }
});

// GET /api/owner-statements/:id
router.get("/:id(\\d+)", ...auth, async (req: any, res: any) => {
  try {
    const isLandlord = req.user.role === "landlord";
    const userId     = req.user.id as string;

    const [row] = await db
      .select({
        statement: ownerStatements,
        ownerId:   properties.ownerId,
        propertyName: properties.name,
      })
      .from(ownerStatements)
      .leftJoin(properties, eq(ownerStatements.propertyId, properties.id))
      .where(and(
        eq(ownerStatements.id, parseInt(req.params.id)),
        eq(ownerStatements.organizationId, req.user.organizationId),
        ...(isLandlord ? [eq(properties.ownerId, userId), inArray(ownerStatements.status, OWNER_VISIBLE)] : []),
      ))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Statement not found" });
    res.json({ ...row.statement, propertyName: row.propertyName });
  } catch (err) { fail(res, err); }
});

const generateSchema = z.object({
  propertyId: z.coerce.number({ invalid_type_error: "Pick a property" }).int().positive("Pick a property"),
  year:       z.coerce.number({ invalid_type_error: "Year must be a number" }).int().min(2000, "Year is out of range").max(2100, "Year is out of range"),
  month:      z.coerce.number({ invalid_type_error: "Month must be a number" }).int().min(1, "Month must be 1–12").max(12, "Month must be 1–12"),
});

/**
 * POST /api/owner-statements/generate
 * Body: { propertyId, year, month }
 *
 *  1. The property must be this organization's and have an ACTIVE PM agreement covering the month
 *  2. Rent counted = money that actually arrived in the month (receipts, one per payment)
 *  3. Deductible expenses (approved / paid) dated in the month, per the agreement's rules — month = Nairobi calendar month
 *  4. PM fee from the agreement; a shortfall carried from the previous month's statement is deducted
 *  5. Costs above income are never lost: net payable stays at 0 and the shortfall is carried to the next statement
 *  6. Re-generating overwrites a draft or approved statement (approved goes back to draft); sent / paid are final.
 *     Two people generating the same month at once cannot create two statements (advisory lock).
 */
router.post("/generate", ...auth, auditLog("owner_statement", "CREATE") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can generate owner statements." });
  try {
    const orgId = req.user.organizationId;
    const { propertyId, year, month } = generateSchema.parse(req.body);
    const warnings: string[] = [];

    const [prop] = await db.select({ id: properties.id, name: properties.name }).from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!prop) throw new StmtError(404, "Property not found");

    const [agreement] = await db.select().from(pmAgreements)
      .where(and(eq(pmAgreements.propertyId, propertyId), eq(pmAgreements.organizationId, orgId))).limit(1);
    if (!agreement) {
      throw new StmtError(404, "No PM agreement found for this property. Create one first.");
    }
    if (agreement.status !== "active") throw new StmtError(409, `The agreement ${agreement.agreementNumber} is ${agreement.status}. Re-activate it before generating statements.`);

    const period = eatMonth(year, month);
    if (period.start.getTime() > Date.now()) throw new StmtError(400, "That month has not started yet.");
    if (period.to < String(agreement.startDate)) throw new StmtError(409, `The agreement ${agreement.agreementNumber} starts on ${agreement.startDate}, after ${monthLabel(year, month)}.`);
    if (agreement.endDate && period.from > String(agreement.endDate)) throw new StmtError(409, `The agreement ${agreement.agreementNumber} ended on ${agreement.endDate}, before ${monthLabel(year, month)}.`);
    if (period.end.getTime() > Date.now()) warnings.push(`${monthLabel(year, month)} is not over yet — regenerate after month end so late payments and expenses are included.`);

    // Active tenants (for per-unit fees)
    const propTenants = await db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .where(and(eq(units.propertyId, propertyId), eq(tenants.status, "active")));
    const occupiedUnits = propTenants.length;

    // Money actually received in the month — one receipt per payment
    const payments = await rentCashRows(propertyId, period.from, period.to);
    const grossRent = r2(payments.reduce((s, p) => s + money(p.amount), 0));

    // Names for the breakdown: everyone who paid, including tenants who have since moved out
    const payerIds = Array.from(new Set(payments.map(p => p.tenantId)));
    const payers = payerIds.length
      ? await db.select({ id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, monthlyRent: tenants.monthlyRent, unitNumber: units.unitNumber })
          .from(tenants).leftJoin(units, eq(tenants.unitId, units.id)).where(inArray(tenants.id, payerIds))
      : [];

    // Expenses the agreement lets us deduct
    const expenseCategories: string[] = [];
    if (agreement.deductMaintenanceCosts) expenseCategories.push("maintenance", "services", "supplies");
    if (agreement.deductUtilities)        expenseCategories.push("utilities");
    if (agreement.deductInsurance)        expenseCategories.push("insurance");

    const expenses = expenseCategories.length > 0
      ? await db
          .select({
            id: propertyExpenses.id, description: propertyExpenses.description, amount: propertyExpenses.amount,
            category: propertyExpenses.category, vendorName: propertyExpenses.vendorName, expenseDate: propertyExpenses.expenseDate,
          })
          .from(propertyExpenses)
          .where(and(
            eq(propertyExpenses.propertyId, propertyId),
            inArray(propertyExpenses.category, expenseCategories as any),
            inArray(propertyExpenses.status, ["approved", "paid"]),
            gte(propertyExpenses.expenseDate, period.start),
            lte(propertyExpenses.expenseDate, period.end),
          ))
      : [];

    const sumCat = (cats: string[]) => r2(expenses.filter(e => cats.includes(e.category ?? "")).reduce((s, e) => s + money(e.amount), 0));
    const maintenanceCosts = sumCat(["maintenance", "services", "supplies"]);
    const utilityCosts     = sumCat(["utilities"]);
    const insuranceCosts   = sumCat(["insurance"]);

    // Repairs finished this month that the owner pays for — are they all in the expenses?
    if (agreement.deductMaintenanceCosts) {
      const [rep] = await db.select({ n: sql<number>`COUNT(*)`, total: sql<string>`COALESCE(SUM(${maintenanceRequests.actualCost}),0)` })
        .from(maintenanceRequests).innerJoin(units, eq(maintenanceRequests.unitId, units.id))
        .where(and(eq(units.propertyId, propertyId), eq(maintenanceRequests.status, "completed"),
          sql`coalesce(${maintenanceRequests.chargeTenant}, false) = false`,
          sql`coalesce(${maintenanceRequests.actualCost}, 0) > 0`,
          gte(maintenanceRequests.completedAt, period.start), lte(maintenanceRequests.completedAt, period.end)));
      if (Number(rep.n) > 0 && money(rep.total) > maintenanceCosts + 0.01) {
        warnings.push(`${rep.n} repair${Number(rep.n) === 1 ? "" : "s"} completed this month cost KES ${money(rep.total).toLocaleString("en-KE")}, but only KES ${maintenanceCosts.toLocaleString("en-KE")} of maintenance expenses are deducted. Record an expense for each repair the owner should pay for, then regenerate.`);
      }
    }

    const pmFee = r2(computePmFee(agreement, grossRent, occupiedUnits));

    // A shortfall left by the previous month's (approved) statement is taken off this one
    const prevY = month === 1 ? year - 1 : year, prevM = month === 1 ? 12 : month - 1;
    const [prev] = await db.select({ lineItems: ownerStatements.lineItems, status: ownerStatements.status })
      .from(ownerStatements)
      .where(and(eq(ownerStatements.propertyId, propertyId), eq(ownerStatements.organizationId, orgId), eq(ownerStatements.periodYear, prevY), eq(ownerStatements.periodMonth, prevM)))
      .limit(1);
    let carried = 0;
    if (prev && OWNER_VISIBLE.includes(prev.status ?? "")) {
      const sf = (Array.isArray(prev.lineItems) ? prev.lineItems : []).find((l: any) => l?.type === "shortfall");
      carried = r2(Math.max(0, money(sf?.amount)));
    } else if (prev && prev.status === "draft") {
      warnings.push(`The ${monthLabel(prevY, prevM)} statement is still a draft — if it ends in a shortfall, approve it first and regenerate this one.`);
    }

    const totalIncome     = grossRent;
    const totalDeductions = r2(pmFee + maintenanceCosts + utilityCosts + insuranceCosts + carried);
    const netPayable      = r2(Math.max(0, totalIncome - totalDeductions));
    const shortfall       = r2(Math.max(0, totalDeductions - totalIncome));
    if (shortfall > 0) warnings.push(`Costs exceed the rent collected by KES ${shortfall.toLocaleString("en-KE")}. Nothing is payable to the owner this month; the shortfall is carried to ${monthLabel(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}.`);

    const paymentDetails = payments.map(p => {
      const t = payers.find(t => t.id === p.tenantId);
      return {
        tenantName: t ? `${t.firstName} ${t.lastName}` : `Tenant #${p.tenantId}`,
        unitNumber: t?.unitNumber ?? "—", amount: Number(p.amount), method: p.paymentMethod ?? "—",
        date: p.paidDate, monthlyRent: Number(t?.monthlyRent ?? 0),
      };
    });
    const expenseDetails = expenses.map(e => ({ id: e.id, vendor: e.vendorName, description: e.description, amount: Number(e.amount), category: e.category, date: e.expenseDate }));

    const feeLabel = agreement.feeType === "percentage" ? `${Number(agreement.feeRate)}%` : agreement.feeType === "per_unit" ? `KES ${Number(agreement.feeRate)} × ${occupiedUnits} units` : `KES ${Number(agreement.feeRate)}`;
    const lineItems = [
      { type: "income",    description: "Gross rent collected", amount: grossRent },
      { type: "deduction", description: `PM fee (${feeLabel})`, amount: -pmFee },
      ...(maintenanceCosts > 0 ? [{ type: "deduction", description: "Maintenance & repairs", amount: -maintenanceCosts }] : []),
      ...(utilityCosts > 0     ? [{ type: "deduction", description: "Utilities",             amount: -utilityCosts     }] : []),
      ...(insuranceCosts > 0   ? [{ type: "deduction", description: "Insurance",             amount: -insuranceCosts   }] : []),
      ...(carried > 0          ? [{ type: "deduction", description: `Shortfall brought forward from ${monthLabel(prevY, prevM)}`, amount: -carried }] : []),
      ...(shortfall > 0        ? [{ type: "shortfall", description: "Shortfall carried forward to the next statement", amount: shortfall }] : []),
      { type: "net",       description: "Net payable to owner", amount: netPayable },
    ];

    const values = {
      grossRent: String(grossRent), totalIncome: String(totalIncome), pmFee: String(pmFee),
      maintenanceCosts: String(maintenanceCosts), utilityCosts: String(utilityCosts), insuranceCosts: String(insuranceCosts),
      otherDeductions: String(carried), totalDeductions: String(totalDeductions), netPayable: String(netPayable),
      lineItems, paymentDetails, expenseDetails,
    };

    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${propertyId}, ${year * 100 + month})`);
      const [existing] = await tx.select({ id: ownerStatements.id, status: ownerStatements.status, number: ownerStatements.statementNumber })
        .from(ownerStatements)
        .where(and(eq(ownerStatements.propertyId, propertyId), eq(ownerStatements.organizationId, orgId), eq(ownerStatements.periodYear, year), eq(ownerStatements.periodMonth, month)))
        .orderBy(asc(ownerStatements.id)).limit(1);

      if (existing) {
        if (["sent", "paid"].includes(existing.status ?? "")) {
          throw new StmtError(409, `Statement ${existing.number} is already ${existing.status} — it cannot be regenerated.`);
        }
        if (existing.status === "approved") warnings.push(`Statement ${existing.number} was approved; it is a draft again and needs approving once more.`);
        const [updated] = await tx.update(ownerStatements).set({
          ...values, otherIncome: "0", status: "draft", approvedBy: null, approvedAt: null, updatedAt: new Date(), generatedBy: req.user.id,
        }).where(eq(ownerStatements.id, existing.id)).returning();
        return { row: updated, created: false };
      }

      const [created] = await withNumberRetry(async () => tx.insert(ownerStatements).values({
        organizationId: orgId, pmAgreementId: agreement.id, propertyId, ownerUserId: agreement.ownerUserId,
        statementNumber: await nextStatementNumber(), periodMonth: month, periodYear: year,
        otherIncome: "0", currency: "KES", status: "draft", generatedBy: req.user.id, ...values,
      } as any).returning());
      return { row: created, created: true };
    });

    res.status(outcome.created ? 201 : 200).json({ ...outcome.row, shortfall, carriedForward: carried, warnings });
  } catch (err) { fail(res, err, "Could not generate the statement"); }
});

/** Load one statement of this org, or 404. */
async function loadStatement(req: any) {
  const id = posInt(req.params.id);
  const [st] = id ? await db.select().from(ownerStatements)
    .where(and(eq(ownerStatements.id, id), eq(ownerStatements.organizationId, req.user.organizationId))).limit(1) : [];
  if (!st) throw new StmtError(404, "Statement not found");
  return st;
}

// PATCH /api/owner-statements/:id/approve — draft → approved
router.patch("/:id(\\d+)/approve", ...auth, auditLog("owner_statement", "ACTION") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can approve statements." });
  try {
    const st = await loadStatement(req);
    const [updated] = await db.update(ownerStatements)
      .set({ status: "approved", approvedBy: req.user.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ownerStatements.id, st.id), eq(ownerStatements.status, "draft"))).returning();
    if (!updated) throw new StmtError(409, st.status === "approved" ? "This statement is already approved." : `This statement is ${st.status}; only a draft can be approved.`);
    res.json(updated);
  } catch (err) { fail(res, err); }
});

// PATCH /api/owner-statements/:id/send — email the owner; approved → sent (sent can be re-sent)
router.patch("/:id(\\d+)/send", ...auth, auditLog("owner_statement", "ACTION") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can send statements." });
  try {
    const orgId = req.user.organizationId;
    const st = await loadStatement(req);
    if (!["approved", "sent", "paid"].includes(st.status ?? "")) throw new StmtError(409, "Approve the statement before sending it to the owner.");

    const [prop] = await db.select({ name: properties.name, ownerId: properties.ownerId }).from(properties).where(eq(properties.id, st.propertyId)).limit(1);
    const ownerId = st.ownerUserId ?? prop?.ownerId ?? null;
    const [owner] = ownerId ? await db.select({ email: users.email, firstName: users.firstName }).from(users).where(and(eq(users.id, ownerId), eq(users.organizationId, orgId))).limit(1) : [];
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

    let emailSent = false, emailError: string | null = null;
    if (!owner?.email) emailError = "This property has no owner with an email address, so nothing was emailed.";
    else {
      try {
        await sendOwnerStatementEmail({
          to: owner.email, name: owner.firstName || "there", orgName: org?.name, propertyName: prop?.name,
          period: monthLabel(st.periodYear, st.periodMonth), statementNumber: st.statementNumber,
          grossRent: money(st.grossRent), deductions: money(st.totalDeductions), netPayable: money(st.netPayable), currency: st.currency,
        });
        emailSent = true;
      } catch (e: any) { emailError = e?.message ?? "The email could not be sent."; }
    }

    const [updated] = st.status === "approved"
      ? await db.update(ownerStatements).set({ status: "sent", updatedAt: new Date() }).where(and(eq(ownerStatements.id, st.id), eq(ownerStatements.status, "approved"))).returning()
      : [st];
    res.json({ ...(updated ?? st), emailSent, emailError });
  } catch (err) { fail(res, err); }
});

const disburseSchema = z.object({
  disbursementRef: z.preprocess(blank, z.string().trim().min(3, "Enter the M-Pesa code, bank reference or cheque number (at least 3 characters)").max(100).nullish()),
  disbursedDate:   z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullish()),
});

// PATCH /api/owner-statements/:id/mark-disbursed — approved / sent → paid
router.patch("/:id(\\d+)/mark-disbursed", ...auth, auditLog("owner_statement", "ACTION") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can mark statements as disbursed." });
  try {
    const body = disburseSchema.parse(req.body ?? {});
    const st = await loadStatement(req);
    if (st.status === "paid") throw new StmtError(409, `This statement was already paid${st.disbursementRef ? ` (ref ${st.disbursementRef})` : ""}.`);
    if (st.status === "draft") throw new StmtError(409, "Approve the statement before recording the payout.");
    const net = money(st.netPayable);
    if (net > 0 && !body.disbursementRef) throw new StmtError(400, "Enter the M-Pesa code, bank reference or cheque number of the payout.");

    let when = new Date();
    if (body.disbursedDate) {
      const d = new Date(`${body.disbursedDate}T12:00:00+03:00`);
      if (Number.isNaN(d.getTime()) || new Date(`${body.disbursedDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.disbursedDate) throw new StmtError(400, "That is not a real date.");
      if (body.disbursedDate > todayEAT()) throw new StmtError(400, "The payout date cannot be in the future.");
      when = d;
    }

    const [updated] = await db.update(ownerStatements)
      .set({ status: "paid", disbursedAt: when, disbursementRef: body.disbursementRef ?? (net > 0 ? null : "NIL"), updatedAt: new Date() })
      .where(and(eq(ownerStatements.id, st.id), inArray(ownerStatements.status, ["approved", "sent"]))).returning();
    if (!updated) throw new StmtError(409, "This statement was just paid or changed. Refresh the page.");
    res.json(updated);
  } catch (err) { fail(res, err); }
});

// PATCH /api/owner-statements/:id/undo-disbursed — admin only: the payout was recorded by mistake
router.patch("/:id(\\d+)/undo-disbursed", ...auth, auditLog("owner_statement", "ACTION") as any, async (req: any, res: any) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Only an administrator can reverse a recorded payout." });
  try {
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 3) throw new StmtError(400, "Say why the payout is being reversed.");
    const st = await loadStatement(req);
    const [updated] = await db.update(ownerStatements)
      .set({ status: "approved", disbursedAt: null, disbursementRef: null, notes: [st.notes, `Payout ${st.disbursementRef ?? ""} reversed: ${reason}`].filter(Boolean).join(" | "), updatedAt: new Date() })
      .where(and(eq(ownerStatements.id, st.id), eq(ownerStatements.status, "paid"))).returning();
    if (!updated) throw new StmtError(409, "Only a paid statement can have its payout reversed.");
    res.json(updated);
  } catch (err) { fail(res, err); }
});

// DELETE /api/owner-statements/:id — a draft only
router.delete("/:id(\\d+)", ...auth, auditLog("owner_statement", "DELETE") as any, async (req: any, res: any) => {
  if (!isStaff(req)) return res.status(403).json({ message: "Only admins and managers can delete statements." });
  try {
    const st = await loadStatement(req);
    const gone = await db.delete(ownerStatements).where(and(eq(ownerStatements.id, st.id), eq(ownerStatements.status, "draft"))).returning({ id: ownerStatements.id });
    if (!gone.length) throw new StmtError(409, `A ${st.status} statement cannot be deleted. Only drafts can.`);
    res.json({ success: true });
  } catch (err) { fail(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RENT ROLL
// GET /api/owner-statements/rent-roll
// Returns every unit across all org properties with tenant, lease, and payment data.
// ══════════════════════════════════════════════════════════════════════════════

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month's rent roll for an organization (optionally one property, or one owner's properties). */
async function buildRentRoll(orgId: number, o: { propertyId?: number | null; month: string; landlordId?: string | null }) {
  const [, yS, mS] = MONTH_RE.exec(o.month)!;
  const period = eatMonth(Number(yS), Number(mS));

  const allUnits = await db
    .select({
      unitId: units.id, unitNumber: units.unitNumber, monthlyRent: units.monthlyRent, currency: units.currency,
      isOccupied: units.isOccupied, propertyId: properties.id, propertyName: properties.name, ownerId: properties.ownerId,
    })
    .from(units)
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .where(and(
      eq(units.organizationId, orgId),
      ...(o.propertyId ? [eq(units.propertyId, o.propertyId)] : []),
      ...(o.landlordId ? [eq(properties.ownerId, o.landlordId)] : []),
    ))
    .orderBy(asc(properties.name), asc(units.unitNumber));

  const unitIds = allUnits.map(u => u.unitId);
  const activeTenants = unitIds.length > 0
    ? await db
        .select({
          id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email, phone: tenants.phone,
          unitId: tenants.unitId, monthlyRent: tenants.monthlyRent, leaseStartDate: tenants.leaseStartDate, leaseEndDate: tenants.leaseEndDate,
          securityDeposit: tenants.securityDeposit, status: tenants.status,
        })
        .from(tenants)
        .where(and(inArray(tenants.unitId, unitIds), eq(tenants.status, "active")))
    : [];

  const tenantIds = activeTenants.map(t => t.id);
  const monthPayments = tenantIds.length > 0
    ? await db
        .select({ id: rentPayments.id, tenantId: rentPayments.tenantId, amount: rentPayments.amount, status: rentPayments.status, paidDate: rentPayments.paidDate, paymentMethod: rentPayments.paymentMethod })
        .from(rentPayments)
        .where(and(inArray(rentPayments.tenantId, tenantIds), gte(rentPayments.dueDate, period.from), lte(rentPayments.dueDate, period.to)))
    : [];

  const tenantMap = Object.fromEntries(activeTenants.map(t => [t.unitId, t]));
  const bal = await rentBalances(monthPayments.map(p => ({ id: p.id, amount: p.amount, status: p.status })));
  const paymentMap: Record<number, { invoiced: number; received: number; balance: number; paidDate: any; paymentMethod: any }> = {};
  for (const p of monthPayments) {
    const b = bal.get(p.id) ?? { paidAmount: 0, balance: Number(p.amount) };
    const cur = paymentMap[p.tenantId] ?? { invoiced: 0, received: 0, balance: 0, paidDate: null, paymentMethod: null };
    cur.invoiced += Number(p.amount); cur.received += b.paidAmount; cur.balance += b.balance;
    if (p.paidDate && (!cur.paidDate || p.paidDate > cur.paidDate)) { cur.paidDate = p.paidDate; cur.paymentMethod = p.paymentMethod; }
    paymentMap[p.tenantId] = cur;
  }

  const rentRoll = allUnits.map(u => {
    const tenant  = tenantMap[u.unitId] ?? null;
    const payment = tenant ? (paymentMap[tenant.id] ?? null) : null;
    const rent    = Number(tenant?.monthlyRent ?? u.monthlyRent ?? 0);
    const received = r2(payment?.received ?? 0);
    const owed     = payment ? r2(payment.balance) : (u.isOccupied ? rent : 0);
    const paid     = !!payment && owed <= 0.01;
    const partial  = !paid && received > 0.01;
    return {
      propertyId: u.propertyId, propertyName: u.propertyName, unitId: u.unitId, unitNumber: u.unitNumber, isOccupied: u.isOccupied,
      monthlyRent: rent, currency: u.currency,
      tenantId: tenant?.id ?? null, tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
      tenantEmail: tenant?.email ?? null, tenantPhone: tenant?.phone ?? null,
      leaseStart: tenant?.leaseStartDate ?? null, leaseEnd: tenant?.leaseEndDate ?? null, depositHeld: Number(tenant?.securityDeposit ?? 0),
      paymentStatus: paid ? "paid" : partial ? "partial" : u.isOccupied ? "unpaid" : "vacant",
      amountPaid: received, paidDate: payment?.paidDate ?? null, paymentMethod: payment?.paymentMethod ?? null,
      arrearsAmount: paid || !u.isOccupied ? 0 : owed,
    };
  });

  const summary = {
    totalUnits:    rentRoll.length,
    occupiedUnits: rentRoll.filter(r => r.isOccupied).length,
    vacantUnits:   rentRoll.filter(r => !r.isOccupied).length,
    totalExpected: rentRoll.filter(r => r.isOccupied).reduce((s, r) => s + r.monthlyRent, 0),
    totalCollected: rentRoll.reduce((s, r) => s + r.amountPaid, 0),
    totalArrears:  rentRoll.reduce((s, r) => s + r.arrearsAmount, 0),
    paidCount:     rentRoll.filter(r => r.paymentStatus === "paid").length,
    partialCount:  rentRoll.filter(r => r.paymentStatus === "partial").length,
    unpaidCount:   rentRoll.filter(r => r.paymentStatus === "unpaid").length,
  };
  return { month: o.month, summary, rentRoll };
}

router.get("/rent-roll", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const propertyId = req.query.propertyId ? posInt(req.query.propertyId) : null;
    if (req.query.propertyId && !propertyId) return res.status(400).json({ message: "propertyId must be a number" });
    const month = String(req.query.month || new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7));
    if (!MONTH_RE.test(month)) return res.status(400).json({ message: "month must look like 2026-11" });
    res.json(await buildRentRoll(orgId, { propertyId, month, landlordId: req.user.role === "landlord" ? (req.user.id as string) : null }));
  } catch (err) { fail(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MANAGEMENT PACK
// GET /api/owner-statements/management-pack/:propertyId/:year/:month
// Returns all data needed to render a printable management pack for a landlord.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/management-pack/:propertyId(\\d+)/:year(\\d+)/:month(\\d+)", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const isLandlord = req.user.role === "landlord";
    const propertyId = parseInt(req.params.propertyId);
    const year       = parseInt(req.params.year);
    const month      = parseInt(req.params.month);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) return res.status(400).json({ message: "Year or month is out of range" });
    const period = eatMonth(year, month);

    // The property must be this organization's — and, for an owner login, one of THEIR properties
    const [prop] = await db.select().from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), ...(isLandlord ? [eq(properties.ownerId, req.user.id as string)] : [])))
      .limit(1);
    if (!prop) return res.status(404).json({ message: "Property not found" });

    const [statement] = await db.select().from(ownerStatements)
      .where(and(
        eq(ownerStatements.propertyId, propertyId), eq(ownerStatements.organizationId, orgId),
        eq(ownerStatements.periodYear, year), eq(ownerStatements.periodMonth, month),
        ...(isLandlord ? [inArray(ownerStatements.status, OWNER_VISIBLE)] : []),
      )).orderBy(asc(ownerStatements.id)).limit(1);

    const rentRollData = await buildRentRoll(orgId, { propertyId, month: `${year}-${pad(month)}` });

    const propUnits = await db.select({ id: units.id }).from(units).where(eq(units.propertyId, propertyId));
    const propUnitIds = propUnits.map(u => u.id);
    const maintenanceSummary = propUnitIds.length > 0
      ? await db.select({
            id: maintenanceRequests.id, title: maintenanceRequests.title, status: maintenanceRequests.status, priority: maintenanceRequests.priority,
            actualCost: maintenanceRequests.actualCost, createdAt: maintenanceRequests.createdAt, completedAt: maintenanceRequests.completedAt,
          })
          .from(maintenanceRequests)
          .where(and(inArray(maintenanceRequests.unitId, propUnitIds), gte(maintenanceRequests.createdAt, period.start), lte(maintenanceRequests.createdAt, period.end)))
      : [];

    const expenses = await db.select().from(propertyExpenses)
      .where(and(
        eq(propertyExpenses.propertyId, propertyId),
        gte(propertyExpenses.expenseDate, period.start), lte(propertyExpenses.expenseDate, period.end),
        // an owner sees what was actually approved or paid, not requests still waiting for a decision
        ...(isLandlord ? [inArray(propertyExpenses.status, ["approved", "paid"])] : []),
      ));

    res.json({
      property: prop,
      period: { year, month, label: monthLabel(year, month) },
      statement: statement ?? null,
      rentRoll: rentRollData,
      maintenance: {
        total:     maintenanceSummary.length,
        completed: maintenanceSummary.filter(m => m.status === "completed").length,
        open:      maintenanceSummary.filter(m => !["completed", "cancelled"].includes(m.status ?? "")).length,
        totalCost: maintenanceSummary.reduce((s, m) => s + Number(m.actualCost ?? 0), 0),
        requests:  maintenanceSummary,
      },
      expenses: { total: expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0), items: expenses },
    });
  } catch (err) { fail(res, err); }
});

export default router;
