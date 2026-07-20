-- PMP Stage 9 — Operations System
--
-- Adds:
--   • support_ticket_status enum
--   • support_ticket_category enum
--   • support_ticket_priority enum
--   • content_report_status enum
--   • content_report_reason enum
--   • content_report_entity_type enum
--   • ops_audit_action enum
--   • support_tickets             — help requests from any authenticated user
--   • support_ticket_messages     — threaded replies (staff internal flag)
--   • content_reports             — user reports on profiles / messages / users
--   • moderation_actions          — append-only moderation decision log
--   • ops_audit_log               — append-only cross-domain operational audit trail
--
-- Security notes:
--   • ops_audit_log is append-only — no UPDATE or DELETE from the application.
--   • moderation_actions is append-only.
--   • Internal support messages (is_internal = true) are filtered server-side.
--   • Role assignment uses the existing user_roles table; every change is
--     recorded in ops_audit_log with full actor attribution.
--
-- This migration is additive — no existing tables are altered.
-- Safe to run on a Stage 8 database.
-- Production (Railway PostgreSQL): run `bun run db:migrate` from backend/.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "support_ticket_status" AS ENUM (
  'open', 'assigned', 'resolved', 'closed'
);

CREATE TYPE "support_ticket_category" AS ENUM (
  'billing', 'account', 'verification', 'technical', 'other'
);

CREATE TYPE "support_ticket_priority" AS ENUM (
  'low', 'medium', 'high', 'urgent'
);

CREATE TYPE "content_report_status" AS ENUM (
  'pending', 'reviewing', 'actioned', 'dismissed'
);

CREATE TYPE "content_report_reason" AS ENUM (
  'spam', 'harassment', 'inappropriate', 'fraud', 'other'
);

CREATE TYPE "content_report_entity_type" AS ENUM (
  'provider_profile', 'message', 'user'
);

CREATE TYPE "ops_audit_action" AS ENUM (
  'role_assigned',
  'role_removed',
  'user_suspended',
  'user_reactivated',
  'user_deleted',
  'support_ticket_created',
  'support_ticket_assigned',
  'support_ticket_closed',
  'moderation_report_submitted',
  'moderation_action_taken',
  'moderation_report_dismissed'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. support_tickets
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "support_tickets" (
  "id"            TEXT                         NOT NULL PRIMARY KEY,
  "title"         TEXT                         NOT NULL,
  "description"   TEXT                         NOT NULL,
  "category"      support_ticket_category      NOT NULL,
  "priority"      support_ticket_priority      NOT NULL DEFAULT 'medium',
  "status"        support_ticket_status        NOT NULL DEFAULT 'open',
  "submitted_by"  TEXT                         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assigned_to"   TEXT                         REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at"   TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ                  NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ                  NOT NULL DEFAULT now()
);

CREATE INDEX "support_tickets_submitted_by_idx" ON "support_tickets" ("submitted_by");
CREATE INDEX "support_tickets_status_idx"       ON "support_tickets" ("status");
CREATE INDEX "support_tickets_assigned_to_idx"  ON "support_tickets" ("assigned_to");
CREATE INDEX "support_tickets_category_idx"     ON "support_tickets" ("category");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. support_ticket_messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "support_ticket_messages" (
  "id"          TEXT        NOT NULL PRIMARY KEY,
  "ticket_id"   TEXT        NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "author_id"   TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content"     TEXT        NOT NULL,
  "is_internal" BOOLEAN     NOT NULL DEFAULT FALSE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "support_ticket_messages_ticket_idx" ON "support_ticket_messages" ("ticket_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. content_reports
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "content_reports" (
  "id"           TEXT                          NOT NULL PRIMARY KEY,
  "entity_type"  content_report_entity_type    NOT NULL,
  "entity_id"    TEXT                          NOT NULL,
  "reporter_id"  TEXT                          NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reason"       content_report_reason         NOT NULL,
  "description"  TEXT,
  "status"       content_report_status         NOT NULL DEFAULT 'pending',
  "reviewed_by"  TEXT                          REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at"  TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ                   NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ                   NOT NULL DEFAULT now()
);

CREATE INDEX "content_reports_status_idx"   ON "content_reports" ("status");
CREATE INDEX "content_reports_entity_idx"   ON "content_reports" ("entity_type", "entity_id");
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" ("reporter_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. moderation_actions (append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "moderation_actions" (
  "id"                  TEXT        NOT NULL PRIMARY KEY,
  "report_id"           TEXT        REFERENCES "content_reports"("id") ON DELETE SET NULL,
  "actor_id"            TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_entity_type"  TEXT        NOT NULL,
  "target_entity_id"    TEXT        NOT NULL,
  -- 'warn' | 'restrict' | 'content_removed' | 'dismiss'
  "action_type"         TEXT        NOT NULL,
  "notes"               TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "moderation_actions_report_idx"  ON "moderation_actions" ("report_id");
CREATE INDEX "moderation_actions_actor_idx"   ON "moderation_actions" ("actor_id");
CREATE INDEX "moderation_actions_entity_idx"  ON "moderation_actions" ("target_entity_type", "target_entity_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ops_audit_log (append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ops_audit_log" (
  "id"             TEXT             NOT NULL PRIMARY KEY,
  "actor_id"       TEXT             NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action"         ops_audit_action NOT NULL,
  "target_user_id" TEXT             REFERENCES "users"("id") ON DELETE SET NULL,
  "entity_type"    TEXT,
  "entity_id"      TEXT,
  -- JSON string with action-specific metadata
  "metadata"       TEXT,
  "created_at"     TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX "ops_audit_log_actor_idx"       ON "ops_audit_log" ("actor_id");
CREATE INDEX "ops_audit_log_action_idx"      ON "ops_audit_log" ("action");
CREATE INDEX "ops_audit_log_target_user_idx" ON "ops_audit_log" ("target_user_id");
CREATE INDEX "ops_audit_log_entity_idx"      ON "ops_audit_log" ("entity_type", "entity_id");
