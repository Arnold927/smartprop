/**
 * ratings.ts
 *
 * Tenant rating endpoints — allows tenants to rate:
 *   1. Maintenance staff / technicians (linked to a completed maintenance request)
 *   2. Caretakers assigned to their property
 *   3. Their landlord (property/unit owner)
 *
 * Routes:
 *   GET  /api/ratings/my-reviews          — list all reviews the current tenant has submitted
 *   POST /api/ratings/maintenance         — rate a maintenance request technician/staff
 *   POST /api/ratings/caretaker           — rate a caretaker
 *   POST /api/ratings/landlord            — rate the landlord
 *   GET  /api/ratings/targets             — get rateable targets for the current tenant
 *                                           (completed maintenance requests, caretaker, landlord)
 *   GET  /api/ratings/admin/summary       — admin/manager: overall ratings summary
 */

import { Router } from "express";
import { db } from "../db";
import {
  tenantReviews,
  tenants,
  units,
  properties,
  maintenanceRequests,
  caretakers,
  users,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { z } from "zod";

const router = Router();

// All routes require authentication
router.use(authenticateJWT as any);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the current tenant record from req.user */
async function resolveTenant(userId: string) {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.userId, userId))
    .limit(1);
  return tenant ?? null;
}

// ─── GET /api/ratings/targets ─────────────────────────────────────────────────
// Returns everything the tenant can rate right now:
//   - completed maintenance requests that haven't been rated yet
//   - the caretaker assigned to their property (if any)
//   - the landlord / property record
router.get("/targets", async (req: any, res) => {
  try {
    const tenant = await resolveTenant(req.user.id);
    if (!tenant) return res.status(404).json({ message: "Tenant record not found" });

    // 1. Completed maintenance requests the tenant raised — not yet reviewed via tenantReviews
    const completedRequests = await db
      .select({
        id: maintenanceRequests.id,
        title: maintenanceRequests.title,
        description: maintenanceRequests.description,
        completedAt: maintenanceRequests.completedAt,
        satisfactionRating: maintenanceRequests.satisfactionRating,
        satisfactionComments: maintenanceRequests.satisfactionComments,
      })
      .from(maintenanceRequests)
      .where(
        and(
          eq(maintenanceRequests.tenantId, tenant.id),
          eq(maintenanceRequests.status, "completed"),
        )
      )
      .orderBy(desc(maintenanceRequests.completedAt))
      .limit(20);

    // 2. Caretaker for the tenant's property
    let caretaker: any = null;
    if (tenant.unitId) {
      const [unit] = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(eq(units.id, tenant.unitId))
        .limit(1);

      if (unit?.propertyId) {
        const [ct] = await db
          .select({
            id: caretakers.id,
            caretakerType: caretakers.caretakerType,
            userId: caretakers.userId,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(caretakers)
          .leftJoin(users, eq(caretakers.userId, users.id))
          .where(
            and(
              eq(caretakers.propertyId, unit.propertyId),
              eq(caretakers.status, "active")
            )
          )
          .limit(1);

        if (ct) {
          // Check if tenant already reviewed this caretaker
          const [existingReview] = await db
            .select({ id: tenantReviews.id, rating: tenantReviews.rating })
            .from(tenantReviews)
            .where(
              and(
                eq(tenantReviews.tenantId, tenant.id),
                eq(tenantReviews.reviewType, "caretaker"),
              )
            )
            .limit(1);

          caretaker = {
            ...ct,
            existingReview: existingReview ?? null,
          };
        }
      }
    }

    // 3. Property / landlord info
    let landlord: any = null;
    if (tenant.unitId) {
      const [unit] = await db
        .select({ propertyId: units.propertyId })
        .from(units)
        .where(eq(units.id, tenant.unitId))
        .limit(1);

      if (unit?.propertyId) {
        const [prop] = await db
          .select({
            id: properties.id,
            name: properties.name,
            address: properties.address,
          })
          .from(properties)
          .where(eq(properties.id, unit.propertyId))
          .limit(1);

        if (prop) {
          // Check existing landlord review
          const [existingReview] = await db
            .select({ id: tenantReviews.id, rating: tenantReviews.rating })
            .from(tenantReviews)
            .where(
              and(
                eq(tenantReviews.tenantId, tenant.id),
                eq(tenantReviews.reviewType, "landlord"),
              )
            )
            .limit(1);

          landlord = { ...prop, existingReview: existingReview ?? null };
        }
      }
    }

    res.json({
      maintenanceRequests: completedRequests,
      caretaker,
      landlord,
    });
  } catch (err) {
    console.error("ratings /targets error:", err);
    res.status(500).json({ message: "Failed to load rating targets" });
  }
});

// ─── GET /api/ratings/my-reviews ─────────────────────────────────────────────
router.get("/my-reviews", async (req: any, res) => {
  try {
    const tenant = await resolveTenant(req.user.id);
    if (!tenant) return res.status(404).json({ message: "Tenant record not found" });

    const reviews = await db
      .select()
      .from(tenantReviews)
      .where(eq(tenantReviews.tenantId, tenant.id))
      .orderBy(desc(tenantReviews.createdAt));

    res.json(reviews);
  } catch (err) {
    console.error("ratings /my-reviews error:", err);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
});

// ─── POST /api/ratings/maintenance ───────────────────────────────────────────
// Rate a completed maintenance request (rates the staff who handled it)
router.post("/maintenance", async (req: any, res) => {
  try {
    const tenant = await resolveTenant(req.user.id);
    if (!tenant) return res.status(404).json({ message: "Tenant record not found" });

    const schema = z.object({
      maintenanceRequestId: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      comment: z.string().max(2000).optional(),
    });

    const { maintenanceRequestId, rating, title, comment } = schema.parse(req.body);

    // Verify the maintenance request belongs to this tenant and is completed
    const [mr] = await db
      .select()
      .from(maintenanceRequests)
      .where(
        and(
          eq(maintenanceRequests.id, maintenanceRequestId),
          eq(maintenanceRequests.tenantId, tenant.id),
          eq(maintenanceRequests.status, "completed"),
        )
      )
      .limit(1);

    if (!mr) {
      return res.status(404).json({
        message: "Maintenance request not found, not yours, or not yet completed",
      });
    }

    // Also update the satisfaction_rating on the maintenance request itself
    await db
      .update(maintenanceRequests)
      .set({
        satisfactionRating: rating,
        satisfactionComments: comment,
        feedbackDate: new Date(),
      })
      .where(eq(maintenanceRequests.id, maintenanceRequestId));

    // Upsert into tenant_reviews (one review per request)
    const existing = await db
      .select({ id: tenantReviews.id })
      .from(tenantReviews)
      .where(
        and(
          eq(tenantReviews.tenantId, tenant.id),
          eq(tenantReviews.reviewType, "maintenance"),
          // store the maintenance request id in the unitId column as a workaround
          // since tenantReviews doesn't have a maintenanceRequestId column
          eq(tenantReviews.propertyId, maintenanceRequestId),
        )
      )
      .limit(1);

    let review;
    if (existing.length > 0) {
      [review] = await db
        .update(tenantReviews)
        .set({
          rating,
          title: title ?? null,
          comment: comment ?? null,
          updatedAt: new Date(),
        })
        .where(eq(tenantReviews.id, existing[0].id))
        .returning();
    } else {
      [review] = await db
        .insert(tenantReviews)
        .values({
          tenantId: tenant.id,
          reviewType: "maintenance",
          propertyId: maintenanceRequestId, // repurposed to store which request
          rating,
          title: title ?? null,
          comment: comment ?? null,
          status: "pending",
          isPublic: false,
        })
        .returning();
    }

    res.json({ success: true, review });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("ratings /maintenance error:", err);
    res.status(500).json({ message: "Failed to submit maintenance rating" });
  }
});

// ─── POST /api/ratings/caretaker ─────────────────────────────────────────────
router.post("/caretaker", async (req: any, res) => {
  try {
    const tenant = await resolveTenant(req.user.id);
    if (!tenant) return res.status(404).json({ message: "Tenant record not found" });

    const schema = z.object({
      caretakerId: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      comment: z.string().max(2000).optional(),
    });

    const { caretakerId, rating, title, comment } = schema.parse(req.body);

    // Verify caretaker exists and is assigned to the tenant's property
    if (!tenant.unitId) {
      return res.status(400).json({ message: "No unit assigned to tenant" });
    }

    const [unit] = await db
      .select({ propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, tenant.unitId))
      .limit(1);

    if (!unit) return res.status(400).json({ message: "Unit not found" });

    const [ct] = await db
      .select()
      .from(caretakers)
      .where(
        and(eq(caretakers.id, caretakerId), eq(caretakers.propertyId, unit.propertyId))
      )
      .limit(1);

    if (!ct) {
      return res.status(404).json({ message: "Caretaker not found for your property" });
    }

    // Upsert review
    const existing = await db
      .select({ id: tenantReviews.id })
      .from(tenantReviews)
      .where(
        and(
          eq(tenantReviews.tenantId, tenant.id),
          eq(tenantReviews.reviewType, "caretaker"),
        )
      )
      .limit(1);

    let review;
    if (existing.length > 0) {
      [review] = await db
        .update(tenantReviews)
        .set({ rating, title: title ?? null, comment: comment ?? null, updatedAt: new Date() })
        .where(eq(tenantReviews.id, existing[0].id))
        .returning();
    } else {
      [review] = await db
        .insert(tenantReviews)
        .values({
          tenantId: tenant.id,
          reviewType: "caretaker",
          propertyId: unit.propertyId,
          rating,
          title: title ?? null,
          comment: comment ?? null,
          status: "pending",
          isPublic: false,
        })
        .returning();
    }

    // Update caretaker's performance rating (rolling average)
    const allCaretakerReviews = await db
      .select({ rating: tenantReviews.rating })
      .from(tenantReviews)
      .where(
        and(
          eq(tenantReviews.reviewType, "caretaker"),
          eq(tenantReviews.propertyId, unit.propertyId),
        )
      );

    if (allCaretakerReviews.length > 0) {
      const avg =
        allCaretakerReviews.reduce((s, r) => s + r.rating, 0) /
        allCaretakerReviews.length;
      await db
        .update(caretakers)
        .set({ performanceRating: avg.toFixed(2) as any })
        .where(eq(caretakers.id, caretakerId));
    }

    res.json({ success: true, review });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("ratings /caretaker error:", err);
    res.status(500).json({ message: "Failed to submit caretaker rating" });
  }
});

// ─── POST /api/ratings/landlord ──────────────────────────────────────────────
router.post("/landlord", async (req: any, res) => {
  try {
    const tenant = await resolveTenant(req.user.id);
    if (!tenant) return res.status(404).json({ message: "Tenant record not found" });

    const schema = z.object({
      propertyId: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      comment: z.string().max(2000).optional(),
    });

    const { propertyId, rating, title, comment } = schema.parse(req.body);

    // Verify property matches tenant's unit
    if (!tenant.unitId) {
      return res.status(400).json({ message: "No unit assigned" });
    }

    const [unit] = await db
      .select({ propertyId: units.propertyId })
      .from(units)
      .where(eq(units.id, tenant.unitId))
      .limit(1);

    if (!unit || unit.propertyId !== propertyId) {
      return res.status(403).json({ message: "You can only rate your own property" });
    }

    // Upsert
    const existing = await db
      .select({ id: tenantReviews.id })
      .from(tenantReviews)
      .where(
        and(
          eq(tenantReviews.tenantId, tenant.id),
          eq(tenantReviews.reviewType, "landlord"),
        )
      )
      .limit(1);

    let review;
    if (existing.length > 0) {
      [review] = await db
        .update(tenantReviews)
        .set({ rating, title: title ?? null, comment: comment ?? null, updatedAt: new Date() })
        .where(eq(tenantReviews.id, existing[0].id))
        .returning();
    } else {
      [review] = await db
        .insert(tenantReviews)
        .values({
          tenantId: tenant.id,
          reviewType: "landlord",
          propertyId,
          rating,
          title: title ?? null,
          comment: comment ?? null,
          status: "pending",
          isPublic: false,
        })
        .returning();
    }

    res.json({ success: true, review });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("ratings /landlord error:", err);
    res.status(500).json({ message: "Failed to submit landlord rating" });
  }
});

// ─── GET /api/ratings/admin/summary ──────────────────────────────────────────
// Admins / managers / landlords can see aggregated review data
router.get("/admin/summary", requireOrg as any, async (req: any, res) => {
  try {
    const role = req.user?.role ?? "tenant";
    const allowed = ["admin", "manager", "landlord", "staff"];
    if (!allowed.includes(role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const rows = await db
      .select({
        reviewType: tenantReviews.reviewType,
        avgRating: sql<number>`ROUND(AVG(${tenantReviews.rating})::numeric, 2)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(tenantReviews)
      .groupBy(tenantReviews.reviewType);

    const recent = await db
      .select({
        id: tenantReviews.id,
        reviewType: tenantReviews.reviewType,
        rating: tenantReviews.rating,
        title: tenantReviews.title,
        comment: tenantReviews.comment,
        createdAt: tenantReviews.createdAt,
        tenantFirst: tenants.firstName,
        tenantLast: tenants.lastName,
      })
      .from(tenantReviews)
      .leftJoin(tenants, eq(tenantReviews.tenantId, tenants.id))
      .orderBy(desc(tenantReviews.createdAt))
      .limit(20);

    res.json({ summary: rows, recent });
  } catch (err) {
    console.error("ratings /admin/summary error:", err);
    res.status(500).json({ message: "Failed to fetch summary" });
  }
});

export default router;

// ─── GET /api/ratings/org-reviews ────────────────────────────────────────────
// Admin / manager / staff: all tenant reviews within the organisation, with
// summary statistics and the most recent individual reviews.
router.get("/org-reviews", requireOrg as any, async (req: any, res) => {
  try {
    const role = req.user?.role ?? "tenant";
    const allowed = ["admin", "manager", "landlord", "staff"];
    if (!allowed.includes(role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const orgId: number = req.user.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation found" });

    // All reviews whose tenant belongs to this org
    const reviews = await db
      .select({
        id: tenantReviews.id,
        reviewType: tenantReviews.reviewType,
        rating: tenantReviews.rating,
        title: tenantReviews.title,
        comment: tenantReviews.comment,
        status: tenantReviews.status,
        createdAt: tenantReviews.createdAt,
        propertyId: tenantReviews.propertyId,
        tenantId: tenantReviews.tenantId,
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        propertyName: properties.name,
      })
      .from(tenantReviews)
      .leftJoin(tenants, eq(tenantReviews.tenantId, tenants.id))
      .leftJoin(properties, eq(tenantReviews.propertyId, properties.id))
      .where(eq(tenants.organizationId, orgId))
      .orderBy(desc(tenantReviews.createdAt));

    // Summary: average per type, overall average
    const byType: Record<string, { total: number; count: number }> = {};
    for (const r of reviews) {
      const t = r.reviewType ?? "unknown";
      if (!byType[t]) byType[t] = { total: 0, count: 0 };
      byType[t].total += Number(r.rating);
      byType[t].count += 1;
    }

    const summary = Object.entries(byType).map(([type, s]) => ({
      reviewType: type,
      avgRating: s.count > 0 ? Number((s.total / s.count).toFixed(2)) : 0,
      count: s.count,
    }));

    const totalRatings = reviews.length;
    const overallAvg = totalRatings > 0
      ? Number((reviews.reduce((s, r) => s + Number(r.rating), 0) / totalRatings).toFixed(2))
      : 0;

    // Rating distribution (1-5)
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) {
      const n = Number(r.rating);
      if (n >= 1 && n <= 5) distribution[n] = (distribution[n] || 0) + 1;
    }

    res.json({
      summary,
      overallAvg,
      totalRatings,
      distribution,
      reviews: reviews.slice(0, 50), // most recent 50
    });
  } catch (err) {
    console.error("ratings /org-reviews error:", err);
    res.status(500).json({ message: "Failed to fetch org reviews" });
  }
});

// ─── GET /api/ratings/my-property-reviews ────────────────────────────────────
// Landlord: reviews that tenants have left about their own properties / mgmt.
router.get("/my-property-reviews", async (req: any, res) => {
  try {
    const role = req.user?.role ?? "tenant";
    const allowed = ["admin", "manager", "landlord", "staff"];
    if (!allowed.includes(role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const userId = req.user.id; // UUID of the logged-in user

    // Find properties owned by this user
    const ownedProperties = await db
      .select({ id: properties.id, name: properties.name, address: properties.address })
      .from(properties)
      .where(eq(properties.ownerId, userId));

    if (ownedProperties.length === 0) {
      return res.json({ properties: [], reviews: [], overallAvg: 0, totalRatings: 0 });
    }

    const propertyIds = ownedProperties.map((p) => p.id);

    // All reviews referencing these properties (landlord + maintenance reviews)
    const reviews = await db
      .select({
        id: tenantReviews.id,
        reviewType: tenantReviews.reviewType,
        rating: tenantReviews.rating,
        title: tenantReviews.title,
        comment: tenantReviews.comment,
        status: tenantReviews.status,
        createdAt: tenantReviews.createdAt,
        propertyId: tenantReviews.propertyId,
        tenantId: tenantReviews.tenantId,
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        propertyName: properties.name,
      })
      .from(tenantReviews)
      .leftJoin(tenants, eq(tenantReviews.tenantId, tenants.id))
      .leftJoin(properties, eq(tenantReviews.propertyId, properties.id))
      .where(inArray(tenantReviews.propertyId, propertyIds))
      .orderBy(desc(tenantReviews.createdAt));

    const totalRatings = reviews.length;
    const overallAvg = totalRatings > 0
      ? Number((reviews.reduce((s, r) => s + Number(r.rating), 0) / totalRatings).toFixed(2))
      : 0;

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) {
      const n = Number(r.rating);
      if (n >= 1 && n <= 5) distribution[n] = (distribution[n] || 0) + 1;
    }

    res.json({
      ownedProperties,
      reviews,
      overallAvg,
      totalRatings,
      distribution,
    });
  } catch (err) {
    console.error("ratings /my-property-reviews error:", err);
    res.status(500).json({ message: "Failed to fetch property reviews" });
  }
});

// ─── GET /api/ratings/my-maintenance-feedback ─────────────────────────────────
// Maintenance staff: see aggregate satisfaction scores on jobs assigned to them.
// They see averages + distribution only — no individual tenant names or comments.
router.get("/my-maintenance-feedback", async (req: any, res) => {
  try {
    const role = req.user?.role ?? "tenant";
    if (!["admin", "manager", "staff", "caretaker"].includes(role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const userId = req.user.id; // UUID

    // Completed maintenance requests assigned to this staff member that have a rating
    const ratedJobs = await db
      .select({
        id: maintenanceRequests.id,
        title: maintenanceRequests.title,
        satisfactionRating: maintenanceRequests.satisfactionRating,
        completedAt: maintenanceRequests.completedAt,
        priority: maintenanceRequests.priority,
      })
      .from(maintenanceRequests)
      .where(
        and(
          eq(maintenanceRequests.assignedTo, userId),
          eq(maintenanceRequests.status, "completed"),
        )
      )
      .orderBy(desc(maintenanceRequests.completedAt))
      .limit(50);

    const withRating = ratedJobs.filter((j) => j.satisfactionRating !== null && j.satisfactionRating !== undefined);
    const totalRated  = withRating.length;
    const totalDone   = ratedJobs.length;
    const avg = totalRated > 0
      ? Number((withRating.reduce((s, j) => s + Number(j.satisfactionRating), 0) / totalRated).toFixed(2))
      : 0;

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const j of withRating) {
      const n = Number(j.satisfactionRating);
      if (n >= 1 && n <= 5) distribution[n] = (distribution[n] || 0) + 1;
    }

    // Return only the aggregate — no comments, no tenant info
    res.json({
      avgSatisfaction: avg,
      totalRated,
      totalCompleted: totalDone,
      distribution,
      // Recent 10 rated jobs (title + score only, no comment)
      recentRated: withRating.slice(0, 10).map((j) => ({
        id: j.id,
        title: j.title,
        rating: j.satisfactionRating,
        completedAt: j.completedAt,
      })),
    });
  } catch (err) {
    console.error("ratings /my-maintenance-feedback error:", err);
    res.status(500).json({ message: "Failed to fetch feedback" });
  }
});

// ─── GET /api/ratings/my-caretaker-rating ────────────────────────────────────
// Caretaker: see their own performance rating + the individual reviews tenants
// left about them (comments included — it's their own feedback).
router.get("/my-caretaker-rating", async (req: any, res) => {
  try {
    const userId = req.user.id;

    // Find caretaker record for this user
    const [ct] = await db
      .select({ id: caretakers.id, performanceRating: caretakers.performanceRating, propertyId: caretakers.propertyId })
      .from(caretakers)
      .where(eq(caretakers.userId, userId))
      .limit(1);

    if (!ct) return res.json({ found: false, reviews: [], avgRating: 0, totalReviews: 0 });

    // Reviews from tenants about this caretaker's property
    const reviews = await db
      .select({
        id: tenantReviews.id,
        rating: tenantReviews.rating,
        title: tenantReviews.title,
        comment: tenantReviews.comment,
        createdAt: tenantReviews.createdAt,
      })
      .from(tenantReviews)
      .where(
        and(
          eq(tenantReviews.reviewType, "caretaker"),
          ct.propertyId ? eq(tenantReviews.propertyId, ct.propertyId) : sql`1=1`,
        )
      )
      .orderBy(desc(tenantReviews.createdAt));

    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? Number((reviews.reduce((s, r) => s + Number(r.rating), 0) / totalReviews).toFixed(2))
      : Number(ct.performanceRating ?? 0);

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) {
      const n = Number(r.rating);
      if (n >= 1 && n <= 5) distribution[n] = (distribution[n] || 0) + 1;
    }

    // Caretakers see their own review comments — it's personal feedback for them
    res.json({
      found: true,
      performanceRating: Number(ct.performanceRating ?? 0),
      avgRating,
      totalReviews,
      distribution,
      reviews, // full comments — it's their own feedback
    });
  } catch (err) {
    console.error("ratings /my-caretaker-rating error:", err);
    res.status(500).json({ message: "Failed to fetch caretaker rating" });
  }
});