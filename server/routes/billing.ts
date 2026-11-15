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

const router = Router();
export const billingPublicRouter = Router();

// ── Plan catalogue ─────────────────────────────────────────────────────────────
// Adjust prices and limits to match your actual pricing.
export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    priceKes: 2_500,
    maxProperties: 5,
    maxUsers: 5,
    features: ["Up to 5 properties", "Up to 5 users", "M-Pesa rent collection", "Basic reports"],
  },
  {
    id: "growth",
    name: "Growth",
    priceKes: 6_500,
    maxProperties: 25,
    maxUsers: 20,
    features: [
      "Up to 25 properties",
      "Up to 20 users",
      "M-Pesa rent collection",
      "Advanced analytics",
      "WhatsApp notifications",
      "Work orders",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceKes: 15_000,
    maxProperties: 9999,
    maxUsers: 9999,
    features: [
      "Unlimited properties & users",
      "All Growth features",
      "Dedicated support",
      "Custom integrations",
      "SLA guarantee",
    ],
  },
] as const;

type PlanId = (typeof PLANS)[number]["id"];

// ── GET /api/billing/plans ─────────────────────────────────────────────────────
billingPublicRouter.get("/plans", (_req, res) => {
  res.json(PLANS);
});

// ── GET /api/billing/status ────────────────────────────────────────────────────
router.get("/status", authenticateJWT as any, requireOrg as any, async (req: any, res) => {
  const orgId: number = req.user.organizationId;
  try {
    const [org] = await db
      .select({
        subscriptionPlan: organizations.subscriptionPlan,
        subscriptionStatus: organizations.subscriptionStatus,
        maxProperties: organizations.maxProperties,
        maxUsers: organizations.maxUsers,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return res.status(404).json({ message: "Organization not found" });

    const plan = PLANS.find((p) => p.id === org.subscriptionPlan) ?? null;

    res.json({
      subscriptionPlan: org.subscriptionPlan,
      subscriptionStatus: org.subscriptionStatus,
      maxProperties: org.maxProperties,
      maxUsers: org.maxUsers,
      planDetails: plan,
    });
  } catch (err) {
    console.error("[billing] status error:", err);
    res.status(500).json({ message: "Failed to fetch billing status" });
  }
});

// ── POST /api/billing/checkout ─────────────────────────────────────────────────
const checkoutSchema = z.object({
  planId: z.enum(["starter", "growth", "enterprise"]),
});

router.post("/checkout", authenticateJWT as any, requireOrg as any, async (req: any, res) => {
  const orgId: number = req.user.organizationId;

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid plan", errors: parsed.error.errors });
  }

  const plan = PLANS.find((p) => p.id === parsed.data.planId);
  if (!plan) return res.status(400).json({ message: "Plan not found" });

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

    const merchantReference = `SP-${orgId}-${plan.id}-${Date.now()}`;
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";

    const { orderTrackingId, redirectUrl } = await submitOrder({
      merchantReference,
      amount: plan.priceKes,
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
  const plan = PLANS.find((p) => p.id === pending?.planId);
  if (!plan) {
    console.error("[billing] unknown planId on pending order:", pending?.planId);
    return;
  }

  const paid = Number(status.amount);
  if (Number.isFinite(paid) && paid + 0.001 < plan.priceKes) {
    console.error(`[billing] amount ${paid} is below the ${plan.id} price ${plan.priceKes}; not activating`);
    return;
  }

  const { pendingOrder: _done, ...rest } = features;
  await db
    .update(organizations)
    .set({
      subscriptionPlan: plan.id,
      subscriptionStatus: "active",
      maxProperties: plan.maxProperties,
      maxUsers: plan.maxUsers,
      features: { ...rest, lastOrder: { ...pending, paidAt: new Date().toISOString() } },
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, org.id));

  console.log(`[billing] org ${org.id} upgraded to plan ${plan.id}`);
}

export default router;