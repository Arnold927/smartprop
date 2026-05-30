import { Resend } from "resend";
import { logger } from "../lib/logger";

// Resend client - lazily initialized so the app starts even without RESEND_API_KEY
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

/**
 * Determine the FROM address to use.
 *
 * Resend requires the sender domain to be verified in your Resend account.
 * Free/Gmail addresses (e.g. user@gmail.com) are NOT valid sender addresses.
 *
 * Rules:
 *  - Production: use FROM_EMAIL env var (must be a verified domain in Resend).
 *  - Development fallback: use Resend's shared testing address so invite emails
 *    still land in inboxes without needing a verified domain.
 *    NOTE: with the shared address, emails can only be sent to the address that
 *    owns the Resend account. See https://resend.com/docs/dashboard/emails/send-test-emails
 */
function getFromEmail(): string {
  const configured = process.env.FROM_EMAIL;

  if (configured) {
    // Warn if someone has set a Gmail/consumer address — Resend will reject it.
    const domainMatch = configured.match(/@([\w.-]+)/);
    const domain = domainMatch?.[1]?.toLowerCase() ?? "";
    const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];
    if (freeProviders.includes(domain)) {
      logger.warn(
        `[email] WARNING: FROM_EMAIL is set to "${configured}" which uses a free email provider (${domain}). ` +
        `Resend requires a verified domain. Falling back to onboarding@resend.dev for development. ` +
        `Set FROM_EMAIL to an address on a domain you have verified in your Resend dashboard.`
      );
      // In dev, fall through to the shared address. In prod, hard-fail so it's caught early.
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `FROM_EMAIL "${configured}" uses a free provider (${domain}). ` +
          `Configure a verified sender domain in Resend and update FROM_EMAIL.`
        );
      }
      return "onboarding@resend.dev";
    }
    return configured;
  }

  // No FROM_EMAIL set — use shared dev address in dev, hard-fail in prod.
  if (process.env.NODE_ENV !== "production") {
    return "onboarding@resend.dev";
  }
  throw new Error("FROM_EMAIL is not set. Configure a verified sender address for production.");
}

const APP_NAME = process.env.APP_NAME || "SmartProp";

export async function sendInviteEmail({
  to,
  inviteLink,
  subject,
  intro,
  expiryNote = "This invitation expires in 7 days.",
}: {
  to: string;
  inviteLink: string;
  subject?: string;
  intro?: string;
  expiryNote?: string;
}) {
  const client = getResendClient();
  const from = getFromEmail();

  const emailSubject = subject ?? `You're invited to join ${APP_NAME}`;
  const emailIntro   = intro   ?? `An administrator has invited you to join their organisation on ${APP_NAME}.`;

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: emailSubject,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #059669, #047857); padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 800;">SmartProp</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 13px;">Property Management Platform</p>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 15px;">${emailIntro}</p>
          <p style="text-align: center; margin: 28px 0;">
            <a
              href="${inviteLink}"
              style="display:inline-block;padding:14px 32px;background-color:#059669;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;"
            >
              Set Up My Account
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px;">${expiryNote}</p>
          <p style="color:#9ca3af;font-size:12px;">
            If you did not expect this invitation, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 20px 0;" />
          <p style="color:#9ca3af;font-size:11px;text-align:center;">
            SmartProp Property Management · Kenya
          </p>
        </div>
      </div>
    `,
  });

  if (error) {
    logger.error("Email send error:", error);
    throw new Error(`Failed to send invitation email: ${(error as any).message ?? JSON.stringify(error)}`);
  }

  return data;
}

export async function sendPasswordResetEmail({
  to,
  resetLink,
}: {
  to: string;
  resetLink: string;
}) {
  const client = getResendClient();
  const from = getFromEmail();

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: `${APP_NAME} — Password Reset Request`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Reset Your Password</h2>
        <p>We received a request to reset the password for your ${APP_NAME} account.</p>
        <p>
          <a
            href="${resetLink}"
            style="display:inline-block;padding:12px 24px;background-color:#059669;color:white;text-decoration:none;border-radius:6px;font-weight:bold;"
          >
            Reset Password
          </a>
        </p>
        <p style="color:#6b7280;font-size:14px;">This link expires in 24 hours.</p>
        <p style="color:#6b7280;font-size:12px;">
          If you didn't request a password reset, you can safely ignore this email.
          Your password will not be changed.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error("Email send error:", error);
    throw new Error(`Failed to send password reset email: ${(error as any).message ?? JSON.stringify(error)}`);
  }

  return data;
}

export async function sendVerificationEmail({
  to,
  verificationLink,
}: {
  to: string;
  verificationLink: string;
}) {
  const client = getResendClient();
  const from = getFromEmail();

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: `Verify your email for ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #065f46;">Welcome to ${APP_NAME}!</h2>
        <p>Please verify your email address to complete your registration.</p>
        <p>
          <a
            href="${verificationLink}"
            style="display:inline-block;padding:12px 24px;background-color:#059669;color:white;text-decoration:none;border-radius:6px;font-weight:bold;"
          >
            Verify Email
          </a>
        </p>
        <p style="color:#6b7280;font-size:14px;">This link expires in 24 hours.</p>
        <p style="color:#6b7280;font-size:12px;">
          If you didn't create an account on ${APP_NAME}, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error("Email send error:", error);
    throw new Error(`Failed to send verification email: ${(error as any).message ?? JSON.stringify(error)}`);
  }

  return data;
}

