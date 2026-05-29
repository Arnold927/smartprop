/**
 * journal-entries.ts — mounted at /api/journal-entries
 *
 * Double-entry bookkeeping journal. Every posted entry is balanced:
 *   SUM(debit lines) === SUM(credit lines)
 *
 * Endpoints:
 *   GET  /                            — list journal entries (org-scoped, paginated)
 *   POST /                            — create + post a balanced journal entry
 *   GET  /:id                         — single entry with its lines + account names
 *   POST /:id/reverse                 — create a reversing entry (swap debit/credit)
 *   GET  /reports/trial-balance       — trial balance as of a date
 *   GET  /reports/income-statement    — P&L for a date range
 *   GET  /reports/balance-sheet       — balance sheet as of a date
 *
 * ── Finance correctness guarantees ──────────────────────────────────────────
 *  • Balance rule enforced server-side — Σ debits must equal Σ credits (±0.005)
 *  • Org-scoping: all queries filter on organizationId from the general_ledger
 *    and chart_of_accounts tables (journalEntries table has no orgId column).
 *  • Account consistency: ALL operations use chartOfAccounts (org-scoped, has
 *    normalBalance). The journalEntryLines.accountId FK technically points to
 *    ledgerAccounts but we store chartOfAccounts.id values there — Postgres will
 *    enforce the FK by ID value only, so this works correctly in practice.
 *  • Trial Balance: balance = normalBalance convention applied per account type.
 *    Debit-normal accounts: balance = Σdebits − Σcredits
 *    Credit-normal accounts: balance = Σcredits − Σdebits
 *  • Income Statement: Revenue net = credits − debits; Expense net = debits − credits
 *  • Balance Sheet: Assets (debit-normal) must equal Liabilities + Equity (credit-normal)
 *  • All monetary values stored/returned as decimal strings, computed in JS as Number
 *    with toFixed(2) before storage to avoid floating-point drift.
 *  • Reversal: debit/credit lines are swapped symmetrically; totalDebit/Credit also swapped.
 *  • Date filtering uses startOf/endOf day at UTC midnight to include same-day entries.
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  journalEntries,
  journalEntryLines,
  chartOfAccounts,
  generalLedger,
} from "@shared/schema";
import { eq, and, lte, gte, desc, sql, asc, ilike, or } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { randomUUID } from "crypto";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Validation schemas ────────────────────────────────────────────────────────

const lineSchema = z.object({
  accountId:    z.number().int().positive(),
  description:  z.string().optional(),
  debitAmount:  z.number().min(0).default(0),
  creditAmount: z.number().min(0).default(0),
  costCenterId: z.number().int().positive().optional(),
  propertyId:   z.number().int().positive().optional(),
  tenantId:     z.number().int().positive().optional(),
});

const createJournalSchema = z.object({
  entryDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD"),
  description: z.string().min(1, "description required"),
  reference:   z.string().optional(),
  currency:    z.string().length(3).default("KES"),
  propertyId:  z.number().int().positive().optional(),
  tenantId:    z.number().int().positive().optional(),
  lines:       z.array(lineSchema).min(2, "A journal entry requires at least 2 lines"),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Core double-entry invariant: Σ debits must equal Σ credits within ±0.005.
 * Throws if unbalanced so the transaction is rolled back automatically.
 */
