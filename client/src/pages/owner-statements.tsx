/**
 * OwnerStatements — /owner-statements
 *
 * Role-split:
 *   admin / manager : full CRUD — create & edit PM agreements, generate,
 *                     approve, and disburse statements
 *   landlord        : read-only — sees their own agreements, statements,
 *                     and rent roll. Cannot create/edit agreements or
 *                     generate/approve statements (PM does that for them).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

import {
  Building, DollarSign, FileText, CheckCircle2, Loader2,
  Plus, RefreshCw, Banknote, AlertCircle, Pencil, Info,
} from "lucide-react";

const fmtKES = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;
const fmt    = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function statusColor(s: string) {
  if (s === "paid")     return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (s === "approved") return "bg-blue-100 text-blue-800 border-blue-200";
  if (s === "sent")     return "bg-purple-100 text-purple-800 border-purple-200";
  if (s === "draft")    return "bg-amber-100 text-amber-800 border-amber-200";
  if (s === "active")   return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

// Fetch properties via the correct endpoint based on role
function useProperties(role?: string) {
  return useQuery<any[]>({
    queryKey: ["/api/properties", "owner-statements", role],
    queryFn: async () => {
      // Landlords can't hit /api/properties (STAFF_AND_ABOVE guard).
      // Use their landlord-portal properties/stats which returns their portfolio.
      if (role === "landlord") {
        const r = await apiRequest("/api/landlord-portal/properties/stats");
        if (!r.ok) return [];
        return ensureArray(await r.json());
      }
      const r = await apiRequest("/api/properties");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: !!role,
  });
}

// ─── Agreements Tab ───────────────────────────────────────────────────────────

function AgreementsTab({ isReadOnly }: { isReadOnly: boolean }) {
  const { toast } = useToast();
  const { user }  = useAuth();
  const qc        = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);
  const [form, setForm] = useState<any>({ feeType: "percentage", feeRate: "10", deductMaintenanceCosts: true });

  const { data: agreements = [], isLoading } = useQuery({
    queryKey: ["/api/owner-statements/agreements"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/owner-statements/agreements")).json()),
  });

  const { data: properties = [] } = useProperties(user?.role);
  const { data: landlordUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/users", "landlords-picker"],
    queryFn: async () => {
      const r = await apiRequest("/api/users?role=landlord&limit=100");
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.results ?? d?.data ?? []);
    },
    enabled: !isReadOnly,
  });

  const save = useMutation({
    mutationFn: async (data: any) => {
      if (editId) return apiRequest(`/api/owner-statements/agreements/${editId}`, { method: "PATCH", data });
      return apiRequest("/api/owner-statements/agreements", { method: "POST", data });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/owner-statements/agreements"] });
      setShowForm(false); setEditId(null);
      toast({ title: editId ? "Agreement updated" : "Agreement created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">
            {isReadOnly
              ? "Your property management fee agreements set up by your property manager."
              : "Define the PM fee rate for each property. This drives all owner statement calculations."}
          </p>
          {isReadOnly && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-700 dark:text-blue-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                PM agreements are created by your property manager, not by you. Contact your manager if the fee
                rate or disbursement details are incorrect.
              </span>
            </div>
          )}
        </div>
        {!isReadOnly && (
          <Button onClick={() => {
            setForm({ feeType: "percentage", feeRate: "10", deductMaintenanceCosts: true, startDate: new Date().toISOString().slice(0,10) });
            setEditId(null); setShowForm(true);
          }} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" /> New agreement
          </Button>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="space-y-3">
        {agreements.map((a: any) => (
          <Card key={a.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{a.propertyName ?? `Property #${a.propertyId}`}</span>
                    <Badge variant="outline" className={statusColor(a.status ?? "active")}>{a.status ?? "active"}</Badge>
                    {a.agreementNumber && <span className="text-xs text-muted-foreground font-mono">{a.agreementNumber}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 mt-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Fee type</p><p className="font-medium capitalize">{a.feeType?.replace(/_/g," ")}</p></div>
                    <div><p className="text-xs text-muted-foreground">Rate</p><p className="font-medium">{a.feeType === "percentage" ? `${a.feeRate}%` : fmtKES(a.feeRate)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Owner</p><p className="font-medium">{a.ownerFirstName ? `${a.ownerFirstName} ${a.ownerLastName}` : "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Deduct maintenance</p><p className="font-medium">{a.deductMaintenanceCosts ? "Yes" : "No"}</p></div>
                  </div>
                  {a.disbursementAccount && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Disbursed to: <strong>{a.disbursementAccount}</strong> via {a.disbursementMethod}
                    </p>
                  )}
                </div>
                {!isReadOnly && (
                  <Button variant="ghost" size="sm" onClick={() => { setForm({ ...a, feeRate: String(a.feeRate) }); setEditId(a.id); setShowForm(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && !agreements.length && (
          <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
            {isReadOnly
              ? "No PM agreement has been set up for your property yet. Contact your property manager."
              : "No property management agreements yet. Create one to start generating owner statements."}
          </CardContent></Card>
        )}
      </div>

      {/* Create / Edit dialog — manager/admin only */}
      {!isReadOnly && (
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Property Management Agreement</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {!editId && (
                <>
                  <div className="col-span-2">
                    <Label className="text-xs">Property <span className="text-red-500">*</span></Label>
                    <Select value={String(form.propertyId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, propertyId: parseInt(v) }))}>
                      <SelectTrigger><SelectValue placeholder="Select property…" /></SelectTrigger>
                      <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Property owner (landlord)</Label>
                    <Select value={String(form.ownerUserId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, ownerUserId: v || null }))}>
                      <SelectTrigger><SelectValue placeholder="Auto-resolved from property owner…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Auto-resolve from property owner —</SelectItem>
                        {landlordUsers.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-0.5">Leave blank to use the property's assigned owner automatically.</p>
                  </div>
                </>
              )}
              <div>
                <Label className="text-xs">Fee type</Label>
                <Select value={form.feeType} onValueChange={v => setForm((f: any) => ({ ...f, feeType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">% of gross rent</SelectItem>
                    <SelectItem value="fixed_monthly">Fixed monthly (KES)</SelectItem>
                    <SelectItem value="per_unit">Per occupied unit (KES)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{form.feeType === "percentage" ? "Rate (%)" : "Amount (KES)"}</Label>
                <Input type="number" value={form.feeRate ?? ""} onChange={e => setForm((f: any) => ({ ...f, feeRate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Start date</Label>
                <Input type="date" value={form.startDate ?? ""} onChange={e => setForm((f: any) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Disbursement method</Label>
                <Select value={form.disbursementMethod ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, disbursementMethod: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                    <SelectItem value="bank">Bank transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Disbursement account (M-Pesa number or bank account)</Label>
                <Input value={form.disbursementAccount ?? ""} onChange={e => setForm((f: any) => ({ ...f, disbursementAccount: e.target.value }))} />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="deductMaint" checked={!!form.deductMaintenanceCosts} onChange={e => setForm((f: any) => ({ ...f, deductMaintenanceCosts: e.target.checked }))} />
                <Label htmlFor="deductMaint" className="text-sm cursor-pointer">Deduct approved maintenance costs from gross rent</Label>
              </div>
              <div className="col-span-2 flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button onClick={() => save.mutate(form)} disabled={save.isPending || (!editId && !form.propertyId) || !form.feeRate}>
                  {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Statement Detail Dialog ──────────────────────────────────────────────────

function StatementDetailDialog({ statementId, onClose }: { statementId: number | null; onClose: () => void }) {
  const { data: s, isLoading } = useQuery({
    queryKey: ["/api/owner-statements", statementId],
    queryFn:  async () => (await apiRequest(`/api/owner-statements/${statementId}`)).json(),
    enabled:  !!statementId,
  });

  const lineItems      = s?.lineItems      ?? [];
  const paymentDetails = s?.paymentDetails ?? [];
  const expenseDetails = s?.expenseDetails ?? [];

  return (
    <Dialog open={!!statementId} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {s ? `${s.propertyName ?? `Property #${s.propertyId}`} — ${MONTHS[(s.periodMonth ?? 1) - 1]} ${s.periodYear}` : "Statement Detail"}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {s && !isLoading && (
          <div className="space-y-5 mt-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Gross rent",   value: fmtKES(s.grossRent),       color: "" },
                { label: "PM fee",       value: `-${fmtKES(s.pmFee)}`,     color: "text-red-600" },
                { label: "Deductions",   value: `-${fmtKES(s.totalDeductions ?? (Number(s.maintenanceCosts??0)+Number(s.utilityCosts??0)+Number(s.insuranceCosts??0)+Number(s.otherDeductions??0)))}`, color: "text-red-600" },
                { label: "Net payable",  value: fmtKES(s.netPayable),      color: "text-emerald-700 font-bold" },
              ].map(({ label, value, color }) => (
                <Card key={label}><CardContent className="pt-3 pb-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-sm font-semibold ${color}`}>{value}</p>
                </CardContent></Card>
              ))}
            </div>
            {lineItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Breakdown</p>
                <div className="rounded-lg border divide-y text-sm">
                  {lineItems.map((item: any, i: number) => (
                    <div key={i} className={`flex justify-between px-3 py-2 ${item.type === "net" ? "bg-muted/40 font-semibold" : ""}`}>
                      <span className={item.type === "deduction" ? "text-muted-foreground" : ""}>{item.description}</span>
                      <span className={item.amount < 0 ? "text-red-600" : item.type === "net" ? "text-emerald-700" : ""}>{fmtKES(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {paymentDetails.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rent collected ({paymentDetails.length} tenant{paymentDetails.length !== 1 ? "s" : ""})</p>
                <div className="rounded-lg border divide-y text-sm">
                  {paymentDetails.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between items-center px-3 py-2">
                      <div>
                        <p className="font-medium">{p.tenantName}</p>
                        <p className="text-xs text-muted-foreground">Unit {p.unitNumber} · {p.method} · {p.date ? fmt(p.date) : "—"}</p>
                      </div>
                      <span className="text-emerald-700 font-medium">{fmtKES(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {expenseDetails.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deductible expenses</p>
                <div className="rounded-lg border divide-y text-sm">
                  {expenseDetails.map((e: any, i: number) => (
                    <div key={i} className="flex justify-between items-center px-3 py-2">
                      <div>
                        <p className="font-medium">{e.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">{e.category}{e.vendor ? ` · ${e.vendor}` : ""} · {e.date ? fmt(e.date) : "—"}</p>
                      </div>
                      <span className="text-red-600 font-medium">-{fmtKES(e.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {s.disbursedAt && (
              <p className="text-xs text-muted-foreground">Disbursed {fmt(s.disbursedAt)}{s.disbursementRef ? ` · Ref: ${s.disbursementRef}` : ""}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Disburse Dialog ─────────────────────────────────────────────────────────

function DisburseDialog({ statementId, onClose, onConfirm, loading }: { statementId: number | null; onClose: () => void; onConfirm: (ref: string) => void; loading: boolean }) {
  const [ref, setRef] = useState("");
  return (
    <Dialog open={!!statementId} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Mark as Disbursed</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <Label className="text-xs">Disbursement reference <span className="text-muted-foreground">(M-Pesa / bank ref)</span></Label>
            <Input
              placeholder="e.g. QK2XR3ABCD or KES-2025-001"
              value={ref}
              onChange={e => setRef(e.target.value)}
              className="mt-1"
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={loading || !ref.trim()} onClick={() => { onConfirm(ref.trim()); setRef(""); }}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Statements Tab ───────────────────────────────────────────────────────────

function StatementsTab({ isReadOnly, onGoToAgreements }: { isReadOnly: boolean; onGoToAgreements: () => void }) {
  const { user }  = useAuth();
  const { toast } = useToast();
  const qc        = useQueryClient();
  const [genForm, setGenForm] = useState({ propertyId: "", year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
  const [filterProp, setFilterProp]   = useState("all");
  const [detailId, setDetailId]       = useState<number | null>(null);
  const [disburseId, setDisburseId]   = useState<number | null>(null);

  const { data: properties = [] } = useProperties(user?.role);

  const { data: selectedAgreement, isLoading: agreementLoading } = useQuery({
    queryKey: ["/api/owner-statements/agreements", genForm.propertyId],
    queryFn:  async () => {
      const res = await apiRequest(`/api/owner-statements/agreements/${genForm.propertyId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!genForm.propertyId && !isReadOnly,
  });
  const missingAgreement = !isReadOnly && !!genForm.propertyId && !agreementLoading && !selectedAgreement;

  const { data: statements = [], isLoading } = useQuery({
    queryKey: ["/api/owner-statements", filterProp],
    queryFn:  async () => {
      const url = filterProp && filterProp !== "all"
        ? `/api/owner-statements?propertyId=${filterProp}`
        : "/api/owner-statements";
      return ensureArray(await (await apiRequest(url)).json());
    },
  });

  const generate = useMutation({
    mutationFn: () => apiRequest("/api/owner-statements/generate", {
      method: "POST",
      data: { propertyId: parseInt(genForm.propertyId), year: genForm.year, month: genForm.month },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/owner-statements"] }); toast({ title: "Statement generated" }); },
    onError:   (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/owner-statements/${id}/approve`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/owner-statements"] }); toast({ title: "Statement approved" }); },
    onError:   () => toast({ title: "Error", description: "Failed to approve.", variant: "destructive" }),
  });

  const disburse = useMutation({
    mutationFn: ({ id, ref }: { id: number; ref: string }) =>
      apiRequest(`/api/owner-statements/${id}/mark-disbursed`, { method: "PATCH", data: { disbursementRef: ref } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/owner-statements"] });
      toast({ title: "Marked as disbursed" });
      setDisburseId(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to mark disbursed.", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <StatementDetailDialog statementId={detailId} onClose={() => setDetailId(null)} />
      <DisburseDialog
        statementId={disburseId}
        onClose={() => setDisburseId(null)}
        onConfirm={ref => disburseId && disburse.mutate({ id: disburseId, ref })}
        loading={disburse.isPending}
      />

      {/* Generate panel — manager/admin only */}
      {!isReadOnly && (
        <Card>
          <CardHeader className="pb-3"><h3 className="text-sm font-semibold text-foreground">Generate Owner Statement</h3></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Property</Label>
                <Select value={genForm.propertyId} onValueChange={v => setGenForm(f => ({ ...f, propertyId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Year</Label>
                <Input type="number" value={genForm.year} onChange={e => setGenForm(f => ({ ...f, year: parseInt(e.target.value) }))} />
              </div>
              <div>
                <Label className="text-xs">Month</Label>
                <Select value={String(genForm.month)} onValueChange={v => setGenForm(f => ({ ...f, month: parseInt(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m,i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={() => generate.mutate()} disabled={!genForm.propertyId || missingAgreement || generate.isPending}>
                  {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />} Generate
                </Button>
              </div>
            </div>
            {missingAgreement && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">No PM agreement for this property</p>
                  <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                    Create a{" "}
                    <button className="underline font-medium hover:opacity-80" onClick={onGoToAgreements}>PM Agreement</button>
                    {" "}for this property first.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        <Select value={filterProp} onValueChange={setFilterProp}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      <div className="space-y-3">
        {statements.map((s: any) => (
          <Card key={s.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{s.propertyName ?? `Property #${s.propertyId}`}</span>
                    <span className="text-muted-foreground text-sm">— {MONTHS[(s.periodMonth ?? 1) - 1]} {s.periodYear}</span>
                    <Badge variant="outline" className={statusColor(s.status ?? "draft")}>{s.status ?? "draft"}</Badge>
                    {s.statementNumber && <span className="text-xs font-mono text-muted-foreground">{s.statementNumber}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-0.5 mt-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Gross rent</p><p className="font-medium">{fmtKES(s.grossRent)}</p></div>
                    <div><p className="text-xs text-muted-foreground">PM fee</p><p className="font-medium text-red-600">-{fmtKES(s.pmFee)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Deductions</p><p className="font-medium text-red-600">-{fmtKES(s.totalDeductions ?? (Number(s.maintenanceCosts??0)+Number(s.utilityCosts??0)+Number(s.insuranceCosts??0)+Number(s.otherDeductions??0)))}</p></div>
                    <div><p className="text-xs text-muted-foreground">Net payable</p><p className="font-bold text-emerald-700">{fmtKES(s.netPayable)}</p></div>
                  </div>
                  {s.disbursedAt && <p className="text-xs text-muted-foreground mt-1">Disbursed {fmt(s.disbursedAt)}{s.disbursementRef ? ` · Ref: ${s.disbursementRef}` : ""}</p>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="ghost" onClick={() => setDetailId(s.id)}>
                    <FileText className="h-4 w-4 mr-1" /> View
                  </Button>
                  {/* Manager-only actions */}
                  {!isReadOnly && s.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => approve.mutate(s.id)} disabled={approve.isPending}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  )}
                  {!isReadOnly && s.status === "approved" && (
                    <Button size="sm" onClick={() => setDisburseId(s.id)} disabled={disburse.isPending}>
                      <Banknote className="h-4 w-4 mr-1" /> Mark Disbursed
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && !statements.length && (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            {isReadOnly ? "No statements have been generated for your property yet. Your property manager generates these monthly." : "No statements yet. Generate one above."}
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

// ─── Rent Roll Tab ────────────────────────────────────────────────────────────

function RentRollTab() {
  const { user }  = useAuth();
  const [month,      setMonth]      = useState(format(new Date(), "yyyy-MM"));
  const [filterProp, setFilterProp] = useState("all");

  const { data: properties = [] } = useProperties(user?.role);

  const { data: rollData, isLoading } = useQuery({
    queryKey: ["/api/owner-statements/rent-roll", month, filterProp],
    queryFn:  async () => {
      let url = `/api/owner-statements/rent-roll?month=${month}`;
      if (filterProp && filterProp !== "all") url += `&propertyId=${filterProp}`;
      const r = await apiRequest(url);
      if (!r.ok) return { summary: {}, rentRoll: [] };
      return r.json();
    },
  });

  const roll    = rollData?.rentRoll ?? [];
  const summary = rollData?.summary  ?? {};

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" />
        <Select value={filterProp} onValueChange={setFilterProp}>
          <SelectTrigger className="w-52"><SelectValue placeholder="All properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!isLoading && (summary.totalUnits ?? 0) > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Expected",  value: fmtKES(summary.totalExpected),  icon: DollarSign },
            { label: "Collected", value: fmtKES(summary.totalCollected), icon: CheckCircle2 },
            { label: "Arrears",   value: fmtKES(summary.totalArrears),   icon: AlertCircle },
            { label: "Vacant",    value: `${summary.vacantUnits ?? 0} units`, icon: Building },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}><CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      {!isLoading && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["Property","Unit","Tenant","Monthly Rent","Status","Paid Date","Arrears"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roll.map((r: any, i: number) => (
                <tr key={i} className={`border-t ${r.paymentStatus === "vacant" ? "bg-muted/20" : ""}`}>
                  <td className="px-3 py-2 font-medium truncate max-w-[140px]">{r.propertyName}</td>
                  <td className="px-3 py-2">{r.unitNumber}</td>
                  <td className="px-3 py-2 truncate max-w-[140px]">{r.tenantName ?? <span className="text-muted-foreground italic">Vacant</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtKES(r.monthlyRent)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={
                      r.paymentStatus === "paid"   ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                      r.paymentStatus === "unpaid" ? "bg-red-100 text-red-800 border-red-200" :
                      "bg-muted text-muted-foreground"
                    }>{r.paymentStatus}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.paidDate ? format(new Date(r.paidDate), "dd MMM") : "—"}</td>
                  <td className="px-3 py-2">{r.arrearsAmount > 0 ? <span className="text-red-600 font-medium">{fmtKES(r.arrearsAmount)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!roll.length && (
            <div className="py-10 text-center text-sm text-muted-foreground space-y-1">
              <p className="font-medium">No units found{filterProp !== "all" ? " for this property" : ""}.</p>
              <p>{filterProp !== "all" ? "Make sure units have been added to this property." : "Add properties and units to see the rent roll here."}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OwnerStatements() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  const { user }    = useAuth();
  const isReadOnly  = user?.role === "landlord";
  const [activeTab, setActiveTab] = useState("statements");

  return (
    <div className="min-h-screen p-4 sm:p-6 bg-background text-foreground">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="rounded-lg bg-green-500/10 p-2"><Banknote className="h-5 w-5 text-green-600" /></div>
          <h1 className="text-xl font-semibold">Owner Statements</h1>
          {isReadOnly && <Badge variant="outline" className="text-xs">Read-only</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {isReadOnly
            ? "View your PM fee agreement, monthly remittance statements, and portfolio rent roll."
            : "Property management fee agreements, monthly remittance statements, and portfolio rent roll."}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 mb-4">
          <TabsTrigger value="agreements"  className="gap-1.5"><FileText   className="h-3.5 w-3.5" />PM Agreements</TabsTrigger>
          <TabsTrigger value="statements"  className="gap-1.5"><Banknote   className="h-3.5 w-3.5" />Statements</TabsTrigger>
          <TabsTrigger value="rent-roll"   className="gap-1.5"><Building   className="h-3.5 w-3.5" />Rent Roll</TabsTrigger>
        </TabsList>
        <TabsContent value="agreements"><AgreementsTab isReadOnly={isReadOnly} /></TabsContent>
        <TabsContent value="statements"><StatementsTab isReadOnly={isReadOnly} onGoToAgreements={() => setActiveTab("agreements")} /></TabsContent>
        <TabsContent value="rent-roll"><RentRollTab /></TabsContent>
      </Tabs>
    </div>
  );
}