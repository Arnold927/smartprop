/**
 * gate-access.ts — the one place that decides how a visitor is checked in and out and how parking follows them.
 *
 * Before this file the guard portal (/api/guest-checkin) and the manager screen (/api/visitor-access-management)
 * each had their own copy of check-in/check-out, and they disagreed:
 *   - the manager check-out ended the parking assignment of the vehicle whose *id* equalled the visitor's id
 *     (a different record entirely, often a resident's);
 *   - the manager check-in accepted a denied/revoked visitor and never gave them parking;
 *   - the guard check-in turned a blacklisted vehicle back to "active";
 *   - a space could be handed to two cars at once (check-then-write with no lock).
 *
 * Rules kept here:
 *   - a plate is compared without spaces/dashes and upper-case, per property (a car can visit two properties);
 *   - a space is occupied exactly when it has an active parking assignment — `is_available` is only a mirror of that,
 *     rewritten by syncSpaceFlag() whenever an assignment changes;
 *   - status changes are single UPDATE … WHERE status IN (…) statements so two guards scanning the same code at the same
 *     moment cannot both succeed;
 *   - releasing parking only touches *visitor* assignments of that property.
 */
import { sql, eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { visitors, visitorLog, parkingSpaces, parkingAssignments, registeredVehicles } from "@shared/schema";

export type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

// ── plates ───────────────────────────────────────────────────────────────────

/** KCA 123A, kca-123a and KCA123A are the same car. */
export function normalizePlate(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[\s-]+/g, "");
}
export const isValidPlate = (p: string) => /^[A-Z0-9]{2,15}$/.test(p);
/** SQL for the same normalisation, so older rows saved with spaces still match. */
export const plateKey = (col: any) => sql`REPLACE(REPLACE(UPPER(${col}), ' ', ''), '-', '')`;

export async function findVehicle(propertyId: number, plate: string, ex: Executor = db) {
  const p = normalizePlate(plate);
  if (!p) return null;
  const [v] = await ex.select().from(registeredVehicles)
    .where(and(eq(registeredVehicles.propertyId, propertyId), sql`${plateKey(registeredVehicles.plateNumber)} = ${p}`))
    .limit(1);
  return v ?? null;
}

export async function isBlacklisted(propertyId: number, plate: string | null | undefined): Promise<boolean> {
  if (!plate) return false;
  const v = await findVehicle(propertyId, plate);
  return v?.status === "blacklisted";
}

// ── parking ──────────────────────────────────────────────────────────────────

/** Make parking_spaces.is_available agree with the assignments. */
export async function syncSpaceFlag(ex: Executor, spaceId: number) {
  await ex.execute(sql`
    UPDATE parking_spaces ps
       SET is_available = NOT EXISTS (SELECT 1 FROM parking_assignments pa WHERE pa.parking_space_id = ps.id AND pa.status = 'active'),
           updated_at = NOW()
     WHERE ps.id = ${spaceId}`);
}

export async function spaceHasActiveAssignment(ex: Executor, spaceId: number): Promise<boolean> {
  const [a] = await ex.select({ id: parkingAssignments.id }).from(parkingAssignments)
    .where(and(eq(parkingAssignments.parkingSpaceId, spaceId), eq(parkingAssignments.status, "active" as any))).limit(1);
  return !!a;
}

export type ParkingResult = {
  allocated: boolean; requiresManual: boolean; blocked?: boolean;
  spaceNumber?: string; floor?: string | null; section?: string | null; spaceId?: number; assignmentId?: number;
};

/**
 * Give an arriving visitor with a car a space. Picks a visitor bay first, then standard, then compact; never a disabled
 * or reserved bay. Rows are taken with FOR UPDATE SKIP LOCKED so two simultaneous arrivals get two different spaces.
 */
