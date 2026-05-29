/**
 * PATCH FILE — maintenance-actions.ts
 *
 * Apply two changes:
 *
 * 1. Add the processImage import after the existing s3Upload import (line ~16).
 * 2. Insert processImage into the POST /:id/photos middleware chain.
 * 3. Store thumbnailUrl alongside url in createComplaintPhoto.
 * 4. Return thumbnailUrl in the JSON response.
 *
 * Lines shown are from the original file. Replace each OLD block with the
 * corresponding NEW block.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGE 1 — add import  (after line 16 in original)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── OLD (line 16) ────────────────────────────────────────────────────────────
// import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
// ── NEW ──────────────────────────────────────────────────────────────────────
// import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
// import { processImage } from "../middleware/processImage";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGE 2 — add processImage to the POST /:id/photos route
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── OLD (line ~320) ──────────────────────────────────────────────────────────
// router.post("/:id/photos", authenticateJWT, upload.single("photo"), auditLog("maintenance_photo", "CREATE"), async (req: any, res) => {
// ── NEW ──────────────────────────────────────────────────────────────────────
// router.post("/:id/photos", authenticateJWT, upload.single("photo"), processImage, auditLog("maintenance_photo", "CREATE"), async (req: any, res) => {

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGE 3 — store thumbnailUrl and return it in the response
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── OLD ──────────────────────────────────────────────────────────────────────
// const photo = await storage.createComplaintPhoto({
//   maintenanceRequestId: id,
//   url: resolveUploadUrl(req.file as any), // Use 'url' field
//   uploadedBy: req.user.id, // Use 'uploadedBy' field
//   fileName: req.file.filename,
//   originalName: req.file.originalname,
//   size: req.file.size,
//   mimeType: req.file.mimetype,
// } as any);
//
// const photoEntry = {
//   id: photo.id,
//   url: photo.url,
//   uploadedBy: photo.uploadedBy,
//   uploadedAt: photo.createdAt,
// };
// ── NEW ──────────────────────────────────────────────────────────────────────
// const fullUrl  = resolveUploadUrl(req.file as any);
// const thumbUrl = (req as any).thumbnailUrl ?? fullUrl;
//
// const photo = await storage.createComplaintPhoto({
//   maintenanceRequestId: id,
//   url:          fullUrl,
//   thumbnailUrl: thumbUrl,   // NEW — stored for fast list-view rendering
//   uploadedBy:   req.user.id,
//   fileName:     req.file.filename,
//   originalName: req.file.originalname,
//   size:         req.file.size,
//   mimeType:     req.file.mimetype,
// } as any);
//
// const photoEntry = {
//   id:          photo.id,
//   url:         photo.url,
//   thumbnailUrl: (photo as any).thumbnailUrl ?? photo.url,  // NEW
//   uploadedBy:  photo.uploadedBy,
//   uploadedAt:  photo.createdAt,
// };

/* ─────────────────────────────────────────────────────────────────────────────
 * FULL UPDATED ROUTE (ready to paste over lines 319-355 of the original)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UPDATED_PHOTO_ROUTE = `
// POST /api/maintenance-requests/:id/photos
router.post(
  "/:id/photos",
  authenticateJWT,
  upload.single("photo"),
  processImage,                          // ← resize + thumbnail on ingest
  auditLog("maintenance_photo", "CREATE"),
  async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

      const request = await storage.getMaintenanceRequest(id);
      if (!request) return res.status(404).json({ message: "Request not found" });

      const fullUrl  = resolveUploadUrl(req.file as any);
      const thumbUrl = (req as any).thumbnailUrl ?? fullUrl;  // set by processImage

      const photo = await storage.createComplaintPhoto({
        maintenanceRequestId: id,
        url:          fullUrl,
        thumbnailUrl: thumbUrl,    // store thumbnail for list views
        uploadedBy:   req.user.id,
        fileName:     req.file.filename,
        originalName: req.file.originalname,
        size:         req.file.size,
        mimeType:     req.file.mimetype,
      } as any);

      const photoEntry = {
        id:          photo.id,
        url:         photo.url,
        thumbnailUrl: (photo as any).thumbnailUrl ?? photo.url,
        uploadedBy:  photo.uploadedBy,
        uploadedAt:  photo.createdAt,
      };

      res.status(201).json(photoEntry);
    } catch (error) {
      console.error("Upload photo error:", error);
      res.status(500).json({ message: "Failed to upload photo" });
    }
  }
);
`;

/* ─────────────────────────────────────────────────────────────────────────────
 * Also update the GET /:id/photos response to include thumbnailUrl:
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UPDATED_GET_PHOTOS_ROUTE = `
// GET /api/maintenance-requests/:id/photos
router.get("/:id/photos", authenticateJWT, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    const photos = await storage.getComplaintPhotos(id);
    res.json(photos.map(photo => ({
      id:          photo.id,
      url:         photo.url,
      thumbnailUrl: (photo as any).thumbnailUrl ?? photo.url,  // ← NEW
      uploadedBy:  photo.uploadedBy,
      uploadedAt:  photo.createdAt,
    })));
  } catch (error) {
    console.error("Get photos error:", error);
    res.status(500).json({ message: "Failed to fetch photos" });
  }
});
`;
