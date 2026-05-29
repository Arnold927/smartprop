/**
 * requireOrg — must be applied after authenticateJWT on every route
 * that touches tenant-scoped data.
 *
 * Guarantees req.user.organizationId is a positive integer before the
 * handler runs.  Any route that passes this guard can safely use
 * req.user.organizationId without a further null-check.
 */
import { Request, Response, NextFunction } from "express";

export const requireOrg = (req: Request, res: Response, next: NextFunction) => {
  const orgId = (req as any).user?.organizationId;
  if (!orgId || typeof orgId !== "number" || orgId < 1) {
    return res.status(403).json({
      message: "A valid organization context is required. Please log in again.",
    });
  }
  next();
};
