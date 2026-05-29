import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CheckCircle, XCircle, Clock, DollarSign, FileText, AlertTriangle, User, Building, Wrench, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface ApprovalRequest {
  id: number;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: string;
  approval_status: "pending" | "approved" | "rejected";
  estimatedCost?: string | null;
  actualCost?: string | null;
  category?: string | null;
  createdAt: string;
  completedAt?: string | null;
  tenantName?: string | null;
  propertyName?: string | null;
  unitNumber?: string | null;
  ticketNumber?: string | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 border border-red-200",
  high: "bg-orange-100 text-orange-700 border border-orange-200",
  medium: "bg-amber-100 text-amber-700 border border-amber-200",
  low: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const STATUS_STYLES: Record<string, { pill: string; icon: any }> = {
  pending: { pill: "bg-amber-100 text-amber-700", icon: Clock },
  approved: { pill: "bg-emerald-50 text-emerald-700 border border-emerald-200", icon: CheckCircle },
  rejected: { pill: "bg-red-100 text-red-700", icon: XCircle },
};

const BG_COLOR_MAP: Record<string, string> = {
  amber: "bg-amber-50",
  blue: "bg-blue-50",
  red: "bg-red-50",
  purple: "bg-purple-50",
  gray: "bg-gray-50",
};

const ICON_COLOR_MAP: Record<string, string> = {
  amber: "text-amber-600",
  blue: "text-blue-600",
  red: "text-red-600",
  purple: "text-purple-600",
  gray: "text-gray-600",
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.low)}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize", cfg.pill)}>
      <Icon className="w-3 h-3" />
      {status.replace("_", " ")}
    </span>
  );
}

const safeFormatDate = (date: string | null | undefined): string => {
  if (!date) return "—";
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
  } catch {
    return "—";
  }
};

const formatCost = (cost?: string | null) => {
  if (!cost) return "—";
  const n = parseFloat(cost);
  return isNaN(n) ? "—" : `KSh ${n.toLocaleString()}`;
};

