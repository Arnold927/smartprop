/**
 * reportScheduler.ts
 *
 * Runs a monthly job on the 5th of every month at 08:00 EAT that:
 *   1. Scans all organisations with `reportSchedule.enabled = true`
 *      in their organizationSettings.emailSettings JSON column.
 *   2. For each org, finds all active PM agreements (one per property).
 *   3. Generates (or re-uses) the owner statement for last month.
 *   4. Emails the HTML statement to the property owner via Resend.
 *   5. Updates the statement status to "sent" and records the timestamp.
 *
 * Integration: import { startReportScheduler } and call from server/index.ts
 * alongside startRentScheduler / startLeaseScheduler.
 *
 * The toggle lives in organizationSettings.emailSettings:
 *   { reportSchedule: { enabled: boolean, dayOfMonth: number } }
 * Default dayOfMonth: 5.
 *
 * All statement-generation logic is self-contained here (extracted from
 * the /api/owner-statements/generate HTTP route) so the cron doesn't need
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
import { sendOwnerStatementEmail, StatementEmailData } from "../lib/ownerStatementEmail";

const log = (msg: string) => console.log(`[ReportScheduler] ${msg}`);

// ── EAT scheduler (same pattern as rentScheduler) ────────────────────────────

function msUntilNextMonthlyRun(dayOfMonth = 5, hh = 8, mm = 0): number {
  const now   = new Date();
  // Work in EAT (UTC+3)
  const eatNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  let target = new Date(Date.UTC(
    eatNow.getUTCFullYear(),
    eatNow.getUTCMonth(),
    dayOfMonth,
    hh - 3, mm, 0, 0, // back to UTC
  ));

  // If this month's run has already passed, schedule for next month
  if (target.getTime() <= now.getTime()) {
    target = new Date(Date.UTC(
      eatNow.getUTCFullYear(),
      eatNow.getUTCMonth() + 1,
      dayOfMonth,
      hh - 3, mm, 0, 0,
    ));
  }

  return target.getTime() - now.getTime();
}

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
  const [row] = await db
    .select({ max: sql<string>`MAX(statement_number)` })
    .from(ownerStatements);
  const last = parseInt((row?.max ?? "OWS-0000-000").split("-").pop() ?? "0") || 0;
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

  const payments = tenantIds.length > 0
    ? await db
        .select({
          id:            rentPayments.id,
          tenantId:      rentPayments.tenantId,
          amount:        rentPayments.amount,
          paidDate:      rentPayments.paidDate,
          paymentMethod: rentPayments.paymentMethod,
          status:        rentPayments.status,
        })
        .from(rentPayments)
        .where(and(
          inArray(rentPayments.tenantId, tenantIds),
          inArray(rentPayments.status, ["paid", "completed"]),
          gte(rentPayments.paidDate, format(periodStart, "yyyy-MM-dd")),
          lte(rentPayments.paidDate, format(periodEnd,   "yyyy-MM-dd")),
        ))
    : [];

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
    const statementNumber = await nextStatementNumber();
    [statement] = await db.insert(ownerStatements).values({
      organizationId: orgId,
      pmAgreementId:  agreement.id,
      propertyId,
      ownerUserId:    agreement.ownerUserId,
      statementNumber,
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
    } as any).returning();
  }

  return { statement, property: prop, owner, agreement };
}

// ── Main monthly job ──────────────────────────────────────────────────────────

export async function runMonthlyReportJob(): Promise<void> {
  // Report for the previous calendar month
  const now       = new Date();
  const lastMonth = subMonths(now, 1);
  const year      = lastMonth.getFullYear();
  const month     = lastMonth.getMonth() + 1; // 1-based
  const periodLabel = format(lastMonth, "MMMM yyyy");

  log(`Starting monthly report job for ${periodLabel}`);

  // All orgs with reporting enabled
  const allSettings = await db
    .select()
    .from(organizationSettings);

  const enabledOrgIds: number[] = allSettings
    .filter(s => {
      const es = (s.emailSettings as any) ?? {};
      return es?.reportSchedule?.enabled === true;
    })
    .map(s => s.organizationId);

  if (enabledOrgIds.length === 0) {
    log("No organisations have scheduled reporting enabled — nothing to do");
    return;
  }

  log(`Processing ${enabledOrgIds.length} organisation(s): [${enabledOrgIds.join(", ")}]`);

  // Org names (for email branding)
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, enabledOrgIds));

  const orgNameMap = new Map(orgs.map(o => [o.id, o.name]));

  let totalSent    = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;

  for (const orgId of enabledOrgIds) {
    const orgName = orgNameMap.get(orgId) ?? `Org #${orgId}`;
    log(`\nOrg: ${orgName} (#${orgId})`);

    // Org settings (for timezone / currency)
    const [orgSettings] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, orgId))
      .limit(1);

    const emailSettings = (orgSettings?.emailSettings as any) ?? {};

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
        const result = await generateStatement(orgId, propertyId, year, month);
        if (!result) { totalSkipped++; continue; }

        const { statement, property: prop, owner, agreement } = result;

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
        totalSent++;
      } catch (err: any) {
        log(`  ✗ Error for property #${propertyId}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  log(`\nJob complete — sent: ${totalSent}, skipped: ${totalSkipped}, errors: ${totalErrors}`);
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

export function startReportScheduler(): void {
  log("Report scheduler initialised");

  const schedule = async () => {
    const delay = msUntilNextMonthlyRun(5, 8, 0); // 5th of month, 08:00 EAT
    const days  = Math.round(delay / 86_400_000);
    log(`Next run in ~${days} day(s) (5th of the month at 08:00 EAT)`);

    setTimeout(async () => {
      try {
        await runMonthlyReportJob();
      } catch (err) {
        log(`Top-level error in monthly job: ${err}`);
      }
      // Reschedule for next month
      schedule();
    }, delay);
  };

  schedule();
}
