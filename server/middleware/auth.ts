import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
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

    // Require a real organizationId for all routes EXCEPT /api/tenants/me,
    // which has its own three-tier recovery logic and will heal a null-org
    // user row on first successful lookup.
    const orgId = decoded.organizationId;
    const isTenantMeRoute = req.path === "/me" && req.baseUrl?.includes("/tenants");
    if (!isTenantMeRoute && (!orgId || typeof orgId !== "number" || orgId < 1)) {
      return res.status(403).json({
        message: "Token does not contain a valid organization. Please log in again.",
      });
    }

    req.user = {
      ...decoded,
      organizationId: orgId && typeof orgId === "number" && orgId >= 1 ? orgId : undefined,
      role: decoded.role || "user",
      id: decoded.userId || decoded.sub,
      userId: decoded.userId || decoded.sub,
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