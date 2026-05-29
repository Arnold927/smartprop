-- ============================================================
-- Compound Billing Fix Migration
-- Addresses the 5 issues identified in the billing audit:
--
--   1. serviceCharges.currency default USD → KES
--   2. rentPayments.currency default USD → KES
--   3. rentPayments gains a line_items JSONB column
--      Schema: [{description: string, amount: number, type: string}]
--   4. (No DDL change needed for recurringCharges — already KES)
--   5. (Scheduler + portal fixes are code-only — no DDL needed)
-- ============================================================

-- 1. Fix serviceCharges currency default
ALTER TABLE service_charges
  ALTER COLUMN currency SET DEFAULT 'KES';

-- Backfill existing NULL or USD rows that are clearly Kenyan
UPDATE service_charges
SET currency = 'KES'
WHERE currency IS NULL OR currency = 'USD';

-- 2. Fix rentPayments currency default
ALTER TABLE rent_payments
  ALTER COLUMN currency SET DEFAULT 'KES';

UPDATE rent_payments
SET currency = 'KES'
WHERE currency IS NULL OR currency = 'USD';

-- 3. Add line_items column to rent_payments
ALTER TABLE rent_payments
  ADD COLUMN IF NOT EXISTS line_items JSONB;

-- Backfill existing single-amount invoices with a synthetic "Monthly Rent" line item
-- so old records display consistently in the tenant portal.
UPDATE rent_payments
SET line_items = jsonb_build_array(
  jsonb_build_object(
    'description', 'Monthly Rent',
    'amount', amount::numeric,
    'type', 'rent'
  )
)
WHERE line_items IS NULL;

-- 4. Create index to speed up the unit + property recurring-charge lookup
--    used by the scheduler on every invoice generation cycle.
CREATE INDEX IF NOT EXISTS idx_recurring_charges_unit_property
  ON recurring_charges (property_id, unit_id, is_active)
  WHERE is_active = true;
