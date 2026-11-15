/**
 * reportScheduler.ts
 *
 * Emails each property owner their monthly statement.
 *
 *   • Scheduled: a check runs every day at 08:00 EAT (and once shortly after the server boots).
 *     An organisation is processed when reporting is enabled AND today falls within the
 *     one-week window that starts on the organisation's chosen day of the month. The window
 *     is what makes a missed 08:00 (server asleep or restarting) harmless, while a late
 *     "enable" does not suddenly fire last month's emails weeks after the chosen day.
 *   • Manual ("Send now"): processes ONE organisation, regardless of its toggle or chosen day.
 *
 * For each organisation it finds all active PM agreements (one per property), generates (or
 * re-uses) last month's owner statement, emails the HTML statement to the owner via Resend,
 * and marks the statement "sent". A statement already sent or paid is skipped, so running the
 * check on consecutive days never emails an owner twice.
 *
 * Settings live in organizationSettings.emailSettings:
 *   { reportSchedule: { enabled: boolean, dayOfMonth: number (1-28) } }   default day: 5
 *
 * All statement-generation logic is self-contained here (extracted from the
 * /api/owner-statements/generate HTTP route) so the cron doesn't need
 * to make internal HTTP requests.
 */

import { db }    from "../db";
import {
  organizations,
  organizationSettings,
  pmAgreements,
  ownerStatements,
  properties,
  units,
  tenants,
  rentPayments,
  propertyExpenses,
  users,
} from "@shared/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { rentCashRows } from "./rent-ledger";
import { sendOwnerStatementEmail, StatementEmailData } from "../lib/ownerStatementEmail";
import { maxSequenceSuffix, withNumberRetry } from "../utils/sequenceNumber";

const log = (msg: string) => console.log(`[ReportScheduler] ${msg}`);

// ── EAT scheduling ────────────────────────────────────────────────────────────

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // East Africa Time = UTC+3, no daylight saving

/** Milliseconds until the next occurrence of hh:mm East Africa Time. */
function msUntilNextDailyRun(hh = 8, mm = 0): number {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh - 3, mm, 0, 0));
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

/** The chosen day of month, kept inside the 1–28 range the settings screen offers. */
function clampDay(d: any): number {
  return Math.min(28, Math.max(1, parseInt(d) || 5));
}

/** How many days after the chosen day a missed run may still be made up. */
const CATCH_UP_DAYS = 6;

// ── Statement generation (mirrors /api/owner-statements/generate) ─────────────

const money = (n: any) => Number(n ?? 0);

function computePmFee(
  agreement: { feeType: string; feeRate: string | number | null },
  grossRent: number,
  occupiedUnits: number,
): number {
  const rate = Number(agreement.feeRate ?? 10);
  switch (agreement.feeType) {
    case "percentage":    return (grossRent * rate) / 100;
    case "fixed_monthly": return rate;
    case "per_unit":      return rate * occupiedUnits;
    default:              return (grossRent * rate) / 100;
  }
}

async function nextStatementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await maxSequenceSuffix(ownerStatements, ownerStatements.statementNumber, `OWS-${year}`);
  return `OWS-${year}-${String(last + 1).padStart(3, "0")}`;
}

/** Generate or retrieve the owner statement for a given property + month.
 *  Returns null if there's no PM agreement or no income to report. */
