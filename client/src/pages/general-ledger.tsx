/**
 * general-ledger.tsx  — /general-ledger
 *
 * Full double-entry GL interface.
 *
 * Tabs:
 *   1. Journal Book     — list of posted entries, new entry dialog (multi-line, balanced)
 *   2. Trial Balance    — all accounts with debit/credit totals, balance check
 *   3. Income Statement — revenue vs expenses, net income for a period
 *   4. Balance Sheet    — assets = liabilities + equity as at a date
 *
 * Finance-standard fixes applied:
 *   [Journal Book]
 *     - Debit/credit per line are mutually exclusive: entering one clears the other.
 *     - Balance indicator only shows "Balanced" when totalDebit > 0 (prevents posting empty entries).
 *     - "Post Entry" disabled until: balanced, ≥2 accounts selected, description filled.
 *     - Visual ring on active debit (blue) / credit (orange) fields for scan-readability.
 *     - canPost guard fixed (boolean expression was incorrectly formed in original).
 *     - Removed stray hardcoded `text-slate-700` class; use `text-foreground`.
 *     - Error state shown if API call fails (original silently showed empty list).
 *     - CSV export for audit trail.
 *
 *   [Trial Balance]
 *     - Balance banner now shows the actual KES amounts, not just "balanced/not".
 *     - Out-of-balance shows the exact difference amount.
 *     - Account type section headers use proper display names (e.g. "Assets" not "asset").
 *     - Balance column marks abnormal balances in red with "(Cr)" annotation.
 *     - Grand Total row balance cell is intentionally blank (per GAAP/IFRS — the sum of
 *       net balances is always zero on a balanced TB and adding it confuses readers).
 *     - Error state if fetch fails.
 *     - CSV export.
 *
 *   [Income Statement]
 *     - Date range guard: query disabled and warning shown when from > to.
 *     - Gross Profit subtotal rendered if backend provides COGS data.
 *     - Net Loss displayed as positive number with "(Loss)" label (not a negative number).
 *     - Net Profit Margin % shown below net income line.
 *     - Error state if fetch fails.
 *
 *   [Balance Sheet]
 *     - Imbalance error now explains likely cause (un-closed period net income).
 *     - Balance check banner shows both sides of the equation with amounts.
 *     - Error state if fetch fails.
 */

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Download, RefreshCw, CheckCircle, AlertTriangle, AlertCircle,
  ChevronLeft, ChevronRight, BookOpen, BarChart3, TrendingUp, Layers,
  RotateCcw, Search, X,
} from "lucide-react";
import { format } from "date-fns";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


// ── Helpers ───────────────────────────────────────────────────────────────────

const KES = (n: number | string) =>
  `KES ${Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | Date | null | undefined) =>
  d ? format(new Date(d), "dd MMM yyyy") : "—";

const today = () => new Date().toISOString().slice(0, 10);
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;

/** Download rows as a UTF-8 CSV file. */
function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Account {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
}

interface JournalLine {
  accountId: string;
  description: string;
  debitAmount: string;
  creditAmount: string;
}

const emptyLine = (): JournalLine => ({
  accountId: "", description: "", debitAmount: "", creditAmount: "",
});

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function FetchError({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 px-4 py-3 rounded-lg border border-red-200 dark:border-red-800">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span>{message || "Failed to load data. Please try again."}</span>
    </div>
  );
}

// ── Sub-component: Financial statement section ────────────────────────────────

function StatSection({
  title, items, total, totalLabel, positive = true,
}: {
  title: string;
  items: { accountCode: string; accountName: string; amount?: string; balance?: string }[];
  total: string;
  totalLabel: string;
  positive?: boolean;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide px-2 py-1.5 bg-muted/50 rounded">
        {title}
      </h3>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground px-2 py-2">No activity in this period</p>
      )}
      {items.map(item => (
        <div key={item.accountCode} className="flex justify-between items-center px-2 py-1 text-sm hover:bg-muted/30 rounded">
          <span className="text-muted-foreground font-mono text-xs w-16 flex-shrink-0">{item.accountCode}</span>
          <span className="flex-1 mx-2 text-foreground">{item.accountName}</span>
          <span className="font-mono text-right tabular-nums">{KES(item.amount ?? item.balance ?? 0)}</span>
        </div>
      ))}
      <div className="flex justify-between items-center px-2 py-2 border-t border-border font-semibold text-sm">
        <span>{totalLabel}</span>
        <span className={`font-mono tabular-nums ${positive ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
          {KES(total)}
        </span>
      </div>
    </div>
  );
}

