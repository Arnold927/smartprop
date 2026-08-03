/**
 * server/routes/ical-export.ts
 *
 * Public iCal export — the half of calendar sync that external platforms
 * read from. A real platform (Airbnb, VRBO, Booking.com) fetches this URL
 * on its own schedule to learn which dates are already taken here, so it
 * doesn't let someone book the same dates on their side too.
 *
 * No JWT auth here by necessity — external platforms hit a plain URL with
 * no custom headers. The listing's own secret icalExportToken is the
 * actual access control, embedded in the URL itself (the same pattern
 * Google Calendar uses for its "secret address in iCal format" sharing).
 *
 * Deliberately minimal event content — "Booked"/"Blocked", nothing about
 * the guest. This URL could end up cached or logged by a third party
 * platform; it should never leak guest names, emails, or phone numbers.
 */
import { Router } from "express";
import { db } from "../db";
import { eq, and, ne, gte, sql } from "drizzle-orm";
import { tenantShortRentals, tenantShortBookings, listingBlockedDates } from "@shared/schema";

export const icalExportRouter = Router();

function formatIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildIcalFeed(listingTitle: string, events: { uid: string; start: Date; end: Date; summary: string }[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SmartProp//Stays//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${listingTitle} — SmartProp`,
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${formatIcalDate(new Date())}`,
      `DTSTART;VALUE=DATE:${ev.start.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${ev.end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${ev.summary}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// GET /api/ical/:listingId/:token.ics
icalExportRouter.get("/:listingId/:tokenFile", async (req: any, res: any) => {
  try {
    const listingId = parseInt(req.params.listingId);
    const token = String(req.params.tokenFile).replace(/\.ics$/i, "");
    if (isNaN(listingId) || !token) return res.status(404).send("Not found");

    const [listing] = await db.select({ id: tenantShortRentals.id, listingTitle: tenantShortRentals.listingTitle, icalExportToken: tenantShortRentals.icalExportToken })
      .from(tenantShortRentals)
      .where(eq(tenantShortRentals.id, listingId))
      .limit(1);
    if (!listing || !listing.icalExportToken || listing.icalExportToken !== token) {
      return res.status(404).send("Not found");
    }

    const bookings = await db
      .select({ id: tenantShortBookings.id, checkInDate: tenantShortBookings.checkInDate, checkOutDate: tenantShortBookings.checkOutDate })
      .from(tenantShortBookings)
      .where(and(
        eq(tenantShortBookings.rentalListingId, listingId),
        ne(tenantShortBookings.bookingStatus, "cancelled"),
        ne(tenantShortBookings.bookingStatus, "expired"),
        gte(tenantShortBookings.checkOutDate, sql`now() - interval '1 day'`),
      ));
    const blocks = await db
      .select({ id: listingBlockedDates.id, startDate: listingBlockedDates.startDate, endDate: listingBlockedDates.endDate })
      .from(listingBlockedDates)
      .where(and(eq(listingBlockedDates.rentalListingId, listingId), gte(listingBlockedDates.endDate, sql`now() - interval '1 day'`)));

    const events = [
      ...bookings.map(b => ({ uid: `smartprop-booking-${b.id}@smartprop`, start: new Date(b.checkInDate), end: new Date(b.checkOutDate), summary: "Booked" })),
      ...blocks.map(b => ({ uid: `smartprop-block-${b.id}@smartprop`, start: new Date(b.startDate), end: new Date(b.endDate), summary: "Blocked" })),
    ];

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${listing.id}.ics"`);
    res.send(buildIcalFeed(listing.listingTitle, events));
  } catch (err) {
    console.error("[ical-export] GET /:listingId/:tokenFile:", err);
    res.status(500).send("Failed to generate calendar");
  }
});