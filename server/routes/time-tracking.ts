/**
 * Time-tracking router — mounted at /api/time-tracking
 *
 * Changes vs. original:
 *  1. requireOrg guard on every route.
 *  2. GET /active-session scoped to org's staff only.
 *  3. GET /staff/:staffId verifies staff member belongs to caller's org,
 *     and supports server-side pagination (?page=&limit=).
 *  4. POST /clock-out verifies the session belongs to caller's org.
 */
import { Router } from "express";
import { db } from "../db";
import { timeTracking, staffMembers } from "@shared/schema";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { z } from "zod";

const router = Router();

// ── GET /api/time-tracking — list all records for the org ────────────────────
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select({
        id:               timeTracking.id,
        staff_id:         timeTracking.staff_id,
        property_id:      timeTracking.property_id,
        clock_in_time:    timeTracking.clock_in_time,
        clock_out_time:   timeTracking.clock_out_time,
        location_lat:     timeTracking.location_lat,
        location_lng:     timeTracking.location_lng,
        clock_in_method:  timeTracking.clock_in_method,
        clock_out_method: timeTracking.clock_out_method,
        total_hours:      timeTracking.total_hours,
        overtime_hours:   timeTracking.overtime_hours,
        break_time:       timeTracking.break_time,
        notes:            timeTracking.notes,
        status:           timeTracking.status,
        created_at:       timeTracking.created_at,
        staff_name:       staffMembers.first_name,
      })
      .from(timeTracking)
      .leftJoin(staffMembers, eq(timeTracking.staff_id, staffMembers.id))
      .where(eq(timeTracking.organization_id, orgId))
      .orderBy(desc(timeTracking.clock_in_time))
      .limit(200);

    // Combine first + last name for staff_name
    const result = rows.map((r: any) => ({
      ...r,
      staff_name: r.staff_name
        ? `${r.staff_name}`
        : `Staff ${r.staff_id}`,
    }));

    res.json(result);
  } catch (err) {
    console.error("GET /api/time-tracking error:", err);
    res.status(500).json({ message: "Failed to fetch time records" });
  }
});

const clockInSchema = z.object({
  staff_id:        z.number().int().positive(),
  property_id:     z.number().int().optional(),
  location_lat:    z.number().optional(),
  location_lng:    z.number().optional(),
  clock_in_method: z.enum(["mobile", "web", "biometric", "manual", "api"]).default("web"),
  notes:           z.string().optional(),
});

const clockOutSchema = z.object({
  time_tracking_id: z.number().int().positive(),
  location_lat:     z.number().optional(),
  location_lng:     z.number().optional(),
  clock_out_method: z.enum(["mobile", "web", "biometric", "manual", "api"]).default("web"),
  notes:            z.string().optional(),
  break_time:       z.number().min(0).default(0),
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function staffBelongsToOrg(staffId: number, orgId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(eq(staffMembers.id, staffId), eq(staffMembers.organization_id, orgId)))
    .limit(1);
  return !!row;
}

// ── GET /api/time-tracking/active-session?staff_id=N ─────────────────────────
router.get("/active-session", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const staffId = req.query.staff_id ? parseInt(req.query.staff_id as string) : undefined;
    if (!staffId) return res.status(400).json({ message: "staff_id is required" });

    if (!(await staffBelongsToOrg(staffId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [session] = await db
      .select()
      .from(timeTracking)
      .where(and(eq(timeTracking.staff_id, staffId), isNull(timeTracking.clock_out_time)))
      .orderBy(desc(timeTracking.clock_in_time))
      .limit(1);

    res.json({ activeSession: session ?? null });
  } catch (err) {
    console.error("Active session error:", err);
    res.status(500).json({ message: "Failed to fetch active session" });
  }
});

// ── GET /api/time-tracking/staff/:staffId ─────────────────────────────────────
// ?page=1  &limit=20
router.get("/staff/:staffId", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const staffId = parseInt(req.params.staffId);

    if (!(await staffBelongsToOrg(staffId, orgId))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const page   = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(timeTracking)
        .where(eq(timeTracking.staff_id, staffId))
        .orderBy(desc(timeTracking.clock_in_time))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(timeTracking)
        .where(eq(timeTracking.staff_id, staffId)),
    ]);

    res.json({
      count:    total,
      page,
      limit,
      next:     page * limit < total ? `?page=${page + 1}&limit=${limit}` : null,
      previous: page > 1             ? `?page=${page - 1}&limit=${limit}` : null,
      results:  rows,
    });
  } catch (err) {
    console.error("Staff time records error:", err);
    res.status(500).json({ message: "Failed to fetch time records" });
  }
});

