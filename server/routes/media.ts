/**
 * Shared photo / video attachments — mounted at /api/media
 *
 *   POST   /api/media/upload     multipart: files[] (≤10), entityType, entityId, label?, caption?
 *   GET    /api/media            ?entityType=&entityId=[&includeWork=1]   — list (signed URLs); includeWork adds a request's work-order files
 *   DELETE /api/media/:id
 *
 * entityType: maintenance_request | work_order | construction_update
 *
 * WHO CAN SEE / ADD (decided by the record the media hangs off, never by the file itself):
 *   maintenance_request  admin·manager·staff  read+add  (their organisation)
 *                        caretaker            read+add  (their assigned property)
 *                        landlord             read      (properties they own)
 *                        tenant               read+add  (their own request)
 *                        contractor           read+add  (requests assigned to them)
 *   work_order           admin·manager·staff  read+add
 *                        contractor           read+add  (their own work orders)
 *                        caretaker/landlord   read      (their property / properties they own)
 *                        tenant               read      (the tenant who raised the linked request)
 *   construction_update  admin·manager        read+add
 *                        diaspora buyer       read      (their own contract)
 *                        landlord             read      (properties they own)
 *
 * Delete: the uploader, or admin/manager of the organisation.
 *
 * Storage: Cloudinary when CLOUDINARY_* is set (files are stored as "authenticated" assets, so a
 * bare link does not work — every URL we return is signed). Without Cloudinary: local disk in
 * development, 503 in production (the disk on the host is ephemeral).
 */
import { Router } from "express";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  mediaAttachments, maintenanceRequests, workOrders, units, properties, contractors, tenants,
  constructionUpdates, diasporaContracts, users,
} from "@shared/schema";
import { and, eq, asc, inArray } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// ── Limits & types ───────────────────────────────────────────────────────────
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 60 * 1024 * 1024;
const MAX_PER_ENTITY = 40;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm", "video/3gpp"]);
const ENTITY_TYPES = ["maintenance_request", "work_order", "construction_update"] as const;
type EntityType = typeof ENTITY_TYPES[number];
const LABELS = new Set(["issue", "before", "after", "progress"]);

