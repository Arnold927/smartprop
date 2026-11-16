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

import { MpesaStatusAlert } from "@/components/MpesaStatusAlert";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Users, Home, ChevronRight, CreditCard, Wallet, Plus, UserPlus, Link2, Layers } from "lucide-react";
import { AddOrganisationDialog, InviteOrgAdminDialog, LinkLandlordDialog } from "@/components/platform-org-dialogs";
import { BulkPropertyDialog } from "@/components/bulk-property-dialog";
import { OrgSubscriptionDialog } from "@/components/platform-subscription-dialogs";

interface OrgRow {
  id: number;
  name: string;
  slug: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  maxProperties: number | null;   // null = unlimited
  maxUnits: number | null;
  maxUsers: number | null;
  hasCustomTerms?: boolean;
  unitCount?: number;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  isActive: boolean;
  createdAt: string;
  propertyCount: number;
  userCount: number;
  revenueThisMonth: number;
  revenueTotal: number;
}

const fmtKES = (n: number) =>
  `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

/** Last 12 months as {value: "YYYY-MM", label: "July 2026"} options, newest first. */
function recentMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

export default function PlatformOrganizationsPage() {
  const guard = useRoleGuard(ROLES.PLATFORM_ADMIN_ONLY);
  if (guard.gate) return guard.gate;

  const [, navigate] = useLocation();
  const monthOptions = recentMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOrg, setInviteOrg] = useState<{ id: number; name: string } | null>(null);
  const [linkOrg, setLinkOrg] = useState<{ id: number; name: string } | null>(null);
  const [bulkOrg, setBulkOrg] = useState<{ id: number; name: string } | null>(null);
  const [subOrg, setSubOrg] = useState<{ id: number; name: string } | null>(null);

  const { data: orgs = [], isLoading, error } = useQuery<OrgRow[]>({
    queryKey: ["/api/platform/organizations", selectedMonth],
    queryFn: async () => {
      const r = await apiRequest(`/api/platform/organizations?month=${selectedMonth}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.message || `Request failed (${r.status})`);
      }
      return r.json();
    },
  });

  const totalRevenueThisMonth = orgs.reduce((sum, o) => sum + (o.revenueThisMonth ?? 0), 0);
  const totalRevenueAllTime   = orgs.reduce((sum, o) => sum + (o.revenueTotal ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
      <MpesaStatusAlert />
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="rounded-xl bg-emerald-500/10 p-2.5">
          <Building2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-lg font-semibold text-foreground">Organisations</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every organisation on the platform. Pick one to see its properties.
          </p>
        </div>
        <Button size="sm" className="gap-1.5 shrink-0 w-full sm:w-auto" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add landlord / organisation
        </Button>
      </div>
      <AddOrganisationDialog open={addOpen} onOpenChange={setAddOpen} organisations={orgs.filter(o => o.isActive).map(o => ({ id: o.id, name: o.name }))} />
      <LinkLandlordDialog org={linkOrg} onOpenChange={(o) => { if (!o) setLinkOrg(null); }} />
      <BulkPropertyDialog
        open={!!bulkOrg}
        onOpenChange={(o) => { if (!o) setBulkOrg(null); }}
        organizationId={bulkOrg ? String(bulkOrg.id) : null}
        organizationName={bulkOrg?.name}
        onCreated={(r) => { const id = bulkOrg?.id; setBulkOrg(null); if (id) navigate(`/properties/${r.property.id}?organizationId=${id}`); }}
      />
      <OrgSubscriptionDialog org={subOrg} onOpenChange={(o) => { if (!o) setSubOrg(null); }} />
      <InviteOrgAdminDialog org={inviteOrg} onOpenChange={(o) => { if (!o) setInviteOrg(null); }} />

      {!isLoading && !error && orgs.length > 0 && (
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-end">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">
                  Revenue in {monthOptions.find(m => m.value === selectedMonth)?.label} — all organisations
                </p>
                <p className="text-xl font-semibold mt-1">{fmtKES(totalRevenueThisMonth)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Revenue all-time — all organisations</p>
                <p className="text-xl font-semibold mt-1">{fmtKES(totalRevenueAllTime)}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

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
        <div className="text-center py-16 text-muted-foreground">
          <p>No organisations yet.</p>
          <Button size="sm" className="gap-1.5 mt-4" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add landlord / organisation</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map(org => (
            <Card
              key={org.id}
              className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors"
              onClick={() => navigate(`/properties?organizationId=${org.id}`)}
            >
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg bg-muted dark:bg-gray-800 p-2 shrink-0">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{org.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{org.subscriptionPlan}</Badge>
                      {org.hasCustomTerms && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-violet-700 border-violet-200" title="This organisation has limits set just for it">custom limits</Badge>}
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

                <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground pl-11 sm:pl-0">
                  <div className="flex items-center gap-1.5">
                    <Home className="h-3.5 w-3.5" />
                    <span title="Properties used / allowed">{org.propertyCount} / {org.maxProperties == null ? "∞" : org.maxProperties}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    <span title="Team members used / allowed">{org.userCount} / {org.maxUsers == null ? "∞" : org.maxUsers}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title={`Revenue in ${monthOptions.find(m => m.value === selectedMonth)?.label} / all-time`}>
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>{fmtKES(org.revenueThisMonth)} <span className="text-xs opacity-70">/ {fmtKES(org.revenueTotal)} total</span></span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    data-testid={`subscription-${org.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSubOrg({ id: org.id, name: org.name });
                    }}
                  >
                    <Layers className="h-3.5 w-3.5" /> Subscription
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInviteOrg({ id: org.id, name: org.name });
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Invite admin
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkOrg({ id: org.id, name: org.name });
                    }}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Link landlord
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    data-testid={`add-property-${org.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBulkOrg({ id: org.id, name: org.name });
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5" /> Add property
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/payment-setup?organizationId=${org.id}`);
                    }}
                  >
                    <Wallet className="h-3.5 w-3.5" /> Payment Setup
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/external-landlords?organizationId=${org.id}`);
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5" /> External Landlords
                  </Button>
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