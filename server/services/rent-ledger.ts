/**
 * rent-ledger.ts — the ONE place money is applied to a rent invoice or a utility/repair bill.
 *
 * Before this existed, manual "mark paid", STK-push callbacks, C2B (paybill) callbacks and the manager's
 * "match" action each had their own copy of the arithmetic, and they disagreed:
 *   - a repeated callback was counted twice (the idempotency check let the transaction's own row through)
 *   - a part payment through M-Pesa was "partial" but through cash it silently closed the invoice
 *   - only the manual path wrote to the general ledger
 *   - a utility bill was marked paid by ANY amount
 *
 * Every payment now becomes one row in payment_receipts (the table already existed and was unused):
 *   - rent invoices use payment_id = the invoice id
 *   - utility / repair bills use payment_id = -(bill id), so the two id spaces can never collide
 *   - receipt_number is UNIQUE, and M-Pesa payments use the M-Pesa receipt code as their number, so the
 *     same Safaricom confirmation arriving twice (they retry) is rejected by the database, not by hope.
 * "Paid to date" is the sum of those rows. Invoices that were paid before this existed have no rows; they are
 * recognised by status (paid ⇒ fully paid) and by their completed M-Pesa transactions.
 *
 * No schema change: payment_receipts, general_ledger, chart_of_accounts and mpesa_transactions already exist.
 */
import { db } from "../db";
import {
  rentPayments, utilityBills, paymentReceipts, mpesaTransactions, tenants, units,
  chartOfAccounts, generalLedger, users,
} from "@shared/schema";
import { and, eq, ne, sql, inArray, desc } from "drizzle-orm";

export const EPS = 0.01;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type Target = { kind: "rent"; id: number } | { kind: "utility"; id: number };
const ledgerKey = (t: Target) => (t.kind === "rent" ? t.id : -t.id);

