/**
 * Lease Lifecycle Routes — mounted at /api/leases
 *
 * GET    /                        List leases for the org (filterable by status, tenant, property); landlords see their own
 * GET    /:id                     Single lease with events + deposit balance + renewal links
 * POST   /                        Create a draft lease
 * PATCH  /:id                     Edit a draft / awaiting-signature lease (editing signed terms clears the signatures)
 * POST   /:id/send-for-signing    draft → pending_signature, email tenant
 * POST   /:id/sign                Record a signature (tenant or manager); one signature per party, never overwritten
 * POST   /:id/activate            Activate a signed lease (both signatures, or confirmUnsigned for a paper copy)
 * POST   /:id/renew               Draft a renewal; the current lease stays active until the renewal is activated
 * POST   /:id/terminate           End the tenancy now, or schedule it for a future date
 * POST   /:id/cancel-termination  Withdraw a scheduled termination
 * GET    /:id/events              Audit trail for a lease
 * POST   /:id/deposit             Record a deposit movement (received / refund / forfeited / adjustment)
 * GET    /:id/deposit             Full deposit ledger (renewals include the deposit held on earlier leases)
 * GET    /:id/settlement          Move-out settlement preview (deposit vs unpaid rent/bills vs inspection)
 * POST   /:id/settle-deposit      Settle the deposit: arrears → deductions → refund
 *
 * The rules live in services/lease-lifecycle.ts so the scheduler applies exactly the same ones.
 */

import { Router }          from "express";
import { z }               from "zod";
import { db }              from "../db";
import {
  leases, leaseEvents, depositTransactions,
  tenants, units, properties, organizations, users,
} from "@shared/schema";
import { eq, and, desc, inArray, sql, ne } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { auditLog }        from "../middleware/auditLog";
import { sendLeaseEmail }  from "../lib/leaseEmail";
import { notifyTenant }    from "../services/notifyTenant";
import { todayEAT, round2, money } from "../services/rent-ledger";
import {
  LeaseRuleError, isRealDate, addDays, termEnd, monthsBetween, daysBetween, loadLease, landlordOwns, nextLeaseNumber, isUniqueViolation,
  appendEvent, unitConflict, overlappingLease, depositState, postDeposit, endTenancy, settlementPreview, settleDeposit, pendingTermination,
} from "../services/lease-lifecycle";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// ─── One-time backfill: populate leases.propertyId from units ────────────────
// Runs once at startup. Safe to run multiple times (WHERE propertyId IS NULL).
(async () => {
  try {
    await db.execute(sql`
      UPDATE leases
      SET    property_id = units.property_id
      FROM   units
      WHERE  leases.unit_id     = units.id
        AND  leases.property_id IS NULL
        AND  units.property_id  IS NOT NULL
    `);
    console.log("[leases] propertyId backfill complete");
  } catch (e) {
    console.warn("[leases] propertyId backfill skipped:", e);
  }
})();

const log = (msg: string) => console.log(`[leases] ${msg}`);
const dateStr = z.string().refine(isRealDate, "must be a real date (YYYY-MM-DD)");

/** Turn a LeaseRuleError into its HTTP answer; anything else is a 500 with the given message. */
function fail(res: any, err: unknown, what: string) {
  if (err instanceof LeaseRuleError) return res.status(err.status).json({ message: err.message, ...err.extra });
  log(`${what}: ${err}`);
  return res.status(500).json({ message: what });
}

/** Staff and landlords record signatures and run the lifecycle; roleGuard already keeps tenants out of this prefix. */
const MANAGERS = ["admin", "manager", "landlord"];

// ─── GET / ───────────────────────────────────────────────────────────────────

