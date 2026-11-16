/**
 * Properties router — mounted at /api/properties
 *
 * Changes vs. original:
 *  1. requireOrg guard on the /:id/units sub-route (was missing — any
 *     authenticated user could enumerate units for any property ID).
 *  2. /:id/units now also cross-checks that the property belongs to
 *     the caller's org before returning its units.
 *  3. /dashboard_metrics unchanged (already org-scoped).
 *  4. unitRouter's /vacant endpoint is now required-org guarded; the
 *     `|| req.session?.organizationId` silent fallback is removed.
 *  5. All createCRUDRouter-backed routers already carry organizationScoped:true.
 *  6. FIX: the enriched GET / handler used sql`= ANY(${propIds})` to fetch
 *     units in bulk. Drizzle's sql template literal cannot serialize a plain
 *     JS number[] as a Postgres array literal — it throws at runtime, the
 *     catch block returns a 500, Express falls through to the CRUD router,
 *     and the client receives { results: [], total: 0 } → zero properties.
 *     Fixed by replacing sql`ANY` with inArray(), which is the correct
 *     Drizzle idiom used everywhere else in this codebase.
 *  7. FIX: propertyRouter GET / was also shadowed by the CRUD router's own
 *     GET / (Express resolves the first registered handler). Restructured to
 *     use the same composite pattern as visitorRouter: custom list handler
 *     registered first on a plain Router, CRUD router layered underneath.
 *     Note: index.ts already mounts propertiesListRouter before propertyRouter,
 *     so this is a belt-and-suspenders defence in case that ordering ever
 *     changes.
 */
import { Router, Request } from "express";
import { ZodObject } from "zod";
import { createCRUDRouter } from "../utils/crud";
import {
  properties, units, tenants, propertyExpenses, visitors, rentPayments,
  insertPropertySchema, insertUnitSchema, insertPropertyExpenseSchema,
  insertVisitorSchema,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import {
  requireActiveSubscription,
  enforcePropertyLimit,
  enforceUnitLimit,
} from "../middleware/billing";
import { storage } from "../storage";
import { rentCollectionSummary, rentCashRows } from "../services/rent-ledger";

type AnyZodObject = ZodObject<any, any, any, any, any>;

declare module "express-serve-static-core" {
  interface Request {
    session?: Record<string, any>;
  }
}

// ── CRUD routers (all org-scoped via createCRUDRouter) ────────────────────────

// NOTE: We do NOT export propertyCRUDRouter directly as propertyRouter.
// The CRUD router registers its own GET / handler first, which would shadow
// our custom enriched list handler. We build a composite router below
// (same pattern as visitorRouter).
const propertyCRUDRouter = createCRUDRouter({
  table: properties,
  insertSchema: insertPropertySchema as unknown as AnyZodObject,
  organizationScoped: true,
  preCreateMiddleware: [requireActiveSubscription, enforcePropertyLimit],
});

const unitRouter = createCRUDRouter({
  table: units,
  insertSchema: insertUnitSchema as unknown as AnyZodObject,
  organizationScoped: true,
  preCreateMiddleware: [requireActiveSubscription, enforceUnitLimit],
});

// ── Property Expenses Router ──────────────────────────────────────────────────
// propertyExpenses has NO organizationId column — it scopes to an org only via
// propertyId → properties.organizationId.  The generic createCRUDRouter with
// organizationScoped:true silently returns all rows when the column is absent,
// so we replace it with an explicit custom router.
const expenseRouter = Router();

expenseRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number  = req.user.organizationId;
    const isLandlord     = req.user.role === "landlord";
    const userId: string = req.user.id;

    // Fetch property IDs in scope:
    //   landlord → only properties they own (ownerId = userId)
    //   manager/admin → all properties in the org
    const { inArray } = await import("drizzle-orm");
    const orgProperties = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        isLandlord
          ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
          : eq(properties.organizationId, orgId)
      );
    const propIds = orgProperties.map(p => p.id);
    if (propIds.length === 0) return res.json([]);

    const results = await db
      .select()
      .from(propertyExpenses)
      .where(inArray(propertyExpenses.propertyId, propIds))
      .orderBy(desc(propertyExpenses.createdAt));

    res.json(results);
  } catch (err: any) {
    console.error("[expenses] GET / error:", err);
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
});