// ── POST /api/time-tracking/clock-in ─────────────────────────────────────────
router.post("/clock-in", authenticateJWT, requireOrg, auditLog("time_tracking", "ACTION"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const data = clockInSchema.parse(req.body);

    if (!(await staffBelongsToOrg(data.staff_id, orgId))) {
      return res.status(403).json({ message: "Access denied: staff member not in your organization" });
    }

    // Prevent double clock-in
    const [existing] = await db
      .select({ id: timeTracking.id })
      .from(timeTracking)
      .where(and(eq(timeTracking.staff_id, data.staff_id), isNull(timeTracking.clock_out_time)))
      .limit(1);

    if (existing) {
      return res.status(409).json({ message: "Staff member already has an active clock-in session" });
    }

    const [record] = await db
      .insert(timeTracking)
      .values({
        organization_id:  orgId,
        staff_id:         data.staff_id,
        property_id:      data.property_id ?? null,
        clock_in_time:    new Date(),
        location_lat:     data.location_lat ?? null,
        location_lng:     data.location_lng ?? null,
        clock_in_method:  data.clock_in_method as any,
        notes:            data.notes ?? null,
        created_by:       (() => { const n = Number(req.user.userId ?? req.user.id); return Number.isFinite(n) ? n : null; })(),
      })
      .returning();

    res.status(201).json(record);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Clock-in error:", err);
    res.status(500).json({ message: "Failed to clock in" });
  }
});

// ── POST /api/time-tracking/clock-out ────────────────────────────────────────
router.post("/clock-out", authenticateJWT, requireOrg, auditLog("time_tracking", "ACTION"), async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const data = clockOutSchema.parse(req.body);

    const [session] = await db
      .select()
      .from(timeTracking)
      .where(eq(timeTracking.id, data.time_tracking_id))
      .limit(1);

    if (!session) return res.status(404).json({ message: "Time tracking session not found" });

    // Verify org ownership
    if (session.organization_id !== orgId) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (session.clock_out_time) return res.status(409).json({ message: "Session already clocked out" });

    const clockOutTime  = new Date();
    const clockInTime   = new Date(session.clock_in_time);
    const totalMinutes  = (clockOutTime.getTime() - clockInTime.getTime()) / 60000;
    const breakMinutes  = Math.min(data.break_time ?? 0, totalMinutes); // break can't exceed session length

    // The DB column is numeric(5,2) — max storable value is 999.99.
    // A session open for >999 hours (41+ days) would overflow.
    // Guard: reject impossibly long sessions with a clear error.
    const rawWorkedMinutes = Math.max(0, totalMinutes - breakMinutes);
    const rawTotalHours    = rawWorkedMinutes / 60;

    if (rawTotalHours > 999.99) {
      return res.status(422).json({
        message:
          `This session has been open for ${rawTotalHours.toFixed(0)} hours, which exceeds the maximum storable value. ` +
          `Please contact an admin to void this record and create a corrected one.`,
      });
    }

    // Clamp to numeric(5,2) bounds as a final safety net
    const NUMERIC_5_2_MAX = 999.99;
    const clamp = (n: number) =>
      parseFloat(Math.min(NUMERIC_5_2_MAX, Math.max(0, n)).toFixed(2));

    const totalHours    = clamp(rawTotalHours).toFixed(2);
    const overtimeHours = clamp(Math.max(0, rawTotalHours - 8)).toFixed(2);

    const [updated] = await db
      .update(timeTracking)
      .set({
        clock_out_time:   clockOutTime,
        clock_out_method: data.clock_out_method as any,
        location_lat:     data.location_lat ?? session.location_lat,
        location_lng:     data.location_lng ?? session.location_lng,
        break_time:       clamp(breakMinutes).toFixed(2),
        total_hours:      totalHours,
        overtime_hours:   overtimeHours,
        notes:            data.notes ?? session.notes,
        updated_at:       new Date(),
      })
      .where(eq(timeTracking.id, data.time_tracking_id))
      .returning();

    res.json({ timeRecord: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Clock-out error:", err);
    res.status(500).json({ message: "Failed to clock out" });
  }
});

export default router;