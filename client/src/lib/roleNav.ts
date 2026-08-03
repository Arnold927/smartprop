/**
 * roleNav.ts
 *
 * Defines sidebar navigation items per role AND the route allow-list
 * used by ProtectedRoute to block unauthorised navigation.
 *
 * Roles: admin | manager | landlord | staff | caretaker | tenant | guard | contractor
 */

import {
  LayoutDashboard, Home, Users, DollarSign, Wrench, BarChart3,
  Shield, UserCog, Users2, Receipt, Building, FileText, Globe,
  ClipboardCheck, BookOpen, MessageCircle, MessageSquare, User,
  FolderOpen, CreditCard, Star, UserPlus, Droplets, Settings, Leaf,
  Plane, Camera, CalendarDays,
} from "lucide-react";

export type UserRole = "admin" | "manager" | "landlord" | "staff" | "caretaker" | "tenant" | "guard" | "contractor";

export interface NavChild { name: string; href: string; }
export interface NavItem {
  name: string; href: string; icon: any;
  badge?: string | null; children?: NavChild[];
}
export interface NavGroup { label: string; items: NavItem[]; }

// ─── Admin & Manager shared core ──────────────────────────────────────────────
const getCoreManagerItems = (t: (k: string) => string) => [
  { name: t("nav.dashboard"), href: "/", icon: LayoutDashboard },
  {
    name: t("nav.properties"), href: "/properties", icon: Home,
    children: [
      { name: t("nav.all_properties"),  href: "/properties" },
      { name: t("nav.parking"),         href: "/parking-management" },
      { name: t("nav.visitors"),        href: "/visitor-management" },
      { name: t("nav.security"),        href: "/security" },
      { name: t("nav.inspections"),     href: "/inspections" },
      { name: t("nav.caretakers"),      href: "/caretakers" },
    ],
  },
  {
    name: t("nav.tenants"), href: "/tenants", icon: Users,
    children: [
      { name: t("nav.directory"),        href: "/tenants" },
      { name: t("nav.leases"),           href: "/leases" },
      { name: t("nav.letting_pipeline"), href: "/prospects" },
      { name: t("nav.onboarding"),       href: "/tenant-onboarding" },
      { name: t("nav.short_term_rentals"), href: "/tenant-subletting" },
      { name: "Diaspora Rent-to-Own",    href: "/diaspora-rent-to-own" },
    ],
  },
  {
    name: t("nav.finances"), href: "/finances", icon: DollarSign,
    children: [
      { name: t("nav.overview"),         href: "/finances" },
      { name: t("nav.rent_collection"),  href: "/rent-collection" },
      { name: t("nav.arrears_risk"),     href: "/arrears" },
      { name: t("nav.expenses"),         href: "/expense-management" },
      { name: t("nav.utilities"),        href: "/utility-management" },
      { name: t("nav.owner_statements"), href: "/owner-statements" },
      { name: t("nav.general_ledger"),   href: "/general-ledger" },
    ],
  },
  {
    name: t("nav.maintenance"), href: "/maintenance", icon: Wrench, badge: "!",
    children: [
      { name: t("nav.all_requests"), href: "/maintenance" },
      { name: t("nav.contractors"),  href: "/contractors" },
    ],
  },
  {
    name: t("nav.reports"), href: "/reports", icon: BarChart3,
    children: [
      { name: t("nav.analytics"),   href: "/reports" },
      { name: t("nav.ai_insights"), href: "/ai-analytics" },
      { name: "ESG & Sustainability", href: "/sustainability-esg" },
    ],
  },
  {
    name: t("nav.compliance"), href: "/compliance", icon: Shield,
    children: [
      { name: t("nav.kra_returns"),      href: "/compliance?tab=kra" },
      { name: t("nav.etims"),            href: "/compliance?tab=etims" },
      { name: t("nav.stamp_duty"),       href: "/compliance?tab=stamp-duty" },
      { name: t("nav.valuations_cgt"),   href: "/compliance?tab=valuations" },
      { name: t("nav.deposit_interest"), href: "/compliance?tab=deposit-interest" },
      { name: t("nav.service_charges"),  href: "/compliance?tab=service-charges" },
      { name: t("nav.rrt_notices"),      href: "/compliance?tab=rrt" },
    ],
  },
  {
    name: t("nav.settings"), href: "/organization-management", icon: UserCog,
    children: [
      { name: t("nav.organization"), href: "/organization-management" },
      { name: t("nav.users_roles"),  href: "/user-management" },
      { name: t("nav.billing"),      href: "/billing" },
    ],
  },
];

