-- Adds org-level Daraja API credential storage to organization_settings —
-- the fallback tier for the common single-landlord (or landlord-less) org,
-- where there's no separate landlord account to attach per-landlord
-- credentials to.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS mpesa_consumer_key VARCHAR,
  ADD COLUMN IF NOT EXISTS mpesa_consumer_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_passkey_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_environment VARCHAR DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS stk_push_verified_at TIMESTAMP;

-- Uses the same CREDENTIALS_ENCRYPTION_KEY as landlord_payment_settings —
-- no additional environment variable needed if you've already set that up
-- for per-landlord credentials.