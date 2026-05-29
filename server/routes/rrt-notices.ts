/**
 * server/routes/rrt-notices.ts
 *
 * Rent Restriction Tribunal (RRT) notice API — mounted at /api/compliance/rrt
 *
 * The Rent Restriction Tribunal operates under the Rent Restriction Act
 * (Cap 296, Laws of Kenya). For dwellings whose monthly rent does not exceed
 * KES 2,500 in Nairobi/major municipalities (or other prescribed limits), the
 * RRT has jurisdiction. Even for non-controlled premises, landlords widely use
 * the RRT notice format as the industry standard to evidence proper statutory
 * notice, avoiding tribunal proceedings.
 *
 * Endpoints
 * ─────────
 *   POST /api/compliance/rrt/rent-increase
 *     Generate a Rent Increase Notice (s.9 Rent Restriction Act / Landlord & Tenant Act s.6)
 *     Body: { leaseId, newRent, effectiveDate, reason?, noticePeriodDays? }
 *     Returns: { noticeNumber, noticeHtml, leaseId, newRent, effectiveDate }
 *
 *   POST /api/compliance/rrt/eviction-notice
 *     Generate a Notice to Vacate (s.12 Rent Restriction Act / S.4 Distress for Rent Act)
 *     Body: { leaseId, groundCode, vacateDate, reason? }
 *     Returns: { noticeNumber, noticeHtml, leaseId, groundCode, vacateDate }
 *
 *   GET  /api/compliance/rrt/notices/:leaseId
 *     List all generated notices for a lease (from audit log)
 *     Returns: LeaseEvent[]
 */

