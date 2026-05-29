/**
 * ownerStatementEmail.ts
 *
 * Builds a rich, print-quality HTML email for the monthly owner statement.
 * Sent by the report scheduler on the 5th of each month (or on-demand).
 * No PDF library required — Resend renders the HTML faithfully and recipients
 * can print-to-PDF from their email client.
 *
 * Exported functions:
 *   buildOwnerStatementHtml(data)  — returns an HTML string
 *   sendOwnerStatementEmail(...)   — sends via Resend
 */

import { Resend } from "resend";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StatementEmailData {
  // Org
  orgName: string;
  orgLogo?: string | null;

  // Recipient
  ownerName: string;
  ownerEmail: string;

  // Property
  propertyName: string;
  propertyAddress: string;

  // Period
  periodYear: number;
  periodMonth: number; // 1-12
  statementNumber: string;
  generatedAt?: Date;

  // Financials
  grossRent: number;
  otherIncome: number;
  totalIncome: number;
  pmFee: number;
  maintenanceCosts: number;
  utilityCosts: number;
  insuranceCosts: number;
  otherDeductions: number;
  totalDeductions: number;
  netPayable: number;
  currency: string;

  // Snapshot details
  paymentDetails?: Array<{
    tenantName: string;
    unitNumber: string;
    amount: number;
    method: string;
    date: string | null;
    monthlyRent?: number;
  }>;
  expenseDetails?: Array<{
    vendor: string | null;
    description: string | null;
    amount: number;
    category: string | null;
    date: Date | string | null;
  }>;

  // PM fee descriptor e.g. "10% of gross rent"
  pmFeeLabel?: string;

  // Disbursement
  disbursementMethod?: string | null;
  disbursementAccount?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(n: number, currency = "KES"): string {
  return `${currency} ${Math.round(n).toLocaleString("en-KE")}`;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d as any), "dd MMM yyyy"); } catch { return "—"; }
}

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── HTML builder ──────────────────────────────────────────────────────────────

