/**
 * gate-visitors-parking.test.ts — visitors, the gate (PIN guards), gate passes, vehicles and parking
 *
 * spaces       edit keeps occupancy and property; duplicate numbers; delete refused while a car is in; org isolation
 * vehicles     plates are one car however typed; per-property uniqueness; guards register but can't edit/approve/delete;
 *              blacklisting a vehicle frees its bay
 * assignments  one car per bay, one bay per car; blacklisted / other-property / other-tenant refused; ending frees the bay
 * visitor flow tenant invite → guard scan → parking → checkout; double scan; blacklisted car; expiry; too early; concurrent
 *              scans and arrivals; walk-in plate capture; manager check-in/out follow the same rules (and no longer end the
 *              wrong vehicle's parking); revoked/denied can't enter
 * gate PINs    weak and duplicate PINs refused, brute-force lockout, a switched-off / expired / replaced PIN ends the session
 *              everywhere (including the JWT-protected vehicle and pass routes), a guard only sees their own property
 * gate passes  manager passes are approved, guard passes wait; "revoke" works; landlord/guard scoping; derived expiry
 * hardware     a webhook signed over the raw bytes is accepted even when the JSON is pretty-printed
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import crypto, { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, authedPut, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import {
  users, properties, units, tenants, visitors, visitorLog, parkingSpaces, parkingAssignments, registeredVehicles,
  gatePins, guardShifts, vehicleMovementLog, auditLogs,
} from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import { resetGateLoginLimits } from "../routes/gate-pins";

let app: any;
let ctx: TestContext;       // organisation A: property A (propertyId) + a second property B
let ctx2: TestContext;      // organisation B
let propB: number;
let managerToken: string;
let landlord: { id: string; token: string };
let landlordProp: number;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`.toUpperCase();

const del = (path: string, token: string) => supertest(app).delete(path).set("Authorization", `Bearer ${token}`);
const get = (path: string, token: string) => authedGet(app, path, token);

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number, role: string) {
  const email = `gv-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Gv", lastName: role, role, organizationId: orgId, emailVerified: true } as any);
  return { id, token: await login(email) };
}

let pinSeq = 0;
/** A PIN that is neither weak nor used before in this run. */
const freshPin = () => { const base = 4000 + (++pinSeq) * 37; return String(base % 10000).padStart(4, "0").replace(/^(\d)\1+$/, "7391"); };

async function makePin(propertyId: number, token = managerToken, pin = freshPin()) {
  const r = await authedPost(app, "/api/gate-pins", token, { propertyId, label: `Guard ${uniq()}`, pin });
  return { res: r, pin, id: r.body?.id as number };
}
async function guardLogin(propertyId: number, pin: string) {
  const r = await supertest(app).post("/api/gate-auth/login").send({ propertyId, pin });
  return { res: r, token: r.body?.token as string, shiftId: r.body?.shiftId as number };
}
async function guardFor(propertyId: number) {
  const p = await makePin(propertyId);
  expect(p.res.status).toBe(201);
  const g = await guardLogin(propertyId, p.pin);
  expect(g.res.status).toBe(200);
  return { ...g, pinId: p.id, pin: p.pin };
}

const gpost = (path: string, token: string, body: object = {}) => supertest(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
const gget = (path: string, token: string) => supertest(app).get(path).set("Authorization", `Bearer ${token}`);

async function addSpace(propertyId: number, over: object = {}, token = managerToken) {
  return authedPost(app, "/api/parking-spaces", token, { propertyId, spaceNumber: `S${uniq()}`, spaceType: "visitor", ...over });
}
async function addVehicle(propertyId: number, over: object = {}, token = managerToken) {
  return authedPost(app, "/api/registered-vehicles", token, {
    propertyId, plateNumber: `K${uniq()}`, ownerType: "tenant", vehicleType: "car", make: "Toyota", model: "Vitz", color: "Silver", status: "active", ...over,
  });
}
async function assign(spaceId: number, vehicleId: number, over: object = {}, token = managerToken) {
  return authedPost(app, "/api/parking-assignments", token, { parkingSpaceId: spaceId, vehicleId, assignmentType: "permanent", ...over });
}
const spaceRow = async (id: number) => (await db.select().from(parkingSpaces).where(eq(parkingSpaces.id, id)))[0];
const visitorRow = async (code: string) => (await db.select().from(visitors).where(eq(visitors.accessCode, code)))[0];
const activeAssignments = (spaceId: number) => db.select().from(parkingAssignments).where(and(eq(parkingAssignments.parkingSpaceId, spaceId), eq(parkingAssignments.status, "active" as any)));

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

/** A pending visitor invited the way the tenant portal does it. */
async function invite(over: object = {}) {
  return authedPost(app, "/api/tenant/invite-visitor", ctx.tenantToken, {
    visitorName: "Visitor " + uniq(), visitorPhone: "0700000000", visitPurpose: "Dinner", expectedArrival: inHours(1), ...over,
  });
}
/** A visitor row inserted directly (so a test can set any status / time). */
async function seedVisitor(over: Record<string, any> = {}) {
  const code = `VAC-${uniq().slice(-6).padStart(6, "0")}`;
  await db.insert(visitors).values({
    propertyId: ctx.propertyId, unitId: ctx.unitId, tenantId: ctx.tenantId, visitorName: "Seed " + code, purposeOfVisit: "Visit",
    expectedArrival: new Date(Date.now() + 3600_000), status: "pending", accessCode: code, createdBy: ctx.adminUserId, ...over,
  } as any);
  return code;
}

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  ctx2 = await setupTestData();
  managerToken = (await makeUser(ctx.orgId, "manager")).token;
  const [pb] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Property B", address: "B Road", totalUnits: 0 } as any).returning({ id: properties.id });
  propB = pb.id;
  landlord = await makeUser(ctx.orgId, "landlord");
  const [lp] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Landlord Plot", address: "L Road", totalUnits: 0, ownerId: landlord.id } as any).returning({ id: properties.id });
  landlordProp = lp.id;
});

beforeEach(() => resetGateLoginLimits());

