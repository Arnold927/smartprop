/**
 * prospect-pipeline.ts — every rule of the letting pipeline (prospect → viewing → application → references →
 * approval → lease offer → tenant), shared by the routes.
 *
 *   new ─► viewing_scheduled ─► viewed ─► application_submitted ─► reference_checked ─► approved ─► lease_offered ─► converted
 *     │            │               │               │                      │               │             │
 *     └────────────┴───────────────┴───────────────┴──────────────────────┴───────────────┴─────────────┴──► rejected ─► (reopen) new
 *
 *  - a stage can only be reached from the stage(s) before it (no approving a brand-new enquiry);
 *  - approving RESERVES a unit for the prospect: nobody else can be approved for it, and it must be vacant;
 *  - converting is one transaction: tenant (a pending tenancy, active once the lease is activated) + login invite
 *    + draft lease + deposit + unit reservation + the prospect itself, so a failure leaves nothing half-done.
 */

import { z } from "zod";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { prospects, units, properties, tenants, leases, users, depositTransactions, organizations } from "@shared/schema";
import { issueInvite, deliverInvite, InviteConflictError, type InviteResult } from "../utils/invites";
import { appendEvent, isRealDate, isUniqueViolation, monthsBetween, nextLeaseNumber } from "./lease-lifecycle";
import { todayEAT } from "./rent-ledger";

export class ProspectRuleError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

// ── stages ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const STAGES = ["new", "viewing_scheduled", "viewed", "application_submitted", "reference_checked", "approved", "lease_offered", "converted", "rejected"] as const;
/** Still in play: not converted, not rejected. */
export const OPEN_STATUSES = ["new", "viewing_scheduled", "viewed", "application_submitted", "reference_checked", "approved", "lease_offered"];
/** These hold a unit for the prospect. */
export const RESERVING = ["approved", "lease_offered"];

/** action → the stages it may start from */
export const FROM: Record<string, string[]> = {
  "schedule-viewing":   ["new", "viewing_scheduled", "viewed"],
  "mark-viewed":        ["viewing_scheduled"],
  "submit-application": ["new", "viewing_scheduled", "viewed"],
  "check-references":   ["application_submitted"],
  "approve":            ["reference_checked", "application_submitted"],     // application_submitted only with waiveReferences
  "offer-lease":        ["approved"],
  "reject":             OPEN_STATUSES,
  "reopen":             ["rejected"],
  "convert":            ["approved", "lease_offered"],
};
const STAGE_LABEL: Record<string, string> = {
  new: "a new enquiry", viewing_scheduled: "viewing booked", viewed: "viewed", application_submitted: "applied", reference_checked: "references checked",
  approved: "approved", lease_offered: "lease offered", converted: "converted to a tenant", rejected: "rejected",
};
export function assertFrom(p: { status: string }, action: string) {
  if (FROM[action]?.includes(p.status)) return;
  const why: Record<string, string> = {
    "check-references": "References are checked once the application is in — record the application first.",
    "approve": "Approve once the application is in and the references are checked (or tick “waive reference check”).",
    "offer-lease": "Only an approved prospect can be sent a lease offer.",
    "convert": "Approve the prospect before converting to a tenant.",
    "mark-viewed": "Only a booked viewing can be marked as done.",
    "reopen": "Only a rejected prospect can be reopened.",
  };
  const base = p.status === "converted" ? "This prospect has already been converted to a tenant."
    : p.status === "rejected" && action !== "reopen" ? "This prospect was rejected. Reopen it first if you want to continue."
    : `That step is not available while the prospect is ${STAGE_LABEL[p.status] ?? p.status}.`;
  throw new ProspectRuleError(409, `${base}${why[action] && p.status !== "converted" && p.status !== "rejected" ? " " + why[action] : ""}`, { code: "BAD_STAGE", status: p.status });
}

