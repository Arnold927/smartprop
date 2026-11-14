/**
 * MobileBottomNav — role-aware bottom tab bar for mobile.
 *
 * Shows only the tabs relevant to the logged-in user's role.
 * A tenant never sees Properties or Finance tabs.
 * A guard only sees Check-In and Visitor Log.
 *
 * The "More" sheet is also role-filtered.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useIsCompact } from "@/hooks/use-mobile";
import {
  LayoutDashboard, Home, Users, DollarSign, Wrench, FileText,
  MessageSquare, BarChart2, Truck, Settings, X,
  ChevronRight, CreditCard, Receipt, UserCog, Building, Bell,
  MoreHorizontal, ClipboardList, LogIn,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TabItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badgeKey?: string;
}

interface MoreGroup {
  label: string;
  items: TabItem[];
}

interface RoleConfig {
  primary: (TabItem | { label: string; href: null; icon: React.ElementType; badgeKey?: string })[];
  groups:  MoreGroup[];
}

// ── Role configs ──────────────────────────────────────────────────────────────

const getConfigs = (t: (key: string) => string): Record<string, RoleConfig> => {
  const configs: Record<string, RoleConfig> = {
    // Manager / admin sees everything
    manager: {
      primary: [
        { label: t("nav.dashboard"),    href: "/",            icon: LayoutDashboard },
        { label: t("nav.properties"),   href: "/properties",  icon: Home },
        { label: t("nav.maintenance"),  href: "/maintenance", icon: Wrench, badgeKey: "maintenance" },
        { label: t("nav.messages"),     href: "/messages",    icon: MessageSquare, badgeKey: "messages" },
        { label: t("common.all"),         href: null,           icon: MoreHorizontal },
      ],
      // One entry per area — the pages inside an area (Rent collection, Leases,
      // Arrears, Contractors, Users…) are reached from the tab strip at the top
      // of each area's page, so they are not repeated here.
      groups: [
        {
          label: t("nav.group_admin_reports"),
          items: [
            { label: t("nav.tenants"),   href: "/tenants",                icon: Users },
            { label: t("nav.finances"),  href: "/finances",               icon: DollarSign },
            { label: t("nav.reports"),   href: "/reports",                icon: BarChart2 },
            { label: t("nav.documents"), href: "/documents",              icon: FileText },
            { label: t("nav.settings"),  href: "/organization-management", icon: Settings },
          ],
        },
      ],
    },

    // Landlord — portfolio focused
    landlord: {
      primary: [
        { label: t("nav.group_portfolio"),    href: "/landlord-portal", icon: LayoutDashboard },
        { label: t("nav.properties"),   href: "/properties",      icon: Home },
        { label: t("nav.tenants"),      href: "/tenants",         icon: Users },
        { label: t("nav.messages"),     href: "/messages",        icon: MessageSquare, badgeKey: "messages" },
        { label: t("common.all"),         href: null,               icon: MoreHorizontal },
      ],
      groups: [
        {
          label: t("nav.group_operations"),
          items: [
            { label: t("nav.finances"),    href: "/finances",    icon: DollarSign },
            { label: t("nav.maintenance"), href: "/maintenance", icon: Wrench },
            { label: t("nav.documents"),   href: "/documents",   icon: FileText },
          ],
        },
      ],
    },

    // Staff — operational tools
    staff: {
      primary: [
        { label: t("nav.group_work"),     href: "/staff-portal", icon: LayoutDashboard },
        { label: t("nav.maintenance"), href: "/maintenance",  icon: Wrench, badgeKey: "maintenance" },
        // "Security" hidden here too, matching the desktop sidebar fix (which
        // never had a Security entry for staff at all) — redundant with
        // Visitors/Parking, same reasoning as the manager/admin config above.
        // { label: t("nav.security"),    href: "/security",     icon: ShieldCheck },
        { label: t("nav.messages"),    href: "/messages",     icon: MessageSquare, badgeKey: "messages" },
        { label: t("common.all"),        href: null,            icon: MoreHorizontal },
      ],
      groups: [
        {
          label: t("nav.group_operations"),
          items: [
            { label: t("nav.properties"),  href: "/properties",        icon: Home },
            { label: t("nav.contractors"), href: "/contractors",       icon: Truck },
            { label: t("nav.utilities"),   href: "/utility-management",icon: Receipt },
            { label: t("nav.visitors"),    href: "/visitor-management",icon: Building },
          ],
        },
      ],
    },

    // Tenant — their own portal only
    tenant: {
      primary: [
        { label: t("nav.group_home"),    href: "/tenant-portal", icon: LayoutDashboard },
        { label: t("nav.messages"),   href: "/messages",      icon: MessageSquare, badgeKey: "messages" },
        { label: t("nav.documents"),  href: "/documents",     icon: FileText },
        { label: t("common.all"),       href: null,             icon: MoreHorizontal },
      ],
      groups: [
        {
          label: t("nav.group_services"),
          items: [
            { label: t("nav.report_issue"), href: "/citizen-reporting", icon: Bell },
          ],
        },
      ],
    },

    // Guard — check-in station only. One destination, so no tab bar
    // (their menu drawer still has Sign out); "/visitor-management" is not
    // an allowed route for guards.
    guard: {
      primary: [],
      groups: [],
    },

    // Caretaker — only routes in ROLE_ALLOWED_ROUTES.caretaker
    caretaker: {
      primary: [
        { label: t("nav.dashboard"),   href: "/caretaker-portal", icon: LayoutDashboard },
        { label: t("nav.maintenance"), href: "/maintenance",      icon: Wrench, badgeKey: "maintenance" },
        { label: t("nav.visitors"),    href: "/visitor-management", icon: Users },
        { label: t("common.all"),      href: null,                icon: MoreHorizontal },
      ],
      groups: [
        {
          label: t("nav.group_operations"),
          items: [
            { label: t("nav.properties"), href: "/properties",   icon: Home },
            { label: t("nav.inspections"), href: "/inspections", icon: ClipboardList },
            { label: t("nav.messages"),   href: "/messages",     icon: MessageSquare },
            { label: t("nav.my_profile"), href: "/profile",      icon: UserCog },
          ],
        },
      ],
    },

    // Contractor — portal and profile (messaging is a tab inside the portal)
    contractor: {
      primary: [
        { label: t("nav.my_portal"), href: "/contractor-portal", icon: LayoutDashboard },
        { label: t("nav.my_profile"), href: "/profile",          icon: UserCog },
      ],
      groups: [],
    },

    // Platform admin — organisations only
    platform_admin: {
      primary: [
        { label: t("nav.organisations"), href: "/organisations", icon: Building },
      ],
      groups: [],
    },
  };

  configs.admin = configs.manager;
  return configs;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function MobileBottomNav() {
  const isMobile = useIsCompact();
  const { user } = useAuth();
  const { t } = useTranslation();
  
  const [location] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Badge data — only fetch on compact screens, and only for roles the server
  // lets read these lists (contractors and guards would just get a 403).
  const badgeRole = user?.role ?? "";
  const canSeeMaintBadge = ["admin", "manager", "staff", "caretaker", "landlord", "tenant"].includes(badgeRole);
  const canSeeMsgBadge   = ["admin", "manager", "staff", "caretaker", "landlord", "tenant"].includes(badgeRole);

  const { data: maintRaw } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => {
      try { return ensureArray(await (await apiRequest("/api/maintenance-requests")).json()); }
      catch { return []; }
    },
    enabled: isMobile && canSeeMaintBadge,
    staleTime: 60_000,
  });

  const { data: messagesRaw } = useQuery<any>({
    queryKey: ["/api/messages"],
    queryFn: async () => {
      try { return ensureArray(await (await apiRequest("/api/messages")).json()); }
      catch { return []; }
    },
    enabled: isMobile && canSeeMsgBadge,
    staleTime: 60_000,
  });

  if (!isMobile) return null;

  const role   = user?.role ?? "manager";
  const configs = getConfigs(t);
  // Unknown roles get an empty bar rather than the manager's tabs.
  const config = configs[role] ?? { primary: [], groups: [] };

  if (config.primary.length === 0) return null;

  const badges: Record<string, number> = {
    maintenance: Array.isArray(maintRaw)
      ? maintRaw.filter((r: any) => r.status === "pending" || r.status === "in_progress").length
      : 0,
    messages: Array.isArray(messagesRaw)
      ? messagesRaw.filter((m: any) => !m.read).length
      : 0,
  };

  const isActive = (href: string | null) => {
    if (!href) return false;
    return href === "/" ? location === "/" : location.startsWith(href);
  };

  return (
    <>
      {/* Bottom bar */}
      <nav className="lg:hidden shrink-0 relative z-40 chrome-scope bg-background border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        <div className="flex items-stretch h-16 px-1">
          {config.primary.map((tab, idx) => {
            const Icon    = tab.icon;
            const active  = isActive(tab.href);
            const badge   = tab.badgeKey ? badges[tab.badgeKey] : 0;
            const isMore  = tab.href === null;

            if (isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setSheetOpen(true)}
                  className={`flex-1 basis-0 min-w-0 min-h-[44px] flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
                    sheetOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="truncate w-full text-center px-1">{tab.label}</span>
                </button>
              );
            }

            return (
              <Link key={tab.href! + idx} href={tab.href!} className="flex-1 basis-0 min-w-0 flex">
                <div className={`flex-1 min-w-0 min-h-[44px] flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors cursor-pointer relative ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}>
                  {active && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />
                  )}
                  <div className="relative shrink-0">
                    <Icon className={`w-5 h-5 ${active ? "stroke-[2.5]" : ""}`} />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </div>
                  <span className="truncate w-full text-center px-0.5 leading-tight">{tab.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* More sheet */}
      {sheetOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[55] backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[60] chrome-scope bg-background rounded-t-2xl border-t border-border pb-safe max-h-[75vh] overflow-y-auto">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-sm font-semibold text-foreground">{t("common.all")}</span>
              <button onClick={() => setSheetOpen(false)} className="p-1.5 rounded-full hover:bg-muted" aria-label="Close">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Role-filtered groups */}
            <div className="px-4 pb-6 space-y-5">
              {config.groups.map(group => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map(item => {
                      const Icon   = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link key={item.href} href={item.href}>
                          <div
                            onClick={() => setSheetOpen(false)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors ${
                              active
                                ? "bg-primary/10 text-primary"
                                : "bg-muted/50 text-foreground hover:bg-muted"
                            }`}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span className="text-xs font-medium truncate">{item.label}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

    </>
  );
}