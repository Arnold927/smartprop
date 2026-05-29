/**
 * server/lib/utility-bill-email.ts
 *
 * Email templates & sending logic for utility (water/electricity/gas) bills.
 *
 * Exports:
 *   sendUtilityBillEmail(payload)       → send one bill to one tenant
 *   sendBulkUtilityBillEmails(payloads) → send bills to many tenants, returns per-item results
 */

import { Resend } from "resend";

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured. Email sending is unavailable.");
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

function getFromEmail(): string {
  const configured = process.env.FROM_EMAIL;
  if (configured) {
    // Must contain a valid email address (user@domain.tld)
    const emailMatch = configured.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i);
    if (!emailMatch) {
      console.warn(`[utility-bill-email] FROM_EMAIL "${configured}" does not contain a valid email address. Falling back to onboarding@resend.dev.`);
      if (process.env.NODE_ENV === "production") {
        throw new Error(`FROM_EMAIL "${configured}" is not a valid email address. Expected format: "Name <user@domain.com>"`);
      }
      return "onboarding@resend.dev";
    }
    const domain = emailMatch[0].split("@")[1].toLowerCase();
    const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
    if (freeProviders.includes(domain)) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(`FROM_EMAIL "${configured}" uses a free provider. Configure a verified domain in Resend.`);
      }
      return "onboarding@resend.dev";
    }
    return configured;
  }
  if (process.env.NODE_ENV !== "production") return "onboarding@resend.dev";
  throw new Error("FROM_EMAIL is not set.");
}

const APP_NAME = process.env.APP_NAME || "SmartProp";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UtilityBillEmailPayload {
  to: string;
  tenantFirstName: string;
  tenantLastName: string;
  unitNumber: string;
  propertyName: string;
  utilityType: string;          // "water" | "electricity" | "gas" | "internet" | etc.
  previousReading: number;
  currentReading: number;
  unitsConsumed: number;
  unitCost: number;             // cost per unit e.g. KES per m³
  totalAmount: number;
  currency: string;
  billingPeriodStart: string;   // ISO date string
  billingPeriodEnd: string;     // ISO date string
  dueDate: string;              // ISO date string
  billNumber?: string;
  meterNumber?: string;
  notes?: string;
}

