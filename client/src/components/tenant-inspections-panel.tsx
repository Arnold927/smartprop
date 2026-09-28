/**
 * TenantInspectionsPanel — shown in the tenant portal's Documents tab.
 *
 * Lists the condition reports (move-in, move-out, periodic…) that management has signed off on
 * the tenant's own tenancy, lets the tenant read each one, and countersign it. Renders nothing
 * at all when there are none, so tenants without inspections see no change.
 *
 * Backed by /api/tenant-inspections — the server only returns inspections linked to this
 * tenant's own record, and only ones the manager has already signed.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SectionCard, SPBadge } from "@/components/ui/sp-ui";
import { ClipboardList, CheckCircle2, Loader2, Zap, Droplets } from "lucide-react";

const fmt = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";

const errMsg = (e: any): string => {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
};

const CONDITION_COLORS: Record<string, string> = {
  excellent: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  good:      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800",
  fair:      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
  poor:      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800",
};

function Condition({ c }: { c?: string | null }) {
  if (!c) return null;
  return <span className={cn("inline-flex px-2 py-0.5 rounded-full border text-xs font-medium capitalize", CONDITION_COLORS[c] ?? "bg-muted text-muted-foreground border-border")}>{c}</span>;
}

export default function TenantInspectionsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openId, setOpenId]   = useState<number | null>(null);
  const [name, setName]       = useState("");
  const [agreed, setAgreed]   = useState(false);

  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/tenant-inspections"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/tenant-inspections")).json()),
  });

  const sign = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest(`/api/tenant-inspections/${id}/sign`, { method: "POST", data: { signatoryName: name.trim() } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tenant-inspections"] });
      toast({ title: "Inspection signed", description: "Thank you — your signature has been recorded." });
      close();
    },
    onError: (e: any) => toast({ title: "Couldn't sign", description: errMsg(e), variant: "destructive" }),
  });

  const close = () => { setOpenId(null); setName(""); setAgreed(false); };
  const open  = (id: number) => { setOpenId(id); setName(`${(user as any)?.firstName ?? ""} ${(user as any)?.lastName ?? ""}`.trim()); setAgreed(false); };

  if (!data.length) return null;

  const current = data.find(i => i.id === openId) ?? null;
  const needsSignature = (i: any) => !i.tenantSignedAt;
  const waiting = data.filter(needsSignature).length;

  return (
    <>
      <SectionCard
        title="Inspection reports"
        subtitle={waiting > 0 ? `${waiting} waiting for your signature` : "All of your inspection reports are signed"}
      >
        <div className="divide-y divide-border">
          {data.map(i => (
            <div key={i.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0"><ClipboardList className="h-4 w-4 text-muted-foreground" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium capitalize">{i.inspectionType?.replace(/_/g, " ")} inspection · {i.inspectionNumber}</p>
                <p className="text-xs text-muted-foreground">{i.propertyName} · Unit {i.unitNumber ?? "—"} · {fmt(i.conductedDate)}</p>
              </div>
              <SPBadge status={i.status} />
              <Button size="sm" variant={needsSignature(i) ? "default" : "outline"} onClick={() => open(i.id)}>
                {needsSignature(i) ? "Review & sign" : "View"}
              </Button>
            </div>
          ))}
        </div>
      </SectionCard>

      <Dialog open={!!current} onOpenChange={o => { if (!o) close(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle className="capitalize">{current.inspectionType?.replace(/_/g, " ")} inspection</DialogTitle>
                <DialogDescription>{current.inspectionNumber} · {current.propertyName} · Unit {current.unitNumber ?? "—"} · {fmt(current.conductedDate)}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {current.overallCondition && (
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Overall condition</span><Condition c={current.overallCondition} /></div>
                )}
                {(current.electricityReading || current.waterReading) && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {current.electricityReading && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{Number(current.electricityReading)} kWh</span>}
                    {current.waterReading && <span className="flex items-center gap-1"><Droplets className="h-3 w-3" />{Number(current.waterReading)} m³</span>}
                  </div>
                )}

                <div className="space-y-2">
                  {(Array.isArray(current.rooms) ? current.rooms : []).map((r: any) => (
                    <div key={r.room} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-3"><span className="font-medium text-sm flex-1">{r.room}</span><Condition c={r.condition} /></div>
                      {r.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.notes}</p>}
                      {r.photoUrls?.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {r.photoUrls.map((u: string) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Room photo" loading="lazy" className="h-16 w-16 rounded-md object-cover border border-border" /></a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {current.notes && (
                  <div><p className="text-xs text-muted-foreground mb-1">Inspector notes</p><p className="text-sm whitespace-pre-wrap">{current.notes}</p></div>
                )}

                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  Signed by {current.managerSignatureName} (management) on {fmt(current.managerSignedAt)}
                </div>

                {current.tenantSignedAt ? (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 text-sm">
                    <p className="font-medium">You signed this report</p>
                    <p className="text-xs text-muted-foreground">{current.tenantSignatureName} · {fmt(current.tenantSignedAt)}</p>
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-border pt-3">
                    <div>
                      <Label className="text-xs">Type your full name to sign</Label>
                      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
                    </div>
                    <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} className="mt-0.5" />
                      I have read this report and confirm it accurately records the condition of the unit at the time of the inspection.
                    </label>
                    <Button className="w-full" disabled={!agreed || name.trim().length < 3 || sign.isPending} onClick={() => sign.mutate(current.id)}>
                      {sign.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Sign report
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}