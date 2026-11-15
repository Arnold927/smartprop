/**
 * leaseScheduler.ts
 *
 * Daily scheduled jobs for lease lifecycle management.
 * Runs at 07:45 EAT every day alongside the rent scheduler.
 *
 * Jobs:
 *   1. Expiry notices     — sends emails at 90, 60, 30 days before lease end
 *   2. Auto-expire        — marks leases as 'expired' the day after end date
 *   3. Renewal reminders  — WhatsApp nudge to managers for leases expiring in 14 days
 *
 * Integration: import startLeaseScheduler() and call from server/index.ts
 */

import { db }               from "../db";
import { leases, leaseEvents, tenants, organizations } from "@shared/schema";
import { eq, and, lte, gte, or, sql } from "drizzle-orm";
import { todayEAT } from "./rent-ledger";
import { addDays, dueScheduledTerminations, endTenancy } from "./lease-lifecycle";
import { sendLeaseEmail }   from "../lib/leaseEmail";
import { whatsappService }  from "../whatsapp";
import { notifyTenant }     from "./notifyTenant";
import { runCertExpiryAlerts } from "./certExpiryAlerts";

const log = (msg: string) => console.log(`[LeaseScheduler] ${msg}`);

// ── Copy the EAT scheduler helper from rentScheduler ─────────────────────────
function msUntilEAT(hh: number, mm: number): number {
  const now = new Date();
  const eat = new Date();
  eat.setUTCHours(hh - 3, mm, 0, 0); // EAT = UTC+3
  if (eat <= now) eat.setDate(eat.getDate() + 1);
  return eat.getTime() - now.getTime();
}

function scheduleDailyEAT(hh: number, mm: number, job: () => Promise<void>): void {
  async function runAndReschedule() {
    try { await job(); } catch (e) { log(`Job error: ${e}`); }
    setTimeout(runAndReschedule, msUntilEAT(hh, mm));
  }
  setTimeout(runAndReschedule, msUntilEAT(hh, mm));
}

// ── Job 1: Expiry notices (90 / 60 / 30 days) ────────────────────────────────

