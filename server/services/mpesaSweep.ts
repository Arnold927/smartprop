/**
 * mpesaSweep.ts
 *
 * Periodic job that resolves pending M-Pesa STK transactions whose Safaricom
 * callback either never arrived (network drop, timeout) or arrived but was
 * not processed (server restart during callback).
 *
 * Previously, resolution only happened when the FRONTEND called
 * GET /api/mpesa/status/:id — meaning a tenant who closed their browser
 * after initiating payment would leave a "pending" record forever.
 *
 * This sweep runs every 5 minutes via rentScheduler and:
 *   1. Finds all STK transactions still "pending" after 2 minutes
 *   2. Queries Safaricom's STK query API for the real result
 *   3. If confirmed — runs reconcilePayment (marks invoice paid, sends WhatsApp)
 *   4. If failed / cancelled — marks the transaction failed
 *   5. If Safaricom itself is still processing — leaves it for the next sweep
 *   6. After 30 minutes with no resolution — marks as expired
 *
 * Integration:
 *   Import startMpesaSweep() and call it from server/index.ts alongside
 *   startRentScheduler().
 */

import { db }              from '../db';
import { mpesaTransactions, rentPayments, tenants } from '@shared/schema';
import { eq, and, lte, gte, isNull }                from 'drizzle-orm';
import { getMPesaService, isMpesaConfigured } from '../services/mpesa';
import { storage }         from '../storage';
import { notifyPaymentConfirmed } from '../ws';
import { whatsappService } from '../whatsapp';

const log = (msg: string) => console.log(`[MpesaSweep] ${msg}`);

