import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths, subQuarters, subYears, isWithinInterval, parseISO } from "date-fns";
import { Plus, Pencil, Receipt, DollarSign, Calendar, TrendingUp, FileText, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@shared/currency";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// ── Reusable pagination hook ─────────────────────────────────────────────────
function usePagination<T>(items: T[], defaultPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginated = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  // Reset to page 1 whenever the list length changes (e.g. after search)
  const reset = () => setPage(1);

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems: items.length,
    paginated,
    setPage,
    setPageSize: (ps: number) => { setPageSize(ps); setPage(1); },
    reset,
  };
}

// ── Pagination controls component ────────────────────────────────────────────
function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (ps: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between pt-4 flex-wrap gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Rows per page:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 10, 20, 50].map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{totalItems === 0 ? "0" : `${start}–${end} of ${totalItems}`}</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Date period presets ───────────────────────────────────────────────────────
type DatePeriod = "all" | "today" | "this_week" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year" | "custom";

interface DateRange {
  from: string; // ISO date string "YYYY-MM-DD"
  to: string;
}

function getPresetRange(period: DatePeriod): DateRange | null {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: format(startOfDay(now), "yyyy-MM-dd"), to: format(endOfDay(now), "yyyy-MM-dd") };
    case "this_week":
      return { from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    case "this_month":
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(endOfMonth(now), "yyyy-MM-dd") };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { from: format(startOfMonth(lm), "yyyy-MM-dd"), to: format(endOfMonth(lm), "yyyy-MM-dd") };
    }
    case "this_quarter":
      return { from: format(startOfQuarter(now), "yyyy-MM-dd"), to: format(endOfQuarter(now), "yyyy-MM-dd") };
    case "last_quarter": {
      const lq = subQuarters(now, 1);
      return { from: format(startOfQuarter(lq), "yyyy-MM-dd"), to: format(endOfQuarter(lq), "yyyy-MM-dd") };
    }
    case "this_year":
      return { from: format(startOfYear(now), "yyyy-MM-dd"), to: format(endOfYear(now), "yyyy-MM-dd") };
    case "last_year": {
      const ly = subYears(now, 1);
      return { from: format(startOfYear(ly), "yyyy-MM-dd"), to: format(endOfYear(ly), "yyyy-MM-dd") };
    }
    default:
      return null;
  }
}

function isDateInRange(dateStr: string, range: DateRange | null): boolean {
  if (!range) return true;
  try {
    const date = parseISO(dateStr);
    const from = parseISO(range.from);
    const to = parseISO(range.to);
    return isWithinInterval(date, { start: startOfDay(from), end: endOfDay(to) });
  } catch {
    return true;
  }
}

// ── Date filter controls component ───────────────────────────────────────────
function DateFilterControls({
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  onReset,
}: {
  period: DatePeriod;
  customRange: DateRange;
  onPeriodChange: (p: DatePeriod) => void;
  onCustomRangeChange: (r: DateRange) => void;
  onReset: () => void;
}) {
  const hasActiveFilter = period !== "all";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground font-medium">Period:</span>
      </div>
      <Select value={period} onValueChange={(v) => onPeriodChange(v as DatePeriod)}>
        <SelectTrigger className="w-40 h-9">
          <SelectValue placeholder="All Time" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Time</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="this_week">This Week</SelectItem>
          <SelectItem value="this_month">This Month</SelectItem>
          <SelectItem value="last_month">Last Month</SelectItem>
          <SelectItem value="this_quarter">This Quarter</SelectItem>
          <SelectItem value="last_quarter">Last Quarter</SelectItem>
          <SelectItem value="this_year">This Year</SelectItem>
          <SelectItem value="last_year">Last Year</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      {period === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-36 h-9 text-sm"
            value={customRange.from}
            onChange={(e) => onCustomRangeChange({ ...customRange, from: e.target.value })}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            className="w-36 h-9 text-sm"
            value={customRange.to}
            onChange={(e) => onCustomRangeChange({ ...customRange, to: e.target.value })}
          />
        </div>
      )}

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

