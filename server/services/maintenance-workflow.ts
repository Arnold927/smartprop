/**
 * maintenance-workflow.ts — the ONE place a maintenance request changes state.
 *
 *   pending_approval ──approve──▶ pending ──assign──▶ assigned ──start──▶ in_progress ──complete──▶ completed
 *          │                         │                  │  ▲                │ │                        │
 *        reject                    cancel            unassign└──────pause────┘ └──cancel (managers)      reopen
 *          ▼                         ▼                  ▼                                                 ▼
 *      cancelled                 cancelled           pending                                  assigned / pending
 *
 * Why this exists: the same transitions used to be written separately by every screen and route
 * (a plain status update from the staff portal, a different one from the detail page, a third from
 * the landlord portal…). They disagreed — completing from a screen never stamped completed_at or
 * told the tenant, any tenant could call "approve", "assigned" was reachable with nobody assigned,
 * a contractor finishing a work order left the request open forever. Now every route and screen
 * calls transition() and gets the same rules, timestamps, notifications and live updates.
 *
 * Who may do what (platform_admin / admin / manager can do everything):
 *   approve, reject      landlord who owns the property
 *   assign, unassign     landlord (own property), staff, caretaker (own property)
 *   start, complete, pause   the person (or contractor) it is assigned to
 *   cancel               landlord (own property); the tenant, for their own request until it is assigned
 *   reopen               the tenant, for their own request within REOPEN_WINDOW_DAYS of completion
 * A tenant may also rate a COMPLETED request, once (rateRequest).
 *
 * Contractors: an external contractor works from a work order. assign(contractor) creates (or reuses)
 * the linked work order; the contractor portal then calls these same transitions as the "system", so the
 * request, the tenant and the manager always agree with the work order.
 */

import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  maintenanceRequests, units, properties, tenants, users, staffMembers, contractors, workOrders, pmAgreements,
} from "@shared/schema";
import { storage } from "../storage";
import { notifyMaintenanceUpdated } from "../ws";
import { pushNotification } from "../routes/notifications";
import { notifyTenant } from "./notifyTenant";

export type RequestStatus = "pending" | "pending_approval" | "assigned" | "in_progress" | "completed" | "cancelled";
export type WorkflowAction = "approve" | "reject" | "assign" | "unassign" | "start" | "pause" | "complete" | "cancel" | "reopen";

export const REOPEN_WINDOW_DAYS = 14;

export class WorkflowError extends Error {
  constructor(public httpStatus: number, message: string, public code?: string) { super(message); }
}

export interface Actor {
  id: string;
  role: string;
  organizationId: number;
  email?: string;
  name?: string;
  /** Internal callers (e.g. the contractor portal) that have already authenticated the person themselves. */
  system?: boolean;
}

export function actorFromReq(req: any): Actor {
  const u = req.user ?? {};
  return {
    id: String(u.id ?? u.userId ?? ""),
    role: String(u.role ?? ""),
    organizationId: Number(u.organizationId),
    email: u.email,
    name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || undefined,
  };
}

const PM_ROLES = new Set(["platform_admin", "admin", "manager"]);

// ── Which statuses each action may start from, and where it leads ────────────────────────────────
const RULES: Record<WorkflowAction, { from: RequestStatus[]; to: RequestStatus | "auto" }> = {
  approve:  { from: ["pending_approval"],                    to: "pending" },
  reject:   { from: ["pending_approval"],                    to: "cancelled" },
  assign:   { from: ["pending", "assigned", "in_progress"],  to: "assigned" },
  unassign: { from: ["assigned", "in_progress"],             to: "pending" },
  start:    { from: ["assigned"],                            to: "in_progress" },
  pause:    { from: ["in_progress"],                         to: "assigned" },
  complete: { from: ["assigned", "in_progress"],             to: "completed" },
  cancel:   { from: ["pending", "pending_approval", "assigned", "in_progress"], to: "cancelled" },
  reopen:   { from: ["completed"],                           to: "auto" },
};

const ACTION_VERB: Record<WorkflowAction, string> = {
  approve: "approve", reject: "reject", assign: "assign", unassign: "unassign", start: "start",
  pause: "pause", complete: "complete", cancel: "cancel", reopen: "reopen",
};