/** Business rules the routes turn into HTTP errors. */
export class PaymentRuleError extends Error {
  constructor(public code: "ALREADY_PAID" | "OVERPAYMENT" | "NOT_FOUND" | "BAD_AMOUNT", message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const isSettled = (status: string | null | undefined) => status === "paid" || status === "completed";

/** Sum of everything applied to a bill so far. */
export async function paidToDate(t: Target, opts: { excludeMpesaTxnId?: number } = {}): Promise<number> {
  const key = ledgerKey(t);
  const [rec] = await db.select({ s: sql<string>`coalesce(sum(${paymentReceipts.amount}),0)` }).from(paymentReceipts).where(eq(paymentReceipts.paymentId, key));
  // M-Pesa money that was reconciled BEFORE receipts existed (no receipt row carries its code yet).
  const col = t.kind === "rent" ? mpesaTransactions.rentPaymentId : mpesaTransactions.utilityBillId;
  const conds: any[] = [eq(col, t.id), eq(mpesaTransactions.status, "completed"),
    sql`not exists (select 1 from payment_receipts r where r.receipt_number = ${mpesaTransactions.mpesaReceiptNumber})`];
  if (opts.excludeMpesaTxnId) conds.push(ne(mpesaTransactions.id, opts.excludeMpesaTxnId));
  const [legacy] = await db.select({ s: sql<string>`coalesce(sum(${mpesaTransactions.amount}),0)` }).from(mpesaTransactions).where(and(...conds));
  return round2(money(rec?.s) + money(legacy?.s));
}

/** paid / balance for many rent invoices at once (list screens). */
export async function rentBalances(rows: Array<{ id: number; amount: any; status: string | null }>): Promise<Map<number, { paidAmount: number; balance: number }>> {
  const out = new Map<number, { paidAmount: number; balance: number }>();
  if (rows.length === 0) return out;
  const ids = rows.map(r => r.id);
  const rec = await db.select({ id: paymentReceipts.paymentId, s: sql<string>`sum(${paymentReceipts.amount})` })
    .from(paymentReceipts).where(inArray(paymentReceipts.paymentId, ids)).groupBy(paymentReceipts.paymentId);
  const recMap = new Map(rec.map(r => [r.id, money(r.s)]));
  const legacy = await db.select({ id: mpesaTransactions.rentPaymentId, s: sql<string>`sum(${mpesaTransactions.amount})` })
    .from(mpesaTransactions)
    .where(and(inArray(mpesaTransactions.rentPaymentId, ids), eq(mpesaTransactions.status, "completed"),
      sql`not exists (select 1 from payment_receipts r where r.receipt_number = ${mpesaTransactions.mpesaReceiptNumber})`))
    .groupBy(mpesaTransactions.rentPaymentId);
  const legMap = new Map(legacy.map(r => [r.id as number, money(r.s)]));
  for (const r of rows) {
    const due = money(r.amount);
    const paid = isSettled(r.status) ? due : Math.min(due, round2((recMap.get(r.id) ?? 0) + (legMap.get(r.id) ?? 0)));
    out.set(r.id, { paidAmount: round2(paid), balance: round2(Math.max(0, due - paid)) });
  }
  return out;
}

export async function rentBalance(payment: { id: number; amount: any; status: string | null }) {
  return (await rentBalances([payment])).get(payment.id)!;
}

/** Same for utility / repair bills (amount is a varchar on that table). */
export async function utilityBalances(rows: Array<{ id: number; amount: any; status: string | null }>): Promise<Map<number, { paidAmount: number; balance: number }>> {
  const out = new Map<number, { paidAmount: number; balance: number }>();
  if (rows.length === 0) return out;
  const keys = rows.map(r => -r.id);
  const rec = await db.select({ id: paymentReceipts.paymentId, s: sql<string>`sum(${paymentReceipts.amount})` })
    .from(paymentReceipts).where(inArray(paymentReceipts.paymentId, keys)).groupBy(paymentReceipts.paymentId);
  const recMap = new Map(rec.map(r => [-r.id, money(r.s)]));
  const legacy = await db.select({ id: mpesaTransactions.utilityBillId, s: sql<string>`sum(${mpesaTransactions.amount})` })
    .from(mpesaTransactions)
    .where(and(inArray(mpesaTransactions.utilityBillId, rows.map(r => r.id)), eq(mpesaTransactions.status, "completed"),
      sql`not exists (select 1 from payment_receipts r where r.receipt_number = ${mpesaTransactions.mpesaReceiptNumber})`))
    .groupBy(mpesaTransactions.utilityBillId);
  const legMap = new Map(legacy.map(r => [r.id as number, money(r.s)]));
  for (const r of rows) {
    const due = money(r.amount);
    const paid = isSettled(r.status) ? due : Math.min(due, round2((recMap.get(r.id) ?? 0) + (legMap.get(r.id) ?? 0)));
    out.set(r.id, { paidAmount: round2(paid), balance: round2(Math.max(0, due - paid)) });
  }
  return out;
}

export interface ApplyInput {
  target: Target;
  amount: number;
  method: string;
  /** YYYY-MM-DD */
  paidDate: string;
  /** M-Pesa receipt code, cheque number, bank reference… */
  reference?: string | null;
  /** Provide to make the payment idempotent (M-Pesa receipt code). Manual payments get RCP-… numbers. */
  receiptNumber?: string;
  notes?: string | null;
  /** User recording it; webhooks have none. */
  actorUserId?: string | null;
  /** manual payments are not allowed to exceed the balance; money that really arrived (M-Pesa) is accepted. */
  allowOverpay?: boolean;
  /** Post to the general ledger (rent only). */
  postToLedger?: boolean;
}

export interface ApplyResult {
  applied: boolean;
  /** why nothing was applied */
  reason?: "duplicate" | "already_paid";
  status: string;
  paidAmount: number;
  balance: number;
  overpaid: number;
  fullyPaid: boolean;
  receipt?: { receiptNumber: string; amount: number; paymentDate: string; paymentMethod: string };
  record: any;
}

/**
 * Apply one payment. Safe to call twice with the same receiptNumber; safe against two payments racing for the
 * same invoice (the invoice row is locked for the duration).
 */
export async function applyPayment(input: ApplyInput): Promise<ApplyResult> {
  const { target } = input;
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new PaymentRuleError("BAD_AMOUNT", "Amount must be greater than zero.");

  return db.transaction(async (tx) => {
    // 1. lock the bill
    const table: any = target.kind === "rent" ? rentPayments : utilityBills;
    const [bill] = await tx.select().from(table).where(eq(table.id, target.id)).for("update").limit(1);
    if (!bill) throw new PaymentRuleError("NOT_FOUND", target.kind === "rent" ? "Invoice not found." : "Bill not found.");
    const due = money((bill as any).amount);
    const tenantId: number = (bill as any).tenantId;

    const key = ledgerKey(target);
    const noResult = (reason: "duplicate" | "already_paid", fullyPaid: boolean): ApplyResult => ({
      applied: false, reason, status: (bill as any).status, paidAmount: fullyPaid ? due : 0, balance: fullyPaid ? 0 : due, overpaid: 0, fullyPaid, record: bill,
    });

    // 2. a settled bill takes no more money
    if (isSettled((bill as any).status)) {
      if (input.receiptNumber) {
        const dup = await tx.select({ id: paymentReceipts.id }).from(paymentReceipts).where(eq(paymentReceipts.receiptNumber, input.receiptNumber)).limit(1);
        if (dup.length) return noResult("duplicate", true);
      }
      return noResult("already_paid", true);
    }

    // 3. what has been paid before this payment
    const [rec] = await tx.select({ s: sql<string>`coalesce(sum(${paymentReceipts.amount}),0)`, n: sql<string>`count(*)` }).from(paymentReceipts).where(eq(paymentReceipts.paymentId, key));
    const legacyCol = target.kind === "rent" ? mpesaTransactions.rentPaymentId : mpesaTransactions.utilityBillId;
    const [legacy] = await tx.select({ s: sql<string>`coalesce(sum(${mpesaTransactions.amount}),0)` }).from(mpesaTransactions)
      .where(and(eq(legacyCol, target.id), eq(mpesaTransactions.status, "completed"),
        // the transaction being applied right now is already 'completed' by the caller — never count it as "before"
        input.receiptNumber ? ne(mpesaTransactions.mpesaReceiptNumber, input.receiptNumber) : sql`true`,
        sql`not exists (select 1 from payment_receipts r where r.receipt_number = ${mpesaTransactions.mpesaReceiptNumber})`));
    const before = round2(money(rec?.s) + money(legacy?.s));
    const balanceBefore = round2(Math.max(0, due - before));

    if (!input.allowOverpay && amount > balanceBefore + EPS) {
      throw new PaymentRuleError("OVERPAYMENT", `That is more than the balance. The outstanding balance is ${(bill as any).currency ?? "KES"} ${balanceBefore.toLocaleString("en-KE", { minimumFractionDigits: 2 })}.`, { balance: balanceBefore });
    }

    // 4. the receipt — the unique number makes this idempotent
    const seq = Number(rec?.n ?? 0) + 1;
    const label = target.kind === "rent" ? ((bill as any).invoiceNumber ?? `INV${target.id}`) : ((bill as any).billNumber ?? `BILL${target.id}`);
    const receiptNumber = input.receiptNumber ?? `RCP-${label}-${seq}-${Date.now().toString(36).toUpperCase()}`;
    const inserted = await tx.insert(paymentReceipts).values({
      paymentId: key,
      tenantId,
      receiptNumber,
      amount: amount.toFixed(2),
      currency: (bill as any).currency ?? "KES",
      paymentMethod: input.method,
      paymentDate: input.paidDate,
      description: [target.kind === "rent" ? `Rent ${label}` : `Bill ${label}`, input.reference ? `ref ${input.reference}` : null, input.notes].filter(Boolean).join(" · "),
    } as any).onConflictDoNothing({ target: paymentReceipts.receiptNumber }).returning();
    if (inserted.length === 0) return noResult("duplicate", false);

    // 5. totals and status
    const paidAmount = round2(before + amount);
    const balance = round2(Math.max(0, due - paidAmount));
    const overpaid = round2(Math.max(0, paidAmount - due));
    const fullyPaid = paidAmount >= due - EPS;

    const note = [
      input.notes,
      `${input.method.replace("_", " ")} ${(bill as any).currency ?? "KES"} ${amount.toLocaleString("en-KE", { minimumFractionDigits: 2 })} on ${input.paidDate}${input.reference ? ` (ref ${input.reference})` : ""}${fullyPaid ? "" : ` — balance ${balance.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`}`,
      overpaid > EPS ? `OVERPAID by ${overpaid.toLocaleString("en-KE", { minimumFractionDigits: 2 })} — refund the tenant or credit the next invoice` : null,
    ].filter(Boolean);
    const mergedNotes = [(bill as any).notes, ...note].filter(Boolean).join(" | ");

    let record: any;
    if (target.kind === "rent") {
      [record] = await tx.update(rentPayments).set({
        status: fullyPaid ? "paid" : "partial",
        paidDate: fullyPaid ? input.paidDate : ((bill as any).paidDate ?? null),
        paymentMethod: input.method,
        mpesaTransactionId: /^(mpesa|m-pesa)$/i.test(input.method) ? (input.reference ?? (bill as any).mpesaTransactionId ?? null) : ((bill as any).mpesaTransactionId ?? null),
        bankReference: /^(bank|cheque)/i.test(input.method) ? (input.reference ?? (bill as any).bankReference ?? null) : ((bill as any).bankReference ?? null),
        notes: mergedNotes,
        updatedAt: new Date(),
      } as any).where(eq(rentPayments.id, target.id)).returning();
    } else {
      [record] = await tx.update(utilityBills).set({
        // a part payment leaves the bill pending/overdue; only the full amount closes it
        ...(fullyPaid ? { status: "paid", paidDate: new Date(input.paidDate), paymentMethod: input.method } : {}),
        notes: mergedNotes,
      } as any).where(eq(utilityBills.id, target.id)).returning();
    }

    // 6. general ledger (cash received → rental income), exactly the amount received
    if (target.kind === "rent" && input.postToLedger !== false) {
      await postRentReceipt(tx, { tenantId, invoiceLabel: label, receiptNumber, amount, currency: (bill as any).currency ?? "KES", paidDate: input.paidDate, actorUserId: input.actorUserId ?? null });
    }

    return {
      applied: true, status: (record as any).status, paidAmount: Math.min(paidAmount, due), balance, overpaid, fullyPaid,
      receipt: { receiptNumber, amount, paymentDate: input.paidDate, paymentMethod: input.method },
      record,
    };
  });
}

async function postRentReceipt(tx: any, p: { tenantId: number; invoiceLabel: string; receiptNumber: string; amount: number; currency: string; paidDate: string; actorUserId: string | null }) {
  const [tenant] = await tx.select({ organizationId: tenants.organizationId, unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, p.tenantId)).limit(1);
  const orgId = tenant?.organizationId;
  if (!orgId) return;
  let accounts = await tx.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, orgId));
  if (accounts.length === 0) {
    // The standard chart is only created when somebody first opens the accounts screen — until then every receipt of a
    // new organisation silently skipped the ledger and the books drifted from the cash actually collected.
    try {
      const { SEED_ACCOUNTS } = await import("../routes/enterprise-finance-routes");
      const { storage } = await import("../storage");
      await storage.seedChartOfAccounts(orgId, SEED_ACCOUNTS);
      accounts = await tx.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, orgId));
    } catch (e) { console.warn(`[ledger] could not seed the chart of accounts for org ${orgId}:`, e); }
  }
  const cash = accounts.find((a: any) => a.accountName === "Cash & Bank");
  const income = accounts.find((a: any) => a.accountName === "Rental Income");
  if (!cash || !income) { console.warn(`[ledger] org ${orgId} has no "Cash & Bank"/"Rental Income" account — receipt ${p.receiptNumber} not posted`); return; }

  // createdBy is NOT NULL → the user recording it, else an administrator of the organisation (webhooks have no user)
  let createdBy = p.actorUserId;
  if (!createdBy) {
    const [admin] = await tx.select({ id: users.id }).from(users).where(and(eq(users.organizationId, orgId), inArray(users.role, ["admin", "manager"]))).orderBy(sql`case when ${users.role} = 'admin' then 0 else 1 end`).limit(1);
    createdBy = admin?.id ?? null;
  }
  if (!createdBy) { console.warn(`[ledger] org ${orgId} has no user to attribute receipt ${p.receiptNumber} to — not posted`); return; }

  let propertyId: number | null = null;
  if (tenant.unitId) { const [u] = await tx.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1); propertyId = u?.propertyId ?? null; }

  const txDate = new Date(`${p.paidDate}T12:00:00Z`);
  const common = {
    organizationId: orgId, createdBy, propertyId, unitId: tenant.unitId ?? null,
    description: `Rent received: ${p.invoiceLabel}`, reference: `GL-RENT-${p.invoiceLabel}`,
    transactionDate: txDate, fiscalYear: txDate.getUTCFullYear(), fiscalPeriod: txDate.getUTCMonth() + 1, currency: p.currency,
  };
  await tx.insert(generalLedger).values([
    { ...common, transactionId: `GL-RENT-${p.invoiceLabel}-${p.receiptNumber}-DR`, accountId: cash.id, debitAmount: p.amount.toFixed(2), creditAmount: "0.00" },
    { ...common, transactionId: `GL-RENT-${p.invoiceLabel}-${p.receiptNumber}-CR`, accountId: income.id, debitAmount: "0.00", creditAmount: p.amount.toFixed(2) },
  ] as any).onConflictDoNothing();
}

