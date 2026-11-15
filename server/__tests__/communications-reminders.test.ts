/**
 * communications-reminders.test.ts — payment reminders, broadcasts, messages, notification preferences.
 *
 * reminders      "Send reminder" really delivers (and says so honestly): sent / failed / skipped with a reason; the tenant's own
 *                opt-outs are respected; channel choice (WhatsApp → email → SMS); never to another organisation's tenant;
 *                a double click does not send twice; queued reminders go out once, can be cancelled, and are picked up on time
 * scheduler      overdue reminders respect cadence, opt-outs and tenant status, and are logged; pre-due warnings go once per invoice
 * preferences    category switches and quiet hours are honoured; the email switch is its own switch
 * broadcasts     templates route works; managers can send; tenants without a login are reachable; unconfigured channels are
 *                reported, not counted as sent; HTML is escaped; scheduled broadcasts are really sent (once) and can be cancelled
 * messages       tenants can only write to the management team; mass messaging is for admins and managers; no mass assignment
 * phone          Kenyan numbers become E.164
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import {
  users, tenants, arrears, arrearsActions, paymentReminders, rentPayments, broadcastMessages, broadcastRecipients,
  communicationTemplates, messages, userNotificationPreferences, units, properties, paymentReceipts,
} from "@shared/schema";
import { eq, inArray, and, desc } from "drizzle-orm";
import { toE164 } from "../lib/phone";
import { whatsappService } from "../whatsapp";
import { getMessagingService } from "../services/messaging";
import { processDueReminders } from "../services/payment-reminders";
import { dispatchDueBroadcasts } from "../services/broadcast-dispatch";
import { sendOverdueRentReminders, sendRentDueWarnings } from "../services/rentScheduler";
import { notifyTenant, isQuietHours } from "../services/notifyTenant";

let app: any;
let ctx: TestContext;
let other: TestContext;
let managerToken: string;
let managerId: string;
let landlord: { id: string; token: string };
let staff: { id: string; token: string };
let seq = 0;
const REM = "/api/payment-reminders";
const BC = "/api/broadcast-messages";

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number, role: string, extra: { isActive?: boolean } = {}) {
  const email = `cm-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Cm", lastName: role, role, organizationId: orgId, emailVerified: true, ...extra } as any);
  return { id, email, token: extra.isActive === false ? "" : await login(email) };   // deactivated users cannot sign in
}

// ── provider doubles: nothing real is ever sent ──
const messaging = getMessagingService();
let waReady = false, emailReady = false, smsReady = false;
const sendWa = vi.spyOn(whatsappService, "sendMessage");
const sendEmail = vi.spyOn(messaging, "sendEmail");
const sendSms = vi.spyOn(messaging, "sendSMS");
function providers(o: { wa?: boolean; email?: boolean; sms?: boolean; fail?: boolean } = {}) {
  waReady = !!o.wa; emailReady = !!o.email; smsReady = !!o.sms;
  vi.spyOn(whatsappService, "isConfiguredForOrg").mockImplementation(() => waReady);
  vi.spyOn(messaging, "isEmailConfigured").mockImplementation(() => emailReady);
  vi.spyOn(messaging, "isSmsConfigured").mockImplementation(() => smsReady);
  sendWa.mockReset().mockResolvedValue(!o.fail);
  sendEmail.mockReset().mockResolvedValue(!o.fail);
  sendSms.mockReset().mockResolvedValue(!o.fail);
}

// ── fixtures ──
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Tenants always have a portal user and an email column; `email: null` means "blank on the tenant record" (the user keeps a placeholder). */
async function tenantOf(c: TestContext, o: { phone?: string | null; email?: string | null; status?: string } = {}) {
  const userId = randomUUID();
  const email = o.email === undefined ? `cmt-${randomUUID().slice(0, 6)}@smartprop-test.local` : o.email;
  await db.insert(users).values({ id: userId, email: `cmu-${randomUUID().slice(0, 8)}@smartprop-test.local`, passwordHash: "x", firstName: "Tn", lastName: "User", role: "tenant", organizationId: c.orgId, emailVerified: true } as any);
  const [t] = await db.insert(tenants).values({
    organizationId: c.orgId, userId, firstName: "Wanjiru", lastName: `T${++seq}`, email: email ?? "", phone: o.phone === undefined ? "0712345678" : o.phone,
    unitId: c.unitId, monthlyRent: "50000", currency: "KES", status: o.status ?? "active",
  } as any).returning();
  return t;
}
async function arrear(c: TestContext, tenantId: number, days = 10, amount = 25000) {
  const [a] = await db.insert(arrears).values({
    organizationId: c.orgId, tenantId, unitId: c.unitId, propertyId: c.propertyId, outstandingAmount: String(amount), currency: "KES",
    daysOverdue: days, nextDueDate: new Date(), status: "active",
  } as any).returning();
  return a;
}
async function invoice(tenantId: number, dueDate: string, status: string, amount = 30000) {
  const [r] = await db.insert(rentPayments).values({
    tenantId, amount: String(amount), currency: "KES", dueDate, status, invoiceNumber: `CM-${Date.now().toString(36)}-${++seq}`.toUpperCase(),
  } as any).returning();
  return r;
}
const prefs = (userId: string, p: object) => db.insert(userNotificationPreferences).values({ userId, ...p } as any).onConflictDoNothing();
const reminderRows = (tenantId: number) => db.select().from(paymentReminders).where(eq(paymentReminders.tenantId, tenantId)).orderBy(desc(paymentReminders.id));
const send = (body: object, token = ctx.adminToken) => authedPost(app, REM, token, body);
const waCallsTo = (phone: string) => sendWa.mock.calls.filter(c => (c[0] as any).to === phone);

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  other = await setupTestData();
  const m = await makeUser(ctx.orgId, "manager"); managerToken = m.token; managerId = m.id;
  landlord = await makeUser(ctx.orgId, "landlord");
  staff = await makeUser(ctx.orgId, "staff");
  providers();
});

