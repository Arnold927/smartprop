// server/utils/crud.ts
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateJWT } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import { parseQueryOptions, buildQuery, paginateResponse } from './query';

// Define a type for the database result
type QueryResult<T> = T[];

// Import or define the actual user type from your auth middleware
interface CustomJWTPayload {
  id?: string;
  organizationId?: number;
  email?: string;
  role?: string;
  firstName?: string; 
  lastName?: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

// Define types for the request
interface AuthenticatedRequest extends Request {
  user?: CustomJWTPayload;
  session?: {
    organizationId?: number;
    [key: string]: any;
  };
}

interface CRUDOptions {
  table: any;
  insertSchema: z.AnyZodObject;
  organizationScoped?: boolean;
  /** Human-readable label written to audit_logs.entity_type.
   *  Defaults to the Drizzle table symbol name when omitted. */
  entityType?: string;
  /**
   * Optional middleware injected between authenticateJWT and the create handler.
   * Use this to attach plan-limit guards (e.g. requireActiveSubscription, enforcePropertyLimit).
   */
  preCreateMiddleware?: Array<(req: Request, res: Response, next: any) => void>;
}

// Coerce fields that JSON serialisation mangles before Zod validates:
//   • decimal columns  → Drizzle-Zod expects a numeric string, not a JS number
//   • timestamp columns → Drizzle-Zod expects a Date object, not an ISO string
const TIMESTAMP_KEYS = new Set(['expenseDate','dueDate','paymentDate','approvedAt','startDate',
  'endDate','nextRecurringDate','createdAt','updatedAt','date','timestamp']);
const DECIMAL_KEYS = new Set(['amount','baseRate','minimumCharge','contractValue','balance',
  'totalAmount','paidAmount','pendingAmount','rate','price','fee']);
function coerceBody(body: Record<string, any>): Record<string, any> {
  const coerceDate = (v: unknown) =>
    v == null ? v : v instanceof Date ? v : typeof v === 'string' ? new Date(v) : v;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (TIMESTAMP_KEYS.has(k))        out[k] = coerceDate(v);
    else if (DECIMAL_KEYS.has(k) && typeof v === 'number') out[k] = String(v);
    // Strip empty strings so optional numeric/decimal columns receive undefined (omitted)
    // rather than "" which Postgres rejects with "invalid input syntax for type numeric"
    else if (typeof v === 'string' && v.trim() === '') out[k] = undefined;
    else                              out[k] = v;
  }
  return out;
}

