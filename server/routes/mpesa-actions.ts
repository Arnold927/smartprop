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
import { rentPayments, tenants, mpesaTransactions, utilityBills, tenantShortBookings, tenantShortRentals, users } from '@shared/schema';
import { eq, and, or, like, gte, lte, isNull, inArray, ne, asc, desc, sql } from 'drizzle-orm';
import { authenticateJWT } from '../middleware/auth';
import { safaricomIpOnly } from '../middleware/safaricomIp';
import { getMPesaService, isMpesaConfigured, createMPesaServiceForOverrides } from '../services/mpesa';
import { storage }         from '../storage';
import { notifyPaymentConfirmed } from '../ws';
import { applyPayment, rentBalance, utilityBalances, round2, money, todayEAT, EPS, PaymentRuleError } from '../services/rent-ledger';
import { pushNotification } from './notifications';
import { submitInvoice } from '../services/etims';
import { sendBookingConfirmationEmail, sendNewBookingAlertEmail } from '../lib/email';
import { whatsappService } from '../whatsapp';
import { resolvePaymentConfigForTenantId } from '../utils/resolvePaymentConfig';
import { buildRentAccountReference, buildUtilityAccountReference, parseAccountReference } from '@shared/paymentReference';

const router = Router();

/**
 * The three Safaricom webhooks live on their OWN router, mounted with NO login in routes/index.ts.
 * They used to be registered as app.post('/api/mpesa/callback', (req,res,next) => router(req,res,next)) — but a router
 * matches on the part of the URL AFTER its mount point, and app.post() leaves the full URL in place, so none of the three
 * paths ever matched and every Safaricom confirmation fell through to the login guard and got a 401. Tenants were charged
 * and the app never found out. Mounting this router at /api/mpesa makes '/callback' mean /api/mpesa/callback.
 */
