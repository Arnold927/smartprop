/**
 * client/src/pages/platform-plans.tsx
 *
 * Platform admin only: the plan catalogue (price, limits, what customers see) and bulk changes to
 * organisations' subscriptions. One organisation's own terms are edited from the Organisations page.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Layers, Pencil, Plus, Users } from "lucide-react";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BulkSubscriptionDialog, PlanEditorDialog } from "@/components/platform-subscription-dialogs";
import { fmtKes, fmtLimit, LIMIT_KEYS, LIMIT_LABELS, usePlatformPlans, type Plan } from "@/lib/plans";

export default function PlatformPlansPage() {
  const guard = useRoleGuard(ROLES.PLATFORM_ADMIN_ONLY);
  if (guard.gate) return guard.gate;

  const { data, isLoading, error } = usePlatformPlans();
  const { data: orgs = [] } = useQuery<{ id: number; name: string; subscriptionPlan: string; isActive: boolean }[]>({
    queryKey: ["/api/platform/organizations", "list-for-plans"],
    queryFn: async () => (await apiRequest("/api/platform/organizations")).json(),
  });
  const [editing, setEditing] = useState<Plan | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const plans = data?.plans ?? [];
  const legacy = data?.legacyPlans ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="rounded-xl bg-emerald-500/10 p-2.5"><Layers className="h-5 w-5 text-emerald-600" /></div>
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-lg font-semibold text-foreground">Plans &amp; subscriptions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set what each plan costs and allows. Edit a plan to change it for everyone on it; use an organisation's own Subscription button to give just that organisation different terms.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBulkOpen(true)}><Users className="h-4 w-4" /> Change many organisations</Button>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="h-4 w-4" /> New plan</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-12">Couldn't load plans.</p>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => (
            <Card key={p.id} className={p.isActive ? "" : "opacity-70"}>
              <CardContent className="py-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="min-w-0 md:w-56">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{p.name}</p>
                    {!p.isActive && <Badge variant="outline" className="text-[10px]">Off</Badge>}
                    {p.isActive && !p.isPublic && <Badge variant="outline" className="text-[10px]">Private</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.id}</p>
                  <p className="text-sm mt-1 flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-muted-foreground" />{fmtKes(p.priceKes)} <span className="text-xs text-muted-foreground">/ month</span></p>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-3 text-center">
                  {LIMIT_KEYS.map((k) => (
                    <div key={k} className="rounded-lg bg-muted/50 py-2 px-1">
                      <p className="text-base font-semibold leading-tight">{fmtLimit(p[k])}</p>
                      <p className="text-[11px] text-muted-foreground">{LIMIT_LABELS[k].noun}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between md:justify-end gap-3 md:w-48">
                  <span className="text-xs text-muted-foreground">{p.organizationCount ?? 0} organisation{p.organizationCount === 1 ? "" : "s"}</span>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditing(p); setEditorOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {plans.length === 0 && <p className="text-center text-sm text-muted-foreground py-12">No plans yet. Create the first one.</p>}
          {legacy.length > 0 && (
            <p className="text-xs text-muted-foreground pt-2">
              {legacy.reduce((n, l) => n + l.organizationCount, 0)} organisation(s) are on a plan that is not in this list ({legacy.slice(0, 3).map((l) => `"${l.id}"`).join(", ")}{legacy.length > 3 ? ` and ${legacy.length - 3} more` : ""}) — they keep the limits they had. Move them to a plan from the Organisations page, or use Change many organisations.
            </p>
          )}
        </div>
      )}

      <PlanEditorDialog plan={editing} open={editorOpen} onOpenChange={setEditorOpen} />
      <BulkSubscriptionDialog open={bulkOpen} onOpenChange={setBulkOpen} organisations={orgs.filter((o) => o.isActive)} />
    </div>
  );
}
