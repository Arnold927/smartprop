-- ============================================================
-- Diaspora Buyer Portal Migration
-- Links a diaspora_contracts row to the buyer's user account
-- so the buyer can log in and see only their own contract.
--
-- After this runs:
--   1. Existing contracts get buyerUserId = NULL (unlinked).
--      Managers should invite buyers and then patch the contract
--      via PATCH /api/diaspora-contracts/:id { buyerUserId: <uuid> }
--      or via the admin UI once the buyer accepts the invite.
--   2. New contracts created via POST /api/diaspora-contracts
--      will set buyerUserId automatically if the invited buyer
--      already has a user account with the same clientEmail.
-- ============================================================

ALTER TABLE diaspora_contracts
  ADD COLUMN IF NOT EXISTS buyer_user_id uuid
  REFERENCES users(id)
  ON DELETE SET NULL;

-- Optional: backfill for cases where the buyer's user account email
-- matches the clientEmail already recorded on the contract.
-- Safe to run multiple times (ON CONFLICT is not needed; UPDATE is idempotent).
UPDATE diaspora_contracts dc
SET buyer_user_id = u.id
FROM users u
WHERE lower(u.email) = lower(dc.client_email)
  AND dc.buyer_user_id IS NULL
  AND u.role IN ('landlord', 'tenant', 'manager', 'admin');

-- Index for fast portal lookups: "give me all contracts for this buyer"
CREATE INDEX IF NOT EXISTS idx_diaspora_contracts_buyer_user_id
  ON diaspora_contracts (buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;
