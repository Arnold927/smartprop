/**
 * Broadcast engine — resolves who a broadcast is for, delivers it on each chosen channel, and records the outcome.
 * Shared by POST /api/broadcast-messages (send now) and the scheduler (send later).
 *
 * What changed from the in-route version:
 *  - tenants come from the tenants table, so tenants who have no portal login yet still get SMS / WhatsApp / email
 *    (before, "All tenants" only reached tenants with a user account);
 *  - inactive users and platform admins are never recipients;
 *  - a channel that is not configured (no email key, no SMS provider, no WhatsApp credentials) is reported as such,
 *    instead of being counted as a failure for every recipient — or worse, as sent;
 *  - recipients who switched a channel off in their preferences are skipped on that channel;
 *  - message text is escaped before it goes into email HTML;
 *  - delivery runs 10 recipients at a time, and a broadcast that reached nobody ends as "failed", not "sent".
 */
import { db } from "../db";
import {
  broadcastMessages, broadcastRecipients, organizationSettings, users, tenants,
  userNotificationPreferences,
} from "@shared/schema";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { emitToUser } from "../ws";
import { getMessagingService, escapeHtml } from "./messaging";
import { whatsappService } from "../whatsapp";
import { toE164 } from "../lib/phone";

export const MAX_RECIPIENTS = 2000;

export interface Recipient {
  key: string;                 // broadcast_recipients.recipient_user_id: the user id, or "tenant:<id>" when there is no login
  userId: string | null;
  email: string | null; phone: string | null;
  firstName: string | null; lastName: string | null; role: string;
}

type Filter = Record<string, any> | null | undefined;

export async function resolveRecipients(audienceType: string, orgId: number, filter?: Filter): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  const add = (r: Recipient) => { if (!out.has(r.key)) out.set(r.key, r); };

  const staffUsers = async (roles?: string[]) => {
    const rows = await db.select({
      id: users.id, email: users.email, phone: users.phoneNumber, firstName: users.firstName, lastName: users.lastName, role: users.role,
    }).from(users).where(and(
      eq(users.organizationId, orgId), sql`${users.isActive} is not false`, sql`${users.role} <> 'platform_admin'`, sql`${users.role} <> 'tenant'`,
    ));
    for (const u of rows) {
      if (roles && !roles.includes(u.role ?? "")) continue;
      add({ key: u.id, userId: u.id, email: u.email, phone: u.phone, firstName: u.firstName, lastName: u.lastName, role: u.role ?? "staff" });
    }
  };

  const tenantRows = async (opts: { propertyIds?: number[]; tenantIds?: number[] } = {}) => {
    const conds: any[] = [eq(tenants.organizationId, orgId), eq(tenants.status, "active")];
    if (opts.tenantIds) conds.push(inArray(tenants.id, opts.tenantIds));
    if (opts.propertyIds) {
      // property ids are checked against the organisation — a crafted list cannot reach another organisation's tenants
      conds.push(sql`${tenants.unitId} in (select u.id from units u join properties p on p.id = u.property_id where p.organization_id = ${orgId} and p.id in (${sql.join(opts.propertyIds.map(i => sql`${i}`), sql`, `)}))`);
    }
    const rows = await db.select({
      id: tenants.id, userId: tenants.userId, email: tenants.email, phone: tenants.phone,
      firstName: tenants.firstName, lastName: tenants.lastName,
    }).from(tenants).where(and(...conds));
    for (const t of rows) {
      add({ key: t.userId ?? `tenant:${t.id}`, userId: t.userId ?? null, email: t.email, phone: t.phone, firstName: t.firstName, lastName: t.lastName, role: "tenant" });
    }
  };

  const ints = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isInteger(n) && n > 0) : []);

  switch (audienceType) {
    case "all_tenants": await tenantRows(); break;
    case "all_landlords": await staffUsers(["landlord"]); break;
    case "all_users": await staffUsers(); await tenantRows(); break;
    case "specific_roles": {
      const roles: string[] = Array.isArray(filter?.roles) ? filter!.roles : [];
      if (roles.includes("tenant")) await tenantRows();
      const staffRoles = roles.filter(r => r !== "tenant");
      if (staffRoles.length) await staffUsers(staffRoles);
      break;
    }
    case "specific_properties": {
      const ids = ints(filter?.propertyIds);
      if (ids.length) await tenantRows({ propertyIds: ids });
      break;
    }
    case "custom_filter": {
      const roles: string[] = Array.isArray(filter?.roles) ? filter!.roles : [];
      const tenantIds = ints(filter?.tenantIds);
      if (tenantIds.length) await tenantRows({ tenantIds });           // hand-picked rows from the Tenants page
      else if (roles.includes("tenant")) await tenantRows();
      const staffRoles = roles.filter(r => r !== "tenant");
      if (staffRoles.length) await staffUsers(staffRoles);
      break;
    }
  }
  return [...out.values()];
}

