/**
 * lease-lifecycle.test.ts — lease create → sign → activate → renew → expire/terminate → deposit settlement.
 *
 *   create       real dates, end after start, unit must be in the org / the property / free, no overlapping live lease
 *   sign/activate  needs both signatures (or an explicit paper-copy confirmation), one signature per party, editing
 *                  signed terms clears them; activation syncs tenant + unit and refuses a double booking
 *   renew        drafts a renewal while the old lease stays ACTIVE; one renewal at a time; activating it retires the old
 *                lease; the deposit follows the chain
 *   end          terminate now (lease + tenant + unit + login in one step) · future date only schedules · cancel · the
 *                daily job executes it · expiry leaves the tenant holding over
 *   deposit      cap at the lease deposit · no future dates · refunds only after the lease ends · concurrent refunds
 *   settlement   deposit − unpaid rent − unpaid bills − deductions → refund, through the payment ledger, once
 *   ownership    a landlord who does not own the property gets 404 on every endpoint; tenants get 403
 *   scheduler    expiry notices fire when a lease is INSIDE the window (not only on the exact day)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import {
  users, units, tenants, properties, leases, leaseEvents, depositTransactions, rentPayments, paymentReceipts,
  utilityBills, generalLedger, chartOfAccounts, propertyInspections,
} from "@shared/schema";
import { eq, and, inArray, like, sql } from "drizzle-orm";
import { todayEAT } from "../services/rent-ledger";
import { addDays, termEnd, isRealDate, monthsBetween } from "../services/lease-lifecycle";
import { autoExpireLeases, sendExpiryNotices } from "../services/leaseScheduler";

let app: any;
let ctx: TestContext;
let other: TestContext;                       // a second organisation
let landlordA: { id: string; token: string; propertyId: number };
let landlordB: { id: string; token: string; propertyId: number };
const today = todayEAT();
const YEAR = Number(today.slice(0, 4));
let seq = 0;

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}

/** A unit + tenant (with its own login) in the main organisation, optionally on a given property. */
async function newTenant(propertyId = ctx.propertyId, opts: { occupy?: boolean } = {}) {
  const n = ++seq;
  const [unit] = await db.insert(units).values({ organizationId: ctx.orgId, propertyId, unitNumber: `LC-${n}-${Date.now() % 100000}`, monthlyRent: "30000", currency: "KES", isOccupied: false, unitType: "apartment" } as any).returning();
  const email = `lc-${n}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const [u] = await db.insert(users).values({ id: randomUUID(), email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Lc", lastName: `T${n}`, role: "tenant", organizationId: ctx.orgId, emailVerified: true } as any).returning();
  const [t] = await db.insert(tenants).values({ organizationId: ctx.orgId, userId: u.id, firstName: "Lc", lastName: `T${n}`, email, unitId: null, monthlyRent: "30000", currency: "KES", status: "active" } as any).returning();
  return { unitId: unit.id, tenantId: t.id, userId: u.id };
}

const body = (t: { tenantId: number; unitId: number }, extra: object = {}) => ({
  tenantId: t.tenantId, unitId: t.unitId, startDate: `${YEAR}-01-01`, endDate: `${YEAR + 1}-12-31`, monthlyRent: 30000, securityDeposit: 60000, ...extra,
});
const create = (t: any, extra: object = {}, token = ctx.adminToken) => authedPost(app, "/api/leases", token, body(t, extra));
const L = (id: number, ep: string, token = ctx.adminToken, b: object = {}) => authedPost(app, `/api/leases/${id}/${ep}`, token, b);
async function signed(id: number, token = ctx.adminToken) {
  await L(id, "send-for-signing", token); await L(id, "sign", token, { signer: "manager" }); await L(id, "sign", token, { signer: "tenant" });
}
async function active(t: any, extra: object = {}, token = ctx.adminToken) {
  const c = await create(t, extra, token); expect(c.status).toBe(201);
  await signed(c.body.id, token);
  const a = await L(c.body.id, "activate", token); expect(a.status).toBe(200);
  return c.body.id as number;
}
const deposit = (id: number, type: string, amount: number, date = today, token = ctx.adminToken) =>
  authedPost(app, `/api/leases/${id}/deposit`, token, { transactionType: type, amount, reason: "test", transactionDate: date });
const lease = async (id: number) => (await db.select().from(leases).where(eq(leases.id, id)))[0];
const tenantRow = async (id: number) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0];
const unitRow = async (id: number) => (await db.select().from(units).where(eq(units.id, id)))[0];
const money = (v: any) => Number(v);

async function makeLandlord(orgId: number, tag: string) {
  const email = `ll-${tag.toLowerCase()}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Land", lastName: tag, role: "landlord", organizationId: orgId, emailVerified: true } as any);
  const [p] = await db.insert(properties).values({ organizationId: orgId, name: `LL ${tag}`, address: "Somewhere", totalUnits: 5, ownerId: id } as any).returning();
  return { id, token: await login(email), propertyId: p.id };
}

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  other = await setupTestData();
  landlordA = await makeLandlord(ctx.orgId, "A");
  landlordB = await makeLandlord(ctx.orgId, "B");
});

