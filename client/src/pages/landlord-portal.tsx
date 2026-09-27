/**
 * Landlord Portal — owner-facing dashboard for portfolio management.
 *
 * API surface:
 *   GET  /api/landlord-portal/dashboard          — KPIs, trends, occupancy
 *   GET  /api/landlord-portal/properties/stats   — per-property stats for cards
 *   GET  /api/landlord-portal/maintenance        — server-filtered + paginated
 *   GET  /api/landlord-portal/reports            — paginated, sorted, date-filtered
 *   POST /api/landlord-portal/reports/generate
 *   GET  /api/landlord-portal/reports/:id/download
 *   POST /api/landlord-portal/reports/:id/email
 */

import React, { useState, useMemo, useCallback, useReducer, useEffect, useRef, memo, Component } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWsEvent } from "@/hooks/useWebSocket";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building, TrendingUp, FileText, Receipt, DollarSign, Users, Home,
  BarChart3, ArrowUpRight, ArrowDownRight, Plus, LayoutDashboard, Bell,
  Wrench, ChevronRight, ChevronLeft, Mail, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Search, X, ArrowUp, ArrowDown, CalendarRange, Phone, MessageSquare, Send, Paperclip, Users2, Download,
  Trash2, ThumbsUp, ThumbsDown, ShieldCheck, ShieldX, FolderOpen, PlusCircle, Edit, Star, User,
  Landmark, Building2, CalendarCheck, MoreHorizontal} from "lucide-react";
import { CurrencyDisplay } from "@/components/ui/currency-display";
import AddPropertyModal from "@/components/modals/add-property-modal";
import { useToast }        from "@/hooks/use-toast";
import { apiRequest, uploadWithAuth } from "@/lib/queryClient";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { fmtDate, fmtDateShort, fmtKES } from "@shared/reportFormatters";
import { PageShell, PageHeader, SectionCard, SPBadge, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { FirstRunOverlay, needsFirstRun, markFirstRunDone } from "@/components/first-run-overlay";
import { useAuth } from "@/hooks/useAuth";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Property {
  id: number;
  name: string;
  address: string;
  propertyType?: string;
  imageUrl?: string;
  totalUnits?: number;
  description?: string;
}

interface PropertyStats {
  id: number;
  totalUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  activeLeases: number;
  monthlyRevenue: string;
}

interface PortfolioSummary {
  totalRevenue: string;
  netIncome: string;
  occupancyRate: string;
  totalProperties: number;
  totalExpenses?: string;
  totalArrears?: string;
  ytdRevenue?: string;
  ytdExpenses?: string;
  ytdNetIncome?: string;
  totalDeposits?: string | number;
  portfolioValue?: string | number;
  grossYield?: string | number;
  collectedThisMonth?: string | number;
  expectedThisMonth?: string | number;
}

interface MonthlyTrend {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

interface ExpenseCategory { name: string; value: number }
interface VacancyItem { unitNumber: string; propertyName: string; leaseEnd: string | null }

interface DashboardData {
  properties: Property[];
  summary: PortfolioSummary;
  monthlyReport: { totalRevenue: string; totalExpenses: string; netIncome: string };
  reports: PortfolioReport[];
  trends?: MonthlyTrend[];
  expenseCategories?: ExpenseCategory[];
  upcomingVacancies?: VacancyItem[];
  leasesExpiringSoon?: number;
  currentVacancies?: number;
  contactManager?: { name: string; initials: string; email?: string };
  recentDocuments?: { id: number; name: string; size: string; type: string; url?: string }[];
  cashFlowSchedule?: { tenantId: number; name: string; property: string; unit: string; monthlyRent: number; paid: boolean }[];
}

interface PortfolioReport {
  id: number;
  reportType: string;
  reportPeriodStart: string;
  reportPeriodEnd: string;
  totalRevenue: string;
  totalExpenses: string;
  netIncome: string;
  occupancyRate?: string;
  status: string;
  createdAt: string;
  pdfPath?: string;
}

interface MaintenanceRequest {
  id: number;
  ticketNumber: string;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "assigned" | "in_progress" | "completed" | "cancelled";
  assignedTo?: string | null;
  notes?: string | null;
  estimatedCost?: string | null;
  actualCost?: string | null;
  createdAt: string;
  property?: { id?: number; name: string } | null;
  unit?: { unitNumber: string } | null;
}

interface PagedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Unit Grid types ──────────────────────────────────────────────────────────
interface UnitGridUnit {
  id: number;
  unitNumber: string;
  isOccupied: boolean;
  bedrooms?: number | null;
  bathrooms?: number | null;
  monthlyRent?: string | null;
  tenantId?: number | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  leaseEndDate?: string | null;
  paymentStatus?: "paid" | "unpaid" | "partial" | "overdue" | null;
  lastPaymentDate?: string | null;
  daysOverdue?: number | null;
}

interface UnitGridProperty {
  id: number;
  name: string;
  address: string;
  propertyType?: string | null;
  units: UnitGridUnit[];
}

// ─── Notification types ───────────────────────────────────────────────────────
interface PortalNotification {
  id: string;
  type: "overdue" | "lease_expiry" | "maintenance" | "vacancy";
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  tab?: string;        // which tab to navigate to
  createdAt: string;  // ISO string
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const PRIORITY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  low:    { label: "Low",    bg: "bg-slate-50", text: "text-muted-foreground" },
  medium: { label: "Medium", bg: "bg-blue-50 dark:bg-blue-950/30",  text: "text-blue-600 dark:text-blue-400"  },
  high:   { label: "High",   bg: "bg-red-50 dark:bg-red-950/30",   text: "text-red-600 dark:text-red-400"   },
  urgent: { label: "Urgent", bg: "bg-red-100",  text: "text-red-700"   },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  pending:     { label: "Pending",     variant: "outline"     },
  assigned:    { label: "Assigned",    variant: "outline"     },
  in_progress: { label: "In Progress", variant: "secondary"   },
  completed:   { label: "Completed",   variant: "secondary"   },
  cancelled:   { label: "Cancelled",   variant: "secondary"   },
  on_hold:     { label: "On Hold",     variant: "destructive" },
};

const PAGE_SIZES = [5, 10, 20, 50] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getRelativeTime = (d: string | null | undefined): string => {
  if (!d) return "—";
  const diff  = Date.now() - new Date(d).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1)  return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days} days ago`;
  return fmtDate(d);
};

function buildDateRange(type: "monthly" | "quarterly" | "annual") {
  const now = new Date();
  if (type === "monthly") {
    return {
      startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      endDate:   new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
    };
  }
  if (type === "quarterly") {
    const q = Math.floor(now.getMonth() / 3);
    return {
      startDate: new Date(now.getFullYear(), q * 3, 1).toISOString(),
      endDate:   new Date(now.getFullYear(), (q + 1) * 3, 0).toISOString(),
    };
  }
  return {
    startDate: new Date(now.getFullYear(), 0, 1).toISOString(),
    endDate:   new Date(now.getFullYear(), 11, 31).toISOString(),
  };
}

// Stable auth header builder — defined outside component so it doesn't re-create on render
// getAuthHeader removed — all requests now use apiRequest() which handles token refresh automatically

function buildOwnerUrl(base: string, ownerId?: string, extra?: Record<string, string | number>) {
  const params = new URLSearchParams();
  if (ownerId) params.set("ownerId", ownerId);
  if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
  return `${base}?${params.toString()}`;
}

// ─── sessionStorage state persistence ─────────────────────────────────────────
// Persists tab-specific filter state so it survives switching tabs.
// Uses a single JSON blob per key to avoid multiple storage calls.
//
// The key is owner-scoped so that filters from one landlord account don't
// bleed into another when the same browser is shared (e.g. admin impersonation
// or a shared device with multiple logins).

const sessionKey = (ownerId?: string) =>
  ownerId ? `landlord_portal_filters:${ownerId}` : "landlord_portal_filters";

interface PersistedFilters {
  reportSearch:    string;
  reportPageSize:  number;
  reportPage:      number;
  reportSortBy:    string;
  reportSortDir:   "asc" | "desc";
  reportStartDate: string;
  reportEndDate:   string;
  maintSearch:     string;
  maintPageSize:   number;
  maintPage:       number;
  maintStatus:     string;
  propSearch:      string;
}

const DEFAULT_FILTERS: PersistedFilters = {
  reportSearch:    "",
  reportPageSize:  10,
  reportPage:      1,
  reportSortBy:    "createdAt",
  reportSortDir:   "desc",
  reportStartDate: "",
  reportEndDate:   "",
  maintSearch:     "",
  maintPageSize:   10,
  maintPage:       1,
  maintStatus:     "active",
  propSearch:      "",
};

function loadFilters(ownerId?: string): PersistedFilters {
  try {
    const raw = sessionStorage.getItem(sessionKey(ownerId));
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: PersistedFilters, ownerId?: string): void {
  try { sessionStorage.setItem(sessionKey(ownerId), JSON.stringify(f)); } catch { /* quota */ }
}

type FilterAction =
  | { type: "SET"; key: keyof PersistedFilters; value: PersistedFilters[keyof PersistedFilters] }
  | { type: "SET_MANY"; patch: Partial<PersistedFilters> }
  | { type: "RESET_REPORT_PAGE" }
  | { type: "RESET_MAINT_PAGE" };

// makeFilterReducer closes over ownerId so saveFilters can write to the
// owner-scoped key without threading ownerId through every dispatch call.
function makeFilterReducer(ownerId?: string) {
  return function filterReducer(state: PersistedFilters, action: FilterAction): PersistedFilters {
    let next: PersistedFilters;
    switch (action.type) {
      case "SET":
        next = { ...state, [action.key]: action.value };
        break;
      case "SET_MANY":
        next = { ...state, ...action.patch };
        break;
      case "RESET_REPORT_PAGE":
        next = { ...state, reportPage: 1 };
        break;
      case "RESET_MAINT_PAGE":
        next = { ...state, maintPage: 1 };
        break;
      default:
        return state;
    }
    saveFilters(next, ownerId);
    return next;
  };
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
  title, value, icon: Icon, color, bg, trend, trendUp, trendLabel, isCurrency = true, sparkData,
}: {
  title: string; value: string | number; icon: React.ElementType;
  color: string; bg: string; trend?: string; trendUp?: boolean;
  trendLabel?: string; isCurrency?: boolean; sparkData?: number[];
}) {
  return (
    <Card className="border border-border shadow-sm overflow-hidden hover:shadow-md transition-all duration-200">
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-3">
          <div className={`${bg} p-2.5 rounded-xl`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          {trend && (
            <div className="text-right">
              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
                trendUp
                  ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "text-red-600 bg-red-50 dark:bg-red-950/30"
              }`}>
                {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {trend}
              </span>
              {trendLabel && <p className="text-[10px] text-muted-foreground mt-1">{trendLabel}</p>}
            </div>
          )}
        </div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
        <h3 className="text-2xl font-bold mt-1 text-foreground tabular-nums">
          {isCurrency
            ? <CurrencyDisplay amount={Number(value ?? 0)} currency="KES" locale="en-KE" />
            : String(value ?? "—")}
        </h3>
        {sparkData && sparkData.length > 1 && (
          <div className="mt-3 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData.map((v, i) => ({ i, v }))} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`sk-${title.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="10%" stopColor={trendUp !== false ? "#10b981" : "#ef4444"} stopOpacity={0.25}/>
                    <stop offset="100%" stopColor={trendUp !== false ? "#10b981" : "#ef4444"} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={trendUp !== false ? "#10b981" : "#ef4444"}
                  strokeWidth={1.5} fill={`url(#sk-${title.replace(/\s/g, "")})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType; title: string; description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="bg-muted p-5 rounded-2xl mb-4">
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h4 className="text-base font-semibold text-foreground">{title}</h4>
      <p className="text-muted-foreground text-sm mt-1.5 max-w-xs leading-relaxed">{description}</p>
      {action && (
        <button onClick={action.onClick}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
          <Plus className="h-4 w-4" />
          {action.label}
        </button>
      )}
    </div>
  );
}

function SearchBar({ value, onChange, placeholder, className = "" }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9 h-9 text-sm"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PageSizeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-[130px] h-9 text-sm flex-shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAGE_SIZES.map((n) => (
          <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaginationRow({ page, totalPages, totalItems, pageSize, onPage }: {
  page: number; totalPages: number; totalItems: number; pageSize: number; onPage: (p: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalItems);

  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  if (page > 3) pages.push("…");
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) add(i);
  if (page < totalPages - 2) pages.push("…");
  if (totalPages > 1) add(totalPages);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t text-sm text-muted-foreground dark:text-slate-400">
      <span className="text-xs">
        Showing <span className="font-medium text-muted-foreground dark:text-slate-200">{start}–{end}</span>{" "}
        of <span className="font-medium text-muted-foreground dark:text-slate-200">{totalItems}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {pages.map((p, i) =>
          p === "…"
            ? <span key={`e${i}`} className="px-1 text-slate-400 select-none">…</span>
            : <Button key={p} variant={p === page ? "default" : "outline"} size="sm"
                className="h-8 w-8 p-0 text-xs" onClick={() => onPage(p as number)}>{p}</Button>
        )}
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Tab Error Boundary ────────────────────────────────────────────────────────
// Wraps each tab so a fetch failure in one tab doesn't crash the others.

// onReset is called before clearing hasError so the parent can invalidate or
// refetch the query that caused the throw. Without it, resetting the boundary
// re-renders the same errored query state and the fallback reappears immediately.
interface TabErrorBoundaryState { hasError: boolean; error?: Error }
interface TabErrorBoundaryProps {
  children: React.ReactNode;
  tabLabel: string;
  onReset?: () => void;
}

class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[TabErrorBoundary] ${this.props.tabLabel}:`, error, info.componentStack);
  }
  handleRetry = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: undefined });
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center py-20 gap-4 text-muted-foreground">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground dark:text-slate-200">
              {this.props.tabLabel} failed to load
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
          </div>
          <Button
            variant="outline" size="sm"
            className="gap-2"
            onClick={this.handleRetry}
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface LandlordPortalProps { ownerId?: string }

// ─── Attachment type ──────────────────────────────────────────────────────────
interface MsgAttachment { url: string; name: string; size: number; mimeType: string; }

// ─── Notifications Panel ──────────────────────────────────────────────────────
// Derives real alerts from already-loaded dashboard data (no extra API call).
// Shown as a dropdown anchored to the header Bell button.

