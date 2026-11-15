/**
 * prospects.ts — mounted at /api/prospects (staff) and /api/prospects/apply (public)
 *
 * Letting pipeline: new → viewing → viewed → application → reference check → approved → lease offered → converted
 * (rejected from any open stage; a rejected prospect can be reopened). All rules live in services/prospect-pipeline.ts.
 *
 *   GET    /api/prospects                         list (filter: propertyId, unitId, status)
 *   GET    /api/prospects/pipeline/:propertyId    stages for one property + its vacant units
 *   GET    /api/prospects/:id                     one prospect, with property/unit/assignee and the tenant/lease it became
 *   GET    /api/prospects/:id/available-units     units this person could be let right now
 *   POST   /api/prospects                         add (walk-in / agent)
 *   PATCH  /api/prospects/:id                     edit details (never the stage — use the actions)
 *   POST   /api/prospects/:id/schedule-viewing | mark-viewed | submit-application | check-references
 *   POST   /api/prospects/:id/approve | offer-lease | reject | reopen | convert
 *
 *   Public (no login), mounted separately:
 *   GET    /api/prospects/apply/options/:organizationId   organisation name + vacant units for the form
 *   POST   /api/prospects/apply                            the application form
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { prospects, properties, units, tenants, leases, users, organizations } from "@shared/schema";
import { eq, and, desc, asc, inArray, ne, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { sendLeaseOfferEmail } from "../lib/email";
import { pushNotification } from "./notifications";
import {
  ProspectRuleError, STAGES, OPEN_STATUSES, RESERVING, assertFrom, loadProspect, resolvePlace, assertAssignee, findDuplicate, duplicateError,
  currentTenantWarning, unitBlocker, affordabilityWarnings, convertProspect, zodMessage,
  createSchema, detailFields, patchSchema, applySchema, viewingSchema, approveSchema, convertSchema,
} from "../services/prospect-pipeline";

const router = Router();                 // staff routes
export const prospectsPublicRouter = Router();   // the public application form
const auth = [authenticateJWT as any, requireOrg as any];

/** Anonymous visitors get a small bucket of their own: an application form is an easy target for spam. */
export const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: () => Number(process.env.PROSPECT_APPLY_LIMIT ?? 30),
  message: { message: "Too many applications from this connection. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
});

function fail(res: any, err: any, fallback: string) {
  if (err instanceof ProspectRuleError) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err instanceof z.ZodError) return res.status(400).json({ message: zodMessage(err), errors: err.flatten().fieldErrors });
  console.error(`[prospects] ${fallback}:`, err);
  return res.status(500).json({ message: fallback });
}
const idOf = (req: any) => Number.parseInt(req.params.id, 10);
const numStr = (n: number | null | undefined) => (n == null ? null : String(n));

