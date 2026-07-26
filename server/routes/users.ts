import { Router } from "express";
import { db } from "../db";
import { users, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import { sendInviteEmail } from "../lib/email";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { logger } from "../lib/logger";
import {
  requireActiveSubscription,
  enforceUserLimit,
} from "../middleware/billing.js";

const router = Router();

// GET /api/users — list users in org
// Admins see all users; managers may query ?role=landlord to populate
// owner-picker dropdowns.
router.get("/", authenticateJWT, async (req: any, res) => {
  try {
    const callerRole: string = req.user.role;
    const orgId: number = req.user.organizationId;
    const roleFilter = req.query.role as string | undefined;

    // Non-admins may only request the landlord list (for owner pickers).
    const ALLOWED_NON_ADMIN_ROLES = ["admin", "manager"];
    if (!ALLOWED_NON_ADMIN_ROLES.includes(callerRole)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (callerRole !== "admin" && roleFilter !== "landlord") {
      return res.status(403).json({ message: "Non-admin users may only query role=landlord" });
    }

    const conditions: any[] = [eq(users.organizationId, orgId)];
    if (roleFilter) {
      conditions.push(eq(users.role, roleFilter));
    }

    const orgUsers = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(and(...conditions));

    res.json(orgUsers);
  } catch (err) {
    logger.error("List users error:", err);
    res.status(500).json({ message: "Failed to list users" });
  }
});

// GET /api/users/:id
router.get("/:id", authenticateJWT, async (req: any, res) => {
  try {
    const { id } = req.params;
    const orgId: number = req.user.organizationId;

    const [user] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
        organizationId: users.organizationId,
      })
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, orgId)))
      .limit(1);

    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    logger.error("Get user error:", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// POST /api/users — invite a user (admin or manager)
// Previously admin-only (requireAdmin), but the page that renders this
// (user-management.tsx) already guards for ADMIN_MANAGER — meaning a
// manager could reach the page, fill out the entire invite form, and only
// then get silently rejected by this endpoint. Loosened to match, with a
// manager specifically blocked from granting admin-level access.
router.post("/", authenticateJWT, requireActiveSubscription as any, enforceUserLimit as any, auditLog("user", "CREATE"), async (req: any, res) => {
  try {
    const callerRole: string = req.user.role;
    if (!["admin", "manager"].includes(callerRole)) {
      return res.status(403).json({ message: "Admin or manager privileges required" });
    }

    const schema = z.object({
      email: z.string().email(),
      // Exactly the roles the real RBAC system (AppRole / ROUTE_POLICY)
      // actually enforces, minus tenant, contractor, and caretaker — all
      // three have their own dedicated invite flows elsewhere that
      // correctly link the login to a business record:
      //   tenant:     ComprehensiveTenantModal / POST /api/tenant-onboarding
      //               or POST /api/tenants
      //   contractor: contractors-extended.ts's own auto-invite hook,
      //               triggered when adding a contractor via the
      //               Contractors page
      //   caretaker:  the Caretakers page (POST /api/caretakers), which
      //               creates the login AND the property assignment
      //               together — caretaker was briefly still listed here
      //               even after that page was built, which would have
      //               created a caretaker login with no property
      //               assignment at all (caretakers.userId requires one
      //               to exist, so the record couldn't even be attempted
      //               without going back through the dedicated page anyway)
      // Inviting any of the three through this general flow creates a
      // login account with nothing behind it.
      // platform_admin is deliberately excluded: that tier isn't meant to
      // be self-service-invitable by a regular org admin.
      role: z.enum(["admin", "manager", "staff", "landlord", "guard"]).default("staff"),
    });

    const { email, role } = schema.parse(req.body);

    // A manager may invite anyone except an admin — prevents a manager
    // from granting themselves or anyone else admin-level access.
    if (callerRole === "manager" && role === "admin") {
      return res.status(403).json({ message: "Managers cannot grant admin access. Ask an admin to do this." });
    }

    const orgId: number = req.user.organizationId;

    const inviteToken = randomUUID();
    const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

    await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: email.toLowerCase(),
        role,
        organizationId: orgId,
        invitedAt: new Date(),
        invitedBy: req.user.id,
        emailVerificationToken: inviteToken,
        emailVerificationExpiresAt: inviteExpiresAt,
        passwordHash: "",
        emailVerified: false,
      } as any)
      .onConflictDoUpdate({
        target: [users.organizationId, users.email],
        set: {
          invitedAt: new Date(),
          emailVerificationToken: inviteToken,
          emailVerificationExpiresAt: inviteExpiresAt,
          role,
        },
      });

    const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;

    await sendInviteEmail({ to: email, inviteLink });

    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input", errors: err.errors });
    }
    logger.error("Invite user error:", err);
    res.status(500).json({ message: "Failed to send invite" });
  }
});