// ── input validation ────────────────────────────────────────────────────────────────────────────────────────────
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const str = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable().optional());
const num = (max = 1_000_000_000) => z.preprocess(
  (v) => { const b = blank(v); return b === undefined || b === null ? b : typeof b === "number" ? b : Number(b); },
  z.number().finite().min(0).max(max).nullable().optional(),
);
const dateStr = z.preprocess(blank, z.string().refine(isRealDate, "Use a real date (YYYY-MM-DD)").nullable().optional());
const intId = z.preprocess((v) => { const b = blank(v); return b === undefined || b === null ? b : Number(b); }, z.number().int().positive().nullable().optional());
const phone = z.preprocess(blank, z.string().trim().regex(/^\+?[0-9][0-9\s\-()]{6,19}$/, "Enter a valid phone number").nullable().optional());
const nationalId = z.preprocess(blank, z.string().trim().regex(/^[A-Za-z0-9\-/ ]{4,30}$/, "Enter a valid ID / passport number").nullable().optional());
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(255);
export const SOURCES = ["walk_in", "referral", "website", "portal", "agent"] as const;

export const detailFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email,
  phone, nationalId,
  nationality: str(50),
  employer: str(200), jobTitle: str(100),
  monthlyIncome: num(), employmentType: str(30),
  reference1Name: str(100), reference1Phone: phone, reference1Relation: str(50),
  reference2Name: str(100), reference2Phone: phone, reference2Relation: str(50),
  preferredMoveIn: dateStr,
  budgetMin: num(), budgetMax: num(),
  propertyId: intId, unitId: intId,
  internalNotes: str(5000),
};
const budgetOk = (d: any) => d.budgetMin == null || d.budgetMax == null || d.budgetMin <= d.budgetMax;
const budgetMsg = { message: "Minimum budget cannot be above the maximum", path: ["budgetMin"] };

export const createSchema = z.object({ ...detailFields, source: z.enum(SOURCES).default("walk_in"), assignedTo: z.string().uuid().nullable().optional() }).refine(budgetOk, budgetMsg);
export const patchSchema = z.object({ ...detailFields, source: z.enum(SOURCES), assignedTo: z.string().uuid().nullable() }).partial().refine(budgetOk, budgetMsg);
export const applySchema = z.object({
  ...detailFields,
  organizationId: z.coerce.number().int().positive(),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s\-()]{6,19}$/, "Enter a valid phone number"),
  nationalId: z.string().trim().regex(/^[A-Za-z0-9\-/ ]{4,30}$/, "Enter a valid ID / passport number"),
  website: z.string().max(200).optional(),   // honeypot: real people never see or fill this
}).refine(budgetOk, budgetMsg);

export const viewingSchema = z.object({
  viewingDate: z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Choose a valid viewing date and time"),
  viewingNotes: str(2000), assignedTo: z.string().uuid().nullable().optional(),
});
export const approveSchema = z.object({
  unitId: intId, offeredRent: z.preprocess((v) => (blank(v) == null ? undefined : Number(v)), z.number().finite().positive("Offered rent must be above zero").max(100_000_000).optional()),
  waiveReferences: z.boolean().optional(), notes: str(2000),
});
export const convertSchema = z.object({
  unitId: intId,
  monthlyRent: z.preprocess((v) => (blank(v) == null ? undefined : Number(v)), z.number().finite().positive("Monthly rent must be above zero").max(100_000_000).optional()),
  securityDeposit: z.preprocess((v) => (blank(v) == null ? 0 : Number(v)), z.number().finite().min(0).max(1_000_000_000)),
  depositPaidDate: dateStr,
  leaseStartDate: z.string().refine(isRealDate, "Choose the lease start date"),
  leaseEndDate: z.string().refine(isRealDate, "Choose the lease end date"),
}).refine((d) => d.leaseEndDate > d.leaseStartDate, { message: "The lease must end after it starts", path: ["leaseEndDate"] })
  .refine((d) => monthsBetween(d.leaseStartDate, d.leaseEndDate) <= 600, { message: "That lease term is too long", path: ["leaseEndDate"] });

