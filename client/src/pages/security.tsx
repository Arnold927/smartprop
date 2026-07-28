import GatePinManager from "@/components/gate-pin-manager";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";

import {
  Shield,
  QrCode,
  Users,
  Car,
  Camera,
  Eye,
  CheckCircle,
  Activity,
  BarChart3,
  Scan,
  UserCheck,
  Clock,
  LogOut,
  AlertCircle,
  VideoOff,
  CameraOff,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  AlertTriangle,
  Calendar,
  Timer,
  TrendingUp,
  Plus,
  Cpu,
  Webhook,
  Copy,
  ExternalLink,
  Info,
  ArrowDown,
  ArrowUp,
  Download,
  Filter,
} from "lucide-react";

// ── Hardware Integration Panel ────────────────────────────────────────────────
// Optional — properties without hardware work exactly as before.
// Config is stored in properties.siteSettings.hardwareIntegration.

function HardwareIntegrationPanel({ properties: props }: { properties: any[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [form, setForm] = useState({ enabled: false, vendor: "generic", deviceLabel: "", webhookSecret: "", notes: "" });
  const [showSecret, setShowSecret] = useState(false);
  const [testLoading, setTestLoading] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["/api/security/hardware-config", selectedPropId],
    queryFn: async () => {
      const res = await apiRequest(`/api/security/hardware-config/${selectedPropId}`);
      return res.json();
    },
    enabled: !!selectedPropId,
  });

  // Populate form when config loads or property changes
  useEffect(() => {
    if (config?.config) {
      setForm({
        enabled:       config.config.enabled ?? false,
        vendor:        config.config.vendor ?? "generic",
        deviceLabel:   config.config.deviceLabel ?? "",
        webhookSecret: "",   // never pre-fill secret
        notes:         config.config.notes ?? "",
      });
    } else if (!configLoading && selectedPropId) {
      // No config yet — reset to defaults so the form is fresh
      setForm({ enabled: false, vendor: "generic", deviceLabel: "", webhookSecret: "", notes: "" });
    }
  }, [config, configLoading, selectedPropId]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/security/hardware-config/${selectedPropId}`, {
        method: "PUT",
        data: form,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/security/hardware-config", selectedPropId] });
      toast({ title: "Hardware config saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testEvent = async () => {
    if (!selectedPropId) return;
    setTestLoading(true);
    try {
      const res = await apiRequest("/api/security/hardware-event/test", {
        method: "POST",
        data: { propertyId: selectedPropId, plateNumber: "KDA 001T", direction: "in" },
      });
      const data = await res.json();
      toast({ title: "Test event fired", description: data.message });
      qc.invalidateQueries({ queryKey: ["/api/guard/admin/vehicle-log"] });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setTestLoading(false);
    }
  };

  const webhookUrl = selectedPropId && config?.webhookUrl
    ? `${window.location.origin}${config.webhookUrl}`
    : null;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" >
        <CardContent className="py-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <p><strong>Optional integration</strong> — properties without CCTV or intercoms work exactly as before. This panel is only needed if you want Hikvision cameras or ZKTeco intercoms to auto-log entry/exit events.</p>
            <p className="text-xs">Supported: Hikvision ISAPI/Hik-Connect webhooks · ZKTeco BioSecurity/ZKBio Access · Generic normalised JSON</p>
          </div>
        </CardContent>
      </Card>

      {/* Property selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-600" /> Hardware Integration
          </CardTitle>
          <CardDescription>Configure CCTV / intercom webhook per property. Each property gets its own webhook URL and optional HMAC secret.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Property</Label>
            <Select value={selectedPropId ? String(selectedPropId) : ""} onValueChange={v => { setSelectedPropId(parseInt(v)); setForm({ enabled: false, vendor: "generic", deviceLabel: "", webhookSecret: "", notes: "" }); }}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select a property to configure…" />
              </SelectTrigger>
              <SelectContent>
                {props.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPropId && !configLoading && (
            <div className="space-y-4 pt-2 border-t">
              {/* Enable toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <p className="text-sm font-medium">Enable hardware integration</p>
                  <p className="text-xs text-muted-foreground">When disabled, webhook calls from this property are rejected</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.enabled ? "bg-blue-600" : "bg-muted-foreground/30"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.enabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>

              {form.enabled && (
                <>
                  {/* Vendor */}
                  <div>
                    <Label>Hardware Vendor</Label>
                    <Select value={form.vendor} onValueChange={v => setForm(f => ({ ...f, vendor: v }))}>
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hikvision">Hikvision (ISAPI / Hik-Connect)</SelectItem>
                        <SelectItem value="zkteco">ZKTeco (BioSecurity / ZKBio Access)</SelectItem>
                        <SelectItem value="generic">Generic / Custom (pre-normalised JSON)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Device label */}
                  <div>
                    <Label>Device Label</Label>
                    <Input className="mt-1.5" placeholder="e.g. Main Gate Camera" value={form.deviceLabel} onChange={e => setForm(f => ({ ...f, deviceLabel: e.target.value }))} />
                  </div>

                  {/* Secret */}
                  <div>
                    <Label>Webhook Secret (HMAC-SHA256)</Label>
                    <div className="flex gap-2 mt-1.5">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder={config?.config?.webhookSecret ? "Secret already set — enter new value to change" : "Optional — leave blank to skip signature verification"}
                        value={form.webhookSecret}
                        onChange={e => setForm(f => ({ ...f, webhookSecret: e.target.value }))}
                        className="font-mono text-sm flex-1"
                      />
                      <Button variant="outline" size="sm" type="button" onClick={() => setShowSecret(s => !s)}>
                        {showSecret ? "Hide" : "Show"}
                      </Button>
                      <Button variant="outline" size="sm" type="button" onClick={() => {
                        const s = crypto.randomUUID().replace(/-/g, "");
                        setForm(f => ({ ...f, webhookSecret: s }));
                        setShowSecret(true);
                      }}>
                        Generate
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Configure the same value in your camera/intercom as the webhook signing secret. Signature header: <code className="bg-muted px-1 rounded">X-Webhook-Signature: sha256=&lt;hex&gt;</code></p>
                  </div>

                  {/* Notes */}
                  <div>
                    <Label>Notes (internal)</Label>
                    <Input className="mt-1.5" placeholder="e.g. Hikvision DS-2CD2147G2 · installed Jan 2025" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>

                  {/* Webhook URL */}
                  {webhookUrl && (
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1.5"><Webhook className="h-3.5 w-3.5" /> Webhook URL for this property</p>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted rounded px-2 py-1 flex-1 overflow-x-auto whitespace-nowrap">{webhookUrl}</code>
                        <Button variant="outline" size="sm" type="button" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied" }); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Configure this URL in your Hikvision/ZKTeco device's webhook/HTTP notification settings. The device will POST events here on each entry/exit.</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="gap-1.5">
                      {saveMut.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                      Save Configuration
                    </Button>
                    <Button variant="outline" disabled={testLoading} onClick={testEvent} className="gap-1.5">
                      {testLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Car className="h-3.5 w-3.5" />}
                      Send Test Event
                    </Button>
                  </div>
                </>
              )}

              {!form.enabled && config?.config && (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Shield className="h-4 w-4" /> Integration disabled — enable the toggle above to configure.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vendor setup guides */}
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-sm font-semibold text-slate-900">Setup Guides</h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="p-3 rounded-lg border space-y-1">
            <p className="font-medium text-foreground">Hikvision (ISAPI)</p>
            <p className="text-xs text-muted-foreground">Device Management → Network → Advanced → HTTP Listening → enable, set URL to the webhook above, set Method to POST, Content-Type to application/json. For ANPR cameras, enable ANPR events under Smart Event.</p>
          </div>
          <div className="p-3 rounded-lg border space-y-1">
            <p className="font-medium text-foreground">ZKTeco (ZKBio Access)</p>
            <p className="text-xs text-muted-foreground">System → Third-party Integration → HTTP Push → Add, enter webhook URL. Set push interval to 0 (real-time). For access events select Transaction Records. Save and test with the Test Event button above.</p>
          </div>
          <div className="p-3 rounded-lg border space-y-1">
            <p className="font-medium text-foreground">Generic Payload Schema</p>
            <p className="text-xs text-muted-foreground mb-1">For custom integrations, POST a JSON body with these fields:</p>
            <code className="text-[11px] bg-muted rounded p-2 block leading-relaxed">
              {"{"}<br/>
              {"  \"eventType\": \"vehicle_entry\" | \"vehicle_exit\" | \"intercom_open\","}<br/>
              {"  \"plateNumber\": \"KDA 123A\","}<br/>
              {"  \"vehicleType\": \"car\","}<br/>
              {"  \"deviceLabel\": \"Main Gate\","}<br/>
              {"  \"timestamp\": \"2024-01-15T09:30:00Z\""}<br/>
              {"}"}
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape returned by /api/visitor-access-management */
interface Visitor {
  id: number;
  visitor_code: string;
  qr_code_data: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_id_number: string | null;
  visit_purpose: string | null;
  expected_arrival: string;
  expected_departure: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  status: "pending" | "approved" | "checked_in" | "checked_out" | "denied" | "expired";
  first_name: string | null;
  last_name: string | null;
  unit_number: string | null;
  property_name: string | null;
  security_notes: string | null;
  created_at: string;
}

/** Shape returned by /api/registered-vehicles */
interface RegisteredVehicle {
  id: number;
  propertyId: number;
  plateNumber: string;
  vehicleType: string;
  make: string;
  model: string;
  year: number | null;
  color: string;
  ownerType: string;
  ownerName: string | null;
  ownerId: string | null;
  status: "active" | "inactive" | "pending_approval" | "blacklisted";
  isResident: boolean;
  notes: string | null;
  createdAt: string;
}

// ── Types (continued) ─────────────────────────────────────────────────────────

interface GatePass {
  id: number;
  passType: "visitor" | "contractor" | "delivery" | "service" | "emergency" | "vip";
  fullName: string;
  company: string | null;
  validFrom: string;
  validTo: string;
  purpose: string;
  status: "active" | "expired" | "pending" | "approved";
  requestedBy: string | null;
  approvedBy: string | null;
  propertyId: number | null;
  unitId: number | null;
  notes: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "checked_in":
    case "active":
    case "approved":
      return "default";
    case "checked_out":
    case "inactive":
    case "expired":
      return "secondary";
    case "denied":
    case "blacklisted":
      return "destructive";
    default:
      return "outline";
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeDate(dateStr: string | null | undefined, fmt: string): string {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "N/A";
  return format(d, fmt);
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Admin Vehicle Log ─────────────────────────────────────────────────────────
// Uses the admin endpoint — accessible with a standard manager/admin JWT.
// No guard PIN session required.

interface VehicleMovement {
  id: number;
  propertyId: number;
  plateNumber: string;
  vehicleType: string | null;
  direction: "in" | "out";
  purpose: string | null;
  unitNumber: string | null;
  driverName: string | null;
  notes: string | null;
  loggedAt: string;
  loggedBy: string | null;
}

function AdminVehicleLog({ properties: props }: { properties: any[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>(today);
  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");

  const { data: rawRows = [], isLoading, refetch } = useQuery<VehicleMovement[]>({
    queryKey: ["/api/guard/admin/vehicle-log", selectedPropertyId, dateFilter],
    queryFn: async () => {
      if (!selectedPropertyId) return [];
      const r = await apiRequest(
        `/api/guard/admin/vehicle-log?propertyId=${selectedPropertyId}&date=${dateFilter}`
      );
      return ensureArray(await r.json());
    },
    enabled: !!selectedPropertyId,
    refetchInterval: 30000,
  });

  const rows = rawRows.filter((r) => {
    if (dirFilter !== "all" && r.direction !== dirFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.plateNumber?.toLowerCase().includes(q) ||
        r.driverName?.toLowerCase().includes(q) ||
        r.purpose?.toLowerCase().includes(q) ||
        r.loggedBy?.toLowerCase().includes(q) ||
        r.unitNumber?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const ins  = rows.filter((r) => r.direction === "in").length;
  const outs = rows.filter((r) => r.direction === "out").length;

  function purposeLabel(p: string | null) {
    if (!p) return null;
    const map: Record<string, string> = {
      hardware_event: "Hardware",
      test_event:     "Test",
      delivery:       "Delivery",
      visit:          "Visit",
      contractor:     "Contractor",
    };
    return map[p] ?? p;
  }

  function purposeBadgeClass(p: string | null) {
    if (p === "hardware_event") return "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
    if (p === "test_event")     return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    return "bg-muted text-muted-foreground";
  }

  function fmtTime(d: string) {
    try { return new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  }
  function fmtDateShort(d: string) {
    try { return new Date(d).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }); }
    catch { return "—"; }
  }

  const isToday = dateFilter === today;

  return (
    <div className="space-y-4">

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Property</label>
          <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a property…" />
            </SelectTrigger>
            <SelectContent>
              {props.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <div className="flex items-center gap-1">
            <Input
              type="date" value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-9 w-[155px]"
            />
            {!isToday && (
              <Button variant="ghost" size="sm" className="h-9 px-2 text-xs"
                onClick={() => setDateFilter(today)}>Today</Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Direction</label>
          <div className="flex rounded-lg border border-border overflow-hidden h-9">
            {(["all", "in", "out"] as const).map((d, i) => (
              <button key={d} onClick={() => setDirFilter(d)}
                className={`px-3 text-xs font-medium transition-colors ${
                  dirFilter === d ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground hover:bg-muted"
                } ${i > 0 ? "border-l border-border" : ""}`}>
                {d === "in" ? "↓ Entry" : d === "out" ? "↑ Exit" : "All"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Plate, driver, purpose…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8" />
          </div>
        </div>

        <Button variant="outline" size="sm" className="h-9 gap-1.5 self-end" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* ── No property selected ── */}
      {!selectedPropertyId && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Car className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Select a property to view its vehicle log</p>
          <p className="text-xs text-muted-foreground/60 mt-1">All gate entries and exits for the selected date appear here.</p>
        </div>
      )}

      {/* ── Stats ── */}
      {selectedPropertyId && !isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total movements", value: rows.length,  icon: Activity,   color: "text-foreground"   },
            { label: "Entries",         value: ins,           icon: ArrowDown,  color: "text-emerald-600"  },
            { label: "Exits",           value: outs,          icon: ArrowUp,    color: "text-orange-500"   },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-border bg-card px-5 py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div>
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {selectedPropertyId && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <Car className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No vehicle movements recorded for this date.</p>
              {!isToday && (
                <button onClick={() => setDateFilter(today)} className="text-xs text-emerald-600 hover:underline mt-1">
                  Switch to today
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Time", "Direction", "Plate", "Type", "Purpose", "Unit", "Driver", "Logged by", "Notes"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs font-medium">{fmtTime(row.loggedAt)}</div>
                        {!isToday && <div className="text-[10px] text-muted-foreground">{fmtDateShort(row.loggedAt)}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          row.direction === "in"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"
                        }`}>
                          {row.direction === "in"
                            ? <><ArrowDown className="w-3 h-3" />IN</>
                            : <><ArrowUp className="w-3 h-3" />OUT</>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold tracking-wide">{row.plateNumber}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{row.vehicleType ?? "—"}</td>
                      <td className="px-4 py-3">
                        {row.purpose
                          ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${purposeBadgeClass(row.purpose)}`}>{purposeLabel(row.purpose)}</span>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.unitNumber ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.driverName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.loggedBy ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate" title={row.notes ?? ""}>{row.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{rows.length} movement{rows.length !== 1 ? "s" : ""} · {ins} entries · {outs} exits</p>
              <p className="text-xs text-muted-foreground">Auto-refreshes every 30 s</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SecurityPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF_LANDLORD);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();
  const isLandlord = user?.role === "landlord";

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const initialTab = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      const valid = ["dashboard", "qr-scanner", "visitor-management", "gate-pass", "vehicle-registration", "gate-pins", "vehicle-log", "hardware"];
      // A self-managing landlord only has Gate PINs scoped/verified for
      // their own properties on the backend — the other tabs' endpoints
      // haven't been extended for landlord use, so default (and restrict)
      // them there rather than risk a half-broken experience on tabs that
      // would silently fail.
      if (isLandlord) return "gate-pins";
      return t && valid.includes(t) ? t : "dashboard";
    } catch { return isLandlord ? "gate-pins" : "dashboard"; }
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  // QR Scanner state
  const [qrScanMode, setQrScanMode] = useState<"camera" | "manual">("manual");
  const [manualQrCode, setManualQrCode] = useState("");
  const [qrAction, setQrAction] = useState<"check-in" | "check-out">("check-in");

  // Camera scanner state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const jsQRRef = useRef<any>(null);
  const [cameraStatus, setCameraStatus] = useState<"idle" | "requesting" | "active" | "error">("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [lastScannedCode, setLastScannedCode] = useState<string>("");
  const [scanResult, setScanResult] = useState<{ code: string; status: "success" | "error"; message: string } | null>(null);
  const lastScannedRef = useRef<string>("");
  const lastScannedTimeRef = useRef<number>(0);

  // Visitor Management search + pagination + date filter
  const [visitorSearch, setVisitorSearch] = useState("");
  const [visitorStatusFilter, setVisitorStatusFilter] = useState("all");
  const [visitorDateFrom, setVisitorDateFrom] = useState("");
  const [visitorDateTo, setVisitorDateTo] = useState("");
  const [visitorPage, setVisitorPage] = useState(1);
  const [visitorPageSize, setVisitorPageSize] = useState(10);

  // Vehicle Registration search + pagination + date filter
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState("all");
  const [vehicleDateFrom, setVehicleDateFrom] = useState("");
  const [vehicleDateTo, setVehicleDateTo] = useState("");
  const [vehiclePage, setVehiclePage] = useState(1);
  const [vehiclePageSize, setVehiclePageSize] = useState(10);

  // Gate pass state
  const [isGatePassOpen, setIsGatePassOpen] = useState(false);
  const [gatePassForm, setGatePassForm] = useState({
    passType: "visitor" as GatePass["passType"],
    fullName: "",
    company: "",
    validFrom: "",
    validTo: "",
    purpose: "",
    propertyId: "",
    unitId: "",
    notes: "",
  });

  // Gate pass search + pagination + date filter
  const [gatePassSearch, setGatePassSearch] = useState("");
  const [gatePassStatusFilter, setGatePassStatusFilter] = useState("all");
  const [gatePassDateFrom, setGatePassDateFrom] = useState("");
  const [gatePassDateTo, setGatePassDateTo] = useState("");
  const [gatePassPage, setGatePassPage] = useState(1);
  const [gatePassPageSize, setGatePassPageSize] = useState(10);

  // Gate pass: fetch units for selected property
  const { data: gatePassUnitsRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/properties", gatePassForm.propertyId, "units", "gatepass"],
    queryFn: async () => {
      if (!gatePassForm.propertyId) return [];
      const r = await apiRequest(`/api/properties/${gatePassForm.propertyId}/units`);
      const json = await r.json();
      return ensureArray(json.units ?? json);
    },
    enabled: !!gatePassForm.propertyId,
  });
  const gatePassUnits = ensureArray(gatePassUnitsRaw);

  // Vehicle registration state
  const [isVehicleOpen, setIsVehicleOpen] = useState(false);
  const [blacklistConfirmId, setBlacklistConfirmId] = useState<number | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    plateNumber: "",
    vehicleType: "car",
    make: "",
    model: "",
    year: "",
    color: "",
    ownerType: "visitor",
    ownerName: "",
    tenantId: "",
    propertyId: "",
    notes: "",
  });

  // ── Camera scanner logic ───────────────────────────────────────────────────

  /** Stop camera stream and cancel animation frame */
  const stopCamera = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStatus("idle");
  }, []);

  /** Load jsQR from CDN into jsQRRef if BarcodeDetector is unavailable */
  const loadJsQR = useCallback((): Promise<boolean> => {
    if (jsQRRef.current) return Promise.resolve(true);
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      script.onload = () => {
        jsQRRef.current = (window as any).jsQR;
        resolve(!!jsQRRef.current);
      };
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }, []);

  /** Decode one frame — tries BarcodeDetector first, then jsQR */
  const decodeFrame = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);

    // Try native BarcodeDetector (Chrome 83+, Edge 83+)
    if ("BarcodeDetector" in window) {
      try {
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        const codes = await detector.detect(canvas);
        if (codes.length > 0) return codes[0].rawValue;
      } catch {
        // fall through to jsQR
      }
    }

    // Fallback: jsQR
    if (jsQRRef.current) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQRRef.current(imageData.data, imageData.width, imageData.height);
      if (result) return result.data;
    }

    return null;
  }, []);

  /** Main scan loop — runs each animation frame */
  const scanLoop = useCallback(async () => {
    const code = await decodeFrame();
    if (code) {
      const now = Date.now();
      // Debounce: don't re-trigger same code within 3 seconds
      if (code !== lastScannedRef.current || now - lastScannedTimeRef.current > 3000) {
        lastScannedRef.current = code;
        lastScannedTimeRef.current = now;
        setLastScannedCode(code);
        // Auto-trigger the scan mutation
        qrScanMutationRef.current?.({ code, action: qrActionRef.current });
      }
    }
    animFrameRef.current = requestAnimationFrame(() => {
      scanLoop();
    });
  }, [decodeFrame]);

  /** Start camera and begin scanning */
  const startCamera = useCallback(async () => {
    setCameraStatus("requesting");
    setCameraError("");
    setScanResult(null);

    // Load jsQR as fallback in parallel
    if (!("BarcodeDetector" in window)) {
      loadJsQR();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      // Store stream first, then set status to "active" so the <video> mounts.
      // A useEffect below watches cameraStatus === "active" and attaches the stream
      // once videoRef.current is guaranteed to exist in the DOM.
      streamRef.current = stream;
      setCameraStatus("active");
    } catch (err: any) {
      const msg =
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser settings."
          : err.name === "NotFoundError"
          ? "No camera found on this device."
          : err.name === "NotReadableError"
          ? "Camera is already in use by another application."
          : `Camera error: ${err.message}`;
      setCameraError(msg);
      setCameraStatus("error");
    }
  }, [loadJsQR]);

  // Refs to latest mutation + action so scanLoop closure stays fresh
  const qrScanMutationRef = useRef<((args: { code: string; action: "check-in" | "check-out" }) => void) | null>(null);
  const qrActionRef = useRef<"check-in" | "check-out">("check-in");

  // Sync qrAction into ref so the scan loop always uses the current value
  useEffect(() => {
    qrActionRef.current = qrAction;
  }, [qrAction]);

  // Stop camera when switching away from camera mode or away from qr-scanner tab
  useEffect(() => {
    if (qrScanMode !== "camera" || activeTab !== "qr-scanner") {
      stopCamera();
    }
  }, [qrScanMode, activeTab, stopCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Attach the camera stream to the <video> element once it is mounted in the DOM.
  // This runs whenever cameraStatus becomes "active", at which point videoRef.current
  // is guaranteed to exist because the video element only renders in that state.
  useEffect(() => {
    if (cameraStatus !== "active") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play().catch(() => {}); // autoplay may need a user gesture; playsInline handles most cases
      scanLoop();
    };
    // If metadata already loaded (fast devices), play immediately
    if (video.readyState >= 1) {
      video.play().catch(() => {});
      scanLoop();
    }
  }, [cameraStatus, scanLoop]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: visitorsRaw = [], isLoading: visitorsLoading } = useQuery<Visitor[]>({
    queryKey: ["/api/visitor-access-management"],
    queryFn: async () => {
      const r = await apiRequest("/api/visitor-access-management");
      return ensureArray(await r.json());
    },
    // Auto-refresh every 30s so guard portal actions (check-in/out) surface
    // without the manager needing to manually reload the page.
    refetchInterval: 30_000,
  });
  const visitors = ensureArray(visitorsRaw) as Visitor[];

  const { data: vehiclesRaw = [], isLoading: vehiclesLoading } = useQuery<RegisteredVehicle[]>({
    queryKey: ["/api/registered-vehicles"],
    queryFn: async () => {
      const r = await apiRequest("/api/registered-vehicles");
      return ensureArray(await r.json());
    },
    refetchInterval: 30_000,
  });
  const vehicles = ensureArray(vehiclesRaw) as RegisteredVehicle[];

  const { data: propertiesRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
  });
  const properties = ensureArray(propertiesRaw);

  // Fetch units for the selected property when owner type is "tenant"
  const { data: propertyUnitsRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/properties", vehicleForm.propertyId, "units"],
    queryFn: async () => {
      if (!vehicleForm.propertyId) return [];
      const r = await apiRequest(`/api/properties/${vehicleForm.propertyId}/units`);
      const json = await r.json();
      return ensureArray(json.units ?? json);
    },
    enabled: !!vehicleForm.propertyId && vehicleForm.ownerType === "tenant",
  });
  const propertyUnits = ensureArray(propertyUnitsRaw);

  // Fetch tenants and filter to those in the selected property's units
  const { data: allTenantsRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants", "all"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenants?limit=100");
      const json = await r.json();
      return ensureArray(json.results ?? json);
    },
    enabled: true,
  });
  const allTenants = ensureArray(allTenantsRaw);

  // Filter tenants whose unitId is in the units belonging to the selected property
  const propertyUnitIds = new Set(propertyUnits.map((u: any) => u.id));
  const tenantsForProperty = vehicleForm.propertyId
    ? allTenants.filter((t: any) => t.unitId && propertyUnitIds.has(t.unitId) && t.status === "active")
    : [];

  const { data: gatePassesRaw = [], isLoading: gatePassesLoading } = useQuery<GatePass[]>({
    queryKey: ["/api/security/gate-passes"],
    queryFn: async () => {
      const r = await apiRequest("/api/security/gate-passes");
      return ensureArray(await r.json());
    },
  });
  const gatePasses = ensureArray(gatePassesRaw) as GatePass[];

  // Fetch units for every property referenced by gate passes so the table can resolve unit names
  const gatePassPropertyIds = [...new Set(gatePasses.map((gp) => gp.propertyId).filter(Boolean))] as number[];
  const { data: allGatePassUnitsRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/units/all-for-gate-passes", gatePassPropertyIds.join(",")],
    queryFn: async () => {
      if (gatePassPropertyIds.length === 0) return [];
      const results = await Promise.all(
        gatePassPropertyIds.map(async (pid) => {
          const r = await apiRequest(`/api/properties/${pid}/units`);
          const json = await r.json();
          return ensureArray(json.units ?? json);
        })
      );
      return results.flat();
    },
    enabled: gatePassPropertyIds.length > 0,
  });
  const allGatePassUnits = ensureArray(allGatePassUnitsRaw);

  // ── Derived stats (memoized so they don't recompute on every unrelated render) ─

  const checkedInVisitors = useMemo(
    () => visitors.filter((v) => v.status === "checked_in"),
    [visitors]
  );
  const currentlyOnSite = checkedInVisitors.length;

  const todaysCheckIns = useMemo(
    () => {
      const today = new Date().toDateString();
      return visitors.filter((v) => v.actual_arrival && new Date(v.actual_arrival).toDateString() === today).length;
    },
    [visitors]
  );

  const pendingVisitors = useMemo(
    () => visitors.filter((v) => v.status === "pending"),
    [visitors]
  );
  const pendingApprovals = pendingVisitors.length;

  const upcomingArrivals = useMemo(
    () => {
      const now = new Date();
      return visitors
        .filter((v) => v.status === "approved" && new Date(v.expected_arrival) >= now)
        .sort((a, b) => new Date(a.expected_arrival).getTime() - new Date(b.expected_arrival).getTime());
    },
    [visitors]
  );

  const blacklistedVehicles = useMemo(
    () => vehicles.filter((v) => v.status === "blacklisted"),
    [vehicles]
  );
  const securityAlerts = blacklistedVehicles.length;

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => v.status === "active" || v.status === "pending_approval").length,
    [vehicles]
  );

  // Compute averageVisitDuration (hours) from checked-out visitors
  const avgVisitDurationHours = useMemo(() => {
    const done = visitors.filter((v) => v.actual_arrival && v.actual_departure);
    if (done.length === 0) return 0;
    return Math.round(
      done.reduce((sum, v) => {
        const diff = new Date(v.actual_departure!).getTime() - new Date(v.actual_arrival!).getTime();
        return sum + diff / (1000 * 60 * 60);
      }, 0) / done.length
    );
  }, [visitors]);

  const activeGatePasses = useMemo(
    () => gatePasses.filter((gp) => gp.status === "active" || gp.status === "approved").length,
    [gatePasses]
  );

  const securityMetrics = {
    passesProcessedToday: gatePasses.filter((gp) => {
      const d = new Date(gp.createdAt);
      return d.toDateString() === new Date().toDateString();
    }).length,
    currentlyOnSite,
    averageVisitDuration: avgVisitDurationHours,
    securityAlerts,
    todayCheckIns: todaysCheckIns,
    pendingApprovals,
    totalVisitors: visitors.length,
    averageApprovalTime: 0, // would require server-side computation
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const qrScanMutation = useMutation({
    mutationFn: async ({ code, action }: { code: string; action: "check-in" | "check-out" }) => {
      const r = await apiRequest(
        `/api/visitor-access-management/${encodeURIComponent(code)}/${action}`,
        { method: "PATCH", data: { location: "Main Gate" } }
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Scan failed");
      }
      return r.json();
    },
    onSuccess: (data, vars) => {
      const label = vars.action === "check-in" ? "Checked In" : "Checked Out";
      const visitorName = data?.visitor_name ?? vars.code;
      toast({
        title: label,
        description: `${visitorName} ${vars.action === "check-in" ? "checked in" : "checked out"} successfully.`,
      });
      setScanResult({ code: vars.code, status: "success", message: `${label}: ${visitorName}` });
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      setManualQrCode("");
      // Reset scan debounce so same code can be re-scanned after success
      lastScannedRef.current = "";
    },
    onError: (err: any, vars) => {
      const msg = err.message || "Invalid QR code or visitor not found.";
      toast({
        title: "Scan Failed",
        description: msg,
        variant: "destructive",
      });
      setScanResult({ code: vars.code, status: "error", message: msg });
      // Reset debounce on error so they can retry
      lastScannedRef.current = "";
    },
  });

  // Wire mutation into ref so the camera scanLoop can call it
  useEffect(() => {
    qrScanMutationRef.current = qrScanMutation.mutate;
  }, [qrScanMutation.mutate]);

  const approveMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest(
        `/api/visitor-access-management/${encodeURIComponent(code)}/approve`,
        { method: "PATCH" }
      );
      if (!r.ok) throw new Error("Approval failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Visitor Approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
    },
    onError: (err: any) => {
      toast({ title: "Approval Failed", description: err.message, variant: "destructive" });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest(
        `/api/visitor-access-management/${encodeURIComponent(code)}/check-out`,
        { method: "PATCH", data: { location: "Main Gate" } }
      );
      if (!r.ok) throw new Error("Check-out failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Visitor Checked Out" });
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
    },
    onError: (err: any) => {
      toast({ title: "Check-out Failed", description: err.message, variant: "destructive" });
    },
  });

  const registerVehicleMutation = useMutation({
    mutationFn: async (data: typeof vehicleForm) => {
      const r = await apiRequest("/api/registered-vehicles", {
        method: "POST",
        data: {
          plateNumber: data.plateNumber,
          vehicleType: data.vehicleType,
          make: data.make,
          model: data.model,
          year: data.year ? parseInt(data.year) : undefined,
          color: data.color,
          ownerType: data.ownerType,
          ownerId: data.tenantId || data.ownerName || undefined,
          propertyId: parseInt(data.propertyId),
          notes: data.notes || undefined,
          isResident: data.ownerType === "tenant",
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Registration failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Vehicle Registered", description: "Vehicle is pending approval." });
      queryClient.invalidateQueries({ queryKey: ["/api/registered-vehicles"] });
      setVehicleForm({
        plateNumber: "", vehicleType: "car", make: "", model: "",
        year: "", color: "", ownerType: "visitor", ownerName: "", tenantId: "", propertyId: "", notes: "",
      });
      setIsVehicleOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Registration Failed", description: err.message, variant: "destructive" });
    },
  });

  const updateVehicleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest(`/api/registered-vehicles/${id}/status`, {
        method: "PATCH",
        data: { status },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update vehicle status");
      }
      return r.json();
    },
    onSuccess: (_, vars) => {
      const label = vars.status === "active" ? "approved" : vars.status === "blacklisted" ? "rejected" : vars.status;
      toast({ title: "Vehicle Updated", description: `Vehicle has been ${label}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/registered-vehicles"] });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const createGatePassMutation = useMutation({
    mutationFn: async (data: typeof gatePassForm) => {
      const r = await apiRequest("/api/security/gate-passes", {
        method: "POST",
        data: {
          passType: data.passType,
          fullName: data.fullName,
          company: data.company || undefined,
          validFrom: data.validFrom || new Date().toISOString(),
          validTo: data.validTo,
          purpose: data.purpose,
          propertyId: data.propertyId ? parseInt(data.propertyId) : undefined,
          unitId: data.unitId ? parseInt(data.unitId) : undefined,
          notes: data.notes || undefined,
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to create gate pass");
      }
      return r.json();
    },
    onSuccess: (created: any) => {
      toast({
        title: "Gate Pass Created",
        description: `Pass for ${created.fullName ?? gatePassForm.fullName} is valid until ${gatePassForm.validTo}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/security/gate-passes"] });
      setGatePassForm({ passType: "visitor", fullName: "", company: "", validFrom: "", validTo: "", purpose: "", propertyId: "", unitId: "", notes: "" });
      setIsGatePassOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Gate Pass Failed", description: err.message, variant: "destructive" });
    },
  });

  const updateGatePassStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest(`/api/security/gate-passes/${id}/status`, {
        method: "PATCH",
        data: { status },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update gate pass");
      }
      return r.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: "Gate Pass Updated", description: `Pass has been ${vars.status}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/security/gate-passes"] });
    },
    onError: (err: any) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleQrScan = () => {
    const code = manualQrCode.trim();
    if (!code) return;
    qrScanMutation.mutate({ code, action: qrAction });
  };

  const vehicleFormValid =
    !!vehicleForm.plateNumber &&
    !!vehicleForm.make &&
    !!vehicleForm.model &&
    !!vehicleForm.color &&
    !!vehicleForm.propertyId;

  const gatePassFormValid =
    !!gatePassForm.fullName &&
    !!gatePassForm.purpose &&
    !!gatePassForm.validTo;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">

      {/* ── Emerald page header ─────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 md:px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-800/40 border border-emerald-500/30 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Security Operations</h1>
                <p className="text-sm text-emerald-100/80">Visitor management · Access control · Vehicle registry</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-emerald-800/40 border border-emerald-500/30 rounded-full px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-100">
                {currentlyOnSite} on-site{pendingApprovals > 0 ? ` · ${pendingApprovals} pending` : " · All clear"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            {[
              { label: "On Site Now",      value: currentlyOnSite,  icon: Users,         warn: false },
              { label: "Pending Approval", value: pendingApprovals, icon: AlertCircle,   warn: pendingApprovals > 0 },
              { label: "Check-ins Today",  value: todaysCheckIns,   icon: UserCheck,     warn: false },
              { label: "Security Alerts",  value: securityAlerts,   icon: AlertTriangle, warn: securityAlerts > 0 },
            ].map(({ label, value, icon: Icon, warn }) => (
              <div key={label} className={`rounded-xl px-4 py-3 border ${warn ? "bg-red-950/40 border-red-500/30" : "bg-emerald-800/30 border-emerald-500/20"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${warn ? "text-red-300" : "text-emerald-300"}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/70">{label}</span>
                </div>
                <p className={`text-2xl font-bold ${warn ? "text-red-300" : "text-white"}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto pb-px mb-6">
            <TabsList className="inline-flex h-10 items-center bg-muted rounded-xl p-1 gap-0.5 min-w-max">
              {(isLandlord
                ? [{ value: "gate-pins", label: "Gate PINs", icon: Shield }]
                : [
                { value: "dashboard",            label: "Overview",    icon: BarChart3  },
                { value: "qr-scanner",           label: "QR Scanner",  icon: QrCode     },
                { value: "visitor-management",   label: "Visitors",    icon: Users      },
                { value: "gate-pass",            label: "Gate Passes", icon: FileText   },
                { value: "vehicle-registration", label: "Vehicles",    icon: Car        },
                { value: "gate-pins",            label: "Gate PINs",   icon: Shield     },
                { value: "vehicle-log",          label: "Vehicle Log", icon: Activity   },
                { value: "hardware",             label: "Hardware",    icon: Cpu        },
              ]).map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {value === "visitor-management" && pendingApprovals > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold">{pendingApprovals}</span>
                  )}
                  {value === "vehicle-registration" && vehicles.filter((v: any) => v.status === "pending_approval").length > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold">{vehicles.filter((v: any) => v.status === "pending_approval").length}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* OVERVIEW */}
          <TabsContent value="dashboard" className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center"><Activity className="w-3.5 h-3.5 text-emerald-600" /></div>
                    <h3 className="text-sm font-semibold">Live Visitor Feed</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">{checkedInVisitors.length} on-site</span>
                </div>
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {visitorsLoading ? (
                    <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" /></div>
                  ) : checkedInVisitors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Users className="w-10 h-10 text-muted-foreground/30 mb-2" />
                      <p className="text-sm text-muted-foreground">No visitors currently on-site</p>
                    </div>
                  ) : checkedInVisitors.map((visitor: any) => (
                    <div key={visitor.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-emerald-700">{visitor.visitor_name?.[0]?.toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{visitor.visitor_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{visitor.visit_purpose}{visitor.unit_number ? ` · Unit ${visitor.unit_number}` : ""}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          visitor.status === "checked_in" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          visitor.status === "approved"   ? "bg-blue-50 text-blue-700 border-blue-200" :
                          "bg-gray-100 text-gray-600 border-gray-200"}`}>{statusLabel(visitor.status)}</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{safeDate(visitor.actual_arrival ?? visitor.expected_arrival, "HH:mm")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    <h3 className="text-sm font-semibold">Upcoming Arrivals</h3>
                    <span className="ml-auto text-xs text-muted-foreground">{upcomingArrivals.length}</span>
                  </div>
                  <div className="divide-y divide-border max-h-48 overflow-y-auto">
                    {upcomingArrivals.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">None scheduled</p>
                    ) : upcomingArrivals.map((v: any) => (
                      <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{v.visitor_name}</p>
                          {v.unit_number && <p className="text-xs text-muted-foreground">Unit {v.unit_number}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground">{safeDate(v.expected_arrival, "HH:mm")}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`rounded-xl border overflow-hidden ${securityAlerts > 0 ? "border-red-200 bg-red-50/50 dark:bg-red-950/10 dark:border-red-900" : "border-border bg-card"}`}>
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-inherit">
                    <AlertTriangle className={`w-3.5 h-3.5 ${securityAlerts > 0 ? "text-red-500" : "text-muted-foreground"}`} />
                    <h3 className="text-sm font-semibold">Security Alerts</h3>
                    {securityAlerts > 0 && <span className="ml-auto text-xs font-bold text-red-600">{securityAlerts}</span>}
                  </div>
                  <div className="divide-y divide-border/50 max-h-40 overflow-y-auto">
                    {securityAlerts === 0 ? (
                      <div className="flex items-center gap-2 px-4 py-4"><CheckCircle className="w-4 h-4 text-emerald-500" /><p className="text-sm text-muted-foreground">No active alerts</p></div>
                    ) : blacklistedVehicles.map((v: any) => (
                      <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Car className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <div><p className="text-sm font-mono font-semibold">{v.plateNumber}</p><p className="text-xs text-muted-foreground">{v.make} {v.model}</p></div>
                        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">Blacklisted</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center"><BarChart3 className="w-3.5 h-3.5 text-emerald-600" /></div>
                  <h3 className="text-sm font-semibold">Security Summary</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { label: "Total Visitors",          value: visitors.length,                                                 dot: "bg-emerald-500" },
                    { label: "Currently On-Site",        value: currentlyOnSite,                                                dot: "bg-blue-500"    },
                    { label: "Active Gate Passes",       value: activeGatePasses,                                               dot: "bg-purple-500"  },
                    { label: "Registered Vehicles",      value: vehicles.length,                                                dot: "bg-amber-500"   },
                    { label: "Vehicles Pending Approval",value: vehicles.filter((v: any) => v.status === "pending_approval").length, dot: "bg-orange-400" },
                  ].map(({ label, value, dot }) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-bold">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center"><AlertCircle className="w-3.5 h-3.5 text-amber-600" /></div>
                    <h3 className="text-sm font-semibold">Pending Approvals</h3>
                  </div>
                  {pendingApprovals > 0 && <span className="text-xs font-semibold text-amber-600">{pendingApprovals} waiting</span>}
                </div>
                <div className="divide-y divide-border max-h-60 overflow-y-auto">
                  {pendingApprovals === 0 ? (
                    <div className="flex items-center gap-2 px-5 py-8 justify-center">
                      <CheckCircle className="w-4 h-4 text-emerald-500" /><p className="text-sm text-muted-foreground">No pending approvals</p>
                    </div>
                  ) : pendingVisitors.map((visitor: any) => (
                    <div key={visitor.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{visitor.visitor_name}</p>
                        <p className="text-xs text-muted-foreground">{visitor.visit_purpose} · {safeDate(visitor.expected_arrival, "MMM d, HH:mm")}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{visitor.visitor_code}</p>
                      </div>
                      <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0"
                        onClick={() => approveMutation.mutate(visitor.visitor_code)} disabled={approveMutation.isPending}>
                        <CheckCircle className="w-3 h-3 mr-1" />Approve
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* QR SCANNER */}
          <TabsContent value="qr-scanner">
            <div className="max-w-xl mx-auto">
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4 flex items-center gap-3">
                  <QrCode className="w-5 h-5 text-white" />
                  <div><h3 className="text-base font-semibold text-white">QR Code Scanner</h3><p className="text-xs text-emerald-100/80">Scan visitor codes for check-in or check-out</p></div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="flex flex-wrap gap-2">
                    {[{ mode: "camera" as const, icon: Camera, label: "Camera" }, { mode: "manual" as const, icon: Scan, label: "Manual" }].map(({ mode, icon: Icon, label }) => (
                      <Button key={mode} size="sm" variant={qrScanMode === mode ? "default" : "outline"}
                        className={qrScanMode === mode ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                        onClick={() => { if (mode === "manual") stopCamera(); setScanResult(null); setQrScanMode(mode); }}>
                        <Icon className="w-3.5 h-3.5 mr-1.5" />{label}
                      </Button>
                    ))}
                    <Select value={qrAction} onValueChange={(v) => { setQrAction(v as "check-in" | "check-out"); setScanResult(null); lastScannedRef.current = ""; }}>
                      <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="check-in">Check In</SelectItem><SelectItem value="check-out">Check Out</SelectItem></SelectContent>
                    </Select>
                  </div>

                  {qrScanMode === "camera" && (
                    <div className="space-y-3">
                      {cameraStatus === "idle" && (
                        <div className="border-2 border-dashed border-emerald-200 rounded-xl p-10 text-center space-y-3 bg-emerald-50/40">
                          <Camera className="w-12 h-12 text-emerald-400 mx-auto" />
                          <p className="font-medium">Ready to scan</p>
                          <p className="text-sm text-muted-foreground">Point camera at a QR code — it scans automatically.</p>
                          <Button onClick={startCamera} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Camera className="w-4 h-4 mr-2" />Start Camera</Button>
                        </div>
                      )}
                      {cameraStatus === "requesting" && (
                        <div className="border-2 border-dashed border-border rounded-xl p-10 text-center space-y-3">
                          <div className="animate-spin w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto" />
                          <p className="font-medium">Requesting camera access…</p>
                        </div>
                      )}
                      {cameraStatus === "error" && (
                        <div className="border-2 border-dashed border-red-300 bg-red-50 rounded-xl p-8 text-center space-y-3">
                          <CameraOff className="w-10 h-10 text-red-500 mx-auto" />
                          <p className="text-red-600 font-medium">Camera unavailable</p>
                          <p className="text-sm text-muted-foreground">{cameraError}</p>
                          <div className="flex gap-2 justify-center">
                            <Button size="sm" variant="outline" onClick={startCamera}><RefreshCw className="w-3 h-3 mr-1" />Retry</Button>
                            <Button size="sm" onClick={() => setQrScanMode("manual")}>Manual Entry</Button>
                          </div>
                        </div>
                      )}
                      {cameraStatus === "active" && (
                        <div className="space-y-3">
                          <div className="relative rounded-xl overflow-hidden bg-black">
                            <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-72 object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="relative w-44 h-44">
                                {(["top-0 left-0 border-t-4 border-l-4 rounded-tl-sm","top-0 right-0 border-t-4 border-r-4 rounded-tr-sm","bottom-0 left-0 border-b-4 border-l-4 rounded-bl-sm","bottom-0 right-0 border-b-4 border-r-4 rounded-br-sm"] as const).map((cls, i) => (
                                  <div key={i} className={`absolute w-7 h-7 border-emerald-400 ${cls}`} />
                                ))}
                              </div>
                            </div>
                            <canvas ref={canvasRef} className="hidden" />
                          </div>
                          <Button size="sm" variant="outline" className="w-full" onClick={stopCamera}><VideoOff className="w-3.5 h-3.5 mr-1.5" />Stop Camera</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {qrScanMode === "manual" && (
                    <div className="flex gap-2">
                      <Input placeholder="Enter access code or QR code…" value={manualQrCode}
                        onChange={e => setManualQrCode(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleQrScan()} className="flex-1" />
                      <Button onClick={handleQrScan} disabled={!manualQrCode.trim() || qrScanMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        {qrScanMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />}
                      </Button>
                    </div>
                  )}

                  {scanResult && (
                    <div className={`flex items-start gap-3 p-4 rounded-xl border ${scanResult.status === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                      {scanResult.status === "success" ? <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
                      <div><p className="font-semibold text-sm">{scanResult.status === "success" ? "Success" : "Failed"}</p><p className="text-sm mt-0.5">{scanResult.message}</p></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* VISITORS */}
          <TabsContent value="visitor-management" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input placeholder="Search visitors…" value={visitorSearch} onChange={e => { setVisitorSearch(e.target.value); setVisitorPage(1); }} className="pl-9 h-9" />
              </div>
              <Select value={visitorStatusFilter} onValueChange={v => { setVisitorStatusFilter(v); setVisitorPage(1); }}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["all","pending","approved","checked_in","checked_out","denied"].map(s => <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All statuses" : s.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={visitorDateFrom} onChange={e => setVisitorDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
              <Input type="date" value={visitorDateTo} onChange={e => setVisitorDateTo(e.target.value)} className="w-36 h-9 text-sm" />
              <Select value={visitorPageSize.toString()} onValueChange={v => { setVisitorPageSize(Number(v)); setVisitorPage(1); }}>
                <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="10">10/page</SelectItem><SelectItem value="25">25/page</SelectItem><SelectItem value="50">50/page</SelectItem></SelectContent>
              </Select>
            </div>
            {(() => {
              const q = visitorSearch.toLowerCase();
              const filtered = visitors.filter((v: any) => {
                const mq = !q || v.visitor_name?.toLowerCase().includes(q) || v.visitor_code?.toLowerCase().includes(q) || v.visit_purpose?.toLowerCase().includes(q);
                const ms = visitorStatusFilter === "all" || v.status === visitorStatusFilter;
                const md = !visitorDateFrom || new Date(v.expected_arrival) >= new Date(visitorDateFrom);
                const me = !visitorDateTo   || new Date(v.expected_arrival) <= new Date(visitorDateTo + "T23:59:59");
                return mq && ms && md && me;
              });
              const totalPages = Math.max(1, Math.ceil(filtered.length / visitorPageSize));
              const page = Math.min(visitorPage, totalPages);
              const paginated = filtered.slice((page-1)*visitorPageSize, page*visitorPageSize);
              return (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  {visitorsLoading ? (
                    <div className="flex justify-center p-12"><div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" /></div>
                  ) : paginated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="font-semibold">No visitors found</p>
                    </div>
                  ) : <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-muted/60 border-b border-border">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Visitor</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Purpose</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Expected</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                          <th className="px-4 py-3 w-28" />
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {paginated.map((visitor: any) => (
                            <tr key={visitor.id} className="hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-bold text-emerald-700">{visitor.visitor_name?.[0]?.toUpperCase()}</span>
                                  </div>
                                  <div>
                                    <p className="font-semibold">{visitor.visitor_name}</p>
                                    <p className="text-xs text-muted-foreground font-mono">{visitor.visitor_code}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell">
                                <p className="text-sm">{visitor.visit_purpose}</p>
                                {visitor.unit_number && <p className="text-xs text-muted-foreground">Unit {visitor.unit_number}</p>}
                              </td>
                              <td className="px-4 py-3 hidden lg:table-cell text-sm text-muted-foreground">{safeDate(visitor.expected_arrival, "MMM d, HH:mm")}</td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  visitor.status === "checked_in"  ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                  visitor.status === "approved"    ? "bg-blue-50 text-blue-700 border-blue-200" :
                                  visitor.status === "pending"     ? "bg-amber-50 text-amber-700 border-amber-200" :
                                  visitor.status === "checked_out" ? "bg-gray-100 text-gray-600 border-gray-200" :
                                  "bg-red-50 text-red-700 border-red-200"
                                }`}>{statusLabel(visitor.status)}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  {visitor.status === "pending" && (
                                    <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                      onClick={() => approveMutation.mutate(visitor.visitor_code)} disabled={approveMutation.isPending}>Approve</Button>
                                  )}
                                  {visitor.status === "checked_in" && (
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                      onClick={() => checkOutMutation.mutate(visitor.visitor_code)} disabled={checkOutMutation.isPending}>Check Out</Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">{filtered.length} results · Page {page} of {totalPages}</span>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===1} onClick={() => setVisitorPage(p => p-1)}>Previous</Button>
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===totalPages} onClick={() => setVisitorPage(p => p+1)}>Next</Button>
                        </div>
                      </div>
                    )}
                  </>}
                </div>
              );
            })()}
          </TabsContent>

          {/* GATE PASSES */}
          <TabsContent value="gate-pass" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input placeholder="Search gate passes…" value={gatePassSearch} onChange={e => { setGatePassSearch(e.target.value); setGatePassPage(1); }} className="pl-9 h-9" />
              </div>
              <Select value={gatePassStatusFilter} onValueChange={v => { setGatePassStatusFilter(v); setGatePassPage(1); }}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{["all","active","approved","expired","revoked"].map(s => <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={gatePassPageSize.toString()} onValueChange={v => { setGatePassPageSize(Number(v)); setGatePassPage(1); }}>
                <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="10">10/page</SelectItem><SelectItem value="25">25/page</SelectItem></SelectContent>
              </Select>
              <Button size="sm" className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white h-9" onClick={() => setIsGatePassOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />New Pass
              </Button>
            </div>
            {(() => {
              const q = gatePassSearch.toLowerCase();
              const filtered = gatePasses.filter((gp: any) => {
                const mq = !q || gp.fullName?.toLowerCase().includes(q) || gp.company?.toLowerCase().includes(q);
                const ms = gatePassStatusFilter === "all" || gp.status === gatePassStatusFilter;
                return mq && ms;
              });
              const totalPages = Math.max(1, Math.ceil(filtered.length / gatePassPageSize));
              const page = Math.min(gatePassPage, totalPages);
              const paginated = filtered.slice((page-1)*gatePassPageSize, page*gatePassPageSize);
              return (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  {paginated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <FileText className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="font-semibold">No gate passes</p>
                      <p className="text-sm text-muted-foreground mt-1 mb-4">Create passes for contractors, vendors, or visitors.</p>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsGatePassOpen(true)}><Plus className="w-3.5 h-3.5 mr-1.5" />New Gate Pass</Button>
                    </div>
                  ) : <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-muted/60 border-b border-border">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Person</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Type / Purpose</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Valid Until</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                          <th className="px-4 py-3 w-20" />
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {paginated.map((gp: any) => (
                            <tr key={gp.id} className="hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3"><p className="font-semibold">{gp.fullName}</p>{gp.company && <p className="text-xs text-muted-foreground">{gp.company}</p>}</td>
                              <td className="px-4 py-3 hidden md:table-cell"><p className="capitalize">{gp.passType}</p><p className="text-xs text-muted-foreground">{gp.purpose}</p></td>
                              <td className="px-4 py-3 hidden lg:table-cell text-sm text-muted-foreground">{safeDate(gp.validTo, "MMM d, yyyy")}</td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  gp.status === "active" || gp.status === "approved" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                  gp.status === "expired" ? "bg-gray-100 text-gray-600 border-gray-200" :
                                  "bg-red-50 text-red-700 border-red-200"
                                }`}>{gp.status}</span>
                              </td>
                              <td className="px-4 py-3">
                                {(gp.status === "active" || gp.status === "approved") && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                    onClick={() => updateGatePassStatusMutation.mutate({ id: gp.id, status: "revoked" })} disabled={updateGatePassStatusMutation.isPending}>Revoke</Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===1} onClick={() => setGatePassPage(p => p-1)}>Previous</Button>
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===totalPages} onClick={() => setGatePassPage(p => p+1)}>Next</Button>
                        </div>
                      </div>
                    )}
                  </>}
                </div>
              );
            })()}
          </TabsContent>

          {/* VEHICLES */}
          <TabsContent value="vehicle-registration" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input placeholder="Plate, make, model…" value={vehicleSearch} onChange={e => { setVehicleSearch(e.target.value); setVehiclePage(1); }} className="pl-9 h-9" />
              </div>
              <Select value={vehicleStatusFilter} onValueChange={v => { setVehicleStatusFilter(v); setVehiclePage(1); }}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{["all","active","pending_approval","inactive","blacklisted"].map(s => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s.replace("_"," ")}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={vehiclePageSize.toString()} onValueChange={v => { setVehiclePageSize(Number(v)); setVehiclePage(1); }}>
                <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="10">10/page</SelectItem><SelectItem value="25">25/page</SelectItem></SelectContent>
              </Select>
              <Button size="sm" className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white h-9" onClick={() => setIsVehicleOpen(true)}>
                <Car className="w-3.5 h-3.5 mr-1.5" />Register Vehicle
              </Button>
            </div>
            {(() => {
              const q = vehicleSearch.toLowerCase();
              const filtered = vehicles.filter((v: any) => {
                const mq = !q || v.plateNumber?.toLowerCase().includes(q) || `${v.make} ${v.model}`.toLowerCase().includes(q);
                const ms = vehicleStatusFilter === "all" || v.status === vehicleStatusFilter;
                return mq && ms;
              });
              const totalPages = Math.max(1, Math.ceil(filtered.length / vehiclePageSize));
              const page = Math.min(vehiclePage, totalPages);
              const paginated = filtered.slice((page-1)*vehiclePageSize, page*vehiclePageSize);
              return (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  {paginated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Car className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="font-semibold">No vehicles found</p>
                    </div>
                  ) : <>
                    {filtered.some((v: any) => v.status === "pending_approval") && (
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <span className="text-sm text-amber-700 font-medium">{filtered.filter((v: any) => v.status === "pending_approval").length} vehicle(s) awaiting approval</span>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-muted/60 border-b border-border">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vehicle</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Owner</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                          <th className="px-4 py-3 w-36" />
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {paginated.map((v: any) => (
                            <tr key={v.id} className="hover:bg-muted/30 transition-colors group">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><Car className="w-4 h-4 text-muted-foreground" /></div>
                                  <div>
                                    <p className="font-mono font-semibold">{v.plateNumber}</p>
                                    <p className="text-xs text-muted-foreground">{[v.year, v.make, v.model, v.color].filter(Boolean).join(" · ")}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 hidden md:table-cell capitalize text-muted-foreground text-sm">{v.ownerType}</td>
                              <td className="px-4 py-3">
                                {v.status === "pending_approval" ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Pending</span>
                                    <Button size="sm" className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
                                      onClick={() => updateVehicleStatusMutation.mutate({ id: v.id, status: "active" })} disabled={updateVehicleStatusMutation.isPending}>Approve</Button>
                                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-red-200 text-red-700 hover:bg-red-50"
                                      onClick={() => updateVehicleStatusMutation.mutate({ id: v.id, status: "inactive" })} disabled={updateVehicleStatusMutation.isPending}>Reject</Button>
                                  </div>
                                ) : (
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                    v.status === "active"      ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                    v.status === "blacklisted" ? "bg-red-50 text-red-700 border-red-200" :
                                    "bg-gray-100 text-gray-600 border-gray-200"
                                  }`}>{v.status}</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {v.status === "active" && (
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                      onClick={() => setBlacklistConfirmId(v.id)}>Blacklist</Button>
                                  )}
                                  {v.status === "blacklisted" && (
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                                      onClick={() => updateVehicleStatusMutation.mutate({ id: v.id, status: "active" })} disabled={updateVehicleStatusMutation.isPending}>Reinstate</Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===1} onClick={() => setVehiclePage(p => p-1)}>Previous</Button>
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===totalPages} onClick={() => setVehiclePage(p => p+1)}>Next</Button>
                        </div>
                      </div>
                    )}
                  </>}
                </div>
              );
            })()}
          </TabsContent>

          {/* GATE PINS */}
          <TabsContent value="gate-pins"><GatePinManager /></TabsContent>

          {/* VEHICLE LOG */}
          <TabsContent value="vehicle-log"><AdminVehicleLog properties={properties} /></TabsContent>

          {/* HARDWARE */}
          <TabsContent value="hardware"><HardwareIntegrationPanel properties={properties} /></TabsContent>

        </Tabs>
      </div>

      {/* DIALOGS */}

      {/* Register vehicle */}
      <Dialog open={isVehicleOpen} onOpenChange={setIsVehicleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><Car className="w-4 h-4 text-emerald-600" /></div>
              Register Vehicle
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>Plate Number *</Label><Input value={vehicleForm.plateNumber} onChange={e => setVehicleForm(f => ({...f, plateNumber: e.target.value.toUpperCase()}))} placeholder="KCA 123A" className="font-mono" /></div>
              <div className="space-y-1.5"><Label>Make *</Label><Input value={vehicleForm.make} onChange={e => setVehicleForm(f => ({...f, make: e.target.value}))} placeholder="Toyota" /></div>
              <div className="space-y-1.5"><Label>Model *</Label><Input value={vehicleForm.model} onChange={e => setVehicleForm(f => ({...f, model: e.target.value}))} placeholder="Corolla" /></div>
              <div className="space-y-1.5"><Label>Year</Label><Input type="number" value={vehicleForm.year} onChange={e => setVehicleForm(f => ({...f, year: e.target.value}))} placeholder="2020" /></div>
              <div className="space-y-1.5"><Label>Colour *</Label><Input value={vehicleForm.color} onChange={e => setVehicleForm(f => ({...f, color: e.target.value}))} placeholder="White" /></div>
              <div className="space-y-1.5"><Label>Type</Label>
                <Select value={vehicleForm.vehicleType} onValueChange={v => setVehicleForm(f => ({...f, vehicleType: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["car","motorcycle","truck","van","bus","other"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Owner Type</Label>
                <Select value={vehicleForm.ownerType} onValueChange={v => setVehicleForm(f => ({...f, ownerType: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["tenant","visitor","staff","contractor","guest"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Property *</Label>
                <Select value={vehicleForm.propertyId} onValueChange={v => setVehicleForm(f => ({...f, propertyId: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setIsVehicleOpen(false)} className="flex-1">Cancel</Button>
              <Button disabled={!vehicleFormValid || registerVehicleMutation.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => registerVehicleMutation.mutate(vehicleForm)}>
                {registerVehicleMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Registering…</> : "Register Vehicle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create gate pass */}
      <Dialog open={isGatePassOpen} onOpenChange={setIsGatePassOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><FileText className="w-4 h-4 text-emerald-600" /></div>
              Create Gate Pass
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label>Full Name *</Label><Input value={gatePassForm.fullName} onChange={e => setGatePassForm(f => ({...f, fullName: e.target.value}))} placeholder="Visitor / contractor name" /></div>
              <div className="space-y-1.5"><Label>Company</Label><Input value={gatePassForm.company} onChange={e => setGatePassForm(f => ({...f, company: e.target.value}))} placeholder="Optional" /></div>
              <div className="space-y-1.5"><Label>Pass Type</Label>
                <Select value={gatePassForm.passType} onValueChange={v => setGatePassForm(f => ({...f, passType: v as any}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["visitor","contractor","delivery","maintenance","vendor"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2"><Label>Purpose *</Label><Input value={gatePassForm.purpose} onChange={e => setGatePassForm(f => ({...f, purpose: e.target.value}))} placeholder="Reason for access" /></div>
              <div className="space-y-1.5"><Label>Property</Label>
                <Select value={gatePassForm.propertyId || "__any__"} onValueChange={v => setGatePassForm(f => ({...f, propertyId: v === "__any__" ? "" : v, unitId: ""}))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="__any__">Any property</SelectItem>{properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Unit</Label>
                <Select value={gatePassForm.unitId || "__any__"} onValueChange={v => setGatePassForm(f => ({...f, unitId: v === "__any__" ? "" : v}))} disabled={!gatePassForm.propertyId}>
                  <SelectTrigger><SelectValue placeholder="Any unit" /></SelectTrigger>
                  <SelectContent><SelectItem value="__any__">Any unit</SelectItem>{gatePassUnits.map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>Unit {u.unitNumber}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Valid From</Label><Input type="date" value={gatePassForm.validFrom} onChange={e => setGatePassForm(f => ({...f, validFrom: e.target.value}))} /></div>
              <div className="space-y-1.5"><Label>Valid Until *</Label><Input type="date" value={gatePassForm.validTo} onChange={e => setGatePassForm(f => ({...f, validTo: e.target.value}))} /></div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setIsGatePassOpen(false)} className="flex-1">Cancel</Button>
              <Button disabled={!gatePassFormValid || createGatePassMutation.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => createGatePassMutation.mutate(gatePassForm)}>
                {createGatePassMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Creating…</> : "Create Gate Pass"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Blacklist confirm */}
      <Dialog open={blacklistConfirmId !== null} onOpenChange={open => { if (!open) setBlacklistConfirmId(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" />Blacklist Vehicle</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">This vehicle will be flagged, denied entry, and a security alert raised. Are you sure?</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setBlacklistConfirmId(null)} className="flex-1">Cancel</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (blacklistConfirmId !== null) { updateVehicleStatusMutation.mutate({ id: blacklistConfirmId, status: "blacklisted" }); setBlacklistConfirmId(null); } }}>
              Blacklist
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}