// ── Request context (with the bits permission checks need) ───────────────────────────────────────
export interface RequestCtx {
  id: number;
  ticketNumber: string;
  title: string | null;
  status: RequestStatus;
  priority: string | null;
  tenantId: number | null;
  unitId: number;
  unitOrgId: number;
  propertyId: number | null;
  propertyName: string | null;
  ownerId: string | null;
  technicianId: number | null;
  assignedTo: string | null;
  contractorId: number | null;
  createdAt: Date | null;
  assignedDate: Date | null;
  startedDate: Date | null;
  completedAt: Date | null;
  responseTime: number | null;
  satisfactionRating: number | null;
  estimatedCost: string | null;
  description: string | null;
}

/** Resolve the request's org via its unit (maintenance_requests has no organization_id of its own). */
export async function loadRequestCtx(id: number, orgId: number): Promise<RequestCtx | null> {
  if (!Number.isInteger(id)) return null;
  const [row] = await db
    .select({
      id: maintenanceRequests.id,
      ticketNumber: maintenanceRequests.ticketNumber,
      title: maintenanceRequests.title,
      description: maintenanceRequests.description,
      status: maintenanceRequests.status,
      priority: maintenanceRequests.priority,
      tenantId: maintenanceRequests.tenantId,
      unitId: maintenanceRequests.unitId,
      technicianId: maintenanceRequests.technicianId,
      assignedTo: maintenanceRequests.assignedTo,
      contractorId: maintenanceRequests.contractorId,
      createdAt: maintenanceRequests.createdAt,
      assignedDate: maintenanceRequests.assignedDate,
      startedDate: maintenanceRequests.startedDate,
      completedAt: maintenanceRequests.completedAt,
      responseTime: maintenanceRequests.responseTime,
      satisfactionRating: maintenanceRequests.satisfactionRating,
      estimatedCost: maintenanceRequests.estimatedCost,
      unitOrgId: units.organizationId,
      propertyId: units.propertyId,
      propertyName: properties.name,
      ownerId: properties.ownerId,
    })
    .from(maintenanceRequests)
    .innerJoin(units, eq(maintenanceRequests.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id))
    .where(eq(maintenanceRequests.id, id))
    .limit(1);
  if (!row || row.unitOrgId !== orgId) return null;
  return { ...row, status: (row.status ?? "pending") as RequestStatus } as RequestCtx;
}

/** Exported for the routes that used to carry their own copy of this check. */
export async function resolveScopedRequest(id: number, orgId: number) {
  const c = await loadRequestCtx(id, orgId);
  return c ? { id: c.id, tenantId: c.tenantId, unitId: c.unitId, unitOrgId: c.unitOrgId, propertyId: c.propertyId } : null;
}

/** Can this caller see / act on this specific request, beyond the organisation match? */
export async function callerCanAccess(
  row: { tenantId: number | null; propertyId: number | null },
  req: any,
): Promise<boolean> {
  const role: string = req.user.role ?? "";
  const userId: string = String(req.user.id ?? req.user.userId ?? "");
  if (role === "tenant") {
    const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, userId)).limit(1);
    return !!own && own.id === row.tenantId;
  }
  if (role === "landlord") {
    if (!row.propertyId) return false;
    const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, row.propertyId)).limit(1);
    return !!prop && prop.ownerId === userId;
  }
  if (role === "caretaker") {
    const caretaker = await storage.getCaretakerByUserId(userId);
    return !!caretaker?.propertyId && caretaker.propertyId === row.propertyId;
  }
  return true; // admin, manager, staff, platform_admin: organisation match already confirmed
}

/** Does this cost need sign-off under the property's PM agreement? (false when there is no agreement) */
export async function exceedsApprovalThreshold(unitId: number | null | undefined, estimatedCost: string | number | null | undefined): Promise<boolean> {
  if (unitId == null || estimatedCost == null || estimatedCost === "") return false;
  const cost = typeof estimatedCost === "string" ? parseFloat(estimatedCost) : estimatedCost;
  if (!Number.isFinite(cost)) return false;
  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId)).limit(1);
  if (!unit?.propertyId) return false;
  const [agreement] = await db
    .select({ threshold: pmAgreements.maintenanceApprovalThreshold })
    .from(pmAgreements)
    .where(and(eq(pmAgreements.propertyId, unit.propertyId), eq(pmAgreements.status, "active")))
    .limit(1);
  if (!agreement) return false;
  return cost > parseFloat(agreement.threshold ?? "0");
}

