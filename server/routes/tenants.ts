/**
 * Tenants router — mounted at /api/tenants
 *
 * Changes vs. original:
 *  1. requireOrg guard on every route — orgId is now mandatory, not optional.
 *     The original had `if (orgId) { scoped } else { return ALL }` which is
 *     a data leak if the token somehow lacks an orgId.
 *  2. GET / supports server-side pagination (?page=&limit=).
 *  3. GET /:id/payments is org-scoped via tenant ownership.
 *  4. paymentRouter, invoiceRouter, mpesaRouter unchanged (use createCRUDRouter
 *     which already scopes by organizationId).
 */
import { Router } from "express";
import { createCRUDRouter } from "../utils/crud";
import {
  tenants, rentPayments, invoices, mpesaTransactions, units, users,
  insertTenantSchema, insertRentPaymentSchema, insertInvoiceSchema,
  insertMpesaTransactionSchema,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, count, inArray } from "drizzle-orm";
import { properties } from "@shared/schema";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { z } from "zod";
import { storage } from "../storage";
import { inviteTenantUser } from "../utils/inviteTenantUser";

const tenantRouter = Router();

// Apply authentication + org guard to all tenant routes
tenantRouter.use(authenticateJWT, requireOrg);

// ── GET /api/tenants ──────────────────────────────────────────────────────────
// ?page=1  &limit=20
tenantRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    // ── Row-level owner scoping ──────────────────────────────────────────────
    // Landlords may only see tenants whose units belong to their own properties.
    // Managers and admins see all tenants in the organisation.
    let tenantIds: number[] | null = null;

    if (role === "landlord") {
      const ownerProps = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId)));

      if (ownerProps.length === 0) {
        return res.json({ count: 0, page, limit, next: null, previous: null, results: [] });
      }

      const propIds = ownerProps.map(p => p.id);
      const ownerUnits = await db
        .select({ id: units.id })
        .from(units)
        .where(inArray(units.propertyId, propIds));

      const unitIds = ownerUnits.map(u => u.id);
      if (unitIds.length === 0) {
        return res.json({ count: 0, page, limit, next: null, previous: null, results: [] });
      }

      const scopedTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.organizationId, orgId), inArray(tenants.unitId, unitIds)));

      tenantIds = scopedTenants.map(t => t.id);
      if (tenantIds.length === 0) {
        return res.json({ count: 0, page, limit, next: null, previous: null, results: [] });
      }
    }
    // ── End owner scoping ────────────────────────────────────────────────────

    const baseCondition = tenantIds
      ? and(eq(tenants.organizationId, orgId), inArray(tenants.id, tenantIds))
      : eq(tenants.organizationId, orgId);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id:             tenants.id,
          firstName:      tenants.firstName,
          lastName:       tenants.lastName,
          email:          tenants.email,
          phone:          tenants.phone,
          unitId:         tenants.unitId,
          status:         tenants.status,
          leaseStartDate: tenants.leaseStartDate,
          leaseEndDate:   tenants.leaseEndDate,
          monthlyRent:    tenants.monthlyRent,
          currency:       tenants.currency,
          organizationId: tenants.organizationId,
          createdAt:      tenants.createdAt,
          updatedAt:      tenants.updatedAt,
          // Unit fields
          unitNumber:     units.unitNumber,
          unitPropertyId: units.propertyId,
          // Property fields
          propertyId:     properties.id,
          propertyName:   properties.name,
          propertyAddress: properties.address,
        })
        .from(tenants)
        .leftJoin(units, eq(tenants.unitId, units.id))
        .leftJoin(properties, eq(units.propertyId, properties.id))
        .where(baseCondition)
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(tenants)
        .where(baseCondition),
    ]);

    // Reshape flat rows into the nested shape the frontend expects
    const results = rows.map(row => ({
      id:             row.id,
      firstName:      row.firstName,
      lastName:       row.lastName,
      email:          row.email,
      phone:          row.phone,
      unitId:         row.unitId,
      status:         row.status,
      leaseStartDate: row.leaseStartDate,
      leaseEndDate:   row.leaseEndDate,
      monthlyRent:    row.monthlyRent,
      currency:       row.currency,
      organizationId: row.organizationId,
      createdAt:      row.createdAt,
      updatedAt:      row.updatedAt,
      unit: row.unitNumber
        ? { id: row.unitId!, unitNumber: row.unitNumber, propertyId: row.unitPropertyId! }
        : null,
      property: row.propertyId
        ? { id: row.propertyId, name: row.propertyName!, address: row.propertyAddress ?? undefined }
        : null,
    }));

    return res.json({
      count:    total,
      page,
      limit,
      next:     page * limit < total ? `?page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?page=${page - 1}&limit=${limit}` : null,
      results,
    });
  } catch (error: any) {
    console.error("Error listing tenants:", error);
    return res.status(500).json({ message: "Failed to fetch tenants" });
  }
});

