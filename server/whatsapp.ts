import axios from 'axios';
import { db } from './db';
import { whatsappMessages } from '@shared/schema';

export interface WhatsAppMessage {
  to: string;
  type: 'text' | 'template' | 'media';
  content: string;
  templateName?: string;
  mediaUrl?: string;
  variables?: Record<string, string>;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  components: Array<{
    type: 'HEADER' | 'BODY' | 'FOOTER';
    text: string;
    variables?: string[];
  }>;
}

export class WhatsAppService {
  /** Env-var fallback credentials (used when no org-level creds are stored). */
  private readonly envApiKey: string;
  private readonly envPhoneNumberId: string;
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  /**
   * True only when the env-var fallback is fully configured.
   * Per-org credentials are resolved at send time, so this flag is only
   * relevant for callers that haven't passed orgSettings in.
   */
  readonly isConfigured: boolean;

  constructor() {
    this.envApiKey        = process.env.WHATSAPP_API_KEY || '';
    this.envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.isConfigured     = Boolean(this.envApiKey && this.envPhoneNumberId);

    if (!this.isConfigured) {
      console.warn(
        '[WhatsApp] WHATSAPP_API_KEY or WHATSAPP_PHONE_NUMBER_ID not set — ' +
        'messages will fall back to demo/console mode unless per-org credentials are provided.'
      );
    }
  }

  /**
   * Resolve credentials to use for a given send operation.
   * Org-level settings take priority; env-var values are the fallback.
   */
  private resolveCredentials(orgSettings?: { phoneNumberId?: string; apiKey?: string }): {
    apiKey: string;
    phoneNumberId: string;
    configured: boolean;
  } {
    const apiKey       = orgSettings?.apiKey       || this.envApiKey;
    const phoneNumberId = orgSettings?.phoneNumberId || this.envPhoneNumberId;
    return { apiKey, phoneNumberId, configured: Boolean(apiKey && phoneNumberId) };
  }

  /**
   * Check whether a given org is configured for real sends.
   * Pass the whatsappSettings JSONB value from organization_settings.
   */
  isConfiguredForOrg(orgSettings?: { phoneNumberId?: string; apiKey?: string }): boolean {
    return this.resolveCredentials(orgSettings).configured;
  }

  /**
   * Normalise a phone number to E.164 format.
   * Handles Kenyan 07xx numbers and strips formatting characters.
   */
  normalisePhone(raw: string): string {
    let n = raw.replace(/[\s\-().]/g, '');
    if (n.startsWith('0') && n.length === 10) {
      n = '+254' + n.slice(1);
    }
    if (!n.startsWith('+')) {
      n = '+' + n;
    }
    return n;
  }

  /**
   * Substitute named {{variable}} placeholders with their values before the
   * message is stored in the DB. This ensures the tenant thread view (and
   * operator log) always shows the fully-rendered string rather than raw
   * {{placeholders}}.
   *
   * Named form:   {{tenant_name}} → value  (used by our templates)
   * Indexed form: {{1}}, {{2}} …  → values in insertion order (Meta internal)
   * Unknown placeholders are left as-is so nothing is silently dropped.
   */
  private substituteVariables(content: string, variables?: Record<string, string>): string {
    if (!variables || Object.keys(variables).length === 0) return content;

    let result = content;

    // Named placeholders first: {{tenant_name}} → value
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }

    // Then indexed placeholders {{1}}, {{2}} … in insertion order
    const values = Object.values(variables);
    result = result.replace(/\{\{(\d+)\}\}/g, (_, idx) => {
      const val = values[parseInt(idx, 10) - 1];
      return val !== undefined ? val : `{{${idx}}}`;
    });