// ── Assignee / ownership checks ──────────────────────────────────────────────────────────────────
async function staffIdsForUser(actor: Actor): Promise<number[]> {
  let email = actor.email;
  if (!email) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, actor.id)).limit(1);
    email = u?.email ?? undefined;
  }
  if (!email) return [];
  const rows = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(eq(staffMembers.organization_id, actor.organizationId), sql`lower(${staffMembers.email}) = lower(${email})`));
  return rows.map((r) => r.id);
}

async function isAssignee(actor: Actor, ctx: RequestCtx): Promise<boolean> {
  if (ctx.assignedTo && ctx.assignedTo === actor.id) return true;
  if (ctx.technicianId) return (await staffIdsForUser(actor)).includes(ctx.technicianId);
  return false;
}

async function isOwnTenant(actor: Actor, ctx: RequestCtx): Promise<boolean> {
  if (actor.role !== "tenant" || ctx.tenantId == null) return false;
  const [own] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.userId, actor.id), eq(tenants.organizationId, actor.organizationId))).limit(1);
  return !!own && own.id === ctx.tenantId;
}

async function assertAllowed(actor: Actor, action: WorkflowAction, ctx: RequestCtx): Promise<void> {
  if (actor.system || PM_ROLES.has(actor.role)) return;
  const owner = actor.role === "landlord" && ctx.ownerId === actor.id;
  let ok = false;
  switch (action) {
    case "approve":
    case "reject":
      ok = owner; break;
    case "assign":
    case "unassign":
      ok = owner || actor.role === "staff" || actor.role === "caretaker"; break;
    case "start":
    case "pause":
    case "complete":
      ok = (actor.role === "staff" || actor.role === "caretaker") && (await isAssignee(actor, ctx)); break;
    case "cancel":
      ok = owner || (actor.role === "tenant" && (await isOwnTenant(actor, ctx)) && (ctx.status === "pending" || ctx.status === "pending_approval")); break;
    case "reopen": {
      if (actor.role !== "tenant" || !(await isOwnTenant(actor, ctx))) break;
      const done = ctx.completedAt ? new Date(ctx.completedAt).getTime() : 0;
      if (!done || Date.now() - done > REOPEN_WINDOW_DAYS * 86_400_000) {
        throw new WorkflowError(403, `A request can only be reopened within ${REOPEN_WINDOW_DAYS} days of completion. Please raise a new request.`, "REOPEN_WINDOW");
      }
      ok = true; break;
    }
  }
  if (ok) return;
  if ((action === "start" || action === "pause" || action === "complete") && (actor.role === "staff" || actor.role === "caretaker")) {
    throw new WorkflowError(403, "This job isn't assigned to you.", "NOT_ASSIGNEE");
  }
  throw new WorkflowError(403, `You can't ${ACTION_VERB[action]} this request.`, "FORBIDDEN");
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────────
/** Admins/managers of the organisation plus the property's owner — the people who oversee a request. */
export async function oversightUserIds(orgId: number, ownerId: string | null, exclude: string[] = []): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, orgId), inArray(users.role as any, ["admin", "manager"]), sql`${users.isActive} IS DISTINCT FROM false`));
  const ids = new Set(rows.map((r) => r.id));
  if (ownerId) ids.add(ownerId);
  for (const x of exclude) ids.delete(x);
  return [...ids];
}

export async function notifyOversight(
  orgId: number, ctx: { id: number; ownerId: string | null; ticketNumber: string; priority?: string | null },
  title: string, message: string, exclude: string[] = [],
) {
  try {
    for (const uid of await oversightUserIds(orgId, ctx.ownerId, exclude)) {
      pushNotification(uid, {
        type: "work_order", title, message, ts: new Date().toISOString(),
        link: `/maintenance-request/${ctx.id}`, meta: { requestId: ctx.id, priority: ctx.priority },
      });
    }
  } catch (e) { console.warn("[maintenance-workflow] oversight notify failed:", e); }
}

function broadcast(orgId: number, r: { id: number; status: string | null; title: string | null }, ctx: RequestCtx, assignedToUserId?: string | null) {
  try {
    notifyMaintenanceUpdated(orgId, {
      id: r.id, status: r.status ?? "pending", title: r.title ?? undefined,
      propertyName: ctx.propertyName ?? undefined,
      ...(assignedToUserId ? { assignedToUserId } : {}),
    });
  } catch { /* live updates are best effort */ }
}

/**
 * The request's comment thread is stored as a JSON array in maintenance_requests.internal_notes
 * (see the /comments routes). Nothing else may write plain text there — it would wipe the thread —
 * so approval/cancellation reasons are added to the thread as entries.
 */
