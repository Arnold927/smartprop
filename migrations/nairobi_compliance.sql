-- ============================================================
-- Nairobi Mid-to-High-End Market Compliance Migration
-- Adds schema for:
--   1. ARMA service charge accounting (fixed/variable split, sinking fund)
--   2. KRA compliance (landlord PIN, withholding tax, VAT flag)
--   3. Lease stamp duty tracking
--   4. Property valuation history
--   5. Security deposit interest accrual
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. SERVICE CHARGE ACCOUNTING (ARMA-COMPLIANT)
-- ─────────────────────────────────────────────────────────────

-- Patch existing service_charges table with ARMA fields
ALTER TABLE service_charges
  ADD COLUMN IF NOT EXISTS organization_id  integer REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS charge_category  varchar(30)  DEFAULT 'fixed',
  -- fixed | variable | sinking_fund
  ADD COLUMN IF NOT EXISTS budget_amount    numeric(12,2),   -- annual budgeted amount
  ADD COLUMN IF NOT EXISTS apportionment    varchar(20)  DEFAULT 'equal',
  -- equal | floor_area | unit_type | shares
  ADD COLUMN IF NOT EXISTS ledger_code      varchar(20),     -- ARMA chart-of-accounts code
  ADD COLUMN IF NOT EXISTS demand_notice_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS demand_notice_date  date,
  ADD COLUMN IF NOT EXISTS financial_year_start month_int CHECK (financial_year_start BETWEEN 1 AND 12);

-- Drop the CHECK constraint if the domain doesn't exist, use integer instead
ALTER TABLE service_charges
  DROP COLUMN IF EXISTS financial_year_start;
ALTER TABLE service_charges
  ADD COLUMN IF NOT EXISTS financial_year_start integer DEFAULT 1 CHECK (financial_year_start BETWEEN 1 AND 12);

-- Service charge budget per property per financial year (ARMA annual budget requirement)
CREATE TABLE IF NOT EXISTS service_charge_budgets (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  property_id      integer NOT NULL REFERENCES properties(id),
  financial_year   integer NOT NULL,                    -- e.g. 2025
  fy_start_month   integer NOT NULL DEFAULT 1,          -- 1=Jan, 4=Apr, 7=Jul, 10=Oct
  total_budget     numeric(12,2) NOT NULL DEFAULT 0,
  -- Split as ARMA requires separate visibility
  fixed_budget     numeric(12,2) NOT NULL DEFAULT 0,    -- lift, security, landscaping (predictable)
  variable_budget  numeric(12,2) NOT NULL DEFAULT 0,    -- electricity, water (metered)
  sinking_fund_budget numeric(12,2) NOT NULL DEFAULT 0, -- major repairs reserve
  -- Actuals (updated by triggers or nightly job)
  fixed_actual     numeric(12,2) NOT NULL DEFAULT 0,
  variable_actual  numeric(12,2) NOT NULL DEFAULT 0,
  sinking_fund_actual numeric(12,2) NOT NULL DEFAULT 0,
  status           varchar(20) DEFAULT 'draft',         -- draft | approved | closed
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamp,
  notes            text,
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now(),
  UNIQUE (property_id, financial_year)
);

-- Sinking fund ledger (separate pot per ARMA rules)
CREATE TABLE IF NOT EXISTS sinking_fund_transactions (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  property_id      integer NOT NULL REFERENCES properties(id),
  transaction_date date NOT NULL,
  transaction_type varchar(30) NOT NULL,  -- contribution | expenditure | interest | adjustment
  amount           numeric(12,2) NOT NULL,
  balance_after    numeric(12,2) NOT NULL,
  description      text NOT NULL,
  reference        varchar(100),
  approved_by      uuid REFERENCES users(id),
  created_at       timestamp DEFAULT now()
);

