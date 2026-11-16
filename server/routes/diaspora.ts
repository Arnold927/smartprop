import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { db } from "../db";
import {
  diasporaContracts,
  diasporaPayments,
  constructionUpdates,
  diasporaCertificates,
  invoices,
  properties,
} from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { computeDisbursement } from "../services/fxService";
import { logger } from "../lib/logger";
import { issueInvite, deliverInvite, InviteConflictError, type IssuedInvite } from "../utils/invites";
import { postSaleReceipt, reverseSaleReceipt, saleEpisode } from "../services/sale-ledger";

const auth = [authenticateJWT as any, requireOrg as any];

// ── Shared vocabulary ────────────────────────────────────────────────────────
const FREQUENCIES = ["monthly", "quarterly", "semi_annual", "annual"];
const CONSTRUCTION_PHASES = ["planning", "foundation", "structure", "roofing", "finishing", "completed"];
const PAYMENT_STATUSES = ["pending", "processing", "completed", "failed", "refunded", "disputed"];
const CERT_TYPES = ["ownership", "payment", "completion"];
const CERT_STATUSES = ["pending", "issued", "verified", "expired", "revoked"];
const CONTRACT_STATUSES = ["active", "suspended", "cancelled"]; // "completed" is derived from the balance
const MAX_AMOUNT = 100_000_000_000;
const EPS = 0.01;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const asNum = (v: unknown): number => (v === undefined || v === null || String(v).trim() === "" ? NaN : Number(v));
const posId = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const validDate = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "" && !Number.isNaN(new Date(String(v)).getTime());
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const clean = (v: unknown, max = 255): string | null => { const t = String(v ?? "").trim(); return t ? t.slice(0, max) : null; };

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
function fail(res: any, err: any, tag: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  logger.error(`[diaspora] ${tag}:`, err);
  return res.status(500).json({ message: err?.cause?.message ?? err?.message ?? "Something went wrong" });
}

function coerceDates(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out = { ...body };
  for (const field of fields) {
    if (out[field] && !(out[field] instanceof Date)) out[field] = new Date(out[field] as string);
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

/** Advance a date by the correct number of calendar months for a frequency (quarterly = +3 months, not +90 days). */
function addPeriod(from: Date, frequency: string): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + periodMultiplier(frequency));
  return d;
}

function periodLabel(frequency: string): string {
  switch (frequency) {
    case "quarterly":   return "Quarterly";
    case "semi_annual": return "Semi-Annual";
    case "annual":      return "Annual";
    default:            return "Monthly";
  }
}

/** The contract, only if it belongs to the caller's organisation. */
async function ownContract(id: unknown, orgId: number, ex: any = db) {
  const n = posId(id);
  if (!n) return null;
  const [c] = await ex.select().from(diasporaContracts)
    .where(and(eq(diasporaContracts.id, n), eq(diasporaContracts.organizationId, orgId))).limit(1);
  return c ?? null;
}

/** Ids of the organisation's contracts (used to scope payment / update / certificate lists). */
async function orgContractIds(orgId: number): Promise<number[]> {
  const rows = await db.select({ id: diasporaContracts.id }).from(diasporaContracts).where(eq(diasporaContracts.organizationId, orgId));
  return rows.map(r => r.id);
}

// ── Recalculate + persist totalPaid / remainingBalance on a contract ─────────
// totalPaid = downPayment + completed instalments;  remainingBalance = totalPropertyValue − totalPaid.
// completionPercentage is PAYMENT progress (what the buyer portal labels "Payment progress").
// A cancelled or suspended contract keeps its status; only active ⇄ completed is derived from the balance.
async function recalcContractBalance(contractId: number, ex: any = db): Promise<void> {
  const [row] = await ex.select().from(diasporaContracts).where(eq(diasporaContracts.id, contractId));
  if (!row) return;
  const completed = await ex.select({ amount: diasporaPayments.amount }).from(diasporaPayments)
    .where(and(eq(diasporaPayments.diasporaContractId, contractId), eq(diasporaPayments.status, "completed")));

  const downPayment = Number(row.downPayment ?? 0);
  const paidInstalments = completed.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
  const totalPaid = round2(downPayment + paidInstalments);
  const totalValue = Number(row.totalPropertyValue ?? 0);
  const remaining = Math.max(0, round2(totalValue - totalPaid));
  const pct = totalValue > 0 ? Math.min(100, (totalPaid / totalValue) * 100) : 0;
  const derived = remaining <= EPS ? "completed" : "active";
  const status = row.status === "cancelled" || row.status === "suspended" ? row.status : derived;

  await ex.update(diasporaContracts).set({
    totalPaid: totalPaid.toFixed(2),
    remainingBalance: remaining.toFixed(2),
    completionPercentage: pct.toFixed(2),
    paymentsMade: completed.length,
    status,
    updatedAt: new Date(),
  } as any).where(eq(diasporaContracts.id, contractId));
}

/** Per-period instalment for the terms given. Interest is not added: the buyer pays the agreed price in equal instalments. */
function installmentFor(total: number, down: number, months: number, frequency: string): number {
  const periods = Math.max(1, Math.ceil(months / periodMultiplier(frequency)));
  return round2(Math.max(0, total - down) / periods);
}

// ─── Diaspora Contracts ────────────────────────────────────────────────────
export const diasporaContractsRouter = Router();
diasporaContractsRouter.use(...auth);

/** Latest construction progress per contract, so the contract can show it without borrowing the payment field. */
async function constructionProgressFor(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const rows = await db.select({
    cid: constructionUpdates.diasporaContractId, pct: constructionUpdates.progressPercentage, id: constructionUpdates.id,
  }).from(constructionUpdates).where(inArray(constructionUpdates.diasporaContractId, ids)).orderBy(desc(constructionUpdates.id));
  for (const r of rows) if (!out.has(r.cid)) out.set(r.cid, Number(r.pct ?? 0));
  return out;
}

diasporaContractsRouter.get("/", async (req: any, res) => {
  try {
    const contracts = await db.select().from(diasporaContracts)
      .where(eq(diasporaContracts.organizationId, req.user.organizationId))
      .orderBy(desc(diasporaContracts.createdAt));
    const prog = await constructionProgressFor(contracts.map(c => c.id));
    res.json(contracts.map(c => ({ ...c, constructionProgress: prog.get(c.id) ?? 0 })));
  } catch (err) { fail(res, err, "list contracts"); }
});

diasporaContractsRouter.get("/:id", async (req: any, res) => {
  try {
    const contract = await ownContract(req.params.id, req.user.organizationId);
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    const prog = await constructionProgressFor([contract.id]);
    res.json({ ...contract, constructionProgress: prog.get(contract.id) ?? 0 });
  } catch (err) { fail(res, err, "get contract"); }
});