export function zodMessage(err: z.ZodError): string {
  const i = err.issues[0];
  const where = i.path.length ? `${String(i.path[0])}: ` : "";
  return `${where}${i.message}`;
}

// ── lookups ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function loadProspect(orgId: number, id: number, ex: any = db) {
  if (!Number.isInteger(id) || id < 1) throw new ProspectRuleError(400, "Invalid prospect id");
  const [p] = await ex.select().from(prospects).where(and(eq(prospects.id, id), eq(prospects.organizationId, orgId))).limit(1);
  if (!p) throw new ProspectRuleError(404, "Prospect not found");
  return p;
}

/** A property/unit pair must belong to this organisation, and the unit to the property. Returns the resolved ids. */
export async function resolvePlace(orgId: number, propertyId?: number | null, unitId?: number | null): Promise<{ propertyId: number | null; unitId: number | null; unitRent: number | null }> {
  let pid = propertyId ?? null; let uid = unitId ?? null; let rent: number | null = null;
  if (uid) {
    const [u] = await db.select({ id: units.id, propertyId: units.propertyId, rent: units.monthlyRent }).from(units).where(and(eq(units.id, uid), eq(units.organizationId, orgId))).limit(1);
    if (!u) throw new ProspectRuleError(400, "That unit was not found in your organisation.");
    if (pid && pid !== u.propertyId) throw new ProspectRuleError(400, "That unit does not belong to the selected property.");
    pid = u.propertyId; rent = u.rent == null ? null : Number(u.rent);
  }
  if (pid) {
    const [p] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, pid), eq(properties.organizationId, orgId))).limit(1);
    if (!p) throw new ProspectRuleError(400, "That property was not found in your organisation.");
  }
  return { propertyId: pid, unitId: uid, unitRent: rent };
}

export async function assertAssignee(orgId: number, userId: string | null | undefined) {
  if (!userId) return;
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, orgId), inArray(users.role, ["admin", "manager", "staff", "caretaker"]))).limit(1);
  if (!u) throw new ProspectRuleError(400, "That team member was not found in your organisation.");
}

/** Same person already in the pipeline? Matches on email, or on ID number when there is one. */
export async function findDuplicate(orgId: number, d: { email?: string | null; nationalId?: string | null }, ignoreId?: number) {
  const conds: any[] = [];
  if (d.email) conds.push(sql`lower(${prospects.email}) = ${d.email.toLowerCase()}`);
  if (d.nationalId) conds.push(sql`upper(replace(${prospects.nationalId}, ' ', '')) = ${d.nationalId.toUpperCase().replace(/\s+/g, "")}`);
  if (!conds.length) return null;
  const where = [eq(prospects.organizationId, orgId), inArray(prospects.status, OPEN_STATUSES), sql`(${sql.join(conds, sql` or `)})`];
  if (ignoreId) where.push(ne(prospects.id, ignoreId));
  const [dup] = await db.select({ id: prospects.id, f: prospects.firstName, l: prospects.lastName, status: prospects.status }).from(prospects).where(and(...where)).limit(1);
  return dup ?? null;
}
export function duplicateError(dup: { id: number; f: string; l: string; status: string }) {
  return new ProspectRuleError(409, `${dup.f} ${dup.l} is already in the pipeline (${STAGE_LABEL[dup.status] ?? dup.status}). Continue with that record instead of adding a second one.`, { code: "DUPLICATE_PROSPECT", existingId: dup.id });
}

