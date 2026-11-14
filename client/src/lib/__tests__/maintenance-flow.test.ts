import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import { availableActions, canReopen } from "../maintenance-flow";

const base = { id: 1, status: "pending" as const, assignedTo: null, technicianId: null, completedAt: null };
const pm = { role: "manager", userId: "m" };
const tenant = { role: "tenant", userId: "t" };
const staff = { role: "staff", userId: "s", staffIds: [7] };

describe("availableActions", () => {
  it("pending: manager can assign/cancel, never start or complete", () => {
    const a = availableActions(base as any, pm);
    expect(a).toContain("assign"); expect(a).toContain("cancel");
    expect(a).not.toContain("start"); expect(a).not.toContain("complete");
  });
  it("tenant has no staff actions on a pending request", () => {
    expect(availableActions(base as any, tenant)).toEqual([]);
  });
  it("gated request: only approve/cancel, no assign", () => {
    const a = availableActions({ ...base, status: "pending_approval" } as any, pm);
    expect(a).toEqual(["approve", "cancel"]);
  });
  it("assigned: only the assignee technician may start/complete", () => {
    const r = { ...base, status: "assigned", technicianId: 7 } as any;
    expect(availableActions(r, staff)).toContain("start");
    expect(availableActions({ ...r, technicianId: 8 }, staff)).not.toContain("start");
  });
  it("in progress offers pause + complete to the assignee", () => {
    const a = availableActions({ ...base, status: "in_progress", assignedTo: "s" } as any, staff);
    expect(a).toContain("pause"); expect(a).toContain("complete"); expect(a).not.toContain("start");
  });
  it("cancelled offers nothing", () => {
    expect(availableActions({ ...base, status: "cancelled" } as any, pm)).toEqual([]);
  });
});

describe("reopen window", () => {
  const done = (daysAgo: number) => ({ ...base, status: "completed", completedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() } as any);
  it("tenant may reopen within 14 days", () => {
    expect(canReopen(done(3))).toBe(true);
    expect(availableActions(done(3), tenant)).toEqual(["reopen"]);
  });
  it("not after 14 days, and not for managers", () => {
    expect(canReopen(done(20))).toBe(false);
    expect(availableActions(done(3), pm)).toEqual([]);
  });
});
