-- PMP Stage 7 — Messaging System
--
-- Adds:
--   • conversation_moderation_status enum
--   • message_moderation_status enum
--   • conversations
--   • conversation_participants
--   • messages
--   • message_reports
--   • user_blocks
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 6 database.
--
-- Production (Railway PostgreSQL): run `bun run db:migrate` from backend/.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "conversation_moderation_status" AS ENUM (
  'active',
  'flagged',
  'closed'
);

CREATE TYPE "message_moderation_status" AS ENUM (
  'visible',
  'flagged',
  'hidden'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. conversations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "conversations" (
  "id"                  TEXT PRIMARY KEY,
  -- Deduplication key for 1:1 DMs.
  -- Value: sorted(user_id_a, user_id_b) joined with ':'
  -- NULL is allowed for future group conversations.
  "participant_hash"    TEXT UNIQUE,
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "moderation_status"   conversation_moderation_status NOT NULL DEFAULT 'active'
);

CREATE INDEX "conversations_updated_at_idx" ON "conversations" ("updated_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. conversation_participants
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "conversation_participants" (
  "conversation_id"  TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id"          TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "joined_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = never read
  "last_read_at"     TIMESTAMPTZ,
  PRIMARY KEY ("conversation_id", "user_id")
);

CREATE INDEX "conversation_participants_user_idx"
  ON "conversation_participants" ("user_id");

CREATE INDEX "conversation_participants_conv_idx"
  ON "conversation_participants" ("conversation_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "messages" (
  "id"                TEXT PRIMARY KEY,
  "conversation_id"   TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  -- sender_id comes from the server-side auth context — never the request body
  "sender_id"         TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- Max 4 000 characters enforced in the service layer
  "body"              TEXT NOT NULL,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the sender edits their own message
  "edited_at"         TIMESTAMPTZ,
  -- Soft-delete: body replaced with placeholder in DTOs; row kept for audit
  "deleted_at"        TIMESTAMPTZ,
  "moderation_status" message_moderation_status NOT NULL DEFAULT 'visible'
);

-- Primary read path: list messages in a conversation ordered by time
CREATE INDEX "messages_conv_created_idx"
  ON "messages" ("conversation_id", "created_at");

CREATE INDEX "messages_sender_idx"  ON "messages" ("sender_id");
CREATE INDEX "messages_moderation_idx" ON "messages" ("moderation_status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. message_reports
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "message_reports" (
  "id"           TEXT PRIMARY KEY,
  "message_id"   TEXT NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "reporter_id"  TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason"       TEXT NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One report per user per message
  UNIQUE ("message_id", "reporter_id")
);

CREATE INDEX "message_reports_message_idx" ON "message_reports" ("message_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. user_blocks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "user_blocks" (
  "blocker_id"  TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_id"  TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("blocker_id", "blocked_id"),
  -- Prevent self-blocks at the DB level
  CHECK ("blocker_id" != "blocked_id")
);

CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" ("blocked_id");
