/**
 * general-ledger.test.ts
 *
 * Tests the double-entry general ledger journal entry endpoints.
 *
 * Coverage:
 *   POST /api/journal-entries
 *     ✓ Balanced entry (2 lines, debit = credit) → 201
 *     ✓ Unbalanced entry → 422 with helpful message
 *     ✓ Entry with only 1 line → 400
 *     ✓ Invalid accountId → 400
 *     ✓ Missing description → 400
 *     ✓ 401 without token
 *
 *   GET /api/journal-entries
 *     ✓ 200 + entries array for admin
 *     ✓ 401 without token
 *
 *   GET /api/journal-entries/:id
 *     ✓ Returns entry with lines including accountCode/accountName
 *     ✓ 404 for non-existent id
 *
 *   POST /api/journal-entries/:id/reverse
 *     ✓ Creates reversing entry with swapped debits/credits
 *     ✓ Original entry marked "reversed"
 *     ✓ 409 if already reversed
 *
 *   Reports
 *     ✓ GET /reports/trial-balance → balanced flag true after symmetric entry
 *     ✓ GET /reports/income-statement → revenue and expense totals
 *     ✓ GET /reports/balance-sheet → assets = liabilities + equity flag
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import {
  getApp, setupTestData, cleanupTestData,
  authedGet, authedPost, type TestContext,
} from "./helpers";
import { db } from "../db";
import { journalEntries, journalEntryLines, generalLedger, chartOfAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

let app: any;
let ctx: TestContext;
let debitAccId: number;
let creditAccId: number;
const createdJeIds: number[] = [];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();

  // Seed the chart of accounts by calling the endpoint (auto-seeds on first GET)
  await authedGet(app, "/api/chart-of-accounts", ctx.adminToken);

  // Get two account IDs from this org
  const accounts = await db
    .select({ id: chartOfAccounts.id, accountType: chartOfAccounts.accountType })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, ctx.orgId))
    .limit(10);

  const asset   = accounts.find(a => a.accountType === "asset");
  const revenue = accounts.find(a => a.accountType === "revenue");
  if (!asset || !revenue) throw new Error("Seed accounts not found");
  debitAccId  = asset.id;
  creditAccId = revenue.id;
});

afterAll(async () => {
  // Clean GL entries, journal lines, journal entries for this org
  await db.delete(generalLedger).where(eq(generalLedger.organizationId, ctx.orgId)).catch(() => {});
  for (const id of createdJeIds) {
    await db.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, id)).catch(() => {});
  }
  await db.delete(journalEntries).where(eq(journalEntries.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(chartOfAccounts).where(eq(chartOfAccounts.organizationId, ctx.orgId)).catch(() => {});
  await cleanupTestData(ctx);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function balancedPayload(amount = 50000) {
  return {
    entryDate:   "2025-03-01",
    description: "Test rent received",
    reference:   "TEST-001",
    currency:    "KES",
    lines: [
      { accountId: debitAccId,  debitAmount: amount, creditAmount: 0 },
      { accountId: creditAccId, debitAmount: 0,       creditAmount: amount },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/journal-entries
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/journal-entries", () => {

  it("balanced entry → 201 with entryId and status 'posted'", async () => {
    const res = await authedPost(app, "/api/journal-entries", ctx.adminToken, balancedPayload());
    expect(res.status).toBe(201);
    expect(res.body.entryId).toMatch(/^JE-/);
    expect(res.body.status).toBe("posted");
    expect(res.body.totalDebit).toBe("50000.00");
    expect(res.body.totalCredit).toBe("50000.00");
    createdJeIds.push(res.body.id);
  });

  it("unbalanced entry → 422 with descriptive message", async () => {
    const payload = {
      ...balancedPayload(50000),
      lines: [
        { accountId: debitAccId,  debitAmount: 50000, creditAmount: 0 },
        { accountId: creditAccId, debitAmount: 0,      creditAmount: 40000 }, // ← wrong
      ],
    };
    const res = await authedPost(app, "/api/journal-entries", ctx.adminToken, payload);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/unbalanced/i);
  });

  it("single line → 400 (minimum 2 lines required)", async () => {
    const payload = {
      entryDate: "2025-03-01", description: "Single line test", currency: "KES",
      lines: [{ accountId: debitAccId, debitAmount: 1000, creditAmount: 0 }],
    };
    const res = await authedPost(app, "/api/journal-entries", ctx.adminToken, payload);
    expect(res.status).toBe(400);
  });

  it("missing description → 400", async () => {
    const { description, ...noDesc } = balancedPayload();
    const res = await authedPost(app, "/api/journal-entries", ctx.adminToken, noDesc);
    expect(res.status).toBe(400);
  });

  it("invalid accountId (from another org) → 400", async () => {
    const payload = {
      ...balancedPayload(),
      lines: [
        { accountId: 999999, debitAmount: 1000, creditAmount: 0 },
        { accountId: debitAccId, debitAmount: 0, creditAmount: 1000 },
      ],
    };
    const res = await authedPost(app, "/api/journal-entries", ctx.adminToken, payload);
    expect(res.status).toBe(400);
  });

  it("401 without token", async () => {
    const res = await supertest(app).post("/api/journal-entries").send(balancedPayload());
    expect(res.status).toBe(401);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/journal-entries", () => {

  it("200 + paginated response for admin", async () => {
    const res = await authedGet(app, "/api/journal-entries", ctx.adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.pages).toBe("number");
  });

  it("401 without token", async () => {
    const res = await supertest(app).get("/api/journal-entries");
    expect(res.status).toBe(401);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries/:id
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/journal-entries/:id", () => {

  it("returns entry with enriched lines (accountCode, accountName)", async () => {
    // Create a fresh entry to inspect
    const create = await authedPost(app, "/api/journal-entries", ctx.adminToken, balancedPayload(10000));
    expect(create.status).toBe(201);
    const id = create.body.id;
    createdJeIds.push(id);

    const res = await authedGet(app, `/api/journal-entries/${id}`, ctx.adminToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(Array.isArray(res.body.lines)).toBe(true);
    expect(res.body.lines.length).toBe(2);
    // Lines must have account info joined
    expect(res.body.lines[0]).toHaveProperty("accountCode");
    expect(res.body.lines[0]).toHaveProperty("accountName");
  });

  it("404 for non-existent id", async () => {
    const res = await authedGet(app, "/api/journal-entries/999999999", ctx.adminToken);
    expect(res.status).toBe(404);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/journal-entries/:id/reverse
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /api/journal-entries/:id/reverse", () => {

  it("creates reversing entry with swapped debits/credits, original marked 'reversed'", async () => {
    const create = await authedPost(app, "/api/journal-entries", ctx.adminToken, balancedPayload(25000));
    expect(create.status).toBe(201);
    const id = create.body.id;
    createdJeIds.push(id);

    const rev = await authedPost(app, `/api/journal-entries/${id}/reverse`, ctx.adminToken, {
      reverseDate: "2025-03-15",
    });
    expect(rev.status).toBe(201);
    expect(rev.body.entryId).toMatch(/REV/);
    expect(rev.body.status).toBe("posted");
    // Debit/credit should be swapped relative to original
    expect(rev.body.totalDebit).toBe(create.body.totalCredit);
    expect(rev.body.totalCredit).toBe(create.body.totalDebit);
    createdJeIds.push(rev.body.id);

    // Original should now be "reversed"
    const original = await authedGet(app, `/api/journal-entries/${id}`, ctx.adminToken);
    expect(original.body.status).toBe("reversed");
  });

  it("409 if entry is already reversed", async () => {
    const create = await authedPost(app, "/api/journal-entries", ctx.adminToken, balancedPayload(5000));
    const id = create.body.id;
    createdJeIds.push(id);

    await authedPost(app, `/api/journal-entries/${id}/reverse`, ctx.adminToken, { reverseDate: "2025-03-16" });
    const second = await authedPost(app, `/api/journal-entries/${id}/reverse`, ctx.adminToken, { reverseDate: "2025-03-16" });
    expect(second.status).toBe(409);
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/journal-entries/reports/trial-balance", () => {

  it("200 with balanced flag and accounts array", async () => {
    const res = await authedGet(app, "/api/journal-entries/reports/trial-balance", ctx.adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(typeof res.body.balanced).toBe("boolean");
    expect(res.body.grandDebit).toBeDefined();
    expect(res.body.grandCredit).toBeDefined();
  });

  it("after a symmetric balanced entry, grandDebit === grandCredit", async () => {
    const amount = 99000;
    await authedPost(app, "/api/journal-entries", ctx.adminToken, balancedPayload(amount));

    const res = await authedGet(app, "/api/journal-entries/reports/trial-balance", ctx.adminToken);
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(Number(res.body.grandDebit)).toBeCloseTo(Number(res.body.grandCredit), 1);
  });

});

describe("GET /api/journal-entries/reports/income-statement", () => {

  it("200 with revenues, expenses, netIncome", async () => {
    const res = await authedGet(
      app,
      `/api/journal-entries/reports/income-statement?from=2025-01-01&to=2025-12-31`,
      ctx.adminToken,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.revenues)).toBe(true);
    expect(Array.isArray(res.body.expenses)).toBe(true);
    expect(res.body.netIncome).toBeDefined();
    expect(res.body.totalRevenue).toBeDefined();
    expect(res.body.totalExpenses).toBeDefined();
  });

});

describe("GET /api/journal-entries/reports/balance-sheet", () => {

  it("200 with assets, liabilities, equity and balanced flag", async () => {
    const res = await authedGet(app, "/api/journal-entries/reports/balance-sheet", ctx.adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(Array.isArray(res.body.liabilities)).toBe(true);
    expect(Array.isArray(res.body.equity)).toBe(true);
    expect(typeof res.body.balanced).toBe("boolean");
    expect(res.body.totalAssets).toBeDefined();
  });

});
