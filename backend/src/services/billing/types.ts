/**
 * Billing domain — DTOs and internal types (Stage 8).
 *
 * DTOs are what routes return to clients.
 * Internal types are used only within the service/repository layer.
 *
 * Security invariant: raw DB rows are NEVER returned directly to clients.
 * Every route serialises through a DTO.
 *
 * Security invariant: amount_minor and currency in DTOs are read from the
 * server-side DB record — never from client-supplied values.
 */

// ─── Public DTOs ──────────────────────────────────────────────────────────────

export interface PlanDto {
  id: string;
  name: string;
  description: string | null;
  /** Amount in integer minor units. 0 = free. */
  amountMinor: number;
  /** ISO 4217 currency code. */
  currency: string;
  billingInterval: string;
}

export interface SubscriptionDto {
  id: string;
  planId: string;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntentDto {
  id: string;
  planId: string;
  amountMinor: number;
  currency: string;
  status: string;
  /** URL to redirect the user to for payment. Present while status is 'pending'. */
  authorizationUrl: string | null;
  createdAt: string;
}

export interface EntitlementsDto {
  /** True when the user has an active or trialing subscription. */
  hasActiveSubscription: boolean;
  /** The plan they are subscribed to, or null for unsubscribed users. */
  planId: string | null;
  planName: string | null;
  /** ISO timestamp when the current period ends, or null. */
  accessUntil: string | null;
}

export interface MyBillingDto {
  subscription: SubscriptionDto | null;
  recentPayments: PaymentIntentDto[];
}

export interface CheckoutDto {
  /** Provider-hosted payment page — redirect the user here. */
  authorizationUrl: string;
  /** Opaque reference for polling / correlation. */
  reference: string;
  paymentIntentId: string;
}

// ─── Internal row types ───────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  status: string;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentIntentRow {
  id: string;
  userId: string;
  planId: string;
  amountMinor: number;
  currency: string;
  status: string;
  providerReference: string | null;
  providerPaymentId: string | null;
  authorizationUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service input types ──────────────────────────────────────────────────────

export interface InitCheckoutParams {
  userId: string;
  /** User's email — forwarded to payment provider for receipts. */
  email: string;
  planId: string;
  callbackUrl?: string;
}

// ─── DTO serialisers ──────────────────────────────────────────────────────────

export function toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
  return {
    id: row.id,
    planId: row.planId,
    planName: row.planName,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPaymentIntentDto(row: PaymentIntentRow): PaymentIntentDto {
  return {
    id: row.id,
    planId: row.planId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    authorizationUrl: row.authorizationUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPlanDto(row: {
  id: string;
  name: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  billingInterval: string;
}): PlanDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    amountMinor: row.amountMinor,
    currency: row.currency,
    billingInterval: row.billingInterval,
  };
}
