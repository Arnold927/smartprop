-- Migration: add portfolio valuation fields to properties table
-- Allows property managers to record estimated market/purchase value per property.
-- These values power the Portfolio Value and Net ROI tiles in the Senior Manager dashboard.
-- Run once against your Postgres database.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS estimated_value       DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS estimated_value_currency VARCHAR(3) DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS estimated_value_note  VARCHAR(255);

-- Comment for clarity
COMMENT ON COLUMN properties.estimated_value IS
  'Estimated market or purchase value entered by the property manager. '
  'Used in portfolio valuation calculations on the Senior Manager dashboard.';

COMMENT ON COLUMN properties.estimated_value_currency IS
  'ISO 4217 currency code for estimated_value (e.g. KES, USD).';

COMMENT ON COLUMN properties.estimated_value_note IS
  'Free-text note about the valuation source or date (e.g. "XYZ Valuers — Jan 2025").';