/** Run an action on one prospect under a row lock, so two clicks (or two people) can't both pass the same stage check. */
async function transact<T>(orgId: number, id: number, fn: (tx: any, p: any) => Promise<T>): Promise<T> {
  if (!Number.isInteger(id) || id < 1) throw new ProspectRuleError(400, "Invalid prospect id");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(prospects).where(and(eq(prospects.id, id), eq(prospects.organizationId, orgId))).for("update").limit(1);
    if (!p) throw new ProspectRuleError(404, "Prospect not found");
    return fn(tx, p);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC APPLICATION FORM — no login
// ══════════════════════════════════════════════════════════════════════════════

const RECEIVED = "Application received. We will be in touch within 2 business days.";

/** Vacant units (not occupied, not held by a tenant) — what an applicant can ask for. */
async function vacantUnitRows(orgId: number, extra: any[] = []) {
  return db.select({
    id: units.id, unitNumber: units.unitNumber, propertyId: units.propertyId, propertyName: properties.name,
    unitType: units.unitType, bedrooms: units.bedrooms, monthlyRent: units.monthlyRent, currency: units.currency,
  }).from(units).innerJoin(properties, eq(units.propertyId, properties.id))
    .where(and(eq(units.organizationId, orgId), eq(properties.organizationId, orgId), eq(units.isOccupied, false),
      sql`not exists (select 1 from tenants t where t.unit_id = ${units.id} and t.status in ('active','pending'))`, ...extra))
    .orderBy(asc(properties.name), asc(units.unitNumber)).limit(500);
}

prospectsPublicRouter.get("/options/:organizationId", async (req: any, res: any) => {
  try {
    const orgId = Number.parseInt(req.params.organizationId, 10);
    if (!Number.isInteger(orgId) || orgId < 1) return res.status(404).json({ message: "Organisation not found" });
    const [org] = await db.select({ id: organizations.id, name: organizations.name, active: organizations.isActive }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org || org.active === false) return res.status(404).json({ message: "Organisation not found" });
    res.json({ organization: { id: org.id, name: org.name }, units: await vacantUnitRows(orgId) });
  } catch (err) { fail(res, err, "Could not load the application form"); }
});

prospectsPublicRouter.post("/", async (req: any, res: any) => {
  try {
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error), errors: parsed.error.flatten().fieldErrors });
    const d = parsed.data;
    if (d.website) return res.status(201).json({ message: RECEIVED });   // honeypot filled: pretend it worked, store nothing

    const orgId = d.organizationId;
    const [org] = await db.select({ id: organizations.id, active: organizations.isActive }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org || org.active === false) return res.status(404).json({ message: "Organisation not found" });

    const place = await resolvePlace(orgId, d.propertyId, d.unitId);
    if (place.unitId) {
      const blocked = await unitBlocker(orgId, place.unitId, { reservations: false });
      if (blocked) return res.status(409).json({ message: "Sorry, that unit is no longer available. Please choose another.", code: "UNIT_UNAVAILABLE" });
    }

    // the same person applying twice (double-click, refresh, second device) is one application
    if (await findDuplicate(orgId, { email: d.email, nationalId: d.nationalId })) return res.status(200).json({ message: RECEIVED });

    const [created] = await db.insert(prospects).values({
      organizationId: orgId, propertyId: place.propertyId, unitId: place.unitId,
      firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, nationalId: d.nationalId,
      nationality: d.nationality ?? "Kenyan", employer: d.employer ?? null, jobTitle: d.jobTitle ?? null,
      monthlyIncome: numStr(d.monthlyIncome), employmentType: d.employmentType ?? null,
      reference1Name: d.reference1Name ?? null, reference1Phone: d.reference1Phone ?? null, reference1Relation: d.reference1Relation ?? null,
      reference2Name: d.reference2Name ?? null, reference2Phone: d.reference2Phone ?? null, reference2Relation: d.reference2Relation ?? null,
      preferredMoveIn: d.preferredMoveIn ?? null, budgetMin: numStr(d.budgetMin), budgetMax: numStr(d.budgetMax),
      status: "application_submitted", source: "website", applicationSubmittedAt: new Date(),
    } as any).returning({ id: prospects.id });

    // someone has to see it: ping the people who run lettings
    db.select({ id: users.id }).from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.role, ["admin", "manager"]))).limit(10)
      .then((rows) => rows.forEach((u) => pushNotification(u.id, {
        type: "system", title: "New website application", message: `${d.firstName} ${d.lastName} applied${place.unitId ? " for a unit" : ""}.`,
        ts: new Date().toISOString(), link: "/prospects", meta: { prospectId: created.id },
      })))
      .catch(() => {});

    res.status(201).json({ message: RECEIVED });
  } catch (err) { fail(res, err, "Failed to submit application. Please try again."); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LIST / PIPELINE / SINGLE
// ══════════════════════════════════════════════════════════════════════════════

const intQuery = (v: unknown) => { const n = Number.parseInt(String(v ?? ""), 10); return Number.isInteger(n) && n > 0 ? n : null; };

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const conditions: any[] = [eq(prospects.organizationId, orgId)];
    const propertyId = intQuery(req.query.propertyId), unitId = intQuery(req.query.unitId);
    if (propertyId) conditions.push(eq(prospects.propertyId, propertyId));
    if (unitId) conditions.push(eq(prospects.unitId, unitId));
    if (typeof req.query.status === "string" && req.query.status) conditions.push(eq(prospects.status, req.query.status));

    const rows = await db.select({
      id: prospects.id, firstName: prospects.firstName, lastName: prospects.lastName, email: prospects.email, phone: prospects.phone,
      propertyId: prospects.propertyId, unitId: prospects.unitId, status: prospects.status, source: prospects.source,
      viewingDate: prospects.viewingDate, budgetMax: prospects.budgetMax, preferredMoveIn: prospects.preferredMoveIn, offeredRent: prospects.offeredRent,
      assignedTo: prospects.assignedTo, approvedAt: prospects.approvedAt, rejectedAt: prospects.rejectedAt, convertedAt: prospects.convertedAt,
      convertedToTenantId: prospects.convertedToTenantId, createdAt: prospects.createdAt, updatedAt: prospects.updatedAt,
      propertyName: properties.name, unitNumber: units.unitNumber,
    }).from(prospects)
      .leftJoin(properties, eq(prospects.propertyId, properties.id))
      .leftJoin(units, eq(prospects.unitId, units.id))
      .where(and(...conditions)).orderBy(desc(prospects.updatedAt));
    res.json(rows);
  } catch (err) { fail(res, err, "Failed to load prospects"); }
});