expenseRouter.get("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const propCondition = req.user.role === "landlord"
      ? and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
      : and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId));
    const [expense] = await db
      .select()
      .from(propertyExpenses)
      .innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
      .where(propCondition)
      .limit(1);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    res.json((expense as any).property_expenses ?? expense);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to fetch expense" });
  }
});

// ── Expense rules ───────────────────────────────────────────────────────────────────────────────────────────────────
// Who may record / change expenses (caretakers, guards, contractors and tenants may not — an expense is a cost
// that flows straight into the owner statement), what an expense must look like, and how its status moves:
//   pending → approved | rejected,  approved → paid | rejected,  rejected → pending (resubmit),  paid is final.
const EXPENSE_WRITERS = ["admin", "manager", "landlord", "staff"];
const EXPENSE_STATUS_NEXT: Record<string, string[]> = {
  pending: ["approved", "rejected"], approved: ["paid", "rejected"], rejected: ["pending"], paid: [],
};
const EXPENSE_EDITABLE = ["propertyId", "contractorId", "vendorName", "description", "amount", "currency", "category", "expenseDate", "dueDate",
  "isRecurring", "recurringFrequency", "nextRecurringDate", "paymentMethod", "receiptUrl", "invoiceUrl", "tags", "notes"] as const;

function expenseWriteDenied(req: any, res: any): boolean {
  if (!EXPENSE_WRITERS.includes(req.user?.role)) { res.status(403).json({ message: "Your role cannot record or change expenses." }); return true; }
  return false;
}
function expenseProblem(b: any, { creating }: { creating: boolean }): string | null {
  if (b.amount !== undefined || creating) {
    const n = Number(b.amount);
    if (b.amount === undefined || b.amount === null || b.amount === "" || !Number.isFinite(n) || n <= 0) return "amount must be a number greater than zero";
    if (n > 1_000_000_000) return "amount is unrealistically large";
  }
  for (const k of ["expenseDate", "dueDate", "paymentDate"]) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== "" && Number.isNaN(new Date(b[k]).getTime())) return `${k} is not a valid date`;
  }
  if (b.expenseDate && new Date(b.expenseDate).getTime() > Date.now() + 36 * 3600_000) return "expenseDate cannot be in the future";
  if (b.dueDate && b.expenseDate && new Date(b.dueDate) < new Date(new Date(b.expenseDate).toISOString().slice(0, 10))) return "dueDate cannot be before the expense date";
  if (creating && !String(b.vendorName ?? "").trim()) return "vendorName is required";
  if (creating && !String(b.description ?? "").trim()) return "description is required";
  return null;
}
/** Date columns arrive as strings (JSON) — turn them into Dates (or null) before the schema sees them. */
const asDate = (v: any) => (v === undefined ? undefined : v === null || v === "" ? null : new Date(v));
/** EXP-YYYYMM-n — next number for the month (the web form sends its own; API callers need not). */
async function nextExpenseNumber(): Promise<string> {
  const ym = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7).replace("-", "");
  const r: any = await db.execute(sql`select coalesce(max((regexp_match(expense_number, ${"^EXP-" + ym + "-(\\d+)$"}))[1]::int), 0) as n from property_expenses`);
  const n = Number((r.rows ?? r)[0]?.n ?? 0);
  return `EXP-${ym}-${String(n + 1).padStart(4, "0")}`;
}

