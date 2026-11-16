import { Router } from "express";
import { db } from "../db";
import { rentToOwnAgreements, rentToOwnPayments, ownershipCertificates, propertyManagementAgreements, properties, tenants } from "@shared/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { logger } from "../lib/logger";
import { postSaleReceipt } from "../services/sale-ledger";

const EPS = 0.01;
const MAX_AMOUNT = 100_000_000_000;
const AGREEMENT_TYPES = ["lease_option", "lease_purchase", "installment_sale", "rent_to_own"];
const AGREEMENT_STATUSES_EDITABLE = ["active", "cancelled", "defaulted"]; // "completed" comes from the balance reaching zero
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: unknown): number => (v === undefined || v === null || String(v).trim() === "" ? NaN : Number(v));
const posId = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const validDate = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "" && !Number.isNaN(new Date(String(v)).getTime());
const clean = (v: unknown, max = 255): string | null => { const t = String(v ?? "").trim(); return t ? t.slice(0, max) : null; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
function fail(res: any, err: any, tag: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  logger.error(`[rent-to-own] ${tag}:`, err);
  return res.status(500).json({ message: err?.cause?.message ?? err?.message ?? "Something went wrong" });
}

// ── Organisation scoping ─────────────────────────────────────────────────────
// An agreement belongs to the organisation that owns its property AND whose tenant it is. Both are checked, so a
// forged tenantId or propertyId from another organisation cannot attach an agreement to it.
async function orgPropertyIds(orgId: number): Promise<number[]> {
  const rows = await db.select({ id: properties.id }).from(properties).where(eq(properties.organizationId, orgId));
  return rows.map(r => r.id);
}
async function ownAgreement(id: unknown, orgId: number, ex: any = db, lock = false) {
  const n = posId(id);
  if (!n) return null;
  const q = ex.select({ a: rentToOwnAgreements }).from(rentToOwnAgreements)
    .innerJoin(properties, eq(properties.id, rentToOwnAgreements.propertyId))
    .innerJoin(tenants, eq(tenants.id, rentToOwnAgreements.tenantId))
    .where(and(eq(rentToOwnAgreements.id, n), eq(properties.organizationId, orgId), eq(tenants.organizationId, orgId))).limit(1);
  const [row] = lock ? await q.for("update", { of: rentToOwnAgreements }) : await q;
  return row?.a ?? null;
}
async function ownAgreementIds(orgId: number): Promise<number[]> {
  const rows = await db.select({ id: rentToOwnAgreements.id }).from(rentToOwnAgreements)
    .innerJoin(properties, eq(properties.id, rentToOwnAgreements.propertyId))
    .innerJoin(tenants, eq(tenants.id, rentToOwnAgreements.tenantId))
    .where(and(eq(properties.organizationId, orgId), eq(tenants.organizationId, orgId)));
  return rows.map(r => r.id);
}

// ── The shape the screen reads ───────────────────────────────────────────────
// Rent-credit terms, option fee and legal clauses live in the agreement's `conditions` JSON (the table has no columns
// for them, so they used to be silently dropped on save). The screen also expects start date, payments made / total,
// tenant and property names and the credits earned so far; those are computed here.
async function enrich(rows: any[]): Promise<any[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const stats = await db.select({
    agreementId: rentToOwnPayments.agreementId,
    total: sql<number>`count(*)::int`,
    paid: sql<number>`count(*) filter (where ${rentToOwnPayments.status} = 'paid')::int`,
    paidSum: sql<string>`coalesce(sum(${rentToOwnPayments.paidAmount}),0)`,
  }).from(rentToOwnPayments).where(inArray(rentToOwnPayments.agreementId, ids)).groupBy(rentToOwnPayments.agreementId);
  const byAgreement = new Map(stats.map(s => [s.agreementId, s]));
  const tenantRows = await db.select({ id: tenants.id, f: tenants.firstName, l: tenants.lastName }).from(tenants).where(inArray(tenants.id, rows.map(r => r.tenantId)));
  const propRows = await db.select({ id: properties.id, name: properties.name, address: properties.address }).from(properties).where(inArray(properties.id, rows.map(r => r.propertyId)));
  const tName = new Map(tenantRows.map(t => [t.id, `${t.f} ${t.l}`.trim()]));
  const pInfo = new Map(propRows.map(p => [p.id, p]));
  return rows.map(a => {
    const c = (a.conditions ?? {}) as Record<string, any>;
    const s = byAgreement.get(a.id);
    const rate = Number(c.rentCreditRate ?? 0);
    const monthly = Number(a.monthlyPayment);
    const optionApplied = c.optionFeeApplied === true;
    const p = pInfo.get(a.propertyId);
    return {
      ...a,
      purchasePrice: c.purchasePrice ?? a.totalPropertyValue,
      monthlyRent: a.monthlyPayment,
      optionFee: String(c.optionFee ?? "0"),
      optionFeeApplied: optionApplied,
      rentCreditRate: String(rate),
      rentCreditAmount: round2(monthly * rate / 100).toFixed(2),
      totalRentCredits: round2((optionApplied ? Number(c.optionFee ?? 0) : 0) + Number(s?.paidSum ?? 0) * rate / 100).toFixed(2),
      optionExpiryDate: c.optionExpiryDate ?? null,
      legalClause: c.legalClause ?? null,
      isNotarized: c.isNotarized === true,
      escrowAccount: c.escrowAccount ?? null,
      propertyConditionReport: c.propertyConditionReport === true,
      startDate: a.agreementDate,
      agreementDurationMonths: a.agreementDuration,
      paymentsMade: s?.paid ?? 0,
      paymentsTotal: s?.total ? s.total : a.agreementDuration,
      tenantName: tName.get(a.tenantId) ?? null,
      propertyAddress: p ? (p.address || p.name) : null,
    };
  });
}

/** What the payment is for display: an unpaid instalment past its due date is overdue even if nobody flipped the flag. */
function displayPayment(p: any) {
  const unpaid = p.status === "pending" || p.status === "partial" || p.status === "overdue";
  const late = unpaid && p.dueDate && new Date(p.dueDate).getTime() < Date.now() - 24 * 3600 * 1000;
  const daysLate = late ? Math.floor((Date.now() - new Date(p.dueDate).getTime()) / 86400000) : 0;
  return { ...p, status: late && p.status === "pending" ? "overdue" : p.status, daysLate };
}

// ─── Rent-to-Own Agreements ────────────────────────────────────────────────
export const rentToOwnAgreementsRouter = Router();
rentToOwnAgreementsRouter.use(authenticateJWT as any, requireOrg as any);

rentToOwnAgreementsRouter.get("/", async (req: any, res) => {
  try {
    const ids = await ownAgreementIds(req.user.organizationId);
    if (!ids.length) return res.json([]);
    const rows = await db.select().from(rentToOwnAgreements).where(inArray(rentToOwnAgreements.id, ids)).orderBy(desc(rentToOwnAgreements.createdAt));
    res.json(await enrich(rows));
  } catch (err) { fail(res, err, "list agreements"); }
});

rentToOwnAgreementsRouter.get("/:id", async (req: any, res) => {
  try {
    const a = await ownAgreement(req.params.id, req.user.organizationId);
    if (!a) return res.status(404).json({ message: "Agreement not found" });
    res.json((await enrich([a]))[0]);
  } catch (err) { fail(res, err, "get agreement"); }
});

/** Equal instalments with the interest on the falling balance split out. The last instalment carries any remainder. */
function buildSchedule(balance: number, monthly: number, months: number, annualRate: number, firstDue: Date) {
  const r = annualRate / 12 / 100;
  const out: { n: number; due: Date; scheduled: number; principal: number; interest: number; note?: string }[] = [];
  let left = balance;
  for (let i = 1; i <= months && left > EPS; i++) {
    const interest = round2(left * r);
    let principal = round2(Math.min(left, monthly - interest));
    if (principal <= 0) throw new HttpError(400, "The monthly payment is not even enough to cover the interest. Raise the monthly payment or lower the interest rate.");
    let note: string | undefined;
    if (i === months && left - principal > EPS) { principal = round2(left); note = "Final payment — includes the balance left after the regular instalments"; }
    out.push({ n: i, due: addMonths(firstDue, i - 1), scheduled: round2(principal + interest), principal, interest, note });
    left = round2(left - principal);
  }
  return out;
}

rentToOwnAgreementsRouter.post("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const type = String(b.agreementType ?? "lease_option");
    if (!AGREEMENT_TYPES.includes(type)) return res.status(400).json({ message: `Agreement type must be one of: ${AGREEMENT_TYPES.join(", ")}.` });
    const total = asNum(b.totalPropertyValue);
    const monthly = asNum(b.monthlyPayment);
    const deposit = b.initialDeposit === undefined || b.initialDeposit === "" || b.initialDeposit === null ? 0 : asNum(b.initialDeposit);
    const months = asNum(b.agreementDuration ?? 36);
    const rate = b.interestRate === undefined || b.interestRate === "" || b.interestRate === null ? 0 : asNum(b.interestRate);
    const creditRate = b.rentCreditRate === undefined || b.rentCreditRate === "" || b.rentCreditRate === null ? 0 : asNum(b.rentCreditRate);
    const optionFee = b.optionFee === undefined || b.optionFee === "" || b.optionFee === null ? 0 : asNum(b.optionFee);
    if (!(total > 0) || total > MAX_AMOUNT) return res.status(400).json({ message: "Enter the property value (more than zero)." });
    if (!(monthly > 0) || monthly > MAX_AMOUNT) return res.status(400).json({ message: "Enter the monthly payment (more than zero)." });
    if (Number.isNaN(deposit) || deposit < 0) return res.status(400).json({ message: "The initial deposit cannot be negative." });
    if (Number.isNaN(optionFee) || optionFee < 0) return res.status(400).json({ message: "The option fee cannot be negative." });
    if (!Number.isInteger(months) || months < 1 || months > 600) return res.status(400).json({ message: "Duration must be a whole number of months between 1 and 600." });
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return res.status(400).json({ message: "Interest rate must be between 0 and 100." });
    if (Number.isNaN(creditRate) || creditRate < 0 || creditRate > 100) return res.status(400).json({ message: "Rent credit rate must be between 0 and 100." });
    const optionApplied = b.optionFeeApplied === true || b.optionFeeApplied === "true";
    const upfront = round2(deposit + (optionApplied ? optionFee : 0));
    if (upfront >= total) return res.status(400).json({ message: "The deposit (and option fee, if it counts towards the price) must be less than the property value." });
    const firstDue = b.nextPaymentDue && validDate(b.nextPaymentDue) ? new Date(b.nextPaymentDue) : addMonths(new Date(), 1);
    if (b.nextPaymentDue && !validDate(b.nextPaymentDue)) return res.status(400).json({ message: "The first payment date is not valid." });
    if (b.optionExpiryDate && !validDate(b.optionExpiryDate)) return res.status(400).json({ message: "The option expiry date is not valid." });
    const propertyId = posId(b.propertyId); const tenantId = posId(b.tenantId);
    if (!propertyId || !tenantId) return res.status(400).json({ message: "Choose a property and a tenant." });

    const balance = round2(total - upfront);
    const schedule = b.generateSchedule === false ? [] : buildSchedule(balance, monthly, months, rate, firstDue);

    const created = await db.transaction(async (tx) => {
      const [prop] = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1);
      if (!prop) throw new HttpError(400, "Property not found in your organisation.");
      const [ten] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, orgId))).limit(1);
      if (!ten) throw new HttpError(400, "Tenant not found in your organisation.");
      // the same house cannot be sold twice: lock the property row, then check for a running agreement
      await tx.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId)).for("update");
      const [running] = await tx.select({ id: rentToOwnAgreements.id }).from(rentToOwnAgreements)
        .where(and(eq(rentToOwnAgreements.propertyId, propertyId), inArray(rentToOwnAgreements.status, ["active", "pending"]))).limit(1);
      if (running) throw new HttpError(409, "This property already has a running rent-to-own agreement. Complete or cancel it first.");

      const [a] = await tx.insert(rentToOwnAgreements).values({
        agreementNumber: `RTO-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`,
        propertyId, tenantId, agreementType: type,
        totalPropertyValue: total.toFixed(2), initialDeposit: deposit.toFixed(2), monthlyPayment: monthly.toFixed(2),
        agreementDuration: months, interestRate: rate.toFixed(2),
        totalPaid: upfront.toFixed(2), remainingBalance: balance.toFixed(2),
        nextPaymentDue: firstDue, status: "active",
        terms: clean(b.terms, 10000),
        currency: (clean(b.currency, 3) ?? "KES").toUpperCase(),
        conditions: {
          rentCreditRate: creditRate, optionFee, optionFeeApplied: optionApplied, legalClause: clean(b.legalClause, 100),
          optionExpiryDate: b.optionExpiryDate ? new Date(b.optionExpiryDate).toISOString() : null,
          isNotarized: b.isNotarized === true, escrowAccount: clean(b.escrowAccount, 100), propertyConditionReport: b.propertyConditionReport === true,
        },
      } as any).returning();
      if (schedule.length) {
        await tx.insert(rentToOwnPayments).values(schedule.map(s => ({
          agreementId: a.id, paymentNumber: s.n, scheduledAmount: s.scheduled.toFixed(2), principalAmount: s.principal.toFixed(2),
          interestAmount: s.interest.toFixed(2), dueDate: s.due, status: "pending", notes: s.note ?? null,
        })) as any);
      }
      return a;
    });
    res.status(201).json((await enrich([created]))[0]);
  } catch (err) { fail(res, err, "create agreement"); }
});

