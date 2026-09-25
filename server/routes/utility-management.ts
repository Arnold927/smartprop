/**
 * server/routes/utility-management.ts
 *
 * Utility & Billing Management Routes
 *
 * Endpoints:
 *   GET  /api/utility-providers          → list all utility providers (org-scoped)
 *   POST /api/utility-providers          → create a utility provider
 *   GET  /api/utility-providers/:id      → get a single provider
 *   PUT  /api/utility-providers/:id      → update a provider
 *   DELETE /api/utility-providers/:id    → delete a provider
 *
 *   GET  /api/utility-accounts           → list all utility accounts
 *   POST /api/utility-accounts           → create a utility account
 *   GET  /api/utility-accounts/:id       → get a single account
 *   PUT  /api/utility-accounts/:id       → update an account
 *   DELETE /api/utility-accounts/:id     → delete an account
 *
 *   GET  /api/utility-bills              → list all utility bills
 *   POST /api/utility-bills              → create a utility bill
 *   GET  /api/utility-bills/:id          → get a single bill
 *   PUT  /api/utility-bills/:id          → update a bill
 *   DELETE /api/utility-bills/:id        → delete a bill
 *
 *   GET  /api/recurring-charges          → list all recurring charges
 *   POST /api/recurring-charges          → create a recurring charge
 *   GET  /api/recurring-charges/:id      → get a single charge
 *   PUT  /api/recurring-charges/:id      → update a charge
 *   DELETE /api/recurring-charges/:id    → delete a charge
 *
 *   GET  /api/billing-cycles             → list all billing cycles
 *   POST /api/billing-cycles             → create a billing cycle
 *   GET  /api/billing-cycles/:id         → get a single cycle
 *   PUT  /api/billing-cycles/:id         → update a cycle
 *   DELETE /api/billing-cycles/:id       → delete a cycle
 *
 *   POST /api/billing/generate-invoices  → generate invoices from active recurring charges
 */

import { Router } from "express";
import { db } from "../db.js";
import {
  utilityProviders,
  utilityAccounts,
  utilityBills,
  recurringCharges,
  billingCycles,
  invoices,
  properties,
  units,
  tenants,
  propertyExpenses,
} from "@shared/schema";
import { eq, inArray, and, lte, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth.js";
import { requireOrg } from "../middleware/requireOrg.js";

// ── Utility Providers ──────────────────────────────────────────────────────────
export const utilityProvidersRouter = Router();
utilityProvidersRouter.use(authenticateJWT as any, requireOrg as any);

utilityProvidersRouter.get("/", async (_req: any, res: any) => {
  try {
    const providers = await db.select().from(utilityProviders).orderBy(utilityProviders.name);
    res.json(providers);
  } catch (err) {
    console.error("[utility-providers] GET /:", err);
    res.status(500).json({ message: "Failed to fetch utility providers" });
  }
});

utilityProvidersRouter.get("/:id", async (req: any, res: any) => {
  try {
    const [provider] = await db
      .select()
      .from(utilityProviders)
      .where(eq(utilityProviders.id, parseInt(req.params.id)))
      .limit(1);
    if (!provider) return res.status(404).json({ message: "Provider not found" });
    res.json(provider);
  } catch (err) {
    console.error("[utility-providers] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch utility provider" });
  }
});

utilityProvidersRouter.post("/", async (req: any, res: any) => {
  try {
    const { name, type, contactEmail, contactPhone, billingCycle, averageRate, currency, isActive } = req.body;
    if (!name || !type || !billingCycle) {
      return res.status(400).json({ message: "name, type, and billingCycle are required" });
    }
    const [created] = await db
      .insert(utilityProviders)
      .values({ name, type, contactEmail, contactPhone, billingCycle, averageRate, currency: currency || "KES", isActive: isActive !== false })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    console.error("[utility-providers] POST /:", err);
    res.status(500).json({ message: "Failed to create utility provider" });
  }
});

utilityProvidersRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const { name, type, contactEmail, contactPhone, billingCycle, averageRate, currency, isActive } = req.body;
    const [updated] = await db
      .update(utilityProviders)
      .set({ name, type, contactEmail, contactPhone, billingCycle, averageRate, currency, isActive })
      .where(eq(utilityProviders.id, id))
      .returning();
    if (!updated) return res.status(404).json({ message: "Provider not found" });
    res.json(updated);
  } catch (err) {
    console.error("[utility-providers] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update utility provider" });
  }
});

utilityProvidersRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(utilityProviders).where(eq(utilityProviders.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[utility-providers] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete utility provider" });
  }
});

// ── Utility Accounts ──────────────────────────────────────────────────────────
export const utilityAccountsRouter = Router();
utilityAccountsRouter.use(authenticateJWT as any, requireOrg as any);

// Properties this caller may touch: all of the org's, or — for a landlord —
// only ones they own. Reused across every method below so GET /:id, POST,
// PUT, and DELETE are all scoped the same way GET / already was.
async function accessiblePropertyIds(orgId: number, role: string, userId: string): Promise<number[]> {
  const conditions = role === "landlord"
    ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : eq(properties.organizationId, orgId);
  const rows = await db.select({ id: properties.id }).from(properties).where(conditions);
  return rows.map((p: any) => p.id);
}

utilityAccountsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await accessiblePropertyIds(orgId, req.user.role ?? "", req.user.id);
    const accounts = propIds.length > 0
      ? await db.select().from(utilityAccounts).where(inArray(utilityAccounts.propertyId, propIds)).orderBy(utilityAccounts.createdAt)
      : [];
    res.json(accounts);
  } catch (err) {
    console.error("[utility-accounts] GET /:", err);
    res.status(500).json({ message: "Failed to fetch utility accounts" });
  }
});

utilityAccountsRouter.get("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const propIds = await accessiblePropertyIds(orgId, req.user.role ?? "", req.user.id);
    const [account] = await db
      .select()
      .from(utilityAccounts)
      .where(eq(utilityAccounts.id, parseInt(req.params.id)))
      .limit(1);
    if (!account || !propIds.includes(account.propertyId)) {
      return res.status(404).json({ message: "Account not found" });
    }
    res.json(account);
  } catch (err) {
    console.error("[utility-accounts] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch utility account" });
  }
});

utilityAccountsRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const { propertyId, unitId, providerId, accountNumber, meterNumber, connectionDate, isActive, notes } = req.body;
    if (!propertyId || !providerId || !accountNumber) {
      return res.status(400).json({ message: "propertyId, providerId, and accountNumber are required" });
    }
    const propIds = await accessiblePropertyIds(orgId, req.user.role ?? "", req.user.id);
    if (!propIds.includes(parseInt(propertyId))) {
      return res.status(404).json({ message: "Property not found in your organisation" });
    }
    const [created] = await db
      .insert(utilityAccounts)
      .values({
        propertyId: parseInt(propertyId),
        unitId: unitId ? parseInt(unitId) : null,
        providerId: parseInt(providerId),
        accountNumber,
        meterNumber,
        connectionDate: connectionDate ? new Date(connectionDate) : null,
        isActive: isActive !== false,
        notes,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    console.error("[utility-accounts] POST /:", err);
    res.status(500).json({ message: "Failed to create utility account" });
  }
});

utilityAccountsRouter.put("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const propIds = await accessiblePropertyIds(orgId, req.user.role ?? "", req.user.id);
    const [existing] = await db.select({ propertyId: utilityAccounts.propertyId }).from(utilityAccounts).where(eq(utilityAccounts.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(404).json({ message: "Account not found" });
    }
    const { propertyId, unitId, providerId, accountNumber, meterNumber, connectionDate, isActive, notes } = req.body;
    if (propertyId && !propIds.includes(parseInt(propertyId))) {
      return res.status(404).json({ message: "Property not found in your organisation" });
    }
    const [updated] = await db
      .update(utilityAccounts)
      .set({
        propertyId: propertyId ? parseInt(propertyId) : undefined,
        unitId: unitId ? parseInt(unitId) : null,
        providerId: providerId ? parseInt(providerId) : undefined,
        accountNumber,
        meterNumber,
        connectionDate: connectionDate ? new Date(connectionDate) : undefined,
        isActive,
        notes,
      })
      .where(eq(utilityAccounts.id, id))
      .returning();
    if (!updated) return res.status(404).json({ message: "Account not found" });
    res.json(updated);
  } catch (err) {
    console.error("[utility-accounts] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update utility account" });
  }
});

utilityAccountsRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const propIds = await accessiblePropertyIds(orgId, req.user.role ?? "", req.user.id);
    const [existing] = await db.select({ propertyId: utilityAccounts.propertyId }).from(utilityAccounts).where(eq(utilityAccounts.id, id)).limit(1);
    if (!existing || !propIds.includes(existing.propertyId)) {
      return res.status(404).json({ message: "Account not found" });
    }
    await db.delete(utilityAccounts).where(eq(utilityAccounts.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[utility-accounts] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete utility account" });
  }
});

// ── Utility Bills ──────────────────────────────────────────────────────────────
export const utilityBillsRouter = Router();
utilityBillsRouter.use(authenticateJWT as any, requireOrg as any);
// Tenants use GET /api/utility-bills/my-bills (utility-bill-sender.ts) instead —
// these generic CRUD routes have no tenant-level scoping at all (some don't
// even scope by org) and were never meant for tenant access. The RBAC policy
// for this whole prefix now includes 'tenant' so my-bills is reachable; block
// it explicitly here so that doesn't also open up this router.
utilityBillsRouter.use((req: any, res, next) => {
  if (req.user?.role === "tenant") {
    return res.status(403).json({ message: "Not permitted. Use /api/utility-bills/my-bills instead." });
  }
  next();
});

utilityBillsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";
    const propertyIdParam = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
    // scope via accountId → utilityAccounts.propertyId → properties.organizationId
    // (and, for a landlord, properties.ownerId too — same rule as everywhere
    // else this session; previously org-only, so a landlord in a
    // multi-landlord org would see every other landlord's utility bills too)
    const propCondition = role === "landlord"
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
      : eq(properties.organizationId, orgId);
    const orgProps = await db.select({ id: properties.id }).from(properties).where(propCondition);
    let propIds = orgProps.map((p: any) => p.id);
    // Optional single-property filter (e.g. the property details page's
    // Payments tab) — narrows the already-scoped set, never widens it.
    if (propertyIdParam) propIds = propIds.filter(id => id === propertyIdParam);
    const orgAccounts = propIds.length > 0
      ? await db.select({ id: utilityAccounts.id }).from(utilityAccounts).where(inArray(utilityAccounts.propertyId, propIds))
      : [];
    const accountIds = orgAccounts.map((a: any) => a.id);

    // Bills linked via an account (the accountId path above), UNIONed with
    // bills linked directly by tenantId (utility-bill-sender.ts's primary
    // path, which doesn't require a utility account to exist at all) —
    // previously only the accountId path was checked here, so a bill created
    // without a linked account would never show up in this list at all.
    const tenantIds = propIds.length > 0
      ? (await db.select({ id: tenants.id }).from(tenants).innerJoin(units, eq(tenants.unitId, units.id)).where(inArray(units.propertyId, propIds))).map(t => t.id)
      : [];

    const bills = (accountIds.length > 0 || tenantIds.length > 0)
      ? await db.select().from(utilityBills).where(
          sql`(${accountIds.length > 0 ? inArray(utilityBills.accountId, accountIds) : sql`false`} OR ${tenantIds.length > 0 ? inArray(utilityBills.tenantId, tenantIds) : sql`false`})`,
        ).orderBy(utilityBills.createdAt)
      : [];
    res.json(bills);
  } catch (err) {
    console.error("[utility-bills] GET /:", err);
    res.status(500).json({ message: "Failed to fetch utility bills" });
  }
});

/** Resolves whether a bill exists and belongs to the caller's org (and, for a
 *  landlord, to a property they own) — via EITHER its accountId link or its
 *  direct tenantId link, since a bill can have either. */
async function resolveBillOwnership(billId: number, orgId: number, role: string, userId: string): Promise<{ exists: boolean; allowed: boolean; propertyId?: number; accountId?: number | null }> {
  const [bill] = await db.select({ id: utilityBills.id, accountId: utilityBills.accountId, tenantId: utilityBills.tenantId }).from(utilityBills).where(eq(utilityBills.id, billId)).limit(1);
  if (!bill) return { exists: false, allowed: false };

  let propertyId: number | undefined;
  if (bill.accountId) {
    const [acct] = await db.select({ propertyId: utilityAccounts.propertyId }).from(utilityAccounts).where(eq(utilityAccounts.id, bill.accountId)).limit(1);
    propertyId = acct?.propertyId;
  }
  if (!propertyId && bill.tenantId) {
    const [tenant] = await db.select({ unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, bill.tenantId)).limit(1);
    if (tenant?.unitId) {
      const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
      propertyId = unit?.propertyId;
    }
  }
  if (!propertyId) return { exists: true, allowed: false };

  const [prop] = await db.select({ organizationId: properties.organizationId, ownerId: properties.ownerId }).from(properties).where(eq(properties.id, propertyId)).limit(1);
  if (!prop || prop.organizationId !== orgId) return { exists: true, allowed: false };
  if (role === "landlord" && prop.ownerId !== userId) return { exists: true, allowed: false };
  return { exists: true, allowed: true, propertyId, accountId: bill.accountId };
}