import { Router } from "express";
import { db } from "../db";
import {
  leases, tenants, units, properties, users,
  leaseEvents,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { format, addDays, parseISO, isValid } from "date-fns";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextNoticeNumber(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function fmtDate(d: string | Date): string {
  const dt = typeof d === "string" ? parseISO(d.split("T")[0]) : d;
  if (!isValid(dt)) return String(d);
  return format(dt, "do MMMM yyyy");
}

function fmtKES(amount: number | string, currency = "KES"): string {
  return `${currency} ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Resolve full lease + related tenant / unit / property in one query */
async function fetchLeaseContext(leaseId: number, orgId: number) {
  const [lease] = await db
    .select()
    .from(leases)
    .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)));
  if (!lease) return null;

  const [tenant]   = lease.tenantId   ? await db.select().from(tenants).where(eq(tenants.id, lease.tenantId))           : [];
  const [unit]     = lease.unitId     ? await db.select().from(units).where(eq(units.id, lease.unitId))                 : [];
  const [property] = lease.propertyId ? await db.select().from(properties).where(eq(properties.id, lease.propertyId)) : [];

  // Resolve owner name from users table via property.ownerId
  let ownerName = "Landlord";
  if (property?.ownerId) {
    const [owner] = await db.select().from(users).where(eq(users.id, property.ownerId));
    if (owner) {
      ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email;
    }
  }

  return { lease, tenant, unit, property, ownerName };
}

// ─── RRT Rent Increase Notice HTML builder ───────────────────────────────────

const EVICTION_GROUNDS: Record<string, string> = {
  non_payment:         "Non-Payment of Rent (Section 12(a) Rent Restriction Act, Cap 296)",
  breach_of_agreement: "Breach of Tenancy Agreement (Section 12(b) Rent Restriction Act, Cap 296)",
  owner_occupation:    "Owner / Bona Fide Purchaser Occupation (Section 12(c) Rent Restriction Act, Cap 296)",
  redevelopment:       "Redevelopment or Renovation Requiring Vacant Possession (Section 12(d) Rent Restriction Act, Cap 296)",
  nuisance:            "Causing a Nuisance or Annoyance to Adjoining Occupiers (Section 12(e) Rent Restriction Act, Cap 296)",
  illegal_use:         "Use of Premises for Illegal or Immoral Purposes (Section 12(f) Rent Restriction Act, Cap 296)",
  subletting_without_consent: "Subletting Without Consent of Landlord (Section 12(g) Rent Restriction Act, Cap 296)",
};

function buildRentIncreaseHtml(ctx: {
  noticeNumber: string;
  landlordName: string;
  tenantName: string;
  tenantIdNo?: string;
  propertyName: string;
  propertyAddress: string;
  unitNumber: string;
  currentRent: number;
  newRent: number;
  currency: string;
  effectiveDate: string;
  noticePeriodDays: number;
  noticeDate: string;
  reason: string;
}): string {
  const increase = ctx.newRent - ctx.currentRent;
  const pct = ctx.currentRent > 0 ? ((increase / ctx.currentRent) * 100).toFixed(1) : "0";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Rent Increase Notice — ${ctx.noticeNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:13px; color:#1e293b; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .page { max-width:820px; margin:0 auto; padding:40px; }
    /* Header */
    .sp-header { background:linear-gradient(135deg,#065f46 0%,#059669 100%); padding:24px 32px; display:flex; justify-content:space-between; align-items:center; margin:-40px -40px 32px -40px; }
    .sp-brand { color:#fff; font-size:22px; font-weight:800; letter-spacing:-0.5px; line-height:1; }
    .sp-brand-sub { color:#a7f3d0; font-size:11px; font-weight:400; margin-top:3px; }
    .sp-doc-meta { text-align:right; color:#fff; }
    .sp-doc-label { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#a7f3d0; margin-bottom:4px; }
    .sp-doc-number { font-size:18px; font-weight:700; }
    .sp-doc-date { font-size:11px; color:#d1fae5; margin-top:3px; }
    /* Layout */
    .section { margin-bottom:28px; }
    .section-title { font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#059669; border-bottom:1.5px solid #d1fae5; padding-bottom:5px; margin-bottom:10px; }
    .row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:13px; }
    .row .label { color:#64748b; }
    .row .value { font-weight:600; text-align:right; max-width:55%; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:0; margin-bottom:24px; }
    .col-left { padding-right:24px; }
    .col-right { padding-left:24px; border-left:1px solid #e2e8f0; }
    /* Amount box */
    .amount-box { background:#fefce8; border:2px solid #d97706; border-radius:12px; padding:18px 24px; margin:20px 0; display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
    .amount-item .amount-label { font-size:10px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:#92400e; }
    .amount-item .amount-value { font-size:22px; font-weight:800; color:#78350f; letter-spacing:-0.5px; margin-top:2px; }
    .amount-item .amount-value.new { color:#b45309; font-size:28px; }
    /* Panels */
    .highlight { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; margin:12px 0; }
    /* Clauses */
    .clause-block { margin-bottom:10px; font-size:13px; line-height:1.8; text-align:justify; }
    .clause-num { font-weight:700; margin-right:6px; color:#059669; }
    /* Warning */
    .warning-box { background:#fff7ed; border:2px solid #f97316; border-radius:10px; padding:14px 18px; margin:16px 0; }
    .warning-box .warning-title { font-weight:700; color:#c2410c; font-size:13px; margin-bottom:6px; }
    /* Signatures */
    .sig-grid { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:36px; }
    .sig-block { padding-top:8px; }
    .sig-name { font-weight:700; font-size:14px; }
    .sig-role { font-size:11px; color:#64748b; margin-top:2px; }
    .sig-line { height:44px; border-bottom:1.5px solid #1e293b; margin:10px 0 4px; }
    .sig-hint { font-size:10px; color:#94a3b8; }
    /* Footer */
    .footer { margin-top:40px; padding-top:14px; border-top:1px solid #e2e8f0; font-size:10px; color:#94a3b8; text-align:center; line-height:1.7; }
    .statute-note { font-style:italic; }
    /* Print */
    .sp-print-btn { background:#059669; color:#fff; border:none; padding:10px 24px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; display:block; margin-bottom:24px; }
    @media print { .sp-print-btn { display:none!important; } .page { padding:0; } .sp-header { margin:0 0 28px 0; } }
    @page { margin:14mm; }
  </style>
</head>
<body>
<div class="page">

  <button class="sp-print-btn" onclick="window.print()">&#8595; Save as PDF &nbsp;(File &rarr; Print &rarr; Save as PDF)</button>
  <div class="sp-header">
    <div>
      <div class="sp-brand">Smart<span style="color:#a7f3d0">Prop</span></div>
      <div style="font-size:12px;color:#555;margin-top:4px">${ctx.propertyName}</div>
      <div style="font-size:11px;color:#888">${ctx.propertyAddress}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#666;text-transform:uppercase">Rent Increase Notice</div>
      <div style="font-size:18px;font-weight:700;margin-top:2px">${ctx.noticeNumber}</div>
      <div class="notice-ref">Issued: ${fmtDate(ctx.noticeDate)}</div>
      <div class="badge">RRT NOTICE</div>
    </div>
  </div>

  <!-- Statutory basis -->
  <div class="highlight" style="margin-bottom:24px">
    <div class="statute-note">
      Issued pursuant to the <strong>Landlord and Tenant (Shops, Hotels and Catering Establishments) Act, Cap 301</strong>
      and the <strong>Rent Restriction Act, Cap 296, Laws of Kenya</strong>.
      This notice constitutes formal statutory notice of a change in rent payable.
    </div>
  </div>

  <!-- Parties -->
  <div class="section">
    <div class="section-title">1. The Parties</div>
    <div class="grid-2">
      <div class="col-left">
        <div style="font-size:11px;font-weight:700;color:#ca8a04;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">🏠 Landlord / Lessor</div>
        <div class="row"><span class="label">Full Name</span><span class="value">${ctx.landlordName}</span></div>
      </div>
      <div class="col-right">
        <div style="font-size:11px;font-weight:700;color:#ca8a04;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">👤 Tenant / Lessee</div>
        <div class="row"><span class="label">Full Name</span><span class="value">${ctx.tenantName}</span></div>
        ${ctx.tenantIdNo ? `<div class="row"><span class="label">ID / Passport No.</span><span class="value">${ctx.tenantIdNo}</span></div>` : ""}
      </div>
    </div>
  </div>

  <!-- Premises -->
  <div class="section">
    <div class="section-title">2. Premises</div>
    <div class="highlight">
      <div class="row"><span class="label">Property</span><span class="value">${ctx.propertyName}</span></div>
      <div class="row"><span class="label">Address</span><span class="value">${ctx.propertyAddress}</span></div>
      <div class="row"><span class="label">Unit / House No.</span><span class="value">${ctx.unitNumber}</span></div>
    </div>
  </div>

  <!-- Rent Change -->
  <div class="section">
    <div class="section-title">3. Rent Change</div>
    <div class="amount-box">
      <div class="amount-item">
        <div class="amount-label">Current Rent</div>
        <div class="amount-value">${fmtKES(ctx.currentRent, ctx.currency)}</div>
      </div>
      <div class="amount-item">
        <div class="amount-label">New Rent</div>
        <div class="amount-value new">${fmtKES(ctx.newRent, ctx.currency)}</div>
      </div>
      <div class="amount-item">
        <div class="amount-label">Increase</div>
        <div class="amount-value">${fmtKES(increase, ctx.currency)}<br><span style="font-size:14px;color:#92400e">(+${pct}%)</span></div>
      </div>
    </div>
    <div class="row"><span class="label">Effective Date</span><span class="value" style="color:#b45309;font-size:15px;font-weight:700">${fmtDate(ctx.effectiveDate)}</span></div>
    <div class="row"><span class="label">Notice Period</span><span class="value">${ctx.noticePeriodDays} days from issue date</span></div>
  </div>

  <!-- Reason -->
  ${ctx.reason ? `
  <div class="section">
    <div class="section-title">4. Reason for Increase</div>
    <div class="highlight" style="white-space:pre-wrap;line-height:1.7">${ctx.reason}</div>
  </div>` : ""}

  <!-- Statutory notices -->
  <div class="section">
    <div class="section-title">${ctx.reason ? "5" : "4"}. Statutory Notice to Tenant</div>
    <div class="clause-block">
      <span class="clause-num">${ctx.reason ? "5.1" : "4.1"}</span>
      TAKE NOTICE that as and from <strong>${fmtDate(ctx.effectiveDate)}</strong>, the monthly rent payable
      in respect of the premises described above shall be increased to
      <strong>${fmtKES(ctx.newRent, ctx.currency)} per month</strong>.
    </div>
    <div class="clause-block">
      <span class="clause-num">${ctx.reason ? "5.2" : "4.2"}</span>
      This notice is issued in accordance with the requirements of the <em>Landlord and Tenant Act</em> and
      gives you not less than <strong>${ctx.noticePeriodDays} days'</strong> notice prior to the effective date of the rent change.
    </div>
    <div class="clause-block">
      <span class="clause-num">${ctx.reason ? "5.3" : "4.3"}</span>
      If you wish to dispute this rent increase, you may apply to the
      <strong>Rent Restriction Tribunal</strong> within <strong>30 days</strong> of receipt of this notice
      (Section 9, Rent Restriction Act, Cap 296).
    </div>
    <div class="clause-block">
      <span class="clause-num">${ctx.reason ? "5.4" : "4.4"}</span>
      If you do not dispute this increase within the said period, the new rent shall be deemed
      accepted and shall become payable from <strong>${fmtDate(ctx.effectiveDate)}</strong>.
    </div>
  </div>

  <!-- Warning box -->
  <div class="warning-box">
    <div class="warning-title">⚠️ Important — Tenant's Rights</div>
    <div class="clause-block" style="margin:0;color:#7c2d12">
      You have the right to challenge this rent increase at the <strong>Rent Restriction Tribunal</strong>
      at your local magistrate's court. Applications must be lodged within <strong>30 days</strong> of
      receiving this notice. The Tribunal will determine a fair rent if the increase is found to be
      unreasonable. Tribunal hearings are accessible without legal representation.
    </div>
  </div>

  <!-- Signatures -->
  <div class="section">
    <div class="section-title">Acknowledgement of Receipt</div>
    <div class="clause-block">The Tenant is requested to sign the duplicate copy of this notice to acknowledge receipt. Failure to sign does not invalidate this notice if duly served.</div>
    <div class="sig-grid">
      <div class="sig-block">
        <div class="sig-name">${ctx.landlordName}</div>
        <div class="sig-role">Landlord / Authorised Agent</div>
        <div class="sig-line"></div>
        <div class="sig-hint">Signature &amp; Date</div>
      </div>
      <div class="sig-block">
        <div class="sig-name">${ctx.tenantName}</div>
        <div class="sig-role">Tenant — Acknowledgement of Receipt</div>
        <div class="sig-line"></div>
        <div class="sig-hint">Signature &amp; Date of Receipt</div>
      </div>
    </div>
  </div>

  <div class="footer">
    This notice was generated by SmartProp Property Management System &nbsp;|&nbsp; ${ctx.noticeNumber} &nbsp;|&nbsp; Issued ${fmtDate(ctx.noticeDate)}<br>
    <span class="statute-note">
      Governing legislation: Rent Restriction Act Cap 296 · Landlord and Tenant (Shops, Hotels &amp; Catering Establishments) Act Cap 301 ·
      Distress for Rent Act Cap 293 — Laws of Kenya.
    </span>
  </div>

</div>
</body>
</html>`;
}

// ─── RRT Eviction / Notice to Vacate HTML builder ────────────────────────────

function buildEvictionHtml(ctx: {
  noticeNumber: string;
  landlordName: string;
  tenantName: string;
  tenantIdNo?: string;
  propertyName: string;
  propertyAddress: string;
  unitNumber: string;
  currentRent: number;
  currency: string;
  groundCode: string;
  groundText: string;
  vacateDate: string;
  noticePeriodDays: number;
  noticeDate: string;
  reason: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Notice to Vacate — ${ctx.noticeNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Arial,sans-serif; font-size:13px; color:#111; background:#fff; }
    .page { max-width:820px; margin:0 auto; padding:44px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:20px; margin-bottom:28px; }
    .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
    .brand span { color:#059669; }
    .badge { display:inline-block; background:#fef2f2; border:2px solid #dc2626; border-radius:8px; padding:4px 14px; color:#991b1b; font-size:11px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; margin-top:6px; }
    .notice-ref { font-size:11px; color:#888; margin-top:4px; }
    .section-title { font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#666; margin-bottom:10px; border-bottom:1px solid #e5e7eb; padding-bottom:6px; }
    .row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:13px; }
    .row .label { color:#555; }
    .row .value { font-weight:600; text-align:right; max-width:60%; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:0; margin-bottom:24px; }
    .col-left { padding-right:24px; }
    .col-right { padding-left:24px; border-left:1px solid #e5e7eb; }
    .highlight { background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:14px 18px; margin:12px 0; }
    .ground-box { background:#fef2f2; border:2px solid #dc2626; border-radius:10px; padding:16px 20px; margin:16px 0; }
    .ground-box .ground-title { font-weight:700; color:#991b1b; font-size:13px; margin-bottom:4px; }
    .section { margin-bottom:28px; }
    .clause-block { margin-bottom:10px; font-size:13px; line-height:1.8; text-align:justify; }
    .clause-num { font-weight:700; margin-right:6px; color:#dc2626; }
    .rights-box { background:#fff7ed; border:2px solid #f97316; border-radius:10px; padding:14px 18px; margin:16px 0; }
    .rights-box .rights-title { font-weight:700; color:#c2410c; font-size:13px; margin-bottom:6px; }
    .sig-grid { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:36px; }
    .sig-block { border-top:1px solid #333; padding-top:8px; }
    .sig-name { font-weight:700; font-size:14px; }
    .sig-role { font-size:11px; color:#555; margin-top:2px; }
    .sig-line { height:44px; border-bottom:1px solid #aaa; margin:10px 0 4px; }
    .sig-hint { font-size:10px; color:#888; }
    .footer { margin-top:40px; padding-top:14px; border-top:1px solid #e5e7eb; font-size:11px; color:#888; text-align:center; line-height:1.7; }
    .statute-note { font-size:11px; color:#888; font-style:italic; }
    @media print { body { font-size:12px; } .page { padding:20px; } }
  </style>
</head>
<body>
<div class="page">

  <button class="sp-print-btn" onclick="window.print()">&#8595; Save as PDF &nbsp;(File &rarr; Print &rarr; Save as PDF)</button>
  <div class="sp-header">
    <div>
      <div class="sp-brand">Smart<span style="color:#a7f3d0">Prop</span></div>
      <div style="font-size:12px;color:#555;margin-top:4px">${ctx.propertyName}</div>
      <div style="font-size:11px;color:#888">${ctx.propertyAddress}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#666;text-transform:uppercase">Notice to Vacate</div>
      <div style="font-size:18px;font-weight:700;margin-top:2px">${ctx.noticeNumber}</div>
      <div class="notice-ref">Issued: ${fmtDate(ctx.noticeDate)}</div>
      <div class="badge">RRT EVICTION NOTICE</div>
    </div>
  </div>

  <!-- Statutory basis -->
  <div class="highlight" style="margin-bottom:24px">
    <div class="statute-note">
      Issued pursuant to the <strong>Rent Restriction Act, Cap 296</strong> and the
      <strong>Landlord and Tenant (Shops, Hotels and Catering Establishments) Act, Cap 301, Laws of Kenya</strong>.
      This notice is a formal statutory requirement before any recovery of possession proceedings.
    </div>
  </div>

  <!-- Parties -->
  <div class="section">
    <div class="section-title">1. The Parties</div>
    <div class="grid-2">
      <div class="col-left">
        <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">🏠 Landlord / Lessor</div>
        <div class="row"><span class="label">Full Name</span><span class="value">${ctx.landlordName}</span></div>
      </div>
      <div class="col-right">
        <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">👤 Tenant / Lessee</div>
        <div class="row"><span class="label">Full Name</span><span class="value">${ctx.tenantName}</span></div>
        ${ctx.tenantIdNo ? `<div class="row"><span class="label">ID / Passport No.</span><span class="value">${ctx.tenantIdNo}</span></div>` : ""}
      </div>
    </div>
  </div>

  <!-- Premises -->
  <div class="section">
    <div class="section-title">2. Premises</div>
    <div class="highlight">
      <div class="row"><span class="label">Property</span><span class="value">${ctx.propertyName}</span></div>
      <div class="row"><span class="label">Address</span><span class="value">${ctx.propertyAddress}</span></div>
      <div class="row"><span class="label">Unit / House No.</span><span class="value">${ctx.unitNumber}</span></div>
      <div class="row"><span class="label">Monthly Rent</span><span class="value">${fmtKES(ctx.currentRent, ctx.currency)}</span></div>
    </div>
  </div>

  <!-- Ground -->
  <div class="section">
    <div class="section-title">3. Ground for Possession</div>
    <div class="ground-box">
      <div class="ground-title">Statutory Ground:</div>
      <div style="color:#7f1d1d;font-size:13px;line-height:1.7">${ctx.groundText}</div>
    </div>
    ${ctx.reason ? `
    <div class="section-title" style="margin-top:16px">Particulars</div>
    <div class="highlight" style="white-space:pre-wrap;line-height:1.7">${ctx.reason}</div>` : ""}
  </div>

  <!-- Direction to vacate -->
  <div class="section">
    <div class="section-title">4. Direction to Vacate</div>
    <div class="clause-block">
      <span class="clause-num">4.1</span>
      YOU ARE HEREBY REQUIRED to vacate and deliver up vacant possession of the above-mentioned
      premises <strong>on or before ${fmtDate(ctx.vacateDate)}</strong>, being not less than
      <strong>${ctx.noticePeriodDays} days</strong> from the date of service of this notice.
    </div>
    <div class="clause-block">
      <span class="clause-num">4.2</span>
      Upon vacation, you shall return all keys, access cards, and any property belonging to the Landlord
      in a clean condition. The security deposit shall be reconciled within <strong>30 days</strong>
      of vacation in accordance with the terms of your tenancy agreement.
    </div>
    <div class="clause-block">
      <span class="clause-num">4.3</span>
      If you fail to vacate by the said date, the Landlord reserves the right to apply to the
      <strong>Rent Restriction Tribunal</strong> or a court of competent jurisdiction for an order
      of possession. You may be liable for the Landlord's legal costs.
    </div>
    <div style="text-align:center;margin:20px 0">
      <div style="display:inline-block;border:3px solid #dc2626;border-radius:8px;padding:8px 24px;color:#dc2626;font-weight:800;font-size:15px;letter-spacing:2px">
        VACATE BY: ${fmtDate(ctx.vacateDate)}
      </div>
    </div>
  </div>

  <!-- Tenant rights -->
  <div class="rights-box">
    <div class="rights-title">⚠️ Important — Tenant's Rights</div>
    <div class="clause-block" style="margin:0;color:#7c2d12">
      You have the right to contest this notice before the <strong>Rent Restriction Tribunal</strong>
      at your local magistrate's court. You should seek legal advice immediately.
      The Landlord <strong>cannot forcibly evict you</strong> without a valid court or tribunal order —
      this includes changing locks, removing your belongings, or cutting off utilities.
      Such actions constitute an offence under the <em>Trespass Act, Cap 294</em>.
    </div>
  </div>

  <!-- Service -->
  <div class="section">
    <div class="section-title">5. Service of Notice</div>
    <div class="clause-block">
      This notice is served on <strong>${fmtDate(ctx.noticeDate)}</strong> by:
      <br>☐ Personal delivery &nbsp;&nbsp;☐ Registered post &nbsp;&nbsp;☐ Left at premises &nbsp;&nbsp;☐ Email / WhatsApp (with read receipt)
    </div>
    <div class="sig-grid">
      <div class="sig-block">
        <div class="sig-name">${ctx.landlordName}</div>
        <div class="sig-role">Landlord / Authorised Agent</div>
        <div class="sig-line"></div>
        <div class="sig-hint">Signature &amp; Date</div>
      </div>
      <div class="sig-block">
        <div class="sig-name">${ctx.tenantName}</div>
        <div class="sig-role">Acknowledgement of Receipt (if served personally)</div>
        <div class="sig-line"></div>
        <div class="sig-hint">Signature &amp; Date of Receipt</div>
      </div>
    </div>
  </div>

  <div class="footer">
    This notice was generated by SmartProp Property Management System &nbsp;|&nbsp; ${ctx.noticeNumber} &nbsp;|&nbsp; Issued ${fmtDate(ctx.noticeDate)}<br>
    <span class="statute-note">
      Governing legislation: Rent Restriction Act Cap 296 · Landlord and Tenant (Shops, Hotels &amp; Catering Establishments) Act Cap 301 ·
      Distress for Rent Act Cap 293 · Trespass Act Cap 294 — Laws of Kenya.
    </span>
  </div>

</div>
</body>
</html>`;
}

// ─── POST /rent-increase ──────────────────────────────────────────────────────

router.post("/rent-increase", ...auth, async (req: any, res: any) => {
  try {
    const { leaseId, newRent, effectiveDate, reason = "", noticePeriodDays = 30 } = req.body;

    if (!leaseId || !newRent || !effectiveDate) {
      return res.status(400).json({ message: "leaseId, newRent and effectiveDate are required" });
    }

    const orgId = req.user.organizationId as number;
    const ctx = await fetchLeaseContext(Number(leaseId), orgId);
    if (!ctx) return res.status(404).json({ message: "Lease not found" });

    const { lease, tenant, unit, property, ownerName } = ctx;
    const noticeNumber = nextNoticeNumber("RRT-RI");
    const noticeDate = new Date().toISOString().slice(0, 10);

    // Validate effective date is at least noticePeriodDays in the future
    const effectiveDateObj = parseISO(effectiveDate);
    const minEffective = addDays(new Date(), noticePeriodDays);
    if (effectiveDateObj < minEffective) {
      return res.status(400).json({
        message: `Effective date must be at least ${noticePeriodDays} days from today (minimum: ${format(minEffective, "yyyy-MM-dd")})`,
      });
    }

    const htmlCtx = {
      noticeNumber,
      landlordName: ownerName,
      tenantName: tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "Tenant",
      tenantIdNo: (tenant as any)?.nationalId ?? undefined,
      propertyName: property?.name ?? "—",
      propertyAddress: property?.address ?? "—",
      unitNumber: unit?.unitNumber ?? lease.unitId?.toString() ?? "—",
      currentRent: Number(lease.monthlyRent),
      newRent: Number(newRent),
      currency: lease.currency ?? "KES",
      effectiveDate,
      noticePeriodDays: Number(noticePeriodDays),
      noticeDate,
      reason,
    };

    const noticeHtml = buildRentIncreaseHtml(htmlCtx);

    // Log to lease events audit trail
    try {
      await db.insert(leaseEvents).values({
        leaseId: lease.id,
        organizationId: orgId,
        eventType: "rent_increase_notice",
        description: `Rent increase notice ${noticeNumber} generated: ${lease.currency} ${Number(lease.monthlyRent).toLocaleString()} → ${lease.currency} ${Number(newRent).toLocaleString()}, effective ${effectiveDate}`,
        actorId: req.user?.id ?? null,
        actorName: req.user?.name ?? "System",
        metadata: { noticeNumber, currentRent: lease.monthlyRent, newRent, effectiveDate, noticePeriodDays },
      } as any);
    } catch (_) {
      // Audit log failure must not block notice generation
    }

    return res.json({ noticeNumber, noticeHtml, leaseId: lease.id, newRent, effectiveDate });
  } catch (err: any) {
    console.error("[rrt-notices] rent-increase error:", err);
    return res.status(500).json({ message: err.message ?? "Internal error" });
  }
});

// ─── POST /eviction-notice ────────────────────────────────────────────────────

router.post("/eviction-notice", ...auth, async (req: any, res: any) => {
  try {
    const { leaseId, groundCode, vacateDate, reason = "" } = req.body;

    if (!leaseId || !groundCode || !vacateDate) {
      return res.status(400).json({ message: "leaseId, groundCode and vacateDate are required" });
    }

    const groundText = EVICTION_GROUNDS[groundCode];
    if (!groundText) {
      return res.status(400).json({
        message: `Unknown groundCode. Valid values: ${Object.keys(EVICTION_GROUNDS).join(", ")}`,
      });
    }

    const orgId = req.user.organizationId as number;
    const ctx = await fetchLeaseContext(Number(leaseId), orgId);
    if (!ctx) return res.status(404).json({ message: "Lease not found" });

    const { lease, tenant, unit, property, ownerName } = ctx;
    const noticeNumber = nextNoticeNumber("RRT-EV");
    const noticeDate = new Date().toISOString().slice(0, 10);

    // Minimum notice periods under Cap 296 and Cap 301:
    //   non_payment, breach, nuisance, illegal_use, subletting_without_consent: 30 days
    //   owner_occupation, redevelopment: 60 days (2 months) — common law + Cap 296 practice
    const GROUND_NOTICE_DAYS: Record<string, number> = {
      non_payment:                30,
      breach_of_agreement:        30,
      owner_occupation:           60,
      redevelopment:              60,
      nuisance:                   30,
      illegal_use:                30,
      subletting_without_consent: 30,
    };
    const minDays = GROUND_NOTICE_DAYS[groundCode] ?? 30;
    const vacateDateObj = parseISO(vacateDate);
    const minVacate = addDays(new Date(), minDays);
    if (vacateDateObj < minVacate) {
      return res.status(400).json({
        message: `For ground "${groundCode}", vacate date must be at least ${minDays} days from today (minimum: ${format(minVacate, "yyyy-MM-dd")})`,
      });
    }

    const noticePeriodDays = Math.round(
      (vacateDateObj.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000
    );

    const htmlCtx = {
      noticeNumber,
      landlordName: ownerName,
      tenantName: tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "Tenant",
      tenantIdNo: (tenant as any)?.nationalId ?? undefined,
      propertyName: property?.name ?? "—",
      propertyAddress: property?.address ?? "—",
      unitNumber: unit?.unitNumber ?? lease.unitId?.toString() ?? "—",
      currentRent: Number(lease.monthlyRent),
      currency: lease.currency ?? "KES",
      groundCode,
      groundText,
      vacateDate,
      noticePeriodDays,
      noticeDate,
      reason,
    };

    const noticeHtml = buildEvictionHtml(htmlCtx);

    // Log to lease events audit trail
    try {
      await db.insert(leaseEvents).values({
        leaseId: lease.id,
        organizationId: orgId,
        eventType: "eviction_notice",
        description: `Notice to vacate ${noticeNumber} generated — ground: ${groundCode}, vacate by ${vacateDate}`,
        actorId: req.user?.id ?? null,
        actorName: req.user?.name ?? "System",
        metadata: { noticeNumber, groundCode, vacateDate },
      } as any);
    } catch (_) {
      // non-fatal
    }

    return res.json({ noticeNumber, noticeHtml, leaseId: lease.id, groundCode, vacateDate });
  } catch (err: any) {
    console.error("[rrt-notices] eviction-notice error:", err);
    return res.status(500).json({ message: err.message ?? "Internal error" });
  }
});

// ─── GET /notices/:leaseId ────────────────────────────────────────────────────

router.get("/notices/:leaseId", ...auth, async (req: any, res: any) => {
  try {
    const leaseId = Number(req.params.leaseId);
    const orgId   = req.user.organizationId as number;

    const events = await db
      .select()
      .from(leaseEvents)
      .where(
        and(
          eq(leaseEvents.leaseId, leaseId),
          eq(leaseEvents.organizationId, orgId),
        )
      )
      .orderBy(desc(leaseEvents.createdAt));

    const rrtEvents = events.filter(e =>
      e.eventType === "rent_increase_notice" || e.eventType === "eviction_notice"
    );

    return res.json(rrtEvents);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;