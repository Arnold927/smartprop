/**
 * server/routes/landlord-scope-guard.ts
 *
 * Makes the generic /api/properties and /api/units CRUD safe and usable for the LANDLORD role.
 *
 * Two kinds of landlord exist on the platform:
 *   - a landlord whose property manager runs things for them (many landlords share one org), and
 *   - a landlord with no manager, who runs their own org and adds their own properties, units
 *     and tenants ("self-managing").
 * Both hit the same generic CRUD routers, which only know about the organisation, so before this
 * guard:
 *   - a property a landlord added was saved with NO owner, so it vanished from their own list
 *     and they could never add a tenant to it (tenants/leases/onboarding all require ownership);
 *   - any landlord could read, edit or delete another landlord's property in the same org;
 *   - /api/units (list, /vacant, read, edit, delete, create) returned/changed every landlord's
 *     units in the org, not just their own.
 *
 * Mounted BEFORE the CRUD routers (see routes/index.ts). Only the landlord role is touched;
 * admin, manager and staff pass straight through, so a property manager's behaviour is unchanged.
 */

import { Router } from "express";
import { db } from "../db";
import { properties, units } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { parseQueryOptions, buildQuery, buildConditions, paginateResponse } from "../utils/query";
import { sql } from "drizzle-orm";

const isLandlord = (req: any) => req.user?.role === "landlord";

async function ownedPropertyIds(orgId: number, userId: string): Promise<number[]> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId)));
  return rows.map((r) => r.id);
}

async function landlordOwnsProperty(orgId: number, userId: string, propertyId: number): Promise<boolean> {
  if (!Number.isInteger(propertyId)) return false;
  const [row] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, userId)))
    .limit(1);
  return !!row;
}

// ── /api/properties ──────────────────────────────────────────────────────────────────────────
export const landlordPropertyGuard = Router();

// New property: the landlord is the owner. Whatever ownerId / externalLandlordId the form sent
// is ignored — a landlord can't create a property on someone else's behalf.
landlordPropertyGuard.post("/", authenticateJWT as any, requireOrg as any, (req: any, _res, next) => {
  if (!isLandlord(req)) return next();
  req.body = { ...(req.body ?? {}), ownerId: req.user.id, externalLandlordId: null };
  next();
});

// Any property addressed by id (including /:id/units, /:id/full …): must be the landlord's own.
// A property that isn't theirs answers 404, exactly like one that doesn't exist.
landlordPropertyGuard.all(["/:id(\\d+)", "/:id(\\d+)/*"], authenticateJWT as any, requireOrg as any, async (req: any, res: any, next: any) => {
  if (!isLandlord(req)) return next();
  try {
    const ok = await landlordOwnsProperty(req.user.organizationId, req.user.id, parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ message: "Property not found" });
    // Editing can't hand the property to someone else (it would vanish from the landlord's view).
    if (req.method === "PUT" || req.method === "PATCH") {
      req.body = { ...(req.body ?? {}), ownerId: req.user.id, externalLandlordId: null };
    }
    next();
  } catch (err) {
    console.error("[landlord-scope-guard] property check failed:", err);
    res.status(500).json({ message: "Failed to verify property access" });
  }
});

// ── /api/units ───────────────────────────────────────────────────────────────────────────────
export const landlordUnitGuard = Router();

// List — only units in the landlord's own properties; same filters/paging/shape as the generic list.
landlordUnitGuard.get("/", authenticateJWT as any, requireOrg as any, async (req: any, res: any, next: any) => {
  if (!isLandlord(req)) return next();
  try {
    const mine = await ownedPropertyIds(req.user.organizationId, req.user.id);
    const queryOptions = parseQueryOptions(req);
    const scope = and(eq(units.organizationId, req.user.organizationId), mine.length ? inArray(units.propertyId, mine) : sql`false`);
    const rows = await buildQuery(db.select().from(units), units, queryOptions, scope);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(units)
      .where(and(...buildConditions(units, queryOptions, scope)));
    res.json(paginateResponse(rows, Number(count ?? 0), queryOptions.page || 1, queryOptions.pageSize || 20, req.originalUrl.split("?")[0]));
  } catch (err) {
    console.error("[landlord-scope-guard] unit list failed:", err);
    res.status(500).json({ message: "Failed to load units" });
  }
});

// Vacant units — landlord's own only (the generic handler returns the whole org's).
landlordUnitGuard.get("/vacant", authenticateJWT as any, requireOrg as any, async (req: any, res: any, next: any) => {
  if (!isLandlord(req)) return next();
  try {
    const mine = await ownedPropertyIds(req.user.organizationId, req.user.id);
    if (!mine.length) return res.json([]);
    const rows = await db
      .select()
      .from(units)
      .where(and(eq(units.organizationId, req.user.organizationId), eq(units.isOccupied, false), inArray(units.propertyId, mine)));
    res.json(rows);
  } catch (err) {
    console.error("[landlord-scope-guard] vacant units failed:", err);
    res.status(500).json({ message: "Failed to load vacant units" });
  }
});

// Create — the unit's property must be the landlord's own.
landlordUnitGuard.post("/", authenticateJWT as any, requireOrg as any, async (req: any, res: any, next: any) => {
  if (!isLandlord(req)) return next();
  try {
    const ok = await landlordOwnsProperty(req.user.organizationId, req.user.id, Number(req.body?.propertyId));
    if (!ok) return res.status(403).json({ message: "You can only add units to properties you own." });
    next();
  } catch (err) {
    console.error("[landlord-scope-guard] unit create check failed:", err);
    res.status(500).json({ message: "Failed to verify property access" });
  }
});

// Read / edit / delete one unit — through its property. (PATCH has its own, stricter guard in
// unit-vacancy-guard.ts, mounted next.) If an edit moves the unit to another property, that
// target must also be the landlord's.
landlordUnitGuard.all("/:id(\\d+)", authenticateJWT as any, requireOrg as any, async (req: any, res: any, next: any) => {
  if (!isLandlord(req) || req.method === "PATCH") return next();
  try {
    const [row] = await db
      .select({ propertyId: units.propertyId })
      .from(units)
      .where(and(eq(units.id, parseInt(req.params.id, 10)), eq(units.organizationId, req.user.organizationId)))
      .limit(1);
    if (!row || !(await landlordOwnsProperty(req.user.organizationId, req.user.id, row.propertyId))) {
      return res.status(404).json({ message: "Unit not found" });
    }
    if (req.method === "PUT" && req.body?.propertyId != null && Number(req.body.propertyId) !== row.propertyId) {
      if (!(await landlordOwnsProperty(req.user.organizationId, req.user.id, Number(req.body.propertyId)))) {
        return res.status(403).json({ message: "You can only move units between properties you own." });
      }
    }
    next();
  } catch (err) {
    console.error("[landlord-scope-guard] unit access check failed:", err);
    res.status(500).json({ message: "Failed to verify unit access" });
  }
});
