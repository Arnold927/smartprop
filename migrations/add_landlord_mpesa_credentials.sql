-- Adds per-landlord Daraja API credential storage to landlord_payment_settings.
-- Required before any landlord can save consumer key/secret/passkey.
ALTER TABLE landlord_payment_settings
  ADD COLUMN IF NOT EXISTS mpesa_consumer_key VARCHAR,
  ADD COLUMN IF NOT EXISTS mpesa_consumer_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_passkey_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_environment VARCHAR DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS stk_push_verified_at TIMESTAMP;

-- Also required: set CREDENTIALS_ENCRYPTION_KEY as an environment variable
-- before any landlord attempts to save credentials. Generate one with:
--   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
-- This key encrypts mpesa_consumer_secret_encrypted and mpesa_passkey_encrypted
-- at rest. Losing/rotating this key without re-encrypting existing rows will
-- make existing saved credentials undecryptable — landlords would need to
-- re-enter them.