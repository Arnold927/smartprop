/**
 * notification-migration.ts
 *
 * Adds whatsapp_notifications and rent_due_warning_days columns to
 * user_notification_preferences so tenants can control:
 *   - Whether they receive WhatsApp notifications (default: true)
 *   - How many days before rent is due to receive a warning (default: 3)
 *
 * Run once:
 *   npx tsx server/services/notification-migration.ts
 */

import { db }  from "../db";
import { sql } from "drizzle-orm";

const log = (msg: string) => console.log(`[notification-migration] ${msg}`);

async function run(): Promise<void> {
  log("Adding whatsapp_notifications to user_notification_preferences...");
  await db.execute(sql`
    ALTER TABLE user_notification_preferences
      ADD COLUMN IF NOT EXISTS whatsapp_notifications BOOLEAN DEFAULT true
  `);

  log("Adding rent_due_warning_days...");
  await db.execute(sql`
    ALTER TABLE user_notification_preferences
      ADD COLUMN IF NOT EXISTS rent_due_warning_days INTEGER DEFAULT 3
  `);

  // Also add phone column to tenants if not present (some rows may be null)
  // The column exists in schema but may be null — that's fine, we skip null phones
  log("Ensuring tenants.phone is present...");
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'phone'
      ) THEN
        ALTER TABLE tenants ADD COLUMN phone VARCHAR;
      END IF;
    END $$
  `);

  log("Migration complete.");
}

run()
  .then(() => process.exit(0))
  .catch(err => { console.error("[notification-migration] Fatal:", err); process.exit(1); });
