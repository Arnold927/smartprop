/**
 * Rent payment action routes
 * (mark-paid, apply-late-fee, send-reminder, generate-invoice-number)
 */
import { Router } from "express";
import { db } from "../db";
import { rentPayments, tenants, units, properties, mpesaTransactions } from "@shared/schema";
import { eq, sql, desc, and, gte, lte, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { z } from "zod";
import { notifyPaymentConfirmed } from "../ws";
import { whatsappService } from "../whatsapp";
import { submitInvoice } from "../services/etims";
import { applyPayment, rentBalance, rentBalances, receiptsFor, PaymentRuleError, money, round2, todayEAT, validPaidDate, EPS } from "../services/rent-ledger";
import { pushNotification } from "./notifications";

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
    const propertyIdParam = req.query.propertyId ? parseInt(req.query.propertyId as string, 10) : undefined;

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
    // Single-property filter — used by the property details page's Payments
    // tab, so a manager can see just this property's rent payments instead
    // of the whole org's list mixed together.
    if (propertyIdParam) {
      const propTenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .innerJoin(units, eq(tenants.unitId, units.id))
        .where(and(eq(tenants.organizationId, orgId), eq(units.propertyId, propertyIdParam)));
      const propTenantIds = propTenantRows.map(r => r.id);
      paymentConditions.push(propTenantIds.length > 0 ? inArray(rentPayments.tenantId, propTenantIds) : sql`false`);
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

    // paid-to-date and balance, so a part-paid invoice shows what is still owed instead of the full amount
    const bal = await rentBalances(results as any);
    const withBalances = results.map(r => ({ ...r, ...(bal.get(r.id) ?? { paidAmount: 0, balance: money(r.amount) }) }));

    res.json({
      count:    totalCount,
      next:     page < totalPages ? `?page=${page + 1}&page_size=${pageSize}` : null,
      previous: page > 1         ? `?page=${page - 1}&page_size=${pageSize}` : null,
      results:  withBalances,
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
      .select({ id: rentPayments.id, status: rentPayments.status, amount: rentPayments.amount, dueDate: rentPayments.dueDate })
      .from(rentPayments)
      .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(...conditions));

    // Money, not invoice counts: a part-paid invoice contributes what was received to "collected" and only what is
    // STILL owed to pending/overdue (it used to be counted whole as pending, hiding the cash already received).
    const bals = await rentBalances(rows as any);
    const todayStr = todayEAT();
    let collected = 0, collectedCount = 0;
    let pending   = 0, pendingCount   = 0;
    let overdue   = 0, overdueCount   = 0;

    for (const row of rows) {
      const b = bals.get(row.id) ?? { paidAmount: 0, balance: money(row.amount) };
      collected += b.paidAmount;
      if (b.balance <= EPS) { collectedCount++; continue; }
      const pastDue = row.status === "overdue" || String(row.dueDate ?? "") < todayStr;
      if (pastDue) { overdue += b.balance; overdueCount++; } else { pending += b.balance; pendingCount++; }
    }

    // Finance-correct collection rate: collected ÷ total expected (value-based, not count-based)
    const totalExpected = collected + pending + overdue;
    const collectionRate = totalExpected > 0
      ? Math.round((collected / totalExpected) * 1000) / 10
      : 0;

    res.json({
      collected: round2(collected), collectedCount,
      pending:   round2(pending),   pendingCount,
      overdue:   round2(overdue),   overdueCount,
      total: rows.length,
      totalExpected: round2(totalExpected),
      collectionRate,
      period: allTime ? "all" : `${y}-${String(m).padStart(2, "0")}`,
    });
  } catch (error) {
    console.error("Rent payment stats error:", error);
    res.status(500).json({ message: "Failed to fetch rent payment stats" });
  }
});

/** Is this tenant one the caller may bill / collect from? (same org; a landlord only for properties they own) */
async function callerCanUseTenant(req: any, tenantId: number): Promise<boolean> {
  const [tenant] = await db.select({ organizationId: tenants.organizationId, unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.organizationId !== req.user.organizationId) return false;
  if (req.user.role === "landlord") {
    if (!tenant.unitId) return false;
    const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
    const [prop] = unit?.propertyId ? await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1) : [undefined];
    if (!prop || prop.ownerId !== req.user.id) return false;
  }
  return true;
}

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
// Records ONE payment against the invoice. `amount` is optional (defaults to the outstanding balance, i.e. "paid in
// full"); a smaller amount is a part payment and leaves the invoice "partial". Every payment gets its own receipt and
// its own general-ledger posting, and the same invoice cannot be closed twice.
const markPaidSchema = z.object({
  paidDate:      z.string().optional(),
  paymentMethod: z.string().trim().min(1).max(30).optional(),
  amount:        z.union([z.number(), z.string()]).optional(),
  transactionId: z.string().trim().max(100).optional(),
  bankReference: z.string().trim().max(100).optional(),
  notes:         z.string().max(500).optional(),
});