router.get("/", async (req: any, res) => {
  try {
    const orgId  = req.user.organizationId as number;
    const role   = req.user.role as string;
    const userId = String(req.user.id ?? "");
    const status = req.query.status as string | undefined;
    const tenantId   = req.query.tenantId   ? parseInt(req.query.tenantId   as string) : undefined;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(leases.organizationId, orgId)];
    if (status)     conditions.push(eq(leases.status, status));
    if (Number.isInteger(tenantId))   conditions.push(eq(leases.tenantId, tenantId!));
    if (Number.isInteger(propertyId)) conditions.push(eq(leases.propertyId, propertyId!));

    // Landlords: leases on properties they own — the same rule GET /:id and every action uses.
    // (The old list also fell back to "unassigned" properties and to tenants-in-their-units, so the list and the
    // single-record view disagreed about what a landlord may see.)
    if (role === "landlord") {
      conditions.push(sql`${leases.propertyId} in (select id from properties where organization_id = ${orgId} and owner_id = ${userId})`);
    }

    const where = and(...conditions);
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(leases).where(where);

    const rows = await db
      .select({
        lease: leases, tenantFirst: tenants.firstName, tenantLast: tenants.lastName, tenantEmail: tenants.email,
        unitNumber: units.unitNumber, propertyName: properties.name,
        depositHeld: sql<string>`coalesce((select sum(case when t.transaction_type in ('received','adjustment') then t.amount else -t.amount end) from deposit_transactions t where t.lease_id = ${leases.id}), 0)`,
      })
      .from(leases)
      .leftJoin(tenants,    eq(leases.tenantId,   tenants.id))
      .leftJoin(units,      eq(leases.unitId,      units.id))
      .leftJoin(properties, eq(leases.propertyId,  properties.id))
      .where(where)
      .orderBy(desc(leases.createdAt), desc(leases.id))
      .limit(limit)
      .offset(offset);

    return res.json({
      results: rows.map(r => ({
        ...r.lease,
        tenantName: `${r.tenantFirst ?? ""} ${r.tenantLast ?? ""}`.trim(),
        tenantEmail: r.tenantEmail, unitNumber: r.unitNumber, propertyName: r.propertyName,
        depositHeld: money(r.depositHeld),
      })),
      page, limit, total: Number(n),
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch leases");
  }
});

// ─── GET /:id ────────────────────────────────────────────────────────────────

router.get("/:id", async (req: any, res) => {
  try {
    const lease = await loadLease(req.user, parseInt(req.params.id));
    const [row] = await db
      .select({
        tenantFirst: tenants.firstName, tenantLast: tenants.lastName, tenantEmail: tenants.email, tenantPhone: tenants.phone,
        unitNumber: units.unitNumber, propertyName: properties.name, propertyAddress: properties.address,
      })
      .from(leases)
      .leftJoin(tenants,    eq(leases.tenantId,   tenants.id))
      .leftJoin(units,      eq(leases.unitId,      units.id))
      .leftJoin(properties, eq(leases.propertyId,  properties.id))
      .where(eq(leases.id, lease.id)).limit(1);

    const events = await db.select().from(leaseEvents).where(eq(leaseEvents.leaseId, lease.id)).orderBy(desc(leaseEvents.createdAt), desc(leaseEvents.id));
    const dep = await depositState(lease.id);
    const [successor] = await db.select({ id: leases.id, leaseNumber: leases.leaseNumber, status: leases.status })
      .from(leases).where(and(eq(leases.previousLeaseId, lease.id), ne(leases.status, "terminated"))).orderBy(desc(leases.id)).limit(1);
    const sched = lease.status === "active" ? await pendingTermination(lease.id) : null;

    return res.json({
      ...lease,
      tenantName: `${row?.tenantFirst ?? ""} ${row?.tenantLast ?? ""}`.trim(),
      tenantEmail: row?.tenantEmail, tenantPhone: row?.tenantPhone,
      unitNumber: row?.unitNumber, propertyName: row?.propertyName, propertyAddress: row?.propertyAddress,
      events, depositBalance: dep.balance, renewal: successor ?? null,
      scheduledTermination: sched ? { date: lease.endDate, reason: (sched.metadata as any)?.reason ?? null } : null,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch lease");
  }
});

// ─── POST / — create draft ────────────────────────────────────────────────────

const createLeaseSchema = z.object({
  tenantId:           z.number().int().positive(),
  unitId:             z.number().int().positive().optional(),
  propertyId:         z.number().int().positive().optional(),
  startDate:          dateStr,
  endDate:            dateStr,
  monthlyRent:        z.number().positive().max(100_000_000),
  currency:           z.string().length(3).default("KES"),
  securityDeposit:    z.number().min(0).max(1_000_000_000).default(0),
  depositPaidDate:    dateStr.optional(),
  escalationRate:     z.number().min(0).max(1).default(0.10),
  escalationFrequencyMonths: z.number().int().min(1).default(12),
  // Commercial turnover rent — "fixed" (default) leaves existing behaviour
  // unchanged. percentageRentRate is required when rentStructure isn't "fixed".
  rentStructure:      z.enum(["fixed", "percentage_of_sales", "base_plus_percentage"]).default("fixed"),
  percentageRentRate: z.number().min(0).max(1).optional(),
  specialConditions:  z.string().max(10_000).optional(),
  notes:              z.string().max(10_000).optional(),
  leaseDurationMonths:z.number().int().min(1).max(600).optional(),
}).refine(
  (d) => d.rentStructure === "fixed" || d.percentageRentRate !== undefined,
  { message: "percentageRentRate is required when rentStructure is percentage_of_sales or base_plus_percentage", path: ["percentageRentRate"] },
).refine((d) => d.endDate > d.startDate, { message: "endDate must be after startDate", path: ["endDate"] });

router.post("/", auditLog("lease", "CREATE") as any, async (req: any, res) => {
  try {
    const orgId  = req.user.organizationId as number;
    const userId = req.user.id as string;
    const role   = req.user.role as string;
    if (!MANAGERS.includes(role)) return res.status(403).json({ message: "Only admin, manager, or landlord can create leases." });

    const parsed = createLeaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const data = parsed.data;

    // tenant: this organisation (and, for a landlord, one of their own)
    const [tenant] = await db.select({ id: tenants.id, unitId: tenants.unitId }).from(tenants)
      .where(and(eq(tenants.id, data.tenantId), eq(tenants.organizationId, orgId))).limit(1);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // unit: the one asked for, else the tenant's own — and it must be in this organisation
    const unitId = data.unitId ?? tenant.unitId ?? null;
    if (!unitId) return res.status(400).json({ message: "Choose the unit this lease is for." });
    const [unit] = await db.select({ id: units.id, propertyId: units.propertyId, unitType: units.unitType }).from(units)
      .where(and(eq(units.id, unitId), eq(units.organizationId, orgId))).limit(1);
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    if (data.propertyId && data.propertyId !== unit.propertyId) return res.status(400).json({ message: "That unit does not belong to the selected property." });

    if (role === "landlord") {
      if (!(await landlordOwns(userId, orgId, unit.propertyId))) return res.status(404).json({ message: "Unit not found" });
      if (tenant.unitId && tenant.unitId !== unitId) {
        const [tu] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
        if (!(await landlordOwns(userId, orgId, tu?.propertyId))) return res.status(404).json({ message: "Tenant not found" });
      }
    }

    const conflict = await unitConflict(orgId, unitId, data.tenantId);
    if (conflict) return res.status(409).json({ message: conflict, code: "UNIT_OCCUPIED" });
    const overlap = await overlappingLease(orgId, data.tenantId, unitId, data.startDate, data.endDate);
    if (overlap) return res.status(409).json({ message: overlap, code: "LEASE_OVERLAP" });

    if (data.depositPaidDate && data.depositPaidDate > addDays(todayEAT(), 1)) return res.status(400).json({ message: "The deposit paid date cannot be in the future." });
    if (data.depositPaidDate && data.securityDeposit <= 0) return res.status(400).json({ message: "A deposit paid date needs a deposit amount." });

    // ── Kenyan Landlord and Tenant Act: deposit cap ──────────────────────────
    // Security deposits may not exceed 2 months' rent for unrestricted RESIDENTIAL tenancies — the cap does not
    // govern ordinary commercial leases. We warn (not block) so managers with a valid legal basis can proceed.
    const complianceWarnings: string[] = [];
    const residential = !unit.unitType || ["apartment", "house"].includes(unit.unitType);
    if (residential && data.securityDeposit > data.monthlyRent * 2) {
      complianceWarnings.push(
        `Security deposit (${data.currency} ${data.securityDeposit.toLocaleString()}) exceeds 2 months' rent ` +
        `(${data.currency} ${(data.monthlyRent * 2).toLocaleString()}). ` +
        `The Landlord and Tenant Act caps deposits at 2 months' rent for unrestricted residential tenancies. ` +
        `The lease has been created, but please verify this is legally compliant.`
      );
    }

    // lease + its first events + the deposit already paid: all or nothing; the number retries on a clash
    let lease: any = null;
    for (let attempt = 0; attempt < 5 && !lease; attempt++) {
      const leaseNumber = await nextLeaseNumber(orgId);
      try {
        lease = await db.transaction(async (tx) => {
          const [l] = await tx.insert(leases).values({
            organizationId: orgId, tenantId: data.tenantId, unitId, propertyId: unit.propertyId, leaseNumber,
            startDate: data.startDate, endDate: data.endDate,
            leaseDurationMonths: data.leaseDurationMonths ?? monthsBetween(data.startDate, data.endDate),
            monthlyRent: String(data.monthlyRent), currency: data.currency,
            securityDeposit: String(data.securityDeposit), depositPaidDate: data.depositPaidDate ?? null,
            escalationRate: String(data.escalationRate), escalationFrequencyMonths: data.escalationFrequencyMonths,
            rentStructure: data.rentStructure,
            percentageRentRate: data.percentageRentRate !== undefined ? String(data.percentageRentRate) : null,
            status: "draft", specialConditions: data.specialConditions ?? null, notes: data.notes ?? null, createdBy: userId,
          }).returning();
          await appendEvent(tx, { leaseId: l.id, tenantId: data.tenantId, orgId, eventType: "created", performedBy: userId, ip: req.ip,
            description: `Lease ${leaseNumber} created as draft. Monthly rent: ${data.currency} ${data.monthlyRent.toLocaleString()}.` });
          if (data.securityDeposit > 0 && data.depositPaidDate) {
            await tx.insert(depositTransactions).values({
              leaseId: l.id, tenantId: data.tenantId, organizationId: orgId, transactionType: "received",
              amount: data.securityDeposit.toFixed(2), currency: data.currency, balanceAfter: data.securityDeposit.toFixed(2),
              reason: "Security deposit received on lease creation", transactionDate: data.depositPaidDate, performedBy: userId,
            });
            await appendEvent(tx, { leaseId: l.id, tenantId: data.tenantId, orgId, eventType: "deposit_received", performedBy: userId,
              description: `Security deposit of ${data.currency} ${data.securityDeposit.toLocaleString()} received.`,
              metadata: { amount: data.securityDeposit, currency: data.currency } });
          }
          return l;
        });
      } catch (e) { if (!isUniqueViolation(e) || attempt === 4) throw e; }
    }

    res.locals.auditEntityId = String(lease.id);
    return res.status(201).json({ ...lease, complianceWarnings });
  } catch (err) {
    return fail(res, err, "Failed to create lease");
  }
});

// ─── PATCH /:id — update draft ────────────────────────────────────────────────

const patchSchema = z.object({
  startDate:    dateStr.optional(),
  endDate:      dateStr.optional(),
  monthlyRent:  z.coerce.number().positive().max(100_000_000).optional(),
  securityDeposit: z.coerce.number().min(0).max(1_000_000_000).optional(),
  escalationRate:  z.coerce.number().min(0).max(1).optional(),
  escalationFrequencyMonths: z.coerce.number().int().min(1).optional(),
  leaseDurationMonths: z.coerce.number().int().min(1).max(600).optional(),
  specialConditions: z.string().max(10_000).nullable().optional(),
  notes:        z.string().max(10_000).nullable().optional(),
  documentUrl:  z.string().max(500).nullable().optional(),
  depositPaidDate: dateStr.nullable().optional(),
});
/** Terms the tenant agreed to by signing — changing one invalidates the signatures. */
const SIGNED_TERMS = ["startDate", "endDate", "monthlyRent", "securityDeposit", "escalationRate", "escalationFrequencyMonths", "leaseDurationMonths", "specialConditions"] as const;

router.patch("/:id", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can edit leases." });
    const existing = await loadLease(req.user, parseInt(req.params.id));
    if (!["draft", "pending_signature"].includes(existing.status)) return res.status(400).json({ message: `Cannot edit a lease in status: ${existing.status}` });

    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const p = parsed.data;

    const start = p.startDate ?? String(existing.startDate), end = p.endDate ?? String(existing.endDate);
    if (end <= start) return res.status(400).json({ message: "endDate must be after startDate" });
    if (p.securityDeposit !== undefined) {
      const dep = await depositState(existing.id);
      if (p.securityDeposit + 0.01 < dep.received) return res.status(400).json({ message: `The deposit cannot be lowered below the ${dep.received.toLocaleString()} already received.` });
    }
    if (p.depositPaidDate && p.depositPaidDate > addDays(todayEAT(), 1)) return res.status(400).json({ message: "The deposit paid date cannot be in the future." });
    if (p.startDate || p.endDate) {
      const overlap = await overlappingLease(orgId, existing.tenantId, existing.unitId, start, end, [existing.id, ...(existing.previousLeaseId ? [existing.previousLeaseId] : [])]);
      if (overlap) return res.status(409).json({ message: overlap, code: "LEASE_OVERLAP" });
    }

    const patch: Record<string, any> = { updatedAt: new Date() };
    const changed: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      const next = typeof v === "number" ? String(v) : v;
      if (String((existing as any)[k] ?? "") !== String(next ?? "")) changed.push(k);
      patch[k] = next;
    }
    if (p.startDate || p.endDate) { if (p.leaseDurationMonths === undefined) patch.leaseDurationMonths = monthsBetween(start, end); }

    const signed = !!(existing.signedByTenantAt || existing.signedByManagerAt);
    const resetSignatures = signed && changed.some(k => (SIGNED_TERMS as readonly string[]).includes(k));
    if (resetSignatures) Object.assign(patch, { signedByTenantAt: null, signedByManagerAt: null, tenantSignatureIp: null, managerSignatureIp: null, status: "draft" });

    const updated = await db.transaction(async (tx) => {
      const [u] = await tx.update(leases).set(patch).where(eq(leases.id, existing.id)).returning();
      await appendEvent(tx, { leaseId: existing.id, tenantId: existing.tenantId, orgId, eventType: "updated", performedBy: userId, ip: req.ip,
        description: `Lease ${existing.leaseNumber} updated (${changed.join(", ") || "no changes"}).`, metadata: { changes: Object.fromEntries(changed.map(k => [k, patch[k]])) } });
      if (resetSignatures) await appendEvent(tx, { leaseId: existing.id, tenantId: existing.tenantId, orgId, eventType: "signatures_reset", performedBy: userId,
        description: "Signed terms were changed, so the signatures were cleared. The lease is back in draft and must be sent for signing again." });
      return u;
    });

    res.locals.auditEntityId = String(existing.id);
    return res.json({ ...updated, signaturesReset: resetSignatures });
  } catch (err) {
    return fail(res, err, "Failed to update lease");
  }
});

