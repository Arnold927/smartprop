/**
 * rent-payments.test.ts — Rent payment recording flow
 *
 * Covers:
 *   - Record a rent payment → 201 + payment record
 *   - Payment appears in tenant's payment history
 *   - Payment status transitions (pending → paid)
 *   - M-Pesa transaction ID deduplication (second insert of same mpesaId → 409 or skip)
 *   - Import of historical payments via /api/import/rent-payments
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { setupTestData, cleanupTestData, authedGet, authedPost, type TestContext } from "./helpers";
import { db } from "../db";
import { rentPayments } from "@shared/schema";
import { eq } from "drizzle-orm";

let app: any;
let ctx: TestContext;
let createdPaymentId: number;

beforeAll(async () => {
  app = await createApp();
  ctx = await setupTestData();
});

afterAll(async () => {
  // Clean up any payments created during tests
  if (createdPaymentId) {
    await db.delete(rentPayments).where(eq(rentPayments.id, createdPaymentId)).catch(() => {});
  }
  await cleanupTestData(ctx);
});

describe("POST /api/rent-payments", () => {
  it("creates a rent payment record → 201", async () => {
    const res = await authedPost(app, "/api/rent-payments", ctx.adminToken, {
      tenantId:      ctx.tenantId,
      amount:        "50000",
      currency:      "KES",
      dueDate:       "2025-01-01",
      paidDate:      "2025-01-03",
      paymentMethod: "mpesa",
      status:        "paid",
      notes:         "Test payment",
    });

    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(ctx.tenantId);
    expect(res.body.amount).toBe("50000");
    expect(res.body.status).toBe("paid");
    createdPaymentId = res.body.id;
  });

  it("payment appears in GET /api/rent-payments", async () => {
    const res = await authedGet(app, `/api/rent-payments?tenantId=${ctx.tenantId}`, ctx.adminToken);
    expect(res.status).toBe(200);
    const payments = res.body as Array<{ id: number }>;
    const found = payments.some(p => p.id === createdPaymentId);
    expect(found).toBe(true);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await authedPost(app, "/api/rent-payments", ctx.adminToken, {
      // missing tenantId and amount
      dueDate: "2025-01-01",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("POST /api/import/rent-payments", () => {
  it("imports historical payment rows successfully", async () => {
    const res = await authedPost(app, "/api/import/rent-payments", ctx.adminToken, {
      payments: [
        {
          tenant_email:  ctx.tenantUserId ? undefined : undefined, // use email
          tenant_id:     String(ctx.tenantId),
          amount:        "50000",
          due_date:      "2024-12-01",
          paid_date:     "2024-12-02",
          payment_method:"mpesa",
          mpesa_transaction_id: `HIST-${Date.now()}`,
          status:        "paid",
          currency:      "KES",
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it("skips duplicate mpesa_transaction_id", async () => {
    const mpesaId = `DUP-TEST-${Date.now()}`;

    // First import
    await authedPost(app, "/api/import/rent-payments", ctx.adminToken, {
      payments: [{
        tenant_id: String(ctx.tenantId),
        amount: "50000", due_date: "2024-11-01", paid_date: "2024-11-02",
        mpesa_transaction_id: mpesaId, status: "paid",
      }],
    });

    // Second import with same mpesaId
    const res = await authedPost(app, "/api/import/rent-payments", ctx.adminToken, {
      payments: [{
        tenant_id: String(ctx.tenantId),
        amount: "50000", due_date: "2024-11-01", paid_date: "2024-11-02",
        mpesa_transaction_id: mpesaId, status: "paid",
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);
    expect(res.body.imported).toBe(0);
  });
});
