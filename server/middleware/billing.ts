/**
 * server/middleware/billing.ts
 *
 * Middleware factories that enforce plan limits before allowing resource creation.
 * Apply them AFTER authenticateJWT on any POST route that creates a billable resource.
 *
 * Usage:
 *   router.post("/", authenticateJWT, requireActiveSubscription, enforcePropertyLimit, handler)
 *   router.post("/", authenticateJWT, requireActiveSubscription, enforceUserLimit, handler)
 */

import { Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { organizations, properties, users } from "@shared/schema";
import { eq, count } from "drizzle-orm";

async function getOrg(organizationId: number) {
  const [org] = await db
    .select({
      subscriptionStatus: organizations.subscriptionStatus,
      subscriptionPlan: organizations.subscriptionPlan,
      maxProperties: organizations.maxProperties,
      maxUsers: organizations.maxUsers,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org;
}

/**
 * Blocks the request if the org's subscription is not "active" or "trial".
 * Attach this first so limit checks below never run on expired accounts.
 */
export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const orgId = (req as any).user?.organizationId as number | undefined;
  if (!orgId) return res.status(403).json({ message: "Organization context missing" });

  try {
    const org = await getOrg(orgId);
    if (!org) return res.status(403).json({ message: "Organization not found" });

    const allowed = ["active", "trial"];
    if (!allowed.includes(org.subscriptionStatus ?? "")) {
      return res.status(402).json({
        message:
          "Your subscription is inactive. Please update your billing details to continue.",
        code: "SUBSCRIPTION_INACTIVE",
        subscriptionStatus: org.subscriptionStatus,
      });
    }

    next();
  } catch (err) {
    console.error("[billing] requireActiveSubscription error:", err);
    res.status(500).json({ message: "Billing check failed" });
  }
}

/**
 * Blocks property creation when the org has hit its maxProperties limit.
 */
export async function enforcePropertyLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const orgId = (req as any).user?.organizationId as number | undefined;
  if (!orgId) return res.status(403).json({ message: "Organization context missing" });

  try {
    const org = await getOrg(orgId);
    if (!org) return res.status(403).json({ message: "Organization not found" });

    const [{ value }] = await db
      .select({ value: count() })
      .from(properties)
      .where(eq(properties.organizationId, orgId));

    const current = Number(value ?? 0);
    const max = org.maxProperties ?? 5;

    if (current >= max) {
      return res.status(403).json({
        message: `Your ${org.subscriptionPlan} plan allows a maximum of ${max} propert${max === 1 ? "y" : "ies"}. Upgrade your plan to add more.`,
        code: "PROPERTY_LIMIT_REACHED",
        current,
        max,
      });
    }

    next();
  } catch (err) {
    console.error("[billing] enforcePropertyLimit error:", err);
    res.status(500).json({ message: "Billing check failed" });
  }
}

/**
 * Blocks user/invite creation when the org has hit its maxUsers limit.
 */
export async function enforceUserLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const orgId = (req as any).user?.organizationId as number | undefined;
  if (!orgId) return res.status(403).json({ message: "Organization context missing" });

  try {
    const org = await getOrg(orgId);
    if (!org) return res.status(403).json({ message: "Organization not found" });

    const [{ value }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const current = Number(value ?? 0);
    const max = org.maxUsers ?? 10;

    if (current >= max) {
      return res.status(403).json({
        message: `Your ${org.subscriptionPlan} plan allows a maximum of ${max} user${max === 1 ? "" : "s"}. Upgrade your plan to add more.`,
        code: "USER_LIMIT_REACHED",
        current,
        max,
      });
    }

    next();
  } catch (err) {
    console.error("[billing] enforceUserLimit error:", err);
    res.status(500).json({ message: "Billing check failed" });
  }
}