/** Receipts for one bill, newest first (staff view and the tenant's own history). */
export async function receiptsFor(t: Target) {
  return db.select().from(paymentReceipts).where(eq(paymentReceipts.paymentId, ledgerKey(t))).orderBy(desc(paymentReceipts.id));
}

/** Today in Nairobi as YYYY-MM-DD — "today" for a payment recorded at 00:30 EAT must not be yesterday's UTC date. */
export function todayEAT(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** A manual payment date must be a real date and not in the future (a day of slack for time zones). */
export function validPaidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return d.getTime() <= Date.now() + 36 * 3600_000;
}

// ── Owner / landlord reporting ───────────────────────────────────────────────────────────────────────────────────────
// "Income" for an owner is the money that actually arrived, on the day it arrived — one receipt per payment. Invoices
// that were settled BEFORE receipts existed (older data) have no receipt row, so they count in full at their paid date.

export type CashScope = { propertyIds: number[] } | { orgId: number };
const scopeJoin   = (sc: CashScope) => ("orgId" in sc ? sql`` : sql`join units u on u.id = t.unit_id`);
const scopeFilter = (sc: CashScope) => ("orgId" in sc ? sql`t.organization_id = ${sc.orgId}` : sql`u.property_id in (${sql.join(sc.propertyIds.map(i => sql`${i}`), sql`, `)})`);
const RENT_CASH_SQL = (sc: CashScope) => sql`
  select d, amt from (
    select r.payment_date::date as d, r.amount::numeric as amt
      from payment_receipts r
      join rent_payments rp on rp.id = r.payment_id
      join tenants t on t.id = rp.tenant_id
      ${scopeJoin(sc)}
     where ${scopeFilter(sc)}
    union all
    select coalesce(rp.paid_date, rp.due_date)::date as d, rp.amount::numeric as amt
      from rent_payments rp
      join tenants t on t.id = rp.tenant_id
      ${scopeJoin(sc)}
     where ${scopeFilter(sc)}
       and rp.status in ('paid', 'completed')
       and not exists (select 1 from payment_receipts r where r.payment_id = rp.id)
  ) cash`;
