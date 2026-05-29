/**
 * client/src/components/rrt-notice-generator.tsx
 *
 * Rent Restriction Tribunal (RRT) Notice Generator
 *
 * Two notice types:
 *  1. Rent Increase Notice — issued under s.9 Rent Restriction Act Cap 296
 *  2. Notice to Vacate (Eviction) — issued under s.12 Rent Restriction Act Cap 296
 *
 * The component calls the server to build a legally-worded HTML notice,
 * then opens it in a new window for print-to-PDF, exactly like the lease
 * agreement generator.
 *
 * Usage:
 *   import RRTNoticeGenerator from "@/components/rrt-notice-generator";
 *   <RRTNoticeGenerator lease={lease} />
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, addDays } from "date-fns";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, AlertTriangle, Download, Scale, FileText, Info,
} from "lucide-react";
import { openPrintWindow } from "@/lib/document-theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaseSummary {
  id: number;
  leaseNumber: string;
  tenantName: string;
  unitNumber: string;
  propertyName: string;
  propertyAddress?: string;
  monthlyRent: string;
  currency: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVICTION_GROUNDS = [
  { value: "non_payment",               label: "Non-Payment of Rent" },
  { value: "breach_of_agreement",       label: "Breach of Tenancy Agreement" },
  { value: "owner_occupation",          label: "Owner / Bona Fide Purchaser Occupation" },
  { value: "redevelopment",             label: "Redevelopment / Renovation" },
  { value: "nuisance",                  label: "Nuisance to Adjoining Occupiers" },
  { value: "illegal_use",               label: "Illegal or Immoral Use of Premises" },
  { value: "subletting_without_consent", label: "Subletting Without Consent" },
];

function minDateStr(days: number): string {
  return format(addDays(new Date(), days), "yyyy-MM-dd");
}

// openInPrintWindow now delegates to the shared openPrintWindow from document-theme.
// The server returns a full HTML body string (inner content only, no <html>/<head> wrapper).
function openInPrintWindow(bodyHtml: string, title = "SmartProp Notice") {
  openPrintWindow(bodyHtml, title);
}

// ── Sub-component: Rent Increase tab ─────────────────────────────────────────

function RentIncreaseForm({ lease }: { lease: LeaseSummary }) {
  const { toast } = useToast();
  const currentRent = Number(lease.monthlyRent);

  const [form, setForm] = useState({
    newRent: "",
    effectiveDate: minDateStr(30),
    noticePeriodDays: "30",
    reason: "",
  });
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }));

  const increase = form.newRent ? Number(form.newRent) - currentRent : 0;
  const pct = currentRent > 0 && increase > 0 ? ((increase / currentRent) * 100).toFixed(1) : null;

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/compliance/rrt/rent-increase", {
        method: "POST",
        data: {
          leaseId: lease.id,
          newRent: Number(form.newRent),
          effectiveDate: form.effectiveDate,
          noticePeriodDays: Number(form.noticePeriodDays),
          reason: form.reason,
        },
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json() as Promise<{ noticeNumber: string; noticeHtml: string }>;
    },
    onSuccess: (data) => {
      openInPrintWindow(data.noticeHtml);
      toast({ title: `Notice ${data.noticeNumber} generated`, description: "Print dialog opened." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canGenerate = !!form.newRent && Number(form.newRent) > currentRent && !!form.effectiveDate;

  return (
    <div className="space-y-5">
      {/* Compliance info */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4 flex gap-3">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold">RRT Compliance — Rent Restriction Act, Cap 296</p>
          <p>
            Landlords must give <strong>at least 30 days' written notice</strong> before any rent increase
            takes effect. The tenant has <strong>30 days</strong> from receipt to apply to the Rent
            Restriction Tribunal to contest the increase. Without a valid written notice, any increase
            is unenforceable.
          </p>
        </div>
      </div>

      {/* Current rent info */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Current Rent</p>
          <p className="text-sm font-semibold">{lease.currency} {currentRent.toLocaleString("en-KE")}</p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">New Rent</p>
          <p className="text-sm font-semibold">
            {form.newRent
              ? `${lease.currency} ${Number(form.newRent).toLocaleString("en-KE")}`
              : <span className="text-muted-foreground">—</span>}
          </p>
        </div>
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Increase</p>
          <p className="text-sm font-semibold">
            {pct ? (
              <span className="text-amber-700">+{pct}%</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">New Monthly Rent ({lease.currency}) *</Label>
          <Input
            type="number"
            min={currentRent + 1}
            placeholder={`> ${currentRent}`}
            value={form.newRent}
            onChange={e => set({ newRent: e.target.value })}
          />
          {form.newRent && Number(form.newRent) <= currentRent && (
            <p className="text-[11px] text-destructive">New rent must be higher than current rent</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notice Period (days)</Label>
          <Select value={form.noticePeriodDays} onValueChange={v => set({ noticePeriodDays: v, effectiveDate: minDateStr(Number(v)) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 days (minimum)</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">
            Effective Date * &nbsp;
            <span className="font-normal text-muted-foreground">
              (earliest: {format(addDays(new Date(), Number(form.noticePeriodDays)), "d MMM yyyy")})
            </span>
          </Label>
          <Input
            type="date"
            min={minDateStr(Number(form.noticePeriodDays))}
            value={form.effectiveDate}
            onChange={e => set({ effectiveDate: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Reason for Increase &nbsp;
          <span className="font-normal text-muted-foreground">(optional but strengthens your position at the Tribunal)</span>
        </Label>
        <Textarea
          rows={3}
          placeholder="e.g. Annual rent review per lease escalation clause. Market rates in the area have increased. Increased rates and service charges."
          value={form.reason}
          onChange={e => set({ reason: e.target.value })}
        />
      </div>

      <Button
        className="w-full h-11 font-semibold"
        style={{ background: canGenerate ? "#b45309" : undefined }}
        disabled={!canGenerate || mut.isPending}
        onClick={() => mut.mutate()}
      >
        <TrendingUp className="w-4 h-4 mr-2" />
        {mut.isPending ? "Generating…" : "Generate Rent Increase Notice (PDF)"}
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        Opens print dialog — save as PDF. Serve a copy to the tenant and retain a signed duplicate.
      </p>
    </div>
  );
}

// ── Sub-component: Notice to Vacate tab ───────────────────────────────────────

function EvictionNoticeForm({ lease }: { lease: LeaseSummary }) {
  const { toast } = useToast();

  const [form, setForm] = useState({
    groundCode: "",
    vacateDate: minDateStr(30),
    reason: "",
  });
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }));

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/compliance/rrt/eviction-notice", {
        method: "POST",
        data: {
          leaseId: lease.id,
          groundCode: form.groundCode,
          vacateDate: form.vacateDate,
          reason: form.reason,
        },
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json() as Promise<{ noticeNumber: string; noticeHtml: string }>;
    },
    onSuccess: (data) => {
      openInPrintWindow(data.noticeHtml);
      toast({ title: `Notice ${data.noticeNumber} generated`, description: "Print dialog opened." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canGenerate = !!form.groundCode && !!form.vacateDate;

  return (
    <div className="space-y-5">
      {/* Compliance warning */}
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-4 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
        <div className="text-xs text-red-800 dark:text-red-200 space-y-1">
          <p className="font-semibold">Important — Eviction Procedure (Rent Restriction Act, Cap 296)</p>
          <p>
            A valid written notice is a <strong>mandatory first step</strong> before any court or tribunal
            proceedings. You <strong>cannot forcibly evict</strong> a tenant — doing so (changing locks,
            removing property, cutting utilities) is a criminal offence under the <em>Trespass Act, Cap 294</em>.
            Minimum notice is <strong>30 days</strong> for most grounds.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Statutory Ground for Possession *</Label>
        <Select value={form.groundCode} onValueChange={v => set({ groundCode: v })}>
          <SelectTrigger><SelectValue placeholder="Select a ground…" /></SelectTrigger>
          <SelectContent>
            {EVICTION_GROUNDS.map(g => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Date to Vacate By * &nbsp;
          <span className="font-normal text-muted-foreground">
            (earliest: {format(addDays(new Date(), 30), "d MMM yyyy")})
          </span>
        </Label>
        <Input
          type="date"
          min={minDateStr(30)}
          value={form.vacateDate}
          onChange={e => set({ vacateDate: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Particulars / Supporting Details
          <span className="font-normal text-muted-foreground ml-1">(describe the specific breach or situation)</span>
        </Label>
        <Textarea
          rows={4}
          placeholder={
            form.groundCode === "non_payment"
              ? "e.g. Rent has been unpaid since 1st March 2025. Total arrears as at notice date: KES 45,000 (3 months). Demand letters sent on 10 Mar and 15 Apr received no response."
              : form.groundCode === "owner_occupation"
              ? "e.g. The landlord requires the property for occupation as their principal residence. Statutory declaration to this effect is available."
              : "Describe the specific facts that support this ground for possession…"
          }
          value={form.reason}
          onChange={e => set({ reason: e.target.value })}
        />
      </div>

      {/* What happens next */}
      {canGenerate && (
        <div className="rounded-lg border border-muted bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Next steps after serving this notice</p>
          <ol className="list-decimal list-inside space-y-0.5 pl-0.5">
            <li>Serve the notice personally or by registered post. Retain proof of service.</li>
            <li>If the tenant vacates by {format(new Date(form.vacateDate), "d MMM yyyy")}, conduct a move-out inspection.</li>
            <li>If the tenant does not vacate, file for a possession order at the Rent Restriction Tribunal or magistrate's court — present this notice as evidence of proper service.</li>
          </ol>
        </div>
      )}

      <Button
        className="w-full h-11 font-semibold"
        style={{ background: canGenerate ? "#dc2626" : undefined }}
        disabled={!canGenerate || mut.isPending}
        onClick={() => mut.mutate()}
      >
        <FileText className="w-4 h-4 mr-2" />
        {mut.isPending ? "Generating…" : "Generate Notice to Vacate (PDF)"}
      </Button>
      <p className="text-xs text-center text-muted-foreground">
        Opens print dialog — save as PDF. Serve on the tenant and retain a signed acknowledgement copy.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RRTNoticeGenerator({ lease }: { lease: LeaseSummary }) {
  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-600" />
          Rent Restriction Tribunal (RRT) Notices
          <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 ml-1">Kenya</Badge>
        </CardTitle>
        <CardDescription>
          Generate RRT-compliant notice documents for {lease.tenantName} — Unit {lease.unitNumber},{" "}
          {lease.propertyName}. Both notice types are issued under the <em>Rent Restriction Act, Cap 296</em>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="rent-increase">
          <TabsList className="w-full mb-5">
            <TabsTrigger value="rent-increase" className="flex-1 text-xs gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              Rent Increase Notice
            </TabsTrigger>
            <TabsTrigger value="eviction" className="flex-1 text-xs gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Notice to Vacate
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rent-increase" className="mt-0">
            <RentIncreaseForm lease={lease} />
          </TabsContent>

          <TabsContent value="eviction" className="mt-0">
            <EvictionNoticeForm lease={lease} />
          </TabsContent>
        </Tabs>

        <Separator className="my-5" />

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>Governing legislation:</strong> Rent Restriction Act, Cap 296 · Landlord and Tenant
          (Shops, Hotels &amp; Catering Establishments) Act, Cap 301 · Distress for Rent Act, Cap 293 ·
          Trespass Act, Cap 294 — Laws of Kenya.
          <br />
          <strong>Note:</strong> These notices cover both RRT-controlled premises and non-controlled
          residential premises where the same format is adopted as industry best practice.
          For complex disputes, consult a qualified advocate.
        </p>
      </CardContent>
    </Card>
  );
}