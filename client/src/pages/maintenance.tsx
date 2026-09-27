import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
 Plus, Search, Wrench, AlertTriangle, CheckCircle, Clock,
 Eye, Edit, MoreVertical, Download, X, ChevronRight,
 User, Building, Calendar, ThumbsUp, ThumbsDown, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem,
 DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
 Dialog, DialogContent, DialogDescription,
 DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileActionSheet } from "@/components/ui/mobile-action-sheet";
import AddMaintenanceModal from "@/components/modals/add-maintenance-modal";
import ViewMaintenanceModal from "@/components/modals/view-maintenance-modal";
import EditMaintenanceModal from "@/components/modals/edit-maintenance-modal";
import { formatDistanceToNow } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useAuth } from "@/hooks/useAuth";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


interface MaintenanceRequest {
 id: number;
 title: string;
 description: string;
 priority: string;
 status: string;
 assignedTo?: string;
 estimatedCost?: string;
 category?: string;
 createdAt: string;
 tenant?: { firstName: string; lastName: string; email?: string };
 unit?: { id: number; unitNumber: string };
 property?: { id: number; name: string };
 technician?: { id: number; name: string; specialty?: string };
}

function PriorityBadge({ p }: { p: string }) {
 const m: Record<string,string> = {
 urgent: "bg-red-100 text-red-700 border border-red-200",
 high: "bg-orange-100 text-orange-700 border border-orange-200",
 medium: "bg-amber-100 text-amber-700 border border-amber-200",
 low: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 };
 return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${m[p] ?? m.low}`}>{p}</span>;
}

function StatusBadge({ s }: { s: string }) {
 const m: Record<string,string> = {
 pending: "bg-amber-100 text-amber-700",
 pending_approval: "bg-violet-100 text-violet-700 border border-violet-200",
 assigned: "bg-blue-100 text-blue-700",
 in_progress: "bg-purple-100 text-purple-700",
 completed: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 cancelled: "bg-muted text-muted-foreground",
 };
 return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${m[s] ?? "bg-muted text-muted-foreground"}`}>{s.replace(/_/g, " ")}</span>;
}

