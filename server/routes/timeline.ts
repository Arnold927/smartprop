/**
 * Activity timeline — mounted at /api/timeline
 *
 * GET /api/timeline/tenant/:id?limit=50
 * GET /api/timeline/unit/:id?limit=50
 *
 * One chronological feed per tenant or unit, newest first, pulling together what
 * is otherwise spread over several tabs: rent due/paid, invoices, maintenance,
 * leases, reminders, visitors, messages and record changes (audit log).
 * The tenant response also carries a small `summary` (balance, last payment,
 * open maintenance, lease end) used by the quick-view panel.
 *
 * Scoping mirrors the rest of the app:
 *   admin / manager / staff → anything in their organisation
 *   landlord                → only tenants/units in properties they own
 *   caretaker               → only tenants/units in their assigned property
 * Tenants, guards and contractors get 403.
 */
import { Router } from "express";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  tenants, units, properties, rentPayments, invoices, maintenanceRequests, leases,
  paymentReminders, visitors, messages, auditLogs, users,
} from "@shared/schema";
import { and, eq, inArray, or, desc } from "drizzle-orm";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

export type TimelineType =
  | "payment" | "rent_due" | "invoice" | "maintenance" | "lease"
  | "reminder" | "visitor" | "message" | "change";

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  at: string;               // ISO timestamp
  title: string;
  detail?: string;
  amount?: number;
  currency?: string;
  status?: string;
  who?: string;             // person involved (unit timelines show the tenant)
  href?: string;
}

const ALLOWED = ["admin", "manager", "staff", "landlord", "caretaker"];
const iso = (d: unknown): string | null => {
  if (!d) return null;
  const t = new Date(d as any);
  return isNaN(t.getTime()) ? null : t.toISOString();
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const name = (f?: string | null, l?: string | null) => `${f ?? ""} ${l ?? ""}`.trim();
const label = (s?: string | null) => String(s ?? "").replace(/_/g, " ");

/** Property ids the caller may see; null = whole organisation. */
async function propertyScope(req: any): Promise<number[] | null> {
  const role: string = req.user.role ?? "";
  const orgId: number = req.user.organizationId;
  const userId = String(req.user.id ?? req.user.userId ?? "");
  if (role === "landlord") {
    const owned = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.ownerId, userId), eq(properties.organizationId, orgId)));
    return owned.map(p => p.id);
  }
  if (role === "caretaker") {
    const c = await storage.getCaretakerByUserId(userId);
    return c?.propertyId ? [c.propertyId] : [];
  }
  return null;
}

type Collector = (events: TimelineEvent[]) => void;