// ─── POST /:id/send-for-signing ───────────────────────────────────────────────

router.post("/:id/send-for-signing", async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can send leases for signing." });
    const lease = await loadLease(req.user, parseInt(req.params.id));
    if (lease.status !== "draft") return res.status(400).json({ message: `Lease is already in status: ${lease.status}` });

    const [tenant] = await db.select({ firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email }).from(tenants).where(eq(tenants.id, lease.tenantId)).limit(1);
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

    await db.transaction(async (tx) => {
      const r = await tx.update(leases).set({ status: "pending_signature", updatedAt: new Date() }).where(and(eq(leases.id, lease.id), eq(leases.status, "draft"))).returning({ id: leases.id });
      if (!r.length) throw new LeaseRuleError(409, "Lease changed while sending. Reload and try again.");
      await appendEvent(tx, { leaseId: lease.id, tenantId: lease.tenantId, orgId, eventType: "sent_for_signing", performedBy: userId, ip: req.ip,
        description: `Lease ${lease.leaseNumber} sent to tenant ${tenant?.firstName} ${tenant?.lastName} for signing.` });
    });

    if (tenant?.email) {
      await sendLeaseEmail({
        type: "send_for_signing", to: tenant.email, tenantName: `${tenant.firstName} ${tenant.lastName}`,
        orgName: org?.name ?? "Property Management", leaseNumber: lease.leaseNumber, startDate: String(lease.startDate), endDate: String(lease.endDate),
        monthlyRent: Number(lease.monthlyRent), currency: lease.currency, leaseId: lease.id,
      }).catch(e => log(`Email error: ${e}`));
    }
    return res.json({ message: "Lease sent for signing", status: "pending_signature" });
  } catch (err) {
    return fail(res, err, "Failed to send lease for signing");
  }
});

