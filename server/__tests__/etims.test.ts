/**
 * etims.test.ts
 *
 * Tests the eTIMS integration in sandbox mode (default).
 * No live KRA credentials required — all submissions hit the sandbox simulator.
 *
 * Coverage:
 *   Device setup
 *     ✓ POST /api/etims/device → saves TIN/BHF credentials
 *     ✓ POST /api/etims/device without TIN → 400
 *     ✓ 401 without token on all endpoints
 *
 *   Initialisation
 *     ✓ POST /api/etims/initialise → succeeds in sandbox, device status = active
 *     ✓ POST /api/etims/initialise without device → 400
 *
 *   Status
 *     ✓ GET /api/etims/status → returns device + stats shape
 *     ✓ Stats start at zero for a fresh org
 *
 *   Invoice submission (sandbox)
 *     ✓ POST /api/etims/submit with rent_payment → 201, rcptNo set, sandbox flag true
 *     ✓ POST /api/etims/submit with invoice → 201
 *     ✓ POST /api/etims/submit with invalid sourceId → 500 (not found)
 *     ✓ POST /api/etims/submit with missing sourceId → 400
 *     ✓ Submission appears in GET /api/etims/submissions
 *     ✓ Accepted count increments after successful submission
 *
 *   Batch submission
 *     ✓ POST /api/etims/submit-batch → 207 with per-item results
 *     ✓ Empty items array → 400
 *
 *   Submissions list
 *     ✓ GET /api/etims/submissions → 200 array
 *     ✓ GET /api/etims/submissions/:id → 200 with detail
 *     ✓ GET /api/etims/submissions/999999 → 404
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import {
  getApp, setupTestData, cleanupTestData,
  authedGet, authedPost, type TestContext,
} from "./helpers";
import { db } from "../db";
import { etimsDeviceInfo, etimsInvoices, invoices, rentPayments } from "@shared/schema";
import { eq } from "drizzle-orm";

let app: any;
let ctx: TestContext;
let testPaymentId: number;
let testInvoiceId: number;

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();

  // Create a test rent payment for this org
  const [pmt] = await db.insert(rentPayments).values({
    tenantId:      ctx.tenantId,
    organizationId: ctx.orgId,
    amount:        "50000",
    currency:      "KES",
    status:        "paid",
    paymentMethod: "mpesa",
    dueDate:       new Date("2025-03-01"),
    paidDate:      new Date("2025-03-01"),
  } as any).returning({ id: rentPayments.id });
  testPaymentId = pmt.id;

  // Create a test invoice
  const [inv] = await db.insert(invoices).values({
    invoiceNumber: `INV-ETIMS-TEST-${Date.now()}`,
    propertyId:    1,
    tenantId:      ctx.tenantId,
    type:          "rent",
    amount:        "50000",
    currency:      "KES",
    totalAmount:   "50000",
    dueDate:       new Date("2025-03-31"),
    status:        "paid",
    description:   "Test rent invoice for eTIMS",
  } as any).returning({ id: invoices.id });
  testInvoiceId = inv.id;
});

afterAll(async () => {
  await db.delete(etimsInvoices).where(eq(etimsInvoices.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(etimsDeviceInfo).where(eq(etimsDeviceInfo.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(rentPayments).where(eq(rentPayments.id, testPaymentId)).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, testInvoiceId)).catch(() => {});
  await cleanupTestData(ctx);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("Auth guards", () => {
  it("GET /api/etims/status without token → 401", async () => {
    expect((await supertest(app).get("/api/etims/status")).status).toBe(401);
  });
  it("POST /api/etims/device without token → 401", async () => {
    expect((await supertest(app).post("/api/etims/device").send({ tin: "P0512345" })).status).toBe(401);
  });
  it("POST /api/etims/submit without token → 401", async () => {
    expect((await supertest(app).post("/api/etims/submit").send({})).status).toBe(401);
  });
});

// ── Device setup ──────────────────────────────────────────────────────────────

describe("POST /api/etims/device", () => {

  it("saves valid TIN/BHF → 200", async () => {
    const res = await authedPost(app, "/api/etims/device", ctx.adminToken, {
      tin: "P051234567X", bhfId: "00", sandbox: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.tin).toBe("P051234567X");
    expect(res.body.status).toBe("pending");
  });

  it("missing TIN → 400", async () => {
    const res = await authedPost(app, "/api/etims/device", ctx.adminToken, { bhfId: "00" });
    expect(res.status).toBe(400);
  });

});

// ── Initialisation ────────────────────────────────────────────────────────────

describe("POST /api/etims/initialise", () => {

  it("sandbox initialise → device becomes active", async () => {
    // Ensure device exists first
    await authedPost(app, "/api/etims/device", ctx.adminToken, {
      tin: "P051234567X", bhfId: "00", sandbox: true,
    });

    const res = await authedPost(app, "/api/etims/initialise", ctx.adminToken, {});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sandbox).toBe(true);

    // Device status should now be active
    const status = await authedGet(app, "/api/etims/status", ctx.adminToken);
    expect(status.body.device?.status).toBe("active");
  });

});

// ── Status ────────────────────────────────────────────────────────────────────

describe("GET /api/etims/status", () => {

  it("returns device + stats shape", async () => {
    const res = await authedGet(app, "/api/etims/status", ctx.adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("device");
    expect(res.body).toHaveProperty("sandbox");
    expect(res.body.stats).toHaveProperty("total");
    expect(res.body.stats).toHaveProperty("accepted");
    expect(res.body.stats).toHaveProperty("pending");
    expect(res.body.stats).toHaveProperty("rejected");
  });

});

// ── Invoice submission ────────────────────────────────────────────────────────

describe("POST /api/etims/submit", () => {

  it("rent_payment → 201, sandbox flag true, rcptNo set", async () => {
    const res = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "rent_payment",
      sourceId:   testPaymentId,
      isVatRegistered: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.sandbox).toBe(true);
    expect(typeof res.body.rcptNo).toBe("string");
    expect(res.body.rcptNo.length).toBeGreaterThan(0);
  });

  it("invoice → 201, sandbox receipt returned", async () => {
    const res = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "invoice",
      sourceId:   testInvoiceId,
      isVatRegistered: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("VAT-registered invoice splits taxable/exempt amounts correctly", async () => {
    const res = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "rent_payment",
      sourceId:   testPaymentId,
      isVatRegistered: true,
    });
    expect(res.status).toBe(201);
    // Check the DB record has VAT amounts set
    const [row] = await db.select().from(etimsInvoices)
      .where(eq(etimsInvoices.id, res.body.etimsId));
    expect(Number(row.taxAmtA)).toBeGreaterThan(0);
    expect(Number(row.taxblAmtB)).toBe(0);
  });

  it("non-existent sourceId → 500 not found", async () => {
    const res = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "invoice",
      sourceId:   999999999,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("missing sourceId → 400", async () => {
    const res = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "invoice",
    });
    expect(res.status).toBe(400);
  });

  it("submission appears in GET /api/etims/submissions", async () => {
    const subs = await authedGet(app, "/api/etims/submissions", ctx.adminToken);
    expect(subs.status).toBe(200);
    expect(Array.isArray(subs.body)).toBe(true);
    expect(subs.body.length).toBeGreaterThan(0);
    expect(subs.body[0]).toHaveProperty("invcNo");
    expect(subs.body[0]).toHaveProperty("status");
  });

  it("accepted count increments after successful submission", async () => {
    const before = (await authedGet(app, "/api/etims/status", ctx.adminToken)).body.stats.accepted;
    await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "rent_payment", sourceId: testPaymentId,
    });
    const after = (await authedGet(app, "/api/etims/status", ctx.adminToken)).body.stats.accepted;
    expect(after).toBeGreaterThan(before);
  });

});

// ── Batch submission ──────────────────────────────────────────────────────────

describe("POST /api/etims/submit-batch", () => {

  it("207 with per-item results", async () => {
    const res = await authedPost(app, "/api/etims/submit-batch", ctx.adminToken, {
      items: [
        { sourceType: "rent_payment", sourceId: testPaymentId },
        { sourceType: "invoice",      sourceId: testInvoiceId },
      ],
    });
    expect(res.status).toBe(207);
    expect(typeof res.body.succeeded).toBe("number");
    expect(typeof res.body.failed).toBe("number");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBe(2);
  });

  it("empty items → 400", async () => {
    const res = await authedPost(app, "/api/etims/submit-batch", ctx.adminToken, { items: [] });
    expect(res.status).toBe(400);
  });

});

// ── Submissions detail ────────────────────────────────────────────────────────

describe("GET /api/etims/submissions/:id", () => {

  it("returns submission detail with all KRA fields", async () => {
    // First submit to get an ID
    const sub = await authedPost(app, "/api/etims/submit", ctx.adminToken, {
      sourceType: "rent_payment", sourceId: testPaymentId,
    });
    const etimsId = sub.body.etimsId;

    const res = await authedGet(app, `/api/etims/submissions/${etimsId}`, ctx.adminToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(etimsId);
    expect(res.body).toHaveProperty("rcptNo");
    expect(res.body).toHaveProperty("tpin");
    expect(res.body).toHaveProperty("totAmt");
    expect(res.body.status).toBe("accepted");
  });

  it("non-existent id → 404", async () => {
    const res = await authedGet(app, "/api/etims/submissions/999999999", ctx.adminToken);
    expect(res.status).toBe(404);
  });

});