rentToOwnAgreementsRouter.patch("/:id", async (req: any, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, any>;
    const orgId: number = req.user.organizationId;
    const updated = await db.transaction(async (tx) => {
      const a = await ownAgreement(req.params.id, orgId, tx, true);
      if (!a) throw new HttpError(404, "Agreement not found");
      if (a.status === "completed") throw new HttpError(409, "A completed agreement cannot be changed.");
      const set: Record<string, any> = {};
      if (b.status !== undefined && b.status !== a.status) {
        const st = String(b.status);
        if (st === "completed") throw new HttpError(400, "An agreement completes by itself when the balance reaches zero.");
        if (!AGREEMENT_STATUSES_EDITABLE.includes(st)) throw new HttpError(400, `Status must be one of: ${AGREEMENT_STATUSES_EDITABLE.join(", ")}.`);
        if (st === "active") {
          const [other] = await tx.select({ id: rentToOwnAgreements.id }).from(rentToOwnAgreements)
            .where(and(eq(rentToOwnAgreements.propertyId, a.propertyId), inArray(rentToOwnAgreements.status, ["active", "pending"]), sql`${rentToOwnAgreements.id} <> ${a.id}`)).limit(1);
          if (other) throw new HttpError(409, "Another agreement is already running on this property.");
        }
        set.status = st;
      }
      if (b.terms !== undefined) set.terms = clean(b.terms, 10000);
      if (b.nextPaymentDue !== undefined) { if (!validDate(b.nextPaymentDue)) throw new HttpError(400, "The next payment date is not valid."); set.nextPaymentDue = new Date(b.nextPaymentDue); }
      // the money (price, deposit, totals, balance) is never edited directly: it follows the payments
      const c = { ...((a.conditions ?? {}) as Record<string, any>) };
      let condChanged = false;
      if (b.rentCreditRate !== undefined) { const r = asNum(b.rentCreditRate); if (Number.isNaN(r) || r < 0 || r > 100) throw new HttpError(400, "Rent credit rate must be between 0 and 100."); c.rentCreditRate = r; condChanged = true; }
      if (b.optionExpiryDate !== undefined) { if (b.optionExpiryDate && !validDate(b.optionExpiryDate)) throw new HttpError(400, "The option expiry date is not valid."); c.optionExpiryDate = b.optionExpiryDate ? new Date(b.optionExpiryDate).toISOString() : null; condChanged = true; }
      for (const k of ["legalClause", "escrowAccount"]) if (b[k] !== undefined) { c[k] = clean(b[k], 100); condChanged = true; }
      for (const k of ["isNotarized", "propertyConditionReport"]) if (b[k] !== undefined) { c[k] = b[k] === true; condChanged = true; }
      if (condChanged) set.conditions = c;
      if (Object.keys(set).length === 0) return a;
      set.updatedAt = new Date();
      const [row] = await tx.update(rentToOwnAgreements).set(set as any).where(eq(rentToOwnAgreements.id, a.id)).returning();
      return row;
    });
    res.json((await enrich([updated]))[0]);
  } catch (err) { fail(res, err, "update agreement"); }
});

