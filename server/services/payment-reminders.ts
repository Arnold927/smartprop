/**
 * Payment reminders — the one place that actually delivers a reminder and records what happened.
 *
 * Before this existed, "Send Reminder" on the arrears page only inserted a row (status "pending") that nothing ever read,
 * so tenants were never contacted while the screen said "Reminder sent". Every path (manual, bulk, scheduled, automatic)
 * now goes through `dispatchReminder`, which ends in one of:
 *   sent    – the provider accepted it
 *   failed  – we tried and the provider/transport errored
 *   skipped – deliberately not sent (tenant opted out, no contact detail, channel not configured, tenant not active)
 * and stores the reason in recipient_info so the manager can see why and pick up the phone instead.
 */
import { db } from "../db";
import {
  paymentReminders, tenants, userNotificationPreferences, organizations, organizationSettings, arrears,
} from "@shared/schema";
import { and, eq, lte, sql, inArray, ne } from "drizzle-orm";
import { whatsappService } from "../whatsapp";
import { getMessagingService, escapeHtml } from "./messaging";
import { toE164 } from "../lib/phone";

const log = (m: string) => console.log(`[PaymentReminders] ${m}`);

export type ReminderType = "pre_due" | "overdue" | "final_notice";
export type RequestedChannel = "auto" | "email" | "sms" | "whatsapp" | "app";
export type Outcome = { status: "sent" | "failed" | "skipped"; channel: string; reason?: string };

export interface Contact {
  tenantId: number; orgId: number; status: string | null;
  firstName: string; lastName: string; email: string | null; phone: string | null;
  allowPayment: boolean; allowWhatsapp: boolean; allowEmail: boolean;
}

export async function loadContact(tenantId: number): Promise<Contact | null> {
  const [row] = await db
    .select({
      id: tenants.id, orgId: tenants.organizationId, status: tenants.status,
      firstName: tenants.firstName, lastName: tenants.lastName, email: tenants.email, phone: tenants.phone, userId: tenants.userId,
    })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) return null;
  let prefs: { whatsapp: boolean | null; email: boolean | null; payment: boolean | null } | undefined;
  if (row.userId) {
    const [p] = await db
      .select({
        whatsapp: userNotificationPreferences.whatsappNotifications,
        email: userNotificationPreferences.emailNotifications,
        payment: userNotificationPreferences.paymentReminders,
      })
      .from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, row.userId)).limit(1);
    prefs = p;
  }
  return {
    tenantId: row.id, orgId: row.orgId as number, status: row.status,
    firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone,
    allowPayment: prefs ? prefs.payment !== false : true,
    allowWhatsapp: prefs ? prefs.whatsapp !== false : true,
    allowEmail: prefs ? prefs.email !== false : true,
  };
}

/** WhatsApp is only "ready" when real credentials exist — without them the service logs and reports success, which must not count as sent. */
export async function whatsappReady(orgId: number): Promise<{ ready: boolean; settings?: { phoneNumberId?: string; apiKey?: string } }> {
  const [s] = await db.select({ w: organizationSettings.whatsappSettings }).from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId)).limit(1);
  const settings = (s?.w as { phoneNumberId?: string; apiKey?: string } | undefined) ?? undefined;
  return { ready: whatsappService.isConfiguredForOrg(settings), settings };
}