// PATCH /api/users/:id — admin or manager can update role, activate, or deactivate
// Rules:
//   - Only admin or manager may call this endpoint
//   - Cannot deactivate yourself
//   - Cannot deactivate or demote another admin (unless you are admin)
//   - Cannot promote someone to admin unless you are admin
router.patch(
  "/:id",
  authenticateJWT,
  auditLog("user", "UPDATE"),
  async (req: any, res) => {
    try {
      const callerRole: string = req.user.role;
      const callerId: string   = req.user.id;
      const orgId: number      = req.user.organizationId;
      const { id }             = req.params;

      // Only admin and manager may manage other users
      if (!["admin", "manager"].includes(callerRole)) {
        return res.status(403).json({ message: "Only admins and managers can manage users." });
      }

      const schema = z.object({
        isActive: z.boolean().optional(),
        role: z.enum([
          "admin", "manager", "landlord", "staff",
          "caretaker", "tenant", "guard",
        ]).optional(),
      }).refine(d => d.isActive !== undefined || d.role !== undefined, {
        message: "Provide at least one of: isActive, role",
      });

      const updates = schema.parse(req.body);

      // Fetch the target user — must belong to same org
      const [target] = await db
        .select({
          id:       users.id,
          role:     users.role,
          isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, id), eq(users.organizationId, orgId)))
        .limit(1);

      if (!target) {
        return res.status(404).json({ message: "User not found." });
      }

      // Cannot act on yourself via this endpoint
      if (target.id === callerId) {
        return res.status(400).json({ message: "You cannot activate, deactivate, or change your own role via this endpoint." });
      }

      // Managers cannot touch admin accounts
      if (callerRole === "manager" && target.role === "admin") {
        return res.status(403).json({ message: "Managers cannot modify admin accounts." });
      }

      // Only admins can promote someone to admin
      if (updates.role === "admin" && callerRole !== "admin") {
        return res.status(403).json({ message: "Only admins can promote users to admin." });
      }

      const patch: Record<string, any> = { updatedAt: new Date() };

      if (updates.isActive !== undefined) {
        patch.isActive = updates.isActive;
        if (!updates.isActive) {
          patch.deactivatedAt = new Date();
          patch.deactivatedBy = callerId;
        } else {
          // Re-activating — clear deactivation metadata
          patch.deactivatedAt = null;
          patch.deactivatedBy = null;
        }
      }

      if (updates.role !== undefined) {
        patch.role = updates.role;
      }

      const [updated] = await db
        .update(users)
        .set(patch)
        .where(and(eq(users.id, id), eq(users.organizationId, orgId)))
        .returning({
          id:          users.id,
          email:       users.email,
          firstName:   users.firstName,
          lastName:    users.lastName,
          role:        users.role,
          isActive:    users.isActive,
          updatedAt:   users.updatedAt,
        });

      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: err.errors });
      }
      logger.error("Update user error:", err);
      res.status(500).json({ message: "Failed to update user" });
    }
  }
);

// Note: /invite/:token and /activate are handled by auth.ts under /api/auth/*
// because the client calls /api/auth/invite/:token and /api/auth/activate

// PATCH /api/users/me — self-service profile update (safe fields only)
router.patch("/me", authenticateJWT, async (req: any, res) => {
  try {
    const schema = z.object({
      firstName:         z.string().min(1).max(100).optional(),
      lastName:          z.string().min(1).max(100).optional(),
      phoneNumber:       z.string().max(30).optional().nullable(),
      preferredCurrency: z.enum(["KES", "USD", "GBP", "EUR", "UGX", "TZS"]).optional(),
    });

    const updates = schema.parse(req.body);

    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, req.user.id))
      .returning({
        id:                users.id,
        firstName:         users.firstName,
        lastName:          users.lastName,
        email:             users.email,
        phoneNumber:       users.phoneNumber,
        preferredCurrency: users.preferredCurrency,
        role:              users.role,
        emailVerified:     users.emailVerified,
        lastLoginAt:       users.lastLoginAt,
        createdAt:         users.createdAt,
      });

    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input", errors: err.errors });
    }
    logger.error("Update profile error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// PATCH /api/users/me/password — change own password
router.patch("/me/password", authenticateJWT, async (req: any, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8, "New password must be at least 8 characters"),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!row) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(currentPassword, row.passwordHash);
    if (!valid) return res.status(400).json({ message: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, req.user.id));

    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message });
    }
    logger.error("Change password error:", err);
    res.status(500).json({ message: "Failed to change password" });
  }
});

export default router;