/** A current tenant with this email → a warning (they may be transferring), never a block. */
export async function currentTenantWarning(orgId: number, emailAddr: string): Promise<string | null> {
  const [t] = await db.select({ id: tenants.id, unitNumber: units.unitNumber }).from(tenants).leftJoin(units, eq(tenants.unitId, units.id))
    .where(and(eq(tenants.organizationId, orgId), sql`lower(${tenants.email}) = ${emailAddr.toLowerCase()}`, inArray(tenants.status, ["active", "pending"]))).limit(1);
  return t ? `This person is already a current tenant${t.unitNumber ? ` (unit ${t.unitNumber})` : ""}. Converting them will need their current tenancy to end first.` : null;
}

// ── unit availability ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Can this unit be let to this prospect? Null = yes, otherwise the reason it can't.
 * Taken: flagged occupied, held by an active/pending tenant, covered by a live lease, or reserved for another approved prospect.
 */
export async function unitBlocker(orgId: number, unitId: number, o: { prospectId?: number; tenantId?: number; reservations?: boolean } = {}, ex: any = db): Promise<string | null> {
  const [u] = await ex.select({ id: units.id, n: units.unitNumber, occ: units.isOccupied }).from(units).where(and(eq(units.id, unitId), eq(units.organizationId, orgId))).limit(1);
  if (!u) return "That unit was not found in your organisation.";
  const tc: any[] = [eq(tenants.organizationId, orgId), eq(tenants.unitId, unitId), inArray(tenants.status, ["active", "pending"])];
  if (o.tenantId) tc.push(ne(tenants.id, o.tenantId));
  const [holder] = await ex.select({ f: tenants.firstName, l: tenants.lastName }).from(tenants).where(and(...tc)).limit(1);
  if (holder) return `Unit ${u.n} is occupied by ${`${holder.f ?? ""} ${holder.l ?? ""}`.trim() || "another tenant"}.`;
  const lc: any[] = [eq(leases.organizationId, orgId), eq(leases.unitId, unitId), inArray(leases.status, ["active", "pending_signature"])];
  if (o.tenantId) lc.push(ne(leases.tenantId, o.tenantId));
  const [lease] = await ex.select({ n: leases.leaseNumber }).from(leases).where(and(...lc)).limit(1);
  if (lease) return `Unit ${u.n} already has a live lease (${lease.n}).`;
  if (u.occ) return `Unit ${u.n} is marked occupied.`;
  if (o.reservations !== false) {
    const pc: any[] = [eq(prospects.organizationId, orgId), eq(prospects.unitId, unitId), inArray(prospects.status, RESERVING)];
    if (o.prospectId) pc.push(ne(prospects.id, o.prospectId));
    const [other] = await ex.select({ f: prospects.firstName, l: prospects.lastName }).from(prospects).where(and(...pc)).limit(1);
    if (other) return `Unit ${u.n} is already reserved for ${other.f} ${other.l}, who is approved for it.`;
  }
  return null;
}

// ── affordability (advice, never a block) ───────────────────────────────────────────────────────────────────────
export function affordabilityWarnings(p: { monthlyIncome?: any; budgetMax?: any }, rent: number): string[] {
  const out: string[] = [];
  const income = p.monthlyIncome == null ? null : Number(p.monthlyIncome);
  if (income && income > 0 && income < rent * 3) out.push(`Stated income (KES ${income.toLocaleString("en-KE")}) is under 3× the rent (KES ${(rent * 3).toLocaleString("en-KE")}).`);
  const bmax = p.budgetMax == null ? null : Number(p.budgetMax);
  if (bmax && bmax > 0 && rent > bmax) out.push(`The rent is above the prospect's stated budget (KES ${bmax.toLocaleString("en-KE")}).`);
  return out;
}

// ── conversion ──────────────────────────────────────────────────────────────────────────────────────────────────
export type ConvertInput = z.infer<typeof convertSchema>;

