-- ============================================================
-- Caretaker Role Migration
-- Adds 'caretaker' as a valid first-class user role.
--
-- After this runs:
--   1. Existing caretaker records in the caretakers table gain
--      a proper login role on their linked users row.
--   2. New users can be invited with role = 'caretaker'.
--   3. The API middleware (requireRole.ts) already accepts
--      'caretaker' as of the code change in this release.
-- ============================================================

-- 1. There is no enum constraint on users.role (it is a plain varchar),
--    so no ALTER TYPE needed. The value 'caretaker' is now valid by
--    convention — document it in a CHECK constraint so the DB enforces it.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('admin','manager','landlord','staff','caretaker','tenant','guard')
  );

-- 2. Backfill: for every row in caretakers that has a linked user,
--    set that user's role to 'caretaker' IF their role is currently
--    'casual_worker_staff' or 'staff' (i.e. they were previously
--    invited with the wrong role). Roles that are already more
--    privileged (manager, admin) are left unchanged.
UPDATE users u
SET role = 'caretaker'
FROM caretakers c
WHERE c.user_id = u.id
  AND u.role IN ('casual_worker_staff', 'staff')
  AND c.status = 'active';

-- 3. Index: faster caretaker property lookups used by the route filters.
CREATE INDEX IF NOT EXISTS idx_caretakers_user_id
  ON caretakers (user_id)
  WHERE status = 'active';
