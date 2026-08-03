/**
 * Tenant Subletting routes
 *
 * Mounts at:
 *   /api/tenant-short-rentals  — CRUD + status patch
 *   /api/short-term-bookings   — CRUD
 */
import { Router } from "express";
import { db } from "../db";
import { eq, and, ne, lt, inArray } from "drizzle-orm";
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import {
  tenantShortRentals,
  tenantShortBookings,
  insertTenantShortRentalSchema,
  insertTenantShortBookingSchema,
  listingBlockedDates,
  insertListingBlockedDateSchema,
  tenants,
  units,
  properties,
  users,
} from "@shared/schema";
import { z } from "zod";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "listing";
}

/** Generates a unique slug by appending -2, -3, etc. on collision.
 *  excludeId lets an update keep its own existing slug without colliding
 *  with itself. */
async function generateUniqueSlug(base: string, excludeId?: number): Promise<string> {
  const baseSlug = slugify(base);
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const conflict = await db
      .select({ id: tenantShortRentals.id })
      .from(tenantShortRentals)
      .where(eq(tenantShortRentals.slug, candidate))
      .limit(1);
    if (!conflict.length || conflict[0].id === excludeId) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix++;
  }
}

// ── Tenant Short Rentals Router ───────────────────────────────────────────────
export const tenantShortRentalsRouter = Router();
tenantShortRentalsRouter.use(authenticateJWT, requireOrg);

// GET /api/tenant-short-rentals
tenantShortRentalsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role;

    let rows;
    if (role === "admin" || role === "manager") {
      rows = await db.select().from(tenantShortRentals)
        .where(eq(tenantShortRentals.organizationId, orgId))
        .orderBy(tenantShortRentals.createdAt);
    } else if (role === "landlord") {
      // Owner-managed listings they created, plus any tenant-sublet listing
      // on a unit inside a property they own — a landlord should be able to
      // see subletting happening on their own property.
      rows = await db
        .select({ listing: tenantShortRentals })
        .from(tenantShortRentals)
        .innerJoin(units, eq(tenantShortRentals.unitId, units.id))
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(
          eq(tenantShortRentals.organizationId, orgId),
          eq(properties.ownerId, req.user.id),
        ))
        .orderBy(tenantShortRentals.createdAt)
        .then(r => r.map(row => row.listing));
    } else if (role === "tenant") {
      const [tenantRow] = await db.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.userId, req.user.id), eq(tenants.organizationId, orgId))).limit(1);
      rows = tenantRow
        ? await db.select().from(tenantShortRentals)
            .where(and(eq(tenantShortRentals.organizationId, orgId), eq(tenantShortRentals.tenantId, tenantRow.id)))
            .orderBy(tenantShortRentals.createdAt)
        : [];
    } else {
      return res.status(403).json({ message: "Not permitted." });
    }
    return res.json(rows);
  } catch (err) {
    console.error("Error listing tenant short rentals:", err);
    return res.status(500).json({ message: "Failed to fetch listings" });
  }
});

/** Whether a date range overlaps any host-blocked range on this listing —
 *  shared by every booking-creation path (authenticated and public) so
 *  they can't drift out of sync on what counts as unavailable. */
export async function hasBlockedDateOverlap(rentalListingId: number, checkIn: Date, checkOut: Date): Promise<boolean> {
  const blocks = await db
    .select({ startDate: listingBlockedDates.startDate, endDate: listingBlockedDates.endDate })
    .from(listingBlockedDates)
    .where(and(eq(listingBlockedDates.rentalListingId, rentalListingId), lt(listingBlockedDates.startDate, checkOut)));
  return blocks.some(b => new Date(b.endDate) > checkIn);
}

/** Whether this user may view/edit/delete a specific listing — same rule
 *  used consistently across GET /:id, PUT /:id, and DELETE /:id, so
 *  ownership logic can't drift out of sync between them. */
async function canAccessListing(listing: { unitId: number; tenantId: number | null; ownerId: string | null }, user: any): Promise<boolean> {
  if (user.role === "admin" || user.role === "manager") return true;
  if (user.role === "landlord") {
    const [unitRow] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, listing.unitId)).limit(1);
    if (!unitRow) return false;
    const [propRow] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unitRow.propertyId)).limit(1);
    return !!propRow && propRow.ownerId === user.id;
  }
  if (user.role === "tenant" && listing.tenantId) {
    const [tenantRow] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, user.id)).limit(1);
    return !!tenantRow && tenantRow.id === listing.tenantId;
  }
  return false;
}

