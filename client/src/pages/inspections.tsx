/**
 * Inspections — /inspections
 *
 * Property condition inspections: move-in, move-out, periodic, pre-letting.
 * Mobile-first: managers conduct inspections room-by-room, both parties sign on-screen.
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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

import {
  ClipboardList, Plus, Loader2, CheckCircle2, Clock, AlertCircle,
  Camera, Pencil, ChevronRight, Building, Home, Zap, Droplets,
  Shield, User, FileText, RefreshCw, Eye,
} from "lucide-react";

const fmt     = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const fmtKES  = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

const CONDITION_OPTIONS = ["excellent", "good", "fair", "poor"];
const CONDITION_COLORS: Record<string, string> = {
  excellent: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  good: "bg-blue-100 text-blue-800",
  fair: "bg-amber-100 text-amber-800",
  poor: "bg-red-100 text-red-800",
};
const INSPECTION_TYPES = [
  { value: "move_in",    label: "Move-in" },
  { value: "move_out",   label: "Move-out" },
  { value: "periodic",   label: "Periodic" },
  { value: "pre_letting",label: "Pre-letting" },
  { value: "emergency",  label: "Emergency" },
];
const DEFAULT_ROOMS = ["Living Room","Master Bedroom","Bedroom 2","Kitchen","Bathroom","Toilet","Corridor","Balcony","Parking","Store"];

function statusColor(s: string) {
  if (s === "completed")         return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (s === "pending_signature") return "bg-blue-100 text-blue-800";
  if (s === "tenant_signed")     return "bg-purple-100 text-purple-800";
  if (s === "in_progress")       return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

// ─── Room editor ──────────────────────────────────────────────────────────────
function RoomEditor({ rooms, onChange }: { rooms: any[]; onChange: (r: any[]) => void }) {
  const addRoom = (name: string) => {
    if (rooms.find(r => r.room === name)) return;
    onChange([...rooms, { room: name, condition: "good", notes: "", photoUrls: [] }]);
  };
  const updateRoom = (i: number, patch: any) => {
    const next = rooms.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  };
  const removeRoom = (i: number) => onChange(rooms.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {/* Quick add buttons */}
      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_ROOMS.filter(r => !rooms.find(rm => rm.room === r)).map(r => (
          <button key={r} onClick={() => addRoom(r)}
            className="text-xs px-2 py-1 rounded-md border border-dashed border-border hover:bg-muted transition-colors">
            + {r}
          </button>
        ))}
      </div>

      {rooms.map((room, i) => (
        <div key={i} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{room.room}</p>
            <button onClick={() => removeRoom(i)} className="text-muted-foreground hover:text-red-500 text-xs">Remove</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {CONDITION_OPTIONS.map(c => (
              <button key={c} onClick={() => updateRoom(i, { condition: c })}
                className={`text-xs px-2 py-1 rounded-full border capitalize transition-colors ${room.condition === c ? CONDITION_COLORS[c] + " border-transparent" : "border-border hover:bg-muted"}`}>
                {c}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Notes (condition details, specific issues…)"
            value={room.notes ?? ""}
            onChange={e => updateRoom(i, { notes: e.target.value })}
            className="text-xs h-16 resize-none"
          />
        </div>
      ))}

      {rooms.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">Click room buttons above to add rooms to this inspection.</p>
      )}
    </div>
  );
}