afterAll(async () => {
  for (const c of [ctx, other]) {
    const tIds = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, c.orgId))).map(t => t.id);
    if (tIds.length) {
      await db.delete(paymentReceipts).where(inArray(paymentReceipts.tenantId, tIds)).catch(() => {});
      await db.delete(rentPayments).where(inArray(rentPayments.tenantId, tIds)).catch(() => {});
      await db.delete(utilityBills).where(inArray(utilityBills.tenantId, tIds)).catch(() => {});
    }
    await db.delete(generalLedger).where(eq(generalLedger.organizationId, c.orgId)).catch(() => {});
    await db.delete(chartOfAccounts).where(eq(chartOfAccounts.organizationId, c.orgId)).catch(() => {});
    await db.delete(propertyInspections).where(eq(propertyInspections.organizationId, c.orgId)).catch(() => {});
    await db.delete(depositTransactions).where(eq(depositTransactions.organizationId, c.orgId)).catch(() => {});
    await db.delete(leaseEvents).where(eq(leaseEvents.organizationId, c.orgId)).catch(() => {});
    await db.update(leases).set({ previousLeaseId: null } as any).where(eq(leases.organizationId, c.orgId)).catch(() => {});
    await db.delete(leases).where(eq(leases.organizationId, c.orgId)).catch(() => {});
  }
  await cleanupTestData(ctx);
  await cleanupTestData(other);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("date helpers", () => {
  it("rejects impossible dates and keeps month-ends sane", () => {
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("garbage")).toBe(false);
    expect(termEnd("2026-01-01", 12)).toBe("2026-12-31");
    expect(termEnd("2026-01-31", 1)).toBe("2026-02-27");   // 28 Feb − 1 day, never spilling into March
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthsBetween("2026-01-01", "2026-12-31")).toBe(12);
  });
});