// GET /api/tenant-short-rentals/:id
tenantShortRentalsRouter.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId)))
      .limit(1);
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(rows[0], req.user))) return res.status(403).json({ message: "Not permitted." });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching tenant short rental:", err);
    return res.status(500).json({ message: "Failed to fetch listing" });
  }
});

// POST /api/tenant-short-rentals
tenantShortRentalsRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role;
    const isManager = role === "admin" || role === "manager";
    const isLandlord = role === "landlord";
    const isTenant = role === "tenant";

    if (!isManager && !isLandlord && !isTenant) {
      return res.status(403).json({ message: "Not permitted to create a short-term rental listing." });
    }

    const formattedBody = { ...req.body };
    ["nightlyRate", "propertyManagerCommission", "tenantEarningsShare", "platformFees"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    // Resolve tenantId/ownerId/unitId based on who's actually creating this —
    // never trust these directly from the request body, since that would let
    // any authenticated user attribute a listing to someone else's unit or
    // claim someone else's ownership.
    let tenantId: number | null = null;
    let ownerId: string | null = null;
    let unitId: number | undefined = formattedBody.unitId ? parseInt(formattedBody.unitId) : undefined;

    if (isTenant) {
      // A tenant can only list their own leased unit.
      const [tenantRow] = await db.select({ id: tenants.id, unitId: tenants.unitId })
        .from(tenants).where(and(eq(tenants.userId, req.user.id), eq(tenants.organizationId, orgId))).limit(1);
      if (!tenantRow) return res.status(403).json({ message: "No tenant record found for your account." });
      if (!tenantRow.unitId) return res.status(400).json({ message: "You don't have a unit assigned to sublet." });
      tenantId = tenantRow.id;
      unitId = tenantRow.unitId;
    } else if (isLandlord) {
      // A landlord can only list a unit in a property they own.
      if (!unitId) return res.status(400).json({ message: "unitId is required." });
      const [unitRow] = await db.select({ id: units.id, propertyId: units.propertyId, organizationId: units.organizationId })
        .from(units).where(eq(units.id, unitId)).limit(1);
      if (!unitRow || unitRow.organizationId !== orgId) return res.status(404).json({ message: "Unit not found in your organisation." });
      const [propRow] = await db.select({ ownerId: properties.ownerId }).from(properties).where(eq(properties.id, unitRow.propertyId)).limit(1);
      if (!propRow || propRow.ownerId !== req.user.id) return res.status(403).json({ message: "You can only list units in properties you own." });
      ownerId = req.user.id;
    } else {
      // admin/manager — full oversight, but whatever is provided must still
      // genuinely belong to this organisation. Exactly one of tenantId/ownerId.
      const bodyTenantId = formattedBody.tenantId ? parseInt(formattedBody.tenantId) : null;
      const bodyOwnerId = formattedBody.ownerId || null;
      if (!!bodyTenantId === !!bodyOwnerId) {
        return res.status(400).json({ message: "Provide exactly one of tenantId or ownerId." });
      }
      if (!unitId) return res.status(400).json({ message: "unitId is required." });
      const [unitRow] = await db.select({ id: units.id, organizationId: units.organizationId })
        .from(units).where(eq(units.id, unitId)).limit(1);
      if (!unitRow || unitRow.organizationId !== orgId) return res.status(404).json({ message: "Unit not found in your organisation." });

      if (bodyTenantId) {
        const [tenantRow] = await db.select({ id: tenants.id }).from(tenants)
          .where(and(eq(tenants.id, bodyTenantId), eq(tenants.organizationId, orgId))).limit(1);
        if (!tenantRow) return res.status(404).json({ message: "Tenant not found in your organisation." });
        tenantId = tenantRow.id;
      } else {
        const [ownerRow] = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.id, bodyOwnerId), eq(users.organizationId, orgId), eq(users.role, "landlord"))).limit(1);
        if (!ownerRow) return res.status(404).json({ message: "Landlord not found in your organisation." });
        ownerId = ownerRow.id;
      }
    }

    const slug = await generateUniqueSlug(formattedBody.slug || formattedBody.listingTitle || "listing");

    const payload = insertTenantShortRentalSchema.parse({
      ...formattedBody,
      organizationId: orgId,
      unitId,
      tenantId,
      ownerId,
      slug,
      // A listing always starts pending review, and off the public
      // marketplace, regardless of what the caller sent — approval and
      // marketplace visibility are review actions, not self-service ones
      // (see PATCH /:id/status and PATCH /:id/visibility below).
      approvalStatus: "pending",
      isPubliclyListed: false,
    });
    const [created] = await db.insert(tenantShortRentals).values(payload).returning();
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ errors: err.errors });
    }
    console.error("Error creating tenant short rental:", err);
    return res.status(500).json({ message: "Failed to create listing" });
  }
});

