/**
 * server/services/pesapal.ts
 *
 * Thin wrapper around the Pesapal v3 REST API.
 * Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
 *
 * Environment variables required:
 *   PESAPAL_CONSUMER_KEY       – from Pesapal dashboard
 *   PESAPAL_CONSUMER_SECRET    – from Pesapal dashboard
 *   PESAPAL_IPN_URL            – publicly reachable URL for IPN callbacks
 *                                e.g. https://app.smartprop.co.ke/api/billing/webhook
 *   PESAPAL_ENV                – "sandbox" | "live"  (defaults to sandbox)
 */

const BASE_URL =
  process.env.PESAPAL_ENV === "live"
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";

// ── Token cache ────────────────────────────────────────────────────────────────
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const res = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal auth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { token: string; expiryDate: string };
  _cachedToken = data.token;
  _tokenExpiresAt = new Date(data.expiryDate).getTime();
  return _cachedToken;
}

// ── IPN registration (call once at startup) ────────────────────────────────────
let _ipnId: string | null = null;

export async function ensureIpnRegistered(): Promise<string> {
  if (_ipnId) return _ipnId;

  const token = await getAccessToken();
  const ipnUrl = process.env.PESAPAL_IPN_URL;
  if (!ipnUrl) throw new Error("PESAPAL_IPN_URL is not set");

  const res = await fetch(`${BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: ipnUrl,
      ipn_notification_type: "POST",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal IPN registration failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { ipn_id: string };
  _ipnId = data.ipn_id;
  console.log(`[Pesapal] IPN registered: ${_ipnId}`);
  return _ipnId;
}

// ── Submit subscription order ──────────────────────────────────────────────────
export interface SubmitOrderOptions {
  /** Unique reference you generate (stored in our DB) */
  merchantReference: string;
  amount: number;
  currency?: string;
  description: string;
  billingEmail: string;
  billingPhone?: string;
  billingFirstName: string;
  billingLastName: string;
  /** URL to redirect the payer back to after they complete/cancel payment */
  callbackUrl: string;
}

export interface SubmitOrderResult {
  orderTrackingId: string;
  redirectUrl: string;
}

export async function submitOrder(
  opts: SubmitOrderOptions
): Promise<SubmitOrderResult> {
  const token = await getAccessToken();
  const ipnId = await ensureIpnRegistered();

  const body = {
    id: opts.merchantReference,
    currency: opts.currency ?? "KES",
    amount: opts.amount,
    description: opts.description,
    callback_url: opts.callbackUrl,
    notification_id: ipnId,
    billing_address: {
      email_address: opts.billingEmail,
      phone_number: opts.billingPhone ?? "",
      first_name: opts.billingFirstName,
      last_name: opts.billingLastName,
    },
  };

  const res = await fetch(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal order submission failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    order_tracking_id: string;
    redirect_url: string;
  };

  return {
    orderTrackingId: data.order_tracking_id,
    redirectUrl: data.redirect_url,
  };
}

// ── Query transaction status ───────────────────────────────────────────────────
export interface TransactionStatus {
  orderTrackingId: string;
  paymentMethod: string;
  amount: number;
  createdDate: string;
  confirmationCode: string | null;
  paymentStatusDescription: string;
  /** "Completed" | "Failed" | "Invalid" | "Reversed" | "Processing" */
  status: string;
}

export async function getTransactionStatus(
  orderTrackingId: string
): Promise<TransactionStatus> {
  const token = await getAccessToken();

  const res = await fetch(
    `${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(
      orderTrackingId
    )}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Pesapal status check failed (${res.status}): ${text}`
    );
  }

  const d = (await res.json()) as any;

  return {
    orderTrackingId: d.order_tracking_id,
    paymentMethod: d.payment_method,
    amount: d.amount,
    createdDate: d.created_date,
    confirmationCode: d.confirmation_code ?? null,
    paymentStatusDescription: d.payment_status_description,
    status: d.payment_status_description, // "Completed", "Failed", etc.
  };
}