const fmtKES = (n: number | string) =>
  `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Safaricom ResultCode 1032 = "Request cancelled by user" (still in progress if seen
// within 60s). We treat it as still-pending during the sweep.
const SAFARICOM_STILL_PROCESSING_CODE = 1032;

/**
 * Sweeps all pending STK transactions, queries Safaricom for their real status,
 * and reconciles confirmed ones.
 */
export async function sweepPendingMpesaTransactions(): Promise<void> {
  // ── Guard: skip sweep when M-PESA credentials are not configured ──────────
  // Without this guard, getMPesaService() returns null and the subsequent
  // .queryTransactionStatus() call throws, crashing the sweep timer silently.
  // The /api/dashboard/system-status endpoint surfaces this as an admin alert.
  if (!isMpesaConfigured()) {
    log(
      'Skipping sweep — M-PESA credentials not configured. ' +
      'Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_BUSINESS_SHORTCODE, ' +
      'MPESA_PASSKEY, and MPESA_CALLBACK_URL to enable automatic reconciliation.',
    );
    return;
  }

  const now           = new Date();
  const twoMinutesAgo = new Date(now.getTime() - 2  * 60 * 1000);
  const thirtyMinAgo  = new Date(now.getTime() - 30 * 60 * 1000);

  // Only STK push transactions need sweeping; C2B has no checkoutRequestId
  // and are already final when the confirmation webhook fires.
  const pending = await db
    .select()
    .from(mpesaTransactions)
    .where(
      and(
        eq(mpesaTransactions.status, 'pending'),
        lte(mpesaTransactions.createdAt, twoMinutesAgo),  // give Safaricom 2 min
        gte(mpesaTransactions.createdAt, thirtyMinAgo),    // don't query very old ones
      )
    );

  if (pending.length === 0) return;

  log(`Sweeping ${pending.length} pending transaction(s)...`);

  const mpesaService = getMPesaService()!;  // safe: isMpesaConfigured() checked above

  for (const txn of pending) {
    // C2B transactions don't have a checkoutRequestId — skip them
    if (!txn.checkoutRequestId) continue;

    try {
      const result = await mpesaService.queryTransactionStatus(txn.checkoutRequestId);
      const code   = Number(result.ResultCode);

      if (code === 0) {
        // ── Confirmed ─────────────────────────────────────────────────────
        log(`Transaction ${txn.id} confirmed by Safaricom — receipt: ${result.MpesaReceiptNumber ?? 'N/A'}`);

        const receiptNumber   = String(result.MpesaReceiptNumber ?? txn.transactionId ?? `SWEEP-${txn.id}`);
        const transactionDate = String(result.TransactionDate   ?? new Date().toISOString());
        const amount          = Number(txn.amount);

        // Update mpesaTransaction to completed
        await storage.updateMpesaTransaction(txn.id, {
          status:            'completed',
          mpesaReceiptNumber: receiptNumber,
          transactionDate,
          resultCode:        String(code),
          resultDesc:        result.ResultDesc,
        });

        if (!txn.rentPaymentId) {
          log(`Transaction ${txn.id} confirmed but has no rentPaymentId — left as unmatched`);
          continue;
        }

        // Reconcile invoice (partial/full + WhatsApp)
        const [invoice] = await db
          .select()
          .from(rentPayments)
          .where(eq(rentPayments.id, txn.rentPaymentId))
          .limit(1);

        if (!invoice) {
          log(`Warning: rentPaymentId ${txn.rentPaymentId} not found for transaction ${txn.id}`);
          continue;
        }

        const invoiceAmount = Number(invoice.amount);

        // Sum all completed payments for this invoice
        const prevRows = await db
          .select({ amount: mpesaTransactions.amount })
          .from(mpesaTransactions)
          .where(
            and(
              eq(mpesaTransactions.rentPaymentId, txn.rentPaymentId),
              eq(mpesaTransactions.status, 'completed'),
            )
          );

        const totalPaid   = prevRows.reduce((s, r) => s + Number(r.amount), 0);
        const balance     = invoiceAmount - totalPaid;
        const isFullyPaid = balance <= 0.01;

        await storage.markPaymentAsPaid(txn.rentPaymentId, {
          paidDate:      isFullyPaid ? new Date().toISOString().split('T')[0] : (invoice.paidDate ?? ''),
          paymentMethod: 'mpesa',
          transactionId: receiptNumber,
          notes: [
            invoice.notes,
            `[Sweep] M-Pesa ${receiptNumber}: ${fmtKES(amount)} on ${transactionDate}`,
            balance > 0.01 ? `Balance: ${fmtKES(balance)}` : `Fully settled`,
          ].filter(Boolean).join(' | '),
        });

        if (!isFullyPaid) {
          await db.update(rentPayments).set({ status: 'partial' }).where(eq(rentPayments.id, txn.rentPaymentId));
        }

        // WebSocket event
        if (invoice.tenantId) {
          const [tenantRow] = await db
            .select({ organizationId: tenants.organizationId, firstName: tenants.firstName, phoneNumber: tenants.phoneNumber })
            .from(tenants)
            .where(eq(tenants.id, invoice.tenantId))
            .limit(1);

          if (tenantRow?.organizationId) {
            notifyPaymentConfirmed(tenantRow.organizationId, {
              id:            txn.rentPaymentId,
              amount,
              invoiceNumber: invoice.invoiceNumber ?? undefined,
            });
          }

          // WhatsApp receipt (sweep may fire hours after the STK prompt —
          // the tenant may not have received confirmation because they closed
          // the app; this ensures they always get a receipt)
          const recipientPhone = tenantRow?.phoneNumber ?? txn.phoneNumber;
          if (recipientPhone && whatsappService.isConfigured) {
            const msg = [
              `✅ *Payment Confirmed*`,
              `Receipt: ${receiptNumber}`,
              `Amount: ${fmtKES(amount)}`,
              `Invoice: ${invoice.invoiceNumber ?? `#${txn.rentPaymentId}`} — ${isFullyPaid ? '*Fully settled* ✓' : `Balance: *${fmtKES(balance)}*`}`,
              `Date: ${transactionDate}`,
              `\nThank you${tenantRow?.firstName ? ', ' + tenantRow.firstName : ''}! Your payment has been recorded.`,
            ].join('\n');

            whatsappService.sendMessage({ to: recipientPhone, type: 'text', content: msg })
              .catch(err => log(`WhatsApp receipt failed for ${recipientPhone}: ${err}`));
          }
        }

        log(`Reconciled transaction ${txn.id} — invoice ${txn.rentPaymentId}, status: ${isFullyPaid ? 'paid' : 'partial'}`);

      } else if (code === SAFARICOM_STILL_PROCESSING_CODE) {
        // ── Still pending — leave for next sweep ──────────────────────────
        log(`Transaction ${txn.id} still processing (code 1032) — will retry`);

      } else {
        // ── Failed or cancelled ───────────────────────────────────────────
        await storage.updateMpesaTransaction(txn.id, {
          status:     'failed',
          resultCode: String(code),
          resultDesc: result.ResultDesc,
        });
        log(`Transaction ${txn.id} resolved as failed — code ${code}: ${result.ResultDesc}`);
      }

    } catch (err) {
      // Non-fatal: log and continue with other transactions.
      // The Safaricom query API itself can time out or 429 during peak hours.
      log(`Error sweeping transaction ${txn.id}: ${err}`);
    }
  }

  // ── Mark very old pending transactions as expired ─────────────────────────
  // Anything still pending after 30 minutes cannot be queried reliably.
  const expiredRows = await db
    .select({ id: mpesaTransactions.id })
    .from(mpesaTransactions)
    .where(
      and(
        eq(mpesaTransactions.status, 'pending'),
        lte(mpesaTransactions.createdAt, thirtyMinAgo),
      )
    );

  for (const row of expiredRows) {
    await storage.updateMpesaTransaction(row.id, {
      status:     'failed',
      resultDesc: 'Expired — no Safaricom callback received within 30 minutes',
    });
    log(`Transaction ${row.id} marked expired (>30 min with no confirmation)`);
  }

  log(`Sweep complete.`);
}

/**
 * Starts the periodic sweep.
 * Call this from server/index.ts after startRentScheduler().
 *
 * Runs immediately on startup (catches transactions from a server restart),
 * then every 5 minutes.
 */
export function startMpesaSweep(): void {
  log('Starting — will sweep every 5 minutes.');

  // Immediate first run (catches anything from a restart mid-payment)
  setImmediate(() => {
    sweepPendingMpesaTransactions().catch(err => log(`Startup sweep error: ${err}`));
  });

  // Recurring 5-minute interval
  setInterval(() => {
    sweepPendingMpesaTransactions().catch(err => log(`Sweep error: ${err}`));
  }, 5 * 60 * 1000);
}