// PUT /api/tenant-short-rentals/:id
tenantShortRentalsRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const [existing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(existing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const formattedBody = { ...req.body };
    // These aren't editable through a general update — reassigning who owns
    // a listing, or self-approving/self-publishing it, would defeat the
    // point of the ownership and review checks above. Use the dedicated
    // PATCH endpoints for approval/visibility instead.
    delete formattedBody.tenantId;
    delete formattedBody.ownerId;
    delete formattedBody.organizationId;
    delete formattedBody.approvalStatus;
    delete formattedBody.isPubliclyListed;

    ["nightlyRate", "propertyManagerCommission", "tenantEarningsShare", "platformFees"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    // If the title changed and no explicit slug was given, regenerate one —
    // but never collide with the listing's own current slug.
    if (formattedBody.listingTitle && !formattedBody.slug) {
      formattedBody.slug = await generateUniqueSlug(formattedBody.listingTitle, id);
    } else if (formattedBody.slug) {
      formattedBody.slug = await generateUniqueSlug(formattedBody.slug, id);
    }

    const payload = insertTenantShortRentalSchema.partial().parse(formattedBody);
    const rows = await db
      .update(tenantShortRentals)
      .set({ ...payload, updatedAt: new Date() })
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ errors: err.errors });
    }
    console.error("Error updating tenant short rental:", err);
    return res.status(500).json({ message: "Failed to update listing" });
  }
});

// PATCH /api/tenant-short-rentals/:id/status — admin/manager only. This is a
// legitimacy/quality review, not something a listing's own creator should be
// able to grant themselves.
tenantShortRentalsRouter.patch("/:id/status", async (req: any, res: any) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only an admin or manager can approve listings." });
    }
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "status must be pending, approved, or rejected." });
    }

    const rows = await db
      .update(tenantShortRentals)
      .set({
        approvalStatus: status,
        approvedBy: status === "approved" ? req.user.id : null,
        approvedAt: status === "approved" ? new Date() : null,
        // Rejecting or un-approving a listing pulls it off the public
        // marketplace immediately — it can't stay publicly bookable while
        // failing review.
        ...(status !== "approved" ? { isPubliclyListed: false } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error updating status:", err);
    return res.status(500).json({ message: "Failed to update status" });
  }
});

// PATCH /api/tenant-short-rentals/:id/visibility — the listing's own owner
// (or admin/manager) can opt in/out of the shared public marketplace, but
// only once the listing has actually been approved. Distinct from approval:
// approval is a legitimacy check nobody should self-grant; marketplace
// visibility is a preference the owner should control themselves.
tenantShortRentalsRouter.patch("/:id/visibility", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const { isPubliclyListed } = req.body;
    if (typeof isPubliclyListed !== "boolean") {
      return res.status(400).json({ message: "isPubliclyListed must be true or false." });
    }

    const [existing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(existing, req.user))) return res.status(403).json({ message: "Not permitted." });
    if (isPubliclyListed && existing.approvalStatus !== "approved") {
      return res.status(409).json({ message: "This listing must be approved before it can appear in the public marketplace." });
    }

    const [updated] = await db.update(tenantShortRentals)
      .set({ isPubliclyListed, updatedAt: new Date() })
      .where(eq(tenantShortRentals.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    console.error("Error updating visibility:", err);
    return res.status(500).json({ message: "Failed to update visibility" });
  }
});

