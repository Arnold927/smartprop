/**
 * lease-lifecycle.ts — the rules behind /api/leases, in one place so the routes and the daily scheduler agree.
 *
 *  - date helpers (a "date" must be a real calendar date; the old regex accepted 2026-02-31 and then the insert 500'd)
 *  - landlord ownership (every endpoint that takes a lease id must apply it, not just GET)
 *  - the security-deposit ledger: one chain per tenancy (a renewal inherits the deposit held on its predecessor),
 *    balance = signed SUM of the rows, every write under a row lock so two staff members cannot both refund the
 *    same deposit
 *  - ending a tenancy (terminate / scheduled termination) as ONE transaction
 *  - move-out settlement: deposit held − unpaid rent − unpaid utilities − damage deductions → refund
 *
 * No schema change: leases, lease_events, deposit_transactions, payment_receipts already hold everything.
 */
import { db } from "../db";
import {
  leases, leaseEvents, depositTransactions, tenants, units, properties, users,
  rentPayments, utilityBills, paymentReceipts, propertyInspections,
} from "@shared/schema";
import { and, eq, ne, or, inArray, sql, desc, lte, gte, like } from "drizzle-orm";
import { applyPayment, rentBalances, utilityBalances, todayEAT, round2, money, EPS } from "./rent-ledger";

/** A rule the route turns into an HTTP error. */
export class LeaseRuleError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
/** start + N calendar months, minus one day: a 12-month lease starting 1 Jan ends 31 Dec. */
export function termEnd(start: string, months: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);          // 31 Jan + 1 month → 28/29 Feb, not 3 March
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function monthsBetween(start: string, end: string): number {
  const days = (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000 + 1;
  return Math.max(1, Math.round(days / 30.4375));
}
export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

// ── ownership ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A landlord only ever touches leases on properties they own (same rule as /api/properties and inspections). */
export async function landlordOwns(userId: string, orgId: number, propertyId: number | null | undefined): Promise<boolean> {
  if (!propertyId) return false;
  const [p] = await db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))).limit(1);
  return !!p;
}

/** Org-scoped lease; for a landlord that does not own it the answer is "not found" (no existence leak). */
export async function loadLease(user: { id: string; role: string; organizationId: number }, leaseId: number) {
  if (!Number.isInteger(leaseId)) throw new LeaseRuleError(400, "Invalid lease id");
  const [lease] = await db.select().from(leases).where(and(eq(leases.id, leaseId), eq(leases.organizationId, user.organizationId))).limit(1);
  if (!lease) throw new LeaseRuleError(404, "Lease not found");
  if (user.role === "landlord" && !(await landlordOwns(user.id, user.organizationId, lease.propertyId))) throw new LeaseRuleError(404, "Lease not found");
  return lease;
}

/** Brand-new lease numbers must not repeat even after deletions or two simultaneous creates. */
export async function nextLeaseNumber(orgId: number): Promise<string> {
  const yr = new Date().getFullYear();
  const prefix = `LSE-${yr}-${orgId}-`;
  const [row] = await db.select({ n: sql<number>`coalesce(max(cast(split_part(${leases.leaseNumber}, '-', 4) as integer)), 0)` })
    .from(leases).where(and(eq(leases.organizationId, orgId), like(leases.leaseNumber, `${prefix}%`), sql`${leases.leaseNumber} ~ ${`^LSE-${yr}-${orgId}-[0-9]+$`}`));
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}
export const isUniqueViolation = (e: any) => (e?.code ?? e?.cause?.code) === "23505";

export async function appendEvent(tx: any, o: { leaseId: number; tenantId: number; orgId: number; eventType: string; description: string; performedBy?: string | null; metadata?: Record<string, unknown>; ip?: string | null }) {
  await tx.insert(leaseEvents).values({
    leaseId: o.leaseId, tenantId: o.tenantId, organizationId: o.orgId, eventType: o.eventType, description: o.description,
    performedBy: o.performedBy ?? null, metadata: o.metadata ?? {}, ipAddress: o.ip ?? null,
  });
}