export async function appendThreadNote(requestId: number, actor: Actor, content: string) {
  const [row] = await db.select({ notes: maintenanceRequests.internalNotes }).from(maintenanceRequests).where(eq(maintenanceRequests.id, requestId)).limit(1);
  let thread: any[] = [];
  try { thread = row?.notes ? JSON.parse(row.notes) : []; } catch { thread = []; }
  if (!Array.isArray(thread)) thread = [];
  thread.push({ id: Date.now(), authorId: actor.id || null, authorName: actor.name || (actor.system ? "Contractor" : "System"), content, createdAt: new Date().toISOString(), isTechnician: false, system: true });
  await db.update(maintenanceRequests).set({ internalNotes: JSON.stringify(thread) } as any).where(eq(maintenanceRequests.id, requestId));
}

// ── Work orders (the external-contractor side of a request) ──────────────────────────────────────
const ACTIVE_WO = ["draft", "pending_approval", "approved", "assigned", "in_progress", "on_hold"];

async function cancelActiveWorkOrders(requestId: number, note: string) {
  await db.update(workOrders)
    .set({ status: "cancelled", rejectionReason: note, updatedAt: new Date() } as any)
    .where(and(eq(workOrders.maintenanceRequestId, requestId), inArray(workOrders.status as any, ACTIVE_WO)));
}

async function completeActiveWorkOrders(requestId: number) {
  await db.update(workOrders)
    .set({ status: "completed", actualEndDate: new Date(), updatedAt: new Date() } as any)
    .where(and(eq(workOrders.maintenanceRequestId, requestId), inArray(workOrders.status as any, ACTIVE_WO)));
}

export interface AssignInput {
  technician?: { id: number; userId: string | null; name: string };
  contractor?: { id: number; name: string; userId?: string | null };
  scheduledDate?: string;
  estimatedCost?: string;
}

export interface TransitionInput extends AssignInput {
  reason?: string;       // reject / cancel / reopen
  comments?: string;     // approve
  approvedAmount?: number;
  technicianNotes?: string;
  actualCost?: string;
  totalTimeSpent?: number;
  /** The change came from the linked work order, which is already up to date. */
  fromWorkOrder?: boolean;
}

const minutesBetween = (a: Date | null | undefined, b: Date) =>
  a ? Math.max(0, Math.round((b.getTime() - new Date(a).getTime()) / 60000)) : null;

/**
 * Apply one action to a request. Throws WorkflowError (with an HTTP status) when the caller isn't
 * allowed, the request is in the wrong state, or it changed while we were working. Returns the updated row.
 */