/** Build the events for a set of tenant ids (and optional unit id for unit-only sources). */
async function collect(opts: {
  orgId: number;
  tenantIds: number[];
  unitId?: number;
  tenantNames: Map<number, string>;
  tenantUserIds: Map<number, string>;
  showWho: boolean;
}): Promise<TimelineEvent[]> {
  const { tenantIds, unitId, tenantNames, tenantUserIds, showWho } = opts;
  const events: TimelineEvent[] = [];
  const who = (tid?: number | null) => (showWho && tid ? tenantNames.get(tid) : undefined);
  const jobs: Promise<void>[] = [];
  const run = (key: string, fn: () => Promise<void>) =>
    jobs.push(fn().catch(err => logger.error(`timeline: ${key} failed`, { err: String(err) })));

  if (tenantIds.length) {
    run("rent", async () => {
      const rows = await db.select().from(rentPayments).where(inArray(rentPayments.tenantId, tenantIds))
        .orderBy(desc(rentPayments.dueDate)).limit(120);
      for (const r of rows) {
        const paid = iso(r.paidDate);
        const settled = r.status === "paid" || r.status === "completed";
        if (settled && paid) {
          events.push({
            id: `pay-${r.id}`, type: "payment", at: paid, title: "Rent payment received",
            detail: [r.paymentMethod ? label(r.paymentMethod).toUpperCase() : "", r.mpesaTransactionId || r.invoiceNumber || ""].filter(Boolean).join(" · "),
            amount: num(r.amount), currency: "KES", status: "paid", who: who(r.tenantId),
          });
        } else {
          const due = iso(r.dueDate);
          if (due) events.push({
            id: `due-${r.id}`, type: "rent_due", at: due,
            title: r.status === "overdue" ? "Rent overdue" : r.status === "partial" ? "Rent partly paid" : "Rent due",
            detail: r.invoiceNumber ?? undefined, amount: num(r.amount), currency: "KES", status: String(r.status), who: who(r.tenantId),
          });
        }
      }
    });

    run("invoices", async () => {
      const rows = await db.select().from(invoices).where(inArray(invoices.tenantId, tenantIds))
        .orderBy(desc(invoices.createdAt)).limit(60);
      for (const r of rows) {
        const at = iso(r.createdAt) ?? iso(r.dueDate);
        if (at) events.push({
          id: `inv-${r.id}`, type: "invoice", at, title: `Invoice ${r.invoiceNumber} issued`,
          detail: r.description ?? undefined, amount: num(r.totalAmount ?? r.amount), status: String(r.status ?? ""), who: who(r.tenantId),
          href: "/billing",
        });
      }
    });

    run("leases", async () => {
      const rows = await db.select().from(leases).where(inArray(leases.tenantId, tenantIds)).orderBy(desc(leases.startDate)).limit(20);
      for (const r of rows) {
        const start = iso(r.startDate);
        if (start) events.push({
          id: `ls-${r.id}`, type: "lease", at: start, title: `Lease ${r.leaseNumber} starts`,
          detail: `${r.leaseDurationMonths} months · ends ${String(r.endDate).slice(0, 10)}`,
          amount: num(r.monthlyRent), currency: r.currency ?? "KES", status: String(r.status ?? ""), who: who(r.tenantId), href: "/leases",
        });
      }
    });

    run("reminders", async () => {
      const rows = await db.select().from(paymentReminders).where(inArray(paymentReminders.tenantId, tenantIds))
        .orderBy(desc(paymentReminders.scheduledFor)).limit(30);
      for (const r of rows) {
        const at = iso(r.sentAt) ?? iso(r.scheduledFor);
        if (at) events.push({
          id: `rem-${r.id}`, type: "reminder", at,
          title: r.status === "sent" ? "Payment reminder sent" : `Payment reminder ${label(r.status)}`,
          detail: `via ${r.channel}`, status: String(r.status), who: who(r.tenantId),
        });
      }
    });

    run("visitors-tenant", async () => {
      const rows = await db.select().from(visitors).where(inArray(visitors.tenantId, tenantIds))
        .orderBy(desc(visitors.expectedArrival)).limit(30);
      for (const r of rows) {
        const at = iso(r.actualArrival) ?? iso(r.expectedArrival);
        if (at) events.push({
          id: `vis-${r.id}`, type: "visitor", at, title: `Visitor: ${r.visitorName}`,
          detail: r.purposeOfVisit ?? undefined, status: String(r.status ?? ""), who: who(r.tenantId), href: "/visitor-management",
        });
      }
    });

    run("audit", async () => {
      const rows = await db.select({
        id: auditLogs.id, action: auditLogs.action, entityId: auditLogs.entityId, at: auditLogs.timestamp,
        first: users.firstName, last: users.lastName,
      }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.userId))
        .where(and(inArray(auditLogs.entityType, ["tenant", "tenants"]), inArray(auditLogs.entityId, tenantIds.map(String))))
        .orderBy(desc(auditLogs.timestamp)).limit(30);
      for (const r of rows) {
        const at = iso(r.at);
        if (at) events.push({
          id: `aud-${r.id}`, type: "change", at,
          title: r.action === "CREATE" ? "Tenant record created" : r.action === "DELETE" ? "Tenant record removed" : "Tenant record updated",
          detail: name(r.first, r.last) ? `by ${name(r.first, r.last)}` : undefined, who: who(Number(r.entityId)),
        });
      }
    });

    run("messages", async () => {
      const uids = tenantIds.map(t => tenantUserIds.get(t)).filter(Boolean) as string[];
      if (!uids.length) return;
      const rows = await db.select().from(messages)
        .where(or(inArray(messages.toUserId, uids), inArray(messages.fromUserId, uids)))
        .orderBy(desc(messages.createdAt)).limit(30);
      const byUser = new Map<string, number>();
      tenantIds.forEach(t => { const u = tenantUserIds.get(t); if (u) byUser.set(u, t); });
      for (const r of rows) {
        const at = iso(r.createdAt);
        const fromTenant = byUser.has(String(r.fromUserId));
        const tid = byUser.get(String(fromTenant ? r.fromUserId : r.toUserId));
        if (at) events.push({
          id: `msg-${r.id}`, type: "message", at,
          title: fromTenant ? "Message from tenant" : "Message to tenant",
          detail: r.subject || String(r.content ?? "").slice(0, 90), who: who(tid), href: "/messages",
        });
      }
    });
  }

  // Maintenance: by tenant, plus anything raised against the unit (unit view)
  run("maintenance", async () => {
    const conds = [] as any[];
    if (tenantIds.length) conds.push(inArray(maintenanceRequests.tenantId, tenantIds));
    if (unitId) conds.push(eq(maintenanceRequests.unitId, unitId));
    if (!conds.length) return;
    const rows = await db.select().from(maintenanceRequests).where(or(...conds)).orderBy(desc(maintenanceRequests.createdAt)).limit(60);
    for (const r of rows) {
      const at = iso(r.createdAt);
      if (at) events.push({
        id: `mnt-${r.id}`, type: "maintenance", at, title: `Maintenance: ${r.title}`,
        detail: `${r.ticketNumber} · ${label(String(r.priority))} priority`, status: String(r.status ?? ""), who: who(r.tenantId),
        href: `/maintenance/${r.id}`,
      });
    }
  });

  if (unitId) {
    run("visitors-unit", async () => {
      const rows = await db.select().from(visitors).where(eq(visitors.unitId, unitId)).orderBy(desc(visitors.expectedArrival)).limit(30);
      for (const r of rows) {
        const at = iso(r.actualArrival) ?? iso(r.expectedArrival);
        if (at && !events.some(e => e.id === `vis-${r.id}`)) events.push({
          id: `vis-${r.id}`, type: "visitor", at, title: `Visitor: ${r.visitorName}`,
          detail: r.purposeOfVisit ?? undefined, status: String(r.status ?? ""), who: who(r.tenantId), href: "/visitor-management",
        });
      }
    });
  }

  await Promise.all(jobs);
  return events;
}