diasporaContractsRouter.post("/", async (req: any, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, any>;
    const orgId: number = req.user.organizationId;

    // ── Required fields — a half-filled form is a clear 400, before any buyer login is created.
    const REQUIRED: [string, string][] = [
      ["propertyId", "property"], ["clientName", "buyer name"], ["clientEmail", "buyer email"],
      ["clientPhone", "buyer phone"], ["clientWhatsapp", "buyer WhatsApp number"], ["clientCountry", "buyer country"],
      ["totalPropertyValue", "total property value"], ["contractDurationMonths", "contract duration"],
      ["paymentMethod", "payment method"], ["internationalProvider", "international payment provider"],
    ];
    const missing = REQUIRED.filter(([k]) => body[k] === undefined || body[k] === null || String(body[k]).trim() === "").map(([, l]) => l);
    if (missing.length) return res.status(400).json({ message: `Please fill in: ${missing.join(", ")}.` });

    const total = asNum(body.totalPropertyValue);
    const down = body.downPayment === undefined || body.downPayment === "" || body.downPayment === null ? 0 : asNum(body.downPayment);
    const months = asNum(body.contractDurationMonths);
    const frequency = String(body.paymentFrequency || "monthly");
    if (!(total > 0) || total > MAX_AMOUNT) return res.status(400).json({ message: "Total property value must be a positive amount." });
    if (Number.isNaN(down) || down < 0) return res.status(400).json({ message: "Down payment cannot be negative." });
    if (down >= total) return res.status(400).json({ message: "The down payment must be less than the total property value — otherwise there is nothing left to pay in instalments." });
    if (!Number.isInteger(months) || months < 1 || months > 600) return res.status(400).json({ message: "Contract duration must be a whole number of months between 1 and 600." });
    if (!FREQUENCIES.includes(frequency)) return res.status(400).json({ message: `Payment frequency must be one of: ${FREQUENCIES.join(", ")}.` });
    const clientEmail = String(body.clientEmail).toLowerCase().trim();
    if (!emailOk(clientEmail)) return res.status(400).json({ message: "Enter a valid buyer email address." });
    for (const f of ["contractSignedAt", "constructionStartDate", "expectedCompletionDate"]) {
      if (body[f] && !validDate(body[f])) return res.status(400).json({ message: `${f} is not a valid date.` });
    }
    if (body.constructionStartDate && body.expectedCompletionDate && new Date(body.expectedCompletionDate) < new Date(body.constructionStartDate)) {
      return res.status(400).json({ message: "Expected completion cannot be before the construction start date." });
    }

    // The property must belong to the caller's own organisation.
    const [ownProperty] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, Number(body.propertyId)), eq(properties.organizationId, orgId))).limit(1);
    if (!ownProperty) return res.status(400).json({ message: "Property not found in your organisation." });

    const installment = installmentFor(total, down, months, frequency);
    const nameParts = String(body.clientName).trim().split(/\s+/);
    const buyerFirst = nameParts[0] || "Diaspora";
    const buyerLast = nameParts.slice(1).join(" ") || "Buyer";

    // Only these fields come from the form; everything financial or administrative is set here.
    const toInsert = {
      organizationId: orgId,
      createdBy: req.user.id,
      propertyId: ownProperty.id,
      clientName: String(body.clientName).trim().slice(0, 255),
      clientEmail,
      clientPhone: String(body.clientPhone).trim().slice(0, 50),
      clientWhatsapp: String(body.clientWhatsapp).trim().slice(0, 50),
      clientCountry: String(body.clientCountry).trim().slice(0, 100),
      clientAddress: clean(body.clientAddress, 1000),
      identificationNumber: clean(body.identificationNumber, 100),
      identificationType: clean(body.identificationType, 50),
      totalPropertyValue: total.toFixed(2),
      downPayment: down.toFixed(2),
      monthlyInstallment: installment.toFixed(2),
      currency: (clean(body.currency, 3) ?? "KES").toUpperCase(),
      paymentFrequency: frequency,
      contractDurationMonths: months,
      interestRate: Number.isFinite(asNum(body.interestRate)) && asNum(body.interestRate) >= 0 && asNum(body.interestRate) <= 100 ? asNum(body.interestRate).toFixed(2) : "0.00",
      totalPaid: down.toFixed(2),
      remainingBalance: round2(total - down).toFixed(2),
      completionPercentage: ((down / total) * 100).toFixed(2),
      nextPaymentDue: addPeriod(new Date(), frequency),
      paymentMethod: String(body.paymentMethod).trim().slice(0, 100),
      internationalProvider: String(body.internationalProvider).trim().slice(0, 100),
      localBankAccount: clean(body.localBankAccount, 100),
      contractSignedAt: body.contractSignedAt ? new Date(body.contractSignedAt) : null,
      constructionStartDate: body.constructionStartDate ? new Date(body.constructionStartDate) : null,
      expectedCompletionDate: body.expectedCompletionDate ? new Date(body.expectedCompletionDate) : null,
      legalDocumentUrl: clean(body.legalDocumentUrl, 500),
      status: "active",
    };

    // The buyer's login (new pending one, or the existing tenant-role account in THIS organisation) is created in the
    // same transaction as the contract, so a failed contract never leaves a login and an email behind.
    let issued: IssuedInvite;
    let contract: any;
    try {
      ({ issued, contract } = await db.transaction(async (tx) => {
        const issuedInvite = await issueInvite({
          organizationId: orgId, invitedByUserId: req.user.id, email: clientEmail, role: "tenant",
          firstName: buyerFirst, lastName: buyerLast, executor: tx as any,
        });
        const [row] = await tx.insert(diasporaContracts).values({ ...(toInsert as any), buyerUserId: issuedInvite.userId }).returning();
        return { issued: issuedInvite, contract: row };
      }));
    } catch (e: any) {
      if (e instanceof InviteConflictError) return res.status(409).json({ message: e.message });
      throw e;
    }

    // Email goes out only once the contract is safely committed. A failure is reported, not fatal.
    let emailSent = false;
    if (issued.link) {
      emailSent = await deliverInvite({
        to: clientEmail,
        link: issued.link,
        subject: `Your SmartProp diaspora buyer portal is ready`,
        intro: `Hi ${String(body.clientName).trim() || "there"}, your property manager has set up a rent-to-own contract for you on SmartProp. Click below to activate your account and access your buyer portal.`,
        expiryNote: "This invitation link expires in 7 days.",
      });
      logger.info(`[diaspora] Invite ${emailSent ? "sent" : "NOT sent"} to ${clientEmail}`);
    }

    res.status(201).json({ ...contract, constructionProgress: 0, _meta: { buyerInvited: !!issued.link, emailSent, inviteLink: issued.link } });
  } catch (err) { fail(res, err, "create contract"); }
});

