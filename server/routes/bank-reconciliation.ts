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
} from "@shared/schema";
import { eq, and, or, isNull, desc, sql, like, gte, lte, inArray } from "drizzle-orm";
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
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
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
  return parseFloat(v.replace(/[^0-9.\-]/g, "")) || 0;
}

function parseDate(v: string): string | null {
  if (!v) return null;
  // Try various formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD MMM YYYY
  const cleaned = v.trim();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  // MM/DD/YYYY
  const mdy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  // DD MMM YYYY e.g. 01 Jan 2024
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
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
      const m = descRaw.match(/\b([A-Z0-9]{6,20})\b/);
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
  }).filter(r => r.transactionDate && r.amount !== 0);
}

// ─── Auto-match algorithm ─────────────────────────────────────────────────────

interface MatchCandidate {
  rentPaymentId: number;
  score:         number;
  method:        string;
}

async function autoMatchRow(
  row: typeof bankStatementRows.$inferSelect,
  orgId: number,
): Promise<MatchCandidate | null> {
  // Only attempt to match credit transactions (money coming in)
  if (Number(row.amount) <= 0) return null;

  const amount = Number(row.amount);

  // Fetch pending/overdue payments in same org
  const candidates = await db
    .select({
      id:            rentPayments.id,
      amount:        rentPayments.amount,
      dueDate:       rentPayments.dueDate,
      invoiceNumber: rentPayments.invoiceNumber,
      bankReference: rentPayments.bankReference,
      status:        rentPayments.status,
      tenantId:      rentPayments.tenantId,
    })
    .from(rentPayments)
    .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
    .where(and(
      eq(tenants.organizationId, orgId),
      or(
        eq(rentPayments.status, "pending"),
        eq(rentPayments.status, "overdue"),
        eq(rentPayments.status, "partial"),
      ),
    ));

  let best: MatchCandidate | null = null;

  for (const c of candidates) {
    let score = 0;
    let method = "";

    // 1. Exact reference match (highest confidence)
    const ref = row.parsedReference?.toUpperCase() ?? "";
    const inv = (c.invoiceNumber ?? "").toUpperCase();
    const bkr = (c.bankReference ?? "").toUpperCase();
    if (ref && (ref === inv || ref === bkr || inv.includes(ref) || ref.includes(inv))) {
      score = 95;
      method = "auto_exact_ref";
    }

    // 2. Amount exact match + date within ±14 days of due date
    if (score < 80) {
      const cAmt = Math.abs(Number(c.amount));
      if (Math.abs(cAmt - amount) < 0.01) {
        const txDate  = new Date(row.transactionDate);
        const dueDate = new Date(c.dueDate);
        const daysDiff = Math.abs((txDate.getTime() - dueDate.getTime()) / 86400000);
        if (daysDiff <= 7)       { score = 88; method = "auto_amount_date_7d";  }
        else if (daysDiff <= 14) { score = 75; method = "auto_amount_date_14d"; }
        else if (daysDiff <= 31) { score = 55; method = "auto_amount_date_31d"; }
      }
    }

    // 3. Amount + payer name similarity
    if (score < 60 && row.payerName) {
      const cAmt = Math.abs(Number(c.amount));
      if (Math.abs(cAmt - amount) < 0.01) {
        // Simple name overlap: fetch tenant name
        const [tenant] = await db
          .select({ firstName: tenants.firstName, lastName: tenants.lastName })
          .from(tenants)
          .where(eq(tenants.id, c.tenantId))
          .limit(1);
        if (tenant) {
          const tenantName = `${tenant.firstName} ${tenant.lastName}`.toLowerCase();
          const payerName  = row.payerName.toLowerCase();
          const words = tenantName.split(/\s+/);
          const matches = words.filter(w => w.length > 2 && payerName.includes(w));
          const similarity = matches.length / words.length;
          if (similarity >= 0.6) {
            score  = Math.round(50 + similarity * 30);
            method = "auto_amount_name";
          }
        }
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { rentPaymentId: c.id, score, method };
    }
  }

  return best;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /bank-names
router.get("/bank-names", (_req: any, res: any) => {
  const list = Object.entries(BANK_FORMATS).map(([key, v]) => ({
    key,
    label:   v.label,
    country: v.country,
    csvHint: v.csvHint,
  }));
  res.json(list);
});

// GET /imports — list all imports for org
router.get("/imports", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const imports = await db
      .select()
      .from(bankStatementImports)
      .where(eq(bankStatementImports.organizationId, orgId))
      .orderBy(desc(bankStatementImports.createdAt));
    res.json(imports);
  } catch (err) {
    console.error("[bank-recon] list imports:", err);
    res.status(500).json({ message: "Failed to fetch imports" });
  }
});

