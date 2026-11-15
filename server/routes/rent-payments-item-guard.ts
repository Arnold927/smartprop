/**
 * server/routes/rent-payments-item-guard.ts
 *
 * Intercepts GET/PUT/PATCH /api/rent-payments/:id — mounted BEFORE
 * paymentRouter (the generic createCRUDRouter instance from tenants.ts).
 *
 * payment-actions.ts already properly org-scopes GET / (list), POST /
 * (create), and DELETE /:id — its own GET / handler explicitly joins on
 * tenants to guarantee cross-org isolation. But it doesn't define GET /:id,
 * PUT /:id, or PATCH /:id, so those three fall through to paymentRouter,
 * the generic factory — which has zero org-scoping since rent_payments has
 * no organizationId column of its own.
 *
 * Scoping strategy: via tenantId -> tenants.organizationId (tenantId is
 * NOT NULL on rent_payments). Landlords are further scoped to only
 * payments for tenants in properties they own.
 */

import { Router } from "express";
import { db } from "../db";
import { rentPayments, tenants, units, properties, insertRentPaymentSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { rentBalance, money, EPS } from "../services/rent-ledger";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// Only numeric ids belong to this router. Anything else ("/stats", "/summary",
// ...) is a named route on a later router: hand it on instead of treating it
// as an id (it used to be parsed to NaN and answered 500).
router.param("id", (_req: any, _res: any, next: any, id: string) => {
  if (/^\d+$/.test(id)) return next();
  return next("router");
});

/** Resolve whether this caller (given their role) may access a rent payment
 *  whose tenant belongs to tenantOrgId / tenant row tenantRowId. */
async function callerCanAccess(tenantRowId: number, orgId: number, role: string, userId: string): Promise<boolean> {
  const [tenant] = await db
    .select({ id: tenants.id, organizationId: tenants.organizationId, unitId: tenants.unitId })
    .from(tenants)
    .where(eq(tenants.id, tenantRowId))
    .limit(1);
  if (!tenant || tenant.organizationId !== orgId) return false;

  if (role === "landlord") {
    if (!tenant.unitId) return false;
    const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
    if (!unit?.propertyId) return false;
    const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1);
    return !!prop && prop.ownerId === userId;
  }
  return true;
}

router.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, id)).limit(1);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const ok = await callerCanAccess(payment.tenantId, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!ok) return res.status(404).json({ message: "Payment not found" });
    res.json({ ...payment, ...(await rentBalance(payment)) });
  } catch (err) {
    console.error("[rent-payments-item-guard] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch payment" });
  }
});

// What an edit may change. Money state (status paid/partial, paid date, method, M-Pesa / bank reference) is written ONLY by
// POST /:id/mark-paid and the M-Pesa reconciliation — a PATCH that set status "paid" used to close an invoice with no
// receipt, no ledger entry and no record of how much was received.
const editSchema = z.object({
  amount:   z.union([z.string(), z.number()]).transform(v => String(v).trim()).refine(v => /^\d+(\.\d{1,2})?$/.test(v) && parseFloat(v) > 0, "Amount must be a positive number").optional(),
  dueDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD").refine(v => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), "Due date must be a real date").optional(),
  notes:    z.string().max(1000).nullable().optional(),
  status:   z.enum(["pending", "overdue"]).optional(),
}).strict();

async function handleUpdate(req: any, res: any) {
  try {
    const id = parseInt(req.params.id);
    const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, id)).limit(1);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const ok = await callerCanAccess(payment.tenantId, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!ok) return res.status(404).json({ message: "Payment not found" });

    const body = req.body ?? {};
    if (["paid", "partial", "completed"].includes(body.status)) {
      return res.status(400).json({ message: "To record a payment use Record payment — it issues the receipt and posts to the ledger. The status cannot be set directly." });
    }
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid data", errors: parsed.error.errors });
    const edit = parsed.data;

    const settled = payment.status === "paid" || payment.status === "completed";
    if (settled && (edit.amount !== undefined || edit.dueDate !== undefined || edit.status !== undefined)) {
      return res.status(409).json({ message: "This invoice is already paid, so its amount and dates are locked." });
    }
    const bal = await rentBalance(payment);
    if (edit.amount !== undefined && money(edit.amount) <= bal.paidAmount + (bal.paidAmount > 0 ? EPS : -1)) {
      return res.status(409).json({ message: `Part of this invoice has already been paid (${payment.currency ?? "KES"} ${bal.paidAmount.toLocaleString("en-KE")}). The amount cannot be set to less than what was received.` });
    }
    if (payment.status === "partial" && edit.status) return res.status(409).json({ message: "A part-paid invoice keeps the status Partial until it is settled." });

    const [updated] = await db.update(rentPayments).set({ ...edit, updatedAt: new Date() } as any).where(eq(rentPayments.id, id)).returning();
    res.json({ ...updated, ...(await rentBalance(updated)) });
  } catch (err: any) {
    console.error("[rent-payments-item-guard] update:", err);
    res.status(500).json({ message: "Failed to update payment" });
  }
}

router.put("/:id", handleUpdate);
router.patch("/:id", handleUpdate);

export default router;