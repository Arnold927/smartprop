import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
 Search, Bell, ChevronDown, Settings, LogOut, User,
 Wrench, DollarSign, Building2, X, AlertCircle, Moon, Sun, Contrast, MessageSquare, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem,
 DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { useDarkModeContext } from "@/context/DarkModeContext";
import { useNotifications } from "@/context/NotificationContext";
import { useToast } from "@/hooks/use-toast";
import DashboardSwitcher from "./dashboard-switcher";

// Renders a divider only when DashboardSwitcher would be visible.
// Mirrors the same role + count logic so they hide/show together.
function DashboardSwitcherDivider() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const ALLOWED: Record<string, string[]> = {
    senior_manager:   ['admin'],
    property_manager: ['admin', 'manager'],
    finance:          ['admin', 'manager'],
    maintenance:      ['admin', 'manager', 'staff', 'caretaker'],
    landlord:         ['landlord'],
    default:          ['admin', 'manager', 'staff', 'caretaker', 'contractor'],
  };
  const count = Object.values(ALLOWED).filter(roles => roles.includes(role)).length;
  if (!user || count <= 1) return null;
  return <div className="w-px h-5 bg-muted mx-1" />;
}
import { CommandPalette } from "./command-palette";
import { useTranslation } from "react-i18next";



// ── Search ─────────────────────────────────────────────────────────────────
function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center h-10 pl-9 pr-4 bg-muted/60 border border-border rounded-xl text-muted-foreground text-sm hover:bg-muted transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
      >
        {t("topBar.searchPlaceholder")}
        <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </div>
  );
}

// ── Notification bell ──────────────────────────────────────────────────────
const notifColors: Record<string, string> = {
 maintenance: "bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400",
 payment: "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400",
 lease: "bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
 message: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400",
 general: "bg-muted text-muted-foreground",
};
const notifIcons: Record<string, any> = {
  maintenance: Wrench,
  payment: DollarSign,
  lease: Building2,
  message: MessageSquare,
  system: AlertCircle,
  general: AlertCircle,
};