// POST /imports — upload + parse a CSV bank statement
const uploadSchema = z.object({
  bankName:             z.string(),
  accountName:          z.string().optional(),
  accountNumber:        z.string().optional(),
  statementPeriodFrom:  z.string().optional(),
  statementPeriodTo:    z.string().optional(),
  fileName:             z.string().optional(),
  notes:                z.string().optional(),
  csvData:              z.string().min(10),  // raw CSV text
});

router.post(
  "/imports",
  auditLog("bank_reconciliation", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const orgId: number  = req.user.organizationId;
      const userId: string = req.user.sub ?? req.user.id;
      const body = uploadSchema.parse(req.body);

      const csvRows  = parseCSV(body.csvData);
      const mapped   = mapRowsForBank(csvRows, body.bankName);

      if (!mapped.length) {
        return res.status(400).json({
          message: "No valid rows parsed. Check the CSV format matches the selected bank.",
        });
      }

      // Insert import record
      const [imp] = await db
        .insert(bankStatementImports)
        .values({
          organizationId:      orgId,
          bankName:            body.bankName,
          accountName:         body.accountName,
          accountNumber:       body.accountNumber,
          statementPeriodFrom: body.statementPeriodFrom ?? null,
          statementPeriodTo:   body.statementPeriodTo   ?? null,
          importedBy:          userId,
          rowCount:            mapped.length,
          matchedCount:        0,
          unmatchedCount:      mapped.length,
          fileName:            body.fileName,
          notes:               body.notes,
          status:              "processing",
        })
        .returning();

      // Bulk-insert rows
      const insertValues = mapped.map(r => ({
        importId:       imp.id,
        organizationId: orgId,
        bankName:       body.bankName,
        transactionDate:    r.transactionDate!,
        description:        r.description,
        debitAmount:        r.debitAmount ? String(r.debitAmount)  : null,
        creditAmount:       r.creditAmount ? String(r.creditAmount) : null,
        amount:             String(r.amount),
        runningBalance:     r.runningBalance ? String(r.runningBalance) : null,
        rawReference:       r.rawReference   || null,
        parsedReference:    r.parsedReference || null,
        payerName:          r.payerName      || null,
        matchStatus:        "unmatched" as const,
      }));

      await db.insert(bankStatementRows).values(insertValues);

      // Update import status
      await db
        .update(bankStatementImports)
        .set({ status: "done" })
        .where(eq(bankStatementImports.id, imp.id));

      res.status(201).json({
        importId:  imp.id,
        rowCount:  mapped.length,
        message:   `Imported ${mapped.length} transactions. Run auto-match to reconcile.`,
      });
    } catch (err: any) {
      console.error("[bank-recon] create import:", err);
      if (err?.name === "ZodError") return res.status(400).json({ message: err.errors });
      res.status(500).json({ message: "Import failed" });
    }
  }
);

// GET /imports/:id/rows
router.get("/imports/:id/rows", async (req: any, res: any) => {
  try {
    const orgId   = req.user.organizationId as number;
    const importId = parseInt(req.params.id);
    const statusFilter = req.query.status as string | undefined;

    const [imp] = await db
      .select()
      .from(bankStatementImports)
      .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId)))
      .limit(1);
    if (!imp) return res.status(404).json({ message: "Import not found" });

    const conditions: any[] = [
      eq(bankStatementRows.importId, importId),
    ];
    if (statusFilter && statusFilter !== "all") {
      conditions.push(eq(bankStatementRows.matchStatus, statusFilter));
    }

    const rows = await db
      .select()
      .from(bankStatementRows)
      .where(and(...conditions))
      .orderBy(desc(bankStatementRows.transactionDate));

    // Attach matched payment info
    const paymentIds = rows
      .map(r => r.matchedRentPaymentId)
      .filter((id): id is number => id !== null);

    const payments = paymentIds.length
      ? await db
          .select({
            id:            rentPayments.id,
            invoiceNumber: rentPayments.invoiceNumber,
            amount:        rentPayments.amount,
            dueDate:       rentPayments.dueDate,
            status:        rentPayments.status,
            tenantId:      rentPayments.tenantId,
          })
          .from(rentPayments)
          .where(inArray(rentPayments.id, paymentIds))
      : [];

    const paymentMap = Object.fromEntries(payments.map(p => [p.id, p]));

    const result = rows.map(r => ({
      ...r,
      matchedPayment: r.matchedRentPaymentId ? paymentMap[r.matchedRentPaymentId] ?? null : null,
    }));

    res.json({ import: imp, rows: result });
  } catch (err) {
    console.error("[bank-recon] get rows:", err);
    res.status(500).json({ message: "Failed to fetch rows" });
  }
});