describe("create", () => {
  it("creates a draft, recording a deposit already paid in the ledger", async () => {
    const t = await newTenant();
    const r = await create(t, { depositPaidDate: `${YEAR}-01-02` });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    expect(r.body.propertyId).toBe(ctx.propertyId);
    expect(r.body.leaseDurationMonths).toBe(24);
    const d = await authedGet(app, `/api/leases/${r.body.id}/deposit`, ctx.adminToken);
    expect(d.body.currentBalance).toBe(60000);
  });

  it("rejects bad dates, end ≤ start, impossible days, negative rent", async () => {
    const t = await newTenant();
    expect((await create(t, { startDate: `${YEAR}-12-31`, endDate: `${YEAR}-01-01` })).status).toBe(400);
    expect((await create(t, { startDate: `${YEAR}-02-31` })).status).toBe(400);
    expect((await create(t, { monthlyRent: -1 })).status).toBe(400);
  });

  it("will not use another organisation's unit or tenant", async () => {
    const t = await newTenant();
    const foreign = await create({ tenantId: t.tenantId, unitId: other.unitId });
    expect([400, 404]).toContain(foreign.status);
    const foreignTenant = await create({ tenantId: other.tenantId, unitId: t.unitId });
    expect(foreignTenant.status).toBe(404);
  });

  it("refuses a unit that another tenant holds, and overlapping live leases", async () => {
    const a = await newTenant(), b = await newTenant();
    await active(a);
    const clash = await create({ tenantId: b.tenantId, unitId: a.unitId });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("UNIT_OCCUPIED");
    const overlap = await create(a, { startDate: `${YEAR}-06-01`, endDate: `${YEAR + 2}-05-31` });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe("LEASE_OVERLAP");
  });

  it("POST /api/tenants refuses a unit that is already occupied", async () => {
    const a = await newTenant();
    await active(a);
    const r = await authedPost(app, "/api/tenants", ctx.adminToken, {
      firstName: "Dup", lastName: "Tenant", email: `dup-${Date.now()}@smartprop-test.local`, phone: "+254700000123",
      unitId: a.unitId, monthlyRent: "1000", leaseStartDate: `${YEAR}-01-01`, leaseEndDate: `${YEAR}-12-31`,
    });
    expect(r.status).toBe(409);
  });

  it("numbers are unique even when created at the same moment", async () => {
    const ts = await Promise.all([newTenant(), newTenant(), newTenant()]);
    const rs = await Promise.all(ts.map(t => create(t)));
    expect(rs.every(r => r.status === 201)).toBe(true);
    expect(new Set(rs.map(r => r.body.leaseNumber)).size).toBe(3);
  });

  it("warns (does not block) when a residential deposit exceeds 2 months' rent", async () => {
    const t = await newTenant();
    const r = await create(t, { securityDeposit: 100000 });
    expect(r.status).toBe(201);
    expect(r.body.complianceWarnings.length).toBe(1);
  });
});

describe("sign and activate", () => {
  it("needs both signatures, signs once per party, and syncs the tenant and unit", async () => {
    const t = await newTenant();
    const c = await create(t);
    expect((await L(c.body.id, "sign", ctx.adminToken, { signer: "manager" })).status).toBe(400);     // must be sent first
    expect((await L(c.body.id, "activate")).status).toBe(400);                                          // unsigned
    await L(c.body.id, "send-for-signing");
    expect((await L(c.body.id, "sign", ctx.adminToken, { signer: "manager" })).status).toBe(200);
    expect((await L(c.body.id, "sign", ctx.adminToken, { signer: "manager" })).status).toBe(409);      // never overwritten
    const half = await L(c.body.id, "activate");
    expect(half.status).toBe(400);
    expect(half.body.code).toBe("UNSIGNED");
    expect(half.body.needsTenantSignature).toBe(true);
    await L(c.body.id, "sign", ctx.adminToken, { signer: "tenant" });
    expect((await L(c.body.id, "activate")).status).toBe(200);
    expect((await L(c.body.id, "activate")).status).toBe(400);                                          // already active
    const tr = await tenantRow(t.tenantId);
    expect(tr.unitId).toBe(t.unitId);
    expect(tr.status).toBe("active");
    expect(money(tr.monthlyRent)).toBe(30000);
    expect((await unitRow(t.unitId)).isOccupied).toBe(true);
  });

  it("allows activation on a confirmed paper copy and says so in the audit trail", async () => {
    const t = await newTenant();
    const c = await create(t);
    await L(c.body.id, "send-for-signing");
    expect((await L(c.body.id, "activate", ctx.adminToken, { confirmUnsigned: true })).status).toBe(200);
    const ev = await db.select().from(leaseEvents).where(and(eq(leaseEvents.leaseId, c.body.id), eq(leaseEvents.eventType, "activated")));
    expect((ev[0].metadata as any).unsignedOverride).toBe(true);
  });

  it("editing signed terms clears the signatures and returns the lease to draft", async () => {
    const t = await newTenant();
    const c = await create(t);
    await L(c.body.id, "send-for-signing");
    await L(c.body.id, "sign", ctx.adminToken, { signer: "manager" });
    expect((await authedPatch(app, `/api/leases/${c.body.id}`, ctx.adminToken, { monthlyRent: -5 })).status).toBe(400);
    expect((await authedPatch(app, `/api/leases/${c.body.id}`, ctx.adminToken, { endDate: "garbage" })).status).toBe(400);
    const p = await authedPatch(app, `/api/leases/${c.body.id}`, ctx.adminToken, { monthlyRent: 33000 });
    expect(p.status).toBe(200);
    expect(p.body.signaturesReset).toBe(true);
    const l = await lease(c.body.id);
    expect(l.status).toBe("draft");
    expect(l.signedByManagerAt).toBeNull();
  });

  it("cannot activate a lease whose term is already over", async () => {
    const t = await newTenant();
    const c = await create(t, { startDate: "2020-01-01", endDate: "2020-12-31" });
    const r = await L(c.body.id, "activate", ctx.adminToken, { confirmUnsigned: true });
    expect(r.status).toBe(400);
  });
});