// ─── POST /:id/sign ───────────────────────────────────────────────────────────
// signer: "tenant" | "manager". Staff record the signature (paper or in person); who recorded it is kept in the audit trail.

router.post("/:id/sign", async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    const signer = req.body?.signer as "tenant" | "manager";
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can record signatures." });
    if (!["tenant", "manager"].includes(signer)) return res.status(400).json({ message: "signer must be 'tenant' or 'manager'" });

    const lease = await loadLease(req.user, parseInt(req.params.id));
    if (lease.status !== "pending_signature") return res.status(400).json({ message: lease.status === "draft" ? "Send the lease for signing first." : `Cannot sign a lease in status: ${lease.status}` });
    if ((signer === "tenant" ? lease.signedByTenantAt : lease.signedByManagerAt)) return res.status(409).json({ message: `The ${signer} has already signed this lease.` });

    const now = new Date(), ip = req.ip ?? null;
    const patch: Record<string, any> = { updatedAt: now };
    if (signer === "tenant")  { patch.signedByTenantAt  = now; patch.tenantSignatureIp  = ip; }
    if (signer === "manager") { patch.signedByManagerAt = now; patch.managerSignatureIp = ip; }

    await db.transaction(async (tx) => {
      const col = signer === "tenant" ? leases.signedByTenantAt : leases.signedByManagerAt;
      const r = await tx.update(leases).set(patch).where(and(eq(leases.id, lease.id), eq(leases.status, "pending_signature"), sql`${col} is null`)).returning({ id: leases.id });
      if (!r.length) throw new LeaseRuleError(409, `The ${signer} has already signed this lease.`);
      await appendEvent(tx, { leaseId: lease.id, tenantId: lease.tenantId, orgId, eventType: signer === "tenant" ? "signed_tenant" : "signed_manager",
        description: `Lease ${lease.leaseNumber} signed by ${signer} (recorded by ${req.user.role}).`, performedBy: userId,
        metadata: { signer, recordedByRole: req.user.role, signedAt: now.toISOString(), ip }, ip });
    });
    return res.json({ message: `Signed by ${signer}`, signedAt: now });
  } catch (err) {
    return fail(res, err, "Failed to record signature");
  }
});