function NotificationBell() {
  const { notifications, unreadCount, markAllAsRead, markAsRead, dismissNotification, replyToNotification, clearAll } = useNotifications();
  const [showAll, setShowAll] = React.useState(false);
  const [replyingTo, setReplyingTo] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState("");
  const [replySending, setReplySending] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  // platform_admin gets a second view here — their own recent activity,
  // surfaced from the audit log that already records every mutation across
  // the app. Not shown for other roles, who don't have a "Notifications" vs
  // "My Activity" distinction requested of them.
  const [view, setView] = React.useState<"notifications" | "activity">("notifications");

  const { data: activity = [], isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["/api/users/me/activity"],
    queryFn: async () => {
      const r = await apiRequest("/api/users/me/activity?limit=30");
      return r.json();
    },
    enabled: isPlatformAdmin && dropdownOpen && view === "activity",
  });

  function activityLabel(a: { entityType: string; action: string; entityId: string }) {
    const verb = a.action === "CREATE" ? "Created" : a.action === "UPDATE" ? "Updated" : a.action === "DELETE" ? "Deleted" : "Acted on";
    const entity = a.entityType.replace(/_/g, " ");
    return `${verb} ${entity} #${a.entityId}`;
  }

  const visible = showAll
    ? notifications
    : notifications.filter(n => !n.read).slice(0, 20);

  function timeAgo(ts: string) {
    const d = new Date(ts);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  async function handleReply(id: string) {
    if (!replyText.trim()) return;
    setReplySending(true);
    try {
      await replyToNotification(id, replyText.trim());
      toast({ title: "Reply sent" });
      setReplyingTo(null);
      setReplyText("");
    } catch (e: any) {
      toast({ title: "Failed to send reply", description: e.message, variant: "destructive" });
    } finally {
      setReplySending(false);
    }
  }

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={open => {
      setDropdownOpen(open);
      if (!open) { setReplyingTo(null); setReplyText(""); }
    }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-9 w-9 p-0 rounded-lg hover:bg-muted">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center shadow-sm">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96 p-0 shadow-xl border-border rounded-xl overflow-hidden">

        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("topBar.notifications")}</span>
            {unreadCount > 0 && (
              <span className="text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 font-bold">{unreadCount}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
              onClick={() => setShowAll(f => !f)}
            >
              {showAll ? "Unread only" : "Show all"}
            </button>
            {unreadCount > 0 && (
              <button
                className="text-xs text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-1 font-medium"
                onClick={markAllAsRead}
                title="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>
        </div>

        {isPlatformAdmin && (
          <div className="flex items-center gap-1 px-3 pt-2 border-b border-border">
            {(["notifications", "activity"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "text-xs px-2.5 py-1.5 rounded-t-md font-medium transition-colors",
                  view === v ? "bg-muted text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v === "notifications" ? "Notifications" : "My Activity"}
              </button>
            ))}
          </div>
        )}

        {/* List */}
        {view === "activity" ? (
          activityLoading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
              {activity.map((a: any) => (
                <div key={a.id} className="px-4 py-2.5 text-sm">
                  <p className="text-foreground">{activityLabel(a)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(a.timestamp)}</p>
                </div>
              ))}
            </div>
          )
        ) : notifications.length === 0 || visible.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("topBar.allCaughtUp")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
            {visible.map(n => {
              const Icon = notifIcons[n.type] || AlertCircle;
              const isReplying = replyingTo === n.id;
              const canReply = n.type === "message";

              return (
                <div
                  key={n.id}
                  className={cn(
                    "px-4 py-3 transition-colors group",
                    !n.read && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                      notifColors[n.type] || notifColors.general
                    )}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.ts)}</p>
                        </div>
                        {/* Unread dot */}
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                        )}
                      </div>

                      {/* Action row */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {/* Navigate / open link */}
                        {n.link && (
                          <button
                            className="text-xs text-primary hover:underline font-medium"
                            onClick={() => { markAsRead(n.id); setLocation(n.link!); setDropdownOpen(false); }}
                          >
                            View →
                          </button>
                        )}
                        {/* Mark as read */}
                        {!n.read && (
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 hover:underline"
                            onClick={() => markAsRead(n.id)}
                          >
                            <CheckCheck className="w-3 h-3" /> Mark read
                          </button>
                        )}
                        {/* Reply — only for message-type */}
                        {canReply && (
                          <button
                            className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-medium hover:underline"
                            onClick={() => {
                              setReplyingTo(isReplying ? null : n.id);
                              setReplyText("");
                            }}
                          >
                            <MessageSquare className="w-3 h-3" />
                            {isReplying ? "Cancel" : "Reply"}
                          </button>
                        )}
                        {/* Dismiss */}
                        <button
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 ml-auto"
                          onClick={() => { dismissNotification(n.id); if (isReplying) setReplyingTo(null); }}
                        >
                          <X className="w-3 h-3" /> Dismiss
                        </button>
                      </div>

                      {/* Inline reply box */}
                      {isReplying && (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            autoFocus
                            rows={2}
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply(n.id);
                              if (e.key === "Escape") { setReplyingTo(null); setReplyText(""); }
                            }}
                            placeholder="Type your reply… (Ctrl+Enter to send)"
                            className="w-full rounded-lg border border-border bg-background text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 placeholder:text-muted-foreground/60"
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => { setReplyingTo(null); setReplyText(""); }}
                            >
                              Cancel
                            </button>
                            <button
                              disabled={!replyText.trim() || replySending}
                              onClick={() => handleReply(n.id)}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1"
                            >
                              {replySending
                                ? <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" /> Sending…</>
                                : <><MessageSquare className="w-3 h-3" /> Send</>
                              }
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between">
          <button className="text-xs text-primary font-medium hover:underline" onClick={() => { setLocation("/messages"); setDropdownOpen(false); }}>
            {t("topBar.viewAllActivity")}
          </button>
          {notifications.length > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={clearAll}
            >
              Clear all
            </button>
          )}
        </div>

      </DropdownMenuContent>
    </DropdownMenu>
  );
}


// ── Role-based avatar colours (all emerald shades) ────────────────────────
const ROLE_AVATAR: Record<string, { bg: string; label: string }> = {
  admin:       { bg: "from-emerald-700 to-emerald-900", label: "Admin"       },
  manager:     { bg: "from-emerald-500 to-emerald-700", label: "Manager"     },
  landlord:    { bg: "from-teal-500    to-teal-700",    label: "Landlord"    },
  staff:       { bg: "from-emerald-400 to-emerald-600", label: "Staff"       },
  caretaker:   { bg: "from-emerald-300 to-emerald-500", label: "Caretaker"   },
  tenant:      { bg: "from-green-400   to-green-600",   label: "Tenant"      },
  guard:       { bg: "from-lime-500    to-lime-700",    label: "Guard"       },
  contractor:  { bg: "from-teal-400    to-teal-600",    label: "Contractor"  },
};

function getRoleAvatar(role?: string) {
  return ROLE_AVATAR[role ?? ""] ?? { bg: "from-emerald-500 to-emerald-700", label: role ?? "User" };
}

// ── Main TopBar ────────────────────────────────────────────────────────────
export default function TopBar() {
 const { user } = useAuth();
 const logout = useLogout();
 const { theme, toggle: toggleTheme } = useDarkModeContext();
 const [, setLocation] = useLocation();
 const { t } = useTranslation();

 return (
 <div className="hidden lg:flex chrome-scope bg-background px-4 py-2.5 border-b border-border items-center gap-2">
 {/* Search */}
 <GlobalSearch />

 {/* Right actions */}
 <div className="flex items-center gap-1.5 flex-shrink-0">
 <DashboardSwitcher />

 {/* Divider only shown when DashboardSwitcher is visible (it hides itself for single-dashboard roles) */}
 <DashboardSwitcherDivider />

 {/* Theme toggle: light → gray → dark → light */}
 <Button
 variant="ghost" size="sm"
 onClick={toggleTheme}
 className="h-9 w-9 p-0 rounded-lg hover:bg-muted "
 title={theme === "light" ? t("topBar.switchToGray") : theme === "gray" ? t("topBar.switchToDark") : t("topBar.switchToLight")}
 >
 {theme === "light"
 ? <Contrast className="h-4 w-4 text-muted-foreground" />
 : theme === "gray"
 ? <Moon className="h-4 w-4 text-slate-400" />
 : <Sun className="h-4 w-4 text-amber-400" />
 }
 </Button>

 {/* Notifications */}
 <NotificationBell />


 <div className="w-px h-5 bg-muted mx-1" />

 {/* User menu */}
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" className="flex items-center gap-2 px-2 h-9 rounded-lg hover:bg-muted">
 <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${getRoleAvatar(user?.role).bg} flex items-center justify-center shadow-sm flex-shrink-0`}>
 <span className="text-white font-semibold text-xs">
 {user?.firstName?.[0] || "U"}{user?.lastName?.[0] || ""}
 </span>
 </div>
 <span className="text-sm font-medium text-foreground dark:text-muted-foreground hidden md:inline max-w-28 truncate">
 {user?.firstName} {user?.lastName}
 </span>
 <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden md:block" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52 shadow-xl border-border dark:border-gray-700 rounded-xl">
 <div className="px-3 py-2 border-b border-border dark:border-gray-800" >
 <p className="text-sm font-semibold text-foreground">{user?.firstName} {user?.lastName}</p>
 <p className="text-xs text-muted-foreground dark:text-muted-foreground capitalize mt-0.5 flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full bg-gradient-to-br ${getRoleAvatar(user?.role).bg}`} />
              {getRoleAvatar(user?.role).label}
            </p>
 </div>
 <DropdownMenuItem onClick={() => setLocation("/profile")} className="mt-1">
 <User className="mr-2 h-4 w-4" /> {t("common.profile")}
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={logout} className="text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30 cursor-pointer">
 <LogOut className="mr-2 h-4 w-4" /> {t("topBar.signOut")}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </div>
 );
}