/**
 * sale-ledger.ts — general-ledger posting for rent-to-own and diaspora instalments.
 *
 * Before this existed the diaspora route wrote a journal-entry HEADER and then tried to insert its lines without the
 * mandatory line number / currency, so the lines never saved: the header sat there with totals and nothing under it,
 * and the books never saw the money. It also posted on every payment (pending and failed ones too), never reversed a
 * payment that was later refunded, charged the transfer fee to "Salaries & Wages" when the chart had no bank-charges
 * account, and rent-to-own payments were not posted at all.
 *
 * Now both products write general_ledger rows, the table every report reads, the same way rent receipts do:
 *   Dr Cash & Bank           (amount − fees)    what actually landed
 *   Dr Bank / transfer fees  (fees)             only when there are fees
 *   Cr Rental Income         (amount)           what the buyer is credited with
 * Each row has a deterministic transaction id, so posting twice is a no-op and a reversal is its exact mirror.
 */
import { db } from "../db";
import { chartOfAccounts, generalLedger, users } from "@shared/schema";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

export interface SalePosting {
  orgId: number;
  /** "DSP" for diaspora, "RTO" for rent-to-own */
  kind: "DSP" | "RTO";
  /** payment row id (diaspora) or "<paymentId>-<receipt no>" for rent-to-own part payments */
  key: string;
  label: string;
  amount: number;
  fees?: number;
  currency?: string;
  propertyId?: number | null;
  date?: Date;
  actorUserId?: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const txBase = (p: { kind: string; key: string }) => `GL-${p.kind}-${p.key}`;

async function accountsFor(tx: any, orgId: number) {
  let accounts = await tx.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, orgId));
  if (accounts.length === 0) {
    try {
      const { SEED_ACCOUNTS } = await import("../routes/enterprise-finance-routes");
      const { storage } = await import("../storage");
      await storage.seedChartOfAccounts(orgId, SEED_ACCOUNTS);
      accounts = await tx.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, orgId));
    } catch (e) { console.warn(`[sale-ledger] could not seed the chart of accounts for org ${orgId}:`, e); }
  }
  const byName = (n: string) => accounts.find((a: any) => a.accountName === n);
  return {
    cash: byName("Cash & Bank"),
    income: byName("Rental Income"),
    // there is no "Bank Charges" account in the standard chart; professional services is the closest honest home
    fees: byName("Bank Charges") ?? byName("Professional Services"),
  };
}

async function actor(tx: any, orgId: number, given?: string | null): Promise<string | null> {
  if (given) return given;
  const [admin] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, orgId), inArray(users.role, ["admin", "manager"])))
    .orderBy(sql`case when ${users.role} = 'admin' then 0 else 1 end`).limit(1);
  return admin?.id ?? null;
}

/** Post one received instalment. Safe to call again for the same key. Returns true when rows exist afterwards. */
export async function postSaleReceipt(tx: any, p: SalePosting): Promise<boolean> {
  const amount = round2(p.amount);
  const fees = round2(p.fees ?? 0);
  if (!(amount > 0) || fees < 0 || fees > amount) return false;
  const { cash, income, fees: feeAcct } = await accountsFor(tx, p.orgId);
  if (!cash || !income) { console.warn(`[sale-ledger] org ${p.orgId} has no Cash & Bank / Rental Income account — ${p.kind} ${p.key} not posted`); return false; }
  if (fees > 0 && !feeAcct) { console.warn(`[sale-ledger] org ${p.orgId} has no account for transfer fees — ${p.kind} ${p.key} not posted`); return false; }
  const createdBy = await actor(tx, p.orgId, p.actorUserId);
  if (!createdBy) return false;

  const when = p.date ?? new Date();
  const common = {
    organizationId: p.orgId, createdBy, propertyId: p.propertyId ?? null, unitId: null,
    description: p.label, reference: txBase(p), transactionDate: when,
    fiscalYear: when.getUTCFullYear(), fiscalPeriod: when.getUTCMonth() + 1, currency: p.currency ?? "KES",
  };
  const rows: any[] = [
    { ...common, transactionId: `${txBase(p)}-DR`, accountId: cash.id, debitAmount: round2(amount - fees).toFixed(2), creditAmount: "0.00" },
    { ...common, transactionId: `${txBase(p)}-CR`, accountId: income.id, debitAmount: "0.00", creditAmount: amount.toFixed(2) },
  ];
  if (fees > 0) rows.push({ ...common, description: `${p.label} — transfer fees`, transactionId: `${txBase(p)}-FEE`, accountId: feeAcct.id, debitAmount: fees.toFixed(2), creditAmount: "0.00" });
  await tx.insert(generalLedger).values(rows).onConflictDoNothing();
  return true;
}

