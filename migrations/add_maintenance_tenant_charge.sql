-- Charge-back of a repair to the tenant. All columns are nullable / defaulted: existing rows are untouched.
-- Run this BEFORE deploying the code that references these columns.
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS charge_tenant boolean DEFAULT false;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS tenant_charge_amount numeric(10,2);
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS tenant_charge_reason text;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS tenant_charge_bill_id integer;