// Builds the whole instalment schedule for an agreement that has none yet (agreements made before the schedule was automatic).
rentToOwnAgreementsRouter.post("/:id/generate-schedule", async (req: any, res) => {
  try {
    const out = await db.transaction(async (tx) => {
      const a = await ownAgreement(req.params.id, req.user.organizationId, tx, true);
      if (!a) throw new HttpError(404, "Agreement not found");
      if (a.status !== "active") throw new HttpError(409, `This agreement is ${a.status}.`);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(rentToOwnPayments).where(eq(rentToOwnPayments.agreementId, a.id));
      if (n > 0) throw new HttpError(409, "This agreement already has a payment schedule.");
      const sched = buildSchedule(Number(a.remainingBalance), Number(a.monthlyPayment), a.agreementDuration, Number(a.interestRate ?? 0), new Date(a.nextPaymentDue));
      if (!sched.length) throw new HttpError(409, "Nothing is left to schedule.");
      await tx.insert(rentToOwnPayments).values(sched.map(s => ({
        agreementId: a.id, paymentNumber: s.n, scheduledAmount: s.scheduled.toFixed(2), principalAmount: s.principal.toFixed(2),
        interestAmount: s.interest.toFixed(2), dueDate: s.due, status: "pending", notes: s.note ?? null,
      })) as any);
      return sched.length;
    });
    res.status(201).json({ created: out });
  } catch (err) { fail(res, err, "generate schedule"); }
});

