/**
 * Lease Lifecycle Routes — mounted at /api/leases
 *
 * GET    /                        List leases for the org (filterable by status, tenant, property)
 * GET    /:id                     Single lease with events + deposit balance
 * POST   /                        Create a draft lease
 * PATCH  /:id                     Update draft fields (rent, dates, conditions)
 * POST   /:id/send-for-signing    Transition draft → pending_signature, email tenant
 * POST   /:id/sign                Record a digital signature (tenant or manager)
 * POST   /:id/activate            Manager activates a fully-signed lease
 * POST   /:id/renew               Create renewal lease with escalated rent
 * POST   /:id/terminate           Terminate an active lease
 * GET    /:id/events              Audit trail for a lease
 * POST   /:id/deposit             Record a deposit transaction (received/refund/partial)
 * GET    /:id/deposit             Full deposit ledger for a lease
 */

import { Router }          from "express";
import { z }               from "zod";
import { db }              from "../db";
import {
  leases, leaseEvents, depositTransactions,
  tenants, units, properties, organizations, users,
} from "@shared/schema";
import { eq, and, or, desc, inArray, sql, gte, lte, isNull } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { auditLog }        from "../middleware/auditLog";
import { sendLeaseEmail }  from "../lib/leaseEmail";
import { notifyTenant }    from "../services/notifyTenant";
import { revokeAllUserTokens } from "./auth";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (msg: string) => console.log(`[leases] ${msg}`);

function leaseNumberFor(orgId: number, seq: number): string {
  const yr = new Date().getFullYear();
  return `LSE-${yr}-${orgId}-${seq.toString().padStart(4, "0")}`;
}

async function nextLeaseSeq(orgId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(leases)
    .where(eq(leases.organizationId, orgId));
  return Number(count) + 1;
}

async function appendEvent(opts: {
  leaseId:     number;
  tenantId:    number;
  orgId:       number;
  eventType:   string;
  description: string;
  performedBy?: string;
  metadata?:   Record<string, unknown>;
  ip?:         string;
}): Promise<void> {
  await db.insert(leaseEvents).values({
    leaseId:        opts.leaseId,
    tenantId:       opts.tenantId,
    organizationId: opts.orgId,
    eventType:      opts.eventType,
    description:    opts.description,
    performedBy:    opts.performedBy ?? null,
    metadata:       opts.metadata   ?? {},
    ipAddress:      opts.ip         ?? null,
  });
}

/** Compute current deposit balance from the ledger. */
async function depositBalance(leaseId: number): Promise<number> {
  const rows = await db
    .select({ balanceAfter: depositTransactions.balanceAfter })
    .from(depositTransactions)
    .where(eq(depositTransactions.leaseId, leaseId))
    .orderBy(desc(depositTransactions.createdAt))
    .limit(1);
  return rows.length > 0 ? Number(rows[0].balanceAfter) : 0;
}

// ─── GET / ───────────────────────────────────────────────────────────────────

