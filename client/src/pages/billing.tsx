import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Droplets, DollarSign, Clock, Repeat,
  AlertCircle, CheckCircle, Loader2, PlayCircle, Settings, Send,
  ToggleLeft, ToggleRight, Edit2, XCircle, Trash2,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import StatusBadge from "@/components/ui/status-badge";
import { format } from "date-fns";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


// ─── Types ────────────────────────────────────────────────────────────────────

interface UtilityProvider { id: number; name: string; type: string; contactEmail?: string; contactPhone?: string; billingCycle: string; averageRate?: string; currency: string; isActive: boolean; }
interface UtilityAccount  { id: number; propertyId: number; providerId: number; providerName?: string; accountNumber: string; meterNumber?: string; isActive: boolean; }
interface UtilityBill     { id: number; accountId: number; billNumber?: string; billingPeriodStart: string; billingPeriodEnd: string; dueDate: string; amount: string; currency: string; unitsConsumed?: string; status: string; paidDate?: string; paymentMethod?: string; notes?: string; }
interface RecurringCharge { id: number; propertyId: number; chargeName: string; chargeType: string; amount: number; frequency: string; nextBillDate?: string; nextChargeDate?: string; endDate?: string; isActive: boolean; description?: string; }
interface Invoice         { id: number; invoiceNumber: string; tenantId: number; propertyId: number; amount: number; currency: string; dueDate: string; status: string; description?: string; paidDate?: string; paymentMethod?: string; notes?: string; }
interface BillingCycle    { id: number; propertyId: number; cycleName?: string; name: string; type: string; frequency: string; billingDay: number; dueDay: number; graceDay?: number; isActive: boolean; status: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZES = [5, 10, 25, 50];

const fmtMoney = (v: string | number) =>
  `KSh ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yy"); } catch { return "—"; }
};

function Pager({ total, page, size, onPage }: { total: number; page: number; size: number; onPage: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between pt-3 border-t border-border mt-3 text-xs text-muted-foreground">
      <span>{total === 0 ? "No results" : `${Math.min((page-1)*size+1, total)}–${Math.min(page*size, total)} of ${total}`}</span>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page-1)} className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
        <span className="px-2 py-1">{page}/{pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page+1)} className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Billing() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;

  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // Global filters
  const [search,       setSearch]       = useState("");
  const [propFilter,   setPropFilter]   = useState<number|null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab,    setActiveTab]    = useState("overview");

  // Per-tab pagination
  const [bPage, setBPage] = useState(1); const [bSize, setBSize] = useState(10);
  const [cPage, setCPage] = useState(1); const [cSize, setCSize] = useState(10);
  const [iPage, setIPage] = useState(1); const [iSize, setISize] = useState(10);

  // Dialog visibility
  const [dlg, setDlg] = useState({ bill: false, account: false, charge: false, invoice: false, provider: false, cycle: false });
  const openDlg  = (k: keyof typeof dlg) => setDlg(d => ({ ...d, [k]: true }));
  const closeDlg = (k: keyof typeof dlg) => setDlg(d => ({ ...d, [k]: false }));

  // Edit targets
  const [editBill,   setEditBill]   = useState<UtilityBill|null>(null);
  const [editCharge, setEditCharge] = useState<RecurringCharge|null>(null);
  const [editInv,    setEditInv]    = useState<Invoice|null>(null);
  const [editCycle,  setEditCycle]  = useState<BillingCycle|null>(null);

  // Delete targets
  const [delBill,     setDelBill]     = useState<number|null>(null);
  const [delCharge,   setDelCharge]   = useState<number|null>(null);
  const [delInv,      setDelInv]      = useState<number|null>(null);
  const [delCycle,    setDelCycle]    = useState<number|null>(null);
  const [delProvider, setDelProvider] = useState<number|null>(null);

  // New-item forms
  const blankBill    = { accountId: "", billingPeriodStart: "", billingPeriodEnd: "", dueDate: "", amount: "", unitsConsumed: "", status: "pending", notes: "" };
  const blankAccount = { propertyId: "", providerId: "", accountNumber: "", meterNumber: "" };
  const blankCharge  = { propertyId: "", chargeName: "", chargeType: "service_charge", amount: "", frequency: "monthly", startDate: "", nextChargeDate: "", description: "" };
  const blankInvoice = { propertyId: "", tenantId: "", amount: "", dueDate: "", description: "", type: "rent" };
  const blankProvider= { name: "", type: "electricity", billingCycle: "monthly", contactEmail: "", contactPhone: "", averageRate: "" };
  const blankCycle   = { propertyId: "", cycleName: "", type: "rent", frequency: "monthly", billingDay: "1", dueDay: "5", graceDay: "5" };

  const [billForm,     setBillForm]     = useState(blankBill);
  const [accountForm,  setAccountForm]  = useState(blankAccount);
  const [chargeForm,   setChargeForm]   = useState(blankCharge);
  const [invoiceForm,  setInvoiceForm]  = useState(blankInvoice);
  const [providerForm, setProviderForm] = useState(blankProvider);
  const [cycleForm,    setCycleForm]    = useState(blankCycle);
  const [billStep,     setBillStep]     = useState<"bill"|"account">("bill");

  // ── Data queries ────────────────────────────────────────────────────────────

  const fetchArr = async (url: string) => { const r = await apiRequest(url); return ensureArray(await r.json()); };

  const { data: properties       = [] } = useQuery({ queryKey: ["/api/properties"],        queryFn: () => fetchArr("/api/properties") });
  const { data: utilityProviders = [] } = useQuery({ queryKey: ["/api/utility-providers"], queryFn: () => fetchArr("/api/utility-providers") });
  const { data: utilityAccounts  = [] } = useQuery({ queryKey: ["/api/utility-accounts"],  queryFn: () => fetchArr("/api/utility-accounts") });
  const { data: rawBills = [],  isLoading: ldBills    } = useQuery({ queryKey: ["/api/utility-bills"],      queryFn: () => fetchArr("/api/utility-bills") });
  const { data: rawCharges = [], isLoading: ldCharges } = useQuery({ queryKey: ["/api/recurring-charges"],  queryFn: () => fetchArr("/api/recurring-charges") });
  const { data: rawInvoices = [], isLoading: ldInvs   } = useQuery({ queryKey: ["/api/invoices"],           queryFn: () => fetchArr("/api/invoices") });
  const { data: rawCycles = [],  isLoading: ldCycles  } = useQuery({ queryKey: ["/api/billing-cycles"],     queryFn: () => fetchArr("/api/billing-cycles") });
  const { data: rawTenants = [] } = useQuery({ queryKey: ["/api/tenants"], queryFn: async () => { const r = await apiRequest("/api/tenants"); const d = await r.json(); return ensureArray(d?.data ?? d); } });

  const bills    = rawBills    as UtilityBill[];
  const charges  = rawCharges  as RecurringCharge[];
  const invoices = rawInvoices as Invoice[];
  const cycles   = rawCycles   as BillingCycle[];
  const tenants  = rawTenants;

  // ── Invalidation helper ──────────────────────────────────────────────────────

  const inv = (...keys: string[]) => keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const ok  = (msg: string, keys: string[]) => { toast({ title: msg }); inv(...keys); };
  const err = (msg: string) => toast({ title: "Error", description: msg, variant: "destructive" });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const generateMut = useMutation({
    mutationFn: () => apiRequest("/api/billing/generate-invoices", { method: "POST", data: {} }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: (d: any[]) => { toast({ title: "Invoices generated", description: `${d?.length ?? 0} invoice(s) created from due recurring charges.` }); inv("/api/invoices"); },
    onError: () => err("Failed to generate invoices."),
  });

  // Utility bills
  const createAccountMut = useMutation({
    mutationFn: (d: any) => apiRequest("/api/utility-accounts", { method: "POST", data: d }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: (created: any) => { ok("Account created", ["/api/utility-accounts"]); setBillForm(f => ({ ...f, accountId: String(created.id) })); setAccountForm(blankAccount); setBillStep("bill"); },
    onError: () => err("Failed to create account."),
  });
  const createBillMut = useMutation({
    mutationFn: (d: any) => apiRequest("/api/utility-bills", { method: "POST", data: d }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Bill created", ["/api/utility-bills"]); closeDlg("bill"); setBillForm(blankBill); setBillStep("bill"); },
    onError: () => err("Failed to create bill."),
  });
  const updateBillMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/utility-bills/${id}`, { method: "PUT", data }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Bill updated", ["/api/utility-bills"]); setEditBill(null); },
    onError: () => err("Failed to update bill."),
  });
  const deleteBillMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/utility-bills/${id}`, { method: "DELETE" }),
    onSuccess: () => { ok("Bill deleted", ["/api/utility-bills"]); setDelBill(null); },
    onError: () => err("Failed to delete bill."),
  });
  const markBillPaidMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/utility-bills/${id}`, { method: "PUT", data: { status: "paid", paidDate: new Date().toISOString() } }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => ok("Bill marked as paid", ["/api/utility-bills"]),
    onError: () => err("Failed to update."),
  });
  const deleteProviderMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/utility-providers/${id}`, { method: "DELETE" }),
    onSuccess: () => { ok("Provider deleted", ["/api/utility-providers"]); setDelProvider(null); },
    onError: () => err("Failed to delete provider."),
  });
  const createProviderMut = useMutation({
    mutationFn: (d: any) => apiRequest("/api/utility-providers", { method: "POST", data: d }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Provider added", ["/api/utility-providers"]); closeDlg("provider"); setProviderForm(blankProvider); },
    onError: () => err("Failed to add provider."),
  });

  // Recurring charges
  const createChargeMut = useMutation({
    mutationFn: (d: any) => apiRequest("/api/recurring-charges", { method: "POST", data: d }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Charge created", ["/api/recurring-charges"]); closeDlg("charge"); setChargeForm(blankCharge); },
    onError: () => err("Failed to create charge."),
  });
  const updateChargeMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/recurring-charges/${id}`, { method: "PUT", data }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Charge updated", ["/api/recurring-charges"]); setEditCharge(null); },
    onError: () => err("Failed to update."),
  });
  const toggleChargeMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => apiRequest(`/api/recurring-charges/${id}`, { method: "PUT", data: { isActive } }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: (_, v) => ok(v.isActive ? "Charge activated" : "Charge paused", ["/api/recurring-charges"]),
    onError: () => err("Failed to toggle."),
  });
  const deleteChargeMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/recurring-charges/${id}`, { method: "DELETE" }),
    onSuccess: () => { ok("Charge deleted", ["/api/recurring-charges"]); setDelCharge(null); },
    onError: () => err("Failed to delete."),
  });

  // Invoices
  const createInvMut = useMutation({
    mutationFn: (d: any) => {
      const amt = String(d.amount);
      return apiRequest("/api/invoices", { method: "POST", data: { ...d, invoiceNumber: `INV-${Date.now()}`, type: d.type || "rent", amount: amt, totalAmount: amt, taxAmount: "0", discountAmount: "0" } }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
    },
    onSuccess: () => { ok("Invoice created", ["/api/invoices"]); closeDlg("invoice"); setInvoiceForm(blankInvoice); },
    onError: () => err("Failed to create invoice."),
  });
  const updateInvMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/invoices/${id}`, { method: "PATCH", data }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Invoice updated", ["/api/invoices"]); setEditInv(null); },
    onError: () => err("Failed to update."),
  });
  const deleteInvMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => { ok("Invoice deleted", ["/api/invoices"]); setDelInv(null); },
    onError: () => err("Failed to delete."),
  });
  const markInvPaidMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/invoices/${id}`, { method: "PATCH", data: { status: "paid", paidDate: new Date().toISOString() } }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => ok("Invoice marked as paid", ["/api/invoices"]),
    onError: () => err("Failed to update."),
  });
  const voidInvMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/invoices/${id}`, { method: "PATCH", data: { status: "cancelled" } }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => ok("Invoice voided", ["/api/invoices"]),
    onError: () => err("Failed to void."),
  });
  const markInvOverdueMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/invoices/${id}`, { method: "PATCH", data: { status: "overdue" } }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => ok("Marked as overdue", ["/api/invoices"]),
    onError: () => err("Failed to update."),
  });

  // Billing cycles
  const createCycleMut = useMutation({
    mutationFn: (d: any) => apiRequest("/api/billing-cycles", { method: "POST", data: d }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Billing cycle created", ["/api/billing-cycles"]); closeDlg("cycle"); setCycleForm(blankCycle); },
    onError: () => err("Failed to create cycle."),
  });
  const updateCycleMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/billing-cycles/${id}`, { method: "PUT", data }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { ok("Cycle updated", ["/api/billing-cycles"]); setEditCycle(null); },
    onError: () => err("Failed to update."),
  });
  const deleteCycleMut = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/billing-cycles/${id}`, { method: "DELETE" }),
    onSuccess: () => { ok("Cycle deleted", ["/api/billing-cycles"]); setDelCycle(null); },
    onError: () => err("Failed to delete."),
  });

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filter = (items: any[], keys: string[], statusNorm?: (i: any) => string) => {
    let r = items;
    if (search) { const q = search.toLowerCase(); r = r.filter(i => keys.some(k => String(i[k] ?? "").toLowerCase().includes(q))); }
    if (propFilter) r = r.filter(i => i.propertyId === propFilter);
    if (statusFilter !== "all") {
      r = r.filter(i => {
        const s = statusNorm ? statusNorm(i) : i.status;
        return s === statusFilter;
      });
    }
    return r;
  };

  const filteredBills    = filter(bills,    ["billNumber", "notes", "status"]);
  const filteredCharges  = filter(charges,  ["chargeName", "chargeType", "frequency"], c => c.isActive ? "active" : "inactive");
  const filteredInvoices = filter(invoices, ["invoiceNumber", "description", "status"]);

  const paged = (items: any[], p: number, s: number) => items.slice((p-1)*s, p*s);

  // ── KPIs ─────────────────────────────────────────────────────────────────────

  const kpis = {
    revenue:  invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.amount || 0), 0),
    pending:  invoices.filter(i => i.status === "pending").length,
    overdue:  invoices.filter(i => i.status === "overdue" || (i.status === "pending" && i.dueDate && new Date(i.dueDate) < new Date())).length,
    charges:  charges.filter(c => c.isActive).length,
  };

  // ── Guards ───────────────────────────────────────────────────────────────────

  if (authLoading) return <div className="flex items-center justify-center h-96"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>;

  if (!user?.organizationId) return (
    <div className="flex items-center justify-center h-96">
      <div className="text-center max-w-sm">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold mb-1">No organisation</h2>
        <p className="text-sm text-muted-foreground">Your account is not linked to an organisation. Contact your administrator.</p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing &amp; Utilities</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Utility bills · recurring charges · invoices · billing cycles</p>
        </div>
        <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
          {generateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          Run billing cycle
        </Button>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Revenue (paid)",    value: fmtMoney(kpis.revenue),  icon: DollarSign, color: "green" },
          { label: "Pending invoices",  value: kpis.pending,            icon: Clock,      color: "blue"  },
          { label: "Overdue",           value: kpis.overdue,            icon: AlertCircle,color: kpis.overdue > 0 ? "red" : "gray" },
          { label: "Active charges",    value: kpis.charges,            icon: Repeat,     color: "purple"},
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="rounded-xl border border-slate-100 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-${color}-50`}>
                <Icon className={`w-4 h-4 text-${color}-600`} />
              </div>
              <div>
                <p className="text-lg font-semibold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Global filters ── */}
      <Card className="rounded-xl border border-slate-100 shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Search…" className="pl-8 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={propFilter?.toString() ?? "all"} onValueChange={v => setPropFilter(v === "all" ? null : parseInt(v))}>
              <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="All properties" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All properties</SelectItem>{(properties as any[]).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                {["all","pending","paid","overdue","active","inactive","cancelled"].map(s => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s.charAt(0).toUpperCase()+s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap w-full h-auto gap-0.5 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="utilities">Utility Bills</TabsTrigger>
          <TabsTrigger value="recurring">Recurring Charges</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        {/* ══════════════════════ OVERVIEW ══════════════════════ */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <Card className="rounded-xl border border-slate-100 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2 items-center"><Droplets className="w-4 h-4" />Recent Utility Bills</CardTitle></CardHeader>
              <CardContent>
                {bills.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No bills yet</p>
                  : bills.slice(0, 5).map(b => (
                    <div key={b.id} className="flex justify-between py-2 border-b last:border-0 border-border/50 text-sm">
                      <div><p className="font-medium">{b.billNumber || `BILL-${b.id}`}</p><p className="text-xs text-muted-foreground">Due {fmtDate(b.dueDate)}</p></div>
                      <div className="text-right"><p>{fmtMoney(b.amount)}</p><StatusBadge status={b.status} /></div>
                    </div>
                  ))}
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-slate-100 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2 items-center"><Repeat className="w-4 h-4" />Active Recurring Charges</CardTitle></CardHeader>
              <CardContent>
                {charges.filter(c => c.isActive).length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No active charges</p>
                  : charges.filter(c => c.isActive).sort((a, b) => new Date(a.nextChargeDate||a.nextBillDate||0).getTime() - new Date(b.nextChargeDate||b.nextBillDate||0).getTime()).slice(0,5).map(c => (
                    <div key={c.id} className="flex justify-between py-2 border-b last:border-0 border-border/50 text-sm">
                      <div><p className="font-medium">{c.chargeName}</p><p className="text-xs text-muted-foreground capitalize">{c.frequency}</p></div>
                      <div className="text-right"><p>{fmtMoney(c.amount)}</p><p className="text-xs text-muted-foreground">Next {fmtDate(c.nextChargeDate||c.nextBillDate)}</p></div>
                    </div>
                  ))}
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-slate-100 shadow-sm md:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Invoices</CardTitle></CardHeader>
              <CardContent>
                {invoices.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No invoices yet</p>
                  : invoices.slice(0, 5).map(i => (
                    <div key={i.id} className="flex justify-between py-2 border-b last:border-0 border-border/50 text-sm">
                      <div><p className="font-mono text-xs font-medium">{i.invoiceNumber}</p><p className="text-xs text-muted-foreground">{i.description || "Invoice"} · Due {fmtDate(i.dueDate)}</p></div>
                      <div className="text-right"><p>{fmtMoney(i.amount)}</p><StatusBadge status={i.status} /></div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ══════════════════════ UTILITY BILLS ══════════════════════ */}
        <TabsContent value="utilities" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Utility Bills</h2>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => navigate("/utility-bill-sender")}>
                <Send className="w-3.5 h-3.5" />Send bills by email
              </Button>
              <Dialog open={dlg.bill} onOpenChange={o => { if (o) openDlg("bill"); else { closeDlg("bill"); setBillStep("bill"); } }}>
                <DialogTrigger asChild><Button size="sm" className="gap-1 text-xs h-8"><Plus className="w-3.5 h-3.5" />Add bill</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{billStep === "account" ? "Create utility account" : "Add utility bill"}</DialogTitle>
                    <DialogDescription>{billStep === "account" ? "A utility account links a provider to a property." : "Log a bill against a utility account."}</DialogDescription>
                  </DialogHeader>
                  {billStep === "account" ? (
                    <div className="space-y-3 pt-2">
                      <div><Label>Property <span className="text-red-500">*</span></Label>
                        <Select value={accountForm.propertyId} onValueChange={v => setAccountForm(f => ({...f,propertyId:v}))}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{(properties as any[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select>
                      </div>
                      <div><Label>Provider <span className="text-red-500">*</span></Label>
                        {utilityProviders.length === 0
                          ? <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No providers yet — add one in the Setup tab first.</p>
                          : <Select value={accountForm.providerId} onValueChange={v => setAccountForm(f=>({...f,providerId:v}))}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{(utilityProviders as UtilityProvider[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.type})</SelectItem>)}</SelectContent></Select>}
                      </div>
                      <div><Label>Account number <span className="text-red-500">*</span></Label><Input placeholder="e.g. 123456789" value={accountForm.accountNumber} onChange={e=>setAccountForm(f=>({...f,accountNumber:e.target.value}))} /></div>
                      <div><Label>Meter number</Label><Input placeholder="e.g. MTR-001" value={accountForm.meterNumber} onChange={e=>setAccountForm(f=>({...f,meterNumber:e.target.value}))} /></div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="outline" onClick={()=>setBillStep("bill")}>Back</Button>
                        <Button disabled={createAccountMut.isPending||!accountForm.propertyId||!accountForm.providerId||!accountForm.accountNumber} onClick={()=>createAccountMut.mutate({propertyId:parseInt(accountForm.propertyId),providerId:parseInt(accountForm.providerId),accountNumber:accountForm.accountNumber,meterNumber:accountForm.meterNumber||undefined,isActive:true})}>
                          {createAccountMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Create &amp; continue
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-2">
                      <div><Label>Utility account <span className="text-red-500">*</span></Label>
                        {utilityAccounts.length === 0
                          ? <div className="space-y-2"><p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No accounts yet.</p><Button variant="outline" size="sm" className="w-full text-xs" onClick={()=>setBillStep("account")}><Plus className="w-3.5 h-3.5 mr-1"/>Create account first</Button></div>
                          : <div className="flex gap-2"><Select value={billForm.accountId} onValueChange={v=>setBillForm(f=>({...f,accountId:v}))}><SelectTrigger className="flex-1"><SelectValue placeholder="Select account" /></SelectTrigger><SelectContent>{(utilityAccounts as UtilityAccount[]).map(a=><SelectItem key={a.id} value={String(a.id)}>{a.accountNumber}{a.meterNumber?` — ${a.meterNumber}`:""}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" onClick={()=>setBillStep("account")} title="New account"><Plus className="w-4 h-4"/></Button></div>}
                      </div>
                      {utilityAccounts.length > 0 && <>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Period start <span className="text-red-500">*</span></Label><Input type="date" value={billForm.billingPeriodStart} onChange={e=>setBillForm(f=>({...f,billingPeriodStart:e.target.value}))} /></div>
                          <div><Label>Period end <span className="text-red-500">*</span></Label><Input type="date" value={billForm.billingPeriodEnd} onChange={e=>setBillForm(f=>({...f,billingPeriodEnd:e.target.value}))} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Due date <span className="text-red-500">*</span></Label><Input type="date" value={billForm.dueDate} onChange={e=>setBillForm(f=>({...f,dueDate:e.target.value}))} /></div>
                          <div><Label>Amount (KSh) <span className="text-red-500">*</span></Label><Input type="number" placeholder="0.00" value={billForm.amount} onChange={e=>setBillForm(f=>({...f,amount:e.target.value}))} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Units consumed</Label><Input type="number" value={billForm.unitsConsumed} onChange={e=>setBillForm(f=>({...f,unitsConsumed:e.target.value}))} /></div>
                          <div><Label>Status</Label><Select value={billForm.status} onValueChange={v=>setBillForm(f=>({...f,status:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem></SelectContent></Select></div>
                        </div>
                        <div><Label>Notes</Label><Input placeholder="Optional" value={billForm.notes} onChange={e=>setBillForm(f=>({...f,notes:e.target.value}))} /></div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button variant="outline" onClick={()=>closeDlg("bill")}>Cancel</Button>
                          <Button disabled={createBillMut.isPending||!billForm.accountId||!billForm.billingPeriodStart||!billForm.billingPeriodEnd||!billForm.dueDate||!billForm.amount} onClick={()=>createBillMut.mutate({...billForm,accountId:parseInt(billForm.accountId)})}>
                            {createBillMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Create bill
                          </Button>
                        </div>
                      </>}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex justify-end"><Select value={String(bSize)} onValueChange={v=>{setBSize(Number(v));setBPage(1);}}><SelectTrigger className="w-24 h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent>{PAGE_SIZES.map(n=><SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}</SelectContent></Select></div>

          <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {ldBills ? <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>
                : filteredBills.length === 0 ? <p className="text-center py-12 text-sm text-muted-foreground">No utility bills found</p>
                : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-3">Bill #</th><th className="text-left px-4 py-3">Account</th><th className="text-left px-4 py-3">Amount</th><th className="text-left px-4 py-3">Due</th><th className="text-left px-4 py-3">Units</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3 w-8"/>
                    </tr></thead>
                    <tbody className="divide-y divide-border/50">
                      {paged(filteredBills, bPage, bSize).map((b: UtilityBill) => {
                        const acct = (utilityAccounts as UtilityAccount[]).find(a => a.id === b.accountId);
                        return (
                          <tr key={b.id} className="hover:bg-muted/40 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs">{b.billNumber||`BILL-${b.id}`}</td>
                            <td className="px-4 py-2.5 text-xs max-w-[100px] truncate">{acct?.accountNumber||"—"}</td>
                            <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                              {b.billingPeriodStart ? fmtDate(b.billingPeriodStart).replace(/\d\d$/, "").trim() : "—"}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">{fmtMoney(b.amount)}</td>
                            <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(b.dueDate)}</td>
                            <td className="px-4 py-2.5"><StatusBadge status={b.status}/></td>
                            <td className="px-4 py-2.5">
                              <ActionMenu items={[
                                {label:"Edit",           icon:<Edit2 className="w-4 h-4"/>,       onClick:()=>setEditBill(b)},
                                ...(b.status==="pending"?[{label:"Mark as paid",icon:<CheckCircle className="w-4 h-4"/>,onClick:()=>markBillPaidMut.mutate(b.id)}]:[]),
                                {label:"Send by email",  icon:<Send className="w-4 h-4"/>,        onClick:()=>navigate("/utility-bill-sender")},
                                {label:"Delete",         icon:<Trash2 className="w-4 h-4"/>,      onClick:()=>setDelBill(b.id), destructive:true},
                              ]}/>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>}
              <div className="px-4 pb-3"><Pager total={filteredBills.length} page={bPage} size={bSize} onPage={setBPage}/></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════ RECURRING CHARGES ══════════════════════ */}
        <TabsContent value="recurring" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Recurring Charges</h2>
            <Dialog open={dlg.charge} onOpenChange={o=>o?openDlg("charge"):closeDlg("charge")}>
              <DialogTrigger asChild><Button size="sm" className="gap-1 text-xs h-8"><Plus className="w-3.5 h-3.5"/>Add charge</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Recurring Charge</DialogTitle><DialogDescription>Automated billing for rent, service charges, or fees.</DialogDescription></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div><Label>Property <span className="text-red-500">*</span></Label><Select value={chargeForm.propertyId} onValueChange={v=>setChargeForm(f=>({...f,propertyId:v}))}><SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger><SelectContent>{(properties as any[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Name <span className="text-red-500">*</span></Label><Input placeholder="e.g. Monthly Service Charge" value={chargeForm.chargeName} onChange={e=>setChargeForm(f=>({...f,chargeName:e.target.value}))}/></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Type</Label><Select value={chargeForm.chargeType} onValueChange={v=>setChargeForm(f=>({...f,chargeType:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="service_charge">Service charge</SelectItem><SelectItem value="utility">Utility</SelectItem><SelectItem value="maintenance">Maintenance</SelectItem><SelectItem value="insurance">Insurance</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                    <div><Label>Frequency</Label><Select value={chargeForm.frequency} onValueChange={v=>setChargeForm(f=>({...f,frequency:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>
                  </div>
                  <div><Label>Amount (KSh) <span className="text-red-500">*</span></Label><Input type="number" placeholder="0.00" value={chargeForm.amount} onChange={e=>setChargeForm(f=>({...f,amount:e.target.value}))}/></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Start date <span className="text-red-500">*</span></Label><Input type="date" value={chargeForm.startDate} onChange={e=>setChargeForm(f=>({...f,startDate:e.target.value}))}/></div>
                    <div><Label>First charge date <span className="text-red-500">*</span></Label><Input type="date" value={chargeForm.nextChargeDate} onChange={e=>setChargeForm(f=>({...f,nextChargeDate:e.target.value}))}/></div>
                  </div>
                  <div><Label>Description</Label><Input placeholder="Optional" value={chargeForm.description} onChange={e=>setChargeForm(f=>({...f,description:e.target.value}))}/></div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={()=>closeDlg("charge")}>Cancel</Button>
                    <Button disabled={createChargeMut.isPending||!chargeForm.propertyId||!chargeForm.chargeName||!chargeForm.amount||!chargeForm.startDate||!chargeForm.nextChargeDate}
                      onClick={()=>createChargeMut.mutate({propertyId:parseInt(chargeForm.propertyId),chargeName:chargeForm.chargeName,chargeType:chargeForm.chargeType,amount:parseFloat(chargeForm.amount),frequency:chargeForm.frequency,startDate:chargeForm.startDate,nextChargeDate:chargeForm.nextChargeDate,description:chargeForm.description,isActive:true})}>
                      {createChargeMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex justify-end"><Select value={String(cSize)} onValueChange={v=>{setCSize(Number(v));setCPage(1);}}><SelectTrigger className="w-24 h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent>{PAGE_SIZES.map(n=><SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}</SelectContent></Select></div>

          <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {ldCharges ? <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>
                : filteredCharges.length === 0 ? <p className="text-center py-12 text-sm text-muted-foreground">No recurring charges found</p>
                : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Amount</th><th className="text-left px-4 py-3">Freq</th><th className="text-left px-4 py-3">Next charge</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3 w-8"/>
                    </tr></thead>
                    <tbody className="divide-y divide-border/50">
                      {paged(filteredCharges, cPage, cSize).map((c: RecurringCharge) => (
                        <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-2.5 font-medium max-w-[130px] truncate">{c.chargeName}</td>
                          <td className="px-4 py-2.5 text-xs capitalize">{(c.chargeType||"").replace(/_/g," ")}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{fmtMoney(c.amount)}</td>
                          <td className="px-4 py-2.5 text-xs capitalize">{c.frequency}</td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(c.nextChargeDate||c.nextBillDate)}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={()=>toggleChargeMut.mutate({id:c.id,isActive:!c.isActive})} className="flex items-center gap-1 text-xs">
                              {c.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500"/> : <ToggleLeft className="w-4 h-4 text-muted-foreground"/>}
                              <span className={c.isActive?"text-emerald-600":"text-muted-foreground"}>{c.isActive?"Active":"Paused"}</span>
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <ActionMenu items={[
                              {label:"Edit",                  icon:<Edit2 className="w-4 h-4"/>,      onClick:()=>setEditCharge(c)},
                              {label:c.isActive?"Pause":"Activate", icon:c.isActive?<ToggleLeft className="w-4 h-4"/>:<ToggleRight className="w-4 h-4"/>, onClick:()=>toggleChargeMut.mutate({id:c.id,isActive:!c.isActive})},
                              {label:"Delete",                icon:<Trash2 className="w-4 h-4"/>,     onClick:()=>setDelCharge(c.id), destructive:true},
                            ]}/>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
              <div className="px-4 pb-3"><Pager total={filteredCharges.length} page={cPage} size={cSize} onPage={setCPage}/></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════ INVOICES ══════════════════════ */}
        <TabsContent value="invoices" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Invoices</h2>
            <Dialog open={dlg.invoice} onOpenChange={o=>o?openDlg("invoice"):closeDlg("invoice")}>
              <DialogTrigger asChild><Button size="sm" className="gap-1 text-xs h-8"><Plus className="w-3.5 h-3.5"/>Create invoice</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Invoice</DialogTitle><DialogDescription>Generate a manual invoice for a tenant.</DialogDescription></DialogHeader>
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Property <span className="text-red-500">*</span></Label><Select value={invoiceForm.propertyId} onValueChange={v=>setInvoiceForm(f=>({...f,propertyId:v}))}><SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger><SelectContent>{(properties as any[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label>Type</Label><Select value={invoiceForm.type} onValueChange={v=>setInvoiceForm(f=>({...f,type:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="rent">Rent</SelectItem><SelectItem value="utility">Utility</SelectItem><SelectItem value="service_charge">Service charge</SelectItem><SelectItem value="late_fee">Late fee</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                  </div>
                  <div><Label>Tenant <span className="text-red-500">*</span></Label><Select value={invoiceForm.tenantId} onValueChange={v=>setInvoiceForm(f=>({...f,tenantId:v}))}><SelectTrigger><SelectValue placeholder="Select tenant"/></SelectTrigger><SelectContent>{tenants.length===0?<SelectItem value="none" disabled>No tenants</SelectItem>:tenants.map((t:any)=><SelectItem key={t.id} value={String(t.id)}>{t.firstName||t.name||"Tenant"} {t.lastName??""}{t.unitNumber?` — Unit ${t.unitNumber}`:""}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Amount (KSh) <span className="text-red-500">*</span></Label><Input type="number" placeholder="0.00" value={invoiceForm.amount} onChange={e=>setInvoiceForm(f=>({...f,amount:e.target.value}))}/></div>
                    <div><Label>Due date <span className="text-red-500">*</span></Label><Input type="date" value={invoiceForm.dueDate} onChange={e=>setInvoiceForm(f=>({...f,dueDate:e.target.value}))}/></div>
                  </div>
                  <div><Label>Description</Label><Input placeholder="e.g. January 2025 rent" value={invoiceForm.description} onChange={e=>setInvoiceForm(f=>({...f,description:e.target.value}))}/></div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={()=>closeDlg("invoice")}>Cancel</Button>
                    <Button disabled={createInvMut.isPending||!invoiceForm.propertyId||!invoiceForm.tenantId||!invoiceForm.amount||!invoiceForm.dueDate}
                      onClick={()=>createInvMut.mutate({propertyId:parseInt(invoiceForm.propertyId),tenantId:parseInt(invoiceForm.tenantId),amount:parseFloat(invoiceForm.amount),dueDate:invoiceForm.dueDate,description:invoiceForm.description,type:invoiceForm.type,currency:"KES"})}>
                      {createInvMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex justify-end"><Select value={String(iSize)} onValueChange={v=>{setISize(Number(v));setIPage(1);}}><SelectTrigger className="w-24 h-8 text-xs"><SelectValue/></SelectTrigger><SelectContent>{PAGE_SIZES.map(n=><SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}</SelectContent></Select></div>

          <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {ldInvs ? <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground"/></div>
                : filteredInvoices.length === 0 ? <p className="text-center py-12 text-sm text-muted-foreground">No invoices found</p>
                : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted border-b border-border text-xs text-muted-foreground uppercase">
                      <th className="text-left px-4 py-3">Invoice #</th><th className="text-left px-4 py-3">Description</th><th className="text-left px-4 py-3">Amount</th><th className="text-left px-4 py-3">Due</th><th className="text-left px-4 py-3">Paid</th><th className="text-left px-4 py-3">Status</th><th className="px-4 py-3 w-8"/>
                    </tr></thead>
                    <tbody className="divide-y divide-border/50">
                      {paged(filteredInvoices, iPage, iSize).map((i: Invoice) => (
                        <tr key={i.id} className="hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{i.invoiceNumber}</td>
                          <td className="px-4 py-2.5 max-w-[150px] truncate text-xs">{i.description||"Invoice"}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{fmtMoney(i.amount)}</td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(i.dueDate)}</td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDate(i.paidDate)}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={i.status}/></td>
                          <td className="px-4 py-2.5">
                            <ActionMenu items={[
                              {label:"Edit",         icon:<Edit2 className="w-4 h-4"/>,       onClick:()=>setEditInv(i)},
                              ...(i.status==="pending"?[
                                {label:"Mark as paid",   icon:<CheckCircle className="w-4 h-4"/>, onClick:()=>markInvPaidMut.mutate(i.id)},
                                {label:"Mark as overdue",icon:<AlertCircle className="w-4 h-4"/>, onClick:()=>markInvOverdueMut.mutate(i.id)},
                              ]:[]),
                              ...(i.status!=="cancelled"&&i.status!=="paid"?[{label:"Void",icon:<XCircle className="w-4 h-4"/>,onClick:()=>voidInvMut.mutate(i.id)}]:[]),
                              {label:"Delete", icon:<Trash2 className="w-4 h-4"/>, onClick:()=>setDelInv(i.id), destructive:true},
                            ]}/>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
              <div className="px-4 pb-3"><Pager total={filteredInvoices.length} page={iPage} size={iSize} onPage={setIPage}/></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════ SETUP ══════════════════════ */}
        <TabsContent value="setup" className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-700 dark:text-blue-300">
            <Settings className="w-4 h-4 mt-0.5 shrink-0"/>
            <span>Billing setup — utility providers and billing cycle schedules for your properties. For account and user settings see <strong>Settings → Organisation</strong> in the sidebar.</span>
          </div>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">

            {/* Utility Providers */}
            <Card className="rounded-xl border border-slate-100 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div><CardTitle className="text-sm">Utility Providers</CardTitle><CardDescription className="text-xs">Water, electricity, gas, internet</CardDescription></div>
                  <Dialog open={dlg.provider} onOpenChange={o=>o?openDlg("provider"):closeDlg("provider")}>
                    <DialogTrigger asChild><Button size="sm" className="gap-1 text-xs h-8"><Plus className="w-3.5 h-3.5"/>Add</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add Utility Provider</DialogTitle></DialogHeader>
                      <div className="space-y-3 pt-2">
                        <div><Label>Name <span className="text-red-500">*</span></Label><Input placeholder="e.g. Kenya Power" value={providerForm.name} onChange={e=>setProviderForm(f=>({...f,name:e.target.value}))}/></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Type</Label><Select value={providerForm.type} onValueChange={v=>setProviderForm(f=>({...f,type:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="electricity">Electricity</SelectItem><SelectItem value="water">Water</SelectItem><SelectItem value="gas">Gas</SelectItem><SelectItem value="internet">Internet</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                          <div><Label>Billing cycle</Label><Select value={providerForm.billingCycle} onValueChange={v=>setProviderForm(f=>({...f,billingCycle:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>
                        </div>
                        <div><Label>Contact email</Label><Input type="email" placeholder="billing@provider.com" value={providerForm.contactEmail} onChange={e=>setProviderForm(f=>({...f,contactEmail:e.target.value}))}/></div>
                        <div><Label>Contact phone</Label><Input placeholder="+254…" value={providerForm.contactPhone} onChange={e=>setProviderForm(f=>({...f,contactPhone:e.target.value}))}/></div>
                        <div><Label>Avg rate (KSh/unit)</Label><Input type="number" placeholder="e.g. 23.50" value={providerForm.averageRate} onChange={e=>setProviderForm(f=>({...f,averageRate:e.target.value}))}/></div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button variant="outline" onClick={()=>closeDlg("provider")}>Cancel</Button>
                          <Button disabled={createProviderMut.isPending||!providerForm.name} onClick={()=>createProviderMut.mutate({...providerForm,currency:"KES",isActive:true,averageRate:providerForm.averageRate||undefined,contactEmail:providerForm.contactEmail||undefined,contactPhone:providerForm.contactPhone||undefined})}>
                            {createProviderMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Add provider
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {utilityProviders.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-6">No providers yet</p>
                  : (utilityProviders as UtilityProvider[]).map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2.5 border border-border rounded-lg text-sm mb-2">
                      <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground capitalize">{p.type} · {p.billingCycle}</p></div>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.isActive?"default":"secondary"} className="text-xs">{p.isActive?"Active":"Off"}</Badge>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={()=>setDelProvider(p.id)}><Trash2 className="w-3.5 h-3.5"/></Button>
                      </div>
                    </div>
                  ))
                }
              </CardContent>
            </Card>

            {/* Billing Cycles */}
            <Card className="rounded-xl border border-slate-100 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div><CardTitle className="text-sm">Billing Cycles</CardTitle><CardDescription className="text-xs">Recurring billing schedules per property</CardDescription></div>
                  <Dialog open={dlg.cycle} onOpenChange={o=>o?openDlg("cycle"):closeDlg("cycle")}>
                    <DialogTrigger asChild><Button size="sm" className="gap-1 text-xs h-8"><Plus className="w-3.5 h-3.5"/>Add</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add Billing Cycle</DialogTitle></DialogHeader>
                      <div className="space-y-3 pt-2">
                        <div><Label>Property <span className="text-red-500">*</span></Label><Select value={cycleForm.propertyId} onValueChange={v=>setCycleForm(f=>({...f,propertyId:v}))}><SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger><SelectContent>{(properties as any[]).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></div>
                        <div><Label>Cycle name <span className="text-red-500">*</span></Label><Input placeholder="e.g. Monthly Rent" value={cycleForm.cycleName} onChange={e=>setCycleForm(f=>({...f,cycleName:e.target.value}))}/></div>
                        <div className="grid grid-cols-2 gap-3">
                          <div><Label>Type</Label><Select value={cycleForm.type} onValueChange={v=>setCycleForm(f=>({...f,type:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="rent">Rent</SelectItem><SelectItem value="service_charge">Service charge</SelectItem><SelectItem value="utility">Utility</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                          <div><Label>Frequency</Label><Select value={cycleForm.frequency} onValueChange={v=>setCycleForm(f=>({...f,frequency:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div><Label>Bills on day</Label><Input type="number" min="1" max="31" value={cycleForm.billingDay} onChange={e=>setCycleForm(f=>({...f,billingDay:e.target.value}))}/></div>
                          <div><Label>Due on day</Label><Input type="number" min="1" max="31" value={cycleForm.dueDay} onChange={e=>setCycleForm(f=>({...f,dueDay:e.target.value}))}/></div>
                          <div><Label>Grace days</Label><Input type="number" min="0" max="30" value={cycleForm.graceDay} onChange={e=>setCycleForm(f=>({...f,graceDay:e.target.value}))}/></div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button variant="outline" onClick={()=>closeDlg("cycle")}>Cancel</Button>
                          <Button disabled={createCycleMut.isPending||!cycleForm.propertyId||!cycleForm.cycleName} onClick={()=>createCycleMut.mutate({propertyId:parseInt(cycleForm.propertyId),cycleName:cycleForm.cycleName,type:cycleForm.type,frequency:cycleForm.frequency,billingDay:cycleForm.billingDay,dueDay:cycleForm.dueDay,graceDay:cycleForm.graceDay})}>
                            {createCycleMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Add cycle
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {ldCycles
                  ? <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/></div>
                  : cycles.length === 0
                    ? <p className="text-sm text-muted-foreground text-center py-6">No billing cycles yet</p>
                    : cycles.map(c => (
                      <div key={c.id} className="flex items-center justify-between p-2.5 border border-border rounded-lg text-sm mb-2">
                        <div>
                          <p className="font-medium">{c.cycleName||c.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {c.frequency} · bills day {c.billingDay} · due day {c.dueDay}{c.graceDay ? ` · ${c.graceDay}d grace` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={c.isActive?"default":"secondary"} className="text-xs">{c.isActive?"Active":"Off"}</Badge>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={()=>setEditCycle(c)}><Edit2 className="w-3.5 h-3.5"/></Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={()=>setDelCycle(c.id)}><Trash2 className="w-3.5 h-3.5"/></Button>
                        </div>
                      </div>
                    ))
                }
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ════════════════ EDIT DIALOGS ════════════════ */}

      {/* Edit Utility Bill */}
      <Dialog open={!!editBill} onOpenChange={o=>{if(!o)setEditBill(null);}}>
        <DialogContent><DialogHeader><DialogTitle>Edit Utility Bill</DialogTitle></DialogHeader>
          {editBill && <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount (KSh)</Label><Input type="number" value={editBill.amount} disabled={editBill.status!=="pending"} onChange={e=>setEditBill(b=>b?{...b,amount:e.target.value}:b)}/></div>
              <div><Label>Units consumed</Label><Input value={editBill.unitsConsumed||""} onChange={e=>setEditBill(b=>b?{...b,unitsConsumed:e.target.value}:b)}/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Due date</Label><Input type="date" value={editBill.dueDate?.slice(0,10)||""} onChange={e=>setEditBill(b=>b?{...b,dueDate:e.target.value}:b)}/></div>
              <div><Label>Status</Label><Select value={editBill.status} onValueChange={v=>setEditBill(b=>b?{...b,status:v}:b)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></div>
            </div>
            {editBill.status==="paid" && <div><Label>Paid date</Label><Input type="date" value={editBill.paidDate?.slice(0,10)||""} onChange={e=>setEditBill(b=>b?{...b,paidDate:e.target.value}:b)}/></div>}
            <div><Label>Payment method</Label><Input placeholder="e.g. M-Pesa" value={editBill.paymentMethod||""} onChange={e=>setEditBill(b=>b?{...b,paymentMethod:e.target.value}:b)}/></div>
            <div><Label>Notes</Label><Input value={editBill.notes||""} onChange={e=>setEditBill(b=>b?{...b,notes:e.target.value}:b)}/></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={()=>setEditBill(null)}>Cancel</Button>
              <Button disabled={updateBillMut.isPending} onClick={()=>updateBillMut.mutate({id:editBill.id,data:{amount:editBill.amount,unitsConsumed:editBill.unitsConsumed,dueDate:editBill.dueDate,status:editBill.status,paidDate:editBill.paidDate,paymentMethod:editBill.paymentMethod,notes:editBill.notes}})}>
                {updateBillMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Save
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* Edit Recurring Charge */}
      <Dialog open={!!editCharge} onOpenChange={o=>{if(!o)setEditCharge(null);}}>
        <DialogContent><DialogHeader><DialogTitle>Edit Recurring Charge</DialogTitle></DialogHeader>
          {editCharge && <div className="space-y-3 pt-2">
            <div><Label>Name</Label><Input value={editCharge.chargeName} onChange={e=>setEditCharge(c=>c?{...c,chargeName:e.target.value}:c)}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount (KSh)</Label><Input type="number" value={editCharge.amount} onChange={e=>setEditCharge(c=>c?{...c,amount:parseFloat(e.target.value)}:c)}/></div>
              <div><Label>Frequency</Label><Select value={editCharge.frequency} onValueChange={v=>setEditCharge(c=>c?{...c,frequency:v}:c)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Next charge date</Label><Input type="date" value={(editCharge.nextChargeDate||editCharge.nextBillDate||"")?.slice(0,10)} onChange={e=>setEditCharge(c=>c?{...c,nextChargeDate:e.target.value}:c)}/></div>
              <div><Label>End date</Label><Input type="date" value={editCharge.endDate?.slice(0,10)||""} onChange={e=>setEditCharge(c=>c?{...c,endDate:e.target.value||undefined}:c)}/></div>
            </div>
            <div className="flex items-center gap-2"><Label>Active</Label><input type="checkbox" checked={editCharge.isActive} onChange={e=>setEditCharge(c=>c?{...c,isActive:e.target.checked}:c)} className="h-4 w-4"/></div>
            <div><Label>Description</Label><Input value={editCharge.description||""} onChange={e=>setEditCharge(c=>c?{...c,description:e.target.value}:c)}/></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={()=>setEditCharge(null)}>Cancel</Button>
              <Button disabled={updateChargeMut.isPending} onClick={()=>updateChargeMut.mutate({id:editCharge.id,data:{chargeName:editCharge.chargeName,chargeType:editCharge.chargeType,amount:editCharge.amount,frequency:editCharge.frequency,nextChargeDate:editCharge.nextChargeDate,endDate:editCharge.endDate,isActive:editCharge.isActive,description:editCharge.description}})}>
                {updateChargeMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Save
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* Edit Invoice */}
      <Dialog open={!!editInv} onOpenChange={o=>{if(!o)setEditInv(null);}}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Invoice {editInv?.invoiceNumber}</DialogTitle><DialogDescription>{editInv?.status!=="pending"?"Amount locked for non-pending invoices.":"Edit invoice details."}</DialogDescription></DialogHeader>
          {editInv && <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount (KSh)</Label><Input type="number" value={editInv.amount} disabled={editInv.status!=="pending"} onChange={e=>setEditInv(i=>i?{...i,amount:parseFloat(e.target.value)}:i)}/></div>
              <div><Label>Due date</Label><Input type="date" value={editInv.dueDate?.slice(0,10)||""} onChange={e=>setEditInv(i=>i?{...i,dueDate:e.target.value}:i)}/></div>
            </div>
            <div><Label>Status</Label><Select value={editInv.status} onValueChange={v=>setEditInv(i=>i?{...i,status:v}:i)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="overdue">Overdue</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></div>
            {editInv.status==="paid" && <div><Label>Paid date</Label><Input type="date" value={editInv.paidDate?.slice(0,10)||""} onChange={e=>setEditInv(i=>i?{...i,paidDate:e.target.value}:i)}/></div>}
            <div><Label>Payment method</Label><Input placeholder="e.g. M-Pesa" value={editInv.paymentMethod||""} onChange={e=>setEditInv(i=>i?{...i,paymentMethod:e.target.value}:i)}/></div>
            <div><Label>Description</Label><Input value={editInv.description||""} onChange={e=>setEditInv(i=>i?{...i,description:e.target.value}:i)}/></div>
            <div><Label>Notes</Label><Input value={editInv.notes||""} onChange={e=>setEditInv(i=>i?{...i,notes:e.target.value}:i)}/></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={()=>setEditInv(null)}>Cancel</Button>
              <Button disabled={updateInvMut.isPending} onClick={()=>updateInvMut.mutate({id:editInv.id,data:{amount:editInv.amount,dueDate:editInv.dueDate,status:editInv.status,paidDate:editInv.paidDate,paymentMethod:editInv.paymentMethod,description:editInv.description,notes:editInv.notes}})}>
                {updateInvMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Save
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* Edit Billing Cycle */}
      <Dialog open={!!editCycle} onOpenChange={o=>{if(!o)setEditCycle(null);}}>
        <DialogContent><DialogHeader><DialogTitle>Edit Billing Cycle</DialogTitle></DialogHeader>
          {editCycle && <div className="space-y-3 pt-2">
            <div><Label>Name</Label><Input value={editCycle.cycleName||editCycle.name} onChange={e=>setEditCycle(c=>c?{...c,cycleName:e.target.value}:c)}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label><Select value={editCycle.type} onValueChange={v=>setEditCycle(c=>c?{...c,type:v}:c)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="rent">Rent</SelectItem><SelectItem value="service_charge">Service charge</SelectItem><SelectItem value="utility">Utility</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
              <div><Label>Frequency</Label><Select value={editCycle.frequency} onValueChange={v=>setEditCycle(c=>c?{...c,frequency:v}:c)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="annually">Annually</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Bills on day</Label><Input type="number" min="1" max="31" value={editCycle.billingDay} onChange={e=>setEditCycle(c=>c?{...c,billingDay:parseInt(e.target.value)}:c)}/></div>
              <div><Label>Due on day</Label><Input type="number" min="1" max="31" value={editCycle.dueDay} onChange={e=>setEditCycle(c=>c?{...c,dueDay:parseInt(e.target.value)}:c)}/></div>
              <div><Label>Grace days</Label><Input type="number" min="0" max="30" value={editCycle.graceDay||5} onChange={e=>setEditCycle(c=>c?{...c,graceDay:parseInt(e.target.value)}:c)}/></div>
            </div>
            <div className="flex items-center gap-2"><Label>Active</Label><input type="checkbox" checked={editCycle.isActive} onChange={e=>setEditCycle(c=>c?{...c,isActive:e.target.checked}:c)} className="h-4 w-4"/></div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={()=>setEditCycle(null)}>Cancel</Button>
              <Button disabled={updateCycleMut.isPending} onClick={()=>updateCycleMut.mutate({id:editCycle.id,data:{cycleName:editCycle.cycleName||editCycle.name,type:editCycle.type,frequency:editCycle.frequency,billingDay:editCycle.billingDay,dueDay:editCycle.dueDay,graceDay:editCycle.graceDay,isActive:editCycle.isActive}})}>
                {updateCycleMut.isPending&&<Loader2 className="w-4 h-4 animate-spin mr-1"/>}Save
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {/* ════════════════ DELETE CONFIRMS ════════════════ */}
      <ConfirmDialog open={!!delBill}     title="Delete bill?"     description="This cannot be undone." confirmLabel="Delete" destructive onConfirm={()=>delBill    &&deleteBillMut.mutate(delBill)}        onClose={()=>setDelBill(null)}     loading={deleteBillMut.isPending}/>
      <ConfirmDialog open={!!delCharge}   title="Delete charge?"   description="This cannot be undone." confirmLabel="Delete" destructive onConfirm={()=>delCharge  &&deleteChargeMut.mutate(delCharge)}    onClose={()=>setDelCharge(null)}   loading={deleteChargeMut.isPending}/>
      <ConfirmDialog open={!!delInv}      title="Delete invoice?"  description="This cannot be undone." confirmLabel="Delete" destructive onConfirm={()=>delInv     &&deleteInvMut.mutate(delInv)}          onClose={()=>setDelInv(null)}      loading={deleteInvMut.isPending}/>
      <ConfirmDialog open={!!delCycle}    title="Delete cycle?"    description="This cannot be undone." confirmLabel="Delete" destructive onConfirm={()=>delCycle   &&deleteCycleMut.mutate(delCycle)}      onClose={()=>setDelCycle(null)}    loading={deleteCycleMut.isPending}/>
      <ConfirmDialog open={!!delProvider} title="Delete provider?" description="Linked accounts will lose their provider link." confirmLabel="Delete" destructive onConfirm={()=>delProvider&&deleteProviderMut.mutate(delProvider)} onClose={()=>setDelProvider(null)} loading={deleteProviderMut.isPending}/>
    </div>
  );
}