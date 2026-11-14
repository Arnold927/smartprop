/**
 * maintenance-workflow.test.ts — pure rules of the maintenance workflow service
 * (no database: the db module is mocked because the service imports it).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { actionForStatusChange, filterGenericFields, normalizeMoney, WORKFLOW_OWNED_FIELDS } from "../services/maintenance-workflow";

describe("actionForStatusChange — plain status edits still follow the workflow", () => {
  it("maps each legal move to its action", () => {
    expect(actionForStatusChange("pending_approval", "pending")).toBe("approve");
    expect(actionForStatusChange("pending_approval", "cancelled")).toBe("reject");
    expect(actionForStatusChange("pending", "cancelled")).toBe("cancel");
    expect(actionForStatusChange("assigned", "in_progress")).toBe("start");
    expect(actionForStatusChange("in_progress", "assigned")).toBe("pause");
    expect(actionForStatusChange("in_progress", "completed")).toBe("complete");
    expect(actionForStatusChange("assigned", "pending")).toBe("unassign");
    expect(actionForStatusChange("completed", "pending")).toBe("reopen");
  });
  it("assigning by status alone needs a target person", () => {
    expect(actionForStatusChange("pending", "assigned")).toBe("assign-needs-target");
  });
  it("same status is a no-op and nobody can move a request INTO pending_approval", () => {
    expect(actionForStatusChange("pending", "pending")).toBeNull();
    expect(actionForStatusChange("pending", "pending_approval")).toBeNull();
  });
});

describe("filterGenericFields — who may edit what outside the workflow", () => {
  const body = { title: "t", description: "d", status: "completed", assignedTo: "x", satisfactionRating: 5, internalNotes: "x", technicianNotes: "n", actualCost: "10", ticketNumber: "T" };
  it("landlords edit nothing", () => expect(filterGenericFields("landlord", false, body)).toEqual({}));
  it("tenants edit nothing", () => expect(filterGenericFields("tenant", false, body)).toEqual({}));
  it("managers edit descriptive fields but never workflow-owned ones", () => {
    const out = filterGenericFields("manager", false, body);
    expect(out.title).toBe("t");
    for (const f of [...WORKFLOW_OWNED_FIELDS, "internalNotes"]) expect(out).not.toHaveProperty(f);
  });
  it("an assigned technician edits only notes/time/cost", () => {
    const out = filterGenericFields("staff", true, body);
    expect(Object.keys(out).sort()).toEqual(["actualCost", "technicianNotes"]);
  });
  it("a technician who is NOT assigned edits nothing", () => expect(filterGenericFields("staff", false, body)).toEqual({}));
});

describe("normalizeMoney", () => {
  it("turns numbers into strings and drops blanks", () => {
    expect(normalizeMoney({ estimatedCost: 1500, actualCost: "" })).toEqual({ estimatedCost: "1500" });
  });
  it("rejects negative or non-finite numbers", () => {
    expect(normalizeMoney({ estimatedCost: -5 }).estimatedCost).toBeUndefined();
    expect(normalizeMoney({ estimatedCost: NaN }).estimatedCost).toBeUndefined();
  });
});