router.get("/", async (req: any, res) => {
  try {
    const orgId      = req.user.organizationId as number;
    const role       = req.user.role as string;
    const userId: string = String(req.user.id ?? req.user.userId ?? "");
    const status     = req.query.status   as string | undefined;
    const tenantId   = req.query.tenantId ? parseInt(req.query.tenantId as string) : undefined;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(leases.organizationId, orgId)];
    if (status)     conditions.push(eq(leases.status, status));
    if (tenantId)   conditions.push(eq(leases.tenantId, tenantId));
    if (propertyId) conditions.push(eq(leases.propertyId, propertyId));

    // ── Landlord scope ────────────────────────────────────────────────────
    // Mirror the exact same resolution chain used in the tenants route, which
    // already works correctly for landlords:
    //   landlord → owned properties → units in those properties → tenants in
    //   those units → leases for those tenants.
    //
    // We scope by tenantId because leases.tenantId is always set (NOT NULL),
    // whereas leases.propertyId and leases.unitId can both be NULL on existing
    // data that was created before those fields were populated.
    if (role === "landlord") {
      // Step 1: properties owned by this landlord (with unassigned fallback)
      let ownedProps = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.ownerId, userId));

      if (ownedProps.length === 0) {
        ownedProps = await db
          .select({ id: properties.id })
          .from(properties)
          .where(and(
            eq(properties.organizationId, orgId),
            isNull(properties.ownerId),
          ));
      }

      if (ownedProps.length === 0) {
        return res.json({ results: [], page, limit, total: 0 });
      }

      // Step 2: units in those properties
      const propIds = ownedProps.map(p => p.id);
      const ownedUnits = await db
        .select({ id: units.id })
        .from(units)
        .where(inArray(units.propertyId, propIds));

      if (ownedUnits.length === 0) {
        return res.json({ results: [], page, limit, total: 0 });
      }

      // Step 3: tenants assigned to those units
      const unitIds = ownedUnits.map(u => u.id);
      const scopedTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(
          eq(tenants.organizationId, orgId),
          inArray(tenants.unitId, unitIds),
        ));

      if (scopedTenants.length === 0) {
        return res.json({ results: [], page, limit, total: 0 });
      }

      // Step 4: filter leases by tenantId — always populated, never null
      const tenantIds = scopedTenants.map(t => t.id);
      conditions.push(inArray(leases.tenantId, tenantIds));
    }

    const rows = await db
      .select({
        lease:        leases,
        tenantFirst:  tenants.firstName,
        tenantLast:   tenants.lastName,
        tenantEmail:  tenants.email,
        unitNumber:   units.unitNumber,
        propertyName: properties.name,
      })
      .from(leases)
      .leftJoin(tenants,    eq(leases.tenantId,   tenants.id))
      .leftJoin(units,      eq(leases.unitId,      units.id))
      .leftJoin(properties, eq(leases.propertyId,  properties.id))
      .where(and(...conditions))
      .orderBy(desc(leases.createdAt))
      .limit(limit)
      .offset(offset);

    const result = rows.map(r => ({
      ...r.lease,
      tenantName:   `${r.tenantFirst ?? ""} ${r.tenantLast ?? ""}`.trim(),
      tenantEmail:  r.tenantEmail,
      unitNumber:   r.unitNumber,
      propertyName: r.propertyName,
    }));

    return res.json({ results: result, page, limit, total: result.length });
  } catch (err) {
    log(`GET / error: ${err}`);
    return res.status(500).json({ message: "Failed to fetch leases" });
  }
});

// ─── GET /:id ────────────────────────────────────────────────────────────────

router.get("/:id", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const leaseId = parseInt(req.params.id);

    const [row] = await db
      .select({
        lease:        leases,
        tenantFirst:  tenants.firstName,
        tenantLast:   tenants.lastName,
        tenantEmail:  tenants.email,
        tenantPhone:  tenants.phone,
        unitNumber:   units.unitNumber,
        propertyName: properties.name,
        propertyAddress: properties.address,
      })
      .from(leases)
      .leftJoin(tenants,    eq(leases.tenantId,   tenants.id))
      .leftJoin(units,      eq(leases.unitId,      units.id))
      .leftJoin(properties, eq(leases.propertyId,  properties.id))
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Lease not found" });

    // Landlords may only view leases on properties they own — the list
    // endpoint already filters this way; single-record fetch by id needs the
    // same check or it could be bypassed just by knowing/guessing an id.
    if (req.user.role === "landlord") {
      const propertyId = (row.lease as any).propertyId;
      const [prop] = propertyId
        ? await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, propertyId)).limit(1)
        : [undefined];
      if (!prop || prop.ownerId !== req.user.id) {
        return res.status(404).json({ message: "Lease not found" });
      }
    }

    const events  = await db
      .select()
      .from(leaseEvents)
      .where(eq(leaseEvents.leaseId, leaseId))
      .orderBy(desc(leaseEvents.createdAt));

    const balance = await depositBalance(leaseId);

    return res.json({
      ...row.lease,
      tenantName:      `${row.tenantFirst ?? ""} ${row.tenantLast ?? ""}`.trim(),
      tenantEmail:     row.tenantEmail,
      tenantPhone:     row.tenantPhone,
      unitNumber:      row.unitNumber,
      propertyName:    row.propertyName,
      propertyAddress: row.propertyAddress,
      events,
      depositBalance:  balance,
    });
  } catch (err) {
    log(`GET /:id error: ${err}`);
    return res.status(500).json({ message: "Failed to fetch lease" });
  }
});

// ─── POST / — create draft ────────────────────────────────────────────────────

const createLeaseSchema = z.object({
  tenantId:           z.number().int().positive(),
  unitId:             z.number().int().positive().optional(),
  propertyId:         z.number().int().positive().optional(),
  startDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyRent:        z.number().positive(),
  currency:           z.string().length(3).default("KES"),
  securityDeposit:    z.number().min(0).default(0),
  depositPaidDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  escalationRate:     z.number().min(0).max(1).default(0.10),
  escalationFrequencyMonths: z.number().int().min(1).default(12),
  // Commercial turnover rent — "fixed" (default) leaves existing behaviour
  // unchanged. percentageRentRate is required when rentStructure isn't "fixed".
  rentStructure:      z.enum(["fixed", "percentage_of_sales", "base_plus_percentage"]).default("fixed"),
  percentageRentRate: z.number().min(0).max(1).optional(),
  specialConditions:  z.string().optional(),
  notes:              z.string().optional(),
  leaseDurationMonths:z.number().int().min(1).default(12),
}).refine(
  (d) => d.rentStructure === "fixed" || d.percentageRentRate !== undefined,
  { message: "percentageRentRate is required when rentStructure is percentage_of_sales or base_plus_percentage", path: ["percentageRentRate"] },
);