/** Cancel a posted instalment with an equal and opposite set of rows. No-op when nothing was posted or already reversed. */
export async function reverseSaleReceipt(tx: any, p: { orgId: number; kind: "DSP" | "RTO"; key: string; actorUserId?: string | null; reason?: string }): Promise<boolean> {
  const base = txBase(p);
  const orig = await tx.select().from(generalLedger)
    .where(and(eq(generalLedger.organizationId, p.orgId), inArray(generalLedger.transactionId, [`${base}-DR`, `${base}-CR`, `${base}-FEE`])));
  if (!orig.length) return false;
  const now = new Date();
  const created = await tx.insert(generalLedger).values(orig.map((o: any) => ({
    organizationId: o.organizationId, createdBy: p.actorUserId ?? o.createdBy, propertyId: o.propertyId, unitId: o.unitId,
    description: `Reversal${p.reason ? ` (${p.reason})` : ""}: ${o.description}`, reference: `${o.reference}-REV`, currency: o.currency,
    transactionDate: now, fiscalYear: now.getUTCFullYear(), fiscalPeriod: now.getUTCMonth() + 1,
    transactionId: `${o.transactionId}-REV`, accountId: o.accountId,
    debitAmount: o.creditAmount, creditAmount: o.debitAmount,
  }))).onConflictDoNothing().returning({ id: generalLedger.id });
  return created.length > 0;
}

/** Has this instalment been posted (and not since reversed)? */
export async function isSalePosted(tx: any, orgId: number, kind: "DSP" | "RTO", key: string): Promise<boolean> {
  const base = txBase({ kind, key });
  const rows = await tx.select({ t: generalLedger.transactionId }).from(generalLedger)
    .where(and(eq(generalLedger.organizationId, orgId), inArray(generalLedger.transactionId, [`${base}-CR`, `${base}-CR-REV`])));
  const ids = rows.map((r: any) => r.t);
  return ids.includes(`${base}-CR`) && !ids.includes(`${base}-CR-REV`);
}

/**
 * A payment can be completed, refunded and completed again; each completion is its own "episode" with its own
 * transaction ids (`12`, `12.1`, `12.2` …) so a re-completion posts fresh rows instead of colliding with the old ones.
 * Returns the key of the episode that is currently live (posted and not reversed), and the key the next posting should use.
 */
export async function saleEpisode(tx: any, orgId: number, kind: "DSP" | "RTO", id: number | string): Promise<{ live: string | null; next: string }> {
  const rows = await tx.select({ t: generalLedger.transactionId }).from(generalLedger)
    .where(and(eq(generalLedger.organizationId, orgId),
      or(like(generalLedger.transactionId, `GL-${kind}-${id}-CR%`), like(generalLedger.transactionId, `GL-${kind}-${id}.%-CR%`))));
  const ids = new Set<string>(rows.map((r: any) => r.t));
  const keys: string[] = [`${id}`];
  for (let i = 1; i <= ids.size + 1; i++) keys.push(`${id}.${i}`);
  let live: string | null = null;
  let next = `${id}`;
  for (const k of keys) {
    const posted = ids.has(`GL-${kind}-${k}-CR`);
    if (!posted) { next = k; break; }
    if (!ids.has(`GL-${kind}-${k}-CR-REV`)) live = k;
    next = `${id}.${keys.indexOf(k) + 1}`;
  }
  return { live, next };
}

export const saleLedgerDb = db;
