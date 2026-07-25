/**
 * M-Pesa action routes — mounted at /api/mpesa
 *
 * Endpoints:
 *   POST /initiate            Trigger an STK push to a tenant's phone
 *   POST /callback            Safaricom STK async result webhook (no auth)
 *   POST /c2b/confirmation    Safaricom C2B confirmation webhook (no auth)
 *   POST /c2b/validation      Safaricom C2B validation webhook (no auth)
 *   GET  /status/:id          Poll transaction status by checkoutRequestId
 *   GET  /unmatched           List orphaned C2B transactions for manual matching
 *   POST /match               Manually link an unmatched C2B txn to a rent payment
 *
 * Critical reliability guarantees implemented here:
 *   1. Idempotency  — mpesaReceiptNumber uniqueness prevents double-credit
 *   2. C2B support  — tenants who pay paybill/till directly are reconciled
 *   3. Fuzzy match  — wrong-reference payments surfaced for manual resolution
 *   4. Partial pay  — invoices accumulate payments; balance tracked correctly
 *   5. Receipts     — tenants receive a WhatsApp confirmation after payment
 */

import { Router }          from 'express';
import { z }               from 'zod';
import { db }              from '../db';
import { rentPayments, tenants, mpesaTransactions, utilityBills } from '@shared/schema';
import { eq, and, or, like, gte, lte, isNull }     from 'drizzle-orm';
import { authenticateJWT } from '../middleware/auth';
import { safaricomIpOnly } from '../middleware/safaricomIp';
import { getMPesaService, isMpesaConfigured } from '../services/mpesa';
import { storage }         from '../storage';
import { notifyPaymentConfirmed } from '../ws';
import { whatsappService } from '../whatsapp';
import { resolvePaymentConfigForTenantId } from '../utils/resolvePaymentConfig';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n: number | string) =>
  `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Central reconciliation handler called from both STK and C2B routes.
 *
 * Responsibilities:
 *   - Idempotency check on mpesaReceiptNumber (prevents double-credit)
 *   - Partial vs full payment detection
 *   - Marks rentPayment status correctly (paid / partial)
 *   - Fires WebSocket event for real-time dashboard update
 *   - Sends WhatsApp receipt to tenant
 */
export async function reconcilePayment(opts: {
  rentPaymentId:        number | null | undefined;
  utilityBillId:        number | null | undefined;
  amount:               number;
  mpesaReceiptNumber:   string;
  phoneNumber:          string;
  transactionDate:      string;
  mpesaTransactionDbId: number;
  callbackSource:       'stk' | 'c2b';
}): Promise<void> {
  const {
    rentPaymentId, utilityBillId, amount, mpesaReceiptNumber,
    phoneNumber, transactionDate, mpesaTransactionDbId, callbackSource,
  } = opts;

  // ── 1. Idempotency guard ──────────────────────────────────────────────────
  // Safaricom sometimes sends the same callback multiple times.
  // Only the first processing of a receipt number takes effect.
  const existing = await db
    .select({ id: mpesaTransactions.id })
    .from(mpesaTransactions)
    .where(
      and(
        eq(mpesaTransactions.mpesaReceiptNumber, mpesaReceiptNumber),
        eq(mpesaTransactions.status, 'completed'),
      )
    )
    .limit(1);

  if (existing.length > 0 && existing[0].id !== mpesaTransactionDbId) {
    console.warn(`[M-Pesa] Duplicate callback ignored — receipt ${mpesaReceiptNumber} already processed (db id ${existing[0].id})`);
    return;
  }

  // Mark our record as completed regardless of invoice match
  await storage.updateMpesaTransaction(mpesaTransactionDbId, {
    status:            'completed',
    mpesaReceiptNumber,
    transactionDate,
  });

  // ── 2a. Utility bill payment path ────────────────────────────────────────
  if (utilityBillId && !rentPaymentId) {
    const [ubill] = await db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.id, utilityBillId))
      .limit(1);

    if (!ubill) {
      console.error(`[M-Pesa] utilityBillId ${utilityBillId} not found in db`);
      return;
    }

    // Mark the utility bill as paid
    await db
      .update(utilityBills)
      .set({
        status: 'paid',
        paidDate: new Date(),
        paymentMethod: 'mpesa',
        notes: [ubill.notes, `M-Pesa ${mpesaReceiptNumber}: KES ${amount} on ${transactionDate}`]
          .filter(Boolean).join(' | '),
      })
      .where(eq(utilityBills.id, utilityBillId));

    // Notify tenant via WebSocket so their portal updates in real time
    if ((ubill as any).tenantId) {
      const [tenantRow] = await db
        .select({ organizationId: tenants.organizationId, firstName: tenants.firstName, phone: tenants.phone })
        .from(tenants)
        .where(eq(tenants.id, (ubill as any).tenantId))
        .limit(1);

      if (tenantRow?.organizationId) {
        notifyPaymentConfirmed(tenantRow.organizationId, {
          id: utilityBillId,
          amount,
        });
      }

      // WhatsApp receipt
      const recipientPhone = tenantRow?.phone ?? phoneNumber;
      if (recipientPhone && whatsappService.isConfigured) {
        const utilLabel = ((ubill as any).utilityType ?? 'Utility').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const msg = [
          `✅ *${utilLabel} Bill Payment Received*`,
          `Receipt: ${mpesaReceiptNumber}`,
          `Amount: KES ${Math.round(amount).toLocaleString('en-KE')}`,
          `Bill Ref: ${ubill.billNumber ?? `#${utilityBillId}`} — *Fully settled* ✓`,
          `Date: ${transactionDate}`,
          `\nThank you${tenantRow?.firstName ? ', ' + tenantRow.firstName : ''}! Your ${utilLabel.toLowerCase()} bill has been recorded.`,
        ].join('\n');
        whatsappService.sendMessage({ to: recipientPhone, type: 'text', content: msg })
          .catch(err => console.warn('[M-Pesa] WhatsApp utility receipt send failed:', err));
      }
    }

    console.log(`[M-Pesa] Utility bill reconciled — receipt: ${mpesaReceiptNumber}, billId: ${utilityBillId}, amount: KES ${amount}`);
    return;
  }

  // ── 2b. Unmatched — no rentPaymentId or utilityBillId ────────────────────
  if (!rentPaymentId) {
    // Unmatched C2B payment — visible in /api/mpesa/unmatched for manual resolution
    console.warn(`[M-Pesa] ${callbackSource.toUpperCase()} ${mpesaReceiptNumber} has no rentPaymentId — saved as unmatched`);
    return;
  }

  // ── 2c. Rent invoice path ─────────────────────────────────────────────────
  const [invoice] = await db
    .select()
    .from(rentPayments)
    .where(eq(rentPayments.id, rentPaymentId))
    .limit(1);

  if (!invoice) {
    console.error(`[M-Pesa] rentPaymentId ${rentPaymentId} not found in db`);
    return;
  }

  // ── 3. Partial payment calculation ───────────────────────────────────────
  const invoiceAmount = Number(invoice.amount);

  // Sum all completed mpesa transactions already linked to this invoice
  // (handles the case where this is the 2nd or 3rd instalment)
  const prevRows = await db
    .select({ amount: mpesaTransactions.amount })
    .from(mpesaTransactions)
    .where(
      and(
        eq(mpesaTransactions.rentPaymentId, rentPaymentId),
        eq(mpesaTransactions.status, 'completed'),
      )
    );

  const alreadyPaid = prevRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalPaid   = alreadyPaid + amount;
  const balance     = invoiceAmount - totalPaid;
  const isFullyPaid = balance <= 0.01; // 1 cent tolerance for floating point

  const newStatus = isFullyPaid ? 'paid' : 'partial';
  const paidDate  = isFullyPaid ? new Date().toISOString().split('T')[0] : undefined;

  // Build an audit trail in the notes field
  const newNote = [
    invoice.notes,
    `M-Pesa ${mpesaReceiptNumber}: ${fmtKES(amount)} on ${transactionDate}`,
    balance > 0.01 ? `Balance: ${fmtKES(balance)}` : `Fully settled`,
  ].filter(Boolean).join(' | ');

  await storage.markPaymentAsPaid(rentPaymentId, {
    paidDate:      paidDate ?? invoice.paidDate ?? new Date().toISOString().split('T')[0],
    paymentMethod: 'mpesa',
    transactionId: mpesaReceiptNumber,
    notes:         newNote,
  });

  // markPaymentAsPaid always sets status='paid'; fix it to 'partial' if needed
  if (!isFullyPaid) {
    await db
      .update(rentPayments)
      .set({ status: 'partial' })
      .where(eq(rentPayments.id, rentPaymentId));
  }

  // ── 4. WebSocket real-time event ─────────────────────────────────────────
  let tenantRow: { organizationId: number | null; firstName: string | null; phone: string | null } | undefined;

  if (invoice.tenantId) {
    const rows = await db
      .select({
        organizationId: tenants.organizationId,
        firstName:      tenants.firstName,
        phone:          tenants.phone,
      })
      .from(tenants)
      .where(eq(tenants.id, invoice.tenantId))
      .limit(1);

    tenantRow = rows[0];

    if (tenantRow?.organizationId) {
      notifyPaymentConfirmed(tenantRow.organizationId, {
        id:            rentPaymentId,
        amount,
        invoiceNumber: invoice.invoiceNumber ?? undefined,
      });
    }
  }

  // ── 5. WhatsApp receipt ───────────────────────────────────────────────────
  const recipientPhone = tenantRow?.phone ?? phoneNumber;
  if (recipientPhone && whatsappService.isConfigured) {
    const msg = [
      `✅ *Payment Received*`,
      `Receipt: ${mpesaReceiptNumber}`,
      `Amount: ${fmtKES(amount)}`,
      `Invoice: ${invoice.invoiceNumber ?? `#${rentPaymentId}`} — ${isFullyPaid ? '*Fully settled* ✓' : `Balance: *${fmtKES(balance)}*`}`,
      `Date: ${transactionDate}`,
      `\nThank you${tenantRow?.firstName ? ', ' + tenantRow.firstName : ''}! Your payment has been recorded.`,
    ].join('\n');

    whatsappService.sendMessage({ to: recipientPhone, type: 'text', content: msg })
      .catch(err => console.warn('[M-Pesa] WhatsApp receipt send failed:', err));
  }

  console.log(
    `[M-Pesa] Reconciled — receipt: ${mpesaReceiptNumber}, ` +
    `invoiceId: ${rentPaymentId}, amount: ${fmtKES(amount)}, ` +
    `status: ${newStatus}, balance: ${fmtKES(Math.max(balance, 0))}`
  );
}

// ─── POST /api/mpesa/initiate ────────────────────────────────────────────────
router.post('/initiate', authenticateJWT, async (req: any, res) => {
  // Landlords cannot initiate STK push payments to tenant phones.
  // Only admins, managers, staff, caretakers, and tenants (paying their own rent)
  // are permitted.
  const callerRole: string = req.user?.role ?? '';
  if (callerRole === 'landlord') {
    return res.status(403).json({
      message: 'Landlords cannot initiate M-Pesa STK push payments. Contact your property manager.',
    });
  }
  const schema = z.object({
    phoneNumber:      z.string().min(9),
    amount:           z.number().positive(),
    rentPaymentId:    z.number().int().positive().optional(),
    utilityBillId:    z.number().int().positive().optional(),
    tenantId:         z.number().int().positive().optional(),
    accountReference: z.string().max(12).optional(),
    description:      z.string().max(13).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  let { phoneNumber, amount, rentPaymentId, utilityBillId, tenantId, accountReference, description } = parsed.data;

  // A tenant initiating their own payment may only ever have it recorded
  // against their own tenantId — resolve it from the JWT and ignore whatever
  // (if anything) was sent in the body, rather than trusting the client.
  if (callerRole === 'tenant') {
    const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
    if (!own) {
      return res.status(403).json({ message: 'Tenant profile not found.' });
    }
    tenantId = own.id;
  }

  try {
    const mpesaService = getMPesaService();
    if (!mpesaService) {
      return res.status(503).json({ message: 'M-Pesa is not configured on this server. Please contact your administrator.' });
    }

    const ref  = accountReference
      ?? (utilityBillId ? `UTIL-${utilityBillId}` : rentPaymentId ? `INV-${rentPaymentId}` : 'RENT');
    const desc = description ?? (utilityBillId ? 'Utility Payment' : 'Rent Payment');

    // ── Resolve shortcode from Payment Setup ─────────────────────────────────
    // Use the Paybill/Till configured for this tenant's specific landlord if
    // one exists (multi-landlord orgs), else the org-wide default, else the
    // MPESA_BUSINESS_SHORTCODE env var. Same resolution chain as the
    // tenant-facing GET /api/payment-config/public, so STK Push money always
    // lands wherever the tenant was actually told to pay.
    let resolvedShortCode: string | undefined;
    try {
      const orgId: number | undefined = req.user?.organizationId;
      if (orgId) {
        const resolved = tenantId
          ? await resolvePaymentConfigForTenantId(tenantId, orgId)
          : null;

        // Utility bill payments use utilityPayment's account, NOT
        // rentPayment's — they can be configured separately
        // (utilityPayment.sameAsRent: false), and previously this always
        // read rentPayment regardless, silently sending utility STK Pushes
        // to the rent account whenever the two were set up differently.
        const account = utilityBillId ? resolved?.utilityPayment : resolved?.rentPayment;
        const paybill = account?.mpesaPaybill?.trim();
        const till    = account?.mpesaTill?.trim();
        resolvedShortCode = paybill || till || undefined;

        if (resolvedShortCode) {
          console.log(`[MPesa] Using ${resolved?.resolvedFrom ?? "org"} ${utilityBillId ? "utility" : "rent"} shortcode: ${resolvedShortCode} (org ${orgId}${resolved?.landlordOwnerId ? `, landlord ${resolved.landlordOwnerId}` : ""})`);
        } else {
          console.log(`[MPesa] No Payment Setup shortcode for org ${orgId} — using env MPESA_BUSINESS_SHORTCODE`);
        }
      }
    } catch (lookupErr: any) {
      console.warn('[MPesa] Could not read Payment Setup config, using env shortcode:', lookupErr.message);
    }

    // Apply the resolved shortcode to the service config before the STK call,
    // then restore it immediately after — works with any version of mpesa.ts.
    const svcConfig = (mpesaService as any).config;
    const originalShortCode: string | undefined = svcConfig?.businessShortCode;

    // Safety guard: the server's single MPESA_PASSKEY env var is issued by
    // Safaricom specifically for originalShortCode. If a landlord or the org
    // has configured a DIFFERENT Paybill/Till for manual payment display,
    // that's fine for showing tenants where to pay manually — but attempting
    // an automated STK Push with a mismatched shortcode+passkey pair doesn't
    // just fail, it fails with a cryptic Safaricom authentication error after
    // the tenant has already been prompted. Refuse it up front instead, with
    // an actionable message, and let them use the manual Paybill/Till shown
    // on screen (which needs no passkey — it works for any shortcode).
    if (resolvedShortCode && originalShortCode && resolvedShortCode !== originalShortCode) {
      return res.status(409).json({
        message:
          "Automatic M-Pesa prompts (STK Push) aren't available for this specific payment destination yet — " +
          "please pay using the Paybill or Till number and steps shown on screen instead. " +
          "(This account uses a different Paybill/Till than the one STK Push is currently set up for; " +
          "ask your administrator to register it for Lipa Na M-Pesa Online to enable automatic prompts here.)",
        code: "STK_SHORTCODE_MISMATCH",
      });
    }

    if (resolvedShortCode && svcConfig) {
      svcConfig.businessShortCode = resolvedShortCode;
    }

    let stkResponse: any;
    try {
      stkResponse = await mpesaService.initiateSTKPush({
        phoneNumber,
        amount,
        accountReference: ref.slice(0, 12),
        transactionDesc:  desc.slice(0, 13),
      });
    } finally {
      // Always restore so other concurrent requests are unaffected
      if (resolvedShortCode && svcConfig && originalShortCode) {
        svcConfig.businessShortCode = originalShortCode;
      }
    }

    const transaction = await storage.createMpesaTransaction({
      phoneNumber,
      amount:              String(amount),
      status:              'pending',
      merchantRequestId:   stkResponse.MerchantRequestID,
      checkoutRequestId:   stkResponse.CheckoutRequestID,
      responseCode:        stkResponse.ResponseCode,
      responseDescription: stkResponse.ResponseDescription,
      customerMessage:     stkResponse.CustomerMessage,
      description:         desc,
      ...(tenantId      ? { tenantId }      : {}),
      ...(rentPaymentId ? { rentPaymentId } : {}),
      ...(utilityBillId ? { utilityBillId } : {}),
    });

    return res.status(200).json({
      transactionId:     transaction.id,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      customerMessage:   stkResponse.CustomerMessage,
    });
  } catch (error: any) {
    console.error('[M-Pesa] STK push failed:', error.message);
    return res.status(502).json({ message: error.message || 'Failed to initiate M-Pesa payment' });
  }
});

// ─── POST /api/mpesa/callback ────────────────────────────────────────────────
// Safaricom STK result — MUST respond 200 immediately.
router.post('/callback', safaricomIpOnly, async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const mpesaService = getMPesaService();
    if (!mpesaService) {
      console.error('[mpesa-actions] M-PESA callback received but service is not configured — raw body logged for manual recovery:', JSON.stringify(req.body));
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // always 200 to Safaricom
    }
    const parsed = mpesaService.parseCallback(req.body);
    const { checkoutRequestId, resultCode, resultDesc, amount, mpesaReceiptNumber, phoneNumber, transactionDate } = parsed;

    const transaction = await storage.getMpesaTransactionByCheckoutRequestId(checkoutRequestId);
    if (!transaction) {
      console.warn('[M-Pesa] STK callback for unknown checkoutRequestId:', checkoutRequestId);
      return;
    }

    if (resultCode !== 0) {
      await storage.updateMpesaTransaction(transaction.id, {
        status:       'failed',
        resultCode:   String(resultCode),
        resultDesc,
        callbackData: req.body,
      });
      console.log(`[M-Pesa] STK failed — code ${resultCode}: ${resultDesc}`);
      return;
    }

    if (!mpesaReceiptNumber || !amount) {
      console.error('[M-Pesa] STK success but missing receipt/amount', parsed);
      return;
    }

    await reconcilePayment({
      rentPaymentId:        transaction.rentPaymentId ?? null,
      utilityBillId:        (transaction as any).utilityBillId ?? null,
      amount,
      mpesaReceiptNumber,
      phoneNumber:          phoneNumber ?? transaction.phoneNumber,
      transactionDate:      String(transactionDate ?? new Date().toISOString()),
      mpesaTransactionDbId: transaction.id,
      callbackSource:       'stk',
    });

  } catch (err) {
    console.error('[M-Pesa] STK callback processing error:', err);
  }
});

// ─── POST /api/mpesa/c2b/validation ─────────────────────────────────────────
// Safaricom calls this BEFORE accepting a C2B payment.
// Register: Daraja portal → C2B → Register URLs → ValidationURL
router.post('/c2b/validation', safaricomIpOnly, (req, res) => {
  console.log('[M-Pesa] C2B validation:', JSON.stringify(req.body));
  res.status(200).json({ ResultCode: '0', ResultDesc: 'Accepted' });
});

// ─── POST /api/mpesa/c2b/confirmation ───────────────────────────────────────
// Safaricom confirms a COMPLETED C2B payment — this is final and irrevocable.
// Register: Daraja portal → C2B → Register URLs → ConfirmationURL
router.post('/c2b/confirmation', safaricomIpOnly, async (req, res) => {
  res.status(200).json({ ResultCode: '0', ResultDesc: 'Accepted' });

  try {
    const body = req.body;
    const transactionId   = String(body.TransID           ?? '');
    const amount          = Number(body.TransAmount        ?? 0);
    const phoneNumber     = String(body.MSISDN             ?? '');
    const accountRef      = String(body.BillRefNumber     ?? '').trim();
    const transactionDate = String(body.TransTime         ?? new Date().toISOString());

    if (!transactionId || !amount) {
      console.warn('[M-Pesa] C2B confirmation missing required fields', body);
      return;
    }

    console.log(`[M-Pesa] C2B — receipt: ${transactionId}, ref: "${accountRef}", phone: ${phoneNumber}, amount: ${fmtKES(amount)}`);

    // ── Fuzzy matching ────────────────────────────────────────────────────
    let matchedRentPaymentId: number | null = null;
    let matchedUtilityBillId: number | null = null;
    let matchedTenantId:      number | null = null;

    // Strategy 0: reference explicitly tags a utility bill (e.g. "UTIL-42") —
    // this is exactly the format shown to tenants for manual utility Paybill
    // payments (see tenant-portal.tsx), so check it FIRST and exclusively —
    // never fall through to the rent-invoice matching below for this case.
    const utilMatch = accountRef.match(/^UTIL-?(\d+)$/i);
    if (utilMatch) {
      const billId = parseInt(utilMatch[1], 10);
      const [bill] = await db
        .select({ id: utilityBills.id, status: utilityBills.status, tenantId: utilityBills.tenantId })
        .from(utilityBills)
        .where(eq(utilityBills.id, billId))
        .limit(1);
      if (bill && bill.status !== 'paid') {
        matchedUtilityBillId = bill.id;
        matchedTenantId = (bill as any).tenantId ?? null;
      }
    }

    // Strategy 1: account reference contains a rent invoice ID (e.g. "INV-42", "42")
    // — only tried when the reference wasn't a utility bill reference above.
    const invMatch = matchedUtilityBillId ? null : accountRef.match(/^(?:INV-?)?(\d+)$/i);
    if (invMatch) {
      const invoiceId = parseInt(invMatch[1], 10);
      const rows = await db
        .select({ id: rentPayments.id, tenantId: rentPayments.tenantId, status: rentPayments.status })
        .from(rentPayments)
        .where(eq(rentPayments.id, invoiceId))
        .limit(1);
      const inv = rows[0];
      if (inv && inv.status !== 'paid') {
        matchedRentPaymentId = inv.id;
        matchedTenantId      = inv.tenantId;
      }
    }

    // Strategy 2: phone number → tenant → pending invoice with similar amount
    // (skipped entirely if a utility bill was already matched above)
    if (!matchedRentPaymentId && !matchedUtilityBillId && phoneNumber) {
      const suffix = phoneNumber.slice(-9);
      const tenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(like(tenants.phone, `%${suffix}`))
        .limit(1);

      if (tenantRows[0]) {
        const tenantId = tenantRows[0].id;
        const invRows  = await db
          .select({ id: rentPayments.id, amount: rentPayments.amount })
          .from(rentPayments)
          .where(
            and(
              eq(rentPayments.tenantId, tenantId),
              or(eq(rentPayments.status, 'pending'), eq(rentPayments.status, 'partial')),
              gte(rentPayments.amount, String(amount * 0.9)),
              lte(rentPayments.amount, String(amount * 1.1)),
            )
          )
          .limit(1);

        if (invRows[0]) {
          matchedRentPaymentId = invRows[0].id;
          matchedTenantId      = tenantId;
          console.log(`[M-Pesa] C2B fuzzy-matched receipt ${transactionId} to invoice ${matchedRentPaymentId} via phone`);
        }
      }
    }

    // Create db record (unmatched ones are visible in /api/mpesa/unmatched)
    const mpesaTxn = await storage.createMpesaTransaction({
      phoneNumber,
      amount:             String(amount),
      status:             'pending',
      mpesaReceiptNumber: transactionId,
      description:        `C2B from ${phoneNumber}, ref "${accountRef}"`,
      ...(matchedTenantId      ? { tenantId:      matchedTenantId }      : {}),
      ...(matchedRentPaymentId ? { rentPaymentId: matchedRentPaymentId } : {}),
      ...(matchedUtilityBillId ? { utilityBillId: matchedUtilityBillId } : {}),
    });

    await reconcilePayment({
      rentPaymentId:        matchedRentPaymentId,
      utilityBillId:        matchedUtilityBillId,
      amount,
      mpesaReceiptNumber:   transactionId,
      phoneNumber,
      transactionDate,
      mpesaTransactionDbId: mpesaTxn.id,
      callbackSource:       'c2b',
    });

  } catch (err) {
    console.error('[M-Pesa] C2B confirmation processing error:', err);
  }
});

// ─── GET /api/mpesa/status/:checkoutRequestId ────────────────────────────────
router.get('/status/:checkoutRequestId', authenticateJWT, async (req: any, res) => {
  const { checkoutRequestId } = req.params;

  try {
    const transaction = await storage.getMpesaTransactionByCheckoutRequestId(checkoutRequestId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    // A tenant may only poll the status of their OWN payment.
    if (req.user.role === 'tenant') {
      const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
      if (!own || transaction.tenantId !== own.id) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
    }

    const ageMs = Date.now() - new Date(transaction.createdAt!).getTime();
    if (transaction.status === 'pending' && ageMs > 30_000) {
      try {
        const _svc = getMPesaService();
        if (!_svc) {
          return res.status(503).json({ message: 'M-PESA is not configured.' });
        }
        const result = await _svc.queryTransactionStatus(checkoutRequestId);
        if (result.ResultCode !== undefined) {
          const success = result.ResultCode === 0 || result.ResultCode === '0';
          await storage.updateMpesaTransaction(transaction.id, {
            status:     success ? 'completed' : (result.ResultCode === 1032 ? 'pending' : 'failed'),
            resultCode: String(result.ResultCode),
            resultDesc: result.ResultDesc,
          });
          return res.json(await storage.getMpesaTransaction(transaction.id));
        }
      } catch (qErr) {
        console.warn('[M-Pesa] Status query failed, returning local record:', qErr);
      }
    }

    return res.json(transaction);
  } catch (error: any) {
    console.error('[M-Pesa] Status check error:', error.message);
    return res.status(500).json({ message: 'Failed to check transaction status' });
  }
});

// ─── GET /api/mpesa/unmatched ────────────────────────────────────────────────
// Completed C2B transactions with no linked invoice — for manager resolution.
// mpesaTransactions has no organizationId column of its own — scope via its
// tenantId join to tenants.organizationId, same pattern used elsewhere this
// session for tables missing a direct org column. Transactions with no
// tenantId at all (couldn't even fuzzy-match a tenant by phone) have no way
// to be attributed to a specific org from the data available, so they're
// excluded here rather than shown to every org's admin/manager — a real but
// rare residual gap: fully-unidentifiable C2B payments currently need a
// different, manual resolution path outside this per-org view.
router.get('/unmatched', authenticateJWT, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;

    const rows = await db
      .select({ txn: mpesaTransactions })
      .from(mpesaTransactions)
      .innerJoin(tenants, eq(mpesaTransactions.tenantId, tenants.id))
      .where(
        and(
          eq(mpesaTransactions.status, 'completed'),
          isNull(mpesaTransactions.rentPaymentId),
          isNull(mpesaTransactions.utilityBillId),
          eq(tenants.organizationId, orgId),
        )
      )
      .orderBy(mpesaTransactions.createdAt);

    return res.json(rows.map(r => r.txn));
  } catch (err: any) {
    console.error('[M-Pesa] Unmatched query error:', err.message);
    return res.status(500).json({ message: 'Failed to fetch unmatched transactions' });
  }
});

// ─── POST /api/mpesa/match ───────────────────────────────────────────────────
// Manually link an unmatched C2B transaction to a rent payment.
router.post('/match', authenticateJWT, async (req: any, res) => {
  const schema = z.object({
    mpesaTransactionId: z.number().int().positive(),
    rentPaymentId:      z.number().int().positive().optional(),
    utilityBillId:      z.number().int().positive().optional(),
  }).refine(d => !!d.rentPaymentId !== !!d.utilityBillId, {
    message: 'Provide exactly one of rentPaymentId or utilityBillId',
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid request', errors: parsed.error.errors });
  }

  const { mpesaTransactionId, rentPaymentId, utilityBillId } = parsed.data;
  const orgId: number = req.user.organizationId;

  try {
    const rows = await db
      .select()
      .from(mpesaTransactions)
      .where(eq(mpesaTransactions.id, mpesaTransactionId))
      .limit(1);

    const txn = rows[0];
    if (!txn)                        return res.status(404).json({ message: 'M-Pesa transaction not found' });
    if (txn.status !== 'completed')  return res.status(400).json({ message: 'Transaction is not completed' });
    if (txn.rentPaymentId || txn.utilityBillId) return res.status(400).json({ message: 'Transaction already linked' });

    // Org-scope whichever target was chosen — a transaction may only be
    // matched to an invoice/bill within the caller's own organisation.
    if (rentPaymentId) {
      // rent_payments has no organizationId of its own — verify org via its
      // tenantId link to tenants.organizationId, same pattern used for the
      // utility bill check below.
      const [invoice] = await db.select({ id: rentPayments.id, tenantId: rentPayments.tenantId }).from(rentPayments)
        .where(eq(rentPayments.id, rentPaymentId)).limit(1);
      if (!invoice) return res.status(404).json({ message: 'Rent invoice not found' });

      const [invoiceTenant] = await db.select({ organizationId: tenants.organizationId }).from(tenants)
        .where(eq(tenants.id, invoice.tenantId)).limit(1);
      if (!invoiceTenant || invoiceTenant.organizationId !== orgId) {
        return res.status(404).json({ message: 'Rent invoice not found in your organisation' });
      }

      await storage.updateMpesaTransaction(mpesaTransactionId, { rentPaymentId });
    } else {
      const [bill] = await db.select({ id: utilityBills.id, tenantId: utilityBills.tenantId }).from(utilityBills)
        .where(eq(utilityBills.id, utilityBillId!)).limit(1);
      if (!bill) return res.status(404).json({ message: 'Utility bill not found' });
      // utilityBills has no organizationId of its own — verify org via its
      // direct tenantId link (the same field GET /my-bills relies on).
      const [billTenant] = bill.tenantId
        ? await db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, bill.tenantId)).limit(1)
        : [undefined];
      if (!billTenant || billTenant.organizationId !== orgId) return res.status(404).json({ message: 'Utility bill not found in your organisation' });

      await storage.updateMpesaTransaction(mpesaTransactionId, { utilityBillId } as any);
    }

    await reconcilePayment({
      rentPaymentId:        rentPaymentId ?? null,
      utilityBillId:        utilityBillId ?? null,
      amount:               Number(txn.amount),
      mpesaReceiptNumber:   txn.mpesaReceiptNumber ?? txn.transactionId ?? `MANUAL-${txn.id}`,
      phoneNumber:          txn.phoneNumber,
      transactionDate:      txn.transactionDate ?? new Date().toISOString(),
      mpesaTransactionDbId: txn.id,
      callbackSource:       'c2b',
    });

    return res.json({ message: 'Transaction matched and reconciled successfully' });
  } catch (err: any) {
    console.error('[M-Pesa] Manual match error:', err.message);
    return res.status(500).json({ message: 'Failed to match transaction' });
  }
});

export default router;