// GET /imports/:id/summary
router.get("/imports/:id/summary", async (req: any, res: any) => {
  try {
    const orgId   = req.user.organizationId as number;
    const importId = parseInt(req.params.id);

    const [imp] = await db
      .select()
      .from(bankStatementImports)
      .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId)))
      .limit(1);
    if (!imp) return res.status(404).json({ message: "Import not found" });

    const [stats] = await db
      .select({
        total:     sql<number>`COUNT(*)`,
        matched:   sql<number>`COUNT(*) FILTER (WHERE match_status = 'matched')`,
        suggested: sql<number>`COUNT(*) FILTER (WHERE match_status = 'suggested')`,
        unmatched: sql<number>`COUNT(*) FILTER (WHERE match_status = 'unmatched')`,
        ignored:   sql<number>`COUNT(*) FILTER (WHERE match_status = 'ignored')`,
        totalCreditAmt: sql<number>`SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)`,
        matchedAmt:     sql<number>`SUM(CASE WHEN match_status = 'matched' AND amount > 0 THEN amount ELSE 0 END)`,
      })
      .from(bankStatementRows)
      .where(eq(bankStatementRows.importId, importId));

    res.json({ import: imp, stats });
  } catch (err) {
    console.error("[bank-recon] summary:", err);
    res.status(500).json({ message: "Failed to fetch summary" });
  }
});

// POST /imports/:id/auto-match
router.post(
  "/imports/:id/auto-match",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId   = req.user.organizationId as number;
      const importId = parseInt(req.params.id);

      const [imp] = await db
        .select()
        .from(bankStatementImports)
        .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.organizationId, orgId)))
        .limit(1);
      if (!imp) return res.status(404).json({ message: "Import not found" });

      // Fetch unmatched credit rows
      const unmatchedRows = await db
        .select()
        .from(bankStatementRows)
        .where(and(
          eq(bankStatementRows.importId, importId),
          eq(bankStatementRows.matchStatus, "unmatched"),
          sql`amount > 0`,
        ));

      let autoMatched  = 0;
      let suggested    = 0;

      for (const row of unmatchedRows) {
        const candidate = await autoMatchRow(row, orgId);
        if (!candidate) continue;

        if (candidate.score >= 80) {
          // Auto-apply
          await db
            .update(bankStatementRows)
            .set({
              matchStatus:          "matched",
              matchedRentPaymentId: candidate.rentPaymentId,
              matchConfidence:      candidate.score,
              matchMethod:          candidate.method,
              matchedAt:            new Date().toISOString(),
            })
            .where(eq(bankStatementRows.id, row.id));

          // Mark rent payment as paid
          await db
            .update(rentPayments)
            .set({
              status:        "paid",
              paidDate:      row.transactionDate,
              paymentMethod: `bank_transfer`,
              bankReference: row.parsedReference || row.rawReference || undefined,
              updatedAt: new Date(),
            })
            .where(eq(rentPayments.id, candidate.rentPaymentId));

          autoMatched++;
        } else if (candidate.score >= 50) {
          // Surface as suggestion for manual review
          await db
            .update(bankStatementRows)
            .set({
              matchStatus:          "suggested",
              matchedRentPaymentId: candidate.rentPaymentId,
              matchConfidence:      candidate.score,
              matchMethod:          candidate.method,
            })
            .where(eq(bankStatementRows.id, row.id));
          suggested++;
        }
      }

      // Update counts on the import record
      const [counts] = await db
        .select({
          matched:   sql<number>`COUNT(*) FILTER (WHERE match_status IN ('matched'))`,
          unmatched: sql<number>`COUNT(*) FILTER (WHERE match_status = 'unmatched')`,
        })
        .from(bankStatementRows)
        .where(eq(bankStatementRows.importId, importId));

      await db
        .update(bankStatementImports)
        .set({ matchedCount: Number(counts.matched), unmatchedCount: Number(counts.unmatched) })
        .where(eq(bankStatementImports.id, importId));

      res.json({
        autoMatched,
        suggested,
        message: `Auto-matched ${autoMatched} payments. ${suggested} suggestions need manual review.`,
      });
    } catch (err) {
      console.error("[bank-recon] auto-match:", err);
      res.status(500).json({ message: "Auto-match failed" });
    }
  }
);

// POST /rows/:rowId/match — manually link a row to a rent payment
const manualMatchSchema = z.object({
  rentPaymentId: z.number().int().positive(),
  notes:         z.string().optional(),
});