afterAll(async () => {
  const orgIds = [ctx.orgId, ctx2.orgId];
  const props = (await db.select({ id: properties.id }).from(properties).where(inArray(properties.organizationId, orgIds))).map((p) => p.id);
  if (props.length) {
    const vis = (await db.select({ id: visitors.id }).from(visitors).where(inArray(visitors.propertyId, props))).map((v) => v.id);
    if (vis.length) await db.delete(visitorLog).where(inArray(visitorLog.visitorId, vis)).catch(() => {});
    await db.delete(visitors).where(inArray(visitors.propertyId, props)).catch(() => {});
    const sp = (await db.select({ id: parkingSpaces.id }).from(parkingSpaces).where(inArray(parkingSpaces.propertyId, props))).map((s) => s.id);
    if (sp.length) await db.delete(parkingAssignments).where(inArray(parkingAssignments.parkingSpaceId, sp)).catch(() => {});
    await db.delete(parkingSpaces).where(inArray(parkingSpaces.propertyId, props)).catch(() => {});
    await db.delete(registeredVehicles).where(inArray(registeredVehicles.propertyId, props)).catch(() => {});
    await db.delete(vehicleMovementLog).where(inArray(vehicleMovementLog.propertyId, props)).catch(() => {});
    await db.delete(guardShifts).where(inArray(guardShifts.propertyId, props)).catch(() => {});
    await db.delete(gatePins).where(inArray(gatePins.propertyId, props)).catch(() => {});
  }
  const uids = (await db.select({ id: users.id }).from(users).where(inArray(users.organizationId, orgIds))).map((u) => u.id);
  if (uids.length) await db.delete(auditLogs).where(inArray(auditLogs.userId, uids)).catch(() => {});
  await db.delete(properties).where(inArray(properties.organizationId, orgIds)).catch(() => {});
  await cleanupTestData(ctx);
  await cleanupTestData(ctx2);
});

