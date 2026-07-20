/**
 * Billing repository — PostgreSQL implementation (Stage 8).
 *
 * The only layer that touches the database for billing.
 * The service layer converts raw rows to DTOs.
 *
 * Security invariants:
 *   - amount_minor and currency are read from the DB plan record — never from
 *     client-supplied values.
 *   - provider_reference, provider_payment_id are set only by server logic
 *     (initialise flow or webhook handler).
 *   - All values use Drizzle bound parameters — SQL injection structurally impossible.
 */

import { eq, desc, and } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  subscriptionPlans,
  subscriptions,
  paymentIntents,
  billingWebhookEvents,
} from "../../db/schema/index.js";
import type { SubscriptionRow, PaymentIntentRow } from "./types.js";

// ─── Plans ────────────────────────────────────────────────────────────────────

/** Return all active plans in insertion order. */
export async function listActivePlans(db: Db) {
  return db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
}

/** Return a single plan by ID (active or inactive). */
export async function getPlanById(db: Db, planId: string) {
  const rows = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, planId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/** Return the user's current subscription (joined with plan name). */
export async function getSubscriptionForUser(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      planName: subscriptionPlans.name,
      status: subscriptions.status,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelledAt: subscriptions.cancelledAt,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
    })
    .from(subscriptions)
    .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

/** Upsert a subscription for a user. Called by the webhook handler on payment success. */
export async function upsertSubscription(
  db: Db,
  params: {
    id: string;
    userId: string;
    planId: string;
    status: "trialing" | "active" | "past_due" | "cancelled" | "expired";
    providerSubscriptionId?: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
  },
) {
  await db
    .insert(subscriptions)
    .values({
      id: params.id,
      userId: params.userId,
      planId: params.planId,
      status: params.status,
      providerSubscriptionId: params.providerSubscriptionId ?? null,
      currentPeriodStart: params.currentPeriodStart ?? null,
      currentPeriodEnd: params.currentPeriodEnd ?? null,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        planId: params.planId,
        status: params.status,
        providerSubscriptionId: params.providerSubscriptionId ?? null,
        currentPeriodStart: params.currentPeriodStart ?? null,
        currentPeriodEnd: params.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      },
    });
}

/** Update a subscription's status. Used by webhook handler for lifecycle events. */
export async function updateSubscriptionStatus(
  db: Db,
  userId: string,
  status: "trialing" | "active" | "past_due" | "cancelled" | "expired",
  cancelledAt?: Date,
) {
  await db
    .update(subscriptions)
    .set({
      status,
      ...(cancelledAt ? { cancelledAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
}

// ─── Payment intents ──────────────────────────────────────────────────────────

/** Insert a new payment intent. */
export async function insertPaymentIntent(
  db: Db,
  params: {
    id: string;
    userId: string;
    planId: string;
    amountMinor: number;
    currency: string;
    providerReference: string;
    authorizationUrl: string;
  },
): Promise<PaymentIntentRow> {
  const rows = await db
    .insert(paymentIntents)
    .values({
      id: params.id,
      userId: params.userId,
      planId: params.planId,
      amountMinor: params.amountMinor,
      currency: params.currency,
      status: "pending",
      providerReference: params.providerReference,
      authorizationUrl: params.authorizationUrl,
    })
    .returning();

  return rows[0] as PaymentIntentRow;
}

/** Find a payment intent by its provider reference. */
export async function getIntentByReference(
  db: Db,
  reference: string,
): Promise<PaymentIntentRow | null> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.providerReference, reference))
    .limit(1);
  return (rows[0] as PaymentIntentRow | undefined) ?? null;
}

/** Update a payment intent's status and provider payment ID. Called by webhook handler. */
export async function updatePaymentIntentStatus(
  db: Db,
  intentId: string,
  status: "pending" | "processing" | "succeeded" | "failed" | "refunded",
  providerPaymentId?: string,
) {
  await db
    .update(paymentIntents)
    .set({
      status,
      ...(providerPaymentId ? { providerPaymentId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(paymentIntents.id, intentId));
}

/** Return the 10 most recent payment intents for a user. */
export async function listPaymentIntentsForUser(
  db: Db,
  userId: string,
): Promise<PaymentIntentRow[]> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.userId, userId))
    .orderBy(desc(paymentIntents.createdAt))
    .limit(10);
  return rows as PaymentIntentRow[];
}

// ─── Webhook events ───────────────────────────────────────────────────────────

/**
 * Attempt to insert a webhook event record.
 * Returns true if inserted (new event), false if the (provider, event_id) already exists
 * (duplicate delivery — do not process again).
 */
export async function insertWebhookEventIfNew(
  db: Db,
  params: {
    id: string;
    provider: string;
    eventId: string;
    eventType: string;
    payload: unknown;
  },
): Promise<boolean> {
  try {
    await db.insert(billingWebhookEvents).values({
      id: params.id,
      provider: params.provider,
      eventId: params.eventId,
      eventType: params.eventType,
      payload: params.payload as Record<string, unknown>,
    });
    return true;
  } catch (err: unknown) {
    // Unique violation (23505) = duplicate event — idempotent, do nothing.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return false;
    }
    throw err;
  }
}

/** Mark a webhook event as processed. */
export async function markWebhookEventProcessed(
  db: Db,
  provider: string,
  eventId: string,
): Promise<void> {
  await db
    .update(billingWebhookEvents)
    .set({ processedAt: new Date() })
    .where(
      and(eq(billingWebhookEvents.provider, provider), eq(billingWebhookEvents.eventId, eventId)),
    );
}
