/**
 * etims.ts — KRA eTIMS API service
 *
 * Implements the KRA Electronic Tax Invoice Management System API.
 * Spec: Kenya Revenue Authority eTIMS API documentation v3.x
 *
 * API environments:
 *   Sandbox:    https://etims-sbx.kra.go.ke/etims-api
 *   Production: https://etims-api.kra.go.ke/etims-api
 *
 * Authentication: Every request carries the device TIN and BHF ID as
 * HTTP headers — no OAuth token required. Requests are identified by
 * the combination of (tpin, bhfId) provisioned during initialisation.
 *
 * SANDBOX MODE: When ETIMS_SANDBOX=true (or credentials absent) the
 * service returns deterministic simulated responses so the rest of the
 * system can run end-to-end without live KRA credentials.
 * Sandbox responses are clearly labelled with { _sandbox: true }.
 */

import fetch, { type RequestInit } from "node-fetch";
import { db } from "../db";
import {
  etimsDeviceInfo, etimsInvoices, etimsCodeLookup,
  invoices, rentPayments, tenants, organizations,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

// ── Config ────────────────────────────────────────────────────────────────────

const IS_SANDBOX = process.env.ETIMS_SANDBOX !== "false";
const BASE_URL   = IS_SANDBOX
  ? (process.env.ETIMS_SANDBOX_URL ?? "https://etims-sbx.kra.go.ke/etims-api")
  : (process.env.ETIMS_BASE_URL    ?? "https://etims-api.kra.go.ke/etims-api");

const REQUEST_TIMEOUT_MS = 15_000;

// ── Date helpers ──────────────────────────────────────────────────────────────

/** KRA datetime format: YYYYMMDDHHMMSS */
function kraDateTime(d: Date = new Date()): string {
  return d.toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d{3}Z$/, "");
}

/** KRA date format: YYYYMMDD */
function kraDate(d: Date = new Date()): string {
  return kraDateTime(d).slice(0, 8);
}

// ── HTTP client ───────────────────────────────────────────────────────────────

interface KraResponse<T = any> {
  resultCd: string;   // "000" = success
  resultMsg: string;
  resultDt: string;
  data?: T;
  _sandbox?: boolean;
}

async function kraPost<T = any>(
  path: string,
  body: any,
  tin: string,
  bhfId: string,
): Promise<KraResponse<T>> {
  // ── Sandbox short-circuit ──────────────────────────────────────────────────
  if (IS_SANDBOX) return sandboxResponse(path, body, tin, bhfId);

  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const opts: RequestInit = {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "tin":          tin,
        "bhfId":        bhfId,
      },
      body:   JSON.stringify(body),
      signal: controller.signal as any,
    };

    const res  = await fetch(url, opts);
    const json = await res.json() as KraResponse<T>;
    return json;
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("KRA eTIMS request timed out");
    throw new Error(`KRA eTIMS network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Sandbox simulation ────────────────────────────────────────────────────────

function sandboxResponse(path: string, body: any, tin: string, bhfId: string): KraResponse {
  const now = kraDateTime();
  const base = { resultCd: "000", resultMsg: "Success", resultDt: now, _sandbox: true };

  if (path === "/selectInitOsdcInfo") {
    return { ...base, data: { info: { envDistCode: "SBX-DIST", lastReqDt: now } } };
  }
  if (path === "/selectCodeList") {
    return {
      ...base,
      data: {
        clsList: [
          { cdCls: "20", cdClsNm: "Item Type",      codes: [{ cd: "2", cdNm: "Service", useYn: "Y" }] },
          { cdCls: "22", cdClsNm: "Tax Type",        codes: [{ cd: "A", cdNm: "VAT",     useYn: "Y" }, { cd: "B", cdNm: "Exempt", useYn: "Y" }] },
          { cdCls: "24", cdClsNm: "Payment Type",    codes: [{ cd: "01", cdNm: "Cash", useYn: "Y" }, { cd: "02", cdNm: "M-Pesa", useYn: "Y" }] },
          { cdCls: "04", cdClsNm: "Sale Status",     codes: [{ cd: "02", cdNm: "Approved", useYn: "Y" }] },
        ],
      },
    };
  }
  if (path === "/saveTrnsSalesSaveWr") {
    const rcptNo = `SBX-${Date.now().toString().slice(-8)}`;
    return {
      ...base,
      data: {
        salesList: [{
          invcNo:   body.salesList?.[0]?.invcNo ?? "0",
          rcptNo,
          intRlDt:  now,
          qrCodeUrl: `https://etims-sbx.kra.go.ke/qr/${rcptNo}`,
          rcptSign:  `SBX-SIGN-${rcptNo}`,
        }],
      },
    };
  }
  // Default success
  return base;
}

