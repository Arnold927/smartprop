// inArray added for landlord scoping
import { Router } from 'express';
import { createCRUDRouter } from '../utils/crud';
import { ZodObject } from 'zod';
import { db } from '../db';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { authenticateJWT } from '../middleware/auth';
import { requireOrg } from '../middleware/requireOrg';
import { notifyTenant } from '../services/notifyTenant';
import { storage } from '../storage';
import { exceedsApprovalThreshold } from './maintenance-item-guard';
import { 
  maintenanceRequests, contractors, tenants, units, properties,
  projects, projectTasks, projectMilestones,
  insertMaintenanceRequestSchema, insertContractorSchema,
  insertProjectSchema, insertProjectTaskSchema, insertProjectMilestoneSchema
} from '@shared/schema';

/** Auto-create a linked work order for a newly created maintenance request. */
async function autoCreateWorkOrder(maintenanceRequest: any, createdByUserId: string) {
  try {
    await storage.createWorkOrder({
      maintenanceRequestId: maintenanceRequest.id,
      workOrderType: 'maintenance',
      title: maintenanceRequest.title,
      description: maintenanceRequest.description ?? '',
      priority: maintenanceRequest.priority ?? 'medium',
      status: 'pending_approval',
      estimatedCost: maintenanceRequest.estimatedCost ?? undefined,
      createdBy: createdByUserId,
    } as any);
  } catch (err) {
    console.warn('[maintenance] auto-create work order failed:', err);
  }
}

type AnyZodObject = ZodObject<any, any, any, any, any>;