router.get("/pipeline/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const propertyId = intQuery(req.params.propertyId);
    const [prop] = propertyId ? await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId))).limit(1) : [];
    if (!prop) return res.status(404).json({ message: "Property not found" });

    const rows = await db.select({
      id: prospects.id, firstName: prospects.firstName, lastName: prospects.lastName, email: prospects.email, phone: prospects.phone,
      propertyId: prospects.propertyId, unitId: prospects.unitId, status: prospects.status, budgetMax: prospects.budgetMax,
      viewingDate: prospects.viewingDate, createdAt: prospects.createdAt, unitNumber: units.unitNumber,
    }).from(prospects).leftJoin(units, eq(prospects.unitId, units.id))
      .where(and(eq(prospects.organizationId, orgId), eq(prospects.propertyId, propertyId!))).orderBy(asc(prospects.createdAt));

    const pipeline = Object.fromEntries(STAGES.map((stage) => [stage, rows.filter((r) => r.status === stage).map((r) => ({ ...r, fullName: `${r.firstName} ${r.lastName}` }))]));
    const vacant = (await vacantUnitRows(orgId, [eq(units.propertyId, propertyId!)])).map((u) => ({ id: u.id, unitNumber: u.unitNumber, monthlyRent: u.monthlyRent, isOccupied: false }));
    const reserved = new Set((await db.select({ u: prospects.unitId }).from(prospects).where(and(eq(prospects.organizationId, orgId), eq(prospects.propertyId, propertyId!), inArray(prospects.status, RESERVING)))).map((r) => r.u));
    res.json({ pipeline, vacantUnits: vacant.filter((u) => !reserved.has(u.id)), totalProspects: rows.length });
  } catch (err) { fail(res, err, "Failed to load the pipeline"); }
});

router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const p = await loadProspect(orgId, idOf(req));
    const [place] = await db.select({ propertyName: properties.name, unitNumber: units.unitNumber, unitRent: units.monthlyRent })
      .from(prospects).leftJoin(properties, eq(prospects.propertyId, properties.id)).leftJoin(units, eq(prospects.unitId, units.id)).where(eq(prospects.id, p.id)).limit(1);
    const [assignee] = p.assignedTo ? await db.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, p.assignedTo)).limit(1) : [];
    let tenant: any = null;
    if (p.convertedToTenantId) {
      const [lease] = await db.select({ id: leases.id, n: leases.leaseNumber, status: leases.status }).from(leases)
        .where(and(eq(leases.tenantId, p.convertedToTenantId), eq(leases.organizationId, orgId))).orderBy(desc(leases.id)).limit(1);
      const [t] = await db.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.id, p.convertedToTenantId)).limit(1);
      tenant = { id: p.convertedToTenantId, status: t?.status ?? null, leaseId: lease?.id ?? null, leaseNumber: lease?.n ?? null, leaseStatus: lease?.status ?? null };
    }
    // an approved prospect whose unit was taken in the meantime needs to be told
    const unitIssue = p.unitId && RESERVING.includes(p.status) ? await unitBlocker(orgId, p.unitId, { prospectId: p.id }) : null;
    res.json({ ...p, ...place, assignedToName: assignee ? `${assignee.f ?? ""} ${assignee.l ?? ""}`.trim() : null, tenant, unitIssue });
  } catch (err) { fail(res, err, "Failed to load the prospect"); }
});