diasporaContractsRouter.patch("/:id", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const body = (req.body ?? {}) as Record<string, any>;
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(diasporaContracts)
        .where(and(eq(diasporaContracts.id, Number(req.params.id) || 0), eq(diasporaContracts.organizationId, orgId))).for("update").limit(1);
      if (!locked) throw new HttpError(404, "Contract not found");

      const set: Record<string, any> = {};
      const text: [string, number][] = [
        ["clientName", 255], ["clientPhone", 50], ["clientWhatsapp", 50], ["clientCountry", 100], ["clientAddress", 1000],
        ["identificationNumber", 100], ["identificationType", 50], ["paymentMethod", 100], ["internationalProvider", 100],
        ["localBankAccount", 100], ["legalDocumentUrl", 500], ["registryLink", 500], ["assignedManager", 100],
      ];
      for (const [k, max] of text) if (body[k] !== undefined) {
        const v = clean(body[k], max);
        if (v === null && ["clientName", "clientPhone", "clientWhatsapp", "clientCountry", "paymentMethod", "internationalProvider"].includes(k)) throw new HttpError(400, `${k} cannot be empty.`);
        set[k] = v;
      }
      if (body.clientEmail !== undefined) {
        const e = String(body.clientEmail).toLowerCase().trim();
        if (!emailOk(e)) throw new HttpError(400, "Enter a valid buyer email address.");
        set.clientEmail = e;
      }
      if (body.constructionStatus !== undefined) {
        if (!CONSTRUCTION_PHASES.includes(String(body.constructionStatus))) throw new HttpError(400, `Construction status must be one of: ${CONSTRUCTION_PHASES.join(", ")}.`);
        set.constructionStatus = body.constructionStatus;
      }
      if (body.status !== undefined && body.status !== locked.status) {
        const st = String(body.status);
        if (st === "completed") throw new HttpError(400, "A contract completes by itself when the balance reaches zero.");
        if (!CONTRACT_STATUSES.includes(st)) throw new HttpError(400, `Status must be one of: ${CONTRACT_STATUSES.join(", ")}.`);
        if (locked.status === "completed") throw new HttpError(409, "A completed contract cannot be changed back.");
        set.status = st;
      }
      for (const f of ["contractSignedAt", "constructionStartDate", "expectedCompletionDate", "actualCompletionDate", "nextPaymentDue"]) {
        if (body[f] !== undefined) {
          if (body[f] === null || body[f] === "") { if (f === "nextPaymentDue") throw new HttpError(400, "Next payment date cannot be empty."); set[f] = null; }
          else if (!validDate(body[f])) throw new HttpError(400, `${f} is not a valid date.`);
          else set[f] = new Date(body[f]);
        }
      }
      const start = (set.constructionStartDate ?? locked.constructionStartDate) as Date | null;
      const end = (set.expectedCompletionDate ?? locked.expectedCompletionDate) as Date | null;
      if (start && end && end < start) throw new HttpError(400, "Expected completion cannot be before the construction start date.");

      // Financial terms: recompute the instalment, and refuse a price below what the buyer has already paid.
      const termsChanged = ["totalPropertyValue", "downPayment", "contractDurationMonths", "paymentFrequency"].some(k => body[k] !== undefined);
      if (termsChanged) {
        const total = body.totalPropertyValue !== undefined ? asNum(body.totalPropertyValue) : Number(locked.totalPropertyValue);
        const down = body.downPayment !== undefined ? asNum(body.downPayment) : Number(locked.downPayment);
        const months = body.contractDurationMonths !== undefined ? asNum(body.contractDurationMonths) : Number(locked.contractDurationMonths);
        const freq = body.paymentFrequency !== undefined ? String(body.paymentFrequency) : String(locked.paymentFrequency);
        if (!(total > 0) || total > MAX_AMOUNT) throw new HttpError(400, "Total property value must be a positive amount.");
        if (Number.isNaN(down) || down < 0 || down >= total) throw new HttpError(400, "The down payment must be zero or more, and less than the total property value.");
        if (!Number.isInteger(months) || months < 1 || months > 600) throw new HttpError(400, "Contract duration must be a whole number of months between 1 and 600.");
        if (!FREQUENCIES.includes(freq)) throw new HttpError(400, `Payment frequency must be one of: ${FREQUENCIES.join(", ")}.`);
        const instalmentsPaid = Number(locked.totalPaid) - Number(locked.downPayment);
        if (down + instalmentsPaid > total + EPS) throw new HttpError(409, "The new price is lower than what the buyer has already paid.");
        // what is still to be paid, spread over the periods that are left
        const periodsLeft = Math.max(1, Math.ceil(months / periodMultiplier(freq)) - (locked.paymentsMade ?? 0));
        set.totalPropertyValue = total.toFixed(2);
        set.downPayment = down.toFixed(2);
        set.contractDurationMonths = months;
        set.paymentFrequency = freq;
        set.monthlyInstallment = round2(Math.max(0, total - down - instalmentsPaid) / periodsLeft).toFixed(2);
      }
      // totalPaid, remainingBalance, paymentsMade and completionPercentage are always derived from the payments.
      if (Object.keys(set).length === 0) return locked;
      set.updatedAt = new Date();
      await tx.update(diasporaContracts).set(set as any).where(eq(diasporaContracts.id, locked.id));
      await recalcContractBalance(locked.id, tx);
      const [fresh] = await tx.select().from(diasporaContracts).where(eq(diasporaContracts.id, locked.id));
      return fresh;
    });
    res.json(result);
  } catch (err) { fail(res, err, "update contract"); }
});

// ── Recalc balance for an existing contract (fixes legacy/stale data) ────────
diasporaContractsRouter.post("/:id/recalc-balance", async (req: any, res) => {
  try {
    const contract = await ownContract(req.params.id, req.user.organizationId);
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    await recalcContractBalance(contract.id);
    const [refreshed] = await db.select().from(diasporaContracts).where(eq(diasporaContracts.id, contract.id));
    res.json(refreshed);
  } catch (err) { fail(res, err, "recalc"); }
});