export interface BulkSendResult {
  tenantId: number;
  email: string;
  tenantName: string;
  success: boolean;
  error?: string;
  messageId?: string;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency || "KES",
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function utilityIcon(type: string): string {
  const t = type.toLowerCase();
  if (t === "water") return "💧";
  if (t === "electricity" || t === "power") return "⚡";
  if (t === "gas") return "🔥";
  if (t === "internet" || t === "wifi") return "📶";
  return "🔧";
}

function utilityColor(type: string): string {
  const t = type.toLowerCase();
  if (t === "water") return "#0ea5e9";
  if (t === "electricity" || t === "power") return "#f59e0b";
  if (t === "gas") return "#ef4444";
  if (t === "internet" || t === "wifi") return "#8b5cf6";
  return "#6b7280";
}

function utilityUnit(type: string): string {
  const t = type.toLowerCase();
  if (t === "water") return "m³";
  if (t === "electricity" || t === "power") return "kWh";
  if (t === "gas") return "m³";
  return "units";
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(p: UtilityBillEmailPayload): string {
  const icon = utilityIcon(p.utilityType);
  const color = utilityColor(p.utilityType);
  const unit = utilityUnit(p.utilityType);
  const fullName = `${p.tenantFirstName} ${p.tenantLastName}`;
  const period = `${fmtDate(p.billingPeriodStart)} – ${fmtDate(p.billingPeriodEnd)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${color} 0%,${color}cc 100%);padding:36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:32px;margin-bottom:8px;">${icon}</div>
                  <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${p.utilityType.charAt(0).toUpperCase() + p.utilityType.slice(1)} Bill</div>
                  <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:4px;">${APP_NAME} · ${period}</div>
                </td>
                <td align="right" style="vertical-align:top;">
                  ${p.billNumber ? `<div style="background:rgba(255,255,255,0.2);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;display:inline-block;">${p.billNumber}</div>` : ""}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <p style="margin:0;font-size:16px;color:#374151;">Dear <strong>${fullName}</strong>,</p>
            <p style="margin:12px 0 0;font-size:15px;color:#6b7280;line-height:1.6;">
              Please find below your ${p.utilityType.toLowerCase()} bill for
              <strong>${p.propertyName}</strong>, Unit <strong>${p.unitNumber}</strong>.
            </p>
          </td>
        </tr>

        <!-- Amount Due Banner -->
        <tr>
          <td style="padding:24px 40px 0;">
            <div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:24px 28px;text-align:center;">
              <div style="font-size:13px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Total Amount Due</div>
              <div style="font-size:38px;font-weight:900;color:#dc2626;letter-spacing:-1px;">${fmtMoney(p.totalAmount, p.currency)}</div>
              <div style="font-size:13px;color:#6b7280;margin-top:8px;">Due by ${fmtDate(p.dueDate)}</div>
            </div>
          </td>
        </tr>

        <!-- Meter Reading Breakdown -->
        <tr>
          <td style="padding:24px 40px 0;">
            <div style="font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;">${icon} Meter Reading Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#f9fafb;">
                  <th style="padding:12px 16px;font-size:12px;color:#6b7280;text-align:left;font-weight:600;border-bottom:1px solid #e5e7eb;">Description</th>
                  <th style="padding:12px 16px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;border-bottom:1px solid #e5e7eb;">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;">Previous Reading</td>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;font-family:monospace;">${p.previousReading.toLocaleString()} ${unit}</td>
                </tr>
                <tr style="background:#f9fafb;">
                  <td style="padding:12px 16px;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;">Current Reading</td>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;font-family:monospace;">${p.currentReading.toLocaleString()} ${unit}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">Units Consumed</td>
                  <td style="padding:12px 16px;font-size:14px;font-weight:700;color:${color};text-align:right;border-bottom:1px solid #f3f4f6;font-family:monospace;">${p.unitsConsumed.toLocaleString()} ${unit}</td>
                </tr>
                <tr style="background:#f9fafb;">
                  <td style="padding:12px 16px;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;">Rate per ${unit}</td>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;">${fmtMoney(p.unitCost, p.currency)}</td>
                </tr>
                ${p.meterNumber ? `<tr>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;">Meter Number</td>
                  <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;font-family:monospace;">${p.meterNumber}</td>
                </tr>` : ""}
              </tbody>
              <tfoot>
                <tr style="background:${color}15;">
                  <td style="padding:14px 16px;font-size:15px;font-weight:700;color:#111827;">Total (${p.unitsConsumed} × ${fmtMoney(p.unitCost, p.currency)})</td>
                  <td style="padding:14px 16px;font-size:16px;font-weight:800;color:#dc2626;text-align:right;">${fmtMoney(p.totalAmount, p.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>

        <!-- Billing Period & Due Date Info -->
        <tr>
          <td style="padding:20px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" style="background:#f0fdf4;border-radius:10px;padding:16px 20px;">
                  <div style="font-size:11px;color:#166534;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Billing Period</div>
                  <div style="font-size:14px;color:#15803d;font-weight:600;">${period}</div>
                </td>
                <td width="4%"></td>
                <td width="48%" style="background:#fff7ed;border-radius:10px;padding:16px 20px;">
                  <div style="font-size:11px;color:#9a3412;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Payment Due</div>
                  <div style="font-size:14px;color:#c2410c;font-weight:600;">${fmtDate(p.dueDate)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${p.notes ? `
        <!-- Notes -->
        <tr>
          <td style="padding:20px 40px 0;">
            <div style="background:#f8fafc;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 18px;">
              <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Note from Management</div>
              <div style="font-size:14px;color:#374151;line-height:1.6;">${p.notes}</div>
            </div>
          </td>
        </tr>` : ""}

        <!-- Footer -->
        <tr>
          <td style="padding:32px 40px;border-top:1px solid #f3f4f6;margin-top:28px;">
            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
              This is an automated utility bill from <strong>${APP_NAME}</strong>.<br>
              If you have any questions, please contact your property manager.<br>
              <span style="font-size:12px;">Please do not reply to this email.</span>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Send functions ────────────────────────────────────────────────────────────

/**
 * Send a utility bill email to a single tenant.
 */
export async function sendUtilityBillEmail(payload: UtilityBillEmailPayload): Promise<{ messageId: string }> {
  const client = getResendClient();
  const from = getFromEmail();

  const icon = utilityIcon(payload.utilityType);
  const subject = `${icon} ${payload.utilityType.charAt(0).toUpperCase() + payload.utilityType.slice(1)} Bill — ${fmtDate(payload.billingPeriodStart)} to ${fmtDate(payload.billingPeriodEnd)} · ${fmtMoney(payload.totalAmount, payload.currency)} due`;

  const { data, error } = await client.emails.send({
    from,
    to: payload.to,
    subject,
    html: buildHtml(payload),
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return { messageId: data?.id ?? "unknown" };
}

/**
 * Send utility bill emails to multiple tenants.
 * Never throws — per-tenant errors are captured in the result array.
 */
export interface BulkPayload extends UtilityBillEmailPayload {
  tenantId: number;
}

export async function sendBulkUtilityBillEmails(payloads: BulkPayload[]): Promise<BulkSendResult[]> {
  const results: BulkSendResult[] = [];

  for (const payload of payloads) {
    try {
      const { messageId } = await sendUtilityBillEmail(payload);
      results.push({
        tenantId: payload.tenantId,
        email: payload.to,
        tenantName: `${payload.tenantFirstName} ${payload.tenantLastName}`,
        success: true,
        messageId,
      });
    } catch (err: any) {
      results.push({
        tenantId: payload.tenantId,
        email: payload.to,
        tenantName: `${payload.tenantFirstName} ${payload.tenantLastName}`,
        success: false,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  return results;
}