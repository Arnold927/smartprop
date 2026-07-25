/**
 * requireRole.ts
 *
 * Role-based access control for the API layer.
 *
 * Design: one `ROUTE_POLICY` map in this file drives everything.
 * Each entry maps an API path prefix to the set of roles that may
 * call ANY method on that prefix. The middleware is then applied
 * centrally in routes/index.ts via app.use(), so individual route
 * files need zero changes.
 *
 * Role hierarchy (most → least privileged):
 *   admin      → full access to everything
 *   manager    → full access except a few admin-only endpoints
 *   landlord   → their portfolio + finance; no staff/HR/admin data
 *   staff      → operational: maintenance, security, utilities, messages
 *   caretaker  → property-scoped: maintenance requests, visitor log, guard check-in ONLY
 *                (filtered to their assigned property via caretakers.propertyId)
 *   tenant     → their own record, maintenance, messages, documents
 *   guard      → gate check-in, visitor log only
 *
 * Public routes (no JWT required) are excluded from this middleware
 * at the call sites in index.ts.
 */

import { Request, Response, NextFunction } from 'express';

export type AppRole = 'admin' | 'manager' | 'landlord' | 'staff' | 'caretaker' | 'tenant' | 'guard' | 'contractor';

const ADMIN_MANAGER:           AppRole[] = ['admin', 'manager'];
const ADMIN_MANAGER_LANDLORD:  AppRole[] = ['admin', 'manager', 'landlord'];
const ADMIN_MANAGER_STAFF:     AppRole[] = ['admin', 'manager', 'staff'];
const ADMIN_MANAGER_LANDLORD_STAFF: AppRole[] = ['admin', 'manager', 'landlord', 'staff'];
const ALL_AUTHENTICATED:       AppRole[] = ['admin', 'manager', 'landlord', 'staff', 'caretaker', 'tenant', 'guard', 'contractor'];
const TENANT_AND_ABOVE:        AppRole[] = ['admin', 'manager', 'landlord', 'staff', 'caretaker', 'tenant', 'contractor'];
const STAFF_AND_ABOVE:         AppRole[] = ['admin', 'manager', 'landlord', 'staff'];

// Caretaker-allowed routes (property-scoped; routes enforce scope via req.user.role check)
const CARETAKER_ALLOWED:       AppRole[] = ['admin', 'manager', 'staff', 'caretaker', 'landlord'];

// Visitor access creation — staff excluded deliberately.
// Only managers, admins, and caretakers (on-site) should create gate access codes.
// Tenants use their own portal flow; staff are back-office and shouldn't control gate access.
const VISITOR_ACCESS_ALLOWED:  AppRole[] = ['admin', 'manager', 'caretaker', 'landlord'];

/**
 * Maps every /api/* prefix to the roles permitted to call it.
 * Matching is prefix-based: '/api/tenants' covers /api/tenants,
 * /api/tenants/42, /api/tenants/42/payments, etc.
 *
 * Order matters for overlapping prefixes — more specific entries
 * must come before less specific ones (same as Express routing).
 */