const money = (n: number, c = "KES") => `${c} ${n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function composeReminderMessage(o: {
  name: string; orgName?: string | null; type: ReminderType; amount: number; currency?: string | null;
  daysOverdue?: number; dueDate?: string | null;
}): string {
  const cur = o.currency || "KES";
  const sign = o.orgName ? `\n— ${o.orgName}` : "";
  if (o.type === "pre_due") {
    return `Hi ${o.name}, a friendly reminder that ${money(o.amount, cur)} is due${o.dueDate ? ` on ${o.dueDate}` : " soon"}.${sign}`;
  }
  if (o.type === "final_notice") {
    return `FINAL NOTICE — Dear ${o.name}, ${money(o.amount, cur)} is ${o.daysOverdue ?? 0} days overdue. Please pay immediately or contact us to agree a plan, to avoid further action. If you have already paid, send us your payment reference.${sign}`;
  }
  return `Hi ${o.name}, your rent of ${money(o.amount, cur)} is ${o.daysOverdue ?? 0} day${o.daysOverdue === 1 ? "" : "s"} overdue. Please pay as soon as you can. If you have already paid, send us your payment reference.${sign}`;
}

/** Pick one delivery channel. "auto" prefers WhatsApp (how most Kenyan tenants are reached), then email, then SMS. */
async function pickChannel(c: Contact, requested: RequestedChannel): Promise<{ channel: string; skip?: string; waSettings?: any }> {
  const messaging = getMessagingService();
  const wa = await whatsappReady(c.orgId);
  const options: Record<string, () => string | null> = {
    whatsapp: () => !toE164(c.phone) ? "Tenant has no valid phone number" : !c.allowWhatsapp ? "Tenant switched WhatsApp notifications off" : !wa.ready ? "WhatsApp is not configured for this organisation" : null,
    email: () => !c.email ? "Tenant has no email address" : !c.allowEmail ? "Tenant switched email notifications off" : !messaging.isEmailConfigured() ? "Email is not configured" : null,
    sms: () => !toE164(c.phone) ? "Tenant has no valid phone number" : !messaging.isSmsConfigured() ? "SMS is not configured" : null,
    app: () => null,
  };
  if (requested !== "auto") {
    const why = options[requested]();
    return why ? { channel: requested, skip: why } : { channel: requested, waSettings: wa.settings };
  }
  const reasons: string[] = [];
  for (const ch of ["whatsapp", "email", "sms"]) {
    const why = options[ch]();
    if (!why) return { channel: ch, waSettings: wa.settings };
    reasons.push(`${ch}: ${why}`);
  }
  return { channel: "auto", skip: `No channel could reach the tenant (${reasons.join("; ")})` };
}

async function deliver(c: Contact, channel: string, message: string, subject: string, waSettings?: any): Promise<{ ok: boolean; reason?: string }> {
  const messaging = getMessagingService();
  try {
    if (channel === "whatsapp") {
      const ok = await whatsappService.sendMessage({ to: c.phone!, type: "text", content: message }, c.orgId, waSettings);
      return ok ? { ok: true } : { ok: false, reason: "WhatsApp provider rejected the message" };
    }
    if (channel === "email") {
      const ok = await messaging.sendEmail({
        to: c.email!, from: "", subject, text: message,
        html: `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
      });
      return ok ? { ok: true } : { ok: false, reason: "Email provider rejected the message" };
    }
    if (channel === "sms") {
      const ok = await messaging.sendSMS({ to: c.phone!, body: message });
      return ok ? { ok: true } : { ok: false, reason: "SMS provider rejected the message" };
    }
    if (channel === "app") return { ok: true };   // shown on the tenant's reminders list
    return { ok: false, reason: `Unknown channel ${channel}` };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  }
}

type ReminderRow = typeof paymentReminders.$inferSelect;

/**
 * Deliver one reminder row and record the outcome. `claim` makes sure two workers (or a double click on a pending row)
 * cannot both send it: the row moves pending → sending atomically, and only the winner sends.
 */
