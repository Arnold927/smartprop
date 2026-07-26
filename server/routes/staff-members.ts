/**
 * Staff members router — mounted at /api/staff-members
 *
 * Routes:
 *   GET  /              → list all staff for the caller's org
 *   POST /              → create a new staff member  (admin/manager only)
 *   GET  /:id           → get a single staff member
 *   PATCH /:id          → full update (admin/manager only)
 *   PATCH /:id/me       → self-update — only phone, address, emergency contact
 */
import { Router } from "express";
import { db, pool } from "../db";
import { staffMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { requireOrg } from "../middleware/requireOrg";
import { z } from "zod";
import { inviteStaffUser } from "../utils/inviteStaffUser";

const router = Router();

router.use(authenticateJWT as any);
router.use(requireOrg as any);

const staffSchema = z.object({
  employee_id:              z.string().min(1),
  first_name:               z.string().min(1),
  last_name:                z.string().min(1),
  email:                    z.string().email().optional().or(z.literal("")),
  phone:                    z.string().optional(),
  position:                 z.string().min(1),
  department:               z.string().min(1),
  employment_type:          z.string().min(1),
  hire_date:                z.string().min(1),
  salary:                   z.coerce.number().optional(),
  hourly_rate:              z.coerce.number().optional(),
  currency:                 z.string().default("KES"),
  status:                   z.string().default("active"),
  address:                  z.string().optional(),
  emergency_contact_name:   z.string().optional(),
  emergency_contact_phone:  z.string().optional(),
});

// Fields a staff member is allowed to update on their OWN record.
// All other fields (position, salary, status, hire_date, etc.) require admin/manager.
const selfEditSchema = z.object({
  phone:                   z.string().optional(),
  address:                 z.string().optional(),
  emergency_contact_name:  z.string().optional(),
  emergency_contact_phone: z.string().optional(),
});

// ── GET /api/staff-members ─────────────────────────────────────────────────
router.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const rows = await db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.organization_id, orgId))
      .orderBy(staffMembers.last_name, staffMembers.first_name);
    res.json(rows);
  } catch (err: any) {
    console.error("GET /api/staff-members error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch staff members" });
  }
});

// ── GET /api/staff-members/me ──────────────────────────────────────────────
// Returns the staffMembers row for the currently logged-in user.
// Match priority:
//   1. user_id column (if populated — requires ALTER TABLE migration)
//   2. email match (case-insensitive)
//   3. first_name + last_name match (fallback for records created without email)
// Returns 404 with a structured body if no match — never crashes.
router.get("/me", async (req: any, res) => {
  try {
    const orgId:  number = req.user.organizationId;
    const userId: string = String(req.user.userId || req.user.id);
    const email:  string = (req.user.email ?? "").toLowerCase();
    const firstName = (req.user.firstName ?? "").toLowerCase();
    const lastName  = (req.user.lastName  ?? "").toLowerCase();

    const all = await db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.organization_id, orgId));

    // 1. Exact user_id match (reliable once migration is run)
    let profile = all.find((s: any) => s.user_id === userId);

    // 2. Email match (case-insensitive)
    if (!profile && email) {
      profile = all.find((s: any) => (s.email ?? "").toLowerCase() === email);
    }

    // 3. Name match — last resort for records created before email was captured
    if (!profile && firstName && lastName) {
      profile = all.find(
        (s: any) =>
          (s.first_name ?? "").toLowerCase() === firstName &&
          (s.last_name  ?? "").toLowerCase() === lastName
      );
    }

    if (!profile) {
      return res.status(404).json({
        message: "No staff profile linked to your account.",
        hint: "Ask your property manager to create or link your staff profile. Make sure the email on your staff record matches your login email.",
        debug: { userId, email, firstName, lastName, totalStaff: all.length },
      });
    }

    // If found via name/email but user_id not set, opportunistically write it back
    // so future lookups are instant (best-effort, non-blocking).
    // Uses pool.query (raw SQL) because user_id was added via ALTER TABLE
    // and is not yet in the Drizzle schema definition.
    if (!(profile as any).user_id && userId) {
      pool.query(
        "UPDATE staff_members SET user_id = $1 WHERE id = $2",
        [userId, profile.id]
      ).catch(() => {/* non-blocking — ignore if column doesn't exist yet */});
    }

    res.json(profile);
  } catch (err: any) {
    console.error("GET /api/staff-members/me error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch staff profile" });
  }
});