// Recalculates nextPaymentDue = createdAt + (paymentsMade + 1) periods — for THIS organisation's contracts only.
diasporaContractsRouter.post("/patch-due-dates", async (req: any, res) => {
  try {
    const all = await db.select().from(diasporaContracts).where(and(eq(diasporaContracts.organizationId, req.user.organizationId), eq(diasporaContracts.status, "active")));
    const results: { id: number; old: string; new: string }[] = [];
    for (const c of all) {
      const corrected = new Date(c.createdAt ?? Date.now());
      corrected.setMonth(corrected.getMonth() + periodMultiplier(c.paymentFrequency ?? "monthly") * ((c.paymentsMade ?? 0) + 1));
      results.push({ id: c.id, old: c.nextPaymentDue?.toISOString() ?? "null", new: corrected.toISOString() });
      await db.update(diasporaContracts).set({ nextPaymentDue: corrected, updatedAt: new Date() } as any).where(eq(diasporaContracts.id, c.id));
    }
    res.json({ fixed: results.length, results });
  } catch (err) { fail(res, err, "patch-due-dates"); }
});

diasporaContractsRouter.delete("/:id", async (req: any, res) => {
  try {
    const contract = await ownContract(req.params.id, req.user.organizationId);
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    const [pay] = await db.select({ id: diasporaPayments.id }).from(diasporaPayments).where(eq(diasporaPayments.diasporaContractId, contract.id)).limit(1);
    const [upd] = await db.select({ id: constructionUpdates.id }).from(constructionUpdates).where(eq(constructionUpdates.diasporaContractId, contract.id)).limit(1);
    const [cert] = await db.select({ id: diasporaCertificates.id }).from(diasporaCertificates).where(eq(diasporaCertificates.diasporaContractId, contract.id)).limit(1);
    if (pay || upd || cert || Number(contract.totalPaid) > Number(contract.downPayment) + EPS) {
      return res.status(409).json({ message: "This contract already has payments, site updates or certificates, so it cannot be deleted. Set its status to Cancelled instead." });
    }
    await db.delete(diasporaContracts).where(eq(diasporaContracts.id, contract.id));
    res.json({ success: true });
  } catch (err) { fail(res, err, "delete contract"); }
});

// ─── Generate Invoice for a contract (persists to invoices table) ──────────
diasporaContractsRouter.post("/:id/generate-invoice", async (req: any, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      const [contract] = await tx.select().from(diasporaContracts)
        .where(and(eq(diasporaContracts.id, Number(req.params.id) || 0), eq(diasporaContracts.organizationId, req.user.organizationId))).for("update").limit(1);
      if (!contract) throw new HttpError(404, "Contract not found");
      if (contract.status !== "active") throw new HttpError(409, `This contract is ${contract.status}; no further instalments are due.`);
      const remaining = Number(contract.remainingBalance);
      if (remaining <= EPS) throw new HttpError(409, "The balance is fully paid.");

      const frequency = contract.paymentFrequency || "monthly";
      const label = periodLabel(frequency);
      const dueDate = contract.nextPaymentDue ? new Date(contract.nextPaymentDue) : new Date();
      const amount = Math.min(Number(contract.monthlyInstallment), remaining);

      // the same period must not be invoiced twice (a double click used to skip a whole period)
      const existing = await tx.select({ id: invoices.id, notes: invoices.notes, dueDate: invoices.dueDate }).from(invoices)
        .where(and(eq(invoices.propertyId, contract.propertyId), eq(invoices.type, "diaspora_installment"), eq(invoices.status, "pending")));
      const dup = existing.find(i => { try { return JSON.parse(i.notes ?? "{}").diasporaContractId === contract.id; } catch { return false; } });
      if (dup) throw new HttpError(409, "There is already an unpaid invoice for this contract. Record its payment before issuing the next one.");

      const invoiceNumber = `DSP-INV-${contract.id.toString().padStart(4, "0")}-${Date.now().toString(36).toUpperCase()}`;
      const [saved] = await tx.insert(invoices).values({
        invoiceNumber,
        propertyId: contract.propertyId,
        type: "diaspora_installment",
        amount: amount.toFixed(2),
        totalAmount: amount.toFixed(2),
        currency: contract.currency ?? "KES",
        dueDate,
        status: "pending",
        paymentMethod: contract.paymentMethod,
        description: `${label} installment — ${contract.clientName} (DSP-${contract.id.toString().padStart(4, "0")}) via ${contract.internationalProvider}`,
        notes: JSON.stringify({
          diasporaContractId: contract.id, clientName: contract.clientName, clientEmail: contract.clientEmail,
          clientCountry: contract.clientCountry, paymentFrequency: frequency, periodLabel: label,
          internationalProvider: contract.internationalProvider, remainingBalance: remaining,
        }),
      } as any).returning();

      await tx.update(diasporaContracts).set({ nextPaymentDue: addPeriod(dueDate, frequency), updatedAt: new Date() } as any).where(eq(diasporaContracts.id, contract.id));
      return { ...saved, periodLabel: label, clientName: contract.clientName };
    });
    res.status(201).json(result);
  } catch (err) { fail(res, err, "generate-invoice"); }
});

// ─── List invoices for a contract ─────────────────────────────────────────
diasporaContractsRouter.get("/:id/invoices", async (req: any, res) => {
  try {
    const contract = await ownContract(req.params.id, req.user.organizationId);
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    const rows = await db.select().from(invoices)
      .where(and(eq(invoices.propertyId, contract.propertyId), eq(invoices.type, "diaspora_installment")))
      .orderBy(desc(invoices.createdAt));
    res.json(rows.filter((inv: any) => { try { return JSON.parse(inv.notes ?? "{}").diasporaContractId === contract.id; } catch { return false; } }));
  } catch (err) { fail(res, err, "contract invoices"); }
});

// ─── Diaspora Payments ─────────────────────────────────────────────────────
export const diasporaPaymentsRouter = Router();
diasporaPaymentsRouter.use(...auth);

/** Post / reverse the ledger for a payment whose status just changed, and close the matching invoice. */
async function syncPaymentLedger(tx: any, orgId: number, contract: any, payment: any, actorUserId: string) {
  const completed = payment.status === "completed";
  const { live, next } = await saleEpisode(tx, orgId, "DSP", payment.id);
  if (completed && !live) {
    const fees = Number(payment.processingFee ?? 0) + Number(payment.exchangeFee ?? 0);
    await postSaleReceipt(tx, {
      orgId, kind: "DSP", key: next, amount: Number(payment.amount), fees, currency: payment.currency ?? "KES",
      propertyId: contract.propertyId, date: payment.paymentDate ? new Date(payment.paymentDate) : new Date(), actorUserId,
      label: `Diaspora payment #${payment.paymentNumber} — Contract DSP-${String(contract.id).padStart(4, "0")} (${contract.clientName})`,
    });
  } else if (!completed && live) {
    await reverseSaleReceipt(tx, { orgId, kind: "DSP", key: live, actorUserId, reason: payment.status });
  }
  // an instalment invoice for this contract is settled by the first completed payment that covers it
  if (completed) {
    const open = await tx.select().from(invoices).where(and(eq(invoices.propertyId, contract.propertyId), eq(invoices.type, "diaspora_installment"), eq(invoices.status, "pending"))).orderBy(invoices.id);
    const inv = open.find((i: any) => { try { return JSON.parse(i.notes ?? "{}").diasporaContractId === contract.id; } catch { return false; } });
    if (inv && Number(payment.amount) + EPS >= Number(inv.totalAmount)) {
      await tx.update(invoices).set({ status: "paid", paidDate: payment.paymentDate ?? new Date(), paymentMethod: payment.paymentMethod } as any).where(eq(invoices.id, inv.id));
    }
  }
}

