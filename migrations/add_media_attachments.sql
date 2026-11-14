-- Media attachments: photos/videos on maintenance requests, work orders and construction updates.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS media_attachments (
  id              SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  entity_type     VARCHAR(40) NOT NULL,
  entity_id       INTEGER,
  kind            VARCHAR(12) NOT NULL,
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  public_id       VARCHAR,
  storage         VARCHAR(12) NOT NULL DEFAULT 'cloudinary',
  mime_type       VARCHAR(80),
  size_bytes      INTEGER,
  label           VARCHAR(24),
  caption         TEXT,
  uploaded_by     UUID NOT NULL,
  uploader_role   VARCHAR(20),
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS media_attachments_entity_idx ON media_attachments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS media_attachments_org_idx    ON media_attachments (organization_id);
