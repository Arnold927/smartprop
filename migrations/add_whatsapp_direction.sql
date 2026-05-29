-- Migration: add direction column to whatsapp_messages
-- Distinguishes inbound (tenant reply) from outbound (system-sent) messages.
-- Run once against your Postgres database.

ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'outbound';

-- Back-fill: rows that have the old "[INBOUND]" content prefix from before this fix
UPDATE whatsapp_messages
   SET direction = 'inbound'
 WHERE content LIKE '[INBOUND]%';

-- Optional: clean up the "[INBOUND] " prefix that was prepended by the old webhook handler
UPDATE whatsapp_messages
   SET content = LTRIM(SUBSTRING(content FROM 11))  -- strips "[INBOUND] " (10 chars)
 WHERE direction = 'inbound' AND content LIKE '[INBOUND]%';
