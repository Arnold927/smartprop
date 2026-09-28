import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Shield, CheckCircle, XCircle,
  Settings, Mail, ChevronLeft, ChevronRight,
  RotateCcw, Save, Lock, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserInviteModal from "@/components/user-invite-modal";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


interface UserRole {
  id: number;
  user_id?: string;
  role_name: string;
  role_description?: string;
  permissions: Record<string, any>;
  is_active: boolean;
  created_at: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

// Role keys match users.role varchar values — one per portal in the app.
const ROLE_LABELS: Record<string, string> = {
  admin:      "Admin",
  manager:    "Property Manager",
  landlord:   "Landlord",
  staff:      "Staff",
  caretaker:  "Caretaker",
  tenant:     "Tenant",
  guard:      "Guard",
  contractor: "Contractor",
};

// Roles assignable via the "Change role" dialog below — narrower than
// ROLE_LABELS (which also powers RoleBadge, showing every existing user's
// current role regardless of what's reassignable). caretaker, tenant, and
// contractor are excluded: all three need a linked business record
// (a property assignment, a lease, a contractor profile) that this dialog
// doesn't create — reclassifying someone into one of these here would
// leave them with a role but nothing behind it, landing them on an empty
// portal. Use the dedicated Caretakers/Tenants/Contractors pages instead.
const ASSIGNABLE_ROLES: Record<string, string> = {
  admin:   ROLE_LABELS.admin,
  manager: ROLE_LABELS.manager,
  landlord: ROLE_LABELS.landlord,
  staff:   ROLE_LABELS.staff,
  guard:   ROLE_LABELS.guard,
};

// Tooltip: which portal each role uses
const ROLE_PORTAL: Record<string, string> = {
  admin:      "Full admin dashboard",
  manager:    "Property manager dashboard",
  landlord:   "Landlord portal",
  staff:      "Staff portal",
  caretaker:  "Staff portal (property-scoped)",
  tenant:     "Tenant portal",
  guard:      "Gate portal",
  contractor: "Contractor portal",
};

const ROLE_COLORS: Record<string, string> = {
  admin:      "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  manager:    "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  landlord:   "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
  staff:      "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
  caretaker:  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  tenant:     "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  guard:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contractor: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Whether the "Permissions by role" matrix actually controls anything.
 *
 * It does not (yet): the toggles are saved to the user_roles table, but nothing on the server or in
 * the client ever reads them. Real access comes from ROUTE_POLICY (server/middleware/requireRole.ts)
 * and roleNav.ts, both fixed per role. user_roles is also one platform-wide table, not per
 * organisation. Leaving the switches live told admins they had changed access when they hadn't
 * (e.g. turning "Manage users" off for managers changed nothing), so the tab is a read-only guide
 * until enforcement is built. All the editing code below is kept — flip this to true when it is.
 */
const PERMISSIONS_ENFORCED = false;

/** Logins tied to a business record; their role is managed from the page that owns the record. */
const RECORD_BACKED_ROLES = ["tenant", "caretaker", "contractor"];

/** apiRequest throws the raw response body; pull the server's `message` out of it for toasts. */
const errMsg = (e: any): string => {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
};

// ─── Permission definitions ───────────────────────────────────────────────────
interface PermissionDef {
  key: string;
  label: string;
  description: string;
  category: string;
  locked?: string[]; // roles that can never have this toggled off/on
}

const PERMISSION_CATEGORIES = [
  "System",
  "Users & Roles",
  "Properties & Leases",
  "Finance",
  "Maintenance",
  "Projects & Tasks",
  "Communication",
  "Field & Labour",
];

const PERMISSIONS: PermissionDef[] = [
  // System
  { key: "full_access",            label: "Full system access",      description: "Unrestricted access to all modules and settings",            category: "System",              locked: ["admin"] },
  // Users
  { key: "can_manage_users",       label: "Manage users",            description: "Invite, deactivate, and change roles of users",              category: "Users & Roles" },
  { key: "can_view_users",         label: "View user list",          description: "See the list of users in the system",                        category: "Users & Roles" },
  // Properties
  { key: "can_manage_properties",  label: "Manage properties",       description: "Create, edit, and archive property listings",                category: "Properties & Leases" },
  { key: "can_manage_tenants",     label: "Manage tenants",          description: "Onboard, edit, and offboard tenant records",                 category: "Properties & Leases" },
  { key: "can_manage_leases",      label: "Manage leases",           description: "Create, renew, and terminate lease agreements",              category: "Properties & Leases" },
  { key: "can_view_documents",     label: "View documents",          description: "Access uploaded files, title deeds, and contracts",          category: "Properties & Leases" },
  { key: "can_upload_documents",   label: "Upload documents",        description: "Upload files, invoices, photos, and reports",                category: "Properties & Leases" },
  // Finance
  { key: "can_view_financials",    label: "View financials",         description: "See revenue, expenses, and financial summaries",             category: "Finance" },
  { key: "can_collect_rent",       label: "Collect rent",            description: "Record and reconcile rent payments from tenants",            category: "Finance" },
  { key: "can_make_payments",      label: "Make payments",           description: "Initiate rent or purchase payments",                         category: "Finance" },
  { key: "can_view_payment_history",label: "View payment history",   description: "See own transaction history and receipts",                   category: "Finance" },
  { key: "can_submit_invoices",    label: "Submit invoices",         description: "Submit purchase orders and payment claims",                  category: "Finance" },
  { key: "can_generate_reports",   label: "Generate reports",        description: "Export financial, occupancy, and operational reports",       category: "Finance" },
  // Maintenance
  { key: "can_manage_maintenance", label: "Manage maintenance",      description: "Create, assign, and close maintenance work orders",          category: "Maintenance" },
  { key: "can_submit_maintenance", label: "Submit maintenance requests", description: "Log a new maintenance or repair request",               category: "Maintenance" },
  { key: "can_view_maintenance",   label: "View maintenance status", description: "Track status of open and closed maintenance jobs",           category: "Maintenance" },
  // Projects
  { key: "can_manage_construction",label: "Manage projects",         description: "Create and oversee construction or renovation projects",     category: "Projects & Tasks" },
  { key: "can_assign_tasks",       label: "Assign tasks",            description: "Delegate tasks to team members and track completion",        category: "Projects & Tasks" },
  { key: "can_view_assigned_jobs", label: "View assigned jobs",      description: "See tasks and jobs assigned to you",                         category: "Projects & Tasks" },
  { key: "can_view_project_progress", label: "View project progress","description": "Track timelines and milestones for active projects",       category: "Projects & Tasks" },
  // Communication
  { key: "can_message",            label: "Send messages",           description: "Use the internal messaging and notification system",         category: "Communication" },
  { key: "can_view_announcements", label: "View announcements",      description: "Receive broadcast notices from property management",         category: "Communication" },
  // Field
  { key: "can_clock_in_out",       label: "Clock in / out",          description: "Record attendance and working hours",                        category: "Field & Labour" },
  { key: "can_submit_timesheets",  label: "Submit timesheets",       description: "Log daily hours and submit for approval",                    category: "Field & Labour" },
];

// ─── Default permissions per role ────────────────────────────────────────────
type RoleKey = keyof typeof ROLE_LABELS;
type PermMatrix = Record<RoleKey, Record<string, boolean>>;

// Default permissions keyed by the actual users.role value.
// These are the fallback used when the DB hasn't been seeded yet
// and also serve as the "Reset to defaults" baseline.
const DEFAULT_PERMISSIONS: PermMatrix = {
  admin: Object.fromEntries(PERMISSIONS.map(p => [p.key, true])),

  manager: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Full property-management suite — mirrors the admin dashboard minus system-admin controls
    ["can_manage_users","can_view_users","can_manage_properties","can_manage_tenants",
     "can_manage_leases","can_view_documents","can_upload_documents","can_view_financials",
     "can_collect_rent","can_generate_reports","can_manage_maintenance","can_view_maintenance",
     "can_assign_tasks","can_view_assigned_jobs","can_message","can_view_announcements",
     "can_submit_invoices"].includes(p.key)
  ])),

  landlord: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Landlord portal: own portfolio + financials + maintenance visibility
    ["can_view_users","can_manage_properties","can_manage_tenants",
     "can_manage_leases","can_view_documents","can_upload_documents",
     "can_view_financials","can_collect_rent","can_generate_reports",
     "can_view_maintenance","can_message","can_view_announcements"].includes(p.key)
  ])),

  staff: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Staff portal: operational — maintenance, security, utilities, inspections
    ["can_view_users","can_view_documents","can_upload_documents",
     "can_manage_maintenance","can_view_maintenance","can_assign_tasks",
     "can_view_assigned_jobs","can_submit_invoices","can_message",
     "can_view_announcements","can_clock_in_out","can_submit_timesheets"].includes(p.key)
  ])),

  caretaker: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Caretaker: property-scoped — maintenance + visitor log + messages only
    ["can_submit_maintenance","can_view_maintenance","can_manage_maintenance",
     "can_view_announcements","can_message","can_clock_in_out"].includes(p.key)
  ])),

  tenant: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Tenant portal: self-service — pay rent, raise issues, view docs
    ["can_submit_maintenance","can_make_payments","can_view_payment_history",
     "can_view_documents","can_view_maintenance","can_message","can_view_announcements"].includes(p.key)
  ])),

  guard: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Gate portal: check-in / visitor log only
    ["can_view_announcements","can_message"].includes(p.key)
  ])),

  contractor: Object.fromEntries(PERMISSIONS.map(p => [p.key,
    // Contractor portal: view assigned jobs, submit invoices, upload docs
    ["can_view_documents","can_upload_documents","can_submit_invoices",
     "can_view_assigned_jobs","can_view_maintenance","can_message",
     "can_view_announcements"].includes(p.key)
  ])),
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role] ?? "bg-muted text-muted-foreground"}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ─── Permissions Tab Component ───────────────────────────────────────────────
function PermissionsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Fetch live permissions from API ────────────────────────────────────────
  const { data: rolesData, isLoading: rolesLoading, isError } = useQuery<any[]>({
    queryKey: ["/api/roles"],
    queryFn: async () => {
      const r = await apiRequest("/api/roles");
      return r.json();
    },
    retry: false,
    // While the matrix is only a guide there is nothing saved worth loading — and showing stored
    // values that nothing enforces would be a second way to mislead.
    enabled: PERMISSIONS_ENFORCED,
  });

  // Merge API data over DEFAULT_PERMISSIONS so new permission keys are always present
  const serverMatrix = useMemo<PermMatrix>(() => {
    const base: PermMatrix = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
    if (!rolesData) return base;
    for (const roleRow of rolesData) {
      const key = roleRow.roleName as RoleKey;
      if (key in base && roleRow.permissions && typeof roleRow.permissions === "object") {
        base[key] = { ...base[key], ...roleRow.permissions };
      }
    }
    return base;
  }, [rolesData]);

  const [matrix, setMatrix] = useState<PermMatrix>(() =>
    JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS))
  );
  const [savedMatrix, setSavedMatrix] = useState<PermMatrix>(() =>
    JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS))
  );
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());

  // Sync local state once API data arrives
  useEffect(() => {
    setMatrix(JSON.parse(JSON.stringify(serverMatrix)));
    setSavedMatrix(JSON.parse(JSON.stringify(serverMatrix)));
    setDirtyRoles(new Set());
  }, [serverMatrix]);

  const toggle = useCallback((role: RoleKey, permKey: string) => {
    const def = PERMISSIONS.find(p => p.key === permKey);
    if (def?.locked?.includes(role)) return;
    if (role === "admin" && permKey === "full_access") return;
    setMatrix(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next[role][permKey] = !next[role][permKey];
      return next;
    });
    setDirtyRoles(prev => new Set(prev).add(role));
  }, []);

  const resetRole = useCallback((role: RoleKey) => {
    setMatrix(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next[role] = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS[role]));
      return next;
    });
    setDirtyRoles(prev => { const s = new Set(prev); s.delete(role); return s; });
    toast({ title: "Reset to defaults", description: `${ROLE_LABELS[role]} permissions restored locally. Save to apply.` });
  }, [toast]);

  const saveRole = useCallback(async (role: RoleKey) => {
    setSavingRole(role);
    try {
      await apiRequest(`/api/roles/${role}/permissions`, {
        method: "PUT",
        data: { permissions: matrix[role] },
      });
      setSavedMatrix(prev => {
        const next = JSON.parse(JSON.stringify(prev));
        next[role] = JSON.parse(JSON.stringify(matrix[role]));
        return next;
      });
      setDirtyRoles(prev => { const s = new Set(prev); s.delete(role); return s; });
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Permissions saved", description: `${ROLE_LABELS[role]} updated successfully.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    } finally {
      setSavingRole(null);
    }
  }, [matrix, toast, queryClient]);

  const roleCounts = Object.keys(ROLE_LABELS).reduce((acc, role) => {
    acc[role] = Object.values(matrix[role as RoleKey]).filter(Boolean).length;
    return acc;
  }, {} as Record<string, number>);

  if (rolesLoading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-12 bg-muted dark:bg-gray-800 rounded-xl" />
      <div className="h-96 bg-muted dark:bg-gray-800 rounded-2xl" />
    </div>
  );

  if (isError) return (
    <div className="flex items-start gap-3 px-4 py-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900" >
      <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-sm font-medium text-red-700 dark:text-red-300">Could not load roles</p>
        <p className="text-xs text-red-500 mt-1">
          Ensure the <code className="bg-red-100 dark:bg-red-900 px-1 rounded">user_roles</code> table
          has been seeded and that you are logged in as an <strong>admin</strong> or <strong>manager</strong>.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Info banner */}
      {PERMISSIONS_ENFORCED ? (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900" >
          <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            Toggle permissions per role, then click <strong>Save</strong> on that role column to apply. Changes are saved per-role independently.
            <span className="ml-1 text-blue-500">Admin always retains full access.</span>
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900">
          <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            <strong>A guide to each role's default access.</strong> Access is currently fixed for each role by the system and
            can't yet be customised per organisation, so these can't be changed here. To change what someone can do, change their
            role on the Users tab.
          </p>
        </div>
      )}

      {/* Matrix card */}
      <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 880 }}>
            {/* Column headers */}
            <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                <th className="text-left py-3 px-4 text-muted-foreground font-medium w-52 sticky left-0 bg-muted/60 dark:bg-gray-900 z-10 transition-colors duration-300">
                  Permission
                </th>
                {(Object.entries(ROLE_LABELS) as [RoleKey, string][]).map(([roleKey, roleLabel]) => (
                  <th key={roleKey} className="py-3 px-2 text-center min-w-[110px]">
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[roleKey] ?? "bg-muted text-muted-foreground"}`}
                        title={ROLE_PORTAL[roleKey]}
                      >
                        {roleLabel}
                      </span>
                      <span className="text-muted-foreground font-normal text-[10px]">
                        {roleCounts[roleKey]}/{PERMISSIONS.length} perms
                      </span>
                      <span className="text-[9px] text-muted-foreground/60 leading-tight text-center max-w-[90px] hidden xl:block">
                        {ROLE_PORTAL[roleKey]}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
              {/* Save / Reset row — only when permissions are actually enforced */}
              {PERMISSIONS_ENFORCED && (
              <tr className="border-b border-border dark:border-gray-800 bg-card dark:bg-gray-900">
                <td className="py-2 px-4 sticky left-0 bg-card dark:bg-gray-900 z-10 transition-colors duration-300" />
                {(Object.keys(ROLE_LABELS) as RoleKey[]).map(roleKey => (
                  <td key={roleKey} className="py-2 px-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <Button
                        size="sm"
                        className="h-7 w-full max-w-[90px] text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
                        disabled={!dirtyRoles.has(roleKey) || savingRole !== null}
                        onClick={() => saveRole(roleKey)}
                      >
                        {savingRole === roleKey ? (
                          <span className="animate-pulse">Saving…</span>
                        ) : (
                          <><Save className="w-3 h-3" />Save</>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-full max-w-[90px] text-xs gap-1 text-muted-foreground hover:text-foreground"
                        disabled={!dirtyRoles.has(roleKey)}
                        onClick={() => resetRole(roleKey)}
                      >
                        <RotateCcw className="w-3 h-3" />Reset
                      </Button>
                    </div>
                  </td>
                ))}
              </tr>
              )}
            </thead>

            <tbody>
              {PERMISSION_CATEGORIES.map(category => {
                const catPerms = PERMISSIONS.filter(p => p.category === category);
                return (
                  <>
                    {/* Category separator row */}
                    <tr key={`cat-${category}`} className="bg-muted/30 dark:bg-gray-950/50">
                      <td
                        colSpan={Object.keys(ROLE_LABELS).length + 1}
                        className="py-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest sticky left-0 bg-muted/30 dark:bg-gray-950/50 transition-colors duration-300"
                      >
                        {category}
                      </td>
                    </tr>

                    {catPerms.map(perm => (
                      <tr
                        key={perm.key}
                        className="border-b border-border/40 dark:border-gray-800/60 hover:bg-muted/40 dark:hover:bg-gray-900/50 transition-colors duration-300 group"
                      >
                        {/* Permission label */}
                        <td className="py-2.5 px-4 sticky left-0 bg-card dark:bg-gray-950 group-hover:bg-muted/40 dark:group-hover:bg-gray-900/50 z-10 transition-colors duration-300">
                          <div>
                            <p className="font-medium text-foreground">{perm.label}</p>
                            <p className="text-muted-foreground text-[10px] leading-tight mt-0.5">{perm.description}</p>
                          </div>
                        </td>

                        {/* Toggles per role */}
                        {(Object.keys(ROLE_LABELS) as RoleKey[]).map(roleKey => {
                          const isOn = matrix[roleKey][perm.key];
                          const isLocked = perm.locked?.includes(roleKey) || (roleKey === "admin" && perm.key === "full_access");
                          const isDirty = savedMatrix[roleKey][perm.key] !== isOn;

                          return (
                            <td key={roleKey} className="py-2.5 px-2 text-center">
                              <button
                                onClick={() => toggle(roleKey, perm.key)}
                                disabled={isLocked || !PERMISSIONS_ENFORCED}
                                title={!PERMISSIONS_ENFORCED ? (isOn ? "Included by default" : "Not included by default") : isLocked ? "Locked — always enabled for this role" : isOn ? "Click to revoke" : "Click to grant"}
                                className={`
                                  relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150
                                  ${!PERMISSIONS_ENFORCED
                                    ? "cursor-default"
                                    : isLocked
                                      ? "cursor-not-allowed opacity-70"
                                      : "cursor-pointer hover:scale-110 active:scale-95"
                                  }
                                  ${isOn
                                    ? "bg-green-100 dark:bg-green-950/60 text-green-600 dark:text-green-400"
                                    : "bg-muted dark:bg-gray-800 text-muted-foreground"
                                  }
                                `}
                              >
                                {isLocked ? (
                                  <Lock className="w-3 h-3" />
                                ) : isOn ? (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 opacity-30" />
                                )}
                                {/* Dirty indicator dot */}
                                {isDirty && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-white dark:border-gray-950" />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 px-4 py-3 border-t border-border dark:border-gray-800 bg-muted/30 dark:bg-gray-950/40">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-950/60 flex items-center justify-center">
              <CheckCircle className="w-2.5 h-2.5 text-green-600" />
            </div>
            {PERMISSIONS_ENFORCED ? "Granted" : "Included by default"}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-4 h-4 rounded bg-muted dark:bg-gray-800 flex items-center justify-center">
              <XCircle className="w-2.5 h-2.5 opacity-30" />
            </div>
            {PERMISSIONS_ENFORCED ? "Not granted" : "Not included"}
          </div>
          {PERMISSIONS_ENFORCED && (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-4 h-4 rounded bg-muted dark:bg-gray-800 flex items-center justify-center">
                  <Lock className="w-2.5 h-2.5" />
                </div>
                Locked
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                Unsaved change
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function UserManagement() {
  const guard = useRoleGuard([...ROLES.ADMIN_MANAGER, "platform_admin"]);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();
  const [location] = useLocation();
  const orgIdParam = getOrgIdFromSearch(location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState<any | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const callerRole: string = (user as any)?.role ?? "";
  const callerId: string   = (user as any)?.id ?? (user as any)?.userId ?? "";
  const callerIsAdmin = callerRole === "admin" || callerRole === "platform_admin";

  const usersEndpoint = withOrgParam("/api/users", orgIdParam);
  const { data: usersRaw = [], isLoading, isError, error } = useQuery<any>({
    queryKey: [usersEndpoint],
    queryFn: async () => { const r = await apiRequest(usersEndpoint); return ensureArray(await r.json()); },
    retry: false,
  });
  const users: any[] = Array.isArray(usersRaw) ? usersRaw : (usersRaw?.results ?? []);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      await apiRequest(withOrgParam(`/api/users/${id}`, orgIdParam), { method: "PATCH", data });
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [usersEndpoint] });
      toast({
        title: data.role !== undefined ? "Role updated" : data.isActive === false ? "User deactivated" : "User reactivated",
        description: data.isActive === false ? "They've been signed out and can't log in until reactivated." : undefined,
      });
      setEditingUser(null);
      setConfirmDeactivate(null);
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: errMsg(e), variant: "destructive" });
      setConfirmDeactivate(null);
    },
  });

  /** Active = signed in before and switched on; Pending = invited but hasn't set a password yet; Deactivated = switched off. */
  const statusOf = (u: any): "active" | "pending" | "deactivated" =>
    u.isActive === false ? "deactivated" : !u.emailVerified ? "pending" : "active";

  // Mirrors the server's rules (users.ts PATCH /:id) so nobody is offered an action that will be refused.
  const canActOn      = (u: any) => u.id !== callerId && !(callerRole === "manager" && u.role === "admin");
  const canChangeRole = (u: any) => canActOn(u) && !RECORD_BACKED_ROLES.includes(u.role) && u.isActive !== false;

  const stats = {
    total:       users.length,
    active:      users.filter(u => statusOf(u) === "active").length,
    pending:     users.filter(u => statusOf(u) === "pending").length,
    deactivated: users.filter(u => statusOf(u) === "deactivated").length,
  };

  const filtered = users.filter(u => {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""}`.toLowerCase();
    return (!search || name.includes(search.toLowerCase()))
      && (roleFilter === "all" || u.role === roleFilter)
      && (statusFilter === "all" || statusOf(u) === statusFilter);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleRoleFilter = (v: string) => { setRoleFilter(v); setPage(1); };
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1); };
  const handlePageSize = (v: string) => { setPageSize(Number(v)); setPage(1); };

  const displayName = (u: any) => (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email ?? "Unknown user");
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";

  const assignable = Object.entries(ASSIGNABLE_ROLES).filter(([k]) => callerIsAdmin || k !== "admin");

  if (isLoading) return (
    <PageShell>
      <div className="space-y-5 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-2xl" />)}</div>
        <div className="h-96 bg-muted rounded-2xl" />
      </div>
    </PageShell>
  );

  return (
    <PageShell>
      <PageHeader
        title="User Management"
        subtitle={`${stats.total} users · ${stats.active} active${stats.pending ? ` · ${stats.pending} pending` : ""}`}
        icon={<Users className="w-5 h-5" />}
        actions={<UserInviteModal triggerText="Invite user" />}
      />

      <StatsGrid cols={4}>
        <StatTile label="Total users" value={stats.total} icon={<Users className="w-4 h-4" />} accent="blue" />
        <StatTile label="Active" value={stats.active} icon={<CheckCircle className="w-4 h-4" />} accent="emerald" />
        <StatTile label="Pending invite" value={stats.pending} icon={<Mail className="w-4 h-4" />} accent="amber" />
        <StatTile label="Deactivated" value={stats.deactivated} icon={<XCircle className="w-4 h-4" />} accent="red" />
      </StatsGrid>

      <Tabs defaultValue="users">
        <TabsList className="bg-card border border-border p-1 rounded-xl">
          <TabsTrigger value="users" className="rounded-lg gap-2 data-[state=active]:bg-muted">
            <Users className="w-4 h-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="permissions" className="rounded-lg gap-2 data-[state=active]:bg-muted">
            <Shield className="w-4 h-4" />
            {PERMISSIONS_ENFORCED ? "Permissions by role" : "Role access guide"}
          </TabsTrigger>
        </TabsList>

        {/* Users tab */}
        <TabsContent value="users" className="mt-4 space-y-3">
          <FilterBar
            search={search}
            onSearch={handleSearch}
            placeholder="Search by name or email..."
            filters={
              <>
                <Select value={roleFilter} onValueChange={handleRoleFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="All roles" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={handleStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending invite</SelectItem>
                    <SelectItem value="deactivated">Deactivated</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            actions={
              <Select value={String(pageSize)} onValueChange={handlePageSize}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                </SelectContent>
              </Select>
            }
          />

          {isError ? (
            <SectionCard>
              <EmptyState
                icon={<XCircle />}
                title="Couldn't load users"
                description={errMsg(error)}
                size="lg"
              />
            </SectionCard>
          ) : (
            <SectionCard padding="none">
              <SPTable
                data={paginated}
                emptyState={
                  <EmptyState
                    icon={<Users />}
                    title={users.length ? "No users match your filters" : "No users found"}
                    description={users.length ? undefined : "Invite users to get started"}
                    size="lg"
                  />
                }
                columns={[
                  {
                    header: "User",
                    cell: (u: any) => (
                      <div className="flex items-center gap-3">
                        <SPAvatar name={displayName(u)} />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {displayName(u)}
                            {u.id === callerId && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                          </p>
                          {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                        </div>
                      </div>
                    ),
                  },
                  { header: "Role", cell: (u: any) => <RoleBadge role={u.role} /> },
                  { header: "Status", cell: (u: any) => <SPBadge status={statusOf(u)} /> },
                  {
                    header: "Last login",
                    hideOnMobile: true,
                    cell: (u: any) => <span className="text-xs text-muted-foreground">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</span>,
                  },
                  {
                    header: "Joined",
                    hideOnMobile: true,
                    cell: (u: any) => <span className="text-xs text-muted-foreground">{fmtDate(u.createdAt)}</span>,
                  },
                  {
                    header: "",
                    align: "right",
                    cell: (u: any) => {
                      const items = [
                        ...(canChangeRole(u) ? [{
                          label: "Change role", icon: <Settings className="w-4 h-4" />,
                          onClick: () => { setEditingUser(u); setNewRoleName(u.role); },
                        }] : []),
                        ...(u.email ? [{
                          label: "Email user", icon: <Mail className="w-4 h-4" />,
                          onClick: () => window.open(`mailto:${u.email}`, "_blank"),
                        }] : []),
                        ...(canActOn(u) && u.isActive !== false ? [{
                          label: "Deactivate", icon: <XCircle className="w-4 h-4" />, destructive: true, separator: true,
                          onClick: () => setConfirmDeactivate(u),
                        }] : []),
                        ...(canActOn(u) && u.isActive === false ? [{
                          label: "Reactivate", icon: <CheckCircle className="w-4 h-4" />, separator: true,
                          onClick: () => updateMutation.mutate({ id: u.id, data: { isActive: true } }),
                        }] : []),
                      ];
                      return items.length ? <ActionMenu items={items} /> : null;
                    },
                  },
                ]}
              />

              {filtered.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {`${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)}`} of {filtered.length} users
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={safePage <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">Page {safePage} of {totalPages}</span>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={safePage >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          <p className="text-xs text-muted-foreground">
            Tenants, caretakers and contractors are managed from their own pages, so their role can't be changed here.
            {callerRole === "manager" && " Managers can't modify admin accounts."}
          </p>
        </TabsContent>

        {/* Permissions tab */}
        <TabsContent value="permissions" className="mt-4">
          <PermissionsTab />
        </TabsContent>
      </Tabs>

      {/* Change role dialog */}
      <Dialog open={!!editingUser} onOpenChange={o => !o && setEditingUser(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Change role</DialogTitle></DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                <SPAvatar name={displayName(editingUser)} size="md" />
                <div>
                  <p className="text-sm font-medium">{displayName(editingUser)}</p>
                  <p className="text-xs text-muted-foreground">{editingUser.email}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">New role</Label>
                <Select value={newRoleName} onValueChange={setNewRoleName}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignable.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                {newRoleName && ROLE_PORTAL[newRoleName] && (
                  <p className="text-xs text-muted-foreground mt-1.5">Signs in to: {ROLE_PORTAL[newRoleName]}.</p>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  Need Caretaker, Tenant, or Contractor? Use the dedicated Caretakers, Tenants, or Contractors page instead — it links the property assignment, lease, or contractor profile at the same time.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={updateMutation.isPending || !editingUser || newRoleName === editingUser?.role}
              onClick={() => editingUser && updateMutation.mutate({ id: String(editingUser.id), data: { role: newRoleName } })}
            >
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeactivate}
        onClose={() => setConfirmDeactivate(null)}
        onConfirm={() => confirmDeactivate && updateMutation.mutate({ id: confirmDeactivate.id, data: { isActive: false } })}
        loading={updateMutation.isPending}
        destructive
        title={`Deactivate ${confirmDeactivate ? displayName(confirmDeactivate) : "user"}?`}
        description="They'll be signed out straight away and won't be able to log in again until you reactivate them. Their data is kept."
        confirmLabel="Deactivate"
      />
    </PageShell>
  );
}