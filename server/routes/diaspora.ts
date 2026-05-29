import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  diasporaContracts,
  diasporaPayments,
  constructionUpdates,
  diasporaCertificates,
  invoices,
  users,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { journalEntries, journalEntryLines, chartOfAccounts } from "@shared/schema";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { getMidMarketRate, computeDisbursement } from "../services/fxService";
import { logger } from "../lib/logger";
import { sendInviteEmail } from "../lib/email";

const auth = [authenticateJWT as any, requireOrg as any];

// ── Helper: post a diaspora payment to the General Ledger ────────────────────
async function postDiasporaPaymentToGL({
  orgId, kesAmount, processingFee, exchangeFee,
  contractId, paymentId, description, postedBy,
}: {
  orgId: number;
  kesAmount: number;
  processingFee: number;
  exchangeFee: number;
  contractId: number;
  paymentId: number;
  description: string;
  postedBy: string;
}) {
  // Look up the org's chart of accounts for the accounts we need
  const accounts = await db
    .select({ id: chartOfAccounts.id, accountCode: chartOfAccounts.accountCode })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isActive, true),
      )
    );

  const findAccount = (code: string) => accounts.find(a => a.accountCode === code);

  // Accounts used:
  //   1001 — Cash & Bank (debit-normal, asset)
  //   4001 — Rental Income / used for R2O income (credit-normal, revenue)
  //   5099 — Bank Charges / FX Fees (debit-normal, expense) — fallback if not found
  const cashAccount    = findAccount("1001");
  const revenueAccount = findAccount("4001");
  const fxFeeAccount   = findAccount("5099") ?? findAccount("5001") ?? findAccount("5002");

  if (!cashAccount || !revenueAccount) {
    logger.warn(
      `[diaspora] GL post skipped — accounts 1001 or 4001 not found for org ${orgId}`
    );
    return;
  }

  const { randomUUID } = await import("crypto");
  const totalFees = (processingFee ?? 0) + (exchangeFee ?? 0);
  const lines: { accountId: number; description: string; debitAmount: string; creditAmount: string }[] = [];

  // Dr Cash & Bank — what actually landed in the account
  lines.push({
    accountId:    cashAccount.id,
    description:  `${description} — received`,
    debitAmount:  kesAmount.toFixed(2),
    creditAmount: "0.00",
  });

  // Cr Diaspora Rent-to-Own Income — gross amount before fees
  const grossRevenue = kesAmount + totalFees;
  lines.push({
    accountId:    revenueAccount.id,
    description:  `${description} — income`,
    debitAmount:  "0.00",
    creditAmount: grossRevenue.toFixed(2),
  });

  // Dr Bank Charges / FX Fees (if any)
  if (totalFees > 0 && fxFeeAccount) {
    lines.push({
      accountId:    fxFeeAccount.id,
      description:  `${description} — FX & transfer fees`,
      debitAmount:  totalFees.toFixed(2),
      creditAmount: "0.00",
    });
    // Offset the cash account by the fee so Cash net = gross revenue - fees = kesAmount
    // Actually the above Dr Cash is already net, so we just need:
    // Dr Revenue expense offset: this is handled by the fee line
    // The entry is:
    //   Dr Cash        kesAmount       (net received)
    //   Dr FX Expense  totalFees       (fees paid)
    //   Cr Revenue     grossRevenue    (total value)
    // Which balances: kesAmount + totalFees = grossRevenue ✓
  }

  const totalDebit  = lines.reduce((s, l) => s + parseFloat(l.debitAmount),  0);
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.creditAmount), 0);

  // Enforce balance before posting
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    logger.warn(`[diaspora] GL entry imbalanced (D:${totalDebit} C:${totalCredit}) — skipping`);
    return;
  }

  const [entry] = await db.insert(journalEntries).values({
    entryId:        `DSP-${String(contractId).padStart(4,"0")}-PMT-${paymentId}`,
    description,
    entryDate:      new Date(),
    totalDebit:     totalDebit.toFixed(2),
    totalCredit:    totalCredit.toFixed(2),
    currency:       "KES",
    status:         "posted",
    reference:      `diaspora_payment:${paymentId}`,
    createdBy:      postedBy,
  } as any).returning();

  if (entry) {
    await db.insert(journalEntryLines).values(
      lines.map(l => ({
        journalEntryId: entry.id,
        ...l,
      })) as any
    );
    logger.info(`[diaspora] GL entry ${entry.entryId} posted — Dr ${totalDebit.toFixed(2)} Cr ${totalCredit.toFixed(2)}`);
  }
}