const sortAndCut = (events: TimelineEvent[], limit: number) =>
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);

const parseLimit = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? "50"), 10) || 50, 1), 200);

// ── Tenant ────────────────────────────────────────────────────────────────────
router.get("/tenant/:id", async (req: any, res) => {
  try {
    if (!ALLOWED.includes(req.user.role)) return res.status(403).json({ message: "Not allowed" });
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid tenant id" });

    const [t] = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.organizationId, orgId))).limit(1);
    if (!t) return res.status(404).json({ message: "Tenant not found" });

    const [unit] = t.unitId ? await db.select().from(units).where(eq(units.id, t.unitId)).limit(1) : [];
    const [prop] = unit ? await db.select().from(properties).where(eq(properties.id, unit.propertyId)).limit(1) : [];

    const scope = await propertyScope(req);
    if (scope && (!prop || !scope.includes(prop.id))) return res.status(403).json({ message: "Not allowed" });

    const events = await collect({
      orgId, tenantIds: [id], unitId: undefined,
      tenantNames: new Map([[id, name(t.firstName, t.lastName)]]),
      tenantUserIds: new Map([[id, String(t.userId)]]),
      showWho: false,
    });

    // Summary for the quick-view panel
    const payments = await db.select().from(rentPayments).where(eq(rentPayments.tenantId, id)).orderBy(desc(rentPayments.dueDate)).limit(200);
    const today = new Date().toISOString().slice(0, 10);
    const unpaid = payments.filter(p => !["paid", "completed", "cancelled"].includes(String(p.status)) && String(p.dueDate).slice(0, 10) <= today);
    const lastPaid = payments.filter(p => ["paid", "completed"].includes(String(p.status)) && p.paidDate)
      .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)))[0];
    const openMaintenance = events.filter(e => e.type === "maintenance" && !["completed", "cancelled"].includes(String(e.status))).length;

    res.json({
      summary: {
        tenantId: id,
        name: name(t.firstName, t.lastName),
        email: t.email, phone: t.phone ?? null, status: t.status,
        unitNumber: unit?.unitNumber ?? null, propertyName: prop?.name ?? null,
        monthlyRent: num(t.monthlyRent) ?? null, leaseEnd: t.leaseEndDate ?? null,
        balanceDue: unpaid.reduce((s, p) => s + (num(p.amount) ?? 0), 0),
        overdueCount: unpaid.length,
        lastPayment: lastPaid ? { amount: num(lastPaid.amount) ?? 0, date: String(lastPaid.paidDate).slice(0, 10) } : null,
        openMaintenance,
      },
      events: sortAndCut(events, parseLimit(req.query.limit)),
    });
  } catch (err) {
    logger.error("timeline tenant failed", { err: String(err) });
    res.status(500).json({ message: "Failed to load timeline" });
  }
});