export async function convertProspect(o: { orgId: number; prospectId: number; userId: string; ip?: string | null; input: ConvertInput }) {
  const { orgId, prospectId, userId, input } = o;
  const first = await loadProspect(orgId, prospectId);
  if (first.status === "converted") throw new ProspectRuleError(409, "This prospect has already been converted to a tenant.", { code: "ALREADY_CONVERTED" });
  assertFrom(first, "convert");

  const unitId = input.unitId ?? first.unitId ?? null;
  if (!unitId) throw new ProspectRuleError(400, "Choose the unit this person is moving into.");
  const rent = input.monthlyRent ?? (first.offeredRent == null ? 0 : Number(first.offeredRent));
  if (!(rent > 0)) throw new ProspectRuleError(400, "Enter the monthly rent.");
  const today = todayEAT();
  const emailAddr = first.email.trim().toLowerCase();

  let committed: any = null;
  for (let attempt = 0; attempt < 5 && !committed; attempt++) {
    const leaseNumber = await nextLeaseNumber(orgId);
    try {
      committed = await db.transaction(async (tx) => {
        const [p] = await tx.select().from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.organizationId, orgId))).for("update").limit(1);
        if (!p) throw new ProspectRuleError(404, "Prospect not found");
        if (p.status === "converted" || p.convertedToTenantId) throw new ProspectRuleError(409, "This prospect has already been converted to a tenant.", { code: "ALREADY_CONVERTED" });
        if (!FROM.convert.includes(p.status)) throw new ProspectRuleError(409, "The prospect changed while you were converting. Reload and try again.");

        await tx.execute(sql`select id from units where id = ${unitId} and organization_id = ${orgId} for update`);   // two conversions on one unit queue up here
        const [unit] = await tx.select({ id: units.id, propertyId: units.propertyId, unitType: units.unitType, n: units.unitNumber }).from(units).where(and(eq(units.id, unitId), eq(units.organizationId, orgId))).limit(1);
        if (!unit) throw new ProspectRuleError(400, "That unit was not found in your organisation.");

        // a returning tenant keeps their record (and login); someone currently housed with us must end that tenancy first
        const [existing] = await tx.select().from(tenants).where(and(eq(tenants.organizationId, orgId), sql`lower(${tenants.email}) = ${emailAddr}`)).orderBy(sql`${tenants.id} desc`).limit(1);
        if (existing && ["active", "pending"].includes(existing.status) && existing.unitId) {
          throw new ProspectRuleError(409, `${p.firstName} ${p.lastName} is already a current tenant. End their current tenancy from the Leases page first, or renew their lease instead.`, { code: "TENANT_EXISTS", tenantId: existing.id });
        }

        const blocked = await unitBlocker(orgId, unitId, { prospectId: p.id, tenantId: existing?.id }, tx);
        if (blocked) throw new ProspectRuleError(409, blocked, { code: "UNIT_UNAVAILABLE" });

        // login: reuse the returning tenant's; otherwise a pending invite in THIS organisation (never someone else's account)
        let tenantUserId: string; let invite: InviteResult = { status: "active", link: null, emailSent: false };
        if (existing) tenantUserId = existing.userId;
        else {
          try {
            const issued = await issueInvite({ organizationId: orgId, invitedByUserId: userId, email: emailAddr, role: "tenant", firstName: p.firstName, lastName: p.lastName, executor: tx as any });
            tenantUserId = issued.userId; invite = { status: issued.status, link: issued.link, emailSent: false };
          } catch (e) {
            if (e instanceof InviteConflictError) throw new ProspectRuleError(409, e.message, { code: "ACCOUNT_CONFLICT" });
            throw e;
          }
        }

        const tenantFields = {
          firstName: p.firstName, lastName: p.lastName, email: emailAddr, phone: p.phone ?? null, unitId,
          leaseStartDate: input.leaseStartDate, leaseEndDate: input.leaseEndDate, monthlyRent: String(rent),
          securityDeposit: input.securityDeposit > 0 ? String(input.securityDeposit) : null,
          status: "pending", updatedAt: new Date(),
        };
        let tenantId: number;
        if (existing) { await tx.update(tenants).set(tenantFields as any).where(eq(tenants.id, existing.id)); tenantId = existing.id; }
        else { const [t] = await tx.insert(tenants).values({ ...tenantFields, organizationId: orgId, userId: tenantUserId } as any).returning({ id: tenants.id }); tenantId = t.id; }

        const [lease] = await tx.insert(leases).values({
          organizationId: orgId, tenantId, unitId, propertyId: unit.propertyId, leaseNumber, startDate: input.leaseStartDate, endDate: input.leaseEndDate,
          leaseDurationMonths: monthsBetween(input.leaseStartDate, input.leaseEndDate), monthlyRent: String(rent), currency: "KES",
          securityDeposit: String(input.securityDeposit), depositPaidDate: input.depositPaidDate ?? null,
          escalationRate: "0.10", escalationFrequencyMonths: 12, rentStructure: "fixed", status: "draft",
          notes: `Created from prospect #${p.id} (${p.firstName} ${p.lastName}).`, createdBy: userId,
        } as any).returning();
        await appendEvent(tx, { leaseId: lease.id, tenantId, orgId, eventType: "created", performedBy: userId, ip: o.ip,
          description: `Lease ${leaseNumber} drafted when prospect ${p.firstName} ${p.lastName} was converted to a tenant. Monthly rent: KES ${rent.toLocaleString("en-KE")}.`, metadata: { prospectId: p.id } });
        if (input.securityDeposit > 0 && input.depositPaidDate) {
          await tx.insert(depositTransactions).values({
            leaseId: lease.id, tenantId, organizationId: orgId, transactionType: "received", amount: input.securityDeposit.toFixed(2), currency: "KES",
            balanceAfter: input.securityDeposit.toFixed(2), reason: "Security deposit received at conversion", transactionDate: input.depositPaidDate, performedBy: userId,
          } as any);
          await appendEvent(tx, { leaseId: lease.id, tenantId, orgId, eventType: "deposit_received", performedBy: userId, ip: o.ip,
            description: `Security deposit of KES ${input.securityDeposit.toLocaleString("en-KE")} received.`, metadata: { amount: input.securityDeposit } });
        }

        await tx.update(units).set({ isOccupied: true } as any).where(eq(units.id, unitId));
        await tx.update(prospects).set({
          status: "converted", convertedToTenantId: tenantId, convertedAt: new Date(), unitId, propertyId: unit.propertyId, offeredRent: String(rent), updatedAt: new Date(),
        } as any).where(eq(prospects.id, p.id));

        const warnings: string[] = [];
        const residential = !unit.unitType || ["apartment", "house"].includes(unit.unitType);
        if (residential && input.securityDeposit > rent * 2) warnings.push(`The deposit is more than 2 months' rent (KES ${(rent * 2).toLocaleString("en-KE")}), the usual cap for residential tenancies under the Landlord and Tenant Act. Check it is lawful.`);
        if (input.leaseStartDate < today) warnings.push("The lease start date is in the past.");
        return { tenantId, tenantUserId, lease, invite, warnings, unitNumber: unit.n, returning: !!existing, prospect: p };
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;   // lease number taken by a parallel create — number again
      throw e;
    }
  }

  // invite email AFTER the commit, so a mail failure can never undo (or fake) a conversion
  const c = committed;
  if (c.invite.link) {
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    c.invite.emailSent = await deliverInvite({
      to: emailAddr, link: c.invite.link,
      subject: org?.name ? `Welcome to ${org.name} — set up your tenant account` : undefined,
      intro: org?.name ? `${org.name} has approved your application and prepared your lease. Set up your account to view it, pay rent and submit maintenance requests.` : undefined,
    });
  }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, c.tenantId)).limit(1);
  return { tenant, lease: c.lease, userId: c.tenantUserId, invite: c.invite, warnings: c.warnings, returning: c.returning };
}
