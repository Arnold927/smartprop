/**
 * App.tsx — code-split, role-aware routing
 *
 * Every page uses React.lazy() so Vite emits a separate chunk per page.
 * A user loading the dashboard never downloads billing.tsx, landlord-portal.tsx,
 * or any other page they haven't navigated to yet.
 *
 * Chunk groups (vite.config.ts manualChunks) keep related pages together so
 * a navigation within a section (e.g. Tenants → Tenant detail) doesn't need
 * a separate network round-trip.
 *
 * Keep-eager (no lazy):
 *   - Shell components: Sidebar, MobileHeader, TopBar, MobileBottomNav
 *   - Auth pages: login, forgot-password, reset-password, verify-email
 *   - Landing page (first thing unauthenticated users see)
 *   - NotFound, ProtectedRoute, WhatsAppWidget
 *   - GatePortal (guards log in here without the main app JWT)
 */

import React, { lazy, Suspense, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { DarkModeProvider }     from "@/context/DarkModeContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { QueryClientProvider }  from "@tanstack/react-query";
import { useWsQuerySync }       from "@/hooks/useWebSocket";
import { Toaster }              from "@/components/ui/toaster";
import { TooltipProvider }      from "@/components/ui/tooltip";
import { useAuth }              from "@/hooks/useAuth";
import ProtectedRoute           from "@/components/ProtectedRoute";
import { getHomeForRole }       from "@/lib/roleNav";

// ── Always-eager shell & auth ─────────────────────────────────────────────────
import Sidebar          from "@/components/layout/sidebar";
import MobileHeader     from "@/components/layout/mobile-header";
import TopBar           from "@/components/layout/top-bar";
import MobileBottomNav  from "@/components/layout/mobile-bottom";
import WhatsAppWidget   from "@/components/ui/whatsapp-widget"; // kept for future use
import NotFound         from "@/pages/not-found";
import PayPropLanding   from "@/pages/payprop-landing";
import StaysBrowsePage  from "@/pages/public/stays-browse";
import StayDetailPage   from "@/pages/public/stay-detail";
import AuthPage         from "@/pages/auth/login";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import ResetPasswordPage  from "@/pages/auth/reset-password";
import VerifyEmailPage    from "@/pages/auth/verify-email";
import AcceptInvitePage   from "@/pages/auth/accept-invite";
import GatePortal         from "@/pages/gate-portal";  // guard PIN login — no main JWT

// ── Lazy pages grouped by feature domain ────────────────────────────────────
// Vite emits one chunk per lazy() call but manualChunks in vite.config.ts
// can merge related pages into a shared chunk (see vite.config.ts).

// Core
const DashboardClean    = lazy(() => import("@/pages/dashboard-clean"));
const Pricing           = lazy(() => import("@/pages/pricing"));

// Role portals — each role only ever loads their own portal
const TenantPortal      = lazy(() => import("@/pages/tenant-portal"));
const LandlordPortal    = lazy(() => import("@/pages/landlord-portal"));
const StaffPortal       = lazy(() => import("@/pages/staff-portal"));
const GuardCheckin      = lazy(() => import("@/pages/guard-checkin"));
const ContractorPortal  = lazy(() => import("@/pages/contractor-portal"));

// Properties
const Properties        = lazy(() => import("@/pages/properties"));
const PropertyDetails   = lazy(() => import("@/pages/property-details"));

// Role sub-dashboards (deep links from Reports)
const SeniorManagerDashboard  = lazy(() => import("@/pages/senior-manager-dashboard"));
const PropertyManagerDashboard= lazy(() => import("@/pages/property-manager-dashboard"));
const FinanceDashboard        = lazy(() => import("@/pages/finance-dashboard"));
const MaintenanceDashboard    = lazy(() => import("@/pages/maintenance-dashboard"));

// Tenants
const Tenants           = lazy(() => import("@/pages/tenants"));
const TenantDetails     = lazy(() => import("@/pages/tenants/[id]"));
const TenantCRM         = lazy(() => import("@/pages/tenant-crm"));
const TenantOnboarding  = lazy(() => import("@/pages/tenant-onboarding"));
const TenantSubletting  = lazy(() => import("@/pages/tenant-subletting"));
const RentCollection    = lazy(() => import("@/pages/rent-collection"));
const BankReconciliation = lazy(() => import("@/pages/bank-reconciliation"));
const Leases            = lazy(() => import("@/pages/leases"));

// Finance
const Finances          = lazy(() => import("@/pages/finances"));
const EnterpriseFinance = lazy(() => import("@/pages/enterprise-finance"));
const Billing           = lazy(() => import("@/pages/billing"));
const SubscriptionBilling = lazy(() => import("@/pages/billing/BillingPage"));
const Arrears           = lazy(() => import("@/pages/arrears"));
const ExpenseManagement = lazy(() => import("@/pages/expense-management"));
const RentToOwn         = lazy(() => import("@/pages/rent-to-own"));
const DiasporaRentToOwn       = lazy(() => import("@/pages/diaspora-rent-to-own"));
const DiasporaContractDetail  = lazy(() => import("@/pages/diaspora-contract-detail"));
const DiasporaBuyerPortal = lazy(() => import("@/pages/diaspora-portal"));
const NairobiCompliance   = lazy(() => import("@/pages/compliance"));
const UtilityManagement = lazy(() => import("@/pages/utility-management"));
const Utilities         = lazy(() => import("@/pages/utilities"));
const UtilityBillSenderPage = lazy(() => import("@/pages/utility-bill-sender-page"));
const PaymentSetupPage      = lazy(() => import("@/pages/payment-setup"));
const ExternalLandlordsPage = lazy(() => import("@/pages/external-landlords"));
const PlatformOrganizationsPage = lazy(() => import("@/pages/platform-organizations"));
const CaretakersPage = lazy(() => import("@/pages/caretakers"));
const CaretakerPortalPage = lazy(() => import("@/pages/caretaker-portal"));

// Maintenance
const Maintenance        = lazy(() => import("@/pages/maintenance"));
const MaintenanceDetails = lazy(() => import("@/pages/maintenance/[id]"));
const Contractors        = lazy(() => import("@/pages/contractors"));
const ContractorDetailsPage = lazy(() => import("@/pages/contractor-details"));
const WorkOrderDetailsPage  = lazy(() => import("@/pages/work-order-details"));
const ConstructionProjectManagement = lazy(() => import("@/pages/construction-project-management"));

// Security & operations
const Security           = lazy(() => import("@/pages/security"));
const VisitorManagement  = lazy(() => import("@/pages/visitor-management"));
const ParkingManagement  = lazy(() => import("@/pages/parking-management"));
const SecurityOperations = lazy(() => import("@/pages/security-operations"));

// Staff & HR
const StaffDetailsPage   = lazy(() => import("@/pages/staff/[id]"));
const WorkforceManagement= lazy(() => import("@/pages/workforce-management"));
const UserManagement     = lazy(() => import("@/pages/user-management"));
const EnhancedServiceProviders = lazy(() => import("@/pages/enhanced-service-providers"));

// Communications
const Messages           = lazy(() => import("@/pages/messages"));
const BroadcastMessaging = lazy(() => import("@/pages/broadcast-messaging"));
const MarketingHub       = lazy(() => import("@/pages/marketing-hub"));
const WhatsAppIntegration= lazy(() => import("@/pages/whatsapp-integration"));
const CitizenReporting   = lazy(() => import("@/pages/citizen-reporting"));

// Reports & admin
const Reports            = lazy(() => import("@/pages/reports"));
const AIAnalytics        = lazy(() => import("@/pages/ai-analytics"));
const FacilityManagement = lazy(() => import("@/pages/facility-management"));
const SustainabilityESG  = lazy(() => import("@/pages/sustainability-esg"));
const OrganizationOnboarding = lazy(() => import("@/pages/organization-onboarding"));
const GeneralLedgerPage = lazy(() => import("@/pages/general-ledger"));
const ProfilePage        = lazy(() => import("@/pages/profile"));
const QuickSetup             = lazy(() => import("@/pages/quick-setup"));
const OrganizationManagement = lazy(() => import("@/pages/organization-management"));
const Projects           = lazy(() => import("@/pages/projects"));
const Documents          = lazy(() => import("@/pages/documents"));
const OwnerStatements    = lazy(() => import("@/pages/owner-statements"));
const Inspections        = lazy(() => import("@/pages/inspections"));
const ProspectsPage      = lazy(() => import("@/pages/prospects"));

// ── Page-load skeleton (shown during lazy chunk fetch) ────────────────────────
// Keeps the shell (sidebar, header) visible while the page JS downloads.
function PageSkeleton() {
  return (
    <div className="flex-1 p-6 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded-lg" />
      <div className="h-4 w-72 bg-muted/60 rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-muted rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-xl mt-4" />
    </div>
  );
}

// ── Lazy wrapper: ProtectedRoute + Suspense in one ────────────────────────────
function P({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Suspense fallback={<PageSkeleton />}>
        {children}
      </Suspense>
    </ProtectedRoute>
  );
}

// ── Tenant portal wrapper (resolves tenantId via /api/tenants/me) ─────────────
// Uses a dedicated self-lookup endpoint that:
//   1. Is accessible to the "tenant" role (STAFF_AND_ABOVE blocks the list endpoint)
//   2. Matches by userId first, email second (backfills userId if missing)
//   3. Returns a single object, not a paginated list
function TenantPortalWrapper({ user }: { user: any }) {
  // ── Role guard ────────────────────────────────────────────────────────────────
  // Client-side defence-in-depth: only the "tenant" role may render this wrapper.
  // The server already blocks non-tenant roles on every API call, but this prevents
  // non-tenant users who navigate to /tenant-portal from even mounting the component.
  // getHomeForRole is already imported statically at the top of App.tsx
  if (user && user.role !== "tenant") {
    // Redirect them silently to their own home rather than showing a 403 screen.
    window.location.replace(getHomeForRole(user.role));
    return null;
  }

  // Both queries run unconditionally (React hooks rule — no conditional hooks).
  // The diaspora query is enabled only when the tenant query has failed/returned empty.
  const { data: myTenant, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/tenants/me"],
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const res = await apiRequest("/api/tenants/me");
      if (!res.ok) throw new Error("not_found");
      return res.json();
    },
    enabled: !!user && user.role === "tenant",
    retry: false,
  });

  const noTenantRecord = !isLoading && (isError || !myTenant?.id);

  const { data: diasporaContracts, isLoading: diasporaLoading } = useQuery<any[]>({
    queryKey: ["/api/diaspora-portal/contracts"],
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const res = await apiRequest("/api/diaspora-portal/contracts");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: noTenantRecord,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Still loading either query — show skeleton
  if (isLoading || (noTenantRecord && diasporaLoading)) return <PageSkeleton />;

  if (noTenantRecord) {
    // Has diaspora contracts — send to buyer portal
    if (Array.isArray(diasporaContracts) && diasporaContracts.length > 0) {
      window.location.replace("/diaspora-portal");
      return null;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="text-center max-w-sm space-y-3">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <span className="text-2xl">🏠</span>
          </div>
          <p className="text-lg font-semibold text-foreground">No tenant profile found</p>
          <p className="text-sm text-muted-foreground">
            Your account ({user?.email}) is not linked to a tenant record.
            Ask your property manager to create a tenant profile with this email address.
          </p>
        </div>
      </div>
    );
  }

  // Pass the full /me response (which already joins unit + property on the server)
  // so the portal never has to call /api/units/:id or /api/properties/:id —
  // both of which are STAFF_AND_ABOVE and will 403 for tenants.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TenantPortal tenantId={myTenant.id} initialTenantData={myTenant} />
    </Suspense>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function Router() {
  useWsQuerySync();

  // Gate portal is public — guard enters a PIN here, no main JWT
  const [loc, navigate] = useLocation();
  if (loc === "/gate" || loc.startsWith("/gate?")) return <GatePortal />;

  // Public stays marketplace + booking pages — checked here, before
  // authentication is considered at all, same reasoning as /gate above.
  // This MUST run before the isAuthenticated branch below: a genuine guest
  // browsing for a stay has no account and will always be unauthenticated,
  // so placing this check after that branch (the original bug) meant the
  // unauthenticated Switch's own catch-all NotFound route caught every
  // request here first — the marketplace was only ever reachable by
  // someone already logged in, which defeats the entire point.
  if (loc === "/stays" || loc.startsWith("/stay/")) {
    return (
      <Switch>
        <Route path="/stays" component={StaysBrowsePage} />
        <Route path="/stay/:slug" component={StayDetailPage} />
      </Switch>
    );
  }

  const { isAuthenticated, isLoading, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Switch>
          <Route path="/"                      component={PayPropLanding} />
          <Route path="/payprop-landing"       component={PayPropLanding} />
          <Route path="/auth"                  component={AuthPage} />
          <Route path="/auth/forgot-password"  component={ForgotPasswordPage} />
          <Route path="/auth/reset-password"   component={ResetPasswordPage} />
          <Route path="/auth/verify-email"     component={VerifyEmailPage} />
          <Route path="/accept-invite/:token"  component={AcceptInvitePage} />
          <Route path="/pricing"               component={() => <Suspense fallback={<PageSkeleton />}><Pricing /></Suspense>} />
          <Route path="/dashboard"             component={() => { window.location.href = "/"; return null; }} />
          <Route                               component={NotFound} />
        </Switch>
      </div>
    );
  }

  // Redirect non-manager roles to their home on "/"
  const roleHome = getHomeForRole(user?.role);
  if (loc === "/" && roleHome !== "/") { navigate(roleHome); return null; }

  // Landing page must render outside the h-screen/overflow-hidden app shell
  // so the browser's native scroll works (not a clipped inner container).
  if (loc === "/payprop-landing") {
    return <PayPropLanding />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
      />

      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
        <TopBar />

        <main className="flex-1 overflow-auto">
          <Switch>
            {/* Core */}
            <Route path="/"          component={() => <P><DashboardClean /></P>} />
            <Route path="/dashboard" component={() => <P><DashboardClean /></P>} />

            {/* Role portals — use same shell, sidebar auto-collapses for portal roles */}
            <Route path="/tenant-portal"      component={() => <ProtectedRoute><TenantPortalWrapper user={user} /></ProtectedRoute>} />
            <Route path="/tenant-portal-view" component={() => <ProtectedRoute><TenantPortalWrapper user={user} /></ProtectedRoute>} />
            <Route path="/landlord-portal"    component={() => <P><LandlordPortal ownerId={user?.id ?? ""} /></P>} />
            <Route path="/contractor-portal"  component={() => <P><ContractorPortal /></P>} />
            <Route path="/staff-portal"       component={() => <P><StaffPortal /></P>} />
            <Route path="/guard-checkin"      component={() => <P><GuardCheckin /></P>} />

            {/* Properties */}
            <Route path="/properties/:id" component={() => <P><PropertyDetails /></P>} />
            <Route path="/properties"     component={() => <P><Properties /></P>} />

            {/* Role sub-dashboards */}
            <Route path="/senior-manager-dashboard"   component={() => <P><SeniorManagerDashboard /></P>} />
            <Route path="/property-manager-dashboard" component={() => <P><PropertyManagerDashboard /></P>} />
            <Route path="/finance-dashboard"          component={() => <P><FinanceDashboard /></P>} />
            <Route path="/maintenance-dashboard"      component={() => <P><MaintenanceDashboard /></P>} />

            {/* Tenants */}
            <Route path="/tenants/:id"       component={() => <P><TenantDetails /></P>} />
            <Route path="/tenants"           component={() => <P><Tenants /></P>} />
            <Route path="/tenant-crm"        component={() => <P><TenantCRM /></P>} />
            <Route path="/tenant-onboarding" component={() => <P><TenantOnboarding /></P>} />
            <Route path="/tenant-subletting" component={() => <P><TenantSubletting /></P>} />
            <Route path="/rent-collection"   component={() => <P><RentCollection /></P>} />
            <Route path="/bank-reconciliation" component={() => <P><BankReconciliation /></P>} />
            <Route path="/general-ledger"      component={() => <P><GeneralLedgerPage /></P>} />
            <Route path="/profile"             component={() => <P><ProfilePage /></P>} />
            <Route path="/leases"            component={() => <P><Leases /></P>} />

            {/* Finance */}
            <Route path="/finances"            component={() => <P><Finances /></P>} />
            <Route path="/enterprise-finance"  component={() => <P><EnterpriseFinance /></P>} />
            <Route path="/billing"             component={() => <P><Billing /></P>} />
            <Route path="/subscription"        component={() => <P><SubscriptionBilling /></P>} />
            <Route path="/arrears"             component={() => <P><Arrears /></P>} />
            <Route path="/expense-management"  component={() => <P><ExpenseManagement /></P>} />
            <Route path="/rent-to-own"         component={() => <P><RentToOwn /></P>} />
            <Route path="/diaspora-rent-to-own"component={() => <P><DiasporaRentToOwn /></P>} />
            <Route path="/diaspora-rent-to-own/:id" component={() => <P><DiasporaContractDetail /></P>} />
            <Route path="/diaspora-portal"     component={() => <P><DiasporaBuyerPortal /></P>} />
            <Route path="/compliance"          component={() => <P><NairobiCompliance /></P>} />
            <Route path="/owner-statements"    component={() => <P><OwnerStatements /></P>} />
            <Route path="/inspections"         component={() => <P><Inspections /></P>} />
            <Route path="/prospects"           component={() => <P><ProspectsPage /></P>} />
            <Route path="/utility-management"  component={() => <P><UtilityManagement /></P>} />
            <Route path="/utilities"           component={() => <P><Utilities /></P>} />
            <Route path="/utility-bill-sender" component={() => <P><UtilityBillSenderPage /></P>} />
            <Route path="/payment-setup" component={() => <P><PaymentSetupPage /></P>} />
            <Route path="/external-landlords" component={() => <P><ExternalLandlordsPage /></P>} />
            <Route path="/organisations" component={() => <P><PlatformOrganizationsPage /></P>} />
            <Route path="/caretakers" component={() => <P><CaretakersPage /></P>} />
            <Route path="/caretaker-portal" component={() => <P><CaretakerPortalPage /></P>} />

            {/* Maintenance */}
            <Route path="/maintenance-request/:id" component={() => <P><MaintenanceDetails /></P>} />
            <Route path="/maintenance"             component={() => <P><Maintenance /></P>} />
            <Route path="/contractors/:id"         component={() => <P><ContractorDetailsPage /></P>} />
            <Route path="/contractors"             component={() => <P><Contractors /></P>} />
            <Route path="/work-orders/:id"         component={() => <P><WorkOrderDetailsPage /></P>} />
            <Route path="/construction-projects"   component={() => <P><ConstructionProjectManagement /></P>} />

            {/* Security & operations */}
            <Route path="/security"            component={() => <P><Security /></P>} />
            <Route path="/visitor-management"  component={() => <P><VisitorManagement /></P>} />
            <Route path="/parking-management"  component={() => <P><ParkingManagement /></P>} />
            <Route path="/security-operations" component={() => <P><SecurityOperations /></P>} />

            {/* Staff & HR */}
            <Route path="/staff/:id"              component={() => <P><StaffDetailsPage /></P>} />
            <Route path="/workforce-management"   component={() => <P><WorkforceManagement /></P>} />
            <Route path="/user-management"        component={() => <P><UserManagement /></P>} />
            <Route path="/enhanced-service-providers" component={() => <P><EnhancedServiceProviders /></P>} />

            {/* Communications */}
            <Route path="/messages"            component={() => <P><Messages /></P>} />
            <Route path="/broadcast-messaging" component={() => <P><BroadcastMessaging /></P>} />
            <Route path="/marketing-hub"       component={() => <P><MarketingHub /></P>} />
            <Route path="/whatsapp-integration"component={() => <P><WhatsAppIntegration /></P>} />
            <Route path="/citizen-reporting"   component={() => <P><CitizenReporting /></P>} />

            {/* Reports & admin */}
            <Route path="/reports"                  component={() => <P><Reports /></P>} />
            <Route path="/ai-analytics"             component={() => <P><AIAnalytics /></P>} />
            <Route path="/facility-management"      component={() => <P><FacilityManagement /></P>} />
            <Route path="/sustainability-esg"       component={() => <P><SustainabilityESG /></P>} />
            <Route path="/organization-onboarding"  component={() => <P><OrganizationOnboarding /></P>} />
            <Route path="/quick-setup"              component={() => <P><QuickSetup /></P>} />
            <Route path="/organization-management"  component={() => <P><OrganizationManagement /></P>} />
            <Route path="/projects"                 component={() => <P><Projects /></P>} />
            <Route path="/documents"                component={() => <P><Documents /></P>} />

            <Route component={NotFound} />
          </Switch>
        </main>
      </div>

      {/* Role-aware mobile bottom nav */}
      <MobileBottomNav />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DarkModeProvider>
        <NotificationProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </NotificationProvider>
      </DarkModeProvider>
    </QueryClientProvider>
  );
}

export default App;