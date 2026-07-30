import * as React from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { withOrgParam } from "@/lib/platformOrgContext";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Building2, User, Wrench, Search, Loader2, Filter } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SearchScope = "all" | "properties" | "tenants" | "maintenance";

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<SearchScope>("all");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";

  // Server-side search simulation
  const { data: results, isLoading } = useQuery({
    queryKey: ["/api/search", query, scope, isPlatformAdmin],
    queryFn: async () => {
      if (query.length < 2) return null;

      // platform_admin has no fixed org — the regular endpoints below
      // (/api/properties etc.) would either fail outright or only search
      // one org anyway, missing the entire point: finding something
      // without already knowing which org it's in.
      if (isPlatformAdmin) {
        const r = await apiRequest(`/api/platform/search?q=${encodeURIComponent(query)}`);
        const data = await r.json();
        return {
          properties: scope === "all" || scope === "properties" ? (data.properties ?? []) : [],
          tenants: scope === "all" || scope === "tenants" ? (data.tenants ?? []) : [],
          users: scope === "all" || scope === "tenants" ? (data.users ?? []) : [],
          organizations: data.organizations ?? [],
          maintenance: [],
        };
      }

      const [propsRes, tenantsRes, maintRes] = await Promise.all([
        apiRequest("/api/properties"),
        apiRequest("/api/tenants"),
        apiRequest("/api/maintenance-requests"),
      ]);

      const [props, tenants, maint] = await Promise.all([
        propsRes.json(),
        tenantsRes.json(),
        maintRes.json(),
      ]);

      const properties = Array.isArray(props) ? props : (props?.results ?? []);
      const tenantsList = Array.isArray(tenants) ? tenants : (tenants?.results ?? []);
      const maintenance = Array.isArray(maint) ? maint : (maint?.results ?? []);

      const q = query.toLowerCase();
      return {
        properties: (scope === "all" || scope === "properties") 
          ? properties.filter((p: any) => p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q)).slice(0, 5)
          : [],
        tenants: (scope === "all" || scope === "tenants")
          ? tenantsList.filter((t: any) => `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q)).slice(0, 5)
          : [],
        maintenance: (scope === "all" || scope === "maintenance")
          ? maintenance.filter((r: any) => r.title?.toLowerCase().includes(q)).slice(0, 5)
          : [],
        users: [],
        organizations: [],
      };
    },
    enabled: query.length >= 2,
  });

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = React.useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type to search properties, tenants, or maintenance..."
        value={query}
        onValueChange={setQuery}
      />
      <div className="flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
        <Filter className="h-3 w-3" />
        <span>Scope:</span>
        {(["all", "properties", "tenants", "maintenance"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`px-2 py-0.5 rounded-full capitalize transition-colors ${
              scope === s 
                ? "bg-primary/10 text-primary" 
                : "hover:bg-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <CommandList>
        <CommandEmpty>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span>Searching...</span>
            </div>
          ) : (
            "No results found."
          )}
        </CommandEmpty>
        
        {results?.properties && results.properties.length > 0 && (
          <CommandGroup heading="Properties">
            {results.properties.map((p: any) => (
              <CommandItem
                key={p.id}
                value={`property-${p.id}-${p.name}`}
                onSelect={() => runCommand(() => setLocation(
                  isPlatformAdmin ? withOrgParam(`/properties/${p.id}`, String(p.organizationId)) : `/properties/${p.id}`
                ))}
              >
                <Building2 className="mr-2 h-4 w-4" />
                <span>{p.name}</span>
                <span className="ml-2 text-xs text-muted-foreground truncate">{p.address}</span>
                {isPlatformAdmin && <span className="ml-auto text-xs text-muted-foreground pl-2 shrink-0">{p.organizationName}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results?.tenants && results.tenants.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tenants">
              {results.tenants.map((t: any) => (
                <CommandItem
                  key={t.id}
                  value={`tenant-${t.id}-${t.firstName}-${t.lastName}`}
                  onSelect={() => runCommand(() => setLocation(
                    isPlatformAdmin
                      ? (t.propertyId ? withOrgParam(`/properties/${t.propertyId}`, String(t.organizationId)) : withOrgParam("/properties", String(t.organizationId)))
                      : `/tenants/${t.id}`
                  ))}
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>{t.firstName} {t.lastName}</span>
                  <span className="ml-2 text-xs text-muted-foreground truncate">{t.email}</span>
                  {isPlatformAdmin && <span className="ml-auto text-xs text-muted-foreground pl-2 shrink-0">{t.organizationName}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {isPlatformAdmin && results?.users && results.users.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Users">
              {results.users.map((u: any) => (
                <CommandItem
                  key={u.id}
                  value={`user-${u.id}-${u.firstName}-${u.lastName}`}
                  onSelect={() => runCommand(() => setLocation(withOrgParam("/properties", String(u.organizationId))))}
                >
                  <User className="mr-2 h-4 w-4" />
                  <span>{u.firstName} {u.lastName}</span>
                  <span className="ml-2 text-xs text-muted-foreground truncate capitalize">{u.role} · {u.email}</span>
                  <span className="ml-auto text-xs text-muted-foreground pl-2 shrink-0">{u.organizationName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {isPlatformAdmin && results?.organizations && results.organizations.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Organisations">
              {results.organizations.map((o: any) => (
                <CommandItem
                  key={o.id}
                  value={`org-${o.id}-${o.name}`}
                  onSelect={() => runCommand(() => setLocation(withOrgParam("/properties", String(o.id))))}
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  <span>{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!isPlatformAdmin && results?.maintenance && results.maintenance.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Maintenance">
              {results.maintenance.map((r: any) => (
                <CommandItem
                  key={r.id}
                  value={`maint-${r.id}-${r.title}`}
                  onSelect={() => runCommand(() => setLocation(`/maintenance-request/${r.id}`))}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  <span>{r.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground capitalize">{r.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!isPlatformAdmin && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={() => runCommand(() => setLocation("/properties"))}>
                <Building2 className="mr-2 h-4 w-4" />
                <span>View All Properties</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => setLocation("/tenants"))}>
                <User className="mr-2 h-4 w-4" />
                <span>View All Tenants</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => setLocation("/maintenance"))}>
                <Wrench className="mr-2 h-4 w-4" />
                <span>View Maintenance Requests</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}