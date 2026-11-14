/**
 * maintenance-lifecycle.test.ts — the whole request lifecycle through the real HTTP routes:
 * tenant submits → assign → start → complete → tenant rates → reopen, plus the charge-to-tenant bill.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { setupTestData, cleanupTestData, authedGet, authedPost, authedPatch, type TestContext } from "./helpers";
import { db } from "../db";
import { maintenanceRequests, staffMembers, utilityBills } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

let app: any;
let ctx: TestContext;
let staffId: number;
const created: number[] = [];

const mk = async (title: string, token = ctx.tenantToken) => {
  const res = await authedPost(app, "/api/maintenance-requests", token, {
    tenantId: ctx.tenantId, unitId: ctx.unitId, title, description: "Needs a look", category: "plumbing", priority: "medium",
  });
  expect(res.status).toBe(201);
  created.push(res.body.id);
  return res.body;
};
const act = (id: number, what: string, token: string, body: object = {}) => authedPatch(app, `/api/maintenance-requests/${id}/${what}`, token, body);

beforeAll(async () => {
  app = await createApp();
  ctx = await setupTestData();
  const [st] = await db.insert(staffMembers).values({
    organization_id: ctx.orgId, employee_id: `LC-${Date.now()}`, first_name: "Life", last_name: "Cycle",
    position: "technician", department: "maintenance", hire_date: new Date(),
  } as any).returning({ id: staffMembers.id });
  staffId = st.id;
});

afterAll(async () => {
  if (created.length) {
    await db.delete(utilityBills).where(eq(utilityBills.tenantId, ctx.tenantId)).catch(() => {});
    await db.delete(maintenanceRequests).where(inArray(maintenanceRequests.id, created)).catch(() => {});
  }
  await db.delete(staffMembers).where(eq(staffMembers.id, staffId)).catch(() => {});
  await cleanupTestData(ctx);
});

describe("creation", () => {
  it("ignores workflow-owned fields sent by the tenant and creates no work order", async () => {
    const res = await authedPost(app, "/api/maintenance-requests", ctx.tenantToken, {
      tenantId: ctx.tenantId, unitId: ctx.unitId, title: "Hacky", description: "x", priority: "low",
      status: "completed", satisfactionRating: 5, assignedTo: "someone", chargeTenant: true, ticketNumber: "HACK",
    });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(res.body.status).toBe("pending");
    expect(res.body.satisfactionRating ?? null).toBeNull();
    expect(res.body.assignedTo ?? null).toBeNull();
    expect(res.body.chargeTenant ?? false).toBe(false);
    expect(res.body.ticketNumber).not.toBe("HACK");
  });
});

describe("assign → start → complete → rate", () => {
  let id: number;
  it("tenant can't approve, assign, start or complete", async () => {
    id = (await mk("Lifecycle A")).id;
    for (const [what, body] of [["assign-technician", { technicianId: staffId }], ["start", {}], ["complete", {}]] as const) {
      const r = await act(id, what, ctx.tenantToken, body);
      expect([403, 409]).toContain(r.status);
    }
    const ap = await authedPost(app, `/api/maintenance-requests/${id}/approve`, ctx.tenantToken, { approvalStatus: "approved" });
    expect([403, 409]).toContain(ap.status);
  });
  it("can't start or complete before it's assigned", async () => {
    expect((await act(id, "start", ctx.adminToken)).status).toBe(409);
    expect((await act(id, "complete", ctx.adminToken)).status).toBe(409);
  });
  it("assigning sets the assignee and timestamps", async () => {
    const r = await act(id, "assign-technician", ctx.adminToken, { technicianId: staffId });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("assigned");
    expect(r.body.technicianId).toBe(staffId);
    expect(r.body.assignedDate).toBeTruthy();
  });
  it("Hold is gone: only pause exists", async () => {
    expect((await act(id, "hold", ctx.adminToken)).status).toBeGreaterThanOrEqual(400);
  });
  it("start → pause → start → complete stamps every step", async () => {
    expect((await act(id, "start", ctx.adminToken)).body.status).toBe("in_progress");
    expect((await act(id, "pause", ctx.adminToken)).body.status).toBe("assigned");
    expect((await act(id, "start", ctx.adminToken)).body.status).toBe("in_progress");
    const done = await act(id, "complete", ctx.adminToken, { technicianNotes: "Replaced washer", actualCost: "1200" });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(done.body.completedAt).toBeTruthy();
    expect(Number(done.body.actualCost)).toBe(1200);
  });
  it("only the owning tenant rates, once", async () => {
    expect((await act(id, "feedback", ctx.adminToken, { rating: 5 })).status).toBe(403);
    expect((await act(id, "feedback", ctx.tenantToken, { rating: 4, comments: "Good" })).status).toBe(200);
    expect((await act(id, "feedback", ctx.tenantToken, { rating: 1 })).status).toBe(409);
  });
  it("the tenant can reopen; the rating is cleared", async () => {
    expect((await act(id, "reopen", ctx.tenantToken, {})).status).toBe(400); // a reason is required
    const r = await act(id, "reopen", ctx.tenantToken, { reason: "Still dripping" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("assigned");
    expect(r.body.satisfactionRating ?? null).toBeNull();
  });
});

describe("charge to tenant", () => {
  let id: number;
  const billOf = async () => {
    const [r] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id));
    const [b] = r.tenantChargeBillId ? await db.select().from(utilityBills).where(eq(utilityBills.id, r.tenantChargeBillId)) : [];
    return { r, b };
  };
  it("only managers/owners can set it, and a reason is required", async () => {
    id = (await mk("Lifecycle B")).id;
    expect((await act(id, "charge", ctx.tenantToken, { charge: true, reason: "my fault" })).status).toBe(403);
    expect((await act(id, "charge", ctx.adminToken, { charge: true })).status).toBe(400);
    const ok = await act(id, "charge", ctx.adminToken, { charge: true, reason: "Window broken by tenant" });
    expect(ok.status).toBe(200);
    expect((await billOf()).b).toBeUndefined(); // nothing billed before the job is done
  });
  it("completion issues the bill at the actual cost; cost corrections move it", async () => {
    await act(id, "assign-technician", ctx.adminToken, { technicianId: staffId });
    await act(id, "start", ctx.adminToken);
    await act(id, "complete", ctx.adminToken, { actualCost: "1000" });
    let { b } = await billOf();
    expect(b?.utilityType).toBe("repair");
    expect(Number(b?.amount)).toBe(1000);
    expect(b?.status).toBe("pending");
    expect((await authedPatch(app, `/api/maintenance-requests/${id}`, ctx.adminToken, { actualCost: 1500 })).status).toBe(200);
    ({ b } = await billOf());
    expect(Number(b?.amount)).toBe(1500);
  });
  it("can't charge more than the repair cost", async () => {
    expect((await act(id, "charge", ctx.adminToken, { charge: true, amount: 99999 })).status).toBe(400);
  });
  it("reopening withdraws an unpaid bill; completing again re-bills", async () => {
    await act(id, "reopen", ctx.tenantToken, { reason: "Not fixed" });
    let { r, b } = await billOf();
    expect(b).toBeUndefined();
    expect(r.chargeTenant).toBe(true);
    await act(id, "start", ctx.adminToken);
    await act(id, "complete", ctx.adminToken, { actualCost: "1200" });
    ({ b } = await billOf());
    expect(Number(b?.amount)).toBe(1200);
  });
  it("a paid bill is locked", async () => {
    const { b } = await billOf();
    await db.update(utilityBills).set({ status: "paid" } as any).where(eq(utilityBills.id, b!.id));
    expect((await act(id, "charge", ctx.adminToken, { charge: false })).status).toBe(409);
    expect((await authedPatch(app, `/api/maintenance-requests/${id}`, ctx.adminToken, { actualCost: 500 })).status).toBe(409);
  });
});
