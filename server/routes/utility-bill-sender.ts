/**
 * server/routes/utility-bill-sender.ts
 *
 * Routes for composing and sending utility bills (water, electricity, gas, etc.)
 * to tenants via email — individually or in bulk.
 *
 * Endpoints:
 *   POST /api/utility-bills/send-email
 *       → Enter meter readings + unit cost, send bill to ONE tenant
 *
 *   POST /api/utility-bills/send-bulk
 *       → Supply an array of tenant meter readings, send to ALL in one shot
 *
 *   GET  /api/utility-bills/tenants-with-accounts
 *       → List tenants that have a utility account (for the UI selector)
 */

import { Router } from "express";
import { db } from "../db.js";
import {
  tenants,
  units,
  properties,
  utilityAccounts,
  utilityBills,
  utilityProviders,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth.js";
import { requireOrg } from "../middleware/requireOrg.js";
import {
  sendUtilityBillEmail,
  sendBulkUtilityBillEmails,
  type BulkPayload,
} from "../lib/utility-bill-email.js";
import type { Request, Response, NextFunction } from "express";

export const utilityBillSenderRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// TENANT-FACING ROUTES (no requireOrg — tenants don't have manager orgId)
// Must be registered BEFORE the requireOrg middleware below.
// ─────────────────────────────────────────────────────────────────────────────
utilityBillSenderRouter.use(authenticateJWT as any);
// /my-bills handler is registered at the bottom of this file, before the
// manager-only block, so it remains accessible to tenant JWT users.

// ─────────────────────────────────────────────────────────────────────────────
// ROLE GUARD — admin, manager, staff, and landlord may send/view utility bills.
// Tenants, guards, caretakers, and contractors are excluded from write routes.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(["admin", "manager", "staff", "landlord"]);

function requireUtilityBillRole(req: any, res: Response, next: NextFunction) {
  const role: string = req.user?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return res.status(403).json({
      message: "Only admins, managers, staff, and landlords can access utility bill management.",
    });
  }
  return next();
}

