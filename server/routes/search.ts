/**
 * Global search — mounted at /api/search
 *
 * GET /api/search?q=text&limit=5
 *
 * One request returns grouped, role-scoped matches across the whole
 * organisation (not just the first page of each list):
 *   properties, units, tenants, invoices (rent payments), maintenance,
 *   contractors, expenses, utility bills, leases, team users.
 *
 * Scoping rules (same as the individual list endpoints):
 *   admin / manager  → everything in the organisation
 *   staff            → no expenses, leases or team users
 *   landlord         → only properties they own (+ tenants, invoices,
 *                      maintenance, expenses and leases under them)
 *   caretaker        → only their assigned property, maintenance + units
 * Other roles (tenant, guard, contractor) get an empty result.
 *
 * LIKE wildcards in the query are escaped so "50%" or "_" match literally.
 */
import { Router } from "express";
import { db } from "../db";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  properties, units, tenants, rentPayments, maintenanceRequests, contractors,
  propertyExpenses, utilityBills, utilityAccounts, leases, users,
} from "@shared/schema";
import { and, eq, or, ilike, inArray, desc, sql } from "drizzle-orm";

const router = Router();

export type SearchHit = {
  id: number | string;
  title: string;
  subtitle?: string;
  badge?: string;
  href: string;
};
export type SearchGroups = Record<string, SearchHit[]>;

const money = (v: unknown, cur?: string | null) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${cur || "KES"} ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
};
const fullName = (f?: string | null, l?: string | null) => `${f ?? ""} ${l ?? ""}`.trim();
const day = (d: unknown) => {
  if (!d) return "";
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
};

