-- Migration: add whatsapp_settings column to organization_settings
-- The column was added to shared/schema.ts but was never included in the
-- initial migration (0000_misty_maelstrom.sql), causing a 42703 error:
--   "column whatsapp_settings does not exist"
--
-- Run once against your Neon database:
--   psql $DATABASE_URL -f migrations/add_whatsapp_settings.sql

ALTER TABLE "organization_settings"
  ADD COLUMN IF NOT EXISTS "whatsapp_settings" jsonb DEFAULT '{}'::jsonb;
