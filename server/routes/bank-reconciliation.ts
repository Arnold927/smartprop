/**
 * bank-reconciliation.ts
 * Mounted at /api/bank-reconciliation
 *
 * Endpoints:
 *   GET    /imports                  List all statement imports for the org
 *   POST   /imports                  Upload + parse a bank statement CSV
 *   GET    /imports/:id/rows         Get individual rows for an import (with match status)
 *   GET    /imports/:id/summary      Matched / unmatched totals for an import
 *   POST   /rows/:rowId/match        Manually link a row to a rent payment
 *   POST   /rows/:rowId/ignore       Mark a row as intentionally ignored
 *   POST   /rows/:rowId/unmatch      Revert a match back to unmatched
 *   POST   /imports/:id/auto-match   Run the auto-matching algorithm over an import
 *   GET    /unmatched                All unmatched rows across the org (arrears dashboard)
 *   GET    /bank-names               List supported bank names + column-format hints
 *
 * CSV column mapping supports the following banks out of the box:
 *   equity, kcb, cooperative, stanbic, ncba, absa, dtb, im, standard_chartered, family, gt, prime
 *   and "generic" (date, description, amount, reference)
 *
 * Auto-match algorithm:
 *   1. Exact reference match (parsed_reference == invoiceNumber or bankReference)
 *   2. Amount + date window match (±7 days of due date, amount matches to the cent)
 *   3. Amount + payer name fuzzy match (tenant name similarity ≥ 0.7)
 *   Results scored 0–100; score ≥ 80 auto-applies; 50–79 surfaces as "suggested".
 */

import { Router }          from "express";
import { z }               from "zod";
import { db }              from "../db";
import {
  bankStatementImports,
  bankStatementRows,
  rentPayments,
  tenants,
  units,
  ownerStatements,
  properties,
  users,
  paymentReceipts,
} from "@shared/schema";
import { eq, and, or, desc, asc, sql, inArray, gte, lte } from "drizzle-orm";
import { applyPayment, reverseReceipt, rentBalances, round2, EPS, PaymentRuleError } from "../services/rent-ledger";
import { authenticateJWT }  from "../middleware/auth";
import { requireOrg }       from "../middleware/requireOrg";
import { auditLog }         from "../middleware/auditLog";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// ─── Supported bank formats ───────────────────────────────────────────────────

export const BANK_FORMATS: Record<string, {
  label:       string;
  country:     string;
  csvHint:     string;
  colMap:      Record<string, string[]>;   // canonical name → possible CSV headers
}> = {
  equity: {
    label: "Equity Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance (EazzyBiz / Internet Banking export)",
    colMap: {
      date:        ["transaction date", "date", "trans date", "value date"],
      description: ["description", "narration", "transaction description", "details"],
      debit:       ["debit", "debit amount", "dr", "withdrawals"],
      credit:      ["credit", "credit amount", "cr", "deposits"],
      balance:     ["balance", "running balance", "available balance"],
      reference:   ["reference", "ref", "transaction ref", "chq/ref no"],
    },
  },
  kcb: {
    label: "KCB Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance (KCB Internet Banking / Connect export)",
    colMap: {
      date:        ["date", "transaction date", "posting date"],
      description: ["description", "details", "transaction details", "narration"],
      debit:       ["debit", "debit amount", "dr amount", "withdrawal"],
      credit:      ["credit", "credit amount", "cr amount", "deposit"],
      balance:     ["balance", "running balance", "book balance"],
      reference:   ["reference no", "reference", "ref", "chq no"],
    },
  },
  cooperative: {
    label: "Co-operative Bank",
    country: "KE",
    csvHint: "Date, Description, Withdrawals, Deposits, Balance (Co-op Online Banking export)",
    colMap: {
      date:        ["value date", "date", "trans date"],
      description: ["transaction description", "description", "narration"],
      debit:       ["withdrawals", "debit", "dr"],
      credit:      ["deposits", "credit", "cr"],
      balance:     ["balance", "running balance"],
      reference:   ["ref no.", "reference", "ref"],
    },
  },
  stanbic: {
    label: "Stanbic Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["transaction date", "date", "posting date"],
      description: ["description", "narrative", "transaction description"],
      debit:       ["debit amount", "debit", "dr"],
      credit:      ["credit amount", "credit", "cr"],
      balance:     ["balance", "ledger balance"],
      reference:   ["reference", "ref", "transaction ref"],
    },
  },
  ncba: {
    label: "NCBA Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance (NCBA Online export)",
    colMap: {
      date:        ["date", "transaction date"],
      description: ["description", "transaction description", "narration"],
      debit:       ["debit", "debit amount"],
      credit:      ["credit", "credit amount"],
      balance:     ["balance"],
      reference:   ["reference", "ref no", "cheque no"],
    },
  },
  absa: {
    label: "Absa Bank Kenya",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["transaction date", "value date", "date"],
      description: ["transaction description", "description", "narrative"],
      debit:       ["debit amount", "debit", "dr"],
      credit:      ["credit amount", "credit", "cr"],
      balance:     ["balance", "closing balance"],
      reference:   ["cheque number", "reference", "ref"],
    },
  },
  dtb: {
    label: "Diamond Trust Bank (DTB)",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["date", "trans date", "value date"],
      description: ["description", "narration", "transaction description"],
      debit:       ["debit", "dr amount", "withdrawals"],
      credit:      ["credit", "cr amount", "deposits"],
      balance:     ["balance"],
      reference:   ["reference", "ref", "doc no."],
    },
  },
  im: {
    label: "I&M Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["value date", "date", "posting date"],
      description: ["particulars", "description", "transaction description"],
      debit:       ["debit", "dr", "debit amount"],
      credit:      ["credit", "cr", "credit amount"],
      balance:     ["balance"],
      reference:   ["cheque no.", "reference", "ref"],
    },
  },
  standard_chartered: {
    label: "Standard Chartered Kenya",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["transaction date", "date"],
      description: ["description", "transaction description"],
      debit:       ["debit", "debit amount"],
      credit:      ["credit", "credit amount"],
      balance:     ["balance"],
      reference:   ["reference", "ref"],
    },
  },
  family: {
    label: "Family Bank",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["date", "trans date"],
      description: ["description", "narration"],
      debit:       ["debit", "dr"],
      credit:      ["credit", "cr"],
      balance:     ["balance"],
      reference:   ["reference", "ref no."],
    },
  },
  prime: {
    label: "Prime Bank Kenya",
    country: "KE",
    csvHint: "Date, Description, Debit, Credit, Balance",
    colMap: {
      date:        ["date", "transaction date"],
      description: ["description", "narration"],
      debit:       ["debit", "dr amount"],
      credit:      ["credit", "cr amount"],
      balance:     ["balance"],
      reference:   ["ref", "reference"],
    },
  },
  generic: {
    label: "Generic / Other Bank",
    country: "ANY",
    csvHint: "Required columns: date, description, amount (positive = money in). Optional: reference, payer_name, balance",
    colMap: {
      date:        ["date", "transaction date", "trans date", "value date"],
      description: ["description", "narration", "details", "particulars", "transaction description"],
      debit:       ["debit", "dr", "debit amount", "withdrawals"],
      credit:      ["credit", "cr", "credit amount", "deposits"],
      amount:      ["amount", "net amount"],
      balance:     ["balance", "running balance"],
      reference:   ["reference", "ref", "ref no", "transaction ref"],
      payer_name:  ["payer", "payer name", "sender", "from"],
    },
  },
};

