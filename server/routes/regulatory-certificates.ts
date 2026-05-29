/**
 * regulatory-certificates.ts — mounted at /api/regulatory-certificates
 *
 * Full CRUD for NEMA / NCA / County regulatory certificates scoped to a
 * property. Also exposes a portfolio-wide expiry dashboard.
 *
 * Routes:
 *   GET    /                        list all certs for org (query: propertyId, authority, status)
 *   GET    /expiring                certs expiring within ?days=90 across the org
 *   GET    /:id                     single cert
 *   POST   /                        create
 *   PATCH  /:id                     update
 *   DELETE /:id                     delete
 *
 * All routes require authenticateJWT + requireOrg.
 */

import { Router } from "express";
import { db }     from "../db";
import {
  regulatoryCertificates,
  properties,
  projects,
  insertRegulatoryCertificateSchema,
} from "@shared/schema";
import { eq, and, lte, gte, desc, isNotNull, or, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { z } from "zod";
import { addDays, format } from "date-fns";

export const regulatoryCertsRouter = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function daysFromNow(n: number): string {
  return format(addDays(new Date(), n), "yyyy-MM-dd");
}

/** Compute days until expiry (negative = already expired) */
function daysUntil(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const ms = new Date(expiryDate).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** Add computed fields to each certificate row */
function enrichCert(cert: any) {
  const days = daysUntil(cert.expiryDate);
  return {
    ...cert,
    daysUntilExpiry: days,
    isExpired:       days !== null && days < 0,
    isExpiringSoon:  days !== null && days >= 0 && days <= 90,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/regulatory-certificates
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId:      number  = req.user.organizationId;
    const propertyId: number | undefined = req.query.propertyId ? parseInt(req.query.propertyId) : undefined;
    const authority:  string | undefined = req.query.authority as string | undefined;
    const status:     string | undefined = req.query.status    as string | undefined;

    const conditions: any[] = [eq(regulatoryCertificates.organizationId, orgId)];
    if (propertyId) conditions.push(eq(regulatoryCertificates.propertyId, propertyId));
    if (authority)  conditions.push(eq(regulatoryCertificates.authority, authority as any));
    if (status)     conditions.push(eq(regulatoryCertificates.status, status as any));

    const rows = await db
      .select({
        cert:          regulatoryCertificates,
        propertyName:  properties.name,
        propertyAddress: properties.address,
        projectName:   projects.name,
      })
      .from(regulatoryCertificates)
      .leftJoin(properties, eq(regulatoryCertificates.propertyId, properties.id))
      .leftJoin(projects,   eq(regulatoryCertificates.projectId,  projects.id))
      .where(and(...conditions))
      .orderBy(desc(regulatoryCertificates.expiryDate));

    res.json(rows.map(r => enrichCert({
      ...r.cert,
      propertyName:    r.propertyName,
      propertyAddress: r.propertyAddress,
      projectName:     r.projectName,
    })));
  } catch (err: any) {
    console.error("[RegCerts] GET / error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/regulatory-certificates/expiring?days=90
// Returns all certs expiring within N days across the whole org (dashboard view)
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.get("/expiring", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const days:  number = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 90));

    const cutoff = daysFromNow(days);

    const rows = await db
      .select({
        cert:          regulatoryCertificates,
        propertyName:  properties.name,
        propertyAddress: properties.address,
      })
      .from(regulatoryCertificates)
      .leftJoin(properties, eq(regulatoryCertificates.propertyId, properties.id))
      .where(and(
        eq(regulatoryCertificates.organizationId, orgId),
        isNotNull(regulatoryCertificates.expiryDate),
        lte(regulatoryCertificates.expiryDate, cutoff),
        or(
          eq(regulatoryCertificates.status, "active"),
          eq(regulatoryCertificates.status, "under_review"),
        ),
      ))
      .orderBy(regulatoryCertificates.expiryDate);

    res.json(rows.map(r => enrichCert({
      ...r.cert,
      propertyName:    r.propertyName,
      propertyAddress: r.propertyAddress,
    })));
  } catch (err: any) {
    console.error("[RegCerts] GET /expiring error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/regulatory-certificates/:id
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id:    number = parseInt(req.params.id);

    const [row] = await db
      .select({
        cert:          regulatoryCertificates,
        propertyName:  properties.name,
        propertyAddress: properties.address,
        projectName:   projects.name,
      })
      .from(regulatoryCertificates)
      .leftJoin(properties, eq(regulatoryCertificates.propertyId, properties.id))
      .leftJoin(projects,   eq(regulatoryCertificates.projectId,  projects.id))
      .where(and(
        eq(regulatoryCertificates.id, id),
        eq(regulatoryCertificates.organizationId, orgId),
      ))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Certificate not found" });

    res.json(enrichCert({
      ...row.cert,
      propertyName:    row.propertyName,
      propertyAddress: row.propertyAddress,
      projectName:     row.projectName,
    }));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/regulatory-certificates
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId:  number = req.user.organizationId;
    const userId: string = req.user.id ?? req.user.userId;

    // Validate the property belongs to this org
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(
        eq(properties.id, parseInt(req.body.propertyId)),
        eq(properties.organizationId, orgId),
      ))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found in your organisation" });

    const validated = insertRegulatoryCertificateSchema.parse({
      ...req.body,
      organizationId: orgId,
      createdBy:      userId,
    });

    const [created] = await db
      .insert(regulatoryCertificates)
      .values(validated as any)
      .returning();

    res.status(201).json(enrichCert(created));
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Validation error", errors: err.errors });
    }
    console.error("[RegCerts] POST error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /api/regulatory-certificates/:id
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.patch("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id:    number = parseInt(req.params.id);

    // Verify ownership
    const [existing] = await db
      .select({ id: regulatoryCertificates.id })
      .from(regulatoryCertificates)
      .where(and(
        eq(regulatoryCertificates.id, id),
        eq(regulatoryCertificates.organizationId, orgId),
      ))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Certificate not found" });

    // Strip protected fields from body
    const { id: _id, organizationId: _org, createdBy: _cb, createdAt: _ca, ...patch } = req.body;

    const [updated] = await db
      .update(regulatoryCertificates)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(regulatoryCertificates.id, id))
      .returning();

    res.json(enrichCert(updated));
  } catch (err: any) {
    console.error("[RegCerts] PATCH error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/regulatory-certificates/:id
// ══════════════════════════════════════════════════════════════════════════════
regulatoryCertsRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const id:    number = parseInt(req.params.id);

    const [deleted] = await db
      .delete(regulatoryCertificates)
      .where(and(
        eq(regulatoryCertificates.id, id),
        eq(regulatoryCertificates.organizationId, orgId),
      ))
      .returning({ id: regulatoryCertificates.id });

    if (!deleted) return res.status(404).json({ message: "Certificate not found" });

    res.json({ message: "Deleted" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
