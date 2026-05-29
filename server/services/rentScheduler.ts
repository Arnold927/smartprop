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
import { tenants, rentPayments, units, properties, organizations, userNotificationPreferences } from '@shared/schema';
import { eq, and, sql, ne, inArray } from 'drizzle-orm';
import { storage } from '../storage';
import { sendRentReminderEmail } from '../lib/email';
import { notifyTenant } from './notifyTenant';

const log = (msg: string) => console.log(`[RentScheduler] ${msg}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
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
    const paidAmount = current.status === 'partial'
      ? (() => { const m = (current.notes ?? '').match(/partial:([\d.]+)/); return m ? parseFloat(m[1]) : 0; })()
      : 0;

    const currency = info.currency ?? current.currency ?? 'KES';
    const daysOverdue = Math.floor(
      (Date.now() - new Date(current.dueDate!).getTime()) / 86400000
    );
    const totalOutstanding = invoices.reduce((sum, inv) => {
      const amt  = parseFloat(String(inv.amount ?? 0));
      const paid = inv.status === 'partial'
        ? (() => { const m = (inv.notes ?? '').match(/partial:([\d.]+)/); return m ? parseFloat(m[1]) : 0; })()
        : 0;
      return sum + (amt - paid);
    }, 0);

    // ── Email ─────────────────────────────────────────────────────────────
    if (info.email) {
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
            const ip = inv.status === 'partial'
              ? (() => { const m = (inv.notes ?? '').match(/partial:([\d.]+)/); return m ? parseFloat(m[1]) : 0; })()
              : 0;
            return {
              invoiceNumber: inv.invoiceNumber ?? `PAY-${inv.id}`,
              amount: ia, paidAmount: ip, dueDate: inv.dueDate!,
              daysOverdue: Math.floor((Date.now() - new Date(inv.dueDate!).getTime()) / 86400000),
            };
          }),
        });
      } catch (err) { log(`Email failed for tenant #${tenantId}: ${err}`); }
    }

    // ── WhatsApp (primary channel) ─────────────────────────────────────────
    await notifyTenant(tenantId, {
      type:          'rent_overdue',
      invoiceAmount: totalOutstanding,
      currency,
      dueDate:       current.dueDate!,
      daysOverdue,
      balance:       totalOutstanding,
    }, info.orgId ?? undefined).catch(err => log(`WhatsApp failed for tenant #${tenantId}: ${err}`));

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
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + maxDays);
  const todayStr   = today.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

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
        sql`${rentPayments.dueDate} > ${todayStr}::date`,
        sql`${rentPayments.dueDate} <= ${maxDateStr}::date`
      )
    );

  if (upcoming.length === 0) {
    log('No upcoming rent due within 14 days');
    return 0;
  }

  // Fetch notification preferences for all involved tenants in one query
  // by joining tenants → users → userNotificationPreferences
  const tenantIds = [...new Set(upcoming.map(p => p.tenantId))];

  // Build a map of tenantId → preferred warning days
  const prefMap = new Map<number, number>();
  try {
    const rows = await db
      .select({
        tenantId:          tenants.id,
        userId:            tenants.userId,
      })
      .from(tenants)
      .where(sql`${tenants.id} = ANY(${sql.raw(`ARRAY[${tenantIds.join(',')}]`)})`)
    ;

    const userIds = rows.map(r => r.userId).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const prefsRows = await db
        .select({
          userId:             userNotificationPreferences.userId,
          rentDueWarningDays: (userNotificationPreferences as any).rentDueWarningDays,
        })
        .from(userNotificationPreferences)
        .where(sql`${userNotificationPreferences.userId} = ANY(${sql.raw(`ARRAY['${userIds.join("','")}']::uuid[]`)})`);

      const prefsByUser = new Map(prefsRows.map(p => [p.userId, Number(p.rentDueWarningDays ?? 3)]));
      for (const row of rows) {
        const days = row.userId ? (prefsByUser.get(row.userId) ?? 3) : 3;
        prefMap.set(row.tenantId, days);
      }
    }
  } catch (err) {
    log(`Could not fetch warning day preferences — using default of 3: ${err}`);
  }

  log(`Checking pre-due warnings for ${upcoming.length} invoice(s)...`);
  let sent = 0;

  for (const inv of upcoming) {
    const dueDate  = new Date(String(inv.dueDate));
    const msLeft   = dueDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    const warnDays = prefMap.get(inv.tenantId) ?? 3;

    // Only send if today is exactly the tenant's preferred warning day
    if (daysLeft !== warnDays) continue;

    await notifyTenant(inv.tenantId, {
      type:          'rent_due_warning',
      invoiceAmount: parseFloat(String(inv.amount)),
      currency:      inv.currency ?? 'KES',
      dueDate:       String(inv.dueDate),
      daysUntilDue:  daysLeft,
    }).catch(err => log(`Pre-due warning failed for tenant #${inv.tenantId}: ${err}`));
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

  // Also run generation + overdue sweep immediately on startup.
  // Deliberately skip the reminder job on startup — we don't want to
  // blast tenants with emails every time the server restarts.
  setImmediate(async () => {
    log('Running startup catch-up...');
    await generateMonthlyRentInvoices().catch(err => log(`Startup generation error: ${err}`));
    await markOverdueInvoices().catch(err => log(`Startup overdue error: ${err}`));
  });
}