router.post("/", auditLog("lease", "CREATE") as any, async (req: any, res) => {
  try {
    const orgId  = req.user.organizationId as number;
    const userId = req.user.id as string;
    const role   = req.user.role as string;

    const ADMIN_MANAGER_LANDLORD = ["admin", "manager", "landlord"];
    if (!ADMIN_MANAGER_LANDLORD.includes(role)) {
      return res.status(403).json({ message: "Only admin, manager, or landlord can create leases." });
    }

    const parsed = createLeaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });

    const data = parsed.data;

    // Verify tenant belongs to this org
    const [tenant] = await db
      .select({ id: tenants.id, organizationId: tenants.organizationId })
      .from(tenants)
      .where(and(eq(tenants.id, data.tenantId), eq(tenants.organizationId, orgId)))
      .limit(1);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // ── Kenyan Landlord and Tenant Act: deposit cap ──────────────────────────
    // Security deposits may not exceed 2 months' rent for unrestricted RESIDENTIAL
    // tenancies — this cap doesn't govern ordinary commercial leases, so only warn
    // when the unit is residential (or unknown, to err on the side of warning).
    // We warn (not block) so managers with a valid legal basis can still proceed.
    const depositWarnings: string[] = [];
    let isResidentialUnit = true;
    if (data.unitId) {
      const [unitRow] = await db
        .select({ unitType: units.unitType })
        .from(units)
        .where(eq(units.id, data.unitId))
        .limit(1);
      if (unitRow?.unitType) {
        isResidentialUnit = ["apartment", "house"].includes(unitRow.unitType);
      }
    }
    if (isResidentialUnit && data.securityDeposit > data.monthlyRent * 2) {
      depositWarnings.push(
        `Security deposit (${data.currency} ${data.securityDeposit.toLocaleString()}) exceeds 2 months' rent ` +
        `(${data.currency} ${(data.monthlyRent * 2).toLocaleString()}). ` +
        `The Landlord and Tenant Act caps deposits at 2 months' rent for unrestricted residential tenancies. ` +
        `The lease has been created, but please verify this is legally compliant.`
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    const leaseNumber = leaseNumberFor(orgId, await nextLeaseSeq(orgId));

    // Auto-resolve propertyId from the unit when the client didn't send it.
    // This ensures landlord scoping (which filters by propertyId/unitId) works.
    let resolvedPropertyId: number | null = data.propertyId ?? null;
    if (!resolvedPropertyId && data.unitId) {
      const [unitRow] = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(eq(units.id, data.unitId))
        .limit(1);
      resolvedPropertyId = unitRow?.propertyId ?? null;
    }

    const [lease] = await db.insert(leases).values({
      organizationId:       orgId,
      tenantId:             data.tenantId,
      unitId:               data.unitId ?? null,
      propertyId:           resolvedPropertyId,
      leaseNumber,
      startDate:            data.startDate,
      endDate:              data.endDate,
      leaseDurationMonths:  data.leaseDurationMonths,
      monthlyRent:          String(data.monthlyRent),
      currency:             data.currency,
      securityDeposit:      String(data.securityDeposit),
      depositPaidDate:      data.depositPaidDate ?? null,
      escalationRate:       String(data.escalationRate),
      escalationFrequencyMonths: data.escalationFrequencyMonths,
      rentStructure:        data.rentStructure,
      percentageRentRate:   data.percentageRentRate !== undefined ? String(data.percentageRentRate) : null,
      status:               "draft",
      specialConditions:    data.specialConditions ?? null,
      notes:                data.notes ?? null,
      createdBy:            userId,
    }).returning();

    await appendEvent({
      leaseId:     lease.id,
      tenantId:    data.tenantId,
      orgId,
      eventType:   "created",
      description: `Lease ${leaseNumber} created as draft. Monthly rent: ${data.currency} ${data.monthlyRent.toLocaleString()}.`,
      performedBy: userId,
      ip:          req.ip,
    });

    // If deposit was already paid, record it in the ledger
    if (data.securityDeposit > 0 && data.depositPaidDate) {
      await db.insert(depositTransactions).values({
        leaseId:         lease.id,
        tenantId:        data.tenantId,
        organizationId:  orgId,
        transactionType: "received",
        amount:          String(data.securityDeposit),
        currency:        data.currency,
        balanceAfter:    String(data.securityDeposit),
        reason:          "Security deposit received on lease creation",
        transactionDate: data.depositPaidDate,
        performedBy:     userId,
      });

      await appendEvent({
        leaseId:     lease.id,
        tenantId:    data.tenantId,
        orgId,
        eventType:   "deposit_received",
        description: `Security deposit of ${data.currency} ${data.securityDeposit.toLocaleString()} received.`,
        performedBy: userId,
        metadata:    { amount: data.securityDeposit, currency: data.currency },
      });
    }

    res.locals.auditEntityId = String(lease.id);
    return res.status(201).json({ ...lease, complianceWarnings: depositWarnings });
  } catch (err) {
    log(`POST / error: ${err}`);
    return res.status(500).json({ message: "Failed to create lease" });
  }
});

