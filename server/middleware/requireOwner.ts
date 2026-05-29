/**
 * requireOwner.ts
 *
 * Middleware that resolves the "effective owner ID" for a request and attaches
 * it to req.ownerId, which all landlord-portal route handlers must use
 * instead of reading req.query.ownerId directly.
 *
 * The core vulnerability this closes:
 *   Before: const ownerId = req.query.ownerId || req.user.id
 *   A landlord could pass ?ownerId=<another_landlord_uuid> and receive their
 *   full portfolio — properties, tenants, payments, maintenance, reports.
 *
 *   After: ownerId is ALWAYS req.user.id for landlord-role users.
 *   Managers and admins may still pass ?ownerId= to view any portfolio
 *   (they need this for support and oversight), but it must match an actual
 *   user within the same organisation.
 *
 * Usage:
 *   import { requireOwner } from '../middleware/requireOwner';
 *   router.get('/dashboard', authenticateJWT, requireOrg, requireOwner, handler);
 *
 *   In the handler:
 *   const ownerId = (req as any).ownerId as string;  // always safe after this middleware
 */

import { Request, Response, NextFunction } from 'express';
import { db }   from '../db';
import { users } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

// Roles that may impersonate another owner via ?ownerId=
const PRIVILEGED_ROLES = new Set(['admin', 'manager']);

export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = (req as any).user;

  if (!user?.id) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }

  const isPrivileged = PRIVILEGED_ROLES.has(user.role ?? '');
  const queriedId    = req.query.ownerId as string | undefined;

  if (!isPrivileged) {
    // Landlords, tenants, staff: always use their own ID.
    // The ?ownerId query param is silently ignored — a landlord cannot
    // elevate themselves to view another landlord's portfolio by crafting a URL.
    (req as any).ownerId = String(user.id);
    next();
    return;
  }

  // Privileged users (admin / manager) may pass ?ownerId= to view any portfolio,
  // but we validate that the target user exists within the same organisation.
  if (queriedId && queriedId !== user.id) {
    const orgId = user.organizationId as number;
    const [target] = await db
      .select({ id: users.id, organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, queriedId))
      .limit(1);

    if (!target) {
      res.status(404).json({ message: 'Owner not found' });
      return;
    }

    if (target.organizationId !== orgId) {
      res.status(403).json({ message: 'Cannot access a portfolio outside your organisation' });
      return;
    }

    (req as any).ownerId = queriedId;
  } else {
    (req as any).ownerId = String(user.id);
  }

  next();
}
