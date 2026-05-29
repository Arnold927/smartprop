/**
 * Enterprise Finance Routes
 * Registers API endpoints for:
 *   - Purchase Requisitions  → /api/purchase-requisitions
 *   - Expense Reports        → /api/expense-reports
 *   - Payroll Periods        → /api/payroll
 *   - General Ledger         → /api/general-ledger
 *   - Chart of Accounts      → /api/chart-of-accounts
 *   - Cost Centers           → /api/cost-centers
 */

import { Router } from "express";
import { storage } from "../storage";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { db } from "../db";
import { payrollRecords, staffMembers } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Purchase Requisitions ────────────────────────────────────────────────────
export const purchaseRequisitionsRouter = Router();

purchaseRequisitionsRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/purchase-requisitions
purchaseRequisitionsRouter.get("/", async (req: any, res: any) => {
  try {
    const { status, requestorId } = req.query;
    const data = await storage.getPurchaseRequisitions(status as string, requestorId as string);
    res.json(data);
  } catch (err: any) {
    console.error("GET /api/purchase-requisitions error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch purchase requisitions" });
  }
});

// POST /api/purchase-requisitions
purchaseRequisitionsRouter.post(
  "/",
  auditLog("purchase_requisition", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createPurchaseRequisition({
        ...req.body,
        organizationId: req.user.organizationId,
        requestorId: req.user.id,
        requestedDate: req.body.requestedDate ?? new Date().toISOString().split("T")[0],
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/purchase-requisitions error:", err);
      res.status(500).json({ message: err.message || "Failed to create purchase requisition" });
    }
  }
);

// PATCH /api/purchase-requisitions/:id/approve
purchaseRequisitionsRouter.patch(
  "/:id/approve",
  auditLog("purchase_requisition", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { level, comments, approverId } = req.body;
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid requisition id" });

      const data = await storage.approvePurchaseRequisition(
        id,
        level ?? "l1",
        approverId ?? req.user.id,
        comments
      );
      res.json(data);
    } catch (err: any) {
      console.error("PATCH /api/purchase-requisitions/:id/approve error:", err);
      res.status(500).json({ message: err.message || "Failed to approve purchase requisition" });
    }
  }
);

// PATCH /api/purchase-requisitions/:id/reject
purchaseRequisitionsRouter.patch(
  "/:id/reject",
  auditLog("purchase_requisition", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body;
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid requisition id" });

      const data = await storage.rejectPurchaseRequisition(id, req.user.id, reason ?? "No reason given");
      res.json(data);
    } catch (err: any) {
      console.error("PATCH /api/purchase-requisitions/:id/reject error:", err);
      res.status(500).json({ message: err.message || "Failed to reject purchase requisition" });
    }
  }
);

// ─── Expense Reports ──────────────────────────────────────────────────────────
export const expenseReportsRouter = Router();

expenseReportsRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/expense-reports
expenseReportsRouter.get("/", async (req: any, res: any) => {
  try {
    const { status, employeeId } = req.query;
    const data = await storage.getExpenseReports(status as string, employeeId as string);
    res.json(data);
  } catch (err: any) {
    console.error("GET /api/expense-reports error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch expense reports" });
  }
});

// POST /api/expense-reports
expenseReportsRouter.post(
  "/",
  auditLog("expense_report", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createExpenseReport({
        ...req.body,
        organizationId: req.user.organizationId,
        employeeId: req.user.id,
        submittedDate: req.body.submittedDate ?? new Date().toISOString().split("T")[0],
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/expense-reports error:", err);
      res.status(500).json({ message: err.message || "Failed to create expense report" });
    }
  }
);

// PATCH /api/expense-reports/:id/approve
expenseReportsRouter.patch(
  "/:id/approve",
  auditLog("expense_report", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { level, comments, approvedBy } = req.body;
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid expense report id" });

      const data = await storage.approveExpenseReport(
        id,
        level ?? "l1",
        approvedBy ?? req.user.id,
        comments
      );

      // Auto-post to general ledger when fully approved (final level)
      const finallyApproved =
        (data as any)?.approvalStatus === "approved" ||
        (data as any)?.approvalStatus === "processed";

      if (finallyApproved) {
        const reports = await storage.getExpenseReports(undefined, undefined);
        const report = (reports as any[]).find((r: any) => r.id === id);
        if (report) {
          await autoPostExpenseToLedger(
            req.user.organizationId,
            req.user.id,
            {
              description: `Expense: ${report.title}`,
              amount: parseFloat(report.totalAmount) || 0,
              reference: report.reportNumber,
              expenseAccountName: expenseTypeToAccountName(report.expenseType),
              transactionDate: report.expenseDate ? new Date(report.expenseDate) : new Date(),
            }
          );
        }
      }

      res.json(data);
    } catch (err: any) {
      console.error("PATCH /api/expense-reports/:id/approve error:", err);
      res.status(500).json({ message: err.message || "Failed to approve expense report" });
    }
  }
);

