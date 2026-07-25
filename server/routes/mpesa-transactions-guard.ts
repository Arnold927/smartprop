/**
 * server/routes/mpesa-transactions-guard.ts
 *
 * Intercepts ALL methods on /api/mpesa-transactions — mounted BEFORE
 * mpesaRouter (the generic createCRUDRouter instance from tenants.ts) in
 * index.ts, so Express reaches this handler first.
 *
 * mpesa_transactions has no organizationId column of its own. The generic
 * factory's org-scoping only applies `if (options.table.organizationId)`,
 * which is always false here — so GET /, GET /:id, POST /, PUT /:id,
 * PATCH /:id, and DELETE /:id have had ZERO org-scoping the whole time.
 * Any authenticated admin/manager/staff/landlord, from ANY organization on
 * the platform, could list, view, edit, or delete every other org's M-Pesa
 * transactions — phone numbers, amounts, receipt numbers, everything.
 *
 * Scoping strategy: via tenantId -> tenants.organizationId, same pattern
 * already used correctly in dashboard.ts. Transactions with no tenantId at
 * all (never matched to any tenant) can't be attributed to a specific org
 * from the data available, so — same call made for GET /api/mpesa/unmatched
 * earlier — they're excluded from this per-org view rather than shown to
 * every org's admin.
 *
 * Landlords are further scoped to only transactions for tenants in
 * properties they own, matching the ownership rule used everywhere else
 * this session.
 *
 * POST is blocked entirely — nothing in the app creates a transaction this
 * way (STK Push and the C2B webhook are the only legitimate creation paths),
 * and a generic "fabricate an arbitrary completed M-Pesa transaction" endpoint
 * serves no real purpose while being a real risk if ever misused.
 */

import { Router } from "express";
import { db } from "../db";
import { mpesaTransactions, tenants, units, properties, insertMpesaTransactionSchema } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

/** Tenant ids in the caller's org that this caller may see — all of the
 *  org's tenants, or (for a landlord) only tenants in properties they own. */
async function accessibleTenantIds(orgId: number, role: string, userId: string): Promise<number[]> {
  if (role === "landlord") {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(eq(tenants.organizationId, orgId), eq(properties.ownerId, userId)));
    return rows.map(r => r.id);
  }
  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, orgId));
  return rows.map(r => r.id);
}

router.get("/", async (req: any, res: any) => {
  try {
    const tenantIds = await accessibleTenantIds(req.user.organizationId, req.user.role ?? "", req.user.id);
    const rows = tenantIds.length > 0
      ? await db.select().from(mpesaTransactions).where(inArray(mpesaTransactions.tenantId, tenantIds)).orderBy(mpesaTransactions.createdAt)
      : [];
    res.json(rows);
  } catch (err) {
    console.error("[mpesa-transactions-guard] GET /:", err);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

router.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const [txn] = await db.select().from(mpesaTransactions).where(eq(mpesaTransactions.id, id)).limit(1);
    if (!txn) return res.status(404).json({ message: "Transaction not found" });

    const tenantIds = await accessibleTenantIds(req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!txn.tenantId || !tenantIds.includes(txn.tenantId)) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    res.json(txn);
  } catch (err) {
    console.error("[mpesa-transactions-guard] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch transaction" });
  }
});

router.post("/", (_req, res) => {
  res.status(403).json({
    message: "Transactions can't be created directly. Use STK Push, the M-Pesa C2B webhook, or POST /api/mpesa/match to link an existing one.",
  });
});

async function requireOwnedTransaction(req: any, res: any): Promise<number | null> {
  const id = parseInt(req.params.id);
  const [txn] = await db.select({ id: mpesaTransactions.id, tenantId: mpesaTransactions.tenantId }).from(mpesaTransactions).where(eq(mpesaTransactions.id, id)).limit(1);
  if (!txn) { res.status(404).json({ message: "Transaction not found" }); return null; }

  const tenantIds = await accessibleTenantIds(req.user.organizationId, req.user.role ?? "", req.user.id);
  if (!txn.tenantId || !tenantIds.includes(txn.tenantId)) {
    res.status(404).json({ message: "Transaction not found" });
    return null;
  }
  return id;
}

router.put("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedTransaction(req, res);
    if (id === null) return;
    const validated = insertMpesaTransactionSchema.partial().parse(req.body);
    const [updated] = await db.update(mpesaTransactions).set(validated as any).where(eq(mpesaTransactions.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[mpesa-transactions-guard] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update transaction" });
  }
});

router.patch("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedTransaction(req, res);
    if (id === null) return;
    const validated = insertMpesaTransactionSchema.partial().parse(req.body);
    const [updated] = await db.update(mpesaTransactions).set(validated as any).where(eq(mpesaTransactions.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[mpesa-transactions-guard] PATCH /:id:", err);
    res.status(500).json({ message: "Failed to update transaction" });
  }
});

router.delete("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedTransaction(req, res);
    if (id === null) return;
    await db.delete(mpesaTransactions).where(eq(mpesaTransactions.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("[mpesa-transactions-guard] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete transaction" });
  }
});

export default router;