/**
 * Gate Portal — /gate
 * --------------------
 * A fully standalone page with no sidebar or top bar.
 * Guards access this URL on any device (phone / tablet / desktop).
 *
 * Flow:
 *  1. Guard opens /gate
 *  2. Enters property ID (or it's in URL: /gate?p=3) + PIN
 *  3. Short-lived guard token issued → stored in sessionStorage
 *  4. Check-in screen shown (same logic as guard-checkin.tsx but embedded here)
 *  5. Session auto-expires after 12 hours (one shift)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, QrCode, Keyboard, CheckCircle, XCircle, Car, User,
  Building, Hash, Clock, Phone, MapPin, LogOut, Scan, Loader2,
  RefreshCw, ChevronLeft, KeyRound, ParkingSquare,
  UserPlus, ClipboardList, ArrowUp, ArrowDown, Calendar, Users,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GuardSession {
  token: string;
  propertyId: number;
  propertyName: string;
  label: string;
  shiftId: number | null;
}

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

type Screen = "login" | "checkin" | "vehicle-capture" | "result" | "parking-manual" | "adhoc" | "vehicle-log";
type CheckinMode = "camera" | "manual";

// ─── Storage helpers ────────────────────────────────────────────────────────

const SESSION_KEY = "guard_session";

function saveSession(session: GuardSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function loadSession(): GuardSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

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

function getPropertyIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("p") ?? "";
}

// ─── Guard API helper (injects guard token) ────────────────────────────────

async function guardRequest(url: string, token: string, options: any = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? "Request failed");
  }
  return res.json();
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function GatePortal() {
  const { toast } = useToast();

  // Session
  const [session, setSession] = useState<GuardSession | null>(loadSession);
  const [screen, setScreen] = useState<Screen>(session ? "checkin" : "login");

  // Login form
  const [propertyId, setPropertyId] = useState(getPropertyIdFromUrl());
  const [pin, setPin] = useState("");
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Check-in
  const [checkinMode, setCheckinMode] = useState<CheckinMode>("manual");
  const [manualCode, setManualCode] = useState("");
  const [isCheckout, setIsCheckout] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [pendingCode, setPendingCode] = useState("");

  // Vehicle capture
  const [vehicleForm, setVehicleForm] = useState({ plate: "", make: "", model: "", color: "", type: "car" });

  // Parking
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [spaces, setSpaces] = useState<ParkingSpace[]>([]);

  // Ad-hoc pass state
  const [adhocForm, setAdhocForm] = useState({ visitorName: "", visitorPhone: "", purpose: "", unitId: "", tenantId: "", vehiclePlate: "" });
  const [adhocResult, setAdhocResult] = useState<{ accessCode: string; visitorName: string } | null>(null);
  const [adhocLoading, setAdhocLoading] = useState(false);

  // Vehicle log state
  const [vlogForm, setVlogForm] = useState({ plateNumber: "", vehicleType: "car", direction: "in" as "in" | "out", purpose: "", unitNumber: "", driverName: "" });
  const [vlogLoading, setVlogLoading] = useState(false);
  const [vlogSuccess, setVlogSuccess] = useState(false);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);

  // ── Properties list for login selector ──────────────────────────────────
  // Guard feature queries — only active when logged in
  const { data: tenantList = [] } = useQuery({
    queryKey: ["/api/guard/tenants", session?.propertyId],
    queryFn: async () => {
      if (!session) return [];
      const data = await guardRequest(`/api/guard/tenants`, session.token, { method: "GET" });
      return ensureArray(data);
    },
    enabled: !!session,
  });

  const { data: todayData, refetch: refetchToday } = useQuery({
    queryKey: ["/api/guard/expected-today", session?.propertyId],
    queryFn: async () => {
      if (!session) return { expected: [], inside: [] };
      return await guardRequest("/api/guard/expected-today", session.token, { method: "GET" });
    },
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const { data: vlogToday = [], refetch: refetchVlog } = useQuery({
    queryKey: ["/api/guard/vehicle-log", session?.propertyId],
    queryFn: async () => {
      if (!session) return [];
      const data = await guardRequest("/api/guard/vehicle-log", session.token, { method: "GET" });
      return ensureArray(data);
    },
    enabled: !!session && screen === "vehicle-log",
    refetchInterval: 30_000,
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/gate-auth/properties"],
    queryFn: async () => {
      // Public endpoint — no auth required, returns id + name only
      try {
        const r = await fetch("/api/gate-auth/properties");
        if (!r.ok) return [];
        return ensureArray(await r.json());
      } catch { return []; }
    },
  });

  // ── PIN login ─────────────────────────────────────────────────────────────

  const handlePinDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    if (digit && index < 5) pinRefs.current[index + 1]?.focus();
    if (!digit && index > 0 && !pinDigits[index]) pinRefs.current[index - 1]?.focus();
  };

  const handleLogin = async () => {
    const enteredPin = pinDigits.join("").trim();
    if (!propertyId) { setLoginError("Please select a property."); return; }
    if (enteredPin.length < 4) { setLoginError("Enter your full PIN."); return; }

    setLoginError("");
    setLoginLoading(true);
    try {
      const data = await guardRequest("/api/gate-auth/login", "", {
        method: "POST",
        data: { propertyId: parseInt(propertyId), pin: enteredPin },
        headers: {},
      });

      const sess: GuardSession = {
        token:        data.token,
        propertyId:   data.propertyId,
        propertyName: data.propertyName,
        label:        data.label,
        shiftId:      data.shiftId ?? null,
      };
      saveSession(sess);
      setSession(sess);
      setScreen("checkin");
      setPinDigits(["", "", "", "", "", ""]);
    } catch (err: any) {
      setLoginError(err.message ?? "Incorrect PIN. Try again.");
      setPinDigits(["", "", "", "", "", ""]);
      pinRefs.current[0]?.focus();
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    // Record shift end before clearing session
    if (session) {
      try {
        await fetch("/api/gate-auth/end-shift", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ shiftId: session.shiftId }),
        });
      } catch {
        // Non-fatal — shift end is best-effort
      }
    }
    clearSession();
    setSession(null);
    setScreen("login");
    resetCheckin();
  };

  // ── Camera ────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (scanRef.current) clearInterval(scanRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const jsQR = (await import("jsqr")).default;
      scanRef.current = setInterval(() => {
        if (!videoRef.current || !canvasRef.current) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        if (v.readyState !== v.HAVE_ENOUGH_DATA) return;
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(img.data, img.width, img.height);
        if (code?.data?.startsWith("VAC-")) {
          stopCamera();
          doCheckin(code.data);
        }
      }, 300);
    } catch (err: any) {
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Use manual code entry instead."
          : "Camera unavailable on this device."
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    if (screen === "checkin" && checkinMode === "camera") startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [screen, checkinMode]);

  // ── Check-in ──────────────────────────────────────────────────────────────

  const doCheckin = async (code: string) => {
    if (!session) return;
    setCheckinLoading(true);
    setPendingCode(code);
    try {
      const data: CheckInResult = await guardRequest(
        "/api/guest-checkin/scan",
        session.token,
        { method: "POST", data: { code: code.trim().toUpperCase(), location: "Main Gate" } }
      );
      setResult(data);
      if (data.success) {
        setVehicleForm(v => ({ ...v, plate: data.visitor?.vehiclePlate ?? "" }));
        setScreen("vehicle-capture");
      } else {
        setScreen("result");
      }
    } catch (err: any) {
      if (err.message?.includes("expired")) { handleLogout(); return; }
      toast({ title: "Check-in failed", description: err.message, variant: "destructive" });
    } finally {
      setCheckinLoading(false);
    }
  };

  const doCheckout = async (code: string) => {
    if (!session) return;
    setCheckinLoading(true);
    try {
      await guardRequest("/api/guest-checkin/checkout", session.token, {
        method: "POST", data: { code: code.trim().toUpperCase() },
      });
      toast({ title: "Checked out", description: "Visitor departed and parking released." });
      resetCheckin();
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    } finally {
      setCheckinLoading(false);
    }
  };

  const loadSpaces = async () => {
    if (!session) return;
    try {
      const data = await guardRequest(
        `/api/guest-checkin/spaces?propertyId=${session.propertyId}`,
        session.token, { method: "GET" }
      );
      setSpaces(ensureArray(data));
    } catch { setSpaces([]); }
  };

  const assignSpace = async () => {
    if (!session || !selectedSpaceId || !pendingCode) return;
    try {
      const data = await guardRequest("/api/guest-checkin/assign-space", session.token, {
        method: "POST", data: { visitorCode: pendingCode, spaceId: selectedSpaceId },
      });
      toast({ title: "Space assigned", description: `Space ${data.spaceNumber} allocated.` });
      setScreen("result");
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const resetCheckin = () => {
    setResult(null);
    setManualCode("");
    setPendingCode("");
    setIsCheckout(false);
    setVehicleForm({ plate: "", make: "", model: "", color: "", type: "car" });
    setSelectedSpaceId(null);
    setSpaces([]);
    setScreen("checkin");
    setCheckinMode("manual");
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* ── Header ── */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <div>
            <span className="font-semibold text-sm">Gate Station</span>
            {session && (
              <span className="text-xs text-slate-500 ml-2">{session.propertyName} · {session.label}</span>
            )}
          </div>
        </div>
        {session && (
          <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
            <LogOut className="w-3.5 h-3.5" /> End shift
          </button>
        )}
      </div>

      {/* ── Bottom nav tabs (only when logged in) ── */}
      {session && screen !== "login" && !["vehicle-capture", "result", "parking-manual"].includes(screen) && (
        <div className="bg-slate-900 border-b border-slate-800" >
          <div className="max-w-lg mx-auto flex">
            {[
              { id: "checkin",     icon: QrCode,        label: "Check In"    },
              { id: "adhoc",       icon: UserPlus,      label: "Gate Pass"   },
              { id: "vehicle-log", icon: ClipboardList,  label: "Vehicles"   },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setScreen(tab.id as Screen)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-all border-b-2 ${
                  screen === tab.id
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-slate-500 hover:text-slate-400"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-6 space-y-4">

        {/* ════════════════ LOGIN SCREEN ════════════════ */}
        {screen === "login" && (
          <div className="flex-1 flex flex-col justify-center space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-7 h-7 text-blue-400" />
              </div>
              <h1 className="text-xl font-semibold">Guard Login</h1>
              <p className="text-sm text-slate-400 mt-1">Enter your property and PIN to begin</p>
            </div>

            {/* Property selector */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Property</label>
              <select
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select property…</option>
                {properties.map((p: any) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* PIN input — individual digit boxes */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400">PIN</label>
              <div className="flex gap-2 justify-center">
                {pinDigits.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { pinRefs.current[i] = el; }}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={e => handlePinDigit(i, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Backspace" && !d && i > 0) {
                        pinRefs.current[i - 1]?.focus();
                      }
                      if (e.key === "Enter") handleLogin();
                    }}
                    className="w-12 h-14 rounded-xl bg-slate-800 border border-slate-700 text-white text-center text-xl font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                ))}
              </div>
              <p className="text-xs text-center text-slate-600">Enter 4–8 digit PIN</p>
            </div>

            {loginError && (
              <div className="rounded-xl bg-red-950/50 border border-red-800 px-4 py-3 text-sm text-red-300 text-center">
                {loginError}
              </div>
            )}

            <Button
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 font-semibold"
              onClick={handleLogin}
              disabled={loginLoading || !propertyId || pinDigits.join("").length < 4}
            >
              {loginLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying…</>
                : <><Shield className="w-4 h-4 mr-2" /> Start Shift</>
              }
            </Button>
          </div>
        )}

        {/* ════════════════ CHECK-IN SCREEN ════════════════ */}
        {screen === "checkin" && (
          <div className="space-y-4">

            {/* Mode + check-in/out toggle */}
            <div className="grid grid-cols-2 gap-2">
              {(["manual", "camera"] as CheckinMode[]).map(m => (
                <button key={m} onClick={() => setCheckinMode(m)}
                  className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all ${
                    checkinMode === m
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {m === "camera" ? <Scan className="w-4 h-4" /> : <Keyboard className="w-4 h-4" />}
                  {m === "camera" ? "Scan QR" : "Enter Code"}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3">
              {(["checkin", "checkout"] as const).map(action => (
                <button key={action}
                  onClick={() => setIsCheckout(action === "checkout")}
                  className={`text-sm px-4 py-1.5 rounded-full transition-all ${
                    (action === "checkout") === isCheckout
                      ? action === "checkin"
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                      : "text-slate-500 hover:text-slate-400"
                  }`}
                >
                  {action === "checkin" ? "Check In" : "Check Out"}
                </button>
              ))}
            </div>

            {/* Camera view */}
            {checkinMode === "camera" && (
              <div className="space-y-3">
                {cameraError ? (
                  <div className="rounded-xl bg-red-950/50 border border-red-800 p-6 text-center">
                    <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                    <p className="text-sm text-red-300">{cameraError}</p>
                    <Button variant="outline" size="sm" className="mt-4 border-red-700 text-red-400"
                      onClick={() => { setCameraError(null); startCamera(); }}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                    <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-48 h-48">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr-lg" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl-lg" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br-lg" />
                        {scanning && <div className="absolute inset-x-0 top-0 h-0.5 bg-blue-400/70 animate-scan" />}
                      </div>
                    </div>
                    <div className="absolute bottom-3 inset-x-0 text-center">
                      <span className="text-xs text-white/70 bg-black/50 rounded-full px-3 py-1">
                        Point at visitor QR code
                      </span>
                    </div>
                  </div>
                )}
                {checkinLoading && (
                  <div className="flex items-center justify-center gap-2 text-blue-400 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Processing…</span>
                  </div>
                )}
              </div>
            )}

            {/* Manual code entry */}
            {checkinMode === "manual" && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
                    <Hash className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-sm text-slate-400">
                    {isCheckout ? "Enter checkout code" : "Enter visitor access code"}
                  </p>
                </div>
                <Input
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value.toUpperCase())}
                  placeholder="VAC-A1B2C3"
                  className="text-center font-mono text-lg tracking-widest bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 h-14 uppercase"
                  onKeyDown={e => {
                    if (e.key === "Enter" && manualCode.trim()) {
                      isCheckout ? doCheckout(manualCode) : doCheckin(manualCode);
                    }
                  }}
                  autoFocus
                />
                <Button
                  className={`w-full h-12 font-semibold ${isCheckout ? "bg-orange-600 hover:bg-orange-700" : "bg-blue-600 hover:bg-blue-700"}`}
                  disabled={!manualCode.trim() || checkinLoading}
                  onClick={() => isCheckout ? doCheckout(manualCode) : doCheckin(manualCode)}
                >
                  {checkinLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
                    : isCheckout
                    ? <><LogOut className="w-4 h-4 mr-2" /> Check Out</>
                    : <><CheckCircle className="w-4 h-4 mr-2" /> Verify & Check In</>
                  }
                </Button>
              </div>
            )}

            {/* ── Today's expected visitors ── */}
            {todayData && (
              <div className="space-y-3">

                {/* Currently inside */}
                {(todayData as any).inside?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs font-medium text-green-400 uppercase tracking-wide">
                        Inside Now ({(todayData as any).inside.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(todayData as any).inside.map((v: any) => (
                        <div key={v.id} className="rounded-xl bg-green-950/30 border border-green-900 px-4 py-3 flex items-center gap-3">
                          <User className="w-4 h-4 text-green-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-green-300">{v.visitorName}</p>
                            <p className="text-xs text-slate-500">
                              {v.unitNumber && `Unit ${v.unitNumber} · `}
                              {v.purposeOfVisit}
                              {v.vehiclePlate && ` · ${v.vehiclePlate}`}
                            </p>
                          </div>
                          <span className="text-xs text-slate-500">
                            {v.actualArrival ? new Date(v.actualArrival).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expected today */}
                {(todayData as any).expected?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 mt-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                        Expected Today ({(todayData as any).expected.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(todayData as any).expected.map((v: any) => (
                        <div key={v.id} className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3 flex items-center gap-3">
                          <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{v.visitorName}</p>
                            <p className="text-xs text-slate-500">
                              {v.unitNumber && `Unit ${v.unitNumber} · `}
                              {v.purposeOfVisit}
                            </p>
                          </div>
                          <span className="text-xs text-slate-400 font-mono">
                            {new Date(v.expectedArrival).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>
        )}

        {/* ════════════════ VEHICLE CAPTURE ════════════════ */}
        {screen === "vehicle-capture" && result?.success && (
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
              <div className="flex items-center gap-2">
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
                <input value={vehicleForm.plate}
                  onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value.toUpperCase() }))}
                  placeholder="KDA 123A"
                  className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Vehicle Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {["car", "motorcycle", "van", "truck", "bicycle", "other"].map(t => (
                    <button key={t} type="button"
                      onClick={() => setVehicleForm(v => ({ ...v, type: t }))}
                      className={`rounded-lg py-2 text-xs capitalize border transition-all ${
                        vehicleForm.type === t
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
                      }`}
                    >{t}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {(["make", "model", "color"] as const).map(field => (
                  <div key={field}>
                    <label className="text-xs text-slate-400 mb-1.5 block capitalize">{field}</label>
                    <input value={vehicleForm[field]}
                      onChange={e => setVehicleForm(v => ({ ...v, [field]: e.target.value }))}
                      placeholder={field === "make" ? "Toyota" : field === "model" ? "Vitz" : "Silver"}
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => setScreen("result")}
              className="w-full text-xs text-slate-500 hover:text-slate-400 py-1 transition-colors">
              Visitor has no vehicle — skip
            </button>

            <Button className="w-full bg-blue-600 hover:bg-blue-700 h-12 font-semibold"
              onClick={async () => {
                if (vehicleForm.plate.trim() && session) {
                  try {
                    await guardRequest("/api/registered-vehicles", session.token, {
                      method: "POST",
                      data: {
                        propertyId: session.propertyId,
                        ownerType: "visitor",
                        plateNumber: vehicleForm.plate.trim().toUpperCase(),
                        vehicleType: vehicleForm.type || "car",
                        make: vehicleForm.make.trim() || "Unknown",
                        model: vehicleForm.model.trim() || "Unknown",
                        color: vehicleForm.color.trim() || "Unknown",
                        isResident: false,
                        status: "active",
                        notes: `Captured at gate. Code: ${pendingCode}`,
                      },
                    });
                  } catch { /* non-fatal */ }
                }
                setScreen("result");
              }}>
              <CheckCircle className="w-4 h-4 mr-2" /> Confirm & Continue
            </Button>
          </div>
        )}

        {/* ════════════════ RESULT SCREEN ════════════════ */}
        {screen === "result" && result && (
          <div className="space-y-4">
            <div className={`rounded-xl p-5 text-center ${
              result.success ? "bg-green-950/60 border border-green-700" : "bg-red-950/60 border border-red-700"
            }`}>
              {result.success
                ? <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                : <XCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
              }
              <p className={`font-semibold text-lg ${result.success ? "text-green-300" : "text-red-300"}`}>
                {result.success ? "Access Granted" : "Access Denied"}
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
                    <span>{fmtTime(result.visitor.expectedArrival)}</span>
                  </div>
                </div>
              </div>
            )}

            {(result.hasVehicle || vehicleForm.plate) && (
              <div className={`rounded-xl p-4 border ${
                result.parking?.allocated ? "bg-emerald-950/40 border-emerald-800"
                  : result.parking?.requiresManual ? "bg-amber-950/40 border-amber-800"
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
                    <p className="text-emerald-400 text-sm font-semibold">✓ Parking auto-allocated</p>
                    <p className="text-slate-400 text-xs mt-1">
                      Space <strong className="text-white">{result.parking.spaceNumber}</strong>
                      {result.parking.floor && ` · Floor ${result.parking.floor}`}
                      {result.parking.section && ` · Section ${result.parking.section}`}
                    </p>
                  </div>
                ) : result.parking?.requiresManual ? (
                  <div>
                    <p className="text-amber-400 text-sm font-semibold mb-2">⚠ Assign parking manually</p>
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white w-full"
                      onClick={() => { loadSpaces(); setScreen("parking-manual"); }}>
                      <MapPin className="w-3 h-3 mr-1" /> Choose Space
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
              onClick={resetCheckin}>
              <RefreshCw className="w-4 h-4 mr-2" /> Next Visitor
            </Button>
          </div>
        )}

        {/* ════════════════ PARKING MANUAL ════════════════ */}
        {screen === "parking-manual" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setScreen("result")} className="text-slate-400 hover:text-white">← Back</button>
              <h2 className="font-semibold">Select Parking Space</h2>
            </div>

            {spaces.length === 0 ? (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
                <ParkingSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No available spaces.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {spaces.map(space => (
                  <button key={space.id} onClick={() => setSelectedSpaceId(space.id)}
                    className={`rounded-xl p-4 text-left border transition-all ${
                      selectedSpaceId === space.id
                        ? "bg-blue-600 border-blue-500"
                        : "bg-slate-900 border-slate-800 hover:border-slate-600"
                    }`}>
                    <div className="font-mono font-bold text-lg">{space.spaceNumber}</div>
                    <div className="text-xs text-slate-400 mt-0.5 capitalize">{space.spaceType}</div>
                    {(space.floor || space.section) && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[space.floor, space.section].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {space.hasElectricCharging && <div className="text-xs text-yellow-400 mt-1">⚡ EV</div>}
                  </button>
                ))}
              </div>
            )}

            {selectedSpaceId && (
              <Button className="w-full bg-blue-600 hover:bg-blue-700 h-12" onClick={assignSpace}>
                <CheckCircle className="w-4 h-4 mr-2" /> Confirm Space
              </Button>
            )}
          </div>
        )}

      </div>


        {/* ════════════════ AD-HOC GATE PASS ════════════════ */}
        {screen === "adhoc" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus className="w-5 h-5 text-blue-400" />
              <h2 className="font-semibold">Ad-hoc Gate Pass</h2>
              <span className="text-xs text-slate-500 ml-auto">Walk-in visitor</span>
            </div>

            {adhocResult ? (
              /* Success state */
              <div className="space-y-4">
                <div className="rounded-xl bg-green-950/60 border border-green-700 p-5 text-center">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                  <p className="font-semibold text-green-300 text-lg">Pass Issued</p>
                  <p className="text-slate-400 text-sm mt-1">{adhocResult.visitorName} is now checked in</p>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 text-center">
                  <p className="text-xs text-slate-500 mb-1">Access Code</p>
                  <p className="font-mono text-2xl font-bold tracking-widest">{adhocResult.accessCode}</p>
                  <p className="text-xs text-slate-600 mt-1">For records only — visitor is already inside</p>
                </div>
                <Button className="w-full border-slate-700 text-slate-300" variant="outline"
                  onClick={() => { setAdhocResult(null); setAdhocForm({ visitorName: "", visitorPhone: "", purpose: "", unitId: "", tenantId: "", vehiclePlate: "" }); }}>
                  <RefreshCw className="w-4 h-4 mr-2" /> New Pass
                </Button>
              </div>
            ) : (
              /* Form */
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Visitor Name *</label>
                    <input value={adhocForm.visitorName}
                      onChange={e => setAdhocForm(v => ({ ...v, visitorName: e.target.value }))}
                      placeholder="Full name"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Phone</label>
                    <input value={adhocForm.visitorPhone}
                      onChange={e => setAdhocForm(v => ({ ...v, visitorPhone: e.target.value }))}
                      placeholder="+254 7XX XXX XXX"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Vehicle Plate</label>
                    <input value={adhocForm.vehiclePlate}
                      onChange={e => setAdhocForm(v => ({ ...v, vehiclePlate: e.target.value.toUpperCase() }))}
                      placeholder="KDA 123A"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1.5 block">Purpose *</label>
                    <input value={adhocForm.purpose}
                      onChange={e => setAdhocForm(v => ({ ...v, purpose: e.target.value }))}
                      placeholder="e.g. Delivery, Personal visit, Viewing"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Tenant / unit picker */}
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Visiting (unit / tenant)</label>
                  <select
                    value={adhocForm.tenantId}
                    onChange={e => {
                      const tenant = (tenantList as any[]).find((t: any) => String(t.id) === e.target.value);
                      setAdhocForm(v => ({ ...v, tenantId: e.target.value, unitId: tenant?.unitId ? String(tenant.unitId) : "" }));
                    }}
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select tenant / unit…</option>
                    {(tenantList as any[]).map((t: any) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.unitNumber ? `Unit ${t.unitNumber} — ` : ""}{t.firstName} {t.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 h-12 font-semibold"
                  disabled={!adhocForm.visitorName.trim() || !adhocForm.purpose.trim() || adhocLoading}
                  onClick={async () => {
                    if (!session) return;
                    setAdhocLoading(true);
                    try {
                      const data = await guardRequest("/api/guard/adhoc-pass", session.token, {
                        method: "POST",
                        data: {
                          visitorName:  adhocForm.visitorName.trim(),
                          visitorPhone: adhocForm.visitorPhone.trim() || undefined,
                          purpose:      adhocForm.purpose.trim(),
                          tenantId:     adhocForm.tenantId || undefined,
                          unitId:       adhocForm.unitId || undefined,
                          vehiclePlate: adhocForm.vehiclePlate.trim() || undefined,
                          shiftId:      session.shiftId,
                        },
                      });
                      setAdhocResult({ accessCode: data.accessCode, visitorName: adhocForm.visitorName.trim() });
                    } catch (err: any) {
                      toast({ title: "Failed", description: err.message, variant: "destructive" });
                    } finally {
                      setAdhocLoading(false);
                    }
                  }}
                >
                  {adhocLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Issuing…</>
                    : <><UserPlus className="w-4 h-4 mr-2" /> Issue Gate Pass</>
                  }
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════ VEHICLE LOG ════════════════ */}
        {screen === "vehicle-log" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList className="w-5 h-5 text-blue-400" />
              <h2 className="font-semibold">Vehicle Logbook</h2>
              <button onClick={() => refetchVlog()} className="ml-auto text-slate-500 hover:text-slate-300">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick log form */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Log Movement</p>

              {/* Direction toggle */}
              <div className="grid grid-cols-2 gap-2">
                {(["in", "out"] as const).map(dir => (
                  <button key={dir}
                    onClick={() => setVlogForm(v => ({ ...v, direction: dir }))}
                    className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all ${
                      vlogForm.direction === dir
                        ? dir === "in"
                          ? "bg-green-600 text-white"
                          : "bg-orange-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {dir === "in"
                      ? <><ArrowDown className="w-4 h-4" /> Entering</>
                      : <><ArrowUp className="w-4 h-4" /> Exiting</>
                    }
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 mb-1 block">Plate Number *</label>
                  <input value={vlogForm.plateNumber}
                    onChange={e => setVlogForm(v => ({ ...v, plateNumber: e.target.value.toUpperCase() }))}
                    placeholder="KDA 123A"
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Type</label>
                  <select value={vlogForm.vehicleType}
                    onChange={e => setVlogForm(v => ({ ...v, vehicleType: e.target.value }))}
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {["car","motorcycle","van","truck","bicycle"].map(t => (
                      <option key={t} value={t} className="capitalize">{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Unit (if known)</label>
                  <input value={vlogForm.unitNumber}
                    onChange={e => setVlogForm(v => ({ ...v, unitNumber: e.target.value }))}
                    placeholder="e.g. 4B"
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 mb-1 block">Purpose</label>
                  <input value={vlogForm.purpose}
                    onChange={e => setVlogForm(v => ({ ...v, purpose: e.target.value }))}
                    placeholder="Delivery, Visit, Contractor…"
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white px-3 py-2.5 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {vlogSuccess && (
                <div className="rounded-lg bg-green-950/50 border border-green-800 px-3 py-2 text-xs text-green-400 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" /> Logged successfully
                </div>
              )}

              <Button
                className={`w-full h-11 font-semibold ${vlogForm.direction === "in" ? "bg-green-600 hover:bg-green-700" : "bg-orange-600 hover:bg-orange-700"}`}
                disabled={!vlogForm.plateNumber.trim() || vlogLoading}
                onClick={async () => {
                  if (!session) return;
                  setVlogLoading(true);
                  setVlogSuccess(false);
                  try {
                    await guardRequest("/api/guard/vehicle-log", session.token, {
                      method: "POST",
                      data: {
                        plateNumber:  vlogForm.plateNumber.trim().toUpperCase(),
                        vehicleType:  vlogForm.vehicleType,
                        direction:    vlogForm.direction,
                        purpose:      vlogForm.purpose.trim() || undefined,
                        unitNumber:   vlogForm.unitNumber.trim() || undefined,
                        driverName:   vlogForm.driverName?.trim() || undefined,
                        shiftId:      session.shiftId,
                      },
                    });
                    setVlogSuccess(true);
                    setVlogForm({ plateNumber: "", vehicleType: "car", direction: vlogForm.direction, purpose: "", unitNumber: "", driverName: "" });
                    setTimeout(() => setVlogSuccess(false), 3000);
                    refetchVlog();
                  } catch (err: any) {
                    toast({ title: "Failed to log", description: err.message, variant: "destructive" });
                  } finally {
                    setVlogLoading(false);
                  }
                }}
              >
                {vlogLoading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Logging…</>
                  : vlogForm.direction === "in"
                  ? <><ArrowDown className="w-4 h-4 mr-2" /> Log Entry</>
                  : <><ArrowUp className="w-4 h-4 mr-2" /> Log Exit</>
                }
              </Button>
            </div>

            {/* Today's log */}
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-3">
                Today's Movements ({(vlogToday as any[]).length})
              </p>
              {(vlogToday as any[]).length === 0 ? (
                <div className="text-center py-8 text-slate-600">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No movements logged today</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(vlogToday as any[]).map((entry: any) => (
                    <div key={entry.id} className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        entry.direction === "in"
                          ? "bg-green-950/60 border border-green-800"
                          : "bg-orange-950/60 border border-orange-800"
                      }`}>
                        {entry.direction === "in"
                          ? <ArrowDown className="w-4 h-4 text-green-400" />
                          : <ArrowUp className="w-4 h-4 text-orange-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-sm">{entry.plateNumber}</span>
                          <span className="text-xs text-slate-500 capitalize">{entry.vehicleType}</span>
                          {entry.unitNumber && (
                            <span className="text-xs bg-slate-800 text-slate-400 rounded px-1.5 py-0.5">Unit {entry.unitNumber}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {new Date(entry.loggedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                          {entry.purpose && <span>· {entry.purpose}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(192px); opacity: 0.3; }
        }
        .animate-scan { animation: scan 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}