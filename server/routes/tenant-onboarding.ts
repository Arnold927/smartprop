/**
 * Tenant Onboarding route — POST /api/tenant-onboarding
 *
 * Accepts the multi-step onboarding form payload and:
 *  1. Resolves the property name → property id (org-scoped)
 *  2. Resolves the unit number → unit id (must belong to that property)
 *  3. Creates the tenant record linked to that unit
 *  4. Marks the unit as occupied
 *
 * Utility baseline readings and rate defaults are stored as notes on the
 * tenant record until a dedicated utility_readings table is added.
 */

import { Router } from "express";
import { db } from "../db";
import { tenants, units, properties, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { resolveOrInviteTenantUser } from "../utils/resolveOrInviteTenantUser";

const tenantOnboardingRouter = Router();

tenantOnboardingRouter.use(authenticateJWT, requireOrg);

tenantOnboardingRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number  = req.user.organizationId;
    const requestingUserId: string = req.user.id; // the admin/manager submitting this form — NOT the tenant

    const {
      // Step 1 — Tenant Info
      tenantName,
      idPassport,
      phone,
      whatsappNumber,
      email,
      propertyName,
      unitNumber,
      moveInDate,

      // Step 2 — Utility baselines (optional)
      includeWater,
      waterMeterNumber,
      waterCurrentReading,
      waterReadingDate,
      includeElectricity,
      electricityMeterNumber,
      electricityCurrentReading,
      electricityReadingDate,
      includeGas,
      gasMeterNumber,
      gasCurrentReading,
      gasReadingDate,

      // Step 3 — Rates & charges (all optional)
      waterDefaultRate,
      electricityDefaultRate,
      gasDefaultRate,
      monthlyServiceCharge,
      garbageCollectionFee,
      securityFee,
      parkingFee,

      // Step 4 — Payment
      preferredPaymentMethod,
      monthlyDueDate,
      depositPaid,
      notesAgreements,

      // Optional — only sent by property-details.tsx's Add Tenant dialog,
      // which (unlike the onboarding wizard and the Directory's modal)
      // collects these directly. Left undefined by the other two callers,
      // same as before this endpoint was shared with them.
      monthlyRent,
      leaseEndDate,
      status: statusOverride,
    } = req.body;

    // ── 1. Resolve property (must belong to this org; if the caller is a
    //    landlord, it must also belong to them specifically — same rule as
    //    GET /api/properties in properties-list.ts) ───────────────────────────
    const role: string = req.user.role ?? "";
    const propertyCondition = role === "landlord"
      ? and(eq(properties.name, propertyName), eq(properties.organizationId, orgId), eq(properties.ownerId, requestingUserId))
      : and(eq(properties.name, propertyName), eq(properties.organizationId, orgId));

    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(propertyCondition)
      .limit(1);

    if (!property) {
      return res.status(400).json({ message: `Property "${propertyName}" not found in your organisation.` });
    }

    // ── 2. Resolve unit (must belong to that property & have no active tenant) ─
    const [unit] = await db
      .select({ id: units.id, isOccupied: units.isOccupied })
      .from(units)
      .where(and(eq(units.propertyId, property.id), eq(units.unitNumber, unitNumber)))
      .limit(1);

    if (!unit) {
      return res.status(400).json({ message: `Unit "${unitNumber}" not found in property "${propertyName}".` });
    }

    // Check for an active tenant rather than relying on the isOccupied flag alone
    const [activeTenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.unitId, unit.id), eq(tenants.status, "active")))
      .limit(1);

    if (activeTenant) {
      return res.status(400).json({ message: `Unit "${unitNumber}" already has an active tenant.` });
    }

    // ── 3. Build notes string from optional utility + charge data ────────────
    const noteLines: string[] = [];

    if (includeWater && waterMeterNumber) {
      noteLines.push(`Water meter: ${waterMeterNumber}, baseline reading: ${waterCurrentReading ?? "N/A"} on ${waterReadingDate ?? "N/A"}`);
      if (waterDefaultRate) noteLines.push(`Water default rate: KES ${waterDefaultRate}/m³`);
    }
    if (includeElectricity && electricityMeterNumber) {
      noteLines.push(`Electricity meter: ${electricityMeterNumber}, baseline reading: ${electricityCurrentReading ?? "N/A"} on ${electricityReadingDate ?? "N/A"}`);
      if (electricityDefaultRate) noteLines.push(`Electricity default rate: KES ${electricityDefaultRate}/kWh`);
    }
    if (includeGas && gasMeterNumber) {
      noteLines.push(`Gas meter: ${gasMeterNumber}, baseline reading: ${gasCurrentReading ?? "N/A"} on ${gasReadingDate ?? "N/A"}`);
      if (gasDefaultRate) noteLines.push(`Gas default rate: KES ${gasDefaultRate}/m³`);
    }
    if (monthlyServiceCharge) noteLines.push(`Service charge: KES ${monthlyServiceCharge}/mo`);
    if (garbageCollectionFee) noteLines.push(`Garbage fee: KES ${garbageCollectionFee}/mo`);
    if (securityFee)          noteLines.push(`Security fee: KES ${securityFee}/mo`);
    if (parkingFee)           noteLines.push(`Parking fee: KES ${parkingFee}/mo`);
    if (preferredPaymentMethod) noteLines.push(`Payment method: ${preferredPaymentMethod}`);
    if (monthlyDueDate)       noteLines.push(`Due day: ${monthlyDueDate}`);
    if (whatsappNumber)       noteLines.push(`WhatsApp: ${whatsappNumber}`);
    if (idPassport)           noteLines.push(`ID/Passport: ${idPassport}`);
    if (notesAgreements)      noteLines.push(`Notes: ${notesAgreements}`);

    const notes = noteLines.join("\n");

    // ── 4. Split tenantName into first / last ────────────────────────────────
    const nameParts  = (tenantName ?? "").trim().split(/\s+/);
    const firstName  = nameParts[0] ?? "";
    const lastName   = nameParts.slice(1).join(" ") || "-";

    // ── Resolve (or create) the TENANT's own user account — tenants.userId
    //    is NOT NULL, so this must be awaited and its result used below; it
    //    cannot be a fire-and-forget side effect after the tenant row is
    //    already inserted (see resolveOrInviteTenantUser.ts for why the
    //    previous approach here was a real bug for brand-new tenants, the
    //    common case). This is what every tenant-portal feature (documents,
    //    maintenance, M-Pesa actions, subletting, etc.) matches sessions
    //    against via eq(tenants.userId, req.user.id) — using
    //    requestingUserId (the admin/manager filling out this form) here
    //    instead would silently break the tenant's own portal for them.
    const tenantEmailNormalized: string = (email ?? "").trim().toLowerCase();
    if (!tenantEmailNormalized) {
      return res.status(400).json({ message: "Email is required to onboard a tenant." });
    }
    const tenantUserId = await resolveOrInviteTenantUser({
      organizationId: orgId,
      invitedByUserId: requestingUserId,
      email: tenantEmailNormalized,
      firstName,
      lastName,
    });

    // ── 5. Create the tenant record ──────────────────────────────────────────
    const [newTenant] = await db
      .insert(tenants)
      .values({
        organizationId:  orgId,
        userId:          tenantUserId,
        firstName,
        lastName,
        email,
        phone:           phone ?? whatsappNumber,
        unitId:          unit.id,
        leaseStartDate:  moveInDate || null,
        leaseEndDate:    leaseEndDate || null,
        monthlyRent:     monthlyRent != null ? String(parseFloat(monthlyRent)) : null,
        securityDeposit: depositPaid ? String(parseFloat(depositPaid)) : null,
        currency:        "KES",
        status:          statusOverride || "active",
      })
      .returning();

    // ── 6. Mark the unit as occupied ─────────────────────────────────────────
    await db
      .update(units)
      .set({ isOccupied: true })
      .where(eq(units.id, unit.id));

    return res.status(201).json({
      message: "Tenant onboarded successfully.",
      tenant:  newTenant,
      notes,
    });
  } catch (error: any) {
    console.error("Tenant onboarding error:", error);
    return res.status(500).json({ message: error.message || "Failed to complete tenant onboarding." });
  }
});

export default tenantOnboardingRouter;