describe("renewal", () => {
  it("keeps the old lease active until the renewal is activated; deposit follows the chain", async () => {
    const t = await newTenant();
    const oldId = await active(t, { securityDeposit: 60000, depositPaidDate: `${YEAR}-01-02`, escalationRate: 0.1 });
    const r = await L(oldId, "renew");
    expect(r.status).toBe(201);
    const newId = r.body.newLease.id;
    expect(r.body.newLease.status).toBe("draft");
    expect(money(r.body.newLease.monthlyRent)).toBe(33000);
    expect(r.body.newLease.startDate).toBe(`${YEAR + 2}-01-01`);          // the day after the old term ends
    expect((await lease(oldId)).status).toBe("active");
    expect((await L(oldId, "renew")).status).toBe(409);                    // one renewal at a time
    expect((await authedGet(app, `/api/leases/${oldId}`, ctx.adminToken)).body.renewal.id).toBe(newId);

    await signed(newId);
    expect((await L(newId, "activate")).status).toBe(200);
    expect((await lease(oldId)).status).toBe("renewed");
    expect(money((await tenantRow(t.tenantId)).monthlyRent)).toBe(33000);
    const d = await authedGet(app, `/api/leases/${newId}/deposit`, ctx.adminToken);
    expect(d.body.currentBalance).toBe(60000);                             // inherited from the lease it replaced
    expect(d.body.outstanding).toBe(0);
  });

  it("terminating a lease withdraws its pending renewal", async () => {
    const t = await newTenant();
    const oldId = await active(t);
    const newId = (await L(oldId, "renew")).body.newLease.id;
    expect((await L(oldId, "terminate", ctx.adminToken, { reason: "Leaving", terminationDate: today })).status).toBe(200);
    expect((await lease(newId)).status).toBe("terminated");
  });

  it("rejects a renewal that ends before it starts", async () => {
    const t = await newTenant();
    const oldId = await active(t);
    expect((await L(oldId, "renew", ctx.adminToken, { endDate: `${YEAR}-01-01` })).status).toBe(400);
    expect((await L(oldId, "renew", ctx.adminToken, { monthlyRent: -3 })).status).toBe(400);
  });
});

