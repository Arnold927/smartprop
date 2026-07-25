import { Express } from "express";
import authRouter from "./auth";
import usersRouter from "./users";
import dashboardRouter from "./dashboard";
import landlordPortalRouter from "./landlord-portal";
import organizationsRouter from "./organizations";
import aiProxyRouter from "./ai-proxy";
import { propertyRouter, unitRouter, expenseRouter, visitorRouter } from "./properties";
import unitVacancyGuardRouter from "./unit-vacancy-guard";
import propertiesListRouter from "./properties-list";
import { tenantRouter, paymentRouter, invoiceRouter, mpesaRouter } from "./tenants";
import {
  maintenanceListRouter,
  maintenanceRouter,
  contractorRouter,
  projectRouter,
  projectTaskRouter,
  projectMilestoneRouter,
} from "./maintenance";
import maintenanceActionsRouter from "./maintenance-actions";
import paymentActionsRouter from "./payment-actions";
import documentsRouter from "./documents";
import workOrdersRouter from "./work-orders";
import arrearsRouter from "./arrears";
import arrearsActionsRouter, { paymentRemindersRouter, riskAssessmentsRouter, tenantBehaviorLogsRouter } from "./arrears-actions";
import timeTrackingRouter from "./time-tracking";
import staffMembersRouter from "./staff-members";
import notificationsRouter from "./notifications";
import messagesRouter from "./messages";
import broadcastMessagesRouter from "./broadcast-messages";
import reportsRouter from "./reports";
import whatsappRouter from "./whatsapp";
import uploadRouter from "./upload";
import mpesaActionsRouter from "./mpesa-actions";
import {
  contractorCategoriesRouter,
  serviceContractsRouter,
  contractorVerifyRouter,
  contractorRegistryListRouter,
  contractorCreateHookRouter,
} from "./contractors-extended";
import { broadcastToOrg } from "../ws";
import { authenticateJWT } from "../middleware/auth";
import { auditLog } from "../middleware/auditLog";
import billingRouter from "./billing";
import {
  utilityProvidersRouter,
  utilityAccountsRouter,
  utilityBillsRouter,
  recurringChargesRouter,
  billingCyclesRouter,
  generateInvoicesRouter,
} from "./utility-management";
import { utilityBillSenderRouter } from "./utility-bill-sender";
import utilityMeterReadingsRouter from "./utility-meter-readings";
import { paymentConfigRouter } from "./payment-config";
import { parkingSpacesRouter, registeredVehiclesRouter, parkingAssignmentsRouter } from "./parking";
import visitorAccessManagementRouter from "./visitor-access-management";
import securityRouter from "./security";
import { tenantVisitorRouter, guestCheckinRouter } from "./tenant-visitor";
import { gatePinsRouter, gateAuthRouter } from "./gate-pins";
import contractorPortalRouter from "./contractor-portal";
import { reportScheduleRouter } from "./report-schedule";
import { titleVerificationRouter } from "./title-verification";
import { regulatoryCertsRouter } from "./regulatory-certificates";
import { securityHardwareRouter } from "./security-hardware";
import guardFeaturesRouter from "./guard-features";
import tenantOnboardingRouter from "./tenant-onboarding";
import { tenantShortRentalsRouter, shortTermBookingsRouter } from "./tenant-subletting";
import {
  rentToOwnAgreementsRouter,
  rentToOwnPaymentsRouter,
  ownershipCertificatesRouter,
  propertyManagementAgreementsRouter,
} from "./rent-to-own";
import {
  diasporaContractsRouter,
  diasporaPaymentsRouter,
  constructionUpdatesRouter,
  diasporaCertificatesRouter,
} from "./diaspora";
import {
  purchaseRequisitionsRouter,
  expenseReportsRouter,
  payrollRouter,
  generalLedgerRouter,
  chartOfAccountsRouter,
  costCentersRouter,
} from "./enterprise-finance-routes";
import { roleGuard } from "../middleware/requireRole";
import leasesRouter  from "./leases";
import bankReconciliationRouter from "./bank-reconciliation";
import exchangeRatesRouter from "./exchange-rates";
import importRouter from "./import";
import caretakersRouter from "./caretakers";
import diasporaBuyerPortalRouter from "./diaspora-portal";
import nairobiComplianceRouter from "./nairobi-compliance";
import sustainabilityRouter    from "./sustainability";
import ownerStatementsRouter   from "./owner-statements";
import inspectionsRouter       from "./inspections";
import prospectsRouter         from "./prospects";
import analyticsRouter         from "./analytics";
import ratingsRouter           from "./ratings";
import rolesRouter from "./roles";
import journalEntriesRouter     from "./journal-entries";
import etimsRouter               from "./etims";

// ─── mount() helper ───────────────────────────────────────────────────────────
//
// Applies the middleware stack:
//   authenticateJWT → roleGuard(prefix) → router
//
// authenticateJWT is applied first so that req.user is populated before
// roleGuard reads req.user.role. The individual routers also call
// authenticateJWT internally — that second call is a no-op because the
// JWT is already verified and req.user is already set.
//
// Public routes are mounted with app.use() directly (no stack injected).
//
function mount(app: Express, prefix: string, router: any): void {
  app.use(
    prefix,
    authenticateJWT as any,   // 1. verify JWT, populate req.user
    roleGuard(prefix) as any, // 2. check req.user.role against ROUTE_POLICY
    router,                   // 3. run the actual route handler
  );
}