export const ROUTE_POLICY: Record<string, AppRole[]> = {

  // ── Public / self-contained auth (excluded at call site — listed here for docs) ──
  // /api/auth            → no JWT, public
  // /api/gate-auth       → PIN-based JWT, handled by its own guard middleware
  // /api/health          → public
  // /api/mpesa/callback       → Safaricom webhook, no JWT
  // /api/mpesa/c2b/*          → Safaricom webhook, no JWT

  // ── Admin / manager only ─────────────────────────────────────────────────────
  '/api/roles':                      ADMIN_MANAGER,
  '/api/users':                      ADMIN_MANAGER,
  '/api/organizations':              ADMIN_MANAGER,           // org settings & multi-tenant admin
  '/api/billing':                    ADMIN_MANAGER,
  '/api/billing-cycles':             ADMIN_MANAGER,
  '/api/reports':                    ADMIN_MANAGER,
  '/api/report-schedule':            ADMIN_MANAGER,           // automated report scheduler
  '/api/broadcast-messages':         ADMIN_MANAGER,
  '/api/organization-management':    ADMIN_MANAGER,
  '/api/purchase-requisitions':      ADMIN_MANAGER,
  '/api/expense-reports':            ADMIN_MANAGER,
  '/api/payroll':                    ADMIN_MANAGER,
  '/api/general-ledger':             ADMIN_MANAGER,
  '/api/journal-entries':            ADMIN_MANAGER,           // double-entry GL journal & reports
  '/api/bank-reconciliation':        ADMIN_MANAGER,           // bank statement reconciliation
  '/api/chart-of-accounts':          ADMIN_MANAGER,
  '/api/cost-centers':               ADMIN_MANAGER,
  '/api/import':                     ADMIN_MANAGER,           // bulk data import — admin/manager only
  '/api/ai':                         ADMIN_MANAGER,           // AI proxy — restrict to privileged roles
  '/api/arrears':                    ADMIN_MANAGER,
  '/api/arrears-actions':            ADMIN_MANAGER,
  '/api/payment-reminders':          ADMIN_MANAGER,
  '/api/risk-assessments':           ADMIN_MANAGER,
  '/api/tenant-behavior-logs':       ADMIN_MANAGER,
  '/api/whatsapp':                   ADMIN_MANAGER,
  '/api/rent-to-own-agreements':     ADMIN_MANAGER,
  '/api/rent-to-own-payments':       ADMIN_MANAGER,
  '/api/ownership-certificates':     ADMIN_MANAGER,
  '/api/property-management-agreements': ADMIN_MANAGER,
  '/api/diaspora-contracts':         ADMIN_MANAGER,
  '/api/diaspora-payments':          ADMIN_MANAGER,
  '/api/construction-updates':       ADMIN_MANAGER,
  '/api/diaspora-certificates':      ADMIN_MANAGER,
  '/api/dashboard':                  ADMIN_MANAGER,
  '/api/gate-pins':                  ADMIN_MANAGER,

  // ── Admin / manager / landlord ───────────────────────────────────────────────
  '/api/landlord-portal':            ADMIN_MANAGER_LANDLORD,
  '/api/property-expenses':          ADMIN_MANAGER_LANDLORD,
  '/api/analytics':                  ADMIN_MANAGER_LANDLORD,  // portfolio analytics & KPIs
  '/api/etims':                      ADMIN_MANAGER_LANDLORD,  // KRA eTIMS e-invoicing
  '/api/title-verification':         ADMIN_MANAGER_LANDLORD,  // land title / Ardhisasa checks

  // ── Admin / manager / staff (operational) ────────────────────────────────────
  '/api/contractors/registry':       ADMIN_MANAGER_STAFF,
  '/api/contractors':                ADMIN_MANAGER_STAFF,
  '/api/contractor-categories':      ADMIN_MANAGER_STAFF,
  '/api/service-contracts':          ['admin', 'manager', 'landlord', 'staff'],  // landlords view contracts on their properties
  '/api/work-orders':                ADMIN_MANAGER_STAFF,
  '/api/projects':                   ADMIN_MANAGER_STAFF,
  '/api/project-tasks':              ADMIN_MANAGER_STAFF,
  '/api/project-milestones':         ADMIN_MANAGER_STAFF,
  '/api/staff-members':              ADMIN_MANAGER_STAFF,
  '/api/caretakers':                 ADMIN_MANAGER,         // assign caretakers to properties
  '/api/compliance':                 ADMIN_MANAGER_LANDLORD, // compliance module (ARMA/KRA/stamp duty/valuations)
  '/api/regulatory-certificates':    ADMIN_MANAGER_LANDLORD, // NEMA/NCA/County regulatory certificates
  '/api/sustainability':             ADMIN_MANAGER_STAFF,    // ESG metrics and reporting
  '/api/owner-statements':           ADMIN_MANAGER_LANDLORD, // PM remittance statements & rent roll
  '/api/inspections':                ADMIN_MANAGER_STAFF,    // property condition inspections (staff conduct them)
  // Tenants can view and sign their own inspections (separate policy — enforced in the route handler)
  '/api/inspections/sign-tenant':    TENANT_AND_ABOVE,
  '/api/prospects':                  ADMIN_MANAGER_STAFF,    // letting pipeline
  '/api/time-tracking':              ADMIN_MANAGER_STAFF,
  '/api/visitor-access-management':  VISITOR_ACCESS_ALLOWED,
  '/api/security':                   ADMIN_MANAGER_STAFF,
  '/api/parking-spaces':             ADMIN_MANAGER_STAFF,
  '/api/registered-vehicles':        ADMIN_MANAGER_STAFF,
  '/api/parking-assignments':        ADMIN_MANAGER_STAFF,
  '/api/utility-providers':          ADMIN_MANAGER_STAFF,
  '/api/utility-accounts':           ADMIN_MANAGER_STAFF,
  '/api/utility-bills':              [...ADMIN_MANAGER_STAFF, 'landlord'],
  '/api/utility-meter-readings':     ADMIN_MANAGER_STAFF,
  '/api/recurring-charges':          ADMIN_MANAGER_STAFF,
  '/api/upload':                     ADMIN_MANAGER_STAFF,
  '/api/tenant-onboarding':          ADMIN_MANAGER_STAFF,

  // ── Staff and above (operational + landlord) ──────────────────────────────────
  '/api/leases':                     ADMIN_MANAGER_LANDLORD,  // landlords need their own leases for compliance (RRT, deposit interest, stamp duty)
  '/api/exchange-rates':             STAFF_AND_ABOVE,
  '/api/properties':                 STAFF_AND_ABOVE,
  '/api/units':                      STAFF_AND_ABOVE,
  // '/api/tenants/me' is intentionally NOT a separate mount prefix — the mount()
  // helper in routes/index.ts uses '/api/tenants' as the roleGuard prefix for the
  // entire tenantRouter (including the /me sub-route).  A separate '/api/tenants/me'
  // entry here would never be evaluated and would give a false sense of security.
  // Instead we include 'tenant' here so tenants can reach GET /api/tenants/me.
  // The /me handler itself enforces that a tenant only sees their own record.
  '/api/tenants':                    [...STAFF_AND_ABOVE, 'tenant'],
  '/api/rent-payments':              STAFF_AND_ABOVE,
  '/api/invoices':                   STAFF_AND_ABOVE,
  '/api/mpesa-transactions':         STAFF_AND_ABOVE,
  '/api/payment-config':             STAFF_AND_ABOVE,
  // Tenants can submit and view their own maintenance requests.
  // The route handler scopes results to the tenant's own records.
  '/api/maintenance-requests':       [...CARETAKER_ALLOWED, 'tenant'],
  '/api/visitors':                   CARETAKER_ALLOWED,

  // ── Guard / Caretaker ─────────────────────────────────────────────────────────
  '/api/guard':                      ['admin', 'manager', 'staff', 'caretaker', 'guard'],
  '/api/contractor-portal':          ['contractor', 'admin', 'manager'],
  '/api/guest-checkin':              ['admin', 'manager', 'staff', 'caretaker', 'guard'],

  // ── Tenant and above (all authenticated users) ────────────────────────────────
  '/api/diaspora-portal':            ALL_AUTHENTICATED,  // buyer-scoped; server filters by buyerUserId
  '/api/messages':                   TENANT_AND_ABOVE,
  '/api/documents':                  TENANT_AND_ABOVE,
  '/api/notifications':              ALL_AUTHENTICATED,
  '/api/mpesa':                      ['admin', 'manager', 'staff', 'caretaker', 'tenant', 'contractor'],   // STK push, status poll — landlords excluded (cannot initiate payments to tenants)
  '/api/tenant':                     TENANT_AND_ABOVE,   // /api/tenant/invite-visitor, /api/tenant/my-visitors
  '/api/tenant-short-rentals':       TENANT_AND_ABOVE,
  '/api/short-term-bookings':        TENANT_AND_ABOVE,
  '/api/ratings':                    TENANT_AND_ABOVE,
};