// ══════════════════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * initialiseDevice
 * Registers the device with KRA eTIMS. Must be called once per organisation
 * before any invoices can be submitted.
 */
export async function initialiseDevice(orgId: number): Promise<EtimsInitResult> {
  const [device] = await db.select().from(etimsDeviceInfo)
    .where(eq(etimsDeviceInfo.organizationId, orgId)).limit(1);

  if (!device) throw new Error("eTIMS device info not configured for this organisation");

  const body = {
    tin:   device.tin,
    bhfId: device.bhfId,
    dvcSrlNo: device.deviceSerial ?? "",
  };

  const res = await kraPost("/selectInitOsdcInfo", body, device.tin, device.bhfId);

  if (res.resultCd !== "000") {
    throw new Error(`KRA eTIMS initialisation failed: [${res.resultCd}] ${res.resultMsg}`);
  }

  // Persist the initialisation data
  await db.update(etimsDeviceInfo)
    .set({
      envDistCode:   res.data?.info?.envDistCode ?? null,
      lastReqDt:     res.data?.info?.lastReqDt   ?? null,
      status:        "active",
      initialisedAt: new Date(),
      updatedAt:     new Date(),
    })
    .where(eq(etimsDeviceInfo.organizationId, orgId));

  return { success: true, sandbox: IS_SANDBOX, resultMsg: res.resultMsg };
}

/**
 * fetchCodeLookup
 * Fetches and caches KRA code lists (item types, tax types, payment types, etc.)
 */
export async function fetchCodeLookup(orgId: number): Promise<void> {
  const [device] = await db.select().from(etimsDeviceInfo)
    .where(eq(etimsDeviceInfo.organizationId, orgId)).limit(1);
  if (!device) throw new Error("eTIMS device not configured");

  const res = await kraPost("/selectCodeList", { tin: device.tin, bhfId: device.bhfId, lastReqDt: "" }, device.tin, device.bhfId);
  if (res.resultCd !== "000") throw new Error(`Code list fetch failed: ${res.resultMsg}`);

  const clsList: any[] = res.data?.clsList ?? [];
  for (const cls of clsList) {
    for (const code of cls.codes ?? []) {
      await db.insert(etimsCodeLookup).values({
        organizationId: orgId,
        cdClsCode:      cls.cdCls,
        cdCode:         code.cd,
        cdNm:           code.cdNm,
        useYn:          code.useYn ?? "Y",
        fetchedAt:      new Date(),
      } as any).onConflictDoUpdate({
        target: [etimsCodeLookup.organizationId, etimsCodeLookup.cdClsCode, etimsCodeLookup.cdCode],
        set:    { cdNm: code.cdNm, fetchedAt: new Date() },
      }).catch(() => { /* ignore unique violation */ });
    }
  }
}

/**
 * submitInvoice
 * Transmits a single invoice to KRA eTIMS.
 * Creates an etimsInvoices row and updates it with the KRA response.
 *
 * @param orgId       Organisation ID
 * @param sourceType  "invoice" or "rent_payment"
 * @param sourceId    The invoice.id or rent_payment.id
 * @param isVatRegistered  Whether this org is VAT-registered (16% VAT applies)
 */