const getAdminNav = (t: (k: string) => string): NavGroup[] => [{
  label: "",
  items: [
    ...getCoreManagerItems(t).slice(0, 5),
    {
      name: t("nav.comms"), href: "/messages", icon: MessageCircle,
      children: [
        { name: t("nav.internal_messages"), href: "/messages" },
        { name: t("nav.whatsapp_channel"),  href: "/whatsapp-integration" },
        { name: t("nav.broadcast"),         href: "/broadcast-messaging" },
      ],
    },
    ...getCoreManagerItems(t).slice(5),
  ],
}];

const getManagerNav = (t: (k: string) => string): NavGroup[] => [{
  label: "",
  items: [
    ...getCoreManagerItems(t).slice(0, 5),
    {
      name: t("nav.comms"), href: "/messages", icon: MessageCircle,
      children: [
        { name: t("nav.internal_messages"), href: "/messages" },
        { name: t("nav.whatsapp_channel"),  href: "/whatsapp-integration" },
      ],
    },
    ...getCoreManagerItems(t).slice(5),
  ],
}];

// ─── Landlord ─────────────────────────────────────────────────────────────────
// A landlord owns property and receives rental income managed by the PM.
// They need: their portal dashboard, their properties/tenants, financial reports,
// compliance obligations, maintenance visibility, documents, and profile.
const getLandlordNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_portfolio"),
    items: [
      { name: t("nav.dashboard"),        href: "/landlord-portal",   icon: LayoutDashboard },
      { name: t("nav.my_properties"),    href: "/properties",        icon: Home },
      { name: t("nav.my_tenants"),       href: "/tenants",           icon: Users },
      { name: t("nav.owner_statements"), href: "/owner-statements",  icon: FileText },
      { name: t("nav.leases"),           href: "/leases",            icon: BookOpen },
      { name: t("nav.short_term_rentals"), href: "/tenant-subletting", icon: CalendarDays },
      { name: t("nav.diaspora_contract"),href: "/diaspora-portal",   icon: Globe, badge: "RTO" },
    ],
  },
  {
    label: t("nav.group_finance"),
    items: [
      {
        name: t("nav.finances"), href: "/finances", icon: DollarSign,
        children: [
          { name: t("nav.rent_collection"), href: "/rent-collection" },
          { name: t("nav.expenses"),        href: "/expense-management" },
          { name: t("nav.payment_setup"),   href: "/payment-setup" },
          { name: t("nav.external_landlords"), href: "/external-landlords" },
        ],
      },
    ],
  },
  {
    label: t("nav.group_operations"),
    items: [
      {
        name: t("nav.maintenance"), href: "/maintenance", icon: Wrench,
        children: [
          { name: t("nav.all_requests"), href: "/maintenance" },
        ],
      },
      { name: t("nav.inspections"), href: "/inspections", icon: ClipboardCheck },
      { name: t("nav.caretakers"),  href: "/caretakers",  icon: Shield },
      { name: t("nav.guard_pins"),  href: "/security?tab=gate-pins", icon: UserCog },
      { name: t("nav.visitors"),    href: "/visitor-management", icon: Users },
      // Trimmed to Bill Sender only — Utility Management's other tabs
      // (Providers/Accounts/Readings/Bills/Expenses/Analytics) are redundant
      // or irrelevant for a landlord: Bill Sender already takes readings and
      // creates the bill record inline, Providers/Accounts are one-time setup
      // tasks, and Expenses duplicates the dedicated Expense Management page.
      { name: t("nav.send_utility_bills"), href: "/utility-bill-sender", icon: Receipt },
      { name: t("nav.documents"),   href: "/documents",   icon: FolderOpen },
    ],
  },
  {
    label: t("nav.group_compliance"),
    items: [
      {
        // Landlords only ever see "Rent Notices" here — the KRA/eTIMS/stamp-duty/
        // valuations/deposit-interest/service-charges items are commented out for
        // this role only (see the matching restriction in pages/compliance.tsx).
        // Admin/manager's nav block above this one is untouched and keeps the
        // full list.
        name: t("nav.compliance"), href: "/compliance?tab=rrt", icon: Shield,
        // children: [
        //   { name: t("nav.kra_returns"),      href: "/compliance?tab=kra" },
        //   { name: t("nav.etims"),            href: "/compliance?tab=etims" },
        //   { name: t("nav.stamp_duty"),       href: "/compliance?tab=stamp-duty" },
        //   { name: t("nav.valuations_cgt"),   href: "/compliance?tab=valuations" },
        //   { name: t("nav.deposit_interest"), href: "/compliance?tab=deposit-interest" },
        //   { name: t("nav.service_charges"),  href: "/compliance?tab=service-charges" },
        //   { name: t("nav.rrt_notices"),      href: "/compliance?tab=rrt" },
        // ],
      },
    ],
  },
  {
    label: t("nav.group_comms"),
    items: [
      { name: t("nav.internal_messages"), href: "/messages", icon: MessageSquare },
      { name: t("nav.my_profile"),        href: "/profile",  icon: User },
    ],
  },
];

