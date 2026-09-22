/**
 * auditLog middleware
 *
 * Wraps a write route (POST / PUT / PATCH / DELETE) so that every
 * successful mutation is recorded in the `audit_logs` table.
 *
 * Usage (inline, per-route):
 *   router.post('/', authenticateJWT, auditLog('property', 'CREATE'), handler)
 *
 * Usage (factory helper – wires the full CRUD set at once):
 *   see auditedCRUDRouter in utils/crud.ts
 *
 * Fields captured:
 *   userId      – from req.user (JWT)
 *   entityType  – caller-supplied label (e.g. 'property', 'tenant')
 *   entityId    – taken from res.locals.auditEntityId (set by the handler)
 *                 or falls back to req.params.id
 *   action      – CREATE | UPDATE | DELETE (caller-supplied)
 *   oldValues   – res.locals.auditOldValues  (optional, set by handler)
 *   newValues   – res.locals.auditNewValues  (optional, set by handler)
 *   ipAddress   – req.ip
 *   userAgent   – User-Agent header
 *   metadata    – extra context the handler may push via res.locals.auditMeta
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { auditLogs } from '../../shared/schema.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION' | 'POST_TO_LEDGER';

/**
 * Returns Express middleware that fires an audit-log insert *after* the
 * response has been sent (using the `finish` event on res) so it never
 * delays the response to the client.
 *
 * Only logs when the response status is < 400 (i.e. the mutation succeeded).
 */
export function auditLog(entityType: string, action: AuditAction) {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Use finish so we don't block the response
    res.on('finish', () => {
      // Only audit successful writes
      if (res.statusCode >= 400) return;

      const req = _req as any;

      const userId: string | undefined =
        req.user?.id ?? req.user?.userId ?? req.user?.sub;

      if (!userId) {
        // No authenticated user – nothing to log
        return;
      }

      const entityId: string =
        String(res.locals.auditEntityId ?? req.params?.id ?? 'unknown');

      const payload = {
        userId,
        entityType,
        entityId,
        action,
        oldValues:  res.locals.auditOldValues  ?? null,
        newValues:  res.locals.auditNewValues  ?? null,
        ipAddress:  req.ip ?? null,
        userAgent:  req.headers?.['user-agent'] ?? null,
        sessionId:  req.user?.sessionId ?? null,
        metadata:   res.locals.auditMeta ?? null,
      };

      // Fire-and-forget – don't let a DB error surface to the client
      db.insert(auditLogs)
        .values(payload)
        .catch((err: unknown) =>
          console.error('[auditLog] Failed to write audit record:', err)
        );
    });

    next();
  };
}