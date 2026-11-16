/**
 * plans-subscriptions.test.ts — plan catalogue, per-organisation and all-organisation subscription control, limit enforcement, import
 *
 * access        only the platform admin can read or change plans and subscriptions; an organisation's own admin cannot touch
 *               their plan, status or limits (not through /api/organizations either)
 * plans         create / edit / delete; the public list shows only active, public plans; a plan edit reaches every organisation on it
 * per-org       one organisation's limit override wins over its plan and leaves other organisations on that plan alone;
 *               "follow the plan" removes it; unlimited; moving plans resets overrides
 * all orgs      bulk changes by scope (all / a plan / chosen), dry run, and refusal of a single negotiated price for everyone
 * enforcement   property, unit (single and bulk, all-or-nothing), team-seat limits; expired trial and cancelled status stop creation
 * import        property/unit import respects the limits atomically and keeps unit counts true; tenant import occupies units, refuses
 *               occupied units and other organisations' emails; dry runs change nothing; rent import refuses another organisation's tenant ids
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, authedPut, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import { users, organizations, organizationSettings, auditLogs, staffMembers, subscriptionPlans, properties, units, tenants, rentPayments } from "@shared/schema";
import { eq, inArray, like, and } from "drizzle-orm";

let app: any;
let ctx: TestContext;
let ctx2: TestContext;       // a second organisation on the same plan
let pa: { id: string; token: string };
let managerToken: string;
let seq = 0;
const PLAN = `t${Date.now().toString(36)}`;   // plan ids created by this file all start with this

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number | null, role: string) {
  const email = `pl-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Pl", lastName: role, role, organizationId: orgId, emailVerified: true } as any);
  return { id, token: await login(email) };
}
const org = async (id: number) => (await db.select().from(organizations).where(eq(organizations.id, id)))[0];
const setOrg = (id: number, v: object) => db.update(organizations).set(v as any).where(eq(organizations.id, id));
const P = (path: string) => `/api/platform${path}`;
const put = (path: string, token: string, body: object) => supertest(app).put(path).set("Authorization", `Bearer ${token}`).send(body);
const del = (path: string, token: string) => supertest(app).delete(path).set("Authorization", `Bearer ${token}`);
const sub = (orgId: number, body: object) => authedPatch(app, P(`/organizations/${orgId}/subscription`), pa.token, body);
const newPlan = (over: object = {}) => authedPost(app, P("/plans"), pa.token, { id: `${PLAN}-${++seq}`, name: `Plan ${seq}`, priceKes: 1000, maxProperties: 2, maxUnits: null, maxUsers: 3, features: ["x"], ...over });
async function addProperty(token: string, name = `Bld ${++seq} ${randomUUID().slice(0, 4)}`) {
  return authedPost(app, "/api/property-setup", token, { property: { name, address: "Somewhere Rd" }, units: [{ unitNumber: "A1", monthlyRent: 10000 }] });
}
const unitsIn = (orgId: number) => db.select().from(units).where(eq(units.organizationId, orgId));
const propsIn = (orgId: number) => db.select().from(properties).where(eq(properties.organizationId, orgId));

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  ctx2 = await setupTestData();
  pa = await makeUser(null, "platform_admin");
  managerToken = (await makeUser(ctx.orgId, "manager")).token;
});

afterAll(async () => {
  await db.delete(subscriptionPlans).where(like(subscriptionPlans.id, `${PLAN}%`)).catch(() => {});
  await db.delete(rentPayments).where(inArray(rentPayments.tenantId, (await db.select({ id: tenants.id }).from(tenants).where(inArray(tenants.organizationId, [ctx.orgId, ctx2.orgId]))).map((t) => t.id).concat([-1]))).catch(() => {});
  // the audited routes and the settings upsert leave rows that block deleting the organisations
  const orgIds = [ctx.orgId, ctx2.orgId];
  const ids = (await db.select({ id: users.id }).from(users).where(inArray(users.organizationId, orgIds))).map((u) => u.id).concat([pa.id]);
  await db.delete(auditLogs).where(inArray(auditLogs.userId, ids)).catch(() => {});
  await db.delete(staffMembers).where(inArray(staffMembers.organization_id, orgIds)).catch(() => {});
  await db.delete(organizationSettings).where(inArray(organizationSettings.organizationId, orgIds)).catch(() => {});
  await db.delete(users).where(eq(users.id, pa.id)).catch(() => {});
  await cleanupTestData(ctx);
  await cleanupTestData(ctx2);
});

describe("access", () => {
  it("only the platform admin can use the plan and subscription routes", async () => {
    for (const token of [ctx.adminToken, managerToken, ctx.tenantToken]) {
      expect((await authedGet(app, P("/plans"), token)).status).toBe(403);
      expect((await authedPost(app, P("/plans"), token, { name: "Hack", priceKes: 1, maxProperties: 1, maxUnits: 1, maxUsers: 1 })).status).toBe(403);
      expect((await authedGet(app, P(`/organizations/${ctx.orgId}/subscription`), token)).status).toBe(403);
      expect((await authedPatch(app, P(`/organizations/${ctx.orgId}/subscription`), token, { status: "active" })).status).toBe(403);
      expect((await authedPost(app, P("/subscriptions/bulk"), token, { scope: { type: "all" }, apply: { status: "active" } })).status).toBe(403);
    }
    expect((await authedGet(app, P("/plans"), pa.token)).status).toBe(200);
  });

  it("an organisation's own admin cannot change plan, status or limits through the organisation settings", async () => {
    await setOrg(ctx.orgId, { subscriptionPlan: "starter", subscriptionStatus: "trial", maxProperties: 5, maxUsers: 5, limitOverrides: null });
    const r = await authedPost(app, "/api/organizations", ctx.adminToken, { organizationName: "Renamed Org", subscriptionPlan: "enterprise", maxProperties: 999, maxUsers: 999, subscriptionStatus: "active" });
    expect(r.status).toBe(200);
    const o = await org(ctx.orgId);
    expect(o.subscriptionPlan).toBe("starter");
    expect(o.subscriptionStatus).toBe("trial");
    expect(o.maxProperties).toBe(5);
    const b = await authedPatch(app, "/api/organizations/branding", ctx.adminToken, { primaryColor: "#112233", maxProperties: 999, limitOverrides: { maxProperties: null } } as any);
    expect(b.status).toBe(200);
    expect((await org(ctx.orgId)).limitOverrides).toBeNull();
  });
});

describe("plans", () => {
  it("creates, validates, edits and deletes a plan", async () => {
    const bad = await authedPost(app, P("/plans"), pa.token, { name: "x", priceKes: -1, maxProperties: 1, maxUnits: null, maxUsers: null });
    expect(bad.status).toBe(400);
    const made = await newPlan({ id: `${PLAN}-crud`, name: "CRUD plan", priceKes: 4200, maxProperties: 7, maxUnits: 50, maxUsers: 9, features: ["One", "Two"] });
    expect(made.status).toBe(201);
    expect((await newPlan({ id: `${PLAN}-crud` })).status).toBe(409);
    const edit = await put(P(`/plans/${PLAN}-crud`), pa.token, { priceKes: 4500, maxUnits: null });
    expect(edit.status).toBe(200);
    const list = (await authedGet(app, P("/plans"), pa.token)).body.plans.find((p: any) => p.id === `${PLAN}-crud`);
    expect(list).toMatchObject({ name: "CRUD plan", priceKes: 4500, maxProperties: 7, maxUnits: null, maxUsers: 9, organizationCount: 0 });
    expect((await put(P(`/plans/${PLAN}-nope`), pa.token, { priceKes: 1 })).status).toBe(404);
    expect((await del(P(`/plans/${PLAN}-crud`), pa.token)).status).toBe(200);
    expect((await del(P(`/plans/${PLAN}-crud`), pa.token)).status).toBe(404);
  });

  it("the public list shows only active, public plans", async () => {
    await newPlan({ id: `${PLAN}-vis`, name: "Visible" });
    await newPlan({ id: `${PLAN}-hid`, name: "Hidden", isPublic: false });
    await newPlan({ id: `${PLAN}-off`, name: "Off", isActive: false });
    const ids = (await supertest(app).get("/api/billing/plans")).body.map((p: any) => p.id);
    expect(ids).toContain(`${PLAN}-vis`);
    expect(ids).not.toContain(`${PLAN}-hid`);
    expect(ids).not.toContain(`${PLAN}-off`);
    expect(ids).toContain("starter");
  });

  it("a plan in use cannot be deleted", async () => {
    await newPlan({ id: `${PLAN}-used` });
    await sub(ctx.orgId, { plan: `${PLAN}-used` });
    const r = await del(P(`/plans/${PLAN}-used`), pa.token);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PLAN_IN_USE");
    await sub(ctx.orgId, { plan: "starter" });
  });
});

describe("one organisation vs all organisations", () => {
  const planId = `${PLAN}-shared`;
  beforeAll(async () => {
    await newPlan({ id: planId, name: "Shared", maxProperties: 1, maxUnits: null, maxUsers: 10 });
    await sub(ctx.orgId, { plan: planId, status: "active" });
    await sub(ctx2.orgId, { plan: planId, status: "active" });
  });

  it("limits follow the plan, and a plan edit reaches every organisation on it", async () => {
    expect((await sub(ctx.orgId, {})).status).toBe(200);
    let d = (await authedGet(app, P(`/organizations/${ctx.orgId}/subscription`), pa.token)).body;
    expect(d.limits.maxProperties).toBe(1);
    expect(d.limitSources.maxProperties).toBe("plan");
    await put(P(`/plans/${planId}`), pa.token, { maxProperties: 3 });
    for (const c of [ctx, ctx2]) {
      d = (await authedGet(app, P(`/organizations/${c.orgId}/subscription`), pa.token)).body;
      expect(d.limits.maxProperties).toBe(3);
      expect((await org(c.orgId)).maxProperties).toBe(3);   // the stored copy is kept in step
    }
    await put(P(`/plans/${planId}`), pa.token, { maxProperties: 1 });
  });

  it("an override changes one organisation only, and 'plan' hands it back to the plan", async () => {
    const r = await sub(ctx.orgId, { limits: { maxProperties: { mode: "custom", value: 4 } } });
    expect(r.status).toBe(200);
    expect(r.body.limits.maxProperties).toBe(4);
    expect(r.body.limitSources.maxProperties).toBe("override");
    expect((await authedGet(app, P(`/organizations/${ctx2.orgId}/subscription`), pa.token)).body.limits.maxProperties).toBe(1);
    // a later plan edit does not move the overridden organisation
    await put(P(`/plans/${planId}`), pa.token, { maxProperties: 2 });
    expect((await authedGet(app, P(`/organizations/${ctx.orgId}/subscription`), pa.token)).body.limits.maxProperties).toBe(4);
    expect((await authedGet(app, P(`/organizations/${ctx2.orgId}/subscription`), pa.token)).body.limits.maxProperties).toBe(2);
    const back = await sub(ctx.orgId, { limits: { maxProperties: { mode: "plan" } } });
    expect(back.body.limits.maxProperties).toBe(2);
    expect((await org(ctx.orgId)).limitOverrides).toBeNull();
    await put(P(`/plans/${planId}`), pa.token, { maxProperties: 1 });
  });

  it("unlimited, a negotiated price, notes, and the dates are saved; moving plans clears the overrides", async () => {
    const r = await sub(ctx.orgId, { limits: { maxUsers: { mode: "unlimited" } }, customPriceKes: 3000, notes: "Agreed on the phone", currentPeriodEnd: "2031-01-31" });
    expect(r.body.limits.maxUsers).toBeNull();
    expect(r.body.customPriceKes).toBe(3000);
    expect(r.body.priceKes).toBe(3000);
    expect(r.body.notes).toBe("Agreed on the phone");
    expect(new Date(r.body.currentPeriodEnd).getUTCFullYear()).toBe(2031);
    const moved = await sub(ctx.orgId, { plan: "growth" });
    expect(moved.body.limitSources.maxUsers).toBe("plan");
    expect(moved.body.limits.maxUsers).toBe(20);
    expect((await sub(ctx.orgId, { plan: "no-such-plan" })).status).toBe(400);
    await sub(ctx.orgId, { plan: planId, customPriceKes: null, currentPeriodEnd: null });
  });

  it("bulk: dry run changes nothing; a plan scope only touches that plan; 'all' reaches every active organisation", async () => {
    const dry = await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "plan", planId }, apply: { limits: { maxUnits: { mode: "custom", value: 11 } } }, dryRun: true });
    expect(dry.body).toMatchObject({ dryRun: true });
    expect(dry.body.matched).toBeGreaterThanOrEqual(2);
    expect((await org(ctx.orgId)).limitOverrides).toBeNull();

    const r = await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "plan", planId }, apply: { limits: { maxUnits: { mode: "custom", value: 11 } } } });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBeGreaterThanOrEqual(2);
    for (const c of [ctx, ctx2]) expect((await org(c.orgId)).limitOverrides).toEqual({ maxUnits: 11 });

    // an organisation on another plan is untouched by a plan-scoped change
    await sub(ctx2.orgId, { plan: "starter" });
    await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "plan", planId }, apply: { status: "past_due" } });
    expect((await org(ctx.orgId)).subscriptionStatus).toBe("past_due");
    expect((await org(ctx2.orgId)).subscriptionStatus).toBe("active");

    const all = await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "organizations", ids: [ctx.orgId, ctx2.orgId] }, apply: { extendTrialDays: 10 } });
    expect(all.body.updated).toBe(2);
    expect((await org(ctx2.orgId)).subscriptionStatus).toBe("trial");   // extending a trial puts it on trial
    expect((await org(ctx2.orgId)).trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 86_400_000);

    expect((await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "all" }, apply: { customPriceKes: 100 } })).status).toBe(400);
    expect((await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "all" }, apply: {} })).status).toBe(400);
    expect((await authedPost(app, P("/subscriptions/bulk"), pa.token, { scope: { type: "all" }, apply: { plan: "nope" } })).status).toBe(400);
    await sub(ctx.orgId, { limits: { maxUnits: { mode: "plan" } }, status: "active", trialEndsAt: null });
    await sub(ctx2.orgId, { limits: { maxUnits: { mode: "plan" } }, status: "active", trialEndsAt: null });
  });
});

describe("enforcement", () => {
  const planId = `${PLAN}-limits`;
  beforeAll(async () => {
    await newPlan({ id: planId, name: "Tight", maxProperties: 2, maxUnits: 4, maxUsers: 3 });
    await sub(ctx.orgId, { plan: planId, status: "active", trialEndsAt: null, currentPeriodEnd: null, limits: { maxProperties: { mode: "plan" }, maxUnits: { mode: "plan" }, maxUsers: { mode: "plan" } } });
    await db.delete(units).where(eq(units.organizationId, ctx.orgId));
    await db.delete(tenants).where(eq(tenants.organizationId, ctx.orgId));
    await db.delete(properties).where(eq(properties.organizationId, ctx.orgId));
  });

  it("property limit: the third property is refused with a clear message, and an override lifts it", async () => {
    expect((await addProperty(ctx.adminToken)).status).toBe(201);
    expect((await addProperty(ctx.adminToken)).status).toBe(201);
    const blocked = await addProperty(ctx.adminToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "PROPERTY_LIMIT_REACHED", current: 2, max: 2 });
    expect(blocked.body.message).toMatch(/Tight plan allows a maximum of 2 properties/);
    expect((await propsIn(ctx.orgId)).length).toBe(2);
    await sub(ctx.orgId, { limits: { maxProperties: { mode: "custom", value: 3 } } });
    expect((await addProperty(ctx.adminToken)).status).toBe(201);
    expect((await addProperty(ctx.adminToken)).status).toBe(403);
    await sub(ctx.orgId, { limits: { maxProperties: { mode: "unlimited" } } });
    expect((await addProperty(ctx.adminToken)).status).toBe(201);
  });

  it("unit limit: a bulk set that does not fit creates nothing; the room left is reported", async () => {
    // 4 properties × 1 unit = 4 units so far (limit 4)
    expect((await unitsIn(ctx.orgId)).length).toBe(4);
    const full = await authedPost(app, "/api/property-setup", ctx.adminToken, { property: { name: `Over ${randomUUID().slice(0, 4)}`, address: "x" }, units: [{ unitNumber: "1", monthlyRent: 1000 }] });
    expect(full.status).toBe(403);
    expect(full.body.code).toBe("UNIT_LIMIT_REACHED");
    await sub(ctx.orgId, { limits: { maxUnits: { mode: "custom", value: 6 } } });
    const name = `Big ${randomUUID().slice(0, 4)}`;
    const tooMany = await authedPost(app, "/api/property-setup", ctx.adminToken, { property: { name, address: "x" }, units: [1, 2, 3].map((n) => ({ unitNumber: String(n), monthlyRent: 1000 })) });
    expect(tooMany.status).toBe(403);
    expect(tooMany.body).toMatchObject({ code: "UNIT_LIMIT_REACHED", current: 4, max: 6, adding: 3 });
    expect(tooMany.body.message).toMatch(/room for 2/);
    expect((await propsIn(ctx.orgId)).some((p) => p.name === name)).toBe(false);   // nothing half-created
    const fits = await authedPost(app, "/api/property-setup", ctx.adminToken, { property: { name, address: "x" }, units: [1, 2].map((n) => ({ unitNumber: String(n), monthlyRent: 1000 })) });
    expect(fits.status).toBe(201);
    expect((await unitsIn(ctx.orgId)).length).toBe(6);
    await sub(ctx.orgId, { limits: { maxUnits: { mode: "unlimited" } } });
  });

  it("single unit creation (the units API) is held to the unit limit", async () => {
    await sub(ctx.orgId, { limits: { maxUnits: { mode: "custom", value: 6 } } });
    const [p] = await propsIn(ctx.orgId);
    const r = await authedPost(app, "/api/units", ctx.adminToken, { propertyId: p.id, unitNumber: "ZZ9", unitType: "apartment", monthlyRent: "1000", bathrooms: "1" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("UNIT_LIMIT_REACHED");
    await sub(ctx.orgId, { limits: { maxUnits: { mode: "unlimited" } } });
  });

  it("team-seat limit applies to new users and to staff who get a login", async () => {
    await sub(ctx.orgId, { limits: { maxUsers: { mode: "custom", value: 2 } } });
    // admin + manager already use the 2 seats
    const u = await authedPost(app, "/api/users", ctx.adminToken, { email: `seat-${randomUUID().slice(0, 5)}@smartprop-test.local`, firstName: "S", lastName: "S", role: "staff" });
    expect(u.status).toBe(403);
    expect(u.body.code).toBe("USER_LIMIT_REACHED");
    const staff = await authedPost(app, "/api/staff-members", ctx.adminToken, {
      employee_id: `E${seq++}`, first_name: "Staff", last_name: "Mem", email: `staff-${randomUUID().slice(0, 5)}@smartprop-test.local`,
      position: "janitor", department: "maintenance", employment_type: "contract", hire_date: "2026-01-01",
    });
    expect(staff.status).toBe(403);
    expect(staff.body.code).toBe("USER_LIMIT_REACHED");
    const noLogin = await authedPost(app, "/api/staff-members", ctx.adminToken, {
      employee_id: `E${seq++}`, first_name: "No", last_name: "Login", position: "janitor", department: "maintenance", employment_type: "contract", hire_date: "2026-01-01",
    });
    expect(noLogin.status).toBe(201);   // an HR record with no email has no login, so no seat
    await sub(ctx.orgId, { limits: { maxUsers: { mode: "unlimited" } } });
  });

  it("an ended trial, an ended paid period, and a cancelled subscription stop new properties; renewing restores them", async () => {
    await sub(ctx.orgId, { limits: { maxProperties: { mode: "unlimited" }, maxUnits: { mode: "unlimited" } } });
    await sub(ctx.orgId, { status: "trial", trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() });
    let r = await addProperty(ctx.adminToken);
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("SUBSCRIPTION_INACTIVE");
    expect(r.body.message).toMatch(/trial has ended/);
    expect((await authedGet(app, "/api/billing/status", ctx.adminToken)).body.subscriptionStatus).toBe("expired");
    await sub(ctx.orgId, { extendTrialDays: 5 });
    expect((await addProperty(ctx.adminToken)).status).toBe(201);

    await sub(ctx.orgId, { status: "active", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() - 86_400_000).toISOString() });
    r = await addProperty(ctx.adminToken);
    expect(r.status).toBe(402);
    expect(r.body.message).toMatch(/period has ended/);
    await sub(ctx.orgId, { currentPeriodEnd: null, status: "cancelled" });
    expect((await addProperty(ctx.adminToken)).status).toBe(402);
    await sub(ctx.orgId, { status: "active" });
    expect((await addProperty(ctx.adminToken)).status).toBe(201);
  });

  it("billing status reports the effective limits and what is used (null = unlimited)", async () => {
    await sub(ctx.orgId, { limits: { maxProperties: { mode: "custom", value: 40 }, maxUnits: { mode: "unlimited" }, maxUsers: { mode: "plan" } }, customPriceKes: 3500 });
    const s = (await authedGet(app, "/api/billing/status", ctx.adminToken)).body;
    expect(s).toMatchObject({ subscriptionPlan: planId, subscriptionStatus: "active", maxProperties: 40, maxUnits: null, maxUsers: 3, priceKes: 3500, customPrice: true });
    expect(s.usage.properties).toBe((await propsIn(ctx.orgId)).length);
    expect(s.usage.units).toBe((await unitsIn(ctx.orgId)).length);
    expect(s.usage.users).toBeGreaterThanOrEqual(2);
    // another organisation's admin sees only their own
    const s2 = (await authedGet(app, "/api/billing/status", ctx2.adminToken)).body;
    expect(s2.customPrice).toBe(false);
  });

  it("the platform organisation list shows the limits each organisation is actually held to", async () => {
    const row = (await authedGet(app, P("/organizations"), pa.token)).body.find((o: any) => o.id === ctx.orgId);
    expect(row).toMatchObject({ maxProperties: 40, maxUnits: null, maxUsers: 3, hasCustomTerms: true });
    expect(row.unitCount).toBe((await unitsIn(ctx.orgId)).length);
  });
});

describe("import", () => {
  const planId = `${PLAN}-import`;
  beforeAll(async () => {
    await newPlan({ id: planId, name: "Import plan", maxProperties: 2, maxUnits: 5, maxUsers: 10 });
    await sub(ctx2.orgId, { plan: planId, status: "active", trialEndsAt: null, currentPeriodEnd: null, limits: { maxProperties: { mode: "plan" }, maxUnits: { mode: "plan" }, maxUsers: { mode: "plan" } } });
    await db.delete(units).where(eq(units.organizationId, ctx2.orgId));
    await db.delete(tenants).where(eq(tenants.organizationId, ctx2.orgId));
    await db.delete(properties).where(eq(properties.organizationId, ctx2.orgId));
  });
  const imp = (path: string, body: object) => authedPost(app, `/api/import${path}`, ctx2.adminToken, body);
  const rows = (n: number, prop = "Imp Heights", start = 1) => Array.from({ length: n }, (_, i) => ({ property_name: prop, unit_number: `U${start + i}`, monthly_rent: "20000", address: "Road 1" }));

  it("a dry run reports what would be created and saves nothing", async () => {
    const r = await imp("/properties", { rows: rows(3), dryRun: true });
    expect(r.body).toMatchObject({ dryRun: true, wouldCreateProperties: 1, wouldCreateUnits: 3, limitError: null });
    expect((await unitsIn(ctx2.orgId)).length).toBe(0);
  });

  it("imports properties and units, keeps the unit count true, and skips units that already exist", async () => {
    const r = await imp("/properties", { rows: rows(3) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ importedProperties: 1, importedUnits: 3 });
    const [p] = await propsIn(ctx2.orgId);
    expect(p.totalUnits).toBe(3);
    const again = await imp("/properties", { rows: [...rows(3), ...rows(1, "Imp Heights", 4)] });
    expect(again.body).toMatchObject({ importedProperties: 0, importedUnits: 1, skippedUnits: 3 });
    expect((await propsIn(ctx2.orgId))[0].totalUnits).toBe(4);
    const dup = await imp("/properties", { rows: [rows(1, "Dup Plaza")[0], rows(1, "Dup Plaza")[0]], dryRun: true });
    expect(dup.body.wouldCreateUnits).toBe(1);
    expect(dup.body.errors.join(" ")).toMatch(/listed twice/);
  });

  it("a file that would pass the unit limit is refused whole; the dry run says why", async () => {
    // 4 units now, limit 5; this file adds 3
    const dry = await imp("/properties", { rows: rows(3, "Second Block"), dryRun: true });
    expect(dry.body.limitError).toMatchObject({ code: "UNIT_LIMIT_REACHED", max: 5, current: 4 });
    const r = await imp("/properties", { rows: rows(3, "Second Block") });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "UNIT_LIMIT_REACHED", nothingImported: true });
    expect((await propsIn(ctx2.orgId)).map((p) => p.name)).not.toContain("Second Block");
    expect((await unitsIn(ctx2.orgId)).length).toBe(4);
  });

  it("a file that would pass the property limit is refused whole", async () => {
    await sub(ctx2.orgId, { limits: { maxUnits: { mode: "unlimited" } } });
    const r = await imp("/properties", { rows: [...rows(1, "Block A"), ...rows(1, "Block B")] });   // 1 existing + 2 new = 3 > 2
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("PROPERTY_LIMIT_REACHED");
    expect((await propsIn(ctx2.orgId)).length).toBe(1);
  });

  it("tenant import puts tenants on vacant units, refuses occupied units and other organisations' emails, and a dry run changes nothing", async () => {
    const [p] = await propsIn(ctx2.orgId);
    const foreign = ctx.tenantToken ? (await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.tenantUserId)))[0].email : "";
    const base = `imp-${randomUUID().slice(0, 5)}`;
    const body = {
      propertyId: p.id,
      tenants: [
        { first_name: "Ann", last_name: "One", email: `${base}-1@smartprop-test.local`, unit_number: "U1", monthly_rent: "20000", phone: "0711000001" },
        { first_name: "Bob", last_name: "Two", email: `${base}-2@smartprop-test.local`, unit_number: "U1" },          // same unit, same file
        { first_name: "Cy", last_name: "Three", email: foreign, unit_number: "U2" },                                    // belongs to another organisation
        { first_name: "Di", last_name: "Four", email: `${base}-4@smartprop-test.local`, unit_number: "NOPE" },          // no such unit
        { first_name: "Ed", last_name: "Five", email: `${base}-5@smartprop-test.local` },                               // no unit is fine
        { first_name: "Ann", last_name: "Dup", email: `${base}-1@smartprop-test.local` },                               // email twice
      ],
    };
    const dry = await imp("/bulk", { ...body, dryRun: true });
    expect(dry.body).toMatchObject({ dryRun: true, wouldImport: 3, imported: 0 });   // Ann, Cy (until the real run finds the conflict), Ed
    expect((await db.select().from(tenants).where(eq(tenants.organizationId, ctx2.orgId))).length).toBe(0);

    const r = await imp("/bulk", body);
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(2);   // Ann and Ed; Cy fails on the other organisation's email
    expect(r.body.errors.join("\n")).toMatch(/another tenant earlier in this file/);
    expect(r.body.errors.join("\n")).toMatch(/unit "NOPE" was not found/);
    expect(r.body.errors.join("\n")).toMatch(/appears twice/);
    expect(r.body.errors.join("\n")).toMatch(new RegExp(`${foreign.replace(/[.+]/g, "\\$&")}.*another organisation`));
    const ts = await db.select().from(tenants).where(eq(tenants.organizationId, ctx2.orgId));
    expect(ts.map((t) => t.email).sort()).toEqual([`${base}-1@smartprop-test.local`, `${base}-5@smartprop-test.local`]);
    const ann = ts.find((t) => t.email.endsWith("-1@smartprop-test.local"))!;
    const [u1] = await db.select().from(units).where(and(eq(units.propertyId, p.id), eq(units.unitNumber, "U1")));
    expect(ann.unitId).toBe(u1.id);
    expect(u1.isOccupied).toBe(true);
    // each tenant has an organisation-scoped pending login that can be invited
    const [login] = await db.select().from(users).where(eq(users.id, ann.userId));
    expect(login).toMatchObject({ organizationId: ctx2.orgId, role: "tenant" });

    // now that unit is taken, importing another tenant onto it is refused
    const again = await imp("/bulk", { propertyId: p.id, tenants: [{ first_name: "Fay", last_name: "Six", email: `${base}-6@smartprop-test.local`, unit_number: "U1" }] });
    expect(again.body.imported).toBe(0);
    expect(again.body.errors.join("\n")).toMatch(/already occupied/);
    // and re-running the same file does not duplicate
    const rerun = await imp("/bulk", body);
    expect(rerun.body.imported).toBe(0);
  });

  it("tenant import refuses a property from another organisation", async () => {
    const [foreignProp] = await propsIn(ctx.orgId);
    const r = await imp("/bulk", { propertyId: foreignProp.id, tenants: [{ first_name: "X", last_name: "Y", email: `x-${randomUUID().slice(0, 5)}@smartprop-test.local`, unit_number: "A1" }] });
    expect(r.status).toBe(400);
  });

  it("rent-payment import refuses a tenant id from another organisation", async () => {
    const [mine] = await db.select().from(tenants).where(eq(tenants.organizationId, ctx2.orgId));
    const ok = await imp("/rent-payments", { rows: [{ tenant_id: String(mine.id), amount: "20000", due_date: "2026-01-01", paid_date: "2026-01-02" }] });
    expect(ok.body.imported).toBe(1);
    const bad = await imp("/rent-payments", { rows: [{ tenant_id: String(ctx.tenantId), amount: "20000", due_date: "2026-01-01" }] });
    expect(bad.body.imported).toBe(0);
    expect(bad.body.errors.join(" ")).toMatch(/tenant not found/);
    expect((await db.select().from(rentPayments).where(eq(rentPayments.tenantId, ctx.tenantId))).length).toBe(0);
    const dry = await imp("/rent-payments", { rows: [{ tenant_id: String(mine.id), amount: "20000", due_date: "2026-02-01" }], dryRun: true });
    expect(dry.body).toMatchObject({ dryRun: true, wouldImport: 1, imported: 0 });
    expect((await db.select().from(rentPayments).where(eq(rentPayments.tenantId, mine.id))).length).toBe(1);
  });
});