// ─── Rent-to-Own Payments ─────────────────────────────────────────────────
export const rentToOwnPaymentsRouter = Router();
rentToOwnPaymentsRouter.use(authenticateJWT as any, requireOrg as any);

async function ownPayment(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [p] = await db.select().from(rentToOwnPayments).where(eq(rentToOwnPayments.id, n)).limit(1);
  if (!p) return null;
  const a = await ownAgreement(p.agreementId, orgId);
  return a ? p : null;
}

rentToOwnPaymentsRouter.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    if (req.query.agreementId !== undefined) {
      const a = await ownAgreement(req.query.agreementId, orgId);
      if (!a) return res.json([]);
      return res.json((await db.select().from(rentToOwnPayments).where(eq(rentToOwnPayments.agreementId, a.id)).orderBy(rentToOwnPayments.paymentNumber)).map(displayPayment));
    }
    const ids = await ownAgreementIds(orgId);
    if (!ids.length) return res.json([]);
    res.json((await db.select().from(rentToOwnPayments).where(inArray(rentToOwnPayments.agreementId, ids)).orderBy(rentToOwnPayments.agreementId, rentToOwnPayments.paymentNumber)).map(displayPayment));
  } catch (err) { fail(res, err, "list payments"); }
});

rentToOwnPaymentsRouter.get("/:id", async (req: any, res) => {
  try {
    const p = await ownPayment(req.params.id, req.user.organizationId);
    if (!p) return res.status(404).json({ message: "Payment not found" });
    res.json(displayPayment(p));
  } catch (err) { fail(res, err, "get payment"); }
});