// ── Unit ──────────────────────────────────────────────────────────────────────
router.get("/unit/:id", async (req: any, res) => {
  try {
    if (!ALLOWED.includes(req.user.role)) return res.status(403).json({ message: "Not allowed" });
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid unit id" });

    const [u] = await db.select().from(units).where(and(eq(units.id, id), eq(units.organizationId, orgId))).limit(1);
    if (!u) return res.status(404).json({ message: "Unit not found" });
    const scope = await propertyScope(req);
    if (scope && !scope.includes(u.propertyId)) return res.status(403).json({ message: "Not allowed" });

    // Everyone who has been attached to this unit (current tenants + anyone with a lease or request on it)
    const current = await db.select().from(tenants).where(and(eq(tenants.unitId, id), eq(tenants.organizationId, orgId)));
    const viaLease = await db.select({ tid: leases.tenantId }).from(leases).where(eq(leases.unitId, id));
    const ids = Array.from(new Set([...current.map(t => t.id), ...viaLease.map(l => l.tid)]));
    const people = ids.length ? await db.select().from(tenants).where(and(inArray(tenants.id, ids), eq(tenants.organizationId, orgId))) : [];

    const events = await collect({
      orgId, tenantIds: people.map(p => p.id), unitId: id,
      tenantNames: new Map(people.map(p => [p.id, name(p.firstName, p.lastName)])),
      tenantUserIds: new Map(people.map(p => [p.id, String(p.userId)])),
      showWho: true,
    });
    // Move-ins are worth a line of their own
    for (const t of people) {
      const at = iso(t.leaseStartDate);
      if (at && t.unitId === id) events.push({
        id: `mov-${t.id}`, type: "lease", at, title: `${name(t.firstName, t.lastName)} moved in`,
        detail: t.monthlyRent ? `Rent KES ${Math.round(Number(t.monthlyRent)).toLocaleString("en-KE")}` : undefined, who: name(t.firstName, t.lastName),
      });
    }

    res.json({
      summary: {
        unitId: id, unitNumber: u.unitNumber, occupied: !!u.isOccupied, monthlyRent: num(u.monthlyRent) ?? null,
        currentTenants: current.map(t => name(t.firstName, t.lastName)),
      },
      events: sortAndCut(events, parseLimit(req.query.limit)),
    });
  } catch (err) {
    logger.error("timeline unit failed", { err: String(err) });
    res.status(500).json({ message: "Failed to load timeline" });
  }
});

export default router;
