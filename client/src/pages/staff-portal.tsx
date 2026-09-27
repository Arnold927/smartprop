/**
 * Staff Portal — /staff-portal
 *
 * Adapts its content based on the logged-in staff member's position/department:
 *
 *  MAINTENANCE (technician, maintenance_supervisor, groundskeeper, janitor, facilities_manager)
 *    → Work Orders assigned to them + technician notes + status updates
 *
 *  SECURITY (security_guard, concierge)
 *    → Today's visitor log + gate passes + vehicle log + incident quick-log
 *
 *  FINANCE / ACCOUNTS (accountant, accounts_receivable, accounts_payable)
 *    → Rent payment overview + arrears list + pending payment actions
 *
 *  LEASING / CRM (leasing_agent, customer_service, marketing_specialist)
 *    → Tenant list + unit availability + broadcast messages sent
 *
 *  ADMIN / HR / IT / MANAGEMENT (property_manager, hr_manager, it_specialist,
 *    administrative_assistant, portfolio_manager, regional_manager,
 *    compliance_officer, other)
 *    → Summary dashboard: occupancy + maintenance snapshot + recent payments + staff list
 *
 *  ALL roles also get: Messages tab + Profile tab
 *
 * Filtering:
 *   - Maintenance work orders: assignedTo === user.id OR technicianId === staffProfile.id
 *   - Messages: server already scopes to req.user.id (fromUserId / toUserId)
 *   - Everything else: org-scoped (existing APIs), shown as read-only view
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useDarkModeContext } from "@/context/DarkModeContext";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWsEvent } from "@/hooks/useWebSocket";
import { format, formatDistanceToNow, isToday, isPast, startOfDay, endOfDay } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { FirstRunOverlay, needsFirstRun, markFirstRunDone } from "@/components/first-run-overlay";
import {
  Wrench, CheckCircle2, Clock, User, MapPin, MessageSquare, Send, Loader2,
  RefreshCw, HardHat, Building, Calendar, ClipboardList, Droplets, Zap,
  Flame, Brush, Leaf, Shield, Key, Home, Play, Pause, Check, X,
  ChevronDown, ChevronUp, Inbox, ArrowUpRight, Info, Car, UserCheck,
  DollarSign, AlertTriangle, TrendingUp, Users, BarChart3, FileText,
  Bell, BellOff, Phone, Mail, Hash, Eye, Megaphone, Star, ShieldCheck, ParkingSquare,
  Receipt, ArrowDownRight, CircleDollarSign, Banknote, Search,
  Pencil, Lock, Save, XCircle, Trash2, Settings, CheckCheck,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};
const fmtTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "h:mm a"); } catch { return "—"; }
};
const timeAgo = (d: string | null | undefined) => {
  if (!d) return "—";
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return "—"; }
};
const fmtKES = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

// ─── Theme-aware surface classes ──────────────────────────────────────────────
// These map to CSS variables defined in index.css for light / gray / dark.
// Use these instead of hardcoded bg-white / bg-gray-50 / text-gray-* so the
// portal re-colours automatically when the user cycles the theme.

const S = {
  // Page background
  page:        "bg-background text-foreground",
  // Card / panel surface
  card:        "bg-card text-card-foreground border-border",
  // Slightly raised surface (inputs, inner panels)
  surface:     "bg-muted text-foreground",
  // Muted text
  muted:       "text-muted-foreground",
  // Input fields
  input:       "bg-background border-input text-foreground placeholder:text-muted-foreground",
  // Inline badge / chip backgrounds that need to stay legible across themes
  chip:        "bg-secondary text-secondary-foreground border-border",
  // Divider / border
  border:      "border-border",
  // Hover state for list rows
  hover:       "hover:bg-accent hover:text-accent-foreground",
};

// ─── Role detection ───────────────────────────────────────────────────────────

type StaffRole = "maintenance" | "security" | "finance" | "leasing" | "admin";

function detectRole(staffProfile: any, user: any): StaffRole {
  const pos = (staffProfile?.position ?? user?.role ?? "").toLowerCase();
  const dept = (staffProfile?.department ?? "").toLowerCase();

  if (["technician","maintenance_supervisor","groundskeeper","janitor","facilities_manager"].includes(pos)
    || dept === "maintenance") return "maintenance";

  if (["security_guard","concierge"].includes(pos) || dept === "security") return "security";

  if (["accountant","accounts_receivable","accounts_payable"].includes(pos)
    || dept === "finance") return "finance";

  if (["leasing_agent","customer_service","marketing_specialist"].includes(pos)
    || dept === "marketing") return "leasing";

  return "admin";
}

const ROLE_META: Record<StaffRole, { label: string; icon: any; color: string; bg: string; tabLabel: string; tabIcon: any }> = {
  maintenance: { label: "Maintenance",  icon: Wrench,          color: "text-amber-700 dark:text-amber-400",  bg: "from-amber-800 via-amber-700 to-amber-800",   tabLabel: "Work Orders",  tabIcon: ClipboardList },
  security:    { label: "Security",     icon: Shield,          color: "text-blue-700 dark:text-blue-300",   bg: "from-emerald-700 via-emerald-600 to-emerald-700",    tabLabel: "On Duty",      tabIcon: ShieldCheck   },
  finance:     { label: "Finance",      icon: CircleDollarSign,color: "text-green-700",  bg: "from-emerald-700 via-emerald-600 to-emerald-700",tabLabel: "Financials",  tabIcon: BarChart3     },
  leasing:     { label: "Leasing",      icon: Users,           color: "text-purple-700", bg: "from-purple-800 via-purple-700 to-purple-800",  tabLabel: "Tenants",     tabIcon: Users         },
  admin:       { label: "Management",   icon: Building,        color: "text-muted-foreground",  bg: "from-emerald-700 via-emerald-600 to-emerald-700",    tabLabel: "Overview",    tabIcon: BarChart3     },
};

// ─── Shared status configs ────────────────────────────────────────────────────

const MAINT_STATUS: Record<string, { label: string; color: string; icon: any; bg: string; border: string }> = {
  pending:     { label: "Pending",     color: "text-blue-700 dark:text-blue-300",   icon: Clock,        bg: "bg-blue-50",   border: "border-blue-200" },
  assigned:    { label: "Assigned",    color: "text-purple-700", icon: User,         bg: "bg-purple-50", border: "border-purple-200" },
  in_progress: { label: "In Progress", color: "text-amber-700 dark:text-amber-400",  icon: Play,         bg: "bg-amber-50",  border: "border-amber-200" },
  completed:   { label: "Completed",   color: "text-green-700",  icon: CheckCircle2, bg: "bg-green-50",  border: "border-green-200" },
  cancelled:   { label: "Cancelled",   color: "text-muted-foreground",   icon: X,            bg: "bg-muted",   border: "border-border" },
  on_hold:     { label: "On Hold",     color: "text-orange-700", icon: Pause,        bg: "bg-orange-50", border: "border-orange-200" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  low:    { label: "Low",    color: "text-muted-foreground",  dot: "bg-slate-400" },
  medium: { label: "Medium", color: "text-yellow-600", dot: "bg-yellow-400" },
  high:   { label: "High",   color: "text-orange-600", dot: "bg-orange-500" },
  urgent: { label: "Urgent", color: "text-red-600",    dot: "bg-red-500" },
};

const CATEGORY_ICONS: Record<string, any> = {
  plumbing: Droplets, electrical: Zap, hvac: Flame,
  cleaning: Brush, groundskeeping: Leaf, security: Shield,
  appliance: Home, structural: Building, locksmith: Key, default: Wrench,
};
function getCategoryIcon(cat: string | null | undefined) {
  if (!cat) return CATEGORY_ICONS.default;
  const key = cat.toLowerCase().replace(/[\s_-]/g, "");
  for (const [k, v] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return v;
  }
  return CATEGORY_ICONS.default;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE PANELS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. MAINTENANCE panel ─────────────────────────────────────────────────────

function MaintenancePanel({ user, staffProfile }: { user: any; staffProfile: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("active");

  const { data: rawRequests, isLoading, refetch } = useQuery({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => {
      const r = await apiRequest("/api/maintenance-requests");
      return ensureArray(await r.json());
    },
    retry: false,
  });

  const all = useMemo(() => ensureArray(rawRequests), [rawRequests]);

  const mine = useMemo(() => {
    const uid = String(user?.id ?? "");
    const sid = staffProfile?.id;
    const filtered = all.filter((r: any) =>
      (r.assignedTo && String(r.assignedTo) === uid) ||
      (sid && r.technicianId && Number(r.technicianId) === Number(sid))
    );
    return filtered.length > 0 ? filtered : all; // graceful fallback
  }, [all, user, staffProfile]);

  const displayed = useMemo(() => {
    if (statusFilter === "active") return mine.filter((r: any) => !["completed","cancelled"].includes(r.status));
    if (statusFilter === "completed") return mine.filter((r: any) => r.status === "completed");
    return mine;
  }, [mine, statusFilter]);

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: any }) => {
      const r = await apiRequest(`/api/maintenance-requests/${id}`, { method: "PATCH", data: patch });
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); toast({ title: "Updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "My Active",   value: mine.filter((r:any) => !["completed","cancelled"].includes(r.status)).length, color: "text-amber-600" },
          { label: "In Progress", value: mine.filter((r:any) => r.status === "in_progress").length,                    color: "text-blue-600"  },
          { label: "Done Today",  value: mine.filter((r:any) => r.status === "completed" && r.completedAt && isToday(new Date(r.completedAt))).length, color: "text-green-600" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 text-center shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 text-sm bg-background border-input text-foreground h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="ml-auto h-9 w-9 p-0">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No {statusFilter === "active" ? "active " : ""}work orders assigned to you</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((req: any) => (
            <WorkOrderCard key={req.id} req={req} onUpdate={(id, patch) => updateMutation.mutate({ id, patch })} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkOrderCard({ req, onUpdate }: { req: any; onUpdate: (id: number, patch: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(req.technicianNotes ?? "");
  const status = MAINT_STATUS[req.status] ?? MAINT_STATUS.pending;
  const priority = PRIORITY_CONFIG[req.priority ?? "medium"] ?? PRIORITY_CONFIG.medium;
  const CategoryIcon = getCategoryIcon(req.category);
  const isOverdue = req.scheduledDate && isPast(new Date(req.scheduledDate)) && !["completed","cancelled"].includes(req.status);
  const isDone = ["completed","cancelled"].includes(req.status);

  return (
    <div className={`rounded-xl border-2 transition-all ${status.bg} ${status.border} ${isOverdue ? "ring-2 ring-red-400" : ""}`}>
      <button className="w-full text-left p-4" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 rounded-lg bg-card shadow-sm shrink-0 border border-border"><CategoryIcon className={`h-4 w-4 ${status.color}`} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground text-sm">{req.title ?? "Work Order #" + req.id}</span>
                {isOverdue && <Badge className="bg-red-100 text-red-700 border-red-200 text-xs py-0">Overdue</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                {(req.property?.name ?? req.propertyName) && <span className="flex items-center gap-1"><Building className="h-3 w-3" />{req.property?.name ?? req.propertyName}</span>}
                {(req.unit?.unitNumber ?? req.unitNumber) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />Unit {req.unit?.unitNumber ?? req.unitNumber}</span>}
                {req.scheduledDate && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{isToday(new Date(req.scheduledDate)) ? "Today" : fmtDate(req.scheduledDate)}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`flex items-center gap-1 text-xs font-medium ${status.color}`}><status.icon className="h-3 w-3" />{status.label}</span>
            <span className={`flex items-center gap-1 text-xs ${priority.color}`}><span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />{priority.label}</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground mt-1" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mt-1" />}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4">
          {req.description && <p className="text-sm text-foreground/80">{req.description}</p>}
          {!isDone && (
            <div className="flex gap-2 flex-wrap">
              {req.status !== "in_progress" && (
                <Button size="sm" variant="outline" className="text-xs border-amber-300 text-amber-700 dark:text-amber-400 hover:bg-amber-50 h-7" onClick={() => onUpdate(req.id, { status: "in_progress" })}><Play className="h-3 w-3 mr-1" />Start</Button>
              )}
              <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700 text-white h-7" onClick={() => onUpdate(req.id, { status: "completed" })}><Check className="h-3 w-3 mr-1" />Complete</Button>
              <Button size="sm" variant="outline" className="text-xs border-orange-300 text-orange-700 h-7" onClick={() => onUpdate(req.id, { status: "on_hold" })}><Pause className="h-3 w-3 mr-1" />Hold</Button>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">My Notes</p>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Parts needed, findings, time spent..." className="text-sm bg-background border-input min-h-[64px] resize-none" disabled={isDone} />
            {!isDone && (
              <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => onUpdate(req.id, { technicianNotes: notes })}><Check className="h-3 w-3 mr-1" />Save Notes</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 2. SECURITY panel ────────────────────────────────────────────────────────

function SecurityPanel() {
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: visitorsRaw, isLoading: loadingVisitors, refetch } = useQuery({
    queryKey: ["/api/visitor-access-management"],
    queryFn: async () => { const r = await apiRequest("/api/visitor-access-management"); return ensureArray(await r.json()); },
    retry: false,
  });

  const visitors = useMemo(() => {
    const all = ensureArray(visitorsRaw);
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((v: any) =>
      v.visitorName?.toLowerCase().includes(q) ||
      v.purposeOfVisit?.toLowerCase().includes(q) ||
      v.hostName?.toLowerCase().includes(q)
    );
  }, [visitorsRaw, search]);

  const todayVisitors = useMemo(() =>
    ensureArray(visitorsRaw).filter((v: any) => v.expectedArrival && isToday(new Date(v.expectedArrival))),
    [visitorsRaw]
  );

  const actionMutation = useMutation({
    mutationFn: async ({ code, action }: { code: string; action: "check-in" | "check-out" | "approve" }) => {
      const r = await apiRequest(`/api/visitor-access-management/${code}/${action}`, { method: "PATCH" });
      if (!r.ok) throw new Error("Action failed");
      return r.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/visitor-access-management"] });
      toast({ title: vars.action === "check-in" ? "Visitor checked in" : vars.action === "check-out" ? "Visitor checked out" : "Visitor approved" });
    },
    onError: (e: any) => toast({ title: e.message ?? "Action failed", variant: "destructive" }),
  });

  const VSTATUS: Record<string, { color: string; bg: string }> = {
    expected:  { color: "text-blue-700 dark:text-blue-300",  bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" },
    arrived:   { color: "text-green-700 dark:text-green-300", bg: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" },
    departed:  { color: "text-muted-foreground",              bg: "bg-muted border-border" },
    denied:    { color: "text-red-700 dark:text-red-300",     bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Today's Visitors", value: todayVisitors.length,                                          color: "text-blue-600",  icon: UserCheck },
          { label: "Active / In",      value: todayVisitors.filter((v:any) => v.status === "arrived").length, color: "text-green-600", icon: ShieldCheck },
          { label: "Expected",         value: todayVisitors.filter((v:any) => v.status === "expected").length,color: "text-amber-600", icon: Clock },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 text-center shadow-sm">
            <s.icon className={`h-5 w-5 ${s.color} mx-auto mb-1`} />
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search visitors..." className="pl-9 text-sm h-9 bg-background border-input text-foreground" />
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="h-9 w-9 p-0"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {loadingVisitors ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>
      ) : visitors.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><UserCheck className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No visitor records</p></div>
      ) : (
        <div className="space-y-2">
          {visitors.slice(0, 30).map((v: any) => {
            const sc = VSTATUS[v.status] ?? VSTATUS.expected;
            const code = v.accessCode ?? v.code ?? String(v.id);
            return (
              <div key={v.id} className={`rounded-xl border p-3 ${sc.bg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{v.visitorName ?? "Unknown"}</span>
                      <Badge className={`text-xs py-0 capitalize ${sc.color} bg-card border border-border`}>{v.status ?? "expected"}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {v.purposeOfVisit && <span><Eye className="h-3 w-3 inline mr-0.5" />{v.purposeOfVisit}</span>}
                      {v.hostName && <span><User className="h-3 w-3 inline mr-0.5" />Host: {v.hostName}</span>}
                      {v.expectedArrival && <span><Clock className="h-3 w-3 inline mr-0.5" />{fmtTime(v.expectedArrival)}</span>}
                      {v.vehiclePlate && <span><Car className="h-3 w-3 inline mr-0.5" />{v.vehiclePlate}</span>}
                    </div>
                  </div>
                </div>
                {/* Action buttons based on current status */}
                {v.status === "expected" && (
                  <div className="flex gap-2 mt-2 pt-2 border-t border-border/40">
                    <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white"
                      disabled={actionMutation.isPending}
                      onClick={() => actionMutation.mutate({ code, action: "check-in" })}>
                      <Check className="h-3 w-3 mr-1" />Check In
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400"
                      disabled={actionMutation.isPending}
                      onClick={() => actionMutation.mutate({ code, action: "approve" })}>
                      <Shield className="h-3 w-3 mr-1" />Pre-Approve
                    </Button>
                  </div>
                )}
                {v.status === "arrived" && (
                  <div className="flex gap-2 mt-2 pt-2 border-t border-border/40">
                    <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400"
                      disabled={actionMutation.isPending}
                      onClick={() => actionMutation.mutate({ code, action: "check-out" })}>
                      <ArrowUpRight className="h-3 w-3 mr-1" />Check Out
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 3. FINANCE panel ─────────────────────────────────────────────────────────

function FinancePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: paymentsRaw, isLoading: loadingPay } = useQuery({
    queryKey: ["/api/rent-payments"],
    queryFn: async () => { const r = await apiRequest("/api/rent-payments"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: arrearsRaw } = useQuery({
    queryKey: ["/api/arrears"],
    queryFn: async () => { const r = await apiRequest("/api/arrears?limit=50"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: expensesRaw } = useQuery({
    queryKey: ["/api/property-expenses"],
    queryFn: async () => { const r = await apiRequest("/api/property-expenses"); return ensureArray(await r.json()); },
    retry: false,
  });

  const payments = useMemo(() => ensureArray(paymentsRaw), [paymentsRaw]);
  const arrears  = useMemo(() => ensureArray(arrearsRaw),  [arrearsRaw]);
  const expenses = useMemo(() => ensureArray(expensesRaw), [expensesRaw]);

  const totalCollected = payments.filter((p:any) => ["paid","completed"].includes(p.status)).reduce((s:number,p:any) => s + Number(p.amount ?? 0), 0);
  const totalArrears   = arrears.reduce((s:number,a:any) => s + Number(a.amountOwed ?? a.balance ?? 0), 0);
  const totalExpenses  = expenses.reduce((s:number,e:any) => s + Number(e.amount ?? 0), 0);
  const pendingCount   = payments.filter((p:any) => p.status === "pending").length;

  const reminderMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/arrears/${id}/send-reminder`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to send reminder");
      return r.json();
    },
    onSuccess: () => toast({ title: "Payment reminder sent" }),
    onError: (e: any) => toast({ title: e.message ?? "Failed", variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/rent-payments/${id}/mark-paid`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to mark as paid");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/arrears"] });
      toast({ title: "Payment marked as paid" });
    },
    onError: (e: any) => toast({ title: e.message ?? "Failed", variant: "destructive" }),
  });

  const PAY_STATUS: Record<string,{label:string;color:string;bg:string}> = {
    paid:      { label:"Paid",    color:"text-green-700 dark:text-green-400", bg:"bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" },
    completed: { label:"Paid",    color:"text-green-700 dark:text-green-400", bg:"bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" },
    pending:   { label:"Pending", color:"text-amber-700 dark:text-amber-400", bg:"bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
    overdue:   { label:"Overdue", color:"text-red-700 dark:text-red-400",     bg:"bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
    failed:    { label:"Failed",  color:"text-red-700 dark:text-red-400",     bg:"bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Collected",  value: fmtKES(totalCollected), color: "text-green-600", icon: CircleDollarSign },
          { label: "Arrears",    value: fmtKES(totalArrears),   color: "text-red-600",   icon: AlertTriangle },
          { label: "Expenses",   value: fmtKES(totalExpenses),  color: "text-amber-600", icon: Receipt },
          { label: "Pending",    value: String(pendingCount),   color: "text-blue-600",  icon: Clock },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 shadow-sm flex items-center gap-3">
            <s.icon className={`h-8 w-8 ${s.color} shrink-0`} />
            <div>
              <p className={`text-lg font-bold ${s.color} leading-tight`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Arrears with send-reminder action */}
      {arrears.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Outstanding Arrears</p>
          <div className="space-y-2">
            {arrears.slice(0, 10).map((a: any) => (
              <div key={a.id} className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{a.tenantName ?? [a.firstName,a.lastName].filter(Boolean).join(" ") ?? "Tenant"}</p>
                    <p className="text-xs text-muted-foreground">{a.propertyName ?? ""}{a.unitNumber ? ` · Unit ${a.unitNumber}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-red-700 dark:text-red-400">{fmtKES(a.amountOwed ?? a.balance)}</p>
                    {a.daysOverdue && <p className="text-xs text-red-500">{a.daysOverdue}d overdue</p>}
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-red-100 dark:border-red-900" >
                  <Button size="sm" variant="outline" className="text-xs h-7 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400"
                    disabled={reminderMutation.isPending}
                    onClick={() => reminderMutation.mutate(a.id)}>
                    <Send className="h-3 w-3 mr-1" />Send Reminder
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent payments with mark-paid action */}
      {loadingPay ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /></div>
      ) : (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Payments</p>
          <div className="space-y-2">
            {payments.slice(0, 10).map((p: any) => {
              const sc = PAY_STATUS[p.status] ?? PAY_STATUS.pending;
              return (
                <div key={p.id} className={`rounded-xl border p-3 ${sc.bg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{p.tenantName ?? p.tenant ?? "Tenant"}</p>
                      <p className="text-xs text-muted-foreground">{p.propertyName ?? ""} · {fmtDate(p.paymentDate ?? p.createdAt)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${sc.color}`}>{fmtKES(p.amount)}</p>
                      <Badge className={`text-xs py-0 ${sc.color} bg-card border border-border`}>{sc.label}</Badge>
                    </div>
                  </div>
                  {p.status === "pending" && (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white"
                        disabled={markPaidMutation.isPending}
                        onClick={() => markPaidMutation.mutate(p.id)}>
                        <Check className="h-3 w-3 mr-1" />Mark Paid
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 4. LEASING panel ─────────────────────────────────────────────────────────

function LeasingPanel() {
  const [search, setSearch] = useState("");
  const [composingFor, setComposingFor] = useState<any | null>(null);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tenantsRaw, isLoading } = useQuery({
    queryKey: ["/api/tenants"],
    queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: unitsRaw } = useQuery({
    queryKey: ["/api/units"],
    queryFn: async () => { const r = await apiRequest("/api/units"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: broadcastsRaw } = useQuery({
    queryKey: ["/api/broadcast-messages"],
    queryFn: async () => { const r = await apiRequest("/api/broadcast-messages"); return ensureArray(await r.json()); },
    retry: false,
  });

  const tenants    = useMemo(() => ensureArray(tenantsRaw),    [tenantsRaw]);
  const units      = useMemo(() => ensureArray(unitsRaw),      [unitsRaw]);
  const broadcasts = useMemo(() => ensureArray(broadcastsRaw), [broadcastsRaw]);

  const vacantUnits  = useMemo(() => units.filter((u: any) => u.status === "vacant" || !u.tenantId), [units]);
  const activeLeases = useMemo(() => tenants.filter((t: any) => t.status === "active"), [tenants]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tenants;
    const q = search.toLowerCase();
    return tenants.filter((t: any) =>
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) || t.phone?.includes(q)
    );
  }, [tenants, search]);

  const sendMessage = async (t: any) => {
    if (!msgBody.trim() || !(t.userId ?? t.user_id)) return;
    setSending(true);
    try {
      await apiRequest("/api/messages", {
        method: "POST",
        data: { toUserId: t.userId ?? t.user_id, subject: "Message from Leasing", content: msgBody },
      });
      setMsgBody(""); setComposingFor(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Message sent" });
    } catch { toast({ title: "Failed to send", variant: "destructive" }); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active Tenants",  value: activeLeases.length, color: "text-green-600",  icon: Users },
          { label: "Vacant Units",    value: vacantUnits.length,  color: "text-amber-600",  icon: Building },
          { label: "Broadcasts Sent", value: broadcasts.length,   color: "text-purple-600", icon: Megaphone },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 text-center shadow-sm">
            <s.icon className={`h-5 w-5 ${s.color} mx-auto mb-1`} />
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tenants..." className="pl-9 text-sm h-9 bg-background border-input text-foreground" />
      </div>

      {vacantUnits.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 uppercase tracking-wide">
            <Building className="h-3.5 w-3.5 inline mr-1" />{vacantUnits.length} Vacant Unit{vacantUnits.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {vacantUnits.slice(0,8).map((u: any) => (
              <Badge key={u.id} className="bg-card border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs">
                Unit {u.unitNumber}{u.propertyName ? ` · ${u.propertyName}` : ""}
              </Badge>
            ))}
            {vacantUnits.length > 8 && <Badge className="bg-card border-border text-muted-foreground text-xs">+{vacantUnits.length - 8} more</Badge>}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 20).map((t: any) => (
            <div key={t.id} className="bg-card rounded-xl border border-border p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-purple-100 dark:bg-purple-950 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{(t.firstName?.[0] ?? "?").toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.firstName} {t.lastName}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {t.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{t.email}</span>}
                      {t.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{t.phone}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge className={`text-xs py-0 capitalize ${t.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>
                    {t.status ?? "active"}
                  </Badge>
                  {(t.userId ?? t.user_id) && (
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                      onClick={() => { setComposingFor(t); setMsgBody(""); }}>
                      <Send className="h-3 w-3 mr-1" />Message
                    </Button>
                  )}
                </div>
              </div>
              {t.unitNumber && (
                <p className="text-xs text-muted-foreground mt-1.5 ml-12">
                  <MapPin className="h-3 w-3 inline mr-0.5" />Unit {t.unitNumber}{t.propertyName ? ` · ${t.propertyName}` : ""}
                </p>
              )}
              {/* Inline compose */}
              {composingFor?.id === t.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <Textarea value={msgBody} onChange={e => setMsgBody(e.target.value)}
                    placeholder={`Message to ${t.firstName}…`} className="text-sm bg-background min-h-[64px] resize-none" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => sendMessage(t)} disabled={sending || !msgBody.trim()} className="text-xs h-7">
                      {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}Send
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setComposingFor(null)} className="text-xs h-7">Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 5. ADMIN / MANAGEMENT panel ─────────────────────────────────────────────

function AdminPanel() {
  const { data: propertiesRaw } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: tenantsRaw } = useQuery({
    queryKey: ["/api/tenants"],
    queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: maintenanceRaw } = useQuery({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => { const r = await apiRequest("/api/maintenance-requests"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: staffRaw } = useQuery({
    queryKey: ["/api/staff-members"],
    queryFn: async () => { const r = await apiRequest("/api/staff-members"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: paymentsRaw } = useQuery({
    queryKey: ["/api/rent-payments"],
    queryFn: async () => { const r = await apiRequest("/api/rent-payments"); return ensureArray(await r.json()); },
    retry: false,
  });

  const properties  = useMemo(() => ensureArray(propertiesRaw),  [propertiesRaw]);
  const tenants     = useMemo(() => ensureArray(tenantsRaw),     [tenantsRaw]);
  const maintenance = useMemo(() => ensureArray(maintenanceRaw), [maintenanceRaw]);
  const staff       = useMemo(() => ensureArray(staffRaw),       [staffRaw]);
  const payments    = useMemo(() => ensureArray(paymentsRaw),    [paymentsRaw]);

  const openTickets = maintenance.filter((r:any) => !["completed","cancelled"].includes(r.status)).length;
  const urgentTickets = maintenance.filter((r:any) => ["urgent","critical"].includes(r.priority) && !["completed","cancelled"].includes(r.status)).length;
  const activeStaff = staff.filter((s:any) => s.status === "active").length;
  const monthPayments = payments.filter((p:any) => {
    const d = p.paymentDate ?? p.createdAt;
    if (!d) return false;
    const pd = new Date(d);
    const now = new Date();
    return pd.getMonth() === now.getMonth() && pd.getFullYear() === now.getFullYear() && (p.status === "paid" || p.status === "completed");
  });
  const monthRevenue = monthPayments.reduce((s:number,p:any) => s + Number(p.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Properties",     value: properties.length,   color: "text-muted-foreground",  icon: Building,        bg: "bg-muted border-border" },
          { label: "Active Tenants", value: tenants.filter((t:any)=>t.status==="active").length, color: "text-green-700", icon: Users, bg: "bg-green-50 border-green-200" },
          { label: "Open Tickets",   value: openTickets,         color: urgentTickets > 0 ? "text-red-700" : "text-amber-700 dark:text-amber-400", icon: Wrench, bg: urgentTickets > 0 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200" },
          { label: "Active Staff",   value: activeStaff,         color: "text-blue-700 dark:text-blue-300",   icon: HardHat,         bg: "bg-blue-50 border-blue-200" },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.bg} shadow-sm`}>
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Month revenue */}
      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
        <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wide mb-1">This Month's Revenue</p>
        <p className="text-2xl font-semibold text-emerald-700">{fmtKES(monthRevenue)}</p>
        <p className="text-xs text-emerald-500 mt-0.5">{monthPayments.length} payment{monthPayments.length !== 1 ? "s" : ""} received</p>
      </div>

      {/* Urgent maintenance */}
      {urgentTickets > 0 && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2"><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />{urgentTickets} Urgent Maintenance Issue{urgentTickets !== 1 ? "s" : ""}</p>
          {maintenance.filter((r:any) => ["urgent","critical"].includes(r.priority) && !["completed","cancelled"].includes(r.status)).slice(0,3).map((r:any) => (
            <div key={r.id} className="flex items-center justify-between text-xs py-1 border-t border-red-100 first:border-0">
              <span className="text-red-800 font-medium">{r.title ?? r.description?.slice(0,50) ?? "Ticket #"+r.id}</span>
              <Badge className="text-xs py-0 bg-red-100 text-red-700 border-red-300 capitalize">{r.status}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Staff on duty */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Staff Directory</p>
        <div className="space-y-2">
          {staff.slice(0, 8).map((s: any) => (
            <div key={s.id} className="bg-card border border-border rounded-xl p-3 shadow-sm flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-muted-foreground">{(s.first_name?.[0] ?? "?").toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{s.first_name} {s.last_name}</p>
                <p className="text-xs text-muted-foreground capitalize">{s.position?.replace(/_/g," ")} · {s.department?.replace(/_/g," ")}</p>
              </div>
              <Badge className={`text-xs py-0 capitalize ${s.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>{s.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Shared Messages Panel ────────────────────────────────────────────────────

function MessagesPanel({ user, orgUsers }: { user: any; orgUsers: any[] }) {
  const { toast } = useToast();
  const [msgTab, setMsgTab] = useState<"inbox"|"sent">("inbox");
  const [toUserId, setToUserId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);

  const { data: inboxData, refetch: ri } = useQuery({
    queryKey: ["/api/messages","inbox"],
    queryFn: async () => { const r = await apiRequest("/api/messages?box=inbox"); const j = await r.json(); return ensureArray(j?.results ?? j); },
    retry: false,
  });
  const { data: sentData, refetch: rs } = useQuery({
    queryKey: ["/api/messages","sent"],
    queryFn: async () => { const r = await apiRequest("/api/messages?box=sent"); const j = await r.json(); return ensureArray(j?.results ?? j); },
    retry: false,
    enabled: msgTab === "sent",
  });

  const msgs = useMemo(() => msgTab === "inbox" ? ensureArray(inboxData) : ensureArray(sentData), [msgTab, inboxData, sentData]);
  const recipients = useMemo(() => ensureArray(orgUsers).filter((u:any) => u.id !== user?.id), [orgUsers, user]);

  const sendMessage = async () => {
    if (!body.trim() || !toUserId) return;
    setSending(true);
    try {
      await apiRequest("/api/messages", { method: "POST", data: { toUserId, subject: subject || "Staff Note", content: body } });
      setBody(""); setSubject(""); setToUserId(""); setComposing(false);
      ri(); rs();
      toast({ title: "Message sent" });
    } catch {
      toast({ title: "Failed to send", variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {(["inbox","sent"] as const).map(t => (
            <button key={t} onClick={() => setMsgTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all
                ${msgTab === t ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground/80"}`}>
              {t === "inbox" ? <><Inbox className="h-3 w-3 inline mr-1" />Inbox</> : <><ArrowUpRight className="h-3 w-3 inline mr-1" />Sent</>}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setComposing(!composing)} className="h-7 text-xs">
          <Send className="h-3 w-3 mr-1" /> New Message
        </Button>
      </div>

      {composing && (
        <div className="rounded-xl border-2 border-border bg-muted p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground dark:text-muted-foreground/40 uppercase tracking-wide">New Message</p>
          <Select value={toUserId} onValueChange={setToUserId}>
            <SelectTrigger className="text-sm bg-background border-input h-9"><SelectValue placeholder="Send to..." /></SelectTrigger>
            <SelectContent>
              {recipients.map((u:any) => (
                <SelectItem key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                  <span className="text-muted-foreground ml-1 capitalize">· {u.role}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" className="text-sm bg-background border-input h-9" />
          <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Your message..." className="text-sm bg-background border-input min-h-[72px] resize-none" />
          <div className="flex gap-2">
            <Button size="sm" onClick={sendMessage} disabled={sending || !body.trim() || !toUserId} className="text-xs h-7">
              {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}Send
            </Button>
            <Button size="sm" variant="outline" onClick={() => setComposing(false)} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      )}

      {msgs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No {msgTab} messages</p></div>
      ) : (
        <div className="space-y-2">
          {msgs.map((msg:any) => (
            <div key={msg.id} className={`rounded-xl border border-border bg-card p-4 shadow-sm ${!msg.isRead && msgTab==="inbox" ? "border-blue-200 dark:bg-blue-950/30" : ""}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div>
                  <div className="flex items-center gap-2">
                    {!msg.isRead && msgTab === "inbox" && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                    <p className="text-sm font-semibold text-foreground">{msg.subject ?? "(no subject)"}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {msgTab === "inbox" ? `From: ${msg.fromName ?? "Unknown"}` : `To: ${msg.toName ?? "Unknown"}`} · {timeAgo(msg.createdAt)}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground/40">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Notification types (mirror server) ──────────────────────────────────────

interface StaffNotification {
  id: string;
  type: "work_order" | "message" | "assignment" | "payment" | "visitor" | "system";
  title: string;
  message: string;
  ts: string;
  read: boolean;
  link?: string;
  meta?: Record<string, unknown>;
}

const NOTIF_ICON: Record<string, any> = {
  work_order:  Wrench,
  message:     MessageSquare,
  assignment:  ClipboardList,
  payment:     CircleDollarSign,
  visitor:     UserCheck,
  system:      Bell,
};

const NOTIF_COLOR: Record<string, string> = {
  work_order:  "text-amber-600 bg-amber-50 border-amber-200",
  message:     "text-blue-600 bg-blue-50 border-blue-200",
  assignment:  "text-purple-600 bg-purple-50 border-purple-200",
  payment:     "text-green-600 bg-green-50 border-green-200",
  visitor:     "text-muted-foreground bg-muted border-border",
  system:      "text-muted-foreground dark:text-muted-foreground/40 bg-gray-50 border-gray-200",
};

// ─── Notification Bell ────────────────────────────────────────────────────────

function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const queryClient = useQueryClient();

  const { data: rawNotifs, refetch } = useQuery<StaffNotification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const r = await apiRequest("/api/notifications");
      return ensureArray(await r.json());
    },
    retry: false,
    refetchInterval: 60_000,
  });

  const notifs = useMemo(() => ensureArray(rawNotifs) as StaffNotification[], [rawNotifs]);
  const unread = notifs.filter(n => !n.read).length;

  // Live WS events — invalidate so the bell count updates
  useWsEvent("maintenance:updated", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
  });
  useWsEvent("message:new", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
  });
  useWsEvent("payment:confirmed", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });
  useWsEvent("payment:overdue", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });
  useWsEvent("broadcast", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });

  return (
    <button
      onClick={onOpen}
      className="relative h-9 w-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 transition-all"
      aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
    >
      <Bell className="h-4.5 w-4.5 text-white h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 h-4.5 w-4.5 min-w-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 border border-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

// ─── Notification Drawer ──────────────────────────────────────────────────────

function NotificationDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPrefs, setShowPrefs] = useState(false);

  const { data: rawNotifs, isLoading } = useQuery<StaffNotification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const r = await apiRequest("/api/notifications");
      return ensureArray(await r.json());
    },
    retry: false,
    enabled: open,
  });

  const notifs = useMemo(() => ensureArray(rawNotifs) as StaffNotification[], [rawNotifs]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/notifications/${id}/read`, { method: "POST" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/notifications", { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notifications cleared" });
    },
  });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] flex flex-col bg-card text-card-foreground rounded-t-2xl shadow-2xl sm:left-auto sm:right-4 sm:bottom-4 sm:top-4 sm:w-96 sm:rounded-2xl sm:max-h-none">
  

        {/* Preferences panel (collapsible) */}
        {showPrefs && (
          <div className="border-b border-border bg-muted">
            <NotificationPrefsPanel />
          </div>
        )}

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
            </div>
          ) : notifs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BellOff className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
              <p className="text-xs mt-1 text-muted-foreground/40">You're all caught up!</p>
            </div>
          ) : (
            notifs.map(notif => {
              const Icon = NOTIF_ICON[notif.type] ?? Bell;
              const colorCls = NOTIF_COLOR[notif.type] ?? NOTIF_COLOR.system;
              return (
                <button
                  key={notif.id}
                  className={`w-full text-left rounded-xl border p-3 transition-all
                    ${notif.read ? "bg-card border-border opacity-60 hover:opacity-80" : `${colorCls} hover:opacity-90`}`}
                  onClick={() => !notif.read && markRead.mutate(notif.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-1.5 rounded-lg bg-card/80 border border-border/50 shrink-0`}>
                      <Icon className={`h-3.5 w-3.5 ${notif.read ? "text-muted-foreground" : colorCls.split(" ")[0]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-xs font-semibold leading-tight ${notif.read ? "text-muted-foreground" : "text-foreground"}`}>
                          {notif.title}
                        </p>
                        {!notif.read && <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />}
                      </div>
                      <p className={`text-xs mt-0.5 leading-snug ${notif.read ? "text-muted-foreground" : "text-foreground/80"}`}>
                        {notif.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{timeAgo(notif.ts)}</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ─── Notification Preferences Panel ──────────────────────────────────────────

function NotificationPrefsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ["/api/notifications/preferences"],
    queryFn: async () => {
      const r = await apiRequest("/api/notifications/preferences");
      return r.json();
    },
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const r = await apiRequest("/api/notifications/preferences", {
        method: "PATCH",
        data: patch,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Preferences saved" });
    },
    onError: () => toast({ title: "Failed to save preferences", variant: "destructive" }),
  });

  const toggle = (key: string, value: boolean) => saveMutation.mutate({ [key]: value });

  if (isLoading) return <div className="p-4 text-center text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />Loading...</div>;

  // Only show the preferences relevant to this staff role (not payment reminders by default)
  const prefItems = [
    { key: "inAppNotifications",   label: "In-app notifications",   icon: Bell,           desc: "Show notification badge and drawer" },
    { key: "maintenanceUpdates",   label: "Work order updates",     icon: Wrench,         desc: "When your jobs are updated or reassigned" },
    { key: "securityAlerts",       label: "Security alerts",        icon: Shield,         desc: "Visitor alerts and access events" },
    { key: "featureAnnouncements", label: "System announcements",   icon: Megaphone,      desc: "Updates from property management" },
    { key: "weeklyDigest",         label: "Weekly summary",         icon: FileText,       desc: "A weekly digest of your activity" },
  ];

  return (
    <div className="px-4 py-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notification Preferences</p>
      {prefItems.map(item => (
        <div key={item.key} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <item.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground/80">{item.label}</p>
              <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
            </div>
          </div>
          <Switch
            checked={prefs?.[item.key] ?? true}
            onCheckedChange={val => toggle(item.key, val)}
            disabled={saveMutation.isPending}
            className="shrink-0"
          />
        </div>
      ))}

      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground mb-1.5">Delivery frequency</p>
        <Select
          value={prefs?.frequency ?? "immediate"}
          onValueChange={val => saveMutation.mutate({ frequency: val })}
        >
          <SelectTrigger className="h-8 text-xs bg-background border-input text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="immediate">Immediately</SelectItem>
            <SelectItem value="daily">Daily digest</SelectItem>
            <SelectItem value="weekly">Weekly only</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── HR Panel — time tracking, payslips, leave ────────────────────────────────

function HRPanel({ staffProfile }: { staffProfile: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const staffId = staffProfile?.id;

  const { data: sessionRaw } = useQuery({
    queryKey: ["/api/time-tracking/active-session"],
    queryFn: async () => {
      const r = await apiRequest("/api/time-tracking/active-session");
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
    enabled: !!staffId,
    refetchInterval: 60_000,
  });

  const { data: payrollRaw } = useQuery({
    queryKey: ["/api/payroll", staffId],
    queryFn: async () => {
      const r = await apiRequest(`/api/payroll?staffId=${staffId}`);
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    retry: false,
    enabled: !!staffId,
  });

  const activeSession = sessionRaw ?? null;
  const payslips = useMemo(() => ensureArray(payrollRaw).slice(0, 6), [payrollRaw]);

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/time-tracking/clock-in", {
        method: "POST",
        data: { staffId, clockInTime: new Date().toISOString() },
      });
      if (!r.ok) throw new Error("Clock-in failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active-session"] });
      toast({ title: "Clocked in ✓", description: `Started at ${format(new Date(), "h:mm a")}` });
    },
    onError: (e: any) => toast({ title: e.message ?? "Clock-in failed", variant: "destructive" }),
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/time-tracking/clock-out", {
        method: "POST",
        data: { staffId, clockOutTime: new Date().toISOString() },
      });
      if (!r.ok) throw new Error("Clock-out failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/active-session"] });
      toast({ title: "Clocked out ✓", description: `Ended at ${format(new Date(), "h:mm a")}` });
    },
    onError: (e: any) => toast({ title: e.message ?? "Clock-out failed", variant: "destructive" }),
  });

  if (!staffId) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" /> Time & Pay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Clock in/out */}
        <div className={`rounded-xl border p-4 ${activeSession ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : "bg-muted border-border"}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {activeSession ? "Currently Clocked In" : "Not Clocked In"}
              </p>
              {activeSession?.clockInTime && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Since {format(new Date(activeSession.clockInTime), "h:mm a")} · {timeAgo(activeSession.clockInTime)}
                </p>
              )}
            </div>
            {activeSession ? (
              <Button size="sm" variant="outline"
                className="text-xs h-8 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 shrink-0"
                disabled={clockOutMutation.isPending}
                onClick={() => clockOutMutation.mutate()}>
                {clockOutMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                Clock Out
              </Button>
            ) : (
              <Button size="sm"
                className="text-xs h-8 bg-green-600 hover:bg-green-700 text-white shrink-0"
                disabled={clockInMutation.isPending}
                onClick={() => clockInMutation.mutate()}>
                {clockInMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Clock In
              </Button>
            )}
          </div>
        </div>

        {/* Payslips */}
        {payslips.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Payslips</p>
            <div className="space-y-2">
              {payslips.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.periodLabel ?? fmtDate(p.periodStart)}</p>
                    <p className="text-xs text-muted-foreground">{p.status ?? "processed"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{fmtKES(p.netPay ?? p.amount)}</p>
                    {p.downloadUrl && (
                      <a href={p.downloadUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary underline">Download</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {payslips.length === 0 && !activeSession && (
          <p className="text-xs text-muted-foreground text-center py-2">No payroll records yet</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Profile Panel ────────────────────────────────────────────────────────────
//
// What staff CAN edit (personal / contact / safety info they own):
//   phone, address, emergency_contact_name, emergency_contact_phone
//
// What is READ-ONLY (set by HR / admin, staff cannot self-modify):
//   first_name, last_name, employee_id, position, department,
//   employment_type, hire_date, salary, hourly_rate, status, email
//
// The PATCH call sends ONLY the four editable fields, so even if a crafted
// request tried to send position/salary, the server's staffSchema.partial()
// would accept them — which is why the server route is also hardened below.

function ProfilePanel({ staffProfile }: { staffProfile: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState({
    phone:                   staffProfile?.phone                   ?? "",
    address:                 staffProfile?.address                 ?? "",
    emergency_contact_name:  staffProfile?.emergency_contact_name  ?? "",
    emergency_contact_phone: staffProfile?.emergency_contact_phone ?? "",
  });

  // Reset form to latest profile values when not editing
  const startEdit = () => {
    setForm({
      phone:                   staffProfile?.phone                   ?? "",
      address:                 staffProfile?.address                 ?? "",
      emergency_contact_name:  staffProfile?.emergency_contact_name  ?? "",
      emergency_contact_phone: staffProfile?.emergency_contact_phone ?? "",
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (patch: typeof form) => {
      if (!staffProfile?.id) throw new Error("No staff profile linked to your account.");
      // Uses the /me endpoint — server enforces only phone/address/emergency fields can be changed
      const r = await apiRequest(`/api/staff-members/${staffProfile.id}/me`, {
        method: "PATCH",
        data: patch,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message ?? "Update failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      toast({ title: "Profile updated" });
      setEditing(false);
    },
    onError: (e: any) => toast({ title: e.message ?? "Update failed", variant: "destructive" }),
  });

  if (!staffProfile) {
    return (
      <div className="text-center py-16 text-muted-foreground space-y-2">
        <User className="h-10 w-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium text-foreground">No staff profile linked to your account.</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          Ask your property manager to create a staff record using your login email.
          {staffProfile === null && (
            <span className="block mt-1 font-mono text-[11px] bg-muted rounded px-2 py-0.5 inline-block">
              Your email: {(window as any).__staffDebugEmail ?? "—"}
            </span>
          )}
        </p>
      </div>
    );
  }

  // Read-only fields — set by HR/admin only
  const readOnlyFields = [
    { label: "Full Name",        value: `${staffProfile.first_name} ${staffProfile.last_name}` },
    { label: "Employee ID",      value: staffProfile.employee_id },
    { label: "Position",         value: staffProfile.position?.replace(/_/g, " ") },
    { label: "Department",       value: staffProfile.department?.replace(/_/g, " ") },
    { label: "Employment Type",  value: staffProfile.employment_type?.replace(/_/g, " ") },
    { label: "Hire Date",        value: fmtDate(staffProfile.hire_date) },
    { label: "Work Email",       value: staffProfile.email ?? "—" },
    { label: "Status",           value: staffProfile.status ?? "active", isBadge: true },
  ];

  return (
    <div className="space-y-4">
      {/* ── Read-only section ──────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Employment Details
            </CardTitle>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Managed by HR
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {readOnlyFields.map(({ label, value, isBadge }) => (
              <div key={label} className={label === "Work Email" ? "col-span-2" : ""}>
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                {isBadge ? (
                  <Badge className="text-xs capitalize bg-emerald-50 text-emerald-700 border border-emerald-200" >
                    {value}
                  </Badge>
                ) : (
                  <p className="font-medium text-foreground/80 capitalize">{value ?? "—"}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Editable section ───────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              My Contact & Safety Info
            </CardTitle>
            {!editing && (
              <Button size="sm" variant="outline" onClick={startEdit} className="h-7 text-xs gap-1">
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <>
              <div className="grid grid-cols-1 gap-4">
                {/* Phone */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/40 mb-1.5 flex items-center gap-1">
                    <Phone className="h-3 w-3" /> Phone Number
                  </label>
                  <Input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+254 7XX XXX XXX"
                    className="text-sm h-9 bg-background border-input text-foreground"
                  />
                </div>

                {/* Address */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground dark:text-muted-foreground/40 mb-1.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Home Address
                  </label>
                  <Textarea
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Your residential address"
                    className="text-sm bg-background border-input resize-none min-h-[64px]"
                  />
                </div>

                {/* Emergency contact */}
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-3">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1">
                    <Bell className="h-3 w-3" /> Emergency Contact
                  </p>
                  <div>
                    <label className="text-xs text-muted-foreground dark:text-muted-foreground/40 mb-1 block">Contact Name</label>
                    <Input
                      value={form.emergency_contact_name}
                      onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))}
                      placeholder="Full name of emergency contact"
                      className="text-sm h-9 bg-background border-input text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground dark:text-muted-foreground/40 mb-1 block">Contact Phone</label>
                    <Input
                      value={form.emergency_contact_phone}
                      onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))}
                      placeholder="+254 7XX XXX XXX"
                      className="text-sm h-9 bg-background border-input text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Save / Cancel */}
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending}
                  className="text-xs h-8 gap-1"
                >
                  {saveMutation.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Save className="h-3 w-3" />}
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={saveMutation.isPending}
                  className="text-xs h-8 gap-1"
                >
                  <XCircle className="h-3 w-3" /> Cancel
                </Button>
              </div>
            </>
          ) : (
            /* Read view of the editable fields */
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Phone Number</p>
                  <p className="font-medium text-foreground">{staffProfile.phone || <span className="text-muted-foreground italic">Not set</span>}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Home Address</p>
                  <p className="font-medium text-foreground">{staffProfile.address || <span className="text-muted-foreground italic">Not set</span>}</p>
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Bell className="h-3 w-3" /> Emergency Contact
                </p>
                {staffProfile.emergency_contact_name ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{staffProfile.emergency_contact_name}</p>
                    {staffProfile.emergency_contact_phone && (
                      <p className="text-sm text-muted-foreground dark:text-muted-foreground/40 flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />{staffProfile.emergency_contact_phone}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 italic">No emergency contact set — please add one.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── CaretakerRatingsPanel ────────────────────────────────────────────────────
// Shown to caretaker role: their personal performance rating + full review
// comments from tenants (it's their own feedback, they deserve to see it).

function CaretakerRatingsPanel() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/ratings/my-caretaker-rating"],
    queryFn: async () => (await apiRequest("/api/ratings/my-caretaker-rating")).json(),
  });

  const renderStars = (n: number, size = "w-4 h-4") => (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`${size} ${i <= Math.round(n) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (!data?.found) return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <Star className="w-8 h-8 mx-auto mb-3 opacity-30" />
      <p>No rating data found for your caretaker profile yet.</p>
      <p className="text-xs mt-1">Ratings will appear here once tenants review your performance.</p>
    </div>
  );

  const avg: number = Number(data.avgRating ?? 0);
  const total: number = data.totalReviews ?? 0;
  const dist: Record<number, number> = data.distribution ?? {};
  const reviews: any[] = data.reviews ?? [];

  return (
    <div className="space-y-4">
      {/* ── Score card ────────────────────────────────────────────────── */}
      <div className={`${S.card} rounded-2xl border p-5 text-center shadow-sm`}>
        <p className="text-xs text-muted-foreground mb-1">Your Performance Rating</p>
        <p className="text-4xl font-bold text-foreground">{avg.toFixed(1)}<span className="text-base font-normal text-muted-foreground"> / 5</span></p>
        <div className="flex justify-center mt-2">{renderStars(avg, "w-5 h-5")}</div>
        <p className="text-xs text-muted-foreground mt-2">{total} tenant review{total !== 1 ? "s" : ""}</p>
      </div>

      {/* ── Distribution ─────────────────────────────────────────────── */}
      {total > 0 && (
        <div className={`${S.card} rounded-2xl border p-4 shadow-sm space-y-2`}>
          <p className="text-xs font-semibold text-foreground mb-2">Rating Breakdown</p>
          {[5,4,3,2,1].map(n => {
            const count = dist[n] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-muted-foreground shrink-0">{n}</span>
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 text-right text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Individual reviews ───────────────────────────────────────── */}
      {reviews.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-foreground">Tenant Feedback</p>
          {reviews.map((r: any) => (
            <div key={r.id} className={`${S.card} rounded-xl border p-4 space-y-1.5 shadow-sm`}>
              <div className="flex items-center justify-between gap-2">
                {renderStars(Number(r.rating), "w-3.5 h-3.5")}
                <span className="text-[10px] text-muted-foreground">{r.createdAt ? format(new Date(r.createdAt), "d MMM yyyy") : "—"}</span>
              </div>
              {r.title   && <p className="text-sm font-medium text-foreground">{r.title}</p>}
              {r.comment && <p className="text-xs text-muted-foreground leading-relaxed">{r.comment}</p>}
              {!r.comment && !r.title && <p className="text-xs text-muted-foreground italic">No comment left.</p>}
            </div>
          ))}
        </div>
      )}

      {total === 0 && (
        <div className="text-center py-8 text-muted-foreground text-xs">
          No reviews yet — keep up the great work and they'll come in soon!
        </div>
      )}
    </div>
  );
}

// ─── MaintenanceFeedbackPanel ─────────────────────────────────────────────────
// Shown to maintenance / general staff: aggregate satisfaction scores on jobs
// they handled. No tenant names, no personal comments — just the numbers.

function MaintenanceFeedbackPanel({ userId }: { userId?: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/ratings/my-maintenance-feedback"],
    queryFn: async () => (await apiRequest("/api/ratings/my-maintenance-feedback")).json(),
    enabled: !!userId,
  });

  const renderStars = (n: number) => (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`w-4 h-4 ${i <= Math.round(n) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );

  const ratingLabel = (n: number) => ["","Poor","Fair","Good","Very Good","Excellent"][Math.round(n)] ?? "";

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const avg: number = Number(data?.avgSatisfaction ?? 0);
  const totalRated: number = data?.totalRated ?? 0;
  const totalDone: number  = data?.totalCompleted ?? 0;
  const dist: Record<number, number> = data?.distribution ?? {};
  const recent: any[] = data?.recentRated ?? [];

  return (
    <div className="space-y-4">
      {/* ── Score card ────────────────────────────────────────────────── */}
      <div className={`${S.card} rounded-2xl border p-5 text-center shadow-sm`}>
        <p className="text-xs text-muted-foreground mb-1">Tenant Satisfaction Score</p>
        {totalRated > 0 ? (
          <>
            <p className="text-4xl font-bold text-foreground">{avg.toFixed(1)}<span className="text-base font-normal text-muted-foreground"> / 5</span></p>
            <div className="flex justify-center mt-2">{renderStars(avg)}</div>
            <p className="text-sm font-medium text-muted-foreground mt-1">{ratingLabel(avg)}</p>
            <p className="text-xs text-muted-foreground mt-1">{totalRated} of {totalDone} completed jobs rated</p>
          </>
        ) : (
          <>
            <p className="text-4xl font-bold text-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-2">
              {totalDone > 0 ? `${totalDone} jobs completed, none rated yet` : "No completed jobs yet"}
            </p>
          </>
        )}
      </div>

      {/* ── Distribution ─────────────────────────────────────────────── */}
      {totalRated > 0 && (
        <div className={`${S.card} rounded-2xl border p-4 shadow-sm space-y-2`}>
          <p className="text-xs font-semibold text-foreground mb-2">Score Distribution</p>
          {[5,4,3,2,1].map(n => {
            const count = dist[n] ?? 0;
            const pct = totalRated > 0 ? Math.round((count / totalRated) * 100) : 0;
            return (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-muted-foreground shrink-0">{n}</span>
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-6 text-right text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Recent rated jobs ─────────────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Recently Rated Jobs</p>
          {recent.map((j: any) => (
            <div key={j.id} className={`${S.card} rounded-xl border p-3 flex items-center justify-between gap-3 shadow-sm`}>
              <p className="text-sm text-foreground truncate flex-1">{j.title ?? `Job #${j.id}`}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                {[1,2,3,4,5].map(i => (
                  <Star key={i} className={`w-3 h-3 ${i <= Number(j.rating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                ))}
                <span className="text-xs text-muted-foreground ml-1">{Number(j.rating).toFixed(0)}/5</span>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground text-center pt-1">Individual tenant comments are not shown to protect privacy.</p>
        </div>
      )}

      {totalRated === 0 && totalDone === 0 && (
        <div className="text-center py-8 text-muted-foreground text-xs">
          Complete and get jobs rated to see your satisfaction score here.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function StaffPortal() {
  const { user, isLoading: authLoading } = useAuth();
  const { theme } = useDarkModeContext();
  const [tab, setTab] = useState("role");
  const [notifOpen, setNotifOpen] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);

  // ── First-run overlay — show once per user per browser ────────────────────
  useEffect(() => {
    if (user?.id && needsFirstRun(user.id)) {
      const t = setTimeout(() => setShowFirstRun(true), 600);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  const { data: staffList } = useQuery({
    queryKey: ["/api/staff-members"],
    queryFn: async () => { const r = await apiRequest("/api/staff-members"); return ensureArray(await r.json()); },
    retry: false,
    enabled: !!user,
  });

  // Dedicated /me endpoint — tries user_id, then email, then name.
  // Much more reliable than client-side filtering the full list.
  const { data: staffProfileRaw } = useQuery({
    queryKey: ["/api/staff-members/me"],
    queryFn: async () => {
      const r = await apiRequest("/api/staff-members/me");
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: orgUsers } = useQuery({
    queryKey: ["/api/auth/users"],
    queryFn: async () => { const r = await apiRequest("/api/auth/users"); return ensureArray(await r.json()); },
    retry: false,
    enabled: !!user,
  });

  // Use /me result first; fall back to email-match from list for backwards compatibility
  const staffProfile = useMemo(() => {
    if (staffProfileRaw !== undefined) return staffProfileRaw; // null means not found, use null
    if (!staffList || !user) return null;
    return ensureArray(staffList).find(
      (s: any) => s.email?.toLowerCase() === user.email?.toLowerCase()
    ) ?? null;
  }, [staffProfileRaw, staffList, user]);

  const role = useMemo(() => detectRole(staffProfile, user), [staffProfile, user]);
  const meta = ROLE_META[role];

  const fullName = staffProfile
    ? `${staffProfile.first_name} ${staffProfile.last_name}`
    : [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Staff Member";
  const position = staffProfile?.position?.replace(/_/g," ") ?? user?.role?.replace(/_/g," ") ?? "Staff";
  const department = staffProfile?.department?.replace(/_/g," ") ?? "";


  const STAFF_ROLES = ["staff", "caretaker", "admin", "manager"];
  if (!authLoading && user && !STAFF_ROLES.includes(user.role)) {
    return (<div className="flex items-center justify-center min-h-[60vh] p-6"><div className="text-center max-w-sm space-y-3"><div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto"><span className="text-2xl">🔒</span></div><h2 className="text-lg font-semibold text-foreground">Access restricted</h2><p className="text-sm text-muted-foreground">The staff portal is for property staff and caretakers.</p></div></div>);
  }
  if (!authLoading && user && !user.organizationId) {
    return (<div className="flex items-center justify-center min-h-[60vh] p-6"><div className="text-center max-w-sm space-y-3"><div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto"><span className="text-2xl">🏢</span></div><h2 className="text-lg font-semibold text-foreground">No organisation linked</h2><p className="text-sm text-muted-foreground">Your account is not linked to an organisation.</p></div></div>);
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">

      {/* ── First-run welcome overlay ── */}
      {showFirstRun && (
        <FirstRunOverlay
          userId={user?.id ?? "unknown"}
          role="staff"
          firstName={user?.firstName ?? ""}
          staffPosition={position}
          onDismiss={() => {
            markFirstRunDone(user?.id ?? "unknown");
            setShowFirstRun(false);
          }}
        />
      )}

      {/* Role-coloured header — darkens slightly in gray/dark modes */}
      <div className={`bg-gradient-to-r ${meta.bg}  text-white px-4 py-5 shadow-lg`}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shadow">
                <meta.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold leading-tight">{fullName}</p>
                <p className="text-white/70 text-sm capitalize">{[position, department].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className="text-right flex items-center gap-2">
              {/* NotificationBell removed — use the bell in the top-bar instead */}
              {/* <NotificationBell onOpen={() => setNotifOpen(true)} /> */}
              <div>
                <Badge className="bg-white/20 text-white border-white/30 text-xs capitalize">{meta.label}</Badge>
                <p className="text-xs text-white/60 mt-1">{format(new Date(), "EEE, dd MMM")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification drawer removed — use top-bar bell instead */}
      {/* <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} /> */}

      {/* Body */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-20 lg:pb-8">
        <Tabs value={tab} onValueChange={setTab}>
          {/* Desktop: full-width tab bar. Mobile: scrollable pill bar */}
          <div className="flex gap-1 bg-muted/40 p-1 rounded-xl border border-border mb-6">
            {([
              { id: "role",     label: meta.tabLabel,  icon: meta.tabIcon },
              // Ratings tab removed — not yet in use
              // { id: "ratings",  label: "My Ratings",   icon: Star },
              // Messages tab removed — use the Messages link in the sidebar instead
              // { id: "messages", label: "Messages",      icon: MessageSquare },
              // Profile tab removed — use the Profile link in the sidebar instead
              // { id: "profile",  label: "Profile",       icon: User },
            ] as any[]).map((item) => (
              <button key={item.id} onClick={() => setTab(item.id)}
                className={`flex items-center justify-center gap-2 flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  tab === item.id
                    ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                <item.icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <TabsList className="hidden">
            <TabsTrigger value="role" />
            {/* <TabsTrigger value="ratings" /> — removed */}
            {/* <TabsTrigger value="messages" /> — removed, use sidebar Messages link */}
            {/* <TabsTrigger value="profile" /> — removed, use sidebar Profile link */}
          </TabsList>

          {/* Role-specific content */}
          <TabsContent value="role">
            {role === "maintenance" && <MaintenancePanel user={user} staffProfile={staffProfile} />}
            {role === "security"    && <SecurityPanel />}
            {role === "finance"     && <FinancePanel />}
            {role === "leasing"     && <LeasingPanel />}
            {role === "admin"       && <AdminPanel />}
          </TabsContent>

          {/* Ratings tab removed
          <TabsContent value="ratings">
            {user?.role === "caretaker"
              ? <CaretakerRatingsPanel />
              : <MaintenanceFeedbackPanel userId={user?.id} />
            }
          </TabsContent>
          */}

          {/* Messages tab removed — use the Messages link in the sidebar instead
          <TabsContent value="messages">
            <MessagesPanel user={user} orgUsers={ensureArray(orgUsers)} />
          </TabsContent>
          */}

          {/* Profile tab removed — staff can use the sidebar Profile link instead
          <TabsContent value="profile">
            <div className="space-y-4">
              <ProfilePanel staffProfile={staffProfile} />
              <HRPanel staffProfile={staffProfile} />
            </div>
          </TabsContent>
          */}
        </Tabs>
      </div>

      {/* ── Staff Portal Bottom Navigation (mobile only) ──────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="max-w-4xl mx-auto flex items-stretch h-16">
          {([
            { id: "role",     icon: meta.tabIcon, label: meta.tabLabel },
            // Ratings removed
            // { id: "ratings",  icon: Star,         label: "Ratings" },
            // Messages removed — use sidebar Messages link instead
            // { id: "messages", icon: MessageSquare, label: "Messages" },
            // Profile removed — use sidebar Profile link instead
            // { id: "profile",  icon: User,          label: "Profile" },
          ] as const).map((item: any) => {
            const active = tab === item.id;
            return (
              <button key={item.id} onClick={() => setTab(item.id)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 relative transition-colors ${
                  active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:text-foreground"
                }`}>
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-emerald-600 rounded-b-full" />}
                <item.icon className={`w-5 h-5 ${active ? "stroke-[2.5]" : ""}`} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}