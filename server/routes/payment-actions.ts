/**
 * Rent payment action routes
 * (mark-paid, apply-late-fee, send-reminder, generate-invoice-number)
 */
import { Router } from "express";
import { db } from "../db";
import { rentPayments, tenants, units, properties } from "@shared/schema";
import { eq, sql, desc, and, gte, lte, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { z } from "zod";
import { notifyPaymentConfirmed } from "../ws";
import { whatsappService } from "../whatsapp";
import { submitInvoice } from "../services/etims";

const router = Router();

// ── GET /api/rent-payments ────────────────────────────────────────────────────
// Returns paginated rent payments for the org, with tenant name joined.
// Query params: page (default 1), page_size (default 20), status, search, tenantId
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId    = req.user.organizationId as number;
    const role     = req.user.role as string;
    const page     = Math.max(1, parseInt((req.query.page      as string) || "1",  10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.page_size as string) || "20", 10)));
    const statusFilter  = req.query.status   as string | undefined;
    const searchQuery   = (req.query.search  as string | undefined)?.toLowerCase();
    const tenantIdParam = req.query.tenantId as string | undefined;

    const tenantName = sql<{ firstName: string; lastName: string } | null>`
      CASE
        WHEN ${tenants.id} IS NOT NULL
        THEN jsonb_build_object(
          'firstName', ${tenants.firstName},
          'lastName',  ${tenants.lastName}
        )
        ELSE NULL
      END
    `;

    // Always INNER JOIN on tenants so org scoping is enforced in the join,
    // guaranteeing payments from other orgs can never leak through.
    const tenantJoinConditions: any[] = [
      eq(rentPayments.tenantId, tenants.id),
      eq(tenants.organizationId, orgId),  // ← org gate: only this org's tenants
    ];

    if (searchQuery) {
      tenantJoinConditions.push(
        sql`LOWER(COALESCE(${tenants.firstName}, '') || ' ' || COALESCE(${tenants.lastName}, '')) LIKE ${'%' + searchQuery + '%'}`
      );
    }

    // Payment-level WHERE conditions
    const paymentConditions: any[] = [];
    if (statusFilter && statusFilter !== "all") {
      paymentConditions.push(eq(rentPayments.status, statusFilter));
    }
    // If a specific tenant is requested, enforce it here (in WHERE, not JOIN)
    // after the INNER JOIN already confirmed org membership.
    if (tenantIdParam) {
      const tid = parseInt(tenantIdParam, 10);
      if (!isNaN(tid)) paymentConditions.push(eq(rentPayments.tenantId, tid));
    }

    // Landlords only ever see payments for tenants in properties they own —
    // previously this endpoint only scoped by org, so in a multi-landlord org
    // a landlord could see every OTHER landlord's tenants' payments too.
    if (role === "landlord") {
      const ownedTenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(eq(tenants.organizationId, orgId), eq(properties.ownerId, req.user.id)));
      const ownedTenantIds = ownedTenantRows.map(r => r.id);
      paymentConditions.push(
        ownedTenantIds.length > 0 ? inArray(rentPayments.tenantId, ownedTenantIds) : sql`false`
      );
    }

    const whereClause = paymentConditions.length ? and(...paymentConditions) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(rentPayments)
      .innerJoin(tenants, and(...tenantJoinConditions))   // INNER — drops cross-org rows
      .where(whereClause);

    const results = await db
      .select({
        id:                 rentPayments.id,
        tenantId:           rentPayments.tenantId,
        amount:             rentPayments.amount,
        currency:           rentPayments.currency,
        dueDate:            rentPayments.dueDate,
        paidDate:           rentPayments.paidDate,
        status:             rentPayments.status,
        paymentMethod:      rentPayments.paymentMethod,
        mpesaTransactionId: rentPayments.mpesaTransactionId,
        bankReference:      rentPayments.bankReference,
        ussdSessionId:      rentPayments.ussdSessionId,
        invoiceNumber:      rentPayments.invoiceNumber,
        notes:              rentPayments.notes,
        createdAt:          rentPayments.createdAt,
        updatedAt:          rentPayments.updatedAt,
        tenant:             tenantName,
      })
      .from(rentPayments)
      .innerJoin(tenants, and(...tenantJoinConditions))   // INNER — drops cross-org rows
      .where(whereClause)
      .orderBy(desc(rentPayments.dueDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalCount = Number(total);
    const totalPages = Math.ceil(totalCount / pageSize);

    res.json({
      count:    totalCount,
      next:     page < totalPages ? `?page=${page + 1}&page_size=${pageSize}` : null,
      previous: page > 1         ? `?page=${page - 1}&page_size=${pageSize}` : null,
      results,
    });
  } catch (error) {
    console.error("Rent payments list error:", error);
    res.status(500).json({ message: "Failed to fetch rent payments" });
  }
});

