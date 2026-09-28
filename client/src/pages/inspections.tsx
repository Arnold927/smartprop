/**
 * Inspections — /inspections
 *
 * Property condition inspections: move-in, move-out, periodic, pre-letting.
 * Mobile-first: managers conduct inspections room-by-room (with photos), sign on-screen,
 * and the tenant then countersigns from their own portal (Documents tab).
 *
 * Flow: draft → in_progress (Save progress) → pending_signature (manager signs; record locks)
 *       → completed (tenant countersigns).
 */
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray, uploadWithAuth } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton,
  FilterBar, StatTile, StatsGrid, ConfirmDialog,
} from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import {
  ClipboardList, Plus, Loader2, CheckCircle2, AlertCircle, Camera, Pencil,
  ChevronRight, Zap, Droplets, X, Lock, Clock, FileText,
} from "lucide-react";

const fmt    = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const fmtKES = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

/** apiRequest throws the raw response body; pull the server's `message` out of it for toasts. */
const errMsg = (e: any): string => {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
};

const CONDITION_OPTIONS = ["excellent", "good", "fair", "poor"];
const CONDITION_COLORS: Record<string, string> = {
  excellent: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  good:      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800",
  fair:      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
  poor:      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800",
};
const INSPECTION_TYPES = [
  { value: "move_in",     label: "Move-in" },
  { value: "move_out",    label: "Move-out" },
  { value: "periodic",    label: "Periodic" },
  { value: "pre_letting", label: "Pre-letting" },
  { value: "emergency",   label: "Emergency" },
];
const UNIT_REQUIRED_TYPES = ["move_in", "move_out"];
const DEFAULT_ROOMS = ["Living Room", "Master Bedroom", "Bedroom 2", "Kitchen", "Bathroom", "Toilet", "Corridor", "Balcony", "Parking", "Store"];
const MAX_PHOTOS_PER_ROOM = 6;
const PHOTO_ROLES = ["admin", "manager", "staff", "platform_admin"]; // matches the /api/upload role policy

function ConditionBadge({ condition }: { condition?: string | null }) {
  if (!condition) return null;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium capitalize",
      CONDITION_COLORS[condition] ?? "bg-muted text-muted-foreground border-border",
    )}>{condition}</span>
  );
}

