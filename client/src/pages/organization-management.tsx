import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PaymentConfigPanel from "@/components/payment-config-panel";
import UserInviteModal from "@/components/user-invite-modal";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Building2, Users, Settings, Palette, CreditCard,
  Shield, Globe, Bell, Mail, MessageSquare,
  TrendingUp, CheckCircle2, XCircle, Clock, AlertTriangle,
  RefreshCw, Zap, ExternalLink, ChevronRight, ChevronLeft, Loader2,
  Search, Filter, FileText, CalendarDays, Send, ToggleLeft, ToggleRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


/** apiRequest already throws on a non-2xx response, with the raw response TEXT as e.message —
 *  so a JSON error body like {"message":"..."} would otherwise show up as a literal JSON blob
 *  in a toast. This pulls the real message out, and falls back to the raw text if it isn't JSON. */
function errMsg(e: any): string {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
}

/* ─── Backend types (matching real API responses) ───────────────────────────── */

interface BillingPlan {
  id: string;
  name: string;
  priceKes: number;
  maxProperties: number | null;
  maxUsers: number | null;
  features: string[];
  featureFlags?: Record<string, boolean>;
}

interface BillingStatus {
  subscriptionPlan: string;
  subscriptionStatus: string;
  maxProperties: number | null;   // null = unlimited
  maxUnits: number | null;
  maxUsers: number | null;
  usage?: { properties: number; units: number; users: number };
  planDetails: BillingPlan | null;
}

interface OrgUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
}

interface OrgProperty {
  id: number;
  name: string;
  address?: string;
  status?: string;
  createdAt?: string;
}

interface DashboardMetrics {
  totalRevenue: number;
  occupiedUnits: number;
  totalUnits: number;
  pendingRequests: number;
  overdueRent: number;
  totalProperties: number;
  runningProjects: number;
  completedTasksRate: number;
}

interface Role {
  id: number;
  roleName: string;
  roleDescription: string;
  permissions: Record<string, boolean>;
  isActive: boolean;
  updatedAt: string;
}

