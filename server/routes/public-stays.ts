/**
 * server/routes/public-stays.ts
 *
 * The one deliberately public, cross-organisation, unauthenticated surface
 * in this system — a "storefront" view of short-term rental listings that
 * have explicitly opted into either the shared marketplace or a direct
 * link. Everywhere else in this app, org-scoping keeps data strictly
 * separated; here, that's inverted on purpose, so it has to be handled
 * with real care rather than reusing the internal CRUD pattern.
 *
 * Two rules enforced throughout this file:
 *   1. Only ever select an explicit, safe subset of columns — never a
 *      blind `select()` the way authenticated internal routes do. Internal
 *      fields (ownerId, tenantId, organizationId, commission/fee splits,
 *      internal notes, who approved it) must never reach this router's
 *      responses.
 *   2. Every price a guest ends up paying is computed here, server-side,
 *      from the listing's own stored nightly rate — never trusted from
 *      the request body. A public endpoint that let a caller supply their
 *      own totalAmount would be trivially exploitable.
 */

import { Router } from "express";
import { db } from "../db";
import { eq, and, ne, lt, gte, sql } from "drizzle-orm";
import { tenantShortRentals, tenantShortBookings, listingBlockedDates } from "@shared/schema";
import { z } from "zod";
import { resolveFromUnitId } from "../utils/resolvePaymentConfig";
import { createMPesaServiceForOverrides } from "../services/mpesa";
import { storage } from "../storage";
import { hasBlockedDateOverlap } from "./tenant-subletting";

export const publicStaysRouter = Router();

/** Normalizes common Kenyan phone input formats to the 2547XXXXXXXX shape
 *  Safaricom's STK Push requires. A public guest form can't be assumed to
 *  already send the right format the way an internal, JS-validated form
 *  might — this has to actually handle 07..., +254..., 254... itself. */
function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "254" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 9) return "254" + digits;
  if (digits.startsWith("1") && digits.length === 9) return "254" + digits; // 01... Safaricom range
  return null;
}

// Exactly the columns a stranger browsing the marketplace should ever see.
const PUBLIC_LISTING_FIELDS = {
  id: tenantShortRentals.id,
  slug: tenantShortRentals.slug,
  listingTitle: tenantShortRentals.listingTitle,
  description: tenantShortRentals.description,
  nightlyRate: tenantShortRentals.nightlyRate,
  currency: tenantShortRentals.currency,
  minimumNights: tenantShortRentals.minimumNights,
  maximumNights: tenantShortRentals.maximumNights,
  amenities: tenantShortRentals.amenities,
  houseRules: tenantShortRentals.houseRules,
  checkInTime: tenantShortRentals.checkInTime,
  checkOutTime: tenantShortRentals.checkOutTime,
  listingPhotos: tenantShortRentals.listingPhotos,
  instantBookingEnabled: tenantShortRentals.instantBookingEnabled,
};

// ── GET /api/public/stays — marketplace browse ────────────────────────────────
// Only listings that are approved, active, AND have explicitly opted into
// the shared marketplace. A listing can be perfectly bookable via its own
// direct link (see /:slug below) without ever appearing here.
publicStaysRouter.get("/", async (req: any, res: any) => {
  try {
    const rows = await db
      .select(PUBLIC_LISTING_FIELDS)
      .from(tenantShortRentals)
      .where(and(
        eq(tenantShortRentals.isPubliclyListed, true),
        eq(tenantShortRentals.approvalStatus, "approved"),
        eq(tenantShortRentals.isActive, true),
      ))
      .orderBy(tenantShortRentals.createdAt);
    res.json(rows);
  } catch (err) {
    console.error("[public-stays] GET /:", err);
    res.status(500).json({ message: "Failed to load listings" });
  }
});

// ── GET /api/public/stays/:slug — a single listing's public page ─────────────
// Deliberately NOT gated on isPubliclyListed — a direct/shared link should
// work regardless of marketplace opt-in. Still gated on approved + active,
// since an unapproved or deactivated listing shouldn't be reachable by any
// path, direct link included.
publicStaysRouter.get("/:slug", async (req: any, res: any) => {
  try {
    const [listing] = await db
      .select(PUBLIC_LISTING_FIELDS)
      .from(tenantShortRentals)
      .where(and(
        eq(tenantShortRentals.slug, req.params.slug),
        eq(tenantShortRentals.approvalStatus, "approved"),
        eq(tenantShortRentals.isActive, true),
      ))
      .limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });
    res.json(listing);
  } catch (err) {
    console.error("[public-stays] GET /:slug:", err);
    res.status(500).json({ message: "Failed to load listing" });
  }
});

