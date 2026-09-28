import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import { CustomJWTPayload } from "../types/index.js";

declare global {
  namespace Express {
    interface Request {
      user?: CustomJWTPayload;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user?: CustomJWTPayload;
}

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Deactivation enforcement ─────────────────────────────────────────────────
// A JWT is valid until it expires (4h), so on its own it would keep working after an admin
// deactivates the account. Every request therefore also checks that the user is still active.
// The result is cached briefly so this costs at most one small primary-key lookup per user per
// window, not one per request; deactivating a user clears the entry on this instance at once
// (see forgetUserActiveState), and any other instance catches up within the TTL.
const ACTIVE_CACHE_TTL_MS = 30_000;
const ACTIVE_CACHE_MAX    = 5_000;
const activeCache = new Map<string, { active: boolean; at: number }>();

/** Call after changing a user's isActive so the change takes effect immediately, not after the TTL. */
export function forgetUserActiveState(userId: string): void {
  activeCache.delete(userId);
}

async function isUserActive(userId: string): Promise<boolean> {
  const hit = activeCache.get(userId);
  if (hit && Date.now() - hit.at < ACTIVE_CACHE_TTL_MS) return hit.active;

  let active = true; // unknown user or a lookup failure keeps the previous (token-only) behaviour
  try {
    const [row] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
    if (row && row.isActive === false) active = false;
  } catch {
    // e.g. a token whose id isn't a user uuid (gate PIN sessions), or a brief database hiccup.
    // Fail open: the token itself has already been verified, and an outage must not lock everyone out.
  }

  if (activeCache.size >= ACTIVE_CACHE_MAX) activeCache.clear();
  activeCache.set(userId, { active, at: Date.now() });
  return active;
}

export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const token = authHeader.substring(7);

  if (!JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is not set");
    return res.status(500).json({ message: "Server configuration error" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as CustomJWTPayload;

    // Require a real organizationId for all routes EXCEPT /api/tenants/me
    // (which has its own three-tier recovery logic and will heal a null-org
    // user row on first successful lookup) and platform_admin (which has no
    // organizationId of its own by design — see requireOrg.ts, where this
    // role instead specifies which org it's viewing via ?organizationId=
    // on each request).
    const orgId = decoded.organizationId;
    const isTenantMeRoute = req.path === "/me" && req.baseUrl?.includes("/tenants");
    const isPlatformAdmin = decoded.role === "platform_admin";
    if (!isTenantMeRoute && !isPlatformAdmin && (!orgId || typeof orgId !== "number" || orgId < 1)) {
      return res.status(403).json({
        message: "Token does not contain a valid organization. Please log in again.",
      });
    }

    const userId = (decoded.userId || decoded.sub) as string;

    if (userId && !(await isUserActive(userId))) {
      return res.status(401).json({
        message: "Your account has been deactivated. Please contact your organisation administrator.",
        deactivated: true,
      });
    }

    req.user = {
      ...decoded,
      organizationId: orgId && typeof orgId === "number" && orgId >= 1 ? orgId : undefined,
      role: decoded.role || "user",
      id: userId,
      userId,
    };

    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    return res.status(401).json({ message: "Authentication failed" });
  }
};

// Alias for backward compatibility
export const isAuthenticated = authenticateJWT;

export const requireOrganization = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user?.organizationId) {
    return res.status(403).json({ message: "Organization access required" });
  }
  next();
};