// Adds one more scheduled instalment (a catch-up, a balloon). A payment is only ever "paid" through /process.
rentToOwnPaymentsRouter.post("/", async (req: any, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, any>;
    const scheduled = asNum(b.scheduledAmount);
    const principal = asNum(b.principalAmount);
    const interest = b.interestAmount === undefined || b.interestAmount === "" || b.interestAmount === null ? 0 : asNum(b.interestAmount);
    if (!(scheduled > 0) || !(principal >= 0) || Number.isNaN(interest) || interest < 0) return res.status(400).json({ message: "Enter the scheduled amount and how much of it is principal." });
    if (Math.abs(scheduled - principal - interest) > EPS) return res.status(400).json({ message: "Principal plus interest must add up to the scheduled amount." });
    if (!validDate(b.dueDate)) return res.status(400).json({ message: "Enter the due date." });
    const row = await db.transaction(async (tx) => {
      const a = await ownAgreement(b.agreementId, req.user.organizationId, tx, true);
      if (!a) throw new HttpError(404, "Agreement not found");
      if (a.status !== "active") throw new HttpError(409, `This agreement is ${a.status}; no more payments can be scheduled.`);
      const [open] = await tx.select({ s: sql<string>`coalesce(sum(${rentToOwnPayments.principalAmount} - least(${rentToOwnPayments.principalAmount}, ${rentToOwnPayments.paidAmount})),0)` })
        .from(rentToOwnPayments).where(and(eq(rentToOwnPayments.agreementId, a.id), inArray(rentToOwnPayments.status, ["pending", "partial", "overdue"])));
      if (Number(open.s) + principal > Number(a.remainingBalance) + EPS) {
        throw new HttpError(409, "The scheduled principal would be more than the balance still owing on this agreement.");
      }
      const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${rentToOwnPayments.paymentNumber}),0)` }).from(rentToOwnPayments).where(eq(rentToOwnPayments.agreementId, a.id));
      const [p] = await tx.insert(rentToOwnPayments).values({
        agreementId: a.id, paymentNumber: Number(n) + 1,
        scheduledAmount: scheduled.toFixed(2), principalAmount: principal.toFixed(2), interestAmount: interest.toFixed(2),
        dueDate: new Date(b.dueDate), status: "pending", paymentMethod: clean(b.paymentMethod, 30), notes: clean(b.notes, 2000),
      } as any).returning();
      return p;
    });
    res.status(201).json(displayPayment(row));
  } catch (err) { fail(res, err, "add payment"); }
});

rentToOwnPaymentsRouter.post("/:id/process", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const result = await db.transaction(async (tx) => {
      const found = await ownPayment(req.params.id, orgId);
      if (!found) throw new HttpError(404, "Payment not found");
      // lock the agreement first, then the payment: two people processing at once are taken one after the other
      const a = await ownAgreement(found.agreementId, orgId, tx, true);
      if (!a) throw new HttpError(404, "Agreement not found");
      const [p] = await tx.select().from(rentToOwnPayments).where(eq(rentToOwnPayments.id, found.id)).for("update").limit(1);
      if (a.status !== "active") throw new HttpError(409, `This agreement is ${a.status}; payments can no longer be taken.`);
      if (p.status === "paid") throw new HttpError(409, "This payment has already been processed.", "ALREADY_PAID");

      const scheduled = Number(p.scheduledAmount);
      const already = Number(p.paidAmount ?? 0);
      const outstanding = round2(scheduled - already);
      const paidNow = b.paidAmount === undefined || b.paidAmount === "" || b.paidAmount === null ? outstanding : asNum(b.paidAmount);
      if (!(paidNow > 0)) throw new HttpError(400, "Enter the amount received (more than zero).");
      if (paidNow > outstanding + EPS) throw new HttpError(409, `That is more than the ${outstanding.toLocaleString()} still due on this instalment.`, "OVERPAYMENT");
      if (b.paidDate && !validDate(b.paidDate)) throw new HttpError(400, "The payment date is not valid.");
      const method = clean(b.paymentMethod, 30) ?? "bank_transfer";
      const txnId = clean(b.transactionId, 100) ?? `TXN-${Date.now()}`;
      const [dup] = await tx.select({ id: rentToOwnPayments.id }).from(rentToOwnPayments)
        .where(and(eq(rentToOwnPayments.agreementId, a.id), eq(rentToOwnPayments.transactionId, txnId), sql`${rentToOwnPayments.id} <> ${p.id}`)).limit(1);
      if (dup) throw new HttpError(409, `Transaction reference ${txnId} is already used on another payment of this agreement.`, "DUPLICATE");

      const newPaid = round2(already + paidNow);
      const fullyPaid = newPaid >= scheduled - EPS;
      // only the principal share lowers what is owed; the interest share is income, not a reduction of the price
      const principalShare = scheduled > 0 ? round2(paidNow * Number(p.principalAmount) / scheduled) : paidNow;
      const when = b.paidDate ? new Date(b.paidDate) : new Date();

      const [row] = await tx.update(rentToOwnPayments).set({
        paidAmount: newPaid.toFixed(2), paidDate: when, status: fullyPaid ? "paid" : "partial",
        paymentMethod: method, transactionId: txnId, updatedAt: new Date(),
      } as any).where(eq(rentToOwnPayments.id, p.id)).returning();

      const remaining = Math.max(0, round2(Number(a.remainingBalance) - principalShare));
      const done = remaining <= EPS;
      const [nextDue] = await tx.select({ d: sql<Date | null>`min(${rentToOwnPayments.dueDate})` }).from(rentToOwnPayments)
        .where(and(eq(rentToOwnPayments.agreementId, a.id), inArray(rentToOwnPayments.status, ["pending", "partial", "overdue"])));
      const [agreement] = await tx.update(rentToOwnAgreements).set({
        totalPaid: round2(Number(a.totalPaid ?? 0) + principalShare).toFixed(2),
        remainingBalance: remaining.toFixed(2),
        status: done ? "completed" : "active",
        completionDate: done ? new Date() : null,
        ...(nextDue?.d ? { nextPaymentDue: new Date(nextDue.d as any) } : {}),
        updatedAt: new Date(),
      } as any).where(eq(rentToOwnAgreements.id, a.id)).returning();

      // cash received → the books (rent-to-own receipts were never posted before)
      const [prop] = await tx.select({ id: properties.id }).from(properties).where(eq(properties.id, a.propertyId));
      await postSaleReceipt(tx, {
        orgId, kind: "RTO", key: `${p.id}-${Math.round(newPaid * 100)}`, amount: paidNow, currency: a.currency ?? "KES",
        propertyId: prop?.id ?? null, date: when, actorUserId: req.user.id,
        label: `Rent-to-own payment #${p.paymentNumber} — ${a.agreementNumber}`,
      });
      return { payment: row, agreement };
    });
    res.json({ ...displayPayment(result.payment), agreement: (await enrich([result.agreement]))[0] });
  } catch (err) { fail(res, err, "process payment"); }
});