export async function transition(requestId: number, action: WorkflowAction, actor: Actor, input: TransitionInput = {}) {
  const ctx = await loadRequestCtx(requestId, actor.organizationId);
  if (!ctx) throw new WorkflowError(404, "Maintenance request not found", "NOT_FOUND");
  if (!actor.system && !(await callerCanAccess(ctx, { user: actor }))) throw new WorkflowError(404, "Maintenance request not found", "NOT_FOUND");

  const rule = RULES[action];
  if (!rule.from.includes(ctx.status)) {
    const msg =
      action === "assign" && ctx.status === "pending_approval" ? "This request needs approval before it can be assigned."
      : action === "assign" ? `A ${ctx.status.replace("_", " ")} request can't be assigned.`
      : action === "start" && ctx.status === "pending" ? "Assign someone to this request before work can start."
      : action === "complete" && ctx.status === "pending" ? "Assign someone to this request before it can be completed."
      : `You can't ${ACTION_VERB[action]} a request that is ${ctx.status.replace("_", " ")}.`;
    throw new WorkflowError(409, msg, "BAD_STATE");
  }
  await assertAllowed(actor, action, ctx);

  const now = new Date();
  const set: Record<string, any> = { updatedAt: now };
  let to: RequestStatus = rule.to === "auto" ? "pending" : rule.to;
  let woContractorUserId: string | null = null;

  switch (action) {
    case "approve":
      Object.assign(set, {
        approvedBy: actor.system ? null : actor.id, approvedDate: now, rejectionReason: null,
        ...(input.approvedAmount != null ? { estimatedCost: String(input.approvedAmount) } : {}),
      });
      break;
    case "reject":
      Object.assign(set, { rejectionReason: (input.reason ?? input.comments ?? "").trim() || "Rejected", approvedBy: null, approvedDate: null });
      break;
    case "assign": {
      if (!input.technician && !input.contractor) throw new WorkflowError(400, "Choose who should do the work.", "NO_ASSIGNEE");
      Object.assign(set, {
        assignedDate: now, startedDate: null, workStartTime: null,
        ...(ctx.responseTime == null ? { responseTime: minutesBetween(ctx.createdAt, now) ?? 0 } : {}),
        ...(input.scheduledDate ? { scheduledDate: new Date(input.scheduledDate) } : {}),
        ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}),
      });
      if (input.technician) {
        Object.assign(set, { technicianId: input.technician.id, assignedTo: input.technician.userId, contractorId: null });
      } else if (input.contractor) {
        Object.assign(set, { technicianId: null, assignedTo: null, contractorId: input.contractor.id });
        woContractorUserId = input.contractor.userId ?? null;
      }
      break;
    }
    case "unassign":
      Object.assign(set, { technicianId: null, assignedTo: null, contractorId: null, assignedDate: null, startedDate: null, workStartTime: null });
      break;
    case "start":
      Object.assign(set, { startedDate: ctx.startedDate ?? now, workStartTime: now });
      break;
    case "pause":
      break;
    case "complete":
      Object.assign(set, {
        completedAt: now, workEndTime: now, startedDate: ctx.startedDate ?? ctx.assignedDate ?? now,
        resolutionTime: minutesBetween(ctx.assignedDate ?? ctx.createdAt, now),
        ...(input.technicianNotes ? { technicianNotes: input.technicianNotes } : {}),
        ...(input.actualCost ? { actualCost: input.actualCost } : {}),
        ...(input.totalTimeSpent != null ? { totalTimeSpent: input.totalTimeSpent } : {}),
      });
      break;
    case "cancel":
      break;
    case "reopen": {
      // Someone is still on the job → straight back to them; a contractor's finished work order needs a fresh dispatch.
      to = ctx.technicianId || ctx.assignedTo ? "assigned" : "pending";
      Object.assign(set, {
        completedAt: null, workEndTime: null, resolutionTime: null, startedDate: null, workStartTime: null,
        contractorId: null, satisfactionRating: null, satisfactionComments: null, feedbackDate: null,
        ...(input.reason ? { tenantNotes: input.reason } : {}),
      });
      break;
    }
  }
  set.status = to;

  // Only apply if nobody changed the request since we read it.
  const [updated] = await db
    .update(maintenanceRequests)
    .set(set as any)
    .where(and(eq(maintenanceRequests.id, requestId), eq(maintenanceRequests.status, ctx.status as any)))
    .returning();
  if (!updated) throw new WorkflowError(409, "This request was just changed by someone else. Refresh and try again.", "CONFLICT");

  // ── Thread note: why it was approved / cancelled (comments live in the request's thread, see appendThreadNote) ──
  const threadText = action === "approve" ? input.comments : action === "cancel" && actor.role !== "tenant" ? (input.reason ? `Cancelled: ${input.reason}` : "Cancelled") : action === "reject" ? `Rejected: ${updated.rejectionReason}` : undefined;
  if (threadText) await appendThreadNote(requestId, actor, threadText).catch(() => {});

  // ── Work-order bookkeeping ──
  try {
    if (!input.fromWorkOrder) {
      if (action === "assign" && input.contractor) {
        await ensureContractorWorkOrder(ctx, input.contractor, actor, input);
      } else if (action === "assign" || action === "unassign" || action === "cancel" || action === "reject") {
        await cancelActiveWorkOrders(requestId, action === "assign" ? "Reassigned to an in-house technician" : action === "unassign" ? "Unassigned" : "Request cancelled");
      } else if (action === "complete") {
        await completeActiveWorkOrders(requestId);
      }
    }
  } catch (e) { console.warn("[maintenance-workflow] work order sync failed:", e); }

  // ── Notifications (never block or fail the transition) ──
  afterTransition(action, ctx, updated, actor, input, woContractorUserId).catch((e) => console.warn("[maintenance-workflow] notify failed:", e));
  return updated;
}