function NotificationsPanel({
  dashboardData,
  onNavigate,
  onClose,
}: {
  dashboardData: DashboardData | undefined;
  onNavigate: (tab: string) => void;
  onClose: () => void;
}) {
  const notifications = useMemo((): PortalNotification[] => {
    if (!dashboardData) return [];
    const out: PortalNotification[] = [];
    const now = new Date();

    // 1. Leases expiring within 30 days
    const expiring = dashboardData.leasesExpiringSoon ?? 0;
    if (expiring > 0) {
      out.push({
        id: "lease_expiry",
        type: "lease_expiry",
        severity: expiring >= 3 ? "critical" : "warning",
        title: `${expiring} Lease${expiring > 1 ? "s" : ""} Expiring Soon`,
        body: `${expiring} active lease${expiring > 1 ? "s expire" : " expires"} within 30 days. Start renewal discussions early.`,
        tab: "tenants",
        createdAt: now.toISOString(),
      });
    }

    // 2. Current vacancies
    const vacancies = dashboardData.currentVacancies ?? 0;
    if (vacancies > 0) {
      out.push({
        id: "vacancy",
        type: "vacancy",
        severity: vacancies >= 3 ? "warning" : "info",
        title: `${vacancies} Vacant Unit${vacancies > 1 ? "s" : ""}`,
        body: `${vacancies} unit${vacancies > 1 ? "s are" : " is"} currently unoccupied and generating no revenue.`,
        tab: "units",
        createdAt: now.toISOString(),
      });
    }

    // 3. Arrears outstanding
    const arrears = Number(dashboardData.summary?.totalArrears ?? 0);
    if (arrears > 0) {
      out.push({
        id: "overdue",
        type: "overdue",
        severity: "critical",
        title: "Rent Arrears Outstanding",
        body: `KES ${arrears.toLocaleString("en-KE")} in overdue rent across your portfolio.`,
        tab: "rent",
        createdAt: now.toISOString(),
      });
    }

    // 4. Upcoming vacancies from the dashboard list
    const upcoming = dashboardData.upcomingVacancies ?? [];
    if (upcoming.length > 0 && expiring === 0) {
      // Only show if the generic expiry alert isn't already covering it
      upcoming.slice(0, 3).forEach((v, i) => {
        out.push({
          id: `upcoming_vacancy_${i}`,
          type: "lease_expiry",
          severity: "info",
          title: `Lease ending — ${v.propertyName}`,
          body: `Unit ${v.unitNumber} lease ends ${v.leaseEnd ? format(new Date(v.leaseEnd), "d MMM yyyy") : "soon"}.`,
          tab: "tenants",
          createdAt: now.toISOString(),
        });
      });
    }

    return out;
  }, [dashboardData]);

  const SEVERITY_CONFIG = {
    critical: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", dot: "bg-red-500", icon: AlertCircle, iconCls: "text-red-500" },
    warning:  { bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800", dot: "bg-orange-400", icon: Clock, iconCls: "text-orange-500" },
    info:     { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800", dot: "bg-blue-400", icon: Bell, iconCls: "text-blue-500" },
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-96 bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800" >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-bold text-foreground dark:text-slate-100">Notifications</span>
          {notifications.length > 0 && (
            <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full inline-flex items-center justify-center">
              {notifications.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-muted-foreground dark:hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3 text-slate-400">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <div className="text-center">
              <p className="text-sm font-semibold text-muted-foreground dark:text-slate-300">All clear</p>
              <p className="text-xs mt-0.5">No urgent items require your attention.</p>
            </div>
          </div>
        ) : (
          notifications.map((n) => {
            const cfg = SEVERITY_CONFIG[n.severity];
            const Icon = cfg.icon;
            return (
              <button
                key={n.id}
                onClick={() => { if (n.tab) onNavigate(n.tab); onClose(); }}
                className={`w-full text-left flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${n.tab ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${cfg.bg} border ${cfg.border}`}>
                  <Icon className={`w-4 h-4 ${cfg.iconCls}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground dark:text-slate-100 leading-snug">{n.title}</p>
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${cfg.dot}`} />
                  </div>
                  <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
                  {n.tab && (
                    <p className="text-[10px] text-blue-500 font-semibold mt-1.5 flex items-center gap-0.5">
                      View <ChevronRight className="w-3 h-3" />
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <p className="text-[10px] text-slate-400 text-center">Alerts are derived from live portfolio data</p>
      </div>
    </div>
  );
}

// ─── Unit Grid ────────────────────────────────────────────────────────────────
// Floor-plan-style grid showing every unit across every property.
// Colour-coded: occupied+paid=green, occupied+overdue=red, vacant=slate.

function UnitGrid({
  ownerId,
  rentMonth,
  onTabChange,
}: {
  ownerId?: string;
  rentMonth: string;
  onTabChange: (tab: string) => void;
}) {
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | "all">("all");
  const [highlightFilter, setHighlightFilter] = useState<"all" | "occupied" | "vacant" | "overdue">("all");
  const [hoveredUnit, setHoveredUnit] = useState<UnitGridUnit | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { data: gridData, isLoading } = useQuery<UnitGridProperty[]>({
    queryKey: ["/api/landlord-portal/unit-grid", ownerId, rentMonth],
    enabled: true,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ownerId) params.set("ownerId", ownerId);
      params.set("month", rentMonth);
      const res = await apiRequest(`/api/landlord-portal/unit-grid?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const properties = gridData ?? [];
  const selected = selectedPropertyId === "all" ? properties : properties.filter(p => p.id === selectedPropertyId);

  const allUnits = selected.flatMap(p => p.units);
  const stats = useMemo(() => ({
    total:    allUnits.length,
    occupied: allUnits.filter(u => u.isOccupied).length,
    vacant:   allUnits.filter(u => !u.isOccupied).length,
    overdue:  allUnits.filter(u => u.isOccupied && u.paymentStatus === "overdue").length,
    paid:     allUnits.filter(u => u.isOccupied && u.paymentStatus === "paid").length,
    unpaid:   allUnits.filter(u => u.isOccupied && (u.paymentStatus === "unpaid" || u.paymentStatus === null)).length,
  }), [allUnits]);

  function unitStatus(u: UnitGridUnit): "vacant" | "paid" | "overdue" | "unpaid" {
    if (!u.isOccupied) return "vacant";
    if (u.paymentStatus === "paid") return "paid";
    if (u.paymentStatus === "overdue" || (u.daysOverdue ?? 0) > 0) return "overdue";
    return "unpaid";
  }

  const STATUS_STYLE = {
    vacant:  { cell: "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-muted-foreground hover:bg-slate-200 dark:hover:bg-slate-700", dot: "bg-slate-300" },
    paid:    { cell: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60", dot: "bg-emerald-500" },
    overdue: { cell: "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/60", dot: "bg-red-500 animate-pulse" },
    unpaid:  { cell: "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-950/60", dot: "bg-orange-400" },
  };

  function shouldShow(u: UnitGridUnit): boolean {
    if (highlightFilter === "all") return true;
    const s = unitStatus(u);
    if (highlightFilter === "occupied") return s === "paid" || s === "unpaid" || s === "overdue";
    if (highlightFilter === "vacant")   return s === "vacant";
    if (highlightFilter === "overdue")  return s === "overdue";
    return true;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-sm">Loading unit grid…</span>
      </div>
    );
  }

  if (properties.length === 0) {
    return <EmptyState icon={Building} title="No properties found" description="Add properties to see the unit grid." />;
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {/* Property selector */}
          <Select value={String(selectedPropertyId)} onValueChange={v => setSelectedPropertyId(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="h-9 text-sm w-52">
              <SelectValue placeholder="All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Filter chips */}
          {(["all", "occupied", "vacant", "overdue"] as const).map(f => (
            <button key={f} onClick={() => setHighlightFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium capitalize transition-all ${
                highlightFilter === f
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-foreground"
                  : "border-border text-muted-foreground hover:border-slate-400"
              }`}>
              {f}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0 flex-wrap">
          {[
            { dot: "bg-emerald-500", label: "Paid" },
            { dot: "bg-orange-400",  label: "Unpaid" },
            { dot: "bg-red-500",     label: "Overdue" },
            { dot: "bg-slate-300",   label: "Vacant" },
          ].map(({ dot, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Portfolio summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total Units",  value: stats.total,    cls: "text-foreground dark:text-slate-100" },
          { label: "Occupied",     value: stats.occupied, cls: "text-blue-700" },
          { label: "Vacant",       value: stats.vacant,   cls: "text-muted-foreground" },
          { label: "Paid",         value: stats.paid,     cls: "text-emerald-700" },
          { label: "Overdue",      value: stats.overdue,  cls: stats.overdue > 0 ? "text-red-600" : "text-muted-foreground" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wide">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Per-property grids */}
      {selected.map(prop => {
        const visibleUnits = prop.units.filter(shouldShow);
        if (visibleUnits.length === 0) return null;
        const propOccupied = prop.units.filter(u => u.isOccupied).length;
        const propTotal    = prop.units.length;
        const propOccRate  = propTotal > 0 ? Math.round((propOccupied / propTotal) * 100) : 0;
        return (
          <Card key={prop.id} className="border-none shadow-sm overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-base truncate">{prop.name}</CardTitle>
                <CardDescription className="truncate">{prop.address}</CardDescription>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted-foreground">
                <span className="font-semibold text-muted-foreground dark:text-slate-300">{propOccupied}/{propTotal} occupied</span>
                <div className="w-24 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${propOccRate}%` }} />
                </div>
                <span className="font-bold">{propOccRate}%</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2 relative"
                onMouseLeave={() => setHoveredUnit(null)}>
                {visibleUnits.map(u => {
                  const s = unitStatus(u);
                  const st = STATUS_STYLE[s];
                  const dimmed = highlightFilter !== "all" && !shouldShow(u);
                  return (
                    <button
                      key={u.id}
                      onMouseEnter={e => {
                        setHoveredUnit(u);
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onClick={() => {
                        // Navigate to rent tab for occupied, properties for vacant
                        onTabChange(u.isOccupied ? "rent" : "properties");
                      }}
                      className={`relative aspect-square rounded-xl border-2 flex flex-col items-center justify-center p-1 text-center font-bold text-[10px] transition-all duration-150 ${st.cell} ${dimmed ? "opacity-30" : ""}`}
                    >
                      <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${st.dot}`} />
                      <span className="truncate w-full text-center leading-none text-[9px] sm:text-[10px] font-bold">
                        {u.unitNumber}
                      </span>
                      {u.bedrooms != null && (
                        <span className="text-[8px] opacity-60 mt-0.5">{u.bedrooms}BR</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Overdue list for this property */}
              {prop.units.filter(u => unitStatus(u) === "overdue").length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold text-red-600 uppercase tracking-wide flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Overdue in this property
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {prop.units.filter(u => unitStatus(u) === "overdue").map(u => (
                      <div key={u.id} className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-xs">
                        <div>
                          <p className="font-semibold text-red-800 dark:text-red-300">Unit {u.unitNumber}</p>
                          <p className="text-red-600/80 dark:text-red-400">{u.tenantName ?? "—"}</p>
                        </div>
                        <div className="text-right">
                          {u.monthlyRent && <p className="font-bold text-red-700">KES {Number(u.monthlyRent).toLocaleString("en-KE")}</p>}
                          {(u.daysOverdue ?? 0) > 0 && <p className="text-red-500">{u.daysOverdue}d overdue</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Tooltip */}
      {hoveredUnit && (
        <div
          className="fixed z-50 pointer-events-none bg-slate-900 text-white text-xs rounded-xl shadow-2xl px-3 py-2.5 min-w-[160px] -translate-x-1/2 -translate-y-full -mt-2"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <p className="font-bold mb-1">Unit {hoveredUnit.unitNumber}</p>
          {hoveredUnit.isOccupied ? (
            <>
              <p className="text-slate-300">{hoveredUnit.tenantName ?? "Occupied"}</p>
              {hoveredUnit.monthlyRent && <p className="text-emerald-400 font-semibold">KES {Number(hoveredUnit.monthlyRent).toLocaleString("en-KE")}/mo</p>}
              {hoveredUnit.leaseEndDate && <p className="text-slate-400 mt-0.5">Lease ends {format(new Date(hoveredUnit.leaseEndDate), "d MMM yyyy")}</p>}
              <p className={`mt-1 font-semibold capitalize ${
                hoveredUnit.paymentStatus === "paid" ? "text-emerald-400" :
                hoveredUnit.paymentStatus === "overdue" ? "text-red-400" : "text-orange-400"
              }`}>{hoveredUnit.paymentStatus ?? "Unpaid"}</p>
            </>
          ) : (
            <p className="text-slate-400">Vacant</p>
          )}
          {hoveredUnit.bedrooms != null && <p className="text-slate-400 mt-0.5">{hoveredUnit.bedrooms} bed · {hoveredUnit.bathrooms} bath</p>}
        </div>
      )}
    </div>
  );
}



function LandlordMessagesPanel({
  messages, isLoading, isSending, tenants, onRefresh, onSend, onMarkRead,
}: {
  messages: any[];
  isLoading: boolean;
  isSending: boolean;
  tenants: any[];
  onRefresh: () => void;
  onSend: (subject: string, content: string, toUserId: string | null) => Promise<void>;
  onMarkRead: (ids: number[]) => void;
}) {
  const { toast } = useToast();
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyAttachments, setReplyAttachments] = useState<Record<string, MsgAttachment[]>>({});
  const [showCompose, setShowCompose] = useState(false);
  const [composeMode, setComposeMode] = useState<"single" | "bulk">("single");
  const [composeToId, setComposeToId] = useState<string>("");
  const [composeBulkIds, setComposeBulkIds] = useState<Set<string>>(new Set());
  const [composeSubject, setComposeSubject] = useState("");
  const [composeContent, setComposeContent] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<MsgAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Group into threads by normalised subject
  const threads = useMemo(() => {
    const map = new Map<string, any[]>();
    const sorted = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const m of sorted) {
      const key = (m.subject ?? "(no subject)").replace(/^re:\s*/i, "").trim().toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries())
      .map(([, msgs]) => ({
        subject:   msgs[0].subject ?? "(no subject)",
        messages:  msgs,
        lastAt:    msgs[msgs.length - 1].createdAt,
        hasUnread: msgs.some(m => !m.isSentByMe && !m.isRead),
        otherUserId:   msgs.find(m => !m.isSentByMe)?.fromUserId ?? msgs[0].toUserId,
        otherName: msgs.find(m => !m.isSentByMe)?.fromName ?? msgs[0].toName ?? "Tenant",
      }))
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }, [messages]);

  const filtered = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter(t =>
      t.subject.toLowerCase().includes(q) ||
      t.otherName.toLowerCase().includes(q)
    );
  }, [threads, search]);

  // Auto-scroll on open
  useEffect(() => {
    if (openThread && bottomRefs.current[openThread]) {
      bottomRefs.current[openThread]!.scrollIntoView({ behavior: "smooth" });
    }
  }, [openThread, messages.length]);

  const handleOpen = (subject: string) => {
    const isOpening = openThread !== subject;
    setOpenThread(isOpening ? subject : null);
    if (isOpening) {
      const thread = threads.find(t => t.subject === subject);
      if (thread) {
        const unreadIds = thread.messages.filter(m => !m.isSentByMe && !m.isRead).map(m => m.id);
        if (unreadIds.length > 0) onMarkRead(unreadIds);
      }
    }
  };

  const handleReply = async (thread: typeof threads[0]) => {
    const content = (replyText[thread.subject] ?? "").trim();
    if (!content) return;
    await onSend(`Re: ${thread.subject}`, content, thread.otherUserId ?? null);
    setReplyText(prev => ({ ...prev, [thread.subject]: "" }));
  };

  const handleCompose = async () => {
    if (!composeSubject.trim() || !composeContent.trim()) return;
    if (composeMode === "bulk") {
      if (composeBulkIds.size === 0) { toast({ title: "Select at least one recipient", variant: "destructive" }); return; }
      setBulkSending(true);
      try {
        const res = await apiRequest("/api/messages/bulk", {
          method: "POST",
          data: {
            toUserIds: Array.from(composeBulkIds),
            subject: composeSubject,
            content: composeContent,
            attachments: composeAttachments.length ? composeAttachments : undefined,
          },
        });
        const data = await res.json();
        toast({ title: `Sent to ${data.sent} tenant${data.sent !== 1 ? "s" : ""}${data.failed > 0 ? ` (${data.failed} failed)` : ""}` });
        setComposeSubject(""); setComposeContent(""); setComposeBulkIds(new Set()); setComposeAttachments([]); setShowCompose(false);
        onRefresh();
      } catch { toast({ title: "Bulk send failed", variant: "destructive" }); }
      finally { setBulkSending(false); }
    } else {
      await onSend(composeSubject, composeContent, composeToId || null);
      setComposeSubject(""); setComposeContent(""); setComposeToId(""); setComposeAttachments([]); setShowCompose(false);
    }
  };

  const uploadAttachment = async (file: File, onDone: (a: MsgAttachment) => void) => {
    setUploadingAttachment(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadWithAuth("/api/messages/upload-attachment", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      onDone(data as MsgAttachment);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleReplyWithAttachments = async (thread: typeof threads[0]) => {
    const content = (replyText[thread.subject] ?? "").trim();
    const attachments = replyAttachments[thread.subject] ?? [];
    if (!content && attachments.length === 0) return;
    // Pass attachments via a special prefixed subject to keep onSend signature intact
    // Instead, call the API directly for replies with attachments
    if (attachments.length > 0) {
      try {
        await apiRequest("/api/messages", {
          method: "POST",
          data: {
            subject: `Re: ${thread.subject}`,
            content: content || "(attachment)",
            toUserId: thread.otherUserId,
            metadata: { attachments },
          },
        });
        onRefresh();
      } catch { toast({ title: "Send failed", variant: "destructive" }); }
    } else {
      await onSend(`Re: ${thread.subject}`, content, thread.otherUserId ?? null);
    }
    setReplyText(prev => ({ ...prev, [thread.subject]: "" }));
    setReplyAttachments(prev => ({ ...prev, [thread.subject]: [] }));
  };

  const unreadCount = messages.filter(m => !m.isSentByMe && !m.isRead).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
      {/* Left: thread list */}
      <div className="lg:col-span-1 space-y-3">
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  Messages
                  {unreadCount > 0 && (
                    <span className="w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full inline-flex items-center justify-center">{unreadCount}</span>
                  )}
                </CardTitle>
                <CardDescription>{threads.length} conversation{threads.length !== 1 ? "s" : ""}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={onRefresh} disabled={isLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowCompose(v => !v)}>
                  <Send className="w-3 h-3" /> New
                </Button>
              </div>
            </div>
            <Input
              className="h-8 text-sm mt-2"
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages" description="Messages with tenants appear here. Use New to start a conversation." />
            ) : (
              <div className="divide-y divide-border">
                {filtered.map(thread => (
                  <button
                    key={thread.subject}
                    onClick={() => handleOpen(thread.subject)}
                    className={`w-full text-left px-4 py-3.5 hover:bg-muted/50 transition-colors ${openThread === thread.subject ? "bg-blue-50/60 dark:bg-blue-950/20 border-l-2 border-blue-500" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {thread.hasUnread && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                          <p className={`text-sm truncate ${thread.hasUnread ? "font-bold text-foreground" : "font-medium text-foreground/80"}`}>
                            {thread.otherName}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{thread.subject}</p>
                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                          {thread.messages[thread.messages.length - 1]?.content?.slice(0, 60)}…
                        </p>
                      </div>
                      <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                        {format(new Date(thread.lastAt), "d MMM")}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: active thread or compose */}
      <div className="lg:col-span-2 space-y-4">

        {/* Compose panel */}
        {showCompose && (
          <Card className="border-blue-200 dark:border-blue-800 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Send className="w-4 h-4 text-blue-500" /> New Message</CardTitle>
                {/* Single / Bulk toggle */}
                <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                  {(["single", "bulk"] as const).map(m => (
                    <button key={m} onClick={() => setComposeMode(m)}
                      className={`text-xs px-3 py-1.5 rounded-md font-medium capitalize transition-all ${composeMode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {m === "bulk" ? <><Users2 className="w-3 h-3 inline mr-1" />Bulk</> : "Single"}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Recipient(s) */}
              {composeMode === "single" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <select className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={composeToId} onChange={e => setComposeToId(e.target.value)}>
                    <option value="">Property manager / default</option>
                    {tenants.map((t: any) => (
                      <option key={t.userId} value={t.userId}>
                        {t.firstName} {t.lastName} — Unit {t.unitNumber ?? "?"} ({t.propertyName})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Recipients ({composeBulkIds.size} selected)</label>
                    <button className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        if (composeBulkIds.size === tenants.length) setComposeBulkIds(new Set());
                        else setComposeBulkIds(new Set(tenants.map((t: any) => t.userId)));
                      }}>
                      {composeBulkIds.size === tenants.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto border border-input rounded-lg divide-y divide-border">
                    {tenants.map((t: any) => (
                      <label key={t.userId} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                        <input type="checkbox" className="rounded"
                          checked={composeBulkIds.has(t.userId)}
                          onChange={e => {
                            const next = new Set(composeBulkIds);
                            e.target.checked ? next.add(t.userId) : next.delete(t.userId);
                            setComposeBulkIds(next);
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{t.firstName} {t.lastName}</p>
                          <p className="text-xs text-muted-foreground truncate">Unit {t.unitNumber ?? "?"} · {t.propertyName}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <Input className="h-9 text-sm" placeholder="Message subject" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Message</label>
                <Textarea rows={4} placeholder="Write your message…" value={composeContent} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComposeContent(e.target.value)} />
              </div>

              {/* Attachments */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Attachments</label>
                  <input type="file" className="hidden" ref={fileInputRef}
                    onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await uploadAttachment(file, (a: MsgAttachment) =>
                        setComposeAttachments((prev: MsgAttachment[]) => [...prev, a])
                      );
                      e.target.value = "";
                    }}
                  />
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                    disabled={uploadingAttachment} onClick={() => fileInputRef.current?.click()}>
                    {uploadingAttachment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                    Attach file
                  </Button>
                </div>
                {composeAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {composeAttachments.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-1 text-xs border border-border">
                        <Paperclip className="w-3 h-3 text-muted-foreground" />
                        <span className="max-w-[140px] truncate">{a.name}</span>
                        <span className="text-muted-foreground">({(a.size / 1024).toFixed(0)}KB)</span>
                        <button onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))}>
                          <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setShowCompose(false); setComposeAttachments([]); }}>Cancel</Button>
                <Button size="sm"
                  disabled={!composeSubject.trim() || !composeContent.trim() || (composeMode === "bulk" ? bulkSending : isSending)}
                  onClick={handleCompose}>
                  {(composeMode === "bulk" ? bulkSending : isSending)
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending…</>
                    : composeMode === "bulk"
                    ? <><Users2 className="w-3.5 h-3.5 mr-1.5" />Send to {composeBulkIds.size} tenant{composeBulkIds.size !== 1 ? "s" : ""}</>
                    : <><Send className="w-3.5 h-3.5 mr-1.5" />Send</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Open thread */}
        {openThread ? (() => {
          const thread = threads.find(t => t.subject === openThread);
          if (!thread) return null;
          return (
            <Card className="border-none shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{thread.subject}</CardTitle>
                    <CardDescription>Conversation with {thread.otherName}</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpenThread(null)}>Close</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[400px] overflow-y-auto px-4 py-3 space-y-3">
                  {thread.messages.map((m: any) => {
                    const isMe = m.isSentByMe;
                    return (
                      <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                          isMe
                            ? "bg-blue-600 text-white rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm"
                        }`}>
                          {!isMe && <p className="text-[10px] font-semibold mb-1 opacity-70">{m.fromName}</p>}
                          <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                          {/* Attachments in bubble */}
                          {(m.metadata?.attachments ?? []).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {(m.metadata.attachments as MsgAttachment[]).map((a, i) => (
                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                                  className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 ${isMe ? "bg-blue-500 hover:bg-blue-400" : "bg-white/60 dark:bg-white/10 hover:bg-white/80"} transition-colors`}>
                                  <Download className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[160px]">{a.name}</span>
                                  <span className="shrink-0 opacity-70">({(a.size / 1024).toFixed(0)}KB)</span>
                                </a>
                              ))}
                            </div>
                          )}
                          <p className={`text-[10px] mt-1 ${isMe ? "text-blue-200" : "text-muted-foreground"}`}>
                            {format(new Date(m.createdAt), "d MMM · h:mm a")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={el => { bottomRefs.current[thread.subject] = el; }} />
                </div>
                {/* Reply box */}
                <div className="border-t border-border p-4 space-y-2">
                  {/* Attachment previews */}
                  {(replyAttachments[thread.subject] ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(replyAttachments[thread.subject] ?? []).map((a, i) => (
                        <div key={i} className="flex items-center gap-1.5 bg-muted rounded-lg px-2 py-1 text-xs">
                          <Paperclip className="w-3 h-3 text-muted-foreground" />
                          <span className="max-w-[120px] truncate">{a.name}</span>
                          <button onClick={() => setReplyAttachments(prev => ({ ...prev, [thread.subject]: (prev[thread.subject] ?? []).filter((_, j) => j !== i) }))}>
                            <X className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Textarea
                      rows={2}
                      placeholder={`Reply to ${thread.otherName}… (Ctrl+Enter to send)`}
                      className="flex-1 resize-none text-sm"
                      value={replyText[thread.subject] ?? ""}
                      onChange={e => setReplyText(prev => ({ ...prev, [thread.subject]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReplyWithAttachments(thread); }}
                    />
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <input type="file" className="hidden"
                        ref={(el: HTMLInputElement | null) => { replyFileRefs.current[thread.subject] = el; }}
                        onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          await uploadAttachment(file, (a: MsgAttachment) =>
                            setReplyAttachments((prev: Record<string, MsgAttachment[]>) => ({
                              ...prev,
                              [thread.subject]: [...(prev[thread.subject] ?? []), a],
                            }))
                          );
                          e.target.value = "";
                        }}
                      />
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0" title="Attach file"
                        disabled={uploadingAttachment}
                        onClick={() => replyFileRefs.current[thread.subject]?.click()}>
                        {uploadingAttachment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                      </Button>
                      <Button size="sm" className="h-9 w-9 p-0"
                        disabled={!(replyText[thread.subject]?.trim()) && !(replyAttachments[thread.subject]?.length) || isSending}
                        onClick={() => handleReplyWithAttachments(thread)}>
                        {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })() : (
          !showCompose && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">Select a conversation to read it</p>
              <p className="text-xs mt-1">Or click <strong>New</strong> to start a message with a tenant</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Maintenance Photos ───────────────────────────────────────────────────────
function MaintenancePhotos({ requestId }: { requestId: number }) {
  const { data: photos = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/landlord-portal/maintenance/photos", requestId],
    queryFn: async () => {
      const res = await apiRequest(`/api/landlord-portal/maintenance/${requestId}/photos`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120_000,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading photos…</div>;
  if (photos.length === 0) return <p className="text-xs text-muted-foreground italic">No photos attached by tenant.</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tenant Photos ({photos.length})</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p: any) => {
          const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(p.name ?? "") || /image\//.test(p.mimeType ?? "");
          return isImage ? (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
              className="block w-20 h-20 rounded-lg overflow-hidden border border-border hover:border-primary transition-colors shrink-0">
              <img src={p.url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
            </a>
          ) : (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline bg-muted rounded-lg px-2 py-1">
              <Download className="w-3 h-3" /> {p.name}
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tenant Payment History ───────────────────────────────────────────────────
function TenantPaymentHistory({ tenantId, currency }: { tenantId: number; currency: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/landlord-portal/tenants", tenantId, "payments", page],
    queryFn: async () => {
      const res = await apiRequest(
        `/api/landlord-portal/tenants/${tenantId}/payments?page=${page}&pageSize=${pageSize}`
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  const STATUS_CLS: Record<string, string> = {
    paid:     "bg-emerald-50 text-emerald-700 border border-emerald-200",
    overdue:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    pending:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    partial:  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4 px-2">
        <Loader2 className="w-4 h-4 animate-spin" /><span className="text-xs">Loading payment history…</span>
      </div>
    );
  }

  const payments: any[] = data?.data ?? [];
  if (payments.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 px-2">No payment records found for this tenant.</p>;
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left pb-2 font-medium">Due Date</th>
            <th className="text-left pb-2 font-medium">Paid Date</th>
            <th className="text-right pb-2 font-medium">Amount</th>
            <th className="text-left pb-2 font-medium">Method</th>
            <th className="text-left pb-2 font-medium">Ref</th>
            <th className="text-left pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map((p: any) => (
            <tr key={p.id} className="hover:bg-muted/40 transition-colors">
              <td className="py-2 pr-3 whitespace-nowrap">{p.dueDate ? format(new Date(p.dueDate), "d MMM yyyy") : "—"}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{p.paidDate ? format(new Date(p.paidDate), "d MMM yyyy") : <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">{currency ?? "KES"} {(Number(p.amount) || 0).toLocaleString("en-KE")}</td>
              <td className="py-2 pr-3 capitalize whitespace-nowrap">{p.paymentMethod?.replace("_", " ") ?? "—"}</td>
              <td className="py-2 pr-3 font-mono text-[10px] max-w-[100px] truncate">{p.mpesaTransactionId ?? p.bankReference ?? p.invoiceNumber ?? "—"}</td>
              <td className="py-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${STATUS_CLS[p.status] ?? STATUS_CLS.pending}`}>
                  {p.status ?? "pending"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.totalPages > 1 && (
        <PaginationRow page={page} totalPages={data.totalPages} totalItems={data.total} pageSize={pageSize} onPage={setPage} />
      )}
    </div>
  );
}

// ── PropertyCard ──────────────────────────────────────────────────────────────
interface PropertyCardProps {
  property: Property;
  stats?: PropertyStats;
  onNavigate: (id: number) => void;
  onEdit: (p: Property) => void;
}
const PropertyCard = React.memo(function PropertyCard({ property, stats, onNavigate, onEdit }: PropertyCardProps) {
  return (
    <Card className="border border-border shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{property.name}</p>
            <p className="text-xs text-muted-foreground truncate">{property.address}</p>
          </div>
          <button onClick={() => onEdit(property)} className="shrink-0 p-1 rounded hover:bg-muted transition-colors">
            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" /></svg>
          </button>
        </div>
        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Units</p>
              <p className="text-sm font-bold">{stats.totalUnits ?? 0}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Occupied</p>
              <p className="text-sm font-bold">{stats.occupiedUnits ?? 0}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Revenue</p>
              <p className="text-sm font-bold truncate">KES {(Number(stats.monthlyRevenue ?? 0)).toLocaleString("en-KE")}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => onNavigate(property.id)}
          className="w-full text-xs text-primary font-medium hover:underline text-left">
          View details →
        </button>
      </CardContent>
    </Card>
  );
});

// ── AddPropertyCard ───────────────────────────────────────────────────────────
function AddPropertyCard({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="border-2 border-dashed border-border shadow-none rounded-xl hover:border-primary/50 transition-colors cursor-pointer" onClick={onAdd}>
      <CardContent className="p-4 flex flex-col items-center justify-center gap-2 min-h-[140px]">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
          <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </div>
        <p className="text-sm font-medium text-muted-foreground">Add Property</p>
      </CardContent>
    </Card>
  );
}

// ── LandlordRatingsView ───────────────────────────────────────────────────────
function LandlordRatingsView() {
  return (
    <Card className="border border-border shadow-sm rounded-xl">
      <CardContent className="py-16">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
          </div>
          <p className="text-base font-semibold">Ratings &amp; Reviews</p>
          <p className="text-sm text-muted-foreground max-w-xs">Tenant ratings and reviews for your properties will appear here.</p>
        </div>
      </CardContent>
    </Card>
  );
}


export default function LandlordPortal({ ownerId }: LandlordPortalProps) {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [showFirstRun, setShowFirstRun] = useState(false);

  // ── First-run overlay — show once per user per browser ────────────────────
  useEffect(() => {
    if (user?.id && needsFirstRun(user.id)) {
      const t = setTimeout(() => setShowFirstRun(true), 600);
      return () => clearTimeout(t);
    }
  }, [user?.id]);

  // ── Tab state (not persisted — intentionally resets to dashboard on mount)
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isAddPropertyOpen, setIsAddPropertyOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu]         = useState(false);

  // ── Real-time WebSocket listeners ─────────────────────────────────────────
  useWsEvent("maintenance:updated", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/maintenance"] });
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard"] });
  });
  useWsEvent("payment:confirmed", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/rent-collection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard"] });
    toast({ title: "Payment received", description: "A tenant payment has been confirmed." });
  });
  useWsEvent("payment:overdue", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/rent-collection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard"] });
    toast({ title: "Payment overdue", description: "A tenant has a payment past due.", variant: "destructive" });
  });
  useWsEvent("message:new", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
  });
  useWsEvent("broadcast", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard"] });
  });
  const [chartType, setChartType] = useState<"bar" | "area">("area");
  const [rentMonth, setRentMonth] = useState(format(new Date(), "yyyy-MM"));
  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [tenantPage, setTenantPage] = useState(1);
  const [tenantPageSize, setTenantPageSize] = useState(20);
  const [rcPaymentFilter, setRcPaymentFilter] = useState("all"); // all | paid | unpaid
  const [rcPage, setRcPage] = useState(1);
  const [rcPageSize, setRcPageSize] = useState(20);
  const [expandedMaintId, setExpandedMaintId] = useState<number | null>(null);
  const [expandedTenantId, setExpandedTenantId] = useState<number | null>(null);
  const [tenantPayHistPage, setTenantPayHistPage] = useState<Record<number,number>>({});

  // Property editing
  const [editingPropertyId, setEditingPropertyId] = useState<number | null>(null);
  const [editPropertyForm, setEditPropertyForm] = useState({ name: "", address: "", description: "" });

  // Expense receipt uploads
  const [expenseReceiptUploading, setExpenseReceiptUploading] = useState<Record<number, boolean>>({});

  // Maintenance photo expansion
  const [expandedPhotoId, setExpandedPhotoId] = useState<number | null>(null);

  // Expense tab
  const [expensePage, setExpensePage] = useState(1);
  const [expensePageSize, setExpensePageSize] = useState(20);
  const [expensePropertyFilter, setExpensePropertyFilter] = useState<string>("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    propertyId: "", vendorName: "", description: "", amount: "",
    currency: "KES", category: "maintenance", expenseDate: format(new Date(), "yyyy-MM-dd"),
    dueDate: "", paymentMethod: "", notes: "", isRecurring: false, recurringFrequency: "monthly",
  });

  // Document tab
  const [docPropertyFilter, setDocPropertyFilter] = useState<string>("");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("");
  const [docCategory, setDocCategory]   = useState<string>("all");

  // Maintenance approval tab
  const [approvalExpandedId, setApprovalExpandedId] = useState<number | null>(null);
  const [approvalNotes, setApprovalNotes] = useState<Record<number, string>>({});
  const [approvalReason, setApprovalReason] = useState<Record<number, string>>({});
  const [maintNotes, setMaintNotes] = useState<Record<number, string>>({});

  // ── Persisted filter state — survives tab switching via sessionStorage
  // useReducer ignores reducer changes after mount, so passing a new function
  // on every render (or via useMemo when ownerId changes) leaves the closure
  // stale without React warning you. Pinning with useRef gives the reducer a
  // stable reference to the ownerId that was active at mount — which is the
  // same ownerId that seeded the initial state — and avoids the eslint-disable.
  const ownerIdRef = useRef(ownerId);
  const filterReducer = useRef(makeFilterReducer(ownerIdRef.current)).current;
  const [filters, dispatch] = useReducer(filterReducer, undefined, () => loadFilters(ownerIdRef.current));

  // Destructure for convenience
  const {
    reportSearch, reportPageSize, reportPage, reportSortBy, reportSortDir,
    reportStartDate, reportEndDate,
    maintSearch, maintPageSize, maintPage, maintStatus,
    propSearch,
  } = filters;

  // Setters that also save to sessionStorage via the reducer.
  // All wrap dispatch (stable from useReducer) so useCallback deps never change —
  // these functions are guaranteed stable across every re-render.
  const setReportSearch    = useCallback((v: string) => dispatch({ type: "SET_MANY", patch: { reportSearch: v,    reportPage: 1 } }), [dispatch]);
  const setReportPageSize  = useCallback((v: number) => dispatch({ type: "SET_MANY", patch: { reportPageSize: v, reportPage: 1 } }), [dispatch]);
  const setReportPage      = useCallback((v: number) => dispatch({ type: "SET", key: "reportPage",      value: v }), [dispatch]);
  const setReportSortBy    = useCallback((v: string) => dispatch({ type: "SET", key: "reportSortBy",    value: v }), [dispatch]);
  const setReportSortDir   = useCallback((v: "asc" | "desc") => dispatch({ type: "SET", key: "reportSortDir", value: v }), [dispatch]);
  const setReportStartDate = useCallback((v: string) => dispatch({ type: "SET_MANY", patch: { reportStartDate: v, reportPage: 1 } }), [dispatch]);
  const setReportEndDate   = useCallback((v: string) => dispatch({ type: "SET_MANY", patch: { reportEndDate: v,   reportPage: 1 } }), [dispatch]);
  const setMaintSearch     = useCallback((v: string) => dispatch({ type: "SET_MANY", patch: { maintSearch: v,     maintPage: 1 } }), [dispatch]);
  const setMaintPageSize   = useCallback((v: number) => dispatch({ type: "SET_MANY", patch: { maintPageSize: v,  maintPage: 1 } }), [dispatch]);
  const setMaintPage       = useCallback((v: number) => dispatch({ type: "SET", key: "maintPage",      value: v }), [dispatch]);
  const setMaintStatus     = useCallback((v: string) => dispatch({ type: "SET_MANY", patch: { maintStatus: v,     maintPage: 1 } }), [dispatch]);
  const setPropSearch      = useCallback((v: string) => dispatch({ type: "SET", key: "propSearch",     value: v }), [dispatch]);

  // ── Dashboard query ──────────────────────────────────────────────────────────
  const {
    data: dashboardData, isLoading: dashboardLoading,
    isError: dashboardError, refetch: refetchDashboard,
  } = useQuery<DashboardData>({
    queryKey: ["/api/landlord-portal/dashboard", ownerId],
    staleTime: 2 * 60_000,
    enabled:   !!ownerId,   // don't fire before user.id is resolved
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/dashboard", ownerId);
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Per-property stats query (loads when Properties tab is open) ─────────────
  const { data: propertyStats = [] } = useQuery<PropertyStats[]>({
    queryKey: ["/api/landlord-portal/properties/stats", ownerId],
    enabled: activeTab === "properties",
    staleTime: 5 * 60_000, // Property stats: slow-changing structural data
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/properties/stats", ownerId);
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Expenses query ───────────────────────────────────────────────────────────
  const { data: expensesData, isLoading: expensesLoading, refetch: refetchExpenses } = useQuery<any>({
    queryKey: ["/api/landlord-portal/expenses", ownerId, expensePropertyFilter, expensePage, expensePageSize],
    enabled: activeTab === "expenses",
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/expenses", ownerId,
        { ...(expensePropertyFilter ? { propertyId: expensePropertyFilter } : {}), page: expensePage, pageSize: expensePageSize });
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const addExpense = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/landlord-portal/expenses", {
        method: "POST",
        data: { ...expenseForm, propertyId: Number(expenseForm.propertyId), amount: Number(expenseForm.amount), isRecurring: expenseForm.isRecurring },
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/expenses", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard", ownerId] });
      toast({ title: "Expense recorded" });
      setShowExpenseForm(false);
      setExpenseForm({ propertyId: "", vendorName: "", description: "", amount: "", currency: "KES", category: "maintenance", expenseDate: format(new Date(), "yyyy-MM-dd"), dueDate: "", paymentMethod: "", notes: "", isRecurring: false, recurringFrequency: "monthly" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteExpense = useMutation({
    mutationFn: async (id: number) => {
      const url = buildOwnerUrl(`/api/landlord-portal/expenses/${id}`, ownerId);
      const res = await apiRequest(url, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/expenses", ownerId] });
      toast({ title: "Expense deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const patchExpense = useMutation({
    mutationFn: async ({ id, receiptUrl, status }: { id: number; receiptUrl?: string; status?: string }) => {
      const url = buildOwnerUrl(`/api/landlord-portal/expenses/${id}`, ownerId);
      const res = await apiRequest(url, { method: "PATCH", data: { receiptUrl, status } });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/expenses", ownerId] }),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const uploadExpenseReceipt = async (expenseId: number, file: File) => {
    setExpenseReceiptUploading(prev => ({ ...prev, [expenseId]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadWithAuth("/api/landlord-portal/expenses/upload-receipt", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      await patchExpense.mutateAsync({ id: expenseId, receiptUrl: data.url });
      toast({ title: "Receipt uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setExpenseReceiptUploading(prev => ({ ...prev, [expenseId]: false }));
    }
  };

  const patchProperty = useMutation({
    mutationFn: async ({ id, ...patch }: { id: number; name?: string; address?: string; description?: string }) => {
      const url = buildOwnerUrl(`/api/landlord-portal/properties/${id}`, ownerId);
      const res = await apiRequest(url, { method: "PATCH", data: patch });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/properties/stats", ownerId] });
      toast({ title: "Property updated" });
      setEditingPropertyId(null);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Documents query ───────────────────────────────────────────────────────────
  const { data: landlordDocs = [], isLoading: docsLoading, refetch: refetchDocs } = useQuery<any[]>({
    queryKey: ["/api/landlord-portal/documents", ownerId, docPropertyFilter],
    enabled: activeTab === "documents",
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/documents", ownerId,
        docPropertyFilter ? { propertyId: docPropertyFilter } : {});
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: number) => {
      const url = buildOwnerUrl(`/api/landlord-portal/documents/${id}`, ownerId);
      const res = await apiRequest(url, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/documents", ownerId] });
      toast({ title: "Document deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const uploadDoc = async (file: File, propertyId: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", "owner_upload");
    if (propertyId) fd.append("propertyId", propertyId);
    try {
      await uploadWithAuth("/api/documents", fd);
      refetchDocs();
      toast({ title: "Document uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  // ── Maintenance approvals query ───────────────────────────────────────────────
  const { data: pendingApprovals = [], isLoading: approvalsLoading, refetch: refetchApprovals } = useQuery<any[]>({
    queryKey: ["/api/landlord-portal/maintenance/pending-approval", ownerId],
    enabled: activeTab === "approvals",
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/maintenance/pending-approval", ownerId);
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const actOnApproval = useMutation({
    mutationFn: async ({ id, action, rejectionReason, notes }: { id: number; action: "approve" | "reject"; rejectionReason?: string; notes?: string }) => {
      const url = buildOwnerUrl(`/api/landlord-portal/maintenance/${id}/approve`, ownerId);
      const res = await apiRequest(url, {
        method: "PATCH",
        data: { action, rejectionReason, notes },
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/maintenance/pending-approval", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/maintenance", ownerId] });
      toast({ title: vars.action === "approve" ? "✅ Request approved" : "❌ Request rejected" });
      setApprovalExpandedId(null);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Tenants query ────────────────────────────────────────────────────────────
  const { data: tenantsData, isLoading: tenantsLoading, refetch: refetchTenants } = useQuery<any>({
    queryKey: ["/api/landlord-portal/tenants", ownerId, tenantSearch, tenantStatus, tenantPage],
    enabled: activeTab === "tenants",
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/tenants", ownerId, { search: tenantSearch, status: tenantStatus, page: tenantPage, pageSize: tenantPageSize });
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Rent collection query ─────────────────────────────────────────────────────
  const { data: rcData, isLoading: rcLoading, refetch: refetchRc } = useQuery<any>({
    queryKey: ["/api/landlord-portal/rent-collection", ownerId, rentMonth],
    enabled: activeTab === "rent",
    staleTime: 60_000,
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/rent-collection", ownerId, { month: rentMonth });
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Messages ─────────────────────────────────────────────────────────────────
  const {
    data: messagesRaw, isLoading: msgsLoading, refetch: refetchMsgs,
  } = useQuery<any[]>({
    queryKey: ["/api/messages", "all", activeTab],
    queryFn: async () => {
      const res = await apiRequest("/api/messages?box=all&limit=200");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return Array.isArray(data) ? data : (data.results ?? []);
    },
    enabled: activeTab === "messages",
    staleTime: 30_000,
    refetchInterval: activeTab === "messages" ? 30_000 : false,
  });
  const allMessages: any[] = Array.isArray(messagesRaw) ? messagesRaw : [];

  const sendMsg = useMutation({
    mutationFn: async ({ subject, content, toUserId }: { subject: string; content: string; toUserId: string | null }) => {
      const res = await apiRequest("/api/messages", {
        method: "POST",
        data: { subject, content, toUserId },
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Send failed");
      return res.json();
    },
    onSuccess: () => { refetchMsgs(); toast({ title: "Message sent" }); },
    onError: (e: Error) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const markMsgRead = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map(id =>
        apiRequest(`/api/messages/${id}/read`, { method: "PATCH" })
      ));
    },
    onSettled: () => refetchMsgs(),
  });

  // ── Maintenance PATCH mutation ────────────────────────────────────────────────
  const updateMaintenance = useMutation({
    mutationFn: async ({ id, status, assignedTo, notes }: { id: number; status?: string; assignedTo?: string; notes?: string }) => {
      const res = await apiRequest(`/api/landlord-portal/maintenance/${id}`, { method: "PATCH", data: { status, assignedTo, notes } });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/maintenance", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard", ownerId] });
      toast({ title: "Request updated" });
      setExpandedMaintId(null);
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  // ── Maintenance query (server-filtered, server-paginated) ────────────────────
  const {
    data: maintData, isLoading: maintenanceLoading, isError: maintenanceError,
    refetch: refetchMaintenance,
  } = useQuery<PagedResponse<MaintenanceRequest>>({
    queryKey: ["/api/landlord-portal/maintenance", ownerId, maintStatus, maintSearch, maintPage, maintPageSize],
    enabled: activeTab === "maintenance",
    staleTime: 60_000, // Maintenance requests: operational, 1 min is reasonable
    queryFn: async () => {
      const url = buildOwnerUrl("/api/landlord-portal/maintenance", ownerId, {
        status:   maintStatus,
        search:   maintSearch,
        page:     maintPage,
        pageSize: maintPageSize,
      });
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Reports query (server-filtered, sorted, paginated) ───────────────────────
  const {
    data: reportsData, isLoading: reportsLoading, refetch: refetchReports,
  } = useQuery<PagedResponse<PortfolioReport>>({
    queryKey: ["/api/landlord-portal/reports", ownerId, reportSearch, reportSortBy, reportSortDir, reportStartDate, reportEndDate, reportPage, reportPageSize],
    enabled: activeTab === "reports",
    staleTime: 5 * 60_000, // Reports: generated artifacts, effectively immutable
    queryFn: async () => {
      const extras: Record<string, string | number> = {
        sortBy: reportSortBy, sortDir: reportSortDir, page: reportPage, pageSize: reportPageSize,
      };
      if (reportSearch)   extras.search    = reportSearch;
      if (reportStartDate) extras.startDate = reportStartDate;
      if (reportEndDate)   extras.endDate   = reportEndDate;
      const url = buildOwnerUrl("/api/landlord-portal/reports", ownerId, extras);
      const res = await apiRequest(url);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Generate report mutation ─────────────────────────────────────────────────
  const generateReport = useMutation({
    mutationFn: async (reportType: "monthly" | "quarterly" | "annual") => {
      const { startDate, endDate } = buildDateRange(reportType);
      const res = await apiRequest("/api/landlord-portal/reports/generate", {
        method: "POST", data: { ownerId, reportType, startDate, endDate },
      });
      return res.json() as Promise<{ id: number; reportType: string }>;
    },
    onSuccess: async (report) => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/reports", ownerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard", ownerId] });
      try {
        const dlRes = await apiRequest(`/api/landlord-portal/reports/${report.id}/download`);
        if (!dlRes.ok) throw new Error("Download failed");
        const html = await dlRes.text();
        // Write into the pre-opened window (opened synchronously on button click)
        const target = (window as any).__reportWin as Window | null;
        if (target && !target.closed) {
          target.document.write(html);
          target.document.close();
          target.onload = () => { target.focus(); target.print(); };
        }
        toast({ title: "Financial Package Ready", description: "Your report has opened — save as PDF from the print dialog." });
      } catch {
        toast({ title: "Report Generated", description: "Your financial report is ready in the Reports tab." });
      } finally {
        (window as any).__reportWin = null;
      }
    },
    onError: () => {
      const w = (window as any).__reportWin as Window | null;
      if (w && !w.closed) w.close();
      (window as any).__reportWin = null;
      toast({ title: "Generation Failed", description: "Failed to generate the report. Please try again.", variant: "destructive" });
    },
  });

  // ── Email mutation (per-row isolated) ────────────────────────────────────────
  // isPending + variables tracks which row is in-flight without manual state,
  // matching the downloadReport pattern and avoiding setState-on-unmounted issues.
  const emailReport = useMutation({
    mutationFn: async (reportId: number) => {
      const res = await apiRequest(`/api/landlord-portal/reports/${reportId}/email`, {
        method: "POST", data: { ownerId },
      });
      return res.json() as Promise<{ success: boolean; sentTo: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Report Sent", description: `Report emailed to ${data.sentTo}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Email Failed", description: err.message ?? "Could not send the report.", variant: "destructive" });
    },
  });

  // ── Download mutation — useMutation gives consistent error surfacing and
  // exposes isPending so the button can show a spinner without manual state.
  const downloadReport = useMutation({
    mutationFn: async (report: PortfolioReport) => {
      const res = await apiRequest(`/api/landlord-portal/reports/${report.id}/download`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const html = await res.text();
      // Open in print window instead of downloading as .html file
      const win = window.open("", "_blank");
      if (!win) throw new Error("Please allow pop-ups to view this report.");
      win.document.write(html);
      win.document.close();
      win.onload = () => { win.focus(); win.print(); };
      return report.id;
    },
    onError: () => {
      toast({ title: "Download Failed", description: "Could not download the report. Please try again." });
    },
  });

  // ── Document download ────────────────────────────────────────────────────────
  const handleDownloadDocument = useCallback((doc: { id: number; name: string }) => {
    const a    = document.createElement("a");
    a.href     = `/api/documents/${doc.id}/download`;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // ── Derived dashboard values ─────────────────────────────────────────────────
  const properties         = dashboardData?.properties         ?? [];
  const summary            = dashboardData?.summary            ?? {} as PortfolioSummary;
  const recentReports      = dashboardData?.reports            ?? [];
  const upcomingVacancies  = dashboardData?.upcomingVacancies  ?? [];
  const leasesExpiringSoon = dashboardData?.leasesExpiringSoon ?? 0;
  const currentVacancies   = dashboardData?.currentVacancies   ?? 0;
  const contactManager     = dashboardData?.contactManager;
  const recentDocuments    = dashboardData?.recentDocuments    ?? [];

  const performanceData: MonthlyTrend[] = useMemo(() => {
    if (dashboardData?.trends?.length) return dashboardData.trends;
    const mr = dashboardData?.monthlyReport;
    if (!mr) return [];
    return [{ month: format(new Date(), "MMM"), revenue: Number(mr.totalRevenue ?? 0), expenses: Number(mr.totalExpenses ?? 0), net: Number(mr.netIncome ?? 0) }];
  }, [dashboardData]);

  const expenseCategories = dashboardData?.expenseCategories ?? [];

  const revenueTrend = useMemo(() => {
    if (performanceData.length < 2) return null;
    const last = performanceData[performanceData.length - 1].revenue;
    const prev = performanceData[performanceData.length - 2].revenue;
    if (prev === 0) return null;
    const pct = (((last - prev) / prev) * 100).toFixed(1);
    const delta = last - prev;
    return { value: `${Math.abs(Number(pct))}%`, up: Number(pct) >= 0, delta };
  }, [performanceData]);

  const netTrend = useMemo(() => {
    if (performanceData.length < 2) return null;
    const last = performanceData[performanceData.length - 1].net;
    const prev = performanceData[performanceData.length - 2].net;
    if (prev === 0) return null;
    const pct = (((last - prev) / prev) * 100).toFixed(1);
    const delta = last - prev;
    return { value: `${Math.abs(Number(pct))}%`, up: Number(pct) >= 0, delta };
  }, [performanceData]);

  // ── Filtered properties (client-side — properties list is small) ─────────────
  const filteredProperties = useMemo(() => {
    const q = propSearch.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.propertyType ?? "").toLowerCase().includes(q)
    );
  }, [properties, propSearch]);

  const statsById = useMemo(
    () => Object.fromEntries(propertyStats.map((s) => [s.id, s])),
    [propertyStats]
  );

  // Stable navigation callback for PropertyCard — must be stable so React.memo
  // on PropertyCard can actually short-circuit. An inline arrow at the call site
  // would produce a new reference every render and defeat the memo entirely.
  const handleNavigateToProperty = useCallback(
    (id: number) => navigate(`/properties/${id}`),
    [navigate],
  );

  // Toggle sort for a reports column.
  // Closes over reportSortBy + reportSortDir so those are deps; still stable
  // across unrelated re-renders (e.g. query data arriving).
  const handleSort = useCallback((col: string) => {
    if (reportSortBy === col) {
      setReportSortDir(reportSortDir === "asc" ? "desc" : "asc");
    } else {
      // Setting both sortBy + sortDir + page in one dispatch avoids two re-renders
      dispatch({ type: "SET_MANY", patch: { reportSortBy: col, reportSortDir: "desc", reportPage: 1 } });
    }
  }, [reportSortBy, reportSortDir, setReportSortDir, dispatch]);

  // Date range helpers — only close over dispatch so these are permanently stable.
  const applyQuarterFilter = useCallback((year: number, quarter: 1 | 2 | 3 | 4) => {
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end   = new Date(year, startMonth + 3, 0);
    dispatch({
      type: "SET_MANY",
      patch: {
        reportStartDate: start.toISOString().split("T")[0],
        reportEndDate:   end.toISOString().split("T")[0],
        reportPage: 1,
      },
    });
  }, [dispatch]);

  const applyYearFilter = useCallback((year: number) => {
    dispatch({
      type: "SET_MANY",
      patch: {
        reportStartDate: `${year}-01-01`,
        reportEndDate:   `${year}-12-31`,
        reportPage: 1,
      },
    });
  }, [dispatch]);

  const clearDateFilter = useCallback(() => {
    dispatch({ type: "SET_MANY", patch: { reportStartDate: "", reportEndDate: "", reportPage: 1 } });
  }, [dispatch]);

  // Precomputed active-state strings for the quarter/year filter chips.
  // Avoids calling new Date() and doing ISO string slicing inside the render
  // map on every keystroke or re-render — runs once per year change instead.
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const quarterRanges = useMemo(() =>
    ([1, 2, 3, 4] as const).map((q) => ({
      q,
      label:  `Q${q} ${currentYear}`,
      start:  new Date(currentYear, (q - 1) * 3, 1).toISOString().split("T")[0],
      end:    new Date(currentYear, q * 3, 0).toISOString().split("T")[0],
    })),
    [currentYear],
  );
  const thisYearStart = `${currentYear}-01-01`;
  const thisYearEnd   = `${currentYear}-12-31`;

  // ── Loading / error guards ───────────────────────────────────────────────────
  if (dashboardLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm">Loading portfolio data…</p>
      </div>
    );
  }
  if (dashboardError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm font-medium">Could not load dashboard data.</p>
        <Button variant="outline" size="sm" onClick={() => refetchDashboard()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  // ── Role + Org guards ─────────────────────────────────────────────────────
  if (!authLoading && user && user.role !== "landlord") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="text-center max-w-sm space-y-3">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
          <p className="text-sm text-muted-foreground">This portal is for landlords only.</p>
        </div>
      </div>
    );
  }
  if (!authLoading && user && !user.organizationId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="text-center max-w-sm space-y-3">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <span className="text-2xl">🏢</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">No organisation linked</h2>
          <p className="text-sm text-muted-foreground">Your account is not linked to an organisation. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background/50 dark:bg-gray-950 pb-12">

      {/* ── First-run welcome overlay ── */}
      {showFirstRun && (
        <FirstRunOverlay
          userId={user?.id ?? "unknown"}
          role="landlord"
          firstName={user?.firstName ?? ""}
          onDismiss={() => {
            markFirstRunDone(user?.id ?? "unknown");
            setShowFirstRun(false);
          }}
        />
      )}

      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-6 border-b border-white/10">
        <div className="max-w-7xl mx-auto flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                <Building className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-white/60 text-xs font-medium uppercase tracking-wider mb-0.5">Owner Portal</p>
                <h1 className="text-xl font-semibold text-white">Portfolio Insights</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-white/70 text-xs">
                    <Building className="w-3 h-3" />
                    {properties.length} {properties.length === 1 ? "Asset" : "Assets"}
                  </span>
                  <span className="flex items-center gap-1 text-white/70 text-xs">
                    <Clock className="w-3 h-3" />
                    Updated {format(new Date(), "MMMM d, yyyy")}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Active landlord
              </div>

              <Button
                size="sm"
                onClick={() => {
                  // Open window NOW while we're inside the user gesture — browser won't block it
                  const w = window.open("", "_blank");
                  if (w) {
                    w.document.write("<html><body style='font-family:sans-serif;padding:40px;color:#475569'>Generating your financial report…</body></html>");
                    (window as any).__reportWin = w;
                  }
                  generateReport.mutate("monthly");
                }}
                disabled={generateReport.isPending}
                className="bg-card text-foreground hover:bg-muted text-xs font-bold px-4 py-1.5 rounded-full h-auto border border-border"
              >
                {generateReport.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                Financial Package
              </Button>
            </div>
          </div>
        </div>


        <main className="flex-1 min-w-0 w-full">
        <div className="px-4 lg:px-8 xl:px-10 py-5 pb-24 max-w-7xl mx-auto w-full">

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="hidden">
            <TabsTrigger value="dashboard" /><TabsTrigger value="properties" />
            <TabsTrigger value="units" /><TabsTrigger value="tenants" />
            <TabsTrigger value="rent" /><TabsTrigger value="maintenance" />
            <TabsTrigger value="reports" /><TabsTrigger value="expenses" />
            <TabsTrigger value="documents" /><TabsTrigger value="approvals" />
            <TabsTrigger value="messages" /><TabsTrigger value="ratings" />
          </TabsList>

          {/* ── Executive Summary ── */}
          <TabsContent value="dashboard" className="space-y-8 animate-in fade-in duration-500">
            {/* Action items banner */}
            {((dashboardData?.leasesExpiringSoon ?? 0) > 0 || (dashboardData?.currentVacancies ?? 0) > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(dashboardData?.leasesExpiringSoon ?? 0) > 0 && (
                  <button onClick={() => setActiveTab("tenants")} className="flex items-center gap-3 p-4 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-left hover:border-orange-400 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-orange-900 dark:text-orange-200 text-sm">{dashboardData?.leasesExpiringSoon ?? 0} lease{(dashboardData?.leasesExpiringSoon ?? 0) > 1 ? "s" : ""} expiring within 30 days</p>
                      <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">Review and initiate renewal discussions</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-orange-400 group-hover:text-orange-600 transition-colors" />
                  </button>
                )}
                {(dashboardData?.currentVacancies ?? 0) > 0 && (
                  <button onClick={() => setActiveTab("properties")} className="flex items-center gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-left hover:border-blue-400 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
                      <Home className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-blue-900 dark:text-blue-200 text-sm">{dashboardData?.currentVacancies ?? 0} vacant unit{(dashboardData?.currentVacancies ?? 0) > 1 ? "s" : ""} available</p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">View properties to manage listings</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-blue-400 group-hover:text-blue-600 transition-colors" />
                  </button>
                )}
              </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <KPICard title="Gross Revenue"       value={summary.totalRevenue ?? "0"} icon={DollarSign} color="text-blue-600"   bg="bg-blue-50 dark:bg-blue-950/30"   trend={revenueTrend?.value} trendUp={revenueTrend?.up} trendLabel={revenueTrend?.delta != null ? `KES ${Math.abs(Number(revenueTrend.delta)).toLocaleString("en-KE")} vs last mo` : undefined} />
              <KPICard title="Net Operating Income" value={summary.netIncome ?? "0"}   icon={TrendingUp}  color="text-emerald-600" bg="bg-emerald-50" trend={netTrend?.value}     trendUp={netTrend?.up} trendLabel={netTrend?.delta != null ? `KES ${Math.abs(Number(netTrend.delta)).toLocaleString("en-KE")} vs last mo` : undefined} />
              <KPICard title="Portfolio Occupancy"  value={`${Number(summary.occupancyRate ?? 0).toFixed(1)}%`} icon={Users} color="text-purple-600" bg="bg-purple-50 dark:bg-purple-950/30" isCurrency={false} />
              <KPICard title="Arrears (Overdue)"   value={summary.totalArrears ?? "0"} icon={AlertCircle} color="text-red-600" bg="bg-red-50 dark:bg-red-950/30" />
            </div>

            {/* ── NEW: Deposit + Portfolio + Cash Flow strip ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Deposits held */}
              <Card className="border border-border shadow-sm rounded-xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                    <Landmark className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">KES {(Number(summary.totalDeposits ?? 0)).toLocaleString("en-KE")}</p>
                    <p className="text-xs text-muted-foreground">Deposits held</p>
                  </div>
                </CardContent>
              </Card>
              {/* Portfolio value */}
              {summary.portfolioValue && (
                <Card className="border border-border shadow-sm rounded-xl">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">KES {(Number(summary.portfolioValue)).toLocaleString("en-KE")}</p>
                      <p className="text-xs text-muted-foreground">
                        Portfolio value{summary.grossYield ? ` · ${Number(summary.grossYield).toFixed(1)}% yield` : ""}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* This month: expected vs collected */}
              <Card className="border border-border shadow-sm rounded-xl">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <CalendarCheck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      KES {(Number(summary.collectedThisMonth ?? 0)).toLocaleString("en-KE")}
                      <span className="text-xs font-normal text-muted-foreground"> / {(Number(summary.expectedThisMonth ?? 0)).toLocaleString("en-KE")}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Collected this month</p>
                  </div>
                </CardContent>
              </Card>
              {/* Collection rate this month */}
              {(Number(summary.expectedThisMonth) > 0) && (
                <Card className="border border-border shadow-sm rounded-xl">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <PieChart className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {Math.round((Number(summary.collectedThisMonth) / Number(summary.expectedThisMonth)) * 100)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Collection rate</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Cash flow schedule — who still owes this month */}
            {(dashboardData?.cashFlowSchedule ?? []).filter((t: any) => !t.paid).length > 0 && (
              <Card className="border border-border shadow-sm rounded-xl">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    Outstanding this month — {(dashboardData?.cashFlowSchedule ?? []).filter((t: any) => !t.paid).length} tenant{(dashboardData?.cashFlowSchedule ?? []).filter((t: any) => !t.paid).length > 1 ? "s" : ""} yet to pay
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="divide-y divide-border/50">
                    {(dashboardData?.cashFlowSchedule ?? [])
                      .filter((t: any) => !t.paid)
                      .slice(0, 5)
                      .map((t: any) => (
                        <div key={t.tenantId} className="flex items-center justify-between py-2 text-sm">
                          <div>
                            <p className="font-medium">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.property} · Unit {t.unit}</p>
                          </div>
                          <p className="font-semibold text-red-600">KES {t.monthlyRent.toLocaleString("en-KE")}</p>
                        </div>
                      ))}
                    {(dashboardData?.cashFlowSchedule ?? []).filter((t: any) => !t.paid).length > 5 && (
                      <p className="text-xs text-muted-foreground pt-2 text-center">
                        +{(dashboardData?.cashFlowSchedule ?? []).filter((t: any) => !t.paid).length - 5} more — <button className="text-primary underline" onClick={() => setActiveTab("rent")}>view all in Rent tab</button>
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* YTD financial strip */}
            {(summary.ytdRevenue || summary.ytdNetIncome) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "YTD Revenue",   value: `KES ${(Number(summary.ytdRevenue ?? 0)).toLocaleString("en-KE")}`,   cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-950/40" },
                  { label: "YTD Expenses",  value: `KES ${(Number(summary.ytdExpenses ?? 0)).toLocaleString("en-KE")}`,  cls: "text-red-600",     bg: "bg-red-50 dark:bg-red-950/40"  },
                  { label: "YTD Net Income",value: `KES ${(Number(summary.ytdNetIncome ?? 0)).toLocaleString("en-KE")}`, cls: Number(summary.ytdNetIncome ?? 0) >= 0 ? "text-emerald-700" : "text-red-600", bg: "bg-emerald-50 dark:bg-emerald-950/40" },
                  { label: "Managed Assets",value: String(properties.length) + " properties",  cls: "text-orange-600",  bg: "bg-orange-50 dark:bg-orange-950/40" },
                ].map(s => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-border`}>
                    <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold tracking-wide">{s.label}</p>
                    <p className={`text-base font-bold ${s.cls}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-2 border-none shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Financial Performance</CardTitle>
                    <CardDescription>
                      {performanceData.length > 1
                        ? `Revenue vs Expenses (Last ${performanceData.length} Months)`
                        : performanceData.length === 1
                          ? "Current Month — more data will appear as months accumulate"
                          : "Revenue vs Expenses"}
                    </CardDescription>
                  </div>
                  {/* Only show the chart-type toggle when there are enough points to be meaningful */}
                  {performanceData.length > 1 && (
                    <div className="flex gap-1 bg-muted rounded-lg p-1">
                      {(["bar", "area"] as const).map((t) => (
                        <button key={t} onClick={() => setChartType(t)}
                          className={`text-[10px] px-3 py-1 rounded-md font-medium transition-all capitalize ${chartType === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="h-[320px]">
                  {performanceData.length === 0 ? (
                    <EmptyState icon={BarChart3} title="No trend data yet" description="Financial trends will appear once monthly data is available." />
                  ) : performanceData.length === 1 ? (
                    /* Single data point — show a clean stat summary instead of a misleading chart */
                    <div className="flex flex-col justify-center h-full gap-6 px-4">
                      <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">{performanceData[0].month}</p>
                      <div className="grid grid-cols-3 gap-4">
                        {[
                          { label: "Revenue",  value: performanceData[0].revenue,  color: "text-blue-600",    bg: "bg-blue-50"    },
                          { label: "Expenses", value: performanceData[0].expenses, color: "text-red-500",     bg: "bg-red-50"     },
                          { label: "Net",      value: performanceData[0].net,      color: "text-emerald-600", bg: "bg-emerald-50" },
                        ].map(({ label, value, color, bg }) => (
                          <div key={label} className={`${bg} rounded-2xl p-4`}>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">{label}</p>
                            <p className={`text-lg font-bold ${color}`}>
                              <CurrencyDisplay amount={value} currency="KES" locale="en-KE" />
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">The trend chart will appear once data for more than one month is available.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      {chartType === "area" ? (
                        <AreaChart data={performanceData}>
                          <defs>
                            <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} formatter={(v) => `KES ${Number(v ?? 0).toLocaleString("en-KE")}`} />
                          <Area type="monotone" dataKey="revenue"  name="Revenue"  stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#gradRev)" />
                          <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#ef4444" strokeWidth={2} fill="transparent" strokeDasharray="5 5" />
                        </AreaChart>
                      ) : (
                        <BarChart data={performanceData} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} formatter={(v) => `KES ${Number(v ?? 0).toLocaleString("en-KE")}`} />
                          <Bar dataKey="revenue"  name="Revenue"  fill="#3b82f6" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} opacity={0.7} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Expense Breakdown</CardTitle>
                  <CardDescription>Distribution by category</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex flex-col justify-center">
                  {expenseCategories.length === 0 ? (
                    <EmptyState icon={BarChart3} title="No expenses yet" description="Expense categories will appear once expenses are recorded." />
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="75%">
                        <PieChart>
                          <Pie data={expenseCategories} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                            {expenseCategories.map((_, i) => (
                              <Cell key={`c-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => `KES ${Number(v ?? 0).toLocaleString("en-KE")}`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {expenseCategories.map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-xs text-muted-foreground dark:text-slate-400 truncate capitalize">{item.name}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Bottom row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Recent Reports preview */}
              <Card className="border-none shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Recent Reports</CardTitle>
                    <CardDescription>Latest portfolio statements</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="text-primary" onClick={() => setActiveTab("reports")}>View All</Button>
                </CardHeader>
                <CardContent>
                  {recentReports.length === 0 ? (
                    <EmptyState icon={FileText} title="No reports yet" description="Generate a report to see it here." />
                  ) : (
                    <div className="space-y-3">
                      {recentReports.slice(0, 4).map((report) => (
                        <div key={report.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                          <div className="bg-primary/10 p-2.5 rounded-xl"><FileText className="h-4 w-4 text-primary" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold capitalize">{report.reportType} Statement</p>
                            <p className="text-xs text-muted-foreground">{fmtDateShort(report.reportPeriodStart)} – {fmtDate(report.reportPeriodEnd)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-emerald-600">
                              <CurrencyDisplay amount={Number(report.netIncome)} currency="KES" locale="en-KE" />
                            </p>
                            <Badge variant="secondary" className="text-[10px] capitalize">{report.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Occupancy */}
              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Portfolio Occupancy</CardTitle>
                  <CardDescription>Unit availability overview</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-5">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">Overall Portfolio</span>
                        <span className="text-sm font-bold">{Number(summary.occupancyRate ?? 0).toFixed(1)}%</span>
                      </div>
                      <Progress value={parseFloat(String(summary.occupancyRate ?? 0))} className="h-2.5 bg-slate-100" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800" >
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Leases Expiring (30d)</p>
                        <h4 className={`text-xl font-bold mt-1 ${leasesExpiringSoon > 0 ? "text-orange-600" : "text-muted-foreground dark:text-slate-300"}`}>
                          {leasesExpiringSoon} {leasesExpiringSoon === 1 ? "Unit" : "Units"}
                        </h4>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800" >
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Current Vacancies</p>
                        <h4 className={`text-xl font-bold mt-1 ${currentVacancies > 0 ? "text-blue-600" : "text-muted-foreground dark:text-slate-300"}`}>
                          {currentVacancies} {currentVacancies === 1 ? "Unit" : "Units"}
                        </h4>
                      </div>
                    </div>
                    {upcomingVacancies.length > 0 && (
                      <div>
                        <h5 className="text-xs font-bold text-slate-400 uppercase mb-3">Upcoming Vacancies</h5>
                        <div className="space-y-2">
                          {upcomingVacancies.slice(0, 3).map((v, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                                <span className="font-medium truncate">{v.propertyName} — Unit {v.unitNumber}</span>
                              </div>
                              <span className="text-muted-foreground text-xs whitespace-nowrap ml-2">
                                Exp. {v.leaseEnd ? format(new Date(v.leaseEnd), "MMM d") : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Properties ── */}
          <TabsContent value="properties" className="space-y-4 animate-in fade-in duration-500">
            <div className="flex items-center gap-3">
              <SearchBar value={propSearch} onChange={setPropSearch} placeholder="Search by name, address, or type…" className="flex-1" />
              {propSearch && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {filteredProperties.length} of {properties.length}
                </span>
              )}
            </div>

            {/* Property edit modal */}
            {editingPropertyId !== null && (
              <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditingPropertyId(null)}>
                <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-bold">Edit Property</h3>
                  <div className="space-y-3">
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Property Name</label>
                      <Input className="h-9 text-sm" value={editPropertyForm.name} onChange={e => setEditPropertyForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Address</label>
                      <Input className="h-9 text-sm" value={editPropertyForm.address} onChange={e => setEditPropertyForm(f => ({ ...f, address: e.target.value }))} />
                    </div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Description</label>
                      <Textarea rows={3} className="text-sm" value={editPropertyForm.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditPropertyForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingPropertyId(null)}>Cancel</Button>
                    <Button size="sm" disabled={!editPropertyForm.name.trim() || patchProperty.isPending}
                      onClick={() => patchProperty.mutate({ id: editingPropertyId, ...editPropertyForm })}>
                      {patchProperty.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {filteredProperties.length === 0 ? (
              <Card className="border-none shadow-sm">
                <CardContent className="py-16">
                  <EmptyState
                    icon={Building}
                    title={propSearch ? "No properties match your search" : "No properties yet"}
                    description={propSearch ? "Try a different search term." : "Your managed properties will appear here once added."}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProperties.map((property) => (
                  <PropertyCard key={property.id} property={property} stats={statsById[property.id]} onNavigate={handleNavigateToProperty} onEdit={p => { setEditingPropertyId(p.id); setEditPropertyForm({ name: p.name, address: p.address ?? "", description: p.description ?? "" }); }} />
                ))}
                {!propSearch && <AddPropertyCard onAdd={() => setIsAddPropertyOpen(true)} />}
              </div>
            )}
            {/* Add Property Modal */}
            <AddPropertyModal
              isOpen={isAddPropertyOpen}
              onClose={() => setIsAddPropertyOpen(false)}
              onSuccess={() => {
                setIsAddPropertyOpen(false);
                queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/properties/stats", ownerId] });
                queryClient.invalidateQueries({ queryKey: ["/api/landlord-portal/dashboard", ownerId] });
              }}
            />
          </TabsContent>

          {/* ── Units Grid ── */}
          <TabsContent value="units" className="space-y-4 animate-in fade-in duration-500">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-foreground dark:text-slate-100">Unit Overview</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Floor-plan grid across all properties — hover a unit for details</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Rent month:</span>
                <Input
                  type="month"
                  value={rentMonth}
                  onChange={e => setRentMonth(e.target.value)}
                  className="h-9 w-40 text-sm"
                />
              </div>
            </div>
            <UnitGrid ownerId={ownerId} rentMonth={rentMonth} onTabChange={setActiveTab} />
          </TabsContent>

          {/* ── Tenants ── */}
          <TabsContent value="tenants" className="space-y-4 animate-in fade-in duration-500">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Tenant Directory</CardTitle>
                    <CardDescription>All tenants across your portfolio</CardDescription>
                  </div>
                  {tenantsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <SearchBar value={tenantSearch} onChange={v => { setTenantSearch(v); setTenantPage(1); }} placeholder="Search by name, email, unit…" className="flex-1" />
                  <Select value={tenantStatus} onValueChange={v => { setTenantStatus(v); setTenantPage(1); }}>
                    <SelectTrigger className="w-[130px] h-9 text-sm shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <PageSizeSelect value={tenantPageSize} onChange={v => { setTenantPageSize(v); setTenantPage(1); }} />
                </div>
              </CardHeader>
              <CardContent>
                {!tenantsLoading && (!tenantsData || tenantsData.data.length === 0) ? (
                  <EmptyState icon={Users} title="No tenants found" description="Tenants will appear here once added to your properties." />
                ) : (
                  <div className="space-y-2">
                    {(tenantsData?.data ?? []).map((t: any) => {
                      const leaseEnd = t.leaseEndDate ? new Date(t.leaseEndDate) : null;
                      const daysLeft = leaseEnd ? Math.ceil((leaseEnd.getTime() - Date.now()) / 86400000) : null;
                      const isExpiring = daysLeft !== null && daysLeft > 0 && daysLeft <= 30;
                      const isExpanded = expandedTenantId === t.id;
                      return (
                        <div key={t.id} className={`rounded-xl border overflow-hidden transition-colors ${isExpiring ? "border-orange-200" : "border-border"}`}>
                          {/* Summary row — click to expand */}
                          <button
                            className={`w-full flex items-start gap-4 p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40 ${isExpiring ? "bg-orange-50/30 dark:bg-orange-950/20" : ""}`}
                            onClick={() => setExpandedTenantId(isExpanded ? null : t.id)}
                          >
                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 font-bold text-muted-foreground text-sm">
                              {t.firstName?.[0]}{t.lastName?.[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div>
                                  <p className="font-semibold text-sm">{t.firstName} {t.lastName}</p>
                                  <p className="text-xs text-muted-foreground">{t.propertyName} · Unit {t.unitNumber}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isExpiring && (
                                    <Badge className="text-[10px] bg-orange-100 text-orange-800 border-orange-200" >Lease expiring in {daysLeft}d</Badge>
                                  )}
                                  <Badge variant="secondary" className="text-[10px] capitalize">{t.status}</Badge>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-xs">
                                <div><p className="text-muted-foreground">Monthly Rent</p><p className="font-semibold">{t.currency ?? "KES"} {(Number(t.monthlyRent) || 0).toLocaleString("en-KE")}</p></div>
                                <div><p className="text-muted-foreground">Lease Start</p><p className="font-medium">{t.leaseStartDate ? format(new Date(t.leaseStartDate), "d MMM yyyy") : "—"}</p></div>
                                <div><p className="text-muted-foreground">Lease End</p><p className={`font-medium ${isExpiring ? "text-orange-600" : ""}`}>{t.leaseEndDate ? format(new Date(t.leaseEndDate), "d MMM yyyy") : "—"}</p></div>
                                <div className="flex items-center gap-3">
                                  {t.email && <a href={`mailto:${t.email}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline flex items-center gap-1"><Mail className="w-3 h-3" /> Email</a>}
                                  {t.phone && <a href={`tel:${t.phone}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline flex items-center gap-1"><Phone className="w-3 h-3" /> Call</a>}
                                  {/* Flag for renewal — sends a message to the PM */}
                                  {isExpiring && (
                                    <a href={`/messages?to=manager&subject=Lease renewal: ${encodeURIComponent(t.firstName + " " + t.lastName + " Unit " + t.unitNumber)}`}
                                      onClick={e => e.stopPropagation()}
                                      className="text-orange-600 hover:underline flex items-center gap-1 font-medium">
                                      <RefreshCw className="w-3 h-3" /> Request renewal
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                            <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          </button>

                          {/* Payment history drawer */}
                          {isExpanded && (
                            <div className="border-t border-border bg-slate-50/60 dark:bg-slate-900/40 px-4 py-4">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                <DollarSign className="w-3.5 h-3.5" /> Payment History
                              </p>
                              <TenantPaymentHistory tenantId={t.id} currency={t.currency ?? "KES"} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {tenantsData && tenantsData.totalPages > 1 && (
                  <PaginationRow page={tenantPage} totalPages={tenantsData.totalPages} totalItems={tenantsData.total} pageSize={tenantPageSize} onPage={setTenantPage} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Rent Collection ── */}
          <TabsContent value="rent" className="space-y-4 animate-in fade-in duration-500">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Rent Collection</CardTitle>
                    <CardDescription>Track monthly payments across all tenants</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input type="month" value={rentMonth} onChange={e => { setRentMonth(e.target.value); setRcPage(1); }} className="h-9 w-40 text-sm" />
                    <PageSizeSelect value={rcPageSize} onChange={v => { setRcPageSize(v); setRcPage(1); }} />
                    <Button variant="outline" size="sm" className="h-9" onClick={() => refetchRc()}><RefreshCw className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Summary strip */}
                {rcData?.summary && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Expected",       value: `KES ${(Number(rcData.summary.totalExpected) || 0).toLocaleString("en-KE")}`,  cls: "text-foreground",  bg: "bg-muted" },
                      { label: "Collected",       value: `KES ${(Number(rcData.summary.totalCollected) || 0).toLocaleString("en-KE")}`, cls: "text-green-700",   bg: "bg-green-50 dark:bg-green-950/40" },
                      { label: "Collection Rate", value: `${rcData.summary.collectionRate ?? 0}%`,                                    cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-950/40" },
                      { label: "Unpaid Tenants",  value: rcData.summary.unpaid ?? 0,                                                  cls: (rcData.summary.unpaid ?? 0) > 0 ? "text-red-600" : "text-green-600", bg: (rcData.summary.unpaid ?? 0) > 0 ? "bg-red-50 dark:bg-red-950/40" : "bg-green-50 dark:bg-green-950/40" },
                    ].map(s => (
                      <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-border`}>
                        <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                        <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Collection progress bar */}
                {rcData?.summary && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                      <span>Collection progress — {rcData.summary.paid ?? 0} of {rcData.summary.totalTenants ?? 0} tenants paid</span>
                      <span className="font-semibold">{rcData.summary.collectionRate ?? 0}%</span>
                    </div>
                    <Progress value={parseFloat(rcData.summary.collectionRate ?? "0") || 0} className="h-2.5" />
                  </div>
                )}

                {/* Filter */}
                <div className="flex gap-2">
                  {["all", "paid", "unpaid"].map(f => (
                    <button key={f} onClick={() => setRcPaymentFilter(f)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium capitalize transition-all ${rcPaymentFilter === f ? "bg-slate-900 text-white border-slate-900" : "border-border text-muted-foreground hover:border-slate-400"}`}>
                      {f}
                    </button>
                  ))}
                </div>

                {/* Tenant payment rows */}
                {rcLoading ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const filtered = (rcData?.payments ?? []).filter((t: any) => rcPaymentFilter === "all" || t.paymentStatus === rcPaymentFilter);
                      const paginated = filtered.slice((rcPage - 1) * rcPageSize, rcPage * rcPageSize);
                      const totalPages = Math.ceil(filtered.length / rcPageSize);
                      return (<>
                        {paginated.map((t: any) => (
                        <div key={t.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${t.paymentStatus === "paid" ? "border-green-200 bg-green-50/30 dark:bg-green-950/20" : "border-red-200 bg-red-50/30 dark:bg-red-950/20"}`}>
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${t.paymentStatus === "paid" ? "bg-green-100 dark:bg-green-900/50" : "bg-red-100 dark:bg-red-900/50"}`}>
                            {t.paymentStatus === "paid"
                              ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                              : <Clock className="w-4 h-4 text-red-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div>
                                <p className="font-semibold text-sm">{t.firstName} {t.lastName}</p>
                                <p className="text-xs text-muted-foreground">{t.propertyName} · Unit {t.unitNumber}</p>
                              </div>
                              <div className="text-right">
                                <p className={`font-bold text-sm ${t.paymentStatus === "paid" ? "text-green-700" : "text-red-600"}`}>
                                  {t.currency ?? "KES"} {(Number(t.monthlyRent) || 0).toLocaleString("en-KE")}
                                </p>
                                {t.payment?.paidDate && (
                                  <p className="text-[10px] text-muted-foreground">Paid {format(new Date(t.payment.paidDate), "d MMM")}</p>
                                )}
                                {t.payment?.mpesaTransactionId && (
                                  <p className="text-[10px] font-mono text-muted-foreground">{t.payment.mpesaTransactionId}</p>
                                )}
                              </div>
                            </div>
                          </div>
                          {t.paymentStatus === "unpaid" && t.email && (
                            <a href={`mailto:${t.email}?subject=Rent Reminder&body=Dear ${t.firstName}, your rent of ${t.currency ?? "KES"} ${(Number(t.monthlyRent) || 0).toLocaleString("en-KE")} is due for ${rentMonth}. Please make payment at your earliest convenience.`}
                              className="shrink-0">
                              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50">
                                <Mail className="w-3 h-3" /> Remind
                              </Button>
                            </a>
                          )}
                        </div>
                        ))}
                        {totalPages > 1 && <PaginationRow page={rcPage} totalPages={totalPages} totalItems={filtered.length} pageSize={rcPageSize} onPage={setRcPage} />}
                      </>);
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Operations (Maintenance) ── */}
          <TabsContent value="maintenance" className="space-y-4 animate-in fade-in duration-500">
            <TabErrorBoundary tabLabel="Operations" onReset={refetchMaintenance}>
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">Maintenance Requests</CardTitle>
                    <CardDescription>
                      Work orders across all properties
                      {maintData && ` — ${maintData.total} ${maintStatus === "active" ? "open" : maintStatus}`}
                    </CardDescription>
                  </div>
                  {maintenanceLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />}
                </div>

                {/* Toolbar */}
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <SearchBar
                    value={maintSearch}
                    onChange={setMaintSearch}
                    placeholder="Search by property, title, ticket…"
                    className="flex-1"
                  />
                  <Select value={maintStatus} onValueChange={setMaintStatus}>
                    <SelectTrigger className="w-[140px] h-9 text-sm flex-shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <PageSizeSelect value={maintPageSize} onChange={setMaintPageSize} />
                </div>
              </CardHeader>

              <CardContent>
                {maintenanceError ? (
                  <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 text-red-400" />
                    <p className="text-sm font-medium">Failed to load maintenance requests.</p>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => refetchMaintenance()}>
                      <RefreshCw className="h-4 w-4" /> Retry
                    </Button>
                  </div>
                ) : !maintenanceLoading && (!maintData || maintData.data.length === 0) ? (
                  <EmptyState
                    icon={Wrench}
                    title={maintSearch ? "No results match your search" : "No maintenance requests"}
                    description={maintSearch ? "Try a different search term." : "Open maintenance requests will appear here."}
                  />
                ) : (
                  <div className="space-y-3">
                    {(maintData?.data ?? []).map((req) => {
                      const prio   = PRIORITY_CONFIG[req.priority]  ?? PRIORITY_CONFIG.medium;
                      const status = STATUS_CONFIG[req.status]       ?? STATUS_CONFIG.pending;
                      const isExpanded = expandedMaintId === req.id;
                      return (
                        <div key={req.id} className="rounded-xl border border-border overflow-hidden">
                          <button
                            className="w-full flex items-start gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors text-left"
                            onClick={() => setExpandedMaintId(isExpanded ? null : req.id)}
                          >
                            <div className={`p-2 rounded-lg ${prio.bg} flex-shrink-0 mt-0.5`}>
                              <Wrench className={`h-5 w-5 ${prio.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start gap-2">
                                <p className="text-sm font-semibold truncate">
                                  {req.property?.name ?? "Unknown property"}
                                  {req.unit?.unitNumber ? ` — Unit ${req.unit.unitNumber}` : ""}
                                </p>
                                <Badge variant={status.variant} className="text-[10px] uppercase whitespace-nowrap shrink-0">
                                  {status.label}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5 truncate">{req.title}</p>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="text-[10px] text-slate-400">{getRelativeTime(req.createdAt)}</span>
                                <span className="text-[10px] text-slate-300">•</span>
                                <span className={`text-[10px] font-bold capitalize ${prio.text}`}>{prio.label} Priority</span>
                                <span className="text-[10px] text-slate-300">•</span>
                                <span className="text-[10px] text-slate-400">#{req.ticketNumber}</span>
                                {req.assignedTo && <span className="text-[10px] text-blue-500">Assigned: {req.assignedTo}</span>}
                              </div>
                            </div>
                            <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          </button>

                          {isExpanded && (
                            <div className="border-t border-border p-4 bg-slate-50/50 dark:bg-slate-900/30 space-y-4">
                              {req.description && (
                                <p className="text-sm text-muted-foreground">{req.description}</p>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Status update */}
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Update Status</label>
                                  <Select defaultValue={req.status} onValueChange={(val) => updateMaintenance.mutate({ id: req.id, status: val })}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {["pending","assigned","in_progress","completed","cancelled"].map(s => (
                                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {/* Assigned to */}
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Assigned To</label>
                                  <div className="flex gap-2">
                                    <Input
                                      className="h-9 text-sm flex-1"
                                      placeholder="Contractor / staff name"
                                      defaultValue={req.assignedTo ?? ""}
                                      onBlur={e => { if (e.target.value !== (req.assignedTo ?? "")) updateMaintenance.mutate({ id: req.id, assignedTo: e.target.value }); }}
                                    />
                                  </div>
                                </div>
                              </div>
                              {/* Notes */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                                <div className="flex gap-2">
                                  <textarea
                                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                                    rows={2}
                                    placeholder="Add internal notes…"
                                    value={maintNotes[req.id] ?? req.notes ?? ""}
                                    onChange={e => setMaintNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                                  />
                                  <Button size="sm" className="h-9 shrink-0"
                                    onClick={() => updateMaintenance.mutate({ id: req.id, notes: maintNotes[req.id] ?? "" })}>
                                    Save
                                  </Button>
                                </div>
                              </div>

                              {/* Cost tracking */}
                              {(req.estimatedCost || req.actualCost) && (
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  {req.estimatedCost && <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-2.5"><p className="text-muted-foreground">Estimated Cost</p><p className="font-bold text-orange-700">KES {(Number(req.estimatedCost)||0).toLocaleString("en-KE")}</p></div>}
                                  {req.actualCost && <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2.5"><p className="text-muted-foreground">Actual Cost</p><p className="font-bold text-green-700">KES {(Number(req.actualCost)||0).toLocaleString("en-KE")}</p></div>}
                                </div>
                              )}

                              {/* Tenant photos */}
                              <MaintenancePhotos requestId={req.id} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {maintData && maintData.totalPages > 1 && (
                  <PaginationRow
                    page={maintPage}
                    totalPages={maintData.totalPages}
                    totalItems={maintData.total}
                    pageSize={maintPageSize}
                    onPage={setMaintPage}
                  />
                )}
              </CardContent>
            </Card>
            </TabErrorBoundary>
          </TabsContent>

          {/* ── Financial Reports ── */}
          <TabsContent value="reports" className="space-y-6 animate-in fade-in duration-500">
            <TabErrorBoundary tabLabel="Financial Reports" onReset={refetchReports}>
            <Card className="border-none shadow-lg overflow-hidden">
              {/* Hero */}
              <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-700 text-white p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                  <div className="max-w-xl">
                    <h3 className="text-3xl font-bold">On-Demand Financials</h3>
                    <p className="text-white/80 mt-2 text-base">
                      Generate comprehensive portfolio statements, tax documents, and performance audits in seconds.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Button
                      onClick={() => {
                        const w = window.open("", "_blank");
                        if (w) {
                          w.document.write("<html><body style='font-family:sans-serif;padding:40px;color:#475569'>Generating your financial report…</body></html>");
                          (window as any).__reportWin = w;
                        }
                        generateReport.mutate("monthly");
                      }}
                      disabled={generateReport.isPending}
                      className="bg-card text-foreground hover:bg-muted px-8 h-12 rounded-xl font-bold shadow-xl border border-border"
                    >
                      {generateReport.isPending
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                        : "Monthly Statement"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white hover:border-white/50 px-6 h-12 rounded-xl">
                          More Options
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 bg-card border border-border shadow-xl z-50">
                        <DropdownMenuItem className="cursor-pointer text-muted-foreground dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800" onClick={() => {
                          const w = window.open("", "_blank");
                          if (w) { w.document.write("<html><body style='font-family:sans-serif;padding:40px;color:#475569'>Generating your financial report…</body></html>"); (window as any).__reportWin = w; }
                          generateReport.mutate("quarterly");
                        }}>
                          Quarterly Review
                        </DropdownMenuItem>
                        <DropdownMenuItem className="cursor-pointer text-muted-foreground dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800" onClick={() => {
                          const w = window.open("", "_blank");
                          if (w) { w.document.write("<html><body style='font-family:sans-serif;padding:40px;color:#475569'>Generating your financial report…</body></html>"); (window as any).__reportWin = w; }
                          generateReport.mutate("annual");
                        }}>
                          Annual Tax Package
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              <CardContent className="p-0">
                {reportsLoading ? (
                  <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm">Loading reports…</span>
                  </div>
                ) : (
                  <>
                    {/* Toolbar */}
                    <div className="flex flex-col gap-3 px-6 py-4 border-b">
                      {/* Row 1: search + page size */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <SearchBar
                          value={reportSearch}
                          onChange={setReportSearch}
                          placeholder="Search by type or status…"
                          className="flex-1"
                        />
                        <PageSizeSelect value={reportPageSize} onChange={setReportPageSize} />
                      </div>

                      {/* Row 2: date range — always visible, with quarter shortcuts */}
                      <div className="flex flex-col sm:flex-row gap-2 items-end flex-wrap">
                        {/* Quarter + year shortcut chips — active-state strings come from
                            quarterRanges/thisYearStart/End (memoised above), not inline new Date() */}
                        <div className="flex items-center gap-1 flex-wrap flex-1">
                          <span className="text-[10px] font-bold uppercase text-slate-400 mr-1 whitespace-nowrap">Quick:</span>
                          {quarterRanges.map(({ q, label, start, end }) => (
                            <button
                              key={q}
                              onClick={() => applyQuarterFilter(currentYear, q)}
                              className={`text-[10px] px-2 py-1 rounded-md font-bold border transition-colors whitespace-nowrap
                                ${reportStartDate === start && reportEndDate === end
                                  ? "bg-primary text-white border-primary"
                                  : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"}`}
                            >
                              {label}
                            </button>
                          ))}
                          <button
                            onClick={() => applyYearFilter(currentYear)}
                            className={`text-[10px] px-2 py-1 rounded-md font-bold border transition-colors whitespace-nowrap
                              ${reportStartDate === thisYearStart && reportEndDate === thisYearEnd
                                ? "bg-primary text-white border-primary"
                                : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"}`}
                          >
                            This Year
                          </button>
                          {(reportStartDate || reportEndDate) && (
                            <button
                              onClick={clearDateFilter}
                              className="text-[10px] px-2 py-1 rounded-md font-bold border border-red-200 text-red-500 hover:bg-red-50 transition-colors whitespace-nowrap"
                            >
                              <X className="h-3 w-3 inline mr-0.5" />Clear
                            </button>
                          )}
                        </div>

                        {/* Free-form date inputs */}
                        <div className="flex gap-2 items-end flex-shrink-0">
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">From</label>
                            <Input
                              type="date"
                              value={reportStartDate}
                              onChange={(e) => setReportStartDate(e.target.value)}
                              className="h-9 text-sm w-36"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">To</label>
                            <Input
                              type="date"
                              value={reportEndDate}
                              onChange={(e) => setReportEndDate(e.target.value)}
                              className="h-9 text-sm w-36"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            {[
                              { label: "Report Archive",   col: null                },
                              { label: "Reporting Period", col: "reportPeriodStart"  },
                              { label: "Gross Revenue",    col: "totalRevenue"      },
                              { label: "Net Income",       col: "netIncome"         },
                              { label: "Status",           col: null                },
                              { label: "",                 col: null                },
                            ].map(({ label, col }, i) => {
                              const isActive = col && reportSortBy === col;
                              const SortIcon = isActive
                                ? (reportSortDir === "asc" ? ArrowUp : ArrowDown)
                                : null;
                              return (
                                <th
                                  key={i}
                                  className={`px-8 py-5 font-bold text-xs uppercase tracking-widest ${
                                    isActive ? "text-primary" : "text-slate-400"
                                  } ${i >= 2 && i <= 3 ? "text-right" : ""} ${col ? "cursor-pointer hover:text-muted-foreground dark:hover:text-slate-200 select-none" : ""}`}
                                  onClick={col ? () => handleSort(col) : undefined}
                                >
                                  <span className={`inline-flex items-center gap-1 ${i >= 2 && i <= 3 ? "justify-end w-full" : ""}`}>
                                    {label}
                                    {col && (
                                      SortIcon
                                        ? <SortIcon className="h-3 w-3 text-primary" />
                                        : <ArrowDown className="h-3 w-3 opacity-20" />
                                    )}
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {!reportsData || reportsData.data.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-4">
                                <EmptyState
                                  icon={FileText}
                                  title={reportSearch || reportStartDate || reportEndDate ? "No reports match your filters" : "No reports yet"}
                                  description={reportSearch || reportStartDate || reportEndDate ? "Try adjusting your search or date range." : "Select a report type above to generate your first portfolio analysis."}
                                />
                              </td>
                            </tr>
                          ) : (
                            reportsData.data.map((report) => {
                              const isEmailingThis    = emailReport.isPending && emailReport.variables === report.id;
                              const isDownloadingThis = downloadReport.isPending && downloadReport.variables?.id === report.id;
                              return (
                                <tr key={report.id} className="border-b hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-all group">
                                  <td className="px-8 py-6">
                                    <div className="flex items-center gap-4">
                                      <div className="bg-primary/10 p-2.5 rounded-xl group-hover:bg-primary group-hover:text-white transition-colors">
                                        <FileText className="h-5 w-5" />
                                      </div>
                                      <div>
                                        <span className="font-bold text-foreground  capitalize block">{report.reportType} Statement</span>
                                        <span className="text-xs text-muted-foreground">#RPT-{String(report.id).padStart(4, "0")}</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-8 py-6 text-sm font-medium text-muted-foreground dark:text-slate-400">
                                    {fmtDateShort(report.reportPeriodStart)} – {fmtDate(report.reportPeriodEnd)}
                                  </td>
                                  <td className="px-8 py-6 text-right font-semibold">
                                    <CurrencyDisplay amount={Number(report.totalRevenue)} currency="KES" locale="en-KE" />
                                  </td>
                                  <td className="px-8 py-6 text-right">
                                    <span className="font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg">
                                      <CurrencyDisplay amount={Number(report.netIncome)} currency="KES" locale="en-KE" />
                                    </span>
                                  </td>
                                  <td className="px-8 py-6">
                                    <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800 text-muted-foreground dark:text-slate-300 capitalize border-none px-3 py-1">
                                      <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
                                      {report.status}
                                    </Badge>
                                  </td>
                                  <td className="px-8 py-6 text-right">
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        variant="outline" size="sm" title="Download report"
                                        className="h-9 w-9 p-0 rounded-lg hover:bg-primary hover:text-white hover:border-primary transition-all"
                                        disabled={isDownloadingThis}
                                        onClick={() => downloadReport.mutate(report)}
                                      >
                                        {isDownloadingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                      </Button>
                                      <Button
                                        variant="outline" size="sm" title="Email report to yourself"
                                        className="h-9 w-9 p-0 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
                                        disabled={isEmailingThis}
                                        onClick={() => emailReport.mutate(report.id)}
                                      >
                                        {isEmailingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {reportsData && reportsData.totalPages > 1 && (
                      <PaginationRow
                        page={reportPage}
                        totalPages={reportsData.totalPages}
                        totalItems={reportsData.total}
                        pageSize={reportPageSize}
                        onPage={setReportPage}
                      />
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            </TabErrorBoundary>

            {/* Manager + Documents — outside the report error boundary intentionally:
                this data comes from dashboardData (already loaded) and should remain
                visible even if the reports query or table throws. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-none shadow-sm bg-blue-600 text-white">
                <CardContent className="p-6">
                  <h4 className="font-bold text-lg mb-2">Need Assistance?</h4>
                  <p className="text-blue-100 text-sm mb-4">Your dedicated portfolio manager is available to help.</p>
                  {contactManager ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-sm">
                        <Avatar className="h-8 w-8 border-2 border-white/20">
                          <AvatarFallback className="bg-white/10 text-xs">{contactManager.initials}</AvatarFallback>
                        </Avatar>
                        <span>{contactManager.name}</span>
                      </div>
                      <Button variant="secondary" className="w-full bg-card text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 font-bold border border-border" onClick={() => { window.location.href = `mailto:${contactManager?.email ?? ""}`; }}>Email Manager</Button>
                    </div>
                  ) : (
                    <Button variant="secondary" className="w-full bg-card text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 font-bold border border-border">Contact Support</Button>
                  )}
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm md:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-lg">Recent Documents</CardTitle></CardHeader>
                <CardContent>
                  {recentDocuments.length === 0 ? (
                    <EmptyState icon={FileText} title="No documents" description="Documents shared with you will appear here." />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {recentDocuments.map((doc, i) => (
                        <div key={i} className="flex items-center justify-between p-3 border rounded-xl hover:border-primary/50 transition-colors group">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg group-hover:bg-primary/10 transition-colors flex-shrink-0">
                              <FileText className="h-4 w-4 text-muted-foreground dark:text-slate-400 group-hover:text-primary" />
                            </div>
                            <div className="overflow-hidden">
                              <p className="text-sm font-medium truncate">{doc.name}</p>
                              <p className="text-[10px] text-slate-400 uppercase font-bold">{doc.type} • {doc.size}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" title={`Download ${doc.name}`}
                            className="h-8 w-8 p-0 flex-shrink-0 hover:bg-primary/10 hover:text-primary"
                            onClick={() => handleDownloadDocument(doc)}>
                            <Download className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          {/* ── Expenses ── */}
          <TabsContent value="expenses" className="space-y-4 animate-in fade-in duration-500">
            {/* Per-property cost summary */}
            {!expensesLoading && expensesData && expensesData.data && expensesData.data.length > 0 && (() => {
              const byProp: Record<string, { name: string; total: number; count: number }> = {};
              (expensesData.data as any[]).forEach((e: any) => {
                const key = e.propertyId ?? "unknown";
                if (!byProp[key]) byProp[key] = { name: e.propertyName ?? `Property #${key}`, total: 0, count: 0 };
                byProp[key].total += Number(e.amount ?? 0);
                byProp[key].count += 1;
              });
              const rows = Object.entries(byProp).sort((a, b) => b[1].total - a[1].total);
              if (rows.length < 2) return null;
              return (
                <Card className="border border-border shadow-sm rounded-xl">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">Cost breakdown by property</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {rows.map(([, v]) => {
                        const pct = expensesData.data.reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
                        const barW = pct > 0 ? Math.round((v.total / pct) * 100) : 0;
                        return (
                          <div key={v.name}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-medium truncate max-w-[200px]">{v.name}</span>
                              <span className="text-muted-foreground ml-2 shrink-0">KES {v.total.toLocaleString("en-KE")} · {v.count} item{v.count > 1 ? "s" : ""}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${barW}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-orange-500" /> Property Expenses
                    </CardTitle>
                    <CardDescription>Record and track expenses across your properties</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Select value={expensePropertyFilter || "__all__"} onValueChange={v => { setExpensePropertyFilter(v === "__all__" ? "" : v); setExpensePage(1); }}>
                      <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All properties" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All properties</SelectItem>
                        {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <PageSizeSelect value={expensePageSize} onChange={v => { setExpensePageSize(v); setExpensePage(1); }} />
                    <Button size="sm" className="h-9 gap-1.5" onClick={() => setShowExpenseForm(v => !v)}>
                      <PlusCircle className="w-4 h-4" /> Add Expense
                    </Button>
                  </div>
                </div>

                {/* Add expense form */}
                {showExpenseForm && (
                  <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                    <p className="text-sm font-semibold text-foreground">New Expense</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Property *</label>
                        <Select value={expenseForm.propertyId} onValueChange={v => setExpenseForm(f => ({ ...f, propertyId: v }))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Category *</label>
                        <Select value={expenseForm.category} onValueChange={v => setExpenseForm(f => ({ ...f, category: v }))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["maintenance","utilities","supplies","services","insurance","taxes","legal","marketing","other"].map(c => (
                              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Amount (KES) *</label>
                        <Input className="h-9 text-sm" type="number" placeholder="0.00" value={expenseForm.amount} onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Vendor / Payee *</label>
                        <Input className="h-9 text-sm" placeholder="e.g. City Water Board" value={expenseForm.vendorName} onChange={e => setExpenseForm(f => ({ ...f, vendorName: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Expense Date *</label>
                        <Input className="h-9 text-sm" type="date" value={expenseForm.expenseDate} onChange={e => setExpenseForm(f => ({ ...f, expenseDate: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Payment Method</label>
                        <Select value={expenseForm.paymentMethod} onValueChange={v => setExpenseForm(f => ({ ...f, paymentMethod: v }))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {["cash","mpesa","bank_transfer","cheque","card"].map(m => <SelectItem key={m} value={m} className="capitalize">{m.replace("_"," ")}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 sm:col-span-3 space-y-1">
                        <label className="text-xs text-muted-foreground">Description *</label>
                        <Input className="h-9 text-sm" placeholder="Brief description of the expense" value={expenseForm.description} onChange={e => setExpenseForm(f => ({ ...f, description: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <input type="checkbox" id="is-recurring" checked={expenseForm.isRecurring}
                        onChange={e => setExpenseForm(f => ({ ...f, isRecurring: e.target.checked }))} className="rounded" />
                      <label htmlFor="is-recurring" className="text-sm cursor-pointer select-none">Recurring expense</label>
                      {expenseForm.isRecurring && (
                        <Select value={expenseForm.recurringFrequency} onValueChange={v => setExpenseForm(f => ({ ...f, recurringFrequency: v }))}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["monthly","quarterly","annually"].map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setShowExpenseForm(false)}>Cancel</Button>
                      <Button size="sm" disabled={!expenseForm.propertyId || !expenseForm.vendorName || !expenseForm.description || !expenseForm.amount || addExpense.isPending} onClick={() => addExpense.mutate()}>
                        {addExpense.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Expense"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
                ) : !expensesData || expensesData.data.length === 0 ? (
                  <EmptyState icon={Receipt} title="No expenses recorded" description="Click 'Add Expense' to record your first property expense." />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs text-muted-foreground font-medium">
                            <th className="text-left pb-3 pr-4">Date</th>
                            <th className="text-left pb-3 pr-4">Vendor</th>
                            <th className="text-left pb-3 pr-4">Category</th>
                            <th className="text-left pb-3 pr-4">Description</th>
                            <th className="text-right pb-3 pr-4">Amount</th>
                            <th className="text-left pb-3 pr-4">Status</th>
                            <th className="pb-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {expensesData.data.map((e: any) => (
                            <tr key={e.id} className="hover:bg-muted/40 transition-colors">
                              <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted-foreground">{e.expenseDate ? format(new Date(e.expenseDate), "d MMM yyyy") : "—"}</td>
                              <td className="py-3 pr-4 font-medium">{e.vendorName}</td>
                              <td className="py-3 pr-4"><Badge variant="secondary" className="text-[10px] capitalize">{e.category}</Badge></td>
                              <td className="py-3 pr-4 text-muted-foreground max-w-[200px] truncate">{e.description}</td>
                              <td className="py-3 pr-4 text-right font-semibold">{e.currency || "KES"} {(Number(e.amount) || 0).toLocaleString("en-KE")}</td>
                              <td className="py-3 pr-4">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                                  e.status === "paid" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                                  e.status === "approved" ? "bg-blue-100 text-blue-800" :
                                  e.status === "rejected" ? "bg-red-100 text-red-700" :
                                  "bg-yellow-100 text-yellow-800"
                                }`}>{e.status ?? "pending"}</span>
                              </td>
                              <td className="py-3">
                                <div className="flex items-center gap-1">
                                  {e.receiptUrl ? (
                                    <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer">
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-green-600 hover:text-green-700" title="View receipt">
                                        <Download className="w-3.5 h-3.5" />
                                      </Button>
                                    </a>
                                  ) : (
                                    <>
                                      <input type="file" id={`receipt-${e.id}`} className="hidden" accept="image/*,.pdf"
                                        onChange={async (ev: React.ChangeEvent<HTMLInputElement>) => {
                                          const file = ev.target.files?.[0];
                                          if (!file) return;
                                          await uploadExpenseReceipt(e.id, file);
                                          ev.target.value = "";
                                        }}
                                      />
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-500"
                                        title="Upload receipt" disabled={expenseReceiptUploading[e.id]}
                                        onClick={() => document.getElementById(`receipt-${e.id}`)?.click()}>
                                        {expenseReceiptUploading[e.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                                      </Button>
                                    </>
                                  )}
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                                    onClick={() => { if (confirm("Delete this expense?")) deleteExpense.mutate(e.id); }}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {expensesData.totalPages > 1 && (
                      <PaginationRow page={expensePage} totalPages={expensesData.totalPages} totalItems={expensesData.total} pageSize={expensePageSize} onPage={setExpensePage} />
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents ── */}
          <TabsContent value="documents" className="space-y-4 animate-in fade-in duration-500">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FolderOpen className="w-5 h-5 text-blue-500" /> Property Documents
                    </CardTitle>
                    <CardDescription>Leases, notices, inspection reports, and other property files</CardDescription>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Select value={docPropertyFilter || "__all__"} onValueChange={v => setDocPropertyFilter(v === "__all__" ? "" : v)}>
                      <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All properties" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All properties</SelectItem>
                        {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={docTypeFilter || "__all__"} onValueChange={v => setDocTypeFilter(v === "__all__" ? "" : v)}>
                      <SelectTrigger className="w-36 h-9 text-sm"><SelectValue placeholder="All types" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All types</SelectItem>
                        {["lease","invoice","receipt","maintenance","other","owner_upload"].map(t => (
                          <SelectItem key={t} value={t} className="capitalize">{t.replace("_"," ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <input type="file" id="doc-upload" className="hidden"
                        onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          await uploadDoc(file, docPropertyFilter);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" className="h-9 gap-1.5" onClick={() => document.getElementById("doc-upload")?.click()}>
                        <Paperclip className="w-4 h-4" /> Upload
                      </Button>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => refetchDocs()}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Document category chips */}
                <div className="flex gap-1.5 flex-wrap pb-1">
                  {["all","lease","invoice","insurance","compliance","inspection","other"].map(cat => (
                    <button key={cat} onClick={() => setDocCategory(cat)}
                      className={`text-xs px-3 py-1 rounded-full border font-medium capitalize transition-all ${
                        docCategory === cat
                          ? "bg-foreground text-background border-transparent"
                          : "border-border text-muted-foreground hover:border-foreground/40"
                      }`}>
                      {cat === "all" ? "All" : cat}
                    </button>
                  ))}
                </div>

                {docsLoading ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
                ) : (() => {
                  const filtered = landlordDocs
                    .filter((d: any) => !docTypeFilter || d.type === docTypeFilter)
                    .filter((d: any) => docCategory === "all" ||
                      (d.category ?? d.type ?? d.name ?? "").toLowerCase().includes(docCategory));
                  return filtered.length === 0 ? (
                    <EmptyState icon={FolderOpen} title="No documents" description="Upload property documents using the button above, or they'll appear here once shared by your property manager." />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filtered.map((doc: any) => {
                        const ext = doc.name?.split(".").pop()?.toUpperCase() ?? "FILE";
                        const EXT_COLORS: Record<string, string> = { PDF: "bg-red-100 text-red-700", DOCX: "bg-blue-100 text-blue-700", DOC: "bg-blue-100 text-blue-700", XLSX: "bg-emerald-50 text-emerald-700 border border-emerald-200", JPG: "bg-purple-100 text-purple-700", JPEG: "bg-purple-100 text-purple-700", PNG: "bg-purple-100 text-purple-700" };
                        return (
                          <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/30 hover:shadow-sm transition-all group">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-[11px] shrink-0 ${EXT_COLORS[ext] ?? "bg-muted text-muted-foreground"}`}>
                              {ext}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{doc.name}</p>
                              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                                {doc.type?.replace("_"," ")} {doc.size ? `· ${(doc.size / 1024).toFixed(0)} KB` : ""}
                                {doc.createdAt ? ` · ${format(new Date(doc.createdAt), "d MMM yyyy")}` : ""}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noopener noreferrer">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:text-primary">
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              </a>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:text-red-500"
                                onClick={() => { if (confirm("Delete this document?")) deleteDoc.mutate(doc.id); }}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Maintenance Approvals ── */}
          <TabsContent value="approvals" className="space-y-4 animate-in fade-in duration-500">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-purple-500" /> Maintenance Approvals
                    </CardTitle>
                    <CardDescription>High-cost or flagged maintenance requests that require your sign-off before work begins</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => refetchApprovals()}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {approvalsLoading ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
                ) : pendingApprovals.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No pending approvals" description="Maintenance requests flagged for your approval will appear here." />
                ) : (
                  <div className="space-y-3">
                    {pendingApprovals.map((req: any) => {
                      const isExpanded = approvalExpandedId === req.id;
                      const prio = PRIORITY_CONFIG[req.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.medium;
                      const alreadyActioned = !!req.approvedBy;
                      return (
                        <div key={req.id} className={`rounded-xl border overflow-hidden ${alreadyActioned ? "border-border opacity-60" : req.status === "cancelled" ? "border-red-200" : "border-orange-200"}`}>
                          <button className="w-full flex items-start gap-4 p-4 text-left hover:bg-muted/40 transition-colors" onClick={() => setApprovalExpandedId(isExpanded ? null : req.id)}>
                            <div className={`p-2 rounded-lg ${prio.bg} shrink-0 mt-0.5`}>
                              <Wrench className={`h-5 w-5 ${prio.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div>
                                  <p className="text-sm font-semibold">{req.propertyName}{req.unitNumber ? ` — Unit ${req.unitNumber}` : ""}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{req.title}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap shrink-0">
                                  {req.estimatedCost && (
                                    <span className="text-xs font-bold text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 px-2 py-0.5 rounded-lg border border-orange-200 dark:border-orange-800" >
                                      Est. KES {(Number(req.estimatedCost) || 0).toLocaleString("en-KE")}
                                    </span>
                                  )}
                                  <Badge variant="secondary" className={`text-[10px] capitalize ${prio.text}`}>{prio.label} priority</Badge>
                                  {alreadyActioned && (
                                    <Badge className={`text-[10px] ${req.status === "assigned" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-100 text-red-700"}`}>
                                      {req.status === "assigned" ? "Approved" : "Rejected"}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-1.5 flex gap-3">
                                <span>#{req.ticketNumber}</span>
                                <span>{getRelativeTime(req.createdAt)}</span>
                              </div>
                            </div>
                            <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          </button>

                          {isExpanded && (
                            <div className="border-t border-border bg-muted/30 p-4 space-y-4">
                              {req.description && <p className="text-sm text-muted-foreground">{req.description}</p>}

                              {/* Internal notes */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Internal Notes (optional)</label>
                                <Textarea rows={2} className="text-sm" placeholder="Add notes for the property manager…"
                                  value={approvalNotes[req.id] ?? req.internalNotes ?? ""}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setApprovalNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                                />
                              </div>

                              {!alreadyActioned && (
                                <>
                                  {/* Rejection reason */}
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Rejection Reason (required if rejecting)</label>
                                    <Input className="h-9 text-sm" placeholder="Why are you rejecting this request?"
                                      value={approvalReason[req.id] ?? ""}
                                      onChange={e => setApprovalReason(prev => ({ ...prev, [req.id]: e.target.value }))}
                                    />
                                  </div>
                                  <div className="flex gap-3">
                                    <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2"
                                      disabled={actOnApproval.isPending}
                                      onClick={() => actOnApproval.mutate({ id: req.id, action: "approve", notes: approvalNotes[req.id] })}>
                                      <ThumbsUp className="w-4 h-4" /> Approve — Proceed with Work
                                    </Button>
                                    <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2"
                                      disabled={actOnApproval.isPending || !approvalReason[req.id]?.trim()}
                                      onClick={() => actOnApproval.mutate({ id: req.id, action: "reject", rejectionReason: approvalReason[req.id], notes: approvalNotes[req.id] })}>
                                      <ThumbsDown className="w-4 h-4" /> Reject
                                    </Button>
                                  </div>
                                </>
                              )}

                              {alreadyActioned && req.rejectionReason && (
                                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-300">
                                  <p className="font-semibold text-xs mb-1">Rejection reason:</p>
                                  {req.rejectionReason}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Messages ── */}
          <TabsContent value="messages" className="space-y-5 animate-in fade-in duration-500">
            <LandlordMessagesPanel
              messages={allMessages}
              isLoading={msgsLoading}
              isSending={sendMsg.isPending}
              tenants={tenantsData?.data ?? []}
              onRefresh={refetchMsgs}
              onSend={async (subject, content, toUserId) => {
                await sendMsg.mutateAsync({ subject, content, toUserId });
              }}
              onMarkRead={(ids) => markMsgRead.mutate(ids)}
            />
          </TabsContent>

          {/* ── Ratings ── */}
          <TabsContent value="ratings" className="space-y-6 animate-in fade-in duration-500">
            <LandlordRatingsView />
          </TabsContent>

        </Tabs>
        </div>
        </main>

      </div>

  );
}