// ── placement rules ─────────────────────────────────────────────────────────────────────────────────────────────
/** Who else holds this unit? A second tenant / second live lease on the same unit is a double booking. */
export async function unitConflict(orgId: number, unitId: number, tenantId: number, ignoreLeaseIds: number[] = []): Promise<string | null> {
  const [other] = await db.select({ id: tenants.id, first: tenants.firstName, last: tenants.lastName }).from(tenants)
    .where(and(eq(tenants.organizationId, orgId), eq(tenants.unitId, unitId), ne(tenants.id, tenantId), inArray(tenants.status, ["active", "pending"]))).limit(1);
  if (other) return `That unit is occupied by ${`${other.first ?? ""} ${other.last ?? ""}`.trim() || "another tenant"}. End their tenancy first.`;
  const conds: any[] = [eq(leases.organizationId, orgId), eq(leases.unitId, unitId), ne(leases.tenantId, tenantId), inArray(leases.status, ["active", "pending_signature"])];
  if (ignoreLeaseIds.length) conds.push(sql`${leases.id} not in (${sql.join(ignoreLeaseIds.map(i => sql`${i}`), sql`,`)})`);
  const [lease] = await db.select({ n: leases.leaseNumber }).from(leases).where(and(...conds)).limit(1);
  if (lease) return `That unit already has a live lease (${lease.n}) for another tenant.`;
  return null;
}

/** Same tenant, same unit, overlapping dates, both live → the term would be billed twice. */
export async function overlappingLease(orgId: number, tenantId: number, unitId: number | null, start: string, end: string, ignoreLeaseIds: number[] = []): Promise<string | null> {
  const conds: any[] = [
    eq(leases.organizationId, orgId), inArray(leases.status, ["active", "pending_signature"]),
    sql`${leases.startDate} <= ${end}`, sql`${leases.endDate} >= ${start}`,
    unitId ? or(eq(leases.tenantId, tenantId), eq(leases.unitId, unitId)) : eq(leases.tenantId, tenantId),
  ];
  if (ignoreLeaseIds.length) conds.push(sql`${leases.id} not in (${sql.join(ignoreLeaseIds.map(i => sql`${i}`), sql`,`)})`);
  const [l] = await db.select({ n: leases.leaseNumber, s: leases.startDate, e: leases.endDate }).from(leases).where(and(...conds)).limit(1);
  return l ? `Dates overlap lease ${l.n} (${l.s} to ${l.e}).` : null;
}

// ── security-deposit ledger ─────────────────────────────────────────────────────────────────────────────────────
const CREDIT_TYPES = ["received", "adjustment"];
const DEBIT_TYPES = ["refunded", "partial_refund", "forfeited"];

/** This lease plus every predecessor — a renewal inherits the deposit held on the lease it replaces. */
export async function leaseChain(leaseId: number, tx: any = db): Promise<number[]> {
  const ids: number[] = [];
  let cur: number | null = leaseId;
  while (cur && !ids.includes(cur) && ids.length < 50) {
    ids.push(cur);
    const rows: Array<{ p: number | null }> = await tx.select({ p: leases.previousLeaseId }).from(leases).where(eq(leases.id, cur)).limit(1);
    cur = rows[0]?.p ?? null;
  }
  return ids;
}

export async function depositState(leaseId: number, tx: any = db) {
  const chain = await leaseChain(leaseId, tx);
  const rows = await tx.select({ t: depositTransactions.transactionType, s: sql<string>`coalesce(sum(${depositTransactions.amount}),0)` })
    .from(depositTransactions).where(inArray(depositTransactions.leaseId, chain)).groupBy(depositTransactions.transactionType);
  const by: Record<string, number> = {};
  for (const r of rows) by[r.t] = money(r.s);
  const credits = CREDIT_TYPES.reduce((a, t) => a + (by[t] ?? 0), 0);
  const debits = DEBIT_TYPES.reduce((a, t) => a + (by[t] ?? 0), 0);
  return { chain, received: round2(by.received ?? 0), balance: round2(credits - debits), byType: by };
}

