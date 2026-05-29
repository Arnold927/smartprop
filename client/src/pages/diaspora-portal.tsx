/**
 * DiasporaBuyerPortal — /diaspora-portal
 *
 * Self-service portal for diaspora rent-to-own buyers.
 * Shows only the contracts linked to the logged-in buyer (buyerUserId = user.id).
 *
 * Tabs per contract:
 *   Overview       — KPIs: amount paid, remaining, completion %, next payment due
 *   Payments       — full payment history with currency conversion details
 *   Construction   — photo/video updates with progress timeline
 *   Schedule       — upcoming payment schedule
 *   Certificate    — digital ownership certificate(s) with QR + download
 *
 * All data is fetched from /api/diaspora-portal/* — buyer-scoped, read-only.
 */

import { useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useDarkModeContext } from "@/context/DarkModeContext";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWsEvent } from "@/hooks/useWebSocket";
import { format, formatDistanceToNow, isPast, differenceInDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Globe, Home, DollarSign, Calendar, TrendingUp, CheckCircle2,
  Clock, AlertCircle, FileText, Award, Camera, Image as ImageIcon,
  Download, QrCode, ChevronRight, Loader2, Building, MapPin,
  CreditCard, ArrowUpRight, Shield, Plane, ExternalLink, RefreshCw,
  Play, Info, MessageSquare, Send, File,
} from "lucide-react";
// import { TitleVerificationBadge } from "@/components/ui/title-verification-badge"; // Ardhisasa pending
import { PageShell, PageHeader, SectionCard, SPBadge, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};
const fmtMoney = (n: any, currency = "KES") =>
  `${currency} ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;
const fmtPct = (n: any) => `${Number(n ?? 0).toFixed(1)}%`;

function constructionLabel(status: string) {
  const MAP: Record<string, string> = {
    planning: "Planning", foundation: "Foundation", framing: "Framing",
    roofing: "Roofing", exterior: "Exterior", interior: "Interior",
    finishing: "Finishing", completed: "Completed",
  };
  return MAP[status] ?? status;
}

function statusColor(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (status === "active")    return "bg-emerald-100 text-blue-800 border-emerald-200";
  if (status === "suspended") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "cancelled") return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function paymentStatusColor(status: string) {
  if (status === "confirmed") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (status === "pending")   return "bg-amber-100 text-amber-800";
  if (status === "failed")    return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, icon: Icon, accent = false,
}: { label: string; value: string; sub?: string; icon: any; accent?: boolean }) {
  return (
    <Card className={accent ? "border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20" : ""}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`rounded-lg p-2 ${accent ? "bg-emerald-500/10" : "bg-muted"}`}>
            <Icon className={`h-5 w-5 ${accent ? "text-emerald-600" : "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{desc}</p>
    </div>
  );
}

// ─── Contract Overview Tab ────────────────────────────────────────────────────

