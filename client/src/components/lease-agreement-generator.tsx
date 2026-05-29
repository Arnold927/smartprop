/**
 * client/src/components/lease-agreement-generator.tsx
 *
 * Generates a downloadable, print-ready lease agreement PDF.
 * Works entirely client-side using the browser's print-to-PDF capability.
 * Ensures all legally essential details are present before allowing download.
 *
 * Usage:
 *   import LeaseAgreementGenerator from "@/components/lease-agreement-generator";
 *   <LeaseAgreementGenerator tenant={tenant} unitData={unitData} propertyData={propertyData} />
 */

import { useState } from "react";
import { openPrintWindow, spHeader, spFooter, fmtDocDate, SMARTPROP_DOC_CSS } from "@/lib/document-theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Download, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaseData {
  // Parties
  landlordName: string;
  landlordPhone: string;
  landlordEmail: string;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
  tenantIdNo: string;
  // Property
  propertyName: string;
  propertyAddress: string;
  unitNumber: string;
  unitDescription: string; // e.g. "2-bedroom apartment, 2nd floor"
  // Financial
  monthlyRent: string;
  currency: string;
  securityDeposit: string;
  rentDueDay: string; // e.g. "5th of every month"
  lateFeeAmount: string;
  lateFeeGraceDays: string;
  // Dates
  leaseStartDate: string;
  leaseEndDate: string;
  // Payment
  paymentMethod: string; // e.g. "M-Pesa Paybill 174379, Account: Unit 4A"
  // Utilities
  utilitiesIncluded: string; // e.g. "Water included. Electricity metered separately."
  // Rules
  petsAllowed: string;
  smokingPolicy: string;
  sublettingPolicy: string;
  maintenancePolicy: string;
  // Additional
  specialConditions: string;
  // Generated
  agreementDate: string;
  agreementNumber: string;
}

// ── Required field check ──────────────────────────────────────────────────────

const REQUIRED_FIELDS: Array<{ key: keyof LeaseData; label: string }> = [
  { key: "landlordName",    label: "Landlord name" },
  { key: "tenantName",      label: "Tenant name" },
  { key: "tenantIdNo",      label: "Tenant ID/Passport number" },
  { key: "propertyAddress", label: "Property address" },
  { key: "unitNumber",      label: "Unit number" },
  { key: "monthlyRent",     label: "Monthly rent" },
  { key: "securityDeposit", label: "Security deposit" },
  { key: "leaseStartDate",  label: "Lease start date" },
  { key: "leaseEndDate",    label: "Lease end date" },
  { key: "paymentMethod",   label: "Payment instructions" },
];

