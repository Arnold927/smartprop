/**
 * diaspora-rent-to-own.test.ts — rent-to-own agreements and diaspora buyer contracts
 *
 * isolation     every list / get / patch / delete / process / certificate route is scoped to the caller's organisation
 * rent-to-own   server-built payment schedule (interest on the falling balance), terms kept in `conditions` and returned in
 *               the shape the screen reads, one running agreement per property, partial / full / double / over-payment,
 *               the balance follows the PRINCIPAL share, completion → one ownership certificate, ledger posting
 * diaspora      contract validation and whitelisting, payment numbers assigned by the server, overpayment and duplicate
 *               transaction references refused, completed-only accounting, refunds reverse the ledger and the balance,
 *               cancelled contracts stay cancelled, invoices can't be issued twice and are closed by the payment,
 *               construction progress no longer overwrites payment progress, certificates are server-made and only
 *               issued when the milestone is real
 * buyer portal  a buyer sees only their own contract, without staff-only fields, and can only write to staff
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, type TestContext } from "./helpers";
import { db } from "../db";
import {
  properties, tenants, users, rentToOwnAgreements, rentToOwnPayments, ownershipCertificates,
  diasporaContracts, diasporaPayments, constructionUpdates, diasporaCertificates, invoices,
  generalLedger, chartOfAccounts, messages, propertyManagementAgreements,
} from "@shared/schema";
import { eq, inArray, and, like } from "drizzle-orm";

let app: any;
let A: TestContext;
let B: TestContext;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`.toUpperCase();
const del = (path: string, token: string) => supertest(app).delete(path).set("Authorization", `Bearer ${token}`);
const get = (path: string, token: string) => authedGet(app, path, token);

async function newProperty(orgId: number) {
  const [p] = await db.insert(properties).values({ organizationId: orgId, name: `Plot ${uniq()}`, address: "Plot Road", totalUnits: 0 } as any).returning({ id: properties.id });
  return p.id;
}
const today = () => new Date().toISOString().slice(0, 10);
const glRows = (orgId: number, prefix: string) => db.select().from(generalLedger).where(and(eq(generalLedger.organizationId, orgId), like(generalLedger.transactionId, `${prefix}%`)));
const sum = (rows: any[], k: "debitAmount" | "creditAmount") => rows.reduce((s, r) => s + Number(r[k]), 0);

// ── rent-to-own helpers ──
async function makeAgreement(over: Record<string, any> = {}, ctx = A) {
  const propertyId = over.propertyId ?? (await newProperty(ctx.orgId));
  return authedPost(app, "/api/rent-to-own-agreements", ctx.adminToken, {
    propertyId, tenantId: ctx.tenantId, agreementType: "lease_option", totalPropertyValue: 300000, initialDeposit: 0,
    monthlyPayment: 100000, agreementDuration: 3, interestRate: 0, nextPaymentDue: new Date(Date.now() + 86400000 * 5).toISOString(), ...over,
  });
}
const payments = async (agreementId: number, token = A.adminToken) => (await get(`/api/rent-to-own-payments?agreementId=${agreementId}`, token)).body as any[];
const agreementRow = async (id: number) => (await db.select().from(rentToOwnAgreements).where(eq(rentToOwnAgreements.id, id)))[0];

// ── diaspora helpers ──
async function makeContract(over: Record<string, any> = {}, ctx = A) {
  const propertyId = over.propertyId ?? (await newProperty(ctx.orgId));
  return authedPost(app, "/api/diaspora-contracts", ctx.adminToken, {
    propertyId, clientName: "Wanjiru Diaspora", clientEmail: `buyer-${uniq().toLowerCase()}@example.com`, clientPhone: "+447700900000",
    clientWhatsapp: "+447700900000", clientCountry: "UK", totalPropertyValue: 1200000, downPayment: 200000, contractDurationMonths: 10,
    paymentFrequency: "monthly", paymentMethod: "bank_transfer", internationalProvider: "Wise", ...over,
  });
}
async function pay(contractId: number, over: Record<string, any> = {}, token = A.adminToken) {
  return authedPost(app, "/api/diaspora-payments", token, {
    diasporaContractId: contractId, amount: 100000, status: "completed", paymentDate: today(), paymentMethod: "bank_transfer",
    internationalProvider: "Wise", originalCurrency: "KES", ...over,
  });
}
const contractRow = async (id: number) => (await db.select().from(diasporaContracts).where(eq(diasporaContracts.id, id)))[0];

let contractA: any;
let contractB: any;

beforeAll(async () => {
  app = await getApp();
  A = await setupTestData();
  B = await setupTestData();
});

afterAll(async () => {
  const orgIds = [A.orgId, B.orgId];
  const props = (await db.select({ id: properties.id }).from(properties).where(inArray(properties.organizationId, orgIds))).map((p) => p.id);
  if (props.length) {
    const ags = (await db.select({ id: rentToOwnAgreements.id }).from(rentToOwnAgreements).where(inArray(rentToOwnAgreements.propertyId, props))).map((a) => a.id);
    if (ags.length) await db.delete(rentToOwnPayments).where(inArray(rentToOwnPayments.agreementId, ags)).catch(() => {});
    await db.delete(rentToOwnAgreements).where(inArray(rentToOwnAgreements.propertyId, props)).catch(() => {});
    await db.delete(ownershipCertificates).where(inArray(ownershipCertificates.propertyId, props)).catch(() => {});
    await db.delete(propertyManagementAgreements).where(inArray(propertyManagementAgreements.propertyId, props)).catch(() => {});
    const cs = (await db.select({ id: diasporaContracts.id }).from(diasporaContracts).where(inArray(diasporaContracts.organizationId, orgIds))).map((c) => c.id);
    if (cs.length) {
      await db.delete(diasporaPayments).where(inArray(diasporaPayments.diasporaContractId, cs)).catch(() => {});
      await db.delete(constructionUpdates).where(inArray(constructionUpdates.diasporaContractId, cs)).catch(() => {});
      await db.delete(diasporaCertificates).where(inArray(diasporaCertificates.diasporaContractId, cs)).catch(() => {});
    }
    await db.delete(diasporaContracts).where(inArray(diasporaContracts.organizationId, orgIds)).catch(() => {});
    await db.delete(invoices).where(inArray(invoices.propertyId, props)).catch(() => {});
  }
  const uids = (await db.select({ id: users.id }).from(users).where(inArray(users.organizationId, orgIds))).map((u) => u.id);
  if (uids.length) {
    await db.delete(messages).where(inArray(messages.fromUserId, uids)).catch(() => {});
  }
  await db.delete(generalLedger).where(inArray(generalLedger.organizationId, orgIds)).catch(() => {});
  await db.delete(chartOfAccounts).where(inArray(chartOfAccounts.organizationId, orgIds)).catch(() => {});
  await db.delete(properties).where(inArray(properties.organizationId, orgIds)).catch(() => {});
  await cleanupTestData(A);
  await cleanupTestData(B);
});

// ════════════════════════════════════════════════════════════════════════════
describe("rent-to-own: creating an agreement", () => {
  it("refuses bad terms with a readable message", async () => {
    const bad = async (over: object, re: RegExp) => { const r = await makeAgreement(over); expect(r.status).toBe(400); expect(r.body.message).toMatch(re); };
    await bad({ totalPropertyValue: 0 }, /property value/i);
    await bad({ monthlyPayment: -1 }, /monthly payment/i);
    await bad({ agreementDuration: 0 }, /duration/i);
    await bad({ agreementDuration: 12.5 }, /duration/i);
    await bad({ interestRate: 150 }, /interest/i);
    await bad({ rentCreditRate: 101 }, /credit rate/i);
    await bad({ initialDeposit: 300000 }, /less than the property value/i);
    await bad({ initialDeposit: -5 }, /deposit/i);
    await bad({ agreementType: "gift" }, /type/i);
    await bad({ nextPaymentDue: "not-a-date" }, /date/i);
    await bad({ monthlyPayment: 100, totalPropertyValue: 3000000, interestRate: 24, agreementDuration: 12 }, /interest/i);
  });

  it("refuses a property or tenant from another organisation", async () => {
    const otherProp = await newProperty(B.orgId);
    const r1 = await makeAgreement({ propertyId: otherProp });
    expect(r1.status).toBe(400);
    expect(r1.body.message).toMatch(/property/i);
    const r2 = await makeAgreement({ tenantId: B.tenantId });
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/tenant/i);
  });

  it("builds the whole schedule: equal instalments, interest on the falling balance, balance fully covered", async () => {
    const r = await makeAgreement({ totalPropertyValue: 120000, initialDeposit: 0, monthlyPayment: 11000, agreementDuration: 12, interestRate: 12 });
    expect(r.status).toBe(201);
    const rows = await payments(r.body.id);
    expect(rows).toHaveLength(12);
    expect(rows.map((p) => p.paymentNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Number(rows[0].interestAmount)).toBeCloseTo(1200, 2);               // 120000 × 1%
    expect(Number(rows[0].principalAmount)).toBeCloseTo(9800, 2);
    expect(Number(rows[1].interestAmount)).toBeLessThan(Number(rows[0].interestAmount)); // interest falls as the balance falls
    expect(rows.every((p) => Math.abs(Number(p.scheduledAmount) - Number(p.principalAmount) - Number(p.interestAmount)) < 0.011)).toBe(true);
    const principal = rows.reduce((s, p) => s + Number(p.principalAmount), 0);
    expect(principal).toBeCloseTo(120000, 1);                                    // the schedule repays exactly the balance
    expect(rows.every((p) => p.status === "pending")).toBe(true);
  });

  it("an instalment that does not even cover the interest is refused", async () => {
    const r = await makeAgreement({ totalPropertyValue: 5000000, monthlyPayment: 1000, agreementDuration: 12, interestRate: 12 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/interest/i);
  });

  it("starting totals follow the deposit; an option fee that counts towards the price counts as paid", async () => {
    const r = await makeAgreement({ totalPropertyValue: 500000, initialDeposit: 50000, optionFee: 10000, optionFeeApplied: true, monthlyPayment: 40000, agreementDuration: 12 });
    expect(r.status).toBe(201);
    expect(Number(r.body.totalPaid)).toBe(60000);
    expect(Number(r.body.remainingBalance)).toBe(440000);
    const unapplied = await makeAgreement({ totalPropertyValue: 500000, initialDeposit: 50000, optionFee: 10000, optionFeeApplied: false, monthlyPayment: 40000, agreementDuration: 12 });
    expect(Number(unapplied.body.totalPaid)).toBe(50000);
    expect(Number(unapplied.body.remainingBalance)).toBe(450000);
  });

  it("keeps the rent-credit terms and returns the fields the screen reads", async () => {
    const r = await makeAgreement({ rentCreditRate: 25, optionFee: 20000, optionFeeApplied: true, legalClause: "lease_option", agreementDuration: 3 });
    expect(r.status).toBe(201);
    const b = r.body;
    expect(b.rentCreditRate).toBe("25");
    expect(Number(b.rentCreditAmount)).toBe(25000);               // 25% of the 100,000 rent
    expect(b.optionFeeApplied).toBe(true);
    expect(b.legalClause).toBe("lease_option");
    expect(b.monthlyRent).toBe(b.monthlyPayment);
    expect(b.agreementDurationMonths).toBe(3);
    expect(b.paymentsMade).toBe(0);
    expect(b.paymentsTotal).toBe(3);
    expect(b.tenantName).toBe("Test Tenant");
    expect(b.propertyAddress).toBeTruthy();
    expect(b.startDate).toBeTruthy();
    // the same through the list
    const list = (await get("/api/rent-to-own-agreements", A.adminToken)).body as any[];
    const found = list.find((x) => x.id === b.id);
    expect(found.rentCreditRate).toBe("25");
    expect(found.tenantName).toBe("Test Tenant");
  });

  it("ignores client-supplied totals and numbers", async () => {
    const r = await makeAgreement({ agreementNumber: "HACK-1", totalPaid: 999999, remainingBalance: 1, status: "completed", agreementDuration: 3 });
    expect(r.status).toBe(201);
    expect(r.body.agreementNumber).not.toBe("HACK-1");
    expect(r.body.status).toBe("active");
    expect(Number(r.body.totalPaid)).toBe(0);
    expect(Number(r.body.remainingBalance)).toBe(300000);
  });

  it("only one running agreement per property", async () => {
    const propertyId = await newProperty(A.orgId);
    expect((await makeAgreement({ propertyId })).status).toBe(201);
    const second = await makeAgreement({ propertyId });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already has a running/i);
  });

  it("two simultaneous agreements on one property: exactly one is created", async () => {
    const propertyId = await newProperty(A.orgId);
    const rs = await Promise.all([makeAgreement({ propertyId }), makeAgreement({ propertyId }), makeAgreement({ propertyId })]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("rent-to-own: taking payments", () => {
  let ag: any;
  let rows: any[];

  it("a full instalment: paid, and the balance falls by the principal only", async () => {
    const created = await makeAgreement({ totalPropertyValue: 120000, monthlyPayment: 11000, agreementDuration: 12, interestRate: 12, rentCreditRate: 10 });
    ag = created.body;
    rows = await payments(ag.id);
    const first = rows[0];
    const r = await authedPost(app, `/api/rent-to-own-payments/${first.id}/process`, A.adminToken, { paymentMethod: "mpesa", transactionId: `MP-${uniq()}` });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("paid");
    const after = await agreementRow(ag.id);
    expect(Number(after.remainingBalance)).toBeCloseTo(120000 - 9800, 2);   // interest (1,200) does not lower the price
    expect(Number(after.totalPaid)).toBeCloseTo(9800, 2);
    expect(r.body.agreement.paymentsMade).toBe(1);
    expect(Number(r.body.agreement.totalRentCredits)).toBeCloseTo(1100, 2);  // 10% of the 11,000 paid
  });

  it("processing the same payment twice is refused and counts once", async () => {
    const first = rows[0];
    const again = await authedPost(app, `/api/rent-to-own-payments/${first.id}/process`, A.adminToken, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_PAID");
    expect(Number((await agreementRow(ag.id)).remainingBalance)).toBeCloseTo(120000 - 9800, 2);
  });

  it("two simultaneous clicks on one payment: counted once", async () => {
    const second = rows[1];
    const rs = await Promise.all([1, 2, 3].map(() => authedPost(app, `/api/rent-to-own-payments/${second.id}/process`, A.adminToken, {})));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const p1 = Number(rows[0].principalAmount), p2 = Number(second.principalAmount);
    expect(Number((await agreementRow(ag.id)).remainingBalance)).toBeCloseTo(120000 - p1 - p2, 2);
  });

  it("a part payment leaves the instalment partial; the rest completes it; too much is refused", async () => {
    const third = rows[2];
    const sched = Number(third.scheduledAmount);
    const before = Number((await agreementRow(ag.id)).remainingBalance);
    const half = await authedPost(app, `/api/rent-to-own-payments/${third.id}/process`, A.adminToken, { paidAmount: sched / 2 });
    expect(half.status).toBe(200);
    expect(half.body.status).toBe("partial");
    expect(Number(half.body.paidAmount)).toBeCloseTo(sched / 2, 2);
    const over = await authedPost(app, `/api/rent-to-own-payments/${third.id}/process`, A.adminToken, { paidAmount: sched });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("OVERPAYMENT");
    const rest = await authedPost(app, `/api/rent-to-own-payments/${third.id}/process`, A.adminToken, {});   // default: what is still due
    expect(rest.status).toBe(200);
    expect(rest.body.status).toBe("paid");
    const after = Number((await agreementRow(ag.id)).remainingBalance);
    expect(before - after).toBeCloseTo(Number(third.principalAmount), 1);
  });

  it("zero, negative and silly amounts are refused", async () => {
    const fourth = rows[3];
    for (const v of [0, -10, "abc"]) {
      const r = await authedPost(app, `/api/rent-to-own-payments/${fourth.id}/process`, A.adminToken, { paidAmount: v });
      expect(r.status).toBe(400);
    }
  });

  it("a reused transaction reference is refused", async () => {
    const [p4, p5] = [rows[3], rows[4]];
    const ref = `DUP-${uniq()}`;
    expect((await authedPost(app, `/api/rent-to-own-payments/${p4.id}/process`, A.adminToken, { transactionId: ref })).status).toBe(200);
    const r = await authedPost(app, `/api/rent-to-own-payments/${p5.id}/process`, A.adminToken, { transactionId: ref });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICATE");
  });

  it("the cash is posted to the books: debit cash, credit income, balanced, once per receipt", async () => {
    const gl = await glRows(A.orgId, "GL-RTO-");
    expect(gl.length).toBeGreaterThanOrEqual(6);
    expect(sum(gl, "debitAmount")).toBeCloseTo(sum(gl, "creditAmount"), 2);
    const ids = gl.map((g) => g.transactionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an overdue instalment is reported as overdue with the days late", async () => {
    const r = await makeAgreement({ nextPaymentDue: new Date(Date.now() - 20 * 86400000).toISOString(), agreementDuration: 3 });
    const list = await payments(r.body.id);
    expect(list[0].status).toBe("overdue");
    expect(list[0].daysLate).toBeGreaterThanOrEqual(19);
    expect(list[2].status).toBe("pending");
  });

  it("paying every instalment completes the agreement and sets the completion date", async () => {
    const created = await makeAgreement({ agreementDuration: 3 });
    const list = await payments(created.body.id);
    for (const p of list) expect((await authedPost(app, `/api/rent-to-own-payments/${p.id}/process`, A.adminToken, {})).status).toBe(200);
    const done = await agreementRow(created.body.id);
    expect(done.status).toBe("completed");
    expect(Number(done.remainingBalance)).toBe(0);
    expect(Number(done.totalPaid)).toBeCloseTo(300000, 2);
    expect(done.completionDate).toBeTruthy();
    // a completed agreement takes no more payments and cannot be edited
    expect((await authedPatch(app, `/api/rent-to-own-agreements/${done.id}`, A.adminToken, { status: "cancelled" })).status).toBe(409);
  });

  it("a cancelled or defaulted agreement takes no payments until reactivated", async () => {
    const created = await makeAgreement({ agreementDuration: 3 });
    const list = await payments(created.body.id);
    expect((await authedPatch(app, `/api/rent-to-own-agreements/${created.body.id}`, A.adminToken, { status: "defaulted" })).status).toBe(200);
    const blocked = await authedPost(app, `/api/rent-to-own-payments/${list[0].id}/process`, A.adminToken, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/defaulted/i);
    expect((await authedPatch(app, `/api/rent-to-own-agreements/${created.body.id}`, A.adminToken, { status: "active" })).status).toBe(200);
    expect((await authedPost(app, `/api/rent-to-own-payments/${list[0].id}/process`, A.adminToken, {})).status).toBe(200);
    // "completed" can't be set by hand; the money can't be edited
    expect((await authedPatch(app, `/api/rent-to-own-agreements/${created.body.id}`, A.adminToken, { status: "completed" })).status).toBe(400);
    const patched = await authedPatch(app, `/api/rent-to-own-agreements/${created.body.id}`, A.adminToken, { totalPaid: 1, remainingBalance: 0, totalPropertyValue: 5 });
    expect(Number(patched.body.remainingBalance)).toBeCloseTo(200000, 1);
    expect(Number(patched.body.totalPropertyValue)).toBe(300000);
  });

  it("a manual payment must add up, can't exceed the balance and can never be created as already paid", async () => {
    const created = await makeAgreement({ agreementDuration: 3, generateSchedule: false });
    const id = created.body.id;
    const add = (over: object) => authedPost(app, "/api/rent-to-own-payments", A.adminToken, { agreementId: id, scheduledAmount: 1000, principalAmount: 900, interestAmount: 100, dueDate: today(), ...over });
    expect((await add({ interestAmount: 50 })).status).toBe(400);              // 900 + 50 ≠ 1000
    expect((await add({ scheduledAmount: 0 })).status).toBe(400);
    expect((await add({ dueDate: "" })).status).toBe(400);
    expect((await add({ scheduledAmount: 400000, principalAmount: 400000, interestAmount: 0 })).status).toBe(409);   // > the 300,000 owing
    const ok = await add({ status: "paid", paidAmount: 1000 });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("pending");
    expect(Number(ok.body.paidAmount)).toBe(0);
    const ok2 = await add({});
    expect(ok2.body.paymentNumber).toBe(ok.body.paymentNumber + 1);
    // "create the schedule" refuses when payments already exist, and works for an agreement without any
    expect((await authedPost(app, `/api/rent-to-own-agreements/${id}/generate-schedule`, A.adminToken, {})).status).toBe(409);
    const empty = await makeAgreement({ agreementDuration: 4, monthlyPayment: 75000, generateSchedule: false });
    const gen = await authedPost(app, `/api/rent-to-own-agreements/${empty.body.id}/generate-schedule`, A.adminToken, {});
    expect(gen.status).toBe(201);
    expect(gen.body.created).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("rent-to-own: certificates", () => {
  it("issued only from a completed agreement, and only once", async () => {
    const created = await makeAgreement({ agreementDuration: 3 });
    const id = created.body.id;
    const early = await authedPost(app, `/api/ownership-certificates/generate/${id}`, A.adminToken, {});
    expect(early.status).toBe(409);
    for (const p of await payments(id)) await authedPost(app, `/api/rent-to-own-payments/${p.id}/process`, A.adminToken, {});
    const first = await authedPost(app, `/api/ownership-certificates/generate/${id}`, A.adminToken, {});
    expect(first.status).toBe(201);
    expect(first.body.acquisitionType).toBe("rent_to_own");
    const second = await authedPost(app, `/api/ownership-certificates/generate/${id}`, A.adminToken, {});
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DUPLICATE");
    const listed = (await get("/api/ownership-certificates", A.adminToken)).body as any[];
    expect(listed.filter((c) => c.propertyId === created.body.propertyId)).toHaveLength(1);
    // organisation B sees none of it
    expect((await get("/api/ownership-certificates", B.adminToken)).body).toEqual([]);
    expect((await get(`/api/ownership-certificates/${first.body.id}`, B.adminToken)).status).toBe(404);
    expect((await authedPost(app, `/api/ownership-certificates/generate/${id}`, B.adminToken, {})).status).toBe(404);
  });

  it("a manual certificate is validated and tied to this organisation's property and owner", async () => {
    const propertyId = await newProperty(A.orgId);
    const base = { propertyId, ownerId: A.tenantId, ownershipType: "full", acquisitionType: "purchase", acquisitionDate: today() };
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, { ...base, ownershipType: "weird" })).status).toBe(400);
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, { ...base, ownershipPercentage: 150 })).status).toBe(400);
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, { ...base, acquisitionDate: "" })).status).toBe(400);
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, { ...base, propertyId: await newProperty(B.orgId) })).status).toBe(400);
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, { ...base, ownerId: B.tenantId })).status).toBe(400);
    expect((await authedPost(app, "/api/ownership-certificates", A.adminToken, base)).status).toBe(201);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("organisation isolation (rent-to-own)", () => {
  it("another organisation cannot read, change or pay anything", async () => {
    const created = await makeAgreement({ agreementDuration: 3 });
    const id = created.body.id;
    const [pay1] = await payments(id);
    expect((await get(`/api/rent-to-own-agreements/${id}`, B.adminToken)).status).toBe(404);
    expect(((await get("/api/rent-to-own-agreements", B.adminToken)).body as any[]).some((a) => a.id === id)).toBe(false);
    expect((await authedPatch(app, `/api/rent-to-own-agreements/${id}`, B.adminToken, { status: "cancelled" })).status).toBe(404);
    expect((await get(`/api/rent-to-own-payments?agreementId=${id}`, B.adminToken)).body).toEqual([]);
    expect(((await get("/api/rent-to-own-payments", B.adminToken)).body as any[]).some((p) => p.id === pay1.id)).toBe(false);
    expect((await get(`/api/rent-to-own-payments/${pay1.id}`, B.adminToken)).status).toBe(404);
    expect((await authedPost(app, `/api/rent-to-own-payments/${pay1.id}/process`, B.adminToken, {})).status).toBe(404);
    expect((await authedPost(app, "/api/rent-to-own-payments", B.adminToken, { agreementId: id, scheduledAmount: 10, principalAmount: 10, dueDate: today() })).status).toBe(404);
    expect((await authedPost(app, `/api/rent-to-own-agreements/${id}/generate-schedule`, B.adminToken, {})).status).toBe(404);
    // nothing changed
    expect((await agreementRow(id)).status).toBe("active");
    expect(Number((await payments(id))[0].paidAmount)).toBe(0);
  });

  it("property-management agreements are scoped too", async () => {
    const propertyId = await newProperty(A.orgId);
    const mk = (token: string, over: object = {}) => authedPost(app, "/api/property-management-agreements", token, {
      propertyId, ownerId: A.tenantId, managementType: "full_service", managementFeeType: "percentage", managementFeeRate: 10, startDate: today(), ...over,
    });
    expect((await mk(B.adminToken)).status).toBe(400);                                  // not B's property
    expect((await mk(A.adminToken, { managementFeeRate: 150 })).status).toBe(400);
    expect((await mk(A.adminToken, { startDate: "x" })).status).toBe(400);
    const ok = await mk(A.adminToken);
    expect(ok.status).toBe(201);
    expect((await get("/api/property-management-agreements", B.adminToken)).body).toEqual([]);
    expect((await get(`/api/property-management-agreements/${ok.body.id}`, B.adminToken)).status).toBe(404);
    expect((await get(`/api/property-management-agreements/${ok.body.id}`, A.adminToken)).status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: contracts", () => {
  it("refuses a half-filled or impossible contract", async () => {
    const bad = async (over: object, re: RegExp) => { const r = await makeContract(over); expect(r.status).toBe(400); expect(r.body.message).toMatch(re); };
    await bad({ clientName: "" }, /buyer name/i);
    await bad({ totalPropertyValue: 0 }, /total property value|fill in/i);
    await bad({ totalPropertyValue: -5 }, /total property value/i);
    await bad({ downPayment: 1200000 }, /less than the total/i);
    await bad({ downPayment: -1 }, /negative/i);
    await bad({ contractDurationMonths: 0 }, /duration/i);
    await bad({ contractDurationMonths: 2.5 }, /duration/i);
    await bad({ paymentFrequency: "weekly" }, /frequency/i);
    await bad({ clientEmail: "not-an-email" }, /email/i);
    await bad({ constructionStartDate: "2027-06-01", expectedCompletionDate: "2027-01-01" }, /before the construction start/i);
    await bad({ propertyId: await newProperty(B.orgId) }, /property/i);
  });

  it("works out the instalment for each frequency and starts the totals from the down payment", async () => {
    const monthly = await makeContract({ totalPropertyValue: 1200000, downPayment: 200000, contractDurationMonths: 10, paymentFrequency: "monthly" });
    expect(monthly.status).toBe(201);
    expect(Number(monthly.body.monthlyInstallment)).toBe(100000);
    expect(Number(monthly.body.totalPaid)).toBe(200000);
    expect(Number(monthly.body.remainingBalance)).toBe(1000000);
    const quarterly = await makeContract({ totalPropertyValue: 1200000, downPayment: 0, contractDurationMonths: 12, paymentFrequency: "quarterly" });
    expect(Number(quarterly.body.monthlyInstallment)).toBe(300000);
    contractA = monthly.body;
  });

  it("ignores fields the form must not set", async () => {
    const r = await makeContract({ status: "completed", totalPaid: 999999999, remainingBalance: 0, paymentsMade: 50, completionPercentage: 100, certificateStatus: "verified", digitalCertificateIssued: true, blockchainHash: "0xfake", organizationId: B.orgId, buyerUserId: randomUUID(), assignedManager: "x" });
    expect(r.status).toBe(201);
    const row = await contractRow(r.body.id);
    expect(row.status).toBe("active");
    expect(Number(row.totalPaid)).toBe(200000);
    expect(row.paymentsMade).toBe(0);
    expect(row.certificateStatus).toBe("not_issued");
    expect(row.digitalCertificateIssued).toBe(false);
    expect(row.blockchainHash).toBeNull();
    expect(row.organizationId).toBe(A.orgId);
    expect(row.buyerUserId).not.toBeNull();            // the buyer's own login, not the one that was sent
  });

  it("a rejected contract leaves no buyer login behind", async () => {
    const email = `ghost-${uniq().toLowerCase()}@example.com`;
    const r = await makeContract({ clientEmail: email, downPayment: 5000000 });
    expect(r.status).toBe(400);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });

  it("edits what can be edited, rebuilds the instalment, and never trusts totals from the form", async () => {
    const c = (await makeContract({ totalPropertyValue: 1000000, downPayment: 100000, contractDurationMonths: 9 })).body;
    const r = await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { clientPhone: "+254700111222", totalPaid: 1, remainingBalance: 1, paymentsMade: 9, completionPercentage: 100 });
    expect(r.status).toBe(200);
    expect(r.body.clientPhone).toBe("+254700111222");
    expect(Number(r.body.totalPaid)).toBe(100000);
    expect(r.body.paymentsMade).toBe(0);
    expect(Number(r.body.completionPercentage)).toBeCloseTo(10, 1);
    const terms = await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { totalPropertyValue: 1900000 });
    expect(Number(terms.body.monthlyInstallment)).toBe(200000);     // 1.8M still to pay over 9 periods
    expect(Number(terms.body.remainingBalance)).toBe(1800000);
    expect((await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { clientEmail: "nope" })).status).toBe(400);
    expect((await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { constructionStatus: "dancing" })).status).toBe(400);
    expect((await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { status: "completed" })).status).toBe(400);
    expect((await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { downPayment: 1900000 })).status).toBe(400);
    expect((await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { contractSignedAt: "garbage" })).status).toBe(400);
  });

  it("a price below what the buyer has already paid is refused", async () => {
    const c = (await makeContract({ totalPropertyValue: 1000000, downPayment: 100000, contractDurationMonths: 9 })).body;
    expect((await pay(c.id, { amount: 300000 })).status).toBe(201);
    const r = await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { totalPropertyValue: 350000 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/already paid/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: organisation isolation", () => {
  it("another organisation cannot see or touch the contract or anything under it", async () => {
    contractB = (await makeContract({}, B)).body;
    const id = contractA.id;
    const p = (await pay(id, { amount: 50000, status: "pending" })).body;
    const u = (await authedPost(app, "/api/construction-updates", A.adminToken, { diasporaContractId: id, updateTitle: "Site cleared", updateDescription: "Bush cleared", constructionPhase: "planning", progressPercentage: 5 })).body;

    expect((await get(`/api/diaspora-contracts/${id}`, B.adminToken)).status).toBe(404);
    expect(((await get("/api/diaspora-contracts", B.adminToken)).body as any[]).some((c) => c.id === id)).toBe(false);
    expect((await authedPatch(app, `/api/diaspora-contracts/${id}`, B.adminToken, { clientName: "Stolen" })).status).toBe(404);
    expect((await del(`/api/diaspora-contracts/${id}`, B.adminToken)).status).toBe(404);
    expect((await authedPost(app, `/api/diaspora-contracts/${id}/recalc-balance`, B.adminToken, {})).status).toBe(404);
    expect((await authedPost(app, `/api/diaspora-contracts/${id}/generate-invoice`, B.adminToken, {})).status).toBe(404);
    expect((await get(`/api/diaspora-contracts/${id}/invoices`, B.adminToken)).status).toBe(404);

    expect(((await get("/api/diaspora-payments", B.adminToken)).body as any[]).some((x) => x.diasporaContractId === id)).toBe(false);
    expect((await get(`/api/diaspora-payments?diasporaContractId=${id}`, B.adminToken)).body).toEqual([]);
    expect((await get(`/api/diaspora-payments?contractId=${id}`, B.adminToken)).body).toEqual([]);
    expect((await get(`/api/diaspora-payments/${p.id}`, B.adminToken)).status).toBe(404);
    expect((await authedPatch(app, `/api/diaspora-payments/${p.id}`, B.adminToken, { status: "completed" })).status).toBe(404);
    expect((await pay(id, {}, B.adminToken)).status).toBe(404);

    expect(((await get("/api/construction-updates", B.adminToken)).body as any[]).some((x) => x.id === u.id)).toBe(false);
    expect((await get(`/api/construction-updates/${u.id}`, B.adminToken)).status).toBe(404);
    expect((await authedPatch(app, `/api/construction-updates/${u.id}`, B.adminToken, { updateTitle: "x" })).status).toBe(404);
    expect((await authedPost(app, "/api/construction-updates", B.adminToken, { diasporaContractId: id, updateTitle: "x", updateDescription: "y", constructionPhase: "planning", progressPercentage: 1 })).status).toBe(404);

    expect((await get("/api/diaspora-certificates", B.adminToken)).body).toEqual([]);
    expect((await authedPost(app, "/api/diaspora-certificates", B.adminToken, { diasporaContractId: id, certificateType: "ownership" })).status).toBe(404);
    expect((await authedPost(app, "/api/diaspora-contracts/patch-due-dates", B.adminToken, {})).status).toBe(200);
    // the other organisation's "fix all due dates" did not touch this contract
    const row = await contractRow(id);
    expect(row.nextPaymentDue?.toISOString()).toBe(new Date(contractA.nextPaymentDue).toISOString());
    expect(row.clientName).toBe("Wanjiru Diaspora");
    expect((await authedPost(app, "/api/diaspora-payments/repost-ledger", B.adminToken, {})).body.posted).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: payments", () => {
  let c: any;
  it("numbers are assigned by the server; a pending payment does not count; refuses nonsense", async () => {
    c = (await makeContract({ totalPropertyValue: 1000000, downPayment: 100000, contractDurationMonths: 9 })).body;
    const a = await pay(c.id, { amount: 100000, paymentNumber: 7 });
    expect(a.status).toBe(201);
    expect(a.body.paymentNumber).toBe(1);
    const b = await pay(c.id, { amount: 50000, status: "pending", paymentNumber: 1 });
    expect(b.body.paymentNumber).toBe(2);
    const row = await contractRow(c.id);
    expect(Number(row.totalPaid)).toBe(200000);              // 100k down + the one completed 100k
    expect(row.paymentsMade).toBe(1);
    expect(Number(row.remainingBalance)).toBe(800000);

    const bad = async (over: object, re: RegExp) => { const r = await pay(c.id, over); expect(r.status).toBe(400); expect(r.body.message).toMatch(re); };
    await bad({ amount: 0 }, /amount/i);
    await bad({ amount: -5 }, /amount/i);
    await bad({ amount: "abc" }, /amount/i);
    await bad({ processingFee: -1 }, /negative/i);
    await bad({ processingFee: 80000, exchangeFee: 30000 }, /fees are larger/i);
    await bad({ status: "settled" }, /status/i);
    await bad({ paymentDate: "" }, /date/i);
    await bad({ originalCurrency: "USD" }, /exchange rate/i);
  });

  it("a payment bigger than the balance is refused; a duplicate transaction reference is refused", async () => {
    const over = await pay(c.id, { amount: 900000 });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("OVERPAYMENT");
    const ref = `WISE-${uniq()}`;
    expect((await pay(c.id, { amount: 10000, providerTransactionId: ref })).status).toBe(201);
    const dup = await pay(c.id, { amount: 10000, providerTransactionId: ref });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE");
    expect(Number((await contractRow(c.id)).totalPaid)).toBe(210000);
  });

  it("simultaneous payments can't together overpay", async () => {
    const x = (await makeContract({ totalPropertyValue: 500000, downPayment: 100000, contractDurationMonths: 4 })).body;
    const rs = await Promise.all([1, 2, 3, 4].map(() => pay(x.id, { amount: 300000 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(Number((await contractRow(x.id)).remainingBalance)).toBe(100000);
  });

  it("a completed payment is posted to the books: cash, income and fees, balanced; pending ones are not", async () => {
    const y = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    const p = (await pay(y.id, { amount: 100000, processingFee: 1500, exchangeFee: 500 })).body;
    const pending = (await pay(y.id, { amount: 40000, status: "pending" })).body;
    const gl = await glRows(A.orgId, `GL-DSP-${p.id}`);
    expect(gl).toHaveLength(3);
    expect(sum(gl, "debitAmount")).toBeCloseTo(100000, 2);
    expect(sum(gl, "creditAmount")).toBeCloseTo(100000, 2);
    const cash = gl.find((g) => g.transactionId.endsWith("-DR"))!;
    expect(Number(cash.debitAmount)).toBeCloseTo(98000, 2);          // what actually landed
    expect(await glRows(A.orgId, `GL-DSP-${pending.id}-`)).toHaveLength(0);
    // the old header-only journal entry is not created any more
    // completing the pending one posts it, once
    expect((await authedPatch(app, `/api/diaspora-payments/${pending.id}`, A.adminToken, { status: "completed" })).status).toBe(200);
    expect(await glRows(A.orgId, `GL-DSP-${pending.id}-`)).toHaveLength(2);
    expect((await authedPatch(app, `/api/diaspora-payments/${pending.id}`, A.adminToken, { notes: "again" })).status).toBe(200);
    expect(await glRows(A.orgId, `GL-DSP-${pending.id}-`)).toHaveLength(2);
    // repost finds nothing missing
    expect((await authedPost(app, "/api/diaspora-payments/repost-ledger", A.adminToken, {})).body.posted).toBe(0);
  });

  it("refunding a completed payment reverses the books and the balance; a refund can't be reopened", async () => {
    const z = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    const p = (await pay(z.id, { amount: 200000 })).body;
    expect(Number((await contractRow(z.id)).remainingBalance)).toBe(500000);
    const rf = await authedPatch(app, `/api/diaspora-payments/${p.id}`, A.adminToken, { status: "refunded" });
    expect(rf.status).toBe(200);
    const row = await contractRow(z.id);
    expect(Number(row.remainingBalance)).toBe(700000);
    expect(row.paymentsMade).toBe(0);
    const gl = await glRows(A.orgId, `GL-DSP-${p.id}`);
    expect(gl).toHaveLength(4);                                     // CR, DR and their reversals
    expect(sum(gl, "debitAmount")).toBeCloseTo(sum(gl, "creditAmount"), 2);
    const net = (acct: string) => gl.filter((g) => g.transactionId.includes(acct)).reduce((s, g) => s + Number(g.debitAmount) - Number(g.creditAmount), 0);
    expect(net("-DR")).toBeCloseTo(0, 2);                           // cash is back to zero
    expect(net("-CR")).toBeCloseTo(0, 2);
    const reopen = await authedPatch(app, `/api/diaspora-payments/${p.id}`, A.adminToken, { status: "completed" });
    expect(reopen.status).toBe(409);
  });

  it("failed → completed again posts a fresh entry instead of colliding with the old one", async () => {
    const w = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    const p = (await pay(w.id, { amount: 100000 })).body;
    expect((await authedPatch(app, `/api/diaspora-payments/${p.id}`, A.adminToken, { status: "failed" })).status).toBe(200);
    expect((await authedPatch(app, `/api/diaspora-payments/${p.id}`, A.adminToken, { status: "completed" })).status).toBe(200);
    const gl = await glRows(A.orgId, `GL-DSP-${p.id}`);
    const live = gl.filter((g) => !g.transactionId.endsWith("-REV") && g.transactionId.includes(`${p.id}.1-`));
    expect(live.length).toBe(2);
    const cashNet = gl.filter((g) => g.transactionId.includes("-DR")).reduce((s, g) => s + Number(g.debitAmount) - Number(g.creditAmount), 0);
    expect(cashNet).toBeCloseTo(100000, 2);                         // exactly one payment's worth of cash on the books
    expect(Number((await contractRow(w.id)).remainingBalance)).toBe(600000);
  });

  it("the money fields of a completed payment can't be rewritten; a pending one can", async () => {
    const q = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    const done = (await pay(q.id, { amount: 100000 })).body;
    const r = await authedPatch(app, `/api/diaspora-payments/${done.id}`, A.adminToken, { amount: 1 });
    expect(r.status).toBe(409);
    const pend = (await pay(q.id, { amount: 100000, status: "pending" })).body;
    const ok = await authedPatch(app, `/api/diaspora-payments/${pend.id}`, A.adminToken, { amount: 120000 });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.amount)).toBe(120000);
    expect((await authedPatch(app, `/api/diaspora-payments/${pend.id}`, A.adminToken, { status: "completed", amount: 5 })).status).toBe(200);
    // completing a payment bigger than the balance is refused
    const big = (await pay(q.id, { amount: 10000, status: "pending" })).body;
    await authedPatch(app, `/api/diaspora-payments/${big.id}`, A.adminToken, { amount: 900000 });
    const blocked = await authedPatch(app, `/api/diaspora-payments/${big.id}`, A.adminToken, { status: "completed" });
    expect(blocked.status).toBe(409);
  });

  it("paying the balance completes the contract; refunding re-opens it; cancelled stays cancelled", async () => {
    const d = (await makeContract({ totalPropertyValue: 300000, downPayment: 100000, contractDurationMonths: 2 })).body;
    const p = (await pay(d.id, { amount: 200000 })).body;
    const row = await contractRow(d.id);
    expect(row.status).toBe("completed");
    expect(Number(row.remainingBalance)).toBe(0);
    expect(Number(row.completionPercentage)).toBe(100);
    await authedPatch(app, `/api/diaspora-payments/${p.id}`, A.adminToken, { status: "refunded" });
    expect((await contractRow(d.id)).status).toBe("active");

    const e = (await makeContract({ totalPropertyValue: 300000, downPayment: 100000, contractDurationMonths: 2 })).body;
    expect((await authedPatch(app, `/api/diaspora-contracts/${e.id}`, A.adminToken, { status: "cancelled" })).status).toBe(200);
    const blocked = await pay(e.id, { amount: 1000 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/cancelled/i);
    await authedPost(app, `/api/diaspora-contracts/${e.id}/recalc-balance`, A.adminToken, {});
    expect((await contractRow(e.id)).status).toBe("cancelled");     // a recalculation used to flip it back to active
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: invoices and deleting", () => {
  it("one open invoice at a time; a covering payment closes it; the amount never exceeds the balance", async () => {
    const c = (await makeContract({ totalPropertyValue: 450000, downPayment: 50000, contractDurationMonths: 4 })).body;   // 100,000 / month
    const first = await authedPost(app, `/api/diaspora-contracts/${c.id}/generate-invoice`, A.adminToken, {});
    expect(first.status).toBe(201);
    expect(Number(first.body.totalAmount)).toBe(100000);
    const dbl = await authedPost(app, `/api/diaspora-contracts/${c.id}/generate-invoice`, A.adminToken, {});
    expect(dbl.status).toBe(409);
    const due1 = (await contractRow(c.id)).nextPaymentDue;
    expect(due1).toBeTruthy();
    const listed = (await get(`/api/diaspora-contracts/${c.id}/invoices`, A.adminToken)).body as any[];
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("pending");
    await pay(c.id, { amount: 100000 });
    const after = (await get(`/api/diaspora-contracts/${c.id}/invoices`, A.adminToken)).body as any[];
    expect(after[0].status).toBe("paid");
    // pay down to the last 50,000: the next invoice is only for what is left
    await pay(c.id, { amount: 250000 });
    const last = await authedPost(app, `/api/diaspora-contracts/${c.id}/generate-invoice`, A.adminToken, {});
    expect(last.status).toBe(201);
    expect(Number(last.body.totalAmount)).toBe(50000);
    await pay(c.id, { amount: 50000 });
    const done = await authedPost(app, `/api/diaspora-contracts/${c.id}/generate-invoice`, A.adminToken, {});
    expect(done.status).toBe(409);
  });

  it("a contract with money, updates or certificates can't be deleted; a fresh one can", async () => {
    const used = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    await pay(used.id, { amount: 10000 });
    const r = await del(`/api/diaspora-contracts/${used.id}`, A.adminToken);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/cancelled/i);
    const fresh = (await makeContract()).body;
    expect((await del(`/api/diaspora-contracts/${fresh.id}`, A.adminToken)).status).toBe(200);
    expect((await get(`/api/diaspora-contracts/${fresh.id}`, A.adminToken)).status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: construction updates", () => {
  let c: any;
  it("validates the update, keeps payment progress separate from construction progress, and follows the newest update", async () => {
    c = (await makeContract({ totalPropertyValue: 1000000, downPayment: 100000, contractDurationMonths: 9 })).body;
    const mk = (over: object = {}) => authedPost(app, "/api/construction-updates", A.adminToken, {
      diasporaContractId: c.id, updateTitle: "Foundation", updateDescription: "Foundation poured", constructionPhase: "foundation", progressPercentage: 25, photoUrls: ["/uploads/a.jpg"], ...over,
    });
    expect((await mk({ updateTitle: "" })).status).toBe(400);
    expect((await mk({ updateDescription: "  " })).status).toBe(400);
    expect((await mk({ constructionPhase: "sky" })).status).toBe(400);
    expect((await mk({ progressPercentage: 120 })).status).toBe(400);
    expect((await mk({ progressPercentage: -1 })).status).toBe(400);
    expect((await mk({ progressPercentage: "lots" })).status).toBe(400);
    expect((await mk({ estimatedCompletionDate: "someday" })).status).toBe(400);
    const ok = await mk();
    expect(ok.status).toBe(201);
    const row = await contractRow(c.id);
    expect(row.constructionStatus).toBe("foundation");
    expect(Number(row.completionPercentage)).toBeCloseTo(10, 1);     // still payment progress (100k of 1M), not 25
    const detail = (await get(`/api/diaspora-contracts/${c.id}`, A.adminToken)).body;
    expect(detail.constructionProgress).toBe(25);
    await mk({ constructionPhase: "structure", progressPercentage: 60, updateTitle: "Walls up" });
    expect((await contractRow(c.id)).constructionStatus).toBe("structure");
    // a payment recalculation no longer wipes the construction status either
    await pay(c.id, { amount: 100000 });
    expect((await contractRow(c.id)).constructionStatus).toBe("structure");
    const list = (await get("/api/diaspora-contracts", A.adminToken)).body as any[];
    expect(list.find((x) => x.id === c.id).constructionProgress).toBe(60);
  });

  it("an update can be corrected, and a cancelled contract takes no more", async () => {
    const list = (await get(`/api/construction-updates?diasporaContractId=${c.id}`, A.adminToken)).body as any[];
    expect(list).toHaveLength(2);
    const fix = await authedPatch(app, `/api/construction-updates/${list[0].id}`, A.adminToken, { progressPercentage: 65 });
    expect(fix.status).toBe(200);
    expect((await authedPatch(app, `/api/construction-updates/${list[0].id}`, A.adminToken, { progressPercentage: 500 })).status).toBe(400);
    await authedPatch(app, `/api/diaspora-contracts/${c.id}`, A.adminToken, { status: "cancelled" });
    const r = await authedPost(app, "/api/construction-updates", A.adminToken, { diasporaContractId: c.id, updateTitle: "x", updateDescription: "y", constructionPhase: "roofing", progressPercentage: 80 });
    expect(r.status).toBe(409);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: certificates", () => {
  let c: any;
  const issue = (over: object = {}) => authedPost(app, "/api/diaspora-certificates", A.adminToken, { diasporaContractId: c.id, certificateType: "ownership", status: "issued", ...over });

  it("only issued when the milestone is real; the identifiers and fingerprint are made by the server", async () => {
    c = (await makeContract({ totalPropertyValue: 300000, downPayment: 100000, contractDurationMonths: 2 })).body;
    expect((await issue({ certificateType: "magic" })).status).toBe(400);
    expect((await issue({ status: "revoked" })).status).toBe(400);
    expect((await issue({ issuedDate: "2027-01-02", expiryDate: "2027-01-01" })).status).toBe(400);
    const unpaid = await issue();
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.message).toMatch(/fully paid/i);
    expect((await issue({ certificateType: "payment" })).status).toBe(409);
    const notBuilt = await issue({ certificateType: "completion" });
    expect(notBuilt.status).toBe(409);

    await pay(c.id, { amount: 200000 });
    const forged = await issue({ certificateNumber: "CERT-X", blockchainHash: "0xdeadbeef", qrCode: "FAKE", verificationUrl: "https://evil.example/x" });
    expect(forged.status).toBe(201);
    expect(forged.body.certificateNumber).toBe("CERT-X");                    // a human may choose the number…
    expect(forged.body.blockchainHash).toMatch(/^0x[0-9a-f]{64}$/);            // …never the fingerprint
    expect(forged.body.blockchainHash).not.toBe("0xdeadbeef");
    expect(forged.body.qrCode).not.toBe("FAKE");
    expect(forged.body.verificationUrl).not.toContain("evil.example");
    expect(forged.body.issuedBy).toBe(A.adminUserId);
    const row = await contractRow(c.id);
    expect(row.digitalCertificateIssued).toBe(true);
    expect(row.certificateStatus).toBe("issued");
    expect(row.blockchainHash).toBe(forged.body.blockchainHash);
  });

  it("a second live certificate of the same kind is refused; a duplicate number is refused", async () => {
    const dup = await issue();
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already has a live/i);
    await authedPost(app, "/api/diaspora-contracts/" + c.id + "/recalc-balance", A.adminToken, {});
    const pay2 = await issue({ certificateType: "payment", certificateNumber: "CERT-X" });
    expect(pay2.status).toBe(409);
    expect(pay2.body.message).toMatch(/already used/i);
  });

  it("verify, then revoke (a reason is required); a revoked certificate is final and lets a new one be issued", async () => {
    const list = (await get(`/api/diaspora-certificates?diasporaContractId=${c.id}`, A.adminToken)).body as any[];
    const cert = list[0];
    const v = await authedPatch(app, `/api/diaspora-certificates/${cert.id}`, A.adminToken, { status: "verified" });
    expect(v.status).toBe(200);
    expect(v.body.verifiedBy).toBe(A.adminUserId);
    expect((await contractRow(c.id)).certificateStatus).toBe("verified");
    expect((await authedPatch(app, `/api/diaspora-certificates/${cert.id}`, A.adminToken, { status: "banana" })).status).toBe(400);
    expect((await authedPatch(app, `/api/diaspora-certificates/${cert.id}`, A.adminToken, { status: "revoked" })).status).toBe(400);
    const rv = await authedPatch(app, `/api/diaspora-certificates/${cert.id}`, A.adminToken, { status: "revoked", revocationReason: "Issued in error" });
    expect(rv.status).toBe(200);
    expect(rv.body.revocationReason).toBe("Issued in error");
    const row = await contractRow(c.id);
    expect(row.digitalCertificateIssued).toBe(false);
    expect(row.certificateStatus).toBe("revoked");
    expect((await authedPatch(app, `/api/diaspora-certificates/${cert.id}`, A.adminToken, { status: "verified" })).status).toBe(409);
    expect((await issue({ certificateNumber: undefined })).status).toBe(201);
    expect((await contractRow(c.id)).digitalCertificateIssued).toBe(true);
  });

  it("a construction-completion certificate needs construction marked completed", async () => {
    const k = (await makeContract({ totalPropertyValue: 300000, downPayment: 100000, contractDurationMonths: 2 })).body;
    await authedPost(app, "/api/construction-updates", A.adminToken, { diasporaContractId: k.id, updateTitle: "Handover", updateDescription: "Done", constructionPhase: "completed", progressPercentage: 100 });
    const r = await authedPost(app, "/api/diaspora-certificates", A.adminToken, { diasporaContractId: k.id, certificateType: "completion", status: "issued" });
    expect(r.status).toBe(201);
    expect((await contractRow(k.id)).actualCompletionDate).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("diaspora: buyer portal", () => {
  let mine: any;
  let theirs: any;
  let staffId: string;

  it("a buyer sees only their own contract, with no staff-only fields", async () => {
    mine = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    theirs = (await makeContract({ totalPropertyValue: 800000, downPayment: 100000, contractDurationMonths: 7 })).body;
    // the tenant login of organisation A stands in for the invited buyer
    await db.update(diasporaContracts).set({ buyerUserId: A.tenantUserId } as any).where(eq(diasporaContracts.id, mine.id));
    await pay(mine.id, { amount: 100000, notes: "internal: chase the bank" });
    await authedPost(app, "/api/construction-updates", A.adminToken, { diasporaContractId: mine.id, updateTitle: "Site", updateDescription: "Cleared", constructionPhase: "planning", progressPercentage: 15 });

    const list = (await get("/api/diaspora-portal/contracts", A.tenantToken)).body as any[];
    expect(list.map((x) => x.id)).toEqual([mine.id]);
    expect(list[0].constructionProgress).toBe(15);
    expect(Number(list[0].completionPercentage)).toBeCloseTo(25, 1);       // payment progress stays payment progress
    expect(list[0].propertySiteSettings).toBeUndefined();
    const one = (await get(`/api/diaspora-portal/contracts/${mine.id}`, A.tenantToken)).body;
    for (const k of ["createdBy", "assignedManager", "buyerUserId", "localBankAccount"]) expect(one).not.toHaveProperty(k);
    expect(one.constructionProgress).toBe(15);
    expect((await get(`/api/diaspora-portal/contracts/${theirs.id}`, A.tenantToken)).status).toBe(404);
    expect((await get(`/api/diaspora-portal/contracts/${theirs.id}/payments`, A.tenantToken)).status).toBe(404);

    const pays = (await get(`/api/diaspora-portal/contracts/${mine.id}/payments`, A.tenantToken)).body as any[];
    expect(pays).toHaveLength(1);
    expect(pays[0]).not.toHaveProperty("processedBy");
    expect(pays[0]).not.toHaveProperty("notes");
    const ups = (await get(`/api/diaspora-portal/contracts/${mine.id}/construction`, A.tenantToken)).body as any[];
    expect(ups[0]).not.toHaveProperty("updatedBy");
  });

  it("a buyer can write to staff of their own organisation only", async () => {
    const mgr = (await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, A.orgId), eq(users.role, "admin"))))[0];
    staffId = mgr.id;
    const ok = await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "When is the next instalment due?", toUserId: staffId });
    expect(ok.status).toBe(201);
    const auto = await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "Hello" });
    expect(auto.status).toBe(201);
    expect(auto.body.data.toUserId).toBe(staffId);
    // another organisation's user, another tenant, the buyer's own admin-looking id: all refused
    const outsider = await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "hi", toUserId: B.adminUserId });
    expect(outsider.status).toBe(403);
    const peer = await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "hi", toUserId: A.tenantUserId });
    expect(peer.status).toBe(403);
    expect((await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "   " })).status).toBe(400);
    expect((await authedPost(app, "/api/diaspora-portal/messages", A.tenantToken, { content: "x".repeat(5001) })).status).toBe(400);
  });
});