// ─── Staff ────────────────────────────────────────────────────────────────────
// Operational staff handle maintenance, tenant relations, and daily property ops.
// They do NOT access financial reports or the general ledger.
const getStaffNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_work"),
    items: [
      { name: t("nav.dashboard"),   href: "/staff-portal", icon: LayoutDashboard },
      { name: t("nav.properties"),  href: "/properties",   icon: Home },
      { name: t("nav.tenants"),     href: "/tenants",      icon: Users },
    ],
  },
  {
    label: t("nav.group_operations"),
    items: [
      {
        name: t("nav.maintenance"), href: "/maintenance", icon: Wrench, badge: "!",
        children: [
          { name: t("nav.all_requests"), href: "/maintenance" },
          { name: t("nav.contractors"),  href: "/contractors" },
        ],
      },
      { name: t("nav.inspections"),     href: "/inspections",      icon: ClipboardCheck },
      // Visitor management removed for staff — only managers, admins and caretakers can create visitor access
      // { name: t("nav.visitor_log"),     href: "/visitor-management",icon: Users2 },
      { name: t("nav.letting_pipeline"),href: "/prospects",         icon: Users2 },
      {
        name: t("nav.utilities"), href: "/utility-management", icon: Receipt,
        children: [
          { name: t("nav.manage_utilities"),   href: "/utility-management" },
          { name: t("nav.send_utility_bills"), href: "/utility-bill-sender" },
        ],
      },
    ],
  },
  {
    label: t("nav.group_comms"),
    items: [
      { name: t("nav.internal_messages"), href: "/messages", icon: MessageSquare },
      { name: t("nav.my_profile"),        href: "/profile",  icon: User },
    ],
  },
];

// ─── Caretaker ────────────────────────────────────────────────────────────────
// On-site property caretakers: maintenance, access control, visitor management.
const getCaretakerNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_property"),
    items: [
      { name: t("nav.dashboard"),  href: "/caretaker-portal", icon: LayoutDashboard },
      { name: t("nav.properties"), href: "/properties",   icon: Home },
    ],
  },
  {
    label: t("nav.group_operations"),
    items: [
      {
        name: t("nav.maintenance"), href: "/maintenance", icon: Wrench, badge: "!",
        children: [
          { name: t("nav.all_requests"), href: "/maintenance" },
        ],
      },
      {
        name: t("nav.visitors"), href: "/visitor-management", icon: Users,
        children: [
          { name: t("nav.visitor_log"),   href: "/visitor-management" },
          { name: t("nav.guard_checkin"), href: "/guard-checkin" },
        ],
      },
      { name: t("nav.inspections"), href: "/inspections", icon: ClipboardCheck },
    ],
  },
  {
    label: t("nav.group_comms"),
    items: [
      { name: t("nav.internal_messages"), href: "/messages", icon: MessageSquare },
      { name: t("nav.my_profile"),        href: "/profile",  icon: User },
    ],
  },
];

