#!/usr/bin/env tsx
/**
 * scripts/migrate.ts — SmartProp migration runner
 *
 * Runs all SQL migration files in the /migrations directory in
 * deterministic order and tracks which ones have been applied in a
 * `schema_migrations` table (created automatically on first run).
 *
 * Usage:
 *   npm run db:migrate        — apply all pending migrations
 *   npm run db:migrate:status — show which migrations are applied
 *   npm run db:migrate:undo   — NOT SUPPORTED (create a forward migration instead)
 *
 * Ordering rules (in priority order):
 *   1. Files matching /^\d{4}_/ (Drizzle-generated, e.g. 0000_misty_maelstrom.sql)
 *      are applied first, in numeric order.
 *   2. All other .sql files are applied next, in alphabetical order.
 *      (Our hand-written migrations: nairobi_compliance.sql, bucket1_*.sql, etc.)
 *
 * Each migration is wrapped in a transaction. If a migration fails, the
 * runner stops and reports the error. Already-applied migrations are skipped.
 *
 * The runner is idempotent — safe to run on every deploy.
 */

import { Pool } from "@neondatabase/serverless";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set");
  process.exit(1);
}

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// ─── Ensure tracking table exists ────────────────────────────────────────────

async function ensureTrackingTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id            serial       PRIMARY KEY,
      filename      varchar(255) NOT NULL UNIQUE,
      applied_at    timestamp    NOT NULL DEFAULT now(),
      checksum      varchar(64),        -- SHA-256 of the file content
      duration_ms   integer             -- how long the migration took
    );

    -- Index for fast "is this applied?" lookups
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename
      ON schema_migrations (filename);
  `);
}

// ─── Get applied migrations ───────────────────────────────────────────────────

async function getApplied(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY applied_at"
  );
  return new Set(result.rows.map(r => r.filename));
}

// ─── Collect and sort migration files ────────────────────────────────────────

function getMigrationFiles(dir: string): string[] {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .filter(f => !f.startsWith(".")); // ignore hidden files

  // Split into Drizzle-numbered (0000_*.sql) and hand-written
  const numbered = files
    .filter(f => /^\d{4}_/.test(f))
    .sort();                              // lexicographic = numeric for 4-digit prefix

  const handWritten = files
    .filter(f => !/^\d{4}_/.test(f))
    .sort();                              // alphabetical

  return [...numbered, ...handWritten];
}

// ─── Run a single migration ───────────────────────────────────────────────────

async function runMigration(filepath: string, filename: string): Promise<void> {
  const sql      = fs.readFileSync(filepath, "utf8");
  const start    = Date.now();

  // Compute checksum
  const { createHash } = await import("crypto");
  const checksum = createHash("sha256").update(sql).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Drizzle migrations use --> statement-breakpoint as delimiter
    const statements = sql
      .split(/--> statement-breakpoint/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      if (stmt.trim()) {
        await client.query(stmt);
      }
    }

    // Record as applied
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)",
      [filename, checksum, Date.now() - start]
    );

    await client.query("COMMIT");
    console.log(`  ✓ ${filename} (${Date.now() - start}ms)`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

// ─── Status command ───────────────────────────────────────────────────────────

async function status(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, "..", "migrations");
  const allFiles      = getMigrationFiles(migrationsDir);
  const applied       = await getApplied();

  console.log("\nMigration status:");
  console.log("─".repeat(60));

  for (const file of allFiles) {
    const state = applied.has(file) ? "✓ applied" : "○ pending";
    console.log(`  ${state.padEnd(12)} ${file}`);
  }

  const pending = allFiles.filter(f => !applied.has(f));
  console.log("─".repeat(60));
  console.log(`Total: ${allFiles.length} files, ${applied.size} applied, ${pending.length} pending\n`);
}

// ─── Main: apply pending migrations ──────────────────────────────────────────

async function migrate(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, "..", "migrations");
  const allFiles      = getMigrationFiles(migrationsDir);

  await ensureTrackingTable();
  const applied = await getApplied();

  const pending = allFiles.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log("✓ Database is up to date — no pending migrations.");
    return;
  }

  console.log(`\nApplying ${pending.length} pending migration${pending.length !== 1 ? "s" : ""}...\n`);

  for (const file of pending) {
    const filepath = path.join(migrationsDir, file);
    await runMigration(filepath, file);
  }

  console.log(`\n✓ All migrations applied successfully.\n`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const command = process.argv[2] ?? "migrate";

(async () => {
  try {
    if (command === "status") {
      await status();
    } else {
      await migrate();
    }
  } catch (err: any) {
    console.error(`\n✗ Migration failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
