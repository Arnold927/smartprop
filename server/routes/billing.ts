/**
 * server/routes/billing.ts
 *
 * Mounted at /api/billing
 *
 * Endpoints:
 *   GET  /api/billing/plans            → list available plans (public)
 *
 * plans / callback / webhook live on `billingPublicRouter` (mounted WITHOUT the JWT guard:
 * Pesapal's server and the customer's redirected browser carry no SmartProp token).
 * status / checkout live on the default export, mounted behind JWT + role guard.
 *   GET  /api/billing/status           → current org subscription status (auth required)
 *   POST /api/billing/checkout         → create a Pesapal order, return redirect URL
 *   GET  /api/billing/callback         → Pesapal redirects here after payment
 *   POST /api/billing/webhook          → Pesapal IPN callback (no auth — verified by status check)
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { organizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth.js";
import { requireOrg } from "../middleware/requireOrg.js";
import {
  submitOrder,
  getTransactionStatus,
  isPesapalConfigured,
} from "../services/pesapal.js";
import { randomUUID } from "crypto";
import { listPlans, getPlan, getEntitlements, getUsage, syncOrgLimitColumns } from "../services/plans.js";

const router = Router();
export const billingPublicRouter = Router();

// ── Plan catalogue ─────────────────────────────────────────────────────────────
// Plans live in the subscription_plans table and are managed by the platform admin
// (see routes/platform-admin.ts and services/plans.ts).

// ── GET /api/billing/plans ─────────────────────────────────────────────────────
billingPublicRouter.get("/plans", async (_req, res) => {
  try {
    const plans = await listPlans({ publicOnly: true });
    res.json(plans.map((p) => ({
      id: p.id, name: p.name, description: p.description, priceKes: p.priceKes,
      maxProperties: p.maxProperties, maxUnits: p.maxUnits, maxUsers: p.maxUsers, features: p.features,
    })));
  } catch (err) {
    console.error("[billing] plans error:", err);
    res.status(500).json({ message: "Failed to load plans" });
  }
});

// ── GET /api/billing/status ────────────────────────────────────────────────────
router.get("/status", authenticateJWT as any, requireOrg as any, async (req: any, res) => {
  const orgId: number = req.user.organizationId;
  try {
    const ent = await getEntitlements(orgId);
    if (!ent) return res.status(404).json({ message: "Organization not found" });
    const usage = await getUsage(orgId);

    res.json({
      subscriptionPlan: ent.planId,
      subscriptionStatus: ent.expired ? "expired" : ent.status,
      // null = unlimited
      maxProperties: ent.limits.maxProperties,
      maxUnits: ent.limits.maxUnits,
      maxUsers: ent.limits.maxUsers,
      usage,
      trialEndsAt: ent.trialEndsAt,
      currentPeriodEnd: ent.currentPeriodEnd,
      priceKes: ent.priceKes,
      customPrice: ent.customPriceKes != null,
      planDetails: ent.plan,
    });
  } catch (err) {
    console.error("[billing] status error:", err);
    res.status(500).json({ message: "Failed to fetch billing status" });
  }
});

// ── POST /api/billing/checkout ─────────────────────────────────────────────────
const checkoutSchema = z.object({
  planId: z.string().trim().min(1).max(50),
});

router.post("/checkout", authenticateJWT as any, requireOrg as any, async (req: any, res) => {
  const orgId: number = req.user.organizationId;

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid plan", errors: parsed.error.errors });
  }

  const plan = await getPlan(parsed.data.planId);
  if (!plan || !plan.isActive) return res.status(400).json({ message: "Plan not found" });

  if (!isPesapalConfigured()) {
    return res.status(503).json({ message: "Online payment is not configured yet. Please contact support to change your plan." });
  }

  try {
    // Fetch org + user for billing details
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return res.status(404).json({ message: "Organization not found" });

    // A plan the platform admin has hidden can only be renewed by an organisation already on it.
    if (!plan.isPublic && org.subscriptionPlan !== plan.id) return res.status(400).json({ message: "Plan not found" });

    // An organisation with a negotiated price keeps it when renewing the plan it is on.
    const price = org.subscriptionPlan === plan.id && org.customPriceKes != null ? Number(org.customPriceKes) : plan.priceKes;
    if (!(price > 0)) {
      return res.status(400).json({ message: "This plan has no online price. Please contact support to switch to it." });
    }

    const merchantReference = `SP-${orgId}-${plan.id}-${Date.now()}`;
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";

    const { orderTrackingId, redirectUrl } = await submitOrder({
      merchantReference,
      amount: price,
      currency: "KES",
      description: `SmartProp ${plan.name} plan — monthly subscription`,
      billingEmail: req.user.email,
      billingFirstName: req.user.firstName ?? org.name,
      billingLastName: req.user.lastName ?? "",
      // Pesapal appends OrderTrackingId; the API verifies it, then redirects to /billing?success=1
      callbackUrl: `${appUrl}/api/billing/callback`,
    });

    // Persist tracking id so the webhook can look it up
    // We store it in the organization's features JSON blob until we add a
    // dedicated billing_orders table (see schema migration note below).
    const existingFeatures = (org.features as Record<string, any>) ?? {};
    await db
      .update(organizations)
      .set({
        features: {
          ...existingFeatures,
          pendingOrder: {
            merchantReference,
            orderTrackingId,
            planId: plan.id,
            priceKes: price,
            createdAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId));

    res.json({ redirectUrl, orderTrackingId, merchantReference });
  } catch (err: any) {
    console.error("[billing] checkout error:", err);
    res.status(500).json({ message: err.message ?? "Checkout failed" });
  }
});

// ── GET /api/billing/callback ──────────────────────────────────────────────────
// Pesapal redirects the user's browser here after payment.
// We verify the status server-side and update the org, then redirect to the app.
billingPublicRouter.get("/callback", async (req, res) => {
  const { OrderTrackingId } = req.query as Record<string, string>;
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";

  if (!OrderTrackingId) {
    return res.redirect(`${appUrl}/billing?error=missing_tracking_id`);
  }

  try {
    await activateSubscriptionIfPaid(OrderTrackingId);
    res.redirect(`${appUrl}/billing?success=1`);
  } catch (err) {
    console.error("[billing] callback error:", err);
    res.redirect(`${appUrl}/billing?error=verification_failed`);
  }
});

// ── POST /api/billing/webhook ──────────────────────────────────────────────────
// Pesapal IPN — fires asynchronously when a payment status changes.
// Pesapal expects a 200 response with the IPN response JSON.
billingPublicRouter.post("/webhook", async (req, res) => {
  const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } =
    req.body as Record<string, string>;

  console.log("[billing] IPN received:", { OrderTrackingId, OrderMerchantReference, OrderNotificationType });

  if (!OrderTrackingId) {
    return res.status(400).json({ message: "OrderTrackingId is required" });
  }

  // Acknowledge Pesapal immediately (they will retry if we don't respond quickly)
  res.json({
    orderNotificationType: OrderNotificationType,
    orderTrackingId: OrderTrackingId,
    orderMerchantReference: OrderMerchantReference,
    status: "200",
  });

  // Then process async
  activateSubscriptionIfPaid(OrderTrackingId).catch((err) =>
    console.error("[billing] async IPN processing error:", err)
  );
});

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** The org whose checkout created this tracking id (stored server-side at checkout). */
async function findOrgByTrackingId(orderTrackingId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(sql`(${organizations.features})::jsonb -> 'pendingOrder' ->> 'orderTrackingId' = ${orderTrackingId}`)
    .limit(1);
  return org ?? null;
}