// ── GET /api/public/stays/:slug/booked-dates — for calendar display ──────────
// Returns only date ranges, nothing about who booked them or what they
// paid — a guest browsing needs to know which dates are taken, nothing more.
publicStaysRouter.get("/:slug/booked-dates", async (req: any, res: any) => {
  try {
    const [listing] = await db.select({ id: tenantShortRentals.id }).from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.slug, req.params.slug), eq(tenantShortRentals.approvalStatus, "approved"), eq(tenantShortRentals.isActive, true)))
      .limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });

    const bookings = await db
      .select({ checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, listing.id),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        // Only future/current bookings matter for availability — no point
        // returning years of past stays to a public caller.
        gte(tenantShortBookings.checkOutDate, sql`now()`),
      ));

    // Host-blocked dates count as unavailable too, same as a real booking —
    // returned in the same shape (checkInDate/checkOutDate) so the frontend
    // calendar doesn't need to know the difference between the two.
    const blocks = await db
      .select({ checkInDate: listingBlockedDates.startDate, checkOutDate: listingBlockedDates.endDate })
      .from(listingBlockedDates)
      .where(and(
        eq(listingBlockedDates.rentalListingId, listing.id),
        gte(listingBlockedDates.endDate, sql`now()`),
      ));

    res.json([...bookings, ...blocks]);
  } catch (err) {
    console.error("[public-stays] GET /:slug/booked-dates:", err);
    res.status(500).json({ message: "Failed to load availability" });
  }
});

const bookRequestSchema = z.object({
  guestName: z.string().min(1).max(100),
  guestEmail: z.string().email(),
  guestPhone: z.string().min(7).max(20),
  guestCount: z.number().int().min(1),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  specialRequests: z.string().max(1000).optional(),
});

