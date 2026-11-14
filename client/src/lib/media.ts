/**
 * Shared photo/video helpers used by every portal (see server/routes/media.ts for who may see what).
 *
 *   uploadMedia / uploadAll   send files to /api/media/upload with progress (one request per file,
 *                             so a flaky mobile connection only retries the file that failed)
 *   compressImage             shrinks phone photos in the browser before upload (saves data on
 *                             mobile networks; videos and GIFs are sent as they are)
 *   useEntityMedia            list the files attached to a record
 */
import { useQuery } from "@tanstack/react-query";
import { API_BASE, getAuthHeader, refreshAccessToken, apiRequest } from "@/lib/queryClient";

export type MediaEntityType = "maintenance_request" | "work_order" | "construction_update";
export type MediaLabel = "issue" | "before" | "after" | "progress";

export interface MediaItem {
  id: number;
  kind: "image" | "video";
  url: string;
  thumbnailUrl?: string | null;
  label?: MediaLabel | null;
  caption?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedBy: string;
  canRemove?: boolean;
  uploaderRole?: string | null;
  createdAt?: string | null;
}

export const MAX_IMAGE_MB = 15;
export const MAX_VIDEO_MB = 60;
export const MAX_FILES_PER_BATCH = 10;

export const isVideoFile = (f: { type: string }) => f.type.startsWith("video/");

/** Returns a human message when the file can't be uploaded, otherwise null. */
export function validateMediaFile(f: File): string | null {
  const video = isVideoFile(f);
  if (!video && !f.type.startsWith("image/")) return `${f.name}: only photos and videos can be added.`;
  const mb = f.size / 1024 / 1024;
  if (video && mb > MAX_VIDEO_MB) return `${f.name}: videos can be up to ${MAX_VIDEO_MB} MB (this one is ${Math.round(mb)} MB). Try a shorter clip.`;
  // Images are compressed first, so only reject ones that are huge even before that.
  if (!video && mb > 40) return `${f.name}: this photo is too large.`;
  return null;
}

/** Shrinks big photos to max 1920px JPEG. Falls back to the original when the browser can't decode it (e.g. HEIC on Chrome). */
export async function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 700 * 1024) { bmp.close?.(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close?.(); return file; }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export interface UploadOptions {
  entityType: MediaEntityType;
  entityId: number;
  label?: MediaLabel | null;
  caption?: string;
}

function sendOnce(file: File, opts: UploadOptions, onProgress?: (pct: number) => void): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("entityType", opts.entityType);
    fd.append("entityId", String(opts.entityId));
    if (opts.label) fd.append("label", opts.label);
    if (opts.caption) fd.append("caption", opts.caption);
    fd.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/media/upload`);
    Object.entries(getAuthHeader()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.withCredentials = true;
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.ontimeout = () => reject(new Error("The upload timed out. Try again on a stronger connection."));
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      resolve({ status: xhr.status, body });
    };
    xhr.send(fd);
  });
}

/** Uploads one file (compressing photos first). Retries once after a token refresh. */
export async function uploadMedia(file: File, opts: UploadOptions, onProgress?: (pct: number) => void): Promise<MediaItem> {
  const bad = validateMediaFile(file);
  if (bad) throw new Error(bad);
  const prepared = isVideoFile(file) ? file : await compressImage(file);
  let r = await sendOnce(prepared, opts, onProgress);
  if (r.status === 401 && (await refreshAccessToken())) r = await sendOnce(prepared, opts, onProgress);
  if (r.status >= 200 && r.status < 300 && Array.isArray(r.body) && r.body[0]) return r.body[0] as MediaItem;
  throw new Error(r.body?.message || (r.status === 413 ? "That file is too large." : "Upload failed. Please try again."));
}

export interface UploadAllResult { ok: MediaItem[]; failed: { file: File; error: string }[] }

/** Uploads several files one after another. Never throws: failures come back in `failed`. */
export async function uploadAll(
  files: File[],
  opts: UploadOptions,
  onFile?: (index: number, state: { pct: number; done?: boolean; error?: string }) => void,
): Promise<UploadAllResult> {
  const out: UploadAllResult = { ok: [], failed: [] };
  for (let i = 0; i < files.length; i++) {
    try {
      const item = await uploadMedia(files[i], opts, pct => onFile?.(i, { pct }));
      out.ok.push(item);
      onFile?.(i, { pct: 100, done: true });
    } catch (e: any) {
      out.failed.push({ file: files[i], error: e?.message || "Upload failed" });
      onFile?.(i, { pct: 0, error: e?.message || "Upload failed" });
    }
  }
  return out;
}

/** Prefix key: invalidating ["/api/media", type, id] refreshes both the plain and the includeWork lists. */
export function mediaQueryKey(type: MediaEntityType, id: number | null | undefined) {
  return ["/api/media", type, id ?? 0] as const;
}

/** includeWork: for a maintenance request, also list the contractor's work-order files (read-only views). */
export function useEntityMedia(type: MediaEntityType, id: number | null | undefined, opts: { enabled?: boolean; includeWork?: boolean } = {}) {
  const { enabled = true, includeWork = false } = opts;
  return useQuery<{ canAdd: boolean; items: MediaItem[] }>({
    queryKey: [...mediaQueryKey(type, id), includeWork ? "withWork" : "own"],
    enabled: enabled && !!id,
    staleTime: 60_000,
    queryFn: async () =>
      (await apiRequest(`/api/media?entityType=${type}&entityId=${id}${includeWork ? "&includeWork=1" : ""}`)).json(),
  });
}

export const LABEL_TEXT: Record<MediaLabel, string> = { issue: "Issue", before: "Before", after: "After", progress: "Progress" };
