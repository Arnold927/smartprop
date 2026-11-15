/**
 * Rent Scheduler
 *
 * Runs three daily jobs (no external deps — pure setTimeout recursion):
 *
 * 1. DAILY at 07:00 EAT — Generate rent invoices for all active tenants
 *    whose due date for this month has not yet been created.
 *    A tenant gets one invoice per calendar month; duplicates are skipped.
 *
 * 2. DAILY at 07:30 EAT — Mark pending invoices whose due date has passed
 *    as "overdue".
 *
 * 3. DAILY at 08:00 EAT — Send personalised email reminders to tenants with
 *    overdue or partial invoices. Each tenant receives one email covering:
 *      - Their current overdue/partial invoice with the exact balance
 *      - A table of any prior outstanding invoices with days-overdue counts
 *      - A grand total if multiple invoices are outstanding
 */

import { db } from '../db';
import { tenants, rentPayments, units, properties, organizations, userNotificationPreferences, paymentReminders } from '@shared/schema';
import { eq, and, sql, ne, inArray } from 'drizzle-orm';
import { storage } from '../storage';
import { sendRentReminderEmail } from '../lib/email';
import { notifyTenant } from './notifyTenant';
import { loadContact, processDueReminders } from './payment-reminders';
import { dispatchDueBroadcasts } from './broadcast-dispatch';
import { toE164 } from '../lib/phone';
import { isEmailConfigured } from '../lib/email';

