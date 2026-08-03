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
import { tenantShortRentals, tenantShortBookings, listingBlockedDates, units, properties, tenants, users } from "@shared/schema";
import { z } from "zod";
import { resolveFromUnitId } from "../utils/resolvePaymentConfig";
import { createMPesaServiceForOverrides } from "../services/mpesa";
import { storage } from "../storage";
import { hasBlockedDateOverlap, expireStalePendingBookings } from "./tenant-subletting";
import { sendRefundOwedEmail } from "../lib/email";

/** Derives a general area from a full address — e.g. "12 Riverside Drive,
 *  Kilimani, Nairobi" becomes "Kilimani, Nairobi". A guest browsing or
 *  deciding whether to book shouldn't see a host's exact address; that's
 *  shared only once a stay is actually confirmed and paid for, the same
 *  safety practice real booking platforms follow. Falls back to the full
 *  string if it isn't comma-separated into that shape. */
function generalAreaFromAddress(address: string): string {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return address;
  return parts.slice(-2).join(", ");
}

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
  maxGuests: tenantShortRentals.maxGuests,
  instantBookingEnabled: tenantShortRentals.instantBookingEnabled,
};

// ── GET /api/public/stays — marketplace browse ────────────────────────────────
// Only listings that are approved, active, AND have explicitly opted into
// the shared marketplace. A listing can be perfectly bookable via its own
// direct link (see /:slug below) without ever appearing here.
//
// Optional ?checkIn=&checkOut= narrows results to listings actually free
// for those dates — the core "where + when" search any real booking site
// is built around, not just a browsable list with no way to search by date.
publicStaysRouter.get("/", async (req: any, res: any) => {
  try {
    const rows = await db
      .select({
        ...PUBLIC_LISTING_FIELDS,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
        sqft: units.sqft,
        address: properties.address,
      })
      .from(tenantShortRentals)
      .innerJoin(units, eq(tenantShortRentals.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(tenantShortRentals.isPubliclyListed, true),
        eq(tenantShortRentals.approvalStatus, "approved"),
        eq(tenantShortRentals.isActive, true),
      ))
      .orderBy(tenantShortRentals.createdAt);

    // Never the exact address pre-booking — same reasoning as the single
    // listing endpoint below.
    const withGeneralArea = rows.map(({ address, ...rest }) => ({ ...rest, generalArea: generalAreaFromAddress(address) }));

    const { checkIn, checkOut } = req.query;
    if (!checkIn || !checkOut) {
      return res.json(withGeneralArea);
    }
    const checkInDate = new Date(checkIn as string);
    const checkOutDate = new Date(checkOut as string);
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
      return res.json(withGeneralArea); // invalid dates — fall back to unfiltered results rather than error
    }

    // Proportionate for a marketplace at this scale — one overlap check per
    // candidate listing, reusing the exact logic every other booking path
    // already uses, rather than duplicating it in a bigger single query.
    const available: typeof withGeneralArea = [];
    for (const listing of withGeneralArea) {
      const conflicting = await db
        .select({ checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
        .from(tenantShortBookings)
        .where(and(
          eq(tenantShortBookings.rentalListingId, listing.id),
          ne(tenantShortBookings.bookingStatus, "cancelled"),
          ne(tenantShortBookings.bookingStatus, "expired"),
          lt(tenantShortBookings.checkInDate, checkOutDate),
        ));
      const hasBookingOverlap = conflicting.some(b => new Date(b.checkOutDate) > checkInDate);
      if (hasBookingOverlap) continue;
      if (await hasBlockedDateOverlap(listing.id, checkInDate, checkOutDate)) continue;
      available.push(listing);
    }
    res.json(available);
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
      .select({
        ...PUBLIC_LISTING_FIELDS,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
        sqft: units.sqft,
        address: properties.address,
      })
      .from(tenantShortRentals)
      .innerJoin(units, eq(tenantShortRentals.unitId, units.id))
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(and(
        eq(tenantShortRentals.slug, req.params.slug),
        eq(tenantShortRentals.approvalStatus, "approved"),
        eq(tenantShortRentals.isActive, true),
      ))
      .limit(1);
    if (!listing) return res.status(404).json({ message: "Listing not found." });
    const { address, ...safeListing } = listing;
    res.json({ ...safeListing, generalArea: generalAreaFromAddress(address) });
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

    await expireStalePendingBookings(listing.id);
    const bookings = await db
      .select({ checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, listing.id),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        ne(tenantShortBookings.bookingStatus, "expired"),
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
    if (body.guestCount > listing.maxGuests) {
      return res.status(400).json({ message: `This listing sleeps a maximum of ${listing.maxGuests} guest(s).` });
    }

    // Double-booking prevention — same rule as the authenticated booking
    // endpoint, checked again here since this is a genuinely separate
    // entry point into the same table.
    await expireStalePendingBookings(listing.id);
    const conflicting = await db
      .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, listing.id),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        ne(tenantShortBookings.bookingStatus, "expired"),
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
  } catch (err: any) {
    if (err?.code === "23P01") {
      return res.status(409).json({
        message: "Those dates were just booked by someone else — please pick different dates.",
        code: "BOOKING_DATES_UNAVAILABLE",
      });
    }
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

const lookupSchema = z.object({
  bookingReference: z.string().min(1),
  guestEmail: z.string().email(),
});

// GET /api/public/stays/bookings/lookup?bookingReference=&guestEmail=
// A guest's only identity is their reference number — verification
// requires it together with the email they booked with, so a guessed or
// leaked reference number alone can't be used to view someone else's
// booking or personal details.
publicStaysRouter.get("/bookings/lookup", async (req: any, res: any) => {
  try {
    const parsed = lookupSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "A booking reference and the email you booked with are required." });

    const [booking] = await db.select().from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.bookingReference, parsed.data.bookingReference),
        eq(tenantShortBookings.guestEmail, parsed.data.guestEmail.toLowerCase()),
      )).limit(1);
    if (!booking) return res.status(404).json({ message: "No booking found with that reference and email." });

    const [listing] = await db.select({ listingTitle: tenantShortRentals.listingTitle, slug: tenantShortRentals.slug })
      .from(tenantShortRentals).where(eq(tenantShortRentals.id, booking.rentalListingId)).limit(1);

    res.json({
      bookingReference: booking.bookingReference,
      listingTitle: listing?.listingTitle ?? "Listing",
      listingSlug: listing?.slug ?? null,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      numberOfNights: booking.numberOfNights,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      refundStatus: booking.refundStatus,
    });
  } catch (err) {
    console.error("[public-stays] GET /bookings/lookup:", err);
    res.status(500).json({ message: "Failed to look up booking" });
  }
});

