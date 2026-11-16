/**
 * server/middleware/billing.ts
 *
 * Middleware factories that enforce plan limits before allowing resource creation.
 * Apply them AFTER authenticateJWT on any POST route that creates a billable resource.
 *
 * Usage:
 *   router.post("/", authenticateJWT, requireActiveSubscription, enforcePropertyLimit, handler)
 *   router.post("/", authenticateJWT, requireActiveSubscription, enforceUserLimit, handler)
 *   router.post("/", authenticateJWT, requireActiveSubscription, enforceUnitLimit, handler)
 *
 * The limits themselves come from services/plans.ts
 * (plan + the platform admin's per-organisation overrides).
 */

import { Request, Response, NextFunction } from "express";
import { checkCanAdd, getEntitlements, countsTowardUserLimit as seatRule, type LimitKey } from "../services/plans.js";

/**
 * Which logins use up one of a plan's "users".
 *
 * The plans sell team seats ("Up to 5 users", "Up to 20 users"). Tenants, contractors and caretakers
 * are portal logins that come in through their own flows (a lease, a contractor profile, a property
 * assignment), not team seats, and a deactivated account no longer occupies one.
 * Exported so the platform admin's "users / limit" figure uses exactly the same rule.
 */
export const NON_SEAT_ROLES = ["tenant", "contractor", "caretaker"];
export const countsTowardUserLimit = seatRule;

/**
 * Blocks the request if the org's subscription is not "active" or "trial", or its trial / paid
 * period has ended. Attach this first so limit checks below never run on expired accounts.
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const orgId = (req as any).user?.organizationId as number | undefined;
  if (!orgId) return res.status(403).json({ message: "Organization context missing" });
  try {
    const ent = await getEntitlements(orgId);
    if (!ent) return res.status(403).json({ message: "Organization not found" });
    if (!ent.usable) {
      return res.status(402).json({
        message: ent.expired
          ? (ent.status === "trial" ? "Your free trial has ended. Please choose a plan to continue." : "Your subscription period has ended. Please renew to continue.")
          : "Your subscription is inactive. Please update your billing details to continue.",
        code: "SUBSCRIPTION_INACTIVE",
        subscriptionStatus: ent.expired ? "expired" : ent.status,
      });
    }
    next();
  } catch (err) {
    console.error("[billing] requireActiveSubscription error:", err);
    res.status(500).json({ message: "Billing check failed" });
  }
}

function limitGuard(key: LimitKey, label: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req as any).user?.organizationId as number | undefined;
    if (!orgId) return res.status(403).json({ message: "Organization context missing" });
    try {
      const result = await checkCanAdd(orgId, key, 1);
      if (!result.ok) return res.status(result.status).json(result.body);
      next();
    } catch (err) {
      console.error(`[billing] ${label} error:`, err);
      res.status(500).json({ message: "Billing check failed" });
    }
  };
}

/** Blocks property creation when the org has hit its property limit. */
export const enforcePropertyLimit = limitGuard("maxProperties", "enforcePropertyLimit");
/** Blocks user/invite creation when the org has hit its team-seat limit. */
export const enforceUserLimit = limitGuard("maxUsers", "enforceUserLimit");
/** Blocks single-unit creation when the org has hit its unit limit (bulk paths call checkCanAdd with a count). */
export const enforceUnitLimit = limitGuard("maxUnits", "enforceUnitLimit");
