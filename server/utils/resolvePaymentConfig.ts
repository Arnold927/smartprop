/**
 * server/utils/resolvePaymentConfig.ts
 *
 * Resolves which payment configuration applies to a specific tenant:
 *   1. Their unit's property -> property.ownerId
 *   2. If that landlord has their own row in landlordPaymentSettings, use it
 *   3. Otherwise fall back to the org-wide default (organizationSettings.paymentSettings)
 *
 * A landlord who never sets up their own override just keeps using the org
 * default — this makes single-landlord orgs (the common case) need zero
 * extra setup, while multi-landlord orgs (several distinct owners sharing
 * one organization account) can each configure their own Paybill/Till.
 *
 * Shared between payment-config.ts (GET /public) and mpesa-actions.ts
 * (POST /initiate's shortcode resolution) so the two can't disagree about
 * where a given tenant's money should actually go.
 */

import { db } from "../db";
import { tenants, units, properties, organizationSettings, landlordPaymentSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "./credentialEncryption";

export interface ResolvedMpesaCredentials {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  businessShortCode: string;
  environment: "sandbox" | "production";
}

export interface ResolvedPaymentConfig {
  rentPayment: any;
  utilityPayment: any;
  resolvedFrom: "landlord" | "org-default";
  landlordOwnerId: string | null;
  /** Present only when this landlord has their own full Daraja credentials
   *  configured — lets the caller instantiate a properly-paired
   *  MPesaService via createMPesaServiceForOverrides() rather than falling
   *  back to the server's single env-var credential set. */
  mpesaCredentials: ResolvedMpesaCredentials | null;
}

const DEFAULT_ACCOUNT_SHAPE = {
  mpesaPaybill: "",
  mpesaTill: "",
  mpesaAccountName: "",
  bankName: "",
  bankAccountNumber: "",
  bankAccountName: "",
  bankBranch: "",
  instructions: "",
};

async function getOrgDefault(orgId: number) {
  const [settings] = await db
    .select({ paymentSettings: organizationSettings.paymentSettings })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  const paymentSettings = (settings?.paymentSettings as any) ?? {};
  const serverShortcode = process.env.MPESA_BUSINESS_SHORTCODE ?? "";

  return {
    rentPayment: paymentSettings.rentPayment ?? { useSingleAccount: true, ...DEFAULT_ACCOUNT_SHAPE, mpesaPaybill: serverShortcode },
    utilityPayment: paymentSettings.utilityPayment ?? { sameAsRent: true, ...DEFAULT_ACCOUNT_SHAPE, mpesaPaybill: serverShortcode },
  };
}

/** Resolve by tenantId directly (used when the caller already knows it, e.g. mpesa-actions.ts). */
export async function resolvePaymentConfigForTenantId(tenantId: number, orgId: number): Promise<ResolvedPaymentConfig> {
  const [tenant] = await db
    .select({ unitId: tenants.unitId })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, orgId)))
    .limit(1);

  return resolveFromUnitId(tenant?.unitId ?? null, orgId);
}

/** Resolve by the tenant's own userId (used for the JWT-authenticated tenant-facing endpoint). */
export async function resolvePaymentConfigForTenantUser(userId: string, orgId: number): Promise<ResolvedPaymentConfig> {
  const [tenant] = await db
    .select({ unitId: tenants.unitId })
    .from(tenants)
    .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, orgId)))
    .limit(1);

  return resolveFromUnitId(tenant?.unitId ?? null, orgId);
}

async function resolveFromUnitId(unitId: number | null, orgId: number): Promise<ResolvedPaymentConfig> {
  let ownerId: string | null = null;

  if (unitId != null) {
    const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId)).limit(1);
    if (unit?.propertyId) {
      const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unit.propertyId)).limit(1);
      ownerId = prop?.ownerId ?? null;
    }
  }

  if (ownerId) {
    const [override] = await db
      .select({
        rentPayment: landlordPaymentSettings.rentPayment,
        utilityPayment: landlordPaymentSettings.utilityPayment,
        mpesaConsumerKey: landlordPaymentSettings.mpesaConsumerKey,
        mpesaConsumerSecretEncrypted: landlordPaymentSettings.mpesaConsumerSecretEncrypted,
        mpesaPasskeyEncrypted: landlordPaymentSettings.mpesaPasskeyEncrypted,
        mpesaEnvironment: landlordPaymentSettings.mpesaEnvironment,
      })
      .from(landlordPaymentSettings)
      .where(and(eq(landlordPaymentSettings.organizationId, orgId), eq(landlordPaymentSettings.ownerId, ownerId)))
      .limit(1);

    if (override) {
      const rentPayment = override.rentPayment ?? { useSingleAccount: true, ...DEFAULT_ACCOUNT_SHAPE };

      // Only treat this landlord as having real STK Push credentials if all
      // three secret/key pieces are present — a landlord who's only entered
      // a Paybill number for manual-payment display doesn't have these.
      let mpesaCredentials: ResolvedMpesaCredentials | null = null;
      const shortCode = (rentPayment as any)?.mpesaPaybill || (rentPayment as any)?.mpesaTill;
      if (override.mpesaConsumerKey && override.mpesaConsumerSecretEncrypted && override.mpesaPasskeyEncrypted && shortCode) {
        try {
          mpesaCredentials = {
            consumerKey: override.mpesaConsumerKey,
            consumerSecret: decryptSecret(override.mpesaConsumerSecretEncrypted),
            passkey: decryptSecret(override.mpesaPasskeyEncrypted),
            businessShortCode: shortCode,
            environment: (override.mpesaEnvironment as "sandbox" | "production") ?? "production",
          };
        } catch (err) {
          // Decryption failure (e.g. key rotated without re-encrypting) —
          // fail safe to manual-payment-only for this landlord rather than
          // throwing and breaking the whole payment page.
          console.error(`[resolvePaymentConfig] Failed to decrypt Daraja credentials for landlord ${ownerId}:`, err);
        }
      }

      return {
        rentPayment,
        utilityPayment: override.utilityPayment ?? { sameAsRent: true, ...DEFAULT_ACCOUNT_SHAPE },
        resolvedFrom: "landlord",
        landlordOwnerId: ownerId,
        mpesaCredentials,
      };
    }
  }

  const orgDefault = await getOrgDefault(orgId);
  return { ...orgDefault, resolvedFrom: "org-default", landlordOwnerId: ownerId, mpesaCredentials: null };
}