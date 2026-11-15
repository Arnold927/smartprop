/**
 * BankReconciliation.tsx
 *
 * Full bank-statement reconciliation UI.
 * Tabs:
 *  1. Imports      — list of uploaded statement batches
 *  2. Upload       — CSV upload form
 *  3. Review rows  — per-import row list with match/ignore/unmatch actions
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button }       from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge }        from "@/components/ui/badge";
import { Input }        from "@/components/ui/input";
import { Label }        from "@/components/ui/label";
import { Textarea }     from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton }     from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, Building2, CheckCircle2, AlertCircle, Clock, X, Search,
  RefreshCw, Link, Unlink, Eye, ChevronRight, FileSpreadsheet,
  Banknote, AlertTriangle, Info, Loader2, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiJson } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/maintenance-flow";
import { ConfirmDialog } from "@/components/ui/sp-ui";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BankImport {
  id:                   number;
  bankName:             string;
  accountName?:         string;
  accountNumber?:       string;
  statementPeriodFrom?: string;
  statementPeriodTo?:   string;
  rowCount:             number;
  matchedCount:         number;
  unmatchedCount:       number;
  fileName?:            string;
  status:               string;
  createdAt:            string;
}

interface BankRow {
  id:                   number;
  importId:             number;
  bankName:             string;
  transactionDate:      string;
  description:          string;
  amount:               string;
  debitAmount?:         string;
  creditAmount?:        string;
  rawReference?:        string;
  parsedReference?:     string;
  payerName?:           string;
  matchStatus:          "unmatched" | "matched" | "ignored" | "suggested";
  matchedRentPaymentId?: number;
  matchConfidence?:     number;
  matchMethod?:         string;
  reconcileNotes?:      string;
  matchedPayment?: {
    id:            number;
    invoiceNumber: string;
    amount:        string;
    dueDate:       string;
    status:        string;
    tenantId:      number;
    tenantName?:   string;
  } | null;
  /** Set on a bank debit that was matched to (or is suggested for) an owner payout. */
  matchedStatement?: { id: number; statementNumber: string; netPayable: string; status: string; propertyName?: string } | null;
}

interface OpenInvoice {
  id:            number;
  invoiceNumber: string | null;
  amount:        number;
  balance:       number;
  dueDate:       string;
  status:        string;
  tenantName:    string;
  unitNumber:    string | null;
}

interface PayoutCandidate {
  id:              number;
  statementNumber: string;
  status:          string;
  periodMonth:     number;
  periodYear:      number;
  netPayable:      string;
  propertyName?:   string;
  ownerFirstName?: string;
  ownerLastName?:  string;
}

interface BankName {
  key:     string;
  label:   string;
  country: string;
  csvHint: string;
}

