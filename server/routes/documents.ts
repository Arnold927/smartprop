/**
 * Documents router — mounted at /api/documents
 *
 * Changes vs. original:
 *  1. requireOrg guard on every route.
 *  2. GET / is org-scoped (documents tied to org's properties/tenants only)
 *     and supports server-side pagination (?page=&limit=).
 *  3. GET /:id/download verifies the document belongs to the caller's org.
 *  4. DELETE /:id is org-scoped.
 *  5. POST (upload) stamps organizationId on the record.
 */
import { Router } from "express";
import { db } from "../db";
import {
  documents, tenants, properties, units,
  insertDocumentSchema,
} from "@shared/schema";
import { eq, and, or, count, inArray, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
import { notifyTenant } from "../services/notifyTenant";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Use the S3/R2-aware upload middleware (falls back to disk when env vars absent)
const upload = s3Upload;

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

/** Condition: document belongs to a tenant or property owned by orgId */
function orgDocCondition(orgId: number) {
  return or(
    eq(tenants.organizationId, orgId),
    eq(properties.organizationId, orgId),
  );
}

// ── GET /api/documents ───────────────────────────────────────────────────────
// ?tenantId=  &propertyId=  &page=1  &limit=20
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";
    let tenantId   = req.query.tenantId   ? parseInt(req.query.tenantId   as string) : undefined;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;

    // A tenant may only ever see their OWN documents — resolve their tenantId
    // from the JWT and ignore whatever (if anything) was passed in the query.
    if (role === "tenant") {
      const [own] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.userId, req.user.id))
        .limit(1);
      if (!own) return res.json({ count: 0, page: 1, limit: 20, next: null, previous: null, results: [] });
      tenantId = own.id;
    }

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const conditions: any[] = [orgDocCondition(orgId)];
    if (tenantId)   conditions.push(eq(documents.tenantId,   tenantId));
    if (propertyId) conditions.push(eq(documents.propertyId, propertyId));

    // Landlords only ever see documents tied to their own properties —
    // previously this endpoint only scoped by org, so a landlord saw every
    // document in the org (leases, ID scans, everything) regardless of
    // whose property or tenant it belonged to. A document can be linked
    // either via tenantId or directly via propertyId, so both paths are
    // covered here.
    if (role === "landlord") {
      const ownedProps = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id)));
      const ownedPropIds = ownedProps.map(p => p.id);

      const ownedTenants = ownedPropIds.length > 0
        ? await db.select({ id: tenants.id }).from(tenants).innerJoin(units, eq(tenants.unitId, units.id)).where(inArray(units.propertyId, ownedPropIds))
        : [];
      const ownedTenantIds = ownedTenants.map(t => t.id);

      if (ownedPropIds.length === 0 && ownedTenantIds.length === 0) {
        return res.json({ count: 0, page, limit, next: null, previous: null, results: [] });
      }
      conditions.push(
        or(
          ownedPropIds.length   > 0 ? inArray(documents.propertyId, ownedPropIds)   : sql`false`,
          ownedTenantIds.length > 0 ? inArray(documents.tenantId,   ownedTenantIds) : sql`false`,
        )
      );
    }

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ doc: documents })
        .from(documents)
        .leftJoin(tenants,     eq(documents.tenantId,   tenants.id))
        .leftJoin(properties,  eq(documents.propertyId, properties.id))
        .where(and(...conditions))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(documents)
        .leftJoin(tenants,     eq(documents.tenantId,   tenants.id))
        .leftJoin(properties,  eq(documents.propertyId, properties.id))
        .where(and(...conditions)),
    ]);

    res.json({
      count:    total,
      page,
      limit,
      next:     page * limit < total ? `?page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?page=${page - 1}&limit=${limit}` : null,
      results:  rows.map(r => r.doc),
    });
  } catch (error) {
    console.error("Get documents error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// ── POST /api/documents ──────────────────────────────────────────────────────
router.post("/", authenticateJWT, requireOrg, upload.single("file"), auditLog("document", "CREATE"), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const userId = req.user.userId || req.user.id;
    const role: string = req.user.role ?? "";

    let tenantId = req.body.tenantId ? Number(req.body.tenantId) : undefined;
    if (role === "tenant") {
      const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, userId)).limit(1);
      if (!own) return res.status(403).json({ message: "Tenant profile not found" });
      tenantId = own.id;
    }

    const validated = insertDocumentSchema.parse({
      name:        req.body.name ?? req.file.originalname,
      type:        req.body.type ?? "document",
      url:         resolveUploadUrl(req.file as any),
      uploadedBy:  String(userId),
      size:        req.file.size,
      tenantId,
      propertyId:  req.body.propertyId ? Number(req.body.propertyId) : undefined,
    });

    const [doc] = await db.insert(documents).values(validated).returning();

    // Notify the tenant if this document is linked to one
    if (validated.tenantId) {
      notifyTenant(validated.tenantId, {
        type:         "document_uploaded",
        documentName: validated.name,
        documentType: validated.type,
      }).catch(() => {}); // non-fatal
    }

    res.status(201).json(doc);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.errors });
    }
    console.error("Upload document error:", error);
    res.status(500).json({ message: "Failed to upload document" });
  }
});

