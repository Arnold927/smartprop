/**
 * client/src/pages/platform-organizations.tsx
 *
 * Landing page for the platform_admin role: organisation -> properties ->
 * property details. This page is step one — a plain list of every
 * organisation on the platform. Clicking one navigates to the existing
 * properties list page (/properties?organizationId=X), which now reads
 * that context and shows just that org's properties; clicking a property
 * from there goes to the existing property-details page, same as it
 * always has for admin/manager/landlord.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Home, ChevronRight } from "lucide-react";

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  maxProperties: number;
  maxUsers: number;
  isActive: boolean;
  createdAt: string;
  propertyCount: number;
  userCount: number;
}

export default function PlatformOrganizationsPage() {
  const guard = useRoleGuard(ROLES.PLATFORM_ADMIN_ONLY);
  if (guard.gate) return guard.gate;

  const [, navigate] = useLocation();

  const { data: orgs = [], isLoading, error } = useQuery<OrgRow[]>({
    queryKey: ["/api/platform/organizations"],
    queryFn: async () => {
      const r = await apiRequest("/api/platform/organizations");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.message || `Request failed (${r.status})`);
      }
      return r.json();
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-xl bg-emerald-500/10 p-2.5">
          <Building2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Organisations</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every organisation on the platform. Pick one to see its properties.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm font-medium text-red-600">Couldn't load organisations</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
          <p className="text-xs text-muted-foreground mt-3">
            If your account was just changed to platform_admin, log out and back in — the role is read from your login token, which doesn't update until you get a fresh one.
          </p>
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No organisations yet.</div>
      ) : (
        <div className="space-y-3">
          {orgs.map(org => (
            <Card
              key={org.id}
              className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors"
              onClick={() => navigate(`/properties?organizationId=${org.id}`)}
            >
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg bg-muted dark:bg-gray-800 p-2 shrink-0">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{org.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{org.subscriptionPlan}</Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 capitalize ${
                          org.subscriptionStatus === "active" ? "text-emerald-700 border-emerald-200" :
                          org.subscriptionStatus === "trial"  ? "text-amber-700 border-amber-200"   :
                          "text-muted-foreground"
                        }`}
                      >
                        {org.subscriptionStatus}
                      </Badge>
                      {!org.isActive && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-600 border-red-200">inactive</Badge>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Home className="h-3.5 w-3.5" />
                    <span>{org.propertyCount}{org.maxProperties ? ` / ${org.maxProperties}` : ""}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    <span>{org.userCount}{org.maxUsers ? ` / ${org.maxUsers}` : ""}</span>
                  </div>
                  <ChevronRight className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}