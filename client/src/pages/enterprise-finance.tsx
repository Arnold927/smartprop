import React, { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, apiJson } from "@/lib/queryClient";
import { PageShell, PageHeader, SectionCard, SPBadge, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  TrendingUp,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Eye,
  Download,
  Upload,
  Calculator,
  Building,
  CreditCard,
  Receipt,
  Target,
  BarChart3,
  Settings,
  Archive,
  ShoppingCart,
  FileBarChart,
  Banknote,
  PiggyBank,
  AlertTriangle,
  FileText,
  BookOpen,
  Hash,
  Layers,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number | string, currency = "KES") => {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return `${currency} 0.00`;
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (dateStr: string | undefined) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
};

const shortCurrency = (total: number) => {
  if (total >= 1_000_000) return `KES ${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `KES ${(total / 1_000).toFixed(1)}K`;
  return `KES ${total.toLocaleString()}`;
};

// ─── Shared UI ────────────────────────────────────────────────────────────────

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: string;
  color?: string;
}

const MetricCard = ({ title, value, description, icon, trend, color = "blue" }: MetricCardProps) => (
  <Card className="hover:shadow-lg transition-shadow duration-200">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className={`h-4 w-4 text-${color}-600`}>{icon}</div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-semibold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {trend && (
        <div className="flex items-center pt-1">
          <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
          <span className="text-xs text-green-600">{trend}</span>
        </div>
      )}
    </CardContent>
  </Card>
);

const ApprovalStatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { color: string; label: string }> = {
    draft: { color: "bg-muted text-foreground", label: "Draft" },
    pending_l1: { color: "bg-yellow-100 text-yellow-800", label: "L1 Pending" },
    pending_l2: { color: "bg-orange-100 text-orange-800", label: "L2 Pending" },
    pending_md: { color: "bg-purple-100 text-purple-800", label: "MD Approval" },
    pending_approval: { color: "bg-yellow-100 text-yellow-800", label: "Pending Approval" },
    approved: { color: "bg-emerald-50 text-emerald-700 border border-emerald-200" , label: "Approved" },
    processed: { color: "bg-blue-100 text-blue-800", label: "Processed" },
    rejected: { color: "bg-red-100 text-red-800", label: "Rejected" },
    cancelled: { color: "bg-muted text-muted-foreground", label: "Cancelled" },
    paid: { color: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "Paid" },
    failed: { color: "bg-red-100 text-red-800", label: "Failed" },
  };
  const config = statusConfig[status] ?? statusConfig.draft;
  return <Badge className={`${config.color} text-xs px-2 py-1`}>{config.label}</Badge>;
};

const EmptyState = ({ icon: Icon, title, description }: { icon: any; title: string; description: string }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Icon className="h-12 w-12 text-muted-foreground mb-4 opacity-40" />
    <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>
    <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
  </div>
);

// ─── Approval / Reject Dialog (reusable) ─────────────────────────────────────

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}

const AddAccountDialog = ({ open, onOpenChange, onSuccess }: AddAccountDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    accountCode: "",
    accountName: "",
    accountType: "",
    subType: "",
    description: "",
    openingBalance: "",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return await apiRequest("/api/chart-of-accounts", {
        method: "POST",
        data: {
          ...data,
          openingBalance: parseFloat(data.openingBalance) || 0,
          currency: "KES",
          isActive: true,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chart-of-accounts"] });
      toast({ title: "Account Created", description: `Account "${form.accountName}" has been added to the chart of accounts.` });
      setForm({ accountCode: "", accountName: "", accountType: "", subType: "", description: "", openingBalance: "" });
      onSuccess();
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create account. Please try again.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
          <DialogDescription>Create a new account in the Chart of Accounts</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="acc-code">Account Code *</Label>
              <Input
                id="acc-code"
                value={form.accountCode}
                onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                placeholder="e.g. 1001"
              />
            </div>
            <div>
              <Label>Account Type *</Label>
              <Select value={form.accountType} onValueChange={(v) => setForm({ ...form, accountType: v, subType: "" })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="acc-name">Account Name *</Label>
            <Input
              id="acc-name"
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              placeholder="e.g. Cash & Bank"
            />
          </div>
          {form.accountType && (
            <div>
              <Label>Sub-Type</Label>
              <Select value={form.subType} onValueChange={(v) => setForm({ ...form, subType: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select sub-type (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {form.accountType === "asset" && (
                    <>
                      <SelectItem value="current_asset">Current Asset</SelectItem>
                      <SelectItem value="fixed_asset">Fixed Asset</SelectItem>
                      <SelectItem value="other_asset">Other Asset</SelectItem>
                    </>
                  )}
                  {form.accountType === "liability" && (
                    <>
                      <SelectItem value="current_liability">Current Liability</SelectItem>
                      <SelectItem value="long_term_liability">Long-term Liability</SelectItem>
                    </>
                  )}
                  {form.accountType === "equity" && (
                    <>
                      <SelectItem value="owners_equity">Owner's Equity</SelectItem>
                      <SelectItem value="retained_earnings">Retained Earnings</SelectItem>
                    </>
                  )}
                  {form.accountType === "revenue" && (
                    <>
                      <SelectItem value="rental_income">Rental Income</SelectItem>
                      <SelectItem value="service_income">Service Income</SelectItem>
                      <SelectItem value="other_income">Other Income</SelectItem>
                    </>
                  )}
                  {form.accountType === "expense" && (
                    <>
                      <SelectItem value="operating_expense">Operating Expense</SelectItem>
                      <SelectItem value="payroll_expense">Payroll Expense</SelectItem>
                      <SelectItem value="depreciation">Depreciation</SelectItem>
                      <SelectItem value="other_expense">Other Expense</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="acc-opening">Opening Balance (KES)</Label>
            <Input
              id="acc-opening"
              type="number"
              min="0"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label htmlFor="acc-desc">Description</Label>
            <Textarea
              id="acc-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What is this account used for?"
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => createMutation.mutate(form)}
              disabled={
                createMutation.isPending ||
                !form.accountCode.trim() ||
                !form.accountName.trim() ||
                !form.accountType
              }
            >
              {createMutation.isPending ? "Creating…" : "Create Account"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};



interface ApproveRejectDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle: string;
  onApprove: (comments: string) => void;
  onReject: (reason: string) => void;
  isPending: boolean;
}

const ApproveRejectDialog = ({
  open,
  onOpenChange,
  title,
  subtitle,
  onApprove,
  onReject,
  isPending,
}: ApproveRejectDialogProps) => {
  const [comments, setComments] = useState("");
  const [mode, setMode] = useState<"approve" | "reject">("approve");

  const handleClose = () => {
    setComments("");
    setMode("approve");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-2">
          <Button
            variant={mode === "approve" ? "default" : "outline"}
            size="sm"
            className={mode === "approve" ? "bg-green-600 hover:bg-green-700" : ""}
            onClick={() => setMode("approve")}
          >
            <CheckCircle className="h-3 w-3 mr-1" /> Approve
          </Button>
          <Button
            variant={mode === "reject" ? "default" : "outline"}
            size="sm"
            className={mode === "reject" ? "bg-red-600 hover:bg-red-700" : ""}
            onClick={() => setMode("reject")}
          >
            <XCircle className="h-3 w-3 mr-1" /> Reject
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="ar-comments">
              {mode === "approve" ? "Approval Comments" : "Rejection Reason *"}
            </Label>
            <Textarea
              id="ar-comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={
                mode === "approve"
                  ? "Optional comments…"
                  : "State the reason for rejection…"
              }
              className="mt-1"
            />
          </div>
          <div className="flex gap-2">
            <Button
              className={`flex-1 ${mode === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
              onClick={() =>
                mode === "approve"
                  ? onApprove(comments.trim() || "Approved")
                  : onReject(comments.trim() || "Rejected")
              }
              disabled={isPending || (mode === "reject" && !comments.trim())}
            >
              {isPending
                ? mode === "approve"
                  ? "Approving…"
                  : "Rejecting…"
                : mode === "approve"
                ? "Confirm Approval"
                : "Confirm Rejection"}
            </Button>
            <Button variant="outline" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Purchase Requisitions ────────────────────────────────────────────────────

const PurchaseRequisitions = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [viewReq, setViewReq] = useState<any>(null);
  const [actionReq, setActionReq] = useState<any>(null); // for approve/reject dialog
  const [isNewReqDialogOpen, setIsNewReqDialogOpen] = useState(false);
  const [reqSearch, setReqSearch] = useState("");
  const [reqPageSize, setReqPageSize] = useState(10);
  const [reqPage, setReqPage] = useState(1);
  const [newRequisition, setNewRequisition] = useState({
    title: "",
    description: "",
    totalAmount: "",
    requiredDate: "",
    category: "",
  });

  const { data: requisitions = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/purchase-requisitions"],
  });

  const actionMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      action: "approve" | "reject";
      level?: string;
      comments?: string;
      reason?: string;
    }) => {
      if (data.action === "approve") {
        return await apiRequest(`/api/purchase-requisitions/${data.id}/approve`, {
          method: "PATCH",
          data: {
            level: data.level,
            comments: data.comments,
            approverId: (user as any)?.id,
          },
        });
      } else {
        return await apiRequest(`/api/purchase-requisitions/${data.id}/reject`, {
          method: "PATCH",
          data: {
            reason: data.reason,
          },
        });
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({
        title: variables.action === "approve" ? "Requisition Approved" : "Requisition Rejected",
        description:
          variables.action === "approve"
            ? "The purchase requisition has been approved and moved to the next stage."
            : "The purchase requisition has been rejected and the requestor will be notified.",
      });
      setActionReq(null);
    },
    onError: (_err, variables) => {
      toast({
        title: "Action Failed",
        description: `Failed to ${variables.action} the purchase requisition. Please try again.`,
        variant: "destructive",
      });
    },
  });

  const createRequisitionMutation = useMutation({
    mutationFn: async (data: typeof newRequisition) => {
      return await apiRequest("/api/purchase-requisitions", {
        method: "POST",
        data: {
          ...data,
          totalAmount: parseFloat(data.totalAmount) || 0,
          prNumber: `PR-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0")}`,
          requestorName: user
            ? `${(user as any).firstName ?? ""} ${(user as any).lastName ?? ""}`.trim() || "Current User"
            : "Current User",
          approvalStatus: "pending_l1",
          requestedDate: new Date().toISOString().split("T")[0],
          currency: "KES",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition Submitted", description: "Your purchase requisition has been submitted for L1 approval." });
      setIsNewReqDialogOpen(false);
      setNewRequisition({ title: "", description: "", totalAmount: "", requiredDate: "", category: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create purchase requisition", variant: "destructive" });
    },
  });

  const levelFromStatus = (status: string) =>
    status === "pending_l1" ? "l1" : status === "pending_l2" ? "l2" : "md";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Purchase Requisitions</h3>
          <p className="text-sm text-muted-foreground">Manage procurement requests with 3-level approval workflow</p>
        </div>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setIsNewReqDialogOpen(true)}
          data-testid="button-new-requisition"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Requisition
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading requisitions…</p>}

      {!isLoading && requisitions.length === 0 && (
        <EmptyState
          icon={ShoppingCart}
          title="No Purchase Requisitions"
          description="Create your first purchase requisition to start the procurement approval process."
        />
      )}

      {!isLoading && requisitions.length > 0 && (() => {
        const filtered = requisitions.filter((req) => {
          const q = reqSearch.toLowerCase();
          return !q || req.prNumber?.toLowerCase().includes(q) || req.title?.toLowerCase().includes(q) || req.requestorName?.toLowerCase().includes(q) || req.category?.toLowerCase().includes(q);
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / reqPageSize));
        const paginated = reqPageSize === -1 ? filtered : filtered.slice((reqPage - 1) * reqPageSize, reqPage * reqPageSize);
        return (
          <>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by PR number, title, requestor…"
                  value={reqSearch}
                  onChange={(e) => { setReqSearch(e.target.value); setReqPage(1); }}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(reqPageSize)} onValueChange={(v) => { setReqPageSize(Number(v)); setReqPage(1); }}>
                  <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="-1">All</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            <div className="grid gap-4">
              {paginated.map((req) => (
          <Card key={req.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{req.prNumber}</CardTitle>
                  <CardDescription className="mt-1">{req.title}</CardDescription>
                </div>
                <ApprovalStatusBadge status={req.approvalStatus} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <span className="text-muted-foreground">Requestor</span>
                  <p className="font-medium">{req.requestorName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount</span>
                  <p className="font-medium">{formatCurrency(req.totalAmount, req.currency)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <p className="font-medium capitalize">{req.category?.replace(/_/g, " ") || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Required By</span>
                  <p className="font-medium">{formatDate(req.requiredDate)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewReq(req)}
                  data-testid={`button-view-${req.id}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View Details
                </Button>
                {req.approvalStatus?.startsWith("pending") && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => setActionReq(req)}
                    data-testid={`button-approve-${req.id}`}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Review
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

            {reqPageSize !== -1 && totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>Page {reqPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setReqPage(p => Math.max(1, p - 1))} disabled={reqPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setReqPage(p => Math.min(totalPages, p + 1))} disabled={reqPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* View Detail Dialog */}
      <Dialog open={!!viewReq} onOpenChange={() => setViewReq(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewReq?.prNumber}</DialogTitle>
            <DialogDescription>{viewReq?.title}</DialogDescription>
          </DialogHeader>
          {viewReq && (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status</span>
                <ApprovalStatusBadge status={viewReq.approvalStatus} />
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground block">Requestor</span>
                  <span className="font-medium">{viewReq.requestorName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Requested Date</span>
                  <span className="font-medium">{formatDate(viewReq.requestedDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Required By</span>
                  <span className="font-medium">{formatDate(viewReq.requiredDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Category</span>
                  <span className="font-medium capitalize">{viewReq.category?.replace(/_/g, " ") || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Total Amount</span>
                  <span className="font-semibold text-base">{formatCurrency(viewReq.totalAmount, viewReq.currency)}</span>
                </div>
              </div>
              {viewReq.description && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground block mb-1">Description / Justification</span>
                    <p className="text-sm leading-relaxed">{viewReq.description}</p>
                  </div>
                </>
              )}
              {viewReq.approvalComments && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground block mb-1">Approval Comments</span>
                    <p className="text-sm">{viewReq.approvalComments}</p>
                  </div>
                </>
              )}
              {viewReq.approvalStatus?.startsWith("pending") && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => { setViewReq(null); setActionReq(viewReq); }}
                >
                  <CheckCircle className="h-4 w-4 mr-2" /> Review &amp; Approve / Reject
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve / Reject Dialog */}
      {actionReq && (
        <ApproveRejectDialog
          open={!!actionReq}
          onOpenChange={(v) => { if (!v) setActionReq(null); }}
          title="Review Purchase Requisition"
          subtitle={`${actionReq.prNumber} — ${formatCurrency(actionReq.totalAmount, actionReq.currency)}`}
          isPending={actionMutation.isPending}
          onApprove={(comments) =>
            actionMutation.mutate({
              id: actionReq.id,
              action: "approve",
              level: levelFromStatus(actionReq.approvalStatus),
              comments,
            })
          }
          onReject={(reason) =>
            actionMutation.mutate({ id: actionReq.id, action: "reject", reason })
          }
        />
      )}

      {/* New Requisition Dialog */}
      <Dialog open={isNewReqDialogOpen} onOpenChange={setIsNewReqDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Purchase Requisition</DialogTitle>
            <DialogDescription>Submit a procurement request for 3-level approval</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="req-title">Title *</Label>
              <Input
                id="req-title"
                value={newRequisition.title}
                onChange={(e) => setNewRequisition({ ...newRequisition, title: e.target.value })}
                placeholder="e.g. Office cleaning supplies"
                data-testid="input-req-title"
              />
            </div>
            <div>
              <Label htmlFor="req-description">Justification</Label>
              <Textarea
                id="req-description"
                value={newRequisition.description}
                onChange={(e) => setNewRequisition({ ...newRequisition, description: e.target.value })}
                placeholder="Why is this purchase needed?"
                data-testid="input-req-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="req-amount">Amount (KES) *</Label>
                <Input
                  id="req-amount"
                  type="number"
                  min="0"
                  value={newRequisition.totalAmount}
                  onChange={(e) => setNewRequisition({ ...newRequisition, totalAmount: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-req-amount"
                />
              </div>
              <div>
                <Label htmlFor="req-date">Required By *</Label>
                <Input
                  id="req-date"
                  type="date"
                  value={newRequisition.requiredDate}
                  onChange={(e) => setNewRequisition({ ...newRequisition, requiredDate: e.target.value })}
                  data-testid="input-req-date"
                />
              </div>
            </div>
            <div>
              <Label>Category *</Label>
              <Select
                value={newRequisition.category}
                onValueChange={(value) => setNewRequisition({ ...newRequisition, category: value })}
              >
                <SelectTrigger data-testid="select-req-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maintenance">Maintenance &amp; Repairs</SelectItem>
                  <SelectItem value="office_supplies">Office Supplies</SelectItem>
                  <SelectItem value="utilities">Utilities</SelectItem>
                  <SelectItem value="security">Security</SelectItem>
                  <SelectItem value="professional_services">Professional Services</SelectItem>
                  <SelectItem value="equipment">Equipment &amp; Furniture</SelectItem>
                  <SelectItem value="cleaning">Cleaning &amp; Sanitation</SelectItem>
                  <SelectItem value="landscaping">Landscaping</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => createRequisitionMutation.mutate(newRequisition)}
                disabled={
                  createRequisitionMutation.isPending ||
                  !newRequisition.title.trim() ||
                  !newRequisition.totalAmount ||
                  !newRequisition.requiredDate ||
                  !newRequisition.category
                }
                data-testid="button-submit-requisition"
              >
                {createRequisitionMutation.isPending ? "Submitting…" : "Submit for Approval"}
              </Button>
              <Button variant="outline" onClick={() => setIsNewReqDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Expense Reports ──────────────────────────────────────────────────────────

const ExpenseReports = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [viewReport, setViewReport] = useState<any>(null);
  const [actionReport, setActionReport] = useState<any>(null);
  const [isNewExpenseDialogOpen, setIsNewExpenseDialogOpen] = useState(false);
  const [expSearch, setExpSearch] = useState("");
  const [expPageSize, setExpPageSize] = useState(10);
  const [expPage, setExpPage] = useState(1);
  const [newExpense, setNewExpense] = useState({
    title: "",
    amount: "",
    expenseType: "",
    description: "",
  });

  const { data: expenseReports = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/expense-reports"],
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    toast({ title: "Receipt Uploaded", description: `Processing "${file.name}"…` });
    setTimeout(() => {
      toast({ title: "Receipt Processed", description: "Attach this receipt to an expense report." });
    }, 1800);
    event.target.value = "";
  };

  const actionMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      action: "approve" | "reject";
      level?: string;
      comments?: string;
      reason?: string;
    }) => {
      if (data.action === "approve") {
        return await apiRequest(`/api/expense-reports/${data.id}/approve`, {
          method: "PATCH",
          data: {
            level: data.level,
            comments: data.comments,
            approvedBy: (user as any)?.id,
          },
        });
      } else {
        return await apiRequest(`/api/expense-reports/${data.id}/reject`, {
          method: "PATCH",
          data: { reason: data.reason },
        });
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      toast({
        title: variables.action === "approve" ? "Expense Approved" : "Expense Rejected",
        description:
          variables.action === "approve"
            ? "Expense report has been approved."
            : "Expense report has been rejected. The employee will be notified.",
      });
      setActionReport(null);
    },
    onError: (_err, variables) => {
      toast({
        title: "Action Failed",
        description: `Failed to ${variables.action} the expense report.`,
        variant: "destructive",
      });
    },
  });

  const createExpenseMutation = useMutation({
    mutationFn: async (data: typeof newExpense) => {
      return await apiRequest("/api/expense-reports", {
        method: "POST",
        data: {
          title: data.title,
          description: data.description,
          totalAmount: parseFloat(data.amount) || 0,
          expenseType: data.expenseType,
          reportNumber: `EXP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0")}`,
          employeeName: user
            ? `${(user as any).firstName ?? ""} ${(user as any).lastName ?? ""}`.trim() || "Current User"
            : "Current User",
          employeeId: (user as any)?.id,
          currency: "KES",
          approvalStatus: "pending_l1",
          submittedDate: new Date().toISOString().split("T")[0],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-reports"] });
      toast({ title: "Expense Submitted", description: "Your expense report has been submitted for approval." });
      setIsNewExpenseDialogOpen(false);
      setNewExpense({ title: "", amount: "", expenseType: "", description: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit expense report", variant: "destructive" });
    },
  });

  const levelFromStatus = (status: string) =>
    status === "pending_l1" ? "l1" : status === "pending_l2" ? "l2" : "md";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Expense Reports</h3>
          <p className="text-sm text-muted-foreground">Track and approve employee expense reimbursements</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf"
            onChange={handleFileUpload}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-receipt">
            <Upload className="h-4 w-4 mr-2" />
            Upload Receipt
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700"
            onClick={() => setIsNewExpenseDialogOpen(true)}
            data-testid="button-new-expense"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Expense Report
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading expense reports…</p>}

      {!isLoading && expenseReports.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="No Expense Reports"
          description="Submit an expense report to claim reimbursement for business expenses."
        />
      )}

      {!isLoading && expenseReports.length > 0 && (() => {
        const filtered = expenseReports.filter((r) => {
          const q = expSearch.toLowerCase();
          return !q || r.reportNumber?.toLowerCase().includes(q) || r.title?.toLowerCase().includes(q) || r.employeeName?.toLowerCase().includes(q) || r.expenseType?.toLowerCase().includes(q);
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / expPageSize));
        const paginated = expPageSize === -1 ? filtered : filtered.slice((expPage - 1) * expPageSize, expPage * expPageSize);
        return (
          <>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by number, title, employee…"
                  value={expSearch}
                  onChange={(e) => { setExpSearch(e.target.value); setExpPage(1); }}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(expPageSize)} onValueChange={(v) => { setExpPageSize(Number(v)); setExpPage(1); }}>
                  <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="-1">All</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            <div className="grid gap-4">
              {paginated.map((report) => (
          <Card key={report.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{report.reportNumber}</CardTitle>
                  <CardDescription className="mt-1">{report.title}</CardDescription>
                </div>
                <ApprovalStatusBadge status={report.approvalStatus} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <span className="text-muted-foreground">Employee</span>
                  <p className="font-medium">{report.employeeName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount</span>
                  <p className="font-medium">{formatCurrency(report.totalAmount, report.currency)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Type</span>
                  <p className="font-medium capitalize">{report.expenseType?.replace(/_/g, " ") || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Submitted</span>
                  <p className="font-medium">{formatDate(report.submittedDate)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewReport(report)}
                  data-testid={`button-view-expense-${report.id}`}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View Details
                </Button>
                {report.approvalStatus?.startsWith("pending") && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => setActionReport(report)}
                    data-testid={`button-approve-expense-${report.id}`}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Review
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

            {expPageSize !== -1 && totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>Page {expPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setExpPage(p => Math.max(1, p - 1))} disabled={expPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setExpPage(p => Math.min(totalPages, p + 1))} disabled={expPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* View Detail Dialog */}
      <Dialog open={!!viewReport} onOpenChange={() => setViewReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewReport?.reportNumber}</DialogTitle>
            <DialogDescription>{viewReport?.title}</DialogDescription>
          </DialogHeader>
          {viewReport && (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status</span>
                <ApprovalStatusBadge status={viewReport.approvalStatus} />
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground block">Employee</span>
                  <span className="font-medium">{viewReport.employeeName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Expense Type</span>
                  <span className="font-medium capitalize">{viewReport.expenseType?.replace(/_/g, " ") || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Submitted Date</span>
                  <span className="font-medium">{formatDate(viewReport.submittedDate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Total Amount</span>
                  <span className="font-semibold text-base">{formatCurrency(viewReport.totalAmount, viewReport.currency)}</span>
                </div>
              </div>
              {viewReport.description && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground block mb-1">Description</span>
                    <p className="leading-relaxed">{viewReport.description}</p>
                  </div>
                </>
              )}
              {viewReport.approvalStatus?.startsWith("pending") && (
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => { setViewReport(null); setActionReport(viewReport); }}
                >
                  <CheckCircle className="h-4 w-4 mr-2" /> Review &amp; Approve / Reject
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve / Reject Dialog */}
      {actionReport && (
        <ApproveRejectDialog
          open={!!actionReport}
          onOpenChange={(v) => { if (!v) setActionReport(null); }}
          title="Review Expense Report"
          subtitle={`${actionReport.reportNumber} — ${formatCurrency(actionReport.totalAmount, actionReport.currency)}`}
          isPending={actionMutation.isPending}
          onApprove={(comments) =>
            actionMutation.mutate({
              id: actionReport.id,
              action: "approve",
              level: levelFromStatus(actionReport.approvalStatus),
              comments,
            })
          }
          onReject={(reason) =>
            actionMutation.mutate({ id: actionReport.id, action: "reject", reason })
          }
        />
      )}

      {/* New Expense Report Dialog */}
      <Dialog open={isNewExpenseDialogOpen} onOpenChange={setIsNewExpenseDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New Expense Report</DialogTitle>
            <DialogDescription>Submit expenses for reimbursement approval</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="expense-title">Title *</Label>
              <Input
                id="expense-title"
                value={newExpense.title}
                onChange={(e) => setNewExpense({ ...newExpense, title: e.target.value })}
                placeholder="e.g. Site visit to Westlands property"
                data-testid="input-expense-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="expense-amount">Amount (KES) *</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0"
                  value={newExpense.amount}
                  onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-expense-amount"
                />
              </div>
              <div>
                <Label>Type *</Label>
                <Select
                  value={newExpense.expenseType}
                  onValueChange={(value) => setNewExpense({ ...newExpense, expenseType: value })}
                >
                  <SelectTrigger data-testid="select-expense-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="travel">Travel</SelectItem>
                    <SelectItem value="operational">Operational</SelectItem>
                    <SelectItem value="professional_services">Professional Services</SelectItem>
                    <SelectItem value="meals">Meals &amp; Entertainment</SelectItem>
                    <SelectItem value="accommodation">Accommodation</SelectItem>
                    <SelectItem value="supplies">Office Supplies</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="expense-description">Description</Label>
              <Textarea
                id="expense-description"
                value={newExpense.description}
                onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                placeholder="Details of the expense incurred"
                data-testid="input-expense-description"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-purple-600 hover:bg-purple-700"
                onClick={() => createExpenseMutation.mutate(newExpense)}
                disabled={
                  createExpenseMutation.isPending ||
                  !newExpense.title.trim() ||
                  !newExpense.amount ||
                  !newExpense.expenseType
                }
                data-testid="button-submit-expense"
              >
                {createExpenseMutation.isPending ? "Submitting…" : "Submit for Approval"}
              </Button>
              <Button variant="outline" onClick={() => setIsNewExpenseDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Payroll Management ───────────────────────────────────────────────────────

const PayrollManagement = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [viewPeriod, setViewPeriod] = useState<any>(null);
  const [isNewPayrollDialogOpen, setIsNewPayrollDialogOpen] = useState(false);
  const [paySearch, setPaySearch] = useState("");
  const [payPageSize, setPayPageSize] = useState(10);
  const [payPage, setPayPage] = useState(1);
  const [newPeriod, setNewPeriod] = useState({
    periodName: "",
    startDate: "",
    endDate: "",
    payDate: "",
  });

  const { data: payrollPeriods = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll"],
  });

  // Fetch payroll entries when a period is selected for viewing
  const { data: payrollEntries = [], isLoading: entriesLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll", viewPeriod?.id, "entries"],
    queryFn: async () => {
      if (!viewPeriod?.id) return [];
      return await apiJson<any[]>(`/api/payroll/${viewPeriod.id}/entries`, { method: "GET" });
    },
    enabled: !!viewPeriod?.id,
  });

  const processPayrollMutation = useMutation({
    mutationFn: async (payrollId: number) => {
      return await apiRequest(`/api/payroll/${payrollId}/process`, {
        method: "PATCH",
        data: { processedBy: (user as any)?.id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });
      toast({ title: "Payroll Processed", description: "The payroll period has been processed and marked complete." });
      setViewPeriod(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to process payroll. Please try again.", variant: "destructive" });
    },
  });

  const createPayrollPeriodMutation = useMutation({
    mutationFn: async (data: typeof newPeriod) => {
      return await apiRequest("/api/payroll", {
        method: "POST",
        data: {
          ...data,
          status: "pending_approval",
          totalGrossPay: "0.00",
          totalDeductions: "0.00",
          totalNetPay: "0.00",
          employeeCount: 0,
          currency: "KES",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll"] });
      toast({ title: "Payroll Period Created", description: "New payroll period is ready for processing." });
      setIsNewPayrollDialogOpen(false);
      setNewPeriod({ periodName: "", startDate: "", endDate: "", payDate: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create payroll period", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Payroll Management</h3>
          <p className="text-sm text-muted-foreground">Manage staff payroll periods and disbursements</p>
        </div>
        <Button
          className="bg-green-600 hover:bg-green-700"
          onClick={() => setIsNewPayrollDialogOpen(true)}
          data-testid="button-new-payroll"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Payroll Period
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading payroll periods…</p>}

      {!isLoading && payrollPeriods.length === 0 && (
        <EmptyState
          icon={Users}
          title="No Payroll Periods"
          description="Create a payroll period to start managing staff salary disbursements."
        />
      )}

      {!isLoading && payrollPeriods.length > 0 && (() => {
        const filtered = payrollPeriods.filter((p) => {
          const q = paySearch.toLowerCase();
          return !q || p.periodName?.toLowerCase().includes(q) || p.status?.toLowerCase().includes(q);
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / payPageSize));
        const paginated = payPageSize === -1 ? filtered : filtered.slice((payPage - 1) * payPageSize, payPage * payPageSize);
        return (
          <>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by period name or status…"
                  value={paySearch}
                  onChange={(e) => { setPaySearch(e.target.value); setPayPage(1); }}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(payPageSize)} onValueChange={(v) => { setPayPageSize(Number(v)); setPayPage(1); }}>
                  <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="-1">All</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            <div className="grid gap-4">
              {paginated.map((period) => (
          <Card key={period.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{period.periodName}</CardTitle>
                  <CardDescription className="mt-1">
                    {formatDate(period.startDate)} – {formatDate(period.endDate)} • Pay Date: {formatDate(period.payDate)}
                  </CardDescription>
                </div>
                <ApprovalStatusBadge status={period.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <span className="text-muted-foreground">Employees</span>
                  <p className="font-medium">{period.employeeCount ?? 0}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Gross Pay</span>
                  <p className="font-medium">{formatCurrency(period.totalGrossPay, "KES")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Deductions</span>
                  <p className="font-medium">{formatCurrency(period.totalDeductions, "KES")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Net Pay</span>
                  <p className="font-semibold">{formatCurrency(period.totalNetPay, "KES")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setViewPeriod(period)}
                  data-testid={`button-view-payroll-${period.id}`}
                  className="flex-1 sm:flex-none"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View Details
                </Button>
                <Button
                  size="sm"
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  onClick={() => processPayrollMutation.mutate(period.id)}
                  disabled={processPayrollMutation.isPending || period.status !== "pending_approval"}
                  data-testid={`button-process-payroll-${period.id}`}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {processPayrollMutation.isPending ? "Processing…" : "Process Payment"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

            {payPageSize !== -1 && totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>Page {payPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPayPage(p => Math.max(1, p - 1))} disabled={payPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setPayPage(p => Math.min(totalPages, p + 1))} disabled={payPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Payroll Period Detail Dialog */}
      <Dialog open={!!viewPeriod} onOpenChange={() => setViewPeriod(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewPeriod?.periodName}</DialogTitle>
            <DialogDescription>
              {formatDate(viewPeriod?.startDate)} – {formatDate(viewPeriod?.endDate)} • Pay Date: {formatDate(viewPeriod?.payDate)}
            </DialogDescription>
          </DialogHeader>
          {viewPeriod && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-muted rounded p-3 text-center">
                  <p className="text-muted-foreground text-xs">Gross Pay</p>
                  <p className="font-semibold">{formatCurrency(viewPeriod.totalGrossPay, "KES")}</p>
                </div>
                <div className="bg-muted rounded p-3 text-center">
                  <p className="text-muted-foreground text-xs">Deductions</p>
                  <p className="font-semibold">{formatCurrency(viewPeriod.totalDeductions, "KES")}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
                  <p className="text-muted-foreground text-xs">Net Pay</p>
                  <p className="font-semibold text-green-700">{formatCurrency(viewPeriod.totalNetPay, "KES")}</p>
                </div>
              </div>

              <Separator />
              <h4 className="font-medium text-sm">Payroll Entries</h4>

              {entriesLoading && <p className="text-sm text-muted-foreground">Loading entries…</p>}

              {!entriesLoading && payrollEntries.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No individual entries recorded for this period.</p>
              )}

              {payrollEntries.length > 0 && (
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left p-2 font-medium">Employee</th>
                        <th className="text-right p-2 font-medium">Basic</th>
                        <th className="text-right p-2 font-medium">Deductions</th>
                        <th className="text-right p-2 font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollEntries.map((entry: any) => (
                        <tr key={entry.id} className="border-b">
                          <td className="p-2">{entry.employeeName ?? entry.employeeId}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(entry.basicSalary ?? entry.grossPay, "KES")}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(entry.totalDeductions, "KES")}</td>
                          <td className="p-2 text-right font-mono font-semibold">{formatCurrency(entry.netPay, "KES")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {viewPeriod.status === "pending_approval" && (
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => processPayrollMutation.mutate(viewPeriod.id)}
                  disabled={processPayrollMutation.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {processPayrollMutation.isPending ? "Processing…" : "Process & Disburse Payroll"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New Payroll Period Dialog */}
      <Dialog open={isNewPayrollDialogOpen} onOpenChange={setIsNewPayrollDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Payroll Period</DialogTitle>
            <DialogDescription>Define dates for the new payroll run</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="period-name">Period Name *</Label>
              <Input
                id="period-name"
                value={newPeriod.periodName}
                onChange={(e) => setNewPeriod({ ...newPeriod, periodName: e.target.value })}
                placeholder="e.g. May 2025"
                data-testid="input-period-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="period-start">Start Date *</Label>
                <Input
                  id="period-start"
                  type="date"
                  value={newPeriod.startDate}
                  onChange={(e) => setNewPeriod({ ...newPeriod, startDate: e.target.value })}
                  data-testid="input-period-start"
                />
              </div>
              <div>
                <Label htmlFor="period-end">End Date *</Label>
                <Input
                  id="period-end"
                  type="date"
                  value={newPeriod.endDate}
                  onChange={(e) => setNewPeriod({ ...newPeriod, endDate: e.target.value })}
                  data-testid="input-period-end"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="pay-date">Pay Date *</Label>
              <Input
                id="pay-date"
                type="date"
                value={newPeriod.payDate}
                onChange={(e) => setNewPeriod({ ...newPeriod, payDate: e.target.value })}
                data-testid="input-pay-date"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={() => createPayrollPeriodMutation.mutate(newPeriod)}
                disabled={
                  createPayrollPeriodMutation.isPending ||
                  !newPeriod.periodName.trim() ||
                  !newPeriod.startDate ||
                  !newPeriod.endDate ||
                  !newPeriod.payDate
                }
                data-testid="button-submit-payroll"
              >
                {createPayrollPeriodMutation.isPending ? "Creating…" : "Create Payroll Period"}
              </Button>
              <Button variant="outline" onClick={() => setIsNewPayrollDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── General Ledger ───────────────────────────────────────────────────────────

const GeneralLedger = ({ onNavigateToSettings }: { onNavigateToSettings?: () => void }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewEntryDialogOpen, setIsNewEntryDialogOpen] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerPageSize, setLedgerPageSize] = useState(25);
  const [ledgerPage, setLedgerPage] = useState(1);
  // Real accounts only — server seeds them automatically on first GET
  const { data: chartOfAccounts = [], isLoading: accountsLoading } = useQuery<any[]>({
    queryKey: ["/api/chart-of-accounts"],
  });

  const [newEntry, setNewEntry] = useState({
    accountId: "",
    accountName: "",
    description: "",
    debitAmount: "",
    creditAmount: "",
    reference: "",
  });

  const { data: ledgerResponse, isLoading } = useQuery<any>({
    queryKey: ["/api/general-ledger"],
  });

  const ledgerEntries: any[] = Array.isArray(ledgerResponse)
    ? ledgerResponse
    : ledgerResponse?.entries ?? [];

  const createEntryMutation = useMutation({
    mutationFn: async (data: typeof newEntry) => {
      const debit = parseFloat(data.debitAmount) || 0;
      const credit = parseFloat(data.creditAmount) || 0;
      if (debit === 0 && credit === 0) throw new Error("Either debit or credit must be greater than 0.");
      return await apiRequest("/api/general-ledger", {
        method: "POST",
        data: {
          ...data,
          debitAmount: debit,
          creditAmount: credit,
          transactionDate: new Date().toISOString(),
          transactionId: `GL-${Date.now()}`,
          fiscalYear: new Date().getFullYear(),
          fiscalPeriod: new Date().getMonth() + 1,
          currency: "KES",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/general-ledger"] });
      toast({ title: "Entry Created", description: "Journal entry has been recorded in the general ledger." });
      setIsNewEntryDialogOpen(false);
      setNewEntry({ accountId: "", accountName: "", description: "", debitAmount: "", creditAmount: "", reference: "" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to create ledger entry", variant: "destructive" });
    },
  });

  const handleExport = async () => {
    try {
      toast({ title: "Exporting…", description: "Preparing general ledger export." });
      const res = await apiRequest("/api/general-ledger/export", { method: "GET" });
      const data = await res.json();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `general-ledger-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export Complete", description: "Ledger exported to your downloads folder." });
    } catch {
      toast({ title: "Export Failed", description: "Could not export the general ledger. Please try again.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">General Ledger</h3>
          <p className="text-sm text-muted-foreground">Double-entry bookkeeping records for the organisation</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Entries are auto-posted when expenses and payroll are approved.
            Manual entries are also supported.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} data-testid="button-export-ledger">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setIsNewEntryDialogOpen(true)}
            data-testid="button-new-ledger-entry"
            disabled={(chartOfAccounts as any[]).length === 0 && !accountsLoading}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Entry
          </Button>
        </div>
      </div>

      {(chartOfAccounts as any[]).length === 0 && !accountsLoading && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Chart of Accounts is loading…</strong> The server automatically creates standard accounts on first visit.
          If this persists, go to{" "}
          {onNavigateToSettings ? (
            <button className="underline font-medium" onClick={onNavigateToSettings}>
              Settings → Chart of Accounts
            </button>
          ) : "Settings → Chart of Accounts"}{" "}
          to seed or add accounts.
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading ledger entries…</p>}

      {!isLoading && ledgerEntries.length === 0 && (
        <EmptyState
          icon={Archive}
          title="No Ledger Entries"
          description="Record journal entries to maintain double-entry bookkeeping for this organisation."
        />
      )}

      {ledgerEntries.length > 0 && (() => {
        const filtered = ledgerEntries.filter((entry: any) => {
          const q = ledgerSearch.toLowerCase();
          return !q || entry.transactionId?.toLowerCase().includes(q) || entry.accountName?.toLowerCase().includes(q) || entry.description?.toLowerCase().includes(q) || entry.reference?.toLowerCase().includes(q);
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / ledgerPageSize));
        const paginated = ledgerPageSize === -1 ? filtered : filtered.slice((ledgerPage - 1) * ledgerPageSize, ledgerPage * ledgerPageSize);
        return (
          <>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by transaction ID, account, description…"
                  value={ledgerSearch}
                  onChange={(e) => { setLedgerSearch(e.target.value); setLedgerPage(1); }}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(ledgerPageSize)} onValueChange={(v) => { setLedgerPageSize(Number(v)); setLedgerPage(1); }}>
                  <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="-1">All</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Transaction ID</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Debit (KES)</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Credit (KES)</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((entry: any) => {
                    const debit = parseFloat(entry.debitAmount);
                    const credit = parseFloat(entry.creditAmount);
                    return (
                      <tr key={entry.id} className="border-b hover:bg-muted/50">
                        <td className="p-3 font-mono text-xs text-muted-foreground">{entry.transactionId}</td>
                        <td className="p-3 font-medium">{entry.accountName}</td>
                        <td className="p-3 text-muted-foreground max-w-xs truncate">{entry.description}</td>
                        <td className="p-3 text-right font-mono text-red-700">
                          {debit > 0 ? debit.toLocaleString("en-KE", { minimumFractionDigits: 2 }) : ""}
                        </td>
                        <td className="p-3 text-right font-mono text-green-700">
                          {credit > 0 ? credit.toLocaleString("en-KE", { minimumFractionDigits: 2 }) : ""}
                        </td>
                        <td className="p-3 text-muted-foreground">{formatDate(entry.transactionDate)}</td>
                        <td className="p-3 font-mono text-xs">{entry.reference || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ledgerPageSize !== -1 && totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>Page {ledgerPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setLedgerPage(p => Math.max(1, p - 1))} disabled={ledgerPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setLedgerPage(p => Math.min(totalPages, p + 1))} disabled={ledgerPage === totalPages}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* New Journal Entry Dialog */}
      <Dialog open={isNewEntryDialogOpen} onOpenChange={setIsNewEntryDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Record a double-entry transaction in the general ledger</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="gl-account">Account *</Label>
              <Select
                value={newEntry.accountId}
                onValueChange={(val) => {
                  const acc = (chartOfAccounts as any[]).find((a: any) => String(a.id) === val);
                  setNewEntry({ ...newEntry, accountId: val, accountName: acc?.accountName ?? val });
                }}
              >
                <SelectTrigger id="gl-account" data-testid="input-gl-account">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {(chartOfAccounts as any[]).map((acc: any) => (
                    <SelectItem key={acc.id} value={String(acc.id)}>
                      {acc.accountCode} – {acc.accountName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gl-description">Description *</Label>
              <Textarea
                id="gl-description"
                value={newEntry.description}
                onChange={(e) => setNewEntry({ ...newEntry, description: e.target.value })}
                placeholder="What does this transaction represent?"
                data-testid="input-gl-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="gl-debit">Debit (KES)</Label>
                <Input
                  id="gl-debit"
                  type="number"
                  min="0"
                  value={newEntry.debitAmount}
                  onChange={(e) =>
                    setNewEntry({ ...newEntry, debitAmount: e.target.value, creditAmount: e.target.value ? "" : newEntry.creditAmount })
                  }
                  placeholder="0.00"
                  data-testid="input-gl-debit"
                />
              </div>
              <div>
                <Label htmlFor="gl-credit">Credit (KES)</Label>
                <Input
                  id="gl-credit"
                  type="number"
                  min="0"
                  value={newEntry.creditAmount}
                  onChange={(e) =>
                    setNewEntry({ ...newEntry, creditAmount: e.target.value, debitAmount: e.target.value ? "" : newEntry.debitAmount })
                  }
                  placeholder="0.00"
                  data-testid="input-gl-credit"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Enter either a debit or a credit — not both for a single-line entry.</p>
            <div>
              <Label htmlFor="gl-reference">Reference</Label>
              <Input
                id="gl-reference"
                value={newEntry.reference}
                onChange={(e) => setNewEntry({ ...newEntry, reference: e.target.value })}
                placeholder="e.g. RENT-INV-102, PR-2025-0045"
                data-testid="input-gl-reference"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => createEntryMutation.mutate(newEntry)}
                disabled={
                  createEntryMutation.isPending ||
                  !newEntry.accountId ||
                  !newEntry.description.trim() ||
                  (!newEntry.debitAmount && !newEntry.creditAmount)
                }
                data-testid="button-submit-gl-entry"
              >
                {createEntryMutation.isPending ? "Saving…" : "Save Entry"}
              </Button>
              <Button variant="outline" onClick={() => setIsNewEntryDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Financial Reports ────────────────────────────────────────────────────────

// Helper: section header row inside a table
const ReportSectionHeader = ({ title }: { title: string }) => (
  <tr className="bg-muted">
    <td colSpan={3} className="py-2 px-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">{title}</td>
  </tr>
);

const FinancialReports = () => {
  const { toast } = useToast();

  const today = new Date().toISOString().split("T")[0];
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<any>(null);
  const [dateRange, setDateRange] = useState({ startDate: yearStart, endDate: today });

  // Pull cross-tab data to supplement report generation
  const { data: payrollPeriods = [] } = useQuery<any[]>({ queryKey: ["/api/payroll"] });
  const { data: expenseReports = [] } = useQuery<any[]>({ queryKey: ["/api/expense-reports"] });
  const { data: requisitions = [] } = useQuery<any[]>({ queryKey: ["/api/purchase-requisitions"] });
  const { data: chartOfAccountsRaw = [] } = useQuery<any[]>({ queryKey: ["/api/chart-of-accounts"] });

  // Build supplementary data from cross-tab sources when API report returns empty sections
  const buildSupplementaryData = useCallback((reportType: string, apiData: any) => {
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);

    const inRange = (dateStr: string) => {
      if (!dateStr) return true;
      const d = new Date(dateStr);
      return d >= start && d <= end;
    };

    if (reportType === "income_statement") {
      // Build revenue from approved/processed requisitions acting as income
      const approvedReqs = (requisitions as any[]).filter(r => 
        (r.approvalStatus === "approved" || r.approvalStatus === "processed") && inRange(r.requestedDate)
      );
      // Build expenses from expense reports + payroll
      const approvedExpenses = (expenseReports as any[]).filter(r =>
        (r.approvalStatus === "approved" || r.approvalStatus === "processed") && inRange(r.submittedDate)
      );
      const payrollExpenses = (payrollPeriods as any[]).filter(p => inRange(p.startDate));

      const supplementExpenses = [
        ...approvedExpenses.map(r => ({
          accountName: r.title || "Expense",
          category: r.expenseType || "operational",
          amount: parseFloat(r.totalAmount) || 0,
        })),
        ...payrollExpenses.map(p => ({
          accountName: `Payroll: ${p.periodName}`,
          category: "payroll",
          amount: parseFloat(p.totalNetPay) || parseFloat(p.totalGrossPay) || 0,
        })),
      ];

      // Merge: if API returned expenses, use them; otherwise use supplementary
      const mergedExpenses = (apiData.expenses?.length > 0) ? apiData.expenses : supplementExpenses;
      const totalExpenses = mergedExpenses.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const totalRevenue = parseFloat(apiData.totalRevenue) || (apiData.revenue || []).reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);

      return {
        ...apiData,
        expenses: mergedExpenses,
        totalRevenue,
        totalExpenses,
        netIncome: totalRevenue - totalExpenses,
      };
    }

    if (reportType === "cash_flow") {
      const payrollExpenses = (payrollPeriods as any[]).filter(p => inRange(p.payDate));
      const approvedExpenses = (expenseReports as any[]).filter(r =>
        r.approvalStatus === "approved" && inRange(r.submittedDate)
      );

      const supplementOperating = [
        ...approvedExpenses.map(r => ({
          description: r.title || "Operational expense",
          amount: -(parseFloat(r.totalAmount) || 0),
        })),
        ...payrollExpenses.map(p => ({
          description: `Payroll: ${p.periodName}`,
          amount: -(parseFloat(p.totalNetPay) || parseFloat(p.totalGrossPay) || 0),
        })),
      ];

      const mergedOperating = (apiData.operatingActivities?.length > 0) 
        ? apiData.operatingActivities 
        : supplementOperating;

      return {
        ...apiData,
        operatingActivities: mergedOperating,
      };
    }

    if (reportType === "trial_balance") {
      // If API returned no accounts, show the real CoA accounts with zero balances
      if (!apiData.accounts || apiData.accounts.length === 0) {
        const accounts = (chartOfAccountsRaw as any[]);
        if (accounts.length > 0) {
          return {
            ...apiData,
            accounts: accounts.map((a: any) => ({
              accountCode: a.accountCode,
              accountName: a.accountName,
              accountType: a.accountType,
              debitBalance: ["asset", "expense"].includes(a.accountType)
                ? (parseFloat(a.openingBalance) || 0).toFixed(2)
                : "0.00",
              creditBalance: ["liability", "equity", "revenue"].includes(a.accountType)
                ? (parseFloat(a.openingBalance) || 0).toFixed(2)
                : "0.00",
            })),
          };
        }
      }
    }

    return apiData;
  }, [payrollPeriods, expenseReports, requisitions, chartOfAccountsRaw, dateRange]);

  const generateReportMutation = useMutation({
    mutationFn: async (reportType: string) => {
      setActiveReport(reportType);
      const res = await apiRequest("/api/reports/generate", {
        method: "POST",
        data: {
          reportType,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          asOfDate: dateRange.endDate,
          currency: "KES",
        },
      });
      return res.json();
    },
    onSuccess: (data: any, reportType: string) => {
      const rawData = data?.data ?? data;

      // Normalize nested API shapes into the flat shapes the renderers expect
      const normalized = (() => {
        if (reportType === "income_statement") {
          // API returns: { revenue: { lines: [], totalRevenue }, expenses: { lines: [], totalExpenses }, netIncome, period: "X to Y" }
          const rev = rawData.revenue;
          const exp = rawData.expenses;
          const revenue  = Array.isArray(rev) ? rev : (Array.isArray(rev?.lines) ? rev.lines : []);
          const expenses = Array.isArray(exp) ? exp : (Array.isArray(exp?.lines) ? exp.lines : []);
          // API returns `period` as "YYYY-MM-DD to YYYY-MM-DD" — split it for the renderer which wants startDate/endDate
          let startDate = rawData.startDate ?? dateRange.startDate;
          let endDate   = rawData.endDate   ?? dateRange.endDate;
          if (!rawData.startDate && rawData.period?.includes(" to ")) {
            [startDate, endDate] = rawData.period.split(" to ");
          }
          return {
            ...rawData,
            revenue,
            expenses,
            startDate,
            endDate,
            totalRevenue:  rev?.totalRevenue  ?? rawData.totalRevenue  ?? "0.00",
            totalExpenses: exp?.totalExpenses ?? rawData.totalExpenses ?? "0.00",
          };
        }
        if (reportType === "balance_sheet") {
          // API returns: { assets: { lines: [], totalAssets }, liabilities: { lines: [], totalLiabilities }, equity: { lines: [], totalEquity }, asOfDate }
          const ast = rawData.assets;
          const lib = rawData.liabilities;
          const eq  = rawData.equity;
          return {
            ...rawData,
            assets:      Array.isArray(ast) ? ast : (Array.isArray(ast?.lines) ? ast.lines : []),
            liabilities: Array.isArray(lib) ? lib : (Array.isArray(lib?.lines) ? lib.lines : []),
            equity:      Array.isArray(eq)  ? eq  : (Array.isArray(eq?.lines)  ? eq.lines  : []),
            // asOfDate is returned correctly by storage — pass through
            totalAssets:      ast?.totalAssets      ?? rawData.totalAssets      ?? "0.00",
            totalLiabilities: lib?.totalLiabilities ?? rawData.totalLiabilities ?? "0.00",
            totalEquity:      eq?.totalEquity       ?? rawData.totalEquity      ?? "0.00",
          };
        }
        if (reportType === "cash_flow") {
          // API returns: { operatingActivities: { rentCollected, expensesPaid, payrollDisbursed, netCashFromOperations }, investingActivities: { netCashFromInvesting }, financingActivities: { netCashFromFinancing }, netCashIncrease, period }
          const op  = rawData.operatingActivities;
          const inv = rawData.investingActivities;
          const fin = rawData.financingActivities;
          // expensesPaid and payrollDisbursed are already stored as negatives in storage
          const operatingActivities = Array.isArray(op) ? op : [
            ...(op?.rentCollected    != null ? [{ description: "Rent Collected",    amount: op.rentCollected    }] : []),
            ...(op?.expensesPaid     != null ? [{ description: "Expenses Paid",     amount: op.expensesPaid     }] : []),
            ...(op?.payrollDisbursed != null ? [{ description: "Payroll Disbursed", amount: op.payrollDisbursed }] : []),
          ];
          const investingActivities = Array.isArray(inv) ? inv : (inv?.netCashFromInvesting != null ? [{ description: "Net Investing Activities", amount: inv.netCashFromInvesting }] : []);
          const financingActivities = Array.isArray(fin) ? fin : (fin?.netCashFromFinancing != null ? [{ description: "Net Financing Activities", amount: fin.netCashFromFinancing }] : []);
          let startDate = rawData.startDate ?? dateRange.startDate;
          let endDate   = rawData.endDate   ?? dateRange.endDate;
          if (!rawData.startDate && rawData.period?.includes(" to ")) {
            [startDate, endDate] = rawData.period.split(" to ");
          }
          return {
            ...rawData,
            operatingActivities,
            investingActivities,
            financingActivities,
            startDate,
            endDate,
            // storage returns netCashIncrease as the operating net; map to individual section nets
            netOperating: op?.netCashFromOperations ?? rawData.netOperating ?? rawData.netCashIncrease ?? "0.00",
            netInvesting: inv?.netCashFromInvesting ?? rawData.netInvesting ?? "0.00",
            netFinancing: fin?.netCashFromFinancing ?? rawData.netFinancing ?? "0.00",
          };
        }
        if (reportType === "trial_balance") {
          // API returns reportDate not asOfDate — normalise for renderer
          return {
            ...rawData,
            asOfDate: rawData.asOfDate ?? rawData.reportDate ?? dateRange.endDate,
          };
        }
        return rawData;
      })();

      // Enrich with cross-tab data
      const enriched = buildSupplementaryData(reportType, normalized);
      setReportResult(enriched);
      toast({ title: "Report Generated", description: "Your financial report is ready below." });
    },
    onError: (err: any) => {
      setReportResult(null);
      toast({
        title: "Report Failed",
        description: err?.message || "Could not generate the report. Please try again.",
        variant: "destructive",
      });
    },
  });

  const reportTypes = [
    {
      name: "Trial Balance",
      icon: Calculator,
      description: "Verify that debits equal credits across all accounts",
      key: "trial_balance",
      color: "bg-blue-100 text-blue-600",
    },
    {
      name: "Income Statement",
      icon: TrendingUp,
      description: "Revenue, expenses, and net profit for the period",
      key: "income_statement",
      color: "bg-green-100 text-green-600",
    },
    {
      name: "Balance Sheet",
      icon: FileBarChart,
      description: "Snapshot of assets, liabilities, and owner's equity",
      key: "balance_sheet",
      color: "bg-purple-100 text-purple-600",
    },
    {
      name: "Cash Flow Statement",
      icon: Banknote,
      description: "Track cash receipts and payments from all activities",
      key: "cash_flow",
      color: "bg-orange-100 text-orange-600",
    },
  ];

  // ── Render report output ──────────────────────────────────────────────────
  const renderReportOutput = () => {
    if (!reportResult || !activeReport) return null;
    const r = reportResult;

    if (activeReport === "trial_balance") {
      const accounts: any[] = r.accounts ?? [];
      const totalDebits = accounts.reduce((s: number, a: any) => s + (parseFloat(a.debitBalance) || 0), 0);
      const totalCredits = accounts.reduce((s: number, a: any) => s + (parseFloat(a.creditBalance) || 0), 0);
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-base">{r.title ?? "Trial Balance"}</h4>
            <span className="text-xs text-muted-foreground">As of {formatDate(r.asOfDate ?? dateRange.endDate)}</span>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account Code</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account Name</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Debit (KES)</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Credit (KES)</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No ledger accounts found for this period.</td></tr>
                ) : (
                  accounts.map((a: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/40">
                      <td className="p-3 font-mono text-xs text-muted-foreground">{a.accountCode ?? "—"}</td>
                      <td className="p-3 font-medium">{a.accountName}</td>
                      <td className="p-3 capitalize text-muted-foreground">{a.accountType?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{parseFloat(a.debitBalance) > 0 ? formatCurrency(a.debitBalance) : ""}</td>
                      <td className="p-3 text-right font-mono">{parseFloat(a.creditBalance) > 0 ? formatCurrency(a.creditBalance) : ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted font-semibold border-t-2">
                  <td colSpan={3} className="p-3">Totals</td>
                  <td className="p-3 text-right font-mono">{formatCurrency(totalDebits)}</td>
                  <td className="p-3 text-right font-mono">{formatCurrency(totalCredits)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className={`p-2 text-center text-xs font-medium ${Math.abs(totalDebits - totalCredits) < 0.01 ? "text-green-700" : "text-red-700"}`}>
                    {Math.abs(totalDebits - totalCredits) < 0.01
                      ? "✔ Balanced — Debits equal Credits"
                      : `⚠ Out of balance by ${formatCurrency(Math.abs(totalDebits - totalCredits))}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "income_statement") {
      const revenue: any[] = r.revenue ?? [];
      const expenses: any[] = r.expenses ?? [];
      const totalRevenue = parseFloat(r.totalRevenue) || revenue.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const totalExpenses = parseFloat(r.totalExpenses) || expenses.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const netIncome = r.netIncome != null ? parseFloat(r.netIncome) : (totalRevenue - totalExpenses);
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-base">{r.title ?? "Income Statement"}</h4>
            <span className="text-xs text-muted-foreground">{formatDate(r.startDate ?? dateRange.startDate)} – {formatDate(r.endDate ?? dateRange.endDate)}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="font-bold text-green-700 text-lg">{formatCurrency(totalRevenue)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Expenses</p>
              <p className="font-bold text-red-700 text-lg">{formatCurrency(totalExpenses)}</p>
            </div>
            <div className={`border rounded p-3 text-center ${netIncome >= 0 ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"}`}>
              <p className="text-xs text-muted-foreground">Net {netIncome >= 0 ? "Income" : "Loss"}</p>
              <p className={`font-bold text-lg ${netIncome >= 0 ? "text-blue-700" : "text-orange-700"}`}>{formatCurrency(Math.abs(netIncome))}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount (KES)</th>
                </tr>
              </thead>
              <tbody>
                <ReportSectionHeader title="Revenue" />
                {revenue.length === 0 ? (
                  <tr><td colSpan={3} className="p-3 text-muted-foreground text-center">No revenue entries</td></tr>
                ) : revenue.map((x: any, i: number) => (
                  <tr key={`rev-${i}`} className="border-b hover:bg-muted/40">
                    <td className="px-5 py-3.5 text-slate-700">{x.accountName ?? x.account}</td>
                    <td className="p-3 text-muted-foreground capitalize">{x.category?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="p-3 text-right font-mono text-green-700">{formatCurrency(x.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td colSpan={2} className="p-3 text-foreground">Total Revenue</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalRevenue)}</td>
                </tr>
                <ReportSectionHeader title="Expenses" />
                {expenses.length === 0 ? (
                  <tr><td colSpan={3} className="p-3 text-muted-foreground text-center">No expense entries</td></tr>
                ) : expenses.map((x: any, i: number) => (
                  <tr key={`exp-${i}`} className="border-b hover:bg-muted/40">
                    <td className="px-5 py-3.5 text-slate-700">{x.accountName ?? x.account}</td>
                    <td className="p-3 text-muted-foreground capitalize">{x.category?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="p-3 text-right font-mono text-red-700">{formatCurrency(x.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td colSpan={2} className="p-3 text-foreground">Total Expenses</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalExpenses)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 bg-muted">
                  <td colSpan={2} className="p-3 text-foreground">Net {netIncome >= 0 ? "Income" : "Loss"}</td>
                  <td className={`p-3 text-right font-mono ${netIncome >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatCurrency(Math.abs(netIncome))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "balance_sheet") {
      const assets: any[] = r.assets ?? [];
      const liabilities: any[] = r.liabilities ?? [];
      const equity: any[] = r.equity ?? [];
      const totalAssets = parseFloat(r.totalAssets) || assets.reduce((s: number, x: any) => s + (parseFloat(x.balance) || 0), 0);
      const totalLiabilities = parseFloat(r.totalLiabilities) || liabilities.reduce((s: number, x: any) => s + (parseFloat(x.balance) || 0), 0);
      const totalEquity = parseFloat(r.totalEquity) || equity.reduce((s: number, x: any) => s + (parseFloat(x.balance) || 0), 0);
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-base">{r.title ?? "Balance Sheet"}</h4>
            <span className="text-xs text-muted-foreground">As of {formatDate(r.asOfDate ?? dateRange.endDate)}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Assets</p>
              <p className="font-bold text-blue-700 text-lg">{formatCurrency(totalAssets)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Liabilities</p>
              <p className="font-bold text-red-700 text-lg">{formatCurrency(totalLiabilities)}</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Equity</p>
              <p className="font-bold text-purple-700 text-lg">{formatCurrency(totalEquity)}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sub-type</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance (KES)</th>
                </tr>
              </thead>
              <tbody>
                <ReportSectionHeader title="Assets" />
                {assets.length === 0 ? <tr><td colSpan={3} className="p-3 text-muted-foreground text-center">No asset accounts</td></tr>
                  : assets.map((x: any, i: number) => (
                    <tr key={`ast-${i}`} className="border-b hover:bg-muted/40">
                      <td className="px-5 py-3.5 text-slate-700">{x.accountName ?? x.account}</td>
                      <td className="p-3 text-muted-foreground capitalize">{x.subType?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{formatCurrency(x.balance)}</td>
                    </tr>
                  ))}
                <tr className="bg-muted font-semibold">
                  <td colSpan={2} className="p-3 text-foreground">Total Assets</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalAssets)}</td>
                </tr>
                <ReportSectionHeader title="Liabilities" />
                {liabilities.length === 0 ? <tr><td colSpan={3} className="p-3 text-muted-foreground text-center">No liability accounts</td></tr>
                  : liabilities.map((x: any, i: number) => (
                    <tr key={`lib-${i}`} className="border-b hover:bg-muted/40">
                      <td className="px-5 py-3.5 text-slate-700">{x.accountName ?? x.account}</td>
                      <td className="p-3 text-muted-foreground capitalize">{x.subType?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{formatCurrency(x.balance)}</td>
                    </tr>
                  ))}
                <tr className="bg-muted font-semibold">
                  <td colSpan={2} className="p-3 text-foreground">Total Liabilities</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalLiabilities)}</td>
                </tr>
                <ReportSectionHeader title="Equity" />
                {equity.length === 0 ? <tr><td colSpan={3} className="p-3 text-muted-foreground text-center">No equity accounts</td></tr>
                  : equity.map((x: any, i: number) => (
                    <tr key={`eq-${i}`} className="border-b hover:bg-muted/40">
                      <td className="px-5 py-3.5 text-slate-700">{x.accountName ?? x.account}</td>
                      <td className="p-3 text-muted-foreground capitalize">{x.subType?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="p-3 text-right font-mono">{formatCurrency(x.balance)}</td>
                    </tr>
                  ))}
                <tr className="bg-muted font-semibold">
                  <td colSpan={2} className="p-3 text-foreground">Total Equity</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalEquity)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 bg-muted">
                  <td colSpan={2} className="p-3 text-foreground">Liabilities + Equity</td>
                  <td className="p-3 text-right font-mono text-foreground">{formatCurrency(totalLiabilities + totalEquity)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className={`p-2 text-center text-xs font-medium ${Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 ? "text-green-700" : "text-red-700"}`}>
                    {Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
                      ? "✔ Balanced — Assets equal Liabilities + Equity"
                      : `⚠ Out of balance by ${formatCurrency(Math.abs(totalAssets - (totalLiabilities + totalEquity)))}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }

    if (activeReport === "cash_flow") {
      const operating: any[] = r.operatingActivities ?? [];
      const investing: any[] = r.investingActivities ?? [];
      const financing: any[] = r.financingActivities ?? [];
      const netOperating = parseFloat(r.netOperating) || operating.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const netInvesting = parseFloat(r.netInvesting) || investing.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const netFinancing = parseFloat(r.netFinancing) || financing.reduce((s: number, x: any) => s + (parseFloat(x.amount) || 0), 0);
      const netChange = netOperating + netInvesting + netFinancing;
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-base">{r.title ?? "Cash Flow Statement"}</h4>
            <span className="text-xs text-muted-foreground">{formatDate(r.startDate ?? dateRange.startDate)} – {formatDate(r.endDate ?? dateRange.endDate)}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Operating</p>
              <p className={`font-bold text-base ${netOperating >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(netOperating)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Investing</p>
              <p className={`font-bold text-base ${netInvesting >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(netInvesting)}</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-center">
              <p className="text-xs text-muted-foreground">Financing</p>
              <p className={`font-bold text-base ${netFinancing >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(netFinancing)}</p>
            </div>
            <div className={`border rounded p-3 text-center ${netChange >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-orange-50 border-orange-200"}`}>
              <p className="text-xs text-muted-foreground">Net Change</p>
              <p className={`font-bold text-base ${netChange >= 0 ? "text-emerald-700" : "text-orange-700"}`}>{formatCurrency(netChange)}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount (KES)</th>
                </tr>
              </thead>
              <tbody>
                <ReportSectionHeader title="Operating Activities" />
                {operating.length === 0 ? (
                  <tr><td colSpan={2} className="p-3 text-muted-foreground text-center">No operating activity entries</td></tr>
                ) : operating.map((x: any, i: number) => (
                  <tr key={`op-${i}`} className="border-b hover:bg-muted/40">
                    <td className="px-5 py-3.5 text-slate-700">{x.description ?? x.label}</td>
                    <td className={`p-3 text-right font-mono ${parseFloat(x.amount) >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(x.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td className="p-3 text-foreground">Net Operating Cash Flow</td>
                  <td className={`p-3 text-right font-mono ${netOperating >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatCurrency(netOperating)}</td>
                </tr>
                <ReportSectionHeader title="Investing Activities" />
                {investing.length === 0 ? (
                  <tr><td colSpan={2} className="p-3 text-muted-foreground text-center">No investing activity entries</td></tr>
                ) : investing.map((x: any, i: number) => (
                  <tr key={`inv-${i}`} className="border-b hover:bg-muted/40">
                    <td className="px-5 py-3.5 text-slate-700">{x.description ?? x.label}</td>
                    <td className={`p-3 text-right font-mono ${parseFloat(x.amount) >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(x.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td className="p-3 text-foreground">Net Investing Cash Flow</td>
                  <td className={`p-3 text-right font-mono ${netInvesting >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatCurrency(netInvesting)}</td>
                </tr>
                <ReportSectionHeader title="Financing Activities" />
                {financing.length === 0 ? (
                  <tr><td colSpan={2} className="p-3 text-muted-foreground text-center">No financing activity entries</td></tr>
                ) : financing.map((x: any, i: number) => (
                  <tr key={`fin-${i}`} className="border-b hover:bg-muted/40">
                    <td className="px-5 py-3.5 text-slate-700">{x.description ?? x.label}</td>
                    <td className={`p-3 text-right font-mono ${parseFloat(x.amount) >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(x.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-muted font-semibold">
                  <td className="p-3 text-foreground">Net Financing Cash Flow</td>
                  <td className={`p-3 text-right font-mono ${netFinancing >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatCurrency(netFinancing)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 bg-muted">
                  <td className="p-3 text-foreground">Net Change in Cash</td>
                  <td className={`p-3 text-right font-mono ${netChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"}`}>{formatCurrency(netChange)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Financial Reports</h3>
        <p className="text-sm text-muted-foreground">Generate standard financial statements for any date range</p>
      </div>

      {/* Date Range Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Report Period</CardTitle>
          <CardDescription className="text-xs">Select the date range for the reports below</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label htmlFor="report-start" className="text-xs">Start Date</Label>
              <Input
                id="report-start"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => { setDateRange(d => ({ ...d, startDate: e.target.value })); setReportResult(null); setActiveReport(null); }}
                className="mt-1 w-40"
                data-testid="input-report-start"
              />
            </div>
            <div>
              <Label htmlFor="report-end" className="text-xs">End Date / As-of Date</Label>
              <Input
                id="report-end"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => { setDateRange(d => ({ ...d, endDate: e.target.value })); setReportResult(null); setActiveReport(null); }}
                className="mt-1 w-40"
                data-testid="input-report-end"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDateRange({ startDate: yearStart, endDate: today }); setReportResult(null); setActiveReport(null); }}>YTD</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const now = new Date();
                const ms = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
                setDateRange({ startDate: ms, endDate: today }); setReportResult(null); setActiveReport(null);
              }}>MTD</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const now = new Date();
                const qs = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().split("T")[0];
                setDateRange({ startDate: qs, endDate: today }); setReportResult(null); setActiveReport(null);
              }}>QTD</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reportTypes.map((report) => (
          <Card
            key={report.key}
            className={`hover:shadow-md transition-shadow ${activeReport === report.key ? "ring-2 ring-primary" : ""}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${report.color} flex items-center justify-center`}>
                  <report.icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{report.name}</CardTitle>
                  <CardDescription className="text-xs">{report.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant={activeReport === report.key && reportResult ? "default" : "outline"}
                onClick={() => generateReportMutation.mutate(report.key)}
                disabled={generateReportMutation.isPending}
                data-testid={`button-generate-${report.key}`}
              >
                {generateReportMutation.isPending && activeReport === report.key ? (
                  <><FileText className="h-4 w-4 mr-2 animate-pulse" />Generating…</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />Generate Report</>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Report Output */}
      {reportResult && activeReport && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {renderReportOutput()}
            <div className="flex justify-end pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const r = reportResult;
                  let csv = "";
                  const filename = `${activeReport}-${dateRange.startDate}-to-${dateRange.endDate}.csv`;

                  if (activeReport === "trial_balance") {
                    const accounts: any[] = r.accounts ?? [];
                    csv = "Account Code,Account Name,Type,Debit (KES),Credit (KES)\n" +
                      accounts.map((a: any) => `"${a.accountCode}","${a.accountName}","${a.accountType}","${a.debitBalance}","${a.creditBalance}"`).join("\n") +
                      `\n"","Totals","","${accounts.reduce((s: number, a: any) => s + (parseFloat(a.debitBalance) || 0), 0).toFixed(2)}","${accounts.reduce((s: number, a: any) => s + (parseFloat(a.creditBalance) || 0), 0).toFixed(2)}"`;
                  } else if (activeReport === "income_statement") {
                    const revenue: any[] = r.revenue ?? [];
                    const expenses: any[] = r.expenses ?? [];
                    csv = "Section,Account,Category,Amount (KES)\n" +
                      revenue.map((x: any) => `"Revenue","${x.accountName ?? x.account}","${x.category ?? ""}","${x.amount}"`).join("\n") +
                      (revenue.length ? "\n" : "") +
                      expenses.map((x: any) => `"Expenses","${x.accountName ?? x.account}","${x.category ?? ""}","${x.amount}"`).join("\n") +
                      `\n"","Net Income","","${r.netIncome ?? ""}"`;
                  } else if (activeReport === "balance_sheet") {
                    const assets: any[] = r.assets ?? [];
                    const liabilities: any[] = r.liabilities ?? [];
                    const equity: any[] = r.equity ?? [];
                    csv = "Section,Account,Balance (KES)\n" +
                      assets.map((x: any)      => `"Assets","${x.accountName ?? x.account}","${x.balance}"`).join("\n") +
                      (assets.length ? "\n" : "") +
                      liabilities.map((x: any) => `"Liabilities","${x.accountName ?? x.account}","${x.balance}"`).join("\n") +
                      (liabilities.length ? "\n" : "") +
                      equity.map((x: any)      => `"Equity","${x.accountName ?? x.account}","${x.balance}"`).join("\n") +
                      `\n"","Total Assets","${r.totalAssets ?? ""}"\n"","Total Liabilities","${r.totalLiabilities ?? ""}"\n"","Total Equity","${r.totalEquity ?? ""}"`;
                  } else if (activeReport === "cash_flow") {
                    const operating: any[] = r.operatingActivities ?? [];
                    const investing: any[] = r.investingActivities ?? [];
                    const financing: any[] = r.financingActivities ?? [];
                    csv = "Section,Description,Amount (KES)\n" +
                      operating.map((x: any)  => `"Operating","${x.description ?? x.label}","${x.amount}"`).join("\n") +
                      (operating.length ? "\n" : "") +
                      investing.map((x: any)  => `"Investing","${x.description ?? x.label}","${x.amount}"`).join("\n") +
                      (investing.length ? "\n" : "") +
                      financing.map((x: any)  => `"Financing","${x.description ?? x.label}","${x.amount}"`).join("\n") +
                      `\n"","Net Change in Cash","${r.netCashIncrease ?? (parseFloat(r.netOperating || "0") + parseFloat(r.netInvesting || "0") + parseFloat(r.netFinancing || "0")).toFixed(2)}"`;
                  }

                  if (!csv) return;
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                data-testid="button-download-report"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// ─── Finance Settings ─────────────────────────────────────────────────────────

const FinanceSettings = () => {
  const queryClient = useQueryClient();
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: chartOfAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/chart-of-accounts"] });
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");

  const filteredAccounts = accountTypeFilter === "all"
    ? (chartOfAccounts as any[])
    : (chartOfAccounts as any[]).filter((a: any) => a.accountType === accountTypeFilter);

  const accountTypeColor: Record<string, string> = {
    asset: "bg-blue-100 text-blue-700",
    liability: "bg-red-100 text-red-700",
    equity: "bg-purple-100 text-purple-700",
    revenue: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    expense: "bg-orange-100 text-orange-700",
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Finance Settings</h3>
        <p className="text-sm text-muted-foreground">Configure chart of accounts, cost centres, and approval thresholds</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cost Centers */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">Cost Centers</CardTitle>
            </div>
            <CardDescription>
              {(costCenters as any[]).length} cost center{(costCenters as any[]).length !== 1 ? "s" : ""} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(costCenters as any[]).length === 0 ? (
              <p className="text-sm text-muted-foreground">No cost centers defined yet.</p>
            ) : (
              <ul className="space-y-2 text-sm max-h-40 overflow-y-auto">
                {(costCenters as any[]).map((cc: any) => (
                  <li key={cc.id} className="flex justify-between items-center border-b pb-1">
                    <span className="font-medium">{cc.name}</span>
                    <span className="text-muted-foreground text-xs">{cc.costCenterCode ?? cc.code ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Chart of Accounts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-indigo-600" />
                <CardTitle className="text-base">Chart of Accounts</CardTitle>
              </div>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setIsAddAccountOpen(true)}
                data-testid="button-add-account"
              >
                <Plus className="h-3 w-3 mr-1" /> Add Account
              </Button>
            </div>
            <CardDescription>
              {(chartOfAccounts as any[]).length} account{(chartOfAccounts as any[]).length !== 1 ? "s" : ""} defined
              {(chartOfAccounts as any[]).length === 0 && (
                <span className="text-amber-600 ml-1">— Ledger uses built-in defaults</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filter tabs */}
            <div className="flex flex-wrap gap-1 mb-3">
              {["all", "asset", "liability", "equity", "revenue", "expense"].map((t) => (
                <button
                  key={t}
                  onClick={() => setAccountTypeFilter(t)}
                  className={`text-xs px-2 py-1 rounded capitalize border transition-colors ${
                    accountTypeFilter === t
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-transparent border-muted-foreground/30 text-muted-foreground hover:border-indigo-400"
                  }`}
                >
                  {t === "all" ? "All" : t}
                </button>
              ))}
            </div>

            {(chartOfAccounts as any[]).length === 0 ? (
              <div className="py-6 text-center">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground opacity-30 mb-2" />
                <p className="text-sm text-muted-foreground">No custom accounts yet.</p>
                <p className="text-xs text-muted-foreground mt-1">The server seeds 22 standard accounts automatically on first visit.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setIsAddAccountOpen(true)}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add First Account
                </Button>
              </div>
            ) : filteredAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No {accountTypeFilter} accounts defined.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm max-h-52 overflow-y-auto pr-1">
                {filteredAccounts.map((acc: any) => (
                  <li key={acc.id} className="flex justify-between items-center border-b pb-1 last:border-0">
                    <div>
                      <span className="font-medium">{acc.accountName ?? acc.name}</span>
                      {acc.accountCode && (
                        <span className="text-xs text-muted-foreground ml-2">{acc.accountCode}</span>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${accountTypeColor[acc.accountType ?? acc.type] ?? "bg-muted"}`}
                    >
                      {acc.accountType ?? acc.type}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Approval Thresholds */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <CardTitle className="text-base">Approval Workflow Thresholds</CardTitle>
            </div>
            <CardDescription>Amounts that trigger each approval level for purchase requisitions and expense reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <p className="font-medium text-yellow-800">L1 Approval</p>
                <p className="text-muted-foreground text-xs mt-1">Line Manager</p>
                <p className="font-semibold mt-2">Up to KES 50,000</p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded p-3">
                <p className="font-medium text-orange-800">L2 Approval</p>
                <p className="text-muted-foreground text-xs mt-1">Finance Manager</p>
                <p className="font-semibold mt-2">KES 50,001 – 250,000</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded p-3">
                <p className="font-medium text-purple-800">MD Approval</p>
                <p className="text-muted-foreground text-xs mt-1">Managing Director</p>
                <p className="font-semibold mt-2">Above KES 250,000</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How Accounts Flow Into Reports */}
        <Card className="md:col-span-2 border-dashed border-indigo-300" >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" />
              <CardTitle className="text-sm font-medium text-indigo-700">How Data Flows Into Reports</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-blue-50 rounded p-3">
                <p className="font-semibold text-blue-800 mb-1">Requisitions</p>
                <p className="text-muted-foreground">Approved requisitions contribute to expense totals in Income Statement & Cash Flow</p>
              </div>
              <div className="bg-purple-50 rounded p-3">
                <p className="font-semibold text-purple-800 mb-1">Expense Reports</p>
                <p className="text-muted-foreground">Approved expense reports appear as operating expenses in Income Statement & Cash Flow</p>
              </div>
              <div className="bg-green-50 rounded p-3">
                <p className="font-semibold text-green-800 mb-1">Payroll</p>
                <p className="text-muted-foreground">Processed payroll periods flow as salary expenses into Income Statement & Cash Flow</p>
              </div>
              <div className="bg-orange-50 rounded p-3">
                <p className="font-semibold text-orange-800 mb-1">Ledger Entries</p>
                <p className="text-muted-foreground">Manual journal entries in the General Ledger feed Trial Balance & Balance Sheet</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AddAccountDialog
        open={isAddAccountOpen}
        onOpenChange={setIsAddAccountOpen}
        onSuccess={() => {}}
      />
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EnterpriseFinance() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("requisitions");

  const { data: requisitions = [] } = useQuery<any[]>({ queryKey: ["/api/purchase-requisitions"] });
  const { data: expenseReports = [] } = useQuery<any[]>({ queryKey: ["/api/expense-reports"] });
  const { data: payrollPeriods = [] } = useQuery<any[]>({ queryKey: ["/api/payroll"] });
  const { data: costCenters = [] } = useQuery<any[]>({ queryKey: ["/api/cost-centers"] });
  const { data: chartOfAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/chart-of-accounts"] });

  const pendingCount =
    (requisitions as any[]).filter((r) => r.approvalStatus?.startsWith("pending")).length +
    (expenseReports as any[]).filter((r) => r.approvalStatus?.startsWith("pending")).length;

  // Total budget = approved payroll net pay + approved requisitions
  const totalBudget = (() => {
    const payrollTotal = (payrollPeriods as any[])
      .filter(p => p.status === "processed" || p.status === "paid")
      .reduce((sum, p) => sum + (parseFloat(p.totalNetPay) || parseFloat(p.totalGrossPay) || 0), 0);
    const requisitionTotal = (requisitions as any[])
      .filter((r) => r.approvalStatus === "approved" || r.approvalStatus === "processed")
      .reduce((sum, r) => sum + (parseFloat(r.totalAmount) || 0), 0);
    return shortCurrency(payrollTotal + requisitionTotal);
  })();

  // Monthly expenses = all expense reports submitted this month (any status)
  const monthlyExpenses = (() => {
    const now = new Date();
    const total = (expenseReports as any[])
      .filter((r) => {
        if (!r.submittedDate) return false;
        const d = new Date(r.submittedDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, r) => sum + (parseFloat(r.totalAmount) || 0), 0);
    return shortCurrency(total);
  })();

  // Total payroll this year
  const totalPayroll = (() => {
    const yr = new Date().getFullYear();
    const processedPeriods = (payrollPeriods as any[]).filter(p => {
      if (!p.startDate) return false;
      return new Date(p.startDate).getFullYear() === yr && p.status === "processed";
    });
    const total = processedPeriods.reduce(
      (sum, p) => sum + (parseFloat(p.totalNetPay) || parseFloat(p.totalGrossPay) || 0), 0
    );
    return shortCurrency(total);
  })();

  const navigateToSettings = () => setActiveTab("settings");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Enterprise Finance</h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive financial management with 3-level approval workflows and enterprise-grade controls
          </p>
        </div>
        <Button
          variant="outline"
          onClick={navigateToSettings}
          data-testid="button-finance-settings"
        >
          <Settings className="h-4 w-4 mr-2" />
          Finance Settings
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Budget Committed"
          value={totalBudget || "KES 0"}
          description="Processed payroll + approved requisitions"
          icon={<PiggyBank className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          title="Pending Approvals"
          value={String(pendingCount)}
          description="Requisitions & expenses awaiting review"
          icon={<Clock className="h-4 w-4" />}
          color="orange"
        />
        <MetricCard
          title="Monthly Expenses"
          value={monthlyExpenses || "KES 0"}
          description="Expense reports submitted this month"
          icon={<CreditCard className="h-4 w-4" />}
          color="red"
        />
        <MetricCard
          title="Annual Payroll"
          value={totalPayroll || "KES 0"}
          description={`Processed payroll disbursements this year`}
          icon={<Users className="h-4 w-4" />}
          color="blue"
        />
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="requisitions" className="flex items-center gap-1 text-xs">
            <ShoppingCart className="h-3 w-3" />
            Requisitions
            {(requisitions as any[]).filter(r => r.approvalStatus?.startsWith("pending")).length > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-[10px] rounded-full px-1 min-w-[16px] text-center">
                {(requisitions as any[]).filter(r => r.approvalStatus?.startsWith("pending")).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex items-center gap-1 text-xs">
            <Receipt className="h-3 w-3" />
            Expenses
            {(expenseReports as any[]).filter(r => r.approvalStatus?.startsWith("pending")).length > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-[10px] rounded-full px-1 min-w-[16px] text-center">
                {(expenseReports as any[]).filter(r => r.approvalStatus?.startsWith("pending")).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="payroll" className="flex items-center gap-1 text-xs">
            <Users className="h-3 w-3" />
            Payroll
          </TabsTrigger>
          <TabsTrigger value="ledger" className="flex items-center gap-1 text-xs">
            <Archive className="h-3 w-3" />
            Ledger
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1 text-xs">
            <BarChart3 className="h-3 w-3" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1 text-xs">
            <Settings className="h-3 w-3" />
            Settings
            {(chartOfAccounts as any[]).length === 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[10px] rounded-full px-1">!</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requisitions">
          <PurchaseRequisitions />
        </TabsContent>

        <TabsContent value="expenses">
          <ExpenseReports />
        </TabsContent>

        <TabsContent value="payroll">
          <PayrollManagement />
        </TabsContent>

        <TabsContent value="ledger">
          <GeneralLedger onNavigateToSettings={navigateToSettings} />
        </TabsContent>

        <TabsContent value="reports">
          <FinancialReports />
        </TabsContent>

        <TabsContent value="settings">
          <FinanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}