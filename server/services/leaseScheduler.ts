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
import { eq, and, lte, gte, or } from "drizzle-orm";
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

async function sendExpiryNotices(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Notice thresholds and the flag column that tracks whether it was sent
  const thresholds = [
    { days: 90, flag: "renewalNotice90Sent" as const },
    { days: 60, flag: "renewalNotice60Sent" as const },
    { days: 30, flag: "renewalNotice30Sent" as const },
  ];

  for (const { days, flag } of thresholds) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);
    const targetStr  = targetDate.toISOString().split("T")[0];

    // Find active leases expiring exactly `days` days from today where
    // the notice hasn't been sent yet
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
          eq(leases.endDate,         targetStr as any),
        )
      );

    if (expiring.length === 0) continue;
    log(`Sending ${days}-day expiry notices for ${expiring.length} lease(s)...`);

    for (const row of expiring) {
      const { lease } = row;
      try {
        if (row.email) {
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
          });
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
          description:    `${days}-day expiry notice sent (email + WhatsApp).`,
          performedBy:    null,
          metadata:       { days, email: row.email, sentAt: new Date().toISOString() },
        });

        log(`  ✓ ${days}d notice → ${row.email} + WhatsApp (lease ${lease.leaseNumber})`);
      } catch (err) {
        log(`  ✗ Failed for lease ${lease.leaseNumber}: ${err}`);
      }
    }
  }
}

// ── Job 2: Auto-expire past leases ────────────────────────────────────────────

async function autoExpireLeases(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // Active leases whose end date was yesterday or earlier
  const expired = await db
    .select({ id: leases.id, tenantId: leases.tenantId, organizationId: leases.organizationId, leaseNumber: leases.leaseNumber })
    .from(leases)
    .where(
      and(
        eq(leases.status, "active"),
        lte(leases.endDate, yesterdayStr as any),
      )
    );

  if (expired.length === 0) return;
  log(`Auto-expiring ${expired.length} past-due lease(s)...`);

  for (const lease of expired) {
    await db
      .update(leases)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(leases.id, lease.id));

    await db.insert(leaseEvents).values({
      leaseId:        lease.id,
      tenantId:       lease.tenantId,
      organizationId: lease.organizationId,
      eventType:      "expired",
      description:    `Lease ${lease.leaseNumber} automatically marked as expired (end date passed).`,
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