function ruleErrorResponse(res: any, e: unknown): boolean {
  if (e instanceof PaymentRuleError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "ALREADY_PAID" ? 409 : 400;
    res.status(status).json({ message: e.message, code: e.code, ...e.extra });
    return true;
  }
  return false;
}

router.post("/:id/mark-paid", authenticateJWT, auditLog("rent_payment", "ACTION"), async (req: any, res) => {
  try {
    const owned = await requireOwnedRentPayment(req, res);
    if (!owned) return;
    const id = owned.id;

    const parsed = markPaidSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const data = parsed.data;

    const paidDate = (data.paidDate ?? "").slice(0, 10) || todayEAT();
    if (!validPaidDate(paidDate)) return res.status(400).json({ message: "Payment date must be a real date, not in the future." });
    const method = (data.paymentMethod ?? "cash").toLowerCase();

    if (owned.status === "paid" || owned.status === "completed") {
      return res.status(409).json({ message: "This invoice is already paid.", code: "ALREADY_PAID" });
    }
    const bal = await rentBalance(owned);
    let amount = data.amount === undefined || data.amount === "" ? bal.balance : money(data.amount);
    if (!(amount > 0)) return res.status(400).json({ message: "Amount must be greater than zero." });

    const reference = data.bankReference || data.transactionId || null;
    const result = await applyPayment({
      target: { kind: "rent", id }, amount, method, paidDate, reference, notes: data.notes ?? null,
      actorUserId: req.user.id, allowOverpay: false,
    });
    if (!result.applied) return res.status(409).json({ message: "This invoice is already paid.", code: "ALREADY_PAID" });
    const payment = result.record;

    const orgId: number = req.user.organizationId;
    notifyPaymentConfirmed(orgId, { id: payment.id, amount, invoiceNumber: payment.invoiceNumber ?? undefined });

    // tenant: WhatsApp + the portal's notification bell (non-fatal)
    let tenant: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null; currency: string | null; userId: string | null } | undefined;
    if (payment.tenantId) {
      try {
        [tenant] = await db.select({ firstName: tenants.firstName, lastName: tenants.lastName, phone: tenants.phone, email: tenants.email, currency: tenants.currency, userId: tenants.userId })
          .from(tenants).where(eq(tenants.id, payment.tenantId)).limit(1);
        if (tenant?.phone) {
          await whatsappService.sendPaymentConfirmation(tenant.phone, `${tenant.firstName} ${tenant.lastName}`.trim(), amount.toLocaleString(), method, tenant.currency ?? "KES", orgId);
        }
        if (tenant?.userId) {
          pushNotification(tenant.userId, {
            type: "payment",
            title: result.fullyPaid ? "Payment received — invoice settled" : "Part payment received",
            message: `We recorded ${payment.currency ?? "KES"} ${amount.toLocaleString("en-KE")} for ${payment.invoiceNumber ?? "your invoice"}${result.fullyPaid ? "." : `. Balance still due: ${payment.currency ?? "KES"} ${result.balance.toLocaleString("en-KE")}.`} Receipt ${result.receipt!.receiptNumber}.`,
            ts: new Date().toISOString(), link: "/tenant-portal", meta: { rentPaymentId: payment.id },
          });
        }
      } catch (waErr) {
        console.error("[notify] Payment confirmation failed (non-fatal):", waErr);
      }
    }

    // KRA eTIMS — once the invoice is fully settled. Non-fatal; can be retried from the eTIMS dashboard.
    if (result.fullyPaid) {
      try {
        const etims = await submitInvoice(orgId, "rent_payment", payment.id);
        console.log(`[eTIMS] Payment #${payment.id} submitted — rcptNo: ${etims.rcptNo ?? "sandbox"}`);
      } catch (etimsErr: any) {
        console.error("[eTIMS] Auto-submission failed (non-fatal):", etimsErr.message);
      }
    }

    // Kenyan Landlord and Tenant Act: a receipt for every payment. It is stored (payment_receipts), so it can be
    // reprinted from GET /:id/receipts; the response carries it for immediate printing / forwarding.
    const receiptData = {
      receiptNumber: result.receipt!.receiptNumber,
      paymentId:     payment.id,
      invoiceNumber: payment.invoiceNumber,
      tenantName:    tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "Tenant",
      tenantPhone:   tenant?.phone ?? null,
      tenantEmail:   tenant?.email ?? null,
      amount,
      currency:      payment.currency ?? "KES",
      paidDate,
      paymentMethod: method,
      reference,
      notes:         data.notes ?? null,
      invoiceTotal:  money(payment.amount),
      paidToDate:    result.paidAmount,
      balance:       result.balance,
      fullyPaid:     result.fullyPaid,
      issuedAt:      new Date().toISOString(),
      requiresIssuance: method !== "mpesa" && method !== "m-pesa",
    };

    res.json({ ...payment, paidAmount: result.paidAmount, balance: result.balance, receipt: receiptData });
  } catch (error) {
    if (ruleErrorResponse(res, error)) return;
    console.error("Mark paid error:", error);
    res.status(500).json({ message: "Failed to mark payment as paid" });
  }
});

