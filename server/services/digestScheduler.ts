/**
 * digestScheduler.ts
 *
 * In-app summary digest for admins and managers.
 *
 *   • Runs every day at 07:00 EAT (UTC+3).
 *   • A user receives it only if they switched "Summary digest" on
 *     (user_notification_preferences.weekly_digest) AND in-app notifications on.
 *   • Cadence follows their "frequency" setting: "daily" → every day,
 *     anything else → Mondays only.
 *   • Numbers are the organisation's: overdue rent, open and urgent
 *     maintenance, requests awaiting approval, leases ending within 30 days.
 *
 * It uses the same in-app notification store as everything else, so the
 * summary appears in the bell like any other notification.
 */

import { db } from "../db";
import { users, userNotificationPreferences } from "@shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { pushNotificationChecked } from "../routes/notifications";

const log = (msg: string) => console.log(`[DigestScheduler] ${msg}`);

function msUntilEAT(hh: number, mm: number): number {
  const now = new Date();
  const eat = new Date();
  eat.setUTCHours(hh - 3, mm, 0, 0);
  if (eat <= now) eat.setDate(eat.getDate() + 1);
  return eat.getTime() - now.getTime();
}

/** Day of week in Nairobi, 0 = Sunday. */
function nairobiWeekday(d = new Date()): number {
  return new Date(d.getTime() + 3 * 3600_000).getUTCDay();
}

export interface OrgDigestFigures {
  overdueCount: number; overdueAmount: number;
  openMaintenance: number; urgentMaintenance: number; awaitingApproval: number;
  leasesEnding30: number;
}

export async function orgDigestFigures(orgId: number): Promise<OrgDigestFigures> {
  const arrears: any = await db.execute(sql`
    SELECT count(*)::int AS c, coalesce(sum(rp.amount), 0)::float AS s
    FROM rent_payments rp JOIN tenants t ON t.id = rp.tenant_id
    WHERE t.organization_id = ${orgId} AND rp.status <> 'paid' AND rp.due_date < current_date`);
  const maint: any = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE m.status IN ('pending','assigned','in_progress','pending_approval'))::int AS open_count,
      count(*) FILTER (WHERE m.priority = 'urgent' AND m.status NOT IN ('completed','cancelled'))::int AS urgent_count,
      count(*) FILTER (WHERE m.status = 'pending_approval')::int AS approval_count
    FROM maintenance_requests m
    JOIN units u ON u.id = m.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE p.organization_id = ${orgId}`);
  const leases: any = await db.execute(sql`
    SELECT count(*)::int AS c FROM leases
    WHERE organization_id = ${orgId} AND status = 'active'
      AND end_date >= current_date AND end_date <= current_date + 30`);
  const rows = (r: any) => (r.rows ?? r)[0] ?? {};
  return {
    overdueCount: rows(arrears).c ?? 0,
    overdueAmount: rows(arrears).s ?? 0,
    openMaintenance: rows(maint).open_count ?? 0,
    urgentMaintenance: rows(maint).urgent_count ?? 0,
    awaitingApproval: rows(maint).approval_count ?? 0,
    leasesEnding30: rows(leases).c ?? 0,
  };
}

export function digestMessage(f: OrgDigestFigures): { title: string; message: string } {
  const parts: string[] = [];
  parts.push(f.overdueCount > 0
    ? `${f.overdueCount} overdue rent charge${f.overdueCount === 1 ? "" : "s"} (KES ${Math.round(f.overdueAmount).toLocaleString("en-KE")})`
    : "No overdue rent");
  parts.push(`${f.openMaintenance} open maintenance request${f.openMaintenance === 1 ? "" : "s"}${f.urgentMaintenance ? ` (${f.urgentMaintenance} urgent)` : ""}`);
  if (f.awaitingApproval) parts.push(`${f.awaitingApproval} awaiting approval`);
  if (f.leasesEnding30) parts.push(`${f.leasesEnding30} lease${f.leasesEnding30 === 1 ? "" : "s"} ending within 30 days`);
  return { title: "Your portfolio summary", message: parts.join(" · ") };
}

/** Sends the digest to every opted-in admin/manager whose cadence matches today. Returns how many were delivered. */
export async function runDigest(now = new Date()): Promise<number> {
  const isMonday = nairobiWeekday(now) === 1;
  const recipients = await db
    .select({
      id: users.id, orgId: users.organizationId,
      frequency: userNotificationPreferences.frequency,
    })
    .from(userNotificationPreferences)
    .innerJoin(users, eq(users.id, userNotificationPreferences.userId))
    .where(and(
      eq(userNotificationPreferences.weeklyDigest, true),
      eq(userNotificationPreferences.inAppNotifications, true),
      inArray(users.role, ["admin", "manager"]),
      isNotNull(users.organizationId),
    ));

  const due = recipients.filter(r => r.frequency === "daily" || isMonday);
  if (due.length === 0) return 0;

  const byOrg = new Map<number, OrgDigestFigures>();
  let sent = 0;
  for (const r of due) {
    const orgId = r.orgId as number;
    try {
      if (!byOrg.has(orgId)) byOrg.set(orgId, await orgDigestFigures(orgId));
      const { title, message } = digestMessage(byOrg.get(orgId)!);
      const ok = await pushNotificationChecked(String(r.id), {
        type: "system", title, message, ts: new Date().toISOString(), link: "/dashboard",
      });
      if (ok) sent++;
    } catch (e) { log(`Digest failed for user ${r.id}: ${e}`); }
  }
  log(`Delivered ${sent} digest(s)`);
  return sent;
}

export function startDigestScheduler(): void {
  async function runAndReschedule() {
    try { await runDigest(); } catch (e) { log(`Job error: ${e}`); }
    setTimeout(runAndReschedule, msUntilEAT(7, 0));
  }
  setTimeout(runAndReschedule, msUntilEAT(7, 0));
  log("Scheduled daily at 07:00 EAT");
}