export interface DispatchTotals { sentCount: number; failedCount: number; skippedCount: number; notConfigured: string[] }

export async function dispatchBroadcast(
  broadcastId: number,
  broadcast: { title: string; content: string; broadcastMedium: string[] },
  recipients: Recipient[],
  orgId: number,
): Promise<DispatchTotals> {
  const messaging = getMessagingService();
  const channels = broadcast.broadcastMedium;

  const [orgSettings] = await db.select({ w: organizationSettings.whatsappSettings }).from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId)).limit(1);
  const waSettings = (orgSettings?.w as { phoneNumberId?: string; apiKey?: string } | undefined) ?? undefined;

  // Is each channel able to send at all? Checked once, not per recipient.
  const ready: Record<string, boolean> = {
    app_notification: true,
    email: messaging.isEmailConfigured(),
    sms: messaging.isSmsConfigured(),
    whatsapp: whatsappService.isConfiguredForOrg(waSettings),
  };
  const notConfigured = channels.filter(c => ready[c] === false);

  // Channel opt-outs the recipient set themselves
  const userIds = recipients.map(r => r.userId).filter(Boolean) as string[];
  const optOut = new Map<string, { email: boolean; whatsapp: boolean }>();
  if (userIds.length) {
    const prefs = await db.select({
      userId: userNotificationPreferences.userId, email: userNotificationPreferences.emailNotifications, wa: userNotificationPreferences.whatsappNotifications,
    }).from(userNotificationPreferences).where(inArray(userNotificationPreferences.userId, userIds));
    prefs.forEach(p => optOut.set(p.userId, { email: p.email === false, whatsapp: p.wa === false }));
  }

  const totals: DispatchTotals = { sentCount: 0, failedCount: 0, skippedCount: 0, notConfigured };
  const subject = broadcast.title;
  const html = `<h3>${escapeHtml(broadcast.title)}</h3><p>${escapeHtml(broadcast.content).replace(/\n/g, "<br>")}</p>`;

  const sendOne = async (r: Recipient) => {
    const status: Record<string, string> = {};
    let anySent = false, anyFailed = false;
    const phone = toE164(r.phone);
    for (const channel of channels) {
      try {
        if (!ready[channel]) { status[channel] = "skipped_not_configured"; continue; }
        if (channel === "app_notification") {
          if (!r.userId) { status[channel] = "skipped_no_account"; continue; }
          emitToUser(r.userId, "broadcast", { id: broadcastId, title: broadcast.title, message: broadcast.content });
          status[channel] = "sent"; anySent = true;
        } else if (channel === "email") {
          if (!r.email) status[channel] = "skipped_no_email";
          else if (r.userId && optOut.get(r.userId)?.email) status[channel] = "skipped_opted_out";
          else {
            const ok = await messaging.sendEmail({ to: r.email, from: "", subject, text: broadcast.content, html });
            status[channel] = ok ? "sent" : "failed"; ok ? (anySent = true) : (anyFailed = true);
          }
        } else if (channel === "sms") {
          if (!phone) status[channel] = "skipped_no_phone";
          else {
            const ok = await messaging.sendSMS({ to: phone, body: `${broadcast.title}: ${broadcast.content}` });
            status[channel] = ok ? "sent" : "failed"; ok ? (anySent = true) : (anyFailed = true);
          }
        } else if (channel === "whatsapp") {
          if (!phone) status[channel] = "skipped_no_phone";
          else if (r.userId && optOut.get(r.userId)?.whatsapp) status[channel] = "skipped_opted_out";
          else {
            const ok = await whatsappService.sendMessage({ to: phone, type: "text", content: `*${broadcast.title}*\n\n${broadcast.content}` }, orgId, waSettings);
            status[channel] = ok ? "sent" : "failed"; ok ? (anySent = true) : (anyFailed = true);
          }
        }
      } catch (err) {
        console.error(`[broadcast] channel=${channel} recipient=${r.key}:`, err);
        status[channel] = "failed"; anyFailed = true;
      }
    }
    const allSkipped = Object.values(status).every(s => s.startsWith("skipped_"));
    const overall = anySent ? "sent" : allSkipped ? "skipped" : "failed";
    const skippedWhy = Object.entries(status).filter(([, s]) => s.startsWith("skipped_")).map(([ch, s]) => `${ch}: ${s.replace("skipped_", "").replace(/_/g, " ")}`);
    try {
      await db.insert(broadcastRecipients).values({
        broadcastId, recipientUserId: r.key, recipientType: (r.role ?? "staff") as any,
        email: r.email ?? null, phoneNumber: r.phone ?? null, medium: channels as any,
        deliveryStatus: { ...status, overall },
        sentAt: anySent ? new Date() : null,
        failureReason: anySent ? null : allSkipped ? `Not delivered — ${skippedWhy.join("; ")}` : anyFailed ? "All attempted channels failed" : null,
      });
    } catch { /* stats are best-effort */ }
    if (anySent) totals.sentCount++; else if (allSkipped) totals.skippedCount++; else totals.failedCount++;
  };

  for (let i = 0; i < recipients.length; i += 10) {
    await Promise.all(recipients.slice(i, i + 10).map(sendOne));
  }
  return totals;
}