// ─── Tenant ───────────────────────────────────────────────────────────────────
// A tenant's world: all sections live in the sidebar as ?tab= links.
const getTenantNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: "My Home",
    items: [
      { name: "Overview",      href: "/tenant-portal?tab=dashboard",  icon: LayoutDashboard },
      { name: "Payments",      href: "/tenant-portal?tab=payments",   icon: CreditCard },
      { name: "Maintenance",   href: "/tenant-portal?tab=repairs",    icon: Wrench },
      { name: "Utilities",     href: "/tenant-portal?tab=utilities",  icon: Droplets },
    ],
  },
  {
    label: "Communication",
    items: [
      { name: "Messages",      href: "/tenant-portal?tab=messages",   icon: MessageSquare },
      { name: "Documents",     href: "/tenant-portal?tab=documents",  icon: FolderOpen },
      { name: "Visitors",      href: "/tenant-portal?tab=visitors",   icon: UserPlus },
      { name: "Ratings",       href: "/tenant-portal?tab=ratings",    icon: Star },
    ],
  },
  {
    label: "Account",
    items: [
      { name: "Profile & Settings", href: "/tenant-portal?tab=profile", icon: Settings },
    ],
  },
];

// ─── Diaspora Buyer ───────────────────────────────────────────────────────────
// A diaspora buyer is a person paying instalments for a unit/property from abroad.
// They share the "tenant" role but are identified by having diaspora contracts.
// Their nav is separate from the regular tenant nav — shown when the user has
// diaspora contracts but no active tenancy, OR when explicitly set to diaspora_buyer.
const getDiasporaBuyerNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: "My Investment",
    items: [
      { name: "My Contracts",      href: "/diaspora-portal?section=contracts",              icon: Globe },
      { name: "Payments",          href: "/diaspora-portal?tab=payments",  icon: CreditCard },
      { name: "Construction",      href: "/diaspora-portal?tab=construction", icon: Camera },
      { name: "Schedule",          href: "/diaspora-portal?tab=schedule",  icon: LayoutDashboard },
      { name: "Certificate",       href: "/diaspora-portal?tab=certificate", icon: Star },
    ],
  },
  {
    label: "Communication",
    items: [
      { name: "Messages",          href: "/diaspora-portal?section=messages",  icon: MessageSquare },
      { name: "Documents",         href: "/diaspora-portal?section=documents", icon: FolderOpen },
    ],
  },
  {
    label: "Account",
    items: [
      { name: "Profile",           href: "/profile", icon: User },
    ],
  },
];

// ─── Guard ────────────────────────────────────────────────────────────────────
const getGuardNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_station"),
    items: [
      { name: t("nav.check_in"), href: "/guard-checkin", icon: Shield },
    ],
  },
];

// ─── Contractor ───────────────────────────────────────────────────────────────
// External contractors: their work portal, messaging with the PM, and profile.
const getContractorNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_work"),
    items: [
      { name: t("nav.my_portal"),         href: "/contractor-portal", icon: LayoutDashboard },
      { name: t("nav.internal_messages"), href: "/messages",          icon: MessageSquare },
      { name: t("nav.my_profile"),        href: "/profile",           icon: User },
    ],
  },
];

// ─── Lookup ───────────────────────────────────────────────────────────────────
// ─── Platform admin — deliberately minimal, not scoped to any organisation ───
const getPlatformAdminNav = (t: (k: string) => string): NavGroup[] => [
  {
    label: t("nav.group_platform"),
    items: [
      { name: t("nav.organisations"), href: "/organisations", icon: Building },
    ],
  },
];

