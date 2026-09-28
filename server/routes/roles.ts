import { Router } from "express";
import { db } from "../db";
import { userRoles } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireAdmin } from "../middleware/authorization";
import { auditLog } from "../middleware/auditLog";
import { z } from "zod";

const router = Router();

// ── Validation ────────────────────────────────────────────────────────────────

// Must match the values stored in users.role (varchar) —
// see migrations/add_caretaker_role.sql for the CHECK constraint.
const VALID_ROLE_NAMES = [
  "admin",
  "manager",
  "landlord",
  "staff",
  "caretaker",
  "tenant",
  "guard",
  "contractor",
] as const;

const VALID_PERMISSION_KEYS = [
  // System
  "full_access",
  // Users & Roles
  "can_manage_users",
  "can_view_users",
  // Properties & Leases
  "can_manage_properties",
  "can_manage_tenants",
  "can_manage_leases",
  "can_view_documents",
  "can_upload_documents",
  // Finance
  "can_view_financials",
  "can_collect_rent",
  "can_make_payments",
  "can_view_payment_history",
  "can_submit_invoices",
  "can_generate_reports",
  // Maintenance
  "can_manage_maintenance",
  "can_submit_maintenance",
  "can_view_maintenance",
  // Projects & Tasks
  "can_manage_construction",
  "can_assign_tasks",
  "can_view_assigned_jobs",
  "can_view_project_progress",
  // Communication
  "can_message",
  "can_view_announcements",
  // Field & Labour
  "can_clock_in_out",
  "can_submit_timesheets",
] as const;

type PermissionKey = (typeof VALID_PERMISSION_KEYS)[number];

const permissionsSchema = z
  .record(z.string(), z.boolean())
  .refine(
    (perms) =>
      Object.keys(perms).every((k) =>
        (VALID_PERMISSION_KEYS as readonly string[]).includes(k)
      ),
    { message: "One or more permission keys are not recognised" }
  );

// ── GET /api/roles ─────────────────────────────────────────────────────────────
// Returns all role rows, including their current permissions jsonb.
// Admin and manager can read — managers need this to display the permissions
// matrix in User Management. Only admins can write (PUT endpoint stays admin-only).

router.get(
  "/",
  authenticateJWT,
  async (req: any, res) => {
    try {
      const role: string = req.user?.role ?? "";
      if (!["admin", "manager", "platform_admin"].includes(role)) {
        return res.status(403).json({ message: "Admin or manager privileges required" });
      }

      const roles = await db
        .select({
          id: userRoles.id,
          roleName: userRoles.roleName,
          roleDescription: userRoles.roleDescription,
          permissions: userRoles.permissions,
          isActive: userRoles.isActive,
          updatedAt: userRoles.updatedAt,
        })
        .from(userRoles)
        .orderBy(userRoles.id);

      res.json(roles);
    } catch (err) {
      console.error("GET /api/roles error:", err);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  }
);

// ── GET /api/roles/:roleName ───────────────────────────────────────────────────
// Returns a single role by its name string (e.g. "manager").

router.get(
  "/:roleName",
  authenticateJWT,
  requireAdmin,
  async (req, res) => {
    try {
      const { roleName } = req.params;

      if (!(VALID_ROLE_NAMES as readonly string[]).includes(roleName)) {
        return res.status(400).json({ message: "Invalid role name" });
      }

      const [role] = await db
        .select()
        .from(userRoles)
        .where(eq(userRoles.roleName, roleName))
        .limit(1);

      if (!role) {
        return res.status(404).json({ message: "Role not found. Run the seed." });
      }

      res.json(role);
    } catch (err) {
      console.error("GET /api/roles/:roleName error:", err);
      res.status(500).json({ message: "Failed to fetch role" });
    }
  }
);

// ── PUT /api/roles/:roleName/permissions ──────────────────────────────────────
// Replaces the permissions object for a role.
//
// Platform-administrator only. user_roles is ONE table for the whole platform (role_name is unique,
// there is no organisation column), so a change here would apply to every organisation at once —
// it cannot be something a single organisation's admin is allowed to do.
//
// NOTE: these flags are stored but not yet enforced anywhere. Real access is decided by ROUTE_POLICY
// in middleware/requireRole.ts (server) and roleNav.ts (client). The User Management page therefore
// shows this matrix as a read-only guide until enforcement exists.
//
// The "admin" role's full_access key is always forced to true so it can never be stripped.
//
// Body: { permissions: Record<PermissionKey, boolean> }

const requirePlatformAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== "platform_admin") {
    return res.status(403).json({
      message: "Role permissions apply to every organisation on the platform, so only a platform administrator can change them.",
    });
  }
  next();
};

router.put(
  "/:roleName/permissions",
  authenticateJWT,
  requirePlatformAdmin,
  auditLog("role_permissions", "UPDATE"),
  async (req: any, res) => {
    try {
      const { roleName } = req.params;

      if (!(VALID_ROLE_NAMES as readonly string[]).includes(roleName)) {
        return res.status(400).json({ message: "Invalid role name" });
      }

      // Validate body
      const parsed = permissionsSchema.safeParse(req.body.permissions);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid permissions payload",
          errors: parsed.error.errors,
        });
      }

      let permissions = parsed.data as Record<PermissionKey, boolean>;

      // Hard enforce: admin always has full_access
      if (roleName === "admin") {
        permissions = { ...permissions, full_access: true };
      }

      // Ensure all known keys are present (fill missing ones as false)
      const normalised: Record<string, boolean> = {};
      for (const key of VALID_PERMISSION_KEYS) {
        normalised[key] = permissions[key] ?? false;
      }
      // Enforce admin lock again after normalisation
      if (roleName === "admin") {
        normalised["full_access"] = true;
      }

      // Upsert: the roles seed is not run automatically, so on a fresh database the row may not exist
      // yet. Refusing with "run the seed" made every save fail until someone ran a script by hand.
      const [updated] = await db
        .insert(userRoles)
        .values({ roleName, permissions: normalised } as any)
        .onConflictDoUpdate({
          target: userRoles.roleName,
          set: { permissions: normalised, updatedAt: new Date() },
        })
        .returning();

      res.json({
        success: true,
        role: updated,
      });
    } catch (err) {
      console.error("PUT /api/roles/:roleName/permissions error:", err);
      res.status(500).json({ message: "Failed to update role permissions" });
    }
  }
);

export default router;