// ── GET /api/rent-payments/stats ─────────────────────────────────────────────
// Live aggregation of rent-collection KPIs for the caller's organisation.
// ?month=YYYY-MM  — scope to a specific month (defaults to current calendar month)
// ?all=1          — aggregate across all time (for the finances overview "all time" filter)
router.get("/stats", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role;
    const allTime = req.query.all === "1";

    // Default: current month
    const now = new Date();
    const monthParam = req.query.month as string | undefined; // e.g. "2025-06"
    const [y, m] = monthParam
      ? monthParam.split("-").map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const periodStart = new Date(y, m - 1, 1);
    const periodEnd   = new Date(y, m, 0, 23, 59, 59, 999); // last millisecond of last day

    const conditions: any[] = [eq(tenants.organizationId, orgId)];
    if (!allTime) {
      // Filter by dueDate within the period — this shows what was expected this month
      conditions.push(
        gte(rentPayments.dueDate, periodStart.toISOString().slice(0, 10)),
        lte(rentPayments.dueDate, periodEnd.toISOString().slice(0, 10)),
      );
    }

    // Landlords only ever see stats for their own properties' tenants —
    // previously org-only, so a landlord's KPIs would be mixed with every
    // other landlord's numbers in a multi-landlord org.
    if (role === "landlord") {
      const ownedTenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(eq(tenants.organizationId, orgId), eq(properties.ownerId, req.user.id)));
      const ownedTenantIds = ownedTenantRows.map(r => r.id);
      conditions.push(ownedTenantIds.length > 0 ? inArray(rentPayments.tenantId, ownedTenantIds) : sql`false`);
    }

    const rows = await db
      .select({ status: rentPayments.status, amount: rentPayments.amount })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(...conditions));

    let collected = 0, collectedCount = 0;
    let pending   = 0, pendingCount   = 0;
    let overdue   = 0, overdueCount   = 0;

    for (const row of rows) {
      const amt = Number(row.amount ?? 0);
      const st  = row.status ?? "";
      if (st === "paid" || st === "completed") {
        collected += amt; collectedCount++;
      } else if (st === "overdue") {
        overdue += amt; overdueCount++;
      } else {
        pending += amt; pendingCount++;
      }
    }

    // Finance-correct collection rate: collected ÷ total expected (value-based, not count-based)
    const totalExpected = collected + pending + overdue;
    const collectionRate = totalExpected > 0
      ? Math.round((collected / totalExpected) * 1000) / 10
      : 0;

    res.json({
      collected, collectedCount,
      pending,   pendingCount,
      overdue,   overdueCount,
      total: rows.length,
      totalExpected,
      collectionRate,
      period: allTime ? "all" : `${y}-${String(m).padStart(2, "0")}`,
    });
  } catch (error) {
    console.error("Rent payment stats error:", error);
    res.status(500).json({ message: "Failed to fetch rent payment stats" });
  }
});

/** Verifies a rent payment belongs to the caller's org (and, for a landlord,
 *  to a tenant in a property they own). Sends a 404 and returns null if not —
 *  callers should `if (!payment) return;` immediately after calling this. */
