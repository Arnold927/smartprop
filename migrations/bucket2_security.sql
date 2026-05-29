-- ============================================================
-- Bucket 2 — Security Fixes Migration
-- 1. Refresh token revocation table
-- 2. Account lockout columns on users
-- ============================================================

-- ─── 1. REFRESH TOKENS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           serial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   varchar(64) NOT NULL UNIQUE,  -- SHA-256 hex of the raw token
  issued_at    timestamp NOT NULL DEFAULT now(),
  expires_at   timestamp NOT NULL,
  revoked_at   timestamp,
  device_hint  varchar(200),                 -- User-Agent snippet for session mgmt UI
  ip_address   varchar(45)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_cleanup ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- ─── 2. ACCOUNT LOCKOUT ──────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until          timestamp;
