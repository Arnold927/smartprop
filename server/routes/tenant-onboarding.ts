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
import { tenants, units, properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { inviteTenantUser } from "../utils/inviteTenantUser";

const tenantOnboardingRouter = Router();

tenantOnboardingRouter.use(authenticateJWT, requireOrg);

tenantOnboardingRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number  = req.user.organizationId;
    const userId: string = req.user.id;

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
    } = req.body;

    // ── 1. Resolve property (must belong to this org; if the caller is a
    //    landlord, it must also belong to them specifically — same rule as
    //    GET /api/properties in properties-list.ts) ───────────────────────────
    const role: string = req.user.role ?? "";
    const propertyCondition = role === "landlord"
      ? and(eq(properties.name, propertyName), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
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

    // ── 5. Create the tenant record ──────────────────────────────────────────
    const [newTenant] = await db
      .insert(tenants)
      .values({
        organizationId:  orgId,
        userId,
        firstName,
        lastName,
        email,
        phone:           phone ?? whatsappNumber,
        unitId:          unit.id,
        leaseStartDate:  moveInDate || null,
        securityDeposit: depositPaid ? String(parseFloat(depositPaid)) : null,
        currency:        "KES",
        status:          "active",
      })
      .returning();

    // ── 6. Mark the unit as occupied ─────────────────────────────────────────
    await db
      .update(units)
      .set({ isOccupied: true })
      .where(eq(units.id, unit.id));

    // ── 7. Auto-invite the tenant to the portal ─────────────────────────────
    inviteTenantUser({
      organizationId: orgId,
      invitedByUserId: userId,
      email,
      firstName,
      lastName,
    });

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