describe("ending a tenancy", () => {
  it("terminate now: lease, tenant, unit and login are all closed together", async () => {
    const t = await newTenant();
    const id = await active(t);
    expect((await L(id, "terminate", ctx.adminToken, { reason: "" })).status).toBe(400);
    expect((await L(id, "terminate", ctx.adminToken, { reason: "x", terminationDate: "2026-13-40" })).status).toBe(400);
    const r = await L(id, "terminate", ctx.adminToken, { reason: "Moved out", terminationDate: today });
    expect(r.status).toBe(200);
    expect(r.body.scheduled).toBe(false);
    expect(r.body.settlement.depositHeld).toBe(0);
    expect((await lease(id)).status).toBe("terminated");
    expect((await tenantRow(t.tenantId)).status).toBe("inactive");
    expect((await unitRow(t.unitId)).isOccupied).toBe(false);
    const [u] = await db.select().from(users).where(eq(users.id, t.userId));
    expect(u.isActive).toBe(false);
    expect((await L(id, "terminate", ctx.adminToken, { reason: "again" })).status).toBe(400);
  });

  it("a future date only SCHEDULES the termination; cancelling restores the end date; the daily job executes it", async () => {
    const t = await newTenant();
    const id = await active(t);
    const original = (await lease(id)).endDate;
    const future = addDays(today, 20);
    const r = await L(id, "terminate", ctx.adminToken, { reason: "Notice given", terminationDate: future });
    expect(r.status).toBe(200);
    expect(r.body.scheduled).toBe(true);
    expect((await tenantRow(t.tenantId)).status).toBe("active");           // still living there
    expect((await unitRow(t.unitId)).isOccupied).toBe(true);
    expect((await authedGet(app, `/api/leases/${id}`, ctx.adminToken)).body.scheduledTermination.date).toBe(future);

    expect((await L(id, "cancel-termination")).status).toBe(200);
    expect(String((await lease(id)).endDate)).toBe(String(original));
    expect((await L(id, "cancel-termination")).status).toBe(400);

    await L(id, "terminate", ctx.adminToken, { reason: "Notice given", terminationDate: future });
    await db.update(leases).set({ endDate: today } as any).where(eq(leases.id, id));     // the day arrives
    await autoExpireLeases();
    expect((await lease(id)).status).toBe("terminated");
    expect((await tenantRow(t.tenantId)).status).toBe("inactive");
    expect((await unitRow(t.unitId)).isOccupied).toBe(false);
  });

  it("refuses a termination date after the lease ends or before it starts", async () => {
    const t = await newTenant();
    const id = await active(t);
    expect((await L(id, "terminate", ctx.adminToken, { reason: "x", terminationDate: `${YEAR + 5}-01-01` })).status).toBe(400);
    expect((await L(id, "terminate", ctx.adminToken, { reason: "x", terminationDate: `${YEAR - 3}-01-01` })).status).toBe(400);
  });

  it("an expired lease keeps the tenant holding over, and can still be terminated", async () => {
    const t = await newTenant();
    const id = await active(t);
    await db.update(leases).set({ endDate: addDays(today, -3) } as any).where(eq(leases.id, id));
    await autoExpireLeases();
    expect((await lease(id)).status).toBe("expired");
    expect((await tenantRow(t.tenantId)).status).toBe("active");
    expect((await L(id, "terminate", ctx.adminToken, { reason: "Holdover ended", terminationDate: today })).status).toBe(200);
    expect((await unitRow(t.unitId)).isOccupied).toBe(false);
  });

  it("re-letting a former tenant switches their login back on", async () => {
    const t = await newTenant();
    const id = await active(t);
    await L(id, "terminate", ctx.adminToken, { reason: "Left", terminationDate: today });
    const again = await active(t);
    expect(again).toBeGreaterThan(id);
    const [u] = await db.select().from(users).where(eq(users.id, t.userId));
    expect(u.isActive).toBe(true);
    expect((await tenantRow(t.tenantId)).status).toBe("active");
  });
});