// PATCH /api/expense-reports/:id/reject
expenseReportsRouter.patch(
  "/:id/reject",
  auditLog("expense_report", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body;
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid expense report id" });

      const data = await storage.rejectExpenseReport(id, req.user.id, reason ?? "No reason given");
      res.json(data);
    } catch (err: any) {
      console.error("PATCH /api/expense-reports/:id/reject error:", err);
      res.status(500).json({ message: err.message || "Failed to reject expense report" });
    }
  }
);

// ─── Payroll ──────────────────────────────────────────────────────────────────
export const payrollRouter = Router();

payrollRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/payroll
payrollRouter.get("/", async (req: any, res: any) => {
  try {
    const { status, year } = req.query;
    const data = await storage.getPayrollPeriods(status as string, year as string);
    res.json(data);
  } catch (err: any) {
    console.error("GET /api/payroll error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch payroll periods" });
  }
});

// POST /api/payroll
payrollRouter.post(
  "/",
  auditLog("payroll_period", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createPayrollPeriod({
        ...req.body,
        organizationId: req.user.organizationId,
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/payroll error:", err);
      res.status(500).json({ message: err.message || "Failed to create payroll period" });
    }
  }
);

// PATCH /api/payroll/:id/process
payrollRouter.patch(
  "/:id/process",
  auditLog("payroll_period", "ACTION") as any,
  async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid payroll id" });

      const { processedBy } = req.body;
      const data = await storage.processPayrollPeriod(id, processedBy ?? req.user.id);

      // Auto-post payroll to general ledger
      const netPay =
        parseFloat((data as any)?.totalNetPay) ||
        parseFloat((data as any)?.totalGrossPay) || 0;

      if (netPay > 0) {
        await autoPostPayrollToLedger(req.user.organizationId, req.user.id, {
          periodName: (data as any)?.periodName ?? `Payroll #${id}`,
          netPay,
          payrollId: id,
          payDate: (data as any)?.payDate ? new Date((data as any).payDate) : new Date(),
        });
      }

      res.json(data);
    } catch (err: any) {
      console.error("PATCH /api/payroll/:id/process error:", err);
      res.status(500).json({ message: err.message || "Failed to process payroll" });
    }
  }
);


// GET /api/payroll/staff/:staffId — payroll records for a single staff member
payrollRouter.get("/staff/:staffId", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const staffId = parseInt(req.params.staffId, 10);
    if (isNaN(staffId)) return res.status(400).json({ message: "Invalid staff id" });
    const [staffRow] = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(and(eq(staffMembers.id, staffId), eq(staffMembers.organization_id, orgId)))
      .limit(1);
    if (!staffRow) return res.status(403).json({ message: "Access denied" });
    const rows = await db
      .select()
      .from(payrollRecords)
      .where(and(eq(payrollRecords.staff_id, staffId), eq(payrollRecords.organization_id, orgId)))
      .orderBy(desc(payrollRecords.pay_period_end))
      .limit(50);
    res.json(rows);
  } catch (err: any) {
    console.error("GET /api/payroll/staff/:staffId error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch payroll records" });
  }
});

// GET /api/payroll/:id/entries
payrollRouter.get("/:id/entries", async (req: any, res: any) => {
  try {
    const periodId = parseInt(req.params.id, 10);
    if (!periodId || isNaN(periodId)) return res.status(400).json({ message: "Invalid payroll period id" });

    const data = await storage.getPayrollEntries(periodId);
    res.json(data);
  } catch (err: any) {
    console.error("GET /api/payroll/:id/entries error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch payroll entries" });
  }
});

// ─── General Ledger ───────────────────────────────────────────────────────────
export const generalLedgerRouter = Router();

generalLedgerRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/general-ledger/export — registered BEFORE the generic GET / handler
// so Express doesn't treat "export" as an :id param
generalLedgerRouter.get("/export", async (req: any, res: any) => {
  try {
    const data = await storage.getGeneralLedgerEntries({
      organizationId: req.user.organizationId,
      limit: 10000,
    });
    const entries = (data as any).entries ?? data;
    res.setHeader("Content-Disposition", `attachment; filename="general-ledger-${Date.now()}.json"`);
    res.json(entries);
  } catch (err: any) {
    console.error("GET /api/general-ledger/export error:", err);
    res.status(500).json({ message: err.message || "Failed to export general ledger" });
  }
});

// GET /api/general-ledger
generalLedgerRouter.get("/", async (req: any, res: any) => {
  try {
    const filters = {
      organizationId: req.user.organizationId,
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 50,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      accountId: req.query.accountId,
      costCenterId: req.query.costCenterId,
    };
    const data = await storage.getGeneralLedgerEntries(filters);
    res.json(data);
  } catch (err: any) {
    console.error("GET /api/general-ledger error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch general ledger" });
  }
});