async function paymentWithOrg(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [row] = await db.select({ p: diasporaPayments }).from(diasporaPayments)
    .innerJoin(diasporaContracts, eq(diasporaContracts.id, diasporaPayments.diasporaContractId))
    .where(and(eq(diasporaPayments.id, n), eq(diasporaContracts.organizationId, orgId))).limit(1);
  return row?.p ?? null;
}

diasporaPaymentsRouter.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const wanted = req.query.diasporaContractId ?? req.query.contractId;
    if (wanted !== undefined) {
      const c = await ownContract(wanted, orgId);
      if (!c) return res.json([]);
      return res.json(await db.select().from(diasporaPayments).where(eq(diasporaPayments.diasporaContractId, c.id)).orderBy(desc(diasporaPayments.createdAt)));
    }
    const ids = await orgContractIds(orgId);
    if (!ids.length) return res.json([]);
    res.json(await db.select().from(diasporaPayments).where(inArray(diasporaPayments.diasporaContractId, ids)).orderBy(desc(diasporaPayments.createdAt)));
  } catch (err) { fail(res, err, "list payments"); }
});

diasporaPaymentsRouter.get("/:id", async (req: any, res) => {
  try {
    const p = await paymentWithOrg(req.params.id, req.user.organizationId);
    if (!p) return res.status(404).json({ message: "Payment not found" });
    res.json(p);
  } catch (err) { fail(res, err, "get payment"); }
});

