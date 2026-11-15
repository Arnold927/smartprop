/**
 * whatsapp-balance.test.ts — what the WhatsApp bot tells a tenant about money must match the tenant portal:
 *   BALANCE  → what is still owed (a part-paid invoice counts only for its balance; part-paid invoices are included;
 *              invoices beyond the first five are not dropped from the total)
 *   RECEIPT  → the latest payment actually received (a part payment is its own receipt)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const sent: string[] = [];
vi.mock("../whatsapp", () => ({
  whatsappService: { sendMessage: async (m: any) => { sent.push(String(m.content)); return { success: true }; } },
}));

import { getApp, setupTestData, cleanupTestData, authedPost, type TestContext } from "./helpers";
import { db } from "../db";
import { rentPayments, paymentReceipts, generalLedger, tenants } from "@shared/schema";
import { eq, inArray, like } from "drizzle-orm";
import { handleInboundMessage } from "../services/whatsappBot";

let ctx: TestContext;
const ids: number[] = [];
const phone = `+2547${String(Date.now()).slice(-8)}`;

async function ask(text: string): Promise<string> {
  sent.length = 0;
  await handleInboundMessage(phone, text, ctx.orgId);
  return sent.join("\n");
}

beforeAll(async () => {
  const app = await getApp();
  ctx = await setupTestData();
  await db.update(tenants).set({ phone }).where(eq(tenants.id, ctx.tenantId));
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T07:00:00Z") });   // 10:00 EAT — outside quiet hours

  // 7 open invoices of 1,000 (more than the old limit of 5) …
  for (let i = 1; i <= 7; i++) {
    const r = await authedPost(app, "/api/rent-payments", ctx.adminToken, { tenantId: ctx.tenantId, amount: "1000", dueDate: `2026-0${i}-05`, invoiceNumber: `WA-${Date.now() % 100000}-${i}` });
    expect(r.status).toBe(201);
    ids.push(r.body.id);
  }
  // … one of which is part-paid: 400 received → 600 left
  vi.useRealTimers();
  const mp = await authedPost(app, `/api/rent-payments/${ids[0]}/mark-paid`, ctx.adminToken, { amount: 400, paymentMethod: "cash", paidDate: "2026-01-06" });
  expect(mp.status).toBe(200);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T07:00:00Z") });
});

afterAll(async () => {
  vi.useRealTimers();
  await db.delete(paymentReceipts).where(inArray(paymentReceipts.paymentId, ids)).catch(() => {});
  await db.delete(rentPayments).where(inArray(rentPayments.id, ids)).catch(() => {});
  await db.delete(generalLedger).where(like(generalLedger.reference, "GL-RENT-WA-%")).catch(() => {});
  await cleanupTestData(ctx);
});

describe("WhatsApp BALANCE", () => {
  it("totals every open invoice by what is LEFT on it (6 × 1,000 + 600 = 6,600)", async () => {
    const reply = await ask("BALANCE");
    expect(reply).toMatch(/6,600/);
    expect(reply).not.toMatch(/7,000/);
  });

  it("next due shows the part-paid invoice's balance, not its full amount", async () => {
    const reply = await ask("balance");
    expect(reply).toMatch(/Next due:[^\n]*KES\s*600(?![\d,])/);
  });
});

describe("WhatsApp RECEIPT", () => {
  it("shows the part payment that was actually received (400), not nothing", async () => {
    const reply = await ask("RECEIPT");
    expect(reply).not.toMatch(/No Receipts Found/);
    expect(reply).toMatch(/400/);
  });
});