async function lockChain(tx: any, chain: number[]) {
  await tx.execute(sql`select id from leases where id in (${sql.join(chain.map(i => sql`${i}`), sql`,`)}) order by id for update`);
}

async function appendDepositRow(tx: any, lease: any, a: { type: string; amount: number; reason: string; reference?: string | null; date: string; userId: string | null }) {
  const st = await depositState(lease.id, tx);
  const signed = CREDIT_TYPES.includes(a.type) ? a.amount : -a.amount;
  const [row] = await tx.insert(depositTransactions).values({
    leaseId: lease.id, tenantId: lease.tenantId, organizationId: lease.organizationId, transactionType: a.type,
    amount: a.amount.toFixed(2), currency: lease.currency, balanceAfter: round2(st.balance + signed).toFixed(2),
    reason: a.reason, reference: a.reference ?? null, transactionDate: a.date, performedBy: a.userId,
  }).returning();
  return { txn: row, balance: round2(st.balance + signed) };
}

/** One deposit movement. Serialised per tenancy: the lease rows are locked while the balance is read and the row written. */
export async function postDeposit(lease: any, a: { type: string; amount: number; reason: string; reference?: string | null; date: string; userId: string | null; ip?: string | null }) {
  const amount = round2(a.amount);
  if (!(amount > 0)) throw new LeaseRuleError(400, "Amount must be greater than zero.");
  if (!isRealDate(a.date)) throw new LeaseRuleError(400, "Transaction date must be a real date (YYYY-MM-DD).");
  if (a.date > addDays(todayEAT(), 1)) throw new LeaseRuleError(400, "Transaction date cannot be in the future.");
  return db.transaction(async (tx) => {
    const chain = await leaseChain(lease.id, tx);
    await lockChain(tx, chain);
    const st = await depositState(lease.id, tx);
    if (a.type === "received") {
      const due = money(lease.securityDeposit);
      if (st.received + amount > due + EPS) {
        throw new LeaseRuleError(400, `That would take the deposit received to ${lease.currency} ${(st.received + amount).toLocaleString()} but the lease deposit is ${lease.currency} ${due.toLocaleString()}. Record a correction as an adjustment, or change the lease deposit first.`);
      }
    }
    if (DEBIT_TYPES.includes(a.type)) {
      if (!["terminated", "expired"].includes(lease.status)) {
        throw new LeaseRuleError(400, lease.status === "renewed"
          ? "This lease was renewed — the deposit now belongs to the renewal lease. Refund or settle it there when that tenancy ends."
          : "A deposit can only be refunded or forfeited once the lease has ended (terminated or expired).");
      }
      if (amount > st.balance + EPS) throw new LeaseRuleError(400, `Cannot ${a.type.replace("_", " ")} ${amount.toLocaleString()} — the deposit balance is only ${st.balance.toLocaleString()}.`, { balance: st.balance });
    }
    const { txn, balance } = await appendDepositRow(tx, lease, a);
    // lease.depositPaidDate follows the first receipt, so the lease screen and compliance reports agree with the ledger
    if (a.type === "received" && !lease.depositPaidDate) await tx.update(leases).set({ depositPaidDate: a.date, updatedAt: new Date() } as any).where(eq(leases.id, lease.id));
    await appendEvent(tx, {
      leaseId: lease.id, tenantId: lease.tenantId, orgId: lease.organizationId, eventType: `deposit_${a.type}`,
      description: `Deposit ${a.type.replace("_", " ")}: ${lease.currency} ${amount.toLocaleString()}. Balance: ${balance.toLocaleString()}. Reason: ${a.reason}`,
      performedBy: a.userId, metadata: { transactionType: a.type, amount, newBalance: balance, reference: a.reference ?? null }, ip: a.ip,
    });
    return { txn, balance };
  });
}

