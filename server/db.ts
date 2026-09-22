/**
 * db.ts — Database connection
 *
 * Uses @neondatabase/serverless with the WebSocket driver.
 *
 * WHY NOT neon-http / drizzle-orm/neon-http:
 *   The HTTP driver is designed for edge/serverless environments (Cloudflare
 *   Workers, Vercel Edge Functions) where a persistent TCP connection is
 *   impossible. In a long-running Node.js Express server it makes a fresh
 *   HTTP round-trip to Neon's proxy for every single query, adding ~50-200 ms
 *   of overhead per request and providing no connection pooling or multi-
 *   statement transaction support.
 *
 * The WebSocket driver (@neondatabase/serverless + ws) maintains a persistent
 * connection, supports connection pooling, and enables proper transactions.
 * It's the recommended driver for Node.js servers connecting to Neon.
 */

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "../shared/schema";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to configure your .env file?"
  );
}

// Required for the WebSocket driver in a Node.js environment
neonConfig.webSocketConstructor = ws;

// Connection pool: 10 connections for a single Express server instance.
//
// keepAlive / keepAliveInitialDelayMillis (below) replace what used to be
// set via neonConfig.keepAlive / neonConfig.keepAliveIntervalMs — those
// properties don't exist on neonConfig in @neondatabase/serverless v1.x
// (they were silently doing nothing — TCP keep-alive belongs on the Pool's
// PoolConfig, not the WebSocket driver config). Without this, Neon's proxy
// can close idle connections and the next query gets a "WebSocket was
// closed before the connection was established" timeout error.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "10"),
  idleTimeoutMillis:           60_000, // keep idle connections alive for 60 s
  connectionTimeoutMillis:     15_000, // 15 s — accounts for Neon cold starts (was 5 s)
  keepAlive:                   true,
  keepAliveInitialDelayMillis: 60_000, // ping every 60 s
});

// ── Retry wrapper ─────────────────────────────────────────────────────────────
// Neon serverless sometimes drops WebSocket connections under load or after idle
// periods. This wrapper retries transient connection errors up to 3 times with
// exponential back-off so individual requests don't surface 500s on the first
// failed attempt.
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 200;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      const isTransient =
        msg.includes("Connection terminated") ||
        msg.includes("WebSocket was closed") ||
        msg.includes("connection timeout") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT");
      if (!isTransient || attempt === MAX_RETRIES - 1) throw e;
      lastErr = e;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      console.warn(`[db] transient error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay} ms:`, msg);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export { withRetry };

export const db  = drizzle(pool, { schema });
// Export pool for raw queries when needed
export { pool };
// Legacy export name kept for backward compatibility with any code using `sql` tag
export const sql = pool;