export function buildOwnerStatementHtml(data: StatementEmailData): string {
  const periodLabel = `${MONTHS[data.periodMonth]} ${data.periodYear}`;
  const cur = data.currency || "KES";
  const pmFeeLabel = data.pmFeeLabel ?? `PM management fee`;

  const paymentRows = (data.paymentDetails ?? [])
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${p.unitNumber}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${p.tenantName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;">${p.method}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;">${fmtDate(p.date)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">${money(p.amount, cur)}</td>
      </tr>`,
    )
    .join("");

  const expenseRows = (data.expenseDetails ?? [])
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-transform:capitalize;">${(e.category ?? "—").replace(/_/g, " ")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${e.description ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;">${e.vendor ?? "—"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#6b7280;">${fmtDate(e.date as any)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#ef4444;">(${money(e.amount, cur)})</td>
      </tr>`,
    )
    .join("");

  const occupancyRate =
    data.paymentDetails && data.paymentDetails.length > 0
      ? `${data.paymentDetails.length} unit${data.paymentDetails.length !== 1 ? "s" : ""} collected`
      : "No payments recorded";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Owner Statement — ${periodLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:32px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="color:#d1fae5;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Monthly Owner Statement</div>
                  <div style="color:#ffffff;font-size:26px;font-weight:700;line-height:1.2;">${periodLabel}</div>
                  <div style="color:#d1fae5;font-size:13px;margin-top:6px;">${data.orgName}</div>
                </td>
                <td align="right" valign="top">
                  <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;text-align:right;">
                    <div style="color:#d1fae5;font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Statement No.</div>
                    <div style="color:#ffffff;font-size:14px;font-weight:700;font-family:monospace;">${data.statementNumber}</div>
                    <div style="color:#d1fae5;font-size:10px;margin-top:4px;">Generated ${fmtDate(data.generatedAt ?? new Date())}</div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── PROPERTY + OWNER INFO ── -->
        <tr>
          <td style="padding:24px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" style="background:#f0fdf4;border-radius:8px;padding:16px 20px;vertical-align:top;">
                  <div style="font-size:10px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Property</div>
                  <div style="font-weight:700;font-size:15px;color:#0f172a;">${data.propertyName}</div>
                  <div style="color:#64748b;font-size:12px;margin-top:4px;line-height:1.5;">${data.propertyAddress}</div>
                  <div style="color:#059669;font-size:11px;margin-top:8px;font-weight:500;">${occupancyRate}</div>
                </td>
                <td width="4%"></td>
                <td width="48%" style="background:#f0fdf4;border-radius:8px;padding:16px 20px;vertical-align:top;">
                  <div style="font-size:10px;font-weight:600;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Prepared for</div>
                  <div style="font-weight:700;font-size:15px;color:#0f172a;">${data.ownerName}</div>
                  <div style="color:#64748b;font-size:12px;margin-top:4px;">${data.ownerEmail}</div>
                  ${data.disbursementMethod ? `<div style="color:#16a34a;font-size:11px;margin-top:8px;font-weight:500;">Payment via ${data.disbursementMethod}${data.disbursementAccount ? `: ${data.disbursementAccount}` : ""}</div>` : ""}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── SUMMARY CARDS ── -->
        <tr>
          <td style="padding:24px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="31%" style="text-align:center;background:#f8fafc;border-radius:8px;padding:16px 8px;">
                  <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Income</div>
                  <div style="font-size:20px;font-weight:800;color:#1e3a5f;">${money(data.totalIncome, cur)}</div>
                </td>
                <td width="4%" style="text-align:center;font-size:18px;color:#cbd5e1;">−</td>
                <td width="31%" style="text-align:center;background:#fef9f0;border-radius:8px;padding:16px 8px;">
                  <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Deductions</div>
                  <div style="font-size:20px;font-weight:800;color:#c2410c;">${money(data.totalDeductions, cur)}</div>
                </td>
                <td width="4%" style="text-align:center;font-size:18px;color:#cbd5e1;">=</td>
                <td width="31%" style="text-align:center;background:#f0fdf4;border-radius:8px;padding:16px 8px;border:2px solid #86efac;">
                  <div style="font-size:10px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Net Payable</div>
                  <div style="font-size:22px;font-weight:800;color:#15803d;">${money(data.netPayable, cur)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── LINE ITEMS BREAKDOWN ── -->
        <tr>
          <td style="padding:24px 40px 0;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Statement Summary</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <!-- Income -->
              <tr style="background:#f0f9ff;">
                <td style="padding:10px 16px;border-radius:6px 0 0 6px;">
                  <span style="font-weight:600;color:#0369a1;">↑ Gross Rent Collected</span>
                </td>
                <td style="padding:10px 16px;text-align:right;font-weight:700;color:#0369a1;border-radius:0 6px 6px 0;">${money(data.grossRent, cur)}</td>
              </tr>
              ${data.otherIncome > 0 ? `
              <tr>
                <td style="padding:8px 16px;color:#4b5563;">Other income</td>
                <td style="padding:8px 16px;text-align:right;color:#0369a1;font-weight:600;">${money(data.otherIncome, cur)}</td>
              </tr>` : ""}
              <tr><td colspan="2" style="height:8px;"></td></tr>
              <!-- Deductions -->
              <tr>
                <td style="padding:8px 16px;color:#4b5563;">↓ ${pmFeeLabel}</td>
                <td style="padding:8px 16px;text-align:right;color:#ef4444;">(${money(data.pmFee, cur)})</td>
              </tr>
              ${data.maintenanceCosts > 0 ? `<tr><td style="padding:8px 16px;color:#4b5563;">↓ Maintenance &amp; repairs</td><td style="padding:8px 16px;text-align:right;color:#ef4444;">(${money(data.maintenanceCosts, cur)})</td></tr>` : ""}
              ${data.utilityCosts > 0 ? `<tr><td style="padding:8px 16px;color:#4b5563;">↓ Utilities</td><td style="padding:8px 16px;text-align:right;color:#ef4444;">(${money(data.utilityCosts, cur)})</td></tr>` : ""}
              ${data.insuranceCosts > 0 ? `<tr><td style="padding:8px 16px;color:#4b5563;">↓ Insurance</td><td style="padding:8px 16px;text-align:right;color:#ef4444;">(${money(data.insuranceCosts, cur)})</td></tr>` : ""}
              ${data.otherDeductions > 0 ? `<tr><td style="padding:8px 16px;color:#4b5563;">↓ Other deductions</td><td style="padding:8px 16px;text-align:right;color:#ef4444;">(${money(data.otherDeductions, cur)})</td></tr>` : ""}
              <tr><td colspan="2" style="height:4px;"></td></tr>
              <!-- Net -->
              <tr style="background:#f0fdf4;border-radius:6px;">
                <td style="padding:12px 16px;border-radius:6px 0 0 6px;">
                  <span style="font-weight:700;color:#15803d;font-size:14px;">Net Payable to Owner</span>
                </td>
                <td style="padding:12px 16px;text-align:right;font-weight:800;color:#15803d;font-size:16px;border-radius:0 6px 6px 0;">${money(data.netPayable, cur)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── RENT PAYMENTS DETAIL ── -->
        ${paymentRows ? `
        <tr>
          <td style="padding:24px 40px 0;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Rent Payments Received</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Unit</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Tenant</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Method</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Date</th>
                  <th style="padding:8px 12px;text-align:right;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Amount</th>
                </tr>
              </thead>
              <tbody>${paymentRows}</tbody>
            </table>
          </td>
        </tr>` : ""}

        <!-- ── EXPENSE DETAIL ── -->
        ${expenseRows ? `
        <tr>
          <td style="padding:24px 40px 0;">
            <div style="font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Deductible Expenses</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Category</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Description</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Vendor</th>
                  <th style="padding:8px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Date</th>
                  <th style="padding:8px 12px;text-align:right;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Amount</th>
                </tr>
              </thead>
              <tbody>${expenseRows}</tbody>
            </table>
          </td>
        </tr>` : ""}

        <!-- ── FOOTER ── -->
        <tr>
          <td style="padding:32px 40px 40px;">
            <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-top:8px;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
                This statement was automatically generated by <strong>${data.orgName}</strong> for the period
                <strong>${periodLabel}</strong>. If you have any questions about this statement, please contact
                your property manager directly. This email was sent to <strong>${data.ownerEmail}</strong> as
                the registered owner of ${data.propertyName}.
              </p>
            </div>
            <p style="margin:16px 0 0;text-align:center;font-size:10px;color:#cbd5e1;">
              Powered by SmartProp Property Management
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Resend sender ─────────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

function getFromEmail(): string {
  const e = process.env.FROM_EMAIL;
  if (e) return e;
  if (process.env.NODE_ENV !== "production") return "onboarding@resend.dev";
  throw new Error("FROM_EMAIL is not set");
}

const APP_NAME = process.env.APP_NAME || "SmartProp";

export async function sendOwnerStatementEmail(data: StatementEmailData): Promise<void> {
  const client = getResend();
  const from   = getFromEmail();
  const html   = buildOwnerStatementHtml(data);
  const periodLabel = `${MONTHS[data.periodMonth]} ${data.periodYear}`;

  const { error } = await client.emails.send({
    from,
    to:      data.ownerEmail,
    subject: `[${APP_NAME}] ${data.propertyName} — Owner Statement ${periodLabel}`,
    html,
    // Reply-to: property manager (FROM_EMAIL); owners can reply to ask questions
    replyTo: from,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}