async function requireOwnedRentPayment(req: any, res: any): Promise<typeof rentPayments.$inferSelect | null> {
  const id = parseInt(req.params.id);
  const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, id)).limit(1);
  if (!payment) { res.status(404).json({ message: "Payment not found" }); return null; }

  const [tenant] = await db.select({ organizationId: tenants.organizationId, unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, payment.tenantId)).limit(1);
  if (!tenant || tenant.organizationId !== req.user.organizationId) {
    res.status(404).json({ message: "Payment not found" });
    return null;
  }

  if (req.user.role === "landlord") {
    if (!tenant.unitId) { res.status(404).json({ message: "Payment not found" }); return null; }
    const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
    const [prop] = unit?.propertyId
      ? await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1)
      : [undefined];
    if (!prop || prop.ownerId !== req.user.id) { res.status(404).json({ message: "Payment not found" }); return null; }
  }

  return payment;
}

// POST /api/rent-payments/:id/mark-paid
router.post("/:id/mark-paid", authenticateJWT, auditLog("rent_payment", "ACTION"), async (req: any, res) => {
  try {
    const owned = await requireOwnedRentPayment(req, res);
    if (!owned) return;

    const id = parseInt(req.params.id);
    const schema = z.object({
      paidDate: z.string(),
      paymentMethod: z.string(),
      transactionId: z.string().optional(),
      bankReference: z.string().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const payment = await storage.markPaymentAsPaid(id, data);

    // Auto-post rent receipt to general ledger (double-entry)
    // Debit: Cash & Bank (asset increases) / Credit: Rental Income (revenue increases)
    try {
      const orgId: number = req.user.organizationId;
      const accounts = await storage.getChartOfAccounts(orgId);
      const cashAcc = accounts?.find((a: any) => a.accountName === "Cash & Bank");
      const revAcc  = accounts?.find((a: any) => a.accountName === "Rental Income");
      const amount  = parseFloat(String(payment.amount ?? 0));
      if (cashAcc && revAcc && amount > 0) {
        const txDate = payment.paidDate ? new Date(payment.paidDate) : new Date();
        const journalRef = `GL-RENT-${payment.invoiceNumber ?? payment.id}`;
        const fiscalYear   = txDate.getFullYear();
        const fiscalPeriod = txDate.getMonth() + 1;
        await storage.createGeneralLedgerEntry({
          organizationId: orgId,
          createdBy: req.user.id,
          transactionId: `${journalRef}-DR`,
          accountId: cashAcc.id,
          debitAmount: amount, creditAmount: 0,
          description: `Rent received: ${payment.invoiceNumber ?? `Payment #${payment.id}`}`,
          reference: journalRef,
          transactionDate: txDate,
          fiscalYear, fiscalPeriod, currency: payment.currency ?? "KES",
        });
        await storage.createGeneralLedgerEntry({
          organizationId: orgId,
          createdBy: req.user.id,
          transactionId: `${journalRef}-CR`,
          accountId: revAcc.id,
          debitAmount: 0, creditAmount: amount,
          description: `Rent received: ${payment.invoiceNumber ?? `Payment #${payment.id}`}`,
          reference: journalRef,
          transactionDate: txDate,
          fiscalYear, fiscalPeriod, currency: payment.currency ?? "KES",
        });
      }
    } catch (glErr) {
      console.error("[GL] Rent payment auto-post failed (non-fatal):", glErr);
    }

    notifyPaymentConfirmed(req.user.organizationId, {
      id: payment.id,
      amount: Number(payment.amount ?? 0),
      invoiceNumber: payment.invoiceNumber ?? undefined,
    });

    // WhatsApp confirmation to tenant (non-fatal)
    if (payment.tenantId) {
      try {
        const [tenant] = await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            phone: tenants.phone,
            currency: tenants.currency,
          })
          .from(tenants)
          .where(eq(tenants.id, payment.tenantId))
          .limit(1);

        if (tenant?.phone) {
          const name = `${tenant.firstName} ${tenant.lastName}`.trim();
          await whatsappService.sendPaymentConfirmation(
            tenant.phone,
            name,
            Number(payment.amount ?? 0).toLocaleString(),
            data.paymentMethod,
            tenant.currency ?? "KES",
            req.user.organizationId
          );
        }
      } catch (waErr) {
        console.error("[WhatsApp] Payment confirmation failed (non-fatal):", waErr);
      }
    }

    // ── eTIMS auto-submission ──────────────────────────────────────────────────
    // Submit the rent payment to KRA eTIMS immediately on confirmation.
    // Non-fatal: a network or config failure must never roll back a payment.
    // The submission is logged and can be retried from the eTIMS dashboard.
    try {
      const orgId: number = req.user.organizationId;
      const etims = await submitInvoice(orgId, "rent_payment", payment.id);
      console.log(
        `[eTIMS] Payment #${payment.id} submitted — rcptNo: ${etims.rcptNo ?? "sandbox"}`
      );
    } catch (etimsErr: any) {
      console.error("[eTIMS] Auto-submission failed (non-fatal):", etimsErr.message);
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Kenyan Landlord and Tenant Act: receipts for all payments ─────────────
    // The Act requires landlords to issue receipts for all payments. M-Pesa
    // payments are covered by the WhatsApp confirmation above. For cash and
    // bank-transfer payments recorded manually, we generate and attach a receipt
    // to the response so the manager can print or forward it to the tenant.
    let receiptData: Record<string, any> | null = null;
    const method = (data.paymentMethod ?? "").toLowerCase();
    if (method !== "mpesa" && method !== "m-pesa") {
      try {
        const [tenant] = await db
          .select({
            firstName: tenants.firstName,
            lastName:  tenants.lastName,
            phone:     tenants.phone,
            email:     tenants.email,
          })
          .from(tenants)
          .where(eq(tenants.id, payment.tenantId!))
          .limit(1);

        const receiptNumber = `RCP-${payment.invoiceNumber ?? payment.id}-${Date.now().toString(36).toUpperCase()}`;
        receiptData = {
          receiptNumber,
          paymentId:     payment.id,
          invoiceNumber: payment.invoiceNumber,
          tenantName:    tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "Tenant",
          tenantPhone:   tenant?.phone ?? null,
          tenantEmail:   tenant?.email ?? null,
          amount:        Number(payment.amount ?? 0),
          currency:      payment.currency ?? "KES",
          paidDate:      data.paidDate,
          paymentMethod: data.paymentMethod,
          reference:     data.bankReference ?? data.transactionId ?? null,
          notes:         data.notes ?? null,
          issuedAt:      new Date().toISOString(),
          // Flag so the UI knows to offer a print/send action
          requiresIssuance: true,
        };

        console.log(`[Receipt] Generated ${receiptNumber} for ${method} payment #${payment.id}`);
      } catch (rcptErr) {
        console.error("[Receipt] Generation failed (non-fatal):", rcptErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    res.json({ ...payment, receipt: receiptData });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Mark paid error:", error);
    res.status(500).json({ message: "Failed to mark payment as paid" });
  }
});

// POST /api/rent-payments/:id/apply-late-fee
router.post("/:id/apply-late-fee", authenticateJWT, auditLog("rent_payment", "ACTION"), async (req: any, res) => {
  try {
    const owned = await requireOwnedRentPayment(req, res);
    if (!owned) return;

    const id = parseInt(req.params.id);
    const schema = z.object({ lateFeeAmount: z.string() });
    const { lateFeeAmount } = schema.parse(req.body);
    const payment = await storage.applyLateFee(id, lateFeeAmount);
    res.json(payment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Late fee error:", error);
    res.status(500).json({ message: "Failed to apply late fee" });
  }
});

// POST /api/rent-payments/:id/send-reminder
router.post("/:id/send-reminder", authenticateJWT, auditLog("rent_payment", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const payment = await requireOwnedRentPayment(req, res);
    if (!payment) return;

    let whatsappSent = false;

    if (payment.tenantId) {
      try {
        const [tenant] = await db
          .select({
            firstName: tenants.firstName,
            lastName: tenants.lastName,
            phone: tenants.phone,
            currency: tenants.currency,
          })
          .from(tenants)
          .where(eq(tenants.id, payment.tenantId))
          .limit(1);

        if (tenant?.phone) {
          const name = `${tenant.firstName} ${tenant.lastName}`.trim();
          const dueDate = payment.dueDate
            ? new Date(payment.dueDate).toLocaleDateString("en-KE")
            : "soon";
          whatsappSent = await whatsappService.sendRentReminder(
            tenant.phone,
            name,
            Number(payment.amount ?? 0).toLocaleString(),
            dueDate,
            tenant.currency ?? "KES",
            req.user.organizationId
          );
        }
      } catch (waErr) {
        console.error("[WhatsApp] Rent reminder failed (non-fatal):", waErr);
      }
    }

    res.json({ success: true, message: "Reminder sent", paymentId: id, whatsappSent });
  } catch (error) {
    console.error("Send reminder error:", error);
    res.status(500).json({ message: "Failed to send reminder" });
  }
});

// GET /api/rent-collections/generate-invoice-number
router.get("/generate-invoice-number", authenticateJWT, async (_req, res) => {
  try {
    const invoiceNumber = await storage.generateInvoiceNumber();
    res.json({ invoiceNumber });
  } catch (error) {
    console.error("Invoice number error:", error);
    res.status(500).json({ message: "Failed to generate invoice number" });
  }
});

// POST /api/rent-payments — create a new rent payment record
router.post("/", authenticateJWT, requireOrg, auditLog("rent_payment", "CREATE"), async (req: any, res) => {
  try {
    const schema = z.object({
      tenantId:      z.number(),
      amount:        z.string(),
      currency:      z.string().default("KES"),
      dueDate:       z.string(),
      paidDate:      z.string().optional(),
      paymentMethod: z.string().optional(),
      status:        z.enum(["pending", "paid", "overdue", "partial"]).default("pending"),
      notes:         z.string().optional(),
      invoiceNumber: z.string().optional(),
      mpesaTransactionId: z.string().optional(),
      bankReference: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const payment = await storage.createRentPayment(data);
    res.status(201).json(payment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Create payment error:", error);
    res.status(500).json({ message: "Failed to create payment" });
  }
});

// GET /api/rent-payments/export — CSV export of all payments for the org
router.get("/export", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId        = req.user.organizationId as number;
    const role         = req.user.role as string;
    const statusFilter = req.query.status as string | undefined;
    const searchQuery  = (req.query.search as string | undefined)?.toLowerCase();

    const tenantJoinConditions: any[] = [
      eq(rentPayments.tenantId, tenants.id),
      eq(tenants.organizationId, orgId),
    ];
    if (searchQuery) {
      tenantJoinConditions.push(
        sql`LOWER(COALESCE(${tenants.firstName}, '') || ' ' || COALESCE(${tenants.lastName}, '')) LIKE ${'%' + searchQuery + '%'}`
      );
    }

    const paymentConditions: any[] = [];
    if (statusFilter && statusFilter !== "all") {
      paymentConditions.push(eq(rentPayments.status, statusFilter));
    }

    // Landlords only ever export their own properties' payments — same rule
    // as GET / and /stats above.
    if (role === "landlord") {
      const ownedTenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(eq(tenants.organizationId, orgId), eq(properties.ownerId, req.user.id)));
      const ownedTenantIds = ownedTenantRows.map(r => r.id);
      paymentConditions.push(ownedTenantIds.length > 0 ? inArray(rentPayments.tenantId, ownedTenantIds) : sql`false`);
    }

    const rows = await db
      .select({
        id:            rentPayments.id,
        invoiceNumber: rentPayments.invoiceNumber,
        amount:        rentPayments.amount,
        currency:      rentPayments.currency,
        dueDate:       rentPayments.dueDate,
        paidDate:      rentPayments.paidDate,
        status:        rentPayments.status,
        paymentMethod: rentPayments.paymentMethod,
        notes:         rentPayments.notes,
        firstName:     tenants.firstName,
        lastName:      tenants.lastName,
      })
      .from(rentPayments)
      .leftJoin(tenants, and(...tenantJoinConditions))
      .where(paymentConditions.length ? and(...paymentConditions) : undefined)
      .orderBy(desc(rentPayments.dueDate));

    const header = "ID,Invoice,Tenant,Amount,Currency,Due Date,Paid Date,Status,Payment Method,Notes";
    const csvRows = rows.map(r => [
      r.id,
      r.invoiceNumber ?? "",
      `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
      r.amount,
      r.currency,
      r.dueDate ?? "",
      r.paidDate ?? "",
      r.status,
      r.paymentMethod ?? "",
      `"${(r.notes ?? "").replace(/"/g, '""')}"`,
    ].join(","));

    const csv = [header, ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="rent-payments-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ message: "Failed to export payments" });
  }
});


// ── DELETE /api/rent-payments/:id ─────────────────────────────────────────────
// Allows managers to delete erroneous/duplicate invoices (pending/overdue only).
// Paid invoices cannot be deleted to preserve audit trail.
router.delete("/:id", authenticateJWT, requireOrg, auditLog("rent_payment", "DELETE"), async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId = req.user.organizationId as number;

    // Verify the payment belongs to this org and is not paid
    const [payment] = await db
      .select({ id: rentPayments.id, status: rentPayments.status, tenantId: rentPayments.tenantId })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(eq(rentPayments.id, id), eq(tenants.organizationId, orgId)))
      .limit(1);

    if (!payment) return res.status(404).json({ message: "Payment not found" });
    if (payment.status === "paid") {
      return res.status(409).json({ message: "Cannot delete a paid invoice. Reverse it instead." });
    }

    await db.delete(rentPayments).where(eq(rentPayments.id, id));
    res.status(204).send();
  } catch (error) {
    console.error("Delete payment error:", error);
    res.status(500).json({ message: "Failed to delete payment" });
  }
});