// ─── Photos ───────────────────────────────────────────────────────────────────
function PhotoStrip({ urls, onRemove }: { urls: string[]; onRemove?: (url: string) => void }) {
  if (!urls?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map(u => (
        <div key={u} className="relative group">
          <a href={u} target="_blank" rel="noreferrer">
            <img src={u} alt="Room photo" loading="lazy" className="h-16 w-16 rounded-md object-cover border border-border" />
          </a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(u)} aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border text-muted-foreground hover:text-red-500 flex items-center justify-center">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Room editor ──────────────────────────────────────────────────────────────
// Takes the state setter itself (not a value callback) so a photo that finishes uploading
// after the manager has kept typing merges into the CURRENT rooms instead of overwriting them.
function RoomEditor({ rooms, setRooms, canUpload }: {
  rooms: any[]; setRooms: React.Dispatch<React.SetStateAction<any[]>>; canUpload: boolean;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const addRoom    = (name: string) => setRooms(prev => prev.find(r => r.room === name) ? prev : [...prev, { room: name, condition: "good", notes: "", photoUrls: [] }]);
  const updateRoom = (name: string, patch: any) => setRooms(prev => prev.map(r => r.room === name ? { ...r, ...patch } : r));
  const removeRoom = (name: string) => setRooms(prev => prev.filter(r => r.room !== name));

  const addPhotos = async (roomName: string, files: FileList | null) => {
    if (!files?.length) return;
    const room = rooms.find(r => r.room === roomName);
    const slots = MAX_PHOTOS_PER_ROOM - (room?.photoUrls?.length ?? 0);
    if (slots <= 0) { toast({ title: `Up to ${MAX_PHOTOS_PER_ROOM} photos per room`, variant: "destructive" }); return; }

    setUploading(roomName);
    try {
      for (const file of Array.from(files).slice(0, slots)) {
        if (!file.type.startsWith("image/")) { toast({ title: `${file.name} is not an image`, variant: "destructive" }); continue; }
        const fd = new FormData();
        fd.append("file", file);
        const res  = await uploadWithAuth("/api/upload/media?folder=inspections", fd);
        const { url } = await res.json();
        setRooms(prev => prev.map(r => r.room === roomName ? { ...r, photoUrls: [...(r.photoUrls ?? []), url] } : r));
      }
    } catch (e: any) {
      toast({ title: "Photo upload failed", description: errMsg(e), variant: "destructive" });
    } finally {
      setUploading(null);
      if (inputs.current[roomName]) inputs.current[roomName]!.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_ROOMS.filter(r => !rooms.find(rm => rm.room === r)).map(r => (
          <button key={r} type="button" onClick={() => addRoom(r)}
            className="text-xs px-2 py-1 rounded-md border border-dashed border-border hover:bg-muted transition-colors">
            + {r}
          </button>
        ))}
      </div>

      {rooms.map(room => (
        <div key={room.room} className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{room.room}</p>
            <button type="button" onClick={() => removeRoom(room.room)} className="text-muted-foreground hover:text-red-500 text-xs">Remove</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {CONDITION_OPTIONS.map(c => (
              <button key={c} type="button" onClick={() => updateRoom(room.room, { condition: c })}
                className={cn(
                  "text-xs px-2 py-1 rounded-full border capitalize transition-colors",
                  room.condition === c ? CONDITION_COLORS[c] : "border-border hover:bg-muted",
                )}>
                {c}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Notes (condition details, specific issues…)"
            value={room.notes ?? ""}
            onChange={e => updateRoom(room.room, { notes: e.target.value })}
            className="text-xs h-16 resize-none"
          />
          <PhotoStrip urls={room.photoUrls ?? []} onRemove={u => updateRoom(room.room, { photoUrls: (room.photoUrls ?? []).filter((x: string) => x !== u) })} />
          {canUpload && (
            <>
              <input ref={el => { inputs.current[room.room] = el; }} type="file" accept="image/*" multiple className="hidden"
                onChange={e => addPhotos(room.room, e.target.files)} />
              <Button type="button" variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                disabled={uploading === room.room || (room.photoUrls?.length ?? 0) >= MAX_PHOTOS_PER_ROOM}
                onClick={() => inputs.current[room.room]?.click()}>
                {uploading === room.room ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {uploading === room.room ? "Uploading…" : "Add photo"}
              </Button>
            </>
          )}
        </div>
      ))}

      {rooms.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">Click room buttons above to add rooms to this inspection.</p>
      )}
    </div>
  );
}

/** Read-only rooms — used once an inspection is signed and locked. */
function RoomList({ rooms }: { rooms: any[] }) {
  if (!rooms.length) return <p className="text-sm text-muted-foreground py-4 text-center">No rooms were recorded.</p>;
  return (
    <div className="space-y-2">
      {rooms.map((r: any) => (
        <div key={r.room} className="p-3 rounded-lg border border-border space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm flex-1">{r.room}</span>
            <ConditionBadge condition={r.condition} />
          </div>
          {r.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.notes}</p>}
          <PhotoStrip urls={r.photoUrls ?? []} />
        </div>
      ))}
    </div>
  );
}

// ─── Inspection detail ────────────────────────────────────────────────────────
// The list only carries summary fields. The full record (rooms, notes, readings, signatures) is
// loaded here by id — opening a row from the list used to show an empty room list, and saving
// from that state would have overwritten the real one.
function InspectionDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/inspections", "detail", id],
    queryFn: async () => (await apiRequest(`/api/inspections/${id}`)).json(),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !data) return (
    <SectionCard>
      <EmptyState icon={<AlertCircle />} title="Couldn't load this inspection" description={errMsg(error)} size="lg"
        action={{ label: "Back to inspections", onClick: onClose }} />
    </SectionCard>
  );
  return <InspectionEditor key={data.id} inspection={data} onClose={onClose} />;
}

function InspectionEditor({ inspection, onClose }: { inspection: any; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const detailKey = ["/api/inspections", "detail", inspection.id];

  const [rooms, setRooms]       = useState<any[]>(Array.isArray(inspection.rooms) ? inspection.rooms : []);
  const [notes, setNotes]       = useState(inspection.notes ?? "");
  const [overall, setOverall]   = useState(inspection.overallCondition ?? "");
  const [elec, setElec]         = useState(inspection.electricityReading ?? "");
  const [water, setWater]       = useState(inspection.waterReading ?? "");
  const [recDed, setRecDed]     = useState(inspection.recommendedDeduction && Number(inspection.recommendedDeduction) > 0 ? String(inspection.recommendedDeduction) : "");
  const [dedNotes, setDedNotes] = useState(inspection.deductionNotes ?? "");
  const [activeTab, setActiveTab]     = useState("rooms");
  const [confirmSign, setConfirmSign] = useState(false);

  const isMoveOut = inspection.inspectionType === "move_out";
  // Locked by the record itself (a signature exists), not by guessing from the status word.
  const locked    = !!(inspection.managerSignedAt || inspection.tenantSignedAt);
  const canUpload = PHOTO_ROLES.includes((user as any)?.role ?? "");
  const signerName = `${(user as any)?.firstName ?? ""} ${(user as any)?.lastName ?? ""}`.trim() || (user as any)?.email || "";

  const { data: diff, isFetching: diffLoading } = useQuery<any>({
    queryKey: ["/api/inspections", "diff", inspection.id],
    queryFn: async () => (await apiRequest(`/api/inspections/${inspection.id}/diff`)).json(),
    enabled: isMoveOut && activeTab === "diff",
  });

  const payload = () => ({
    rooms,
    notes,
    overallCondition:   overall || null,
    electricityReading: elec === "" ? null : elec,
    waterReading:       water === "" ? null : water,
    ...(isMoveOut ? { recommendedDeduction: recDed === "" ? null : recDed, deductionNotes: dedNotes || null } : {}),
    conductedDate: inspection.conductedDate ?? new Date().toISOString().slice(0, 10),
    status: "in_progress",
  });

  /** Merge a server response into the cached detail (PATCH/sign return the row without joined labels). */
  const applyServerRow = (row: any) => {
    qc.setQueryData(detailKey, (old: any) => ({ ...old, ...row }));
    qc.invalidateQueries({ queryKey: ["/api/inspections"] });
  };

  const save = useMutation({
    mutationFn: async () => (await apiRequest(`/api/inspections/${inspection.id}`, { method: "PATCH", data: payload() })).json(),
    onSuccess: (row) => { applyServerRow(row); toast({ title: "Progress saved" }); },
    onError:   (e: any) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });

  // Signing always saves first: what gets signed is exactly what is on screen, never an older
  // saved copy (and the server refuses to sign a record with no saved rooms).
  const sign = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/inspections/${inspection.id}`, { method: "PATCH", data: payload() });
      return (await apiRequest(`/api/inspections/${inspection.id}/sign-manager`, { method: "POST", data: { signatoryName: signerName } })).json();
    },
    onSuccess: (row) => {
      applyServerRow(row);
      setConfirmSign(false);
      setActiveTab("signatures");
      toast({ title: "Inspection signed", description: inspection.tenantId ? "The tenant has been asked to countersign." : undefined });
    },
    onError: (e: any) => { setConfirmSign(false); toast({ title: "Couldn't sign", description: errMsg(e), variant: "destructive" }); },
  });

  const tenantName = inspection.tenantFirstName ? `${inspection.tenantFirstName} ${inspection.tenantLastName ?? ""}`.trim() : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1"><ChevronRight className="h-4 w-4 rotate-180" />Back</Button>
        <span className="font-semibold">{inspection.inspectionNumber} — {inspection.inspectionType?.replace(/_/g, " ")}</span>
        <SPBadge status={inspection.status} />
        {locked && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Signed — read only</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Property</p><p className="font-medium">{inspection.propertyName ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Unit</p><p className="font-medium">{inspection.unitNumber ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Tenant</p><p className="font-medium">{tenantName}</p></div>
        <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium capitalize">{inspection.inspectionType?.replace(/_/g, " ")}</p></div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="details">Details & Readings</TabsTrigger>
          {isMoveOut && <TabsTrigger value="diff">Diff vs Move-In</TabsTrigger>}
          <TabsTrigger value="signatures">Signatures</TabsTrigger>
        </TabsList>

        <TabsContent value="rooms" className="pt-3">
          {locked ? <RoomList rooms={rooms} /> : <RoomEditor rooms={rooms} setRooms={setRooms} canUpload={canUpload} />}
        </TabsContent>

        <TabsContent value="details" className="pt-3 space-y-4">
          <div>
            <Label className="text-xs">Overall condition</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {CONDITION_OPTIONS.map(c => (
                <button key={c} type="button" disabled={locked} onClick={() => setOverall(c)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-full border capitalize transition-colors",
                    overall === c ? CONDITION_COLORS[c] : "border-border",
                    locked ? "cursor-default" : "hover:bg-muted",
                  )}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3" />Electricity reading (kWh)</Label><Input type="number" min="0" value={elec} onChange={e => setElec(e.target.value)} disabled={locked} /></div>
            <div><Label className="text-xs flex items-center gap-1"><Droplets className="h-3 w-3" />Water reading (m³)</Label><Input type="number" min="0" value={water} onChange={e => setWater(e.target.value)} disabled={locked} /></div>
          </div>
          {isMoveOut && (
            <>
              <div><Label className="text-xs">Recommended deposit deduction (KES)</Label><Input type="number" min="0" value={recDed} onChange={e => setRecDed(e.target.value)} disabled={locked} /></div>
              <div><Label className="text-xs">Deduction notes</Label><Textarea value={dedNotes} onChange={e => setDedNotes(e.target.value)} className="h-20 resize-none" disabled={locked} /></div>
            </>
          )}
          <div><Label className="text-xs">Inspector notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-20 resize-none" disabled={locked} /></div>
        </TabsContent>

        {isMoveOut && (
          <TabsContent value="diff" className="pt-3">
            {diffLoading && !diff && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {diff && (diff.hasPrevious ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Move-in: {fmt(diff.moveInDate)} → Move-out: {fmt(diff.moveOutDate)}</p>
                <p className="text-sm font-medium">{diff.degradedRooms} room(s) degraded · {fmtKES(diff.recommendedDeduction)} recommended deduction</p>
                {!locked && <p className="text-xs text-muted-foreground">Compared using your last saved progress — save to refresh it.</p>}
                {diff.roomDiffs?.map((r: any) => (
                  <div key={r.room} className={cn("flex items-center gap-3 p-2 rounded-lg border text-sm", r.degraded ? "border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20" : "border-border")}>
                    <span className="font-medium flex-1">{r.room}</span>
                    <ConditionBadge condition={r.moveInCondition} />
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <ConditionBadge condition={r.moveOutCondition} />
                    {r.degraded && <AlertCircle className="h-4 w-4 text-red-500" />}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">{diff.message}</p>)}
          </TabsContent>
        )}

        <TabsContent value="signatures" className="pt-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className={inspection.managerSignedAt ? "border-emerald-200 dark:border-emerald-800" : ""}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Manager</p>
                {inspection.managerSignedAt ? (
                  <><p className="font-medium text-sm">{inspection.managerSignatureName}</p><p className="text-xs text-muted-foreground">{fmt(inspection.managerSignedAt)}</p></>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-2">Not signed. Signing saves the report and locks it.</p>
                    <Button size="sm" onClick={() => setConfirmSign(true)} disabled={sign.isPending || rooms.length === 0} className="gap-1.5">
                      <Pencil className="h-3.5 w-3.5" /> Sign inspection
                    </Button>
                    {rooms.length === 0 && <p className="text-xs text-muted-foreground mt-2">Add at least one room first.</p>}
                  </>
                )}
              </CardContent>
            </Card>
            <Card className={inspection.tenantSignedAt ? "border-emerald-200 dark:border-emerald-800" : ""}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground mb-1">Tenant</p>
                {inspection.tenantSignedAt ? (
                  <><p className="font-medium text-sm">{inspection.tenantSignatureName}</p><p className="text-xs text-muted-foreground">{fmt(inspection.tenantSignedAt)}</p></>
                ) : !inspection.tenantId ? (
                  <p className="text-sm text-muted-foreground">No tenant is linked to this unit, so there is no countersignature to collect.</p>
                ) : !inspection.managerSignedAt ? (
                  <p className="text-sm text-muted-foreground">The tenant can countersign once you have signed.</p>
                ) : (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Waiting for {tenantName} to countersign in their portal.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {!locked && (
        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={() => save.mutate()} disabled={save.isPending || sign.isPending} className="gap-1.5">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save progress
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmSign}
        onClose={() => setConfirmSign(false)}
        onConfirm={() => sign.mutate()}
        loading={sign.isPending}
        title="Sign this inspection?"
        description={`This saves the report as it appears now and signs it as ${signerName || "you"}. Once signed it can no longer be edited.`}
        confirmLabel="Sign inspection"
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Inspections() {
  const guard = useRoleGuard(ROLES.STAFF_AND_ABOVE); // ProtectedRoute holds rendering until auth has loaded, so this early return never flips mid-life
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch]         = useState("");
  const [filterType, setFilterType]     = useState("all");
  const [filterProp, setFilterProp]     = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const emptyForm = { inspectionType: "move_in" } as any;
  const [form, setForm] = useState<any>(emptyForm);

  const { data: properties = [] } = useQuery<any[]>({ queryKey: ["/api/properties"], queryFn: async () => ensureArray(await (await apiRequest("/api/properties")).json()) });
  const { data: units = [] }      = useQuery<any[]>({ queryKey: ["/api/units"], queryFn: async () => ensureArray(await (await apiRequest("/api/units")).json()), enabled: showCreate && !!form.propertyId });

  const { data: inspections = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/inspections", "list", filterType, filterProp],
    queryFn: async () => {
      const params: string[] = [];
      if (filterType !== "all") params.push(`type=${filterType}`);
      if (filterProp !== "all") params.push(`propertyId=${filterProp}`);
      return ensureArray(await (await apiRequest("/api/inspections" + (params.length ? "?" + params.join("&") : ""))).json());
    },
  });

  const needsUnit = UNIT_REQUIRED_TYPES.includes(form.inspectionType);

  const create = useMutation({
    mutationFn: async () => (await apiRequest("/api/inspections", { method: "POST", data: form })).json(),
    onSuccess: (insp: any) => {
      qc.invalidateQueries({ queryKey: ["/api/inspections"] });
      setShowCreate(false);
      setForm(emptyForm);
      setSelectedId(insp.id);
      toast({ title: "Inspection created" });
    },
    onError: (e: any) => toast({ title: "Couldn't create inspection", description: errMsg(e), variant: "destructive" }),
  });

  if (selectedId !== null) return (
    <PageShell><InspectionDetail id={selectedId} onClose={() => setSelectedId(null)} /></PageShell>
  );

  const q = search.trim().toLowerCase();
  const shown = inspections.filter((i: any) =>
    (filterStatus === "all" || i.status === filterStatus) &&
    (!q || [i.inspectionNumber, i.propertyName, i.unitNumber, i.tenantFirstName, i.tenantLastName].join(" ").toLowerCase().includes(q)),
  );
  const count = (...s: string[]) => inspections.filter((i: any) => s.includes(i.status)).length;

  return (
    <PageShell>
      <PageHeader
        title="Property Inspections"
        subtitle="Move-in, move-out, and periodic condition reports with digital signatures."
        icon={<ClipboardList className="w-5 h-5" />}
        actions={<PrimaryButton icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>New inspection</PrimaryButton>}
      />

      <StatsGrid cols={4}>
        <StatTile label="Total" value={inspections.length} icon={<FileText className="w-4 h-4" />} accent="blue" />
        <StatTile label="In progress" value={count("draft", "in_progress")} icon={<Pencil className="w-4 h-4" />} accent="amber" />
        <StatTile label="Awaiting tenant" value={count("pending_signature", "tenant_signed")} icon={<Clock className="w-4 h-4" />} accent="violet" />
        <StatTile label="Completed" value={count("completed")} icon={<CheckCircle2 className="w-4 h-4" />} accent="emerald" />
      </StatsGrid>

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search by number, property, unit or tenant…"
        filters={
          <>
            <Select value={filterProp} onValueChange={setFilterProp}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All properties" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {INSPECTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="pending_signature">Awaiting tenant</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      <div className="space-y-3">
        {shown.map((insp: any) => (
          <Card key={insp.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedId(insp.id)}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{insp.inspectionNumber}</span>
                    <Badge variant="outline" className="capitalize">{insp.inspectionType?.replace(/_/g, " ")}</Badge>
                    <SPBadge status={insp.status} />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {insp.propertyName ?? "—"} · Unit {insp.unitNumber ?? "—"}
                    {insp.tenantFirstName && ` · ${insp.tenantFirstName} ${insp.tenantLastName ?? ""}`}
                  </p>
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                    {insp.conductedDate && <span>Conducted: {fmt(insp.conductedDate)}</span>}
                    {insp.managerSignedAt && <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Manager</span>}
                    {insp.tenantSignedAt  && <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Tenant</span>}
                    {Number(insp.recommendedDeduction) > 0 && <span className="text-amber-600 dark:text-amber-400">Deduction: {fmtKES(insp.recommendedDeduction)}</span>}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && !shown.length && (
          <SectionCard>
            <EmptyState
              icon={<ClipboardList />}
              title={inspections.length ? "No inspections match your filters" : "No inspections yet"}
              description={inspections.length ? undefined : "Create one to start a condition report."}
              size="lg"
            />
          </SectionCard>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={o => { setShowCreate(o); if (!o) setForm(emptyForm); }}>
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
              <Label className="text-xs">Unit{needsUnit ? " *" : " (optional)"}</Label>
              <Select value={String(form.unitId ?? "")} onValueChange={v => setForm((f: any) => ({ ...f, unitId: parseInt(v) }))} disabled={!form.propertyId}>
                <SelectTrigger><SelectValue placeholder={form.propertyId ? "Select unit…" : "Select a property first"} /></SelectTrigger>
                <SelectContent>
                  {units.filter((u: any) => u.propertyId === form.propertyId).map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.unitNumber}{u.isOccupied === false ? " · vacant" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Scheduled date</Label>
              <Input type="date" value={form.scheduledDate ?? ""} onChange={e => setForm((f: any) => ({ ...f, scheduledDate: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.propertyId || (needsUnit && !form.unitId) || create.isPending}>
                {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}