/**
 * Verify the order with Pesapal and activate the plan. This route is reachable without a
 * SmartProp token, so nothing in the request is trusted: the organisation and plan come
 * from the order we stored at checkout, and the paid amount must cover the plan price.
 * Idempotent — a repeat IPN for an already-activated order does nothing.
 */
async function activateSubscriptionIfPaid(orderTrackingId: string) {
  const org = await findOrgByTrackingId(orderTrackingId);
  if (!org) {
    console.warn("[billing] no pending order for tracking id, ignoring:", orderTrackingId);
    return;
  }

  const status = await getTransactionStatus(orderTrackingId);
  console.log("[billing] transaction status:", status);

  if (status.status !== "Completed") {
    console.log(`[billing] payment not completed (${status.status}), skipping activation`);
    if (status.status === "Failed" || status.status === "Invalid") {
      await db
        .update(organizations)
        .set({ subscriptionStatus: "past_due", updatedAt: new Date() })
        .where(eq(organizations.id, org.id));
    }
    return;
  }

  const features = (org.features as Record<string, any>) ?? {};
  const pending = features.pendingOrder;
  const plan = await getPlan(pending?.planId);
  if (!plan) {
    console.error("[billing] unknown planId on pending order:", pending?.planId);
    return;
  }

  // The price agreed at checkout (the plan may have been repriced since); older orders fall back to the plan price.
  const expected = Number(pending?.priceKes ?? plan.priceKes);
  const paid = Number(status.amount);
  if (Number.isFinite(paid) && paid + 0.001 < expected) {
    console.error(`[billing] amount ${paid} is below the ${plan.id} price ${expected}; not activating`);
    return;
  }

  const { pendingOrder: _done, ...rest } = features;
  // Buying a different plan replaces the terms the platform admin had set by hand (per-organisation
  // limits and a negotiated price); renewing the same plan keeps them.
  const changedPlan = org.subscriptionPlan !== plan.id;
  await db
    .update(organizations)
    .set({
      subscriptionPlan: plan.id,
      subscriptionStatus: "active",
      trialEndsAt: null,
      ...(changedPlan ? { limitOverrides: null, customPriceKes: null } : {}),
      features: { ...rest, lastOrder: { ...pending, paidAt: new Date().toISOString() } },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));
  await syncOrgLimitColumns([org.id]);

  console.log(`[billing] org ${org.id} upgraded to plan ${plan.id}`);
}

export default router;