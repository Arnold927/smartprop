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
import { eq, and, inArray, sql } from "drizzle-orm";
import { issueInvite } from "../utils/invites";
import { storage } from "../storage";
import { checkCanAdd } from "../services/plans";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

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
//
// Each tenant goes through the same steps as "Add tenant": an organisation-scoped portal login (a
// pending invite — the tenant sets a password from the link), the unit must be vacant, and the
// unit's occupancy is updated. Send { dryRun: true } to see what would happen without saving, and
// { sendInvites: true } to email each new tenant their sign-in link.

router.post("/bulk", async (req: any, res: any) => {
  const orgId: number = req.user.organizationId;
  const rows = (req.body?.tenants ?? []).map(norm);
  const dryRun = req.body?.dryRun === true;
  const sendInvites = req.body?.sendInvites === true;
  const propertyId: number | null = req.body?.propertyId != null ? Number(req.body.propertyId) : null;

  if (!rows.length) return res.status(400).json({ message: "No tenant rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} tenants per import.` });

  if (propertyId != null) {
    const [prop] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!prop) return res.status(400).json({ message: "That property was not found in your organisation." });
  }

  const errors: string[] = [];
  let skipped = 0;
  type Planned = { label: string; firstName: string; lastName: string; email: string; unitId: number | null; row: Record<string, string> };
  const planned: Planned[] = [];
  const seenEmails = new Set<string>();
  const claimedUnits = new Set<number>();

  // ── Phase 1: check every row, change nothing ──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`;
    const firstName = row.first_name ?? row.firstname ?? "";
    const lastName  = row.last_name  ?? row.lastname  ?? "";
    const email     = (row.email ?? "").toLowerCase();
    if (!email || !firstName || !lastName) { errors.push(`${label}: missing first_name, last_name, or email — skipped`); skipped++; continue; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push(`${label} (${email}): not a valid email — skipped`); skipped++; continue; }
    if (seenEmails.has(email)) { errors.push(`${label} (${email}): appears twice in this file — skipped`); skipped++; continue; }
    seenEmails.add(email);

    const [already] = await db.select({ id: tenants.id }).from(tenants)
      .where(and(eq(tenants.organizationId, orgId), sql`lower(${tenants.email}) = ${email}`)).limit(1);
    if (already) { errors.push(`${label} (${email}): already a tenant here — skipped`); skipped++; continue; }

    let unitId: number | null = null;
    const unitNumber = row.unit_number ?? row.unitnumber ?? row.unit ?? "";
    if (unitNumber) {
      if (!propertyId) { errors.push(`${label} (${email}): a unit number was given but no property was chosen — skipped`); skipped++; continue; }
      const [u] = await db.select({ id: units.id }).from(units)
        .where(and(eq(units.propertyId, propertyId), eq(units.unitNumber, unitNumber), eq(units.organizationId, orgId))).limit(1);
      if (!u) { errors.push(`${label} (${email}): unit "${unitNumber}" was not found in that property — skipped`); skipped++; continue; }
      if (claimedUnits.has(u.id)) { errors.push(`${label} (${email}): unit "${unitNumber}" is given to another tenant earlier in this file — skipped`); skipped++; continue; }
      const [holder] = await db.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.organizationId, orgId), eq(tenants.unitId, u.id), inArray(tenants.status, ["active", "pending"]))).limit(1);
      if (holder) { errors.push(`${label} (${email}): unit "${unitNumber}" is already occupied — skipped`); skipped++; continue; }
      claimedUnits.add(u.id);
      unitId = u.id;
    }
    planned.push({ label, firstName, lastName, email, unitId, row });
  }

  if (dryRun) return res.json({ dryRun: true, wouldImport: planned.length, imported: 0, skipped, errors });

  // ── Phase 2: create them ──
  let imported = 0, invitesSent = 0;
  const { deliverInvite } = await import("../utils/invites");
  for (const p of planned) {
    try {
      const invite = await issueInvite({
        organizationId: orgId, invitedByUserId: req.user.id, email: p.email,
        role: "tenant", firstName: p.firstName, lastName: p.lastName,
      });
      await storage.createTenant({
        organizationId: orgId, userId: invite.userId,
        firstName: p.firstName, lastName: p.lastName, email: p.email,
        phone:          p.row.phone ?? null,
        unitId:         p.unitId,
        monthlyRent:    parseMoney(p.row.monthly_rent ?? p.row.rent),
        currency:       p.row.currency ?? "KES",
        leaseStartDate: parseDate(p.row.lease_start_date ?? p.row.lease_start),
        leaseEndDate:   parseDate(p.row.lease_end_date   ?? p.row.lease_end),
        securityDeposit: parseMoney(p.row.security_deposit ?? p.row.deposit),
        status: "active",
      } as any);
      imported++;
      if (sendInvites && invite.link) {
        if (await deliverInvite({ to: p.email, link: invite.link })) invitesSent++;
      }
    } catch (err: any) {
      skipped++;
      errors.push(`${p.label} (${p.email}): ${err.message}`);
    }
  }

  res.json({ imported, skipped, errors, invitesSent });
});

