-- Migration: add_mpesa_utility_bill_link
--
-- Enables M-Pesa STK Push payments for utility bills in the tenant portal.
-- Previously only rent invoices (rent_payment_id) could be linked to an
-- M-Pesa transaction. This migration adds the utility bill FK so that:
--
--   1. POST /api/mpesa/initiate accepts utilityBillId
--   2. STK callback marks the utility bill as 'paid' automatically
--   3. Tenant receives a WhatsApp receipt for utility payments
--   4. The tenant portal refreshes the utility bill status in real time
--
-- Run AFTER add_utility_bill_tenant_link.sql (which adds the utility_bills.tenant_id column)

-- Add utility_bill_id FK to mpesa_transactions
ALTER TABLE mpesa_transactions
  ADD COLUMN IF NOT EXISTS utility_bill_id INTEGER REFERENCES utility_bills(id) ON DELETE SET NULL;

-- Index for fast callback lookups (reconcilePayment joins on this)
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_utility_bill_id
  ON mpesa_transactions(utility_bill_id)
  WHERE utility_bill_id IS NOT NULL;