// ─── PATCH /:id — update draft ────────────────────────────────────────────────

router.patch("/:id", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);

    const [existing] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Lease not found" });

    if (req.user.role === "landlord") {
      const [prop] = existing.propertyId
        ? await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, existing.propertyId)).limit(1)
        : [undefined];
      if (!prop || prop.ownerId !== userId) {
        return res.status(404).json({ message: "Lease not found" });
      }
    }

    if (!["draft", "pending_signature"].includes(existing.status)) {
      return res.status(400).json({ message: `Cannot edit a lease in status: ${existing.status}` });
    }

    const allowed = [
      "startDate", "endDate", "monthlyRent", "securityDeposit",
      "escalationRate", "escalationFrequencyMonths",
      "specialConditions", "notes", "documentUrl",
      "leaseDurationMonths", "depositPaidDate",
    ] as const;

    const patch: Record<string, any> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const [updated] = await db
      .update(leases)
      .set(patch)
      .where(eq(leases.id, leaseId))
      .returning();

    await appendEvent({
      leaseId, tenantId: existing.tenantId, orgId,
      eventType:   "updated",
      description: `Lease ${existing.leaseNumber} updated.`,
      performedBy: userId,
      metadata:    { changes: patch },
      ip:          req.ip,
    });

    res.locals.auditEntityId = String(leaseId);
    return res.json(updated);
  } catch (err) {
    log(`PATCH /:id error: ${err}`);
    return res.status(500).json({ message: "Failed to update lease" });
  }
});

// ─── POST /:id/send-for-signing ───────────────────────────────────────────────

router.post("/:id/send-for-signing", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);

    const [lease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!lease) return res.status(404).json({ message: "Lease not found" });
    if (lease.status !== "draft") {
      return res.status(400).json({ message: `Lease is already in status: ${lease.status}` });
    }

    const [tenant] = await db
      .select({ firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email })
      .from(tenants)
      .where(eq(tenants.id, lease.tenantId))
      .limit(1);

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    await db.update(leases)
      .set({ status: "pending_signature", updatedAt: new Date() })
      .where(eq(leases.id, leaseId));

    await appendEvent({
      leaseId, tenantId: lease.tenantId, orgId,
      eventType:   "sent_for_signing",
      description: `Lease ${lease.leaseNumber} sent to tenant ${tenant?.firstName} ${tenant?.lastName} for signing.`,
      performedBy: userId,
      ip:          req.ip,
    });

    // Send email notification to tenant
    if (tenant?.email) {
      await sendLeaseEmail({
        type:         "send_for_signing",
        to:           tenant.email,
        tenantName:   `${tenant.firstName} ${tenant.lastName}`,
        orgName:      org?.name ?? "Property Management",
        leaseNumber:  lease.leaseNumber,
        startDate:    String(lease.startDate),
        endDate:      String(lease.endDate),
        monthlyRent:  Number(lease.monthlyRent),
        currency:     lease.currency,
        leaseId,
      }).catch(e => log(`Email error: ${e}`));
    }

    return res.json({ message: "Lease sent for signing", status: "pending_signature" });
  } catch (err) {
    log(`POST /:id/send-for-signing error: ${err}`);
    return res.status(500).json({ message: "Failed to send lease for signing" });
  }
});

// ─── POST /:id/sign ───────────────────────────────────────────────────────────
// signer: "tenant" | "manager"

