/**
 * reports-analytics.test.ts — every money figure in analytics, reports, exports and statements is CASH RECEIVED,
 * on the same definition as the dashboards (services/rent-ledger.ts).
 *
 * Fixture (one fresh org, one tenant, EAT "today" T):
 *   A  10,000 due T-3  → part-paid 4,000          (status partial, 6,000 left)
 *   B   6,000 due T-2  → paid in full 6,000
 *   C   5,000 due T-1  → overdue, nothing paid
 *   expenses: 1,000 approved + 700 pending (the pending one is not a cost yet)
 *
 *   revenue            = 4,000 + 6,000 = 10,000        (not 6,000 "paid invoices", not 21,000 "invoiced")
 *   billed             = 21,000 ; paid against it 10,000 → collection rate 48%
 *   overdue            = 5,000 (1 invoice) ; pending/partial balance = 6,000
 *   expenses           = 1,000 ; net = 9,000
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, type TestContext } from "./helpers";
import supertest from "supertest";
import { db } from "../db";
import { rentPayments, paymentReceipts, generalLedger, propertyExpenses } from "@shared/schema";
import { eq, like, inArray } from "drizzle-orm";
import { todayEAT, rentCashRows } from "../services/rent-ledger";

let app: any;
let ctx: TestContext;
let ctx2: TestContext;
const ids: number[] = [];
let idC = 0;
const tag = () => `RPT-${Date.now() % 1_000_000}`;
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const T = todayEAT();

async function invoice(amount: number, due: string, name: string) {
  const r = await authedPost(app, "/api/rent-payments", ctx.adminToken, { tenantId: ctx.tenantId, amount: String(amount), dueDate: due, invoiceNumber: `${tag()}-${name}` });
  expect(r.status).toBe(201);
  ids.push(r.body.id);
  return r.body.id as number;
}

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  ctx2 = await setupTestData();   // a second, unrelated organisation

  const a = await invoice(10_000, addDays(T, -3), "A");
  const b = await invoice(6_000, addDays(T, -2), "B");
  idC = await invoice(5_000, addDays(T, -1), "C");
  expect((await authedPost(app, `/api/rent-payments/${a}/mark-paid`, ctx.adminToken, { amount: 4_000, paymentMethod: "mpesa" })).status).toBe(200);
  expect((await authedPost(app, `/api/rent-payments/${b}/mark-paid`, ctx.adminToken, { paymentMethod: "cash" })).status).toBe(200);
  await db.update(rentPayments).set({ status: "overdue" }).where(eq(rentPayments.id, idC));

  const exp = (amount: number, status: string) => db.insert(propertyExpenses).values({
    expenseNumber: `EXP-RPT-${Date.now() % 100000}-${amount}`, propertyId: ctx.propertyId, amount: String(amount),
    category: "maintenance", description: "test", vendorName: "Test vendor", expenseDate: new Date(), status,
    createdBy: ctx.adminUserId,
  } as any);
  await exp(1_000, "approved");
  await exp(700, "pending");
});

afterAll(async () => {
  await db.delete(propertyExpenses).where(eq(propertyExpenses.propertyId, ctx.propertyId)).catch(() => {});
  if (ids.length) {
    await db.delete(paymentReceipts).where(inArray(paymentReceipts.paymentId, ids)).catch(() => {});
    await db.delete(rentPayments).where(inArray(rentPayments.id, ids)).catch(() => {});
  }
  await db.delete(generalLedger).where(like(generalLedger.reference, "GL-RENT-RPT-%")).catch(() => {});
  await cleanupTestData(ctx);
  await cleanupTestData(ctx2);
});

describe("GET /api/analytics/financial", () => {
  it("revenue = cash received, expenses = approved only, collection rate = paid ÷ billed", async () => {
    const r = await authedGet(app, "/api/analytics/financial?timeframe=30d", ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.body.totalRevenue).toBe(10_000);
    expect(r.body.totalExpenses).toBe(1_000);
    expect(r.body.netIncome).toBe(9_000);
    expect(r.body.collectionRate).toBe(48);
    expect(r.body.overdueCount).toBe(1);
    expect(r.body.overdueAmount).toBe(5_000);
  });

  it("the monthly trend always has six zero-filled months and this month holds the cash", async () => {
    const r = await authedGet(app, "/api/analytics/financial", ctx.adminToken);
    expect(r.body.monthlyTrend).toHaveLength(6);
    const total = r.body.monthlyTrend.reduce((s: number, m: any) => s + m.revenue, 0);
    expect(total).toBe(10_000);
  });

  it("a different organisation sees none of it", async () => {
    const r = await authedGet(app, "/api/analytics/financial?timeframe=1y", ctx2.adminToken);
    expect(r.body.totalRevenue).toBe(0);
    expect(r.body.totalExpenses).toBe(0);
    expect(r.body.overdueCount).toBe(0);
  });

  it("previous period is bounded: money received today is not also in last period", async () => {
    const r = await authedGet(app, "/api/analytics/financial?timeframe=7d", ctx.adminToken);
    expect(r.body.totalRevenue).toBe(10_000);
    expect(r.body.prevRevenue).toBe(0);
  });
});

describe("GET /api/analytics/tenants + /property", () => {
  it("payment performance is the same amount-based collection rate", async () => {
    const r = await authedGet(app, "/api/analytics/tenants?timeframe=30d", ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.body.paymentPerformance).toBe(48);
  });

  it("per-property revenue is this calendar month's cash", async () => {
    const r = await authedGet(app, "/api/analytics/property", ctx.adminToken);
    expect(r.status).toBe(200);
    const p = r.body.find((x: any) => x.id === ctx.propertyId);
    // the fixture's payments may straddle a month boundary, so compare with the ledger itself
    const month = (await rentCashRows(ctx.propertyId, `${T.slice(0, 7)}-01`, T)).reduce((s, c) => s + c.amount, 0);
    expect(p.revenueThisMonth).toBe(month);
  });
});

describe("POST /api/reports/generate", () => {
  const gen = (body: object, token = ctx.adminToken) => authedPost(app, "/api/reports/generate", token, body);

  it("financial: received, approved expenses, balances still owed", async () => {
    const r = await gen({ reportType: "financial", startDate: addDays(T, -30), endDate: T });
    expect(r.status).toBe(200);
    expect(r.body.data.totalRevenue).toBe(10_000);
    expect(r.body.data.totalExpenses).toBe(1_000);
    expect(r.body.data.netIncome).toBe(9_000);
    expect(r.body.data.totalOverdue).toBe(5_000);
    expect(r.body.data.totalPending).toBe(6_000);          // what is left on the part-paid invoice, not its 10,000
    expect(r.body.data.paymentCount).toBe(2);              // two payments, even though three invoices exist
  });

  it("rent-collection: by method, billed, overdue balance and rate", async () => {
    const r = await gen({ reportType: "rent-collection", startDate: addDays(T, -30), endDate: T });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.totalCollected).toBe(10_000);
    expect(d.totalBilled).toBe(21_000);
    expect(d.totalOverdue).toBe(5_000);
    expect(d.overdueCount).toBe(1);
    expect(d.collectionRate).toBe(48);
    expect(Object.fromEntries(d.byMethod.map((m: any) => [m.method, m.amount]))).toEqual({ mpesa: 4_000, cash: 6_000 });
  });

  it("a window with no payments reports zero cash, and keeps the invoice out of it", async () => {
    const r = await gen({ reportType: "financial", startDate: "2020-01-01", endDate: "2020-01-31" });
    expect(r.body.data.totalRevenue).toBe(0);
    expect(r.body.data.paymentCount).toBe(0);
  });

  it("another organisation gets nothing", async () => {
    const r = await gen({ reportType: "financial", startDate: addDays(T, -30), endDate: T }, ctx2.adminToken);
    expect(r.body.data.totalRevenue).toBe(0);
    expect(r.body.data.totalPending).toBe(0);
  });
});

describe("CSV exports", () => {
  it("payments export lists Paid and Balance per invoice", async () => {
    const r = await authedGet(app, `/api/reports/export/payments?startDate=${addDays(T, -30)}&endDate=${T}`, ctx.adminToken);
    expect(r.status).toBe(200);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("ID,Tenant,Amount,Paid,Balance,Status,Due Date,Method,Invoice,Created");
    const a = lines.find((l: string) => l.includes("-A"))!;
    expect(a).toContain('"10000.00"');
    expect(a).toContain('"4000"');     // paid
    expect(a).toContain('"6000"');     // balance
    expect(a).toContain('"partial"');
  });

  it("properties export reports cash collected for the window", async () => {
    const r = await authedGet(app, `/api/reports/export/properties?startDate=${addDays(T, -30)}&endDate=${T}`, ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.text).toContain('"10000"');
  });
});

describe("owner statements use the same cash", () => {
  it("cash rows for a property = the receipts, one per payment", async () => {
    const rows = await rentCashRows(ctx.propertyId, addDays(T, -30), T);
    expect(rows.map(r => r.amount).sort((x, y) => x - y)).toEqual([4_000, 6_000]);
  });
});

describe("KRA monthly return takes gross rent from cash received", () => {
  it("rejects a bad month and a property outside the organisation", async () => {
    const bad = await authedPost(app, "/api/compliance/kra/returns/generate", ctx.adminToken, { landlordUserId: ctx.adminUserId, propertyId: ctx.propertyId, year: 2026, month: 13 });
    expect(bad.status).toBe(400);
    const foreign = await authedPost(app, "/api/compliance/kra/returns/generate", ctx.adminToken, { landlordUserId: ctx.adminUserId, propertyId: ctx2.propertyId, year: Number(T.slice(0, 4)), month: Number(T.slice(5, 7)) });
    expect(foreign.status).toBe(404);
  });

  it("gross rent equals what was received in that month (part payments included)", async () => {
    const y = Number(T.slice(0, 4)), m = Number(T.slice(5, 7));
    const r = await authedPost(app, "/api/compliance/kra/returns/generate", ctx.adminToken, { landlordUserId: ctx.adminUserId, propertyId: ctx.propertyId, year: y, month: m });
    expect(r.status).toBe(200);
    const month = (await rentCashRows(ctx.propertyId, `${T.slice(0, 7)}-01`, T)).reduce((s, c) => s + c.amount, 0);
    expect(Number(r.body.grossRent)).toBe(month);
  });

  it("another organisation cannot read or alter this return", async () => {
    const list = await authedGet(app, `/api/compliance/kra/returns/${ctx.adminUserId}`, ctx2.adminToken);
    expect(list.body).toEqual([]);
    const mine = await authedGet(app, `/api/compliance/kra/returns/${ctx.adminUserId}`, ctx.adminToken);
    const id = mine.body[0].id;
    const patch = await authedPatch(app, `/api/compliance/kra/returns/${id}`, ctx2.adminToken, { status: "filed" });
    expect(patch.status).toBe(404);
    const own = await authedPatch(app, `/api/compliance/kra/returns/${id}`, ctx.adminToken, { status: "filed", grossRent: "1" });
    expect(own.status).toBe(200);
    expect(own.body.status).toBe("filed");
    expect(Number(own.body.grossRent)).not.toBe(1);   // computed figures cannot be overwritten
  });
});

describe("Pesapal / plan catalogue stay public", () => {
  it("GET /api/billing/plans needs no token", async () => {
    const r = await supertest(app).get("/api/billing/plans");
    expect(r.status).toBe(200);
  });
});