export function registerModularRoutes(app: Express) {

  // ── Public endpoints (no JWT, no role check) ──────────────────────────────
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  );

  // Auth (login, signup, refresh, forgot-password, invite, activate)
  app.use("/api/auth", authRouter);

  // Public prospect application form — tenants submit without a login
  app.post("/api/prospects/apply", (req: any, res: any, next: any) => prospectsRouter(req, res, next));

  // Gate guard PIN login — its own short-lived JWT, not the main app JWT
  app.use("/api/gate-auth", gateAuthRouter);

  // Safaricom M-Pesa webhooks — no JWT. Safaricom sends no Authorization header.
  // Security: validate via payload structure; lock down by IP at the network/proxy layer.
  app.post("/api/mpesa/callback",         (req, res, next) => mpesaActionsRouter(req, res, next));
  app.post("/api/mpesa/c2b/confirmation", (req, res, next) => mpesaActionsRouter(req, res, next));
  app.post("/api/mpesa/c2b/validation",  (req, res, next) => mpesaActionsRouter(req, res, next));

  // Payment config public read (tenant portal reads M-Pesa paybill # before auth completes)
  app.get("/api/payment-config/public",  (req, res, next) => paymentConfigRouter(req, res, next));

  // ── Role-guarded endpoints ────────────────────────────────────────────────
  // Every mount() call below enforces: authenticate → role check → handler.
  // Allowed roles per prefix are defined in middleware/requireRole.ts ROUTE_POLICY.
  // A prefix missing from ROUTE_POLICY will receive 403 for all requests (fail-closed).

  // Admin / manager only
  mount(app, "/api/billing",                           billingRouter);
  mount(app, "/api/billing",                           generateInvoicesRouter);
  mount(app, "/api/billing-cycles",                    billingCyclesRouter);
  mount(app, "/api/roles",                             rolesRouter);
  mount(app, "/api/users",                             usersRouter);
  mount(app, "/api/organizations",                     organizationsRouter);
  mount(app, "/api/ai",                                aiProxyRouter);
  mount(app, "/api/dashboard",                         dashboardRouter);
  mount(app, "/api/reports",                           reportsRouter);
  mount(app, "/api/broadcast-messages",                broadcastMessagesRouter);
  mount(app, "/api/arrears",                           arrearsRouter);
  mount(app, "/api/arrears-actions",                   arrearsActionsRouter);
  mount(app, "/api/payment-reminders",                 paymentRemindersRouter);
  mount(app, "/api/risk-assessments",                  riskAssessmentsRouter);
  mount(app, "/api/tenant-behavior-logs",              tenantBehaviorLogsRouter);
  mount(app, "/api/whatsapp",                          whatsappRouter);
  mount(app, "/api/gate-pins",                         gatePinsRouter);
  mount(app, "/api/purchase-requisitions",             purchaseRequisitionsRouter);
  mount(app, "/api/expense-reports",                   expenseReportsRouter);
  mount(app, "/api/payroll",                           payrollRouter);
  mount(app, "/api/general-ledger",                    generalLedgerRouter);
  mount(app, "/api/chart-of-accounts",                 chartOfAccountsRouter);
  mount(app, "/api/cost-centers",                      costCentersRouter);
  mount(app, "/api/rent-to-own-agreements",            rentToOwnAgreementsRouter);
  mount(app, "/api/rent-to-own-payments",              rentToOwnPaymentsRouter);
  mount(app, "/api/ownership-certificates",            ownershipCertificatesRouter);
  mount(app, "/api/property-management-agreements",    propertyManagementAgreementsRouter);
  mount(app, "/api/diaspora-contracts",                diasporaContractsRouter);
  mount(app, "/api/diaspora-payments",                 diasporaPaymentsRouter);
  mount(app, "/api/construction-updates",              constructionUpdatesRouter);
  mount(app, "/api/diaspora-certificates",             diasporaCertificatesRouter);

  // Admin / manager / landlord
  mount(app, "/api/landlord-portal",                   landlordPortalRouter);
  mount(app, "/api/property-expenses",                 expenseRouter);

  // Admin / manager / staff (operational)
  mount(app, "/api/contractor-categories",             contractorCategoriesRouter);
  mount(app, "/api/contractor-portal",                 contractorPortalRouter);
  mount(app, "/api/report-schedule",                   reportScheduleRouter);
  mount(app, "/api/title-verification",                titleVerificationRouter);
  mount(app, "/api/regulatory-certificates",           regulatoryCertsRouter);
  // Security hardware webhook — public endpoint (HMAC auth) + config endpoints (JWT auth)
  mount(app, "/api/security",                          securityHardwareRouter);
  mount(app, "/api/service-contracts",                 serviceContractsRouter);
  mount(app, "/api/contractors/registry",              contractorRegistryListRouter);
  mount(app, "/api/contractors",                       contractorCreateHookRouter);
  mount(app, "/api/contractors",                       contractorRouter);
  mount(app, "/api/contractors",                       contractorVerifyRouter);
  mount(app, "/api/work-orders",                       workOrdersRouter);
  mount(app, "/api/projects",                          projectRouter);
  mount(app, "/api/project-tasks",                     projectTaskRouter);
  mount(app, "/api/project-milestones",                projectMilestoneRouter);
  mount(app, "/api/staff-members",                     staffMembersRouter);
  mount(app, "/api/caretakers",                        caretakersRouter);
  mount(app, "/api/analytics",                         analyticsRouter);
  mount(app, "/api/journal-entries",                   journalEntriesRouter);
  mount(app, "/api/etims",                             etimsRouter);
  mount(app, "/api/compliance",                        nairobiComplianceRouter);
  mount(app, "/api/sustainability",                    sustainabilityRouter);
  mount(app, "/api/owner-statements",                  ownerStatementsRouter);
  mount(app, "/api/inspections",                       inspectionsRouter);
  mount(app, "/api/prospects",                         prospectsRouter);
  mount(app, "/api/time-tracking",                     timeTrackingRouter);
  mount(app, "/api/visitor-access-management",         visitorAccessManagementRouter);
  mount(app, "/api/security",                          securityRouter);
  mount(app, "/api/parking-spaces",                    parkingSpacesRouter);
  mount(app, "/api/registered-vehicles",               registeredVehiclesRouter);
  mount(app, "/api/parking-assignments",               parkingAssignmentsRouter);
  mount(app, "/api/utility-providers",                 utilityProvidersRouter);
  mount(app, "/api/utility-accounts",                  utilityAccountsRouter);
  mount(app, "/api/utility-bills",                     utilityBillSenderRouter);
  mount(app, "/api/utility-bills",                     utilityBillsRouter);
  mount(app, "/api/utility-meter-readings",             utilityMeterReadingsRouter);
  mount(app, "/api/recurring-charges",                 recurringChargesRouter);
  mount(app, "/api/upload",                            uploadRouter);
  mount(app, "/api/tenant-onboarding",                 tenantOnboardingRouter);

  // Staff and above (includes landlords)
  mount(app, "/api/import",                            importRouter);
  mount(app, "/api/leases",                            leasesRouter);
  mount(app, "/api/exchange-rates",                    exchangeRatesRouter);  
  mount(app, "/api/properties",                        propertiesListRouter);  // enriched GET / (must be before propertyRouter)
  mount(app, "/api/properties",                        propertyRouter);
  mount(app, "/api/units",                             unitVacancyGuardRouter);  // PATCH /:id ownership + tenant-safety check (must be before unitRouter)
  mount(app, "/api/units",                             unitRouter);
  mount(app, "/api/visitors",                          visitorRouter);
  mount(app, "/api/tenants",                           tenantRouter);
  mount(app, "/api/bank-reconciliation",               bankReconciliationRouter);
  mount(app, "/api/rent-payments",                     paymentActionsRouter);
  mount(app, "/api/rent-payments",                     paymentRouter);
  mount(app, "/api/invoices",                          invoiceRouter);
  mount(app, "/api/mpesa-transactions",                mpesaRouter);
  mount(app, "/api/maintenance-requests",              maintenanceListRouter);
  mount(app, "/api/maintenance-requests",              maintenanceRouter);
  mount(app, "/api/maintenance-requests",              maintenanceActionsRouter);
  mount(app, "/api/payment-config",                    paymentConfigRouter);

  // Guard station (guards + staff + managers)
  mount(app, "/api/guard",                             guardFeaturesRouter);
  mount(app, "/api/guest-checkin",                     guestCheckinRouter);

  // Tenant and above (all authenticated users)
  mount(app, "/api/diaspora-portal",                   diasporaBuyerPortalRouter);
  mount(app, "/api/messages",                          messagesRouter);
  mount(app, "/api/documents",                         documentsRouter);
  mount(app, "/api/notifications",                     notificationsRouter);
  mount(app, "/api/mpesa",                             mpesaActionsRouter);
  mount(app, "/api/tenant",                            tenantVisitorRouter);
  mount(app, "/api/tenant-short-rentals",              tenantShortRentalsRouter);
  mount(app, "/api/short-term-bookings",               shortTermBookingsRouter);
  mount(app, "/api/ratings",                           ratingsRouter);

  // ── Admin broadcast (WebSocket push to all org members) ──────────────────
  app.post(
    "/api/admin/broadcast",
    authenticateJWT as any,
    roleGuard("/api/broadcast-messages") as any,   // reuse admin/manager policy
    auditLog("broadcast", "ACTION") as any,
    (req: any, res: any) => {
      const { message, meta } = req.body ?? {};
      if (!message?.trim()) {
        return res.status(400).json({ message: "message is required" });
      }
      broadcastToOrg(req.user.organizationId, message.trim(), meta ?? {});
      res.json({ success: true });
    }
  );
}