expenseRouter.post("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (expenseWriteDenied(req, res)) return;
    const orgId: number = req.user.organizationId;
    const propertyId = parseInt(req.body.propertyId);
    // Ownership check: property must belong to this org (and, for a
    // landlord, to them specifically).
    const propCondition = req.user.role === "landlord"
      ? and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
      : and(eq(properties.id, propertyId), eq(properties.organizationId, orgId));
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(propCondition)
      .limit(1);
    if (!prop) return res.status(403).json({ message: "Property does not belong to your organisation" });

    const problem = expenseProblem(req.body, { creating: true });
    if (problem) return res.status(400).json({ message: problem });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const supplied = String(req.body.expenseNumber ?? "").trim();
        const validated = insertPropertyExpenseSchema.parse({
          ...req.body,
          expenseNumber: supplied || await nextExpenseNumber(),
          propertyId,
          amount: String(Number(req.body.amount)),
          expenseDate: asDate(req.body.expenseDate),
          dueDate: asDate(req.body.dueDate),
          nextRecurringDate: asDate(req.body.nextRecurringDate),
          // an expense is born pending (or, for a manager entering something already approved, approved) — never "paid" without a payment
          status: req.body.status === "approved" && ["admin", "manager"].includes(req.user.role) ? "approved" : "pending",
          paymentDate: undefined,
          approvedBy: undefined,
          approvedAt: undefined,
          createdBy: req.user.id ?? req.user.userId,
        });
        const [created] = await db.insert(propertyExpenses).values(validated as any).returning();
        return res.status(201).json(created);
      } catch (e: any) {
        if (e?.code === "23505" && !String(req.body.expenseNumber ?? "").trim()) continue;   // number raced — take the next one
        if (e?.code === "23505") return res.status(409).json({ message: "An expense with that number already exists" });
        throw e;
      }
    }
    return res.status(503).json({ message: "Could not allocate an expense number — please try again" });
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ message: `Invalid expense: ${(err.errors ?? err.issues ?? []).map((i: any) => `${(i.path ?? []).join(".")} ${i.message}`).join("; ")}`.slice(0, 300) });
    console.error("[expenses] POST / error:", err);
    res.status(500).json({ message: "Failed to create expense" });
  }
});

expenseRouter.put("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (expenseWriteDenied(req, res)) return;
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    // Ownership check via property join (and, for a landlord, ownerId too)
    const propCondition = req.user.role === "landlord"
      ? and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
      : and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId));
    const [existing] = await db
      .select({ propertyId: propertyExpenses.propertyId, status: propertyExpenses.status, utilityBillId: propertyExpenses.utilityBillId })
      .from(propertyExpenses)
      .innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
      .where(propCondition)
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Expense not found" });

    const body = req.body ?? {};
    // only known fields — the old code spread the whole body into the UPDATE (createdBy, expenseNumber, approvedBy…)
    const set: Record<string, any> = {};
    for (const k of EXPENSE_EDITABLE) if (body[k] !== undefined) set[k] = body[k];
    for (const k of ["expenseDate", "dueDate", "nextRecurringDate"]) if (set[k] !== undefined) set[k] = asDate(set[k]);   // drizzle wants Date objects

    const from = existing.status ?? "pending";
    const wantsStatus = body.status !== undefined && body.status !== from;
    if (from === "paid" && (Object.keys(set).length > 0 || wantsStatus)) {
      return res.status(409).json({ message: "A paid expense is final and cannot be changed." });
    }
    if (from === "approved" && (set.amount !== undefined || set.propertyId !== undefined)) {
      return res.status(409).json({ message: "An approved expense's amount and property are locked — reject it first to change them." });
    }
    if (existing.utilityBillId && (set.amount !== undefined || set.propertyId !== undefined)) {
      return res.status(409).json({ message: "This expense mirrors a utility bill — change the bill instead." });
    }
    const problem = expenseProblem({ ...body, ...set }, { creating: false });
    if (problem) return res.status(400).json({ message: problem });
    if (set.propertyId !== undefined) {
      const pid = parseInt(set.propertyId);
      const cond = req.user.role === "landlord"
        ? and(eq(properties.id, pid), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
        : and(eq(properties.id, pid), eq(properties.organizationId, orgId));
      const [dest] = await db.select({ id: properties.id }).from(properties).where(cond).limit(1);
      if (!dest) return res.status(403).json({ message: "Property does not belong to your organisation" });
      set.propertyId = pid;
    }
    if (set.amount !== undefined) set.amount = String(Number(set.amount));

    if (wantsStatus) {
      const to = String(body.status);
      if (!(EXPENSE_STATUS_NEXT[from] ?? []).includes(to)) {
        return res.status(409).json({ message: `An expense cannot go from ${from} to ${to}.` });
      }
      // matches the screen: an owner/landlord cannot approve or pay their own submissions
      if (["approved", "rejected", "paid"].includes(to) && !["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only an admin or manager can approve, reject or pay an expense." });
      }
      set.status = to;
      if (to === "approved") { set.approvedBy = req.user.id; set.approvedAt = new Date(); }
      if (to === "paid")     { set.paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date(); }
      if (to === "pending" || to === "rejected") { set.approvedBy = null; set.approvedAt = null; }
    }

    const [updated] = await db
      .update(propertyExpenses)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(propertyExpenses.id, id), eq(propertyExpenses.status, from)))   // loses cleanly if someone else moved it first
      .returning();
    if (!updated) return res.status(409).json({ message: "This expense was changed by someone else — refresh and try again." });
    res.json(updated);
  } catch (err: any) {
    console.error("[expenses] PUT /:id error:", err);
    res.status(500).json({ message: "Failed to update expense" });
  }
});