interface PropertyExpense {
  id: number;
  expenseNumber: string;
  propertyId: number;
  contractorId?: number;
  vendorName: string;
  description: string;
  amount: string | number; // decimal column → comes back as string from DB, treat as either
  currency: string;
  category: "maintenance" | "utilities" | "supplies" | "services" | "insurance" | "taxes" | "legal" | "marketing" | "other";
  expenseDate: string;
  dueDate?: string;
  paymentDate?: string;
  status: "pending" | "approved" | "rejected" | "paid";
  approvedBy?: string;
  approvedAt?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  invoiceUrl?: string;
  isRecurring: boolean;
  recurringFrequency?: string;
  nextRecurringDate?: string;
  tags?: string[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// What we POST to the server — timestamp columns must be Date objects (Drizzle/Zod expects Date, not string)
interface CreateExpensePayload {
  expenseNumber: string;
  propertyId: number;
  contractorId?: number;
  vendorName: string;
  description: string;
  amount: string;          // decimal column → numeric string
  currency: string;
  category: PropertyExpense["category"];
  expenseDate: Date;       // timestamp column → Date object (server schema coerces from ISO string)
  dueDate?: Date;          // timestamp column → Date object
  status: PropertyExpense["status"];
  isRecurring: boolean;
  recurringFrequency?: string;
  notes?: string;
  // createdBy is injected server-side from the verified JWT
}

interface ServiceContract {
  id: number;
  contractNumber: string;
  contractorId?: number;
  propertyId?: number;
  contractType: string;
  serviceType: string;
  contractTitle: string;
  description?: string;
  scope?: string;
  startDate: string;
  endDate?: string;
  contractValue?: number;
  currency: string;
  paymentSchedule?: string;
  status: string;
  autoRenewal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const CategoryBadge = ({ category }: { category: string }) => {
  const colors: Record<string, string> = {
    maintenance: "bg-blue-100 text-blue-800",
    utilities:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
    supplies:    "bg-purple-100 text-purple-800",
    services:    "bg-orange-100 text-orange-800",
    insurance:   "bg-red-100 text-red-800",
    taxes:       "bg-muted text-foreground",
    legal:       "bg-indigo-100 text-indigo-800",
    marketing:   "bg-pink-100 text-pink-800",
    other:       "bg-yellow-100 text-yellow-800",
  };
  return (
    <Badge className={colors[category] || colors.other}>
      {category.charAt(0).toUpperCase() + category.slice(1)}
    </Badge>
  );
};


export default function ExpenseManagement() {
  // ── Expenses tab filters ───────────────────────────────────────────────────
  const [searchTerm, setSearchTerm]           = useState("");
  const [selectedProperty, setSelectedProperty] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus]     = useState<string>("all");
  const [expensesPeriod, setExpensesPeriod]     = useState<DatePeriod>("all");
  const [expensesCustomRange, setExpensesCustomRange] = useState<DateRange>({ from: "", to: "" });

  // ── Services tab filters ───────────────────────────────────────────────────
  const [servicesSearch, setServicesSearch]     = useState("");
  const [servicesStatus, setServicesStatus]     = useState("all");
  const [servicesType, setServicesType]         = useState("all");
  const [servicesProperty, setServicesProperty] = useState<number | null>(null);
  const [servicesPeriod, setServicesPeriod]     = useState<DatePeriod>("all");
  const [servicesCustomRange, setServicesCustomRange] = useState<DateRange>({ from: "", to: "" });

  // ── Payments tab filters ───────────────────────────────────────────────────
  const [paymentsSearch, setPaymentsSearch]     = useState("");
  const [paymentsCategory, setPaymentsCategory] = useState("all");
  const [paymentsProperty, setPaymentsProperty] = useState<number | null>(null);
  const [paymentsPeriod, setPaymentsPeriod]     = useState<DatePeriod>("all");
  const [paymentsCustomRange, setPaymentsCustomRange] = useState<DateRange>({ from: "", to: "" });

  const [activeTab, setActiveTab]               = useState("expenses");
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);

  // ── Edit-Expense dialog state ──────────────────────────────────────────────
  const [editingExpense, setEditingExpense]     = useState<PropertyExpense | null>(null);
  const [editPropertyId, setEditPropertyId]     = useState("");
  const [editCategory, setEditCategory]         = useState("");
  const [editRecurringFrequency, setEditRecurringFrequency] = useState("");
  const [editIsRecurring, setEditIsRecurring]   = useState(false);

  const openEditDialog = (expense: PropertyExpense) => {
    setEditingExpense(expense);
    setEditPropertyId(expense.propertyId.toString());
    setEditCategory(expense.category);
    setEditRecurringFrequency(expense.recurringFrequency || "");
    setEditIsRecurring(expense.isRecurring);
  };

  const closeEditDialog = () => {
    setEditingExpense(null);
    setEditPropertyId("");
    setEditCategory("");
    setEditRecurringFrequency("");
    setEditIsRecurring(false);
  };

  // ── Add-Expense form controlled fields (Radix Select doesn't write to FormData) ──
  const [formPropertyId, setFormPropertyId]             = useState("");
  const [formCategory, setFormCategory]                 = useState("");
  const [formRecurringFrequency, setFormRecurringFrequency] = useState("");
  const [formIsRecurring, setFormIsRecurring]           = useState(false);

  /** Reset all form-controlled fields when the dialog closes/opens */
  const resetForm = () => {
    setFormPropertyId("");
    setFormCategory("");
    setFormRecurringFrequency("");
    setFormIsRecurring(false);
  };

  const { user } = useAuth();
  const isManager  = user?.role === "admin" || user?.role === "manager";
  const isLandlord = user?.role === "landlord";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: propertiesRaw = [], isLoading: loadingProperties } = useQuery({
    queryKey: ["/api/properties", "expense-mgmt", user?.role],
    queryFn: async () => {
      try {
        // Landlords are blocked from /api/properties (STAFF_AND_ABOVE).
        // Use their portal endpoint which returns their own properties.
        const url = isLandlord
          ? "/api/landlord-portal/properties/stats"
          : "/api/properties";
        const r = await apiRequest(url);
        if (!r.ok) return [];
        return ensureArray(await r.json());
      } catch (e) { console.error(e); return []; }
    },
    enabled: !!user,
  });

