import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { withOrgParam } from "@/lib/platformOrgContext";
import { downloadExcel } from "@/lib/excel";
import {
  UNIT_TYPE_OPTIONS, UNIT_TEMPLATE_CSV, MAX_UNITS, blankRow, generateUnits, groupUnitCount, isResidentialType,
  newGroup, parsePastedUnits, rowRent, rowToPayload, validateUnitRows,
  type NumberPattern, type UnitGroup, type UnitRow, type UnitTypeValue,
} from "@/lib/unit-layout";
import { AlertTriangle, ClipboardPaste, Download, Layers, Loader2, Plus, Trash2, Upload, Wand2 } from "lucide-react";

/** apiRequest throws on a non-2xx response with the raw response TEXT as e.message. */
function parseErr(e: any): { message: string; rowErrors?: { row: number; unitNumber: string; message: string }[] } {
  try { const j = JSON.parse(e?.message); if (j?.message) return { message: String(j.message), rowErrors: j.rowErrors }; } catch { /* not JSON */ }
  return { message: e?.message || "Something went wrong" };
}

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const cellInput = "h-8 px-2 text-sm";
const CURRENCIES = ["KES", "USD", "EUR", "GBP", "TZS", "UGX"];
const PATTERN_LABEL: Record<NumberPattern, string> = {
  floor_number: "Floor + number  (101, 102 … 201)",
  floor_letter: "Floor + letter  (1A, 1B … 2A)",
  sequence: "Plain sequence  (1, 2, 3 …)",
};

type Field = "unitNumber" | "floor" | "unitType" | "bedrooms" | "bathrooms" | "sqft" | "rentBasis" | "ratePerSqft" | "monthlyRent";

/**
 * "Add property with units" — the fast way to set up a building.
 *
 * Instead of creating a property and then opening Add Unit once per unit, describe the building in
 * a few lines (floors 1–8, 10 units a floor, 2-bed at 45,000 …) or paste the unit list from a
 * spreadsheet, tweak any exceptions in the table, and create everything in one go.
 *
 * `organizationId` is only used by a platform admin (who isn't tied to one organisation); every
 * other role is scoped to their own organisation by the server.
 */