function getMissing(data: LeaseData): string[] {
  return REQUIRED_FIELDS
    .filter(f => !data[f.key]?.toString().trim())
    .map(f => f.label);
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildLeaseHtml(d: LeaseData): string {
  const fmtDate = (s: string) => {
    try { return format(new Date(s), "do MMMM yyyy"); } catch { return s; }
  };
  const currency   = d.currency || "KES";
  const fmtAmt     = (n: number | string) => `${currency} ${Math.round(Number(n)).toLocaleString("en-KE")}`;
  const deposit    = d.securityDeposit || d.monthlyRent;
  const agrNo      = d.agreementNumber || "—";
  // Lease type inferred: if endDate provided it's fixed-term, else periodic
  const leaseType  = d.leaseEndDate ? "Fixed Term" : "Periodic / Statutory";
  const NOTICE_DAYS = "30"; // standard Kenya notice period

  const body = `
    ${spHeader("Tenancy Agreement", agrNo, d.agreementDate)}

    <div class="sp-grid-2">
      <div class="sp-section">
        <div class="sp-section-title">Landlord / Property</div>
        <div class="sp-row"><span class="sp-label">Landlord</span><span class="sp-value">${d.landlordName}</span></div>
        ${d.landlordPhone ? `<div class="sp-row"><span class="sp-label">Phone</span><span class="sp-value">${d.landlordPhone}</span></div>` : ""}
        ${d.landlordEmail ? `<div class="sp-row"><span class="sp-label">Email</span><span class="sp-value">${d.landlordEmail}</span></div>` : ""}
        <div class="sp-row"><span class="sp-label">Property</span><span class="sp-value">${d.propertyAddress}</span></div>
        <div class="sp-row"><span class="sp-label">Unit</span><span class="sp-value">${d.unitNumber}</span></div>
        ${d.unitDescription ? `<div class="sp-row"><span class="sp-label">Description</span><span class="sp-value">${d.unitDescription}</span></div>` : ""}
      </div>
      <div class="sp-section">
        <div class="sp-section-title">Tenant</div>
        <div class="sp-row"><span class="sp-label">Tenant</span><span class="sp-value">${d.tenantName}</span></div>
        <div class="sp-row"><span class="sp-label">ID / Passport</span><span class="sp-value">${d.tenantIdNo || "—"}</span></div>
        ${d.tenantPhone ? `<div class="sp-row"><span class="sp-label">Phone</span><span class="sp-value">${d.tenantPhone}</span></div>` : ""}
        ${d.tenantEmail ? `<div class="sp-row"><span class="sp-label">Email</span><span class="sp-value">${d.tenantEmail}</span></div>` : ""}
      </div>
    </div>

    <div class="sp-amount-box">
      <div class="sp-amount">${fmtAmt(d.monthlyRent)}</div>
      <div class="sp-amount-label">Monthly Rent &nbsp;&middot;&nbsp; Due on the ${d.rentDueDay || "1st"} of each month</div>
    </div>

    <div class="sp-grid-2">
      <div class="sp-section">
        <div class="sp-section-title">Lease Terms</div>
        <div class="sp-row"><span class="sp-label">Start Date</span><span class="sp-value">${fmtDate(d.leaseStartDate)}</span></div>
        <div class="sp-row"><span class="sp-label">End Date</span><span class="sp-value">${d.leaseEndDate ? fmtDate(d.leaseEndDate) : "Periodic"}</span></div>
        <div class="sp-row"><span class="sp-label">Lease Type</span><span class="sp-value">${leaseType}</span></div>
        <div class="sp-row"><span class="sp-label">Notice Period</span><span class="sp-value">${NOTICE_DAYS} days</span></div>
      </div>
      <div class="sp-section">
        <div class="sp-section-title">Financials</div>
        <div class="sp-row"><span class="sp-label">Security Deposit</span><span class="sp-value">${fmtAmt(deposit)}</span></div>
        ${d.lateFeeAmount ? `<div class="sp-row"><span class="sp-label">Late Fee</span><span class="sp-value">${fmtAmt(d.lateFeeAmount)} (after ${d.lateFeeGraceDays || "5"} days)</span></div>` : ""}
        <div class="sp-row"><span class="sp-label">Currency</span><span class="sp-value">${currency}</span></div>
        <div class="sp-row"><span class="sp-label">Agreement No.</span><span class="sp-value">${agrNo}</span></div>
      </div>
    </div>

    ${d.paymentMethod ? `
    <div class="sp-section">
      <div class="sp-section-title">Payment Instructions</div>
      <div class="sp-panel"><p style="font-size:12px;color:#374151">${d.paymentMethod}</p></div>
    </div>` : ""}

    ${d.utilitiesIncluded ? `
    <div class="sp-section">
      <div class="sp-section-title">Utilities</div>
      <div class="sp-panel"><p style="font-size:12px;color:#374151">${d.utilitiesIncluded}</p></div>
    </div>` : ""}

    <div class="sp-section">
      <div class="sp-section-title">Terms &amp; Conditions</div>
      ${[
        { num: "1", title: "Rent Payment", text: `The Tenant shall pay ${fmtAmt(d.monthlyRent)} per month on or before the ${d.rentDueDay || "1st"} day of each month via the payment method specified above.` },
        { num: "2", title: "Security Deposit", text: `A security deposit of ${fmtAmt(deposit)} is held by the Landlord and shall be refunded within 30 days of lease end, subject to deductions for damages beyond fair wear and tear.` },
        { num: "3", title: "Pets", text: d.petsAllowed || "Pets are not permitted without prior written consent from the Landlord." },
        { num: "4", title: "Smoking", text: d.smokingPolicy || "Smoking is strictly prohibited within the premises." },
        { num: "5", title: "Subletting", text: d.sublettingPolicy || "The Tenant shall not sublet or assign the premises without prior written consent from the Landlord." },
        { num: "6", title: "Maintenance", text: d.maintenancePolicy || "The Tenant shall maintain the premises in good condition and promptly report any damage or required repairs." },
        { num: "7", title: "Termination", text: `Either party may terminate this agreement by giving ${NOTICE_DAYS} days written notice. Early termination by the Tenant may result in forfeiture of the security deposit.` },
        { num: "8", title: "Governing Law", text: "This agreement is governed by the Landlord and Tenant Act (Cap 301) and any other applicable laws of Kenya." },
      ].map(c => `
        <div class="sp-clause">
          <div class="sp-clause-title">${c.num}. ${c.title}</div>
          ${c.text}
        </div>
      `).join("")}
    </div>

    ${d.specialConditions ? `
    <div class="sp-section">
      <div class="sp-section-title">Special Conditions</div>
      <div class="sp-panel"><p style="font-size:12px;color:#374151;white-space:pre-wrap">${d.specialConditions}</p></div>
    </div>` : ""}

    <div class="sp-sig-grid">
      <div>
        <div class="sp-section-title">Landlord</div>
        <div class="sp-sig-line">Signature</div>
        <div style="font-size:12px;font-weight:700">${d.landlordName}</div>
        <div style="font-size:11px;color:#64748b">Date: ________________</div>
      </div>
      <div>
        <div class="sp-section-title">Tenant</div>
        <div class="sp-sig-line">Signature</div>
        <div style="font-size:12px;font-weight:700">${d.tenantName}</div>
        <div style="font-size:11px;color:#64748b">Date: ________________</div>
      </div>
    </div>

    ${spFooter(`Agreement No. ${agrNo} &nbsp;&middot;&nbsp; ${fmtDate(d.agreementDate)}`)}
  `;

  return body;
}
// ── Download helper ───────────────────────────────────────────────────────────
// Now uses the shared openPrintWindow from document-theme for consistency.
function downloadAsPdf(body: string, title: string) {
  openPrintWindow(body, title);
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LeaseAgreementGenerator({
  tenant,
  unitData,
  propertyData,
}: {
  tenant?: any;
  unitData?: any;
  propertyData?: any;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const agreementNumber = `LA-${Date.now().toString(36).toUpperCase()}`;

  const [data, setData] = useState<LeaseData>({
    // Pre-fill from props
    landlordName: propertyData?.ownerName ?? "",
    landlordPhone: propertyData?.ownerPhone ?? "",
    landlordEmail: propertyData?.ownerEmail ?? "",
    tenantName: tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "",
    tenantPhone: tenant?.phone ?? "",
    tenantEmail: tenant?.email ?? "",
    tenantIdNo: "",
    propertyName: propertyData?.name ?? "",
    propertyAddress: propertyData?.address ?? "",
    unitNumber: unitData?.unitNumber ?? tenant?.unitNumber ?? "",
    unitDescription: "",
    monthlyRent: tenant?.monthlyRent ?? unitData?.monthlyRent ?? "",
    currency: tenant?.currency ?? "KES",
    securityDeposit: tenant?.securityDeposit ?? "",
    rentDueDay: "5th",
    lateFeeAmount: "",
    lateFeeGraceDays: "5",
    leaseStartDate: tenant?.leaseStartDate ?? "",
    leaseEndDate: tenant?.leaseEndDate ?? "",
    paymentMethod: "",
    utilitiesIncluded: "",
    petsAllowed: "Pets are not permitted without prior written approval from the Landlord.",
    smokingPolicy: "Smoking is strictly prohibited within the premises and common areas.",
    sublettingPolicy: "The Tenant shall not sublet or assign the premises without prior written consent.",
    maintenancePolicy: "The Landlord is responsible for structural repairs. The Tenant handles minor repairs up to KES 2,000.",
    specialConditions: "",
    agreementDate: today,
    agreementNumber,
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (patch: Partial<LeaseData>) => setData(d => ({ ...d, ...patch }));

  const missing = getMissing(data);
  const canDownload = missing.length === 0;

  return (
    <Card className="rounded-2xl border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-500" /> Lease Agreement Generator
        </CardTitle>
        <CardDescription>
          Fill in the required details below to generate a downloadable, print-ready tenancy agreement PDF.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Completion status */}
        {missing.length > 0 ? (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                  {missing.length} required field{missing.length > 1 ? "s" : ""} missing
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {missing.map(m => (
                    <Badge key={m} className="text-[11px] bg-yellow-100 text-yellow-800 border-yellow-200">{m}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 p-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">All required fields complete — ready to download</p>
          </div>
        )}

        {/* ── Section 1: Parties ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Landlord Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Full Name *</Label><Input placeholder="e.g. John Kamau" value={data.landlordName} onChange={e => set({ landlordName: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Phone</Label><Input placeholder="07XX XXX XXX" value={data.landlordPhone} onChange={e => set({ landlordPhone: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Email</Label><Input placeholder="landlord@email.com" value={data.landlordEmail} onChange={e => set({ landlordEmail: e.target.value })} /></div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Tenant Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Full Name *</Label><Input value={data.tenantName} onChange={e => set({ tenantName: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">ID / Passport No. *</Label><Input placeholder="National ID or Passport" value={data.tenantIdNo} onChange={e => set({ tenantIdNo: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={data.tenantPhone} onChange={e => set({ tenantPhone: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={data.tenantEmail} onChange={e => set({ tenantEmail: e.target.value })} /></div>
          </div>
        </div>

        <Separator />

        {/* ── Section 2: Property ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Property & Unit</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Property Name</Label><Input value={data.propertyName} onChange={e => set({ propertyName: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Unit Number *</Label><Input value={data.unitNumber} onChange={e => set({ unitNumber: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">Full Address *</Label><Input placeholder="e.g. Apt 4A, ABC Apartments, Westlands, Nairobi" value={data.propertyAddress} onChange={e => set({ propertyAddress: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">Unit Description</Label><Input placeholder="e.g. 2-bedroom apartment, 2nd floor, with parking" value={data.unitDescription} onChange={e => set({ unitDescription: e.target.value })} /></div>
          </div>
        </div>

        <Separator />

        {/* ── Section 3: Financial ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Financial Terms</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Monthly Rent (KES) *</Label><Input type="number" value={data.monthlyRent} onChange={e => set({ monthlyRent: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Security Deposit (KES) *</Label><Input type="number" value={data.securityDeposit} onChange={e => set({ securityDeposit: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Rent Due Day</Label><Input placeholder="e.g. 5th" value={data.rentDueDay} onChange={e => set({ rentDueDay: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Late Fee (KES, optional)</Label><Input type="number" value={data.lateFeeAmount} onChange={e => set({ lateFeeAmount: e.target.value })} /></div>
          </div>
        </div>

        <Separator />

        {/* ── Section 4: Dates ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Tenancy Period</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Start Date *</Label><Input type="date" value={data.leaseStartDate} onChange={e => set({ leaseStartDate: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">End Date *</Label><Input type="date" value={data.leaseEndDate} onChange={e => set({ leaseEndDate: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Agreement Date</Label><Input type="date" value={data.agreementDate} onChange={e => set({ agreementDate: e.target.value })} /></div>
          </div>
        </div>

        <Separator />

        {/* ── Section 5: Payment & Utilities ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Payment & Utilities</h3>
          <div className="space-y-1">
            <Label className="text-xs">Payment Instructions * <span className="font-normal text-gray-400">(shown in the agreement)</span></Label>
            <Textarea
              placeholder={`e.g.\nM-Pesa Paybill: 174379\nAccount No: Unit 4A\n\nOr Bank Transfer:\nEquity Bank, A/C: 0123456789 (ABC Properties Ltd)`}
              rows={4}
              value={data.paymentMethod}
              onChange={e => set({ paymentMethod: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Utilities Included</Label>
            <Textarea
              placeholder="e.g. Water included in rent. Electricity is metered separately and billed monthly."
              rows={2}
              value={data.utilitiesIncluded}
              onChange={e => set({ utilitiesIncluded: e.target.value })}
            />
          </div>
        </div>

        {/* ── Advanced / House Rules ── */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {showAdvanced ? "Hide" : "Show"} house rules & special conditions
        </button>

        {showAdvanced && (
          <div className="space-y-3 pt-1">
            <Separator />
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">House Rules & Policies</h3>
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Pets Policy</Label><Textarea rows={2} value={data.petsAllowed} onChange={e => set({ petsAllowed: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Smoking Policy</Label><Textarea rows={2} value={data.smokingPolicy} onChange={e => set({ smokingPolicy: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Subletting Policy</Label><Textarea rows={2} value={data.sublettingPolicy} onChange={e => set({ sublettingPolicy: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Maintenance Responsibility</Label><Textarea rows={2} value={data.maintenancePolicy} onChange={e => set({ maintenancePolicy: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Special Conditions</Label><Textarea rows={3} placeholder="Any additional conditions specific to this tenancy..." value={data.specialConditions} onChange={e => set({ specialConditions: e.target.value })} /></div>
            </div>
          </div>
        )}

        {/* ── Download button ── */}
        <Button
          className="w-full h-11 text-sm font-semibold"
          style={{ background: canDownload ? "#7c3aed" : undefined }}
          disabled={!canDownload}
          onClick={() => downloadAsPdf(buildLeaseHtml(data), `Lease-${data.tenantName}-${data.unitNumber}.pdf`)}
        >
          <Download className="w-4 h-4 mr-2" />
          {canDownload ? "Download Lease Agreement PDF" : `Complete ${missing.length} required field${missing.length > 1 ? "s" : ""} first`}
        </Button>

        <p className="text-xs text-center text-gray-400">
          Opens a print dialog — choose "Save as PDF" to download. Both parties should sign the printed copy.
        </p>
      </CardContent>
    </Card>
  );
}