async function ensureContractorWorkOrder(ctx: RequestCtx, c: NonNullable<AssignInput["contractor"]>, actor: Actor, input: AssignInput) {
  const [existing] = await db.select().from(workOrders)
    .where(and(eq(workOrders.maintenanceRequestId, ctx.id), inArray(workOrders.status as any, ACTIVE_WO))).limit(1);
  if (existing) {
    await db.update(workOrders)
      .set({ contractorId: c.id, status: "assigned", rejectionReason: null, ...(input.estimatedCost ? { estimatedCost: input.estimatedCost } : {}), updatedAt: new Date() } as any)
      .where(eq(workOrders.id, existing.id));
    return;
  }
  await storage.createWorkOrder({
    maintenanceRequestId: ctx.id,
    workOrderType: "maintenance",
    title: ctx.title ?? `Request ${ctx.ticketNumber}`,
    description: ctx.description ?? "",
    priority: (ctx.priority as any) ?? "medium",
    status: "assigned",
    contractorId: c.id,
    estimatedCost: (input.estimatedCost ?? ctx.estimatedCost ?? undefined) as any,
    approvalRequired: false,
    createdBy: actor.system ? (actor.id || undefined) : actor.id,
  } as any);
}

const FRIENDLY: Record<WorkflowAction, string> = {
  approve: "approved", reject: "rejected", assign: "assigned", unassign: "unassigned", start: "started",
  pause: "paused", complete: "completed", cancel: "cancelled", reopen: "reopened",
};

async function afterTransition(action: WorkflowAction, ctx: RequestCtx, updated: any, actor: Actor, input: TransitionInput, contractorUserId: string | null) {
  const org = actor.organizationId;
  const assigneeUserId: string | null = updated.assignedTo ?? ctx.assignedTo ?? null;
  broadcast(org, updated, ctx, action === "assign" ? (input.technician?.userId ?? null) : assigneeUserId);

  const t = ctx.ticketNumber;
  const who = actor.name || (actor.system ? "The contractor" : "A team member");
  const link = `/maintenance-request/${ctx.id}`;

  // A contractor moved it from their portal, which already told the managers and the tenant itself —
  // the only person it doesn't reach is the property's owner.
  if (input.fromWorkOrder) {
    if (ctx.ownerId && (action === "start" || action === "complete" || action === "unassign")) {
      const text = action === "start" ? `${who} started ${ctx.title ?? t} (#${t}).` : action === "complete" ? `${who} completed ${ctx.title ?? t} (#${t}).` : `${who} declined ${ctx.title ?? t} (#${t}); a new assignee is needed.`;
      pushNotification(ctx.ownerId, { type: "work_order", title: action === "complete" ? "Job completed" : action === "start" ? "Work started" : "Contractor declined the job", message: text, ts: new Date().toISOString(), link, meta: { requestId: ctx.id } });
    }
    return;
  }

  // The tenant
  if (ctx.tenantId) {
    const tn = (e: Parameters<typeof notifyTenant>[1]) => notifyTenant(ctx.tenantId!, e).catch(() => {});
    if (action === "assign") await tn({ type: "maintenance_assigned", ticketNumber: t, technicianName: input.technician?.name ?? input.contractor?.name, ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}) });
    else if (action === "start") await tn({ type: "maintenance_in_progress", ticketNumber: t });
    else if (action === "complete") await tn({ type: "maintenance_completed", ticketNumber: t });
    else if (action === "reject") await tn({ type: "maintenance_rejected", ticketNumber: t, reason: updated.rejectionReason ?? undefined });
    else if (action === "cancel" && actor.role !== "tenant") await tn({ type: "custom", message: `Your maintenance request #${t} was cancelled${input.reason ? `: ${input.reason}` : "."} Raise a new request if the problem is still there.` });
    else if (action === "reopen" && actor.role !== "tenant") await tn({ type: "custom", message: `Your maintenance request #${t} has been reopened and we're lining up a follow-up visit.` });
  }

  // Whoever is doing the work
  if (action === "assign") {
    const uid = input.technician?.userId ?? contractorUserId;
    if (uid) pushNotification(uid, { type: "assignment", title: "New job assigned to you", message: ctx.title ?? `Request ${t}`, ts: new Date().toISOString(), link: input.contractor ? "/contractor-portal" : "/staff-portal", meta: { requestId: ctx.id, status: updated.status, priority: ctx.priority } });
  } else if ((action === "unassign" || action === "cancel" || action === "reopen") && assigneeUserId && assigneeUserId !== actor.id) {
    pushNotification(assigneeUserId, { type: "assignment", title: `Job ${FRIENDLY[action]}`, message: `${ctx.title ?? t} was ${FRIENDLY[action]}.`, ts: new Date().toISOString(), link, meta: { requestId: ctx.id } });
  }

  // The people who oversee it
  const me = actor.id ? [actor.id] : [];
  if (action === "complete") await notifyOversight(org, ctx, "Job completed", `${who} completed ${ctx.title ?? t} (#${t}).`, me);
  else if (action === "start") await notifyOversight(org, ctx, "Work started", `${who} started ${ctx.title ?? t} (#${t}).`, me);
  else if (action === "cancel" && actor.role === "tenant") await notifyOversight(org, ctx, "Request withdrawn", `The tenant withdrew ${ctx.title ?? t} (#${t}).`, me);
  else if (action === "reopen") await notifyOversight(org, ctx, "Request reopened", `${ctx.title ?? t} (#${t}) was reopened${input.reason ? `: ${input.reason}` : "."}`, me);
  else if (action === "approve") await notifyOversight(org, ctx, "Request approved", `${who} approved ${ctx.title ?? t} (#${t}) — it's ready to be assigned.`, me);
  else if (action === "reject") await notifyOversight(org, ctx, "Request rejected", `${who} rejected ${ctx.title ?? t} (#${t}).${updated.rejectionReason ? ` Reason: ${updated.rejectionReason}` : ""}`, me);
}

// ── Rating ───────────────────────────────────────────────────────────────────────────────────────
/** The tenant rates a COMPLETED request, once. (A reopened request can be rated again after the next fix.) */
export async function rateRequest(requestId: number, actor: Actor, input: { rating: number; comments?: string }) {
  if (actor.role !== "tenant") throw new WorkflowError(403, "Only the tenant who raised the request can rate it.", "FORBIDDEN");
  const ctx = await loadRequestCtx(requestId, actor.organizationId);
  if (!ctx || !(await isOwnTenant(actor, ctx))) throw new WorkflowError(404, "Maintenance request not found", "NOT_FOUND");
  if (ctx.status !== "completed") throw new WorkflowError(409, "You can rate a request once the work is completed.", "NOT_COMPLETED");
  if (ctx.satisfactionRating != null) throw new WorkflowError(409, "You've already rated this request.", "ALREADY_RATED");

  const [updated] = await db
    .update(maintenanceRequests)
    .set({ satisfactionRating: input.rating, satisfactionComments: input.comments?.trim() || null, feedbackDate: new Date() } as any)
    .where(and(eq(maintenanceRequests.id, requestId), sql`${maintenanceRequests.satisfactionRating} IS NULL`))
    .returning();
  if (!updated) throw new WorkflowError(409, "You've already rated this request.", "ALREADY_RATED");

  if (input.rating <= 2) {
    const msg = `${ctx.title ?? ctx.ticketNumber} (#${ctx.ticketNumber}) got ${input.rating}★${input.comments ? `: "${input.comments.slice(0, 120)}"` : "."}`;
    notifyOversight(actor.organizationId, ctx, "Low rating from a tenant", msg).catch(() => {});
    if (ctx.assignedTo) pushNotification(ctx.assignedTo, { type: "assignment", title: "Tenant feedback", message: msg, ts: new Date().toISOString(), link: `/maintenance-request/${ctx.id}`, meta: { requestId: ctx.id } });
  }
  broadcast(actor.organizationId, updated, ctx);
  return updated;
}

// ── Creation & generic-update helpers ────────────────────────────────────────────────────────────
/** Fields only the workflow may write — stripped from anything a screen sends. */
export const WORKFLOW_OWNED_FIELDS = [
  "status", "approvalRequired", "approvedBy", "approvedDate", "rejectionReason",
  "assignedTo", "technicianId", "contractorId", "assignedDate", "startedDate", "workStartTime", "workEndTime",
  "completedAt", "responseTime", "resolutionTime",
  "satisfactionRating", "customerSatisfaction", "satisfactionComments", "feedbackDate", "ticketNumber",
] as const;

/** A brand-new request always starts as pending (or pending_approval when its cost needs sign-off) — whatever the client sent. */
/** Money fields arrive as numbers from some screens and strings from others; the schema (and numeric column) want strings. */
export function normalizeMoney<T extends Record<string, any>>(body: T): T {
  const out: Record<string, any> = { ...body };
  for (const k of ["estimatedCost", "actualCost"]) {
    if (out[k] === "" || out[k] === null) delete out[k];
    else if (typeof out[k] === "number") out[k] = Number.isFinite(out[k]) && out[k] >= 0 ? String(out[k]) : undefined;
  }
  return out as T;
}

