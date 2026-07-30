-- Adds support for landlords who don't (and may never) have a user account —
-- a genuinely common case, not an edge case. Properties link to one of these
-- via properties.external_landlord_id instead of properties.owner_id.

CREATE TABLE IF NOT EXISTS external_landlords (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name VARCHAR NOT NULL,
  phone VARCHAR,
  email VARCHAR,
  notes TEXT,
  rent_payment JSONB DEFAULT '{}',
  utility_payment JSONB DEFAULT '{}',
  mpesa_consumer_key VARCHAR,
  mpesa_consumer_secret_encrypted TEXT,
  mpesa_passkey_encrypted TEXT,
  mpesa_environment VARCHAR DEFAULT 'production',
  stk_push_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS external_landlord_id INTEGER REFERENCES external_landlords(id);

-- Uses the same CREDENTIALS_ENCRYPTION_KEY as landlord_payment_settings and
-- organization_settings — no additional environment variable needed.