router.post("/:id/sign", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);
    const signer  = req.body.signer as "tenant" | "manager";

    if (!["tenant", "manager"].includes(signer)) {
      return res.status(400).json({ message: "signer must be 'tenant' or 'manager'" });
    }

    const [lease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!lease) return res.status(404).json({ message: "Lease not found" });
    if (!["pending_signature", "draft"].includes(lease.status)) {
      return res.status(400).json({ message: `Cannot sign a lease in status: ${lease.status}` });
    }

    const now = new Date();
    const ip  = req.ip ?? null;

    const patch: Record<string, any> = { updatedAt: now };
    if (signer === "tenant")  { patch.signedByTenantAt  = now; patch.tenantSignatureIp  = ip; }
    if (signer === "manager") { patch.signedByManagerAt = now; patch.managerSignatureIp = ip; }

    await db.update(leases).set(patch).where(eq(leases.id, leaseId));

    await appendEvent({
      leaseId, tenantId: lease.tenantId, orgId,
      eventType:   signer === "tenant" ? "signed_tenant" : "signed_manager",
      description: `Lease ${lease.leaseNumber} signed by ${signer}.`,
      performedBy: userId,
      metadata:    { signer, signedAt: now.toISOString(), ip },
      ip,
    });

    return res.json({ message: `Signed by ${signer}`, signedAt: now });
  } catch (err) {
    log(`POST /:id/sign error: ${err}`);
    return res.status(500).json({ message: "Failed to record signature" });
  }
});

// ─── POST /:id/activate ───────────────────────────────────────────────────────

router.post("/:id/activate", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);
    const role    = req.user.role as string;

    const ADMIN_MANAGER_LANDLORD = ["admin", "manager", "landlord"];
    if (!ADMIN_MANAGER_LANDLORD.includes(role)) {
      return res.status(403).json({ message: "Only admin, manager, or landlord can activate leases." });
    }

    const [lease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!lease) return res.status(404).json({ message: "Lease not found" });
    if (!["pending_signature", "draft"].includes(lease.status)) {
      return res.status(400).json({ message: `Lease is already ${lease.status}` });
    }

    await db.update(leases)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(leases.id, leaseId));

    // Sync the canonical dates back to tenants table
    await db.update(tenants)
      .set({
        leaseStartDate: String(lease.startDate),
        leaseEndDate:   String(lease.endDate),
        monthlyRent:    lease.monthlyRent,
        updatedAt:      new Date(),
      })
      .where(eq(tenants.id, lease.tenantId));

    await appendEvent({
      leaseId, tenantId: lease.tenantId, orgId,
      eventType:   "activated",
      description: `Lease ${lease.leaseNumber} activated. Term: ${lease.startDate} to ${lease.endDate}.`,
      performedBy: userId,
      ip:          req.ip,
    });

    // Notify tenant that their lease is now active
    notifyTenant(lease.tenantId, {
      type:        "lease_renewed",
      leaseNumber: lease.leaseNumber,
      newRent:     Number(lease.monthlyRent),
      currency:    lease.currency,
      newEndDate:  String(lease.endDate),
    }, orgId).catch(err => log(`WhatsApp lease activated failed: ${err}`));

    return res.json({ message: "Lease activated", status: "active" });
  } catch (err) {
    log(`POST /:id/activate error: ${err}`);
    return res.status(500).json({ message: "Failed to activate lease" });
  }
});

// ─── POST /:id/renew ──────────────────────────────────────────────────────────