// GET /api/rent-payments/:id/receipts — every receipt issued against the invoice (reprint / audit)
router.get("/:id/receipts", authenticateJWT, async (req: any, res) => {
  try {
    const owned = await requireOwnedRentPayment(req, res);
    if (!owned) return;
    const rows = await receiptsFor({ kind: "rent", id: owned.id });
    const bal = await rentBalance(owned);
    res.json({ invoiceNumber: owned.invoiceNumber, amount: owned.amount, ...bal, receipts: rows });
  } catch (error) {
    console.error("Receipts error:", error);
    res.status(500).json({ message: "Failed to fetch receipts" });
  }
});

// POST /api/rent-payments/:id/apply-late-fee
// One fee per invoice, on an invoice that is unpaid and past its due date. Accepts { lateFeeAmount } (or { amount }).
const LATE_FEE_TAG = "[late-fee";
router.post("/:id/apply-late-fee", authenticateJWT, auditLog("rent_payment", "ACTION"), async (req: any, res) => {
  try {
    const owned = await requireOwnedRentPayment(req, res);
    if (!owned) return;

    const raw = req.body?.lateFeeAmount ?? req.body?.amount;
    const fee = round2(money(raw));
    if (raw === undefined || raw === null || !(fee > 0) || !/^\s*\d+(\.\d+)?\s*$/.test(String(raw))) {
      return res.status(400).json({ message: "Enter the late fee as a positive amount." });
    }
    const base = money(owned.amount);
    if (fee > base) return res.status(400).json({ message: "A late fee cannot be larger than the invoice itself." });

    if (owned.status === "paid" || owned.status === "completed") return res.status(409).json({ message: "This invoice is already paid — a late fee cannot be added." });
    if (String(owned.dueDate ?? "") >= todayEAT()) return res.status(409).json({ message: "This invoice is not past its due date yet." });
    if ((owned.notes ?? "").includes(LATE_FEE_TAG)) return res.status(409).json({ message: "A late fee has already been applied to this invoice." });

    // the WHERE re-checks everything, so two clicks racing cannot both add the fee
    const [updated] = await db.update(rentPayments).set({
      amount: (base + fee).toFixed(2),
      status: owned.status === "partial" ? "partial" : "overdue",
      notes: [owned.notes, `${LATE_FEE_TAG} ${owned.currency ?? "KES"} ${fee.toFixed(2)} added ${todayEAT()}]`].filter(Boolean).join(" | "),
      updatedAt: new Date(),
    }).where(and(eq(rentPayments.id, owned.id), sql`${rentPayments.status} IN ('pending','overdue','partial')`, sql`COALESCE(${rentPayments.notes},'') NOT LIKE ${'%' + LATE_FEE_TAG + '%'}`)).returning();
    if (!updated) return res.status(409).json({ message: "This invoice changed while you were editing it — refresh and try again." });
    res.json({ ...updated, ...(await rentBalance(updated)) });
  } catch (error) {
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

// POST /api/rent-payments — create an invoice (or record a payment that was already received)
// status "paid" + paidDate is the "record a payment received outside the system" shortcut: the invoice is created and
// the payment is applied through the same ledger as everything else (receipt + ledger posting), never as a bare flag.
const isoDay = (v: string) => validPaidDate(v) || /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
const createSchema = z.object({
  tenantId:      z.number().int().positive(),
  amount:        z.union([z.string(), z.number()]).transform(v => String(v).trim()).refine(v => /^\d+(\.\d{1,2})?$/.test(v) && parseFloat(v) > 0, "Amount must be a positive number"),
  currency:      z.string().trim().length(3).default("KES"),
  dueDate:       z.string().refine(isoDay, "Due date must be a valid date (YYYY-MM-DD)"),
  paidDate:      z.string().refine(validPaidDate, "Payment date must be a real date, not in the future").optional(),
  paymentMethod: z.string().trim().min(1).max(30).optional(),
  status:        z.enum(["pending", "paid", "overdue"]).default("pending"),
  notes:         z.string().max(500).optional(),
  invoiceNumber: z.string().trim().min(1).max(50).optional(),
  mpesaTransactionId: z.string().trim().max(100).optional(),
  bankReference: z.string().trim().max(100).optional(),
});

router.post("/", authenticateJWT, requireOrg, auditLog("rent_payment", "CREATE"), async (req: any, res) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid data", errors: parsed.error.errors });
    const data = parsed.data;

    // the tenant must be one of the caller's own (404, not 403, so ids of other organisations are not confirmed)
    if (!(await callerCanUseTenant(req, data.tenantId))) return res.status(404).json({ message: "Tenant not found" });

    const markPaidNow = data.status === "paid";
    const { paidDate, paymentMethod, mpesaTransactionId, bankReference, status, ...rest } = data;
    const payment = await storage.createRentPayment({ ...rest, status: markPaidNow ? "pending" : status } as any);

    if (markPaidNow) {
      const result = await applyPayment({
        target: { kind: "rent", id: payment.id }, amount: money(payment.amount), method: (paymentMethod ?? "cash").toLowerCase(),
        paidDate: paidDate ?? todayEAT(), reference: mpesaTransactionId || bankReference || null, actorUserId: req.user.id, allowOverpay: false,
      });
      return res.status(201).json({ ...result.record, paidAmount: result.paidAmount, balance: result.balance, receipt: result.receipt });
    }
    res.status(201).json(payment);
  } catch (error: any) {
    if (error?.code === "23505" || /duplicate key|unique constraint/i.test(String(error?.cause?.message ?? error?.message ?? ""))) {
      return res.status(409).json({ message: "An invoice with that number already exists." });
    }
    if (ruleErrorResponse(res, error)) return;
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
      .innerJoin(tenants, and(...tenantJoinConditions))   // INNER: a LEFT join here exported every organisation's invoices
      .where(paymentConditions.length ? and(...paymentConditions) : undefined)
      .orderBy(desc(rentPayments.dueDate));

    const bal = await rentBalances(rows as any);
    // a cell starting with = + - @ is executed as a formula by Excel — neutralise it
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"`; };
    const header = "ID,Invoice,Tenant,Amount,Paid,Balance,Currency,Due Date,Paid Date,Status,Payment Method,Notes";
    const csvRows = rows.map(r => [
      r.id,
      cell(r.invoiceNumber),
      cell(`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()),
      r.amount,
      bal.get(r.id)?.paidAmount ?? 0,
      bal.get(r.id)?.balance ?? r.amount,
      r.currency,
      r.dueDate ?? "",
      r.paidDate ?? "",
      r.status,
      cell(r.paymentMethod),
      cell(r.notes),
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
    // org + (for a landlord) ownership — this used to check the organisation only
    const payment = await requireOwnedRentPayment(req, res);
    if (!payment) return;
    const id = payment.id;

    if (payment.status === "paid" || payment.status === "completed" || payment.status === "partial") {
      return res.status(409).json({ message: "Money has already been received against this invoice, so it cannot be deleted. Keep it for the audit trail." });
    }
    const bal = await rentBalance(payment);
    if (bal.paidAmount > 0) return res.status(409).json({ message: "Money has already been received against this invoice, so it cannot be deleted." });

    // any M-Pesa attempt / receipt rows point at the invoice — clear the unfinished ones so the delete can go through
    await db.delete(mpesaTransactions).where(and(eq(mpesaTransactions.rentPaymentId, id), sql`${mpesaTransactions.status} <> 'completed'`));
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
    if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ message: "Only an administrator or manager can clean up duplicate invoices." });
    const orgId = req.user.organizationId as number;

    // Fetch all non-paid payments for this org ordered oldest-first
    const rows = await db
      .select({
        id:            rentPayments.id,
        tenantId:      rentPayments.tenantId,
        dueDate:       rentPayments.dueDate,
        status:        rentPayments.status,
        invoiceNumber: rentPayments.invoiceNumber,
        amount:        rentPayments.amount,
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
      // same tenant, same month AND same amount — two different charges in one month (rent + a one-off) are not duplicates
      const key = `${row.tenantId}|${month}|${money(row.amount)}`;
      if (seen.has(key)) {
        toDelete.push(row.id); // duplicate — mark for deletion
      } else {
        seen.set(key, row.id); // first seen — keep
      }
    }

    if (toDelete.length === 0) {
      return res.json({ message: "No duplicates found", deleted: 0 });
    }

    await db.delete(rentPayments).where(inArray(rentPayments.id, toDelete));
    console.log(`[dedup-cleanup] Deleted ${toDelete.length} duplicate invoice(s) for org ${orgId}`);
    res.json({ message: `Cleaned up ${toDelete.length} duplicate invoice(s)`, deleted: toDelete.length });
  } catch (error) {
    console.error("Dedup cleanup error:", error);
    res.status(500).json({ message: "Failed to run dedup cleanup" });
  }
});

export default router;