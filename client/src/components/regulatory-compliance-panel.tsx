/**
 * RegulatoryCompliancePanel
 *
 * Embedded in the property-details page as the "Compliance" tab.
 * Manages NEMA / NCA / County regulatory certificates for a single property.
 *
 * Features:
 *   • Status dashboard — active / expiring-soon / expired counts
 *   • Certificate list grouped by authority with colour-coded expiry status
 *   • Add / Edit modal with all certificate fields
 *   • Delete with confirmation
 *   • Direct link to upload a document (document_url field)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format, differenceInDays, isPast } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Shield, ShieldCheck, ShieldAlert, ShieldX, Plus, Loader2,
  FileText, Calendar, AlertTriangle, CheckCircle2, Clock,
  Pencil, Trash2, ExternalLink, RefreshCw, Info, Building,
  Leaf, HardHat, Flame, Award,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RegulatoryCert {
  id: number;
  authority: "NEMA" | "NCA" | "COUNTY" | "FIRE" | "OTHER";
  certificateType: string;
  certificateNumber: string | null;
  title: string;
  projectId: number | null;
  projectName?: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  status: "active" | "expired" | "pending" | "suspended" | "revoked" | "under_review";
  issuingOfficer: string | null;
  issuingOffice: string | null;
  conditions: string | null;
  notes: string | null;
  documentUrl: string | null;
  daysUntilExpiry: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

interface Props {
  propertyId: number;
  propertyName: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const AUTHORITIES = [
  { value: "NEMA",   label: "NEMA",   desc: "National Environment Management Authority",  icon: Leaf,    color: "text-emerald-700 bg-emerald-100 border-emerald-300" },
  { value: "NCA",    label: "NCA",    desc: "National Construction Authority",             icon: HardHat, color: "text-violet-700  bg-violet-100  border-violet-300"  },
  { value: "COUNTY", label: "County", desc: "County Government",                           icon: Building,color: "text-blue-700    bg-blue-100    border-blue-300"    },
  { value: "FIRE",   label: "Fire",   desc: "Fire & Rescue Services",                      icon: Flame,   color: "text-red-700     bg-red-100     border-red-300"     },
  { value: "OTHER",  label: "Other",  desc: "Other Regulatory Body",                       icon: Award,   color: "text-slate-700   bg-slate-100   border-slate-300"   },
] as const;

const CERT_TYPES: Record<string, string[]> = {
  NEMA:   ["EIA Licence", "Environmental Audit Certificate", "NEMA Compliance Certificate", "Waste Management Licence"],
  NCA:    ["NCA Project Registration", "Contractor Certificate", "Site Supervisor Certificate", "NCA Class Certificate"],
  COUNTY: ["Building Permit", "Occupation Certificate", "Change of User Permit", "Subdivision Approval"],
  FIRE:   ["Fire Clearance Certificate", "Fire Safety Inspection Report", "Fire Equipment Certificate"],
  OTHER:  ["Structural Inspection Certificate", "Electrical Installation Certificate", "Lift / Elevator Certificate", "Other"],
};

const STATUSES = [
  { value: "active",       label: "Active",       cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  { value: "pending",      label: "Pending",      cls: "bg-amber-100   text-amber-800   border-amber-200"   },
  { value: "under_review", label: "Under Review", cls: "bg-blue-100    text-blue-800    border-blue-200"    },
  { value: "expired",      label: "Expired",      cls: "bg-red-100     text-red-800     border-red-200"     },
  { value: "suspended",    label: "Suspended",    cls: "bg-orange-100  text-orange-800  border-orange-200"  },
  { value: "revoked",      label: "Revoked",      cls: "bg-red-100     text-red-900     border-red-300 font-bold" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmt = (d: string | null | undefined) => d ? format(new Date(d), "dd MMM yyyy") : "—";

function expiryClass(cert: RegulatoryCert): string {
  if (cert.isExpired)                                   return "text-red-600 font-semibold";
  if (cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 7)  return "text-red-600 font-semibold";
  if (cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 30) return "text-amber-600 font-semibold";
  if (cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 90) return "text-amber-500";
  return "text-muted-foreground";
}

function expiryLabel(cert: RegulatoryCert): string {
  if (!cert.expiryDate) return "No expiry";
  if (cert.isExpired)   return `Expired ${Math.abs(cert.daysUntilExpiry ?? 0)} days ago`;
  if (cert.daysUntilExpiry === 0) return "Expires today";
  if (cert.daysUntilExpiry === 1) return "Expires tomorrow";
  if ((cert.daysUntilExpiry ?? 999) <= 90) return `Expires in ${cert.daysUntilExpiry} days`;
  return `Expires ${fmt(cert.expiryDate)}`;
}

function AuthorityChip({ authority }: { authority: string }) {
  const cfg = AUTHORITIES.find(a => a.value === authority) ?? AUTHORITIES[4];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUSES.find(s => s.value === status) ?? STATUSES[0];
  return <Badge variant="outline" className={`text-xs ${cfg.cls}`}>{cfg.label}</Badge>;
}

// ─── Empty cert form ──────────────────────────────────────────────────────

const emptyForm = {
  authority: "NEMA" as const,
  certificateType: "",
  certificateNumber: "",
  title: "",
  issueDate: "",
  expiryDate: "",
  renewalDate: "",
  status: "active" as const,
  issuingOfficer: "",
  issuingOffice: "",
  conditions: "",
  notes: "",
  documentUrl: "",
};

// ─── Add / Edit Modal ─────────────────────────────────────────────────────

function CertModal({
  propertyId,
  cert,
  onClose,
}: {
  propertyId: number;
  cert: RegulatoryCert | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!cert;

  const [form, setForm] = useState<typeof emptyForm>(
    cert ? {
      authority:         cert.authority,
      certificateType:   cert.certificateType,
      certificateNumber: cert.certificateNumber ?? "",
      title:             cert.title,
      issueDate:         cert.issueDate ?? "",
      expiryDate:        cert.expiryDate ?? "",
      renewalDate:       cert.renewalDate ?? "",
      status:            cert.status as any,
      issuingOfficer:    cert.issuingOfficer ?? "",
      issuingOffice:     cert.issuingOffice ?? "",
      conditions:        cert.conditions ?? "",
      notes:             cert.notes ?? "",
      documentUrl:       cert.documentUrl ?? "",
    } : { ...emptyForm }
  );

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        propertyId,
        issueDate:    form.issueDate    || null,
        expiryDate:   form.expiryDate   || null,
        renewalDate:  form.renewalDate  || null,
        certificateNumber: form.certificateNumber || null,
        issuingOfficer:    form.issuingOfficer    || null,
        issuingOffice:     form.issuingOffice     || null,
        conditions:        form.conditions         || null,
        notes:             form.notes              || null,
        documentUrl:       form.documentUrl        || null,
      };

      const url    = isEdit ? `/api/regulatory-certificates/${cert!.id}` : "/api/regulatory-certificates";
      const method = isEdit ? "PATCH" : "POST";
      const res    = await apiRequest(url, { method, data: payload });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/regulatory-certificates`, propertyId] });
      toast({ title: isEdit ? "Certificate updated" : "Certificate added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof emptyForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const suggestedTypes = CERT_TYPES[form.authority] ?? CERT_TYPES["OTHER"];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            {isEdit ? "Edit Certificate" : "Add Regulatory Certificate"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">

          {/* Authority */}
          <div>
            <Label>Regulatory Authority *</Label>
            <Select value={form.authority} onValueChange={v => set("authority", v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTHORITIES.map(a => (
                  <SelectItem key={a.value} value={a.value}>
                    <span className="flex items-center gap-2">
                      <a.icon className="h-3.5 w-3.5" /> {a.label} — {a.desc}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Certificate type */}
          <div>
            <Label>Certificate Type *</Label>
            <Select value={form.certificateType} onValueChange={v => set("certificateType", v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select or type below…" />
              </SelectTrigger>
              <SelectContent>
                {suggestedTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Allow free-text override */}
            <Input
              className="mt-1.5 text-sm"
              placeholder="Or type a custom certificate type"
              value={form.certificateType}
              onChange={e => set("certificateType", e.target.value)}
            />
          </div>

          {/* Title */}
          <div className="md:col-span-2">
            <Label>Certificate Title / Description *</Label>
            <Input
              className="mt-1.5"
              placeholder="e.g. NEMA EIA Licence — Westlands Mixed-Use Development"
              value={form.title}
              onChange={e => set("title", e.target.value)}
            />
          </div>

          {/* Certificate number */}
          <div>
            <Label>Certificate / Reference Number</Label>
            <Input
              className="mt-1.5 font-mono"
              placeholder="e.g. NEMA/EIA/2024/1234"
              value={form.certificateNumber}
              onChange={e => set("certificateNumber", e.target.value)}
            />
          </div>

          {/* Status */}
          <div>
            <Label>Status *</Label>
            <Select value={form.status} onValueChange={v => set("status", v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Issue date */}
          <div>
            <Label>Issue Date</Label>
            <Input
              type="date"
              className="mt-1.5"
              value={form.issueDate}
              onChange={e => set("issueDate", e.target.value)}
            />
          </div>

          {/* Expiry date */}
          <div>
            <Label>Expiry Date</Label>
            <Input
              type="date"
              className="mt-1.5"
              value={form.expiryDate}
              onChange={e => set("expiryDate", e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank if this certificate does not expire</p>
          </div>

          {/* Renewal date */}
          <div>
            <Label>Renewal Application Date</Label>
            <Input
              type="date"
              className="mt-1.5"
              value={form.renewalDate}
              onChange={e => set("renewalDate", e.target.value)}
            />
          </div>

          {/* Issuing office */}
          <div>
            <Label>Issuing Office</Label>
            <Input
              className="mt-1.5"
              placeholder="e.g. NEMA Nairobi Regional Office"
              value={form.issuingOffice}
              onChange={e => set("issuingOffice", e.target.value)}
            />
          </div>

          {/* Issuing officer */}
          <div>
            <Label>Issuing Officer</Label>
            <Input
              className="mt-1.5"
              placeholder="Officer name (optional)"
              value={form.issuingOfficer}
              onChange={e => set("issuingOfficer", e.target.value)}
            />
          </div>

          {/* Document URL */}
          <div className="md:col-span-2">
            <Label>Document URL</Label>
            <Input
              className="mt-1.5"
              placeholder="Link to scanned certificate (Google Drive, S3, etc.)"
              value={form.documentUrl}
              onChange={e => set("documentUrl", e.target.value)}
            />
          </div>

          {/* Conditions */}
          <div className="md:col-span-2">
            <Label>Conditions / Requirements</Label>
            <Textarea
              className="mt-1.5 min-h-[80px]"
              placeholder="Any conditions attached to this certificate by the regulatory authority…"
              value={form.conditions}
              onChange={e => set("conditions", e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="md:col-span-2">
            <Label>Internal Notes</Label>
            <Textarea
              className="mt-1.5 min-h-[60px]"
              placeholder="Internal tracking notes…"
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
            />
          </div>

        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.title.trim() || !form.certificateType.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
            {isEdit ? "Save Changes" : "Add Certificate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────

export function RegulatoryCompliancePanel({ propertyId, propertyName }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editCert, setEditCert]   = useState<RegulatoryCert | null>(null);
  const [deleteCert, setDeleteCert] = useState<RegulatoryCert | null>(null);
  const [filterAuth, setFilterAuth] = useState<string>("all");

  const { data: certs = [], isLoading, refetch } = useQuery<RegulatoryCert[]>({
    queryKey: [`/api/regulatory-certificates`, propertyId],
    queryFn: async () => {
      const res = await apiRequest(`/api/regulatory-certificates?propertyId=${propertyId}`);
      return res.json();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(`/api/regulatory-certificates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/regulatory-certificates`, propertyId] });
      toast({ title: "Certificate deleted" });
      setDeleteCert(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  // Computed stats
  const active       = certs.filter(c => c.status === "active" && !c.isExpired).length;
  const expiringSoon = certs.filter(c => c.isExpiringSoon && !c.isExpired).length;
  const expired      = certs.filter(c => c.isExpired || c.status === "expired").length;

  // Filter
  const filtered = filterAuth === "all" ? certs : certs.filter(c => c.authority === filterAuth);

  return (
    <div className="space-y-5">

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active",         value: active,        icon: ShieldCheck, cls: "text-emerald-600" },
          { label: "Expiring ≤ 90d", value: expiringSoon,  icon: ShieldAlert, cls: "text-amber-600"   },
          { label: "Expired",        value: expired,       icon: ShieldX,     cls: "text-red-600"     },
        ].map(s => (
          <Card key={s.label} className="text-center">
            <CardContent className="py-4">
              <s.icon className={`h-5 w-5 mx-auto mb-1 ${s.cls}`} />
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Expiry alert banner ── */}
      {expiringSoon > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {expiringSoon} certificate{expiringSoon > 1 ? "s" : ""} expiring within 90 days
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Email reminders are sent automatically at 90, 60, 30 and 7 days before expiry. Initiate renewals early — government agencies typically take 4–8 weeks.
            </p>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {["all", "NEMA", "NCA", "COUNTY", "FIRE", "OTHER"].map(a => (
            <button
              key={a}
              onClick={() => setFilterAuth(a)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterAuth === a
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {a === "all" ? "All" : a}
              {a !== "all" && ` (${certs.filter(c => c.authority === a).length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5 text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setEditCert(null); setShowModal(true); }}>
            <Plus className="h-4 w-4" /> Add Certificate
          </Button>
        </div>
      </div>

      {/* ── Certificate list ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="font-semibold text-muted-foreground mb-1">No certificates recorded</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-4">
              Add NEMA EIA licences, NCA project registrations, county building permits and other regulatory certificates to track compliance and receive expiry alerts.
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => { setEditCert(null); setShowModal(true); }}>
              <Plus className="h-4 w-4" /> Add First Certificate
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(cert => {
            const expiryUrgent = cert.isExpired || (cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 30);
            const borderCls =
              cert.isExpired                                               ? "border-l-red-500"  :
              cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 30 ? "border-l-amber-500" :
              cert.daysUntilExpiry !== null && cert.daysUntilExpiry <= 90 ? "border-l-yellow-400" :
                                                                            "border-l-emerald-500";

            return (
              <Card key={cert.id} className={`border-l-4 ${borderCls}`}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-3">

                    {/* Left: details */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <AuthorityChip authority={cert.authority} />
                        <StatusBadge status={cert.status} />
                        {cert.isExpiringSoon && !cert.isExpired && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs gap-1">
                            <AlertTriangle className="h-3 w-3" /> Expiring soon
                          </Badge>
                        )}
                      </div>

                      <div>
                        <p className="font-semibold text-foreground">{cert.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {cert.certificateType}
                          {cert.certificateNumber && <span className="font-mono ml-2">· {cert.certificateNumber}</span>}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        {cert.issueDate && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" /> Issued {fmt(cert.issueDate)}
                          </span>
                        )}
                        {cert.expiryDate && (
                          <span className={`flex items-center gap-1 ${expiryClass(cert)}`}>
                            <Clock className="h-3 w-3" /> {expiryLabel(cert)}
                          </span>
                        )}
                        {!cert.expiryDate && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="h-3 w-3" /> Does not expire
                          </span>
                        )}
                        {cert.issuingOffice && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Building className="h-3 w-3" /> {cert.issuingOffice}
                          </span>
                        )}
                      </div>

                      {cert.conditions && (
                        <div className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                          <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{cert.conditions}</p>
                        </div>
                      )}
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {cert.documentUrl && (
                        <a
                          href={cert.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          title="View document"
                        >
                          <FileText className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={() => { setEditCert(cert); setShowModal(true); }}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteCert(cert)}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── NEMA / NCA info box ── */}
      <Card className="bg-muted/30 dark:bg-muted/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-600" /> Kenya Regulatory Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">NEMA EIA:</strong> Environmental Impact Assessment licences are required under the Environmental Management and Coordination Act (EMCA 1999) for developments likely to affect the environment. Renew annually — submit via{" "}
            <a href="https://www.nema.go.ke" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">nema.go.ke <ExternalLink className="h-3 w-3" /></a>.
          </p>
          <p>
            <strong className="text-foreground">NCA:</strong> The National Construction Authority requires all building projects above KES 5M to be registered and supervised by NCA-certified contractors. Check status at{" "}
            <a href="https://www.nca.go.ke" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline inline-flex items-center gap-0.5">nca.go.ke <ExternalLink className="h-3 w-3" /></a>.
          </p>
          <p>
            <strong className="text-foreground">Alerts:</strong> Email reminders are sent to org managers at 90, 60, 30, and 7 days before each certificate expires. A daily scheduler runs at 07:45 EAT.
          </p>
        </CardContent>
      </Card>

      {/* ── Modals ── */}
      {showModal && (
        <CertModal
          propertyId={propertyId}
          cert={editCert}
          onClose={() => { setShowModal(false); setEditCert(null); }}
        />
      )}

      {deleteCert && (
        <AlertDialog open onOpenChange={() => setDeleteCert(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Certificate</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{deleteCert.title}</strong>? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                onClick={() => deleteMut.mutate(deleteCert.id)}
              >
                {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

export default RegulatoryCompliancePanel;