// ── GET /api/tenants/me ───────────────────────────────────────────────────────
// Returns the tenant record linked to the currently logged-in user.
// This route is intentionally open to the "tenant" role (requireOrg only).
// It must be declared BEFORE /:id so Express does not treat "me" as an id.
//
// Lookup order (each step backfills missing links before returning):
//   1. userId  + orgId   — fast path after proper invite/activate flow
//   2. email   + orgId   — fallback if userId was not stamped at tenant creation
//   3. email   (no org)  — recovery path for users whose organizationId is null
//      on their users row; heals both tenants.userId AND users.organizationId
tenantRouter.get("/me", async (req: any, res: any) => {
  try {
    const userId: string = String(req.user?.id ?? req.user?.userId ?? "");
    const orgId:  number | undefined = req.user?.organizationId ?? undefined;
    const userEmail: string = (req.user?.email ?? "").toLowerCase();

    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    // ── Shared select shape ───────────────────────────────────────────────────
    const tenantSelect = {
      id:              tenants.id,
      userId:          tenants.userId,
      firstName:       tenants.firstName,
      lastName:        tenants.lastName,
      email:           tenants.email,
      phone:           tenants.phone,
      unitId:          tenants.unitId,
      status:          tenants.status,
      leaseStartDate:  tenants.leaseStartDate,
      leaseEndDate:    tenants.leaseEndDate,
      monthlyRent:     tenants.monthlyRent,
      securityDeposit: tenants.securityDeposit,
      currency:        tenants.currency,
      organizationId:  tenants.organizationId,
      createdAt:       tenants.createdAt,
      updatedAt:       tenants.updatedAt,
      unitNumber:      units.unitNumber,
      unitType:        units.unitType,
      unitPropertyId:  units.propertyId,
      propertyId:      properties.id,
      propertyName:    properties.name,
      propertyAddress: properties.address,
    };

    const joinTables = (q: any) =>
      q.leftJoin(units,      eq(tenants.unitId,       units.id))
       .leftJoin(properties, eq(units.propertyId,     properties.id));

    function toResponse(r: any) {
      return {
        ...r,
        unit:     r.unitNumber ? { id: r.unitId!, unitNumber: r.unitNumber, propertyId: r.unitPropertyId!, unitType: r.unitType ?? "apartment" } : null,
        property: r.propertyId ? { id: r.propertyId, name: r.propertyName!, address: r.propertyAddress ?? undefined } : null,
      };
    }

    // ── 1. userId + orgId (fast path) ────────────────────────────────────────
    if (orgId) {
      const rows = await joinTables(
        db.select(tenantSelect).from(tenants)
      ).where(and(eq(tenants.organizationId, orgId), eq(tenants.userId, userId))).limit(1);

      if (rows.length) return res.json(toResponse(rows[0]));

      // ── 2. email + orgId (userId not yet stamped on tenant row) ─────────────
      if (userEmail) {
        const emailRows = await joinTables(
          db.select(tenantSelect).from(tenants)
        ).where(and(eq(tenants.organizationId, orgId), eq(tenants.email, userEmail))).limit(1);

        if (emailRows.length) {
          // Backfill userId on the tenant row
          if (!emailRows[0].userId && userId) {
            await db.update(tenants).set({ userId, updatedAt: new Date() }).where(eq(tenants.id, emailRows[0].id));
          }
          return res.json(toResponse(emailRows[0]));
        }
      }
    }

    // ── 3. email only — recovery for null-org users ──────────────────────────
    // Reached when orgId is absent from the JWT (user.organizationId is null).
    // authenticateJWT already rejected tokens with no org, but if we are here
    // the middleware was bypassed or the orgId was patched in after token issue.
    // We do a cross-org lookup by email and heal both sides.
    if (userEmail) {
      const crossOrgRows = await joinTables(
        db.select(tenantSelect).from(tenants)
      ).where(eq(tenants.email, userEmail)).limit(1);

      if (crossOrgRows.length) {
        const t = crossOrgRows[0];
        const healOrgId = t.organizationId;

        // Backfill tenants.userId
        if (!t.userId && userId) {
          await db.update(tenants).set({ userId, updatedAt: new Date() }).where(eq(tenants.id, t.id));
        }

        // Backfill users.organizationId + role so next login works normally
        if (healOrgId) {
          await db.update(users)
            .set({ organizationId: healOrgId, role: "tenant", updatedAt: new Date() } as any)
            .where(and(eq(users.id, userId)));
        }

        return res.json(toResponse(t));
      }
    }

    return res.status(404).json({ message: "No tenant record linked to your account" });
  } catch (err: any) {
    console.error("[tenants/me]", err);
    return res.status(500).json({ message: "Failed to fetch tenant profile" });
  }
});