expenseRouter.delete("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (expenseWriteDenied(req, res)) return;
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const propCondition = req.user.role === "landlord"
      ? and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
      : and(eq(propertyExpenses.id, id), eq(properties.organizationId, orgId));
    const [existing] = await db
      .select({ propertyId: propertyExpenses.propertyId, status: propertyExpenses.status, utilityBillId: propertyExpenses.utilityBillId })
      .from(propertyExpenses)
      .innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
      .where(propCondition)
      .limit(1);
    if (!existing) return res.status(404).json({ message: "Expense not found" });
    if (existing.status === "paid" || existing.status === "approved") {
      return res.status(409).json({ message: "An approved or paid expense is part of the books and cannot be deleted. Reject it instead." });
    }
    if (existing.utilityBillId) return res.status(409).json({ message: "This expense mirrors a utility bill — delete or reverse the bill instead." });
    await db.delete(propertyExpenses).where(eq(propertyExpenses.id, id));
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ message: "Failed to delete expense" });
  }
});

// ── Visitor router ─────────────────────────────────────────────────────────────
// IMPORTANT: We cannot monkey-patch visitorRouter.get("/") onto the router
// returned by createCRUDRouter because Express resolves the *first* matching
// handler — and createCRUDRouter already registers GET / internally, so any
// subsequent .get("/") on the same router is silently ignored.
//
// Fix: build a composite router that puts the caretaker-scoped GET / FIRST,
// then falls through to the CRUD router for all other methods (POST, PUT,
// DELETE, GET /:id).

const visitorCRUDRouter = createCRUDRouter({
  table: visitors,
  insertSchema: insertVisitorSchema as unknown as AnyZodObject,
  organizationScoped: true,
});