-- Per-unit service charge demand notices (ARMA requires formal demand)
CREATE TABLE IF NOT EXISTS service_charge_demands (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  property_id      integer NOT NULL REFERENCES properties(id),
  unit_id          integer REFERENCES units(id),
  tenant_id        integer REFERENCES tenants(id),
  demand_number    varchar(30) NOT NULL UNIQUE,         -- SCN-2025-001
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  fixed_amount     numeric(12,2) NOT NULL DEFAULT 0,
  variable_amount  numeric(12,2) NOT NULL DEFAULT 0,
  sinking_fund_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount     numeric(12,2) NOT NULL,
  due_date         date NOT NULL,
  status           varchar(20) DEFAULT 'pending',       -- pending | paid | partial | overdue
  paid_amount      numeric(12,2) DEFAULT 0,
  paid_date        date,
  notes            text,
  created_at       timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_budgets_property_fy ON service_charge_budgets (property_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_sinking_fund_property   ON sinking_fund_transactions (property_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_sc_demands_unit         ON service_charge_demands (unit_id, period_start);

-- ─────────────────────────────────────────────────────────────
-- 2. KRA COMPLIANCE
-- ─────────────────────────────────────────────────────────────

-- Landlord KRA details (stored on the user record via a side table to avoid
-- polluting users with Kenya-specific fields)
CREATE TABLE IF NOT EXISTS landlord_kra_profiles (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id) UNIQUE,
  kra_pin          varchar(20),                         -- e.g. A001234567B
  pin_certificate_url varchar(500),                     -- uploaded KRA PIN cert
  pin_verified_at  date,
  -- Withholding tax
  wht_rate         numeric(5,2) DEFAULT 10.00,          -- 10% individual, 30% non-resident
  is_non_resident  boolean DEFAULT false,
  -- VAT registration (for commercial landlords)
  is_vat_registered boolean DEFAULT false,
  vat_number       varchar(20),
  vat_registration_date date,
  -- Annual income tracking (KES 288,000 threshold triggers monthly filing)
  annual_income_threshold numeric(12,2) DEFAULT 288000,
  filing_frequency varchar(10) DEFAULT 'monthly',       -- monthly | quarterly | annual
  -- Compliance status
  kra_status       varchar(20) DEFAULT 'pending',       -- pending | compliant | flagged
  last_filed_period varchar(7),                         -- YYYY-MM
  notes            text,
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now()
);

-- Monthly rental income returns (KRA P9-equivalent)
CREATE TABLE IF NOT EXISTS kra_rental_returns (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  landlord_user_id uuid NOT NULL REFERENCES users(id),
  property_id      integer REFERENCES properties(id),
  -- Period
  return_year      integer NOT NULL,
  return_month     integer NOT NULL CHECK (return_month BETWEEN 1 AND 12),
  -- Gross income
  gross_rent       numeric(12,2) NOT NULL DEFAULT 0,
  -- VAT (16% on commercial leases)
  vat_applicable   boolean DEFAULT false,
  vat_amount       numeric(12,2) DEFAULT 0,
  -- Withholding tax
  wht_rate         numeric(5,2) NOT NULL DEFAULT 10.00,
  wht_amount       numeric(12,2) NOT NULL DEFAULT 0,
  -- Net payable
  net_income       numeric(12,2) NOT NULL DEFAULT 0,
  -- Filing status
  status           varchar(20) DEFAULT 'draft',         -- draft | filed | acknowledged
  filed_at         timestamp,
  acknowledgement_ref varchar(100),                     -- KRA acknowledgement number
  -- Allowable deductions (PAYE, repairs, etc.)
  allowable_deductions numeric(12,2) DEFAULT 0,
  deduction_notes  text,
  notes            text,
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now(),
  UNIQUE (landlord_user_id, property_id, return_year, return_month)
);

-- VAT tracking for commercial leases
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS is_commercial      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_applicable     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_rate           numeric(5,2) DEFAULT 16.00,
  ADD COLUMN IF NOT EXISTS vat_registration_no varchar(20);

CREATE INDEX IF NOT EXISTS idx_kra_returns_landlord_period ON kra_rental_returns (landlord_user_id, return_year, return_month);
CREATE INDEX IF NOT EXISTS idx_landlord_kra_profiles_org   ON landlord_kra_profiles (organization_id);

-- ─────────────────────────────────────────────────────────────
-- 3. LEASE STAMP DUTY TRACKING
-- ─────────────────────────────────────────────────────────────

-- Stamp duty is required for leases > 3 years at KRA.
-- Rate: 1% of total rent payable over the lease term (capped rules apply).
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS stamp_duty_required      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stamp_duty_amount        numeric(12,2),
  ADD COLUMN IF NOT EXISTS stamp_duty_paid          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stamp_duty_paid_date     date,
  ADD COLUMN IF NOT EXISTS stamp_duty_kra_ref       varchar(100),   -- KRA assessment/payment reference
  ADD COLUMN IF NOT EXISTS stamp_duty_assessment_url varchar(500),  -- uploaded KRA assessment doc
  ADD COLUMN IF NOT EXISTS stamp_duty_receipt_url   varchar(500);   -- uploaded payment receipt

-- ─────────────────────────────────────────────────────────────
-- 4. PROPERTY VALUATION HISTORY
-- ─────────────────────────────────────────────────────────────

-- Valuation log for capital gains calculation on sale
CREATE TABLE IF NOT EXISTS property_valuations (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  property_id      integer NOT NULL REFERENCES properties(id),
  valuation_date   date NOT NULL,
  valuation_type   varchar(30) NOT NULL,
  -- purchase | sale | mortgage | annual_review | cgt_assessment | insurance | forced_sale
  market_value     numeric(15,2) NOT NULL,
  currency         varchar(3) DEFAULT 'KES',
  -- Valuer details
  valuer_name      varchar(200),
  valuer_firm      varchar(200),
  valuer_licence   varchar(50),           -- ISK (Institution of Surveyors of Kenya) number
  valuation_report_url varchar(500),      -- uploaded report
  -- Capital gains context
  is_acquisition   boolean DEFAULT false, -- true = this is the purchase price (cost base)
  is_disposal      boolean DEFAULT false, -- true = this is the sale price
  -- CGT calculation fields
  purchase_price   numeric(15,2),         -- original cost (populated on disposal record)
  improvement_costs numeric(15,2) DEFAULT 0,
  cgt_gain         numeric(15,2),         -- computed: disposal - acquisition - improvements
  cgt_rate         numeric(5,2) DEFAULT 5.00,  -- KRA CGT rate (currently 5%)
  cgt_liability    numeric(12,2),
  -- Status
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now()
);

-- Also add purchase price to properties table for quick reference
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS purchase_price   numeric(15,2),
  ADD COLUMN IF NOT EXISTS purchase_date    date,
  ADD COLUMN IF NOT EXISTS current_valuation numeric(15,2),
  ADD COLUMN IF NOT EXISTS last_valuation_date date;

CREATE INDEX IF NOT EXISTS idx_property_valuations_property ON property_valuations (property_id, valuation_date DESC);

-- ─────────────────────────────────────────────────────────────
-- 5. SECURITY DEPOSIT INTEREST ACCRUAL
-- ─────────────────────────────────────────────────────────────

-- Add interest-related fields to the existing deposit_transactions table
ALTER TABLE deposit_transactions
  ADD COLUMN IF NOT EXISTS interest_period_start date,
  ADD COLUMN IF NOT EXISTS interest_period_end   date,
  ADD COLUMN IF NOT EXISTS cbk_rate_applied      numeric(6,4),   -- e.g. 13.0000 (13%)
  ADD COLUMN IF NOT EXISTS days_accrued          integer;

-- Separate interest accrual tracking table (CBK-rate-based, computed monthly)
CREATE TABLE IF NOT EXISTS deposit_interest_accruals (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  lease_id         integer NOT NULL REFERENCES leases(id),
  tenant_id        integer NOT NULL REFERENCES tenants(id),
  -- Period this accrual covers
  accrual_date     date NOT NULL,                     -- typically last day of month
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  -- Calculation inputs
  deposit_balance  numeric(12,2) NOT NULL,             -- balance at start of period
  cbk_rate         numeric(6,4) NOT NULL,              -- CBK base rate in effect
  days_in_period   integer NOT NULL,
  -- Result
  interest_amount  numeric(12,2) NOT NULL,             -- (balance × rate × days) / 365
  cumulative_interest numeric(12,2) NOT NULL DEFAULT 0,-- running total
  -- Settlement
  is_settled       boolean DEFAULT false,
  settled_at       date,
  settled_amount   numeric(12,2),
  settlement_ref   varchar(100),                      -- paid to tenant or offset
  notes            text,
  created_at       timestamp DEFAULT now(),
  UNIQUE (lease_id, accrual_date)
);

-- CBK rate history (so we can calculate interest correctly for any past period)
CREATE TABLE IF NOT EXISTS cbk_rate_history (
  id               serial PRIMARY KEY,
  effective_date   date NOT NULL UNIQUE,
  rate             numeric(6,4) NOT NULL,              -- e.g. 13.0000 for 13%
  source           varchar(50) DEFAULT 'CBK_MPC',     -- MPC = Monetary Policy Committee
  notes            text,
  created_at       timestamp DEFAULT now()
);

-- Seed initial CBK rate history (CBK rates 2020-2025, MPC decisions)
INSERT INTO cbk_rate_history (effective_date, rate, notes) VALUES
  ('2020-03-23', 7.2500,  'CBK MPC emergency cut – COVID-19'),
  ('2020-04-01', 7.0000,  'CBK MPC April 2020'),
  ('2021-01-01', 7.0000,  'CBK held 2021'),
  ('2022-05-30', 7.5000,  'CBK MPC May 2022 hike'),
  ('2022-09-27', 8.2500,  'CBK MPC September 2022'),
  ('2023-02-06', 8.7500,  'CBK MPC February 2023'),
  ('2023-03-29', 9.5000,  'CBK MPC March 2023'),
  ('2023-06-26', 10.5000, 'CBK MPC June 2023'),
  ('2023-10-03', 10.5000, 'CBK MPC October 2023 – held'),
  ('2024-02-06', 13.0000, 'CBK MPC February 2024 – emergency hike'),
  ('2024-08-06', 12.7500, 'CBK MPC August 2024 – first cut'),
  ('2024-10-08', 12.0000, 'CBK MPC October 2024'),
  ('2025-02-05', 11.2500, 'CBK MPC February 2025'),
  ('2025-04-08', 10.7500, 'CBK MPC April 2025')
ON CONFLICT (effective_date) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_deposit_interest_lease    ON deposit_interest_accruals (lease_id, accrual_date);
CREATE INDEX IF NOT EXISTS idx_deposit_interest_settled  ON deposit_interest_accruals (is_settled, accrual_date);
CREATE INDEX IF NOT EXISTS idx_cbk_rate_date             ON cbk_rate_history (effective_date DESC);
