/**
 * Short-stay bookings — the rules every entry point shares.
 *
 * The staff screens, the public booking page and the M-Pesa callback all write to tenant_short_bookings. Each used to
 * carry its own copy of the rules and the copies had drifted: staff could post their own prices and a "paid" status, a
 * payment that arrived after a booking expired or was cancelled still confirmed it, and a guest could cancel a stay they
 * were already living in for a full refund. The rules now live here once.
 */
import { db } from "../db";
import { tenantShortBookings, tenantShortRentals, tenants, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import dns from "dns/promises";
import net from "net";
import { sendRefundOwedEmail } from "../lib/email";

export class StayError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const stayFail = (status: number, message: string, code?: string): never => { throw new StayError(status, message, code); };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const MAX_NIGHTLY_RATE = 10_000_000;   // column is decimal(10,2); this is far above any real rate and far below the limit

/** Nights between two dates, counted as whole days (a stay is at least one night). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

/**
 * Every money figure of a booking, worked out from the listing's own rate and split. The three parts always add up to the
 * total (the host's payout is what is left after the manager's commission and the platform fee).
 */
export function stayFinancials(
  listing: { nightlyRate: any; propertyManagerCommission: any; platformFees: any },
  nights: number,
) {
  const total = r2(Number(listing.nightlyRate) * nights);
  const commission = r2(total * (Number(listing.propertyManagerCommission) / 100));
  const fees = r2(total * (Number(listing.platformFees) / 100));
  const payout = r2(total - commission - fees);
  return {
    nightlyRate: String(listing.nightlyRate),
    totalAmount: total.toFixed(2),
    propertyManagerCommission: commission.toFixed(2),
    platformFees: fees.toFixed(2),
    tenantPayout: payout.toFixed(2),
  };
}

/** Allowed booking status moves. Cancelling is its own action (it owes a refund when the guest has paid). */
export const STAY_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed"],
  confirmed: ["checked_in"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  expired: [],
};

/** Looks up the person who has to send a refund: the sublet tenant or the owner behind the listing. */
async function hostContact(listing: { tenantId: number | null; ownerId: string | null }) {
  if (listing.tenantId) {
    const [t] = await db.select({ email: tenants.email, firstName: tenants.firstName }).from(tenants).where(eq(tenants.id, listing.tenantId)).limit(1);
    return { email: t?.email ?? null, name: t?.firstName ?? "there" };
  }
  if (listing.ownerId) {
    const [u] = await db.select({ email: users.email, firstName: users.firstName }).from(users).where(eq(users.id, listing.ownerId)).limit(1);
    return { email: u?.email ?? null, name: u?.firstName ?? "there" };
  }
  return { email: null as string | null, name: "there" };
}

/** Tells the host a refund is owed. A failure to send never undoes the cancellation. */
export async function notifyRefundOwed(booking: any, amount?: string): Promise<void> {
  try {
    const [listing] = await db.select().from(tenantShortRentals).where(eq(tenantShortRentals.id, booking.rentalListingId)).limit(1);
    if (!listing) return;
    const host = await hostContact(listing);
    if (!host.email) return;
    await sendRefundOwedEmail({
      to: host.email, hostName: host.name, guestName: booking.guestName, guestPhone: booking.guestPhone,
      bookingReference: booking.bookingReference, amount: amount ?? String(booking.refundAmount ?? booking.totalAmount), currency: booking.currency,
    });
  } catch (err) {
    console.error("Booking changed, but the refund-owed notice failed to send:", err);
  }
}

/**
 * Cancels a booking. Locks the row so two cancels cannot both succeed (and both send the refund notice), refuses stays
 * that have started or finished, and records the refund owed when the guest has paid. `lateAmount` is added when a
 * second payment had already been received (see applyStayPayment).
 */
export async function cancelStayBooking(bookingId: number, opts: { orgId?: number; guestEmail?: string; guestSide?: boolean } = {}) {
  const result = await db.transaction(async (tx) => {
    const [b] = await tx.select().from(tenantShortBookings).where(eq(tenantShortBookings.id, bookingId)).for("update").limit(1);
    if (!b || (opts.orgId && b.organizationId !== opts.orgId)) return stayFail(404, "Not found");
    if (opts.guestEmail && b.guestEmail.toLowerCase() !== opts.guestEmail.toLowerCase()) return stayFail(404, "No booking found with that reference and email.");
    if (b.bookingStatus === "cancelled") return stayFail(409, "This booking is already cancelled.");
    if (b.bookingStatus === "expired") return stayFail(409, "This booking has already expired.");
    if (b.bookingStatus === "checked_out") return stayFail(409, "A completed stay can't be cancelled.");
    if (b.bookingStatus === "checked_in") return stayFail(409, "The guest has already checked in, so the stay can't be cancelled. Check them out when they leave.", "STAY_STARTED");
    if (opts.guestSide && new Date(b.checkInDate).getTime() <= Date.now()) {
      return stayFail(409, "The stay has already started. Please contact the host to change it.", "STAY_STARTED");
    }
    const wasPaid = b.paymentStatus === "paid";
    // A refund already owed for an earlier double payment stays owed on top of this one.
    const priorOwed = b.refundStatus === "owed" ? Number(b.refundAmount ?? 0) : 0;
    const refundAmount = wasPaid ? r2(Number(b.totalAmount) + priorOwed) : null;
    const [updated] = await tx.update(tenantShortBookings).set({
      bookingStatus: "cancelled",
      ...(wasPaid ? { refundStatus: "owed", refundAmount: String(refundAmount) } : {}),
      updatedAt: new Date(),
    }).where(eq(tenantShortBookings.id, bookingId)).returning();
    return { booking: updated, wasPaid };
  });
  if (result.wasPaid) await notifyRefundOwed(result.booking);
  return result.booking;
}

/**
 * A guest's M-Pesa payment has arrived. Decides what it means for the booking, once, under a row lock:
 *   confirmed   the booking was waiting for this money, now paid and confirmed
 *   duplicate   the same booking was already paid: the extra money is recorded as a refund owed
 *   late        the booking had been cancelled or had expired: the money is recorded as a refund owed
 *   short       less than the price arrived: nothing is confirmed, the money is recorded as a refund owed
 */
export async function applyStayPayment(bookingId: number, amountPaid: number): Promise<{ outcome: "confirmed" | "duplicate" | "late" | "short" | "unknown"; booking?: any }> {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(tenantShortBookings).where(eq(tenantShortBookings.id, bookingId)).for("update").limit(1);
    if (!b) return { outcome: "unknown" as const };
    const owedSoFar = b.refundStatus === "owed" ? Number(b.refundAmount ?? 0) : 0;
    const owe = async (outcome: "duplicate" | "late" | "short", extra: Record<string, any> = {}) => {
      const [u] = await tx.update(tenantShortBookings).set({
        refundStatus: "owed", refundAmount: String(r2(owedSoFar + amountPaid)), updatedAt: new Date(), ...extra,
      }).where(eq(tenantShortBookings.id, bookingId)).returning();
      return { outcome, booking: u };
    };
    if (b.paymentStatus === "paid" && b.bookingStatus !== "cancelled" && b.bookingStatus !== "expired") return owe("duplicate");
    if (b.bookingStatus === "cancelled" || b.bookingStatus === "expired") return owe("late", { paymentStatus: "paid" });
    if (amountPaid + 0.005 < Number(b.totalAmount)) return owe("short", { paymentStatus: "failed" });
    const [u] = await tx.update(tenantShortBookings).set({
      bookingStatus: b.bookingStatus === "pending" ? "confirmed" : b.bookingStatus, paymentStatus: "paid", updatedAt: new Date(),
    }).where(eq(tenantShortBookings.id, bookingId)).returning();
    return { outcome: "confirmed" as const, booking: u };
  });
}

// ── calendar-feed URLs ────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * A calendar feed is fetched by this server, so it must be a normal public https address. Anything that points at the
 * server itself, a private network or a cloud metadata address would let a tenant read internal services.
 */
export async function assertPublicFeedUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { return stayFail(400, "That isn't a valid calendar link."); }
  if (u.protocol !== "https:") return stayFail(400, "The calendar link must start with https://");
  if (u.username || u.password) return stayFail(400, "The calendar link can't contain a username or password.");
  if (u.port && u.port !== "443") return stayFail(400, "The calendar link must use the standard https port.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return stayFail(400, "That calendar address isn't allowed.");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return stayFail(400, "That calendar address isn't allowed.");
    return u;
  }
  let addrs: { address: string }[] = [];
  try { addrs = await dns.lookup(host, { all: true }); } catch { return stayFail(400, "We couldn't find that calendar address. Check the link."); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return stayFail(400, "That calendar address isn't allowed.");
  return u;
}
