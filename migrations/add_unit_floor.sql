-- Optional floor label for a unit (G, 1, 2, B1, Mezzanine ...). Nullable: existing rows are untouched.
-- Run this BEFORE deploying the code that references units.floor.
ALTER TABLE units ADD COLUMN IF NOT EXISTS floor varchar(20);