// ─── CSV parsing utilities ────────────────────────────────────────────────────

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Find header line — first line with ≥3 comma-separated tokens
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (lines[i].split(",").length >= 3) { headerIdx = i; break; }
  }
  const headers = lines[headerIdx]
    .split(",")
    .map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());

  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]);
    if (vals.every(v => !v.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").replace(/^"|"$/g, "").trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line: string): string[] {
  const res: string[] = [];
  let cur = "", inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { res.push(cur); cur = ""; }
    else { cur += ch; }
  }
  res.push(cur);
  return res;
}

function resolveCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const v = row[c];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function parseMoney(v: string): number {
  if (!v) return 0;
  const t = v.trim();
  // accounting style negatives: (1,500.00)
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /\bDR\b$/i.test(t);
  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** A calendar date that really exists (31/02/2026 is not one) and is plausible for a bank statement. */
function realYmd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function parseDate(v: string): string | null {
  if (!v) return null;
  const c = v.trim();
  // ISO (a time part, if any, is ignored)
  let m = c.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return realYmd(+m[1], +m[2], +m[3]);
  // Kenyan banks write day first: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  m = c.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[T\s].*)?$/);
  if (m) return realYmd(+m[3], +m[2], +m[1]);
  // 01 Jan 2026 / 01-Jan-26
  m = c.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{2}|\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return realYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], mi + 1, +m[1]);
  }
  return null;
}

function cleanReference(raw: string): string {
  // Strip noise common in Kenyan bank references:
  // "FT2400123456/JOHN DOE" → extract alphanumeric reference
  if (!raw) return "";
  // Strip leading/trailing whitespace and common noise words
  let r = raw.trim()
    .replace(/^(ft|ref|chq|cheque|rtgs|eft|neft|imps|upi)[\/\-\s]*/i, "")
    .replace(/\/.*$/, "")              // strip everything after first slash
    .replace(/\s+.*$/, "")            // strip everything after first space (often payer name)
    .toUpperCase();
  return r.slice(0, 50);
}