describe("deposit ledger", () => {
  it("never takes in more than the lease deposit, nor a future-dated movement", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 50000 });
    expect((await deposit(id, "received", 30000)).body.depositBalance).toBe(30000);
    expect((await deposit(id, "received", 30000)).status).toBe(400);       // would exceed 50 000
    expect((await deposit(id, "received", 20000)).body.depositBalance).toBe(50000);
    expect((await deposit(id, "received", 1)).status).toBe(400);
    expect((await deposit(id, "adjustment", 100, "2099-01-01")).status).toBe(400);
    expect((await deposit(id, "received", 0)).status).toBe(400);
    const led = (await authedGet(app, `/api/leases/${id}/deposit`, ctx.adminToken)).body;
    expect(led.received).toBe(50000);
    expect(led.outstanding).toBe(0);
    expect((await lease(id)).depositPaidDate).toBeTruthy();
  });

  it("refunds and forfeits only after the lease has ended, and never above the balance", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 40000, depositPaidDate: `${YEAR}-01-02` });
    expect((await deposit(id, "refunded", 1000)).status).toBe(400);        // still active
    await L(id, "terminate", ctx.adminToken, { reason: "Left", terminationDate: today });
    expect((await deposit(id, "partial_refund", 50000)).status).toBe(400); // more than held
    const r = await deposit(id, "forfeited", 15000);
    expect(r.status).toBe(201);
    expect(r.body.depositBalance).toBe(25000);
  });

  it("two simultaneous full refunds: exactly one wins and the balance never goes negative", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 60000, depositPaidDate: `${YEAR}-01-02` });
    await L(id, "terminate", ctx.adminToken, { reason: "Left", terminationDate: today });
    const rs = await Promise.all([deposit(id, "refunded", 60000), deposit(id, "refunded", 60000)]);
    expect(rs.map(r => r.status).sort()).toEqual([201, 400]);
    const [{ s }] = await db.select({ s: sql<string>`coalesce(sum(case when transaction_type in ('received','adjustment') then amount else -amount end),0)` }).from(depositTransactions).where(eq(depositTransactions.leaseId, id));
    expect(Number(s)).toBe(0);
  });
});

