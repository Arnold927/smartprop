/**
 * Tenant Subletting routes
 *
 * Mounts at:
 *   /api/tenant-short-rentals  — CRUD + status patch
 *   /api/short-term-bookings   — CRUD
 */
import { Router } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import {
  tenantShortRentals,
  tenantShortBookings,
  insertTenantShortRentalSchema,
  insertTenantShortBookingSchema,
} from "@shared/schema";
import { z } from "zod";

// ── Tenant Short Rentals Router ───────────────────────────────────────────────
export const tenantShortRentalsRouter = Router();
tenantShortRentalsRouter.use(authenticateJWT, requireOrg);

// GET /api/tenant-short-rentals
tenantShortRentalsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(tenantShortRentals)
      .where(eq(tenantShortRentals.organizationId, orgId))
      .orderBy(tenantShortRentals.createdAt);
    return res.json(rows);
  } catch (err) {
    console.error("Error listing tenant short rentals:", err);
    return res.status(500).json({ message: "Failed to fetch listings" });
  }
});

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
    // Ensure numeric fields are strings for decimal validation
    const formattedBody = { ...req.body };
    ["nightlyRate", "propertyManagerCommission", "tenantEarningsShare", "platformFees"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    const payload = insertTenantShortRentalSchema.parse({
      ...formattedBody,
      organizationId: orgId,
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
    // Ensure numeric fields are strings for decimal validation
    const formattedBody = { ...req.body };
    ["nightlyRate", "propertyManagerCommission", "tenantEarningsShare", "platformFees"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

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

// PATCH /api/tenant-short-rentals/:id/status
tenantShortRentalsRouter.patch("/:id/status", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: "status is required" });

    const rows = await db
      .update(tenantShortRentals)
      .set({ approvalStatus: status, updatedAt: new Date() })
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Error updating status:", err);
    return res.status(500).json({ message: "Failed to update status" });
  }
});

// DELETE /api/tenant-short-rentals/:id
tenantShortRentalsRouter.delete("/:id", async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const rows = await db
      .delete(tenantShortRentals)
      .where(and(eq(tenantShortRentals.id, id), eq(tenantShortRentals.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.status(204).send();
  } catch (err) {
    console.error("Error deleting tenant short rental:", err);
    return res.status(500).json({ message: "Failed to delete listing" });
  }
});

// ── Short Term Bookings Router ────────────────────────────────────────────────
export const shortTermBookingsRouter = Router();
shortTermBookingsRouter.use(authenticateJWT, requireOrg);

// GET /api/short-term-bookings
shortTermBookingsRouter.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(tenantShortBookings)
      .where(eq(tenantShortBookings.organizationId, orgId))
      .orderBy(tenantShortBookings.createdAt);
    return res.json(rows);
  } catch (err) {
    console.error("Error listing short term bookings:", err);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

// GET /api/short-term-bookings/:id
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
    // Ensure numeric fields are strings for decimal validation
    const formattedBody = { ...req.body };
    ["nightlyRate", "totalAmount", "cleaningFee", "platformFees", "propertyManagerCommission", "tenantPayout", "securityDeposit"].forEach(field => {
      if (formattedBody[field] !== undefined && typeof formattedBody[field] === "number") {
        formattedBody[field] = formattedBody[field].toString();
      }
    });

    const payload = insertTenantShortBookingSchema.partial().parse(formattedBody);
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
    const rows = await db
      .delete(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, id), eq(tenantShortBookings.organizationId, orgId)))
      .returning();
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    return res.status(204).send();
  } catch (err) {
    console.error("Error deleting short term booking:", err);
    return res.status(500).json({ message: "Failed to delete booking" });
  }
});