// ─── Ownership Certificates ───────────────────────────────────────────────
export const ownershipCertificatesRouter = Router();
ownershipCertificatesRouter.use(authenticateJWT as any, requireOrg as any);

const OWNERSHIP_TYPES = ["full", "partial", "shared"];
const ACQUISITION_TYPES = ["rent_to_own", "purchase", "inheritance", "gift", "other"];

async function ownCertificate(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [row] = await db.select({ c: ownershipCertificates }).from(ownershipCertificates)
    .innerJoin(properties, eq(properties.id, ownershipCertificates.propertyId))
    .where(and(eq(ownershipCertificates.id, n), eq(properties.organizationId, orgId))).limit(1);
  return row?.c ?? null;
}

ownershipCertificatesRouter.get("/", async (req: any, res) => {
  try {
    const ids = await orgPropertyIds(req.user.organizationId);
    if (!ids.length) return res.json([]);
    res.json(await db.select().from(ownershipCertificates).where(inArray(ownershipCertificates.propertyId, ids)).orderBy(desc(ownershipCertificates.createdAt)));
  } catch (err) { fail(res, err, "list certificates"); }
});

ownershipCertificatesRouter.get("/:id", async (req: any, res) => {
  try {
    const c = await ownCertificate(req.params.id, req.user.organizationId);
    if (!c) return res.status(404).json({ message: "Certificate not found" });
    res.json(c);
  } catch (err) { fail(res, err, "get certificate"); }
});