router.post("/:id/renew", auditLog("lease", "CREATE") as any, async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);
    const role    = req.user.role as string;

    const ADMIN_MANAGER_LANDLORD = ["admin", "manager", "landlord"];
    if (!ADMIN_MANAGER_LANDLORD.includes(role)) {
      return res.status(403).json({ message: "Only admin, manager, or landlord can renew leases." });
    }

    const [oldLease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!oldLease) return res.status(404).json({ message: "Lease not found" });
    if (oldLease.status !== "active") {
      return res.status(400).json({ message: "Only active leases can be renewed" });
    }

    // Escalation: newRent = currentRent × (1 + escalationRate)
    const currentRent    = Number(oldLease.monthlyRent);
    const escalationRate = Number(oldLease.escalationRate);
    const newRent        = parseFloat((currentRent * (1 + escalationRate)).toFixed(2));

    // Override rent if caller provided one
    const overrideRent = req.body.monthlyRent ? Number(req.body.monthlyRent) : newRent;
    const newEndDate   = req.body.endDate ?? (() => {
      const d = new Date(String(oldLease.endDate));
      d.setMonth(d.getMonth() + oldLease.leaseDurationMonths);
      return d.toISOString().split("T")[0];
    })();

    const newLeaseNumber = leaseNumberFor(orgId, await nextLeaseSeq(orgId));

    // ── Kenyan Landlord and Tenant Act: rent increase notice ─────────────────
    // Landlords must give written notice of rent increases before the new lease period —
    // this residential-tenancy provision doesn't govern ordinary commercial leases.
    // We check whether there is sufficient notice time (≥30 days before old lease ends).
    const renewalWarnings: string[] = [];
    let renewalIsResidential = true;
    if (oldLease.unitId) {
      const [unitRow] = await db
        .select({ unitType: units.unitType })
        .from(units)
        .where(eq(units.id, oldLease.unitId))
        .limit(1);
      if (unitRow?.unitType) {
        renewalIsResidential = ["apartment", "house"].includes(unitRow.unitType);
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oldEndDate = new Date(String(oldLease.endDate));
    oldEndDate.setHours(0, 0, 0, 0);
    const daysUntilRenewal = Math.round((oldEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (renewalIsResidential && overrideRent !== currentRent && daysUntilRenewal < 30) {
      renewalWarnings.push(
        `Rent is increasing from ${oldLease.currency} ${currentRent.toLocaleString()} to ${overrideRent.toLocaleString()}, ` +
        `but the current lease ends in ${daysUntilRenewal} day(s). ` +
        `The Landlord and Tenant Act requires written notice of rent increases before the new lease period begins. ` +
        `Send the tenant formal written notice immediately and consider using the "Send for Signing" flow to document it.`
      );
    }
    // ─────────────────────────────────────────────────────────────────────────
    const [newLease] = await db.insert(leases).values({
      organizationId:       orgId,
      tenantId:             oldLease.tenantId,
      unitId:               oldLease.unitId,
      propertyId:           oldLease.propertyId,
      leaseNumber:          newLeaseNumber,
      previousLeaseId:      oldLease.id,
      startDate:            String(oldLease.endDate),  // new term starts the day old ends
      endDate:              newEndDate,
      leaseDurationMonths:  oldLease.leaseDurationMonths,
      monthlyRent:          String(overrideRent),
      currency:             oldLease.currency,
      securityDeposit:      oldLease.securityDeposit,  // deposit rolls over
      escalationRate:       oldLease.escalationRate,
      escalationFrequencyMonths: oldLease.escalationFrequencyMonths,
      status:               "draft",
      specialConditions:    oldLease.specialConditions,
      notes:                req.body.notes ?? null,
      createdBy:            userId,
    } as any).returning();

    // Mark old lease as renewed
    await db.update(leases)
      .set({ status: "renewed", updatedAt: new Date() })
      .where(eq(leases.id, leaseId));

    await appendEvent({
      leaseId: oldLease.id, tenantId: oldLease.tenantId, orgId,
      eventType:   "renewed",
      description: `Lease ${oldLease.leaseNumber} renewed. New lease: ${newLeaseNumber}.`,
      performedBy: userId,
      metadata:    { newLeaseId: newLease.id, newLeaseNumber },
      ip:          req.ip,
    });

    await appendEvent({
      leaseId: newLease.id, tenantId: oldLease.tenantId, orgId,
      eventType:   "created",
      description: `Renewal lease ${newLeaseNumber} created. Rent escalated from ${oldLease.currency} ${currentRent.toLocaleString()} to ${overrideRent.toLocaleString()} (${(escalationRate * 100).toFixed(0)}%).`,
      performedBy: userId,
      metadata:    { previousLeaseId: oldLease.id, oldRent: currentRent, newRent: overrideRent, escalationRate },
    });

    res.locals.auditEntityId = String(newLease.id);
    return res.status(201).json({
      newLease,
      oldLeaseId:    oldLease.id,
      escalationApplied: { oldRent: currentRent, newRent: overrideRent, rate: escalationRate },
      complianceWarnings: renewalWarnings,
    });
  } catch (err) {
    log(`POST /:id/renew error: ${err}`);
    return res.status(500).json({ message: "Failed to renew lease" });
  }
});

// ─── POST /:id/terminate ──────────────────────────────────────────────────────

router.post("/:id/terminate", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);
    const role    = req.user.role as string;
    const { reason, terminationDate } = req.body;

    const ADMIN_MANAGER_LANDLORD = ["admin", "manager", "landlord"];
    if (!ADMIN_MANAGER_LANDLORD.includes(role)) {
      return res.status(403).json({ message: "Only admin, manager, or landlord can terminate leases." });
    }

    if (!reason?.trim()) return res.status(400).json({ message: "reason is required" });

    const [lease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);

    if (!lease) return res.status(404).json({ message: "Lease not found" });

    // Landlords may only terminate leases on properties they own — same rule
    // used everywhere else a landlord touches property-scoped data.
    if (role === "landlord") {
      const [prop] = lease.propertyId
        ? await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, lease.propertyId)).limit(1)
        : [undefined];
      if (!prop || prop.ownerId !== userId) {
        return res.status(403).json({ message: "You can only terminate leases on properties you own." });
      }
    }

    if (lease.status !== "active") {
      return res.status(400).json({ message: "Only active leases can be terminated" });
    }

    const tDate = terminationDate ?? new Date().toISOString().split("T")[0];

    // ── Kenyan Landlord and Tenant Act: 30-day notice requirement ────────────
    // The Act requires 30 days' notice for tenancy termination in most cases —
    // this is a residential-tenancy provision, not a general rule for commercial leases.
    // We warn rather than block — the manager may have a court order or mutual agreement.
    const terminationWarnings: string[] = [];
    let terminationIsResidential = true;
    if (lease.unitId) {
      const [unitRow] = await db
        .select({ unitType: units.unitType })
        .from(units)
        .where(eq(units.id, lease.unitId))
        .limit(1);
      if (unitRow?.unitType) {
        terminationIsResidential = ["apartment", "house"].includes(unitRow.unitType);
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tDateObj = new Date(tDate);
    tDateObj.setHours(0, 0, 0, 0);
    const daysUntilTermination = Math.round((tDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (terminationIsResidential && daysUntilTermination < 30) {
      terminationWarnings.push(
        `Termination date is ${daysUntilTermination < 0 ? "in the past" : `only ${daysUntilTermination} day(s) away`}. ` +
        `The Landlord and Tenant Act requires at least 30 days' notice for residential tenancy termination. ` +
        `Ensure you have a legal basis (e.g. court order, mutual agreement) before proceeding.`
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── End the tenancy completely, atomically ───────────────────────────────
    // Previously this endpoint only updated leases.status — the tenant record
    // stayed "active", their unit stayed marked occupied, and their login
    // (users.isActive) was never touched, so a moved-out tenant could keep
    // using the tenant portal indefinitely. This now cascades all of it in one
    // transaction: lease -> terminated, tenant -> inactive, unit -> vacant,
    // and the tenant's own user account deactivated.
    const [tenant] = await db
      .select({ id: tenants.id, unitId: tenants.unitId, userId: tenants.userId })
      .from(tenants)
      .where(eq(tenants.id, lease.tenantId))
      .limit(1);

    const vacatedUnitId = lease.unitId ?? tenant?.unitId ?? null;

    await db.transaction(async (tx) => {
      await tx.update(leases)
        .set({ status: "terminated", endDate: tDate, updatedAt: new Date() } as any)
        .where(eq(leases.id, leaseId));

      if (tenant) {
        // Reusing the existing "inactive" status (not a new "moved_out" value)
        // so the tenant list's existing filters, counts, and TypeScript status
        // union in tenants.tsx all keep working with no further changes.
        await tx.update(tenants)
          .set({ status: "inactive", updatedAt: new Date() } as any)
          .where(eq(tenants.id, tenant.id));

        if (tenant.userId) {
          await tx.update(users)
            .set({ isActive: false, deactivatedAt: new Date(), deactivatedBy: userId } as any)
            .where(eq(users.id, tenant.userId));
        }
      }

      if (vacatedUnitId != null) {
        await tx.update(units)
          .set({ isOccupied: false } as any)
          .where(eq(units.id, vacatedUnitId));
      }
    });

    // Revoke refresh tokens so the session can't be renewed once the current
    // access token expires. Note this can't kill an already-issued access
    // token immediately — JWTs here are stateless with no revocation
    // blocklist, so a token stays technically valid until its own ~4h expiry.
    // This is the closest immediate-effect lever the app has.
    if (tenant?.userId) {
      await revokeAllUserTokens(tenant.userId).catch(err =>
        log(`Failed to revoke sessions for terminated tenant ${tenant.userId}: ${err}`)
      );
    }

    await appendEvent({
      leaseId, tenantId: lease.tenantId, orgId,
      eventType:   "terminated",
      description: `Lease ${lease.leaseNumber} terminated on ${tDate}. Reason: ${reason}`,
      performedBy: userId,
      metadata:    { reason, terminationDate: tDate },
      ip:          req.ip,
    });

    // Notify tenant of termination
    notifyTenant(lease.tenantId, {
      type:            "lease_terminated",
      leaseNumber:     lease.leaseNumber,
      terminationDate: tDate,
    }, orgId).catch(err => log(`WhatsApp lease terminated failed: ${err}`));

    res.locals.auditEntityId = String(leaseId);
    return res.json({ message: "Lease terminated", terminationDate: tDate, complianceWarnings: terminationWarnings });
  } catch (err) {
    log(`POST /:id/terminate error: ${err}`);
    return res.status(500).json({ message: "Failed to terminate lease" });
  }
});

// ─── GET /:id/events ──────────────────────────────────────────────────────────

router.get("/:id/events", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const leaseId = parseInt(req.params.id);

    const [lease] = await db
      .select({ id: leases.id })
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);
    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const events = await db
      .select({
        event:     leaseEvents,
        actorFirst: users.firstName,
        actorLast:  users.lastName,
      })
      .from(leaseEvents)
      .leftJoin(users, eq(leaseEvents.performedBy, users.id))
      .where(eq(leaseEvents.leaseId, leaseId))
      .orderBy(desc(leaseEvents.createdAt));

    return res.json(events.map(e => ({
      ...e.event,
      actorName: e.actorFirst
        ? `${e.actorFirst} ${e.actorLast ?? ""}`.trim()
        : "System",
    })));
  } catch (err) {
    log(`GET /:id/events error: ${err}`);
    return res.status(500).json({ message: "Failed to fetch lease events" });
  }
});

