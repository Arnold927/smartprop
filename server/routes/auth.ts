import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { z } from "zod";
import { createHash } from "crypto";
import { db, withRetry } from "../db";
import { users, organizations, refreshTokens, tenants } from "../../shared/schema";
import { eq, and, lt, isNull } from "drizzle-orm/sql";
import { authenticateJWT } from "../middleware/auth";
import { randomUUID } from "crypto";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback-dev-secret-change-in-production";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback-refresh-secret-change-in-production";
const BCRYPT_ROUNDS = 12;

// ─── Security helpers ─────────────────────────────────────────────────────────

/** SHA-256 hex of a raw token string — stored in DB instead of the token itself */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Store a refresh token in the DB so it can be revoked server-side.
 * Old expired/revoked tokens for this user are cleaned up on insert.
 */
async function storeRefreshToken(
  userId: string,
  rawToken: string,
  req: any,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const deviceHint = (req.headers["user-agent"] as string ?? "").slice(0, 200);
  const ipAddress  = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
                     ?? req.socket?.remoteAddress ?? "";
  await db.insert(refreshTokens).values({
    userId,
    tokenHash:  hashToken(rawToken),
    expiresAt,
    deviceHint: deviceHint || null,
    ipAddress:  ipAddress  || null,
  } as any);
}

/**
 * Verify a raw refresh token against the DB:
 * - tokenHash must exist
 * - revokedAt must be NULL
 * - expiresAt must be in the future
 * Returns the stored record or null.
 */
async function verifyStoredRefreshToken(rawToken: string): Promise<any | null> {
  const hash = hashToken(rawToken);
  const now  = new Date();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        isNull(refreshTokens.revokedAt),
      )
    )
    .limit(1);
  if (!row) return null;
  if (new Date(row.expiresAt as any) < now) return null;
  return row;
}

/** Revoke a single token by its raw value */
async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hash));
}

/** Revoke ALL refresh tokens for a user (on password change, admin session kill) */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))
    );
}

// ─── Password policy ──────────────────────────────────────────────────────────

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS  = 15 * 60 * 1000; // 15 minutes

/**
 * Validates password strength. Rules:
 *   - 8+ characters
 *   - At least one uppercase letter
 *   - At least one digit
 *   - At least one special character
 */
function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) return { valid: false, message: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Password must contain at least one uppercase letter" };
  if (!/[0-9]/.test(password)) return { valid: false, message: "Password must contain at least one number" };
  if (!/[^A-Za-z0-9]/.test(password)) return { valid: false, message: "Password must contain at least one special character (e.g. ! @ # $)" };
  return { valid: true };
}

/**
 * Record a failed login attempt. Locks account after MAX_FAILED_ATTEMPTS.
 * Returns true if the account is now locked.
 */
async function recordFailedAttempt(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ failedLoginAttempts: (users as any).failedLoginAttempts })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const attempts = ((user as any)?.failedLoginAttempts ?? 0) + 1;
  const willLock = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = willLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

  await db.update(users).set({
    failedLoginAttempts: attempts,
    ...(willLock ? { lockedUntil } : {}),
  } as any).where(eq(users.id, userId));

  return willLock;
}

/** Reset failed attempts on successful login */
async function clearFailedAttempts(userId: string): Promise<void> {
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null } as any).where(eq(users.id, userId));
}