// DELETE /api/tenant-short-rentals/:id
tenantShortRentalsRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const [existing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(existing, req.user))) return res.status(403).json({ message: "Not permitted." });

    await db.delete(tenantShortRentals).where(eq(tenantShortRentals.id, id));
    return res.status(204).send();
  } catch (err) {
    console.error("Error deleting tenant short rental:", err);
    return res.status(500).json({ message: "Failed to delete listing" });
  }
});

// POST /api/tenant-short-rentals/:id/photos — upload a listing photo
tenantShortRentalsRouter.post("/:id/photos", s3Upload.single("photo"), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!listing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(listing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const photoUrl = resolveUploadUrl(req.file as any);
    const existingPhotos = Array.isArray(listing.listingPhotos) ? listing.listingPhotos : [];
    const [updated] = await db.update(tenantShortRentals)
      .set({ listingPhotos: [...existingPhotos, photoUrl], updatedAt: new Date() })
      .where(eq(tenantShortRentals.id, id))
      .returning();
    return res.status(201).json({ url: photoUrl, listing: updated });
  } catch (err) {
    console.error("Error uploading listing photo:", err);
    return res.status(500).json({ message: "Failed to upload photo" });
  }
});

// DELETE /api/tenant-short-rentals/:id/photos — remove a specific photo by URL
tenantShortRentalsRouter.delete("/:id/photos", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const { url } = req.body;
    if (!url) return res.status(400).json({ message: "url is required" });
    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!listing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(listing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const existingPhotos = Array.isArray(listing.listingPhotos) ? listing.listingPhotos : [];
    const [updated] = await db.update(tenantShortRentals)
      .set({ listingPhotos: existingPhotos.filter((p: string) => p !== url), updatedAt: new Date() })
      .where(eq(tenantShortRentals.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    console.error("Error removing listing photo:", err);
    return res.status(500).json({ message: "Failed to remove photo" });
  }
});

// GET /api/tenant-short-rentals/:id/blocked-dates — host-blocked dates for a listing
tenantShortRentalsRouter.get("/:id/blocked-dates", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!listing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(listing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const blocks = await db.select().from(listingBlockedDates)
      .where(eq(listingBlockedDates.rentalListingId, id))
      .orderBy(listingBlockedDates.startDate);
    return res.json(blocks);
  } catch (err) {
    console.error("Error fetching blocked dates:", err);
    return res.status(500).json({ message: "Failed to fetch blocked dates" });
  }
});

const blockedDateRequestSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().max(200).optional(),
});

// POST /api/tenant-short-rentals/:id/blocked-dates — host blocks dates for
// personal use, maintenance, etc. Runs the exact same overlap check as a
// real booking.
tenantShortRentalsRouter.post("/:id/blocked-dates", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!listing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(listing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const parsed = blockedDateRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid date range." });
    const startDate = new Date(parsed.data.startDate);
    const endDate = new Date(parsed.data.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      return res.status(400).json({ message: "End date must be after start date." });
    }

    const conflictingBookings = await db
      .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.rentalListingId, id), ne(tenantShortBookings.bookingStatus, "cancelled"), lt(tenantShortBookings.checkInDate, endDate)));
    if (conflictingBookings.some(b => new Date(b.checkOutDate) > startDate)) {
      return res.status(409).json({ message: "Those dates already have a guest booking on them." });
    }

    const payload = insertListingBlockedDateSchema.parse({
      rentalListingId: id,
      startDate,
      endDate,
      reason: parsed.data.reason,
      createdBy: req.user.id,
    });
    const [created] = await db.insert(listingBlockedDates).values(payload).returning();
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ errors: err.errors });
    console.error("Error creating blocked dates:", err);
    return res.status(500).json({ message: "Failed to block dates" });
  }
});

// DELETE /api/tenant-short-rentals/:id/blocked-dates/:blockId — unblock a range
tenantShortRentalsRouter.delete("/:id/blocked-dates/:blockId", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const blockId = parseInt(req.params.blockId);
    const orgId: number = req.user.organizationId;
    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId))).limit(1);
    if (!listing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessListing(listing, req.user))) return res.status(403).json({ message: "Not permitted." });

    await db.delete(listingBlockedDates)
      .where(and(eq(listingBlockedDates.id, blockId), eq(listingBlockedDates.rentalListingId, id)));
    return res.status(204).send();
  } catch (err) {
    console.error("Error removing blocked dates:", err);
    return res.status(500).json({ message: "Failed to unblock dates" });
  }
});