diasporaPaymentsRouter.post("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const amount = asNum(b.amount);
    const processingFee = b.processingFee === undefined || b.processingFee === "" || b.processingFee === null ? 0 : asNum(b.processingFee);
    const exchangeFee = b.exchangeFee === undefined || b.exchangeFee === "" || b.exchangeFee === null ? 0 : asNum(b.exchangeFee);
    const status = String(b.status ?? "pending");
    if (!(amount > 0) || amount > 99_999_999) return res.status(400).json({ message: "Enter the payment amount (more than zero)." });
    if (Number.isNaN(processingFee) || Number.isNaN(exchangeFee) || processingFee < 0 || exchangeFee < 0) return res.status(400).json({ message: "Fees cannot be negative." });
    if (processingFee + exchangeFee > amount) return res.status(400).json({ message: "The fees are larger than the payment itself." });
    if (!PAYMENT_STATUSES.includes(status)) return res.status(400).json({ message: `Status must be one of: ${PAYMENT_STATUSES.join(", ")}.` });
    if (!validDate(b.paymentDate)) return res.status(400).json({ message: "Enter the date the payment was received." });
    if (b.dueDate && !validDate(b.dueDate)) return res.status(400).json({ message: "The due date is not a valid date." });

    const originalCurrency = clean(b.originalCurrency, 3)?.toUpperCase() ?? "KES";
    const originalAmount = Number(b.originalAmount ?? 0) || 0;
    const appliedRate = Number(b.exchangeRate ?? 0) || 0;
    if (originalCurrency !== "KES" && (!(originalAmount > 0) || !(appliedRate > 0))) {
      return res.status(400).json({ message: `For a ${originalCurrency} payment enter the amount sent and the exchange rate you applied.` });
    }

    const payment = await db.transaction(async (tx) => {
      const [contract] = await tx.select().from(diasporaContracts)
        .where(and(eq(diasporaContracts.id, Number(b.diasporaContractId) || 0), eq(diasporaContracts.organizationId, orgId))).for("update").limit(1);
      if (!contract) throw new HttpError(404, "Contract not found");
      if (contract.status === "cancelled") throw new HttpError(409, "This contract is cancelled — payments can no longer be recorded against it.");
      if (status === "completed" && amount > Number(contract.remainingBalance) + EPS) {
        throw new HttpError(409, `This payment (${amount.toLocaleString()}) is more than the balance still owing (${Number(contract.remainingBalance).toLocaleString()}).`, "OVERPAYMENT");
      }
      const txRef = clean(b.providerTransactionId, 100);
      if (txRef) {
        const [dup] = await tx.select({ id: diasporaPayments.id }).from(diasporaPayments)
          .where(and(eq(diasporaPayments.diasporaContractId, contract.id), eq(diasporaPayments.providerTransactionId, txRef))).limit(1);
        if (dup) throw new HttpError(409, `A payment with transaction reference ${txRef} is already recorded for this contract.`, "DUPLICATE");
      }
      const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${diasporaPayments.paymentNumber}),0)` }).from(diasporaPayments).where(eq(diasporaPayments.diasporaContractId, contract.id));
      const kesDisbursed = originalCurrency === "KES" ? amount - processingFee - exchangeFee : originalAmount * appliedRate - processingFee - exchangeFee;

      const [row] = await tx.insert(diasporaPayments).values({
        diasporaContractId: contract.id,
        paymentNumber: Number(n) + 1,   // always assigned here: two clerks typing "1" used to give two payment #1
        amount: amount.toFixed(2),
        currency: contract.currency ?? "KES",
        exchangeRate: appliedRate > 0 ? String(appliedRate) : null,
        originalAmount: originalAmount > 0 ? originalAmount.toFixed(2) : null,
        originalCurrency,
        paymentDate: new Date(b.paymentDate),
        dueDate: b.dueDate ? new Date(b.dueDate) : (contract.nextPaymentDue ?? new Date(b.paymentDate)),
        paymentMethod: clean(b.paymentMethod, 100) ?? contract.paymentMethod,
        internationalProvider: clean(b.internationalProvider, 100) ?? contract.internationalProvider,
        providerTransactionId: txRef,
        status,
        processingFee: processingFee.toFixed(2),
        exchangeFee: exchangeFee.toFixed(2),
        receiptUrl: clean(b.receiptUrl, 500),
        confirmationCode: clean(b.confirmationCode, 100),
        notes: clean(b.notes, 2000),
        processedBy: status === "completed" ? req.user.id : null,
        processedAt: status === "completed" ? new Date() : null,
      } as any).returning();

      await recalcContractBalance(contract.id, tx);
      await syncPaymentLedger(tx, orgId, contract, { ...row, kesDisbursed }, req.user.id);
      return { ...row, kesDisbursed: kesDisbursed.toFixed(2), fxSource: originalCurrency === "KES" ? "none" : "client" };
    });

    res.status(201).json(payment);

    // Mid-market comparison is only informative, so it never holds up (or fails) the payment.
    if (originalCurrency !== "KES") {
      computeDisbursement({ originalAmount, originalCurrency, appliedRate, processingFee, exchangeFee })
        .then(() => undefined).catch(err => logger.warn("[diaspora] FX enrichment failed:", err));
    }
  } catch (err) { fail(res, err, "record payment"); }
});

diasporaPaymentsRouter.patch("/:id", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const updated = await db.transaction(async (tx) => {
      const existing = await paymentWithOrg(req.params.id, orgId);
      if (!existing) throw new HttpError(404, "Payment not found");
      const [contract] = await tx.select().from(diasporaContracts).where(eq(diasporaContracts.id, existing.diasporaContractId)).for("update").limit(1);
      const [p] = await tx.select().from(diasporaPayments).where(eq(diasporaPayments.id, existing.id)).for("update").limit(1);

      const set: Record<string, any> = {};
      const newStatus = b.status !== undefined ? String(b.status) : p.status!;
      if (!PAYMENT_STATUSES.includes(newStatus)) throw new HttpError(400, `Status must be one of: ${PAYMENT_STATUSES.join(", ")}.`);
      if (p.status === "refunded" && newStatus !== "refunded") throw new HttpError(409, "A refunded payment cannot be reopened — record a new payment instead.");

      // The money fields of a payment that has been counted cannot be rewritten: refund it and record the right one.
      const moneyEdit = ["amount", "processingFee", "exchangeFee", "originalAmount", "exchangeRate", "originalCurrency"].some(k => b[k] !== undefined);
      if (moneyEdit) {
        if (p.status === "completed" || p.status === "refunded") throw new HttpError(409, "A completed payment's amount cannot be edited. Mark it refunded and record the correct payment.");
        const amount = b.amount !== undefined ? asNum(b.amount) : Number(p.amount);
        const pf = b.processingFee !== undefined ? asNum(b.processingFee) : Number(p.processingFee ?? 0);
        const ef = b.exchangeFee !== undefined ? asNum(b.exchangeFee) : Number(p.exchangeFee ?? 0);
        if (!(amount > 0) || Number.isNaN(pf) || Number.isNaN(ef) || pf < 0 || ef < 0 || pf + ef > amount) throw new HttpError(400, "Check the amount and fees.");
        set.amount = amount.toFixed(2); set.processingFee = pf.toFixed(2); set.exchangeFee = ef.toFixed(2);
        if (b.originalAmount !== undefined) set.originalAmount = Number(b.originalAmount) > 0 ? Number(b.originalAmount).toFixed(2) : null;
        if (b.exchangeRate !== undefined) set.exchangeRate = Number(b.exchangeRate) > 0 ? String(Number(b.exchangeRate)) : null;
        if (b.originalCurrency !== undefined) set.originalCurrency = clean(b.originalCurrency, 3)?.toUpperCase() ?? "KES";
      }
      for (const [k, max] of [["notes", 2000], ["receiptUrl", 500], ["confirmationCode", 100], ["paymentMethod", 100], ["internationalProvider", 100]] as [string, number][]) {
        if (b[k] !== undefined) set[k] = clean(b[k], max);
      }
      if (b.providerTransactionId !== undefined) {
        const ref = clean(b.providerTransactionId, 100);
        if (ref && ref !== p.providerTransactionId) {
          const [dup] = await tx.select({ id: diasporaPayments.id }).from(diasporaPayments)
            .where(and(eq(diasporaPayments.diasporaContractId, p.diasporaContractId), eq(diasporaPayments.providerTransactionId, ref))).limit(1);
          if (dup && dup.id !== p.id) throw new HttpError(409, `A payment with transaction reference ${ref} is already recorded for this contract.`, "DUPLICATE");
        }
        set.providerTransactionId = ref;
      }
      for (const f of ["paymentDate", "dueDate"]) if (b[f] !== undefined) { if (!validDate(b[f])) throw new HttpError(400, `${f} is not a valid date.`); set[f] = new Date(b[f]); }

      if (newStatus !== p.status) {
        if (newStatus === "completed") {
          if (contract.status === "cancelled") throw new HttpError(409, "This contract is cancelled.");
          const amt = Number(set.amount ?? p.amount);
          if (amt > Number(contract.remainingBalance) + EPS) throw new HttpError(409, `This payment (${amt.toLocaleString()}) is more than the balance still owing (${Number(contract.remainingBalance).toLocaleString()}).`, "OVERPAYMENT");
          set.processedBy = req.user.id; set.processedAt = new Date();
        }
        set.status = newStatus;
      }
      if (Object.keys(set).length === 0) return p;
      const [row] = await tx.update(diasporaPayments).set(set as any).where(eq(diasporaPayments.id, p.id)).returning();
      await recalcContractBalance(contract.id, tx);
      await syncPaymentLedger(tx, orgId, contract, row, req.user.id);
      return row;
    });
    res.json(updated);
  } catch (err) { fail(res, err, "update payment"); }
});

// Books for payments that were recorded before the ledger posting worked: posts every completed payment that has no entry.
diasporaPaymentsRouter.post("/repost-ledger", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const ids = await orgContractIds(orgId);
    if (!ids.length) return res.json({ posted: 0 });
    let posted = 0;
    const rows = await db.select().from(diasporaPayments).where(and(inArray(diasporaPayments.diasporaContractId, ids), eq(diasporaPayments.status, "completed")));
    for (const p of rows) {
      await db.transaction(async (tx) => {
        const { live } = await saleEpisode(tx, orgId, "DSP", p.id);
        if (live) return;
        const [contract] = await tx.select().from(diasporaContracts).where(eq(diasporaContracts.id, p.diasporaContractId));
        await syncPaymentLedger(tx, orgId, contract, p, req.user.id);
        posted++;
      });
    }
    res.json({ posted });
  } catch (err) { fail(res, err, "repost-ledger"); }
});

// ─── Construction Updates ──────────────────────────────────────────────────
export const constructionUpdatesRouter = Router();
constructionUpdatesRouter.use(...auth);

const urlList = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => String(x)).filter(Boolean).slice(0, 50) : []);

async function updateWithOrg(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [row] = await db.select({ u: constructionUpdates }).from(constructionUpdates)
    .innerJoin(diasporaContracts, eq(diasporaContracts.id, constructionUpdates.diasporaContractId))
    .where(and(eq(constructionUpdates.id, n), eq(diasporaContracts.organizationId, orgId))).limit(1);
  return row?.u ?? null;
}

/** The contract's construction status follows its newest update; its completion % is payment progress and is NOT touched. */
async function syncConstruction(ex: any, contractId: number) {
  const [latest] = await ex.select().from(constructionUpdates).where(eq(constructionUpdates.diasporaContractId, contractId)).orderBy(desc(constructionUpdates.id)).limit(1);
  if (!latest) return;
  const set: Record<string, any> = { constructionStatus: latest.constructionPhase, updatedAt: new Date() };
  if (latest.constructionPhase === "completed" && Number(latest.progressPercentage) >= 100) set.actualCompletionDate = new Date();
  await ex.update(diasporaContracts).set(set).where(eq(diasporaContracts.id, contractId));
}

function cleanUpdate(b: Record<string, any>, partial: boolean): Record<string, any> {
  const out: Record<string, any> = {};
  if (!partial || b.updateTitle !== undefined) { const t = clean(b.updateTitle, 255); if (!t) throw new HttpError(400, "Give the update a title."); out.updateTitle = t; }
  if (!partial || b.updateDescription !== undefined) { const t = clean(b.updateDescription, 5000); if (!t) throw new HttpError(400, "Describe the work done."); out.updateDescription = t; }
  if (!partial || b.constructionPhase !== undefined) {
    if (!CONSTRUCTION_PHASES.includes(String(b.constructionPhase))) throw new HttpError(400, `Phase must be one of: ${CONSTRUCTION_PHASES.join(", ")}.`);
    out.constructionPhase = b.constructionPhase;
  }
  if (!partial || b.progressPercentage !== undefined) {
    const pct = asNum(b.progressPercentage);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) throw new HttpError(400, "Progress must be a number from 0 to 100.");
    out.progressPercentage = pct.toFixed(2);
  }
  for (const k of ["milestoneAchieved", "nextMilestone"]) if (b[k] !== undefined) out[k] = clean(b[k], 255);
  if (b.estimatedCompletionDate !== undefined) {
    if (b.estimatedCompletionDate === null || b.estimatedCompletionDate === "") out.estimatedCompletionDate = null;
    else if (!validDate(b.estimatedCompletionDate)) throw new HttpError(400, "The estimated completion date is not valid.");
    else out.estimatedCompletionDate = new Date(b.estimatedCompletionDate);
  }
  for (const k of ["photoUrls", "videoUrls", "documentUrls"]) if (b[k] !== undefined) out[k] = urlList(b[k]);
  if (b.clientNotified !== undefined) out.clientNotified = !!b.clientNotified;
  return out;
}

constructionUpdatesRouter.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const wanted = req.query.diasporaContractId ?? req.query.contractId;
    if (wanted !== undefined) {
      const c = await ownContract(wanted, orgId);
      if (!c) return res.json([]);
      return res.json(await db.select().from(constructionUpdates).where(eq(constructionUpdates.diasporaContractId, c.id)).orderBy(desc(constructionUpdates.createdAt)));
    }
    const ids = await orgContractIds(orgId);
    if (!ids.length) return res.json([]);
    res.json(await db.select().from(constructionUpdates).where(inArray(constructionUpdates.diasporaContractId, ids)).orderBy(desc(constructionUpdates.createdAt)));
  } catch (err) { fail(res, err, "list updates"); }
});

constructionUpdatesRouter.get("/:id", async (req: any, res) => {
  try {
    const u = await updateWithOrg(req.params.id, req.user.organizationId);
    if (!u) return res.status(404).json({ message: "Update not found" });
    res.json(u);
  } catch (err) { fail(res, err, "get update"); }
});

constructionUpdatesRouter.post("/", async (req: any, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, any>;
    const contract = await ownContract(b.diasporaContractId, req.user.organizationId);
    if (!contract) return res.status(404).json({ message: "Contract not found" });
    if (contract.status === "cancelled") return res.status(409).json({ message: "This contract is cancelled." });
    const fields = cleanUpdate(b, false);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.insert(constructionUpdates).values({ ...fields, diasporaContractId: contract.id, updatedBy: req.user.id } as any).returning();
      await syncConstruction(tx, contract.id);
      return u;
    });
    res.status(201).json(row);
  } catch (err) { fail(res, err, "post update"); }
});

constructionUpdatesRouter.patch("/:id", async (req: any, res) => {
  try {
    const existing = await updateWithOrg(req.params.id, req.user.organizationId);
    if (!existing) return res.status(404).json({ message: "Update not found" });
    const b = (req.body ?? {}) as Record<string, any>;
    const fields = cleanUpdate(b, true);
    if (b.approved === true) { fields.approvedBy = req.user.id; fields.approvedAt = new Date(); }
    if (Object.keys(fields).length === 0) return res.json(existing);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(constructionUpdates).set(fields as any).where(eq(constructionUpdates.id, existing.id)).returning();
      await syncConstruction(tx, existing.diasporaContractId);
      return u;
    });
    res.json(row);
  } catch (err) { fail(res, err, "edit update"); }
});

// ─── Diaspora Certificates ─────────────────────────────────────────────────
export const diasporaCertificatesRouter = Router();
diasporaCertificatesRouter.use(...auth);

async function certWithOrg(id: unknown, orgId: number) {
  const n = posId(id);
  if (!n) return null;
  const [row] = await db.select({ c: diasporaCertificates }).from(diasporaCertificates)
    .innerJoin(diasporaContracts, eq(diasporaContracts.id, diasporaCertificates.diasporaContractId))
    .where(and(eq(diasporaCertificates.id, n), eq(diasporaContracts.organizationId, orgId))).limit(1);
  return row?.c ?? null;
}

/** The contract's certificate flags mirror its newest live certificate. */
async function syncCertificateFlags(ex: any, contractId: number) {
  const certs = await ex.select().from(diasporaCertificates).where(eq(diasporaCertificates.diasporaContractId, contractId)).orderBy(desc(diasporaCertificates.id));
  const live = certs.find((c: any) => c.status !== "revoked" && c.status !== "expired") ?? null;
  await ex.update(diasporaContracts).set({
    digitalCertificateIssued: !!live && live.status !== "pending",
    certificateStatus: live ? live.status : certs.length ? certs[0].status : "not_issued",
    blockchainHash: live ? live.blockchainHash : null,
    certificateQrCode: live ? live.qrCode : null,
    updatedAt: new Date(),
  } as any).where(eq(diasporaContracts.id, contractId));
}

diasporaCertificatesRouter.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const wanted = req.query.diasporaContractId ?? req.query.contractId;
    if (wanted !== undefined) {
      const c = await ownContract(wanted, orgId);
      if (!c) return res.json([]);
      return res.json(await db.select().from(diasporaCertificates).where(eq(diasporaCertificates.diasporaContractId, c.id)).orderBy(desc(diasporaCertificates.createdAt)));
    }
    const ids = await orgContractIds(orgId);
    if (!ids.length) return res.json([]);
    res.json(await db.select().from(diasporaCertificates).where(inArray(diasporaCertificates.diasporaContractId, ids)).orderBy(desc(diasporaCertificates.createdAt)));
  } catch (err) { fail(res, err, "list certificates"); }
});

diasporaCertificatesRouter.get("/:id", async (req: any, res) => {
  try {
    const c = await certWithOrg(req.params.id, req.user.organizationId);
    if (!c) return res.status(404).json({ message: "Certificate not found" });
    res.json(c);
  } catch (err) { fail(res, err, "get certificate"); }
});

diasporaCertificatesRouter.post("/", async (req: any, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, any>;
    const orgId: number = req.user.organizationId;
    const type = String(b.certificateType ?? "");
    const status = String(b.status ?? "issued");
    if (!CERT_TYPES.includes(type)) return res.status(400).json({ message: `Certificate type must be one of: ${CERT_TYPES.join(", ")}.` });
    if (!CERT_STATUSES.includes(status) || status === "revoked" || status === "expired") return res.status(400).json({ message: "A new certificate can be Pending, Issued or Verified." });
    for (const f of ["issuedDate", "expiryDate"]) if (b[f] && !validDate(b[f])) return res.status(400).json({ message: `${f} is not a valid date.` });
    if (b.issuedDate && b.expiryDate && new Date(b.expiryDate) < new Date(b.issuedDate)) return res.status(400).json({ message: "The expiry date cannot be before the issue date." });

    const row = await db.transaction(async (tx) => {
      const [contract] = await tx.select().from(diasporaContracts)
        .where(and(eq(diasporaContracts.id, Number(b.diasporaContractId) || 0), eq(diasporaContracts.organizationId, orgId))).for("update").limit(1);
      if (!contract) throw new HttpError(404, "Contract not found");
      // a certificate says something true about the contract: the matching milestone has to have been reached
      if (type === "payment" && Number(contract.remainingBalance) > EPS) throw new HttpError(409, "A payment-completion certificate can only be issued once the balance is fully paid.");
      if (type === "ownership" && Number(contract.remainingBalance) > EPS) throw new HttpError(409, "An ownership certificate can only be issued once the balance is fully paid.");
      if (type === "completion" && contract.constructionStatus !== "completed") throw new HttpError(409, "A construction-completion certificate can only be issued once construction is marked completed.");
      const [dup] = await tx.select({ id: diasporaCertificates.id }).from(diasporaCertificates)
        .where(and(eq(diasporaCertificates.diasporaContractId, contract.id), eq(diasporaCertificates.certificateType, type), inArray(diasporaCertificates.status, ["pending", "issued", "verified"] as any))).limit(1);
      if (dup) throw new HttpError(409, `This contract already has a live ${type} certificate. Revoke it first if it must be reissued.`);

      // Identifiers and the fingerprint are made here, from the contract's own facts — not typed or invented in the browser.
      const ts = Date.now().toString(36).toUpperCase();
      const number = clean(b.certificateNumber, 60) ?? `CERT-DSP-${String(contract.id).padStart(4, "0")}-${ts}`;
      const issuedAt = b.issuedDate ? new Date(b.issuedDate) : new Date();
      const data = {
        issuedVia: "SmartProp", contractId: contract.id, certificateNumber: number, type,
        buyer: contract.clientName, propertyId: contract.propertyId, totalPropertyValue: contract.totalPropertyValue,
        totalPaid: contract.totalPaid, issuedAt: issuedAt.toISOString(),
      };
      const hash = `0x${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
      const [dupNumber] = await tx.select({ id: diasporaCertificates.id }).from(diasporaCertificates).where(eq(diasporaCertificates.certificateNumber, number)).limit(1);
      if (dupNumber) throw new HttpError(409, "That certificate number is already used.");

      const [cert] = await tx.insert(diasporaCertificates).values({
        diasporaContractId: contract.id, certificateNumber: number, certificateType: type,
        qrCode: `QR-${ts}`, blockchainHash: hash, certificateData: data,
        verificationUrl: `https://verify.smartprop.co/cert/${number}`,
        status, issuedDate: issuedAt, expiryDate: b.expiryDate ? new Date(b.expiryDate) : null,
        verifiedAt: status === "verified" ? new Date() : null, verifiedBy: status === "verified" ? req.user.id : null,
        issuedBy: req.user.id,
      } as any).returning();
      await syncCertificateFlags(tx, contract.id);
      return cert;
    });
    res.status(201).json(row);
  } catch (err) { fail(res, err, "issue certificate"); }
});