async function generateStatement(
  orgId: number,
  propertyId: number,
  year: number,
  month: number,
): Promise<{
  statement: any;
  property: any;
  owner: any;
  agreement: any;
} | null> {
  // PM agreement
  const [agreement] = await db
    .select()
    .from(pmAgreements)
    .where(and(
      eq(pmAgreements.propertyId, propertyId),
      eq(pmAgreements.organizationId, orgId),
    ))
    .limit(1);

  if (!agreement) return null;

  // Property
  const [prop] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
    .limit(1);

  if (!prop) return null;

  // Owner user (for email)
  let owner: { email: string; firstName: string | null; lastName: string | null } | null = null;
  if (agreement.ownerUserId) {
    const [u] = await db
      .select({ email: users.email, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, agreement.ownerUserId))
      .limit(1);
    if (u?.email) owner = u;
  }

  if (!owner) {
    log(`  ↳ Property #${propertyId} "${prop.name}": no owner email — skipping`);
    return null;
  }

  // Period
  const periodStart = startOfMonth(new Date(year, month - 1, 1));
  const periodEnd   = endOfMonth(new Date(year, month - 1, 1));

  // Check if already sent
  const [existing] = await db
    .select()
    .from(ownerStatements)
    .where(and(
      eq(ownerStatements.propertyId, propertyId),
      eq(ownerStatements.periodYear,  year),
      eq(ownerStatements.periodMonth, month),
    ))
    .limit(1);

  if (existing?.status === "sent" || existing?.status === "paid") {
    log(`  ↳ Property #${propertyId} "${prop.name}": statement already ${existing.status} — skipping`);
    return null;
  }

  // Tenants & payments
  const propTenants = await db
    .select({
      id:          tenants.id,
      firstName:   tenants.firstName,
      lastName:    tenants.lastName,
      monthlyRent: tenants.monthlyRent,
      currency:    tenants.currency,
      unitNumber:  units.unitNumber,
      unitId:      units.id,
    })
    .from(tenants)
    .leftJoin(units, eq(tenants.unitId, units.id))
    .where(and(
      eq(units.propertyId, propertyId),
      eq(tenants.status, "active"),
    ));

  const tenantIds     = propTenants.map(t => t.id);
  const occupiedUnits = propTenants.length;

  // Cash actually received in the month (receipts by payment date — part payments and tenants who
  // have since moved out included), the same definition as the dashboards and owner statements.
  const payments = await rentCashRows(propertyId, format(periodStart, "yyyy-MM-dd"), format(periodEnd, "yyyy-MM-dd"));

  const grossRent = payments.reduce((s, p) => s + money(p.amount), 0);

  // Expenses
  const expCats: string[] = [];
  if (agreement.deductMaintenanceCosts) expCats.push("maintenance", "services", "supplies");
  if (agreement.deductUtilities)        expCats.push("utilities");
  if (agreement.deductInsurance)        expCats.push("insurance");

  const expenses = expCats.length > 0
    ? await db
        .select({
          id:          propertyExpenses.id,
          description: propertyExpenses.description,
          amount:      propertyExpenses.amount,
          category:    propertyExpenses.category,
          vendorName:  propertyExpenses.vendorName,
          expenseDate: propertyExpenses.expenseDate,
        })
        .from(propertyExpenses)
        .where(and(
          eq(propertyExpenses.propertyId, propertyId),
          inArray(propertyExpenses.category, expCats as any),
          inArray(propertyExpenses.status, ["approved", "paid"]),
          gte(propertyExpenses.expenseDate, periodStart),
          lte(propertyExpenses.expenseDate, periodEnd),
        ))
    : [];

  const maintenanceCosts = expenses.filter(e => ["maintenance","services","supplies"].includes(e.category ?? "")).reduce((s,e) => s + money(e.amount), 0);
  const utilityCosts     = expenses.filter(e => e.category === "utilities").reduce((s,e) => s + money(e.amount), 0);
  const insuranceCosts   = expenses.filter(e => e.category === "insurance").reduce((s,e) => s + money(e.amount), 0);
  const pmFee            = computePmFee(agreement, grossRent, occupiedUnits);
  const totalIncome      = grossRent;
  const totalDeductions  = pmFee + maintenanceCosts + utilityCosts + insuranceCosts;
  const netPayable       = Math.max(0, totalIncome - totalDeductions);

  const paymentDetails = payments.map(p => {
    const t = propTenants.find(t => t.id === p.tenantId);
    return {
      tenantName: t ? `${t.firstName} ${t.lastName}` : `Tenant #${p.tenantId}`,
      unitNumber: t?.unitNumber ?? "—",
      amount:     money(p.amount),
      method:     p.paymentMethod ?? "—",
      date:       p.paidDate,
      monthlyRent: money(t?.monthlyRent ?? 0),
    };
  });

  const expenseDetails = expenses.map(e => ({
    vendor:      e.vendorName,
    description: e.description,
    amount:      money(e.amount),
    category:    e.category,
    date:        e.expenseDate,
  }));

  // Upsert statement
  let statement: any;
  if (existing) {
    [statement] = await db
      .update(ownerStatements)
      .set({
        grossRent: String(grossRent), otherIncome: "0",
        totalIncome: String(totalIncome),
        pmFee: String(pmFee),
        maintenanceCosts: String(maintenanceCosts),
        utilityCosts: String(utilityCosts),
        insuranceCosts: String(insuranceCosts),
        otherDeductions: "0",
        totalDeductions: String(totalDeductions),
        netPayable: String(netPayable),
        paymentDetails, expenseDetails,
        updatedAt: new Date(),
      })
      .where(eq(ownerStatements.id, existing.id))
      .returning();
  } else {
    [statement] = await withNumberRetry(async () => db.insert(ownerStatements).values({
      organizationId: orgId,
      pmAgreementId:  agreement.id,
      propertyId,
      ownerUserId:    agreement.ownerUserId,
      statementNumber: await nextStatementNumber(),
      periodMonth:    month,
      periodYear:     year,
      grossRent:      String(grossRent),
      otherIncome:    "0",
      totalIncome:    String(totalIncome),
      pmFee:          String(pmFee),
      maintenanceCosts: String(maintenanceCosts),
      utilityCosts:   String(utilityCosts),
      insuranceCosts: String(insuranceCosts),
      otherDeductions: "0",
      totalDeductions: String(totalDeductions),
      netPayable:     String(netPayable),
      currency:       "KES",
      status:         "draft",
      paymentDetails, expenseDetails,
      generatedBy:    agreement.ownerUserId ?? null,
    } as any).returning());
  }

  return { statement, property: prop, owner, agreement };
}

