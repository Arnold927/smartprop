-- ============================================================
-- eTIMS Integration Migration
-- KRA Electronic Tax Invoice Management System
-- eTIMS API: https://etims-api.kra.go.ke (production)
--             https://etims-sbx.kra.go.ke (sandbox)
-- ============================================================

-- Organisation-level eTIMS device registration
CREATE TABLE IF NOT EXISTS etims_device_info (
  id                    SERIAL PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- KRA-issued credentials
  tin                   VARCHAR(20)  NOT NULL,          -- Taxpayer Identification Number
  bhf_id                VARCHAR(10)  NOT NULL,          -- Branch/Head office ID (e.g. "00")
  device_serial         VARCHAR(50),                    -- VSCU/OSCU serial number
  -- Initialisation response from KRA
  env_dist_code         VARCHAR(10),                    -- environment distribution code
  last_req_dt           VARCHAR(20),                    -- last request datetime from KRA
  -- Status
  status                VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending|active|suspended
  sandbox               BOOLEAN      NOT NULL DEFAULT TRUE,
  initialised_at        TIMESTAMP,
  created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

-- eTIMS code lookup cache (item classification, tax types, etc.)
CREATE TABLE IF NOT EXISTS etims_code_lookup (
  id                    SERIAL PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cd_cls_code           VARCHAR(20) NOT NULL,           -- code class (e.g. "20")
  cd_code               VARCHAR(20) NOT NULL,
  cd_nm                 VARCHAR(255) NOT NULL,
  cd_desc               TEXT,
  use_yn                CHAR(1)  DEFAULT 'Y',
  fetched_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, cd_cls_code, cd_code)
);

-- eTIMS invoice transmissions
-- One row per invoice sent to KRA
CREATE TABLE IF NOT EXISTS etims_invoices (
  id                    SERIAL PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id            INTEGER REFERENCES invoices(id),  -- source invoice
  rent_payment_id       INTEGER REFERENCES rent_payments(id),

  -- KRA submission fields
  invc_no               VARCHAR(50)  NOT NULL,           -- our invoice number
  tpin                  VARCHAR(20)  NOT NULL,           -- taxpayer PIN
  bhf_id                VARCHAR(10)  NOT NULL DEFAULT '00',
  sale_stt_cd           VARCHAR(5)   NOT NULL DEFAULT '02', -- 02=approved
  rcpt_ty_cd            VARCHAR(5)   NOT NULL DEFAULT 'S',  -- S=sale
  pmnt_ty_cd            VARCHAR(5),                     -- payment type: 01=cash,02=mpesa
  sale_dt               VARCHAR(20)  NOT NULL,           -- YYYYMMDDHHMMSS
  stock_rls_dt          VARCHAR(20),

  -- Customer info (tenant)
  cust_nm               VARCHAR(255),
  cust_tpin             VARCHAR(20),
  cust_addr             TEXT,

  -- Totals
  taxbl_amt_a           DECIMAL(15,2) DEFAULT 0,        -- taxable amount rate A (16% VAT)
  tax_rt_a              DECIMAL(5,2)  DEFAULT 16.00,
  tax_amt_a             DECIMAL(15,2) DEFAULT 0,
  taxbl_amt_b           DECIMAL(15,2) DEFAULT 0,        -- exempt amount
  tot_item_cnt          INTEGER       DEFAULT 1,
  tot_taxbl_amt         DECIMAL(15,2) NOT NULL,
  tot_tax_amt           DECIMAL(15,2) NOT NULL DEFAULT 0,
  tot_amt               DECIMAL(15,2) NOT NULL,

  -- KRA response
  rcpt_no               VARCHAR(50),                    -- receipt number from KRA
  int_dt                VARCHAR(20),                    -- integration datetime
  qr_code               TEXT,                           -- QR code string
  rcpt_sign             VARCHAR(255),                   -- receipt signature

  -- Transmission status
  status                VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending | submitted | accepted | rejected | error
  kra_result_cd         VARCHAR(10),
  kra_result_msg        TEXT,
  attempts              INTEGER      NOT NULL DEFAULT 0,
  last_attempt_at       TIMESTAMP,
  submitted_at          TIMESTAMP,
  accepted_at           TIMESTAMP,

  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_etims_invoices_org     ON etims_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_etims_invoices_status  ON etims_invoices(status);
CREATE INDEX IF NOT EXISTS idx_etims_invoices_inv     ON etims_invoices(invoice_id);
