/**
 * owner-payouts-reconciliation.test.ts — owner statements, owner payouts and bank reconciliation.
 *
 * bank import     real dates / amounts only, unknown banks refused, a statement uploaded twice is not imported twice
 * bank match      goes through the rent ledger: one receipt per row (BANK-<row>), part / over payments, general-ledger entries;
 *                 never to another organisation's invoice; a row or an invoice cannot be applied twice; ties are never guessed
 * bank unmatch    really reverses the payment (receipt removed, invoice status recomputed, ledger entries cancelled)
 * bank debits     a bank payout matches an approved owner statement and marks it paid; unmatching puts it back
 * agreements      validated, one per property, owner must be this organisation's landlord, mass assignment closed
 * statements      generate validation, rent = money received, EAT month boundaries, shortfall carried forward, one statement
 *                 per month even when generated in parallel, status machine draft → approved → sent → paid (never backwards by accident)
 * owner access    a landlord sees only their own, approved statements; management pack is scoped and needs no loop-back request
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import {
  users, units, tenants, properties, rentPayments, paymentReceipts, generalLedger, propertyExpenses,
  ownerStatements, pmAgreements, bankStatementImports, bankStatementRows,
} from "@shared/schema";
import { eq, inArray, and, like, sql } from "drizzle-orm";
import { applyPayment, todayEAT } from "../services/rent-ledger";

let app: any;
let ctx: TestContext;
let other: TestContext;
let managerToken: string;
let landlordA: { id: string; token: string };
let landlordB: { id: string; token: string };
let seq = 0;
const R = "/api/bank-reconciliation";
const S = "/api/owner-statements";

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number, role: string) {
  const email = `op-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Op", lastName: role, role, organizationId: orgId, emailVerified: true } as any);
  return { id, email, token: await login(email) };
}

// ── dates (all in Nairobi terms, like the app) ──
const today = todayEAT();
const [ty, tm] = today.split("-").map(Number);
const monthAgo = (n: number) => { const d = new Date(Date.UTC(ty, tm - 1 - n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dmy = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const M1 = monthAgo(1), M2 = monthAgo(2);

// ── fixtures ──
let invoiceSeq = 0;
/** An open rent invoice for the context's tenant. */
async function invoice(amount: number, o: { dueDate?: string; number?: string | null; tenantId?: number; status?: string } = {}) {
  const n = ++invoiceSeq;
  const [r] = await db.insert(rentPayments).values({
    tenantId: o.tenantId ?? ctx.tenantId, amount: amount.toFixed(2), currency: "KES", dueDate: o.dueDate ?? today,
    invoiceNumber: o.number === undefined ? `OPR-${Date.now().toString(36)}-${n}`.toUpperCase() : o.number, status: o.status ?? "pending",
  } as any).returning();
  return r;
}
const inv = async (id: number) => (await db.select().from(rentPayments).where(eq(rentPayments.id, id)))[0];
const receiptFor = async (rowId: number) => (await db.select().from(paymentReceipts).where(eq(paymentReceipts.receiptNumber, `BANK-${rowId}`)))[0];

const csv = (lines: Array<{ date: string; desc?: string; amount: number; ref?: string; payer?: string }>) =>
  ["date,description,amount,reference,payer_name", ...lines.map(l => `${dmy(l.date)},"${l.desc ?? "Transfer"}",${l.amount},${l.ref ?? ""},${l.payer ?? ""}`)].join("\n");

async function upload(lines: Parameters<typeof csv>[0], token = ctx.adminToken, extra: object = {}) {
  const r = await authedPost(app, `${R}/imports`, token, { bankName: "generic", csvData: csv(lines), ...extra });
  return r;
}
async function rowsOf(importId: number, token = ctx.adminToken) {
  const r = await authedGet(app, `${R}/imports/${importId}/rows`, token);
  expect(r.status).toBe(200);
  return r.body.rows as any[];
}
/** Import one credit and return its row. */
async function oneRow(o: { amount: number; date?: string; ref?: string; payer?: string; token?: string }) {
  const up = await upload([{ date: o.date ?? today, amount: o.amount, ref: o.ref, payer: o.payer, desc: `Dep ${++seq}-${randomUUID().slice(0, 4)}` }], o.token ?? ctx.adminToken);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  return { importId: up.body.importId as number, row: (await rowsOf(up.body.importId, o.token ?? ctx.adminToken))[0] };
}
const match = (rowId: number, rentPaymentId: number, token = ctx.adminToken, notes?: string) => authedPost(app, `${R}/rows/${rowId}/match`, token, { rentPaymentId, notes });

// agreements / statements
async function agreement(propertyId = ctx.propertyId, o: object = {}, token = ctx.adminToken) {
  return authedPost(app, `${S}/agreements`, token, { propertyId, feeType: "percentage", feeRate: 10, startDate: "2020-01-01", disbursementMethod: "mpesa", disbursementAccount: "0712345678", ...o });
}
const gen = (y: number, m: number, propertyId = ctx.propertyId, token = ctx.adminToken) => authedPost(app, `${S}/generate`, token, { propertyId, year: y, month: m });
/** Rent received in a given month through the real ledger. */
async function receive(amount: number, y: number, m: number, day = 10) {
  const inv0 = await invoice(amount, { dueDate: ymd(y, m, 1) });
  const r = await applyPayment({ target: { kind: "rent", id: inv0.id }, amount, method: "mpesa", paidDate: ymd(y, m, day), reference: `OPS${++seq}`, receiptNumber: `OPS-${randomUUID().slice(0, 8)}`, actorUserId: ctx.adminUserId });
  expect(r.applied).toBe(true);
  return inv0;
}
async function expense(amount: number, when: Date, o: { category?: string; status?: string } = {}) {
  const [e] = await db.insert(propertyExpenses).values({
    expenseNumber: `OPX-${Date.now().toString(36)}-${++seq}`.toUpperCase(), propertyId: ctx.propertyId, vendorName: "Vendor", description: "Repair",
    amount: amount.toFixed(2), category: (o.category ?? "maintenance") as any, expenseDate: when, status: (o.status ?? "approved") as any, createdBy: ctx.adminUserId,
  } as any).returning();
  return e;
}
const stmtRow = async (id: number) => (await db.select().from(ownerStatements).where(eq(ownerStatements.id, id)))[0];

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  other = await setupTestData();
  managerToken = (await makeUser(ctx.orgId, "manager")).token;
  landlordA = await makeUser(ctx.orgId, "landlord");
  landlordB = await makeUser(ctx.orgId, "landlord");
  await db.update(properties).set({ ownerId: landlordA.id } as any).where(eq(properties.id, ctx.propertyId));
});