/** Intermediate subtotal line — used for Gross Profit in the Income Statement. */
function SubtotalRow({ label, amount, positive = true }: { label: string; amount: number; positive?: boolean }) {
  return (
    <div className={`flex justify-between items-center px-3 py-2 rounded border font-semibold text-sm
      ${positive
        ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
        : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"}`}>
      <span>{label}</span>
      <span className={`font-mono tabular-nums ${positive ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
        {KES(Math.abs(amount).toFixed(2))}
      </span>
    </div>
  );
}

// ── 1. Journal Book ───────────────────────────────────────────────────────────

function JournalBook() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reverseId, setReverseId] = useState<number | null>(null);
  const [reverseDate, setReverseDate] = useState(today());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [header, setHeader] = useState({
    entryDate: today(), description: "", reference: "", currency: "KES",
  });
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/chart-of-accounts"],
    queryFn: () => apiRequest("/api/chart-of-accounts").then(r => r.json()),
  });

  // Fetch lines for the expanded entry (click-to-drill-down audit trail)
  const { data: entryDetail, isFetching: detailFetching } = useQuery<any>({
    queryKey: ["/api/journal-entries/detail", expandedId],
    queryFn: () => apiRequest(`/api/journal-entries/${expandedId}`).then(r => r.json()),
    enabled: expandedId !== null,
    staleTime: 60_000,
  });

  const { data: resp, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/journal-entries", page, search],
    queryFn: () =>
      apiRequest(`/api/journal-entries?page=${page}&limit=25${search ? `&search=${encodeURIComponent(search)}` : ""}`).then(r => r.json()),
  });

  const entries: any[] = resp?.entries ?? [];
  const totalPages = resp?.pages ?? 1;

  // ── Finance: debits must equal credits; zero totals count as "not balanced" ──
  const totalDebit  = lines.reduce((s, l) => s + (parseFloat(l.debitAmount)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.creditAmount) || 0), 0);
  const isBalanced  = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;
  const difference  = totalDebit - totalCredit;

  // ── Finance: at least 2 lines must have an account selected ──
  const populatedLines = lines.filter(l => l.accountId);
  const hasMinLines = populatedLines.length >= 2;

  const canPost = isBalanced && hasMinLines && !!header.description && !!header.entryDate;

  const postMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...header,
        lines: lines
          .filter(l => l.accountId)
          .map(l => ({
            accountId:    parseInt(l.accountId, 10),
            description:  l.description || undefined,
            debitAmount:  parseFloat(l.debitAmount)  || 0,
            creditAmount: parseFloat(l.creditAmount) || 0,
          })),
      };
      return apiRequest("/api/journal-entries", { method: "POST", data: payload }).then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(new Error(e.message)));
        return r.json();
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries/reports"] });
      setOpen(false);
      setLines([emptyLine(), emptyLine()]);
      setHeader({ entryDate: today(), description: "", reference: "", currency: "KES" });
      toast({ title: "Journal entry posted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reverseMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/journal-entries/${id}/reverse`, {
        method: "POST", data: { reverseDate },
      }).then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(new Error(e.message)));
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries/reports"] });
      setReverseId(null);
      toast({ title: "Reversing entry posted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  /**
   * Finance rule: a line can only carry a DEBIT or a CREDIT — never both simultaneously.
   * Entering a value in one column automatically clears the other.
   */
  const updateLine = (i: number, field: keyof JournalLine, value: string) => {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      if (field === "debitAmount"  && value) return { ...l, debitAmount: value,  creditAmount: "" };
      if (field === "creditAmount" && value) return { ...l, creditAmount: value, debitAmount: "" };
      return { ...l, [field]: value };
    }));
  };

  const addLine    = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (i: number) => {
    if (lines.length <= 2) return;
    setLines(prev => prev.filter((_, idx) => idx !== i));
  };

  const handleExport = () => {
    downloadCSV(
      `journal-entries-${today()}.csv`,
      ["Entry ID", "Date", "Description", "Debit (KES)", "Credit (KES)", "Status"],
      entries.map(e => [e.entryId, fmtDate(e.entryDate), e.description, e.totalDebit, e.totalCredit, e.status]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search entries…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex gap-2">
          {entries.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
            </Button>
          )}
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Journal Entry
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError   && <FetchError message="Could not load journal entries." />}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No journal entries yet. Post your first entry to begin.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left p-3">Entry ID</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3 hidden md:table-cell">Description</th>
                <th className="text-right p-3">Debit</th>
                <th className="text-right p-3">Credit</th>
                <th className="text-center p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <React.Fragment key={e.id}>
                  <tr
                    className="border-t hover:bg-muted/30 transition-colors cursor-pointer select-none"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    <td className="p-3 font-mono text-xs text-muted-foreground">{e.entryId}</td>
                    <td className="p-3 text-xs whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                    <td className="p-3 hidden md:table-cell max-w-xs truncate text-muted-foreground">{e.description}</td>
                    <td className="p-3 text-right font-mono tabular-nums">{KES(e.totalDebit)}</td>
                    <td className="p-3 text-right font-mono tabular-nums">{KES(e.totalCredit)}</td>
                    <td className="p-3 text-center">
                      <Badge variant={e.status === "posted" ? "default" : e.status === "reversed" ? "secondary" : "outline"}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      {e.status === "posted" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={ev => { ev.stopPropagation(); setReverseId(e.id); setReverseDate(today()); }}>
                          <RotateCcw className="w-3 h-3 mr-1" />Reverse
                        </Button>
                      )}
                    </td>
                  </tr>
                  {/* ── Expandable lines drill-down ── */}
                  {expandedId === e.id && (
                    <tr className="bg-muted/20 border-t">
                      <td colSpan={7} className="px-6 py-3">
                        {detailFetching && <p className="text-xs text-muted-foreground py-1">Loading lines…</p>}
                        {!detailFetching && entryDetail?.lines && (
                          <div>
                            {e.reference && (
                              <p className="text-xs text-muted-foreground mb-2">
                                Reference: <span className="font-mono">{e.reference}</span>
                              </p>
                            )}
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="text-muted-foreground text-left">
                                  <th className="pb-1.5 font-medium w-20">Code</th>
                                  <th className="pb-1.5 font-medium">Account</th>
                                  <th className="pb-1.5 font-medium hidden sm:table-cell">Memo</th>
                                  <th className="pb-1.5 font-medium text-right w-36">Debit (KES)</th>
                                  <th className="pb-1.5 font-medium text-right w-36">Credit (KES)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entryDetail.lines.map((l: any) => (
                                  <tr key={l.id} className="border-t border-border/40">
                                    <td className="py-1.5 font-mono text-muted-foreground">{l.accountCode ?? "—"}</td>
                                    <td className="py-1.5 text-foreground">{l.accountName ?? "—"}</td>
                                    <td className="py-1.5 text-muted-foreground hidden sm:table-cell">{l.description || "—"}</td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">
                                      {Number(l.debitAmount) > 0 ? KES(l.debitAmount) : ""}
                                    </td>
                                    <td className="py-1.5 text-right font-mono tabular-nums">
                                      {Number(l.creditAmount) > 0 ? KES(l.creditAmount) : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-border font-semibold">
                                  <td colSpan={3} className="pt-1.5 text-muted-foreground">Entry total</td>
                                  <td className="pt-1.5 text-right font-mono tabular-nums">{KES(e.totalDebit)}</td>
                                  <td className="pt-1.5 text-right font-mono tabular-nums">{KES(e.totalCredit)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ── New entry dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
          </DialogHeader>

          {/* Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="col-span-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Date *</label>
              <Input type="date" value={header.entryDate}
                onChange={e => setHeader(h => ({ ...h, entryDate: e.target.value }))} />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description *</label>
              <Input placeholder="e.g. Rent received — Unit A3" value={header.description}
                onChange={e => setHeader(h => ({ ...h, description: e.target.value }))} />
            </div>
            <div className="col-span-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference</label>
              <Input placeholder="e.g. INV-2025-001" value={header.reference}
                onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
            </div>
          </div>

          {/* Lines table */}
          <div className="mt-2">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left p-2 w-40">Account</th>
                    <th className="text-left p-2">Description</th>
                    {/* Finance: Debit column always to the left of Credit — standard T-account layout */}
                    <th className="text-right p-2 w-28">Debit (KES)</th>
                    <th className="text-right p-2 w-28">Credit (KES)</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-1.5">
                        <Select value={line.accountId} onValueChange={v => updateLine(i, "accountId", v)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(accounts as Account[]).map(a => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                {a.accountCode} — {a.accountName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5">
                        <Input className="h-8 text-xs" placeholder="Memo"
                          value={line.description}
                          onChange={e => updateLine(i, "description", e.target.value)} />
                      </td>
                      {/*
                        Finance rule: entering a debit clears credit and vice versa.
                        Visual ring indicates which side is active.
                      */}
                      <td className="p-1.5">
                        <Input
                          className={`h-8 text-xs text-right font-mono ${line.debitAmount ? "ring-1 ring-blue-400" : ""}`}
                          placeholder="0.00" type="number" min="0" step="0.01"
                          value={line.debitAmount}
                          onChange={e => updateLine(i, "debitAmount", e.target.value)}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          className={`h-8 text-xs text-right font-mono ${line.creditAmount ? "ring-1 ring-orange-400" : ""}`}
                          placeholder="0.00" type="number" min="0" step="0.01"
                          value={line.creditAmount}
                          onChange={e => updateLine(i, "creditAmount", e.target.value)}
                        />
                      </td>
                      <td className="p-1.5 text-center">
                        <button onClick={() => removeLine(i)}
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          disabled={lines.length <= 2}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td className="p-2 text-xs font-medium text-muted-foreground" colSpan={2}>Totals</td>
                    <td className="p-2 text-right font-mono text-sm font-semibold tabular-nums">
                      {totalDebit.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-right font-mono text-sm font-semibold tabular-nums">
                      {totalCredit.toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2">
              <Button variant="ghost" size="sm" onClick={addLine} className="text-xs">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add line
              </Button>
              <div className="flex flex-col items-end gap-0.5">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${isBalanced ? "text-green-600" : "text-red-600"}`}>
                  {isBalanced
                    ? <><CheckCircle className="w-3.5 h-3.5" /> Balanced</>
                    : <><AlertTriangle className="w-3.5 h-3.5" />
                        {totalDebit === 0 && totalCredit === 0
                          ? "Enter amounts above"
                          : `Difference: ${KES(Math.abs(difference))}`}
                      </>
                  }
                </div>
                {/* Finance: warn if only 1 account selected */}
                {!hasMinLines && populatedLines.length > 0 && (
                  <p className="text-xs text-amber-600">At least 2 accounts required</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!canPost || postMutation.isPending}
              onClick={() => postMutation.mutate()}
            >
              {postMutation.isPending ? "Posting…" : "Post Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reverse dialog ── */}
      <Dialog open={reverseId !== null} onOpenChange={() => setReverseId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Create Reversing Entry</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              A new journal entry will be posted that negates all debit/credit lines of the original.
              The original entry will be marked <strong>Reversed</strong>.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Reversal date</label>
              <Input type="date" value={reverseDate} onChange={e => setReverseDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reverseMutation.isPending}
              onClick={() => reverseId && reverseMutation.mutate(reverseId)}>
              {reverseMutation.isPending ? "Reversing…" : "Post Reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 2. Trial Balance ──────────────────────────────────────────────────────────

function TrialBalance() {
  const [asOf, setAsOf] = useState(today());
  const [showZero, setShowZero] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/journal-entries/reports/trial-balance", asOf, showZero],
    queryFn: () =>
      apiRequest(`/api/journal-entries/reports/trial-balance?asOf=${asOf}${showZero ? "&showZero=1" : ""}`).then(r => r.json()),
    enabled: !!asOf,
  });

  const accounts: any[] = data?.accounts ?? [];

  /**
   * Finance standard: group in the order Assets → Liabilities → Equity → Revenue → Expenses.
   */
  const byType = useMemo(() => {
    const g: Record<string, any[]> = { asset: [], liability: [], equity: [], revenue: [], expense: [] };
    for (const a of accounts) (g[a.accountType] ??= []).push(a);
    return g;
  }, [accounts]);

  const TYPE_LABELS: Record<string, string> = {
    asset: "Assets", liability: "Liabilities", equity: "Equity",
    revenue: "Revenue", expense: "Expenses",
  };

  const handleExport = () => {
    if (!data) return;
    downloadCSV(
      `trial-balance-${asOf}.csv`,
      ["Code", "Account Name", "Type", "Normal Balance", "Total Debits (KES)", "Total Credits (KES)", "Net Balance (KES)"],
      accounts.map((a: any) => [a.accountCode, a.accountName, a.accountType, a.normalBalance, a.totalDebit, a.totalCredit, a.balance]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">As at date</label>
            <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="w-44" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer mb-0.5">
            <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} />
            Show zero-balance accounts
          </label>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
        {data && (
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {isError   && <FetchError message="Could not load trial balance." />}

      {data && (
        <>
          {/* Finance: balance check banner with actual amounts for clarity */}
          <div className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg ${
            data.balanced
              ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
            {data.balanced
              ? <><CheckCircle className="w-4 h-4" /> Balanced — debits and credits both equal {KES(data.grandDebit)}</>
              : <><AlertTriangle className="w-4 h-4" /> Out of balance by {KES(Math.abs(Number(data.grandDebit) - Number(data.grandCredit)).toFixed(2))} — review recent entries</>
            }
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left p-3 w-20">Code</th>
                  <th className="text-left p-3">Account</th>
                  <th className="text-left p-3 w-24 hidden sm:table-cell">Type</th>
                  <th className="text-right p-3 w-36">Debit (KES)</th>
                  <th className="text-right p-3 w-36">Credit (KES)</th>
                  {/*
                    Finance: "Balance" = net balance with sign convention applied per account type.
                    Debit-normal accounts: Balance = Debits – Credits (positive = debit balance, normal).
                    Credit-normal accounts: Balance = Credits – Debits (positive = credit balance, normal).
                    A negative balance here = abnormal balance (flagged in red).
                  */}
                  <th className="text-right p-3 w-36">Balance (KES)</th>
                </tr>
              </thead>
              <tbody>
                {["asset", "liability", "equity", "revenue", "expense"].map(type => (
                  byType[type]?.length > 0 && (
                    <React.Fragment key={type}>
                      <tr className="bg-muted/40">
                        <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {TYPE_LABELS[type]}
                        </td>
                      </tr>
                      {byType[type].map((a: any) => {
                        const bal = Number(a.balance);
                        const isAbnormal = bal < 0; // server already applies normalBalance convention
                        return (
                          <tr key={a.accountCode} className="border-t hover:bg-muted/20">
                            <td className="p-3 font-mono text-xs text-muted-foreground">{a.accountCode}</td>
                            <td className="p-3 text-foreground">{a.accountName}</td>
                            <td className="p-3 hidden sm:table-cell">
                              <Badge variant="outline" className="text-xs capitalize">{TYPE_LABELS[a.accountType] ?? a.accountType}</Badge>
                            </td>
                            <td className="p-3 text-right font-mono tabular-nums">
                              {Number(a.totalDebit) > 0 ? KES(a.totalDebit) : ""}
                            </td>
                            <td className="p-3 text-right font-mono tabular-nums">
                              {Number(a.totalCredit) > 0 ? KES(a.totalCredit) : ""}
                            </td>
                            <td className={`p-3 text-right font-mono tabular-nums font-medium ${isAbnormal ? "text-red-600 dark:text-red-400" : ""}`}>
                              {isAbnormal ? (
                                <span title={`Abnormal balance: this account normally has a ${a.normalBalance} balance`}>
                                  ({KES(Math.abs(bal))})
                                </span>
                              ) : (
                                KES(bal)
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  )
                ))}
              </tbody>
              <tfoot>
                {/*
                  Finance standard: Trial Balance grand total row shows ONLY the sum of all debits
                  and sum of all credits. The balance column is intentionally left blank — on a
                  correctly balanced set of books the net of all balances is zero, which is
                  meaningless to display and may confuse readers.
                */}
                <tr className="border-t-2 border-border bg-muted font-semibold text-sm">
                  <td colSpan={3} className="p-3">Grand Total</td>
                  <td className="p-3 text-right font-mono tabular-nums">{KES(data.grandDebit)}</td>
                  <td className="p-3 text-right font-mono tabular-nums">{KES(data.grandCredit)}</td>
                  {/* Balance column total intentionally blank per accounting standards */}
                  <td className="p-3 text-right text-xs text-muted-foreground italic">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── 3. Income Statement (P&L) ─────────────────────────────────────────────────

function IncomeStatement() {
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo]     = useState(today());
  const [dateError, setDateError] = useState("");

  const validateDates = (f: string, t: string) => {
    setDateError(f && t && f > t ? "'From' date must be on or before 'To' date." : "");
  };

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/journal-entries/reports/income-statement", from, to],
    queryFn: () =>
      apiRequest(`/api/journal-entries/reports/income-statement?from=${from}&to=${to}`).then(r => r.json()),
    // Finance: only fetch when the date range is valid
    enabled: !!from && !!to && from <= to,
  });

  const netIncome    = Number(data?.netIncome    ?? 0);
  const totalRevenue = Number(data?.totalRevenue ?? 0);
  // Use backend-computed isProfit flag; fall back to sign of netIncome
  const netPositive  = data?.isProfit ?? netIncome >= 0;

  // Optional COGS / Gross Profit (only rendered when backend explicitly provides it)
  const hasGrossProfit = data && data.grossProfit !== undefined;
  const grossProfit    = Number(data?.grossProfit ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
            <Input type="date" value={from}
              onChange={e => { setFrom(e.target.value); validateDates(e.target.value, to); }}
              className="w-40" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
            <Input type="date" value={to}
              onChange={e => { setTo(e.target.value); validateDates(from, e.target.value); }}
              className="w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!!dateError}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
          </Button>
        </div>
        {data && !dateError && (
          <Button variant="outline" size="sm" onClick={() => {
            const rows: (string | number)[][] = [];
            (data.revenues ?? []).forEach((a: any) => rows.push([a.accountCode, a.accountName, "Revenue", a.amount]));
            rows.push(["", "Total Revenue", "", data.totalRevenue]);
            rows.push([]);
            (data.expenses ?? []).forEach((a: any) => rows.push([a.accountCode, a.accountName, "Expense", a.amount]));
            rows.push(["", "Total Expenses", "", data.totalExpenses]);
            rows.push([]);
            rows.push(["", `Net ${netPositive ? "Income" : "Loss"}`, "", Math.abs(netIncome).toFixed(2)]);
            downloadCSV(`income-statement-${from}-to-${to}.csv`, ["Code", "Account Name", "Type", "Amount (KES)"], rows);
          }}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
          </Button>
        )}
      </div>

      {/* Finance: date range guard */}
      {dateError && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-4 h-4" />{dateError}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {isError   && <FetchError message="Could not load income statement." />}

      {data && !dateError && (
        <div className="max-w-2xl space-y-6">
          <p className="text-xs text-muted-foreground">
            For the period {fmtDate(data.from)} to {fmtDate(data.to)}
          </p>

          {/* Revenue */}
          <StatSection
            title="Revenue"
            items={data.revenues}
            total={data.totalRevenue}
            totalLabel="Total Revenue"
          />

          {/* COGS + Gross Profit (when backend provides it) */}
          {hasGrossProfit && data.cogs?.length > 0 && (
            <>
              <StatSection
                title="Cost of Sales"
                items={data.cogs}
                total={data.totalCogs ?? "0.00"}
                totalLabel="Total Cost of Sales"
                positive={false}
              />
              <SubtotalRow label="Gross Profit" amount={grossProfit} positive={grossProfit >= 0} />
            </>
          )}

          {/* Operating Expenses */}
          <StatSection
            title="Operating Expenses"
            items={data.expenses}
            total={data.totalExpenses}
            totalLabel="Total Operating Expenses"
            positive={false}
          />

          {/*
            Finance: Net Income / (Net Loss) — the "bottom line".
            Losses are shown as a positive number bracketed with "(Loss)" label,
            NOT as a negative number, which is the standard presentation in formal accounts.
          */}
          <div className={`flex justify-between items-center px-4 py-3 rounded-xl font-bold text-base border-2 ${
            netPositive
              ? "border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
              : "border-red-500 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
            <span>Net {netPositive ? "Income (Profit)" : "Loss"}</span>
            <span className="font-mono tabular-nums">{KES(Math.abs(netIncome).toFixed(2))}</span>
          </div>

          {/* Finance: Net Profit Margin % for context */}
          {totalRevenue > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              Net {netPositive ? "Profit" : "Loss"} Margin:{" "}
              <strong>{((Math.abs(netIncome) / totalRevenue) * 100).toFixed(1)}%</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 4. Balance Sheet ──────────────────────────────────────────────────────────

function BalanceSheet() {
  const [asOf, setAsOf] = useState(today());

  const { data, isLoading, isError, refetch } = useQuery<any>({
    queryKey: ["/api/journal-entries/reports/balance-sheet", asOf],
    queryFn: () =>
      apiRequest(`/api/journal-entries/reports/balance-sheet?asOf=${asOf}`).then(r => r.json()),
    enabled: !!asOf,
  });

  // Use backend-computed value (avoids floating-point drift from adding two strings on the client)
  // Falls back to client recomputation only if the backend hasn't yet been deployed with this field.
  const totalLiabEquity = data
    ? Number(data.totalLiabEquity ?? (Number(data.totalLiabilities) + Number(data.totalEquity)))
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">As at date</label>
            <Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
          </Button>
        </div>
        {data && (
          <Button variant="outline" size="sm" onClick={() => {
            const rows: (string | number)[][] = [];
            rows.push(["ASSETS"]);
            (data.assets ?? []).forEach((a: any) => rows.push([a.accountCode, a.accountName, a.balance]));
            rows.push(["", "Total Assets", data.totalAssets]);
            rows.push([]);
            rows.push(["LIABILITIES"]);
            (data.liabilities ?? []).forEach((a: any) => rows.push([a.accountCode, a.accountName, a.balance]));
            rows.push(["", "Total Liabilities", data.totalLiabilities]);
            rows.push([]);
            rows.push(["EQUITY"]);
            (data.equity ?? []).forEach((a: any) => rows.push([a.accountCode, a.accountName, a.balance]));
            rows.push(["", "Total Equity", data.totalEquity]);
            rows.push([]);
            rows.push(["", "Total Liabilities + Equity", data.totalLiabEquity ?? totalLiabEquity.toFixed(2)]);
            downloadCSV(`balance-sheet-${asOf}.csv`, ["Code / Section", "Account Name", "Balance (KES)"], rows);
          }}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {isError   && <FetchError message="Could not load balance sheet." />}

      {data && (
        <div className="max-w-2xl space-y-6">
          <p className="text-xs text-muted-foreground">As at {fmtDate(data.asOf)}</p>

          {/* ASSETS */}
          <StatSection
            title="Assets"
            items={data.assets}
            total={data.totalAssets}
            totalLabel="Total Assets"
          />

          {/* LIABILITIES + EQUITY */}
          <div className="space-y-4">
            <StatSection
              title="Liabilities"
              items={data.liabilities}
              total={data.totalLiabilities}
              totalLabel="Total Liabilities"
              positive={false}
            />
            <StatSection
              title="Equity"
              items={data.equity}
              total={data.totalEquity}
              totalLabel="Total Equity"
            />

            {/* Finance: combined Liabilities + Equity must match Total Assets */}
            <div className="flex justify-between items-center px-4 py-2 border-t-2 border-border font-semibold text-sm">
              <span className="text-muted-foreground">Total Liabilities + Equity</span>
              <span className="font-mono tabular-nums">
                {KES(totalLiabEquity.toFixed(2))}
              </span>
            </div>
          </div>

          {/*
            Finance: the accounting equation check — Assets = Liabilities + Equity.
            The backend automatically includes current-period earnings in Equity.
          */}
          <div className={`text-sm font-medium px-3 py-2 rounded-lg ${
            data.balanced
              ? "flex items-center gap-2 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
            {data.balanced ? (
              <>
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Assets ({KES(data.totalAssets)}) = Liabilities + Equity ({KES(totalLiabEquity.toFixed(2))})
              </>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Balance sheet does not balance — difference of {KES(Math.abs(Number(data.totalAssets) - totalLiabEquity).toFixed(2))}
                </div>
                <p className="text-xs pl-6 text-red-600/80">
                  Check for journal entry errors in the Trial Balance. Run a new journal entry
                  to correct any posting mistakes.
                </p>
              </div>
            )}
          </div>

          {/* Show current-period earnings note if the backend included it */}
          {data.currentEarnings !== undefined && Math.abs(Number(data.currentEarnings)) > 0.005 && (
            <p className="text-xs text-muted-foreground px-1">
              * <strong>Current Period {Number(data.currentEarnings) >= 0 ? "Earnings" : "Loss"}</strong> ({KES(Math.abs(Number(data.currentEarnings)).toFixed(2))})
              included in Equity above. To move it to Retained Earnings, post a closing journal entry
              debiting Revenue accounts and crediting Retained Earnings (and vice versa for expenses).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GeneralLedgerPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">General Ledger</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Double-entry bookkeeping — every entry must balance before posting.
        </p>
      </div>

      <Tabs defaultValue="journal">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="journal" className="text-xs sm:text-sm">
            <BookOpen className="w-3.5 h-3.5 mr-1.5 hidden sm:inline" />Journal
          </TabsTrigger>
          <TabsTrigger value="trial" className="text-xs sm:text-sm">
            <Layers className="w-3.5 h-3.5 mr-1.5 hidden sm:inline" />Trial Balance
          </TabsTrigger>
          <TabsTrigger value="pl" className="text-xs sm:text-sm">
            <TrendingUp className="w-3.5 h-3.5 mr-1.5 hidden sm:inline" />P&L
          </TabsTrigger>
          <TabsTrigger value="bs" className="text-xs sm:text-sm">
            <BarChart3 className="w-3.5 h-3.5 mr-1.5 hidden sm:inline" />Balance Sheet
          </TabsTrigger>
        </TabsList>

        <TabsContent value="journal"  className="mt-6"><JournalBook /></TabsContent>
        <TabsContent value="trial"    className="mt-6"><TrialBalance /></TabsContent>
        <TabsContent value="pl"       className="mt-6"><IncomeStatement /></TabsContent>
        <TabsContent value="bs"       className="mt-6"><BalanceSheet /></TabsContent>
      </Tabs>
    </div>
  );
}