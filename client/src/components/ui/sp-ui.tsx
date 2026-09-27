/**
 * sp-ui.tsx — SmartProp Design System
 *
 * All shared primitives used across every page.
 * Import from "@/components/ui/sp-ui" instead of scattering
 * one-off className strings across 60+ pages.
 *
 * Exports:
 *   PageShell          — standard page wrapper (bg, max-width, padding)
 *   PageHeader         — title + subtitle + right-side actions
 *   SectionCard        — white card with header row + body
 *   StatsGrid          — 2–4 column KPI stat tiles
 *   StatTile           — individual KPI tile with accent bar
 *   SPTable            — full-width data table (header, rows, empty state)
 *   SPBadge            — status / priority / type badge
 *   SPAvatar           — initials avatar with consistent colour rotation
 *   EmptyState         — illustrated empty state with optional CTA
 *   FilterBar          — search + filter row above tables
 *   ActionMenu         — kebab dropdown for row actions
 *   ConfirmDialog      — generic confirm/destructive dialog
 *   DrawerPanel        — right-side slide-over for detail views
 *   SectionDivider     — labelled horizontal rule between sections
 *   LoadingRow         — single skeleton row for inline loaders
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight, Search, SlidersHorizontal, MoreVertical,
  AlertTriangle, X, Plus,
} from "lucide-react";

// ── Colour tokens ─────────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  "bg-emerald-500", "bg-blue-500",   "bg-violet-500",
  "bg-amber-500",   "bg-rose-500",   "bg-cyan-500",
];

const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
];

// ── PageShell ─────────────────────────────────────────────────────────────────

export function PageShell({
  children, className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-screen bg-background", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {children}
      </div>
    </div>
  );
}

// ── PageHeader ────────────────────────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: Array<{ label: string; href?: string }>;
}

export function PageHeader({ title, subtitle, icon, actions, breadcrumb }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 text-white">
            {icon}
          </div>
        )}
        <div>
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              {breadcrumb.map((b, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="w-3 h-3" />}
                  <span className={b.href ? "hover:text-slate-600 cursor-pointer" : ""}>{b.label}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          <h1 className="text-xl font-semibold text-foreground leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// ── SectionCard ───────────────────────────────────────────────────────────────

interface SectionCardProps {
  title?: string;
  subtitle?: React.ReactNode;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  children: React.ReactNode;
  className?: string;
  padding?: "default" | "none" | "tight";
  noBorder?: boolean;
}

export function SectionCard({
  title, subtitle, action, children, className = "", padding = "default", noBorder = false,
}: SectionCardProps) {
  const padClass = padding === "none" ? "" : padding === "tight" ? "px-4 py-3" : "px-5 py-4";
  return (
    <div className={cn(
      "bg-card rounded-xl shadow-sm overflow-hidden",
      noBorder ? "" : "border border-border",
      className,
    )}>
      {(title || action) && (
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {action && (
            <button
              onClick={action.onClick}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              {action.icon}
              {action.label}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
      <div className={padClass}>{children}</div>
    </div>
  );
}

// ── StatsGrid ─────────────────────────────────────────────────────────────────

export function StatsGrid({ children, cols = 4, className = "" }: {
  children: React.ReactNode; cols?: 2 | 3 | 4; className?: string;
}) {
  const gridCols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cn(`grid gap-4 ${gridCols}`, className)}>{children}</div>;
}

// ── StatTile ──────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: "emerald" | "blue" | "amber" | "red" | "violet" | "orange";
  trend?: { value: string; up: boolean };
  onClick?: () => void;
}

  const ACCENT_MAP: Record<string, { bar: string; icon: string; trend_up: string; trend_dn: string }> = {
  emerald: { bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400", trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
  blue:    { bar: "bg-blue-500",    icon: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",           trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
  amber:   { bar: "bg-amber-500",   icon: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400",       trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
  red:     { bar: "bg-red-500",     icon: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400",               trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
  violet:  { bar: "bg-violet-500",  icon: "bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400",   trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
  orange:  { bar: "bg-orange-500",  icon: "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400",   trend_up: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", trend_dn: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400" },
};

export function StatTile({ label, value, sub, icon, accent = "emerald", trend, onClick }: StatTileProps) {
  const c = ACCENT_MAP[accent];
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "group relative bg-card rounded-xl border border-border shadow-sm p-5 text-left overflow-hidden",
        onClick && "hover:border-muted hover:shadow-md transition-all duration-200 w-full cursor-pointer",
      )}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${c.bar} rounded-l-xl`} />
      <div className="flex items-start justify-between mb-3 ml-2">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", c.icon)}>
          {icon}
        </div>
        {trend && (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", trend.up ? c.trend_up : c.trend_dn)}>
            {trend.value}
          </span>
        )}
      </div>
      <div className="ml-2">
        <p className="text-2xl font-bold text-foreground tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{sub}</p>}
      </div>
      <p className="absolute top-4 right-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {onClick && (
        <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </Wrapper>
  );
}

// ── SPBadge ───────────────────────────────────────────────────────────────────

type BadgeIntent =
  | "active" | "success" | "paid" | "completed" | "approved" | "confirmed" | "live"
  | "pending" | "draft" | "processing" | "review"
  | "overdue" | "rejected" | "failed" | "urgent" | "expired" | "cancelled"
  | "inactive" | "partial" | "low" | "medium" | "high" | "warning"
  | "info" | "blue" | "violet" | "default";

const BADGE_MAP: Record<string, string> = {
  active:     "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  available:  "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  success:    "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  successful: "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  sent:       "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  paid:       "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  completed:  "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  approved:   "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  confirmed:  "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  live:       "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  posted:     "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  filed:      "bg-emerald-50  text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",

  pending:    "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  draft:      "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  processing: "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  review:     "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  warning:    "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  partial:    "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",
  medium:     "bg-amber-50    text-amber-700   border-amber-200   dark:bg-amber-950   dark:text-amber-400   dark:border-amber-800",

  overdue:    "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  unpaid:     "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  rejected:   "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  failed:     "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  urgent:     "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  expired:    "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  high:       "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",
  critical:   "bg-red-50      text-red-600     border-red-200     dark:bg-red-950     dark:text-red-400     dark:border-red-800",

  cancelled:  "bg-muted       text-muted-foreground   border-border",
  inactive:   "bg-muted       text-muted-foreground   border-border",
  unavailable:"bg-muted       text-muted-foreground   border-border",
  low:        "bg-muted       text-muted-foreground   border-border",
  reversed:   "bg-muted       text-muted-foreground   border-border",

  info:       "bg-blue-50     text-blue-700    border-blue-200    dark:bg-blue-950    dark:text-blue-400    dark:border-blue-800",
  blue:       "bg-blue-50     text-blue-700    border-blue-200    dark:bg-blue-950    dark:text-blue-400    dark:border-blue-800",
  in_progress:"bg-blue-50     text-blue-700    border-blue-200    dark:bg-blue-950    dark:text-blue-400    dark:border-blue-800",
  submitted:  "bg-blue-50     text-blue-700    border-blue-200    dark:bg-blue-950    dark:text-blue-400    dark:border-blue-800",
  accepted:   "bg-blue-50     text-blue-700    border-blue-200    dark:bg-blue-950    dark:text-blue-400    dark:border-blue-800",

  violet:     "bg-violet-50   text-violet-700  border-violet-200  dark:bg-violet-950  dark:text-violet-400  dark:border-violet-800",

  default:    "bg-muted       text-muted-foreground   border-border",
};

export function SPBadge({ status, className = "" }: { status: string; className?: string }) {
  const key   = status?.toLowerCase().replace(/[\s-]/g, "_") ?? "default";
  const style = BADGE_MAP[key] ?? BADGE_MAP.default;
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize",
      style, className,
    )}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

// ── SPAvatar ──────────────────────────────────────────────────────────────────

export function SPAvatar({
  name = "", size = "sm", className = "",
}: { name?: string; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const idx   = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  const cls   = AVATAR_COLORS[idx];
  const parts = name.trim().split(" ");
  const init  = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
  const dim   = { xs: "w-6 h-6 text-[10px]", sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-12 h-12 text-base" }[size];
  return (
    <div className={cn(dim, cls, "rounded-full flex items-center justify-center font-semibold flex-shrink-0", className)}>
      {init}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  size?: "sm" | "md" | "lg";
}

export function EmptyState({ icon, title, description, action, size = "md" }: EmptyStateProps) {
  const py    = { sm: "py-6", md: "py-10", lg: "py-16" }[size];
  const iSize = { sm: "w-10 h-10", md: "w-14 h-14", lg: "w-16 h-16" }[size];
  const iIcon = { sm: "w-5 h-5", md: "w-7 h-7", lg: "w-8 h-8" }[size];
  return (
    <div className={cn("flex flex-col items-center text-center px-4 space-y-3", py)}>
      <div className={cn(iSize, "rounded-2xl bg-muted border border-border flex items-center justify-center text-muted-foreground")}>
        {React.isValidElement(icon)
          ? React.cloneElement(icon as any, { className: iIcon })
          : icon}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-xs">{description}</p>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
        >
          {action.icon ?? <Plus className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
}

export function FilterBar({ search, onSearch, placeholder = "Search…", filters, actions }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div className="flex items-center gap-2 flex-1 flex-wrap">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder={placeholder}
            className="pl-9 h-9 bg-background border-border focus-visible:ring-emerald-500 text-sm rounded-lg"
          />
        </div>
        {filters}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── SPTable ───────────────────────────────────────────────────────────────────

interface SPTableColumn<T = any> {
  header: string;
  accessor?: keyof T;
  cell?: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  hideOnMobile?: boolean;
}

interface SPTableProps<T = any> {
  columns: SPTableColumn<T>[];
  data: T[];
  keyField?: keyof T;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function SPTable<T>({
  columns, data, keyField = "id" as keyof T, onRowClick,
  emptyState, loading = false, className = "",
}: SPTableProps<T>) {
  if (loading) {
    return (
      <div className={cn("bg-card rounded-xl border border-border shadow-sm overflow-hidden", className)}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-0">
            <div className="animate-pulse w-8 h-8 rounded-full bg-muted flex-shrink-0" />
            {[...Array(columns.length - 1)].map((_, j) => (
              <div key={j} className={`animate-pulse h-4 bg-muted rounded ${j === 0 ? "flex-1" : "w-24"}`} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (data.length === 0 && emptyState) {
    return (
      <div className={cn("bg-card rounded-xl border border-border shadow-sm overflow-hidden", className)}>
        {emptyState}
      </div>
    );
  }

  return (
    <div className={cn("bg-card rounded-xl border border-border shadow-sm overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted border-b border-border" >
              {columns.map((col, i) => (
                <th
                  key={i}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    "px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide",
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                    col.hideOnMobile && "hidden sm:table-cell",
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, ri) => (
              <tr
                key={String((row as any)[keyField] ?? ri)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "border-b border-border last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-muted",
                )}
              >
                {columns.map((col, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      "px-5 py-3.5 text-foreground",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "",
                      col.hideOnMobile && "hidden sm:table-cell",
                    )}
                  >
                    {col.cell
                      ? col.cell(row)
                      : col.accessor
                        ? String((row as any)[col.accessor] ?? "—")
                        : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ActionMenu ────────────────────────────────────────────────────────────────

interface ActionMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders a divider directly above this item — typically used to set a
   *  destructive action apart from the rest of the menu. */
  separator?: boolean;
}

