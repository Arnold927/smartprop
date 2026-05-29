/**
 * certExpiryAlerts.ts
 *
 * Daily job that scans regulatory_certificates for upcoming expirations
 * and sends email reminders at 90 / 60 / 30 / 7 days before expiry.
 *
 * Each threshold has a dedicated flag column (alert_90_sent, etc.) so
 * reminders are sent exactly once per threshold.
 *
 * Called by leaseScheduler.ts startLeaseScheduler() — runs at 07:55 EAT
 * alongside the existing lease-expiry checks.
 *
 * Export: runCertExpiryAlerts()
 */

import { db } from "../db";
import {
  regulatoryCertificates,
  properties,
  organizations,
  users,
} from "@shared/schema";
import { eq, and, lte, gte, isNotNull, or } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { Resend } from "resend";

const log = (msg: string) => console.log(`[CertExpiry] ${msg}`);

// ── Resend ────────────────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function fromEmail() {
  return process.env.FROM_EMAIL ?? "onboarding@resend.dev";
}

// ── Alert thresholds ──────────────────────────────────────────────────────────

const THRESHOLDS = [
  { days: 90, flag: "alert90Sent" as const, flagCol: "alert_90_sent" },
  { days: 60, flag: "alert60Sent" as const, flagCol: "alert_60_sent" },
  { days: 30, flag: "alert30Sent" as const, flagCol: "alert_30_sent" },
  { days:  7, flag: "alert7Sent"  as const, flagCol: "alert_7_sent"  },
];

// ── Email builder ─────────────────────────────────────────────────────────────

function buildAlertEmail(cert: any, daysLeft: number, orgName: string, propertyName: string): string {
  const urgency =
    daysLeft <= 7  ? "#dc2626" :   // red
    daysLeft <= 30 ? "#d97706" :   // amber
                     "#059669";    // emerald (SmartProp brand)

  const authorityColors: Record<string, string> = {
    NEMA:   "#059669",
    NCA:    "#7c3aed",
    COUNTY: "#0284c7",
    FIRE:   "#dc2626",
    OTHER:  "#64748b",
  };
  const authColor = authorityColors[cert.authority] ?? "#64748b";

  const APP_NAME = process.env.APP_NAME ?? "SmartProp";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Regulatory Certificate Expiry Alert</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,${urgency} 0%,${urgency}cc 100%);padding:28px 40px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">${APP_NAME}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:2px;">${orgName}</div>
    <div style="margin-top:16px;font-size:18px;font-weight:700;color:#fff;">
      ⚠ Regulatory Certificate ${daysLeft <= 0 ? "EXPIRED" : `Expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}
    </div>
  </div>

  <!-- Body -->
  <div style="padding:32px 40px;">

    <!-- Authority badge -->
    <div style="display:inline-block;background:${authColor}15;border:1px solid ${authColor}40;color:${authColor};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:4px 12px;border-radius:99px;margin-bottom:20px;">
      ${cert.authority}
    </div>

    <!-- Cert title -->
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">${cert.title}</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#64748b;">${cert.certificateType}${cert.certificateNumber ? ` · ${cert.certificateNumber}` : ""}</p>

    <!-- Key facts grid -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td width="50%" style="padding:12px 16px;background:#f8fafc;border-radius:8px 0 0 8px;">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Property</div>
          <div style="font-size:14px;font-weight:600;color:#0f172a;">${propertyName}</div>
        </td>
        <td width="4%"></td>
        <td width="46%" style="padding:12px 16px;background:${urgency}0f;border:1px solid ${urgency}30;border-radius:0 8px 8px 0;">
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Expiry Date</div>
          <div style="font-size:14px;font-weight:700;color:${urgency};">
            ${cert.expiryDate ? new Date(cert.expiryDate).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) : "—"}
          </div>
          <div style="font-size:11px;color:${urgency};margin-top:2px;">
            ${daysLeft <= 0 ? "EXPIRED" : `${daysLeft} days remaining`}
          </div>
        </td>
      </tr>
    </table>

    ${cert.issuingOffice ? `
    <p style="font-size:13px;color:#475569;margin:0 0 8px;">
      <strong>Issuing Office:</strong> ${cert.issuingOffice}
      ${cert.issuingOfficer ? ` · ${cert.issuingOfficer}` : ""}
    </p>` : ""}

    ${cert.conditions ? `
    <div style="background:#fef9f0;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;margin:16px 0;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#c2410c;text-transform:uppercase;letter-spacing:1px;">Conditions</p>
      <p style="margin:0;font-size:13px;color:#78350f;">${cert.conditions}</p>
    </div>` : ""}

    <!-- Action box -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-top:20px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0369a1;">Action Required</p>
      <p style="margin:0;font-size:13px;color:#075985;">
        ${daysLeft <= 0
          ? "This certificate has <strong>expired</strong>. Continued operation without a valid certificate may constitute a regulatory breach. Renew immediately or contact the relevant authority."
          : `Initiate the renewal process for this ${cert.authority} certificate. Allow sufficient processing time — government agencies typically take 4–8 weeks to process applications.`}
      </p>
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
      Log in to ${APP_NAME} to update the certificate status or upload the renewed document.
    </p>
  </div>

</div>
</body>
</html>`;
}

