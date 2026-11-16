/**
 * Platform-admin dialogs for plans and subscriptions:
 *   PlanEditorDialog           create / edit a plan (reaches every organisation on it)
 *   OrgSubscriptionDialog      one organisation's plan, status, dates, limits, negotiated price
 *   BulkSubscriptionDialog     change many (or all) organisations at once, with a preview
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/maintenance-flow";
import {
  LIMIT_KEYS, LIMIT_LABELS, SUBSCRIPTION_STATUSES, fmtKes, fmtLimit, limitSummary, toDateInput, usePlatformPlans,
  type LimitKey, type Plan,
} from "@/lib/plans";

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["/api/platform/plans"] });
  qc.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
  qc.invalidateQueries({ queryKey: ["/api/billing/status"] });
};

// ─────────────────────────────────────────────────────────────────────────────
// Plan editor
// ─────────────────────────────────────────────────────────────────────────────

function LimitInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number" min={0} inputMode="numeric"
        disabled={value === null}
        value={value === null ? "" : value}
        placeholder={value === null ? "Unlimited" : "0"}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Math.floor(Number(e.target.value))))}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <Checkbox checked={value === null} onCheckedChange={(c) => onChange(c ? null : 10)} /> Unlimited
      </label>
    </div>
  );
}

export function PlanEditorDialog({ plan, open, onOpenChange }: { plan: Plan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const editing = !!plan;
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [limits, setLimits] = useState<Record<LimitKey, number | null>>({ maxProperties: 5, maxUnits: null, maxUsers: 5 });
  const [features, setFeatures] = useState("");
  const [trialDays, setTrialDays] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? ""); setId(plan?.id ?? ""); setDescription(plan?.description ?? "");
    setPrice(String(plan?.priceKes ?? 0));
    setLimits({ maxProperties: plan ? plan.maxProperties : 5, maxUnits: plan ? plan.maxUnits : null, maxUsers: plan ? plan.maxUsers : 5 });
    setFeatures((plan?.features ?? []).join("\n"));
    setTrialDays(plan?.trialDays ? String(plan.trialDays) : "");
    setIsActive(plan?.isActive ?? true); setIsPublic(plan?.isPublic ?? true); setSortOrder(String(plan?.sortOrder ?? 0));
    setFlags(plan?.featureFlags ?? {});
  }, [open, plan]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...(editing ? {} : id.trim() ? { id: id.trim() } : {}),
        name: name.trim(),
        description: description.trim() || null,
        priceKes: Number(price) || 0,
        ...limits,
        features: features.split("\n").map((f) => f.trim()).filter(Boolean),
        trialDays: trialDays.trim() ? Math.max(0, Math.floor(Number(trialDays))) : null,
        featureFlags: flags,
        isActive, isPublic, sortOrder: Math.max(0, Math.floor(Number(sortOrder) || 0)),
      };
      const r = await apiRequest(editing ? `/api/platform/plans/${plan!.id}` : "/api/platform/plans", { method: editing ? "PUT" : "POST", data: body });
      return r.json();
    },
    onSuccess: (r: any) => {
      refresh(qc);
      toast({ title: editing ? "Plan saved" : "Plan created", description: editing && r?.organizationsUpdated ? `Applies to ${r.organizationsUpdated} organisation${r.organizationsUpdated === 1 ? "" : "s"} on this plan (those with their own limits keep them).` : undefined });
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Couldn't save the plan", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${plan!.name}` : "New plan"}</DialogTitle>
          <DialogDescription>
            {editing && (plan!.organizationCount ?? 0) > 0
              ? `${plan!.organizationCount} organisation${plan!.organizationCount === 1 ? " is" : "s are"} on this plan — new limits and the price reach all of them, except any you have given their own limits.`
              : "Set the price and what the plan allows. Leave a limit on Unlimited to not restrict it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Plan name</Label>
              <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Growth" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Price per month (KES)</Label>
              <Input id="plan-price" type="number" min={0} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="plan-id">Plan code <span className="text-muted-foreground font-normal">(optional — made from the name)</span></Label>
              <Input id="plan-id" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="growth-plus" maxLength={49} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="plan-desc">Short description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="plan-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>

          <div>
            <p className="text-sm font-medium mb-2">What the plan allows</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {LIMIT_KEYS.map((k) => (
                <LimitInput key={k} label={LIMIT_LABELS[k].label} value={limits[k]} onChange={(v) => setLimits((l) => ({ ...l, [k]: v }))} />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-features">What customers see <span className="text-muted-foreground font-normal">(one line each)</span></Label>
            <Textarea id="plan-features" rows={5} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={"Up to 25 properties\nM-Pesa rent collection"} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-trial">Free trial for new organisations (days)</Label>
              <Input id="plan-trial" type="number" min={0} inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="No end date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-order">Order in the list</Label>
              <Input id="plan-order" type="number" min={0} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2.5 rounded-lg border p-3">
            <p className="text-sm font-medium">Features switched on by this plan</p>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm">White-label branding</p><p className="text-xs text-muted-foreground">Own colours and logo, SmartProp branding hidden.</p></div>
              <Switch checked={!!flags.whiteLabel} onCheckedChange={(c) => setFlags((f) => ({ ...f, whiteLabel: c }))} aria-label="White-label branding" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm">Custom domain</p><p className="text-xs text-muted-foreground">Their own web address for the portal.</p></div>
              <Switch checked={!!flags.customDomain} onCheckedChange={(c) => setFlags((f) => ({ ...f, customDomain: c }))} aria-label="Custom domain" />
            </div>
          </div>

          <div className="space-y-2.5 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium">Available</p><p className="text-xs text-muted-foreground">Off = can't be given to new organisations or bought.</p></div>
              <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Available" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium">Shown on the billing page</p><p className="text-xs text-muted-foreground">Off = a private plan you assign by hand.</p></div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Shown on the billing page" />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || name.trim().length < 2}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? "Save plan" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One organisation
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "plan" | "custom" | "unlimited";
type LimitState = { mode: Mode; value: string };

interface OrgSub {
  organizationId: number; name: string; plan: string; planName: string; planInCatalogue: boolean; status: string; expired: boolean;
  trialEndsAt: string | null; currentPeriodEnd: string | null;
  limits: Record<LimitKey, number | null>; limitSources: Record<LimitKey, "override" | "plan" | "legacy">;
  planLimits: Record<LimitKey, number | null> | null;
  priceKes: number | null; planPriceKes: number | null; customPriceKes: number | null; notes: string | null;
  usage: { properties: number; units: number; users: number };
}

const USAGE_KEY: Record<LimitKey, keyof OrgSub["usage"]> = { maxProperties: "properties", maxUnits: "units", maxUsers: "users" };

export function OrgSubscriptionDialog({ org, onOpenChange }: { org: { id: number; name: string } | null; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: planData } = usePlatformPlans();
  const plans = planData?.plans ?? [];

  const { data, isLoading } = useQuery<OrgSub>({
    queryKey: ["/api/platform/organizations", org?.id, "subscription"],
    enabled: !!org,
    queryFn: async () => (await apiRequest(`/api/platform/organizations/${org!.id}/subscription`)).json(),
  });

  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [trialEnd, setTrialEnd] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [lim, setLim] = useState<Record<LimitKey, LimitState>>({ maxProperties: { mode: "plan", value: "" }, maxUnits: { mode: "plan", value: "" }, maxUsers: { mode: "plan", value: "" } });
  const [limitsTouched, setLimitsTouched] = useState(false);
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!data) return;
    setPlan(data.plan); setStatus(data.status ?? "trial");
    setTrialEnd(toDateInput(data.trialEndsAt)); setPeriodEnd(toDateInput(data.currentPeriodEnd));
    const l = {} as Record<LimitKey, LimitState>;
    for (const k of LIMIT_KEYS) {
      l[k] = data.limitSources[k] === "override"
        ? (data.limits[k] == null ? { mode: "unlimited", value: "" } : { mode: "custom", value: String(data.limits[k]) })
        : { mode: "plan", value: "" };
    }
    setLim(l); setLimitsTouched(false);
    setPrice(data.customPriceKes != null ? String(data.customPriceKes) : "");
    setNotes(data.notes ?? "");
  }, [data]);

  const chosenPlan = plans.find((p) => p.id === plan);
  const planChanged = !!data && plan !== data.plan;

  const save = useMutation({
    mutationFn: async (extra: Record<string, unknown> = {}) => {
      const body: Record<string, unknown> = {
        ...(planChanged ? { plan } : {}),
        status,
        trialEndsAt: trialEnd || null,
        currentPeriodEnd: periodEnd || null,
        customPriceKes: price.trim() === "" ? null : Number(price),
        notes: notes.trim() || null,
        ...extra,
      };
      if (limitsTouched) {
        body.limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, lim[k].mode === "custom" ? { mode: "custom", value: Math.max(0, Math.floor(Number(lim[k].value) || 0)) } : { mode: lim[k].mode }]));
      }
      return (await apiRequest(`/api/platform/organizations/${org!.id}/subscription`, { method: "PATCH", data: body })).json();
    },
    onSuccess: () => { refresh(qc); toast({ title: "Subscription saved", description: org?.name }); onOpenChange(false); },
    onError: (e) => toast({ title: "Couldn't save", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const setMode = (k: LimitKey, mode: Mode) => { setLimitsTouched(true); setLim((s) => ({ ...s, [k]: { mode, value: mode === "custom" && !s[k].value ? String(data?.limits[k] ?? 10) : s[k].value } })); };
  const planValue = (k: LimitKey) => (planChanged ? chosenPlan?.[k] : data?.planLimits?.[k]);

  return (
    <Dialog open={!!org} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subscription — {org?.name}</DialogTitle>
          <DialogDescription>Changes here apply to this organisation only.</DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
                  <SelectContent>
                    {!data.planInCatalogue && <SelectItem value={data.plan}>{data.plan} (old plan)</SelectItem>}
                    {plans.filter((p) => p.isActive || p.id === data.plan).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (off)"} — {fmtKes(p.priceKes)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {planChanged && !limitsTouched && <p className="text-xs text-amber-700">Moving plan: this organisation will follow the new plan's limits.</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBSCRIPTION_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
                {data.expired && <p className="text-xs text-red-600">The {data.status === "trial" ? "trial" : "paid period"} has ended — adding properties, units and team members is blocked.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-trial">Trial ends</Label>
                <div className="flex gap-2">
                  <Input id="sub-trial" type="date" value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => save.mutate({ extendTrialDays: 14 })} disabled={save.isPending}>+14 days</Button>
                </div>
                <p className="text-xs text-muted-foreground">Empty = no end date.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-period">Paid period ends</Label>
                <Input id="sub-period" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                <p className="text-xs text-muted-foreground">Empty = no end date.</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Limits</p>
              <div className="space-y-2">
                {LIMIT_KEYS.map((k) => {
                  const used = data.usage[USAGE_KEY[k]];
                  const effective = lim[k].mode === "plan" ? planValue(k) : lim[k].mode === "unlimited" ? null : Number(lim[k].value) || 0;
                  const over = effective != null && used > effective;
                  return (
                    <div key={k} className="grid grid-cols-[1fr_auto] sm:grid-cols-[7rem_1fr_6rem] items-center gap-2 rounded-lg border p-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{LIMIT_LABELS[k].label}</p>
                        <p className={`text-xs ${over ? "text-red-600" : "text-muted-foreground"}`}>{used.toLocaleString()} used{over ? " — over the limit" : ""}</p>
                      </div>
                      <Select value={lim[k].mode} onValueChange={(v) => setMode(k, v as Mode)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plan">{data.planInCatalogue ? `Follow plan (${fmtLimit(planValue(k) as number | null | undefined)})` : `Keep as it is (${fmtLimit(data.limits[k])})`}</SelectItem>
                          <SelectItem value="custom">Custom number</SelectItem>
                          <SelectItem value="unlimited">Unlimited</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="col-span-2 sm:col-span-1 h-9" type="number" min={0} inputMode="numeric" aria-label={`${LIMIT_LABELS[k].label} limit`}
                        disabled={lim[k].mode !== "custom"} value={lim[k].mode === "custom" ? lim[k].value : ""}
                        onChange={(e) => { setLimitsTouched(true); setLim((s) => ({ ...s, [k]: { ...s[k], value: e.target.value } })); }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sub-price">Negotiated price (KES / month)</Label>
                <Input id="sub-price" type="number" min={0} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`Plan price: ${fmtKes(chosenPlan?.priceKes ?? data.planPriceKes)}`} />
                <p className="text-xs text-muted-foreground">Empty = the plan's price. Used when they pay online.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-notes">Private note</Label>
                <Textarea id="sub-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. agreed 20% off for 12 months" maxLength={1000} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate({})} disabled={save.isPending || isLoading || !data}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Many organisations
// ─────────────────────────────────────────────────────────────────────────────

type BulkMode = "keep" | Mode;
const KEEP = "__keep__";

export function BulkSubscriptionDialog({
  open, onOpenChange, organisations,
}: { open: boolean; onOpenChange: (o: boolean) => void; organisations: { id: number; name: string; subscriptionPlan: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: planData } = usePlatformPlans();
  const plans = planData?.plans ?? [];

  const [scopeType, setScopeType] = useState<"all" | "plan" | "organizations">("all");
  const [scopePlan, setScopePlan] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [plan, setPlan] = useState(KEEP);
  const [status, setStatus] = useState(KEEP);
  const [extend, setExtend] = useState("");
  const [lim, setLim] = useState<Record<LimitKey, { mode: BulkMode; value: string }>>({ maxProperties: { mode: "keep", value: "" }, maxUnits: { mode: "keep", value: "" }, maxUsers: { mode: "keep", value: "" } });
  const [preview, setPreview] = useState<{ matched: number } | null>(null);

  useEffect(() => { if (open) { setScopeType("all"); setScopePlan(""); setPicked([]); setPlan(KEEP); setStatus(KEEP); setExtend(""); setPreview(null); setLim({ maxProperties: { mode: "keep", value: "" }, maxUnits: { mode: "keep", value: "" }, maxUsers: { mode: "keep", value: "" } }); } }, [open]);
  useEffect(() => { setPreview(null); }, [scopeType, scopePlan, picked, plan, status, extend, lim]);

  const body = useMemo(() => {
    const apply: Record<string, unknown> = {};
    if (plan !== KEEP) apply.plan = plan;
    if (status !== KEEP) apply.status = status;
    if (extend.trim() && Number(extend) > 0) apply.extendTrialDays = Math.floor(Number(extend));
    const limits: Record<string, unknown> = {};
    for (const k of LIMIT_KEYS) {
      const s = lim[k];
      if (s.mode === "keep") continue;
      limits[k] = s.mode === "custom" ? { mode: "custom", value: Math.max(0, Math.floor(Number(s.value) || 0)) } : { mode: s.mode };
    }
    if (Object.keys(limits).length) apply.limits = limits;
    const scope = scopeType === "all" ? { type: "all" } : scopeType === "plan" ? { type: "plan", planId: scopePlan } : { type: "organizations", ids: picked };
    return { scope, apply };
  }, [scopeType, scopePlan, picked, plan, status, extend, lim]);

  const scopeReady = scopeType === "all" || (scopeType === "plan" && !!scopePlan) || (scopeType === "organizations" && picked.length > 0);
  const hasChange = Object.keys(body.apply).length > 0;

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => (await apiRequest("/api/platform/subscriptions/bulk", { method: "POST", data: { ...body, dryRun } })).json(),
    onSuccess: (r: any, dryRun) => {
      if (dryRun) { setPreview({ matched: r.matched }); return; }
      refresh(qc);
      toast({ title: "Organisations updated", description: `${r.updated} of ${r.matched} changed.` });
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Couldn't update", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change many organisations</DialogTitle>
          <DialogDescription>Pick who, then only what you want to change — everything left on "Don't change" stays as it is.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Who</Label>
            <Select value={scopeType} onValueChange={(v) => setScopeType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every active organisation</SelectItem>
                <SelectItem value="plan">Everyone on one plan</SelectItem>
                <SelectItem value="organizations">Organisations I choose</SelectItem>
              </SelectContent>
            </Select>
            {scopeType === "plan" && (
              <Select value={scopePlan} onValueChange={setScopePlan}>
                <SelectTrigger><SelectValue placeholder="Choose the plan" /></SelectTrigger>
                <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.organizationCount != null ? ` (${p.organizationCount})` : ""}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {scopeType === "organizations" && (
              <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
                {organisations.map((o) => (
                  <label key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                    <Checkbox checked={picked.includes(o.id)} onCheckedChange={(c) => setPicked((p) => (c ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
                    <span className="flex-1 min-w-0 truncate">{o.name}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{o.subscriptionPlan}</Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Move to plan</Label>
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Don't change</SelectItem>
                  {plans.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Set status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Don't change</SelectItem>
                  {SUBSCRIPTION_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bulk-extend">Extend trial by (days)</Label>
              <Input id="bulk-extend" type="number" min={0} inputMode="numeric" value={extend} onChange={(e) => setExtend(e.target.value)} placeholder="Don't change" />
              <p className="text-xs text-muted-foreground">Puts each organisation on trial until that many days from today (or from its current trial end, if later).</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Limits</p>
            <div className="space-y-2">
              {LIMIT_KEYS.map((k) => (
                <div key={k} className="grid grid-cols-[1fr] sm:grid-cols-[7rem_1fr_6rem] items-center gap-2 rounded-lg border p-2.5">
                  <p className="text-sm font-medium">{LIMIT_LABELS[k].label}</p>
                  <Select value={lim[k].mode} onValueChange={(v) => setLim((s) => ({ ...s, [k]: { mode: v as BulkMode, value: s[k].value || "10" } }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">Don't change</SelectItem>
                      <SelectItem value="plan">Back to the plan's limit</SelectItem>
                      <SelectItem value="custom">Custom number</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-9" type="number" min={0} inputMode="numeric" aria-label={`${LIMIT_LABELS[k].label} limit for all chosen`} disabled={lim[k].mode !== "custom"} value={lim[k].mode === "custom" ? lim[k].value : ""} onChange={(e) => setLim((s) => ({ ...s, [k]: { ...s[k], value: e.target.value } }))} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">To change what a whole plan allows, edit the plan instead — that reaches everyone on it without giving each organisation its own limit.</p>
          </div>

          {preview && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm">
              This will change <strong>{preview.matched}</strong> organisation{preview.matched === 1 ? "" : "s"}.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview ? (
            <Button onClick={() => run.mutate(true)} disabled={run.isPending || !scopeReady || !hasChange}>
              {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Check who is affected
            </Button>
          ) : (
            <Button onClick={() => run.mutate(false)} disabled={run.isPending || preview.matched === 0}>
              {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Apply to {preview.matched}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { limitSummary };