// ── GET /api/staff-members/:id ─────────────────────────────────────────────
router.get("/:id", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid staff id" });

    const [row] = await db
      .select()
      .from(staffMembers)
      .where(and(eq(staffMembers.id, id), eq(staffMembers.organization_id, orgId)))
      .limit(1);

    if (!row) return res.status(404).json({ message: "Staff member not found" });
    res.json(row);
  } catch (err: any) {
    console.error("GET /api/staff-members/:id error:", err);
    res.status(500).json({ message: err.message || "Failed to fetch staff member" });
  }
});

// ── POST /api/staff-members ────────────────────────────────────────────────
router.post(
  "/",
  auditLog("staff_member", "CREATE") as any,
  async (req: any, res) => {
    try {
      const orgId: number = req.user.organizationId;
      const data = staffSchema.parse(req.body);

      const [created] = await db
        .insert(staffMembers)
        .values({
          ...data,
          organization_id: orgId,
          email:           data.email || null,
          hire_date:       new Date(data.hire_date),
        } as any)
        .returning();

      // Invite the new staff member to the portal — same gap already fixed
      // for tenants: previously this endpoint created only the HR record,
      // with no way for that person to ever log in unless someone
      // separately used the unrelated admin "invite a user" flow and
      // happened to match the email manually.
      inviteStaffUser({
        organizationId: orgId,
        invitedByUserId: req.user.id,
        email: created.email,
        firstName: created.first_name,
        lastName: created.last_name,
        position: created.position ?? undefined,
      });

      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: err.errors });
      }
      console.error("POST /api/staff-members error:", err);
      res.status(500).json({ message: err.message || "Failed to create staff member" });
    }
  }
);

// ── PATCH /api/staff-members/:id ──────────────────────────────────────────
router.patch(
  "/:id",
  auditLog("staff_member", "UPDATE") as any,
  async (req: any, res) => {
    try {
      const orgId: number = req.user.organizationId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid staff id" });

      const data = staffSchema.partial().parse(req.body);

      const [updated] = await db
        .update(staffMembers)
        .set({
          ...data,
          ...(data.hire_date ? { hire_date: new Date(data.hire_date) } : {}),
          updated_at: new Date(),
        } as any)
        .where(and(eq(staffMembers.id, id), eq(staffMembers.organization_id, orgId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Staff member not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: err.errors });
      }
      console.error("PATCH /api/staff-members/:id error:", err);
      res.status(500).json({ message: err.message || "Failed to update staff member" });
    }
  }
);

// ── PATCH /api/staff-members/:id/me  (self-edit — restricted fields only) ──
// The staff member must own this record (matched by email) to use this route.
// Only the four personal fields are accepted; everything else is stripped.
router.patch(
  "/:id/me",
  auditLog("staff_member", "UPDATE") as any,
  async (req: any, res) => {
    try {
      const orgId: number = req.user.organizationId;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid staff id" });

      // Verify this record belongs to the calling user (match by email)
      const [existing] = await db
        .select()
        .from(staffMembers)
        .where(and(eq(staffMembers.id, id), eq(staffMembers.organization_id, orgId)))
        .limit(1);

      if (!existing) return res.status(404).json({ message: "Staff member not found" });

      const callerEmail = (req.user.email ?? "").toLowerCase();
      const recordEmail = (existing.email ?? "").toLowerCase();
      if (!callerEmail || callerEmail !== recordEmail) {
        return res.status(403).json({ message: "You can only update your own profile." });
      }

      // Parse and strip to allowed fields only — position/salary/etc. cannot sneak through
      const data = selfEditSchema.parse(req.body);

      const [updated] = await db
        .update(staffMembers)
        .set({ ...data, updated_at: new Date() } as any)
        .where(and(eq(staffMembers.id, id), eq(staffMembers.organization_id, orgId)))
        .returning();

      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: err.errors });
      }
      console.error("PATCH /api/staff-members/:id/me error:", err);
      res.status(500).json({ message: err.message || "Failed to update profile" });
    }
  }
);

export default router;