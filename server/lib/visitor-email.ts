/**
 * Visitor invitation email
 * Sends a beautifully formatted email to a visitor with their QR code
 * and access code embedded inline. Works with the existing Resend setup.
 */
import { Resend } from "resend";

let resend: Resend | null = null;
function getResendClient(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured.");
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

function getFromEmail(): string {
  const configured = process.env.FROM_EMAIL;
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "onboarding@resend.dev";
  throw new Error("FROM_EMAIL is not set.");
}

const APP_NAME = process.env.APP_NAME || "SmartProp";

/** 
 * Generate a QR code image URL using the qrcode npm package.
 * Falls back to a URL-based QR if the package is unavailable.
 * 
 * NOTE: install qrcode + @types/qrcode in the root package.json:
 *   npm install qrcode @types/qrcode
 */
async function qrToDataUri(text: string): Promise<string> {
  try {
    const QRCode = await import("qrcode");
    const lib = (QRCode as any).default ?? QRCode;
    const dataUri: string = await lib.toDataURL(text, {
      width: 280,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return dataUri;
  } catch {
    // Fallback: return a URL pointing to a free QR generation service
    // This works without any npm package but requires the email client to load external images
    const encoded = encodeURIComponent(text);
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encoded}&color=0f172a&bgcolor=ffffff`;
  }
}

function fmtDateTimeLong(d: Date | string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-KE", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export interface VisitorInviteEmailParams {
  to: string;                      // Visitor's email
  visitorName: string;
  accessCode: string;              // e.g. VAC-A1B2C3
  propertyName: string;
  propertyAddress?: string | null;
  hostTenantName: string;          // e.g. "John Kamau"
  hostUnitNumber?: string | null;  // e.g. "Unit 4B"
  expectedArrival: Date | string;
  expectedDeparture?: Date | string | null;
  visitPurpose?: string | null;
  hasVehicle?: boolean;
}

export async function sendVisitorInviteEmail(params: VisitorInviteEmailParams): Promise<void> {
  const {
    to,
    visitorName,
    accessCode,
    propertyName,
    propertyAddress,
    hostTenantName,
    hostUnitNumber,
    expectedArrival,
    expectedDeparture,
    visitPurpose,
    hasVehicle,
  } = params;

  const client = getResendClient();
  const from = getFromEmail();

  // Generate QR code as data URI (embeds directly in email)
  const qrDataUri = await qrToDataUri(accessCode);

  const arrivalStr  = fmtDateTimeLong(expectedArrival);
  const departureStr = expectedDeparture ? fmtDateTimeLong(expectedDeparture) : null;
  const firstName   = visitorName.split(" ")[0];
  const hostDisplay = hostUnitNumber
    ? `${hostTenantName} · ${hostUnitNumber}`
    : hostTenantName;

  const vehicleNote = hasVehicle
    ? `<tr>
        <td style="padding:6px 0;font-size:13px;color:#64748b;">Parking</td>
        <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:500;">Will be allocated on arrival</td>
       </tr>`
    : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Your Visitor Pass — ${propertyName}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">

  <div style="max-width:580px;margin:36px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- ── Header ── -->
    <div style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:32px 40px 28px;">
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#d1fae5;margin-bottom:6px;">${APP_NAME}</div>
      <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">Your Visitor Pass</div>
      <div style="font-size:14px;color:#d1fae5;margin-top:4px;">${propertyName}</div>
    </div>

    <!-- ── Greeting ── -->
    <div style="padding:32px 40px 0;">
      <p style="font-size:16px;font-weight:600;margin:0 0 8px;">Hi ${firstName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 28px;">
        You've been invited to visit <strong>${propertyName}</strong>.
        Your access pass is ready — present the QR code below at the entrance, or quote your access code to the guard on duty.
      </p>
    </div>

    <!-- ── QR Code Block ── -->
    <div style="margin:0 40px 28px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:12px;padding:28px;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Scan to Enter</div>
      <img src="${qrDataUri}" alt="Visitor QR Code" width="200" height="200"
           style="display:block;margin:0 auto 20px;border-radius:8px;"/>
      <div style="display:inline-block;background:#059669;color:#ffffff;border-radius:8px;padding:10px 24px;">
        <span style="font-family:'Courier New',monospace;font-size:18px;font-weight:700;letter-spacing:4px;">${accessCode}</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:10px;">Manual entry code — give this to the guard if needed</div>
    </div>

    <!-- ── Visit Details ── -->
    <div style="margin:0 40px 28px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:14px;">Visit Details</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;">
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;width:42%;">Property</td>
          <td style="padding:10px 0;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${propertyName}${propertyAddress ? `<br/><span style="font-size:12px;color:#94a3b8;">${propertyAddress}</span>` : ""}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Host</td>
          <td style="padding:10px 0;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${hostDisplay}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Expected Arrival</td>
          <td style="padding:10px 0;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${arrivalStr}</td>
        </tr>
        ${departureStr ? `<tr>
          <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Expected Departure</td>
          <td style="padding:10px 0;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${departureStr}</td>
        </tr>` : ""}
        ${visitPurpose ? `<tr>
          <td style="padding:10px 0;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Purpose</td>
          <td style="padding:10px 0;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${visitPurpose}</td>
        </tr>` : ""}
        ${vehicleNote}
      </table>
    </div>

    <!-- ── Instructions ── -->
    <div style="margin:0 40px 32px;background:#f0fdf4;border-left:4px solid #059669;border-radius:0 8px 8px 0;padding:16px 20px;">
      <div style="font-size:12px;font-weight:700;color:#065f46;margin-bottom:8px;">On Arrival</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;color:#065f46;line-height:1.8;">
        <li>Show the QR code above to the guard or scanner</li>
        <li>Alternatively, quote the access code <strong>${accessCode}</strong></li>
        <li>Have your National ID or Passport ready for verification</li>
        ${hasVehicle ? "<li>Your vehicle parking will be allocated automatically</li>" : ""}
      </ul>
    </div>

    <!-- ── Footer ── -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
      <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.8;">
        ${APP_NAME} · ${propertyName}<br/>
        This pass was generated by your host. If you did not expect this, please ignore.<br/>
        Do not share your access code with others.
      </p>
    </div>

  </div>
</body>
</html>`;

  const { error } = await client.emails.send({
    from,
    to,
    subject: `Your visitor pass for ${propertyName}`,
    html,
  });

  if (error) {
    const msg = (error as any).message ?? JSON.stringify(error);
    console.error("[visitor-email] Send error:", msg);
    throw new Error(`Failed to send visitor invite email: ${msg}`);
  }

  console.log(`[visitor-email] Invite sent to ${to} (code: ${accessCode})`);
}