/**
 * leaseEmail.ts
 *
 * Email templates for lease lifecycle events:
 *   send_for_signing  — tenant receives a notification to review and sign
 *   expiry_notice     — advance warning before lease expires (90/60/30 days)
 *   renewal_offer     — proposed renewal terms with new rent
 *   termination       — confirmation that lease has been terminated
 */

import { Resend } from "resend";

let resend: Resend | null = null;
function getClient(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

function fromEmail(): string {
  return process.env.FROM_EMAIL ?? "noreply@resend.dev";
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-KE", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch { return d; }
}

function fmtKES(n: number, currency = "KES"): string {
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function baseHtml(title: string, body: string, orgName: string): string {
  const appName = process.env.APP_NAME ?? "SmartProp";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:28px 40px;">
      <div style="font-size:20px;font-weight:800;color:#fff;">${appName}</div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:2px;">${orgName}</div>
    </div>
    <div style="padding:32px 40px;">${body}</div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">
        ${appName} · ${orgName}<br/>
        This is an automated notification. Do not reply directly to this email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Types ─────────────────────────────────────────────────────────────────

type LeaseEmailType = "send_for_signing" | "expiry_notice" | "renewal_offer" | "termination";

interface LeaseEmailPayload {
  type:          LeaseEmailType;
  to:            string;
  tenantName:    string;
  orgName:       string;
  leaseNumber:   string;
  startDate:     string;
  endDate:       string;
  monthlyRent:   number;
  currency:      string;
  leaseId:       number;
  // For expiry_notice
  daysUntilExpiry?: number;
  // For renewal_offer
  newMonthlyRent?:   number;
  escalationRate?:   number;
  newEndDate?:       string;
}

// ─── Send ──────────────────────────────────────────────────────────────────

export async function sendLeaseEmail(payload: LeaseEmailPayload): Promise<void> {
  const {
    type, to, tenantName, orgName, leaseNumber,
    startDate, endDate, monthlyRent, currency, leaseId,
  } = payload;

  const appName   = process.env.APP_NAME ?? "SmartProp";
  const portalUrl = process.env.APP_BASE_URL
    ? `${process.env.APP_BASE_URL}/tenant-portal`
    : "#";

  let subject = "";
  let bodyHtml = "";

  switch (type) {

    case "send_for_signing": {
      subject = `Action required: Please sign your lease — ${leaseNumber}`;
      const body = `
        <p style="font-size:16px;font-weight:600;margin:0 0 6px;">Dear ${tenantName},</p>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
          Your tenancy agreement is ready for your review and signature. Please log in to the
          tenant portal to read the full lease and confirm your acceptance.
        </p>
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:#0369a1;margin-bottom:12px;">Lease Summary — ${leaseNumber}</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#475569;padding:3px 0;">Term</td>
                <td style="font-size:13px;font-weight:600;color:#0f172a;text-align:right;">${fmtDate(startDate)} → ${fmtDate(endDate)}</td></tr>
            <tr><td style="font-size:13px;color:#475569;padding:3px 0;">Monthly rent</td>
                <td style="font-size:15px;font-weight:800;color:#1d4ed8;text-align:right;">${fmtKES(monthlyRent, currency)}</td></tr>
          </table>
        </div>
        <div style="text-align:center;margin:28px 0;">
          <a href="${portalUrl}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;display:inline-block;">
            Review &amp; Sign Lease →
          </a>
        </div>
        <p style="font-size:13px;color:#64748b;line-height:1.7;">
          If you have any questions about the terms, please contact your property manager
          before signing.
        </p>`;
      bodyHtml = baseHtml(subject, body, orgName);
      break;
    }

    case "expiry_notice": {
      const days  = payload.daysUntilExpiry ?? 30;
      const urgency = days <= 30 ? "🔴" : days <= 60 ? "🟡" : "🟢";
      subject = `${urgency} Your lease expires in ${days} days — ${leaseNumber}`;
      const body = `
        <p style="font-size:16px;font-weight:600;margin:0 0 6px;">Dear ${tenantName},</p>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
          This is a reminder that your current tenancy agreement expires on
          <strong>${fmtDate(endDate)}</strong> — that is <strong>${days} days</strong> from today.
        </p>
        <div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:#854d0e;margin-bottom:8px;">Current Lease — ${leaseNumber}</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#78350f;padding:3px 0;">Expiry date</td>
                <td style="font-size:14px;font-weight:700;color:#92400e;text-align:right;">${fmtDate(endDate)}</td></tr>
            <tr><td style="font-size:13px;color:#78350f;padding:3px 0;">Current rent</td>
                <td style="font-size:13px;color:#78350f;text-align:right;">${fmtKES(monthlyRent, currency)}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#475569;line-height:1.7;">
          Please contact your property manager to discuss renewal options. If you do not
          intend to renew, please give written notice at least 30 days before the expiry date
          in accordance with your tenancy agreement.
        </p>`;
      bodyHtml = baseHtml(subject, body, orgName);
      break;
    }

    case "renewal_offer": {
      const newRent = payload.newMonthlyRent ?? monthlyRent;
      const rate    = payload.escalationRate  ?? 0;
      const newEnd  = payload.newEndDate      ?? "";
      subject = `Lease renewal offer — ${leaseNumber}`;
      const body = `
        <p style="font-size:16px;font-weight:600;margin:0 0 6px;">Dear ${tenantName},</p>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
          Your lease is approaching its end date. We would like to offer you a renewal on
          the following terms. Please review and contact us if you have any questions.
        </p>
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:12px;">Renewal Offer</div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#15803d;padding:4px 0;">New term</td>
                <td style="font-size:13px;font-weight:600;color:#14532d;text-align:right;">${fmtDate(endDate)} → ${fmtDate(newEnd)}</td></tr>
            <tr><td style="font-size:13px;color:#15803d;padding:4px 0;">Current rent</td>
                <td style="font-size:13px;color:#15803d;text-align:right;text-decoration:line-through;">${fmtKES(monthlyRent, currency)}</td></tr>
            <tr><td style="font-size:14px;font-weight:700;color:#14532d;padding:4px 0;">New monthly rent</td>
                <td style="font-size:16px;font-weight:800;color:#166534;text-align:right;">${fmtKES(newRent, currency)}</td></tr>
            <tr><td colspan="2" style="font-size:11px;color:#4ade80;padding-top:6px;">
              Annual escalation of ${(rate * 100).toFixed(0)}% applied in accordance with your agreement.</td></tr>
          </table>
        </div>
        <div style="text-align:center;margin:28px 0;">
          <a href="${portalUrl}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;display:inline-block;">
            View Renewal Details →
          </a>
        </div>`;
      bodyHtml = baseHtml(subject, body, orgName);
      break;
    }

    case "termination": {
      subject = `Lease termination notice — ${leaseNumber}`;
      const body = `
        <p style="font-size:16px;font-weight:600;margin:0 0 6px;">Dear ${tenantName},</p>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
          This letter confirms that your tenancy agreement <strong>${leaseNumber}</strong>
          has been terminated. Please refer to the terms of your agreement regarding
          vacating the property and the return of your security deposit.
        </p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#991b1b;padding:3px 0;">Lease reference</td>
                <td style="font-size:13px;font-weight:600;color:#7f1d1d;text-align:right;">${leaseNumber}</td></tr>
            <tr><td style="font-size:13px;color:#991b1b;padding:3px 0;">Termination date</td>
                <td style="font-size:13px;font-weight:600;color:#7f1d1d;text-align:right;">${fmtDate(endDate)}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#475569;line-height:1.7;">
          If you have questions regarding your deposit refund or move-out process,
          please contact your property manager.
        </p>`;
      bodyHtml = baseHtml(subject, body, orgName);
      break;
    }
  }

  const client = getClient();
  const { error } = await client.emails.send({
    from:    fromEmail(),
    to,
    subject,
    html:    bodyHtml,
  });

  if (error) {
    const msg = (error as any).message ?? JSON.stringify(error);
    throw new Error(`[leaseEmail] Failed to send ${type}: ${msg}`);
  }

  console.log(`[leaseEmail] ${type} sent to ${to} (${leaseNumber})`);
}