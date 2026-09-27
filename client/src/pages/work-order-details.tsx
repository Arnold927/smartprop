import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Building2, Phone, Mail, MapPin, Calendar, Clock,
  FileText, CheckCircle, AlertTriangle, DollarSign, Edit,
  Share2, Copy, Timer, AlertCircle, User, Plus, ArrowRight,
  MessageSquare, History, MoreVertical, PhoneCall,
  ExternalLink, Trash2, Send, Printer, RefreshCw, XCircle,
  Wrench, Home, Tag, FileSpreadsheet, BarChart3, DoorOpen,
  Download, UserCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { safeFormatDate, safeFormatDistanceToNow } from "@/utils/date-utils";
import { cn } from "@/lib/utils";

// ── helpers ───────────────────────────────────────────────────────────────────
const safeJson = async (res: Response) => {
  if (res.status === 204 || res.headers.get("content-length") === "0") return null;
  return res.json();
};

// ── types ─────────────────────────────────────────────────────────────────────
interface WorkOrder {
  id: number; ticketNumber: string; maintenanceRequestId: number;
  projectId: number | null; workOrderType: string; title: string;
  description: string; priority: string; status: string;
  assignedTo: string | null; contractorId: number | null;
  estimatedStartDate: string; estimatedEndDate: string | null;
  actualStartDate: string | null; actualEndDate: string | null;
  estimatedCost: string | null; approvedBudget: string | null;
  actualCost: string | null; currency: string;
  approvalRequired: boolean; approvalLevel: string;
  approvedBy: string | null; approvedDate: string | null;
  rejectionReason: string | null; completionNotes: string | null;
  qualityRating: number | null; createdBy: string;
  createdAt: string; updatedAt: string;
}
interface WorkOrderUpdate { id: number; workOrderId: number; updatedBy: string; previousStatus: string; newStatus: string; notes?: string; createdAt: string; }
interface WorkOrderComment { id: number; workOrderId: number; userId: string; userName: string; comment: string; createdAt: string; }

// ── status / priority configs ─────────────────────────────────────────────────
const STATUS_CFG: Record<string, { badge: string; bar: string; icon: any; label: string }> = {
  pending:          { badge: "bg-amber-50 text-amber-700 border-amber-200",    bar: "bg-amber-400",   icon: AlertCircle, label: "Pending"      },
  pending_approval: { badge: "bg-violet-50 text-violet-700 border-violet-200", bar: "bg-violet-400",  icon: AlertCircle, label: "Pend. Approval"},
  assigned:         { badge: "bg-blue-50 text-blue-700 border-blue-200",       bar: "bg-blue-500",    icon: UserCheck,   label: "Assigned"     },
  in_progress:      { badge: "bg-purple-50 text-purple-700 border-purple-200", bar: "bg-purple-500",  icon: Wrench,      label: "In Progress"  },
  completed:        { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", icon: CheckCircle, label: "Completed"  },
  cancelled:        { badge: "bg-gray-100 text-muted-foreground border-gray-200",      bar: "bg-gray-300",    icon: XCircle,     label: "Cancelled"    },
};
const PRIORITY_CFG: Record<string, { badge: string; label: string }> = {
  urgent: { badge: "bg-red-50 text-red-700 border-red-200",       label: "Urgent"  },
  high:   { badge: "bg-orange-50 text-orange-700 border-orange-200", label: "High" },
  medium: { badge: "bg-amber-50 text-amber-700 border-amber-200",  label: "Medium"  },
  low:    { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Low"},
};

const stCfg  = (s: string) => STATUS_CFG[s]   ?? STATUS_CFG.pending;
const priCfg = (p: string) => PRIORITY_CFG[p] ?? PRIORITY_CFG.medium;

// ── form schema ───────────────────────────────────────────────────────────────
const editSchema = z.object({
  title:              z.string().min(1, "Title is required"),
  description:        z.string().optional(),
  priority:           z.enum(["urgent","high","medium","low"]),
  status:             z.enum(["pending","assigned","in_progress","completed","cancelled"]),
  estimatedStartDate: z.string().min(1, "Start date required"),
  estimatedEndDate:   z.string().optional(),
  estimatedCost:      z.number().min(0).optional(),
  assignedTo:         z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

// ── section label ─────────────────────────────────────────────────────────────
function SL({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-1.5">
      <span className="w-3 h-px bg-emerald-400 inline-block" />{children}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function WorkOrderDetailsPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const [activeTab,          setActiveTab]          = useState("overview");
  const [isEditOpen,         setIsEditOpen]         = useState(false);
  const [isDeleteOpen,       setIsDeleteOpen]       = useState(false);
  const [isStatusOpen,       setIsStatusOpen]       = useState(false);
  const [selectedStatus,     setSelectedStatus]     = useState("");
  const [statusNotes,        setStatusNotes]        = useState("");

  // ── queries ─────────────────────────────────────────────────────────────────
  const { data: wo, isLoading, error, refetch } = useQuery<WorkOrder>({
    queryKey: [`/api/work-orders/${id}`],
    queryFn:  async () => { const r = await apiRequest(`/api/work-orders/${id}`); return r.json(); },
    enabled:  !!id,
  });

  const { data: mr }         = useQuery<any>({ queryKey: [`/api/maintenance-requests/${wo?.maintenanceRequestId}`],  queryFn: async () => { const r = await apiRequest(`/api/maintenance-requests/${wo!.maintenanceRequestId}`);  return r.json(); }, enabled: !!wo?.maintenanceRequestId });
  const { data: unit }       = useQuery<any>({ queryKey: [`/api/units/${mr?.unitId}`],          queryFn: async () => { const r = await apiRequest(`/api/units/${mr!.unitId}`);          return r.json(); }, enabled: !!mr?.unitId });
  const { data: contractor } = useQuery<any>({ queryKey: [`/api/contractors/${wo?.contractorId}`], queryFn: async () => { const r = await apiRequest(`/api/contractors/${wo!.contractorId}`); return r.json(); }, enabled: !!wo?.contractorId });
  const { data: property }   = useQuery<any>({ queryKey: [`/api/properties/${unit?.propertyId}`], queryFn: async () => { const r = await apiRequest(`/api/properties/${unit!.propertyId}`);  return r.json(); }, enabled: !!unit?.propertyId });
  const { data: updates = [] } = useQuery<WorkOrderUpdate[]>({ queryKey: [`/api/work-orders/${id}/updates`],  queryFn: async () => { const r = await apiRequest(`/api/work-orders/${id}/updates`);  return r.json(); }, enabled: !!id && activeTab === "history" });
  const { data: comments = [], refetch: refetchComments } = useQuery<WorkOrderComment[]>({ queryKey: [`/api/work-orders/${id}/comments`], queryFn: async () => { const r = await apiRequest(`/api/work-orders/${id}/comments`); return r.json(); }, enabled: !!id });

  // ── edit form ────────────────────────────────────────────────────────────────
  const form = useForm<EditForm>({ resolver: zodResolver(editSchema), defaultValues: { title: "", description: "", priority: "medium", status: "pending", estimatedStartDate: new Date().toISOString().split("T")[0], estimatedCost: 0 } });
  const commentForm = useForm<{comment:string}>({ resolver: zodResolver(z.object({ comment: z.string().min(1) })), defaultValues: { comment: "" } });

  useEffect(() => {
    if (wo && isEditOpen) {
      form.reset({
        title:              wo.title,
        description:        wo.description ?? "",
        priority:           (wo.priority as any) ?? "medium",
        status:             (wo.status   as any) ?? "pending",
        estimatedStartDate: wo.estimatedStartDate?.split("T")[0] ?? "",
        estimatedEndDate:   wo.estimatedEndDate?.split("T")[0]   ?? "",
        estimatedCost:      wo.estimatedCost ? parseFloat(wo.estimatedCost) : 0,
        assignedTo:         wo.assignedTo ?? "",
      });
    }
  }, [wo, isEditOpen]);

  // ── mutations ─────────────────────────────────────────────────────────────────
  const inv = () => queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${id}`] });

  const updateMut = useMutation({
    mutationFn: async (data: EditForm) => { const r = await apiRequest(`/api/work-orders/${id}`, { method: "PUT", data }); return r.json(); },
    onSuccess: () => { setIsEditOpen(false); inv(); toast({ title: "Work order updated" }); },
    onError:   () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: async (status: string) => { const r = await apiRequest(`/api/work-orders/${id}`, { method: "PUT", data: { status, notes: statusNotes || undefined } }); return r.json(); },
    onSuccess: () => { setIsStatusOpen(false); setStatusNotes(""); inv(); toast({ title: "Status updated" }); },
    onError:   () => toast({ title: "Status update failed", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => { const r = await apiRequest(`/api/work-orders/${id}`, { method: "DELETE" }); return safeJson(r); },
    onSuccess: () => { setIsDeleteOpen(false); toast({ title: "Work order deleted" }); setLocation("/work-orders"); },
    onError:   () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const commentMut = useMutation({
    mutationFn: async (comment: string) => { const r = await apiRequest(`/api/work-orders/${id}/comments`, { method: "POST", data: { comment } }); return r.json(); },
    onSuccess: () => { commentForm.reset(); refetchComments(); toast({ title: "Comment added" }); },
    onError:   () => toast({ title: "Comment failed", variant: "destructive" }),
  });

  const ledgerMut = useMutation({
    mutationFn: async () => { const r = await apiRequest(`/api/work-orders/${id}/post-to-ledger`, { method: "POST" }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? "Failed"); return d; },
    onSuccess: (d: any) => { inv(); toast({ title: "Posted to ledger", description: d.message }); },
    onError:   (e: any) => toast({ title: "Ledger post failed", description: e.message, variant: "destructive" }),
  });

  // ── loading / error states ────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><Skeleton className="h-96 w-full rounded-2xl" /></div>
          <div className="space-y-4"><Skeleton className="h-48 w-full rounded-2xl" /><Skeleton className="h-48 w-full rounded-2xl" /></div>
        </div>
      </div>
    </div>
  );

  if (error || !wo) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 bg-red-50 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Work Order Not Found</h2>
        <p className="text-muted-foreground mb-6">This work order doesn't exist or has been removed.</p>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setLocation("/maintenance")}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Maintenance
        </Button>
      </div>
    </div>
  );

  const sc  = stCfg(wo.status);
  const pc  = priCfg(wo.priority);
  const SI  = sc.icon;
  const cur = wo.currency || "KES";

  const fmt = (v?: string | null) => v ? `${cur} ${parseFloat(v).toLocaleString("en-KE", { minimumFractionDigits: 2 })}` : "—";

  return (
    <div className="min-h-screen bg-background">

      {/* ── Emerald header ─────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
          {/* Back + actions row */}
          <div className="flex items-center justify-between mb-5">
            <Button variant="ghost" size="sm" className="text-emerald-100 hover:text-white hover:bg-emerald-800/40 h-8 px-2" onClick={() => setLocation("/maintenance")}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />Back
            </Button>
            <div className="flex items-center gap-2">
              {wo.contractorId && contractor?.phone && (
                <Button size="sm" variant="outline" className="h-8 border-emerald-400/40 bg-emerald-800/30 text-white hover:bg-emerald-800/50 hover:text-white text-xs"
                  onClick={() => toast({ title: "Contacting contractor…" })}>
                  <PhoneCall className="w-3.5 h-3.5 mr-1.5" />Contact
                </Button>
              )}
              {(wo.actualCost || wo.estimatedCost) && wo.status === "completed" && (
                <Button size="sm" variant="outline" className="h-8 border-emerald-400/40 bg-emerald-800/30 text-white hover:bg-emerald-800/50 hover:text-white text-xs"
                  disabled={ledgerMut.isPending} onClick={() => ledgerMut.mutate()}>
                  {ledgerMut.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}
                  Post to Ledger
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 border-emerald-400/40 bg-emerald-800/30 text-white hover:bg-emerald-800/50 hover:text-white text-xs">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setIsStatusOpen(true)}><RefreshCw className="w-4 h-4 mr-2" />Update Status</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsEditOpen(true)}><Edit className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(window.location.href); toast({ title: "Link copied" }); }}><Copy className="w-4 h-4 mr-2" />Copy Link</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Print</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600" onClick={() => setIsDeleteOpen(true)}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Title block */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-800/40 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 mt-1">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-xs font-mono font-semibold text-emerald-100 bg-emerald-800/40 px-2 py-0.5 rounded">{wo.ticketNumber}</span>
                <span className="text-emerald-300/50 text-xs">·</span>
                <span className="text-xs text-emerald-200">{wo.workOrderType}</span>
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-white mb-2 leading-snug">{wo.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border", sc.badge)}>
                  <SI className="w-3 h-3" />{sc.label}
                </span>
                <span className={cn("text-xs px-2.5 py-1 rounded-full font-semibold border", pc.badge)}>
                  {pc.label} Priority
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────────────────────── */}
      <div className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
            {[
              { label: "Start Date",  value: safeFormatDate(wo.estimatedStartDate, "MMM d, yyyy"), icon: Calendar },
              { label: "Est. Cost",   value: fmt(wo.estimatedCost),  icon: DollarSign },
              { label: "Actual Cost", value: fmt(wo.actualCost),     icon: BarChart3  },
              { label: "Assigned To", value: wo.assignedTo ?? "—",   icon: User, truncate: true },
            ].map(({ label, value, icon: Icon, truncate }) => (
              <div key={label} className="px-4 py-3.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <Icon className="w-3 h-3 text-emerald-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
                </div>
                <span className={cn("text-sm font-bold text-foreground", truncate && "truncate")}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left: tabs ──────────────────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="border-b border-border">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="bg-transparent p-0 h-auto px-4 pt-3 gap-1">
                    {[
                      { value: "overview",     label: "Overview",     icon: FileText       },
                      { value: "history",      label: "History",      icon: History,      count: (updates as any[]).length },
                      { value: "comments",     label: "Comments",     icon: MessageSquare, count: (comments as any[]).length },
                    ].map(({ value, label, icon: Icon, count }) => (
                      <TabsTrigger key={value} value={value}
                        className="data-[state=active]:text-emerald-700 data-[state=active]:border-b-2 data-[state=active]:border-emerald-600 rounded-none pb-3 text-sm font-medium text-muted-foreground gap-1.5">
                        <Icon className="w-3.5 h-3.5" />{label}
                        {count ? <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold">{count}</span> : null}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {/* Overview */}
                  <TabsContent value="overview" className="p-6 space-y-6">
                    <div>
                      <SL>Description</SL>
                      <div className="rounded-xl bg-muted/40 border border-border p-4">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{wo.description || "No description provided."}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <SL>Work Order Details</SL>
                        {[
                          { label: "Type",        value: wo.workOrderType },
                          { label: "Ticket",      value: wo.ticketNumber  },
                          { label: "Created",     value: safeFormatDate(wo.createdAt, "MMM d, yyyy HH:mm") },
                          { label: "Updated",     value: safeFormatDate(wo.updatedAt, "MMM d, yyyy HH:mm") },
                          { label: "Approved By", value: wo.approvedBy    },
                        ].filter(r => r.value).map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-baseline border-b border-border/50 pb-2 last:border-0">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-sm font-medium text-foreground text-right max-w-[60%] truncate">{value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-3">
                        <SL>Schedule & Costs</SL>
                        {[
                          { label: "Start Date",    value: safeFormatDate(wo.estimatedStartDate, "MMM d, yyyy") },
                          { label: "End Date",      value: wo.estimatedEndDate ? safeFormatDate(wo.estimatedEndDate, "MMM d, yyyy") : null },
                          { label: "Actual Start",  value: wo.actualStartDate  ? safeFormatDate(wo.actualStartDate,  "MMM d, yyyy") : null },
                          { label: "Actual End",    value: wo.actualEndDate    ? safeFormatDate(wo.actualEndDate,    "MMM d, yyyy") : null },
                          { label: "Est. Cost",     value: wo.estimatedCost ? fmt(wo.estimatedCost) : null },
                          { label: "Actual Cost",   value: wo.actualCost    ? fmt(wo.actualCost)    : null },
                        ].filter(r => r.value).map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-baseline border-b border-border/50 pb-2 last:border-0">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-sm font-medium text-foreground">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Ledger prompt */}
                    {wo.actualCost && wo.status === "completed" && (
                      <div className="flex items-center gap-3 p-4 rounded-xl border border-violet-200 bg-violet-50">
                        <FileSpreadsheet className="w-5 h-5 text-violet-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-violet-800">Ready to post to finance ledger</p>
                          <p className="text-xs text-violet-600 mt-0.5">Post this cost as a property expense so it appears in the P&L and owner statements.</p>
                        </div>
                        <Button size="sm" variant="outline" className="shrink-0 border-violet-300 text-violet-700 hover:bg-violet-100 h-8 text-xs"
                          disabled={ledgerMut.isPending} onClick={() => ledgerMut.mutate()}>
                          {ledgerMut.isPending ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <FileSpreadsheet className="w-3 h-3 mr-1" />}
                          Post to Ledger
                        </Button>
                      </div>
                    )}
                  </TabsContent>

                  {/* History */}
                  <TabsContent value="history" className="p-6">
                    {(updates as WorkOrderUpdate[]).length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 mx-auto mb-3 bg-muted rounded-full flex items-center justify-center">
                          <History className="w-8 h-8 text-muted-foreground/50" />
                        </div>
                        <p className="font-semibold text-foreground">No history yet</p>
                        <p className="text-sm text-muted-foreground mt-1">Status updates will appear here.</p>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                        <div className="space-y-6">
                          {(updates as WorkOrderUpdate[]).map((u) => {
                            const ns = stCfg(u.newStatus);
                            return (
                              <div key={u.id} className="relative pl-12">
                                <div className={cn("absolute left-3.5 w-3 h-3 rounded-full border-2 border-card", ns.bar)} />
                                <div className="rounded-xl border border-border bg-muted/20 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <Avatar className="w-6 h-6"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-[10px]">{u.updatedBy[0]?.toUpperCase()}</AvatarFallback></Avatar>
                                      <span className="text-sm font-medium">{u.updatedBy}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <span className={cn("text-xs px-2 py-0.5 rounded-full border", stCfg(u.previousStatus).badge)}>{u.previousStatus.replace("_"," ")}</span>
                                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                      <span className={cn("text-xs px-2 py-0.5 rounded-full border", ns.badge)}>{u.newStatus.replace("_"," ")}</span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground mb-1">{safeFormatDate(u.createdAt, "MMM d, yyyy HH:mm")}</p>
                                  {u.notes && <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2 mt-2">{u.notes}</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* Comments */}
                  <TabsContent value="comments" className="p-6 space-y-6">
                    <div>
                      <SL>Add Comment</SL>
                      <Form {...commentForm}>
                        <form onSubmit={commentForm.handleSubmit(d => commentMut.mutate(d.comment))} className="space-y-3">
                          <FormField control={commentForm.control} name="comment" render={({ field }) => (
                            <FormItem>
                              <FormControl><Textarea placeholder="Add your comment…" className="min-h-[90px] resize-none" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <div className="flex justify-end">
                            <Button type="submit" size="sm" disabled={commentMut.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs">
                              {commentMut.isPending ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}
                              Post Comment
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </div>
                    <div className="space-y-3">
                      <SL>Comments ({(comments as WorkOrderComment[]).length})</SL>
                      {(comments as WorkOrderComment[]).length === 0 ? (
                        <div className="text-center py-8">
                          <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">No comments yet.</p>
                        </div>
                      ) : (comments as WorkOrderComment[]).map(c => (
                        <div key={c.id} className="rounded-xl border border-border bg-muted/20 p-4">
                          <div className="flex items-start gap-3">
                            <Avatar className="w-8 h-8 flex-shrink-0"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs">{c.userName[0]?.toUpperCase()}</AvatarFallback></Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-sm font-semibold">{c.userName}</span>
                                <span className="text-xs text-muted-foreground">{safeFormatDistanceToNow(c.createdAt)}</span>
                              </div>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{c.comment}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                </Tabs>
              </div>
            </div>
          </div>

          {/* ── Right: sidebar cards ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Contractor */}
            <Card className="rounded-xl border border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center"><Building2 className="w-3.5 h-3.5 text-emerald-600" /></div>
                  Contractor
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!wo.contractorId ? (
                  <div className="text-center py-4">
                    <User className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No contractor assigned</p>
                  </div>
                ) : !contractor ? (
                  <div className="text-center py-4">
                    <RefreshCw className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2 animate-spin" />
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10"><AvatarFallback className="bg-emerald-100 text-emerald-700 font-bold">{(contractor.companyName || contractor.name || "C")[0].toUpperCase()}</AvatarFallback></Avatar>
                      <div>
                        <p className="font-semibold text-sm">{contractor.companyName || contractor.name}</p>
                        {contractor.specialty && <p className="text-xs text-muted-foreground">{contractor.specialty}</p>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {contractor.email && (
                        <a href={`mailto:${contractor.email}`} className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors">
                          <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="text-xs text-emerald-700 truncate">{contractor.email}</span>
                        </a>
                      )}
                      {(contractor.phone || contractor.phoneNumber) && (
                        <a href={`tel:${contractor.phone || contractor.phoneNumber}`} className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors">
                          <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="text-xs text-emerald-700">{contractor.phone || contractor.phoneNumber}</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Property & Unit */}
            <Card className="rounded-xl border border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center"><Home className="w-3.5 h-3.5 text-emerald-600" /></div>
                  Property & Unit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {property ? (
                  <>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Property</p>
                      <p className="text-sm font-semibold">{property.name}</p>
                      {property.address && <p className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1"><MapPin className="w-3 h-3 shrink-0 mt-0.5" />{property.address}</p>}
                    </div>
                    {unit && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Unit</p>
                        <p className="text-sm font-semibold">Unit {unit.unitNumber || unit.id}</p>
                        {unit.unitType && <p className="text-xs text-muted-foreground">{unit.unitType}{unit.size ? ` · ${unit.size} sq ft` : ""}</p>}
                      </div>
                    )}
                    {mr && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Source Request</p>
                        <p className="text-xs text-foreground font-medium">{mr.title}</p>
                        <p className="text-xs text-muted-foreground">{safeFormatDate(mr.createdAt, "MMM d, yyyy")}</p>
                      </div>
                    )}
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => setLocation(`/properties/${property.id}`)}>
                      <ExternalLink className="w-3 h-3 mr-1.5" />View Property
                    </Button>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <Home className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No property linked</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Edit Dialog ──────────────────────────────────────────────────────────── */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><Edit className="w-4 h-4 text-emerald-600" /></div>
              <div><DialogTitle>Edit Work Order</DialogTitle><DialogDescription>Update work order details</DialogDescription></div>
            </div>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => updateMut.mutate(d))} className="space-y-4 pt-2">
              <FormField control={form.control} name="title" render={({ field }) => (<FormItem><FormLabel>Title *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={3} className="resize-none" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="priority" render={({ field }) => (<FormItem><FormLabel>Priority *</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="urgent">Urgent</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="status" render={({ field }) => (<FormItem><FormLabel>Status *</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="assigned">Assigned</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select><FormMessage /></FormItem>)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="estimatedStartDate" render={({ field }) => (<FormItem><FormLabel>Start Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="estimatedEndDate"   render={({ field }) => (<FormItem><FormLabel>End Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="estimatedCost" render={({ field }) => (<FormItem><FormLabel>Estimated Cost ({cur})</FormLabel><FormControl><Input type="number" {...field} onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMut.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {updateMut.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><CheckCircle className="w-3.5 h-3.5 mr-1.5" />Save Changes</>}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Status Dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={isStatusOpen} onOpenChange={setIsStatusOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><RefreshCw className="w-4 h-4 text-emerald-600" /></div>
              <div><DialogTitle>Update Status</DialogTitle><DialogDescription>Current: {sc.label}</DialogDescription></div>
            </div>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {Object.entries(STATUS_CFG).filter(([s]) => s !== "pending_approval").map(([status, cfg]) => {
              const Icon = cfg.icon;
              const active = selectedStatus === status;
              return (
                <button key={status} type="button" onClick={() => setSelectedStatus(status)}
                  className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors text-sm font-medium",
                    active ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border hover:bg-muted text-foreground")}>
                  <Icon className={cn("w-4 h-4 shrink-0", active ? "text-emerald-600" : cfg.badge.split(" ")[1])} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={statusNotes} onChange={e => setStatusNotes(e.target.value)} rows={2} className="resize-none text-sm" placeholder="Reason for status change…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStatusOpen(false)}>Cancel</Button>
            <Button disabled={!selectedStatus || statusMut.isPending} onClick={() => statusMut.mutate(selectedStatus)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {statusMut.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Updating…</> : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-600" /></div>
              <div><DialogTitle>Delete Work Order</DialogTitle><DialogDescription>This cannot be undone.</DialogDescription></div>
            </div>
          </DialogHeader>
          <p className="text-sm text-foreground py-2">Delete work order <strong>{wo.ticketNumber}</strong>? All associated data will be permanently removed.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}>
              {deleteMut.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</> : <><Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}