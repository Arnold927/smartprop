/**
 * upload.ts — compatibility shim
 *
 * ⚠️  This file previously wrote files to the local ./uploads directory.
 *     It has been replaced by the S3/R2-aware middleware in s3Upload.ts.
 *
 * All route files should import from s3Upload:
 *
 *   import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
 *
 * This shim re-exports s3Upload as `upload` so any accidental import of this
 * module still works correctly (cloud storage when env vars are set, disk
 * fallback in dev when they are not).
 */
export { s3Upload as upload, resolveUploadUrl } from "./s3Upload";