// ── Portfolio report email ────────────────────────────────────────────────────

interface PortfolioReportRow {
  id: number;
  reportType: string;
  reportPeriodStart: string;
  reportPeriodEnd: string;
  totalRevenue: string | null;
  totalExpenses: string | null;
  netIncome: string | null;
  occupancyRate: string | null;
  summary?: Record<string, any> | unknown | null;
  createdAt?: Date | string | null;
}

function fmtKES(val: string | null | undefined): string {
  const n = Number(val ?? 0);
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateEmail(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
}

/**
 * Sends a portfolio report summary email to the property owner.
 *
 * RECIPIENT: always `to` — the logged-in owner's email (req.user.email),
 * which is embedded in the JWT from users.email at login time.
 *
 * EMAIL SERVICE: Resend — same service used for invite/password-reset emails.
 * Requires RESEND_API_KEY env var. FROM address = FROM_EMAIL env var.
 */
export async function sendPortfolioReportEmail({
  to,
  ownerName,
  report,
}: {
  to: string;
  ownerName: string;
  report: PortfolioReportRow;
}) {
  const client  = getResendClient();
  const from    = getFromEmail();
  const appName = process.env.APP_NAME ?? "SmartProp";

  const typeLabel = (report.reportType ?? "monthly").charAt(0).toUpperCase()
    + (report.reportType ?? "monthly").slice(1);
  const reportNum = `#RPT-${String(report.id).padStart(4, "0")}`;
  const period    = `${fmtDateEmail(report.reportPeriodStart)} – ${fmtDateEmail(report.reportPeriodEnd)}`;

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: `${appName} — Your ${typeLabel} Portfolio Report (${reportNum})`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);padding:32px 40px;">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">${appName}</div>
      <div style="font-size:13px;color:#93c5fd;margin-top:4px;">Portfolio Financial Report</div>
    </div>

    <div style="padding:32px 40px;">
      <p style="font-size:16px;font-weight:600;margin-bottom:8px;">Hi ${ownerName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px;">
        Your <strong>${typeLabel} portfolio report</strong> (${reportNum}) covering
        <strong>${period}</strong> is ready.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td width="33%" style="padding:4px;">
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#3b82f6;margin-bottom:6px;">Gross Revenue</div>
              <div style="font-size:17px;font-weight:800;color:#1d4ed8;">${fmtKES(report.totalRevenue)}</div>
            </div>
          </td>
          <td width="33%" style="padding:4px;">
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#d97706;margin-bottom:6px;">Total Expenses</div>
              <div style="font-size:17px;font-weight:800;color:#92400e;">${fmtKES(report.totalExpenses)}</div>
            </div>
          </td>
          <td width="33%" style="padding:4px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;text-align:center;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#16a34a;margin-bottom:6px;">Net Income</div>
              <div style="font-size:17px;font-weight:800;color:#15803d;">${fmtKES(report.netIncome)}</div>
            </div>
          </td>
        </tr>
      </table>

      ${report.occupancyRate ? `<p style="font-size:13px;color:#64748b;margin-bottom:16px;">Portfolio occupancy: <strong>${Number(report.occupancyRate).toFixed(1)}%</strong></p>` : ""}

      <p style="font-size:13px;color:#64748b;line-height:1.6;">
        Log in to your ${appName} landlord portal to download the full formatted report.
      </p>
    </div>

    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">
        ${appName} · Sent to ${to}<br/>${reportNum} · ${typeLabel} · ${period}
      </p>
    </div>
  </div>
</body>
</html>`,
  });

  if (error) {
    logger.error("[email] Portfolio report send error:", error);
    throw new Error(`Failed to send report email: ${(error as any).message ?? JSON.stringify(error)}`);
  }

  return data;
}
// ── Rent reminder email ──────────────────────────────────────────────────────

export interface RentReminderPayload {
  to: string;
  tenantFirstName: string;
  tenantLastName: string;
  propertyName: string;
  unitNumber: string;
  orgName: string;
  currency: string;

  // Current invoice
  invoiceNumber: string;
  invoiceAmount: number;
  dueDate: string;          // ISO date string
  paidAmount: number;       // 0 = fully unpaid, >0 = partial

  // Historical outstanding (other unpaid invoices excluding current)
  outstandingInvoices: Array<{
    invoiceNumber: string;
    amount: number;
    paidAmount: number;
    dueDate: string;
    daysOverdue: number;
  }>;
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtDateFriendly(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch { return iso; }
}

export async function sendRentReminderEmail(payload: RentReminderPayload): Promise<void> {
  const client   = getResendClient();
  const from     = getFromEmail();
  const appName  = process.env.APP_NAME ?? "SmartProp";

  const {
    to, tenantFirstName, tenantLastName, propertyName, unitNumber, orgName, currency,
    invoiceNumber, invoiceAmount, dueDate, paidAmount,
    outstandingInvoices,
  } = payload;

  const fullName        = `${tenantFirstName} ${tenantLastName}`;
  const balance         = invoiceAmount - paidAmount;   // remaining on current invoice
  const isPartial       = paidAmount > 0 && balance > 0;
  const hasOutstanding  = outstandingInvoices.length > 0;
  const totalOutstanding = outstandingInvoices.reduce((s, inv) => s + (inv.amount - inv.paidAmount), 0);
  const grandTotal      = balance + totalOutstanding;

  // ── Subject line ────────────────────────────────────────────────────────────
  let subject: string;
  if (isPartial && hasOutstanding) {
    subject = `${appName} — Partial payment received + outstanding balance for ${invoiceNumber}`;
  } else if (isPartial) {
    subject = `${appName} — Partial payment received — ${fmtMoney(balance, currency)} still due`;
  } else if (hasOutstanding) {
    subject = `${appName} — Rent overdue: ${invoiceNumber} + prior outstanding balance`;
  } else {
    subject = `${appName} — Rent reminder: ${invoiceNumber} is overdue`;
  }

  // ── Outstanding invoices table rows ─────────────────────────────────────────
  const outstandingRows = outstandingInvoices.map(inv => {
    const invBalance = inv.amount - inv.paidAmount;
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-family:monospace;">${inv.invoiceNumber}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;">${fmtDateFriendly(inv.dueDate)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#dc2626;font-weight:600;">${inv.daysOverdue} days</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:700;">${fmtMoney(invBalance, currency)}</td>
      </tr>`;
  }).join("");

  // ── Current invoice status block ─────────────────────────────────────────────
  const currentBlock = isPartial ? `
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
      <div style="font-size:13px;color:#92400e;font-weight:600;margin-bottom:12px;">PARTIAL PAYMENT RECEIVED — ${invoiceNumber}</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#78350f;padding:3px 0;">Invoice total</td>
          <td style="font-size:13px;text-align:right;">${fmtMoney(invoiceAmount, currency)}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#16a34a;padding:3px 0;">Amount received</td>
          <td style="font-size:13px;color:#16a34a;text-align:right;">− ${fmtMoney(paidAmount, currency)}</td>
        </tr>
        <tr style="border-top:1px solid #fcd34d;">
          <td style="font-size:14px;font-weight:700;color:#92400e;padding-top:8px;">Remaining balance</td>
          <td style="font-size:14px;font-weight:700;color:#dc2626;text-align:right;padding-top:8px;">${fmtMoney(balance, currency)}</td>
        </tr>
      </table>
    </div>` : `
    <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:20px 24px;margin-bottom:20px;">
      <div style="font-size:13px;color:#991b1b;font-weight:600;margin-bottom:12px;">OVERDUE — ${invoiceNumber}</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#7f1d1d;padding:3px 0;">Amount due</td>
          <td style="font-size:15px;font-weight:800;color:#dc2626;text-align:right;">${fmtMoney(invoiceAmount, currency)}</td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#9ca3af;padding:3px 0;">Due date</td>
          <td style="font-size:12px;color:#9ca3af;text-align:right;">${fmtDateFriendly(dueDate)}</td>
        </tr>
      </table>
    </div>`;

  // ── Outstanding history block ────────────────────────────────────────────────
  const outstandingBlock = hasOutstanding ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:10px;">Prior Outstanding Invoices</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">Invoice</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">Due Date</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">Overdue By</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">Balance</th>
          </tr>
        </thead>
        <tbody>${outstandingRows}</tbody>
      </table>
    </div>` : "";

  // ── Grand total block ────────────────────────────────────────────────────────
  const grandTotalBlock = hasOutstanding ? `
    <div style="background:#fff1f2;border:2px solid #f87171;border-radius:10px;padding:16px 24px;margin-bottom:24px;text-align:center;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#991b1b;margin-bottom:4px;">Total Amount Now Due</div>
      <div style="font-size:28px;font-weight:900;color:#dc2626;">${fmtMoney(grandTotal, currency)}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
        Current invoice (${fmtMoney(balance, currency)}) + prior balance (${fmtMoney(totalOutstanding, currency)})
      </div>
    </div>` : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#b91c1c 0%,#dc2626 100%);padding:28px 40px;">
      <div style="font-size:20px;font-weight:800;color:#fff;">${appName}</div>
      <div style="font-size:12px;color:#fca5a5;margin-top:2px;">${orgName}</div>
    </div>

    <!-- Body -->
    <div style="padding:32px 40px;">

      <p style="font-size:16px;font-weight:600;margin:0 0 6px;">Dear ${fullName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
        This is a reminder regarding your rent payment for
        <strong>Unit ${unitNumber}</strong> at <strong>${propertyName}</strong>.
        Please review the details below and arrange payment at your earliest convenience.
      </p>

      ${currentBlock}
      ${outstandingBlock}
      ${grandTotalBlock}

      <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0 0 8px;">
        If you have already arranged payment or believe this notice has been sent in error,
        please contact your property manager as soon as possible.
      </p>

      <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0;">
        Thank you for your prompt attention to this matter.
      </p>

    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">
        ${appName} · ${orgName}<br/>
        This is an automated notification. Please do not reply directly to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  const { error } = await client.emails.send({ from, to, subject, html });

  if (error) {
    const msg = (error as any).message ?? JSON.stringify(error);
    logger.error("[email] Rent reminder send error:", msg);
    throw new Error(`Failed to send rent reminder: ${msg}`);
  }

  logger.info(`[email] Rent reminder sent to ${to} (${invoiceNumber}, scenario: ${isPartial ? "partial" : "overdue"}${hasOutstanding ? "+outstanding" : ""})`);
}
export async function sendContractorInviteEmail({
  to,
  inviteLink,
  contractorName,
  specialty,
  orgName,
}: {
  to: string;
  inviteLink: string;
  contractorName: string;
  specialty: string;
  orgName?: string;
}) {
  const client = getResendClient();
  const from = getFromEmail();
  const org = orgName ?? APP_NAME;

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: `You've been added as a contractor on ${APP_NAME}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#059669;padding:32px 40px;">
          <h1 style="color:#ffffff;margin:0;font-size:24px;">${APP_NAME}</h1>
          <p style="color:#d1fae5;margin:6px 0 0;font-size:14px;">Contractor Portal Invitation</p>
        </div>
        <div style="padding:32px 40px;">
          <h2 style="color:#111827;margin:0 0 12px;">Hi ${contractorName},</h2>
          <p style="color:#374151;">
            <strong>${org}</strong> has registered you as a <strong>${specialty}</strong> contractor
            on ${APP_NAME} and set up a portal account for you.
          </p>
          <p style="color:#374151;">
            Through the contractor portal you can view assigned work orders, update job progress,
            submit invoices, and track your earnings — all in one place.
          </p>
          <div style="margin:28px 0;">
            <a
              href="${inviteLink}"
              style="display:inline-block;padding:14px 28px;background-color:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;"
            >
              Set Up Your Account
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px;">
            This invitation link expires in 24 hours. If you did not expect this, you can safely ignore this email.
          </p>
        </div>
        <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;">
          <p style="font-size:11px;color:#9ca3af;margin:0;">${APP_NAME} · ${org}</p>
        </div>
      </div>
    `,
  });

  if (error) {
    const msg = (error as any).message ?? JSON.stringify(error);
    logger.error("[email] Contractor invite send error:", msg);
    throw new Error(`Failed to send contractor invite: ${msg}`);
  }

  return data;
}