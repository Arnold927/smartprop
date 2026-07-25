/**
 * requireOrg — must be applied after authenticateJWT on every route
 * that touches tenant-scoped data.
 *
 * Guarantees req.user.organizationId is a positive integer before the
 * handler runs.  Any route that passes this guard can safely use
 * req.user.organizationId without a further null-check.
 *
 * Special case: platform_admin. That role deliberately has no
 * organizationId of its own (it isn't scoped to any single organisation —
 * see requireRole.ts's roleGuard, which bypasses the ROUTE_POLICY check
 * entirely for this role). Every other route in the app already correctly
 * scopes its query by req.user.organizationId, so rather than touching
 * every one of those routes individually, a platform_admin passes
 * ?organizationId=X on the request to say which organisation they're
 * currently viewing, and this middleware resolves it there instead of on
 * the JWT — every downstream handler then works completely unchanged.
 */
import { Request, Response, NextFunction } from "express";

export const requireOrg = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (user?.role === "platform_admin") {
    const requested = req.query.organizationId ?? req.body?.organizationId;
    const orgId = requested ? parseInt(String(requested), 10) : NaN;
    if (!orgId || orgId < 1) {
      return res.status(400).json({
        message: "Specify which organisation to view with ?organizationId=<id>.",
      });
    }
    user.organizationId = orgId;
    return next();
  }

  const orgId = user?.organizationId;
  if (!orgId || typeof orgId !== "number" || orgId < 1) {
    return res.status(403).json({
      message: "A valid organization context is required. Please log in again.",
    });
  }
  next();
};