// ── ending a tenancy ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Lease → terminated; tenant → inactive; unit → vacant; tenant login off — in ONE transaction. A tenant who still has
 * another live lease (a renewal that was already activated) and a unit someone else now occupies are left alone.
 * Pending renewal drafts of the ended lease are withdrawn.
 */
export async function endTenancy(leaseId: number, o: { date: string; reason: string; userId: string | null; ip?: string | null; scheduled?: boolean }) {
  const out = await db.transaction(async (tx) => {
    const [lease] = await tx.select().from(leases).where(eq(leases.id, leaseId)).for("update").limit(1);
    if (!lease) throw new LeaseRuleError(404, "Lease not found");
    if (!["active", "expired"].includes(lease.status)) throw new LeaseRuleError(400, "Only active or expired leases can be terminated");

    // a renewal that never started keeps start ≤ end: the tenancy ended before the new term began
    await tx.update(leases).set({ status: "terminated", endDate: o.date < String(lease.startDate) ? String(lease.startDate) : o.date, updatedAt: new Date() } as any).where(eq(leases.id, leaseId));

    const withdrawn = await tx.update(leases).set({ status: "terminated", updatedAt: new Date() } as any)
      .where(and(eq(leases.previousLeaseId, leaseId), inArray(leases.status, ["draft", "pending_signature"]))).returning({ id: leases.id, n: leases.leaseNumber });
    for (const w of withdrawn) await appendEvent(tx, { leaseId: w.id, tenantId: lease.tenantId, orgId: lease.organizationId, eventType: "terminated", description: `Renewal ${w.n} withdrawn because ${lease.leaseNumber} was terminated.`, performedBy: o.userId });

    const [other] = await tx.select({ id: leases.id }).from(leases)
      .where(and(eq(leases.tenantId, lease.tenantId), eq(leases.status, "active"), ne(leases.id, leaseId))).limit(1);
    let userId: string | null = null;
    if (!other) {
      const [t] = await tx.select({ id: tenants.id, userId: tenants.userId, unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, lease.tenantId)).limit(1);
      if (t) {
        await tx.update(tenants).set({ status: "inactive", updatedAt: new Date() } as any).where(eq(tenants.id, t.id));
        if (t.userId) {
          await tx.update(users).set({ isActive: false, deactivatedAt: new Date(), deactivatedBy: o.userId } as any).where(eq(users.id, t.userId));
          userId = t.userId;
        }
      }
      const unitId = lease.unitId ?? t?.unitId ?? null;
      if (unitId != null) {
        const [stillHeld] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.unitId, unitId), inArray(tenants.status, ["active", "pending"]), ne(tenants.id, lease.tenantId))).limit(1);
        if (!stillHeld) await tx.update(units).set({ isOccupied: false } as any).where(eq(units.id, unitId));
      }
    }
    await appendEvent(tx, {
      leaseId, tenantId: lease.tenantId, orgId: lease.organizationId, eventType: "terminated",
      description: `Lease ${lease.leaseNumber} terminated on ${o.date}${o.scheduled ? " (scheduled)" : ""}. Reason: ${o.reason}`,
      performedBy: o.userId, metadata: { reason: o.reason, terminationDate: o.date, scheduled: !!o.scheduled }, ip: o.ip,
    });
    return { lease, userId };
  });
  if (out.userId) {
    try { const { revokeAllUserTokens } = await import("../routes/auth"); await revokeAllUserTokens(out.userId); }
    catch (e) { console.warn(`[leases] could not revoke sessions for user ${out.userId}:`, e); }
  }
  return out.lease;
}

