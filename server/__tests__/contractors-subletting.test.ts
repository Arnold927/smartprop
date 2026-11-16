/**
 * contractors-subletting.test.ts — contractors, service contracts, the contractor portal, and short-stay (sub-letting) bookings
 *
 * registry     a contractor list only shows this organisation's contractors; verify is manager-only and org-scoped
 * categories   managers add, duplicates refused, only the platform admin edits
 * contractors  create/update strip earned fields (verified, rating, jobs), emails are unique per organisation,
 *              delete is refused when there is work history
 * contracts    scoped to the organisation, validated, status machine, only drafts deleted, landlord sees only theirs
 * portal       accept/reject/complete/invoice rules; messages only go to the management team
 * listings     a tenant can't set their own commission, move the unit, or approve; one live listing per unit
 * bookings     totals come from the listing; only a manager records "paid"; dates, nights and guests are checked;
 *              state machine; cancel owes a refund once (and never after check-in); mark-paid; mark-refunded once
 * payments     the M-Pesa outcome (confirmed / duplicate / late / short); expired and in-flight payments refused;
 *              guest lookup/cancel are case-insensitive on email and stop once the stay has started
 * feeds        calendar links that point inside the network are refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, authedPut, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import {
  users, properties, units, tenants, contractors, contractorCategories, serviceContracts, workOrders, propertyExpenses,
  messages, auditLogs, tenantShortRentals, tenantShortBookings, mpesaTransactions, externalCalendarFeeds, listingBlockedDates,
} from "@shared/schema";
import { eq, inArray, and, like, sql } from "drizzle-orm";
import { applyStayPayment, assertPublicFeedUrl, stayFinancials, nightsBetween } from "../services/stay-bookings";

let app: any;
let ctx: TestContext;      // organisation A
let ctx2: TestContext;     // organisation B
let managerToken: string;
let staffToken: string;
let landlord: { id: string; token: string };
let landlordProp: number;
let landlordUnit: number;
let otherProp: number;
let contractorUser: { id: string; token: string; email: string };
let contractorA: number;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`.toUpperCase();
const createdCategoryIds: number[] = [];

const del = (path: string, token: string) => supertest(app).delete(path).set("Authorization", `Bearer ${token}`);
const get = (path: string, token: string) => authedGet(app, path, token);

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number, role: string, email?: string) {
  const em = email ?? `cs-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email: em, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Cs", lastName: role, role, organizationId: orgId, emailVerified: true } as any);
  return { id, email: em, token: await login(em) };
}

/** A date `n` days from today at 00:00 UTC, as an ISO string. */
const day = (n: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString(); };

let dayCursor = 40;       // each test takes its own stretch of calendar so bookings never collide
const stretch = (nights: number) => { const a = dayCursor; dayCursor += nights + 2; return { checkInDate: day(a), checkOutDate: day(a + nights) }; };

async function makeUnit(propertyId = ctx.propertyId) {
  const [u] = await db.insert(units).values({ organizationId: ctx.orgId, propertyId, unitNumber: `U${uniq()}`, monthlyRent: "40000", currency: "KES", isOccupied: false } as any).returning({ id: units.id });
  return u.id;
}

/** An approved, active listing created straight in the database (a fresh unit each time). */
async function makeListing(over: Record<string, any> = {}) {
  const unitId = over.unitId ?? (await makeUnit());
  const [l] = await db.insert(tenantShortRentals).values({
    organizationId: ctx.orgId, unitId, ownerId: landlord.id, listingTitle: `Stay ${uniq()}`, slug: `stay-${uniq().toLowerCase()}`,
    nightlyRate: "5000", currency: "KES", minimumNights: 1, maximumNights: 14, maxGuests: 4,
    propertyManagerCommission: "10.00", platformFees: "5.00", tenantEarningsShare: "85.00",
    approvalStatus: "approved", isActive: true, isPubliclyListed: true, ...over,
  } as any).returning();
  return l;
}

const guest = (o: Record<string, any> = {}) => ({ guestName: "Wanjiru Guest", guestEmail: `Guest.${uniq()}@Example.com`, guestPhone: "0712345678", guestCount: 2, ...o });

async function bookAs(token: string, listingId: number, o: Record<string, any> = {}, nights = 3) {
  return authedPost(app, "/api/short-term-bookings", token, { rentalListingId: listingId, ...stretch(nights), ...guest(), ...o });
}
async function bookDirect(listingId: number, o: Record<string, any> = {}) {
  const { checkInDate, checkOutDate } = stretch(3);
  const [b] = await db.insert(tenantShortBookings).values({
    organizationId: ctx.orgId, rentalListingId: listingId, bookingReference: `BK-T-${uniq()}`, ...guest(),
    checkInDate: new Date(checkInDate), checkOutDate: new Date(checkOutDate), numberOfNights: 3, nightlyRate: "5000",
    totalAmount: "15000.00", platformFees: "750.00", propertyManagerCommission: "1500.00", tenantPayout: "12750.00",
    currency: "KES", bookingStatus: "pending", paymentStatus: "pending", ...o,
  } as any).returning();
  return b;
}
const bookingRow = async (id: number) => (await db.select().from(tenantShortBookings).where(eq(tenantShortBookings.id, id)))[0];

async function makeWorkOrder(status: string, over: Record<string, any> = {}) {
  const [wo] = await db.insert(workOrders).values({
    ticketNumber: `WO-T-${uniq()}`, workOrderType: "maintenance", title: "Fix tap", description: "Leaking", priority: "medium", status,
    contractorId: contractorA, createdBy: ctx.adminUserId, currency: "KES", ...over,
  } as any).returning();
  return wo;
}

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  ctx2 = await setupTestData();
  managerToken = (await makeUser(ctx.orgId, "manager")).token;
  staffToken = (await makeUser(ctx.orgId, "staff")).token;
  landlord = await makeUser(ctx.orgId, "landlord");
  const [lp] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Landlord Plot", address: "L Road", totalUnits: 0, ownerId: landlord.id } as any).returning({ id: properties.id });
  landlordProp = lp.id;
  landlordUnit = await makeUnit(landlordProp);
  const [op] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Other Plot", address: "O Road", totalUnits: 0 } as any).returning({ id: properties.id });
  otherProp = op.id;

  const cEmail = `portal-${uniq().toLowerCase()}@smartprop-test.local`;
  // The contractor record has capital letters, the login is lower case: the portal must still match them.
  const [c] = await db.insert(contractors).values({ organizationId: ctx.orgId, companyName: "Portal Plumbers", name: "Pat Plumber", email: cEmail.toUpperCase().replace("@SMARTPROP-TEST.LOCAL", "@smartprop-test.local"), phone: "0700111222", specialty: "plumber" } as any).returning({ id: contractors.id });
  contractorA = c.id;
  contractorUser = await makeUser(ctx.orgId, "contractor", cEmail);
});