/** Runs a broadcast that has already been claimed (status "sending") and writes the final status and counts. */
export async function runBroadcast(b: typeof broadcastMessages.$inferSelect) {
  const recipients = await resolveRecipients(b.audienceType, b.organizationId, b.audienceFilter as Filter);
  let totals: DispatchTotals;
  try {
    totals = await dispatchBroadcast(b.id, { title: b.title, content: b.content, broadcastMedium: b.broadcastMedium }, recipients, b.organizationId);
  } catch (err) {
    console.error(`[broadcast] #${b.id} crashed:`, err);
    await db.update(broadcastMessages).set({ status: "failed", updatedAt: new Date() }).where(eq(broadcastMessages.id, b.id));
    throw err;
  }
  const status = totals.sentCount > 0 ? "sent" : "failed";
  const [updated] = await db.update(broadcastMessages).set({
    status: status as any, totalRecipients: recipients.length, sentCount: totals.sentCount, failedCount: totals.failedCount, sentAt: new Date(), updatedAt: new Date(),
  }).where(eq(broadcastMessages.id, b.id)).returning();
  return { broadcast: updated, ...totals };
}

/** Sends every scheduled broadcast whose time has come. Claiming is atomic, so two instances never send the same one. */
export async function dispatchDueBroadcasts(): Promise<number> {
  const due = await db.update(broadcastMessages).set({ status: "sending" as any, updatedAt: new Date() })
    .where(and(eq(broadcastMessages.status, "scheduled" as any), lte(broadcastMessages.scheduledFor, new Date()))).returning();
  for (const b of due) {
    try { await runBroadcast(b); } catch { /* status already set to failed */ }
  }
  if (due.length) console.log(`[Broadcast] Sent ${due.length} scheduled broadcast(s)`);
  return due.length;
}
