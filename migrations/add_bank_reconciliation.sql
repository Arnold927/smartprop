-- ──────────────────────────────────────────────────────────────────────────────
-- Bank Reconciliation Feature
-- Supports: Equity Bank, KCB, Cooperative Bank, Stanbic, NCBA, Absa, DTB, I&M
-- and any other bank via generic CSV import
-- ──────────────────────────────────────────────────────────────────────────────

-- Tracks a batch of imported bank statement rows
CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id                  SERIAL PRIMARY KEY,
  organization_id     INTEGER NOT NULL,
  bank_name           VARCHAR(60) NOT NULL,                -- e.g. "equity", "kcb", "cooperative"
  account_name        VARCHAR(120),                        -- e.g. "Westgate Apartments Collection"
  account_number      VARCHAR(50),
  statement_period_from DATE,
  statement_period_to   DATE,
  imported_by         UUID NOT NULL,
  row_count           INTEGER NOT NULL DEFAULT 0,
  matched_count       INTEGER NOT NULL DEFAULT 0,
  unmatched_count     INTEGER NOT NULL DEFAULT 0,
  file_name           VARCHAR(255),
  notes               TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | processing | done
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- Individual transaction rows from an imported bank statement
CREATE TABLE IF NOT EXISTS bank_statement_rows (
  id                  SERIAL PRIMARY KEY,
  import_id           INTEGER NOT NULL REFERENCES bank_statement_imports(id) ON DELETE CASCADE,
  organization_id     INTEGER NOT NULL,
  bank_name           VARCHAR(60) NOT NULL,
  transaction_date    DATE NOT NULL,
  value_date          DATE,
  description         TEXT,
  -- Debit/credit split (some banks export this way)
  debit_amount        NUMERIC(12, 2),
  credit_amount       NUMERIC(12, 2),
  -- Or combined signed amount (positive = credit to landlord account)
  amount              NUMERIC(12, 2) NOT NULL,
  currency            VARCHAR(3) NOT NULL DEFAULT 'KES',
  running_balance     NUMERIC(14, 2),
  -- Reference fields extracted / parsed from description
  raw_reference       VARCHAR(255),   -- verbatim ref from bank
  parsed_reference    VARCHAR(120),   -- cleaned reference after parsing
  payer_name          VARCHAR(150),   -- name field if bank provides it
  payer_account       VARCHAR(50),    -- source account if available
  -- Matching state
  match_status        VARCHAR(20) NOT NULL DEFAULT 'unmatched',  -- unmatched | matched | ignored | partial
  matched_rent_payment_id INTEGER REFERENCES rent_payments(id),
  matched_by          UUID,           -- user who confirmed/overrode the match
  matched_at          TIMESTAMP,
  match_confidence    SMALLINT,       -- 0–100 auto-match confidence score
  match_method        VARCHAR(30),    -- auto_amount_ref | auto_amount | manual | ignored
  reconcile_notes     TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_rows_import     ON bank_statement_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_rows_org        ON bank_statement_rows(organization_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_rows_status     ON bank_statement_rows(match_status);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_rows_ref        ON bank_statement_rows(parsed_reference);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_rows_date       ON bank_statement_rows(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_imports_org     ON bank_statement_imports(organization_id);