diasporaCertificatesRouter.patch("/:id", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const b = (req.body ?? {}) as Record<string, any>;
    const existing = await certWithOrg(req.params.id, orgId);
    if (!existing) return res.status(404).json({ message: "Certificate not found" });
    const set: Record<string, any> = {};
    if (b.status !== undefined && b.status !== existing.status) {
      const st = String(b.status);
      if (!CERT_STATUSES.includes(st)) return res.status(400).json({ message: `Status must be one of: ${CERT_STATUSES.join(", ")}.` });
      if (existing.status === "revoked") return res.status(409).json({ message: "A revoked certificate cannot be changed — issue a new one." });
      if (st === "verified") { set.verifiedAt = new Date(); set.verifiedBy = req.user.id; }
      if (st === "revoked") {
        const reason = clean(b.revocationReason, 1000);
        if (!reason) return res.status(400).json({ message: "Say why the certificate is being revoked." });
        set.revokedAt = new Date(); set.revocationReason = reason;
      }
      set.status = st;
    }
    if (b.expiryDate !== undefined) {
      if (b.expiryDate && !validDate(b.expiryDate)) return res.status(400).json({ message: "The expiry date is not valid." });
      set.expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;
    }
    if (b.downloadUrl !== undefined) set.downloadUrl = clean(b.downloadUrl, 500);
    if (Object.keys(set).length === 0) return res.json(existing);
    const row = await db.transaction(async (tx) => {
      const [c] = await tx.update(diasporaCertificates).set(set as any).where(eq(diasporaCertificates.id, existing.id)).returning();
      await syncCertificateFlags(tx, existing.diasporaContractId);
      return c;
    });
    res.json(row);
  } catch (err) { fail(res, err, "update certificate"); }
});
