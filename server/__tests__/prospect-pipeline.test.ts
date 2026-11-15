/**
 * prospect-pipeline.test.ts — prospect → viewing → application → references → approval → lease offer → tenant.
 *
 *   public form   mounted (it used to answer 401), validated, de-duplicated, honeypot, org/unit checks, never picks its own stage
 *   input         whitelisted fields only (no setting status / organisation), real emails/phones/dates/money, org-scoped property+unit
 *   stages        each step only from the stage before it; rejected/converted prospects are closed; reopen restarts the decision
 *   units         approving reserves the unit: occupied, held by a tenant, or reserved for someone else are all refused
 *   convert       one transaction → pending tenant + invite + draft lease + deposit + unit held + prospect closed; never onto
 *                 another organisation's / another role's account; refuses a second conversion, even in parallel
 *   leases        activating the lease starts the tenancy; cancelling it undoes the placement and returns the prospect to approved
 *   isolation     other organisations and non-staff roles see nothing
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { getApp, setupTestData, cleanupTestData, authedPost, authedGet, authedPatch, TEST_PASSWORD, type TestContext } from "./helpers";
import { db } from "../db";
import { users, units, tenants, properties, leases, leaseEvents, depositTransactions, prospects } from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import { todayEAT } from "../services/rent-ledger";
import { addDays } from "../services/lease-lifecycle";

let app: any;
let ctx: TestContext;
let other: TestContext;
let staffToken: string;
let landlordToken: string;
const today = todayEAT();
const START = addDays(today, 7);
const END = addDays(today, 7 + 364);
let seq = 0;

async function login(email: string) {
  const r = await supertest(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  if (!r.body.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}
async function makeUser(orgId: number, role: string) {
  const email = `pp-${role}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
  const id = randomUUID();
  await db.insert(users).values({ id, email, passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), firstName: "Pp", lastName: role, role, organizationId: orgId, emailVerified: true } as any);
  return { id, email, token: await login(email) };
}
async function newUnit(c = ctx, o: { occupied?: boolean; rent?: string; propertyId?: number } = {}) {
  const n = ++seq;
  const [u] = await db.insert(units).values({ organizationId: c.orgId, propertyId: o.propertyId ?? c.propertyId, unitNumber: `PP-${n}-${Date.now() % 100000}`, monthlyRent: o.rent ?? "35000", currency: "KES", isOccupied: !!o.occupied, unitType: "apartment" } as any).returning();
  return u.id as number;
}
const mail = () => `pp-${++seq}-${randomUUID().slice(0, 6)}@smartprop-test.local`;
let nidSeq = 0;
const nid = () => String(20000000 + (Date.now() % 1000) * 100000 + (++nidSeq));   // unique per call; never collides
const P = (id: number, ep: string, b: object = {}, token = ctx.adminToken) => authedPost(app, `/api/prospects/${id}/${ep}`, token, b);
const row = async (id: number) => (await db.select().from(prospects).where(eq(prospects.id, id)))[0];
const unitRow = async (id: number) => (await db.select().from(units).where(eq(units.id, id)))[0];

/** A prospect, moved as far as `to` (the public stages in order). */
async function prospect(to: "new" | "viewed" | "application_submitted" | "reference_checked" | "approved" | "lease_offered" = "new", o: { unitId?: number | null; email?: string; token?: string; rent?: number; extra?: object } = {}) {
  const unitId = o.unitId === undefined ? await newUnit() : o.unitId;
  const r = await authedPost(app, "/api/prospects", o.token ?? ctx.adminToken, {
    firstName: "Pp", lastName: `P${++seq}`, email: o.email ?? mail(), phone: "0712345678", nationalId: nid(), unitId, ...(o.extra ?? {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.id as number;
  const steps: Array<[string, object]> = [
    ["schedule-viewing", { viewingDate: new Date(Date.now() + 86_400_000).toISOString() }],
    ["mark-viewed", { notes: "liked it" }],
    ["submit-application", {}],
    ["check-references", { notes: "Employer and previous landlord both positive" }],
    ["approve", o.rent ? { offeredRent: o.rent } : {}],
    ["offer-lease", {}],
  ];
  const stop = ["new", "viewing_scheduled", "viewed", "application_submitted", "reference_checked", "approved", "lease_offered"].indexOf(to);
  if (to === "viewed") { /* schedule + mark-viewed */ }
  for (let i = 0; i < Math.min(stop, steps.length); i++) {
    const res = await P(id, steps[i][0], steps[i][1], o.token ?? ctx.adminToken);
    expect(res.status, `${steps[i][0]}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  return { id, unitId: unitId as number };
}
const convertBody = (extra: object = {}) => ({ leaseStartDate: START, leaseEndDate: END, securityDeposit: 70000, ...extra });
const convert = (id: number, extra: object = {}, token = ctx.adminToken) => P(id, "convert", convertBody(extra), token);

beforeAll(async () => {
  app = await getApp();
  ctx = await setupTestData();
  other = await setupTestData();
  staffToken = (await makeUser(ctx.orgId, "staff")).token;
  landlordToken = (await makeUser(ctx.orgId, "landlord")).token;
});

afterAll(async () => {
  for (const c of [ctx, other]) {
    await db.update(prospects).set({ convertedToTenantId: null } as any).where(eq(prospects.organizationId, c.orgId)).catch(() => {});
    await db.delete(prospects).where(eq(prospects.organizationId, c.orgId)).catch(() => {});
    await db.delete(depositTransactions).where(eq(depositTransactions.organizationId, c.orgId)).catch(() => {});
    await db.delete(leaseEvents).where(eq(leaseEvents.organizationId, c.orgId)).catch(() => {});
    await db.update(leases).set({ previousLeaseId: null } as any).where(eq(leases.organizationId, c.orgId)).catch(() => {});
    await db.delete(leases).where(eq(leases.organizationId, c.orgId)).catch(() => {});
  }
  await cleanupTestData(ctx);
  await cleanupTestData(other);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("public application form", () => {
  const form = (extra: object = {}) => ({ organizationId: ctx.orgId, firstName: "Web", lastName: "Applicant", email: mail(), phone: "+254 712 345 678", nationalId: nid(), ...extra });
  const post = (b: object) => supertest(app).post("/api/prospects/apply").send(b);

  it("accepts an application without a login, as 'application_submitted' from the website", async () => {
    const f = form({ monthlyIncome: 120000, budgetMax: 50000 });
    const r = await post(f);
    expect(r.status).toBe(201);
    const [p] = await db.select().from(prospects).where(eq(prospects.email, f.email));
    expect(p.status).toBe("application_submitted");
    expect(p.source).toBe("website");
    expect(p.organizationId).toBe(ctx.orgId);
    expect(Number(p.monthlyIncome)).toBe(120000);
    expect(p.applicationSubmittedAt).toBeTruthy();
  });

  it("cannot choose its own stage, source or organisation fields", async () => {
    const f = form();
    const r = await post({ ...f, status: "approved", source: "agent", approvedAt: "2020-01-01", convertedToTenantId: 1, offeredRent: 1 });
    expect(r.status).toBe(201);
    const [p] = await db.select().from(prospects).where(eq(prospects.email, f.email));
    expect(p.status).toBe("application_submitted");
    expect(p.source).toBe("website");
    expect(p.approvedAt).toBeNull();
    expect(p.convertedToTenantId).toBeNull();
    expect(p.offeredRent).toBeNull();
  });

  it("the same person applying twice is one application", async () => {
    const f = form();
    expect((await post(f)).status).toBe(201);
    expect((await post({ ...f, email: f.email.toUpperCase() })).status).toBe(200);
    expect((await post({ ...f, email: mail() })).status).toBe(200);   // same ID number, different email
    expect((await db.select().from(prospects).where(eq(prospects.nationalId, f.nationalId))).length).toBe(1);
  });

  it("rejects bad input with a 400 (never a 500)", async () => {
    for (const bad of [
      { email: "nope" }, { firstName: "" }, { firstName: "x".repeat(5000) }, { phone: "abc" }, { nationalId: "!" },
      { monthlyIncome: -1 }, { monthlyIncome: "lots" }, { budgetMin: 90000, budgetMax: 10000 }, { preferredMoveIn: "2026-02-31" }, { organizationId: "abc" }, { organizationId: -4 },
    ]) {
      const r = await post(form(bad));
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post({ organizationId: ctx.orgId })).status).toBe(400);
  });

  it("an unknown organisation is 404", async () => {
    expect((await post(form({ organizationId: 999999999 }))).status).toBe(404);
  });

  it("units must exist in that organisation and be vacant", async () => {
    const foreign = await newUnit(other);
    expect((await post(form({ unitId: foreign }))).status).toBe(400);
    expect((await post(form({ propertyId: other.propertyId }))).status).toBe(400);
    const occupied = await newUnit(ctx, { occupied: true });
    const r = await post(form({ unitId: occupied }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("UNIT_UNAVAILABLE");
    const free = await newUnit();
    const f = form({ unitId: free });
    expect((await post(f)).status).toBe(201);
    const [p] = await db.select().from(prospects).where(eq(prospects.email, f.email));
    expect(p.unitId).toBe(free);
    expect(p.propertyId).toBe(ctx.propertyId);   // derived from the unit
  });

  it("a filled honeypot looks like success but stores nothing", async () => {
    const f = form({ website: "http://spam.example" });
    expect((await post(f)).status).toBe(201);
    expect((await db.select().from(prospects).where(eq(prospects.email, f.email))).length).toBe(0);
  });

  it("lists the organisation's vacant units for the form (and 404s an unknown organisation)", async () => {
    const free = await newUnit();
    const occ = await newUnit(ctx, { occupied: true });
    const r = await supertest(app).get(`/api/prospects/apply/options/${ctx.orgId}`);
    expect(r.status).toBe(200);
    const ids = r.body.units.map((u: any) => u.id);
    expect(ids).toContain(free);
    expect(ids).not.toContain(occ);
    expect(r.body.organization.id).toBe(ctx.orgId);
    expect(Object.keys(r.body.organization).sort()).toEqual(["id", "name"]);
    expect((await supertest(app).get("/api/prospects/apply/options/999999999")).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("adding and editing prospects", () => {
  it("whitelists fields — status, organisation and conversion links cannot be set from the form", async () => {
    const e = mail();
    const r = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: e, status: "converted", organizationId: other.orgId, convertedToTenantId: ctx.tenantId, approvedAt: "2020-01-01" });
    expect(r.status).toBe(201);
    const p = await row(r.body.id);
    expect(p.status).toBe("new");
    expect(p.organizationId).toBe(ctx.orgId);
    expect(p.convertedToTenantId).toBeNull();
    expect(p.approvedAt).toBeNull();
    const patch = await authedPatch(app, `/api/prospects/${p.id}`, ctx.adminToken, { status: "approved", organizationId: other.orgId, convertedToTenantId: ctx.tenantId, firstName: "Renamed" });
    expect(patch.status).toBe(200);
    const after = await row(p.id);
    expect(after.status).toBe("new");
    expect(after.organizationId).toBe(ctx.orgId);
    expect(after.convertedToTenantId).toBeNull();
    expect(after.firstName).toBe("Renamed");
  });

  it("validates email, phone, money and budget range; blank strings clear a field", async () => {
    for (const bad of [{ email: "nope" }, { phone: "x" }, { monthlyIncome: -5 }, { budgetMax: "abc" }, { budgetMin: 9, budgetMax: 1 }]) {
      const r = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), employer: "", monthlyIncome: "85000", budgetMax: "" });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.monthlyIncome)).toBe(85000);
    expect(ok.body.employer).toBeNull();
    expect(ok.body.budgetMax).toBeNull();
  });

  it("property and unit must belong to this organisation, and the unit to the property", async () => {
    const foreignUnit = await newUnit(other);
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), unitId: foreignUnit })).status).toBe(400);
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), propertyId: other.propertyId })).status).toBe(400);
    const [p2] = await db.insert(properties).values({ organizationId: ctx.orgId, name: "PP Second", address: "x", totalUnits: 1 } as any).returning();
    const u = await newUnit();
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), unitId: u, propertyId: p2.id })).status).toBe(400);
    await db.delete(properties).where(eq(properties.id, p2.id));
  });

  it("blocks a duplicate of someone already in the pipeline (email or ID), but not once they are rejected", async () => {
    const a = await prospect("new");
    const mine = await row(a.id);
    const dupEmail = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mine.email.toUpperCase() });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe("DUPLICATE_PROSPECT");
    expect(dupEmail.body.existingId).toBe(a.id);
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), nationalId: mine.nationalId })).status).toBe(409);
    expect((await P(a.id, "reject", { reason: "Changed his mind" })).status).toBe(200);
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mine.email })).status).toBe(201);
  });

  it("warns (not blocks) when the person is already a current tenant", async () => {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
    const r = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: t.email });
    expect(r.status).toBe(201);
    expect(r.body.warnings.join(" ")).toMatch(/current tenant/i);
  });

  it("an assignee has to be on this organisation's team", async () => {
    const foreign = await makeUser(other.orgId, "staff");
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail(), assignedTo: foreign.id })).status).toBe(400);
    const p = await prospect("new");
    expect((await P(p.id, "schedule-viewing", { viewingDate: new Date(Date.now() + 86_400_000).toISOString(), assignedTo: foreign.id })).status).toBe(400);
  });

  it("only notes can change once converted; changing an approved prospect's unit re-checks availability", async () => {
    const a = await prospect("approved");
    const taken = await newUnit(ctx, { occupied: true });
    const bad = await authedPatch(app, `/api/prospects/${a.id}`, ctx.adminToken, { unitId: taken });
    expect(bad.status).toBe(409);
    expect((await authedPatch(app, `/api/prospects/${a.id}`, ctx.adminToken, { unitId: null })).status).toBe(409);
    const free = await newUnit();
    expect((await authedPatch(app, `/api/prospects/${a.id}`, ctx.adminToken, { unitId: free })).status).toBe(200);
    expect((await convert(a.id)).status).toBe(201);
    expect((await authedPatch(app, `/api/prospects/${a.id}`, ctx.adminToken, { firstName: "Late" })).status).toBe(409);
    expect((await authedPatch(app, `/api/prospects/${a.id}`, ctx.adminToken, { internalNotes: "Moved in early" })).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("stages", () => {
  it("walks the whole pipeline in order", async () => {
    const p = await prospect("lease_offered");
    const r = await row(p.id);
    expect(r.status).toBe("lease_offered");
    expect(r.viewingDate).toBeTruthy();
    expect(r.applicationSubmittedAt).toBeTruthy();
    expect(r.referencesCheckedAt).toBeTruthy();
    expect(r.approvedAt).toBeTruthy();
    expect(r.leaseOfferedAt).toBeTruthy();
    expect(Number(r.offeredRent)).toBe(35000);   // the unit's rent unless overridden
  });

  it("refuses steps out of order", async () => {
    const fresh = await prospect("new");
    for (const ep of ["check-references", "approve", "offer-lease", "mark-viewed"]) {
      const r = await P(fresh.id, ep, ep === "check-references" ? { notes: "ok fine" } : {});
      expect(r.status, ep).toBe(409);
      expect(r.body.code).toBe("BAD_STAGE");
    }
    expect((await convert(fresh.id)).status).toBe(409);
    const applied = await prospect("application_submitted");
    expect((await P(applied.id, "offer-lease")).status).toBe(409);
    const approved = await prospect("approved");
    expect((await P(approved.id, "submit-application")).status).toBe(409);
    expect((await P(approved.id, "check-references", { notes: "again" })).status).toBe(409);
    expect((await P(approved.id, "schedule-viewing", { viewingDate: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(409);
  });

  it("an application needs the applicant's phone and ID; the step can supply them", async () => {
    const r = await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mail() });
    const missing = await P(r.body.id, "submit-application");
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("APPLICATION_INCOMPLETE");
    expect(missing.body.missing).toEqual(["phone number", "ID / passport number"]);
    const ok = await P(r.body.id, "submit-application", { phone: "0711222333", nationalId: nid(), employer: "Acme", monthlyIncome: 90000, notes: "Walked in with documents" });
    expect(ok.status).toBe(200);
    expect(ok.body.employer).toBe("Acme");
    expect(Number(ok.body.monthlyIncome)).toBe(90000);
  });

  it("viewing: real future time, notes kept, rescheduling allowed", async () => {
    const p = await prospect("new");
    expect((await P(p.id, "schedule-viewing", { viewingDate: "garbage" })).status).toBe(400);
    expect((await P(p.id, "schedule-viewing", { viewingDate: "2020-01-01T10:00:00Z" })).status).toBe(400);
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const ok = await P(p.id, "schedule-viewing", { viewingDate: when, viewingNotes: "Bring ID" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("viewing_scheduled");
    expect(ok.body.assignedTo).toBeTruthy();
    expect((await P(p.id, "schedule-viewing", { viewingDate: new Date(Date.now() + 3 * 86_400_000).toISOString() })).status).toBe(200);
  });

  it("references: the notes are required", async () => {
    const p = await prospect("application_submitted");
    expect((await P(p.id, "check-references", {})).status).toBe(400);
    expect((await P(p.id, "check-references", { notes: "  " })).status).toBe(400);
    expect((await P(p.id, "check-references", { notes: "Landlord says always paid on time" })).status).toBe(200);
  });

  it("approval skips the reference check only when explicitly waived, and says so on the record", async () => {
    const p = await prospect("application_submitted");
    const no = await P(p.id, "approve", {});
    expect(no.status).toBe(409);
    expect(no.body.code).toBe("REFERENCES_PENDING");
    const yes = await P(p.id, "approve", { waiveReferences: true, notes: "Known tenant" });
    expect(yes.status).toBe(200);
    expect((await row(p.id)).referenceCheckNotes).toMatch(/waived/i);
  });

  it("approval needs a unit and a positive rent, and warns (not blocks) on affordability", async () => {
    const p = await prospect("reference_checked", { unitId: null, extra: { monthlyIncome: 60000, budgetMax: 30000 } });
    const noUnit = await P(p.id, "approve", { offeredRent: 40000 });
    expect(noUnit.status).toBe(422);
    expect(noUnit.body.code).toBe("UNIT_REQUIRED");
    const u = await newUnit(ctx, { rent: "45000" });
    expect((await P(p.id, "approve", { unitId: u, offeredRent: -1 })).status).toBe(400);
    expect((await P(p.id, "approve", { unitId: u, offeredRent: 0 })).status).toBe(400);
    const ok = await P(p.id, "approve", { unitId: u });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.offeredRent)).toBe(45000);
    expect(ok.body.propertyId).toBe(ctx.propertyId);
    expect(ok.body.warnings.length).toBe(2);   // income < 3× rent, rent > budget
  });

  it("rejection needs a reason; a rejected prospect is closed until reopened", async () => {
    const p = await prospect("viewed");
    expect((await P(p.id, "reject", {})).status).toBe(400);
    expect((await P(p.id, "reject", { reason: "no" })).status).toBe(400);
    const rj = await P(p.id, "reject", { reason: "Could not verify income" });
    expect(rj.status).toBe(200);
    expect(rj.body.rejectionReason).toBe("Could not verify income");
    for (const ep of ["approve", "schedule-viewing", "submit-application", "reject", "offer-lease"]) {
      expect((await P(p.id, ep, { viewingDate: new Date(Date.now() + 86_400_000).toISOString(), reason: "again" })).status, ep).toBe(409);
    }
    const re = await P(p.id, "reopen");
    expect(re.status).toBe(200);
    expect(re.body.status).toBe("new");                       // no application on file yet
    expect(re.body.rejectedAt).toBeNull();
    expect((await P(p.id, "reopen")).status).toBe(409);       // not rejected any more
    // …whereas one that had applied goes back to the application stage, references to be checked again
    const q = await prospect("reference_checked");
    await P(q.id, "reject", { reason: "Landlord reference fell through" });
    const rq = await P(q.id, "reopen");
    expect(rq.body.status).toBe("application_submitted");
    expect(rq.body.referencesCheckedAt).toBeNull();
    expect(rq.body.referenceCheckNotes).toBeNull();
  });

  it("reopen is refused while the same person is already back in the pipeline", async () => {
    const p = await prospect("new");
    const mine = await row(p.id);
    await P(p.id, "reject", { reason: "Withdrew" });
    expect((await authedPost(app, "/api/prospects", ctx.adminToken, { firstName: "A", lastName: "B", email: mine.email })).status).toBe(201);
    expect((await P(p.id, "reopen")).status).toBe(409);
  });

  it("a rejection frees the unit the prospect had reserved", async () => {
    const a = await prospect("approved");
    const b = await prospect("reference_checked", { unitId: a.unitId });
    expect((await P(b.id, "approve")).status).toBe(409);
    expect((await P(a.id, "reject", { reason: "Failed credit check" })).status).toBe(200);
    expect((await P(b.id, "approve")).status).toBe(200);
  });

  it("offering the lease records it and reports whether the email went out", async () => {
    const p = await prospect("approved", { rent: 41000 });
    const r = await P(p.id, "offer-lease", { offeredRent: 40000 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("lease_offered");
    expect(Number(r.body.offeredRent)).toBe(40000);
    expect(typeof r.body.emailSent).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("unit availability", () => {
  it("won't approve for an occupied unit, a unit held by a tenant, or one reserved for someone else", async () => {
    const occ = await prospect("reference_checked", { unitId: await newUnit(ctx, { occupied: true }) });
    expect((await P(occ.id, "approve")).status).toBe(409);

    const heldUnit = await newUnit();
    await db.insert(tenants).values({ organizationId: ctx.orgId, userId: ctx.tenantUserId, firstName: "Held", lastName: "By", email: mail(), unitId: heldUnit, status: "pending" } as any);
    const held = await prospect("reference_checked", { unitId: heldUnit });
    const r = await P(held.id, "approve");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("UNIT_UNAVAILABLE");

    const first = await prospect("approved");
    const second = await prospect("reference_checked", { unitId: first.unitId });
    const rs = await P(second.id, "approve");
    expect(rs.status).toBe(409);
    expect(rs.body.message).toMatch(/reserved/i);
  });

  it("two simultaneous approvals for one unit: exactly one wins", async () => {
    const unitId = await newUnit();
    const a = await prospect("reference_checked", { unitId });
    const b = await prospect("reference_checked", { unitId });
    const [ra, rb] = await Promise.all([P(a.id, "approve"), P(b.id, "approve")]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
  });

  it("available-units lists vacant, unreserved units only", async () => {
    const p = await prospect("reference_checked", { unitId: null });
    const free = await newUnit();
    const occ = await newUnit(ctx, { occupied: true });
    const reservedUnit = await newUnit();
    const holder = await prospect("approved", { unitId: reservedUnit });
    const r = await authedGet(app, `/api/prospects/${p.id}/available-units`, ctx.adminToken);
    expect(r.status).toBe(200);
    const ids = r.body.map((u: any) => u.id);
    expect(ids).toContain(free);
    expect(ids).not.toContain(occ);
    expect(ids).not.toContain(reservedUnit);
    // …but the holder itself still sees its own reserved unit
    const own = await authedGet(app, `/api/prospects/${holder.id}/available-units`, ctx.adminToken);
    expect(own.body.map((u: any) => u.id)).toContain(reservedUnit);
  });

  it("the prospect's detail flags an approved prospect whose unit was taken in the meantime", async () => {
    const a = await prospect("approved");
    expect((await authedGet(app, `/api/prospects/${a.id}`, ctx.adminToken)).body.unitIssue).toBeNull();
    await db.update(units).set({ isOccupied: true } as any).where(eq(units.id, a.unitId));
    const d = await authedGet(app, `/api/prospects/${a.id}`, ctx.adminToken);
    expect(d.body.unitIssue).toMatch(/occupied/i);
    expect((await convert(a.id)).status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("convert to tenant", () => {
  it("creates the pending tenant, a pending login, a draft lease, the deposit and holds the unit — in one go", async () => {
    const p = await prospect("lease_offered", { rent: 38000 });
    const e = (await row(p.id)).email;
    const r = await convert(p.id, { depositPaidDate: today });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const [t] = await db.select().from(tenants).where(eq(tenants.id, r.body.tenant.id));
    expect(t.status).toBe("pending");                       // active only once the lease is activated
    expect(t.unitId).toBe(p.unitId);
    expect(t.email).toBe(e);
    expect(Number(t.monthlyRent)).toBe(38000);              // the offered rent
    expect(Number(t.securityDeposit)).toBe(70000);
    expect(t.leaseStartDate).toBe(START);

    const [u] = await db.select().from(users).where(eq(users.id, t.userId));
    expect(u.organizationId).toBe(ctx.orgId);
    expect(u.role).toBe("tenant");
    expect(u.passwordHash).toBe("");                        // a pending invite, not a random-password account
    expect(u.emailVerified).toBeFalsy();
    expect(r.body.invite.link).toContain("/accept-invite/");

    const [l] = await db.select().from(leases).where(eq(leases.tenantId, t.id));
    expect(l.status).toBe("draft");
    expect(l.unitId).toBe(p.unitId);
    expect(Number(l.monthlyRent)).toBe(38000);
    expect(l.startDate).toBe(START);
    expect(r.body.lease.id).toBe(l.id);
    const dep = await db.select().from(depositTransactions).where(eq(depositTransactions.leaseId, l.id));
    expect(dep.length).toBe(1);
    expect(Number(dep[0].amount)).toBe(70000);

    expect((await unitRow(p.unitId)).isOccupied).toBe(true);
    const pr = await row(p.id);
    expect(pr.status).toBe("converted");
    expect(pr.convertedToTenantId).toBe(t.id);
    expect(pr.convertedAt).toBeTruthy();

    const d = await authedGet(app, `/api/prospects/${p.id}`, ctx.adminToken);
    expect(d.body.tenant).toMatchObject({ id: t.id, leaseId: l.id, leaseStatus: "draft", status: "pending" });
  });

  it("validates the terms and the unit", async () => {
    const p = await prospect("approved");
    expect((await convert(p.id, { leaseStartDate: undefined })).status).toBe(400);
    expect((await convert(p.id, { leaseEndDate: START })).status).toBe(400);
    expect((await convert(p.id, { leaseStartDate: "2026-02-31" })).status).toBe(400);
    expect((await convert(p.id, { monthlyRent: -5 })).status).toBe(400);
    expect((await convert(p.id, { securityDeposit: -1 })).status).toBe(400);
    expect((await convert(p.id, { unitId: await newUnit(other) })).status).toBe(400);
    expect((await convert(p.id, { unitId: await newUnit(ctx, { occupied: true }) })).status).toBe(409);
    const [c] = await db.select().from(tenants).where(eq(tenants.organizationId, ctx.orgId));
    expect(c).toBeTruthy();
    expect((await row(p.id)).status).toBe("approved");       // every refusal left it untouched
    expect((await unitRow(p.unitId)).isOccupied).toBe(false);
  });

  it("warns about a deposit above 2 months' rent without blocking", async () => {
    const p = await prospect("approved", { rent: 30000 });
    const r = await convert(p.id, { securityDeposit: 150000 });
    expect(r.status).toBe(201);
    expect(r.body.warnings.join(" ")).toMatch(/2 months/);
  });

  it("will not attach the tenant to another organisation's account or to staff in this one", async () => {
    const foreign = await makeUser(other.orgId, "admin");
    const a = await prospect("approved", { email: foreign.email });
    const ra = await convert(a.id);
    expect(ra.status).toBe(409);
    expect(ra.body.code).toBe("ACCOUNT_CONFLICT");
    expect((await db.select().from(tenants).where(eq(tenants.email, foreign.email))).length).toBe(0);
    expect((await db.select().from(users).where(eq(users.id, foreign.id)))[0].role).toBe("admin");
    expect((await row(a.id)).status).toBe("approved");

    const mine = await makeUser(ctx.orgId, "manager");
    const b = await prospect("approved", { email: mine.email });
    const rb = await convert(b.id);
    expect(rb.status).toBe(409);
    expect((await db.select().from(users).where(eq(users.id, mine.id)))[0].role).toBe("manager");
  });

  it("someone who is a current tenant cannot be converted into a second tenancy", async () => {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
    await db.update(tenants).set({ unitId: ctx.unitId, status: "active" } as any).where(eq(tenants.id, t.id));
    await db.delete(prospects).where(eq(prospects.email, t.email));   // the earlier "current tenant" warning test left one behind
    const p = await prospect("approved", { email: t.email });
    const r = await convert(p.id);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TENANT_EXISTS");
    expect((await db.select().from(tenants).where(eq(tenants.email, t.email))).length).toBe(1);
  });

  it("is refused a second time — including two clicks at once", async () => {
    const p = await prospect("approved");
    const [r1, r2] = await Promise.all([convert(p.id), convert(p.id)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const pr = await row(p.id);
    expect((await db.select().from(tenants).where(eq(tenants.email, pr.email))).length).toBe(1);
    expect((await db.select().from(leases).where(eq(leases.tenantId, pr.convertedToTenantId!))).length).toBe(1);
    const again = await convert(p.id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CONVERTED");
  });

  it("a unit that was already given to someone else cannot be converted into again", async () => {
    const a = await prospect("approved");
    const b = await prospect("approved");
    expect((await convert(a.id)).status).toBe(201);
    await db.update(prospects).set({ unitId: a.unitId } as any).where(eq(prospects.id, b.id));      // force the clash directly
    const r = await convert(b.id);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("UNIT_UNAVAILABLE");
    expect((await row(b.id)).status).toBe("approved");
  });

  it("a returning tenant keeps their record and login", async () => {
    const p = await prospect("approved");
    const first = await convert(p.id);
    expect(first.status).toBe(201);
    const leaseId = first.body.lease.id;
    expect((await authedPost(app, `/api/leases/${leaseId}/cancel`, ctx.adminToken, {})).status).toBe(200);   // back to approved, tenant inactive
    const again = await convert(p.id, { unitId: await newUnit() });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.returningTenant).toBe(true);
    expect(again.body.tenant.id).toBe(first.body.tenant.id);
    expect(again.body.userId).toBe(first.body.userId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("lease follow-through", () => {
  const L = (id: number, ep: string, b: object = {}) => authedPost(app, `/api/leases/${id}/${ep}`, ctx.adminToken, b);

  it("activating the lease starts the tenancy: tenant active, unit occupied, no double booking afterwards", async () => {
    const p = await prospect("approved");
    const c = await convert(p.id, { leaseStartDate: today, leaseEndDate: addDays(today, 364) });
    expect(c.status).toBe(201);
    await L(c.body.lease.id, "send-for-signing");
    await L(c.body.lease.id, "sign", { signer: "manager" });
    await L(c.body.lease.id, "sign", { signer: "tenant" });
    expect((await L(c.body.lease.id, "activate")).status).toBe(200);
    expect((await db.select().from(tenants).where(eq(tenants.id, c.body.tenant.id)))[0].status).toBe("active");
    expect((await unitRow(p.unitId)).isOccupied).toBe(true);
    const clash = await authedPost(app, "/api/tenants", ctx.adminToken, { firstName: "X", lastName: "Y", email: mail(), unitId: p.unitId, monthlyRent: "30000", status: "active" });
    expect(clash.status).toBe(409);
  });

  it("a placement that is still pending also blocks a manual 'Add tenant' and a new lease on that unit", async () => {
    const p = await prospect("approved");
    const c = await convert(p.id);
    expect(c.status).toBe(201);
    const manual = await authedPost(app, "/api/tenants", ctx.adminToken, { firstName: "X", lastName: "Y", email: mail(), unitId: p.unitId, monthlyRent: "30000" });
    expect(manual.status).toBe(409);
    const vac = await authedPatch(app, `/api/units/${p.unitId}`, ctx.adminToken, { isOccupied: false });
    expect(vac.status).toBe(409);
  });

  it("cancelling the never-activated lease undoes the placement and returns the prospect to 'approved'", async () => {
    const p = await prospect("approved");
    const c = await convert(p.id);
    const r = await L(c.body.lease.id, "cancel", { reason: "Applicant found another place" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "cancelled", released: true, prospectReopened: true });
    expect((await db.select().from(leases).where(eq(leases.id, c.body.lease.id)))[0].status).toBe("cancelled");
    expect((await db.select().from(tenants).where(eq(tenants.id, c.body.tenant.id)))[0].status).toBe("inactive");
    expect((await unitRow(p.unitId)).isOccupied).toBe(false);
    const pr = await row(p.id);
    expect(pr.status).toBe("approved");
    expect(pr.convertedToTenantId).toBeNull();
    expect((await L(c.body.lease.id, "cancel")).status).toBe(400);   // already cancelled
    expect((await P(p.id, "reject", { reason: "Applicant found another place" })).status).toBe(200);
  });

  it("an active lease cannot be 'cancelled' — it is terminated", async () => {
    const p = await prospect("approved");
    const c = await convert(p.id, { leaseStartDate: today, leaseEndDate: addDays(today, 364) });
    await L(c.body.lease.id, "activate", { confirmUnsigned: true });
    const r = await L(c.body.lease.id, "cancel");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/terminate/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("pipeline view, access and isolation", () => {
  it("the pipeline groups every stage (rejected included) and lists the property's free units", async () => {
    const p = await prospect("approved");
    const rejected = await prospect("new");
    await P(rejected.id, "reject", { reason: "Not interested any more" });
    const free = await newUnit();
    const r = await authedGet(app, `/api/prospects/pipeline/${ctx.propertyId}`, ctx.adminToken);
    expect(r.status).toBe(200);
    expect(r.body.pipeline.approved.map((x: any) => x.id)).toContain(p.id);
    expect(r.body.pipeline.rejected.map((x: any) => x.id)).toContain(rejected.id);
    expect(r.body.pipeline.approved[0].propertyId).toBe(ctx.propertyId);
    const vac = r.body.vacantUnits.map((u: any) => u.id);
    expect(vac).toContain(free);
    expect(vac).not.toContain(p.unitId);   // reserved for the approved prospect
  });

  it("another organisation sees nothing and can change nothing", async () => {
    const p = await prospect("approved");
    expect((await authedGet(app, `/api/prospects/${p.id}`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, `/api/prospects/pipeline/${ctx.propertyId}`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, `/api/prospects/${p.id}/available-units`, other.adminToken)).status).toBe(404);
    expect((await authedGet(app, "/api/prospects", other.adminToken)).body.map((x: any) => x.id)).not.toContain(p.id);
    expect((await authedPatch(app, `/api/prospects/${p.id}`, other.adminToken, { firstName: "Hax" })).status).toBe(404);
    for (const ep of ["schedule-viewing", "submit-application", "check-references", "approve", "offer-lease", "reject", "reopen", "convert"]) {
      expect((await P(p.id, ep, convertBody({ notes: "xxx", reason: "xxxx", viewingDate: new Date(Date.now() + 86_400_000).toISOString() }), other.adminToken)).status, ep).toBe(404);
    }
    expect((await row(p.id)).status).toBe("approved");
  });

  it("staff can run the pipeline; landlords and tenants cannot", async () => {
    const p = await prospect("new", { token: staffToken });
    expect((await P(p.id, "schedule-viewing", { viewingDate: new Date(Date.now() + 86_400_000).toISOString() }, staffToken)).status).toBe(200);
    for (const tk of [landlordToken, ctx.tenantToken]) {
      expect((await authedGet(app, "/api/prospects", tk)).status).toBe(403);
      expect((await authedGet(app, `/api/prospects/${p.id}`, tk)).status).toBe(403);
      expect((await P(p.id, "reject", { reason: "Nope not you" }, tk)).status).toBe(403);
    }
    expect((await supertest(app).get("/api/prospects")).status).toBe(401);
  });

  it("bad ids are 400/404, not 500", async () => {
    expect((await authedGet(app, "/api/prospects/abc", ctx.adminToken)).status).toBe(400);
    expect((await authedGet(app, "/api/prospects/99999999", ctx.adminToken)).status).toBe(404);
    expect((await P(99999999, "approve")).status).toBe(404);
  });
});