utilityBillsRouter.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const access = await resolveBillOwnership(id, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!access.allowed) return res.status(404).json({ message: "Bill not found" });

    const [bill] = await db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.id, id))
      .limit(1);
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    res.json(bill);
  } catch (err) {
    console.error("[utility-bills] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch utility bill" });
  }
});

utilityBillsRouter.post("/", async (req: any, res: any) => {
  try {
    const {
      accountId, billNumber, billingPeriodStart, billingPeriodEnd, dueDate,
      amount, currency, unitsConsumed, unitRate, previousReading, currentReading,
      status, paidDate, paymentMethod, notes,
    } = req.body;
    if (!accountId || !billingPeriodStart || !billingPeriodEnd || !dueDate || !amount) {
      return res.status(400).json({ message: "accountId, billingPeriodStart, billingPeriodEnd, dueDate, and amount are required" });
    }

    // Verify the account's property belongs to the caller's org (and, for a
    // landlord, to them specifically) — previously any accountId was
    // accepted with no check at all.
    const [acct] = await db.select({ propertyId: utilityAccounts.propertyId }).from(utilityAccounts).where(eq(utilityAccounts.id, parseInt(accountId))).limit(1);
    const [prop] = acct?.propertyId
      ? await db.select({ organizationId: properties.organizationId, ownerId: properties.ownerId }).from(properties).where(eq(properties.id, acct.propertyId)).limit(1)
      : [undefined];
    if (!prop || prop.organizationId !== req.user.organizationId || (req.user.role === "landlord" && prop.ownerId !== req.user.id)) {
      return res.status(404).json({ message: "Utility account not found in your organisation" });
    }

    const [created] = await db
      .insert(utilityBills)
      .values({
        accountId: parseInt(accountId),
        billNumber,
        billingPeriodStart: new Date(billingPeriodStart),
        billingPeriodEnd: new Date(billingPeriodEnd),
        dueDate: new Date(dueDate),
        amount: String(amount),
        currency: currency || "KES",
        unitsConsumed,
        unitRate,
        previousReading,
        currentReading,
        status: status || "pending",
        paidDate: paidDate ? new Date(paidDate) : null,
        paymentMethod,
        notes,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    console.error("[utility-bills] POST /:", err);
    res.status(500).json({ message: "Failed to create utility bill" });
  }
});

utilityBillsRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const access = await resolveBillOwnership(id, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!access.allowed) return res.status(404).json({ message: "Bill not found" });

    // Fetch the CURRENT status before updating, so we can detect a real
    // pending→paid (or paid→other) transition rather than re-firing on
    // every edit of an already-paid bill.
    const [before] = await db.select({ status: utilityBills.status }).from(utilityBills).where(eq(utilityBills.id, id)).limit(1);
    const wasPaid = before?.status === "paid";

    const {
      billNumber, billingPeriodStart, billingPeriodEnd, dueDate,
      amount, currency, unitsConsumed, unitRate, previousReading, currentReading,
      status, paidDate, paymentMethod, notes,
    } = req.body;
    const [updated] = await db
      .update(utilityBills)
      .set({
        billNumber,
        billingPeriodStart: billingPeriodStart ? new Date(billingPeriodStart) : undefined,
        billingPeriodEnd: billingPeriodEnd ? new Date(billingPeriodEnd) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        amount: amount ? String(amount) : undefined,
        currency,
        unitsConsumed,
        unitRate,
        previousReading,
        currentReading,
        status,
        paidDate: paidDate ? new Date(paidDate) : null,
        paymentMethod,
        notes,
      })
      .where(eq(utilityBills.id, id))
      .returning();
    if (!updated) return res.status(404).json({ message: "Bill not found" });

    const isNowPaid = updated.status === "paid";

    // ── Sync to the general expense ledger ──────────────────────────────────
    // Only for account-linked bills (a common-area cost the property owner
    // actually pays) — not tenant-direct bills, which are billed to the
    // tenant and aren't a property operating expense.
    if (access.accountId) {
      if (isNowPaid && !wasPaid) {
        // Guard against double-creation if this bill is somehow marked
        // paid twice in a row (e.g. two quick edits).
        const [existingExpense] = await db
          .select({ id: propertyExpenses.id })
          .from(propertyExpenses)
          .where(eq(propertyExpenses.utilityBillId, id))
          .limit(1);

        if (!existingExpense) {
          const [account] = await db
            .select({ providerId: utilityAccounts.providerId, accountNumber: utilityAccounts.accountNumber })
            .from(utilityAccounts)
            .where(eq(utilityAccounts.id, access.accountId))
            .limit(1);
          const [provider] = account?.providerId
            ? await db.select({ name: utilityProviders.name, type: utilityProviders.type }).from(utilityProviders).where(eq(utilityProviders.id, account.providerId)).limit(1)
            : [undefined];

          await db.insert(propertyExpenses).values({
            expenseNumber: `EXP-UTIL-${id}`,
            propertyId:    access.propertyId!,
            vendorName:    provider?.name ?? "Utility provider",
            description:   `${provider?.type ?? "Utility"} bill ${updated.billNumber ?? ""} — account ${account?.accountNumber ?? access.accountId}`.trim(),
            amount:        updated.amount,
            currency:      (updated.currency as any) ?? "KES",
            category:      "utilities",
            expenseDate:   updated.billingPeriodStart ?? new Date(),
            paymentDate:   updated.paidDate ?? new Date(),
            status:        "paid",
            paymentMethod: updated.paymentMethod ?? undefined,
            utilityBillId: id,
            createdBy:     req.user.id,
          } as any);
        }
      } else if (!isNowPaid && wasPaid) {
        // Payment was reversed — remove the expense so the ledger doesn't
        // keep a cost that's no longer actually paid.
        await db.delete(propertyExpenses).where(eq(propertyExpenses.utilityBillId, id));
      }
    }

    res.json(updated);
  } catch (err) {
    console.error("[utility-bills] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update utility bill" });
  }
});

utilityBillsRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const access = await resolveBillOwnership(id, req.user.organizationId, req.user.role ?? "", req.user.id);
    if (!access.allowed) return res.status(404).json({ message: "Bill not found" });

    await db.delete(utilityBills).where(eq(utilityBills.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[utility-bills] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete utility bill" });
  }
});

// ── Recurring Charges ──────────────────────────────────────────────────────────
export const recurringChargesRouter = Router();
recurringChargesRouter.use(authenticateJWT as any, requireOrg as any);

recurringChargesRouter.get("/", async (_req: any, res: any) => {
  try {
    const charges = await db.select().from(recurringCharges).orderBy(recurringCharges.createdAt);
    // Normalize field names to match frontend interface
    const normalized = charges.map((c: any) => ({
      ...c,
      chargeName: c.name,
      chargeType: c.type,
      nextChargeDate: c.nextBillDate,
    }));
    res.json(normalized);
  } catch (err) {
    console.error("[recurring-charges] GET /:", err);
    res.status(500).json({ message: "Failed to fetch recurring charges" });
  }
});

recurringChargesRouter.get("/:id", async (req: any, res: any) => {
  try {
    const [charge] = await db
      .select()
      .from(recurringCharges)
      .where(eq(recurringCharges.id, parseInt(req.params.id)))
      .limit(1);
    if (!charge) return res.status(404).json({ message: "Recurring charge not found" });
    res.json({ ...charge, chargeName: (charge as any).name, chargeType: (charge as any).type, nextChargeDate: (charge as any).nextBillDate });
  } catch (err) {
    console.error("[recurring-charges] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch recurring charge" });
  }
});