// ─── Inspection detail / editor ───────────────────────────────────────────────
function InspectionDetail({ inspection, onClose }: { inspection: any; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rooms, setRooms] = useState<any[]>(inspection.rooms ?? []);
  const [notes, setNotes]   = useState(inspection.notes ?? "");
  const [overall, setOverall] = useState(inspection.overallCondition ?? "");
  const [elec, setElec]     = useState(inspection.electricityReading ?? "");
  const [water, setWater]   = useState(inspection.waterReading ?? "");
  const [recDed, setRecDed] = useState(inspection.recommendedDeduction ?? "");
  const [dedNotes, setDedNotes] = useState(inspection.deductionNotes ?? "");
  const [activeTab, setActiveTab] = useState("rooms");
  const [showDiff, setShowDiff] = useState(false);

  const { data: diff } = useQuery({
    queryKey: ["/api/inspections/diff", inspection.id],
    queryFn: async () => (await apiRequest(`/api/inspections/${inspection.id}/diff`)).json(),
    enabled: inspection.inspectionType === "move_out" && showDiff,
  });

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/inspections/${inspection.id}`, {
      method: "PATCH",
      data: { rooms, notes, overallCondition: overall, electricityReading: elec || null, waterReading: water || null, recommendedDeduction: recDed || null, deductionNotes: dedNotes || null, conductedDate: new Date().toISOString().slice(0,10), status: "in_progress" },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/inspections"] }); toast({ title: "Saved" }); },
  });

  const signManager = useMutation({
    mutationFn: () => apiRequest(`/api/inspections/${inspection.id}/sign-manager`, { method: "POST", data: { signatoryName: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/inspections"] }); toast({ title: "Signed as manager" }); onClose(); },
  });

  const isCompleted = ["completed", "pending_signature", "tenant_signed"].includes(inspection.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1"><ChevronRight className="h-4 w-4 rotate-180" />Back</Button>
        <span className="font-semibold">{inspection.inspectionNumber} — {inspection.inspectionType?.replace(/_/g," ")}</span>
        <Badge variant="outline" className={statusColor(inspection.status)}>{inspection.status}</Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Property</p><p className="font-medium">{inspection.propertyName ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Unit</p><p className="font-medium">{inspection.unitNumber ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Tenant</p><p className="font-medium">{inspection.tenantFirstName ? `${inspection.tenantFirstName} ${inspection.tenantLastName}` : "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium capitalize">{inspection.inspectionType?.replace(/_/g," ")}</p></div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="details">Details & Readings</TabsTrigger>
          {inspection.inspectionType === "move_out" && <TabsTrigger value="diff">Diff vs Move-In</TabsTrigger>}
          <TabsTrigger value="signatures">Signatures</TabsTrigger>
        </TabsList>

        <TabsContent value="rooms" className="pt-3">
          {isCompleted
            ? (
              <div className="space-y-2">
                {rooms.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg border">
                    <span className="font-medium text-sm flex-1">{r.room}</span>
                    <Badge variant="outline" className={CONDITION_COLORS[r.condition] ?? ""}>{r.condition}</Badge>
                    {r.notes && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{r.notes}</span>}
                  </div>
                ))}
              </div>
            )
            : <RoomEditor rooms={rooms} onChange={setRooms} />
          }
        </TabsContent>

        <TabsContent value="details" className="pt-3 space-y-4">
          <div>
            <Label className="text-xs">Overall condition</Label>
            <div className="flex gap-2 mt-1">
              {CONDITION_OPTIONS.map(c => (
                <button key={c} onClick={() => !isCompleted && setOverall(c)} className={`text-xs px-3 py-1.5 rounded-full border capitalize ${overall === c ? CONDITION_COLORS[c] + " border-transparent" : "border-border"} ${isCompleted ? "cursor-default" : "hover:bg-muted"}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3" />Electricity reading (kWh)</Label><Input type="number" value={elec} onChange={e => setElec(e.target.value)} disabled={isCompleted} /></div>
            <div><Label className="text-xs flex items-center gap-1"><Droplets className="h-3 w-3" />Water reading (m³)</Label><Input type="number" value={water} onChange={e => setWater(e.target.value)} disabled={isCompleted} /></div>
          </div>
          {inspection.inspectionType === "move_out" && (
            <>
              <div><Label className="text-xs">Recommended deposit deduction (KES)</Label><Input type="number" value={recDed} onChange={e => setRecDed(e.target.value)} disabled={isCompleted} /></div>
              <div><Label className="text-xs">Deduction notes</Label><Textarea value={dedNotes} onChange={e => setDedNotes(e.target.value)} className="h-20 resize-none" disabled={isCompleted} /></div>
            </>
          )}
          <div><Label className="text-xs">Inspector notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-20 resize-none" disabled={isCompleted} /></div>
        </TabsContent>

        {inspection.inspectionType === "move_out" && (
          <TabsContent value="diff" className="pt-3">
            <Button variant="outline" size="sm" onClick={() => setShowDiff(true)} className="mb-4">Load comparison vs move-in</Button>
            {diff && (
              diff.hasPrevious ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Move-in: {fmt(diff.moveInDate)} → Move-out: {fmt(diff.moveOutDate)}</p>
                  <p className="text-sm font-medium">{diff.degradedRooms} room(s) degraded · {fmtKES(diff.recommendedDeduction)} recommended deduction</p>
                  {diff.roomDiffs?.map((r: any, i: number) => (
                    <div key={i} className={`flex items-center gap-3 p-2 rounded-lg border text-sm ${r.degraded ? "border-red-200 bg-red-50/30" : ""}`}>
                      <span className="font-medium flex-1">{r.room}</span>
                      <Badge variant="outline" className={CONDITION_COLORS[r.moveInCondition] ?? ""}>{r.moveInCondition}</Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <Badge variant="outline" className={CONDITION_COLORS[r.moveOutCondition] ?? ""}>{r.moveOutCondition}</Badge>
                      {r.degraded && <AlertCircle className="h-4 w-4 text-red-500" />}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">{diff.message}</p>
            )}
          </TabsContent>
        )}

        <TabsContent value="signatures" className="pt-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className={inspection.managerSignedAt ? "border-emerald-200" : ""}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Manager</p>
                {inspection.managerSignedAt ? (
                  <><p className="font-medium text-sm">{inspection.managerSignatureName}</p><p className="text-xs text-muted-foreground">{fmt(inspection.managerSignedAt)}</p></>
                ) : (
                  <><p className="text-sm text-muted-foreground mb-2">Not signed</p>
                  <Button size="sm" onClick={() => signManager.mutate()} disabled={signManager.isPending || rooms.length === 0}>
                    {signManager.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Pencil className="h-3.5 w-3.5 mr-1" />} Sign as Manager
                  </Button></>
                )}
              </CardContent>
            </Card>
            <Card className={inspection.tenantSignedAt ? "border-emerald-200" : ""}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Tenant</p>
                {inspection.tenantSignedAt
                  ? <><p className="font-medium text-sm">{inspection.tenantSignatureName}</p><p className="text-xs text-muted-foreground">{fmt(inspection.tenantSignedAt)}</p></>
                  : <p className="text-sm text-muted-foreground">Pending tenant signature</p>
                }
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {!isCompleted && (
        <div className="flex gap-2 pt-2 border-t">
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save progress
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Inspections() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterProp, setFilterProp] = useState("all");
  const [form, setForm] = useState<any>({ inspectionType: "move_in" });

  const { data: properties = [] } = useQuery({ queryKey: ["/api/properties"], queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()) });
  const { data: units = [] }      = useQuery({ queryKey: ["/api/units"], queryFn: async () => ensureArray(await (await apiRequest("/api/units")).json()), enabled: !!form.propertyId });

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ["/api/inspections", filterType, filterProp],
    queryFn: async () => {
      let url = "/api/inspections";
      const params = [];
      if (filterType && filterType !== "all") params.push(`type=${filterType}`);
      if (filterProp && filterProp !== "all") params.push(`propertyId=${filterProp}`);
      if (params.length) url += "?" + params.join("&");
      return ensureArray(await (await apiRequest(url)).json());
    },
  });

  const create = useMutation({
    mutationFn: () => apiRequest("/api/inspections", { method: "POST", data: form }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["/api/inspections"] }); setShowCreate(false); r.json().then((insp: any) => setSelected(insp)); toast({ title: "Inspection created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (selected) return (
    <div className="min-h-screen p-4 sm:p-6 bg-background text-foreground">
      <InspectionDetail inspection={selected} onClose={() => setSelected(null)} />
    </div>
  );

  return (
    <div className="min-h-screen p-4 sm:p-6 bg-background text-foreground">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-lg bg-blue-500/10 p-2"><ClipboardList className="h-5 w-5 text-blue-600" /></div>
            <h1 className="text-xl font-semibold">Property Inspections</h1>
          </div>
          <p className="text-sm text-muted-foreground">Move-in, move-out, and periodic condition reports with digital signatures.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-1.5 shrink-0"><Plus className="h-4 w-4" />New inspection</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4">
        <Select value={filterProp} onValueChange={setFilterProp}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All properties" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {INSPECTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="space-y-3">
        {inspections.map((insp: any) => (
          <Card key={insp.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(insp)}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{insp.inspectionNumber}</span>
                    <Badge variant="outline">{insp.inspectionType?.replace(/_/g," ")}</Badge>
                    <Badge variant="outline" className={statusColor(insp.status)}>{insp.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {insp.propertyName ?? "—"} · Unit {insp.unitNumber ?? "—"}
                    {insp.tenantFirstName && ` · ${insp.tenantFirstName} ${insp.tenantLastName}`}
                  </p>
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    {insp.conductedDate && <span>Conducted: {fmt(insp.conductedDate)}</span>}
                    {insp.managerSignedAt && <span className="flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Manager</span>}
                    {insp.tenantSignedAt  && <span className="flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Tenant</span>}
                    {insp.recommendedDeduction > 0 && <span className="text-amber-600">Deduction: {fmtKES(insp.recommendedDeduction)}</span>}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && !inspections.length && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No inspections found. Create one to get started.</CardContent></Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>New Inspection</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="col-span-2">
              <Label className="text-xs">Type</Label>
              <Select value={form.inspectionType} onValueChange={v => setForm((f: any) => ({ ...f, inspectionType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INSPECTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Property</Label>
              <Select value={String(form.propertyId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, propertyId: parseInt(v), unitId: undefined }))}>
                <SelectTrigger><SelectValue placeholder="Select property…" /></SelectTrigger>
                <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Unit</Label>
              <Select value={String(form.unitId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, unitId: parseInt(v) }))}>
                <SelectTrigger><SelectValue placeholder="Select unit…" /></SelectTrigger>
                <SelectContent>{units.filter((u: any) => !form.propertyId || u.propertyId === form.propertyId).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.unitNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Scheduled date</Label>
              <Input type="date" value={form.scheduledDate ?? ""} onChange={e => setForm((f: any) => ({ ...f, scheduledDate: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.propertyId || create.isPending}>
                {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}