// ── POST /api/rent-payments/dedup-cleanup ─────────────────────────────────────
// One-shot idempotent endpoint: for each tenant, keeps only the EARLIEST
// pending/overdue invoice per calendar month and deletes the rest.
// Safe to call multiple times. Paid records are never touched.
router.post("/dedup-cleanup", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number;

    // Fetch all non-paid payments for this org ordered oldest-first
    const rows = await db
      .select({
        id:            rentPayments.id,
        tenantId:      rentPayments.tenantId,
        dueDate:       rentPayments.dueDate,
        status:        rentPayments.status,
        invoiceNumber: rentPayments.invoiceNumber,
      })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(
        and(
          eq(tenants.organizationId, orgId),
          sql`${rentPayments.status} IN ('pending', 'overdue')`
        )
      )
      .orderBy(rentPayments.tenantId, rentPayments.createdAt);

    // Group by tenantId + calendar month of due date
    const seen = new Map<string, number>(); // "tenantId|YYYY-MM" -> first id
    const toDelete: number[] = [];

    for (const row of rows) {
      const month = String(row.dueDate ?? "").slice(0, 7); // "YYYY-MM"
      if (!month) continue;
      const key = `${row.tenantId}|${month}`;
      if (seen.has(key)) {
        toDelete.push(row.id); // duplicate — mark for deletion
      } else {
        seen.set(key, row.id); // first seen — keep
      }
    }

    if (toDelete.length === 0) {
      return res.json({ message: "No duplicates found", deleted: 0 });
    }

    await db.delete(rentPayments).where(sql`${rentPayments.id} = ANY(${toDelete})`);
    console.log(`[dedup-cleanup] Deleted ${toDelete.length} duplicate invoice(s) for org ${orgId}`);
    res.json({ message: `Cleaned up ${toDelete.length} duplicate invoice(s)`, deleted: toDelete.length });
  } catch (error) {
    console.error("Dedup cleanup error:", error);
    res.status(500).json({ message: "Failed to run dedup cleanup" });
  }
});

export default router;