export async function allocateVisitorParking(
  v: { propertyId: number; vehiclePlate: string | null; tenantId: number | null; expectedDeparture: Date | null; id: number },
  actorId: string | null, note: string,
): Promise<ParkingResult> {
  const plate = normalizePlate(v.vehiclePlate);
  if (!plate) return { allocated: false, requiresManual: false };

  return db.transaction(async (tx) => {
    // the vehicle
    let vehicle = await findVehicle(v.propertyId, plate, tx);
    if (vehicle?.status === "blacklisted") return { allocated: false, requiresManual: false, blocked: true };
    if (!vehicle) {
      await tx.insert(registeredVehicles).values({
        propertyId: v.propertyId, ownerType: "visitor" as any, plateNumber: plate, vehicleType: "car",
        make: "Unknown", model: "Unknown", color: "Unknown", isResident: false, status: "active" as any,
        notes: `Auto-created at visitor check-in. ${note}`,
      } as any).onConflictDoNothing();
      vehicle = await findVehicle(v.propertyId, plate, tx);
    } else if (vehicle.status !== "active") {
      await tx.update(registeredVehicles).set({ status: "active" as any, updatedAt: new Date() as any }).where(eq(registeredVehicles.id, vehicle.id));
    }
    if (!vehicle) return { allocated: false, requiresManual: true };

    // already parked? (a second scan, or the guard assigned a bay first) — don't hand out another
    const [existing] = await tx.select({ id: parkingAssignments.id, spaceId: parkingAssignments.parkingSpaceId })
      .from(parkingAssignments)
      .where(and(eq(parkingAssignments.vehicleId, vehicle.id), eq(parkingAssignments.status, "active" as any))).limit(1);
    if (existing) {
      const [sp] = await tx.select().from(parkingSpaces).where(eq(parkingSpaces.id, existing.spaceId)).limit(1);
      return { allocated: true, requiresManual: false, spaceNumber: sp?.spaceNumber, floor: sp?.floor, section: sp?.section, spaceId: sp?.id, assignmentId: existing.id };
    }

    const rows: any = await tx.execute(sql`
      SELECT ps.id, ps.space_number, ps.floor, ps.section
        FROM parking_spaces ps
       WHERE ps.property_id = ${v.propertyId}
         AND ps.is_reserved = false
         AND ps.space_type NOT IN ('disabled', 'reserved')
         AND NOT EXISTS (SELECT 1 FROM parking_assignments pa WHERE pa.parking_space_id = ps.id AND pa.status = 'active')
       ORDER BY CASE ps.space_type WHEN 'visitor' THEN 0 WHEN 'standard' THEN 1 WHEN 'compact' THEN 2 ELSE 3 END, ps.space_number
       LIMIT 1
         FOR UPDATE OF ps SKIP LOCKED`);
    const space = (rows.rows ?? rows)[0];
    if (!space) return { allocated: false, requiresManual: true };

    const [a] = await tx.insert(parkingAssignments).values({
      parkingSpaceId: space.id, vehicleId: vehicle.id, tenantId: v.tenantId ?? null, assignmentType: "visitor" as any,
      startDate: new Date(), endDate: v.expectedDeparture ?? null, status: "active" as any,
      assignedBy: actorId ?? "00000000-0000-0000-0000-000000000000", notes: note,
    } as any).returning({ id: parkingAssignments.id });
    await syncSpaceFlag(tx, space.id);
    await tx.update(visitors).set({ parkingSpot: space.space_number, updatedAt: new Date() as any }).where(eq(visitors.id, v.id));
    return { allocated: true, requiresManual: false, spaceNumber: space.space_number, floor: space.floor, section: space.section, spaceId: space.id, assignmentId: a?.id };
  });
}

/** End the visitor's own parking at this property. Resident and permanent assignments are never touched. */
export async function releaseVisitorParking(v: { propertyId: number; vehiclePlate: string | null }): Promise<number> {
  const plate = normalizePlate(v.vehiclePlate);
  if (!plate) return 0;
  return db.transaction(async (tx) => {
    const vehicle = await findVehicle(v.propertyId, plate, tx);
    if (!vehicle) return 0;
    const active = await tx.select({ id: parkingAssignments.id, spaceId: parkingAssignments.parkingSpaceId })
      .from(parkingAssignments)
      .where(and(eq(parkingAssignments.vehicleId, vehicle.id), eq(parkingAssignments.status, "active" as any), eq(parkingAssignments.assignmentType, "visitor" as any)));
    for (const a of active) {
      await tx.update(parkingAssignments).set({ status: "terminated" as any, endDate: new Date() as any, updatedAt: new Date() as any }).where(eq(parkingAssignments.id, a.id));
      await syncSpaceFlag(tx, a.spaceId);
    }
    return active.length;
  });
}

// ── check-in / check-out ─────────────────────────────────────────────────────

type VisitorRow = typeof visitors.$inferSelect;
export type FlowResult =
  | { ok: true; visitor: VisitorRow; parking: ParkingResult }
  | { ok: false; httpStatus: number; message: string; visitor?: any };

const HOUR = 3600_000;

