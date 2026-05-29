/**
 * Contractor Portal — /contractor-portal
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-featured self-service portal for contractors with:
 *   • Dashboard: earnings overview, performance stats, pending actions
 *   • Jobs: work order list with accept/reject/complete/invoice
 *   • Earnings: income history, monthly chart, transaction log
 *   • Calendar: upcoming job schedule
 *   • Ratings: quality feedback and review history
 *   • Messages: communicate with property managers
 *
 * API endpoints (all at /api/contractor-portal/...):
 *   GET  /me                        — profile
 *   PATCH /me/availability          — toggle availability
 *   GET  /work-orders               — jobs list
 *   PATCH /work-orders/:id/accept   — accept
 *   PATCH /work-orders/:id/reject   — reject
 *   PATCH /work-orders/:id/complete — complete
 *   POST  /work-orders/:id/invoice  — invoice
 *   GET  /earnings                  — earnings data
 *   GET  /calendar                  — calendar events
 *   GET  /ratings                   — ratings & reviews
 *   GET  /stats                     — performance stats
 *   GET  /messages                  — messages
 *   POST /messages                  — send message
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWsEvent } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Wrench, CheckCircle, XCircle, Clock, Building, MapPin,
  Calendar, DollarSign, FileText, Star, Briefcase, AlertTriangle,
  ChevronRight, RefreshCw, Loader2, User, Phone, Mail,
  ClipboardList, CircleDot, Play, Trophy, ArrowRight,
  Receipt, Package, Hash, TrendingUp, BarChart3, MessageSquare,
  Send, ChevronLeft, ChevronDown, Activity, Target, Zap,
  CheckSquare, Circle, ToggleLeft, ToggleRight, Bell, Award,
  Banknote, Calendar as CalendarIcon, Eye, Filter, ArrowUpRight,
  Wifi, WifiOff, ThumbsUp,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths, parseISO } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FirstRunOverlay, needsFirstRun, markFirstRunDone } from "@/components/first-run-overlay";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Contractor {
  id: number;
  companyName: string;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  rate: string | null;
  currency: string;
  rating: string;
  completedJobs: number;
  isAvailable: boolean;
}

interface WorkOrderRow {
  workOrder: {
    id: number;
    ticketNumber: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    workOrderType: string;
    estimatedStartDate: string | null;
    estimatedEndDate: string | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    estimatedCost: string | null;
    actualCost: string | null;
    currency: string;
    completionNotes: string | null;
    rejectionReason: string | null;
    createdAt: string;
  };
  property: { id: number; name: string; address: string | null } | null;
  unit: { id: number; unitNumber: string } | null;
  maintenanceRequest: { id: number; title: string; category: string; priority: string; description: string } | null;
}

interface EarningsData {
  totalEarned: number;
  pendingPayment: number;
  thisMonthEarned: number;
  currency: string;
  monthly: Array<{ month: string; earned: number; jobs: number }>;
  recentTransactions: Array<{ id: number; ticketNumber: string; title: string; amount: number; currency: string; date: string | null }>;
}

interface StatsData {
  totalJobs: number;
  completedJobs: number;
  inProgressJobs: number;
  rejectedJobs: number;
  completionRate: number | null;
  acceptanceRate: number | null;
  onTimeRate: number | null;
  avgTurnaroundDays: number | null;
  overallRating: string;
  isAvailable: boolean;
}

interface CalendarEvent {
  id: number;
  ticketNumber: string;
  title: string;
  status: string;
  priority: string;
  start: string | null;
  end: string | null;
  propertyName: string | null;
  unitNumber: string | null;
}

interface RatingsData {
  overallRating: string;
  completedJobs: number;
  ratingCount: number;
  ratingDistribution: Record<number, number>;
  ratedWorkOrders: Array<{ id: number; ticketNumber: string; title: string; qualityRating: number; actualEndDate: string | null; propertyName: string | null }>;
  reviews: any[];
}

interface Message {
  id: number;
  fromUserId: string;
  toUserId: string;
  subject: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  fromName: string;
  toName: string;
  isOwn: boolean;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null | undefined) =>
  d ? format(parseISO(d), "dd MMM yyyy") : "—";

const fmtMoney = (amount: number | string | null | undefined, currency = "KES") =>
  amount != null ? `${currency} ${Math.round(Number(amount)).toLocaleString("en-KE")}` : "—";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string; dot: string }> = {
  draft:            { label: "Draft",           color: "text-muted-foreground",   icon: CircleDot,     bg: "bg-muted border-border",    dot: "bg-muted-foreground" },
  pending_approval: { label: "Pending Approval", color: "text-amber-400",  icon: Clock,          bg: "bg-amber-950/40 border-amber-800/50", dot: "bg-amber-400" },
  approved:         { label: "Approved",         color: "text-blue-400",   icon: CheckCircle,    bg: "bg-blue-950/40 border-blue-800/50",   dot: "bg-blue-400" },
  assigned:         { label: "Assigned to You",  color: "text-indigo-400", icon: Briefcase,      bg: "bg-indigo-950/40 border-indigo-800/50", dot: "bg-indigo-400" },
  in_progress:      { label: "In Progress",      color: "text-amber-400",  icon: Play,           bg: "bg-amber-950/40 border-amber-800/50", dot: "bg-amber-400" },
  on_hold:          { label: "On Hold",          color: "text-orange-400", icon: AlertTriangle,  bg: "bg-orange-950/40 border-orange-800/50", dot: "bg-orange-400" },
  completed:        { label: "Completed",        color: "text-emerald-400",icon: Trophy,         bg: "bg-emerald-950/30 border-emerald-800/40", dot: "bg-emerald-400" },
  cancelled:        { label: "Cancelled",        color: "text-muted-foreground/70",  icon: XCircle,        bg: "bg-muted/50 border-border",       dot: "bg-muted-foreground/50" },
  rejected:         { label: "Rejected",         color: "text-red-400",    icon: XCircle,        bg: "bg-red-950/30 border-red-800/40",     dot: "bg-red-400" },
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "text-muted-foreground bg-muted/60",
  medium: "text-blue-400 bg-blue-950/40",
  high: "text-amber-400 bg-amber-950/40",
  urgent: "text-orange-400 bg-orange-950/40",
  critical: "text-red-400 bg-red-950/40 font-bold",
};

// ─── Modals ──────────────────────────────────────────────────────────────────

function RejectModal({ workOrderId, onClose, onDone }: { workOrderId: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/contractor-portal/work-orders/${workOrderId}/reject`, { method: "PATCH", data: { reason } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Work order rejected", description: "The property manager has been notified." });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/work-orders"] });
      onDone();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-400"><XCircle className="w-5 h-5" /> Reject Work Order</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-400">Please explain why you cannot take this job.</p>
        <Textarea placeholder="e.g. Unavailable during the required dates…" value={reason} onChange={e => setReason(e.target.value)} className="min-h-[100px]" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={!reason.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />} Confirm Rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteModal({ workOrderId, currency, onClose, onDone }: { workOrderId: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/contractor-portal/work-orders/${workOrderId}/complete`, { method: "PATCH", data: { completionNotes: notes, actualCost: cost ? Number(cost) : undefined } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Work order completed! 🎉" });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/work-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/earnings"] });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/stats"] });
      onDone();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-emerald-400"><Trophy className="w-5 h-5" /> Mark as Completed</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Completion Notes *</label>
            <Textarea placeholder="Describe the work done, materials used…" value={notes} onChange={e => setNotes(e.target.value)} className="bg-slate-800 border-slate-700 text-white min-h-[100px]" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Actual Cost ({currency}) — optional</label>
            <Input type="number" placeholder="e.g. 15000" value={cost} onChange={e => setCost(e.target.value)}  />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground/70">Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!notes.trim() || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />} Submit Completion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceModal({ workOrderId, currency, onClose, onDone }: { workOrderId: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/contractor-portal/work-orders/${workOrderId}/invoice`, { method: "POST", data: { invoiceAmount: Number(amount), invoiceRef: ref, invoiceNotes } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Invoice submitted", description: "The property manager will review and process payment." });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/work-orders"] });
      onDone();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-blue-400"><Receipt className="w-5 h-5" /> Submit Invoice</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Invoice Amount ({currency}) *</label>
            <Input type="number" placeholder="e.g. 25000" value={amount} onChange={e => setAmount(e.target.value)} className="bg-slate-800 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Invoice Reference / Number</label>
            <Input placeholder="e.g. INV-2025-001" value={ref} onChange={e => setRef(e.target.value)} className="bg-slate-800 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Payment Notes</label>
            <Textarea placeholder="e.g. Please pay via M-Pesa to 0712 345 678…" value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} className="bg-slate-800 border-slate-700 text-white" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground/70">Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!amount || isNaN(Number(amount)) || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Receipt className="w-4 h-4 mr-2" />} Submit Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Work Order Card ─────────────────────────────────────────────────────────

function WorkOrderCard({ row, onSelect }: { row: WorkOrderRow; onSelect: (row: WorkOrderRow) => void }) {
  const { workOrder, property, unit } = row;
  const cfg = STATUS_CONFIG[workOrder.status] ?? STATUS_CONFIG["draft"];
  const Icon = cfg.icon;
  const priCls = PRIORITY_COLOR[workOrder.priority] ?? PRIORITY_COLOR["medium"];
  const isUrgent = ["urgent", "critical"].includes(workOrder.priority);

  return (
    <button onClick={() => onSelect(row)} className={`w-full text-left rounded-2xl border p-4 transition-all hover:border-slate-500 active:scale-[0.99] ${cfg.bg} ${isUrgent ? "ring-1 ring-orange-500/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-black/30 ${cfg.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm text-white truncate">{workOrder.title}</span>
              <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${priCls}`}>{workOrder.priority}</span>
            </div>
            <p className="text-xs text-slate-500 font-mono">{workOrder.ticketNumber}</p>
            {property && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                <Building className="w-3 h-3 shrink-0" />
                <span className="truncate">{property.name}</span>
                {unit && <span className="text-muted-foreground">· Unit {unit.unitNumber}</span>}
              </div>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
              {workOrder.estimatedEndDate && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Due {fmtDate(workOrder.estimatedEndDate)}
                </span>
              )}
              {workOrder.estimatedCost && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> {fmtMoney(workOrder.estimatedCost, workOrder.currency)}
                </span>
              )}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 mt-2" />
      </div>
    </button>
  );
}

// ─── Work Order Detail ────────────────────────────────────────────────────────

interface WOComment { id: number; workOrderId: number; userId: string; userName: string; comment: string; createdAt: string; }
interface WOUpdate  { id: number; workOrderId: number; updatedBy: string; previousStatus: string; newStatus: string; notes?: string; createdAt: string; }

function WorkOrderDetail({ row, onBack }: { row: WorkOrderRow; onBack: () => void }) {
  const [modal, setModal] = useState<"reject" | "complete" | "invoice" | null>(null);
  const [detailTab, setDetailTab] = useState("details");
  const [commentText, setCommentText] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { workOrder, property, unit, maintenanceRequest } = row;
  const cfg = STATUS_CONFIG[workOrder.status] ?? STATUS_CONFIG["draft"];
  const Icon = cfg.icon;

  const { data: comments = [] } = useQuery<WOComment[]>({
    queryKey: [`/api/work-orders/${workOrder.id}/comments`],
    queryFn: async () => { const r = await apiRequest(`/api/work-orders/${workOrder.id}/comments`); return r.json(); },
  });

  const { data: updates = [] } = useQuery<WOUpdate[]>({
    queryKey: [`/api/work-orders/${workOrder.id}/updates`],
    queryFn: async () => { const r = await apiRequest(`/api/work-orders/${workOrder.id}/updates`); return r.json(); },
    enabled: detailTab === "history",
  });

  const commentMut = useMutation({
    mutationFn: async (comment: string) => {
      const r = await apiRequest(`/api/work-orders/${workOrder.id}/comments`, { method: "POST", data: { comment } });
      if (!r.ok) throw new Error("Failed to post comment");
      return r.json();
    },
    onSuccess: () => {
      setCommentText("");
      qc.invalidateQueries({ queryKey: [`/api/work-orders/${workOrder.id}/comments`] });
      toast({ title: "Comment posted" });
    },
    onError: () => toast({ title: "Failed to post comment", variant: "destructive" }),
  });

  const acceptMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/contractor-portal/work-orders/${workOrder.id}/accept`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Work order accepted!", description: "You can now begin work." });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/work-orders"] });
      onBack();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canAccept = ["assigned", "approved", "pending_approval"].includes(workOrder.status);
  const canReject = ["assigned", "approved", "pending_approval"].includes(workOrder.status);
  const canComplete = ["in_progress", "assigned"].includes(workOrder.status);
  const canInvoice = ["completed", "in_progress"].includes(workOrder.status);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to work orders
      </button>

      {/* Header card */}
      <div className={`rounded-2xl border p-5 ${cfg.bg}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-black/30">
            <Icon className={`w-5 h-5 ${cfg.color}`} />
          </div>
          <div>
            <h2 className="font-semibold text-white">{workOrder.title}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs text-slate-500 font-mono">{workOrder.ticketNumber}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="flex border-b border-slate-800">
          {[
            { id: "details",  label: "Details"  },
            { id: "comments", label: `Comments${(comments as WOComment[]).length > 0 ? ` (${(comments as WOComment[]).length})` : ""}` },
            { id: "history",  label: "History"  },
          ].map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 ${detailTab === t.id ? "text-amber-400 border-amber-400" : "text-slate-500 border-transparent hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {detailTab === "details" && (
          <div className="divide-y divide-slate-800">
            <div className="p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Description</p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{workOrder.description}</p>
            </div>
            {property && (
              <div className="p-4 flex items-start gap-3">
                <MapPin className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-white font-medium">{property.name}</p>
                  {unit && <p className="text-xs text-slate-400">Unit {unit.unitNumber}</p>}
                  {property.address && <p className="text-xs text-slate-500 mt-0.5">{property.address}</p>}
                </div>
              </div>
            )}
            {maintenanceRequest && (
              <div className="p-4 flex items-start gap-3">
                <Package className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Category</p>
                  <p className="text-sm text-white capitalize">{maintenanceRequest.category?.replace(/_/g, " ")}</p>
                </div>
              </div>
            )}
            <div className="p-4 grid grid-cols-2 gap-4">
              <div><p className="text-xs text-slate-500 mb-1">Start Date</p><p className="text-sm text-white">{fmtDate(workOrder.estimatedStartDate ?? workOrder.actualStartDate)}</p></div>
              <div><p className="text-xs text-slate-500 mb-1">Due Date</p><p className="text-sm text-white">{fmtDate(workOrder.estimatedEndDate)}</p></div>
              {workOrder.estimatedCost && <div><p className="text-xs text-slate-500 mb-1">Estimated Cost</p><p className="text-sm text-white">{fmtMoney(workOrder.estimatedCost, workOrder.currency)}</p></div>}
              {workOrder.actualCost && <div><p className="text-xs text-slate-500 mb-1">Actual / Invoice</p><p className="text-sm text-emerald-400 font-medium">{fmtMoney(workOrder.actualCost, workOrder.currency)}</p></div>}
            </div>
            {workOrder.completionNotes && (
              <div className="p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Completion Notes</p>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{workOrder.completionNotes}</p>
              </div>
            )}
            {workOrder.rejectionReason && (
              <div className="p-4 bg-red-950/20">
                <p className="text-xs text-red-400 uppercase tracking-wide mb-2">Rejection Reason</p>
                <p className="text-sm text-slate-300">{workOrder.rejectionReason}</p>
              </div>
            )}
          </div>
        )}

        {/* Comments tab */}
        {detailTab === "comments" && (
          <div className="p-4 space-y-4">
            {/* Post a comment */}
            <div className="space-y-2">
              <Textarea
                placeholder="Leave a note for the property manager…"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 resize-none min-h-[80px] text-sm"
                rows={3}
              />
              <Button
                size="sm"
                className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold h-9"
                disabled={!commentText.trim() || commentMut.isPending}
                onClick={() => commentMut.mutate(commentText)}
              >
                {commentMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                Post Comment
              </Button>
            </div>
            {/* Comments list */}
            {(comments as WOComment[]).length === 0 ? (
              <div className="text-center py-6">
                <MessageSquare className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No comments yet. Be the first to leave a note.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(comments as WOComment[]).map(c => (
                  <div key={c.id} className="rounded-xl bg-slate-800/60 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-white">{c.userName}</span>
                      <span className="text-[10px] text-slate-500">{fmtDate(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-slate-300 whitespace-pre-wrap">{c.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {detailTab === "history" && (
          <div className="p-4">
            {(updates as WOUpdate[]).length === 0 ? (
              <div className="text-center py-6">
                <Clock className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No status history yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(updates as WOUpdate[]).map(u => {
                  const ns = STATUS_CONFIG[u.newStatus] ?? STATUS_CONFIG["draft"];
                  const ps = STATUS_CONFIG[u.previousStatus] ?? STATUS_CONFIG["draft"];
                  return (
                    <div key={u.id} className="rounded-xl bg-slate-800/60 p-3">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full bg-slate-700 ${ps.color}`}>{u.previousStatus.replace("_"," ")}</span>
                        <ChevronRight className="w-3 h-3 text-slate-500" />
                        <span className={`text-xs px-2 py-0.5 rounded-full bg-slate-700 ${ns.color}`}>{u.newStatus.replace("_"," ")}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">{u.updatedBy} · {fmtDate(u.createdAt)}</p>
                      {u.notes && <p className="text-xs text-slate-400 mt-1">{u.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {(canAccept || canReject || canComplete || canInvoice) && (
        <div className="space-y-2">
          {canAccept && (
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 font-semibold rounded-xl" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
              {acceptMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />} Accept & Start Work
            </Button>
          )}
          {canComplete && (
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 font-semibold rounded-xl" onClick={() => setModal("complete")}>
              <Trophy className="w-4 h-4 mr-2" /> Mark as Completed
            </Button>
          )}
          {canInvoice && (
            <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 h-12 rounded-xl" onClick={() => setModal("invoice")}>
              <Receipt className="w-4 h-4 mr-2" /> Submit Invoice
            </Button>
          )}
          {canReject && (
            <Button variant="ghost" className="w-full text-red-400 hover:bg-red-950/30 hover:text-red-300 h-10 rounded-xl" onClick={() => setModal("reject")}>
              <XCircle className="w-4 h-4 mr-2" /> Cannot Take This Job
            </Button>
          )}
        </div>
      )}

      {modal === "reject" && <RejectModal workOrderId={workOrder.id} onClose={() => setModal(null)} onDone={() => { setModal(null); onBack(); }} />}
      {modal === "complete" && <CompleteModal workOrderId={workOrder.id} currency={workOrder.currency} onClose={() => setModal(null)} onDone={() => { setModal(null); onBack(); }} />}
      {modal === "invoice" && <InvoiceModal workOrderId={workOrder.id} currency={workOrder.currency} onClose={() => setModal(null)} onDone={() => setModal(null)} />}
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ profile, workOrders, stats, earnings, onJobsTabSelect, onEarningsTabSelect }: {
  profile: Contractor;
  workOrders: WorkOrderRow[];
  stats: StatsData | undefined;
  earnings: EarningsData | undefined;
  onJobsTabSelect: () => void;
  onEarningsTabSelect: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pendingWOs = workOrders.filter(r => ["assigned", "approved", "pending_approval"].includes(r.workOrder.status));
  const activeWOs = workOrders.filter(r => r.workOrder.status === "in_progress");

  const availMut = useMutation({
    mutationFn: async (val: boolean) => {
      const res = await apiRequest("/api/contractor-portal/me/availability", { method: "PATCH", data: { isAvailable: val } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/me"] });
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/stats"] });
      toast({ title: profile.isAvailable ? "Set to unavailable" : "Set to available" });
    },
    onError: () => toast({ title: "Failed to update availability", variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Availability toggle */}
      <div className={`rounded-2xl border p-4 flex items-center justify-between ${profile.isAvailable ? "bg-emerald-950/30 border-emerald-800/40" : "bg-slate-900 border-slate-800"}`}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${profile.isAvailable ? "bg-emerald-400" : "bg-slate-500"}`} />
          <div>
            <p className="text-sm font-medium text-white">{profile.isAvailable ? "Available for work" : "Not available"}</p>
            <p className="text-xs text-slate-500">Property managers {profile.isAvailable ? "can" : "cannot"} assign new jobs</p>
          </div>
        </div>
        <button
          disabled={availMut.isPending}
          onClick={() => availMut.mutate(!profile.isAvailable)}
          className={`relative w-12 h-6 rounded-full transition-colors ${profile.isAvailable ? "bg-emerald-500" : "bg-slate-700"} ${availMut.isPending ? "opacity-60" : ""}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow ${profile.isAvailable ? "left-7" : "left-1"}`} />
        </button>
      </div>

      {/* Pending action banner */}
      {pendingWOs.length > 0 && (
        <div className="rounded-2xl bg-indigo-950/50 border border-indigo-700/50 p-4">
          <div className="flex items-start gap-3">
            <Bell className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-indigo-300">
                {pendingWOs.length} job{pendingWOs.length > 1 ? "s" : ""} awaiting your response
              </p>
              <p className="text-xs text-indigo-400/70 mt-0.5">Respond quickly to maintain a good acceptance rate</p>
            </div>
            <button onClick={onJobsTabSelect} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 shrink-0">
              View <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {pendingWOs.slice(0, 2).map(r => (
              <div key={r.workOrder.id} className="flex items-center gap-2 text-xs text-slate-300 bg-indigo-950/40 rounded-lg px-3 py-2">
                <Briefcase className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="truncate flex-1">{r.workOrder.title}</span>
                <span className="text-muted-foreground font-mono shrink-0">{r.workOrder.ticketNumber}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs text-slate-500 mb-1">This Month</p>
          <p className="text-xl font-bold text-white">{fmtMoney(earnings?.thisMonthEarned ?? 0, earnings?.currency ?? "KES")}</p>
          <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Earned</p>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs text-slate-500 mb-1">Pending</p>
          <p className="text-xl font-bold text-amber-400">{fmtMoney(earnings?.pendingPayment ?? 0, earnings?.currency ?? "KES")}</p>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Outstanding</p>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs text-slate-500 mb-1">Rating</p>
          <div className="flex items-center gap-1.5">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <p className="text-xl font-bold text-white">{Number(profile.rating || 0).toFixed(1)}</p>
          </div>
          <p className="text-xs text-slate-500 mt-1">{profile.completedJobs} jobs done</p>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs text-slate-500 mb-1">On-Time Rate</p>
          <p className="text-xl font-bold text-white">{stats?.onTimeRate != null ? `${stats.onTimeRate}%` : "—"}</p>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Target className="w-3 h-3" /> Completion</p>
        </div>
      </div>

      {/* Active jobs */}
      {activeWOs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Active Jobs</p>
            <button onClick={onJobsTabSelect} className="text-xs text-amber-400 hover:text-amber-300">View all</button>
          </div>
          <div className="space-y-2">
            {activeWOs.slice(0, 3).map(r => (
              <div key={r.workOrder.id} className="rounded-xl bg-amber-950/30 border border-amber-800/40 p-3">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.workOrder.title}</p>
                    <p className="text-xs text-slate-500">{r.property?.name ?? "—"} {r.unit ? `· Unit ${r.unit.unitNumber}` : ""}</p>
                  </div>
                  {r.workOrder.estimatedEndDate && (
                    <p className="text-xs text-amber-400 shrink-0">Due {fmtDate(r.workOrder.estimatedEndDate)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance quick stats */}
      {stats && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-4">Performance Overview</p>
          <div className="space-y-3">
            {[
              { label: "Completion Rate", value: stats.completionRate, suffix: "%" },
              { label: "Acceptance Rate", value: stats.acceptanceRate, suffix: "%" },
              { label: "On-Time Rate", value: stats.onTimeRate, suffix: "%" },
            ].map(item => (
              <div key={item.label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-slate-400">{item.label}</span>
                  <span className="text-xs font-semibold text-white">{item.value != null ? `${item.value}${item.suffix}` : "—"}</span>
                </div>
                {item.value != null && (
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all" style={{ width: `${item.value}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {stats.avgTurnaroundDays != null && (
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">Avg. turnaround</span>
              <span className="text-sm font-semibold text-white">{stats.avgTurnaroundDays} day{stats.avgTurnaroundDays !== 1 ? "s" : ""}</span>
            </div>
          )}
        </div>
      )}

      {/* Quick link to earnings */}
      <button onClick={onEarningsTabSelect} className="w-full rounded-2xl bg-gradient-to-r from-emerald-950/50 to-slate-900 border border-emerald-800/30 p-4 flex items-center justify-between hover:border-emerald-700/50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Banknote className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Total Earnings</p>
            <p className="text-xs text-slate-500">All time</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-400">{fmtMoney(earnings?.totalEarned ?? 0, earnings?.currency ?? "KES")}</p>
          <p className="text-xs text-slate-500 flex items-center gap-1 justify-end">View history <ArrowRight className="w-3 h-3" /></p>
        </div>
      </button>
    </div>
  );
}

// ─── Jobs Tab ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = ["all", "assigned", "in_progress", "completed", "rejected"] as const;
type FilterOption = typeof FILTER_OPTIONS[number];
const FILTER_LABELS: Record<FilterOption, string> = { all: "All", assigned: "To Do", in_progress: "Active", completed: "Done", rejected: "Rejected" };

function JobsTab({ workOrders, profile }: { workOrders: WorkOrderRow[]; profile: Contractor }) {
  const [selected, setSelected] = useState<WorkOrderRow | null>(null);
  const [filter, setFilter] = useState<FilterOption>("all");

  const filtered = filter === "all" ? workOrders : workOrders.filter(r => r.workOrder.status === filter);

  if (selected) {
    return <WorkOrderDetail row={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        {FILTER_OPTIONS.map(f => {
          const count = f === "all" ? workOrders.length : workOrders.filter(r => r.workOrder.status === f).length;
          return (
            <button key={f} onClick={() => setFilter(f)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "bg-amber-500 text-black" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
              {FILTER_LABELS[f]}
              {count > 0 && <span className={`ml-1 ${filter === f ? "text-black/70" : "text-slate-500"}`}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center">
          <ClipboardList className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{filter === "all" ? "No work orders assigned yet." : `No ${FILTER_LABELS[filter].toLowerCase()} work orders.`}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(row => <WorkOrderCard key={row.workOrder.id} row={row} onSelect={setSelected} />)}
        </div>
      )}
    </div>
  );
}

// ─── Earnings Tab ─────────────────────────────────────────────────────────────

function EarningsTab({ earnings }: { earnings: EarningsData | undefined }) {
  if (!earnings) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-amber-400 animate-spin" /></div>;

  const maxEarned = Math.max(...earnings.monthly.map(m => m.earned), 1);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-800/40 p-5">
          <p className="text-xs text-slate-400 mb-1">Total Earned (All Time)</p>
          <p className="text-3xl font-bold text-white">{fmtMoney(earnings.totalEarned, earnings.currency)}</p>
          <p className="text-xs text-emerald-400 mt-1">{earnings.recentTransactions.length} invoiced jobs</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">This Month</p>
            <p className="text-xl font-bold text-white">{fmtMoney(earnings.thisMonthEarned, earnings.currency)}</p>
            <p className="text-xs text-emerald-400 mt-1">Earned</p>
          </div>
          <div className="rounded-2xl bg-amber-950/30 border border-amber-800/40 p-4">
            <p className="text-xs text-slate-500 mb-1">Pending</p>
            <p className="text-xl font-bold text-amber-400">{fmtMoney(earnings.pendingPayment, earnings.currency)}</p>
            <p className="text-xs text-slate-500 mt-1">Outstanding</p>
          </div>
        </div>
      </div>

      {/* Monthly bar chart */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-4">Monthly Earnings</p>
        <div className="flex items-end gap-1.5 h-32">
          {earnings.monthly.map((m, i) => {
            const pct = (m.earned / maxEarned) * 100;
            const isLast = i === earnings.monthly.length - 1;
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end" style={{ height: "88px" }}>
                  <div
                    className={`w-full rounded-t-md transition-all ${m.earned > 0 ? (isLast ? "bg-emerald-500" : "bg-slate-600") : "bg-slate-800"}`}
                    style={{ height: `${Math.max(pct, m.earned > 0 ? 4 : 0)}%` }}
                    title={`${m.month}: ${fmtMoney(m.earned, earnings.currency)}`}
                  />
                </div>
                <p className="text-[9px] text-slate-600 text-center leading-tight">{m.month}</p>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-800">
          <div className="w-3 h-3 rounded bg-emerald-500" />
          <span className="text-xs text-slate-500">Current month</span>
          <div className="w-3 h-3 rounded bg-slate-600 ml-3" />
          <span className="text-xs text-slate-500">Previous months</span>
        </div>
      </div>

      {/* Recent transactions */}
      {earnings.recentTransactions.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Recent Transactions</p>
          </div>
          <div className="divide-y divide-slate-800">
            {earnings.recentTransactions.map(tx => (
              <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-950/50 flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{tx.title}</p>
                  <p className="text-xs text-slate-500">{fmtDate(tx.date)} · {tx.ticketNumber}</p>
                </div>
                <p className="text-sm font-semibold text-emerald-400 shrink-0">{fmtMoney(tx.amount, tx.currency)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────

function CalendarTab({ events }: { events: CalendarEvent[] | undefined }) {
  const [viewDate, setViewDate] = useState(new Date());

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDow = monthStart.getDay(); // 0=Sun

  // Map date string to events
  const eventsByDate = new Map<string, CalendarEvent[]>();
  (events ?? []).forEach(ev => {
    if (!ev.start) return;
    try {
      const d = format(parseISO(ev.start), "yyyy-MM-dd");
      if (!eventsByDate.has(d)) eventsByDate.set(d, []);
      eventsByDate.get(d)!.push(ev);
    } catch {}
  });

  const STATUS_DOT: Record<string, string> = { assigned: "bg-indigo-400", in_progress: "bg-amber-400", completed: "bg-emerald-400", rejected: "bg-red-400" };

  // Upcoming list: next 30 days
  const upcoming = (events ?? [])
    .filter(ev => {
      if (!ev.start) return false;
      try {
        const d = parseISO(ev.start);
        const now = new Date();
        return d >= now && !["completed", "rejected", "cancelled"].includes(ev.status);
      } catch { return false; }
    })
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      {/* Month navigator */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="font-semibold text-white">{format(viewDate, "MMMM yyyy")}</p>
          <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-center text-[10px] text-slate-600 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-y-1">
          {/* Leading empty cells */}
          {Array.from({ length: startDow }).map((_, i) => <div key={`e-${i}`} />)}
          {days.map(day => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDate.get(key) ?? [];
            const today = isToday(day);
            return (
              <div key={key} className={`flex flex-col items-center py-1 rounded-lg ${today ? "bg-amber-500/20" : ""}`}>
                <span className={`text-xs ${today ? "text-amber-400 font-bold" : "text-slate-400"}`}>{format(day, "d")}</span>
                {dayEvents.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                    {dayEvents.slice(0, 3).map((ev, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[ev.status] ?? "bg-slate-500"}`} title={ev.title} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-800">
          {[["bg-indigo-400", "To Do"], ["bg-amber-400", "In Progress"], ["bg-emerald-400", "Completed"]].map(([c, l]) => (
            <div key={l} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${c}`} />
              <span className="text-[10px] text-slate-500">{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming jobs */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-3">Upcoming Jobs</p>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center">
            <CalendarIcon className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No upcoming jobs scheduled</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map(ev => {
              const cfg = STATUS_CONFIG[ev.status] ?? STATUS_CONFIG["draft"];
              return (
                <div key={ev.id} className={`rounded-xl border p-3 ${cfg.bg}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{ev.title}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        <span className="text-xs text-slate-500">{fmtDate(ev.start)}</span>
                        {ev.propertyName && <span className="text-xs text-slate-500">{ev.propertyName}{ev.unitNumber ? ` · Unit ${ev.unitNumber}` : ""}</span>}
                      </div>
                    </div>
                    <span className={`text-xs shrink-0 ${PRIORITY_COLOR[ev.priority] ?? PRIORITY_COLOR["medium"]} rounded-full px-2 py-0.5`}>{ev.priority}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ratings Tab ──────────────────────────────────────────────────────────────

function RatingsTab({ ratings, profile }: { ratings: RatingsData | undefined; profile: Contractor }) {
  if (!ratings) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-amber-400 animate-spin" /></div>;

  const total = Object.values(ratings.ratingDistribution).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-5">
      {/* Overview */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-950/40 to-slate-900 border border-amber-800/30 p-5">
        <div className="flex items-center gap-5">
          <div className="text-center shrink-0">
            <div className="text-5xl font-bold text-white">{Number(ratings.overallRating).toFixed(1)}</div>
            <div className="flex items-center justify-center gap-0.5 mt-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`w-4 h-4 ${i < Math.round(Number(ratings.overallRating)) ? "fill-amber-400 text-amber-400" : "text-slate-700"}`} />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">{total} rating{total !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex-1">
            {[5, 4, 3, 2, 1].map(star => {
              const count = ratings.ratingDistribution[star] ?? 0;
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs text-slate-500 w-3">{star}</span>
                  <Star className="w-3 h-3 text-amber-400 shrink-0" />
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-slate-600 w-4 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Job stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-center">
          <Trophy className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">{ratings.completedJobs}</p>
          <p className="text-xs text-slate-500 mt-0.5">Jobs Completed</p>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-center">
          <Award className="w-5 h-5 text-amber-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-white">{ratings.ratingCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Jobs Rated</p>
        </div>
      </div>

      {/* Rated work orders */}
      {ratings.ratedWorkOrders.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Recent Ratings</p>
          </div>
          <div className="divide-y divide-slate-800">
            {ratings.ratedWorkOrders.map(wo => (
              <div key={wo.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{wo.title}</p>
                  <p className="text-xs text-slate-500">{wo.propertyName ?? "—"} · {fmtDate(wo.actualEndDate)}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`w-3.5 h-3.5 ${i < (wo.qualityRating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-700"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ratings.ratingCount === 0 && ratings.completedJobs === 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center">
          <Star className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-muted-foreground/70 text-sm">No ratings yet. Complete your first job to receive feedback.</p>
        </div>
      )}
    </div>
  );
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

function MessagesTab({ userId }: { userId: string }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ messages: Message[] }>({
    queryKey: ["/api/contractor-portal/messages"],
    queryFn: async () => {
      const res = await apiRequest("/api/contractor-portal/messages");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/contractor-portal/messages", { method: "POST", data: { subject, content } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Message sent" });
      setSubject("");
      setContent("");
      setComposeOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/contractor-portal/messages"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const msgs = data?.messages ?? [];

  return (
    <div className="space-y-4">
      {/* Compose button */}
      <Button className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold h-11 rounded-xl" onClick={() => setComposeOpen(true)}>
        <MessageSquare className="w-4 h-4 mr-2" /> New Message to Property Manager
      </Button>

      {/* Compose form */}
      {composeOpen && (
        <div className="rounded-2xl bg-slate-900 border border-amber-700/40 p-4 space-y-3">
          <p className="text-sm font-semibold text-white">New Message</p>
          <Input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" />
          <Textarea placeholder="Write your message…" value={content} onChange={e => setContent(e.target.value)} className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[100px]" />
          <div className="flex gap-2">
            <Button variant="ghost" className="text-muted-foreground/70" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-black font-semibold flex-1" disabled={!content.trim() || sendMut.isPending} onClick={() => sendMut.mutate()}>
              {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />} Send
            </Button>
          </div>
        </div>
      )}

      {/* Messages list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-amber-400 animate-spin" /></div>
      ) : msgs.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center">
          <MessageSquare className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-muted-foreground/70 text-sm">No messages yet. Send a message to your property manager.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {msgs.map(msg => (
            <div key={msg.id} className={`rounded-2xl border p-4 ${msg.isOwn ? "bg-amber-950/30 border-amber-800/40 ml-4" : "bg-slate-900 border-slate-800 mr-4"}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${msg.isOwn ? "bg-amber-500 text-black" : "bg-slate-700 text-slate-300"}`}>
                    {(msg.isOwn ? msg.fromName : msg.fromName).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{msg.isOwn ? "You" : msg.fromName}</p>
                    <p className="text-[10px] text-slate-500">{fmtDate(msg.createdAt)}</p>
                  </div>
                </div>
                {!msg.isRead && !msg.isOwn && <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1" />}
              </div>
              {msg.subject && <p className="text-xs text-slate-400 font-medium mb-1">{msg.subject}</p>}
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = "dashboard" | "jobs" | "earnings" | "calendar" | "ratings" | "messages";

const TAB_CONFIG: Array<{ id: Tab; label: string; icon: any }> = [
  { id: "dashboard", label: "Home",     icon: Activity },
  { id: "jobs",      label: "Jobs",     icon: Briefcase },
  { id: "earnings",  label: "Earnings", icon: Banknote },
  { id: "calendar",  label: "Calendar", icon: CalendarIcon },
  { id: "ratings",   label: "Ratings",  icon: Star },
  { id: "messages",  label: "Messages", icon: MessageSquare },
];

export default function ContractorPortal() {
  const { user, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [showFirstRun, setShowFirstRun] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Real-time: new message arrives → refresh messages tab + show toast
  useWsEvent("message:new", (payload: any) => {
    qc.invalidateQueries({ queryKey: ["/api/contractor-portal/messages"] });
    toast({ title: "New message", description: payload.preview ?? payload.subject ?? "You have a new message" });
    setTab(prev => prev); // keep tab, just invalidate
  });

  // Real-time: broadcast from org admins
  useWsEvent("broadcast", (payload: any) => {
    toast({ title: payload.title ?? "Notice", description: payload.message ?? "" });
  });

  useEffect(() => {
    if (user?.id && needsFirstRun(user.id)) {
      const t = setTimeout(() => setShowFirstRun(true), 600);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<Contractor>({
    queryKey: ["/api/contractor-portal/me"],
    queryFn: async () => {
      const res = await apiRequest("/api/contractor-portal/me");
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? "Not found"); }
      return res.json();
    },
    retry: false,
  });

  const { data: woData, isLoading: woLoading } = useQuery<{ contractor: Contractor; workOrders: WorkOrderRow[] }>({
    queryKey: ["/api/contractor-portal/work-orders"],
    queryFn: async () => { const res = await apiRequest("/api/contractor-portal/work-orders"); if (!res.ok) throw new Error("Failed"); return res.json(); },
    enabled: !!profile,
    refetchInterval: 60_000,
  });

  const { data: stats } = useQuery<StatsData>({
    queryKey: ["/api/contractor-portal/stats"],
    queryFn: async () => { const res = await apiRequest("/api/contractor-portal/stats"); if (!res.ok) throw new Error("Failed"); return res.json(); },
    enabled: !!profile,
  });

  const { data: earnings } = useQuery<EarningsData>({
    queryKey: ["/api/contractor-portal/earnings"],
    queryFn: async () => { const res = await apiRequest("/api/contractor-portal/earnings"); if (!res.ok) throw new Error("Failed"); return res.json(); },
    enabled: !!profile,
  });

  const { data: calendarData } = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["/api/contractor-portal/calendar"],
    queryFn: async () => { const res = await apiRequest("/api/contractor-portal/calendar"); if (!res.ok) throw new Error("Failed"); return res.json(); },
    enabled: !!profile && tab === "calendar",
  });

  const { data: ratingsData } = useQuery<RatingsData>({
    queryKey: ["/api/contractor-portal/ratings"],
    queryFn: async () => { const res = await apiRequest("/api/contractor-portal/ratings"); if (!res.ok) throw new Error("Failed"); return res.json(); },
    enabled: !!profile && tab === "ratings",
  });

  const allWOs = woData?.workOrders ?? [];
  const pendingCount = allWOs.filter(r => ["assigned", "approved", "pending_approval"].includes(r.workOrder.status)).length;
  const userId = String(user?.id ?? "");

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Loading your portal…</p>
        </div>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-foreground font-semibold text-lg mb-2">Contractor Profile Not Found</h2>
          <p className="text-muted-foreground/70 text-sm">{(profileError as any)?.message ?? "No contractor profile is linked to your account. Please contact your property manager."}</p>
        </div>
      </div>
    );
  }


  if (!authLoading && user && user.role !== "contractor") {
    return (<div className="flex items-center justify-center min-h-[60vh] p-6"><div className="text-center max-w-sm space-y-3"><div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto"><span className="text-2xl">🔒</span></div><h2 className="text-lg font-semibold text-foreground">Access restricted</h2><p className="text-sm text-muted-foreground">This portal is for contractors only.</p></div></div>);
  }
  if (!authLoading && user && !user.organizationId) {
    return (<div className="flex items-center justify-center min-h-[60vh] p-6"><div className="text-center max-w-sm space-y-3"><div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto"><span className="text-2xl">🏢</span></div><h2 className="text-lg font-semibold text-foreground">No organisation linked</h2><p className="text-sm text-muted-foreground">Your account is not linked to an organisation.</p></div></div>);
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
      {showFirstRun && (
        <FirstRunOverlay
          userId={user?.id ?? "unknown"}
          role="contractor"
          firstName={user?.firstName ?? profile.name?.split(" ")[0] ?? ""}
          onDismiss={() => { markFirstRunDone(user?.id ?? "unknown"); setShowFirstRun(false); }}
        />
      )}

      {/* ── Contractor header ─────────────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-5 border-b border-slate-700">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <Briefcase className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-white/60 font-medium uppercase tracking-wider">Contractor Portal</p>
              <h1 className="text-base font-semibold text-white leading-tight">
                {profile.name ?? user?.firstName ?? "Contractor"}
              </h1>
              {profile.specialty && (
                <p className="text-xs text-white/60 capitalize mt-0.5">{profile.specialty}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full">
              <div className={`w-1.5 h-1.5 rounded-full ${profile.isAvailable ? "bg-green-400 animate-pulse" : "bg-slate-400"}`} />
              {profile.isAvailable ? "Available" : "Unavailable"}
            </div>
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-medium px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {pendingCount} pending {pendingCount === 1 ? "job" : "jobs"}
              </div>
            )}
          </div>
        </div>
      </div>



      {/* ── Desktop two-panel layout | Mobile: pill bar + content ─────── */}
      <div className="flex-1 flex lg:max-w-5xl lg:mx-auto w-full">

        {/* Desktop left nav rail */}
        <nav className="hidden lg:flex flex-col w-48 xl:w-52 shrink-0 border-r border-border bg-card/30 py-5 sticky top-0 h-[calc(100vh-4rem)] overflow-y-auto">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 mb-2">My Work</p>
          {TAB_CONFIG.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}>
              <t.icon className="w-4 h-4 shrink-0" />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 px-3 sm:px-5 py-4 sm:py-5 pb-6">
          {/* Mobile pill switcher only */}
          <div className="flex lg:hidden gap-1 overflow-x-auto scrollbar-hide bg-muted/40 p-1 rounded-xl border border-border mb-5">
            {TAB_CONFIG.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0 ${
                  tab === t.id
                    ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Section content */}
          {tab === "dashboard" && (
            <DashboardTab
              profile={profile}
              workOrders={allWOs}
              stats={stats}
              earnings={earnings}
              onJobsTabSelect={() => setTab("jobs")}
              onEarningsTabSelect={() => setTab("earnings")}
            />
          )}
          {tab === "jobs"      && <JobsTab workOrders={allWOs} profile={profile} />}
          {tab === "earnings"  && <EarningsTab earnings={earnings} />}
          {tab === "calendar"  && <CalendarTab events={calendarData?.events} />}
          {tab === "ratings"   && <RatingsTab ratings={ratingsData} profile={profile} />}
          {tab === "messages"  && <MessagesTab userId={user?.id ?? ""} />}
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
      `}</style>
    </div>
  );
}