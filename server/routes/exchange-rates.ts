/**
 * exchange-rates.ts — mounted at /api/exchange-rates
 *
 * GET /live?from=USD&to=KES
 *   Returns the current mid-market rate + spread guide for a currency pair.
 *   Used by the diaspora payment form to pre-fill the exchange rate field
 *   and show the buyer/manager what spread they're accepting.
 *
 * GET /pairs
 *   Returns all currency pairs relevant to the Kenyan diaspora market with
 *   their current rates vs KES. Used to populate the currency selector and
 *   show a rate comparison dashboard.
 *
 * POST /compute
 *   Given originalAmount, originalCurrency, and appliedRate, returns the
 *   full disbursement breakdown. Used by the UI to live-preview the
 *   compliance receipt before the manager submits the payment.
 */

import { Router }       from "express";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }   from "../middleware/requireOrg";
import { getMidMarketRate, computeDisbursement } from "../services/fxService";
import { z }            from "zod";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

// Diaspora-relevant currencies (currencies Kenyan diaspora actually remit from)
const DIASPORA_CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"];

// Typical spread ranges per provider (informational — shown in UI)
const PROVIDER_SPREAD_GUIDE: Record<string, { min: number; max: number; notes: string }> = {
  "Wise":          { min: 0.4,  max: 0.8,  notes: "Best rate. Mid-market + small fixed fee." },
  "Sendwave":      { min: 0.0,  max: 0.5,  notes: "No fee, rate close to mid-market." },
  "Remitly":       { min: 0.5,  max: 2.0,  notes: "Varies by speed tier (Express vs Economy)." },
  "WorldRemit":    { min: 1.0,  max: 3.0,  notes: "Competitive for larger amounts." },
  "Xoom (PayPal)": { min: 1.5,  max: 3.5,  notes: "Convenient but higher spread." },
  "Western Union": { min: 2.0,  max: 5.0,  notes: "Expensive for large amounts." },
  "MoneyGram":     { min: 2.0,  max: 5.0,  notes: "Similar to Western Union." },
  "Direct Bank Wire": { min: 2.5, max: 4.5, notes: "Good for large amounts; check SWIFT fees." },
};

// ── GET /api/exchange-rates/live ─────────────────────────────────────────────

router.get("/live", async (req: any, res) => {
  const from = (req.query.from as string | undefined)?.toUpperCase() ?? "USD";
  const to   = (req.query.to   as string | undefined)?.toUpperCase() ?? "KES";

  if (from === to) {
    return res.json({
      fromCurrency: from, toCurrency: to,
      midMarketRate: 1, source: "identity",
      fetchedAt: new Date(), isStale: false,
      providerGuide: PROVIDER_SPREAD_GUIDE,
    });
  }

  try {
    const result = await getMidMarketRate(from, to);
    return res.json({ ...result, providerGuide: PROVIDER_SPREAD_GUIDE });
  } catch (err: any) {
    return res.status(502).json({
      message: `Could not fetch rate for ${from}/${to}: ${err.message}`,
    });
  }
});

// ── GET /api/exchange-rates/pairs ─────────────────────────────────────────────

router.get("/pairs", async (_req, res) => {
  const results: Record<string, any> = {};

  await Promise.allSettled(
    DIASPORA_CURRENCIES.map(async (ccy) => {
      try {
        const r = await getMidMarketRate(ccy, "KES");
        results[ccy] = {
          midMarketRate: r.midMarketRate,
          source:        r.source,
          fetchedAt:     r.fetchedAt,
          isStale:       r.isStale,
        };
      } catch {
        results[ccy] = null;
      }
    })
  );

  return res.json({
    baseCurrency: "KES",
    rates:        results,
    fetchedAt:    new Date(),
    providerGuide: PROVIDER_SPREAD_GUIDE,
  });
});

// ── POST /api/exchange-rates/compute ─────────────────────────────────────────

const computeSchema = z.object({
  originalAmount:   z.number().positive(),
  originalCurrency: z.string().length(3),
  appliedRate:      z.number().positive(),
  processingFee:    z.number().min(0).default(0),
  exchangeFee:      z.number().min(0).default(0),
});

router.post("/compute", async (req: any, res) => {
  const parsed = computeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.errors });
  }

  try {
    const breakdown = await computeDisbursement(parsed.data);
    return res.json(breakdown);
  } catch (err: any) {
    return res.status(502).json({ message: err.message });
  }
});

export default router;