// POST /api/general-ledger
generalLedgerRouter.post(
  "/",
  auditLog("general_ledger", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createGeneralLedgerEntry({
        ...req.body,
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
        transactionDate: req.body.transactionDate ?? new Date().toISOString(),
        fiscalYear: req.body.fiscalYear ?? new Date().getFullYear(),
        fiscalPeriod: req.body.fiscalPeriod ?? new Date().getMonth() + 1,
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/general-ledger error:", err);
      res.status(500).json({ message: err.message || "Failed to create ledger entry" });
    }
  }
);

// ─── Chart of Accounts ────────────────────────────────────────────────────────
// Standard accounts that are seeded for every new organisation. These IDs are
// assigned by the DB (serial), so we never hard-code numeric IDs on the client.

const SEED_ACCOUNTS = [
  { accountCode: "1001", accountName: "Cash & Bank",             accountType: "asset",     normalBalance: "debit"  },
  { accountCode: "1002", accountName: "Accounts Receivable",     accountType: "asset",     normalBalance: "debit"  },
  { accountCode: "1003", accountName: "Rent Receivable",         accountType: "asset",     normalBalance: "debit"  },
  { accountCode: "1101", accountName: "Land & Buildings",        accountType: "asset",     normalBalance: "debit"  },
  { accountCode: "1102", accountName: "Furniture & Fixtures",    accountType: "asset",     normalBalance: "debit"  },
  { accountCode: "2001", accountName: "Accounts Payable",        accountType: "liability", normalBalance: "credit" },
  { accountCode: "2002", accountName: "Accrued Expenses",        accountType: "liability", normalBalance: "credit" },
  { accountCode: "2003", accountName: "Payroll Payable",         accountType: "liability", normalBalance: "credit" },
  { accountCode: "2101", accountName: "Long-term Loans",         accountType: "liability", normalBalance: "credit" },
  { accountCode: "3001", accountName: "Owner's Equity",          accountType: "equity",    normalBalance: "credit" },
  { accountCode: "3002", accountName: "Retained Earnings",       accountType: "equity",    normalBalance: "credit" },
  { accountCode: "4001", accountName: "Rental Income",           accountType: "revenue",   normalBalance: "credit" },
  { accountCode: "4002", accountName: "Service Charges",         accountType: "revenue",   normalBalance: "credit" },
  { accountCode: "4003", accountName: "Late Fees Income",        accountType: "revenue",   normalBalance: "credit" },
  { accountCode: "5001", accountName: "Salaries & Wages",        accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5002", accountName: "Maintenance Expense",     accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5003", accountName: "Utilities Expense",       accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5004", accountName: "Office Supplies",         accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5005", accountName: "Professional Services",   accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5006", accountName: "Depreciation Expense",    accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5007", accountName: "Security Expense",        accountType: "expense",   normalBalance: "debit"  },
  { accountCode: "5008", accountName: "Travel & Transport",      accountType: "expense",   normalBalance: "debit"  },
];

export const chartOfAccountsRouter = Router();
chartOfAccountsRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/chart-of-accounts
// Returns existing accounts; if none exist yet, seeds the standard set first.
chartOfAccountsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    let accounts = await storage.getChartOfAccounts(orgId);

    if (!accounts || accounts.length === 0) {
      // Seed standard chart of accounts for this organisation
      await storage.seedChartOfAccounts(orgId, SEED_ACCOUNTS);
      accounts = await storage.getChartOfAccounts(orgId);
    }

    res.json(accounts);
  } catch (err: any) {
    console.error("GET /api/chart-of-accounts error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch chart of accounts" });
  }
});

// POST /api/chart-of-accounts
chartOfAccountsRouter.post(
  "/",
  auditLog("chart_of_accounts", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createChartOfAccount({
        ...req.body,
        organizationId: req.user.organizationId,
        normalBalance: req.body.normalBalance ?? (
          ["asset", "expense"].includes(req.body.accountType) ? "debit" : "credit"
        ),
        isActive: true,
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/chart-of-accounts error:", err);
      res.status(500).json({ message: err.message || "Failed to create account" });
    }
  }
);

// ─── Cost Centers ──────────────────────────────────────────────────────────────
export const costCentersRouter = Router();
costCentersRouter.use(authenticateJWT as any, requireOrg as any);

// GET /api/cost-centers
costCentersRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const data = await storage.getCostCenters(orgId);
    res.json(data ?? []);
  } catch (err: any) {
    console.error("GET /api/cost-centers error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch cost centers" });
  }
});