export const mpesaWebhookRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n: number | string) =>
  `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** M-Pesa's TransactionDate / TransTime is yyyymmddHHmmss; fall back to an ISO date, then to today (Nairobi). */
function mpesaDay(raw: string | number | undefined | null): string {
  const t = String(raw ?? '');
  const m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : todayEAT();
}

/** Tell the organisation's managers about something that needs a human (an unmatched / over-paid M-Pesa payment). */
async function alertManagers(orgId: number | null | undefined, title: string, message: string) {
  if (!orgId) return;
  try {
    const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, orgId), inArray(users.role, ['admin', 'manager'])));
    for (const u of rows) pushNotification(u.id, { type: 'payment', title, message, ts: new Date().toISOString(), link: '/rent-collection' });
  } catch (e) { console.warn('[M-Pesa] manager alert failed:', e); }
}

/**
 * Central reconciliation, called by the STK callback, the C2B confirmation, the status sweep and the manager's manual match.
 *
 * All the arithmetic lives in services/rent-ledger.ts (applyPayment): one receipt per payment, unique on the M-Pesa receipt
 * code — so the same confirmation arriving twice is applied once — a part payment leaves the invoice/bill open, the full
 * amount closes it, an overpayment is recorded for the manager, and rent receipts reach the general ledger.
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

  // A DIFFERENT row already carries this receipt code (Safaricom re-sent a C2B confirmation, which creates a new row each time).
  const same = await db.select({ id: mpesaTransactions.id }).from(mpesaTransactions)
    .where(and(eq(mpesaTransactions.mpesaReceiptNumber, mpesaReceiptNumber), eq(mpesaTransactions.status, 'completed'), ne(mpesaTransactions.id, mpesaTransactionDbId)))
    .limit(1);
  if (same.length > 0) {
    console.warn(`[M-Pesa] Duplicate callback ignored — receipt ${mpesaReceiptNumber} already processed (db id ${same[0].id})`);
    await storage.updateMpesaTransaction(mpesaTransactionDbId, { status: 'duplicate' } as any);
    return;
  }

  await storage.updateMpesaTransaction(mpesaTransactionDbId, { status: 'completed', mpesaReceiptNumber, transactionDate });

  const target = rentPaymentId ? ({ kind: 'rent', id: rentPaymentId } as const)
    : utilityBillId ? ({ kind: 'utility', id: utilityBillId } as const) : null;

  // No invoice/bill identified — it stays visible in /api/mpesa/unmatched for a manager to resolve.
  if (!target) {
    console.warn(`[M-Pesa] ${callbackSource.toUpperCase()} ${mpesaReceiptNumber} has no rentPaymentId — saved as unmatched`);
    return;
  }

  const paidDate = mpesaDay(transactionDate);
  const result = await applyPayment({
    target, amount, method: 'mpesa', paidDate, reference: mpesaReceiptNumber, receiptNumber: mpesaReceiptNumber,
    actorUserId: null, allowOverpay: true,
  });

  // identify the tenant / organisation for the notifications below
  const [bill]: any[] = target.kind === 'rent'
    ? await db.select().from(rentPayments).where(eq(rentPayments.id, target.id)).limit(1)
    : await db.select().from(utilityBills).where(eq(utilityBills.id, target.id)).limit(1);
  const [tenantRow] = bill?.tenantId
    ? await db.select({ organizationId: tenants.organizationId, firstName: tenants.firstName, phone: tenants.phone, userId: tenants.userId }).from(tenants).where(eq(tenants.id, bill.tenantId)).limit(1)
    : [undefined];

  if (!result.applied) {
    if (result.reason === 'duplicate') { console.warn(`[M-Pesa] receipt ${mpesaReceiptNumber} was already applied — ignored`); return; }
    // Real money arrived for something already settled. Don't touch the bill; detach the payment so it shows up as unmatched.
    await db.update(mpesaTransactions).set({ rentPaymentId: null, utilityBillId: null, description: `${mpesaReceiptNumber}: sent for an invoice/bill that was already paid — needs a manager` } as any)
      .where(eq(mpesaTransactions.id, mpesaTransactionDbId));
    await alertManagers(tenantRow?.organizationId, 'M-Pesa payment needs attention',
      `${fmtKES(amount)} (receipt ${mpesaReceiptNumber}) arrived for ${target.kind === 'rent' ? (bill?.invoiceNumber ?? `invoice #${target.id}`) : (bill?.billNumber ?? `bill #${target.id}`)}, which is already settled. Match it to another invoice or refund it.`);
    return;
  }

  if (tenantRow?.organizationId) {
    notifyPaymentConfirmed(tenantRow.organizationId, { id: target.id, amount, invoiceNumber: bill?.invoiceNumber ?? undefined });
  }
  if (result.overpaid > EPS) {
    await alertManagers(tenantRow?.organizationId, 'Tenant overpaid',
      `${fmtKES(result.overpaid)} more than due was received on ${bill?.invoiceNumber ?? bill?.billNumber ?? `#${target.id}`} (receipt ${mpesaReceiptNumber}). Refund it or credit the next invoice.`);
  }

  const ref = target.kind === 'rent' ? (bill?.invoiceNumber ?? `#${target.id}`) : (bill?.billNumber ?? `#${target.id}`);
  const label = target.kind === 'rent' ? 'Payment Received'
    : `${String(bill?.utilityType ?? 'Utility').replace(/\b\w/g, (c: string) => c.toUpperCase())} Bill Payment Received`;
  const standing = result.fullyPaid ? '*Fully settled* ✓' : `Balance: *${fmtKES(result.balance)}*`;

  if (tenantRow?.userId) {
    pushNotification(tenantRow.userId, {
      type: 'payment',
      title: result.fullyPaid ? 'Payment received — settled' : 'Part payment received',
      message: `${fmtKES(amount)} received for ${ref} (receipt ${mpesaReceiptNumber}).${result.fullyPaid ? '' : ` Balance still due: ${fmtKES(result.balance)}.`}`,
      ts: new Date().toISOString(), link: '/tenant-portal',
    });
  }

  const recipientPhone = tenantRow?.phone ?? phoneNumber;
  if (recipientPhone && whatsappService.isConfigured) {
    const msg = [
      `✅ *${label}*`,
      `Receipt: ${mpesaReceiptNumber}`,
      `Amount: ${fmtKES(amount)}`,
      `${target.kind === 'rent' ? 'Invoice' : 'Bill'}: ${ref} — ${standing}`,
      `Date: ${paidDate}`,
      `\nThank you${tenantRow?.firstName ? ', ' + tenantRow.firstName : ''}! Your payment has been recorded.`,
    ].join('\n');
    whatsappService.sendMessage({ to: recipientPhone, type: 'text', content: msg })
      .catch(err => console.warn('[M-Pesa] WhatsApp receipt send failed:', err));
  }

  // KRA eTIMS once a rent invoice is fully settled (same as a manual full payment). Non-fatal.
  if (target.kind === 'rent' && result.fullyPaid && tenantRow?.organizationId) {
    submitInvoice(tenantRow.organizationId, 'rent_payment', target.id).catch((e: any) => console.error('[eTIMS] Auto-submission failed (non-fatal):', e?.message));
  }

  console.log(`[M-Pesa] Reconciled — receipt: ${mpesaReceiptNumber}, ${target.kind}Id: ${target.id}, amount: ${fmtKES(amount)}, status: ${result.status}, balance: ${fmtKES(result.balance)}`);
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
  if (callerRole === 'contractor') {
    return res.status(403).json({ message: 'Not permitted.' });
  }
  const schema = z.object({
    phoneNumber:      z.string().min(9),
    // Daraja takes whole shillings only
    amount:           z.number().int('M-Pesa amounts are in whole shillings').positive(),
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

    // The invoice/bill being paid must actually belong to THIS tenant.
    // Previously only tenantId was forced — rentPaymentId/utilityBillId were
    // trusted as-is from the client, so a tenant could pass any other
    // tenant's invoice id (even one belonging to a different landlord in a
    // multi-landlord org) and mark it paid, while their own invoice stayed
    // unpaid and the actual money still landed correctly in their own
    // landlord's account — a payment silently misattributed to a stranger.
    if (rentPaymentId) {
      const [inv] = await db.select({ tenantId: rentPayments.tenantId }).from(rentPayments).where(eq(rentPayments.id, rentPaymentId)).limit(1);
      if (!inv || inv.tenantId !== tenantId) {
        return res.status(403).json({ message: 'This payment does not belong to you.' });
      }
    }
    if (utilityBillId) {
      const [bill] = await db.select({ tenantId: utilityBills.tenantId }).from(utilityBills).where(eq(utilityBills.id, utilityBillId)).limit(1);
      if (!bill || bill.tenantId !== tenantId) {
        return res.status(403).json({ message: 'This bill does not belong to you.' });
      }
    }
  } else if (rentPaymentId || utilityBillId) {
    // Non-tenant callers (staff/manager/admin/caretaker — landlords are
    // already blocked above) may initiate on behalf of any tenant, but only
    // within their own organisation — previously unchecked entirely, so a
    // caller could reference another org's invoice/bill outright.
    const orgId: number = req.user.organizationId;
    if (rentPaymentId) {
      const [inv] = await db.select({ tenantId: rentPayments.tenantId }).from(rentPayments).where(eq(rentPayments.id, rentPaymentId)).limit(1);
      const [invTenant] = inv ? await db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1) : [undefined];
      if (!invTenant || invTenant.organizationId !== orgId) {
        return res.status(404).json({ message: 'Rent invoice not found in your organisation.' });
      }
    }
    if (utilityBillId) {
      const [bill] = await db.select({ tenantId: utilityBills.tenantId }).from(utilityBills).where(eq(utilityBills.id, utilityBillId)).limit(1);
      const [billTenant] = bill?.tenantId ? await db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, bill.tenantId)).limit(1) : [undefined];
      if (!billTenant || billTenant.organizationId !== orgId) {
        return res.status(404).json({ message: 'Utility bill not found in your organisation.' });
      }
    }
  }

  // What is being paid must still be owed, and the prompt may not ask for more than the balance — otherwise a tenant could
  // overpay by accident (or an invoice already settled by cash could be "paid" a second time).
  if (rentPaymentId || utilityBillId) {
    const due = rentPaymentId
      ? await (async () => { const [r] = await db.select().from(rentPayments).where(eq(rentPayments.id, rentPaymentId!)).limit(1); return r ? { settled: r.status === 'paid' || r.status === 'completed', ...(await rentBalance(r)) } : null; })()
      : await (async () => { const [b] = await db.select().from(utilityBills).where(eq(utilityBills.id, utilityBillId!)).limit(1); return b ? { settled: b.status === 'paid', ...((await utilityBalances([b as any])).get(b.id)!) } : null; })();
    if (!due) return res.status(404).json({ message: 'Nothing to pay was found.' });
    if (due.settled || due.balance <= EPS) return res.status(409).json({ message: 'This is already fully paid.' });
    if (amount > Math.ceil(due.balance) + EPS) {
      return res.status(400).json({ message: `The balance is KES ${due.balance.toLocaleString('en-KE', { minimumFractionDigits: 2 })} — enter that amount or less.`, balance: due.balance });
    }
  }

  try {
    const mpesaService = getMPesaService();
    if (!mpesaService) {
      return res.status(503).json({ message: 'M-Pesa is not configured on this server. Please contact your administrator.' });
    }

    const ref  = accountReference
      ?? (utilityBillId ? buildUtilityAccountReference(utilityBillId) : rentPaymentId ? buildRentAccountReference(rentPaymentId) : 'RENT');
    const desc = description ?? (utilityBillId ? 'Utility Payment' : 'Rent Payment');

    // ── Resolve shortcode + credentials from Payment Setup ───────────────────
    // Use the Paybill/Till (and, if configured, the full Daraja credentials)
    // for this tenant's specific landlord if one exists (multi-landlord
    // orgs), else the org-wide default, else the MPESA_BUSINESS_SHORTCODE
    // env var. Same resolution chain as the tenant-facing
    // GET /api/payment-config/public, so STK Push money always lands
    // wherever the tenant was actually told to pay.
    let resolvedShortCode: string | undefined;
    let landlordMpesaService: ReturnType<typeof createMPesaServiceForOverrides> = null;
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

        // If this landlord has their own full Daraja credentials (not just
        // a display Paybill number), build a properly-paired service
        // instance for them — different landlords, or the same management
        // company acting on behalf of different owners, very likely have
        // independently-registered shortcodes, each needing its own passkey.
        if (resolved?.mpesaCredentials) {
          landlordMpesaService = createMPesaServiceForOverrides(resolved.mpesaCredentials);
          if (landlordMpesaService) {
            console.log(`[MPesa] Using landlord ${resolved.landlordOwnerId}'s own Daraja credentials for shortcode ${resolved.mpesaCredentials.businessShortCode}`);
          }
        }
      }
    } catch (lookupErr: any) {
      console.warn('[MPesa] Could not read Payment Setup config, using env shortcode:', lookupErr.message);
    }

    // Use the landlord's own properly-paired service if we built one above;
    // otherwise fall back to the server-default instance.
    const activeMpesaService = landlordMpesaService ?? mpesaService;
    const originalShortCode: string | undefined = (mpesaService as any)?.config?.businessShortCode;

    // Safety guard for the remaining case: a landlord/org has configured a
    // DIFFERENT Paybill/Till for manual payment display, but hasn't (or
    // can't) provide full Daraja credentials for it — the server's single
    // MPESA_PASSKEY env var is issued by Safaricom specifically for
    // originalShortCode, and attempting an automated STK Push with a
    // mismatched shortcode+passkey pair doesn't just fail, it fails with a
    // cryptic Safaricom authentication error after the tenant has already
    // been prompted. Refuse it up front instead, with an actionable
    // message, and let them use the manual Paybill/Till shown on screen
    // (which needs no passkey — it works for any shortcode).
    if (!landlordMpesaService && resolvedShortCode && originalShortCode && resolvedShortCode !== originalShortCode) {
      return res.status(409).json({
        message:
          "Automatic M-Pesa prompts (STK Push) aren't available for this specific payment destination yet — " +
          "please pay using the Paybill or Till number and steps shown on screen instead. " +
          "(This account uses a different Paybill/Till than the one STK Push is currently set up for; " +
          "ask your administrator to add full Daraja API credentials for it, or register it for Lipa Na M-Pesa Online, to enable automatic prompts here.)",
        code: "STK_SHORTCODE_MISMATCH",
      });
    }

    let stkResponse: any;
    stkResponse = await activeMpesaService.initiateSTKPush({
      phoneNumber,
      amount,
      accountReference: ref.slice(0, 12),
      transactionDesc:  desc.slice(0, 13),
    });

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
mpesaWebhookRouter.post('/callback', safaricomIpOnly, async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const mpesaService = getMPesaService();
    if (!mpesaService) {
      console.error('[mpesa-actions] M-PESA callback received but service is not configured — raw body logged for manual recovery:', JSON.stringify(req.body));
      return; // the 200 was already sent above
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
      // Booking-specific: mark paymentStatus as failed explicitly, distinct
      // from "still pending" — the frontend polls for exactly this so it
      // can stop waiting and offer a retry, rather than only ever timing
      // out generically after 2 minutes. bookingStatus is left alone (not
      // cancelled) since the guest can still retry payment on the same
      // booking.
      if ((transaction as any).shortTermBookingId) {
        await db.update(tenantShortBookings)
          .set({ paymentStatus: 'failed', updatedAt: new Date() })
          .where(eq(tenantShortBookings.id, (transaction as any).shortTermBookingId));
      }
      console.log(`[M-Pesa] STK failed — code ${resultCode}: ${resultDesc}`);
      return;
    }

    if (!mpesaReceiptNumber || !amount) {
      console.error('[M-Pesa] STK success but missing receipt/amount', parsed);
      return;
    }

    // Short-term stay bookings aren't a rent/utility payment — reconcilePayment
    // below doesn't know about them, so they're confirmed directly here and
    // don't fall through to that logic.
    if ((transaction as any).shortTermBookingId) {
      const bookingId = (transaction as any).shortTermBookingId;
      await storage.updateMpesaTransaction(transaction.id, {
        status: 'completed',
        mpesaReceiptNumber,
        resultCode: String(resultCode),
        resultDesc,
        callbackData: req.body,
      });
      const [updatedBooking] = await db.update(tenantShortBookings)
        .set({ bookingStatus: 'confirmed', paymentStatus: 'paid', updatedAt: new Date() })
        .where(eq(tenantShortBookings.id, bookingId))
        .returning();
      console.log(`[M-Pesa] Booking ${bookingId} confirmed via STK — receipt ${mpesaReceiptNumber}`);

      // Email notifications — deliberately isolated in their own try/catch.
      // A Resend outage or bad config shouldn't undo a real, paid booking
      // confirmation; worst case here is a booking confirms silently
      // without an email, not a booking that fails to confirm at all.
      try {
        const [listing] = await db.select().from(tenantShortRentals)
          .where(eq(tenantShortRentals.id, updatedBooking.rentalListingId)).limit(1);
        if (listing && updatedBooking) {
          const checkInStr = new Date(updatedBooking.checkInDate).toLocaleDateString();
          const checkOutStr = new Date(updatedBooking.checkOutDate).toLocaleDateString();

          await sendBookingConfirmationEmail({
            to: updatedBooking.guestEmail,
            guestName: updatedBooking.guestName,
            listingTitle: listing.listingTitle,
            bookingReference: updatedBooking.bookingReference,
            checkInDate: checkInStr,
            checkOutDate: checkOutStr,
            totalAmount: String(updatedBooking.totalAmount),
            currency: updatedBooking.currency,
          });

          // Resolve the host's email — a tenant-sublet listing has its own
          // email on the tenant record directly; an owner-managed listing
          // needs a lookup through the users table via ownerId.
          let hostEmail: string | null = null;
          if (listing.tenantId) {
            const [tenantRow] = await db.select({ email: tenants.email }).from(tenants).where(eq(tenants.id, listing.tenantId)).limit(1);
            hostEmail = tenantRow?.email ?? null;
          } else if (listing.ownerId) {
            const [ownerRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, listing.ownerId)).limit(1);
            hostEmail = ownerRow?.email ?? null;
          }
          if (hostEmail) {
            await sendNewBookingAlertEmail({
              to: hostEmail,
              listingTitle: listing.listingTitle,
              guestName: updatedBooking.guestName,
              guestPhone: updatedBooking.guestPhone,
              bookingReference: updatedBooking.bookingReference,
              checkInDate: checkInStr,
              checkOutDate: checkOutStr,
              totalAmount: String(updatedBooking.totalAmount),
              currency: updatedBooking.currency,
            });
          } else {
            console.warn(`[M-Pesa] No host email resolved for listing ${listing.id} — new booking alert not sent`);
          }
        }
      } catch (emailErr) {
        console.error('[M-Pesa] Booking confirmed, but sending notification email(s) failed:', emailErr);
      }
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
mpesaWebhookRouter.post('/c2b/validation', safaricomIpOnly, (req, res) => {
  console.log('[M-Pesa] C2B validation:', JSON.stringify(req.body));
  res.status(200).json({ ResultCode: '0', ResultDesc: 'Accepted' });
});

// ─── POST /api/mpesa/c2b/confirmation ───────────────────────────────────────
// Safaricom confirms a COMPLETED C2B payment — this is final and irrevocable.
// Register: Daraja portal → C2B → Register URLs → ConfirmationURL
mpesaWebhookRouter.post('/c2b/confirmation', safaricomIpOnly, async (req, res) => {
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

    // Strategy 0/1: the account reference explicitly tags a utility bill
    // ("UTIL-42") or a rent invoice ("INV-42"/"42") — shared/paymentReference.ts
    // is the single source of truth for this format, used by the tenant
    // portal (what's actually sent/shown) and here (what's parsed back), so
    // the two can never drift out of sync the way they previously did.
    const parsedRef = parseAccountReference(accountRef);

    if (parsedRef?.kind === "utility") {
      const [bill] = await db
        .select({ id: utilityBills.id, status: utilityBills.status, tenantId: utilityBills.tenantId })
        .from(utilityBills)
        .where(eq(utilityBills.id, parsedRef.id))
        .limit(1);
      if (bill && bill.status !== 'paid') {
        matchedUtilityBillId = bill.id;
        matchedTenantId = (bill as any).tenantId ?? null;
      }
    } else if (parsedRef?.kind === "rent") {
      const rows = await db
        .select({ id: rentPayments.id, tenantId: rentPayments.tenantId, status: rentPayments.status })
        .from(rentPayments)
        .where(eq(rentPayments.id, parsedRef.id))
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
      // The same number can legitimately exist on more than one tenant record (someone who moved between landlords on the
      // platform). Prefer the tenant who is still active and, among those, the one that actually owes this amount.
      const tenantRows = await db
        .select({ id: tenants.id, status: tenants.status })
        .from(tenants)
        .where(like(tenants.phone, `%${suffix}`))
        .orderBy(sql`case when ${tenants.status} = 'active' then 0 else 1 end`, desc(tenants.id))
        .limit(5);

      let invRows: Array<{ id: number; amount: string }> = [];
      let tenantId: number | null = null;
      for (const cand of tenantRows) {
        const found = await db
          .select({ id: rentPayments.id, amount: rentPayments.amount })
          .from(rentPayments)
          .where(
            and(
              eq(rentPayments.tenantId, cand.id),
              or(eq(rentPayments.status, 'pending'), eq(rentPayments.status, 'overdue'), eq(rentPayments.status, 'partial')),
              gte(rentPayments.amount, String(amount * 0.9)),
              lte(rentPayments.amount, String(amount * 1.1)),
            )
          )
          .orderBy(asc(rentPayments.dueDate))
          .limit(1);
        if (found[0]) { tenantId = cand.id; invRows = found as any; break; }
      }
      if (tenantId == null && tenantRows[0]) tenantId = tenantRows[0].id;

      if (tenantId != null) {
        // Even when no invoice fits, remember WHOSE payment this is: it is what puts an unmatched payment on the
        // manager's /unmatched list (that list is scoped by tenant → organisation). Without it, a part payment sent to
        // the paybill with a mistyped reference belonged to nobody and could never be found or matched.
        matchedTenantId = tenantId;
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
    // A payment that was identified as another organisation's tenant is not ours to re-assign.
    if (txn.tenantId) {
      const [txnTenant] = await db.select({ organizationId: tenants.organizationId }).from(tenants).where(eq(tenants.id, txn.tenantId)).limit(1);
      if (!txnTenant || txnTenant.organizationId !== orgId) return res.status(404).json({ message: 'M-Pesa transaction not found' });
    }
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