export function BulkPropertyDialog({
  open, onOpenChange, organizationId, organizationName, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId?: string | null;
  /** Shown to a platform admin so they can see which organisation the property is going into. */
  organizationName?: string;
  onCreated?: (result: { property: { id: number; name: string }; unitCount: number }) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isLandlord = user?.role === "landlord";

  // ── property ──
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [propertyType, setPropertyType] = useState<"residential" | "commercial" | "mixed_use">("residential");
  const [owner, setOwner] = useState("");
  const [currency, setCurrency] = useState("KES");

  // ── units ──
  const [tab, setTab] = useState<"pattern" | "paste">("pattern");
  const [groups, setGroups] = useState<UnitGroup[]>([newGroup()]);
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState<string[]>([]);
  const [bulkField, setBulkField] = useState<Field>("monthlyRent");
  const [bulkValue, setBulkValue] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverRowErrors, setServerRowErrors] = useState<Map<string, string>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  // Owner choices: landlord logins + landlords without a login. A landlord creating their own
  // property doesn't pick (it's always theirs), so these are only fetched for the other roles.
  const { data: owners = [] } = useQuery<{ value: string; label: string; description?: string; keywords?: string }[]>({
    queryKey: ["/api/property-setup", "owners", organizationId ?? null],
    enabled: open && !isLandlord && !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const out: { value: string; label: string; description?: string; keywords?: string }[] = [];
      try {
        const r = await apiRequest(withOrgParam("/api/users?role=landlord&limit=100", organizationId));
        for (const u of ensureArray(await r.json()) as any[]) {
          out.push({
            value: `u:${u.id}`, label: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
            description: "Landlord (has a login)", keywords: u.email,
          });
        }
      } catch { /* not allowed or none — the owner is optional */ }
      try {
        const r = await apiRequest(withOrgParam("/api/external-landlords", organizationId));
        for (const l of ensureArray(await r.json()) as any[]) {
          out.push({ value: `e:${l.id}`, label: l.name, description: "Landlord without a login", keywords: l.email ?? "" });
        }
      } catch { /* optional */ }
      return out;
    },
  });

  const problems = useMemo(() => validateUnitRows(rows), [rows]);
  const problemCount = problems.size;
  const totalRent = useMemo(() => rows.reduce((s, r) => s + rowRent(r), 0), [rows]);
  const floors = useMemo(() => new Set(rows.map((r) => r.floor.trim()).filter(Boolean)).size, [rows]);
  const anyPerSqft = rows.some((r) => r.rentBasis === "per_sqft");
  const showBasis = propertyType !== "residential" || anyPerSqft;
  const groupsTotal = groups.reduce((s, g) => s + groupUnitCount(g), 0);

  const reset = () => {
    setName(""); setAddress(""); setPropertyType("residential"); setOwner(""); setCurrency("KES");
    setTab("pattern"); setGroups([newGroup()]); setRows([]); setPasteText(""); setPasteWarnings([]);
    setBulkValue(""); setServerError(null); setServerRowErrors(new Map());
  };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const patchGroup = (id: string, patch: Partial<UnitGroup>) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const patchRow = (key: string, patch: Partial<UnitRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRows = (incoming: UnitRow[], replace: boolean) => {
    const next = replace ? incoming : [...rows, ...incoming];
    if (next.length > MAX_UNITS) {
      toast({ title: `Up to ${MAX_UNITS} units at a time`, description: "Create the rest as a second batch afterwards.", variant: "destructive" });
      setRows(next.slice(0, MAX_UNITS));
    } else setRows(next);
    setServerError(null); setServerRowErrors(new Map());
  };

  const readPasted = (text: string, replace: boolean) => {
    const { rows: parsed, warnings } = parsePastedUnits(text);
    setPasteWarnings(warnings);
    if (parsed.length) { addRows(parsed, replace); }
  };

  const applyBulk = () => {
    if (!rows.length) return;
    const v = bulkValue.trim();
    setRows((rs) => rs.map((r) => {
      switch (bulkField) {
        case "unitType": return { ...r, unitType: (v || "apartment") as UnitTypeValue, ...(isResidentialType(v) ? {} : { bedrooms: "", bathrooms: "" }) };
        case "bedrooms": case "bathrooms": return isResidentialType(r.unitType) ? { ...r, [bulkField]: v } : r;
        default: return { ...r, [bulkField]: v } as UnitRow;
      }
    }));
  };

  const create = useMutation({
    mutationFn: async () => {
      const [kind, id] = owner ? owner.split(":") : ["", ""];
      const res = await apiRequest(withOrgParam("/api/property-setup", organizationId), {
        method: "POST",
        data: {
          property: {
            name: name.trim(), address: address.trim(), propertyType,
            ...(kind === "u" ? { ownerId: id } : {}),
            ...(kind === "e" ? { externalLandlordId: Number(id) } : {}),
          },
          units: rows.map((r) => ({ ...rowToPayload(r), currency })),
        },
      });
      return res.json() as Promise<{ property: { id: number; name: string }; unitCount: number; monthlyPotentialRent: number }>;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/properties"] });
      qc.invalidateQueries({ queryKey: ["/api/units"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      qc.invalidateQueries({ queryKey: ["/api/platform-admin/organizations"] });
      toast({ title: "Property added", description: `${r.property.name} · ${r.unitCount} unit${r.unitCount === 1 ? "" : "s"} created.` });
      reset(); onOpenChange(false);
      onCreated?.(r);
    },
    onError: (e: any) => {
      const p = parseErr(e);
      setServerError(p.message);
      const m = new Map<string, string>();
      for (const re of p.rowErrors ?? []) { const row = rows[re.row - 1]; if (row) m.set(row.key, re.message); }
      setServerRowErrors(m);
    },
  });

  const infoMissing = !name.trim() || !address.trim();
  const canCreate = !infoMissing && rows.length > 0 && problemCount === 0 && !create.isPending;

  const downloadTemplate = () => {
    const lines = UNIT_TEMPLATE_CSV.trim().split("\n").map((l) => l.split(","));
    downloadExcel("units-template", lines[0], lines.slice(1).map((l) => l.map((c, i) => (i >= 3 && c !== "" ? Number(c) : c))));
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    const text = await f.text();
    setPasteText(text);
    readPasted(text, true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const fmt = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-6xl max-h-[94vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-5 w-5 text-emerald-600" /> Add a property with its units</DialogTitle>
          <DialogDescription>
            {organizationName && <b className="text-foreground">Adding to {organizationName}. </b>}
            Describe the building once — or paste the unit list from a spreadsheet — and every unit is created together.
          </DialogDescription>
        </DialogHeader>

        {/* ── 1. Property ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white">1</span>The property</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="bp-name">Property name *</Label>
              <Input id="bp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kileleshwa Heights" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="bp-address">Address *</Label>
              <Input id="bp-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Othaya Road, Kileleshwa, Nairobi" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-type">Type</Label>
              <select id="bp-type" className={selectCls} value={propertyType} onChange={(e) => setPropertyType(e.target.value as any)}>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="mixed_use">Mixed use</option>
              </select>
            </div>
            {!isLandlord && (
              <div className="space-y-1.5 lg:col-span-2">
                <Label>Owner <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <SearchableSelect
                  value={owner} onValueChange={setOwner} options={owners} clearable
                  placeholder="No owner assigned" searchPlaceholder="Search landlords…" emptyText="No landlords yet"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bp-cur">Rent currency</Label>
              <select id="bp-cur" className={selectCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* ── 2. Units: pattern or paste ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white">2</span>The units</h3>
            <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="tablist">
              {([["pattern", "Generate by floors", Wand2], ["paste", "Paste / upload a list", ClipboardPaste]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === k ? "bg-emerald-700 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
          </div>

          {tab === "pattern" ? (
            <div className="space-y-3">
              {groups.map((g, gi) => {
                const residential = isResidentialType(g.unitType);
                return (
                  <div key={g.id} className="rounded-xl border border-border bg-muted/30 p-3 space-y-3" data-testid={`group-${gi}`}>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
                      <div className="space-y-1"><Label className="text-xs">From floor</Label>
                        <Input type="number" className={cellInput} value={g.floorFrom} onChange={(e) => patchGroup(g.id, { floorFrom: parseInt(e.target.value) || 0 })} aria-label="From floor" /></div>
                      <div className="space-y-1"><Label className="text-xs">To floor</Label>
                        <Input type="number" className={cellInput} value={g.floorTo} onChange={(e) => patchGroup(g.id, { floorTo: parseInt(e.target.value) || 0 })} aria-label="To floor" /></div>
                      <div className="space-y-1"><Label className="text-xs">Units per floor</Label>
                        <Input type="number" min={0} className={cellInput} value={g.perFloor} onChange={(e) => patchGroup(g.id, { perFloor: parseInt(e.target.value) || 0 })} aria-label="Units per floor" /></div>
                      <div className="space-y-1 col-span-2"><Label className="text-xs">Numbering</Label>
                        <select className={selectCls} value={g.pattern} onChange={(e) => patchGroup(g.id, { pattern: e.target.value as NumberPattern })} aria-label="Numbering">
                          {Object.entries(PATTERN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></div>
                      <div className="space-y-1"><Label className="text-xs">{g.pattern === "sequence" ? "Prefix · start at" : "Prefix (optional)"}</Label>
                        <div className="flex gap-1">
                          <Input className={cellInput} value={g.prefix} onChange={(e) => patchGroup(g.id, { prefix: e.target.value })} placeholder="e.g. A-" aria-label="Prefix" />
                          {g.pattern === "sequence" && <Input type="number" className={`${cellInput} w-16`} value={g.startAt} onChange={(e) => patchGroup(g.id, { startAt: parseInt(e.target.value) || 0 })} aria-label="Start at" />}
                        </div></div>
                    </div>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
                      <div className="space-y-1 col-span-2"><Label className="text-xs">Unit type</Label>
                        <select className={selectCls} value={g.unitType} onChange={(e) => patchGroup(g.id, { unitType: e.target.value as UnitTypeValue })} aria-label="Unit type">
                          {UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select></div>
                      {residential && <>
                        <div className="space-y-1"><Label className="text-xs">Bedrooms</Label>
                          <Input type="number" min={0} className={cellInput} value={g.bedrooms} onChange={(e) => patchGroup(g.id, { bedrooms: e.target.value })} aria-label="Bedrooms" /></div>
                        <div className="space-y-1"><Label className="text-xs">Bathrooms</Label>
                          <Input type="number" min={0} step="0.5" className={cellInput} value={g.bathrooms} onChange={(e) => patchGroup(g.id, { bathrooms: e.target.value })} aria-label="Bathrooms" /></div>
                      </>}
                      <div className="space-y-1"><Label className="text-xs">Size (sqft)</Label>
                        <Input type="number" min={0} className={cellInput} value={g.sqft} onChange={(e) => patchGroup(g.id, { sqft: e.target.value })} aria-label="Sqft" /></div>
                      {!residential && (
                        <div className="space-y-1"><Label className="text-xs">Rent is</Label>
                          <select className={selectCls} value={g.rentBasis} onChange={(e) => patchGroup(g.id, { rentBasis: e.target.value as any })} aria-label="Rent basis">
                            <option value="fixed">A fixed amount</option><option value="per_sqft">Rate per sqft</option>
                          </select></div>
                      )}
                      {g.rentBasis === "per_sqft" && !residential ? (
                        <div className="space-y-1"><Label className="text-xs">Rate per sqft ({currency})</Label>
                          <Input type="number" min={0} className={cellInput} value={g.ratePerSqft} onChange={(e) => patchGroup(g.id, { ratePerSqft: e.target.value })} aria-label="Rate per sqft" /></div>
                      ) : (
                        <div className="space-y-1"><Label className="text-xs">Monthly rent ({currency}) *</Label>
                          <Input type="number" min={0} className={cellInput} value={g.monthlyRent} onChange={(e) => patchGroup(g.id, { monthlyRent: e.target.value })} aria-label="Monthly rent" /></div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span><b className="text-foreground">{groupUnitCount(g)}</b> unit{groupUnitCount(g) === 1 ? "" : "s"} · e.g. {generateUnits([{ ...g, floorTo: g.floorFrom, perFloor: Math.min(g.perFloor, 3) }]).map((r) => r.unitNumber).join(", ") || "—"}{g.perFloor > 3 ? " …" : ""}</span>
                      {groups.length > 1 && (
                        <button type="button" className="inline-flex items-center gap-1 text-red-600 hover:underline" onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}>
                          <Trash2 className="h-3 w-3" /> Remove group
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setGroups((gs) => [...gs, newGroup({ floorFrom: (gs[gs.length - 1]?.floorTo ?? 0) + 1, floorTo: (gs[gs.length - 1]?.floorTo ?? 0) + 1 })])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Another group (different floors or type)
                </Button>
                <div className="grow" />
                <Button type="button" variant="outline" size="sm" disabled={groupsTotal === 0} onClick={() => addRows(generateUnits(groups), false)}>Add to table</Button>
                <Button type="button" size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white" disabled={groupsTotal === 0}
                  onClick={() => addRows(generateUnits(groups), true)} data-testid="generate-units">
                  <Wand2 className="mr-1 h-3.5 w-3.5" /> Generate {groupsTotal > 0 ? Math.min(groupsTotal, MAX_UNITS) : ""} units
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Copy the rows from Excel or Google Sheets and paste them here (or upload a .csv). Columns it understands:
                <b> unit, floor, type, bedrooms, bathrooms, sqft, rent</b> (a header row is optional).
              </p>
              <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} className="font-mono text-xs"
                placeholder={"unit\tfloor\ttype\tbedrooms\tbathrooms\tsqft\trent\n101\t1\tapartment\t2\t2\t900\t45000"} aria-label="Pasted units" />
              {pasteWarnings.length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5">{pasteWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}><Download className="mr-1 h-3.5 w-3.5" /> Download template</Button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="units-file" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" /> Upload .csv</Button>
                <div className="grow" />
                <Button type="button" variant="outline" size="sm" disabled={!pasteText.trim()} onClick={() => readPasted(pasteText, false)}>Add to table</Button>
                <Button type="button" size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white" disabled={!pasteText.trim()} onClick={() => readPasted(pasteText, true)} data-testid="read-pasted">
                  Read these rows
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── 3. Review ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white">3</span>Review — fix any exceptions in the table</h3>
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Set all:</span>
                <select className={`${selectCls} !w-32 !h-8`} value={bulkField} onChange={(e) => { setBulkField(e.target.value as Field); setBulkValue(""); }} aria-label="Field to set for all">
                  <option value="monthlyRent">Rent</option><option value="bedrooms">Bedrooms</option><option value="bathrooms">Bathrooms</option>
                  <option value="sqft">Sqft</option><option value="floor">Floor</option><option value="unitType">Type</option>
                </select>
                {bulkField === "unitType" ? (
                  <select className={`${selectCls} !w-36 !h-8`} value={bulkValue || "apartment"} onChange={(e) => setBulkValue(e.target.value)} aria-label="Value for all">
                    {UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <Input className="h-8 w-28 px-2 text-sm" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Value for all" />
                )}
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={applyBulk} disabled={bulkValue.trim() === "" && bulkField !== "unitType"}>Apply to all</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-red-600" onClick={() => setRows([])}>Clear table</Button>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              No units yet — generate them above or paste a list. Everything appears here for a last check.
            </div>
          ) : (
            <div className="max-h-[360px] overflow-auto rounded-xl border border-border" data-testid="units-grid">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-2 py-2 text-left">#</th>
                    <th className="px-1 py-2 text-left">Unit *</th>
                    <th className="px-1 py-2 text-left w-20">Floor</th>
                    <th className="px-1 py-2 text-left w-36">Type</th>
                    <th className="px-1 py-2 text-left w-16">Beds</th>
                    <th className="px-1 py-2 text-left w-16">Baths</th>
                    <th className="px-1 py-2 text-left w-20">Sqft</th>
                    {showBasis && <th className="px-1 py-2 text-left w-32">Rent is</th>}
                    <th className="px-1 py-2 text-left w-32">{showBasis ? "Rent / rate *" : "Rent *"}</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const probs = problems.get(r.key) ?? [];
                    const srv = serverRowErrors.get(r.key);
                    const bad = (f: Field) => probs.some((p) => p.field === f) || (srv && f === "unitNumber");
                    const res = isResidentialType(r.unitType);
                    const ringBad = "border-red-500 ring-1 ring-red-400";
                    return (
                      <tr key={r.key} className={`border-t border-border/60 ${probs.length || srv ? "bg-red-50/60 dark:bg-red-950/20" : ""}`} data-testid="unit-row"
                        title={[...probs.map((p) => p.message), srv].filter(Boolean).join(" · ") || undefined}>
                        <td className="px-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-1 py-1"><Input className={`${cellInput} ${bad("unitNumber") ? ringBad : ""}`} value={r.unitNumber} onChange={(e) => patchRow(r.key, { unitNumber: e.target.value })} aria-label={`Unit number, row ${i + 1}`} /></td>
                        <td className="px-1 py-1"><Input className={cellInput} value={r.floor} onChange={(e) => patchRow(r.key, { floor: e.target.value })} aria-label={`Floor, row ${i + 1}`} /></td>
                        <td className="px-1 py-1">
                          <select className={`${selectCls} !h-8 !text-xs`} value={r.unitType} aria-label={`Type, row ${i + 1}`}
                            onChange={(e) => { const t = e.target.value as UnitTypeValue; patchRow(r.key, { unitType: t, ...(isResidentialType(t) ? {} : { bedrooms: "", bathrooms: "" }) }); }}>
                            {UNIT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1"><Input type="number" min={0} disabled={!res} className={cellInput} value={r.bedrooms} onChange={(e) => patchRow(r.key, { bedrooms: e.target.value })} aria-label={`Bedrooms, row ${i + 1}`} /></td>
                        <td className="px-1 py-1"><Input type="number" min={0} step="0.5" disabled={!res} className={cellInput} value={r.bathrooms} onChange={(e) => patchRow(r.key, { bathrooms: e.target.value })} aria-label={`Bathrooms, row ${i + 1}`} /></td>
                        <td className="px-1 py-1"><Input type="number" min={0} className={`${cellInput} ${bad("sqft") ? ringBad : ""}`} value={r.sqft} onChange={(e) => patchRow(r.key, { sqft: e.target.value })} aria-label={`Sqft, row ${i + 1}`} /></td>
                        {showBasis && (
                          <td className="px-1 py-1">
                            <select className={`${selectCls} !h-8 !text-xs`} value={r.rentBasis} onChange={(e) => patchRow(r.key, { rentBasis: e.target.value as any })} aria-label={`Rent basis, row ${i + 1}`}>
                              <option value="fixed">Fixed</option><option value="per_sqft">Per sqft</option>
                            </select>
                          </td>
                        )}
                        <td className="px-1 py-1">
                          {r.rentBasis === "per_sqft" ? (
                            <Input type="number" min={0} className={`${cellInput} ${bad("ratePerSqft") ? ringBad : ""}`} value={r.ratePerSqft} placeholder="rate / sqft" onChange={(e) => patchRow(r.key, { ratePerSqft: e.target.value })} aria-label={`Rate per sqft, row ${i + 1}`} />
                          ) : (
                            <Input type="number" min={0} className={`${cellInput} ${bad("monthlyRent") ? ringBad : ""}`} value={r.monthlyRent} onChange={(e) => patchRow(r.key, { monthlyRent: e.target.value })} aria-label={`Rent, row ${i + 1}`} />
                          )}
                        </td>
                        <td className="px-1 text-center">
                          <button type="button" className="text-muted-foreground hover:text-red-600" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove row ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && rows.length < MAX_UNITS && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRows((rs) => [...rs, blankRow({ unitType: rs[rs.length - 1]?.unitType ?? "apartment", floor: rs[rs.length - 1]?.floor ?? "", monthlyRent: rs[rs.length - 1]?.monthlyRent ?? "" })])}>
              <Plus className="mr-1 h-3 w-3" /> Add one more row
            </Button>
          )}
        </section>

        {/* ── footer ── */}
        {(serverError || problemCount > 0) && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError ?? `${problemCount} unit${problemCount === 1 ? "" : "s"} need${problemCount === 1 ? "s" : ""} attention — hover a highlighted row to see what's missing.`}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground" data-testid="summary">
            <b className="text-foreground">{rows.length}</b> unit{rows.length === 1 ? "" : "s"}
            {floors > 0 && <> · {floors} floor{floors === 1 ? "" : "s"}</>}
            {totalRent > 0 && <> · potential rent <b className="text-foreground">{currency} {fmt(totalRent)}</b>/month</>}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="button" className="bg-emerald-700 hover:bg-emerald-800 text-white" disabled={!canCreate} onClick={() => { setServerError(null); create.mutate(); }} data-testid="create-property">
              {create.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : `Create property${rows.length ? ` with ${rows.length} unit${rows.length === 1 ? "" : "s"}` : ""}`}
            </Button>
          </div>
        </div>
        {infoMissing && rows.length > 0 && <p className="-mt-2 text-right text-xs text-muted-foreground">Add the property name and address to continue.</p>}
      </DialogContent>
    </Dialog>
  );
}
