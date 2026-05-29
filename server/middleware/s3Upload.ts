/**
 * s3Upload — multer middleware that stores files in S3 / Cloudflare R2.
 *
 * When the required environment variables are present the file is streamed
 * directly to the bucket and the returned `req.file.location` (and
 * `req.file.key`) are populated.  When they are absent the middleware falls
 * back to disk storage so the dev environment still works without credentials.
 *
 * Required env vars (S3 or Cloudflare R2):
 *   S3_ACCESS_KEY_ID     — AWS / R2 access-key ID
 *   S3_SECRET_ACCESS_KEY — AWS / R2 secret access key
 *   S3_BUCKET            — bucket name
 *   S3_REGION            — AWS region (e.g. "us-east-1") or "auto" for R2
 *   S3_ENDPOINT          — optional; set to your R2 endpoint for Cloudflare R2
 *                          e.g. https://<account-id>.r2.cloudflarestorage.com
 *
 * Aliases accepted for backward compatibility:
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET / AWS_REGION
 */

import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Request } from "express";

// ── Resolve __dirname for ESM ─────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Allowed MIME / extension list ─────────────────────────────────────────────
const ALLOWED_RE = /jpeg|jpg|png|gif|webp|pdf|txt|csv|doc|docx|xls|xlsx|ppt|pptx/;

// ── Read config from env ───────────────────────────────────────────────────────
const accessKeyId     = process.env.S3_ACCESS_KEY_ID     || process.env.AWS_ACCESS_KEY_ID     || "";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
const bucket          = process.env.S3_BUCKET            || process.env.AWS_S3_BUCKET          || "";
const region          = process.env.S3_REGION            || process.env.AWS_REGION             || "us-east-1";
const endpoint        = process.env.S3_ENDPOINT          || "";           // R2 endpoint (optional)

const useCloud = Boolean(accessKeyId && secretAccessKey && bucket);

// ── Build the multer storage engine ───────────────────────────────────────────
let storageEngine: StorageEngine;
let getFileUrl: (file: Express.Multer.File & { key?: string; location?: string }) => string;

function buildDiskStorage() {
  const uploadsDir = path.join(__dirname, "../../uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  storageEngine = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename:    (_req, file, cb) =>
      cb(null, `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  });
  getFileUrl = (file: any) => `/uploads/${file.filename}`;
}

if (useCloud) {
  // Lazy-load the AWS SDK on first upload to avoid top-level await.
  let s3ClientInstance: any = null;
  let PutObjectCommandClass: any = null;
  let sdkLoadFailed = false;

  const ensureS3 = async (): Promise<boolean> => {
    if (s3ClientInstance) return true;
    if (sdkLoadFailed) return false;
    try {
      const sdk = await import("@aws-sdk/client-s3");
      PutObjectCommandClass = sdk.PutObjectCommand;
      s3ClientInstance = new sdk.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: false } : {}),
      });
      console.log(`[s3Upload] Cloud storage enabled — bucket: ${bucket} region: ${region}${endpoint ? " endpoint: " + endpoint : ""}`);
      return true;
    } catch {
      sdkLoadFailed = true;
      console.warn("[s3Upload] @aws-sdk/client-s3 not installed — falling back to disk storage");
      return false;
    }
  };

  storageEngine = {
    _handleFile(req: Request, file: Express.Multer.File, cb: (error?: any, info?: Partial<Express.Multer.File>) => void) {
      const ext = path.extname(file.originalname).toLowerCase();
      const key = `documents/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

      const chunks: Buffer[] = [];
      file.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      file.stream.on("error", cb);
      file.stream.on("end", async () => {
        const ok = await ensureS3();
        if (!ok) {
          // Fallback: write to disk
          const uploadsDir = path.join(__dirname, "../../uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const diskName = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
          const diskPath = path.join(uploadsDir, diskName);
          try {
            fs.writeFileSync(diskPath, Buffer.concat(chunks));
            cb(null, { filename: diskName, path: diskPath, size: chunks.reduce((s, c) => s + c.length, 0) } as any);
          } catch (writeErr) {
            cb(writeErr);
          }
          return;
        }
        try {
          const body = Buffer.concat(chunks);
          await s3ClientInstance.send(new PutObjectCommandClass({
            Bucket:      bucket,
            Key:         key,
            Body:        body,
            ContentType: file.mimetype,
            ContentDisposition: `inline; filename="${encodeURIComponent(file.originalname)}"`,
          }));
          const location = endpoint
            ? `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`
            : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
          const info: any = { filename: key, path: location, size: body.length, key, location };
          cb(null, info);
        } catch (err) {
          cb(err);
        }
      });
    },
    _removeFile(_req: Request, _file: any, cb: (error?: Error) => void) {
      cb();
    },
  } as StorageEngine;

  getFileUrl = (file: any) => file.location ?? file.path ?? "";
} else {
  buildDiskStorage();
  console.log("[s3Upload] Cloud storage not configured — using local disk storage");
}

// ── Export the configured multer instance ─────────────────────────────────────
export const s3Upload = multer({
  storage: storageEngine!,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext  = ALLOWED_RE.test(path.extname(file.originalname).toLowerCase());
    const mime = ALLOWED_RE.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error("File type not allowed"));
  },
});

/**
 * Given the multer file object (after s3Upload middleware has run),
 * returns the public URL of the uploaded file.
 */
export function resolveUploadUrl(file: Express.Multer.File & { key?: string; location?: string }): string {
  return getFileUrl!(file);
}
