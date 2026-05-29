import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import {
  Leaf, TreePine, Droplets, Recycle, Shield, BarChart3, Target, Award,
  TrendingUp, TrendingDown, Calendar, FileText, Download, Plus, Settings,
  CheckCircle, AlertTriangle, Clock, Globe, Zap, Building, Users, Activity,
  RefreshCw, Loader2, Edit, ExternalLink, Info, X,
  Search, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";

// ── Types matching actual DB schema ──────────────────────────────────────────

interface EsgMetricRow {
  id: number;
  propertyId: number | null;
  propertyName: string | null;
  periodYear: number;
  periodMonth: number;
  electricityKwh: string;
  solarKwh: string;
  generatorLitres: string;
  waterM3: string;
  rainwaterM3: string;
  wasteKg: string;
  recycledKg: string;
  carbonKgco2e: string;
  energyScore: number | null;
  waterScore: number | null;
  wasteScore: number | null;
  overallScore: number | null;
  notes: string | null;
  createdAt: string;
}

interface EsgMetricsResponse {
  metrics: EsgMetricRow[];
  totals: {
    electricityKwh: number;
    solarKwh: number;
    waterM3: number;
    wasteKg: number;
    recycledKg: number;
    carbonKgco2e: number;
  };
  avgScore: number | null;
  count: number;
}

interface EsgReport {
  id: number;
  reportType: string;
  periodLabel: string;
  title: string;
  status: string;
  reportUrl: string | null;
  content: string | null;
  fileUrl: string | null;
  highlights: any[];
  createdAt: string;
}

interface GreenMaterial {
  id: number;
  name: string;
  category: string | null;
  supplier: string | null;
  certification: string | null;
  carbonFootprint: string | null;
  unitOfMeasure: string | null;
  costPerUnit: string | null;
  currency: string;
  isApproved: boolean;
  notes: string | null;
  createdAt: string;
}

interface DataIntegration {
  id: string;
  name: string;
  provider: string;
  status: "connected" | "manual" | "not_configured";
  description: string;
  lastSync: string | null;
  configUrl: string;
}

interface SupplyChainResponse {
  vendors: {
    vendorName: string | null;
    category: string | null;
    totalSpend: string;
    invoiceCount: string;
    lastUsed: string | null;
  }[];
  byCategory: { category: string; totalSpend: number; vendorCount: number }[];
  totalVendors: number;
  totalSpend: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(n: string | number | null | undefined, dp = 0): string {
  if (n === null || n === undefined) return "0";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "0";
  return num.toLocaleString("en-KE", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-KE"); } catch { return "—"; }
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  const color = score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600";
  return <span className={`font-bold text-sm ${color}`}>{score}/100</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:          "bg-muted text-foreground",
    in_review:      "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    published:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    connected:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    manual:         "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
    not_configured: "bg-muted text-muted-foreground",
    approved:       "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    pending:        "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  };
  const labels: Record<string, string> = {
    draft: "Draft", in_review: "In Review", published: "Published",
    connected: "Connected", manual: "Manual Entry", not_configured: "Not Configured",
    approved: "Approved", pending: "Pending",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? "bg-muted text-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ── Add Metric Modal ──────────────────────────────────────────────────────────

function AddMetricModal({ open, onClose, properties }: {
  open: boolean; onClose: () => void; properties: any[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [form, setForm] = useState({
    propertyId: "", periodYear: String(now.getFullYear()),
    periodMonth: String(now.getMonth() + 1),
    electricityKwh: "", solarKwh: "", generatorLitres: "",
    waterM3: "", rainwaterM3: "", wasteKg: "", recycledKg: "", notes: "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/sustainability/esg-metrics", {
        method: "POST",
        data: {
          ...form,
          propertyId:      form.propertyId      ? parseInt(form.propertyId)      : null,
          periodYear:      parseInt(form.periodYear),
          periodMonth:     parseInt(form.periodMonth),
          electricityKwh:  parseFloat(form.electricityKwh  || "0"),
          solarKwh:        parseFloat(form.solarKwh        || "0"),
          generatorLitres: parseFloat(form.generatorLitres || "0"),
          waterM3:         parseFloat(form.waterM3         || "0"),
          rainwaterM3:     parseFloat(form.rainwaterM3     || "0"),
          wasteKg:         parseFloat(form.wasteKg         || "0"),
          recycledKg:      parseFloat(form.recycledKg      || "0"),
        },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Metrics recorded", description: "ESG data saved and scores calculated." });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/esg-metrics"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-emerald-600" /> Record ESG Metrics
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))}>
                <SelectTrigger><SelectValue placeholder="All properties" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All properties</SelectItem>
                  {properties.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year *</Label>
              <Input value={form.periodYear} onChange={set("periodYear")} type="number" min="2020" max="2099" />
            </div>
            <div className="space-y-1.5">
              <Label>Month *</Label>
              <Select value={form.periodMonth} onValueChange={v => setForm(f => ({ ...f, periodMonth: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" /> Energy
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Grid Electricity (kWh)</Label>
                <Input value={form.electricityKwh} onChange={set("electricityKwh")} type="number" min="0" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Solar Generation (kWh)</Label>
                <Input value={form.solarKwh} onChange={set("solarKwh")} type="number" min="0" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Generator (litres)</Label>
                <Input value={form.generatorLitres} onChange={set("generatorLitres")} type="number" min="0" placeholder="0" />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Droplets className="w-3.5 h-3.5" /> Water
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mains Water (m³)</Label>
                <Input value={form.waterM3} onChange={set("waterM3")} type="number" min="0" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Rainwater Harvested (m³)</Label>
                <Input value={form.rainwaterM3} onChange={set("rainwaterM3")} type="number" min="0" placeholder="0" />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Recycle className="w-3.5 h-3.5" /> Waste
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Total Waste (kg)</Label>
                <Input value={form.wasteKg} onChange={set("wasteKg")} type="number" min="0" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Recycled (kg)</Label>
                <Input value={form.recycledKg} onChange={set("recycledKg")} type="number" min="0" placeholder="0" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} placeholder="Any observations about this period's data…" rows={2} />
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Scores (0–100) and carbon emissions are calculated automatically from the values you enter.
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              disabled={mut.isPending || !form.periodYear || !form.periodMonth}
              onClick={() => mut.mutate()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Metrics"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New Report Modal ──────────────────────────────────────────────────────────

function NewReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: "", reportType: "annual", periodLabel: String(new Date().getFullYear()), notes: "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/sustainability/reports", {
        method: "POST",
        data: { title: form.title, reportType: form.reportType, periodLabel: form.periodLabel, status: "draft" },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Report created", description: "Draft report ready to work on." });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/reports"] });
      onClose();
      setForm({ title: "", reportType: "annual", periodLabel: String(new Date().getFullYear()), notes: "" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" /> New ESG Report
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Report Title *</Label>
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Annual Sustainability Report 2025"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Report Type</Label>
              <Select value={form.reportType} onValueChange={v => setForm(f => ({ ...f, reportType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="audit">Audit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Period</Label>
              <Input
                value={form.periodLabel}
                onChange={e => setForm(f => ({ ...f, periodLabel: e.target.value }))}
                placeholder="e.g. 2025 Q1"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              disabled={mut.isPending || !form.title.trim()}
              onClick={() => mut.mutate()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create Report"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Material Modal ────────────────────────────────────────────────────────

function AddMaterialModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", category: "", supplier: "", certification: "",
    carbonFootprint: "", unitOfMeasure: "", costPerUnit: "", notes: "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/sustainability/green-materials", {
        method: "POST",
        data: {
          ...form,
          carbonFootprint: form.carbonFootprint ? parseFloat(form.carbonFootprint) : null,
          costPerUnit:     form.costPerUnit     ? parseFloat(form.costPerUnit)     : null,
          isApproved:      false,
        },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Material added", description: "Green material recorded for review." });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/green-materials"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Recycle className="w-5 h-5 text-emerald-600" /> Add Green Material
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Material Name *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="e.g. Recycled Steel Rebar" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {["insulation","solar","lighting","water","paint","structural","other"].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Input value={form.supplier} onChange={set("supplier")} placeholder="Supplier name" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Certification</Label>
              <Input value={form.certification} onChange={set("certification")} placeholder="e.g. LEED, Green Star" />
            </div>
            <div className="space-y-1.5">
              <Label>Unit of Measure</Label>
              <Input value={form.unitOfMeasure} onChange={set("unitOfMeasure")} placeholder="kg, m², unit" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Carbon Footprint (kgCO2e per unit)</Label>
              <Input value={form.carbonFootprint} onChange={set("carbonFootprint")} type="number" min="0" step="0.001" placeholder="0.000" />
            </div>
            <div className="space-y-1.5">
              <Label>Cost per Unit (KES)</Label>
              <Input value={form.costPerUnit} onChange={set("costPerUnit")} type="number" min="0" placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Any additional notes…" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              disabled={mut.isPending || !form.name.trim()}
              onClick={() => mut.mutate()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Add Material"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Report Editor Panel ───────────────────────────────────────────────────────
// Full report detail view: rich content editor + metrics sidebar + file attach
// + workflow buttons. Opens when the user clicks a report card.

const REPORT_SECTIONS = [
  { key: "executive_summary",   label: "Executive Summary" },
  { key: "energy_performance",  label: "Energy Performance" },
  { key: "water_management",    label: "Water Management" },
  { key: "waste_recycling",     label: "Waste & Recycling" },
  { key: "carbon_emissions",    label: "Carbon Emissions" },
  { key: "targets_progress",    label: "Targets & Progress" },
  { key: "governance",          label: "Governance & Social" },
  { key: "outlook",             label: "Outlook & Commitments" },
];

function parseSections(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { executive_summary: raw }; }
}

function serializeSections(sections: Record<string, string>): string {
  return JSON.stringify(sections);
}

function ReportEditorPanel({
  report,
  metrics,
  onClose,
  canEdit,
}: {
  report: EsgReport;
  metrics: EsgMetricRow[];
  onClose: () => void;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sections, setSections] = useState<Record<string, string>>(
    parseSections(report.content)
  );
  const [activeSection, setActiveSection] = useState(REPORT_SECTIONS[0].key);
  const [fileUrl, setFileUrl] = useState(report.fileUrl ?? report.reportUrl ?? "");
  const [dirty, setDirty] = useState(false);

  // Find metrics rows that match this report's period label
  // Period label is e.g. "2025", "2025 Q1", "2024" — try to match year
  const yearMatch = report.periodLabel.match(/\d{4}/);
  const reportYear = yearMatch ? parseInt(yearMatch[0]) : null;
  const relevantMetrics = reportYear
    ? metrics.filter(m => m.periodYear === reportYear)
    : [];

  // Aggregate the relevant metrics for the sidebar
  const periodTotals = relevantMetrics.reduce((acc, m) => ({
    electricityKwh: acc.electricityKwh + Number(m.electricityKwh ?? 0),
    solarKwh:       acc.solarKwh       + Number(m.solarKwh       ?? 0),
    waterM3:        acc.waterM3        + Number(m.waterM3         ?? 0),
    wasteKg:        acc.wasteKg        + Number(m.wasteKg         ?? 0),
    recycledKg:     acc.recycledKg     + Number(m.recycledKg      ?? 0),
    carbonKgco2e:   acc.carbonKgco2e   + Number(m.carbonKgco2e    ?? 0),
  }), { electricityKwh: 0, solarKwh: 0, waterM3: 0, wasteKg: 0, recycledKg: 0, carbonKgco2e: 0 });

  const avgPeriodScore = relevantMetrics.length > 0
    ? Math.round(relevantMetrics.reduce((s, m) => s + Number(m.overallScore ?? 0), 0) / relevantMetrics.length)
    : null;

  const recycleRate = periodTotals.wasteKg > 0
    ? Math.round(periodTotals.recycledKg / periodTotals.wasteKg * 100)
    : null;

  // Save content mutation
  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(`/api/sustainability/reports/${report.id}`, {
        method: "PATCH",
        data: {
          content: serializeSections(sections),
          fileUrl: fileUrl.trim() || null,
          reportUrl: fileUrl.trim() || null,
        },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Report saved" });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/reports"] });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/reports", report.id] });
      setDirty(false);
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: async (status: string) => {
      const r = await apiRequest(`/api/sustainability/reports/${report.id}`, {
        method: "PATCH",
        data: { status },
      });
      return r.json();
    },
    onSuccess: (updated) => {
      toast({ title: `Report ${updated.status === "published" ? "published" : "submitted for review"}` });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/reports"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function setSection(key: string, value: string) {
    setSections(s => ({ ...s, [key]: value }));
    setDirty(true);
  }

  const isReadOnly = !canEdit || report.status === "published";

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="font-semibold truncate">{report.title}</div>
            <div className="text-xs text-muted-foreground capitalize">
              {report.reportType} · {report.periodLabel}
            </div>
          </div>
          <StatusPill status={report.status} />
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {dirty && canEdit && !isReadOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
              Save
            </Button>
          )}
          {report.status === "draft" && canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (dirty) await saveMut.mutateAsync();
                statusMut.mutate("in_review");
              }}
              disabled={statusMut.isPending || saveMut.isPending}
            >
              Submit for Review
            </Button>
          )}
          {report.status === "in_review" && canEdit && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => statusMut.mutate("published")}
              disabled={statusMut.isPending}
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Approve & Publish
            </Button>
          )}
          {(report.fileUrl || report.reportUrl) && (
            <Button size="sm" variant="outline" asChild>
              <a href={report.fileUrl ?? report.reportUrl!} target="_blank" rel="noreferrer">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download File
              </a>
            </Button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Body: editor + sidebar ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Section nav */}
        <div className="w-48 shrink-0 border-r bg-muted/30 overflow-y-auto py-4 hidden md:block">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 mb-2">Sections</p>
          {REPORT_SECTIONS.map(s => {
            const hasContent = !!sections[s.key]?.trim();
            return (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                  activeSection === s.key
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasContent ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Main editor area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

            {/* Mobile section selector */}
            <div className="md:hidden">
              <Select value={activeSection} onValueChange={setActiveSection}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_SECTIONS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Published banner */}
            {report.status === "published" && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                This report has been published and is read-only. To make changes, contact your administrator.
              </div>
            )}

            {/* Active section editor */}
            {REPORT_SECTIONS.map(s => s.key === activeSection ? (
              <div key={s.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">{s.label}</Label>
                  {s.key === "energy_performance" && relevantMetrics.length > 0 && (
                    <button
                      className="text-xs text-emerald-600 hover:underline"
                      onClick={() => {
                        const auto = `Energy Performance — ${report.periodLabel}\n\nGrid electricity consumed: ${fmt(periodTotals.electricityKwh)} kWh\nSolar generation: ${fmt(periodTotals.solarKwh)} kWh\nGenerator fuel: (see metrics)\nCarbon emissions: ${fmt(periodTotals.carbonKgco2e)} kgCO2e (${fmt(periodTotals.carbonKgco2e / 1000, 2)} tCO2e)\nESG energy score: ${avgPeriodScore ?? "—"}/100`;
                        setSection(s.key, auto);
                      }}
                    >
                      ↓ Auto-fill from metrics
                    </button>
                  )}
                  {s.key === "water_management" && relevantMetrics.length > 0 && (
                    <button
                      className="text-xs text-emerald-600 hover:underline"
                      onClick={() => {
                        const auto = `Water Management — ${report.periodLabel}\n\nMains water consumed: ${fmt(periodTotals.waterM3)} m³\nRainwater harvested: ${fmt(relevantMetrics.reduce((s,m)=>s+Number(m.rainwaterM3??0),0))} m³\nESG water score: ${avgPeriodScore ?? "—"}/100`;
                        setSection(s.key, auto);
                      }}
                    >
                      ↓ Auto-fill from metrics
                    </button>
                  )}
                  {s.key === "waste_recycling" && relevantMetrics.length > 0 && (
                    <button
                      className="text-xs text-emerald-600 hover:underline"
                      onClick={() => {
                        const auto = `Waste & Recycling — ${report.periodLabel}\n\nTotal waste generated: ${fmt(periodTotals.wasteKg)} kg\nRecycled: ${fmt(periodTotals.recycledKg)} kg\nRecycling rate: ${recycleRate ?? 0}%\nESG waste score: ${avgPeriodScore ?? "—"}/100`;
                        setSection(s.key, auto);
                      }}
                    >
                      ↓ Auto-fill from metrics
                    </button>
                  )}
                </div>
                <Textarea
                  value={sections[s.key] ?? ""}
                  onChange={e => setSection(s.key, e.target.value)}
                  placeholder={`Write the ${s.label} section here…`}
                  className="min-h-[280px] font-mono text-sm resize-y leading-relaxed"
                  readOnly={isReadOnly}
                />
                <p className="text-xs text-muted-foreground">
                  {(sections[s.key] ?? "").length} characters
                  {isReadOnly ? " · Read-only" : " · Plain text or Markdown"}
                </p>
              </div>
            ) : null)}

            {/* File attachment */}
            <div className="pt-2 border-t space-y-2">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Download className="w-3.5 h-3.5" /> Attached File (optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Paste a URL to a PDF, Word doc, or Google Doc that is the formal version of this report.
                Reviewers and stakeholders can download it directly.
              </p>
              <div className="flex gap-2">
                <Input
                  value={fileUrl}
                  onChange={e => { setFileUrl(e.target.value); setDirty(true); }}
                  placeholder="https://drive.google.com/… or https://your-storage.com/report.pdf"
                  className="text-sm"
                  readOnly={isReadOnly}
                />
                {fileUrl && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={fileUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Metrics sidebar ── */}
        <div className="w-64 shrink-0 border-l bg-muted/20 overflow-y-auto py-4 hidden lg:block">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 mb-3">
            Data for {report.periodLabel}
          </p>

          {relevantMetrics.length === 0 ? (
            <div className="px-4 text-xs text-muted-foreground">
              No metrics recorded for this period.
              <button onClick={() => {}} className="block text-emerald-600 hover:underline mt-1">
                Record metrics →
              </button>
            </div>
          ) : (
            <div className="px-4 space-y-4">
              {/* Score */}
              {avgPeriodScore !== null && (
                <div className="rounded-lg bg-card border p-3 text-center">
                  <div className={`text-2xl font-bold ${avgPeriodScore >= 70 ? "text-emerald-600" : avgPeriodScore >= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {avgPeriodScore}/100
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">ESG Score</div>
                </div>
              )}

              {/* Energy */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Energy
                </p>
                <div className="text-xs space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Grid</span><span className="font-mono">{fmt(periodTotals.electricityKwh)} kWh</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground text-emerald-600">Solar</span><span className="font-mono text-emerald-600">{fmt(periodTotals.solarKwh)} kWh</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Carbon</span><span className="font-mono">{fmt(periodTotals.carbonKgco2e / 1000, 2)} tCO2e</span></div>
                </div>
              </div>

              {/* Water */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Droplets className="w-3 h-3" /> Water
                </p>
                <div className="text-xs space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Mains</span><span className="font-mono">{fmt(periodTotals.waterM3)} m³</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rainwater</span><span className="font-mono">{fmt(relevantMetrics.reduce((s,m)=>s+Number(m.rainwaterM3??0),0))} m³</span></div>
                </div>
              </div>

              {/* Waste */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Recycle className="w-3 h-3" /> Waste
                </p>
                <div className="text-xs space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-mono">{fmt(periodTotals.wasteKg)} kg</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recycled</span><span className="font-mono">{fmt(periodTotals.recycledKg)} kg</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-mono font-semibold">{recycleRate ?? 0}%</span></div>
                </div>
              </div>

              {/* Monthly breakdown */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Monthly</p>
                <div className="space-y-1">
                  {relevantMetrics.map(m => (
                    <div key={m.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{MONTHS[(m.periodMonth ?? 1) - 1]}</span>
                      <ScoreBadge score={m.overallScore} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const SustainabilityESG = () => {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const qc = useQueryClient();
  const [addMetricOpen, setAddMetricOpen]     = useState(false);
  const [newReportOpen, setNewReportOpen]     = useState(false);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [openReportId, setOpenReportId]       = useState<number | null>(null);

  // Fetch the full single report (including content + fileUrl) when one is opened.
  // The list query may not carry content if it was saved in a prior session.
  const { data: openReport, isLoading: openReportLoading } = useQuery<EsgReport>({
    queryKey: ["/api/sustainability/reports", openReportId],
    queryFn: async () => {
      const r = await apiRequest(`/api/sustainability/reports/${openReportId}`);
      return r.json();
    },
    enabled: openReportId !== null,
    staleTime: 0, // always re-fetch so we never show stale content
  });

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: metricsResp, isLoading: metricsLoading } = useQuery<EsgMetricsResponse>({
    queryKey: ["/api/sustainability/esg-metrics"],
    queryFn: async () => {
      const r = await apiRequest("/api/sustainability/esg-metrics");
      return r.json();
    },
  });

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
  });

  const { data: reportsRaw = [], isLoading: reportsLoading } = useQuery<EsgReport[]>({
    queryKey: ["/api/sustainability/reports"],
    queryFn: async () => {
      const r = await apiRequest("/api/sustainability/reports");
      return ensureArray(await r.json());
    },
  });

  const { data: materialsRaw = [], isLoading: materialsLoading } = useQuery<GreenMaterial[]>({
    queryKey: ["/api/sustainability/green-materials"],
    queryFn: async () => {
      const r = await apiRequest("/api/sustainability/green-materials");
      return ensureArray(await r.json());
    },
  });

  const { data: supplyChain, isLoading: supplyLoading } = useQuery<SupplyChainResponse>({
    queryKey: ["/api/sustainability/supply-chain"],
    queryFn: async () => {
      const r = await apiRequest("/api/sustainability/supply-chain");
      return r.json();
    },
  });

  const { data: integrations = [], isLoading: intLoading } = useQuery<DataIntegration[]>({
    queryKey: ["/api/sustainability/data-integrations"],
    queryFn: async () => {
      const r = await apiRequest("/api/sustainability/data-integrations");
      return ensureArray(await r.json());
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const updateReportStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest(`/api/sustainability/reports/${id}`, {
        method: "PATCH",
        data: { status },
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Report updated" });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/reports"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const approveMaterial = useMutation({
    mutationFn: async ({ id, isApproved }: { id: number; isApproved: boolean }) => {
      const r = await apiRequest(`/api/sustainability/green-materials/${id}`, {
        method: "PATCH",
        data: { isApproved },
      });
      return r.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.isApproved ? "Material approved" : "Approval revoked" });
      qc.invalidateQueries({ queryKey: ["/api/sustainability/green-materials"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Search + pagination state per tab ───────────────────────────────────

  // Metrics tab
  const [metricSearch, setMetricSearch]     = useState("");
  const [metricProperty, setMetricProperty] = useState("__all__");
  const [metricYear, setMetricYear]         = useState("__all__");
  const [metricPage, setMetricPage]         = useState(1);
  const [metricPageSize, setMetricPageSize] = useState(10);

  // Reports tab
  const [reportSearch, setReportSearch]     = useState("");
  const [reportStatus, setReportStatus]     = useState("__all__");
  const [reportPage, setReportPage]         = useState(1);
  const [reportPageSize, setReportPageSize] = useState(10);

  // Materials tab
  const [matSearch, setMatSearch]           = useState("");
  const [matCategory, setMatCategory]       = useState("__all__");
  const [matApproved, setMatApproved]       = useState("__all__");
  const [matPage, setMatPage]               = useState(1);
  const [matPageSize, setMatPageSize]       = useState(12);

  // ── Derived values ───────────────────────────────────────────────────────

  const metrics  = metricsResp?.metrics ?? [];
  const totals   = metricsResp?.totals;
  const avgScore = metricsResp?.avgScore;

  const recycleRate = totals && totals.wasteKg > 0
    ? Math.round((totals.recycledKg / totals.wasteKg) * 100)
    : null;

  const solarPct = totals && (totals.electricityKwh + totals.solarKwh) > 0
    ? Math.round((totals.solarKwh / (totals.electricityKwh + totals.solarKwh)) * 100)
    : null;

  // ── Filtered + paginated metrics ────────────────────────────────────────
  const filteredMetrics = metrics.filter(m => {
    if (metricProperty !== "__all__" && String(m.propertyId) !== metricProperty) return false;
    if (metricYear !== "__all__" && String(m.periodYear) !== metricYear) return false;
    if (metricSearch) {
      const q = metricSearch.toLowerCase();
      return (
        (m.propertyName ?? "All").toLowerCase().includes(q) ||
        String(m.periodYear).includes(q) ||
        MONTHS[(m.periodMonth ?? 1) - 1].toLowerCase().includes(q)
      );
    }
    return true;
  });
  const metricTotalPages = Math.max(1, Math.ceil(filteredMetrics.length / metricPageSize));
  const pagedMetrics = filteredMetrics.slice((metricPage - 1) * metricPageSize, metricPage * metricPageSize);

  // ── Filtered + paginated reports ─────────────────────────────────────────
  const filteredReports = reportsRaw.filter(r => {
    if (reportStatus !== "__all__" && r.status !== reportStatus) return false;
    if (reportSearch) {
      const q = reportSearch.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.reportType.toLowerCase().includes(q) ||
        r.periodLabel.toLowerCase().includes(q)
      );
    }
    return true;
  });
  const reportTotalPages = Math.max(1, Math.ceil(filteredReports.length / reportPageSize));
  const pagedReports = filteredReports.slice((reportPage - 1) * reportPageSize, reportPage * reportPageSize);

  // ── Filtered + paginated materials ──────────────────────────────────────
  const filteredMaterials = materialsRaw.filter(m => {
    if (matCategory !== "__all__" && m.category !== matCategory) return false;
    if (matApproved !== "__all__") {
      if (matApproved === "approved" && !m.isApproved) return false;
      if (matApproved === "pending"  &&  m.isApproved) return false;
    }
    if (matSearch) {
      const q = matSearch.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        (m.supplier ?? "").toLowerCase().includes(q) ||
        (m.certification ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });
  const matTotalPages = Math.max(1, Math.ceil(filteredMaterials.length / matPageSize));
  const pagedMaterials = filteredMaterials.slice((matPage - 1) * matPageSize, matPage * matPageSize);

  // ── Unique years from metrics for filter dropdown ────────────────────────
  const metricYears = [...new Set(metrics.map(m => m.periodYear))].sort((a, b) => b - a);
  const matCategories = [...new Set(materialsRaw.map(m => m.category).filter(Boolean))] as string[];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Full-screen report editor — rendered on top when a report is open */}
      {openReportId !== null && (
        openReportLoading ? (
          <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading report…</p>
            </div>
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              onClick={() => setOpenReportId(null)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : openReport ? (
          <ReportEditorPanel
            report={openReport}
            metrics={metrics}
            onClose={() => setOpenReportId(null)}
            canEdit={true}
          />
        ) : null
      )}

      {/* Modals */}
      <AddMetricModal open={addMetricOpen} onClose={() => setAddMetricOpen(false)} properties={properties} />
      <NewReportModal open={newReportOpen} onClose={() => setNewReportOpen(false)} />
      <AddMaterialModal open={addMaterialOpen} onClose={() => setAddMaterialOpen(false)} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Leaf className="h-7 w-7 text-emerald-600" />
            Sustainability &amp; ESG
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Environmental, social &amp; governance tracking for your portfolio
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setNewReportOpen(true)}>
            <FileText className="w-4 h-4 mr-2" /> New Report
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setAddMetricOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Record Metrics
          </Button>
        </div>
      </div>

      {/* KPI stat cards — live from API */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Carbon Emissions",
            value: totals ? `${fmt(totals.carbonKgco2e / 1000, 1)} tCO2e` : "—",
            sub: "This period total",
            icon: TreePine,
            color: "text-emerald-600",
            loading: metricsLoading,
          },
          {
            label: "Water Consumed",
            value: totals ? `${fmt(totals.waterM3)} m³` : "—",
            sub: solarPct !== null ? `${solarPct}% from rainwater` : "No rainwater data",
            icon: Droplets,
            color: "text-blue-600",
            loading: metricsLoading,
          },
          {
            label: "Waste Recycled",
            value: recycleRate !== null ? `${recycleRate}%` : "—",
            sub: totals ? `${fmt(totals.recycledKg)} kg recycled` : "No data yet",
            icon: Recycle,
            color: "text-orange-600",
            loading: metricsLoading,
          },
          {
            label: "ESG Score",
            value: avgScore !== null ? `${avgScore}/100` : "—",
            sub: `Across ${metricsResp?.count ?? 0} period${metricsResp?.count !== 1 ? "s" : ""}`,
            icon: Award,
            color: "text-purple-600",
            loading: metricsLoading,
          },
        ].map(({ label, value, sub, icon: Icon, color, loading }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-20 bg-muted animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-bold">{value}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="monitoring" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="monitoring"><BarChart3 className="h-4 w-4 mr-1.5" />Metrics</TabsTrigger>
          <TabsTrigger value="reporting"><FileText className="h-4 w-4 mr-1.5" />Reports</TabsTrigger>
          <TabsTrigger value="materials"><Recycle className="h-4 w-4 mr-1.5" />Materials</TabsTrigger>
          <TabsTrigger value="platform"><Globe className="h-4 w-4 mr-1.5" />Data Sources</TabsTrigger>
        </TabsList>

        {/* ── METRICS TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="monitoring" className="space-y-4 mt-4">
          {metricsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : metrics.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Leaf className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">No metrics recorded yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Start by recording your first month's energy, water, and waste data.
                </p>
                <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setAddMetricOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Record First Metrics
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle>ESG Metrics History</CardTitle>
                    <CardDescription>Monthly environmental data across all properties</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setAddMetricOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Month
                  </Button>
                </div>
                {/* Filter bar */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search period or property…"
                      value={metricSearch}
                      onChange={e => { setMetricSearch(e.target.value); setMetricPage(1); }}
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                  <Select value={metricProperty} onValueChange={v => { setMetricProperty(v); setMetricPage(1); }}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All properties" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All properties</SelectItem>
                      {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={metricYear} onValueChange={v => { setMetricYear(v); setMetricPage(1); }}>
                    <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue placeholder="All years" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All years</SelectItem>
                      {metricYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={String(metricPageSize)} onValueChange={v => { setMetricPageSize(Number(v)); setMetricPage(1); }}>
                    <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50].map(n => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-semibold">Period</th>
                        <th className="text-left py-2 pr-4 font-semibold">Property</th>
                        <th className="text-right py-2 pr-4 font-semibold">Electricity (kWh)</th>
                        <th className="text-right py-2 pr-4 font-semibold">Solar (kWh)</th>
                        <th className="text-right py-2 pr-4 font-semibold">Water (m³)</th>
                        <th className="text-right py-2 pr-4 font-semibold">Waste (kg)</th>
                        <th className="text-right py-2 pr-4 font-semibold">Recycled</th>
                        <th className="text-right py-2 pr-4 font-semibold">Carbon (kg)</th>
                        <th className="text-right py-2 font-semibold">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {pagedMetrics.map(m => {
                        const recycled = m.wasteKg && parseFloat(m.wasteKg) > 0
                          ? `${Math.round(parseFloat(m.recycledKg) / parseFloat(m.wasteKg) * 100)}%`
                          : "—";
                        return (
                          <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 pr-4 font-medium whitespace-nowrap">
                              {MONTHS[(m.periodMonth ?? 1) - 1]} {m.periodYear}
                            </td>
                            <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                              {m.propertyName ?? "All"}
                            </td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs">{fmt(m.electricityKwh)}</td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs text-emerald-600">{fmt(m.solarKwh)}</td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs">{fmt(m.waterM3)}</td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs">{fmt(m.wasteKg)}</td>
                            <td className="py-2.5 pr-4 text-right text-xs">{recycled}</td>
                            <td className="py-2.5 pr-4 text-right font-mono text-xs">{fmt(m.carbonKgco2e)}</td>
                            <td className="py-2.5 text-right"><ScoreBadge score={m.overallScore} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {totals && pagedMetrics.length > 0 && (
                      <tfoot>
                        <tr className="border-t bg-muted/30 font-semibold text-xs">
                          <td className="py-2 pr-4" colSpan={2}>
                            {filteredMetrics.length < metrics.length
                              ? `${filteredMetrics.length} filtered · ${metrics.length} total`
                              : `${metrics.length} records`}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(totals.electricityKwh)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-emerald-600">{fmt(totals.solarKwh)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(totals.waterM3)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(totals.wasteKg)}</td>
                          <td className="py-2 pr-4 text-right">{recycleRate !== null ? `${recycleRate}%` : "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(totals.carbonKgco2e)}</td>
                          <td className="py-2 text-right"><ScoreBadge score={avgScore} /></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {/* Pagination */}
                {metricTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t text-xs text-muted-foreground">
                    <span>{filteredMetrics.length} records · page {metricPage} of {metricTotalPages}</span>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                        disabled={metricPage <= 1} onClick={() => setMetricPage(p => p - 1)}>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                        disabled={metricPage >= metricTotalPages} onClick={() => setMetricPage(p => p + 1)}>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── REPORTS TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="reporting" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-semibold">Sustainability Reports</h2>
              <p className="text-sm text-muted-foreground">Create and manage ESG reports aligned with GRI, CDP, and other frameworks</p>
            </div>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setNewReportOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Report
            </Button>
          </div>

          {/* Filter bar */}
          {reportsRaw.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search title, type, period…"
                  value={reportSearch}
                  onChange={e => { setReportSearch(e.target.value); setReportPage(1); }}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={reportStatus} onValueChange={v => { setReportStatus(v); setReportPage(1); }}>
                <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(reportPageSize)} onValueChange={v => { setReportPageSize(Number(v)); setReportPage(1); }}>
                <SelectTrigger className="h-9 w-[100px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 10, 25].map(n => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {reportsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : reportsRaw.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">No reports yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Create your first sustainability report.</p>
                <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setNewReportOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Create First Report
                </Button>
              </CardContent>
            </Card>
          ) : filteredReports.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No reports match your search.</p>
                <button
                  onClick={() => { setReportSearch(""); setReportStatus("__all__"); }}
                  className="text-xs text-emerald-600 hover:underline mt-1"
                >Clear filters</button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-3">
                {pagedReports.map(report => (
                  <Card
                    key={report.id}
                    className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                    onClick={() => setOpenReportId(report.id)}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="font-semibold truncate">{report.title}</span>
                            <StatusPill status={report.status} />
                            {report.content && (
                              <span className="text-[10px] text-emerald-600 font-medium">● Has content</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 capitalize">
                            {report.reportType} · {report.periodLabel} · Created {fmtDate(report.createdAt)}
                          </p>
                          {/* Section completion dots */}
                          {report.content && (() => {
                            const s = parseSections(report.content);
                            return (
                              <div className="flex items-center gap-1 mt-1.5">
                                {REPORT_SECTIONS.map(sec => (
                                  <div
                                    key={sec.key}
                                    title={sec.label}
                                    className={`w-1.5 h-1.5 rounded-full ${s[sec.key]?.trim() ? "bg-emerald-500" : "bg-muted-foreground/20"}`}
                                  />
                                ))}
                                <span className="text-[10px] text-muted-foreground ml-1">
                                  {REPORT_SECTIONS.filter(s2 => parseSections(report.content)[s2.key]?.trim()).length}/{REPORT_SECTIONS.length} sections
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end" onClick={e => e.stopPropagation()}>
                          {report.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateReportStatus.mutate({ id: report.id, status: "in_review" })}
                              disabled={updateReportStatus.isPending}
                            >
                              Submit for Review
                            </Button>
                          )}
                          {report.status === "in_review" && (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => updateReportStatus.mutate({ id: report.id, status: "published" })}
                              disabled={updateReportStatus.isPending}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Approve & Publish
                            </Button>
                          )}
                          {(report.fileUrl || report.reportUrl) && (
                            <Button size="sm" variant="outline" asChild>
                              <a href={report.fileUrl ?? report.reportUrl!} target="_blank" rel="noreferrer">
                                <Download className="w-3.5 h-3.5 mr-1.5" /> Download
                              </a>
                            </Button>
                          )}
                          {report.status === "published" && !report.fileUrl && !report.reportUrl && (
                            <span className="text-xs text-muted-foreground">No file attached</span>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setOpenReportId(report.id)}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>
                  {filteredReports.length} report{filteredReports.length !== 1 ? "s" : ""}
                  {filteredReports.length < reportsRaw.length ? ` (filtered from ${reportsRaw.length})` : ""}
                  {reportTotalPages > 1 ? ` · page ${reportPage} of ${reportTotalPages}` : ""}
                </span>
                {reportTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                      disabled={reportPage <= 1} onClick={() => setReportPage(p => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                      disabled={reportPage >= reportTotalPages} onClick={() => setReportPage(p => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── MATERIALS TAB ────────────────────────────────────────────────── */}
        <TabsContent value="materials" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-semibold">Green Materials Register</h2>
              <p className="text-sm text-muted-foreground">Track sustainable materials, certifications, and carbon footprint</p>
            </div>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setAddMaterialOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Material
            </Button>
          </div>

          {/* Supply chain spend summary */}
          {supplyChain && supplyChain.totalVendors > 0 && (
            <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <CardContent className="py-3 flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-2">
                  <Building className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-blue-900 dark:text-blue-300">
                    {supplyChain.totalVendors} vendors · KES {fmt(supplyChain.totalSpend)} total spend
                  </span>
                </div>
                <span className="text-blue-700/70 dark:text-blue-400/70 text-xs">
                  Derived from expense records
                </span>
              </CardContent>
            </Card>
          )}

          {/* Filter bar */}
          {materialsRaw.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name, supplier, certification…"
                  value={matSearch}
                  onChange={e => { setMatSearch(e.target.value); setMatPage(1); }}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={matCategory} onValueChange={v => { setMatCategory(v); setMatPage(1); }}>
                <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {matCategories.map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={matApproved} onValueChange={v => { setMatApproved(v); setMatPage(1); }}>
                <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(matPageSize)} onValueChange={v => { setMatPageSize(Number(v)); setMatPage(1); }}>
                <SelectTrigger className="h-9 w-[100px] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[6, 12, 24].map(n => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {materialsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : materialsRaw.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Recycle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">No green materials registered</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Add sustainable materials used in your properties.</p>
                <Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setAddMaterialOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Add First Material
                </Button>
              </CardContent>
            </Card>
          ) : filteredMaterials.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No materials match your filters.</p>
                <button
                  onClick={() => { setMatSearch(""); setMatCategory("__all__"); setMatApproved("__all__"); }}
                  className="text-xs text-emerald-600 hover:underline mt-1"
                >Clear filters</button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pagedMaterials.map(m => (
                  <Card key={m.id}>
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{m.name}</div>
                          <div className="text-xs text-muted-foreground capitalize mt-0.5">
                            {[m.category, m.supplier].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusPill status={m.isApproved ? "approved" : "pending"} />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => approveMaterial.mutate({ id: m.id, isApproved: !m.isApproved })}
                            disabled={approveMaterial.isPending}
                            className={m.isApproved ? "text-amber-600 border-amber-300" : "text-emerald-600 border-emerald-300"}
                          >
                            {m.isApproved ? "Revoke" : "Approve"}
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {m.certification && (
                          <div className="col-span-2">
                            <span className="font-medium text-foreground">Certification:</span> {m.certification}
                          </div>
                        )}
                        {m.carbonFootprint && (
                          <div>
                            <span className="font-medium text-foreground">Carbon:</span> {fmt(m.carbonFootprint, 3)} kgCO2e/{m.unitOfMeasure ?? "unit"}
                          </div>
                        )}
                        {m.costPerUnit && (
                          <div>
                            <span className="font-medium text-foreground">Cost:</span> {m.currency} {fmt(m.costPerUnit, 2)}/{m.unitOfMeasure ?? "unit"}
                          </div>
                        )}
                      </div>
                      {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                      <p className="text-xs text-muted-foreground/60">Added {fmtDate(m.createdAt)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>
                  {filteredMaterials.length} material{filteredMaterials.length !== 1 ? "s" : ""}
                  {filteredMaterials.length < materialsRaw.length ? ` (filtered from ${materialsRaw.length})` : ""}
                  {matTotalPages > 1 ? ` · page ${matPage} of ${matTotalPages}` : ""}
                </span>
                {matTotalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                      disabled={matPage <= 1} onClick={() => setMatPage(p => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                      disabled={matPage >= matTotalPages} onClick={() => setMatPage(p => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── DATA SOURCES TAB ─────────────────────────────────────────────── */}
        <TabsContent value="platform" className="space-y-4 mt-4">
          <div>
            <h2 className="font-semibold">Data Sources &amp; Integrations</h2>
            <p className="text-sm text-muted-foreground">
              Status of meter readings and data inputs. Most data is entered manually — connect smart meters to automate this.
            </p>
          </div>

          {intLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {integrations.map(intg => (
                <Card key={intg.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{intg.name}</span>
                          <StatusPill status={intg.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{intg.provider}</p>
                        <p className="text-xs text-muted-foreground mt-1">{intg.description}</p>
                        {intg.lastSync && (
                          <p className="text-xs text-muted-foreground/60 mt-1">
                            Last sync: {new Date(intg.lastSync).toLocaleString("en-KE")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {intg.status === "not_configured" && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => toast({
                              title: "Integration setup",
                              description: "Contact SmartProp support to connect this data source.",
                            })}
                          >
                            <Settings className="w-3.5 h-3.5 mr-1.5" /> Set Up
                          </Button>
                        )}
                        {intg.status === "manual" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAddMetricOpen(true)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1.5" /> Enter Reading
                          </Button>
                        )}
                        {intg.status === "connected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              qc.invalidateQueries({ queryKey: ["/api/sustainability/esg-metrics"] });
                              toast({ title: "Refreshed", description: "Data synced." });
                            }}
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Sync Now
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Supply chain vendor breakdown */}
          {supplyChain && supplyChain.byCategory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vendor Spend by Category</CardTitle>
                <CardDescription>Derived from property expense records — use to assess supply chain sustainability</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {supplyChain.byCategory
                    .sort((a, b) => b.totalSpend - a.totalSpend)
                    .slice(0, 8)
                    .map(cat => {
                      const pct = supplyChain.totalSpend > 0
                        ? Math.round((cat.totalSpend / supplyChain.totalSpend) * 100)
                        : 0;
                      return (
                        <div key={cat.category}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="capitalize">{cat.category ?? "other"}</span>
                            <span className="text-muted-foreground text-xs">
                              KES {fmt(cat.totalSpend)} · {cat.vendorCount} vendor{cat.vendorCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SustainabilityESG;