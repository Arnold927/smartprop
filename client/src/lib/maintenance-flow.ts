/**
 * Client side of the maintenance workflow — mirrors server/services/maintenance-workflow.ts so every screen
 * offers the same actions, for the right people, at the right moments. The server is the authority (it re-checks
 * everything); this only decides which buttons to show.
 *
 *   pending_approval → (approve) → pending → (assign) → assigned → (start) → in_progress → (complete) → completed
 *   reject / cancel → cancelled        pause: in_progress → assigned        reopen: completed → assigned/pending
 */
import { apiRequest } from "@/lib/queryClient";

export type RequestStatus = "pending" | "pending_approval" | "assigned" | "in_progress" | "completed" | "cancelled";
export type FlowAction = "assign" | "unassign" | "start" | "pause" | "complete" | "cancel" | "reopen" | "approve";

export const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Awaiting approval",
  pending: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const REOPEN_WINDOW_DAYS = 14;

export interface FlowRequest {
  id: number;
  status: string;
  technicianId?: number | null;
  assignedTo?: string | null;
  contractorId?: number | null;
  completedAt?: string | Date | null;
  satisfactionRating?: number | null;
}

export interface FlowViewer {
  role?: string | null;
  /** The signed-in user's id and (if they are staff) staff-member ids — used to recognise "my" job. */
  userId?: string | null;
  staffIds?: number[];
}

const PM = new Set(["platform_admin", "admin", "manager"]);

export function isMine(r: FlowRequest, v: FlowViewer): boolean {
  if (r.assignedTo && v.userId && r.assignedTo === v.userId) return true;
  return !!r.technicianId && (v.staffIds ?? []).includes(r.technicianId);
}

export function canReopen(r: FlowRequest): boolean {
  if (r.status !== "completed" || !r.completedAt) return false;
  return Date.now() - new Date(r.completedAt).getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;
}

/** Actions this person can take on this request right now. */
export function availableActions(r: FlowRequest, v: FlowViewer): FlowAction[] {
  const role = v.role ?? "";
  const pm = PM.has(role);
  const landlord = role === "landlord";
  const worker = role === "staff" || role === "caretaker";
  const out: FlowAction[] = [];
  switch (r.status) {
    case "pending_approval":
      if (pm || landlord) out.push("approve");
      if (pm || landlord) out.push("cancel");
      break;
    case "pending":
      if (pm || landlord || worker) out.push("assign");
      if (pm || landlord) out.push("cancel");
      break;
    case "assigned":
      if (pm || (worker && isMine(r, v))) out.push("start", "complete");
      if (pm || landlord || worker) out.push("assign", "unassign");
      if (pm || landlord) out.push("cancel");
      break;
    case "in_progress":
      if (pm || (worker && isMine(r, v))) out.push("complete", "pause");
      if (pm || landlord || worker) out.push("assign", "unassign");
      if (pm || landlord) out.push("cancel");
      break;
    case "completed":
      if (role === "tenant" && canReopen(r)) out.push("reopen");
      break;
    case "cancelled":
      break;
  }
  return out;
}

export const ACTION_LABEL: Record<FlowAction, string> = {
  assign: "Assign",
  unassign: "Unassign",
  start: "Start work",
  pause: "Pause",
  complete: "Mark complete",
  cancel: "Cancel request",
  reopen: "Reopen",
  approve: "Approve / Reject",
};

/** Turn a thrown api error ('{"message":"…"}' text) into something a person can read. */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  try {
    const j = JSON.parse(raw);
    if (j?.message) return String(j.message);
    if (Array.isArray(j?.errors) && j.errors[0]?.message) return String(j.errors[0].message);
  } catch { /* not JSON */ }
  return raw && raw.length < 200 ? raw : fallback;
}

/** start / pause / complete / cancel / reopen — one call, server applies the rules. */
export async function runAction(
  id: number,
  action: "start" | "pause" | "complete" | "cancel" | "reopen",
  body: { reason?: string; technicianNotes?: string; actualCost?: string | number } = {},
) {
  const res = await apiRequest(`/api/maintenance-requests/${id}/${action}`, { method: "PATCH", data: body });
  return res.json();
}

/** Rate a completed request (tenant, once). */
export async function rateRequest(id: number, rating: number, comments?: string) {
  const res = await apiRequest(`/api/maintenance-requests/${id}/feedback`, { method: "PATCH", data: { rating, comments } });
  return res.json();
}