/* ─── Status / plan display helpers ─────────────────────────────────────────── */

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  trial:     { label: "Trial",     color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200" ,         icon: <Clock className="h-3 w-3" /> },
  active:    { label: "Active",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200" , icon: <CheckCircle2 className="h-3 w-3" /> },
  past_due:  { label: "Past Due",  color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border-amber-200" ,       icon: <AlertTriangle className="h-3 w-3" /> },
  suspended: { label: "Suspended", color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 border-red-200" ,             icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", color: "bg-muted text-muted-foreground border-border",       icon: <XCircle className="h-3 w-3" /> },
};

const PLAN_COLOR: Record<string, string> = {
  starter:    "bg-slate-100 text-muted-foreground border-slate-200" ,
  growth:     "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200" ,
  enterprise: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 border-violet-200" ,
};

/* ─── Small reusable components ─────────────────────────────────────────────── */

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct   = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{used} / {max}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Branding Settings (persisted locally — no branding endpoint exists) ───── */

function BrandingTab({ billingStatus }: { billingStatus: BillingStatus | undefined }) {
  const [primaryColor,   setPrimaryColor]   = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#EF4444");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const { toast } = useToast();

  // What a plan switches on is set by the platform admin (plan feature flags); the old plan ids are the fallback.
  const flags = billingStatus?.planDetails?.featureFlags;
  const isEnterprise = flags?.customDomain ?? billingStatus?.subscriptionPlan === "enterprise";
  const isGrowthPlus = flags?.whiteLabel ?? ["growth", "enterprise"].includes(billingStatus?.subscriptionPlan ?? "");

  // Load existing colours from the server on mount
  useEffect(() => {
    apiRequest("/api/organizations/current")
      .then(r => r.json())
      .then((org: any) => {
        if (org?.primaryColor)   setPrimaryColor(org.primaryColor);
        if (org?.secondaryColor) setSecondaryColor(org.secondaryColor);
      })
      .catch(() => { /* fallback to defaults is fine */ });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("/api/organizations/branding", {
        method: "PATCH",
        data: { primaryColor, secondaryColor },
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: "Brand colours saved", description: "Changes will appear in tenant-facing emails and portals." });
    } catch {
      toast({ title: "Could not save colours", description: "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Brand colours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" /> Brand Colors</CardTitle>
          <CardDescription>Applied to emails and the tenant portal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-6">
            {[
              { label: "Primary Color",   value: primaryColor,   set: setPrimaryColor },
              { label: "Secondary Color", value: secondaryColor, set: setSecondaryColor },
            ].map(c => (
              <div key={c.label} className="space-y-1.5">
                <Label>{c.label}</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={c.value} onChange={e => c.set(e.target.value)}
                    className="w-10 h-10 rounded-md border cursor-pointer" />
                  <Input value={c.value} onChange={e => c.set(e.target.value)} className="font-mono text-sm" />
                </div>
              </div>
            ))}
          </div>
          {/* Live preview */}
          <div className="p-4 rounded-lg border" style={{ borderColor: primaryColor + "40" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: primaryColor }}>SP</div>
              <div>
                <p className="font-semibold text-sm" style={{ color: primaryColor }}>SmartProp</p>
                <p className="text-xs text-muted-foreground">Preview of your brand</p>
              </div>
              <span className="ml-auto px-2 py-1 rounded text-xs text-white font-medium"
                style={{ backgroundColor: secondaryColor }}>Badge</span>
            </div>
          </div>
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="h-4 w-4 mr-2" /> Saved!</> : "Save Colors"}
          </Button>
        </CardContent>
      </Card>

      {/* Custom domain — enterprise only */}
      <Card className={!isEnterprise ? "opacity-60" : ""}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" /> Custom Domain
            {!isEnterprise && <Badge variant="outline" className="ml-2 text-xs">Enterprise only</Badge>}
          </CardTitle>
          <CardDescription>Host SmartProp on your own domain.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input disabled={!isEnterprise} placeholder="properties.yourcompany.com" />
            <Button disabled={!isEnterprise} variant="outline">Verify</Button>
          </div>
        </CardContent>
      </Card>

      {/* White-label */}
      <Card className={!isGrowthPlus ? "opacity-60" : ""}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> White-Label
            {!isGrowthPlus && <Badge variant="outline" className="ml-2 text-xs">Growth+ only</Badge>}
          </CardTitle>
          <CardDescription>Remove SmartProp branding from tenant-facing interfaces.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Hide SmartProp branding</p>
              <p className="text-xs text-muted-foreground">Tenants will only see your brand name</p>
            </div>
            <Switch disabled={!isGrowthPlus} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Shared table-control hook ─────────────────────────────────────────────── */

function useTableControls<T>(
  items: T[],
  filterFn: (item: T, q: string) => boolean,
  defaultPageSize = 10,
) {
  const [query,    setQuery]    = React.useState("");
  const [pageSize, setPageSize] = React.useState(defaultPageSize);
  const [page,     setPage]     = React.useState(1);

  const filtered = React.useMemo(
    () => (query.trim() ? items.filter(i => filterFn(i, query.toLowerCase())) : items),
    [items, query],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paged      = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  React.useEffect(() => { setPage(1); }, [query, pageSize]);

  return { query, setQuery, pageSize, setPageSize, page: safePage, setPage, filtered, paged, totalPages };
}

/* ─── Pagination bar ─────────────────────────────────────────────────────────── */

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

function PaginationBar({
  page, totalPages, pageSize, setPage, setPageSize, totalItems, shownItems, noun = "rows",
}: {
  page: number; totalPages: number; pageSize: number;
  setPage: (p: number) => void; setPageSize: (s: number) => void;
  totalItems: number; shownItems: number; noun?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Rows per page</span>
        <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
          <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map(s => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>· {shownItems} of {totalItems} {noun}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
          disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">Page {page} of {totalPages}</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
          disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */

// ── Notifications Tab ─────────────────────────────────────────────────────────
// Fully wired: loads preferences from PATCH /api/notifications/preferences,
// persists every toggle change immediately so what's set is what actually fires.

interface NotifPrefs {
  inAppNotifications:    boolean;
  maintenanceUpdates:    boolean;
  securityAlerts:        boolean;
  paymentReminders:      boolean;
  whatsappNotifications: boolean;
  rentDueWarningDays:    number;
  marketingEmails:       boolean;
  weeklyDigest:          boolean;
  featureAnnouncements:  boolean;
  frequency:             "immediate" | "daily" | "weekly" | "monthly";
  quietHours: { enabled: boolean; start: string; end: string };
}

const DEFAULT_PREFS: NotifPrefs = {
  inAppNotifications:    true,
  maintenanceUpdates:    true,
  securityAlerts:        true,
  paymentReminders:      true,
  whatsappNotifications: true,
  rentDueWarningDays:    3,
  marketingEmails:       false,
  weeklyDigest:          false,
  featureAnnouncements:  true,
  frequency:             "immediate",
  quietHours:            { enabled: true, start: "21:00", end: "07:00" },
};

function NotificationsTab({ activeTab }: { activeTab: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["/api/notifications/preferences"],
    queryFn: async () => {
      const r = await apiRequest("/api/notifications/preferences");
      return r.json();
    },
    enabled: activeTab === "notifications",
  });

  const saveMut = useMutation({
    mutationFn: async (patch: Partial<NotifPrefs>) => {
      const r = await apiRequest("/api/notifications/preferences", { method: "PATCH", data: patch });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (e: any) =>
      toast({ title: "Could not save preferences", description: errMsg(e), variant: "destructive" }),
  });

  const digestNow = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/notifications/digest-now", { method: "POST", data: {} });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Could not send the summary");
      return r.json();
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast(d.delivered ? { title: "Summary sent to your bell", description: d.message } : { title: "Summary not delivered", description: "In-app notifications are switched off for you." });
    },
    onError: (e: any) => toast({ title: "Could not send the summary", description: errMsg(e), variant: "destructive" }),
  });

  if (activeTab !== "notifications") return null;

  if (isLoading) {
    return (
      <div className="h-40 flex items-center justify-center">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const p: NotifPrefs = prefs ?? DEFAULT_PREFS;

  // Helper: toggle one boolean key and persist immediately
  const toggle = (key: keyof NotifPrefs) => {
    const newVal = !p[key];
    saveMut.mutate({ [key]: newVal });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900">
        <Bell className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          These are <strong>your own</strong> alert preferences for this account — not an organisation-wide policy, and they
          don't change what tenants or other staff receive. Every switch on this page is live: in-app switches decide
          which notifications appear in your bell, WhatsApp/email opt-outs apply to messages sent to you, and the summary digest is
          delivered at 07:00 EAT.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

      {/* ── In-App / Real-time ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> In-App Notifications
          </CardTitle>
          <CardDescription>Choose which alerts appear in your notification bell</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "maintenanceUpdates",   label: "Maintenance Updates",   desc: "Maintenance status changes" },
            { key: "paymentReminders",     label: "Payment Confirmations", desc: "Rent payments confirmed" },
            { key: "inAppNotifications",   label: "All in-app notifications", desc: "Master switch — turn off to stop every in-app notification, including messages" },
            { key: "securityAlerts",       label: "Security Alerts",       desc: "Visitor check-ins, gate events, security incidents" },
            { key: "featureAnnouncements", label: "System Announcements",  desc: "Updates about SmartProp features (applies to announcements as they are published)" },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                checked={!!p[key as keyof NotifPrefs]}
                disabled={saveMut.isPending}
                onCheckedChange={() => toggle(key as keyof NotifPrefs)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── WhatsApp / Email ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> WhatsApp & Email
          </CardTitle>
          <CardDescription>Channel preferences for outbound notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "whatsappNotifications", label: "WhatsApp Alerts",  desc: "Receive WhatsApp messages from SmartProp" },
            { key: "weeklyDigest",          label: "Portfolio summary digest", desc: "An in-app summary at 07:00 EAT: overdue rent, open maintenance, leases ending soon (admins and managers)" },
            { key: "marketingEmails",       label: "Product news emails", desc: "Occasional product updates by email" },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                checked={!!p[key as keyof NotifPrefs]}
                disabled={saveMut.isPending}
                onCheckedChange={() => toggle(key as keyof NotifPrefs)}
              />
            </div>
          ))}

          {/* Delivery frequency */}
          <div className="pt-2 space-y-1.5">
            <p className="text-sm font-medium">Summary digest cadence</p>
            <p className="text-xs text-muted-foreground mb-1.5">"Daily" sends the summary every morning; anything else sends it on Mondays</p>
            <Select
              value={p.frequency === "daily" ? "daily" : "weekly"}
              onValueChange={v => saveMut.mutate({ frequency: v as NotifPrefs["frequency"] })}
              disabled={saveMut.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                <SelectItem value="daily">Every day</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => digestNow.mutate()} disabled={digestNow.isPending}>
              Send me the summary now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Quiet Hours ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Quiet Hours
          </CardTitle>
          <CardDescription>
            Saved here, but WhatsApp delivery currently always pauses 21:00–07:00 EAT regardless of this setting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable quiet hours</p>
              <p className="text-xs text-muted-foreground">Non-critical alerts are held until quiet period ends</p>
            </div>
            <Switch
              checked={p.quietHours?.enabled ?? true}
              disabled={saveMut.isPending}
              onCheckedChange={v =>
                saveMut.mutate({ quietHours: { ...p.quietHours, enabled: v } })
              }
            />
          </div>
          <div className={`grid grid-cols-2 gap-3 transition-opacity ${p.quietHours?.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <div className="space-y-1.5">
              <Label className="text-xs">Start time</Label>
              <Input
                type="time"
                value={p.quietHours?.start ?? "21:00"}
                onChange={e =>
                  saveMut.mutate({ quietHours: { ...p.quietHours, start: e.target.value } })
                }
                disabled={saveMut.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End time</Label>
              <Input
                type="time"
                value={p.quietHours?.end ?? "07:00"}
                onChange={e =>
                  saveMut.mutate({ quietHours: { ...p.quietHours, end: e.target.value } })
                }
                disabled={saveMut.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      </div>
    </div>
  );
}
// Note: a "days before rent is due" reminder setting used to live here, but it edited THIS
// account's own preference row — meaningless for an admin/manager, since rent reminders are
// sent using each TENANT's own preference. That control already exists, correctly scoped, in
// the tenant's own portal (see tenant-portal.tsx), so it was removed from here rather than left
// as a decoy that looked like an org-wide policy setting but silently did nothing.

// ── Report Delivery Panel ──────────────────────────────────────────────────────
// Standalone component so it keeps its own query state cleanly.

function ReportDeliveryPanel({ activeTab }: { activeTab: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/report-schedule"],
    queryFn: async () => {
      const res = await apiRequest("/api/report-schedule");
      return res.json();
    },
    enabled: activeTab === "reports",
  });

  const schedule = data?.reportSchedule ?? { enabled: false, dayOfMonth: 5 };

  const saveMut = useMutation({
    mutationFn: async (payload: { enabled: boolean; dayOfMonth: number }) => {
      const res = await apiRequest("/api/report-schedule", { method: "PUT", data: payload });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/report-schedule"] });
      toast({ title: "Report schedule saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: errMsg(e), variant: "destructive" }),
  });

  const sendNowMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/report-schedule/send-now", { method: "POST" });
      return res.json();
    },
    // The server already tells us exactly what will happen (how many properties, or why it can't
    // run) — showing a generic "queued" message regardless hid that, including outright failures
    // like "no PM agreement yet" that used to surface as a false success.
    onSuccess: (data: any) => toast({ title: "Sending statements", description: data?.message }),
    onError: (e: any) => toast({ title: "Couldn't send statements", description: errMsg(e), variant: "destructive" }),
  });

  if (activeTab !== "reports") return null;

  return (
    <div className="mt-4 space-y-4">
      {/* Main toggle card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Automated Owner Statement Emails
          </CardTitle>
          <CardDescription>
            Automatically email each landlord a formatted monthly statement for their property on the chosen day of each month. Uses the existing owner statement data — no extra setup needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Enable toggle */}
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <p className="font-medium">Enable monthly statement emails</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {schedule.enabled
                      ? `Active — statements sent on the ${schedule.dayOfMonth}${schedule.dayOfMonth === 1 ? "st" : schedule.dayOfMonth === 2 ? "nd" : schedule.dayOfMonth === 3 ? "rd" : "th"} of each month`
                      : "Disabled — landlords receive no automated reports"}
                  </p>
                </div>
                <Switch
                  checked={schedule.enabled}
                  onCheckedChange={v =>
                    saveMut.mutate({ enabled: v, dayOfMonth: schedule.dayOfMonth ?? 5 })
                  }
                  disabled={saveMut.isPending}
                />
              </div>

              {/* Day-of-month selector */}
              <div className={`space-y-2 transition-opacity ${schedule.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                <Label className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" /> Send on day of month
                </Label>
                <div className="flex items-center gap-3">
                  <Select
                    value={String(schedule.dayOfMonth ?? 5)}
                    onValueChange={v =>
                      saveMut.mutate({ enabled: schedule.enabled, dayOfMonth: parseInt(v) })
                    }
                    disabled={saveMut.isPending}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,7,8,9,10,12,15,20,25,28].map(d => (
                        <SelectItem key={d} value={String(d)}>
                          {d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"} of the month
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Reports cover the previous calendar month
                  </p>
                </div>
              </div>

              {/* What's included */}
              <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4 space-y-2">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">What each email includes</p>
                <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                  {[
                    "Gross rent collected & breakdown by unit/tenant",
                    "PM management fee deduction",
                    "Maintenance, utility and insurance deductions",
                    "Net amount payable to the owner",
                    "Full itemised expense list",
                    "Statement number for accounting reference",
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Requirements note */}
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4 space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Requirements
                </p>
                <ul className="text-sm text-amber-800 dark:text-amber-300 space-y-0.5 mt-1">
                  <li>• Each property must have an active PM Agreement (set in Owner Statements → Agreements)</li>
                  <li>• The property owner must be linked as a user with a valid email address</li>
                  <li>• <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-xs">RESEND_API_KEY</code> and <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-xs">FROM_EMAIL</code> must be configured on the server</li>
                </ul>
              </div>

              {/* Send now */}
              <div className="pt-2 border-t flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-medium">Send statements now</p>
                  <p className="text-xs text-muted-foreground">Immediately email last month's statement to all eligible landlords in this organisation</p>
                </div>
                <Button
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  disabled={sendNowMut.isPending}
                  onClick={() => sendNowMut.mutate()}
                >
                  {sendNowMut.isPending
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />
                  }
                  Send Now
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OrganizationManagement() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const [activeTab,      setActiveTab]      = useState("team");
  const [roleFilter,     setRoleFilter]     = useState("all"); // for Team tab role filter

  const { toast }        = useToast();
  const queryClient      = useQueryClient();

  /* ── Data fetching from real endpoints ─────────────────────────────────── */

  const { data: billingStatus, isLoading: loadingBilling } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    queryFn:  async () => {
      const r = await apiRequest("/api/billing/status");
      return r.json();
    },
    // Billing is admin-only on the server; managers would just get a 403.
    enabled:  user?.role === "admin" || user?.role === "platform_admin",
    retry:    false,
  });

  const { data: properties = [] } = useQuery<OrgProperty[]>({
    queryKey: ["/api/properties"],
    queryFn:  async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
    queryFn:  async () => {
      const r = await apiRequest("/api/users");
      return ensureArray(await r.json());
    },
  });

  /* ── Derived values ─────────────────────────────────────────────────────── */

  const isLoading = loadingBilling || loadingUsers;

  // Team tab controls
  const teamControls = useTableControls<OrgUser>(
    users,
    (u, q) =>
      u.email.toLowerCase().includes(q) ||
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q),
    10,
  );

  // Apply role filter on top of search
  // Roles to offer in the Team tab's filter — every role actually present, not just invitable
  // ones (a tenant or caretaker login could show up here too), sorted for a stable order.
  const teamRoleOptions = Array.from(new Set(users.map(u => u.role))).sort();

  const teamFiltered = roleFilter === "all"
    ? teamControls.filtered
    : teamControls.filtered.filter(u => u.role === roleFilter);
  const teamTotalPages = Math.max(1, Math.ceil(teamFiltered.length / teamControls.pageSize));
  const teamSafePage   = Math.min(teamControls.page, teamTotalPages);
  const teamPaged      = teamFiltered.slice((teamSafePage - 1) * teamControls.pageSize, teamSafePage * teamControls.pageSize);

  /* ── Full-page loading ──────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground">Loading your organization…</p>
        </div>
      </div>
    );
  }

  /* ── Page ───────────────────────────────────────────────────────────────── */
  return (
    <PageShell>
      <PageHeader
        title="Organization"
        subtitle="Manage team access, roles, notification preferences, and payment settings."
        icon={<Building2 className="w-5 h-5" />}
      />

      <StatsGrid cols={2}>
        <StatTile label="Team Members" value={users.length} icon={<Users className="w-4 h-4" />} accent="violet" />
        <StatTile label="Properties" value={properties.length} icon={<Building2 className="w-4 h-4" />} accent="blue" />
      </StatsGrid>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-0">
          {[
            // Overview (Setup & Profile) commented out — sensitive install info
            // { value: "overview",      label: "Setup & Profile",   icon: Building2 },
            { value: "team",          label: "Team",              icon: Users },
            // Branding commented out — not needed in per-property install phase
            // { value: "branding",      label: "Branding",          icon: Palette },
            // Roles & Perms commented out — full page exists at Settings → Users & Roles
            // { value: "roles",         label: "Roles & Perms",     icon: Shield },
            // Subscription commented out — plan management lives at /billing
            // { value: "subscription",  label: "Subscription",   icon: CreditCard },
            { value: "notifications", label: "Notifications",     icon: Bell },
            { value: "payment",       label: "Payment Setup",     icon: CreditCard },
            { value: "reports",       label: "Report Delivery",   icon: Mail },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Setup & Profile tab — commented out (sensitive install info) ──── */}
        {/* <TabsContent value="overview" className="mt-4 space-y-4"> ... </TabsContent> */}

        {/* ── Team ─────────────────────────────────────────────────────────── */}
        <TabsContent value="team" className="mt-4 space-y-4">
          {/* Toolbar */}
          <FilterBar
            search={teamControls.query}
            onSearch={teamControls.setQuery}
            placeholder="Search by name, email, or role…"
            filters={
              <Select value={roleFilter} onValueChange={v => { setRoleFilter(v); }}>
                <SelectTrigger className="w-48">
                  <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {teamRoleOptions.map(r => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            actions={<UserInviteModal triggerText="Invite Member" />}
          />

          {/* Capacity warning */}
          {billingStatus && billingStatus.maxUsers != null && (billingStatus.usage?.users ?? users.length) >= billingStatus.maxUsers && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              You've reached your user limit. Upgrade your plan to invite more team members.
            </div>
          )}

          <SectionCard padding="none">
            {loadingUsers ? (
              <div className="h-40 flex items-center justify-center">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : users.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No team members yet"
                description="Invite your first colleague to get started."
                size="lg"
              />
            ) : teamPaged.length === 0 ? (
              <EmptyState icon={<Search />} title="No members match your search" size="lg" />
            ) : (
              <>
                <SPTable
                  data={teamPaged}
                  columns={[
                    {
                      header: "Member",
                      cell: (u: OrgUser) => (
                        <div className="flex items-center gap-3 min-w-0">
                          <SPAvatar name={u.firstName || u.lastName ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : u.email} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight break-words">
                              {u.firstName || u.lastName
                                ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                                : u.email}
                            </p>
                            <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 sm:hidden">
                              <Badge variant="outline" className="text-[11px] capitalize whitespace-nowrap">{u.role.replace(/_/g, " ")}</Badge>
                              <SPBadge status={u.emailVerified ? "verified" : "pending"} />
                            </div>
                          </div>
                        </div>
                      ),
                    },
                    {
                      header: "Role",
                      hideOnMobile: true,
                      cell: (u: OrgUser) => <Badge variant="outline" className="text-xs capitalize">{u.role.replace(/_/g, " ")}</Badge>,
                    },
                    {
                      header: "Verified",
                      hideOnMobile: true,
                      cell: (u: OrgUser) => <SPBadge status={u.emailVerified ? "verified" : "pending"} />,
                    },
                    {
                      header: "Last Login",
                      hideOnMobile: true,
                      cell: (u: OrgUser) => (
                        <span className="text-sm text-muted-foreground">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Never"}
                        </span>
                      ),
                    },
                    {
                      header: "Joined",
                      hideOnMobile: true,
                      cell: (u: OrgUser) => (
                        <span className="text-sm text-muted-foreground">
                          {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      ),
                    },
                  ]}
                />
                <PaginationBar
                  page={teamSafePage}
                  totalPages={teamTotalPages}
                  pageSize={teamControls.pageSize}
                  setPage={teamControls.setPage}
                  setPageSize={teamControls.setPageSize}
                  totalItems={teamFiltered.length}
                  shownItems={teamPaged.length}
                  noun="members"
                />
              </>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Branding ─────────────────────────────────────────────────────── */}
        {/* ── Branding tab — commented out (not needed in per-property install phase) */}
        {/* <TabsContent value="branding" className="mt-4">
              <BrandingTab billingStatus={billingStatus} />
            </TabsContent> */}

        {/* Roles & Perms tab commented out — full page at Settings → Users & Roles (/user-management) */}

                {/* ── Subscription tab commented out ────────────────────────────────── */}
        {/*
         * Subscription / plan management has been moved to Settings → Billing
         * (/billing). It is NOT shown here to avoid duplication.
         * The full plan picker, current plan price, M-Pesa checkout flow, and
         * usage limits are all available on the Billing page.
         *
         * <TabsContent value="subscription" className="mt-4 space-y-4">
         *   … plan cards & checkout …
         * </TabsContent>
         */}

        {/* ── Notifications ─────────────────────────────────────────────────── */}
        <TabsContent value="payment" className="mt-4">
          <PaymentConfigPanel />
        </TabsContent>

        {/* Report Delivery — content rendered by ReportDeliveryPanel below Tabs */}
        <TabsContent value="reports" className="mt-0" />

        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab activeTab={activeTab} />
        </TabsContent>
      </Tabs>

      {/* Report Delivery Panel — rendered outside Tabs so it can use its own hooks cleanly */}
      <ReportDeliveryPanel activeTab={activeTab} />
    </PageShell>
  );
}