router.get("/:id/available-units", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const p = await loadProspect(orgId, idOf(req));
    const rows = await vacantUnitRows(orgId, [p.propertyId ? eq(units.propertyId, p.propertyId) : sql`true`]);
    const reservedElsewhere = new Set((await db.select({ u: prospects.unitId }).from(prospects)
      .where(and(eq(prospects.organizationId, orgId), inArray(prospects.status, RESERVING), ne(prospects.id, p.id)))).map((r) => r.u));
    res.json(rows.filter((u) => !reservedElsewhere.has(u.id)));
  } catch (err) { fail(res, err, "Failed to load units"); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE / EDIT
// ══════════════════════════════════════════════════════════════════════════════

/** Form values → DB values (money columns are decimals-as-strings). Only keys that were sent are included. */
function toColumns(d: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    out[k] = ["monthlyIncome", "budgetMin", "budgetMax"].includes(k) ? numStr(v) : v;
  }
  return out;
}

router.post("/", ...auth, auditLog("prospect", "CREATE") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const d = createSchema.parse(req.body ?? {});
    const place = await resolvePlace(orgId, d.propertyId, d.unitId);
    await assertAssignee(orgId, d.assignedTo);
    const dup = await findDuplicate(orgId, { email: d.email, nationalId: d.nationalId });
    if (dup) throw duplicateError(dup);

    const [created] = await db.insert(prospects).values({
      ...toColumns(d), organizationId: orgId, propertyId: place.propertyId, unitId: place.unitId, status: "new", source: d.source,
    } as any).returning();
    res.locals.auditEntityId = String(created.id);
    const w = await currentTenantWarning(orgId, d.email);
    res.status(201).json({ ...created, warnings: w ? [w] : [] });
  } catch (err) { fail(res, err, "Failed to add the prospect"); }
});

router.patch("/:id", ...auth, auditLog("prospect", "UPDATE") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const d = patchSchema.parse(req.body ?? {});
    const updated = await transact(orgId, idOf(req), async (tx, p) => {
      if (p.status === "converted") {
        const other = Object.keys(d).filter((k) => k !== "internalNotes");
        if (other.length) throw new ProspectRuleError(409, "This prospect is already a tenant. Edit the tenant record instead — only notes can change here.");
      }
      if (d.email || d.nationalId) {
        const dup = await findDuplicate(orgId, { email: d.email, nationalId: d.nationalId }, p.id);
        if (dup) throw duplicateError(dup);
      }
      if (d.assignedTo) await assertAssignee(orgId, d.assignedTo);
      const patch = toColumns(d);
      if ("propertyId" in d || "unitId" in d) {
        const nextProperty = "propertyId" in d ? d.propertyId : p.propertyId;
        let nextUnit = "unitId" in d ? d.unitId : p.unitId;
        if ("propertyId" in d && !("unitId" in d) && p.unitId && d.propertyId !== p.propertyId) nextUnit = null;   // the old unit isn't in the new property
        const place = await resolvePlace(orgId, nextProperty, nextUnit);
        if (RESERVING.includes(p.status)) {
          if (!place.unitId) throw new ProspectRuleError(409, "An approved prospect needs a unit. Choose another unit instead of clearing it.");
          if (place.unitId !== p.unitId) {
            const blocked = await unitBlocker(orgId, place.unitId, { prospectId: p.id }, tx);
            if (blocked) throw new ProspectRuleError(409, blocked, { code: "UNIT_UNAVAILABLE" });
          }
        }
        patch.propertyId = place.propertyId; patch.unitId = place.unitId;
      }
      const [row] = await tx.update(prospects).set({ ...patch, updatedAt: new Date() }).where(eq(prospects.id, p.id)).returning();
      return row;
    });
    res.locals.auditEntityId = String(updated.id);
    res.json(updated);
  } catch (err) { fail(res, err, "Failed to update the prospect"); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE ACTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function setStatus(tx: any, p: any, status: string, fields: Record<string, any> = {}) {
  const [row] = await tx.update(prospects).set({ status, ...fields, updatedAt: new Date() }).where(eq(prospects.id, p.id)).returning();
  return row;
}

router.post("/:id/schedule-viewing", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const b = viewingSchema.parse(req.body ?? {});
    const when = new Date(b.viewingDate);
    if (when.getTime() < Date.now() - 15 * 60_000) throw new ProspectRuleError(400, "Choose a viewing time that has not passed yet.");
    await assertAssignee(orgId, b.assignedTo);
    const row = await transact(orgId, idOf(req), async (tx, p) => {
      assertFrom(p, "schedule-viewing");
      const agent = b.assignedTo ?? req.user.id;
      return setStatus(tx, p, "viewing_scheduled", { viewingDate: when, viewingNotes: b.viewingNotes ?? null, viewingConductedBy: agent, assignedTo: agent });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to schedule the viewing"); }
});

router.post("/:id/mark-viewed", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const notes = z.object({ notes: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().trim().max(2000).optional()) }).parse(req.body ?? {}).notes;
    const row = await transact(req.user.organizationId, idOf(req), async (tx, p) => {
      assertFrom(p, "mark-viewed");
      return setStatus(tx, p, "viewed", { viewingNotes: [p.viewingNotes, notes ? `Viewed: ${notes}` : null].filter(Boolean).join("\n") || null, viewingConductedBy: p.viewingConductedBy ?? req.user.id });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to record the viewing"); }
});

const applicationSchema = z.object({
  phone: detailFields.phone, nationalId: detailFields.nationalId, nationality: detailFields.nationality,
  employer: detailFields.employer, jobTitle: detailFields.jobTitle, monthlyIncome: detailFields.monthlyIncome,
  employmentType: detailFields.employmentType,
  reference1Name: detailFields.reference1Name, reference1Phone: detailFields.reference1Phone, reference1Relation: detailFields.reference1Relation,
  reference2Name: detailFields.reference2Name, reference2Phone: detailFields.reference2Phone, reference2Relation: detailFields.reference2Relation,
  notes: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().trim().max(2000).optional()),
});

router.post("/:id/submit-application", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { notes, ...extra } = applicationSchema.parse(req.body ?? {});
    const row = await transact(orgId, idOf(req), async (tx, p) => {
      assertFrom(p, "submit-application");
      const merged = { ...p, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null)) };
      const missing = [!merged.phone && "phone number", !merged.nationalId && "ID / passport number"].filter(Boolean) as string[];
      if (missing.length) throw new ProspectRuleError(422, `The application is incomplete — add the applicant's ${missing.join(" and ")}.`, { code: "APPLICATION_INCOMPLETE", missing });
      if (extra.nationalId) {
        const dup = await findDuplicate(orgId, { nationalId: extra.nationalId }, p.id);
        if (dup) throw duplicateError(dup);
      }
      return setStatus(tx, p, "application_submitted", { ...toColumns(extra), applicationSubmittedAt: new Date(), applicationNotes: notes ?? null });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to record the application"); }
});

