/**
 * Citizen Reporting — manager-facing view of all tenant maintenance requests.
 *
 * Sits at /citizen-reporting in the manager sidebar (under Tenants → Citizen reporting).
 * Managers can: view all submitted reports, filter/search, update statuses,
 * assign technicians, post comments, and see resolution rates.
 *
 * Tenants submit requests through /tenant-portal → Submit Repair Request,
 * which already correctly supplies tenantId + unitId.
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { getHomeForRole } from "@/lib/roleNav";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  AlertTriangle, CheckCircle, Clock, Users, RefreshCw,
  MessageSquare, ChevronDown, ChevronUp, Loader2, X,
  Search, Building2, Wrench, Star, Send,
  ArrowUpRight, ArrowDownRight, Lock,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};
const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy, HH:mm"); } catch { return "—"; }
};

const STATUS_CFG: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pending:     { label: "Pending",     cls: "bg-blue-100   text-blue-800   dark:bg-blue-900   dark:text-blue-200",   icon: Clock       },
  assigned:    { label: "Assigned",    cls: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: Users       },
  in_progress: { label: "In Progress", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: RefreshCw   },
  completed:   { label: "Resolved",    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" ,  icon: CheckCircle },
  cancelled:   { label: "Cancelled",   cls: "bg-gray-100   text-muted-foreground   dark:bg-gray-800   ",   icon: X           },
};

const PRIORITY_CFG: Record<string, { label: string; cls: string }> = {
  low:      { label: "Low",      cls: "bg-emerald-50 text-emerald-700 border border-emerald-200"},
  medium:   { label: "Medium",   cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  urgent:   { label: "Urgent",   cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
  critical: { label: "Critical", cls: "bg-red-100    text-red-800    dark:bg-red-900    dark:text-red-200"    },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <Badge className={`text-xs px-2 py-0.5 flex items-center gap-1 w-fit ${cfg.cls}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CFG[priority] ?? PRIORITY_CFG.medium;
  return <Badge className={`text-xs px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>;
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KPICard({
  title, value, sub, icon: Icon, iconColor, bgColor, trend,
}: {
  title: string; value: string | number; sub: string;
  icon: React.ElementType; iconColor: string; bgColor: string;
  trend?: { direction: "up" | "down" | "neutral"; label: string };
}) {
  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bgColor}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          {trend && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${
              trend.direction === "up" ? "text-green-600" :
              trend.direction === "down" ? "text-red-500" : "text-muted-foreground"
            }`}>
              {trend.direction === "up"   && <ArrowUpRight   className="w-3.5 h-3.5" />}
              {trend.direction === "down" && <ArrowDownRight className="w-3.5 h-3.5" />}
              {trend.label}
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Expanded report detail panel ────────────────────────────────────────────

function ReportDetail({ report, userRole }: { report: any; userRole: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [assignee, setAssignee] = useState(report.assignedTo ?? "");
  const [nextStatus, setNextStatus] = useState(report.status);

  // Fetch staff for assignee dropdown
  const canEdit = canManage(userRole);
  const canPostComment = canComment(userRole);
  const { data: staffRaw, isLoading: staffLoading } = useQuery<any[]>({
    queryKey: ["/api/staff-members"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/staff-members")).json()),
    staleTime: 10 * 60 * 1000,
    enabled: canEdit,
  });
  const activeStaff: any[] = (Array.isArray(staffRaw) ? staffRaw : [])
    .filter(s => !s.status || s.status === "active");

  // Build the full-name list so we can detect if the stored assignedTo is already in the list
  const staffNames = activeStaff.map(s => `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim());
  // If the saved name isn't in the staff list (legacy ID or free-text), surface it as a special option
  const storedAssignee = report.assignedTo ?? "";
  const storedIsOrphan = storedAssignee && !staffNames.includes(storedAssignee);

  // Fetch comments
  const { data: commentsRaw = [], isLoading: loadingComments } = useQuery<any[]>({
    queryKey: [`/api/maintenance-requests/${report.id}/comments`],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/maintenance-requests/${report.id}/comments`)).json()),
    staleTime: 30_000,
  });
  const comments: any[] = Array.isArray(commentsRaw) ? commentsRaw : [];

  // Post comment
  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      const r = await apiRequest(`/api/maintenance-requests/${report.id}/comments`, { method: "POST", data: { content } });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/maintenance-requests/${report.id}/comments`] });
      setCommentText("");
      toast({ title: "Comment posted" });
    },
    onError: () => toast({ title: "Could not post comment", variant: "destructive" }),
  });

  // Update status / assignee
  const updateMutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const r = await apiRequest(`/api/maintenance-requests/${report.id}`, { method: "PUT", data: patch });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      toast({ title: "Report updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  // Keep local state in sync when the report refreshes after a successful save
  useEffect(() => { setAssignee(report.assignedTo ?? ""); }, [report.assignedTo]);
  useEffect(() => { setNextStatus(report.status); },         [report.status]);

  const handleSaveChanges = () => {
    const patch: Record<string, any> = {};
    if (nextStatus !== report.status) patch.status = nextStatus;
    if (assignee !== (report.assignedTo ?? "")) patch.assignedTo = assignee || null;
    if (Object.keys(patch).length > 0) updateMutation.mutate(patch);
  };

  return (
    <div className="border-t border-border bg-muted/30 dark:bg-gray-900/30 p-4 space-y-5">

      {/* Tenant / property info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Tenant</span>
          <p className="font-medium mt-0.5">
            {report.tenant ? `${report.tenant.firstName} ${report.tenant.lastName}` : "—"}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Contact</span>
          <p className="font-medium mt-0.5">{report.tenant?.email || "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Property</span>
          <p className="font-medium mt-0.5">{report.property?.name || "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Unit</span>
          <p className="font-medium mt-0.5">{report.unit ? `Unit ${report.unit.unitNumber}` : "—"}</p>
        </div>
      </div>

      {/* Status & assignee controls — admins and managers only */}
      {canEdit && <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Update Status</Label>
          <Select value={nextStatus} onValueChange={setNextStatus}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_CFG).map(([v, cfg]) => (
                <SelectItem key={v} value={v} className="text-xs">{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Assign Technician</Label>
          <Select
            value={assignee || "__unassigned__"}
            onValueChange={v => setAssignee(v === "__unassigned__" ? "" : v)}
            disabled={staffLoading}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={staffLoading ? "Loading staff…" : "Select technician…"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__" className="text-xs text-muted-foreground">— Unassigned —</SelectItem>
              {/* If the saved value isn't in the staff list (e.g. was stored as an ID or free text),
                  show it as its own option so the dropdown still reflects the current assignment */}
              {storedIsOrphan && (
                <SelectItem value={storedAssignee} className="text-xs text-amber-700 dark:text-amber-400">
                  {storedAssignee} (not in staff list)
                </SelectItem>
              )}
              {activeStaff.map(s => {
                const fullName = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
                const label    = s.position ? `${fullName} · ${s.position}` : fullName;
                return (
                  <SelectItem key={s.id} value={fullName} className="text-xs">
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={handleSaveChanges}
          disabled={updateMutation.isPending || (nextStatus === report.status && assignee === (report.assignedTo ?? ""))}
        >
          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Changes"}
        </Button>
      </div>}
      {!canEdit && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" />
          <span>Status updates are managed by property staff.</span>
        </div>
      )}

      {/* Satisfaction rating (if given) */}
      {report.satisfactionRating > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Tenant rating:</span>
          <div className="flex gap-0.5">
            {[1,2,3,4,5].map(n => (
              <Star key={n} className={`w-3.5 h-3.5 ${n <= report.satisfactionRating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
            ))}
          </div>
          {report.satisfactionComments && (
            <span className="italic">"{report.satisfactionComments}"</span>
          )}
        </div>
      )}

      {/* Comments thread */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" /> Updates & Comments
        </p>
        {loadingComments ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No comments yet.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {comments.map((c: any) => (
              <div key={c.id} className={`p-2.5 rounded-lg text-xs ${
                c.isTechnician
                  ? "bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800"
                  : "bg-card border border-border"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground">{c.authorName}</span>
                  {c.isTechnician && (
                    <Badge className="text-[10px] px-1 py-0 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Staff</Badge>
                  )}
                  <span className="text-muted-foreground ml-auto">{fmtDateTime(c.createdAt)}</span>
                </div>
                <p className="text-foreground/80">{c.content}</p>
              </div>
            ))}
          </div>
        )}
        {/* Post comment — gated by role */}
        {canPostComment ? <div className="flex gap-2">
          <Input
            placeholder="Post an update visible to all staff…"
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && commentText.trim()) {
                e.preventDefault();
                commentMutation.mutate(commentText.trim());
              }
            }}
            className="text-xs h-8"
          />
          <Button
            size="sm" className="h-8 px-3"
            disabled={!commentText.trim() || commentMutation.isPending}
            onClick={() => commentMutation.mutate(commentText.trim())}
          >
            {commentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
        </div> : (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Comments are not available for your role.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Report row ───────────────────────────────────────────────────────────────

function ReportRow({ report, userRole }: { report: any; userRole: string }) {
  const [expanded, setExpanded] = useState(false);

  const isUrgent  = ["urgent", "critical"].includes(report.priority);
  const isActive  = report.status === "in_progress";

  return (
    <div className={`rounded-xl border border-border overflow-hidden ${
      isUrgent   ? "border-l-4 border-l-red-500"    :
      isActive   ? "border-l-4 border-l-yellow-500" :
      report.status === "completed" ? "border-l-4 border-l-green-500" : ""
    }`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {isActive && <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse flex-shrink-0" />}
              <p className="font-semibold text-sm text-foreground">{report.title}</p>
              <StatusBadge status={report.status} />
              <PriorityBadge priority={report.priority} />
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{report.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              {report.tenant && (
                <span className="font-medium text-foreground">
                  {report.tenant.firstName} {report.tenant.lastName}
                </span>
              )}
              {report.property?.name && <span>📍 {report.property.name}</span>}
              {report.unit?.unitNumber && <span>Unit {report.unit.unitNumber}</span>}
              <span className="capitalize">{report.category || "General"}</span>
              <span>#{report.ticketNumber}</span>
              <span>{fmtDate(report.createdAt)}</span>
            </div>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? "Collapse" : canManage(userRole) ? "Manage" : "View"}
          </button>
        </div>
      </div>
      {expanded && <ReportDetail report={report} userRole={userRole} />}
    </div>
  );
}

// ─── Role helpers ────────────────────────────────────────────────────────────

type UserRole = "admin" | "manager" | "landlord" | "staff" | "caretaker" | "tenant" | "guard" | "contractor";
const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "landlord", "staff", "caretaker", "tenant"];
const CAN_MANAGE:   UserRole[] = ["admin", "manager"];
const CAN_COMMENT:  UserRole[] = ["admin", "manager", "staff", "caretaker", "tenant"];
function canManage(role?: string)  { return CAN_MANAGE.includes(role as UserRole); }
function canComment(role?: string) { return CAN_COMMENT.includes(role as UserRole); }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CitizenReporting() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const userRole = (user?.role ?? "") as UserRole;
  const orgId    = user?.organizationId as number | undefined;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Org guard
  if (!orgId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
          <p className="text-sm font-medium">No organisation found</p>
          <p className="text-xs text-muted-foreground">Your account isn't linked to an organisation yet.</p>
        </div>
      </div>
    );
  }

  // Role guard — guard / contractor have no business here
  if (!ALLOWED_ROLES.includes(userRole)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Lock className="w-12 h-12 text-muted-foreground mx-auto opacity-40" />
          <p className="text-sm font-medium text-foreground">Access Restricted</p>
          <p className="text-xs text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return <CitizenReportingInner userRole={userRole} />;
}

// ─── Inner component (only rendered after role + org checks pass) ─────────────

function CitizenReportingInner({ userRole }: { userRole: UserRole }) {
  const queryClient = useQueryClient();

  const [search,         setSearch]     = useState("");
  const [statusFilter,   setStatus]     = useState("all");
  const [priorityFilter, setPriority]   = useState("all");
  const [categoryFilter, setCategory]   = useState("all");
  const [pageSize,       setPageSize]   = useState(10);
  const [page,           setPage]       = useState(1);

  // The server scopes this query per role automatically:
  //   - tenant  → only their own requests (server resolves tenantId from JWT userId)
  //   - landlord → only their properties' requests
  //   - caretaker → only their assigned property
  //   - admin/manager/staff → all org requests
  const { data: reportsRaw, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests")).json()),
    staleTime: 2 * 60 * 1000,
  });

  const allReports: any[] = Array.isArray(reportsRaw) ? reportsRaw : [];

  // ── KPI metrics
  const stats = useMemo(() => {
    const total      = allReports.length;
    const pending    = allReports.filter(r => r.status === "pending").length;
    const inProgress = allReports.filter(r => r.status === "in_progress").length;
    const resolved   = allReports.filter(r => r.status === "completed").length;
    const urgent     = allReports.filter(r => ["urgent", "critical"].includes(r.priority) && r.status !== "completed").length;
    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const resolvedWithTimes = allReports.filter(r => r.status === "completed" && r.createdAt && r.updatedAt);
    const avgDays = resolvedWithTimes.length > 0
      ? Math.round(resolvedWithTimes.reduce((s, r) =>
          s + (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 86_400_000, 0
        ) / resolvedWithTimes.length)
      : 0;
    return { total, pending, inProgress, resolved, urgent, resolutionRate, avgDays };
  }, [allReports]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    allReports.forEach(r => r.category && s.add(r.category));
    return [...s].sort();
  }, [allReports]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    allReports.forEach(r => { const c = r.category || "other"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [allReports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allReports.filter(r => {
      if (statusFilter   !== "all" && r.status   !== statusFilter)   return false;
      if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (q) {
        const tenantName = r.tenant ? `${r.tenant.firstName} ${r.tenant.lastName}` : "";
        const haystack = [r.title, r.description, r.ticketNumber, tenantName, r.property?.name, r.unit?.unitNumber]
          .map(v => (v ?? "").toLowerCase()).join(" ");
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allReports, search, statusFilter, priorityFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const pageSlice  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const resetPage  = () => setPage(1);

  const pageSubtitle =
    userRole === "tenant"   ? "Your submitted maintenance requests" :
    userRole === "landlord" ? "Maintenance requests for your properties" :
    "Tenant-submitted maintenance requests across all properties";

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Wrench className="w-5 h-5 text-green-600" />
              {userRole === "tenant" ? "My Maintenance Requests" : "Citizen Reporting"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{pageSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs capitalize text-muted-foreground">
              {userRole} view
            </Badge>
            <Button variant="outline" size="sm" onClick={() => { refetch(); }}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title={userRole === "tenant" ? "My Reports" : "Total Reports"}
            value={stats.total} sub="All time"
            icon={Building2} iconColor="text-blue-600" bgColor="bg-blue-50 dark:bg-blue-950"
          />
          <KPICard
            title="Needs Attention" value={stats.pending + stats.inProgress}
            sub={`${stats.pending} pending · ${stats.inProgress} in progress`}
            icon={Clock} iconColor="text-yellow-600" bgColor="bg-yellow-50 dark:bg-yellow-950"
            trend={stats.urgent > 0 ? { direction: "down", label: `${stats.urgent} urgent` } : { direction: "neutral", label: "No urgent" }}
          />
          <KPICard
            title="Resolved" value={stats.resolved} sub={`${stats.resolutionRate}% resolution rate`}
            icon={CheckCircle} iconColor="text-green-600" bgColor="bg-green-50 dark:bg-green-950"
            trend={{ direction: stats.resolutionRate >= 80 ? "up" : "down", label: `${stats.resolutionRate}%` }}
          />
          <KPICard
            title="Avg Resolution" value={stats.avgDays > 0 ? `${stats.avgDays}d` : "—"}
            sub="For completed requests"
            icon={RefreshCw} iconColor="text-purple-600" bgColor="bg-purple-50 dark:bg-purple-950"
            trend={stats.avgDays > 0 && stats.avgDays <= 7
              ? { direction: "up",   label: "Within SLA" }
              : stats.avgDays > 7 ? { direction: "down", label: "Above 7d SLA" }
              : { direction: "neutral", label: "No data" }}
          />
        </div>

        {/* Filters + search */}
        <Card className="rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-base">
                  {userRole === "tenant" ? "My Requests" : "All Reports"}
                </CardTitle>
                <CardDescription>
                  {filtered.length} of {allReports.length} report{allReports.length !== 1 ? "s" : ""}
                  {search && ` matching "${search}"`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={e => { setSearch(e.target.value); resetPage(); }}
                    placeholder="Title, ticket…"
                    className="pl-8 pr-7 h-8 w-48 text-xs"
                  />
                  {search && (
                    <button onClick={() => { setSearch(""); resetPage(); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <Select value={statusFilter} onValueChange={v => { setStatus(v); resetPage(); }}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {Object.entries(STATUS_CFG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v} className="text-xs">{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={v => { setPriority(v); resetPage(); }}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    {Object.entries(PRIORITY_CFG).map(([v, cfg]) => (
                      <SelectItem key={v} value={v} className="text-xs">{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categories.length > 0 && (
                  <Select value={categoryFilter} onValueChange={v => { setCategory(v); resetPage(); }}>
                    <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map(c => (
                        <SelectItem key={c} value={c} className="text-xs capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex items-center gap-1">
                  {[5, 10, 20, 50].map(n => (
                    <button key={n} onClick={() => { setPageSize(n); resetPage(); }}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        pageSize === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading reports…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Wrench className="w-10 h-10 opacity-20" />
                <p className="text-sm font-medium">
                  {allReports.length === 0
                    ? userRole === "tenant"
                      ? "You haven't submitted any requests yet"
                      : "No reports submitted yet"
                    : "No reports match the current filters"}
                </p>
                {allReports.length === 0 && userRole !== "tenant" && (
                  <p className="text-xs text-center max-w-xs">
                    Tenants submit reports through the Tenant Portal → Submit Repair Request.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
                </p>
                <div className="space-y-3">
                  {pageSlice.map(report => (
                    <ReportRow key={report.id} report={report} userRole={userRole} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                        className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                        ‹ Prev
                      </button>
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        const start = Math.max(1, Math.min(safePage - 2, totalPages - 4));
                        const p = start + i;
                        return p <= totalPages ? (
                          <button key={p} onClick={() => setPage(p)}
                            className={`text-xs w-7 h-7 rounded-md border transition-colors ${
                              p === safePage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                            }`}>
                            {p}
                          </button>
                        ) : null;
                      })}
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                        className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                        Next ›
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Resolution breakdown — skip for tenants */}
        {allReports.length > 0 && userRole !== "tenant" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status Breakdown</CardTitle>
                <CardDescription>All reports by current status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(STATUS_CFG).map(([status, cfg]) => {
                  const count = allReports.filter(r => r.status === status).length;
                  if (count === 0) return null;
                  const pct = Math.round((count / allReports.length) * 100);
                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <StatusBadge status={status} />
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">By Category</CardTitle>
                <CardDescription>Most reported issue types</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {categoryCounts.map(([cat, count]) => {
                    const max = allReports.length;
                    return (
                      <div key={cat} className="flex items-center gap-3">
                        <span className="text-xs capitalize text-muted-foreground w-24 flex-shrink-0 truncate">{cat}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.round((count / max) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-foreground w-5 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}