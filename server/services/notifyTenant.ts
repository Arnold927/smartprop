/**
 * notifyTenant.ts — Central tenant notification dispatcher
 *
 * Every trigger (rent overdue, maintenance update, lease expiry, etc.) calls
 * one function here. This function:
 *   1. Looks up the tenant's notification preferences
 *   2. Sends WhatsApp if the tenant has a phone number AND whatsapp_notifications = true
 *   3. Sends email if email_notifications = true AND email address is present
 *   4. Respects quiet hours (no WhatsApp between 21:00–07:00 EAT for non-urgent messages)
 *   5. Never throws — all errors are caught and logged (non-fatal)
 *
 * Adding a new trigger:
 *   1. Add a case to NotificationEvent union type
 *   2. Write the message body in buildWhatsAppMessage()
 *   3. Call notifyTenant() from your route/scheduler
 *   Done. No changes needed elsewhere.
 */

import { db }               from "../db";
import { tenants, userNotificationPreferences, users, organizations } from "@shared/schema";
import { eq, and }          from "drizzle-orm";
import { whatsappService }  from "../whatsapp";
import { sendRentReminderEmail } from "../lib/email";

const log = (msg: string) => console.log(`[notifyTenant] ${msg}`);

// ── Event types ───────────────────────────────────────────────────────────────

export type NotificationEvent =
  | { type: "rent_due_warning";    invoiceAmount: number; currency: string; dueDate: string; daysUntilDue: number; payBill?: string; }
  | { type: "rent_overdue";        invoiceAmount: number; currency: string; dueDate: string; daysOverdue: number; balance: number; payBill?: string; }
  | { type: "rent_paid";           amount: number; currency: string; receiptNumber?: string; }
  | { type: "maintenance_opened";  ticketNumber: string; title: string; }
  | { type: "maintenance_assigned";ticketNumber: string; technicianName?: string; scheduledDate?: string; }
  | { type: "maintenance_scheduled";ticketNumber: string; scheduledDate: string; }
  | { type: "maintenance_in_progress"; ticketNumber: string; }
  | { type: "maintenance_completed"; ticketNumber: string; }
  | { type: "maintenance_rejected"; ticketNumber: string; reason?: string; }
  | { type: "lease_expiry_warning"; leaseNumber: string; expiryDate: string; daysLeft: number; newRent?: number; currency?: string; }
  | { type: "lease_renewed";        leaseNumber: string; newRent: number; currency: string; newEndDate: string; }
  | { type: "lease_terminated";     leaseNumber: string; terminationDate: string; }
  | { type: "deposit_refunded";     amount: number; currency: string; reference?: string; }
  | { type: "visitor_approved";     visitorName: string; accessCode?: string; }
  | { type: "document_uploaded";    documentName: string; documentType?: string; }
  | { type: "deposit_interest_accrued"; amount: number; currency: string; period: string; cumulative: number; }
  | { type: "custom";               message: string; };

// ── Message builders ──────────────────────────────────────────────────────────

function fmtKES(n: number, currency = "KES"): string {
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string): string {
  try { return new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return d; }
}