// Issued from a completed agreement, once: a second click used to mint a second certificate for the same house.
ownershipCertificatesRouter.post("/generate/:agreementId", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const cert = await db.transaction(async (tx) => {
      const a = await ownAgreement(req.params.agreementId, orgId, tx, true);
      if (!a) throw new HttpError(404, "Agreement not found");
      if (a.status !== "completed") throw new HttpError(409, "The agreement must be fully paid (completed) before an ownership certificate can be issued.");
      const [dup] = await tx.select({ id: ownershipCertificates.id }).from(ownershipCertificates)
        .where(and(eq(ownershipCertificates.propertyId, a.propertyId), eq(ownershipCertificates.ownerId, a.tenantId), eq(ownershipCertificates.acquisitionType, "rent_to_own"), eq(ownershipCertificates.status, "active"))).limit(1);
      if (dup) throw new HttpError(409, "An ownership certificate has already been issued for this agreement.", "DUPLICATE");
      const [row] = await tx.insert(ownershipCertificates).values({
        certificateNumber: `OWN-${a.propertyId}-${Date.now().toString(36).toUpperCase()}`,
        propertyId: a.propertyId, ownerId: a.tenantId, ownershipType: "full", ownershipPercentage: "100.00",
        acquisitionType: "rent_to_own", acquisitionDate: a.completionDate ?? new Date(),
        isVerified: true, verificationDate: new Date(), verifiedBy: req.user.id, complianceStatus: "approved", status: "active",
        notes: `Issued from rent-to-own agreement ${a.agreementNumber}`,
      } as any).returning();
      return row;
    });
    res.status(201).json(cert);
  } catch (err) { fail(res, err, "generate certificate"); }
});

