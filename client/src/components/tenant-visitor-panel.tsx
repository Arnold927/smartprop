/**
 * client/src/components/tenant-visitor-panel.tsx
 *
 * Tenant-facing visitor management:
 *   - Full history of all visitors ever invited (with status, access code, arrival)
 *   - Invite new visitor form
 *   - Cancel pending invites
 *   - Filter by status / search by name
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import {
  UserPlus, User, Clock, CheckCircle2, XCircle, Search,
  Car, Phone, Mail, Calendar, RefreshCw, ChevronDown,
  ChevronUp, Copy, Loader2, QrCode, Ban, MessageCircle as WhatsAppIcon,
} from "lucide-react";
import { format, isAfter, isBefore, parseISO } from "date-fns";
import QRCode from "qrcode";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Visitor {
  id: number;
  visitorName: string;
  visitorEmail: string | null;
  visitorPhone: string | null;
  purposeOfVisit: string | null;
  expectedArrival: string;
  expectedDeparture: string | null;
  actualArrival: string | null;
  actualDeparture: string | null;
  // The values the server actually stores (visitor_status enum). This list used to be a different,
  // made-up vocabulary ("arrived", "departed", "cancelled"), so a guest the guard had checked in still
  // showed as "Pending" here, the "Visited" count never moved, and the status filter matched nothing.
  status: "pending" | "approved" | "checked_in" | "checked_out" | "denied" | "expired";
  accessCode: string;
  vehiclePlate: string | null;
  parkingSpot: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "EEE, d MMM yyyy · h:mm a"); } catch { return "—"; }
}

function fmtShort(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "d MMM yyyy"); } catch { return "—"; }
}

const STATUS_STYLE: Record<string, string> = {
  pending:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  approved:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  checked_in:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  checked_out: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  denied:      "bg-gray-100 text-gray-600 dark:bg-gray-800 ",
  expired:     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_ICON: Record<string, any> = {
  pending:     Clock,
  approved:    Clock,
  checked_in:  CheckCircle2,
  checked_out: CheckCircle2,
  denied:      Ban,
  expired:     XCircle,
};

const STATUS_LABEL: Record<string, string> = {
  pending:     "Invited",
  approved:    "Approved",
  checked_in:  "Arrived",
  checked_out: "Departed",
  denied:      "Cancelled",
  expired:     "Expired",
};

/** The pass the guard scans. Rendered in the browser so it also works offline / when the email never arrived. */
function AccessQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(code, { width: 220, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then(u => { if (live) setSrc(u); })
      .catch(() => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [code]);
  if (!src) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <img src={src} alt={`QR pass for access code ${code}`} width={176} height={176} className="rounded-lg border border-border bg-white p-1" />
      <p className="text-[11px] text-muted-foreground">Show this QR to the guard at the gate</p>
    </div>
  );
}

// ── Invite Form ───────────────────────────────────────────────────────────────

function InviteForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    visitorName: "", visitorEmail: "", visitorPhone: "",
    visitPurpose: "", expectedArrival: "", expectedDeparture: "",
    vehiclePlate: "",
  });
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const invite = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/tenant/invite-visitor", {
        method: "POST",
        data: form,
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
      return r.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Visitor invited!",
        description: data.emailSent
          ? `Access code ${data.accessCode} emailed to ${form.visitorEmail}`
          : form.visitorEmail.trim()
            ? `Access code ${data.accessCode} is ready, but the email could not be sent — open the visit below to share the QR or code yourself.`
            : `Access code ${data.accessCode} is ready — open the visit below to send it to your guest on WhatsApp.`,
      });
      setForm({ visitorName: "", visitorEmail: "", visitorPhone: "", visitPurpose: "", expectedArrival: "", expectedDeparture: "", vehiclePlate: "" });
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Failed to invite", description: e.message, variant: "destructive" }),
  });

  // The guest needs somewhere to receive the pass: an email OR a phone number (WhatsApp works fine without email).
  const canSubmit = form.visitorName.trim() && (form.visitorEmail.trim() || form.visitorPhone.trim()) && form.visitPurpose.trim() && form.expectedArrival;

  return (
    <Card className="rounded-2xl border-border shadow-none">
      <button
        className="w-full flex items-center justify-between p-5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">Invite a Visitor</p>
            <p className="text-xs text-muted-foreground">Send an access code to your guest</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <CardContent className="pt-0 space-y-4 border-t border-border">
          <div className="grid grid-cols-2 gap-3 pt-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Visitor Full Name *</Label>
              <Input placeholder="e.g. Jane Wanjiru" value={form.visitorName} onChange={e => set({ visitorName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="font-normal text-muted-foreground">(code is emailed here)</span></Label>
              <Input type="email" placeholder="visitor@email.com" value={form.visitorEmail} onChange={e => set({ visitorEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone / WhatsApp <span className="font-normal text-muted-foreground">(email or phone is required)</span></Label>
              <Input type="tel" placeholder="07XX XXX XXX" value={form.visitorPhone} onChange={e => set({ visitorPhone: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Purpose of Visit *</Label>
              <Input placeholder="e.g. Personal visit, Delivery, Viewing" value={form.visitPurpose} onChange={e => set({ visitPurpose: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expected Arrival *</Label>
              <Input type="datetime-local" value={form.expectedArrival} onChange={e => set({ expectedArrival: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expected Departure</Label>
              <Input type="datetime-local" value={form.expectedDeparture} onChange={e => set({ expectedDeparture: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Vehicle Plate (if driving)</Label>
              <Input
                placeholder="e.g. KDA 123A"
                className="font-mono uppercase"
                value={form.vehiclePlate}
                onChange={e => set({ vehiclePlate: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={!canSubmit || invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending invite…</>
              : <><UserPlus className="w-4 h-4 mr-2" /> Send Visitor Invite</>}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// ── Visitor Card ──────────────────────────────────────────────────────────────

function VisitorCard({ visitor, onCancel }: { visitor: Visitor; onCancel: (id: number) => void }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const StatusIcon = STATUS_ICON[visitor.status] ?? Clock;

  const copyCode = () => {
    navigator.clipboard.writeText(visitor.accessCode);
    toast({ title: "Access code copied!", description: visitor.accessCode });
  };

  const active = visitor.status === "pending" || visitor.status === "approved";
  const canCancel = active; // the server allows cancelling any invite that has not been checked in yet

  const shareText = `Hi ${visitor.visitorName}, your access code for ${fmtDate(visitor.expectedArrival)} is ${visitor.accessCode}. Show it (or its QR code) to the guard at the gate.`;
  const phoneDigits = (visitor.visitorPhone ?? "").replace(/[^\d]/g, "").replace(/^0/, "254");
  const whatsappUrl = `https://wa.me/${phoneDigits}?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="rounded-xl border border-border hover:border-primary/20 transition-all">
      {/* Summary row */}
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="font-semibold text-sm">{visitor.visitorName}</p>
            <Badge className={`text-[11px] px-2 py-0 shrink-0 ${STATUS_STYLE[visitor.status] ?? STATUS_STYLE.pending}`}>
              <StatusIcon className="w-2.5 h-2.5 mr-1 inline" />
              {STATUS_LABEL[visitor.status] ?? visitor.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{visitor.purposeOfVisit}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <Calendar className="w-3 h-3" /> {fmtShort(visitor.expectedArrival)}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { icon: Calendar, label: "Expected arrival", value: fmtDate(visitor.expectedArrival) },
              { icon: Calendar, label: "Expected departure", value: fmtDate(visitor.expectedDeparture) },
              { icon: CheckCircle2, label: "Actual arrival", value: fmtDate(visitor.actualArrival) },
              { icon: CheckCircle2, label: "Actual departure", value: fmtDate(visitor.actualDeparture) },
              ...(visitor.visitorEmail ? [{ icon: Mail, label: "Email", value: visitor.visitorEmail }] : []),
              ...(visitor.visitorPhone ? [{ icon: Phone, label: "Phone", value: visitor.visitorPhone }] : []),
              ...(visitor.vehiclePlate ? [{ icon: Car, label: "Vehicle", value: visitor.vehiclePlate }] : []),
              ...(visitor.parkingSpot ? [{ icon: Car, label: "Parking spot", value: visitor.parkingSpot }] : []),
            ].map(row => {
              const Icon = row.icon;
              return (
                <div key={row.label}>
                  <p className="text-muted-foreground flex items-center gap-1"><Icon className="w-3 h-3" /> {row.label}</p>
                  <p className="font-medium text-foreground mt-0.5">{row.value}</p>
                </div>
              );
            })}
          </div>

          {/* Access code */}
          <div className="flex items-center justify-between bg-muted/60 rounded-lg px-3 py-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Access Code</p>
              <p className="font-mono font-bold text-base tracking-widest">{visitor.accessCode}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={copyCode}>
              <Copy className="w-3 h-3" /> Copy
            </Button>
          </div>

          {active && <AccessQr code={visitor.accessCode} />}
          {active && (
            <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5" asChild>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon className="w-3 h-3" /> Send code on WhatsApp
              </a>
            </Button>
          )}

          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => onCancel(visitor.id)}
            >
              <Ban className="w-3 h-3 mr-1.5" /> Cancel Invite
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function TenantVisitorPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: raw, isLoading, refetch } = useQuery<Visitor[]>({
    queryKey: ["/api/tenant/my-visitors"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenant/my-visitors");
      return ensureArray(await r.json());
    },
    staleTime: 60 * 1000,
  });
  const visitors: Visitor[] = raw ?? [];

  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/tenant/invite-visitor/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/my-visitors"] });
      toast({ title: "Invite cancelled" });
    },
    onError: (e: any) => toast({ title: "Failed to cancel", description: e.message, variant: "destructive" }),
  });

  // Stats
  const total = visitors.length;
  const pending = visitors.filter(v => v.status === "pending" || v.status === "approved").length;
  const arrived = visitors.filter(v => v.status === "checked_in" || v.status === "checked_out").length;

  // Filter
  const filtered = visitors.filter(v => {
    const matchSearch = !search || v.visitorName.toLowerCase().includes(search.toLowerCase()) || v.accessCode.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-5">
      {/* Invite form */}
      <InviteForm onSuccess={() => refetch()} />

      {/* History */}
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <QrCode className="w-4 h-4 text-blue-500" /> Visitor History
              </CardTitle>
              <CardDescription>All visitors you have ever invited</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats strip */}
          {total > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Visitors", value: total, cls: "text-foreground", bg: "bg-muted" },
                { label: "Pending", value: pending, cls: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/40" },
                { label: "Visited", value: arrived, cls: "text-green-600", bg: "bg-green-50 dark:bg-green-950/40" },
              ].map(s => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center border border-border`}>
                  <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Search + filter */}
          {total > 0 && (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  className="pl-9 h-9 text-sm"
                  placeholder="Name or code…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-9 rounded-lg border border-input bg-background text-sm px-3 text-foreground"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                {["all", "pending", "checked_in", "checked_out", "denied", "expired"].map(s => (
                  <option key={s} value={s}>{s === "all" ? "All statuses" : STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          )}

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-10">
              <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading visitors…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                <User className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {total === 0 ? "No visitors yet" : "No visitors match your filter"}
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                {total === 0
                  ? "Use the form above to invite your first visitor. They'll receive an access code by email."
                  : "Try clearing the search or changing the status filter."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(v => (
                <VisitorCard key={v.id} visitor={v} onCancel={(id) => cancel.mutate(id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}