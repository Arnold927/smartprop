/**
 * Migration: add thumbnailUrl column to complaints_photos
 *
 * Run once against your Postgres / Neon database.
 *
 * With drizzle-kit:
 *   npx drizzle-kit generate  (generates the SQL below automatically)
 *   npx drizzle-kit migrate
 *
 * Or apply the raw SQL manually:
 */

-- ── Raw SQL (apply manually if not using drizzle-kit migrate) ─────────────────
ALTER TABLE complaints_photos
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Back-fill: existing photos have no thumbnail; use the full URL as fallback
-- so the front-end logic (thumbnailUrl ?? url) always has something to render.
UPDATE complaints_photos
SET thumbnail_url = url
WHERE thumbnail_url IS NULL;

/**
 * Drizzle schema change — update the complaintsPhotos table definition in
 * your shared/schema.ts:
 *
 * ── OLD ──────────────────────────────────────────────────────────────────────
 * export const complaintsPhotos = pgTable("complaints_photos", {
 *   id:                   serial("id").primaryKey(),
 *   maintenanceRequestId: integer("maintenance_request_id").notNull(),
 *   url:                  text("url").notNull(),
 *   uploadedBy:           text("uploaded_by"),
 *   fileName:             text("file_name"),
 *   originalName:         text("original_name"),
 *   size:                 integer("size"),
 *   mimeType:             text("mime_type"),
 *   createdAt:            timestamp("created_at").defaultNow(),
 * });
 *
 * ── NEW ──────────────────────────────────────────────────────────────────────
 * export const complaintsPhotos = pgTable("complaints_photos", {
 *   id:                   serial("id").primaryKey(),
 *   maintenanceRequestId: integer("maintenance_request_id").notNull(),
 *   url:                  text("url").notNull(),
 *   thumbnailUrl:         text("thumbnail_url"),               // ← NEW
 *   uploadedBy:           text("uploaded_by"),
 *   fileName:             text("file_name"),
 *   originalName:         text("original_name"),
 *   size:                 integer("size"),
 *   mimeType:             text("mime_type"),
 *   createdAt:            timestamp("created_at").defaultNow(),
 * });
 */