export async function submitInvoice(
  orgId: number,
  sourceType: "invoice" | "rent_payment",
  sourceId: number,
  isVatRegistered = false,
): Promise<EtimsSubmitResult> {

  const [device] = await db.select().from(etimsDeviceInfo)
    .where(and(eq(etimsDeviceInfo.organizationId, orgId), eq(etimsDeviceInfo.status, "active")))
    .limit(1);

  if (!device) throw new Error("eTIMS device not active — please initialise first");

  // ── Build invoice payload ──────────────────────────────────────────────────

  let amount     = 0;
  let description = "";
  let custNm     = "";
  let custTpin: string | undefined;
  let pmntTyCd: string | undefined;
  let invcNo: string;

  if (sourceType === "invoice") {
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, sourceId), eq(invoices.propertyId, invoices.propertyId)))
      .limit(1);
    if (!inv) throw new Error(`Invoice ${sourceId} not found`);
    amount      = Number(inv.totalAmount);
    description = inv.description ?? `Invoice ${inv.invoiceNumber}`;
    invcNo      = inv.invoiceNumber;

    if (inv.tenantId) {
      const [t] = await db.select({ firstName: tenants.firstName, lastName: tenants.lastName })
        .from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1);
      if (t) custNm = `${t.firstName} ${t.lastName}`.trim();
    }
  } else {
    const [pmt] = await db.select().from(rentPayments)
      .where(eq(rentPayments.id, sourceId)).limit(1);
    if (!pmt) throw new Error(`Rent payment ${sourceId} not found`);
    amount     = Number(pmt.amount);
    invcNo     = `RPY-${pmt.id}`;
    description = `Rent payment — ${pmt.paymentMethod ?? "M-Pesa"}`;
    pmntTyCd   = (pmt.paymentMethod?.toLowerCase().includes("mpesa") || pmt.paymentMethod?.toLowerCase().includes("m-pesa")) ? "02" : "01";

    if (pmt.tenantId) {
      const [t] = await db.select({ firstName: tenants.firstName, lastName: tenants.lastName })
        .from(tenants).where(eq(tenants.id, pmt.tenantId)).limit(1);
      if (t) custNm = `${t.firstName} ${t.lastName}`.trim();
    }
  }

  // ── VAT computation ────────────────────────────────────────────────────────
  // For property management:
  // - VAT-registered: 16% VAT on the rental amount
  // - Non-registered: entire amount is exempt (code B)

  let taxblAmtA = 0, taxAmtA = 0, taxblAmtB = 0;
  if (isVatRegistered) {
    // amount is VAT-inclusive → taxable excl = amount / 1.16
    taxblAmtA = +(amount / 1.16).toFixed(2);
    taxAmtA   = +(amount - taxblAmtA).toFixed(2);
  } else {
    taxblAmtB = amount; // exempt
  }

  const saleDt = kraDateTime();
  const now    = new Date();

  // ── Persist pending record ─────────────────────────────────────────────────

  const [etimsRow] = await db.insert(etimsInvoices).values({
    organizationId: orgId,
    invoiceId:      sourceType === "invoice"      ? sourceId : null,
    rentPaymentId:  sourceType === "rent_payment" ? sourceId : null,
    invcNo,
    tpin:           device.tin,
    bhfId:          device.bhfId,
    saleSttCd:      "02",
    rcptTyCd:       "S",
    pmntTyCd:       pmntTyCd ?? null,
    saleDt,
    custNm:         custNm || null,
    taxblAmtA:      String(taxblAmtA),
    taxRtA:         "16.00",
    taxAmtA:        String(taxAmtA),
    taxblAmtB:      String(taxblAmtB),
    totItemCnt:     1,
    totTaxblAmt:    String(taxblAmtA + taxblAmtB),
    totTaxAmt:      String(taxAmtA),
    totAmt:         String(amount),
    status:         "pending",
    attempts:       0,
    createdAt:      now,
    updatedAt:      now,
  } as any).returning();

  // ── Submit to KRA ──────────────────────────────────────────────────────────

  const kraBody = {
    salesList: [{
      invcNo,
      tpin:       device.tin,
      bhfId:      device.bhfId,
      saleSttCd:  "02",
      rcptTyCd:   "S",
      pmntTyCd:   pmntTyCd ?? "01",
      saleDt,
      custTpin,
      custNm:     custNm || undefined,
      totItemCnt: 1,
      taxblAmtA:  taxblAmtA.toFixed(2),
      taxRtA:     "16.00",
      taxAmtA:    taxAmtA.toFixed(2),
      taxblAmtB:  taxblAmtB.toFixed(2),
      totTaxblAmt:(taxblAmtA + taxblAmtB).toFixed(2),
      totTaxAmt:  taxAmtA.toFixed(2),
      totAmt:     amount.toFixed(2),
      itemList: [{
        itemSeq:    1,
        itemCd:     "SVC001",
        itemClsCd:  "2",
        itemNm:     description,
        bcd:        "",
        pkgUnitCd:  "NX",
        pkg:        1,
        qtyUnitCd:  "NX",
        qty:        1,
        prc:        taxblAmtA > 0 ? taxblAmtA.toFixed(2) : amount.toFixed(2),
        splyAmt:    taxblAmtA > 0 ? taxblAmtA.toFixed(2) : amount.toFixed(2),
        dcRt:       "0.00",
        dcAmt:      "0.00",
        taxTyCd:    taxblAmtA > 0 ? "A" : "B",
        taxblAmt:   taxblAmtA > 0 ? taxblAmtA.toFixed(2) : amount.toFixed(2),
        taxAmt:     taxAmtA.toFixed(2),
        totAmt:     amount.toFixed(2),
      }],
    }],
  };

  try {
    await db.update(etimsInvoices).set({
      attempts:       etimsRow.attempts + 1,
      lastAttemptAt:  new Date(),
      status:         "submitted",
      submittedAt:    new Date(),
      updatedAt:      new Date(),
    } as any).where(eq(etimsInvoices.id, etimsRow.id));

    const res = await kraPost("/saveTrnsSalesSaveWr", kraBody, device.tin, device.bhfId);

    if (res.resultCd !== "000") {
      await db.update(etimsInvoices).set({
        status:       "rejected",
        kraResultCd:  res.resultCd,
        kraResultMsg: res.resultMsg,
        updatedAt:    new Date(),
      } as any).where(eq(etimsInvoices.id, etimsRow.id));
      throw new Error(`KRA eTIMS rejected invoice: [${res.resultCd}] ${res.resultMsg}`);
    }

    // Extract KRA receipt data
    const saleRes = (res.data?.salesList ?? [])[0];
    await db.update(etimsInvoices).set({
      status:       "accepted",
      rcptNo:       saleRes?.rcptNo    ?? null,
      intDt:        saleRes?.intRlDt   ?? null,
      qrCode:       saleRes?.qrCodeUrl ?? null,
      rcptSign:     saleRes?.rcptSign  ?? null,
      kraResultCd:  res.resultCd,
      kraResultMsg: res.resultMsg,
      acceptedAt:   new Date(),
      updatedAt:    new Date(),
    } as any).where(eq(etimsInvoices.id, etimsRow.id));

    return {
      success:   true,
      sandbox:   IS_SANDBOX,
      rcptNo:    saleRes?.rcptNo    ?? null,
      qrCode:    saleRes?.qrCodeUrl ?? null,
      rcptSign:  saleRes?.rcptSign  ?? null,
      etimsId:   etimsRow.id,
    };

  } catch (err: any) {
    // Network / timeout errors — mark as error but keep the row
    if (!err.message?.includes("rejected")) {
      await db.update(etimsInvoices).set({
        status:       "error",
        kraResultMsg: err.message,
        updatedAt:    new Date(),
      } as any).where(eq(etimsInvoices.id, etimsRow.id));
    }
    throw err;
  }
}