function buildTokenPayload(user: any) {
  return {
    userId: user.id,
    email: user.email,
    organizationId: user.organizationId,
    role: user.role || "user",
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    phoneNumber: user.phoneNumber,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// POST /api/auth/signup
// Public signup is disabled — accounts are created by admins via User Management.
// Remove this block to re-enable self-service registration.
router.post("/signup", async (req, res) => {
  // Check if any organization exists — if yes, block public signup
  try {
    const [anyOrg] = await db.select({ id: organizations.id }).from(organizations).limit(1);
    if (anyOrg) {
      return res.status(403).json({
        message: "Public registration is disabled. Please contact your administrator to create an account.",
      });
    }
  } catch {
    // If DB check fails, allow first signup to proceed
  }
  try {
    const { firstName, lastName, email, password, organizationName, phoneNumber } = req.body;

    if (!email || !password || !firstName || !lastName || !organizationName) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const strengthCheck = validatePasswordStrength(password);
    if (!strengthCheck.valid) {
      return res.status(400).json({ message: strengthCheck.message });
    }

    const [existingUser] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existingUser) {
      return res.status(409).json({ message: "Email already registered. Please log in." });
    }

    const orgSlug = organizationName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    let [organization] = await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);

    if (!organization) {
      [organization] = await db
        .insert(organizations)
        .values({ name: organizationName, slug: orgSlug } as any)
        .returning();
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const verificationToken = randomUUID();
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const [newUser] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        organizationId: organization.id,
        email: email.toLowerCase(),
        firstName,
        lastName,
        phoneNumber: phoneNumber || null,
        passwordHash,
        role: "admin",
        isOrgAdmin: true,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: verificationExpiresAt,
      } as any)
      .returning();

    try {
      const verificationLink = `${process.env.APP_URL || "http://localhost:5173"}/auth/verify-email?token=${verificationToken}`;
      const { sendVerificationEmail } = await import("../lib/email");
      await sendVerificationEmail({ to: newUser.email, verificationLink });
    } catch (emailErr) {
      console.error("Verification email failed (continuing):", emailErr);
    }

    res.status(201).json({
      message: "Account created successfully. Please check your email to verify your account.",
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Failed to create account" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Account lockout check
    const lockedUntil = (user as any).lockedUntil;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      const remainingMs  = new Date(lockedUntil).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(423).json({
        message: `Account is temporarily locked due to too many failed login attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.`,
        lockedUntil,
      });
    }

    // Deactivation check — admin/manager has disabled this account
    if ((user as any).isActive === false) {
      return res.status(403).json({
        message: "Your account has been deactivated. Please contact your organisation administrator.",
      });
    }

    let isValidPassword = false;
    if (user.passwordHash.startsWith("$2b$") || user.passwordHash.startsWith("$2a$")) {
      isValidPassword = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Legacy base64 — verify and migrate on the fly
      isValidPassword = user.passwordHash === Buffer.from(password).toString("base64");
      if (isValidPassword) {
        const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
      }
    }

    if (!isValidPassword) {
      // Record the failed attempt (may lock the account)
      const nowLocked = await recordFailedAttempt(user.id);
      if (nowLocked) {
        return res.status(423).json({
          message: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MS / 60000} minutes.`,
        });
      }
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ 
        message: "Please verify your email address before logging in.",
        emailVerified: false 
      });
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await clearFailedAttempts(user.id);

    const payload = buildTokenPayload(user);
    const accessToken  = jwt.sign(payload, JWT_SECRET, { expiresIn: "4h" });
    const refreshExpiry = rememberMe ? "30d" : "1d";
    const refreshToken = jwt.sign({ userId: user.id, jti: randomUUID() }, JWT_REFRESH_SECRET, { expiresIn: refreshExpiry });

    // Store refresh token hash so it can be revoked server-side
    await storeRefreshToken(user.id, refreshToken, req);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      access_token: accessToken,       // web compat alias
      rememberMe: !!rememberMe,
      mobileRefreshToken: refreshToken, // mobile clients use this (can't read httpOnly cookie)
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/auth/token (alias for login - backward compat)
router.post("/token", async (req, res, next) => {
  req.url = "/login";
  next("route");
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: "Refresh token required" });
  }

  try {
    // 1. Verify JWT signature and expiry
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: string };

    // 2. Check it hasn't been revoked in the DB
    const stored = await verifyStoredRefreshToken(refreshToken);
    if (!stored) {
      res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
      return res.status(401).json({ success: false, message: "Session has been revoked. Please log in again.", redirectToLogin: true });
    }

    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    // A deactivated account must not be able to renew its session. Without this, an admin's
    // "Deactivate" only stopped new logins — anyone already signed in could keep refreshing.
    if (user.isActive === false) {
      await revokeAllUserTokens(user.id);
      res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
      return res.status(401).json({
        success: false,
        message: "Your account has been deactivated. Please contact your organisation administrator.",
        redirectToLogin: true,
      });
    }

    // Enforce email verification on every token refresh — closes the bypass window
    if (!user.emailVerified) {
      res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
      return res.status(403).json({
        success: false,
        message: "Please verify your email address before continuing.",
        emailVerified: false,
        redirectToVerify: true,
      });
    }

    // 3. Rotate: revoke the old token and issue a fresh one
    await revokeRefreshToken(refreshToken);
    const newRefreshToken = jwt.sign({ userId: user.id, jti: randomUUID() }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
    await storeRefreshToken(user.id, newRefreshToken, req);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    const newAccessToken = jwt.sign(buildTokenPayload(user), JWT_SECRET, { expiresIn: "4h" });

    return res.json({
      success: true,
      accessToken: newAccessToken,
      access_token: newAccessToken,
      mobileRefreshToken: newRefreshToken,
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
    return res.status(401).json({ success: false, message: "Invalid or expired refresh token", redirectToLogin: true });
  }
});

// GET /api/auth/user
router.get("/user", authenticateJWT, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const [user] = await withRetry(() => db.select().from(users).where(eq(users.id, req.user!.userId as string)).limit(1));

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (token) {
    // Revoke the token server-side — prevents reuse even before 7-day expiry
    await revokeRefreshToken(token).catch(() => {});
  }
  res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });
  res.json({ success: true, message: "Logged out successfully" });
});

// POST /api/auth/change-password
router.post("/change-password", authenticateJWT, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Both current and new password are required" });
    }

    // Enforce full password policy on new password
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ message: strength.message });
    }

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId as string)).limit(1);

    if (!user || !user.passwordHash) {
      return res.status(404).json({ message: "User not found" });
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, user.id));

    // Revoke all refresh tokens — forces re-login on all devices
    await revokeAllUserTokens(user.id);
    res.clearCookie("refreshToken", { httpOnly: true, secure: process.env.NODE_ENV === "production", path: "/" });

    res.json({ success: true, message: "Password changed successfully. Please log in again on all devices." });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

    // Always return 200 — don't reveal if email exists
    if (!user) {
      return res.json({ message: "If that email exists, a reset link has been sent." });
    }

    const resetToken = randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await db.update(users)
      .set({ passwordResetToken: resetToken, passwordResetExpiresAt: expiresAt })
      .where(eq(users.id, user.id));

    try {
      const resetLink = `${process.env.APP_URL || "http://localhost:5173"}/auth/reset-password?token=${resetToken}`;
      const { sendPasswordResetEmail } = await import("../lib/email");
      await sendPasswordResetEmail({ to: user.email, resetLink });
    } catch (emailErr) {
      console.error("Password reset email failed (continuing):", emailErr);
    }

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Failed to process reset request" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and password are required" });
    }

    const activationStrengthCheck = validatePasswordStrength(password);
    if (!activationStrengthCheck.valid) {
      return res.status(400).json({ message: activationStrengthCheck.message });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.passwordResetToken, token))
      .limit(1);

    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      return res.status(400).json({ message: "Reset link is invalid or has expired" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await db
      .update(users)
      .set({
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    res.json({ success: true, message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// GET /api/auth/invite/:token — validate an invite token (unauthenticated)
router.get("/invite/:token", async (req, res) => {
  try {
    const [user] = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(eq(users.emailVerificationToken, req.params.token))
      .limit(1);

    if (!user) return res.status(400).json({ message: "Invalid invite token" });
    res.json({ email: user.email, role: user.role });
  } catch (err) {
    console.error("Invite token lookup error:", err);
    res.status(500).json({ message: "Failed to validate invite" });
  }
});

// POST /api/auth/verify-email — verify email token (unauthenticated)
router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token is required" });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, token))
      .limit(1);

    if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ message: "Verification link is invalid or has expired" });
    }

    await db
      .update(users)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    res.json({ success: true, message: "Email verified successfully. You can now log in." });
  } catch (error) {
    console.error("Verify email error:", error);
    res.status(500).json({ message: "Failed to verify email" });
  }
});

// POST /api/auth/activate — set password after invite (unauthenticated)
router.post("/activate", async (req, res) => {
  try {
    const schema = z.object({
      token: z.string(),
      password: z.string().min(8).refine(
        (p) => /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p),
        { message: "Password must contain uppercase, number, and special character" }
      ),
    });
    const { token, password } = schema.parse(req.body);

    // Look up first and check expiry — previously this went straight to an
    // UPDATE keyed only on token match, with no expiry check at all, unlike
    // the sibling /verify-email endpoint just above, which correctly checks
    // emailVerificationExpiresAt. That meant an invite link never actually
    // expired in practice, despite tenant-onboarding.ts (and now
    // inviteTenantUser) clearly setting a 7-day expiry with that intent.
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, token))
      .limit(1);

    if (!existing || !existing.emailVerificationExpiresAt || existing.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const [user] = await db
      .update(users)
      .set({
        passwordHash,
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();

    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    // ── Heal organizationId / role for tenant users ──────────────────────────
    // If the user row has no organizationId (e.g. they existed before an invite
    // was sent, or signed up independently), look them up in the tenants table
    // by email and copy the org + role across.  Without this, authenticateJWT
    // hard-rejects their token and they see "No tenant profile found".
    if (!user.organizationId) {
      const [tenantRow] = await db
        .select({ organizationId: tenants.organizationId })
        .from(tenants)
        .where(eq(tenants.email, user.email.toLowerCase()))
        .limit(1);

      if (tenantRow?.organizationId) {
        await db
          .update(users)
          .set({
            organizationId: tenantRow.organizationId,
            role: user.role === "user" || !user.role ? "tenant" : user.role,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message });
    }
    console.error("Activate account error:", err);
    res.status(500).json({ message: "Failed to activate account" });
  }
});

// ── POST /api/auth/mobile-refresh ─────────────────────────────────────────────
// Mobile-safe token refresh — accepts the refresh token in the request body
// instead of an httpOnly cookie (cookies are inaccessible on React Native).
router.post("/mobile-refresh", async (req, res) => {
  const { refreshToken } = req.body ?? {};

  if (!refreshToken) {
    return res.status(400).json({ message: "refreshToken is required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: string };

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, decoded.userId))
      .limit(1);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Enforce email verification on mobile refresh — same guard as the cookie-based /refresh
    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email address before continuing.",
        emailVerified: false,
        redirectToVerify: true,
      });
    }

    const payload     = buildTokenPayload(user);
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "4h" });

    res.json({ success: true, accessToken });
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Refresh token expired. Please log in again." });
    }
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

// ── POST /api/auth/push-token ─────────────────────────────────────────────────
// Stores the device's FCM (Android) or APNs (iOS) push token so the server can
// send targeted push notifications to specific users / devices.
// Requires authentication — the token is associated with req.user.
router.post("/push-token", authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    pushToken: z.string().min(10),
    platform:  z.enum(["android", "ios"]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid push token payload", errors: parsed.error.errors });
  }

  try {
    const { pushToken, platform } = parsed.data;
    const userId: string = req.user.userId ?? req.user.id;

    await db
      .update(users)
      .set({
        // @ts-ignore — add pushToken + pushPlatform columns via migration if not present
        pushToken,
        // @ts-ignore
        pushPlatform: platform,
      })
      .where(eq(users.id, userId));

    res.json({ success: true, message: "Push token registered" });
  } catch (err) {
    // Non-fatal — don't break the login flow if the columns are not yet migrated
    console.error("[push-token] Failed to store push token:", err);
    res.json({ success: true, message: "Push token received (storage pending migration)" });
  }
});

// DELETE /api/auth/sessions/:userId  — admin/manager: revoke all sessions for a user
router.delete("/sessions/:userId", authenticateJWT, async (req: any, res) => {
  try {
    const caller = req.user;
    if (!["admin", "manager"].includes(caller?.role ?? "")) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    await revokeAllUserTokens(req.params.userId);
    res.json({ success: true, message: `All sessions revoked for user ${req.params.userId}` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/sessions  — list active sessions for the current user
router.get("/sessions", authenticateJWT, async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const rows   = await db
      .select({
        id:         refreshTokens.id,
        issuedAt:   refreshTokens.issuedAt,
        expiresAt:  refreshTokens.expiresAt,
        deviceHint: refreshTokens.deviceHint,
        ipAddress:  refreshTokens.ipAddress,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        )
      );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;