afterEach(() => providers());

afterAll(async () => {
  vi.restoreAllMocks();
  for (const c of [ctx, other]) {
    const tids = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, c.orgId))).map(t => t.id);
    const uids = (await db.select({ id: users.id }).from(users).where(eq(users.organizationId, c.orgId))).map(u => u.id);
    if (tids.length) {
      await db.delete(paymentReminders).where(inArray(paymentReminders.tenantId, tids)).catch(() => {});
      const invs = (await db.select({ id: rentPayments.id }).from(rentPayments).where(inArray(rentPayments.tenantId, tids))).map(i => i.id);
      if (invs.length) await db.delete(paymentReceipts).where(inArray(paymentReceipts.paymentId, invs)).catch(() => {});
      await db.delete(rentPayments).where(inArray(rentPayments.tenantId, tids)).catch(() => {});
    }
    const arrIds = (await db.select({ id: arrears.id }).from(arrears).where(eq(arrears.organizationId, c.orgId))).map(a => a.id);
    if (arrIds.length) await db.delete(arrearsActions).where(inArray(arrearsActions.arrearsId, arrIds)).catch(() => {});
    await db.delete(arrears).where(eq(arrears.organizationId, c.orgId)).catch(() => {});
    const bids = (await db.select({ id: broadcastMessages.id }).from(broadcastMessages).where(eq(broadcastMessages.organizationId, c.orgId))).map(b => b.id);
    if (bids.length) await db.delete(broadcastRecipients).where(inArray(broadcastRecipients.broadcastId, bids)).catch(() => {});
    await db.delete(broadcastMessages).where(eq(broadcastMessages.organizationId, c.orgId)).catch(() => {});
    await db.delete(communicationTemplates).where(eq(communicationTemplates.organizationId, c.orgId)).catch(() => {});
    if (uids.length) {
      await db.delete(messages).where(inArray(messages.fromUserId, uids)).catch(() => {});
      await db.delete(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, uids)).catch(() => {});
    }
  }
  await cleanupTestData(ctx);
  await cleanupTestData(other);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("phone numbers", () => {
  it("normalises the ways Kenyans write a number", () => {
    expect(toE164("0712 345 678")).toBe("+254712345678");
    expect(toE164("0112345678")).toBe("+254112345678");
    expect(toE164("254712345678")).toBe("+254712345678");
    expect(toE164("+254 712-345-678")).toBe("+254712345678");
    expect(toE164("712345678")).toBe("+254712345678");
    expect(toE164("00254712345678")).toBe("+254712345678");
    expect(toE164("+14155550123")).toBe("+14155550123");
  });
  it("rejects things that are not phone numbers", () => {
    for (const bad of [null, undefined, "", "abc", "12345", "+12", "07123"]) expect(toE164(bad as any)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("payment reminders — delivery is real and honest", () => {
  it("is 'skipped' with a reason (not 'sent', not 'pending') when no channel is set up", async () => {
    const t = await tenantOf(ctx); const a = await arrear(ctx, t.id);
    const r = await send({ tenantId: t.id, arrearsId: a.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.delivery.status).toBe("skipped");
    expect(r.body.status).toBe("skipped");
    expect(r.body.delivery.reason).toMatch(/not configured/i);
    expect(sendWa).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends by email when that is all that is available, builds the wording from the live balance, and records sentAt", async () => {
    providers({ email: true });
    const t = await tenantOf(ctx, { phone: null }); const a = await arrear(ctx, t.id, 12, 25000);
    const r = await send({ tenantId: t.id, arrearsId: a.id });
    expect(r.body.delivery).toMatchObject({ status: "sent", channel: "email" });
    expect(r.body.sentAt).toBeTruthy();
    expect(r.body.message).toContain("25,000"); expect(r.body.message).toContain("12 days");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0][0] as any).to).toBe(t.email);
  });

  it("'auto' prefers WhatsApp, then email, then SMS", async () => {
    providers({ wa: true, email: true, sms: true });
    const t1 = await tenantOf(ctx); const a1 = await arrear(ctx, t1.id);
    expect((await send({ tenantId: t1.id, arrearsId: a1.id })).body.delivery.channel).toBe("whatsapp");
    expect(waCallsTo("0712345678").length + sendWa.mock.calls.length).toBeGreaterThan(0);

    providers({ email: true, sms: true });
    const t2 = await tenantOf(ctx); const a2 = await arrear(ctx, t2.id);
    expect((await send({ tenantId: t2.id, arrearsId: a2.id })).body.delivery.channel).toBe("email");

    providers({ sms: true });
    const t3 = await tenantOf(ctx, { email: null }); const a3 = await arrear(ctx, t3.id);
    const r3 = await send({ tenantId: t3.id, arrearsId: a3.id });
    expect(r3.body.delivery.channel).toBe("sms");
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("respects a tenant who switched payment reminders off, and says so", async () => {
    providers({ wa: true, email: true });
    const t = await tenantOf(ctx); await prefs(t.userId!, { paymentReminders: false });
    const r = await send({ tenantId: t.id, arrearsId: (await arrear(ctx, t.id)).id });
    expect(r.body.delivery.status).toBe("skipped");
    expect(r.body.delivery.reason).toMatch(/switched payment reminders off/i);
    expect(sendWa).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips a channel the tenant switched off and uses the next one", async () => {
    providers({ wa: true, email: true });
    const t = await tenantOf(ctx); await prefs(t.userId!, { whatsappNotifications: false });
    const r = await send({ tenantId: t.id, arrearsId: (await arrear(ctx, t.id)).id });
    expect(r.body.delivery.channel).toBe("email");
    expect(sendWa).not.toHaveBeenCalled();
    // asking for that channel explicitly is refused with the reason
    const r2 = await send({ tenantId: t.id, channel: "whatsapp", reminderType: "pre_due", message: "Please pay" });
    expect(r2.body.delivery).toMatchObject({ status: "skipped" });
    expect(r2.body.delivery.reason).toMatch(/WhatsApp notifications off/i);
  });

  it("records a provider failure as 'failed' with a reason", async () => {
    providers({ email: true, fail: true });
    const t = await tenantOf(ctx, { phone: null });
    const r = await send({ tenantId: t.id, arrearsId: (await arrear(ctx, t.id)).id });
    expect(r.body.delivery.status).toBe("failed");
    expect(r.body.status).toBe("failed");
    expect(r.body.recipientInfo.reason).toMatch(/rejected/i);
    expect(r.body.sentAt).toBeNull();
  });

  it("is never sent to another organisation's tenant or arrears record", async () => {
    providers({ email: true });
    const foreign = await tenantOf(other); const foreignArrear = await arrear(other, foreign.id);
    expect((await send({ tenantId: foreign.id, message: "hi" })).status).toBe(404);
    const mine = await tenantOf(ctx);
    expect((await send({ tenantId: mine.id, arrearsId: foreignArrear.id })).status).toBe(404);
    const otherMine = await tenantOf(ctx);
    expect((await send({ tenantId: mine.id, arrearsId: (await arrear(ctx, otherMine.id)).id })).status).toBe(404);   // arrears belongs to a different tenant
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await reminderRows(foreign.id)).toHaveLength(0);
  });

  it("validates the request", async () => {
    const t = await tenantOf(ctx);
    expect((await send({ tenantId: t.id, reminderType: "nag", message: "x" })).status).toBe(400);
    expect((await send({ tenantId: t.id, channel: "pigeon", message: "x" })).status).toBe(400);
    expect((await send({ tenantId: t.id })).status).toBe(400);                                  // nothing to say and no arrears to build it from
    expect((await send({ tenantId: t.id, message: "x", scheduledFor: "not-a-date" })).status).toBe(400);
    expect((await send({ tenantId: "abc", message: "x" })).status).toBe(400);
    expect((await send({ tenantId: t.id, message: "x".repeat(1001) })).status).toBe(400);
  });

  it("a double click does not send twice", async () => {
    providers({ email: true });
    const t = await tenantOf(ctx, { phone: null }); const a = await arrear(ctx, t.id);
    const [r1, r2] = [await send({ tenantId: t.id, arrearsId: a.id }), await send({ tenantId: t.id, arrearsId: a.id })];
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(409); expect(r2.body.code).toBe("RECENT_REMINDER");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("only admins and managers may send; staff, landlords and tenants may not", async () => {
    const t = await tenantOf(ctx);
    for (const tok of [ctx.tenantToken, landlord.token, staff.token]) expect((await send({ tenantId: t.id, message: "x" }, tok)).status).toBe(403);
    providers({ email: true });
    expect((await send({ tenantId: t.id, message: "x" }, managerToken)).status).toBe(201);
  });

  it("the list is scoped to the caller's organisation", async () => {
    const foreign = await tenantOf(other);
    await db.insert(paymentReminders).values({ tenantId: foreign.id, reminderType: "overdue", channel: "email", message: "secret", scheduledFor: new Date(), status: "sent" } as any);
    const r = await authedGet(app, REM, ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.body.some((x: any) => x.tenantId === foreign.id)).toBe(false);
  });
});

describe("payment reminders — queued ones", () => {
  it("a future reminder waits, can be cancelled once, and cannot be cancelled across organisations", async () => {
    providers({ email: true });
    const t = await tenantOf(ctx, { phone: null });
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    const r = await send({ tenantId: t.id, message: "Later", scheduledFor: future });
    expect(r.status).toBe(201); expect(r.body.status).toBe("pending"); expect(r.body.delivery.status).toBe("scheduled");
    expect(sendEmail).not.toHaveBeenCalled();
    await processDueReminders(ctx.orgId);
    expect(sendEmail).not.toHaveBeenCalled();                                            // not due yet

    expect((await authedPatch(app, `${REM}/${r.body.id}/cancel`, other.adminToken)).status).toBe(404);
    const c = await authedPatch(app, `${REM}/${r.body.id}/cancel`, ctx.adminToken);
    expect(c.status).toBe(200); expect(c.body.status).toBe("cancelled");
    expect((await authedPatch(app, `${REM}/${r.body.id}/cancel`, ctx.adminToken)).status).toBe(409);
  });

  it("goes out exactly once when due — even if two workers run at the same moment", async () => {
    providers({ email: true });
    const t = await tenantOf(ctx, { phone: null });
    const [row] = await db.insert(paymentReminders).values({ tenantId: t.id, reminderType: "overdue", channel: "auto", message: "Due now", scheduledFor: new Date(Date.now() - 60_000) } as any).returning();
    await Promise.all([processDueReminders(ctx.orgId), processDueReminders(ctx.orgId), processDueReminders(ctx.orgId)]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [done] = await db.select().from(paymentReminders).where(eq(paymentReminders.id, row.id));
    expect(done.status).toBe("sent"); expect(done.sentAt).toBeTruthy();
    // a sent reminder cannot be cancelled
    expect((await authedPatch(app, `${REM}/${row.id}/cancel`, ctx.adminToken)).status).toBe(409);
  });

  it("automatic reminders only go to active tenants", async () => {
    providers({ email: true });
    const gone = await tenantOf(ctx, { phone: null, status: "inactive" });
    await db.insert(paymentReminders).values({ tenantId: gone.id, reminderType: "overdue", channel: "auto", message: "x", scheduledFor: new Date(Date.now() - 1000) } as any);
    await processDueReminders(ctx.orgId);
    const [row] = await reminderRows(gone.id);
    expect(row.status).toBe("skipped"); expect((row.recipientInfo as any).reason).toMatch(/inactive/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("POST /schedule queues and delivers for active arrears, once a week per arrear, with honest counts", async () => {
    providers({ email: true });
    // isolate: only this organisation's arrears are looked at
    const t1 = await tenantOf(ctx, { phone: null }); const t2 = await tenantOf(ctx, { phone: null, email: null }); const t3 = await tenantOf(ctx, { phone: null });
    await prefs(t3.userId!, { paymentReminders: false });
    await arrear(ctx, t1.id, 5); await arrear(ctx, t2.id, 40, 90000); await arrear(ctx, t3.id, 8);
    const r = await authedPost(app, `${REM}/schedule`, ctx.adminToken, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.scheduled).toBeGreaterThanOrEqual(3);
    expect(r.body.sent).toBeGreaterThanOrEqual(1);
    expect(r.body.skipped).toBeGreaterThanOrEqual(2);                                    // no contact detail + opted out
    const [fin] = await reminderRows(t2.id);
    expect(fin.reminderType).toBe("final_notice"); expect(fin.message).toMatch(/FINAL NOTICE/);
    // second run the same week: nothing new
    const again = await authedPost(app, `${REM}/schedule`, ctx.adminToken, {});
    expect(again.body.scheduled).toBe(0);
    // another organisation's run only ever touches its own arrears
    const before = (await reminderRows(t1.id)).length;
    await authedPost(app, `${REM}/schedule`, other.adminToken, {});
    expect((await reminderRows(t1.id)).length).toBe(before);
  });
});

describe("arrears actions are scoped to the organisation", () => {
  it("lists only this organisation's actions and refuses to act on another's arrears", async () => {
    const mine = await arrear(ctx, (await tenantOf(ctx)).id); const theirs = await arrear(other, (await tenantOf(other)).id);
    await db.insert(arrearsActions).values({ arrearsId: theirs.id, actionType: "phone_call", description: "secret call", actionDate: new Date(), performedBy: other.adminUserId } as any);
    const ok = await authedPost(app, "/api/arrears-actions", ctx.adminToken, { arrearsId: mine.id, actionType: "phone_call", description: "called", actionDate: new Date().toISOString(), performedBy: ctx.adminUserId });
    expect([200, 201], JSON.stringify(ok.body)).toContain(ok.status);
    const foreignPost = await authedPost(app, "/api/arrears-actions", ctx.adminToken, { arrearsId: theirs.id, actionType: "phone_call", description: "x", actionDate: new Date().toISOString(), performedBy: ctx.adminUserId });
    expect(foreignPost.status).toBe(404);
    const list = await authedGet(app, "/api/arrears-actions", ctx.adminToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain("secret call");
    expect((await authedGet(app, `/api/arrears-actions?arrearsId=${theirs.id}`, ctx.adminToken)).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("scheduled rent reminders", () => {
  it("overdue: reaches an active tenant on WhatsApp, logs it, and does not repeat the next day's run", async () => {
    providers({ wa: true });
    const t = await tenantOf(ctx, { phone: "0733111222", email: null });
    await invoice(t.id, addDays(-5), "overdue");
    await sendOverdueRentReminders();
    expect(waCallsTo("0733111222")).toHaveLength(1);
    expect((waCallsTo("0733111222")[0][0] as any).content).toMatch(/overdue/i);
    const rows = await reminderRows(t.id);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ reminderType: "overdue", status: "sent" });

    await sendOverdueRentReminders();                                                    // the very next run: inside the 3-day gap
    expect(waCallsTo("0733111222")).toHaveLength(1);
    // once the gap has passed it goes again
    await db.update(paymentReminders).set({ sentAt: new Date(Date.now() - 4 * 86400_000) }).where(eq(paymentReminders.tenantId, t.id));
    await sendOverdueRentReminders();
    expect(waCallsTo("0733111222")).toHaveLength(2);
  });

  it("a reminder a manager just sent by hand counts towards the gap", async () => {
    providers({ wa: true });
    const t = await tenantOf(ctx, { phone: "0733111333", email: null });
    await invoice(t.id, addDays(-9), "overdue");
    await db.insert(paymentReminders).values({ tenantId: t.id, reminderType: "overdue", channel: "whatsapp", message: "manual", scheduledFor: new Date(), sentAt: new Date(), status: "sent" } as any);
    await sendOverdueRentReminders();
    expect(waCallsTo("0733111333")).toHaveLength(0);
  });

  it("overdue: nothing for opted-out, inactive or fully paid tenants, or when WhatsApp is not set up", async () => {
    providers({ wa: true });
    const optedOut = await tenantOf(ctx, { phone: "0733222001", email: null }); await prefs(optedOut.userId!, { paymentReminders: false });
    const gone = await tenantOf(ctx, { phone: "0733222002", email: null, status: "inactive" });
    const waOff = await tenantOf(ctx, { phone: "0733222003", email: null }); await prefs(waOff.userId!, { whatsappNotifications: false });
    for (const t of [optedOut, gone, waOff]) await invoice(t.id, addDays(-6), "overdue");
    await sendOverdueRentReminders();
    for (const p of ["0733222001", "0733222002", "0733222003"]) expect(waCallsTo(p)).toHaveLength(0);
    for (const t of [optedOut, gone, waOff]) expect(await reminderRows(t.id)).toHaveLength(0);   // and nothing is logged as sent

    providers({ wa: false });
    const noProvider = await tenantOf(ctx, { phone: "0733222004", email: null });
    await invoice(noProvider.id, addDays(-6), "overdue");
    await sendOverdueRentReminders();
    expect(sendWa).not.toHaveBeenCalled();
    expect(await reminderRows(noProvider.id)).toHaveLength(0);                           // "could not reach" is not logged as a reminder
  });

  it("pre-due: warns on the tenant's chosen day only, and only once per invoice", async () => {
    providers({ wa: true });
    const t = await tenantOf(ctx, { phone: "0733333001", email: null });
    const due3 = await invoice(t.id, addDays(3), "pending");
    const t2 = await tenantOf(ctx, { phone: "0733333002", email: null }); await prefs(t2.userId!, { rentDueWarningDays: 5 });
    await invoice(t2.id, addDays(3), "pending");                                          // 3 days out but this tenant wants 5
    await sendRentDueWarnings();
    expect(waCallsTo("0733333001")).toHaveLength(1);
    expect((waCallsTo("0733333001")[0][0] as any).content).toMatch(/3 days/);
    expect(waCallsTo("0733333002")).toHaveLength(0);
    await sendRentDueWarnings();                                                          // a restart / second run the same day
    expect(waCallsTo("0733333001")).toHaveLength(1);
    const rows = await reminderRows(t.id);
    expect(rows[0]).toMatchObject({ reminderType: "pre_due", status: "sent" });
    expect((rows[0].recipientInfo as any).invoiceId).toBe(due3.id);
  });
});

describe("notification preferences are honoured", () => {
  it("quiet hours: default window, a custom window, and a window that crosses midnight", () => {
    const at = (h: number, m = 0) => h * 60 + m;
    expect(isQuietHours(null, at(23))).toBe(true);
    expect(isQuietHours(null, at(6, 59))).toBe(true);
    expect(isQuietHours(null, at(7))).toBe(false);
    expect(isQuietHours(null, at(12))).toBe(false);
    expect(isQuietHours({ enabled: true, start: "22:30", end: "06:00" }, at(22, 45))).toBe(true);
    expect(isQuietHours({ enabled: true, start: "22:30", end: "06:00" }, at(6, 30))).toBe(false);   // their window ended earlier than the default
    expect(isQuietHours({ enabled: true, start: "13:00", end: "14:00" }, at(13, 30))).toBe(true);
    expect(isQuietHours({ enabled: true, start: "13:00", end: "14:00" }, at(23))).toBe(false);
    expect(isQuietHours({ enabled: true, start: "nonsense", end: "??" }, at(23))).toBe(true);       // bad values fall back to the default window
  });

  it("maintenance and rent notices follow the tenant's own category switches", async () => {
    providers({ wa: true });
    const noMaint = await tenantOf(ctx, { phone: "0744000001" }); await prefs(noMaint.userId!, { maintenanceUpdates: false });
    const noRent = await tenantOf(ctx, { phone: "0744000002" }); await prefs(noRent.userId!, { paymentReminders: false });
    const hour = (new Date(Date.now() + 3 * 3600_000).getUTCHours());
    const urgent = { type: "maintenance_completed", ticketNumber: "T1" } as const;       // urgent events skip quiet hours, so this works at any time of day
    expect(await notifyTenant(noMaint.id, urgent)).toBe(false);
    expect(await notifyTenant(noRent.id, { type: "rent_overdue", invoiceAmount: 1, currency: "KES", dueDate: today, daysOverdue: 1, balance: 1 })).toBe(false);
    expect(await notifyTenant(noRent.id, urgent)).toBe(true);                             // a different category is unaffected
    expect(sendWa.mock.calls.every(c => (c[0] as any).to === "0744000002")).toBe(true);
    void hour;
  });

  it("the email switch is its own switch, and quiet-hours values are validated", async () => {
    const r = await authedPatch(app, "/api/notifications/preferences", ctx.tenantToken, { emailNotifications: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.emailNotifications).toBe(false);
    expect(r.body.paymentReminders).not.toBe(false);                                      // the old toggle changed paymentReminders by mistake
    expect((await authedPatch(app, "/api/notifications/preferences", ctx.tenantToken, { quietHours: { enabled: true, start: "late", end: "07:00" } })).status).toBe(400);
    expect((await authedPatch(app, "/api/notifications/preferences", ctx.tenantToken, { quietHours: { enabled: true, start: "22:00", end: "06:30" } })).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("broadcasts", () => {
  const body = (o: object = {}) => ({ title: "Water shutdown", content: "No water on Friday 9am-1pm.", audienceType: "all_tenants", broadcastMedium: ["app_notification"], ...o });
  const post = (o: object = {}, token = ctx.adminToken) => authedPost(app, BC, token, body(o));

  it("templates can be listed, created and removed (the list used to return 500)", async () => {
    expect((await authedGet(app, `${BC}/templates`, managerToken)).status).toBe(200);
    const bad = await authedPost(app, `${BC}/templates`, managerToken, { name: "", category: "announcement", medium: ["sms"], content: "x" });
    expect(bad.status).toBe(400);
    const ok = await authedPost(app, `${BC}/templates`, managerToken, { name: "Notice", category: "announcement", medium: ["sms"], content: "Hello" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await authedGet(app, `${BC}/templates`, managerToken)).body.some((t: any) => t.id === ok.body.id)).toBe(true);
    expect((await supertest(app).delete(`${BC}/templates/${ok.body.id}`).set("Authorization", `Bearer ${other.adminToken}`)).status).toBe(404);
    expect((await supertest(app).delete(`${BC}/templates/${ok.body.id}`).set("Authorization", `Bearer ${managerToken}`)).status).toBe(200);
    expect((await authedGet(app, `${BC}/templates`, managerToken)).body.some((t: any) => t.id === ok.body.id)).toBe(false);
  });

  it("managers can send; landlords, staff and tenants cannot", async () => {
    await tenantOf(ctx);
    expect((await post({}, managerToken)).status).toBe(201);
    for (const tok of [landlord.token, staff.token, ctx.tenantToken]) expect((await post({}, tok)).status).toBe(403);
  });

  it("validates the request", async () => {
    expect((await post({ title: "" })).status).toBe(400);
    expect((await post({ content: "x".repeat(2001) })).status).toBe(400);
    expect((await post({ broadcastMedium: [] })).status).toBe(400);
    expect((await post({ broadcastMedium: ["pigeon"] })).status).toBe(400);
    expect((await post({ audienceType: "everyone" })).status).toBe(400);
    expect((await post({ scheduledFor: "soon" })).status).toBe(400);
    expect((await post({ scheduledFor: new Date(Date.now() - 3600_000).toISOString() })).status).toBe(400);
  });

  it("refuses an audience nobody is in, instead of 'sending' to no one", async () => {
    const r = await post({ audienceType: "specific_properties", audienceFilter: { propertyIds: [] } });
    expect(r.status).toBe(400); expect(r.body.code).toBe("NO_RECIPIENTS");
    // another organisation's property id reaches nobody
    const r2 = await post({ audienceType: "specific_properties", audienceFilter: { propertyIds: [other.propertyId] } });
    expect(r2.status).toBe(400); expect(r2.body.code).toBe("NO_RECIPIENTS");
  });

  it("a channel that is not set up is reported — the broadcast does not claim to have been sent", async () => {
    providers();                                                                          // nothing configured
    await tenantOf(ctx);
    const r = await post({ broadcastMedium: ["email", "sms", "whatsapp"] });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("failed"); expect(r.body.sentCount).toBe(0);
    expect(r.body.warnings.join(" ")).toMatch(/email/); expect(r.body.warnings.join(" ")).toMatch(/sms/); expect(r.body.warnings.join(" ")).toMatch(/whatsapp/);
    expect(sendEmail).not.toHaveBeenCalled(); expect(sendWa).not.toHaveBeenCalled();
    const detail = await authedGet(app, `${BC}/${r.body.id}`, ctx.adminToken);
    expect(detail.body.recipients[0].failureReason).toMatch(/not configured/i);
  });

  it("uses the phone number on the tenant record (the user record has none) and normalises it", async () => {
    providers({ wa: true, sms: true });
    const noLogin = await tenantOf(ctx, { phone: "0755123456", email: null });
    const r = await post({ broadcastMedium: ["sms", "whatsapp", "app_notification"] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.sentCount).toBeGreaterThanOrEqual(1);
    expect(sendSms.mock.calls.some(c => (c[0] as any).to === "+254755123456")).toBe(true);
    expect(sendWa.mock.calls.some(c => (c[0] as any).to === "+254755123456")).toBe(true);
    const detail = await authedGet(app, `${BC}/${r.body.id}`, ctx.adminToken);
    const mine = detail.body.recipients.find((x: any) => x.recipientUserId === noLogin.userId);
    expect(mine.deliveryStatus).toMatchObject({ sms: "sent", whatsapp: "sent", app_notification: "sent", overall: "sent" });
  });

  it("escapes the message in email HTML, and skips recipients who switched email off", async () => {
    providers({ email: true });
    const quiet = await tenantOf(ctx, { phone: null }); await prefs(quiet.userId!, { emailNotifications: false });
    const loud = await tenantOf(ctx, { phone: null });
    const r = await post({ title: "<b>Hi</b>", content: "<script>alert(1)</script>", broadcastMedium: ["email"], audienceType: "custom_filter", audienceFilter: { tenantIds: [quiet.id, loud.id] } });
    expect(r.body.sentCount).toBe(1); expect(r.body.skippedCount).toBe(1);
    const call = sendEmail.mock.calls[0][0] as any;
    expect(call.to).toBe(loud.email);
    expect(call.html).not.toContain("<script>"); expect(call.html).toContain("&lt;script&gt;");
    expect(call.html).not.toContain("<b>Hi</b>");
  });

  it("never includes inactive users, tenants of other organisations, or tenants who moved out", async () => {
    providers({ email: true });
    const inactive = await makeUser(ctx.orgId, "landlord", { isActive: false });
    const activeLandlord = landlord;
    const gone = await tenantOf(ctx, { status: "inactive", phone: null });
    await tenantOf(other, { phone: null });
    const r = await post({ audienceType: "all_landlords", broadcastMedium: ["email"] });
    const detail = await authedGet(app, `${BC}/${r.body.id}`, ctx.adminToken);
    const ids = detail.body.recipients.map((x: any) => x.recipientUserId);
    expect(ids).toContain(activeLandlord.id); expect(ids).not.toContain(inactive.id);
    const t = await post({ audienceType: "all_tenants", broadcastMedium: ["email"] });
    const tids = (await authedGet(app, `${BC}/${t.body.id}`, ctx.adminToken)).body.recipients.map((x: any) => x.email);
    expect(tids).not.toContain(gone.email);
  });

  it("a scheduled broadcast is really sent when its time comes — once — and can be cancelled before", async () => {
    providers({ email: true });
    const t = await tenantOf(ctx, { phone: null });
    const when = new Date(Date.now() + 2 * 3600_000).toISOString();
    const s = await post({ broadcastMedium: ["email"], audienceType: "custom_filter", audienceFilter: { tenantIds: [t.id] }, scheduledFor: when });
    expect(s.status).toBe(201); expect(s.body.status).toBe("scheduled");
    await dispatchDueBroadcasts();
    expect(sendEmail).not.toHaveBeenCalled();                                              // not time yet

    await db.update(broadcastMessages).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(broadcastMessages.id, s.body.id));
    await Promise.all([dispatchDueBroadcasts(), dispatchDueBroadcasts()]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [done] = await db.select().from(broadcastMessages).where(eq(broadcastMessages.id, s.body.id));
    expect(done).toMatchObject({ status: "sent", sentCount: 1, totalRecipients: 1 });
    expect((await authedPatch(app, `${BC}/${s.body.id}/cancel`, ctx.adminToken)).status).toBe(409);   // already sent

    const c = await post({ broadcastMedium: ["email"], audienceType: "custom_filter", audienceFilter: { tenantIds: [t.id] }, scheduledFor: when });
    expect((await authedPatch(app, `${BC}/${c.body.id}/cancel`, other.adminToken)).status).toBe(404);
    expect((await authedPatch(app, `${BC}/${c.body.id}/cancel`, managerToken)).body.status).toBe("cancelled");
    await db.update(broadcastMessages).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(broadcastMessages.id, c.body.id));
    sendEmail.mockClear();
    await dispatchDueBroadcasts();
    expect(sendEmail).not.toHaveBeenCalled();                                              // cancelled ones stay cancelled
  });

  it("is scoped to the organisation", async () => {
    const r = await post({});
    expect((await authedGet(app, `${BC}/${r.body.id}`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, BC, other.adminToken)).body.some((b: any) => b.id === r.body.id)).toBe(false);
    expect((await authedGet(app, `${BC}/abc`, ctx.adminToken)).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("messages", () => {
  const post = (body: object, token: string) => authedPost(app, "/api/messages", token, body);
  let otherTenantUser: string;
  beforeAll(async () => { otherTenantUser = (await tenantOf(ctx)).userId!; });

  it("a tenant can message the management team but not other tenants, landlords or platform admins", async () => {
    expect((await post({ toUserId: managerId, content: "My tap is leaking" }, ctx.tenantToken)).status).toBe(201);
    expect((await post({ content: "Hello admin" }, ctx.tenantToken)).status).toBe(201);                       // no recipient → org admin
    expect((await post({ toUserId: otherTenantUser, content: "hi neighbour" }, ctx.tenantToken)).status).toBe(403);
    expect((await post({ toUserId: landlord.id, content: "hi" }, ctx.tenantToken)).status).toBe(403);
    expect((await post({ toUserId: staff.id, content: "hi" }, ctx.tenantToken)).status).toBe(201);
    // a manager can write to a tenant
    expect((await post({ toUserId: ctx.tenantUserId, content: "We will visit tomorrow" }, managerToken)).status).toBe(201);
  });

  it("refuses bad input", async () => {
    expect((await post({ toUserId: managerId, content: "   " }, ctx.tenantToken)).status).toBe(400);
    expect((await post({ toUserId: managerId, content: "x".repeat(5001) }, ctx.tenantToken)).status).toBe(400);
    expect((await post({ toUserId: "not-a-uuid", content: "x" }, ctx.tenantToken)).status).toBe(400);
    expect((await post({ toUserId: ctx.tenantUserId, content: "x" }, ctx.tenantToken)).status).toBe(400);   // yourself
    expect((await post({ toUserId: other.adminUserId, content: "x" }, ctx.tenantToken)).status).toBe(400);   // another organisation
  });

  it("a client cannot set fields it should not control", async () => {
    const r = await post({ toUserId: managerId, content: "hello", isRead: true, messageType: "broadcast", fromUserId: managerId, scheduledAt: "2030-01-01", isScheduled: true }, ctx.tenantToken);
    expect(r.status).toBe(201);
    const [m] = await db.select().from(messages).where(eq(messages.id, r.body.id));
    expect(m).toMatchObject({ fromUserId: ctx.tenantUserId, isRead: false, messageType: "direct", isScheduled: false });
  });

  it("mass messaging is for admins and managers — a tenant cannot message the whole organisation", async () => {
    for (const tok of [ctx.tenantToken, landlord.token, staff.token]) {
      expect((await authedPost(app, "/api/messages/bulk", tok, { toUserIds: [managerId], content: "spam" })).status).toBe(403);
    }
    const ok = await authedPost(app, "/api/messages/bulk", managerToken, { toUserIds: [ctx.tenantUserId, ctx.tenantUserId, otherTenantUser], content: "Rent is due Friday", subject: "Reminder" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.sent).toBe(2);                                                           // duplicates collapsed
    expect((await authedPost(app, "/api/messages/bulk", managerToken, { toUserIds: ["bad"], content: "x" })).status).toBe(400);
    expect((await authedPost(app, "/api/messages/bulk", managerToken, { toUserIds: [other.adminUserId], content: "x" })).status).toBe(400);
    expect((await authedPost(app, "/api/messages/bulk", managerToken, { toUserIds: [ctx.tenantUserId], content: "" })).status).toBe(400);
  });

  it("the contact list a tenant sees is the management team only", async () => {
    const r = await authedGet(app, "/api/messages/contacts", ctx.tenantToken);
    expect(r.status).toBe(200);
    const roles = new Set(r.body.map((c: any) => c.role));
    for (const role of roles) expect(["admin", "manager", "staff"]).toContain(role);
    expect(r.body.every((c: any) => c.email === null)).toBe(true);
    const m = await authedGet(app, "/api/messages/contacts", managerToken);
    expect(m.body.some((c: any) => c.role === "tenant")).toBe(true);
    expect(m.body.some((c: any) => c.role === "platform_admin")).toBe(false);
  });

  it("inbox shows names, and only the caller's messages", async () => {
    const r = await authedGet(app, "/api/messages?box=inbox", managerToken);
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(r.body.results.every((m: any) => m.toUserId === managerId)).toBe(true);
    expect(r.body.results[0].fromName).not.toBe("Unknown");
  });
});