// ── GET /api/tenants/:id ──────────────────────────────────────────────────────
tenantRouter.get("/:id", async (req: any, res: any) => {
  try {
    const id: number    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const result = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.organizationId, orgId)))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    return res.json(result[0]);
  } catch (error: any) {
    console.error("Error getting tenant:", error);
    return res.status(500).json({ message: "Failed to fetch tenant" });
  }
});

// ── POST /api/tenants ─────────────────────────────────────────────────────────
tenantRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number  = req.user.organizationId;
    const role: string   = req.user.role ?? "";

    // Previously unitId was accepted from the request body with no
    // verification at all — not even that the unit belonged to the caller's
    // own organisation. Now: the unit must belong to this org, and if the
    // caller is a landlord, the unit's property must also belong to them.
    const unitIdRaw = req.body.unitId;
    if (unitIdRaw != null) {
      const unitId = Number(unitIdRaw);
      const [unitRow] = await db
        .select({ unitId: units.id, propertyId: units.propertyId, propOrgId: properties.organizationId, ownerId: properties.ownerId })
        .from(units)
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(eq(units.id, unitId))
        .limit(1);

      if (!unitRow || unitRow.propOrgId !== orgId) {
        return res.status(400).json({ message: "Unit not found in your organisation." });
      }
      if (role === "landlord" && unitRow.ownerId !== req.user.id) {
        return res.status(403).json({ message: "You can only add tenants to units in properties you own." });
      }
    }

    // Resolve the tenant's OWN user account by their email so that
    // GET /api/tenants/me can find the record when the tenant logs in.
    // If no user account exists yet for that email, userId is left null
    // and the /me endpoint's email-fallback will handle the lookup.
    let tenantUserId: string | null = null;
    const tenantEmail: string = (req.body.email ?? "").trim().toLowerCase();
    if (tenantEmail) {
      const [tenantUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, tenantEmail))
        .limit(1);
      if (tenantUser) tenantUserId = tenantUser.id;
    }

    const tenantData = {
      ...req.body,
      organizationId: orgId,
      userId: tenantUserId,  // tenant's own user account (not the creating manager's)
    };

    const parsed = insertTenantSchema.safeParse(tenantData);
    if (!parsed.success) {
      return res.status(422).json({
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const tenant = await storage.createTenant(parsed.data);

    // Auto-invite the tenant to the portal — same behavior as
    // /api/tenant-onboarding, so which "Add Tenant" entry point someone
    // used no longer determines whether the tenant can ever log in. Only
    // when no existing user account was already found above for this
    // email — otherwise this would email an already-active tenant a
    // confusing "set up your account" link for an account they already use.
    if (!tenantUserId) {
      inviteTenantUser({
        organizationId: orgId,
        invitedByUserId: req.user.id,
        email: tenantData.email,
        firstName: tenantData.firstName,
        lastName: tenantData.lastName,
      });
    }

    return res.status(201).json(tenant);
  } catch (error: any) {
    console.error("Error creating tenant:", error);
    return res.status(500).json({ message: error.message || "Failed to create tenant" });
  }
});