const emptyScope = (sc: CashScope) => "propertyIds" in sc && sc.propertyIds.length === 0;

/** Rent cash received in [from, to] (inclusive, YYYY-MM-DD) across these properties. */
export async function rentReceivedBetween(scope: number[] | CashScope, from: string, to: string): Promise<number> {
  const sc: CashScope = Array.isArray(scope) ? { propertyIds: scope } : scope;
  if (emptyScope(sc)) return 0;
  const r: any = await db.execute(sql`select coalesce(sum(amt), 0) as total from (${RENT_CASH_SQL(sc)}) x where d between ${from}::date and ${to}::date`);
  return round2(money((r.rows ?? r)[0]?.total));
}

/** Rent cash received per calendar month ("YYYY-MM" → amount) in [from, to]. */
export async function rentReceivedByMonth(scope: number[] | CashScope, from: string, to: string): Promise<Record<string, number>> {
  const sc: CashScope = Array.isArray(scope) ? { propertyIds: scope } : scope;
  if (emptyScope(sc)) return {};
  const r: any = await db.execute(sql`select to_char(d, 'YYYY-MM') as ym, sum(amt) as total from (${RENT_CASH_SQL(sc)}) x where d between ${from}::date and ${to}::date group by 1`);
  return Object.fromEntries(((r.rows ?? r) as any[]).map(x => [x.ym, round2(money(x.total))]));
}

/** What tenants of these properties still owe on unsettled rent invoices (balance = invoice − received). */
export async function rentOutstanding(scope: number[] | CashScope, onlyStatus?: string[]): Promise<{ total: number; count: number }> {
  const sc: CashScope = Array.isArray(scope) ? { propertyIds: scope } : scope;
  if (emptyScope(sc)) return { total: 0, count: 0 };
  const statuses = onlyStatus ?? ["pending", "overdue", "partial"];
  const r: any = await db.execute(sql`
    select coalesce(sum(bal), 0) as total, count(*) filter (where bal > 0.005) as n from (
      select greatest(rp.amount::numeric - coalesce((select sum(r.amount) from payment_receipts r where r.payment_id = rp.id), 0), 0) as bal
        from rent_payments rp
        join tenants t on t.id = rp.tenant_id
        ${scopeJoin(sc)}
       where ${scopeFilter(sc)}
         and rp.status in (${sql.join(statuses.map(x => sql`${x}`), sql`, `)})
    ) b`);
  const row = (r.rows ?? r)[0];
  return { total: round2(money(row?.total)), count: Number(row?.n ?? 0) };
}
