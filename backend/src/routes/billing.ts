/**
 * Billing routes — /v1/billing/* (Stage 8).
 *
 * Endpoints:
 *   GET  /v1/billing/plans                  list active subscription plans (public)
 *   POST /v1/billing/checkout               initialize a Paystack checkout session
 *   GET  /v1/billing/me                     caller's subscription + payment history
 *   GET  /v1/billing/me/entitlements        backend-derived access entitlements
 *   POST /v1/billing/webhook/paystack       Paystack webhook handler
 *
 * Security invariants:
 *   - Plans endpoint is public — no auth needed to browse plans.
 *   - Checkout: plan amount and currency come from the server-side catalog.
 *     The client supplies only the plan ID — it cannot influence the price.
 *   - Sender/user ID always comes from c.var.auth — never from the request body.
 *   - Users can only read their own billing data (/me endpoints).
 *   - Webhook: HMAC-SHA512 signature is verified before any event data is trusted.
 *     Invalid signatures are rejected with 401.
 *   - Webhook idempotency: duplicate event IDs are ignored (DB-level UNIQUE constraint).
 *   - Entitlements are computed entirely on the server — the frontend cannot forge them.
 *   - PAYSTACK_SECRET_KEY is backend-only. Never log it, never return it to clients.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Db } from "../db/client.js";
import type { ClerkAuthAdapter } from "../lib/clerk.js";
import type { UserResolver } from "../middleware/auth.js";
import { requireClerkAuth } from "../middleware/auth.js";
import type { PaymentProvider } from "../lib/payment/index.js";
import {
  getActivePlans,
  initializeCheckout,
  getMyBilling,
  getEntitlements,
  processWebhookEvent,
} from "../services/billing/index.js";
import { logger } from "../lib/logger.js";

// ─── Validation schemas ───────────────────────────────────────────────────────

const checkoutSchema = z.object({
  planId: z.string().min(1, "planId is required"),
  /** Optional URL the payment provider redirects to after completion. */
  callbackUrl: z.string().url().optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createBillingRouter(
  db: Db,
  clerkAdapter: ClerkAuthAdapter,
  resolveUser: UserResolver,
  paymentProvider: PaymentProvider,
): Hono {
  const router = new Hono();

  const auth = requireClerkAuth(clerkAdapter, resolveUser);

  // ── GET /v1/billing/status  (public — no auth required) ─────────────────
  //
  // Lets the frontend check whether payments are operational before showing
  // checkout UI. Returns { paymentsEnabled: false } when PAYSTACK_SECRET_KEY
  // is absent so the UI can degrade gracefully instead of crashing.

  router.get("/v1/billing/status", (c) => {
    return c.json({ paymentsEnabled: paymentProvider.isConfigured() });
  });

  // ── GET /v1/billing/plans  (public — no auth required) ───────────────────

  router.get("/v1/billing/plans", async (c) => {
    const plans = await getActivePlans(db);
    return c.json(plans);
  });

  // ── POST /v1/billing/checkout  ───────────────────────────────────────────
  //
  // Initializes a Paystack checkout session.
  //
  // Security:
  //   - userId comes from auth context — not from the request body.
  //   - email comes from the resolved identity — not from the request body.
  //   - amountMinor and currency are read from the server-side plan catalog.
  //   - The client supplies only the planId and an optional callbackUrl.

  router.post("/v1/billing/checkout", auth, zValidator("json", checkoutSchema), async (c) => {
    // Fail early with a clear 503 when the payment provider is not configured.
    // This prevents the opaque "PAYSTACK_SECRET_KEY is not configured" error
    // from bubbling up as a 500 and keeps billing isolated from other features.
    if (!paymentProvider.isConfigured()) {
      return c.json(
        {
          status: 503,
          code: "billing_unavailable",
          message:
            "Payments are not yet configured on this server. " +
            "Set PAYSTACK_SECRET_KEY to enable billing.",
        },
        503,
      );
    }

    const { pmpUserId } = c.var.auth;
    const { planId, callbackUrl } = c.req.valid("json");

    // email comes from the resolved identity, not from the client
    const resolvedIdentity = await resolveUser(c.var.auth.clerkUserId);
    const email = resolvedIdentity?.user?.email ?? "";

    const result = await initializeCheckout(db, paymentProvider, {
      userId: pmpUserId,
      email,
      planId,
      ...(callbackUrl ? { callbackUrl } : {}),
    });

    return c.json(result, 201);
  });

  // ── GET /v1/billing/me  ──────────────────────────────────────────────────
  //
  // Returns the calling user's subscription and recent payment history.
  // Users can only access their own billing data.

  router.get("/v1/billing/me", auth, async (c) => {
    const { pmpUserId } = c.var.auth;
    const billing = await getMyBilling(db, pmpUserId);
    return c.json(billing);
  });

  // ── GET /v1/billing/me/entitlements  ─────────────────────────────────────
  //
  // Returns backend-derived access entitlements.
  //
  // Security: computed from DB subscription state — the frontend cannot forge
  // or modify these values. hasActiveSubscription is always server-authoritative.

  router.get("/v1/billing/me/entitlements", auth, async (c) => {
    const { pmpUserId } = c.var.auth;
    const entitlements = await getEntitlements(db, pmpUserId);
    return c.json(entitlements);
  });

  // ── POST /v1/billing/webhook/paystack  ───────────────────────────────────
  //
  // Paystack sends event notifications here.
  //
  // Security:
  //   1. Raw body is read BEFORE JSON parsing (signature covers the raw bytes).
  //   2. HMAC-SHA512 signature is verified via the payment provider.
  //   3. Events with invalid signatures are rejected with 401.
  //   4. Duplicate event IDs are silently ignored (idempotent).
  //   5. Subscription state is updated only from provider-verified event data.
  //
  // This endpoint intentionally has NO auth middleware — it is called by
  // Paystack, not by users. Security is entirely via signature verification.

  router.post("/v1/billing/webhook/paystack", async (c) => {
    // Read the raw body BEFORE any parsing — the signature covers raw bytes.
    const rawBody = await c.req.text();
    const signature = c.req.header("x-paystack-signature") ?? "";

    const verified = await paymentProvider.verifyWebhook(rawBody, signature);

    if (!verified.valid) {
      logger.warn({ signature: "[redacted]" }, "billing webhook: invalid signature rejected");
      return c.json(
        { status: 401, code: "unauthorized", message: "Invalid webhook signature" },
        401,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ status: 400, code: "bad_request", message: "Invalid JSON payload" }, 400);
    }

    const webhookEvent: Parameters<typeof processWebhookEvent>[2] = {
      eventId: verified.eventId,
      eventType: verified.eventType,
      rawPayload: payload,
    };
    if (verified.reference !== undefined) webhookEvent.reference = verified.reference;
    if (verified.status !== undefined) webhookEvent.status = verified.status;
    if (verified.amountMinor !== undefined) webhookEvent.amountMinor = verified.amountMinor;
    if (verified.providerPaymentId !== undefined)
      webhookEvent.providerPaymentId = verified.providerPaymentId;

    const result = await processWebhookEvent(db, "paystack", webhookEvent);

    logger.info(
      { eventType: verified.eventType, eventId: verified.eventId, ...result },
      "billing webhook processed",
    );

    // Paystack expects a 200 response — any non-2xx triggers a retry.
    return c.json({ ok: true }, 200);
  });

  return router;
}