// POST /api/cost-centers
costCentersRouter.post(
  "/",
  auditLog("cost_center", "CREATE") as any,
  async (req: any, res: any) => {
    try {
      const data = await storage.createCostCenter({
        ...req.body,
        organizationId: req.user.organizationId,
        isActive: true,
      });
      res.status(201).json(data);
    } catch (err: any) {
      console.error("POST /api/cost-centers error:", err);
      res.status(500).json({ message: err.message || "Failed to create cost center" });
    }
  }
);

// ─── Auto-posting helpers ──────────────────────────────────────────────────────
// Maps expense report types to their corresponding chart-of-accounts name
function expenseTypeToAccountName(expenseType?: string): string {
  const map: Record<string, string> = {
    travel: "Travel & Transport",
    operational: "Accrued Expenses",
    professional_services: "Professional Services",
    meals: "Accrued Expenses",
    accommodation: "Accrued Expenses",
    supplies: "Office Supplies",
    maintenance: "Maintenance Expense",
    security: "Security Expense",
    utilities: "Utilities Expense",
  };
  return map[expenseType ?? ""] ?? "Accrued Expenses";
}

// When an expense/payroll is approved we auto-create the matching GL entry so
// the ledger always reflects real activity without manual data-entry.

async function autoPostExpenseToLedger(
  orgId: number,
  createdBy: string,
  opts: { description: string; amount: number; reference: string; expenseAccountName?: string; transactionDate?: Date }
) {
  try {
    const accounts = await storage.getChartOfAccounts(orgId);
    const expAcc = accounts?.find((a: any) =>
      a.accountName === (opts.expenseAccountName ?? "Accrued Expenses")
    ) ?? accounts?.find((a: any) => a.accountType === "expense");
    const apAcc = accounts?.find((a: any) => a.accountName === "Accounts Payable");

    if (!expAcc || !apAcc) return; // Silently skip if accounts aren't seeded yet

    // Each GL row requires a unique transactionId — suffix -DR/-CR keeps the
    // double-entry pair identifiable while satisfying the unique constraint.
    const journalRef = `GL-EXP-${opts.reference}-${Date.now()}`;
    const txDate = opts.transactionDate ?? new Date();
    const fiscalYear = txDate.getFullYear();
    const fiscalPeriod = txDate.getMonth() + 1;

    // Debit: Expense account (increases expenses)
    await storage.createGeneralLedgerEntry({
      organizationId: orgId, createdBy,
      transactionId: `${journalRef}-DR`, accountId: expAcc.id,
      debitAmount: opts.amount, creditAmount: 0,
      description: opts.description, reference: journalRef,
      transactionDate: txDate,
      fiscalYear, fiscalPeriod, currency: "KES",
    });
    // Credit: Accounts Payable (increases liability)
    await storage.createGeneralLedgerEntry({
      organizationId: orgId, createdBy,
      transactionId: `${journalRef}-CR`, accountId: apAcc.id,
      debitAmount: 0, creditAmount: opts.amount,
      description: opts.description, reference: journalRef,
      transactionDate: txDate,
      fiscalYear, fiscalPeriod, currency: "KES",
    });
  } catch (e) {
    console.warn("autoPostExpenseToLedger failed (non-fatal):", e);
  }
}

async function autoPostPayrollToLedger(
  orgId: number,
  createdBy: string,
  opts: { periodName: string; netPay: number; payrollId: number; payDate?: Date }
) {
  try {
    const accounts = await storage.getChartOfAccounts(orgId);
    const salAcc = accounts?.find((a: any) => a.accountName === "Salaries & Wages");
    const payAcc = accounts?.find((a: any) => a.accountName === "Payroll Payable");
    if (!salAcc || !payAcc) return;

    const journalRef = `GL-PAY-${opts.payrollId}`;
    const txDate = opts.payDate ?? new Date();
    const fiscalYear = txDate.getFullYear();
    const fiscalPeriod = txDate.getMonth() + 1;

    // Debit: Salaries & Wages (expense increases)
    await storage.createGeneralLedgerEntry({
      organizationId: orgId, createdBy,
      transactionId: `${journalRef}-DR`, accountId: salAcc.id,
      debitAmount: opts.netPay, creditAmount: 0,
      description: `Payroll: ${opts.periodName}`, reference: journalRef,
      transactionDate: txDate,
      fiscalYear, fiscalPeriod, currency: "KES",
    });
    // Credit: Payroll Payable (liability increases)
    await storage.createGeneralLedgerEntry({
      organizationId: orgId, createdBy,
      transactionId: `${journalRef}-CR`, accountId: payAcc.id,
      debitAmount: 0, creditAmount: opts.netPay,
      description: `Payroll: ${opts.periodName}`, reference: journalRef,
      transactionDate: txDate,
      fiscalYear, fiscalPeriod, currency: "KES",
    });
  } catch (e) {
    console.warn("autoPostPayrollToLedger failed (non-fatal):", e);
  }
}