// ── PUT /api/tenants/:id ──────────────────────────────────────────────────────
tenantRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id: number    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";

    // A tenant may only edit their OWN record, and only a small whitelist of
    // self-service fields (contact info) — never rent, deposit, status, lease
    // dates, or unitId. Previously any tenant could edit any other tenant's
    // full record, including financial fields, by guessing an id.
    if (role === "tenant") {
      const [own] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, id), eq(tenants.userId, req.user.id)))
        .limit(1);
      if (!own) return res.status(404).json({ message: "Tenant not found" });

      const selfServiceSchema = z.object({
        phone: z.string().optional(),
        email: z.string().email().optional(),
      });
      const parsed = selfServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(422).json({ message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      }
      const tenant = await storage.updateTenantById(id, orgId, parsed.data);
      return res.json(tenant);
    }

    // Landlords may only edit tenants in properties they own — same rule used
    // everywhere else a landlord touches property-scoped data this session.
    if (role === "landlord") {
      const [row] = await db
        .select({ propertyId: units.propertyId })
        .from(tenants)
        .leftJoin(units, eq(tenants.unitId, units.id))
        .where(and(eq(tenants.id, id), eq(tenants.organizationId, orgId)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Tenant not found" });
      if (row.propertyId) {
        const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, row.propertyId)).limit(1);
        if (!prop || prop.ownerId !== req.user.id) {
          return res.status(403).json({ message: "You can only edit tenants in properties you own." });
        }
      }
    }

    const updateSchema = insertTenantSchema.partial().omit({ organizationId: true, userId: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // Coerce numeric strings for money fields
    const raw = parsed.data as any;
    const updates: Record<string, any> = { ...raw };
    if (raw.monthlyRent     != null) updates.monthlyRent     = String(parseFloat(raw.monthlyRent));
    if (raw.securityDeposit != null) updates.securityDeposit = String(parseFloat(raw.securityDeposit));

    const tenant = await storage.updateTenantById(id, orgId, updates);
    return res.json(tenant);
  } catch (error: any) {
    console.error("Error updating tenant:", error);
    return res.status(500).json({ message: error.message || "Failed to update tenant" });
  }
});

// ── DELETE /api/tenants/:id ───────────────────────────────────────────────────
tenantRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id: number    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const result = await db
      .delete(tenants)
      .where(and(eq(tenants.id, id), eq(tenants.organizationId, orgId)))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    return res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting tenant:", error);
    return res.status(500).json({ message: "Failed to delete tenant" });
  }
});

// ── GET /api/tenants/:id/payments ─────────────────────────────────────────────
tenantRouter.get("/:id/payments", async (req: any, res: any) => {
  try {
    const tenantId: number = parseInt(req.params.id);
    const orgId: number    = req.user.organizationId;
    const role: string     = req.user.role ?? "";

    // Verify the tenant belongs to the caller's org before exposing payments —
    // and if the caller IS a tenant, it must be their own record specifically.
    const ownerCondition = role === "tenant"
      ? and(eq(tenants.id, tenantId), eq(tenants.userId, req.user.id))
      : and(eq(tenants.id, tenantId), eq(tenants.organizationId, orgId));

    const [tenant] = await db
      .select({ id: tenants.id, unitId: tenants.unitId })
      .from(tenants)
      .where(ownerCondition)
      .limit(1);

    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    // Landlords may only view payments for tenants in properties they own.
    if (role === "landlord" && tenant.unitId) {
      const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
      if (unit?.propertyId) {
        const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1);
        if (!prop || prop.ownerId !== req.user.id) {
          return res.status(404).json({ message: "Tenant not found" });
        }
      }
    }

    const results = await db
      .select()
      .from(rentPayments)
      .where(eq(rentPayments.tenantId, tenantId));

    return res.json(results);
  } catch (error: any) {
    console.error("Error getting tenant payments:", error);
    return res.status(500).json({ message: "Failed to fetch payments" });
  }
});

// ── sub-resource routers (use createCRUDRouter — already org-scoped) ──────────
const paymentRouter = createCRUDRouter({
  table: rentPayments,
  insertSchema: insertRentPaymentSchema as any,
  organizationScoped: true,
});

const invoiceRouter = createCRUDRouter({
  table: invoices,
  insertSchema: insertInvoiceSchema as any,
  organizationScoped: true,
});

const mpesaRouter = createCRUDRouter({
  table: mpesaTransactions,
  insertSchema: insertMpesaTransactionSchema as any,
  organizationScoped: true,
});

export { tenantRouter, paymentRouter, invoiceRouter, mpesaRouter };