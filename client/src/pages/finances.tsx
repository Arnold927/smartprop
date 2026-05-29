import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
 TrendingUp, TrendingDown, Smartphone, CreditCard,
 Receipt, Search, Download,
 Wallet, BarChart3, ArrowUpRight, ArrowDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) => `KES ${Math.abs(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const fmtShort = (n: number) => n >= 1_000_000 ? `KES ${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `KES ${(n/1_000).toFixed(0)}K` : `KES ${n}`;

function StatusBadge({ s }: { s: string }) {
 const m: Record<string,string> = { paid: "bg-emerald-50 text-emerald-700 border border-emerald-200", completed: "bg-emerald-50 text-emerald-700 border border-emerald-200", pending: "bg-amber-100 text-amber-700", overdue: "bg-red-100 text-red-600", failed: "bg-red-100 text-red-600" };
 return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${m[s] ?? "bg-muted dark:bg-gray-800 text-muted-foreground dark:text-muted-foreground"}`}>{s}</span>;
}

function MethodBadge({ m }: { m: string }) {
 if (!m) return <span className="text-xs text-muted-foreground">—</span>;
 const labels: Record<string,string> = { mpesa: "M-PESA", eft: "EFT", cash: "Cash", card: "Card", bank: "Bank", bank_transfer: "Bank", manual_bank: "Bank" };
 const colors: Record<string,string> = { mpesa: "bg-orange-100 text-orange-700", eft: "bg-blue-100 text-blue-700", cash: "bg-muted dark:bg-gray-800 text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground", card: "bg-purple-100 text-purple-700" };
 const key = m.toLowerCase();
 return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[key] ?? "bg-muted dark:bg-gray-800 text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground"}`}>{labels[key] ?? m}</span>;
}