function OverviewTab({ contract }: { contract: any }) {
  const pct   = Number(contract.completionPercentage ?? 0);
  const paid  = Number(contract.totalPaid ?? 0);
  const total = Number(contract.totalPropertyValue ?? 0);
  const rem   = Number(contract.remainingBalance ?? 0);
  const due   = contract.nextPaymentDue ? new Date(contract.nextPaymentDue) : null;
  const daysUntilDue = due ? differenceInDays(due, new Date()) : null;
  const isOverdue = due ? isPast(due) : false;

  return (
    <div className="space-y-6">
      {/* Property card */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex gap-4 items-start">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 p-3 shrink-0">
              <Building className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base truncate">{contract.propertyName ?? "Your Property"}</h3>
              {contract.propertyAddress && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {contract.propertyAddress}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="outline" className={statusColor(contract.status ?? "active")}>
                  {contract.status ?? "active"}
                </Badge>
                <Badge variant="outline">
                  {constructionLabel(contract.constructionStatus ?? "planning")}
                </Badge>
                {/* Title verification badge hidden — Ardhisasa API pending.
                    RESTORE: <TitleVerificationBadge
                      status={contract.titleVerificationStatus ?? "unverified"}
                      isSandbox={contract.titleVerificationIsSandbox}
                    /> */}
                <a
                  href="https://ardhisasa.lands.go.ke"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 font-medium"
                >
                  Verify title on Ardhisasa
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Total Paid"
          value={fmtMoney(paid, contract.currency)}
          sub={`of ${fmtMoney(total, contract.currency)}`}
          icon={CheckCircle2}
          accent
        />
        <KPICard
          label="Remaining"
          value={fmtMoney(rem, contract.currency)}
          sub={`${fmtPct(100 - pct)} left`}
          icon={TrendingUp}
        />
        <KPICard
          label="Completion"
          value={fmtPct(pct)}
          sub={`${contract.paymentsMade ?? 0} payments made`}
          icon={Calendar}
        />
        <KPICard
          label="Next Payment"
          value={due ? fmt(due) : "—"}
          sub={
            due
              ? isOverdue
                ? "⚠ Overdue"
                : `in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
              : undefined
          }
          icon={Clock}
        />
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Payment progress</span>
            <span className="text-sm font-bold text-emerald-600">{fmtPct(pct)}</span>
          </div>
          <Progress value={pct} className="h-3" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>KES 0</span>
            <span>{fmtMoney(total, contract.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Contract details */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Contract details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            ["Contract value",  fmtMoney(total, contract.currency)],
            ["Down payment",    fmtMoney(contract.downPayment, contract.currency)],
            ["Installment",     fmtMoney(contract.monthlyInstallment, contract.currency)],
            ["Frequency",       contract.paymentFrequency ?? "monthly"],
            ["Duration",        `${contract.contractDurationMonths ?? "—"} months`],
            ["Payment method",  contract.paymentMethod ?? "—"],
            ["Provider",        contract.internationalProvider ?? "—"],
            ["Contract signed", fmt(contract.contractSignedAt)],
            ["Start date",      fmt(contract.constructionStartDate)],
            ["Expected completion", fmt(contract.expectedCompletionDate)],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="font-medium">{val}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Next payment reminder */}
      {due && (
        <Card className={isOverdue ? "border-red-300 bg-red-50/30 dark:bg-red-950/10" : "border-amber-300 bg-amber-50/30 dark:bg-amber-950/10"}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              {isOverdue
                ? <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                : <Info className="h-5 w-5 text-amber-500 shrink-0" />
              }
              <div>
                <p className="text-sm font-semibold">
                  {isOverdue ? "Payment overdue" : "Upcoming payment"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtMoney(contract.monthlyInstallment, contract.currency)} due on {fmt(due)}
                  {" — "}{contract.internationalProvider} via {contract.paymentMethod}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legal doc link */}
      {contract.legalDocumentUrl && (
        <Button variant="outline" className="w-full gap-2" asChild>
          <a href={contract.legalDocumentUrl} target="_blank" rel="noopener noreferrer">
            <FileText className="h-4 w-4" />
            View contract document
            <ExternalLink className="h-3.5 w-3.5 ml-auto" />
          </a>
        </Button>
      )}
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ contractId }: { contractId: number }) {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["/api/diaspora-portal/payments", contractId],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-portal/contracts/${contractId}/payments`);
      return ensureArray(await r.json());
    },
  });

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!payments.length) return (
    <EmptyState icon={CreditCard} title="No payments yet" desc="Your payment history will appear here once your first installment is confirmed." />
  );

  return (
    <div className="space-y-3">
      {payments.map((p: any) => (
        <Card key={p.id}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">Payment #{p.paymentNumber}</span>
                  <Badge className={paymentStatusColor(p.status)}>{p.status}</Badge>
                </div>
                <p className="text-lg font-bold mt-0.5">
                  {fmtMoney(p.amount, p.currency)}
                  {p.originalCurrency && p.originalCurrency !== p.currency && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({p.originalAmount} {p.originalCurrency} @ {Number(p.exchangeRate ?? 1).toFixed(2)})
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmt(p.paymentDate)}</span>
                  <span>{p.internationalProvider} via {p.paymentMethod}</span>
                  {p.confirmationCode && <span>Ref: {p.confirmationCode}</span>}
                </div>
                {(Number(p.processingFee) > 0 || Number(p.exchangeFee) > 0) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Fees: {fmtMoney(Number(p.processingFee) + Number(p.exchangeFee), p.currency)}
                  </p>
                )}
              </div>
              {p.receiptUrl && (
                <Button variant="ghost" size="sm" className="shrink-0" asChild>
                  <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Construction Tab ─────────────────────────────────────────────────────────

function ConstructionTab({ contractId }: { contractId: number }) {
  const { data: updates = [], isLoading } = useQuery({
    queryKey: ["/api/diaspora-portal/construction", contractId],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-portal/contracts/${contractId}/construction`);
      return ensureArray(await r.json());
    },
  });

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!updates.length) return (
    <EmptyState icon={Camera} title="No updates yet" desc="Construction photo and progress updates from your project manager will appear here." />
  );

  return (
    <div className="space-y-4">
      {updates.map((u: any, i: number) => {
        const photos: string[] = Array.isArray(u.photoUrls) ? u.photoUrls : [];
        const videos: string[] = Array.isArray(u.videoUrls) ? u.videoUrls : [];

        return (
          <Card key={u.id}>
            <CardContent className="pt-5">
              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className="rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 p-1.5">
                    <Camera className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  {i < updates.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="font-semibold">{u.updateTitle}</h4>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{constructionLabel(u.constructionPhase)}</Badge>
                      <span className="text-xs text-muted-foreground">{fmt(u.createdAt)}</span>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="flex items-center gap-2 mt-1.5 mb-2">
                    <Progress value={Number(u.progressPercentage)} className="h-1.5 flex-1" />
                    <span className="text-xs font-medium shrink-0">{fmtPct(u.progressPercentage)}</span>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground">{u.updateDescription}</p>

                  {/* Milestone */}
                  {u.milestoneAchieved && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 rounded-md px-2 py-1 w-fit">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Milestone: {u.milestoneAchieved}</span>
                    </div>
                  )}
                  {u.nextMilestone && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Next: {u.nextMilestone}
                      {u.estimatedCompletionDate && ` — est. ${fmt(u.estimatedCompletionDate)}`}
                    </p>
                  )}

                  {/* Photos — click to open full size */}
                  {photos.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" /> Photos ({photos.length})
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {photos.map((url, idx) => (
                          <a key={idx} href={url} target="_blank" rel="noopener noreferrer"
                            className="relative aspect-video rounded-xl overflow-hidden bg-muted group block border border-border hover:border-emerald-400 dark:hover:border-emerald-600 transition-all">
                            <img
                              src={url}
                              alt={`Construction photo ${idx + 1}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Image unavailable</div>';
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="bg-white/90 rounded-full p-1">
                                <ExternalLink className="h-3 w-3 text-slate-700" />
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Videos — inline player */}
                  {videos.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                        <Play className="h-3 w-3" /> Videos ({videos.length})
                      </p>
                      <div className="space-y-3">
                        {videos.map((url, idx) => (
                          <div key={idx} className="rounded-xl overflow-hidden border border-border bg-black">
                            <video
                              src={url}
                              controls
                              preload="metadata"
                              className="w-full max-h-64 object-contain"
                              onError={(e) => {
                                const el = e.target as HTMLVideoElement;
                                el.outerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-2 p-3 text-sm text-emerald-600 hover:underline"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Video ${idx + 1} — click to open</a>`;
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Schedule Tab ─────────────────────────────────────────────────────────────

function ScheduleTab({ contractId, currency }: { contractId: number; currency: string }) {
  const { data: schedule = [], isLoading } = useQuery({
    queryKey: ["/api/diaspora-portal/schedule", contractId],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-portal/contracts/${contractId}/schedule`);
      return ensureArray(await r.json());
    },
  });

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!schedule.length) return (
    <EmptyState icon={Calendar} title="No schedule generated" desc="Your payment schedule will appear here once it has been generated by your property manager." />
  );

  return (
    <div className="space-y-2">
      {schedule.map((s: any) => {
        const sDate = s.scheduledDate ? new Date(s.scheduledDate) : null;
        const overdue = sDate && isPast(sDate) && !s.isPaid;
        return (
          <div key={s.id}
            className={`flex items-center gap-3 p-3 rounded-lg border text-sm
              ${s.isPaid ? "bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/10" : ""}
              ${overdue ? "bg-red-50/50 border-red-200 dark:bg-red-950/10" : ""}
              ${!s.isPaid && !overdue ? "bg-card border-border" : ""}
            `}
          >
            <div className="shrink-0">
              {s.isPaid
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : overdue
                  ? <AlertCircle className="h-4 w-4 text-red-500" />
                  : <Clock className="h-4 w-4 text-muted-foreground" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-medium">Payment #{s.paymentNumber}</span>
              <span className="text-muted-foreground ml-2">{fmt(sDate)}</span>
              {s.isPaid && s.paidDate && (
                <span className="text-xs text-emerald-600 ml-2">Paid {fmt(s.paidDate)}</span>
              )}
              {overdue && (
                <span className="text-xs text-red-600 ml-2">
                  {Math.abs(differenceInDays(sDate!, new Date()))} days overdue
                </span>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="font-semibold">{fmtMoney(s.amount, currency)}</p>
              {Number(s.lateFeeApplied) > 0 && (
                <p className="text-xs text-red-500">+{fmtMoney(s.lateFeeApplied, currency)} late fee</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Certificate Tab ──────────────────────────────────────────────────────────

function CertificateTab({ contractId }: { contractId: number }) {
  const { data: certs = [], isLoading } = useQuery({
    queryKey: ["/api/diaspora-portal/certificates", contractId],
    queryFn: async () => {
      const r = await apiRequest(`/api/diaspora-portal/contracts/${contractId}/certificates`);
      return ensureArray(await r.json());
    },
  });

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!certs.length) return (
    <EmptyState icon={Award} title="No certificates yet" desc="Your digital ownership certificate will appear here once issued by your property manager upon completion of payment milestones." />
  );

  return (
    <div className="space-y-4">
      {certs.map((c: any) => (
        <Card key={c.id} className="border-amber-300/50 bg-gradient-to-br from-amber-50/30 to-orange-50/30 dark:from-amber-950/10 dark:to-orange-950/10">
          <CardContent className="pt-5">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-amber-100 dark:bg-amber-900/30 p-3 shrink-0">
                <Award className="h-7 w-7 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-base capitalize">
                    {c.certificateType?.replace(/_/g, " ")} Certificate
                  </h3>
                  <Badge variant="outline" className={
                    c.status === "issued" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                    c.status === "pending" ? "bg-amber-100 text-amber-800" : ""
                  }>
                    {c.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">#{c.certificateNumber}</p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Issued:</span>
                    <span className="ml-1 font-medium">{fmt(c.issuedDate)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Network:</span>
                    <span className="ml-1 font-medium capitalize">{c.blockchainNetwork ?? "—"}</span>
                  </div>
                  {c.blockchainHash && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Hash:</span>
                      <span className="ml-1 font-mono text-xs break-all">{c.blockchainHash.slice(0, 32)}…</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  {c.verificationUrl && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                      <a href={c.verificationUrl} target="_blank" rel="noopener noreferrer">
                        <Shield className="h-3.5 w-3.5" />
                        Verify
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  {c.downloadUrl && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                      <a href={c.downloadUrl} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                  )}
                  {c.qrCode && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
                      <a href={c.qrCode} target="_blank" rel="noopener noreferrer">
                        <QrCode className="h-3.5 w-3.5" />
                        QR Code
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Contract detail (tabbed) ─────────────────────────────────────────────────

function ContractDetail({ contract, onBack, initialTab = "overview" }: {
  contract: any;
  onBack: () => void;
  initialTab?: string;
}) {
  // No tabs — the sidebar nav drives which section is shown.
  // initialTab comes from the URL param via the parent.
  const section = initialTab;

  return (
    <div className="space-y-4">
      {/* Breadcrumb back button */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 px-2">
          <ChevronRight className="h-4 w-4 rotate-180" />
          All Contracts
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold text-foreground truncate">{contract.propertyName ?? `Contract #${contract.id}`}</span>
      </div>

      {section === "overview"     && <OverviewTab contract={contract} />}
      {section === "payments"     && <PaymentsTab contractId={contract.id} />}
      {section === "construction" && <ConstructionTab contractId={contract.id} />}
      {section === "schedule"     && <ScheduleTab contractId={contract.id} currency={contract.currency ?? "KES"} />}
      {section === "certificate"  && <CertificateTab contractId={contract.id} />}
    </div>
  );
}

export default function DiasporaBuyerPortal() {
  const { user } = useAuth();
  const { theme } = useDarkModeContext();
  const isDarkMode = theme === "dark";
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Read section from URL params set by sidebar nav links ────────────────────
  // Sidebar links: /diaspora-portal (contracts), ?tab=payments, ?tab=construction,
  //                ?tab=schedule, ?tab=certificate, ?section=messages, ?section=documents
  const search = useSearch();
  const params = new URLSearchParams(search);
  const tabParam     = params.get("tab");
  const sectionParam = params.get("section");

  // Map URL params → active section
  const activeSection: string = sectionParam ?? tabParam ?? "contracts";

  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgContent, setMsgContent] = useState("");

  // ── Data fetching ────────────────────────────────────────────────────────────
  const { data: contracts = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/diaspora-portal/contracts"],
    queryFn: async () => {
      const r = await apiRequest("/api/diaspora-portal/contracts");
      return ensureArray(await r.json());
    },
  });

  const { data: messagesData, refetch: refetchMessages } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/diaspora-portal/messages"],
    queryFn: async () => {
      const r = await apiRequest("/api/diaspora-portal/messages");
      if (!r.ok) return { messages: [] };
      return r.json();
    },
    enabled: activeSection === "messages",
    refetchInterval: 30_000,
  });

  const { data: docsData } = useQuery<{ documents: any[] }>({
    queryKey: ["/api/diaspora-portal/documents"],
    queryFn: async () => {
      const r = await apiRequest("/api/diaspora-portal/documents");
      if (!r.ok) return { documents: [] };
      return r.json();
    },
    enabled: activeSection === "documents",
  });

  // ── Send message mutation ────────────────────────────────────────────────────
  const sendMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("/api/diaspora-portal/messages", {
        method: "POST",
        data: { subject: msgSubject, content: msgContent },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "Failed");
    },
    onSuccess: () => {
      toast({ title: "Message sent" });
      setMsgSubject("");
      setMsgContent("");
      setComposeOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/diaspora-portal/messages"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Real-time WebSocket events ───────────────────────────────────────────────
  useWsEvent("message:new", (payload: any) => {
    qc.invalidateQueries({ queryKey: ["/api/diaspora-portal/messages"] });
    toast({ title: "New message", description: payload.preview ?? payload.subject ?? "You have a new message" });
  });

  useWsEvent("broadcast", (payload: any) => {
    toast({ title: payload.title ?? "Notice", description: payload.message ?? "" });
  });

  useWsEvent("payment:confirmed", () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["/api/diaspora-portal/contracts"] });
  });

  // ── Data shortcuts ───────────────────────────────────────────────────────────
  const noContracts = !isLoading && contracts.length === 0;
  const msgs = messagesData?.messages ?? [];
  const docs = docsData?.documents ?? [];
  const unreadCount = msgs.filter((m: any) => !m.isOwn && !m.isRead).length;

  // Derive per-section content flag from URL
  const showContracts   = activeSection === "contracts" || (!tabParam && !sectionParam);
  const showPayments    = activeSection === "payments";
  const showConstruction= activeSection === "construction";
  const showSchedule    = activeSection === "schedule";
  const showCertificate = activeSection === "certificate";
  const showMessages    = activeSection === "messages";
  const showDocuments   = activeSection === "documents";

  // ── Selected contract → detail view ─────────────────────────────────────────
  if (selectedContract) {
    return (
      <PageShell>
        <ContractDetail
          contract={selectedContract}
          onBack={() => setSelectedContract(null)}
          initialTab={showPayments ? "payments" : showConstruction ? "construction" : showSchedule ? "schedule" : showCertificate ? "certificate" : "overview"}
        />
      </PageShell>
    );
  }

  // ── Portal shell ─────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageHeader
        icon={<Globe className="h-5 w-5" />}
        title="Diaspora Investor Portal"
        subtitle={`Welcome back, ${user?.firstName ?? "Investor"}. Track your property investment from anywhere in the world.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {/* Section driven by sidebar nav — no tab bar needed */}

      {/* ── CONTRACTS TAB ────────────────────────────────────────────────────── */}
      {showContracts && (
        <>
          {isLoading && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {noContracts && (
            <Card>
              <CardContent>
                <div className="flex flex-col items-center text-center py-12 space-y-3">
                  <Globe className="h-12 w-12 text-emerald-400/50" />
                  <p className="font-medium">No diaspora contracts linked</p>
                  {user?.role === "landlord" ? (
                    <>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        This section is for property owners who purchased via a <strong>rent-to-own scheme</strong> from
                        outside Kenya. If you have such a contract, ask your property manager to link it to your account.
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        If you are only a rental landlord and have no rent-to-own contract, you can ignore this section —
                        it does not affect your landlord portfolio or rental income.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Your diaspora rent-to-own contract will appear here once your property manager links your account.
                      </p>
                      <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm text-muted-foreground max-w-sm text-center">
                        <p>Logged in as <strong>{user?.email}</strong></p>
                        <p className="mt-1 text-xs">Share this email with your property manager so they can link your contract.</p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!isLoading && contracts.length > 0 && (
            <div className="space-y-4">
              {contracts.length > 1 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <KPICard label="Active contracts" value={String(contracts.filter((c: any) => c.status === "active").length)} icon={Globe} accent />
                  <KPICard label="Total invested" value={fmtMoney(contracts.reduce((s: number, c: any) => s + Number(c.totalPaid ?? 0), 0), "KES")} icon={DollarSign} />
                  <KPICard label="Total value" value={fmtMoney(contracts.reduce((s: number, c: any) => s + Number(c.totalPropertyValue ?? 0), 0), "KES")} icon={TrendingUp} />
                  <KPICard label="Avg completion" value={fmtPct(contracts.reduce((s: number, c: any) => s + Number(c.completionPercentage ?? 0), 0) / contracts.length)} icon={CheckCircle2} />
                </div>
              )}

              {contracts.map((contract: any) => {
                const pct = Number(contract.completionPercentage ?? 0);
                const due = contract.nextPaymentDue ? new Date(contract.nextPaymentDue) : null;
                const overdue = due ? isPast(due) : false;

                return (
                  <Card
                    key={contract.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedContract(contract)}
                  >
                    <CardContent className="pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-base truncate">
                              {contract.propertyName ?? `Contract #${contract.id}`}
                            </h3>
                            <Badge variant="outline" className={statusColor(contract.status ?? "active")}>
                              {contract.status ?? "active"}
                            </Badge>
                            {overdue && (
                              <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                Payment overdue
                              </Badge>
                            )}
                          </div>

                          {contract.propertyAddress && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {contract.propertyAddress}
                            </p>
                          )}

                          <div className="flex items-center gap-2 mb-3">
                            <Progress value={pct} className="h-2 flex-1" />
                            <span className="text-xs font-medium shrink-0">{fmtPct(pct)}</span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Paid: <strong className="text-foreground">{fmtMoney(contract.totalPaid, contract.currency)}</strong></span>
                            <span>Remaining: <strong className="text-foreground">{fmtMoney(contract.remainingBalance, contract.currency)}</strong></span>
                            <span>Next due: <strong className={overdue ? "text-red-600" : "text-foreground"}>{fmt(due)}</strong></span>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── PAYMENTS / CONSTRUCTION / SCHEDULE / CERTIFICATE sections ──────── */}
      {/* These show when the user clicks a specific nav link while on a contract */}
      {(showPayments || showConstruction || showSchedule || showCertificate) && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : contracts.length === 0 ? (
            <Card><CardContent className="flex flex-col items-center py-12 text-center space-y-3">
              <Globe className="h-10 w-10 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">No contracts linked yet.</p>
            </CardContent></Card>
          ) : contracts.length === 1 ? (
            // Single contract — show the relevant tab directly
            <ContractDetail
              contract={contracts[0]}
              onBack={() => { window.location.href = "/diaspora-portal"; }}
              initialTab={showPayments ? "payments" : showConstruction ? "construction" : showSchedule ? "schedule" : "certificate"}
            />
          ) : (
            // Multiple contracts — let user pick one first
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Select a contract to view:</p>
              {contracts.map((c: any) => (
                <Card key={c.id} className="cursor-pointer border-border hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-sm transition-all" onClick={() => setSelectedContract(c)}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{c.propertyName ?? `Contract #${c.id}`}</p>
                      <p className="text-xs text-muted-foreground">{c.constructionStatus} · {fmtPct(c.completionPercentage)} complete</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MESSAGES TAB ─────────────────────────────────────────────────────── */}
      {showMessages && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-1">Message your Property Manager</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70 mb-3">Ask about your contract, payment confirmations, construction updates, or any concerns.</p>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-medium"
              onClick={() => setComposeOpen(true)}
            >
              <MessageSquare className="w-4 h-4" /> New Message
            </Button>
          </div>

          {composeOpen && (
            <Card>
              <CardContent className="pt-5 space-y-3">
                <p className="text-sm font-semibold">New Message</p>
                <Input
                  placeholder="Subject"
                  value={msgSubject}
                  onChange={e => setMsgSubject(e.target.value)}
                  className="bg-background border-border"
                />
                <Textarea
                  placeholder="Write your message…"
                  value={msgContent}
                  onChange={e => setMsgContent(e.target.value)}
                  className="bg-background border-border min-h-[100px]"
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground" onClick={() => setComposeOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1"
                    disabled={!msgContent.trim() || sendMut.isPending}
                    onClick={() => sendMut.mutate()}
                  >
                    {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Send
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {msgs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center space-y-3">
                <MessageSquare className="h-10 w-10 text-emerald-400/50" />
                <p className="font-medium text-foreground">No messages yet</p>
                <p className="text-sm text-muted-foreground">Use the button above to send your first message to your property manager.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {msgs.map((msg: any) => (
                <div
                  key={msg.id}
                  className={`rounded-2xl border p-4 ${
                    msg.isOwn
                      ? "bg-emerald-950/20 border-emerald-800/30 ml-6"
                      : "bg-card border-border mr-6"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        msg.isOwn ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                      }`}>
                        {(msg.isOwn ? "Me" : msg.fromName).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-medium">{msg.isOwn ? "You" : msg.fromName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {msg.createdAt ? format(new Date(msg.createdAt), "dd MMM yyyy, h:mm a") : "—"}
                        </p>
                      </div>
                    </div>
                    {!msg.isOwn && !msg.isRead && (
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-full px-2 py-0.5">New</span>
                    )}
                  </div>
                  {msg.subject && (
                    <p className="text-xs text-muted-foreground font-medium mb-1">{msg.subject}</p>
                  )}
                  <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENTS TAB ────────────────────────────────────────────────────── */}
      {showDocuments && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 mb-2">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-0.5">Shared Documents</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">Contracts, certificates, title documents, and progress reports shared by your property manager.</p>
          </div>

          {docs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center space-y-3">
                <FileText className="h-10 w-10 text-emerald-400/50" />
                <p className="font-medium text-foreground">No documents yet</p>
                <p className="text-sm text-muted-foreground max-w-xs">Your property manager will share title deeds, contracts, progress reports, and certificates here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {docs.map((doc: any) => (
                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-muted transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <File className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {doc.type ?? "document"}
                      {doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ""}
                      {doc.createdAt ? ` · ${format(new Date(doc.createdAt), "dd MMM yyyy")}` : ""}
                    </p>
                  </div>
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                    title="Download"
                    onClick={e => e.stopPropagation()}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}