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
import { utilityBalances } from "../services/rent-ledger";
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

const validDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime());
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (v: unknown) => v !== null && v !== "" && Number.isFinite(Number(v));

/** Shared checks for the bill header (type, rate, period, due date). Returns a message, or null when fine. */
function billHeaderError(b: { utilityType: unknown; unitCost: unknown; billingPeriodStart: unknown; billingPeriodEnd: unknown; dueDate: unknown }): string | null {
  if (typeof b.utilityType !== "string" || !b.utilityType.trim() || b.utilityType.length > 30) return "utilityType is required (e.g. water, electricity).";
  if (!finite(b.unitCost) || Number(b.unitCost) <= 0) return "unitCost must be a number greater than zero.";
  if (!validDay(b.billingPeriodStart) || !validDay(b.billingPeriodEnd) || !validDay(b.dueDate)) return "billingPeriodStart, billingPeriodEnd and dueDate must be valid dates.";
  if (new Date(b.billingPeriodEnd as string) < new Date(b.billingPeriodStart as string)) return "The billing period ends before it starts.";
  if (new Date(b.dueDate as string) < new Date(b.billingPeriodStart as string)) return "The due date is before the billing period starts.";
  return null;
}

/** Has this tenant already been billed for this utility and period? (a double click used to bill them twice) */
async function alreadyBilled(tenantId: number, utilityType: string, start: string, end: string): Promise<boolean> {
  const rows = await db.select({ id: utilityBills.id }).from(utilityBills)
    .where(and(eq(utilityBills.tenantId, tenantId), eq(utilityBills.utilityType, utilityType), eq(utilityBills.billingPeriodStart, new Date(start)), eq(utilityBills.billingPeriodEnd, new Date(end))))
    .limit(1);
  return rows.length > 0;
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

    if (!finite(previousReading) || !finite(currentReading) || Number(previousReading) < 0) {
      return res.status(400).json({ message: "Meter readings must be numbers." });
    }
    if (Number(currentReading) < Number(previousReading)) {
      return res.status(400).json({ message: "currentReading must be >= previousReading" });
    }
    const headerErr = billHeaderError({ utilityType, unitCost, billingPeriodStart, billingPeriodEnd, dueDate });
    if (headerErr) return res.status(400).json({ message: headerErr });

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
    const consumed = r2(curr - prev);
    const rate = Number(unitCost);
    const total = r2(consumed * rate);
    if (!(total > 0)) return res.status(400).json({ message: "No consumption between the two readings, so there is nothing to bill." });
    if (await alreadyBilled(tenant.id, utilityType, billingPeriodStart, billingPeriodEnd)) {
      return res.status(409).json({ message: `This tenant has already been billed for ${utilityType} for that period.` });
    }
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
        amount: total.toFixed(2),
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
      // The bill must exist in the system before the tenant is told about it: an emailed bill that is not on their
      // portal cannot be paid or reconciled. (This used to log a warning and email a bill that did not exist.)
      console.error("[utility-bill-sender] Could not save the bill — nothing was sent:", dbErr);
      return res.status(500).json({ message: "The bill could not be saved, so it was not sent. Please try again." });
    }

    // The bill is already saved and visible on the tenant's portal, so an email problem (provider not configured, bad
    // address) must not look like a failed billing run — report it separately and let the manager resend.
    let emailSent = true; let emailError: string | null = null;
    try {
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
    } catch (mailErr: any) {
      emailSent = false; emailError = mailErr?.message ?? "Email could not be sent";
      console.warn("[utility-bill-sender] bill saved but email failed:", emailError);
    }

    return res.json({
      success: true,
      billNumber,
      totalAmount: total,
      currency: billCurrency,
      sentTo: emailSent ? tenant.email : null,
      emailSent,
      emailError,
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
    const bulkHeaderErr = billHeaderError({ utilityType, unitCost, billingPeriodStart, billingPeriodEnd, dueDate });
    if (bulkHeaderErr) return res.status(400).json({ message: bulkHeaderErr });

    if (!Array.isArray(readings) || readings.length === 0) {
      return res.status(400).json({ message: "readings array with at least one entry is required" });
    }

    // Validate each reading
    for (const r of readings) {
      if (!r.tenantId || r.previousReading == null || r.currentReading == null) {
        return res.status(400).json({ message: "Each reading must have tenantId, previousReading, and currentReading" });
      }
      if (!finite(r.previousReading) || !finite(r.currentReading) || Number(r.previousReading) < 0) {
        return res.status(400).json({ message: `Meter readings must be numbers (tenant ${r.tenantId}).` });
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

    // Build payloads. A row that cannot or should not be billed is reported back in `skipped` instead of vanishing.
    const bulkPayloads: BulkPayload[] = [];
    const persistJobs: Promise<any>[] = [];
    const skipped: Array<{ tenantId: number; reason: string }> = [];
    const savedOk = new Set<number>();

    for (const r of readings) {
      const tenant = tenantMap.get(Number(r.tenantId));
      if (!tenant) { skipped.push({ tenantId: Number(r.tenantId), reason: "Tenant not found in your organisation" }); continue; }

      const prev = Number(r.previousReading);
      const curr = Number(r.currentReading);
      const consumed = r2(curr - prev);
      const total = r2(consumed * rate);
      if (!(total > 0)) { skipped.push({ tenantId: tenant.id, reason: "No consumption — nothing to bill" }); continue; }
      if (await alreadyBilled(tenant.id, utilityType, billingPeriodStart, billingPeriodEnd)) { skipped.push({ tenantId: tenant.id, reason: "Already billed for this period" }); continue; }
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
            amount: total.toFixed(2),
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
          savedOk.add(tenant.id);
        })().catch((e) => console.error("[utility-bill-sender] bulk DB persist error — this tenant will not be emailed:", e));
        persistJobs.push(job);
      }
    }

    // Save first, THEN email: a tenant must never be told about a bill that does not exist in the system.
    await Promise.allSettled(persistJobs);
    const toSend = bulkPayloads.filter((p) => savedOk.has(p.tenantId));
    for (const p of bulkPayloads) if (!savedOk.has(p.tenantId)) skipped.push({ tenantId: p.tenantId, reason: "The bill could not be saved" });

    const results = await sendBulkUtilityBillEmails(toSend);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.json({
      total: results.length,
      succeeded,
      failed,
      skipped,
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
    const role: string = req.user?.role ?? "";
    let tenantId: number | undefined;

    if (role === "tenant") {
      // Always resolve from the JWT for a tenant caller — never trust the
      // query param, which previously took priority over their own identity
      // and let any tenant view any other tenant's bills by passing an id.
      const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
      if (!own) return res.status(403).json({ message: "Tenant profile not found" });
      tenantId = own.id;
    } else {
      tenantId = parseInt(req.query.tenantId as string) || undefined;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      // Non-tenant callers (staff/admin/manager/landlord) must still only see
      // bills for a tenant within their own org.
      const [target] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, req.user.organizationId))).limit(1);
      if (!target) return res.status(404).json({ message: "Tenant not found" });
    }

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

    // part payments: what has been paid and what is still owed (a part-paid bill stays pending until it is settled)
    const bal = await utilityBalances(all as any);
    return res.json(all.map((b: any) => ({ ...b, ...(bal.get(b.id) ?? { paidAmount: 0, balance: Number(b.amount) || 0 }) })));
  } catch (err) {
    console.error("[utility-bill-sender] GET /my-bills:", err);
    return res.status(500).json({ message: "Failed to fetch utility bills" });
  }
});