// ─── POST /:id/deposit ────────────────────────────────────────────────────────

const depositSchema = z.object({
  transactionType: z.enum(["received", "refunded", "partial_refund", "forfeited", "adjustment"]),
  amount:          z.number().positive(),
  reason:          z.string().min(1),
  reference:       z.string().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post("/:id/deposit", auditLog("lease", "UPDATE") as any, async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const userId  = req.user.id as string;
    const leaseId = parseInt(req.params.id);

    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });

    const { transactionType, amount, reason, reference, transactionDate } = parsed.data;

    const [lease] = await db
      .select()
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);
    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const currentBalance = await depositBalance(leaseId);

    // Validate refunds don't exceed balance
    if (["refunded", "partial_refund", "forfeited"].includes(transactionType) && amount > currentBalance) {
      return res.status(400).json({
        message: `Cannot ${transactionType} ${amount} — deposit balance is only ${currentBalance}`,
      });
    }

    const newBalance = transactionType === "received" || transactionType === "adjustment"
      ? currentBalance + amount
      : currentBalance - amount;

    const [txn] = await db.insert(depositTransactions).values({
      leaseId,
      tenantId:        lease.tenantId,
      organizationId:  orgId,
      transactionType,
      amount:          String(amount),
      currency:        lease.currency,
      balanceAfter:    String(newBalance),
      reason,
      reference:       reference ?? null,
      transactionDate,
      performedBy:     userId,
    }).returning();

    await appendEvent({
      leaseId, tenantId: lease.tenantId, orgId,
      eventType:   `deposit_${transactionType}`,
      description: `Deposit ${transactionType}: ${lease.currency} ${amount.toLocaleString()}. Balance: ${newBalance.toLocaleString()}. Reason: ${reason}`,
      performedBy: userId,
      metadata:    { transactionType, amount, newBalance, reference },
    });

    // Notify tenant of deposit refund
    if (["refunded", "partial_refund"].includes(transactionType)) {
      notifyTenant(lease.tenantId, {
        type:      "deposit_refunded",
        amount,
        currency:  lease.currency,
        reference: reference,
      }, orgId).catch(err => log(`WhatsApp deposit refund failed: ${err}`));
    }

    res.locals.auditEntityId = String(leaseId);
    return res.status(201).json({ transaction: txn, depositBalance: newBalance });
  } catch (err) {
    log(`POST /:id/deposit error: ${err}`);
    return res.status(500).json({ message: "Failed to record deposit transaction" });
  }
});

// ─── GET /:id/deposit ─────────────────────────────────────────────────────────

router.get("/:id/deposit", async (req: any, res) => {
  try {
    const orgId   = req.user.organizationId as number;
    const leaseId = parseInt(req.params.id);

    const [lease] = await db
      .select({ id: leases.id, securityDeposit: leases.securityDeposit, currency: leases.currency })
      .from(leases)
      .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
      .limit(1);
    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const txns = await db
      .select()
      .from(depositTransactions)
      .where(eq(depositTransactions.leaseId, leaseId))
      .orderBy(depositTransactions.transactionDate);

    const balance = txns.length > 0
      ? Number(txns[txns.length - 1].balanceAfter)
      : 0;

    return res.json({
      originalDeposit: Number(lease.securityDeposit),
      currentBalance:  balance,
      currency:        lease.currency,
      transactions:    txns,
    });
  } catch (err) {
    log(`GET /:id/deposit error: ${err}`);
    return res.status(500).json({ message: "Failed to fetch deposit ledger" });
  }
});

export default router;