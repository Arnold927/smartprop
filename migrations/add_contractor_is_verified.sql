-- Add is_verified column to contractors table
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;
