/**
 * regulatory-certs-migration.ts
 *
 * Idempotent migration that creates the regulatory_certificates table.
 * All DDL uses IF NOT EXISTS — safe to call every startup.
 *
 * Called automatically from server/index.ts on startup.
 */

import { db }  from "../db";
import { sql } from "drizzle-orm";

const log = (msg: string) => console.log(`[reg-certs-migration] ${msg}`);

export async function runRegulatoryCertsMigration(): Promise<void> {
  try {
    log("Ensuring regulatory_certificates table exists...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS regulatory_certificates (
        id                  serial PRIMARY KEY,
        organization_id     integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        property_id         integer NOT NULL REFERENCES properties(id)    ON DELETE CASCADE,

        authority           varchar(20)  NOT NULL DEFAULT 'NEMA',
        certificate_type    varchar(60)  NOT NULL,
        certificate_number  varchar(100),
        title               varchar(255) NOT NULL,

        project_id          integer REFERENCES projects(id) ON DELETE SET NULL,

        issue_date          date,
        expiry_date         date,
        renewal_date        date,

        status              varchar(30) NOT NULL DEFAULT 'active',

        issuing_officer     varchar(150),
        issuing_office      varchar(200),

        conditions          text,
        notes               text,

        document_url        varchar(500),

        alert_90_sent       boolean DEFAULT false,
        alert_60_sent       boolean DEFAULT false,
        alert_30_sent       boolean DEFAULT false,
        alert_7_sent        boolean DEFAULT false,

        created_by          varchar REFERENCES users(id),
        created_at          timestamp DEFAULT NOW(),
        updated_at          timestamp DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reg_certs_property_idx
        ON regulatory_certificates(property_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reg_certs_org_idx
        ON regulatory_certificates(organization_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reg_certs_authority_idx
        ON regulatory_certificates(authority)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reg_certs_expiry_idx
        ON regulatory_certificates(expiry_date)
        WHERE expiry_date IS NOT NULL AND status = 'active'
    `);

    log("regulatory_certificates table ready.");
  } catch (err: any) {
    // Non-fatal — log and continue. The route handlers will surface errors
    // if the table genuinely doesn't exist.
    console.error("[reg-certs-migration] Migration failed:", err.message);
    // Log additional PG error detail when available (code, detail, hint, query)
    if (err.code)   console.error("[reg-certs-migration]   PG code:", err.code);
    if (err.detail) console.error("[reg-certs-migration]   detail: ", err.detail);
    if (err.hint)   console.error("[reg-certs-migration]   hint:   ", err.hint);
  }
}