// ── POST /api/public/stays/:slug/book — guest creates a booking ──────────────
// No auth — this is the whole point of a public booking flow. Every price
// field is computed here from the listing's own stored rate; nothing
// financial is ever accepted from the request body.
publicStaysRouter.post("/:slug/book", async (req: any, res: any) => {
  try {
    const parsed = bookRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid booking request.", errors: parsed.error.errors });
    }
    const body = parsed.data;

    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(
        eq(tenantShortRentals.slug, req.params.slug),
        eq(tenantShortRentals.approvalStatus, "approved"),
        eq(tenantShortRentals.isActive, true),
      ))
      .limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });

    const checkIn = new Date(body.checkInDate);
    const checkOut = new Date(body.checkOutDate);
    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
      return res.status(400).json({ message: "Invalid check-in/check-out dates." });
    }
    const numberOfNights = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    if (numberOfNights < listing.minimumNights) {
      return res.status(400).json({ message: `This listing requires a minimum stay of ${listing.minimumNights} night(s).` });
    }
    if (numberOfNights > listing.maximumNights) {
      return res.status(400).json({ message: `This listing allows a maximum stay of ${listing.maximumNights} night(s).` });
    }

    // Double-booking prevention — same rule as the authenticated booking
    // endpoint, checked again here since this is a genuinely separate
    // entry point into the same table.
    const conflicting = await db
      .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, listing.id),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        lt(tenantShortBookings.checkInDate, checkOut),
      ));
    const hasOverlap = conflicting.some(b => new Date(b.checkOutDate) > checkIn);
    if (hasOverlap) {
      return res.status(409).json({
        message: "Those dates are no longer available for this listing.",
        code: "BOOKING_DATES_UNAVAILABLE",
      });
    }
    if (await hasBlockedDateOverlap(listing.id, checkIn, checkOut)) {
      return res.status(409).json({
        message: "Those dates are blocked by the host and aren't available for booking.",
        code: "BOOKING_DATES_UNAVAILABLE",
      });
    }

    // Every financial figure computed from the listing's own stored rate
    // and configured commission/fee percentages — never from the request
    // body. tenantPayout is derived as the remainder (total - commission -
    // platform fees) rather than from tenantEarningsShare directly, so the
    // three figures always sum exactly to totalAmount even if a listing's
    // configured percentages don't add up to precisely 100.
    const nightlyRate = Number(listing.nightlyRate);
    const totalAmountNum = nightlyRate * numberOfNights;
    const totalAmount = totalAmountNum.toFixed(2);
    const propertyManagerCommission = (totalAmountNum * (Number(listing.propertyManagerCommission) / 100)).toFixed(2);
    const platformFees = (totalAmountNum * (Number(listing.platformFees) / 100)).toFixed(2);
    const tenantPayout = (totalAmountNum - Number(propertyManagerCommission) - Number(platformFees)).toFixed(2);
    const bookingReference = `BK-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const [created] = await db.insert(tenantShortBookings).values({
      organizationId: listing.organizationId,
      rentalListingId: listing.id,
      bookingReference,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      guestPhone: body.guestPhone,
      guestCount: body.guestCount,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      numberOfNights,
      nightlyRate: listing.nightlyRate,
      totalAmount,
      propertyManagerCommission,
      platformFees,
      tenantPayout,
      currency: listing.currency,
      // Pending until payment is confirmed — see the follow-up payment
      // integration this deliberately doesn't include yet.
      bookingStatus: "pending",
      paymentStatus: "pending",
      platformSource: "direct",
      specialRequests: body.specialRequests,
    }).returning({
      id: tenantShortBookings.id,
      bookingReference: tenantShortBookings.bookingReference,
      checkInDate: tenantShortBookings.checkInDate,
      checkOutDate: tenantShortBookings.checkOutDate,
      numberOfNights: tenantShortBookings.numberOfNights,
      totalAmount: tenantShortBookings.totalAmount,
      currency: tenantShortBookings.currency,
      bookingStatus: tenantShortBookings.bookingStatus,
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("[public-stays] POST /:slug/book:", err);
    res.status(500).json({ message: "Failed to create booking" });
  }
});

// ── GET /api/public/stays/:slug/bookings/:bookingId/status ────────────────────
// Lightweight polling target for the frontend while waiting on the async
// STK Push callback — deliberately returns only status fields, nothing else
// about the booking or guest.
publicStaysRouter.get("/:slug/bookings/:bookingId/status", async (req: any, res: any) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) return res.status(400).json({ message: "Invalid booking." });

    const [listing] = await db.select({ id: tenantShortRentals.id }).from(tenantShortRentals)
      .where(eq(tenantShortRentals.slug, req.params.slug)).limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });

    const [booking] = await db
      .select({ bookingStatus: tenantShortBookings.bookingStatus, paymentStatus: tenantShortBookings.paymentStatus })
      .from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, bookingId), eq(tenantShortBookings.rentalListingId, listing.id)))
      .limit(1);
    if (!booking) return res.status(404).json({ message: "Booking not found." });

    res.json(booking);
  } catch (err) {
    console.error("[public-stays] GET /:slug/bookings/:bookingId/status:", err);
    res.status(500).json({ message: "Failed to check status" });
  }
});

const payRequestSchema = z.object({
  phoneNumber: z.string().min(7).max(20),
});

// ── POST /api/public/stays/:slug/bookings/:bookingId/pay ──────────────────────
// Initiates M-Pesa STK Push for a specific pending booking. No auth — the
// guest reaches this right after booking, using the bookingId they were
// just given. The booking is verified to actually belong to this listing's
// slug before anything is charged, so a guessed/foreign bookingId can't be
// used to trigger a payment prompt against someone else's stay.
publicStaysRouter.post("/:slug/bookings/:bookingId/pay", async (req: any, res: any) => {
  try {
    const parsed = payRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "A valid phone number is required." });
    }
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) return res.status(400).json({ message: "Invalid booking." });

    const [listing] = await db.select().from(tenantShortRentals)
      .where(and(eq(tenantShortRentals.slug, req.params.slug), eq(tenantShortRentals.approvalStatus, "approved"), eq(tenantShortRentals.isActive, true)))
      .limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });

    const [booking] = await db.select().from(tenantShortBookings)
      .where(and(eq(tenantShortBookings.id, bookingId), eq(tenantShortBookings.rentalListingId, listing.id)))
      .limit(1);
    if (!booking) return res.status(404).json({ message: "Booking not found for this listing." });
    if (booking.bookingStatus === "cancelled") {
      return res.status(409).json({ message: "This booking has been cancelled." });
    }
    if (booking.paymentStatus === "paid") {
      return res.status(409).json({ message: "This booking has already been paid." });
    }

    const phoneNumber = normalizeKenyanPhone(parsed.data.phoneNumber);
    if (!phoneNumber) {
      return res.status(400).json({ message: "Enter a valid Kenyan phone number, e.g. 07XXXXXXXX." });
    }

    // Reuses the exact same cascade every other payment flow in this app
    // uses (unit -> property -> owner -> landlord settings -> external
    // landlord -> org default) — a booking's money should reach the same
    // destination rent for that property already goes to, not a separate
    // path invented just for bookings.
    const resolved = await resolveFromUnitId(listing.unitId, listing.organizationId);
    const mpesaService = createMPesaServiceForOverrides(resolved.mpesaCredentials ?? {});
    if (!mpesaService) {
      return res.status(409).json({
        message: "Automatic M-Pesa payment isn't available for this listing yet. Please contact the host directly to arrange payment.",
        code: "STK_NOT_CONFIGURED",
      });
    }

    const amount = Math.round(Number(booking.totalAmount));
    const stkResponse = await mpesaService.initiateSTKPush({
      phoneNumber,
      amount,
      accountReference: booking.bookingReference.slice(0, 12),
      transactionDesc: "Stay booking".slice(0, 13),
    });

    await storage.createMpesaTransaction({
      phoneNumber,
      amount: String(amount),
      status: "pending",
      merchantRequestId: stkResponse.MerchantRequestID,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      responseCode: stkResponse.ResponseCode,
      responseDescription: stkResponse.ResponseDescription,
      customerMessage: stkResponse.CustomerMessage,
      description: `Short-term stay booking ${booking.bookingReference}`,
      shortTermBookingId: booking.id,
    });

    res.status(200).json({
      checkoutRequestId: stkResponse.CheckoutRequestID,
      customerMessage: stkResponse.CustomerMessage,
    });
  } catch (err: any) {
    console.error("[public-stays] POST /:slug/bookings/:bookingId/pay:", err);
    res.status(502).json({ message: err.message || "Failed to initiate payment" });
  }
});