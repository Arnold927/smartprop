# SmartProp — Image Optimisation & Lazy Loading Fix

**Issue:** Maintenance photos served at full resolution with no compression or lazy loading.  
**Impact:** A list of 10 photos over 3G (common in Nairobi estates) takes 10–20 seconds to load.  
**Fix:** Sharp resize on ingest · thumbnail generation · `loading="lazy"` · thumbnail-first list views.

---

## Files in this patch

```
server/
  middleware/
    processImage.ts               ← NEW: Sharp resize middleware
  routes/
    maintenance-actions.PATCH.ts  ← shows exact lines to change

client/
  src/components/ui/
    OptimizedImage.tsx            ← NEW: lazy-load component + PhotoGrid

db/
  migration_add_thumbnail_url.sql ← NEW: adds thumbnail_url column
```

---

## Step 1 — Install sharp

```bash
# In your server package directory (where package.json has express/drizzle deps):
npm install sharp
npm install --save-dev @types/sharp
```

`sharp` is a native Node.js binding — it installs prebuilt binaries for Linux x64 (your typical VPS / Railway / Render deploy) with no extra build tools needed.

---

## Step 2 — Copy the new middleware

Copy `server/middleware/processImage.ts` into your project at:

```
server/middleware/processImage.ts
```

---

## Step 3 — Patch maintenance-actions.ts

Open `server/routes/maintenance-actions.ts` and apply three changes:

### 3a — Add the import (after the existing s3Upload import)
```ts
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
import { processImage } from "../middleware/processImage";   // ← ADD
```

### 3b — Insert processImage into the photo upload route
```ts
// BEFORE
router.post("/:id/photos", authenticateJWT, upload.single("photo"), auditLog(...), async (req, res) => {

// AFTER
router.post("/:id/photos", authenticateJWT, upload.single("photo"), processImage, auditLog(...), async (req, res) => {
//                                                                   ^^^^^^^^^^^^
```

### 3c — Store and return thumbnailUrl
```ts
// BEFORE
const photo = await storage.createComplaintPhoto({
  maintenanceRequestId: id,
  url: resolveUploadUrl(req.file as any),
  uploadedBy: req.user.id,
  ...
});
const photoEntry = { id: photo.id, url: photo.url, ... };

// AFTER
const fullUrl  = resolveUploadUrl(req.file as any);
const thumbUrl = (req as any).thumbnailUrl ?? fullUrl;   // set by processImage

const photo = await storage.createComplaintPhoto({
  maintenanceRequestId: id,
  url:          fullUrl,
  thumbnailUrl: thumbUrl,    // ← store thumbnail
  uploadedBy:   req.user.id,
  ...
} as any);

const photoEntry = {
  id:           photo.id,
  url:          photo.url,
  thumbnailUrl: (photo as any).thumbnailUrl ?? photo.url,   // ← return it
  uploadedBy:   photo.uploadedBy,
  uploadedAt:   photo.createdAt,
};
```

### 3d — Also update the GET /:id/photos response
```ts
res.json(photos.map(photo => ({
  id:           photo.id,
  url:          photo.url,
  thumbnailUrl: (photo as any).thumbnailUrl ?? photo.url,   // ← ADD
  uploadedBy:   photo.uploadedBy,
  uploadedAt:   photo.createdAt,
})));
```

---

## Step 4 — Run the database migration

```bash
# Apply the SQL migration (adds thumbnail_url column):
psql $DATABASE_URL -f db/migration_add_thumbnail_url.sql

# OR if using drizzle-kit, add the column to your schema first, then:
npx drizzle-kit generate
npx drizzle-kit migrate
```

Add `thumbnailUrl: text("thumbnail_url")` to the `complaintsPhotos` table in `shared/schema.ts`.

---

## Step 5 — Use OptimizedImage in your React components

Copy `client/src/components/ui/OptimizedImage.tsx` into your project.

### In maintenance list views — replace raw `<img>` with `<PhotoGrid>`
```tsx
import { PhotoGrid } from "@/components/ui/OptimizedImage";

// photos comes from GET /api/maintenance-requests/:id/photos
<PhotoGrid photos={photos} />
```

### In detail / modal views
```tsx
import { OptimizedImage } from "@/components/ui/OptimizedImage";

<OptimizedImage
  src={photo.url}
  thumbnailUrl={photo.thumbnailUrl}
  alt="Maintenance photo"
  className="w-full rounded-lg"
  expandable   // adds click-to-zoom lightbox
/>
```

### For any other existing `<img>` tags (property images, etc.)
Add `loading="lazy"` and `decoding="async"` at minimum:
```tsx
// BEFORE
<img src={url} alt="Property" className="..." />

// AFTER
<img src={url} alt="Property" loading="lazy" decoding="async" className="..." />
```

---

## What this achieves on 3G (Nairobi estates)

| Before | After |
|--------|-------|
| Full-res JPEG, e.g. 3 MB per photo | Compressed to ~120–250 KB (800 px, 80 % JPEG) |
| Thumbnail in list | 200 px JPEG, ~8–15 KB |
| 10 photos list load | ~10–20 s → **~1–2 s** |
| All images loaded at page load | Only images in / near viewport load |
| No lightbox | Click thumbnail → full image lightbox |

---

## Rollback

- Remove `processImage` from the middleware chain to stop processing new uploads.
- Existing stored photos are unaffected (originals were already overwritten / re-uploaded, but the `thumbnailUrl ?? url` fallback means old rows without a thumbnail still render correctly).