// POST /api/public/stays/bookings/:reference/cancel — guest cancels their
// own booking, same reference+email verification as lookup. Mirrors the
// authenticated cancel endpoint's soft-cancel and refund-tracking logic,
// since this is a genuinely separate entry point into the same table.
publicStaysRouter.post("/bookings/:reference/cancel", async (req: any, res: any) => {
  try {
    const { guestEmail } = req.body;
    if (!guestEmail || typeof guestEmail !== "string") {
      return res.status(400).json({ message: "The email you booked with is required to cancel." });
    }

    const [booking] = await db.select().from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.bookingReference, req.params.reference),
        eq(tenantShortBookings.guestEmail, guestEmail.toLowerCase()),
      )).limit(1);
    if (!booking) return res.status(404).json({ message: "No booking found with that reference and email." });
    if (booking.bookingStatus === "cancelled") return res.status(409).json({ message: "This booking is already cancelled." });
    if (booking.bookingStatus === "checked_out") return res.status(409).json({ message: "A completed stay can't be cancelled." });

    const wasPaid = booking.paymentStatus === "paid";
    const [updated] = await db.update(tenantShortBookings)
      .set({
        bookingStatus: "cancelled",
        ...(wasPaid ? { refundStatus: "owed", refundAmount: booking.totalAmount } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenantShortBookings.id, booking.id))
      .returning();

    if (wasPaid) {
      try {
        const [listingRow] = await db.select().from(tenantShortRentals).where(eq(tenantShortRentals.id, booking.rentalListingId)).limit(1);
        let hostEmail: string | null = null;
        let hostName = "there";
        if (listingRow?.tenantId) {
          const [tenantRow] = await db.select({ email: tenants.email, firstName: tenants.firstName }).from(tenants).where(eq(tenants.id, listingRow.tenantId)).limit(1);
          hostEmail = tenantRow?.email ?? null;
          hostName = tenantRow?.firstName ?? hostName;
        } else if (listingRow?.ownerId) {
          const [ownerRow] = await db.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, listingRow.ownerId)).limit(1);
          hostEmail = ownerRow?.email ?? null;
          hostName = ownerRow?.firstName ?? hostName;
        }
        if (hostEmail) {
          await sendRefundOwedEmail({
            to: hostEmail,
            hostName,
            guestName: booking.guestName,
            guestPhone: booking.guestPhone,
            bookingReference: booking.bookingReference,
            amount: String(booking.totalAmount),
            currency: booking.currency,
          });
        }
      } catch (emailErr) {
        console.error("Guest cancelled a paid booking, but refund-owed notice failed to send:", emailErr);
      }
    }

    res.json({ bookingStatus: updated.bookingStatus, refundStatus: updated.refundStatus });
  } catch (err) {
    console.error("[public-stays] POST /bookings/:reference/cancel:", err);
    res.status(500).json({ message: "Failed to cancel booking" });
  }
});