// Convenience: requireOrg + role guard together
const managerOnly = [requireOrg as any, requireUtilityBillRole];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateBillNumber(): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `UTIL-${yyyymm}-${rand}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/utility-bills/tenants-with-accounts
// Returns tenants (in this org) along with their unit, property, and utility account info.
// Used by the frontend to populate the "select tenants" list.
// ─────────────────────────────────────────────────────────────────────────────
utilityBillSenderRouter.get("/tenants-with-accounts", managerOnly as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";
    const userId: string = req.user.id;

    // All active tenants in the org that have a unit assigned
    const conditions = [eq(tenants.organizationId, orgId), eq(tenants.status, "active")];
    if (role === "landlord") conditions.push(eq(properties.ownerId, userId));

    const rows = await db
      .select({
        tenantId: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        email: tenants.email,
        phone: tenants.phone,
        currency: tenants.currency,
        unitId: tenants.unitId,
        unitNumber: units.unitNumber,
        propertyId: units.propertyId,
        propertyName: properties.name,
        utilityAccountId: utilityAccounts.id,
        accountNumber: utilityAccounts.accountNumber,
        meterNumber: utilityAccounts.meterNumber,
        providerId: utilityAccounts.providerId,
        providerName: utilityProviders.name,
        providerType: utilityProviders.type,
      })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .leftJoin(utilityAccounts, and(
        eq(utilityAccounts.unitId, units.id),
        eq(utilityAccounts.isActive, true),
      ))
      .leftJoin(utilityProviders, eq(utilityAccounts.providerId, utilityProviders.id))
      .where(and(...conditions))
      .orderBy(properties.name, units.unitNumber);

    return res.json(rows);
  } catch (err) {
    console.error("[utility-bill-sender] GET /tenants-with-accounts:", err);
    return res.status(500).json({ message: "Failed to fetch tenants" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/utility-bills/send-email
// Body: {
//   tenantId, utilityType, previousReading, currentReading, unitCost,
//   billingPeriodStart, billingPeriodEnd, dueDate,
//   currency?, notes?
// }
// ─────────────────────────────────────────────────────────────────────────────
utilityBillSenderRouter.post("/send-email", managerOnly as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const {
      tenantId,
      utilityType,
      previousReading,
      currentReading,
      unitCost,
      billingPeriodStart,
      billingPeriodEnd,
      dueDate,
      currency,
      notes,
    } = req.body;

    // Validate required fields
    if (!tenantId || !utilityType || previousReading == null || currentReading == null || !unitCost || !billingPeriodStart || !billingPeriodEnd || !dueDate) {
      return res.status(400).json({
        message: "tenantId, utilityType, previousReading, currentReading, unitCost, billingPeriodStart, billingPeriodEnd, and dueDate are required",
      });
    }

    if (Number(currentReading) < Number(previousReading)) {
      return res.status(400).json({ message: "currentReading must be >= previousReading" });
    }

    // Fetch tenant with unit and property
    const tenantConditions = [eq(tenants.id, Number(tenantId)), eq(tenants.organizationId, orgId)];
    if (req.user.role === "landlord") tenantConditions.push(eq(properties.ownerId, req.user.id));

    const [tenant] = await db
      .select({
        id: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        email: tenants.email,
        currency: tenants.currency,
        organizationId: tenants.organizationId,
        unitId: tenants.unitId,
        unitNumber: units.unitNumber,
        propertyName: properties.name,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...tenantConditions))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found in this organization" });
    }

    // Optionally fetch meter number from utility account
    let meterNumber: string | undefined;
    if (tenant.unitId) {
      const [account] = await db
        .select({ meterNumber: utilityAccounts.meterNumber })
        .from(utilityAccounts)
        .leftJoin(utilityProviders, eq(utilityAccounts.providerId, utilityProviders.id))
        .where(and(
          eq(utilityAccounts.unitId, tenant.unitId),
          eq(utilityAccounts.isActive, true),
        ))
        .limit(1);
      meterNumber = account?.meterNumber ?? undefined;
    }

    // Compute bill
    const prev = Number(previousReading);
    const curr = Number(currentReading);
    const consumed = curr - prev;
    const rate = Number(unitCost);
    const total = consumed * rate;
    const billCurrency = currency || tenant.currency || "KES";
    const billNumber = generateBillNumber();

    // Persist to utility_bills table — always saved with tenantId + utilityType
    // so the tenant portal /my-bills endpoint can retrieve it even when no
    // utilityAccount row exists (common in Nairobi shared-meter buildings).
    let savedBill: any = null;
    try {
      // Try to find a matching utility account (optional — used for meter linkage)
      let accountId: number | null = null;
      if (tenant.unitId) {
        const [acc] = await db
          .select({ id: utilityAccounts.id })
          .from(utilityAccounts)
          .leftJoin(utilityProviders, eq(utilityAccounts.providerId, utilityProviders.id))
          .where(and(
            eq(utilityAccounts.unitId, tenant.unitId),
            eq(utilityAccounts.isActive, true),
          ))
          .limit(1);
        accountId = acc?.id ?? null;
      }

      // Always insert the bill — with or without an account.
      // tenantId is the canonical fallback lookup key for /my-bills.
      const insertValues: Record<string, any> = {
        tenantId: tenant.id,
        utilityType,
        billNumber,
        billingPeriodStart: new Date(billingPeriodStart),
        billingPeriodEnd: new Date(billingPeriodEnd),
        dueDate: new Date(dueDate),
        amount: String(total),
        currency: billCurrency,
        unitsConsumed: String(consumed),
        unitRate: String(rate),
        previousReading: String(prev),
        currentReading: String(curr),
        status: "pending",
        notes: notes || null,
      };
      if (accountId) insertValues.accountId = accountId;

      const [bill] = await db
        .insert(utilityBills)
        .values(insertValues as any)
        .returning();
      savedBill = bill;
    } catch (dbErr) {
      // Non-fatal: log and continue — email will still be sent
      console.warn("[utility-bill-sender] Could not persist bill to DB:", dbErr);
    }

    // Send email
    await sendUtilityBillEmail({
      to: tenant.email,
      tenantFirstName: tenant.firstName,
      tenantLastName: tenant.lastName,
      unitNumber: tenant.unitNumber ?? "N/A",
      propertyName: tenant.propertyName ?? "N/A",
      utilityType,
      previousReading: prev,
      currentReading: curr,
      unitsConsumed: consumed,
      unitCost: rate,
      totalAmount: total,
      currency: billCurrency,
      billingPeriodStart,
      billingPeriodEnd,
      dueDate,
      billNumber,
      meterNumber,
      notes,
    });

    return res.json({
      success: true,
      billNumber,
      totalAmount: total,
      currency: billCurrency,
      sentTo: tenant.email,
      savedBillId: savedBill?.id ?? null,
    });
  } catch (err: any) {
    console.error("[utility-bill-sender] POST /send-email:", err);
    return res.status(500).json({ message: err?.message ?? "Failed to send utility bill email" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/utility-bills/send-bulk
// Body: {
//   utilityType, unitCost, billingPeriodStart, billingPeriodEnd, dueDate,
//   currency?, notes?,
//   readings: [{ tenantId, previousReading, currentReading }]
// }
// ─────────────────────────────────────────────────────────────────────────────
utilityBillSenderRouter.post("/send-bulk", managerOnly as any, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const {
      utilityType,
      unitCost,
      billingPeriodStart,
      billingPeriodEnd,
      dueDate,
      currency,
      notes,
      readings,
    } = req.body;

    if (!utilityType || !unitCost || !billingPeriodStart || !billingPeriodEnd || !dueDate) {
      return res.status(400).json({
        message: "utilityType, unitCost, billingPeriodStart, billingPeriodEnd, and dueDate are required",
      });
    }

    if (!Array.isArray(readings) || readings.length === 0) {
      return res.status(400).json({ message: "readings array with at least one entry is required" });
    }

    // Validate each reading
    for (const r of readings) {
      if (!r.tenantId || r.previousReading == null || r.currentReading == null) {
        return res.status(400).json({ message: "Each reading must have tenantId, previousReading, and currentReading" });
      }
      if (Number(r.currentReading) < Number(r.previousReading)) {
        return res.status(400).json({ message: `currentReading must be >= previousReading for tenant ${r.tenantId}` });
      }
    }

    // Fetch all referenced tenants in one query
    const tenantIds = readings.map((r: any) => Number(r.tenantId));
    const bulkTenantConditions = [eq(tenants.organizationId, orgId), inArray(tenants.id, tenantIds)];
    if (req.user.role === "landlord") bulkTenantConditions.push(eq(properties.ownerId, req.user.id));

    const tenantRows = await db
      .select({
        id: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        email: tenants.email,
        currency: tenants.currency,
        organizationId: tenants.organizationId,
        unitId: tenants.unitId,
        unitNumber: units.unitNumber,
        propertyName: properties.name,
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...bulkTenantConditions));

    const tenantMap = new Map(tenantRows.map((t) => [t.id, t]));
    const rate = Number(unitCost);
    const billCurrency = currency || "KES";

    // Build payloads
    const bulkPayloads: BulkPayload[] = [];
    const persistJobs: Promise<any>[] = [];

    for (const r of readings) {
      const tenant = tenantMap.get(Number(r.tenantId));
      if (!tenant) continue;

      const prev = Number(r.previousReading);
      const curr = Number(r.currentReading);
      const consumed = curr - prev;
      const total = consumed * rate;
      const billNumber = generateBillNumber();

      bulkPayloads.push({
        tenantId: tenant.id,
        to: tenant.email,
        tenantFirstName: tenant.firstName,
        tenantLastName: tenant.lastName,
        unitNumber: tenant.unitNumber ?? "N/A",
        propertyName: tenant.propertyName ?? "N/A",
        utilityType,
        previousReading: prev,
        currentReading: curr,
        unitsConsumed: consumed,
        unitCost: rate,
        totalAmount: total,
        currency: billCurrency,
        billingPeriodStart,
        billingPeriodEnd,
        dueDate,
        billNumber,
        notes,
      });

      // Persist each bill — always saved with tenantId + utilityType so the
      // tenant portal can show it even when no utilityAccount row exists.
      {
        const job = (async () => {
          // Optionally link to an existing utility account for meter info
          let accountId: number | null = null;
          if (tenant.unitId) {
            const [acc] = await db
              .select({ id: utilityAccounts.id })
              .from(utilityAccounts)
              .where(and(
                eq(utilityAccounts.unitId, tenant.unitId as number),
                eq(utilityAccounts.isActive, true),
              ))
              .limit(1);
            accountId = acc?.id ?? null;
          }
          const insertValues: Record<string, any> = {
            tenantId: tenant.id,   // was incorrectly tenant.tenantId — tenant.id is the correct field
            utilityType: utilityType || "other",
            billNumber,
            billingPeriodStart: new Date(billingPeriodStart),
            billingPeriodEnd: new Date(billingPeriodEnd),
            dueDate: new Date(dueDate),
            amount: String(total),
            currency: billCurrency,
            unitsConsumed: String(consumed),
            unitRate: String(rate),
            previousReading: String(prev),
            currentReading: String(curr),
            status: "pending",
            notes: notes || null,
          };
          if (accountId) insertValues.accountId = accountId;
          await db.insert(utilityBills).values(insertValues as any);
        })().catch((e) => console.warn("[utility-bill-sender] bulk DB persist error:", e));
        persistJobs.push(job);
      }
    }

    // Send all emails
    const results = await sendBulkUtilityBillEmails(bulkPayloads);

    // Wait for DB writes
    await Promise.allSettled(persistJobs);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.json({
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (err: any) {
    console.error("[utility-bill-sender] POST /send-bulk:", err);
    return res.status(500).json({ message: err?.message ?? "Failed to send bulk utility bill emails" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/utility-bills/my-bills?tenantId=X
// Returns utility bills for the given tenant (matched via their unit's accounts).
// Used by the tenant portal "Utility Bills" tab.
// ─────────────────────────────────────────────────────────────────────────────
utilityBillSenderRouter.get("/my-bills", async (req: any, res: any) => {
  try {
    // Support both ?tenantId=X (from portal) and auto-resolve from JWT (when
    // the logged-in user IS the tenant and their tenantId is in the token).
    const tenantId = parseInt(req.query.tenantId as string) || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ message: "tenantId is required" });

    // PRIMARY: fetch bills stored directly against this tenant
    // (new path — works even without a utility account row)
    const directBills = await db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.tenantId!, tenantId))
      .orderBy(utilityBills.createdAt);

    // SECONDARY: also fetch via unit's utility accounts (legacy path — for
    // bills that were saved before the tenantId column existed)
    const [tenant] = await db
      .select({ unitId: tenants.unitId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    let legacyBills: any[] = [];
    if (tenant?.unitId) {
      const accounts = await db
        .select({ id: utilityAccounts.id, meterNumber: utilityAccounts.meterNumber })
        .from(utilityAccounts)
        .where(eq(utilityAccounts.unitId, tenant.unitId));

      if (accounts.length > 0) {
        const accountIds = accounts.map((a) => a.id);
        const rawLegacy = await db
          .select()
          .from(utilityBills)
          .where(inArray(utilityBills.accountId, accountIds))
          .orderBy(utilityBills.createdAt);

        // Only include bills that weren't already captured in the direct query
        const directIds = new Set(directBills.map((b) => b.id));
        legacyBills = rawLegacy
          .filter((b) => !directIds.has(b.id))
          .map((b) => {
            const acc = accounts.find((a) => a.id === b.accountId);
            return { ...b, meterNumber: acc?.meterNumber ?? null };
          });
      }
    }

    // Merge, de-duplicate, sort newest first
    const all = [...directBills, ...legacyBills].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.json(all);
  } catch (err) {
    console.error("[utility-bill-sender] GET /my-bills:", err);
    return res.status(500).json({ message: "Failed to fetch utility bills" });
  }
});