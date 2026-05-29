/**
 * MessagingService — email + SMS dispatcher
 *
 * SMS provider priority (cost-optimised for Kenya):
 *  1. Africa's Talking  — preferred when AT_API_KEY + AT_USERNAME are set
 *                         ~KES 0.8/SMS via dedicated Kenya shortcode
 *                         Works on Safaricom, Airtel, and Telkom
 *                         Critical for guards and caretakers who don't use WhatsApp
 *  2. Twilio            — fallback when AT_* vars absent
 *                         ~KES 5+/SMS, but globally reliable
 *
 * Email provider: SendGrid (SENDGRID_API_KEY)
 *
 * All providers are lazy-loaded — the server boots fine with none configured.
 *
 * Required env vars:
 *   Africa's Talking:  AT_API_KEY, AT_USERNAME (default username: "sandbox" in dev)
 *   Twilio:            TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   SendGrid:          SENDGRID_API_KEY
 */

// ── Type stubs (avoids mandatory @types installs) ─────────────────────────────

interface SendGridClient {
  setApiKey(key: string): void;
  send(msg: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
    templateId?: string;
    dynamicTemplateData?: any;
  }): Promise<any>;
}

interface TwilioClient {
  messages: {
    create(opts: { to: string; body: string; from: string }): Promise<any>;
  };
}

interface ATSMSResponse {
  SMSMessageData: {
    Message:    string;
    Recipients: Array<{ status: string; statusCode: number; number: string; cost: string }>;
  };
}

interface ATSMSService {
  send(opts: { to: string[]; message: string; from?: string }): Promise<ATSMSResponse>;
}

// ── Public API types ──────────────────────────────────────────────────────────

interface MessagePayload {
  to:       string;
  subject?: string;
  content:  string;
  channel:  'email' | 'sms' | 'push';
  type?:    'chat' | 'invoice_reminder' | 'maintenance_update' | 'payment_confirmation' | 'system_notification';
}

interface EmailOptions {
  to:            string;
  from:          string;
  subject:       string;
  text?:         string;
  html?:         string;
  templateId?:   string;
  templateData?: any;
}

interface SMSOptions {
  to:    string;
  body:  string;
  from?: string;  // only used by Twilio; AT uses the registered shortcode
}

// ── Service class ─────────────────────────────────────────────────────────────

export class MessagingService {
  private sendGridClient?: SendGridClient;
  private twilioClient?:   TwilioClient;
  private atSMS?:          ATSMSService;
  private atFrom?:         string; // AT registered shortcode / sender ID (optional)

  private readonly defaultFromEmail: string;
  private readonly defaultFromSMS:   string;  // Twilio fallback number

  constructor() {
    this.defaultFromEmail = process.env.FROM_EMAIL || process.env.DEFAULT_FROM_EMAIL || 'noreply@smartprop.co.ke';
    this.defaultFromSMS   = process.env.TWILIO_PHONE_NUMBER || '';

    // ── Africa's Talking (preferred for Kenya) ──────────────────────────────
    if (process.env.AT_API_KEY) {
      try {
        const AT = require('africastalking') as (opts: { apiKey: string; username: string }) => any;
        const client = AT({
          apiKey:   process.env.AT_API_KEY,
          username: process.env.AT_USERNAME || 'sandbox',
        });
        this.atSMS  = client.SMS as ATSMSService;
        this.atFrom = process.env.AT_SENDER_ID || undefined; // registered shortcode, e.g. "SMARTPROP"
        console.log('[messaging] SMS provider: Africa\'s Talking' +
          (this.atFrom ? ` (sender: ${this.atFrom})` : ''));
      } catch {
        console.warn('[messaging] africastalking package not installed — run: npm install africastalking');
      }
    }

    // ── Twilio (fallback) ────────────────────────────────────────────────────
    if (!this.atSMS && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const TwilioSDK = require('twilio') as (sid: string, token: string) => TwilioClient;
        this.twilioClient = TwilioSDK(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN,
        );
        console.log('[messaging] SMS provider: Twilio (consider switching to Africa\'s Talking for Kenya — ~6× cheaper)');
      } catch {
        console.warn('[messaging] Twilio package not installed (twilio)');
      }
    }

    if (!this.atSMS && !this.twilioClient) {
      console.warn('[messaging] No SMS provider configured. Set AT_API_KEY (Africa\'s Talking) or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN.');
    }