router.post("/:id/check-references", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const { notes } = z.object({ notes: z.string({ required_error: "Say what the references told you" }).trim().min(3, "Say what the references told you").max(5000) }).parse(req.body ?? {});
    const row = await transact(req.user.organizationId, idOf(req), async (tx, p) => {
      assertFrom(p, "check-references");
      return setStatus(tx, p, "reference_checked", { referencesCheckedAt: new Date(), referencesCheckedBy: req.user.id, referenceCheckNotes: notes });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to record the reference check"); }
});

router.post("/:id/approve", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const b = approveSchema.parse(req.body ?? {});
    const out = await transact(orgId, idOf(req), async (tx, p) => {
      assertFrom(p, "approve");
      if (p.status === "application_submitted" && !b.waiveReferences) {
        throw new ProspectRuleError(409, "Check the references first, or choose “waive reference check” if you are skipping it.", { code: "REFERENCES_PENDING" });
      }
      const unitId = b.unitId ?? p.unitId;
      if (!unitId) throw new ProspectRuleError(422, "Choose the unit this person is approved for.", { code: "UNIT_REQUIRED" });
      const place = await resolvePlace(orgId, null, unitId);
      await tx.execute(sql`select id from units where id = ${unitId} and organization_id = ${orgId} for update`);   // two approvals for one unit queue up here
      const blocked = await unitBlocker(orgId, unitId, { prospectId: p.id }, tx);
      if (blocked) throw new ProspectRuleError(409, blocked, { code: "UNIT_UNAVAILABLE" });
      const rent = b.offeredRent ?? place.unitRent ?? 0;
      if (!(rent > 0)) throw new ProspectRuleError(422, "Enter the monthly rent being offered.", { code: "RENT_REQUIRED" });
      const waived = p.status === "application_submitted";
      const row = await setStatus(tx, p, "approved", {
        unitId, propertyId: place.propertyId, offeredRent: String(rent), approvedAt: new Date(), approvedBy: req.user.id, rejectedAt: null, rejectionReason: null,
        ...(waived ? { referenceCheckNotes: `Reference check waived by approver.${b.notes ? ` ${b.notes}` : ""}` } : {}),
      });
      return { row, warnings: affordabilityWarnings(p, rent) };
    });
    res.json({ ...out.row, warnings: out.warnings });
  } catch (err) { fail(res, err, "Failed to approve the prospect"); }
});