/** Shared by the guard scan and the manager "check in" button. `visitor` must already be scoped to the caller. */
export async function checkInVisitor(visitor: VisitorRow, actorId: string | null, location: string, via: string): Promise<FlowResult> {
  if (visitor.status === "checked_in") return { ok: false, httpStatus: 409, message: "This visitor is already checked in.", visitor };
  if (visitor.status === "checked_out") return { ok: false, httpStatus: 409, message: "This visitor has already checked out.", visitor };
  if (visitor.status === "denied") return { ok: false, httpStatus: 403, message: "Access denied — this visit was cancelled or access was revoked.", visitor };
  if (visitor.status === "expired") return { ok: false, httpStatus: 403, message: "This access code has expired. Ask the host to send a new invitation.", visitor };

  const now = Date.now();
  const expire = async (message: string) => {
    await db.update(visitors).set({ status: "expired" as any, updatedAt: new Date() as any }).where(eq(visitors.id, visitor.id));
    return { ok: false as const, httpStatus: 403, message, visitor: { ...visitor, status: "expired" } };
  };
  if (visitor.expectedDeparture && new Date(visitor.expectedDeparture).getTime() < now) {
    return expire(`This access code expired on ${new Date(visitor.expectedDeparture).toLocaleString("en-KE")}. Ask the host to send a new invitation.`);
  }
  if (visitor.expectedArrival) {
    const arrival = new Date(visitor.expectedArrival).getTime();
    if (arrival + 24 * HOUR < now) return expire("This access code has expired (the visit window passed). Ask the host to send a new invitation.");
    if (arrival - 24 * HOUR > now) {
      return { ok: false, httpStatus: 409, message: `Too early — this visit is expected on ${new Date(visitor.expectedArrival).toLocaleString("en-KE")}.`, visitor };
    }
  }

  if (visitor.vehiclePlate && await isBlacklisted(visitor.propertyId, visitor.vehiclePlate)) {
    await db.insert(visitorLog).values({ visitorId: visitor.id, logType: "status_change", location, notes: `Entry refused — vehicle ${normalizePlate(visitor.vehiclePlate)} is blacklisted` } as any);
    return { ok: false, httpStatus: 403, message: `Entry refused — vehicle ${normalizePlate(visitor.vehiclePlate)} is blacklisted at this property.`, visitor };
  }

  // Only one caller can win this.
  const [updated] = await db.update(visitors)
    .set({ status: "checked_in" as any, actualArrival: new Date() as any, checkedInBy: actorId, updatedAt: new Date() as any })
    .where(and(eq(visitors.id, visitor.id), inArray(visitors.status, ["pending", "approved"] as any)))
    .returning();
  if (!updated) return { ok: false, httpStatus: 409, message: "This visitor was just processed by someone else — refresh and check again.", visitor };

  await db.insert(visitorLog).values({ visitorId: visitor.id, logType: "check_in", location, notes: `Checked in via ${via} at ${location}` } as any);

  let parking: ParkingResult = { allocated: false, requiresManual: false };
  if (updated.vehiclePlate) {
    try {
      parking = await allocateVisitorParking(updated, actorId, `Auto-allocated at visitor check-in. Code: ${updated.accessCode}`);
    } catch (e) {
      // The visitor IS inside; a parking hiccup must not turn into "check-in failed" (and a second scan).
      console.warn("[gate-access] parking allocation failed:", e);
      parking = { allocated: false, requiresManual: true };
    }
  }
  const [fresh] = await db.select().from(visitors).where(eq(visitors.id, visitor.id)).limit(1);
  return { ok: true, visitor: fresh ?? updated, parking };
}

export async function checkOutVisitor(visitor: VisitorRow, actorId: string | null, location: string): Promise<FlowResult> {
  const [updated] = await db.update(visitors)
    .set({ status: "checked_out" as any, actualDeparture: new Date() as any, checkedOutBy: actorId, updatedAt: new Date() as any })
    .where(and(eq(visitors.id, visitor.id), eq(visitors.status, "checked_in" as any)))
    .returning();
  if (!updated) return { ok: false, httpStatus: 409, message: `Visitor status is "${visitor.status}", not checked in.`, visitor };
  await db.insert(visitorLog).values({ visitorId: visitor.id, logType: "check_out", location, notes: `Checked out at ${location}` } as any);
  await releaseVisitorParking(updated).catch((e) => console.warn("[gate-access] parking release failed:", e));
  return { ok: true, visitor: updated, parking: { allocated: false, requiresManual: false } };
}

/** What a gate pass is shown as: "revoked" for a denied one, and "expired" once its end time has gone (nothing flips the stored status). */
export function displayPassStatus(status: string | null | undefined, validTo: Date | string | null | undefined): string {
  const st = status ?? "pending";
  if (st === "denied") return "revoked";
  if ((st === "pending" || st === "approved") && validTo && new Date(validTo).getTime() < Date.now()) return "expired";
  return st;
}