router.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role ?? "";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");
    const raw = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "5"), 10) || 5, 1), 10);

    const empty: SearchGroups = {};
    if (raw.length < 2) return res.json({ query: raw, groups: empty, total: 0 });

    const FULL = ["admin", "manager"];
    const BACKOFFICE = ["admin", "manager", "staff"];
    const WITH_LANDLORD = ["admin", "manager", "staff", "landlord"];
    if (![...WITH_LANDLORD, "caretaker"].includes(role)) {
      return res.json({ query: raw, groups: empty, total: 0 });
    }

    const like = `%${raw.replace(/[\\%_]/g, (m: string) => "\\" + m)}%`;

    // ── Property scope: null = whole org, otherwise an explicit id list ───────
    let scope: number[] | null = null;
    if (role === "landlord") {
      const owned = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.ownerId, userId), eq(properties.organizationId, orgId)));
      scope = owned.map(p => p.id);
    } else if (role === "caretaker") {
      const c = await storage.getCaretakerByUserId(userId);
      scope = c?.propertyId ? [c.propertyId] : [];
    }
    if (scope && scope.length === 0) return res.json({ query: raw, groups: empty, total: 0 });

    const propScope = (col: any) => (scope ? inArray(col, scope) : undefined);
    const groups: SearchGroups = {};
    const jobs: Promise<void>[] = [];
    const run = (key: string, fn: () => Promise<SearchHit[]>) => {
      jobs.push(
        fn().then(h => { if (h.length) groups[key] = h; })
          .catch(err => logger.error(`global search: ${key} failed`, { err: String(err) })),
      );
    };

    // Properties
    run("properties", async () => {
      const rows = await db.select({
        id: properties.id, name: properties.name, address: properties.address, type: properties.propertyType,
      }).from(properties)
        .where(and(
          eq(properties.organizationId, orgId), propScope(properties.id),
          or(ilike(properties.name, like), ilike(properties.address, like)),
        )).orderBy(properties.name).limit(limit);
      return rows.map(r => ({
        id: r.id, title: r.name, subtitle: r.address, badge: String(r.type ?? "").replace(/_/g, " "),
        href: `/properties/${r.id}`,
      }));
    });

    // Units
    run("units", async () => {
      const rows = await db.select({
        id: units.id, unitNumber: units.unitNumber, unitType: units.unitType,
        propertyId: units.propertyId, propertyName: properties.name,
      }).from(units)
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(
          eq(properties.organizationId, orgId), propScope(properties.id),
          ilike(units.unitNumber, like),
        )).orderBy(units.unitNumber).limit(limit);
      return rows.map(r => ({
        id: r.id, title: `Unit ${r.unitNumber}`, subtitle: r.propertyName,
        badge: String(r.unitType ?? "").replace(/_/g, " "), href: `/properties/${r.propertyId}`,
      }));
    });

    // Tenants
    if (WITH_LANDLORD.includes(role)) {
      run("tenants", async () => {
        const rows = await db.select({
          id: tenants.id, firstName: tenants.firstName, lastName: tenants.lastName,
          email: tenants.email, phone: tenants.phone, status: tenants.status,
          unitNumber: units.unitNumber, propertyName: properties.name,
        }).from(tenants)
          .leftJoin(units, eq(tenants.unitId, units.id))
          .leftJoin(properties, eq(units.propertyId, properties.id))
          .where(and(
            eq(tenants.organizationId, orgId), propScope(properties.id),
            or(
              ilike(tenants.firstName, like), ilike(tenants.lastName, like),
              ilike(sql`${tenants.firstName} || ' ' || ${tenants.lastName}`, like),
              ilike(tenants.email, like), ilike(tenants.phone, like),
            ),
          )).orderBy(tenants.firstName, tenants.id).limit(limit);
        return rows.map(r => ({
          id: r.id, title: fullName(r.firstName, r.lastName),
          subtitle: [r.unitNumber ? `Unit ${r.unitNumber}` : null, r.propertyName, r.email].filter(Boolean).join(" · "),
          badge: r.status ?? undefined, href: `/tenants/${r.id}`,
        }));
      });

      // Invoices / rent payments (by invoice number or M-Pesa / bank reference)
      run("invoices", async () => {
        const rows = await db.select({
          id: rentPayments.id, invoiceNumber: rentPayments.invoiceNumber, amount: rentPayments.amount,
          currency: rentPayments.currency, status: rentPayments.status, dueDate: rentPayments.dueDate,
          mpesaTransactionId: rentPayments.mpesaTransactionId, tenantId: rentPayments.tenantId, firstName: tenants.firstName, lastName: tenants.lastName,
        }).from(rentPayments)
          .innerJoin(tenants, eq(rentPayments.tenantId, tenants.id))
          .leftJoin(units, eq(tenants.unitId, units.id))
          .where(and(
            eq(tenants.organizationId, orgId), propScope(units.propertyId),
            or(
              ilike(rentPayments.invoiceNumber, like),
              ilike(rentPayments.mpesaTransactionId, like),
              ilike(rentPayments.bankReference, like),
            ),
          )).orderBy(desc(rentPayments.dueDate)).limit(limit);
        return rows.map(r => ({
          id: r.id, title: r.invoiceNumber || r.mpesaTransactionId || `Payment #${r.id}`,
          subtitle: [fullName(r.firstName, r.lastName), money(r.amount, r.currency), day(r.dueDate)].filter(Boolean).join(" · "),
          badge: r.status ?? undefined, href: `/tenants/${r.tenantId}`,
        }));
      });
    }

    // Maintenance (title, ticket number, description) — scoped through unit → property
    run("maintenance", async () => {
      const rows = await db.select({
        id: maintenanceRequests.id, ticket: maintenanceRequests.ticketNumber, title: maintenanceRequests.title,
        status: maintenanceRequests.status, priority: maintenanceRequests.priority,
        unitNumber: units.unitNumber, propertyName: properties.name,
      }).from(maintenanceRequests)
        .innerJoin(units, eq(maintenanceRequests.unitId, units.id))
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(and(
          eq(properties.organizationId, orgId), propScope(properties.id),
          or(
            ilike(maintenanceRequests.title, like), ilike(maintenanceRequests.ticketNumber, like),
            ilike(maintenanceRequests.description, like),
          ),
        )).orderBy(desc(maintenanceRequests.id)).limit(limit);
      return rows.map(r => ({
        id: r.id, title: r.title,
        subtitle: [r.ticket, r.unitNumber ? `Unit ${r.unitNumber}` : null, r.propertyName].filter(Boolean).join(" · "),
        badge: String(r.status ?? "").replace(/_/g, " "), href: `/maintenance-request/${r.id}`,
      }));
    });

    // Contractors
    if (BACKOFFICE.includes(role)) {
      run("contractors", async () => {
        const rows = await db.select({
          id: contractors.id, name: contractors.name, company: contractors.companyName,
          specialty: contractors.specialty, phone: contractors.phone,
        }).from(contractors)
          .where(and(
            eq(contractors.organizationId, orgId),
            or(
              ilike(contractors.name, like), ilike(contractors.companyName, like),
              ilike(contractors.specialty, like), ilike(contractors.phone, like), ilike(contractors.email, like),
            ),
          )).orderBy(contractors.companyName).limit(limit);
        return rows.map(r => ({
          id: r.id, title: r.company || r.name, subtitle: [r.name !== r.company ? r.name : null, r.phone].filter(Boolean).join(" · "),
          badge: r.specialty, href: `/contractors/${r.id}`,
        }));
      });
    }

    // Expenses
    if ([...FULL, "landlord"].includes(role)) {
      run("expenses", async () => {
        const rows = await db.select({
          id: propertyExpenses.id, number: propertyExpenses.expenseNumber, vendor: propertyExpenses.vendorName,
          description: propertyExpenses.description, amount: propertyExpenses.amount,
          currency: propertyExpenses.currency, status: propertyExpenses.status,
        }).from(propertyExpenses)
          .innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
          .where(and(
            eq(properties.organizationId, orgId), propScope(properties.id),
            or(
              ilike(propertyExpenses.vendorName, like), ilike(propertyExpenses.expenseNumber, like),
              ilike(propertyExpenses.description, like),
            ),
          )).orderBy(desc(propertyExpenses.expenseDate)).limit(limit);
        return rows.map(r => ({
          id: r.id, title: r.vendor, subtitle: [r.number, money(r.amount, r.currency), r.description].filter(Boolean).join(" · "),
          badge: r.status ?? undefined, href: "/expense-management",
        }));
      });
    }

    // Utility bills
    if (BACKOFFICE.includes(role)) {
      run("utility", async () => {
        const rows = await db.select({
          id: utilityBills.id, number: utilityBills.billNumber, type: utilityBills.utilityType,
          amount: utilityBills.amount, currency: utilityBills.currency, status: utilityBills.status,
          dueDate: utilityBills.dueDate,
        }).from(utilityBills)
          .leftJoin(utilityAccounts, eq(utilityBills.accountId, utilityAccounts.id))
          .leftJoin(properties, eq(utilityAccounts.propertyId, properties.id))
          .leftJoin(tenants, eq(utilityBills.tenantId, tenants.id))
          .where(and(
            or(eq(properties.organizationId, orgId), eq(tenants.organizationId, orgId)),
            or(ilike(utilityBills.billNumber, like), ilike(utilityAccounts.accountNumber, like)),
          )).orderBy(desc(utilityBills.dueDate)).limit(limit);
        return rows.map(r => ({
          id: r.id, title: r.number || `${r.type ?? "Utility"} bill #${r.id}`,
          subtitle: [r.type, money(r.amount, r.currency), day(r.dueDate)].filter(Boolean).join(" · "),
          badge: r.status ?? undefined, href: role === "staff" ? "/utility-management" : "/billing?tab=utilities",
        }));
      });
    }

    // Leases
    if ([...FULL, "landlord"].includes(role)) {
      run("leases", async () => {
        const rows = await db.select({
          id: leases.id, number: leases.leaseNumber, status: leases.status, end: leases.endDate,
          firstName: tenants.firstName, lastName: tenants.lastName,
        }).from(leases)
          .innerJoin(tenants, eq(leases.tenantId, tenants.id))
          .where(and(
            eq(leases.organizationId, orgId), propScope(leases.propertyId),
            or(ilike(leases.leaseNumber, like)),
          )).orderBy(desc(leases.id)).limit(limit);
        return rows.map(r => ({
          id: r.id, title: r.number, subtitle: [fullName(r.firstName, r.lastName), r.end ? `ends ${day(r.end)}` : null].filter(Boolean).join(" · "),
          badge: r.status ? String(r.status).replace(/_/g, " ") : undefined, href: "/leases",
        }));
      });
    }

    // Team members
    if (FULL.includes(role)) {
      run("team", async () => {
        const rows = await db.select({
          id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: users.role,
        }).from(users)
          .where(and(
            eq(users.organizationId, orgId),
            // Tenants already have their own group; this one is for staff accounts.
            sql`${users.role} <> 'tenant'`,
            or(
              ilike(users.firstName, like), ilike(users.lastName, like),
              ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, like), ilike(users.email, like),
            ),
          )).orderBy(users.firstName).limit(limit);
        return rows.map(r => ({
          id: r.id, title: fullName(r.firstName, r.lastName) || r.email, subtitle: r.email,
          badge: r.role, href: "/user-management",
        }));
      });
    }

    await Promise.all(jobs);
    const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
    res.json({ query: raw, groups, total });
  } catch (err) {
    logger.error("global search failed", { err: String(err) });
    res.status(500).json({ message: "Search failed" });
  }
});

export default router;