function mapRowsForBank(
  csvRows: Record<string, string>[],
  bankName: string,
): Array<{
  transactionDate: string | null;
  description: string;
  debitAmount: number;
  creditAmount: number;
  amount: number;
  runningBalance: number | null;
  rawReference: string;
  parsedReference: string;
  payerName: string;
}> {
  const fmt = BANK_FORMATS[bankName] ?? BANK_FORMATS["generic"];
  const colMap = fmt.colMap;

  return csvRows.map(row => {
    const dateRaw   = resolveCol(row, colMap.date        ?? []);
    const descRaw   = resolveCol(row, colMap.description ?? []);
    const debitRaw  = resolveCol(row, colMap.debit       ?? []);
    const creditRaw = resolveCol(row, colMap.credit      ?? []);
    const amtRaw    = resolveCol(row, colMap.amount      ?? []);
    const balRaw    = resolveCol(row, colMap.balance     ?? []);
    const refRaw    = resolveCol(row, colMap.reference   ?? []);
    const payerRaw  = resolveCol(row, colMap.payer_name  ?? []);

    const debit  = parseMoney(debitRaw);
    const credit = parseMoney(creditRaw);

    let amount: number;
    if (amtRaw) {
      amount = parseMoney(amtRaw);
    } else if (credit > 0 || debit > 0) {
      amount = credit - debit;  // positive = money in (rent received)
    } else {
      amount = 0;
    }

    // Try to pull reference from description if not in its own column
    let rawRef = refRaw || "";
    if (!rawRef && descRaw) {
      // extract alphanumeric token after common prefixes
      const m = descRaw.match(/\b(?=[A-Z0-9]*\d)([A-Z0-9]{6,20})\b/);   // must contain a digit — "TRANSFER" is not a reference
      if (m) rawRef = m[1];
    }

    return {
      transactionDate: parseDate(dateRaw),
      description:     descRaw || "",
      debitAmount:     debit,
      creditAmount:    credit,
      amount,
      runningBalance:  balRaw ? parseMoney(balRaw) : null,
      rawReference:    rawRef,
      parsedReference: cleanReference(rawRef || descRaw),
      payerName:       payerRaw || "",
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class ReconError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

function fail(res: any, err: any, fallback: string) {
  if (err instanceof ReconError) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err instanceof PaymentRuleError) return res.status(409).json({ message: err.message, code: err.code, ...err.extra });
  if (err?.name === "ZodError") return res.status(400).json({ message: err.errors?.[0]?.message ?? "Invalid request", errors: err.errors });
  console.error("[bank-recon]", fallback, err);
  return res.status(500).json({ message: fallback });
}

const num = (v: any) => Number(v ?? 0);
const posInt = (v: any) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const OWS = "OWS:";   // bank_statement_rows.payer_account holds "OWS:<statementId>" on a row matched to an owner payout

/** Keep import_id counts honest after any change to a row. */
async function refreshCounts(importId: number) {
  const [c] = await db
    .select({
      matched:   sql<number>`COUNT(*) FILTER (WHERE match_status = 'matched')`,
      unmatched: sql<number>`COUNT(*) FILTER (WHERE match_status IN ('unmatched','suggested'))`,
    })
    .from(bankStatementRows)
    .where(eq(bankStatementRows.importId, importId));
  await db.update(bankStatementImports)
    .set({ matchedCount: Number(c.matched), unmatchedCount: Number(c.unmatched), updatedAt: new Date().toISOString() })
    .where(eq(bankStatementImports.id, importId));
}

async function loadRow(orgId: number, rowId: number) {
  const [row] = await db.select().from(bankStatementRows)
    .where(and(eq(bankStatementRows.id, rowId), eq(bankStatementRows.organizationId, orgId))).limit(1);
  if (!row) throw new ReconError(404, "Transaction not found");
  return row;
}

interface OpenInvoice {
  id: number; amount: number; balance: number; dueDate: string; invoiceNumber: string | null; bankReference: string | null;
  status: string; tenantId: number; tenantName: string; unitNumber: string | null;
}

/** Every invoice in the org that can still take money (pending / overdue / part paid) with what is still owed on it. */
async function openInvoices(orgId: number): Promise<OpenInvoice[]> {
  const rows = await db
    .select({
      id: rentPayments.id, amount: rentPayments.amount, dueDate: rentPayments.dueDate,
      invoiceNumber: rentPayments.invoiceNumber, bankReference: rentPayments.bankReference,
      status: rentPayments.status, tenantId: rentPayments.tenantId,
      firstName: tenants.firstName, lastName: tenants.lastName, unitNumber: units.unitNumber,
    })
    .from(rentPayments)
    .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
    .leftJoin(units, eq(tenants.unitId, units.id))
    .where(and(eq(tenants.organizationId, orgId), inArray(rentPayments.status, ["pending", "overdue", "partial"])));
  const bal = await rentBalances(rows.map(r => ({ id: r.id, amount: r.amount, status: r.status })));
  return rows
    .map(r => ({
      id: r.id, amount: num(r.amount), balance: bal.get(r.id)?.balance ?? num(r.amount),
      dueDate: String(r.dueDate), invoiceNumber: r.invoiceNumber, bankReference: r.bankReference,
      status: r.status ?? "pending", tenantId: r.tenantId,
      tenantName: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(), unitNumber: r.unitNumber ?? null,
    }))
    .filter(r => r.balance > EPS);
}

// ─── Auto-match algorithm ─────────────────────────────────────────────────────

interface MatchCandidate { invoice: OpenInvoice; score: number; method: string }

/**
 * Score one bank credit against one open invoice.
 *  - reference: the bank reference IS (or contains) the invoice number / bank reference — only trusted from 5 characters up,
 *    and never against an invoice that has no number (an empty string "is contained in" everything).
 *  - amount + date: the credit equals what is still owed and lands near the due date
 *  - amount + name: the credit equals what is still owed and the payer's name matches the tenant
 */
function scoreRow(row: typeof bankStatementRows.$inferSelect, c: OpenInvoice): { score: number; method: string } | null {
  const amount = num(row.amount);
  let score = 0, method = "";

  const ref = (row.parsedReference ?? "").toUpperCase();
  const inv = (c.invoiceNumber ?? "").toUpperCase();
  const bkr = (c.bankReference ?? "").toUpperCase();
  if (ref.length >= 5 && ((bkr && ref === bkr) || (inv && (ref === inv || (inv.length >= 5 && ref.includes(inv)) || (ref.length >= 8 && inv.includes(ref)))))) {
    score = 95; method = "auto_exact_ref";
  }

  const sameAmount = Math.abs(c.balance - amount) < EPS;
  if (score < 80 && sameAmount) {
    const days = Math.abs((new Date(row.transactionDate).getTime() - new Date(c.dueDate).getTime()) / 86400000);
    if (days <= 7)       { score = 88; method = "auto_amount_date_7d"; }
    else if (days <= 14) { score = 75; method = "auto_amount_date_14d"; }
    else if (days <= 31) { score = 55; method = "auto_amount_date_31d"; }
  }

  if (score < 60 && sameAmount && row.payerName) {
    const words = c.tenantName.toLowerCase().split(/\s+/).filter(Boolean);
    const payer = row.payerName.toLowerCase();
    const hits = words.filter(w => w.length > 2 && payer.includes(w));
    const sim = words.length ? hits.length / words.length : 0;
    if (sim >= 0.6) { score = Math.round(50 + sim * 30); method = "auto_amount_name"; }
  }
  return score > 0 ? { score, method } : null;
}

/** Best candidate for a row. When several invoices tie, the bank row cannot say which one it is — never guess with money. */
function bestMatch(row: typeof bankStatementRows.$inferSelect, pool: OpenInvoice[]): MatchCandidate | null {
  const scored: MatchCandidate[] = [];
  for (const c of pool) { const s = scoreRow(row, c); if (s) scored.push({ invoice: c, ...s }); }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tied = scored.filter(x => x.score === top.score).length > 1;
  if (tied) return { ...top, score: Math.min(top.score, 70), method: "auto_ambiguous" };
  return top;
}

/**
 * Put one bank credit on one invoice. The row is claimed first (only an unmatched/suggested row can be claimed, so two
 * clicks or two users cannot both apply it), then the money goes through the same ledger as every other payment:
 * one receipt (BANK-<row id>, unique), invoice status from what has really been paid, general-ledger entries.
 * If applying fails the claim is released.
 */
async function matchRowToInvoice(
  row: typeof bankStatementRows.$inferSelect, invoiceId: number,
  o: { actorId: string | null; method: string; confidence: number; notes?: string | null },
) {
  const amount = num(row.amount);
  if (!(amount > 0)) throw new ReconError(400, "Only money received (a credit) can be matched to a rent invoice.");
  const now = new Date().toISOString();
  const claimed = await db.update(bankStatementRows).set({
    matchStatus: "matched", matchedRentPaymentId: invoiceId, matchConfidence: o.confidence, matchMethod: o.method,
    matchedBy: o.actorId, matchedAt: now, reconcileNotes: o.notes ?? null, updatedAt: now,
  }).where(and(eq(bankStatementRows.id, row.id), eq(bankStatementRows.organizationId, row.organizationId), inArray(bankStatementRows.matchStatus, ["unmatched", "suggested"])))
    .returning({ id: bankStatementRows.id });
  if (!claimed.length) throw new ReconError(409, "This transaction has already been matched or ignored. Refresh the page.");

  try {
    const result = await applyPayment({
      target: { kind: "rent", id: invoiceId },
      amount,
      method: "bank_transfer",
      paidDate: row.transactionDate,
      reference: row.parsedReference || row.rawReference || null,
      receiptNumber: `BANK-${row.id}`,
      notes: o.notes ?? null,
      actorUserId: o.actorId,
      allowOverpay: true,           // the money really arrived — record it, flag the excess
    });
    if (!result.applied) throw new ReconError(409, "That invoice is already fully paid, so this transaction cannot be applied to it.");
    return result;
  } catch (e) {
    await db.update(bankStatementRows).set({
      matchStatus: row.matchStatus, matchedRentPaymentId: row.matchedRentPaymentId, matchConfidence: row.matchConfidence,
      matchMethod: row.matchMethod, matchedBy: null, matchedAt: null, reconcileNotes: row.reconcileNotes, updatedAt: new Date().toISOString(),
    }).where(eq(bankStatementRows.id, row.id));
    throw e;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /bank-names
router.get("/bank-names", (_req: any, res: any) => {
  res.json(Object.entries(BANK_FORMATS).map(([key, v]) => ({ key, label: v.label, country: v.country, csvHint: v.csvHint })));
});

// GET /imports — list all imports for org
router.get("/imports", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const imports = await db.select().from(bankStatementImports)
      .where(eq(bankStatementImports.organizationId, orgId))
      .orderBy(desc(bankStatementImports.createdAt));
    res.json(imports);
  } catch (err) { fail(res, err, "Failed to fetch imports"); }
});

// GET /open-invoices?amount=&q= — what a bank credit can be matched to: pending, overdue AND part-paid invoices,
// with the balance still owed, closest amount first.
router.get("/open-invoices", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const amount = req.query.amount ? Number(req.query.amount) : null;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    let list = await openInvoices(orgId);
    if (q) list = list.filter(i => `${i.tenantName} ${i.unitNumber ?? ""} ${i.invoiceNumber ?? ""}`.toLowerCase().includes(q));
    if (amount && Number.isFinite(amount)) list.sort((a, b) => Math.abs(a.balance - amount) - Math.abs(b.balance - amount) || a.dueDate.localeCompare(b.dueDate));
    else list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    res.json(list.slice(0, 100));
  } catch (err) { fail(res, err, "Failed to fetch invoices"); }
});

// GET /payout-candidates?amount= — approved / sent owner statements waiting to be paid out
router.get("/payout-candidates", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const amount = req.query.amount ? Math.abs(Number(req.query.amount)) : null;
    const rows = await db
      .select({
        id: ownerStatements.id, statementNumber: ownerStatements.statementNumber, status: ownerStatements.status,
        periodMonth: ownerStatements.periodMonth, periodYear: ownerStatements.periodYear, netPayable: ownerStatements.netPayable,
        propertyName: properties.name, ownerFirstName: users.firstName, ownerLastName: users.lastName,
      })
      .from(ownerStatements)
      .leftJoin(properties, eq(ownerStatements.propertyId, properties.id))
      .leftJoin(users, eq(ownerStatements.ownerUserId, users.id))
      .where(and(eq(ownerStatements.organizationId, orgId), inArray(ownerStatements.status, ["approved", "sent"])));
    const list = rows.filter(r => num(r.netPayable) > 0);
    if (amount && Number.isFinite(amount)) list.sort((a, b) => Math.abs(num(a.netPayable) - amount) - Math.abs(num(b.netPayable) - amount));
    res.json(list.slice(0, 100));
  } catch (err) { fail(res, err, "Failed to fetch statements"); }
});