const upload = multer({
  dest: path.join(os.tmpdir(), "smartprop-media"),
  limits: { fileSize: VIDEO_MAX, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype) || VIDEO_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type (${file.mimetype}). Use JPG, PNG, WebP, HEIC, MP4, MOV or WebM.`));
  },
});

// ── Cloudinary ───────────────────────────────────────────────────────────────
async function getCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return null;
  const { v2: cloudinary } = await import("cloudinary");
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
  return cloudinary;
}

/** Signed delivery URLs. Stored rows only keep the public_id; the links are built per request. */
function withUrls(cloudinary: any, row: any) {
  if (row.storage !== "cloudinary" || !cloudinary || !row.publicId) {
    return { ...row, thumbnailUrl: row.kind === "image" ? row.url : null };
  }
  const base = { type: "authenticated", sign_url: true, secure: true };
  if (row.kind === "video") {
    return {
      ...row,
      // MP4 uploads play as they are (no transcoding wait). MOV / WebM / 3GP (e.g. iPhone clips) are converted to H.264 MP4 so every browser can play them.
      url: row.mimeType === "video/mp4"
        ? cloudinary.url(row.publicId, { ...base, resource_type: "video", format: "mp4" })
        : cloudinary.url(row.publicId, { ...base, resource_type: "video", format: "mp4", transformation: [{ video_codec: "h264", quality: "auto" }] }),
      thumbnailUrl: cloudinary.url(row.publicId, { ...base, resource_type: "video", format: "jpg", transformation: [{ width: 480, height: 360, crop: "fill", start_offset: "0" }] }),
    };
  }
  return {
    ...row,
    url: cloudinary.url(row.publicId, { ...base, resource_type: "image", fetch_format: "auto", quality: "auto", transformation: [{ width: 1920, crop: "limit" }] }),
    thumbnailUrl: cloudinary.url(row.publicId, { ...base, resource_type: "image", fetch_format: "auto", quality: "auto", transformation: [{ width: 480, height: 360, crop: "fill" }] }),
  };
}

// ── Access rules ─────────────────────────────────────────────────────────────
type Access = { read: boolean; write: boolean };
const NONE: Access = { read: false, write: false };
const STAFFISH = new Set(["admin", "manager", "staff", "platform_admin"]);

async function contractorIdFor(req: any): Promise<number | null> {
  const email = String(req.user.email ?? "").toLowerCase();
  if (!email) return null;
  const [c] = await db.select({ id: contractors.id }).from(contractors)
    .where(and(eq(contractors.email, email), eq(contractors.organizationId, req.user.organizationId))).limit(1);
  return c?.id ?? null;
}

/** Role-based access to one property (caretaker / landlord are scoped, staff-ish see the whole org). */
async function propertyAccess(req: any, property: { id: number; organizationId: number; ownerId: string | null } | undefined, staffWrite = true): Promise<Access> {
  if (!property || property.organizationId !== req.user.organizationId) return NONE;
  const role: string = req.user.role;
  const userId = String(req.user.id ?? req.user.userId ?? "");
  if (STAFFISH.has(role)) return { read: true, write: staffWrite };
  if (role === "landlord") return { read: property.ownerId === userId, write: false };
  if (role === "caretaker") {
    const c = await storage.getCaretakerByUserId(userId);
    const ok = !!c?.propertyId && c.propertyId === property.id;
    return { read: ok, write: ok && staffWrite };
  }
  return NONE;
}

async function resolveAccess(req: any, entityType: EntityType, entityId: number): Promise<Access> {
  const role: string = req.user.role;
  const userId = String(req.user.id ?? req.user.userId ?? "");
  const orgId: number = req.user.organizationId;

  if (entityType === "maintenance_request") {
    const [row] = await db
      .select({ req: maintenanceRequests, property: properties })
      .from(maintenanceRequests)
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(maintenanceRequests.id, entityId)).limit(1);
    if (!row || !row.property || row.property.organizationId !== orgId) return NONE;
    if (role === "tenant") {
      const [t] = await db.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, orgId))).limit(1);
      const own = !!t && t.id === row.req.tenantId;
      return { read: own, write: own };
    }
    if (role === "contractor") {
      const cid = await contractorIdFor(req);
      if (!cid) return NONE;
      let assigned = row.req.contractorId === cid;
      if (!assigned) {
        const [wo] = await db.select({ id: workOrders.id }).from(workOrders)
          .where(and(eq(workOrders.maintenanceRequestId, entityId), eq(workOrders.contractorId, cid))).limit(1);
        assigned = !!wo;
      }
      return { read: assigned, write: assigned };
    }
    return propertyAccess(req, row.property);
  }

  if (entityType === "work_order") {
    const [row] = await db
      .select({ wo: workOrders, mr: maintenanceRequests, property: properties })
      .from(workOrders)
      .leftJoin(maintenanceRequests, eq(workOrders.maintenanceRequestId, maintenanceRequests.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(workOrders.id, entityId)).limit(1);
    if (!row) return NONE;
    if (role === "contractor") {
      const cid = await contractorIdFor(req);
      const own = !!cid && row.wo.contractorId === cid;
      return { read: own, write: own };
    }
    if (role === "tenant") {
      if (!row.mr) return NONE;
      const [t] = await db.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, orgId))).limit(1);
      return { read: !!t && t.id === row.mr.tenantId, write: false };
    }
    if (STAFFISH.has(role) && !row.property) {
      // Work order not tied to a property (e.g. project work): decide by the organisation of whoever created it.
      const [creator] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, row.wo.createdBy)).limit(1);
      return creator?.organizationId === orgId ? { read: true, write: true } : NONE;
    }
    const acc = await propertyAccess(req, row.property ?? undefined);
    // Caretakers and landlords may look at the evidence but not change it.
    return role === "caretaker" || role === "landlord" ? { read: acc.read, write: false } : acc;
  }

  if (entityType === "construction_update") {
    const [row] = await db
      .select({ upd: constructionUpdates, contract: diasporaContracts, property: properties })
      .from(constructionUpdates)
      .leftJoin(diasporaContracts, eq(constructionUpdates.diasporaContractId, diasporaContracts.id))
      .leftJoin(properties, eq(diasporaContracts.propertyId, properties.id))
      .where(eq(constructionUpdates.id, entityId)).limit(1);
    if (!row?.contract || row.contract.organizationId !== orgId) return NONE;
    if (role === "admin" || role === "manager" || role === "platform_admin") return { read: true, write: true };
    if (row.contract.buyerUserId && row.contract.buyerUserId === userId) return { read: true, write: false };
    if (role === "landlord" && row.property && row.property.ownerId === userId) return { read: true, write: false };
    return NONE;
  }
  return NONE;
}

const parseEntity = (type: unknown, id: unknown): { type: EntityType; id: number } | null => {
  const t = String(type ?? "") as EntityType;
  const n = Number(id);
  if (!ENTITY_TYPES.includes(t) || !Number.isInteger(n) || n < 1) return null;
  return { type: t, id: n };
};

const cleanup = (files: Express.Multer.File[]) => files.forEach(f => fs.promises.unlink(f.path).catch(() => {}));

// ── POST /upload ─────────────────────────────────────────────────────────────
router.post("/upload", (req: any, res: any, next: any) => {
  upload.array("files", 10)(req, res, (err: any) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File too large (images up to 15 MB, videos up to 60 MB)." : err.message || "Upload failed";
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: msg });
  });
}, async (req: any, res: any) => {
  const files: Express.Multer.File[] = req.files ?? [];
  try {
    if (!files.length) return res.status(400).json({ message: "No files received." });
    const type = String(req.body.entityType ?? "") as EntityType;
    if (!ENTITY_TYPES.includes(type)) return res.status(400).json({ message: "Invalid entityType." });
    const orgId: number = req.user.organizationId;
    const userId = String(req.user.id ?? req.user.userId);
    const role: string = req.user.role;

    const entityId = Number(req.body.entityId);
    if (!Number.isInteger(entityId) || entityId < 1) return res.status(400).json({ message: "entityId is required." });
    const acc = await resolveAccess(req, type, entityId);
    if (!acc.write) return res.status(403).json({ message: "You can't add media here." });
    const existing = await db.select({ id: mediaAttachments.id }).from(mediaAttachments)
      .where(and(eq(mediaAttachments.entityType, type), eq(mediaAttachments.entityId, entityId)));
    if (existing.length + files.length > MAX_PER_ENTITY) return res.status(400).json({ message: `Up to ${MAX_PER_ENTITY} files per record.` });

    const label = LABELS.has(String(req.body.label)) ? String(req.body.label) : null;
    const caption = req.body.caption ? String(req.body.caption).slice(0, 300) : null;
    const cloudinary = await getCloudinary();
    if (!cloudinary && process.env.NODE_ENV === "production") {
      return res.status(503).json({ message: "Media upload is not configured on this server (Cloudinary keys missing)." });
    }

    const saved: any[] = [];
    for (const f of files) {
      const kind = VIDEO_MIME.has(f.mimetype) ? "video" : "image";
      if (kind === "image" && f.size > IMAGE_MAX) { return res.status(413).json({ message: `${f.originalname}: images can be up to 15 MB.` }); }
      let url: string; let publicId: string | null = null; let store = "cloudinary";
      if (cloudinary) {
        const r: any = await cloudinary.uploader.upload(f.path, {
          resource_type: kind, type: "authenticated",
          folder: `smartprop/media/${orgId}/${type}`, use_filename: false, unique_filename: true, overwrite: false, timeout: 120000,
        });
        url = r.secure_url; publicId = r.public_id;
      } else {
        const dir = path.join(__dirname, "../../uploads/media", String(orgId));
        await fs.promises.mkdir(dir, { recursive: true });
        const ext = path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || (kind === "video" ? ".mp4" : ".jpg");
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        await fs.promises.copyFile(f.path, path.join(dir, name));
        url = `/uploads/media/${orgId}/${name}`; store = "local";
      }
      const [row] = await db.insert(mediaAttachments).values({
        organizationId: orgId, entityType: type, entityId, kind, url, publicId, storage: store,
        mimeType: f.mimetype, sizeBytes: f.size, label, caption, uploadedBy: userId as any, uploaderRole: role,
      }).returning();
      saved.push({ ...withUrls(cloudinary, row), canRemove: true });
    }
    res.status(201).json(saved);
  } catch (err: any) {
    logger.error("media upload failed", { err: String(err?.message ?? err) });
    res.status(500).json({ message: "Upload failed. Please try again." });
  } finally {
    cleanup(files); // temp files are removed on every path: success, refusal (403/400/413) or error
  }
});

// ── GET / ────────────────────────────────────────────────────────────────────
router.get("/", async (req: any, res: any) => {
  try {
    const ent = parseEntity(req.query.entityType, req.query.entityId);
    if (!ent) return res.status(400).json({ message: "entityType and entityId are required." });
    const acc = await resolveAccess(req, ent.type, ent.id);
    if (!acc.read) return res.status(403).json({ message: "You don't have access to this media." });
    let rows = await db.select().from(mediaAttachments)
      .where(and(eq(mediaAttachments.entityType, ent.type), eq(mediaAttachments.entityId, ent.id), eq(mediaAttachments.organizationId, req.user.organizationId)))
      .orderBy(asc(mediaAttachments.createdAt));
    // includeWork=1 on a request also returns the contractor's before/progress/after files from its work orders,
    // so tenants, landlords and caretakers see the proof of work next to the original report.
    if (ent.type === "maintenance_request" && req.query.includeWork === "1") {
      const wos = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.maintenanceRequestId, ent.id));
      if (wos.length) {
        const more = await db.select().from(mediaAttachments)
          .where(and(eq(mediaAttachments.entityType, "work_order"), inArray(mediaAttachments.entityId, wos.map(w => w.id)), eq(mediaAttachments.organizationId, req.user.organizationId)));
        rows = [...rows, ...more].sort((a, b) => +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0));
      }
    }
    const cloudinary = await getCloudinary();
    const userId = String(req.user.id ?? req.user.userId);
    const boss = ["admin", "manager", "platform_admin"].includes(req.user.role);
    res.json({
      canAdd: acc.write,
      // The uploader (while they can still write to the record) or a manager may remove a file.
      items: rows.map(r => ({ ...withUrls(cloudinary, r), canRemove: boss || (acc.write && r.uploadedBy === userId) })),
    });
  } catch (err: any) {
    logger.error("media list failed", { err: String(err?.message ?? err) });
    res.status(500).json({ message: "Failed to load media." });
  }
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id." });
    const [row] = await db.select().from(mediaAttachments)
      .where(and(eq(mediaAttachments.id, id), eq(mediaAttachments.organizationId, req.user.organizationId))).limit(1);
    if (!row) return res.status(404).json({ message: "Not found." });
    const userId = String(req.user.id ?? req.user.userId);
    const mine = row.uploadedBy === userId;
    const boss = req.user.role === "admin" || req.user.role === "manager" || req.user.role === "platform_admin";
    if (!mine && !boss) return res.status(403).json({ message: "Only the uploader or a manager can remove this." });
    if (mine && !boss && row.entityId) {
      // Uploaders lose the right once they can no longer write to the record (e.g. contractor unassigned).
      const acc = await resolveAccess(req, row.entityType as EntityType, row.entityId);
      if (!acc.write) return res.status(403).json({ message: "You can't change this record any more." });
    }
    await db.delete(mediaAttachments).where(eq(mediaAttachments.id, id));
    if (row.storage === "cloudinary" && row.publicId) {
      getCloudinary().then(c => c?.uploader.destroy(row.publicId!, { resource_type: row.kind, type: "authenticated", invalidate: true }))
        .catch(e => logger.warn("media: cloudinary destroy failed", { err: String(e) }));
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error("media delete failed", { err: String(err?.message ?? err) });
    res.status(500).json({ message: "Failed to delete." });
  }
});

export default router;