// ── move-out settlement ─────────────────────────────────────────────────────────────────────────────────────────
const UNPAID_RENT = ["pending", "overdue", "partial"];
const UNPAID_BILL = ["pending", "overdue"];

export async function settlementPreview(lease: any) {
  const today = todayEAT();
  const dep = await depositState(lease.id);
  const rentRows = await db.select().from(rentPayments)
    .where(and(eq(rentPayments.tenantId, lease.tenantId), inArray(rentPayments.status, UNPAID_RENT))).orderBy(rentPayments.dueDate, rentPayments.id);
  const rb = await rentBalances(rentRows as any);
  const billRows = await db.select().from(utilityBills)
    .where(and(eq(utilityBills.tenantId, lease.tenantId), inArray(utilityBills.status, UNPAID_BILL))).orderBy(utilityBills.dueDate, utilityBills.id);
  const ub = await utilityBalances(billRows as any);

  const rent = rentRows.map(r => ({ id: r.id, label: r.invoiceNumber ?? `INV${r.id}`, dueDate: String(r.dueDate), balance: rb.get(r.id)?.balance ?? 0 }))
    .filter(r => r.balance > EPS);
  const bills = billRows.map(b => ({ id: b.id, label: b.billNumber ?? `BILL${b.id}`, type: b.utilityType, dueDate: new Date(b.dueDate as any).toISOString().slice(0, 10), balance: ub.get(b.id)?.balance ?? 0 }))
    .filter(b => b.balance > EPS);
  const dueRent = rent.filter(r => r.dueDate <= today), dueBills = bills.filter(b => b.dueDate <= today);
  const sum = (a: Array<{ balance: number }>) => round2(a.reduce((s, x) => s + x.balance, 0));

  const [insp] = await db.select().from(propertyInspections).where(and(
    eq(propertyInspections.organizationId, lease.organizationId), eq(propertyInspections.inspectionType, "move_out"),
    or(eq(propertyInspections.leaseId, lease.id), and(lease.unitId ? eq(propertyInspections.unitId, lease.unitId) : sql`false`, eq(propertyInspections.tenantId, lease.tenantId))),
  )).orderBy(desc(propertyInspections.createdAt)).limit(1);

  const [done] = await db.select({ id: leaseEvents.id, at: leaseEvents.createdAt }).from(leaseEvents).where(and(eq(leaseEvents.leaseId, lease.id), eq(leaseEvents.eventType, "deposit_settled"))).limit(1);

  const held = dep.balance;
  const arrears = round2(Math.min(held, sum(dueRent) + sum(dueBills)));
  const recDamage = insp ? money(insp.recommendedDeduction) : 0;
  const damages = round2(Math.min(Math.max(0, held - arrears), recDamage));
  return {
    leaseId: lease.id, leaseStatus: lease.status, currency: lease.currency,
    canSettle: ["terminated", "expired"].includes(lease.status) && !done,
    alreadySettled: !!done, settledAt: done?.at ?? null,
    depositHeld: held, depositReceived: dep.received,
    unpaidRent: dueRent, unpaidUtilities: dueBills, unpaidRentTotal: sum(dueRent), unpaidUtilitiesTotal: sum(dueBills),
    upcomingInvoices: { count: rent.length - dueRent.length + bills.length - dueBills.length, total: round2(sum(rent) + sum(bills) - sum(dueRent) - sum(dueBills)) },
    inspection: insp ? {
      id: insp.id, number: insp.inspectionNumber, status: insp.status, signedByManager: !!insp.managerSignedAt,
      recommendedDeduction: recDamage, totalIssuesCost: money(insp.totalIssuesCost), issueCount: Array.isArray(insp.issuesFound) ? insp.issuesFound.length : 0,
    } : null,
    suggested: { arrears, damages, refund: round2(Math.max(0, held - arrears - damages)), shortfall: round2(Math.max(0, sum(dueRent) + sum(dueBills) - arrears)) },
  };
}

