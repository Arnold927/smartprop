/**
 * NairobiCompliance — /compliance
 *
 * Dashboard for Nairobi mid-to-high-end market compliance requirements:
 *   1. ARMA Service Charges  — budget vs actuals, sinking fund, demand notices
 *   2. KRA Rental Returns    — monthly P9-equivalent, WHT (10% resident / 30% non-resident), VAT (16%)
 *   3. Stamp Duty Tracker    — residential leases > 3 years, commercial leases > 2 years (Stamp Duty Act Cap 480)
 *   4. Property Valuations   — CGT-ready valuation history (CGT rate 15% per Finance Act 2023)
 *   5. Deposit Interest      — CBK-rate accrual on security deposits (Landlord & Tenant Act)
 *   6. eTIMS                 — KRA e-invoicing for VAT-registered landlords
 *   7. RRT Notices           — Rent Restriction Tribunal notices (Cap 296)
 */

import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInMonths } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

import {
  Building, DollarSign, FileText, TrendingUp, Shield, AlertCircle,
  CheckCircle2, Clock, Loader2, PiggyBank, Calculator, BookOpen,
  Award, BarChart3, RefreshCw, Plus, Download, Pencil, ChevronRight,
  Info, AlertTriangle, Zap, Send, Settings2, Eye, Copy, Gavel,
  Banknote, FilePlus, SquareChevronRight,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: any) => d ? format(new Date(d), "dd MMM yyyy") : "—";
const fmtKES = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;
const fmtPct = (n: any, d = 1) => `${Number(n ?? 0).toFixed(d)}%`;

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "paid" || status === "compliant" || status === "approved" || status === "filed" || status === "acknowledged"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
    : status === "pending" || status === "draft"
      ? "bg-amber-100 text-amber-800 border-amber-200"
    : status === "overdue" || status === "flagged"
      ? "bg-red-100 text-red-800 border-red-200"
    : "bg-gray-100 text-muted-foreground border-gray-200";
  return <Badge variant="outline" className={color}>{status}</Badge>;
}

