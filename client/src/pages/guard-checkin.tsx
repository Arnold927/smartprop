/**
 * Guard Check-In Screen
 * ---------------------
 * Supports four verification modes:
 *   1. Camera QR scan (via jsQR + getUserMedia)
 *   2. Manual code entry (VAC-XXXXXX)
 *   3. Parking space manual override when auto-allocation fails
 *   4. Hardware Integration tab — optional webhook-based physical access control
 *      (barriers, intercoms, ANPR cameras). Vendor-agnostic: any device that can
 *      POST to a webhook URL integrates without code changes. Properties without
 *      hardware continue on the software-only flow unchanged.
 *
 * Optimised for both mobile (guard's phone) and desktop (guard desk).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "@/components/LanguageToggle";
import {
  QrCode, Keyboard, Car, CheckCircle, XCircle, AlertTriangle,
  User, Clock, MapPin, Scan, RefreshCw, Shield, LogOut, Phone,
  Building, Hash, ChevronRight, Loader2, ParkingSquare,
  Wifi, WifiOff, Cpu, Link, Copy, Eye, EyeOff, Zap, Activity,
  Settings, ChevronDown, ChevronUp, Info, AlertCircle,
  FileText, Search, Ban, ShieldAlert, ShieldCheck, Calendar,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface CheckInResult {
  success: boolean;
  message: string;
  visitor?: {
    id: number;
    visitorName: string;
    visitorPhone: string | null;
    purposeOfVisit: string | null;
    expectedArrival: string;
    expectedDeparture: string | null;
    status: string;
    vehiclePlate: string | null;
    parkingSpot: string | null;
    tenantFirstName: string | null;
    tenantLastName: string | null;
    unitNumber: string | null;
    propertyName: string | null;
    propertyId: number;
    accessCode: string;
  };
  hasVehicle?: boolean;
  parking?: {
    allocated: boolean;
    requiresManual: boolean;
    spaceNumber?: string;
    floor?: string | null;
    section?: string | null;
    spaceId?: number;
    assignmentId?: number;
  };
}

interface ParkingSpace {
  id: number;
  spaceNumber: string;
  floor?: string | null;
  section?: string | null;
  spaceType: string;
  isAvailable: boolean;
  hasElectricCharging: boolean;
}

interface HardwareConfig {
  enabled: boolean;
  vendor: "hikvision" | "zkteco" | "generic";
  deviceLabel: string;
  webhookSecret: string | null;
  notes: string;
}

interface HardwareConfigResponse {
  configured: boolean;
  config: HardwareConfig | null;
  webhookUrl: string;
}

interface HardwareEvent {
  id: number;
  plateNumber: string | null;
  direction: "in" | "out";
  vehicleType: string;
  loggedAt: string;
  loggedBy: string;
  purpose: string;
  notes: string | null;
}

// Top-level tab — software vs hardware vs gate passes vs blacklist
type TopTab = "software" | "hardware" | "gate-passes" | "blacklist";
type Mode = "camera" | "manual" | "result" | "vehicle-capture" | "parking-manual";

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtTime(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-KE", {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function fmtShort(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

// ─── Hardware Integration Panel ────────────────────────────────────────────

interface HardwarePanelProps {
  propertyId: number | null;
}

function HardwarePanel({ propertyId: externalPropertyId }: HardwarePanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [testPlate, setTestPlate] = useState("KDA 001A");
  const [formState, setFormState] = useState<Partial<HardwareConfig & { newSecret: string }>>({});
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);

  // Detect if the current session is a guard token (read-only — guards cannot edit config)
  const isGuardSession = (() => {
    try {
      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      if (!token) return false;
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload?.role === "guard";
    } catch { return false; }
  })();

  // Use whichever propertyId is available — from a recent check-in or guard's own selection
  const propertyId = externalPropertyId ?? selectedPropertyId;

  // ── Fetch the guard's assigned property (server returns only their own property) ──
  const { data: propertyList = [], isLoading: propertiesLoading } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/gate-auth/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/gate-auth/properties");
      return r.json();
    },
    enabled: !externalPropertyId, // only needed when not already known from a check-in
    staleTime: 5 * 60 * 1000,
  });

  // Auto-select the guard's single assigned property as soon as it loads
  useEffect(() => {
    if (!externalPropertyId && propertyList.length === 1 && !selectedPropertyId) {
      setSelectedPropertyId(propertyList[0].id);
    }
  }, [propertyList, externalPropertyId, selectedPropertyId]);

  // ── Fetch hardware config ────────────────────────────────────────────────
  const { data: hwData, isLoading: hwLoading } = useQuery<HardwareConfigResponse>({
    queryKey: ["/api/security/hardware-config", propertyId],
    queryFn: async () => {
      if (!propertyId) throw new Error("No property");
      const r = await apiRequest(`/api/security/hardware-config/${propertyId}`);
      return r.json();
    },
    enabled: !!propertyId,
    refetchInterval: 15000,
  });

  // ── Fetch recent hardware-triggered vehicle movements ────────────────────
  const { data: recentEvents = [] } = useQuery<HardwareEvent[]>({
    queryKey: ["/api/guard/admin/vehicle-log", propertyId, "hardware"],
    queryFn: async () => {
      if (!propertyId) return [];
      const r = await apiRequest(`/api/guard/admin/vehicle-log?propertyId=${propertyId}`);
      const rows = await r.json();
      return ensureArray(rows).filter((e: any) =>
        e.purpose === "hardware_event" || e.purpose === "test_event" ||
        e.loggedBy?.toLowerCase().includes("hardware") ||
        e.loggedBy?.toLowerCase().includes("hikvision") || e.loggedBy?.toLowerCase().includes("zkteco")
      );
    },
    enabled: !!propertyId && !!hwData?.configured,
    refetchInterval: 10000,
  });

  // ── Save config mutation ─────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await apiRequest(`/api/security/hardware-config/${propertyId}`, {
        method: "PUT",
        data: payload,
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Hardware config saved", description: "Webhook integration updated." });
      qc.invalidateQueries({ queryKey: ["/api/security/hardware-config", propertyId] });
      setConfigOpen(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // ── Test event mutation ──────────────────────────────────────────────────
  const testMutation = useMutation({
    mutationFn: async (direction: "in" | "out") => {
      const r = await apiRequest("/api/security/hardware-event/test", {
        method: "POST",
        data: { propertyId, plateNumber: testPlate.toUpperCase(), direction },
      });
      return r.json();
    },
    onSuccess: (d) => {
      toast({ title: "Test event sent", description: d.message });
      qc.invalidateQueries({ queryKey: ["/api/guard/admin/vehicle-log", propertyId, "hardware"] });
    },
    onError: (e: any) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const copyWebhook = () => {
    if (!hwData?.webhookUrl) return;
    const full = `${window.location.origin}${hwData.webhookUrl}`;
    navigator.clipboard.writeText(full).then(() =>
      toast({ title: "Copied", description: "Webhook URL copied to clipboard." })
    );
  };

  // ── Property picker — shown when no propertyId is available yet ──────────
  if (!propertyId) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Hardware Integration</p>
            <p className="text-xs text-slate-400 mt-0.5">Your assigned property will load automatically</p>
          </div>
        </div>

        {propertiesLoading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your property…
          </div>
        ) : propertyList.length === 0 ? (
          <p className="text-xs text-slate-500">No property assigned. Contact your administrator.</p>
        ) : (
          <div className="space-y-2">
            <label className="text-xs text-slate-400 block">Your assigned property</label>
            <div className="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2.5 text-sm flex items-center justify-between">
              <span>{propertyList[0].name}</span>
              <span className="text-xs text-slate-500 ml-2">Auto-selected</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (hwLoading) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 flex items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        <span className="text-slate-400 text-sm">Loading hardware config…</span>
      </div>
    );
  }

  const hw = hwData?.config;
  const isEnabled = hw?.enabled ?? false;
  const webhookUrl = hwData?.webhookUrl
    ? `${window.location.origin}${hwData.webhookUrl}`
    : null;

  return (
    <div className="space-y-4">

      {/* ── Status card ─────────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-5 ${
        isEnabled
          ? "bg-emerald-950/30 border-emerald-800"
          : "bg-slate-900 border-slate-800"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isEnabled ? "bg-emerald-500/15" : "bg-slate-800"
            }`}>
              {isEnabled
                ? <Wifi className="w-5 h-5 text-emerald-400" />
                : <WifiOff className="w-5 h-5 text-slate-500" />
              }
            </div>
            <div>
              <div className="font-semibold text-sm flex items-center gap-2">
                Hardware Integration
                {isEnabled && (
                  <span className="text-xs font-normal bg-emerald-500/15 text-emerald-400 border border-emerald-700 rounded-full px-2 py-0.5">
                    Active
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {isEnabled
                  ? `${hw?.deviceLabel || hw?.vendor || "Device"} · Webhook receiver live`
                  : "Not configured · Software-only mode active"
                }
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              if (isGuardSession) {
                toast({ title: "Read-only", description: "Guards can view hardware status but cannot modify configuration. Contact your property manager.", variant: "destructive" });
                return;
              }
              setFormState({
                enabled: hw?.enabled ?? false,
                vendor: hw?.vendor ?? "generic",
                deviceLabel: hw?.deviceLabel ?? "",
                notes: hw?.notes ?? "",
                newSecret: "",
              });
              setConfigOpen(v => !v);
            }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Configure
            {configOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* How it works callout — always visible when not configured */}
        {!isEnabled && (
          <div className="mt-4 rounded-lg bg-slate-800/60 border border-slate-700 p-4 text-xs text-slate-400 space-y-1.5">
            <div className="flex items-center gap-2 text-slate-300 font-medium mb-1">
              <Info className="w-3.5 h-3.5 text-blue-400" /> How hardware integration works
            </div>
            <p>Any physical device (barrier, intercom, ANPR camera) that can POST JSON to a URL can integrate with SmartProp — no code required.</p>
            <p>The webhook endpoint is <strong>vendor-agnostic</strong>. Built-in adapters exist for Hikvision and ZKTeco; all other vendors use the generic adapter.</p>
            <p>Properties without hardware are unaffected — the software-only flow (QR scan & access codes) continues to work exactly as before.</p>
          </div>
        )}
      </div>

      {/* ── Config form (collapsible) ────────────────────────────────────── */}
      {configOpen && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-slate-400" /> Webhook Configuration
          </h3>

          {isGuardSession && (
            <div className="rounded-lg bg-amber-950/40 border border-amber-800 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Guards can view hardware configuration but cannot modify it. Contact your property manager to make changes.
            </div>
          )}

          {/* Enable toggle */}
          <div className="flex items-center justify-between py-2 border-b border-slate-800">
            <div>
              <div className="text-sm font-medium">Enable hardware integration</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Activates the webhook receiver for this property
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormState(v => ({ ...v, enabled: !v.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                formState.enabled ? "bg-emerald-600" : "bg-slate-700"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                formState.enabled ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>

          {/* Vendor */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Hardware vendor</label>
            <div className="grid grid-cols-3 gap-2">
              {(["hikvision", "zkteco", "generic"] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormState(s => ({ ...s, vendor: v }))}
                  className={`rounded-lg py-2.5 text-xs border transition-all capitalize ${
                    formState.vendor === v
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {v === "hikvision" ? "Hikvision" : v === "zkteco" ? "ZKTeco" : "Generic / Other"}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-1.5">
              Generic accepts pre-normalised JSON. All others use vendor-specific adapters.
            </p>
          </div>

          {/* Device label */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Device label</label>
            <input
              value={formState.deviceLabel ?? ""}
              onChange={e => setFormState(v => ({ ...v, deviceLabel: e.target.value }))}
              placeholder="e.g. Main Gate Camera"
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* HMAC secret */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">
              Webhook secret (HMAC-SHA256) <span className="text-slate-600">— optional but recommended</span>
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={formState.newSecret ?? ""}
                onChange={e => setFormState(v => ({ ...v, newSecret: e.target.value }))}
                placeholder={hw?.webhookSecret ? "Leave blank to keep existing secret" : "Generate or paste a secret key"}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 pr-10 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Set this in your hardware device as X-Webhook-Signature. SmartProp validates every incoming event.
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Notes (internal)</label>
            <input
              value={formState.notes ?? ""}
              onChange={e => setFormState(v => ({ ...v, notes: e.target.value }))}
              placeholder="e.g. Installed 2024, main barrier"
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 h-11"
            disabled={saveMutation.isPending || isGuardSession}
            onClick={() => {
              if (isGuardSession) return;
              saveMutation.mutate({
                enabled: formState.enabled,
                vendor: formState.vendor,
                deviceLabel: formState.deviceLabel,
                notes: formState.notes,
                ...(formState.newSecret?.trim() ? { webhookSecret: formState.newSecret.trim() } : {}),
              });
            }}
          >
            {saveMutation.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
              : isGuardSession
              ? <><AlertTriangle className="w-4 h-4 mr-2" /> Read-only (Guard Session)</>
              : <><CheckCircle className="w-4 h-4 mr-2" /> Save Configuration</>
            }
          </Button>
        </div>
      )}

      {/* ── Webhook URL card (only when enabled) ────────────────────────── */}
      {isEnabled && webhookUrl && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link className="w-4 h-4 text-blue-400" /> Webhook Endpoint
          </div>
          <div className="rounded-lg bg-slate-950 border border-slate-700 p-3 flex items-center gap-2">
            <code className="text-xs text-blue-300 flex-1 break-all leading-relaxed">{webhookUrl}</code>
            <button
              onClick={copyWebhook}
              className="shrink-0 p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Point your hardware device to POST events to this URL. Add <code className="text-slate-400">X-Webhook-Signature: sha256=&lt;hmac&gt;</code> for authenticated requests.
          </p>

          {/* Supported payload examples */}
          <details className="group">
            <summary className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer list-none flex items-center gap-1.5 transition-colors">
              <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
              View expected payload formats
            </summary>
            <div className="mt-3 space-y-3">
              {hw?.vendor === "generic" || !hw?.vendor ? (
                <div className="rounded-lg bg-slate-950 border border-slate-700 p-3">
                  <div className="text-xs text-slate-500 mb-2 font-medium">Generic (pre-normalised)</div>
                  <pre className="text-xs text-green-300 leading-relaxed overflow-x-auto">{`{
  "eventType": "vehicle_entry",
  "plateNumber": "KDA 123A",
  "vehicleType": "car",
  "deviceId": "gate-cam-01",
  "deviceLabel": "Main Gate Camera",
  "timestamp": "2024-01-15T09:30:00Z"
}`}</pre>
                </div>
              ) : hw?.vendor === "hikvision" ? (
                <div className="rounded-lg bg-slate-950 border border-slate-700 p-3">
                  <div className="text-xs text-slate-500 mb-2 font-medium">Hikvision ISAPI JSON</div>
                  <pre className="text-xs text-green-300 leading-relaxed overflow-x-auto">{`{
  "EventNotification": {
    "eventType": "ANPR",
    "dateTime": "2024-01-15T09:30:00Z",
    "ANPR": {
      "licensePlate": "KDA123A",
      "direction": "entry"
    }
  }
}`}</pre>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-950 border border-slate-700 p-3">
                  <div className="text-xs text-slate-500 mb-2 font-medium">ZKTeco BioSecurity JSON</div>
                  <pre className="text-xs text-green-300 leading-relaxed overflow-x-auto">{`{
  "transaction": {
    "event_type": "0",
    "plate_number": "KDA123A",
    "time": "2024-01-15 09:30:00",
    "dev_id": "ZKTECO-GATE-01"
  }
}`}</pre>
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {/* ── Test fire section (only when enabled) ───────────────────────── */}
      {isEnabled && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Zap className="w-4 h-4 text-amber-400" /> Test Integration
          </div>
          <p className="text-xs text-slate-500">
            Fire a synthetic vehicle event to verify your webhook pipeline is working end-to-end.
          </p>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Test plate number</label>
            <input
              value={testPlate}
              onChange={e => setTestPlate(e.target.value.toUpperCase())}
              placeholder="KDA 001A"
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2 text-sm font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="border-emerald-700 text-emerald-400 hover:bg-emerald-950/40 h-10"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate("in")}
            >
              {testMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <><Car className="w-3.5 h-3.5 mr-1.5" /> Entry</>
              }
            </Button>
            <Button
              variant="outline"
              className="border-orange-700 text-orange-400 hover:bg-orange-950/40 h-10"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate("out")}
            >
              {testMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <><LogOut className="w-3.5 h-3.5 mr-1.5" /> Exit</>
              }
            </Button>
          </div>
        </div>
      )}

      {/* ── Recent hardware events ───────────────────────────────────────── */}
      {isEnabled && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Activity className="w-4 h-4 text-slate-400" /> Hardware Events Today
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          {recentEvents.length === 0 ? (
            <div className="p-6 text-center">
              <AlertCircle className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">No hardware events received today.</p>
              <p className="text-xs text-slate-600 mt-1">Events appear here automatically when devices POST to the webhook.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {recentEvents.slice(0, 10).map((ev) => (
                <div key={ev.id} className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    ev.direction === "in" ? "bg-emerald-950/60" : "bg-orange-950/60"
                  }`}>
                    {ev.direction === "in"
                      ? <Car className="w-3.5 h-3.5 text-emerald-400" />
                      : <LogOut className="w-3.5 h-3.5 text-orange-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-medium">{ev.plateNumber || "—"}</div>
                    <div className="text-xs text-slate-500 truncate">{ev.loggedBy}</div>
                  </div>
                  <div className="text-xs text-slate-500 shrink-0">{fmtShort(ev.loggedAt)}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                    ev.direction === "in"
                      ? "bg-emerald-950/40 text-emerald-400 border-emerald-800"
                      : "bg-orange-950/40 text-orange-400 border-orange-800"
                  }`}>
                    {ev.direction === "in" ? "IN" : "OUT"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Info footer ─────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900/50 border border-slate-800/50 p-4 text-xs text-slate-600 space-y-1">
        <p className="flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-slate-700" />
          Hardware integration is <strong className="text-slate-500">optional</strong>. Properties without hardware operate on the software-only flow (QR scan &amp; access codes) without any configuration difference.
        </p>
        <p className="flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-slate-700" />
          Any device that can POST JSON to a URL integrates with SmartProp. No code changes required on your side.
        </p>
      </div>
    </div>
  );
}

// ─── Gate Pass Lookup Panel ───────────────────────────────────────────────────

function GatePassPanel({ propertyId }: { propertyId: number | null }) {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  // State and derived vars MUST be declared before any useQuery that uses them
  const [localPropertyId, setLocalPropertyId] = useState<number | null>(null);
  const effectivePropertyId = propertyId ?? localPropertyId;

  // Fetch property list for admin/manager when no propertyId from check-in
  const { data: propList = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/properties/list-brief"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties?brief=1");
      const d = await r.json();
      return ensureArray(d).map((p: any) => ({ id: p.id, name: p.name }));
    },
    enabled: !propertyId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: passes = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/guard/gate-passes", effectivePropertyId, submitted],
    queryFn: async () => {
      if (!effectivePropertyId) return [];
      const params = new URLSearchParams({ propertyId: String(effectivePropertyId) });
      if (submitted) params.set("search", submitted);
      const r = await apiRequest(`/api/guard/gate-passes?${params.toString()}`);
      return r.json();
    },
    enabled: !!effectivePropertyId,
  });

  function statusColor(s: string) {
    if (s === "approved" || s === "active") return "bg-emerald-950/40 text-emerald-400 border-emerald-800";
    if (s === "pending")  return "bg-amber-950/40 text-amber-400 border-amber-800";
    if (s === "denied" || s === "expired") return "bg-red-950/40 text-red-400 border-red-800";
    return "bg-slate-800 text-slate-400 border-slate-700";
  }

  function passTypeIcon(t: string) {
    if (t === "contractor") return <Building className="w-3.5 h-3.5" />;
    if (t === "delivery")   return <Car className="w-3.5 h-3.5" />;
    return <User className="w-3.5 h-3.5" />;
  }

  if (!effectivePropertyId) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <FileText className="w-4 h-4 text-slate-400" /> Gate Passes
        </div>
        {propList.length === 0 ? (
          <p className="text-xs text-slate-500">Complete a visitor check-in first, or ask your manager to assign you to a property.</p>
        ) : (
          <>
            <p className="text-xs text-slate-400">Select a property to view gate passes:</p>
            <div className="space-y-2">
              {propList.map((p) => (
                <button key={p.id} onClick={() => setLocalPropertyId(p.id)}
                  className="w-full text-left rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2.5 text-sm text-white transition-colors">
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") setSubmitted(search); }}
            placeholder="Search by name or company…"
            className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white pl-10 pr-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          onClick={() => setSubmitted(search)}
          className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-colors"
        >
          Search
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Look up a gate pass to verify a contractor, delivery, or visitor who presents a printed pass.
      </p>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        </div>
      ) : passes.length === 0 ? (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <FileText className="w-8 h-8 text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-500">
            {submitted ? "No passes found matching that name." : "Enter a name above to search for a gate pass."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {passes.map((p: any) => {
            const isValid = (p.status === "approved" || p.status === "active") &&
              (!p.expectedDeparture || new Date(p.expectedDeparture) >= new Date());
            return (
              <div key={p.id} className={`rounded-xl border p-4 space-y-2 ${
                isValid ? "bg-emerald-950/20 border-emerald-800" : "bg-slate-900 border-slate-800"
              }`}>
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      isValid ? "bg-emerald-500/15" : "bg-slate-800"
                    }`}>
                      {isValid
                        ? <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        : <ShieldAlert className="w-4 h-4 text-slate-500" />
                      }
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{p.visitorName}</div>
                      {p.company && <div className="text-xs text-slate-400">{p.company}</div>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${statusColor(p.status)}`}>
                      {p.status}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500 capitalize">
                      {passTypeIcon(p.passType)} {p.passType}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
                  {p.purposeOfVisit && (
                    <div className="col-span-2 flex items-start gap-1.5">
                      <Hash className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{p.purposeOfVisit}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>From: {fmtTime(p.expectedArrival)}</span>
                  </div>
                  {p.expectedDeparture && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>Until: {fmtTime(p.expectedDeparture)}</span>
                    </div>
                  )}
                </div>

                {/* Verdict banner */}
                <div className={`rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                  isValid
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-950/40 text-red-400"
                }`}>
                  {isValid
                    ? <><CheckCircle className="w-3.5 h-3.5" /> Pass is valid — allow entry</>
                    : <><XCircle className="w-3.5 h-3.5" /> Pass is not valid — do not allow entry</>
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Blacklist Panel ──────────────────────────────────────────────────────────

function BlacklistPanel({ propertyId }: { propertyId: number | null }) {
  const [plate, setPlate] = useState("");
  const [checkPlate, setCheckPlate] = useState<string | null>(null);
  // State and derived vars MUST be declared before any useQuery that uses them
  const [blLocalPropertyId, setBlLocalPropertyId] = useState<number | null>(null);
  const blEffectiveId = propertyId ?? blLocalPropertyId;

  // Fetch property list for admin/manager when no propertyId from check-in
  const { data: blPropList = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/properties/list-brief-bl"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties?brief=1");
      const d = await r.json();
      return ensureArray(d).map((p: any) => ({ id: p.id, name: p.name }));
    },
    enabled: !propertyId,
    staleTime: 5 * 60 * 1000,
  });

  // Full watchlist
  const { data: watchlist = [], isLoading: watchlistLoading } = useQuery<any[]>({
    queryKey: ["/api/guard/blacklist", blEffectiveId],
    queryFn: async () => {
      if (!blEffectiveId) return [];
      const r = await apiRequest(`/api/guard/blacklist?propertyId=${blEffectiveId}`);
      return r.json();
    },
    enabled: !!blEffectiveId,
    refetchInterval: 60000,
  });

  // Single plate check
  const { data: checkResult, isLoading: checkLoading } = useQuery<any>({
    queryKey: ["/api/guard/blacklist/check", blEffectiveId, checkPlate],
    queryFn: async () => {
      const params = new URLSearchParams({
        propertyId: String(blEffectiveId!),
        plate: checkPlate!,
      });
      const r = await apiRequest(`/api/guard/blacklist?${params.toString()}`);
      return r.json();
    },
    enabled: !!blEffectiveId && !!checkPlate,
  });

  const alertCount = watchlist.length;

  if (!blEffectiveId) {
    return (
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Ban className="w-4 h-4 text-red-400" /> Vehicle Blacklist
        </div>
        {blPropList.length === 0 ? (
          <p className="text-xs text-slate-500">Complete a visitor check-in first, or ask your manager to assign you to a property.</p>
        ) : (
          <>
            <p className="text-xs text-slate-400">Select a property to view the blacklist:</p>
            <div className="space-y-2">
              {blPropList.map((p) => (
                <button key={p.id} onClick={() => setBlLocalPropertyId(p.id)}
                  className="w-full text-left rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2.5 text-sm text-white transition-colors">
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Alert count */}
      {alertCount > 0 && (
        <div className="rounded-xl bg-red-950/30 border border-red-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <div className="font-semibold text-sm text-red-300">
              {alertCount} blacklisted vehicle{alertCount !== 1 ? "s" : ""} for this property
            </div>
            <div className="text-xs text-red-400/70 mt-0.5">
              Deny entry if any of these plates arrive. Report to your manager immediately.
            </div>
          </div>
        </div>
      )}

      {/* Plate check */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
          <Search className="w-3.5 h-3.5" /> Quick Plate Check
        </div>
        <div className="flex gap-2">
          <input
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") setCheckPlate(plate.trim()); }}
            placeholder="e.g. KDA 123A"
            className="flex-1 rounded-xl bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm font-mono uppercase placeholder:text-slate-600 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={() => setCheckPlate(plate.trim())}
            disabled={!plate.trim()}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-4 py-2.5 text-sm font-medium text-white transition-colors"
          >
            Check
          </button>
        </div>

        {/* Check result */}
        {checkLoading && (
          <div className="flex items-center gap-2 text-slate-500 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
          </div>
        )}
        {checkResult && !checkLoading && (
          <div className={`rounded-lg p-3 flex items-start gap-3 ${
            checkResult.blacklisted
              ? "bg-red-950/40 border border-red-800"
              : "bg-emerald-950/30 border border-emerald-800"
          }`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
              checkResult.blacklisted ? "bg-red-500/15" : "bg-emerald-500/15"
            }`}>
              {checkResult.blacklisted
                ? <Ban className="w-4 h-4 text-red-400" />
                : <ShieldCheck className="w-4 h-4 text-emerald-400" />
              }
            </div>
            <div>
              {checkResult.blacklisted ? (
                <>
                  <div className="font-semibold text-sm text-red-300">⛔ BLACKLISTED — Deny entry</div>
                  <div className="text-xs text-red-400/80 mt-1">
                    {checkResult.vehicle?.color} {checkResult.vehicle?.make} {checkResult.vehicle?.model}
                    {checkResult.vehicle?.notes && ` · ${checkResult.vehicle.notes}`}
                  </div>
                  <div className="text-xs text-red-400/60 mt-0.5">
                    Do not allow this vehicle through. Contact your manager immediately.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-sm text-emerald-400">✓ Not blacklisted</div>
                  <div className="text-xs text-slate-400 mt-0.5">This plate is not on the blacklist for this property.</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full watchlist */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
            <Ban className="w-3.5 h-3.5 text-red-400" /> Blacklisted Vehicles
          </span>
          {alertCount > 0 && (
            <span className="text-[10px] font-bold bg-red-900/60 text-red-400 border border-red-800 rounded-full px-2 py-0.5">
              {alertCount}
            </span>
          )}
        </div>
        {watchlistLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
          </div>
        ) : watchlist.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-800 mx-auto mb-2" />
            <p className="text-xs text-slate-500">No blacklisted vehicles for this property.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {watchlist.map((v: any) => (
              <div key={v.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-red-950/60 flex items-center justify-center shrink-0">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold text-sm text-red-300">{v.plateNumber}</div>
                  <div className="text-xs text-slate-500 truncate capitalize">
                    {v.color} {v.make} {v.model} · {v.vehicleType}
                  </div>
                  {v.notes && <div className="text-xs text-slate-600 truncate mt-0.5">{v.notes}</div>}
                </div>
                <span className="text-[10px] font-bold bg-red-950/40 text-red-400 border border-red-900 rounded-full px-2 py-0.5 shrink-0">
                  DENY
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function GuardCheckin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [topTab, setTopTab] = useState<TopTab>("software");
  const [mode, setMode] = useState<Mode>("manual");
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [isCheckout, setIsCheckout] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  // Vehicle details captured by guard at gate
  const [vehicleForm, setVehicleForm] = useState({ plate: "", make: "", model: "", color: "", type: "car" });
  const [pendingCode, setPendingCode] = useState(""); // code awaiting vehicle capture

  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // ── API mutations ─────────────────────────────────────────────────────────

  const checkinMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest("/api/guest-checkin/scan", {
        method: "POST",
        data: { code: code.trim().toUpperCase(), location: "Main Gate" },
      });
      return r.json() as Promise<CheckInResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.visitor?.propertyId) setPropertyId(data.visitor.propertyId);
      stopCamera();
      if (data.success) {
        const prefilledPlate = data.visitor?.vehiclePlate ?? "";
        setVehicleForm(v => ({ ...v, plate: prefilledPlate }));
        setMode("vehicle-capture");
      } else {
        setMode("result");
      }
    },
    onError: (err: any) => {
      toast({ title: "Check-in failed", description: err.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (code: string) => {
      const r = await apiRequest("/api/guest-checkin/checkout", {
        method: "POST",
        data: { code: code.trim().toUpperCase() },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Checked out", description: "Visitor has been checked out and parking released." });
      resetAll();
    },
  });

  const assignSpaceMutation = useMutation({
    mutationFn: async ({ visitorCode, spaceId }: { visitorCode: string; spaceId: number }) => {
      const r = await apiRequest("/api/guest-checkin/assign-space", {
        method: "POST",
        data: { visitorCode, spaceId },
      });
      return r.json();
    },
    onSuccess: (data) => {
      toast({ title: "Parking assigned", description: `Space ${data.spaceNumber} allocated.` });
      setMode("result");
    },
  });

  // ── Available spaces query ────────────────────────────────────────────────
  const { data: availableSpaces = [] } = useQuery<ParkingSpace[]>({
    queryKey: ["/api/guest-checkin/spaces", propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      const r = await apiRequest(`/api/guest-checkin/spaces?propertyId=${propertyId}`);
      const d = await r.json();
      return ensureArray(d);
    },
    enabled: !!propertyId && mode === "parking-manual",
  });

  // ── Camera logic ──────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const jsQR = (await import("jsqr")).default;

      scanIntervalRef.current = setInterval(() => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code?.data && code.data.startsWith("VAC-")) {
          stopCamera();
          setManualCode(code.data);
          checkinMutation.mutate(code.data);
        }
      }, 300);
    } catch (err: any) {
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and try again."
          : "Camera not available on this device.",
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    if (topTab === "software" && mode === "camera") startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [mode, topTab]);

  const resetAll = () => {
    setResult(null);
    setManualCode("");
    setPendingCode("");
    setMode("manual");
    setIsCheckout(false);
    setSelectedSpaceId(null);
    setPropertyId(null);
    setVehicleForm({ plate: "", make: "", model: "", color: "", type: "car" });
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim().toUpperCase();
    if (!code) return;
    setPendingCode(code);
    if (isCheckout) checkoutMutation.mutate(code);
    else checkinMutation.mutate(code);
  };

  const isPending = checkinMutation.isPending || checkoutMutation.isPending;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Header ── */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-sm tracking-wide">Guard Station</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-slate-400">Live</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ── Top-level tab bar ── */}
        <div className="grid grid-cols-4 gap-1 bg-slate-900 rounded-xl p-1 border border-slate-800">
          {([
            { key: "software",    label: "Scan & Codes", icon: QrCode     },
            { key: "gate-passes", label: "Gate Passes",  icon: FileText   },
            { key: "blacklist",   label: "Blacklist",    icon: Ban        },
            { key: "hardware",    label: "Hardware",     icon: Cpu        },
          ] as { key: TopTab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTopTab(key)}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-xs font-medium transition-all ${
                topTab === key
                  ? key === "blacklist"
                    ? "bg-red-900/60 text-red-300 shadow"
                    : "bg-slate-700 text-white shadow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="leading-none">{label}</span>
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            SOFTWARE TAB — QR scan + manual code
        ══════════════════════════════════════════════════════════════════ */}
        {topTab === "software" && (
          <>
            {/* ── Mode switcher ── */}
            {mode !== "result" && mode !== "parking-manual" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode("camera")}
                  className={`flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium transition-all ${
                    mode === "camera"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  <Scan className="w-4 h-4" />
                  Scan QR
                </button>
                <button
                  onClick={() => setMode("manual")}
                  className={`flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-medium transition-all ${
                    mode === "manual"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  <Keyboard className="w-4 h-4" />
                  Enter Code
                </button>
              </div>
            )}

            {/* ── Toggle check-in / check-out ── */}
            {mode !== "result" && mode !== "parking-manual" && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setIsCheckout(false)}
                  className={`text-sm px-4 py-1.5 rounded-full transition-all ${
                    !isCheckout ? "bg-green-500/20 text-green-400 border border-green-500/30" : "text-slate-500 hover:text-slate-400"
                  }`}
                >
                  Check In
                </button>
                <span className="text-slate-700">|</span>
                <button
                  onClick={() => setIsCheckout(true)}
                  className={`text-sm px-4 py-1.5 rounded-full transition-all ${
                    isCheckout ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "text-slate-500 hover:text-slate-400"
                  }`}
                >
                  Check Out
                </button>
              </div>
            )}

            {/* ── Camera mode ── */}
            {mode === "camera" && (
              <div className="space-y-3">
                {cameraError ? (
                  <div className="rounded-xl bg-red-950/50 border border-red-800 p-6 text-center">
                    <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                    <p className="text-sm text-red-300">{cameraError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 border-red-700 text-red-400"
                      onClick={() => { setCameraError(null); startCamera(); }}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      playsInline
                      muted
                      autoPlay
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Scan overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-52 h-52">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br-lg" />
                        {scanning && (
                          <div className="absolute inset-x-0 top-0 h-0.5 bg-blue-400/70 animate-scan" />
                        )}
                      </div>
                    </div>

                    <div className="absolute bottom-3 inset-x-0 text-center">
                      <span className="text-xs text-white/70 bg-black/50 rounded-full px-3 py-1">
                        Point camera at visitor QR code
                      </span>
                    </div>
                  </div>
                )}

                {checkinMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-blue-400 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Processing...</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Manual code entry ── */}
            {mode === "manual" && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
                    <Hash className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-sm text-slate-400">
                    {isCheckout ? "Enter visitor checkout code" : "Enter visitor access code"}
                  </p>
                </div>

                <div>
                  <Input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    placeholder="VAC-A1B2C3"
                    className="text-center font-mono text-lg tracking-widest bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 h-14 uppercase"
                    onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                    autoFocus
                  />
                </div>

                <Button
                  className={`w-full h-12 font-semibold ${
                    isCheckout ? "bg-orange-600 hover:bg-orange-700" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                  onClick={handleManualSubmit}
                  disabled={!manualCode.trim() || isPending}
                >
                  {isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
                  ) : isCheckout ? (
                    <><LogOut className="w-4 h-4 mr-2" /> Check Out Visitor</>
                  ) : (
                    <><CheckCircle className="w-4 h-4 mr-2" /> Verify &amp; Check In</>
                  )}
                </Button>
              </div>
            )}

            {/* ── Vehicle capture ── */}
            {mode === "vehicle-capture" && result?.success && (
              <div className="space-y-4">
                <div className="rounded-xl bg-green-950/50 border border-green-800 px-5 py-4 flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-green-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-green-300">{result.visitor?.visitorName}</p>
                    <p className="text-xs text-slate-400">
                      {result.visitor?.purposeOfVisit}
                      {result.visitor?.unitNumber && ` · Unit ${result.visitor.unitNumber}`}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Car className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium">Vehicle Details</span>
                    {result.visitor?.vehiclePlate && (
                      <span className="ml-auto text-xs text-blue-400 bg-blue-950/40 border border-blue-800 rounded px-2 py-0.5">
                        Pre-registered by tenant
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Plate Number</label>
                    <input
                      value={vehicleForm.plate}
                      onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value.toUpperCase() }))}
                      placeholder="e.g. KDA 123A"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Vehicle Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {["car", "motorcycle", "van", "truck", "bicycle", "other"].map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setVehicleForm(v => ({ ...v, type: t }))}
                          className={`rounded-lg py-2 text-xs capitalize border transition-all ${
                            vehicleForm.type === t
                              ? "bg-blue-600 border-blue-500 text-white"
                              : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1.5 block">Make</label>
                      <input
                        value={vehicleForm.make}
                        onChange={e => setVehicleForm(v => ({ ...v, make: e.target.value }))}
                        placeholder="Toyota"
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1.5 block">Model</label>
                      <input
                        value={vehicleForm.model}
                        onChange={e => setVehicleForm(v => ({ ...v, model: e.target.value }))}
                        placeholder="Vitz"
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1.5 block">Color</label>
                      <input
                        value={vehicleForm.color}
                        onChange={e => setVehicleForm(v => ({ ...v, color: e.target.value }))}
                        placeholder="Silver"
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Make, model and color are optional but recommended for security records.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setMode("result")}
                  className="w-full text-xs text-slate-500 hover:text-slate-400 py-1 transition-colors"
                >
                  Visitor has no vehicle — skip
                </button>

                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 font-semibold"
                  onClick={async () => {
                    if (vehicleForm.plate.trim()) {
                      try {
                        await apiRequest("/api/registered-vehicles", {
                          method: "POST",
                          data: {
                            propertyId,
                            ownerType: "visitor",
                            plateNumber: vehicleForm.plate.trim().toUpperCase(),
                            vehicleType: vehicleForm.type || "car",
                            make: vehicleForm.make.trim() || "Unknown",
                            model: vehicleForm.model.trim() || "Unknown",
                            color: vehicleForm.color.trim() || "Unknown",
                            isResident: false,
                            status: "active",
                            notes: `Captured at gate. Visitor code: ${pendingCode}`,
                          },
                        });
                      } catch {
                        // Non-fatal
                      }
                    }
                    setMode("result");
                  }}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Confirm &amp; Continue
                </Button>
              </div>
            )}

            {/* ── Result card ── */}
            {mode === "result" && result && (
              <div className="space-y-4">
                <div className={`rounded-xl p-5 text-center ${
                  result.success
                    ? "bg-green-950/60 border border-green-700"
                    : "bg-red-950/60 border border-red-700"
                }`}>
                  {result.success ? (
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                  ) : (
                    <XCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  )}
                  <p className={`font-semibold text-lg ${result.success ? "text-green-300" : "text-red-300"}`}>
                    {result.success ? t("guardCheckin.accessGranted") : t("guardCheckin.accessDenied")}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">{result.message}</p>
                </div>

                {result.visitor && (
                  <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <div className="font-semibold">{result.visitor.visitorName}</div>
                        {result.visitor.visitorPhone && (
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3" /> {result.visitor.visitorPhone}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="px-5 py-4 space-y-3 text-sm">
                      <div className="flex items-start gap-2 text-slate-300">
                        <Building className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                        <span>
                          Visiting <strong>{result.visitor.tenantFirstName} {result.visitor.tenantLastName}</strong>
                          {result.visitor.unitNumber && ` · Unit ${result.visitor.unitNumber}`}
                        </span>
                      </div>
                      {result.visitor.purposeOfVisit && (
                        <div className="flex items-start gap-2 text-slate-300">
                          <Hash className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                          <span>{result.visitor.purposeOfVisit}</span>
                        </div>
                      )}
                      <div className="flex items-start gap-2 text-slate-300">
                        <Clock className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                        <span>Expected: {fmtTime(result.visitor.expectedArrival)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {(result.hasVehicle || vehicleForm.plate) && (
                  <div className={`rounded-xl p-4 border ${
                    result.parking?.allocated
                      ? "bg-emerald-950/40 border-emerald-800"
                      : result.parking?.requiresManual
                      ? "bg-amber-950/40 border-amber-800"
                      : "bg-slate-900 border-slate-800"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Car className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-mono font-medium">
                        {vehicleForm.plate || result.visitor?.vehiclePlate || "Vehicle"}
                      </span>
                      {vehicleForm.make && (
                        <span className="text-xs text-slate-500">
                          {vehicleForm.color} {vehicleForm.make} {vehicleForm.model}
                        </span>
                      )}
                    </div>

                    {result.parking?.allocated ? (
                      <div>
                        <p className="text-emerald-400 text-sm font-semibold">
                          ✓ Parking auto-allocated
                        </p>
                        <p className="text-slate-400 text-xs mt-1">
                          Space <strong className="text-white">{result.parking.spaceNumber}</strong>
                          {result.parking.floor && ` · Floor ${result.parking.floor}`}
                          {result.parking.section && ` · Section ${result.parking.section}`}
                        </p>
                      </div>
                    ) : result.parking?.requiresManual ? (
                      <div>
                        <p className="text-amber-400 text-sm font-semibold mb-2">
                          ⚠ No spaces auto-found — assign manually
                        </p>
                        <Button
                          size="sm"
                          className="bg-amber-600 hover:bg-amber-700 text-white w-full"
                          onClick={() => setMode("parking-manual")}
                        >
                          <MapPin className="w-3 h-3 mr-1" /> Assign Parking Space
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={resetAll}
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Next Visitor
                </Button>
              </div>
            )}

            {/* ── Manual parking selection ── */}
            {mode === "parking-manual" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMode("result")}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    ← Back
                  </button>
                  <h2 className="font-semibold">Select Parking Space</h2>
                </div>

                {availableSpaces.length === 0 ? (
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
                    <ParkingSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">No available spaces found for this property.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {availableSpaces.map((space) => (
                      <button
                        key={space.id}
                        onClick={() => setSelectedSpaceId(space.id)}
                        className={`rounded-xl p-4 text-left border transition-all ${
                          selectedSpaceId === space.id
                            ? "bg-blue-600 border-blue-500"
                            : "bg-slate-900 border-slate-800 hover:border-slate-600"
                        }`}
                      >
                        <div className="font-mono font-bold text-lg">{space.spaceNumber}</div>
                        <div className="text-xs text-slate-400 mt-0.5 capitalize">{space.spaceType}</div>
                        {(space.floor || space.section) && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            {[space.floor, space.section].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {space.hasElectricCharging && (
                          <div className="text-xs text-yellow-400 mt-1">⚡ EV</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {selectedSpaceId && (
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 h-12"
                    disabled={assignSpaceMutation.isPending}
                    onClick={() => {
                      if (!result?.visitor || !selectedSpaceId) return;
                      assignSpaceMutation.mutate({
                        visitorCode: result.visitor.accessCode ?? manualCode,
                        spaceId: selectedSpaceId,
                      });
                    }}
                  >
                    {assignSpaceMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Assigning…</>
                    ) : (
                      <><CheckCircle className="w-4 h-4 mr-2" /> Confirm Assignment</>
                    )}
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ GATE PASSES TAB ══════════════════════════════════════════════ */}
        {topTab === "gate-passes" && (
          <GatePassPanel propertyId={propertyId} />
        )}

        {/* ══ BLACKLIST TAB ════════════════════════════════════════════════ */}
        {topTab === "blacklist" && (
          <BlacklistPanel propertyId={propertyId} />
        )}

        {/* ══ HARDWARE TAB ═════════════════════════════════════════════════ */}
        {topTab === "hardware" && (
          <HardwarePanel propertyId={propertyId} />
        )}

      </div>

      {/* Scan animation CSS */}
      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(208px); opacity: 0.3; }
        }
        .animate-scan {
          animation: scan 1.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}