export function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg border-border p-1">
        {items.map((item, i) => (
          <span key={i}>
            {item.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={item.onClick}
              disabled={item.disabled}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer",
                item.destructive ? "text-red-600 hover:bg-red-50 focus:bg-red-50 focus:text-red-600" : "",
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, description,
  confirmLabel = "Confirm", destructive = false, loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogHeader>
          {destructive && (
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
          )}
          <DialogTitle className="text-center text-base">{title}</DialogTitle>
        </DialogHeader>
        {description && (
          <p className="text-sm text-muted-foreground text-center leading-relaxed">{description}</p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1 rounded-lg">
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex-1 rounded-lg",
              destructive
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white",
            )}
          >
            {loading ? "Please wait…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DrawerPanel ───────────────────────────────────────────────────────────────

interface DrawerPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: "sm" | "md" | "lg";
  actions?: React.ReactNode;
}

export function DrawerPanel({ open, onClose, title, subtitle, children, width = "md", actions }: DrawerPanelProps) {
  const widthCls = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[width];
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("h-full bg-card shadow-2xl flex flex-col w-full", widthCls)}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-border" >
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors ml-4">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {actions && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SectionDivider ────────────────────────────────────────────────────────────

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── LoadingRow ────────────────────────────────────────────────────────────────

export function LoadingRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-border animate-pulse">
      <div className="w-9 h-9 rounded-full bg-muted flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-1/3" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
      <div className="h-5 w-16 bg-muted rounded-full" />
    </div>
  );
}

// ── PrimaryButton ─────────────────────────────────────────────────────────────

export function PrimaryButton({
  children, onClick, disabled, loading, icon, className = "",
}: {
  children: React.ReactNode; onClick?: () => void;
  disabled?: boolean; loading?: boolean;
  icon?: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
    >
      {loading ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : icon}
      {children}
    </button>
  );
}

// ── SecondaryButton ───────────────────────────────────────────────────────────

export function SecondaryButton({
  children, onClick, disabled, icon, className = "",
}: {
  children: React.ReactNode; onClick?: () => void;
  disabled?: boolean; icon?: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-background border border-border hover:bg-muted text-foreground text-sm font-medium transition-colors disabled:opacity-50",
        className,
      )}
    >
      {icon}{children}
    </button>
  );
}

// ── KES amount display ────────────────────────────────────────────────────────

export function KESAmount({
  amount, className = "", size = "sm",
}: { amount: number | string; className?: string; size?: "sm" | "md" | "lg" }) {
  const n   = Number(amount ?? 0);
  const fmt = n >= 1_000_000 ? `KES ${(n / 1_000_000).toFixed(1)}M`
            : n >= 1_000     ? `KES ${(n / 1_000).toFixed(0)}K`
            :                  `KES ${Math.round(n).toLocaleString("en-KE")}`;
  const s   = { sm: "text-sm", md: "text-base", lg: "text-xl" }[size];
  return <span className={cn(s, "font-semibold tabular-nums", className)}>{fmt}</span>;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export function SPPagination({
  page, totalPages, onPage,
}: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-3">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Previous
      </button>
      <span className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}