// ─── POST /:id/activate ───────────────────────────────────────────────────────

router.post("/:id/activate", async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can activate leases." });
    const confirmUnsigned = req.body?.confirmUnsigned === true;
    const lease = await loadLease(req.user, parseInt(req.params.id));
    if (!["pending_signature", "draft"].includes(lease.status)) return res.status(400).json({ message: `Lease is already ${lease.status}` });

    const fullySigned = !!(lease.signedByTenantAt && lease.signedByManagerAt);
    if (!fullySigned && !confirmUnsigned) {
      return res.status(400).json({
        message: "This lease is missing " + [!lease.signedByTenantAt && "the tenant's", !lease.signedByManagerAt && "the manager's"].filter(Boolean).join(" and ") + " signature. Record the signatures first, or confirm you hold a signed paper copy.",
        code: "UNSIGNED", needsTenantSignature: !lease.signedByTenantAt, needsManagerSignature: !lease.signedByManagerAt,
      });
    }
    const today = todayEAT();
    if (String(lease.endDate) < today) return res.status(400).json({ message: `This lease ended on ${lease.endDate}; it can no longer be activated. Create a new lease.` });
    if (!lease.unitId) return res.status(400).json({ message: "This lease has no unit. Edit it first." });

    const ignore = [lease.id, ...(lease.previousLeaseId ? [lease.previousLeaseId] : [])];
    const conflict = await unitConflict(orgId, lease.unitId, lease.tenantId, ignore);
    if (conflict) return res.status(409).json({ message: conflict, code: "UNIT_OCCUPIED" });
    const overlap = await overlappingLease(orgId, lease.tenantId, lease.unitId, String(lease.startDate), String(lease.endDate), ignore);
    if (overlap) return res.status(409).json({ message: overlap, code: "LEASE_OVERLAP" });

    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from units where id = ${lease.unitId} for update`);   // serialise two activations on one unit
      const [cur] = await tx.select().from(leases).where(eq(leases.id, lease.id)).for("update").limit(1);
      if (!cur || !["pending_signature", "draft"].includes(cur.status)) throw new LeaseRuleError(409, "Lease changed while activating. Reload and try again.");
      const [again] = await tx.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.organizationId, orgId), eq(tenants.unitId, lease.unitId!), ne(tenants.id, lease.tenantId), eq(tenants.status, "active"))).limit(1);
      if (again) throw new LeaseRuleError(409, "That unit was just taken by another tenant.");

      await tx.update(leases).set({ status: "active", updatedAt: new Date() }).where(eq(leases.id, lease.id));

      // a renewal takes over: the lease it replaces is now 'renewed'
      if (lease.previousLeaseId) {
        const r = await tx.update(leases).set({ status: "renewed", updatedAt: new Date() })
          .where(and(eq(leases.id, lease.previousLeaseId), inArray(leases.status, ["active", "expired"]))).returning({ id: leases.id, n: leases.leaseNumber });
        if (r.length) await appendEvent(tx, { leaseId: r[0].id, tenantId: lease.tenantId, orgId, eventType: "renewed", performedBy: userId,
          description: `Lease ${r[0].n} renewed by ${lease.leaseNumber}.`, metadata: { newLeaseId: lease.id } });
      }

      // the tenant record follows the lease: dates, rent, deposit, unit, status — and a returning tenant can log in again
      const [t] = await tx.select({ id: tenants.id, unitId: tenants.unitId, status: tenants.status, userId: tenants.userId }).from(tenants).where(eq(tenants.id, lease.tenantId)).limit(1);
      await tx.update(tenants).set({
        leaseStartDate: String(lease.startDate), leaseEndDate: String(lease.endDate), monthlyRent: lease.monthlyRent,
        securityDeposit: lease.securityDeposit, unitId: lease.unitId, status: "active", updatedAt: new Date(),
      } as any).where(eq(tenants.id, lease.tenantId));
      if (t?.status === "inactive" && t.userId) await tx.update(users).set({ isActive: true, deactivatedAt: null, deactivatedBy: null } as any).where(eq(users.id, t.userId));
      await tx.update(units).set({ isOccupied: true } as any).where(eq(units.id, lease.unitId!));
      if (t?.unitId && t.unitId !== lease.unitId) {
        const [still] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.unitId, t.unitId), eq(tenants.status, "active"), ne(tenants.id, lease.tenantId))).limit(1);
        if (!still) await tx.update(units).set({ isOccupied: false } as any).where(eq(units.id, t.unitId));
      }

      await appendEvent(tx, { leaseId: lease.id, tenantId: lease.tenantId, orgId, eventType: "activated", performedBy: userId, ip: req.ip,
        description: `Lease ${lease.leaseNumber} activated. Term: ${lease.startDate} to ${lease.endDate}.${fullySigned ? "" : " Activated without recorded signatures (paper copy confirmed by staff)."}`,
        metadata: { unsignedOverride: !fullySigned } });
    });

    notifyTenant(lease.tenantId, {
      type: "lease_renewed", leaseNumber: lease.leaseNumber, newRent: Number(lease.monthlyRent), currency: lease.currency, newEndDate: String(lease.endDate),
    }, orgId).catch(err => log(`WhatsApp lease activated failed: ${err}`));

    return res.json({ message: "Lease activated", status: "active" });
  } catch (err) {
    return fail(res, err, "Failed to activate lease");
  }
});

// ─── POST /:id/renew ──────────────────────────────────────────────────────────
// Drafts the renewal. The current lease stays ACTIVE (rent keeps being billed, the tenant keeps access) until the
// renewal is signed and activated — only then does the old lease become 'renewed'.

const renewSchema = z.object({
  monthlyRent: z.coerce.number().positive().max(100_000_000).optional(),
  endDate: dateStr.optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

router.post("/:id/renew", auditLog("lease", "CREATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can renew leases." });
    const oldLease = await loadLease(req.user, parseInt(req.params.id));
    if (!["active", "expired"].includes(oldLease.status)) return res.status(400).json({ message: "Only active (or just-expired) leases can be renewed" });

    const parsed = renewSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });

    const [existing] = await db.select({ n: leases.leaseNumber, s: leases.status }).from(leases)
      .where(and(eq(leases.previousLeaseId, oldLease.id), inArray(leases.status, ["draft", "pending_signature", "active"]))).limit(1);
    if (existing) return res.status(409).json({ message: `${oldLease.leaseNumber} already has a renewal in progress (${existing.n}, ${existing.s}).`, code: "RENEWAL_EXISTS" });

    // Escalation: newRent = currentRent × (1 + escalationRate), unless the caller sets the rent
    const currentRent = Number(oldLease.monthlyRent), escalationRate = Number(oldLease.escalationRate);
    const newRent = parsed.data.monthlyRent ?? round2(currentRent * (1 + escalationRate));
    const start = addDays(String(oldLease.endDate), 1);                  // the day after the old term ends — no overlap
    const newEnd = parsed.data.endDate ?? termEnd(start, oldLease.leaseDurationMonths);
    if (newEnd <= start) return res.status(400).json({ message: `The renewal must end after it starts (${start}).` });

    // ── Kenyan Landlord and Tenant Act: rent increase notice (≥30 days before the old lease ends) ──
    const complianceWarnings: string[] = [];
    let residential = true;
    if (oldLease.unitId) {
      const [u] = await db.select({ unitType: units.unitType }).from(units).where(eq(units.id, oldLease.unitId)).limit(1);
      if (u?.unitType) residential = ["apartment", "house"].includes(u.unitType);
    }
    const daysLeft = daysBetween(todayEAT(), String(oldLease.endDate));
    if (residential && Math.abs(newRent - currentRent) > 0.005 && daysLeft < 30) {
      complianceWarnings.push(
        `Rent is increasing from ${oldLease.currency} ${currentRent.toLocaleString()} to ${newRent.toLocaleString()}, ` +
        `but the current lease ends in ${daysLeft} day(s). ` +
        `The Landlord and Tenant Act requires written notice of rent increases before the new lease period begins. ` +
        `Send the tenant formal written notice immediately and consider using the "Send for Signing" flow to document it.`
      );
    }

    let newLease: any = null;
    for (let attempt = 0; attempt < 5 && !newLease; attempt++) {
      const newLeaseNumber = await nextLeaseNumber(orgId);
      try {
        newLease = await db.transaction(async (tx) => {
          const [l] = await tx.insert(leases).values({
            organizationId: orgId, tenantId: oldLease.tenantId, unitId: oldLease.unitId, propertyId: oldLease.propertyId,
            leaseNumber: newLeaseNumber, previousLeaseId: oldLease.id, startDate: start, endDate: newEnd,
            leaseDurationMonths: monthsBetween(start, newEnd), monthlyRent: String(newRent), currency: oldLease.currency,
            securityDeposit: oldLease.securityDeposit,            // the deposit held rolls over (the ledger follows the chain)
            rentStructure: oldLease.rentStructure, percentageRentRate: oldLease.percentageRentRate,
            escalationRate: oldLease.escalationRate, escalationFrequencyMonths: oldLease.escalationFrequencyMonths,
            status: "draft", specialConditions: oldLease.specialConditions, notes: parsed.data.notes ?? null, createdBy: userId,
          } as any).returning();
          await appendEvent(tx, { leaseId: oldLease.id, tenantId: oldLease.tenantId, orgId, eventType: "renewal_drafted", performedBy: userId, ip: req.ip,
            description: `Renewal ${newLeaseNumber} drafted for ${oldLease.leaseNumber}. It takes over once it is signed and activated.`, metadata: { newLeaseId: l.id, newLeaseNumber } });
          await appendEvent(tx, { leaseId: l.id, tenantId: oldLease.tenantId, orgId, eventType: "created", performedBy: userId,
            description: `Renewal lease ${newLeaseNumber} created. Rent ${oldLease.currency} ${currentRent.toLocaleString()} → ${newRent.toLocaleString()} (${(escalationRate * 100).toFixed(0)}% escalation).`,
            metadata: { previousLeaseId: oldLease.id, oldRent: currentRent, newRent, escalationRate } });
          return l;
        });
      } catch (e) { if (!isUniqueViolation(e) || attempt === 4) throw e; }
    }

    res.locals.auditEntityId = String(newLease.id);
    return res.status(201).json({ newLease, oldLeaseId: oldLease.id, escalationApplied: { oldRent: currentRent, newRent, rate: escalationRate }, complianceWarnings });
  } catch (err) {
    return fail(res, err, "Failed to renew lease");
  }
});

// ─── POST /:id/terminate ──────────────────────────────────────────────────────
// A date today or earlier ends the tenancy now: lease terminated, tenant inactive, unit vacant, login off — in one
// transaction. A FUTURE date (the notice period) only schedules it; the daily job ends it on the day, so the tenant
// keeps living, paying and logging in until then.

router.post("/:id/terminate", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can terminate leases." });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) return res.status(400).json({ message: "reason is required" });
    if (reason.length > 2000) return res.status(400).json({ message: "reason is too long" });

    const lease = await loadLease(req.user, parseInt(req.params.id));
    if (!["active", "expired"].includes(lease.status)) return res.status(400).json({ message: "Only active leases can be terminated" });

    const today = todayEAT();
    const tDate = req.body?.terminationDate ?? today;
    if (!isRealDate(tDate)) return res.status(400).json({ message: "terminationDate must be a real date (YYYY-MM-DD)" });
    if (String(lease.startDate) <= today && tDate < String(lease.startDate)) return res.status(400).json({ message: `The termination date cannot be before the lease starts (${lease.startDate}).` });
    if (lease.status === "expired" && tDate > today) return res.status(400).json({ message: "This lease has already expired — the tenant is holding over, so end it today or earlier." });
    if (lease.status === "active" && tDate > String(lease.endDate)) return res.status(400).json({ message: `The termination date is after the lease end (${lease.endDate}). Let the lease expire instead.` });

    // ── Kenyan Landlord and Tenant Act: 30-day notice (residential) — warn, don't block ──
    const complianceWarnings: string[] = [];
    let residential = true;
    if (lease.unitId) {
      const [u] = await db.select({ unitType: units.unitType }).from(units).where(eq(units.id, lease.unitId)).limit(1);
      if (u?.unitType) residential = ["apartment", "house"].includes(u.unitType);
    }
    const daysAway = daysBetween(today, tDate);
    if (residential && daysAway < 30) {
      complianceWarnings.push(
        `Termination date is ${daysAway < 0 ? "in the past" : `only ${daysAway} day(s) away`}. ` +
        `The Landlord and Tenant Act requires at least 30 days' notice for residential tenancy termination. ` +
        `Ensure you have a legal basis (e.g. court order, mutual agreement) before proceeding.`
      );
    }

    res.locals.auditEntityId = String(lease.id);

    if (tDate > today) {
      await db.transaction(async (tx) => {
        await tx.update(leases).set({ endDate: tDate, updatedAt: new Date() } as any).where(eq(leases.id, lease.id));
        await appendEvent(tx, { leaseId: lease.id, tenantId: lease.tenantId, orgId, eventType: "termination_scheduled", performedBy: userId, ip: req.ip,
          description: `Termination of ${lease.leaseNumber} scheduled for ${tDate}. Reason: ${reason}`,
          metadata: { reason, terminationDate: tDate, originalEndDate: String(lease.endDate) } });
      });
      return res.json({ message: `Termination scheduled for ${tDate}. The tenancy ends automatically that day.`, scheduled: true, terminationDate: tDate, complianceWarnings });
    }

    await endTenancy(lease.id, { date: tDate, reason, userId, ip: req.ip });
    notifyTenant(lease.tenantId, { type: "lease_terminated", leaseNumber: lease.leaseNumber, terminationDate: tDate }, orgId)
      .catch(err => log(`WhatsApp lease terminated failed: ${err}`));

    const s = await settlementPreview({ ...lease, status: "terminated" });
    return res.json({
      message: "Lease terminated", terminationDate: tDate, scheduled: false, complianceWarnings,
      settlement: { depositHeld: s.depositHeld, unpaidRent: s.unpaidRentTotal, unpaidUtilities: s.unpaidUtilitiesTotal, inspectionId: s.inspection?.id ?? null },
    });
  } catch (err) {
    return fail(res, err, "Failed to terminate lease");
  }
});

