/**
 * Prospects — /prospects
 *
 * Letting pipeline: enquiry → viewing → application → references → approval → lease offer → tenant.
 * Every step is one button in the detail panel and the server enforces the order, so the panel only ever offers what is allowed.
 * Approving reserves a unit; converting creates the (pending) tenant, their login invite and a draft lease in one go.
 */
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/maintenance-flow";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";
import { PageShell, PageHeader, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPAvatar, StatTile, StatsGrid, KESAmount } from "@/components/ui/sp-ui";

import {
  Users, Plus, Loader2, ChevronRight, CheckCircle2, X, Calendar,
  Building, UserCheck, ClipboardList, Send, RotateCcw, Link2, Copy, XCircle, Eye,
  ArrowRight, Home, Filter, ChevronDown, ChevronUp,
  Briefcase, Star, Clock, AlertCircle, AlertTriangle, Mail as MailIcon, Phone as PhoneIcon,
} from "lucide-react";

const fmt    = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const fmtDT  = (d: any) => d ? format(new Date(d), "dd MMM yyyy, HH:mm") : "—";
const fmtKES = (n: any) => n ? `KES ${Math.round(Number(n)).toLocaleString("en-KE")}` : "—";
const todayStr = () => new Date().toISOString().slice(0, 10);
/** start + 12 months − 1 day: a lease starting 1 Jan ends 31 Dec. */
const yearFrom = (start: string) => {
  const d = new Date(`${start}T00:00:00Z`); if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate(); d.setUTCMonth(d.getUTCMonth() + 12); if (d.getUTCDate() !== day) d.setUTCDate(0);
  d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10);
};