// POST /imports — upload + parse a CSV bank statement
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");
const uploadSchema = z.object({
  bankName:             z.string().min(1).max(60),
  accountName:          z.string().max(120).optional(),
  accountNumber:        z.string().max(50).optional(),
  statementPeriodFrom:  ymd.optional().or(z.literal("")),
  statementPeriodTo:    ymd.optional().or(z.literal("")),
  fileName:             z.string().max(255).optional(),
  notes:                z.string().max(2000).optional(),
  csvData:              z.string().min(10).max(5_000_000, "That file is too large — import one month or one account at a time."),
});
const MAX_ROWS = 5000;

/** Two statement lines are "the same transaction" when date, amount, balance and what the bank printed all agree. */
const rowKey = (r: { transactionDate: string | null; amount: number; runningBalance: number | null; rawReference: string; description: string }) =>
  [r.transactionDate, r.amount.toFixed(2), r.runningBalance == null ? "" : r.runningBalance.toFixed(2), (r.rawReference || r.description).trim().toUpperCase()].join("|");

router.post(
  "/imports",
  auditLog("bank_reconciliation", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const orgId: number  = req.user.organizationId;
      const userId: string = req.user.sub ?? req.user.id;
      const body = uploadSchema.parse(req.body);

      if (!BANK_FORMATS[body.bankName]) throw new ReconError(400, `Unknown bank "${body.bankName}". Pick a bank from the list (or "Generic").`);
      if (body.statementPeriodFrom && body.statementPeriodTo && body.statementPeriodFrom > body.statementPeriodTo) {
        throw new ReconError(400, "Statement period: the start date is after the end date.");
      }

      const parsed = mapRowsForBank(parseCSV(body.csvData), body.bankName);
      if (!parsed.length) throw new ReconError(400, "No transactions found in the file. Check that it is a CSV with a header row and the right bank is selected.");
      if (parsed.length > MAX_ROWS) throw new ReconError(400, `That file has ${parsed.length} lines; the limit is ${MAX_ROWS}. Split it by month.`);

      const good    = parsed.filter(r => r.transactionDate && r.amount !== 0);
      const skipped = parsed.length - good.length;
      if (!good.length) throw new ReconError(400, "No valid rows parsed. Check the CSV format matches the selected bank (dates and amounts could not be read).");

      // Drop what was already imported (same statement uploaded twice, or two overlapping statements). Identical lines
      // inside ONE file are real (two KES 500 deposits on a day) and are kept — only the copies the org already holds go.
      const dates = good.map(r => r.transactionDate!).sort();
      const existing = await db.select({
        d: bankStatementRows.transactionDate, a: bankStatementRows.amount, b: bankStatementRows.runningBalance,
        rr: bankStatementRows.rawReference, de: bankStatementRows.description,
      }).from(bankStatementRows).where(and(
        eq(bankStatementRows.organizationId, orgId),
        gte(bankStatementRows.transactionDate, dates[0]), lte(bankStatementRows.transactionDate, dates[dates.length - 1]),
      ));
      const held = new Map<string, number>();
      for (const e of existing) {
        const k = rowKey({ transactionDate: String(e.d), amount: num(e.a), runningBalance: e.b == null ? null : num(e.b), rawReference: e.rr ?? "", description: e.de ?? "" });
        held.set(k, (held.get(k) ?? 0) + 1);
      }
      const fresh = good.filter(r => {
        const k = rowKey(r);
        const n = held.get(k) ?? 0;
        if (n > 0) { held.set(k, n - 1); return false; }
        return true;
      });
      const duplicates = good.length - fresh.length;
      if (!fresh.length) throw new ReconError(409, "Every transaction in this file has already been imported.", { duplicates });

      const imp = await db.transaction(async (tx) => {
        const [i] = await tx.insert(bankStatementImports).values({
          organizationId: orgId, bankName: body.bankName, accountName: body.accountName, accountNumber: body.accountNumber,
          statementPeriodFrom: body.statementPeriodFrom || dates[0], statementPeriodTo: body.statementPeriodTo || dates[dates.length - 1],
          importedBy: userId, rowCount: fresh.length, matchedCount: 0, unmatchedCount: fresh.length,
          fileName: body.fileName, notes: body.notes, status: "done",
        }).returning();
        await tx.insert(bankStatementRows).values(fresh.map(r => ({
          importId: i.id, organizationId: orgId, bankName: body.bankName,
          transactionDate: r.transactionDate!, description: r.description,
          debitAmount:  r.debitAmount  ? String(r.debitAmount)  : null,
          creditAmount: r.creditAmount ? String(r.creditAmount) : null,
          amount: String(r.amount),
          runningBalance: r.runningBalance == null ? null : String(r.runningBalance),
          rawReference: r.rawReference || null, parsedReference: r.parsedReference || null, payerName: r.payerName || null,
          matchStatus: "unmatched" as const,
        })));
        return i;
      });

      const notes: string[] = [];
      if (duplicates) notes.push(`${duplicates} already imported earlier — left out`);
      if (skipped)    notes.push(`${skipped} line${skipped === 1 ? "" : "s"} without a readable date or amount — left out`);
      res.status(201).json({
        importId: imp.id, rowCount: fresh.length, duplicates, skipped,
        message: `Imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}${notes.length ? ` (${notes.join("; ")})` : ""}. Run auto-match to reconcile.`,
      });
    } catch (err) { fail(res, err, "Import failed"); }
  }
);

