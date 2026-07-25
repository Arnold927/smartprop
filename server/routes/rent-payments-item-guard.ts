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
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

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
    res.json(payment);
  } catch (err) {
    console.error("[rent-payments-item-guard] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch payment" });
  }
});

async function handleUpdate(req: any, res: any) {
  try {
    const id = parseInt(req.params.id);
    const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, id)).limit(1);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const ok = await callerCanAccess(payment.tenantId, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!ok) return res.status(404).json({ message: "Payment not found" });

    const validated = insertRentPaymentSchema.partial().parse(req.body);
    const [updated] = await db.update(rentPayments).set(validated as any).where(eq(rentPayments.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[rent-payments-item-guard] update:", err);
    res.status(500).json({ message: "Failed to update payment" });
  }
}

router.put("/:id", handleUpdate);
router.patch("/:id", handleUpdate);

export default router;