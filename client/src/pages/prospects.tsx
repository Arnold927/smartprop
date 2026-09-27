/**
 * Prospects — /prospects
 *
 * Letting pipeline: vertical stage accordion + prospect list.
 * No horizontal scroll. Stage columns collapse/expand on click.
 * All actions use proper dialogs, never window.prompt().
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

import {
  Users, Plus, Loader2, ChevronRight, CheckCircle2, X, Calendar,
  Building, UserCheck, ClipboardList,
  ArrowRight, Home, Filter, ChevronDown, ChevronUp,
  Briefcase, Star, Clock, AlertCircle, Mail as MailIcon, Phone as PhoneIcon,
} from "lucide-react";

const fmt    = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const fmtKES = (n: any) => n ? `KES ${Math.round(Number(n)).toLocaleString("en-KE")}` : "—";

const STAGES = [
  { key: "new",                   label: "New Enquiry",    icon: Users,         dot: "bg-slate-400",   pill: "bg-slate-100 text-muted-foreground dark:bg-slate-800 dark:text-slate-300" },
  { key: "viewing_scheduled",     label: "Viewing Booked", icon: Calendar,      dot: "bg-blue-400",    pill: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { key: "viewed",                label: "Viewed",         icon: Home,          dot: "bg-indigo-400",  pill: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { key: "application_submitted", label: "Applied",        icon: ClipboardList, dot: "bg-purple-400",  pill: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  { key: "reference_checked",     label: "Refs Checked",   icon: UserCheck,     dot: "bg-cyan-500",    pill: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { key: "approved",              label: "Approved",       icon: CheckCircle2,  dot: "bg-emerald-400", pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { key: "lease_offered",         label: "Lease Offered",  icon: Star,          dot: "bg-amber-400",   pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { key: "converted",             label: "Converted",      icon: ArrowRight,    dot: "bg-green-500",   pill: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
];

function StageBadge({ status }: { status: string }) {
  const s = STAGES.find(x => x.key === status);
  if (!s) return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{status}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── Small reusable dialogs ─────────────────────────────────────────────────────

function ScheduleViewingDialog({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (date: string) => void; loading: boolean }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Schedule Viewing</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 mt-1" /></div>
          <div><Label className="text-xs">Time</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-9 mt-1" /></div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!date || loading} onClick={() => onConfirm(`${date}T${time}:00`)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefsDialog({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (notes: string) => void; loading: boolean }) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Reference Check</DialogTitle></DialogHeader>
        <Textarea className="mt-2" rows={3} placeholder="Notes from reference checks…" value={notes} onChange={e => setNotes(e.target.value)} />
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={loading} onClick={() => onConfirm(notes)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Mark checked
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (rent: number) => void; loading: boolean }) {
  const [rent, setRent] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Approve Prospect</DialogTitle></DialogHeader>
        <div className="mt-2"><Label className="text-xs">Offered monthly rent (KES)</Label><Input type="number" className="h-9 mt-1" value={rent} onChange={e => setRent(e.target.value)} placeholder="e.g. 45000" /></div>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!rent || loading} onClick={() => onConfirm(parseFloat(rent))} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-red-500" />Reject Prospect</DialogTitle></DialogHeader>
        <div className="mt-2"><Label className="text-xs">Reason *</Label><Textarea className="mt-1" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="State the reason for rejection…" /></div>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={!reason.trim() || loading} onClick={() => onConfirm(reason)}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Prospect detail panel ──────────────────────────────────────────────────────

function ProspectDetail({ prospect: initial, onClose, onRefresh }: { prospect: any; onClose: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const [prospect, setProspect] = useState(initial);
  const [dialog, setDialog] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState<any>({});

  const { data: units = [] } = useQuery({
    queryKey: ["/api/units", prospect.propertyId],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/units?propertyId=${prospect.propertyId}`)).json()),
    enabled: !!prospect.propertyId && showConvert,
  });

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) =>
      apiRequest(`/api/prospects/${prospect.id}/${path}`, { method: "POST", data: body ?? {} }),
    onSuccess: async (r) => {
      const updated = await r.json();
      if (updated.id) setProspect(updated);
      onRefresh();
      setDialog(null);
      toast({ title: "Updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const convert = useMutation({
    mutationFn: () => apiRequest(`/api/prospects/${prospect.id}/convert`, { method: "POST", data: convertForm }),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Prospect converted to tenant!" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const InfoRow = ({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: any }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5 break-words">{value || "—"}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-2 text-muted-foreground">
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" />Back
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-lg text-foreground">{prospect.firstName} {prospect.lastName}</h2>
            <StageBadge status={prospect.status} />
          </div>
          {prospect.propertyName && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building className="h-3 w-3" />{prospect.propertyName}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <Card className="rounded-2xl shadow-none border-border">
            <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">Contact</CardTitle></CardHeader>
            <CardContent className="px-5 pb-4">
              <InfoRow label="Email"       value={prospect.email}                     icon={MailIcon} />
              <InfoRow label="Phone"       value={prospect.phone}                     icon={PhoneIcon} />
              <InfoRow label="Source"      value={prospect.source?.replace(/_/g," ")} icon={Users} />
              <InfoRow label="Nationality" value={prospect.nationality} />
              <InfoRow label="National ID" value={prospect.nationalId} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-none border-border">
            <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">Financials</CardTitle></CardHeader>
            <CardContent className="px-5 pb-4">
              <InfoRow label="Employer"        value={prospect.employer}                                            icon={Briefcase} />
              <InfoRow label="Monthly income"  value={prospect.monthlyIncome ? fmtKES(prospect.monthlyIncome) : null} />
              <InfoRow label="Budget (max)"    value={prospect.budgetMax ? fmtKES(prospect.budgetMax) : null} />
              <InfoRow label="Preferred move-in" value={fmt(prospect.preferredMoveIn)}                              icon={Calendar} />
              {prospect.offeredRent && <InfoRow label="Offered rent" value={fmtKES(prospect.offeredRent)}          icon={Star} />}
            </CardContent>
          </Card>

          {(prospect.reference1Name || prospect.reference2Name) && (
            <Card className="rounded-2xl shadow-none border-border">
              <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">References</CardTitle></CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[{ name: prospect.reference1Name, phone: prospect.reference1Phone, rel: prospect.reference1Relation },
                    { name: prospect.reference2Name, phone: prospect.reference2Phone, rel: prospect.reference2Relation }]
                    .filter(r => r.name)
                    .map((r, i) => (
                      <div key={i} className="bg-muted/40 rounded-xl p-3">
                        <p className="font-semibold text-sm">{r.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.phone}{r.rel ? ` · ${r.rel}` : ""}</p>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card className="rounded-2xl shadow-none border-border sticky top-4">
            <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">Pipeline</CardTitle></CardHeader>
            <CardContent className="px-5 pb-4 space-y-1.5">
              {STAGES.filter(s => s.key !== "converted").map(stage => {
                const stageIdx = STAGES.findIndex(s => s.key === prospect.status);
                const thisIdx  = STAGES.findIndex(s => s.key === stage.key);
                const done    = thisIdx < stageIdx;
                const current = stage.key === prospect.status;
                return (
                  <div key={stage.key} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${current ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800" : ""}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${done ? "bg-emerald-500" : current ? "bg-emerald-500" : "bg-border"}`} />
                    <span className={`flex-1 ${current ? "font-semibold text-emerald-700 dark:text-emerald-400" : done ? "text-muted-foreground" : "text-muted-foreground"}`}>{stage.label}</span>
                    {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  </div>
                );
              })}

              <Separator className="my-3" />

              <div className="space-y-2">
                {prospect.status === "new" && (
                  <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setDialog("viewing")}>
                    <Calendar className="h-3.5 w-3.5 mr-1.5" />Schedule viewing
                  </Button>
                )}
                {prospect.status === "viewing_scheduled" && (
                  <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={action.isPending}
                    onClick={() => action.mutate({ path: "submit-application" })}>
                    {action.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ClipboardList className="h-3.5 w-3.5 mr-1.5" />}
                    Application received
                  </Button>
                )}
                {["viewed","application_submitted"].includes(prospect.status) && (
                  <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setDialog("refs")}>
                    <UserCheck className="h-3.5 w-3.5 mr-1.5" />References checked
                  </Button>
                )}
                {prospect.status === "reference_checked" && (
                  <>
                    <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setDialog("approve")}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDialog("reject")}>
                      <X className="h-3.5 w-3.5 mr-1.5" />Reject
                    </Button>
                  </>
                )}
                {["approved","lease_offered"].includes(prospect.status) && (
                  <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowConvert(true)}>
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5" />Convert to tenant
                  </Button>
                )}
                {prospect.status === "converted" && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-4 w-4" />Converted to tenant
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ScheduleViewingDialog open={dialog === "viewing"} onClose={() => setDialog(null)} loading={action.isPending}
        onConfirm={d => action.mutate({ path: "schedule-viewing", body: { viewingDate: new Date(d).toISOString() } })} />
      <RefsDialog open={dialog === "refs"} onClose={() => setDialog(null)} loading={action.isPending}
        onConfirm={notes => action.mutate({ path: "check-references", body: { notes } })} />
      <ApproveDialog open={dialog === "approve"} onClose={() => setDialog(null)} loading={action.isPending}
        onConfirm={rent => action.mutate({ path: "approve", body: { offeredRent: rent } })} />
      <RejectDialog open={dialog === "reject"} onClose={() => setDialog(null)} loading={action.isPending}
        onConfirm={reason => action.mutate({ path: "reject", body: { reason } })} />

      <Dialog open={showConvert} onOpenChange={setShowConvert}>
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader><DialogTitle>Convert to Tenant</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs">Unit *</Label>
              <Select value={String(convertForm.unitId ?? "")} onValueChange={v => setConvertForm((f: any) => ({ ...f, unitId: parseInt(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select vacant unit…" /></SelectTrigger>
                <SelectContent>
                  {(units as any[]).filter((u: any) => !u.isOccupied).map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>Unit {u.unitNumber} — {fmtKES(u.monthlyRent)}/mo</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Monthly rent (KES)</Label><Input className="mt-1 h-9" type="number" value={convertForm.monthlyRent ?? prospect.offeredRent ?? ""} onChange={e => setConvertForm((f: any) => ({ ...f, monthlyRent: e.target.value }))} /></div>
              <div><Label className="text-xs">Security deposit (KES)</Label><Input className="mt-1 h-9" type="number" value={convertForm.securityDeposit ?? ""} onChange={e => setConvertForm((f: any) => ({ ...f, securityDeposit: e.target.value }))} /></div>
              <div><Label className="text-xs">Lease start *</Label><Input className="mt-1 h-9" type="date" value={convertForm.leaseStartDate ?? ""} onChange={e => setConvertForm((f: any) => ({ ...f, leaseStartDate: e.target.value }))} /></div>
              <div><Label className="text-xs">Lease end *</Label><Input className="mt-1 h-9" type="date" value={convertForm.leaseEndDate ?? ""} onChange={e => setConvertForm((f: any) => ({ ...f, leaseEndDate: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" size="sm" onClick={() => setShowConvert(false)}>Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!convertForm.unitId || !convertForm.leaseStartDate || !convertForm.leaseEndDate || convert.isPending}
              onClick={() => convert.mutate()}>
              {convert.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Convert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pipeline view — vertical accordion ────────────────────────────────────────

function PipelineView({ properties, onSelectProspect }: { properties: any[]; onSelectProspect: (p: any) => void }) {
  const [propId, setPropId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["new","viewing_scheduled","approved"]));

  const { data: pipeline, isLoading, refetch } = useQuery({
    queryKey: ["/api/prospects/pipeline", propId],
    queryFn: async () => propId ? (await apiRequest(`/api/prospects/pipeline/${propId}`)).json() : null,
    enabled: !!propId,
  });

  const toggleStage = (key: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <Select value={propId} onValueChange={setPropId}>
          <SelectTrigger className="max-w-xs h-9"><SelectValue placeholder="Select a property…" /></SelectTrigger>
          <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!propId && (
        <div className="rounded-2xl border border-border bg-card py-16 text-center text-muted-foreground">
          <Building className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Select a property to view its letting pipeline</p>
        </div>
      )}

      {propId && isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {pipeline && (
        <div className="space-y-3">
          {pipeline.vacantUnits?.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                {pipeline.vacantUnits.length} vacant {pipeline.vacantUnits.length === 1 ? "unit" : "units"}
              </span>
              {pipeline.vacantUnits.map((u: any) => (
                <span key={u.id} className="text-xs px-2.5 py-1 rounded-full bg-white dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 font-medium">
                  {u.unitNumber} · {fmtKES(u.monthlyRent)}/mo
                </span>
              ))}
            </div>
          )}

          {STAGES.filter(s => s.key !== "converted").map(stage => {
            const cards: any[] = pipeline.pipeline?.[stage.key] ?? [];
            const isOpen = expanded.has(stage.key);
            const StageIcon = stage.icon;
            return (
              <Card key={stage.key} className="rounded-2xl shadow-none border-border overflow-hidden">
                <button className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left" onClick={() => toggleStage(stage.key)}>
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stage.dot}`} />
                  <StageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-semibold text-sm text-foreground flex-1">{stage.label}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cards.length > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                    {cards.length}
                  </span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>

                {isOpen && (
                  <div className="border-t border-border">
                    {cards.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-5">No prospects at this stage</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {cards.map((p: any) => (
                          <button key={p.id} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left" onClick={() => onSelectProspect(p)}>
                            <SPAvatar name={`${p.firstName ?? ""} ${p.lastName ?? ""}`} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-foreground">{p.firstName} {p.lastName}</p>
                              <p className="text-xs text-muted-foreground truncate">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                            </div>
                            <div className="hidden sm:flex flex-col items-end gap-0.5 text-xs text-muted-foreground flex-shrink-0">
                              {p.budgetMax && <span>{fmtKES(p.budgetMax)}/mo</span>}
                              {p.viewingDate && <span className="text-blue-600">{fmt(p.viewingDate)}</span>}
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}

          {(() => {
            const converted: any[] = pipeline.pipeline?.converted ?? [];
            return converted.length > 0 ? (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {converted.length} prospect{converted.length !== 1 ? "s" : ""} converted to tenant
              </div>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

// ── All prospects list ─────────────────────────────────────────────────────────

function AllProspectsView({ onSelect, properties, prospects: allProspects }: { onSelect: (p: any) => void; properties: any[]; prospects: any[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const filtered = (allProspects as any[]).filter((p: any) => {
    const q = search.toLowerCase();
    return (!q || `${p.firstName} ${p.lastName} ${p.email} ${p.phone ?? ""}`.toLowerCase().includes(q))
      && (statusFilter === "all" || p.status === statusFilter)
      && (propertyFilter === "all" || String(p.propertyId) === propertyFilter)
      && (sourceFilter === "all" || p.source === sourceFilter);
  });

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search prospects…"
        filters={
          <>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-9">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={propertyFilter} onValueChange={setPropertyFilter}>
              <SelectTrigger className="w-44 h-9">
                <Building className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="walk_in">Walk-in</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="portal">Portal</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <span className="text-sm text-muted-foreground whitespace-nowrap">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        }
      />

      {filtered.length === 0 && (
        <EmptyState
          icon={<Users />}
          title={search || statusFilter !== "all" || propertyFilter !== "all" || sourceFilter !== "all" ? "No prospects match your filters" : "No prospects yet"}
          description="Add a prospect or share your public application link"
          size="lg"
        />
      )}

      <div className="space-y-2">
        {filtered.map((p: any) => (
          <Card key={p.id} className="rounded-xl shadow-none border-border cursor-pointer hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-sm transition-all" onClick={() => onSelect(p)}>
            <CardContent className="px-5 py-3.5 flex items-center gap-4">
              <SPAvatar name={`${p.firstName ?? ""} ${p.lastName ?? ""}`} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-foreground">{p.firstName} {p.lastName}</p>
                  <StageBadge status={p.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {p.email}{p.phone ? ` · ${p.phone}` : ""}{p.propertyName ? ` · ${p.propertyName}` : ""}
                </p>
              </div>
              <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                {p.budgetMax && <span className="font-medium text-foreground"><KESAmount amount={p.budgetMax} />/mo</span>}
                {p.preferredMoveIn && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmt(p.preferredMoveIn)}</span>}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Create dialog ──────────────────────────────────────────────────────────────

function CreateProspectDialog({ open, onClose, properties, onCreated }: { open: boolean; onClose: () => void; properties: any[]; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({ source: "walk_in", nationality: "Kenyan" });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => apiRequest("/api/prospects", { method: "POST", data: form }),
    onSuccess: () => { onCreated(); onClose(); setForm({ source: "walk_in", nationality: "Kenyan" }); toast({ title: "Prospect added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><Label className="text-xs text-muted-foreground font-medium">{label}</Label><div className="mt-1">{children}</div></div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle>Add Prospect</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <F label="First name *"><Input className="h-9" value={form.firstName ?? ""} onChange={e => set("firstName", e.target.value)} placeholder="Jane" /></F>
            <F label="Last name *"><Input className="h-9" value={form.lastName ?? ""} onChange={e => set("lastName", e.target.value)} placeholder="Doe" /></F>
            <F label="Email *"><Input className="h-9" type="email" value={form.email ?? ""} onChange={e => set("email", e.target.value)} placeholder="jane@example.com" /></F>
            <F label="Phone"><Input className="h-9" value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+254 700 000 000" /></F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Property">
              <Select value={String(form.propertyId ?? "")} onValueChange={v => set("propertyId", parseInt(v))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Source">
              <Select value={form.source} onValueChange={v => set("source", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk_in">Walk-in</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="portal">Property portal</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Employer"><Input className="h-9" value={form.employer ?? ""} onChange={e => set("employer", e.target.value)} /></F>
            <F label="Monthly income (KES)"><Input className="h-9" type="number" value={form.monthlyIncome ?? ""} onChange={e => set("monthlyIncome", e.target.value)} /></F>
            <F label="Budget max (KES)"><Input className="h-9" type="number" value={form.budgetMax ?? ""} onChange={e => set("budgetMax", e.target.value)} /></F>
            <F label="Preferred move-in"><Input className="h-9" type="date" value={form.preferredMoveIn ?? ""} onChange={e => set("preferredMoveIn", e.target.value)} /></F>
            <F label="National ID"><Input className="h-9" value={form.nationalId ?? ""} onChange={e => set("nationalId", e.target.value)} /></F>
            <F label="Nationality"><Input className="h-9" value={form.nationality ?? ""} onChange={e => set("nationality", e.target.value)} /></F>
          </div>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={!form.firstName || !form.lastName || !form.email || create.isPending}
            onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Add prospect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Prospects() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const qc = useQueryClient();
  const [tab, setTab] = useState<"pipeline" | "all">("pipeline");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()),
  });

  const { data: allProspects = [] } = useQuery({
    queryKey: ["/api/prospects"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/prospects")).json()),
  });

  const active    = (allProspects as any[]).filter((p: any) => !["converted","rejected"].includes(p.status)).length;
  const converted = (allProspects as any[]).filter((p: any) => p.status === "converted").length;
  const viewings  = (allProspects as any[]).filter((p: any) => p.status === "viewing_scheduled").length;

  if (selected) return (
    <PageShell>
      <div className="max-w-5xl mx-auto">
        <ProspectDetail prospect={selected} onClose={() => setSelected(null)}
          onRefresh={() => qc.invalidateQueries({ queryKey: ["/api/prospects"] })} />
      </div>
    </PageShell>
  );

  return (
    <PageShell>
      <PageHeader
        title="Letting Pipeline"
        subtitle="Track prospects from first enquiry through to signed lease"
        icon={<Users className="w-5 h-5" />}
        actions={
          <PrimaryButton icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
            Add prospect
          </PrimaryButton>
        }
      />

      {/* KPI strip */}
      <StatsGrid cols={3}>
        <StatTile label="Active" value={active} icon={<Users className="w-4 h-4" />} accent="blue" />
        <StatTile label="Viewings" value={viewings} icon={<Calendar className="w-4 h-4" />} accent="amber" />
        <StatTile label="Converted" value={converted} icon={<CheckCircle2 className="w-4 h-4" />} accent="emerald" />
      </StatsGrid>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl w-fit">
        {(["pipeline","all"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "pipeline" ? "Pipeline" : "All prospects"}
          </button>
        ))}
      </div>

      {tab === "pipeline"
        ? <PipelineView properties={properties as any[]} onSelectProspect={setSelected} />
        : <AllProspectsView onSelect={setSelected} properties={properties as any[]} prospects={allProspects as any[]} />}

      <CreateProspectDialog open={showCreate} onClose={() => setShowCreate(false)}
        properties={properties as any[]}
        onCreated={() => qc.invalidateQueries({ queryKey: ["/api/prospects"] })} />
    </PageShell>
  );
}