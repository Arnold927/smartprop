import crypto from 'crypto';
import axios from 'axios';

interface MPesaConfig {
  consumerKey: string;
  consumerSecret: string;
  environment: 'sandbox' | 'production';
  businessShortCode: string;
  passkey: string;
  callbackUrl: string;
}

interface STKPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}

interface STKPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

interface MPesaCallbackData {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{
          Name: string;
          Value: string | number;
        }>;
      };
    };
  };
}

export class MPesaService {
  private config: MPesaConfig;
  private accessToken?: string;
  private tokenExpiresAt?: Date;

  constructor(config: MPesaConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
    
    try {
      const response = await axios.get(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      this.accessToken = String(response.data.access_token);
      // Token expires in 1 hour, refresh 5 minutes early
      this.tokenExpiresAt = new Date(Date.now() + (55 * 60 * 1000));
      
      return this.accessToken;
    } catch (error) {
      console.error('Failed to get MPesa access token:', error);
      throw new Error('Failed to authenticate with MPesa API');
    }
  }

  private getTimestamp(): string {
    return new Date().toISOString().replace(/[-:]/g, '').slice(0, 14);
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle Kenya numbers starting with 07 or 01
    if (cleaned.startsWith('07') || cleaned.startsWith('01')) {
      cleaned = '254' + cleaned.substring(1);
    }
    
    // Handle numbers starting with +254
    if (cleaned.startsWith('254')) {
      return cleaned;
    }
    
    // Default to Kenya if no country code
    return '254' + cleaned;
  }

  async initiateSTKPush(request: STKPushRequest): Promise<STKPushResponse> {
    const accessToken = await this.getAccessToken();
    const timestamp = this.getTimestamp();

    // This instance's own configured shortcode — callers needing a
    // different shortcode+passkey pairing (e.g. a landlord's own Daraja
    // credentials) get a separate instance from createMPesaServiceForOverrides()
    // rather than overriding a single shared instance's shortcode per-request,
    // which previously risked using the wrong passkey for the shortcode being
    // charged (each shortcode has its own passkey issued by Safaricom).
    const shortCode = this.config.businessShortCode;

    // Password must be generated with the actual shortcode being charged
    const data = shortCode + this.config.passkey + timestamp;
    const password = Buffer.from(data).toString('base64');

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(request.amount),
      PartyA: this.formatPhoneNumber(request.phoneNumber),
      PartyB: shortCode,
      PhoneNumber: this.formatPhoneNumber(request.phoneNumber),
      CallBackURL: this.config.callbackUrl,
      AccountReference: request.accountReference,
      TransactionDesc: request.transactionDesc,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('STK Push failed:', error.response?.data || error.message);
      throw new Error('Failed to initiate MPesa payment');
    }
  }

  async queryTransactionStatus(checkoutRequestId: string): Promise<any> {
    const accessToken = await this.getAccessToken();
    const timestamp = this.getTimestamp();
    const data = this.config.businessShortCode + this.config.passkey + timestamp;
    const password = Buffer.from(data).toString('base64');

    const payload = {
      BusinessShortCode: this.config.businessShortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('Transaction query failed:', error.response?.data || error.message);
      throw new Error('Failed to query transaction status');
    }
  }

  parseCallback(callbackData: MPesaCallbackData): {
    merchantRequestId: string;
    checkoutRequestId: string;
    resultCode: number;
    resultDesc: string;
    amount?: number;
    mpesaReceiptNumber?: string;
    phoneNumber?: string;
    transactionDate?: string;
  } {
    const callback = callbackData.Body.stkCallback;
    
    const result = {
      merchantRequestId: callback.MerchantRequestID,
      checkoutRequestId: callback.CheckoutRequestID,
      resultCode: callback.ResultCode,
      resultDesc: callback.ResultDesc,
    };

    if (callback.CallbackMetadata?.Item) {
      const metadata = callback.CallbackMetadata.Item;
      
      const findItem = (name: string) => 
        metadata.find(item => item.Name === name)?.Value;

      return {
        ...result,
        amount: findItem('Amount') as number,
        mpesaReceiptNumber: findItem('MpesaReceiptNumber') as string,
        phoneNumber: findItem('PhoneNumber') as string,
        transactionDate: findItem('TransactionDate') as string,
      };
    }

    return result;
  }
}