// ── POST /api/documents/upload (legacy alias) ─────────────────────────────────
router.post("/upload", authenticateJWT, requireOrg, upload.single("file"), auditLog("document", "CREATE"), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const userId = req.user.userId || req.user.id;
    const [doc] = await db
      .insert(documents)
      .values({
        name:       req.body.name ?? req.file.originalname,
        type:       req.body.type ?? "document",
        url:        resolveUploadUrl(req.file as any),
        uploadedBy: String(userId),
        size:       req.file.size,
        tenantId:   req.body.tenantId   ? Number(req.body.tenantId)   : undefined,
        propertyId: req.body.propertyId ? Number(req.body.propertyId) : undefined,
      })
      .returning();

    res.status(201).json(doc);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ── GET /api/documents/:id/download ──────────────────────────────────────────
/** Resolves whether the caller may access a specific document — org-scoped
 *  always, plus tenant self-ownership or landlord property-ownership on top
 *  when applicable. Previously GET /:id/download and DELETE /:id only
 *  checked org membership, so a tenant could download/delete another
 *  tenant's private documents by id, and a landlord could reach any other
 *  landlord's, despite the list view (GET /) already correctly scoping both. */
async function resolveDocumentAccess(docId: number, req: any): Promise<boolean> {
  const orgId: number = req.user.organizationId;
  const role: string  = req.user.role ?? "";

  const [row] = await db
    .select({ id: documents.id, tenantId: documents.tenantId, propertyId: documents.propertyId })
    .from(documents)
    .leftJoin(tenants,    eq(documents.tenantId,   tenants.id))
    .leftJoin(properties, eq(documents.propertyId, properties.id))
    .where(and(eq(documents.id, docId), orgDocCondition(orgId)))
    .limit(1);
  if (!row) return false;

  if (role === "tenant") {
    const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
    return !!own && row.tenantId === own.id;
  }

  if (role === "landlord") {
    let propertyId = row.propertyId ?? undefined;
    if (!propertyId && row.tenantId) {
      const [tenant] = await db.select({ unitId: tenants.unitId }).from(tenants).where(eq(tenants.id, row.tenantId)).limit(1);
      if (tenant?.unitId) {
        const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, tenant.unitId)).limit(1);
        propertyId = unit?.propertyId ?? undefined;
      }
    }
    if (!propertyId) return false;
    const [prop] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, propertyId)).limit(1);
    return !!prop && prop.ownerId === req.user.id;
  }

  return true; // admin/manager/staff — org membership already confirmed above
}

router.get("/:id/download", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id    = Number(req.params.id);
    const orgId: number = req.user.organizationId;

    const allowed = await resolveDocumentAccess(id, req);
    if (!allowed) return res.status(404).json({ message: "Document not found" });

    const [row] = await db
      .select({ doc: documents })
      .from(documents)
      .leftJoin(tenants,    eq(documents.tenantId,   tenants.id))
      .leftJoin(properties, eq(documents.propertyId, properties.id))
      .where(and(eq(documents.id, id), orgDocCondition(orgId)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Document not found" });

    // Cloud URL → redirect; local path → serve file
    const docUrl = row.doc.url;
    if (docUrl.startsWith("http://") || docUrl.startsWith("https://")) {
      return res.redirect(302, docUrl);
    }
    const filePath = path.resolve(docUrl.startsWith("/") ? `.${docUrl}` : docUrl);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found on server" });
    }
    res.download(filePath, row.doc.name);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ message: "Failed to download document" });
  }
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────
router.delete("/:id", authenticateJWT, requireOrg, auditLog("document", "DELETE"), async (req: any, res) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const allowed = await resolveDocumentAccess(id, req);
    if (!allowed) return res.status(404).json({ message: "Document not found" });

    // Confirm ownership before deleting
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .leftJoin(tenants,    eq(documents.tenantId,   tenants.id))
      .leftJoin(properties, eq(documents.propertyId, properties.id))
      .where(and(eq(documents.id, id), orgDocCondition(orgId)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Document not found" });

    await storage.deleteDocument(id);
    res.status(204).send();
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({ message: "Failed to delete document" });
  }
});

export default router;