router.post("/:id/cancel-termination", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can do that." });
    const lease = await loadLease(req.user, parseInt(req.params.id));
    const pending = lease.status === "active" ? await pendingTermination(lease.id) : null;
    if (!pending) return res.status(400).json({ message: "This lease has no scheduled termination." });
    const original = (pending.metadata as any)?.originalEndDate;
    await db.transaction(async (tx) => {
      if (isRealDate(original)) await tx.update(leases).set({ endDate: original, updatedAt: new Date() } as any).where(eq(leases.id, lease.id));
      await appendEvent(tx, { leaseId: lease.id, tenantId: lease.tenantId, orgId, eventType: "termination_cancelled", performedBy: userId, ip: req.ip,
        description: `Scheduled termination of ${lease.leaseNumber} cancelled${isRealDate(original) ? `; end date restored to ${original}` : ""}.` });
    });
    res.locals.auditEntityId = String(lease.id);
    return res.json({ message: "Scheduled termination cancelled", endDate: isRealDate(original) ? original : lease.endDate });
  } catch (err) {
    return fail(res, err, "Failed to cancel termination");
  }
});

// ─── GET /:id/events ──────────────────────────────────────────────────────────

router.get("/:id/events", async (req: any, res) => {
  try {
    const lease = await loadLease(req.user, parseInt(req.params.id));
    const events = await db
      .select({ event: leaseEvents, actorFirst: users.firstName, actorLast: users.lastName })
      .from(leaseEvents)
      .leftJoin(users, eq(leaseEvents.performedBy, users.id))
      .where(eq(leaseEvents.leaseId, lease.id))
      .orderBy(desc(leaseEvents.createdAt), desc(leaseEvents.id));
    return res.json(events.map(e => ({ ...e.event, actorName: e.actorFirst ? `${e.actorFirst} ${e.actorLast ?? ""}`.trim() : "System" })));
  } catch (err) {
    return fail(res, err, "Failed to fetch lease events");
  }
});

