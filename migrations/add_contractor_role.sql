-- Migration: add 'contractor' to the users.role check constraint
-- The 'contractor' role maps to the Contractor Portal (/contractor-portal).
-- Previously the constraint only covered the 7 roles added in add_caretaker_role.sql.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('admin','manager','landlord','staff','caretaker','tenant','guard','contractor')
  );
