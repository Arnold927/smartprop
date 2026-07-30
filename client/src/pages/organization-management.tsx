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
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Building2, Users, Settings, Palette, CreditCard, Plus,
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


/* ─── Backend types (matching real API responses) ───────────────────────────── */

interface BillingPlan {
  id: "starter" | "growth" | "enterprise";
  name: string;
  priceKes: number;
  maxProperties: number;
  maxUsers: number;
  features: string[];
}

interface BillingStatus {
  subscriptionPlan: string;
  subscriptionStatus: string;
  maxProperties: number;
  maxUsers: number;
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
  trial:     { label: "Trial",     color: "bg-blue-100 text-blue-700 border-blue-200" ,         icon: <Clock className="h-3 w-3" /> },
  active:    { label: "Active",    color: "bg-emerald-100 text-emerald-700 border-emerald-200" , icon: <CheckCircle2 className="h-3 w-3" /> },
  past_due:  { label: "Past Due",  color: "bg-amber-100 text-amber-700 border-amber-200" ,       icon: <AlertTriangle className="h-3 w-3" /> },
  suspended: { label: "Suspended", color: "bg-red-100 text-red-700 border-red-200" ,             icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelled", color: "bg-muted text-muted-foreground border-border",       icon: <XCircle className="h-3 w-3" /> },
};

const PLAN_COLOR: Record<string, string> = {
  starter:    "bg-slate-100 text-slate-700 border-slate-200" ,
  growth:     "bg-blue-100 text-blue-700 border-blue-200" ,
  enterprise: "bg-violet-100 text-violet-700 border-violet-200" ,
};

/* ─── Small reusable components ─────────────────────────────────────────────── */

function StatCard({
  title, value, subtitle, icon: Icon, color = "blue",
}: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; color?: string;
}) {
  const colorMap: Record<string, string> = {
    blue:   "text-blue-600 bg-blue-50",
    green:  "text-emerald-600 bg-emerald-50",
    amber:  "text-amber-600 bg-amber-50",
    red:    "text-red-600 bg-red-50",
    violet: "text-violet-600 bg-violet-50",
    slate:  "text-slate-600 bg-slate-50",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className={`p-2.5 rounded-lg ${colorMap[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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

/* ─── Invite User Dialog ─────────────────────────────────────────────────────── */

// All invitable roles. Admin option is filtered out for non-admin users at render time.
const ROLE_OPTIONS = [
  { value: "admin",       label: "Admin" },
  { value: "manager",     label: "Property Manager" },
  { value: "landlord",    label: "Landlord" },
  { value: "staff",       label: "Staff" },
  { value: "caretaker",   label: "Caretaker" },
  { value: "guard",       label: "Guard" },
  { value: "tenant",      label: "Tenant" },
];

function InviteUserDialog({
  open, onOpenChange, onSubmit, isPending, currentUserRole,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (data: { email: string; role: string }) => void;
  isPending: boolean;
  currentUserRole?: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState("manager");
  // Only admins can invite other admins
  const visibleRoles = ROLE_OPTIONS.filter(r =>
    r.value !== "admin" || currentUserRole === "admin"
  );

  const handleSubmit = () => {
    if (!email) return;
    onSubmit({ email, role });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Invite Team Member
          </DialogTitle>
          <DialogDescription>
            An invitation email will be sent to the address below. The user clicks the link,
            sets their password, and their account is created automatically with the selected role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Email address <span className="text-red-500">*</span></Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {visibleRoles.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending || !email}>
              {isPending
                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                : "Send Invite"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Branding Settings (persisted locally — no branding endpoint exists) ───── */

function BrandingTab({ billingStatus }: { billingStatus: BillingStatus | undefined }) {
  const [primaryColor,   setPrimaryColor]   = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#EF4444");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const { toast } = useToast();

  const isEnterprise = billingStatus?.subscriptionPlan === "enterprise";
  const isGrowthPlus = ["growth", "enterprise"].includes(billingStatus?.subscriptionPlan ?? "");

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
          disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">Page {page} of {totalPages}</span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
          disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
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
      const r = await apiRequest("/api/notifications/preferences", {
        method: "PATCH",
        data: patch,
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Save failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (e: any) =>
      toast({ title: "Could not save preferences", description: e.message, variant: "destructive" }),
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl">

      {/* ── In-App / Real-time ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> In-App Notifications
          </CardTitle>
          <CardDescription>Live alerts that appear inside the app</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "maintenanceUpdates",   label: "Maintenance Updates",   desc: "Real-time alerts for maintenance status changes" },
            { key: "paymentReminders",     label: "Payment Confirmations", desc: "Notified when rent payments are confirmed" },
            { key: "inAppNotifications",   label: "New Tenant Messages",   desc: "Alerts for new tenant or contractor messages" },
            { key: "securityAlerts",       label: "Security Alerts",       desc: "Visitor check-ins, gate events, and security incidents" },
            { key: "featureAnnouncements", label: "System Announcements",  desc: "Important updates about SmartProp features" },
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
            { key: "whatsappNotifications", label: "WhatsApp Alerts",  desc: "Primary channel — payment reminders, maintenance, visitor notifications" },
            { key: "weeklyDigest",          label: "Weekly Email Digest", desc: "Weekly KPI summary sent every Monday morning" },
            { key: "marketingEmails",       label: "Marketing Emails",    desc: "Product tips, updates, and promotional communications" },
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
            <p className="text-sm font-medium">Non-urgent delivery frequency</p>
            <p className="text-xs text-muted-foreground mb-1.5">How often to batch non-urgent WhatsApp/email notifications</p>
            <Select
              value={p.frequency}
              onValueChange={v => saveMut.mutate({ frequency: v as NotifPrefs["frequency"] })}
              disabled={saveMut.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediately</SelectItem>
                <SelectItem value="daily">Daily digest</SelectItem>
                <SelectItem value="weekly">Weekly digest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Quiet Hours ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Quiet Hours
          </CardTitle>
          <CardDescription>Suppress non-urgent notifications during these hours</CardDescription>
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

      {/* ── Rent Due Warning ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> Rent Due Reminder
          </CardTitle>
          <CardDescription>How many days before rent is due should tenants be notified</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-xs">Days before due date</Label>
            <Select
              value={String(p.rentDueWarningDays ?? 3)}
              onValueChange={v => saveMut.mutate({ rentDueWarningDays: parseInt(v) })}
              disabled={saveMut.isPending}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 7, 10, 14].map(d => (
                  <SelectItem key={d} value={String(d)}>{d} day{d > 1 ? "s" : ""} before</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              Tenants receive a WhatsApp/in-app reminder this many days before rent is due.
            </p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

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
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/report-schedule"] });
      toast({ title: "Report schedule saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendNowMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/report-schedule/send-now", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => toast({ title: "Reports queued", description: "Owner statement emails will be sent within a few minutes." }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
              <div className="pt-2 border-t flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Send statements now</p>
                  <p className="text-xs text-muted-foreground">Immediately email last month's statement to all eligible landlords in this organisation</p>
                </div>
                <Button
                  variant="outline"
                  className="gap-1.5"
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
  const [isInviteOpen,   setIsInviteOpen]   = useState(false);
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
  });

  const { data: properties = [], isLoading: loadingProperties } = useQuery<OrgProperty[]>({
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

  /* ── Mutations ──────────────────────────────────────────────────────────── */

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      apiRequest("/api/users", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsInviteOpen(false);
      toast({ title: "Invite sent", description: "An invitation email has been dispatched." });
    },
    onError: (e: any) =>
      toast({ title: "Failed to send invite", description: e.message, variant: "destructive" }),
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
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organization</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage team access, roles, notification preferences, and payment settings.
          </p>
        </div>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-2 gap-3 max-w-lg">
        <StatCard
          title="Team Members"
          value={users.length}
          icon={Users}
          color="violet"
        />
        <StatCard
          title="Properties"
          value={properties.length}
          icon={Building2}
          color="blue"
        />
      </div>

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
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name, email, or role…"
                value={teamControls.query}
                onChange={e => teamControls.setQuery(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={v => { setRoleFilter(v); }}>
              <SelectTrigger className="w-48">
                <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLE_OPTIONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setIsInviteOpen(true)} size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-2" /> Invite Member
            </Button>
          </div>

          {/* Capacity warning */}
          {billingStatus && users.length >= billingStatus.maxUsers && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              You've reached your user limit. Upgrade your plan to invite more team members.
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              {loadingUsers ? (
                <div className="h-40 flex items-center justify-center">
                  <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : users.length === 0 ? (
                <div className="py-16 text-center">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">No team members yet</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">Invite your first colleague to get started.</p>
                  <Button size="sm" onClick={() => setIsInviteOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Invite Member
                  </Button>
                </div>
              ) : teamPaged.length === 0 ? (
                <div className="py-12 text-center">
                  <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No members match your search.</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Verified</TableHead>
                        <TableHead>Last Login</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamPaged.map(u => (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs shrink-0">
                                {(u.firstName?.[0] ?? u.email[0]).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium leading-tight">
                                  {u.firstName || u.lastName
                                    ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                                    : u.email}
                                </p>
                                <p className="text-xs text-muted-foreground">{u.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {u.role.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.emailVerified
                              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              : <Clock className="h-4 w-4 text-amber-500" />}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                              : "Never"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
            </CardContent>
          </Card>
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

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <InviteUserDialog
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        onSubmit={data => inviteMutation.mutate(data)}
        isPending={inviteMutation.isPending}
        currentUserRole={user?.role}
      />

      {/* Report Delivery Panel — rendered outside Tabs so it can use its own hooks cleanly */}
      <ReportDeliveryPanel activeTab={activeTab} />
    </div>
  );
}