function PriorityDot({ p }: { p: string }) {
 const m: Record<string,string> = { urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-green-400" };
 return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${m[p] ?? m.low}`} />;
}

const formatCost = (cost?: string | null) => {
  if (!cost) return "—";
  const n = parseFloat(cost);
  return isNaN(n) ? "—" : `KSh ${n.toLocaleString()}`;
};

// ── Approve/Reject Dialog ────────────────────────────────────────────────────
function ApprovalDialog({
  request,
  open,
  onOpenChange,
}: {
  request: MaintenanceRequest | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [comments, setComments] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Reset state whenever a different request is loaded into this dialog —
  // must be useEffect, not useState: this component instance persists across
  // different requests (no key prop forces a remount), so a useState
  // initializer would only ever run once, on the very first request shown,
  // leaking stale comments/approvedAmount into every subsequent approval.
  useEffect(() => {
    if (request) {
      setDecision("approved");
      setComments("");
      setApprovedAmount(request.estimatedCost ?? "");
    }
  }, [request]);

  const approvalMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: object }) => {
      return await apiRequest(`/api/maintenance-requests/${id}/approve`, {
        method: "POST",
        data: payload,
      });
    },
    onSuccess: () => {
      toast({
        title: decision === "approved" ? "Request approved" : "Request rejected",
        description: "The maintenance request has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      onOpenChange(false);
      setComments("");
      setApprovedAmount("");
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not process the approval. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!request) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>Review Maintenance Request</DialogTitle>
          <DialogDescription>Approve or reject this request</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Summary */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm text-foreground leading-snug">{request.title}</p>
              <PriorityBadge p={request.priority} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{request.description}</p>
            <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground flex-wrap">
              {request.property?.name && (
                <span className="flex items-center gap-1">
                  <Building className="w-3 h-3" />
                  {request.property.name}
                  {request.unit?.unitNumber && ` · Unit ${request.unit.unitNumber}`}
                </span>
              )}
              {request.tenant && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {request.tenant.firstName} {request.tenant.lastName}
                </span>
              )}
              {request.category && (
                <span className="flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  {request.category}
                </span>
              )}
            </div>
          </div>

          {/* Decision */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Decision</Label>
              <Select value={decision} onValueChange={(v: "approved" | "rejected") => setDecision(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approve</SelectItem>
                  <SelectItem value="rejected">Reject</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Approved Amount
                {request.estimatedCost && (
                  <span className="text-muted-foreground font-normal ml-1">(est. {formatCost(request.estimatedCost)})</span>
                )}
              </Label>
              <Input
                type="number"
                className="h-9 text-sm"
                placeholder={request.estimatedCost ?? "0"}
                value={approvedAmount}
                onChange={e => setApprovedAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Comments {decision === "rejected" && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              placeholder={decision === "approved" ? "Optional notes…" : "Reason for rejection…"}
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={3}
              className="text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={approvalMutation.isPending || (decision === "rejected" && !comments.trim())}
            className={decision === "approved"
              ? "bg-green-600 hover:bg-green-700 text-white"
              : "bg-red-600 hover:bg-red-700 text-white"
            }
            onClick={() => {
              if (!request) return;
              approvalMutation.mutate({
                id: request.id,
                payload: {
                  approvalStatus: decision,
                  comments: comments || undefined,
                  approvedAmount: approvedAmount ? parseFloat(approvedAmount) : undefined,
                },
              });
            }}
          >
            {approvalMutation.isPending
              ? "Processing…"
              : decision === "approved" ? "Approve Request" : "Reject Request"
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Mobile maintenance card with Action Sheet
function MobileMaintenanceCard({
  r,
  onView,
  onEdit,
  onComplete,
  onApprove,
  canActProp,
}: {
  r: MaintenanceRequest;
  onView: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onApprove: () => void;
  canActProp: boolean;
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const canComplete = r.status !== "completed" && r.status !== "cancelled";
  const needsApproval = r.status === "pending_approval";

  const actions = [
    { label: "View Details", icon: Eye, onClick: onView },
    { label: "Edit Request", icon: Edit, onClick: onEdit },
    ...(needsApproval && canActProp ? [{ label: "Approve / Reject", icon: ShieldCheck, onClick: onApprove, className: "text-violet-600" }] : []),
    ...(canComplete && !needsApproval && canActProp ? [{ label: "Mark as Completed", icon: CheckCircle, onClick: onComplete, className: "text-green-600" }] : []),
  ];

  return (
    <>
      <div
        className="relative bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-4 py-3.5 active:bg-muted transition-colors cursor-pointer"
        onClick={() => setIsSheetOpen(true)}
      >
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 mt-0.5"
            style={{ background: r.priority === "urgent" ? "#fee2e2" : r.priority === "high" ? "#ffedd5" : r.priority === "medium" ? "#fef3c7" : "#dcfce7" }}>
            <PriorityDot p={r.priority} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-semibold text-foreground text-sm truncate">{r.title}</p>
            </div>
            <p className="text-xs text-muted-foreground truncate mb-1.5">{r.description}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <PriorityBadge p={r.priority} />
              <StatusBadge s={r.status} />
              {r.property && <span className="text-xs text-muted-foreground">{r.property.name}</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
            </p>
          </div>
          <MoreVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
        </div>
      </div>

      <MobileActionSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title="Maintenance Actions"
        description={`Manage request: ${r.title}`}
        actions={actions}
      />
    </>
  );
}

export default function Maintenance() {
  const guard = useRoleGuard(ROLES.CARETAKER_ALLOWED);
  if (guard.gate) return guard.gate;

 const [search, setSearch] = useState("");
 const [priorityFilter, setPriorityFilter] = useState("all");
 const [statusFilter, setStatusFilter] = useState("all");
 const [page, setPage] = useState(1);
 const [pageSize, setPageSize] = useState(15);
 const [isAddOpen, setIsAddOpen] = useState(false);
 const [isViewOpen, setIsViewOpen] = useState(false);
 const [isEditOpen, setIsEditOpen] = useState(false);
 const [isApprovalOpen, setIsApprovalOpen] = useState(false);
 const [selected, setSelected] = useState<MaintenanceRequest | null>(null);
 const PER_PAGE = pageSize;
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const [, navigate] = useLocation();
 const isMobile = useIsMobile();
 const { user } = useAuth();
 const isManager = guard.canManage;
 const isStaff   = guard.isStaff || guard.isCaretaker;
 // Creating a request is deliberately NOT extended to landlord — a request
 // should originate from whoever is experiencing the issue (the tenant), not
 // be filed on their behalf by the landlord. Acting on a request that already
 // exists (approve/reject, start work, mark complete) is a different action —
 // backend already allows landlord there (CARETAKER_ALLOWED in requireRole.ts)
 // — so canAct still includes landlord, canCreate does not.
 const canCreate = isManager || isStaff;
 const canAct    = isManager || isStaff || guard.isLandlord;

 const { data: raw = [], isLoading } = useQuery<any>({
 queryKey: ["/api/maintenance-requests"],
 queryFn: async () => { const r = await apiRequest("/api/maintenance-requests"); return ensureArray(await r.json()); },
 staleTime: 2 * 60 * 1000,
 });
 const requests: MaintenanceRequest[] = Array.isArray(raw) ? raw : (raw?.results ?? []);

 const updateMutation = useMutation({
 mutationFn: async ({ id, status }: { id: number; status: string }) => {
 await apiRequest(`/api/maintenance-requests/${id}`, { method: "PUT", data: { status } });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
 toast({ title: "Request updated" });
 },
 onError: () => toast({ title: "Update failed", variant: "destructive" }),
 });

 const stats = {
 open: requests.filter(r => ["pending","assigned"].includes(r.status)).length,
 inProgress: requests.filter(r => r.status === "in_progress").length,
 completed: requests.filter(r => r.status === "completed").length,
 urgent: requests.filter(r => r.priority === "urgent" && r.status !== "completed").length,
 pendingApproval: requests.filter(r => r.status === "pending_approval").length,
 };

 const filtered = requests.filter(r => {
 const q = search.toLowerCase();
 const matchSearch = !search ||
 r.title.toLowerCase().includes(q) ||
 r.description.toLowerCase().includes(q) ||
 `${r.tenant?.firstName ?? ""} ${r.tenant?.lastName ?? ""}`.toLowerCase().includes(q) ||
 r.unit?.unitNumber?.toLowerCase().includes(q) ||
 r.property?.name?.toLowerCase().includes(q);
 const matchPriority = priorityFilter === "all" || r.priority === priorityFilter;
 const matchStatus = statusFilter === "all" || r.status === statusFilter;
 return matchSearch && matchPriority && matchStatus;
 });

 const totalPages = Math.ceil(filtered.length / PER_PAGE);
 const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

 const handleExport = () => {
 const csv = ["ID,Title,Priority,Status,Property,Unit,Tenant,Created",
 ...filtered.map(r => `${r.id},"${r.title}","${r.priority}","${r.status}","${r.property?.name ?? ""}","${r.unit?.unitNumber ?? ""}","${r.tenant ? r.tenant.firstName + " " + r.tenant.lastName : ""}","${new Date(r.createdAt).toLocaleDateString()}"`)
 ].join("\n");
 const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `maintenance-${new Date().toISOString().split("T")[0]}.csv` });
 a.click();
 };

 const openApproval = (r: MaintenanceRequest) => {
   setSelected(r);
   setIsApprovalOpen(true);
 };

 if (isLoading) return (
 <div className="p-6 space-y-5 animate-pulse">
 <div className="h-8 bg-muted dark:bg-gray-700 rounded w-48" />
 <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_,i) => <div key={i} className="h-24 bg-muted dark:bg-gray-700 rounded-2xl" />)}</div>
 <div className="h-96 bg-muted dark:bg-gray-700 rounded-2xl" />
 </div>
 );

 return (
 <div className="min-h-screen bg-background">
 <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-4 md:px-6 py-4 md:py-5">
 <div className="max-w-7xl mx-auto flex items-center justify-between">
 <div>
 <h1 className="text-xl font-semibold text-foreground">Maintenance</h1>
 <p className="text-sm text-muted-foreground mt-0.5">{requests.length} total · {stats.open} open{stats.pendingApproval > 0 ? ` · ${stats.pendingApproval} awaiting approval` : ""}</p>
 </div>
 <div className="flex items-center gap-2">
 {!isMobile && <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1.5" />Export</Button>}
 {canCreate && (
 <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsAddOpen(true)}>
   <Plus className="w-4 h-4 mr-1.5" />
   <span className="hidden sm:inline">New request</span>
   <span className="sm:hidden">New</span>
 </Button>
 )}
 </div>
 </div>
 </div>

 <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5">
 {/* KPI strip */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
 {[
 { label: "Open", value: stats.open, icon: Clock, color: "amber" },
 { label: "In progress", value: stats.inProgress, icon: Wrench, color: "purple" },
 { label: "Completed", value: stats.completed, icon: CheckCircle, color: "green" },
 { label: stats.urgent > 0 ? "Urgent" : "Pending approval", value: stats.urgent > 0 ? stats.urgent : stats.pendingApproval, icon: stats.urgent > 0 ? AlertTriangle : ShieldCheck, color: stats.urgent > 0 ? "red" : stats.pendingApproval > 0 ? "violet" : "gray" },
 ].map(({ label, value, icon: Icon, color }) => (
 <Card key={label} className="rounded-xl border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
   onClick={() => { if (label === "Pending approval") { setStatusFilter("pending_approval"); setPage(1); } else if (label === "Urgent") { setPriorityFilter("urgent"); setPage(1); } }}>
 <CardContent className="p-4 md:p-5 flex items-center gap-3">
 <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-${color}-50`}>
 <Icon className={`w-4 h-4 text-${color}-600`} />
 </div>
 <div>
 <p className="text-xl font-semibold text-foreground">{value}</p>
 <p className="text-xs text-muted-foreground">{label}</p>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>

 {/* Toolbar */}
 <div className="flex flex-wrap items-center gap-2 md:gap-3">
 <div className="relative flex-1 min-w-[160px]">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input placeholder="Search requests..." className="pl-9 h-9 border-border dark:border-gray-700" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
 {search && <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
 </div>
 <Select value={priorityFilter} onValueChange={v => { setPriorityFilter(v); setPage(1); }}>
 <SelectTrigger className="w-28 md:w-32 h-9 border-border dark:border-gray-700 text-sm"><SelectValue placeholder="Priority" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All priorities</SelectItem>
 <SelectItem value="urgent">Urgent</SelectItem>
 <SelectItem value="high">High</SelectItem>
 <SelectItem value="medium">Medium</SelectItem>
 <SelectItem value="low">Low</SelectItem>
 </SelectContent>
 </Select>
 {!isMobile && (
 <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
 <SelectTrigger className="w-40 h-9 border-border dark:border-gray-700 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All statuses</SelectItem>
 <SelectItem value="pending">Pending</SelectItem>
 <SelectItem value="pending_approval">Pending approval</SelectItem>
 <SelectItem value="assigned">Assigned</SelectItem>
 <SelectItem value="in_progress">In progress</SelectItem>
 <SelectItem value="completed">Completed</SelectItem>
 <SelectItem value="cancelled">Cancelled</SelectItem>
 </SelectContent>
 </Select>
 )}
 {(search || priorityFilter !== "all" || statusFilter !== "all") && (
 <Button variant="ghost" size="sm" className="h-9 text-muted-foreground"
 onClick={() => { setSearch(""); setPriorityFilter("all"); setStatusFilter("all"); setPage(1); }}>
 <X className="w-3.5 h-3.5 mr-1" />Clear
 </Button>
 )}
 <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
   <SelectTrigger className="w-24 h-9 border-border dark:border-gray-700 text-sm"><SelectValue /></SelectTrigger>
   <SelectContent>
     <SelectItem value="10">10 / page</SelectItem>
     <SelectItem value="15">15 / page</SelectItem>
     <SelectItem value="25">25 / page</SelectItem>
     <SelectItem value="50">50 / page</SelectItem>
   </SelectContent>
 </Select>
 <span className="text-sm text-muted-foreground ml-auto">{filtered.length} results</span>
 </div>

 {/* MOBILE: card list */}
 {isMobile ? (
 <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
 {filtered.length === 0 ? (
 <CardContent className="py-16 text-center">
 <CheckCircle className="w-12 h-12 text-gray-200 mx-auto mb-3" />
 <p className="text-sm font-medium text-foreground">{search ? "No requests match" : "No maintenance requests"}</p>
 <p className="text-xs text-muted-foreground mt-1 mb-4">{search ? "Try adjusting filters" : "Create your first request"}</p>
 {!search && canCreate && <Button size="sm" onClick={() => setIsAddOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />New request</Button>}
 </CardContent>
 ) : (
 <>
 <div className="px-4 py-2 bg-muted dark:bg-gray-950 border-b border-border dark:border-gray-800" >
 <p className="text-xs text-muted-foreground">Tap a request for quick actions</p>
 </div>
 {paginated.map(r => (
 <MobileMaintenanceCard
 key={r.id}
 r={r}
 onView={() => { setSelected(r); setIsViewOpen(true); }}
 onEdit={() => { setSelected(r); setIsEditOpen(true); }}
 onComplete={() => updateMutation.mutate({ id: r.id, status: "completed" })}
 onApprove={() => openApproval(r)}
 canActProp={canAct}
 />
 ))}
 </>
 )}
 </Card>
 ) : (
 /* DESKTOP: full table */
 <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
 {paginated.length === 0 ? (
 <CardContent className="py-16 text-center">
 <CheckCircle className="w-12 h-12 text-gray-200 mx-auto mb-3" />
 <p className="text-sm font-medium text-foreground">{search ? "No requests match your search" : "No maintenance requests"}</p>
 <p className="text-xs text-muted-foreground mt-1 mb-4">{search ? "Try adjusting your filters" : "Create your first maintenance request"}</p>
 {!search && canCreate && <Button size="sm" onClick={() => setIsAddOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />New request</Button>}
 </CardContent>
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Request</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Location</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Tenant</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Priority</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Logged</th>
 <th className="px-4 py-3 w-10"></th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-50">
 {paginated.map(r => (
 <tr key={r.id} className="hover:bg-muted dark:bg-gray-950 transition-colors group cursor-pointer" onClick={() => { setSelected(r); setIsViewOpen(true); }}>
 <td className="px-4 py-3">
 <div className="flex items-center gap-2.5">
 <PriorityDot p={r.priority} />
 <div className="min-w-0">
 <p className="font-medium text-foreground truncate max-w-[200px]">{r.title}</p>
 <p className="text-xs text-muted-foreground truncate max-w-[200px]">{r.description}</p>
 </div>
 </div>
 </td>
 <td className="px-4 py-3 hidden md:table-cell">
 <p className="text-sm text-foreground dark:text-muted-foreground">{r.property?.name ?? <span className="text-muted-foreground">—</span>}</p>
 {r.unit && <p className="text-xs text-muted-foreground">Unit {r.unit.unitNumber}</p>}
 </td>
 <td className="px-4 py-3 hidden lg:table-cell">
 {r.tenant ? (
 <div className="flex items-center gap-2">
 <Avatar className="w-6 h-6">
 <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">{r.tenant.firstName[0]}{r.tenant.lastName[0]}</AvatarFallback>
 </Avatar>
 <span className="text-sm text-foreground dark:text-muted-foreground">{r.tenant.firstName} {r.tenant.lastName}</span>
 </div>
 ) : <span className="text-xs text-muted-foreground">No tenant</span>}
 </td>
 <td className="px-4 py-3"><PriorityBadge p={r.priority} /></td>
 <td className="px-4 py-3"><StatusBadge s={r.status} /></td>
 <td className="px-4 py-3 hidden lg:table-cell">
 <span className="text-xs text-muted-foreground">
 {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
 </span>
 </td>
 <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100">
 <MoreVertical className="w-3.5 h-3.5" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-44">
 <DropdownMenuItem onClick={() => { setSelected(r); setIsViewOpen(true); }}>
 <Eye className="w-4 h-4 mr-2" />View
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => { setSelected(r); setIsEditOpen(true); }}>
 <Edit className="w-4 h-4 mr-2" />Edit
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 {canAct && r.status === "pending_approval" && (
 <DropdownMenuItem className="text-violet-600" onClick={() => openApproval(r)}>
 <ShieldCheck className="w-4 h-4 mr-2" />Approve / Reject
 </DropdownMenuItem>
 )}
 {canAct && r.status !== "completed" && r.status !== "pending_approval" && (
 <DropdownMenuItem className="text-green-600"
 onClick={() => updateMutation.mutate({ id: r.id, status: "completed" })}>
 <CheckCircle className="w-4 h-4 mr-2" />Mark complete
 </DropdownMenuItem>
 )}
 {canAct && r.status === "pending" && (
 <DropdownMenuItem className="text-blue-600"
 onClick={() => updateMutation.mutate({ id: r.id, status: "in_progress" })}>
 <Wrench className="w-4 h-4 mr-2" />Start work
 </DropdownMenuItem>
 )}
 </DropdownMenuContent>
 </DropdownMenu>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 {totalPages > 1 && (
 <div className="flex items-center justify-between px-4 py-3 border-t border-border dark:border-gray-800" >
 <span className="text-xs text-muted-foreground">
 Showing {(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, filtered.length)} of {filtered.length}
 </span>
 <div className="flex items-center gap-1">
 <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page === 1} onClick={() => setPage(p => p-1)}>Previous</Button>
 <span className="text-xs text-muted-foreground px-2">{page} / {totalPages}</span>
 <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Next</Button>
 </div>
 </div>
 )}
 </>
 )}
 </Card>
 )}
 </div>

 {canCreate && <AddMaintenanceModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}
 onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); setIsAddOpen(false); }} />}
 <ViewMaintenanceModal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} request={selected} />
 <EditMaintenanceModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} request={selected} />
 <ApprovalDialog request={selected} open={isApprovalOpen} onOpenChange={setIsApprovalOpen} />
 </div>
 );
}