// DELETE /imports/:id — remove a wrong upload (only while nothing in it has been matched)
router.delete(
  "/imports/:id",
  auditLog("bank_reconciliation", "DELETE") as any,
  async (req: any, res: any) => {
    try {
      const orgId = req.user.organizationId as number;
      const importId = posInt(req.params.id);
      if (!importId) throw new ReconError(404, "Import not found");
      const [imp] = await db.select().from(bankStatementImports)
        .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId))).limit(1);
      if (!imp) throw new ReconError(404, "Import not found");
      const [m] = await db.select({ n: sql<number>`COUNT(*)` }).from(bankStatementRows)
        .where(and(eq(bankStatementRows.importId, importId), eq(bankStatementRows.matchStatus, "matched")));
      if (Number(m.n) > 0) throw new ReconError(409, `${m.n} transaction${Number(m.n) === 1 ? " is" : "s are"} matched to payments. Unmatch them first, then delete the import.`);
      await db.transaction(async (tx) => {
        await tx.delete(bankStatementRows).where(eq(bankStatementRows.importId, importId));
        await tx.delete(bankStatementImports).where(eq(bankStatementImports.id, importId));
      });
      res.json({ success: true });
    } catch (err) { fail(res, err, "Failed to delete import"); }
  }
);

// GET /imports/:id/rows
router.get("/imports/:id/rows", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const importId = posInt(req.params.id);
    if (!importId) throw new ReconError(404, "Import not found");
    const statusFilter = req.query.status as string | undefined;

    const [imp] = await db.select().from(bankStatementImports)
      .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId))).limit(1);
    if (!imp) throw new ReconError(404, "Import not found");

    const conditions: any[] = [eq(bankStatementRows.importId, importId)];
    if (statusFilter && statusFilter !== "all") conditions.push(eq(bankStatementRows.matchStatus, statusFilter));

    const rows = await db.select().from(bankStatementRows)
      .where(and(...conditions)).orderBy(desc(bankStatementRows.transactionDate), desc(bankStatementRows.id));

    const paymentIds = rows.map(r => r.matchedRentPaymentId).filter((id): id is number => id !== null);
    const payments = paymentIds.length
      ? await db.select({
          id: rentPayments.id, invoiceNumber: rentPayments.invoiceNumber, amount: rentPayments.amount,
          dueDate: rentPayments.dueDate, status: rentPayments.status, tenantId: rentPayments.tenantId,
          firstName: tenants.firstName, lastName: tenants.lastName,
        }).from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .where(and(inArray(rentPayments.id, paymentIds), eq(tenants.organizationId, orgId)))
      : [];
    const paymentMap = Object.fromEntries(payments.map(p => [p.id, { ...p, tenantName: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() }]));

    const stmtIds = rows.map(r => (r.payerAccount ?? "").startsWith(OWS) ? Number((r.payerAccount as string).slice(OWS.length)) : null).filter((x): x is number => !!x);
    const stmts = stmtIds.length
      ? await db.select({ id: ownerStatements.id, statementNumber: ownerStatements.statementNumber, netPayable: ownerStatements.netPayable, status: ownerStatements.status, propertyName: properties.name })
          .from(ownerStatements).leftJoin(properties, eq(ownerStatements.propertyId, properties.id))
          .where(and(inArray(ownerStatements.id, stmtIds), eq(ownerStatements.organizationId, orgId)))
      : [];
    const stmtMap = Object.fromEntries(stmts.map(s => [s.id, s]));

    res.json({
      import: imp,
      rows: rows.map(r => ({
        ...r,
        matchedPayment: r.matchedRentPaymentId ? paymentMap[r.matchedRentPaymentId] ?? null : null,
        matchedStatement: (r.payerAccount ?? "").startsWith(OWS) ? stmtMap[Number((r.payerAccount as string).slice(OWS.length))] ?? null : null,
      })),
    });
  } catch (err) { fail(res, err, "Failed to fetch rows"); }
});

