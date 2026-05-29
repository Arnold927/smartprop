/**
 * import.ts — Bulk import route
 * Mounted at /api/import
 *
 * POST /api/import/bulk            — tenants (backward-compatible)
 * POST /api/import/properties      — properties + units
 * POST /api/import/rent-payments   — historical rent payments
 * GET  /api/import/templates       — CSV column reference
 */

import { Router } from "express";
import { db }     from "../db";
import { users, tenants, units, properties, rentPayments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

const MAX_ROWS = 500;

function parseDate(v?: string): string | null {
  if (!v) return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function parseMoney(v?: string): string {
  if (!v) return "0";
  return String(Math.abs(parseFloat(v.replace(/[^0-9.]/g, "")) || 0));
}

function norm(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, "_"), (v ?? "").trim()])
  );
}

// ── POST /api/import/bulk — TENANTS ──────────────────────────────────────────

router.post("/bulk", async (req: any, res: any) => {
  const orgId: number = req.user.organizationId;
  const rows = (req.body?.tenants ?? []).map(norm);
  const propertyId: number | null = req.body?.propertyId ?? null;

  if (!rows.length) return res.status(400).json({ message: "No tenant rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} tenants per import.` });

  let imported = 0, skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`;
    try {
      const firstName = row.first_name ?? row.firstname ?? "";
      const lastName  = row.last_name  ?? row.lastname  ?? "";
      const email     = (row.email ?? "").toLowerCase();
      if (!email || !firstName || !lastName) {
        errors.push(`${label}: missing firstName, lastName, or email — skipped`);
        skipped++; continue;
      }

      const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      let userId: string;
      if (existingUser) {
        const [et] = await db.select({ id: tenants.id }).from(tenants)
          .where(and(eq(tenants.userId, existingUser.id), eq(tenants.organizationId, orgId))).limit(1);
        if (et) { skipped++; continue; }
        userId = existingUser.id;
      } else {
        const hash = await bcrypt.hash(randomBytes(16).toString("hex"), 10);
        const [nu] = await db.insert(users).values({
          email, passwordHash: hash, firstName, lastName,
          role: "tenant", organizationId: orgId,
        } as any).returning({ id: users.id });
        userId = nu.id;
      }

      let unitId: number | null = null;
      const unitNumber = row.unit_number ?? row.unitnumber ?? row.unit ?? "";
      if (unitNumber && propertyId) {
        const [u] = await db.select({ id: units.id }).from(units)
          .where(and(eq(units.propertyId, propertyId), eq(units.unitNumber, unitNumber), eq(units.organizationId, orgId))).limit(1);
        if (u) unitId = u.id;
      }

      await db.insert(tenants).values({
        organizationId: orgId, userId,
        firstName, lastName, email,
        phone:          row.phone ?? null,
        unitId,
        monthlyRent:    parseMoney(row.monthly_rent ?? row.rent),
        currency:       row.currency ?? "KES",
        leaseStartDate: parseDate(row.lease_start_date ?? row.lease_start),
        leaseEndDate:   parseDate(row.lease_end_date   ?? row.lease_end),
        securityDeposit: parseMoney(row.security_deposit ?? row.deposit),
        status: "active",
      } as any);
      imported++;
    } catch (err: any) {
      errors.push(`${label} (${rows[i].email ?? "?"}): ${err.message}`);
    }
  }

  res.json({ imported, skipped, errors });
});

// ── POST /api/import/properties — PROPERTIES + UNITS ─────────────────────────

router.post("/properties", async (req: any, res: any) => {
  const orgId = req.user.organizationId;
  const rows = (req.body?.rows ?? req.body?.units ?? []).map(norm);

  if (!rows.length) return res.status(400).json({ message: "No rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} rows per import.` });

  let importedProps = 0, importedUnits = 0, skippedUnits = 0;
  const errors: string[] = [];
  const propCache: Record<string, number> = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`;
    try {
      const propName = row.property_name ?? row.property ?? row.name ?? "";
      const unitNum  = row.unit_number   ?? row.unit ?? "";
      if (!propName || !unitNum) {
        errors.push(`${label}: property_name and unit_number required — skipped`);
        skippedUnits++; continue;
      }

      // Upsert property
      let propId = propCache[propName.toLowerCase()];
      if (!propId) {
        const [ex] = await db.select({ id: properties.id }).from(properties)
          .where(and(eq(properties.organizationId, orgId), eq(properties.name, propName))).limit(1);
        if (ex) {
          propId = ex.id;
        } else {
          const [np] = await db.insert(properties).values({
            organizationId: orgId,
            name:       propName,
            address:    row.address ?? propName,
            totalUnits: parseInt(row.total_units ?? "0") || 0,
          } as any).returning({ id: properties.id });
          propId = np.id;
          importedProps++;
        }
        propCache[propName.toLowerCase()] = propId;
      }

      // Check duplicate unit
      const [eu] = await db.select({ id: units.id }).from(units)
        .where(and(eq(units.propertyId, propId), eq(units.unitNumber, unitNum), eq(units.organizationId, orgId))).limit(1);
      if (eu) { skippedUnits++; continue; }

      await db.insert(units).values({
        organizationId: orgId,
        propertyId:  propId,
        unitNumber:  unitNum,
        monthlyRent: parseMoney(row.monthly_rent ?? row.rent),
        currency:    row.currency ?? "KES",
        bedrooms:    parseInt(row.bedrooms ?? "0") || null,
        bathrooms:   row.bathrooms ? String(parseFloat(row.bathrooms)) : null,
        sqft:        parseInt(row.sqft ?? "0") || null,
        isOccupied:  false,
      } as any);
      importedUnits++;
    } catch (err: any) {
      errors.push(`${label}: ${err.message}`);
    }
  }

  res.json({ importedProperties: importedProps, importedUnits, skippedUnits, errors });
});

// ── POST /api/import/rent-payments — HISTORICAL PAYMENTS ─────────────────────

router.post("/rent-payments", async (req: any, res: any) => {
  const orgId = req.user.organizationId;
  const rows = (req.body?.rows ?? req.body?.payments ?? []).map(norm);

  if (!rows.length) return res.status(400).json({ message: "No rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} rows per import.` });

  let imported = 0, skipped = 0;
  const errors: string[] = [];
  const tenantCache: Record<string, number | null> = {};

  const resolveTenant = async (row: Record<string, string>): Promise<number | null> => {
    const tid = row.tenant_id ?? row.tenantid;
    if (tid) return parseInt(tid) || null;
    const email = (row.tenant_email ?? row.email ?? "").toLowerCase();
    if (!email) return null;
    if (email in tenantCache) return tenantCache[email];
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!u) { tenantCache[email] = null; return null; }
    const [t] = await db.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.userId, u.id), eq(tenants.organizationId, orgId))).limit(1);
    tenantCache[email] = t?.id ?? null;
    return tenantCache[email];
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`;
    try {
      const tenantId = await resolveTenant(row);
      if (!tenantId) { errors.push(`${label}: tenant not found — skipped`); skipped++; continue; }

      const dueDate = parseDate(row.due_date ?? row.duedate);
      if (!dueDate) { errors.push(`${label}: invalid due_date — skipped`); skipped++; continue; }

      const amount = parseMoney(row.amount);
      if (Number(amount) <= 0) { errors.push(`${label}: invalid amount — skipped`); skipped++; continue; }

      // Idempotency
      const mpesaRef = row.mpesa_transaction_id ?? row.mpesa_id ?? null;
      if (mpesaRef) {
        const [dup] = await db.select({ id: rentPayments.id }).from(rentPayments)
          .where(eq(rentPayments.mpesaTransactionId, mpesaRef)).limit(1);
        if (dup) { skipped++; continue; }
      } else {
        const [dup] = await db.select({ id: rentPayments.id }).from(rentPayments)
          .where(and(eq(rentPayments.tenantId, tenantId), eq(rentPayments.dueDate, dueDate))).limit(1);
        if (dup) { skipped++; continue; }
      }

      const paidDate  = parseDate(row.paid_date ?? row.paiddate);
      const rawStatus = (row.status ?? "").toLowerCase();
      const status    = ["paid","overdue","partial","pending"].includes(rawStatus)
        ? (rawStatus as any) : (paidDate ? "paid" : "pending");

      await db.insert(rentPayments).values({
        tenantId, amount,
        currency:           row.currency ?? "KES",
        dueDate,
        paidDate:           paidDate ?? null,
        paymentMethod:      row.payment_method ?? row.method ?? null,
        mpesaTransactionId: mpesaRef ?? null,
        bankReference:      row.bank_reference ?? row.bank_ref ?? null,
        status,
        notes: row.notes ?? "Imported from historical data",
      } as any);
      imported++;
    } catch (err: any) {
      errors.push(`${label}: ${err.message}`);
    }
  }

  res.json({ imported, skipped, errors });
});

// ── GET /api/import/templates — column reference ──────────────────────────────

router.get("/templates", (_req: any, res: any) => {
  res.json({
    tenants: {
      description: "One row per tenant. A user account is created for each.",
      required: ["first_name", "last_name", "email"],
      optional: ["phone", "unit_number", "monthly_rent", "currency", "lease_start_date", "lease_end_date", "security_deposit"],
      example:  { first_name: "Jane", last_name: "Mwangi", email: "jane@example.com", phone: "0712345678", unit_number: "A101", monthly_rent: "85000", currency: "KES", lease_start_date: "2025-01-01", lease_end_date: "2025-12-31", security_deposit: "170000" },
    },
    properties: {
      description: "One row per unit. Rows with the same property_name share a property record.",
      required: ["property_name", "unit_number", "monthly_rent"],
      optional: ["address", "total_units", "bedrooms", "bathrooms", "sqft", "currency"],
      example:  { property_name: "Runda Heights", address: "Runda Road, Nairobi", unit_number: "A101", monthly_rent: "85000", bedrooms: "2", bathrooms: "2", sqft: "1200", currency: "KES" },
    },
    rent_payments: {
      description: "One row per payment. Deduplicates by mpesa_transaction_id or (tenant_email + due_date).",
      required: ["tenant_email", "amount", "due_date"],
      optional: ["paid_date", "payment_method", "mpesa_transaction_id", "bank_reference", "status", "currency", "notes"],
      example:  { tenant_email: "jane@example.com", amount: "85000", due_date: "2025-01-01", paid_date: "2025-01-03", payment_method: "mpesa", mpesa_transaction_id: "QHN12345AB", status: "paid", currency: "KES" },
    },
  });
});

export default router;
