-- ============================================================
-- Commercial / Non-Residential Property Support
-- Adds property/unit type classification, sqft-based and
-- percentage (turnover) rent, and pro-rata-by-sqft service
-- charge (CAM) allocation — needed to properly model malls,
-- office blocks, and other commercial space alongside the
-- existing residential letting model.
--
-- Every column below has a default that matches prior behaviour,
-- so existing residential properties/units/leases are completely
-- unaffected until someone explicitly picks a non-residential type.
-- ============================================================

-- ─── properties ────────────────────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS property_type varchar NOT NULL DEFAULT 'residential';

-- ─── units ─────────────────────────────────────────────────────────────────

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS unit_type     varchar NOT NULL DEFAULT 'apartment',
  ADD COLUMN IF NOT EXISTS rent_basis    varchar NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS rate_per_sqft numeric(10,2);

-- ─── leases ────────────────────────────────────────────────────────────────

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS rent_structure       varchar NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS percentage_rent_rate numeric(5,4);

-- ─── service_charge_budgets (CAM budget) ────────────────────────────────────

ALTER TABLE service_charge_budgets
  ADD COLUMN IF NOT EXISTS allocation_method varchar NOT NULL DEFAULT 'equal_split';

-- ─── service_charge_demands (CAM billing, per unit) ─────────────────────────

ALTER TABLE service_charge_demands
  ADD COLUMN IF NOT EXISTS allocation_method varchar NOT NULL DEFAULT 'equal_split',
  ADD COLUMN IF NOT EXISTS allocated_sqft    integer,
  ADD COLUMN IF NOT EXISTS total_sqft        integer;

-- ─── sanity constraints (Postgres has no native enum-via-varchar check
--     unless declared as CHECK; add them so bad values fail loudly rather
--     than silently mis-billing) ───────────────────────────────────────────

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_property_type_check,
  ADD  CONSTRAINT properties_property_type_check
       CHECK (property_type IN ('residential', 'commercial', 'mixed_use'));

ALTER TABLE units
  DROP CONSTRAINT IF EXISTS units_unit_type_check,
  ADD  CONSTRAINT units_unit_type_check
       CHECK (unit_type IN ('apartment','house','office','retail','kiosk','anchor_retail','warehouse','parking','storage','other')),
  DROP CONSTRAINT IF EXISTS units_rent_basis_check,
  ADD  CONSTRAINT units_rent_basis_check
       CHECK (rent_basis IN ('fixed','per_sqft','percentage_of_sales'));

ALTER TABLE leases
  DROP CONSTRAINT IF EXISTS leases_rent_structure_check,
  ADD  CONSTRAINT leases_rent_structure_check
       CHECK (rent_structure IN ('fixed','percentage_of_sales','base_plus_percentage'));

ALTER TABLE service_charge_budgets
  DROP CONSTRAINT IF EXISTS service_charge_budgets_allocation_method_check,
  ADD  CONSTRAINT service_charge_budgets_allocation_method_check
       CHECK (allocation_method IN ('equal_split','pro_rata_sqft'));

ALTER TABLE service_charge_demands
  DROP CONSTRAINT IF EXISTS service_charge_demands_allocation_method_check,
  ADD  CONSTRAINT service_charge_demands_allocation_method_check
       CHECK (allocation_method IN ('equal_split','pro_rata_sqft'));