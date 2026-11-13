-- Journal entry lines store chart_of_accounts ids (see server/routes/journal-entries.ts
-- and diaspora.ts), but the FK pointed at the legacy, empty ledger_accounts table, so
-- every attempt to post a journal entry failed with a foreign key violation.
ALTER TABLE "journal_entry_lines" DROP CONSTRAINT IF EXISTS "journal_entry_lines_account_id_ledger_accounts_id_fk";
ALTER TABLE "journal_entry_lines" DROP CONSTRAINT IF EXISTS "journal_entry_lines_account_id_chart_of_accounts_id_fk";
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_chart_of_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id");