  const { data: expensesRaw = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ["/api/property-expenses"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/property-expenses"); const d = await r.json(); return ensureArray(d); }
      catch (e) { console.error(e); return []; }
    },
  });

  // FIX 1: Services tab — pivot from /api/contractor-services (unmounted) to
  // /api/service-contracts (mounted via serviceContractsRouter).
  const { data: serviceContractsRaw = [], isLoading: loadingServices } = useQuery({
    queryKey: ["/api/service-contracts"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/service-contracts"); const d = await r.json(); return ensureArray(d); }
      catch (e) { console.error(e); return []; }
    },
  });

  const properties      = ensureArray(propertiesRaw);
  const expenses        = ensureArray(expensesRaw);
  const serviceContracts = ensureArray(serviceContractsRaw);

  // ── Derived / filtered lists ───────────────────────────────────────────────

  // Expenses tab
  const expensesDateRange = expensesPeriod === "custom" ? expensesCustomRange : getPresetRange(expensesPeriod);
  const filteredExpenses = useMemo(() => expenses.filter((expense: PropertyExpense) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch   = !q || expense.description?.toLowerCase().includes(q) || expense.vendorName?.toLowerCase().includes(q);
    const matchesProperty = !selectedProperty || expense.propertyId === selectedProperty;
    const matchesCategory = selectedCategory === "all" || expense.category === selectedCategory;
    const matchesStatus   = selectedStatus   === "all" || expense.status   === selectedStatus;
    const matchesDate     = isDateInRange(expense.expenseDate, expensesDateRange);
    return matchesSearch && matchesProperty && matchesCategory && matchesStatus && matchesDate;
  }), [expenses, searchTerm, selectedProperty, selectedCategory, selectedStatus, expensesDateRange]);

  // Services tab — unique contractTypes for the type filter
  const serviceContractTypes = useMemo(
    () => [...new Set(serviceContracts.map((c: ServiceContract) => c.contractType))],
    [serviceContracts]
  );
  const servicesDateRange = servicesPeriod === "custom" ? servicesCustomRange : getPresetRange(servicesPeriod);
  const filteredServices = useMemo(() => serviceContracts.filter((c: ServiceContract) => {
    const q = servicesSearch.toLowerCase();
    const matchesSearch = !q ||
      c.contractTitle?.toLowerCase().includes(q) ||
      c.serviceType?.toLowerCase().includes(q) ||
      c.contractNumber?.toLowerCase().includes(q);
    const matchesStatus   = servicesStatus === "all" || c.status === servicesStatus;
    const matchesType     = servicesType   === "all" || c.contractType === servicesType;
    const matchesProperty = servicesProperty === null || c.propertyId === servicesProperty;
    const matchesDate     = isDateInRange(c.startDate, servicesDateRange);
    return matchesSearch && matchesStatus && matchesType && matchesProperty && matchesDate;
  }), [serviceContracts, servicesSearch, servicesStatus, servicesType, servicesProperty, servicesDateRange]);

  // Payments tab — paid expenses only, then filtered further
  const allPaid = useMemo(
    () => expenses.filter((e: PropertyExpense) => e.status === "paid"),
    [expenses]
  );
  const paymentsDateRange = paymentsPeriod === "custom" ? paymentsCustomRange : getPresetRange(paymentsPeriod);
  const filteredPayments = useMemo(() => allPaid.filter((e: PropertyExpense) => {
    const q = paymentsSearch.toLowerCase();
    const matchesSearch   = !q || e.vendorName?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q);
    const matchesCategory = paymentsCategory === "all" || e.category === paymentsCategory;
    const matchesProperty = !paymentsProperty || e.propertyId === paymentsProperty;
    const matchesDate     = isDateInRange(e.paymentDate || e.expenseDate, paymentsDateRange);
    return matchesSearch && matchesCategory && matchesProperty && matchesDate;
  }), [allPaid, paymentsSearch, paymentsCategory, paymentsProperty, paymentsDateRange]);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const expensesPag  = usePagination(filteredExpenses, 10);
  const servicesPag  = usePagination(filteredServices, 10);
  const paymentsPag  = usePagination(filteredPayments, 10);

  // ── Metrics — derived from filteredExpenses so cards reflect active filters ─
  const totalExpenses   = filteredExpenses.reduce((s: number, e: PropertyExpense) => s + (Number(e.amount) || 0), 0);
  const pendingExpenses = filteredExpenses.filter((e: PropertyExpense) => e.status === "pending").length;
  const paidThisMonth   = filteredExpenses.filter((e: PropertyExpense) =>
    e.status === "paid" && e.paymentDate &&
    new Date(e.paymentDate).getMonth() === new Date().getMonth()
  ).length;
  const overdueExpenses = filteredExpenses.filter((e: PropertyExpense) =>
    e.status !== "paid" && e.status !== "rejected" && e.dueDate && new Date(e.dueDate) < new Date()
  ).length;
  const hasExpensesFilter = !!(searchTerm || selectedProperty || selectedCategory !== "all" || selectedStatus !== "all" || expensesPeriod !== "all");

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createExpenseMutation = useMutation({
    mutationFn: (data: CreateExpensePayload) =>
      apiRequest("/api/property-expenses", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-expenses"] });
      setIsAddExpenseOpen(false);
      resetForm();
      toast({ title: "Success", description: "Expense created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to create expense", variant: "destructive" });
    },
  });

  // FIX 3: Status update — use PUT /:id (CRUD router) not PATCH /:id/status (unmounted).
  const updateExpenseStatusMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      const body: Record<string, any> = { status };
      if (notes) body.notes = notes;
      // Schema: timestamp columns → Date objects (server coerces from ISO string)
      if (status === "paid")     body.paymentDate = new Date();
      if (status === "approved") body.approvedAt  = new Date();
      // approvedBy is stamped server-side from the verified JWT — do not send from client
      return apiRequest(`/api/property-expenses/${id}`, { method: "PUT", data: body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-expenses"] });
      toast({ title: "Success", description: "Expense status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update expense status", variant: "destructive" });
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, any> }) =>
      apiRequest(`/api/property-expenses/${id}`, { method: "PUT", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-expenses"] });
      closeEditDialog();
      toast({ title: "Success", description: "Expense updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update expense", variant: "destructive" });
    },
  });

  const handleSubmitEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingExpense) return;
    const formData = new FormData(e.currentTarget);

    if (!editPropertyId) {
      toast({ title: "Error", description: "Please select a property.", variant: "destructive" });
      return;
    }
    if (!editCategory) {
      toast({ title: "Error", description: "Please select a category.", variant: "destructive" });
      return;
    }

    updateExpenseMutation.mutate({
      id: editingExpense.id,
      data: {
        propertyId:         parseInt(editPropertyId),
        vendorName:         formData.get("vendorName") as string,
        description:        formData.get("description") as string,
        amount:             formData.get("amount") as string,
        category:           editCategory as PropertyExpense["category"],
        expenseDate:        new Date(formData.get("expenseDate") as string),
        dueDate:            formData.get("dueDate") ? new Date(formData.get("dueDate") as string) : null,
        isRecurring:        editIsRecurring,
        recurringFrequency: editIsRecurring ? (editRecurringFrequency || null) : null,
        notes:              (formData.get("notes") as string) || null,
      },
    });
  };

  const handleSubmitExpense = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Native FormData captures <input> and <textarea> fields.
    // Radix <Select> does NOT write to FormData, so we use controlled state for those.
    const formData = new FormData(e.currentTarget);

    if (!formPropertyId) {
      toast({ title: "Error", description: "Please select a property.", variant: "destructive" });
      return;
    }
    if (!formCategory) {
      toast({ title: "Error", description: "Please select a category.", variant: "destructive" });
      return;
    }

    createExpenseMutation.mutate({
      expenseNumber:      `EXP-${Date.now()}`,
      propertyId:         parseInt(formPropertyId),
      vendorName:         formData.get("vendorName") as string,
      description:        formData.get("description") as string,
      amount:             formData.get("amount") as string,
      currency:           "KES",
      category:           formCategory as PropertyExpense["category"],
      expenseDate:        new Date(formData.get("expenseDate") as string),
      dueDate:            formData.get("dueDate") ? new Date(formData.get("dueDate") as string) : undefined,
      status:             "pending",
      isRecurring:        formIsRecurring,
      recurringFrequency: formIsRecurring ? (formRecurringFrequency || undefined) : undefined,
      notes:              (formData.get("notes") as string) || undefined,
      // createdBy is injected server-side from the verified JWT — do not send from client
    });
  };

  if (loadingProperties) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading expense management...</p>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Expense Management & Contractors"
        subtitle="Track property expenses, manage contractor services, and process payments"
        icon={<Receipt className="w-5 h-5" />}
        actions={
          <Dialog open={isAddExpenseOpen} onOpenChange={(open) => { setIsAddExpenseOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4 mr-2" />
                Add Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create New Expense</DialogTitle>
                <DialogDescription>Record a new property expense or service payment</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmitExpense} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="propertyId">Property *</Label>
                    <Select value={formPropertyId} onValueChange={setFormPropertyId} required>
                      <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                      <SelectContent>
                        {properties.length === 0
                          ? <SelectItem value="none" disabled>No properties available</SelectItem>
                          : properties.map((p: any) => (
                              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Select value={formCategory} onValueChange={setFormCategory} required>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {["maintenance","utilities","supplies","services","insurance","taxes","legal","marketing","other"].map(c => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendorName">Vendor/Supplier *</Label>
                  <Input id="vendorName" name="vendorName" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea id="description" name="description" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (KSh) *</Label>
                    <Input type="number" step="0.01" id="amount" name="amount" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expenseDate">Expense Date *</Label>
                    <Input type="date" id="expenseDate" name="expenseDate" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Due Date</Label>
                  <Input type="date" id="dueDate" name="dueDate" />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isRecurring"
                    checked={formIsRecurring}
                    onChange={(e) => { setFormIsRecurring(e.target.checked); if (!e.target.checked) setFormRecurringFrequency(""); }}
                  />
                  <Label htmlFor="isRecurring">Recurring Expense</Label>
                </div>
                {formIsRecurring && (
                <div className="space-y-2">
                  <Label htmlFor="recurringFrequency">Frequency</Label>
                  <Select value={formRecurringFrequency} onValueChange={setFormRecurringFrequency}>
                    <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" placeholder="Additional notes" />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={createExpenseMutation.isPending} className="flex-1">
                    {createExpenseMutation.isPending ? "Creating..." : "Create Expense"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsAddExpenseOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Metrics */}
      <StatsGrid cols={4}>
        <StatTile
          label="Total Expenses"
          value={formatCurrency(totalExpenses, "KES")}
          sub={hasExpensesFilter ? `${filteredExpenses.length} filtered expense${filteredExpenses.length !== 1 ? "s" : ""}` : "All time expenses"}
          icon={<DollarSign className="w-4 h-4" />}
          accent="emerald"
        />
        <StatTile
          label="Pending Approval"
          value={pendingExpenses}
          sub={hasExpensesFilter ? "In current filter" : "Awaiting approval"}
          icon={<Clock className="w-4 h-4" />}
          accent="amber"
        />
        <StatTile
          label="Paid This Month"
          value={paidThisMonth}
          sub={hasExpensesFilter ? "In current filter" : "Completed payments"}
          icon={<CheckCircle className="w-4 h-4" />}
          accent="blue"
        />
        <StatTile
          label="Overdue"
          value={overdueExpenses}
          sub={hasExpensesFilter ? "In current filter" : "Past due date"}
          icon={<XCircle className="w-4 h-4" />}
          accent="red"
        />
      </StatsGrid>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="services">Contractor Services</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        {/* ── EXPENSES TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="expenses" className="space-y-4">
          <SectionCard title="Filter Expenses">
            <div className="space-y-3">
              <FilterBar
                search={searchTerm}
                onSearch={(v) => { setSearchTerm(v); expensesPag.reset(); }}
                placeholder="Search by vendor or description..."
                filters={
                  <>
                    <Select value={selectedProperty?.toString() || "all"} onValueChange={(v) => { setSelectedProperty(v === "all" ? null : parseInt(v)); expensesPag.reset(); }}>
                      <SelectTrigger className="w-48"><SelectValue placeholder="All Properties" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Properties</SelectItem>
                        {properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); expensesPag.reset(); }}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {["maintenance","utilities","supplies","services","insurance","taxes","legal","marketing","other"].map(c => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedStatus} onValueChange={(v) => { setSelectedStatus(v); expensesPag.reset(); }}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                }
              />
              <DateFilterControls
                period={expensesPeriod}
                customRange={expensesCustomRange}
                onPeriodChange={(p) => { setExpensesPeriod(p); expensesPag.reset(); }}
                onCustomRangeChange={(r) => { setExpensesCustomRange(r); expensesPag.reset(); }}
                onReset={() => { setExpensesPeriod("all"); setExpensesCustomRange({ from: "", to: "" }); expensesPag.reset(); }}
              />
            </div>
          </SectionCard>

          <div className="grid gap-4">
            {loadingExpenses ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : expensesPag.paginated.length === 0 ? (
              <SectionCard>
                <EmptyState icon={<Receipt />} title="No expenses found" description="No expenses match your current filters." size="lg" />
              </SectionCard>
            ) : (
              expensesPag.paginated.map((expense: PropertyExpense) => (
                <Card key={expense.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-lg font-semibold">{expense.vendorName}</h3>
                          <SPBadge status={expense.status} />
                          <CategoryBadge category={expense.category} />
                          {expense.isRecurring && (
                            <Badge variant="outline" className="text-blue-600">
                              <Calendar className="h-3 w-3 mr-1" />Recurring
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="font-medium">Description</p>
                            <p className="text-muted-foreground">{expense.description}</p>
                          </div>
                          <div>
                            <p className="font-medium">Amount</p>
                            <p className="text-muted-foreground font-semibold">
                              {formatCurrency(Number(expense.amount), expense.currency as any)}
                            </p>
                          </div>
                          <div>
                            <p className="font-medium">Expense Date</p>
                            <p className="text-muted-foreground">
                              {format(new Date(expense.expenseDate), "MMM dd, yyyy")}
                            </p>
                          </div>
                          <div>
                            <p className="font-medium">Due Date</p>
                            <p className="text-muted-foreground">
                              {expense.dueDate ? format(new Date(expense.dueDate), "MMM dd, yyyy") : "Not set"}
                            </p>
                          </div>
                        </div>
                        {expense.notes && (
                          <div className="text-sm">
                            <p className="font-medium">Notes</p>
                            <p className="text-muted-foreground">{expense.notes}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4 flex-wrap justify-end">
                        {expense.status === "pending" && (
                          <>
                            {/* Edit: any role can edit their own pending expense (server scopes to owned properties) */}
                            <Button size="sm" variant="outline" onClick={() => openEditDialog(expense)}>
                              <Pencil className="h-4 w-4 mr-1" />Edit
                            </Button>
                            {/* Approve / Reject: property manager only — landlord cannot approve their own submissions */}
                            {isManager && (
                              <>
                                <Button size="sm" onClick={() => updateExpenseStatusMutation.mutate({ id: expense.id, status: "approved" })} disabled={updateExpenseStatusMutation.isPending}>
                                  <CheckCircle className="h-4 w-4 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => updateExpenseStatusMutation.mutate({ id: expense.id, status: "rejected" })} disabled={updateExpenseStatusMutation.isPending}>
                                  <XCircle className="h-4 w-4 mr-1" />Reject
                                </Button>
                              </>
                            )}
                          </>
                        )}
                        {/* Mark Paid: manager only — landlord cannot mark their own expenses as paid */}
                        {isManager && expense.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => updateExpenseStatusMutation.mutate({ id: expense.id, status: "paid" })} disabled={updateExpenseStatusMutation.isPending}>
                            <CheckCircle className="h-4 w-4 mr-1" />Mark Paid
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {filteredExpenses.length > 0 && (
            <PaginationControls
              page={expensesPag.page}
              totalPages={expensesPag.totalPages}
              totalItems={expensesPag.totalItems}
              pageSize={expensesPag.pageSize}
              onPageChange={expensesPag.setPage}
              onPageSizeChange={expensesPag.setPageSize}
            />
          )}
        </TabsContent>

        {/* ── SERVICES TAB ─────────────────────────────────────────────────── */}
        {/* FIX 1: uses /api/service-contracts, not the unmounted /api/contractor-services */}
        <TabsContent value="services" className="space-y-4">
          <SectionCard title="Filter Service Contracts">
            <div className="space-y-3">
              <FilterBar
                search={servicesSearch}
                onSearch={(v) => { setServicesSearch(v); servicesPag.reset(); }}
                placeholder="Search by title, service type, or contract #..."
                filters={
                  <>
                    <Select value={servicesStatus} onValueChange={(v) => { setServicesStatus(v); servicesPag.reset(); }}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={servicesType} onValueChange={(v) => { setServicesType(v); servicesPag.reset(); }}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="All Types" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {serviceContractTypes.map((t: string) => (
                          <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={servicesProperty?.toString() || "all"} onValueChange={(v) => { setServicesProperty(v === "all" ? null : parseInt(v)); servicesPag.reset(); }}>
                      <SelectTrigger className="w-48"><SelectValue placeholder="All Properties" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Properties</SelectItem>
                        {properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </>
                }
              />
              <DateFilterControls
                period={servicesPeriod}
                customRange={servicesCustomRange}
                onPeriodChange={(p) => { setServicesPeriod(p); servicesPag.reset(); }}
                onCustomRangeChange={(r) => { setServicesCustomRange(r); servicesPag.reset(); }}
                onReset={() => { setServicesPeriod("all"); setServicesCustomRange({ from: "", to: "" }); servicesPag.reset(); }}
              />
            </div>
          </SectionCard>

          <SectionCard title="Contractor Service Contracts" subtitle="Active and historical service contracts with contractors">
            {loadingServices ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : servicesPag.paginated.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No Service Contracts"
                description={filteredServices.length === 0 && serviceContracts.length > 0
                  ? "No contracts match your filters."
                  : "No service contracts have been created yet."}
                size="lg"
              />
            ) : (
              <div className="grid gap-4">
                {servicesPag.paginated.map((contract: ServiceContract) => (
                  <Card key={contract.id}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <h3 className="font-semibold">{contract.contractTitle}</h3>
                            <SPBadge status={contract.status} />
                            <Badge variant="outline">{contract.contractType.replace("_", " ")}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{contract.serviceType}</p>
                          {contract.description && (
                            <p className="text-sm text-muted-foreground">{contract.description}</p>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mt-2">
                            <div>
                              <p className="font-medium">Contract #</p>
                              <p className="text-muted-foreground">{contract.contractNumber}</p>
                            </div>
                            <div>
                              <p className="font-medium">Start Date</p>
                              <p className="text-muted-foreground">
                                {format(new Date(contract.startDate), "MMM dd, yyyy")}
                              </p>
                            </div>
                            {contract.contractValue && (
                              <div>
                                <p className="font-medium">Contract Value</p>
                                <p className="text-muted-foreground font-semibold">
                                  {formatCurrency(Number(contract.contractValue), contract.currency as any)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        {contract.autoRenewal && (
                          <Badge variant="outline" className="ml-4 text-blue-600">
                            <Calendar className="h-3 w-3 mr-1" />Auto-Renew
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {filteredServices.length > 0 && (
              <PaginationControls
                page={servicesPag.page}
                totalPages={servicesPag.totalPages}
                totalItems={servicesPag.totalItems}
                pageSize={servicesPag.pageSize}
                onPageChange={servicesPag.setPage}
                onPageSizeChange={servicesPag.setPageSize}
              />
            )}
          </SectionCard>
        </TabsContent>

        {/* ── PAYMENTS TAB ─────────────────────────────────────────────────── */}
        {/* FIX 2: derived from property-expenses filtered to status=paid — no dead /api/contractor-payments call */}
        <TabsContent value="payments" className="space-y-4">
          <SectionCard title="Filter Paid Expenses">
            <div className="space-y-3">
              <FilterBar
                search={paymentsSearch}
                onSearch={(v) => { setPaymentsSearch(v); paymentsPag.reset(); }}
                placeholder="Search by vendor or description..."
                filters={
                  <>
                    <Select value={paymentsProperty?.toString() || "all"} onValueChange={(v) => { setPaymentsProperty(v === "all" ? null : parseInt(v)); paymentsPag.reset(); }}>
                      <SelectTrigger className="w-48"><SelectValue placeholder="All Properties" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Properties</SelectItem>
                        {properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={paymentsCategory} onValueChange={(v) => { setPaymentsCategory(v); paymentsPag.reset(); }}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {["maintenance","utilities","supplies","services","insurance","taxes","legal","marketing","other"].map(c => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                }
              />
              <DateFilterControls
                period={paymentsPeriod}
                customRange={paymentsCustomRange}
                onPeriodChange={(p) => { setPaymentsPeriod(p); paymentsPag.reset(); }}
                onCustomRangeChange={(r) => { setPaymentsCustomRange(r); paymentsPag.reset(); }}
                onReset={() => { setPaymentsPeriod("all"); setPaymentsCustomRange({ from: "", to: "" }); paymentsPag.reset(); }}
              />
            </div>
          </SectionCard>

          <SectionCard title="Paid Expenses" subtitle="Property expenses that have been marked as paid">
            {loadingExpenses ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : paymentsPag.paginated.length === 0 ? (
              <EmptyState
                icon={<TrendingUp />}
                title="No Paid Expenses"
                description={filteredPayments.length === 0 && allPaid.length > 0
                  ? "No paid expenses match your filters."
                  : "No expenses have been marked as paid yet."}
                size="lg"
              />
            ) : (
              <div className="grid gap-4">
                {paymentsPag.paginated.map((expense: PropertyExpense) => (
                  <Card key={expense.id}>
                    <CardContent className="p-5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-semibold">{expense.vendorName}</h3>
                          <SPBadge status={expense.status} />
                          <CategoryBadge category={expense.category} />
                        </div>
                        <p className="text-sm text-muted-foreground">{expense.description}</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mt-2">
                          <div>
                            <p className="font-medium">Amount Paid</p>
                            <p className="text-muted-foreground font-semibold">
                              {formatCurrency(Number(expense.amount), expense.currency as any)}
                            </p>
                          </div>
                          <div>
                            <p className="font-medium">Expense Date</p>
                            <p className="text-muted-foreground">
                              {format(new Date(expense.expenseDate), "MMM dd, yyyy")}
                            </p>
                          </div>
                          {expense.paymentDate && (
                            <div>
                              <p className="font-medium">Payment Date</p>
                              <p className="text-muted-foreground">
                                {format(new Date(expense.paymentDate), "MMM dd, yyyy")}
                              </p>
                            </div>
                          )}
                        </div>
                        {expense.paymentMethod && (
                          <p className="text-sm text-muted-foreground">
                            Method: <span className="font-medium capitalize">{expense.paymentMethod}</span>
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {filteredPayments.length > 0 && (
              <PaginationControls
                page={paymentsPag.page}
                totalPages={paymentsPag.totalPages}
                totalItems={paymentsPag.totalItems}
                pageSize={paymentsPag.pageSize}
                onPageChange={paymentsPag.setPage}
                onPageSizeChange={paymentsPag.setPageSize}
              />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ── EDIT EXPENSE DIALOG ──────────────────────────────────────────────── */}
      <Dialog open={!!editingExpense} onOpenChange={(open) => { if (!open) closeEditDialog(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
            <DialogDescription>Update the details of this pending expense</DialogDescription>
          </DialogHeader>
          {editingExpense && (
            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Property *</Label>
                  <Select value={editPropertyId} onValueChange={setEditPropertyId} required>
                    <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                    <SelectContent>
                      {properties.map((p: any) => (
                        <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={editCategory} onValueChange={setEditCategory} required>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {["maintenance","utilities","supplies","services","insurance","taxes","legal","marketing","other"].map(c => (
                        <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vendorName">Vendor/Supplier *</Label>
                <Input id="edit-vendorName" name="vendorName" defaultValue={editingExpense.vendorName} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description *</Label>
                <Textarea id="edit-description" name="description" defaultValue={editingExpense.description} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-amount">Amount (KSh) *</Label>
                  <Input type="number" step="0.01" id="edit-amount" name="amount" defaultValue={String(editingExpense.amount)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-expenseDate">Expense Date *</Label>
                  <Input type="date" id="edit-expenseDate" name="expenseDate" defaultValue={format(new Date(editingExpense.expenseDate), "yyyy-MM-dd")} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-dueDate">Due Date</Label>
                <Input type="date" id="edit-dueDate" name="dueDate" defaultValue={editingExpense.dueDate ? format(new Date(editingExpense.dueDate), "yyyy-MM-dd") : ""} />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="edit-isRecurring"
                  checked={editIsRecurring}
                  onChange={(e) => { setEditIsRecurring(e.target.checked); if (!e.target.checked) setEditRecurringFrequency(""); }}
                />
                <Label htmlFor="edit-isRecurring">Recurring Expense</Label>
              </div>
              {editIsRecurring && (
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select value={editRecurringFrequency} onValueChange={setEditRecurringFrequency}>
                    <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea id="edit-notes" name="notes" defaultValue={editingExpense.notes || ""} placeholder="Additional notes" />
              </div>
              <div className="flex gap-2 pt-4">
                <Button type="submit" disabled={updateExpenseMutation.isPending} className="flex-1">
                  {updateExpenseMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="outline" onClick={closeEditDialog}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}