const log = (msg: string) => console.log(`[RentScheduler] ${msg}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Today's date in Nairobi. Rent due dates are calendar dates, so "overdue" must flip at midnight EAT, not midnight UTC. */
function todayStr(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().split('T')[0];
}

/** Whole days from one calendar date to another (positive when `to` is later). */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10) + 'T00:00:00Z') - Date.parse(from.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

/** When this tenant was last sent a reminder of this kind (scheduler or manual). */
async function lastReminderSent(tenantId: number, type: string): Promise<Date | null> {
  const [r] = await db.select({ at: paymentReminders.sentAt }).from(paymentReminders)
    .where(and(eq(paymentReminders.tenantId, tenantId), eq(paymentReminders.reminderType, type), eq(paymentReminders.status, 'sent')))
    .orderBy(sql`${paymentReminders.sentAt} desc`).limit(1);
  return r?.at ?? null;
}

async function logReminder(tenantId: number, type: string, channel: string, message: string, extra: Record<string, unknown>) {
  await db.insert(paymentReminders).values({
    tenantId, reminderType: type, channel: channel.slice(0, 10), message: message.slice(0, 500),
    scheduledFor: new Date(), sentAt: new Date(), status: 'sent', recipientInfo: { source: 'scheduler', ...extra },
  });
}

/** ms until the next occurrence of HH:MM EAT (UTC+3) */
function msUntilEAT(hh: number, mm: number): number {
  const now = new Date();
  // EAT offset: UTC+3
  const eatNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const target = new Date(eatNow);
  target.setUTCHours(hh - 3, mm, 0, 0); // convert back to UTC
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

/** Schedule a daily recurring job. Fires first at the next EAT HH:MM. */
function scheduleDailyEAT(hh: number, mm: number, job: () => Promise<void>): void {
  const runAndReschedule = async () => {
    try {
      await job();
    } catch (err) {
      log(`Job error: ${err}`);
    }
    setTimeout(runAndReschedule, msUntilEAT(hh, mm));
  };
  const delay = msUntilEAT(hh, mm);
  log(`First run in ${Math.round(delay / 60000)} min (${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')} EAT)`);
  setTimeout(runAndReschedule, delay);
}

// ── Job 1: Generate monthly rent invoices ────────────────────────────────────

export async function generateMonthlyRentInvoices(): Promise<number> {
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth() + 1; // 1-based
  const monthStr = `${year}-${month.toString().padStart(2, '0')}`;

  // All active tenants with a monthly rent set
  const activeTenants = await db
    .select()
    .from(tenants)
    .where(
      and(
        eq(tenants.status, 'active'),
        sql`${tenants.monthlyRent} IS NOT NULL`,
        sql`${tenants.monthlyRent}::numeric > 0`,
      )
    );

  let created = 0;

  for (const tenant of activeTenants) {
    // Skip if an invoice for this tenant already exists this calendar month.
    // We check both YYYY-MM prefix of due_date AND created_at to guard against
    // timezone-shifted dates (e.g. Apr 30 stored instead of May 1).
    const monthStart = `${year}-${month.toString().padStart(2, '0')}-01`;
    const monthEnd   = new Date(Date.UTC(year, month, 1)).toISOString().split('T')[0]; // 1st of next month

    const existing = await db
      .select({ id: rentPayments.id })
      .from(rentPayments)
      .where(
        and(
          eq(rentPayments.tenantId, tenant.id),
          // Invoice due date falls anywhere within this calendar month
          sql`${rentPayments.dueDate} >= ${monthStart}::date`,
          sql`${rentPayments.dueDate} <  ${monthEnd}::date`
        )
      )
      .limit(1);

    if (existing.length > 0) continue;

    // Due date: 1st of the current month — always constructed in UTC
    // so the stored date is never shifted by server timezone offset
    const rawDue = new Date(Date.UTC(year, month - 1, 1));

    // If lease starts this month but after the 1st, use lease start date instead
    const leaseStartStr = tenant.leaseStartDate
      ? String(tenant.leaseStartDate).split('T')[0]   // normalise DB value
      : null;
    const leaseStart = leaseStartStr ? new Date(leaseStartStr + 'T00:00:00Z') : null;
    const dueDate    = leaseStart && leaseStart > rawDue ? leaseStart : rawDue;

    // Skip if lease has already ended
    const leaseEndStr = tenant.leaseEndDate ? String(tenant.leaseEndDate).split('T')[0] : null;
    if (leaseEndStr && new Date(leaseEndStr + 'T00:00:00Z') < new Date()) continue;

    const dueDateStr = dueDate.toISOString().split('T')[0];

    try {
      // ── Build itemized line items from recurringCharges ───────────────
      // Fetch all active charges for this unit (unit-specific + property-wide).
      // Falls back gracefully if unitId or propertyId is missing.
      const unitId     = (tenant as any).unitId     ?? null;
      const propertyId = (tenant as any).propertyId ?? null;

      const additionalCharges = (unitId && propertyId)
        ? await storage.getRecurringChargesForUnit(unitId, propertyId)
        : [];

      const baseRent = parseFloat(String(tenant.monthlyRent));

      // Line items: rent first, then each recurring charge
      const lineItems: Array<{ description: string; amount: number; type: string }> = [
        { description: 'Monthly Rent', amount: baseRent, type: 'rent' },
        ...additionalCharges.map(c => ({
          description: c.name,
          amount:      parseFloat(String(c.amount)),
          type:        c.type,
        })),
      ];

      const totalAmount = lineItems.reduce((sum, li) => sum + li.amount, 0);

      await storage.createRentPayment({
        tenantId:  tenant.id,
        amount:    String(totalAmount),
        currency:  tenant.currency ?? 'KES',
        dueDate:   dueDateStr,
        status:    'pending',
        lineItems,
      } as any);
      created++;
      const chargesSummary = additionalCharges.length > 0
        ? ` + ${additionalCharges.length} charge(s) = KES ${totalAmount.toLocaleString('en-KE')}`
        : '';
      log(`Invoice created for tenant #${tenant.id} (${tenant.firstName} ${tenant.lastName}) — due ${dueDateStr}${chargesSummary}`);
    } catch (err) {
      log(`Failed to create invoice for tenant #${tenant.id}: ${err}`);
    }
  }

  log(`Monthly generation done — ${created} invoice(s) created for ${monthStr}`);
  return created;
}

// ── Job 2: Mark overdue ──────────────────────────────────────────────────────

export async function markOverdueInvoices(): Promise<number> {
  const today = todayStr();

  const result = await db
    .update(rentPayments)
    .set({ status: 'overdue', updatedAt: new Date() })
    .where(
      and(
        eq(rentPayments.status, 'pending'),
        sql`${rentPayments.dueDate} < ${today}::date`
      )
    )
    .returning({ id: rentPayments.id });

  if (result.length > 0) {
    log(`${result.length} invoice(s) marked overdue`);
  }
  return result.length;
}


// ── Job 3: Send overdue / partial payment email + WhatsApp reminders ────────
// Runs daily at 08:00 EAT. Sends email AND WhatsApp to every overdue tenant.
// WhatsApp is the primary channel for Kenyan tenants who don't check email.

export async function sendOverdueRentReminders(): Promise<number> {
  const today = todayStr();

  const overduePayments = await db
    .select({
      id:            rentPayments.id,
      tenantId:      rentPayments.tenantId,
      invoiceNumber: rentPayments.invoiceNumber,
      amount:        rentPayments.amount,
      currency:      rentPayments.currency,
      dueDate:       rentPayments.dueDate,
      status:        rentPayments.status,
      notes:         rentPayments.notes,
    })
    .from(rentPayments)
    .where(
      and(
        inArray(rentPayments.status, ['overdue', 'partial']),
        sql`${rentPayments.dueDate} < ${today}::date`
      )
    )
    .orderBy(rentPayments.tenantId, rentPayments.dueDate);

  if (overduePayments.length === 0) {
    log('No overdue invoices — skipping reminders');
    return 0;
  }

  // What each invoice has actually received comes from the receipts ledger. (This used to read a "partial:NNN" note that
  // nothing writes any more, so every reminder for a part-paid invoice claimed nothing had been paid.)
  const { rentBalances } = await import('./rent-ledger');
  const balances = await rentBalances(overduePayments.map(p => ({ id: p.id, amount: p.amount, status: p.status })));
  const paidOf = (p: { id: number }) => balances.get(p.id)?.paidAmount ?? 0;

  const byTenant = new Map<number, typeof overduePayments>();
  for (const p of overduePayments) {
    if (!byTenant.has(p.tenantId)) byTenant.set(p.tenantId, []);
    byTenant.get(p.tenantId)!.push(p);
  }

  const tenantIds = [...byTenant.keys()];
  const tenantRows = await db
    .select({
      id:           tenants.id,
      firstName:    tenants.firstName,
      lastName:     tenants.lastName,
      email:        tenants.email,
      currency:     tenants.currency,
      unitId:       tenants.unitId,
      unitNumber:   units.unitNumber,
      propertyName: properties.name,
      orgName:      organizations.name,
      orgId:        tenants.organizationId,
    })
    .from(tenants)
    .leftJoin(units,         eq(units.id, tenants.unitId))
    .leftJoin(properties,    eq(properties.id, units.propertyId))
    .leftJoin(organizations, eq(organizations.id, tenants.organizationId))
    .where(inArray(tenants.id, tenantIds));

  const tenantMap = new Map(tenantRows.map(t => [t.id, t]));
  let sent = 0;

  for (const [tenantId, invoices] of byTenant.entries()) {
    const info = tenantMap.get(tenantId);
    if (!info) continue;

    const sorted = [...invoices].sort(
      (a, b) => new Date(b.dueDate!).getTime() - new Date(a.dueDate!).getTime()
    );
    const current  = sorted[0];
    const historical = sorted.slice(1);

    const invoiceAmount = parseFloat(String(current.amount ?? 0));
    const paidAmount = paidOf(current);

    const currency = info.currency ?? current.currency ?? 'KES';
    const daysOverdue = dayDiff(String(current.dueDate), today);
    const totalOutstanding = invoices.reduce((sum, inv) => {
      const amt  = parseFloat(String(inv.amount ?? 0));
      return sum + Math.max(0, amt - paidOf(inv));
    }, 0);
    if (totalOutstanding <= 0.005) continue;   // everything on these invoices has since been paid

    // ── Who may be contacted, and is it time? ─────────────────────────────
    // This job used to message every overdue tenant every single morning for as long as they owed, ignored their
    // email/payment-reminder switches, and wrote nothing down. Now: active tenants only, their own opt-outs respected,
    // and a gap between reminders (every 3 days for the first two weeks, then weekly) measured against what was really sent —
    // including reminders a manager sent by hand.
    const contact = await loadContact(tenantId);
    if (!contact) continue;
    if (contact.status && contact.status !== 'active') { log(`Tenant #${tenantId} is ${contact.status} — no automatic reminder`); continue; }
    if (!contact.allowPayment) { log(`Tenant #${tenantId} switched payment reminders off — skipped`); continue; }
    const last = await lastReminderSent(tenantId, 'overdue');
    const gapDays = daysOverdue <= 14 ? 3 : 7;
    if (last && Date.now() - last.getTime() < (gapDays * 24 - 2) * 3600_000) continue;

    // ── Email ─────────────────────────────────────────────────────────────
    let emailed = false;
    if (info.email && contact.allowEmail && isEmailConfigured()) {
      try {
        await sendRentReminderEmail({
          to:              info.email,
          tenantFirstName: info.firstName,
          tenantLastName:  info.lastName,
          propertyName:    info.propertyName ?? 'your property',
          unitNumber:      info.unitNumber   ?? '—',
          orgName:         info.orgName      ?? 'Property Management',
          currency,
          invoiceNumber:   current.invoiceNumber ?? `PAY-${current.id}`,
          invoiceAmount,
          dueDate:         current.dueDate!,
          paidAmount,
          outstandingInvoices: historical.map(inv => {
            const ia = parseFloat(String(inv.amount ?? 0));
            const ip = paidOf(inv);
            return {
              invoiceNumber: inv.invoiceNumber ?? `PAY-${inv.id}`,
              amount: ia, paidAmount: ip, dueDate: inv.dueDate!,
              daysOverdue: dayDiff(String(inv.dueDate), today),
            };
          }),
        });
        emailed = true;
      } catch (err) { log(`Email failed for tenant #${tenantId}: ${err}`); }
    }

    // ── WhatsApp (primary channel) ─────────────────────────────────────────
    const whatsapped = await notifyTenant(tenantId, {
      type:          'rent_overdue',
      invoiceAmount: totalOutstanding,
      currency,
      dueDate:       current.dueDate!,
      daysOverdue,
      balance:       totalOutstanding,
    }, info.orgId ?? undefined).catch(err => { log(`WhatsApp failed for tenant #${tenantId}: ${err}`); return false; });

    if (!emailed && !whatsapped) { log(`Tenant #${tenantId} could not be reached (no usable channel) — not counted`); continue; }
    await logReminder(tenantId, 'overdue', emailed && whatsapped ? 'email+wa' : emailed ? 'email' : 'whatsapp',
      `Overdue: ${currency} ${totalOutstanding.toFixed(2)} across ${invoices.length} invoice(s), ${daysOverdue}d`,
      { invoiceIds: invoices.map(i => i.id), emailed, whatsapped });

    sent++;
    log(`Notified tenant #${tenantId} (${info.firstName}) — ${daysOverdue}d overdue, ${invoices.length} invoice(s)`);
  }

  log(`Overdue reminder job done — ${sent} tenant(s) notified`);
  return sent;
}

// ── Job 4: Pre-due WhatsApp warning (configurable days before rent is due) ────
// Runs daily at 09:00 EAT. WhatsApp-only — no email duplicate.
// Respects each tenant's rentDueWarningDays preference (default: 3 days).

export async function sendRentDueWarnings(): Promise<number> {
  // Fetch all pending invoices due within the next 1–14 days
  const maxDays = 14;
  const today = todayStr();                                   // Nairobi calendar date
  const maxDate = new Date(Date.parse(today + 'T00:00:00Z') + maxDays * 86400000).toISOString().split('T')[0];

  const upcoming = await db
    .select({
      id:       rentPayments.id,
      tenantId: rentPayments.tenantId,
      amount:   rentPayments.amount,
      currency: rentPayments.currency,
      dueDate:  rentPayments.dueDate,
    })
    .from(rentPayments)
    .where(
      and(
        eq(rentPayments.status, 'pending'),
        sql`${rentPayments.dueDate} > ${today}::date`,
        sql`${rentPayments.dueDate} <= ${maxDate}::date`
      )
    );

  if (upcoming.length === 0) {
    log('No upcoming rent due within 14 days');
    return 0;
  }

  // Each tenant's preferred warning lead time (default 3 days), in one query per table.
  const tenantIds = [...new Set(upcoming.map(p => p.tenantId))];
  const prefMap = new Map<number, number>();
  try {
    const rows = await db.select({ tenantId: tenants.id, userId: tenants.userId }).from(tenants).where(inArray(tenants.id, tenantIds));
    const userIds = rows.map(r => r.userId).filter(Boolean) as string[];
    const prefsByUser = new Map<string, number>();
    if (userIds.length > 0) {
      const prefsRows = await db
        .select({ userId: userNotificationPreferences.userId, days: userNotificationPreferences.rentDueWarningDays })
        .from(userNotificationPreferences)
        .where(inArray(userNotificationPreferences.userId, userIds));
      prefsRows.forEach(p => prefsByUser.set(p.userId, Number(p.days ?? 3)));
    }
    for (const row of rows) prefMap.set(row.tenantId, row.userId ? (prefsByUser.get(row.userId) ?? 3) : 3);
  } catch (err) {
    log(`Could not fetch warning day preferences — using default of 3: ${err}`);
  }

  log(`Checking pre-due warnings for ${upcoming.length} invoice(s)...`);
  let sent = 0;

  for (const inv of upcoming) {
    // Calendar-day difference in Nairobi time (the old millisecond maths shifted by a day depending on what time the job ran).
    const daysLeft = dayDiff(today, String(inv.dueDate));
    const warnDays = prefMap.get(inv.tenantId) ?? 3;

    // Only send if today is exactly the tenant's preferred warning day
    if (daysLeft !== warnDays) continue;

    const contact = await loadContact(inv.tenantId);
    if (!contact || (contact.status && contact.status !== 'active') || !contact.allowPayment) continue;

    // Once per invoice: a restart or a second run on the same day must not warn twice.
    const [already] = await db.select({ id: paymentReminders.id }).from(paymentReminders).where(and(
      eq(paymentReminders.tenantId, inv.tenantId), eq(paymentReminders.reminderType, 'pre_due'),
      eq(paymentReminders.status, 'sent'), sql`${paymentReminders.recipientInfo}->>'invoiceId' = ${String(inv.id)}`,
    )).limit(1);
    if (already) continue;

    const delivered = await notifyTenant(inv.tenantId, {
      type:          'rent_due_warning',
      invoiceAmount: parseFloat(String(inv.amount)),
      currency:      inv.currency ?? 'KES',
      dueDate:       String(inv.dueDate),
      daysUntilDue:  daysLeft,
    }).catch(err => { log(`Pre-due warning failed for tenant #${inv.tenantId}: ${err}`); return false; });
    if (!delivered) continue;
    await logReminder(inv.tenantId, 'pre_due', 'whatsapp', `Rent due in ${daysLeft} day(s)`, { invoiceId: inv.id });
    sent++;
  }

  log(`Pre-due warning job done — ${sent} notification(s) sent`);
  return sent;
}


// ── Startup ──────────────────────────────────────────────────────────────────

export function startRentScheduler(): void {
  log('Starting...');

  // Job 1 — invoice generation at 07:00 EAT
  scheduleDailyEAT(7, 0, async () => {
    log('Running monthly invoice generation...');
    await generateMonthlyRentInvoices();
  });

  // Job 2 — overdue sweep at 07:30 EAT
  scheduleDailyEAT(7, 30, async () => {
    log('Running overdue sweep...');
    await markOverdueInvoices();
  });

  // Job 3 — overdue email + WhatsApp reminders at 08:00 EAT
  // Runs AFTER the overdue sweep so statuses are up to date before notifying
  scheduleDailyEAT(8, 0, async () => {
    log('Running overdue rent reminders (email + WhatsApp)...');
    await sendOverdueRentReminders();
  });

  // Job 4 — pre-due WhatsApp warning at 09:00 EAT
  // Catches tenants whose rent falls due in 3 days — before it goes overdue
  scheduleDailyEAT(9, 0, async () => {
    log('Running pre-due rent warnings (WhatsApp)...');
    await sendRentDueWarnings();
  });

  // Queued reminders (scheduled from the arrears page, or "send later") — checked every 10 minutes.
  setInterval(() => { processDueReminders().catch(err => log(`Queued reminder run failed: ${err}`)); }, 10 * 60 * 1000).unref?.();

  // Scheduled broadcasts — nothing used to pick these up, so a broadcast saved for later simply never went out.
  setInterval(() => { dispatchDueBroadcasts().catch(err => log(`Scheduled broadcast run failed: ${err}`)); }, 60 * 1000).unref?.();

  // Also run generation + overdue sweep immediately on startup.
  // Deliberately skip the reminder job on startup — we don't want to
  // blast tenants with emails every time the server restarts.
  setImmediate(async () => {
    log('Running startup catch-up...');
    await generateMonthlyRentInvoices().catch(err => log(`Startup generation error: ${err}`));
    await markOverdueInvoices().catch(err => log(`Startup overdue error: ${err}`));
  });
}