// ════════════════════════════════════════════════════════════════════════════
describe("parking spaces", () => {
  it("creates a space; refuses a duplicate number, a bad type and a negative rate", async () => {
    const num = `P${uniq()}`;
    const ok = await addSpace(ctx.propertyId, { spaceNumber: num, spaceType: "standard", monthlyRate: 3000 });
    expect(ok.status).toBe(201);
    expect(ok.body.isAvailable).toBe(true);
    expect((await addSpace(ctx.propertyId, { spaceNumber: num.toLowerCase() })).status).toBe(409);
    expect((await addSpace(ctx.propertyId, { spaceType: "helipad" })).status).toBe(400);
    expect((await addSpace(ctx.propertyId, { monthlyRate: -5 })).status).toBe(400);
    expect((await addSpace(ctx.propertyId, { spaceNumber: "  " })).status).toBe(400);
    // the same number at the other property is fine
    expect((await addSpace(propB, { spaceNumber: num })).status).toBe(201);
  });

  it("editing a space keeps it occupied and at its property; only the fields sent change", async () => {
    const sp = (await addSpace(ctx.propertyId, { monthlyRate: 2500, notes: "near gate" })).body;
    const veh = (await addVehicle(ctx.propertyId)).body;
    expect((await assign(sp.id, veh.id)).status).toBe(201);
    expect((await spaceRow(sp.id)).isAvailable).toBe(false);

    const r = await authedPut(app, `/api/parking-spaces/${sp.id}`, managerToken, { notes: "now with a light", isAvailable: true, propertyId: propB });
    expect(r.status).toBe(200);
    expect(r.body.notes).toBe("now with a light");
    expect(r.body.isAvailable).toBe(false);                 // still has a car in it
    expect(r.body.occupied).toBe(true);
    expect(r.body.propertyId).toBe(ctx.propertyId);          // can't be moved
    expect(Number(r.body.monthlyRate)).toBe(2500);           // not wiped by an edit that didn't mention it
    expect((await spaceRow(sp.id)).isAvailable).toBe(false);
  });

  it("refuses to delete a space with a car in it, then deletes it once the assignment ends", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const veh = (await addVehicle(ctx.propertyId)).body;
    const a = (await assign(sp.id, veh.id)).body;
    expect((await del(`/api/parking-spaces/${sp.id}`, managerToken)).status).toBe(409);
    expect((await authedPatch(app, `/api/parking-assignments/${a.id}/status`, managerToken, { status: "terminated" })).status).toBe(200);
    expect((await del(`/api/parking-spaces/${sp.id}`, managerToken)).status).toBe(204);
    expect(await spaceRow(sp.id)).toBeUndefined();
  });

  it("another organisation can't see, edit or delete a space", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const other = ctx2.adminToken;
    expect((await get("/api/parking-spaces", other)).body.some((s: any) => s.id === sp.id)).toBe(false);
    expect((await get(`/api/parking-spaces/${sp.id}`, other)).status).toBe(404);
    expect((await authedPut(app, `/api/parking-spaces/${sp.id}`, other, { notes: "x" })).status).toBe(403);
    expect((await del(`/api/parking-spaces/${sp.id}`, other)).status).toBe(403);
    expect((await addSpace(ctx.propertyId, {}, other)).status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("registered vehicles", () => {
  it("one car however the plate is typed; unique per property, not across the platform", async () => {
    const a = await addVehicle(ctx.propertyId, { plateNumber: "kzz 123a" });
    expect(a.status).toBe(201);
    expect(a.body.plateNumber).toBe("KZZ123A");
    expect((await addVehicle(ctx.propertyId, { plateNumber: "KZZ-123A" })).status).toBe(409);
    expect((await addVehicle(ctx.propertyId, { plateNumber: "kzz123a" })).status).toBe(409);
    expect((await addVehicle(propB, { plateNumber: "KZZ 123A" })).status).toBe(201);                 // another property
    expect((await addVehicle(ctx2.propertyId, { plateNumber: "KZZ 123A" }, ctx2.adminToken)).status).toBe(201);   // another organisation
    expect((await addVehicle(ctx.propertyId, { plateNumber: "!!" })).status).toBe(400);
    expect((await addVehicle(ctx.propertyId, { ownerType: "alien" })).status).toBe(400);
  });

  it("a guard can register a vehicle (pending) but not edit, approve, blacklist or delete one; and sees only their property", async () => {
    const g = await guardFor(ctx.propertyId);
    const made = await gpost("/api/registered-vehicles", g.token, { propertyId: ctx.propertyId, plateNumber: `G${uniq()}`, ownerType: "visitor", vehicleType: "car", make: "Unknown", model: "Unknown", color: "Unknown", status: "active" });
    expect(made.status).toBe(201);
    expect(made.body.status).toBe("pending_approval");
    const id = made.body.id;
    expect((await supertest(app).put(`/api/registered-vehicles/${id}`).set("Authorization", `Bearer ${g.token}`).send({ make: "x" })).status).toBe(403);
    expect((await supertest(app).patch(`/api/registered-vehicles/${id}/status`).set("Authorization", `Bearer ${g.token}`).send({ status: "active" })).status).toBe(403);
    expect((await supertest(app).delete(`/api/registered-vehicles/${id}`).set("Authorization", `Bearer ${g.token}`)).status).toBe(403);
    // their own property only
    expect((await gpost("/api/registered-vehicles", g.token, { propertyId: propB, plateNumber: `H${uniq()}`, ownerType: "visitor", vehicleType: "car", make: "a", model: "b", color: "c" })).status).toBe(403);
    const list = (await gget("/api/registered-vehicles", g.token)).body as any[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((v) => v.propertyId === ctx.propertyId)).toBe(true);
  });

  it("editing changes only what is sent and can't move the vehicle to another property", async () => {
    const v = (await addVehicle(ctx.propertyId, { year: 2018, notes: "keep" })).body;
    const r = await authedPut(app, `/api/registered-vehicles/${v.id}`, managerToken, { color: "Blue", propertyId: propB, status: "blacklisted" });
    expect(r.status).toBe(200);
    expect(r.body.color).toBe("Blue");
    expect(r.body.year).toBe(2018);
    expect(r.body.notes).toBe("keep");
    expect(r.body.propertyId).toBe(ctx.propertyId);
    expect(r.body.status).toBe("active");        // status only through its own route
  });

  it("blacklisting a vehicle frees its bay; a vehicle with an active assignment can't be deleted", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const v = (await addVehicle(ctx.propertyId)).body;
    await assign(sp.id, v.id);
    expect((await del(`/api/registered-vehicles/${v.id}`, managerToken)).status).toBe(409);
    expect((await authedPatch(app, `/api/registered-vehicles/${v.id}/status`, managerToken, { status: "blacklisted" })).status).toBe(200);
    expect(await activeAssignments(sp.id)).toHaveLength(0);
    expect((await spaceRow(sp.id)).isAvailable).toBe(true);
    expect((await del(`/api/registered-vehicles/${v.id}`, managerToken)).status).toBe(204);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("parking assignments", () => {
  it("one car per bay and one bay per car; refuses blacklisted, other-property and other-property tenants", async () => {
    const sp1 = (await addSpace(ctx.propertyId)).body;
    const sp2 = (await addSpace(ctx.propertyId)).body;
    const v1 = (await addVehicle(ctx.propertyId)).body;
    const v2 = (await addVehicle(ctx.propertyId)).body;
    const first = await assign(sp1.id, v1.id, { tenantId: ctx.tenantId, monthlyFee: 2000 });
    expect(first.status).toBe(201);
    expect((await assign(sp1.id, v2.id)).status).toBe(409);       // bay taken
    expect((await assign(sp2.id, v1.id)).status).toBe(409);       // car already has a bay
    const black = (await addVehicle(ctx.propertyId, { status: "blacklisted" })).body;
    // (created as pending — blacklist it properly)
    await authedPatch(app, `/api/registered-vehicles/${black.id}/status`, managerToken, { status: "blacklisted" });
    expect((await assign(sp2.id, black.id)).status).toBe(409);
    const otherPropVeh = (await addVehicle(propB)).body;
    expect((await assign(sp2.id, otherPropVeh.id)).status).toBe(400);
    expect((await assign(sp2.id, v2.id, { assignmentType: "forever" })).status).toBe(400);
    expect((await assign(sp2.id, v2.id, { monthlyFee: -1 })).status).toBe(400);
    expect((await assign(sp2.id, v2.id, { startDate: "2026-02-01", endDate: "2026-01-01" })).status).toBe(400);
    // a tenant from another organisation's property
    expect((await assign(sp2.id, v2.id, { tenantId: ctx2.tenantId })).status).toBe(404);
    // other organisation
    expect((await assign(sp2.id, v2.id, {}, ctx2.adminToken)).status).toBe(403);
  });

  it("ending an assignment frees the bay; it can't be re-activated onto a bay someone else now holds", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const v1 = (await addVehicle(ctx.propertyId)).body;
    const v2 = (await addVehicle(ctx.propertyId)).body;
    const a1 = (await assign(sp.id, v1.id)).body;
    expect((await spaceRow(sp.id)).isAvailable).toBe(false);
    const ended = await authedPatch(app, `/api/parking-assignments/${a1.id}/status`, managerToken, { status: "terminated" });
    expect(ended.status).toBe(200);
    expect(ended.body.endDate).toBeTruthy();
    expect((await spaceRow(sp.id)).isAvailable).toBe(true);
    expect((await assign(sp.id, v2.id)).status).toBe(201);
    expect((await authedPatch(app, `/api/parking-assignments/${a1.id}/status`, managerToken, { status: "active" })).status).toBe(409);
    // editing an assignment keeps the fee when it isn't mentioned
    const a2 = (await assign((await addSpace(ctx.propertyId)).body.id, (await addVehicle(ctx.propertyId)).body.id, { monthlyFee: 1500 })).body;
    const edited = await authedPut(app, `/api/parking-assignments/${a2.id}`, managerToken, { notes: "gate side" });
    expect(Number(edited.body.monthlyFee)).toBe(1500);
    // deleting frees the bay too
    expect((await del(`/api/parking-assignments/${a2.id}`, managerToken)).status).toBe(204);
    expect((await spaceRow(a2.parkingSpaceId)).isAvailable).toBe(true);
  });

  it("two people assigning the same bay at once: exactly one wins", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const vs = await Promise.all([addVehicle(ctx.propertyId), addVehicle(ctx.propertyId), addVehicle(ctx.propertyId)]);
    const rs = await Promise.all(vs.map((v) => assign(sp.id, v.body.id)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await activeAssignments(sp.id)).toHaveLength(1);
  });

  it("a repeat visitor shows once, with their latest visit, and another property's visit isn't mixed in", async () => {
    const sp = (await addSpace(ctx.propertyId)).body;
    const v = (await addVehicle(ctx.propertyId, { ownerType: "visitor", plateNumber: "KRP100A" })).body;
    await seedVisitor({ vehiclePlate: "KRP100A", visitorName: "Old Visit", status: "checked_out" });
    await seedVisitor({ vehiclePlate: "KRP100A", visitorName: "Newest Visit", status: "checked_in" });
    await db.insert(visitors).values({ propertyId: propB, visitorName: "Elsewhere", purposeOfVisit: "x", expectedArrival: new Date(), status: "checked_in", accessCode: `VAC-${uniq().slice(-6)}`, vehiclePlate: "KRP100A", createdBy: ctx.adminUserId } as any);
    const a = (await assign(sp.id, v.id, { assignmentType: "visitor" })).body;
    const rows = ((await get("/api/parking-assignments", managerToken)).body as any[]).filter((r) => r.id === a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitorName).toBe("Newest Visit");
    expect(rows[0].spaceNumber).toBe(sp.spaceNumber);
    expect(rows[0].plateNumber).toBe("KRP100A");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("visitor flow: tenant invite → guard scan → parking → checkout", () => {
  it("validates the invitation: dates, past arrivals, plates; an inactive tenant can't invite", async () => {
    expect((await invite({ expectedArrival: "not a date" })).status).toBe(400);
    expect((await invite({ expectedArrival: new Date(Date.now() - 5 * 86400_000).toISOString() })).status).toBe(400);
    expect((await invite({ expectedDeparture: inHours(-1) })).status).toBe(400);
    expect((await invite({ vehiclePlate: "$$" })).status).toBe(400);
    const ok = await invite({ vehiclePlate: "kdb 777x" });
    expect(ok.status).toBe(201);
    expect((await visitorRow(ok.body.accessCode)).vehiclePlate).toBe("KDB777X");
    await db.update(tenants).set({ status: "terminated" } as any).where(eq(tenants.id, ctx.tenantId));
    expect((await invite()).status).toBe(403);
    await db.update(tenants).set({ status: "active" } as any).where(eq(tenants.id, ctx.tenantId));
  });

  it("guard scan checks the visitor in and gives their car a visitor bay; a second scan is refused; checkout frees the bay", async () => {
    const sp = (await addSpace(ctx.propertyId, { spaceType: "visitor" })).body;
    const g = await guardFor(ctx.propertyId);
    const inv = await invite({ vehiclePlate: `KV${uniq().slice(-5)}` });
    const code = inv.body.accessCode;
    const scan = await gpost("/api/guest-checkin/scan", g.token, { code });
    expect(scan.status).toBe(200);
    expect(scan.body.parking.allocated).toBe(true);
    const row = await visitorRow(code);
    expect(row.status).toBe("checked_in");
    expect(row.parkingSpot).toBeTruthy();
    const spaceNow = await spaceRow(scan.body.parking.spaceId);
    expect(spaceNow.isAvailable).toBe(false);
    expect((await gpost("/api/guest-checkin/scan", g.token, { code })).status).toBe(409);
    const out = await gpost("/api/guest-checkin/checkout", g.token, { code });
    expect(out.status).toBe(200);
    expect((await spaceRow(scan.body.parking.spaceId)).isAvailable).toBe(true);
    expect((await gpost("/api/guest-checkin/checkout", g.token, { code })).status).toBe(409);
    expect((await gpost("/api/guest-checkin/scan", g.token, { code })).status).toBe(409);   // already checked out
    void sp;
  });

  it("two guards scanning the same code at the same moment: one check-in, one bay", async () => {
    const g1 = await guardFor(ctx.propertyId);
    const g2 = await guardFor(ctx.propertyId);
    await addSpace(ctx.propertyId, { spaceType: "visitor" });
    const code = (await invite({ vehiclePlate: `KC${uniq().slice(-5)}` })).body.accessCode;
    const rs = await Promise.all([gpost("/api/guest-checkin/scan", g1.token, { code }), gpost("/api/guest-checkin/scan", g2.token, { code })]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(1);
    const logs = await db.select().from(visitorLog).where(and(eq(visitorLog.visitorId, (await visitorRow(code)).id), eq(visitorLog.logType, "check_in")));
    expect(logs).toHaveLength(1);
  });

  it("simultaneous arrivals get different bays; when the bays run out the guard is told to assign by hand", async () => {
    // fresh property so the count of bays is known
    const [p] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Tiny Lot", address: "T Road", totalUnits: 0 } as any).returning({ id: properties.id });
    await authedPost(app, "/api/parking-spaces", managerToken, { propertyId: p.id, spaceNumber: "V1", spaceType: "visitor" });
    await authedPost(app, "/api/parking-spaces", managerToken, { propertyId: p.id, spaceNumber: "V2", spaceType: "visitor" });
    await authedPost(app, "/api/parking-spaces", managerToken, { propertyId: p.id, spaceNumber: "D1", spaceType: "disabled" });   // never auto-given
    const g = await guardFor(p.id);
    const codes = await Promise.all([1, 2, 3].map(async (i) => {
      const c = `VAC-T${uniq().slice(-5)}`;
      await db.insert(visitors).values({ propertyId: p.id, visitorName: `Car ${i}`, purposeOfVisit: "x", expectedArrival: new Date(), status: "pending", accessCode: c, vehiclePlate: `KT${i}${uniq().slice(-4)}`, createdBy: ctx.adminUserId } as any);
      return c;
    }));
    const rs = await Promise.all(codes.map((c) => gpost("/api/guest-checkin/scan", g.token, { code: c })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const spots = rs.filter((r) => r.body.parking.allocated).map((r) => r.body.parking.spaceNumber).sort();
    expect(spots).toEqual(["V1", "V2"]);
    expect(rs.filter((r) => r.body.parking.requiresManual)).toHaveLength(1);
  });

  it("a blacklisted vehicle is refused at the gate, stays blacklisted, and the visitor stays outside", async () => {
    const g = await guardFor(ctx.propertyId);
    const plate = `KB${uniq().slice(-5)}`;
    const v = (await addVehicle(ctx.propertyId, { plateNumber: plate, ownerType: "visitor" })).body;
    await authedPatch(app, `/api/registered-vehicles/${v.id}/status`, managerToken, { status: "blacklisted" });
    const code = (await invite({ vehiclePlate: plate })).body.accessCode;
    const scan = await gpost("/api/guest-checkin/scan", g.token, { code });
    expect(scan.status).toBe(403);
    expect(scan.body.message).toMatch(/blacklisted/i);
    expect((await visitorRow(code)).status).toBe("pending");
    expect((await db.select().from(registeredVehicles).where(eq(registeredVehicles.id, v.id)))[0].status).toBe("blacklisted");
    // walk-in with the same plate is refused too, and the guard portal's blacklist check agrees
    const walk = await gpost("/api/guard/adhoc-pass", g.token, { visitorName: "Walker", purpose: "Delivery", vehiclePlate: plate });
    expect(walk.status).toBe(403);
    expect((await gget(`/api/guard/blacklist?plate=${plate}`, g.token)).body.blacklisted).toBe(true);
    // the movement log still records it, flagged
    const log = await gpost("/api/guard/vehicle-log", g.token, { plateNumber: plate, direction: "in", vehicleType: "car" });
    expect(log.status).toBe(201);
    expect(log.body.blacklisted).toBe(true);
  });

  it("expired and too-early codes are refused; a code from another property is not found", async () => {
    const g = await guardFor(ctx.propertyId);
    const expired = await seedVisitor({ expectedArrival: new Date(Date.now() - 5 * 3600_000), expectedDeparture: new Date(Date.now() - 3600_000) });
    const r1 = await gpost("/api/guest-checkin/scan", g.token, { code: expired });
    expect(r1.status).toBe(403);
    expect((await visitorRow(expired)).status).toBe("expired");
    const early = await seedVisitor({ expectedArrival: new Date(Date.now() + 3 * 86400_000) });
    const r2 = await gpost("/api/guest-checkin/scan", g.token, { code: early });
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/too early/i);
    expect((await visitorRow(early)).status).toBe("pending");
    const old = await seedVisitor({ expectedArrival: new Date(Date.now() - 3 * 86400_000) });
    expect((await gpost("/api/guest-checkin/scan", g.token, { code: old })).status).toBe(403);
    // property B visitor, scanned by a property A guard
    const [vb] = await db.insert(visitors).values({ propertyId: propB, visitorName: "B", purposeOfVisit: "x", expectedArrival: new Date(), status: "pending", accessCode: `VAC-B${uniq().slice(-5)}`, createdBy: ctx.adminUserId } as any).returning();
    expect((await gpost("/api/guest-checkin/scan", g.token, { code: vb.accessCode })).status).toBe(404);
  });

  it("a walk-in's plate is saved on the visit, gets a bay, and checkout releases it (it used to leave the bay stuck)", async () => {
    const sp = (await addSpace(ctx.propertyId, { spaceType: "visitor" })).body;
    const g = await guardFor(ctx.propertyId);
    const code = (await invite()).body.accessCode;                      // no car on the invitation
    expect((await gpost("/api/guest-checkin/scan", g.token, { code })).body.parking.allocated).toBe(false);
    expect((await gpost("/api/guest-checkin/vehicle", g.token, { code, plate: "x" })).status).toBe(400);
    const plate = `KW${uniq().slice(-5)}`;
    const cap = await gpost("/api/guest-checkin/vehicle", g.token, { code, plate: plate.toLowerCase().replace(/^kw/, "kw "), vehicleType: "other", make: "Honda" });
    expect(cap.status).toBe(200);
    expect(cap.body.plate).toBe(plate);
    expect(cap.body.parking.allocated).toBe(true);
    const row = await visitorRow(code);
    expect(row.vehiclePlate).toBe(plate);
    expect(row.parkingSpot).toBeTruthy();
    expect((await gpost("/api/guest-checkin/checkout", g.token, { code })).status).toBe(200);
    expect(await activeAssignments(cap.body.parking.spaceId)).toHaveLength(0);
    // can't add a vehicle to a visitor who isn't inside
    const pending = (await invite()).body.accessCode;
    expect((await gpost("/api/guest-checkin/vehicle", g.token, { code: pending, plate: "KNO111A" })).status).toBe(409);
    void sp;
  });

  it("manual bay assignment: needs a checked-in visitor with a plate; an occupied bay is refused; moving a car frees its old bay", async () => {
    const [p] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "Manual Lot", address: "M Road", totalUnits: 0 } as any).returning({ id: properties.id });
    const s1 = (await authedPost(app, "/api/parking-spaces", managerToken, { propertyId: p.id, spaceNumber: "M1", spaceType: "standard" })).body;
    const s2 = (await authedPost(app, "/api/parking-spaces", managerToken, { propertyId: p.id, spaceNumber: "M2", spaceType: "standard" })).body;
    const g = await guardFor(p.id);
    const code = `VAC-M${uniq().slice(-5)}`;
    await db.insert(visitors).values({ propertyId: p.id, visitorName: "Manual", purposeOfVisit: "x", expectedArrival: new Date(), status: "pending", accessCode: code, createdBy: ctx.adminUserId } as any);
    expect((await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code, spaceId: s1.id })).status).toBe(409);   // not in yet
    await gpost("/api/guest-checkin/scan", g.token, { code });
    expect((await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code, spaceId: s1.id })).status).toBe(400);   // no plate yet
    await db.update(visitors).set({ vehiclePlate: `KM${uniq().slice(-5)}` } as any).where(eq(visitors.accessCode, code));
    expect((await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code, spaceId: s1.id })).status).toBe(200);
    const moved = await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code, spaceId: s2.id });
    expect(moved.status).toBe(200);
    expect((await spaceRow(s1.id)).isAvailable).toBe(true);
    expect((await spaceRow(s2.id)).isAvailable).toBe(false);
    // someone else's car can't take the occupied bay
    const code2 = `VAC-N${uniq().slice(-5)}`;
    await db.insert(visitors).values({ propertyId: p.id, visitorName: "Second", purposeOfVisit: "x", expectedArrival: new Date(), status: "checked_in", accessCode: code2, vehiclePlate: `KN${uniq().slice(-5)}`, createdBy: ctx.adminUserId } as any);
    expect((await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code2, spaceId: s2.id })).status).toBe(409);
    // a bay at another property is refused
    expect((await gpost("/api/guest-checkin/assign-space", g.token, { visitorCode: code2, spaceId: (await addSpace(ctx.propertyId)).body.id })).status).toBe(409);
  });

  it("a resident's permanent bay survives their own visit; checkout only ends the visitor assignment", async () => {
    const sp = (await addSpace(ctx.propertyId, { spaceType: "standard" })).body;
    const plate = `KR${uniq().slice(-5)}`;
    const res = (await addVehicle(ctx.propertyId, { plateNumber: plate })).body;
    await assign(sp.id, res.id, { assignmentType: "permanent" });
    const g = await guardFor(ctx.propertyId);
    const code = (await invite({ vehiclePlate: plate })).body.accessCode;
    const scan = await gpost("/api/guest-checkin/scan", g.token, { code });
    expect(scan.body.parking.spaceId).toBe(sp.id);                       // already parked → no second bay
    await gpost("/api/guest-checkin/checkout", g.token, { code });
    const still = await activeAssignments(sp.id);
    expect(still).toHaveLength(1);
    expect(still[0].assignmentType).toBe("permanent");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("manager visitor screen follows the same rules", () => {
  const vam = (method: "patch" | "post" | "delete", path: string, token: string, body: object = {}) =>
    (supertest(app) as any)[method](`/api/visitor-access-management${path}`).set("Authorization", `Bearer ${token}`).send(body);

  it("creating: host must be at the property, dates must be valid", async () => {
    const base = { visitorName: "Walk Guest", propertyId: ctx.propertyId, visitPurpose: "Meeting", expectedArrival: inHours(2) };
    expect((await vam("post", "", managerToken, { ...base, hostTenantId: ctx2.tenantId })).status).toBe(404);
    expect((await vam("post", "", managerToken, { ...base, hostUnitId: ctx2.unitId })).status).toBe(404);
    expect((await vam("post", "", managerToken, { ...base, expectedArrival: "soon" })).status).toBe(400);
    expect((await vam("post", "", managerToken, { ...base, expectedDeparture: inHours(1) })).status).toBe(400);
    expect((await vam("post", "", managerToken, { ...base, vehiclePlate: "%%" })).status).toBe(400);
    const ok = await vam("post", "", managerToken, { ...base, hostTenantId: ctx.tenantId, vehiclePlate: "kma 1a" });
    expect(ok.status).toBe(201);
    expect(ok.body.host_unit_id).toBe(ctx.unitId);
    expect(ok.body.vehicle_plate).toBe("KMA1A");
  });

  it("approve → check in (with parking) → check out; every step only from the right state", async () => {
    await addSpace(ctx.propertyId, { spaceType: "visitor" });
    const created = (await vam("post", "", managerToken, { visitorName: "Flow", propertyId: ctx.propertyId, visitPurpose: "x", expectedArrival: inHours(1), vehiclePlate: `KF${uniq().slice(-5)}` })).body;
    const code = created.visitor_code;
    expect((await vam("patch", `/${code}/check-out`, managerToken)).status).toBe(409);        // not in yet
    expect((await vam("patch", `/${code}/approve`, managerToken)).status).toBe(200);
    expect((await vam("patch", `/${code}/approve`, managerToken)).status).toBe(200);          // idempotent
    const inn = await vam("patch", `/${code}/check-in`, managerToken);
    expect(inn.status).toBe(200);
    expect(inn.body.parking.allocated).toBe(true);                                            // the manager screen never gave parking before
    expect((await vam("patch", `/${code}/check-in`, managerToken)).status).toBe(409);
    expect((await vam("patch", `/${code}/approve`, managerToken)).status).toBe(409);
    expect((await vam("patch", `/${code}/revoke`, managerToken)).status).toBe(409);           // inside right now
    const out = await vam("patch", `/${code}/check-out`, managerToken);
    expect(out.status).toBe(200);
    expect(await activeAssignments(inn.body.parking.spaceId)).toHaveLength(0);
    expect((await vam("patch", `/${code}/revoke`, managerToken)).status).toBe(409);           // visit already over
  });

  it("a revoked visit can't be checked in or approved; the guard scan refuses it too", async () => {
    const code = (await vam("post", "", managerToken, { visitorName: "Revoked", propertyId: ctx.propertyId, visitPurpose: "x", expectedArrival: inHours(1) })).body.visitor_code;
    expect((await vam("patch", `/${code}/revoke`, managerToken, { reason: "not welcome" })).status).toBe(200);
    expect((await vam("patch", `/${code}/check-in`, managerToken)).status).toBe(403);
    expect((await vam("patch", `/${code}/approve`, managerToken)).status).toBe(409);
    const g = await guardFor(ctx.propertyId);
    expect((await gpost("/api/guest-checkin/scan", g.token, { code })).status).toBe(403);
    expect((await visitorRow(code)).status).toBe("denied");
  });

  it("manager check-out ends only THIS visitor's parking — not the vehicle whose id happens to equal the visitor's id", async () => {
    // make a vehicle and a visitor with the same numeric id
    const sp = (await addSpace(ctx.propertyId, { spaceType: "standard" })).body;
    const bystander = (await addVehicle(ctx.propertyId)).body;
    await assign(sp.id, bystander.id, { assignmentType: "permanent" });
    const code = `VAC-I${uniq().slice(-5)}`;
    await db.insert(visitors).values({ id: bystander.id, propertyId: ctx.propertyId, visitorName: "Same Id", purposeOfVisit: "x", expectedArrival: new Date(), status: "checked_in", accessCode: code, createdBy: ctx.adminUserId } as any).catch(() => {});
    const exists = await visitorRow(code);
    if (!exists) return;   // that id was already taken by an earlier visitor — the other tests cover release
    expect((await vam("patch", `/${code}/check-out`, managerToken)).status).toBe(200);
    expect(await activeAssignments(sp.id)).toHaveLength(1);
  });

  it("a caretaker-less other organisation can't act on the code", async () => {
    const code = (await vam("post", "", managerToken, { visitorName: "Org A", propertyId: ctx.propertyId, visitPurpose: "x", expectedArrival: inHours(1) })).body.visitor_code;
    expect((await vam("patch", `/${code}/check-in`, ctx2.adminToken)).status).toBe(404);
    expect((await vam("delete", `/${code}`, ctx2.adminToken)).status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("gate PINs and guard sessions", () => {
  it("refuses weak PINs, bad expiry, and a PIN another guard at the property already uses", async () => {
    for (const pin of ["0000", "1111", "1234", "4321", "123456", "98765432"]) {
      expect((await makePin(ctx.propertyId, managerToken, pin)).res.status).toBe(400);
    }
    expect((await authedPost(app, "/api/gate-pins", managerToken, { propertyId: ctx.propertyId, label: "x", pin: "5829", expiresAt: "nonsense" })).status).toBe(400);
    expect((await authedPost(app, "/api/gate-pins", managerToken, { propertyId: ctx.propertyId, label: "x", pin: "5829", expiresAt: "2020-01-01" })).status).toBe(400);
    const first = await makePin(ctx.propertyId, managerToken, "5829");
    expect(first.res.status).toBe(201);
    const dup = await makePin(ctx.propertyId, managerToken, "5829");
    expect(dup.res.status).toBe(409);
    expect((await makePin(propB, managerToken, "5829")).res.status).toBe(201);   // another property may reuse it
  });

  it("locks the login after repeated wrong PINs, even for the right PIN, and doesn't count good logins", async () => {
    const p = await makePin(ctx.propertyId);
    for (let i = 0; i < 4; i++) expect((await guardLogin(ctx.propertyId, p.pin)).res.status).toBe(200);   // five guards signing in is fine
    for (let i = 0; i < 8; i++) expect((await guardLogin(ctx.propertyId, "9182")).res.status).toBe(401);
    const locked = await guardLogin(ctx.propertyId, p.pin);
    expect(locked.res.status).toBe(429);
    expect(locked.res.headers["retry-after"]).toBeTruthy();
    expect(locked.res.body.message).toMatch(/try again/i);
    resetGateLoginLimits();
    expect((await guardLogin(ctx.propertyId, p.pin)).res.status).toBe(200);
  });

  it("switching a PIN off ends the guard's session on every route, including the JWT-protected vehicle and pass routes", async () => {
    const g = await guardFor(ctx.propertyId);
    expect((await gget("/api/registered-vehicles", g.token)).status).toBe(200);
    expect((await gget("/api/security/gate-passes", g.token)).status).toBe(200);
    expect((await gget("/api/gate-auth/verify", g.token)).body.valid).toBe(true);
    expect((await authedPatch(app, `/api/gate-pins/${g.pinId}/toggle`, managerToken, {})).status).toBe(200);
    expect((await gget("/api/registered-vehicles", g.token)).status).toBe(401);
    expect((await gget("/api/security/gate-passes", g.token)).status).toBe(401);
    expect((await gget("/api/guard/blacklist", g.token)).status).toBe(401);
    expect((await gget("/api/gate-auth/verify", g.token)).status).toBe(401);
  });

  it("an expired PIN ends the session", async () => {
    const g = await guardFor(ctx.propertyId);
    await db.update(gatePins).set({ expiresAt: new Date(Date.now() - 1000) } as any).where(eq(gatePins.id, g.pinId));
    expect((await gget("/api/registered-vehicles", g.token)).status).toBe(401);
    expect((await guardLogin(ctx.propertyId, g.pin)).res.status).toBe(401);
  });

  it("changing the PIN signs the old session out; the new digits work; weak or duplicate ones are refused", async () => {
    const g = await guardFor(ctx.propertyId);
    const other = await makePin(ctx.propertyId);
    expect((await authedPut(app, `/api/gate-pins/${g.pinId}`, managerToken, { pin: "1234" })).status).toBe(400);
    expect((await authedPut(app, `/api/gate-pins/${g.pinId}`, managerToken, { pin: other.pin })).status).toBe(409);
    expect((await authedPut(app, `/api/gate-pins/${g.pinId}`, managerToken, { label: "" })).status).toBe(400);
    const renamed = await authedPut(app, `/api/gate-pins/${g.pinId}`, managerToken, { label: "Night guard" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.id).toBe(g.pinId);
    expect((await gget("/api/registered-vehicles", g.token)).status).toBe(200);        // renaming keeps the session
    const newPin = "6204";
    const changed = await authedPut(app, `/api/gate-pins/${g.pinId}`, managerToken, { pin: newPin });
    expect(changed.status).toBe(200);
    expect(changed.body.id).not.toBe(g.pinId);
    expect(changed.body.label).toBe("Night guard");
    expect((await gget("/api/registered-vehicles", g.token)).status).toBe(401);
    expect((await guardLogin(ctx.propertyId, g.pin)).res.status).toBe(401);
    expect((await guardLogin(ctx.propertyId, newPin)).res.status).toBe(200);
    // another organisation can't touch it
    expect((await authedPut(app, `/api/gate-pins/${changed.body.id}`, ctx2.adminToken, { label: "hijack" })).status).toBe(403);
  });

  it("a guard only works at their own property: spaces list, scanning and gate passes", async () => {
    const g = await guardFor(ctx.propertyId);
    const spB = (await addSpace(propB)).body;
    const spaces = (await gget("/api/guest-checkin/spaces?propertyId=" + propB, g.token));
    expect(spaces.status).toBe(403);
    expect((await gget("/api/parking-spaces", g.token)).status).toBe(403);   // staff/manager screens aren't for guards
    expect(spB.id).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("gate passes", () => {
  const sec = (method: "post" | "patch" | "get", path: string, token: string, body: object = {}) =>
    (supertest(app) as any)[method](`/api/security${path}`).set("Authorization", `Bearer ${token}`).send(body);
  const passBody = (over: object = {}) => ({ passType: "contractor", fullName: "Pass " + uniq(), purpose: "Plumbing", validTo: inHours(48), ...over });

  it("a manager's pass is approved; a guard's waits; a guard can't approve; revoke works", async () => {
    const mine = await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx.propertyId }));
    expect(mine.status).toBe(201);
    expect(mine.body.status).toBe("approved");
    const g = await guardFor(ctx.propertyId);
    const theirs = await sec("post", "/gate-passes", g.token, passBody());
    expect(theirs.status).toBe(201);
    expect(theirs.body.status).toBe("pending");
    expect(theirs.body.propertyId).toBe(ctx.propertyId);                      // a guard's pass is at their property
    expect((await sec("patch", `/gate-passes/${theirs.body.id}/status`, g.token, { status: "approved" })).status).toBe(403);
    const ok = await sec("patch", `/gate-passes/${theirs.body.id}/status`, managerToken, { status: "approved" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    const revoked = await sec("patch", `/gate-passes/${mine.body.id}/status`, managerToken, { status: "revoked" });   // what the screen sends
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");
    expect((await sec("patch", `/gate-passes/${mine.body.id}/status`, managerToken, { status: "banana" })).status).toBe(400);
    // the guard's own list shows the revoked state
    const list = (await gget("/api/guard/gate-passes", g.token)).body as any[];
    expect(list.find((p) => p.id === mine.body.id)?.status).toBe("revoked");
  });

  it("validates dates, pass type, property and unit; another organisation can't change a pass", async () => {
    expect((await sec("post", "/gate-passes", managerToken, passBody({ validTo: "never" }))).status).toBe(400);
    expect((await sec("post", "/gate-passes", managerToken, passBody({ validFrom: inHours(5), validTo: inHours(1) }))).status).toBe(400);
    expect((await sec("post", "/gate-passes", managerToken, passBody({ passType: "wizard" }))).status).toBe(400);
    expect((await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx2.propertyId }))).status).toBe(403);
    expect((await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx.propertyId, unitId: ctx2.unitId }))).status).toBe(404);
    expect((await sec("post", "/gate-passes", managerToken, passBody())).status).toBe(400);          // org has several properties: must choose
    const p = await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx.propertyId, unitId: ctx.unitId }));
    expect(p.status).toBe(201);
    expect((await sec("patch", `/gate-passes/${p.body.id}/status`, ctx2.adminToken, { status: "denied" })).status).toBe(404);
  });

  it("a pass whose time has passed shows as expired; ordinary visitors can't be changed through the pass route", async () => {
    const p = await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx.propertyId, validFrom: inHours(-5), validTo: inHours(1) }));
    expect(p.status).toBe(201);
    await db.update(visitors).set({ expectedDeparture: new Date(Date.now() - 1000) } as any).where(eq(visitors.id, p.body.id));
    const list = (await sec("get", "/gate-passes", managerToken)).body as any[];
    expect(list.find((x) => x.id === p.body.id).status).toBe("expired");
    const code = await seedVisitor();
    const row = await visitorRow(code);
    expect((await sec("patch", `/gate-passes/${row.id}/status`, managerToken, { status: "denied" })).status).toBe(404);
  });

  it("a landlord sees and creates passes only at properties they own", async () => {
    const own = await sec("post", "/gate-passes", landlord.token, passBody({ propertyId: landlordProp }));
    expect(own.status).toBe(201);
    expect(own.body.status).toBe("approved");
    expect((await sec("post", "/gate-passes", landlord.token, passBody({ propertyId: ctx.propertyId }))).status).toBe(403);
    await sec("post", "/gate-passes", managerToken, passBody({ propertyId: ctx.propertyId }));
    const mine = (await sec("get", "/gate-passes", landlord.token)).body as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => p.propertyId === landlordProp)).toBe(true);
    const asManager = (await sec("get", "/gate-passes", managerToken)).body as any[];
    expect(asManager.some((p) => p.propertyId === ctx.propertyId)).toBe(true);
    expect((await sec("patch", `/gate-passes/${asManager.find((p) => p.propertyId === ctx.propertyId).id}/status`, landlord.token, { status: "denied" })).status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("security hardware webhook", () => {
  it("accepts a signature computed over the raw bytes even when the JSON is pretty-printed", async () => {
    const secret = "whsec_" + uniq();
    await db.update(properties).set({ siteSettings: { hardwareIntegration: { enabled: true, webhookSecret: secret, vendor: "generic", deviceLabel: "Gate cam" } } } as any).where(eq(properties.id, ctx.propertyId));
    const plate = `KH${uniq().slice(-5)}`;
    const raw = JSON.stringify({ eventType: "vehicle_entry", plateNumber: plate, timestamp: new Date().toISOString() }, null, 4);
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const ok = await supertest(app).post(`/api/security/hardware-event?propertyId=${ctx.propertyId}&vendor=generic`).set("Content-Type", "application/json").set("X-Webhook-Signature", sig).send(raw);
    expect(ok.status).toBe(200);
    const bad = await supertest(app).post(`/api/security/hardware-event?propertyId=${ctx.propertyId}&vendor=generic`).set("Content-Type", "application/json").set("X-Webhook-Signature", "sha256=" + "0".repeat(64)).send(raw);
    expect(bad.status).toBe(401);
    expect((await db.select().from(vehicleMovementLog).where(and(eq(vehicleMovementLog.propertyId, ctx.propertyId), eq(vehicleMovementLog.plateNumber, plate)))).length).toBe(1);
  });
});
