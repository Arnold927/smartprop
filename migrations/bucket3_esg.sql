-- ============================================================
-- Bucket 3 — ESG / Sustainability Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS esg_metrics (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  property_id      integer REFERENCES properties(id),
  period_year      integer NOT NULL,
  period_month     integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  electricity_kwh  numeric(12,2) DEFAULT 0,
  solar_kwh        numeric(12,2) DEFAULT 0,
  generator_litres numeric(10,2) DEFAULT 0,
  water_m3         numeric(12,2) DEFAULT 0,
  rainwater_m3     numeric(10,2) DEFAULT 0,
  waste_kg         numeric(10,2) DEFAULT 0,
  recycled_kg      numeric(10,2) DEFAULT 0,
  carbon_kgco2e    numeric(12,2) DEFAULT 0,
  energy_score     integer CHECK (energy_score BETWEEN 0 AND 100),
  water_score      integer CHECK (water_score  BETWEEN 0 AND 100),
  waste_score      integer CHECK (waste_score  BETWEEN 0 AND 100),
  overall_score    integer CHECK (overall_score BETWEEN 0 AND 100),
  notes            text,
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS esg_reports (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  report_type      varchar(30) NOT NULL,
  period_label     varchar(30) NOT NULL,
  title            varchar(200) NOT NULL,
  status           varchar(20) DEFAULT 'draft',
  report_url       varchar(500),
  highlights       jsonb DEFAULT '[]',
  created_by       uuid REFERENCES users(id),
  created_at       timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS green_materials (
  id               serial PRIMARY KEY,
  organization_id  integer NOT NULL REFERENCES organizations(id),
  name             varchar(200) NOT NULL,
  category         varchar(50),
  supplier         varchar(200),
  certification    varchar(100),
  carbon_footprint numeric(10,4),
  unit_of_measure  varchar(20),
  cost_per_unit    numeric(10,2),
  currency         varchar(3) DEFAULT 'KES',
  is_approved      boolean DEFAULT false,
  notes            text,
  created_at       timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esg_metrics_org_period ON esg_metrics (organization_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_esg_metrics_property   ON esg_metrics (property_id, period_year, period_month);