interface PendingPayment {
  id:            number;
  invoiceNumber: string;
  amount:        string;
  dueDate:       string;
  status:        string;
  tenantId:      number;
  tenant?:       { firstName: string; lastName: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MATCH_STATUS_CONFIG = {
  matched:   { label: "Matched",   cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",  icon: CheckCircle2 },
  suggested: { label: "Suggested", cls: "bg-blue-100 text-blue-800 border-blue-200",     icon: AlertTriangle },
  unmatched: { label: "Unmatched", cls: "bg-amber-100 text-amber-800 border-amber-200" ,  icon: AlertCircle  },
  ignored:   { label: "Ignored",   cls: "bg-gray-100 text-gray-600 border-gray-200",     icon: X            },
};

const fmtKES = (n: string | number) =>
  `KES ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string) => d ? format(new Date(d), "dd MMM yyyy") : "—";

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankReconciliation() {
  const { toast }         = useToast();
  const qc                = useQueryClient();
  const [tab, setTab]     = useState<"imports" | "upload" | "review">("imports");
  const [selectedImport, setSelectedImport] = useState<BankImport | null>(null);
  const [rowFilter, setRowFilter] = useState("all");
  const [matchDialogRow,  setMatchDialogRow]  = useState<BankRow | null>(null);
  const [ignoreDialogRow, setIgnoreDialogRow] = useState<BankRow | null>(null);
  const [searchTerm,      setSearchTerm]      = useState("");
  const [payoutDialogRow, setPayoutDialogRow] = useState<BankRow | null>(null);
  const [deleteImport,    setDeleteImport]    = useState<BankImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: bankNames = [], isLoading: loadingBanks } = useQuery<BankName[]>({
    queryKey: ["/api/bank-reconciliation/bank-names"],
  });

  const { data: imports = [], isLoading: loadingImports, refetch: refetchImports } =
    useQuery<BankImport[]>({
      queryKey: ["/api/bank-reconciliation/imports"],
    });

  const { data: reviewData, isLoading: loadingRows, refetch: refetchRows } = useQuery<{
    import: BankImport;
    rows:   BankRow[];
  }>({
    queryKey: ["/api/bank-reconciliation/imports", selectedImport?.id, "rows", rowFilter],
    queryFn: () =>
      apiJson<{ import: BankImport; rows: BankRow[] }>(`/api/bank-reconciliation/imports/${selectedImport!.id}/rows?status=${rowFilter}`),
    enabled: !!selectedImport,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const refreshAll = () => {
    refetchRows();
    refetchImports();
    qc.invalidateQueries({ queryKey: ["/api/bank-reconciliation/open-invoices"] });
    qc.invalidateQueries({ queryKey: ["/api/rent-payments"] });
    qc.invalidateQueries({ queryKey: ["/api/owner-statements"] });
  };
  const fail = (title: string) => (err: unknown) => toast({ title, description: apiErrorMessage(err), variant: "destructive" });

  const uploadMutation = useMutation({
    mutationFn: async (data: any) => (await apiRequest("/api/bank-reconciliation/imports", { method: "POST", data })).json(),
    onSuccess: (res: any) => {
      toast({ title: "Statement uploaded", description: res.message });
      qc.invalidateQueries({ queryKey: ["/api/bank-reconciliation/imports"] });
      setTab("imports");
    },
    onError: fail("Upload failed"),
  });

  const autoMatchMutation = useMutation({
    mutationFn: async (importId: number) => (await apiRequest(`/api/bank-reconciliation/imports/${importId}/auto-match`, { method: "POST" })).json(),
    onSuccess: (res: any) => {
      toast({ title: "Auto-match complete", description: res.message });
      refreshAll();
    },
    onError: fail("Auto-match failed"),
  });

  const matchMutation = useMutation({
    mutationFn: async ({ rowId, rentPaymentId, notes }: { rowId: number; rentPaymentId: number; notes?: string }) =>
      (await apiRequest(`/api/bank-reconciliation/rows/${rowId}/match`, { method: "POST", data: { rentPaymentId, notes } })).json(),
    onSuccess: (res: any) => {
      toast({ title: "Payment matched", description: res?.message });
      setMatchDialogRow(null);
      refreshAll();
    },
    onError: fail("Match failed"),
  });

  const payoutMutation = useMutation({
    mutationFn: async ({ rowId, statementId }: { rowId: number; statementId: number }) =>
      (await apiRequest(`/api/bank-reconciliation/rows/${rowId}/match-statement`, { method: "POST", data: { statementId } })).json(),
    onSuccess: (res: any) => {
      toast({ title: "Payout matched", description: res?.message });
      setPayoutDialogRow(null);
      refreshAll();
    },
    onError: fail("Could not match the payout"),
  });

  const ignoreMutation = useMutation({
    mutationFn: async ({ rowId, notes }: { rowId: number; notes?: string }) =>
      (await apiRequest(`/api/bank-reconciliation/rows/${rowId}/ignore`, { method: "POST", data: { notes } })).json(),
    onSuccess: () => {
      toast({ title: "Row ignored" });
      setIgnoreDialogRow(null);
      refreshAll();
    },
    onError: fail("Could not ignore the row"),
  });

  const unmatchMutation = useMutation({
    mutationFn: async (rowId: number) =>
      (await apiRequest(`/api/bank-reconciliation/rows/${rowId}/unmatch`, { method: "POST" })).json(),
    onSuccess: () => {
      toast({ title: "Reverted", description: "The payment (if any) was reversed and the invoice is open again." });
      refreshAll();
    },
    onError: fail("Could not revert"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest(`/api/bank-reconciliation/imports/${id}`, { method: "DELETE" })).json(),
    onSuccess: () => {
      toast({ title: "Import deleted" });
      setDeleteImport(null);
      if (selectedImport && deleteImport && selectedImport.id === deleteImport.id) { setSelectedImport(null); setTab("imports"); }
      refetchImports();
    },
    onError: (err: unknown) => { setDeleteImport(null); toast({ title: "Could not delete", description: apiErrorMessage(err), variant: "destructive" }); },
  });

  // ── Upload form handler ────────────────────────────────────────────────────

  const handleUpload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fileInputRef.current?.files?.[0];
    if (!file) return toast({ title: "Please select a CSV file", variant: "destructive" });

    const reader = new FileReader();
    reader.onload = ev => {
      uploadMutation.mutate({
        bankName:            fd.get("bankName"),
        accountName:         fd.get("accountName") || undefined,
        accountNumber:       fd.get("accountNumber") || undefined,
        statementPeriodFrom: fd.get("periodFrom") || undefined,
        statementPeriodTo:   fd.get("periodTo")   || undefined,
        notes:               fd.get("notes")       || undefined,
        fileName:            file.name,
        csvData:             ev.target?.result as string,
      });
    };
    reader.readAsText(file);
  };

  // ── Filtered rows ──────────────────────────────────────────────────────────

  const displayedRows = (reviewData?.rows ?? []).filter((r: BankRow) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      r.description?.toLowerCase().includes(q) ||
      r.rawReference?.toLowerCase().includes(q) ||
      r.parsedReference?.toLowerCase().includes(q) ||
      r.payerName?.toLowerCase().includes(q) ||
      r.matchedPayment?.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  const selectedBankHint = bankNames.find(b => b.key === (document.querySelector("[name=bankName]") as HTMLSelectElement)?.value)?.csvHint;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Bank Reconciliation</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Import bank statements from any Kenyan bank and auto-match transactions to rent invoices
          </p>
        </div>
        <Button onClick={() => setTab("upload")} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Upload className="h-4 w-4 mr-2" />
          Import Statement
        </Button>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="upload">Upload CSV</TabsTrigger>
          <TabsTrigger value="review" disabled={!selectedImport}>Review Rows</TabsTrigger>
        </TabsList>

        {/* ── Imports tab ─────────────────────────────────────────────────── */}
        <TabsContent value="imports" className="space-y-3 mt-4">
          {loadingImports ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
          ) : imports.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium">No statements imported yet</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Upload a CSV bank statement to start reconciling payments
                </p>
                <Button onClick={() => setTab("upload")} variant="outline">Import Statement</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {imports.map(imp => {
                const matchPct = imp.rowCount > 0 ? Math.round((imp.matchedCount / imp.rowCount) * 100) : 0;
                return (
                  <Card
                    key={imp.id}
                    className="cursor-pointer hover:border-blue-300 transition-colors"
                    onClick={() => { setSelectedImport(imp); setTab("review"); }}
                  >
                    <CardContent className="flex items-center gap-4 py-4 px-5">
                      <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950 shrink-0">
                        <Building2 className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {bankNames.find(b => b.key === imp.bankName)?.label ?? imp.bankName}
                          </span>
                          {imp.accountName && (
                            <span className="text-xs text-muted-foreground">— {imp.accountName}</span>
                          )}
                          {imp.statementPeriodFrom && imp.statementPeriodTo && (
                            <Badge variant="outline" className="text-xs">
                              {fmtDate(imp.statementPeriodFrom)} → {fmtDate(imp.statementPeriodTo)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="text-xs text-muted-foreground">{imp.rowCount} transactions</span>
                          <span className="text-xs text-green-600">{imp.matchedCount} matched</span>
                          <span className="text-xs text-amber-600">{imp.unmatchedCount} unmatched</span>
                          <span className="text-xs text-muted-foreground">{imp.fileName}</span>
                        </div>
                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden w-48">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all"
                            style={{ width: `${matchPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{matchPct}% reconciled</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={e => {
                            e.stopPropagation();
                            autoMatchMutation.mutate(imp.id);
                          }}
                          disabled={autoMatchMutation.isPending}
                        >
                          {autoMatchMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                          <span className="ml-1.5 hidden sm:inline">Auto-match</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-red-600"
                          title="Delete this import"
                          aria-label="Delete this import"
                          onClick={e => { e.stopPropagation(); setDeleteImport(imp); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Upload tab ──────────────────────────────────────────────────── */}
        <TabsContent value="upload" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import Bank Statement</CardTitle>
              <CardDescription>
                Upload a CSV export from your bank. Supported: Equity, KCB, Co-op, NCBA, Absa, DTB, I&amp;M, Stanbic, Std Chartered, Family, Prime, and any generic CSV.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpload} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bank *</Label>
                    {loadingBanks ? (
                      <Skeleton className="h-9" />
                    ) : (
                      <Select name="bankName" required defaultValue="">
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select bank…" />
                        </SelectTrigger>
                        <SelectContent>
                          {bankNames.map(b => (
                            <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Account Name (optional)</Label>
                    <Input name="accountName" placeholder="e.g. Westgate Collection Account" className="h-9" />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Account Number (optional)</Label>
                    <Input name="accountNumber" placeholder="e.g. 0170123456789" className="h-9" />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Statement Period From</Label>
                    <Input name="periodFrom" type="date" className="h-9" />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Statement Period To</Label>
                    <Input name="periodTo" type="date" className="h-9" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">CSV File *</Label>
                  <div
                    className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Click to select CSV file</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Export your statement as CSV from your bank's internet banking portal
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                    />
                  </div>
                  <p className="text-xs text-blue-600">
                    <Info className="h-3 w-3 inline mr-1" />
                    Make sure to select the correct bank above — column headers vary between banks
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea name="notes" rows={2} placeholder="e.g. April 2024 rent collection period" />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setTab("imports")}>Cancel</Button>
                  <Button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Upload className="h-4 w-4 mr-2" />
                    Upload & Parse
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Review rows tab ──────────────────────────────────────────────── */}
        <TabsContent value="review" className="mt-4 space-y-3">
          {selectedImport && (
            <>
              {/* Import summary bar */}
              <Card className="border-blue-100 bg-blue-50/40 dark:bg-blue-950/20">
                <CardContent className="flex items-center gap-6 py-3 px-5 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground">Bank</p>
                    <p className="font-medium text-sm">
                      {bankNames.find(b => b.key === selectedImport.bankName)?.label ?? selectedImport.bankName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total rows</p>
                    <p className="font-medium text-sm">{selectedImport.rowCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Matched</p>
                    <p className="font-medium text-sm text-green-600">{selectedImport.matchedCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unmatched</p>
                    <p className="font-medium text-sm text-amber-600">{selectedImport.unmatchedCount}</p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => autoMatchMutation.mutate(selectedImport.id)}
                      disabled={autoMatchMutation.isPending}
                    >
                      {autoMatchMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                      Auto-match
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTab("imports")}>
                      ← All Imports
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Filters */}
              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 w-52 text-xs"
                    placeholder="Search description / ref…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={rowFilter} onValueChange={setRowFilter}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All rows</SelectItem>
                    <SelectItem value="unmatched">Unmatched</SelectItem>
                    <SelectItem value="suggested">Suggested</SelectItem>
                    <SelectItem value="matched">Matched</SelectItem>
                    <SelectItem value="ignored">Ignored</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Rows table */}
              {loadingRows ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : displayedRows.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No rows match the current filter
                  </CardContent>
                </Card>
              ) : (
                <div className="rounded-lg border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Date</TableHead>
                        <TableHead>Description / Payer</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Matched to</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedRows.map((row: BankRow) => {
                        const cfg = MATCH_STATUS_CONFIG[row.matchStatus as keyof typeof MATCH_STATUS_CONFIG] ?? MATCH_STATUS_CONFIG.unmatched;
                        const Icon = cfg.icon;
                        const amt = Number(row.amount);
                        return (
                          <TableRow key={row.id} className="text-xs">
                            <TableCell className="whitespace-nowrap">{fmtDate(row.transactionDate)}</TableCell>
                            <TableCell className="max-w-[180px]">
                              <p className="truncate">{row.description}</p>
                              {row.payerName && (
                                <p className="text-muted-foreground truncate">{row.payerName}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.parsedReference && (
                                <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                                  {row.parsedReference}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-medium whitespace-nowrap ${amt > 0 ? "text-green-600" : "text-red-600"}`}>
                              {fmtKES(Math.abs(amt))}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${cfg.cls} flex items-center gap-1 w-fit`}>
                                <Icon className="h-2.5 w-2.5" />
                                {cfg.label}
                                {row.matchConfidence && row.matchStatus !== "matched"
                                  ? ` (${row.matchConfidence}%)`
                                  : ""}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {row.matchedPayment ? (
                                <div>
                                  <p className="font-medium text-[11px]">{row.matchedPayment.invoiceNumber}{row.matchedPayment.tenantName ? ` · ${row.matchedPayment.tenantName}` : ""}</p>
                                  <p className="text-muted-foreground text-[10px]">
                                    Due {fmtDate(row.matchedPayment.dueDate)} · {fmtKES(row.matchedPayment.amount)}
                                  </p>
                                </div>
                              ) : row.matchedStatement ? (
                                <div>
                                  <p className="font-medium text-[11px]">Owner payout {row.matchedStatement.statementNumber}</p>
                                  <p className="text-muted-foreground text-[10px]">
                                    {row.matchedStatement.propertyName ?? ""} · {fmtKES(row.matchedStatement.netPayable)}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 justify-end flex-wrap">
                                {(row.matchStatus === "unmatched" || row.matchStatus === "suggested") && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-[11px]"
                                      onClick={() => (amt < 0 ? setPayoutDialogRow(row) : setMatchDialogRow(row))}
                                    >
                                      <Link className="h-3 w-3 mr-1" />
                                      {amt < 0 ? "Owner payout" : "Match"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-[11px] text-muted-foreground"
                                      onClick={() => setIgnoreDialogRow(row)}
                                    >
                                      Ignore
                                    </Button>
                                  </>
                                )}
                                {(row.matchStatus === "matched" || row.matchStatus === "suggested") && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-[11px] text-amber-600 hover:text-amber-700"
                                    onClick={() => unmatchMutation.mutate(row.id)}
                                    disabled={unmatchMutation.isPending}
                                  >
                                    <Unlink className="h-3 w-3 mr-1" />
                                    Revert
                                  </Button>
                                )}
                                {row.matchStatus === "ignored" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => unmatchMutation.mutate(row.id)}
                                  >
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Restore
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Manual Match dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!matchDialogRow} onOpenChange={open => !open && setMatchDialogRow(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Match Bank Transaction</DialogTitle>
            <DialogDescription>
              Link this bank credit to the correct rent invoice
            </DialogDescription>
          </DialogHeader>

          {matchDialogRow && (
            <div className="space-y-4 mt-1">
              {/* Transaction summary */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-xs">Date</span>
                  <span className="text-xs font-medium">{fmtDate(matchDialogRow.transactionDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-xs">Amount</span>
                  <span className="text-xs font-semibold text-green-600">{fmtKES(matchDialogRow.amount)}</span>
                </div>
                {matchDialogRow.parsedReference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-xs">Reference</span>
                    <span className="font-mono text-[11px]">{matchDialogRow.parsedReference}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <span className="text-xs max-w-[200px] text-right break-words">{matchDialogRow.description}</span>
                </div>
              </div>

              {/* If there's a suggested match, highlight it */}
              {matchDialogRow.matchedPayment && matchDialogRow.matchStatus === "suggested" && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">
                    Suggested match ({matchDialogRow.matchConfidence}% confidence)
                  </p>
                  <p className="text-xs">
                    Invoice {matchDialogRow.matchedPayment.invoiceNumber} · {fmtKES(matchDialogRow.matchedPayment.amount)} due {fmtDate(matchDialogRow.matchedPayment.dueDate)}
                  </p>
                  <Button
                    size="sm"
                    className="mt-2 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => matchMutation.mutate({
                      rowId:         matchDialogRow.id,
                      rentPaymentId: matchDialogRow.matchedPayment!.id,
                    })}
                    disabled={matchMutation.isPending}
                  >
                    {matchMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Confirm this match
                  </Button>
                </div>
              )}

              {/* Manual pick from pending payments */}
              <ManualMatchForm
                row={matchDialogRow}
                onMatch={(rentPaymentId, notes) =>
                  matchMutation.mutate({ rowId: matchDialogRow.id, rentPaymentId, notes })
                }
                isPending={matchMutation.isPending}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Owner payout dialog (bank debit → approved owner statement) ──────── */}
      <PayoutDialog
        row={payoutDialogRow}
        onClose={() => setPayoutDialogRow(null)}
        onConfirm={(rowId, statementId) => payoutMutation.mutate({ rowId, statementId })}
        isPending={payoutMutation.isPending}
      />

      <ConfirmDialog
        open={!!deleteImport} onClose={() => setDeleteImport(null)}
        onConfirm={() => deleteImport && deleteMutation.mutate(deleteImport.id)} loading={deleteMutation.isPending}
        destructive title="Delete this import?" confirmLabel="Delete import"
        description={`This removes the ${deleteImport?.rowCount ?? 0} transactions of ${deleteImport?.fileName ?? "this statement"}. It is only allowed while none of them is matched to a payment.`}
      />

      {/* ── Ignore dialog ───────────────────────────────────────────────────── */}
      <Dialog open={!!ignoreDialogRow} onOpenChange={open => !open && setIgnoreDialogRow(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Ignore Transaction</DialogTitle>
            <DialogDescription>
              Mark this row as not a rent payment (e.g. interest credit, internal transfer)
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!ignoreDialogRow) return;
              const fd = new FormData(e.currentTarget);
              ignoreMutation.mutate({ rowId: ignoreDialogRow.id, notes: fd.get("notes") as string || undefined });
            }}
            className="space-y-3 mt-2"
          >
            <Textarea name="notes" rows={2} placeholder="Reason (optional)…" />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setIgnoreDialogRow(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={ignoreMutation.isPending} variant="destructive">
                {ignoreMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Ignore row
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-component: manual match form ─────────────────────────────────────────

function ManualMatchForm({
  row, onMatch, isPending,
}: {
  row:       BankRow;
  onMatch:   (rentPaymentId: number, notes?: string) => void;
  isPending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [notes,      setNotes]      = useState("");
  const [q,          setQ]          = useState("");
  const amount = Number(row.amount);

  // Every invoice that can still take money — pending, overdue and part-paid — closest amount first
  const { data: invoices = [], isLoading } = useQuery<OpenInvoice[]>({
    queryKey: ["/api/bank-reconciliation/open-invoices", amount, q],
    queryFn:  () => apiJson<OpenInvoice[]>(`/api/bank-reconciliation/open-invoices?amount=${amount}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const chosen = invoices.find(i => String(i.id) === selectedId);
  const diff = chosen ? Math.round((amount - chosen.balance) * 100) / 100 : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Select the invoice this paid *</Label>
        <Input className="h-8 text-xs" placeholder="Search tenant, unit or invoice…" value={q} onChange={e => setQ(e.target.value)} />
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder={isLoading ? "Loading invoices…" : "Choose an invoice…"} />
          </SelectTrigger>
          <SelectContent>
            {invoices.length === 0 ? (
              <SelectItem value="__none" disabled>No open invoices</SelectItem>
            ) : (
              invoices.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.tenantName}{p.unitNumber ? ` · ${p.unitNumber}` : ""} — {p.invoiceNumber ?? `#${p.id}`} — owes KES {p.balance.toLocaleString("en-KE")}{p.status === "partial" ? " (part paid)" : p.status === "overdue" ? " (overdue)" : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      {chosen && Math.abs(diff) > 0.01 && (
        <p className={`text-xs rounded-md border p-2 ${diff < 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
          {diff < 0
            ? `This is a part payment: KES ${Math.abs(diff).toLocaleString("en-KE")} will still be owed on the invoice.`
            : `This is KES ${diff.toLocaleString("en-KE")} more than the invoice balance. The invoice will be paid and the excess flagged for refund or credit.`}
        </p>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea
          rows={2}
          placeholder="e.g. Tenant paid via RTGS, reference confirmed by PM"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>
      <Button
        className="w-full bg-green-600 hover:bg-green-700 text-white"
        disabled={!selectedId || isPending}
        onClick={() => onMatch(Number(selectedId), notes || undefined)}
      >
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Link className="h-4 w-4 mr-2" />
        Confirm Match
      </Button>
    </div>
  );
}

// ── Sub-component: owner payout dialog ───────────────────────────────────────

function PayoutDialog({
  row, onClose, onConfirm, isPending,
}: {
  row:       BankRow | null;
  onClose:   () => void;
  onConfirm: (rowId: number, statementId: number) => void;
  isPending: boolean;
}) {
  const amount = row ? Math.abs(Number(row.amount)) : 0;
  const { data: statements = [], isLoading } = useQuery<PayoutCandidate[]>({
    queryKey: ["/api/bank-reconciliation/payout-candidates", amount],
    queryFn:  () => apiJson<PayoutCandidate[]>(`/api/bank-reconciliation/payout-candidates?amount=${amount}`),
    enabled:  !!row,
  });
  const suggestedId = row?.matchedStatement?.id;

  return (
    <Dialog open={!!row} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Match to an owner payout</DialogTitle>
          <DialogDescription>
            This bank debit of {fmtKES(amount)} paid an owner statement. Matching marks that statement as paid, using the bank reference.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-16" /> : statements.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No approved statements are waiting to be paid out. Approve the statement first (Finances → Owner Statements).</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto">
            {statements.map(st => {
              const exact = Math.abs(Number(st.netPayable) - amount) < 0.01;
              return (
                <div key={st.id} className={`rounded-lg border p-3 text-xs flex items-center justify-between gap-3 ${exact ? "border-green-300 bg-green-50/60" : ""}`}>
                  <div>
                    <p className="font-medium">{st.statementNumber}{st.id === suggestedId ? " · suggested" : ""}</p>
                    <p className="text-muted-foreground">{st.propertyName} · {st.periodMonth}/{st.periodYear}{st.ownerFirstName ? ` · ${st.ownerFirstName} ${st.ownerLastName ?? ""}` : ""}</p>
                    <p className={exact ? "text-green-700 font-medium" : "text-muted-foreground"}>Net payable {fmtKES(st.netPayable)}{exact ? " — matches" : " — different amount"}</p>
                  </div>
                  <Button size="sm" disabled={!exact || isPending} onClick={() => row && onConfirm(row.id, st.id)}>
                    {isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Mark paid
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