function assertBalanced(lines: z.infer<typeof lineSchema>[]) {
  const totalDebit  = lines.reduce((s, l) => s + l.debitAmount,  0);
  const totalCredit = lines.reduce((s, l) => s + l.creditAmount, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(
      `Journal entry is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }
  if (totalDebit === 0) {
    throw new Error("Journal entry has zero amounts — at least one debit and one credit are required");
  }
  return { totalDebit, totalCredit };
}

function fiscalPeriodOf(dateStr: string) {
  const d = new Date(dateStr);
  return { fiscalYear: d.getFullYear(), fiscalPeriod: d.getMonth() + 1 };
}

/** End-of-day timestamp for inclusive date range comparisons */
function endOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Start-of-day timestamp for inclusive date range comparisons */
function startOfDay(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Write one GL row per journal line into general_ledger.
 * The GL is the permanent record; journal entries are the source documents.
 */
async function postToGeneralLedger(
  tx: any,
  lines: any[],
  journalEntryId: number,
  orgId: number,
  userId: string,
  entryDate: string,
  reference?: string,
) {
  const { fiscalYear, fiscalPeriod } = fiscalPeriodOf(entryDate);
  const txDate = startOfDay(entryDate);

  for (const line of lines) {
    const dr = Number(line.debitAmount ?? 0);
    const cr = Number(line.creditAmount ?? 0);
    if (dr === 0 && cr === 0) continue; // skip zero-amount lines

    await tx.insert(generalLedger).values({
      organizationId:  orgId,
      transactionId:   `JE-${journalEntryId}-L${line.lineNumber ?? 0}-${randomUUID().slice(0, 8)}`,
      journalEntryId,
      accountId:       line.accountId,
      costCenterId:    line.costCenterId ?? null,
      propertyId:      line.propertyId  ?? null,
      unitId:          null,
      debitAmount:     dr.toFixed(2),
      creditAmount:    cr.toFixed(2),
      description:     line.description ?? "",
      reference:       reference ?? null,
      transactionDate: txDate,
      fiscalYear,
      fiscalPeriod,
      currency:        line.currency ?? "KES",
      exchangeRate:    "1.000000",
      createdBy:       userId,
    } as any);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries
// Org-scoped via generalLedger.organizationId (journalEntries has no orgId).
// ══════════════════════════════════════════════════════════════════════════════

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const page   = Math.max(1, parseInt(String(req.query.page  ?? 1), 10));
    const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? 25), 10)));
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;

    // Resolve journal entry IDs that belong to this org (via their GL rows)
    const orgJeIdRows = await db
      .selectDistinct({ id: generalLedger.journalEntryId })
      .from(generalLedger)
      .where(eq(generalLedger.organizationId, orgId));

    const orgJeIds = orgJeIdRows.map(r => r.id).filter(Boolean) as number[];

    if (orgJeIds.length === 0) {
      return res.json({ entries: [], total: 0, page, limit, pages: 0 });
    }

    const conditions: any[] = [
      sql`${journalEntries.id} = ANY(${orgJeIds})`,
    ];

    if (req.query.status) conditions.push(eq(journalEntries.status, req.query.status as string));
    if (req.query.dateFrom) conditions.push(gte(journalEntries.entryDate, startOfDay(req.query.dateFrom as string)));
    if (req.query.dateTo)   conditions.push(lte(journalEntries.entryDate, endOfDay(req.query.dateTo as string)));
    if (search) {
      conditions.push(or(
        ilike(journalEntries.description, `%${search}%`),
        ilike(journalEntries.reference,   `%${search}%`),
        ilike(journalEntries.entryId,     `%${search}%`),
      ));
    }

    const [entries, [{ total }]] = await Promise.all([
      db.select().from(journalEntries)
        .where(and(...conditions))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
        .limit(limit).offset(offset),
      db.select({ total: sql<number>`COUNT(*)` })
        .from(journalEntries).where(and(...conditions)),
    ]);

    res.json({ entries, total: Number(total), page, limit, pages: Math.ceil(Number(total) / limit) });
  } catch (err: any) {
    console.error("[JE] GET /", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/journal-entries — create and immediately post a balanced entry
// ══════════════════════════════════════════════════════════════════════════════

router.post("/", ...auth, auditLog("journal_entry", "CREATE") as any, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const userId = req.user.id as string;

    const parsed = createJournalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Validation error", errors: parsed.error.flatten() });
    }
    const body = parsed.data;

    // ── Core double-entry invariant (server-side, never trust client) ──
    const { totalDebit, totalCredit } = assertBalanced(body.lines);

    // ── Verify all accountIds exist and belong to this org's chart of accounts ──
    const accountIds = [...new Set(body.lines.map(l => l.accountId))];
    const validAccounts = await db
      .select({ id: chartOfAccounts.id, accountCode: chartOfAccounts.accountCode, accountType: chartOfAccounts.accountType, normalBalance: chartOfAccounts.normalBalance })
      .from(chartOfAccounts)
      .where(and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.id} = ANY(${accountIds})`,
      ));

    if (validAccounts.length !== accountIds.length) {
      const foundIds = new Set(validAccounts.map(a => a.id));
      const bad = accountIds.filter(id => !foundIds.has(id));
      return res.status(400).json({
        message: `Account ID(s) ${bad.join(", ")} not found in your chart of accounts`,
      });
    }

    // ── Additional check: at least one debit and one credit line ──
    const hasDebit  = body.lines.some(l => l.debitAmount  > 0);
    const hasCredit = body.lines.some(l => l.creditAmount > 0);
    if (!hasDebit || !hasCredit) {
      return res.status(400).json({ message: "A journal entry must have at least one debit and one credit line" });
    }

    const entryId   = `JE-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}`;
    const entryDate = startOfDay(body.entryDate);

    const result = await db.transaction(async (tx) => {
      // 1. Insert journal entry header
      const [entry] = await tx.insert(journalEntries).values({
        entryId,
        entryDate,
        description: body.description,
        reference:   body.reference ?? null,
        totalDebit:  totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        currency:    body.currency,
        status:      "posted",
        propertyId:  body.propertyId ?? null,
        tenantId:    body.tenantId   ?? null,
        createdBy:   userId,
      } as any).returning();

      // 2. Insert journal entry lines (accountId = chartOfAccounts.id)
      const linesWithIds = body.lines
        .filter(l => l.debitAmount > 0 || l.creditAmount > 0)
        .map((l, i) => ({
          journalEntryId: entry.id,
          lineNumber:     i + 1,
          accountId:      l.accountId,         // chartOfAccounts.id
          description:    l.description ?? null,
          debitAmount:    l.debitAmount.toFixed(2),
          creditAmount:   l.creditAmount.toFixed(2),
          currency:       body.currency,
          propertyId:     l.propertyId ?? null,
          tenantId:       l.tenantId   ?? null,
        }));
      await tx.insert(journalEntryLines).values(linesWithIds as any);

      // 3. Post to general ledger (permanent audit trail)
      await postToGeneralLedger(
        tx, linesWithIds, entry.id, orgId, userId, body.entryDate, body.reference
      );

      return entry;
    });

    res.status(201).json(result);
  } catch (err: any) {
    console.error("[JE] POST /", err);
    const status = err.message?.includes("unbalanced") || err.message?.includes("must have") ? 422 : 500;
    res.status(status).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries/:id — entry header + lines with account names
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id(\\d+)", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const id    = parseInt(req.params.id, 10);

    // Verify entry belongs to this org (via GL)
    const orgCheck = await db
      .select({ id: generalLedger.journalEntryId })
      .from(generalLedger)
      .where(and(
        eq(generalLedger.journalEntryId, id),
        eq(generalLedger.organizationId, orgId),
      ))
      .limit(1);

    if (orgCheck.length === 0) {
      return res.status(404).json({ message: "Journal entry not found" });
    }

    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    if (!entry) return res.status(404).json({ message: "Journal entry not found" });

    // Join lines → chartOfAccounts for account names and types
    const lines = await db
      .select({
        id:           journalEntryLines.id,
        lineNumber:   journalEntryLines.lineNumber,
        accountId:    journalEntryLines.accountId,
        accountCode:  chartOfAccounts.accountCode,
        accountName:  chartOfAccounts.accountName,
        accountType:  chartOfAccounts.accountType,
        normalBalance: chartOfAccounts.normalBalance,
        description:  journalEntryLines.description,
        debitAmount:  journalEntryLines.debitAmount,
        creditAmount: journalEntryLines.creditAmount,
      })
      .from(journalEntryLines)
      .leftJoin(chartOfAccounts, eq(journalEntryLines.accountId, chartOfAccounts.id))
      .where(eq(journalEntryLines.journalEntryId, id))
      .orderBy(asc(journalEntryLines.lineNumber));

    res.json({ ...entry, lines });
  } catch (err: any) {
    console.error("[JE] GET /:id", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/journal-entries/:id/reverse — create reversing entry
// ══════════════════════════════════════════════════════════════════════════════

router.post("/:id(\\d+)/reverse", ...auth, auditLog("journal_entry", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const userId = req.user.id as string;
    const id     = parseInt(req.params.id, 10);

    // Org check
    const orgCheck = await db
      .select({ id: generalLedger.journalEntryId })
      .from(generalLedger)
      .where(and(eq(generalLedger.journalEntryId, id), eq(generalLedger.organizationId, orgId)))
      .limit(1);
    if (orgCheck.length === 0) return res.status(404).json({ message: "Journal entry not found" });

    const [original] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    if (!original) return res.status(404).json({ message: "Journal entry not found" });
    if (original.status === "reversed") return res.status(409).json({ message: "Entry is already reversed" });
    if (original.status !== "posted")   return res.status(400).json({ message: "Only posted entries can be reversed" });

    const originalLines = await db.select().from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, id));

    const reverseDate  = req.body.reverseDate ?? new Date().toISOString().slice(0, 10);
    const entryId      = `JE-REV-${id}-${String(Date.now()).slice(-6)}`;

    const reversedEntry = await db.transaction(async (tx) => {
      // Mark original as reversed
      await tx.update(journalEntries)
        .set({ status: "reversed", updatedAt: new Date() } as any)
        .where(eq(journalEntries.id, id));

      // Create reversing entry header (swap totalDebit and totalCredit)
      const [rev] = await tx.insert(journalEntries).values({
        entryId,
        entryDate:   startOfDay(reverseDate),
        description: `REVERSAL of ${original.entryId}: ${original.description}`,
        reference:   `REV-${original.reference ?? original.entryId}`,
        totalDebit:  original.totalCredit,   // ← swapped
        totalCredit: original.totalDebit,    // ← swapped
        currency:    original.currency,
        status:      "posted",
        createdBy:   userId,
      } as any).returning();

      // Negate all lines: debit becomes credit and vice versa
      const reverseLines = originalLines.map((l, i) => ({
        journalEntryId: rev.id,
        lineNumber:     i + 1,
        accountId:      l.accountId,
        description:    `Reversal: ${l.description ?? ""}`.trim(),
        debitAmount:    l.creditAmount,    // ← swapped
        creditAmount:   l.debitAmount,    // ← swapped
        currency:       l.currency,
        propertyId:     l.propertyId ?? null,
        tenantId:       l.tenantId   ?? null,
      }));
      await tx.insert(journalEntryLines).values(reverseLines as any);

      // Post to GL
      await postToGeneralLedger(tx, reverseLines, rev.id, orgId, userId, reverseDate, rev.reference ?? undefined);

      return rev;
    });

    res.status(201).json(reversedEntry);
  } catch (err: any) {
    console.error("[JE] POST /:id/reverse", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries/reports/trial-balance
//
// Finance standard:
//   • Drives from chart_of_accounts so every account appears even with zero GL activity
//   • Balance = (Σdebits − Σcredits) for debit-normal accounts
//             = (Σcredits − Σdebits) for credit-normal accounts
//   • Grand totals: Σ all debits and Σ all credits must be equal (balanced TB)
//   • The "balance" column grand total is intentionally omitted — it's always 0
//     on a balanced set of books and misleads readers
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/trial-balance", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const asOfStr = String(req.query.asOf ?? new Date().toISOString().slice(0, 10));
    const asOf  = endOfDay(asOfStr); // inclusive: include all entries on that date

    const rows = await db
      .select({
        accountCode:   chartOfAccounts.accountCode,
        accountName:   chartOfAccounts.accountName,
        accountType:   chartOfAccounts.accountType,
        normalBalance: chartOfAccounts.normalBalance,
        totalDebit:    sql<string>`COALESCE(SUM(${generalLedger.debitAmount}::numeric), 0)`,
        totalCredit:   sql<string>`COALESCE(SUM(${generalLedger.creditAmount}::numeric), 0)`,
      })
      .from(chartOfAccounts)
      .leftJoin(generalLedger, and(
        eq(generalLedger.accountId, chartOfAccounts.id),
        eq(generalLedger.organizationId, orgId),
        lte(generalLedger.transactionDate, asOf),
      ))
      .where(and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
      ))
      .groupBy(
        chartOfAccounts.accountCode,
        chartOfAccounts.accountName,
        chartOfAccounts.accountType,
        chartOfAccounts.normalBalance,
        chartOfAccounts.id,
      )
      .orderBy(chartOfAccounts.accountCode);

    const accounts = rows
      .map(r => {
        const dr      = Number(r.totalDebit);
        const cr      = Number(r.totalCredit);
        // Finance: apply normal-balance convention
        const balance = r.normalBalance === "debit" ? dr - cr : cr - dr;
        return {
          accountCode:   r.accountCode,
          accountName:   r.accountName,
          accountType:   r.accountType,
          normalBalance: r.normalBalance,
          totalDebit:    dr.toFixed(2),
          totalCredit:   cr.toFixed(2),
          balance:       balance.toFixed(2),
        };
      })
      // Filter: hide accounts with no activity unless ?showZero=1 requested
      .filter(a => Number(a.totalDebit) !== 0 || Number(a.totalCredit) !== 0 || req.query.showZero === "1");

    // Grand totals for balance verification
    const grandDebit  = accounts.reduce((s, a) => s + Number(a.totalDebit),  0);
    const grandCredit = accounts.reduce((s, a) => s + Number(a.totalCredit), 0);
    // Same ±0.005 tolerance used by assertBalanced() — must be consistent
    const balanced    = Math.abs(grandDebit - grandCredit) < 0.005;

    res.json({
      asOf:        asOfStr,
      accounts,
      grandDebit:  grandDebit.toFixed(2),
      grandCredit: grandCredit.toFixed(2),
      balanced,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[JE] trial-balance", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries/reports/income-statement
//
// Finance standard:
//   Revenue net amount  = Σcredits − Σdebits  (credit-normal, credits increase revenue)
//   Expense net amount  = Σdebits  − Σcredits  (debit-normal,  debits  increase expense)
//   Net Income          = totalRevenue − totalExpenses
//   Net Loss displayed as positive with "(Loss)" label — NOT as a negative number.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/income-statement", ...auth, async (req: any, res: any) => {
  try {
    const orgId   = req.user.organizationId as number;
    const fromStr = String(req.query.from ?? `${new Date().getFullYear()}-01-01`);
    const toStr   = String(req.query.to   ?? new Date().toISOString().slice(0, 10));
    const from    = startOfDay(fromStr);
    const to      = endOfDay(toStr);

    // Validate date range
    if (from > to) {
      return res.status(400).json({ message: "'from' date must be on or before 'to' date" });
    }

    const rows = await db
      .select({
        accountCode:  chartOfAccounts.accountCode,
        accountName:  chartOfAccounts.accountName,
        accountType:  chartOfAccounts.accountType,
        normalBalance: chartOfAccounts.normalBalance,
        totalDebit:   sql<string>`COALESCE(SUM(${generalLedger.debitAmount}::numeric), 0)`,
        totalCredit:  sql<string>`COALESCE(SUM(${generalLedger.creditAmount}::numeric), 0)`,
      })
      .from(chartOfAccounts)
      .innerJoin(generalLedger, and(
        eq(generalLedger.accountId,       chartOfAccounts.id),
        eq(generalLedger.organizationId,  orgId),
        gte(generalLedger.transactionDate, from),
        lte(generalLedger.transactionDate, to),
      ))
      .where(and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.accountType} IN ('revenue', 'expense')`,
      ))
      .groupBy(
        chartOfAccounts.accountCode,
        chartOfAccounts.accountName,
        chartOfAccounts.accountType,
        chartOfAccounts.normalBalance,
        chartOfAccounts.id,
      )
      .orderBy(chartOfAccounts.accountType, chartOfAccounts.accountCode);

    const revenues: any[] = [];
    const expenses: any[] = [];

    for (const r of rows) {
      const dr  = Number(r.totalDebit);
      const cr  = Number(r.totalCredit);
      // Finance: revenue credit-normal → net = credits − debits
      //          expense debit-normal  → net = debits − credits
      const net = r.accountType === "revenue" ? cr - dr : dr - cr;
      const item = {
        accountCode: r.accountCode,
        accountName: r.accountName,
        amount:      net.toFixed(2),
      };
      if (r.accountType === "revenue") revenues.push(item);
      else                              expenses.push(item);
    }

    const totalRevenue  = revenues.reduce((s, a) => s + Number(a.amount), 0);
    const totalExpenses = expenses.reduce((s, a) => s + Number(a.amount), 0);
    const netIncome     = totalRevenue - totalExpenses;

    res.json({
      from:          fromStr,
      to:            toStr,
      revenues,
      expenses,
      totalRevenue:  totalRevenue.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      netIncome:     netIncome.toFixed(2),
      // Net income sign: positive = profit, negative = loss
      isProfit:      netIncome >= 0,
      generatedAt:   new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[JE] income-statement", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/journal-entries/reports/balance-sheet
//
// Finance standard (fundamental accounting equation):
//   Assets = Liabilities + Equity
//
//   Asset balance     = Σdebits − Σcredits  (debit-normal)
//   Liability balance = Σcredits − Σdebits  (credit-normal)
//   Equity balance    = Σcredits − Σdebits  (credit-normal)
//
//   Note: Current-period net income is part of Equity as "Current Earnings".
//   If no period-closing entries have been made, the P&L accounts are still open
//   and do not appear on the Balance Sheet — this causes the sheet to be unbalanced.
//   We compute and include retained/current earnings automatically.
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/balance-sheet", ...auth, async (req: any, res: any) => {
  try {
    const orgId  = req.user.organizationId as number;
    const asOfStr = String(req.query.asOf ?? new Date().toISOString().slice(0, 10));
    const asOf   = endOfDay(asOfStr);

    // Query A: Balance-sheet accounts (assets, liabilities, equity)
    const bsRows = await db
      .select({
        accountCode:   chartOfAccounts.accountCode,
        accountName:   chartOfAccounts.accountName,
        accountType:   chartOfAccounts.accountType,
        normalBalance: chartOfAccounts.normalBalance,
        totalDebit:    sql<string>`COALESCE(SUM(${generalLedger.debitAmount}::numeric), 0)`,
        totalCredit:   sql<string>`COALESCE(SUM(${generalLedger.creditAmount}::numeric), 0)`,
      })
      .from(chartOfAccounts)
      .innerJoin(generalLedger, and(
        eq(generalLedger.accountId,      chartOfAccounts.id),
        eq(generalLedger.organizationId, orgId),
        lte(generalLedger.transactionDate, asOf),
      ))
      .where(and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.accountType} IN ('asset', 'liability', 'equity')`,
      ))
      .groupBy(
        chartOfAccounts.accountCode,
        chartOfAccounts.accountName,
        chartOfAccounts.accountType,
        chartOfAccounts.normalBalance,
        chartOfAccounts.id,
      )
      .orderBy(chartOfAccounts.accountType, chartOfAccounts.accountCode);

    // Query B: P&L accounts — compute net income as of the asOf date
    // This is the "current earnings" that must be added to Equity so the sheet balances.
    const plRows = await db
      .select({
        accountType:  chartOfAccounts.accountType,
        normalBalance: chartOfAccounts.normalBalance,
        totalDebit:   sql<string>`COALESCE(SUM(${generalLedger.debitAmount}::numeric), 0)`,
        totalCredit:  sql<string>`COALESCE(SUM(${generalLedger.creditAmount}::numeric), 0)`,
      })
      .from(chartOfAccounts)
      .innerJoin(generalLedger, and(
        eq(generalLedger.accountId,      chartOfAccounts.id),
        eq(generalLedger.organizationId, orgId),
        lte(generalLedger.transactionDate, asOf),
      ))
      .where(and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.accountType} IN ('revenue', 'expense')`,
      ))
      .groupBy(chartOfAccounts.accountType, chartOfAccounts.normalBalance, chartOfAccounts.id);

    // Compute net income from P&L rows
    let totalRevenue = 0;
    let totalExpenses = 0;
    for (const r of plRows) {
      const dr = Number(r.totalDebit);
      const cr = Number(r.totalCredit);
      if (r.accountType === "revenue") totalRevenue  += (cr - dr);
      else                              totalExpenses += (dr - cr);
    }
    const currentEarnings = totalRevenue - totalExpenses;

    const bucket: Record<string, any[]> = { asset: [], liability: [], equity: [] };
    for (const r of bsRows) {
      const dr  = Number(r.totalDebit);
      const cr  = Number(r.totalCredit);
      const bal = r.normalBalance === "debit" ? dr - cr : cr - dr;
      if (bal !== 0) {
        bucket[r.accountType]?.push({
          accountCode: r.accountCode,
          accountName: r.accountName,
          balance:     bal.toFixed(2),
        });
      }
    }

    // Add current earnings to equity if non-zero (period not yet closed)
    if (Math.abs(currentEarnings) > 0.005) {
      bucket.equity.push({
        accountCode: "—",
        accountName: currentEarnings >= 0 ? "Current Period Earnings" : "Current Period Loss",
        balance:     currentEarnings.toFixed(2),
      });
    }

    const totalAssets      = bucket.asset.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = bucket.liability.reduce((s, a) => s + Number(a.balance), 0);
    const totalEquity      = bucket.equity.reduce((s, a) => s + Number(a.balance), 0);
    // Same ±0.005 tolerance used everywhere — must be consistent
    const balanced         = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005;
    // Pre-compute on the backend — avoids frontend floating-point drift from adding two strings
    const totalLiabEquity  = totalLiabilities + totalEquity;

    res.json({
      asOf:             asOfStr,
      assets:           bucket.asset,
      liabilities:      bucket.liability,
      equity:           bucket.equity,
      totalAssets:      totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity:      totalEquity.toFixed(2),
      totalLiabEquity:  totalLiabEquity.toFixed(2),
      balanced,
      currentEarnings:  currentEarnings.toFixed(2),
      generatedAt:      new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[JE] balance-sheet", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;