export const createCRUDRouter = (options: CRUDOptions): Router => {
  const router = Router();
  // Resolve entity label once at router-creation time
  const entityLabel: string =
    options.entityType ??
    (options.table as any)[Symbol.for('drizzle:Name')] ??
    'record';

  // List
  router.get('/', authenticateJWT, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    
    try {
      const queryOptions = parseQueryOptions(authReq);
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;

      let baseQuery = db.select().from(options.table);
      
      if (options.organizationScoped && orgId && options.table.organizationId) {
        baseQuery = baseQuery.where(eq(options.table.organizationId, orgId)) as any;
      }

      const query = buildQuery(baseQuery, options.table, queryOptions);
      const results = await query;

      let countQuery = db.select({ count: sql<number>`count(*)` }).from(options.table);
      if (options.organizationScoped && orgId && options.table.organizationId) {
        countQuery = countQuery.where(eq(options.table.organizationId, orgId)) as any;
      }
      const totalResult = await countQuery;
      
      const totalArray = totalResult as Array<{ count: number }>;
      const total = totalArray.length > 0 ? Number(totalArray[0].count) : 0;

      res.json(paginateResponse(
        results,
        total,
        queryOptions.page || 1,
        queryOptions.pageSize || 20,
        authReq.originalUrl.split('?')[0]
      ));
    } catch (error) {
      console.error(`Error in CRUD list:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Retrieve
  router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    
    try {
      const id = parseInt(authReq.params.id);
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;

      const conditions = [eq(options.table.id, id)];
      if (options.organizationScoped && orgId && options.table.organizationId) {
        conditions.push(eq(options.table.organizationId, orgId));
      }

      const result = await db.select()
        .from(options.table)
        .where(and(...conditions))
        .limit(1);

      const resultArray = result as QueryResult<any>;
      if (resultArray.length === 0) {
        return res.status(404).json({ message: 'Not found' });
      }

      res.json(resultArray[0]);
    } catch (error) {
      console.error(`Error in CRUD retrieve:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Create — audit logged
  // preCreateMiddleware (e.g. billing guards) is spread in before the handler
  const preCreate = options.preCreateMiddleware ?? [];
  router.post('/', authenticateJWT as any, ...preCreate, auditLog(entityLabel, 'CREATE'), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    
    try {
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;

      const serverUserId = authReq.user?.id || authReq.user?.userId;

      const data = {
        ...coerceBody(authReq.body),
        userId: serverUserId,
        // Always override createdBy from the verified JWT — never trust the client
        ...(serverUserId ? { createdBy: serverUserId } : {}),
        ...(options.organizationScoped && orgId ? { organizationId: orgId } : {})
      };

      const validated = options.insertSchema.parse(data);

      const result = await db.insert(options.table).values(validated).returning();
      
      const resultArray = result as QueryResult<any>;
      const created = resultArray[0];

      // Expose the new record's id so auditLog middleware can capture it
      res.locals.auditEntityId = created?.id;
      res.locals.auditNewValues = created;

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      console.error(`Error in CRUD create:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Update — audit logged
  router.put('/:id', authenticateJWT, auditLog(entityLabel, 'UPDATE'), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    
    try {
      const id = parseInt(authReq.params.id);
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;
      
      const schema = options.insertSchema as z.AnyZodObject;
      const validated = schema.partial().parse(coerceBody(authReq.body));

      const conditions = [eq(options.table.id, id)];
      if (options.organizationScoped && orgId && options.table.organizationId) {
        conditions.push(eq(options.table.organizationId, orgId));
      }

      const result = await db.update(options.table)
        .set(validated)
        .where(and(...conditions))
        .returning();

      const resultArray = result as QueryResult<any>;
      if (resultArray.length === 0) {
        return res.status(404).json({ message: 'Not found' });
      }

      res.locals.auditEntityId = id;
      res.locals.auditNewValues = validated;

      res.json(resultArray[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      console.error(`Error in CRUD update:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });


  // Patch — audit logged (alias for partial PUT)
  router.patch('/:id', authenticateJWT, auditLog(entityLabel, 'UPDATE'), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const id = parseInt(authReq.params.id);
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;

      const schema = options.insertSchema as z.AnyZodObject;
      const validated = schema.partial().parse(coerceBody(authReq.body));

      const conditions = [eq(options.table.id, id)];
      if (options.organizationScoped && orgId && options.table.organizationId) {
        conditions.push(eq(options.table.organizationId, orgId));
      }

      const result = await db.update(options.table)
        .set(validated)
        .where(and(...conditions))
        .returning();

      const resultArray = result as QueryResult<any>;
      if (resultArray.length === 0) {
        return res.status(404).json({ message: 'Not found' });
      }

      res.locals.auditEntityId = id;
      res.locals.auditNewValues = validated;

      res.json(resultArray[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.errors });
      }
      console.error(`Error in CRUD patch:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Delete — audit logged
  router.delete('/:id', authenticateJWT, auditLog(entityLabel, 'DELETE'), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    
    try {
      const id = parseInt(authReq.params.id);
      const orgId = authReq.user?.organizationId || authReq.session?.organizationId;

      const conditions = [eq(options.table.id, id)];
      if (options.organizationScoped && orgId && options.table.organizationId) {
        conditions.push(eq(options.table.organizationId, orgId));
      }

      const result = await db.delete(options.table)
        .where(and(...conditions))
        .returning();

      const resultArray = result as QueryResult<any>;
      if (resultArray.length === 0) {
        return res.status(404).json({ message: 'Not found' });
      }

      res.locals.auditEntityId = id;

      res.status(204).send();
    } catch (error) {
      console.error(`Error in CRUD delete:`, error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return router;
};