// Custom joined GET / for maintenance requests (returns tenant, unit, property nested).
//
// Scoping strategy: maintenanceRequests has no organizationId column of its own.
// We scope via units.organizationId (INNER JOIN) so:
//   1. orgId is always mandatory — requireOrg rejects the request if it's absent.
//   2. Every row returned belongs to the caller's org, regardless of whether the
//      request has a linked tenant (tenant-less requests were invisible before).
//   3. The tenant JOIN stays LEFT so tenant data is optional, not a filter.
const maintenanceListRouter = Router();
maintenanceListRouter.get('/', authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number  = req.user.organizationId;
    const role:  string  = req.user.role ?? 'manager';
    const userId: string = String(req.user.id ?? req.user.userId ?? '');
    const propertyIdParam = req.query.propertyId ? parseInt(req.query.propertyId as string, 10) : null;

    // Caretakers: only their assigned property.
    // Landlords: only properties they own (ownerId = userId).
    // Tenants: only their own submitted requests (tenantId is an integer FK, not UUID).
    let caretakerPropertyId: number | null = null;
    let landlordPropertyIds: number[] | null = null;
    let tenantRecordId: number | null = null;

    if (role === 'tenant') {
      const [tenantRow] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, orgId)))
        .limit(1);
      if (!tenantRow) return res.json([]);
      tenantRecordId = tenantRow.id;
    } else if (role === 'caretaker') {
      const caretaker = await storage.getCaretakerByUserId(userId);
      if (!caretaker?.propertyId) return res.json([]);
      caretakerPropertyId = caretaker.propertyId;
    } else if (role === 'landlord') {
      const ownedProps = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.ownerId, userId), eq(properties.organizationId, orgId)));
      landlordPropertyIds = ownedProps.map(p => p.id);
      if (landlordPropertyIds.length === 0) return res.json([]);
    }

    const rows = await db
      .select({
        id: maintenanceRequests.id,
        ticketNumber: maintenanceRequests.ticketNumber,
        title: maintenanceRequests.title,
        description: maintenanceRequests.description,
        category: maintenanceRequests.category,
        priority: maintenanceRequests.priority,
        status: maintenanceRequests.status,
        assignedTo: maintenanceRequests.assignedTo,
        estimatedCost: maintenanceRequests.estimatedCost,
        createdAt: maintenanceRequests.createdAt,
        tenantId: maintenanceRequests.tenantId,
        unitId: maintenanceRequests.unitId,
        technicianId: maintenanceRequests.technicianId,
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        tenantEmail: tenants.email,
        unitNumber: units.unitNumber,
        unitPropertyId: units.propertyId,
        propertyId: properties.id,
        propertyName: properties.name,
      })
      .from(maintenanceRequests)
      // INNER JOIN on units scopes every row to the caller's org.
      // Units always exists for a valid maintenance request (unitId is notNull in schema).
      .innerJoin(units, and(
        eq(maintenanceRequests.unitId, units.id),
        eq(units.organizationId, orgId),
        // Caretakers: restrict to their assigned property only
        ...(caretakerPropertyId !== null ? [eq(units.propertyId, caretakerPropertyId)] : []),
        // Landlords: restrict to their owned properties
        ...(landlordPropertyIds !== null ? [inArray(units.propertyId, landlordPropertyIds)] : []),
        // Tenants: only see their own submitted requests
        ...(tenantRecordId !== null ? [eq(maintenanceRequests.tenantId, tenantRecordId)] : []),
        // Optional single-property filter (e.g. property details page) —
        // narrows further within whatever the role above already allows.
        ...(propertyIdParam !== null ? [eq(units.propertyId, propertyIdParam)] : []),
      ))
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .orderBy(desc(maintenanceRequests.createdAt));

    const results = rows.map(r => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      assignedTo: r.assignedTo,
      estimatedCost: r.estimatedCost,
      createdAt: r.createdAt,
      tenantId: r.tenantId,
      tenant: (r.tenantFirstName || r.tenantLastName)
        ? { id: r.tenantId, firstName: r.tenantFirstName ?? '', lastName: r.tenantLastName ?? '', email: r.tenantEmail ?? '' }
        : null,
      unit: r.unitNumber ? { id: r.unitId, unitNumber: r.unitNumber } : null,
      property: r.propertyName ? { id: r.propertyId, name: r.propertyName } : null,
    }));

    res.json(results);
  } catch (err) {
    console.error('Error fetching maintenance requests with joins:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Maintenance routes
const maintenanceRouter = createCRUDRouter({
  table: maintenanceRequests,
  insertSchema: insertMaintenanceRequestSchema as unknown as AnyZodObject,
  organizationScoped: true,
  preCreateMiddleware: [
    async (req: any, _res, next) => {
      // A request filed with an estimated cost already above the property's
      // PM agreement threshold starts in pending_approval, same gate as
      // maintenance-item-guard.ts applies when a cost is added later via
      // an update instead. Only overrides when the caller hasn't already
      // set an explicit status themselves.
      if (!req.body.status && req.body.estimatedCost != null && req.body.unitId != null) {
        const needsApproval = await exceedsApprovalThreshold(req.body.unitId, req.body.estimatedCost);
        if (needsApproval) req.body.status = "pending_approval";
      }
      next();
    },
  ],
});

const contractorRouter = createCRUDRouter({
  table: contractors,
  insertSchema: insertContractorSchema as unknown as AnyZodObject,
  organizationScoped: true
});

// Work orders are handled by server/routes/work-orders.ts (full CRUD + sub-resources)

// Project routes
const projectRouter = createCRUDRouter({
  table: projects,
  insertSchema: insertProjectSchema as unknown as AnyZodObject,
  organizationScoped: true
});

const projectTaskRouter = createCRUDRouter({
  table: projectTasks,
  insertSchema: insertProjectTaskSchema as unknown as AnyZodObject,
  organizationScoped: false // Linked to projects
});

const projectMilestoneRouter = createCRUDRouter({
  table: projectMilestones,
  insertSchema: insertProjectMilestoneSchema as unknown as AnyZodObject,
  organizationScoped: false // Linked to projects
});

// POST /api/maintenance-requests — creation notification hook
// The maintenanceRouter (CRUD) handles actual DB insertion.
// This dedicated endpoint on maintenanceListRouter handles creation + tenant notification.
// Mounted on the same prefix in routes/index.ts (maintenanceListRouter runs first).
maintenanceListRouter.post('/', authenticateJWT, requireOrg, async (req: any, res, next) => {
  // Landlords view and approve maintenance — they do NOT create requests.
  // Creation is the PM's job (or the tenant submits via their portal).
  if (req.user?.role === 'landlord') {
    res.status(403).json({ message: 'Landlords cannot create maintenance requests. Contact your property manager.' });
    return;
  }

  // A tenant may only file a request as themselves, against their own unit —
  // tenantId/unitId previously came straight from the client body with no
  // verification, so a tenant could submit a request attributed to someone
  // else's tenantId/unitId. Force both from their own record server-side.
  if (req.user?.role === 'tenant') {
    const userId = String(req.user.id ?? req.user.userId ?? '');
    const [own] = await db
      .select({ id: tenants.id, unitId: tenants.unitId })
      .from(tenants)
      .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, req.user.organizationId)))
      .limit(1);
    if (!own || !own.unitId) {
      return res.status(403).json({ message: 'Tenant profile not found or not linked to a unit.' });
    }
    req.body.tenantId = own.id;
    req.body.unitId   = own.unitId;
  }

  // Delegate to the CRUD router by calling next() — this runs the actual insert.
  // We intercept the response to send the WhatsApp after the DB write.
  // Technique: wrap res.json to capture the created object.
  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    // After CRUD router sends 201, auto-create a work order and fire WhatsApp notification (non-blocking)
    if (res.statusCode === 201 && body?.id) {
      const createdByUserId = String((req as any).user?.userId ?? (req as any).user?.id ?? '');
      autoCreateWorkOrder(body, createdByUserId);
      if (body.tenantId) {
        notifyTenant(body.tenantId, {
          type:         'maintenance_opened',
          ticketNumber: body.ticketNumber ?? `#${body.id}`,
          title:        body.title ?? 'Maintenance Request',
        }).catch(err => console.warn('[maintenance] opened WhatsApp failed:', err));
      }
    }
    return origJson(body);
  };
  next();
});

export {
  maintenanceListRouter, maintenanceRouter, contractorRouter,
  projectRouter, projectTaskRouter, projectMilestoneRouter 
};