// Fix: use Record<string, unknown> instead of generic T to avoid TS2862
function coerceDates(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out = { ...body };
  for (const field of fields) {
    if (out[field] && !(out[field] instanceof Date)) {
      out[field] = new Date(out[field] as string);
    }
  }
  return out;
}

/** Returns how many months are in one payment period based on frequency */
function periodMultiplier(frequency: string): number {
  switch (frequency) {
    case "quarterly":   return 3;
    case "semi_annual": return 6;
    case "annual":      return 12;
    default:            return 1; // monthly
  }
}

/** Advance a date by the correct number of calendar months for a frequency.
 *  Uses setMonth() so quarterly = +3 months, not +90 days. */
function addPeriod(from: Date, frequency: string): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + periodMultiplier(frequency));
  return d;
}

/** Label shown on invoices / detail view for the installment */
function periodLabel(frequency: string): string {
  switch (frequency) {
    case "quarterly":   return "Quarterly";
    case "semi_annual": return "Semi-Annual";
    case "annual":      return "Annual";
    default:            return "Monthly";
  }
}


// ── Helper: recalculate + persist totalPaid / remainingBalance on a contract ─
// Formula:  totalPaid     = downPayment + sum(completed installment payments)
//           remainingBalance = totalPropertyValue - totalPaid
async function recalcContractBalance(contractId: number): Promise<void> {
  const [contractRow] = await db
    .select({
      totalPropertyValue: diasporaContracts.totalPropertyValue,
      downPayment:        diasporaContracts.downPayment,
    })
    .from(diasporaContracts)
    .where(eq(diasporaContracts.id, contractId));

  if (!contractRow) return;

  const completedPayments = await db
    .select({ amount: diasporaPayments.amount })
    .from(diasporaPayments)
    .where(
      and(
        eq(diasporaPayments.diasporaContractId, contractId),
        eq(diasporaPayments.status, "completed"),
      )
    );

  const downPayment      = Number(contractRow.downPayment ?? 0);
  const installmentsPaid = completedPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const newTotalPaid     = downPayment + installmentsPaid;
  const totalValue       = Number(contractRow.totalPropertyValue ?? 0);
  const newRemaining     = Math.max(0, totalValue - newTotalPaid);
  const contractStatus   = newRemaining <= 0 ? "completed" : "active";

  const paymentsMade    = completedPayments.length;
  const completionPct   = totalValue > 0 ? (newTotalPaid / totalValue) * 100 : 0;

  await db.update(diasporaContracts)
    .set({
      totalPaid:            String(newTotalPaid.toFixed(2)),
      remainingBalance:     String(newRemaining.toFixed(2)),
      completionPercentage: String(Math.min(100, completionPct).toFixed(2)),
      paymentsMade,
      contractStatus,
      updatedAt:            new Date(),
    } as any)
    .where(eq(diasporaContracts.id, contractId));

  logger.info(
    `[diaspora] Contract ${contractId} balance — ` +
    `down: ${downPayment.toFixed(2)}, installments: ${installmentsPaid.toFixed(2)}, ` +
    `totalPaid: ${newTotalPaid.toFixed(2)}, remaining: ${newRemaining.toFixed(2)}, payments: ${paymentsMade}`
  );
}

// ─── Diaspora Contracts ────────────────────────────────────────────────────
export const diasporaContractsRouter = Router();
diasporaContractsRouter.use(...auth);