export function getNavForRole(role: string | undefined, t: (k: string) => string, isDiasporaBuyer = false): NavGroup[] {
  switch (role) {
    case "platform_admin":  return getPlatformAdminNav(t);
    case "admin":           return getAdminNav(t);
    case "manager":         return getManagerNav(t);
    case "landlord":        return getLandlordNav(t);
    case "staff":           return getStaffNav(t);
    case "caretaker":       return getCaretakerNav(t);
    case "tenant":          return isDiasporaBuyer ? getDiasporaBuyerNav(t) : getTenantNav(t);
    case "diaspora_buyer":  return getDiasporaBuyerNav(t);
    case "guard":           return getGuardNav(t);
    case "contractor":      return getContractorNav(t);
    default:                return getManagerNav(t);
  }
}

export function getHomeForRole(role?: string): string {
  switch (role) {
    case "platform_admin": return "/organisations";
    case "tenant":     return "/tenant-portal";
    case "landlord":   return "/landlord-portal";
    case "staff":      return "/staff-portal";
    case "caretaker":  return "/caretaker-portal";
    case "guard":      return "/guard-checkin";
    case "contractor": return "/contractor-portal";
    default:           return "/";
  }
}

/**
 * Route allow-list per role — used by ProtectedRoute.
 * Prefix matching: "/properties" covers "/properties/123".
 */
export const ROLE_ALLOWED_ROUTES: Record<string, string[]> = {
  platform_admin: ["*"],
  admin: ["*"],

  manager: [
    "/", "/properties", "/parking-management", "/visitor-management", "/inspections", "/caretakers",
    "/tenants", "/leases", "/prospects", "/tenant-onboarding", "/tenant-subletting", "/diaspora-rent-to-own", "/diaspora-rent-to-own/:id",
    "/finances", "/rent-collection", "/arrears", "/expense-management",
    "/utility-management", "/utility-bill-sender", "/owner-statements", "/general-ledger",
    "/maintenance", "/contractors", "/work-orders", "/construction-projects",
    "/messages", "/whatsapp-integration", "/broadcast-messaging",
    "/reports", "/ai-analytics", "/documents",
    "/compliance", "/sustainability-esg",
    "/organization-management", "/user-management", "/security", "/billing",
    "/payment-setup", "/external-landlords",
    "/landlord-portal", "/staff-portal", "/diaspora-portal",
    "/guard-checkin", "/citizen-reporting", "/profile", "/not-found",
  ],

  landlord: [
    "/landlord-portal",
    "/properties", "/tenants", "/leases",
    "/finances", "/rent-collection", "/expense-management",
    "/owner-statements",
    "/maintenance", "/inspections", "/documents", "/caretakers", "/security", "/visitor-management",
    "/utility-bill-sender", "/payment-setup", "/tenant-subletting",
    "/compliance",
    "/messages", "/profile",
    "/diaspora-portal",
    "/not-found",
  ],

  staff: [
    "/staff-portal",
    "/properties", "/tenants",
    "/maintenance", "/contractors", "/inspections",
    "/visitor-management",
    "/prospects",
    "/utility-management", "/utility-bill-sender",
    "/messages", "/profile",
    "/not-found",
  ],

  caretaker: [
    "/caretaker-portal",
    "/properties",
    "/maintenance", "/inspections",
    "/visitor-management", "/guard-checkin",
    "/messages", "/profile",
    "/not-found",
  ],

  tenant: [
    "/tenant-portal", "/tenant-portal-view",
    "/diaspora-portal",
    "/messages", "/documents", "/profile",
    "/citizen-reporting",
    "/not-found",
  ],

  guard: [
    "/guard-checkin", "/not-found",
  ],

  contractor: [
    "/contractor-portal",
    "/messages", "/profile",
    "/not-found",
  ],
};

export function isRouteAllowed(role: string | undefined, pathname: string): boolean {
  const allowed = ROLE_ALLOWED_ROUTES[role ?? ""] ?? ROLE_ALLOWED_ROUTES["manager"];
  if (allowed.includes("*")) return true;
  return allowed.some(prefix =>
    pathname === prefix ||
    pathname.startsWith(prefix + "/") ||
    pathname.startsWith(prefix + "?")
  );
}