// ── Main monthly job ──────────────────────────────────────────────────────────

export interface ReportJobOptions {
  /**
   * Process ONE organisation only — used by the "Send now" button. That is an explicit request,
   * so this organisation's on/off toggle and chosen day are ignored. Without it the job covers
   * every organisation that is due today according to its own settings.
   */
  orgId?: number;
  /** Override "now" (tests). */
  now?: Date;
}

export interface ReportJobResult {
  sent: number;
  skipped: number;
  errors: number;
  organisations: number;
}

export async function runMonthlyReportJob(opts: ReportJobOptions = {}): Promise<ReportJobResult> {
  const now    = opts.now ?? new Date();
  const eatNow = new Date(now.getTime() + EAT_OFFSET_MS);
  const eatDay = eatNow.getUTCDate();

  // Report for the previous calendar month, judged in EAT
  const thisMonth0 = eatNow.getUTCMonth();                       // 0-based current month
  const year  = thisMonth0 === 0 ? eatNow.getUTCFullYear() - 1 : eatNow.getUTCFullYear();
  const month = thisMonth0 === 0 ? 12 : thisMonth0;              // 1-based previous month
  const periodLabel = format(new Date(year, month - 1, 1), "MMMM yyyy");

  const result: ReportJobResult = { sent: 0, skipped: 0, errors: 0, organisations: 0 };

  // Which organisations are we doing?
  let orgIds: number[];
  if (opts.orgId !== undefined) {
    orgIds = [opts.orgId];
    log(`Manual report run for org #${opts.orgId} — ${periodLabel}`);
  } else {
    const allSettings = await db.select().from(organizationSettings);
    orgIds = allSettings
      .filter(s => {
        const rs = ((s.emailSettings as any) ?? {}).reportSchedule;
        if (rs?.enabled !== true) return false;
        const day = clampDay(rs.dayOfMonth);
        return eatDay >= day && eatDay <= day + CATCH_UP_DAYS;
      })
      .map(s => s.organizationId);

    if (orgIds.length === 0) {
      log(`Scheduled check for ${periodLabel}: no organisation is due today (EAT day ${eatDay}) — nothing to do`);
      return result;
    }
    log(`Scheduled run for ${periodLabel}: ${orgIds.length} organisation(s) due: [${orgIds.join(", ")}]`);
  }

  // Org names (for email branding)
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, orgIds));

  const orgNameMap = new Map(orgs.map(o => [o.id, o.name]));

  for (const orgId of orgIds) {
    const orgName = orgNameMap.get(orgId) ?? `Org #${orgId}`;
    log(`\nOrg: ${orgName} (#${orgId})`);
    result.organisations++;

    // Org settings (for timezone / currency)
    const [orgSettings] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1);

    // All active PM agreements for this org
    const agreements = await db
      .select({ propertyId: pmAgreements.propertyId })
      .from(pmAgreements)
      .where(and(
        eq(pmAgreements.organizationId, orgId),
        eq(pmAgreements.status, "active"),
      ));

    log(`  Found ${agreements.length} active PM agreement(s)`);

    for (const { propertyId } of agreements) {
      try {
        const generated = await generateStatement(orgId, propertyId, year, month);
        if (!generated) { result.skipped++; continue; }

        const { statement, property: prop, owner, agreement } = generated;

        const pmFeeLabel = agreement.feeType === "percentage"
          ? `PM fee (${Number(agreement.feeRate)}% of gross rent)`
          : agreement.feeType === "per_unit"
          ? `PM fee (${orgSettings?.defaultCurrency ?? "KES"} ${Number(agreement.feeRate)} per unit)`
          : `PM management fee`;

        const emailData: StatementEmailData = {
          orgName,
          ownerName:   `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "Property Owner",
          ownerEmail:  owner.email,
          propertyName:    prop.name,
          propertyAddress: prop.address ?? "",
          periodYear:  year,
          periodMonth: month,
          statementNumber: statement.statementNumber,
          generatedAt:     new Date(),
          grossRent:       Number(statement.grossRent),
          otherIncome:     Number(statement.otherIncome),
          totalIncome:     Number(statement.totalIncome),
          pmFee:           Number(statement.pmFee),
          maintenanceCosts: Number(statement.maintenanceCosts),
          utilityCosts:    Number(statement.utilityCosts),
          insuranceCosts:  Number(statement.insuranceCosts),
          otherDeductions: Number(statement.otherDeductions),
          totalDeductions: Number(statement.totalDeductions),
          netPayable:      Number(statement.netPayable),
          currency:        statement.currency ?? orgSettings?.defaultCurrency ?? "KES",
          paymentDetails:  statement.paymentDetails as any,
          expenseDetails:  statement.expenseDetails as any,
          pmFeeLabel,
          disbursementMethod:  agreement.disbursementMethod ?? null,
          disbursementAccount: agreement.disbursementAccount ?? null,
        };

        await sendOwnerStatementEmail(emailData);

        // Mark as sent
        await db
          .update(ownerStatements)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(ownerStatements.id, statement.id));

        log(`  ✓ Sent to ${owner.email} for ${prop.name}`);
        result.sent++;
      } catch (err: any) {
        log(`  ✗ Error for property #${propertyId}: ${err.message}`);
        result.errors++;
      }
    }
  }

  log(`\nJob complete — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors}`);
  return result;
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

export function startReportScheduler(): void {
  log("Report scheduler initialised");

  const check = async (why: string) => {
    try {
      await runMonthlyReportJob();
    } catch (err) {
      log(`Top-level error in ${why} report check: ${err}`);
    }
  };

  const scheduleDaily = () => {
    const delay = msUntilNextDailyRun(8, 0);
    log(`Next report check in ~${Math.round(delay / 3_600_000)}h (08:00 EAT daily)`);
    setTimeout(async () => {
      await check("daily");
      scheduleDaily();
    }, delay);
  };

  scheduleDaily();

  // Catch-up shortly after boot: the host may have been asleep or restarting at 08:00 on the
  // chosen day. Safe to repeat — statements already sent are skipped.
  setTimeout(() => { void check("startup"); }, 2 * 60 * 1000);
}