afterAll(async () => {
  for (const c of [ctx, other]) {
    await db.delete(bankStatementRows).where(eq(bankStatementRows.organizationId, c.orgId)).catch(() => {});
    await db.delete(bankStatementImports).where(eq(bankStatementImports.organizationId, c.orgId)).catch(() => {});
    await db.delete(ownerStatements).where(eq(ownerStatements.organizationId, c.orgId)).catch(() => {});
    await db.delete(pmAgreements).where(eq(pmAgreements.organizationId, c.orgId)).catch(() => {});
    await db.delete(propertyExpenses).where(inArray(propertyExpenses.propertyId, [c.propertyId])).catch(() => {});
    await db.delete(generalLedger).where(eq(generalLedger.organizationId, c.orgId)).catch(() => {});
    const ids = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, c.orgId))).map(t => t.id);
    if (ids.length) {
      const invs = (await db.select({ id: rentPayments.id }).from(rentPayments).where(inArray(rentPayments.tenantId, ids))).map(i => i.id);
      if (invs.length) await db.delete(paymentReceipts).where(inArray(paymentReceipts.paymentId, invs)).catch(() => {});
      await db.delete(rentPayments).where(inArray(rentPayments.tenantId, ids)).catch(() => {});
    }
  }
  await cleanupTestData(ctx);
  await cleanupTestData(other);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("bank statement import", () => {
  it("imports a generic CSV and counts the rows", async () => {
    const r = await upload([{ date: today, amount: 1111.11, desc: "A1" }, { date: today, amount: 2222.22, desc: "A2" }]);
    expect(r.status).toBe(201);
    expect(r.body.rowCount).toBe(2);
    const imp = (await authedGet(app, `${R}/imports`, ctx.adminToken)).body.find((i: any) => i.id === r.body.importId);
    expect(imp.rowCount).toBe(2);
    expect(imp.unmatchedCount).toBe(2);
  });

  it("refuses an unknown bank, a bad period and an empty file", async () => {
    expect((await upload([{ date: today, amount: 5000.01 }], ctx.adminToken, { bankName: "nonexistent" })).status).toBe(400);
    expect((await upload([{ date: today, amount: 5000.02 }], ctx.adminToken, { statementPeriodFrom: "2026-05-02", statementPeriodTo: "2026-05-01" })).status).toBe(400);
    expect((await authedPost(app, `${R}/imports`, ctx.adminToken, { bankName: "generic", csvData: "date,description,amount\n" })).status).toBe(400);
  });

  it("skips lines whose date does not exist (31/02) or amount is blank, and says how many", async () => {
    const r = await authedPost(app, `${R}/imports`, ctx.adminToken, { bankName: "generic", csvData: [
      "date,description,amount,reference",
      `31/02/2026,"Impossible date",5000,X1`,
      `${dmy(today)},"Fine ${randomUUID().slice(0, 5)}",5001.03,`,
      `${dmy(today)},"No amount ${randomUUID().slice(0, 5)}",,`,
    ].join("\n") });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.rowCount).toBe(1);
    expect(r.body.skipped).toBe(2);
  });

  it("the same statement uploaded twice is not imported twice; an overlapping one adds only the new lines", async () => {
    const a = { date: today, amount: 7001.01, desc: `Dup ${randomUUID().slice(0, 6)}`, ref: "DUPREF1" };
    const b = { date: today, amount: 7002.02, desc: `Dup ${randomUUID().slice(0, 6)}`, ref: "DUPREF2" };
    const first = await upload([a]);
    expect(first.status).toBe(201);
    const again = await upload([a]);
    expect(again.status).toBe(409);
    expect(again.body.duplicates).toBe(1);
    const overlap = await upload([a, b]);
    expect(overlap.status).toBe(201);
    expect(overlap.body.rowCount).toBe(1);
    expect(overlap.body.duplicates).toBe(1);
  });

  it("two identical lines inside ONE file are both kept (two deposits of the same amount)", async () => {
    const l = { date: today, amount: 500.55, desc: `Twin ${randomUUID().slice(0, 6)}` };
    const r = await upload([l, l]);
    expect(r.status).toBe(201);
    expect(r.body.rowCount).toBe(2);
  });

  it("negative amounts in accounting brackets are read as money out", async () => {
    const r = await authedPost(app, `${R}/imports`, ctx.adminToken, { bankName: "generic", csvData: `date,description,amount\n${dmy(today)},"Out ${randomUUID().slice(0, 5)}","(9,999.50)"` });
    expect(r.status).toBe(201);
    const [row] = await rowsOf(r.body.importId);
    expect(Number(row.amount)).toBe(-9999.5);
  });

  it("a non-staff login cannot import, and other organisations cannot see the import", async () => {
    expect((await upload([{ date: today, amount: 8000.01 }], ctx.tenantToken)).status).toBe(403);
    expect((await upload([{ date: today, amount: 8000.02 }], landlordA.token)).status).toBe(403);
    const mine = await upload([{ date: today, amount: 8000.03 }]);
    expect((await authedGet(app, `${R}/imports/${mine.body.importId}/rows`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, `${R}/imports/${mine.body.importId}/summary`, other.adminToken)).status).toBe(404);
    expect((await authedPost(app, `${R}/imports/${mine.body.importId}/auto-match`, other.adminToken)).status).toBe(404);
  });

  it("deletes an import that has nothing matched, refuses one that has", async () => {
    const i = await invoice(3333.33);
    const { importId, row } = await oneRow({ amount: 3333.33 });
    expect((await match(row.id, i.id)).status).toBe(200);
    const refused = await supertest(app).delete(`${R}/imports/${importId}`).set("Authorization", `Bearer ${ctx.adminToken}`);
    expect(refused.status).toBe(409);
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken)).status).toBe(200);
    const ok = await supertest(app).delete(`${R}/imports/${importId}`).set("Authorization", `Bearer ${ctx.adminToken}`);
    expect(ok.status).toBe(200);
    expect(await db.select().from(bankStatementRows).where(eq(bankStatementRows.importId, importId))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("matching a bank credit to a rent invoice", () => {
  it("manual match pays the invoice through the ledger: receipt BANK-<row>, status, general-ledger entries", async () => {
    const i = await invoice(4444.44);
    const { importId, row } = await oneRow({ amount: 4444.44, ref: "REFZZ91" });
    const r = await match(row.id, i.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.balance).toBe(0);

    const after = await inv(i.id);
    expect(after.status).toBe("paid");
    expect(after.paymentMethod).toBe("bank_transfer");
    const rec = await receiptFor(row.id);
    expect(Number(rec.amount)).toBe(4444.44);
    expect(rec.paymentId).toBe(i.id);
    const gl = await db.select().from(generalLedger).where(like(generalLedger.transactionId, `%-BANK-${row.id}-%`));
    expect(gl).toHaveLength(2);
    expect(gl.reduce((s, g) => s + Number(g.debitAmount) - Number(g.creditAmount), 0)).toBe(0);

    const rows = await rowsOf(importId);
    expect(rows[0].matchStatus).toBe("matched");
    expect(rows[0].matchedPayment.id).toBe(i.id);
    const imp = (await authedGet(app, `${R}/imports`, ctx.adminToken)).body.find((x: any) => x.id === importId);
    expect(imp.matchedCount).toBe(1);
    expect(imp.unmatchedCount).toBe(0);
  });

  it("a part payment leaves the invoice partial with the balance; the rest completes it", async () => {
    const i = await invoice(30000.01);
    const a = await oneRow({ amount: 10000.01 });
    const r1 = await match(a.row.id, i.id);
    expect(r1.status).toBe(200);
    expect(r1.body.balance).toBe(20000);
    expect(r1.body.message).toMatch(/part payment/i);
    expect((await inv(i.id)).status).toBe("partial");

    const b = await oneRow({ amount: 20000 });
    const r2 = await match(b.row.id, i.id);
    expect(r2.status).toBe(200);
    expect(r2.body.balance).toBe(0);
    expect((await inv(i.id)).status).toBe("paid");
  });

  it("an overpayment is recorded and flagged, not refused", async () => {
    const i = await invoice(20000.02);
    const { row } = await oneRow({ amount: 25000.02 });
    const r = await match(row.id, i.id);
    expect(r.status).toBe(200);
    expect(r.body.overpaid).toBe(5000);
    expect(r.body.message).toMatch(/excess/i);
    expect((await inv(i.id)).status).toBe("paid");
  });

  it("the same row cannot be applied twice, and a paid invoice takes no more bank money", async () => {
    const i = await invoice(6000.06);
    const { row } = await oneRow({ amount: 6000.06 });
    expect((await match(row.id, i.id)).status).toBe(200);
    const again = await match(row.id, (await invoice(6000.06)).id);
    expect(again.status).toBe(409);
    expect(await db.select().from(paymentReceipts).where(eq(paymentReceipts.receiptNumber, `BANK-${row.id}`))).toHaveLength(1);

    const second = await oneRow({ amount: 6000.06 });
    const onPaid = await match(second.row.id, i.id);
    expect(onPaid.status).toBe(409);
    expect((await rowsOf(second.importId))[0].matchStatus).toBe("unmatched");   // the failed attempt did not leave the row claimed
  });

  it("two clicks at once apply the money once", async () => {
    const i = await invoice(6100.01);
    const { row } = await oneRow({ amount: 6100.01 });
    const [a, b] = await Promise.all([match(row.id, i.id), match(row.id, i.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await db.select().from(paymentReceipts).where(eq(paymentReceipts.receiptNumber, `BANK-${row.id}`))).toHaveLength(1);
  });

  it("never matches an invoice of another organisation, or another organisation's row", async () => {
    const [otherTenant] = await db.select().from(tenants).where(eq(tenants.id, other.tenantId));
    const foreign = await invoice(9000.09, { tenantId: otherTenant.id });
    const { row } = await oneRow({ amount: 9000.09 });
    const r = await match(row.id, foreign.id);
    expect(r.status).toBe(404);
    expect((await inv(foreign.id)).status).toBe("pending");

    const mine = await invoice(9000.19);
    expect((await match(row.id, mine.id, other.adminToken)).status).toBe(404);
  });

  it("a debit cannot be matched to an invoice", async () => {
    const up = await authedPost(app, `${R}/imports`, ctx.adminToken, { bankName: "generic", csvData: `date,description,amount\n${dmy(today)},"Pay ${randomUUID().slice(0, 5)}",-1234.56` });
    const [row] = await rowsOf(up.body.importId);
    const i = await invoice(1234.56);
    expect((await match(row.id, i.id)).status).toBe(400);
  });

  it("matching works for overdue and part-paid invoices (the pending-only list used to hide them)", async () => {
    const overdue = await invoice(1357.91, { dueDate: addDaysStr(today, -20), status: "overdue" });
    const part = await invoice(2468.02);
    await match((await oneRow({ amount: 468.02 })).row.id, part.id);
    const list = await authedGet(app, `${R}/open-invoices?amount=1357.91`, ctx.adminToken);
    expect(list.status).toBe(200);
    const ids = list.body.map((x: any) => x.id);
    expect(ids).toContain(overdue.id);
    expect(ids).toContain(part.id);
    expect(list.body.find((x: any) => x.id === part.id).balance).toBe(2000);
    expect(list.body[0].id).toBe(overdue.id);                           // closest amount first
    // and the other organisation sees none of them
    const foreign = await authedGet(app, `${R}/open-invoices`, other.adminToken);
    expect(foreign.body.map((x: any) => x.id)).not.toContain(overdue.id);
  });
});

function addDaysStr(s: string, n: number) { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("auto-match", () => {
  it("an exact reference match is applied, and the invoice is paid with a receipt and ledger entries", async () => {
    const number = `RENT-${randomUUID().slice(0, 6).toUpperCase()}`;
    const i = await invoice(11111.11, { number });
    const { importId, row } = await oneRow({ amount: 11111.11, ref: number });
    const r = await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.body.autoMatched).toBe(1);
    expect((await inv(i.id)).status).toBe("paid");
    expect(await receiptFor(row.id)).toBeTruthy();
    expect((await rowsOf(importId))[0].matchMethod).toBe("auto_exact_ref");
  });

  it("an invoice with no number is never 'matched by reference' (empty string is not contained in everything)", async () => {
    const nameless = await invoice(12121.21, { number: null, dueDate: addDaysStr(today, -200) });   // far from the bank date, amount differs
    const { importId, row } = await oneRow({ amount: 99999.99, ref: "ABCDE12345" });
    const r = await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect(r.body.autoMatched).toBe(0);
    expect((await inv(nameless.id)).status).toBe("pending");
    expect((await rowsOf(importId))[0].matchStatus).toBe("unmatched");
  });

  it("two invoices that equally fit a credit are NOT guessed between — it becomes a suggestion", async () => {
    const a = await invoice(13131.31);
    const b = await invoice(13131.31);
    const { importId, row } = await oneRow({ amount: 13131.31 });
    const r = await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect(r.body.autoMatched).toBe(0);
    expect(r.body.suggested).toBe(1);
    const [after] = await rowsOf(importId);
    expect(after.matchStatus).toBe("suggested");
    expect(after.matchConfidence).toBeLessThan(80);
    expect((await inv(a.id)).status).toBe("pending");
    expect((await inv(b.id)).status).toBe("pending");
    // the person picks one: it then goes through
    expect((await match(row.id, b.id)).status).toBe(200);
    expect((await inv(b.id)).status).toBe("paid");
  });

  it("two credits cannot both settle the same invoice in one run", async () => {
    const i = await invoice(14141.41);
    const up = await upload([{ date: today, amount: 14141.41, desc: `P1 ${randomUUID().slice(0, 5)}` }, { date: today, amount: 14141.41, desc: `P2 ${randomUUID().slice(0, 5)}` }]);
    const r = await authedPost(app, `${R}/imports/${up.body.importId}/auto-match`, ctx.adminToken);
    expect(r.body.autoMatched).toBe(1);
    const receipts = await db.select().from(paymentReceipts).where(eq(paymentReceipts.paymentId, i.id));
    expect(receipts).toHaveLength(1);
    expect((await rowsOf(up.body.importId)).filter((x: any) => x.matchStatus === "matched")).toHaveLength(1);
  });

  it("a reference match for LESS than the invoice is applied as a part payment; for MORE it waits for a person", async () => {
    const n1 = `RENT-${randomUUID().slice(0, 6).toUpperCase()}`, n2 = `RENT-${randomUUID().slice(0, 6).toUpperCase()}`;
    const small = await invoice(15000.15, { number: n1 });
    const big   = await invoice(16000.16, { number: n2 });
    const up = await upload([{ date: today, amount: 5000.15, ref: n1, desc: `S ${randomUUID().slice(0, 5)}` }, { date: today, amount: 20000.16, ref: n2, desc: `B ${randomUUID().slice(0, 5)}` }]);
    const r = await authedPost(app, `${R}/imports/${up.body.importId}/auto-match`, ctx.adminToken);
    expect(r.body.autoMatched).toBe(1);
    expect((await inv(small.id)).status).toBe("partial");
    expect((await inv(big.id)).status).toBe("pending");
  });

  it("a suggestion whose invoice was paid elsewhere is dropped on the next run", async () => {
    const a = await invoice(17171.71);
    const b = await invoice(17171.71);
    const { importId } = await oneRow({ amount: 17171.71 });
    await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect((await rowsOf(importId))[0].matchStatus).toBe("suggested");
    await db.update(rentPayments).set({ status: "paid" } as any).where(inArray(rentPayments.id, [a.id, b.id]));
    await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    const [row] = await rowsOf(importId);
    expect(row.matchStatus).toBe("unmatched");
    expect(row.matchedRentPaymentId).toBeNull();
  });

  it("only this organisation's invoices are candidates", async () => {
    const [otherTenant] = await db.select().from(tenants).where(eq(tenants.id, other.tenantId));
    const foreign = await invoice(18181.81, { tenantId: otherTenant.id });
    const { importId } = await oneRow({ amount: 18181.81, date: today });
    const r = await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect(r.body.autoMatched).toBe(0);
    expect((await inv(foreign.id)).status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("undoing a match", () => {
  it("unmatch reverses the payment: receipt gone, invoice open again, ledger entries cancelled", async () => {
    const i = await invoice(19191.91, { dueDate: addDaysStr(today, 5) });
    const { importId, row } = await oneRow({ amount: 19191.91 });
    await match(row.id, i.id);
    expect((await inv(i.id)).status).toBe("paid");

    const r = await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken);
    expect(r.status).toBe(200);
    expect(await receiptFor(row.id)).toBeUndefined();
    const after = await inv(i.id);
    expect(after.status).toBe("pending");
    expect(after.paidDate).toBeNull();

    const gl = await db.select().from(generalLedger).where(like(generalLedger.transactionId, `%-BANK-${row.id}-%`));
    expect(gl).toHaveLength(4);                                             // posted + reversed, both kept
    expect(gl.reduce((s, g) => s + Number(g.debitAmount), 0)).toBe(gl.reduce((s, g) => s + Number(g.creditAmount), 0));
    const cashNet = gl.filter(g => !String(g.transactionId).includes("-REV")).reduce((s, g) => s + Number(g.debitAmount) - Number(g.creditAmount), 0);
    expect(cashNet).toBe(0);

    const [r0] = await rowsOf(importId);
    expect(r0.matchStatus).toBe("unmatched");
    expect(r0.matchedRentPaymentId).toBeNull();
    // and the row can be matched again, to the same or another invoice
    expect((await match(row.id, i.id)).status).toBe(200);
  });

  it("unmatching one part payment leaves the other in place (invoice goes back to partial, not pending)", async () => {
    const i = await invoice(20202.02);
    const a = await oneRow({ amount: 10000 });
    const b = await oneRow({ amount: 10202.02 });
    await match(a.row.id, i.id);
    await match(b.row.id, i.id);
    expect((await inv(i.id)).status).toBe("paid");
    await authedPost(app, `${R}/rows/${b.row.id}/unmatch`, ctx.adminToken);
    expect((await inv(i.id)).status).toBe("partial");
    await authedPost(app, `${R}/rows/${a.row.id}/unmatch`, ctx.adminToken);
    expect((await inv(i.id)).status).toBe("pending");
  });

  it("an overdue invoice goes back to overdue, not pending", async () => {
    const i = await invoice(21212.12, { dueDate: addDaysStr(today, -30), status: "overdue" });
    const { row } = await oneRow({ amount: 21212.12 });
    await match(row.id, i.id);
    await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken);
    expect((await inv(i.id)).status).toBe("overdue");
  });

  it("unmatching twice does nothing the second time; other organisations cannot unmatch", async () => {
    const i = await invoice(22222.22);
    const { row } = await oneRow({ amount: 22222.22 });
    await match(row.id, i.id);
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, other.adminToken)).status).toBe(404);
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken)).status).toBe(200);
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken)).status).toBe(200);
    expect((await inv(i.id)).status).toBe("pending");
  });

  it("a matched row cannot simply be ignored (it would leave a paid invoice with no explanation)", async () => {
    const i = await invoice(23232.32);
    const { row } = await oneRow({ amount: 23232.32 });
    await match(row.id, i.id);
    expect((await authedPost(app, `${R}/rows/${row.id}/ignore`, ctx.adminToken, { notes: "oops" })).status).toBe(409);
    expect((await inv(i.id)).status).toBe("paid");
  });

  it("ignore, then unmatch, brings a row back", async () => {
    const { importId, row } = await oneRow({ amount: 24242.42 });
    expect((await authedPost(app, `${R}/rows/${row.id}/ignore`, ctx.adminToken, { notes: "interest" })).status).toBe(200);
    expect((await rowsOf(importId))[0].matchStatus).toBe("ignored");
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken)).status).toBe(200);
    expect((await rowsOf(importId))[0].matchStatus).toBe("unmatched");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("PM agreements", () => {
  it("validates the fee, dates and payout account", async () => {
    const bad = async (o: object) => (await agreement(ctx.propertyId, o)).status;
    expect(await bad({ feeType: "weekly" })).toBe(400);
    expect(await bad({ feeRate: -5 })).toBe(400);
    expect(await bad({ feeRate: 150 })).toBe(400);                        // a percentage over 100
    expect(await bad({ feeRate: "abc" })).toBe(400);
    expect(await bad({ startDate: "2026-02-31" })).toBe(400);
    expect(await bad({ startDate: "2026-05-01", endDate: "2026-04-01" })).toBe(400);
    expect(await bad({ disbursementMethod: "mpesa", disbursementAccount: "not a number" })).toBe(400);
    expect(await bad({ disbursementMethod: "carrier-pigeon" })).toBe(400);
  });

  it("a property in another organisation, or an unknown one, is 404", async () => {
    expect((await agreement(other.propertyId)).status).toBe(404);
    expect((await agreement(99999999)).status).toBe(404);
  });

  it("the owner must be a landlord of this organisation", async () => {
    const foreignOwner = await makeUser(other.orgId, "landlord");
    expect((await agreement(ctx.propertyId, { ownerUserId: foreignOwner.id })).status).toBe(400);
    const staffUser = await makeUser(ctx.orgId, "staff");
    expect((await agreement(ctx.propertyId, { ownerUserId: staffUser.id })).status).toBe(400);
  });

  it("creates one agreement per property; a second is a clear 409, not a database error", async () => {
    const r = await agreement(ctx.propertyId, { ownerUserId: landlordA.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.agreementNumber).toMatch(/^PMA-\d{4}-\d{3,}$/);
    expect(r.body.ownerUserId).toBe(landlordA.id);
    const dup = await agreement(ctx.propertyId);
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already has an agreement/i);
  });

  it("PATCH cannot move the agreement to another property/organisation, and revalidates the merged result", async () => {
    const list = (await authedGet(app, `${S}/agreements`, ctx.adminToken)).body;
    const a = list.find((x: any) => x.propertyId === ctx.propertyId);
    const moved = await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { propertyId: other.propertyId, organizationId: other.orgId, agreementNumber: "HACK-1", feeRate: 12 });
    expect(moved.status).toBe(200);
    expect(moved.body.propertyId).toBe(ctx.propertyId);
    expect(moved.body.organizationId).toBe(ctx.orgId);
    expect(moved.body.agreementNumber).not.toBe("HACK-1");
    expect(Number(moved.body.feeRate)).toBe(12);
    expect((await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { endDate: "2019-01-01" })).status).toBe(400);    // before the start date
    expect((await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { feeType: "percentage", feeRate: 101 })).status).toBe(400);
    expect((await authedPatch(app, `${S}/agreements/${a.id}`, other.adminToken, { feeRate: 1 })).status).toBe(404);
    expect((await authedPatch(app, `${S}/agreements/${a.id}`, landlordA.token, { feeRate: 1 })).status).toBe(403);
    await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { feeRate: 10 });
  });

  it("an owner sees only their own agreement — not another owner's, and never another organisation's", async () => {
    expect((await authedGet(app, `${S}/agreements/${ctx.propertyId}`, landlordA.token)).body?.propertyId).toBe(ctx.propertyId);
    expect((await authedGet(app, `${S}/agreements/${ctx.propertyId}`, landlordB.token)).body).toBeNull();
    expect((await authedGet(app, `${S}/agreements`, landlordB.token)).body).toHaveLength(0);
    expect((await authedGet(app, `${S}/agreements/${ctx.propertyId}`, other.adminToken)).body).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("generating an owner statement", () => {
  it("validates property, year and month", async () => {
    expect((await authedPost(app, `${S}/generate`, ctx.adminToken, { propertyId: ctx.propertyId, year: 2026, month: 13 })).status).toBe(400);
    expect((await authedPost(app, `${S}/generate`, ctx.adminToken, { propertyId: ctx.propertyId, year: "abc", month: 1 })).status).toBe(400);
    expect((await authedPost(app, `${S}/generate`, ctx.adminToken, { propertyId: ctx.propertyId, month: 1 })).status).toBe(400);
    expect((await gen(ty + 2, 1)).status).toBe(400);                                      // not started yet
    expect((await gen(M1.y, M1.m, other.propertyId)).status).toBe(404);                  // another organisation's property
    expect((await gen(M1.y, M1.m, 99999999)).status).toBe(404);
    expect((await gen(M1.y, M1.m, ctx.propertyId, ctx.tenantToken)).status).toBe(403);
    expect((await gen(M1.y, M1.m, ctx.propertyId, landlordA.token)).status).toBe(403);
  });

  it("counts the rent actually received in the month; PM fee from the agreement; net payable", async () => {
    await receive(50000, M1.y, M1.m, 10);
    await receive(30000, M1.y, M1.m, 20);
    await receive(99999, M2.y, M2.m, 15);                                                 // another month — must not be counted
    const r = await gen(M1.y, M1.m);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(Number(r.body.grossRent)).toBe(80000);
    expect(Number(r.body.pmFee)).toBe(8000);
    expect(Number(r.body.netPayable)).toBe(72000);
    expect(r.body.status).toBe("draft");
    expect(r.body.statementNumber).toMatch(/^OWS-\d{4}-\d{3,}$/);
    const names = (r.body.paymentDetails as any[]).map(p => p.tenantName);
    expect(names.every(n => !/^Tenant #/.test(n))).toBe(true);
  });

  it("regenerating the same month updates the same statement (still one row)", async () => {
    const again = await gen(M1.y, M1.m);
    expect(again.status).toBe(200);
    const rows = await db.select().from(ownerStatements).where(and(eq(ownerStatements.propertyId, ctx.propertyId), eq(ownerStatements.periodYear, M1.y), eq(ownerStatements.periodMonth, M1.m)));
    expect(rows).toHaveLength(1);
  });

  it("generating in parallel cannot create two statements for the same month", async () => {
    const m3 = monthAgo(3);
    await receive(10000, m3.y, m3.m, 5);
    const results = await Promise.all([gen(m3.y, m3.m), gen(m3.y, m3.m), gen(m3.y, m3.m), gen(m3.y, m3.m)]);
    expect(results.every(r => [200, 201].includes(r.status))).toBe(true);
    const rows = await db.select().from(ownerStatements).where(and(eq(ownerStatements.propertyId, ctx.propertyId), eq(ownerStatements.periodYear, m3.y), eq(ownerStatements.periodMonth, m3.m)));
    expect(rows).toHaveLength(1);
  });

  it("expenses count in the month they are dated in Nairobi (00:30 on the 1st belongs to THAT month)", async () => {
    const m5 = monthAgo(5), m6 = monthAgo(6);
    await receive(100000, m5.y, m5.m, 10);
    await expense(1000, new Date(`${ymd(m5.y, m5.m, 1)}T00:30:00+03:00`));             // first minute of the month, EAT
    await expense(2000, new Date(`${ymd(m5.y, m5.m, 28)}T23:30:00+03:00`));            // last minutes of the month, EAT
    const next = monthAgo(4);
    await expense(4000, new Date(`${ymd(next.y, next.m, 1)}T00:10:00+03:00`));          // belongs to the NEXT month
    await expense(8000, new Date(`${ymd(m5.y, m5.m, 12)}T10:00:00+03:00`), { status: "pending" });   // not approved — ignored
    await expense(16000, new Date(`${ymd(m5.y, m5.m, 14)}T10:00:00+03:00`), { category: "utilities" });   // agreement does not deduct utilities
    const r = await gen(m5.y, m5.m);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(Number(r.body.maintenanceCosts)).toBe(3000);
    expect(Number(r.body.utilityCosts)).toBe(0);
    void m6;
  });

  it("costs above income are never lost: nothing payable, shortfall carried to the next approved statement", async () => {
    const a = monthAgo(8), b = monthAgo(7);
    await receive(10000, a.y, a.m, 10);
    await expense(5000, new Date(`${ymd(a.y, a.m, 12)}T10:00:00+03:00`));
    await expense(9000, new Date(`${ymd(a.y, a.m, 13)}T10:00:00+03:00`));
    const first = await gen(a.y, a.m);
    expect(first.status).toBe(201);
    expect(Number(first.body.netPayable)).toBe(0);
    expect(first.body.shortfall).toBe(5000);                                            // fee 1,000 + costs 14,000 − income 10,000
    await receive(40000, b.y, b.m, 10);

    // the shortfall is only carried from an approved statement
    const early = await gen(b.y, b.m);
    expect(early.body.warnings.join(" ")).toMatch(/still a draft/i);
    expect(Number(early.body.otherDeductions)).toBe(0);
    await authedPatch(app, `${S}/${first.body.id}/approve`, ctx.adminToken);
    const next = await gen(b.y, b.m);
    expect(next.body.carriedForward).toBe(first.body.shortfall);
    expect(Number(next.body.otherDeductions)).toBe(first.body.shortfall);
    expect(Number(next.body.netPayable)).toBe(40000 - 4000 - first.body.shortfall);
    expect((next.body.lineItems as any[]).some(l => /brought forward/i.test(l.description))).toBe(true);
  });

  it("an agreement that is suspended, or that does not cover the month, produces no statement", async () => {
    const list = (await authedGet(app, `${S}/agreements`, ctx.adminToken)).body;
    const a = list.find((x: any) => x.propertyId === ctx.propertyId);
    await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { startDate: ymd(M1.y, M1.m, 20) });
    const before = await gen(M2.y, M2.m);
    expect(before.status).toBe(409);
    expect(before.body.message).toMatch(/starts on/i);
    await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { startDate: "2020-01-01", status: "suspended" });
    const sus = await gen(M1.y, M1.m);
    expect(sus.status).toBe(409);
    expect(sus.body.message).toMatch(/suspended/i);
    await authedPatch(app, `${S}/agreements/${a.id}`, ctx.adminToken, { status: "active" });
  });

  it("a month that is not over yet generates with a warning", async () => {
    const r = await gen(ty, tm);
    expect([200, 201]).toContain(r.status);
    expect(r.body.warnings.join(" ")).toMatch(/not over yet/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("statement status machine and payout", () => {
  let id: number;
  beforeAll(async () => {
    const m = monthAgo(10);
    await receive(60000, m.y, m.m, 10);
    const r = await gen(m.y, m.m);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id = r.body.id;
  });
  const P = (ep: string, body: object = {}, token = ctx.adminToken) => authedPatch(app, `${S}/${id}/${ep}`, token, body);

  it("a draft cannot be sent or paid out", async () => {
    expect((await P("send")).status).toBe(409);
    expect((await P("mark-disbursed", { disbursementRef: "QWE123" })).status).toBe(409);
  });

  it("only staff approve; a draft is approved once; approving again is a 409", async () => {
    expect((await P("approve", {}, ctx.tenantToken)).status).toBe(403);
    expect((await P("approve", {}, landlordA.token)).status).toBe(403);
    expect((await P("approve", {}, other.adminToken)).status).toBe(404);
    expect((await P("approve", {}, managerToken)).status).toBe(200);
    const again = await P("approve");
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already approved/i);
  });

  it("regenerating an approved statement puts it back to draft with a warning", async () => {
    const st = await stmtRow(id);
    const r = await gen(st.periodYear, st.periodMonth);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    expect(r.body.warnings.join(" ")).toMatch(/approved.*draft again/i);
    expect((await P("approve")).status).toBe(200);
  });

  it("sending marks it sent (the email failing is reported, not hidden); the owner then sees it", async () => {
    const r = await P("send");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("sent");
    expect(r.body.emailSent).toBe(false);                      // no mail service in tests
    expect(typeof r.body.emailError).toBe("string");
    const seen = await authedGet(app, `${S}/${id}`, landlordA.token);
    expect(seen.status).toBe(200);
  });

  it("a payout needs a reference (and a real, not-future date)", async () => {
    expect((await P("mark-disbursed", {})).status).toBe(400);
    expect((await P("mark-disbursed", { disbursementRef: "ab" })).status).toBe(400);
    expect((await P("mark-disbursed", { disbursementRef: "QWE123", disbursedDate: addDaysStr(today, 3) })).status).toBe(400);
    expect((await P("mark-disbursed", { disbursementRef: "QWE123", disbursedDate: "2026-02-31" })).status).toBe(400);
    expect((await P("mark-disbursed", { disbursementRef: "QWE123" }, ctx.tenantToken)).status).toBe(403);
  });

  it("a sent statement can no longer be regenerated, and cannot be re-approved (status must not go backwards)", async () => {
    const st = await stmtRow(id);
    const r = await gen(st.periodYear, st.periodMonth);
    expect(r.status).toBe(409);
    expect((await P("approve")).status).toBe(409);
    expect((await stmtRow(id)).status).toBe("sent");
  });

  it("recording the payout makes it paid, once; a second attempt cannot overwrite the reference", async () => {
    const ok = await P("mark-disbursed", { disbursementRef: "QWE123", disbursedDate: today });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe("paid");
    expect(ok.body.disbursementRef).toBe("QWE123");
    const second = await P("mark-disbursed", { disbursementRef: "OTHER99" });
    expect(second.status).toBe(409);
    expect((await stmtRow(id)).disbursementRef).toBe("QWE123");
    expect((await P("approve")).status).toBe(409);
    expect((await stmtRow(id)).status).toBe("paid");
  });

  it("only an admin can reverse a recorded payout, and must say why", async () => {
    expect((await P("undo-disbursed", { reason: "typo" }, managerToken)).status).toBe(403);
    expect((await P("undo-disbursed", {})).status).toBe(400);
    const ok = await P("undo-disbursed", { reason: "Entered against the wrong statement" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect(ok.body.disbursementRef).toBeNull();
    expect((await P("undo-disbursed", { reason: "again" })).status).toBe(409);           // only a paid one can be reversed
  });

  it("only drafts can be deleted", async () => {
    const del = (sid: number, token = ctx.adminToken) => supertest(app).delete(`${S}/${sid}`).set("Authorization", `Bearer ${token}`);
    expect((await del(id)).status).toBe(409);                 // approved
    const m = monthAgo(11);
    await receive(1000, m.y, m.m, 5);
    const draft = await gen(m.y, m.m);
    expect((await del(draft.body.id, ctx.tenantToken)).status).toBe(403);
    expect((await del(draft.body.id, other.adminToken)).status).toBe(404);
    expect((await del(draft.body.id)).status).toBe(200);
    expect(await stmtRow(draft.body.id)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("paying an owner statement out through the bank", () => {
  async function approvedStatement(offset: number, income: number) {
    const m = monthAgo(offset);
    await receive(income, m.y, m.m, 10);
    const g = await gen(m.y, m.m);
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    await authedPatch(app, `${S}/${g.body.id}/approve`, ctx.adminToken);
    return { id: g.body.id as number, net: Number(g.body.netPayable) };
  }
  const debitRow = async (amount: number) => {
    const up = await authedPost(app, `${R}/imports`, ctx.adminToken, { bankName: "generic", csvData: `date,description,amount,reference\n${dmy(today)},"Owner payout ${randomUUID().slice(0, 5)}",-${amount},PAYOUT${++seq}XY` });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    return { importId: up.body.importId as number, row: (await rowsOf(up.body.importId))[0] };
  };

  it("a bank debit equal to an approved statement is suggested by auto-match, and confirming marks the statement paid", async () => {
    const st = await approvedStatement(13, 123456);
    const { importId, row } = await debitRow(st.net);
    const auto = await authedPost(app, `${R}/imports/${importId}/auto-match`, ctx.adminToken);
    expect(auto.body.suggested).toBe(1);
    expect(auto.body.autoMatched).toBe(0);
    const [sug] = await rowsOf(importId);
    expect(sug.matchStatus).toBe("suggested");
    expect(sug.matchedStatement.id).toBe(st.id);
    expect((await stmtRow(st.id)).status).toBe("approved");                                  // a suggestion never moves money state

    const cand = await authedGet(app, `${R}/payout-candidates?amount=${st.net}`, ctx.adminToken);
    expect(cand.body[0].id).toBe(st.id);

    const ok = await authedPost(app, `${R}/rows/${row.id}/match-statement`, ctx.adminToken, { statementId: st.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await stmtRow(st.id);
    expect(after.status).toBe("paid");
    expect(after.disbursementRef).toMatch(/^PAYOUT/);
    expect((await rowsOf(importId))[0].matchStatus).toBe("matched");

    // unmatching sends the statement back to approved
    expect((await authedPost(app, `${R}/rows/${row.id}/unmatch`, ctx.adminToken)).status).toBe(200);
    expect((await stmtRow(st.id)).status).toBe("approved");
    expect((await stmtRow(st.id)).disbursementRef).toBeNull();
  });

  it("the amount must be exactly what the statement says; a draft is refused; another organisation's statement is 404", async () => {
    const st = await approvedStatement(14, 45678);
    const { row } = await debitRow(st.net - 100);
    const wrong = await authedPost(app, `${R}/rows/${row.id}/match-statement`, ctx.adminToken, { statementId: st.id });
    expect(wrong.status).toBe(409);
    expect(wrong.body.message).toMatch(/is for KES/);
    expect((await stmtRow(st.id)).status).toBe("approved");

    const m = monthAgo(15);
    await receive(5000, m.y, m.m, 10);
    const draft = await gen(m.y, m.m);
    const exact = await debitRow(Number(draft.body.netPayable));
    expect((await authedPost(app, `${R}/rows/${exact.row.id}/match-statement`, ctx.adminToken, { statementId: draft.body.id })).status).toBe(409);
    expect((await authedPost(app, `${R}/rows/${exact.row.id}/match-statement`, other.adminToken, { statementId: st.id })).status).toBe(404);
  });

  it("a credit cannot be matched to a statement, and a statement paid by hand cannot be paid again by the bank", async () => {
    const st = await approvedStatement(16, 33333);
    const credit = await oneRow({ amount: st.net });
    expect((await authedPost(app, `${R}/rows/${credit.row.id}/match-statement`, ctx.adminToken, { statementId: st.id })).status).toBe(400);
    await authedPatch(app, `${S}/${st.id}/mark-disbursed`, ctx.adminToken, { disbursementRef: "MANUAL1" });
    const { row } = await debitRow(st.net);
    const r = await authedPost(app, `${R}/rows/${row.id}/match-statement`, ctx.adminToken, { statementId: st.id });
    expect(r.status).toBe(409);
    expect((await rowsOf((await db.select().from(bankStatementRows).where(eq(bankStatementRows.id, row.id)))[0].importId))[0].matchStatus).toBe("unmatched");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("what an owner can see", () => {
  it("a landlord sees their own approved statements only — not drafts, not another owner's", async () => {
    const m = monthAgo(20);
    await receive(7000, m.y, m.m, 10);
    const g = await gen(m.y, m.m);
    expect(g.status).toBe(201);
    const listA = (await authedGet(app, S, landlordA.token)).body as any[];
    expect(listA.map(s => s.id)).not.toContain(g.body.id);                               // still a draft
    expect((await authedGet(app, `${S}/${g.body.id}`, landlordA.token)).status).toBe(404);
    await authedPatch(app, `${S}/${g.body.id}/approve`, ctx.adminToken);
    expect(((await authedGet(app, S, landlordA.token)).body as any[]).map(s => s.id)).toContain(g.body.id);
    expect((await authedGet(app, `${S}/${g.body.id}`, landlordA.token)).status).toBe(200);
    expect((await authedGet(app, S, landlordB.token)).body).toHaveLength(0);
    expect((await authedGet(app, `${S}/${g.body.id}`, landlordB.token)).status).toBe(404);
    expect((await authedGet(app, `${S}/${g.body.id}`, other.adminToken)).status).toBe(404);
  });

  it("the management pack is scoped to the owner's own property and works without a loop-back request", async () => {
    const m = monthAgo(20);
    const mine = await authedGet(app, `${S}/management-pack/${ctx.propertyId}/${m.y}/${m.m}`, landlordA.token);
    expect(mine.status, JSON.stringify(mine.body).slice(0, 200)).toBe(200);
    expect(mine.body.rentRoll.rentRoll.length).toBeGreaterThan(0);
    expect(mine.body.statement.status).toBe("approved");
    expect((await authedGet(app, `${S}/management-pack/${ctx.propertyId}/${m.y}/${m.m}`, landlordB.token)).status).toBe(404);
    expect((await authedGet(app, `${S}/management-pack/${ctx.propertyId}/${m.y}/${m.m}`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, `${S}/management-pack/${ctx.propertyId}/${m.y}/13`, ctx.adminToken)).status).toBe(400);
    expect((await authedGet(app, `${S}/management-pack/${ctx.propertyId}/${m.y}/${m.m}`, ctx.tenantToken)).status).toBe(403);
  });

  it("the rent roll rejects a malformed month and a malformed property", async () => {
    expect((await authedGet(app, `${S}/rent-roll?month=2026-13`, ctx.adminToken)).status).toBe(400);
    expect((await authedGet(app, `${S}/rent-roll?month=banana`, ctx.adminToken)).status).toBe(400);
    expect((await authedGet(app, `${S}/rent-roll?propertyId=abc`, ctx.adminToken)).status).toBe(400);
    const ok = await authedGet(app, `${S}/rent-roll?month=${M1.y}-${pad(M1.m)}`, ctx.adminToken);
    expect(ok.status).toBe(200);
    expect(ok.body.summary.totalUnits).toBeGreaterThan(0);
    // another organisation's roll never contains this organisation's units
    const foreign = await authedGet(app, `${S}/rent-roll`, other.adminToken);
    const ids = (foreign.body.rentRoll as any[]).map(r => r.unitId);
    expect(ids).not.toContain(ctx.unitId);
  });
});