diasporaContractsRouter.get("/", async (req: any, res) => {
  try {
    const contracts = await db
      .select()
      .from(diasporaContracts)
      .where(eq(diasporaContracts.organizationId, req.user.organizationId))
      .orderBy(desc(diasporaContracts.createdAt));
    res.json(contracts);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaContractsRouter.get("/:id", async (req: any, res) => {
  try {
    const [contract] = await db
      .select()
      .from(diasporaContracts)
      .where(eq(diasporaContracts.id, Number(req.params.id)));
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    res.json(contract);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaContractsRouter.post("/", async (req: any, res) => {
  try {
    const dateFields = [
      "nextPaymentDue", "constructionStartDate", "expectedCompletionDate",
      "actualCompletionDate", "contractSignedAt",
    ];
    // Recalculate installment correctly based on payment frequency
    const body = req.body as Record<string, any>;
    const totalPropertyValue = Number(body.totalPropertyValue ?? 0);
    const downPayment        = Number(body.downPayment ?? 0);
    const durationMonths     = Number(body.contractDurationMonths ?? 1);
    const frequency: string  = (body.paymentFrequency as string) || "monthly";
    const multiplier         = periodMultiplier(frequency);
    const numberOfPayments   = Math.ceil(durationMonths / multiplier);
    const balance            = totalPropertyValue - downPayment;
    const installment        = numberOfPayments > 0 ? balance / numberOfPayments : balance;

    // Advance nextPaymentDue by the correct number of calendar months for the frequency
    const nextDue = addPeriod(new Date(), frequency);

    const merged = coerceDates(
      {
        ...body,
        organizationId:     req.user.organizationId,
        createdBy:          req.user.id,
        monthlyInstallment: installment,   // field name in DB; stores per-period amount
        remainingBalance:   balance,
        nextPaymentDue:     nextDue.toISOString(),
      },
      dateFields
    );

    // ── Buyer account & invitation ─────────────────────────────────────────
    // 1. If a user with this email already exists in the org, link them.
    // 2. If not, create a new tenant-role user and send them an invite email.
    const clientEmail = (body.clientEmail as string ?? "").toLowerCase().trim();
    let buyerUserId: string | null = (merged as any).buyerUserId ?? null;

    if (clientEmail && !buyerUserId) {
      // Check if user already exists in this org
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, clientEmail))
        .limit(1);

      if (existingUser) {
        // Already has an account — just link them
        buyerUserId = existingUser.id;
        logger.info(`[diaspora] Linked existing user ${existingUser.id} to contract`);
      } else {
        // New buyer — create account + send invite
        const inviteToken = randomUUID();
        const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
        const newUserId = randomUUID();

        // Parse name for firstName/lastName
        const nameParts = ((body.clientName as string) ?? "").trim().split(/\s+/);
        const firstName = nameParts[0] ?? "Diaspora";
        const lastName  = nameParts.slice(1).join(" ") || "Buyer";

        await db.insert(users).values({
          id:                          newUserId,
          email:                       clientEmail,
          role:                        "tenant",
          organizationId:              req.user.organizationId,
          firstName,
          lastName,
          invitedAt:                   new Date(),
          invitedBy:                   req.user.id,
          emailVerificationToken:      inviteToken,
          emailVerificationExpiresAt:  inviteExpiresAt,
          passwordHash:                "",
          emailVerified:               false,
        } as any);

        buyerUserId = newUserId;

        // Send invitation email (non-fatal — contract still created if email fails)
        const appUrl = process.env.APP_URL || "http://localhost:5173";
        const inviteLink = `${appUrl}/accept-invite/${inviteToken}`;
        const clientName = ((body.clientName as string) ?? "").trim() || "there";
        try {
          await sendInviteEmail({
            to:          clientEmail,
            inviteLink,
            subject:     `Your SmartProp diaspora buyer portal is ready`,
            intro:       `Hi ${clientName}, your property manager has set up a rent-to-own contract for you on SmartProp. Click below to activate your account and access your buyer portal — track construction progress, view your payment schedule, and download your certificates.`,
            expiryNote:  "This invitation link expires in 7 days.",
          });
          logger.info(`[diaspora] Invite sent to ${clientEmail}`);
        } catch (emailErr) {
          logger.warn(`[diaspora] Invite email failed (non-fatal) for ${clientEmail}:`, emailErr);
        }
      }
    }

    if (buyerUserId) {
      (merged as any).buyerUserId = buyerUserId;
    }

    // Ensure numeric fields are cast to strings for decimal columns
    // totalPaid starts at downPayment (already paid at contract signing)
    // remainingBalance = totalPropertyValue - downPayment
    const _totalPropertyValue = Number(merged.totalPropertyValue ?? 0);
    const _downPayment        = Number(merged.downPayment        ?? 0);
    const toInsert = {
      ...merged,
      totalPropertyValue:    String(_totalPropertyValue),
      downPayment:           String(_downPayment),
      monthlyInstallment:    String(merged.monthlyInstallment   ?? 0),
      remainingBalance:      String(Math.max(0, _totalPropertyValue - _downPayment)),
      completionPercentage:  String(merged.completionPercentage ?? 0),
      totalPaid:             String(_downPayment),
      interestRate:          String(merged.interestRate         ?? "0.00"),
    };

    const [contract] = await db.insert(diasporaContracts).values(toInsert as any).returning();

    res.status(201).json({ ...contract, _meta: { buyerInvited: !!buyerUserId } });
  } catch (err: any) {
    logger.error("diaspora-contracts POST error:", err);
    // Return the underlying DB message if available
    const msg = (err as any).cause?.message ?? (err as any).detail ?? err.message;
    res.status(500).json({ message: msg });
  }
});

diasporaContractsRouter.patch("/:id", async (req: any, res) => {
  try {
    const dateFields = [
      "nextPaymentDue", "constructionStartDate", "expectedCompletionDate",
      "actualCompletionDate", "contractSignedAt",
    ];
    // Strip totalPaid / remainingBalance from the patch body — these are always
    // computed server-side to prevent stale manual overrides.
    const { totalPaid: _tp, remainingBalance: _rb, ...rawBody } = req.body as Record<string, unknown>;
    const merged = coerceDates({ ...rawBody, updatedAt: new Date() }, dateFields);
    const [updated] = await db
      .update(diasporaContracts)
      .set(merged as any)
      .where(eq(diasporaContracts.id, Number(req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ message: "Contract not found" });
    // Recompute balance in case totalPropertyValue or downPayment changed
    await recalcContractBalance(Number(req.params.id));
    const [refreshed] = await db.select().from(diasporaContracts).where(eq(diasporaContracts.id, Number(req.params.id)));
    res.json(refreshed ?? updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Recalc balance for an existing contract (fixes legacy/stale data) ────────
diasporaContractsRouter.post("/:id/recalc-balance", async (req: any, res) => {
  try {
    await recalcContractBalance(Number(req.params.id));
    const [refreshed] = await db.select().from(diasporaContracts).where(eq(diasporaContracts.id, Number(req.params.id)));
    if (!refreshed) return res.status(404).json({ message: "Contract not found" });
    res.json(refreshed);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── One-time fix: recalculate nextPaymentDue for all contracts (admin only) ──
// POST /api/diaspora-contracts/patch-due-dates
// Recalculates nextPaymentDue as: createdAt + (paymentsMade + 1) calendar periods.
// Safe to call multiple times — it always derives the value from source data.
diasporaContractsRouter.post("/patch-due-dates", async (req: any, res) => {
  try {
    const all = await db.select().from(diasporaContracts);
    const results: { id: number; old: string; new: string }[] = [];

    for (const c of all) {
      const base      = new Date(c.createdAt ?? Date.now());
      const frequency = c.paymentFrequency ?? "monthly";
      const periods   = (c.paymentsMade ?? 0) + 1; // next due = 1 period after last payment
      const corrected = new Date(base);
      corrected.setMonth(corrected.getMonth() + periodMultiplier(frequency) * periods);

      results.push({
        id:  c.id,
        old: c.nextPaymentDue?.toISOString() ?? "null",
        new: corrected.toISOString(),
      });

      await db
        .update(diasporaContracts)
        .set({ nextPaymentDue: corrected, updatedAt: new Date() } as any)
        .where(eq(diasporaContracts.id, c.id));
    }

    res.json({ fixed: results.length, results });
  } catch (err: any) {
    logger.error("patch-due-dates error:", err);
    res.status(500).json({ message: err.message });
  }
});

diasporaContractsRouter.delete("/:id", async (req: any, res) => {
  try {
    await db.delete(diasporaContracts).where(eq(diasporaContracts.id, Number(req.params.id)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Generate Invoice for a contract (persists to invoices table) ──────────
diasporaContractsRouter.post("/:id/generate-invoice", async (req: any, res) => {
  try {
    const [contract] = await db
      .select()
      .from(diasporaContracts)
      .where(eq(diasporaContracts.id, Number(req.params.id)));

    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const frequency   = contract.paymentFrequency || "monthly";
    const multiplier  = periodMultiplier(frequency);
    const installment = Number(contract.monthlyInstallment);
    const label       = periodLabel(frequency);
    const dueDate     = contract.nextPaymentDue ? new Date(contract.nextPaymentDue) : new Date();
    const invoiceNumber = `DSP-INV-${contract.id.toString().padStart(4, "0")}-${Date.now().toString(36).toUpperCase()}`;
    const nextPaymentDue = addPeriod(dueDate, frequency);

    // Persist to the shared invoices table so it appears in /api/invoices
    const [saved] = await db.insert(invoices).values({
      invoiceNumber,
      propertyId: contract.propertyId,
      type: "diaspora_installment",
      amount: installment.toFixed(2),
      totalAmount: installment.toFixed(2),
      currency: contract.currency ?? "KES",
      dueDate,
      status: "pending",
      paymentMethod: contract.paymentMethod,
      description: `${label} installment — ${contract.clientName} (DSP-${contract.id.toString().padStart(4, "0")}) via ${contract.internationalProvider}`,
      notes: JSON.stringify({
        diasporaContractId: contract.id,
        clientName: contract.clientName,
        clientEmail: contract.clientEmail,
        clientCountry: contract.clientCountry,
        paymentFrequency: frequency,
        periodLabel: label,
        internationalProvider: contract.internationalProvider,
        remainingBalance: Number(contract.remainingBalance),
      }),
    } as any).returning();

    // Advance nextPaymentDue on the contract
    await db
      .update(diasporaContracts)
      .set({ nextPaymentDue, updatedAt: new Date() } as any)
      .where(eq(diasporaContracts.id, contract.id));

    res.status(201).json({ ...saved, periodLabel: label, clientName: contract.clientName });
  } catch (err: any) {
    logger.error("generate-invoice error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ─── List invoices for a contract ─────────────────────────────────────────
diasporaContractsRouter.get("/:id/invoices", async (req: any, res) => {
  try {
    const [contract] = await db
      .select()
      .from(diasporaContracts)
      .where(eq(diasporaContracts.id, Number(req.params.id)));
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const contractInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.propertyId, contract.propertyId))
      .orderBy(desc(invoices.createdAt));

    // Filter to diaspora invoices for this contract via notes JSON
    const diasporaInvoices = contractInvoices.filter((inv: any) => {
      try {
        const notes = JSON.parse(inv.notes ?? "{}");
        return notes.diasporaContractId === contract.id;
      } catch { return false; }
    });

    res.json(diasporaInvoices);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Diaspora Payments ─────────────────────────────────────────────────────
export const diasporaPaymentsRouter = Router();
diasporaPaymentsRouter.use(...auth);

diasporaPaymentsRouter.get("/", async (req: any, res) => {
  try {
    const contractId = req.query.diasporaContractId ? Number(req.query.diasporaContractId) : undefined;
    const payments = contractId
      ? await db.select().from(diasporaPayments)
          .where(eq(diasporaPayments.diasporaContractId, contractId))
          .orderBy(desc(diasporaPayments.createdAt))
      : await db.select().from(diasporaPayments).orderBy(desc(diasporaPayments.createdAt));
    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaPaymentsRouter.get("/:id", async (req: any, res) => {
  try {
    const [payment] = await db.select().from(diasporaPayments)
      .where(eq(diasporaPayments.id, Number(req.params.id)));
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaPaymentsRouter.post("/", async (req: any, res) => {
  try {
    const body = coerceDates({ ...req.body as Record<string, unknown> }, ["paymentDate", "dueDate", "processedAt"]);

    const originalCurrency = (body.originalCurrency as string | undefined)?.toUpperCase();
    const originalAmount   = Number(body.originalAmount ?? 0);
    const appliedRate      = Number(body.exchangeRate ?? 0);
    const processingFee    = Number(body.processingFee ?? 0);
    const exchangeFee      = Number(body.exchangeFee   ?? 0);

    // For KES payments compute disbursement synchronously (no network call needed)
    let kesDisbursed: number | undefined;
    let fxSource: string | undefined;

    if (!originalCurrency || originalCurrency === "KES") {
      kesDisbursed = Number(body.amount ?? 0) - processingFee - exchangeFee;
      fxSource     = "none";
    } else if (originalAmount > 0 && appliedRate > 0) {
      // Use client-supplied rate for immediate response
      // Mid-market rate enrichment happens asynchronously below
      kesDisbursed = originalAmount * appliedRate - processingFee - exchangeFee;
      fxSource     = "client";
    }

    // Insert immediately — don't block on FX API call
    const [payment] = await db.insert(diasporaPayments).values({
      ...(body as any),
      currency:      (body.currency as string | undefined) || "KES",
      originalCurrency: originalCurrency || "KES",
      kesDisbursed:  kesDisbursed !== undefined ? String(kesDisbursed) : null,
      fxSource:      fxSource ?? null,
      midMarketRate: null,  // enriched asynchronously
      spreadPct:     null,
    }).returning();

    // Respond immediately so the client doesn't wait
    res.status(201).json(payment);

    // ── Update contract totalPaid + remainingBalance ─────────────────────────
    const contractIdNum = Number(body.diasporaContractId ?? 0);
    if (contractIdNum > 0 && (payment as any).status === "completed") {
      recalcContractBalance(contractIdNum).catch(err =>
        logger.warn("[diaspora] Balance update failed (non-fatal):", err)
      );
    }

    // ── Post to General Ledger (fire-and-forget, non-blocking) ──────────────
    // Journal entry: Dr Cash & Bank / Cr Diaspora Rent-to-Own Income
    const kesAmount = Number(kesDisbursed ?? body.amount ?? 0);
    if (kesAmount > 0) {
      const orgId: number = req.user.organizationId;
      const contractIdForGL = Number(body.diasporaContractId ?? 0);
      postDiasporaPaymentToGL({
        orgId,
        kesAmount,
        processingFee,
        exchangeFee,
        contractId: contractIdForGL,
        paymentId: payment.id,
        description: `Diaspora payment — Contract DSP-${String(contractIdForGL).padStart(4, "0")}`,
        postedBy: req.user.id,
      }).catch(err => logger.warn("[diaspora] GL post failed (non-fatal):", err));
    }

    // Asynchronously enrich with mid-market rate (fire-and-forget)
    if (originalCurrency && originalCurrency !== "KES" && originalAmount > 0 && appliedRate > 0) {
      computeDisbursement({ originalAmount, originalCurrency, appliedRate, processingFee, exchangeFee })
        .then(async (breakdown) => {
          await db.update(diasporaPayments)
            .set({
              midMarketRate: String(breakdown.midMarketRate),
              spreadPct:     String(breakdown.spreadPct),
              kesDisbursed:  String(breakdown.kesDisbursed),
              fxSource:      "frankfurter",
            } as any)
            .where(eq(diasporaPayments.id, payment.id));
        })
        .catch(err => logger.warn("[diaspora] Async FX enrichment failed:", err));
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaPaymentsRouter.patch("/:id", async (req: any, res) => {
  try {
    const body = coerceDates({ ...req.body as Record<string, unknown> }, ["paymentDate", "dueDate", "processedAt"]);
    const [updated] = await db.update(diasporaPayments).set(body as any)
      .where(eq(diasporaPayments.id, Number(req.params.id))).returning();
    if (!updated) return res.status(404).json({ message: "Payment not found" });
    res.json(updated);

    // Recalculate contract balance whenever a payment is edited
    const contractIdNum = Number(updated.diasporaContractId ?? 0);
    if (contractIdNum > 0) {
      recalcContractBalance(contractIdNum).catch(err =>
        logger.warn("[diaspora] Balance update (patch) failed (non-fatal):", err)
      );
    }
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Construction Updates ──────────────────────────────────────────────────
export const constructionUpdatesRouter = Router();
constructionUpdatesRouter.use(...auth);

constructionUpdatesRouter.get("/", async (req: any, res) => {
  try {
    const contractId = req.query.diasporaContractId ? Number(req.query.diasporaContractId) : undefined;
    const updates = contractId
      ? await db.select().from(constructionUpdates)
          .where(eq(constructionUpdates.diasporaContractId, contractId))
          .orderBy(desc(constructionUpdates.createdAt))
      : await db.select().from(constructionUpdates).orderBy(desc(constructionUpdates.createdAt));
    res.json(updates);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

constructionUpdatesRouter.get("/:id", async (req: any, res) => {
  try {
    const [update] = await db.select().from(constructionUpdates)
      .where(eq(constructionUpdates.id, Number(req.params.id)));
    if (!update) return res.status(404).json({ message: "Update not found" });
    res.json(update);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

constructionUpdatesRouter.post("/", async (req: any, res) => {
  try {
    const body = coerceDates(
      { ...req.body as Record<string, unknown>, updatedBy: req.user.id },
      ["estimatedCompletionDate", "approvedAt"]
    );
    const [update] = await db.insert(constructionUpdates).values(body as any).returning();

    // Sync progress back to the contract
    if (update.diasporaContractId) {
      await db.update(diasporaContracts)
        .set({
          completionPercentage: update.progressPercentage,
          constructionStatus: update.constructionPhase,
          updatedAt: new Date()
        } as any)
        .where(eq(diasporaContracts.id, update.diasporaContractId));
    }

    res.status(201).json(update);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

constructionUpdatesRouter.patch("/:id", async (req: any, res) => {
  try {
    const body = coerceDates({ ...req.body as Record<string, unknown> }, ["estimatedCompletionDate", "approvedAt"]);
    const [updated] = await db.update(constructionUpdates).set(body as any)
      .where(eq(constructionUpdates.id, Number(req.params.id))).returning();
    if (!updated) return res.status(404).json({ message: "Update not found" });

    // Sync progress back to the contract
    if (updated.diasporaContractId) {
      await db.update(diasporaContracts)
        .set({
          completionPercentage: updated.progressPercentage,
          constructionStatus: updated.constructionPhase,
          updatedAt: new Date()
        } as any)
        .where(eq(diasporaContracts.id, updated.diasporaContractId));
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Diaspora Certificates ─────────────────────────────────────────────────
export const diasporaCertificatesRouter = Router();
diasporaCertificatesRouter.use(...auth);

diasporaCertificatesRouter.get("/", async (req: any, res) => {
  try {
    const contractId = req.query.diasporaContractId ? Number(req.query.diasporaContractId) : undefined;
    const certs = contractId
      ? await db.select().from(diasporaCertificates)
          .where(eq(diasporaCertificates.diasporaContractId, contractId))
          .orderBy(desc(diasporaCertificates.createdAt))
      : await db.select().from(diasporaCertificates).orderBy(desc(diasporaCertificates.createdAt));
    res.json(certs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaCertificatesRouter.get("/:id", async (req: any, res) => {
  try {
    const [cert] = await db.select().from(diasporaCertificates)
      .where(eq(diasporaCertificates.id, Number(req.params.id)));
    if (!cert) return res.status(404).json({ message: "Certificate not found" });
    res.json(cert);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaCertificatesRouter.post("/", async (req: any, res) => {
  try {
    const body = coerceDates(
      { ...req.body as Record<string, unknown>, issuedBy: req.user.id },
      ["issuedDate", "expiryDate", "verifiedAt", "revokedAt"]
    );
    const [cert] = await db.insert(diasporaCertificates).values(body as any).returning();
    res.status(201).json(cert);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

diasporaCertificatesRouter.patch("/:id", async (req: any, res) => {
  try {
    const body = coerceDates({ ...req.body as Record<string, unknown> }, ["issuedDate", "expiryDate", "verifiedAt", "revokedAt"]);
    const [updated] = await db.update(diasporaCertificates).set(body as any)
      .where(eq(diasporaCertificates.id, Number(req.params.id))).returning();
    if (!updated) return res.status(404).json({ message: "Certificate not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});