/**
 * client/src/components/utility-bill-sender.tsx
 *
 * Utility Bill Sender — emerald theme, matches other pages.
 * Allows landlords/managers to:
 *   1. Enter meter readings and send bill to an individual tenant via email
 *   2. Fill readings for multiple tenants and send in bulk via email
 */

import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import {
  Droplets, Zap, Flame, Wifi, Wrench, Send, Users, User,
  Calculator, CheckCircle2, XCircle, Loader2, Mail,
  Building2, Hash, Info, AlertCircle,
} from "lucide-react";
import { format, addDays } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantWithAccount {
  tenantId: number;
  firstName: string;
  lastName: string;
  email: string;
  currency: string;
  unitId: number | null;
  unitNumber: string | null;
  propertyName: string | null;
  meterNumber: string | null;
  providerType: string | null;
}

interface ReadingRow {
  tenantId: number;
  previousReading: string;
  currentReading: string;
}

interface BulkSendResult {
  tenantId: number;
  email: string;
  tenantName: string;
  success: boolean;
  error?: string;
  messageId?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UTILITY_TYPES = [
  { value: "water",       label: "Water",          icon: Droplets, unit: "m³"    },
  { value: "electricity", label: "Electricity",    icon: Zap,      unit: "kWh"   },
  { value: "gas",         label: "Gas",            icon: Flame,    unit: "m³"    },
  { value: "internet",    label: "Internet / WiFi",icon: Wifi,     unit: "units" },
  { value: "other",       label: "Other",          icon: Wrench,   unit: "units" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTotal(prev: string, curr: string, rate: string): number | null {
  const p = parseFloat(prev), c = parseFloat(curr), r = parseFloat(rate);
  if (isNaN(p) || isNaN(c) || isNaN(r) || c < p) return null;
  return (c - p) * r;
}

function fmtMoney(amount: number, currency = "KES"): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function firstOfMonth(): string {
  const d = new Date(); d.setDate(1); return format(d, "yyyy-MM-dd");
}
function lastOfMonth(): string {
  const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(0); return format(d, "yyyy-MM-dd");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UtilityBillSender() {
  const { toast } = useToast();

  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Common fields
  const [utilityType,        setUtilityType]        = useState("water");
  const [unitCost,           setUnitCost]           = useState("");
  const [billingPeriodStart, setBillingPeriodStart] = useState(firstOfMonth());
  const [billingPeriodEnd,   setBillingPeriodEnd]   = useState(lastOfMonth());
  const [dueDate,            setDueDate]            = useState(format(addDays(new Date(), 14), "yyyy-MM-dd"));
  const [currency,           setCurrency]           = useState("KES");
  const [notes,              setNotes]              = useState("");

  // Single mode
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [previousReading,  setPreviousReading]  = useState("");
  const [currentReading,   setCurrentReading]   = useState("");
  const [singleResult, setSingleResult] = useState<{ billNumber: string; totalAmount: number; sentTo: string } | null>(null);

  // Bulk mode
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<number>>(new Set());
  const [readingRows,       setReadingRows]       = useState<Map<number, ReadingRow>>(new Map());
  const [bulkResults,       setBulkResults]       = useState<BulkSendResult[] | null>(null);

  // Fetch tenants
  const { data: rawTenants, isLoading: loadingTenants } = useQuery<TenantWithAccount[]>({
    queryKey: ["/api/utility-bills/tenants-with-accounts"],
  });
  const tenants: TenantWithAccount[] = ensureArray(rawTenants);

  // Groups the already-sorted tenants list into consecutive runs by
  // property name — doesn't re-sort, just clusters what the backend
  // already ordered (properties.name, units.unitNumber), so this stays
  // correct even if the sort order ever changes without this needing to.
  const tenantsByProperty = (() => {
    const groups: { propertyName: string; tenants: TenantWithAccount[] }[] = [];
    for (const t of tenants) {
      const name = t.propertyName ?? "Unassigned property";
      const last = groups[groups.length - 1];
      if (last && last.propertyName === name) last.tenants.push(t);
      else groups.push({ propertyName: name, tenants: [t] });
    }
    return groups;
  })();

  const selectedUtility = UTILITY_TYPES.find(u => u.value === utilityType) ?? UTILITY_TYPES[0];
  const UtilityIcon = selectedUtility.icon;

  const singlePreview = useMemo(() => {
    if (!previousReading || !currentReading || !unitCost) return null;
    const total = calcTotal(previousReading, currentReading, unitCost);
    if (total === null) return null;
    return { consumed: parseFloat(currentReading) - parseFloat(previousReading), total };
  }, [previousReading, currentReading, unitCost]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const sendSingle = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/utility-bills/send-email", {
        method: "POST",
        data: {
          tenantId: Number(selectedTenantId),
          utilityType,
          previousReading: Number(previousReading),
          currentReading: Number(currentReading),
          unitCost: Number(unitCost),
          billingPeriodStart,
          billingPeriodEnd,
          dueDate,
          currency,
          notes: notes || undefined,
        },
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setSingleResult({ billNumber: data.billNumber, totalAmount: data.totalAmount, sentTo: data.sentTo });
      toast({ title: "Bill emailed successfully!", description: `Sent to ${data.sentTo}` });
    },
    onError: (err: any) => toast({ title: "Failed to send", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });

  const sendBulk = useMutation({
    mutationFn: async () => {
      const readings = Array.from(selectedTenantIds).map(id => {
        const row = readingRows.get(id);
        return { tenantId: id, previousReading: Number(row?.previousReading ?? 0), currentReading: Number(row?.currentReading ?? 0) };
      });
      const res = await apiRequest("/api/utility-bills/send-bulk", {
        method: "POST",
        data: { utilityType, unitCost: Number(unitCost), billingPeriodStart, billingPeriodEnd, dueDate, currency, notes: notes || undefined, readings },
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setBulkResults(data.results);
      toast({
        title: "Bulk email complete",
        description: `${data.succeeded} sent, ${data.failed} failed`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (err: any) => toast({ title: "Bulk send failed", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });

  // ── Bulk helpers ──────────────────────────────────────────────────────────

  function toggleTenant(id: number) {
    setSelectedTenantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!readingRows.has(id))
      setReadingRows(prev => new Map(prev).set(id, { tenantId: id, previousReading: "", currentReading: "" }));
  }

  function toggleAll() {
    if (selectedTenantIds.size === tenants.length) {
      setSelectedTenantIds(new Set());
    } else {
      setSelectedTenantIds(new Set(tenants.map(t => t.tenantId)));
      tenants.forEach(t => {
        if (!readingRows.has(t.tenantId))
          setReadingRows(prev => new Map(prev).set(t.tenantId, { tenantId: t.tenantId, previousReading: "", currentReading: "" }));
      });
    }
  }

  function updateRow(id: number, field: "previousReading" | "currentReading", value: string) {
    setReadingRows(prev => {
      const next = new Map(prev);
      const row = next.get(id) ?? { tenantId: id, previousReading: "", currentReading: "" };
      next.set(id, { ...row, [field]: value });
      return next;
    });
  }

  const canSendSingle =
    selectedTenantId && previousReading !== "" && currentReading !== "" &&
    parseFloat(currentReading) >= parseFloat(previousReading) &&
    unitCost !== "" && billingPeriodStart && billingPeriodEnd && dueDate;

  const canSendBulk =
    selectedTenantIds.size > 0 && unitCost !== "" && billingPeriodStart && billingPeriodEnd && dueDate &&
    Array.from(selectedTenantIds).every(id => {
      const row = readingRows.get(id);
      return row && row.previousReading !== "" && row.currentReading !== "" &&
        parseFloat(row.currentReading) >= parseFloat(row.previousReading);
    });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
          <UtilityIcon className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Utility Bill Sender</h2>
          <p className="text-sm text-muted-foreground">Enter meter readings — bills are sent directly to tenant email addresses</p>
        </div>
      </div>

      {/* ── Email delivery notice ── */}
      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 flex items-start gap-3">
        <Mail className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-800 dark:text-emerald-300">
          <strong>Bills are delivered by email.</strong> Each bill is automatically emailed to the tenant's registered address as a formatted PDF-style statement showing their meter readings, units consumed, amount due, and payment deadline. No manual attachment is needed.
        </div>
      </div>

      {/* ── Mode toggle ── */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1 border border-border">
        <button
          onClick={() => { setMode("single"); setSingleResult(null); }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            mode === "single"
              ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <User className="h-4 w-4" /> Individual Tenant
        </button>
        <button
          onClick={() => { setMode("bulk"); setBulkResults(null); }}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            mode === "bulk"
              ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" /> Bulk Send
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">

        {/* ── Left: Bill Settings ── */}
        <div className="lg:col-span-1 space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bill Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="space-y-1.5">
                <Label>Utility Type</Label>
                <Select value={utilityType} onValueChange={setUtilityType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UTILITY_TYPES.map(u => {
                      const Icon = u.icon;
                      return (
                        <SelectItem key={u.value} value={u.value}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-emerald-600" />
                            {u.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Unit Cost ({currency} per {selectedUtility.unit})</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="e.g. 80"
                  value={unitCost} onChange={e => setUnitCost(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["KES","USD","GBP","EUR","UGX","TZS","ETB","ZAR","NGN"].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Billing Period Start</Label>
                <Input type="date" value={billingPeriodStart} onChange={e => setBillingPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Billing Period End</Label>
                <Input type="date" value={billingPeriodEnd} onChange={e => setBillingPeriodEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Notes for tenant (optional)</Label>
                <Textarea
                  placeholder="Any additional notes that will appear on the bill email…"
                  rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Tenant & Readings ── */}
        <div className="lg:col-span-2 space-y-5">

          {mode === "single" ? (
            <>
              {/* ── Tenant selector ── */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Select Tenant</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Tenant</Label>
                    <Select value={selectedTenantId} onValueChange={v => { setSelectedTenantId(v); setSingleResult(null); }}>
                      <SelectTrigger>
                        <SelectValue placeholder={loadingTenants ? "Loading tenants…" : "Choose a tenant…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {tenantsByProperty.map(group => (
                          <SelectGroup key={group.propertyName}>
                            <SelectLabel>{group.propertyName}</SelectLabel>
                            {group.tenants.map(t => (
                              <SelectItem key={t.tenantId} value={String(t.tenantId)}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{t.firstName} {t.lastName}</span>
                                  <span className="text-xs text-muted-foreground">Unit {t.unitNumber} · {t.email}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedTenantId && (() => {
                    const t = tenants.find(x => String(x.tenantId) === selectedTenantId);
                    if (!t) return null;
                    return (
                      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span><strong>{t.propertyName}</strong> — Unit {t.unitNumber}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span>Bill will be emailed to <strong>{t.email}</strong></span>
                        </div>
                        {t.meterNumber && (
                          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-500">
                            <Hash className="h-3.5 w-3.5 shrink-0" />
                            <span>Meter: {t.meterNumber}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* ── Meter readings ── */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <UtilityIcon className="h-4 w-4 text-emerald-600" />
                    Meter Readings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Previous Reading ({selectedUtility.unit})</Label>
                      <Input type="number" min="0" step="0.01" placeholder="e.g. 1250"
                        value={previousReading} onChange={e => setPreviousReading(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Current Reading ({selectedUtility.unit})</Label>
                      <Input type="number" min="0" step="0.01" placeholder="e.g. 1318"
                        value={currentReading} onChange={e => setCurrentReading(e.target.value)}
                        className={currentReading && previousReading && parseFloat(currentReading) < parseFloat(previousReading) ? "border-destructive" : ""} />
                      {currentReading && previousReading && parseFloat(currentReading) < parseFloat(previousReading) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Current reading must be ≥ previous
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Live preview */}
                  {singlePreview && (
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        <Calculator className="h-4 w-4" /> Bill Preview
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Units Consumed</p>
                          <p className="font-semibold">{singlePreview.consumed.toFixed(2)} {selectedUtility.unit}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Rate</p>
                          <p className="font-semibold">{fmtMoney(parseFloat(unitCost), currency)}/{selectedUtility.unit}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Total Due</p>
                          <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(singlePreview.total, currency)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={!canSendSingle || sendSingle.isPending}
                    onClick={() => sendSingle.mutate()}
                  >
                    {sendSingle.isPending
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending email…</>
                      : <><Mail className="h-4 w-4 mr-2" /> Email Bill to Tenant</>
                    }
                  </Button>

                  {!selectedTenantId && (
                    <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                      <Info className="w-3 h-3" /> Select a tenant above — the bill will be sent to their registered email
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Single result */}
              {singleResult && (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-4">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">Bill emailed successfully!</p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
                      Bill <span className="font-mono text-xs">{singleResult.billNumber}</span> for{" "}
                      <strong>{fmtMoney(singleResult.totalAmount, currency)}</strong> was sent to{" "}
                      <strong>{singleResult.sentTo}</strong>
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── Bulk mode ── */
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Select Tenants & Enter Readings
                      </CardTitle>
                      <CardDescription className="text-xs mt-1 flex items-center gap-1">
                        <Mail className="w-3 h-3" /> Bills will be emailed to each selected tenant
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50">
                      {selectedTenantIds.size === tenants.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {loadingTenants ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading tenants…
                    </div>
                  ) : tenants.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No active tenants with assigned units found.</p>
                  ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                      {tenants.map((t, i) => {
                        const isSelected = selectedTenantIds.has(t.tenantId);
                        const row = readingRows.get(t.tenantId);
                        const rowTotal = isSelected && row ? calcTotal(row.previousReading, row.currentReading, unitCost) : null;
                        // Tenants are already sorted by property, then unit
                        // (see the backend query) — this just adds a visible
                        // header at the point the property actually changes,
                        // rather than re-sorting or re-grouping anything.
                        const showPropertyHeader = i === 0 || tenants[i - 1].propertyName !== t.propertyName;

                        return (
                          <Fragment key={t.tenantId}>
                            {showPropertyHeader && (
                              <div className="flex items-center gap-2 pt-2 pb-1 first:pt-0">
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {t.propertyName ?? "Unassigned property"}
                                </span>
                              </div>
                            )}
                          <div
                            className={`rounded-xl border p-4 transition-all ${
                              isSelected
                                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800"
                                : "border-border bg-card hover:border-emerald-200"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleTenant(t.tenantId)}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-semibold text-foreground">{t.firstName} {t.lastName}</p>
                                    <p className="text-xs text-muted-foreground">{t.propertyName} · Unit {t.unitNumber}</p>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <Mail className="w-3 h-3" /> {t.email}
                                    </p>
                                  </div>
                                  {rowTotal !== null && (
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 shrink-0 ml-2">
                                      {fmtMoney(rowTotal, currency)}
                                    </Badge>
                                  )}
                                </div>

                                {isSelected && (
                                  <div className="mt-3 grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Previous ({selectedUtility.unit})</Label>
                                      <Input
                                        type="number" size={1} min="0" step="0.01" placeholder="prev"
                                        className="h-8 text-sm"
                                        value={row?.previousReading ?? ""}
                                        onChange={e => updateRow(t.tenantId, "previousReading", e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Current ({selectedUtility.unit})</Label>
                                      <Input
                                        type="number" size={1} min="0" step="0.01" placeholder="curr"
                                        className={`h-8 text-sm ${row?.currentReading && row?.previousReading && parseFloat(row.currentReading) < parseFloat(row.previousReading) ? "border-destructive" : ""}`}
                                        value={row?.currentReading ?? ""}
                                        onChange={e => updateRow(t.tenantId, "currentReading", e.target.value)}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Bulk summary */}
              {selectedTenantIds.size > 0 && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400 text-sm">
                    <Calculator className="h-4 w-4" />
                    {selectedTenantIds.size} tenant{selectedTenantIds.size !== 1 ? "s" : ""} selected
                  </div>
                  {unitCost && (
                    <div className="text-sm text-emerald-800 dark:text-emerald-300">
                      Total to bill:{" "}
                      <strong>
                        {fmtMoney(
                          Array.from(selectedTenantIds).reduce((sum, id) => {
                            const row = readingRows.get(id);
                            return sum + (calcTotal(row?.previousReading ?? "", row?.currentReading ?? "", unitCost) ?? 0);
                          }, 0),
                          currency
                        )}
                      </strong>
                    </div>
                  )}
                  <div className="text-xs text-emerald-600 dark:text-emerald-500 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Each tenant will receive a bill by email at their registered address
                  </div>
                </div>
              )}

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!canSendBulk || sendBulk.isPending}
                onClick={() => sendBulk.mutate()}
              >
                {sendBulk.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Emailing {selectedTenantIds.size} tenant{selectedTenantIds.size !== 1 ? "s" : ""}…</>
                  : <><Mail className="h-4 w-4 mr-2" /> Email Bills to {selectedTenantIds.size || "Selected"} Tenant{selectedTenantIds.size !== 1 ? "s" : ""}</>
                }
              </Button>

              {/* Bulk results */}
              {bulkResults && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Email Results
                    </CardTitle>
                    <CardDescription>
                      {bulkResults.filter(r => r.success).length} of {bulkResults.length} emails sent successfully
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-72 overflow-y-auto">
                    {bulkResults.map(r => (
                      <div
                        key={r.tenantId}
                        className={`flex items-center gap-3 rounded-lg p-3 text-sm ${
                          r.success
                            ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                            : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                        }`}
                      >
                        {r.success
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          : <XCircle     className="h-4 w-4 text-destructive shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground">{r.tenantName}</p>
                          <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                            <Mail className="w-3 h-3 shrink-0" /> {r.email}
                          </p>
                          {r.error && <p className="text-xs text-destructive mt-0.5">{r.error}</p>}
                        </div>
                        {r.success && (
                          <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0">
                            Sent
                          </Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}