// GET /imports/:id/summary
router.get("/imports/:id/summary", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const importId = posInt(req.params.id);
    if (!importId) throw new ReconError(404, "Import not found");
    const [imp] = await db.select().from(bankStatementImports)
      .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId))).limit(1);
    if (!imp) throw new ReconError(404, "Import not found");

    const [stats] = await db.select({
      total:     sql<number>`COUNT(*)`,
      matched:   sql<number>`COUNT(*) FILTER (WHERE match_status = 'matched')`,
      suggested: sql<number>`COUNT(*) FILTER (WHERE match_status = 'suggested')`,
      unmatched: sql<number>`COUNT(*) FILTER (WHERE match_status = 'unmatched')`,
      ignored:   sql<number>`COUNT(*) FILTER (WHERE match_status = 'ignored')`,
      totalCreditAmt: sql<number>`COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0)`,
      matchedAmt:     sql<number>`COALESCE(SUM(CASE WHEN match_status = 'matched' AND amount > 0 THEN amount ELSE 0 END),0)`,
      totalDebitAmt:  sql<number>`COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0)`,
    }).from(bankStatementRows).where(eq(bankStatementRows.importId, importId));
    res.json({ import: imp, stats });
  } catch (err) { fail(res, err, "Failed to fetch summary"); }
});

