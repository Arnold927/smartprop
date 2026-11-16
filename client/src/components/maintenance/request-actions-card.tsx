import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, Calendar, Play, Pause, XCircle, ShieldCheck, Star, UserPlus, Wrench, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { TechnicianSelect, useAssignTechnician, AddTeamMemberDialog, AssignTechnicianDialog } from "@/components/technician-picker";
import { ReasonDialog } from "@/components/maintenance/reason-dialog";
import { availableActions, runAction, apiErrorMessage, STATUS_LABEL, type FlowAction } from "@/lib/maintenance-flow";

export interface ActionsCardRequest {
  id: number;
  title: string;
  status: string;
  technicianId?: number | null;
  assignedTo?: string | null;
  contractorId?: number | null;
  estimatedCost?: string | null;
  actualCost?: string | null;
  currency?: string | null;
  scheduledDate?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
  approvalRequired?: boolean | null;
  satisfactionRating?: number | null;
  satisfactionComments?: string | null;
  // charge-back (the tenant pays for this repair)
  chargeTenant?: boolean | null;
  tenantChargeAmount?: string | null;        // the amount someone agreed (empty = whatever the repair cost)
  tenantChargeBilledAmount?: string | null;  // what the tenant was actually billed
  tenantChargeReason?: string | null;
  tenantChargeBillStatus?: string | null;
  tenantCurrency?: string | null;
}

/**
 * "Status & actions" for one request: only the moves that are valid right now, for this person.
 * Replaces the free "Update status" drop-down (which let anyone jump to any status and skipped the real steps),
 * the stub "Schedule visit" button, and a cost button that needed a work order that usually didn't exist.
 */