recurringChargesRouter.post("/", async (req: any, res: any) => {
  try {
    const { propertyId, unitId, chargeName, name, chargeType, type, amount, currency, frequency, startDate, endDate, nextChargeDate, nextBillDate, isActive, autoGenerate, description } = req.body;
    const resolvedName = chargeName || name;
    const resolvedType = chargeType || type;
    const resolvedNextBillDate = nextChargeDate || nextBillDate;
    if (!propertyId || !resolvedName || !resolvedType || !amount || !frequency || !startDate || !resolvedNextBillDate) {
      return res.status(400).json({ message: "propertyId, name/chargeName, type/chargeType, amount, frequency, startDate, and nextBillDate/nextChargeDate are required" });
    }
    const [created] = await db
      .insert(recurringCharges)
      .values({
        propertyId: parseInt(propertyId),
        unitId: unitId ? parseInt(unitId) : null,
        name: resolvedName,
        type: resolvedType,
        amount: String(amount),
        currency: currency || "KES",
        frequency,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        nextBillDate: new Date(resolvedNextBillDate),
        isActive: isActive !== false,
        autoGenerate: autoGenerate !== false,
        description,
      })
      .returning();
    res.status(201).json({ ...created, chargeName: (created as any).name, chargeType: (created as any).type, nextChargeDate: (created as any).nextBillDate });
  } catch (err) {
    console.error("[recurring-charges] POST /:", err);
    res.status(500).json({ message: "Failed to create recurring charge" });
  }
});

recurringChargesRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const { chargeName, name, chargeType, type, amount, currency, frequency, startDate, endDate, nextChargeDate, nextBillDate, isActive, autoGenerate, description } = req.body;
    const [updated] = await db
      .update(recurringCharges)
      .set({
        name: chargeName || name,
        type: chargeType || type,
        amount: amount ? String(amount) : undefined,
        currency,
        frequency,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : null,
        nextBillDate: (nextChargeDate || nextBillDate) ? new Date(nextChargeDate || nextBillDate) : undefined,
        isActive,
        autoGenerate,
        description,
      })
      .where(eq(recurringCharges.id, id))
      .returning();
    if (!updated) return res.status(404).json({ message: "Recurring charge not found" });
    res.json({ ...updated, chargeName: (updated as any).name, chargeType: (updated as any).type, nextChargeDate: (updated as any).nextBillDate });
  } catch (err) {
    console.error("[recurring-charges] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update recurring charge" });
  }
});

recurringChargesRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(recurringCharges).where(eq(recurringCharges.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[recurring-charges] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete recurring charge" });
  }
});

// ── Billing Cycles ──────────────────────────────────────────────────────────────
export const billingCyclesRouter = Router();
billingCyclesRouter.use(authenticateJWT as any, requireOrg as any);

billingCyclesRouter.get("/", async (_req: any, res: any) => {
  try {
    const cycles = await db.select().from(billingCycles).orderBy(billingCycles.createdAt);
    // Normalize: frontend expects cycleName, startDate, endDate, status
    const normalized = cycles.map((c: any) => ({
      ...c,
      cycleName: c.name,
      startDate: null, // billingCycles table has billingDay/dueDay not startDate/endDate
      endDate: null,
      status: c.isActive ? "active" : "inactive",
    }));
    res.json(normalized);
  } catch (err) {
    console.error("[billing-cycles] GET /:", err);
    res.status(500).json({ message: "Failed to fetch billing cycles" });
  }
});

billingCyclesRouter.get("/:id", async (req: any, res: any) => {
  try {
    const [cycle] = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.id, parseInt(req.params.id)))
      .limit(1);
    if (!cycle) return res.status(404).json({ message: "Billing cycle not found" });
    res.json({ ...cycle, cycleName: (cycle as any).name, status: (cycle as any).isActive ? "active" : "inactive" });
  } catch (err) {
    console.error("[billing-cycles] GET /:id:", err);
    res.status(500).json({ message: "Failed to fetch billing cycle" });
  }
});

billingCyclesRouter.post("/", async (req: any, res: any) => {
  try {
    const { propertyId, cycleName, name, type, frequency, billingDay, dueDay, graceDay, lateFeeAmount, lateFeeType, isActive } = req.body;
    const resolvedName = cycleName || name;
    if (!propertyId || !resolvedName || !type || !frequency || !billingDay || !dueDay) {
      return res.status(400).json({ message: "propertyId, name/cycleName, type, frequency, billingDay, and dueDay are required" });
    }
    const [created] = await db
      .insert(billingCycles)
      .values({
        propertyId: parseInt(propertyId),
        name: resolvedName,
        type,
        frequency,
        billingDay: parseInt(billingDay),
        dueDay: parseInt(dueDay),
        graceDay: graceDay ? parseInt(graceDay) : 5,
        lateFeeAmount,
        lateFeeType,
        isActive: isActive !== false,
      })
      .returning();
    res.status(201).json({ ...created, cycleName: (created as any).name, status: (created as any).isActive ? "active" : "inactive" });
  } catch (err) {
    console.error("[billing-cycles] POST /:", err);
    res.status(500).json({ message: "Failed to create billing cycle" });
  }
});

billingCyclesRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const { cycleName, name, type, frequency, billingDay, dueDay, graceDay, lateFeeAmount, lateFeeType, isActive } = req.body;
    const [updated] = await db
      .update(billingCycles)
      .set({
        name: cycleName || name,
        type,
        frequency,
        billingDay: billingDay ? parseInt(billingDay) : undefined,
        dueDay: dueDay ? parseInt(dueDay) : undefined,
        graceDay: graceDay ? parseInt(graceDay) : undefined,
        lateFeeAmount,
        lateFeeType,
        isActive,
      })
      .where(eq(billingCycles.id, id))
      .returning();
    if (!updated) return res.status(404).json({ message: "Billing cycle not found" });
    res.json({ ...updated, cycleName: (updated as any).name, status: (updated as any).isActive ? "active" : "inactive" });
  } catch (err) {
    console.error("[billing-cycles] PUT /:id:", err);
    res.status(500).json({ message: "Failed to update billing cycle" });
  }
});

billingCyclesRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(billingCycles).where(eq(billingCycles.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[billing-cycles] DELETE /:id:", err);
    res.status(500).json({ message: "Failed to delete billing cycle" });
  }
});

// ── Generate Invoices (POST /api/billing/generate-invoices) ───────────────────
// This generates invoices for all active recurring charges whose nextBillDate is today or past.
export const generateInvoicesRouter = Router();
generateInvoicesRouter.use(authenticateJWT as any, requireOrg as any);

generateInvoicesRouter.post("/generate-invoices", async (req: any, res: any) => {
  try {
    const now = new Date();

    // Find all active recurring charges that are due
    const dueCharges = await db
      .select()
      .from(recurringCharges)
      .where(
        and(
          eq(recurringCharges.isActive, true),
          lte(recurringCharges.nextBillDate, now)
        )
      );

    if (dueCharges.length === 0) {
      return res.json([]);
    }

    const generatedInvoices: any[] = [];

    for (const charge of dueCharges) {
      // Build a unique invoice number
      const invoiceNumber = `INV-RC-${charge.id}-${Date.now()}`;

      // Calculate due date: 30 days from now by default
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + 30);

      try {
        const amountStr = String((charge as any).amount);
        const [invoice] = await db
          .insert(invoices)
          .values({
            invoiceNumber,
            propertyId: (charge as any).propertyId,
            unitId: (charge as any).unitId ?? null,
            type: "service_charge",
            amount: amountStr,
            totalAmount: amountStr,   // required notNull field
            taxAmount: "0",
            discountAmount: "0",
            currency: (charge as any).currency || "KES",
            dueDate,
            status: "pending",
            description: `Recurring charge: ${(charge as any).name}`,
            lineItems: [
              {
                description: (charge as any).name,
                amount: (charge as any).amount,
                currency: (charge as any).currency || "KES",
              },
            ],
          })
          .returning();

        generatedInvoices.push(invoice);

        // Advance nextBillDate based on frequency
        const nextDate = new Date((charge as any).nextBillDate || now);
        const freq: string = (charge as any).frequency || "monthly";
        if (freq === "weekly") nextDate.setDate(nextDate.getDate() + 7);
        else if (freq === "monthly") nextDate.setMonth(nextDate.getMonth() + 1);
        else if (freq === "quarterly") nextDate.setMonth(nextDate.getMonth() + 3);
        else if (freq === "annually") nextDate.setFullYear(nextDate.getFullYear() + 1);
        else nextDate.setMonth(nextDate.getMonth() + 1); // default monthly

        await db
          .update(recurringCharges)
          .set({ nextBillDate: nextDate })
          .where(eq(recurringCharges.id, charge.id));
      } catch (invoiceErr) {
        console.error(`[generate-invoices] Failed to generate invoice for charge ${charge.id}:`, invoiceErr);
        // Continue with next charge rather than failing all
      }
    }

    res.json(generatedInvoices);
  } catch (err) {
    console.error("[generate-invoices] POST /:", err);
    res.status(500).json({ message: "Failed to generate invoices" });
  }
});