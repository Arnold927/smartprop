/**
 * server/routes/invoices-guard.ts
 *
 * Intercepts ALL methods on /api/invoices — mounted BEFORE invoiceRouter
 * (the generic createCRUDRouter instance from tenants.ts) in index.ts.
 *
 * invoices has no organizationId column of its own, and — unlike
 * rent-payments or maintenance-requests — no custom router covering any of
 * its methods either. So GET / (the list billing.tsx actually uses),
 * GET /:id, POST /, PUT /:id, PATCH /:id, and DELETE /:id have ALL had zero
 * org-scoping. Any admin/manager/staff/landlord, from any organization,
 * could list, view, edit, or delete every other org's invoices.
 *
 * Scoping strategy: via propertyId -> properties.organizationId. propertyId
 * is NOT NULL on invoices (unlike tenantId, which is nullable for
 * property-level invoices with no specific tenant), so it's the reliable key.
 *
 * Landlords are further scoped to only invoices for properties they own.
 */

import { Router } from "express";
import { db } from "../db";
import { invoices, properties, insertInvoiceSchema } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

/** Property ids this caller may touch: all of the org's, or (for a
 *  landlord) only ones they own. */
async function accessiblePropertyIds(orgId: number, role: string, userId: string): Promise<number[]> {
  const condition = role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(condition);
  return rows.map(r => r.id);
}

router.get("/", async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.organizationId, req.user.role ?? "", req.user.id);
    const rows = propIds.length > 0
      ? await db.select().from(invoices).where(inArray(invoices.propertyId, propIds)).orderBy(invoices.createdAt)
      : [];
    res.json(rows);
  } catch (err) {
    console.error("[invoices-guard] GET /:", err);
    res.status(500).json({ message: "Failed to fetch invoices" });
  }
});

router.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });

    const propIds = await accessiblePropertyIds(req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!propIds.includes(inv.propertyId)) return res.status(404).json({ message: "Invoice not found" });
    res.json(inv);
  } catch (err) {
    console.error("[invoices-guard] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch invoice" });
  }
});

router.post("/", async (req: any, res: any) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.organizationId, req.user.role ?? "", req.user.id);
    const propertyId = parseInt(req.body.propertyId);
    if (!propertyId || !propIds.includes(propertyId)) {
      return res.status(404).json({ message: "Property not found in your organisation" });
    }
    const validated = insertInvoiceSchema.parse(req.body);
    const [created] = await db.insert(invoices).values(validated as any).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[invoices-guard] POST /:", err);
    res.status(500).json({ message: "Failed to create invoice" });
  }
});

async function requireOwnedInvoice(req: any, res: any): Promise<number | null> {
  const id = parseInt(req.params.id);
  const [inv] = await db.select({ id: invoices.id, propertyId: invoices.propertyId }).from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!inv) { res.status(404).json({ message: "Invoice not found" }); return null; }

  const propIds = await accessiblePropertyIds(req.user.organizationId, req.user.role ?? "", req.user.id);
  if (!propIds.includes(inv.propertyId)) { res.status(404).json({ message: "Invoice not found" }); return null; }
  return id;
}

router.put("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedInvoice(req, res);
    if (id === null) return;
    const validated = insertInvoiceSchema.partial().parse(req.body);
    const [updated] = await db.update(invoices).set(validated as any).where(eq(invoices.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[invoices-guard] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update invoice" });
  }
});

router.patch("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedInvoice(req, res);
    if (id === null) return;
    const validated = insertInvoiceSchema.partial().parse(req.body);
    const [updated] = await db.update(invoices).set(validated as any).where(eq(invoices.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ errors: err.errors });
    console.error("[invoices-guard] PATCH /:id:", err);
    res.status(500).json({ message: "Failed to update invoice" });
  }
});

router.delete("/:id", async (req: any, res: any) => {
  try {
    const id = await requireOwnedInvoice(req, res);
    if (id === null) return;
    await db.delete(invoices).where(eq(invoices.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("[invoices-guard] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete invoice" });
  }
});

export default router;