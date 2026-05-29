-- Migration: add_utility_bill_tenant_link
-- 
-- Fixes the usability gap where utility bills sent by managers via email were not
-- visible to tenants in the portal. The utility_bills table previously required
-- a utility_account_id (accountId) which many units in Nairobi high-rises don't
-- have (shared KPLC / water meters, manager-managed).
--
-- Changes:
--   1. Make account_id nullable (bills can now exist without a utility account row)
--   2. Add tenant_id column for direct tenant lookup from the portal
--   3. Add utility_type column (water, electricity, gas, internet, other) so
--      bills fetched without an account still carry the type label
--   4. Back-fill tenant_id via utility_accounts → units → tenants for existing rows

-- 1. Make account_id nullable
ALTER TABLE utility_bills
  ALTER COLUMN account_id DROP NOT NULL;

-- 2. Add tenant_id (FK to tenants, nullable for backward compat)
ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL;

-- 3. Add utility_type column
ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS utility_type VARCHAR;

-- 4. Back-fill tenant_id for existing bills that have an account_id
UPDATE utility_bills ub
SET tenant_id = t.id
FROM utility_accounts ua
JOIN units u ON ua.unit_id = u.id
JOIN tenants t ON t.unit_id = u.id
WHERE ub.account_id = ua.id
  AND ub.tenant_id IS NULL
  AND t.status = 'active';

-- 5. Index for fast tenant portal lookups
CREATE INDEX IF NOT EXISTS idx_utility_bills_tenant_id ON utility_bills(tenant_id);