export async function sendExpiryNotices(): Promise<void> {
  const today = todayEAT();

  // Notice thresholds and the flag column that tracks whether it was sent. A notice goes out as soon as the lease is
  // INSIDE its window (≤ N days left, > the next window) — an exact-day match lost the notice for good whenever the
  // server was down or the lease was created/renewed on the day. The windows do not overlap, so a tenant is
  // never sent a "90 days" notice with 20 days left.
  const thresholds = [
    { days: 90, flag: "renewalNotice90Sent" as const, from: 60 },
    { days: 60, flag: "renewalNotice60Sent" as const, from: 30 },
    { days: 30, flag: "renewalNotice30Sent" as const, from: -1 },
  ];

  for (const { days, flag, from } of thresholds) {
    const latest = addDays(today, days);          // ends on or before this → inside the window
    const earliest = addDays(today, from);        // ends after this → not yet in the next window

    const expiring = await db
      .select({
        lease:        leases,
        firstName:    tenants.firstName,
        lastName:     tenants.lastName,
        email:        tenants.email,
        orgName:      organizations.name,
      })
      .from(leases)
      .leftJoin(tenants,       eq(leases.tenantId,       tenants.id))
      .leftJoin(organizations, eq(leases.organizationId, organizations.id))
      .where(
        and(
          eq(leases.status,          "active"),
          eq(leases[flag],           false),
          lte(leases.endDate,        latest as any),
          gte(leases.endDate,        today as any),
          // a lease already inside a later window gets that window's notice, not this one
          from >= 0 ? gte(leases.endDate, addDays(earliest, 1) as any) : gte(leases.endDate, today as any),
          // nothing to chase when a renewal is already in progress
          sql`not exists (select 1 from leases r where r.previous_lease_id = ${leases.id} and r.status in ('draft','pending_signature','active'))`,
        )
      );

    if (expiring.length === 0) continue;
    log(`Sending ${days}-day expiry notices for ${expiring.length} lease(s)...`);

    for (const row of expiring) {
      const { lease } = row;
      try {
        let emailError: string | null = null;
        if (row.email) {
          // an e-mail outage must not stop the WhatsApp notice or leave the flag unset (that re-sent the WhatsApp daily)
          await sendLeaseEmail({
            type:           "expiry_notice",
            to:             row.email,
            tenantName:     `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
            orgName:        row.orgName ?? "Property Management",
            leaseNumber:    lease.leaseNumber,
            startDate:      String(lease.startDate),
            endDate:        String(lease.endDate),
            monthlyRent:    Number(lease.monthlyRent),
            currency:       lease.currency,
            leaseId:        lease.id,
            daysUntilExpiry: days,
          }).catch((e: any) => { emailError = String(e?.message ?? e); log(`  e-mail notice failed for ${lease.leaseNumber}: ${emailError}`); });
        }

        // WhatsApp expiry warning — primary channel for Kenyan tenants
        await notifyTenant(lease.tenantId, {
          type:        "lease_expiry_warning",
          leaseNumber: lease.leaseNumber,
          expiryDate:  String(lease.endDate),
          daysLeft:    days,
        }, lease.organizationId).catch(err => log(`  WhatsApp expiry notice failed: ${err}`));

        // Mark the flag so we don't resend tomorrow
        await db
          .update(leases)
          .set({ [flag]: true, updatedAt: new Date() })
          .where(eq(leases.id, lease.id));

        // Audit trail
        await db.insert(leaseEvents).values({
          leaseId:        lease.id,
          tenantId:       lease.tenantId,
          organizationId: lease.organizationId,
          eventType:      "notice_sent",
          description:    `${days}-day expiry notice sent${emailError ? " (WhatsApp; the e-mail failed)" : " (email + WhatsApp)"}.`,
          performedBy:    null,
          metadata:       { days, email: row.email, emailError, sentAt: new Date().toISOString() },
        });

        log(`  ✓ ${days}d notice → ${row.email} + WhatsApp (lease ${lease.leaseNumber})`);
      } catch (err) {
        log(`  ✗ Failed for lease ${lease.leaseNumber}: ${err}`);
      }
    }
  }
}

// ── Job 2: Auto-expire past leases ────────────────────────────────────────────

export async function autoExpireLeases(): Promise<void> {
  const today = todayEAT();

  // 0. terminations the manager scheduled for a date that has now arrived end the tenancy properly (tenant, unit, login)
  for (const d of await dueScheduledTerminations(today)) {
    try {
      await endTenancy(d.id, { date: String(d.endDate), reason: "Scheduled termination date reached", userId: null, scheduled: true });
      log(`  ✓ Terminated (scheduled): ${d.n}`);
    } catch (e) { log(`  ✗ Scheduled termination of ${d.n} failed: ${e}`); }
  }

  // 1. active leases whose end date has passed are expired (the tenant stays: they are holding over until the
  //    manager renews or terminates). A lease that already has a renewal in progress says so in its audit trail.
  const expired = await db
    .select({ id: leases.id, tenantId: leases.tenantId, organizationId: leases.organizationId, leaseNumber: leases.leaseNumber })
    .from(leases)
    .where(and(eq(leases.status, "active"), lte(leases.endDate, addDays(today, -1) as any)));

  if (expired.length === 0) return;
  log(`Auto-expiring ${expired.length} past-due lease(s)...`);

  for (const lease of expired) {
    const res = await db.update(leases).set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(leases.id, lease.id), eq(leases.status, "active"))).returning({ id: leases.id });
    if (!res.length) continue;
    await db.insert(leaseEvents).values({
      leaseId:        lease.id,
      tenantId:       lease.tenantId,
      organizationId: lease.organizationId,
      eventType:      "expired",
      description:    `Lease ${lease.leaseNumber} automatically marked as expired (end date passed). The tenant is holding over until the lease is renewed or terminated.`,
      performedBy:    null,
      metadata:       { expiredAt: new Date().toISOString() },
    });
    log(`  ✓ Expired: ${lease.leaseNumber}`);
  }
}

// ── Job 3: 14-day WhatsApp nudge to managers ─────────────────────────────────

async function nudgeManagersFor14DayExpiry(): Promise<void> {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  const targetStr = target.toISOString().split("T")[0];

  const expiring = await db
    .select({
      lease:     leases,
      firstName: tenants.firstName,
      lastName:  tenants.lastName,
      orgName:   organizations.name,
    })
    .from(leases)
    .leftJoin(tenants,       eq(leases.tenantId,       tenants.id))
    .leftJoin(organizations, eq(leases.organizationId, organizations.id))
    .where(
      and(
        eq(leases.status,  "active"),
        eq(leases.endDate, targetStr as any),
      )
    );

  if (expiring.length === 0) return;

  // Group by org so we send one message per org listing all expiring leases
  const byOrg = new Map<number, typeof expiring>();
  for (const row of expiring) {
    const orgId = row.lease.organizationId;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(row);
  }

  for (const [orgId, rows] of byOrg) {
    const orgName = rows[0].orgName ?? "Your organisation";
    const lines   = rows.map(r =>
      `• ${r.firstName} ${r.lastName} — ${r.lease.leaseNumber} (ends ${targetStr})`
    ).join("\n");

    const msg = [
      `⚠️ *Lease Expiry Alert — ${orgName}*`,
      `The following ${rows.length > 1 ? "leases expire" : "lease expires"} in 14 days:`,
      "",
      lines,
      "",
      `Please log in to SmartProp to initiate renewals before the leases lapse.`,
    ].join("\n");

    // Send to the organisation's WhatsApp if configured
    if (whatsappService.isConfigured) {
      whatsappService
        .sendMessage({ to: `org:${orgId}`, type: "text", content: msg }, orgId)
        .catch(e => log(`WhatsApp nudge failed for org ${orgId}: ${e}`));
    }

    log(`  14d WhatsApp nudge sent for org ${orgId} (${rows.length} leases)`);
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export function startLeaseScheduler(): void {
  log("Starting — expiry notices + auto-expire at 07:45 EAT daily.");

  // Run immediately on startup to catch anything missed during downtime
  setImmediate(async () => {
    await autoExpireLeases().catch(e => log(`Startup auto-expire error: ${e}`));
    await sendExpiryNotices().catch(e => log(`Startup expiry notices error: ${e}`));
  });

  // Daily at 07:45 EAT
  scheduleDailyEAT(7, 45, async () => {
    await autoExpireLeases();
    await sendExpiryNotices();
    await nudgeManagersFor14DayExpiry();
    // Regulatory certificate expiry alerts (NEMA / NCA / County)
    await runCertExpiryAlerts().catch(e => log(`Cert expiry alert error: ${e}`));
  });
}