// POST /imports/:id/auto-match
router.post(
  "/imports/:id/auto-match",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId  = req.user.organizationId as number;
      const userId: string = req.user.sub ?? req.user.id;
      const importId = posInt(req.params.id);
      if (!importId) throw new ReconError(404, "Import not found");
      const [imp] = await db.select().from(bankStatementImports)
        .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId))).limit(1);
      if (!imp) throw new ReconError(404, "Import not found");

      // Unmatched rows, plus earlier suggestions (the invoice they pointed at may have been paid since)
      const todo = await db.select().from(bankStatementRows)
        .where(and(eq(bankStatementRows.importId, importId), inArray(bankStatementRows.matchStatus, ["unmatched", "suggested"])))
        .orderBy(asc(bankStatementRows.transactionDate), asc(bankStatementRows.id));

      const pool = await openInvoices(orgId);
      const stmtPool = (await db.select({ id: ownerStatements.id, net: ownerStatements.netPayable })
        .from(ownerStatements).where(and(eq(ownerStatements.organizationId, orgId), inArray(ownerStatements.status, ["approved", "sent"]))))
        .filter(s => num(s.net) > 0);

      let autoMatched = 0, suggested = 0, failed = 0, overpaid = 0;
      const now = () => new Date().toISOString();

      for (const row of todo) {
        const amount = num(row.amount);

        if (amount < 0) {
          // Money out: only ever a suggestion (an owner payout of exactly this amount) — never applied automatically.
          const hits = stmtPool.filter(s => Math.abs(num(s.net) - Math.abs(amount)) < EPS);
          if (hits.length === 1) {
            await db.update(bankStatementRows).set({ matchStatus: "suggested", payerAccount: `${OWS}${hits[0].id}`, matchConfidence: 70, matchMethod: "owner_statement_amount", updatedAt: now() }).where(eq(bankStatementRows.id, row.id));
            suggested++;
          } else if (row.matchStatus === "suggested") {
            await db.update(bankStatementRows).set({ matchStatus: "unmatched", payerAccount: null, matchConfidence: null, matchMethod: null, updatedAt: now() }).where(eq(bankStatementRows.id, row.id));
          }
          continue;
        }

        const cand = bestMatch(row, pool);
        const sure = cand && cand.score >= 80 && (cand.method !== "auto_exact_ref" || amount <= cand.invoice.balance + EPS);
        if (cand && sure) {
          try {
            const r = await matchRowToInvoice(row, cand.invoice.id, { actorId: userId, method: cand.method, confidence: cand.score });
            autoMatched++;
            if (r.overpaid > EPS) overpaid++;
            cand.invoice.balance = round2(cand.invoice.balance - Math.min(amount, cand.invoice.balance));
            if (cand.invoice.balance <= EPS) pool.splice(pool.indexOf(cand.invoice), 1);
          } catch (e) { failed++; console.warn("[bank-recon] auto-match row", row.id, (e as any)?.message); }
        } else if (cand && cand.score >= 50) {
          await db.update(bankStatementRows).set({
            matchStatus: "suggested", matchedRentPaymentId: cand.invoice.id, matchConfidence: Math.min(cand.score, 79), matchMethod: cand.method, updatedAt: now(),
          }).where(eq(bankStatementRows.id, row.id));
          suggested++;
        } else if (row.matchStatus === "suggested") {
          await db.update(bankStatementRows).set({ matchStatus: "unmatched", matchedRentPaymentId: null, matchConfidence: null, matchMethod: null, updatedAt: now() }).where(eq(bankStatementRows.id, row.id));
        }
      }

      await refreshCounts(importId);
      res.json({
        autoMatched, suggested, failed, overpaid,
        message: `Auto-matched ${autoMatched} payment${autoMatched === 1 ? "" : "s"}. ${suggested} suggestion${suggested === 1 ? "" : "s"} need manual review.${failed ? ` ${failed} could not be applied.` : ""}`,
      });
    } catch (err) { fail(res, err, "Auto-match failed"); }
  }
);

// POST /rows/:rowId/match — link a bank credit to a rent invoice (part payments and overpayments are recorded as they are)
const manualMatchSchema = z.object({
  rentPaymentId: z.number().int().positive(),
  notes:         z.string().max(500).optional(),
});

router.post(
  "/rows/:rowId/match",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId = req.user.organizationId as number;
      const userId: string = req.user.sub ?? req.user.id;
      const rowId = posInt(req.params.rowId);
      if (!rowId) throw new ReconError(404, "Transaction not found");
      const body = manualMatchSchema.parse(req.body);
      const row = await loadRow(orgId, rowId);

      // The invoice must belong to THIS organization
      const [inv] = await db.select({ id: rentPayments.id, status: rentPayments.status, invoiceNumber: rentPayments.invoiceNumber })
        .from(rentPayments).innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
        .where(and(eq(rentPayments.id, body.rentPaymentId), eq(tenants.organizationId, orgId))).limit(1);
      if (!inv) throw new ReconError(404, "Invoice not found");
      if (inv.status === "paid" || inv.status === "cancelled") throw new ReconError(409, `Invoice ${inv.invoiceNumber ?? inv.id} is already ${inv.status}.`);

      const r = await matchRowToInvoice(row, inv.id, { actorId: userId, method: "manual", confidence: 100, notes: body.notes });
      await refreshCounts(row.importId);
      res.json({
        success: true, status: r.status, balance: r.balance, overpaid: r.overpaid,
        message: r.overpaid > EPS ? `Matched. The invoice is paid and KES ${r.overpaid.toLocaleString("en-KE")} was received in excess — refund the tenant or credit the next invoice.`
               : r.fullyPaid ? "Matched. The invoice is paid in full."
               : `Matched as a part payment. KES ${r.balance.toLocaleString("en-KE")} is still owed on the invoice.`,
      });
    } catch (err) { fail(res, err, "Match failed"); }
  }
);

// POST /rows/:rowId/match-statement — link a bank DEBIT to the owner statement it paid out
const statementMatchSchema = z.object({ statementId: z.number().int().positive() });

