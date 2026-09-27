import { useState } from "react";
import {
  DollarSign, CheckCircle, Clock, AlertTriangle,
  Download, Plus, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useRentCollection } from "@/hooks/modules/useRentCollection";
import { RentPaymentCard } from "@/components/rent/RentPaymentCard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell, PageHeader, FilterBar, SPBadge, EmptyState, PrimaryButton, StatTile, StatsGrid, SectionCard, SPTable, KESAmount } from "@/components/ui/sp-ui";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const PAYMENT_METHODS = ["cash", "bank_transfer", "mpesa", "cheque", "card", "ussd"];

export default function RentCollection() {
  const guard = useRoleGuard(ROLES.STAFF_AND_ABOVE);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [page,          setPage]          = useState(1);
  const [pageSize,      setPageSize]      = useState(20);
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [isExporting,   setIsExporting]   = useState(false);

  // Record Payment form state
  const [form, setForm] = useState({
    tenantId:      "",
    amount:        "",
    currency:      "KES",
    dueDate:       new Date().toISOString().split("T")[0],
    paidDate:      "",
    paymentMethod: "cash",
    status:        "pending" as "pending" | "paid" | "overdue" | "partial",
    notes:         "",
  });

  const handleSearch   = (v: string) => { setSearch(v);       setPage(1); };
  const handleStatus   = (v: string) => { setStatusFilter(v); setPage(1); };
  const handlePageSize = (v: string) => { setPageSize(Number(v)); setPage(1); };

  const {
    payments,
    totalCount,
    totalPages,
    isLoading,
    stats: liveStats,
    markPaidMutation,
    sendReminderMutation,
  } = useRentCollection({ page, pageSize, status: statusFilter, search });

  // Fetch tenants for the dropdown
  const { data: tenants = [] } = useQuery<any[]>({
    queryKey: ["/api/tenants"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenants");
      return ensureArray(await r.json());
    },
    staleTime: 60_000,
  });

  // Create payment mutation
  const createPaymentMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("/api/rent-payments", {
        method: "POST",
        data: {
          tenantId:      Number(data.tenantId),
          amount:        data.amount,
          currency:      data.currency,
          dueDate:       data.dueDate,
          paidDate:      data.paidDate || undefined,
          paymentMethod: data.paymentMethod || undefined,
          status:        data.status,
          notes:         data.notes || undefined,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded ✓" });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
      setShowAddModal(false);
      setForm({
        tenantId: "", amount: "", currency: "KES",
        dueDate: new Date().toISOString().split("T")[0],
        paidDate: "", paymentMethod: "cash", status: "pending", notes: "",
      });
    },
    onError: () => {
      toast({ title: "Failed to record payment", variant: "destructive" });
    },
  });

  // Export handler — triggers CSV download directly from the server
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);

      const res = await apiRequest(`/api/rent-payments/export?${params.toString()}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `rent-payments-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded ✓" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const fmt = (n: number) => `KES ${Math.abs(n).toLocaleString("en-KE")}`;

  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem   = Math.min(page * pageSize, totalCount);

  if (isLoading && page === 1) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Rent Collection"
        subtitle="Track and manage tenant payments"
        icon={<DollarSign className="w-5 h-5" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "Exporting…" : "Export"}
            </Button>
            <PrimaryButton icon={<Plus className="h-4 w-4" />} onClick={() => setShowAddModal(true)}>
              Record Payment
            </PrimaryButton>
          </>
        }
      />

      <StatsGrid cols={4}>
        <StatTile label="Collected" value={fmt(Number(liveStats?.collected ?? 0))} sub={`${liveStats?.collectedCount ?? 0} payments`} icon={<CheckCircle className="w-4 h-4" />} accent="emerald" />
        <StatTile label="Pending" value={fmt(Number(liveStats?.pending ?? 0))} sub={`${liveStats?.pendingCount ?? 0} tenants`} icon={<Clock className="w-4 h-4" />} accent="amber" />
        <StatTile label="Overdue" value={fmt(Number(liveStats?.overdue ?? 0))} sub={`${liveStats?.overdueCount ?? 0} tenants`} icon={<AlertTriangle className="w-4 h-4" />} accent="red" />
        <StatTile label="Rate" value={`${liveStats?.collectionRate ?? 0}%`} sub="Collection rate" icon={<DollarSign className="w-4 h-4" />} accent="blue" />
      </StatsGrid>

      <div className="space-y-4">
        <FilterBar
          search={search}
          onSearch={handleSearch}
          placeholder="Search tenants..."
          filters={
            <Select value={statusFilter} onValueChange={handleStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          }
          actions={
            <Select value={String(pageSize)} onValueChange={handlePageSize}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        {/* Payment list */}
        <SectionCard padding="none">
          <div className="divide-y divide-border">
            {payments.map((payment: any) => (
              <RentPaymentCard
                key={payment.id}
                payment={payment}
                onMarkPaid={(id, onDone) => markPaidMutation.mutate({ id, onDone })}
                onReminder={(id, onDone) => sendReminderMutation.mutate({ id, onDone })}
                isMarkingPaid={markPaidMutation.isPending}
                isSendingReminder={sendReminderMutation.isPending}
              />
            ))}
            {payments.length === 0 && !isLoading && (
              <EmptyState icon={<DollarSign />} title="No payments found" description="No payments match your current criteria." size="lg" />
            )}
            {isLoading && (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            )}
          </div>
        </SectionCard>

          {/* Pagination footer */}
          {totalCount > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <p className="text-sm text-muted-foreground">
                Showing {startItem}–{endItem} of {totalCount.toLocaleString()} payments
              </p>

              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1} className="hidden sm:flex px-2">«</Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
                    ) : (
                      <Button
                        key={item}
                        variant={item === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(item as number)}
                        className="w-8 h-8 p-0"
                      >
                        {item}
                      </Button>
                    )
                  )}

                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="hidden sm:flex px-2">»</Button>
              </div>
            </div>
          )}
        </div>

      {/* ── Record Payment Modal ── */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Tenant */}
            <div className="space-y-1">
              <Label>Tenant *</Label>
              <Select value={form.tenantId} onValueChange={v => setForm(f => ({ ...f, tenantId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant…" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.firstName} {t.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["KES", "USD", "GBP", "EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Due Date + Paid Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Due Date *</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Paid Date</Label>
                <Input type="date" value={form.paidDate} onChange={e => setForm(f => ({ ...f, paidDate: e.target.value }))} />
              </div>
            </div>

            {/* Status + Method */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => (
                      <SelectItem key={m} value={m} className="capitalize">{m.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input
                placeholder="Optional notes…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createPaymentMutation.mutate(form)}
              disabled={!form.tenantId || !form.amount || !form.dueDate || createPaymentMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {createPaymentMutation.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}