// ── POST /api/import/properties — PROPERTIES + UNITS ─────────────────────────
//
// Checked first, then saved in one go: if the file would take the organisation past its plan's
// property or unit limit nothing is created. { dryRun: true } reports what would happen.

const UNIT_TYPES = ["apartment", "house", "office", "retail", "kiosk", "anchor_retail", "warehouse", "parking", "storage", "other"];

router.post("/properties", async (req: any, res: any) => {
  const orgId = req.user.organizationId;
  const rows = (req.body?.rows ?? req.body?.units ?? []).map(norm);
  const dryRun = req.body?.dryRun === true;

  if (!rows.length) return res.status(400).json({ message: "No rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} rows per import.` });

  const errors: string[] = [];
  let skippedUnits = 0;

  // ── Phase 1: work out what is new ──
  const existingProps = new Map<string, number>(); // lower(name) → id
  for (const p of await db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.organizationId, orgId))) {
    existingProps.set(p.name.toLowerCase(), p.id);
  }
  type NewUnit = { propKey: string; propName: string; address: string; unitNum: string; row: Record<string, string> };
  const newProps = new Map<string, { name: string; address: string }>(); // lower(name) → details
  const newUnits: NewUnit[] = [];
  const seenUnit = new Set<string>();
  const unitsByProp = new Map<number, Set<string>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`;
    const propName = row.property_name ?? row.property ?? row.name ?? "";
    const unitNum  = row.unit_number   ?? row.unit ?? "";
    if (!propName || !unitNum) { errors.push(`${label}: property_name and unit_number required — skipped`); skippedUnits++; continue; }
    const propKey = propName.toLowerCase();
    const dupKey = `${propKey}\u0000${unitNum.toLowerCase()}`;
    if (seenUnit.has(dupKey)) { errors.push(`${label}: unit "${unitNum}" is listed twice for ${propName} — skipped`); skippedUnits++; continue; }
    seenUnit.add(dupKey);

    const existingId = existingProps.get(propKey);
    if (existingId != null) {
      if (!unitsByProp.has(existingId)) {
        const rowsU = await db.select({ n: units.unitNumber }).from(units).where(and(eq(units.propertyId, existingId), eq(units.organizationId, orgId)));
        unitsByProp.set(existingId, new Set(rowsU.map((r) => String(r.n).toLowerCase())));
      }
      if (unitsByProp.get(existingId)!.has(unitNum.toLowerCase())) { skippedUnits++; continue; } // already there
    } else if (!newProps.has(propKey)) {
      newProps.set(propKey, { name: propName, address: row.address ?? propName });
    }
    newUnits.push({ propKey, propName, address: row.address ?? propName, unitNum, row });
  }

  // ── Plan limits: the whole file has to fit ──
  const propRoom = newProps.size ? await checkCanAdd(orgId, "maxProperties", newProps.size) : ({ ok: true } as const);
  const unitRoom = newUnits.length ? await checkCanAdd(orgId, "maxUnits", newUnits.length) : ({ ok: true } as const);
  const limitFail = !propRoom.ok ? propRoom : !unitRoom.ok ? unitRoom : null;

  if (dryRun) {
    return res.json({
      dryRun: true, wouldCreateProperties: newProps.size, wouldCreateUnits: newUnits.length, skippedUnits, errors,
      limitError: limitFail ? limitFail.body : null,
    });
  }
  if (limitFail) return res.status(limitFail.status).json({ ...limitFail.body, nothingImported: true });

  // ── Phase 2: save everything or nothing ──
  try {
    const result = await db.transaction(async (tx) => {
      const propIds = new Map(existingProps);
      let importedProps = 0;
      for (const [key, np] of newProps) {
        const [created] = await tx.insert(properties).values({
          organizationId: orgId, name: np.name, address: np.address, totalUnits: 0,
        } as any).returning({ id: properties.id });
        propIds.set(key, created.id);
        importedProps++;
      }
      const touched = new Set<number>();
      for (const nu of newUnits) {
        const row = nu.row;
        const propId = propIds.get(nu.propKey)!;
        // unit_type / floor / rent_basis / rate_per_sqft: unknown values fall back to the old defaults.
        const rawType = (row.unit_type ?? row.type ?? "").toLowerCase().replace(/\s+/g, "_");
        const unitType = UNIT_TYPES.includes(rawType) ? rawType : "apartment";
        const sqftVal = parseInt(row.sqft ?? "0") || null;
        const rateVal = parseFloat((row.rate_per_sqft ?? "").replace(/[^0-9.]/g, "")) || 0;
        const perSqft = (row.rent_basis ?? "").toLowerCase() === "per_sqft" && !!sqftVal && rateVal > 0;
        const rentVal = parseMoney(row.monthly_rent ?? row.rent);
        const residentialUnit = unitType === "apartment" || unitType === "house";
        await tx.insert(units).values({
          organizationId: orgId, propertyId: propId, unitNumber: nu.unitNum,
          floor: row.floor ? row.floor.slice(0, 20) : null,
          unitType,
          rentBasis: perSqft ? "per_sqft" : "fixed",
          ratePerSqft: perSqft ? String(rateVal) : null,
          monthlyRent: perSqft && Number(rentVal) === 0 ? String(Math.round(sqftVal! * rateVal * 100) / 100) : rentVal,
          currency: row.currency ?? "KES",
          bedrooms: residentialUnit ? (parseInt(row.bedrooms ?? "0") || null) : null,
          bathrooms: residentialUnit && row.bathrooms ? String(parseFloat(row.bathrooms)) : null,
          sqft: sqftVal,
          isOccupied: false,
        } as any);
        touched.add(propId);
      }
      // a property's unit count used to stay at 0 (or whatever total_units said); keep it true to its units
      for (const pid of touched) {
        await tx.update(properties)
          .set({ totalUnits: sql`(SELECT count(*)::int FROM units WHERE units.property_id = ${pid})` } as any)
          .where(eq(properties.id, pid));
      }
      return { importedProps, importedUnits: newUnits.length };
    });
    res.json({ importedProperties: result.importedProps, importedUnits: result.importedUnits, skippedUnits, errors });
  } catch (err: any) {
    console.error("[import] properties failed:", err);
    res.status(500).json({ message: "The import failed and nothing was saved. " + (err?.message ?? ""), nothingImported: true });
  }
});

// ── POST /api/import/rent-payments — HISTORICAL PAYMENTS ─────────────────────

router.post("/rent-payments", async (req: any, res: any) => {
  const orgId = req.user.organizationId;
  const rows = (req.body?.rows ?? req.body?.payments ?? []).map(norm);
  const dryRun = req.body?.dryRun === true;

  if (!rows.length) return res.status(400).json({ message: "No rows provided" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ message: `Maximum ${MAX_ROWS} rows per import.` });

  let imported = 0, skipped = 0;
  const errors: string[] = [];
  const tenantCache: Record<string, number | null> = {};

  const resolveTenant = async (row: Record<string, string>): Promise<number | null> => {
    const tid = row.tenant_id ?? row.tenantid;
    if (tid) {
      // only a tenant of THIS organisation — an id from another organisation is "not found"
      const id = parseInt(tid) || 0;
      if (!id) return null;
      const [t] = await db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, id), eq(tenants.organizationId, orgId))).limit(1);
      return t?.id ?? null;
    }
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

      if (dryRun) { imported++; continue; }
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

  res.json(dryRun ? { dryRun: true, wouldImport: imported, imported: 0, skipped, errors } : { imported, skipped, errors });
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
      optional: ["address", "floor", "unit_type", "bedrooms", "bathrooms", "sqft", "rent_basis", "rate_per_sqft", "currency"],
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
