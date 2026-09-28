/**
 * File upload route — mounted at /api/upload
 *
 * POST /api/upload/media
 *   Accepts a multipart file (field name: "file"), streams it to Cloudinary,
 *   and returns the secure public URL. WhatsApp's Cloud API can then pull it.
 *
 * Allowed MIME types: images (JPEG, PNG, GIF, WEBP), PDF, MP4
 * Max file size: 10 MB (WhatsApp limit for most media types)
 *
 * Requires env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

// ── Allowed types & size cap ──────────────────────────────────────────────────

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg':       'image',
  'image/png':        'image',
  'image/gif':        'image',
  'image/webp':       'image',
  'application/pdf':  'raw',   // Cloudinary resource_type for non-media binary
  'video/mp4':        'video',
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Multer: memory storage so we can stream the buffer to Cloudinary ──────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WEBP, PDF, MP4.`));
    }
  },
});

// ── Lazy Cloudinary initialisation ────────────────────────────────────────────
// We import dynamically so the server still boots without the env vars set —
// the endpoint will return a clear 503 instead of crashing on startup.

async function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return null;
  }
  const { v2: cloudinary } = await import('cloudinary');
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key:    CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure:     true,
  });
  return cloudinary;
}

// ── Helper: stream a Buffer to Cloudinary ─────────────────────────────────────

function uploadBufferToCloudinary(
  cloudinary: any,
  buffer: Buffer,
  options: Record<string, unknown>
): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (err: any, result: any) => {
      if (err) return reject(err);
      resolve(result);
    });
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

// ── POST /api/upload/media ────────────────────────────────────────────────────

router.post(
  '/media',
  authenticateJWT as any,
  upload.single('file'),
  async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file received. Send a multipart/form-data request with field name "file".' });
      }

      const cloudinary = await getCloudinary();
      if (!cloudinary) {
        return res.status(503).json({
          message: 'File upload is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your environment.',
        });
      }

      const mime = req.file.mimetype;
      const resourceType: string = mime === 'video/mp4' ? 'video' : mime === 'application/pdf' ? 'raw' : 'image';

      const result = await uploadBufferToCloudinary(cloudinary, req.file.buffer, {
        resource_type: resourceType,
        // Default stays 'whatsapp' (this route's original purpose); callers may ask for one other known folder.
        folder:        `smartprop/${req.query.folder === 'inspections' ? 'inspections' : 'whatsapp'}/${req.user.organizationId}`,
        // Use original filename (sanitised) so Cloudinary preserves the extension
        // which is required for PDFs and videos to be served with the right Content-Type.
        use_filename:      true,
        unique_filename:   true,
        overwrite:         false,
      });

      res.json({
        url:        result.secure_url,
        public_id:  result.public_id,
        size:       req.file.size,
        mime:       mime,
      });
    } catch (err: any) {
      console.error('[Upload] Cloudinary error:', err);
      // Multer file-too-large error
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: `File too large. Maximum size is ${MAX_BYTES / 1024 / 1024} MB.` });
      }
      res.status(500).json({ message: err.message || 'Upload failed' });
    }
  }
);

export default router;