export function RequestActionsCard({
  request, role, userId, assigneeName, canAddTech, linkedWorkOrderId, onOpenCostBreakdown, onChanged,
}: {
  request: ActionsCardRequest;
  role?: string | null;
  userId?: string | null;
  assigneeName?: string | null;
  canAddTech?: boolean;
  /** Set only for a request handed to an external contractor — their cost breakdown lives on the work order. */
  linkedWorkOrderId?: number | null;
  onOpenCostBreakdown?: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const acts = availableActions(request, { role, userId });
  const assignTechnician = useAssignTechnician(onChanged);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: [`/api/maintenance-requests/${request.id}`] });
    qc.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
    onChanged?.();
  };
  const fail = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [addTechOpen, setAddTechOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [unchargeOpen, setUnchargeOpen] = useState(false);

  const act = useMutation({
    mutationFn: async ({ action, reason, notes, cost }: { action: "start" | "pause" | "complete" | "cancel"; reason?: string; notes?: string; cost?: string }) =>
      runAction(request.id, action, { reason, technicianNotes: notes, actualCost: cost || undefined }),
    onSuccess: (_d, v) => {
      refresh();
      setCancelOpen(false); setCompleteOpen(false);
      toast({ title: v.action === "start" ? "Work started" : v.action === "complete" ? "Marked complete — the tenant has been asked for feedback" : v.action === "pause" ? "Paused — back to assigned" : "Request cancelled" });
    },
    onError: fail("Couldn't update the request"),
  });

  const edit = useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await apiRequest(`/api/maintenance-requests/${request.id}`, { method: "PUT", data })).json(),
    onSuccess: (r: any) => {
      refresh(); setCostOpen(false);
      toast({
        title: r?.status === "pending_approval" && request.status !== "pending_approval" ? "Sent for approval" : "Saved",
        description: r?.status === "pending_approval" && request.status !== "pending_approval" ? "That cost is above the approval limit, so the owner/manager has to approve it first." : undefined,
      });
    },
    onError: fail("Couldn't save"),
  });

  const decide = useMutation({
    mutationFn: async ({ approvalStatus, comments, approvedAmount }: { approvalStatus: "approved" | "rejected"; comments?: string; approvedAmount?: number }) =>
      (await apiRequest(`/api/maintenance-requests/${request.id}/approve`, { method: "POST", data: { approvalStatus, comments, approvedAmount } })).json(),
    onSuccess: (_d, v) => { refresh(); setApproveOpen(false); toast({ title: v.approvalStatus === "approved" ? "Approved — it's ready to assign" : "Rejected — the tenant has been told" }); },
    onError: fail("Couldn't record the decision"),
  });

  const charge = useMutation({
    mutationFn: async (data: { charge: boolean; amount?: string; reason?: string }) =>
      (await apiRequest(`/api/maintenance-requests/${request.id}/charge`, { method: "PATCH", data: { ...data, amount: data.amount ? Number(data.amount) : null } })).json(),
    onSuccess: (_d, v) => {
      refresh(); setChargeOpen(false); setUnchargeOpen(false);
      toast({ title: v.charge ? (request.status === "completed" ? "Charged to the tenant — they've been billed" : "Saved — the tenant is billed when the job is completed") : "Charge removed" });
    },
    onError: fail("Couldn't update the charge"),
  });

  const canApprove = acts.includes("approve");
  const canAssign = acts.includes("assign");
  const canUnassign = acts.includes("unassign");
  const canSchedule = ["pending", "assigned", "in_progress"].includes(request.status) && (canAssign || acts.includes("start"));
  const isPM = ["platform_admin", "admin", "manager"].includes(role ?? "");
  const canCharge = request.status !== "cancelled" && request.status !== "pending_approval" && (isPM || role === "landlord");
  const canCost = request.status !== "cancelled" && (isPM || canAssign || acts.includes("complete") || acts.includes("approve"));
  const hasAssignee = !!(request.technicianId || request.contractorId);
  const isLive = ["pending", "assigned", "in_progress"].includes(request.status);
  const waiting = request.status === "pending_approval";

  return (
    <Card className="border-border" data-testid="request-actions-card">
      <CardHeader>
        <CardTitle>Status & Actions</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="flow-status">{STATUS_LABEL[request.status] ?? request.status}</Badge>
          {hasAssignee && (
            <span className="text-sm text-muted-foreground">
              {request.contractorId ? "with contractor" : "to"} {assigneeName || (request.contractorId ? "a contractor" : "a technician")}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {waiting && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900 p-3 space-y-2" data-testid="approval-banner">
            <p className="text-sm font-medium text-violet-800 dark:text-violet-300 flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Needs approval before work can start</p>
            <p className="text-xs text-violet-700/80 dark:text-violet-300/80">The estimated cost is above this property's approval limit.</p>
            {canApprove ? (
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => setApproveOpen(true)} data-testid="review-approval">Review &amp; decide</Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Waiting for the manager or property owner.</p>
            )}
          </div>
        )}
        {request.status === "cancelled" && request.rejectionReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
            <span className="font-medium">Rejected:</span> {request.rejectionReason}
          </div>
        )}

        {/* The next step(s) */}
        {(acts.includes("start") || acts.includes("complete") || acts.includes("pause")) && (
          <div className="grid gap-2">
            {acts.includes("start") && (
              <Button onClick={() => act.mutate({ action: "start" })} disabled={act.isPending} className="w-full bg-emerald-700 hover:bg-emerald-800" data-testid="act-start">
                <Play className="h-4 w-4 mr-2" /> Start work
              </Button>
            )}
            {acts.includes("complete") && (
              <Button onClick={() => setCompleteOpen(true)} disabled={act.isPending} className="w-full bg-emerald-700 hover:bg-emerald-800" data-testid="act-complete">
                <CheckCircle className="h-4 w-4 mr-2" /> Mark complete
              </Button>
            )}
            {acts.includes("pause") && (
              <Button variant="outline" onClick={() => act.mutate({ action: "pause" })} disabled={act.isPending} className="w-full" data-testid="act-pause">
                <Pause className="h-4 w-4 mr-2" /> Pause (back to assigned)
              </Button>
            )}
          </div>
        )}

        {request.status === "completed" && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1" data-testid="completed-summary">
            <p className="font-medium flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-emerald-600" /> Completed{request.completedAt ? ` ${new Date(request.completedAt).toLocaleDateString()}` : ""}</p>
            {request.satisfactionRating ? (
              <p className="flex items-center gap-1 text-muted-foreground" data-testid="tenant-rating">
                Tenant rated it {Array.from({ length: 5 }, (_, i) => <Star key={i} className={`h-3.5 w-3.5 ${i < request.satisfactionRating! ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />)}
                {request.satisfactionComments ? <span className="ml-1 italic">“{request.satisfactionComments}”</span> : null}
              </p>
            ) : <p className="text-muted-foreground">Waiting for the tenant's feedback.</p>}
          </div>
        )}

        {/* Who does the work */}
        {isLive && (canAssign || canUnassign) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>{hasAssignee ? "Re-assign" : "Assign to"}</Label>
              <TechnicianSelect
                value={request.technicianId ?? null}
                disabled={assignTechnician.isPending}
                onChange={(sid) => assignTechnician.mutate({ requestId: request.id, technicianId: sid })}
                placeholder="Choose who will do the work"
                className="border-border"
              />
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {canAddTech && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setAddTechOpen(true)}>
                      <UserPlus className="h-3 w-3" /> Add a technician
                    </Button>
                  )}
                  {["platform_admin", "admin", "manager", "staff"].includes(role ?? "") && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setAssignOpen(true)} data-testid="open-contractor">
                      <Wrench className="h-3 w-3" /> Contractor…
                    </Button>
                  )}
                </div>
                {hasAssignee && canUnassign && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => assignTechnician.mutate({ requestId: request.id, technicianId: null })} disabled={assignTechnician.isPending}>
                    <XCircle className="h-3 w-3 mr-1" /> Unassign
                  </Button>
                )}
              </div>
              {!hasAssignee && request.status === "pending" && <p className="text-[11px] text-muted-foreground">Nobody is on this yet — assign someone and the tenant is told straight away.</p>}
            </div>
            <AddTeamMemberDialog open={addTechOpen} onOpenChange={setAddTechOpen}
              onCreated={(sid) => assignTechnician.mutate({ requestId: request.id, technicianId: sid })} />
            <AssignTechnicianDialog request={assignOpen ? { id: request.id, title: request.title, technicianId: request.technicianId, contractorId: request.contractorId } : null}
              onOpenChange={(o) => { setAssignOpen(o); if (!o) refresh(); }} />
          </>
        )}

        {(canSchedule || canCost) && <Separator />}
        {canSchedule && <ScheduleVisit current={request.scheduledDate} busy={edit.isPending} onSave={(iso) => edit.mutate({ scheduledDate: iso })} />}
        {canCost && (
          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={() => setCostOpen(true)} data-testid="open-cost">
              <DollarSign className="h-4 w-4 mr-2" /> Update cost
            </Button>
            {linkedWorkOrderId && onOpenCostBreakdown && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onOpenCostBreakdown}>Contractor cost breakdown</Button>
            )}
          </div>
        )}

        {canCharge && (
          <ChargeSection request={request} busy={charge.isPending}
            onEdit={() => setChargeOpen(true)} onRemove={() => setUnchargeOpen(true)} />
        )}

        {acts.includes("cancel") && (
          <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setCancelOpen(true)} data-testid="act-cancel">
            <XCircle className="h-4 w-4 mr-2" /> Cancel request
          </Button>
        )}
      </CardContent>

      <ReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel this request?"
        description="The tenant and anyone assigned will be told. The record stays in the history."
        confirmLabel="Cancel request" destructive busy={act.isPending}
        onConfirm={(reason) => act.mutate({ action: "cancel", reason })} />
      <CompleteDialog open={completeOpen} onOpenChange={setCompleteOpen} busy={act.isPending} currency={request.currency ?? "KES"} defaultCost={request.actualCost ?? ""}
        onConfirm={(notes, cost) => act.mutate({ action: "complete", notes, cost })} />
      <ApprovalDialog open={approveOpen} onOpenChange={setApproveOpen} busy={decide.isPending} estimated={request.estimatedCost ?? ""} currency={request.currency ?? "KES"}
        onDecide={(d) => decide.mutate(d)} />
      <ChargeDialog open={chargeOpen} onOpenChange={setChargeOpen} busy={charge.isPending} request={request}
        onSave={(d) => charge.mutate({ charge: true, ...d })} />
      <ReasonDialog open={unchargeOpen} onOpenChange={setUnchargeOpen} title="Take the charge off the tenant?"
        description="The unpaid repair bill is removed from the tenant's account and they are told."
        confirmLabel="Remove charge" destructive busy={charge.isPending}
        onConfirm={() => charge.mutate({ charge: false })} />
      <CostDialog open={costOpen} onOpenChange={setCostOpen} busy={edit.isPending} request={request}
        onSave={(data) => edit.mutate(data)} />
    </Card>
  );
}

function ScheduleVisit({ current, busy, onSave }: { current?: string | null; busy: boolean; onSave: (iso: string) => void }) {
  const toLocal = (v?: string | null) => { if (!v) return ""; const d = new Date(v); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [val, setVal] = useState(toLocal(current));
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Visit date &amp; time</Label>
      <div className="flex gap-2 min-w-0">
        <Input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} className="border-border min-w-0 flex-1" data-testid="schedule-input" />
        <Button variant="outline" className="shrink-0" disabled={!val || busy} onClick={() => onSave(new Date(val).toISOString())} data-testid="schedule-save">Set</Button>
      </div>
    </div>
  );
}

export function CompleteDialog({ open, onOpenChange, onConfirm, busy, currency, defaultCost }: {
  open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (notes: string, cost: string) => void; busy: boolean; currency: string; defaultCost: string;
}) {
  const [notes, setNotes] = useState(""); const [cost, setCost] = useState(defaultCost);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setNotes(""); setCost(defaultCost); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as complete</DialogTitle>
          <DialogDescription>The tenant is told it's done and asked to rate the work.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>What was done? <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. Replaced the washer and tested for leaks" data-testid="complete-notes" /></div>
          <div><Label>Final cost ({currency}) <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" data-testid="complete-cost" /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Back</Button>
          <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={busy} onClick={() => onConfirm(notes.trim(), cost.trim())} data-testid="complete-confirm">{busy ? "Saving…" : "Mark complete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalDialog({ open, onOpenChange, onDecide, busy, estimated, currency }: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; estimated: string; currency: string;
  onDecide: (d: { approvalStatus: "approved" | "rejected"; comments?: string; approvedAmount?: number }) => void;
}) {
  const [comments, setComments] = useState(""); const [amount, setAmount] = useState(estimated);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setComments(""); setAmount(estimated); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve or reject</DialogTitle>
          <DialogDescription>Estimated cost is above this property's approval limit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Approved amount ({currency})</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} data-testid="approve-amount" /></div>
          <div><Label>Note <span className="text-muted-foreground font-normal">(required to reject)</span></Label>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} data-testid="approve-note" /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" disabled={busy || !comments.trim()}
            onClick={() => onDecide({ approvalStatus: "rejected", comments: comments.trim() })} data-testid="approve-reject">Reject</Button>
          <Button disabled={busy} className="bg-emerald-700 hover:bg-emerald-800"
            onClick={() => onDecide({ approvalStatus: "approved", comments: comments.trim() || undefined, approvedAmount: amount ? Number(amount) : undefined })} data-testid="approve-confirm">Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostDialog({ open, onOpenChange, onSave, busy, request }: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; request: ActionsCardRequest; onSave: (d: Record<string, unknown>) => void;
}) {
  const [est, setEst] = useState(request.estimatedCost ?? ""); const [act, setAct] = useState(request.actualCost ?? "");
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setEst(request.estimatedCost ?? ""); setAct(request.actualCost ?? ""); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cost</DialogTitle>
          <DialogDescription>An estimate above the property's approval limit sends the request for approval first.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Estimated ({request.currency ?? "KES"})</Label>
            <Input inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value.replace(/[^\d.]/g, ""))} data-testid="cost-estimated" /></div>
          <div><Label>Actual ({request.currency ?? "KES"})</Label>
            <Input inputMode="decimal" value={act} onChange={(e) => setAct(e.target.value.replace(/[^\d.]/g, ""))} data-testid="cost-actual" /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Back</Button>
          <Button disabled={busy} onClick={() => onSave({ ...(est !== (request.estimatedCost ?? "") && est ? { estimatedCost: est } : {}), ...(act !== (request.actualCost ?? "") && act ? { actualCost: act } : {}) })} data-testid="cost-save">{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const chargeCurrency = (r: ActionsCardRequest) => r.tenantCurrency ?? r.currency ?? "KES";

/** "Charge to tenant": who pays for this repair. Billing happens on completion (or at once if it is already done). */
function ChargeSection({ request, busy, onEdit, onRemove }: { request: ActionsCardRequest; busy: boolean; onEdit: () => void; onRemove: () => void }) {
  const cur = chargeCurrency(request);
  if (!request.chargeTenant) {
    return (
      <Button variant="outline" className="w-full" onClick={onEdit} data-testid="open-charge">
        <DollarSign className="h-4 w-4 mr-2" /> Charge to tenant…
      </Button>
    );
  }
  const billed = request.tenantChargeBillStatus;
  const paid = billed === "paid";
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 p-3 text-sm space-y-1.5" data-testid="charge-status">
      <p className="font-medium flex items-center justify-between gap-2">
        <span>Charged to tenant{(request.tenantChargeBilledAmount ?? request.tenantChargeAmount) ? `: ${cur} ${Number(request.tenantChargeBilledAmount ?? request.tenantChargeAmount).toLocaleString()}` : ""}</span>
        {billed && <Badge variant="outline" className={paid ? "border-emerald-300 text-emerald-700" : "border-yellow-400 text-yellow-800"}>{paid ? "Paid" : "Billed · unpaid"}</Badge>}
      </p>
      {request.tenantChargeReason && <p className="text-muted-foreground">{request.tenantChargeReason}</p>}
      {!billed && <p className="text-xs text-muted-foreground">{request.status === "completed" ? "Set the amount to bill the tenant." : "The tenant is billed when the job is completed."}</p>}
      <div className="flex gap-2 pt-1">
        {!paid && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit} disabled={busy} data-testid="edit-charge">Edit</Button>}
        {!paid && <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50" onClick={onRemove} disabled={busy} data-testid="remove-charge">Remove</Button>}
        {paid && <p className="text-xs text-muted-foreground">Already paid — refund it from Finances if needed.</p>}
      </div>
    </div>
  );
}

function ChargeDialog({ open, onOpenChange, onSave, busy, request }: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; request: ActionsCardRequest; onSave: (d: { amount?: string; reason: string }) => void;
}) {
  const cur = chargeCurrency(request);
  const [amount, setAmount] = useState(request.tenantChargeAmount ?? "");
  const [reason, setReason] = useState(request.tenantChargeReason ?? "");
  const hint = request.actualCost || request.estimatedCost || "";
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setAmount(request.tenantChargeAmount ?? ""); setReason(request.tenantChargeReason ?? ""); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Charge this repair to the tenant</DialogTitle>
          <DialogDescription>
            The tenant sees the reason and the amount, and pays it from their portal like any other bill.
            {request.status === "completed" ? " The job is done, so they're billed straight away." : " They're billed when the job is completed."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Why is the tenant paying? <span className="text-red-600">*</span></Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Window broken by the tenant" data-testid="charge-reason" />
          </div>
          <div>
            <Label>Amount ({cur}) <span className="text-muted-foreground font-normal">— leave empty to bill the actual repair cost</span></Label>
            <Input inputMode="decimal" value={amount} placeholder={hint ? String(Number(hint)) : "Actual cost"}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} data-testid="charge-amount" />
            <p className="text-[11px] text-muted-foreground mt-1">Can't be more than what the repair actually cost.</p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Back</Button>
          <Button disabled={busy || reason.trim().length < 3} onClick={() => onSave({ amount: amount || undefined, reason: reason.trim() })} data-testid="charge-save">{busy ? "Saving…" : "Save charge"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
