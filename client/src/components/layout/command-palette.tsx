import * as React from "react";
import { useLocation } from "wouter";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { withOrgParam } from "@/lib/platformOrgContext";
import { getNavForRole, isRouteAllowed } from "@/lib/roleNav";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Building2, User, Users, Wrench, Loader2, Receipt, DoorOpen, HardHat, Wallet,
  Zap, FileText, UserCog, CornerDownLeft, Compass, AlertCircle,
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ctrl/⌘ + K toggles the palette. Only one palette instance per screen size should listen. */
  enableShortcut?: boolean;
}

interface Hit {
  id: number | string;
  title: string;
  subtitle?: string;
  badge?: string;
  href: string;
}
type Groups = Record<string, Hit[]>;

// Display order, heading and icon for each server group.
const GROUPS: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "properties",    label: "Properties",     icon: Building2 },
  { key: "units",         label: "Units",          icon: DoorOpen },
  { key: "tenants",       label: "Tenants",        icon: User },
  { key: "invoices",      label: "Invoices & payments", icon: Receipt },
  { key: "maintenance",   label: "Maintenance",    icon: Wrench },
  { key: "contractors",   label: "Contractors",    icon: HardHat },
  { key: "expenses",      label: "Expenses",       icon: Wallet },
  { key: "utility",       label: "Utility bills",  icon: Zap },
  { key: "leases",        label: "Leases",         icon: FileText },
  { key: "team",          label: "Team",           icon: UserCog },
  // platform_admin only
  { key: "users",         label: "Users",          icon: Users },
  { key: "organizations", label: "Organisations",  icon: Building2 },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onOpenChange, enableShortcut = true }: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const role = user?.role;
  const isPlatformAdmin = role === "platform_admin";

  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 250);
  const canSearch = debounced.length >= 2;

  // Clear the box each time the palette is reopened.
  React.useEffect(() => { if (!open) setQuery(""); }, [open]);

  // ── Records (server-side, whole organisation) ────────────────────────────
  const { data, isFetching, isError } = useQuery<Groups>({
    queryKey: ["/api/search", debounced, role],
    queryFn: async () => {
      if (isPlatformAdmin) {
        // No fixed organisation: look across all of them.
        const r = await apiRequest(`/api/platform/search?q=${encodeURIComponent(debounced)}`);
        const d = await r.json();
        const org = (x: any) => String(x.organizationId);
        return {
          properties: (d.properties ?? []).map((p: any) => ({
            id: p.id, title: p.name, subtitle: [p.address, p.organizationName].filter(Boolean).join(" · "),
            href: withOrgParam(`/properties/${p.id}`, org(p)),
          })),
          tenants: (d.tenants ?? []).map((x: any) => ({
            id: x.id, title: `${x.firstName ?? ""} ${x.lastName ?? ""}`.trim(),
            subtitle: [x.email, x.organizationName].filter(Boolean).join(" · "),
            href: x.propertyId ? withOrgParam(`/properties/${x.propertyId}`, org(x)) : withOrgParam("/properties", org(x)),
          })),
          users: (d.users ?? []).map((u: any) => ({
            id: u.id, title: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
            subtitle: [u.email, u.organizationName].filter(Boolean).join(" · "), badge: u.role,
            href: withOrgParam("/properties", org(u)),
          })),
          organizations: (d.organizations ?? []).map((o: any) => ({
            id: o.id, title: o.name, href: withOrgParam("/properties", String(o.id)),
          })),
        } as Groups;
      }
      const r = await apiRequest(`/api/search?q=${encodeURIComponent(debounced)}&limit=5`);
      const d = await r.json();
      return (d.groups ?? {}) as Groups;
    },
    enabled: open && canSearch,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });

  // ── Pages (instant, from this role's own navigation) ─────────────────────
  const pages = React.useMemo(() => {
    if (!role || isPlatformAdmin) return [] as { name: string; href: string; parent?: string }[];
    const out: { name: string; href: string; parent?: string }[] = [];
    const seen = new Set<string>();
    for (const g of getNavForRole(role, t as any)) {
      for (const item of g.items) {
        if (isRouteAllowed(role, item.href) && !seen.has(item.href)) {
          seen.add(item.href); out.push({ name: item.name, href: item.href });
        }
        for (const c of item.children ?? []) {
          if (isRouteAllowed(role, c.href) && !seen.has(c.href)) {
            seen.add(c.href); out.push({ name: c.name, href: c.href, parent: item.name });
          }
        }
      }
    }
    return out;
  }, [role, isPlatformAdmin, t]);

  const pageMatches = React.useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return pages.filter(p => !p.parent).slice(0, 8);
    return pages
      .filter(p => p.name.toLowerCase().includes(q) || p.parent?.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [pages, trimmed]);

  // ── Ctrl/⌘ + K ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!enableShortcut) return;
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange, enableShortcut]);

  const go = React.useCallback((href: string) => {
    onOpenChange(false);
    setLocation(href);
  }, [onOpenChange, setLocation]);

  // Only offer records the user is actually allowed to open.
  const visibleGroups = React.useMemo(() => {
    if (!canSearch || !data) return [];
    return GROUPS
      .map(g => ({
        ...g,
        hits: (data[g.key] ?? []).filter(h => isPlatformAdmin || isRouteAllowed(role, h.href.split("?")[0])),
      }))
      .filter(g => g.hits.length > 0);
  }, [data, canSearch, role, isPlatformAdmin]);

  const waiting = trimmed.length >= 2 && (debounced !== trimmed || (isFetching && !data));
  const hasAnything = visibleGroups.length > 0 || pageMatches.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      // Sit near the top on phones so the on-screen keyboard doesn't cover the results.
      contentClassName="top-[8%] translate-y-0 sm:top-[50%] sm:translate-y-[-50%] max-w-xl"
    >
      <CommandInput
        placeholder={isPlatformAdmin
          ? "Search properties, tenants, users, organisations…"
          : "Search tenants, properties, invoices, tickets, pages…"}
        value={query}
        onValueChange={setQuery}
        autoFocus
        className="!bg-transparent !shadow-none !ring-0 focus-visible:!outline-none"
      />
      <CommandList className="max-h-[min(60vh,420px)]">
        {/* Pages / quick navigation */}
        {pageMatches.length > 0 && (
          <CommandGroup heading={trimmed ? "Pages" : "Go to"}>
            {pageMatches.map(p => (
              <CommandItem key={`page-${p.href}`} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                <Compass className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="truncate">{p.name}</span>
                {p.parent && <span className="ml-2 text-xs text-muted-foreground truncate">{p.parent}</span>}
                <CornerDownLeft className="ml-auto h-3.5 w-3.5 text-muted-foreground/60 hidden sm:block" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Records */}
        {visibleGroups.map((g, i) => (
          <React.Fragment key={g.key}>
            {(i > 0 || pageMatches.length > 0) && <CommandSeparator />}
            <CommandGroup heading={g.label}>
              {g.hits.map(h => (
                <CommandItem key={`${g.key}-${h.id}`} value={`${g.key}-${h.id}`} onSelect={() => go(h.href)}>
                  <g.icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{h.title}</div>
                    {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                  </div>
                  {h.badge && (
                    <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                      {h.badge}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}

        {/* Status lines */}
        {waiting && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        )}
        {!waiting && isError && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" /> Search is unavailable right now. Pages still work.
          </div>
        )}
        {!waiting && !isError && trimmed.length === 1 && (
          <div className="py-4 text-center text-xs text-muted-foreground">Type at least 2 characters to search records.</div>
        )}
        {!waiting && !isError && canSearch && debounced === trimmed && !hasAnything && (
          <CommandEmpty>No results for “{trimmed}”.</CommandEmpty>
        )}
        {!waiting && !isError && canSearch && debounced === trimmed && hasAnything && visibleGroups.length === 0 && (
          <div className="py-3 text-center text-xs text-muted-foreground">No records matched “{trimmed}”.</div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
