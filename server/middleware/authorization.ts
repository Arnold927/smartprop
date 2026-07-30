import { Request, Response, NextFunction } from 'express';

/**
 * Require admin role
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'platform_admin') {
    return res.status(403).json({
      message: 'Admin privileges required'
    });
  }

  next();
};

/**
 * Generic role checker (optional, scalable)
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.role) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Requires one of roles: ${roles.join(', ')}`
      });
    }

    next();
  };
};