const STAGES = [
  { key: "new",                   label: "New Enquiry",    icon: Users,         dot: "bg-slate-400",   pill: "bg-slate-100 text-muted-foreground dark:bg-slate-800 dark:text-slate-300" },
  { key: "viewing_scheduled",     label: "Viewing Booked", icon: Calendar,      dot: "bg-blue-400",    pill: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { key: "viewed",                label: "Viewed",         icon: Home,          dot: "bg-indigo-400",  pill: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { key: "application_submitted", label: "Applied",        icon: ClipboardList, dot: "bg-purple-400",  pill: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  { key: "reference_checked",     label: "Refs Checked",   icon: UserCheck,     dot: "bg-cyan-500",    pill: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { key: "approved",              label: "Approved",       icon: CheckCircle2,  dot: "bg-emerald-400", pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { key: "lease_offered",         label: "Lease Offered",  icon: Star,          dot: "bg-amber-400",   pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { key: "converted",             label: "Converted",      icon: ArrowRight,    dot: "bg-green-500",   pill: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  { key: "rejected",              label: "Rejected",       icon: XCircle,       dot: "bg-red-400",     pill: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
];
/** the steps shown in the progress list (rejected is an exit, not a step) */
const STEPS = STAGES.filter(s => s.key !== "rejected" && s.key !== "converted");

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

const isProspectsKey = (q: { queryKey: readonly unknown[] }) => String(q.queryKey[0] ?? "").startsWith("/api/prospects");

// ── Small reusable dialogs ─────────────────────────────────────────────────────

function Busy({ on }: { on: boolean }) { return on ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null; }
const GREEN = "bg-emerald-600 hover:bg-emerald-700 text-white";

function ScheduleViewingDialog({ open, onClose, onConfirm, loading, reschedule }: { open: boolean; onClose: () => void; onConfirm: (date: string, notes: string) => void; loading: boolean; reschedule?: boolean }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>{reschedule ? "Reschedule viewing" : "Schedule viewing"}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Date</Label><Input type="date" min={todayStr()} value={date} onChange={e => setDate(e.target.value)} className="h-9 mt-1" /></div>
            <div><Label className="text-xs">Time</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-9 mt-1" /></div>
          </div>
          <div><Label className="text-xs">Notes (optional)</Label><Textarea className="mt-1" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Meeting point, who will show the unit…" /></div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!date || loading} onClick={() => onConfirm(new Date(`${date}T${time}:00`).toISOString(), notes)} className={GREEN}><Busy on={loading} />Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewedDialog({ open, onClose, onConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: (notes: string) => void; loading: boolean }) {
  const [notes, setNotes] = useState("");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Viewing done</DialogTitle></DialogHeader>
        <Textarea className="mt-2" rows={3} placeholder="How did it go? (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={loading} onClick={() => onConfirm(notes)} className={GREEN}><Busy on={loading} />Mark as viewed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationDialog({ open, onClose, onConfirm, loading, prospect }: { open: boolean; onClose: () => void; onConfirm: (b: any) => void; loading: boolean; prospect: any }) {
  const [f, setF] = useState<any>({});
  useEffect(() => { if (open) setF({ phone: prospect.phone ?? "", nationalId: prospect.nationalId ?? "", employer: prospect.employer ?? "", monthlyIncome: prospect.monthlyIncome ?? "", notes: "" }); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Application received</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">An application needs the applicant's phone and ID or passport number.</p>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div><Label className="text-xs">Phone *</Label><Input className="h-9 mt-1" value={f.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+254 700 000 000" /></div>
          <div><Label className="text-xs">ID / passport no. *</Label><Input className="h-9 mt-1" value={f.nationalId ?? ""} onChange={e => set("nationalId", e.target.value)} /></div>
          <div><Label className="text-xs">Employer</Label><Input className="h-9 mt-1" value={f.employer ?? ""} onChange={e => set("employer", e.target.value)} /></div>
          <div><Label className="text-xs">Monthly income (KES)</Label><Input className="h-9 mt-1" type="number" min="0" value={f.monthlyIncome ?? ""} onChange={e => set("monthlyIncome", e.target.value)} /></div>
        </div>
        <div className="mt-1"><Label className="text-xs">Notes (optional)</Label><Textarea className="mt-1" rows={2} value={f.notes ?? ""} onChange={e => set("notes", e.target.value)} /></div>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!f.phone?.trim() || !f.nationalId?.trim() || loading} onClick={() => onConfirm(f)} className={GREEN}><Busy on={loading} />Record application</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefsDialog({ open, onClose, onConfirm, loading, prospect }: { open: boolean; onClose: () => void; onConfirm: (notes: string) => void; loading: boolean; prospect: any }) {
  const [notes, setNotes] = useState("");
  const refs = [
    { name: prospect.reference1Name, phone: prospect.reference1Phone, rel: prospect.reference1Relation },
    { name: prospect.reference2Name, phone: prospect.reference2Phone, rel: prospect.reference2Relation },
  ].filter(r => r.name);
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>Reference check</DialogTitle></DialogHeader>
        {refs.length > 0 && (
          <div className="rounded-xl bg-muted/40 p-3 text-xs space-y-1">
            {refs.map((r, i) => <p key={i}><span className="font-semibold">{r.name}</span> · {r.phone ?? "no phone"}{r.rel ? ` · ${r.rel}` : ""}</p>)}
          </div>
        )}
        <Textarea className="mt-2" rows={3} placeholder="What did the references say? *" value={notes} onChange={e => setNotes(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">If they were not satisfactory, close this and reject the application instead.</p>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={notes.trim().length < 3 || loading} onClick={() => onConfirm(notes.trim())} className={GREEN}><Busy on={loading} />Mark checked</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnitPicker({ prospectId, enabled, value, onChange }: { prospectId: number; enabled: boolean; value?: number | null; onChange: (id: number, u: any) => void }) {
  const { data: units = [], isLoading } = useQuery({
    queryKey: ["/api/prospects", prospectId, "available-units"],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/prospects/${prospectId}/available-units`)).json()),
    enabled,
  });
  return (
    <SearchableSelect
      className="mt-1"
      value={value ? String(value) : ""}
      onValueChange={v => onChange(parseInt(v), (units as any[]).find(u => String(u.id) === v))}
      placeholder={isLoading ? "Loading units…" : "Select a vacant unit…"}
      searchPlaceholder="Search unit number…"
      emptyText="No vacant units available"
      options={(units as any[]).map((u: any) => ({
        value: String(u.id),
        label: `Unit ${u.unitNumber}`,
        description: [u.propertyName, u.unitType && u.unitType !== "apartment" ? String(u.unitType).replace(/_/g, " ") : null, u.bedrooms ? `${u.bedrooms} bed` : null, `${fmtKES(u.monthlyRent)}/mo`].filter(Boolean).join(" · "),
      }))}
    />
  );
}

function ApproveDialog({ open, onClose, onConfirm, loading, prospect }: { open: boolean; onClose: () => void; onConfirm: (b: any) => void; loading: boolean; prospect: any }) {
  const waiving = prospect.status === "application_submitted";
  const [unitId, setUnitId] = useState<number | null>(null);
  const [rent, setRent] = useState("");
  const [waive, setWaive] = useState(false);
  useEffect(() => { if (open) { setUnitId(prospect.unitId ?? null); setRent(prospect.offeredRent ? String(Math.round(Number(prospect.offeredRent))) : ""); setWaive(false); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader><DialogTitle>{waiving ? "Approve without a reference check" : "Approve prospect"}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Approving reserves the unit for {prospect.firstName} — nobody else can be approved for it until this is released.</p>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs">Unit *</Label>
            <UnitPicker prospectId={prospect.id} enabled={open} value={unitId} onChange={(id, u) => { setUnitId(id); if (u?.monthlyRent && !rent) setRent(String(Math.round(Number(u.monthlyRent)))); }} />
          </div>
          <div>
            <Label className="text-xs">Monthly rent offered (KES) *</Label>
            <Input type="number" min="1" className="h-9 mt-1" value={rent} onChange={e => setRent(e.target.value)} placeholder="Defaults to the unit's rent" />
          </div>
          {waiving && (
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <Checkbox checked={waive} onCheckedChange={v => setWaive(v === true)} className="mt-0.5" />
              <span>I am skipping the reference check for this applicant. This is recorded on their file.</span>
            </label>
          )}
        </div>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!unitId || !(Number(rent) > 0) || (waiving && !waive) || loading}
            onClick={() => onConfirm({ unitId, offeredRent: Number(rent), ...(waiving ? { waiveReferences: true } : {}) })} className={GREEN}><Busy on={loading} />Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OfferDialog({ open, onClose, onConfirm, loading, prospect }: { open: boolean; onClose: () => void; onConfirm: (rent: number) => void; loading: boolean; prospect: any }) {
  const [rent, setRent] = useState("");
  useEffect(() => { if (open) setRent(prospect.offeredRent ? String(Math.round(Number(prospect.offeredRent))) : ""); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader><DialogTitle>Send lease offer</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{prospect.firstName} is emailed that their application was approved, with the rent offered.</p>
        <div className="mt-2"><Label className="text-xs">Monthly rent offered (KES)</Label><Input type="number" min="1" className="h-9 mt-1" value={rent} onChange={e => setRent(e.target.value)} /></div>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!(Number(rent) > 0) || loading} onClick={() => onConfirm(Number(rent))} className={GREEN}><Busy on={loading} /><Send className="h-3.5 w-3.5 mr-1.5" />Send offer</Button>
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-red-500" />Reject prospect</DialogTitle></DialogHeader>
        <div className="mt-2"><Label className="text-xs">Reason *</Label><Textarea className="mt-1" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="State the reason for rejection…" /></div>
        <p className="text-[11px] text-muted-foreground">Any unit reserved for them is released. You can reopen the prospect later.</p>
        <DialogFooter className="mt-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={reason.trim().length < 3 || loading} onClick={() => onConfirm(reason.trim())}><Busy on={loading} />Reject</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ open, onClose, prospect, onDone }: { open: boolean; onClose: () => void; prospect: any; onDone: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [f, setF] = useState<any>({});
  const [result, setResult] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    const start = prospect.preferredMoveIn ? String(prospect.preferredMoveIn).slice(0, 10) : todayStr();
    setResult(null);
    setF({ unitId: prospect.unitId ?? null, monthlyRent: prospect.offeredRent ? String(Math.round(Number(prospect.offeredRent))) : "", securityDeposit: "", leaseStartDate: start, leaseEndDate: yearFrom(start), depositPaidDate: "" });
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const convert = useMutation({
    mutationFn: async () => (await apiRequest(`/api/prospects/${prospect.id}/convert`, {
      method: "POST",
      data: { unitId: f.unitId, monthlyRent: Number(f.monthlyRent), securityDeposit: Number(f.securityDeposit || 0), leaseStartDate: f.leaseStartDate, leaseEndDate: f.leaseEndDate, ...(f.depositPaidDate ? { depositPaidDate: f.depositPaidDate } : {}) },
    })).json(),
    onSuccess: (r: any) => { setResult(r); onDone(); },
    onError: (e: any) => toast({ title: "Couldn't convert", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast({ title: "Link copied" })).catch(() => {});

  const ok = f.unitId && Number(f.monthlyRent) > 0 && f.leaseStartDate && f.leaseEndDate && f.leaseEndDate > f.leaseStartDate;
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl">
        {result ? (
          <>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{prospect.firstName} is now a tenant record</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <p>Draft lease <span className="font-semibold">{result.lease?.leaseNumber}</span> is ready. Send it for signing and activate it on the Leases page — rent is billed and the tenancy starts once it is active.</p>
              {result.invite?.link ? (
                <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
                  <p className="text-xs font-medium">{result.invite.emailSent ? "Portal invitation emailed. Link, in case they can't find it:" : "The invitation email could not be sent — share this link with them yourself:"}</p>
                  <div className="flex items-center gap-2">
                    <Input readOnly className="h-8 text-xs" value={result.invite.link} onFocus={e => e.currentTarget.select()} />
                    <Button size="sm" variant="outline" onClick={() => copy(result.invite.link)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : <p className="text-xs text-muted-foreground">They already have a portal login, so no invitation was needed.</p>}
              {(result.warnings ?? []).map((w: string, i: number) => (
                <div key={i} className="flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</div>
              ))}
            </div>
            <DialogFooter className="mt-3">
              <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
              <Button size="sm" className={GREEN} onClick={() => navigate("/leases")}>Open leases<ArrowRight className="h-3.5 w-3.5 ml-1.5" /></Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader><DialogTitle>Convert to tenant</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">Creates the tenant, their portal login invitation and a draft lease, and holds the unit.</p>
            <div className="space-y-3 mt-1">
              <div><Label className="text-xs">Unit *</Label><UnitPicker prospectId={prospect.id} enabled={open} value={f.unitId} onChange={(id, u) => { set("unitId", id); if (u?.monthlyRent && !f.monthlyRent) set("monthlyRent", String(Math.round(Number(u.monthlyRent)))); }} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Monthly rent (KES) *</Label><Input className="mt-1 h-9" type="number" min="1" value={f.monthlyRent ?? ""} onChange={e => set("monthlyRent", e.target.value)} /></div>
                <div><Label className="text-xs">Security deposit (KES)</Label><Input className="mt-1 h-9" type="number" min="0" value={f.securityDeposit ?? ""} onChange={e => set("securityDeposit", e.target.value)} /></div>
                <div><Label className="text-xs">Lease start *</Label><Input className="mt-1 h-9" type="date" value={f.leaseStartDate ?? ""} onChange={e => { set("leaseStartDate", e.target.value); set("leaseEndDate", yearFrom(e.target.value)); }} /></div>
                <div><Label className="text-xs">Lease end *</Label><Input className="mt-1 h-9" type="date" min={f.leaseStartDate} value={f.leaseEndDate ?? ""} onChange={e => set("leaseEndDate", e.target.value)} /></div>
                {Number(f.securityDeposit) > 0 && (
                  <div className="col-span-2"><Label className="text-xs">Deposit already received on (optional)</Label><Input className="mt-1 h-9" type="date" max={todayStr()} value={f.depositPaidDate ?? ""} onChange={e => set("depositPaidDate", e.target.value)} /></div>
                )}
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" className={GREEN} disabled={!ok || convert.isPending} onClick={() => convert.mutate()}><Busy on={convert.isPending} />Convert</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Prospect detail panel ──────────────────────────────────────────────────────

function ProspectDetail({ summary, onClose }: { summary: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [dialog, setDialog] = useState<string | null>(null);

  const { data: prospect, isLoading, isError } = useQuery({
    queryKey: ["/api/prospects", summary.id],
    queryFn: async () => (await apiRequest(`/api/prospects/${summary.id}`)).json(),
  });
  const refresh = () => qc.invalidateQueries({ predicate: isProspectsKey as any });

  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: any; label?: string }) => (await apiRequest(`/api/prospects/${summary.id}/${path}`, { method: "POST", data: body ?? {} })).json(),
    onSuccess: (r: any, v) => {
      refresh(); setDialog(null);
      toast({ title: v.label ?? "Updated", description: r?.emailSent === false ? "The email to the prospect could not be sent — tell them yourself." : undefined });
      (r?.warnings ?? []).forEach((w: string) => toast({ title: "Heads up", description: w, duration: 12000 }));
    },
    onError: (e: any) => toast({ title: "Couldn't do that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const run = (path: string, body: any, label: string) => action.mutate({ path, body, label });
  const busy = action.isPending;

  if (isLoading || !prospect) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-2 text-muted-foreground"><ChevronRight className="h-4 w-4 rotate-180 mr-1" />Back</Button>
      <div className="flex justify-center py-16">{isError ? <p className="text-sm text-muted-foreground">Couldn't load this prospect.</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}</div>
    </div>
  );

  const st: string = prospect.status;
  const InfoRow = ({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: any }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5 break-words whitespace-pre-line">{value || "—"}</p>
      </div>
    </div>
  );
  const Act = ({ onClick, icon: Icon, children, primary = true, danger = false }: any) => (
    <Button size="sm" variant={primary ? "default" : "outline"} disabled={busy} onClick={onClick}
      className={`w-full ${primary ? GREEN : danger ? "text-red-600 border-red-200 hover:bg-red-50" : ""}`}>
      <Icon className="h-3.5 w-3.5 mr-1.5" />{children}
    </Button>
  );
  const stageIdx = STEPS.findIndex(s => s.key === st);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-2 text-muted-foreground"><ChevronRight className="h-4 w-4 rotate-180 mr-1" />Back</Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-bold text-lg text-foreground">{prospect.firstName} {prospect.lastName}</h2>
            <StageBadge status={st} />
          </div>
          {(prospect.propertyName || prospect.unitNumber) && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5"><Building className="h-3 w-3" />{[prospect.propertyName, prospect.unitNumber ? `Unit ${prospect.unitNumber}` : null].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      </div>

      {prospect.unitIssue && (
        <div className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div><p className="font-medium">Their unit is no longer free</p><p className="text-xs mt-0.5">{prospect.unitIssue} Change the unit (Reject and reopen, or edit the prospect) before going further.</p></div>
        </div>
      )}

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
              <InfoRow label="Handled by"  value={prospect.assignedToName} />
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

          {(prospect.viewingDate || prospect.viewingNotes || prospect.applicationNotes || prospect.referenceCheckNotes || prospect.rejectionReason) && (
            <Card className="rounded-2xl shadow-none border-border">
              <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">Progress notes</CardTitle></CardHeader>
              <CardContent className="px-5 pb-4">
                {prospect.viewingDate && <InfoRow label="Viewing" value={fmtDT(prospect.viewingDate)} icon={Eye} />}
                {prospect.viewingNotes && <InfoRow label="Viewing notes" value={prospect.viewingNotes} />}
                {prospect.applicationNotes && <InfoRow label="Application notes" value={prospect.applicationNotes} />}
                {prospect.referenceCheckNotes && <InfoRow label="Reference check" value={prospect.referenceCheckNotes} />}
                {prospect.rejectionReason && <InfoRow label="Rejected because" value={prospect.rejectionReason} icon={XCircle} />}
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card className="rounded-2xl shadow-none border-border sticky top-4">
            <CardHeader className="pb-1 pt-4 px-5"><CardTitle className="text-sm font-semibold">Pipeline</CardTitle></CardHeader>
            <CardContent className="px-5 pb-4 space-y-1.5">
              {STEPS.map((stage, i) => {
                const done = st === "converted" || (stageIdx >= 0 && i < stageIdx);
                const current = stage.key === st;
                return (
                  <div key={stage.key} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${current ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800" : ""}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${done || current ? "bg-emerald-500" : "bg-border"}`} />
                    <span className={`flex-1 ${current ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{stage.label}</span>
                    {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  </div>
                );
              })}

              <Separator className="my-3" />

              <div className="space-y-2">
                {st === "new" && <Act icon={Calendar} onClick={() => setDialog("viewing")}>Schedule viewing</Act>}
                {st === "viewing_scheduled" && <Act icon={Eye} onClick={() => setDialog("viewed")}>Viewing done</Act>}
                {["new", "viewing_scheduled", "viewed"].includes(st) && <Act icon={ClipboardList} primary={st === "viewed"} onClick={() => setDialog("application")}>Application received</Act>}
                {["viewing_scheduled", "viewed"].includes(st) && <Act icon={Calendar} primary={false} onClick={() => setDialog("viewing")}>Reschedule viewing</Act>}
                {st === "application_submitted" && (
                  <>
                    <Act icon={UserCheck} onClick={() => setDialog("refs")}>References checked</Act>
                    <Act icon={CheckCircle2} primary={false} onClick={() => setDialog("approve")}>Approve without references</Act>
                  </>
                )}
                {st === "reference_checked" && <Act icon={CheckCircle2} onClick={() => setDialog("approve")}>Approve</Act>}
                {st === "approved" && (
                  <>
                    <Act icon={Send} onClick={() => setDialog("offer")}>Send lease offer</Act>
                    <Act icon={ArrowRight} primary={false} onClick={() => setDialog("convert")}>Convert to tenant</Act>
                  </>
                )}
                {st === "lease_offered" && <Act icon={ArrowRight} onClick={() => setDialog("convert")}>Convert to tenant</Act>}
                {OPEN.includes(st) && <Act icon={X} primary={false} danger onClick={() => setDialog("reject")}>Reject</Act>}
                {st === "rejected" && <Act icon={RotateCcw} onClick={() => run("reopen", {}, "Prospect reopened")}>Reopen</Act>}
                {st === "converted" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 py-2"><CheckCircle2 className="h-4 w-4" />Converted to tenant</div>
                    {prospect.tenant && (
                      <div className="text-xs text-muted-foreground space-y-1 px-1">
                        <p>Tenancy: <span className="font-medium text-foreground">{prospect.tenant.status === "pending" ? "starts when the lease is activated" : prospect.tenant.status}</span></p>
                        {prospect.tenant.leaseNumber && <p>Lease {prospect.tenant.leaseNumber}: <span className="font-medium text-foreground">{String(prospect.tenant.leaseStatus ?? "").replace(/_/g, " ")}</span></p>}
                      </div>
                    )}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/leases")}><Link2 className="h-3.5 w-3.5 mr-1.5" />Open leases</Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ScheduleViewingDialog open={dialog === "viewing"} onClose={() => setDialog(null)} loading={busy} reschedule={st !== "new"}
        onConfirm={(d, notes) => run("schedule-viewing", { viewingDate: d, viewingNotes: notes || undefined }, "Viewing scheduled")} />
      <ViewedDialog open={dialog === "viewed"} onClose={() => setDialog(null)} loading={busy} onConfirm={notes => run("mark-viewed", { notes }, "Viewing recorded")} />
      <ApplicationDialog open={dialog === "application"} onClose={() => setDialog(null)} loading={busy} prospect={prospect}
        onConfirm={f => run("submit-application", { phone: f.phone, nationalId: f.nationalId, employer: f.employer, monthlyIncome: f.monthlyIncome, notes: f.notes }, "Application recorded")} />
      <RefsDialog open={dialog === "refs"} onClose={() => setDialog(null)} loading={busy} prospect={prospect} onConfirm={notes => run("check-references", { notes }, "References checked")} />
      <ApproveDialog open={dialog === "approve"} onClose={() => setDialog(null)} loading={busy} prospect={prospect} onConfirm={b => run("approve", b, "Prospect approved — unit reserved")} />
      <OfferDialog open={dialog === "offer"} onClose={() => setDialog(null)} loading={busy} prospect={prospect} onConfirm={rent => run("offer-lease", { offeredRent: rent }, "Lease offer sent")} />
      <RejectDialog open={dialog === "reject"} onClose={() => setDialog(null)} loading={busy} onConfirm={reason => run("reject", { reason }, "Prospect rejected")} />
      <ConvertDialog open={dialog === "convert"} onClose={() => setDialog(null)} prospect={prospect} onDone={refresh} />
    </div>
  );
}
const OPEN = ["new", "viewing_scheduled", "viewed", "application_submitted", "reference_checked", "approved", "lease_offered"];

// ── Pipeline view — vertical accordion ────────────────────────────────────────

function PipelineView({ properties, onSelectProspect }: { properties: any[]; onSelectProspect: (p: any) => void }) {
  const [propId, setPropId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["new","viewing_scheduled","approved"]));

  const { data: pipeline, isLoading } = useQuery({
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
                {pipeline.vacantUnits.length} available {pipeline.vacantUnits.length === 1 ? "unit" : "units"}
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
            if (stage.key === "rejected" && cards.length === 0) return null;
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
                              <p className="text-xs text-muted-foreground truncate">{p.email}{p.phone ? ` · ${p.phone}` : ""}{p.unitNumber ? ` · Unit ${p.unitNumber}` : ""}</p>
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
              <button className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400 font-medium text-left"
                onClick={() => onSelectProspect(converted[0])}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {converted.length} prospect{converted.length !== 1 ? "s" : ""} converted to tenant
              </button>
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
          description="Add a prospect, or use “Copy application link” to share the online application form"
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
                  {p.email}{p.phone ? ` · ${p.phone}` : ""}{p.propertyName ? ` · ${p.propertyName}` : ""}{p.unitNumber ? ` · Unit ${p.unitNumber}` : ""}
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

const BLANK = { source: "walk_in", nationality: "Kenyan" };

function CreateProspectDialog({ open, onClose, properties, onCreated }: { open: boolean; onClose: () => void; properties: any[]; onCreated: (created: any) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>(BLANK);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: units = [] } = useQuery({
    queryKey: ["/api/units", form.propertyId, "prospect-pick"],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/units?propertyId=${form.propertyId}`)).json()),
    enabled: open && !!form.propertyId,
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: any = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "" && v !== undefined && v !== null));
      return (await apiRequest("/api/prospects", { method: "POST", data: body })).json();
    },
    onSuccess: (r: any) => {
      onCreated(r); onClose(); setForm(BLANK);
      toast({ title: "Prospect added" });
      (r?.warnings ?? []).forEach((w: string) => toast({ title: "Heads up", description: w, duration: 10000 }));
    },
    onError: (e: any) => toast({ title: "Couldn't add the prospect", description: apiErrorMessage(e), variant: "destructive" }),
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
              <Select value={String(form.propertyId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, propertyId: parseInt(v), unitId: undefined }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Unit they want">
              <SearchableSelect
                value={String(form.unitId ?? "")}
                onValueChange={v => set("unitId", v ? parseInt(v) : undefined)}
                placeholder={form.propertyId ? "Any / not decided" : "Choose a property first"}
                searchPlaceholder="Search unit number…"
                emptyText="No vacant units in this property"
                clearable
                options={(units as any[]).filter((u: any) => !u.isOccupied).map((u: any) => ({ value: String(u.id), label: `Unit ${u.unitNumber}`, description: `${fmtKES(u.monthlyRent)}/mo` }))}
              />
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
            <F label="Monthly income (KES)"><Input className="h-9" type="number" min="0" value={form.monthlyIncome ?? ""} onChange={e => set("monthlyIncome", e.target.value)} /></F>
            <F label="Budget max (KES)"><Input className="h-9" type="number" min="0" value={form.budgetMax ?? ""} onChange={e => set("budgetMax", e.target.value)} /></F>
            <F label="Preferred move-in"><Input className="h-9" type="date" value={form.preferredMoveIn ?? ""} onChange={e => set("preferredMoveIn", e.target.value)} /></F>
            <F label="National ID / passport"><Input className="h-9" value={form.nationalId ?? ""} onChange={e => set("nationalId", e.target.value)} /></F>
            <F label="Nationality"><Input className="h-9" value={form.nationality ?? ""} onChange={e => set("nationality", e.target.value)} /></F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Reference 1 — name"><Input className="h-9" value={form.reference1Name ?? ""} onChange={e => set("reference1Name", e.target.value)} /></F>
            <F label="Reference 1 — phone"><Input className="h-9" value={form.reference1Phone ?? ""} onChange={e => set("reference1Phone", e.target.value)} /></F>
            <F label="Reference 2 — name"><Input className="h-9" value={form.reference2Name ?? ""} onChange={e => set("reference2Name", e.target.value)} /></F>
            <F label="Reference 2 — phone"><Input className="h-9" value={form.reference2Phone ?? ""} onChange={e => set("reference2Phone", e.target.value)} /></F>
          </div>
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" className={GREEN}
            disabled={!form.firstName?.trim() || !form.lastName?.trim() || !form.email?.trim() || create.isPending}
            onClick={() => create.mutate()}>
            <Busy on={create.isPending} />Add prospect
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
  const { toast } = useToast();

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

  const active    = (allProspects as any[]).filter((p: any) => OPEN.includes(p.status)).length;
  const converted = (allProspects as any[]).filter((p: any) => p.status === "converted").length;
  const viewings  = (allProspects as any[]).filter((p: any) => p.status === "viewing_scheduled").length;

  const applyLink = `${window.location.origin}/apply/${(user as any)?.organizationId ?? ""}`;
  const copyLink = () => navigator.clipboard?.writeText(applyLink)
    .then(() => toast({ title: "Application link copied", description: "Share it anywhere — applicants don't need an account." }))
    .catch(() => toast({ title: "Copy this link", description: applyLink }));

  if (selected) return (
    <PageShell>
      <div className="max-w-5xl mx-auto">
        <ProspectDetail summary={selected} onClose={() => { setSelected(null); qc.invalidateQueries({ predicate: isProspectsKey as any }); }} />
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
          <div className="flex gap-2 flex-wrap">
            <SecondaryButton icon={<Link2 className="w-4 h-4" />} onClick={copyLink}>Copy application link</SecondaryButton>
            <PrimaryButton icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>Add prospect</PrimaryButton>
          </div>
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
        onCreated={() => qc.invalidateQueries({ predicate: isProspectsKey as any })} />
    </PageShell>
  );
}
