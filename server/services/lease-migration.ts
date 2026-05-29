/**
 * lease-migration.ts
 *
 * Idempotent migration that creates the three lease-lifecycle tables:
 *   leases               — canonical lease record per tenancy
 *   lease_events         — append-only audit trail
 *   deposit_transactions — deposit ledger
 *
 * Also back-fills a `leases` row for every currently active tenant that
 * has leaseStartDate set, so existing data is immediately visible in the
 * new UI without requiring a data-entry pass.
 *
 * Run once after deploying:
 *   npx tsx server/services/lease-migration.ts
 *
 * Safe to re-run — all DDL uses IF NOT EXISTS.
 */

import { db }  from "../db";
import { sql } from "drizzle-orm";
import { tenants, units, properties } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";

const log = (msg: string) => console.log(`[lease-migration] ${msg}`);

async function createTables(): Promise<void> {
  log("Creating leases table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS leases (
      id                          SERIAL PRIMARY KEY,
      organization_id             INTEGER NOT NULL REFERENCES organizations(id),
      tenant_id                   INTEGER NOT NULL REFERENCES tenants(id),
      unit_id                     INTEGER REFERENCES units(id),
      property_id                 INTEGER REFERENCES properties(id),

      lease_number                VARCHAR(30) NOT NULL UNIQUE,
      previous_lease_id           INTEGER REFERENCES leases(id),

      start_date                  DATE NOT NULL,
      end_date                    DATE NOT NULL,
      lease_duration_months       INTEGER NOT NULL DEFAULT 12,

      monthly_rent                DECIMAL(12,2) NOT NULL,
      currency                    VARCHAR(3)  NOT NULL DEFAULT 'KES',
      security_deposit            DECIMAL(12,2) NOT NULL DEFAULT 0,
      deposit_paid_date           DATE,

      escalation_rate             DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
      escalation_frequency_months INTEGER NOT NULL DEFAULT 12,

      status                      VARCHAR(30) NOT NULL DEFAULT 'draft',

      signed_by_tenant_at         TIMESTAMPTZ,
      signed_by_manager_at        TIMESTAMPTZ,
      tenant_signature_ip         VARCHAR(45),
      manager_signature_ip        VARCHAR(45),

      renewal_notice_30_sent      BOOLEAN DEFAULT FALSE,
      renewal_notice_60_sent      BOOLEAN DEFAULT FALSE,
      renewal_notice_90_sent      BOOLEAN DEFAULT FALSE,

      document_url                VARCHAR(500),
      special_conditions          TEXT,
      notes                       TEXT,

      created_by                  UUID REFERENCES users(id),
      created_at                  TIMESTAMPTZ DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  log("Creating lease_events table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lease_events (
      id              SERIAL PRIMARY KEY,
      lease_id        INTEGER NOT NULL REFERENCES leases(id),
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),

      event_type      VARCHAR(50) NOT NULL,
      description     TEXT NOT NULL,
      performed_by    UUID REFERENCES users(id),
      metadata        JSONB DEFAULT '{}',

      ip_address      VARCHAR(45),
      created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);

  log("Creating deposit_transactions table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS deposit_transactions (
      id               SERIAL PRIMARY KEY,
      lease_id         INTEGER NOT NULL REFERENCES leases(id),
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
      organization_id  INTEGER NOT NULL REFERENCES organizations(id),

      transaction_type VARCHAR(30) NOT NULL,
      amount           DECIMAL(12,2) NOT NULL,
      currency         VARCHAR(3) NOT NULL DEFAULT 'KES',
      balance_after    DECIMAL(12,2) NOT NULL,

      reason           TEXT,
      reference        VARCHAR(100),
      performed_by     UUID REFERENCES users(id),

      transaction_date DATE NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Neon HTTP driver rejects multiple statements in one call — one execute per index.
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_leases_tenant_id       ON leases(tenant_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_leases_organization_id ON leases(organization_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_leases_status          ON leases(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_leases_end_date        ON leases(end_date)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_lease_events_lease_id  ON lease_events(lease_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_deposit_txn_lease_id   ON deposit_transactions(lease_id)`);

  log("Tables created.");
}

async function backfillFromTenants(): Promise<void> {
  log("Back-filling leases from existing active tenants...");

  // Find tenants with a lease start date but no corresponding lease row
  const activeTenants = await db
    .select({
      id:             tenants.id,
      organizationId: tenants.organizationId,
      unitId:         tenants.unitId,
      firstName:      tenants.firstName,
      lastName:       tenants.lastName,
      leaseStartDate: tenants.leaseStartDate,
      leaseEndDate:   tenants.leaseEndDate,
      monthlyRent:    tenants.monthlyRent,
      securityDeposit:tenants.securityDeposit,
      currency:       tenants.currency,
    })
    .from(tenants)
    .where(and(eq(tenants.status, "active"), isNotNull(tenants.leaseStartDate)));

  let created = 0;
  let skipped = 0;

  for (const tenant of activeTenants) {
    // Check if a lease row already exists for this tenant
    const existing = await db.execute(sql`
      SELECT id FROM leases WHERE tenant_id = ${tenant.id} LIMIT 1
    `);
    if ((existing.rows ?? existing).length > 0) { skipped++; continue; }

    // Resolve property from unit
    let propertyId: number | null = null;
    if (tenant.unitId) {
      const unitRows = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(eq(units.id, tenant.unitId))
        .limit(1);
      propertyId = unitRows[0]?.propertyId ?? null;
    }

    const leaseNumber = `LSE-MIGR-${tenant.id.toString().padStart(4, "0")}`;
    const startDate   = tenant.leaseStartDate ?? new Date().toISOString().split("T")[0];
    const endDate     = tenant.leaseEndDate
      ?? new Date(new Date(startDate).setFullYear(new Date(startDate).getFullYear() + 1))
           .toISOString().split("T")[0];

    await db.execute(sql`
      INSERT INTO leases (
        organization_id, tenant_id, unit_id, property_id,
        lease_number, start_date, end_date,
        monthly_rent, currency, security_deposit,
        status, notes,
        created_at, updated_at
      ) VALUES (
        ${tenant.organizationId}, ${tenant.id}, ${tenant.unitId}, ${propertyId},
        ${leaseNumber}, ${startDate}, ${endDate},
        ${tenant.monthlyRent ?? "0"}, ${tenant.currency ?? "KES"}, ${tenant.securityDeposit ?? "0"},
        'active', 'Migrated from tenant record',
        NOW(), NOW()
      )
    `);

    // Record the migration as a lease event
    const leaseRows = await db.execute(sql`
      SELECT id FROM leases WHERE lease_number = ${leaseNumber} LIMIT 1
    `);
    const leaseId = (leaseRows.rows ?? leaseRows)[0]?.id;

    if (leaseId) {
      await db.execute(sql`
        INSERT INTO lease_events (lease_id, tenant_id, organization_id, event_type, description, created_at)
        VALUES (${leaseId}, ${tenant.id}, ${tenant.organizationId}, 'activated',
                'Lease migrated from tenant record during system upgrade', NOW())
      `);

      // If deposit was set, record it in the deposit ledger
      if (tenant.securityDeposit && Number(tenant.securityDeposit) > 0) {
        await db.execute(sql`
          INSERT INTO deposit_transactions (
            lease_id, tenant_id, organization_id,
            transaction_type, amount, currency, balance_after,
            reason, transaction_date, created_at
          ) VALUES (
            ${leaseId}, ${tenant.id}, ${tenant.organizationId},
            'received', ${tenant.securityDeposit}, ${tenant.currency ?? "KES"}, ${tenant.securityDeposit},
            'Security deposit — migrated from tenant record',
            ${startDate}, NOW()
          )
        `);
      }
    }

    created++;
  }

  log(`Back-fill complete: ${created} leases created, ${skipped} already existed.`);
}

async function main() {
  try {
    await createTables();
    await backfillFromTenants();
    log("Migration complete.");
    process.exit(0);
  } catch (err) {
    console.error("[lease-migration] Fatal error:", err);
    process.exit(1);
  }
}

main();