// Scoped list handler — registered first so it wins over the CRUD router's GET /.
// NOTE: the visitors table has no organizationId column — org scoping is done by
// joining to properties and filtering on properties.organizationId instead.
const visitorListRouter = Router();
visitorListRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId:  number = req.user.organizationId;
    const role:   string = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    let propertyFilter: number | null = null;
    if (role === "caretaker") {
      // Look up the caretaker record to get the assigned propertyId.
      const caretaker = await storage.getCaretakerByUserId(userId);
      if (!caretaker?.propertyId) {
        // No property assignment → return empty list (not a 403; assignment may be pending).
        return res.json([]);
      }
      propertyFilter = caretaker.propertyId;
    }

    // Scope to the org by joining properties (visitors has no organizationId column).
    // Caretakers are further restricted to their assigned property.
    const results = await db
      .select({ visitor: visitors })
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(
        propertyFilter !== null
          ? and(eq(properties.organizationId, orgId), eq(visitors.propertyId, propertyFilter))
          : eq(properties.organizationId, orgId)
      )
      .orderBy(desc(visitors.createdAt));

    return res.json(results.map(r => r.visitor));
  } catch (err) {
    console.error("Visitors list error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Combine: list handler first, then all CRUD methods (POST, GET /:id, PUT /:id, DELETE /:id).
const visitorRouter = Router();
visitorRouter.use("/", visitorListRouter);  // handles GET /
visitorRouter.use("/", visitorCRUDRouter);  // handles everything else

// ── Property list handler (registered FIRST to avoid CRUD router shadowing) ───

// GET /api/properties
// For landlord-role users, returns only properties where ownerId = req.user.id.
// For managers/admins, returns all org properties.
// Always joins units to return live totalUnits, occupiedUnits, and occupancyRate.
const propertyListRouter = Router();
propertyListRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId:  number = req.user.organizationId;
    const role:   string = req.user.role ?? "manager";
    const userId: string = String(req.user.id ?? req.user.userId ?? "");

    // 1. Fetch properties (filtered by role)
    const propCondition = role === "landlord"
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
      : eq(properties.organizationId, orgId);

    const results = await db.select().from(properties).where(propCondition);

    if (results.length === 0) return res.json([]);

    // 2. Fetch ALL units for this org's properties in one query — avoids N+1.
    //    IMPORTANT: use inArray(), NOT sql`= ANY(${propIds})`.
    //    Drizzle's sql template literal cannot bind a plain JS number[] as a
    //    Postgres array literal; it throws at runtime, the catch returns 500,
    //    and Express falls through to the CRUD router → { results: [] } → 0 properties.
    const propIds = results.map(p => p.id);
    const allUnits = await db
      .select({
        propertyId: units.propertyId,
        isOccupied: units.isOccupied,
      })
      .from(units)
      .where(
        and(
          eq(units.organizationId, orgId),
          inArray(units.propertyId, propIds),
        )
      );

    // 3. Build per-property unit counts
    const unitCountMap = new Map<number, { total: number; occupied: number }>();
    for (const u of allUnits) {
      const pid = u.propertyId!;
      if (!unitCountMap.has(pid)) unitCountMap.set(pid, { total: 0, occupied: 0 });
      const entry = unitCountMap.get(pid)!;
      entry.total++;
      if (u.isOccupied) entry.occupied++;
    }

    // 4. Enrich each property with live counts
    const enriched = results.map(p => {
      const counts = unitCountMap.get(p.id) ?? { total: 0, occupied: 0 };
      return {
        ...p,
        totalUnits:    counts.total,
        occupiedUnits: counts.occupied,
        vacantUnits:   counts.total - counts.occupied,
        occupancyRate: counts.total > 0
          ? Math.round((counts.occupied / counts.total) * 1000) / 10
          : 0,
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error("Properties list error:", error);
    return res.status(500).json({ message: "Failed to fetch properties" });
  }
});

// ── Custom property sub-routes ─────────────────────────────────────────────────

// GET /api/properties/:id/full
// Returns property + units array + tenants array + occupancy stats in one call.
// Used by property-details page (Tenants tab, Analytics tab).
propertyCRUDRouter.get("/:id/full", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const propertyId: number = parseInt(req.params.id);
    const orgId: number      = req.user.organizationId;
    const role:  string      = req.user.role ?? "manager";
    const userId: string     = String(req.user.id ?? req.user.userId ?? "");

    // Build the ownership condition: landlords can only fetch their own properties
    const ownerCondition = role === "landlord"
      ? and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
      : and(eq(properties.id, propertyId), eq(properties.organizationId, orgId));

    const [prop] = await db
      .select()
      .from(properties)
      .where(ownerCondition)
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const [propUnits, allOrgTenants] = await Promise.all([
      db.select().from(units).where(eq(units.propertyId, propertyId)),
      db.select().from(tenants).where(eq(tenants.organizationId, orgId)),
    ]);

    const unitIds    = new Set(propUnits.map(u => u.id));
    const propTenants = allOrgTenants.filter(t => t.unitId && unitIds.has(t.unitId));
    const tenantIds  = propTenants.map(t => t.id);

    // Fetch this month's paid payments for tenants in this property
    const now        = new Date();
    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().split("T")[0];
    const monthEnd   = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().split("T")[0];

    // Money for this property, on the same definitions as the dashboards: "collected" is cash received this
    // month (part payments count when paid), "pending" is what is still owed on this month's invoices, and
    // the collection rate is paid ÷ billed over the last 12 months.
    const twelveMonthsAgo = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11, 1)).toISOString().split("T")[0];
    const [thisMonthCash, monthSummary, yearSummary] = await Promise.all([
      rentCashRows(propertyId, monthStart, monthEnd),
      rentCollectionSummary({ propertyIds: [propertyId] }, monthStart, monthEnd),
      rentCollectionSummary({ propertyIds: [propertyId] }, twelveMonthsAgo, monthEnd),
    ]);
    const thisMonthPayments = thisMonthCash.map(c => ({
      id: c.id, tenantId: c.tenantId, amount: String(c.amount), paidDate: c.paidDate, status: "paid",
    }));
    const collectedThisMonth = monthSummary.received;
    const pendingThisMonth   = Math.round((monthSummary.pending.total + monthSummary.overdue.total) * 100) / 100;
    const collectionRate     = yearSummary.collectionRate;

    const occupiedCount   = propUnits.filter(u => u.isOccupied).length;
    const totalUnitsCount = propUnits.length;
    const occupancyRate   = totalUnitsCount > 0
      ? Math.round((occupiedCount / totalUnitsCount) * 1000) / 10 : 0;

    res.json({
      ...prop,
      units: propUnits,
      tenants: propTenants,
      payments: thisMonthPayments,
      stats: {
        totalUnits: totalUnitsCount,
        occupiedUnits: occupiedCount,
        vacantUnits: totalUnitsCount - occupiedCount,
        occupancyRate,
        totalTenants: propTenants.length,
        activeTenants: propTenants.filter(t => t.status === "active").length,
        collectedThisMonth,
        pendingThisMonth,
        collectionRate,
        totalInvoicedThisMonth: monthSummary.billed,
      },
    });
  } catch (error) {
    console.error("Get property full error:", error);
    res.status(500).json({ message: "Failed to fetch property details" });
  }
});

