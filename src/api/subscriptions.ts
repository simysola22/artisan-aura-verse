/**
 * Billing & subscriptions API — Stage 8.
 *
 * Calls the backend billing endpoints.
 * Subscriptions are currently on standby — checkout will not work until
 * PAYSTACK_SECRET_KEY is configured on the backend.
 *
 * Security invariants (enforced by the backend, not this file):
 *   - Plan amounts are server-controlled; the client only supplies a plan ID.
 *   - Entitlements are server-derived; the frontend never forges them.
 *   - Payment success is authorised only by the backend webhook handler.
 *   - All payment provider secrets are backend-only environment variables.
 */

import { apiFetch } from "./client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  /** Amount in integer minor units (e.g. kobo for NGN). */
  amountMinor: number;
  /** ISO 4217 currency code. */
  currency: string;
  billingInterval: string;
}

export interface Subscription {
  id: string;
  planId: string;
  planName: string;
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntent {
  id: string;
  planId: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "refunded";
  authorizationUrl: string | null;
  createdAt: string;
}

export interface MyBilling {
  subscription: Subscription | null;
  recentPayments: PaymentIntent[];
}

export interface Entitlements {
  hasActiveSubscription: boolean;
  planId: string | null;
  planName: string | null;
  accessUntil: string | null;
}

export interface CheckoutResult {
  /** Redirect the user to this URL to complete payment. */
  authorizationUrl: string;
  reference: string;
  paymentIntentId: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/** Return active subscription plans. No auth required. */
export function listPlans(): Promise<Plan[]> {
  return apiFetch<Plan[]>("/billing/plans");
}

/**
 * Initialize a Paystack checkout session for a plan.
 *
 * The backend reads the plan price from its own catalog — the client only
 * supplies the plan ID. The returned authorizationUrl should be used to
 * redirect the user to the payment page.
 */
export function initializeCheckout(
  planId: string,
  callbackUrl?: string,
): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ planId, ...(callbackUrl ? { callbackUrl } : {}) }),
  });
}

/** Return the calling user's subscription and recent payment history. */
export function getMyBilling(): Promise<MyBilling> {
  return apiFetch<MyBilling>("/billing/me");
}

/**
 * Return backend-derived entitlements for the calling user.
 *
 * hasActiveSubscription is always computed on the server — the frontend
 * must never use local state to gate access to premium features.
 */
export function getEntitlements(): Promise<Entitlements> {
  return apiFetch<Entitlements>("/billing/me/entitlements");
}

// ─── Convenience export ───────────────────────────────────────────────────────

export const billingApi = {
  listPlans,
  initializeCheckout,
  getMyBilling,
  getEntitlements,
};
