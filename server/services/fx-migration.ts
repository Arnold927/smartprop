/**
 * fx-migration.ts
 *
 * Adds:
 *   1. fx_rate_cache table with unique index on (from_currency, to_currency)
 *   2. Disbursement columns on diaspora_payments:
 *        mid_market_rate, spread_pct, kes_disbursed,
 *        disbursement_ref, disbursed_at, fx_source
 *
 * Run once:
 *   npx tsx server/services/fx-migration.ts
 *
 * Safe to re-run — all DDL is idempotent.
 */

import { db }  from "../db";
import { sql } from "drizzle-orm";

const log = (msg: string) => console.log(`[fx-migration] ${msg}`);

async function run(): Promise<void> {

  // ── fx_rate_cache ────────────────────────────────────────────────────────
  log("Creating fx_rate_cache table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fx_rate_cache (
      id              SERIAL PRIMARY KEY,
      from_currency   VARCHAR(3) NOT NULL,
      to_currency     VARCHAR(3) NOT NULL,
      mid_market_rate DECIMAL(16,6) NOT NULL,
      source          VARCHAR(50) NOT NULL DEFAULT 'frankfurter',
      fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL
    )
  `);

  // Unique index enables ON CONFLICT upsert in fxService
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fx_cache_pair
    ON fx_rate_cache (from_currency, to_currency)
  `);

  log("fx_rate_cache ready.");

  // ── diaspora_payments disbursement columns ─────────────────────────────
  log("Adding disbursement columns to diaspora_payments...");

  const cols: [string, string][] = [
    ["mid_market_rate",  "DECIMAL(16,6)"],
    ["spread_pct",       "DECIMAL(8,4)"],
    ["kes_disbursed",    "DECIMAL(12,2)"],
    ["disbursement_ref", "VARCHAR(100)"],
    ["disbursed_at",     "TIMESTAMPTZ"],
    ["fx_source",        "VARCHAR(50)"],
  ];

  for (const [col, type] of cols) {
    await db.execute(
      { sql: `
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'diaspora_payments' AND column_name = '${col}'
          ) THEN
            ALTER TABLE diaspora_payments ADD COLUMN ${col} ${type};
            RAISE NOTICE 'Added ${col}';
          ELSE
            RAISE NOTICE '${col} already exists — skipping';
          END IF;
        END $$;
      `, params: [] } as any
    );
  }

  log("diaspora_payments schema updated.");
  log("Migration complete.");
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error("[fx-migration] Fatal:", err); process.exit(1); });