// ── Short Term Bookings Router ────────────────────────────────────────────────
export const shortTermBookingsRouter = Router();
shortTermBookingsRouter.use(authenticateJWT, requireOrg);

// GET /api/short-term-bookings
shortTermBookingsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role;

    if (role === "admin" || role === "manager") {
      const rows = await db.select().from(tenantShortBookings)
        .where(eq(tenantShortBookings.organizationId, orgId))
        .orderBy(tenantShortBookings.createdAt);
      return res.json(rows);
    }

    // landlord/tenant — only bookings on listings they can actually access.
    const myListings = await db.select({ id: tenantShortRentals.id, unitId: tenantShortRentals.unitId, tenantId: tenantShortRentals.tenantId, ownerId: tenantShortRentals.ownerId })
      .from(tenantShortRentals).where(eq(tenantShortRentals.organizationId, orgId));
    const accessibleIds: number[] = [];
    for (const listing of myListings) {
      if (await canAccessListing(listing, req.user)) accessibleIds.push(listing.id);
    }
    if (!accessibleIds.length) return res.json([]);

    const rows = await db.select().from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.organizationId, orgId), inArray(tenantShortBookings.rentalListingId, accessibleIds)))
      .orderBy(tenantShortBookings.createdAt);
    return res.json(rows);
  } catch (err) {
    console.error("Error listing short term bookings:", err);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

// GET /api/short-term-bookings/:id
/** Whether this user may view/edit/cancel a specific booking — delegates to
 *  the listing-level check via the booking's rentalListingId. */
async function canAccessBooking(booking: { rentalListingId: number }, user: any): Promise<boolean> {
  if (user.role === "admin" || user.role === "manager") return true;
  const [listing] = await db.select({ unitId: tenantShortRentals.unitId, tenantId: tenantShortRentals.tenantId, ownerId: tenantShortRentals.ownerId })
    .from(tenantShortRentals).where(eq(tenantShortRentals.id, booking.rentalListingId)).limit(1);
  if (!listing) return false;
  return canAccessListing(listing, user);
}

shortTermBookingsRouter.get("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, id), eq(tenantShortBookings.organizationId, orgId)))
      .limit(1);
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessBooking(rows[0], req.user))) return res.status(403).json({ message: "Not permitted." });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching short term booking:", err);
    return res.status(500).json({ message: "Failed to fetch booking" });
  }
});