ownershipCertificatesRouter.post("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const oType = String(b.ownershipType ?? "full");
    const acq = String(b.acquisitionType ?? "other");
    const pct = b.ownershipPercentage === undefined || b.ownershipPercentage === "" ? 100 : asNum(b.ownershipPercentage);
    if (!OWNERSHIP_TYPES.includes(oType)) return res.status(400).json({ message: `Ownership type must be one of: ${OWNERSHIP_TYPES.join(", ")}.` });
    if (!ACQUISITION_TYPES.includes(acq)) return res.status(400).json({ message: `Acquisition type must be one of: ${ACQUISITION_TYPES.join(", ")}.` });
    if (Number.isNaN(pct) || pct <= 0 || pct > 100) return res.status(400).json({ message: "Ownership percentage must be more than 0 and at most 100." });
    if (!validDate(b.acquisitionDate)) return res.status(400).json({ message: "Enter the acquisition date." });
    const propertyId = posId(b.propertyId); const ownerId = posId(b.ownerId);
    if (!propertyId || !ownerId) return res.status(400).json({ message: "Choose the property and the owner." });
    const [prop] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!prop) return res.status(400).json({ message: "Property not found in your organisation." });
    const [owner] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, ownerId), eq(tenants.organizationId, orgId))).limit(1);
    if (!owner) return res.status(400).json({ message: "Owner not found in your organisation." });
    const [row] = await db.insert(ownershipCertificates).values({
      certificateNumber: `OWN-${propertyId}-${Date.now().toString(36).toUpperCase()}`,
      propertyId, ownerId, ownershipType: oType, ownershipPercentage: pct.toFixed(2), acquisitionType: acq,
      titleDeedNumber: clean(b.titleDeedNumber, 100), registrationNumber: clean(b.registrationNumber, 100),
      legalDescription: clean(b.legalDescription, 5000), acquisitionDate: new Date(b.acquisitionDate),
      expiryDate: b.expiryDate && validDate(b.expiryDate) ? new Date(b.expiryDate) : null,
      notes: clean(b.notes, 2000), status: "active",
    } as any).returning();
    res.status(201).json(row);
  } catch (err) { fail(res, err, "create certificate"); }
});

// ─── Property Management Agreements ──────────────────────────────────────
export const propertyManagementAgreementsRouter = Router();
propertyManagementAgreementsRouter.use(authenticateJWT as any, requireOrg as any);

async function ownMgmtAgreement(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [row] = await db.select({ a: propertyManagementAgreements }).from(propertyManagementAgreements)
    .innerJoin(properties, eq(properties.id, propertyManagementAgreements.propertyId))
    .where(and(eq(propertyManagementAgreements.id, n), eq(properties.organizationId, orgId))).limit(1);
  return row?.a ?? null;
}

propertyManagementAgreementsRouter.get("/", async (req: any, res) => {
  try {
    const ids = await orgPropertyIds(req.user.organizationId);
    if (!ids.length) return res.json([]);
    res.json(await db.select().from(propertyManagementAgreements).where(inArray(propertyManagementAgreements.propertyId, ids)).orderBy(desc(propertyManagementAgreements.createdAt)));
  } catch (err) { fail(res, err, "list management agreements"); }
});

propertyManagementAgreementsRouter.get("/:id", async (req: any, res) => {
  try {
    const a = await ownMgmtAgreement(req.params.id, req.user.organizationId);
    if (!a) return res.status(404).json({ message: "Agreement not found" });
    res.json(a);
  } catch (err) { fail(res, err, "get management agreement"); }
});

propertyManagementAgreementsRouter.post("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const propertyId = posId(b.propertyId); const ownerId = posId(b.ownerId);
    if (!propertyId || !ownerId) return res.status(400).json({ message: "Choose the property and the owner." });
    const [prop] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!prop) return res.status(400).json({ message: "Property not found in your organisation." });
    const [owner] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, ownerId), eq(tenants.organizationId, orgId))).limit(1);
    if (!owner) return res.status(400).json({ message: "Owner not found in your organisation." });
    const rate = asNum(b.managementFeeRate);
    if (!clean(b.managementType, 30) || !clean(b.managementFeeType, 20) || Number.isNaN(rate) || rate < 0) return res.status(400).json({ message: "Enter the management type, the fee type and a fee rate." });
    if (b.managementFeeType === "percentage" && rate > 100) return res.status(400).json({ message: "A percentage fee cannot be more than 100." });
    if (!validDate(b.startDate)) return res.status(400).json({ message: "Enter the start date." });
    if (b.endDate && (!validDate(b.endDate) || new Date(b.endDate) < new Date(b.startDate))) return res.status(400).json({ message: "The end date cannot be before the start date." });
    const [row] = await db.insert(propertyManagementAgreements).values({
      agreementNumber: `PMA-${propertyId}-${Date.now().toString(36).toUpperCase()}`,
      propertyId, ownerId, managementType: String(b.managementType).slice(0, 30), managementFeeType: String(b.managementFeeType).slice(0, 20),
      managementFeeRate: rate.toFixed(2), startDate: new Date(b.startDate), endDate: b.endDate ? new Date(b.endDate) : null,
      servicesIncluded: b.servicesIncluded ?? null, terms: clean(b.terms, 10000), status: "active",
      currency: (clean(b.currency, 3) ?? "KES").toUpperCase(),
    } as any).returning();
    res.status(201).json(row);
  } catch (err) { fail(res, err, "create management agreement"); }
});