router.post(
  "/rows/:rowId/match-statement",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId = req.user.organizationId as number;
      const userId: string = req.user.sub ?? req.user.id;
      const rowId = posInt(req.params.rowId);
      if (!rowId) throw new ReconError(404, "Transaction not found");
      const body = statementMatchSchema.parse(req.body);
      const row = await loadRow(orgId, rowId);
      if (!(num(row.amount) < 0)) throw new ReconError(400, "Only money paid out (a debit) can be matched to an owner payout.");
      if (!["unmatched", "suggested"].includes(row.matchStatus)) throw new ReconError(409, "This transaction has already been matched or ignored. Refresh the page.");

      const [st] = await db.select().from(ownerStatements)
        .where(and(eq(ownerStatements.id, body.statementId), eq(ownerStatements.organizationId, orgId))).limit(1);
      if (!st) throw new ReconError(404, "Statement not found");
      if (!["approved", "sent"].includes(st.status ?? "")) throw new ReconError(409, `Statement ${st.statementNumber} is ${st.status} — only an approved or sent statement can be marked paid.`);
      if (Math.abs(Math.abs(num(row.amount)) - num(st.netPayable)) >= EPS) {
        throw new ReconError(409, `The bank paid KES ${Math.abs(num(row.amount)).toLocaleString("en-KE")} but statement ${st.statementNumber} is for KES ${num(st.netPayable).toLocaleString("en-KE")}.`);
      }

      const now = new Date();
      const claimed = await db.update(bankStatementRows).set({
        matchStatus: "matched", payerAccount: `${OWS}${st.id}`, matchMethod: "owner_statement", matchConfidence: 100,
        matchedBy: userId, matchedAt: now.toISOString(), updatedAt: now.toISOString(),
      }).where(and(eq(bankStatementRows.id, row.id), inArray(bankStatementRows.matchStatus, ["unmatched", "suggested"]))).returning({ id: bankStatementRows.id });
      if (!claimed.length) throw new ReconError(409, "This transaction has already been matched or ignored. Refresh the page.");

      const paid = await db.update(ownerStatements).set({
        status: "paid", disbursedAt: new Date(`${row.transactionDate}T12:00:00Z`),
        disbursementRef: (row.parsedReference || row.rawReference || `BANK-${row.id}`).slice(0, 100), updatedAt: now,
      }).where(and(eq(ownerStatements.id, st.id), eq(ownerStatements.organizationId, orgId), inArray(ownerStatements.status, ["approved", "sent"]))).returning({ id: ownerStatements.id });
      if (!paid.length) {
        await db.update(bankStatementRows).set({ matchStatus: row.matchStatus, payerAccount: row.payerAccount, matchMethod: row.matchMethod, matchConfidence: row.matchConfidence, matchedBy: null, matchedAt: null }).where(eq(bankStatementRows.id, row.id));
        throw new ReconError(409, "That statement was just paid or changed. Refresh the page.");
      }
      await refreshCounts(row.importId);
      res.json({ success: true, message: `Statement ${st.statementNumber} marked as paid.` });
    } catch (err) { fail(res, err, "Match failed"); }
  }
);

// POST /rows/:rowId/ignore
router.post(
  "/rows/:rowId/ignore",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId = req.user.organizationId as number;
      const rowId = posInt(req.params.rowId);
      if (!rowId) throw new ReconError(404, "Transaction not found");
      const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 500) || null : null;
      const row = await loadRow(orgId, rowId);
      if (row.matchStatus === "matched") throw new ReconError(409, "This transaction is matched to a payment. Unmatch it first if it should be ignored.");
      await db.update(bankStatementRows)
        .set({ matchStatus: "ignored", matchedRentPaymentId: null, payerAccount: (row.payerAccount ?? "").startsWith(OWS) ? null : row.payerAccount, matchConfidence: null, matchMethod: null, reconcileNotes: notes, updatedAt: new Date().toISOString() })
        .where(eq(bankStatementRows.id, rowId));
      await refreshCounts(row.importId);
      res.json({ success: true });
    } catch (err) { fail(res, err, "Failed to ignore"); }
  }
);

// POST /rows/:rowId/unmatch — undo a match (or a suggestion / ignore). A matched payment is really reversed.
router.post(
  "/rows/:rowId/unmatch",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId = req.user.organizationId as number;
      const userId: string = req.user.sub ?? req.user.id;
      const rowId = posInt(req.params.rowId);
      if (!rowId) throw new ReconError(404, "Transaction not found");
      const row = await loadRow(orgId, rowId);

      if (row.matchStatus === "matched") {
        if ((row.payerAccount ?? "").startsWith(OWS)) {
          // an owner payout: the statement goes back to approved
          const sid = Number((row.payerAccount as string).slice(OWS.length));
          await db.update(ownerStatements).set({ status: "approved", disbursedAt: null, disbursementRef: null, updatedAt: new Date() })
            .where(and(eq(ownerStatements.id, sid), eq(ownerStatements.organizationId, orgId), eq(ownerStatements.status, "paid")));
        } else if (row.matchedRentPaymentId) {
          const rev = await reverseReceipt(`BANK-${row.id}`, { actorUserId: userId, reason: "bank match undone" });
          if (!rev.reversed) {
            // matched before receipts existed: the invoice was simply flagged paid — put it back unless real receipts back it
            const [left] = await db.select({ n: sql<number>`COUNT(*)` }).from(paymentReceipts).where(eq(paymentReceipts.paymentId, row.matchedRentPaymentId));
            if (Number(left.n) === 0) {
              const [inv] = await db.select({ dueDate: rentPayments.dueDate }).from(rentPayments).where(eq(rentPayments.id, row.matchedRentPaymentId)).limit(1);
              const overdue = inv && String(inv.dueDate).slice(0, 10) < new Date().toISOString().slice(0, 10);
              await db.update(rentPayments).set({ status: overdue ? "overdue" : "pending", paidDate: null, updatedAt: new Date() }).where(eq(rentPayments.id, row.matchedRentPaymentId));
            }
          }
        }
      }

      await db.update(bankStatementRows).set({
        matchStatus: "unmatched", matchedRentPaymentId: null, payerAccount: null, matchedBy: null, matchedAt: null,
        matchConfidence: null, matchMethod: null, reconcileNotes: null, updatedAt: new Date().toISOString(),
      }).where(eq(bankStatementRows.id, rowId));
      await refreshCounts(row.importId);
      res.json({ success: true });
    } catch (err) { fail(res, err, "Failed to unmatch"); }
  }
);

// GET /unmatched — all unmatched rows across the org (credits: arrears dashboard)
router.get("/unmatched", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const rows = await db.select().from(bankStatementRows)
      .where(and(
        eq(bankStatementRows.organizationId, orgId),
        inArray(bankStatementRows.matchStatus, ["unmatched", "suggested"]),
        sql`amount > 0`,
      ))
      .orderBy(desc(bankStatementRows.transactionDate)).limit(200);
    res.json(rows);
  } catch (err) { fail(res, err, "Failed to fetch unmatched rows"); }
});

export default router;