// POST /api/short-term-bookings
shortTermBookingsRouter.post("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    // Auto-generate booking reference if not provided
    const bookingReference =
      req.body.bookingReference ??
      `BK-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    // Ensure numeric fields are strings for decimal validation
    const formattedBody = { ...req.body };
    ["nightlyRate", "totalAmount", "cleaningFee", "platformFees", "propertyManagerCommission", "tenantPayout", "securityDeposit"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    const payload = insertTenantShortBookingSchema.parse({
      ...formattedBody,
      bookingReference,
      organizationId: orgId,
    });

    // Double-booking prevention — the actual core requirement of any
    // booking system, previously entirely missing here. Two stays overlap
    // if one starts before the other ends, in both directions. Cancelled
    // bookings don't block new ones; every other status does, since even
    // a "pending" hold on these dates shouldn't be double-sold while it's
    // being resolved.
    const checkIn = new Date(payload.checkInDate as any);
    const checkOut = new Date(payload.checkOutDate as any);
    if (checkOut <= checkIn) {
      return res.status(400).json({ message: "Check-out date must be after check-in date." });
    }
    const conflicting = await db
      .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, payload.rentalListingId as any),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        lt(tenantShortBookings.checkInDate, checkOut),
      ));
    const hasOverlap = conflicting.some(b => new Date(b.checkOutDate) > checkIn);
    if (hasOverlap) {
      return res.status(409).json({
        message: "Those dates are no longer available for this listing — someone else has already booked an overlapping stay.",
        code: "BOOKING_DATES_UNAVAILABLE",
      });
    }
    if (await hasBlockedDateOverlap(payload.rentalListingId as any, checkIn, checkOut)) {
      return res.status(409).json({
        message: "Those dates are blocked by the host and aren't available for booking.",
        code: "BOOKING_DATES_UNAVAILABLE",
      });
    }

    const [created] = await db.insert(tenantShortBookings).values(payload).returning();
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ errors: err.errors });
    }
    console.error("Error creating short term booking:", err);
    return res.status(500).json({ message: "Failed to create booking" });
  }
});

// PUT /api/short-term-bookings/:id
shortTermBookingsRouter.put("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;

    const [existing] = await db.select().from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, id), eq(tenantShortBookings.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessBooking(existing, req.user))) return res.status(403).json({ message: "Not permitted." });

    const formattedBody = { ...req.body };
    // Not editable via a general update — moving a booking to a different
    // listing/org, or renumbering its reference, isn't a normal edit.
    delete formattedBody.rentalListingId;
    delete formattedBody.organizationId;
    delete formattedBody.bookingReference;

    ["nightlyRate", "totalAmount", "cleaningFee", "platformFees", "propertyManagerCommission", "tenantPayout", "securityDeposit"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    const payload = insertTenantShortBookingSchema.partial().parse(formattedBody);

    // If the stay's dates are changing, the same double-booking risk from
    // creation applies here too — re-check for overlaps against every other
    // booking on this listing before allowing the change through.
    if (payload.checkInDate || payload.checkOutDate) {
      const checkIn = new Date((payload.checkInDate ?? existing.checkInDate) as any);
      const checkOut = new Date((payload.checkOutDate ?? existing.checkOutDate) as any);
      if (checkOut <= checkIn) {
        return res.status(400).json({ message: "Check-out date must be after check-in date." });
      }
      const conflicting = await db
        .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
        .from(tenantShortBookings)
        .where(and(
          eq(tenantShortBookings.rentalListingId, existing.rentalListingId),
          ne(tenantShortBookings.id, id),
          ne(tenantShortBookings.bookingStatus, "cancelled"),
          lt(tenantShortBookings.checkInDate, checkOut),
        ));
      const hasOverlap = conflicting.some(b => new Date(b.checkOutDate) > checkIn);
      if (hasOverlap) {
        return res.status(409).json({
          message: "Those dates conflict with another existing booking on this listing.",
          code: "BOOKING_DATES_UNAVAILABLE",
        });
      }
      if (await hasBlockedDateOverlap(existing.rentalListingId, checkIn, checkOut)) {
        return res.status(409).json({
          message: "Those dates are blocked by the host and aren't available.",
          code: "BOOKING_DATES_UNAVAILABLE",
        });
      }
    }

    const rows = await db
      .update(tenantShortBookings)
      .set({ ...payload, updatedAt: new Date() })
      .where(and(eq(tenantShortBookings.id, id), eq(tenantShortBookings.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ errors: err.errors });
    }
    console.error("Error updating short term booking:", err);
    return res.status(500).json({ message: "Failed to update booking" });
  }
});

// DELETE /api/short-term-bookings/:id
shortTermBookingsRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const [existing] = await db.select().from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, id), eq(tenantShortBookings.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!(await canAccessBooking(existing, req.user))) return res.status(403).json({ message: "Not permitted." });
    if (existing.bookingStatus === "cancelled") {
      return res.status(409).json({ message: "This booking is already cancelled." });
    }
    if (existing.bookingStatus === "checked_out") {
      return res.status(409).json({ message: "A completed stay can't be cancelled." });
    }

    // Soft-cancel, not a hard delete — preserves the booking's history and
    // audit trail, and lets other logic (double-booking checks, revenue
    // reporting) correctly distinguish "never happened" from "was booked,
    // then cancelled". The dates become available again automatically,
    // since every overlap check already excludes cancelled bookings.
    const [updated] = await db
      .update(tenantShortBookings)
      .set({ bookingStatus: "cancelled", updatedAt: new Date() })
      .where(eq(tenantShortBookings.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    console.error("Error cancelling short term booking:", err);
    return res.status(500).json({ message: "Failed to cancel booking" });
  }
});