import { Router } from "express";
import { db } from "../db";
import { users, organizations, auditLogs } from "@shared/schema";
import { eq, ne, and, desc } from "drizzle-orm";
import { authenticateJWT, forgetUserActiveState } from "../middleware/auth";
import { revokeAllUserTokens } from "./auth";
import { requireOrg } from "../middleware/requireOrg";
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

// The caller's OWN account (profile, password, activity), mounted separately at /api/users/me.
// It cannot live on `router` for two reasons that both broke it before:
//   1. /api/users is guarded for admin/manager, so every other role got a 403 trying to change
//      their own password or profile — while every role has a Profile page that does exactly that.
//   2. PATCH /:id was declared first, so PATCH /me was captured by it with id="me".
export const meRouter = Router();

// GET /api/users — list users in org
// Admins and managers see everyone in their organisation: the User Management page is open to
// both, and managers may already invite users and change roles (with the limits below), which
// is not workable if they cannot see who is there. Anyone else is refused.
router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const callerRole: string = req.user.role;
    const orgId: number = req.user.organizationId;
    const roleFilter = req.query.role as string | undefined;

    if (!["admin", "manager", "platform_admin"].includes(callerRole)) {
      return res.status(403).json({ message: "Insufficient permissions" });
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
router.get("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
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
    const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days — what the email itself promises

    // Only a still-pending invite may be re-issued. Before this, inviting an email that already
    // belonged to an ACTIVE user silently overwrote their role and reset their verification token —
    // which let a manager demote an admin (or change anyone's role) just by "inviting" them again,
    // sidestepping the rule that managers cannot modify admin accounts. A manager also may not
    // re-issue a pending invite that was sent for the admin role.
    const reissuable = and(
      eq(users.passwordHash, ""),
      eq(users.emailVerified, false),
      ...(callerRole === "manager" ? [ne(users.role, "admin")] : []),
    );

    const written = await db
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
          invitedBy: req.user.id,
          emailVerificationToken: inviteToken,
          emailVerificationExpiresAt: inviteExpiresAt,
          role,
        },
        setWhere: reissuable,
      })
      .returning({ id: users.id });

    if (written.length === 0) {
      // The email already exists and is not a re-issuable pending invite.
      const [existing] = await db
        .select({ role: users.role, passwordHash: users.passwordHash, emailVerified: users.emailVerified })
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.email, email.toLowerCase())))
        .limit(1);
      const pending = !!existing && existing.passwordHash === "" && !existing.emailVerified;
      if (pending && existing.role === "admin" && callerRole === "manager") {
        return res.status(403).json({ message: "Managers cannot modify admin accounts." });
      }
      return res.status(409).json({ message: "A user with this email already exists in your organisation." });
    }

    const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;

    // The invite row is already saved at this point, so a mail failure is reported as exactly that
    // (rather than a generic error) and sending again will simply re-issue the pending invite.
    try {
      await sendInviteEmail({ to: email, inviteLink });
    } catch (mailErr) {
      logger.error("Invite email failed:", mailErr);
      return res.status(502).json({
        message: "The invite was saved but the email could not be sent. Check the email settings, then send the invite again.",
      });
    }

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
  requireOrg,
  auditLog("user", "UPDATE"),
  async (req: any, res) => {
    try {
      const callerRole: string = req.user.role;
      const callerId: string   = req.user.id;
      const orgId: number      = req.user.organizationId;
      const { id }             = req.params;

      // Only admin, manager, and platform_admin may manage other users
      if (!["admin", "manager", "platform_admin"].includes(callerRole)) {
        return res.status(403).json({ message: "Only admins and managers can manage users." });
      }

      const schema = z.object({
        isActive: z.boolean().optional(),
        // Narrowed to match user-management.tsx's ASSIGNABLE_ROLES exactly.
        // caretaker, tenant, and contractor all removed — each needs a
        // linked business record (a property assignment, a lease, a
        // contractor profile) that this endpoint doesn't create.
        // Reclassifying someone into one of these here would leave them
        // with a role but nothing behind it, landing them on an empty
        // portal. Use the dedicated Caretakers/Tenants/Contractors pages
        // instead, which create the login and the business record together.
        //
        // Also: the frontend previously sent { roleName: ... } instead of
        // { role: ... } — since neither field matched this schema's
        // isActive/role, the refine() below rejected every single role
        // change attempt through this endpoint with "provide at least one
        // of: isActive, role", regardless of which role was picked. Fixed
        // on the frontend to send the correct field name.
        role: z.enum([
          "admin", "manager", "landlord", "staff", "guard",
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

      // Tenant, caretaker and contractor logins are each tied to a business record (a lease, a property
      // assignment, a contractor profile). Re-roling one from here would strand that record behind a
      // login that no longer matches it — the reverse of the case the role list above already excludes.
      const RECORD_BACKED: Record<string, string> = {
        tenant:     "a lease — manage it from the Tenants page",
        caretaker:  "a property assignment — manage it from the Caretakers page",
        contractor: "a contractor profile — manage it from the Contractors page",
      };
      if (updates.role !== undefined && updates.role !== target.role && RECORD_BACKED[target.role]) {
        return res.status(400).json({
          message: `This ${target.role} login is tied to ${RECORD_BACKED[target.role]}, so its role can't be changed here.`,
        });
      }

      // Managers cannot touch admin accounts
      if (callerRole === "manager" && target.role === "admin") {
        return res.status(403).json({ message: "Managers cannot modify admin accounts." });
      }

      // Only admins (and platform_admin) can promote someone to admin
      if (updates.role === "admin" && callerRole !== "admin" && callerRole !== "platform_admin") {
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

      if (updates.isActive !== undefined) {
        // Deactivating must end the person's sessions, not just block their next login.
        if (!updates.isActive) await revokeAllUserTokens(id);
        forgetUserActiveState(id);
      }

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

// PATCH /api/users/me (meRouter) — self-service profile update (safe fields only)
meRouter.patch("/", authenticateJWT, async (req: any, res) => {
  try {
    const schema = z.object({
      firstName:         z.string().min(1).max(100).optional(),
      lastName:          z.string().min(1).max(100).optional(),
      phoneNumber:       z.string().max(30).optional().nullable(),
      preferredCurrency: z.enum(["KES", "USD", "GBP", "EUR", "UGX", "TZS"]).optional(),
      // Only ever applied below if the caller is platform_admin — accepted
      // here so the schema doesn't reject the request, not because every
      // caller may set these. A non-platform_admin sending these fields
      // (e.g. by editing the request directly) has them silently dropped,
      // not rejected — the rest of the update still goes through.
      email: z.string().email().optional(),
      role:  z.enum(["platform_admin", "admin", "manager"]).optional(),
    });

    const parsed = schema.parse(req.body);
    const isPlatformAdmin = req.user.role === "platform_admin";
    const { email, role, ...updates } = parsed;

    if (isPlatformAdmin) {
      if (email && email !== req.user.email) {
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (existing && existing.id !== req.user.id) {
          return res.status(409).json({ message: "That email is already in use." });
        }
        (updates as any).email = email;
      }
      if (role) (updates as any).role = role;
    }

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

// GET /api/users/me/activity — the caller's own recent activity.
// audit_logs already records every successful mutation across the app
// (see auditLog middleware) — this just surfaces it for the person who
// actually performed the actions, nothing new is tracked here.
meRouter.get("/activity", authenticateJWT, async (req: any, res: any) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const rows = await db
      .select({
        id:         auditLogs.id,
        entityType: auditLogs.entityType,
        entityId:   auditLogs.entityId,
        action:     auditLogs.action,
        timestamp:  auditLogs.timestamp,
        metadata:   auditLogs.metadata,
      })
      .from(auditLogs)
      .where(eq(auditLogs.userId, req.user.id))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error("Fetch own activity error:", err);
    res.status(500).json({ message: "Failed to fetch activity" });
  }
});

// PATCH /api/users/me/password — change own password
meRouter.patch("/password", authenticateJWT, async (req: any, res) => {
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