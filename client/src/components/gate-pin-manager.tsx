/**
 * GatePinManager
 * --------------
 * Admin component for managing guard PINs per property.
 * Mount inside the Security page or a dedicated Settings section.
 *
 * Features:
 *  - List existing PINs (label, status, last used)
 *  - Create new PIN with label + digits
 *  - Toggle active/inactive
 *  - Delete
 *  - PIN is shown ONCE on creation, then never again
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import {
  Shield, Plus, Trash2, ToggleLeft, ToggleRight, Eye, EyeOff,
  Copy, CheckCircle, Clock, Loader2, RefreshCw, KeyRound, AlertTriangle,
  LogIn, LogOut, Timer, Phone, MessageSquare,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GatePin {
  id: number;
  propertyId: number;
  label: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Property {
  id: number;
  name: string;
}

interface GuardShift {
  id: number;
  label: string;
  shiftStart: string;
  shiftEnd: string | null;
  deviceHint: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "Never";
  try { return format(new Date(d), "dd MMM yyyy, h:mm a"); } catch { return "—"; }
}

function shiftDuration(start: string, end: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const mins = Math.round((e - s) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function generatePin(length = 6): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function GatePinManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPin, setNewPin] = useState("");
  const [guardPhone, setGuardPhone] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [createdPin, setCreatedPin] = useState<{ label: string; pin: string; whatsappSent?: boolean; phone?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
  });

  const { data: pins = [], isLoading, refetch } = useQuery<GatePin[]>({
    queryKey: ["/api/gate-pins", selectedPropertyId],
    queryFn: async () => {
      if (!selectedPropertyId) return [];
      const r = await apiRequest(`/api/gate-pins?propertyId=${selectedPropertyId}`);
      return ensureArray(await r.json());
    },
    enabled: !!selectedPropertyId,
  });

  const { data: shifts = [] } = useQuery<GuardShift[]>({
    queryKey: ["/api/gate-auth/shifts", selectedPropertyId],
    queryFn: async () => {
      if (!selectedPropertyId) return [];
      const r = await apiRequest(`/api/gate-auth/shifts?propertyId=${selectedPropertyId}`);
      return ensureArray(await r.json());
    },
    enabled: !!selectedPropertyId,
    refetchInterval: 30_000, // refresh every 30s to catch active shifts
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async ({ label, pin, phone }: { label: string; pin: string; phone: string }) => {
      const r = await apiRequest("/api/gate-pins", {
        method: "POST",
        data: { propertyId: parseInt(selectedPropertyId), label, pin, guardPhone: phone },
      });
      return r.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gate-pins", selectedPropertyId] });
      setIsCreateOpen(false);
      setNewLabel("");
      setNewPin("");
      setGuardPhone("");
      // Show the PIN once, note if WhatsApp was sent
      setCreatedPin({ label: vars.label, pin: vars.pin, whatsappSent: data.whatsappSent ?? false, phone: vars.phone });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create PIN", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/gate-pins/${id}/toggle`, { method: "PATCH" });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/gate-pins", selectedPropertyId] }),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(`/api/gate-pins/${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/gate-pins", selectedPropertyId] }),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleCopy = (pin: string) => {
    navigator.clipboard.writeText(pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── One-time PIN reveal dialog ── */}
      <Dialog open={!!createdPin} onOpenChange={() => setCreatedPin(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              PIN Created — Save It Now
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                This PIN will not be shown again. Share it with the guard now and store it securely.
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Label</p>
              <p className="font-medium">{createdPin?.label}</p>
            </div>
            {createdPin?.phone && (
              <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-sm border ${
                createdPin.whatsappSent
                  ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                  : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500"
              }`}>
                <MessageSquare className="w-4 h-4 shrink-0" />
                {createdPin.whatsappSent
                  ? `PIN sent via WhatsApp to ${createdPin.phone}`
                  : `WhatsApp delivery failed — share PIN manually with ${createdPin.phone}`
                }
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">PIN</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-3xl font-bold tracking-[0.3em] text-foreground">
                  {createdPin?.pin}
                </span>
                <Button
                  variant="ghost" size="icon"
                  onClick={() => createdPin && handleCopy(createdPin.pin)}
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => setCreatedPin(null)}>
              I've saved the PIN
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Main card ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-500" />
                Gate Access PINs
              </CardTitle>
              <CardDescription>
                Manage PIN codes for guards to access the check-in station at each property.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!selectedPropertyId}
                onClick={() => {
                  setNewPin(generatePin());
                  setIsCreateOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> New PIN
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Property selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Select property</p>
            <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Choose a property…" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p: Property) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* PIN list */}
          {!selectedPropertyId ? (
            <div className="text-center py-10 text-muted-foreground">
              <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a property to manage its gate PINs.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : pins.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No PINs yet for this property.</p>
              <p className="text-xs mt-1">Click "New PIN" to create one for your guards.</p>
            </div>
          ) : (
            <div className="divide-y">
              {pins.map((pin) => (
                <div key={pin.id} className="py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{pin.label}</span>
                      <Badge className={`text-[10px] px-2 py-0.5 border ${
                        pin.isActive
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      }`}>
                        {pin.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {pin.expiresAt && new Date(pin.expiresAt) < new Date() && (
                        <Badge className="text-[10px] px-2 py-0.5 border bg-red-100 text-red-700 border-red-200" >
                          Expired
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last used: {fmtDate(pin.lastUsedAt)}
                    </div>
                    {pin.expiresAt && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Expires: {fmtDate(pin.expiresAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8"
                      title={pin.isActive ? "Deactivate" : "Activate"}
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(pin.id)}
                    >
                      {pin.isActive
                        ? <ToggleRight className="w-4 h-4 text-green-500" />
                        : <ToggleLeft className="w-4 h-4 text-slate-400" />
                      }
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="Delete PIN"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(`Delete PIN "${pin.label}"? Guards using it will be locked out.`)) {
                          deleteMutation.mutate(pin.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Shift log ── */}
      {selectedPropertyId && shifts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Timer className="w-4 h-4 text-slate-500" />
              Recent Guard Shifts
            </CardTitle>
            <CardDescription className="text-xs">Last 100 shifts for this property</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {shifts.slice(0, 20).map((shift) => {
                const active = !shift.shiftEnd;
                return (
                  <div key={shift.id} className={`py-3 flex items-start gap-3 ${active ? "bg-green-50/50 dark:bg-green-950/10 -mx-6 px-6" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${active ? "bg-green-100 dark:bg-green-900" : "bg-slate-100 dark:bg-slate-800"}`}>
                      {active
                        ? <LogIn className="w-3.5 h-3.5 text-green-600" />
                        : <LogOut className="w-3.5 h-3.5 text-slate-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{shift.label}</span>
                        {active && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            On shift
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <LogIn className="w-3 h-3" /> {fmtDate(shift.shiftStart)}
                        </span>
                        {shift.shiftEnd && (
                          <span className="flex items-center gap-1">
                            <LogOut className="w-3 h-3" /> {fmtDate(shift.shiftEnd)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {shiftDuration(shift.shiftStart, shift.shiftEnd)}
                          {active && " (ongoing)"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Create PIN dialog ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Gate PIN</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Label</label>
              <Input
                placeholder="e.g. Main Gate · James Kamau"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Describe who or which gate this PIN is for.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">PIN</label>
              <div className="relative">
                <Input
                  type={showPin ? "text" : "password"}
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="4–8 digits"
                  className="font-mono tracking-widest pr-16"
                  maxLength={8}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setShowPin(v => !v)}>
                    {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setNewPin(generatePin())}
                    title="Generate random PIN">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {newPin.length} digit{newPin.length !== 1 ? "s" : ""}. Minimum 4, maximum 8.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Guard Phone (optional)
              </label>
              <Input
                placeholder="+254 7XX XXX XXX"
                value={guardPhone}
                onChange={e => setGuardPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                If provided, the PIN will be sent to this number via WhatsApp.
              </p>
            </div>

            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!newLabel.trim() || newPin.length < 4 || createMutation.isPending}
              onClick={() => createMutation.mutate({ label: newLabel.trim(), pin: newPin, phone: guardPhone.trim() })}
            >
              {createMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                : <><KeyRound className="w-4 h-4 mr-2" /> Create PIN</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}