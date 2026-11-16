/**
 * client/src/pages/public/apply.tsx — /apply/:organizationId
 *
 * The online tenancy application. No account needed: the link is shared by the property manager ("Copy application link" on
 * the Letting Pipeline page). Submitting creates a prospect at the "Applied" stage and pings the team.
 */
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle2, Building2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Options {
  organization: { id: number; name: string };
  units: Array<{ id: number; unitNumber: string; propertyId: number; propertyName: string; unitType: string | null; bedrooms: number | null; monthlyRent: string | null }>;
}

const kes = (n: any) => (n ? `KES ${Math.round(Number(n)).toLocaleString("en-KE")}` : "");
const NO_UNIT = "none";

async function readError(r: Response, fallback: string) {
  try { const j = await r.json(); return j?.message ? String(j.message) : fallback; } catch { return fallback; }
}

export default function ApplyPage() {
  const [, params] = useRoute("/apply/:organizationId");
  const orgId = params?.organizationId ?? "";
  const [f, setF] = useState<Record<string, any>>({ nationality: "Kenyan", unit: NO_UNIT, website: "" });
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const [done, setDone] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<Options>({
    queryKey: ["/api/prospects/apply/options", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/prospects/apply/options/${encodeURIComponent(orgId)}`);
      if (!r.ok) throw new Error(await readError(r, "This application form is not available."));
      return r.json();
    },
    enabled: !!orgId,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        organizationId: Number(orgId), firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, nationalId: f.nationalId,
        nationality: f.nationality, employer: f.employer, jobTitle: f.jobTitle, employmentType: f.employmentType, monthlyIncome: f.monthlyIncome,
        budgetMax: f.budgetMax, preferredMoveIn: f.preferredMoveIn,
        reference1Name: f.reference1Name, reference1Phone: f.reference1Phone, reference1Relation: f.reference1Relation,
        reference2Name: f.reference2Name, reference2Phone: f.reference2Phone, reference2Relation: f.reference2Relation,
        website: f.website,
      };
      if (f.unit && f.unit !== NO_UNIT) body.unitId = Number(f.unit);
      const r = await fetch("/api/prospects/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== undefined))) });
      if (!r.ok) throw new Error(await readError(r, "We couldn't submit your application. Please try again."));
      return r.json();
    },
    onSuccess: (r: any) => setDone(r?.message ?? "Application received. We will be in touch within 2 business days."),
  });

  const ready = f.firstName?.trim() && f.lastName?.trim() && f.email?.trim() && f.phone?.trim() && f.nationalId?.trim();
  const Field = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
    <div className={className}><Label className="text-xs text-muted-foreground font-medium">{label}</Label><div className="mt-1">{children}</div></div>
  );

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white"><Building2 className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Tenancy application</h1>
            {data && <p className="text-sm text-muted-foreground">{data.organization.name}</p>}
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

        {isError && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">This application form is not available.</p>
            <p className="text-xs text-muted-foreground mt-1">Check the link you were given, or contact the property manager.</p>
          </div>
        )}

        {done && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-600" />
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">Thank you, {f.firstName}!</p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">{done}</p>
          </div>
        )}

        {data && !done && (
          <form className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-6" onSubmit={e => { e.preventDefault(); if (ready && !submit.isPending) submit.mutate(); }}>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">About you</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First name *"><Input className="h-9" value={f.firstName ?? ""} onChange={e => set("firstName", e.target.value)} autoComplete="given-name" /></Field>
                <Field label="Last name *"><Input className="h-9" value={f.lastName ?? ""} onChange={e => set("lastName", e.target.value)} autoComplete="family-name" /></Field>
                <Field label="Email *"><Input className="h-9" type="email" value={f.email ?? ""} onChange={e => set("email", e.target.value)} autoComplete="email" /></Field>
                <Field label="Phone *"><Input className="h-9" type="tel" value={f.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+254 700 000 000" autoComplete="tel" /></Field>
                <Field label="National ID / passport no. *"><Input className="h-9" value={f.nationalId ?? ""} onChange={e => set("nationalId", e.target.value)} /></Field>
                <Field label="Nationality"><Input className="h-9" value={f.nationality ?? ""} onChange={e => set("nationality", e.target.value)} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">The home you want</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Unit" className="sm:col-span-2">
                  <Select value={f.unit} onValueChange={v => set("unit", v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_UNIT}>Not decided — suggest something</SelectItem>
                      {data.units.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.propertyName} · Unit {u.unitNumber}{u.bedrooms ? ` · ${u.bedrooms} bed` : ""}{u.monthlyRent ? ` · ${kes(u.monthlyRent)}/mo` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Preferred move-in date"><Input className="h-9" type="date" value={f.preferredMoveIn ?? ""} onChange={e => set("preferredMoveIn", e.target.value)} /></Field>
                <Field label="Monthly budget (KES)"><Input className="h-9" type="number" min="0" value={f.budgetMax ?? ""} onChange={e => set("budgetMax", e.target.value)} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Work and income</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Employer"><Input className="h-9" value={f.employer ?? ""} onChange={e => set("employer", e.target.value)} /></Field>
                <Field label="Job title"><Input className="h-9" value={f.jobTitle ?? ""} onChange={e => set("jobTitle", e.target.value)} /></Field>
                <Field label="Employment type">
                  <Select value={f.employmentType ?? ""} onValueChange={v => set("employmentType", v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employed">Employed</SelectItem>
                      <SelectItem value="self_employed">Self-employed</SelectItem>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="retired">Retired</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Monthly income (KES)"><Input className="h-9" type="number" min="0" value={f.monthlyIncome ?? ""} onChange={e => set("monthlyIncome", e.target.value)} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">References <span className="text-muted-foreground font-normal">(a previous landlord or employer is ideal)</span></h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Reference 1 — name"><Input className="h-9" value={f.reference1Name ?? ""} onChange={e => set("reference1Name", e.target.value)} /></Field>
                <Field label="Phone"><Input className="h-9" type="tel" value={f.reference1Phone ?? ""} onChange={e => set("reference1Phone", e.target.value)} /></Field>
                <Field label="Relationship"><Input className="h-9" value={f.reference1Relation ?? ""} onChange={e => set("reference1Relation", e.target.value)} placeholder="Landlord, employer…" /></Field>
                <Field label="Reference 2 — name"><Input className="h-9" value={f.reference2Name ?? ""} onChange={e => set("reference2Name", e.target.value)} /></Field>
                <Field label="Phone"><Input className="h-9" type="tel" value={f.reference2Phone ?? ""} onChange={e => set("reference2Phone", e.target.value)} /></Field>
                <Field label="Relationship"><Input className="h-9" value={f.reference2Relation ?? ""} onChange={e => set("reference2Relation", e.target.value)} /></Field>
              </div>
            </section>

            {submit.isError && (
              <div className="flex gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{(submit.error as Error).message}
              </div>
            )}
            {/* honeypot: invisible to people, irresistible to form-filling bots */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, overflow: "hidden" }}>
              <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set("website", e.target.value)} /></label>
            </div>
            <Button type="submit" disabled={!ready || submit.isPending} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white">
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit application
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">Your details are shared only with {data.organization.name} and used to assess your application.</p>
          </form>
        )}
      </div>
    </div>
  );
}
