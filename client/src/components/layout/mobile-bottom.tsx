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
import { useIsMobile } from "@/hooks/use-mobile";
import {
  LayoutDashboard, Home, Users, DollarSign, Wrench, FileText,
  MessageSquare, BarChart2, ShieldCheck, Truck, Settings, X,
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
      groups: [
        {
          label: t("nav.group_finance"),
          items: [
            { label: t("nav.finances"),       href: "/finances",          icon: DollarSign },
            { label: t("nav.rent_collection"),href: "/rent-collection",   icon: CreditCard },
            { label: t("nav.utilities"),      href: "/utilities",         icon: Receipt },
            { label: t("nav.leases"),         href: "/leases",            icon: FileText },
          ],
        },
        {
          label: t("nav.group_operations"),
          items: [
            { label: t("nav.tenants"),     href: "/tenants",     icon: Users },
            { label: t("nav.contractors"), href: "/contractors", icon: Truck },
            { label: t("nav.security"),    href: "/security",    icon: ShieldCheck },
            { label: t("nav.arrears"),     href: "/arrears",     icon: ClipboardList },
          ],
        },
        {
          label: t("nav.group_admin_reports"),
          items: [
            { label: t("nav.documents"),     href: "/documents",             icon: FileText },
            { label: t("nav.reports"),       href: "/reports",               icon: BarChart2 },
            { label: t("nav.organization"),  href: "/organization-management",icon: Settings },
            { label: t("nav.user_mgmt"),     href: "/user-management",       icon: UserCog },
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
          label: t("nav.group_finance"),
          items: [
            { label: t("nav.finances"),       href: "/finances",         icon: DollarSign },
            { label: t("nav.rent_collection"),href: "/rent-collection",  icon: CreditCard },
            { label: t("nav.leases"),         href: "/leases",           icon: FileText },
          ],
        },
        {
          label: t("nav.group_operations"),
          items: [
            { label: t("nav.maintenance"),  href: "/maintenance",           icon: Wrench },
            { label: t("nav.documents"),    href: "/documents",             icon: FileText },
            { label: t("nav.expenses"),     href: "/expense-management",    icon: Receipt },
          ],
        },
      ],
    },

    // Staff — operational tools
    staff: {
      primary: [
        { label: t("nav.group_work"),     href: "/staff-portal", icon: LayoutDashboard },
        { label: t("nav.maintenance"), href: "/maintenance",  icon: Wrench, badgeKey: "maintenance" },
        { label: t("nav.security"),    href: "/security",     icon: ShieldCheck },
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

    // Guard — check-in station only
    guard: {
      primary: [
        { label: t("gatePortal.checkIn"), href: "/guard-checkin",     icon: LogIn },
        { label: t("tenantPortal.visitors"), href: "/visitor-management",icon: Users },
      ],
      groups: [],
    },
  };

  configs.admin = configs.manager;
  return configs;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { t } = useTranslation();
  
  const [location] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Badge data — only fetch on mobile, only items relevant to any role
  const { data: maintRaw } = useQuery<any>({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => {
      try { return ensureArray(await (await apiRequest("/api/maintenance-requests")).json()); }
      catch { return []; }
    },
    enabled: isMobile,
    staleTime: 60_000,
  });

  const { data: messagesRaw } = useQuery<any>({
    queryKey: ["/api/messages"],
    queryFn: async () => {
      try { return ensureArray(await (await apiRequest("/api/messages")).json()); }
      catch { return []; }
    },
    enabled: isMobile,
    staleTime: 60_000,
  });

  if (!isMobile) return null;

  const role   = user?.role ?? "manager";
  const configs = getConfigs(t);
  const config = configs[role] ?? configs.manager;

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
      <nav className="fixed bottom-0 left-0 right-0 z-50 chrome-scope bg-background/95 backdrop-blur-md border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
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
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                    sheetOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="truncate w-full text-center px-1">{tab.label}</span>
                </button>
              );
            }

            return (
              <Link key={tab.href! + idx} href={tab.href!}>
                <div className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors cursor-pointer relative ${
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
              <button onClick={() => setSheetOpen(false)} className="p-1.5 rounded-full hover:bg-muted">
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

      {/* Spacer so page content isn't hidden behind the nav bar */}
      <div className="h-16 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
    </>
  );
}