export interface SettleInput {
  applyToArrears: boolean;
  deductions: Array<{ category: string; amount: number; reason: string }>;
  refund: boolean;
  date: string;
  reference?: string | null;
}

/**
 * Settle the deposit at move-out: unpaid rent/utility bills (oldest first, through the payment ledger so invoices, receipts,
 * the general ledger and every report move together), then damage deductions, then refund the remainder.
 * Receipt numbers are deterministic (DEP-<lease>-R<invoice>), so if the request dies half way, repeating it resumes
 * instead of applying the deposit twice.
 */
export async function settleDeposit(lease: any, input: SettleInput, actorUserId: string | null) {
  if (!["terminated", "expired"].includes(lease.status)) throw new LeaseRuleError(400, "Settle the deposit after the lease has been terminated or has expired.");
  if (!isRealDate(input.date) || input.date > addDays(todayEAT(), 1)) throw new LeaseRuleError(400, "Settlement date must be a real date, not in the future.");

  const pre = await settlementPreview(lease);
  if (pre.alreadySettled) throw new LeaseRuleError(409, "This deposit has already been settled.");
  const held = pre.depositHeld;
  if (!(held > EPS)) throw new LeaseRuleError(400, "There is no deposit held on this lease.");

  const prior = await db.select({ n: paymentReceipts.receiptNumber, a: paymentReceipts.amount }).from(paymentReceipts).where(like(paymentReceipts.receiptNumber, `DEP-${lease.id}-%`));
  const priorRent = round2(prior.filter(p => p.n.startsWith(`DEP-${lease.id}-R`)).reduce((s, p) => s + money(p.a), 0));
  const priorUtil = round2(prior.filter(p => p.n.startsWith(`DEP-${lease.id}-U`)).reduce((s, p) => s + money(p.a), 0));
  let remaining = round2(held - priorRent - priorUtil);

  // explicit deductions are capped at what is left AFTER arrears; arrears take priority (money already owed)
  let rentApplied = priorRent, utilApplied = priorUtil;
  const note = (what: string) => `Security deposit applied to ${what}`;
  if (input.applyToArrears) {
    for (const r of pre.unpaidRent) {
      const amt = round2(Math.min(r.balance, remaining)); if (amt <= EPS) continue;
      const res = await applyPayment({ target: { kind: "rent", id: r.id }, amount: amt, method: "deposit", paidDate: input.date, reference: `Deposit ${lease.leaseNumber}`, receiptNumber: `DEP-${lease.id}-R${r.id}`, notes: note(`rent ${r.label}`), actorUserId, allowOverpay: false });
      if (res.applied) { rentApplied = round2(rentApplied + amt); remaining = round2(remaining - amt); }
    }
    for (const b of pre.unpaidUtilities) {
      const amt = round2(Math.min(b.balance, remaining)); if (amt <= EPS) continue;
      const res = await applyPayment({ target: { kind: "utility", id: b.id }, amount: amt, method: "deposit", paidDate: input.date, reference: `Deposit ${lease.leaseNumber}`, receiptNumber: `DEP-${lease.id}-U${b.id}`, notes: note(`bill ${b.label}`), actorUserId, allowOverpay: false });
      if (res.applied) { utilApplied = round2(utilApplied + amt); remaining = round2(remaining - amt); }
    }
  }
  const deductions: Array<{ category: string; amount: number; reason: string }> = [];
  for (const d of input.deductions) {
    const amt = round2(Math.min(d.amount, remaining)); if (amt <= EPS) continue;
    deductions.push({ category: d.category, amount: amt, reason: d.reason }); remaining = round2(remaining - amt);
  }
  const requested = round2(input.deductions.reduce((s, d) => s + d.amount, 0));
  const deducted = round2(deductions.reduce((s, d) => s + d.amount, 0));

  // ledger rows + event, atomically, under the lock; refuses if somebody else moved the deposit meanwhile
  const result = await db.transaction(async (tx) => {
    const chain = await leaseChain(lease.id, tx);
    await lockChain(tx, chain);
    const st = await depositState(lease.id, tx);
    if (Math.abs(st.balance - held) > EPS) throw new LeaseRuleError(409, "The deposit changed while settling. Review the balance and try again.");
    const [done] = await tx.select({ id: leaseEvents.id }).from(leaseEvents).where(and(eq(leaseEvents.leaseId, lease.id), eq(leaseEvents.eventType, "deposit_settled"))).limit(1);
    if (done) throw new LeaseRuleError(409, "This deposit has already been settled.");

    const ref = input.reference ?? null;
    if (rentApplied > EPS) await appendDepositRow(tx, lease, { type: "forfeited", amount: rentApplied, reason: "Applied to unpaid rent at move-out", reference: ref, date: input.date, userId: actorUserId });
    if (utilApplied > EPS) await appendDepositRow(tx, lease, { type: "forfeited", amount: utilApplied, reason: "Applied to unpaid utility bills at move-out", reference: ref, date: input.date, userId: actorUserId });
    for (const d of deductions) await appendDepositRow(tx, lease, { type: "forfeited", amount: d.amount, reason: `${d.category}: ${d.reason}`, reference: ref, date: input.date, userId: actorUserId });
    let refunded = 0;
    if (input.refund && remaining > EPS) {
      await appendDepositRow(tx, lease, { type: remaining >= held - EPS ? "refunded" : "partial_refund", amount: remaining, reason: "Deposit balance returned to tenant at move-out", reference: ref, date: input.date, userId: actorUserId });
      refunded = remaining;
    }
    const final = await depositState(lease.id, tx);
    await appendEvent(tx, {
      leaseId: lease.id, tenantId: lease.tenantId, orgId: lease.organizationId, eventType: "deposit_settled",
      description: `Deposit settled: held ${lease.currency} ${held.toLocaleString()} → rent ${rentApplied.toLocaleString()}, utilities ${utilApplied.toLocaleString()}, deductions ${deducted.toLocaleString()}, refunded ${refunded.toLocaleString()}.`,
      performedBy: actorUserId,
      metadata: { held, rentApplied, utilApplied, deductions, refunded, balanceAfter: final.balance, inspectionId: pre.inspection?.id ?? null },
    });
    return { refunded, balanceAfter: final.balance };
  });

  const owed = round2(pre.unpaidRentTotal + pre.unpaidUtilitiesTotal - rentApplied - utilApplied);
  return {
    held, rentApplied, utilitiesApplied: utilApplied, deductions, deductionsRequested: requested, refunded: result.refunded,
    retained: result.balanceAfter, shortfall: Math.max(0, owed), cappedDeductions: requested - deducted > EPS, currency: lease.currency,
  };
}

/** Leases ended by an earlier "terminate on <future date>" (and not cancelled since): executed by the daily scheduler on the day. */
export async function dueScheduledTerminations(today: string) {
  return db.select({ id: leases.id, endDate: leases.endDate, n: leases.leaseNumber }).from(leases)
    .where(and(eq(leases.status, "active"), lte(leases.endDate, today as any),
      sql`(select e.event_type from lease_events e where e.lease_id = ${leases.id} and e.event_type in ('termination_scheduled','termination_cancelled') order by e.id desc limit 1) = 'termination_scheduled'`));
}

/** The scheduled termination event of a lease, if one is pending (used to show it and to cancel it). */
export async function pendingTermination(leaseId: number) {
  const [e] = await db.select().from(leaseEvents)
    .where(and(eq(leaseEvents.leaseId, leaseId), inArray(leaseEvents.eventType, ["termination_scheduled", "termination_cancelled"]))).orderBy(desc(leaseEvents.id)).limit(1);
  return e && e.eventType === "termination_scheduled" ? e : null;
}