describe("move-out settlement", () => {
  async function invoice(tenantId: number, no: string, amount: number, due: string, status = "overdue") {
    const [r] = await db.insert(rentPayments).values({ tenantId, invoiceNumber: no, amount: String(amount), currency: "KES", dueDate: due, status } as any).returning();
    return r.id;
  }

  it("applies the deposit to unpaid rent and bills, deducts damages, refunds the rest — once", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 60000, depositPaidDate: `${YEAR}-01-02` });
    const tag = `LCSET${Date.now() % 100000}`;
    const i1 = await invoice(t.tenantId, `${tag}-1`, 20000, addDays(today, -60));
    const i2 = await invoice(t.tenantId, `${tag}-2`, 15000, addDays(today, -30), "partial");
    await db.insert(paymentReceipts).values({ paymentId: i2, tenantId: t.tenantId, receiptNumber: `${tag}-R`, amount: "5000", currency: "KES", paymentMethod: "cash", paymentDate: addDays(today, -20) } as any);
    const future = await invoice(t.tenantId, `${tag}-3`, 30000, addDays(today, 10), "pending");
    const [bill] = await db.insert(utilityBills).values({ tenantId: t.tenantId, utilityType: "water", billNumber: `${tag}-B`, billingPeriodStart: new Date(), billingPeriodEnd: new Date(), dueDate: new Date(Date.now() - 5 * 86400000), amount: "3000", currency: "KES", status: "pending" } as any).returning();
    await db.insert(propertyInspections).values({ organizationId: ctx.orgId, propertyId: ctx.propertyId, unitId: t.unitId, leaseId: id, tenantId: t.tenantId, inspectionNumber: `INS-${tag}`, inspectionType: "move_out", rooms: [], issuesFound: [{ x: 1 }], totalIssuesCost: "9000", recommendedDeduction: "8000", status: "completed", managerSignedAt: new Date() } as any);

    expect((await authedGet(app, `/api/leases/${id}/settlement`, ctx.adminToken)).body.canSettle).toBe(false);   // still active
    expect((await L(id, "settle-deposit")).status).toBe(400);
    await L(id, "terminate", ctx.adminToken, { reason: "Left", terminationDate: today });

    const p = (await authedGet(app, `/api/leases/${id}/settlement`, ctx.adminToken)).body;
    expect(p.depositHeld).toBe(60000);
    expect(p.unpaidRentTotal).toBe(30000);                                  // 20 000 + (15 000 − 5 000)
    expect(p.unpaidUtilitiesTotal).toBe(3000);
    expect(p.upcomingInvoices.count).toBe(1);
    expect(p.inspection.recommendedDeduction).toBe(8000);
    expect(p.suggested).toMatchObject({ arrears: 33000, damages: 8000, refund: 19000, shortfall: 0 });

    const bad = await L(id, "settle-deposit", ctx.adminToken, { deductions: [{ category: "bogus", amount: 5, reason: "x" }] });
    expect(bad.status).toBe(400);

    const r = await L(id, "settle-deposit", ctx.adminToken, { deductions: [{ category: "damages", amount: 8000, reason: "Broken tiles" }], reference: "MV-1" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rentApplied: 30000, utilitiesApplied: 3000, refunded: 19000, retained: 0, shortfall: 0 });
    expect((await db.select().from(rentPayments).where(eq(rentPayments.id, i1)))[0].status).toBe("paid");
    expect((await db.select().from(rentPayments).where(eq(rentPayments.id, i2)))[0].status).toBe("paid");
    expect((await db.select().from(rentPayments).where(eq(rentPayments.id, future)))[0].status).toBe("pending");   // not billed yet → untouched
    expect((await db.select().from(utilityBills).where(eq(utilityBills.id, bill.id)))[0].status).toBe("paid");
    const rc = await db.select().from(paymentReceipts).where(like(paymentReceipts.receiptNumber, `DEP-${id}-%`));
    expect(rc.length).toBe(3);
    expect(rc.every(x => x.paymentMethod === "deposit")).toBe(true);
    const gl = await db.select().from(generalLedger).where(and(eq(generalLedger.organizationId, ctx.orgId), like(generalLedger.reference, `GL-RENT-${tag}-%`)));
    const debit = gl.reduce((s, x) => s + Number(x.debitAmount), 0), credit = gl.reduce((s, x) => s + Number(x.creditAmount), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(30000);

    const led = (await authedGet(app, `/api/leases/${id}/deposit`, ctx.adminToken)).body;
    expect(led.currentBalance).toBe(0);
    expect(led.transactions.filter((x: any) => x.transactionType !== "received").map((x: any) => x.transactionType)).toEqual(["forfeited", "forfeited", "forfeited", "partial_refund"]);
    expect((await L(id, "settle-deposit")).status).toBe(409);               // once only
    expect((await authedGet(app, `/api/leases/${id}/settlement`, ctx.adminToken)).body.alreadySettled).toBe(true);
  });

  it("a deposit smaller than the arrears clears what it can and reports the shortfall", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 10000, depositPaidDate: `${YEAR}-01-02` });
    const tag = `LCSHORT${Date.now() % 100000}`;
    const inv = await invoice(t.tenantId, tag, 30000, addDays(today, -40));
    await L(id, "terminate", ctx.adminToken, { reason: "Evicted", terminationDate: today });
    const r = await L(id, "settle-deposit");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rentApplied: 10000, refunded: 0, shortfall: 20000 });
    expect((await db.select().from(rentPayments).where(eq(rentPayments.id, inv)))[0].status).toBe("partial");
  });

  it("refuses to settle when nothing is held", async () => {
    const t = await newTenant();
    const id = await active(t, { securityDeposit: 0 });
    await L(id, "terminate", ctx.adminToken, { reason: "Left", terminationDate: today });
    expect((await L(id, "settle-deposit")).status).toBe(400);
  });
});

