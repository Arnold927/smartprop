/**
 * rent-ledger.test.ts — the money rules every payment screen relies on.
 *
 * One payment engine (services/rent-ledger.ts) sits behind manual "mark paid", M-Pesa (STK + paybill), the utility-bill
 * paths and the maintenance repair charge. These tests pin its rules through the public API:
 *
 *   mark-paid   full → paid (+ receipt + ledger) · part → "partial" with balance · many parts add up · overpayment 400 ·
 *               already-paid 409 · future date 400 · amount 0 / negative / NaN 400 · tenants cannot record payments
 *   editing     status cannot be forced to paid/partial through PATCH · a paid invoice is locked · the amount can never
 *               drop below what was received
 *   deleting    paid or part-paid invoices cannot be deleted; an untouched one can
 *   late fee    needs a positive amount ≤ invoice, only once, only when past due and unpaid
 *   utility     bills: duplicate period 409, amount = consumption × rate, zero consumption 400, paid bills locked
 *   reporting   stats collected = money received (incl. part payments); GL balances (debit = credit)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, authedPut, type TestContext } from "./helpers";
import supertest from "supertest";
import { db } from "../db";
import { rentPayments, paymentReceipts, generalLedger, utilityBills } from "@shared/schema";
import { eq, and, like, sql } from "drizzle-orm";
import { paidToDate, rentBalance } from "../services/rent-ledger";

let app: any;
let ctx: TestContext;
const made: number[] = [];
let seq = 0;
const tag = () => `LEDG-${Date.now() % 1_000_000}-${++seq}`;

async function invoice(amount = 10_000, due = "2026-01-05"): Promise<number> {
  const r = await authedPost(app, "/api/rent-payments", ctx.adminToken, { tenantId: ctx.tenantId, amount: String(amount), dueDate: due, invoiceNumber: tag() });
  expect(r.status).toBe(201);
  made.push(r.body.id);
  return r.body.id;
}
const row = async (id: number) => (await db.select().from(rentPayments).where(eq(rentPayments.id, id)))[0];
const balanceOf = async (id: number) => { const r = await row(id); return (await rentBalance({ id, amount: r.amount, status: r.status })).balance; };
const pay = (id: number, body: object, token = ctx.adminToken) => authedPost(app, `/api/rent-payments/${id}/mark-paid`, token, body);

beforeAll(async () => { app = await getApp(); ctx = await setupTestData(); });
afterAll(async () => {
  for (const id of made) {
    await db.delete(paymentReceipts).where(eq(paymentReceipts.paymentId, id)).catch(() => {});
    await db.delete(rentPayments).where(eq(rentPayments.id, id)).catch(() => {});
  }
  await db.delete(generalLedger).where(like(generalLedger.reference, "GL-RENT-LEDG-%")).catch(() => {});
  await db.delete(utilityBills).where(like(utilityBills.notes, "LEDG%")).catch(() => {});
  await cleanupTestData(ctx);
});

describe("mark-paid", () => {
  it("full payment → paid, one receipt, balanced ledger entry", async () => {
    const id = await invoice(10_000);
    const r = await pay(id, { paidDate: "2026-01-06", paymentMethod: "cash" });
    expect(r.status).toBe(200);
    expect((await row(id)).status).toBe("paid");
    expect(await paidToDate({ kind: "rent", id })).toBe(10_000);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(paymentReceipts).where(eq(paymentReceipts.paymentId, id));
    expect(n).toBe(1);
    const gl = await db.select().from(generalLedger).where(eq(generalLedger.reference, `GL-RENT-${(await row(id)).invoiceNumber}`));
    // a brand-new organisation has no chart of accounts yet — it is created on the first receipt, so the books never miss cash
    const dr = gl.reduce((s, g) => s + Number(g.debitAmount ?? 0), 0), cr = gl.reduce((s, g) => s + Number(g.creditAmount ?? 0), 0);
    expect(dr).toBe(10_000); expect(cr).toBe(10_000);
  });

  it("defaults: no body → settles the whole balance today as cash", async () => {
    const id = await invoice(2_500);
    expect((await pay(id, {})).status).toBe(200);
    expect((await row(id)).status).toBe("paid");
  });

  it("part payment → 'partial', balance tracked; the rest settles it", async () => {
    const id = await invoice(10_000);
    expect((await pay(id, { amount: 4_000 })).status).toBe(200);
    expect((await row(id)).status).toBe("partial");
    expect(await balanceOf(id)).toBe(6_000);
    expect((await pay(id, { amount: 2_500 })).status).toBe(200);
    expect((await row(id)).status).toBe("partial");
    expect((await pay(id, {})).status).toBe(200);            // no amount → the remaining 3,500
    expect((await row(id)).status).toBe("paid");
    expect(await paidToDate({ kind: "rent", id })).toBe(10_000);
  });

  it("overpayment is refused (400) and records nothing", async () => {
    const id = await invoice(5_000);
    const r = await pay(id, { amount: 5_000.5 });
    expect(r.status).toBe(400);
    expect(await paidToDate({ kind: "rent", id })).toBe(0);
    expect((await row(id)).status).toBe("pending");
  });

  it("already paid → 409, never a second receipt", async () => {
    const id = await invoice(3_000);
    await pay(id, {});
    expect((await pay(id, {})).status).toBe(409);
    expect(await paidToDate({ kind: "rent", id })).toBe(3_000);
  });

  it.each([[0], [-5], ["abc"]])("bad amount %s → 400", async (amount) => {
    const id = await invoice(1_000);
    expect((await pay(id, { amount })).status).toBe(400);
  });

  it("a payment date in the future → 400", async () => {
    const id = await invoice(1_000);
    expect((await pay(id, { paidDate: "2099-01-01" })).status).toBe(400);
  });

  it("a tenant cannot record a payment", async () => {
    const id = await invoice(1_000);
    expect([401, 403]).toContain((await pay(id, {}, ctx.tenantToken)).status);
    expect((await row(id)).status).toBe("pending");
  });
});

describe("editing and deleting invoices", () => {
  it("PATCH cannot force status to paid / partial", async () => {
    const id = await invoice(1_000);
    expect((await authedPatch(app, `/api/rent-payments/${id}`, ctx.adminToken, { status: "paid" })).status).toBe(400);
    expect((await authedPatch(app, `/api/rent-payments/${id}`, ctx.adminToken, { status: "partial" })).status).toBe(400);
    expect((await row(id)).status).toBe("pending");
  });

  it("a paid invoice is locked; a part-paid one cannot drop below what was received", async () => {
    const paid = await invoice(1_000); await pay(paid, {});
    expect((await authedPatch(app, `/api/rent-payments/${paid}`, ctx.adminToken, { amount: "10" })).status).toBe(409);
    const part = await invoice(10_000); await pay(part, { amount: 6_000 });
    expect((await authedPatch(app, `/api/rent-payments/${part}`, ctx.adminToken, { amount: "5000" })).status).toBe(409);
    expect((await authedPatch(app, `/api/rent-payments/${part}`, ctx.adminToken, { amount: "8000" })).status).toBe(200);
    expect(await balanceOf(part)).toBe(2_000);
  });

  it("paid or part-paid invoices cannot be deleted; an untouched one can", async () => {
    const paid = await invoice(1_000); await pay(paid, {});
    const part = await invoice(1_000); await pay(part, { amount: 100 });
    const fresh = await invoice(1_000);
    const del = (id: number) => supertest(app).delete(`/api/rent-payments/${id}`).set("Authorization", `Bearer ${ctx.adminToken}`);
    expect((await del(paid)).status).toBe(409);
    expect((await del(part)).status).toBe(409);
    expect((await del(fresh)).status).toBe(204);
    expect(await row(fresh)).toBeUndefined();
  });

  it("two invoices cannot be created with the same number", async () => {
    const num = tag();
    const a = await authedPost(app, "/api/rent-payments", ctx.adminToken, { tenantId: ctx.tenantId, amount: "100", dueDate: "2026-02-01", invoiceNumber: num });
    made.push(a.body.id);
    expect((await authedPost(app, "/api/rent-payments", ctx.adminToken, { tenantId: ctx.tenantId, amount: "100", dueDate: "2026-02-01", invoiceNumber: num })).status).toBe(409);
  });
});

describe("late fee", () => {
  it("applies once, only when past due and unpaid, never above the invoice", async () => {
    const late = (id: number, amount: unknown) => authedPost(app, `/api/rent-payments/${id}/apply-late-fee`, ctx.adminToken, { amount });
    const id = await invoice(10_000, "2025-01-01");              // long past due
    expect((await late(id, 0)).status).toBe(400);
    expect((await late(id, -50)).status).toBe(400);
    expect((await late(id, 20_000)).status).toBe(400);           // more than the invoice
    expect((await late(id, 500)).status).toBe(200);
    expect(Number((await row(id)).amount)).toBe(10_500);
    expect((await late(id, 500)).status).toBe(409);              // once only
    expect(Number((await row(id)).amount)).toBe(10_500);

    const future = await invoice(1_000, "2099-01-01");
    expect((await late(future, 50)).status).toBe(409);           // not due yet
    const paid = await invoice(1_000, "2025-01-01"); await pay(paid, {});
    expect((await late(paid, 50)).status).toBe(409);             // already settled
  });
});

describe("reporting", () => {
  it("stats: collected counts money received incl. part payments; outstanding is the balance", async () => {
    const before = (await authedGet(app, "/api/rent-payments/stats?all=1", ctx.adminToken)).body;
    const id = await invoice(10_000, "2099-03-01");
    await pay(id, { amount: 4_000 });
    const after = (await authedGet(app, "/api/rent-payments/stats?all=1", ctx.adminToken)).body;
    expect(Number(after.collected) - Number(before.collected)).toBe(4_000);
  });
});

describe("utility bills", () => {
  const bill = (over: object = {}) => ({ tenantId: ctx.tenantId, utilityType: "water", previousReading: 100, currentReading: 140, unitCost: 12.5,
    billingPeriodStart: "2026-03-01", billingPeriodEnd: "2026-03-31", dueDate: "2026-04-10", notes: "LEDG util", ...over });

  it("amount = consumption × rate; the same period cannot be billed twice; the bill is saved even if email is unavailable", async () => {
    const r = await authedPost(app, "/api/utility-bills/send-email", ctx.adminToken, bill());
    expect(r.status).toBe(200);
    expect(r.body.totalAmount).toBe(500);
    const [b] = await db.select().from(utilityBills).where(and(eq(utilityBills.tenantId, ctx.tenantId), eq(utilityBills.billNumber, r.body.billNumber)));
    expect(Number(b.amount)).toBe(500);
    expect(b.status).toBe("pending");
    expect((await authedPost(app, "/api/utility-bills/send-email", ctx.adminToken, bill())).status).toBe(409);
  });

  it("zero consumption, backwards readings and reversed periods are refused", async () => {
    const p = (o: object) => authedPost(app, "/api/utility-bills/send-email", ctx.adminToken, bill({ billingPeriodStart: "2026-05-01", billingPeriodEnd: "2026-05-31", dueDate: "2026-06-10", ...o }));
    expect((await p({ currentReading: 100 })).status).toBe(400);
    expect((await p({ currentReading: 50 })).status).toBe(400);
    expect((await p({ billingPeriodStart: "2026-05-31", billingPeriodEnd: "2026-05-01" })).status).toBe(400);
    expect((await p({ unitCost: -1 })).status).toBe(400);
  });

  it("marking a bill paid records a receipt; a paid bill cannot be edited or deleted", async () => {
    const r = await authedPost(app, "/api/utility-bills/send-email", ctx.adminToken, bill({ billingPeriodStart: "2026-07-01", billingPeriodEnd: "2026-07-31", dueDate: "2026-08-10", currentReading: 120 }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [b] = await db.select().from(utilityBills).where(eq(utilityBills.billNumber, r.body.billNumber));
    expect((await authedPut(app, `/api/utility-bills/${b.id}`, ctx.adminToken, { status: "paid", paymentMethod: "cash", paidDate: "2026-07-20" })).status).toBe(200);
    expect(await paidToDate({ kind: "utility", id: b.id })).toBe(250);
    expect((await authedPut(app, `/api/utility-bills/${b.id}`, ctx.adminToken, { amount: "1" })).status).toBe(409);
    const del = await supertest(app).delete(`/api/utility-bills/${b.id}`).set("Authorization", `Bearer ${ctx.adminToken}`);
    expect(del.status).toBe(409);
  });
});