// ─── POST /:id/deposit ────────────────────────────────────────────────────────

const depositSchema = z.object({
  transactionType: z.enum(["received", "refunded", "partial_refund", "forfeited", "adjustment"]),
  amount:          z.number().positive().max(1_000_000_000),
  reason:          z.string().trim().min(1).max(1000),
  reference:       z.string().max(100).optional(),
  transactionDate: dateStr,
});

router.post("/:id/deposit", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can record deposit movements." });
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const { transactionType, amount, reason, reference, transactionDate } = parsed.data;

    const lease = await loadLease(req.user, parseInt(req.params.id));
    const { txn, balance } = await postDeposit(lease, { type: transactionType, amount, reason, reference, date: transactionDate, userId, ip: req.ip });

    if (["refunded", "partial_refund"].includes(transactionType)) {
      notifyTenant(lease.tenantId, { type: "deposit_refunded", amount, currency: lease.currency, reference }, orgId)
        .catch(err => log(`WhatsApp deposit refund failed: ${err}`));
    }
    res.locals.auditEntityId = String(lease.id);
    return res.status(201).json({ transaction: txn, depositBalance: balance });
  } catch (err) {
    return fail(res, err, "Failed to record deposit transaction");
  }
});

// ─── GET /:id/deposit ─────────────────────────────────────────────────────────

