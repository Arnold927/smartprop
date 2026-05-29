#!/usr/bin/env node
/**
 * scripts/migrate.js
 *
 * Runs all SmartProp database migrations in the correct dependency order.
 * Safe to run multiple times — every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 *
 * Usage:
 *   node scripts/migrate.js
 *   # or with a custom DATABASE_URL:
 *   DATABASE_URL=postgresql://... node scripts/migrate.js
 *
 * What it does:
 *   1. Creates a migrations_log table to track which files have already run.
 *   2. Runs each SQL file in dependency order, skipping already-applied ones.
 *   3. Exits with code 0 on success, code 1 on any failure (safe for CI).
 *
 * Dependency order (do NOT reorder — later files reference tables created earlier):
 *   0000_misty_maelstrom.sql  — base schema (all core tables + enums)
 *   bucket1_revenue_blockers   — PM agreements, owner statements, rent-to-own
 *   bucket2_security           — refresh tokens, audit tables
 *   bucket3_esg                — ESG / sustainability tables
 *   add_caretaker_role         — adds 'caretaker' enum value to user roles
 *   add_bank_reconciliation    — bank statement import + reconciliation tables
 *   nairobi_compliance         — KRA, stamp duty, ARMA, CBK interest tables
 *   regulatory_certificates    — NEMA/NCA certificate table
 *   add_tenant_subletting      — short-term rental + booking tables
 *   add_diaspora_buyer_user_id — diaspora_contracts.buyer_user_id column
 *   add_arrears_organization_id— arrears.organization_id column
 *   add_mpesa_utility_bill_link— mpesa_transactions.utility_bill_id column
 *   add_utility_bill_tenant_link— utility_bills.tenant_id column
 *   add_whatsapp_direction     — whatsapp_messages.direction column
 *   fix_compound_billing       — billing edge-case fixes
 */

const { Client } = require("pg");
const fs         = require("fs");
const path       = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const MIGRATION_ORDER = [
  "0000_misty_maelstrom.sql",
  "bucket1_revenue_blockers.sql",
  "bucket2_security.sql",
  "bucket3_esg.sql",
  "add_caretaker_role.sql",
  "add_bank_reconciliation.sql",
  "nairobi_compliance.sql",
  "regulatory_certificates.sql",
  "add_tenant_subletting.sql",
  "add_diaspora_buyer_user_id.sql",
  "add_arrears_organization_id.sql",
  "add_mpesa_utility_bill_link.sql",
  "add_utility_bill_tenant_link.sql",
  "add_whatsapp_direction.sql",
  "fix_compound_billing.sql",
];

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌  DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log("✔  Connected to database.\n");

  try {
    // Create tracking table (idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL UNIQUE,
        applied_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Fetch already-applied migrations
    const { rows } = await client.query("SELECT filename FROM migrations_log");
    const applied  = new Set(rows.map((r) => r.filename));

    let ranCount = 0;
    let skipCount = 0;

    for (const filename of MIGRATION_ORDER) {
      if (applied.has(filename)) {
        console.log(`  ⏭  skip  ${filename}`);
        skipCount++;
        continue;
      }

      const filepath = path.join(MIGRATIONS_DIR, filename);
      if (!fs.existsSync(filepath)) {
        console.warn(`  ⚠   missing file: ${filename} — skipping`);
        continue;
      }

      const sql = fs.readFileSync(filepath, "utf8")
        // Drizzle-kit uses "--> statement-breakpoint" as a separator; strip it
        .replace(/--> statement-breakpoint/g, "");

      console.log(`  ▶   running ${filename}…`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO migrations_log (filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`  ✔   done    ${filename}`);
        ranCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`\n❌  Migration failed: ${filename}`);
        console.error(err.message);
        console.error("\nDatabase rolled back to pre-migration state. Fix the error above and re-run.");
        process.exit(1);
      }
    }

    console.log(`\n✅  Migrations complete — ${ranCount} applied, ${skipCount} skipped.`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