export default function MaintenanceApprovals() {
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<"approved" | "rejected">("approved");
  const [comments, setComments] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(10);
  const [processedPage, setProcessedPage] = useState(1);
  const [processedPageSize, setProcessedPageSize] = useState(10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: raw = [], isLoading } = useQuery<ApprovalRequest[]>({
    queryKey: ["/api/maintenance-requests/approvals"],
    queryFn: async () => {
      const res = await apiRequest("/api/maintenance-requests/approvals");
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: object }) => {
      const res = await apiRequest(`/api/maintenance-requests/${id}/approve`, {
        method: "POST",
        data: payload,
      });
      if (!res.ok) throw new Error("Request failed");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: approvalStatus === "approved" ? "Request approved" : "Request rejected",
        description: "The maintenance request has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      setDialogOpen(false);
      setSelected(null);
      setComments("");
      setApprovedAmount("");
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not process the approval. Please try again.",
        variant: "destructive"
      });
    },
  });

  const handleReview = (req: ApprovalRequest) => {
    setSelected(req);
    setApprovalStatus("approved");
    setComments("");
    setApprovedAmount(req.estimatedCost ?? "");
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!selected) return;
    approvalMutation.mutate({
      id: selected.id,
      payload: {
        approvalStatus,
        comments: comments || undefined,
        approvedAmount: approvedAmount ? parseFloat(approvedAmount) : undefined,
      },
    });
  };

  const pending = raw.filter(r => r.approval_status === "pending");
  const processed = raw.filter(r => r.approval_status !== "pending");

  const totalPendingCost = pending.reduce((sum, r) => sum + (r.estimatedCost ? parseFloat(r.estimatedCost) : 0), 0);
  const urgentCount = pending.filter(r => r.priority === "urgent").length;
  const pendingTotalPages = Math.max(1, Math.ceil(pending.length / pendingPageSize));
  const pendingPaginated = pending.slice((pendingPage - 1) * pendingPageSize, pendingPage * pendingPageSize);
  const processedTotalPages = Math.max(1, Math.ceil(processed.length / processedPageSize));
  const processedPaginated = processed.slice((processedPage - 1) * processedPageSize, processedPage * processedPageSize);

  const kpiItems = [
    { label: "Pending", value: pending.length, icon: Clock, color: "amber" },
    { label: "Total value", value: `KSh ${totalPendingCost.toLocaleString()}`, icon: DollarSign, color: "blue", small: true },
    { label: "Urgent", value: urgentCount, icon: AlertTriangle, color: urgentCount > 0 ? "red" : "gray" },
    { label: "Total received", value: raw.length, icon: FileText, color: "purple" },
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-8 bg-muted rounded w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-2xl" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border px-4 md:px-6 py-4 md:py-5">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-semibold text-foreground">Maintenance Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {raw.length} total · {pending.length} pending review
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {kpiItems.map(({ label, value, icon: Icon, color, small }) => (
            <Card key={label} className="rounded-2xl border-border shadow-none">
              <CardContent className="p-4 md:p-5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${BG_COLOR_MAP[color] || BG_COLOR_MAP.gray}`}>
                  <Icon className={`w-4 h-4 ${ICON_COLOR_MAP[color] || ICON_COLOR_MAP.gray}`} />
                </div>
                <div>
                  <p className={cn("font-semibold text-foreground", small ? "text-base" : "text-xl")}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Pending approvals */}
        <Card className="rounded-2xl border-border shadow-none overflow-hidden">
          <CardHeader className="px-5 py-4 border-b border-border bg-card">
            <CardTitle className="text-sm font-semibold">Pending Approvals</CardTitle>
            <CardDescription className="text-xs">Requests flagged as requiring authorisation</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {pending.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">All caught up</p>
                <p className="text-xs text-muted-foreground mt-1">No pending approvals at this time</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 dark:bg-gray-950/60 hover:bg-muted/40">
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Request</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Priority</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Property / Tenant</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Est. Cost</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Category</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Submitted</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingPaginated.map(req => (
                        <TableRow key={req.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => handleReview(req)}>
                          <TableCell>
                            <p className="font-medium text-sm text-foreground">{req.title}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[240px]">{req.description}</p>
                          </TableCell>
                          <TableCell><PriorityBadge priority={req.priority} /></TableCell>
                          <TableCell>
                            <div className="text-xs space-y-0.5">
                              {req.propertyName && (
                                <div className="flex items-center gap-1 text-foreground">
                                  <Building className="w-3 h-3 text-muted-foreground" />
                                  {req.propertyName}
                                  {req.unitNumber && <span className="text-muted-foreground">· Unit {req.unitNumber}</span>}
                                </div>
                              )}
                              {req.tenantName && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <User className="w-3 h-3" />
                                  {req.tenantName}
                                </div>
                              )}
                              {!req.propertyName && !req.tenantName && <span className="text-muted-foreground">—</span>}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{formatCost(req.estimatedCost)}</TableCell>
                          <TableCell>
                            {req.category ? (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 capitalize">{req.category}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{safeFormatDate(req.createdAt)}</TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleReview(req)}>
                              Review
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Pending pagination footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Rows per page</span>
                    <Select value={String(pendingPageSize)} onValueChange={v => { setPendingPageSize(Number(v)); setPendingPage(1); }}>
                      <SelectTrigger className="h-7 w-20 text-xs border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {(pendingPage - 1) * pendingPageSize + 1}–{Math.min(pendingPage * pendingPageSize, pending.length)} of {pending.length}
                    </span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pendingPage === 1} onClick={() => setPendingPage(p => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={pendingPage === pendingTotalPages} onClick={() => setPendingPage(p => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Processed */}
        {processed.length > 0 && (
          <Card className="rounded-2xl border-border shadow-none overflow-hidden">
            <CardHeader className="px-5 py-4 border-b border-border bg-card">
              <CardTitle className="text-sm font-semibold">Recently Processed</CardTitle>
              <CardDescription className="text-xs">Approved or rejected requests</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 dark:bg-gray-950/60 hover:bg-muted/40">
                      <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Request</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Status</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Est. Cost</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Category</TableHead>
                      <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedPaginated.map(req => (
                      <TableRow key={req.id} className="hover:bg-muted/30">
                        <TableCell>
                          <p className="font-medium text-sm text-foreground">{req.title}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[240px]">{req.description}</p>
                        </TableCell>
                        <TableCell><StatusBadge status={req.approval_status} /></TableCell>
                        <TableCell className="text-sm font-medium">{formatCost(req.estimatedCost)}</TableCell>
                        <TableCell>
                          {req.category ? (
                            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 capitalize">{req.category}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{safeFormatDate(req.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Processed pagination footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rows per page</span>
                  <Select value={String(processedPageSize)} onValueChange={v => { setProcessedPageSize(Number(v)); setProcessedPage(1); }}>
                    <SelectTrigger className="h-7 w-20 text-xs border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {(processedPage - 1) * processedPageSize + 1}–{Math.min(processedPage * processedPageSize, processed.length)} of {processed.length}
                  </span>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={processedPage === 1} onClick={() => setProcessedPage(p => p - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={processedPage === processedTotalPages} onClick={() => setProcessedPage(p => p + 1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Review dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) setSelected(null); }}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Review Maintenance Request</DialogTitle>
            <DialogDescription>Approve or reject this request</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 py-1">
              {/* Summary */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm text-foreground leading-snug">{selected.title}</p>
                  <PriorityBadge priority={selected.priority} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{selected.description}</p>
                <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
                  {selected.propertyName && (
                    <span className="flex items-center gap-1">
                      <Building className="w-3 h-3" />
                      {selected.propertyName}
                      {selected.unitNumber && ` · Unit ${selected.unitNumber}`}
                    </span>
                  )}
                  {selected.tenantName && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {selected.tenantName}
                    </span>
                  )}
                  {selected.category && (
                    <span className="flex items-center gap-1">
                      <Wrench className="w-3 h-3" />
                      {selected.category}
                    </span>
                  )}
                </div>
              </div>

              {/* Decision */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Decision</Label>
                  <Select value={approvalStatus} onValueChange={(v: "approved" | "rejected") => setApprovalStatus(v)}>
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
                    {selected.estimatedCost && (
                      <span className="text-muted-foreground font-normal ml-1">(est. {formatCost(selected.estimatedCost)})</span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    className="h-9 text-sm"
                    placeholder={selected.estimatedCost ?? "0"}
                    value={approvedAmount}
                    onChange={e => setApprovedAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Comments {approvalStatus === "rejected" && <span className="text-red-500">*</span>}
                </Label>
                <Textarea
                  placeholder={approvalStatus === "approved" ? "Optional notes…" : "Reason for rejection…"}
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={approvalMutation.isPending || (approvalStatus === "rejected" && !comments.trim())}
              className={approvalStatus === "approved"
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
              }
              onClick={handleSubmit}
            >
              {approvalMutation.isPending
                ? "Processing…"
                : approvalStatus === "approved" ? "Approve Request" : "Reject Request"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}