    return result;
  }

  async sendMessage(
    message: WhatsAppMessage,
    organizationId?: number,
    orgSettings?: { phoneNumberId?: string; apiKey?: string }
  ): Promise<boolean> {
    const creds = this.resolveCredentials(orgSettings);
    const to = this.normalisePhone(message.to);
    let success = false;
    let metaMessageId: string | undefined;
    let errorDetail: string | undefined;

    // Resolve content before DB storage: substitute variables so the stored
    // string is human-readable rendered text, not raw {{placeholders}}.
    const resolvedContent =
      message.type === 'template'
        ? this.substituteVariables(message.content, message.variables)
        : message.content;

    if (!creds.configured) {
      console.log(`[WhatsApp DEMO] → ${to}\n${resolvedContent}\n`);
      success = true;
    } else {
      try {
        const payload = {
          messaging_product: 'whatsapp',
          to,
          type: message.type,
          [message.type]: this.formatMessageContent(message),
        };

        const response = await axios.post(
          `${this.baseUrl}/${creds.phoneNumberId}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${creds.apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        // Meta returns { messages: [{ id: "wamid.xxx" }] }
        metaMessageId = response.data?.messages?.[0]?.id;
        success = response.status === 200;
      } catch (error: any) {
        const detail = error?.response?.data ?? error?.message ?? String(error);
        errorDetail = typeof detail === 'object' ? JSON.stringify(detail) : detail;
        console.error('[WhatsApp] sendMessage failed:', errorDetail);
        success = false;
      }
    }

    // Always persist to the log (non-fatal)
    try {
      await db.insert(whatsappMessages).values({
        organizationId: organizationId ?? null,
        to,
        type: message.type,
        content: resolvedContent,   // ← resolved, never raw {{placeholders}}
        templateName: message.templateName ?? null,
        status: success ? 'sent' : 'failed',
        metaMessageId: metaMessageId ?? null,
        errorDetail: errorDetail ?? null,
      });
    } catch (dbErr) {
      console.error('[WhatsApp] Failed to log message to DB (non-fatal):', dbErr);
    }

    return success;
  }

  async sendBulkMessages(
    messages: WhatsAppMessage[],
    organizationId?: number,
    orgSettings?: { phoneNumberId?: string; apiKey?: string }
  ): Promise<{
    successful: number;
    failed: number;
    results: Array<{ to: string; success: boolean; error?: string }>;
  }> {
    const results: Array<{ to: string; success: boolean; error?: string }> = [];
    let successful = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        const ok = await this.sendMessage(message, organizationId, orgSettings);
        if (ok) {
          successful++;
          results.push({ to: message.to, success: true });
        } else {
          failed++;
          results.push({ to: message.to, success: false, error: 'API error' });
        }
      } catch (error) {
        failed++;
        results.push({
          to: message.to,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { successful, failed, results };
  }

  private formatMessageContent(message: WhatsAppMessage) {
    switch (message.type) {
      case 'text':
        return { body: message.content };
      case 'template':
        return {
          name: message.templateName,
          language: { code: 'en' },
          components: message.variables
            ? [
                {
                  type: 'body',
                  parameters: Object.values(message.variables).map((value) => ({
                    type: 'text',
                    text: value,
                  })),
                },
              ]
            : [],
        };
      case 'media':
        return { link: message.mediaUrl, caption: message.content };
      default:
        return { body: message.content };
    }
  }

  // ─── Notification helpers ──────────────────────────────────────────────────

  async sendRentReminder(
    tenantPhone: string,
    tenantName: string,
    amount: string,
    dueDate: string,
    currency = 'KES',
    organizationId?: number
  ): Promise<boolean> {
    return this.sendMessage(
      {
        to: tenantPhone,
        type: 'text',
        content:
          `Hi ${tenantName}! 👋\n\n` +
          `This is a friendly reminder that your rent payment of *${currency} ${amount}* is due on *${dueDate}*.\n\n` +
          `You can pay via:\n` +
          `💳 M-PESA: Pay Bill 123456\n` +
          `🏦 Bank Transfer\n` +
          `💻 Online Portal\n\n` +
          `Need help? Reply to this message!\n\n– SmartProp Team`,
      },
      organizationId
    );
  }

  async sendMaintenanceUpdate(
    tenantPhone: string,
    tenantName: string,
    ticketNumber: string,
    status: string,
    technicianName?: string,
    organizationId?: number
  ): Promise<boolean> {
    let content =
      `Hi ${tenantName}! 🔧\n\n` +
      `Update on your maintenance request *#${ticketNumber}*:\n` +
      `Status: *${status}*`;

    if (technicianName) {
      content += `\nTechnician: ${technicianName}`;
    }

    content += `\n\nWe'll keep you posted. Questions? Just reply here!\n\n– SmartProp Maintenance`;

    return this.sendMessage({ to: tenantPhone, type: 'text', content }, organizationId);
  }

  async sendPaymentConfirmation(
    tenantPhone: string,
    tenantName: string,
    amount: string,
    method: string,
    currency = 'KES',
    organizationId?: number
  ): Promise<boolean> {
    return this.sendMessage(
      {
        to: tenantPhone,
        type: 'text',
        content:
          `Payment Confirmed! ✅\n\n` +
          `Hi ${tenantName},\n\n` +
          `We've received your payment:\n` +
          `💰 Amount: *${currency} ${amount}*\n` +
          `💳 Method: ${method}\n` +
          `📅 Date: ${new Date().toLocaleDateString('en-KE')}\n\n` +
          `Thank you for your prompt payment!\n\n– SmartProp Accounts`,
      },
      organizationId
    );
  }

  async sendLeaseExpiry(
    tenantPhone: string,
    tenantName: string,
    expiryDate: string,
    daysLeft: number,
    organizationId?: number
  ): Promise<boolean> {
    return this.sendMessage(
      {
        to: tenantPhone,
        type: 'text',
        content:
          `Hi ${tenantName}! 📋\n\n` +
          `Your lease expires on *${expiryDate}* (${daysLeft} days away).\n\n` +
          `Please contact your property manager to discuss renewal options.\n\n` +
          `– SmartProp`,
      },
      organizationId
    );
  }

  async sendEmergencyAlert(
    phones: string[],
    message: string,
    organizationId?: number
  ): Promise<void> {
    const emergencyMessage: WhatsAppMessage = {
      to: '',
      type: 'text',
      content:
        `🚨 *EMERGENCY ALERT* 🚨\n\n${message}\n\n` +
        `Please take immediate action if required.\n\n– SmartProp Security`,
    };

    await this.sendBulkMessages(
      phones.map((phone) => ({ ...emergencyMessage, to: phone })),
      organizationId
    );
  }
}

export const whatsappService = new WhatsAppService();