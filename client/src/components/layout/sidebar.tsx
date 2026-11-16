import { BrandMark } from "@/components/brand-logo";
import { Link, useLocation } from "wouter";
import { useState, useMemo } from "react";
import {
  X, ChevronDown, ChevronUp,
  LogOut, Moon, Sun, Contrast, Wifi, WifiOff, PanelLeftClose, PanelLeftOpen, Home, Settings, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { useDarkModeContext } from "@/context/DarkModeContext";
import { useIsCompact } from "@/hooks/use-mobile";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getNavForRole, isNavHrefActive, type NavItem } from "@/lib/roleNav";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

function NavItemComponent({
  item, isCollapsed,
}: {
  item: NavItem;
  isCollapsed: boolean;
}) {
  const [location] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const isActive = (href: string) => isNavHrefActive(href, location, search);

  // Items with `children` are a single link: the pages inside that area are
  // reached from the tab strip at the top of the page (SectionTabs), so the
  // sidebar stays short and never lists overlapping pages twice.
  const active = isActive(item.href) || (item.children?.some(c => isActive(c.href)) ?? false);
  const Icon = item.icon;

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Link href={item.href}>
            <div className={`flex items-center justify-center w-10 h-10 rounded-lg cursor-pointer transition-all mx-auto relative ${
              active
                ? "bg-emerald-700 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.badge && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  !
                </span>
              )}
            </div>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {item.name}
          {item.children && item.children.length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {item.children.map(c => (
                <li key={c.href} className="text-xs text-muted-foreground">{c.name}</li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={item.href}>
      <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all text-sm group ${
        active
          ? "bg-emerald-700 text-white shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}>
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="truncate flex-1">{item.name}</span>
        {item.badge && (
          <span className="ml-auto text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-medium">
            {item.badge}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Small badge shown next to the user's name indicating their role. */
function RoleBadge({ role }: { role?: string }) {
  const colours: Record<string, string> = {
    admin:    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    manager:  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    landlord: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    staff:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    tenant:   "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    guard:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  };
  const label = role ?? "user";
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${colours[label] ?? "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({ isOpen, onClose, isCollapsed: isCollapsedProp = false, onToggleCollapse }: SidebarProps) {
  const { user } = useAuth();
  const logout = useLogout();
  const isMobile = useIsCompact();
  // The icon-only collapsed rail is a desktop affordance; the compact drawer is always full width.
  const isCollapsed = isCollapsedProp && !isMobile;
  const { isDark, theme, toggle: toggleDark } = useDarkModeContext();
  const { connected } = useWebSocket();
  const { t } = useTranslation();

  // ── Role-aware navigation ──────────────────────────────────────────────────
  // Detect if a tenant-role user is actually a diaspora buyer (has contracts)
  const { data: diasporaContracts } = useQuery({
    queryKey: ["/api/diaspora-portal/contracts"],
    queryFn: async () => {
      const r = await apiRequest("/api/diaspora-portal/contracts");
      if (!r.ok) return [];
      return r.json();
    },
    enabled: user?.role === "tenant",
    staleTime: 5 * 60 * 1000,
  });
  const isDiasporaBuyer = user?.role === "tenant" && Array.isArray(diasporaContracts) && diasporaContracts.length > 0;

  const navGroups = useMemo(
    () => getNavForRole(user?.role, t, isDiasporaBuyer),
    [user?.role, t, isDiasporaBuyer]
  );

  // The footer block (connection status, theme toggle, contact support) sits
  // below the scrollable nav and never scrolls away itself — on roles with a
  // long nav tree it eats space the nav list needs, with no visual cue that
  // there's more to scroll to above it. Collapsed by default; "Collapse
  // sidebar" and "Sign out" stay always visible either way since those are
  // reached often enough to not want an extra click.
  const [showFooterExtras, setShowFooterExtras] = useState(() => {
    try { return localStorage.getItem("sp_sidebar_footer_expanded") === "1"; } catch { return false; }
  });
  const toggleFooterExtras = () => {
    setShowFooterExtras(prev => {
      const next = !prev;
      try { localStorage.setItem("sp_sidebar_footer_expanded", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  return (
    <>
      {isMobile && isOpen && (
        <div className="fixed inset-0 bg-black/50 z-[55] lg:hidden backdrop-blur-sm" onClick={onClose} />
      )}
      <div className={`
        fixed left-0 top-0 bottom-0 chrome-scope bg-background
        border-r border-border ${isMobile ? "z-[60] w-[min(18rem,85vw)]" : "z-30"} flex flex-col
        transition-all duration-200 ease-in-out
        ${isMobile ? "" : (isCollapsed ? "w-16" : "w-64")}
        ${isMobile ? (isOpen ? "translate-x-0" : "-translate-x-full") : "translate-x-0"}
      `}>

        {/* Logo header */}
        <div className={`flex items-center h-14 ${
          isCollapsed ? "justify-center px-2" : "justify-between px-4"
        }`}>
          {!isCollapsed && (
            <div className="flex items-center gap-2.5">
              <BrandMark size={32} className="rounded-lg shadow-sm" />
              <div>
                <span className="text-sm font-bold text-foreground tracking-tight">SmartProp</span>
                <div className="text-xs text-muted-foreground leading-none mt-0.5">Property Management</div>
              </div>
            </div>
          )}

          {isCollapsed && (
            <BrandMark size={32} className="rounded-lg shadow-sm" />
          )}

          {isMobile && !isCollapsed && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-muted-foreground" aria-label="Close">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Scrollable nav — role-filtered */}
        <nav className={`flex-1 overflow-y-auto py-2 scrollbar-thin ${isCollapsed ? "px-1.5" : "px-3"}`}>
          {navGroups.map((group) => (
            <div key={group.label}>
              {!isCollapsed && group.label && (
                <p className="px-3 mb-1 mt-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </p>
              )}
              {isCollapsed && group.label && (
                <div className="w-8 h-px bg-border mx-auto mb-2 mt-2" />
              )}
              <div className={`space-y-0.5 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
                {group.items.map(item => (
                  <NavItemComponent
                    key={item.href + item.name}
                    item={item}
                    isCollapsed={isCollapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom user area */}
        <div className={`p-3 space-y-1 ${isCollapsed ? "flex flex-col items-center" : ""}`} style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>

          {/* Collapse toggle — always visible, not part of the collapsible extras below */}
          {!isCollapsed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className={`w-full items-center justify-start gap-2.5 px-3 h-9 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg ${isMobile ? "hidden" : "flex"}`}
            >
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-sm">Collapse sidebar</span>
            </Button>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleCollapse}
                  className="h-9 w-9 p-0 rounded-lg hover:bg-muted"
                 aria-label="Expand sidebar">
                  <PanelLeftOpen className="w-4 h-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          )}

          {/* More/Less toggle — reveals connection status, theme toggle, and
              contact support below. Collapsed by default so this fixed footer
              block doesn't eat space the scrollable nav list above needs;
              state persists across sessions via localStorage. */}
          {!isCollapsed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFooterExtras}
              className="w-full flex items-center justify-start gap-2.5 px-3 h-8 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg"
            >
              {showFooterExtras ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span className="text-xs">{showFooterExtras ? "Less" : "More"}</span>
            </Button>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleFooterExtras}
                  className="h-7 w-9 p-0 rounded-lg hover:bg-muted"
                >
                  {showFooterExtras ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{showFooterExtras ? "Fewer options" : "More options"}</TooltipContent>
            </Tooltip>
          )}

          {showFooterExtras && (
            <>
              {!isCollapsed && (
                <div className="flex items-center gap-2 px-3 py-1.5">
                  {connected
                    ? <Wifi className="w-3 h-3 text-green-500 flex-shrink-0" />
                    : <WifiOff className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  }
                  <span className="text-xs text-muted-foreground">
                    {connected ? "Live sync" : "Offline"}
                  </span>
                </div>
              )}

              {isCollapsed && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center w-10 h-6">
                      {connected
                        ? <Wifi className="w-3.5 h-3.5 text-green-500" />
                        : <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">{connected ? "Live sync" : "Offline"}</TooltipContent>
                </Tooltip>
              )}

              {/* Theme toggle */}
              {!isCollapsed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleDark}
                  className="w-full flex items-center justify-start gap-2.5 px-3 h-9 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg"
                >
                  {theme === "light" ? (
                    <>
                      <Contrast className="w-4 h-4" />
                      <span className="text-sm">Gray mode</span>
                    </>
                  ) : theme === "gray" ? (
                    <>
                      <Moon className="w-4 h-4" />
                      <span className="text-sm">Dark mode</span>
                    </>
                  ) : (
                    <>
                      <Sun className="w-4 h-4" />
                      <span className="text-sm">Light mode</span>
                    </>
                  )}
                </Button>
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleDark}
                      className="h-9 w-9 p-0 rounded-lg hover:bg-muted"
                    >
                      {theme === "light" ? (
                        <Contrast className="w-4 h-4 text-muted-foreground" />
                      ) : theme === "gray" ? (
                        <Moon className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <Sun className="w-4 h-4 text-amber-400" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {theme === "light" ? "Gray mode" : theme === "gray" ? "Dark mode" : "Light mode"}
                  </TooltipContent>
                </Tooltip>
              )}

              <div className="h-px bg-border my-1 w-full" />

              {/* Contact support — replaces the floating WhatsApp FAB */}
              {!isCollapsed ? (
                <a
                  href="https://wa.me/254759657590?text=Hi%21%20I%20need%20help%20with%20my%20Smart%20Prop%20account."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" />
                  <span>Contact Support</span>
                </a>
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <a
                      href="https://wa.me/254759657590?text=Hi%21%20I%20need%20help%20with%20my%20Smart%20Prop%20account."
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="right">Contact Support</TooltipContent>
                </Tooltip>
              )}
            </>
          )}

          <div className="h-px bg-border my-1 w-full" />

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className={`w-full flex items-center text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg h-9 ${
              isCollapsed ? "justify-center p-0" : "justify-start gap-2.5 px-3"
            }`}
          >
            <LogOut className="w-4 h-4" />
            {!isCollapsed && <span className="text-sm font-medium">Sign out</span>}
          </Button>
        </div>
      </div>
    </>
  );
}