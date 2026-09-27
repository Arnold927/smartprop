import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Shield, Search, CheckCircle, XCircle,
  MoreVertical, Settings, Mail, ChevronLeft, ChevronRight,
  RotateCcw, Save, Lock, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserInviteModal from "@/components/user-invite-modal";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
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
  admin:      "bg-red-100 text-red-700",
  manager:    "bg-blue-100 text-blue-700",
  landlord:   "bg-indigo-100 text-indigo-700",
  staff:      "bg-purple-100 text-purple-700",
  caretaker:  "bg-orange-100 text-orange-700",
  tenant:     "bg-emerald-50 text-emerald-700 border border-emerald-200",
  guard:      "bg-slate-100 text-muted-foreground",
  contractor: "bg-amber-100 text-amber-700",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

function StatusDot({ active }: { active: boolean }) {
  return (
    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-green-500" : "bg-gray-300"}`} />
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
    } catch {
      toast({ title: "Save failed", description: "Could not save permissions.", variant: "destructive" });
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
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900" >
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          Toggle permissions per role, then click <strong>Save</strong> on that role column to apply. Changes are saved per-role independently.
          <span className="ml-1 text-blue-500">Admin always retains full access.</span>
        </p>
      </div>

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
              {/* Save / Reset row */}
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
                                disabled={isLocked}
                                title={isLocked ? "Locked — always enabled for this role" : isOn ? "Click to revoke" : "Click to grant"}
                                className={`
                                  relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150
                                  ${isLocked
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
            Granted
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-4 h-4 rounded bg-muted dark:bg-gray-800 flex items-center justify-center">
              <XCircle className="w-2.5 h-2.5 opacity-30" />
            </div>
            Not granted
          </div>
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
  const [editingRole, setEditingRole] = useState<UserRole | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const usersEndpoint = withOrgParam("/api/users", orgIdParam);
  const { data: usersRaw = [], isLoading } = useQuery<any>({
    queryKey: [usersEndpoint],
    queryFn: async () => { const r = await apiRequest(usersEndpoint); return ensureArray(await r.json()); },
    retry: false,
  });
  const users: any[] = Array.isArray(usersRaw) ? usersRaw : (usersRaw?.results ?? []);

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      await apiRequest(withOrgParam(`/api/users/${id}`, orgIdParam), { method: "PATCH", data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [usersEndpoint] });
      toast({ title: "Role updated" });
      setEditingRole(null);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const stats = {
    total: users.length,
    active: users.filter(u => u.emailVerified).length,
    inactive: users.filter(u => !u.emailVerified).length,
    admins: users.filter(u => u.role === "admin").length,
  };

  const filtered = users.filter(u => {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleRoleFilter = (v: string) => { setRoleFilter(v); setPage(1); };
  const handlePageSize = (v: string) => { setPageSize(Number(v)); setPage(1); };

  if (isLoading) return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="h-8 bg-muted dark:bg-gray-700 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted dark:bg-gray-700 rounded-2xl" />)}</div>
      <div className="h-96 bg-muted dark:bg-gray-700 rounded-2xl" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">User Management</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{stats.total} users · {stats.active} active</p>
          </div>
          <UserInviteModal triggerText="Invite user" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total users", value: stats.total, icon: Users, color: "blue" },
            { label: "Active", value: stats.active, icon: CheckCircle, color: "green" },
            { label: "Pending", value: stats.inactive, icon: XCircle, color: "gray" },
            { label: "Admins", value: stats.admins, icon: Shield, color: stats.admins > 0 ? "red" : "gray" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="rounded-xl border border-slate-100 shadow-sm">
              <CardContent className="p-5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-${color}-50`}>
                  <Icon className={`w-4 h-4 text-${color}-600`} />
                </div>
                <div>
                  <p className="text-xl font-semibold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="users">
          <TabsList className="bg-card dark:bg-gray-900 border border-border dark:border-gray-800 p-1 rounded-xl">
            <TabsTrigger value="users" className="rounded-lg gap-2 data-[state=active]:bg-muted dark:data-[state=active]:bg-gray-800">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="permissions" className="rounded-lg gap-2 data-[state=active]:bg-muted dark:data-[state=active]:bg-gray-800">
              <Shield className="w-4 h-4" />
              Permissions by role
            </TabsTrigger>
          </TabsList>

          {/* Users tab */}
          <TabsContent value="users" className="mt-4 space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  className="pl-9 h-9 border-border dark:border-gray-700"
                  value={search}
                  onChange={e => handleSearch(e.target.value)}
                />
              </div>
              <Select value={roleFilter} onValueChange={handleRoleFilter}>
                <SelectTrigger className="w-44 h-9 border-border dark:border-gray-700 text-sm">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={handlePageSize}>
                  <SelectTrigger className="w-20 h-9 border-border dark:border-gray-700 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Table */}
            <Card className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              {filtered.length === 0 ? (
                <CardContent className="py-16 text-center">
                  <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">No users found</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">Invite users to get started</p>
                </CardContent>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10"><tr className="bg-muted border-b border-border" >
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">User</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Status</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Joined</th>
                          <th className="px-4 py-3 w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border dark:divide-gray-800">
                        {paginated.map(u => (
                          <tr key={u.id} className="hover:bg-muted/50 dark:hover:bg-gray-900 transition-colors group">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <Avatar className="w-8 h-8">
                                  <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-medium">
                                    {(u.firstName?.[0] ?? "?")}{(u.lastName?.[0] ?? "")}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate">
                                    {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email ?? "Unknown user"}
                                  </p>
                                  {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <div className="flex items-center gap-2">
                                <StatusDot active={!!u.emailVerified} />
                                <span className="text-sm text-muted-foreground">{u.emailVerified ? "Active" : "Pending"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                              {new Date(u.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                            </td>
                            <td className="px-4 py-3">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100">
                                    <MoreVertical className="w-3.5 h-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => {
                                    setEditingRole({ ...u, role_name: u.role, is_active: !!u.emailVerified, first_name: u.firstName, last_name: u.lastName });
                                    setNewRoleName(u.role);
                                  }}>
                                    <Settings className="w-4 h-4 mr-2" />Change role
                                  </DropdownMenuItem>
                                  {u.email && (
                                    <DropdownMenuItem onClick={() => window.open(`mailto:${u.email}`, "_blank")}>
                                      <Mail className="w-4 h-4 mr-2" />Email user
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => updateMutation.mutate({ id: u.id, data: { isActive: false } })}
                                  >
                                    <XCircle className="w-4 h-4 mr-2" />Deactivate
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination footer */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border dark:border-gray-800" >
                    <span className="text-xs text-muted-foreground">
                      {filtered.length === 0
                        ? "0"
                        : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)}`
                      } of {filtered.length} users
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="sm" className="h-8 w-8 p-0"
                        disabled={safePage <= 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground px-2">
                        Page {safePage} of {totalPages}
                      </span>
                      <Button
                        variant="ghost" size="sm" className="h-8 w-8 p-0"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* Permissions tab */}
          <TabsContent value="permissions" className="mt-4">
            <PermissionsTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit role dialog */}
      <Dialog open={!!editingRole} onOpenChange={o => !o && setEditingRole(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Change role</DialogTitle></DialogHeader>
          {editingRole && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 bg-muted dark:bg-gray-950 rounded-xl">
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="bg-blue-100 text-blue-600 text-xs">
                    {editingRole.first_name?.[0]}{editingRole.last_name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{editingRole.first_name} {editingRole.last_name}</p>
                  <p className="text-xs text-muted-foreground">{editingRole.email}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">New role</Label>
                <Select value={newRoleName} onValueChange={setNewRoleName}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSIGNABLE_ROLES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Reclassifying to Caretaker, Tenant, or Contractor? Use the dedicated Caretakers, Tenants, or Contractors page instead — it links the property assignment, lease, or contractor profile at the same time.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={updateMutation.isPending}
              onClick={() => editingRole && updateMutation.mutate({ id: String(editingRole.id), data: { role: newRoleName } })}
            >
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}