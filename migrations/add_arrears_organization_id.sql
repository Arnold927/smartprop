-- Migration: add organizationId to arrears for multi-tenant isolation
-- Run this against your database before deploying the updated server code.

BEGIN;

-- 1. Add the column as nullable first so existing rows don't fail immediately.
ALTER TABLE arrears
  ADD COLUMN IF NOT EXISTS organization_id INTEGER;

-- 2. Back-fill existing rows by walking arrears → properties → organization_id.
UPDATE arrears a
SET    organization_id = p.organization_id
FROM   properties p
WHERE  p.id = a.property_id
  AND  a.organization_id IS NULL;

-- 3. Delete any orphaned rows that could not be resolved (no matching property).
DELETE FROM arrears WHERE organization_id IS NULL;

-- 4. Apply NOT NULL constraint + FK now that all rows are populated.
ALTER TABLE arrears
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE arrears
  ADD CONSTRAINT arrears_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);

-- 5. Index for the hot query path: org-scoped list by status.
CREATE INDEX IF NOT EXISTS idx_arrears_organization_id_status
  ON arrears (organization_id, status);

COMMIT;