router.post(
  "/rows/:rowId/match",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId   = req.user.organizationId as number;
      const userId: string = req.user.sub ?? req.user.id;
      const rowId   = parseInt(req.params.rowId);
      const body    = manualMatchSchema.parse(req.body);

      const [row] = await db
        .select()
        .from(bankStatementRows)
        .where(and(eq(bankStatementRows.id, rowId), eq(bankStatementRows.organizationId, orgId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Row not found" });

      await db
        .update(bankStatementRows)
        .set({
          matchStatus:          "matched",
          matchedRentPaymentId: body.rentPaymentId,
          matchConfidence:      100,
          matchMethod:          "manual",
          matchedBy:            userId,
          matchedAt:            new Date().toISOString(),
          reconcileNotes:       body.notes ?? null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bankStatementRows.id, rowId));

      await db
        .update(rentPayments)
        .set({
          status:        "paid",
          paidDate:      row.transactionDate,
          paymentMethod: "bank_transfer",
          bankReference: row.parsedReference || row.rawReference || undefined,
          notes:         body.notes,
          updatedAt: new Date(),
        })
        .where(eq(rentPayments.id, body.rentPaymentId));

      // Refresh import counts
      const importId = row.importId;
      const [counts] = await db
        .select({
          matched:   sql<number>`COUNT(*) FILTER (WHERE match_status IN ('matched'))`,
          unmatched: sql<number>`COUNT(*) FILTER (WHERE match_status = 'unmatched')`,
        })
        .from(bankStatementRows)
        .where(eq(bankStatementRows.importId, importId));
      await db
        .update(bankStatementImports)
        .set({ matchedCount: Number(counts.matched), unmatchedCount: Number(counts.unmatched) })
        .where(eq(bankStatementImports.id, importId));

      res.json({ success: true });
    } catch (err: any) {
      console.error("[bank-recon] manual match:", err);
      if (err?.name === "ZodError") return res.status(400).json({ message: err.errors });
      res.status(500).json({ message: "Match failed" });
    }
  }
);

// POST /rows/:rowId/ignore
router.post(
  "/rows/:rowId/ignore",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId  = req.user.organizationId as number;
      const rowId  = parseInt(req.params.rowId);
      const notes  = (req.body?.notes as string) || null;

      const [row] = await db
        .select()
        .from(bankStatementRows)
        .where(and(eq(bankStatementRows.id, rowId), eq(bankStatementRows.organizationId, orgId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Row not found" });

      await db
        .update(bankStatementRows)
        .set({ matchStatus: "ignored", reconcileNotes: notes, updatedAt: new Date().toISOString() })
        .where(eq(bankStatementRows.id, rowId));

      res.json({ success: true });
    } catch (err) {
      console.error("[bank-recon] ignore:", err);
      res.status(500).json({ message: "Failed" });
    }
  }
);

// POST /rows/:rowId/unmatch
router.post(
  "/rows/:rowId/unmatch",
  auditLog("bank_reconciliation", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const orgId  = req.user.organizationId as number;
      const rowId  = parseInt(req.params.rowId);

      const [row] = await db
        .select()
        .from(bankStatementRows)
        .where(and(eq(bankStatementRows.id, rowId), eq(bankStatementRows.organizationId, orgId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Row not found" });

      // Revert rent payment to pending
      if (row.matchedRentPaymentId) {
        await db
          .update(rentPayments)
          .set({ status: "pending", paidDate: null, updatedAt: new Date() })
          .where(eq(rentPayments.id, row.matchedRentPaymentId));
      }

      await db
        .update(bankStatementRows)
        .set({
          matchStatus:          "unmatched",
          matchedRentPaymentId: null,
          matchedBy:            null,
          matchedAt:            null,
          matchConfidence:      null,
          matchMethod:          null,
          reconcileNotes:       null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bankStatementRows.id, rowId));

      res.json({ success: true });
    } catch (err) {
      console.error("[bank-recon] unmatch:", err);
      res.status(500).json({ message: "Failed" });
    }
  }
);

// GET /unmatched — all unmatched rows across the org (for arrears dashboard)
router.get("/unmatched", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const rows = await db
      .select()
      .from(bankStatementRows)
      .where(and(
        eq(bankStatementRows.organizationId, orgId),
        or(
          eq(bankStatementRows.matchStatus, "unmatched"),
          eq(bankStatementRows.matchStatus, "suggested"),
        ),
        sql`amount > 0`,
      ))
      .orderBy(desc(bankStatementRows.transactionDate))
      .limit(200);
    res.json(rows);
  } catch (err) {
    console.error("[bank-recon] unmatched:", err);
    res.status(500).json({ message: "Failed" });
  }
});

export default router;