afterAll(async () => {
  const orgIds = [ctx.orgId, ctx2.orgId];
  const lists = (await db.select({ id: tenantShortRentals.id }).from(tenantShortRentals).where(inArray(tenantShortRentals.organizationId, orgIds))).map((l) => l.id);
  const books = lists.length ? (await db.select({ id: tenantShortBookings.id }).from(tenantShortBookings).where(inArray(tenantShortBookings.rentalListingId, lists))).map((b) => b.id) : [];
  if (books.length) await db.delete(mpesaTransactions).where(inArray(mpesaTransactions.shortTermBookingId, books)).catch(() => {});
  if (lists.length) {
    await db.delete(tenantShortBookings).where(inArray(tenantShortBookings.rentalListingId, lists)).catch(() => {});
    await db.delete(listingBlockedDates).where(inArray(listingBlockedDates.rentalListingId, lists)).catch(() => {});
    await db.delete(externalCalendarFeeds).where(inArray(externalCalendarFeeds.rentalListingId, lists)).catch(() => {});
    await db.delete(tenantShortRentals).where(inArray(tenantShortRentals.id, lists)).catch(() => {});
  }
  const cons = (await db.select({ id: contractors.id }).from(contractors).where(inArray(contractors.organizationId, orgIds))).map((c) => c.id);
  if (cons.length) {
    await db.delete(propertyExpenses).where(inArray(propertyExpenses.contractorId, cons)).catch(() => {});
    await db.delete(serviceContracts).where(inArray(serviceContracts.contractorId, cons)).catch(() => {});
    await db.delete(workOrders).where(inArray(workOrders.contractorId, cons)).catch(() => {});
  }
  await db.delete(serviceContracts).where(like(serviceContracts.contractTitle, "CS-TEST%")).catch(() => {});
  await db.delete(messages).where(inArray(messages.organizationId, orgIds)).catch(() => {});
  if (cons.length) await db.delete(contractors).where(inArray(contractors.id, cons)).catch(() => {});
  if (createdCategoryIds.length) await db.delete(contractorCategories).where(inArray(contractorCategories.id, createdCategoryIds)).catch(() => {});
  await db.delete(units).where(and(inArray(units.organizationId, orgIds), eq(units.isOccupied, false), sql`${units.id} not in (${ctx.unitId}, ${ctx2.unitId})`)).catch(() => {});
  await db.delete(properties).where(inArray(properties.id, [landlordProp, otherProp])).catch(() => {});
  const orgUsers = (await db.select({ id: users.id }).from(users).where(inArray(users.organizationId, orgIds))).map((u) => u.id);
  if (orgUsers.length) await db.delete(auditLogs).where(inArray(auditLogs.userId, orgUsers)).catch(() => {});
  await db.delete(users).where(and(inArray(users.organizationId, orgIds), inArray(users.role as any, ["manager", "staff", "landlord", "contractor"]))).catch(() => {});
  await cleanupTestData(ctx2).catch(() => {});
  await cleanupTestData(ctx).catch(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════
describe("contractor registry, verify and categories", () => {
  it("lists only this organisation's contractors", async () => {
    const [other] = await db.insert(contractors).values({ organizationId: ctx2.orgId, companyName: "Other Org Co", name: "Olu", email: `olu-${uniq()}@x.test`, phone: "0700", specialty: "electrician" } as any).returning({ id: contractors.id });
    const r = await get("/api/contractors/registry", managerToken);
    expect(r.status).toBe(200);
    const ids = r.body.map((c: any) => c.id);
    expect(ids).toContain(contractorA);
    expect(ids).not.toContain(other.id);
  });

  it("verify is for admin/manager in the same organisation only", async () => {
    const [mine] = await db.insert(contractors).values({ organizationId: ctx.orgId, companyName: "V Co", name: "V", phone: "0700", specialty: "painter" } as any).returning({ id: contractors.id });
    const [theirs] = await db.insert(contractors).values({ organizationId: ctx2.orgId, companyName: "V2 Co", name: "V2", phone: "0700", specialty: "painter" } as any).returning({ id: contractors.id });
    expect((await authedPost(app, `/api/contractors/${mine.id}/verify`, staffToken)).status).toBe(403);
    expect((await authedPost(app, `/api/contractors/${theirs.id}/verify`, managerToken)).status).toBe(404);
    expect((await authedPost(app, `/api/contractors/${theirs.id}/verify`, ctx.tenantToken)).status).toBe(403);
    const ok = await authedPost(app, `/api/contractors/${mine.id}/verify`, managerToken);
    expect(ok.status).toBe(200);
    expect(ok.body.isVerified).toBe(true);
    expect((await db.select().from(contractors).where(eq(contractors.id, theirs.id)))[0].isVerified).toBe(false);
  });

  it("a manager can add a category, a duplicate name is refused, and only the platform admin can edit", async () => {
    const name = `Cat ${uniq()}`;
    const a = await authedPost(app, "/api/contractor-categories", managerToken, { name });
    expect(a.status).toBe(201);
    createdCategoryIds.push(a.body.id);
    expect((await authedPost(app, "/api/contractor-categories", managerToken, { name: name.toLowerCase() })).status).toBe(409);
    expect((await authedPost(app, "/api/contractor-categories", staffToken, { name: `Staff ${uniq()}` })).status).toBe(403);
    expect((await authedPut(app, `/api/contractor-categories/${a.body.id}`, managerToken, { name: "Renamed" })).status).toBe(403);
    expect((await authedPut(app, `/api/contractor-categories/${a.body.id}`, ctx.adminToken, { name: "Renamed" })).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("contractor records (create / update / delete guard)", () => {
  const body = (o: Record<string, any> = {}) => ({ companyName: "Guard Co", name: "Gary", phone: "0722000111", specialty: "electrician", ...o });

  it("earned fields are not taken from the form, and the organisation can't be chosen", async () => {
    const r = await authedPost(app, "/api/contractors", managerToken, body({ email: `Gary.${uniq()}@Test.com`, rating: "5", completedJobs: 99, organizationId: ctx2.orgId, isVerified: false }));
    expect(r.status).toBeLessThan(300);
    const row = (await db.select().from(contractors).where(eq(contractors.id, r.body.id)))[0];
    expect(row.organizationId).toBe(ctx.orgId);
    expect(Number(row.rating)).toBe(0);
    expect(row.completedJobs).toBe(0);
    expect(row.email).toBe(row.email!.toLowerCase());

    const u = await authedPut(app, `/api/contractors/${r.body.id}`, managerToken, { isVerified: true, rating: "5", completedJobs: 50, organizationId: ctx2.orgId, notes: "ok" });
    expect(u.status).toBe(200);
    const after = (await db.select().from(contractors).where(eq(contractors.id, r.body.id)))[0];
    expect(after.isVerified).toBe(false);
    expect(Number(after.rating)).toBe(0);
    expect(after.completedJobs).toBe(0);
    expect(after.organizationId).toBe(ctx.orgId);
    expect(after.notes).toBe("ok");
  });

  it("only a manager can register a contractor as already verified", async () => {
    const m = await authedPost(app, "/api/contractors", managerToken, body({ isVerified: true }));
    expect((await db.select().from(contractors).where(eq(contractors.id, m.body.id)))[0].isVerified).toBe(true);
    const s = await authedPost(app, "/api/contractors", staffToken, body({ isVerified: true }));
    if (s.status < 300) expect((await db.select().from(contractors).where(eq(contractors.id, s.body.id)))[0].isVerified).toBe(false);
  });

  it("an email can only be used once in an organisation (any capitalisation)", async () => {
    const email = `dup-${uniq().toLowerCase()}@test.com`;
    expect((await authedPost(app, "/api/contractors", managerToken, body({ email }))).status).toBeLessThan(300);
    const again = await authedPost(app, "/api/contractors", managerToken, body({ email: email.toUpperCase() }));
    expect(again.status).toBe(409);
    const other = await authedPost(app, "/api/contractors", managerToken, body());
    const clash = await authedPut(app, `/api/contractors/${other.body.id}`, managerToken, { email });
    expect(clash.status).toBe(409);
  });

  it("required fields and the email shape are checked", async () => {
    expect((await authedPost(app, "/api/contractors", managerToken, body({ name: "  " }))).status).toBe(400);
    expect((await authedPost(app, "/api/contractors", managerToken, body({ phone: "" }))).status).toBe(400);
    expect((await authedPost(app, "/api/contractors", managerToken, body({ email: "not-an-email" }))).status).toBe(400);
    expect((await authedPost(app, "/api/contractors", managerToken, body({ rate: "-5" }))).status).toBe(400);
  });

  it("a contractor in another organisation can't be edited or deleted", async () => {
    const [theirs] = await db.insert(contractors).values({ organizationId: ctx2.orgId, companyName: "T Co", name: "T", phone: "0700", specialty: "mason" } as any).returning({ id: contractors.id });
    expect((await authedPut(app, `/api/contractors/${theirs.id}`, managerToken, { notes: "x" })).status).toBe(404);
    expect((await del(`/api/contractors/${theirs.id}`, managerToken)).status).toBe(404);
  });

  it("delete is for managers, works when there's no history, and is refused with history", async () => {
    const fresh = await authedPost(app, "/api/contractors", managerToken, body());
    expect((await del(`/api/contractors/${fresh.body.id}`, staffToken)).status).toBe(403);
    expect((await del(`/api/contractors/${fresh.body.id}`, managerToken)).status).toBeLessThan(300);

    await makeWorkOrder("completed");
    const r = await del(`/api/contractors/${contractorA}`, managerToken);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CONTRACTOR_HAS_HISTORY");
    expect((await db.select().from(contractors).where(eq(contractors.id, contractorA))).length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("service contracts", () => {
  const contract = (o: Record<string, any> = {}) => ({
    contractorId: contractorA, propertyId: ctx.propertyId, contractType: "recurring", serviceType: "cleaning",
    contractTitle: `CS-TEST ${uniq()}`, startDate: day(1), endDate: day(200), contractValue: "120000", ...o,
  });

  it("only the management team creates one, as a draft, with a server-made number", async () => {
    expect((await authedPost(app, "/api/service-contracts", landlord.token, contract())).status).toBe(403);
    expect((await authedPost(app, "/api/service-contracts", ctx.tenantToken, contract())).status).toBe(403);
    const r = await authedPost(app, "/api/service-contracts", managerToken, contract({ signedBy: randomUUID(), signedDate: day(0) }));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    expect(r.body.contractNumber).toMatch(/^SC-/);
    expect(r.body.signedBy).toBeNull();
  });

  it("needs a contractor and property from this organisation, and sensible values", async () => {
    const [theirs] = await db.insert(contractors).values({ organizationId: ctx2.orgId, companyName: "X Co", name: "X", phone: "0700", specialty: "mason" } as any).returning({ id: contractors.id });
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractorId: theirs.id }))).status).toBe(400);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractorId: undefined }))).status).toBe(400);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ propertyId: ctx2.propertyId }))).status).toBe(400);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractType: "weird" }))).status).toBe(400);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractValue: "-1" }))).status).toBe(400);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ startDate: day(10), endDate: day(2) }))).status).toBe(400);
    const dupNo = `SC-DUP-${uniq()}`;
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractNumber: dupNo }))).status).toBe(201);
    expect((await authedPost(app, "/api/service-contracts", managerToken, contract({ contractNumber: dupNo }))).status).toBe(409);
  });

  it("another organisation can't see, change or delete it", async () => {
    const made = await authedPost(app, "/api/service-contracts", managerToken, contract());
    const list = await get("/api/service-contracts", ctx2.adminToken);
    expect(list.body.map((c: any) => c.id)).not.toContain(made.body.id);
    expect((await authedPut(app, `/api/service-contracts/${made.body.id}`, ctx2.adminToken, { description: "hack" })).status).toBe(404);
    expect((await del(`/api/service-contracts/${made.body.id}`, ctx2.adminToken)).status).toBe(404);
  });

  it("a landlord sees only contracts on their own properties", async () => {
    const mine = await authedPost(app, "/api/service-contracts", managerToken, contract({ propertyId: landlordProp }));
    const notMine = await authedPost(app, "/api/service-contracts", managerToken, contract({ propertyId: otherProp }));
    const ids = (await get("/api/service-contracts", landlord.token)).body.map((c: any) => c.id);
    expect(ids).toContain(mine.body.id);
    expect(ids).not.toContain(notMine.body.id);
  });

  it("status moves follow draft → active → completed/terminated, finished contracts are locked, and only drafts are deleted", async () => {
    const made = await authedPost(app, "/api/service-contracts", managerToken, contract());
    const id = made.body.id;
    expect((await authedPut(app, `/api/service-contracts/${id}`, managerToken, { status: "completed" })).status).toBe(409);
    expect((await authedPut(app, `/api/service-contracts/${id}`, managerToken, { status: "active" })).status).toBe(200);
    const blockDelete = await del(`/api/service-contracts/${id}`, managerToken);
    expect(blockDelete.status).toBe(409);
    expect((await authedPut(app, `/api/service-contracts/${id}`, managerToken, { status: "draft" })).status).toBe(409);
    expect((await authedPut(app, `/api/service-contracts/${id}`, managerToken, { status: "terminated" })).status).toBe(200);
    expect((await authedPut(app, `/api/service-contracts/${id}`, managerToken, { description: "late edit" })).status).toBe(409);

    const draft = await authedPost(app, "/api/service-contracts", managerToken, contract());
    expect((await del(`/api/service-contracts/${draft.body.id}`, staffToken)).status).toBe(403);
    expect((await del(`/api/service-contracts/${draft.body.id}`, managerToken)).status).toBe(204);
  });

  it("the number and signature can't be edited", async () => {
    const made = await authedPost(app, "/api/service-contracts", managerToken, contract());
    const r = await authedPut(app, `/api/service-contracts/${made.body.id}`, managerToken, { contractNumber: "SC-HACK", signedBy: randomUUID(), description: "fine" });
    expect(r.status).toBe(200);
    expect(r.body.contractNumber).toBe(made.body.contractNumber);
    expect(r.body.signedBy).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("contractor portal", () => {
  const patch = (path: string, token: string, body: object = {}) => supertest(app).patch(path).set("Authorization", `Bearer ${token}`).send(body);

  it("finds the contractor by email whatever the capitalisation", async () => {
    const r = await get("/api/contractor-portal/me", contractorUser.token);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(contractorA);
  });

  it("a job waiting for manager approval can't be started, an approved one can, and it only starts once", async () => {
    const waiting = await makeWorkOrder("pending_approval");
    const w = await patch(`/api/contractor-portal/work-orders/${waiting.id}/accept`, contractorUser.token);
    expect(w.status).toBe(409);
    const ready = await makeWorkOrder("assigned");
    const [a, b] = await Promise.all([
      patch(`/api/contractor-portal/work-orders/${ready.id}/accept`, contractorUser.token),
      patch(`/api/contractor-portal/work-orders/${ready.id}/accept`, contractorUser.token),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it("rejecting needs a reason and works once", async () => {
    const wo = await makeWorkOrder("assigned");
    expect((await patch(`/api/contractor-portal/work-orders/${wo.id}/reject`, contractorUser.token, { reason: "  " })).status).toBe(400);
    const ok = await patch(`/api/contractor-portal/work-orders/${wo.id}/reject`, contractorUser.token, { reason: "Too far away" });
    expect(ok.status).toBe(200);
    expect((await patch(`/api/contractor-portal/work-orders/${wo.id}/reject`, contractorUser.token, { reason: "again" })).status).toBe(404);
  });

  it("completing counts the job once even when pressed twice at the same time, and checks the cost", async () => {
    const before = (await db.select().from(contractors).where(eq(contractors.id, contractorA)))[0].completedJobs ?? 0;
    const wo = await makeWorkOrder("in_progress");
    expect((await patch(`/api/contractor-portal/work-orders/${wo.id}/complete`, contractorUser.token, { completionNotes: "" })).status).toBe(400);
    expect((await patch(`/api/contractor-portal/work-orders/${wo.id}/complete`, contractorUser.token, { completionNotes: "done", actualCost: "-10" })).status).toBe(400);
    expect((await patch(`/api/contractor-portal/work-orders/${wo.id}/complete`, contractorUser.token, { completionNotes: "done", actualCost: "abc" })).status).toBe(400);
    const [a, b] = await Promise.all([
      patch(`/api/contractor-portal/work-orders/${wo.id}/complete`, contractorUser.token, { completionNotes: "done", actualCost: "1500" }),
      patch(`/api/contractor-portal/work-orders/${wo.id}/complete`, contractorUser.token, { completionNotes: "done", actualCost: "1500" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const after = (await db.select().from(contractors).where(eq(contractors.id, contractorA)))[0].completedJobs ?? 0;
    expect(after).toBe(before + 1);
  });

  it("an invoice is accepted only for a completed job, only once, with a valid amount", async () => {
    const open = await makeWorkOrder("in_progress");
    const early = await authedPost(app, `/api/contractor-portal/work-orders/${open.id}/invoice`, contractorUser.token, { invoiceAmount: 2000 });
    expect(early.status).toBe(409);

    const done = await makeWorkOrder("completed", { actualCost: "1500", completionNotes: "all fixed" });
    expect((await authedPost(app, `/api/contractor-portal/work-orders/${done.id}/invoice`, contractorUser.token, { invoiceAmount: 0 })).status).toBe(400);
    expect((await authedPost(app, `/api/contractor-portal/work-orders/${done.id}/invoice`, contractorUser.token, { invoiceAmount: "lots" })).status).toBe(400);
    const ok = await authedPost(app, `/api/contractor-portal/work-orders/${done.id}/invoice`, contractorUser.token, { invoiceAmount: 1800, invoiceRef: "INV-1" });
    expect(ok.status).toBe(200);
    expect(Number((await db.select().from(workOrders).where(eq(workOrders.id, done.id)))[0].actualCost)).toBe(1800);
    const again = await authedPost(app, `/api/contractor-portal/work-orders/${done.id}/invoice`, contractorUser.token, { invoiceAmount: 9999 });
    expect(again.status).toBe(409);
    expect(Number((await db.select().from(workOrders).where(eq(workOrders.id, done.id)))[0].actualCost)).toBe(1800);
  });

  it("the invoice brings the already-posted expense into line", async () => {
    const done = await makeWorkOrder("completed", { actualCost: "1000", completionNotes: "ok" });
    await db.insert(propertyExpenses).values({
      expenseNumber: `EXP-T-${uniq()}`, propertyId: ctx.propertyId, contractorId: contractorA, vendorName: "Portal Plumbers", description: "x",
      amount: "1000", currency: "KES", category: "maintenance", expenseDate: new Date(), isRecurring: false,
      notes: `Auto-posted from contractor portal completion. WO ID: ${done.id}`, createdBy: ctx.adminUserId,
    } as any);
    const r = await authedPost(app, `/api/contractor-portal/work-orders/${done.id}/invoice`, contractorUser.token, { invoiceAmount: 1250 });
    expect(r.status).toBe(200);
    const exp = (await db.select().from(propertyExpenses).where(like(propertyExpenses.notes, `%WO ID: ${done.id}`)))[0];
    expect(Number(exp.amount)).toBe(1250);
  });

  it("another contractor's job isn't visible", async () => {
    const [c2] = await db.insert(contractors).values({ organizationId: ctx.orgId, companyName: "Rival", name: "R", email: `rival-${uniq()}@x.test`, phone: "0700", specialty: "plumber" } as any).returning({ id: contractors.id });
    const rival = await makeWorkOrder("assigned", { contractorId: c2.id });
    expect((await patch(`/api/contractor-portal/work-orders/${rival.id}/accept`, contractorUser.token)).status).toBe(404);
  });

  it("messages go only to the management team of the contractor's own organisation", async () => {
    const admin = await post("/api/contractor-portal/messages", contractorUser.token, { content: "Hello", subject: "Hi" });
    expect(admin.status).toBe(201);
    const toTenant = await post("/api/contractor-portal/messages", contractorUser.token, { content: "Hello", toUserId: ctx.tenantUserId });
    expect(toTenant.status).toBe(403);
    const toOtherOrg = await post("/api/contractor-portal/messages", contractorUser.token, { content: "Hello", toUserId: ctx2.adminUserId });
    expect(toOtherOrg.status).toBe(403);
    const toAdmin = await post("/api/contractor-portal/messages", contractorUser.token, { content: "Hello", toUserId: ctx.adminUserId });
    expect(toAdmin.status).toBe(201);
    expect((await post("/api/contractor-portal/messages", contractorUser.token, { content: "x".repeat(5001) })).status).toBe(400);
    expect((await post("/api/contractor-portal/messages", contractorUser.token, { content: "  " })).status).toBe(400);
  });
});
const post = (path: string, token: string, body: object = {}) => authedPost(app, path, token, body);

// ═════════════════════════════════════════════════════════════════════════════
describe("short-stay listings", () => {
  it("a tenant sublets their own unit, but can't set their own commission or approve it", async () => {
    const r = await post("/api/tenant-short-rentals", ctx.tenantToken, {
      listingTitle: "My room", nightlyRate: 4000, maxGuests: 2,
      propertyManagerCommission: 0, tenantEarningsShare: 100, platformFees: 0,
      approvalStatus: "approved", isPubliclyListed: true, landlordConsentConfirmed: true, icalExportToken: "hacked",
    });
    expect(r.status).toBe(201);
    const row = (await db.select().from(tenantShortRentals).where(eq(tenantShortRentals.id, r.body.id)))[0];
    expect(row.approvalStatus).toBe("pending");
    expect(row.isPubliclyListed).toBe(false);
    expect(row.landlordConsentConfirmed).toBe(false);
    expect(row.icalExportToken).not.toBe("hacked");
    expect(Number(row.propertyManagerCommission)).toBe(10);          // the default stays, the tenant's 0 was removed
    expect(row.unitId).toBe(ctx.unitId);
    expect(row.tenantId).toBe(ctx.tenantId);

    // a second listing for the same unit is refused
    const dup = await post("/api/tenant-short-rentals", ctx.tenantToken, { listingTitle: "Again", nightlyRate: 4000 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("UNIT_ALREADY_LISTED");

    // editing: no moving the unit, no self-approval, no commission
    const edit = await authedPut(app, `/api/tenant-short-rentals/${r.body.id}`, ctx.tenantToken, {
      listingTitle: "My nicer room", unitId: landlordUnit, approvalStatus: "approved", propertyManagerCommission: 0, isActive: false, nightlyRate: 4500,
    });
    expect(edit.status).toBe(200);
    const after = (await db.select().from(tenantShortRentals).where(eq(tenantShortRentals.id, r.body.id)))[0];
    expect(after.unitId).toBe(ctx.unitId);
    expect(after.approvalStatus).toBe("pending");
    expect(after.isActive).toBe(true);
    expect(Number(after.propertyManagerCommission)).toBe(10);
    expect(Number(after.nightlyRate)).toBe(4500);
    expect(after.listingTitle).toBe("My nicer room");

    // a manager approves (needs the landlord-consent confirmation for a tenant sublet) and may set the split
    expect((await authedPatch(app, `/api/tenant-short-rentals/${r.body.id}/status`, managerToken, { status: "approved" })).status).toBe(409);
    expect((await authedPatch(app, `/api/tenant-short-rentals/${r.body.id}/status`, ctx.tenantToken, { status: "approved", landlordConsentConfirmed: true })).status).toBe(403);
    expect((await authedPatch(app, `/api/tenant-short-rentals/${r.body.id}/status`, managerToken, { status: "approved", landlordConsentConfirmed: true })).status).toBe(200);
    const split = await authedPut(app, `/api/tenant-short-rentals/${r.body.id}`, managerToken, { propertyManagerCommission: 12, platformFees: 3 });
    expect(split.status).toBe(200);
    expect(Number(split.body.propertyManagerCommission)).toBe(12);
  });

  it("the numbers are checked", async () => {
    const unitId = await makeUnit();
    const base = { unitId, ownerId: landlord.id, listingTitle: "Checks", nightlyRate: 3000 };
    const t = (o: object) => post("/api/tenant-short-rentals", managerToken, { ...base, ...o });
    expect((await t({ nightlyRate: 0 })).status).toBe(400);
    expect((await t({ nightlyRate: -50 })).status).toBe(400);
    expect((await t({ listingTitle: "   " })).status).toBe(400);
    expect((await t({ minimumNights: 5, maximumNights: 2 })).status).toBe(400);
    expect((await t({ maxGuests: 0 })).status).toBe(400);
    expect((await t({ propertyManagerCommission: 80, platformFees: 40 })).status).toBe(400);
    expect((await t({ propertyManagerCommission: 120 })).status).toBe(400);
    expect((await t({ checkInTime: "25:99" })).status).toBe(400);
    expect((await t({ currency: "kes" })).status).toBe(400);
    expect((await t({})).status).toBe(201);
  });

  it("a manager needs a unit from this organisation, and exactly one host", async () => {
    const unitId = await makeUnit();
    const t = (o: object) => post("/api/tenant-short-rentals", managerToken, { unitId, listingTitle: "Host", nightlyRate: 3000, ...o });
    expect((await t({})).status).toBe(400);
    expect((await t({ ownerId: landlord.id, tenantId: ctx.tenantId })).status).toBe(400);
    expect((await post("/api/tenant-short-rentals", managerToken, { unitId: ctx2.unitId, ownerId: landlord.id, listingTitle: "X", nightlyRate: 3000 })).status).toBe(404);
  });

  it("a landlord lists only units in properties they own", async () => {
    const mine = await post("/api/tenant-short-rentals", landlord.token, { unitId: landlordUnit, listingTitle: "L1", nightlyRate: 3500 });
    expect(mine.status).toBe(201);
    const notMine = await post("/api/tenant-short-rentals", landlord.token, { unitId: await makeUnit(otherProp), listingTitle: "L2", nightlyRate: 3500 });
    expect(notMine.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("recording a booking (staff side)", () => {
  it("the price, commission and payout are worked out from the listing — figures sent by the caller are ignored", async () => {
    const l = await makeListing();
    const r = await bookAs(managerToken, l.id, { totalAmount: "1", tenantPayout: "99999", platformFees: "0", propertyManagerCommission: "0", nightlyRate: "1", refundStatus: "owed", paymentStatus: "paid" }, 4);
    expect(r.status).toBe(201);
    const fin = stayFinancials(l, 4);
    expect(r.body.totalAmount).toBe(fin.totalAmount);
    expect(r.body.totalAmount).toBe("20000.00");
    expect(r.body.propertyManagerCommission).toBe("2000.00");
    expect(r.body.platformFees).toBe("1000.00");
    expect(r.body.tenantPayout).toBe("17000.00");
    expect(r.body.refundStatus).toBe("none");
    // manager said paid → paid and confirmed
    expect(r.body.paymentStatus).toBe("paid");
    expect(r.body.bookingStatus).toBe("confirmed");
  });

  it("only a manager can record a booking as paid; a landlord's booking waits for payment", async () => {
    const l = await makeListing({ unitId: await makeUnit(landlordProp) });      // a unit in the landlord's own property
    const asLandlord = await bookAs(landlord.token, l.id, { paymentStatus: "paid", bookingStatus: "confirmed", platformSource: "airbnb" });
    expect(asLandlord.status).toBe(201);
    expect(asLandlord.body.paymentStatus).toBe("pending");
    expect(asLandlord.body.bookingStatus).toBe("pending");
    expect(asLandlord.body.platformSource).toBe("direct");
    const asManager = await bookAs(managerToken, l.id, { platformSource: "airbnb" });
    expect(asManager.body.paymentStatus).toBe("pending");
    expect(asManager.body.platformSource).toBe("airbnb");
  });

  it("dates, stay length, guests and the guest's details are checked", async () => {
    const l = await makeListing({ minimumNights: 2, maximumNights: 5, maxGuests: 3 });
    const base = stretch(3);
    expect((await authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, ...guest(), checkInDate: day(-3), checkOutDate: day(-1) })).body.message).toMatch(/past/i);
    expect((await authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, ...guest(), checkInDate: base.checkOutDate, checkOutDate: base.checkInDate })).status).toBe(400);
    expect((await authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, ...guest(), checkInDate: "nonsense", checkOutDate: base.checkOutDate })).status).toBe(400);
    expect((await bookAs(managerToken, l.id, {}, 1)).status).toBe(400);                     // under the minimum
    expect((await bookAs(managerToken, l.id, {}, 6)).status).toBe(400);                     // over the maximum
    expect((await bookAs(managerToken, l.id, { guestCount: 4 })).status).toBe(400);          // too many guests
    expect((await bookAs(managerToken, l.id, { guestEmail: "nope" })).status).toBe(400);
    expect((await bookAs(managerToken, l.id, { guestName: " " })).status).toBe(400);
    expect((await bookAs(managerToken, l.id, { guestPhone: "1" })).status).toBe(400);
    expect((await bookAs(managerToken, l.id, {}, 3)).status).toBe(201);
  });

  it("a listing from another organisation, an unapproved or removed one can't be booked", async () => {
    const l = await makeListing();
    expect((await bookAs(ctx2.adminToken, l.id)).status).toBe(404);
    const pending = await makeListing({ approvalStatus: "pending" });
    expect((await bookAs(managerToken, pending.id)).status).toBe(409);
    const removed = await makeListing({ isActive: false });
    expect((await bookAs(managerToken, removed.id)).status).toBe(409);
  });

  it("the same nights can't be sold twice, even when two requests arrive together", async () => {
    const l = await makeListing();
    const dates = stretch(3);
    const results = await Promise.all([1, 2, 3].map(() => authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, ...dates, ...guest() })));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(2);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("BOOKING_DATES_UNAVAILABLE");
  });

  it("a host-blocked date range refuses the booking", async () => {
    const l = await makeListing();
    const dates = stretch(3);
    await db.insert(listingBlockedDates).values({ rentalListingId: l.id, startDate: new Date(dates.checkInDate), endDate: new Date(dates.checkOutDate), source: "manual" } as any);
    const r = await authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, ...dates, ...guest() });
    expect(r.status).toBe(409);
  });

  it("a tenant can't book someone else's listing", async () => {
    const l = await makeListing();
    expect((await bookAs(ctx.tenantToken, l.id)).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("changing a booking", () => {
  it("only guest details, dates and the stay's progress can be edited — never money, refund or references", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    const r = await authedPut(app, `/api/short-term-bookings/${b.id}`, managerToken, {
      guestName: "New Name", totalAmount: "1", tenantPayout: "999999", paymentStatus: "paid", refundStatus: "owed", refundAmount: "5000",
      bookingReference: "HACK", organizationId: ctx2.orgId, rentalListingId: 1,
    });
    expect(r.status).toBe(200);
    const row = await bookingRow(b.id);
    expect(row.guestName).toBe("New Name");
    expect(row.totalAmount).toBe(b.totalAmount);
    expect(row.paymentStatus).toBe("pending");
    expect(row.refundStatus).toBe("none");
    expect(row.bookingReference).toBe(b.bookingReference);
    expect(row.organizationId).toBe(ctx.orgId);
  });

  it("status moves follow the stay, and cancelling goes through the cancel action", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    const put = (status: string, tok = managerToken) => authedPut(app, `/api/short-term-bookings/${b.id}`, tok, { bookingStatus: status });
    expect((await put("checked_in")).status).toBe(409);       // pending can't jump to checked in
    expect((await put("cancelled")).status).toBe(400);        // use cancel
    expect((await put("confirmed", landlord.token)).status).toBe(403);   // unpaid: only a manager confirms
    expect((await put("confirmed")).status).toBe(200);
    expect((await put("checked_in")).status).toBe(200);
    expect((await put("confirmed")).status).toBe(409);
    expect((await put("checked_out")).status).toBe(200);
    expect((await put("checked_in")).status).toBe(409);       // a finished stay can't change
  });

  it("moving the dates re-prices an unpaid stay, refuses clashes, and keeps a paid stay at the same number of nights", async () => {
    const l = await makeListing();
    const a = (await bookAs(managerToken, l.id, {}, 3)).body;
    const other = (await bookAs(managerToken, l.id, {}, 3)).body;
    // clash with the other booking
    const clash = await authedPut(app, `/api/short-term-bookings/${a.id}`, managerToken, { checkInDate: other.checkInDate, checkOutDate: other.checkOutDate });
    expect(clash.status).toBe(409);
    // longer unpaid stay: re-priced
    const farIn = day(dayCursor + 20); const farOut = day(dayCursor + 25);
    const longer = await authedPut(app, `/api/short-term-bookings/${a.id}`, managerToken, { checkInDate: farIn, checkOutDate: farOut });
    expect(longer.status).toBe(200);
    expect(longer.body.numberOfNights).toBe(5);
    expect(longer.body.totalAmount).toBe("25000.00");
    // paid stay: same nights OK, different nights refused
    const paid = (await bookAs(managerToken, l.id, { paymentStatus: "paid" }, 3)).body;
    const sameIn = day(dayCursor + 40); const sameOut = day(dayCursor + 43);
    expect((await authedPut(app, `/api/short-term-bookings/${paid.id}`, managerToken, { checkInDate: sameIn, checkOutDate: sameOut })).status).toBe(200);
    const diff = await authedPut(app, `/api/short-term-bookings/${paid.id}`, managerToken, { checkInDate: sameIn, checkOutDate: day(dayCursor + 45) });
    expect(diff.status).toBe(409);
    expect(diff.body.code).toBe("PAID_NIGHTS_CHANGE");
  });

  it("another organisation can't read or change it", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    expect((await authedPut(app, `/api/short-term-bookings/${b.id}`, ctx2.adminToken, { guestName: "x" })).status).toBe(404);
    expect((await del(`/api/short-term-bookings/${b.id}`, ctx2.adminToken)).status).toBe(404);
    expect((await authedPost(app, `/api/short-term-bookings/${b.id}/mark-paid`, ctx2.adminToken)).status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("cancel, record payment and refund", () => {
  it("cancelling an unpaid booking frees the dates and owes nothing", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    const r = await del(`/api/short-term-bookings/${b.id}`, managerToken);
    expect(r.status).toBe(200);
    expect(r.body.bookingStatus).toBe("cancelled");
    expect(r.body.refundStatus).toBe("none");
    // the same dates can be sold again
    expect((await authedPost(app, "/api/short-term-bookings", managerToken, { rentalListingId: l.id, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, ...guest() })).status).toBe(201);
    // and it can't be cancelled twice
    expect((await del(`/api/short-term-bookings/${b.id}`, managerToken)).status).toBe(409);
  });

  it("cancelling a paid booking owes a refund — once, even when two people press cancel together", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id, { paymentStatus: "paid" })).body;
    const [x, y] = await Promise.all([del(`/api/short-term-bookings/${b.id}`, managerToken), del(`/api/short-term-bookings/${b.id}`, managerToken)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const row = await bookingRow(b.id);
    expect(row.refundStatus).toBe("owed");
    expect(Number(row.refundAmount)).toBe(Number(b.totalAmount));
  });

  it("a guest who has checked in can't be cancelled", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id, { paymentStatus: "paid" })).body;
    await authedPut(app, `/api/short-term-bookings/${b.id}`, managerToken, { bookingStatus: "checked_in" });
    const r = await del(`/api/short-term-bookings/${b.id}`, managerToken);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("STAY_STARTED");
  });

  it("a manager records cash/bank payment once; a tenant or landlord can't", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    expect((await post(`/api/short-term-bookings/${b.id}/mark-paid`, landlord.token)).status).toBe(403);
    expect((await post(`/api/short-term-bookings/${b.id}/mark-paid`, ctx.tenantToken)).status).toBe(403);
    const ok = await post(`/api/short-term-bookings/${b.id}/mark-paid`, managerToken);
    expect(ok.status).toBe(200);
    expect(ok.body.paymentStatus).toBe("paid");
    expect(ok.body.bookingStatus).toBe("confirmed");
    expect((await post(`/api/short-term-bookings/${b.id}/mark-paid`, managerToken)).status).toBe(409);
  });

  it("a cancelled booking can't take a payment", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id)).body;
    await del(`/api/short-term-bookings/${b.id}`, managerToken);
    expect((await post(`/api/short-term-bookings/${b.id}/mark-paid`, managerToken)).status).toBe(409);
  });

  it("'refund sent' works once, only when a refund is owed, and marks the payment refunded", async () => {
    const l = await makeListing();
    const b = (await bookAs(managerToken, l.id, { paymentStatus: "paid" })).body;
    expect((await post(`/api/short-term-bookings/${b.id}/mark-refunded`, managerToken)).status).toBe(409);   // nothing owed yet
    await del(`/api/short-term-bookings/${b.id}`, managerToken);
    const [x, y] = await Promise.all([
      post(`/api/short-term-bookings/${b.id}/mark-refunded`, managerToken, { notes: "QWE123" }),
      post(`/api/short-term-bookings/${b.id}/mark-refunded`, managerToken, { notes: "QWE123" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const row = await bookingRow(b.id);
    expect(row.refundStatus).toBe("completed");
    expect(row.paymentStatus).toBe("refunded");
    expect(row.refundNotes).toBe("QWE123");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("M-Pesa payment outcomes (applyStayPayment)", () => {
  it("full payment on a waiting booking confirms it", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id);
    const r = await applyStayPayment(b.id, 15000);
    expect(r.outcome).toBe("confirmed");
    const row = await bookingRow(b.id);
    expect(row.paymentStatus).toBe("paid");
    expect(row.bookingStatus).toBe("confirmed");
    expect(row.refundStatus).toBe("none");
  });

  it("a second payment on a paid booking is a duplicate and is recorded as owed back", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id);
    await applyStayPayment(b.id, 15000);
    const r = await applyStayPayment(b.id, 15000);
    expect(r.outcome).toBe("duplicate");
    const row = await bookingRow(b.id);
    expect(row.bookingStatus).toBe("confirmed");
    expect(row.refundStatus).toBe("owed");
    expect(Number(row.refundAmount)).toBe(15000);
  });

  it("a payment after the booking was cancelled or expired is recorded as owed back and confirms nothing", async () => {
    const l = await makeListing();
    const cancelled = await bookDirect(l.id, { bookingStatus: "cancelled" });
    const r1 = await applyStayPayment(cancelled.id, 15000);
    expect(r1.outcome).toBe("late");
    const c = await bookingRow(cancelled.id);
    expect(c.bookingStatus).toBe("cancelled");
    expect(c.refundStatus).toBe("owed");
    expect(Number(c.refundAmount)).toBe(15000);

    const expired = await bookDirect(l.id, { bookingStatus: "expired" });
    expect((await applyStayPayment(expired.id, 15000)).outcome).toBe("late");
    expect((await bookingRow(expired.id)).bookingStatus).toBe("expired");
  });

  it("less than the price confirms nothing and the money is recorded as owed back", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id);
    const r = await applyStayPayment(b.id, 5000);
    expect(r.outcome).toBe("short");
    const row = await bookingRow(b.id);
    expect(row.bookingStatus).toBe("pending");
    expect(row.paymentStatus).toBe("failed");
    expect(Number(row.refundAmount)).toBe(5000);
  });

  it("an unknown booking is reported as such", async () => {
    expect((await applyStayPayment(2_000_000_000, 100)).outcome).toBe("unknown");
  });

  it("owed amounts add up: a late payment on a booking that already owes a refund", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id, { bookingStatus: "cancelled", paymentStatus: "paid", refundStatus: "owed", refundAmount: "15000.00" });
    await applyStayPayment(b.id, 15000);
    expect(Number((await bookingRow(b.id)).refundAmount)).toBe(30000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the public booking page", () => {
  const pub = (path: string) => supertest(app).get(`/api/public/stays${path}`);
  const pubPost = (path: string, body: object) => supertest(app).post(`/api/public/stays${path}`).send(body);

  it("a guest books, the price comes from the listing, and the email is stored in lower case", async () => {
    const l = await makeListing();
    const dates = stretch(2);
    const r = await pubPost(`/${l.slug}/book`, { ...guest({ guestEmail: "Mixed.Case@Example.COM" }), ...dates, totalAmount: "1" });
    expect(r.status).toBe(201);
    expect(r.body.totalAmount).toBe("10000.00");
    const row = await bookingRow(r.body.id);
    expect(row.guestEmail).toBe("mixed.case@example.com");
    expect(row.bookingStatus).toBe("pending");
    expect(row.paymentStatus).toBe("pending");
    // past dates refused
    expect((await pubPost(`/${l.slug}/book`, { ...guest(), checkInDate: day(-2), checkOutDate: day(1) })).status).toBe(400);
  });

  it("lookup and cancel work with the email in any capitalisation", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id, { guestEmail: "lower@example.com" });
    const found = await pub(`/bookings/lookup`).query({ bookingReference: b.bookingReference, guestEmail: "LOWER@Example.com" });
    expect(found.status).toBe(200);
    expect((await pub(`/bookings/lookup`).query({ bookingReference: b.bookingReference, guestEmail: "someone@else.com" })).status).toBe(404);
    const c = await pubPost(`/bookings/${b.bookingReference}/cancel`, { guestEmail: "Lower@EXAMPLE.com" });
    expect(c.status).toBe(200);
    expect(c.body.bookingStatus).toBe("cancelled");
  });

  it("a guest can't cancel a stay that has started or already finished", async () => {
    const l = await makeListing();
    const started = await bookDirect(l.id, {
      checkInDate: new Date(Date.now() - 86_400_000), checkOutDate: new Date(Date.now() + 2 * 86_400_000),
      bookingStatus: "confirmed", paymentStatus: "paid",
    });
    const r = await pubPost(`/bookings/${started.bookingReference}/cancel`, { guestEmail: started.guestEmail });
    expect(r.status).toBe(409);
    expect((await bookingRow(started.id)).bookingStatus).toBe("confirmed");
    const out = await bookDirect(l.id, { bookingStatus: "checked_out", paymentStatus: "paid" });
    expect((await pubPost(`/bookings/${out.bookingReference}/cancel`, { guestEmail: out.guestEmail })).status).toBe(409);
  });

  it("a guest cancelling a paid, future booking owes the refund once", async () => {
    const l = await makeListing();
    const b = await bookDirect(l.id, { bookingStatus: "confirmed", paymentStatus: "paid" });
    const r = await pubPost(`/bookings/${b.bookingReference}/cancel`, { guestEmail: b.guestEmail });
    expect(r.status).toBe(200);
    expect(r.body.refundStatus).toBe("owed");
    expect((await pubPost(`/bookings/${b.bookingReference}/cancel`, { guestEmail: b.guestEmail })).status).toBe(409);
  });

  it("an expired booking can't be paid, and a second prompt is refused while one is on the phone", async () => {
    const l = await makeListing();
    const expired = await bookDirect(l.id, { bookingStatus: "expired" });
    const e = await pubPost(`/${l.slug}/bookings/${expired.id}/pay`, { phoneNumber: "0712345678" });
    expect(e.status).toBe(409);
    expect(e.body.code).toBe("BOOKING_EXPIRED");

    const b = await bookDirect(l.id);
    await db.insert(mpesaTransactions).values({ phoneNumber: "254712345678", amount: "15000", status: "pending", shortTermBookingId: b.id } as any);
    const p = await pubPost(`/${l.slug}/bookings/${b.id}/pay`, { phoneNumber: "0712345678" });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe("PAYMENT_IN_PROGRESS");

    const started = await bookDirect(l.id, { bookingStatus: "checked_in" });
    expect((await pubPost(`/${l.slug}/bookings/${started.id}/pay`, { phoneNumber: "0712345678" })).status).toBe(409);
    const paid = await bookDirect(l.id, { paymentStatus: "paid", bookingStatus: "confirmed" });
    expect((await pubPost(`/${l.slug}/bookings/${paid.id}/pay`, { phoneNumber: "0712345678" })).status).toBe(409);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("calendar feeds", () => {
  it("links that point inside the network, or aren't plain public https, are refused", async () => {
    for (const bad of [
      "http://example.com/cal.ics",                // not https
      "https://localhost/cal.ics",
      "https://foo.internal/cal.ics",
      "https://printer.local/cal.ics",
      "https://127.0.0.1/cal.ics",
      "https://10.1.2.3/cal.ics",
      "https://172.16.0.9/cal.ics",
      "https://192.168.1.1/cal.ics",
      "https://169.254.169.254/latest/meta-data",  // cloud metadata
      "https://100.64.0.1/cal.ics",                // carrier-grade NAT
      "https://[::1]/cal.ics",
      "https://[fd00::1]/cal.ics",
      "https://user:pass@8.8.8.8/cal.ics",
      "https://8.8.8.8:8443/cal.ics",
      "not a url",
    ]) {
      await expect(assertPublicFeedUrl(bad), bad).rejects.toMatchObject({ status: 400 });
    }
    const ok = await assertPublicFeedUrl("https://8.8.8.8/cal.ics");
    expect(ok.hostname).toBe("8.8.8.8");
  });

  it("adding a feed applies the same check and the per-listing limit", async () => {
    const l = await makeListing();
    expect((await post(`/api/tenant-short-rentals/${l.id}/ical-feeds`, managerToken, { platform: "airbnb", feedUrl: "https://169.254.169.254/x" })).status).toBe(400);
    expect((await post(`/api/tenant-short-rentals/${l.id}/ical-feeds`, managerToken, { platform: "airbnb", feedUrl: "http://8.8.8.8/x.ics" })).status).toBe(400);
    for (let i = 0; i < 10; i++) {
      const r = await post(`/api/tenant-short-rentals/${l.id}/ical-feeds`, managerToken, { platform: "other", feedUrl: `https://8.8.8.8/${i}.ics` });
      expect(r.status).toBe(201);
    }
    expect((await post(`/api/tenant-short-rentals/${l.id}/ical-feeds`, managerToken, { platform: "other", feedUrl: "https://8.8.8.8/11.ics" })).status).toBe(409);
  });

  it("someone else's listing can't have feeds added", async () => {
    const l = await makeListing();
    expect((await post(`/api/tenant-short-rentals/${l.id}/ical-feeds`, ctx2.adminToken, { platform: "other", feedUrl: "https://8.8.8.8/x.ics" })).status).toBe(404);
  });
});

describe("money helpers", () => {
  it("the three parts always add up to the total", () => {
    const f = stayFinancials({ nightlyRate: "3333.33", propertyManagerCommission: "12.5", platformFees: "3.3" }, 7);
    expect(Number(f.propertyManagerCommission) + Number(f.platformFees) + Number(f.tenantPayout)).toBeCloseTo(Number(f.totalAmount), 2);
  });
  it("nights are whole days and at least one", () => {
    expect(nightsBetween(new Date("2030-01-01"), new Date("2030-01-04"))).toBe(3);
    expect(nightsBetween(new Date("2030-01-01T10:00:00Z"), new Date("2030-01-01T12:00:00Z"))).toBe(1);
  });
});