// GET /api/properties/:id/units
// Returns all units for a property, enriched with hasActiveTenant so callers
// can accurately filter out units that already have a live tenancy.
// isOccupied alone is unreliable — it can lag behind tenant status changes.
propertyCRUDRouter.get("/:id/units", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const propertyId: number = parseInt(req.params.id);
    const orgId: number      = req.user.organizationId;

    // Verify the property belongs to the caller's org
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const propertyUnits = await db
      .select()
      .from(units)
      .where(eq(units.propertyId, propertyId));

    // Find which unit IDs have at least one active tenant
    const activeTenants = await db
      .select({ unitId: tenants.unitId })
      .from(tenants)
      .where(and(eq(tenants.organizationId, orgId), eq(tenants.status, "active")));

    const occupiedUnitIds = new Set(
      activeTenants.map((t) => t.unitId).filter(Boolean)
    );

    const enriched = propertyUnits.map((u) => ({
      ...u,
      hasActiveTenant: occupiedUnitIds.has(u.id),
    }));

    res.json(enriched);
  } catch (error) {
    console.error("Get property units error:", error);
    res.status(500).json({ message: "Failed to fetch units" });
  }
});

// GET /api/properties/dashboard_metrics
propertyCRUDRouter.get("/dashboard_metrics", authenticateJWT, requireOrg, async (req: any, res) => {
  const orgId: number = req.user.organizationId;

  const props    = await db.select().from(properties).where(eq(properties.organizationId, orgId));
  const allUnits = await db.select().from(units).where(eq(units.organizationId, orgId));
  const occupied = allUnits.filter(u => u.isOccupied).length;

  res.json({
    total_properties: props.length,
    total_units:      allUnits.length,
    occupied_units:   occupied,
    vacant_units:     allUnits.length - occupied,
    occupancy_rate:
      allUnits.length > 0
        ? Math.round((occupied / allUnits.length) * 100 * 100) / 100
        : 0,
  });
});

// ── Composite propertyRouter: custom list first, CRUD router underneath ────────
// This is the critical fix. The plain Router registers our enriched GET / handler
// before Express ever sees the CRUD router's own GET /, so our handler wins.
const propertyRouter = Router();
propertyRouter.use("/", propertyListRouter);  // handles GET /  (enriched list)
propertyRouter.use("/", propertyCRUDRouter);  // handles POST, PUT, DELETE, GET /:id, GET /:id/full, etc.

// ── Custom unit sub-routes ─────────────────────────────────────────────────────

// GET /api/units/vacant
unitRouter.get("/vacant", authenticateJWT, requireOrg, async (req: any, res) => {
  const orgId: number = req.user.organizationId;

  const results = await db
    .select()
    .from(units)
    .where(
      sql`${units.organizationId} = ${orgId} AND ${units.isOccupied} = false`,
    );

  res.json(results);
});

export { propertyRouter, unitRouter, expenseRouter, visitorRouter };