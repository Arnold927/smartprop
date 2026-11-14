/**
 * property-setup.ts — create a property together with ALL its units in one request.
 * Mounted at /api/property-setup
 *
 * POST /api/property-setup
 *   { property: { name, address, propertyType?, description?, ownerId?, externalLandlordId? },
 *     units:    [{ unitNumber, floor?, unitType?, bedrooms?, bathrooms?, sqft?,
 *                  rentBasis?, ratePerSqft?, monthlyRent?, currency? }, …]   (1–500)
 *     organizationId? }                                   ← platform_admin only (or ?organizationId=)
 *
 * Why it exists: adding a property used to be "create property, then open Add Unit and fill the
 * same dialog once per unit" — 80 units meant 80 dialogs. The client now generates the unit list
 * (floors × units per floor, or pasted from a spreadsheet) and sends it here once.
 *
 * Guarantees
 *   - All-or-nothing: the property and every unit are written in one transaction.
 *   - Same plan checks as the normal "add property" route (active subscription, property limit).
 *   - Validated up front with row-level messages ("Row 12 (A104): rent is required") so a typo in
 *     one row never leaves a half-built building behind.
 *   - A landlord can only create a property for themselves; a manager/admin/platform admin may name
 *     an owner, which must be a landlord (or external landlord) of the SAME organisation.
 *   - A property with the same name in the organisation is refused, which also makes an accidental
 *     double-click on "Create" harmless.
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { properties, units, users, externalLandlords } from "@shared/schema";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { requireActiveSubscription, enforcePropertyLimit } from "../middleware/billing";
import { auditLog } from "../middleware/auditLog";

const router = Router();

export const MAX_UNITS_PER_PROPERTY_SETUP = 500;

// numeric(10,2) columns top out just under 100 million.
const MAX_MONEY = 99_999_999;
const UNIT_TYPES = ["apartment", "house", "office", "retail", "kiosk", "anchor_retail", "warehouse", "parking", "storage", "other"] as const;
// Only these carry bedrooms/bathrooms (matches the Add Unit dialog).
const RESIDENTIAL_TYPES = new Set<string>(["apartment", "house"]);

// "" / undefined → null, otherwise validate. Keeps spreadsheet-style input forgiving.
const optNum = (inner: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), inner.nullable());

const unitSchema = z.object({
  unitNumber: z.string().trim().min(1, "unit number is required").max(40, "unit number is too long"),
  floor: z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().max(20, "floor is too long").nullable()),
  unitType: z.enum(UNIT_TYPES).default("apartment"),
  bedrooms: optNum(z.coerce.number().int().min(0).max(50)),
  bathrooms: optNum(z.coerce.number().min(0).max(50)),
  sqft: optNum(z.coerce.number().int().min(0).max(10_000_000)),
  rentBasis: z.enum(["fixed", "per_sqft"]).default("fixed"),
  ratePerSqft: optNum(z.coerce.number().min(0).max(MAX_MONEY, "rate is too large")),
  monthlyRent: optNum(z.coerce.number().min(0).max(MAX_MONEY, "rent is too large")),
  currency: z.string().trim().length(3).optional(),
});

const bodySchema = z.object({
  property: z.object({
    name: z.string().trim().min(1, "Property name is required").max(200),
    address: z.string().trim().min(1, "Address is required"),
    propertyType: z.enum(["residential", "commercial", "mixed_use"]).default("residential"),
    description: z.string().trim().optional().nullable(),
    ownerId: z.string().uuid().optional().nullable(),
    externalLandlordId: z.number().int().positive().optional().nullable(),
  }),
  units: z.array(z.any()).min(1, "Add at least one unit").max(MAX_UNITS_PER_PROPERTY_SETUP, `At most ${MAX_UNITS_PER_PROPERTY_SETUP} units can be created at once`),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

router.post(
  "/",
  authenticateJWT as any,
  requireOrg as any,
  requireActiveSubscription as any,
  enforcePropertyLimit as any,
  auditLog("property", "CREATE") as any,
  async (req: any, res: any) => {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues });
    }
    const { property, units: rawUnits } = parsed.data;

    // ── Validate every unit row, collecting ALL problems so the user can fix them in one go ──
    const rowErrors: { row: number; unitNumber: string; message: string }[] = [];
    const clean: any[] = [];
    const seen = new Map<string, number>();

    rawUnits.forEach((raw, idx) => {
      const rowNo = idx + 1;
      const label = String(raw?.unitNumber ?? "").trim();
      const r = unitSchema.safeParse(raw);
      if (!r.success) {
        const issue = r.error.issues[0];
        rowErrors.push({ row: rowNo, unitNumber: label, message: `${String(issue.path[0] ?? "row")}: ${issue.message}` });
        return;
      }
      const u = r.data;
      const key = u.unitNumber.toLowerCase();
      if (seen.has(key)) {
        rowErrors.push({ row: rowNo, unitNumber: u.unitNumber, message: `unit number repeats row ${seen.get(key)}` });
        return;
      }
      seen.set(key, rowNo);

      let monthlyRent = u.monthlyRent;
      if (u.rentBasis === "per_sqft") {
        if (!u.sqft || !u.ratePerSqft) {
          rowErrors.push({ row: rowNo, unitNumber: u.unitNumber, message: "rate per sqft needs both sqft and a rate" });
          return;
        }
        // Same rule as the Add Unit dialog: rent = sqft × rate (an explicit rent still wins).
        if (monthlyRent == null) monthlyRent = round2(u.sqft * u.ratePerSqft);
        if (monthlyRent > MAX_MONEY) {
          rowErrors.push({ row: rowNo, unitNumber: u.unitNumber, message: "sqft × rate comes to more than the system can store — check the figures" });
          return;
        }
      }
      if (monthlyRent == null) {
        rowErrors.push({ row: rowNo, unitNumber: u.unitNumber, message: "rent is required" });
        return;
      }

      const residential = RESIDENTIAL_TYPES.has(u.unitType);
      clean.push({
        organizationId: orgId,
        unitNumber: u.unitNumber,
        floor: u.floor,
        unitType: u.unitType,
        bedrooms: residential ? u.bedrooms : null,
        bathrooms: residential && u.bathrooms != null ? String(u.bathrooms) : null,
        sqft: u.sqft,
        rentBasis: u.rentBasis,
        ratePerSqft: u.rentBasis === "per_sqft" && u.ratePerSqft != null ? String(u.ratePerSqft) : null,
        monthlyRent: String(monthlyRent),
        currency: (u.currency ?? "KES").toUpperCase(),
        isOccupied: false,
      });
    });

    if (rowErrors.length) {
      const first = rowErrors[0];
      return res.status(400).json({
        message: `${rowErrors.length} unit${rowErrors.length === 1 ? "" : "s"} need fixing — row ${first.row}${first.unitNumber ? ` (${first.unitNumber})` : ""}: ${first.message}`,
        code: "UNIT_ROWS_INVALID",
        rowErrors,
      });
    }

    try {
      // ── Owner ──
      let ownerId: string | null = null;
      let externalLandlordId: number | null = null;
      if (role === "landlord") {
        ownerId = req.user.id; // a landlord can only create a property for themselves
      } else if (property.ownerId) {
        const [o] = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.id, property.ownerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
        if (!o) return res.status(400).json({ message: "That owner isn't a landlord in this organisation." });
        ownerId = o.id;
      } else if (property.externalLandlordId) {
        const [o] = await db.select({ id: externalLandlords.id }).from(externalLandlords)
          .where(and(eq(externalLandlords.id, property.externalLandlordId), eq(externalLandlords.organizationId, orgId))).limit(1);
        if (!o) return res.status(400).json({ message: "That external landlord isn't in this organisation." });
        externalLandlordId = o.id;
      }

      // ── Same name already in this organisation? (also stops a double-click making two buildings) ──
      const [dup] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.organizationId, orgId), sql`lower(${properties.name}) = lower(${property.name})`)).limit(1);
      if (dup) {
        return res.status(409).json({ message: `A property called "${property.name}" already exists in this organisation.`, code: "DUPLICATE_PROPERTY", propertyId: dup.id });
      }

      // ── One transaction: property + every unit ──
      const created = await db.transaction(async (tx) => {
        const [p] = await tx.insert(properties).values({
          organizationId: orgId,
          name: property.name,
          address: property.address,
          propertyType: property.propertyType,
          description: property.description || null,
          totalUnits: clean.length,
          ownerId,
          externalLandlordId,
        } as any).returning();

        for (let i = 0; i < clean.length; i += 200) {
          await tx.insert(units).values(clean.slice(i, i + 200).map((u) => ({ ...u, propertyId: p.id })) as any);
        }
        return p;
      });

      res.locals.auditEntityId = created.id;
      res.locals.auditMeta = { unitsCreated: clean.length, via: "property-setup" };

      const potentialRent = clean.reduce((s, u) => s + parseFloat(u.monthlyRent || "0"), 0);
      res.status(201).json({ property: created, unitCount: clean.length, monthlyPotentialRent: round2(potentialRent) });
    } catch (err: any) {
      console.error("[property-setup] failed:", err);
      res.status(500).json({ message: "Couldn't create the property. Nothing was saved — please try again." });
    }
  },
);

export default router;