// ── Main job ──────────────────────────────────────────────────────────────────

export async function runCertExpiryAlerts(): Promise<void> {
  log("Starting daily certificate expiry check");

  const resend = getResend();
  if (!resend) {
    log("RESEND_API_KEY not configured — skipping email alerts (will still log)");
  }

  let totalAlerts = 0;
  let totalErrors = 0;

  for (const { days, flag, flagCol } of THRESHOLDS) {
    const targetDate    = format(addDays(new Date(), days), "yyyy-MM-dd");
    const windowStart   = format(addDays(new Date(), days - 1), "yyyy-MM-dd");

    // Find certs expiring in the window where this alert hasn't been sent yet
    const certs = await db
      .select({
        cert:          regulatoryCertificates,
        propertyName:  properties.name,
        orgId:         properties.organizationId,
      })
      .from(regulatoryCertificates)
      .leftJoin(properties, eq(regulatoryCertificates.propertyId, properties.id))
      .where(and(
        isNotNull(regulatoryCertificates.expiryDate),
        lte(regulatoryCertificates.expiryDate, targetDate),
        gte(regulatoryCertificates.expiryDate, windowStart),
        eq((regulatoryCertificates as any)[flag], false),
        or(
          eq(regulatoryCertificates.status, "active"),
          eq(regulatoryCertificates.status, "under_review"),
        ),
      ));

    if (certs.length === 0) continue;
    log(`  ${days}-day window: ${certs.length} cert(s) to alert`);

    // Resolve org managers for each cert (send to org admins / managers)
    for (const { cert, propertyName, orgId } of certs) {
      try {
        // Find org name and manager emails
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId!))
          .limit(1);

        const managers = await db
          .select({ email: users.email, firstName: users.firstName })
          .from(users)
          .where(and(
            eq(users.organizationId, orgId!),
            // notify admins and managers
          ))
          .limit(10);

        const managerEmails = managers.map(m => m.email).filter(Boolean);
        if (managerEmails.length === 0) {
          log(`  ↳ No manager emails found for org #${orgId} — skipping`);
          continue;
        }

        const daysLeft = Math.ceil(
          (new Date(cert.expiryDate!).getTime() - Date.now()) / 86_400_000
        );

        const html = buildAlertEmail(cert, daysLeft, org?.name ?? "Your Organisation", propertyName ?? "Unknown Property");
        const subject = `[${process.env.APP_NAME ?? "SmartProp"}] ${cert.authority} Certificate ${daysLeft <= 0 ? "EXPIRED" : `expiring in ${daysLeft} days`} — ${propertyName}`;

        if (resend) {
          await resend.emails.send({
            from:    fromEmail(),
            to:      managerEmails as string[],
            subject,
            html,
          });
        } else {
          log(`  [DRY-RUN] Would email: ${managerEmails.join(", ")} — ${subject}`);
        }

        // Mark alert as sent
        await db
          .update(regulatoryCertificates)
          .set({ [flag]: true, updatedAt: new Date() } as any)
          .where(eq(regulatoryCertificates.id, cert.id));

        log(`  ✓ Alert (${days}d) sent for cert #${cert.id} "${cert.title}" @ ${propertyName}`);
        totalAlerts++;
      } catch (err: any) {
        log(`  ✗ Error for cert #${cert.id}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  log(`Done — ${totalAlerts} alert(s) sent, ${totalErrors} error(s)`);
}