/**
 * Build a single Express middleware for a specific route prefix.
 *
 * Usage in index.ts:
 *   app.use('/api/tenants', roleGuard('/api/tenants'), tenantRouter);
 */
export function roleGuard(prefix: string) {
  const allowed = ROUTE_POLICY[prefix];

  if (!allowed) {
    // No policy defined — fail closed (deny everything).
    // This means adding a new route group without a policy entry is safe-by-default.
    return (_req: Request, res: Response, _next: NextFunction) => {
      res.status(403).json({
        message: `No access policy defined for ${prefix}. Contact the system administrator.`,
      });
    };
  }

  const allowedSet = new Set(allowed);

  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      // Should have been caught by authenticateJWT already, but be explicit.
      return res.status(401).json({ message: 'Authentication required' });
    }

    const role = (user.role ?? 'tenant') as string;

    if (!allowedSet.has(role as AppRole)) {
      return res.status(403).json({
        message: `Your role (${role}) does not have access to this resource.`,
        requiredRoles: allowed,
      });
    }

    next();
  };
}

/**
 * Convenience: apply roleGuard for every prefix defined in ROUTE_POLICY.
 * Called once in registerModularRoutes() before any app.use() calls.
 *
 * app.use(prefix, applyRoleGuards()) won't work — instead this returns
 * a map of { prefix → middleware } that index.ts uses explicitly.
 */
export function buildRoleGuards(): Record<string, ReturnType<typeof roleGuard>> {
  const guards: Record<string, ReturnType<typeof roleGuard>> = {};
  for (const prefix of Object.keys(ROUTE_POLICY)) {
    guards[prefix] = roleGuard(prefix);
  }
  return guards;
}