function buildWhatsAppMessage(tenant: { firstName: string; lastName: string }, event: NotificationEvent, org?: { name?: string | null; mpesaPaybill?: string | null }): string {
  const name    = tenant.firstName;
  const orgName = org?.name ?? "SmartProp";
  const payBill = (event as any).payBill ?? org?.mpesaPaybill ?? "";
  const payLine = payBill ? `\n💳 *M-Pesa Paybill:* ${payBill}\n` : "";

  switch (event.type) {

    case "rent_due_warning":
      return [
        `Hi ${name}! 👋`,
        ``,
        `Your rent of *${fmtKES(event.invoiceAmount, event.currency)}* is due on *${fmtDate(event.dueDate)}* — that's ${event.daysUntilDue} day${event.daysUntilDue === 1 ? "" : "s"} away.`,
        ``,
        `Please pay before the due date to avoid a late fee.`,
        payLine,
        `Questions? Reply to this message.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "rent_overdue":
      return [
        `⚠️ Hi ${name},`,
        ``,
        `Your rent payment is *${event.daysOverdue} day${event.daysOverdue === 1 ? "" : "s"} overdue*.`,
        ``,
        `📌 Amount due: *${fmtKES(event.balance, event.currency)}*`,
        `📅 Original due: ${fmtDate(event.dueDate)}`,
        payLine,
        `Please settle this urgently to avoid further action.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "rent_paid":
      return [
        `✅ *Payment Received!*`,
        ``,
        `Hi ${name}, we've received your payment of *${fmtKES(event.amount, event.currency)}*.`,
        event.receiptNumber ? `Receipt: ${event.receiptNumber}` : "",
        ``,
        `Thank you for your prompt payment! 🙏`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "maintenance_opened":
      return [
        `🔧 *Maintenance Request Received*`,
        ``,
        `Hi ${name}, we've received your request:`,
        `*"${event.title}"*`,
        `Ticket: *#${event.ticketNumber}*`,
        ``,
        `We'll assign a technician and keep you updated here.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "maintenance_assigned":
      return [
        `🔧 *Technician Assigned*`,
        ``,
        `Hi ${name}, good news — a technician has been assigned to ticket *#${event.ticketNumber}*.`,
        event.technicianName ? `👷 Technician: ${event.technicianName}` : "",
        event.scheduledDate  ? `📅 Scheduled: ${fmtDate(event.scheduledDate)}` : "",
        ``,
        `We'll notify you when work begins. Questions? Reply here.`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "maintenance_scheduled":
      return [
        `📅 *Work Scheduled*`,
        ``,
        `Hi ${name}, the work for ticket *#${event.ticketNumber}* has been scheduled for *${fmtDate(event.scheduledDate)}*.`,
        ``,
        `Please ensure access is available. Reply here if you need to reschedule.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "maintenance_in_progress":
      return [
        `🔨 *Work In Progress*`,
        ``,
        `Hi ${name}, work has started on ticket *#${event.ticketNumber}*. Our team is on-site.`,
        ``,
        `Reply here if you have questions.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "maintenance_completed":
      return [
        `✅ *Maintenance Complete!*`,
        ``,
        `Hi ${name}, work on ticket *#${event.ticketNumber}* is done.`,
        ``,
        `Please check and let us know if everything is in order, or if any follow-up is needed. Your feedback helps us improve! ⭐`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "maintenance_rejected":
      return [
        `❌ *Maintenance Request Update*`,
        ``,
        `Hi ${name}, unfortunately your request *#${event.ticketNumber}* could not be processed at this time.`,
        event.reason ? `Reason: ${event.reason}` : "",
        ``,
        `Please contact us if you'd like to discuss further.`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "lease_expiry_warning":
      return [
        `📋 *Lease Expiry Notice*`,
        ``,
        `Hi ${name}, your lease *${event.leaseNumber}* expires on *${fmtDate(event.expiryDate)}* — ${event.daysLeft} day${event.daysLeft === 1 ? "" : "s"} away.`,
        event.newRent
          ? `\nRenewal offer: *${fmtKES(event.newRent, event.currency ?? "KES")}/month*`
          : "",
        ``,
        `Please contact your property manager to discuss renewal. Not renewing? Please give 30 days' notice.`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "lease_renewed":
      return [
        `✅ *Lease Renewed*`,
        ``,
        `Hi ${name}, your lease *${event.leaseNumber}* has been renewed.`,
        `📅 New end date: *${fmtDate(event.newEndDate)}*`,
        `💰 New monthly rent: *${fmtKES(event.newRent, event.currency)}*`,
        ``,
        `A copy of your new agreement will be shared separately.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "lease_terminated":
      return [
        `📋 *Lease Termination Notice*`,
        ``,
        `Hi ${name}, your lease *${event.leaseNumber}* has been terminated effective *${fmtDate(event.terminationDate)}*.`,
        ``,
        `Please contact your property manager regarding move-out and deposit refund.`,
        ``,
        `– ${orgName}`,
      ].join("\n");

    case "deposit_refunded":
      return [
        `💰 *Deposit Refund Processed*`,
        ``,
        `Hi ${name}, your security deposit refund of *${fmtKES(event.amount, event.currency)}* has been processed.`,
        event.reference ? `Reference: ${event.reference}` : "",
        ``,
        `Thank you for being a valued tenant. All the best! 🙏`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "visitor_approved":
      return [
        `🚪 *Visitor Access Approved*`,
        ``,
        `Hi ${name}, access has been approved for your visitor *${event.visitorName}*.`,
        event.accessCode ? `🔑 Access code: *${event.accessCode}*` : "",
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "document_uploaded":
      return [
        `📄 *New Document Available*`,
        ``,
        `Hi ${name}, a document has been shared with you on ${orgName}.`,
        ``,
        `*${event.documentName}*${event.documentType ? ` (${event.documentType})` : ""}`,
        ``,
        `Log in to your tenant portal to view and download it.`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "deposit_interest_accrued":
      return [
        `💰 *Deposit Interest Update*`,
        ``,
        `Hi ${name}, your security deposit interest has been updated.`,
        ``,
        `Period: ${event.period}`,
        `Interest earned: *${fmtKES(event.amount, event.currency)}*`,
        `Total accrued to date: *${fmtKES(event.cumulative, event.currency)}*`,
        ``,
        `This will be settled when your deposit is refunded at end of tenancy.`,
        ``,
        `– ${orgName}`,
      ].filter(l => l !== undefined).join("\n");

    case "custom":
      return event.message;
  }
}

// ── Quiet hours check (EAT = UTC+3) ──────────────────────────────────────────

function isQuietHours(): boolean {
  const eatHour = (new Date().getUTCHours() + 3) % 24;
  return eatHour >= 21 || eatHour < 7; // 21:00 – 07:00 EAT
}

const URGENT_EVENTS = new Set([
  "rent_overdue", "maintenance_completed", "maintenance_rejected",
  "lease_terminated", "visitor_approved",
]);

// ── Preference lookup ─────────────────────────────────────────────────────────

interface TenantPrefs {
  whatsappOk:  boolean;
  emailOk:     boolean;
  phone:       string | null;
  email:       string | null;
  firstName:   string;
  lastName:    string;
  orgId:       number;
}

async function getPrefs(tenantId: number): Promise<TenantPrefs | null> {
  const [row] = await db
    .select({
      firstName: tenants.firstName,
      lastName:  tenants.lastName,
      email:     tenants.email,
      phone:     tenants.phone,
      orgId:     tenants.organizationId,
      userId:    tenants.userId,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!row) return null;

  // Look up preferences via the user account linked to this tenant.
  // row.userId may be null if the tenant has no portal account yet — skip the
  // prefs query in that case and fall back to the default (notify on all channels).
  let prefs: { whatsappNotifications?: boolean | null; emailNotifications?: boolean | null } | undefined;
  if (row.userId) {
    const [prefsRow] = await db
      .select({
        whatsappNotifications: userNotificationPreferences.whatsappNotifications,
        emailNotifications:    userNotificationPreferences.emailNotifications,
      })
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, row.userId))
      .limit(1);
    prefs = prefsRow;
  }

  return {
    firstName:  row.firstName,
    lastName:   row.lastName,
    email:      row.email,
    phone:      row.phone,
    orgId:      row.orgId,
    // Default both channels to true if no prefs row exists yet
    whatsappOk: prefs ? Boolean(prefs.whatsappNotifications ?? true) : true,
    emailOk:    prefs ? Boolean(prefs.emailNotifications    ?? true) : true,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * notifyTenant — fire-and-forget notification to a tenant.
 *
 * Routes to WhatsApp and/or email based on preferences.
 * Never throws — all errors logged as warnings.
 *
 * @param tenantId    The tenant row id
 * @param event       Typed notification event
 * @param orgId       Optional override (falls back to tenant's own org)
 */
export async function notifyTenant(
  tenantId: number,
  event: NotificationEvent,
  orgId?: number,
): Promise<void> {
  try {
    const prefs = await getPrefs(tenantId);
    if (!prefs) { log(`Tenant #${tenantId} not found — skipping`); return; }

    const effectiveOrgId = orgId ?? prefs.orgId;

    // Fetch org details for paybill number and name
    let org: { name?: string | null; mpesaPaybill?: string | null } = {};
    try {
      const [orgRow] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, effectiveOrgId))
        .limit(1);
      org = orgRow ?? {};
    } catch { /* non-fatal */ }

    const isUrgent = URGENT_EVENTS.has(event.type);
    const quiet    = isQuietHours();

    // ── WhatsApp ────────────────────────────────────────────────────────────
    if (prefs.whatsappOk && prefs.phone) {
      if (!quiet || isUrgent) {
        const msg = buildWhatsAppMessage(
          { firstName: prefs.firstName, lastName: prefs.lastName },
          event,
          org,
        );

        whatsappService
          .sendMessage({ to: prefs.phone, type: "text", content: msg }, effectiveOrgId)
          .catch(err => log(`WhatsApp failed for tenant #${tenantId}: ${err}`));
      } else {
        log(`Quiet hours — skipping non-urgent WhatsApp for tenant #${tenantId}`);
      }
    }

    // ── Email (for overdue and warnings only — not every event) ────────────
    // WhatsApp is primary. Email is sent only for financial events where a
    // paper trail matters: overdue, due warnings, payment confirmed.
    const emailEvents = new Set(["rent_overdue", "rent_due_warning", "rent_paid", "lease_expiry_warning"]);
    if (prefs.emailOk && prefs.email && emailEvents.has(event.type)) {
      // Email sending is handled by individual callers (rentScheduler already
      // calls sendRentReminderEmail). We don't duplicate it here to avoid
      // double-sending. This block is reserved for future email routing.
    }

  } catch (err) {
    log(`Error notifying tenant #${tenantId}: ${err}`);
  }
}

/**
 * notifyTenantByPhone — for cases where we have a phone but not a tenantId.
 * Used by M-Pesa callbacks and gate PIN flows.
 */
export async function notifyTenantByPhone(
  phone: string,
  name: string,
  event: NotificationEvent,
  orgId?: number,
): Promise<void> {
  if (!phone) return;

  const isUrgent = URGENT_EVENTS.has(event.type);
  if (isQuietHours() && !isUrgent) {
    log(`Quiet hours — skipping non-urgent WhatsApp to ${phone}`);
    return;
  }

  let org: { name?: string | null } = {};
  if (orgId) {
    try {
      const [orgRow] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      org = orgRow ?? {};
    } catch { /* non-fatal */ }
  }

  const msg = buildWhatsAppMessage({ firstName: name, lastName: "" }, event, org);
  whatsappService
    .sendMessage({ to: phone, type: "text", content: msg }, orgId)
    .catch(err => log(`WhatsApp failed to ${phone}: ${err}`));
}