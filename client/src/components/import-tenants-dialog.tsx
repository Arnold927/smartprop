/**
 * Import tenants from a spreadsheet (paste from Excel / Google Sheets, or upload a .csv).
 * Always checks first (a dry run on the server) and shows what would happen — who would be added and
 * which rows are skipped and why — before anything is saved.
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/maintenance-flow";
import { splitCsvLine } from "@/lib/unit-layout";

export const TENANT_IMPORT_TEMPLATE =
  "first_name,last_name,email,phone,unit_number,monthly_rent,lease_start_date,lease_end_date,security_deposit\n" +
  "Jane,Mwangi,jane@example.com,0712345678,A101,85000,2026-01-01,2026-12-31,170000\n";
const MAX_ROWS = 500;
const NONE = "__none__";

/** Spreadsheet text → one object per row, keyed by the header names (the server understands the names). */
export function parseTenantRows(text: string): { rows: Record<string, string>[]; problem?: string } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: [], problem: "Add a header row and at least one tenant." };
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const head = splitCsvLine(lines[0], sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!head.includes("email")) return { rows: [], problem: "The first row must name the columns, including email (first_name, last_name, email, …)." };
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, sep);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? "").trim()]).filter(([h]) => h));
  });
  if (rows.length > MAX_ROWS) return { rows: rows.slice(0, MAX_ROWS), problem: `Only the first ${MAX_ROWS} rows can be imported at once — split the file.` };
  return { rows };
}

type Check = { wouldImport: number; skipped: number; errors: string[] };

export function ImportTenantsDialog({
  open, onOpenChange, properties,
}: { open: boolean; onOpenChange: (o: boolean) => void; properties: { id: number; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [propertyId, setPropertyId] = useState(NONE);
  const [sendInvites, setSendInvites] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const parsed = parseTenantRows(text);

  const reset = () => { setText(""); setPropertyId(NONE); setSendInvites(false); setCheck(null); };
  const body = (dryRun: boolean) => ({
    tenants: parsed.rows,
    ...(propertyId !== NONE ? { propertyId: Number(propertyId) } : {}),
    dryRun, sendInvites: !dryRun && sendInvites,
  });

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => (await apiRequest("/api/import/bulk", { method: "POST", data: body(dryRun) })).json(),
    onSuccess: (r: any, dryRun) => {
      if (dryRun) { setCheck({ wouldImport: r.wouldImport, skipped: r.skipped, errors: r.errors ?? [] }); return; }
      qc.invalidateQueries({ queryKey: ["/api/tenants"] });
      qc.invalidateQueries({ queryKey: ["/api/units"] });
      toast({
        title: `${r.imported} tenant${r.imported === 1 ? "" : "s"} imported`,
        description: [r.skipped ? `${r.skipped} skipped` : "", sendInvites ? `${r.invitesSent ?? 0} invite${r.invitesSent === 1 ? "" : "s"} emailed` : ""].filter(Boolean).join(" · ") || undefined,
      });
      reset(); onOpenChange(false);
    },
    onError: (e) => toast({ title: "Import failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const onFile = async (f?: File | null) => { if (!f) return; setText(await f.text()); setCheck(null); };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TENANT_IMPORT_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "tenants-template.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import tenants</DialogTitle>
          <DialogDescription>
            Paste rows from a spreadsheet or upload a .csv. We check everything first and show you what would happen before saving anything.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Property <span className="text-muted-foreground font-normal">(needed to put tenants on units)</span></Label>
            <Select value={propertyId} onValueChange={(v) => { setPropertyId(v); setCheck(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No unit — just add the tenants</SelectItem>
                {properties.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">With a property chosen, each row's <code>unit_number</code> is matched to a vacant unit in it.</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label htmlFor="import-tenants-text">Rows</Label>
              <div className="flex gap-2">
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="tenants-file" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" /> Upload .csv</Button>
                <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}><Download className="mr-1 h-3.5 w-3.5" /> Template</Button>
              </div>
            </div>
            <Textarea
              id="import-tenants-text" rows={7} className="font-mono text-xs" value={text}
              onChange={(e) => { setText(e.target.value); setCheck(null); }}
              placeholder={"first_name,last_name,email,phone,unit_number,monthly_rent\nJane,Mwangi,jane@example.com,0712345678,A101,85000"}
            />
            <p className="text-xs text-muted-foreground">Needs first_name, last_name and email. Optional: phone, unit_number, monthly_rent, lease_start_date, lease_end_date, security_deposit. Up to {MAX_ROWS} tenants at a time.</p>
            {text.trim() && parsed.problem && <p className="text-xs text-red-600">{parsed.problem}</p>}
          </div>

          {check && (
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <p>
                <strong>{check.wouldImport}</strong> tenant{check.wouldImport === 1 ? "" : "s"} would be added
                {check.skipped ? <> · <strong>{check.skipped}</strong> skipped</> : null}.
              </p>
              {check.errors.length > 0 && (
                <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-0.5 max-h-40 overflow-y-auto">
                  {check.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                  {check.errors.length > 50 && <li>…and {check.errors.length - 50} more</li>}
                </ul>
              )}
              <label className="flex items-start gap-2 text-sm cursor-pointer pt-1">
                <Checkbox checked={sendInvites} onCheckedChange={(c) => setSendInvites(!!c)} className="mt-0.5" />
                <span>Email each new tenant their sign-in link now<span className="block text-xs text-muted-foreground">Otherwise they are added quietly and you can send invites later from the Tenants list.</span></span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!check ? (
            <Button onClick={() => run.mutate(true)} disabled={run.isPending || parsed.rows.length === 0}>
              {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Check the file
            </Button>
          ) : (
            <Button onClick={() => run.mutate(false)} disabled={run.isPending || check.wouldImport === 0}>
              {run.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Import {check.wouldImport} tenant{check.wouldImport === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
