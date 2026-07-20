-- PMP Stage 8 — Payment System
--
-- Adds:
--   • subscription_status enum
--   • payment_intent_status enum
--   • subscription_plans    — catalog of available plans (server-controlled)
--   • subscriptions         — per-user subscription state machine
--   • payment_intents       — individual payment/checkout attempts
--   • billing_webhook_events — idempotent webhook log (replay protection)
--
-- Security invariants:
--   • Amounts are stored as integer minor units (e.g. kobo for NGN, cents for USD).
--     No floating-point monetary arithmetic.
--   • Currency is always explicit — no implicit default assumed at query time.
--   • provider_reference and provider_payment_id come only from the payment
--     provider (via webhook) — never from client requests.
--   • billing_webhook_events.UNIQUE(provider, event_id) makes webhook processing
--     idempotent: re-delivered events are rejected at the DB constraint level.
--   • subscriptions.UNIQUE(user_id) enforces one subscription record per user.
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 7 database.
--
-- Production (Railway PostgreSQL): run `bun run db:migrate` from backend/.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "subscription_status" AS ENUM (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired'
);

CREATE TYPE "payment_intent_status" AS ENUM (
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_plans  (server-controlled catalog — never editable by clients)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "subscription_plans" (
  "id"               TEXT        NOT NULL PRIMARY KEY,
  "name"             TEXT        NOT NULL,
  "description"      TEXT,

  -- Monetary amounts stored as integer minor units (e.g. kobo for NGN).
  -- amount_minor = 0 marks a free plan.
  "amount_minor"     INTEGER     NOT NULL CHECK ("amount_minor" >= 0),
  "currency"         TEXT        NOT NULL DEFAULT 'NGN',

  -- 'monthly' | 'yearly' | 'one_time'
  "billing_interval" TEXT        NOT NULL DEFAULT 'monthly',

  -- When false the plan is hidden from the public listing and cannot be
  -- used to initiate new checkouts.  Existing subscriptions are unaffected.
  "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,

  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed plans — amounts in kobo (NGN × 100).
-- Plans are inactive until the payment system is formally enabled.
INSERT INTO "subscription_plans" ("id", "name", "description", "amount_minor", "currency", "billing_interval", "is_active")
VALUES
  ('plan_free',         'Free',         'Basic access with no payment required.',          0,       'NGN', 'monthly', TRUE),
  ('plan_basic',        'Basic',        'Standard provider listing with enhanced reach.',  500000,  'NGN', 'monthly', FALSE),
  ('plan_professional', 'Professional', 'Full-featured provider profile and analytics.',   1500000, 'NGN', 'monthly', FALSE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subscriptions  (one per user — state machine)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "subscriptions" (
  "id"                       TEXT                 NOT NULL PRIMARY KEY,
  "user_id"                  TEXT                 NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_id"                  TEXT                 NOT NULL REFERENCES "subscription_plans"("id"),
  "status"                   subscription_status  NOT NULL DEFAULT 'active',

  -- Opaque ID assigned by the payment provider.
  -- NULL for free-plan subscriptions (no provider interaction needed).
  "provider_subscription_id" TEXT,

  "current_period_start"     TIMESTAMPTZ,
  "current_period_end"       TIMESTAMPTZ,

  -- Set when the user cancels (subscription continues until period_end).
  "cancelled_at"             TIMESTAMPTZ,

  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One subscription record per user (the current/most-recent one).
  CONSTRAINT "subscriptions_user_id_unique" UNIQUE ("user_id")
);

CREATE INDEX "subscriptions_status_idx"   ON "subscriptions" ("status");
CREATE INDEX "subscriptions_plan_idx"     ON "subscriptions" ("plan_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. payment_intents  (individual checkout / payment attempt)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "payment_intents" (
  "id"                  TEXT                    NOT NULL PRIMARY KEY,
  "user_id"             TEXT                    NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan_id"             TEXT                    NOT NULL REFERENCES "subscription_plans"("id"),
  "subscription_id"     TEXT                    REFERENCES "subscriptions"("id"),

  -- Snapshot of the plan price at the time the intent was created.
  -- Prevents price changes from retroactively altering outstanding intents.
  "amount_minor"        INTEGER                 NOT NULL CHECK ("amount_minor" >= 0),
  "currency"            TEXT                    NOT NULL,

  "status"              payment_intent_status   NOT NULL DEFAULT 'pending',

  -- Opaque reference generated by this backend and sent to the payment provider.
  -- Used to correlate webhook callbacks back to the intent.
  "provider_reference"  TEXT                    UNIQUE,

  -- ID assigned by the provider when the payment completes (from webhook).
  -- Set only by the webhook handler — never by client requests.
  "provider_payment_id" TEXT,

  -- Checkout URL returned by the provider's initialise call.
  "authorization_url"   TEXT,

  "created_at"          TIMESTAMPTZ             NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX "payment_intents_user_idx"      ON "payment_intents" ("user_id");
CREATE INDEX "payment_intents_status_idx"    ON "payment_intents" ("status");
CREATE INDEX "payment_intents_reference_idx" ON "payment_intents" ("provider_reference");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. billing_webhook_events  (idempotent event log)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "billing_webhook_events" (
  "id"           TEXT        NOT NULL PRIMARY KEY,
  "provider"     TEXT        NOT NULL,   -- e.g. 'paystack'
  "event_id"     TEXT        NOT NULL,   -- provider-assigned unique event ID
  "event_type"   TEXT        NOT NULL,   -- e.g. 'charge.success'
  "payload"      JSONB       NOT NULL,
  "processed_at" TIMESTAMPTZ,            -- NULL = received but not yet processed

  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Replay protection: the same (provider, event_id) pair is rejected at the
  -- DB level if it has already been received.
  CONSTRAINT "billing_webhook_events_unique" UNIQUE ("provider", "event_id")
);

CREATE INDEX "billing_webhook_events_provider_idx"    ON "billing_webhook_events" ("provider");
CREATE INDEX "billing_webhook_events_event_type_idx"  ON "billing_webhook_events" ("event_type");