/**
 * getDeviceStatus — returns the current eTIMS device record for an org
 */
export async function getDeviceStatus(orgId: number) {
  const [device] = await db.select().from(etimsDeviceInfo)
    .where(eq(etimsDeviceInfo.organizationId, orgId)).limit(1);
  return device ?? null;
}

/**
 * getSubmissions — paginated list of eTIMS submissions for an org
 */
export async function getSubmissions(orgId: number, limit = 50, offset = 0) {
  const rows = await db.select().from(etimsInvoices)
    .where(eq(etimsInvoices.organizationId, orgId))
    .orderBy(desc(etimsInvoices.createdAt))
    .limit(limit).offset(offset);
  return rows;
}

/**
 * upsertDeviceInfo — called when an admin saves eTIMS credentials
 */
export async function upsertDeviceInfo(orgId: number, data: {
  tin: string; bhfId: string; deviceSerial?: string; sandbox?: boolean;
}) {
  const existing = await getDeviceStatus(orgId);
  if (existing) {
    const [updated] = await db.update(etimsDeviceInfo)
      .set({ ...data, status: "pending", updatedAt: new Date() } as any)
      .where(eq(etimsDeviceInfo.organizationId, orgId))
      .returning();
    return updated;
  }
  const [created] = await db.insert(etimsDeviceInfo)
    .values({ organizationId: orgId, ...data, status: "pending" } as any)
    .returning();
  return created;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EtimsInitResult   { success: boolean; sandbox: boolean; resultMsg: string; }
interface EtimsSubmitResult { success: boolean; sandbox: boolean; rcptNo: string | null; qrCode: string | null; rcptSign: string | null; etimsId: number; }
