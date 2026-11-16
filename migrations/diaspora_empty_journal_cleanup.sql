-- Before this round a diaspora payment wrote a journal-entry header with no lines, and nothing was ever posted to
-- the general ledger, so reports never saw the money. Payments are now posted straight to the ledger
-- (POST /api/diaspora-payments/repost-ledger back-fills the missing rows for completed payments).
-- This removes only the empty headers that the old code left behind. Safe to run more than once.
DELETE FROM journal_entries je
 WHERE je.reference LIKE 'diaspora_payment:%'
   AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = je.id)
   AND NOT EXISTS (SELECT 1 FROM general_ledger g WHERE g.journal_entry_id = je.id);
