/**
 * mpesa-setup.ts
 *
 * Two things in one file:
 *
 * 1. Database migration — adds paidAmount and balanceDue columns to
 *    rent_payments so partial payment state is stored durably, not
 *    recomputed from mpesa_transactions every time.
 *
 * 2. Safaricom C2B URL registration — registers your ConfirmationURL
 *    and ValidationURL with Safaricom so direct paybill/till payments
 *    trigger your C2B webhooks.
 *
 * Run once after deploying the updated codebase:
 *   npx tsx server/services/mpesa-setup.ts
 *
 * Safe to run multiple times — the migration is idempotent (checks for
 * column existence before adding).
 */

import { db }          from '../db';
import { sql }         from 'drizzle-orm';
import { getMPesaService } from './mpesa';
import axios           from 'axios';

const log = (msg: string) => console.log(`[mpesa-setup] ${msg}`);

// ─── 1. Database migration ────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  log('Running rent_payments schema migration...');

  // paid_amount: total amount received against this invoice so far
  // balance_due: invoiceAmount - paidAmount (can be negative if overpaid)
  // These are DENORMALISED for query performance. They are kept in sync by
  // the reconcilePayment function in mpesa-actions.ts and mpesaSweep.ts.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rent_payments' AND column_name = 'paid_amount'
      ) THEN
        ALTER TABLE rent_payments
          ADD COLUMN paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00;
        RAISE NOTICE 'Added paid_amount column';
      ELSE
        RAISE NOTICE 'paid_amount column already exists — skipping';
      END IF;
    END$$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rent_payments' AND column_name = 'balance_due'
      ) THEN
        ALTER TABLE rent_payments
          ADD COLUMN balance_due DECIMAL(10,2) GENERATED ALWAYS AS (amount - paid_amount) STORED;
        RAISE NOTICE 'Added balance_due computed column';
      ELSE
        RAISE NOTICE 'balance_due column already exists — skipping';
      END IF;
    END$$;
  `);

  // Back-fill paid_amount for already-paid invoices so existing data is consistent
  await db.execute(sql`
    UPDATE rent_payments
    SET paid_amount = amount
    WHERE status = 'paid' AND paid_amount = 0;
  `);

  log('Migration complete.');
}

// ─── 2. Safaricom C2B URL registration ───────────────────────────────────────
// This must be called ONCE per environment (sandbox or production) to tell
// Safaricom where to send C2B payment notifications.
//
// Required env vars:
//   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET
//   MPESA_BUSINESS_SHORTCODE
//   MPESA_ENVIRONMENT  (sandbox | production)
//   APP_BASE_URL       (e.g. https://app.smartprop.co.ke)

async function registerC2BUrls(): Promise<void> {
  const baseAppUrl   = process.env.APP_BASE_URL;
  const shortCode    = process.env.MPESA_BUSINESS_SHORTCODE;
  const environment  = process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production' ?? 'sandbox';

  if (!baseAppUrl) {
    log('APP_BASE_URL not set — skipping C2B registration. Set it and re-run.');
    return;
  }
  if (!shortCode) {
    log('MPESA_BUSINESS_SHORTCODE not set — skipping C2B registration.');
    return;
  }

  log(`Registering C2B URLs for shortcode ${shortCode} in ${environment}...`);

  const mpesaService = getMPesaService();
  // @ts-ignore — access private method for token retrieval
  const accessToken  = await (mpesaService as any).getAccessToken();

  const baseUrl = environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const payload = {
    ShortCode:        shortCode,
    ResponseType:     'Completed',    // or 'Cancelled' — 'Completed' is standard
    ConfirmationURL:  `${baseAppUrl}/api/mpesa/c2b/confirmation`,
    ValidationURL:    `${baseAppUrl}/api/mpesa/c2b/validation`,
  };

  log(`Registering: ${JSON.stringify(payload, null, 2)}`);

  const response = await axios.post(
    `${baseUrl}/mpesa/c2b/v1/registerurl`,
    payload,
    {
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  log(`Safaricom response: ${JSON.stringify(response.data)}`);

  if (response.data?.ResponseCode === '0') {
    log('✅ C2B URLs registered successfully.');
  } else {
    log(`⚠️  Unexpected response — check the Daraja portal to confirm registration.`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await runMigration();
    await registerC2BUrls();
    log('Setup complete.');
    process.exit(0);
  } catch (err) {
    console.error('[mpesa-setup] Fatal error:', err);
    process.exit(1);
  }
}

main();