router.post("/:id/offer-lease", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const b = approveSchema.pick({ offeredRent: true }).parse(req.body ?? {});
    const row = await transact(orgId, idOf(req), async (tx, p) => {
      assertFrom(p, "offer-lease");
      if (!p.unitId) throw new ProspectRuleError(422, "This prospect has no unit — edit it before offering a lease.");
      const blocked = await unitBlocker(orgId, p.unitId, { prospectId: p.id }, tx);
      if (blocked) throw new ProspectRuleError(409, blocked, { code: "UNIT_UNAVAILABLE" });
      const rent = b.offeredRent ?? Number(p.offeredRent ?? 0);
      if (!(rent > 0)) throw new ProspectRuleError(422, "Enter the monthly rent being offered.", { code: "RENT_REQUIRED" });
      return setStatus(tx, p, "lease_offered", { offeredRent: String(rent), leaseOfferedAt: new Date() });
    });
    // tell them, but never let a mail problem undo the offer
    let emailSent = false;
    try {
      const [ctx] = await db.select({ org: organizations.name, property: properties.name, unit: units.unitNumber }).from(prospects)
        .leftJoin(organizations, eq(prospects.organizationId, organizations.id)).leftJoin(properties, eq(prospects.propertyId, properties.id)).leftJoin(units, eq(prospects.unitId, units.id))
        .where(eq(prospects.id, row.id)).limit(1);
      await sendLeaseOfferEmail({ to: row.email, name: row.firstName, orgName: ctx?.org, propertyName: ctx?.property, unitNumber: ctx?.unit, rent: Number(row.offeredRent) });
      emailSent = true;
    } catch (e: any) { console.warn("[prospects] offer email not sent:", e?.message ?? e); }
    res.json({ ...row, emailSent });
  } catch (err) { fail(res, err, "Failed to offer the lease"); }
});

router.post("/:id/reject", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const { reason } = z.object({ reason: z.string({ required_error: "A reason is required" }).trim().min(3, "A reason is required").max(1000) }).parse(req.body ?? {});
    const row = await transact(req.user.organizationId, idOf(req), async (tx, p) => {
      assertFrom(p, "reject");
      return setStatus(tx, p, "rejected", { rejectedAt: new Date(), rejectionReason: reason });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to reject the prospect"); }
});

router.post("/:id/reopen", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const row = await transact(orgId, idOf(req), async (tx, p) => {
      assertFrom(p, "reopen");
      const dup = await findDuplicate(orgId, { email: p.email, nationalId: p.nationalId }, p.id);
      if (dup) throw duplicateError(dup);
      // back to where the paperwork actually is; the decision and the reference check start again
      return setStatus(tx, p, p.applicationSubmittedAt ? "application_submitted" : "new", {
        rejectedAt: null, rejectionReason: null, approvedAt: null, approvedBy: null, leaseOfferedAt: null, referencesCheckedAt: null, referencesCheckedBy: null, referenceCheckNotes: null,
      });
    });
    res.json(row);
  } catch (err) { fail(res, err, "Failed to reopen the prospect"); }
});

/** Converts an approved prospect into a pending tenant + draft lease (active once the lease is activated). */
router.post("/:id/convert", ...auth, auditLog("prospect", "ACTION") as any, async (req: any, res: any) => {
  try {
    const input = convertSchema.parse(req.body ?? {});
    const out = await convertProspect({ orgId: req.user.organizationId, prospectId: idOf(req), userId: req.user.id, ip: req.ip, input });
    res.locals.auditEntityId = String(idOf(req));
    res.status(201).json({
      tenant: out.tenant, lease: out.lease, userId: out.userId, invite: out.invite, warnings: out.warnings, returningTenant: out.returning,
      message: "Converted. The tenant record and a draft lease are ready — send the lease for signing and activate it to start the tenancy.",
    });
  } catch (err) { fail(res, err, "Failed to convert the prospect"); }
});

export default router;