describe("who may touch a lease", () => {
  it("a landlord only sees and works on leases on properties they own", async () => {
    const mine = await newTenant(landlordA.propertyId);
    const c = await create(mine, {}, landlordA.token);
    expect(c.status).toBe(201);
    const id = c.body.id;

    // creating on someone else's property is refused
    const theirs = await newTenant(landlordB.propertyId);
    expect([403, 404]).toContain((await create(theirs, {}, landlordA.token)).status);

    // the other landlord gets "not found" for every endpoint
    for (const ep of ["send-for-signing", "activate", "renew", "terminate", "settle-deposit", "cancel-termination"]) {
      expect([403, 404]).toContain((await L(id, ep, landlordB.token, { reason: "x" })).status);
    }
    expect((await L(id, "sign", landlordB.token, { signer: "manager" })).status).toBe(404);
    expect((await deposit(id, "received", 100, today, landlordB.token)).status).toBe(404);
    for (const ep of ["", "/events", "/deposit", "/settlement"]) {
      expect((await authedGet(app, `/api/leases/${id}${ep}`, landlordB.token)).status).toBe(404);
    }
    const listB = await authedGet(app, "/api/leases", landlordB.token);
    expect(listB.body.results.some((x: any) => x.id === id)).toBe(false);

    // the owner can run the whole lifecycle
    await signed(id, landlordA.token);
    expect((await L(id, "activate", landlordA.token)).status).toBe(200);
    const listA = await authedGet(app, "/api/leases", landlordA.token);
    expect(listA.body.results.some((x: any) => x.id === id)).toBe(true);
    expect(listA.body.total).toBe(listA.body.results.length);
    expect((await authedGet(app, `/api/leases/${id}`, landlordA.token)).status).toBe(200);
  });

  it("tenants cannot use /api/leases; other organisations see nothing", async () => {
    const t = await newTenant();
    const c = await create(t);
    expect((await authedGet(app, "/api/leases", ctx.tenantToken)).status).toBe(403);
    expect((await L(c.body.id, "sign", ctx.tenantToken, { signer: "tenant" })).status).toBe(403);
    expect((await authedGet(app, `/api/leases/${c.body.id}`, other.adminToken)).status).toBe(404);
    expect((await L(c.body.id, "activate", other.adminToken)).status).toBe(404);
    const list = await authedGet(app, "/api/leases", other.adminToken);
    expect(list.body.results.length).toBe(0);
  });

  it("the list total is the real count, not the page size", async () => {
    const r = await authedGet(app, "/api/leases?limit=2&page=1", ctx.adminToken);
    expect(r.body.results.length).toBe(2);
    expect(r.body.total).toBeGreaterThan(2);
  });
});

describe("expiry notices", () => {
  it("send when a lease is inside a window (not only on the exact day), once, and skip leases already being renewed", async () => {
    const t1 = await newTenant(), t2 = await newTenant();
    const a = await active(t1), b = await active(t2);
    await db.update(leases).set({ endDate: addDays(today, 75) } as any).where(eq(leases.id, a));   // inside the 90-day window, not on day 90
    await db.update(leases).set({ endDate: addDays(today, 75) } as any).where(eq(leases.id, b));
    await L(b, "renew");                                                                              // renewal in progress → no chasing
    await sendExpiryNotices();
    expect((await lease(a)).renewalNotice90Sent).toBe(true);
    expect((await lease(a)).renewalNotice60Sent).toBe(false);
    expect((await lease(b)).renewalNotice90Sent).toBe(false);
    await sendExpiryNotices();
    const sent = await db.select().from(leaseEvents).where(and(eq(leaseEvents.leaseId, a), eq(leaseEvents.eventType, "notice_sent")));
    expect(sent.length).toBe(1);
  });
});