// Singleton instance
let mpesaService: MPesaService | null = null;

/**
 * Returns true when all required M-PESA credentials are present in the
 * environment.  Use this to guard any code path that calls getMPesaService()
 * so a missing config never causes a runtime crash.
 *
 * Required vars:
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
 *   MPESA_BUSINESS_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL
 */
export function isMpesaConfigured(): boolean {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
    process.env.MPESA_CONSUMER_SECRET &&
    process.env.MPESA_BUSINESS_SHORTCODE &&
    process.env.MPESA_PASSKEY &&
    process.env.MPESA_CALLBACK_URL,
  );
}

/**
 * Returns an initialised MPesaService, or null when credentials are not
 * configured.  Always call isMpesaConfigured() (or null-check the return
 * value) before using the service — never assume it is available.
 */
export function getMPesaService(): MPesaService | null {
  if (!isMpesaConfigured()) {
    return null;
  }

  if (!mpesaService) {
    const config: MPesaConfig = {
      consumerKey:       process.env.MPESA_CONSUMER_KEY!,
      consumerSecret:    process.env.MPESA_CONSUMER_SECRET!,
      environment:       (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      businessShortCode: process.env.MPESA_BUSINESS_SHORTCODE!,
      passkey:           process.env.MPESA_PASSKEY!,
      callbackUrl:       process.env.MPESA_CALLBACK_URL!,
    };

    mpesaService = new MPesaService(config);
  }

  return mpesaService;
}

/** @deprecated Use getMPesaService() with a null-check instead. */
export function getMPesaServiceOrThrow(): MPesaService {
  const svc = getMPesaService();
  if (!svc) {
    throw new Error(
      'M-PESA is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, ' +
      'MPESA_BUSINESS_SHORTCODE, MPESA_PASSKEY, and MPESA_CALLBACK_URL.',
    );
  }
  return svc;
}

/**
 * Creates a fresh MPesaService instance for a specific landlord's own Daraja
 * credentials, falling back to the env-var defaults for any field the
 * landlord hasn't configured themselves.
 *
 * Always returns a NEW instance rather than mutating the shared singleton
 * from getMPesaService() — each landlord's credentials need their own OAuth
 * token cache (a token fetched under one consumerKey/consumerSecret pair
 * isn't valid for another), and mutating a shared instance's config in
 * place was a real race condition: two concurrent STK Push requests for
 * different landlords could clobber each other's shortcode mid-flight.
 *
 * Pass only the fields the landlord has actually configured; anything
 * undefined/empty falls back to the env-var default so a landlord who's
 * only entered a Paybill number (no full Daraja credentials) still gets a
 * working service using the env-var passkey for that shortcode override —
 * callers are still responsible for deciding whether that combination is
 * actually valid (see mpesa-actions.ts's shortcode/passkey-pairing check).
 */
export function createMPesaServiceForOverrides(overrides: {
  consumerKey?: string;
  consumerSecret?: string;
  businessShortCode?: string;
  passkey?: string;
  environment?: 'sandbox' | 'production';
}): MPesaService | null {
  const consumerKey       = overrides.consumerKey       || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret    = overrides.consumerSecret    || process.env.MPESA_CONSUMER_SECRET;
  const businessShortCode = overrides.businessShortCode || process.env.MPESA_BUSINESS_SHORTCODE;
  const passkey           = overrides.passkey           || process.env.MPESA_PASSKEY;
  const callbackUrl       = process.env.MPESA_CALLBACK_URL;
  const environment       = overrides.environment || (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox';

  if (!consumerKey || !consumerSecret || !businessShortCode || !passkey || !callbackUrl) {
    return null;
  }

  return new MPesaService({ consumerKey, consumerSecret, businessShortCode, passkey, callbackUrl, environment });
}