export async function sanitizeNewRequest(body: Record<string, any>) {
  const out = normalizeMoney(body);
  for (const f of WORKFLOW_OWNED_FIELDS) delete out[f];
  if (out.estimatedCost != null && out.unitId != null && (await exceedsApprovalThreshold(out.unitId, out.estimatedCost))) {
    out.status = "pending_approval";
    out.approvalRequired = true;
  } else {
    out.status = "pending";
  }
  return out;
}

/** After a request is created: tell the people who oversee it (nobody was told before). */
export async function announceNewRequest(created: any, actor: Actor) {
  try {
    const ctx = await loadRequestCtx(created.id, actor.organizationId);
    if (!ctx) return;
    broadcast(actor.organizationId, created, ctx);
    const needsApproval = created.status === "pending_approval";
    const unitLabel = [ctx.propertyName].filter(Boolean).join(" · ");
    await notifyOversight(
      actor.organizationId, ctx,
      needsApproval ? "Request needs your approval" : "New maintenance request",
      `${created.title ?? ctx.ticketNumber}${unitLabel ? ` — ${unitLabel}` : ""} (${(created.priority ?? "medium")} priority).`,
      actor.id ? [actor.id] : [],
    );
  } catch (e) { console.warn("[maintenance-workflow] announce failed:", e); }
}

/** Generic edits (PUT/PATCH /:id) — which fields each kind of person may change. */
const ASSIGNEE_FIELDS = ["technicianNotes", "timeLog", "totalTimeSpent", "actualHours", "actualCost", "laborCost", "contractorNotes"];

export function filterGenericFields(role: string, isAssigneeOfRequest: boolean, body: Record<string, any>) {
  const out: Record<string, any> = {};
  // internalNotes holds the comment thread (JSON) — it is only written through the comments routes.
  const NEVER = new Set<string>([...WORKFLOW_OWNED_FIELDS, "internalNotes", "id", "createdAt", "updatedAt", "tenantId", "unitId"]);
  if (role === "landlord") return out; // landlords approve / reject / assign / cancel — they don't edit the details
  if (PM_ROLES.has(role)) {
    for (const [k, v] of Object.entries(body)) if (!NEVER.has(k)) out[k] = v;
    // PMs may still correct tenant/unit on a mis-filed request.
    if (PM_ROLES.has(role)) { if (body.tenantId !== undefined) out.tenantId = body.tenantId; if (body.unitId !== undefined) out.unitId = body.unitId; }
    return out;
  }
  if ((role === "staff" || role === "caretaker") && isAssigneeOfRequest) {
    for (const k of ASSIGNEE_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/** Map a screen's "set status to X" onto the matching action (so even plain status edits follow the rules). */
export function actionForStatusChange(from: RequestStatus, to: RequestStatus): WorkflowAction | "assign-needs-target" | null {
  if (from === to) return null;
  switch (to) {
    case "pending": return from === "pending_approval" ? "approve" : from === "completed" ? "reopen" : "unassign";
    case "assigned": return from === "in_progress" ? "pause" : "assign-needs-target";
    case "in_progress": return "start";
    case "completed": return "complete";
    case "cancelled": return from === "pending_approval" ? "reject" : "cancel";
    case "pending_approval": return null;
  }
  return null;
}

export async function isAssigneeOfRequest(actor: Actor, ctx: RequestCtx) {
  return isAssignee(actor, ctx);
}

/** Work-order → request sync for the contractor portal (the contractor is the "system" actor). */
export async function syncFromWorkOrder(workOrderId: number, action: "start" | "complete" | "unassign", contractorName: string, extra: TransitionInput = {}) {
  const [wo] = await db.select({ requestId: workOrders.maintenanceRequestId }).from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
  if (!wo?.requestId) return null;
  const [unit] = await db
    .select({ orgId: units.organizationId })
    .from(maintenanceRequests).innerJoin(units, eq(maintenanceRequests.unitId, units.id))
    .where(eq(maintenanceRequests.id, wo.requestId)).limit(1);
  if (!unit) return null;
  const actor: Actor = { id: "", role: "contractor", organizationId: unit.orgId, name: contractorName, system: true };
  try {
    return await transition(wo.requestId, action, actor, { ...extra, fromWorkOrder: true });
  } catch (e) {
    if (e instanceof WorkflowError && (e.code === "BAD_STATE" || e.code === "NOT_FOUND")) return null; // already in the right state / request gone
    throw e;
  }
}

export async function contractorUserId(email: string | null | undefined, orgId: number): Promise<string | null> {
  if (!email) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.organizationId, orgId))).limit(1);
  return u?.id ?? null;
}

export { contractors };