    // ── SendGrid ─────────────────────────────────────────────────────────────
    if (process.env.SENDGRID_API_KEY) {
      try {
        const sgMail = require('@sendgrid/mail') as SendGridClient;
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        this.sendGridClient = sgMail;
      } catch {
        console.warn('[messaging] SendGrid package not installed (@sendgrid/mail)');
      }
    }
  }

  // ── sendSMS ────────────────────────────────────────────────────────────────

  async sendSMS(options: SMSOptions): Promise<boolean> {
    // Normalise phone: AT requires E.164 (e.g. +254...). Strip spaces.
    const to = options.to.replace(/\s+/g, '');

    // 1. Africa's Talking — preferred
    if (this.atSMS) {
      try {
        const result = await this.atSMS.send({
          to:      [to],
          message: options.body,
          ...(this.atFrom ? { from: this.atFrom } : {}),
        });
        const recipient = result.SMSMessageData.Recipients[0];
        if (recipient?.statusCode === 101) {
          return true;
        }
        // AT returns statusCode 100 for insufficient credit, 401 for auth errors, etc.
        console.error('[messaging/AT] SMS rejected:', recipient?.status, 'to:', to);
        return false;
      } catch (err) {
        console.error('[messaging/AT] SMS send error:', err);
        return false;
      }
    }

    // 2. Twilio — fallback
    if (this.twilioClient) {
      try {
        await this.twilioClient.messages.create({
          to,
          body: options.body,
          from: options.from || this.defaultFromSMS,
        });
        return true;
      } catch (err) {
        console.error('[messaging/Twilio] SMS send error:', err);
        return false;
      }
    }

    console.warn('[messaging] sendSMS called but no SMS provider is configured');
    return false;
  }

  // ── sendEmail ──────────────────────────────────────────────────────────────

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.sendGridClient) {
      console.warn('[messaging] SendGrid not configured, email not sent');
      return false;
    }
    try {
      await this.sendGridClient.send({
        to:      options.to,
        from:    options.from || this.defaultFromEmail,
        subject: options.subject,
        text:    options.text,
        html:    options.html,
      });
      return true;
    } catch (err) {
      console.error('[messaging] Email send error:', err);
      return false;
    }
  }

  // ── sendPushNotification ───────────────────────────────────────────────────

  async sendPushNotification(to: string, title: string, body: string): Promise<boolean> {
    // Placeholder — integrate with FCM / OneSignal here
    return true;
  }

  // ── sendMessage (channel router) ───────────────────────────────────────────

  async sendMessage(payload: MessagePayload): Promise<boolean> {
    switch (payload.channel) {
      case 'email':
        return this.sendEmail({
          to:      payload.to,
          from:    this.defaultFromEmail,
          subject: payload.subject || 'SmartProp Notification',
          text:    payload.content,
          html:    this.formatEmailHtml(payload.content, payload.type),
        });

      case 'sms':
        return this.sendSMS({ to: payload.to, body: payload.content });

      case 'push':
        return this.sendPushNotification(
          payload.to,
          payload.subject || 'SmartProp',
          payload.content,
        );

      default:
        console.warn(`[messaging] Unknown channel: ${(payload as any).channel}`);
        return false;
    }
  }

  // ── Convenience helpers ────────────────────────────────────────────────────

  async sendInvoiceReminder(to: string, channel: 'email' | 'sms', dueDate: string, amount: string): Promise<boolean> {
    const content = channel === 'email'
      ? `Your rent payment of ${amount} is due on ${dueDate}. Please make your payment to avoid late fees.`
      : `Rent reminder: ${amount} due ${dueDate}. Pay now to avoid late fees.`;
    return this.sendMessage({ to, channel, content, subject: 'Rent Payment Reminder', type: 'invoice_reminder' });
  }

  async sendMaintenanceUpdate(to: string, channel: 'email' | 'sms', requestId: string, status: string): Promise<boolean> {
    const content = channel === 'email'
      ? `Your maintenance request #${requestId} has been updated. Status: ${status}`
      : `Maintenance #${requestId} status: ${status}`;
    return this.sendMessage({ to, channel, content, subject: 'Maintenance Request Update', type: 'maintenance_update' });
  }

  async sendPaymentConfirmation(to: string, channel: 'email' | 'sms', amount: string, receiptNumber?: string): Promise<boolean> {
    const content = channel === 'email'
      ? `Payment of ${amount} has been received successfully.${receiptNumber ? ` Receipt: ${receiptNumber}` : ''}`
      : `Payment confirmed: ${amount}${receiptNumber ? ` Receipt: ${receiptNumber}` : ''}`;
    return this.sendMessage({ to, channel, content, subject: 'Payment Confirmation', type: 'payment_confirmation' });
  }

  // ── Email template ─────────────────────────────────────────────────────────

  private formatEmailHtml(content: string, type?: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartProp Notification</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header  { background: #059669; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px 20px; background: #f8f9fa; }
    .footer  { padding: 20px; text-align: center; font-size: 12px; color: #666; }
    .btn     { display: inline-block; padding: 10px 20px; background: #059669; color: white; text-decoration: none; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>SmartProp</h1><p>Property Management Platform</p></div>
    <div class="content">${this.formatContentByType(content, type)}</div>
    <div class="footer"><p>&copy; ${new Date().getFullYear()} SmartProp. All rights reserved.</p></div>
  </div>
</body>
</html>`;
  }

  private formatContentByType(content: string, type?: string): string {
    switch (type) {
      case 'invoice_reminder':    return `<h2>🧾 Payment Reminder</h2><p>${content}</p><p><a href="#" class="btn">Pay Now</a></p>`;
      case 'maintenance_update':  return `<h2>🔧 Maintenance Update</h2><p>${content}</p>`;
      case 'payment_confirmation':return `<h2>✅ Payment Confirmed</h2><p>${content}</p>`;
      case 'system_notification': return `<h2>🔔 System Notification</h2><p>${content}</p>`;
      default:                    return `<p>${content}</p>`;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let messagingService: MessagingService | null = null;

export function getMessagingService(): MessagingService {
  if (!messagingService) {
    messagingService = new MessagingService();
  }
  return messagingService;
}