export default function Finances() {
  const guard = useRoleGuard(ROLES.STAFF_AND_ABOVE);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

 const { toast } = useToast();
 const [search, setSearch] = useState("");
 const [methodFilter, setMethodFilter] = useState("all");
 const [dateFilter, setDateFilter] = useState("month");
 const [tab, setTab] = useState("overview");

 // ─── queries ──────────────────────────────────────────────────────────────
 const { data: paysRaw = [], isLoading } = useQuery<any>({
 queryKey: ["/api/rent-payments"],
 queryFn: async () => { const r = await apiRequest("/api/rent-payments"); return ensureArray(await r.json()); },
 staleTime: 2 * 60 * 1000,
 });
 const payments: any[] = Array.isArray(paysRaw) ? paysRaw : ([]);

 const { data: mpesaRaw } = useQuery<any>({
 queryKey: ["/api/mpesa-transactions"],
 queryFn: async () => { const r = await apiRequest("/api/mpesa-transactions"); return ensureArray(await r.json()); },
 staleTime: 2 * 60 * 1000,
 });
 const mpesa: any[] = Array.isArray(mpesaRaw) ? mpesaRaw : ([]);


 const { data: expensesRaw } = useQuery<any>({
 queryKey: ["/api/property-expenses"],
 queryFn: async () => { const r = await apiRequest("/api/property-expenses"); return ensureArray(await r.json()); },
 staleTime: 5 * 60 * 1000,
 });
 const expenses: any[] = Array.isArray(expensesRaw) ? expensesRaw : ([]);

 // Fetch stats scoped to current month for accurate KPIs
 const { data: serverStats } = useQuery<any>({
 queryKey: ["/api/rent-payments/stats", dateFilter],
 queryFn: async () => {
   const now = new Date();
   const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
   const url = dateFilter === "all"
     ? "/api/rent-payments/stats?all=1"
     : `/api/rent-payments/stats?month=${month}`;
   const r = await apiRequest(url);
   return r.json();
 },
 staleTime: 30_000,
 });

 // ─── derived metrics ──────────────────────────────────────────────────────
 const now = new Date();
 const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

 // Compute the period start that matches the dateFilter so KPI cards stay in sync
 const periodStart: Date | null = (() => {
   if (dateFilter === "today") { const d = new Date(now); d.setHours(0,0,0,0); return d; }
   if (dateFilter === "week") { const d = new Date(now); d.setDate(now.getDate() - 7); return d; }
   if (dateFilter === "month") return startOfMonth;
   return null; // "all"
 })();

 const inPeriod = (d?: string) => {
   if (!d) return false;
   if (!periodStart) return true; // "all time"
   return new Date(d) >= periodStart;
 };

 const monthPays = payments.filter((p: any) => inPeriod(p.createdAt ?? p.dueDate));
 // Use server-computed stats for authoritative KPIs (value-based collection rate, month-scoped)
 const totalRevenue = serverStats ? Number(serverStats.collected ?? 0) : monthPays.filter((p: any) => p.status === "paid" || p.status === "completed").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
 const totalPending = serverStats ? Number(serverStats.pending ?? 0) : payments.filter((p: any) => ["pending", "processing"].includes(p.status)).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
 const totalOverdue = serverStats ? Number(serverStats.overdue ?? 0) : payments.filter((p: any) => p.status === "overdue").reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
 const collectionRate = serverStats?.collectionRate ?? 0;
 const totalExpenses = [...expenses].filter(e => inPeriod(e.createdAt)).reduce((s, e) => s + Number(e.amount ?? 0), 0);
 const netProfit = totalRevenue - totalExpenses;
 const margin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

 const mpesaCount = mpesa.filter(m => inPeriod(m.createdAt)).length;
 const eftCount = payments.filter(p => (p.paymentMethod === "eft" || p.paymentMethod === "bank_transfer" || p.paymentMethod === "bank") && inPeriod(p.createdAt)).length;

 // All transactions combined for table
 // Deduplicate: rent-payments linked to an M-PESA txn are already in payments[]
 const linkedMpesaRefs = new Set(
   payments
     .filter((p: any) => p.paymentMethod === "mpesa" && (p.reference ?? p.receiptNumber))
     .map((p: any) => (p.reference ?? p.receiptNumber) as string)
 );

 const allTxns = [
 ...payments.map((p: any) => ({
 id: `pay-${p.id}`,
 date: p.createdAt ?? p.dueDate,
 description: p.tenant ? `Rent — ${p.tenant.firstName ?? ""} ${p.tenant.lastName ?? ""}`.trim() : "Rent payment",
 amount: Number(p.amount ?? 0),
 type: "income",
 method: p.paymentMethod ?? "eft",
 status: p.status,
 reference: p.reference ?? p.receiptNumber,
 })),
 ...mpesa
   .filter((m: any) => {
     const ref = m.mpesaReceiptNumber ?? m.transactionId;
     return !ref || !linkedMpesaRefs.has(ref);
   })
   .map((m: any) => ({
 id: `mpesa-${m.id}`,
 date: m.createdAt,
 description: m.description ?? "M-PESA transaction",
 amount: Number(m.amount ?? 0),
 type: "income",
 method: "mpesa",
 status: m.status ?? "completed",
 reference: m.mpesaReceiptNumber ?? m.transactionId,
 })),
 ...[...expenses].map((c: any, i) => ({
 id: `exp-${c.id ?? i}`,
 date: c.createdAt ?? c.date,
 description: c.description ?? c.name ?? "Expense",
 amount: Number(c.amount ?? 0),
 type: "expense",
 method: "eft",
 status: c.status ?? "completed",
 reference: c.reference,
 })),
 ].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());

 // Apply filters
 const filteredTxns = allTxns.filter(t => {
 if (search && !t.description.toLowerCase().includes(search.toLowerCase()) && !t.reference?.toLowerCase().includes(search.toLowerCase())) return false;
 if (methodFilter !== "all" && t.method !== methodFilter) return false;
 if (dateFilter === "today") return new Date(t.date).toDateString() === now.toDateString();
 if (dateFilter === "week") {
 const wk = new Date(now); wk.setDate(now.getDate() - 7);
 return new Date(t.date) >= wk;
 }
 if (dateFilter === "month") return new Date(t.date) >= startOfMonth;
 return true;
 });

 // 6-month revenue chart data
 const chartData = Array.from({ length: 6 }, (_, i) => {
 const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
 const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0);
 const income = payments.filter(p => {
 const pd = new Date(p.createdAt ?? p.dueDate ?? 0);
 return pd >= d && pd <= end && (p.status === "paid" || p.status === "completed");
 }).reduce((s, p) => s + Number(p.amount ?? 0), 0);
 const exp = [...expenses].filter(e => {
 const ed = new Date(e.createdAt ?? e.date ?? 0);
 return ed >= d && ed <= end;
 }).reduce((s, e) => s + Number(e.amount ?? 0), 0);
 return { label: d.toLocaleString("default", { month: "short" }), income, expense: exp };
 });
 const chartMax = Math.max(...(Array.isArray(chartData) ? chartData : []).map(d => Math.max(d.income, d.expense)), 1);

 const handleExport = () => {
 const csv = ["Date,Description,Type,Amount,Method,Status,Reference",
 ...filteredTxns.map(t => `"${t.date ? new Date(t.date).toLocaleDateString() : ""}","${t.description}","${t.type}","${t.amount}","${t.method}","${t.status}","${t.reference ?? ""}"`),
 ].join("\n");
 const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
 const a = Object.assign(document.createElement("a"), { href: url, download: `transactions-${new Date().toISOString().split("T")[0]}.csv` });
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
 toast({ title: "Exported", description: `${filteredTxns.length} transactions exported` });
 };

 return (
 <div className="min-h-screen bg-background">
 {/* Header */}
 <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-6 py-5">
 <div className="max-w-7xl mx-auto flex items-center justify-between">
 <div>
 <h1 className="text-xl font-semibold text-foreground">Finances</h1>
 <p className="text-sm text-muted-foreground mt-0.5">{dateFilter === "today" ? "Today" : dateFilter === "week" ? "Last 7 days" : dateFilter === "month" ? new Date().toLocaleString("default", { month: "long", year: "numeric" }) : "All time"} · Portfolio financial summary</p>
 </div>
 <div className="flex items-center gap-2">
 <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1.5" />Export</Button>
 </div>
 </div>
 </div>

 <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
 {/* KPI cards */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
 {[
 { label: `Revenue (${dateFilter === "today" ? "Today" : dateFilter === "week" ? "7d" : dateFilter === "all" ? "All" : "MTD"})`, value: fmtShort(totalRevenue), icon: TrendingUp, color: "green", sub: `${serverStats?.collectedCount ?? 0} paid · ${collectionRate}% rate` },
 { label: `Expenses (${dateFilter === "today" ? "Today" : dateFilter === "week" ? "7d" : dateFilter === "all" ? "All" : "MTD"})`, value: fmtShort(totalExpenses), icon: TrendingDown, color: "red", sub: `${expenses.length} items` },
 { label: "Net profit", value: fmtShort(netProfit), icon: Wallet, color: netProfit >= 0 ? "blue" : "red", sub: `${margin}% margin` },
 { label: "Overdue", value: fmtShort(totalOverdue), icon: Receipt, color: totalOverdue > 0 ? "amber" : "gray", sub: `${payments.filter(p => p.status === "overdue").length} tenants` },
 ].map(({ label, value, icon: Icon, color, sub }) => (
 <Card key={label} className="rounded-xl border border-border shadow-sm">
 <CardContent className="p-5">
 <div className="flex items-start justify-between mb-2">
 <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-${color}-50`}>
 <Icon className={`w-4 h-4 text-${color}-600`} />
 </div>
 </div>
 <p className="text-xl font-semibold text-foreground mb-0.5">{value}</p>
 <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">{label}</p>
 <p className="text-xs text-muted-foreground">{sub}</p>
 </CardContent>
 </Card>
 ))}
 </div>

 <Tabs value={tab} onValueChange={setTab}>
 <TabsList className="bg-card dark:bg-gray-900 border border-border dark:border-gray-800 rounded-xl p-1 h-auto">
 {[["overview","Overview"],["transactions","Transactions"],["payments","Payment methods"]].map(([v,l]) => (
 <TabsTrigger key={v} value={v} className="rounded-lg text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white px-4 py-1.5">{l}</TabsTrigger>
 ))}
 </TabsList>

 {/* OVERVIEW TAB */}
 <TabsContent value="overview" className="space-y-5 mt-4">
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
 {/* Revenue vs Expense Chart */}
 <Card className="lg:col-span-2 rounded-xl border border-border shadow-sm">
 <CardHeader className="pb-2">
 <CardTitle className="text-base font-semibold">Revenue vs Expenses</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-end gap-2 h-40 mb-2">
 {(Array.isArray(chartData) ? chartData : []).map((d, i) => {
 const ih = Math.round((d.income / chartMax) * 140);
 const eh = Math.round((d.expense / chartMax) * 140);
 return (
 <div key={i} className="flex-1 flex items-end gap-0.5 group relative">
 <div className="flex-1 bg-blue-100 rounded-t-sm hover:bg-blue-400 transition-colors" style={{ height: `${Math.max(ih, 2)}px` }} title={`Revenue: ${fmt(d.income)}`} />
 <div className="flex-1 bg-red-100 rounded-t-sm hover:bg-red-300 transition-colors" style={{ height: `${Math.max(eh, 2)}px` }} title={`Expenses: ${fmt(d.expense)}`} />
 </div>
 );
 })}
 </div>
 <div className="flex gap-2 mb-3">
 {(Array.isArray(chartData) ? chartData : []).map((d, i) => <div key={i} className="flex-1 text-center text-xs text-muted-foreground">{d.label}</div>)}
 </div>
 <div className="flex items-center gap-4 text-xs text-muted-foreground">
 <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-blue-200 rounded-sm" />Revenue</div>
 <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-red-200 rounded-sm" />Expenses</div>
 </div>
 </CardContent>
 </Card>

 {/* Payment method breakdown */}
 <Card className="rounded-xl border border-border shadow-sm">
 <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Payment methods</CardTitle></CardHeader>
 <CardContent className="space-y-4">
 {[
 { label: "M-PESA", count: mpesaCount, color: "bg-orange-500", pct: allTxns.length ? Math.round(mpesaCount / allTxns.length * 100) : 0 },
 { label: "Bank / EFT", count: eftCount, color: "bg-blue-500", pct: allTxns.length ? Math.round(eftCount / allTxns.length * 100) : 0 },
 { label: "Pending", count: payments.filter(p => p.status === "pending").length, color: "bg-amber-400", pct: 0 },
 ].map(({ label, count, color, pct }) => (
 <div key={label}>
 <div className="flex items-center justify-between text-sm mb-1.5">
 <span className="text-foreground dark:text-muted-foreground">{label}</span>
 <span className="font-medium text-foreground">{count}</span>
 </div>
 <div className="w-full bg-muted dark:bg-gray-800 rounded-full h-1.5">
 <div className={`${color} h-1.5 rounded-full`} style={{ width: `${Math.max(pct, 2)}%` }} />
 </div>
 </div>
 ))}
 <div className="pt-2 border-t border-border dark:border-gray-800 grid grid-cols-2 gap-2 text-xs text-center">
 <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-2"><p className="font-semibold text-amber-700">{fmt(totalPending)}</p><p className="text-amber-600">Pending</p></div>
 <div className="bg-green-50 dark:bg-green-950 rounded-lg p-2"><p className="font-semibold text-green-700">{fmt(totalRevenue)}</p><p className="text-green-600">Collected</p></div>
 </div>
 </CardContent>
 </Card>
 </div>
 </TabsContent>

 {/* TRANSACTIONS TAB */}
 <TabsContent value="transactions" className="space-y-4 mt-4">
 <div className="flex flex-wrap items-center gap-3">
 <div className="relative flex-1 min-w-[200px] max-w-sm">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input placeholder="Search transactions..." className="pl-9 h-9 border-border dark:border-gray-700" value={search} onChange={e => setSearch(e.target.value)} />
 </div>
 <Select value={methodFilter} onValueChange={setMethodFilter}>
 <SelectTrigger className="w-32 h-9 border-border dark:border-gray-700 text-sm"><SelectValue placeholder="Method" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All methods</SelectItem>
 <SelectItem value="mpesa">M-PESA</SelectItem>
 <SelectItem value="eft">EFT</SelectItem>
 <SelectItem value="cash">Cash</SelectItem>
 </SelectContent>
 </Select>
 <Select value={dateFilter} onValueChange={setDateFilter}>
 <SelectTrigger className="w-32 h-9 border-border dark:border-gray-700 text-sm"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All time</SelectItem>
 <SelectItem value="today">Today</SelectItem>
 <SelectItem value="week">This week</SelectItem>
 <SelectItem value="month">This month</SelectItem>
 </SelectContent>
 </Select>
 <span className="text-sm text-muted-foreground">{filteredTxns.length} transactions</span>
 </div>

 <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
 {isLoading ? (
  <CardContent className="py-12 text-center">
   <div className="flex flex-col items-center gap-3">
    <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    <p className="text-sm text-muted-foreground">Loading transactions…</p>
   </div>
  </CardContent>
 ) : filteredTxns.length === 0 ? (
 <CardContent className="py-12 text-center">
 <BarChart3 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
 <p className="text-sm text-muted-foreground">No transactions found</p>
 </CardContent>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Method</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
 <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-50">
 {filteredTxns.slice(0, 50).map(t => (
 <tr key={t.id} className="hover:bg-muted dark:bg-gray-950 transition-colors">
 <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
 {t.date ? new Date(t.date).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
 </td>
 <td className="px-4 py-3">
 <div className="flex items-center gap-2">
 <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${t.type === "income" ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}>
 {t.type === "income" ? <ArrowDownLeft className="w-3 h-3 text-green-600" /> : <ArrowUpRight className="w-3 h-3 text-red-500" />}
 </div>
 <span className="text-foreground font-medium truncate max-w-[200px]">{t.description}</span>
 </div>
 </td>
 <td className="px-4 py-3 hidden md:table-cell"><MethodBadge m={t.method} /></td>
 <td className={`px-4 py-3 font-semibold ${t.type === "income" ? "text-green-700" : "text-red-600"}`}>
 {t.type === "expense" ? "−" : "+"}{fmt(t.amount)}
 </td>
 <td className="px-4 py-3"><StatusBadge s={t.status} /></td>
 </tr>
 ))}
 </tbody>
 </table>
 {filteredTxns.length > 50 && (
 <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border dark:border-gray-800 text-center">
 Showing 50 of {filteredTxns.length} transactions · Export CSV to see all
 </div>
 )}
 </div>
 )}
 </Card>
 </TabsContent>

 {/* PAYMENT METHODS TAB */}
 <TabsContent value="payments" className="mt-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
 <Card className="rounded-xl border border-border shadow-sm">
 <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Smartphone className="w-4 h-4 text-orange-500" />M-PESA</CardTitle></CardHeader>
 <CardContent>
 <div className="space-y-3">
 <div className="flex justify-between"><span className="text-sm text-muted-foreground dark:text-muted-foreground">Total transactions</span><span className="font-semibold">{mpesa.length}</span></div>
 <div className="flex justify-between"><span className="text-sm text-muted-foreground">{dateFilter === "today" ? "Today" : dateFilter === "week" ? "This week" : dateFilter === "all" ? "All time" : "This month"}</span><span className="font-semibold">{mpesaCount}</span></div>
 <div className="flex justify-between"><span className="text-sm text-muted-foreground dark:text-muted-foreground">Total amount</span><span className="font-semibold text-green-700">{fmt(mpesa.reduce((s, m) => s + Number(m.amount ?? 0), 0))}</span></div>
 <div className="pt-2 border-t border-border dark:border-gray-800 text-xs text-muted-foreground">
 Connected via Daraja API · Shortcode from .env
 </div>
 </div>
 </CardContent>
 </Card>
 <Card className="rounded-xl border border-border shadow-sm">
 <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-500" />Bank / EFT</CardTitle></CardHeader>
 <CardContent>
 <div className="space-y-3">
 <div className="flex justify-between"><span className="text-sm text-muted-foreground dark:text-muted-foreground">EFT payments</span><span className="font-semibold">{eftCount}</span></div>
 <div className="flex justify-between"><span className="text-sm text-muted-foreground dark:text-muted-foreground">Total collected</span><span className="font-semibold text-green-700">{fmt(payments.filter(p => p.paymentMethod === "eft" || p.paymentMethod === "bank_transfer").reduce((s, p) => s + Number(p.amount ?? 0), 0))}</span></div>
 <div className="flex justify-between"><span className="text-sm text-muted-foreground dark:text-muted-foreground">Pending collection</span><span className="font-semibold text-amber-600">{fmt(totalPending)}</span></div>
 <div className="pt-2 border-t border-border dark:border-gray-800 text-xs text-muted-foreground">
 Bank transfers tracked manually or via bank feeds
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 </TabsContent>
 </Tabs>
 </div>
 </div>
 );
}