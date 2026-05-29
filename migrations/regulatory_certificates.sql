-- ============================================================
-- NEMA / NCA Regulatory Certificates
-- Adds a dedicated table for property-level regulatory
-- certificates: NEMA EIA approvals, NCA contractor licences,
-- county building permits, fire certificates, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS regulatory_certificates (
  id                  serial PRIMARY KEY,
  organization_id     integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id         integer NOT NULL REFERENCES properties(id)    ON DELETE CASCADE,

  -- Which regulatory body issued / tracks this certificate
  authority           varchar(20) NOT NULL DEFAULT 'NEMA',
  -- NEMA | NCA | COUNTY | FIRE | OTHER

  certificate_type    varchar(60) NOT NULL,
  -- e.g. 'EIA Licence', 'NCA Project Registration', 'Building Permit',
  --      'Fire Clearance Certificate', 'Occupation Certificate'

  certificate_number  varchar(100),          -- official reference number
  title               varchar(255) NOT NULL, -- human-readable short name

  -- Associated NCA project (optional FK into projects table)
  project_id          integer REFERENCES projects(id) ON DELETE SET NULL,

  -- Lifecycle dates
  issue_date          date,
  expiry_date         date,                  -- NULL = does not expire
  renewal_date        date,                  -- date renewal was submitted

  -- Status
  status              varchar(30) NOT NULL DEFAULT 'active',
  -- active | expired | pending | suspended | revoked | under_review

  -- Compliance contact / issuing officer
  issuing_officer     varchar(150),
  issuing_office      varchar(200),          -- e.g. "NEMA Nairobi Regional Office"

  -- Conditions / notes attached to the certificate
  conditions          text,
  notes               text,

  -- Document attachment (URL to uploaded certificate scan)
  document_url        varchar(500),

  -- Alert thresholds (days before expiry to trigger each reminder)
  alert_90_sent       boolean DEFAULT false,
  alert_60_sent       boolean DEFAULT false,
  alert_30_sent       boolean DEFAULT false,
  alert_7_sent        boolean DEFAULT false,

  created_by          uuid REFERENCES users(id),
  created_at          timestamp DEFAULT NOW(),
  updated_at          timestamp DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS reg_certs_property_idx   ON regulatory_certificates(property_id);
CREATE INDEX IF NOT EXISTS reg_certs_org_idx        ON regulatory_certificates(organization_id);
CREATE INDEX IF NOT EXISTS reg_certs_expiry_idx     ON regulatory_certificates(expiry_date)
  WHERE expiry_date IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS reg_certs_authority_idx  ON regulatory_certificates(authority);
