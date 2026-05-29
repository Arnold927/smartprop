-- ============================================================
-- Bucket 1 — Revenue Blockers Migration
-- 1. PM Agreements & Owner Remittance Statements
-- 2. Property Inspections (move-in / move-out)
-- 3. Vacancy / Letting Pipeline (prospects)
-- ============================================================

-- ─── 1. PM AGREEMENTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_agreements (
  id                      serial PRIMARY KEY,
  organization_id         integer NOT NULL REFERENCES organizations(id),
  property_id             integer NOT NULL REFERENCES properties(id) UNIQUE,
  owner_user_id           uuid REFERENCES users(id),
  agreement_number        varchar(30) NOT NULL UNIQUE,
  fee_type                varchar(20) NOT NULL DEFAULT 'percentage',
  fee_rate                numeric(6,2) NOT NULL DEFAULT 10.00,
  disbursement_method     varchar(20),
  disbursement_account    varchar(100),
  disbursement_name       varchar(100),
  start_date              date NOT NULL,
  end_date                date,
  auto_renew              boolean DEFAULT true,
  notice_period_days      integer DEFAULT 30,
  deduct_maintenance_costs boolean DEFAULT true,
  deduct_utilities        boolean DEFAULT false,
  deduct_insurance        boolean DEFAULT false,
  maintenance_approval_threshold numeric(10,2) DEFAULT 5000,
  status                  varchar(20) DEFAULT 'active',
  notes                   text,
  created_by              uuid REFERENCES users(id),
  created_at              timestamp DEFAULT now(),
  updated_at              timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_statements (
  id                serial PRIMARY KEY,
  organization_id   integer NOT NULL REFERENCES organizations(id),
  pm_agreement_id   integer NOT NULL REFERENCES pm_agreements(id),
  property_id       integer NOT NULL REFERENCES properties(id),
  owner_user_id     uuid REFERENCES users(id),
  statement_number  varchar(30) NOT NULL UNIQUE,
  period_month      integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year       integer NOT NULL,
  gross_rent        numeric(12,2) NOT NULL DEFAULT 0,
  other_income      numeric(12,2) NOT NULL DEFAULT 0,
  total_income      numeric(12,2) NOT NULL DEFAULT 0,
  pm_fee            numeric(12,2) NOT NULL DEFAULT 0,
  maintenance_costs numeric(12,2) NOT NULL DEFAULT 0,
  utility_costs     numeric(12,2) NOT NULL DEFAULT 0,
  insurance_costs   numeric(12,2) NOT NULL DEFAULT 0,
  other_deductions  numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions  numeric(12,2) NOT NULL DEFAULT 0,
  net_payable       numeric(12,2) NOT NULL DEFAULT 0,
  currency          varchar(3) DEFAULT 'KES',
  status            varchar(20) DEFAULT 'draft',
  disbursed_at      timestamp,
  disbursement_ref  varchar(100),
  line_items        jsonb,
  payment_details   jsonb,
  expense_details   jsonb,
  approved_by       uuid REFERENCES users(id),
  approved_at       timestamp,
  notes             text,
  generated_by      uuid REFERENCES users(id),
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_statements_property_period_uidx
  ON owner_statements (property_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_pm_agreements_org    ON pm_agreements (organization_id);
CREATE INDEX IF NOT EXISTS idx_owner_statements_org ON owner_statements (organization_id, period_year, period_month);

-- ─── 2. PROPERTY INSPECTIONS ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_inspections (
  id                      serial PRIMARY KEY,
  organization_id         integer NOT NULL REFERENCES organizations(id),
  property_id             integer NOT NULL REFERENCES properties(id),
  unit_id                 integer REFERENCES units(id),
  lease_id                integer REFERENCES leases(id),
  tenant_id               integer REFERENCES tenants(id),
  inspection_number       varchar(30) NOT NULL UNIQUE,
  inspection_type         varchar(30) NOT NULL,
  scheduled_date          date,
  conducted_date          date,
  conducted_by            uuid REFERENCES users(id),
  rooms                   jsonb NOT NULL DEFAULT '[]',
  overall_condition       varchar(20),
  issues_found            jsonb DEFAULT '[]',
  total_issues_cost       numeric(10,2) DEFAULT 0,
  electricity_reading     numeric(10,2),
  water_reading           numeric(10,2),
  tenant_signed_at        timestamp,
  tenant_signature_ip     varchar(45),
  tenant_signature_name   varchar(100),
  manager_signed_at       timestamp,
  manager_signature_ip    varchar(45),
  manager_signature_name  varchar(100),
  previous_inspection_id  integer,
  recommended_deduction   numeric(10,2) DEFAULT 0,
  deduction_notes         text,
  report_url              varchar(500),
  status                  varchar(20) DEFAULT 'draft',
  notes                   text,
  created_at              timestamp DEFAULT now(),
  updated_at              timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspections_unit_type  ON property_inspections (unit_id, inspection_type, conducted_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_lease       ON property_inspections (lease_id);

-- ─── 4. PROSPECTS / LETTING PIPELINE ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prospects (
  id                          serial PRIMARY KEY,
  organization_id             integer NOT NULL REFERENCES organizations(id),
  property_id                 integer REFERENCES properties(id),
  unit_id                     integer REFERENCES units(id),
  first_name                  varchar(100) NOT NULL,
  last_name                   varchar(100) NOT NULL,
  email                       varchar(255) NOT NULL,
  phone                       varchar(30),
  national_id                 varchar(30),
  nationality                 varchar(50) DEFAULT 'Kenyan',
  employer                    varchar(200),
  job_title                   varchar(100),
  monthly_income              numeric(12,2),
  employment_type             varchar(30),
  reference1_name             varchar(100),
  reference1_phone            varchar(30),
  reference1_relation         varchar(50),
  reference2_name             varchar(100),
  reference2_phone            varchar(30),
  reference2_relation         varchar(50),
  status                      varchar(30) NOT NULL DEFAULT 'new',
  source                      varchar(30),
  preferred_move_in           date,
  budget_min                  numeric(10,2),
  budget_max                  numeric(10,2),
  viewing_date                timestamp,
  viewing_notes               text,
  viewing_conducted_by        uuid REFERENCES users(id),
  application_submitted_at    timestamp,
  application_notes           text,
  references_checked_at       timestamp,
  references_checked_by       uuid REFERENCES users(id),
  reference_check_notes       text,
  approved_at                 timestamp,
  approved_by                 uuid REFERENCES users(id),
  rejected_at                 timestamp,
  rejection_reason            text,
  lease_offered_at            timestamp,
  offered_rent                numeric(10,2),
  converted_to_tenant_id      integer REFERENCES tenants(id),
  converted_at                timestamp,
  assigned_to                 uuid REFERENCES users(id),
  internal_notes              text,
  created_at                  timestamp DEFAULT now(),
  updated_at                  timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_org_status  ON prospects (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_prospects_property     ON prospects (property_id, unit_id);