// ─── Shared print/download helper ─────────────────────────────────────────────
// Opens a new tab with the provided HTML and triggers the browser print dialog.
// The user can then "Save as PDF" from their browser's print dialog.
function printDoc(html: string, title: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><title>${title}</title>
    <style>
      @media print { .no-print { display:none!important; } body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
    </style>
  </head><body>${html}
    <div class="no-print" style="position:fixed;bottom:24px;right:24px;display:flex;gap:8px;z-index:9999;">
      <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        ⬇ Save as PDF
      </button>
      <button onclick="window.close()" style="background:#334155;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-size:14px;cursor:pointer">
        ✕
      </button>
    </div>
  </body></html>`);
  w.document.close();
}

// ─── KRA Return HTML builder ───────────────────────────────────────────────────
function buildKraReturnHtml(r: any, MONTHS: string[]): string {
  const fmtN = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;
  const periodLabel = `${MONTHS[(r.returnMonth ?? 1) - 1]} ${r.returnYear}`;
  const rows = [
    { label: "Gross Rental Income", value: fmtN(r.grossRent), bold: false },
    ...(Number(r.allowableDeductions) > 0
      ? [{ label: "Less: Allowable Deductions (ITA s.15)", value: `–${fmtN(r.allowableDeductions)}`, bold: false, color: "#059669" }]
      : []),
    { label: "Net Taxable Income", value: fmtN(r.netIncome), bold: true },
    { label: `WHT Withheld at Source (${Number(r.whtRate ?? 10).toFixed(1)}%)`, value: `–${fmtN(r.whtAmount)}`, bold: false, color: "#d97706" },
    { label: "Net Rental Income Received", value: fmtN(Number(r.grossRent) - Number(r.whtAmount)), bold: false, color: "#64748b" },
    ...(r.vatApplicable ? [{ label: "VAT Collected (16%)", value: fmtN(r.vatAmount), bold: false }] : []),
  ];
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:40px 44px;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:28px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#059669;letter-spacing:-0.5px;">Smart<span style="color:#0f172a;">Prop</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Property Management Platform</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#64748b;text-transform:uppercase;">KRA Rental Income Return</div>
          <div style="font-size:20px;font-weight:700;margin-top:2px;">${periodLabel}</div>
          <div style="margin-top:6px;display:inline-block;background:${r.status === "filed" ? "#f0fdf4" : "#fefce8"};border:2px solid ${r.status === "filed" ? "#059669" : "#ca8a04"};border-radius:6px;padding:2px 12px;font-size:11px;font-weight:700;color:${r.status === "filed" ? "#065f46" : "#92400e"};text-transform:uppercase;letter-spacing:1px;">
            ${r.status}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;">
        <div style="background:#f0fdf4;border-radius:8px;padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#059669;text-transform:uppercase;margin-bottom:10px;">Return Details</div>
          <div style="font-size:13px;margin-bottom:5px;"><span style="color:#64748b;">Period:</span> <strong>${periodLabel}</strong></div>
          <div style="font-size:13px;margin-bottom:5px;"><span style="color:#64748b;">Filing status:</span> <strong style="text-transform:capitalize">${r.status}</strong></div>
          ${r.filedAt ? `<div style="font-size:13px;margin-bottom:5px;"><span style="color:#64748b;">Filed on:</span> <strong>${new Date(r.filedAt).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"})}</strong></div>` : ""}
          ${r.acknowledgementRef ? `<div style="font-size:13px;"><span style="color:#64748b;">KRA Ack. Ref:</span> <strong style="font-family:monospace">${r.acknowledgementRef}</strong></div>` : ""}
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:14px 18px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:10px;">WHT Rate Applied</div>
          <div style="font-size:28px;font-weight:800;color:#0f172a;">${Number(r.whtRate ?? 10).toFixed(0)}%</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">${Number(r.whtRate ?? 10) === 30 ? "Non-resident landlord" : "Resident landlord"}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">Income Tax Act Cap 470 s.35</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Tax Computation</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tbody>
            ${rows.map(row => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px 0;color:${(row as any).color || "#334155"}">${row.label}</td>
                <td style="padding:8px 0;text-align:right;font-family:monospace;font-weight:${row.bold ? "700" : "400"};color:${(row as any).color || (row.bold ? "#0f172a" : "#334155")}">${row.value}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin-top:12px;font-size:11px;color:#1d4ed8;">
          <strong>Note:</strong> WHT is withheld at source by the tenant before remitting rent (ITA Cap 470 s.35).
          It is a tax credit applied against your rental income tax liability, not a deduction from taxable income.
        </div>
      </div>

      ${r.deductionNotes ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:8px;">Deduction Notes</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;font-size:12px;color:#475569;font-style:italic;">${r.deductionNotes}</div>
      </div>` : ""}

      <div style="margin-top:36px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.7;">
        Generated by SmartProp Property Management &nbsp;|&nbsp; ${periodLabel} Rental Income Return<br>
        <span style="font-style:italic;">Reference: Income Tax Act Cap 470 (Kenya) — For filing via KRA iTax portal</span>
      </div>
    </div>`;
}

// ─── Stamp Duty PDF builder ────────────────────────────────────────────────────
function buildStampDutyHtml(l: any): string {
  const totalRent = Number(l.monthlyRent) * Number(l.leaseDurationMonths);
  const duty = l.stampDutyAmount ?? l.computedStampDuty;
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:40px 44px;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:28px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#059669;">Smart<span style="color:#0f172a;">Prop</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Property Management Platform</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Stamp Duty Record</div>
          <div style="font-size:18px;font-weight:700;margin-top:2px;">${l.leaseNumber}</div>
          <div style="margin-top:6px;display:inline-block;background:${l.stampDutyPaid ? "#f0fdf4" : "#fefce8"};border:2px solid ${l.stampDutyPaid ? "#059669" : "#ca8a04"};border-radius:6px;padding:2px 12px;font-size:11px;font-weight:700;color:${l.stampDutyPaid ? "#065f46" : "#92400e"};text-transform:uppercase;letter-spacing:1px;">
            ${l.stampDutyPaid ? "PAID" : "PENDING"}
          </div>
        </div>
      </div>
      <div style="background:#f0fdf4;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#059669;text-transform:uppercase;margin-bottom:10px;">Lease Details</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
          <div><span style="color:#64748b;">Lease Number:</span> <strong>${l.leaseNumber}</strong></div>
          <div><span style="color:#64748b;">Type:</span> <strong>${l.isCommercial ? "Commercial" : "Residential"}</strong></div>
          <div><span style="color:#64748b;">Duration:</span> <strong>${l.leaseDurationMonths} months</strong></div>
          <div><span style="color:#64748b;">Monthly Rent:</span> <strong>KES ${Number(l.monthlyRent).toLocaleString("en-KE")}</strong></div>
          <div><span style="color:#64748b;">Start Date:</span> <strong>${l.startDate ? new Date(l.startDate).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—"}</strong></div>
          <div><span style="color:#64748b;">End Date:</span> <strong>${l.endDate ? new Date(l.endDate).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—"}</strong></div>
        </div>
      </div>
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Stamp Duty Computation — Stamp Duty Act Cap 480</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tbody>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Monthly Rent</td><td style="padding:8px 0;text-align:right;font-family:monospace;">KES ${Number(l.monthlyRent).toLocaleString("en-KE")}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Lease Duration</td><td style="padding:8px 0;text-align:right;">${l.leaseDurationMonths} months</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Total Rent Payable</td><td style="padding:8px 0;text-align:right;font-family:monospace;">KES ${totalRent.toLocaleString("en-KE")}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Rate (Cap 480)</td><td style="padding:8px 0;text-align:right;">1%</td></tr>
            <tr style="background:#f0fdf4;"><td style="padding:10px 0;font-weight:700;">Stamp Duty Due</td><td style="padding:10px 0;text-align:right;font-family:monospace;font-weight:700;font-size:16px;color:#059669;">KES ${Number(duty).toLocaleString("en-KE")}</td></tr>
          </tbody>
        </table>
      </div>
      ${l.stampDutyPaid ? `
      <div style="background:#f0fdf4;border:2px solid #059669;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#059669;text-transform:uppercase;margin-bottom:10px;">Payment Record</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
          ${l.stampDutyPaidDate ? `<div><span style="color:#64748b;">Date Paid:</span> <strong>${new Date(l.stampDutyPaidDate).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"})}</strong></div>` : ""}
          ${l.stampDutyKraRef ? `<div><span style="color:#64748b;">KRA Reference:</span> <strong style="font-family:monospace">${l.stampDutyKraRef}</strong></div>` : ""}
        </div>
      </div>` : `
      <div style="background:#fefce8;border:2px solid #ca8a04;border-radius:8px;padding:14px 18px;margin-bottom:24px;font-size:12px;color:#92400e;">
        <strong>Payment pending.</strong> Pay via KRA iTax portal → Stamp Duty → Assessment Form.
        Upload the receipt in SmartProp to mark this lease as compliant.
      </div>`}
      <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
        Generated by SmartProp &nbsp;|&nbsp; Stamp Duty Act Cap 480, Laws of Kenya
      </div>
    </div>`;
}

// ─── Deposit Interest PDF builder ─────────────────────────────────────────────
function buildDepositInterestHtml(leaseId: string, data: any, cbkRate: any): string {
  const accruals = Array.isArray(data?.accruals) ? data.accruals : [];
  const fmt2 = (n: any) => `KES ${Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:40px 44px;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:28px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#059669;">Smart<span style="color:#0f172a;">Prop</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Property Management Platform</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Deposit Interest Statement</div>
          <div style="font-size:16px;font-weight:700;margin-top:2px;">Lease #${leaseId}</div>
          <div style="font-size:11px;color:#64748b;margin-top:3px;">Generated ${new Date().toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"})}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:28px;">
        ${[
          { label: "Total Accrued", value: fmt2(data?.totalAccrued), color: "#0f172a" },
          { label: "Total Settled", value: fmt2(data?.totalSettled), color: "#059669" },
          { label: "Outstanding", value: fmt2(data?.totalOutstanding), color: data?.totalOutstanding > 0 ? "#d97706" : "#059669" },
        ].map(s => `
          <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;text-align:center;">
            <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:6px;">${s.label}</div>
            <div style="font-size:20px;font-weight:800;color:${s.color};">${s.value}</div>
          </div>`).join("")}
      </div>
      <div style="margin-bottom:8px;font-size:11px;color:#64748b;font-style:italic;">
        CBK rate: ${cbkRate ? `${cbkRate.rate}% (effective ${new Date(cbkRate.effectiveDate).toLocaleDateString("en-KE",{day:"2-digit",month:"short",year:"numeric"})})` : "see accrual records"} —
        Formula: Interest = Deposit × Rate × Days / 365 (Landlord &amp; Tenant Act Cap 301)
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f0fdf4;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#059669;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5;">Period</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Deposit</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Rate</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Days</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Interest</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Cumulative</th>
            <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #d1fae5;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${accruals.map((a: any, i: number) => `
            <tr style="border-bottom:1px solid #f1f5f9;background:${a.isSettled ? "#f0fdf4" : (i % 2 === 0 ? "#fff" : "#f8fafc")};">
              <td style="padding:7px 10px;color:#334155;">${a.periodStart} – ${a.periodEnd}</td>
              <td style="padding:7px 10px;text-align:right;font-family:monospace;">KES ${Number(a.depositBalance).toLocaleString("en-KE")}</td>
              <td style="padding:7px 10px;text-align:right;">${a.cbkRate}%</td>
              <td style="padding:7px 10px;text-align:right;">${a.daysInPeriod}</td>
              <td style="padding:7px 10px;text-align:right;font-family:monospace;font-weight:600;">${fmt2(a.interestAmount)}</td>
              <td style="padding:7px 10px;text-align:right;font-family:monospace;color:#64748b;">${fmt2(a.cumulativeInterest)}</td>
              <td style="padding:7px 10px;text-align:center;font-size:11px;color:${a.isSettled ? "#059669" : "#d97706"};font-weight:600;">${a.isSettled ? "Settled" : "Pending"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
        Generated by SmartProp &nbsp;|&nbsp; Landlord &amp; Tenant (Shops, Hotels &amp; Catering Establishments) Act Cap 301 &nbsp;|&nbsp; Central Bank of Kenya Base Rate
      </div>
    </div>`;
}

// ─── CGT / Valuation PDF builder ──────────────────────────────────────────────
function buildCgtHtml(propertyName: string, cgt: any, valuations: any[]): string {
  const fmt2 = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:40px 44px;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:28px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#059669;">Smart<span style="color:#0f172a;">Prop</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Property Management Platform</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Capital Gains Tax Record</div>
          <div style="font-size:17px;font-weight:700;margin-top:2px;">${propertyName}</div>
          <div style="font-size:11px;color:#64748b;margin-top:3px;">Finance Act 2023 — CGT 15%</div>
        </div>
      </div>
      ${cgt && cgt.cgt !== null ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">CGT Computation</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tbody>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Acquisition Date</td><td style="padding:8px 0;text-align:right;">${cgt.acquisitionDate ? new Date(cgt.acquisitionDate).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—"}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Cost Base (purchase + improvements)</td><td style="padding:8px 0;text-align:right;font-family:monospace;">${fmt2(cgt.costBase)}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Disposal Date</td><td style="padding:8px 0;text-align:right;">${cgt.disposalDate ? new Date(cgt.disposalDate).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"}) : "—"}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Disposal Value</td><td style="padding:8px 0;text-align:right;font-family:monospace;">${fmt2(cgt.disposalValue)}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">Net Capital Gain</td><td style="padding:8px 0;text-align:right;font-family:monospace;color:${cgt.gain > 0 ? "#d97706" : "#059669"};font-weight:600;">${fmt2(cgt.gain)}</td></tr>
            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;">CGT Rate (Finance Act 2023)</td><td style="padding:8px 0;text-align:right;">${cgt.cgtRate ?? 15}%</td></tr>
            <tr style="background:${cgt.cgtLiability > 0 ? "#fff1f2" : "#f0fdf4"};"><td style="padding:10px 0;font-weight:700;color:${cgt.cgtLiability > 0 ? "#dc2626" : "#059669"};">CGT Liability</td><td style="padding:10px 0;text-align:right;font-family:monospace;font-weight:700;font-size:16px;color:${cgt.cgtLiability > 0 ? "#dc2626" : "#059669"};">${fmt2(cgt.cgtLiability)}</td></tr>
          </tbody>
        </table>
        ${cgt.cgtLiability > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;margin-top:12px;font-size:12px;color:#dc2626;">
          ⚠ KRA CGT return must be filed and tax paid within <strong>30 days</strong> of disposal via KRA iTax.
        </div>` : ""}
      </div>` : `<div style="background:#f0fdf4;border-radius:8px;padding:16px;margin-bottom:24px;font-size:13px;color:#334155;">${cgt?.note ?? cgt?.message ?? "CGT not yet applicable — record a disposal valuation to compute liability."}</div>`}
      <div style="margin-bottom:8px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">Valuation History</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f0fdf4;font-size:10px;font-weight:700;color:#059669;text-transform:uppercase;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5;">Date</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5;">Type</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #d1fae5;">Market Value</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1fae5;">Valuer</th>
          </tr></thead>
          <tbody>
            ${valuations.map((v: any, i: number) => `
              <tr style="border-bottom:1px solid #f1f5f9;background:${i%2===0?"#fff":"#f8fafc"};">
                <td style="padding:7px 10px;">${v.valuationDate ? new Date(v.valuationDate).toLocaleDateString("en-KE",{day:"2-digit",month:"short",year:"numeric"}) : "—"}</td>
                <td style="padding:7px 10px;text-transform:capitalize;">${(v.valuationType||"").replace(/_/g," ")}</td>
                <td style="padding:7px 10px;text-align:right;font-family:monospace;font-weight:600;">${fmt2(v.marketValue)}</td>
                <td style="padding:7px 10px;font-size:11px;color:#64748b;">${v.valuerName ?? "—"}${v.valuerFirm ? ` · ${v.valuerFirm}` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
        Generated by SmartProp &nbsp;|&nbsp; Finance Act 2023 — Capital Gains Tax 15% &nbsp;|&nbsp; File via KRA iTax
      </div>
    </div>`;
}

// ─── eTIMS Submissions CSV export ─────────────────────────────────────────────
function downloadEtimsCsv(submissions: any[]) {
  const headers = ["Invoice No","Customer","Amount (KES)","VAT (KES)","KRA Receipt No","Status","Submitted At"];
  const rows = submissions.map((s: any) => [
    s.invcNo ?? "",
    s.custNm ?? "",
    Number(s.totAmt ?? 0).toFixed(2),
    Number(s.totTaxAmt ?? 0).toFixed(2),
    s.rcptNo ?? "",
    s.status ?? "",
    s.submittedAt ? new Date(s.submittedAt).toLocaleString("en-KE") : "",
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `etims-submissions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}


function StampDutyLeaseCard({ l, editing, setEditing, form, setForm, update }: any) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className={l.stampDutyPaid ? "border-emerald-200" : "border-amber-200"}>
      <CardContent className="pt-4">
        {/* Summary row */}
        <div
          className="flex items-start justify-between gap-3 flex-wrap cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{l.leaseNumber} — {l.leaseDurationMonths} months</p>
              {l.isCommercial && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Commercial</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {fmt(l.startDate)} → {fmt(l.endDate)} · Monthly rent: {fmtKES(l.monthlyRent)}
            </p>
            <p className="text-sm mt-1">
              Stamp duty: <strong className="text-foreground">{fmtKES(l.stampDutyAmount ?? l.computedStampDuty)}</strong>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={l.stampDutyPaid ? "paid" : "pending"} />
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-4 border-t pt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stamp Duty Calculation</p>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Monthly rent</td><td className="px-3 py-2 text-right font-mono">{fmtKES(l.monthlyRent)}</td></tr>
                    <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Lease duration</td><td className="px-3 py-2 text-right">{l.leaseDurationMonths} months</td></tr>
                    <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Total rent payable</td><td className="px-3 py-2 text-right font-mono">{fmtKES(Number(l.monthlyRent) * l.leaseDurationMonths)}</td></tr>
                    <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Rate (Cap 480)</td><td className="px-3 py-2 text-right">1%</td></tr>
                    <tr className="bg-muted/30"><td className="px-3 py-2 font-semibold">Computed stamp duty</td><td className="px-3 py-2 text-right font-bold font-mono">{fmtKES(l.computedStampDuty)}</td></tr>
                    {l.stampDutyAmount && l.stampDutyAmount !== l.computedStampDuty && (
                      <tr className="bg-blue-50/50"><td className="px-3 py-2 text-blue-700">Overridden amount</td><td className="px-3 py-2 text-right font-bold font-mono text-blue-700">{fmtKES(l.stampDutyAmount)}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {(l.stampDutyKraRef || l.stampDutyPaidDate || l.stampDutyReceiptUrl) && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {l.stampDutyKraRef && <div><p className="text-xs text-muted-foreground">KRA Assessment Ref</p><p className="font-mono font-medium">{l.stampDutyKraRef}</p></div>}
                {l.stampDutyPaidDate && <div><p className="text-xs text-muted-foreground">Date paid</p><p className="font-medium">{fmt(l.stampDutyPaidDate)}</p></div>}
                {l.stampDutyReceiptUrl && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Receipt</p>
                    <a href={l.stampDutyReceiptUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs break-all">{l.stampDutyReceiptUrl}</a>
                  </div>
                )}
              </div>
            )}

            {editing === l.id ? (
              <div className="grid grid-cols-2 gap-3 border-t pt-4">
                <div><Label className="text-xs">Stamp duty amount (KES)</Label><Input type="number" value={form.stampDutyAmount ?? ""} onChange={e => setForm((f: any) => ({ ...f, stampDutyAmount: e.target.value }))} /></div>
                <div><Label className="text-xs">KRA Assessment / Payment Reference</Label><Input value={form.stampDutyKraRef ?? ""} onChange={e => setForm((f: any) => ({ ...f, stampDutyKraRef: e.target.value }))} /></div>
                <div><Label className="text-xs">Date paid</Label><Input type="date" value={form.stampDutyPaidDate ?? ""} onChange={e => setForm((f: any) => ({ ...f, stampDutyPaidDate: e.target.value }))} /></div>
                <div><Label className="text-xs">Receipt URL</Label><Input value={form.stampDutyReceiptUrl ?? ""} onChange={e => setForm((f: any) => ({ ...f, stampDutyReceiptUrl: e.target.value }))} /></div>
                <div className="col-span-2 flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => update.mutate({ ...form, stampDutyPaid: !!(form.stampDutyPaidDate) })} disabled={update.isPending}>
                    {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center border-t pt-3">
                <Button variant="outline" size="sm" onClick={() =>
                  printDoc(buildStampDutyHtml(l), `Stamp Duty — ${l.leaseNumber}`)
                }>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Download PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setEditing(l.id);
                  setForm({ id: l.id, stampDutyAmount: l.stampDutyAmount ?? l.computedStampDuty });
                }}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />Update payment details
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stamp Duty Tab ───────────────────────────────────────────────────────────
// Under Stamp Duty Act Cap 480 (Kenya):
//   - Residential leases > 3 years (36 months): 1% of total rent payable
//   - Commercial leases  > 2 years (24 months): 1% of total rent payable
// Payment is via KRA iTax portal (stamp duty assessment form).

function StampDutyTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});

  const { data: leases = [], isLoading } = useQuery({
    queryKey: ["/api/compliance/stamp-duty"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/compliance/stamp-duty")).json()),
  });

  const update = useMutation({
    mutationFn: (vars: any) =>
      apiRequest(`/api/compliance/stamp-duty/${vars.id}`, { method: "PATCH", data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/stamp-duty"] });
      setEditing(null);
      toast({ title: "Stamp duty record updated" });
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  // Separate residential vs commercial for display
  const residential = leases.filter((l: any) => !l.isCommercial);
  const commercial   = leases.filter((l: any) => l.isCommercial);

  const renderLease = (l: any) => (
    <StampDutyLeaseCard
      key={l.id}
      l={l}
      editing={editing}
      setEditing={setEditing}
      form={form}
      setForm={setForm}
      update={update}
    />
  );

  return (
    <div className="space-y-4">
      {/* Legal basis notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-amber-800 space-y-1">
          <p>
            <strong>Stamp Duty Act (Cap 480, Laws of Kenya)</strong> requires stamp duty on leases as follows:
          </p>
          <ul className="list-disc ml-4 space-y-0.5 text-xs">
            <li><strong>Residential leases exceeding 3 years (36 months)</strong> — 1% of total rent payable over the lease term. Mark a lease as "Residential" in the system.</li>
            <li><strong>Commercial leases exceeding 2 years (24 months)</strong> — 1% of total rent payable over the lease term. Mark a lease as "Commercial" in the system.</li>
          </ul>
          <p className="text-xs mt-1">Pay via KRA iTax portal → Stamp Duty → Assessment Form. Upload the assessment receipt below. Stamp duty must be paid before the lease is presented for registration.</p>
        </div>
      </div>

      {!leases.length && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No leases requiring stamp duty found in the system.
        </CardContent></Card>
      )}

      {residential.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Residential (&gt;36 months)</p>
          <div className="space-y-3">{residential.map(renderLease)}</div>
        </div>
      )}

      {commercial.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Commercial (&gt;24 months)</p>
          <div className="space-y-3">{commercial.map(renderLease)}</div>
        </div>
      )}
    </div>
  );
}

// ─── KRA Return expandable card ───────────────────────────────────────────────
function KraReturnCard({ r, MONTHS, filingRefs, setFilingRefs, markFiled }: any) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className={r.status === "filed" || r.status === "acknowledged" ? "border-emerald-200" : r.status === "draft" ? "border-amber-200" : ""}>
      <CardContent className="pt-4">
        {/* Summary row — always visible */}
        <div
          className="flex items-center justify-between gap-2 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-3">
            <div>
              <p className="font-semibold">{MONTHS[(r.returnMonth ?? 1) - 1]} {r.returnYear}</p>
              <p className="text-sm text-muted-foreground">
                Gross rent: <span className="font-medium text-foreground">{fmtKES(r.grossRent)}</span>
                {" · "}WHT: <span className="font-medium text-red-600">-{fmtKES(r.whtAmount)}</span>
                {" · "}Net: <span className="font-medium text-foreground">{fmtKES(r.netIncome)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={r.status} />
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-4 border-t pt-4 space-y-4">
            {/* Tax breakdown table */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tax Breakdown</p>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: "Gross Rental Income", value: fmtKES(r.grossRent), cls: "" },
                      ...(Number(r.allowableDeductions) > 0 ? [{ label: "Less: Allowable Deductions (s.15 ITA)", value: `-${fmtKES(r.allowableDeductions)}`, cls: "text-emerald-600" }] : []),
                      { label: "Net Taxable Income", value: fmtKES(r.netIncome), cls: "font-bold" },
                      { label: `WHT Withheld at Source (${fmtPct(r.whtRate)})`, value: `-${fmtKES(r.whtAmount)}`, cls: "text-amber-600" },
                      { label: "Net Rental Income Received", value: fmtKES(Number(r.grossRent) - Number(r.whtAmount)), cls: "text-muted-foreground" },
                      ...(r.vatApplicable ? [{ label: "VAT Collected (16%)", value: fmtKES(r.vatAmount), cls: "" }] : []),
                    ].map(({ label, value, cls }) => (
                      <tr key={label} className="border-b last:border-0 last:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">{label}</td>
                        <td className={`px-3 py-2 text-right font-mono ${cls}`}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-blue-50 border-t text-xs text-blue-700">
                  <strong>Note:</strong> WHT is deducted at source by the tenant before remitting rent (ITA Cap 470 s.35).
                  It is a tax credit, not an additional deduction from your taxable income.
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {r.deductionNotes && (
                <div className="col-span-2 p-2.5 rounded-lg bg-muted/40 text-xs text-muted-foreground italic">
                  Deduction notes: {r.deductionNotes}
                </div>
              )}
              {r.acknowledgementRef && (
                <div>
                  <p className="text-xs text-muted-foreground">KRA Acknowledgement Ref</p>
                  <p className="font-mono font-medium">{r.acknowledgementRef}</p>
                </div>
              )}
              {r.filedAt && (
                <div>
                  <p className="text-xs text-muted-foreground">Filed on</p>
                  <p className="font-medium">{fmt(r.filedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="font-medium">{MONTHS[(r.returnMonth ?? 1) - 1]} {r.returnYear}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-medium">{fmt(r.createdAt)}</p>
              </div>
            </div>

            {/* File action */}
            {r.status === "draft" && (
              <div className="border-t pt-3 flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">KRA Acknowledgement Reference</Label>
                  <Input
                    placeholder="e.g. ACK-2025-00123456"
                    value={filingRefs[r.id] ?? ""}
                    onChange={(e: any) => setFilingRefs((prev: any) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => markFiled.mutate({ id: r.id, ref: filingRefs[r.id] })}
                  disabled={!filingRefs[r.id] || markFiled.isPending}
                >
                  {markFiled.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                  Mark as Filed
                </Button>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() =>
                printDoc(buildKraReturnHtml(r, MONTHS), `KRA Return — ${MONTHS[(r.returnMonth ?? 1) - 1]} ${r.returnYear}`)
              }>
                <Download className="h-3.5 w-3.5 mr-1.5" />Download PDF
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── KRA Returns Tab ─────────────────────────────────────────────────────────
// Income Tax Act Cap 470 (Kenya):
//   - Withholding Tax (WHT): 10% for resident individuals, 30% for non-residents
//   - VAT: 16% applies only to commercial landlords (annual turnover ≥ KES 5M or registered)
//   - Monthly rental income return required if gross rent > KES 24,000/month (KES 288,000/year)
//   - Allowable deductions: mortgage interest, repairs & maintenance, agent commissions, insurance

function KraReturnsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [genForm, setGenForm] = useState({
    propertyId: "",
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    allowableDeductions: "",
    deductionNotes: "",
  });
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [profileForm, setProfileForm] = useState<any>({});
  const [filingRefs, setFilingRefs] = useState<Record<number, string>>({});

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties", "compliance", user?.role],
    queryFn: async () => {
      // Landlords are blocked from /api/properties (STAFF_AND_ABOVE).
      const url = user?.role === "landlord"
        ? "/api/landlord-portal/properties/stats"
        : "/api/properties";
      const r = await apiRequest(url);
      if (!r.ok) return [];
      const data = await r.json();
      // /api/properties returns flat array; /landlord-portal/properties/stats also returns array
      return ensureArray(data);
    },
    enabled: !!user,
  });
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ["/api/compliance/kra/returns", user?.id],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/compliance/kra/returns/${user?.id}`)).json()),
    enabled: !!user?.id,
  });
  const { data: kraProfile, refetch: refetchProfile } = useQuery({
    queryKey: ["/api/compliance/kra/profile", user?.id],
    queryFn: async () => {
      const r = await apiRequest(`/api/compliance/kra/profile/${user?.id}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!user?.id,
  });

  const generate = useMutation({
    mutationFn: () => apiRequest("/api/compliance/kra/returns/generate", {
      method: "POST",
      data: {
        landlordUserId: user?.id,
        propertyId: parseInt(genForm.propertyId),
        year: genForm.year,
        month: genForm.month,
        allowableDeductions: genForm.allowableDeductions ? parseFloat(genForm.allowableDeductions) : 0,
        deductionNotes: genForm.deductionNotes,
      },
    }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/kra/returns"] });
      if (data?.belowThreshold) {
        toast({
          title: "Return generated",
          description: "⚠ " + (data.warning ?? "Gross rent is below the KES 24,000/month threshold — monthly filing may not be required."),
          variant: "destructive",
        });
      } else {
        toast({ title: "Return generated" });
      }
    },
  });

  const markFiled = useMutation({
    mutationFn: (vars: any) => apiRequest(`/api/compliance/kra/returns/${vars.id}`, {
      method: "PATCH",
      data: { status: "filed", acknowledgementRef: vars.ref },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/kra/returns"] });
      toast({ title: "Return marked as filed" });
    },
  });

  const saveProfile = useMutation({
    mutationFn: () => apiRequest(`/api/compliance/kra/profile/${user?.id}`, {
      method: "PUT",
      data: profileForm,
    }),
    onSuccess: () => {
      refetchProfile();
      setShowProfileEdit(false);
      toast({ title: "KRA profile updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // WHT rate depends on resident/non-resident status (Income Tax Act s.35)
  const effectiveWhtRate = kraProfile?.isNonResident ? 30 : (kraProfile?.whtRate ?? 10);

  return (
    <div className="space-y-5">
      {/* KRA profile summary */}
      <Card className={kraProfile?.kraPin ? "border-emerald-200" : "border-amber-200"}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">KRA Profile</p>
              <p className="text-xs text-muted-foreground">
                PIN: <strong>{kraProfile?.kraPin ?? "Not set"}</strong>
                {" · "}WHT:{" "}
                <strong>
                  {kraProfile?.isNonResident
                    ? "30% (non-resident)"
                    : `${fmtPct(kraProfile?.whtRate ?? 10)} (resident)`}
                </strong>
                {" · "}VAT: <strong>{kraProfile?.isVatRegistered ? `Registered (${kraProfile.vatNumber})` : "Not registered"}</strong>
                {" · "}Filing: <strong>{kraProfile?.filingFrequency ?? "monthly"}</strong>
              </p>
              {!kraProfile?.kraPin && (
                <p className="text-xs text-amber-700 mt-0.5">
                  ⚠ KRA PIN not set — required for filing rental income returns under Income Tax Act Cap 470
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{kraProfile?.kraStatus ?? "pending"}</Badge>
              <Button variant="outline" size="sm" onClick={() => {
                setProfileForm({
                  kraPin: kraProfile?.kraPin ?? "",
                  whtRate: kraProfile?.whtRate ?? 10,
                  isNonResident: kraProfile?.isNonResident ?? false,
                  isVatRegistered: kraProfile?.isVatRegistered ?? false,
                  vatNumber: kraProfile?.vatNumber ?? "",
                  filingFrequency: kraProfile?.filingFrequency ?? "monthly",
                  annualIncomeThreshold: kraProfile?.annualIncomeThreshold ?? 288000,
                });
                setShowProfileEdit(true);
              }}>
                <Pencil className="h-3.5 w-3.5 mr-1" />Edit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legal note on WHT thresholds */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <strong>Income Tax Act Cap 470 — Rental Income Rules:</strong>{" "}
          Withholding Tax (WHT) is deducted <strong>at source by the tenant/payer</strong> before remitting rent to the landlord —
          <strong>10%</strong> for resident landlords, <strong>30%</strong> for non-residents (s.35 ITA).
          The landlord receives net rent (gross less WHT) and claims WHT as a tax credit when filing.
          Monthly returns are mandatory if gross rent exceeds <strong>KES 24,000/month</strong> (KES 288,000/year).
          Allowable deductions under s.15 include mortgage interest, repairs &amp; maintenance, agent commissions,
          and insurance premiums — these reduce your <em>taxable income</em>, not the WHT amount.
        </div>
      </div>

      {/* Generate return */}
      <Card>
        <CardHeader className="pb-3"><h3 className="text-sm font-semibold text-foreground">Generate Monthly Return</h3></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Property</Label>
              <Select value={genForm.propertyId} onValueChange={v => setGenForm(f => ({ ...f, propertyId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Year</Label>
              <Input type="number" value={genForm.year} onChange={e => setGenForm(f => ({ ...f, year: parseInt(e.target.value) }))} />
            </div>
            <div>
              <Label className="text-xs">Month</Label>
              <Select value={String(genForm.month)} onValueChange={v => setGenForm(f => ({ ...f, month: parseInt(v) }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => generate.mutate()} disabled={!genForm.propertyId || generate.isPending}>
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Calculator className="h-4 w-4 mr-1" />}
                Compute
              </Button>
            </div>
          </div>
          {/* Allowable deductions */}
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <div>
              <Label className="text-xs">Allowable deductions (KES)</Label>
              <Input
                type="number"
                placeholder="e.g. mortgage interest, repairs…"
                value={genForm.allowableDeductions}
                onChange={e => setGenForm(f => ({ ...f, allowableDeductions: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Deduction notes</Label>
              <Input
                placeholder="e.g. Mortgage interest KES 12,000"
                value={genForm.deductionNotes}
                onChange={e => setGenForm(f => ({ ...f, deductionNotes: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returns list */}
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
        <div className="space-y-3">
          {!returns.length && <p className="text-center text-muted-foreground py-8">No returns generated yet. Select a property and click Compute above.</p>}
          {returns.map((r: any) => (
            <KraReturnCard
              key={r.id}
              r={r}
              MONTHS={MONTHS}
              filingRefs={filingRefs}
              setFilingRefs={setFilingRefs}
              markFiled={markFiled}
            />
          ))}
        </div>
      )}

      {/* KRA Profile Edit Dialog */}
      <Dialog open={showProfileEdit} onOpenChange={setShowProfileEdit}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>KRA Landlord Profile</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
              Required for rental income filing under the Income Tax Act Cap 470. Your KRA PIN is the A001234567B format.
            </p>
            <div>
              <Label className="text-xs">KRA PIN *</Label>
              <Input
                value={profileForm.kraPin ?? ""}
                onChange={e => setProfileForm((f: any) => ({ ...f, kraPin: e.target.value }))}
                placeholder="A001234567B"
                className="font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Residency status</Label>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="radio"
                    checked={!profileForm.isNonResident}
                    onChange={() => setProfileForm((f: any) => ({ ...f, isNonResident: false, whtRate: 10 }))}
                  />
                  Resident (WHT 10%)
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="radio"
                    checked={!!profileForm.isNonResident}
                    onChange={() => setProfileForm((f: any) => ({ ...f, isNonResident: true, whtRate: 30 }))}
                  />
                  Non-resident (WHT 30%)
                </label>
              </div>
            </div>
            <div>
              <Label className="text-xs">Filing frequency</Label>
              <Select value={profileForm.filingFrequency ?? "monthly"} onValueChange={v => setProfileForm((f: any) => ({ ...f, filingFrequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly (gross rent &gt; KES 24,000/month)</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="vat-reg-chk"
                checked={!!profileForm.isVatRegistered}
                onChange={e => setProfileForm((f: any) => ({ ...f, isVatRegistered: e.target.checked }))}
              />
              <label htmlFor="vat-reg-chk" className="text-xs cursor-pointer">VAT registered (commercial landlord — 16%)</label>
            </div>
            {profileForm.isVatRegistered && (
              <div>
                <Label className="text-xs">VAT registration number</Label>
                <Input
                  value={profileForm.vatNumber ?? ""}
                  onChange={e => setProfileForm((f: any) => ({ ...f, vatNumber: e.target.value }))}
                  placeholder="e.g. 0712345678V"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProfileEdit(false)}>Cancel</Button>
            <Button onClick={() => saveProfile.mutate()} disabled={!profileForm.kraPin || saveProfile.isPending}>
              {saveProfile.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Deposit Interest Tab ─────────────────────────────────────────────────────
// Landlord & Tenant (Shops, Hotels and Catering Establishments) Act Cap 301 and
// common law practice in Kenya require security deposit interest be accounted for
// at the CBK base rate (Central Bank Rate, CBR). Simple interest formula:
//   Interest = Principal × Rate × Days / 365

function DepositInterestTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({ effectiveDate: "", rate: "", notes: "" });

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties", "compliance", user?.role],
    queryFn: async () => {
      // Landlords are blocked from /api/properties (STAFF_AND_ABOVE).
      const url = user?.role === "landlord"
        ? "/api/landlord-portal/properties/stats"
        : "/api/properties";
      const r = await apiRequest(url);
      if (!r.ok) return [];
      const data = await r.json();
      // /api/properties returns flat array; /landlord-portal/properties/stats also returns array
      return ensureArray(data);
    },
    enabled: !!user,
  });

  const { data: leases = [] } = useQuery({
    queryKey: ["/api/leases", "compliance", user?.role],
    queryFn: async () => {
      // /api/leases is now ADMIN_MANAGER_LANDLORD — landlords can access their own leases
      const r = await apiRequest("/api/leases");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: !!user,
  });

  const [selectedLeaseId, setSelectedLeaseId] = useState<string>("");

  const { data, isLoading, refetch: refetchDeposit } = useQuery({
    queryKey: ["/api/compliance/deposit-interest", selectedLeaseId],
    queryFn: async () => {
      const r = await apiRequest(`/api/compliance/deposit-interest/${selectedLeaseId}`);
      return r.json();
    },
    enabled: !!selectedLeaseId,
  });

  const { data: cbkRates = [], refetch: refetchRates } = useQuery({
    queryKey: ["/api/compliance/cbk-rates"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/compliance/cbk-rates")).json()),
  });

  const accrue = useMutation({
    mutationFn: (leaseId: number) => apiRequest("/api/compliance/deposit-interest/accrue", {
      method: "POST",
      data: { leaseId },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/deposit-interest", selectedLeaseId] });
      toast({ title: "Interest accruals computed" });
    },
  });

  const settle = useMutation({
    mutationFn: (vars: any) => apiRequest(`/api/compliance/deposit-interest/${vars.id}/settle`, {
      method: "PATCH",
      data: { settledAmount: vars.settledAmount, settlementRef: vars.ref },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/deposit-interest", selectedLeaseId] });
      toast({ title: "Accrual settled" });
    },
  });

  const addRate = useMutation({
    mutationFn: () => apiRequest("/api/compliance/cbk-rates", {
      method: "POST",
      data: { effectiveDate: newRate.effectiveDate, rate: parseFloat(newRate.rate), notes: newRate.notes, source: "CBK_MPC" },
    }),
    onSuccess: () => {
      refetchRates();
      setShowAddRate(false);
      setNewRate({ effectiveDate: "", rate: "", notes: "" });
      toast({ title: "CBK rate added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [settleForm, setSettleForm] = useState({ settledAmount: "", ref: "" });

  const currentRate = cbkRates[0];

  // Build lease options with tenant name for usability
  const leaseOptions = leases.map((l: any) => ({
    id: l.id,
    label: `Lease #${l.id}${l.leaseNumber ? ` (${l.leaseNumber})` : ""}`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-blue-800 space-y-1">
          <p>
            <strong>Commercial premises (Cap 301):</strong> The Landlord and Tenant (Shops, Hotels and Catering
            Establishments) Act requires deposits be held in a separate interest-bearing account at the
            CBK base rate. Current CBK rate:{" "}
            <strong>{currentRate ? `${currentRate.rate}% (effective ${fmt(currentRate.effectiveDate)})` : "Not yet configured — add below"}</strong>
          </p>
          <p className="text-xs text-blue-700">
            <strong>Residential premises:</strong> No statute explicitly mandates deposit interest, but it is
            contractual best practice and increasingly expected by tenants. This tracker applies the CBK rate
            as the industry standard for both residential and commercial deposits.
          </p>
          {!currentRate && (
            <p className="text-xs text-amber-700 font-medium">
              ⚠ No CBK rate configured. The system will use 13% as a fallback (current CBK rate as of 2025).
              Add the official rate below to ensure accuracy. Check{" "}
              <a href="https://www.centralbank.go.ke/monetary-policy/" target="_blank" rel="noreferrer" className="underline">centralbank.go.ke</a>{" "}
              for the current Monetary Policy Committee rate.
            </p>
          )}
        </div>
      </div>

      {/* Lease selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-48">
              <Label className="text-xs">Select lease</Label>
              <Select value={selectedLeaseId} onValueChange={setSelectedLeaseId}>
                <SelectTrigger><SelectValue placeholder="Choose a lease…" /></SelectTrigger>
                <SelectContent>
                  {leaseOptions.map((l: any) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedLeaseId && (
              <Button onClick={() => accrue.mutate(parseInt(selectedLeaseId))} disabled={accrue.isPending}>
                {accrue.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Accrue Interest
              </Button>
            )}
            {selectedLeaseId && data && (
              <Button variant="outline" onClick={() =>
                printDoc(buildDepositInterestHtml(selectedLeaseId, data, currentRate), `Deposit Interest — Lease ${selectedLeaseId}`)
              }>
                <Download className="h-4 w-4 mr-1" />Download Statement
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Accrued", value: fmtKES(data.totalAccrued), color: "text-foreground" },
              { label: "Settled", value: fmtKES(data.totalSettled), color: "text-emerald-600" },
              { label: "Outstanding", value: fmtKES(data.totalOutstanding), color: data.totalOutstanding > 0 ? "text-amber-600" : "text-foreground" },
            ].map(({ label, value, color }) => (
              <Card key={label}><CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </CardContent></Card>
            ))}
          </div>

          <div className="space-y-2">
            {ensureArray(data.accruals).map((a: any) => (
              <div key={a.id} className={`rounded-lg border text-sm ${a.isSettled ? "bg-emerald-50/40 border-emerald-200" : "bg-card border-border"}`}>
                <div className="flex items-center gap-3 p-3">
                  <div className="shrink-0">
                    {a.isSettled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{fmt(a.periodStart)} – {fmt(a.periodEnd)}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtKES(a.depositBalance)} × {a.cbkRate}% × {a.daysInPeriod} days / 365
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold">{fmtKES(a.interestAmount)}</p>
                    <p className="text-xs text-muted-foreground">Cumulative: {fmtKES(a.cumulativeInterest)}</p>
                  </div>
                  {!a.isSettled && (
                    <Button variant="outline" size="sm" onClick={() => {
                      setSettlingId(a.id);
                      setSettleForm({ settledAmount: a.interestAmount, ref: "" });
                    }}>
                      Settle
                    </Button>
                  )}
                </div>
                {settlingId === a.id && (
                  <div className="border-t px-3 pb-3 pt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Amount settled (KES)</Label>
                      <Input
                        type="number"
                        value={settleForm.settledAmount}
                        onChange={e => setSettleForm(f => ({ ...f, settledAmount: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Settlement reference</Label>
                      <Input
                        value={settleForm.ref}
                        onChange={e => setSettleForm(f => ({ ...f, ref: e.target.value }))}
                        placeholder="e.g. M-Pesa ref"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setSettlingId(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => settle.mutate({ id: a.id, settledAmount: settleForm.settledAmount, ref: settleForm.ref })}
                        disabled={settle.isPending}>
                        {settle.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Confirm Settlement
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* CBK rate history */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">CBK Rate History (MPC decisions)</h3>
            <Button variant="outline" size="sm" onClick={() => setShowAddRate(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />Add rate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddRate && (
            <div className="grid grid-cols-3 gap-2 mb-4 p-3 rounded-lg border bg-muted/30">
              <div>
                <Label className="text-xs">Effective date</Label>
                <Input type="date" value={newRate.effectiveDate} onChange={e => setNewRate(f => ({ ...f, effectiveDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Rate (%)</Label>
                <Input type="number" step="0.25" value={newRate.rate} onChange={e => setNewRate(f => ({ ...f, rate: e.target.value }))} placeholder="e.g. 10.75" />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={newRate.notes} onChange={e => setNewRate(f => ({ ...f, notes: e.target.value }))} placeholder="CBK MPC …" />
              </div>
              <div className="col-span-3 flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowAddRate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => addRate.mutate()} disabled={!newRate.effectiveDate || !newRate.rate || addRate.isPending}>
                  {addRate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Save
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-1.5 max-h-52 overflow-y-auto">
            {cbkRates.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-0.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{fmt(r.effectiveDate)}</span>
                <span className="font-medium">{r.rate}%</span>
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">{r.notes}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Valuation expandable card ────────────────────────────────────────────────
function ValuationCard({ v }: { v: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className={v.isDisposal ? "border-orange-200" : v.isAcquisition ? "border-blue-200" : ""}>
      <CardContent className="pt-4 pb-3">
        <div
          className="flex items-start justify-between gap-2 cursor-pointer select-none"
          onClick={() => setExpanded(e => !e)}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{fmt(v.valuationDate)}</span>
              <Badge variant="outline">{v.valuationType?.replace(/_/g, " ")}</Badge>
              {v.isAcquisition && <Badge className="bg-blue-100 text-blue-800 border-0">Acquisition</Badge>}
              {v.isDisposal   && <Badge className="bg-orange-100 text-orange-800 border-0">Disposal</Badge>}
              {v.isDisposal && v.cgtRate && <Badge className="bg-red-50 text-red-700 border-red-200">CGT {v.cgtRate}%</Badge>}
            </div>
            <p className="text-lg font-bold mt-1">{fmtKES(v.marketValue)}</p>
            {v.valuerName && <p className="text-xs text-muted-foreground">{v.valuerName}{v.valuerFirm ? ` · ${v.valuerFirm}` : ""}</p>}
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>

        {expanded && (
          <div className="mt-3 border-t pt-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Market value</p><p className="font-semibold">{fmtKES(v.marketValue)}</p></div>
              {Number(v.improvementCosts) > 0 && <div><p className="text-xs text-muted-foreground">Improvement costs</p><p className="font-semibold">{fmtKES(v.improvementCosts)}</p></div>}
              {v.valuerLicence && <div><p className="text-xs text-muted-foreground">ISK Licence</p><p className="font-medium font-mono">{v.valuerLicence}</p></div>}
              {v.valuerFirm && <div><p className="text-xs text-muted-foreground">Valuer firm</p><p className="font-medium">{v.valuerFirm}</p></div>}
              <div><p className="text-xs text-muted-foreground">Currency</p><p className="font-medium">{v.currency ?? "KES"}</p></div>
              <div><p className="text-xs text-muted-foreground">Valuation date</p><p className="font-medium">{fmt(v.valuationDate)}</p></div>
            </div>
            {v.isDisposal && (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">CGT Computation</div>
                <table className="w-full text-sm">
                  <tbody>
                    {v.purchasePrice && <tr className="border-t"><td className="px-3 py-2 text-muted-foreground">Cost base (purchase)</td><td className="px-3 py-2 text-right font-mono">{fmtKES(v.purchasePrice)}</td></tr>}
                    {Number(v.improvementCosts) > 0 && <tr className="border-t"><td className="px-3 py-2 text-muted-foreground">Improvements</td><td className="px-3 py-2 text-right font-mono">{fmtKES(v.improvementCosts)}</td></tr>}
                    {v.cgtGain !== null && v.cgtGain !== undefined && <tr className="border-t"><td className="px-3 py-2 text-muted-foreground">Net gain</td><td className={`px-3 py-2 text-right font-mono ${Number(v.cgtGain) > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtKES(v.cgtGain)}</td></tr>}
                    {v.cgtRate && <tr className="border-t"><td className="px-3 py-2 text-muted-foreground">CGT rate</td><td className="px-3 py-2 text-right">{fmtPct(v.cgtRate)}</td></tr>}
                    {v.cgtLiability !== null && v.cgtLiability !== undefined && <tr className="border-t bg-red-50/50"><td className="px-3 py-2 font-semibold text-red-700">CGT liability</td><td className="px-3 py-2 text-right font-bold font-mono text-red-700">{fmtKES(v.cgtLiability)}</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {v.valuationReportUrl && (
              <a href={v.valuationReportUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 underline">
                <FileText className="h-3.5 w-3.5" />View valuation report
              </a>
            )}
            {v.notes && <p className="text-xs text-muted-foreground italic">{v.notes}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Valuations Tab ───────────────────────────────────────────────────────────
// Capital Gains Tax (CGT) in Kenya:
//   - Finance Act 2023: CGT rate raised from 5% to 15% on net gains from property disposal
//   - Effective date: 1 January 2023
//   - Cost base includes purchase price + improvement costs
//   - Filed via KRA iTax under Capital Gains Tax return

function ValuationsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propId, setPropId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ valuationType: "annual_review", currency: "KES", cgtRate: 15 });

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties", "compliance", user?.role],
    queryFn: async () => {
      // Landlords are blocked from /api/properties (STAFF_AND_ABOVE).
      const url = user?.role === "landlord"
        ? "/api/landlord-portal/properties/stats"
        : "/api/properties";
      const r = await apiRequest(url);
      if (!r.ok) return [];
      const data = await r.json();
      // /api/properties returns flat array; /landlord-portal/properties/stats also returns array
      return ensureArray(data);
    },
    enabled: !!user,
  });
  const { data: valuations = [], isLoading } = useQuery({
    queryKey: ["/api/compliance/valuations", propId],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/compliance/valuations/${propId}`)).json()),
    enabled: !!propId,
  });
  const { data: cgt } = useQuery({
    queryKey: ["/api/compliance/valuations/cgt", propId],
    queryFn: async () => (await apiRequest(`/api/compliance/valuations/${propId}/cgt`)).json(),
    enabled: !!propId,
  });

  const addValuation = useMutation({
    mutationFn: () => apiRequest("/api/compliance/valuations", {
      method: "POST",
      data: { ...form, propertyId: parseInt(propId) },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/compliance/valuations"] });
      qc.invalidateQueries({ queryKey: ["/api/compliance/valuations/cgt"] });
      setShowForm(false);
      setForm({ valuationType: "annual_review", currency: "KES", cgtRate: 15 });
      toast({ title: "Valuation recorded" });
    },
  });

  const VALUATION_TYPES = ["purchase", "sale", "mortgage", "annual_review", "cgt_assessment", "insurance"];

  return (
    <div className="space-y-4">
      {/* CGT rate notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong>Finance Act 2023 — CGT Rate Change:</strong> Capital Gains Tax on property disposals increased from{" "}
          <strong>5% to 15%</strong> effective <strong>1 January 2023</strong>. Disposals after this date use the 15% rate.
          Pre-2023 disposals use 5%. Cost base includes purchase price + allowable improvement costs.
          File via KRA iTax under "Capital Gains Tax" return within <strong>30 days</strong> of disposal.
        </div>
      </div>

      <div className="flex gap-3">
        <Select value={propId} onValueChange={setPropId}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Select property…" /></SelectTrigger>
          <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        {propId && (
          <Button onClick={() => setShowForm(s => !s)} variant="outline" className="gap-1.5">
            <Plus className="h-4 w-4" />Add valuation
          </Button>
        )}
        {propId && (cgt || valuations.length > 0) && (
          <Button variant="outline" className="gap-1.5" onClick={() => {
            const propName = properties.find((p: any) => String(p.id) === propId)?.name ?? `Property ${propId}`;
            printDoc(buildCgtHtml(propName, cgt, valuations), `CGT Record — ${propName}`);
          }}>
            <Download className="h-4 w-4" />Download PDF
          </Button>
        )}
      </div>

      {/* CGT summary */}
      {cgt && propId && (
        <Card className={cgt.cgtLiability > 0 ? "border-amber-300 bg-amber-50/30 dark:bg-amber-950/10" : ""}>
          <CardContent className="pt-4">
            <p className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Calculator className="h-4 w-4" />Capital Gains Tax Summary
            </p>
            {cgt.cgt === null ? (
              <p className="text-sm text-muted-foreground">{cgt.note ?? cgt.message}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Cost base</p><p className="font-medium">{fmtKES(cgt.costBase)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Disposal value</p><p className="font-medium">{fmtKES(cgt.disposalValue)}</p></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Net gain</p>
                    <p className={`font-medium ${cgt.gain > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtKES(cgt.gain)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CGT @ {fmtPct(cgt.cgtRate ?? 15)}</p>
                    <p className="font-bold text-red-600">{fmtKES(cgt.cgtLiability)}</p>
                  </div>
                </div>
                {cgt.cgtLiability > 0 && (
                  <p className="text-xs text-amber-700 mt-2">
                    ⚠ KRA CGT return must be filed and tax paid within <strong>30 days</strong> of disposal via iTax.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3"><h3 className="text-sm font-semibold text-foreground">Record Valuation</h3></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input type="date" value={form.valuationDate ?? ""} onChange={e => setForm((f: any) => ({ ...f, valuationDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.valuationType} onValueChange={v => setForm((f: any) => ({
                ...f, valuationType: v,
                isAcquisition: v === "purchase",
                isDisposal: v === "sale",
                // Finance Act 2023: 15% from Jan 2023, 5% before
                cgtRate: v === "sale" ? (f.valuationDate && new Date(f.valuationDate) >= new Date("2023-01-01") ? 15 : 5) : 15,
              }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VALUATION_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Market value (KES)</Label>
              <Input type="number" value={form.marketValue ?? ""} onChange={e => setForm((f: any) => ({ ...f, marketValue: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Improvement costs (KES)</Label>
              <Input type="number" value={form.improvementCosts ?? ""} onChange={e => setForm((f: any) => ({ ...f, improvementCosts: e.target.value }))} />
            </div>
            {(form.valuationType === "sale" || form.valuationType === "cgt_assessment") && (
              <div>
                <Label className="text-xs">CGT rate (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.cgtRate ?? 15}
                  onChange={e => setForm((f: any) => ({ ...f, cgtRate: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Finance Act 2023: <strong>15%</strong> for disposals on/after 1 Jan 2023 (auto-set). 5% for pre-2023 disposals only.
                </p>
              </div>
            )}
            <div>
              <Label className="text-xs">Valuer name</Label>
              <Input value={form.valuerName ?? ""} onChange={e => setForm((f: any) => ({ ...f, valuerName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Valuer firm</Label>
              <Input value={form.valuerFirm ?? ""} onChange={e => setForm((f: any) => ({ ...f, valuerFirm: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">ISK licence no.</Label>
              <Input value={form.valuerLicence ?? ""} onChange={e => setForm((f: any) => ({ ...f, valuerLicence: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={form.notes ?? ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={() => addValuation.mutate()} disabled={!form.valuationDate || !form.marketValue || addValuation.isPending}>
                {addValuation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      <div className="space-y-2">
        {valuations.map((v: any) => (
          <ValuationCard key={v.id} v={v} />
        ))}
        {propId && !isLoading && !valuations.length && (
          <p className="text-center text-muted-foreground py-6 text-sm">No valuations recorded for this property yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Service Charge Demand expandable row ─────────────────────────────────────
function ServiceChargeDemandRow({ d }: { d: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border text-sm">
      <div
        className="flex items-center justify-between gap-2 p-2.5 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div>
          <p className="font-mono text-xs font-semibold">{d.demandNumber}</p>
          <p className="text-xs text-muted-foreground">
            Unit #{d.unitId} · {fmt(d.periodStart)} – {fmt(d.periodEnd)} · Due {fmt(d.dueDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-right shrink-0">
          <div>
            <p className="font-semibold">{fmtKES(d.totalAmount)}</p>
            <StatusBadge status={d.status} />
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>
      {expanded && (
        <div className="border-t px-3 pb-3 pt-2 space-y-3">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Fixed charges</td><td className="px-3 py-2 text-right font-mono">{fmtKES(d.fixedAmount)}</td></tr>
                <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Variable charges</td><td className="px-3 py-2 text-right font-mono">{fmtKES(d.variableAmount)}</td></tr>
                <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">Sinking fund contribution</td><td className="px-3 py-2 text-right font-mono">{fmtKES(d.sinkingFundAmount)}</td></tr>
                <tr className="bg-muted/30"><td className="px-3 py-2 font-semibold">Total demand</td><td className="px-3 py-2 text-right font-bold font-mono">{fmtKES(d.totalAmount)}</td></tr>
                {Number(d.paidAmount) > 0 && (
                  <tr className="bg-emerald-50/50"><td className="px-3 py-2 text-emerald-700">Amount paid</td><td className="px-3 py-2 text-right font-mono text-emerald-700">{fmtKES(d.paidAmount)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div><span className="font-medium text-foreground">Period: </span>{fmt(d.periodStart)} – {fmt(d.periodEnd)}</div>
            <div><span className="font-medium text-foreground">Due: </span>{fmt(d.dueDate)}</div>
            {d.paidDate && <div><span className="font-medium text-foreground">Paid: </span>{fmt(d.paidDate)}</div>}
            {d.notes && <div className="col-span-2 italic">{d.notes}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Service Charges Tab ──────────────────────────────────────────────────────
// ARMA (Association of Residential Managing Agents) — Kenyan service charge practice:
//   - Separate budget for fixed, variable, and sinking fund (major repairs reserve)
//   - Formal demand notices per unit (SCN-YEAR-NNN)
//   - Sinking fund must be held in a separate ring-fenced account

function ServiceChargesTab() {
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propId, setPropId]           = useState("");
  const [year, setYear]               = useState(new Date().getFullYear());
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showDemandForm, setShowDemandForm] = useState(false);
  const [showSinkingForm, setShowSinkingForm] = useState(false);
  const [budgetForm, setBudgetForm]   = useState<any>({ fyStartMonth: 1 });
  const [demandForm, setDemandForm]   = useState<any>({});
  const [sinkingForm, setSinkingForm] = useState<any>({ transactionType: "contribution" });

  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties", "compliance", user?.role],
    queryFn: async () => {
      // Landlords are blocked from /api/properties (STAFF_AND_ABOVE).
      const url = user?.role === "landlord"
        ? "/api/landlord-portal/properties/stats"
        : "/api/properties";
      const r = await apiRequest(url);
      if (!r.ok) return [];
      const data = await r.json();
      // /api/properties returns flat array; /landlord-portal/properties/stats also returns array
      return ensureArray(data);
    },
    enabled: !!user,
  });

  const { data: budget, isLoading: budgetLoading, refetch: refetchBudget } = useQuery({
    queryKey: ["/api/compliance/service-charges/budget", propId, year],
    queryFn: async () => {
      const r = await apiRequest(`/api/compliance/service-charges/budget/${propId}/${year}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!propId,
  });

  const { data: demands = [], isLoading: demandsLoading, refetch: refetchDemands } = useQuery({
    queryKey: ["/api/compliance/service-charges/demands", propId],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/compliance/service-charges/demands/${propId}`)).json()),
    enabled: !!propId,
  });

  const { data: sinking, isLoading: sinkingLoading, refetch: refetchSinking } = useQuery({
    queryKey: ["/api/compliance/sinking-fund", propId],
    queryFn: async () => (await apiRequest(`/api/compliance/sinking-fund/${propId}`)).json(),
    enabled: !!propId,
  });

  const saveBudget = useMutation({
    mutationFn: () => apiRequest(
      budget?.id
        ? `/api/compliance/service-charges/budget/${budget.id}/approve`
        : "/api/compliance/service-charges/budget",
      { method: budget?.id ? "POST" : "POST", data: { ...budgetForm, propertyId: parseInt(propId), financialYear: year } }
    ),
    onSuccess: () => {
      refetchBudget();
      setShowBudgetForm(false);
      toast({ title: budget?.id ? "Budget approved" : "Budget created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateDemands = useMutation({
    mutationFn: () => apiRequest("/api/compliance/service-charges/demands/generate", {
      method: "POST",
      data: { ...demandForm, propertyId: parseInt(propId) },
    }),
    onSuccess: (_, __, ctx) => {
      refetchDemands();
      setShowDemandForm(false);
      setDemandForm({});
      toast({ title: "Demand notices generated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addSinking = useMutation({
    mutationFn: () => apiRequest("/api/compliance/sinking-fund", {
      method: "POST",
      data: { ...sinkingForm, propertyId: parseInt(propId) },
    }),
    onSuccess: () => {
      refetchSinking();
      setShowSinkingForm(false);
      setSinkingForm({ transactionType: "contribution" });
      toast({ title: "Sinking fund transaction recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pct = (actual: any, budget: any) =>
    budget && Number(budget) > 0 ? Math.min(100, Math.round((Number(actual) / Number(budget)) * 100)) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <strong>ARMA Service Charge Accounting</strong> — Set annual budgets (fixed/variable/sinking fund split),
          generate formal per-unit demand notices (SCN-YEAR-NNN), and maintain the sinking fund ledger in a
          separate ring-fenced account as required under best practice for Kenyan strata/estate management.
        </div>
      </div>

      {/* Property + Year selector */}
      <div className="flex gap-3 flex-wrap">
        <Select value={propId} onValueChange={setPropId}>
          <SelectTrigger className="flex-1 min-w-40"><SelectValue placeholder="Select property…" /></SelectTrigger>
          <SelectContent>{properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">FY Year</Label>
          <Input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="w-24" />
        </div>
      </div>

      {propId && (
        <>
          {/* Annual Budget */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Annual Service Charge Budget — FY {year}</h3>
                {isManager && (
                  <Button variant="outline" size="sm" onClick={() => {
                    setBudgetForm({
                      fyStartMonth: budget?.fyStartMonth ?? 1,
                      allocationMethod: budget?.allocationMethod ?? "equal_split",
                      fixedBudget: budget?.fixedBudget ?? "",
                      variableBudget: budget?.variableBudget ?? "",
                      sinkingFundBudget: budget?.sinkingFundBudget ?? "",
                      notes: budget?.notes ?? "",
                    });
                    setShowBudgetForm(true);
                  }}>
                    {budget ? (budget.status === "draft" ? <><Pencil className="h-3.5 w-3.5 mr-1" />Edit / Approve</> : <><Eye className="h-3.5 w-3.5 mr-1" />View</>) : <><Plus className="h-3.5 w-3.5 mr-1" />Set Budget</>}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {budgetLoading && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>}
              {!budgetLoading && !budget && (
                <p className="text-sm text-muted-foreground text-center py-4">No budget set for FY {year}.</p>
              )}
              {budget && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={budget.status} />
                    {budget.approvedAt && <span className="text-xs text-muted-foreground">Approved {fmt(budget.approvedAt)}</span>}
                  </div>
                  {[
                    { label: "Fixed charges", budgeted: budget.fixedBudget, actual: budget.fixedActual, desc: "Lift, security, landscaping, generator" },
                    { label: "Variable charges", budgeted: budget.variableBudget, actual: budget.variableActual, desc: "Electricity, water (metered)" },
                    { label: "Sinking fund", budgeted: budget.sinkingFundBudget, actual: budget.sinkingFundActual, desc: "Major repairs reserve (ring-fenced)" },
                  ].map(({ label, budgeted, actual, desc }) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground">{fmtKES(actual)} / {fmtKES(budgeted)}</span>
                      </div>
                      <Progress value={pct(actual, budgeted)} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                  ))}
                </div>
              )}
              {showBudgetForm && (
                <div className="mt-4 border-t pt-4 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Default allocation method for this property</Label>
                    <Select value={budgetForm.allocationMethod ?? "equal_split"} onValueChange={v => setBudgetForm((f: any) => ({ ...f, allocationMethod: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equal_split">Equal split — same amount per occupied unit</SelectItem>
                        <SelectItem value="pro_rata_sqft">Pro-rata by sqft — for properties with varied unit sizes (e.g. malls)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground mt-1">Used automatically when generating demand notices, unless overridden there.</p>
                  </div>
                  <div><Label className="text-xs">Fixed budget (KES)</Label><Input type="number" value={budgetForm.fixedBudget ?? ""} onChange={e => setBudgetForm((f: any) => ({ ...f, fixedBudget: e.target.value }))} /></div>
                  <div><Label className="text-xs">Variable budget (KES)</Label><Input type="number" value={budgetForm.variableBudget ?? ""} onChange={e => setBudgetForm((f: any) => ({ ...f, variableBudget: e.target.value }))} /></div>
                  <div><Label className="text-xs">Sinking fund budget (KES)</Label><Input type="number" value={budgetForm.sinkingFundBudget ?? ""} onChange={e => setBudgetForm((f: any) => ({ ...f, sinkingFundBudget: e.target.value }))} /></div>
                  <div><Label className="text-xs">FY start month</Label>
                    <Select value={String(budgetForm.fyStartMonth ?? 1)} onValueChange={v => setBudgetForm((f: any) => ({ ...f, fyStartMonth: parseInt(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                          <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={budgetForm.notes ?? ""} onChange={e => setBudgetForm((f: any) => ({ ...f, notes: e.target.value }))} /></div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowBudgetForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>
                      {saveBudget.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      {budget ? "Approve Budget" : "Create Budget"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Demand notices */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Service Charge Demand Notices</h3>
                {isManager && (
                  <Button variant="outline" size="sm" onClick={() => setShowDemandForm(true)} className="gap-1">
                    <FilePlus className="h-3.5 w-3.5" />Generate Notices
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {showDemandForm && (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30 grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Period start</Label><Input type="date" value={demandForm.periodStart ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, periodStart: e.target.value }))} /></div>
                  <div><Label className="text-xs">Period end</Label><Input type="date" value={demandForm.periodEnd ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, periodEnd: e.target.value }))} /></div>
                  <div className="col-span-2">
                    <Label className="text-xs">Allocation method</Label>
                    <Select value={demandForm.allocationMethod ?? "equal_split"} onValueChange={v => setDemandForm((f: any) => ({ ...f, allocationMethod: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equal_split">Equal split — same amount billed to every occupied unit</SelectItem>
                        <SelectItem value="pro_rata_sqft">Pro-rata by sqft — total below is split by each unit's share of occupied floor area (for mixed unit sizes, e.g. malls)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">
                      {demandForm.allocationMethod === "pro_rata_sqft" ? "Total fixed charges for period (KES)" : "Fixed amount per unit (KES)"}
                    </Label>
                    <Input type="number" value={demandForm.fixedAmount ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, fixedAmount: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">
                      {demandForm.allocationMethod === "pro_rata_sqft" ? "Total variable charges for period (KES)" : "Variable amount per unit (KES)"}
                    </Label>
                    <Input type="number" value={demandForm.variableAmount ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, variableAmount: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">
                      {demandForm.allocationMethod === "pro_rata_sqft" ? "Total sinking fund for period (KES)" : "Sinking fund per unit (KES)"}
                    </Label>
                    <Input type="number" value={demandForm.sinkingFundAmount ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, sinkingFundAmount: e.target.value }))} />
                  </div>
                  <div><Label className="text-xs">Due date</Label><Input type="date" value={demandForm.dueDate ?? ""} onChange={e => setDemandForm((f: any) => ({ ...f, dueDate: e.target.value }))} /></div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowDemandForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => generateDemands.mutate()} disabled={!demandForm.periodStart || !demandForm.dueDate || generateDemands.isPending}>
                      {generateDemands.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Generate for all occupied units
                    </Button>
                  </div>
                </div>
              )}
              {demandsLoading ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div> : (
                demands.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-4">No demand notices issued yet.</p>
                  : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {demands.map((d: any) => (
                        <ServiceChargeDemandRow key={d.id} d={d} />
                      ))}
                    </div>
                  )
              )}
            </CardContent>
          </Card>

          {/* Sinking fund */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Sinking Fund Ledger</h3>
                {isManager && (
                  <Button variant="outline" size="sm" onClick={() => setShowSinkingForm(true)} className="gap-1">
                    <Plus className="h-3.5 w-3.5" />Add transaction
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {sinking && (
                <div className="mb-3 p-3 rounded-lg border bg-emerald-50/50 flex items-center justify-between">
                  <p className="text-sm font-semibold text-emerald-800">Current balance</p>
                  <p className="text-xl font-bold text-emerald-700">{fmtKES(sinking.balance)}</p>
                </div>
              )}
              {showSinkingForm && (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select value={sinkingForm.transactionType} onValueChange={v => setSinkingForm((f: any) => ({ ...f, transactionType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contribution">Contribution</SelectItem>
                        <SelectItem value="expenditure">Expenditure</SelectItem>
                        <SelectItem value="interest">Interest earned</SelectItem>
                        <SelectItem value="adjustment">Adjustment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Date</Label><Input type="date" value={sinkingForm.transactionDate ?? ""} onChange={e => setSinkingForm((f: any) => ({ ...f, transactionDate: e.target.value }))} /></div>
                  <div><Label className="text-xs">Amount (KES)</Label><Input type="number" value={sinkingForm.amount ?? ""} onChange={e => setSinkingForm((f: any) => ({ ...f, amount: e.target.value }))} /></div>
                  <div><Label className="text-xs">Reference</Label><Input value={sinkingForm.reference ?? ""} onChange={e => setSinkingForm((f: any) => ({ ...f, reference: e.target.value }))} /></div>
                  <div className="col-span-2"><Label className="text-xs">Description</Label><Input value={sinkingForm.description ?? ""} onChange={e => setSinkingForm((f: any) => ({ ...f, description: e.target.value }))} /></div>
                  <div className="col-span-2 flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setShowSinkingForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => addSinking.mutate()} disabled={!sinkingForm.amount || !sinkingForm.transactionDate || !sinkingForm.description || addSinking.isPending}>
                      {addSinking.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Save
                    </Button>
                  </div>
                </div>
              )}
              {sinkingLoading ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div> : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {ensureArray(sinking?.transactions).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                      <div>
                        <span className="text-xs text-muted-foreground">{fmt(t.transactionDate)}</span>
                        <span className="ml-2 text-xs capitalize">{t.transactionType}</span>
                        <p className="text-xs text-muted-foreground">{t.description}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-medium text-sm ${t.transactionType === "expenditure" ? "text-red-600" : "text-emerald-600"}`}>
                          {t.transactionType === "expenditure" ? "-" : "+"}{fmtKES(t.amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">Bal: {fmtKES(t.balanceAfter)}</p>
                      </div>
                    </div>
                  ))}
                  {!sinking?.transactions?.length && <p className="text-sm text-muted-foreground text-center py-4">No sinking fund transactions yet.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!propId && (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
          Select a property above to manage its service charges.
        </CardContent></Card>
      )}
    </div>
  );
}

// ─── eTIMS Tab ────────────────────────────────────────────────────────────────
// KRA Electronic Tax Invoice Management System
// Mandatory for VAT-registered taxpayers from September 2023 (KRA public notice).
// KRA TIN format: A001234567B (letter, 9 digits, letter)

function EtimsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deviceForm, setDeviceForm] = useState({ tin: "", bhfId: "00", deviceSerial: "", sandbox: true });
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [submitForm, setSubmitForm] = useState({ sourceType: "invoice" as const, sourceId: "", isVatRegistered: false });

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["/api/etims/status"],
    queryFn: async () => {
      const r = await apiRequest("/api/etims/status");
      return r.ok ? r.json() : null;
    },
  });

  const { data: submissions = [], isLoading: subsLoading, refetch: refetchSubs } = useQuery<any[]>({
    queryKey: ["/api/etims/submissions"],
    queryFn: async () => {
      const r = await apiRequest("/api/etims/submissions?limit=30");
      return r.ok ? r.json() : [];
    },
  });

  const device   = statusData?.device ?? null;
  const stats    = statusData?.stats  ?? { total: 0, accepted: 0, pending: 0, rejected: 0 };
  const isSandbox = statusData?.sandbox ?? true;

  const saveDeviceMutation = useMutation({
    mutationFn: () => apiRequest("/api/etims/device", {
      method: "POST", data: deviceForm,
    }).then(r => { if (!r.ok) return r.json().then((e: any) => Promise.reject(new Error(e.message ?? "Failed"))); return r.json(); }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/etims/status"] }); setShowDeviceForm(false); toast({ title: "Device credentials saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const initialiseMutation = useMutation({
    mutationFn: () => apiRequest("/api/etims/initialise", { method: "POST", data: {} })
      .then(r => { if (!r.ok) return r.json().then((e: any) => Promise.reject(new Error(e.message ?? "Failed"))); return r.json(); }),
    onSuccess: (data: any) => { refetchStatus(); toast({ title: "Device initialised", description: data.resultMsg }); },
    onError: (e: any) => toast({ title: "Initialisation failed", description: e.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: () => apiRequest("/api/etims/submit", {
      method: "POST",
      data: { ...submitForm, sourceId: parseInt(submitForm.sourceId, 10) },
    }).then(r => { if (!r.ok) return r.json().then((e: any) => Promise.reject(new Error(e.message ?? "Failed"))); return r.json(); }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/etims/submissions"] });
      qc.invalidateQueries({ queryKey: ["/api/etims/status"] });
      setSubmitForm({ sourceType: "invoice", sourceId: "", isVatRegistered: false });
      toast({ title: `Invoice submitted${data.sandbox ? " [SANDBOX]" : ""}`, description: data.rcptNo ? `Receipt: ${data.rcptNo}` : undefined });
    },
    onError: (e: any) => toast({ title: "Submission failed", description: e.message, variant: "destructive" }),
  });

  const statusColor = device?.status === "active"
    ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30"
    : "border-amber-200 bg-amber-50 dark:bg-amber-950/30";

  return (
    <div className="space-y-5">
      {isSandbox && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-200">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Sandbox mode</strong> — submissions go to the KRA test environment and are labelled <code>[SANDBOX]</code>.
            To switch to live, set <code>ETIMS_SANDBOX=false</code> in your environment and add your production credentials.
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong>eTIMS mandatory for VAT-registered landlords</strong> from September 2023 per KRA notice.
          All invoices for commercial rent must be issued through eTIMS and include a KRA receipt number.
          KRA TIN format: <code className="font-mono bg-amber-100 px-1 rounded">A001234567B</code> (letter · 9 digits · letter).
        </div>
      </div>

      {/* Device status card */}
      <Card className={device ? statusColor : "border-amber-200"}>
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 flex items-center justify-center border shadow-sm">
                <Zap className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold text-sm">eTIMS Device</p>
                {device ? (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    TIN: <strong>{device.tin}</strong> · BHF: <strong>{device.bhfId}</strong>
                    {device.envDistCode && ` · Dist: ${device.envDistCode}`}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Not configured — add your KRA TIN to begin</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {device && <StatusBadge status={device.status} />}
              <Button variant="outline" size="sm" onClick={() => {
                if (device) setDeviceForm({ tin: device.tin, bhfId: device.bhfId, deviceSerial: device.deviceSerial ?? "", sandbox: device.sandbox });
                setShowDeviceForm(true);
              }}>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />Configure
              </Button>
              {device && device.status !== "active" && (
                <Button size="sm" onClick={() => initialiseMutation.mutate()} disabled={initialiseMutation.isPending}>
                  {initialiseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                  Initialise
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total submitted", value: stats.total,    color: "text-foreground"    },
          { label: "Accepted by KRA", value: stats.accepted, color: "text-emerald-600"   },
          { label: "Pending",         value: stats.pending,  color: "text-amber-600"     },
          { label: "Rejected/Error",  value: stats.rejected, color: "text-red-600"       },
        ].map(s => (
          <Card key={s.label} className="text-center py-3">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Submit invoice */}
      {device?.status === "active" && (
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-sm font-semibold text-foreground">Submit Invoice to KRA</h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={submitForm.sourceType} onValueChange={(v: any) => setSubmitForm(f => ({ ...f, sourceType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="rent_payment">Rent Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{submitForm.sourceType === "invoice" ? "Invoice ID" : "Rent Payment ID"}</Label>
                <Input
                  type="number" placeholder="e.g. 42"
                  value={submitForm.sourceId}
                  onChange={e => setSubmitForm(f => ({ ...f, sourceId: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div className="flex items-center gap-2 pb-0.5">
                <input
                  type="checkbox"
                  id="vat-chk"
                  checked={submitForm.isVatRegistered}
                  onChange={e => setSubmitForm(f => ({ ...f, isVatRegistered: e.target.checked }))}
                />
                <label htmlFor="vat-chk" className="text-xs cursor-pointer">VAT registered (16%)</label>
              </div>
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={!submitForm.sourceId || submitMutation.isPending}
                className="h-9"
              >
                {submitMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Submit to KRA
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submissions list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Recent Submissions</h3>
            <div className="flex gap-2">
              {submissions.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => downloadEtimsCsv(submissions as any[])}>
                  <Download className="h-3.5 w-3.5 mr-1" />Export CSV
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => refetchSubs()} className="h-7">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {subsLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!subsLoading && submissions.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">No submissions yet.</p>
          )}
          {submissions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-slate-50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <th className="text-left p-3">Invoice #</th>
                    <th className="text-left p-3 hidden sm:table-cell">Customer</th>
                    <th className="text-right p-3">Amount</th>
                    <th className="text-right p-3 hidden md:table-cell">VAT</th>
                    <th className="text-left p-3">KRA Receipt</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3 hidden sm:table-cell">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {(submissions as any[]).map((s: any) => (
                    <tr key={s.id} className="border-t hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">{s.invcNo}</td>
                      <td className="p-3 hidden sm:table-cell text-muted-foreground max-w-32 truncate">{s.custNm ?? "—"}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmtKES(s.totAmt)}</td>
                      <td className="p-3 text-right font-mono tabular-nums hidden md:table-cell">
                        {Number(s.totTaxAmt) > 0 ? fmtKES(s.totTaxAmt) : "Exempt"}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {s.rcptNo
                          ? <span className="font-mono text-xs text-emerald-700">{s.rcptNo}</span>
                          : <span className="text-xs text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        <StatusBadge status={s.status} />
                        {s.kraResultCd && s.kraResultCd !== "000" && (
                          <p className="text-xs text-red-600 mt-0.5">[{s.kraResultCd}] {s.kraResultMsg}</p>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground hidden sm:table-cell">
                        {s.submittedAt ? fmt(s.submittedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Device config dialog */}
      <Dialog open={showDeviceForm} onOpenChange={setShowDeviceForm}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>eTIMS Device Credentials</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground text-xs">
              Issued by KRA during eTIMS registration.
              Visit the <a href="https://etims.kra.go.ke" target="_blank" rel="noreferrer" className="underline text-blue-600">eTIMS portal</a> to register.
              Your KRA TIN is in the format <code className="font-mono bg-muted px-1 rounded text-xs">A001234567B</code>.
            </p>
            {[
              { label: "KRA TIN (Taxpayer ID) *", key: "tin",          placeholder: "A001234567B" },
              { label: "Branch/HQ ID",            key: "bhfId",        placeholder: "00"          },
              { label: "Device Serial (optional)", key: "deviceSerial", placeholder: "VSCU-123456" },
            ].map(({ label, key, placeholder }) => (
              <div key={key}>
                <Label className="text-xs">{label}</Label>
                <Input
                  value={(deviceForm as any)[key]}
                  onChange={e => setDeviceForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className={`mt-1 ${key === "tin" ? "font-mono uppercase" : ""}`}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="sbx-chk" checked={deviceForm.sandbox}
                onChange={e => setDeviceForm(f => ({ ...f, sandbox: e.target.checked }))} />
              <label htmlFor="sbx-chk" className="text-xs cursor-pointer">Use KRA sandbox (test environment)</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeviceForm(false)}>Cancel</Button>
            <Button onClick={() => saveDeviceMutation.mutate()} disabled={!deviceForm.tin || saveDeviceMutation.isPending}>
              {saveDeviceMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── RRT Notices Tab ──────────────────────────────────────────────────────────
// Rent Restriction Act Cap 296 (Kenya):
//   - Rent Increase Notice: s.9 — minimum notice period 30 days before effective date
//   - Notice to Vacate: s.12 — grounds must match prescribed statutory grounds
// Also applies principles from the Landlord and Tenant (Shops, Hotels and
// Catering Establishments) Act Cap 301 for commercial premises.

const EVICTION_GROUNDS: Record<string, string> = {
  non_payment:               "Non-Payment of Rent (s.12(a) Rent Restriction Act)",
  breach_of_agreement:       "Breach of Tenancy Agreement (s.12(b))",
  owner_occupation:          "Owner / Bona Fide Purchaser Occupation (s.12(c))",
  redevelopment:             "Redevelopment or Renovation Requiring Vacant Possession (s.12(d))",
  nuisance:                  "Causing a Nuisance or Annoyance (s.12(e))",
  illegal_use:               "Use of Premises for Illegal or Immoral Purposes (s.12(f))",
  subletting_without_consent:"Subletting Without Consent of Landlord (s.12(g))",
};

function RrtNoticesTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSubtab, setActiveSubtab] = useState<"increase" | "eviction">("increase");

  const { data: leases = [] } = useQuery({
    queryKey: ["/api/leases", "compliance", user?.role],
    queryFn: async () => {
      // /api/leases is now ADMIN_MANAGER_LANDLORD — landlords can access their own leases
      const r = await apiRequest("/api/leases");
      if (!r.ok) return [];
      return ensureArray(await r.json());
    },
    enabled: !!user,
  });

  const [increaseForm, setIncreaseForm] = useState<any>({ noticePeriodDays: 30 });
  const [evictionForm, setEvictionForm] = useState<any>({});
  const [selectedLeaseForHistory, setSelectedLeaseForHistory] = useState<string>("");
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [generatedTitle, setGeneratedTitle] = useState("");

  const { data: noticeHistory = [] } = useQuery({
    queryKey: ["/api/compliance/rrt/notices", selectedLeaseForHistory],
    queryFn: async () => ensureArray(await (await apiRequest(`/api/compliance/rrt/notices/${selectedLeaseForHistory}`)).json()),
    enabled: !!selectedLeaseForHistory,
  });

  const generateIncrease = useMutation({
    mutationFn: () => apiRequest("/api/compliance/rrt/rent-increase", {
      method: "POST",
      data: {
        leaseId: parseInt(increaseForm.leaseId),
        newRent: parseFloat(increaseForm.newRent),
        effectiveDate: increaseForm.effectiveDate,
        reason: increaseForm.reason ?? "",
        noticePeriodDays: increaseForm.noticePeriodDays ?? 30,
      },
    }).then(r => r.json()),
    onSuccess: (data: any) => {
      setGeneratedHtml(data.noticeHtml);
      setGeneratedTitle(`Rent Increase Notice — ${data.noticeNumber}`);
      toast({ title: "Notice generated", description: data.noticeNumber });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateEviction = useMutation({
    mutationFn: () => apiRequest("/api/compliance/rrt/eviction-notice", {
      method: "POST",
      data: {
        leaseId: parseInt(evictionForm.leaseId),
        groundCode: evictionForm.groundCode,
        vacateDate: evictionForm.vacateDate,
        reason: evictionForm.reason ?? "",
      },
    }).then(r => r.json()),
    onSuccess: (data: any) => {
      setGeneratedHtml(data.noticeHtml);
      setGeneratedTitle(`Notice to Vacate — ${data.noticeNumber}`);
      toast({ title: "Notice generated", description: data.noticeNumber });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const leaseOptions = leases.map((l: any) => ({
    id: l.id,
    label: `Lease #${l.id}${l.leaseNumber ? ` — ${l.leaseNumber}` : ""}`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <Gavel className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong>Rent Restriction Act Cap 296 (Kenya):</strong>{" "}
          Rent increase notices require a minimum of <strong>30 days</strong> written notice (Cap 296 s.9).
          Notices to vacate must cite a <strong>prescribed statutory ground</strong> (s.12) — owner occupation
          and redevelopment grounds require <strong>60 days</strong> minimum notice.
          Generated notices are formatted to meet RRT evidentiary requirements.
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSubtab("increase")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${activeSubtab === "increase" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}
        >
          <TrendingUp className="h-3.5 w-3.5" />Rent Increase Notice
        </button>
        <button
          onClick={() => setActiveSubtab("eviction")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${activeSubtab === "eviction" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}
        >
          <FileText className="h-3.5 w-3.5" />Notice to Vacate
        </button>
      </div>

      {activeSubtab === "increase" && (
        <Card>
          <CardHeader className="pb-3"><h3 className="text-sm font-semibold">Generate Rent Increase Notice (s.9 RRA)</h3></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Lease *</Label>
              <Select value={increaseForm.leaseId ?? ""} onValueChange={v => setIncreaseForm((f: any) => ({ ...f, leaseId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select lease…" /></SelectTrigger>
                <SelectContent>{leaseOptions.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">New monthly rent (KES) *</Label>
              <Input type="number" value={increaseForm.newRent ?? ""} onChange={e => setIncreaseForm((f: any) => ({ ...f, newRent: e.target.value }))} placeholder="e.g. 55000" />
            </div>
            <div>
              <Label className="text-xs">Effective date *</Label>
              <Input type="date" value={increaseForm.effectiveDate ?? ""} onChange={e => setIncreaseForm((f: any) => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Notice period (days)</Label>
              <Input type="number" value={increaseForm.noticePeriodDays ?? 30} min={30} onChange={e => setIncreaseForm((f: any) => ({ ...f, noticePeriodDays: parseInt(e.target.value) }))} />
              <p className="text-xs text-muted-foreground mt-0.5">Minimum 30 days (Cap 296)</p>
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Input value={increaseForm.reason ?? ""} onChange={e => setIncreaseForm((f: any) => ({ ...f, reason: e.target.value }))} placeholder="e.g. market rate adjustment" />
            </div>
            <div className="col-span-2 flex justify-end">
              <Button onClick={() => generateIncrease.mutate()}
                disabled={!increaseForm.leaseId || !increaseForm.newRent || !increaseForm.effectiveDate || generateIncrease.isPending}>
                {generateIncrease.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FilePlus className="h-4 w-4 mr-1" />}
                Generate Notice
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeSubtab === "eviction" && (
        <Card>
          <CardHeader className="pb-3"><h3 className="text-sm font-semibold">Generate Notice to Vacate (s.12 RRA)</h3></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Lease *</Label>
              <Select value={evictionForm.leaseId ?? ""} onValueChange={v => setEvictionForm((f: any) => ({ ...f, leaseId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select lease…" /></SelectTrigger>
                <SelectContent>{leaseOptions.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Statutory ground *</Label>
              <Select value={evictionForm.groundCode ?? ""} onValueChange={v => setEvictionForm((f: any) => ({ ...f, groundCode: v }))}>
                <SelectTrigger><SelectValue placeholder="Select ground…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EVICTION_GROUNDS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show minimum notice period based on selected ground */}
              {evictionForm.groundCode && (
                <p className={`text-xs mt-1 font-medium ${
                  ["owner_occupation","redevelopment"].includes(evictionForm.groundCode)
                    ? "text-amber-700"
                    : "text-muted-foreground"
                }`}>
                  {["owner_occupation","redevelopment"].includes(evictionForm.groundCode)
                    ? "⚠ This ground requires a minimum of 60 days notice (Cap 296 — owner occupation / redevelopment)"
                    : "ℹ Minimum 30 days notice required for this ground (Cap 296 s.9)"
                  }
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Vacate by date *</Label>
              <Input type="date" value={evictionForm.vacateDate ?? ""} onChange={e => setEvictionForm((f: any) => ({ ...f, vacateDate: e.target.value }))} />
              {evictionForm.groundCode && evictionForm.vacateDate && (() => {
                const minDays = ["owner_occupation","redevelopment"].includes(evictionForm.groundCode) ? 60 : 30;
                const days = Math.round((new Date(evictionForm.vacateDate).getTime() - Date.now()) / 86400000);
                if (days < minDays) return (
                  <p className="text-xs text-red-600 mt-0.5">
                    ⚠ Date is only {days} days away — minimum is {minDays} days for this ground
                  </p>
                );
                return null;
              })()}
            </div>
            <div>
              <Label className="text-xs">Additional reason / particulars</Label>
              <Input value={evictionForm.reason ?? ""} onChange={e => setEvictionForm((f: any) => ({ ...f, reason: e.target.value }))} placeholder="Specific details of the ground…" />
            </div>
            <div className="col-span-2 flex justify-end">
              <Button onClick={() => generateEviction.mutate()}
                disabled={!evictionForm.leaseId || !evictionForm.groundCode || !evictionForm.vacateDate || generateEviction.isPending}>
                {generateEviction.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FilePlus className="h-4 w-4 mr-1" />}
                Generate Notice
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generated notice preview */}
      {generatedHtml && (
        <Card className="border-emerald-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-emerald-800">{generatedTitle}</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => printDoc(generatedHtml, generatedTitle)}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />Download / Print PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => setGeneratedHtml(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden bg-white">
              <iframe
                srcDoc={generatedHtml}
                className="w-full h-80"
                title="Notice preview"
                sandbox="allow-same-origin"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Click "Download / Print PDF" — in the new tab, select "Save as PDF" from your browser's print dialog.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Notice history */}
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-semibold">Notice History</h3>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Label className="text-xs">Filter by lease</Label>
            <Select value={selectedLeaseForHistory} onValueChange={setSelectedLeaseForHistory}>
              <SelectTrigger><SelectValue placeholder="Select lease to view history…" /></SelectTrigger>
              <SelectContent>{leaseOptions.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selectedLeaseForHistory && noticeHistory.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No notices generated for this lease.</p>
          )}
          {noticeHistory.map((n: any) => (
            <div key={n.id} className="flex items-start justify-between gap-2 p-2.5 rounded-lg border text-sm mb-2">
              <div>
                <p className="font-mono text-xs font-semibold">{n.metadata?.noticeNumber ?? `Event #${n.id}`}</p>
                <p className="text-xs text-muted-foreground">{n.description}</p>
                <p className="text-xs text-muted-foreground">{fmt(n.createdAt)}</p>
              </div>
              <Badge variant="outline" className="shrink-0">{n.eventType?.replace(/_/g, " ")}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const VALID_TABS = ["service-charges", "kra", "stamp-duty", "valuations", "deposit-interest", "etims", "rrt"] as const;
type ComplianceTab = typeof VALID_TABS[number];

export default function NairobiCompliance() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  // Landlord clients only ever see "Rent Notices" (RRT) here — the KRA/tax-facing
  // sections below (KRA returns, eTIMS, stamp duty, valuations/CGT, deposit
  // interest, service charges) are hidden for that role only, since some landlord
  // clients are uneasy seeing KRA/tax tooling. Admin and manager are unaffected;
  // this can't be a plain source comment because it needs to depend on who's
  // logged in, not be removed for everyone — flip this flag if that changes.
  const landlordSeesRentNoticesOnly = guard.isLandlord;

  // useLocation returns only the pathname in wouter; useSearch returns the
  // query string (without the leading "?"), e.g. "tab=kra".
  const [, navigate] = useLocation();
  const search = useSearch(); // reactive to query-string changes

  // Parse the active tab from the query string every time search changes.
  const activeTab: ComplianceTab = (() => {
    if (landlordSeesRentNoticesOnly) return "rrt"; // ignore ?tab= entirely for landlords
    const t = new URLSearchParams(search).get("tab");
    return t && VALID_TABS.includes(t as ComplianceTab) ? (t as ComplianceTab) : "kra";
  })();

  // Clicking a tab: push the new URL. Because activeTab is derived directly
  // from useSearch (not useState), the tab switches instantly on re-render.
  function handleTabChange(tab: string) {
    if (landlordSeesRentNoticesOnly) return; // only one tab available; nothing to switch to
    navigate(`/compliance?tab=${tab}`, { replace: true });
  }

  const ALL_COMPLIANCE_TABS = [
    { id: "kra",             label: "KRA Returns",      icon: FileText,  desc: "Monthly rental income returns" },
    { id: "etims",           label: "eTIMS",            icon: Zap,       desc: "KRA e-invoicing" },
    { id: "stamp-duty",      label: "Stamp Duty",       icon: BookOpen,  desc: "Lease registration" },
    { id: "valuations",      label: "Valuations & CGT", icon: TrendingUp,desc: "Capital gains tracking" },
    { id: "deposit-interest",label: "Deposit Interest", icon: Calculator,desc: "CBK rate accrual" },
    { id: "service-charges", label: "Service Charges",  icon: PiggyBank, desc: "ARMA budgets & demands" },
    { id: "rrt",             label: "Rent Notices",     icon: Gavel,     desc: "RRT notices (Cap 296)" },
  ] as const;

  // See landlordSeesRentNoticesOnly above — the nav list a landlord sees is
  // filtered down to just Rent Notices; admin/manager get the full list.
  const COMPLIANCE_TABS = landlordSeesRentNoticesOnly
    ? ALL_COMPLIANCE_TABS.filter(tab => tab.id === "rrt")
    : ALL_COMPLIANCE_TABS;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Page header */}
      <div className="border-b border-border bg-card/50 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5">
            <Shield className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {landlordSeesRentNoticesOnly ? "Rent Notices" : "Nairobi Compliance"}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {landlordSeesRentNoticesOnly
                ? "RRT notices (Cap 296)"
                : "KRA returns · eTIMS · Stamp duty · Valuations (CGT 15%) · Deposit interest · Service charges · RRT notices"}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column layout: left nav + content */}
      <div className="max-w-7xl mx-auto flex min-h-[calc(100vh-5rem)]">

        {/* Left sidebar nav — desktop only */}
        <nav className="hidden lg:flex flex-col w-56 shrink-0 border-r border-border py-4 sticky top-0 h-[calc(100vh-5rem)] overflow-y-auto bg-card/30">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 mb-2">Sections</p>
          {COMPLIANCE_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-start gap-3 px-3 py-2.5 mx-2 rounded-xl text-left transition-all group ${
                activeTab === tab.id
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <tab.icon className={`w-4 h-4 mt-0.5 shrink-0 ${activeTab === tab.id ? "text-emerald-600" : ""}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{tab.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{tab.desc}</p>
              </div>
            </button>
          ))}
        </nav>

        {/* Mobile: scrollable pill tabs */}
        <div className="lg:hidden w-full">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide p-3 border-b border-border bg-card/30">
            {COMPLIANCE_TABS.map(tab => (
              <button key={tab.id} onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
                  activeTab === tab.id
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground bg-muted/40"
                }`}>
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-w-0">
          <TabsList className="hidden">
            {!landlordSeesRentNoticesOnly && (
              <>
                <TabsTrigger value="service-charges" /><TabsTrigger value="kra" />
                <TabsTrigger value="stamp-duty" /><TabsTrigger value="valuations" />
                <TabsTrigger value="deposit-interest" /><TabsTrigger value="etims" />
              </>
            )}
            <TabsTrigger value="rrt" />
          </TabsList>
          <div className="p-4 sm:p-6">
            {!landlordSeesRentNoticesOnly && (
              <>
                <TabsContent value="service-charges" className="mt-0"><ServiceChargesTab /></TabsContent>
                <TabsContent value="kra"             className="mt-0"><KraReturnsTab /></TabsContent>
                <TabsContent value="stamp-duty"      className="mt-0"><StampDutyTab /></TabsContent>
                <TabsContent value="valuations"      className="mt-0"><ValuationsTab /></TabsContent>
                <TabsContent value="deposit-interest" className="mt-0"><DepositInterestTab /></TabsContent>
                <TabsContent value="etims"           className="mt-0"><EtimsTab /></TabsContent>
              </>
            )}
            <TabsContent value="rrt"             className="mt-0"><RrtNoticesTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}