export async function dispatchReminder(
  row: ReminderRow,
  opts: { requested?: RequestedChannel; automatic?: boolean } = {},
): Promise<Outcome> {
  const claimed = await db.update(paymentReminders).set({ status: "sending" })
    .where(and(eq(paymentReminders.id, row.id), eq(paymentReminders.status, "pending"))).returning({ id: paymentReminders.id });
  if (claimed.length === 0) return { status: "skipped", channel: row.channel, reason: "Already handled" };

  const finish = async (o: Outcome, extra: Record<string, unknown> = {}) => {
    await db.update(paymentReminders).set({
      status: o.status, channel: o.channel.slice(0, 10), sentAt: o.status === "sent" ? new Date() : null,
      recipientInfo: { ...(row.recipientInfo as object ?? {}), ...extra, ...(o.reason ? { reason: o.reason } : {}) },
    }).where(eq(paymentReminders.id, row.id));
    return o;
  };

  const c = await loadContact(row.tenantId);
  if (!c) return finish({ status: "failed", channel: row.channel, reason: "Tenant not found" });
  if (opts.automatic && c.status && c.status !== "active") {
    return finish({ status: "skipped", channel: row.channel, reason: `Tenant is ${c.status} — automatic reminders only go to active tenants` });
  }
  if (!c.allowPayment) {
    return finish({ status: "skipped", channel: row.channel, reason: "Tenant switched payment reminders off — contact them directly" });
  }

  const requested = (opts.requested ?? (row.channel as RequestedChannel)) || "auto";
  const pick = await pickChannel(c, requested);
  if (pick.skip) return finish({ status: "skipped", channel: pick.channel, reason: pick.skip });

  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.orgId)).limit(1);
  const subject = row.reminderType === "final_notice" ? `Final notice — rent overdue${org?.name ? ` — ${org.name}` : ""}` : `Rent payment reminder${org?.name ? ` — ${org.name}` : ""}`;
  const res = await deliver(c, pick.channel, row.message, subject, pick.waSettings);
  return finish(res.ok ? { status: "sent", channel: pick.channel } : { status: "failed", channel: pick.channel, reason: res.reason },
    { to: pick.channel === "email" ? c.email : c.phone });
}

/** Sends every pending reminder whose time has come. Safe to run concurrently and repeatedly. */
export async function processDueReminders(orgId?: number): Promise<{ sent: number; failed: number; skipped: number }> {
  const due = await db.select().from(paymentReminders)
    .where(and(
      eq(paymentReminders.status, "pending"),
      lte(paymentReminders.scheduledFor, new Date()),
      orgId ? sql`${paymentReminders.tenantId} in (select id from tenants where organization_id = ${orgId})` : sql`true`,
    ))
    .orderBy(paymentReminders.scheduledFor).limit(200);
  const tally = { sent: 0, failed: 0, skipped: 0 };
  for (const row of due) {
    try { tally[(await dispatchReminder(row, { automatic: true })).status]++; }
    catch (err) { log(`Reminder #${row.id} crashed: ${err}`); tally.failed++; }
  }
  if (due.length) log(`Processed ${due.length} due reminder(s): ${tally.sent} sent, ${tally.failed} failed, ${tally.skipped} skipped`);
  return tally;
}

/**
 * Queue a reminder for every active arrear that has not been reminded in the last 7 days, then send what is due.
 * Returns what was queued plus how each one ended, so the screen can say "5 sent, 2 skipped" instead of "5 scheduled".
 */
export async function scheduleAutomaticReminders(orgId: number) {
  const active = await db.select().from(arrears)
    .where(and(eq(arrears.organizationId, orgId), eq(arrears.status, "active"))).limit(2000);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const created: ReminderRow[] = [];
  for (const a of active) {
    const recent = await db.select({ id: paymentReminders.id }).from(paymentReminders)
      .where(and(
        eq(paymentReminders.arrearsId, a.id),
        ne(paymentReminders.status, "cancelled"),
        sql`${paymentReminders.createdAt} >= NOW() - INTERVAL '7 days'`,
      )).limit(1);
    if (recent.length) continue;
    const c = await loadContact(a.tenantId);
    const type: ReminderType = a.daysOverdue > 30 ? "final_notice" : "overdue";
    const message = composeReminderMessage({
      name: c?.firstName ?? "there", orgName: org?.name, type,
      amount: parseFloat(String(a.outstandingAmount)), currency: a.currency, daysOverdue: a.daysOverdue,
    });
    const [row] = await db.insert(paymentReminders).values({
      tenantId: a.tenantId, arrearsId: a.id, reminderType: type, channel: "auto", message,
      scheduledFor: new Date(), recipientInfo: { source: "auto" },
    }).returning();
    created.push(row);
  }
  const tally = await processDueReminders(orgId);
  return { created, ...tally };
}
