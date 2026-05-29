/**
 * processImage.ts
 *
 * Sharp-based image processing middleware.
 * Runs AFTER multer (s3Upload / diskStorage) has written the file.
 *
 * What it does:
 *  1. If the uploaded file is an image, re-encodes it as JPEG at max 800 px
 *     width and 80 % quality (thumbnail = 200 px, 60 % quality).
 *  2. Writes / uploads the compressed bytes back to the same location
 *     (disk: overwrites the temp file; cloud: re-uploads with a "-thumb" key).
 *  3. Attaches the thumbnail URL to req.thumbnailUrl so route handlers can
 *     store it alongside the full URL.
 *
 * Non-image uploads (PDFs, etc.) pass straight through untouched.
 *
 * Usage in a route:
 *
 *   import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
 *   import { processImage } from "../middleware/processImage";
 *
 *   router.post(
 *     "/:id/photos",
 *     authenticateJWT,
 *     s3Upload.single("photo"),   // 1. receive the raw file
 *     processImage,               // 2. resize + generate thumbnail
 *     async (req, res) => {
 *       const fullUrl  = resolveUploadUrl(req.file as any);
 *       const thumbUrl = (req as any).thumbnailUrl ?? fullUrl;
 *       // … store both URLs …
 *     }
 *   );
 */

import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";

// ── Constants ─────────────────────────────────────────────────────────────────
const FULL_MAX_PX  = 800;   // longest edge of the full-size image
const FULL_QUALITY = 80;    // JPEG quality for the full image
const THUMB_MAX_PX = 200;   // thumbnail longest edge
const THUMB_QUALITY = 60;   // JPEG quality for thumbnails

// ── Helper: is the mimetype an image we can process? ─────────────────────────
function isProcessableImage(mimetype: string): boolean {
  return /^image\/(jpeg|jpg|png|gif|webp)$/i.test(mimetype);
}

// ── Core middleware ───────────────────────────────────────────────────────────
export async function processImage(req: Request, res: Response, next: NextFunction) {
  const file = req.file as any;

  // Nothing to process — no file or not an image
  if (!file || !isProcessableImage(file.mimetype)) {
    return next();
  }

  let sharp: any;
  try {
    // Lazy-load sharp so the app still boots if sharp is not yet installed
    sharp = (await import("sharp")).default;
  } catch {
    console.warn(
      "[processImage] sharp not installed — skipping image optimisation.\n" +
      "  Run: npm install sharp   (in the server package)"
    );
    return next();
  }

  try {
    // ── Determine whether we are on disk or in cloud ─────────────────────────
    const isCloud = Boolean(file.location); // cloud upload sets `location`
    const inputBuffer: Buffer = isCloud
      ? await fetchRemoteBuffer(file.location as string)
      : fs.readFileSync(file.path as string);

    // ── Resize full image ────────────────────────────────────────────────────
    const fullBuffer = await sharp(inputBuffer)
      .resize({ width: FULL_MAX_PX, height: FULL_MAX_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: FULL_QUALITY, progressive: true })
      .toBuffer();

    // ── Resize thumbnail ─────────────────────────────────────────────────────
    const thumbBuffer = await sharp(inputBuffer)
      .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, progressive: true })
      .toBuffer();

    if (isCloud) {
      // Re-upload compressed versions to S3/R2
      const fullUrl  = await reuploadToCloud(file, fullBuffer,  file.key  as string);
      const thumbUrl = await reuploadToCloud(file, thumbBuffer, thumbKey(file.key as string));
      // Patch the multer file object so resolveUploadUrl() returns the new URL
      file.location = fullUrl;
      (req as any).thumbnailUrl = thumbUrl;
    } else {
      // Overwrite the disk file with the compressed version
      fs.writeFileSync(file.path as string, fullBuffer);
      file.size = fullBuffer.length;

      // Write thumbnail alongside the original with a "-thumb" suffix
      const thumbPath = thumbKey(file.path as string);
      fs.writeFileSync(thumbPath, thumbBuffer);
      (req as any).thumbnailUrl = `/uploads/${path.basename(thumbPath)}`;
    }

    console.log(
      `[processImage] optimised: ${file.originalname} ` +
      `(${inputBuffer.length} → ${fullBuffer.length} bytes, thumb ${thumbBuffer.length} bytes)`
    );
  } catch (err) {
    // Non-fatal — log and continue so the upload isn't lost
    console.error("[processImage] optimisation failed, using original:", err);
  }

  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a sibling key/path for the thumbnail */
function thumbKey(key: string): string {
  const ext  = path.extname(key);
  const base = key.slice(0, key.length - ext.length);
  return `${base}-thumb.jpg`;
}

/** Fetch a remote file into a Buffer (used when the file is already in cloud) */
async function fetchRemoteBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[processImage] fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Re-upload a buffer to S3/R2 using the same credentials that s3Upload uses.
 * We replicate the minimal PutObject call rather than importing the multer
 * engine internals.
 */
async function reuploadToCloud(
  originalFile: any,
  buffer: Buffer,
  key: string
): Promise<string> {
  const accessKeyId     = process.env.S3_ACCESS_KEY_ID     || process.env.AWS_ACCESS_KEY_ID     || "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
  const bucket          = process.env.S3_BUCKET            || process.env.AWS_S3_BUCKET          || "";
  const region          = process.env.S3_REGION            || process.env.AWS_REGION             || "us-east-1";
  const endpoint        = process.env.S3_ENDPOINT          || "";

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: false } : {}),
  });

  await client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: "image/jpeg",
    ContentDisposition: "inline",
  }));

  return endpoint
    ? `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}