router.get("/:id/deposit", async (req: any, res) => {
  try {
    const lease = await loadLease(req.user, parseInt(req.params.id));
    const st = await depositState(lease.id);
    const txns = await db.select().from(depositTransactions).where(inArray(depositTransactions.leaseId, st.chain))
      .orderBy(depositTransactions.transactionDate, depositTransactions.id);
    return res.json({
      originalDeposit: Number(lease.securityDeposit), received: st.received, currentBalance: st.balance,
      outstanding: round2(Math.max(0, Number(lease.securityDeposit) - st.received)),
      currency: lease.currency, transactions: txns,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch deposit ledger");
  }
});

// ─── Move-out settlement ──────────────────────────────────────────────────────

router.get("/:id/settlement", async (req: any, res) => {
  try {
    const lease = await loadLease(req.user, parseInt(req.params.id));
    return res.json(await settlementPreview(lease));
  } catch (err) {
    return fail(res, err, "Failed to prepare the settlement");
  }
});

const settleSchema = z.object({
  applyToArrears: z.boolean().default(true),
  deductions: z.array(z.object({
    category: z.enum(["damages", "cleaning", "other"]),
    amount: z.number().positive().max(1_000_000_000),
    reason: z.string().trim().min(1).max(500),
  })).max(20).default([]),
  refund: z.boolean().default(true),
  transactionDate: dateStr.optional(),
  reference: z.string().max(100).optional(),
});

router.post("/:id/settle-deposit", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId = req.user.organizationId as number, userId = req.user.id as string;
    if (!MANAGERS.includes(req.user.role)) return res.status(403).json({ message: "Only admin, manager, or landlord can settle deposits." });
    const parsed = settleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const lease = await loadLease(req.user, parseInt(req.params.id));

    const out = await settleDeposit(lease, {
      applyToArrears: parsed.data.applyToArrears, deductions: parsed.data.deductions, refund: parsed.data.refund,
      date: parsed.data.transactionDate ?? todayEAT(), reference: parsed.data.reference ?? null,
    }, userId);

    if (out.refunded > 0) {
      notifyTenant(lease.tenantId, { type: "deposit_refunded", amount: out.refunded, currency: lease.currency, reference: parsed.data.reference }, orgId)
        .catch(err => log(`WhatsApp deposit refund failed: ${err}`));
    }
    res.locals.auditEntityId = String(lease.id);
    return res.json(out);
  } catch (err) {
    return fail(res, err, "Failed to settle the deposit");
  }
});

export default router;
